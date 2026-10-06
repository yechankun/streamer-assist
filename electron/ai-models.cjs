"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");
const { spawn } = require("node:child_process");

const MAX_OUTPUT = 256 * 1024;
const MAX_LINE = 64 * 1024;
const MAX_MODELS = 500;
const DEFAULT_TIMEOUT_MS = 15_000;
function validModelId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value);
}

function safeText(value, max = 160) {
  return typeof value === "string" && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : undefined;
}

function effortId(value) {
  if (typeof value === "string") return /^[a-z][a-z0-9_-]{0,31}$/i.test(value) ? value.toLowerCase() : null;
  if (value && typeof value === "object") return effortId(value.reasoningEffort ?? value.id ?? value.value ?? value.effort);
  return null;
}

function normalizeRows(rawRows) {
  if (!Array.isArray(rawRows)) throw new Error("The CLI returned no model list.");
  const result = [];
  const seen = new Set();
  for (const raw of rawRows.slice(0, MAX_MODELS + 1)) {
    const item = typeof raw === "string" ? { id: raw } : raw;
    if (!item || typeof item !== "object") continue;
    const id = item.id ?? item.model ?? item.modelId ?? item.value ?? item.slug;
    if (!validModelId(id) || seen.has(id)) continue;
    seen.add(id);
    const row = { id };
    const name = safeText(item.name ?? item.displayName ?? item.display_name, 120);
    if (name) row.name = name;
    const candidates = item.efforts ?? item.supportedReasoningEfforts ?? item.supportedEffortLevels ?? item.reasoningEfforts ?? item.reasoning_efforts;
    row.effortsReported = typeof item.effortsReported === "boolean" ? item.effortsReported : Array.isArray(candidates);
    if (Array.isArray(candidates)) {
      row.efforts = [...new Set(candidates.map(effortId).filter(Boolean))].slice(0, 20);
    } else {
      row.efforts = [];
    }
    if (typeof item.supportsEffort === "boolean") row.supportsEffort = item.supportsEffort;
    const defaultEffort = effortId(item.defaultEffort ?? item.defaultReasoningEffort ?? item.default_effort);
    if (defaultEffort) row.defaultEffort = defaultEffort;
    result.push(row);
    if (result.length > MAX_MODELS) throw new Error("The CLI returned too many models.");
  }
  if (!result.length) throw new Error("The CLI returned no usable model IDs.");
  return result;
}

function asError(message) { return message instanceof Error ? message : new Error(String(message)); }

function terminate(child, injected, platform, killTreeImpl) {
  if (!child || child.killed) return;
  if (platform === "win32" && Number.isInteger(child.pid) && child.pid > 0 && (!injected || killTreeImpl)) {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
    try { (killTreeImpl || spawn)(taskkill, ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" }); } catch {}
  }
  try { child.kill(); } catch {}
  try { child.stdin?.destroy(); } catch {}
}

function childProcess({ executable, args, signal, timeoutMs, env, cwd, spawnImpl, protocol, initialMessage, platform = process.platform, killTreeImpl }) {
  const run = spawnImpl || spawn;
  const injected = Boolean(spawnImpl && spawnImpl !== spawn);
  const timeout = Number.isFinite(timeoutMs) ? Math.max(250, Math.min(timeoutMs, 60_000)) : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let byteCount = 0;
    const decoder = new StringDecoder("utf8");
    let pending = "";
    const output = [];
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const succeed = value => {
      if (settled) return;
      settled = true;
      cleanup();
      if (protocol) terminate(child, injected, platform, killTreeImpl);
      resolve(value);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      terminate(child, injected, platform, killTreeImpl);
      reject(asError(error));
    };
    const onAbort = () => fail(new Error("Model discovery was cancelled."));

    if (signal?.aborted) return onAbort();
    try {
      child = run(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
        env: env === undefined ? process.env : env,
        ...(cwd ? { cwd } : {}),
      });
    } catch (error) {
      return fail(new Error(`Could not start the ${protocol || "CLI"} model query.`));
    }

    timer = setTimeout(() => fail(new Error("Model discovery timed out.")), timeout);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", () => fail(new Error("The installed CLI could not be started.")));
    child.stdout.on("error", () => fail(new Error("The installed CLI output could not be read.")));
    child.stderr?.on("error", () => {});
    child.stdout.on("data", chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      byteCount += bytes;
      if (byteCount > MAX_OUTPUT) return fail(new Error("The CLI model response exceeded the size limit."));
      if (!protocol) { output.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return; }
      pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      if (pending.length > MAX_LINE && !pending.includes("\n")) return fail(new Error("The CLI model response contains an oversized line."));
      while (true) {
        const at = pending.indexOf("\n");
        if (at < 0) break;
        const line = pending.slice(0, at).replace(/\r$/, "");
        pending = pending.slice(at + 1);
        if (line.length > MAX_LINE) return fail(new Error("The CLI model response contains an oversized line."));
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); }
        catch { return fail(new Error("The CLI returned an invalid protocol response.")); }
        try { protocol({ message, send, succeed, fail }); }
        catch (error) { fail(error); }
        if (settled) return;
      }
    });
    child.once("close", (code, exitSignal) => {
      if (settled) return;
      if (protocol && pending.trim()) {
        fail(new Error("The CLI returned an incomplete protocol response."));
        return;
      }
      if (code !== 0 || exitSignal) {
        fail(new Error("The installed CLI could not list models."));
        return;
      }
      try { succeed(Buffer.concat(output).toString("utf8")); }
      catch (error) { fail(error); }
    });
    child.stdin.on("error", () => fail(new Error("The CLI model query could not be sent.")));

    function send(value) {
      if (settled || child.stdin.destroyed) throw new Error("The CLI protocol connection closed.");
      child.stdin.write(`${JSON.stringify(value)}\n`);
    }

    if (initialMessage) {
      try { send(initialMessage); } catch (error) { fail(error); }
    } else if (!protocol) child.stdin.end();
  });
}

function protocolRpc({ executable, args, signal, timeoutMs, env, cwd, spawnImpl, initialMessage, platform, killTreeImpl }, onMessage) {
  return childProcess({ executable, args, signal, timeoutMs, env, cwd, spawnImpl, initialMessage, platform, killTreeImpl, protocol: context => onMessage({ ...context }) });
}

function validatedHookRows(value) {
  if (!value || typeof value !== "object") throw new Error("The CLI model adapter returned an invalid model list.");
  const rows = value.models ?? value.rows;
  return { models: normalizeRows(rows), ...(validModelId(value.currentModelId) ? { currentModelId: value.currentModelId } : {}) };
}

function checkedConfigArgs(value, env = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32 || value.some(item => typeof item !== "string" || item.length > 4096 || item.includes("\0") || /[\r\n]/.test(item))) {
    throw new Error("CLI model query arguments are invalid.");
  }
  for (const [name, secret] of Object.entries(env || {})) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)$/i.test(name) && typeof secret === "string" && secret && value.some(argument => argument.includes(secret))) {
      throw new Error("Credential values cannot be passed in CLI arguments.");
    }
  }
  return value;
}

function codexModels(options) {
  const { executable, adapter, signal, timeoutMs, env, cwd, spawnImpl, platform, killTreeImpl } = options;
  const args = [...checkedConfigArgs(options.configArgs, env), "app-server"];
  const models = [];
  const seenCursors = new Set();
  let cursor;
  let stage = "initialize";
  let nextId = 2;
  const query = () => {
    const id = nextId++;
    stage = "list:" + id;
    return { jsonrpc: "2.0", id, method: "model/list", params: { limit: 100, ...(cursor ? { cursor } : {}) } };
  };
  return protocolRpc({ executable, args, signal, timeoutMs, env, cwd, spawnImpl, platform, killTreeImpl,
    initialMessage: { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "streamer_assist", version: "0.1.0" }, capabilities: {} } },
  }, ({ message, send, succeed, fail }) => {
    if (message.error && stage === "initialize") { fail(new Error("The CLI model protocol initialization failed.")); return; }
    if (stage === "initialize" && message.id === 1) {
      if (!message.result) { fail(new Error("The CLI model protocol initialization response was invalid.")); return; }
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
      send(query());
      return;
    }
    if (!stage.startsWith("list:") || message.id !== Number(stage.slice(5))) return;
    let parsed;
    try { parsed = adapter.parseMessage({ message }); }
    catch { fail(new Error("The provider module could not parse its CLI model response.")); return; }
    if (!parsed) { fail(new Error("The CLI model response did not contain model data.")); return; }
    const rows = parsed.rows ?? parsed.models;
    if (!Array.isArray(rows)) { fail(new Error("The provider module returned an invalid model page.")); return; }
    models.push(...rows);
    if (models.length > MAX_MODELS) { fail(new Error("The CLI returned too many models.")); return; }
    const next = parsed.nextCursor;
    if (next !== undefined && next !== null && next !== "") {
      if (typeof next !== "string" || next.length > 512 || seenCursors.has(next) || models.length >= MAX_MODELS) {
        fail(new Error("The CLI returned an invalid model page.")); return;
      }
      seenCursors.add(next);
      cursor = next;
      send(query());
      return;
    }
    try { succeed({ models: normalizeRows(models) }); }
    catch (error) { fail(error); }
  });
}

function structuredModels(options) {
  const { adapter } = options;
  if (typeof adapter?.parseOutput !== "function") throw new Error("The provider module has no CLI model output parser.");
  return childProcess({ ...options, args: checkedConfigArgs(options.configArgs, options.env) })
    .then(output => {
      let parsed;
      try { parsed = adapter.parseOutput({ output }); }
      catch { throw new Error("The provider module could not parse its CLI model output."); }
      return validatedHookRows(parsed);
    });
}

function claudeModels(options) {
  const { executable, adapter, signal, timeoutMs, env, cwd, spawnImpl, platform, killTreeImpl } = options;
  if (typeof adapter?.parseMessage !== "function") throw new Error("The provider module has no CLI model message parser.");
  return protocolRpc({ executable, args: checkedConfigArgs(options.configArgs, env), signal, timeoutMs, env, cwd, spawnImpl, platform, killTreeImpl,
    initialMessage: { type: "control_request", request_id: "model-discovery", request: { subtype: "initialize" } },
  }, ({ message, succeed, fail }) => {
    if (message.type !== "control_response") return;
    let parsed;
    try { parsed = adapter.parseMessage({ message }); }
    catch { fail(new Error("The provider module could not parse its CLI model response.")); return; }
    if (!parsed) return;
    try { succeed(validatedHookRows(parsed)); }
    catch (error) { fail(error); }
  });
}

async function removeModelQueryDirectory(directory) {
  try {
    const stat = await fsp.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(directory) !== os.tmpdir()) return;
    await fsp.rm(directory, { recursive: true, force: true });
  } catch {}
}

async function acpModels(options) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "streamer-cli-models-"));
  try {
    const { executable, adapter, signal, timeoutMs, env, cwd, spawnImpl, platform, killTreeImpl } = options;
    if (typeof adapter?.parseMessage !== "function") throw new Error("The provider module has no CLI model message parser.");
    let stage = "initialize";
    return await protocolRpc({ executable, args: checkedConfigArgs(options.configArgs, env), signal, timeoutMs, env, cwd, spawnImpl, platform, killTreeImpl,
      initialMessage: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientInfo: { name: "streamer_assist", version: "0.1.0" }, capabilities: {} } },
    }, ({ message, send, succeed, fail }) => {
      if (message.error) { fail(new Error("The CLI model protocol request failed.")); return; }
      if (stage === "initialize" && message.id === 1) {
        if (!message.result) { fail(new Error("The CLI model protocol initialization response was invalid.")); return; }
        stage = "session";
        send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: directory, mcpServers: [] } });
        return;
      }
      if (stage === "session" && message.id === 2) {
        let parsed;
        try { parsed = adapter.parseMessage({ message }); }
        catch { fail(new Error("The provider module could not parse its CLI model response.")); return; }
        if (!parsed) { fail(new Error("The CLI model response did not contain model data.")); return; }
        try { succeed(validatedHookRows(parsed)); }
        catch (error) { fail(error); }
      }
    });
  } finally {
    await removeModelQueryDirectory(directory);
  }
}

async function readCliModels(options = {}) {
  const { cliId, executable, signal, adapter } = options;
  const drivers = {
    "codex-app-server": "codex",
    "claude-initialize": "claude",
    "grok-models": "grok",
    "agy-models": "agy",
    "kimi-acp": "kimi",
  };
  if (!adapter || !Object.hasOwn(drivers, adapter.driver) || (cliId && cliId !== drivers[adapter.driver]) ||
      adapter.driver === "codex-app-server" && typeof adapter.parseMessage !== "function" ||
      adapter.driver === "claude-initialize" && typeof adapter.parseMessage !== "function" ||
      ["grok-models", "agy-models"].includes(adapter.driver) && typeof adapter.parseOutput !== "function" ||
      adapter.driver === "kimi-acp" && typeof adapter.parseMessage !== "function") {
    throw new Error("The provider module has no supported CLI model discovery driver.");
  }
  if (typeof executable !== "string" || !path.isAbsolute(executable)) throw new Error("A pinned absolute CLI executable is required.");
  let stat;
  try { stat = fs.lstatSync(executable); } catch { throw new Error("The installed CLI executable is unavailable."); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The installed CLI executable is not a regular file.");
  if (options.cwd !== undefined && (typeof options.cwd !== "string" || !path.isAbsolute(options.cwd))) throw new Error("The CLI query directory must be absolute.");
  if (signal?.aborted) throw new Error("Model discovery was cancelled.");

  let discovered;
  if (adapter.driver === "codex-app-server") discovered = await codexModels(options);
  else if (adapter.driver === "claude-initialize") discovered = await claudeModels(options);
  else if (adapter.driver === "grok-models" || adapter.driver === "agy-models") discovered = await structuredModels(options);
  else discovered = await acpModels(options);
  if (!discovered || !Array.isArray(discovered.models) || !discovered.models.length) throw new Error("The CLI did not provide a usable model catalog.");
  return {
    models: discovered.models,
    ...(validModelId(discovered.currentModelId) ? { currentModelId: discovered.currentModelId } : {}),
    source: "cli",
    queriedAt: new Date().toISOString(),
  };
}

module.exports = { readCliModels };
