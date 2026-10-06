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
  const components = Object.prototype.hasOwnProperty.call(extra, "components") ? extra.components : fakeComponentManager(providerAdapters);
  if (components && typeof components.update !== "function") components.update = async id => components.snapshot().byId?.[id] || null;
  return { root, storage: testStorage(), runtime: fakeRuntime(), ...extra, components };
}

function fakeLoginManager() {
  const states = new Map();
  const attempts = new Map();
  const calls = { start: 0, cancel: 0, confirmLogout: 0, openBrowser: 0, shutdown: 0 };
  return {
    calls,
    startOptions: null,
    openOptions: null,
    snapshot(providerId) { return states.get(providerId) || { supported: false, status: "idle", id: null, startedAt: null }; },
    async start(options) {
      calls.start++;
      this.startOptions = options;
      const state = { id: "test-login-id", startedAt: new Date().toISOString(), supported: true, kind: options.descriptor.kind, operation: options.operation || "login", status: "waiting", message: "인증을 기다리는 중입니다.", url: "https://auth.example.test/device", code: "ABCD-EFGH", method: "device", terminalClosed: false };
      states.set(options.providerId, state);
      attempts.set(options.providerId, options);
      return { id: "test-login-id", state };
    },
    async cancel(providerId) {
      calls.cancel++;
      const options = attempts.get(providerId);
      const state = { ...(states.get(providerId) || {}), supported: true, status: "canceled" };
      states.set(providerId, state);
      attempts.delete(providerId);
      await options?.onExit?.({ providerId, id: "test-login-id", status: "canceled" });
      return state;
    },
    async complete(providerId, patch) {
      const options = attempts.get(providerId);
      const state = { ...(states.get(providerId) || {}), ...patch };
      states.set(providerId, state);
      attempts.delete(providerId);
      await options?.onExit?.({ providerId, id: "test-login-id", status: state.status });
      return state;
    },
    async confirmLogout(providerId) {
      calls.confirmLogout++;
      const state = { ...(states.get(providerId) || {}), operation: "logout", status: "succeeded", terminalClosed: true, message: "수동 로그아웃을 확인했습니다." };
      states.set(providerId, state);
      return state;
    },
    async openBrowser(providerId, options) {
      calls.openBrowser++;
      this.openOptions = { providerId, ...options };
      return { opened: true };
    },
    async shutdown() {
      calls.shutdown++;
      for (const providerId of [...attempts.keys()]) await this.cancel(providerId);
    },
  };
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

  await service.handle("ai-provider-add", { providerId: "openai" });
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
  await service.handle("ai-provider-add", { providerId: "deepseek" });
  await service.saveKey({ providerId: "deepseek", key: secret });
  const result = await service.modelList({ providerId: "deepseek", mode: "cli" });
  assert.equal(result.source, "cli");
  assert.equal(service.snapshot().providers.find(row => row.id === "deepseek").hasCliSession, true);
  assert.deepEqual(result.models.map(row => row.id), ["deepseek-flash"]);
  assert.deepEqual(result.models[0].efforts, ["default", "low", "high", "max"]);
  assert.throws(() => service.modelOptions({ providerId: "deepseek", mode: "cli", model: "manually-entered" }), /조회하세요/);
  await service.save({ providerId: "deepseek", mode: "cli", model: "deepseek-flash", effort: "high", enabled: true });
  assert.equal(service.snapshot().providers.find(row => row.id === "deepseek").models[0].id, "deepseek-flash");
});

test("CLI session evidence comes from a successful live CLI query and stays separate from API keys", async t => {
  const root = fixture(t);
  let failQuery = true;
  const service = new CommonAiService(serviceOptions(root, {
    async cliModelReader() {
      if (failQuery) throw new Error("fixture login required");
      return { models: [{ id: "gpt-6-luna", efforts: ["high"], effortsReported: true }] };
    },
  }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "openai" });
  await service.saveKey({ providerId: "openai", key: "unrelated-api-key" });
  await service.save({ providerId: "openai", mode: "api", model: "", enabled: false });
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").hasCliSession, false);
  await assert.rejects(() => service.modelList({ providerId: "openai", mode: "cli" }), /login required/);
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").hasCliSession, false);

  failQuery = false;
  await service.modelList({ providerId: "openai", mode: "cli" });
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").hasCliSession, true);
  const restarted = new CommonAiService(serviceOptions(root));
  t.after(() => restarted.shutdown());
  assert.equal(restarted.snapshot().providers.find(row => row.id === "openai").hasCliSession, true, "CLI evidence survives while the API tab remains selected");
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
  assert.equal(state.added, true);
  assert.equal(state.models[0].id, "live-local-model");
  assert.equal(state.component.version, "test-verified");

  await service.save({ providerId: "custom-local", enabled: true, mode: "api", model: "live-local-model", effort: "default" });
  assert.equal(service.snapshot().providers.find(row => row.id === "custom-local").enabled, true);
  assert.equal(JSON.stringify(service.snapshot()).includes("local-api-secret"), false);
});

test("built-ins start unadded, and add/remove preserves saved credentials without invoking CLI or module operations", async t => {
  const root = fixture(t);
  let runtimeOperations = 0;
  const runtime = {
    ...fakeRuntime(),
    async detect() { runtimeOperations++; return { status: "available" }; },
    async pin() { runtimeOperations++; return "C:\\tools\\codex.exe"; },
    async install() { runtimeOperations++; },
    async remove() { runtimeOperations++; },
  };
  const service = new CommonAiService(serviceOptions(root, { runtime, components: null }));
  t.after(() => service.shutdown());
  assert.equal(service.snapshot().providers.filter(row => row.added).length, 0);

  const warmRoot = fixture(t);
  const warmCache = new CommonAiService(serviceOptions(warmRoot));
  t.after(() => warmCache.shutdown());
  await warmCache.componentsReady;
  assert.equal(warmCache.snapshot().providers.filter(row => row.added).length, 0, "a fresh profile stays empty even if adapter files are cached");

  await service.handle("ai-provider-add", { providerId: "openai" });
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").added, true);
  assert.equal(runtimeOperations, 0, "adding a connection must not inspect or launch its native CLI");
  await service.saveKey({ providerId: "openai", key: "retained-provider-key" });

  const componentOperations = { detect: 0, pin: 0, install: 0, remove: 0 };
  const componentRow = { id: "openai", status: "ready", version: "test-verified", source: "test-fixture", progress: 1 };
  const components = {
    snapshot: () => ({ components: [componentRow], byId: { openai: componentRow } }),
    load: id => id === "openai" ? providerAdapters.openai : null,
    async detect(id) { componentOperations.detect++; return id === "openai" ? componentRow : { id, status: "not-installed" }; },
    async pin(id) { componentOperations.pin++; return { version: "test-verified", adapter: providerAdapters[id] }; },
    async install() { componentOperations.install++; },
    async remove() { componentOperations.remove++; },
    release() {},
  };
  service.components = components;
  service.adapterCache.set("openai", providerAdapters.openai);
  service.settings.modelCache.openai = {
    api: {
      models: [{ id: "gpt-6-luna", efforts: ["default", "low"], effortsReported: true }],
      source: "api", queriedAt: new Date().toISOString(), componentVersion: "test-verified",
    },
  };
  await service.save({ providerId: "openai", enabled: true, mode: "api", model: "gpt-6-luna", effort: "default" });
  componentOperations.detect = componentOperations.pin = componentOperations.install = componentOperations.remove = 0;
  runtimeOperations = 0;

  const removed = await service.handle("ai-provider-remove", { providerId: "openai" });
  const row = removed.providers.find(provider => provider.id === "openai");
  assert.equal(row.added, false);
  assert.equal(row.enabled, false);
  assert.equal(row.model, "gpt-6-luna");
  assert.equal(row.hasKey, true);
  assert.deepEqual(componentOperations, { detect: 0, pin: 0, install: 0, remove: 0 });
  assert.equal(runtimeOperations, 0);

  const restarted = new CommonAiService(serviceOptions(root, { runtime, components }));
  t.after(() => restarted.shutdown());
  await restarted.componentsReady;
  let persisted = restarted.snapshot().providers.find(provider => provider.id === "openai");
  assert.equal(persisted.added, false, "explicit removal stays removed even when credentials and adapter remain installed");
  assert.equal(persisted.enabled, false);
  assert.equal(persisted.hasKey, true);

  componentOperations.detect = componentOperations.pin = componentOperations.install = componentOperations.remove = 0;
  runtimeOperations = 0;
  await restarted.handle("ai-provider-add", { providerId: "openai" });
  persisted = restarted.snapshot().providers.find(provider => provider.id === "openai");
  assert.equal(persisted.added, true);
  assert.equal(persisted.hasKey, true);
  assert.deepEqual(componentOperations, { detect: 0, pin: 0, install: 0, remove: 0 });
  assert.equal(runtimeOperations, 0);
});

test("legacy settings infer added state from configured connections and installed provider modules", async t => {
  const root = fixture(t);
  const initial = new CommonAiService(serviceOptions(root, { components: null }));
  await initial.handle("ai-provider-add", { providerId: "openai" });
  await initial.saveKey({ providerId: "openai", key: "legacy-openai-key" });
  initial.settings.providers.openai = { ...initial.config(initial.provider("openai")), enabled: true, model: "old-selected-model" };
  initial.saveSettings();
  initial.shutdown();

  const settingsFile = path.join(root, "ai", "settings.json");
  const legacy = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  delete legacy.providers.openai.added;
  fs.writeFileSync(settingsFile, JSON.stringify(legacy));
  const migrated = new CommonAiService(serviceOptions(root, { components: null }));
  t.after(() => migrated.shutdown());
  const restored = migrated.snapshot().providers.find(provider => provider.id === "openai");
  assert.equal(restored.added, true);
  assert.equal(restored.enabled, true);
  assert.equal(restored.model, "old-selected-model");
  assert.equal(restored.hasKey, true);
  assert.equal(restored.hasCliSession, true, "an existing active CLI model restores the observed session");

  const moduleRoot = fixture(t);
  const moduleAi = path.join(moduleRoot, "ai");
  fs.mkdirSync(moduleAi, { recursive: true });
  fs.writeFileSync(path.join(moduleAi, "settings.json"), JSON.stringify({
    schemaVersion: 1,
    providers: { openai: { enabled: false, mode: "api", model: "", effort: "default" } },
  }));
  const installedRow = { id: "openai", status: "ready", version: "test-verified" };
  const components = {
    snapshot: () => ({ components: [installedRow], byId: { openai: installedRow } }),
    load: id => id === "openai" ? providerAdapters.openai : null,
    async detect(id) { return id === "openai" ? installedRow : { id, status: "not-installed" }; },
    async pin(id) { return { version: "test-verified", adapter: providerAdapters[id] }; },
    release() {},
  };
  const fromModule = new CommonAiService(serviceOptions(moduleRoot, { components }));
  t.after(() => fromModule.shutdown());
  assert.equal(fromModule.snapshot().providers.find(provider => provider.id === "openai").added, true);
  assert.equal(fromModule.snapshot().providers.find(provider => provider.id === "openai").hasCliSession, false, "cached modules and an API tab are not CLI authentication");
  assert.equal(fromModule.snapshot().providers.find(provider => provider.id === "deepseek").added, false);
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

test("data-only capability and pricing imports survive restart and affect model options", async t => {
  const root = fixture(t);
  const capabilityFile = path.join(root, "capabilities.json");
  fs.writeFileSync(capabilityFile, JSON.stringify({ schemaVersion: 1, type: "model-capabilities", providerId: "openai", models: [{ id: "gpt-6-luna", efforts: ["low", "medium", "high", "max"] }] }));
  const pricingFile = path.join(root, "pricing.json");
  fs.writeFileSync(pricingFile, JSON.stringify({ schemaVersion: 1, type: "model-pricing", providerId: "openai", modelId: "gpt-6-luna", currency: "USD", inputPerMillion: 1, outputPerMillion: 2, source: "https://example.com/pricing", checkedAt: "2026-10-06" }));
  const service = new CommonAiService(serviceOptions(root));
  await service.handle("ai-provider-add", { providerId: "openai" });
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

test("CLI login is manager-owned, host-filtered, pinned until cancellation, and blocks runtime mutation", async t => {
  const root = fixture(t);
  const secret = "never-pass-this-service-key-to-cli-login";
  const auth = {
    kind: "device", loginArgs: ["auth", "login"], statusArgs: ["auth", "status"], requiresTty: false,
    authHosts: ["auth.example.test"], instructions: "브라우저에서 로그인하세요.",
    keyUrl: "https://platform.openai.test/api-keys",
    parseProgress: () => null, parseStatus: () => null,
  };
  const adapters = {
    ...providerAdapters,
    openai: { ...providerAdapters.openai, cli: { ...providerAdapters.openai.cli, auth } },
  };
  const components = fakeComponentManager(adapters);
  let componentReleases = 0;
  const originalRelease = components.release.bind(components);
  components.release = (...args) => { componentReleases++; return originalRelease(...args); };
  const baseRuntime = fakeRuntime();
  let runtimePins = 0, runtimeReleases = 0, processSpawns = 0;
  const runtime = {
    ...baseRuntime,
    async pin(id) { runtimePins++; return baseRuntime.pin(id); },
    release() { runtimeReleases++; },
  };
  const loginManager = fakeLoginManager();
  const service = new CommonAiService({
    ...serviceOptions(root, { components, runtime, loginManager, spawnImpl() { processSpawns++; throw new Error("service must not spawn a login shell"); } }),
  });
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "openai" });
  await service.saveKey({ providerId: "openai", key: secret });
  service.settings.providers.openai = { ...service.config(service.provider("openai")), mode: "api" };
  service.saveSettings();
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").login.status, "idle");
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").login.supported, true);

  const preparing = await service.handle("ai-login", { providerId: "openai", mode: "cli" });
  assert.equal(preparing.status, "starting");
  await waitUntil(() => loginManager.calls.start === 1);
  const started = service.loginState(service.provider("openai"));
  assert.equal(started.supported, true);
  assert.equal(started.kind, "device");
  assert.equal(started.status, "waiting");
  assert.equal(started.code, "ABCD-EFGH");
  assert.equal(started.url, "https://auth.example.test/device");
  assert.equal(started.keyUrl, "https://platform.openai.test/api-keys");
  assert.equal(loginManager.calls.start, 1);
  assert.equal(loginManager.startOptions.force, true);
  assert.equal(loginManager.startOptions.executable, "C:\\tools\\codex.exe");
  assert.equal(loginManager.startOptions.descriptor, auth);
  assert.equal(loginManager.startOptions.env.OPENAI_API_KEY, undefined);
  assert.equal(loginManager.startOptions.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(path.dirname(loginManager.startOptions.cwd), service.jobsDirectory);
  assert.equal(processSpawns, 0);
  assert.equal(runtimePins, 1);
  assert.equal(JSON.stringify(service.snapshot()).includes(secret), false);

  const polled = await service.handle("ai-login-status", { providerId: "openai" });
  assert.equal(polled.status, "waiting");
  assert.equal(polled.url, "https://auth.example.test/device");
  assert.deepEqual(await service.handle("ai-login-open-browser", { providerId: "openai", mode: "cli" }), { opened: true });
  assert.equal(loginManager.openOptions.providerId, "openai");
  assert.equal(loginManager.openOptions.mode, "cli");
  assert.equal(loginManager.openOptions.descriptor, auth);

  await assert.rejects(() => service.handle("ai-update", { providerId: "openai" }), /로그인이 끝난 뒤 CLI 런타임/);
  await assert.rejects(() => service.handle("ai-adapter-update", { providerId: "openai" }), /로그인이 끝난 뒤 연결 모듈/);
  assert.equal(processSpawns, 0);
  assert.equal(runtimePins, 1);
  assert.equal(runtimeReleases, 0);
  assert.equal(componentReleases, 0);

  const removed = await service.handle("ai-provider-remove", { providerId: "openai" });
  assert.equal(removed.providers.find(row => row.id === "openai").added, false);
  assert.equal(loginManager.calls.cancel, 1);
  assert.equal(runtimeReleases, 1);
  assert.equal(componentReleases, 1);
  assert.equal(loginManager.snapshot("openai").status, "canceled");
});

test("API-key login metadata opens only the signed HTTPS console and never starts a CLI", async t => {
  const root = fixture(t);
  const auth = {
    kind: "api-key", loginArgs: [], requiresTty: false,
    authHosts: ["login.deepseek.example"], instructions: "공식 콘솔에서 API 키를 만드세요.",
    keyUrl: "https://platform.deepseek.example/api_keys",
  };
  const adapters = {
    ...providerAdapters,
    deepseek: { ...providerAdapters.deepseek, cli: { ...providerAdapters.deepseek.cli, auth } },
  };
  const components = fakeComponentManager(adapters);
  const loginManager = fakeLoginManager();
  const runtime = fakeRuntime();
  let runtimePins = 0;
  runtime.pin = async () => { runtimePins++; return "C:\\tools\\codex.exe"; };
  const service = new CommonAiService(serviceOptions(root, { components, runtime, loginManager }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  service.settings.providers.deepseek = { ...service.config(service.provider("deepseek")), added: true, mode: "api" };
  service.saveSettings();

  const state = service.snapshot().providers.find(row => row.id === "deepseek").login;
  assert.equal(state.supported, true);
  assert.equal(state.kind, "api-key");
  assert.equal(state.keyUrl, "https://platform.deepseek.example/api_keys");
  assert.equal((await service.handle("ai-login", { providerId: "deepseek" })).kind, "api-key");
  assert.equal(loginManager.calls.start, 0);
  assert.equal(runtimePins, 0);
  assert.deepEqual(await service.handle("ai-login-open-browser", { providerId: "deepseek", mode: "api" }), { opened: true });
  assert.equal(loginManager.openOptions.mode, "api");
  assert.equal(loginManager.openOptions.descriptor, auth);
  assert.equal(loginManager.calls.start, 0);
  assert.equal(runtimePins, 0);
});

test("API logout removes the encrypted key and saved connection without touching a CLI", async t => {
  const root = fixture(t);
  const loginManager = fakeLoginManager();
  const service = new CommonAiService(serviceOptions(root, { loginManager }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "openai" });
  await service.saveKey({ providerId: "openai", key: "api-key-to-remove" });
  service.settings.providers.openai = { added: true, enabled: true, mode: "api", model: "gpt-6-luna", effort: "high" };
  service.settings.modelCache.openai = { api: { models: [{ id: "gpt-6-luna", efforts: ["high"] }], source: "api", queriedAt: new Date().toISOString(), componentVersion: "test-verified" } };
  service.settings.cliSessions.openai = true;
  service.quotas.set("openai", { available: true, windows: [{ name: "주간", usedPercent: 25 }] });
  service.saveSettings();

  const result = await service.handle("ai-logout", { providerId: "openai", mode: "api" });
  assert.equal(result.status, "succeeded");
  assert.equal(service.getCredentials().openai, undefined);
  assert.equal(loginManager.calls.start, 0);
  assert.deepEqual(service.config(service.provider("openai")), { added: true, enabled: false, mode: "api", model: "", effort: "default" });
  assert.equal(service.settings.modelCache.openai, undefined);
  assert.equal(service.quotas.has("openai"), false);
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").hasCliSession, true, "API logout keeps the separate CLI account signed in");
  const restarted = new CommonAiService(serviceOptions(root));
  t.after(() => restarted.shutdown());
  assert.equal(restarted.snapshot().providers.find(row => row.id === "openai").hasCliSession, true);
  assert.equal(restarted.snapshot().providers.find(row => row.id === "openai").hasKey, false);
});

test("explicit CLI logout overrides the saved API tab and retains its API key", async t => {
  const root = fixture(t);
  const loginManager = fakeLoginManager();
  const service = new CommonAiService(serviceOptions(root, { loginManager }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "openai" });
  await service.saveKey({ providerId: "openai", key: "api-key-that-must-remain" });
  service.settings.providers.openai = { added: true, enabled: true, mode: "api", model: "gpt-6-luna", effort: "high" };
  service.settings.modelCache.openai = { api: { models: [{ id: "gpt-6-luna", efforts: ["high"] }], source: "api", queriedAt: new Date().toISOString(), componentVersion: "test-verified" } };
  service.quotas.set("openai", { available: true, windows: [{ name: "주간", usedPercent: 25 }] });
  service.saveSettings();

  const started = await service.handle("ai-logout", { providerId: "openai", mode: "cli" });
  assert.equal(started.status, "starting");
  await waitUntil(() => loginManager.calls.start === 1);
  assert.equal(loginManager.startOptions.operation, "logout");
  assert.equal(loginManager.startOptions.descriptor.logoutKind, "command");
  assert.equal(service.getCredentials().openai, "api-key-that-must-remain");
  assert.equal(service.config(service.provider("openai")).enabled, true);

  await loginManager.complete("openai", { status: "succeeded", url: null, code: null });
  assert.equal(service.getCredentials().openai, "api-key-that-must-remain");
  assert.deepEqual(service.config(service.provider("openai")), { added: true, enabled: false, mode: "api", model: "", effort: "default" });
  assert.equal(service.settings.modelCache.openai, undefined);
  assert.equal(service.quotas.has("openai"), false);
  assert.equal(service.loginState(service.provider("openai")).status, "succeeded");
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").hasCliSession, false);
  const restarted = new CommonAiService(serviceOptions(root));
  t.after(() => restarted.shutdown());
  assert.equal(restarted.snapshot().providers.find(row => row.id === "openai").hasCliSession, false, "completed CLI logout survives an app restart");
  assert.equal(restarted.snapshot().providers.find(row => row.id === "openai").hasKey, true, "the API key survives CLI logout and restart");
});

test("terminal logout waits for closed-window confirmation before clearing account state", async t => {
  const root = fixture(t);
  const loginManager = fakeLoginManager();
  const service = new CommonAiService(serviceOptions(root, { loginManager }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "google" });
  service.settings.providers.google = { added: true, enabled: true, mode: "cli", model: "gemini-test-model", effort: "high" };
  service.settings.modelCache.google = { cli: { models: [{ id: "gemini-test-model", efforts: ["high"], effortsReported: true }], source: "cli", queriedAt: new Date().toISOString(), componentVersion: "test-verified" } };
  service.saveSettings();

  const starting = await service.handle("ai-logout", { providerId: "google", mode: "cli" });
  assert.equal(starting.status, "starting");
  await waitUntil(() => loginManager.calls.start === 1);
  assert.equal(loginManager.startOptions.descriptor.logoutKind, "terminal");
  assert.equal(service.config(service.provider("google")).enabled, true);
  assert.equal(service.snapshot().providers.find(row => row.id === "google").hasCliSession, true);
  await assert.rejects(() => service.handle("ai-logout-confirm", { providerId: "google" }), /닫힌 뒤/);

  await loginManager.complete("google", { status: "waiting", terminalClosed: true, url: null, code: null });
  const waiting = await service.handle("ai-login-status", { providerId: "google" });
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.terminalClosed, true);
  assert.equal(service.config(service.provider("google")).enabled, true);
  const complete = await service.handle("ai-logout-confirm", { providerId: "google" });
  assert.equal(complete.status, "succeeded");
  assert.equal(loginManager.calls.confirmLogout, 1);
  assert.equal(service.config(service.provider("google")).enabled, false);
  assert.equal(service.config(service.provider("google")).model, "");
  assert.equal(service.settings.modelCache.google, undefined);
  assert.equal(service.snapshot().providers.find(row => row.id === "google").hasCliSession, false);
});

test("fresh CLI login waits for a verified sign-out before clearing model/account state", async t => {
  const root = fixture(t);
  const loginManager = fakeLoginManager();
  const service = new CommonAiService(serviceOptions(root, { loginManager }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "openai" });
  await service.saveKey({ providerId: "openai", key: "keep-key-for-api-mode" });
  service.settings.providers.openai = { added: true, enabled: true, mode: "cli", model: "gpt-6-luna", effort: "high" };
  service.settings.modelCache.openai = { cli: { models: [{ id: "gpt-6-luna", efforts: ["high"], effortsReported: true }], source: "cli", queriedAt: new Date().toISOString(), componentVersion: "test-verified" } };
  service.saveSettings();

  const starting = await service.handle("ai-login", { providerId: "openai", mode: "cli" });
  assert.equal(starting.status, "starting");
  await waitUntil(() => loginManager.calls.start === 1);
  assert.equal(loginManager.startOptions.operation, "login");
  assert.equal(loginManager.startOptions.descriptor.logoutBeforeLogin, true);
  assert.equal(service.config(service.provider("openai")).enabled, true);
  assert.equal(service.config(service.provider("openai")).model, "gpt-6-luna");
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").hasCliSession, true);

  await loginManager.startOptions.onPhase({ phase: "signed-out" });
  assert.equal(service.config(service.provider("openai")).enabled, false);
  assert.equal(service.config(service.provider("openai")).model, "");
  assert.equal(service.settings.modelCache.openai, undefined);
  assert.equal(service.getCredentials().openai, "keep-key-for-api-mode");
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").hasCliSession, false, "verified pre-login sign-out hides logout while new authorization waits");
  await loginManager.complete("openai", { status: "failed", error: "fixture authorization failed", url: null, code: null });
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").hasCliSession, false, "failed fresh authorization does not restore the previous CLI account");
  const signedOutRestart = new CommonAiService(serviceOptions(root));
  t.after(() => signedOutRestart.shutdown());
  assert.equal(signedOutRestart.snapshot().providers.find(row => row.id === "openai").hasCliSession, false);

  await service.handle("ai-login", { providerId: "openai", mode: "cli" });
  await waitUntil(() => loginManager.calls.start === 2);
  await loginManager.complete("openai", { status: "succeeded", url: null, code: null });
  assert.equal(service.loginState(service.provider("openai")).status, "succeeded");
  assert.equal(service.snapshot().providers.find(row => row.id === "openai").hasCliSession, true);
  const restarted = new CommonAiService(serviceOptions(root));
  t.after(() => restarted.shutdown());
  assert.equal(restarted.snapshot().providers.find(row => row.id === "openai").hasCliSession, true, "successful CLI authorization survives restart before model selection");
});

test("Kimi ACP logout metadata is routed through LoginManager and clears state only on success", async t => {
  const root = fixture(t);
  const loginManager = fakeLoginManager();
  const service = new CommonAiService(serviceOptions(root, { loginManager }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "moonshot" });
  service.settings.providers.moonshot = { added: true, enabled: true, mode: "cli", model: "kimi-code/kimi-for-coding", effort: "high" };
  service.saveSettings();

  const started = await service.handle("ai-logout", { providerId: "moonshot", mode: "cli" });
  assert.equal(started.status, "starting");
  await waitUntil(() => loginManager.calls.start === 1);
  assert.equal(loginManager.startOptions.descriptor.logoutKind, "acp");
  assert.deepEqual(loginManager.startOptions.descriptor.logoutArgs, ["acp"]);
  await loginManager.complete("moonshot", { status: "succeeded", url: null, code: null });
  assert.equal(service.config(service.provider("moonshot")).enabled, false);
  assert.equal(service.config(service.provider("moonshot")).model, "");
  assert.equal(service.loginState(service.provider("moonshot")).status, "succeeded");
});

test("provider removal cancels and awaits a coalesced adapter install before allowing reinstall", async t => {
  const root = fixture(t);
  const components = fakeComponentManager(providerAdapters);
  let installCalls = 0;
  let wasCanceled = false;
  components.install = async (_id, { signal }) => new Promise((resolve, reject) => {
    installCalls++;
    signal.addEventListener("abort", () => { wasCanceled = true; reject(new Error("test install canceled")); }, { once: true });
  });
  const service = new CommonAiService(serviceOptions(root, { components }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "openai" });

  const first = await service.handle("ai-adapter-install", { providerId: "openai" });
  const duplicate = await service.handle("ai-adapter-install", { providerId: "openai" });
  assert.equal(duplicate.id, first.id);
  await waitUntil(() => installCalls === 1);
  await assert.rejects(() => service.handle("ai-adapter-remove", { providerId: "openai" }), /다른 작업이 진행 중/);

  const removed = await service.handle("ai-provider-remove", { providerId: "openai" });
  assert.equal(wasCanceled, true);
  assert.equal(removed.providers.find(row => row.id === "openai").added, false);
  assert.equal(service.getJob(first.id).status, "canceled");

  await service.handle("ai-provider-add", { providerId: "openai" });
  components.install = async () => {};
  const reinstall = await service.handle("ai-adapter-install", { providerId: "openai" });
  await waitUntil(() => service.getJob(reinstall.id).status === "completed");
  assert.equal(service.getJob(reinstall.id).status, "completed");
});

for (const [action, providerId] of [["ai-install", "xai"], ["ai-update", "google"]]) {
  test(`${action} refreshes and pins the current ${providerId} recipe before native installation`, async t => {
    const root = fixture(t);
    const recipe = { recipe: "current", ...(providerId === "xai" ? { executableCompression: "brotli" } : {}) };
    const stale = { ...providerAdapters[providerId], runtime: { ...providerAdapters[providerId].runtime, resolveRelease: async () => ({ recipe: "stale" }) } };
    const current = { ...providerAdapters[providerId], runtime: { ...providerAdapters[providerId].runtime, resolveRelease: async () => recipe } };
    const descriptors = { ...providerAdapters, [providerId]: stale };
    const components = fakeComponentManager(descriptors, "old-recipe");
    let finishRefresh;
    const refreshed = new Promise(resolve => { finishRefresh = resolve; });
    const events = [];
    components.update = async (id, { refresh, signal }) => {
      assert.equal(id, providerId);
      assert.equal(refresh, true);
      assert.equal(signal.aborted, false);
      events.push("refresh");
      await refreshed;
      descriptors[providerId] = current;
    };
    components.pin = async id => {
      assert.equal(id, providerId);
      events.push("pin");
      return { version: "new-recipe", adapter: descriptors[id] };
    };
    components.release = (id, version) => {
      assert.equal(id, providerId);
      assert.equal(version, "new-recipe");
      events.push("release");
    };
    const runtime = {
      ...fakeRuntime(),
      async install(id, options) {
        events.push("install");
        assert.equal(id, current.provider.cliId);
        assert.equal(options.runtime, current.runtime);
        assert.equal(options.signal.aborted, false);
        assert.deepEqual(await options.runtime.resolveRelease(), recipe);
      },
    };
    const service = new CommonAiService(serviceOptions(root, { components, runtime }));
    t.after(() => service.shutdown());
    await service.componentsReady;
    await service.handle("ai-provider-add", { providerId });
    assert.equal(service.adapterFor(providerId), stale);

    const first = await service.handle(action, { providerId });
    assert.equal(service.getJob(first.id).status, "running");
    const duplicate = await service.handle(action, { providerId });
    assert.equal(duplicate.id, first.id);
    assert.deepEqual(events, ["refresh"], "native installation waits for the recipe refresh");
    await assert.rejects(() => service.handle("ai-adapter-remove", { providerId }), /다른 작업이 진행 중/);
    finishRefresh();
    await waitUntil(() => service.getJob(first.id).status === "completed");
    assert.deepEqual(events, ["refresh", "pin", "install", "release"]);
    assert.equal(service.adapterFor(providerId), current);
    assert.equal(service.componentOperations.size, 0);
  });
}

test("failed or canceled recipe refresh never starts native installation", async t => {
  for (const cancel of [false, true]) {
    const root = fixture(t);
    const components = fakeComponentManager(providerAdapters);
    let refreshStarted = false, installed = 0, pinned = 0;
    components.update = async (_id, { signal }) => {
      refreshStarted = true;
      if (!cancel) throw new Error("fixture update failed");
      await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("fixture update canceled")), { once: true }));
    };
    components.pin = async () => { pinned++; throw new Error("unexpected pin"); };
    const runtime = { ...fakeRuntime(), async install() { installed++; } };
    const service = new CommonAiService(serviceOptions(root, { components, runtime }));
    t.after(() => service.shutdown());
    await service.componentsReady;
    await service.handle("ai-provider-add", { providerId: "xai" });
    const job = await service.handle("ai-install", { providerId: "xai" });
    await waitUntil(() => refreshStarted);
    if (cancel) await service.handle("ai-provider-remove", { providerId: "xai" });
    await waitUntil(() => service.getJob(job.id).status === (cancel ? "canceled" : "failed"));
    assert.equal(installed, 0);
    assert.equal(pinned, 0);
    assert.equal(service.componentOperations.size, 0);
  }
});

test("native removal and rollback stay local and never refresh provider modules", async t => {
  const root = fixture(t);
  const components = fakeComponentManager(providerAdapters);
  components.update = async () => { throw new Error("unexpected network refresh"); };
  const actions = [];
  const runtime = {
    ...fakeRuntime(),
    async remove(id, { runtime }) { actions.push("remove"); assert.equal(runtime, providerAdapters.xai.runtime); },
    async rollback(id, { runtime }) { actions.push("rollback"); assert.equal(runtime, providerAdapters.xai.runtime); },
  };
  const service = new CommonAiService(serviceOptions(root, { components, runtime }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "xai" });
  for (const action of ["ai-component-remove", "ai-rollback"]) {
    const job = await service.handle(action, { providerId: "xai" });
    await waitUntil(() => service.getJob(job.id).status === "completed");
  }
  assert.deepEqual(actions, ["remove", "rollback"]);
});

test("legacy adapters without auth metadata report an update path and never run old loginArgs", async t => {
  const root = fixture(t);
  const legacy = { ...providerAdapters, openai: { ...providerAdapters.openai, cli: { ...providerAdapters.openai.cli, auth: undefined, loginArgs: ["login"] } } };
  const components = fakeComponentManager(legacy);
  const loginManager = fakeLoginManager();
  const runtime = fakeRuntime();
  let runtimePins = 0;
  runtime.pin = async () => { runtimePins++; return "C:\\tools\\codex.exe"; };
  const service = new CommonAiService(serviceOptions(root, { components, runtime, loginManager }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "openai" });
  const state = service.snapshot().providers.find(row => row.id === "openai").login;
  assert.equal(state.supported, false);
  assert.match(state.instructions, /연결 모듈을 업데이트/);
  assert.equal((await service.handle("ai-login", { providerId: "openai" })).supported, false);
  assert.equal(loginManager.calls.start, 0);
  assert.equal(runtimePins, 0);
});

test("default LoginManager opens only the packaged API console through the injected shell", async t => {
  const root = fixture(t);
  const auth = {
    kind: "api-key", loginArgs: [], requiresTty: false, authHosts: [],
    instructions: "공식 콘솔에서 API 키를 발급하세요.",
    keyUrl: "https://platform.openai.com/api-keys",
  };
  const adapters = {
    ...providerAdapters,
    openai: { ...providerAdapters.openai, cli: { ...providerAdapters.openai.cli, auth } },
  };
  const components = fakeComponentManager(adapters);
  const opened = [];
  const service = new CommonAiService(serviceOptions(root, {
    components, shellOpenExternal: async url => { opened.push(url); },
  }));
  t.after(() => service.shutdown());
  await service.componentsReady;
  await service.handle("ai-provider-add", { providerId: "openai" });

  await service.handle("ai-login-open-browser", { providerId: "openai", mode: "api", url: "https://attacker.example/" });
  assert.deepEqual(opened, [auth.keyUrl]);
});
