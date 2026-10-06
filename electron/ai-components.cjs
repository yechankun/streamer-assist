"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const DEFAULT_TRUST = require("./ai-components-config.json");

const REPOSITORY = "yechankun/streamer-assist-ai-connectors";
const CATALOG_URL = `https://github.com/${REPOSITORY}/releases/download/catalog-v1/catalog.json`;
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/tags/`;
const DISTRIBUTION_BRANCH = "distribution-v1";
const DISTRIBUTION_PATH = "index.json";
const DISTRIBUTION_URL = `https://raw.githubusercontent.com/${REPOSITORY}/${DISTRIBUTION_BRANCH}/${DISTRIBUTION_PATH}`;
const ABI_VERSION = 1;
const MAX_CATALOG_BYTES = 512 * 1024;
const MAX_INDEX_BYTES = 512 * 1024;
const MAX_CATALOG_CACHE_BYTES = 2 * MAX_INDEX_BYTES + 32 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 128;
const CATALOG_CACHE_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const API_COOLDOWNS = new Map();
const ALLOWED_RELEASE_HOSTS = new Set(["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const PROVIDERS = Object.freeze({
  openai: { cliId: "codex", protocol: "responses", origin: "https://api.openai.com", apiKeyEnv: "OPENAI_API_KEY", cliApiKeyEnv: null },
  anthropic: { cliId: "claude", protocol: "anthropic", origin: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY", cliApiKeyEnv: null },
  xai: { cliId: "grok", protocol: "chat", origin: "https://api.x.ai", apiKeyEnv: "XAI_API_KEY", cliApiKeyEnv: null },
  google: { cliId: "agy", protocol: "gemini", origin: "https://generativelanguage.googleapis.com", apiKeyEnv: "GEMINI_API_KEY", cliApiKeyEnv: null },
  deepseek: { cliId: "codex", protocol: "chat", origin: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY", cliApiKeyEnv: "DEEPSEEK_API_KEY" },
  moonshot: { cliId: "kimi", protocol: "chat", origin: "https://api.moonshot.ai", apiKeyEnv: "MOONSHOT_API_KEY", cliApiKeyEnv: null },
});
const ID_LIST = Object.freeze(Object.keys(PROVIDERS));
const CLI_MODELS_DRIVER = Object.freeze({
  openai: "codex-app-server", anthropic: "claude-initialize", xai: "grok-models",
  google: "agy-models", deepseek: "codex-app-server", moonshot: "kimi-acp",
});
const CLI_QUOTA_DRIVER = Object.freeze({
  openai: "codex-rate-limits", anthropic: "claude-events", xai: "unsupported",
  google: "unsupported", deepseek: "unsupported", moonshot: "unsupported",
});
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

class VerificationError extends Error {}

function componentId(id) {
  if (!Object.hasOwn(PROVIDERS, id)) throw new Error(`Unknown AI adapter component: ${String(id)}`);
  return PROVIDERS[id];
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function within(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function samePath(left, right, pathImpl = path, ignoreCase = process.platform === "win32") {
  const first = pathImpl.resolve(left);
  const second = pathImpl.resolve(right);
  return ignoreCase ? pathImpl.relative(first, second) === "" : first === second;
}

function withinPath(parent, candidate, pathImpl = path) {
  const base = pathImpl.resolve(parent), target = pathImpl.resolve(candidate);
  const relative = pathImpl.relative(base, target);
  return relative === "" || (!pathImpl.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${pathImpl.sep}`));
}

function canonicalManagedTarget({ rootReal, parentReal, targetParentReal, targetPath, pathImpl = path, ignoreCase = process.platform === "win32" } = {}) {
  if (![rootReal, parentReal, targetParentReal, targetPath].every(value => typeof value === "string" && value)) throw new Error("Adapter metadata target is invalid.");
  if (!withinPath(rootReal, parentReal, pathImpl) || samePath(rootReal, parentReal, pathImpl, ignoreCase)) throw new Error("Adapter metadata parent escaped its managed root.");
  if (!samePath(parentReal, targetParentReal, pathImpl, ignoreCase)) throw new Error("Adapter metadata target escaped its managed directory.");
  const basename = pathImpl.basename(pathImpl.resolve(targetPath));
  if (!basename || basename === "." || basename === "..") throw new Error("Adapter metadata target is invalid.");
  const canonical = pathImpl.join(pathImpl.resolve(parentReal), basename);
  if (!withinPath(parentReal, canonical, pathImpl) || samePath(parentReal, canonical, pathImpl, ignoreCase)) throw new Error("Adapter metadata target escaped its managed directory.");
  return canonical;
}

function validVersion(value) {
  if (typeof value !== "string" || value.length > 128 || !VERSION_PATTERN.test(value)) throw new Error("Adapter version is not valid SemVer.");
  return value;
}

function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function cooldownKey(root) {
  const resolved = path.resolve(root);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function checkBase64(value, label) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error(`${label} is not valid base64.`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(`${label} is not canonical base64.`);
  return decoded;
}

function validateRelativeFile(value) {
  if (typeof value !== "string" || !value || value.length > 512 || value.startsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error("Adapter package contains an unsafe file path.");
  const segments = value.split("/");
  if (segments.length > 12 || segments.some(segment => !segment || segment === "." || segment === ".." || segment.includes(":") || /[. ]$/.test(segment) || WINDOWS_RESERVED.test(segment) || segment.length > 180)) {
    throw new Error("Adapter package contains an unsafe file path.");
  }
  return segments.join(path.sep);
}

function validateAssetName(value) {
  if (typeof value !== "string" || value.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.saip\.json$/.test(value) || value.includes("..")) {
    throw new Error("Adapter catalog contains an unsafe asset name.");
  }
  return value;
}

function componentReleaseTag(id, version) {
  componentId(id);
  return `${id}-v${validVersion(version)}`;
}

function releaseUrl(id, version, asset) {
  return `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(componentReleaseTag(id, version))}/${encodeURIComponent(asset)}`;
}

function statusError(error, phase) {
  if (error?.name === "AbortError") return "Adapter operation was cancelled.";
  if (error?.message === "Adapter operation was cancelled.") return error.message;
  if (error?.code === "GITHUB_API_COOLDOWN") {
    const retry = Number.isFinite(error.retryAt) ? new Date(error.retryAt).toISOString() : "later";
    return `GitHub release metadata is rate-limited (HTTP 403); retry after ${retry}.`;
  }
  const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,47}$/.test(error.code) ? error.code : "";
  const syscall = typeof error?.syscall === "string" && ["rename", "open", "write", "unlink", "mkdir", "read", "stat", "realpath", "scandir", "rmdir"].includes(error.syscall) ? error.syscall : "";
  const httpStatus = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? `HTTP ${error.status}` : "";
  const systemError = !!(code || error?.syscall || error?.path || error?.dest);
  if (!systemError && !httpStatus && typeof error?.message === "string" && error.message.length < 220) return error.message;
  const description = ({
    checking: "Adapter catalog check failed",
    downloading: "Adapter download failed",
    verifying: "Adapter verification failed",
    installing: "Adapter installation failed",
    removing: "Adapter removal failed",
    "rolling-back": "Adapter rollback failed",
  })[phase] || "Adapter operation failed";
  const details = [httpStatus, code, syscall].filter(Boolean);
  return `${description}${details.length ? ` (${details.join(", ")})` : ""}.`;
}

function validateTrustConfig(input) {
  const directDigest = input?.verification === "github-release-digest";
  const publishedReceipts = input?.verification === "github-published-release-receipts" && input.distributionBranch === DISTRIBUTION_BRANCH && input.distributionPath === DISTRIBUTION_PATH;
  if (!isPlainObject(input) || input.schemaVersion !== 1 || input.repository !== REPOSITORY || input.catalogTag !== "catalog-v1" || input.catalogAsset !== "catalog.json" || input.abiVersion !== ABI_VERSION || (!directDigest && !publishedReceipts)) {
    throw new Error("Adapter verification must use the configured GitHub repository and release digest.");
  }
  return input;
}

function parsePackageEnvelope(raw) {
  if (!Buffer.isBuffer(raw) || raw.length > MAX_PACKAGE_BYTES) throw new Error("Adapter package exceeds the size limit.");
  let envelope;
  try { envelope = JSON.parse(raw.toString("utf8")); } catch { throw new Error("Adapter package is invalid JSON."); }
  const payloadBytes = isPlainObject(envelope) && typeof envelope.payload === "string"
    ? checkBase64(envelope.payload, "Adapter payload")
    : raw;
  let payload;
  try { payload = JSON.parse(payloadBytes.toString("utf8")); } catch { throw new Error("Adapter package payload is invalid JSON."); }
  if (!isPlainObject(payload)) throw new Error("Adapter package payload must be an object.");
  return { payload, payloadBytes };
}

function validateCatalogPayload(payload) {
  if (payload.schemaVersion !== 1 || payload.repository !== REPOSITORY || payload.abiVersion !== ABI_VERSION ||
      typeof payload.generatedAt !== "string" || !Number.isFinite(Date.parse(payload.generatedAt)) || !Array.isArray(payload.components) || payload.components.length > ID_LIST.length) {
    throw new Error("Adapter catalog schema or repository is invalid.");
  }
  const seen = new Set();
  const components = payload.components.map(item => {
    if (!isPlainObject(item) || !Object.hasOwn(PROVIDERS, item.id) || seen.has(item.id) || item.abiVersion !== ABI_VERSION) throw new Error("Adapter catalog contains an unsupported component.");
    seen.add(item.id);
    validVersion(item.version);
    validateAssetName(item.asset);
    if (!validHash(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > MAX_PACKAGE_BYTES) throw new Error("Adapter catalog contains invalid package metadata.");
    return { id: item.id, version: item.version, abiVersion: item.abiVersion, asset: item.asset, sha256: item.sha256.toLowerCase(), size: item.size };
  });
  return { schemaVersion: payload.schemaVersion, repository: payload.repository, generatedAt: payload.generatedAt, abiVersion: payload.abiVersion, components };
}

function validatePackagePayload(payload, id, version) {
  if (payload.schemaVersion !== 1 || payload.abiVersion !== ABI_VERSION || payload.id !== id || payload.version !== version || !Array.isArray(payload.files) || payload.files.length < 1 || payload.files.length > MAX_FILES) {
    throw new Error("Adapter package identity or schema is invalid.");
  }
  validVersion(payload.version);
  const entry = validateRelativeFile(payload.entry);
  const seen = new Set();
  let totalBytes = 0;
  const files = payload.files.map(item => {
    if (!isPlainObject(item) || typeof item.path !== "string" || !validHash(item.sha256)) throw new Error("Adapter package file metadata is invalid.");
    const relative = validateRelativeFile(item.path);
    // Windows filesystems are case-insensitive by default. Treat differently
    // cased paths as collisions so a verified package cannot overwrite a file
    // after extraction on Windows.
    const collisionKey = relative.toLocaleLowerCase("en-US");
    if (seen.has(collisionKey)) throw new Error("Adapter package contains duplicate file paths.");
    seen.add(collisionKey);
    const bytes = checkBase64(item.content, "Adapter file content");
    if (bytes.length > MAX_FILE_BYTES) throw new Error("Adapter package file exceeds the size limit.");
    totalBytes += bytes.length;
    if (totalBytes > MAX_PACKAGE_BYTES || sha256(bytes) !== item.sha256.toLowerCase()) throw new Error("Adapter package file hash verification failed.");
    return { relative, digest: item.sha256.toLowerCase(), bytes };
  });
  if (!seen.has(entry)) throw new Error("Adapter entry file is missing.");
  if (!entry.toLowerCase().endsWith(".cjs")) throw new Error("Adapter entry must be a CommonJS file.");
  return { id, version, entry, files, totalBytes };
}

function validateDescriptor(adapter, id) {
  const provider = PROVIDERS[id];
  if (!isPlainObject(adapter) || adapter.abiVersion !== ABI_VERSION || !isPlainObject(adapter.provider) || adapter.provider.id !== id ||
      !isPlainObject(adapter.api) || !isPlainObject(adapter.cli)) throw new Error("Adapter descriptor has an unsupported ABI.");
  const metadata = adapter.provider;
  if (typeof metadata.name !== "string" || !metadata.name.trim() || metadata.name.length > 100 || metadata.protocol !== provider.protocol || (metadata.cliId && metadata.cliId !== provider.cliId)) {
    throw new Error("Adapter provider metadata does not match its registered provider.");
  }
  const docs = checkedHttpsUrl(metadata.docs, "Adapter documentation URL");
  const baseUrl = checkedHttpsUrl(metadata.baseUrl || `${provider.origin}/v1`, "Adapter API URL");
  if (new URL(baseUrl).origin !== provider.origin) throw new Error("Adapter API URL is outside the provider's trusted origin.");
  if ((metadata.apiKeyEnv && metadata.apiKeyEnv !== provider.apiKeyEnv) || (metadata.cliApiKeyEnv && metadata.cliApiKeyEnv !== provider.cliApiKeyEnv)) throw new Error("Adapter credential environment metadata does not match the provider.");
  const apiFunctions = ["buildRequest", "parseEvent", "buildModelsRequest", "parseModelsResponse", "normalizeUsage"];
  if (apiFunctions.some(name => typeof adapter.api[name] !== "function")) throw new Error("Adapter API hooks are incomplete.");
  if (typeof adapter.cli.analysisPlan !== "function" || typeof adapter.cli.parseEvent !== "function" || !isPlainObject(adapter.cli.models) || !isPlainObject(adapter.cli.quota)) {
    throw new Error("Adapter CLI hooks are incomplete.");
  }
  if ((metadata.cliId || provider.cliId) !== provider.cliId || adapter.cli.models.driver !== CLI_MODELS_DRIVER[id] || adapter.cli.quota.driver !== CLI_QUOTA_DRIVER[id]) throw new Error("Adapter CLI driver does not match its provider.");
  if (adapter.cli.models.configArgs !== undefined && typeof adapter.cli.models.configArgs !== "function") throw new Error("Adapter CLI model hook is invalid.");
  if (adapter.cli.loginArgs !== undefined && (!Array.isArray(adapter.cli.loginArgs) || adapter.cli.loginArgs.length > 64 || adapter.cli.loginArgs.some(arg => typeof arg !== "string" || arg.length > 256 || /[\u0000-\u001f\u007f]/.test(arg)))) throw new Error("Adapter login arguments are invalid.");
  if (adapter.cli.auth !== undefined) {
    const auth = adapter.cli.auth;
    const validArgs = args => Array.isArray(args) && args.length <= 16 && args.every(arg => typeof arg === "string" && arg.length <= 128 && !/[\u0000-\u001f\u007f]/.test(arg));
    if (!isPlainObject(auth) || !["browser", "device", "terminal", "api-key"].includes(auth.kind) ||
        !validArgs(auth.loginArgs) || (["browser", "device"].includes(auth.kind) && !auth.loginArgs.length) ||
        typeof auth.requiresTty !== "boolean" || auth.requiresTty !== (auth.kind === "terminal") ||
        !Array.isArray(auth.authHosts) || auth.authHosts.length > 12 || auth.authHosts.some(host => typeof host !== "string" || host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host)) ||
        typeof auth.instructions !== "string" || auth.instructions.length > 500 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(auth.instructions) ||
        (auth.statusArgs !== undefined && (!validArgs(auth.statusArgs) || !auth.statusArgs.length || typeof auth.parseStatus !== "function")) ||
        (auth.parseStatus !== undefined && typeof auth.parseStatus !== "function") ||
        (auth.parseProgress !== undefined && typeof auth.parseProgress !== "function")) throw new Error("Adapter authentication hooks are invalid.");
    if (auth.keyUrl !== undefined) checkedHttpsUrl(auth.keyUrl, "Adapter key console URL");
  }
  if (!Array.isArray(adapter.pricing) || adapter.pricing.length > 500) throw new Error("Adapter pricing metadata is invalid.");
  if (adapter.runtime !== undefined) {
    const runtime = adapter.runtime;
    if (!isPlainObject(runtime) || runtime.id !== provider.cliId || typeof runtime.executable !== "string" || !/^[A-Za-z0-9._-]+\.exe$/i.test(runtime.executable) ||
        !Array.isArray(runtime.allowedHosts) || runtime.allowedHosts.length < 1 || runtime.allowedHosts.length > 12 ||
        runtime.allowedHosts.some(host => typeof host !== "string" || host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host)) ||
        typeof runtime.resolveRelease !== "function") throw new Error("Adapter runtime hooks are invalid.");
  }
  return {
    abiVersion: ABI_VERSION,
    provider: { ...metadata, docs, baseUrl },
    api: adapter.api,
    cli: adapter.cli,
    pricing: adapter.pricing,
    ...(adapter.runtime ? { runtime: adapter.runtime } : {}),
  };
}

function checkedHttpsUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} is invalid.`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`${label} must use a clean HTTPS URL.`);
  return parsed.href.replace(/\/$/, "");
}

async function readBoundedResponse(response, limit, signal) {
  const length = Number(response.headers?.get?.("content-length") || 0);
  if (length > limit) throw new Error("Adapter download exceeds the size limit.");
  const chunks = [];
  let size = 0;
  const append = chunk => {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > limit) throw new Error("Adapter download exceeds the size limit.");
    chunks.push(value);
  };
  const body = response.body;
  if (body?.getReader) {
    const reader = body.getReader();
    try {
      while (true) {
        if (signal?.aborted) throw new Error("Adapter operation was cancelled.");
        const { done, value } = await reader.read();
        if (done) break;
        append(value);
      }
    } finally { try { await reader.cancel(); } catch {} }
  } else if (body && typeof body[Symbol.asyncIterator] === "function") {
    for await (const chunk of body) { if (signal?.aborted) throw new Error("Adapter operation was cancelled."); append(chunk); }
  } else if (Buffer.isBuffer(body) || typeof body === "string") {
    append(body);
  } else if (typeof response.arrayBuffer === "function") {
    const bytes = Buffer.from(await response.arrayBuffer());
    append(bytes);
  } else {
    throw new Error("Adapter download response has no readable body.");
  }
  return Buffer.concat(chunks, size);
}

function responseHeader(response, name) {
  try { return response.headers?.get?.(name) || ""; } catch { return ""; }
}

function httpError(response) {
  const status = Number.isInteger(response?.status) ? response.status : 0;
  const error = new Error(`Adapter download failed with HTTP ${status}.`);
  error.status = status;
  error.retryAfter = responseHeader(response, "retry-after");
  error.rateRemaining = responseHeader(response, "x-ratelimit-remaining");
  error.rateReset = responseHeader(response, "x-ratelimit-reset");
  return error;
}

class ComponentManager {
  constructor({ root, fetchImpl = globalThis.fetch, notify = () => {}, trustConfig = DEFAULT_TRUST, storage, requestTimeoutMs = REQUEST_TIMEOUT_MS, renameImpl = fsp.rename, sleepImpl = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
    if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("ComponentManager requires an absolute userData root.");
    if (typeof fetchImpl !== "function") throw new Error("ComponentManager requires fetch support.");
    if (typeof notify !== "function") throw new Error("ComponentManager notify must be a function.");
    if (typeof renameImpl !== "function") throw new Error("ComponentManager rename implementation must be a function.");
    if (typeof sleepImpl !== "function") throw new Error("ComponentManager sleep implementation must be a function.");
    this.root = path.resolve(root);
    this.adaptersRoot = path.join(this.root, "ai", "adapters");
    this.fetchImpl = fetchImpl;
    this.notify = notify;
    this.trustInput = trustConfig;
    this.storage = storage || null;
    this.renameImpl = renameImpl;
    this.sleepImpl = sleepImpl;
    this.requestTimeoutMs = Number.isFinite(requestTimeoutMs) ? Math.max(500, Math.min(requestTimeoutMs, 120_000)) : REQUEST_TIMEOUT_MS;
    this.states = new Map(ID_LIST.map(id => [id, { id, status: "not-installed", progress: 0, bytes: 0, totalInstalledBytes: 0, pinned: false }]));
    this.pins = new Map();
    this.locks = new Map();
    this.cachedCatalog = null;
    this.apiCooldownKey = cooldownKey(root);
    this.apiRateLimitFailures = 0;
  }

  snapshot() {
    const components = ID_LIST.map(id => {
      const state = this.states.get(id) || { id, status: "not-installed" };
      return { ...state, pinned: (this.pins.get(id)?.size || 0) > 0 };
    });
    return { components, byId: Object.fromEntries(components.map(item => [item.id, item])) };
  }

  _emit() { try { this.notify(this.snapshot()); } catch {} }

  _set(id, patch) {
    const current = this.states.get(id) || { id, status: "not-installed", progress: 0, bytes: 0, totalInstalledBytes: 0 };
    this.states.set(id, { ...current, ...patch, id });
    this._emit();
  }

  _trust() { return validateTrustConfig(this.trustInput); }

  async _canonicalizeRoot() {
    const requestedRoot = this.root;
    await fsp.mkdir(requestedRoot, { recursive: true });
    const info = await fsp.lstat(requestedRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Adapter storage contains an unsafe directory.");
    const canonicalRoot = await fsp.realpath(requestedRoot);
    const canonicalInfo = await fsp.lstat(canonicalRoot);
    if (!canonicalInfo.isDirectory() || canonicalInfo.isSymbolicLink()) throw new Error("Adapter storage contains an unsafe directory.");
    // Keep every derived path on the same canonical spelling. On Windows this
    // also resolves case variants and 8.3 aliases returned by callers.
    this.root = canonicalRoot;
    this.adaptersRoot = path.join(canonicalRoot, "ai", "adapters");
    this.apiCooldownKey = cooldownKey(canonicalRoot);
  }

  async _ensureDirectories(id) {
    await this._canonicalizeRoot();
    const directories = [this.root, path.join(this.root, "ai"), this.adaptersRoot, path.join(this.adaptersRoot, id), path.join(this.adaptersRoot, id, "versions")];
    for (const directory of directories) {
      try { await fsp.mkdir(directory, { recursive: directory === this.root }); } catch (error) { if (error.code !== "EEXIST") throw error; }
      const info = await fsp.lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Adapter storage contains an unsafe directory.");
      const real = await fsp.realpath(directory);
      if (!within(this.root, real)) throw new Error("Adapter storage escaped the userData directory.");
    }
  }

  _componentPath(id) { componentId(id); return path.join(this.adaptersRoot, id); }
  _versionsPath(id) { return path.join(this._componentPath(id), "versions"); }
  _versionPath(id, version) { return path.join(this._versionsPath(id), validVersion(version)); }
  _pointerPath(id, which) {
    if (which !== "current" && which !== "previous") throw new Error("Invalid adapter pointer.");
    return path.join(this._componentPath(id), `${which}.json`);
  }

  async _assertPlainDirectory(directory, parent) {
    let info;
    try { info = await fsp.lstat(directory); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Adapter storage contains an unsafe directory.");
    const real = await fsp.realpath(directory);
    const parentReal = await fsp.realpath(parent);
    if (!within(parentReal, real) || real === parentReal) throw new Error("Adapter storage escaped its managed directory.");
    return real;
  }

  async _readJsonFile(file, parent, maxBytes = 16 * 1024) {
    try {
      const info = await fsp.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error("Adapter metadata file is unsafe.");
      const real = await fsp.realpath(file), parentReal = await fsp.realpath(parent);
      if (!within(parentReal, real)) throw new Error("Adapter metadata escaped its managed directory.");
      return JSON.parse(await fsp.readFile(real, "utf8"));
    } catch (error) { if (error.code === "ENOENT") return null; if (error instanceof SyntaxError) throw new Error("Adapter metadata JSON is invalid."); throw error; }
  }

  async _readPointer(id, which) {
    const component = this._componentPath(id);
    try { await fsp.access(component); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    await this._assertPlainDirectory(component, this.adaptersRoot);
    const file = this._pointerPath(id, which);
    let pointerBytes;
    try {
      const info = await fsp.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024) throw new Error("Adapter version pointer is unsafe.");
      const real = await fsp.realpath(file), parentReal = await fsp.realpath(component);
      if (!within(parentReal, real)) throw new Error("Adapter version pointer escaped its managed directory.");
      pointerBytes = await fsp.readFile(real, "utf8");
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    return this._decodePointer(id, pointerBytes);
  }

  _readPointerSync(id, which) {
    const component = this._componentPath(id);
    if (!fs.existsSync(component)) return null;
    const componentInfo = fs.lstatSync(component);
    if (!componentInfo.isDirectory() || componentInfo.isSymbolicLink()) throw new Error("Adapter storage contains an unsafe directory.");
    const componentReal = fs.realpathSync(component), adaptersReal = fs.realpathSync(this.adaptersRoot);
    if (!within(adaptersReal, componentReal)) throw new Error("Adapter storage escaped its managed directory.");
    const file = this._pointerPath(id, which);
    let stored;
    try {
      const info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024) throw new Error("Adapter version pointer is unsafe.");
      const real = fs.realpathSync(file);
      if (!within(componentReal, real)) throw new Error("Adapter version pointer escaped its managed directory.");
      stored = fs.readFileSync(real, "utf8");
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    return this._decodePointer(id, stored);
  }

  _decodePointer(id, stored) {
    let pointerText;
    if (stored.startsWith("dpapi:v1:")) {
      if (!this._storageAvailable() || typeof this.storage.decryptString !== "function") throw new Error("Adapter provenance metadata cannot be decrypted on this device.");
      try { pointerText = this.storage.decryptString(checkBase64(stored.slice("dpapi:v1:".length), "Encrypted adapter metadata")); }
      catch { throw new Error("Adapter provenance metadata failed its device integrity check."); }
    } else if (stored.startsWith("plain:v1:")) {
      if (this._storageAvailable()) throw new Error("Adapter provenance metadata is not device-protected.");
      pointerText = stored.slice("plain:v1:".length);
    } else throw new Error("Adapter version pointer format is invalid.");
    let pointer;
    try { pointer = JSON.parse(pointerText); } catch { throw new Error("Adapter version pointer JSON is invalid."); }
    if (!isPlainObject(pointer) || pointer.schemaVersion !== 1 || pointer.id !== id || pointer.source !== "github" || pointer.repository !== REPOSITORY || !validHash(pointer.packageSha256) ||
        pointer.apiDigest !== `sha256:${String(pointer.packageSha256).toLowerCase()}` || !Number.isSafeInteger(pointer.releaseAssetId) || pointer.releaseAssetId < 1 ||
        (pointer.proofSource !== undefined && !["github-publisher-receipt", "github-release-api-digest"].includes(pointer.proofSource)) ||
        !Number.isSafeInteger(pointer.size) || pointer.size < 1 || pointer.size > MAX_PACKAGE_BYTES) throw new Error("Adapter version pointer is invalid.");
    validVersion(pointer.version);
    if (pointer.releaseTag !== componentReleaseTag(id, pointer.version)) throw new Error("Adapter provenance release tag is invalid.");
    validateAssetName(pointer.asset);
    return {
      schemaVersion: 1, id, version: pointer.version, source: "github", repository: REPOSITORY, releaseTag: pointer.releaseTag,
      asset: pointer.asset, releaseAssetId: pointer.releaseAssetId, apiDigest: pointer.apiDigest,
      proofSource: pointer.proofSource || "github-release-api-digest",
      packageSha256: pointer.packageSha256.toLowerCase(), size: pointer.size, installedAt: typeof pointer.installedAt === "string" ? pointer.installedAt : "",
    };
  }

  _storageAvailable() {
    try { return !!this.storage?.isEncryptionAvailable?.(); } catch { return false; }
  }

  async _atomicPointer(target, parent, value) {
    const json = `${JSON.stringify(value)}\n`;
    let encoded;
    if (this._storageAvailable()) {
      if (typeof this.storage.encryptString !== "function") throw new Error("Device protection for adapter provenance is unavailable.");
      try { encoded = `dpapi:v1:${this.storage.encryptString(json).toString("base64")}`; }
      catch { throw new Error("Adapter provenance could not be protected on this device."); }
    } else encoded = `plain:v1:${json}`;
    await this._atomicText(target, parent, encoded);
  }

  async _atomicJson(target, parent, value) {
    await this._atomicText(target, parent, `${JSON.stringify(value)}\n`);
  }

  async _renameWithRetry(source, target) {
    const retryable = new Set(["EPERM", "EACCES", "EBUSY"]);
    let delay = 50;
    for (let attempt = 0; ; attempt++) {
      try { return await this.renameImpl(source, target); }
      catch (error) {
        if (attempt >= 5 || !retryable.has(error?.code) || (error?.syscall && error.syscall !== "rename")) throw error;
        await this.sleepImpl(delay);
        delay = Math.min(delay * 2, 800);
      }
    }
  }

  async _atomicText(target, parent, text) {
    const targetInput = path.resolve(target);
    const [rootReal, parentReal, targetParentReal] = await Promise.all([
      fsp.realpath(this.root), fsp.realpath(parent), fsp.realpath(path.dirname(targetInput)),
    ]);
    let parentInfo;
    try { parentInfo = await fsp.lstat(parent); } catch { throw new Error("Adapter metadata parent is unavailable."); }
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error("Adapter metadata parent is unsafe.");
    if (!withinPath(rootReal, parentReal) || samePath(parentReal, rootReal)) throw new Error("Adapter metadata parent escaped its managed root.");
    let ancestor = parentReal;
    while (!samePath(ancestor, rootReal)) {
      const info = await fsp.lstat(ancestor);
      const real = await fsp.realpath(ancestor);
      if (!info.isDirectory() || info.isSymbolicLink() || !samePath(real, ancestor)) throw new Error("Adapter metadata parent contains an unsafe directory.");
      const next = path.dirname(ancestor);
      if (samePath(next, ancestor) || !withinPath(rootReal, next)) throw new Error("Adapter metadata parent escaped its managed root.");
      ancestor = next;
    }
    const rootInfo = await fsp.lstat(rootReal);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Adapter metadata root is unsafe.");
    const targetPath = canonicalManagedTarget({ rootReal, parentReal, targetParentReal, targetPath: targetInput });
    try {
      const existing = await fsp.lstat(targetPath);
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("Adapter metadata target is unsafe.");
      const real = await fsp.realpath(targetPath);
      if (!within(parentReal, real)) throw new Error("Adapter metadata target escaped its managed directory.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const temporary = `${targetPath}.${crypto.randomUUID()}.tmp`;
    const handle = await fsp.open(temporary, "wx", 0o600);
    try { await handle.writeFile(text, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    try { await this._renameWithRetry(temporary, targetPath); }
    catch (error) { try { await fsp.unlink(temporary); } catch {} throw error; }
  }

  async _verifiedCache() {
    if (this.cachedCatalog) return this.cachedCatalog;
    const file = path.join(this.adaptersRoot, "catalog-cache.json");
    try { await this._ensureDirectories(ID_LIST[0]); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const value = await this._readJsonFile(file, this.adaptersRoot, MAX_CATALOG_CACHE_BYTES);
    if (!value || value.schemaVersion !== 1 || !Number.isFinite(Date.parse(value.fetchedAt)) || !isPlainObject(value.catalog)) return null;
    let catalog;
    try { catalog = validateCatalogPayload(value.catalog); } catch { return null; }
    let releaseAssets = null;
    if (this._trust().verification === "github-published-release-receipts" && typeof value.protectedDistributionIndex === "string" && value.protectedDistributionIndex.startsWith("dpapi:v1:") && this._storageAvailable() && typeof this.storage.decryptString === "function") {
      try {
        const cipher = checkBase64(value.protectedDistributionIndex.slice("dpapi:v1:".length), "Protected adapter receipt cache");
        const indexBytes = this.storage.decryptString(cipher);
        const index = JSON.parse(Buffer.isBuffer(indexBytes) ? indexBytes.toString("utf8") : String(indexBytes));
        const verified = this._validateDistributionIndex(index);
        if (JSON.stringify(verified.catalog) === JSON.stringify(catalog)) releaseAssets = verified.releaseAssets;
      } catch { releaseAssets = null; }
    }
    this.cachedCatalog = { ...catalog, source: "cache", fetchedAt: value.fetchedAt, etag: typeof value.etag === "string" ? value.etag : "", releaseAssets };
    return this.cachedCatalog;
  }

  _protectDistributionIndex(index) {
    if (!this._storageAvailable() || typeof this.storage?.encryptString !== "function") return null;
    try {
      const encrypted = this.storage.encryptString(JSON.stringify(index));
      return `dpapi:v1:${Buffer.from(encrypted).toString("base64")}`;
    } catch { return null; }
  }

  async _fetchBytes(startUrl, { signal, headers = {}, maxBytes, allowedHosts = ALLOWED_RELEASE_HOSTS }) {
    if (signal?.aborted) throw new Error("Adapter operation was cancelled.");
    const timeoutController = new AbortController();
    const abort = () => timeoutController.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => timeoutController.abort(), this.requestTimeoutMs);
    let currentUrl = startUrl;
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const parsed = new URL(currentUrl);
        if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname) || parsed.username || parsed.password) throw new VerificationError("Adapter download redirected outside the trusted GitHub hosts.");
        let response;
        try {
          response = await this.fetchImpl(currentUrl, {
            method: "GET",
            headers: { accept: "application/json, application/octet-stream", ...headers },
            redirect: "manual",
            referrerPolicy: "no-referrer",
            signal: timeoutController.signal,
          });
        } catch (error) {
          if (signal?.aborted || timeoutController.signal.aborted) throw new Error(signal?.aborted ? "Adapter operation was cancelled." : "Adapter download timed out.");
          throw new Error("Adapter download could not reach the trusted GitHub release host.");
        }
        if (response.url) {
          const finalUrl = new URL(response.url);
          if (finalUrl.protocol !== "https:" || !allowedHosts.has(finalUrl.hostname)) throw new VerificationError("Adapter download returned an untrusted host.");
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers?.get?.("location");
          if (!location || redirects === 5) throw new VerificationError("Adapter download returned an invalid redirect.");
          currentUrl = new URL(location, currentUrl).href;
          continue;
        }
        if (response.status === 304) return { status: 304, bytes: Buffer.alloc(0), etag: responseHeader(response, "etag"), finalUrl: currentUrl };
        if (!response.ok) throw httpError(response);
        const bytes = await readBoundedResponse(response, maxBytes, timeoutController.signal);
        return { status: response.status, bytes, etag: responseHeader(response, "etag"), finalUrl: currentUrl };
      }
      throw new Error("Adapter download exceeded the redirect limit.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async catalog({ signal, refresh = false } = {}) {
    const trust = this._trust();
    await this._ensureDirectories(ID_LIST[0]);
    let cached = await this._verifiedCache();
    const cacheHasReceiptAssets = trust.verification !== "github-published-release-receipts" || !!cached?.releaseAssets;
    if (!refresh && cached && cacheHasReceiptAssets && Date.now() - Date.parse(cached.fetchedAt) < CATALOG_CACHE_MS) return { ...cached, source: "cache" };
    if (trust.verification !== "github-published-release-receipts") {
      try { return { ...(await this._catalogFromApi({ signal })) }; }
      catch (error) {
        if (signal?.aborted) throw new Error("Adapter operation was cancelled.");
        if (error instanceof VerificationError) throw new Error(statusError(error, "checking"));
        cached ||= await this._verifiedCache();
        if (cached) return { ...cached, source: "cache", stale: true };
        throw new Error(statusError(error, "checking"));
      }
    }
    try {
      const response = await this._fetchBytes(DISTRIBUTION_URL, {
        signal, maxBytes: MAX_INDEX_BYTES, allowedHosts: new Set(["raw.githubusercontent.com"]),
      });
      if (response.finalUrl && response.finalUrl !== DISTRIBUTION_URL) throw new VerificationError("Publisher receipt index redirected away from its fixed repository path.");
      let index;
      try { index = JSON.parse(response.bytes.toString("utf8")); }
      catch { throw new VerificationError("GitHub publisher receipt index is invalid JSON."); }
      const verified = this._validateDistributionIndex(index);
      const fetchedAt = new Date().toISOString();
      const protectedDistributionIndex = this._protectDistributionIndex(index);
      const cacheValue = {
        schemaVersion: 1, catalog: verified.catalog, catalogSha256: verified.catalogSha256,
        catalogSize: verified.catalogSize, fetchedAt, releaseTag: "catalog-v1",
        ...(protectedDistributionIndex ? { protectedDistributionIndex } : {}),
      };
      await this._atomicJson(path.join(this.adaptersRoot, "catalog-cache.json"), this.adaptersRoot, cacheValue);
      this.cachedCatalog = { ...verified.catalog, source: "github-publisher-receipts", fetchedAt, etag: "", catalogSha256: verified.catalogSha256, releaseAssets: verified.releaseAssets };
      this._updateLatestFromCatalog(verified.catalog);
      return { ...this.cachedCatalog };
    } catch (error) {
      if (signal?.aborted) throw new Error("Adapter operation was cancelled.");
      if (error instanceof VerificationError) throw new Error(statusError(error, "checking"));
      try {
        const legacy = await this._catalogFromApi({ signal });
        return { ...legacy };
      } catch (apiError) {
        if (signal?.aborted) throw new Error("Adapter operation was cancelled.");
        if (apiError instanceof VerificationError) throw new Error(statusError(apiError, "checking"));
        cached ||= await this._verifiedCache();
        if (cached) return { ...cached, source: "cache", stale: true };
        throw new Error(statusError(apiError, "checking"));
      }
    }
  }

  async _catalogFromApi({ signal } = {}) {
    const release = await this._releaseInfo("catalog-v1", signal);
    const catalogAsset = this._releaseAsset(release, "catalog-v1", "catalog.json");
    const response = await this._fetchBytes(CATALOG_URL, { signal, maxBytes: MAX_CATALOG_BYTES });
    if (response.bytes.length !== catalogAsset.size || sha256(response.bytes) !== catalogAsset.sha256) throw new VerificationError("GitHub catalog release digest verification failed.");
    let parsed;
    try { parsed = JSON.parse(response.bytes.toString("utf8")); } catch { throw new VerificationError("Adapter catalog is invalid JSON."); }
    let catalog;
    try { catalog = validateCatalogPayload(parsed); }
    catch (error) { throw new VerificationError(error.message || "Adapter catalog failed schema validation."); }
    const fetchedAt = new Date().toISOString();
    await this._atomicJson(path.join(this.adaptersRoot, "catalog-cache.json"), this.adaptersRoot, {
      schemaVersion: 1, catalog, catalogSha256: catalogAsset.sha256, catalogSize: catalogAsset.size, fetchedAt, releaseTag: "catalog-v1",
    });
    this.cachedCatalog = { ...catalog, source: "github-api-release-digest", fetchedAt, etag: release.etag || "", catalogSha256: catalogAsset.sha256, releaseAssets: null };
    this._updateLatestFromCatalog(catalog);
    return this.cachedCatalog;
  }

  _updateLatestFromCatalog(catalog) {
    for (const item of catalog.components) {
      const previous = this.states.get(item.id) || { id: item.id, status: "not-installed", progress: 0, bytes: 0, totalInstalledBytes: 0 };
      this.states.set(item.id, { ...previous, updateAvailable: previous.version ? compareVersions(item.version, previous.version) > 0 : false, latestVersion: item.version });
    }
    this._emit();
  }

  async _releaseInfo(tag, signal) {
    if (typeof tag !== "string" || !/^(?:catalog-v1|(?:openai|anthropic|xai|google|deepseek|moonshot)-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(tag)) throw new Error("Adapter release tag is invalid.");
    const retryAt = API_COOLDOWNS.get(this.apiCooldownKey) || 0;
    if (retryAt > Date.now()) {
      const error = new Error("GitHub release metadata API is cooling down.");
      error.code = "GITHUB_API_COOLDOWN";
      error.status = 403;
      error.retryAt = retryAt;
      throw error;
    }
    try {
      const response = await this._fetchBytes(`${RELEASE_API}${encodeURIComponent(tag)}`, {
        signal,
        headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
        maxBytes: MAX_CATALOG_BYTES,
        allowedHosts: new Set(["api.github.com"]),
      });
      let release;
      try { release = JSON.parse(response.bytes.toString("utf8")); } catch { throw new VerificationError("GitHub release metadata is invalid JSON."); }
      if (!isPlainObject(release) || release.tag_name !== tag || !Array.isArray(release.assets) || release.assets.length > 128) throw new VerificationError("GitHub release metadata does not match the requested tag.");
      API_COOLDOWNS.delete(this.apiCooldownKey);
      this.apiRateLimitFailures = 0;
      return { release, etag: response.etag || "" };
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        const now = Date.now();
        const retryHeader = Number.parseFloat(error.retryAfter);
        let retryAt = Number.isFinite(retryHeader) ? now + Math.max(0, retryHeader) * 1000 : Date.parse(error.retryAfter);
        const reset = Number(error.rateReset);
        if (error.rateRemaining === "0" && Number.isFinite(reset) && reset > now / 1000) retryAt = Math.max(Number.isFinite(retryAt) ? retryAt : 0, reset * 1000);
        if (!Number.isFinite(retryAt) || retryAt <= now) {
          this.apiRateLimitFailures = Math.min(this.apiRateLimitFailures + 1, 8);
          retryAt = now + Math.min(60_000 * (2 ** (this.apiRateLimitFailures - 1)), 60 * 60 * 1000);
        } else this.apiRateLimitFailures = Math.min(this.apiRateLimitFailures + 1, 8);
        API_COOLDOWNS.set(this.apiCooldownKey, retryAt);
        const limited = new Error("GitHub release metadata API is rate-limited.");
        limited.code = "GITHUB_API_COOLDOWN";
        limited.status = error.status;
        limited.retryAt = retryAt;
        throw limited;
      }
      throw error;
    }
  }

  _releaseAsset(releaseInfo, tag, assetName, expected) {
    const release = releaseInfo?.release;
    if (!isPlainObject(release) || !Array.isArray(release.assets) || release.assets.length > 128) throw new VerificationError("GitHub release receipt is invalid.");
    if (release.tag_name !== tag) throw new VerificationError("GitHub release tag does not match the catalog.");
    const asset = release.assets.find(item => item && item.name === assetName);
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_PACKAGE_BYTES || typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) {
      throw new VerificationError("GitHub release asset is missing its SHA-256 digest.");
    }
    const providerTag = /^(openai|anthropic|xai|google|deepseek|moonshot)-v(.+)$/.exec(tag);
    const expectedUrl = tag === "catalog-v1" ? CATALOG_URL : providerTag ? releaseUrl(providerTag[1], providerTag[2], assetName) : "";
    if (asset.browser_download_url !== expectedUrl || !Number.isSafeInteger(asset.id) || asset.id < 1) throw new VerificationError("GitHub release asset URL or ID is not trusted.");
    const digest = asset.digest.slice("sha256:".length).toLowerCase();
    if (expected && (expected.sha256 !== digest || expected.size !== asset.size || expected.asset !== assetName)) throw new VerificationError("GitHub release metadata does not match the verified catalog.");
    return { id: asset.id, name: asset.name, size: asset.size, sha256: digest, url: asset.browser_download_url, proofSource: releaseInfo.proof || "github-release-api-digest" };
  }

  _validateDistributionIndex(index) {
    const fields = ["schemaVersion", "repository", "abiVersion", "generatedAt", "catalog", "catalogReceipt", "catalogBytes", "releaseReceipts"];
    if (!isPlainObject(index) || Object.keys(index).length !== fields.length || fields.some(key => !Object.hasOwn(index, key)) ||
        index.schemaVersion !== 1 || index.repository !== REPOSITORY || index.abiVersion !== ABI_VERSION ||
        typeof index.generatedAt !== "string" || !Number.isFinite(Date.parse(index.generatedAt)) ||
        !isPlainObject(index.catalog) || !Array.isArray(index.releaseReceipts) || index.releaseReceipts.length > ID_LIST.length) {
      throw new VerificationError("GitHub publisher receipt index has an unsupported schema or repository.");
    }
    const catalogBytes = checkBase64(index.catalogBytes, "Published catalog bytes");
    if (!catalogBytes.length || catalogBytes.length > MAX_CATALOG_BYTES) throw new VerificationError("Published catalog exceeds the size limit.");
    const catalogAsset = this._releaseAsset({ release: index.catalogReceipt, proof: "github-publisher-receipt" }, "catalog-v1", "catalog.json");
    if (catalogAsset.size !== catalogBytes.length || catalogAsset.sha256 !== sha256(catalogBytes)) throw new VerificationError("Published catalog bytes do not match the GitHub publisher receipt.");
    let parsedCatalog;
    try { parsedCatalog = JSON.parse(catalogBytes.toString("utf8")); }
    catch { throw new VerificationError("Published catalog bytes are invalid JSON."); }
    let catalog, declaredCatalog;
    try {
      catalog = validateCatalogPayload(parsedCatalog);
      declaredCatalog = validateCatalogPayload(index.catalog);
    } catch (error) { throw new VerificationError(error.message || "Published catalog schema validation failed."); }
    if (JSON.stringify(catalog) !== JSON.stringify(declaredCatalog)) throw new VerificationError("Publisher index catalog does not match its verified catalog bytes.");

    const expectedReceipts = new Map();
    for (const receipt of index.releaseReceipts) {
      if (!isPlainObject(receipt) || typeof receipt.tag_name !== "string" || expectedReceipts.has(receipt.tag_name)) throw new VerificationError("Publisher release receipts are invalid or duplicated.");
      expectedReceipts.set(receipt.tag_name, receipt);
    }
    if (expectedReceipts.size !== catalog.components.length) throw new VerificationError("Publisher release receipt set does not match the catalog.");
    const releaseAssets = {};
    const assetIds = new Set([catalogAsset.id]);
    for (const row of catalog.components) {
      const tag = componentReleaseTag(row.id, row.version);
      const receipt = expectedReceipts.get(tag);
      if (!receipt) throw new VerificationError("Publisher release receipt is missing for a catalog component.");
      const asset = this._releaseAsset({ release: receipt, proof: "github-publisher-receipt" }, tag, row.asset, row);
      if (assetIds.has(asset.id)) throw new VerificationError("Publisher release asset identifiers are duplicated.");
      assetIds.add(asset.id);
      releaseAssets[row.id] = asset;
      expectedReceipts.delete(tag);
    }
    if (expectedReceipts.size) throw new VerificationError("Publisher index contains an unlisted release receipt.");
    return { catalog, releaseAssets, catalogSha256: catalogAsset.sha256, catalogSize: catalogAsset.size, catalogBytes };
  }

  async info(id, { signal } = {}) {
    const current = await this.detect(id);
    const catalog = await this.catalog({ signal, refresh: true });
    const latest = catalog.components.find(item => item.id === id) || null;
    const updateAvailable = !!latest && !!current.version && compareVersions(latest.version, current.version) > 0;
    this._set(id, { ...current, latestVersion: latest?.version || null, updateAvailable });
    return { component: this.states.get(id), latest, updateAvailable, catalogSource: catalog.source };
  }

  async detect(id) {
    componentId(id);
    try {
      await this._ensureDirectories(id);
      const current = await this._readPointer(id, "current");
      const previous = await this._readPointer(id, "previous");
      if (!current) {
        this._set(id, { status: "not-installed", version: null, previousVersion: previous?.version || null, source: null, progress: 0, bytes: 0, totalInstalledBytes: previous?.size || 0, error: null });
        return this.states.get(id);
      }
      await this._loadVerifiedVersion(id, current);
      this._set(id, { status: "ready", version: current.version, previousVersion: previous?.version || null, source: current.source, progress: 0, bytes: current.size, totalInstalledBytes: current.size + (previous?.size || 0), error: null });
    } catch (error) {
      this._set(id, { status: "failed", progress: 0, error: statusError(error, "checking") });
    }
    return this.states.get(id);
  }

  async install(id, { signal, version, refresh = false } = {}) {
    componentId(id);
    return this._withLock(id, async () => {
      if ((this.pins.get(id)?.size || 0) > 0) throw new Error("This adapter is in use by an active AI job.");
      let previousState = this.states.get(id);
      try {
        this._set(id, { status: "checking", progress: 0, error: null });
        const catalog = await this.catalog({ signal, refresh });
        const row = catalog.components.find(item => item.id === id && (!version || item.version === version));
        if (!row) throw new Error(version ? "Requested adapter version is not in the verified catalog." : "Adapter is not available in the verified catalog.");
        const current = await this._readPointer(id, "current");
        if (current?.version === row.version) {
          await this._loadVerifiedVersion(id, current);
          const previous = await this._readPointer(id, "previous");
          this._set(id, { status: "ready", version: current.version, previousVersion: previous?.version || null, source: current.source, progress: 1, bytes: current.size, totalInstalledBytes: current.size + (previous?.size || 0), error: null, latestVersion: row.version, updateAvailable: false });
          return this.states.get(id);
        }
        this._set(id, { status: "downloading", progress: 0, latestVersion: row.version, updateAvailable: !!current && compareVersions(row.version, current.version) > 0 });
        const tag = componentReleaseTag(id, row.version);
        let asset = catalog.releaseAssets?.[id] || null;
        if (!asset) {
          const release = await this._releaseInfo(tag, signal);
          asset = this._releaseAsset(release, tag, row.asset, row);
        } else if (asset.name !== row.asset || asset.sha256 !== row.sha256 || asset.size !== row.size) {
          throw new VerificationError("Publisher release receipt no longer matches the verified catalog.");
        }
        const response = await this._fetchBytes(asset.url, { signal, maxBytes: MAX_PACKAGE_BYTES });
        if (response.bytes.length !== row.size || response.bytes.length !== asset.size || sha256(response.bytes) !== row.sha256 || sha256(response.bytes) !== asset.sha256) throw new Error("Adapter release hash or size does not match GitHub release metadata.");
        this._set(id, { status: "verifying", progress: 0.72, bytes: response.bytes.length });
        const packageDescriptor = this._verifyPackage(response.bytes, id, row.version);
        this._set(id, { status: "installing", progress: 0.85 });
        const versionDir = await this._publishFiles(id, row.version, response.bytes, packageDescriptor);
        const old = current ? await this._loadVerifiedVersion(id, current).then(() => current) : null;
        const pointer = {
          schemaVersion: 1, id, version: row.version, source: "github", repository: REPOSITORY,
          releaseTag: tag, asset: row.asset, releaseAssetId: asset.id, apiDigest: `sha256:${asset.sha256}`, proofSource: asset.proofSource,
          packageSha256: sha256(response.bytes), size: response.bytes.length, installedAt: new Date().toISOString(),
        };
        if (old) await this._atomicPointer(this._pointerPath(id, "previous"), this._componentPath(id), old);
        else {
          const previousPath = this._pointerPath(id, "previous");
          try { const stat = await fsp.lstat(previousPath); if (stat.isFile() && !stat.isSymbolicLink()) await fsp.unlink(previousPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        await this._atomicPointer(this._pointerPath(id, "current"), this._componentPath(id), pointer);
        const previous = await this._readPointer(id, "previous");
        await this._pruneVersions(id, new Set([row.version, previous?.version].filter(Boolean)));
        this._set(id, { status: "ready", version: row.version, previousVersion: previous?.version || null, source: "github", progress: 1, bytes: pointer.size, totalInstalledBytes: pointer.size + (previous?.size || 0), error: null, latestVersion: row.version, updateAvailable: false });
        return this.states.get(id);
      } catch (error) {
        const phase = this.states.get(id)?.status;
        const safeError = statusError(error, phase);
        const old = await this._safeCurrentState(id).catch(() => null);
        this._set(id, old ? { ...old, error: safeError } : { status: "failed", progress: 0, error: safeError });
        throw new Error(safeError);
      }
    });
  }

  update(id, options = {}) { return this.install(id, { ...options, refresh: true }); }

  async remove(id) {
    componentId(id);
    return this._withLock(id, async () => {
      if ((this.pins.get(id)?.size || 0) > 0) throw new Error("This adapter is in use by an active AI job.");
      this._set(id, { status: "removing", progress: 0, error: null });
      try {
        const component = this._componentPath(id);
        const real = await this._assertPlainDirectory(component, this.adaptersRoot);
        if (real) await this._removeManagedTree(real, this.adaptersRoot);
        this._set(id, { status: "not-installed", version: null, previousVersion: null, source: null, progress: 0, bytes: 0, totalInstalledBytes: 0, error: null, latestVersion: this.states.get(id)?.latestVersion || null, updateAvailable: false });
        return this.states.get(id);
      } catch (error) {
        const safeError = statusError(error, "removing");
        this._set(id, { status: "failed", error: safeError, progress: 0 });
        throw new Error(safeError);
      }
    });
  }

  async rollback(id) {
    componentId(id);
    return this._withLock(id, async () => {
      if ((this.pins.get(id)?.size || 0) > 0) throw new Error("This adapter is in use by an active AI job.");
      const current = await this._readPointer(id, "current");
      const previous = await this._readPointer(id, "previous");
      if (!current || !previous) throw new Error("No verified previous adapter version is available.");
      this._set(id, { status: "rolling-back", progress: 0, error: null });
      try {
        await this._loadVerifiedVersion(id, previous);
        await this._atomicPointer(this._pointerPath(id, "previous"), this._componentPath(id), current);
        await this._atomicPointer(this._pointerPath(id, "current"), this._componentPath(id), previous);
        const nowPrevious = await this._readPointer(id, "previous");
        const latestVersion = this.states.get(id)?.latestVersion || current.version;
        this._set(id, { status: "ready", version: previous.version, previousVersion: nowPrevious?.version || null, source: "github", progress: 1, bytes: previous.size, totalInstalledBytes: previous.size + (nowPrevious?.size || 0), latestVersion, updateAvailable: compareVersions(latestVersion, previous.version) > 0, error: null });
        return this.states.get(id);
      } catch (error) {
        const safeError = statusError(error, "rolling-back");
        this._set(id, { status: "failed", error: safeError, progress: 0 });
        throw new Error(safeError);
      }
    });
  }

  load(id) {
    componentId(id);
    const current = this._readPointerSync(id, "current");
    if (!current) throw new Error("Adapter is not installed.");
    const loaded = this._loadVerifiedVersionSync(id, current);
    return loaded.adapter;
  }

  async pin(id) {
    componentId(id);
    return this._withLock(id, async () => {
      const current = await this._readPointer(id, "current");
      if (!current) throw new Error("Adapter is not installed.");
      const loaded = await this._loadVerifiedVersion(id, current);
      const versions = this.pins.get(id) || new Map();
      versions.set(current.version, (versions.get(current.version) || 0) + 1);
      this.pins.set(id, versions);
      this._set(id, { status: "ready", version: current.version, source: "github", pinned: true });
      return { version: current.version, adapter: loaded.adapter };
    });
  }

  release(id, version) {
    componentId(id);
    const versions = this.pins.get(id);
    if (!versions) return false;
    const count = versions.get(version) || 0;
    if (count <= 1) versions.delete(version); else versions.set(version, count - 1);
    if (!versions.size) this.pins.delete(id);
    this._set(id, { pinned: (this.pins.get(id)?.size || 0) > 0 });
    return count > 0;
  }

  _verifyPackage(raw, id, version) {
    const packageFile = parsePackageEnvelope(raw);
    const packageInfo = validatePackagePayload(packageFile.payload, id, version);
    return { ...packageInfo, payload: packageFile.payload };
  }

  async _publishFiles(id, version, rawPackage, descriptor) {
    await this._ensureDirectories(id);
    const versionsDir = this._versionsPath(id);
    const versionPath = this._versionPath(id, version);
    try {
      const existing = await this._assertPlainDirectory(versionPath, versionsDir);
      if (existing) {
        const packageFile = path.join(existing, "package.saip.json");
        const oldBytes = await fsp.readFile(packageFile);
        if (sha256(oldBytes) !== sha256(rawPackage)) throw new Error("A released adapter version cannot be replaced with different bytes.");
        await this._verifyInstalledFiles(existing, descriptor);
        return existing;
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const staging = path.join(versionsDir, `.staging-${crypto.randomUUID()}`);
    await fsp.mkdir(staging);
    try {
      await fsp.writeFile(path.join(staging, "package.saip.json"), rawPackage, { flag: "wx", mode: 0o600 });
      for (const file of descriptor.files) {
        const target = path.join(staging, file.relative);
        const relative = path.relative(staging, target);
        if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Adapter package file escaped its staging directory.");
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await this._ensurePlainAncestors(staging, path.dirname(target));
        await fsp.writeFile(target, file.bytes, { flag: "wx", mode: 0o600 });
      }
      await this._verifyInstalledFiles(staging, descriptor);
      await this._renameWithRetry(staging, versionPath);
      return versionPath;
    } catch (error) {
      await this._removeManagedTree(staging, versionsDir).catch(() => {});
      throw error;
    }
  }

  async _ensurePlainAncestors(root, target) {
    const rootPath = path.resolve(root);
    const targetPath = path.resolve(target);
    const [rootReal, targetReal] = await Promise.all([fsp.realpath(root), fsp.realpath(target)]);
    if (!samePath(rootPath, rootReal) || !within(rootPath, targetPath) || !within(rootReal, targetReal)) throw new Error("Adapter package wrote outside its staging directory.");
    const rootInfo = await fsp.lstat(rootPath);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Adapter package staging directory is unsafe.");
    const pending = [];
    let current = targetPath;
    while (!samePath(current, rootPath)) {
      if (!within(rootPath, current)) throw new Error("Adapter package wrote outside its staging directory.");
      pending.unshift(current);
      current = path.dirname(current);
    }
    for (const directory of pending) {
      const info = await fsp.lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Adapter package created an unsafe directory.");
      const real = await fsp.realpath(directory);
      if (!within(rootReal, real) || !samePath(real, directory)) throw new Error("Adapter package created a directory outside staging.");
    }
  }

  async _verifyInstalledFiles(directory, descriptor) {
    const rootReal = await fsp.realpath(directory);
    for (const file of descriptor.files) {
      const target = path.join(directory, file.relative);
      const info = await fsp.lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes.length) throw new Error("Installed adapter file is not a verified regular file.");
      const real = await fsp.realpath(target);
      if (!within(rootReal, real)) throw new Error("Installed adapter file escaped its version directory.");
      const bytes = await fsp.readFile(real);
      if (sha256(bytes) !== file.digest) throw new Error("Installed adapter file hash verification failed.");
    }
  }

  async _loadVerifiedVersion(id, pointer) {
    const versionPath = this._versionPath(id, pointer.version);
    const versionReal = await this._assertPlainDirectory(versionPath, this._versionsPath(id));
    if (!versionReal) throw new Error("Installed adapter version directory is missing.");
    const packagePath = path.join(versionReal, "package.saip.json");
    const packageInfo = await fsp.lstat(packagePath);
    if (!packageInfo.isFile() || packageInfo.isSymbolicLink() || packageInfo.size > MAX_PACKAGE_BYTES) throw new Error("Installed adapter package metadata is unsafe.");
    const packageReal = await fsp.realpath(packagePath);
    if (!within(versionReal, packageReal)) throw new Error("Installed adapter package escaped its version directory.");
    const raw = await fsp.readFile(packageReal);
    if (sha256(raw) !== pointer.packageSha256) throw new Error("Installed adapter package hash no longer matches its pointer.");
    const descriptor = this._verifyPackage(raw, id, pointer.version);
    await this._verifyInstalledFiles(versionReal, descriptor);
    const entryPath = path.join(versionReal, descriptor.entry);
    const entry = descriptor.files.find(item => item.relative === descriptor.entry);
    const adapterModule = new Module(entryPath, module);
    adapterModule.filename = entryPath;
    adapterModule.paths = Module._nodeModulePaths(path.dirname(entryPath));
    adapterModule._compile(entry.bytes.toString("utf8"), entryPath);
    const adapter = validateDescriptor(adapterModule.exports, id);
    return { adapter, descriptor, directory: versionReal };
  }

  _loadVerifiedVersionSync(id, pointer) {
    const versionPath = this._versionPath(id, pointer.version);
    let versionInfo;
    try { versionInfo = fs.lstatSync(versionPath); } catch (error) { if (error.code === "ENOENT") throw new Error("Installed adapter version directory is missing."); throw error; }
    if (!versionInfo.isDirectory() || versionInfo.isSymbolicLink()) throw new Error("Installed adapter version directory is unsafe.");
    const versionReal = fs.realpathSync(versionPath), versionsReal = fs.realpathSync(this._versionsPath(id));
    if (!within(versionsReal, versionReal) || versionReal === versionsReal) throw new Error("Installed adapter version escaped its managed directory.");
    const packagePath = path.join(versionReal, "package.saip.json");
    const packageInfo = fs.lstatSync(packagePath);
    if (!packageInfo.isFile() || packageInfo.isSymbolicLink() || packageInfo.size > MAX_PACKAGE_BYTES) throw new Error("Installed adapter package metadata is unsafe.");
    const packageReal = fs.realpathSync(packagePath);
    if (!within(versionReal, packageReal)) throw new Error("Installed adapter package escaped its version directory.");
    const raw = fs.readFileSync(packageReal);
    if (sha256(raw) !== pointer.packageSha256) throw new Error("Installed adapter package hash no longer matches GitHub release provenance.");
    const descriptor = this._verifyPackage(raw, id, pointer.version);
    for (const file of descriptor.files) {
      const target = path.join(versionReal, file.relative);
      const info = fs.lstatSync(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes.length) throw new Error("Installed adapter file is not a verified regular file.");
      const real = fs.realpathSync(target);
      if (!within(versionReal, real)) throw new Error("Installed adapter file escaped its version directory.");
      if (sha256(fs.readFileSync(real)) !== file.digest) throw new Error("Installed adapter file hash verification failed.");
    }
    const entry = descriptor.files.find(item => item.relative === descriptor.entry);
    const entryPath = path.join(versionReal, descriptor.entry);
    const adapterModule = new Module(entryPath, module);
    adapterModule.filename = entryPath;
    adapterModule.paths = Module._nodeModulePaths(path.dirname(entryPath));
    adapterModule._compile(entry.bytes.toString("utf8"), entryPath);
    const adapter = validateDescriptor(adapterModule.exports, id);
    return { adapter, descriptor, directory: versionReal };
  }

  async _pruneVersions(id, keepVersions) {
    const versionsDir = this._versionsPath(id);
    await this._assertPlainDirectory(versionsDir, this._componentPath(id));
    for (const entry of await fsp.readdir(versionsDir, { withFileTypes: true })) {
      if (keepVersions.has(entry.name) || entry.name.startsWith(".staging-")) continue;
      if (!VERSION_PATTERN.test(entry.name)) continue;
      const target = path.join(versionsDir, entry.name);
      const real = await this._assertPlainDirectory(target, versionsDir);
      if (real) await this._removeManagedTree(real, versionsDir);
    }
  }

  async _removeManagedTree(target, expectedParent) {
    let info;
    try { info = await fsp.lstat(target); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (info.isSymbolicLink()) throw new Error("Refusing to remove a linked adapter path.");
    const real = await fsp.realpath(target);
    const parentReal = await fsp.realpath(expectedParent);
    if (!within(parentReal, real) || real === parentReal) throw new Error("Refusing to remove a path outside adapter storage.");
    await this._assertRemovableTree(real, parentReal);
    await fsp.rm(real, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 });
  }

  async _assertRemovableTree(directory, parentReal) {
    const info = await fsp.lstat(directory);
    if (info.isSymbolicLink()) throw new Error("Refusing to remove a linked adapter path.");
    const real = await fsp.realpath(directory);
    if (!within(parentReal, real) || real === parentReal) throw new Error("Refusing to remove a path outside adapter storage.");
    if (!info.isDirectory()) {
      if (!info.isFile()) throw new Error("Refusing to remove a non-regular adapter file.");
      return;
    }
    for (const entry of await fsp.readdir(real, { withFileTypes: true })) {
      const child = path.join(real, entry.name);
      const childInfo = await fsp.lstat(child);
      if (childInfo.isSymbolicLink()) throw new Error("Refusing to remove a linked adapter path.");
      if (childInfo.isDirectory()) await this._assertRemovableTree(child, parentReal);
      else if (!childInfo.isFile()) throw new Error("Refusing to remove a non-regular adapter file.");
      else {
        const childReal = await fsp.realpath(child);
        if (!within(real, childReal)) throw new Error("Refusing to remove a path outside adapter storage.");
      }
    }
  }

  async _safeCurrentState(id) {
    try {
      const current = await this._readPointer(id, "current"), previous = await this._readPointer(id, "previous");
      if (!current) return null;
      return { status: "ready", version: current.version, previousVersion: previous?.version || null, source: current.source, progress: 0, bytes: current.size, totalInstalledBytes: current.size + (previous?.size || 0), pinned: (this.pins.get(id)?.size || 0) > 0 };
    } catch { return null; }
  }

  async _withLock(id, operation) {
    const previous = this.locks.get(id) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    this.locks.set(id, tail);
    await previous.catch(() => {});
    try { return await operation(); }
    finally {
      release();
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }
}

function compareVersions(left, right) {
  const a = VERSION_PATTERN.exec(left), b = VERSION_PATTERN.exec(right);
  if (!a || !b) return 0;
  for (let index = 1; index <= 3; index++) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return Math.sign(difference);
  }
  if (a[4] === b[4]) return 0;
  if (!a[4]) return 1;
  if (!b[4]) return -1;
  return a[4].localeCompare(b[4], "en", { numeric: true });
}

module.exports = { ComponentManager, PROVIDERS, REPOSITORY, CATALOG_URL, DISTRIBUTION_URL, validateRelativeFile, validateDescriptor, compareVersions, canonicalManagedTarget };
