const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const { CredentialVault } = require("./oauth.cjs");
const catalog = require("./ai-catalog.cjs");
const { buildAiContext, normalizeRequest, normalizeScope, API_CONTEXT_LIMIT, CLI_CONTEXT_LIMIT } = require("./ai-context.cjs");
const { readCliQuota } = require("./ai-quota.cjs");
let usageHelpers = null;
try { usageHelpers = require("./ai-usage.cjs"); } catch {}
let cliModelHelpers = null;
try { cliModelHelpers = require("./ai-models.cjs"); } catch {}

const SETTINGS_SCHEMA = 1;
const SETTINGS_BYTES_LIMIT = 2 * 1024 * 1024;
const MAX_DISCOVERED_MODELS = 1000;
const MAX_CLI_MODELS = 500;
const RESULT_LIMIT = 20;
const RESULTS_BYTES_LIMIT = 2 * 1024 * 1024;
const MAX_RESULT_TEXT = 90 * 1024;
const MAX_CLI_LINE = 1024 * 1024;
const MAX_JOB_MS = 10 * 60 * 1000;
const MAX_MEMORY_JOBS = 30;
const SECRET_ENV = [
  "OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN",
  "XAI_API_KEY", "GROK_API_KEY", "GROK_AUTH_TOKEN",
  "GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL",
  "DEEPSEEK_API_KEY", "MOONSHOT_API_KEY", "KIMI_API_KEY",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function isReparsePoint(stat) {
  return stat.isSymbolicLink() || (Number.isInteger(stat.attributes) && (stat.attributes & 0x400) !== 0);
}
function trimText(value, max = 2000) { return String(value ?? "").slice(0, max); }
function trimUtf8(value, maxBytes) {
  const text = String(value ?? "");
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false };
  let result = "";
  for (const point of text) {
    if (Buffer.byteLength(result + point) > maxBytes) break;
    result += point;
  }
  return { text: result, truncated: true };
}
function safeFile(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function atomicWrite(file, value) {
  safeFile(file);
  const temp = file + ".tmp-" + crypto.randomUUID();
  try {
    fs.writeFileSync(temp, value);
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch {}
    throw error;
  }
}
function validateModel(value) {
  if (typeof value !== "string" || value.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value))
    throw new Error("모델 이름을 확인하세요.");
  return value;
}
function combinePrompt(prompt) {
  const system = String(prompt?.system || "");
  const user = String(prompt?.user || "");
  return `## Instructions\n${system}\n\n${user}`;
}
function safeError(error, secrets = []) {
  let message = trimText(error?.message || error || "AI 요청을 완료하지 못했습니다.", 1200);
  for (const secret of secrets) if (secret) message = message.split(secret).join("[숨김]");
  return message.replace(/[\r\n\t]+/g, " ");
}
function redactSecrets(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets) if (typeof secret === "string" && secret) text = text.split(secret).join("[숨김]");
  return text;
}
function redactObjectStrings(value, secrets = []) {
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map(item => redactObjectStrings(item, secrets));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactObjectStrings(item, secrets)]));
}

class CommonAiService {
  constructor({ root, storage, runtime, components, api, providers = catalog.providers, notify = () => {}, spawnImpl = spawn, platform = process.platform, shellOpenExternal, contextBuilder = buildAiContext, cliModelReader }) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this.root = fs.realpathSync.native(this.root);
    this.directory = path.join(this.root, "ai");
    this.jobsDirectory = path.join(this.directory, "jobs");
    this.settingsFile = path.join(this.directory, "settings.json");
    this.credentialsFile = path.join(this.directory, "credentials.enc");
    this.resultsFile = path.join(this.directory, "results.enc");
    fs.mkdirSync(this.jobsDirectory, { recursive: true });
    this.assertJobStorage();
    this.removeStaleJobDirectories();
    this.storage = storage;
    this.runtime = runtime;
    this.components = components || null;
    this.adapterCache = new Map();
    this.adapterInfo = new Map();
    this.api = api || {};
    this.builtins = providers;
    this.notify = notify;
    this.spawnImpl = spawnImpl;
    this.platform = platform;
    this.shellOpenExternal = shellOpenExternal;
    this.contextBuilder = contextBuilder;
    this.cliModelReader = cliModelReader || cliModelHelpers?.readCliModels || null;
    this.vault = new CredentialVault(this.credentialsFile, storage);
    this.vault.load();
    this.settings = this.loadSettings();
    this.jobs = new Map();
    this.latestJobId = null;
    this.results = this.loadResults();
    this.quotas = new Map();
    this.deleted = false;
    this.notifyTimer = null;
    this.componentsReady = this.initializeComponents();
  }

  async initializeComponents() {
    if (!this.components) return;
    for (const provider of this.builtins) {
      if (this.deleted) return;
      try {
        await this.components.detect(provider.id);
        const adapter = this.components.load(provider.id);
        if (adapter?.abiVersion === 1) {
          this.adapterCache.set(provider.id, adapter);
          if (adapter.runtime) await this.runtime?.detect?.(adapter.runtime.id, { runtime: adapter.runtime });
        }
      } catch {}
    }
    this.emit();
  }

  assertJobStorage() {
    const expectedDirectory = path.join(this.root, "ai");
    const expectedJobs = path.join(expectedDirectory, "jobs");
    for (const [directory, expected] of [[this.directory, expectedDirectory], [this.jobsDirectory, expectedJobs]]) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || isReparsePoint(stat) || fs.realpathSync.native(directory) !== expected)
        throw new Error("AI 작업 저장소 경로가 올바르지 않습니다.");
    }
  }

  removeJobDirectory(directory, id) {
    if (typeof id !== "string" || !UUID.test(id)) return false;
    this.assertJobStorage();
    const expected = path.join(this.jobsDirectory, id);
    if (path.resolve(directory) !== expected) return false;
    let stat;
    try { stat = fs.lstatSync(expected); }
    catch (error) { if (error?.code === "ENOENT") return true; throw error; }
    if (!stat.isDirectory() || isReparsePoint(stat) || fs.realpathSync.native(expected) !== expected) return false;
    fs.rmSync(expected, { recursive: true, force: true });
    return true;
  }

  removeStaleJobDirectories() {
    this.assertJobStorage();
    for (const entry of fs.readdirSync(this.jobsDirectory, { withFileTypes: true })) {
      if (!UUID.test(entry.name)) continue;
      try { this.removeJobDirectory(path.join(this.jobsDirectory, entry.name), entry.name); } catch {}
    }
  }

  loadSettings() {
    try {
      let value = { schemaVersion: SETTINGS_SCHEMA, providers: {} };
      let hasSettingsFile = false;
      if (fs.existsSync(this.settingsFile)) {
        hasSettingsFile = true;
        const stat = fs.statSync(this.settingsFile);
        if (!stat.isFile() || stat.size > SETTINGS_BYTES_LIMIT) throw new Error("settings too large");
        const raw = fs.readFileSync(this.settingsFile, "utf8");
        if (Buffer.byteLength(raw) > SETTINGS_BYTES_LIMIT) throw new Error("settings too large");
        value = JSON.parse(raw);
      }
      if (value.schemaVersion !== SETTINGS_SCHEMA || !isPlainObject(value.providers)) throw new Error("settings schema");
      const customProviders = Array.isArray(value.customProviders) ? value.customProviders.slice(0, 20).map(catalog.validateProvider) : [];
      const knownIds = [...this.builtins, ...customProviders].map(provider => provider.id);
      const providers = {};
      for (const provider of [...this.builtins, ...customProviders]) {
        const hasSavedConfig = isPlainObject(value.providers[provider.id]);
        const saved = hasSavedConfig ? value.providers[provider.id] : {};
        const mode = saved.mode === "api" ? "api" : "cli";
        const model = typeof saved.model === "string" && saved.model.length <= 160 ? saved.model : "";
        const effort = typeof saved.effort === "string" && catalog.EFFORTS.includes(saved.effort) ? saved.effort : "default";
        const added = typeof saved.added === "boolean"
          ? saved.added
          : provider.custom || saved.enabled === true || !!model || !!this.getCredentials()[provider.id] || (hasSettingsFile && hasSavedConfig && this.hasInstalledAdapter(provider.id));
        providers[provider.id] = {
          added,
          enabled: added && saved.enabled === true,
          mode: provider.custom ? "api" : mode,
          model,
          effort,
        };
      }
      const capabilityProfiles = {};
      if (isPlainObject(value.capabilityProfiles)) {
        for (const [providerId, raw] of Object.entries(value.capabilityProfiles)) {
          if (!knownIds.includes(providerId)) continue;
          try { capabilityProfiles[providerId] = catalog.validateCapabilityProfile(raw, knownIds); } catch {}
        }
      }
      const modelCache = {};
      if (isPlainObject(value.modelCache)) {
        for (const [providerId, rawModes] of Object.entries(value.modelCache)) {
          if (!knownIds.includes(providerId) || !isPlainObject(rawModes)) continue;
          const checkedModes = {};
          for (const mode of ["api", "cli"]) {
            const cached = rawModes[mode];
            if (!isPlainObject(cached) || cached.source !== mode || !Array.isArray(cached.models) || typeof cached.queriedAt !== "string" || !Number.isFinite(Date.parse(cached.queriedAt))) continue;
            if (mode === "cli" && cached.models.some(row => !isPlainObject(row) || typeof row.effortsReported !== "boolean")) continue;
            const models = cached.models.slice(0, MAX_DISCOVERED_MODELS).flatMap(row => {
              if (!isPlainObject(row) || typeof row.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(row.id)) return [];
              const efforts = Array.isArray(row.efforts) ? [...new Set(row.efforts.filter(item => catalog.EFFORTS.includes(item)))].slice(0, 10) : [];
              const checked = { id: row.id, efforts };
              if (typeof row.name === "string") checked.name = trimText(row.name, 100);
              if (catalog.EFFORTS.includes(row.defaultEffort)) checked.defaultEffort = row.defaultEffort;
              if (typeof row.effortsReported === "boolean") checked.effortsReported = row.effortsReported;
              if (row.supportsEffort === true || row.supportsEffort === false) checked.supportsEffort = row.supportsEffort;
              if (row.pricing && usageHelpers?.validatePricing) {
                try { checked.pricing = usageHelpers.validatePricing(row.pricing); } catch {}
              }
              return [checked];
            });
            const componentVersion = typeof cached.componentVersion === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(cached.componentVersion) ? cached.componentVersion : null;
            if (models.length) checkedModes[mode] = { models, source: mode, queriedAt: cached.queriedAt,
              ...(componentVersion ? { componentVersion } : {}),
              ...(typeof cached.currentModelId === "string" ? { currentModelId: cached.currentModelId } : {}) };
          }
          if (Object.keys(checkedModes).length) modelCache[providerId] = checkedModes;
        }
      }
      let pricing = [];
      if (usageHelpers?.mergePricing && Array.isArray(value.pricing)) {
        try { pricing = usageHelpers.mergePricing([], value.pricing); } catch { pricing = []; }
      }
      return { schemaVersion: SETTINGS_SCHEMA, providers, customProviders, capabilityProfiles, modelCache, pricing };
    } catch {
      return { schemaVersion: SETTINGS_SCHEMA, providers: {}, customProviders: [], capabilityProfiles: {}, modelCache: {}, pricing: [] };
    }
  }

  hasInstalledAdapter(providerId) {
    try {
      const adapter = this.components?.load?.(providerId);
      return !!adapter && adapter.abiVersion === 1 && adapter.provider?.id === providerId;
    } catch { return false; }
  }

  saveSettings() {
    const serialized = JSON.stringify(this.settings, null, 2);
    if (Buffer.byteLength(serialized) > SETTINGS_BYTES_LIMIT) throw new Error("AI 설정이 너무 큽니다.");
    if (this.secretValues().some(secret => serialized.includes(secret))) throw new Error("API 키가 일반 AI 설정에 포함되어 있습니다. 모델 이름·URL에서 키를 지운 뒤 저장하세요.");
    atomicWrite(this.settingsFile, serialized, "utf8");
  }

  loadResults() {
    if (!this.storage || !this.storage.isEncryptionAvailable?.() || !fs.existsSync(this.resultsFile)) return [];
    try {
      const stat = fs.statSync(this.resultsFile);
      if (stat.size > RESULTS_BYTES_LIMIT * 2 + 16 * 1024) return [];
      const text = this.storage.decryptString(fs.readFileSync(this.resultsFile));
      if (Buffer.byteLength(text) > RESULTS_BYTES_LIMIT) return [];
      const value = JSON.parse(text);
      return Array.isArray(value) ? value.filter(row => isPlainObject(row) && typeof row.id === "string").slice(0, RESULT_LIMIT) : [];
    } catch { return []; }
  }

  saveResults() {
    if (!this.storage?.isEncryptionAvailable?.()) return false;
    const saved = [];
    for (const item of this.results.slice(-RESULT_LIMIT).reverse()) {
      const candidate = [...saved, item];
      const text = JSON.stringify(candidate);
      if (Buffer.byteLength(text) > RESULTS_BYTES_LIMIT) continue;
      saved.push(item);
    }
    this.results = saved.reverse();
    const text = JSON.stringify(this.results);
    atomicWrite(this.resultsFile, this.storage.encryptString(text));
    return true;
  }

  provider(providerId) {
    if (typeof providerId !== "string") throw new Error("AI 연결을 선택하세요.");
    const found = [...this.builtins, ...this.settings.customProviders].find(row => row.id === providerId);
    if (!found) throw new Error("지원하지 않는 AI 연결입니다.");
    return found;
  }

  adapterFor(providerId, { required = false, reload = false } = {}) {
    if (this.adapterCache.has(providerId) && !reload) return this.adapterCache.get(providerId);
    let descriptor = null;
    try {
      descriptor = this.components?.load?.(providerId) || null;
      if (descriptor && typeof descriptor.then === "function") throw new Error("Provider adapter loading must be synchronous.");
      if (descriptor && (descriptor.abiVersion !== 1 || descriptor.provider?.id !== providerId)) throw new Error("Provider adapter ABI does not match.");
    } catch (error) {
      if (required) throw new Error("연결 모듈을 검증하고 읽지 못했습니다.");
      descriptor = null;
    }
    if (descriptor) this.adapterCache.set(providerId, descriptor);
    else this.adapterCache.delete(providerId);
    if (!descriptor && required) throw new Error("먼저 이 공급자의 연결 모듈을 설치하세요.");
    return descriptor;
  }

  adapterBinding(provider, { required = false } = {}) {
    if (!provider.custom) return { componentId: provider.id, adapter: this.adapterFor(provider.id, { required }) };
    const componentId = ({ responses: "openai", chat: "deepseek", anthropic: "anthropic", gemini: "google" })[provider.protocol];
    const adapter = componentId ? this.adapterFor(componentId) : null;
    if (!adapter && required) throw new Error("호환 API 연결 모듈을 먼저 설치하고 업데이트하세요.");
    return {
      componentId,
      adapter,
      apiProvider: adapter ? { ...adapter.provider, id: provider.id, name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl, custom: true } : provider,
    };
  }

  providerDescriptor(providerId, required = false) {
    const base = this.provider(providerId);
    if (base.custom) return base;
    const adapter = this.adapterFor(providerId, { required });
    return adapter ? { ...base, ...adapter.provider, id: base.id } : base;
  }

  config(provider) {
    const saved = this.settings.providers[provider.id] || {};
    return {
      added: provider.custom ? saved.added !== false : saved.added === true,
      enabled: saved.enabled === true,
      mode: provider.custom ? "api" : saved.mode === "api" ? "api" : "cli",
      model: typeof saved.model === "string" ? saved.model : "",
      effort: catalog.EFFORTS.includes(saved.effort) ? saved.effort : "default",
    };
  }

  modelRows(provider, mode) {
    const cache = this.settings.modelCache?.[provider.id]?.[mode];
    const binding = this.adapterBinding(provider);
    const descriptor = binding.adapter;
    const componentVersion = this.components?.snapshot?.().byId?.[binding.componentId]?.version;
    if (!descriptor || !cache || !componentVersion || cache.componentVersion !== componentVersion) return [];
    const profiles = new Map((this.settings.capabilityProfiles?.[provider.id]?.models || []).map(row => [row.id, row]));
    return (cache?.models || []).map(row => {
      const profile = profiles.get(row.id);
      let advertised = row.efforts || [];
      let effortSource = row.effortsReported === true ? mode : "adapter";
      if (profile) { advertised = profile.efforts || []; effortSource = "profile"; }
      else if (row.effortsReported !== true && row.supportsEffort !== false) {
        try {
          const resolved = descriptor?.provider?.effortsFor?.({ mode, model: row.id, row: { ...row } });
          if (Array.isArray(resolved)) { advertised = resolved; effortSource = "adapter"; }
        } catch {}
      }
      const efforts = ["default", ...new Set(advertised.filter(value => catalog.EFFORTS.includes(value) && value !== "default"))];
      return {
        id: row.id,
        ...(row.name ? { name: row.name } : {}),
        efforts,
        effortSource,
        ...(row.defaultEffort && efforts.includes(row.defaultEffort) ? { defaultEffort: row.defaultEffort } : {}),
        ...(row.pricing ? { pricing: row.pricing } : this.pricingFor(provider.id, row.id) ? { pricing: this.pricingFor(provider.id, row.id) } : {}),
      };
    });
  }

  effortsFor(provider, model, mode) {
    if (!model) return ["default"];
    const row = this.modelRows(provider, mode).find(item => item.id === model);
    return row?.efforts || [];
  }

  pricingFor(providerId, modelId) {
    const provider = this.provider(providerId);
    const apiModel = this.settings.modelCache?.[providerId]?.api?.models?.find(row => row.id === modelId);
    const cached = apiModel?.pricing;
    const packaged = this.adapterBinding(provider).adapter?.pricing || [];
    const pricing = [...(this.settings.pricing || []), ...(cached ? [cached] : []), ...packaged];
    return usageHelpers?.getPricing?.(providerId, modelId, pricing) || null;
  }

  getCredentials() { return this.vault.accounts && isPlainObject(this.vault.accounts) ? this.vault.accounts : {}; }

  secretValues() { return Object.values(this.getCredentials()).filter(value => typeof value === "string" && value.length > 0); }

  redact(value) { return redactSecrets(value, this.secretValues()); }

  encrypted() { return !!this.storage?.isEncryptionAvailable?.(); }

  safeResult(item) {
    return {
      id: item.id,
      createdAt: item.createdAt,
      providerId: item.providerId,
      model: this.redact(item.model),
      prompt: trimText(this.redact(item.request || ""), 500),
      scope: item.preview?.scope || item.scope || null,
      status: item.status,
    };
  }

  runtimeSnapshot() {
    try { return this.runtime?.snapshot?.() || { components: [], byId: {} }; }
    catch { return { components: [], byId: {} }; }
  }

  runtimeState(componentId) {
    const row = this.runtimeSnapshot().byId?.[componentId];
    if (!row) return { id: componentId, status: "not-detected" };
    const result = { id: componentId, status: typeof row.status === "string" ? row.status : "unknown" };
    for (const field of ["version", "source", "previousVersion"]) if (typeof row[field] === "string") result[field] = trimText(row[field], 160);
    if (Number.isFinite(row.progress)) result.progress = Math.max(0, Math.min(1, row.progress));
    if (Number.isSafeInteger(row.bytes) && row.bytes >= 0) result.bytes = row.bytes;
    if (Number.isSafeInteger(row.totalInstalledBytes) && row.totalInstalledBytes >= 0) result.totalInstalledBytes = row.totalInstalledBytes;
    if (row.error) result.error = this.redact(safeError(row.error));
    return result;
  }

  providerState(provider) {
    const config = this.config(provider);
    const binding = this.adapterBinding(provider);
    const adapter = binding.adapter;
    const componentId = binding.componentId || provider.id;
    const componentRow = this.components?.snapshot?.().byId?.[componentId];
    const info = this.adapterInfo.get(provider.id);
    const component = componentRow ? {
      status: ["checking", "downloading", "verifying", "installing", "updating"].includes(componentRow.status) ? "installing" : componentRow.version || componentRow.status === "ready" || componentRow.status === "installed" ? "installed" : componentRow.status === "failed" || componentRow.status === "error" ? "error" : componentRow.status,
      ...(typeof componentRow.version === "string" ? { version: componentRow.version } : {}),
      ...(typeof componentRow.previousVersion === "string" ? { previousVersion: componentRow.previousVersion } : {}),
      ...(typeof componentRow.latestVersion === "string" ? { latestVersion: componentRow.latestVersion } : typeof info?.latest?.version === "string" ? { latestVersion: info.latest.version } : {}),
      ...(typeof componentRow.updateVersion === "string" ? { latestVersion: componentRow.updateVersion } : {}),
      ...(typeof componentRow.source === "string" ? { source: componentRow.source } : {}),
      ...(typeof componentRow.progress === "number" ? { progress: Math.max(0, Math.min(1, componentRow.progress)) } : {}),
      ...(Number.isSafeInteger(componentRow.bytes) ? { bytes: componentRow.bytes } : {}),
      ...(Number.isSafeInteger(componentRow.totalInstalledBytes) ? { totalInstalledBytes: componentRow.totalInstalledBytes } : {}),
      ...(typeof componentRow.updateAvailable === "boolean" ? { updateAvailable: componentRow.updateAvailable } : {}),
      ...(componentRow.error ? { error: trimText(this.redact(safeError(componentRow.error)), 300) } : {}),
    } : { status: adapter ? "installed" : "available" };
    const cliId = adapter?.provider?.cliId;
    const cli = cliId ? this.runtimeState(cliId) : { status: "unavailable" };
    const modelCache = this.settings.modelCache?.[provider.id]?.[config.mode];
    const modelRows = adapter ? this.modelRows(provider, config.mode).map(row => ({ ...row, id: this.redact(row.id), ...(row.pricing ? { pricing: redactObjectStrings(row.pricing, this.secretValues()) } : {}) })) : [];
    return {
      id: provider.id,
      name: this.redact(provider.custom ? provider.name : adapter?.provider?.name || provider.name),
      ...(adapter?.provider?.apiName ? { apiName: adapter.provider.apiName } : {}),
      ...(adapter?.provider?.cliNote ? { cliNote: adapter.provider.cliNote } : {}),
      ...(provider.custom ? { custom: true } : {}),
      added: config.added,
      enabled: config.enabled,
      mode: config.mode,
      model: this.redact(config.model),
      effort: config.effort,
      models: modelRows,
      ...(modelCache ? { modelsSource: modelCache.source, modelsQueriedAt: modelCache.queriedAt, ...(modelCache.currentModelId ? { currentModelId: this.redact(modelCache.currentModelId) } : {}) } : {}),
      hasKey: typeof this.getCredentials()[provider.id] === "string" && !!this.getCredentials()[provider.id],
      cli,
      component,
      quota: redactObjectStrings(this.quotas.get(provider.id) || { available: false, windows: [], source: "not-refreshed", updatedAt: null, reason: "아직 사용량을 확인하지 않았습니다." }, this.secretValues()),
      ...(provider.error ? { error: trimText(this.redact(provider.error), 300) } : {}),
    };
  }

  jobSnapshot(job, includeText = false) {
    if (!job) return null;
    const value = {
      id: job.id, status: job.status, providerId: job.providerId,
      mode: job.mode, model: this.redact(job.model), effort: job.effort,
      ...(job.progress != null ? { progress: job.progress } : {}),
      ...(job.error ? { error: this.redact(job.error) } : {}),
      ...(job.preview ? { preview: job.preview } : {}),
      ...(job.usage ? { usage: job.usage } : {}),
      ...(job.cost ? { cost: redactObjectStrings(job.cost, this.secretValues()) } : {}),
      ...(job.quotaBefore ? { quotaBefore: job.quotaBefore } : {}),
      ...(job.quotaAfter ? { quotaAfter: job.quotaAfter } : {}),
      ...(job.resultTruncated ? { resultTruncated: true } : {}),
      createdAt: job.createdAt,
    };
    if (includeText) value.text = trimUtf8(this.redact(job.text || ""), MAX_RESULT_TEXT).text;
    return value;
  }

  snapshot() {
    const allProviders = [...this.builtins, ...this.settings.customProviders].map(provider => this.providerState(provider));
    return {
      providers: allProviders,
      job: this.jobSnapshot(this.jobs.get(this.latestJobId), false),
      results: this.results.map(row => this.safeResult(row)).reverse(),
      encrypted: this.encrypted(),
    };
  }

  emit() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      try { this.notify(this.snapshot()); } catch {}
    }, 120);
    this.notifyTimer.unref?.();
  }

  modelOptions(payload) {
    const provider = this.requireAdded(payload.providerId);
    this.adapterBinding(provider, { required: true });
    const mode = provider.custom ? "api" : payload.mode === "api" ? "api" : "cli";
    const model = typeof payload.model === "string" && payload.model ? validateModel(payload.model) : "";
    const rows = this.modelRows(provider, mode);
    if (model && !rows.some(row => row.id === model)) throw new Error("먼저 설정에서 이 모드의 모델 목록을 조회하세요.");
    const cache = this.settings.modelCache?.[provider.id]?.[mode];
    return { efforts: this.effortsFor(provider, model, mode), models: rows, ...(cache ? { source: cache.source, queriedAt: cache.queriedAt } : {}) };
  }

  async save(payload) {
    const provider = this.requireAdded(payload.providerId);
    const previous = this.config(provider);
    const mode = provider.custom ? "api" : payload.mode === "api" ? "api" : payload.mode === "cli" ? "cli" : previous.mode;
    const model = payload.model == null || payload.model === "" ? "" : validateModel(payload.model);
    if (this.redact(model) !== model) throw new Error("저장된 API 키를 모델 이름으로 사용할 수 없습니다.");
    const effort = payload.effort == null ? previous.effort : String(payload.effort);
    const enabled = payload.enabled == null ? previous.enabled : payload.enabled === true;
    if ((enabled || model) && !provider.custom) this.adapterBinding(provider, { required: true });
    const discovered = this.modelRows(provider, mode);
    if (model && !discovered.some(row => row.id === model)) throw new Error("먼저 설정에서 이 모드의 모델 목록을 조회하고 선택하세요.");
    if (enabled && !model) throw new Error("연결을 켜기 전에 설정에서 확인된 모델을 선택하세요.");
    if (!catalog.EFFORTS.includes(effort) || !this.effortsFor(provider, model, mode).includes(effort)) throw new Error("모델의 추론 단계를 확인하세요.");
    if (mode === "api" && enabled && !provider.custom && !this.getCredentials()[provider.id] && !trimText(payload.key || ""))
      throw new Error("API 키를 저장한 뒤 연결을 켜세요.");
    const cliApiKeyEnv = this.adapterBinding(provider).adapter?.provider?.cliApiKeyEnv;
    if (mode === "cli" && enabled && cliApiKeyEnv && !this.getCredentials()[provider.id]) throw new Error("이 CLI 연결에는 저장한 API 키가 필요합니다.");
    if (provider.custom && mode !== "api") throw new Error("사용자 연결은 API 모드만 지원합니다.");
    if (payload.key != null && payload.key !== "") this.setKey(provider.id, payload.key);
    this.settings.providers[provider.id] = { ...previous, added: true, enabled, mode, model, effort };
    this.saveSettings();
    this.emit();
    return this.snapshot();
  }

  setKey(providerId, keyValue) {
    const key = String(keyValue);
    if (!key || key.length > 8192 || /[\r\n\0]/.test(key)) throw new Error("API 키 형식을 확인하세요.");
    if (JSON.stringify(this.settings).includes(key)) throw new Error("API 키와 같은 문구가 AI 모델 이름 또는 URL에 있습니다. 설정에서 먼저 지우세요.");
    if (!this.vault.available()) throw new Error("Windows 보안 저장소를 사용할 수 없어 API 키를 저장하지 못했습니다.");
    const before = { ...this.vault.accounts };
    this.vault.accounts = { ...before, [providerId]: key };
    try { this.vault.save(); }
    catch (error) { this.vault.accounts = before; throw error; }
  }

  saveKey(payload = {}) {
    const provider = this.requireAdded(payload.providerId);
    this.setKey(provider.id, payload.key);
    this.emit();
    return this.snapshot();
  }

  removeKey(providerId) {
    this.provider(providerId);
    if (!this.getCredentials()[providerId]) return this.snapshot();
    if (!this.vault.available()) throw new Error("Windows 보안 저장소를 사용할 수 없습니다.");
    const before = { ...this.vault.accounts };
    delete this.vault.accounts[providerId];
    try { this.vault.save(); }
    catch (error) { this.vault.accounts = before; throw error; }
    this.emit();
    return this.snapshot();
  }

  importProviderFile(file) {
    if (typeof file !== "string") throw new Error("AI 연결 파일을 선택하세요.");
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("AI 연결 파일은 64KB 이내여야 합니다.");
    let imported;
    try { imported = catalog.validateProvider(JSON.parse(fs.readFileSync(file, "utf8"))); }
    catch (error) { throw new Error(safeError(error)); }
    if ([...this.builtins, ...this.settings.customProviders].some(row => row.id === imported.id)) throw new Error("같은 ID의 AI 연결이 이미 있습니다.");
    if (this.settings.customProviders.length >= 20) throw new Error("사용자 AI 연결은 최대 20개까지 저장할 수 있습니다.");
    this.settings.customProviders.push(imported);
    this.settings.providers[imported.id] = { added: true, enabled: false, mode: "api", model: "", effort: "default" };
    this.saveSettings();
    this.emit();
    return this.snapshot();
  }

  importDataFile(file) {
    if (typeof file !== "string") throw new Error("AI 데이터 파일을 선택하세요.");
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("AI 데이터 파일은 64KB 이내여야 합니다.");
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { throw new Error("AI 데이터 JSON을 읽을 수 없습니다."); }
    if (raw?.type === "model-capabilities") {
      const knownIds = [...this.builtins, ...this.settings.customProviders].map(provider => provider.id);
      const imported = catalog.validateCapabilityProfile(raw, knownIds);
      const merged = new Map((this.settings.capabilityProfiles?.[imported.providerId]?.models || []).map(row => [row.id, row]));
      for (const row of imported.models) merged.set(row.id, row);
      this.settings.capabilityProfiles ||= {};
      this.settings.capabilityProfiles[imported.providerId] = { ...imported, models: [...merged.values()] };
      this.saveSettings();
      this.emit();
      return { type: raw.type, providerId: imported.providerId, state: this.snapshot() };
    }
    if (Array.isArray(raw) || raw?.type === "model-pricing" || raw?.type === "model-pricing-list" || raw?.type === "pricing") {
      if (!usageHelpers?.validatePricingImport || !usageHelpers?.mergePricing) throw new Error("모델 요금표 가져오기를 사용할 수 없습니다.");
      const incoming = usageHelpers.validatePricingImport(raw);
      const knownIds = new Set([...this.builtins, ...this.settings.customProviders].map(provider => provider.id));
      if (incoming.some(record => !knownIds.has(record.providerId))) throw new Error("등록된 AI 연결의 모델 요금만 가져올 수 있습니다.");
      this.settings.pricing = usageHelpers.mergePricing(this.settings.pricing || [], incoming);
      this.saveSettings();
      this.emit();
      return { type: "model-pricing", state: this.snapshot() };
    }
    const imported = catalog.validateProvider(raw);
    if (this.secretValues().some(secret => JSON.stringify(imported).includes(secret))) throw new Error("저장된 API 키가 사용자 연결 파일에 포함되어 있습니다.");
    if ([...this.builtins, ...this.settings.customProviders].some(row => row.id === imported.id)) throw new Error("같은 ID의 AI 연결이 이미 있습니다.");
    if (this.settings.customProviders.length >= 20) throw new Error("사용자 AI 연결은 최대 20개까지 저장할 수 있습니다.");
    this.settings.customProviders.push(imported);
    this.settings.providers[imported.id] = { added: true, enabled: false, mode: "api", model: "", effort: "default" };
    this.saveSettings();
    this.emit();
    return { type: "custom-provider", state: this.snapshot() };
  }

  removeProvider(providerId) {
    const provider = this.provider(providerId);
    if (!provider.custom) {
      this.settings.providers[providerId] = { ...this.config(provider), added: false, enabled: false };
    } else {
      this.settings.customProviders = this.settings.customProviders.filter(row => row.id !== providerId);
      delete this.settings.providers[providerId];
      delete this.vault.accounts[providerId];
      if (this.vault.available()) this.vault.save();
    }
    this.saveSettings();
    this.emit();
    return this.snapshot();
  }

  addProvider(providerId) {
    const provider = this.provider(providerId);
    if (provider.custom) return this.snapshot();
    this.settings.providers[providerId] = { ...this.config(provider), added: true };
    this.saveSettings();
    this.emit();
    return this.snapshot();
  }

  requireAdded(providerId) {
    const provider = typeof providerId === "string" ? this.provider(providerId) : providerId;
    if (!this.config(provider).added) throw new Error("먼저 AI 제공자를 추가하세요.");
    return provider;
  }

  async modelList(payload) {
    const provider = this.requireAdded(payload.providerId);
    const binding = this.adapterBinding(provider, { required: true });
    const pin = await this.components?.pin?.(binding.componentId);
    if (!pin?.adapter || pin.adapter.abiVersion !== 1) throw new Error("먼저 이 공급자의 연결 모듈을 설치하세요.");
    const adapter = pin.adapter;
    this.adapterCache.set(binding.componentId, adapter);
    const mode = provider.custom ? "api" : payload.mode === "api" ? "api" : "cli";
    let runtimeId = adapter.provider.cliId;
    let runtimePinned = false;
    let executable;
    const jobId = crypto.randomUUID();
    const cwd = path.join(this.jobsDirectory, jobId);
    if (mode === "cli") {
      if (!this.cliModelReader) {
        try { this.cliModelReader = require("./ai-models.cjs").readCliModels; } catch {}
      }
      try {
        if (typeof this.cliModelReader !== "function") throw new Error("설치한 CLI에서 모델 목록을 읽을 수 없습니다.");
        if (!runtimeId || !this.runtime) throw new Error("이 연결의 CLI 런타임을 사용할 수 없습니다.");
        fs.mkdirSync(cwd, { recursive: false });
        executable = await this.runtime.pin(runtimeId, { runtime: adapter.runtime });
        runtimePinned = !!executable;
        if (!executable) throw new Error("CLI가 설치되지 않았습니다. 먼저 설정에서 설치를 완료하세요.");
        let liveModels;
        if (adapter.cli.models.requiresApiModelList === true) {
          const key = this.getCredentials()[provider.id];
          if (!key) throw new Error("API 키를 먼저 저장하세요.");
          liveModels = await this.api.listModels({ provider: binding.apiProvider || adapter.provider, adapter, key, signal: undefined });
        }
        const modelPlan = typeof adapter.cli.models.buildPlan === "function"
          ? adapter.cli.models.buildPlan({ jobDirectory: cwd, liveModels }) : { args: [], files: [] };
        const files = Array.isArray(modelPlan?.files) ? modelPlan.files : [];
        this.writeAdapterFiles(cwd, files);
        const result = await this.cliModelReader({
          cliId: runtimeId, providerId: provider.id, adapter: adapter.cli.models, executable, spawnImpl: this.spawnImpl,
          timeoutMs: 15000, env: this.envFor(provider, this.getCredentials()[provider.id], adapter.provider),
          cwd, configArgs: modelPlan?.args || [],
        });
        const models = this.normalizeModelRows(provider, mode, result?.models);
        if (!models.length) throw new Error("설치한 CLI가 모델 목록을 반환하지 않았습니다. CLI를 업데이트하거나 로그인 상태를 확인하세요.");
        const queriedAt = new Date().toISOString();
        const currentModelId = models.some(row => row.id === result?.currentModelId) ? result.currentModelId : undefined;
        this.settings.modelCache ||= {};
        this.settings.modelCache[provider.id] ||= {};
        this.settings.modelCache[provider.id][mode] = { models, source: "cli", queriedAt, componentVersion: pin.version, ...(currentModelId ? { currentModelId } : {}) };
        this.saveSettings();
        this.emit();
        return { models: this.modelRows(provider, mode), source: "cli", queriedAt, ...(currentModelId ? { currentModelId } : {}) };
      } catch (error) {
        throw new Error(safeError(error, this.secretValues()));
      } finally {
        if (runtimePinned) this.runtime?.release?.(runtimeId);
          this.components?.release?.(binding.componentId, pin.version);
        if (fs.existsSync(cwd)) try { this.removeJobDirectory(cwd, jobId); } catch {}
      }
    }
    try {
      fs.mkdirSync(cwd, { recursive: false });
      const key = this.getCredentials()[provider.id];
      if (!key) throw new Error("API 키를 먼저 저장하세요.");
      const responseRows = await this.api.listModels({ provider: binding.apiProvider || adapter.provider, adapter, key, signal: undefined });
      const rows = this.normalizeModelRows(provider, mode, responseRows);
      if (!rows.length) throw new Error("API가 모델 목록을 반환하지 않았습니다.");
      const queriedAt = new Date().toISOString();
      this.settings.modelCache ||= {};
      this.settings.modelCache[provider.id] ||= {};
      this.settings.modelCache[provider.id][mode] = { models: rows, source: "api", queriedAt, componentVersion: pin.version };
      this.saveSettings();
      this.emit();
      return { models: this.modelRows(provider, mode), source: "api", queriedAt };
    } catch (error) { throw new Error(safeError(error, this.secretValues())); }
    finally {
      this.components?.release?.(binding.componentId, pin.version);
      if (fs.existsSync(cwd)) try { this.removeJobDirectory(cwd, jobId); } catch {}
    }
  }

  normalizeModelRows(provider, mode, values) {
    if (!Array.isArray(values)) return [];
    const models = [];
    const seen = new Set();
    for (const raw of values.slice(0, MAX_DISCOVERED_MODELS)) {
      if (!isPlainObject(raw) || typeof raw.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(raw.id) || seen.has(raw.id)) continue;
      seen.add(raw.id);
      const efforts = Array.isArray(raw.efforts) ? [...new Set(raw.efforts.filter(value => catalog.EFFORTS.includes(value)))].slice(0, 10) : [];
      const row = { id: raw.id, efforts };
      row.effortsReported = typeof raw.effortsReported === "boolean" ? raw.effortsReported : Array.isArray(raw.efforts);
      if (raw.supportsEffort === true || raw.supportsEffort === false) row.supportsEffort = raw.supportsEffort;
      if (typeof raw.name === "string" && raw.name.trim()) row.name = trimText(this.redact(raw.name.trim()), 100);
      if (catalog.EFFORTS.includes(raw.defaultEffort) && (raw.defaultEffort === "default" || efforts.includes(raw.defaultEffort))) row.defaultEffort = raw.defaultEffort;
      if (raw.pricing && usageHelpers?.validatePricing) {
        try { row.pricing = usageHelpers.validatePricing(raw.pricing); } catch {}
      }
      models.push(row);
    }
    return models;
  }

  writeAdapterFiles(jobDirectory, files) {
    if (!Array.isArray(files) || files.length > 16) throw new Error("Adapter plan contains too many temporary files.");
    let total = 0;
    for (const item of files) {
      if (!isPlainObject(item) || typeof item.relativePath !== "string" || typeof item.contents !== "string" || item.relativePath.includes("\\") || item.relativePath.startsWith("/")) throw new Error("Adapter plan contains an invalid temporary file.");
      const segments = item.relativePath.split("/");
      if (segments.some(segment => !segment || segment === "." || segment === ".." || segment.includes(":")) || segments.length > 8) throw new Error("Adapter plan contains an invalid temporary path.");
      const target = path.resolve(jobDirectory, ...segments);
      const relative = path.relative(jobDirectory, target);
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Adapter plan escaped its temporary directory.");
      total += Buffer.byteLength(item.contents, "utf8");
      if (total > 1024 * 1024) throw new Error("Adapter plan temporary files exceed the size limit.");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, item.contents, { flag: "wx", mode: 0o600 });
    }
  }

  async detect(payload = {}) {
    if (!this.runtime) throw new Error("AI 런타임을 사용할 수 없습니다.");
    const selected = payload.providerId
      ? [this.requireAdded(payload.providerId)]
      : [...this.builtins, ...this.settings.customProviders].filter(provider => this.config(provider).added);
    const results = [];
    for (const provider of selected) {
      const adapter = this.adapterFor(provider.id);
      const id = adapter?.provider?.cliId;
      if (!id) { results.push({ id: provider.id, status: "unavailable" }); continue; }
      try { await this.runtime.detect(id, { runtime: adapter.runtime }); results.push(this.runtimeState(id)); }
      catch (error) { results.push({ id, status: "error", error: safeError(error) }); }
    }
    this.emit();
    return { components: results, state: this.snapshot() };
  }

  async readQuota(provider, executable, signal, adapter) {
    const quota = await readCliQuota({
      cliId: adapter?.provider?.cliId, providerId: provider.id, descriptor: adapter?.cli?.quota, executable, signal,
      spawnImpl: this.spawnImpl, platform: this.platform, env: this.envFor(provider, undefined, adapter?.provider),
    });
    this.quotas.set(provider.id, quota);
    this.emit();
    return quota;
  }

  async refreshQuota(payload = {}) {
    const providers = payload.providerId
      ? [this.requireAdded(payload.providerId)]
      : [...this.builtins, ...this.settings.customProviders].filter(provider => this.config(provider).added);
    const results = [];
    for (const provider of providers) {
      let adapterPin = null;
      let nativeId = "";
      let runtimePinned = false;
      try {
        adapterPin = await this.components?.pin?.(provider.id);
        const adapter = adapterPin?.adapter;
        if (!adapter) throw new Error("Adapter is not installed.");
        this.adapterCache.set(provider.id, adapter);
        if (adapter.cli?.quota?.driver === "unsupported") throw new Error("Quota is unavailable for this CLI.");
        nativeId = adapter.provider.cliId || "";
        if (!nativeId || !this.runtime) throw new Error("CLI is unavailable.");
        const executable = await this.runtime.pin(nativeId, { runtime: adapter.runtime });
        runtimePinned = !!executable;
        if (!executable) throw new Error("CLI is not installed.");
        const quota = await this.readQuota(provider, executable, undefined, adapter);
        results.push({ providerId: provider.id, quota });
      } catch {
        const quota = { available: false, windows: [], source: "unsupported", updatedAt: Date.now(), reason: "사용량 정보를 읽지 못했습니다." };
        this.quotas.set(provider.id, quota);
        results.push({ providerId: provider.id, quota });
      } finally {
        if (runtimePinned) this.runtime?.release?.(nativeId);
        if (adapterPin) this.components?.release?.(provider.id, adapterPin.version);
      }
    }
    this.emit();
    return { results, state: this.snapshot() };
  }
  async importFile(dialog) {
    const result = await dialog.showOpenDialog({
      title: "AI 연결·모델 데이터 가져오기",
      properties: ["openFile"],
      filters: [{ name: "AI 연결 JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    return this.importDataFile(result.filePaths[0]);
  }

  async openDocs(providerId, shell) {
    const provider = this.requireAdded(providerId);
    const descriptor = this.adapterFor(provider.id, { required: true })?.provider;
    if (!descriptor?.docs || !this.shellOpenExternal && !shell?.openExternal)
      throw new Error("공식 문서를 열 수 없습니다.");
    const target = new URL(descriptor.docs);
    if (target.protocol !== "https:") throw new Error("공식 문서 주소를 확인할 수 없습니다.");
    await (this.shellOpenExternal || (url => shell.openExternal(url)))(target.href);
    return { opened: true };
  }

  envFor(provider, key, descriptor = this.adapterFor(provider.id)?.provider) {
    const env = { ...process.env };
    for (const name of SECRET_ENV) delete env[name];
    const envName = descriptor?.cliApiKeyEnv;
    if (key && typeof envName === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(envName) && SECRET_ENV.includes(envName)) env[envName] = key;
    return env;
  }

  startJob(job) {
    if (this.currentJob()) throw new Error("다른 AI 작업이 진행 중입니다.");
    job.id = crypto.randomUUID();
    job.createdAt = new Date().toISOString();
    job.status = "preparing";
    job.progress = 0;
    job.controller = new AbortController();
    this.jobs.set(job.id, job);
    this.latestJobId = job.id;
    this.emit();
    return job;
  }

  currentJob() {
    const job = this.jobs.get(this.latestJobId);
    return job && ["preparing", "running"].includes(job.status) ? job : null;
  }

  trimJobs() {
    const terminal = [...this.jobs.values()].filter(job => !["preparing", "running"].includes(job.status)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    while (this.jobs.size > MAX_MEMORY_JOBS && terminal.length) {
      const oldest = terminal.shift();
      if (oldest.id !== this.latestJobId) this.jobs.delete(oldest.id);
      else if (terminal.length) terminal.push(terminal.shift());
      else break;
    }
  }

  setJobText(job, value) {
    const bounded = trimUtf8(value, MAX_RESULT_TEXT);
    job.text = bounded.text;
    job.resultTruncated ||= bounded.truncated;
  }

  startAnalysis(payload, context) {
    const provider = this.requireAdded(payload.providerId);
    const binding = this.adapterBinding(provider, { required: true });
    const descriptor = binding.adapter;
    const config = this.config(provider);
    const mode = config.mode;
    if (!config.enabled) throw new Error("먼저 AI 연결을 켜세요.");
    const model = config.model;
    if (this.redact(model) !== model) throw new Error("저장된 API 키를 모델 이름으로 사용할 수 없습니다.");
    if (!model || !this.modelRows(provider, mode).some(row => row.id === model)) throw new Error("설정에서 현재 CLI/API 모드의 모델 목록을 조회한 뒤 모델을 선택하세요.");
    const effort = config.effort;
    if (!catalog.EFFORTS.includes(effort) || !this.effortsFor(provider, model, mode).includes(effort)) throw new Error("모델의 추론 단계를 확인하세요.");
    const request = normalizeRequest(this.redact(payload.prompt));
    const scope = normalizeScope(payload.scope);
    const budget = undefined;
    const key = this.getCredentials()[provider.id];
    if (mode === "api" && !key) throw new Error("API 키를 먼저 저장하세요.");
    if (mode === "cli" && descriptor.provider.cliApiKeyEnv && !key) throw new Error("이 CLI 연결에는 저장한 API 키가 필요합니다.");
    const selectedSessions = typeof context.sessions === "function" ? context.sessions(scope.sessionId) : [];
    const job = this.startJob({ providerId: provider.id, adapterComponentId: binding.componentId, customApiProvider: binding.apiProvider, mode, model, effort, request, scope, scopeSessionIds: selectedSessions.map(session => session.id), budget, includeIdentity: payload.includeIdentity === true, usage: null, cost: null, quotaBefore: null, quotaAfter: null, preview: null, text: "", error: "", runtimeId: descriptor.provider.cliId || "" });
    void this.executeAnalysis(job, provider, config, key, context);
    return { id: job.id };
  }

  async executeAnalysis(job, provider, config, key, context) {
    const secrets = [key];
    let runtimePinned = false;
    let nativeRuntimeId = "";
    let adapterVersion = "";
    let adapterPinned = false;
    let jobDirectory = "";
    try {
      const adapterComponentId = job.adapterComponentId || provider.id;
      const adapterPin = await this.components?.pin?.(adapterComponentId);
      if (!adapterPin?.adapter || adapterPin.adapter.abiVersion !== 1) throw new Error("먼저 이 공급자의 연결 모듈을 설치하세요.");
      const adapter = adapterPin.adapter;
      adapterVersion = adapterPin.version;
      adapterPinned = true;
      this.adapterCache.set(adapterComponentId, adapter);
      const cachedModels = this.settings.modelCache?.[provider.id]?.[job.mode]?.models || [];
      const cacheVersion = this.settings.modelCache?.[provider.id]?.[job.mode]?.componentVersion;
      if (cacheVersion !== adapterVersion || !cachedModels.some(row => row.id === job.model)) throw new Error("연결 모듈이 변경되었습니다. 설정에서 모델 목록을 다시 조회하세요.");
      const sessions = context.sessions(job.scope.sessionId);
      if (!sessions.length) throw new Error("선택한 방송 기록이 없습니다.");
      const modeCap = job.mode === "cli" ? CLI_CONTEXT_LIMIT : API_CONTEXT_LIMIT;
      const built = await this.contextBuilder({
        store: context.timelineStore, sessions, scope: job.scope, includeIdentity: job.includeIdentity,
        budget: job.budget, mode: job.mode, request: job.request, signal: job.controller.signal,
        onProgress: value => { if (context.isHistoryBusy?.()) throw new Error("선택한 기록을 정리 중입니다."); job.progress = 0.05; job.scanned = value.scanned; this.emit(); },
      });
      if (context.isHistoryBusy?.()) throw new Error("선택한 기록을 정리 중입니다.");
      job.preview = built.preview;
      if (built.preview.bytes > modeCap) throw new Error("선택한 AI 컨텍스트가 허용 크기를 초과합니다.");
      job.status = "running";
      job.progress = 0.08;
      this.emit();
      if (job.mode === "api") {
        if (typeof this.api.runApi !== "function") throw new Error("AI API 기능을 사용할 수 없습니다.");
        const response = await this.api.runApi({
          provider: job.customApiProvider || adapter.provider, adapter,
          key, model: job.model || undefined, effort: job.effort, prompt: built.prompt,
          signal: job.controller.signal, maxOutputTokens: 8192,
          pricing: this.pricingFor(provider.id, job.model),
          onText: value => { this.setJobText(job, (job.text || "") + String(value ?? "")); this.emit(); },
        });
        if (typeof response?.text === "string" && response.text) this.setJobText(job, response.text);
        job.usage = response?.usage || null;
        job.cost = response?.cost || null;
      } else {
        nativeRuntimeId = adapter.provider.cliId || "";
        if (!nativeRuntimeId || !this.runtime) throw new Error("이 공급자의 CLI를 사용할 수 없습니다.");
        const executable = await this.runtime.pin(nativeRuntimeId, { runtime: adapter.runtime });
        runtimePinned = !!executable;
        if (!executable) throw new Error("CLI가 설치되지 않았습니다. 설정에서 런타임을 설치하세요.");
        jobDirectory = path.join(this.jobsDirectory, job.id);
        fs.mkdirSync(jobDirectory, { recursive: false });
        const prompt = combinePrompt(built.prompt);
        const plan = adapter.cli.analysisPlan({ model: job.model, effort: job.effort, prompt, jobDirectory, verifiedModels: this.modelRows(provider, "cli") });
        if (!isPlainObject(plan) || !["stdin", "arg"].includes(plan.promptMode) || !Array.isArray(plan.args) || plan.args.some(value => typeof value !== "string" || value.length > 30000 || /[\0\r\n]/.test(value))) throw new Error("Adapter CLI plan is invalid.");
        this.writeAdapterFiles(jobDirectory, plan.files || []);
        const args = plan.args;
        const argvBytes = args.reduce((sum, value) => sum + Buffer.byteLength(value, "utf8") + 1, 0);
        if (argvBytes > 25000 || plan.promptMode === "arg" && !args.some(value => value.includes(prompt)) || plan.promptMode === "stdin" && args.some(value => value === prompt)) throw new Error("CLI prompt plan exceeds the safe command size.");
        const env = this.envFor(provider, key, adapter.provider);
        if (plan.envVars !== undefined) {
          if (!isPlainObject(plan.envVars) || Object.keys(plan.envVars).length > 16) throw new Error("Adapter environment plan is invalid.");
          for (const [name, value] of Object.entries(plan.envVars)) {
            if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name) || /(?:KEY|TOKEN|SECRET|PASSWORD)/.test(name) || SECRET_ENV.includes(name) || typeof value !== "string" || value.length > 1024 || /[\0\r\n]/.test(value) || key && value.includes(key)) throw new Error("Adapter environment plan is unsafe.");
            env[name] = value;
          }
        }
        if (adapter.cli.quota?.driver !== "unsupported") job.quotaBefore = await this.readQuota(provider, executable, job.controller.signal, adapter);
        const cliText = await this.runCli({
          executable, args, cwd: jobDirectory, env,
          prompt: plan.promptMode === "stdin" ? prompt : null,
          adapter, signal: job.controller.signal, jobDirectory,
          onText: value => { this.setJobText(job, value); this.emit(); },
          onTruncated: () => { job.resultTruncated = true; this.emit(); },
          onUsage: raw => { try { job.usage = adapter.api.normalizeUsage({ raw, source: "cli" }) || job.usage; } catch {} this.emit(); },
          onQuota: quota => { if (quota) { this.quotas.set(provider.id, quota); this.emit(); } },
        });
        this.setJobText(job, cliText);
        if (adapter.cli.quota?.driver !== "unsupported" && !job.controller.signal.aborted) job.quotaAfter = await this.readQuota(provider, executable, job.controller.signal, adapter);
        if (usageHelpers?.estimateCost) job.cost = usageHelpers.estimateCost({ providerId: provider.id, modelId: job.model, usage: job.usage, pricing: this.pricingFor(provider.id, job.model) });
      }
      if (job.controller.signal.aborted) throw new Error("AI 분석을 취소했습니다.");
      if (!job.text.trim()) throw new Error("AI CLI가 응답을 반환하지 않았습니다. 런타임을 업데이트하고 다시 시도하세요.");
      job.status = "completed";
      job.progress = 1;
      job.finishedAt = new Date().toISOString();
      this.remember(job);
      this.trimJobs();
    } catch (error) {
      job.status = job.controller.signal.aborted ? "canceled" : "failed";
      job.error = safeError(error, secrets);
      job.finishedAt = new Date().toISOString();
    } finally {
      if (runtimePinned) this.runtime?.release?.(nativeRuntimeId);
      if (adapterPinned) this.components?.release?.(job.adapterComponentId || provider.id, adapterVersion);
      if (jobDirectory) try { this.removeJobDirectory(jobDirectory, job.id); } catch {}
      job.controller = null;
      this.emit();
    }
  }

  runCli({ executable, args, cwd, env, prompt, adapter, signal, jobDirectory, onText, onUsage, onQuota, onTruncated }) {
    return new Promise((resolve, reject) => {
      let child;
      let output = "";
      let stderrBytes = 0;
      let stderrSample = "";
      let stdoutBytes = 0;
      let lineBuffer = "";
      let timer;
      let completed = false;
      let providerFailure = false;
      const decoder = new StringDecoder("utf8");
      const terminate = () => {
        if (!child) return;
        if (this.platform === "win32" && child.pid) {
          const systemRoot = process.env.SystemRoot || "C:\\Windows";
          const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
          try { this.spawnImpl(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false }); } catch {}
        } else {
          try { child.kill("SIGTERM"); } catch {}
          const killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1500);
          killTimer.unref?.();
        }
      };
      const finishError = error => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(error);
      };
      const appendLine = line => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (!isPlainObject(event) || !adapter?.cli || typeof adapter.cli.parseEvent !== "function") return;
        let parsed;
        try { parsed = adapter.cli.parseEvent({ event }); } catch { providerFailure = true; return; }
        if (!parsed || typeof parsed !== "object") return;
        if (parsed.quota) { try { onQuota?.(parsed.quota); } catch {} }
        if (parsed.usage) { try { onUsage?.(parsed.usage); } catch {} }
        if (parsed.error || parsed.toolRequest || parsed.incomplete) { providerFailure = true; return; }
        if (parsed.text) {
          const bounded = trimUtf8(parsed.appendText ? output + parsed.text : parsed.text, MAX_RESULT_TEXT);
          output = bounded.text;
          if (bounded.truncated) { try { onTruncated?.(); } catch {} }
          try { onText?.(output); } catch {}
        }
      };
      const abort = () => {
        if (completed) return;
        terminate();
        finishError(new Error("AI 분석을 취소했습니다."));
      };
      if (signal?.aborted) return reject(new Error("AI 분석을 취소했습니다."));
      try {
        child = this.spawnImpl(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      } catch (error) { return reject(new Error(error?.code === "ENOENT" ? "CLI 실행 파일을 찾을 수 없습니다." : "CLI를 시작하지 못했습니다.")); }
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => { terminate(); finishError(new Error("AI 요청이 10분 제한 시간을 초과했습니다.")); }, MAX_JOB_MS);
      timer.unref?.();
      child.stdout?.on("data", chunk => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > 8 * 1024 * 1024) { terminate(); return finishError(new Error("CLI 응답이 허용 크기를 초과했습니다.")); }
        lineBuffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        if (lineBuffer.length > MAX_CLI_LINE && !lineBuffer.includes("\n")) { terminate(); return finishError(new Error("CLI 응답 줄이 허용 크기를 초과했습니다.")); }
        let newline;
        while ((newline = lineBuffer.indexOf("\n")) >= 0) {
          const line = lineBuffer.slice(0, newline).trim();
          lineBuffer = lineBuffer.slice(newline + 1);
          if (line) appendLine(line);
        }
      });
      child.stderr?.on("data", chunk => {
        stderrBytes = Math.min(stderrBytes + chunk.length, 4 * 1024 * 1024);
        if (Buffer.byteLength(stderrSample) < 8192) stderrSample = trimText(stderrSample + (Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)), 8192);
      });
      child.on("error", error => finishError(new Error(error?.code === "ENOENT" ? "CLI 실행 파일을 찾을 수 없습니다." : "CLI를 시작하지 못했습니다.")));
      child.on("close", code => {
        if (completed) return;
        lineBuffer += decoder.end();
        if (lineBuffer.trim()) appendLine(lineBuffer.trim());
        const finalText = output;
        const lowered = stderrSample.toLowerCase();
        if (code !== 0 || providerFailure) {
          if (/unknown (?:option|argument)|unrecognized (?:option|argument)|unknown flag/.test(lowered)) return finishError(new Error("설치한 CLI 버전이 필요한 제한 옵션을 지원하지 않습니다. 설정에서 런타임을 업데이트하세요."));
          if (/not logged in|authentication|unauthorized|login required|sign in/.test(lowered)) return finishError(new Error("CLI 계정 로그인이 필요합니다. 설정에서 로그인을 완료하세요."));
          if (/git.*(?:not found|missing|install)|bash.*(?:not found|missing|install)/.test(lowered)) return finishError(new Error("이 CLI에 필요한 Git for Windows 구성 요소를 설치한 뒤 다시 시도하세요."));
          if (code !== 0) return finishError(new Error(`CLI 요청이 실패했습니다 (종료 코드 ${Number.isInteger(code) ? code : "알 수 없음"}).`));
          return finishError(new Error("CLI가 안전 설정 또는 요청 처리 오류를 보고했습니다. 런타임을 업데이트하고 다시 시도하세요."));
        }
        if (!finalText.trim()) return finishError(new Error("CLI 응답을 읽지 못했습니다. 런타임을 업데이트하고 다시 시도하세요."));
        completed = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(finalText);
      });
      if (prompt != null) {
        try { child.stdin?.end(prompt, "utf8"); }
        catch { terminate(); finishError(new Error("CLI 입력을 전달하지 못했습니다.")); }
      } else child.stdin?.end();
    });
  }

  remember(job) {
    if (!this.encrypted()) return;
    const saved = {
      id: job.id, createdAt: job.createdAt, finishedAt: job.finishedAt,
      providerId: job.providerId, mode: job.mode, model: this.redact(job.model),
      effort: job.effort, request: trimText(this.redact(job.request), 10000),
      scope: job.scope, preview: job.preview, usage: redactObjectStrings(job.usage, this.secretValues()),
      cost: redactObjectStrings(job.cost, this.secretValues()), quotaBefore: redactObjectStrings(job.quotaBefore, this.secretValues()), quotaAfter: redactObjectStrings(job.quotaAfter, this.secretValues()),
      resultTruncated: job.resultTruncated === true,
      status: job.status, text: trimUtf8(this.redact(job.text), MAX_RESULT_TEXT).text,
    };
    this.results = this.results.filter(item => item.id !== saved.id);
    this.results.push(saved);
    this.saveResults();
  }

  getJob(id) {
    if (typeof id !== "string") throw new Error("AI 작업 ID를 확인하세요.");
    const job = this.jobs.get(id) || this.results.find(row => row.id === id);
    if (!job) throw new Error("AI 결과를 찾을 수 없습니다.");
    return this.jobSnapshot(job, true);
  }

  deleteResult(id) {
    if (typeof id !== "string") throw new Error("AI 결과 ID를 확인하세요.");
    const job = this.jobs.get(id);
    if (job && ["preparing", "running"].includes(job.status)) this.cancel(id);
    this.results = this.results.filter(item => item.id !== id);
    this.jobs.delete(id);
    if (this.latestJobId === id) this.latestJobId = null;
    this.saveResults();
    this.emit();
    return this.snapshot();
  }

  clearResults() {
    for (const job of this.jobs.values()) if (["api", "cli"].includes(job.mode) && job.controller && ["preparing", "running"].includes(job.status)) this.cancel(job.id);
    for (const [id, job] of this.jobs) if (["api", "cli"].includes(job.mode)) this.jobs.delete(id);
    if (!this.jobs.has(this.latestJobId)) this.latestJobId = null;
    this.results = [];
    try { fs.rmSync(this.resultsFile, { force: true }); } catch {}
    this.emit();
    return this.snapshot();
  }

  deleteResultsForDates({ sessionIds = [], dates = [] } = {}) {
    const ids = new Set(sessionIds);
    const removed = new Set();
    this.results = this.results.filter(item => {
      const scope = item.preview?.scope || item.scope || {};
      const resultIds = new Set(scope.sessionIds || (scope.sessionId ? [scope.sessionId] : []));
      const sessionMatches = !ids.size || !resultIds.size || [...ids].some(id => resultIds.has(id));
      const from = scope.dateFrom || "", to = scope.dateTo || "";
      const dateMatches = dates.some(date => (!from || date >= from) && (!to || date <= to));
      const keep = !(sessionMatches && dateMatches);
      if (!keep) removed.add(item.id);
      return keep;
    });
    this.cancelJobsForScope(ids, new Set(dates));
    for (const id of removed) this.jobs.delete(id);
    if (removed.has(this.latestJobId)) this.latestJobId = null;
    this.saveResults();
    this.emit();
  }

  cancelJobsForScope(sessionIds, dates) {
    const removed = [];
    for (const job of this.jobs.values()) {
      if (!["api", "cli"].includes(job.mode)) continue;
      if (!job.controller || !["preparing", "running"].includes(job.status)) continue;
      const scopedIds = new Set(job.preview?.scope?.sessionIds || job.scopeSessionIds || (job.scope?.sessionId ? [job.scope.sessionId] : []));
      const sessionMatches = !sessionIds.size || !scopedIds.size || [...sessionIds].some(id => scopedIds.has(id));
      if (sessionMatches) {
        const from = job.scope?.dateFrom || "", to = job.scope?.dateTo || "";
        if (!from && !to || [...dates].some(date => (!from || date >= from) && (!to || date <= to))) {
          this.cancel(job.id);
          removed.push(job.id);
        }
      }
    }
    for (const id of removed) this.jobs.delete(id);
    if (removed.includes(this.latestJobId)) this.latestJobId = null;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || !job.controller || !["preparing", "running"].includes(job.status)) return { canceled: false };
    job.controller.abort();
    job.status = "canceled";
    job.error = "AI 분석을 취소했습니다.";
    job.finishedAt = new Date().toISOString();
    this.emit();
    return { canceled: true };
  }

  cancelAll() {
    for (const job of this.jobs.values()) if (job.controller && ["preparing", "running"].includes(job.status)) this.cancel(job.id);
  }

  async checkAdapters(payload = {}) {
    if (!this.components) throw new Error("AI 연결 모듈 관리자를 사용할 수 없습니다.");
    const providers = payload.providerId
      ? [this.requireAdded(payload.providerId)]
      : [...this.builtins, ...this.settings.customProviders].filter(provider => this.config(provider).added);
    await this.components.catalog({ refresh: true });
    const results = [];
    for (const provider of providers) {
      try {
        const binding = this.adapterBinding(provider, { required: true });
        const info = await this.components.info(binding.componentId);
        this.adapterInfo.set(provider.id, info);
        if (info.component?.version) {
          const adapter = this.components.load(binding.componentId);
          if (adapter?.abiVersion === 1) this.adapterCache.set(binding.componentId, adapter);
        }
        results.push({ providerId: provider.id, component: info.component, latest: info.latest, updateAvailable: info.updateAvailable });
      } catch (error) {
        results.push({ providerId: provider.id, error: safeError(error) });
      }
    }
    this.emit();
    return { results, state: this.snapshot() };
  }

  async startAdapterAction(action, payload = {}) {
    if (!this.components) throw new Error("AI 연결 모듈 관리자를 사용할 수 없습니다.");
    const provider = this.requireAdded(payload.providerId);
    const binding = this.adapterBinding(provider);
    const componentId = binding.componentId || provider.id;
    const job = this.startJob({ providerId: provider.id, mode: "adapter", model: "", effort: "default", request: "", text: "", error: "", runtimeId: componentId });
    void (async () => {
      try {
        job.status = "running";
        this.emit();
        if (action === "ai-adapter-remove") {
          const inUse = [...this.builtins, ...this.settings.customProviders].some(other => other.id !== provider.id && this.adapterBinding(other).componentId === componentId && this.config(other).enabled);
          if (inUse) throw new Error("다른 활성 AI 연결이 사용하는 공용 연결 모듈은 제거할 수 없습니다.");
        }
        if (action === "ai-adapter-install") await this.components.install(componentId, { signal: job.controller.signal, version: payload.version });
        else if (action === "ai-adapter-update") await this.components.update(componentId, { signal: job.controller.signal, version: payload.version });
        else if (action === "ai-adapter-remove") await this.components.remove(componentId);
        else if (action === "ai-adapter-rollback") await this.components.rollback(componentId);
        else throw new Error("지원하지 않는 연결 모듈 작업입니다.");
        const state = this.components.snapshot().byId?.[componentId];
        this.adapterCache.delete(componentId);
        if (state?.version) {
          const adapter = this.components.load(componentId);
          if (adapter?.abiVersion === 1) this.adapterCache.set(componentId, adapter);
        }
        for (const affected of [...this.builtins, ...this.settings.customProviders]) {
          if (this.adapterBinding(affected).componentId !== componentId) continue;
          delete this.settings.modelCache?.[affected.id];
          const saved = this.settings.providers[affected.id];
          if (saved) this.settings.providers[affected.id] = { ...saved, enabled: false, model: "", effort: "default" };
        }
        this.saveSettings();
        job.status = "completed";
        job.progress = 1;
      } catch (error) {
        job.status = job.controller?.signal.aborted ? "canceled" : "failed";
        job.error = safeError(error, this.secretValues());
      } finally {
        job.finishedAt = new Date().toISOString();
        job.controller = null;
        this.emit();
      }
    })();
    return { id: job.id };
  }

  async startRuntimeAction(action, payload) {
    const provider = this.requireAdded(payload.providerId);
    const adapter = this.adapterFor(provider.id, { required: true });
    const componentId = adapter.provider.cliId;
    if (!componentId || !this.runtime) throw new Error("이 연결에는 관리할 CLI가 없습니다.");
    if (action === "ai-component-remove") {
      for (const other of [...this.builtins, ...this.settings.customProviders]) {
        if (other.id !== provider.id && this.adapterFor(other.id)?.provider?.cliId === componentId && this.config(other).enabled)
          throw new Error("다른 활성 AI 연결이 사용하는 공용 CLI는 제거할 수 없습니다.");
      }
    }
    const job = this.startJob({ providerId: provider.id, mode: "runtime", model: "", effort: "default", runtimeId: componentId, request: "", text: "", error: "" });
    void (async () => {
      try {
        job.status = "running"; this.emit();
        if (action === "ai-install" || action === "ai-update") await this.runtime.install(componentId, { version: payload.version, signal: job.controller.signal, runtime: adapter.runtime });
        else if (action === "ai-component-remove") await this.runtime.remove(componentId, { runtime: adapter.runtime });
        else if (action === "ai-rollback") await this.runtime.rollback(componentId, { runtime: adapter.runtime });
        else throw new Error("지원하지 않는 AI 런타임 동작입니다.");
        job.status = "completed"; job.progress = 1;
      } catch (error) {
        job.status = job.controller?.signal.aborted ? "canceled" : "failed";
        job.error = safeError(error);
      } finally {
        job.finishedAt = new Date().toISOString(); job.controller = null; this.emit();
      }
    })();
    return { id: job.id };
  }

  async login(payload) {
    const provider = this.requireAdded(payload.providerId);
    const adapter = this.adapterFor(provider.id, { required: true });
    const cliId = adapter.provider.cliId;
    if (!cliId || !this.runtime) throw new Error("이 연결에는 CLI 로그인이 없습니다.");
    const executable = await this.runtime.resolve(cliId, { runtime: adapter.runtime });
    if (!executable) throw new Error("CLI를 설치한 뒤 로그인하세요.");
    if (typeof executable !== "string" || !path.isAbsolute(executable) || !/\.exe$/i.test(executable)) throw new Error("확인되지 않은 CLI 실행 파일입니다.");
    const args = adapter.cli.loginArgs;
    if (!Array.isArray(args) || args.length > 16 || args.some(value => typeof value !== "string" || value.length > 128 || /[\0\r\n]/.test(value))) throw new Error("이 CLI에는 안전하게 안내할 로그인 명령이 없습니다.");
    const escaped = executable.replace(/'/g, "''");
    const command = `& '${escaped}'${args.length ? " " + args.map(arg => `'${arg.replace(/'/g, "''")}'`).join(" ") : ""}`;
    let child;
    try {
      child = this.spawnImpl("powershell.exe", ["-NoExit", "-NoProfile", "-Command", command], { shell: false, windowsHide: false, detached: true, stdio: "ignore" });
      child.unref?.();
    } catch { throw new Error("로그인용 PowerShell을 열지 못했습니다."); }
    return { started: true };
  }

  async handle(action, payload = {}, context = {}) {
    switch (action) {
      case "ai-state": return this.snapshot();
      case "ai-model-options": return this.modelOptions(payload);
      case "ai-save": return this.save(payload);
      case "ai-key-save": return this.saveKey(payload);
      case "ai-key-remove": return this.removeKey(payload.providerId);
      case "ai-provider-import": return this.importFile(context.dialog);
      case "ai-provider-add": return this.addProvider(payload.providerId);
      case "ai-provider-remove": return this.removeProvider(payload.providerId);
      case "ai-open-docs": case "ai-docs-open": return this.openDocs(payload.providerId, context.shell);
      case "ai-cli-login": case "ai-login": return this.login(payload);
      case "ai-detect": return this.detect(payload);
      case "ai-install": case "ai-update": case "ai-component-remove": case "ai-rollback": case "ai-component-rollback": return this.startRuntimeAction(action === "ai-component-rollback" ? "ai-rollback" : action, payload);
      case "ai-adapter-check": return this.checkAdapters(payload);
      case "ai-adapter-install": case "ai-adapter-update": case "ai-adapter-remove": case "ai-adapter-rollback": return this.startAdapterAction(action, payload);
      case "ai-models": return this.modelList(payload);
      case "ai-quota-refresh": return this.refreshQuota(payload);
      case "ai-preview": {
        if (context.historyBusy || context.isHistoryBusy?.()) throw new Error("선택한 기록을 정리 중입니다.");
        const provider = this.requireAdded(payload.providerId);
        const config = this.config(provider);
        const mode = config.mode;
        const sessionScope = normalizeScope(payload.scope);
        const sessions = context.sessions(sessionScope.sessionId);
        const built = await this.contextBuilder({ store: context.timelineStore, sessions, scope: sessionScope, includeIdentity: payload.includeIdentity === true, budget: undefined, mode, request: payload.prompt, signal: undefined, onProgress: () => { if (context.isHistoryBusy?.()) throw new Error("선택한 기록을 정리 중입니다."); } });
        return built.preview;
      }
      case "ai-run": {
        if (context.historyBusy || context.isHistoryBusy?.()) throw new Error("선택한 기록을 정리 중입니다.");
        return this.startAnalysis(payload, context);
      }
      case "ai-cancel": return this.cancel(payload.id);
      case "ai-job-status": return this.getJob(payload.id);
      case "ai-results-get": return this.getJob(payload.id);
      case "ai-result-delete": return this.deleteResult(payload.id);
      case "ai-results-clear": return this.clearResults();
      default: throw new Error("지원하지 않는 AI 요청입니다.");
    }
  }

  shutdown() {
    this.deleted = true;
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
    this.cancelAll();
  }
}

module.exports = { CommonAiService, safeError, SECRET_ENV, RESULTS_BYTES_LIMIT, RESULT_LIMIT };
