"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { readCliModels } = require("../electron/ai-models.cjs");
const { loadTestAdapters } = require("./ai-test-adapters.cjs");
let adapters;
test.before(async () => { adapters = await loadTestAdapters(); });

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-models-tests-"));
const executable = path.join(tempRoot, "fake-cli.exe");
fs.writeFileSync(executable, "fixture only");

class FakeChild extends EventEmitter {
  constructor(onRequest) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
    this.requests = [];
    let pending = "";
    this.stdin = new Writable({
      write: (chunk, encoding, callback) => {
        pending += chunk.toString();
        while (pending.includes("\n")) {
          const at = pending.indexOf("\n");
          const line = pending.slice(0, at);
          pending = pending.slice(at + 1);
          if (line) {
            const request = JSON.parse(line);
            this.requests.push(request);
            onRequest?.(request, this);
          }
        }
        callback();
      },
    });
  }

  reply(value, newline = true) {
    this.stdout.write(`${JSON.stringify(value)}${newline ? "\n" : ""}`);
  }

  kill() {
    if (this.killed) return false;
    this.killed = true;
    this.emit("close", null, "SIGTERM");
    return true;
  }
}

function protocolSpawn(onRequest, capture = {}) {
  return (file, args, options) => {
    capture.file = file;
    capture.args = args;
    capture.options = options;
    capture.child = new FakeChild(onRequest);
    return capture.child;
  };
}

function plainSpawn(output, capture = {}, exitCode = 0) {
  return (file, args, options) => {
    capture.file = file;
    capture.args = args;
    capture.options = options;
    capture.child = new FakeChild();
    queueMicrotask(() => {
      capture.child.stdout.write(output);
      capture.child.emit("close", exitCode, null);
    });
    return capture.child;
  };
}

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test("Codex app-server lists model pages and advertised reasoning levels without starting a turn", async () => {
  let page = 0;
  const capture = {};
  const spawnImpl = protocolSpawn((request, child) => {
    if (request.method === "initialize") child.reply({ jsonrpc: "2.0", id: request.id, result: {} });
    if (request.method === "model/list") {
      page += 1;
      child.reply({ jsonrpc: "2.0", id: request.id, result: page === 1
        ? { data: [{ model: "codex-current", displayName: "Codex Current", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], defaultReasoningEffort: "high" }], nextCursor: "next" }
        : { data: [{ model: "codex-next", supportedReasoningEfforts: [] }] } });
    }
  }, capture);

  const result = await readCliModels({ cliId: "codex", adapter: adapters.openai.cli.models, configArgs: [], executable, spawnImpl });
  assert.deepEqual(result.models, [
    { id: "codex-current", name: "Codex Current", effortsReported: true, efforts: ["low", "high"], defaultEffort: "high" },
    { id: "codex-next", effortsReported: true, efforts: [] },
  ]);
  assert.equal(result.source, "cli");
  assert.ok(Number.isFinite(Date.parse(result.queriedAt)));
  assert.deepEqual(capture.args, ["app-server"]);
  assert.deepEqual(capture.options.stdio, ["pipe", "pipe", "ignore"]);
  assert.equal(capture.options.shell, false);
  assert.deepEqual(capture.child.requests.map(item => item.method), ["initialize", "initialized", "model/list", "model/list"]);
  assert.equal(capture.child.requests.some(item => /thread|prompt|turn/i.test(item.method || "")), false);
  assert.deepEqual(capture.child.requests[2].params, { limit: 100 });
  assert.deepEqual(capture.child.requests[3].params, { limit: 100, cursor: "next" });
});

test("DeepSeek catalog overrides precede the Codex query and credentials stay out of argv", async () => {
  const secret = "fixture-secret-should-not-be-in-argv";
  const jobDirectory = path.join(tempRoot, "deepseek-query");
  fs.mkdirSync(jobDirectory, { recursive: true });
  const plan = adapters.deepseek.cli.models.buildPlan({ jobDirectory, liveModels: [{ id: "deepseek-example", efforts: ["low", "high"] }] });
  for (const file of plan.files) fs.writeFileSync(path.join(jobDirectory, file.relativePath), file.contents);
  const configArgs = plan.args;
  const catalog = JSON.parse(fs.readFileSync(path.join(jobDirectory, "deepseek-models.json"), "utf8"));
  assert.equal(catalog.models[0].slug, "deepseek-example");
  const capture = {};
  const spawnImpl = protocolSpawn((request, child) => {
    if (request.method === "initialize") child.reply({ jsonrpc: "2.0", id: 1, result: {} });
    if (request.method === "model/list") child.reply({ jsonrpc: "2.0", id: request.id, result: { data: [{ model: "deepseek-chat", supportedReasoningEfforts: ["none", "high"] }] } });
  }, capture);
  const result = await readCliModels({ cliId: "codex", adapter: adapters.deepseek.cli.models, executable, configArgs, env: { DEEPSEEK_API_KEY: secret }, spawnImpl });
  assert.deepEqual(result.models[0].efforts, ["none", "high"]);
  assert.deepEqual(capture.args, [...configArgs, "app-server"]);
  assert.equal(capture.args.join(" ").includes(secret), false);
  assert.equal(capture.options.env.DEEPSEEK_API_KEY, secret);
});

test("Grok uses only its documented `models` output and preserves the CLI default", async () => {
  const output = [
    "You are using XAI_API_KEY.", "", "Default model: grok-example-fast", "", "Available models:",
    " * grok-example-fast (default)", " - grok-example-reasoning", "",
  ].join("\n");
  const capture = {};
  const plan = adapters.xai.cli.models.buildPlan({});
  const result = await readCliModels({ cliId: "grok", adapter: adapters.xai.cli.models, configArgs: plan.args, executable, spawnImpl: plainSpawn(output, capture) });
  assert.deepEqual(capture.args, plan.args);
  assert.equal(result.currentModelId, "grok-example-fast");
  assert.deepEqual(result.models.map(item => item.id), ["grok-example-fast", "grok-example-reasoning"]);
});

test("Antigravity uses its documented JSON model-list mode", async () => {
  const capture = {};
  const plan = adapters.google.cli.models.buildPlan({});
  const result = await readCliModels({
    cliId: "agy", adapter: adapters.google.cli.models, configArgs: plan.args, executable,
    spawnImpl: plainSpawn(JSON.stringify({ currentModelId: "gemini-example", models: [{ id: "gemini-example", name: "Gemini Example", supportedReasoningEfforts: ["low", "high"] }] }), capture),
  });
  assert.deepEqual(capture.args, plan.args);
  assert.equal(result.currentModelId, "gemini-example");
  assert.deepEqual(result.models[0], { id: "gemini-example", name: "Gemini Example", effortsReported: true, efforts: ["low", "high"] });
});

test("Kimi ACP initializes a fresh empty session but never requests a user prompt", async () => {
  let tempDirectory;
  const capture = {};
  const spawnImpl = protocolSpawn((request, child) => {
    if (request.method === "initialize") child.reply({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } });
    if (request.method === "session/new") {
      tempDirectory = request.params.cwd;
      assert.equal(fs.readdirSync(tempDirectory).length, 0);
      assert.deepEqual(request.params.mcpServers, []);
      child.reply({ jsonrpc: "2.0", id: 2, result: {
        sessionId: "fixture-session",
      configOptions: [{ id: "model", category: "model", currentValue: "kimi-example", options: [{ value: "kimi-example", name: "Kimi Example" }, { value: "kimi-next" }] }],
      } });
    }
  }, capture);
  const plan = adapters.moonshot.cli.models.buildPlan({});
  const result = await readCliModels({ cliId: "kimi", adapter: adapters.moonshot.cli.models, configArgs: plan.args, executable, spawnImpl });
  assert.deepEqual(capture.args, ["acp"]);
  assert.equal(result.currentModelId, "kimi-example");
  assert.deepEqual(result.models, [{ id: "kimi-example", name: "Kimi Example", effortsReported: false, efforts: [] }, { id: "kimi-next", effortsReported: false, efforts: [] }]);
  assert.deepEqual(capture.child.requests.map(item => item.method), ["initialize", "session/new"]);
  assert.equal(capture.child.requests.some(item => item.method?.includes("prompt")), false);
  assert.equal(fs.existsSync(tempDirectory), false);
});

test("Claude reads model metadata from the initialize control response without a prompt", async () => {
  const capture = {};
  const spawnImpl = protocolSpawn((request, child) => {
    if (request.type === "control_request" && request.request.subtype === "initialize") {
      child.reply({ type: "control_response", response: { subtype: "success", request_id: request.request_id, response: { models: [
        { value: "claude-example", displayName: "Claude Example", supportsEffort: true, supportedEffortLevels: ["low", "high"] },
        { value: "claude-no-effort", displayName: "Claude No Effort", supportsEffort: false },
      ] } } });
    }
  }, capture);
  const plan = adapters.anthropic.cli.models.buildPlan({});
  const result = await readCliModels({ cliId: "claude", adapter: adapters.anthropic.cli.models, configArgs: plan.args, executable, spawnImpl });
  assert.deepEqual(capture.args, plan.args);
  assert.deepEqual(result.models, [
    { id: "claude-example", name: "Claude Example", effortsReported: true, efforts: ["low", "high"], supportsEffort: true },
    { id: "claude-no-effort", name: "Claude No Effort", effortsReported: false, efforts: [], supportsEffort: false },
  ]);
  assert.equal(capture.child.requests.length, 1);
  assert.equal(JSON.stringify(capture.child.requests).includes("user"), false);
  assert.equal(capture.args.includes("--print"), false);
});

test("invalid provider pair, path, protocol output, and credential-bearing args are rejected", async () => {
  let spawnCount = 0;
  const spawnImpl = (...args) => { spawnCount += 1; return plainSpawn("", {})(...args); };
  await assert.rejects(readCliModels({ cliId: "grok", adapter: adapters.openai.cli.models, executable, spawnImpl }), /provider module/);
  await assert.rejects(readCliModels({ cliId: "grok", adapter: adapters.xai.cli.models, executable: "relative.exe", spawnImpl }), /absolute/);
  await assert.rejects(readCliModels({ cliId: "grok", adapter: adapters.xai.cli.models, executable, configArgs: adapters.xai.cli.models.buildPlan({}).args, spawnImpl: plainSpawn("unexpected output\n") }), /parse its CLI model output/);
  await assert.rejects(readCliModels({
    cliId: "codex", adapter: adapters.deepseek.cli.models, executable, env: { DEEPSEEK_API_KEY: "do-not-put-me-in-args" },
    configArgs: ["-c", 'api_key="do-not-put-me-in-args"'], spawnImpl,
  }), /Credential values/);
  assert.equal(spawnCount, 0);
});

test("aborting a pending protocol query terminates it", async () => {
  const controller = new AbortController();
  const capture = {};
  const promise = readCliModels({
    cliId: "codex", adapter: adapters.openai.cli.models, executable, configArgs: [], signal: controller.signal,
    spawnImpl: protocolSpawn(() => {}, capture), timeoutMs: 3000,
  });
  controller.abort();
  await assert.rejects(promise, /cancelled/);
  assert.equal(capture.child.killed, true);
});

test("Windows cancellation requests process-tree termination without launching taskkill in the test", async () => {
  const controller = new AbortController();
  const capture = {};
  const treeCalls = [];
  const promise = readCliModels({
    cliId: "codex", adapter: adapters.openai.cli.models, executable, configArgs: [], signal: controller.signal,
    spawnImpl: protocolSpawn(() => {}, capture), timeoutMs: 3000,
    platform: "win32",
    killTreeImpl: (...args) => treeCalls.push(args),
  });
  capture.child.pid = 4321;
  controller.abort();
  await assert.rejects(promise, /cancelled/);
  assert.equal(capture.child.killed, true);
  assert.equal(treeCalls.length, 1);
  assert.deepEqual(treeCalls[0][1], ["/PID", "4321", "/T", "/F"]);
  assert.equal(treeCalls[0][2].shell, false);
});

test("model discovery enforces the stdout byte cap", async () => {
  const oversized = `${JSON.stringify({ models: [{ id: "overflow" }] })}\n` + " ".repeat(256 * 1024);
  await assert.rejects(
    readCliModels({ cliId: "agy", adapter: adapters.google.cli.models, executable, spawnImpl: plainSpawn(oversized) }),
    /size limit/,
  );
});
