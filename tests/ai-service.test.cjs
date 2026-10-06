"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CommonAiService } = require("../electron/ai-service.cjs");
const { buildAiContext } = require("../electron/ai-context.cjs");
const { loadTestAdapters, fakeComponentManager } = require("./ai-test-adapters.cjs");

let providerAdapters;
test.before(async () => { providerAdapters = await loadTestAdapters(); });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "streamer-ai-service-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function testStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) { return Buffer.from(String(value).split("").reverse().join(""), "utf8"); },
    decryptString(value) { return Buffer.from(value).toString("utf8").split("").reverse().join(""); },
  };
}

function fakeRuntime() {
  return {
    snapshot: () => ({ components: [], byId: {} }),
    detect: async id => ({ id, status: "available" }),
    resolve: async () => null,
    pin: async id => id === "codex" ? "C:\\tools\\codex.exe" : "C:\\tools\\fake.exe",
    release() {},
  };
}

function serviceOptions(root, extra = {}) {
  return { root, storage: testStorage(), runtime: fakeRuntime(), components: fakeComponentManager(providerAdapters), ...extra };
}

async function waitUntil(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("AI job did not finish in time");
}

test("API key stays encrypted and is redacted from saved settings, IPC, and persisted result text", async t => {
  const root = fixture(t);
  const storage = testStorage();
  const secret = "super-secret-ai-key-123";
  let runConfig;
  const service = new CommonAiService({
    ...serviceOptions(root, { storage }),
    contextBuilder: async ({ request }) => ({
      prompt: { system: "system", user: request },
      preview: { totalEvents: 1, sampledEvents: 1, bytes: 40, estimatedTokens: 11, truncated: false, scope: { sessionId: null, sessionIds: ["s1"], dateFrom: null, dateTo: null } },
    }),
    api: {
      async listModels() { return [{ id: "verified-from-api", efforts: ["low", "high"] }]; },
      async runApi({ key, model, effort, onText }) {
        assert.equal(key, secret);
        runConfig = { model, effort };
        onText("The key is ");
        onText(secret);
        return {
          text: `The key is ${secret}`,
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          cost: { amount: 0.0001, currency: "USD", estimated: true, source: `https://example.com/${secret}` },
        };
      },
    },
  });

  await service.saveKey({ providerId: "openai", key: secret });
  const queried = await service.modelList({ providerId: "openai", mode: "api" });
  assert.deepEqual(queried.models.map(row => row.id), ["verified-from-api"]);
  await service.save({ providerId: "openai", enabled: true, mode: "api", model: "verified-from-api", effort: "default" });
  const settingsText = fs.readFileSync(path.join(root, "ai", "settings.json"), "utf8");
  assert.equal(settingsText.includes(secret), false);
  assert.equal(fs.readFileSync(path.join(root, "ai", "credentials.enc"), "utf8").includes(secret), false);
  assert.equal(JSON.stringify(service.snapshot()).includes(secret), false);

  const { id } = await service.handle("ai-run", {
    providerId: "openai", mode: "cli", model: "unverified-override", effort: "high",
    prompt: `Analyze this key: ${secret}`, scope: {},
  }, { sessions: () => [{ id: "s1" }], timelineStore: {} });
  await waitUntil(() => !["preparing", "running"].includes(service.jobs.get(id)?.status));
  const job = service.getJob(id);
  assert.equal(job.status, "completed");
  assert.deepEqual(runConfig, { model: "verified-from-api", effort: "default" });
  assert.equal(job.text.includes(secret), false);
  assert.equal(job.cost.source.includes(secret), false);
  assert.equal(JSON.stringify(service.snapshot()).includes(secret), false);
  const persisted = storage.decryptString(fs.readFileSync(path.join(root, "ai", "results.enc")));
  assert.equal(persisted.includes(secret), false, persisted);
  service.shutdown();
});

test("CLI environment separates cached sign-in from DeepSeek's explicit API key", t => {
  const root = fixture(t);
  const service = new CommonAiService(serviceOptions(root));
  const envKeys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"];
  const old = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of envKeys) old[key] === undefined ? delete process.env[key] : process.env[key] = old[key]; });
  process.env.OPENAI_API_KEY = "inherited-openai-secret";
  process.env.ANTHROPIC_API_KEY = "inherited-claude-secret";
  assert.equal(service.envFor({ id: "openai" }, "saved-openai-key").OPENAI_API_KEY, undefined);
  assert.equal(service.envFor({ id: "openai" }, "saved-openai-key").ANTHROPIC_API_KEY, undefined);
  assert.equal(service.envFor({ id: "deepseek" }, "saved-deepseek-key").DEEPSEEK_API_KEY, "saved-deepseek-key");

  const jobDir = path.join(root, "job");
  fs.mkdirSync(jobDir);
  const openaiPlan = providerAdapters.openai.cli.analysisPlan({ model: "gpt-6-luna", effort: "high", prompt: "prompt", jobDirectory: jobDir, verifiedModels: [] });
  assert.equal(openaiPlan.promptMode, "stdin");
  assert.equal(openaiPlan.args.join(" ").includes("saved-openai-key"), false);
  const deepseekPlan = providerAdapters.deepseek.cli.analysisPlan({ model: "deepseek-v4-pro", effort: "high", prompt: "prompt", jobDirectory: jobDir, verifiedModels: [{ id: "deepseek-v4-pro", efforts: ["low", "high", "max"] }] });
  assert.ok(deepseekPlan.args.length > 0);
  assert.equal(deepseekPlan.args.join(" ").includes("saved-deepseek-key"), false);
  service.shutdown();
});

test("CLI model choices come from the pinned executable and DeepSeek CLI effort options are verified", async t => {
  const root = fixture(t);
  const secret = "deepseek-model-query-secret";
  const service = new CommonAiService({
    ...serviceOptions(root),
    runtime: { ...fakeRuntime(), async pin() { return "C:\\tools\\codex.exe"; }, release() {} },
    api: { async listModels() { return [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }, { id: "deepseek-future-model" }]; } },
    async cliModelReader(options) {
      assert.equal(options.cliId, "codex");
      assert.equal(options.providerId, "deepseek");
      assert.equal(options.env.DEEPSEEK_API_KEY, secret);
      assert.equal(options.configArgs.join(" ").includes(secret), false);
      assert.ok(options.configArgs.some(value => value.includes("model_catalog_json=")));
      const document = JSON.parse(fs.readFileSync(path.join(options.cwd, "deepseek-models.json"), "utf8"));
      assert.deepEqual(document.models.map(row => row.slug), ["deepseek-flash", "deepseek-v4-pro", "deepseek-future-model"]);
      assert.deepEqual(document.models.map(row => row.supported_reasoning_levels.map(effort => effort.effort)), [["low", "high", "max"], ["low", "high", "max"], []]);
      return { models: [{ id: "deepseek-flash", efforts: ["low", "high", "max"], effortsReported: true }], currentModelId: "deepseek-flash" };
    },
  });
  t.after(() => service.shutdown());
  await service.saveKey({ providerId: "deepseek", key: secret });
  const result = await service.modelList({ providerId: "deepseek", mode: "cli" });
  assert.equal(result.source, "cli");
  assert.deepEqual(result.models.map(row => row.id), ["deepseek-flash"]);
  assert.deepEqual(result.models[0].efforts, ["default", "low", "high", "max"]);
  assert.throws(() => service.modelOptions({ providerId: "deepseek", mode: "cli", model: "manually-entered" }), /조회하세요/);
  await service.save({ providerId: "deepseek", mode: "cli", model: "deepseek-flash", effort: "high", enabled: true });
  assert.equal(service.snapshot().providers.find(row => row.id === "deepseek").models[0].id, "deepseek-flash");
});

test("imported compatible API reuses its protocol module for live model listing and saves the selected model", async t => {
  const root = fixture(t);
  const importFile = path.join(root, "local-api.json");
  fs.writeFileSync(importFile, JSON.stringify({
    schemaVersion: 1, type: "custom-provider", id: "custom-local", name: "Local API",
    protocol: "chat", baseUrl: "http://127.0.0.1:40123/v1", models: [],
  }));
  const calls = [];
  const service = new CommonAiService({
    ...serviceOptions(root),
    api: {
      async listModels({ provider, adapter, key }) {
        calls.push({ provider, adapterId: adapter.provider.id, key });
        return [{ id: "live-local-model" }];
      },
    },
  });
  t.after(() => service.shutdown());

  service.importDataFile(importFile);
  await service.saveKey({ providerId: "custom-local", key: "local-api-secret" });
  const listed = await service.modelList({ providerId: "custom-local", mode: "api" });
  assert.deepEqual(listed.models.map(row => row.id), ["live-local-model"]);
  assert.equal(calls[0].provider.custom, true);
  assert.equal(calls[0].provider.protocol, "chat");
  assert.equal(calls[0].adapterId, "deepseek");
  assert.equal(calls[0].key, "local-api-secret");
  const state = service.snapshot().providers.find(row => row.id === "custom-local");
  assert.equal(state.name, "Local API");
  assert.equal(state.models[0].id, "live-local-model");
  assert.equal(state.component.version, "test-verified");

  await service.save({ providerId: "custom-local", enabled: true, mode: "api", model: "live-local-model", effort: "default" });
  assert.equal(service.snapshot().providers.find(row => row.id === "custom-local").enabled, true);
  assert.equal(JSON.stringify(service.snapshot()).includes("local-api-secret"), false);
});

test("job cleanup only removes canonical UUID directories under the AI jobs root", t => {
  const root = fixture(t);
  const service = new CommonAiService(serviceOptions(root));
  t.after(() => service.shutdown());
  const outside = path.join(root, "keep.txt");
  fs.writeFileSync(outside, "keep");
  const id = "4c0b00e5-1dd6-4f37-8611-961919f81ae3";
  assert.equal(service.removeJobDirectory(outside, id), false);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep");

  const stale = path.join(service.jobsDirectory, id);
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(stale, "plaintext.tmp"), "stale");
  const restarted = new CommonAiService(serviceOptions(root));
  t.after(() => restarted.shutdown());
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep");

  const linkedId = "4c0b00e5-1dd6-4f37-8611-961919f81ae4";
  const linked = path.join(restarted.jobsDirectory, linkedId);
  try {
    fs.symlinkSync(root, linked, "junction");
    assert.equal(restarted.removeJobDirectory(linked, linkedId), false);
    assert.equal(fs.readFileSync(outside, "utf8"), "keep");
    assert.equal(fs.existsSync(linked), true);
  } catch (error) {
    if (!new Set(["EPERM", "EACCES", "ENOTSUP"]).has(error?.code)) throw error;
  }
});

test("data-only capability and pricing imports survive restart and affect model options", t => {
  const root = fixture(t);
  const capabilityFile = path.join(root, "capabilities.json");
  fs.writeFileSync(capabilityFile, JSON.stringify({ schemaVersion: 1, type: "model-capabilities", providerId: "openai", models: [{ id: "gpt-6-luna", efforts: ["low", "medium", "high", "max"] }] }));
  const pricingFile = path.join(root, "pricing.json");
  fs.writeFileSync(pricingFile, JSON.stringify({ schemaVersion: 1, type: "model-pricing", providerId: "openai", modelId: "gpt-6-luna", currency: "USD", inputPerMillion: 1, outputPerMillion: 2, source: "https://example.com/pricing", checkedAt: "2026-10-06" }));
  const service = new CommonAiService(serviceOptions(root));
  service.settings.modelCache.openai = { api: { models: [{ id: "gpt-6-luna", efforts: ["low", "medium", "high", "max"], effortsReported: true }], source: "api", queriedAt: new Date().toISOString(), componentVersion: "test-verified" } };
  service.importDataFile(capabilityFile);
  service.importDataFile(pricingFile);
  assert.deepEqual(service.modelOptions({ providerId: "openai", mode: "api", model: "gpt-6-luna" }).efforts, ["default", "low", "medium", "high", "max"]);
  assert.equal(service.modelRows(service.provider("openai"), "api").find(row => row.id === "gpt-6-luna").pricing.inputPerMillion, 1);
  const restarted = new CommonAiService(serviceOptions(root));
  assert.ok(restarted.modelOptions({ providerId: "openai", mode: "api", model: "gpt-6-luna" }).efforts.includes("max"));
  assert.equal(restarted.pricingFor("openai", "gpt-6-luna").outputPerMillion, 2);
  service.shutdown();
  restarted.shutdown();
});

test("context includes bounded whole-scope analysis with HMAC identities and filtered viewer sources", async () => {
  const startedAt = Date.parse("2026-10-06T00:00:00Z");
  const session = {
    id: "session-1", startedAt,
    markers: [{ at: 10_000, timecode: "00:00:10", kind: "surge", label: "message spike", evidence: { messages: 12, unique: 4, samples: ["lively chat"] } }],
  };
  const events = [
    { type: "participant", key: "hmac-speaker-key", platform: "chzzk", platformUserId: "raw-user-id", displayName: "Real Name", subscriber: true, roles: ["member"], badges: ["gold"], timestamp: startedAt + 1000 },
    { type: "chat", seq: 2, platform: "chzzk", participantKey: "hmac-speaker-key", displayName: "Real Name", text: "질문이 있어요", timestamp: startedAt + 2000 },
    { type: "donation", seq: 3, platform: "youtube", participantKey: "hmac-speaker-key", amountMicros: 12500000, currency: "KRW", text: "응원합니다", timestamp: startedAt + 3000 },
    { type: "viewers", seq: 4, timestamp: startedAt + 4000, sources: [{ platform: "chzzk", count: 45, available: true, live: true }, { platform: "youtube", count: 12, available: true, live: true }] },
  ];
  const store = {
    dayOf: () => "2026-10-06",
    async *events() { yield* events; },
  };
  const result = await buildAiContext({ store, sessions: [session], scope: {}, request: "Summarize topics", mode: "api" });
  const data = JSON.parse(result.prompt.user.split("## Selected timeline data\n")[1]);
  const chat = data.sampledEvents.find(row => row.type === "chat");
  const donation = data.sampledEvents.find(row => row.type === "donation");
  const viewers = data.sampledEvents.find(row => row.type === "viewers");
  assert.equal(chat.participantKey, "hmac-speaker-key");
  assert.equal(chat.speaker, "시청자_hmac-spe");
  assert.deepEqual(chat.badges, ["gold"]);
  assert.deepEqual(chat.roles, ["member"]);
  assert.equal(chat.subscriber, true);
  assert.equal("platformUserId" in chat, false);
  assert.equal(donation.amountMicros, 12500000);
  assert.equal(viewers.sources.length, 2);
  assert.equal(result.preview.totalEvents, 3);
  assert.ok(result.stats.minuteCounts.length > 0);
  assert.ok(result.prompt.user.includes("message spike"));
});

test("provider CLI event hooks normalize text, usage, and failure without exposing raw fields", () => {
  const claudeText = providerAdapters.anthropic.cli.parseEvent({ event: { type: "content_block_delta", delta: { type: "text_delta", text: "answer" } } });
  assert.equal(claudeText.text, "answer");
  assert.equal(claudeText.appendText, true);
  const claudeUsage = providerAdapters.anthropic.cli.parseEvent({ event: { type: "result", usage: { input_tokens: 5, output_tokens: 7 }, is_error: false } });
  assert.equal(claudeUsage.done, true);
  assert.deepEqual(claudeUsage.usage, { inputTokens: 5, uncachedInputTokens: 5, outputTokens: 7, totalTokens: 12 });
  const googleText = providerAdapters.google.cli.parseEvent({ event: { type: "agent_response", text: "partial" } });
  assert.equal(googleText.text, "partial");
  const denied = providerAdapters.google.cli.parseEvent({ event: { type: "ERROR", text: "must not be returned" } });
  assert.equal(denied.error, "cli_provider_error");
  assert.equal(denied.text, undefined);
});
