"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { readCliQuota, normalizeTimestamp, normalizePercent } = require("../electron/ai-quota.cjs");
const { loadTestAdapters } = require("./ai-test-adapters.cjs");

let adapters;
test.before(async () => { adapters = await loadTestAdapters(); });

async function executableFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "streamer-ai-quota-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "codex.exe");
  await fs.writeFile(executable, "synthetic fixture; never executed");
  return executable;
}

function makeChild({ answer = true, pid, rpcError = false } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.messages = [];
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.stdin = {
    on() { return this; },
    end() {},
    write(line) {
      const request = JSON.parse(line);
      child.messages.push(request);
      if (!answer) return true;
      if (request.method === "initialize") {
        setImmediate(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { userAgent: "codex-test" } })}\n`)));
      } else if (request.method === "account/rateLimits/read") {
        if (rpcError) {
          setImmediate(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Authorization: Bearer test-secret" } })}\n`)));
          return true;
        }
        const result = {
          rateLimits: { limitId: "codex", limitName: "Codex", planType: "plus", primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: 1_800_100_000 }, credits: { hasCredits: true, unlimited: false, balance: "12.34567890123456789" } },
          rateLimitsByLimitId: { codex: { limitName: "Codex", primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: 1_800_100_000 }, credits: { hasCredits: true, unlimited: false, balance: "12.34567890123456789" }, planType: "plus" } },
        };
        setImmediate(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`)));
      }
      return true;
    },
  };
  child.kill = () => { child.killed = true; return true; };
  return child;
}

test("Codex quota uses only initialize and the read-only rate-limit RPC", async t => {
  const executable = await executableFixture(t);
  const calls = [];
  let child;
  const spawnImpl = (file, args, options) => {
    calls.push({ file, args, options });
    if (args.includes("/PID")) return new EventEmitter();
    child = makeChild({ pid: 4321 });
    return child;
  };
  const quota = await readCliQuota({ descriptor: adapters.openai.cli.quota, executable, spawnImpl, platform: "win32", env: { SystemRoot: "C:\\Windows" } });

  assert.equal(quota.available, true);
  assert.equal(quota.source, "codex-app-server");
  assert.equal(quota.windows.length, 2);
  assert.deepEqual(quota.windows.map(window => [window.key, window.usedPercent, window.remainingPercent]), [
    ["codex:primary", 24, 76], ["codex:secondary", 61, 39],
  ]);
  assert.equal(quota.windows[0].resetsAt, Date.parse("2027-01-15T08:00:00.000Z"));
  assert.deepEqual(calls[0].args, ["app-server"]);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(child.messages.map(message => message.method), ["initialize", "initialized", "account/rateLimits/read"]);
  assert.equal(child.messages.some(message => message.method === "thread/start" || message.method === "turn/start"), false);
  assert.ok(calls.some(call => call.file === path.join("C:\\Windows", "System32", "taskkill.exe")));
  assert.equal(child.killed, true);
});

test("Claude adapter normalizes documented rate limit events without invoking the CLI", async () => {
  const quota = adapters.anthropic.cli.quota.parseMessage({ message: {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      unifiedWindows: {
        five_hour: { utilization: 0.24, resetsAt: 1_800_000_000 },
        seven_day: { utilization: 0.13, resetsAt: "2027-01-16T12:00:00Z" },
      },
    },
  } });
  assert.equal(quota.available, true);
  assert.deepEqual(quota.windows.map(window => [window.name, window.usedPercent, window.remainingPercent]), [
    ["5-hour session", 24, 76], ["Weekly", 13, 87],
  ]);
  assert.equal(quota.windows[0].resetsAt, Date.parse("2027-01-15T08:00:00.000Z"));
  assert.equal(adapters.anthropic.cli.quota.parseMessage({ message: { type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", resetsAt: 1_800_000_000 } } }), null);
  assert.equal(adapters.anthropic.cli.quota.parseMessage({ message: "not json" }), null);
});

test("provider and CLI combinations without a public read-only quota source stay explicitly unavailable", async t => {
  const executable = await executableFixture(t);
  let spawned = 0;
  const spawnImpl = () => { spawned++; throw new Error("must not spawn"); };
  const deepseek = await readCliQuota({ descriptor: adapters.deepseek.cli.quota, executable, spawnImpl });
  assert.equal(deepseek.available, false);
  assert.ok(deepseek.reason);
  assert.equal((await readCliQuota({ descriptor: adapters.anthropic.cli.quota, executable, spawnImpl })).available, false);
  assert.equal((await readCliQuota({ descriptor: adapters.xai.cli.quota, executable, spawnImpl })).available, false);
  assert.equal(spawned, 0);
  assert.equal(adapters.anthropic.cli.quota.parseMessage({ message: { method: "account/rateLimits/updated", params: { rateLimits: { limitId: "codex", primary: { usedPercent: 5 } } } } }), null);
});

test("RPC and process errors return redacted reasons", async t => {
  const executable = await executableFixture(t);
  let child;
  const rpcFailure = await readCliQuota({
    descriptor: adapters.openai.cli.quota, executable, platform: "linux",
    spawnImpl: () => { child = makeChild({ rpcError: true }); return child; },
  });
  assert.equal(rpcFailure.available, false);
  assert.doesNotMatch(rpcFailure.reason, /test-secret|Bearer/);

  const startFailure = await readCliQuota({
    descriptor: adapters.openai.cli.quota, executable,
    spawnImpl: () => { throw new Error("TOKEN=test-secret"); },
  });
  assert.equal(startFailure.available, false);
  assert.doesNotMatch(startFailure.reason, /test-secret|TOKEN/);
});

test("timeout and abort terminate the child and its Windows process tree", async t => {
  const executable = await executableFixture(t);
  const calls = [];
  let child;
  const spawnImpl = (file, args) => {
    calls.push({ file, args });
    if (args.includes("/PID")) return new EventEmitter();
    child = makeChild({ answer: false, pid: 2468 });
    return child;
  };
  const controller = new AbortController();
  const pending = readCliQuota({ descriptor: adapters.openai.cli.quota, executable, spawnImpl, signal: controller.signal, platform: "win32", env: { SystemRoot: "C:\\Windows" }, timeoutMs: 5000 });
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  const quota = await pending;
  assert.equal(quota.available, false);
  assert.match(quota.reason, /취소/);
  assert.equal(child.killed, true);
  assert.ok(calls.some(call => call.file === path.join("C:\\Windows", "System32", "taskkill.exe") && call.args.includes("/T")));

  let timeoutChild;
  // The production timeout is intentionally unref'd so it cannot hold an idle
  // desktop process open. Keep this unit-test process alive until it fires.
  const keepAlive = setTimeout(() => {}, 500);
  const timedOut = await readCliQuota({
    descriptor: adapters.openai.cli.quota, executable, timeoutMs: 5, platform: "linux",
    spawnImpl: (_file, args) => { if (args.includes("/PID")) return new EventEmitter(); timeoutChild = makeChild({ answer: false }); return timeoutChild; },
  });
  clearTimeout(keepAlive);
  assert.equal(timedOut.available, false);
  assert.equal(timeoutChild.killed, true);
});

test("quota normalization rejects non-finite values and handles epoch, ISO, and fraction inputs", () => {
  assert.equal(normalizePercent(Number.NaN), null);
  assert.equal(normalizePercent(-1), null);
  assert.equal(normalizePercent(0.37), 0.37);
  assert.equal(normalizePercent(37), 37);
  assert.equal(normalizeTimestamp(1_800_000_000), Date.parse("2027-01-15T08:00:00.000Z"));
  assert.equal(normalizeTimestamp("2027-01-16T12:00:00Z"), Date.parse("2027-01-16T12:00:00.000Z"));
  assert.equal(normalizeTimestamp(Infinity), null);
});
