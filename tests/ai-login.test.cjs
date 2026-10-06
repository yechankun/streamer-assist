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

test("status preflight accepts exit 1 only when official parser confirms logged-out, then verifies login", async () => {
  const harness = spawnHarness();
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl });
  let statusCalls = 0;
  const descriptor = makeAuth({
    keyUrl: KEY_URLS.anthropic,
    statusArgs: ["auth", "status"],
    parseStatus({ stdout, exitCode }) {
      statusCalls++;
      if (exitCode === 0 && stdout.includes("signed-in")) return { authenticated: true, method: "account" };
      if (exitCode === 1 && stdout.includes("signed-out")) return { authenticated: false };
      return null;
    },
  });
  let exited = 0;
  await manager.start({ providerId: "anthropic", descriptor, executable: "C:\\claude.exe", onExit: () => exited++ });
  harness.children[0].stdout.end("signed-out");
  harness.children[0].close(1);
  await spinUntil(() => harness.children.length === 2);
  assert.deepEqual(harness.calls[1].args, ["login"]);
  harness.children[1].close(0);
  await spinUntil(() => harness.children.length === 3);
  assert.deepEqual(harness.calls[2].args, ["auth", "status"]);
  harness.children[2].stdout.end("signed-in");
  harness.children[2].close(0);
  await spinUntil(() => manager.snapshot("anthropic").status === "succeeded");
  assert.equal(manager.snapshot("anthropic").method, "account");
  assert.equal(statusCalls, 2);
  assert.equal(exited, 1);
});

test("existing authenticated status skips OAuth, while unparseable status fails closed", async () => {
  const signedIn = spawnHarness();
  const manager = new LoginManager({ spawnImpl: signedIn.spawnImpl });
  await manager.start({ providerId: "openai", descriptor: makeAuth({ statusArgs: ["login", "status"], parseStatus: ({ exitCode }) => exitCode === 0 ? { authenticated: true } : { authenticated: false } }), executable: "C:\\codex.exe" });
  signedIn.children[0].close(0);
  await spinUntil(() => manager.snapshot("openai").status === "succeeded");
  assert.equal(signedIn.calls.length, 1);

  const unknown = spawnHarness();
  const second = new LoginManager({ spawnImpl: unknown.spawnImpl });
  await second.start({ providerId: "anthropic", descriptor: makeAuth({ keyUrl: KEY_URLS.anthropic, statusArgs: ["auth", "status"], parseStatus: () => null }), executable: "C:\\claude.exe" });
  unknown.children[0].close(1);
  await spinUntil(() => second.snapshot("anthropic").status === "failed");
  assert.equal(unknown.calls.length, 1);
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

test("Google terminal login uses a visible tracked window and exit is not authentication proof", async () => {
  const harness = spawnHarness();
  let exitStatus;
  const manager = new LoginManager({ spawnImpl: harness.spawnImpl, platform: "win32" });
  const descriptor = makeAuth({ kind: "terminal", loginArgs: [], requiresTty: true, authHosts: [], keyUrl: KEY_URLS.google });
  await manager.start({ providerId: "google", descriptor, executable: "C:\\Users\\test user\\agy.exe", env: { SystemRoot: "C:\\Windows" }, onExit: ({ status }) => { exitStatus = status; } });
  assert.equal(harness.calls.length, 1);
  const [powershell, args, options] = Object.values(harness.calls[0]);
  assert.match(powershell, /powershell\.exe$/i);
  assert.ok(args.includes("-EncodedCommand"));
  assert.equal(args.includes("-NoExit"), false);
  assert.equal(options.shell, false);
  assert.equal(options.detached, false);
  assert.equal(options.windowsHide, false);
  assert.equal(options.stdio, "ignore");
  harness.children[0].close(0);
  await spinUntil(() => manager.snapshot("google").terminalClosed);
  assert.equal(manager.snapshot("google").status, "waiting");
  assert.equal(exitStatus, "waiting");
  await manager.shutdown();
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
  assert.equal(command, "& 'C:\\Program Files\\O''Brien\\agy.exe' '--some flag' 'x''y'; exit $LASTEXITCODE");
});
