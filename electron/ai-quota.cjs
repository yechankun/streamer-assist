"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");

const MAX_STDOUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 3000;
const CODEX_DRIVER = "codex-rate-limits";

function unavailable(source, reason) {
  return { available: false, windows: [], source, updatedAt: Date.now(), reason };
}

function validTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  let milliseconds;
  if (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    milliseconds = number < 1e12 ? number * 1000 : number;
  } else milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= 8.64e15 ? milliseconds : null;
}

function validPercent(value) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number < 0) return null;
  return Math.min(100, number);
}

function sanitizeQuota(value, source = "codex-app-server") {
  if (!value || typeof value !== "object" || !Array.isArray(value.windows)) return null;
  const windows = [];
  for (const row of value.windows.slice(0, 20)) {
    if (!row || typeof row !== "object") continue;
    const usedPercent = validPercent(row.usedPercent);
    if (usedPercent === null) continue;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 80) : "Usage";
    const key = typeof row.key === "string" && row.key.trim() ? row.key.trim().slice(0, 100) : name;
    windows.push({
      name, key, usedPercent, remainingPercent: Math.max(0, 100 - usedPercent),
      resetsAt: validTimestamp(row.resetsAt),
    });
  }
  if (!windows.length) return null;
  return { available: true, windows, source, updatedAt: Date.now() };
}

function checkExecutable(executable) {
  if (typeof executable !== "string" || !path.isAbsolute(executable)) return "A resolved absolute CLI executable is required";
  try {
    const stat = fs.lstatSync(executable);
    if (!stat.isFile() || stat.isSymbolicLink()) return "The resolved CLI executable is unavailable";
  } catch { return "The resolved CLI executable is unavailable"; }
  return null;
}

function readCliQuota({ descriptor, executable, signal, spawnImpl, timeoutMs = DEFAULT_TIMEOUT_MS, platform = process.platform, env = process.env } = {}) {
  const driver = descriptor?.driver;
  if (driver === "unsupported") return Promise.resolve(unavailable("unsupported", "이 CLI는 공식적인 읽기 전용 사용량 조회를 제공하지 않습니다."));
  if (driver === "claude-events") return Promise.resolve(unavailable("claude-events", "Claude 사용량은 분석 중 CLI가 제공한 구조화된 이벤트에서만 읽습니다."));
  if (driver !== CODEX_DRIVER || typeof descriptor?.parseResult !== "function") return Promise.resolve(unavailable("unsupported", "이 CLI 모듈에는 검증된 사용량 조회 방식이 없습니다."));
  if (signal?.aborted) return Promise.resolve(unavailable(CODEX_DRIVER, "사용량 조회가 취소되었습니다."));
  if (typeof spawnImpl !== "function") return Promise.resolve(unavailable(CODEX_DRIVER, "CLI process runner is unavailable."));
  const executableError = checkExecutable(executable);
  if (executableError) return Promise.resolve(unavailable(CODEX_DRIVER, executableError));

  return new Promise(resolve => {
    let child;
    let settled = false;
    let stdoutBytes = 0;
    let lineBuffer = "";
    const decoder = new StringDecoder("utf8");
    let timeout;

    const terminate = () => {
      if (!child) return;
      try { child.stdin?.end?.(); } catch {}
      try { child.kill?.(); } catch {}
      if (platform === "win32" && Number.isInteger(child.pid) && child.pid > 0) {
        const systemRoot = env?.SystemRoot || "C:\\Windows";
        const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
        try { spawnImpl(taskkill, ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" }); } catch {}
      }
    };
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      terminate();
      resolve(value);
    };
    const onAbort = () => finish(unavailable(CODEX_DRIVER, "사용량 조회가 취소되었습니다."));
    const fail = () => finish(unavailable(CODEX_DRIVER, "공식 CLI에서 사용량을 읽지 못했습니다."));
    const send = message => {
      try { child.stdin.write(`${JSON.stringify(message)}\n`); }
      catch { fail(); }
    };
    const onLine = line => {
      if (!line.trim() || settled) return;
      let message;
      try { message = JSON.parse(line); } catch { fail(); return; }
      if (message.id === 1) {
        if (message.error || !message.result) { fail(); return; }
        send({ method: "initialized" });
        send({ id: 2, method: "account/rateLimits/read" });
      } else if (message.id === 2) {
        if (message.error) { fail(); return; }
        let parsed;
        try { parsed = descriptor.parseResult({ result: message.result }); } catch { fail(); return; }
        const quota = sanitizeQuota(parsed);
        if (quota) finish(quota); else fail();
      }
    };
    const onData = chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      stdoutBytes += buffer.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) { fail(); return; }
      lineBuffer += decoder.write(buffer);
      if (lineBuffer.length > MAX_STDOUT_BYTES && !lineBuffer.includes("\n")) { fail(); return; }
      let newline;
      while ((newline = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, newline);
        lineBuffer = lineBuffer.slice(newline + 1);
        onLine(line);
        if (settled) return;
      }
    };

    try { child = spawnImpl(executable, ["app-server"], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env }); }
    catch { fail(); return; }
    timeout = setTimeout(fail, Math.max(250, Math.min(timeoutMs, 30_000)));
    timeout.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", fail);
    child.stdout.on("error", fail);
    child.stdout.on("data", onData);
    child.stdin.on("error", fail);
    child.once("close", (code, exitSignal) => {
      if (settled) return;
      lineBuffer += decoder.end();
      if (lineBuffer.trim()) onLine(lineBuffer);
      if (!settled && (code !== 0 || exitSignal)) fail();
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "streamer_assist", version: "0.1.0" }, capabilities: {} } });
  });
}

module.exports = { readCliQuota, normalizeTimestamp: validTimestamp, normalizePercent: validPercent, sanitizeQuota };
