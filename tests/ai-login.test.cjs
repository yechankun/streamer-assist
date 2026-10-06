"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { LoginManager, validateAuth, encodePowerShellCommand } = require("../electron/ai-login.cjs");
const { loadTestAdapters } = require("./ai-test-adapters.cjs");

const KEY_URLS = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://platform.claude.com/settings/keys",
  xai: "https://console.x.ai",
  google: "https://aistudio.google.com/apikey",
  deepseek: "https://platform.deepseek.com/api_keys",
  moonshot: "https://platform.kimi.ai/console/api-keys",
};

function makeAuth(overrides = {}) {
  return {
    kind: "browser", loginArgs: ["login"], requiresTty: false,
    statusArgs: undefined, authHosts: ["auth.openai.com"],
    keyUrl: KEY_URLS.openai, instructions: "Finish sign-in in your browser.",
    ...overrides,
  };
}

function terminalAuth() {
  return makeAuth({
    kind: "terminal", loginArgs: [], requiresTty: true, authHosts: [], keyUrl: KEY_URLS.google,
    statusArgs: ["-p", "/usage", "--output-format", "json", "--print-timeout", "10s"],
    parseStatus({ stdout, exitCode }) {
      if (exitCode !== 0) return null;
      try {
        const value = JSON.parse(stdout);
        return typeof value.accountVerified === "boolean" ? { authenticated: value.accountVerified, method: "account" } : null;
      } catch { return null; }
    },
  });
}

function fakeChild({ pid = 8811 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.close(1, "SIGTERM"));
  };
  child.close = (code = 0, signal = null) => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code, signal);
  };
  return child;
}

function spawnHarness() {
  const calls = [];
  const children = [];
  const spawnImpl = (file, args, options) => {
    const child = fakeChild();
    calls.push({ file, args, options });
    children.push(child);
    return child;
  };
  return { calls, children, spawnImpl };
}

function acpHarness({ logoutCapability = {}, advertiseLogout = true, logoutError = false, respond = true, closeOnKill = true } = {}) {
  const calls = [];
  const children = [];
  const requests = [];
  const spawnImpl = (file, args, options) => {
    const child = fakeChild();
    if (!closeOnKill) child.kill = () => { child.killed = true; };
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = chunk => {
      const message = JSON.parse(String(chunk).trim());
      requests.push(message);
      if (respond && message.id === 0) {
        const result = { agentCapabilities: { auth: { ...(advertiseLogout ? { logout: logoutCapability } : {}) } } };
        setImmediate(() => child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 0, result })}\n`));
      } else if (respond && message.id === 1) {
        const reply = logoutError
          ? { jsonrpc: "2.0", id: 1, error: { code: -1, message: "private oauth token must not surface" } }
          : { jsonrpc: "2.0", id: 1, result: {} };
        setImmediate(() => child.stdout.write(`${JSON.stringify(reply)}\n`));
      }
      return write(chunk);
    };
    calls.push({ file, args, options });
    children.push(child);
    return child;
  };
  return { calls, children, requests, spawnImpl };
}

async function spinUntil(predicate, message = "condition not reached") {
  const end = Date.now() + 1000;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

test("provider API key URLs are separate from OAuth hosts, and empty authHosts allow code-only metadata", () => {
  for (const [id, keyUrl] of Object.entries(KEY_URLS)) {
    const kind = id === "google" ? "terminal" : id === "deepseek" ? "api-key" : "browser";
    const auth = makeAuth({ kind, loginArgs: kind === "browser" ? ["login"] : [], requiresTty: kind === "terminal", authHosts: [], keyUrl });
    assert.equal(validateAuth(id, auth).keyUrl, new URL(keyUrl).href);
  }
  const codeOnly = makeAuth({ authHosts: [], parseProgress() { return { code: "ABCD-1234" }; } });
  assert.deepEqual(validateAuth("openai", codeOnly).authHosts, []);
  assert.equal(typeof validateAuth("google", { ...codeOnly, kind: "terminal", requiresTty: true, keyUrl: KEY_URLS.google }).auth.parseProgress, "function");
  assert.throws(() => validateAuth("openai", makeAuth({ keyUrl: "https://platform.openai.com/api-keys?secret=x" })), /not trusted/);
  assert.throws(() => validateAuth("openai", makeAuth({ keyUrl: "https://auth.openai.com/api-keys" })), /not trusted/);
  assert.throws(() => validateAuth("openai", makeAuth({ loginArgs: [] })), /arguments are invalid/);
  assert.equal(validateAuth("google", makeAuth({ kind: "terminal", requiresTty: true, loginArgs: [], authHosts: [], keyUrl: KEY_URLS.google })).loginArgs.length, 0);
});

test("verified provider packs pass LoginManager validation when they publish auth recipes", async () => {
  const expected = { openai: "browser", anthropic: "browser", xai: "browser", google: "terminal", deepseek: "api-key", moonshot: "device" };
  const adapters = await loadTestAdapters();
  for (const [id, kind] of Object.entries(expected)) {
    const adapter = adapters[id];
    assert.equal(adapter?.abiVersion, 1);
    assert.equal(adapter?.provider?.id, id);
    const validated = validateAuth(id, adapter.cli.auth);
    assert.equal(validated.kind, kind);
    assert.ok(validated.keyUrl);
  }
});

test("an untouched provider reports idle and unsupported without a fictitious active login", () => {
  const manager = new LoginManager();
  const state = manager.snapshot("openai");
  assert.equal(state.status, "idle");
  assert.equal(state.supported, false);
  assert.equal(state.id, null);
});

test("browser login coalesces duplicates, exposes only allowlisted progress, and completes on successful CLI exit", async () => {
  const harness = spawnHarness();
  const opened = [];
  let exits = 0;
  const manager = new LoginManager({
    spawnImpl: harness.spawnImpl,
    openExternal: async url => opened.push(url),
  });
  const descriptor = makeAuth({ parseProgress({ text }) {
    if (!text.includes("https://auth.openai.com/oauth/authorize")) return null;
    return { url: "https://auth.openai.com/oauth/authorize?client_id=app&state=abc", code: "WXYZ-1234" };
  } });
  const input = { providerId: "openai", descriptor, executable: "C:\\Program Files\\Codex\\codex.exe", cwd: "C:\\temp\\job", onExit: () => exits++ };
  const started = await manager.start(input);
  const duplicate = await manager.start(input);
  assert.equal(duplicate.id, started.id);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].options.shell, false);
  assert.equal(harness.calls[0].options.detached, false);
  assert.equal(harness.calls[0].options.windowsHide, true);
  assert.equal(harness.calls[0].args[0], "login");

  harness.children[0].stdout.write("Go to https://auth.openai.com/oauth/authorize\napi_key=super-secret-value");
  await spinUntil(() => manager.snapshot("openai").code === "WXYZ-1234");
  assert.equal(manager.snapshot("openai").url, "https://auth.openai.com/oauth/authorize?client_id=app&state=abc");
  assert.equal(JSON.stringify(manager.snapshot("openai")).includes("super-secret-value"), false);
  await manager.openBrowser("openai");
  assert.deepEqual(opened, [manager.snapshot("openai").url]);
  harness.children[0].close(0);
  await spinUntil(() => manager.snapshot("openai").status === "succeeded");
  assert.equal(exits, 1);
  await manager.shutdown();
});

test("OpenAI OAuth progress preserves the full state and approved Codex query fields but rejects token params", async () => {
  const harness = spawnHarness();
  const opened = [];
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, openExternal: async url => opened.push(url) });
  const state = "ab".repeat(32);
  const authorizeUrl = `https://auth.openai.com/oauth/authorize?client_id=codex&state=${state}&code_challenge=${"Z9".repeat(32)}&code_challenge_method=S256&id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=codex_cli_rs&allowed_workspace_id=workspace-123`;
  await manager.start({ providerId: "openai", descriptor: makeAuth({ parseProgress({ text }) {
    const match = text.match(/https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s]+/);
    return match ? { url: match[0] } : null;
  } }), executable: "C:\\codex.exe" });
  harness.children[0].stdout.write(`Open ${authorizeUrl}`);
  await spinUntil(() => manager.snapshot("openai").url !== null);
  assert.equal(manager.snapshot("openai").url, authorizeUrl);
  await manager.openBrowser("openai");
  assert.deepEqual(opened, [authorizeUrl]);
  await manager.cancel("openai");

  const tokenHarness = spawnHarness();
  const tokenManager = new LoginManager({ spawnImpl: tokenHarness.spawnImpl });
  await tokenManager.start({ providerId: "openai", descriptor: makeAuth({ parseProgress: () => ({ url: "https://auth.openai.com/oauth/authorize?client_id=codex&access_token=secret-value" }) }), executable: "C:\\codex.exe" });
  tokenHarness.children[0].stdout.write("Sign in");
  assert.equal(tokenManager.snapshot("openai").url, null);
  await assert.rejects(tokenManager.openBrowser("openai"), /No approved sign-in page/);
  await tokenManager.cancel("openai");
});

test("parser URLs outside the provider's exact OAuth host list are never opened", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, openExternal: async () => assert.fail("unsafe URL opened") });
  await manager.start({
    providerId: "openai", descriptor: makeAuth({ parseProgress: () => ({ url: "https://evil.example/authorize?client_id=x", code: "ABCD-1234" }) }),
    executable: "C:\\codex.exe",
  });
  harness.children[0].stdout.write("signing in");
  assert.equal(manager.snapshot("openai").url, null);
  await assert.rejects(manager.openBrowser("openai"), /No approved sign-in page/);
  await manager.cancel("openai");
});

test("fresh login runs official logout, verifies signed-out status, then runs login and verifies success", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  let statusCalls = 0;
  const descriptor = makeAuth({
    keyUrl: KEY_URLS.anthropic,
    logoutKind: "command",
    logoutArgs: ["auth", "logout"],
    logoutBeforeLogin: true,
    statusArgs: ["auth", "status"],
    parseStatus({ stdout, exitCode }) {
      statusCalls++;
      if (exitCode === 0 && stdout.includes("signed-in")) return { authenticated: true, method: "account" };
      if (exitCode === 1 && stdout.includes("signed-out")) return { authenticated: false };
      return null;
    },
  });
  let exited = 0;
  const phases = [];
  await manager.start({ providerId: "anthropic", descriptor, executable: "C:\\claude.exe", onExit: () => exited++, onPhase: event => phases.push(event) });
  assert.equal(manager.snapshot("anthropic").operation, "login");
  assert.deepEqual(harness.calls[0].args, ["auth", "logout"]);
  harness.children[0].close(0);
  await spinUntil(() => harness.children.length === 2);
  assert.deepEqual(harness.calls[1].args, ["auth", "status"]);
  harness.children[1].stdout.end("signed-out");
  harness.children[1].close(1);
  await spinUntil(() => harness.children.length === 3);
  assert.deepEqual(harness.calls[2].args, ["login"]);
  assert.deepEqual(phases.map(item => item.phase), ["signed-out"]);
  assert.equal(exited, 0);
  harness.children[2].close(0);
  await spinUntil(() => harness.children.length === 4);
  assert.deepEqual(harness.calls[3].args, ["auth", "status"]);
  harness.children[3].stdout.end("signed-in");
  harness.children[3].close(0);
  await spinUntil(() => manager.snapshot("anthropic").status === "succeeded");
  assert.equal(manager.snapshot("anthropic").method, "account");
  assert.equal(statusCalls, 2);
  assert.equal(exited, 1);
});

test("a CLI without a status command still runs official logout before the actual login", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  const descriptor = makeAuth({
    keyUrl: KEY_URLS.xai, logoutKind: "command", logoutArgs: ["logout"], logoutBeforeLogin: true,
  });
  await manager.start({ providerId: "xai", descriptor, executable: "C:\\grok.exe" });
  assert.deepEqual(harness.calls[0].args, ["logout"]);
  harness.children[0].close(0);
  await spinUntil(() => harness.children.length === 2);
  assert.deepEqual(harness.calls[1].args, ["login"]);
  harness.children[1].close(0);
  await spinUntil(() => manager.snapshot("xai").status === "succeeded");
  assert.equal(harness.calls.length, 2);
});

test("cached authenticated status never skips a fresh login command", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  const descriptor = makeAuth({
    statusArgs: ["login", "status"],
    parseStatus: ({ exitCode }) => exitCode === 0 ? { authenticated: true } : { authenticated: false },
  });
  await manager.start({ providerId: "openai", descriptor, executable: "C:\\codex.exe" });
  assert.deepEqual(harness.calls[0].args, ["login"]);
  harness.children[0].close(0);
  await spinUntil(() => harness.children.length === 2);
  assert.deepEqual(harness.calls[1].args, ["login", "status"]);
  harness.children[1].close(0);
  await spinUntil(() => manager.snapshot("openai").status === "succeeded");
  assert.equal(harness.calls.length, 2);
});

test("command logout verifies exit-1 signed-out status and never claims success from logout command alone", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  let exits = 0;
  const phases = [];
  const descriptor = makeAuth({
    logoutKind: "command", logoutArgs: ["logout"], statusArgs: ["login", "status"],
    parseStatus: ({ exitCode }) => exitCode === 1 ? { authenticated: false } : exitCode === 0 ? { authenticated: true } : null,
  });
  await manager.start({ providerId: "openai", descriptor, executable: "C:\\codex.exe", operation: "logout", onExit: () => exits++, onPhase: event => phases.push(event) });
  assert.equal(manager.snapshot("openai").operation, "logout");
  assert.deepEqual(harness.calls[0].args, ["logout"]);
  harness.children[0].close(0);
  await spinUntil(() => harness.children.length === 2);
  harness.children[1].close(1);
  await spinUntil(() => manager.snapshot("openai").status === "succeeded");
  assert.equal(manager.snapshot("openai").method, "command");
  assert.equal(exits, 1);
  assert.deepEqual(phases.map(item => item.phase), ["signed-out"]);
});

test("Kimi ACP gates logout on initialize capability, stops the protocol child, then runs fresh login", async () => {
  const harness = acpHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  const phases = [];
  let exitStatus;
  const descriptor = makeAuth({
    kind: "device", keyUrl: KEY_URLS.moonshot, authHosts: ["www.kimi.com", "www.kimi.ai"],
    logoutKind: "acp", logoutArgs: ["acp"], logoutBeforeLogin: true,
  });
  await manager.start({
    providerId: "moonshot", descriptor, executable: "C:\\kimi.exe",
    onPhase: event => phases.push(event), onExit: ({ status }) => { exitStatus = status; },
  });
  assert.deepEqual(harness.calls[0].args, ["acp"]);
  assert.deepEqual(harness.calls[0].options.stdio, ["pipe", "pipe", "pipe"]);
  await spinUntil(() => harness.calls.length === 2);
  assert.deepEqual(harness.requests[0], { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
  assert.deepEqual(harness.requests[1], { jsonrpc: "2.0", id: 1, method: "logout", params: {} });
  assert.equal(harness.children[0].killed, true);
  assert.deepEqual(harness.calls[1].args, ["login"]);
  assert.deepEqual(phases.map(item => item.phase), ["signed-out"]);
  harness.children[1].close(0);
  await spinUntil(() => manager.snapshot("moonshot").status === "succeeded");
  assert.equal(manager.snapshot("moonshot").operation, "login");
  assert.equal(exitStatus, "succeeded");
});

test("Kimi ACP refuses missing logout capability or RPC errors and does not launch login", async () => {
  const descriptor = makeAuth({
    kind: "device", keyUrl: KEY_URLS.moonshot, authHosts: ["www.kimi.com", "www.kimi.ai"],
    logoutKind: "acp", logoutArgs: ["acp"], logoutBeforeLogin: true,
  });
  for (const options of [{ advertiseLogout: false }, { logoutError: true }]) {
    const harness = acpHarness(options);
    const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
    await manager.start({ providerId: "moonshot", descriptor, executable: "C:\\kimi.exe" });
    await spinUntil(() => manager.snapshot("moonshot").status === "failed");
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.requests.some(item => item.method === "logout"), options.advertiseLogout !== false);
    assert.equal(JSON.stringify(manager.snapshot("moonshot")).includes("private oauth token"), false);
  }
});

test("standalone Kimi ACP logout succeeds only after the empty logout acknowledgement and process exit", async () => {
  const harness = acpHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  let exits = 0;
  const descriptor = makeAuth({ kind: "device", keyUrl: KEY_URLS.moonshot, authHosts: ["www.kimi.com", "www.kimi.ai"], logoutKind: "acp", logoutArgs: ["acp"], logoutBeforeLogin: true });
  await manager.start({ providerId: "moonshot", descriptor, executable: "C:\\kimi.exe", operation: "logout", onExit: () => exits++ });
  await spinUntil(() => manager.snapshot("moonshot").status === "succeeded");
  assert.equal(manager.snapshot("moonshot").operation, "logout");
  assert.equal(manager.snapshot("moonshot").method, "acp");
  assert.equal(harness.calls.length, 1);
  assert.equal(exits, 1);
});

test("canceling Kimi ACP handshake kills the owned child and releases once without authentication calls", async () => {
  const harness = acpHarness({ respond: false });
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, cancelGraceMs: 100 });
  let exits = 0;
  const descriptor = makeAuth({ kind: "device", keyUrl: KEY_URLS.moonshot, authHosts: ["www.kimi.com", "www.kimi.ai"], logoutKind: "acp", logoutArgs: ["acp"], logoutBeforeLogin: true });
  await manager.start({ providerId: "moonshot", descriptor, executable: "C:\\kimi.exe", onExit: () => exits++ });
  await manager.cancel("moonshot");
  assert.equal(manager.snapshot("moonshot").status, "canceled");
  assert.equal(harness.children[0].killed, true);
  assert.equal(harness.requests.length, 1);
  assert.equal(exits, 1);
});

test("cancel after ACP logout acknowledgement preserves signed-out phase and does not start login", async () => {
  const harness = acpHarness({ closeOnKill: false });
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, cancelGraceMs: 100 });
  const phases = [];
  let exitStatus;
  const descriptor = makeAuth({ kind: "device", keyUrl: KEY_URLS.moonshot, authHosts: ["www.kimi.com", "www.kimi.ai"], logoutKind: "acp", logoutArgs: ["acp"], logoutBeforeLogin: true });
  await manager.start({ providerId: "moonshot", descriptor, executable: "C:\\kimi.exe", onPhase: event => phases.push(event), onExit: ({ status }) => { exitStatus = status; } });
  await spinUntil(() => phases.length === 1);
  assert.equal(manager.snapshot("moonshot").status, "verifying");
  const cancelPromise = manager.cancel("moonshot");
  setImmediate(() => harness.children[0].close(1, "SIGTERM"));
  await cancelPromise;
  assert.equal(manager.snapshot("moonshot").status, "canceled");
  assert.equal(harness.calls.length, 1);
  assert.equal(exitStatus, "canceled");
  assert.deepEqual(phases.map(item => item.phase), ["signed-out"]);
});

test("terminal logout stays waiting after exit zero until explicit user confirmation", async t => {
  const harness = spawnHarness();
  let exits = 0;
  const phases = [];
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32" });
  t.after(() => manager.shutdown());
  const descriptor = makeAuth({
    kind: "terminal", loginArgs: [], requiresTty: true, authHosts: [], keyUrl: KEY_URLS.google,
    logoutKind: "terminal", logoutArgs: [], logoutInstructions: "Type /logout in the Antigravity window, then confirm here.",
  });
  await manager.start({ providerId: "google", descriptor, executable: "C:\\agy.exe", env: { SystemRoot: "C:\\Windows" }, operation: "logout", onExit: () => exits++, onPhase: event => phases.push(event) });
  await assert.rejects(manager.confirmLogout("google"), /no completed terminal sign-out/);
  const { args, options } = harness.calls[0];
  assert.equal(options.windowsHide, true);
  assert.match(harness.calls[0].file, /powershell\.exe$/i);
  assert.deepEqual(args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  assert.match(Buffer.from(args[3], "base64").toString("utf16le"), /Start-Process.*-WindowStyle Normal -PassThru/);
  assert.equal(args.includes("-NoExit"), false);
  harness.children[0].close(0);
  await spinUntil(() => manager.snapshot("google").terminalClosed);
  assert.equal(manager.snapshot("google").status, "waiting");
  assert.equal(manager.snapshot("google").operation, "logout");
  assert.equal(exits, 1);
  const confirmed = await manager.confirmLogout("google");
  assert.equal(confirmed.status, "succeeded");
  assert.equal(confirmed.method, "manual");
  assert.equal(exits, 1);
  assert.deepEqual(phases.map(item => item.phase), ["signed-out"]);
});

test("API-key logout metadata never launches a CLI command", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  const descriptor = makeAuth({ kind: "api-key", loginArgs: [], authHosts: [], keyUrl: KEY_URLS.deepseek, logoutKind: "api-key", logoutArgs: [], logoutBeforeLogin: false });
  await assert.rejects(manager.start({ providerId: "deepseek", descriptor, operation: "logout" }), /handled by encrypted settings/);
  assert.equal(harness.calls.length, 0);
});

test("unparseable post-login status fails closed after the real login command", async () => {
  const unknown = spawnHarness();
  const second = new LoginManager({ spawnImpl: unknown.spawnImpl });
  await second.start({ providerId: "anthropic", descriptor: makeAuth({ keyUrl: KEY_URLS.anthropic, statusArgs: ["auth", "status"], parseStatus: () => null }), executable: "C:\\claude.exe" });
  assert.deepEqual(unknown.calls[0].args, ["login"]);
  unknown.children[0].close(0);
  await spinUntil(() => unknown.children.length === 2);
  unknown.children[1].close(1);
  await spinUntil(() => second.snapshot("anthropic").status === "failed");
  assert.equal(unknown.calls.length, 2);
});

test("API-key mode opens only the descriptor's fixed HTTPS console and starts no process", async () => {
  const harness = spawnHarness();
  const opened = [];
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, openExternal: async url => opened.push(url) });
  const descriptor = makeAuth({ kind: "api-key", loginArgs: [], authHosts: [], keyUrl: KEY_URLS.openai });
  await manager.start({ providerId: "openai", descriptor });
  assert.equal(manager.snapshot("openai").status, "waiting");
  assert.equal(harness.calls.length, 0);
  assert.deepEqual(await manager.openBrowser("openai", { mode: "api", descriptor }), { opened: true });
  assert.deepEqual(opened, [KEY_URLS.openai]);
  await assert.rejects(manager.openBrowser("openai", { mode: "api", descriptor: makeAuth({ ...descriptor, keyUrl: "https://evil.example/" }) }));
  assert.equal(harness.calls.length, 0);
});

test("Windows inherited environment names with architecture suffixes pass without relaxing env safety", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  const env = { SystemRoot: "C:\\Windows", "ProgramFiles(x86)": "C:\\Program Files (x86)", "CommonProgramFiles(x86)": "C:\\Program Files (x86)\\Common Files", "MY-CUSTOM ENV": "permitted" };
  await manager.start({ providerId: "openai", descriptor: makeAuth(), executable: "C:\\codex.exe", env });
  assert.equal(harness.calls[0].options.env["ProgramFiles(x86)"], env["ProgramFiles(x86)"]);
  assert.equal(harness.calls[0].options.env["CommonProgramFiles(x86)"], env["CommonProgramFiles(x86)"]);
  assert.equal(harness.calls[0].options.env["MY-CUSTOM ENV"], "permitted");
  await manager.cancel("openai");
  await assert.rejects(manager.start({ providerId: "anthropic", descriptor: makeAuth({ keyUrl: KEY_URLS.anthropic }), executable: "C:\\claude.exe", env: { "INVALID=NAME": "ignored" } }), /environment is invalid/);
  await assert.rejects(manager.start({ providerId: "anthropic", descriptor: makeAuth({ keyUrl: KEY_URLS.anthropic }), executable: "C:\\claude.exe", env: { ["INVALID\0NAME"]: "ignored" } }), /environment is invalid/);
  await assert.rejects(manager.start({ providerId: "anthropic", descriptor: makeAuth({ keyUrl: KEY_URLS.anthropic }), executable: "C:\\claude.exe", env: { INVALID: "bad\0value" } }), /environment is invalid/);
});

test("Google terminal login uses a visible tracked window and exit is not authentication proof", async t => {
  const harness = spawnHarness();
  let exitStatus;
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32" });
  t.after(() => manager.shutdown());
  const descriptor = makeAuth({ kind: "terminal", loginArgs: [], requiresTty: true, authHosts: [], keyUrl: KEY_URLS.google });
  await manager.start({ providerId: "google", descriptor, executable: "C:\\Users\\test user\\agy.exe", env: { SystemRoot: "C:\\Windows" }, onExit: ({ status }) => { exitStatus = status; } });
  assert.equal(harness.calls.length, 1);
  const [powershell, args, options] = Object.values(harness.calls[0]);
  assert.match(powershell, /powershell\.exe$/i);
  assert.deepEqual(args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  const launcher = Buffer.from(args[3], "base64").toString("utf16le");
  assert.match(launcher, /Start-Process.*-WindowStyle Normal -PassThru/);
  assert.match(launcher, /\$taskConsoleHandle = \$taskConsole\.Handle; \$taskConsole\.WaitForExit\(\)/);
  assert.match(launcher, /\$taskConsoleExitCode = \$taskConsole\.ExitCode/);
  assert.equal(args.includes("-NoExit"), false);
  assert.equal(options.shell, false);
  assert.equal(options.detached, false);
  assert.equal(options.windowsHide, true);
  assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
  assert.match(options.env.PATHEXT, /(?:^|;)\.EXE(?:;|$)/i);
  harness.children[0].close(0);
  await spinUntil(() => manager.snapshot("google").terminalClosed);
  assert.equal(manager.snapshot("google").status, "waiting");
  assert.equal(exitStatus, "waiting");
  await manager.shutdown();
});

test("terminal sign-in polls a read-only account check once and closes its owned console on verified success", async t => {
  const harness = spawnHarness();
  const exits = [];
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32", cancelGraceMs: 100 });
  t.after(() => manager.shutdown());
  const descriptor = terminalAuth();
  await manager.start({ providerId: "google", descriptor, executable: "C:\\agy.exe", onExit: event => exits.push(event.status) });
  const first = manager.checkLogin("google");
  const duplicate = manager.checkLogin("google");
  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.calls[1].args, descriptor.statusArgs);
  assert.equal(harness.calls[1].options.windowsHide, true);
  assert.equal(harness.calls[1].options.shell, false);
  assert.equal(manager.snapshot("google").status, "waiting");
  harness.children[1].stdout.end('{"accountVerified":true}');
  harness.children[1].close(0);
  const [state, repeated] = await Promise.all([first, duplicate]);
  assert.equal(state.status, "succeeded");
  assert.equal(repeated.status, "succeeded");
  assert.equal(state.operation, "login");
  assert.equal(state.method, "account");
  assert.equal(harness.children[0].killed, true);
  assert.deepEqual(exits, ["succeeded"]);
  assert.equal(manager.activeExecutables.size, 0);
  assert.equal(manager.attempts.get("google").verifier, null);
  assert.equal(manager.attempts.get("google").verifyTimer, null);
});

test("terminal verification throttles retries and rejects exit-zero or model-only responses as account proof", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32", cancelGraceMs: 100 });
  t.after(() => manager.shutdown());
  await manager.start({ providerId: "google", descriptor: terminalAuth(), executable: "C:\\agy.exe" });
  const first = manager.checkLogin("google");
  harness.children[1].stdout.end('{"models":[{"id":"locally-known-model"}]}');
  harness.children[1].close(0);
  assert.equal((await first).status, "waiting");
  await manager.checkLogin("google");
  assert.equal(harness.calls.length, 2);
  t.mock.timers.tick(4000);
  assert.equal(harness.calls.length, 3);
  harness.children[2].stdout.end('{"accountVerified":false}');
  harness.children[2].close(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.snapshot("google").status, "waiting");
  assert.equal(manager.snapshot("google").error, null);
  t.mock.timers.tick(4000);
  assert.equal(harness.calls.length, 4);
  harness.children[3].stdout.end('{"accountVerified":true}');
  harness.children[3].close(0);
  await spinUntil(() => manager.attempts.get("google").finalized);
  assert.equal(manager.snapshot("google").status, "succeeded");
});

test("closed terminal with unverified account stays waiting only until the login deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const harness = spawnHarness();
  let exits = 0;
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32", timeoutMs: 1000, cancelGraceMs: 100 });
  t.after(() => manager.shutdown());
  await manager.start({ providerId: "google", descriptor: terminalAuth(), executable: "C:\\agy.exe", onExit: () => exits++ });
  harness.children[0].close(0);
  t.mock.timers.tick(0);
  assert.equal(harness.calls.length, 2);
  harness.children[1].stdout.end('{"accountVerified":false}');
  harness.children[1].close(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.snapshot("google").status, "waiting");
  assert.equal(manager.snapshot("google").terminalClosed, true);
  t.mock.timers.tick(1001);
  assert.equal(manager.snapshot("google").status, "failed");
  t.mock.timers.tick(101);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(exits, 1);
  assert.equal(manager.activeExecutables.size, 0);
  assert.equal(manager.attempts.get("google").verifyTimer, null);
});

test("a stalled read-only authentication check is terminated without closing the login console or exposing output", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32", timeoutMs: 30_000, cancelGraceMs: 100 });
  t.after(() => manager.shutdown());
  await manager.start({ providerId: "google", descriptor: terminalAuth(), executable: "C:\\agy.exe" });
  const checking = manager.checkLogin("google");
  harness.children[1].stderr.write("access_token=private-verifier-token");
  t.mock.timers.tick(15_000);
  const state = await checking;
  assert.equal(state.status, "waiting");
  assert.equal(state.error, null);
  assert.equal(JSON.stringify(state).includes("private-verifier-token"), false);
  assert.equal(harness.children[1].killed, true);
  assert.equal(harness.children[0].killed, false);
  t.mock.timers.tick(4000);
  assert.equal(harness.calls.length, 3, "a failed check can retry after the cooldown");
  await manager.cancel("google");
  assert.equal(harness.children[2].killed, true);
  assert.equal(manager.snapshot("google").status, "canceled");
});

test("native console nonzero close checks the account before reporting success or failure", async t => {
  for (const authenticated of [true, false]) {
    const harness = spawnHarness();
    const exits = [];
    const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32", cancelGraceMs: 100 });
    t.after(() => manager.shutdown());
    await manager.start({ providerId: "google", descriptor: terminalAuth(), executable: "C:\\agy.exe", onExit: event => exits.push(event.status) });
    harness.children[0].close(7);
    assert.equal(harness.calls.length, 2);
    harness.children[1].stdout.end(JSON.stringify({ accountVerified: authenticated }));
    harness.children[1].close(0);
    await spinUntil(() => manager.attempts.get("google").finalized);
    assert.equal(manager.snapshot("google").status, authenticated ? "succeeded" : "failed");
    assert.deepEqual(exits, [authenticated ? "succeeded" : "failed"]);
    assert.equal(harness.children[0].killed, false, "an already closed console is never terminated again");
  }
});

test("canceling terminal verification kills both owned children and ignores a late successful account response", async t => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32", cancelGraceMs: 100 });
  t.after(() => manager.shutdown());
  await manager.start({ providerId: "google", descriptor: terminalAuth(), executable: "C:\\agy.exe" });
  const checking = manager.checkLogin("google");
  const canceled = await manager.cancel("google");
  assert.equal(canceled.status, "canceled");
  assert.equal((await checking).status, "canceled");
  assert.equal(harness.children[0].killed, true);
  assert.equal(harness.children[1].killed, true);
  const restarted = await manager.start({ providerId: "google", descriptor: terminalAuth(), executable: "C:\\agy.exe" });
  harness.children[1].stdout.emit("data", Buffer.from('{"accountVerified":true}'));
  harness.children[1].emit("close", 0);
  assert.equal(manager.snapshot("google").id, restarted.id);
  assert.equal(manager.snapshot("google").status, "waiting");
});

test("cancellation kills only the owned process tree, reports once, and shutdown is idempotent", async () => {
  const harness = spawnHarness();
  const killCalls = [];
  let exits = 0;
  const manager = new LoginManager({
    spawnImpl: harness.spawnImpl,
    platform: "win32",
    killTreeImpl: (file, args, options) => killCalls.push({ file, args, options }),
    cancelGraceMs: 100,
  });
  await manager.start({ providerId: "openai", descriptor: makeAuth(), executable: "C:\\codex.exe", onExit: () => exits++ });
  await manager.cancel("openai");
  assert.equal(manager.snapshot("openai").status, "canceled");
  assert.equal(harness.children[0].killed, true);
  assert.equal(killCalls.length, 1);
  assert.deepEqual(killCalls[0].args, ["/PID", "8811", "/T", "/F"]);
  assert.equal(killCalls[0].options.shell, false);
  assert.equal(exits, 1);
  await manager.shutdown();
  assert.equal(exits, 1);
});

test("synchronous process close during cancellation clears the termination timer", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, cancelGraceMs: 100 });
  await manager.start({ providerId: "openai", descriptor: makeAuth(), executable: "C:\\codex.exe" });
  harness.children[0].kill = () => harness.children[0].close(1, "SIGTERM");
  await manager.cancel("openai");
  assert.equal(manager.snapshot("openai").status, "canceled");
  assert.equal(manager.attempts.get("openai").stopTimer, null);
});

test("spawn errors and output overflow fail safely without returning subprocess text", async () => {
  const manager = new LoginManager({ spawnImpl: () => { const error = new Error("private path and token=never-forward-this"); error.code = "ENOENT"; throw error; } });
  await manager.start({ providerId: "openai", descriptor: makeAuth(), executable: "C:\\codex.exe" });
  await spinUntil(() => manager.snapshot("openai").status === "failed");
  assert.equal(manager.snapshot("openai").error, "Could not complete CLI sign-in (ENOENT).");
  assert.equal(JSON.stringify(manager.snapshot("openai")).includes("never-forward-this"), false);

  const harness = spawnHarness();
  const second = new LoginManager({ spawnImpl: harness.spawnImpl, cancelGraceMs: 100 });
  await second.start({ providerId: "anthropic", descriptor: makeAuth({ keyUrl: KEY_URLS.anthropic }), executable: "C:\\claude.exe" });
  harness.children[0].stdout.write(Buffer.alloc(256 * 1024 + 1, 65));
  await spinUntil(() => second.snapshot("anthropic").status === "failed");
  assert.equal(second.snapshot("anthropic").error, "The sign-in command produced too much output.");
});

test("one executable cannot run two simultaneous provider login flows", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  await manager.start({ providerId: "openai", descriptor: makeAuth(), executable: "C:\\shared.exe" });
  await assert.rejects(manager.start({ providerId: "anthropic", descriptor: makeAuth({ keyUrl: KEY_URLS.anthropic }), executable: "c:\\SHARED.exe" }), /already has a sign-in/);
  assert.equal(harness.calls.length, 1);
  await manager.cancel("openai");
});

test("PowerShell command encoding quotes executable and arguments without a shell", () => {
  const encoded = encodePowerShellCommand("C:\\Program Files\\O'Brien\\agy.exe", ["--some flag", "x'y"]);
  const command = Buffer.from(encoded, "base64").toString("utf16le");
  assert.equal(command, "$ErrorActionPreference = 'Stop'; $taskCliExitCode = 1; try { & 'C:\\Program Files\\O''Brien\\agy.exe' '--some flag' 'x''y'; if ($null -ne $LASTEXITCODE) { $taskCliExitCode = $LASTEXITCODE } } catch { }; exit $taskCliExitCode");
});

test("terminal windows fail and finalize on nonzero exits or signals without exposing launcher output", async () => {
  for (const [code, signal] of [[1, null], [0, "SIGTERM"]]) {
    const harness = spawnHarness();
    let exits = 0;
    const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32" });
    const descriptor = makeAuth({ kind: "terminal", loginArgs: [], requiresTty: true, authHosts: [], keyUrl: KEY_URLS.google });
    await manager.start({ providerId: "google", descriptor, executable: "C:\\agy.exe", onExit: () => exits++ });
    harness.children[0].stderr.write("requires a terminal https://example.test/oauth?code=private-code access_token=private-token api_key=private-key");
    harness.children[0].close(code, signal);
    await spinUntil(() => manager.snapshot("google").status === "failed");
    assert.equal(manager.snapshot("google").terminalClosed, true);
    assert.equal(exits, 1);
    assert.match(manager.snapshot("google").message, /콘솔 입력/);
    assert.equal(/private-|example\.test/.test(JSON.stringify(manager.snapshot("google"))), false);
    await manager.shutdown();
    assert.equal(exits, 1);
  }
});

test("terminal launcher rejects shell metacharacters in the Windows executable path", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32" });
  const descriptor = makeAuth({ kind: "terminal", loginArgs: [], requiresTty: true, authHosts: [], keyUrl: KEY_URLS.google });
  await manager.start({ providerId: "google", descriptor, executable: "C:\\agy.exe", env: { SystemRoot: 'C:\\Windows" & malicious' } });
  await spinUntil(() => manager.snapshot("google").status === "failed");
  assert.equal(harness.calls.length, 0);
  assert.equal(JSON.stringify(manager.snapshot("google")).includes("malicious"), false);
});

test("canceling a terminal login closes only its owned console tree and releases once", async t => {
  const harness = spawnHarness();
  const killCalls = [];
  let exits = 0;
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32", killTreeImpl: (file, args, options) => killCalls.push({ file, args, options }), cancelGraceMs: 100 });
  t.after(() => manager.shutdown());
  const descriptor = makeAuth({ kind: "terminal", loginArgs: [], requiresTty: true, authHosts: [], keyUrl: KEY_URLS.google });
  await manager.start({ providerId: "google", descriptor, executable: "C:\\agy.exe", onExit: () => exits++ });
  const canceled = await manager.cancel("google");
  assert.equal(canceled.status, "canceled");
  assert.equal(harness.children[0].killed, true);
  assert.deepEqual(killCalls[0].args, ["/PID", "8811", "/T", "/F"]);
  assert.equal(killCalls[0].options.windowsHide, true);
  assert.equal(exits, 1);
  await manager.shutdown();
  assert.equal(exits, 1);
});
