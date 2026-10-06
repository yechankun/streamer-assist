const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { runApi: runApiCore, listModels: listModelsCore, buildApiRequest: buildApiRequestCore } = require("../electron/ai-api.cjs");
const { loadTestAdapters } = require("./ai-test-adapters.cjs");

let adapters;
test.before(async () => { adapters = await loadTestAdapters(); });

function adapterFor(provider) {
  const id = provider.custom ? ({ responses: "openai", chat: "deepseek", anthropic: "anthropic", gemini: "google" })[provider.protocol] : provider.id;
  const adapter = adapters?.[id];
  if (!adapter) throw new Error("No compatible adapter test fixture.");
  return adapter;
}
function requestProvider(provider, adapter) { return provider.custom ? provider : { ...adapter.provider, ...provider }; }
function buildApiRequest(input) {
  const adapter = adapterFor(input.provider);
  return buildApiRequestCore({ ...input, adapter, provider: requestProvider(input.provider, adapter) });
}
function runApi(input) {
  const adapter = adapterFor(input.provider);
  return runApiCore({ ...input, adapter, provider: requestProvider(input.provider, adapter) });
}
function listModels(input) {
  const adapter = adapterFor(input.provider);
  return listModelsCore({ ...input, adapter, provider: requestProvider(input.provider, adapter) });
}

function sseResponse(frames, { chunkSize = 17, status = 200 } = {}) {
  const bytes = Buffer.from(frames, "utf8");
  let offset = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream", "x-request-id": "req_test-1" } });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("Responses request uses private, non-tool streaming request fields", () => {
  const request = buildApiRequest({
    provider: { id: "openai", protocol: "responses", baseUrl: "https://api.openai.com/v1" },
    key: "secret-test-key",
    model: "gpt-5.4",
    effort: "high",
    prompt: { system: "Be concise", user: "Summarize this clip" },
  });
  const body = JSON.parse(request.body);
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.headers.authorization, "Bearer secret-test-key");
  assert.equal(new URL(request.url).search, "");
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.equal("tools" in body, false);
  assert.equal(request.body.includes("secret-test-key"), false);
});

test("provider module effort hook controls the request instead of the core registry", () => {
  const openai = adapters.openai.provider;
  assert.ok(openai.effortsFor({ mode: "api", model: "gpt-6.1-sol", row: {} }).includes("max"));
  const request = buildApiRequest({
    provider: { id: "openai", protocol: "responses", baseUrl: "https://api.openai.com/v1" },
    key: "key", model: "gpt-6.1-sol", effort: "max", prompt: { user: "u" },
  });
  assert.deepEqual(JSON.parse(request.body).reasoning, { effort: "max" });

  const unsupported = buildApiRequest({
    provider: { id: "openai", protocol: "responses", baseUrl: "https://api.openai.com/v1" },
    key: "key", model: "gpt-6-luna", effort: "none", prompt: { user: "u" },
  });
  assert.deepEqual(JSON.parse(unsupported.body).reasoning, { effort: "none" });
});

test("chat, Claude, and Gemini effort/protocol request shapes stay provider-specific", () => {
  const kimi = buildApiRequest({
    provider: { id: "moonshot", protocol: "chat", baseUrl: "https://api.moonshot.ai/v1" },
    key: "key", model: "kimi-k3", effort: "max", prompt: { system: "s", user: "u" }, maxOutputTokens: 4096,
  });
  const kimiBody = JSON.parse(kimi.body);
  assert.equal(kimiBody.max_completion_tokens, 4096);
  assert.equal(kimiBody.reasoning_effort, "max");
  assert.equal("max_tokens" in kimiBody, false);

  const claude = buildApiRequest({
    provider: { id: "anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
    key: "key", model: "claude-sonnet-4-6", effort: "high", prompt: { system: "s", user: "u" },
  });
  const claudeBody = JSON.parse(claude.body);
  assert.equal(claude.url, "https://api.anthropic.com/v1/messages");
  assert.equal(claude.headers["x-api-key"], "key");
  assert.equal(claude.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(claudeBody.thinking, { type: "adaptive" });
  assert.deepEqual(claudeBody.output_config, { effort: "high" });

  const gemini = buildApiRequest({
    provider: { id: "google", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    key: "key", model: "gemini-3.8-flash", effort: "low", prompt: { user: "u" },
  });
  const geminiBody = JSON.parse(gemini.body);
  assert.equal(new URL(gemini.url).searchParams.get("alt"), "sse");
  assert.equal(new URL(gemini.url).searchParams.get("key"), null);
  assert.equal(gemini.headers["x-goog-api-key"], "key");
  assert.deepEqual(geminiBody.generationConfig.thinkingConfig, { thinkingLevel: "low" });
});

test("Responses stream decodes split UTF-8 and reports usage", async () => {
  const seen = [];
  let requestInit;
  const result = await runApi({
    provider: { id: "openai", protocol: "responses", baseUrl: "https://api.openai.com/v1" },
    key: "private", model: "gpt-5.4", prompt: { user: "Summarize" },
    onText: value => seen.push(value),
    fetchImpl: async (url, init) => {
      requestInit = init;
      return sseResponse([
        'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"reasoning","id":"rs_1"}}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"안녕 🌙"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":12,"output_tokens":3,"total_tokens":15},"output":[{"type":"reasoning"},{"type":"message"}]}}\n\n',
      ].join(""), { chunkSize: 5 });
    },
  });
  assert.equal(result.text, "안녕 🌙");
  assert.deepEqual(result.usage, { inputTokens: 12, uncachedInputTokens: 12, outputTokens: 3, totalTokens: 15 });
  assert.deepEqual(result.cost, { amount: 0.000075, currency: "USD", estimated: true, source: "https://developers.openai.com/api/docs/models/gpt-5.4", checkedAt: "2026-10-06", breakdown: { input: 0.00003, output: 0.000045 } });
  assert.equal(seen.join(""), result.text);
  assert.equal(requestInit.redirect, "error");
  assert.equal(requestInit.headers.authorization, "Bearer private");
});

test("chat ignores reasoning fields and fails safely on requested tool calls", async () => {
  let fetches = 0;
  const result = await runApi({
    provider: { id: "deepseek", protocol: "chat", baseUrl: "https://api.deepseek.com/v1" },
    key: "private", model: "deepseek-flash", effort: "high", prompt: { user: "u" },
    fetchImpl: async () => {
      fetches++;
      return sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"visible"}}]}\n\n',
        'data: {"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3},"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""));
    },
  });
  assert.equal(fetches, 1);
  assert.equal(result.text, "visible");

  await assert.rejects(runApi({
    provider: { id: "xai", protocol: "chat", baseUrl: "https://api.x.ai/v1" },
    key: "private", model: "grok-4.7", prompt: { user: "u" },
    fetchImpl: async () => sseResponse('data: {"choices":[{"delta":{"tool_calls":[{"id":"never-execute"}]}}]}\n\n'),
  }), /unsupported tool action/);
});

test("Gemini stream emits visible text and drops thought parts", async () => {
  const result = await runApi({
    provider: { id: "google", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    key: "private", model: "gemini-3.8-flash", prompt: { user: "u" },
    fetchImpl: async () => sseResponse([
      'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"hidden reasoning"},{"text":"Final answer"}]}}]}\n\n',
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2,"totalTokenCount":9}}\n\n',
    ].join("")),
  });
  assert.equal(result.text, "Final answer");
  assert.deepEqual(result.usage, { inputTokens: 7, uncachedInputTokens: 7, outputTokens: 2, totalTokens: 9 });
});

test("Anthropic stream usage is combined and max token truncation is an error", async () => {
  const result = await runApi({
    provider: { id: "anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
    key: "private", model: "claude-sonnet-4-6", prompt: { user: "u" },
    fetchImpl: async () => sseResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("")),
  });
  assert.equal(result.text, "Hello");
  assert.deepEqual(result.usage, { inputTokens: 9, uncachedInputTokens: 9, outputTokens: 2, totalTokens: 11 });

  await assert.rejects(runApi({
    provider: { id: "anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
    key: "private", model: "claude-sonnet-4-6", prompt: { user: "u" },
    fetchImpl: async () => sseResponse([
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("")),
  }), /did not complete the response/);
});

test("provider errors do not echo response bodies or API keys", async () => {
  await assert.rejects(runApi({
    provider: { id: "openai", protocol: "responses", baseUrl: "https://api.openai.com/v1" },
    key: "super-secret", model: "gpt-5.4", prompt: { user: "u" },
    fetchImpl: async () => new Response("echo super-secret and user prompt", {
      status: 429, headers: { "x-request-id": "req_safe-2" },
    }),
  }), error => {
    assert.match(error.message, /HTTP 429/);
    assert.equal(error.status, 429);
    assert.equal(error.requestId, "req_safe-2");
    assert.equal(error.message.includes("super-secret"), false);
    assert.equal(error.message.includes("user prompt"), false);
    return true;
  });
});

test("model listing paginates without ever placing a key in the URL", async () => {
  const urls = [];
  const models = await listModels({
    provider: { id: "openai", protocol: "responses", baseUrl: "https://api.openai.com/v1" },
    key: "private",
    fetchImpl: async (url, init) => {
      urls.push({ url: String(url), init });
      return urls.length === 1
        ? jsonResponse({ data: [{ id: "gpt-5.4" }], has_more: true, last_id: "gpt-5.4" })
        : jsonResponse({ data: [{ id: "gpt-5.4-mini" }], has_more: false });
    },
  });
  assert.deepEqual(models.map(model => model.id), ["gpt-5.4", "gpt-5.4-mini"]);
  assert.equal(new URL(urls[0].url).searchParams.get("key"), null);
  assert.equal(urls[1].url, "https://api.openai.com/v1/models?after=gpt-5.4");
  assert.equal(urls[0].init.headers.authorization, "Bearer private");
});

test("custom compatible API uses a verified protocol pack against a real localhost endpoint", async t => {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "local-model" }] }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end([
          'data: {"choices":[{"delta":{"content":"localhost answer"}}]}\n\n',
          'data: {"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6},"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ].join(""));
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const provider = {
    schemaVersion: 1, id: "custom-local", name: "Local compatible server", custom: true,
    protocol: "chat", baseUrl: `http://127.0.0.1:${address.port}/v1`, models: [],
  };
  const key = "local-test-key";
  const discovered = await listModels({ provider, key });
  assert.deepEqual(discovered, [{ id: "local-model", effortsReported: false }]);
  const result = await runApi({ provider, key, model: discovered[0].id, prompt: { user: "Say hello" } });
  assert.equal(result.text, "localhost answer");
  assert.deepEqual(result.usage, { inputTokens: 4, uncachedInputTokens: 4, outputTokens: 2, totalTokens: 6 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].authorization, `Bearer ${key}`);
  assert.equal(requests[1].authorization, `Bearer ${key}`);
  assert.equal(requests[1].url, "/v1/chat/completions");
  assert.equal(JSON.parse(requests[1].body).model, "local-model");
  await assert.rejects(runApi({
    provider: { ...provider, baseUrl: "http://example.com/v1" }, key, model: "local-model", prompt: { user: "No remote plain HTTP" },
  }), /adapter could not build the API request/);
});

test("output and transport limits reject oversized streams", async () => {
  const provider = { id: "openai", protocol: "responses", baseUrl: "https://api.openai.com/v1" };
  const request = { provider, key: "private", model: "gpt-5.4", prompt: { user: "u" } };
  const textDelta = value => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: value })}\n\n`;
  await assert.rejects(runApi({
    ...request,
    fetchImpl: async () => sseResponse(textDelta("x".repeat(600_000)) + textDelta("y".repeat(500_000)), { chunkSize: 64 * 1024 }),
  }), /output size limit/);

  const oversizedTransport = Array.from({ length: 4 }, () => `:${"x".repeat(600_000)}\n\n`).join("");
  await assert.rejects(runApi({
    ...request,
    fetchImpl: async () => sseResponse(oversizedTransport, { chunkSize: 64 * 1024 }),
  }), /response exceeded the size limit/);
});

test("model discovery caps the total number of returned models", async () => {
  const data = Array.from({ length: 1001 }, (_, index) => ({ id: `model-${index}` }));
  const models = await listModels({
    provider: { id: "openai", protocol: "chat", baseUrl: "https://api.x.ai/v1" },
    key: "private",
    fetchImpl: async () => jsonResponse({ data, has_more: true, last_id: "model-1000" }),
  });
  assert.equal(models.length, 1000);
  assert.equal(models[999].id, "model-999");
});

test("xAI model discovery prefers official pricing metadata and falls back on HTTP 404", async () => {
  const urls = [];
  const models = await listModels({
    provider: { id: "xai", protocol: "chat", baseUrl: "https://api.x.ai/v1" },
    key: "private",
    fetchImpl: async url => {
      urls.push(String(url));
      return jsonResponse({ models: [{
        id: "grok-enterprise", prompt_text_token_price: 20_000,
        cached_prompt_text_token_price: 5_000, completion_text_token_price: 60_000,
      }] });
    },
  });
  assert.deepEqual(urls, ["https://api.x.ai/v1/language-models"]);
  assert.equal(models[0].pricing.inputPerMillion, 2);
  assert.equal(models[0].pricing.cachedInputPerMillion, 0.5);
  assert.equal(models[0].pricing.outputPerMillion, 6);

  const fallbackUrls = [];
  const fallbackModels = await listModels({
    provider: { id: "xai", protocol: "chat", baseUrl: "https://api.x.ai/v1" },
    key: "private",
    fetchImpl: async url => {
      fallbackUrls.push(String(url));
      return fallbackUrls.length === 1 ? new Response("", { status: 404 }) : jsonResponse({ data: [{ id: "grok-4.7" }] });
    },
  });
  assert.deepEqual(fallbackUrls, ["https://api.x.ai/v1/language-models", "https://api.x.ai/v1/models"]);
  assert.deepEqual(fallbackModels, [{ id: "grok-4.7", effortsReported: false }]);
});

test("cancelled calls do not fetch and oversized prompts fail before fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let fetches = 0;
  const input = {
    provider: { id: "openai", protocol: "responses", baseUrl: "https://api.openai.com/v1" },
    key: "private", model: "gpt-5.4", prompt: { user: "u" }, signal: controller.signal,
    fetchImpl: async () => { fetches++; throw new Error("must not fetch"); },
  };
  await assert.rejects(runApi(input), /cancelled/);
  assert.equal(fetches, 0);
  assert.throws(() => buildApiRequest({ ...input, signal: undefined, prompt: { user: "x".repeat(2 * 1024 * 1024) } }), /too large/);
});
