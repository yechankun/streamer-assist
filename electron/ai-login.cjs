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
  "id_token_add_organizations", "codex_cli_simplified_flow", "originator", "allowed_workspace_id",
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

function parserText(value, maxLength = MAX_PROGRESS_TEXT) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-maxLength);
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
  const logoutKind = auth.logoutKind === undefined ? null : auth.logoutKind;
  if (logoutKind !== null && !["command", "terminal", "api-key", "acp"].includes(logoutKind)) throw new Error("The adapter sign-out method is unsupported.");
  const logoutArgs = auth.logoutArgs === undefined ? null : checkedArgs(auth.logoutArgs, "sign-out arguments", { required: logoutKind === "command" });
  if (logoutKind === "command" && statusArgs && typeof auth.parseStatus !== "function") throw new Error("The adapter sign-out status verifier is unavailable.");
  if (logoutKind === "terminal" && (!(["google", "moonshot"].includes(provider)) || !logoutArgs || typeof auth.logoutInstructions !== "string" || !auth.logoutInstructions.trim())) throw new Error("Interactive sign-out is not enabled for this provider.");
  if (logoutKind === "api-key" && (provider !== "deepseek" || auth.kind !== "api-key" || !logoutArgs || logoutArgs.length)) throw new Error("API key sign-out metadata is invalid.");
  if (logoutKind === "acp" && (provider !== "moonshot" || auth.kind !== "device" || !logoutArgs || logoutArgs.length !== 1 || logoutArgs[0] !== "acp")) throw new Error("ACP sign-out metadata is invalid.");
  if (auth.logoutBeforeLogin !== undefined && typeof auth.logoutBeforeLogin !== "boolean") throw new Error("The adapter sign-out policy is invalid.");
  if (auth.logoutBeforeLogin === true && !["command", "acp"].includes(logoutKind)) throw new Error("Automatic sign-out before login requires an official sign-out protocol.");
  const logoutInstructions = safeText(auth.logoutInstructions, 320);
  const instructions = safeText(auth.instructions, 320);
  return { auth, kind: auth.kind, authHosts: hosts, loginArgs, statusArgs, keyUrl, instructions, logoutKind, logoutArgs, logoutInstructions, logoutBeforeLogin: auth.logoutBeforeLogin === true };
}

function encodePowerShellCommand(executable, args) {
  const quote = value => `'${String(value).replace(/'/g, "''")}'`;
  const command = `$ErrorActionPreference = 'Stop'; $taskCliExitCode = 1; try { & ${[executable, ...args].map(quote).join(" ")}; if ($null -ne $LASTEXITCODE) { $taskCliExitCode = $LASTEXITCODE } } catch { }; exit $taskCliExitCode`;
  return Buffer.from(command, "utf16le").toString("base64");
}

function terminalFailure(attempt, code, signal) {
  const action = attempt.operation === "logout" ? "로그아웃" : "로그인";
  const output = parserText(`${attempt.stderr}\n${attempt.stdout}`, 2048);
  // Launcher diagnostics are classified, never echoed: even an unexpected shell
  // failure must not expose an OAuth URL, token, key, or command argument.
  const reason = /not recognized|cannot find|not found|지정된 파일|인식되지/i.test(output)
    ? "CLI 또는 Windows 콘솔을 실행할 수 없습니다."
    : /not a terminal|requires? (?:a )?(?:tty|terminal)|console input|콘솔 입력/i.test(output)
      ? "CLI에 콘솔 입력이 연결되지 않았습니다."
      : `CLI ${action} 창이 정상적으로 종료되지 않았습니다.`;
  const detail = signal ? "창이 중단되었습니다." : Number.isInteger(code) ? `종료 코드 ${code}.` : "종료 상태를 확인할 수 없습니다.";
  return `${reason} ${detail} 다시 시도해 주세요.`;
}

function safeFailure(error, phase, operation = "login") {
  const action = operation === "logout" ? "Sign-out" : "Sign-in";
  if (phase === "acp-unavailable") return "The Kimi CLI does not advertise sign-out support. Update Kimi Code and try again.";
  if (phase === "acp-protocol") return "The Kimi CLI sign-out request could not be verified.";
  if (phase === "timeout") return `${action} timed out. You can start again.`;
  if (phase === "output-limit") return `The ${operation === "logout" ? "sign-out" : "sign-in"} command produced too much output.`;
  if (phase === "output-error") return `The CLI ${operation === "logout" ? "sign-out" : "sign-in"} output could not be read.`;
  const code = SAFE_SYSCALL_CODES.has(error?.code) ? error.code : "";
  return `Could not complete CLI ${operation === "logout" ? "sign-out" : "sign-in"}${code ? ` (${code})` : ""}.`;
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
      providerId: id, supported: false, kind: null, operation: null, status: "idle",
      message: "Sign-in has not been started.", error: null, instructions: "", keyUrl: null,
      url: null, code: null, method: null, terminalClosed: false, startedAt: null, id: null,
    };
  }

  _setState(attempt, patch) {
    attempt.state = { ...attempt.state, ...patch };
    this.states.set(attempt.providerId, attempt.state);
    try { this.onChange(this.snapshot(attempt.providerId)); } catch {}
  }

  async start({ providerId: provider, descriptor, executable, env, cwd, timeoutMs, onExit, onPhase, signal, operation = "login" } = {}) {
    provider = providerId(provider);
    const validated = validateAuth(provider, descriptor);
    if (operation !== "login" && operation !== "logout") throw new Error("The CLI authentication operation is invalid.");
    if (operation === "logout" && !validated.logoutKind) throw new Error("This provider has no supported CLI sign-out method.");
    if (operation === "logout" && validated.logoutKind === "api-key") throw new Error("API key sign-out is handled by encrypted settings.");
    if ((validated.kind !== "api-key" || validated.statusArgs || operation === "logout") && (typeof executable !== "string" || !path.isAbsolute(executable) || !/\.exe$/i.test(executable))) throw new Error("A verified CLI executable is required for authentication.");
    if (cwd !== undefined && (typeof cwd !== "string" || !path.isAbsolute(cwd))) throw new Error("The CLI sign-in directory is invalid.");
    if (env !== undefined && (!isPlainObject(env) || Object.entries(env).some(([key, value]) => key.length === 0 || /[=\0]/.test(key) || typeof value !== "string" || /\0/.test(value)))) throw new Error("The CLI sign-in environment is invalid.");
    if (onExit !== undefined && typeof onExit !== "function") throw new Error("The sign-in completion callback is invalid.");
    if (onPhase !== undefined && typeof onPhase !== "function") throw new Error("The sign-in phase callback is invalid.");
    if (signal !== undefined && (!signal || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) throw new Error("The sign-in cancellation signal is invalid.");
    const active = this.attempts.get(provider);
    if (active && !active.finalized) {
      if (active.operation !== operation) throw new Error("Another CLI authentication operation is already running for this provider.");
      return { id: active.id, state: this.snapshot(provider) };
    }

    const executionKey = validated.kind === "api-key" ? null : this.platform === "win32" ? path.resolve(executable).toLowerCase() : path.resolve(executable);
    const owner = this.activeExecutables.get(executionKey);
    if (owner && !owner.finalized) throw new Error("This CLI already has a sign-in in progress.");
    const startedAt = new Date().toISOString();
    const state = {
      id: crypto.randomUUID(), providerId: provider, supported: true, kind: validated.kind, operation,
      status: "starting", message: operation === "logout" ? validated.logoutInstructions || "Starting CLI sign-out…" : validated.instructions || "Starting CLI sign-in…", error: null,
      instructions: validated.instructions, keyUrl: validated.keyUrl, url: null, code: null, method: null,
      terminalClosed: false, startedAt,
    };
    let doneResolve;
    const attempt = {
      id: state.id, providerId: provider, executable, executionKey, env, cwd,
      auth: validated.auth, kind: validated.kind, authHosts: validated.authHosts,
      loginArgs: validated.loginArgs, statusArgs: validated.statusArgs, keyUrl: validated.keyUrl,
      operation, logoutKind: validated.logoutKind, logoutArgs: validated.logoutArgs,
      logoutInstructions: validated.logoutInstructions, logoutBeforeLogin: validated.logoutBeforeLogin,
      onExit, onPhase, state, finalized: false, phase: "login", child: null, timer: null, stopTimer: null,
      timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(timeoutMs, 30 * 60 * 1000)) : this.timeoutMs,
      stopStatus: null, outputBytes: 0, stdout: "", stderr: "", decoders: null,
      signal, onAbort: null, phaseNotified: false, phasePromise: null, acpBuffer: "", acpStage: null, acpAcknowledged: false,
      done: new Promise(resolve => { doneResolve = resolve; }), doneResolve,
    };
    this.attempts.set(provider, attempt);
    if (executionKey) this.activeExecutables.set(executionKey, attempt);
    this._setState(attempt, {});

    if (signal?.aborted) {
      this._setState(attempt, { status: "canceled", message: `${operation === "logout" ? "Sign-out" : "Sign-in"} canceled.` });
      void this._finish(attempt, "canceled");
      return { id: attempt.id, state: this.snapshot(provider) };
    }
    if (signal) {
      attempt.onAbort = () => this._requestStop(attempt, "canceled", "cancel");
      signal.addEventListener("abort", attempt.onAbort, { once: true });
    }

    if (validated.kind === "api-key" && operation === "login") {
      this._setState(attempt, { status: "waiting", message: validated.instructions || "Open the official API console and add its key in settings." });
      void this._finish(attempt, "waiting");
      return { id: attempt.id, state: this.snapshot(provider) };
    }
    if (operation === "logout") {
      if (validated.logoutKind === "terminal") {
        if (this.platform !== "win32") {
          this._setState(attempt, { supported: false, status: "failed", error: "Interactive sign-out windows are supported on Windows only." });
          void this._finish(attempt, "failed");
          return { id: attempt.id, state: this.snapshot(provider) };
        }
        this._startTerminal(attempt, timeoutMs, validated.logoutArgs, "terminal-logout");
      } else if (validated.logoutKind === "acp") {
        this._startPiped(attempt, validated.logoutArgs, { timeoutMs, phase: "acp-logout" });
      } else {
        this._startPiped(attempt, validated.logoutArgs, { timeoutMs, phase: "logout" });
      }
    } else if (validated.logoutBeforeLogin) {
      this._setState(attempt, { status: "verifying", message: "Signing out of the existing CLI session before login…" });
      this._startPiped(attempt, validated.logoutArgs, { timeoutMs, phase: validated.logoutKind === "acp" ? "acp-logout" : "logout" });
    } else {
      this._startLogin(attempt, timeoutMs);
    }
    return { id: attempt.id, state: this.snapshot(provider) };
  }

  _startLogin(attempt, requestedTimeout) {
    if (attempt.kind === "terminal") {
      if (this.platform !== "win32") {
        this._setState(attempt, { supported: false, status: "failed", error: "Interactive sign-in windows are supported on Windows only." });
        void this._finish(attempt, "failed");
        return;
      }
      this._startTerminal(attempt, requestedTimeout, attempt.loginArgs, "terminal-login");
    } else {
      this._startPiped(attempt, attempt.loginArgs, { timeoutMs: requestedTimeout, phase: "login" });
    }
  }

  _startTerminal(attempt, requestedTimeout, args, phase) {
    const candidateRoot = attempt.env?.SystemRoot || process.env.SystemRoot || "C:\\Windows";
    const systemRoot = path.isAbsolute(candidateRoot) ? candidateRoot : "C:\\Windows";
    const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const encoded = encodePowerShellCommand(attempt.executable, args);
    const terminalEnv = { ...(attempt.env === undefined ? process.env : attempt.env) };
    const extensionKey = Object.keys(terminalEnv).find(key => key.toUpperCase() === "PATHEXT");
    if (!extensionKey || !terminalEnv[extensionKey]) terminalEnv.PATHEXT = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
    const timeout = Number.isFinite(requestedTimeout) ? Math.max(1000, Math.min(requestedTimeout, 30 * 60 * 1000)) : this.timeoutMs;
    try {
      if (/[&|<>^%"!\r\n]/.test(powershell)) throw new Error("The Windows console executable path is invalid.");
      // Electron has no console. Start-Process creates one with real CONIN/CONOUT
      // handles and PassThru preserves its exit code for the tracked helper.
      const quote = value => `'${String(value).replace(/'/g, "''")}'`;
      const launch = `$ErrorActionPreference = 'Stop'; $taskConsoleExitCode = 1; try { $taskConsole = Start-Process -FilePath ${quote(powershell)} -ArgumentList @('-NoProfile', '-EncodedCommand', '${encoded}') -WindowStyle Normal -PassThru; $taskConsoleHandle = $taskConsole.Handle; $taskConsole.WaitForExit(); if ($null -ne $taskConsole.ExitCode) { $taskConsoleExitCode = $taskConsole.ExitCode } } catch { Write-Output 'CLI console could not be launched.' }; exit $taskConsoleExitCode`;
      const launcherEncoded = Buffer.from(launch, "utf16le").toString("base64");
      const child = this.spawnImpl(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", launcherEncoded], {
        shell: false, windowsHide: true, detached: false, stdio: ["ignore", "pipe", "pipe"],
        env: terminalEnv,
        ...(attempt.cwd ? { cwd: attempt.cwd } : {}),
      });
      this._attach(attempt, child, { captureOutput: true, timeout, phase });
      this._setState(attempt, {
        status: "waiting",
        message: phase === "terminal-logout" ? "공식 CLI 창에서 /logout을 실행한 뒤 창을 닫고 앱에서 완료를 확인하세요." : "공식 CLI 창에서 로그인하세요. 완료 후 창을 닫고 모델 목록을 불러와 연결을 확인하세요.",
      });
    } catch (error) {
      this._setState(attempt, { status: "failed", error: safeFailure(error, "spawn", attempt.operation) });
      void this._finish(attempt, "failed");
    }
  }

  _startPiped(attempt, args, { timeoutMs, phase }) {
    const timeout = ["verify", "logout-verify", "acp-logout"].includes(phase) ? VERIFY_TIMEOUT_MS : Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(timeoutMs, 30 * 60 * 1000)) : this.timeoutMs;
    let child;
    try {
      child = this.spawnImpl(attempt.executable, args, {
        shell: false, windowsHide: true, detached: false,
        stdio: [phase === "acp-logout" ? "pipe" : "ignore", "pipe", "pipe"],
        env: attempt.env === undefined ? process.env : attempt.env,
        ...(attempt.cwd ? { cwd: attempt.cwd } : {}),
      });
    } catch (error) {
      const action = ["acp-logout", "logout", "logout-verify"].includes(phase) ? "logout" : attempt.operation;
      this._setState(attempt, { status: "failed", error: safeFailure(error, "spawn", action) });
      void this._finish(attempt, "failed");
      return;
    }
    this._attach(attempt, child, { captureOutput: true, timeout, phase });
    const messages = {
      logout: attempt.operation === "login" ? "Signing out of the existing CLI session before login…" : attempt.logoutInstructions || "Signing out of the CLI session…",
      "logout-verify": "Verifying that the CLI session is signed out…",
      verify: "Checking sign-in status…",
      login: attempt.state.instructions || "Waiting for CLI sign-in…",
    };
    const message = messages[phase] || attempt.state.message;
    this._setState(attempt, { status: ["logout", "logout-verify", "verify", "acp-logout"].includes(phase) ? "verifying" : "waiting", message });
    if (phase === "acp-logout") {
      attempt.acpBuffer = "";
      attempt.acpStage = "initialize";
      this._sendAcp(attempt, { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
    }
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
      if (attempt.acpAcknowledged) return;
      const action = ["logout", "logout-verify", "acp-logout"].includes(attempt.phase) ? "logout" : attempt.operation;
      this._setState(attempt, { status: "failed", error: safeFailure(error, "spawn", action), url: null, code: null });
      void this._finish(attempt, "failed");
    });
    if (captureOutput) {
      child.stdout?.on("data", chunk => this._onOutput(attempt, "stdout", chunk));
      child.stderr?.on("data", chunk => this._onOutput(attempt, "stderr", chunk));
      child.stdout?.on("error", error => this._outputError(attempt, error));
      child.stderr?.on("error", error => this._outputError(attempt, error));
    }
    if (phase === "acp-logout") child.stdin?.once("error", () => this._failAcp(attempt, "acp-protocol"));
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
    if (attempt.phase === "acp-logout" && channel === "stdout") {
      this._onAcpText(attempt, value);
      return;
    }
    if (attempt.phase !== "login" || typeof attempt.auth.parseProgress !== "function") return;
    let parsed;
    try {
      parsed = attempt.auth.parseProgress({ text: parserText(`${attempt.stdout}\n${attempt.stderr}`) });
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

  _sendAcp(attempt, message) {
    if (attempt.finalized || !attempt.child?.stdin || attempt.child.stdin.destroyed) {
      this._failAcp(attempt, "acp-protocol");
      return false;
    }
    try { return attempt.child.stdin.write(`${JSON.stringify(message)}\n`); }
    catch { this._failAcp(attempt, "acp-protocol"); return false; }
  }

  _onAcpText(attempt, text) {
    if (attempt.finalized || attempt.phase !== "acp-logout" || attempt.stopStatus) return;
    attempt.acpBuffer += text;
    if (Buffer.byteLength(attempt.acpBuffer, "utf8") > 64 * 1024) {
      this._failAcp(attempt, "acp-protocol");
      return;
    }
    let newline;
    while ((newline = attempt.acpBuffer.indexOf("\n")) >= 0) {
      const line = attempt.acpBuffer.slice(0, newline).replace(/\r$/, "");
      attempt.acpBuffer = attempt.acpBuffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { this._failAcp(attempt, "acp-protocol"); return; }
      if (!isPlainObject(message) || message.jsonrpc !== "2.0") { this._failAcp(attempt, "acp-protocol"); return; }
      this._handleAcpMessage(attempt, message);
      if (attempt.stopStatus || attempt.phase !== "acp-logout") return;
    }
  }

  _handleAcpMessage(attempt, message) {
    if (attempt.acpStage === "initialize") {
      if (message.id !== 0) return;
      if (message.error || !isPlainObject(message.result)) { this._failAcp(attempt, "acp-protocol"); return; }
      const logoutCapability = message.result.agentCapabilities?.auth?.logout;
      if (!isPlainObject(logoutCapability)) { this._failAcp(attempt, "acp-unavailable"); return; }
      attempt.acpStage = "logout";
      this._sendAcp(attempt, { jsonrpc: "2.0", id: 1, method: "logout", params: {} });
      return;
    }
    if (attempt.acpStage === "logout" && message.id === 1) {
      if (message.error || !isPlainObject(message.result) || Object.keys(message.result).length !== 0) { this._failAcp(attempt, "acp-protocol"); return; }
      attempt.acpAcknowledged = true;
      attempt.acpStage = "acknowledged";
      attempt.phase = "acp-logout-ack";
      clearTimeout(attempt.timer);
      attempt.timer = setTimeout(() => this._requestStop(attempt, "failed", "timeout"), this.cancelGraceMs);
      this._setState(attempt, { status: "verifying", message: "Kimi confirmed sign-out; closing its protocol process…", url: null, code: null });
      void this._notifyPhase(attempt, "signed-out");
      this._terminate(attempt);
    }
  }

  _failAcp(attempt, reason) {
    if (attempt.finalized || attempt.stopStatus || attempt.acpAcknowledged) return;
    const message = safeFailure(null, reason, "logout");
    this._setState(attempt, { status: "failed", message, error: message, url: null, code: null });
    this._requestStop(attempt, "failed", reason);
  }

  _outputError(attempt) {
    if (attempt.finalized) return;
    const action = ["logout", "logout-verify", "acp-logout", "acp-logout-ack"].includes(attempt.phase) ? "sign-out" : "sign-in";
    this._setState(attempt, { status: "failed", error: `The CLI ${action} output could not be read.`, url: null, code: null });
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
    if (attempt.phase === "acp-logout-ack") {
      if (attempt.operation === "login") {
        await this._beginFreshLogin(attempt);
      } else {
        this._setState(attempt, { status: "succeeded", message: "Kimi CLI confirmed sign-out.", method: "acp", error: null, url: null, code: null });
        await this._finish(attempt, "succeeded");
      }
      return;
    }
    if (attempt.phase === "acp-logout") {
      this._failAcp(attempt, "acp-protocol");
      if (!attempt.finalized && attempt.stopStatus) await this._finish(attempt, attempt.stopStatus);
      return;
    }
    if (attempt.phase === "logout") {
      if (exitSignal || code !== 0) {
        this._setState(attempt, { status: "failed", message: "CLI sign-out did not complete.", error: "CLI sign-out did not complete.", url: null, code: null });
        await this._finish(attempt, "failed");
        return;
      }
      if (attempt.statusArgs) {
        this._setState(attempt, { status: "verifying", message: "Verifying that the CLI session is signed out…", url: null, code: null });
        this._startPiped(attempt, attempt.statusArgs, { phase: "logout-verify", timeoutMs: VERIFY_TIMEOUT_MS });
        return;
      }
      if (attempt.operation === "login") {
        await this._beginFreshLogin(attempt);
      } else {
        await this._notifyPhase(attempt, "signed-out");
        this._setState(attempt, { status: "succeeded", message: "CLI sign-out command completed.", method: "command", error: null, url: null, code: null });
        await this._finish(attempt, "succeeded");
      }
      return;
    }
    if (attempt.phase === "logout-verify") {
      const signedOut = !exitSignal ? this._parseStatus(attempt, code) : null;
      if (signedOut?.authenticated !== false) {
        this._setState(attempt, { status: "failed", message: "The CLI did not confirm that the session was signed out.", error: "The CLI did not confirm that the session was signed out.", url: null, code: null });
        await this._finish(attempt, "failed");
        return;
      }
      if (attempt.operation === "login") {
        await this._beginFreshLogin(attempt);
      } else {
        await this._notifyPhase(attempt, "signed-out");
        this._setState(attempt, { status: "succeeded", message: "CLI sign-out verified.", method: "command", error: null, url: null, code: null });
        await this._finish(attempt, "succeeded");
      }
      return;
    }
    if (attempt.phase === "verify") {
      const verified = !exitSignal ? this._parseStatus(attempt, code) : null;
      await this._applyStatusResult(attempt, verified);
      return;
    }
    if (attempt.phase === "terminal-logout" || attempt.phase === "terminal-login") {
      if (exitSignal || code !== 0) {
        const message = terminalFailure(attempt, code, exitSignal);
        this._setState(attempt, { status: "failed", message, error: message, terminalClosed: true, url: null, code: null });
        await this._finish(attempt, "failed");
        return;
      }
      this._setState(attempt, { status: "waiting", terminalClosed: true, message: attempt.phase === "terminal-logout" ? "CLI 창이 닫혔습니다. /logout을 실행했다면 앱에서 완료를 확인하세요." : "CLI 창이 닫혔습니다. 모델 목록을 불러와 로그인 상태를 확인하세요.", url: null, code: null });
      await this._finish(attempt, "waiting");
      return;
    }
    if (exitSignal || code !== 0) {
      this._setState(attempt, { status: "failed", message: "CLI sign-in did not complete.", error: "CLI sign-in did not complete.", url: null, code: null });
      await this._finish(attempt, "failed");
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
    const action = attempt.operation === "logout" || ["logout", "logout-verify", "acp-logout", "acp-logout-ack"].includes(attempt.phase) ? "logout" : "login";
    const state = status === "canceled"
      ? { status, message: `${action === "logout" ? "Sign-out" : "Sign-in"} canceled.`, error: null, url: null, code: null }
      : { status, message: safeFailure(null, reason, action), error: safeFailure(null, reason, action), url: null, code: null };
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
    attempt.acpBuffer = "";
    attempt.decoders = null;
    if (this.activeExecutables.get(attempt.executionKey) === attempt) this.activeExecutables.delete(attempt.executionKey);
    attempt.finishPromise = (async () => {
      const onExit = attempt.onExit;
      attempt.onExit = null;
      if (attempt.phasePromise) await attempt.phasePromise;
      try { await onExit?.({ providerId: attempt.providerId, id: attempt.id, status }); } catch {}
      attempt.env = undefined;
      attempt.child = null;
      attempt.signal = null;
      attempt.onAbort = null;
      if (!(attempt.operation === "logout" && attempt.logoutKind === "terminal" && status === "waiting" && attempt.state.terminalClosed)) attempt.onPhase = null;
      attempt.doneResolve(this.snapshot(attempt.providerId));
      return this.snapshot(attempt.providerId);
    })();
    await attempt.finishPromise;
    return attempt.done;
  }

  async _notifyPhase(attempt, phase) {
    if (attempt.phaseNotified) return attempt.phasePromise;
    attempt.phaseNotified = true;
    attempt.phasePromise = (async () => {
      try { await attempt.onPhase?.({ providerId: attempt.providerId, id: attempt.id, phase }); } catch {}
    })();
    return attempt.phasePromise;
  }

  async _beginFreshLogin(attempt) {
    await this._notifyPhase(attempt, "signed-out");
    if (attempt.finalized || attempt.stopStatus) return;
    this._setState(attempt, { status: "starting", message: attempt.state.instructions || "Starting CLI sign-in…", method: null, error: null, url: null, code: null });
    this._startLogin(attempt, attempt.timeoutMs);
  }

  async cancel(id) {
    providerId(id);
    const attempt = this.attempts.get(id);
    if (!attempt) return this.snapshot(id);
    if (attempt.finalized) {
      if (attempt.state.status === "waiting" && (attempt.kind === "api-key" || attempt.state.terminalClosed)) {
        const action = attempt.operation === "logout" ? "Sign-out" : "Sign-in";
        this._setState(attempt, { status: "canceled", message: `${action} canceled.`, error: null, url: null, code: null });
        attempt.onPhase = null;
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

  async confirmLogout(id) {
    providerId(id);
    const attempt = this.attempts.get(id);
    if (!attempt || attempt.operation !== "logout" || attempt.logoutKind !== "terminal" || !attempt.state.terminalClosed || attempt.state.status !== "waiting") {
      throw new Error("There is no completed terminal sign-out to confirm.");
    }
    await this._notifyPhase(attempt, "signed-out");
    if (attempt.state.status !== "waiting") throw new Error("The terminal sign-out confirmation is no longer pending.");
    this._setState(attempt, { status: "succeeded", message: "Sign-out confirmed by the user.", method: "manual", error: null, url: null, code: null });
    attempt.onPhase = null;
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
