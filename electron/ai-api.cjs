const usageHelpers = require("./ai-usage.cjs");

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_WIRE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_EVENT_BYTES = 1024 * 1024;
const DEFAULT_OUTPUT_TOKENS = 8192;
const MAX_OUTPUT_TOKENS = 100_000;

class ApiError extends Error {
  constructor(message, status = undefined, requestId = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (requestId) this.requestId = requestId;
  }
}

function createAbortScope(signal) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    check() {
      if (timedOut) throw new ApiError("The AI request timed out.");
      if (signal?.aborted) {
        const error = new ApiError("The AI request was cancelled.");
        error.name = "AbortError";
        throw error;
      }
    },
    close() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function requestId(response) {
  const raw = response.headers?.get?.("x-request-id") || response.headers?.get?.("request-id") || response.headers?.get?.("anthropic-request-id");
  return typeof raw === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(raw) ? raw : undefined;
}

async function rejectHttp(response) {
  try { await response.body?.cancel(); } catch {}
  throw new ApiError(`AI provider returned HTTP ${response.status}.`, response.status, requestId(response));
}

async function readBoundedText(response, maxBytes = MAX_WIRE_BYTES) {
  if (!response.body?.getReader) throw new ApiError("AI provider returned an empty response.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ApiError("AI provider response exceeded the size limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function readSse(response, onEvent) {
  if (!response.body?.getReader) throw new ApiError("AI provider did not return a stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines = [];
  let totalBytes = 0;
  let eventBytes = 0;
  const dispatch = async () => {
    if (!dataLines.length) { eventName = ""; eventBytes = 0; return; }
    await onEvent({ event: eventName, data: dataLines.join("\n") });
    eventName = "";
    dataLines = [];
    eventBytes = 0;
  };
  const line = async value => {
    const current = value.endsWith("\r") ? value.slice(0, -1) : value;
    if (!current) { await dispatch(); return; }
    if (current.startsWith(":")) return;
    const colon = current.indexOf(":");
    const field = colon < 0 ? current : current.slice(0, colon);
    let valueText = colon < 0 ? "" : current.slice(colon + 1);
    if (valueText.startsWith(" ")) valueText = valueText.slice(1);
    if (field === "event") eventName = valueText;
    else if (field === "data") {
      eventBytes += Buffer.byteLength(valueText, "utf8");
      if (eventBytes > MAX_EVENT_BYTES) throw new ApiError("AI provider stream event exceeded the size limit.");
      dataLines.push(valueText);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_WIRE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new ApiError("AI provider response exceeded the size limit.");
        }
        buffer += decoder.decode(value, { stream: !done });
      } else if (done) {
        buffer += decoder.decode();
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const current = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        await line(current);
      }
      if (Buffer.byteLength(buffer, "utf8") + eventBytes > MAX_EVENT_BYTES)
        throw new ApiError("AI provider stream event exceeded the size limit.");
      if (done) {
        if (buffer) await line(buffer);
        await dispatch();
        break;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

function mergeUsage(previous, next) {
  if (!next) return previous;
  const usage = { ...(previous || {}), ...next };
  if (usage.totalTokens === undefined && usage.inputTokens !== undefined && usage.outputTokens !== undefined)
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return usage;
}

function parseJson(data) {
  try { return JSON.parse(data); }
  catch { throw new ApiError("AI provider sent an invalid streaming response."); }
}

function newTextWriter(onText) {
  let text = "";
  let bytes = 0;
  return {
    get text() { return text; },
    async append(value) {
      if (typeof value !== "string" || !value) return;
      const size = Buffer.byteLength(value, "utf8");
      if (bytes + size > MAX_OUTPUT_BYTES) throw new ApiError("AI response exceeded the output size limit.");
      bytes += size;
      text += value;
      if (typeof onText === "function") {
        try { await onText(value); }
        catch { throw new ApiError("Could not update the AI response."); }
      }
    },
  };
}

// Provider-specific wire behavior is supplied by the verified v1 component.
// These host functions only enforce request/response bounds and transport
// policy; they do not contain a provider/model switch.
function adapterDescriptor(adapter, provider) {
  const compatibleCustom = provider?.custom === true && adapter?.provider?.protocol === provider?.protocol;
  if (!adapter || adapter.abiVersion !== 1 || (adapter.provider?.id !== provider?.id && !compatibleCustom) || !adapter.api)
    throw new ApiError("The verified provider adapter is unavailable.");
  return adapter;
}

function safeProviderOrigin(provider) {
  try {
    const base = new URL(provider.baseUrl);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if ((base.protocol !== "https:" && !(provider.custom === true && base.protocol === "http:" && loopback)) || base.username || base.password || base.search || base.hash) throw new Error();
    return base.origin;
  } catch { throw new ApiError("AI provider address is invalid."); }
}

function validateAdapterRequest(raw, provider, key, expectedMethod) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError("Provider adapter built an invalid request.");
  let url;
  try { url = new URL(raw.url); } catch { throw new ApiError("Provider adapter built an invalid request URL."); }
  const loopbackHttp = provider?.custom === true && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopbackHttp) || url.origin !== safeProviderOrigin(provider) || url.username || url.password || url.hash || url.href.includes(key))
    throw new ApiError("Provider adapter request URL is outside its approved endpoint.");
  const method = String(raw.method || expectedMethod || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method) || (expectedMethod && method !== expectedMethod)) throw new ApiError("Provider adapter used an unsupported HTTP method.");
  const headers = {};
  const sourceHeaders = raw.headers || {};
  if (!sourceHeaders || typeof sourceHeaders !== "object" || Array.isArray(sourceHeaders)) throw new ApiError("Provider adapter built invalid headers.");
  for (const [rawName, rawValue] of Object.entries(sourceHeaders)) {
    const name = String(rawName).toLowerCase();
    const value = String(rawValue);
    if (!/^[a-z0-9-]{1,64}$/.test(name) || value.length > 1024 || /[\r\n\0]/.test(value) || /^(?:cookie|set-cookie|host|content-length|connection|transfer-encoding)$/i.test(name))
      throw new ApiError("Provider adapter built unsafe headers.");
    const containsKey = value.includes(key);
    if (containsKey && value !== key && value !== `Bearer ${key}`) throw new ApiError("Provider adapter exposed a credential in a header.");
    if (containsKey && !/^(authorization|x-api-key|x-goog-api-key|api-key)$/i.test(name)) throw new ApiError("Provider adapter exposed a credential in a header.");
    headers[name] = value;
  }
  let body;
  if (raw.body !== undefined && raw.body !== null) {
    body = typeof raw.body === "string" ? raw.body : JSON.stringify(raw.body);
    if (Buffer.byteLength(body, "utf8") > MAX_WIRE_BYTES || body.includes(key)) throw new ApiError("Provider adapter request body is unsafe or too large.");
  }
  if (method === "POST" && !body) throw new ApiError("Provider adapter omitted the request body.");
  if (method === "GET" && body) throw new ApiError("Provider adapter attached a body to a model request.");
  return { url: url.href, method, headers, ...(body ? { body } : {}) };
}

function validUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const key of ["inputTokens", "uncachedInputTokens", "cachedInputTokens", "cacheWriteInputTokens", "cacheWrite5mInputTokens", "cacheWrite1hInputTokens", "outputTokens", "thinkingTokens", "totalTokens"]) {
    const item = value[key];
    if (Number.isSafeInteger(item) && item >= 0) result[key] = item;
  }
  return Object.keys(result).length ? result : null;
}

function checkedModels(value) {
  if (!Array.isArray(value)) throw new ApiError("Provider adapter returned an invalid model list.");
  const rows = [];
  const seen = new Set();
  for (const raw of value.slice(0, 1001)) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(raw.id) || seen.has(raw.id)) continue;
    if (rows.length >= 1000) throw new ApiError("Provider returned too many models.");
    seen.add(raw.id);
    const row = { id: raw.id };
    if (typeof raw.name === "string" && raw.name.length <= 160 && !/[\u0000-\u001f\u007f]/.test(raw.name)) row.name = raw.name;
    if (Array.isArray(raw.efforts)) row.efforts = [...new Set(raw.efforts.filter(item => typeof item === "string" && /^[a-z][a-z0-9_-]{0,31}$/i.test(item)))].slice(0, 20);
    else row.effortsReported = raw.effortsReported === true;
    if (raw.supportsEffort === true || raw.supportsEffort === false) row.supportsEffort = raw.supportsEffort;
    if (typeof raw.defaultEffort === "string" && /^[a-z][a-z0-9_-]{0,31}$/i.test(raw.defaultEffort)) row.defaultEffort = raw.defaultEffort;
    if (raw.pricing && typeof raw.pricing === "object") row.pricing = raw.pricing;
    rows.push(row);
  }
  return rows;
}

function buildApiRequest(options) {
  const { provider, adapter, key, model, effort = "default", prompt, maxOutputTokens } = options || {};
  const descriptor = adapterDescriptor(adapter, provider);
  if (typeof descriptor.api.buildRequest !== "function") throw new ApiError("Provider adapter has no API request builder.");
  if (typeof key !== "string" || !key.trim() || key.length > 8192 || /[\r\n\0]/.test(key)) throw new ApiError("An API key is required.");
  if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(model)) throw new ApiError("Select a model from the verified model list.");
  if (!Number.isSafeInteger(maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS) || (maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS) < 1 || (maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS) > MAX_OUTPUT_TOKENS) throw new ApiError("The output token limit is invalid.");
  let raw;
  try { raw = descriptor.api.buildRequest({ provider: provider.custom === true ? provider : descriptor.provider, key, model, effort, prompt, maxOutputTokens: maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS }); }
  catch (error) {
    if (error?.code === "prompt_too_large") throw new ApiError("AI request prompt is too large.");
    throw new ApiError("Provider adapter could not build the API request.");
  }
  return validateAdapterRequest(raw, provider.custom === true ? provider : descriptor.provider, key, "POST");
}

async function runApi({ provider, adapter, key, model, effort = "default", prompt, signal, onText, maxOutputTokens, fetchImpl, pricing } = {}) {
  const descriptor = adapterDescriptor(adapter, provider);
  const request = buildApiRequest({ provider, adapter: descriptor, key, model, effort, prompt, maxOutputTokens });
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") throw new ApiError("This runtime does not provide HTTP fetch support.");
  const scope = createAbortScope(signal);
  const startedAt = new Date().toISOString();
  const writer = newTextWriter(onText);
  let usage = null;
  let done = false;
  try {
    scope.check();
    const response = await doFetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: scope.signal, redirect: "error" });
    scope.check();
    if (!response.ok) await rejectHttp(response);
    await readSse(response, async frame => {
      scope.check();
      if (frame.data === "[DONE]") return;
      let result;
      try { result = descriptor.api.parseEvent({ event: frame.event || "", data: frame.data }); }
      catch { throw new ApiError("Provider adapter could not parse a response event."); }
      if (!result || typeof result !== "object" || Array.isArray(result)) return;
      if (result.error || result.incomplete || result.toolRequest) throw new ApiError(result.toolRequest ? "The AI response requested an unsupported tool action." : "AI provider did not complete the response.");
      if (typeof result.text === "string") {
        if (result.appendText === false && writer.text) { /* final snapshots must not duplicate streamed deltas */ }
        else await writer.append(result.text);
      }
      // parseEvent is the ABI boundary: it returns canonical usage fields.
      // normalizeUsage is reserved for raw CLI payloads and must not be called
      // on an already-normalized API event.
      usage = mergeUsage(usage, validUsage(result.usage));
      if (result.done === true) done = true;
    });
    scope.check();
    if (!done) throw new ApiError("AI provider stream ended before completion.");
    const cost = usageHelpers?.estimateCost?.({ providerId: provider.id, modelId: model, usage, pricing: pricing || descriptor.pricing, at: startedAt }) || { amount: null, currency: "USD", estimated: false, reason: "No verified price is available." };
    return { text: writer.text, usage, cost, providerId: provider.id, model };
  } catch (error) {
    scope.check();
    if (error instanceof ApiError) throw error;
    throw new ApiError("Could not complete the AI request.");
  } finally { scope.close(); }
}

async function readJsonBounded(response) {
  const text = await readBoundedText(response, MAX_WIRE_BYTES);
  try { return JSON.parse(text); } catch { throw new ApiError("AI provider returned an invalid model list."); }
}

async function listModels({ provider, adapter, key, signal, fetchImpl } = {}) {
  const descriptor = adapterDescriptor(adapter, provider);
  if (typeof descriptor.api.buildModelsRequest !== "function" || typeof descriptor.api.parseModelsResponse !== "function") throw new ApiError("Provider adapter has no model discovery implementation.");
  if (typeof key !== "string" || !key.trim() || key.length > 8192 || /[\r\n\0]/.test(key)) throw new ApiError("An API key is required.");
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") throw new ApiError("This runtime does not provide HTTP fetch support.");
  const scope = createAbortScope(signal);
  const models = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  let cursor;
  try {
    for (let page = 0; page < 100 && models.length < 1000; page++) {
      scope.check();
      let rawRequest;
      const requestProvider = provider.custom === true ? provider : descriptor.provider;
      try { rawRequest = descriptor.api.buildModelsRequest({ provider: requestProvider, key, cursor }); }
      catch { throw new ApiError("Provider adapter could not build a model request."); }
      const approvedProvider = provider.custom === true ? provider : descriptor.provider;
      let request = validateAdapterRequest(rawRequest, approvedProvider, key, "GET");
      let response = await doFetch(request.url, { method: request.method, headers: request.headers, signal: scope.signal, redirect: "error" });
      scope.check();
      if (page === 0 && response.status === 404 && typeof descriptor.api.buildModelsFallbackRequest === "function") {
        try { await response.body?.cancel(); } catch {}
        let fallback;
        try { fallback = descriptor.api.buildModelsFallbackRequest({ provider: requestProvider, key, cursor }); }
        catch { throw new ApiError("Provider adapter could not build a fallback model request."); }
        request = validateAdapterRequest(fallback, approvedProvider, key, "GET");
        response = await doFetch(request.url, { method: request.method, headers: request.headers, signal: scope.signal, redirect: "error" });
        scope.check();
      }
      if (!response.ok) await rejectHttp(response);
      const payload = await readJsonBounded(response);
      let parsed;
      try { parsed = descriptor.api.parseModelsResponse({ payload }); }
      catch { throw new ApiError("Provider adapter could not parse the model list."); }
      const rows = checkedModels(parsed?.models);
      for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        models.push(row);
        if (models.length >= 1000) break;
      }
      const next = parsed?.nextCursor;
      if (parsed?.hasMore !== true || typeof next !== "string" || !next || next.length > 512 || /[\r\n\0]/.test(next) || seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
    }
    scope.check();
    return models;
  } catch (error) {
    scope.check();
    if (error instanceof ApiError) throw error;
    throw new ApiError("Could not load AI models.");
  } finally { scope.close(); }
}

module.exports = { runApi, listModels, buildApiRequest, ApiError };
