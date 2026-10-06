"use strict";

const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const crypto = require("node:crypto");
const path = require("node:path");

const PROVIDERS = new Set(["openai", "anthropic", "xai", "google", "deepseek", "moonshot"]);
const AUTH_KINDS = new Set(["browser", "device", "api-key", "terminal"]);
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_PROGRESS_TEXT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 15 * 1000;
const CANCEL_GRACE_MS = 5 * 1000;
const SAFE_SYSCALL_CODES = new Set(["ENOENT", "EACCES", "EPERM", "EBUSY", "EIO", "ETIMEDOUT"]);
const KEY_URL_HOSTS = Object.freeze({
  openai: ["platform.openai.com"],
  anthropic: ["platform.claude.com"],
  xai: ["console.x.ai"],
  google: ["aistudio.google.com"],
  deepseek: ["platform.deepseek.com"],
  moonshot: ["platform.kimi.ai"],
});
const SAFE_OAUTH_QUERY = new Set([
  "audience", "client_id", "code_challenge", "code_challenge_method", "nonce",
  "prompt", "redirect_uri", "resource", "response_mode", "response_type", "scope", "state",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function providerId(value) {
  if (typeof value !== "string" || !PROVIDERS.has(value)) throw new Error("Unknown AI login provider.");
  return value;
}

function safeText(value, maxLength = 320) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b[A-Fa-f0-9]{48,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function checkedAuthHosts(value) {
  if (!Array.isArray(value) || value.length > 24) throw new Error("The adapter sign-in host list is invalid.");
  const hosts = [...new Set(value.map(host => {
    if (typeof host !== "string" || host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host)) {
      throw new Error("The adapter sign-in host list is invalid.");
    }
    return host.toLowerCase();
  }))];
  return hosts;
}

function checkedUrl(value, hosts, label = "Sign-in URL") {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !hosts.includes(url.hostname.toLowerCase())) return null;
  let queryCount = 0;
  for (const [key, item] of url.searchParams) {
    if (++queryCount > 16 || !SAFE_OAUTH_QUERY.has(key.toLowerCase()) || item.length > 2048) return null;
  }
  return url.href;
}

function checkedKeyUrl(value, provider) {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !KEY_URL_HOSTS[provider]?.includes(url.hostname.toLowerCase())) return null;
  return url.href;
}

function checkedArgs(value, label, { required = false } = {}) {
  if (!Array.isArray(value) || value.length > 64 || (required && !value.length) || value.some(arg =>
    typeof arg !== "string" || arg.length > 256 || /[\u0000-\u001f\u007f]/.test(arg))) {
    throw new Error(`The adapter ${label} are invalid.`);
  }
  return [...value];
}

function getAuthDescriptor(descriptor) {
  if (isPlainObject(descriptor?.cli?.auth)) return descriptor.cli.auth;
  if (isPlainObject(descriptor?.auth)) return descriptor.auth;
  if (isPlainObject(descriptor)) return descriptor;
  throw new Error("The adapter sign-in descriptor is unavailable.");
}

function validateAuth(provider, descriptor) {
  const auth = getAuthDescriptor(descriptor);
  if (!AUTH_KINDS.has(auth.kind)) throw new Error("The adapter sign-in method is unsupported.");
  const hosts = checkedAuthHosts(auth.authHosts || []);
  const loginArgs = checkedArgs(auth.loginArgs || [], "sign-in arguments", { required: auth.kind === "browser" || auth.kind === "device" });
  const statusArgs = auth.statusArgs === undefined ? null : checkedArgs(auth.statusArgs, "sign-in status arguments", { required: true });
  if (statusArgs && typeof auth.parseStatus !== "function") throw new Error("The adapter sign-in status parser is unavailable.");
  if (statusArgs && auth.kind === "api-key") throw new Error("The API key sign-in method cannot run CLI status commands.");
  if (auth.parseStatus !== undefined && typeof auth.parseStatus !== "function") throw new Error("The adapter sign-in status parser is invalid.");
  if (auth.parseProgress !== undefined && typeof auth.parseProgress !== "function") throw new Error("The adapter sign-in progress parser is invalid.");
  if (auth.kind === "terminal" && (provider !== "google" || auth.requiresTty !== true)) throw new Error("Interactive terminal sign-in is not enabled for this provider.");
  if (auth.kind !== "terminal" && auth.requiresTty === true) throw new Error("This sign-in method requires an unsupported terminal.");
  if (auth.kind === "api-key" && !auth.keyUrl) throw new Error("The adapter API key page is unavailable.");
  const keyUrl = auth.keyUrl ? checkedKeyUrl(auth.keyUrl, provider) : null;
  if (auth.keyUrl && !keyUrl) throw new Error("The adapter API key URL is not trusted.");
  const instructions = safeText(auth.instructions, 320);
  return { auth, kind: auth.kind, authHosts: hosts, loginArgs, statusArgs, keyUrl, instructions };
}

function encodePowerShellCommand(executable, args) {
  const quote = value => `'${String(value).replace(/'/g, "''")}'`;
  const command = `& ${[executable, ...args].map(quote).join(" ")}; exit $LASTEXITCODE`;
  return Buffer.from(command, "utf16le").toString("base64");
}

function safeFailure(error, phase) {
  if (phase === "timeout") return "Sign-in timed out. You can start again.";
  if (phase === "output-limit") return "The sign-in command produced too much output.";
  if (phase === "output-error") return "The CLI sign-in output could not be read.";
  const code = SAFE_SYSCALL_CODES.has(error?.code) ? error.code : "";
  return `Could not complete CLI sign-in${code ? ` (${code})` : ""}.`;
}

class LoginManager {
  constructor({ spawnImpl = spawn, platform = process.platform, openExternal = async () => {}, onChange = () => {}, killTreeImpl, timeoutMs = DEFAULT_TIMEOUT_MS, cancelGraceMs = CANCEL_GRACE_MS } = {}) {
    if (typeof spawnImpl !== "function" || typeof openExternal !== "function" || typeof onChange !== "function") throw new Error("LoginManager requires valid process and notification functions.");
    this.spawnImpl = spawnImpl;
    this.platform = platform;
    this.openExternal = openExternal;
    this.onChange = onChange;
    this.killTreeImpl = killTreeImpl;
    this.timeoutMs = Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(timeoutMs, 30 * 60 * 1000)) : DEFAULT_TIMEOUT_MS;
    this.cancelGraceMs = Number.isFinite(cancelGraceMs) ? Math.max(100, Math.min(cancelGraceMs, 30_000)) : CANCEL_GRACE_MS;
    this.states = new Map();
    this.attempts = new Map();
    this.activeExecutables = new Map();
  }

  snapshot(id) {
    providerId(id);
    const current = this.states.get(id);
    if (current) return { ...current };
    return {
      providerId: id, supported: false, kind: null, status: "idle",
      message: "Sign-in has not been started.", error: null, instructions: "", keyUrl: null,
      url: null, code: null, method: null, terminalClosed: false, startedAt: null, id: null,
    };
  }

  _setState(attempt, patch) {
    attempt.state = { ...attempt.state, ...patch };
    this.states.set(attempt.providerId, attempt.state);
    try { this.onChange(this.snapshot(attempt.providerId)); } catch {}
  }

  async start({ providerId: provider, descriptor, executable, env, cwd, timeoutMs, onExit, signal } = {}) {
    provider = providerId(provider);
    const validated = validateAuth(provider, descriptor);
    if ((validated.kind !== "api-key" || validated.statusArgs) && (typeof executable !== "string" || !path.isAbsolute(executable) || !/\.exe$/i.test(executable))) throw new Error("A verified CLI executable is required for sign-in.");
    if (cwd !== undefined && (typeof cwd !== "string" || !path.isAbsolute(cwd))) throw new Error("The CLI sign-in directory is invalid.");
    if (env !== undefined && (!isPlainObject(env) || Object.entries(env).some(([key, value]) => key.length === 0 || /[=\0]/.test(key) || typeof value !== "string" || /\0/.test(value)))) throw new Error("The CLI sign-in environment is invalid.");
    if (onExit !== undefined && typeof onExit !== "function") throw new Error("The sign-in completion callback is invalid.");
    if (signal !== undefined && (!signal || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) throw new Error("The sign-in cancellation signal is invalid.");
    const active = this.attempts.get(provider);
    if (active && !active.finalized) return { id: active.id, state: this.snapshot(provider) };

    const executionKey = validated.kind === "api-key" ? null : this.platform === "win32" ? path.resolve(executable).toLowerCase() : path.resolve(executable);
    const owner = this.activeExecutables.get(executionKey);
    if (owner && !owner.finalized) throw new Error("This CLI already has a sign-in in progress.");
    const startedAt = new Date().toISOString();
    const state = {
      id: crypto.randomUUID(), providerId: provider, supported: true, kind: validated.kind,
      status: "starting", message: validated.instructions || "Starting CLI sign-in…", error: null,
      instructions: validated.instructions, keyUrl: validated.keyUrl, url: null, code: null, method: null,
      terminalClosed: false, startedAt,
    };
    let doneResolve;
    const attempt = {
      id: state.id, providerId: provider, executable, executionKey, env, cwd,
      auth: validated.auth, kind: validated.kind, authHosts: validated.authHosts,
      loginArgs: validated.loginArgs, statusArgs: validated.statusArgs, keyUrl: validated.keyUrl,
      onExit, state, finalized: false, phase: "login", child: null, timer: null, stopTimer: null,
      timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(timeoutMs, 30 * 60 * 1000)) : this.timeoutMs,
      stopStatus: null, outputBytes: 0, stdout: "", stderr: "", decoders: null,
      signal, onAbort: null,
      done: new Promise(resolve => { doneResolve = resolve; }), doneResolve,
    };
    this.attempts.set(provider, attempt);
    if (executionKey) this.activeExecutables.set(executionKey, attempt);
    this._setState(attempt, {});

    if (signal?.aborted) {
      this._setState(attempt, { status: "canceled", message: "Sign-in canceled." });
      void this._finish(attempt, "canceled");
      return { id: attempt.id, state: this.snapshot(provider) };
    }
    if (signal) {
      attempt.onAbort = () => this._requestStop(attempt, "canceled", "cancel");
      signal.addEventListener("abort", attempt.onAbort, { once: true });
    }

    if (validated.kind === "api-key") {
      this._setState(attempt, { status: "waiting", message: validated.instructions || "Open the official API console and add its key in settings." });
      void this._finish(attempt, "waiting");
      return { id: attempt.id, state: this.snapshot(provider) };
    }
    if (validated.statusArgs) {
      this._setState(attempt, { status: "verifying", message: "Checking for an existing CLI sign-in…" });
      this._startPiped(attempt, validated.statusArgs, { phase: "precheck", timeoutMs: VERIFY_TIMEOUT_MS });
    } else if (validated.kind === "terminal") {
      if (this.platform !== "win32") {
        this._setState(attempt, { supported: false, status: "failed", error: "Interactive sign-in windows are supported on Windows only." });
        void this._finish(attempt, "failed");
        return { id: attempt.id, state: this.snapshot(provider) };
      }
      this._startTerminal(attempt, timeoutMs);
    } else {
      this._startPiped(attempt, validated.loginArgs, { timeoutMs, phase: "login" });
    }
    return { id: attempt.id, state: this.snapshot(provider) };
  }

  _startTerminal(attempt, requestedTimeout) {
    const candidateRoot = attempt.env?.SystemRoot || process.env.SystemRoot || "C:\\Windows";
    const systemRoot = path.isAbsolute(candidateRoot) ? candidateRoot : "C:\\Windows";
    const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const encoded = encodePowerShellCommand(attempt.executable, attempt.loginArgs);
    const timeout = Number.isFinite(requestedTimeout) ? Math.max(1000, Math.min(requestedTimeout, 30 * 60 * 1000)) : this.timeoutMs;
    try {
      const child = this.spawnImpl(powershell, ["-NoProfile", "-EncodedCommand", encoded], {
        shell: false, windowsHide: false, detached: false, stdio: "ignore",
        env: attempt.env === undefined ? process.env : attempt.env,
        ...(attempt.cwd ? { cwd: attempt.cwd } : {}),
      });
      this._attach(attempt, child, { captureOutput: false, timeout, phase: "terminal" });
      this._setState(attempt, { status: "waiting", message: attempt.state.instructions || "Sign in in the official CLI window, then verify by loading models." });
    } catch (error) {
      this._setState(attempt, { status: "failed", error: safeFailure(error, "spawn") });
      void this._finish(attempt, "failed");
    }
  }

  _startPiped(attempt, args, { timeoutMs, phase }) {
    const timeout = phase === "verify" ? VERIFY_TIMEOUT_MS : Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(timeoutMs, 30 * 60 * 1000)) : this.timeoutMs;
    let child;
    try {
      child = this.spawnImpl(attempt.executable, args, {
        shell: false, windowsHide: true, detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: attempt.env === undefined ? process.env : attempt.env,
        ...(attempt.cwd ? { cwd: attempt.cwd } : {}),
      });
    } catch (error) {
      this._setState(attempt, { status: "failed", error: safeFailure(error, "spawn") });
      void this._finish(attempt, "failed");
      return;
    }
    this._attach(attempt, child, { captureOutput: true, timeout, phase });
    const message = phase === "precheck" ? "Checking for an existing CLI sign-in…" : phase === "verify" ? "Checking sign-in status…" : attempt.state.instructions || "Waiting for CLI sign-in…";
    this._setState(attempt, { status: phase === "precheck" || phase === "verify" ? "verifying" : "waiting", message });
  }

  _attach(attempt, child, { captureOutput, timeout, phase }) {
    attempt.child = child;
    attempt.phase = phase;
    attempt.outputBytes = 0;
    attempt.stdout = "";
    attempt.stderr = "";
    attempt.decoders = captureOutput ? { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") } : null;
    attempt.timer = setTimeout(() => this._requestStop(attempt, "failed", "timeout"), timeout);
    child.once("error", error => {
      if (attempt.finalized) return;
      this._setState(attempt, { status: "failed", error: safeFailure(error, "spawn"), url: null, code: null });
      void this._finish(attempt, "failed");
    });
    if (captureOutput) {
      child.stdout?.on("data", chunk => this._onOutput(attempt, "stdout", chunk));
      child.stderr?.on("data", chunk => this._onOutput(attempt, "stderr", chunk));
      child.stdout?.on("error", error => this._outputError(attempt, error));
      child.stderr?.on("error", error => this._outputError(attempt, error));
    }
    child.once("close", (code, signal) => void this._onClose(attempt, code, signal));
  }

  _onOutput(attempt, channel, chunk) {
    if (attempt.finalized || attempt.stopStatus || !attempt.decoders) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    attempt.outputBytes += bytes.length;
    if (attempt.outputBytes > MAX_OUTPUT_BYTES) {
      this._requestStop(attempt, "failed", "output-limit");
      return;
    }
    const value = attempt.decoders[channel].write(bytes);
    attempt[channel] = (attempt[channel] + value).slice(-MAX_PROGRESS_TEXT);
    if (attempt.phase !== "login" || typeof attempt.auth.parseProgress !== "function") return;
    let parsed;
    try {
      parsed = attempt.auth.parseProgress({ text: safeText(`${attempt.stdout}\n${attempt.stderr}`, MAX_PROGRESS_TEXT) });
    } catch { return; }
    if (!isPlainObject(parsed)) return;
    const url = parsed.url ? checkedUrl(parsed.url, attempt.authHosts) : null;
    const code = typeof parsed.code === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{2,23}$/.test(parsed.code) ? parsed.code : null;
    const message = safeText(parsed.message);
    if (!url && !code && !message) return;
    this._setState(attempt, {
      status: "waiting", message: message || attempt.state.message,
      ...(url ? { url } : {}), ...(code ? { code } : {}),
    });
  }

  _outputError(attempt) {
    if (attempt.finalized) return;
    this._setState(attempt, { status: "failed", error: "The CLI sign-in output could not be read.", url: null, code: null });
    this._requestStop(attempt, "failed", "output-error");
  }

  async _onClose(attempt, code, exitSignal) {
    if (attempt.finalized) return;
    this._flushOutput(attempt);
    clearTimeout(attempt.timer);
    attempt.timer = null;
    if (attempt.stopStatus) {
      await this._finish(attempt, attempt.stopStatus);
      return;
    }
    if (attempt.phase === "precheck") {
      if (exitSignal) {
        this._setState(attempt, { status: "failed", message: "Existing CLI sign-in status could not be checked.", error: "Existing CLI sign-in status could not be checked.", url: null, code: null });
        await this._finish(attempt, "failed");
        return;
      }
      const existing = this._parseStatus(attempt, code);
      if (existing?.authenticated && code === 0) {
        this._setState(attempt, { status: "succeeded", message: "Existing CLI sign-in verified.", method: existing.method || attempt.kind, error: null, url: null, code: null });
        await this._finish(attempt, "succeeded");
      } else if (existing?.authenticated === false && attempt.kind === "terminal") {
        this._startTerminal(attempt, attempt.timeoutMs);
      } else if (existing?.authenticated === false) {
        this._startPiped(attempt, attempt.loginArgs, { phase: "login", timeoutMs: attempt.timeoutMs });
      } else {
        this._setState(attempt, { status: "failed", error: "Existing CLI sign-in status could not be checked.", url: null, code: null });
        await this._finish(attempt, "failed");
      }
      return;
    }
    if (attempt.phase === "verify") {
      const verified = !exitSignal && code === 0 ? this._parseStatus(attempt, code) : null;
      await this._applyStatusResult(attempt, verified);
      return;
    }
    if (exitSignal || code !== 0) {
      this._setState(attempt, { status: "failed", message: "CLI sign-in did not complete.", error: "CLI sign-in did not complete.", url: null, code: null });
      await this._finish(attempt, "failed");
      return;
    }
    if (attempt.phase === "terminal") {
      this._setState(attempt, { status: "waiting", terminalClosed: true, url: null, code: null, message: "The CLI window closed. Verify sign-in by loading models." });
      await this._finish(attempt, "waiting");
      return;
    }
    if (attempt.phase === "login" && attempt.statusArgs) {
      this._setState(attempt, { status: "verifying", message: "Checking sign-in status…", url: null, code: null });
      this._startPiped(attempt, attempt.statusArgs, { phase: "verify", timeoutMs: VERIFY_TIMEOUT_MS });
      return;
    }
    if (typeof attempt.auth.parseStatus === "function") {
      const result = this._parseStatus(attempt, code);
      await this._applyStatusResult(attempt, result);
      return;
    }
    if (attempt.kind === "browser" || attempt.kind === "device") {
      this._setState(attempt, { status: "succeeded", message: "CLI sign-in completed.", method: attempt.kind, error: null, url: null, code: null });
      await this._finish(attempt, "succeeded");
      return;
    }
    this._setState(attempt, { status: "failed", error: "The CLI did not verify this sign-in method.", url: null, code: null });
    await this._finish(attempt, "failed");
  }

  _flushOutput(attempt) {
    if (!attempt.decoders) return;
    for (const channel of ["stdout", "stderr"]) attempt[channel] = (attempt[channel] + attempt.decoders[channel].end()).slice(-MAX_PROGRESS_TEXT);
    attempt.decoders = null;
  }

  _parseStatus(attempt, exitCode) {
    try {
      const parsed = attempt.auth.parseStatus({ stdout: safeText(attempt.stdout, MAX_OUTPUT_BYTES), stderr: safeText(attempt.stderr, MAX_OUTPUT_BYTES), exitCode });
      if (!isPlainObject(parsed) || typeof parsed.authenticated !== "boolean") return null;
      return { authenticated: parsed.authenticated, method: safeText(parsed.method, 80) || null };
    } catch { return null; }
  }

  async _applyStatusResult(attempt, parsed) {
    if (parsed?.authenticated === true) {
      this._setState(attempt, { status: "succeeded", message: "CLI sign-in verified.", method: parsed.method || attempt.kind, error: null, url: null, code: null });
      await this._finish(attempt, "succeeded");
    } else {
      this._setState(attempt, { status: "failed", message: "The CLI did not confirm an authenticated session.", error: "The CLI did not confirm an authenticated session.", url: null, code: null });
      await this._finish(attempt, "failed");
    }
  }

  _requestStop(attempt, status, reason) {
    if (attempt.finalized || attempt.stopStatus) return;
    attempt.stopStatus = status;
    clearTimeout(attempt.timer);
    attempt.timer = null;
    const state = status === "canceled"
      ? { status, message: "Sign-in canceled.", error: null, url: null, code: null }
      : { status, message: safeFailure(null, reason), error: safeFailure(null, reason), url: null, code: null };
    this._setState(attempt, state);
    attempt.stopTimer = setTimeout(() => void this._finish(attempt, status), this.cancelGraceMs);
    this._terminate(attempt);
  }

  _terminate(attempt) {
    const child = attempt.child;
    if (!child) return;
    const injected = this.spawnImpl !== spawn;
    if (this.platform === "win32" && Number.isInteger(child.pid) && child.pid > 0 && (!injected || this.killTreeImpl)) {
      const systemRoot = attempt.env?.SystemRoot || process.env.SystemRoot || "C:\\Windows";
      const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
      try { (this.killTreeImpl || spawn)(taskkill, ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" }); } catch {}
    }
    try { child.kill(); } catch {}
    try { child.stdin?.destroy(); } catch {}
  }

  async _finish(attempt, status) {
    if (attempt.finishPromise) return attempt.finishPromise;
    if (attempt.finalized) return attempt.done;
    attempt.finalized = true;
    clearTimeout(attempt.timer);
    clearTimeout(attempt.stopTimer);
    attempt.signal?.removeEventListener?.("abort", attempt.onAbort);
    attempt.timer = null;
    attempt.stopTimer = null;
    attempt.stdout = "";
    attempt.stderr = "";
    attempt.decoders = null;
    if (this.activeExecutables.get(attempt.executionKey) === attempt) this.activeExecutables.delete(attempt.executionKey);
    attempt.finishPromise = (async () => {
      try { await attempt.onExit?.({ providerId: attempt.providerId, id: attempt.id, status }); } catch {}
      attempt.doneResolve(this.snapshot(attempt.providerId));
      return this.snapshot(attempt.providerId);
    })();
    await attempt.finishPromise;
    return attempt.done;
  }

  async cancel(id) {
    providerId(id);
    const attempt = this.attempts.get(id);
    if (!attempt) return this.snapshot(id);
    if (attempt.finalized) {
      if (attempt.state.status === "waiting" && attempt.kind === "api-key") {
        this._setState(attempt, { status: "canceled", message: "Sign-in canceled.", url: null, code: null });
      }
      return this.snapshot(id);
    }
    this._requestStop(attempt, "canceled", "cancel");
    let waitTimer;
    const deadline = new Promise(resolve => {
      waitTimer = setTimeout(resolve, this.cancelGraceMs + 100);
      waitTimer.unref?.();
    });
    await Promise.race([attempt.done, deadline]);
    clearTimeout(waitTimer);
    if (!attempt.finalized) await this._finish(attempt, "canceled");
    return this.snapshot(id);
  }

  async openBrowser(id, { mode, descriptor } = {}) {
    providerId(id);
    let url = null;
    if (mode === "api") {
      const auth = validateAuth(id, descriptor);
      url = auth.keyUrl;
    } else {
      const attempt = this.attempts.get(id);
      if (!attempt || attempt.state.providerId !== id) throw new Error("There is no active sign-in page to open.");
      url = checkedUrl(attempt.state.url, attempt.authHosts);
    }
    if (!url) throw new Error("No approved sign-in page is available.");
    try { await this.openExternal(url); }
    catch { throw new Error("The approved sign-in page could not be opened."); }
    return { opened: true };
  }

  async shutdown() {
    const active = [...this.attempts.entries()].filter(([, attempt]) => !attempt.finalized).map(([id]) => this.cancel(id));
    await Promise.allSettled(active);
  }
}

module.exports = { LoginManager, checkedUrl, validateAuth, encodePowerShellCommand };
