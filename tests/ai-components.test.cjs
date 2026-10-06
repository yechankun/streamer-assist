"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { ComponentManager, REPOSITORY, CATALOG_URL, DISTRIBUTION_URL, validateRelativeFile, canonicalManagedTarget } = require("../electron/ai-components.cjs");

const API_ROOT = "https://api.github.com/repos/" + REPOSITORY + "/releases/tags/";
const PROVIDER = "openai";
const RECEIPT_TRUST = {
  schemaVersion: 1, repository: REPOSITORY, catalogTag: "catalog-v1", catalogAsset: "catalog.json", abiVersion: 1,
  verification: "github-published-release-receipts", distributionBranch: "distribution-v1", distributionPath: "index.json",
};

function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function adapterPackage(version, id = PROVIDER, name) {
  const metadata = {
    openai: ["responses", "https://platform.openai.com/docs", "OPENAI_API_KEY", "codex-app-server", "codex-rate-limits"],
    anthropic: ["anthropic", "https://docs.anthropic.com", "ANTHROPIC_API_KEY", "claude-initialize", "claude-events"],
    xai: ["chat", "https://docs.x.ai", "XAI_API_KEY", "grok-models", "unsupported"],
    google: ["gemini", "https://ai.google.dev", "GEMINI_API_KEY", "agy-models", "unsupported"],
    deepseek: ["chat", "https://api-docs.deepseek.com", "DEEPSEEK_API_KEY", "codex-app-server", "unsupported"],
    moonshot: ["chat", "https://platform.moonshot.ai", "MOONSHOT_API_KEY", "kimi-acp", "unsupported"],
  }[id];
  if (!metadata) throw new Error("Unknown fixture provider");
  const source = "module.exports={abiVersion:1,provider:{id:" + JSON.stringify(id) +
    ",name:" + JSON.stringify(name || ("Fixture " + version)) +
    ",protocol:" + JSON.stringify(metadata[0]) + ",docs:" + JSON.stringify(metadata[1]) + ",apiKeyEnv:" + JSON.stringify(metadata[2]) + "}," +
    "api:{buildRequest(){},parseEvent(){},buildModelsRequest(){},parseModelsResponse(){},normalizeUsage(){}}," +
    "cli:{analysisPlan(){},parseEvent(){},models:{driver:" + JSON.stringify(metadata[3]) + "},quota:{driver:" + JSON.stringify(metadata[4]) + "},loginArgs:[]},pricing:[]};";
  const content = Buffer.from(source);
  const payload = {
    schemaVersion: 1, abiVersion: 1, id, version, entry: "adapter.cjs",
    files: [{ path: "adapter.cjs", content: content.toString("base64"), sha256: digest(content) }],
  };
  const rawPayload = Buffer.from(JSON.stringify(payload));
  return { bytes: Buffer.from(JSON.stringify({ payload: rawPayload.toString("base64") })), payload };
}

function catalogBytes(packages) {
  const payload = {
    schemaVersion: 1, repository: REPOSITORY, generatedAt: "2026-10-06T00:00:00.000Z", abiVersion: 1,
    components: packages.map(item => {
      const id = item.id || PROVIDER;
      return { id, version: item.version, abiVersion: 1, asset: id + "-v" + item.version + ".saip.json", sha256: digest(item.bytes), size: item.bytes.length };
    }),
  };
  return Buffer.from(JSON.stringify(payload));
}

function response(bytes, status = 200, headerValues = {}) {
  return {
    ok: status >= 200 && status < 300, status, url: "",
    headers: { get(name) { return headerValues[String(name).toLowerCase()] || null; } },
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
  };
}

function releaseJson(tag, assetName, bytes, url, digestOverride, urlOverride) {
  return Buffer.from(JSON.stringify({
    tag_name: tag,
    assets: [{
      id: 101, name: assetName, size: bytes.length,
      digest: digestOverride === undefined ? "sha256:" + digest(bytes) : digestOverride,
      browser_download_url: urlOverride === undefined ? url : urlOverride,
    }],
  }));
}

function releaseReceipt(tag, assetName, bytes, url, digestOverride, options = {}) {
  const asset = { id: options.id || 101, name: assetName, size: bytes.length, browser_download_url: url };
  if (!options.missingDigest) asset.digest = digestOverride === undefined ? "sha256:" + digest(bytes) : digestOverride;
  return { tag_name: tag, assets: [asset] };
}

function githubFixture(packages, options = {}) {
  const rows = packages.map(item => ({ id: item.id || PROVIDER, version: item.version, bytes: item.bytes || adapterPackage(item.version, item.id || PROVIDER).bytes }));
  const catalog = options.catalog || catalogBytes(rows);
  const parsedCatalog = JSON.parse(catalog.toString("utf8"));
  const catalogReceipt = releaseReceipt("catalog-v1", "catalog.json", catalog, options.catalogUrl || CATALOG_URL, options.catalogDigest, {
    id: 100,
    missingDigest: options.catalogMissingDigest,
  });
  const releaseReceipts = rows.map((pkg, index) => {
    const tag = pkg.id + "-v" + pkg.version;
    const name = pkg.id + "-v" + pkg.version + ".saip.json";
    const url = "https://github.com/" + REPOSITORY + "/releases/download/" + tag + "/" + name;
    return releaseReceipt(tag, name, pkg.bytes, url, options.componentDigest, { id: index + 101, missingDigest: options.componentMissingDigest });
  });
  const distributionIndex = Buffer.from(JSON.stringify({
    schemaVersion: 1, repository: REPOSITORY, abiVersion: 1, generatedAt: "2026-10-06T00:00:00.000Z",
    catalog: parsedCatalog, catalogReceipt, catalogBytes: catalog.toString("base64"), releaseReceipts,
  }));
  const calls = [];
  const fetchImpl = async (url, request = {}) => {
    calls.push({ url, request });
    assert.equal(request.method, "GET");
    assert.equal(request.referrerPolicy, "no-referrer");
    assert.equal(Object.keys(request.headers || {}).some(key => /authorization|cookie|referer/i.test(key)), false);
    if (url === DISTRIBUTION_URL) return response(options.distributionIndex || distributionIndex, options.distributionStatus || 200, options.distributionHeaders || {});
    if (url.startsWith(API_ROOT)) {
      const tag = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
      if (tag === "catalog-v1") {
        return response(releaseJson(tag, "catalog.json", catalog, CATALOG_URL, options.catalogDigest, options.catalogUrl));
      }
      const match = /^(openai|anthropic|xai|google|deepseek|moonshot)-v(.+)$/.exec(tag);
      const pkg = match && rows.find(item => item.id === match[1] && item.version === match[2]);
      if (!pkg) return response(Buffer.from("{}"), 404);
      const name = match[1] + "-v" + match[2] + ".saip.json";
      const assetUrl = "https://github.com/" + REPOSITORY + "/releases/download/" + tag + "/" + name;
      const override = options.componentDigest;
      return response(releaseJson(tag, name, pkg.bytes, assetUrl, override));
    }
    if (url === CATALOG_URL) return response(catalog);
    const pkg = rows.find(item => {
      const name = item.id + "-v" + item.version + ".saip.json";
      const target = "https://github.com/" + REPOSITORY + "/releases/download/" + item.id + "-v" + item.version + "/" + name;
      return url === target;
    });
    if (pkg) return response(pkg.bytes);
    throw new Error("Unmocked network request: " + url);
  };
  return { fetchImpl, calls, catalog, rows, distributionIndex };
}

async function fixture(t, packages, options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "streamer-ai-components-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const remote = githubFixture(packages, options);
  const manager = new ComponentManager({ root, fetchImpl: remote.fetchImpl, requestTimeoutMs: 1000, trustConfig: options?.managerTrustConfig || RECEIPT_TRUST });
  return { root, manager, remote };
}

test("installs digest-verified modules, synchronously loads ABI, pins, and removes", async t => {
  const { manager, remote } = await fixture(t, [{ version: "1.2.0" }]);
  const state = await manager.install(PROVIDER);
  assert.equal(state.status, "ready");
  assert.equal(state.version, "1.2.0");
  assert.equal(state.source, "github");
  assert.ok(state.progress >= 0 && state.progress <= 1);
  assert.equal(state.previousVersion, null);
  assert.equal(manager.load(PROVIDER).provider.name, "Fixture 1.2.0");
  const pin = await manager.pin(PROVIDER);
  assert.equal(pin.version, "1.2.0");
  await assert.rejects(manager.remove(PROVIDER), /active AI job/);
  assert.equal(manager.release(PROVIDER, pin.version), true);
  await manager.remove(PROVIDER);
  assert.equal(manager.snapshot().byId[PROVIDER].status, "not-installed");
  assert.ok(remote.calls.some(call => call.url === DISTRIBUTION_URL));
  assert.equal(remote.calls.some(call => call.url.startsWith(API_ROOT)), false);
});

test("accepts the canonical model and quota drivers for all six fixed providers", async t => {
  const ids = ["openai", "anthropic", "xai", "google", "deepseek", "moonshot"];
  const packages = ids.map(id => ({ id, version: "1.0.0", bytes: adapterPackage("1.0.0", id).bytes }));
  const { manager } = await fixture(t, packages);
  for (const id of ids) {
    const state = await manager.install(id);
    assert.equal(state.status, "ready", id);
    assert.equal(manager.load(id).provider.id, id);
  }
});

test("updates retain one previous version and rollback swaps the active pointer", async t => {
  const { manager } = await fixture(t, [{ version: "1.0.0" }]);
  await manager.install(PROVIDER);
  const rows = [{ version: "1.1.0" }];
  const remote = githubFixture(rows);
  manager.fetchImpl = remote.fetchImpl;
  const updated = await manager.update(PROVIDER);
  assert.equal(updated.version, "1.1.0");
  assert.equal(updated.previousVersion, "1.0.0");
  const oldPackageSize = (await fs.stat(path.join(manager._versionPath(PROVIDER, "1.0.0"), "package.saip.json"))).size;
  assert.equal(updated.totalInstalledBytes, updated.bytes + oldPackageSize);
  const rolledBack = await manager.rollback(PROVIDER);
  assert.equal(rolledBack.version, "1.0.0");
  assert.equal(rolledBack.previousVersion, "1.1.0");
  assert.equal(manager.load(PROVIDER).provider.name, "Fixture 1.0.0");
});

test("invalid release asset digest preserves the installed current module", async t => {
  const { manager } = await fixture(t, [{ version: "1.0.0" }]);
  await manager.install(PROVIDER);
  const remote = githubFixture([{ version: "1.1.0" }], { componentDigest: "sha256:" + "0".repeat(64) });
  manager.fetchImpl = remote.fetchImpl;
  await assert.rejects(manager.update(PROVIDER), /digest|metadata/i);
  assert.equal(manager.load(PROVIDER).provider.name, "Fixture 1.0.0");
  assert.equal(manager.snapshot().byId[PROVIDER].version, "1.0.0");
});

test("catalog rejects a wrong repository, missing digest, and noncanonical URL", async t => {
  const wrong = Buffer.from(JSON.stringify({ schemaVersion: 1, repository: "attacker/repo", generatedAt: "2026-10-06T00:00:00Z", abiVersion: 1, components: [] }));
  const badRepo = await fixture(t, [], { catalog: wrong });
  await assert.rejects(badRepo.manager.catalog({ refresh: true }), /catalog|repository/i);

  const missing = await fixture(t, [], { catalogMissingDigest: true });
  await assert.rejects(missing.manager.catalog({ refresh: true }), /digest/i);

  const badUrl = await fixture(t, [], { catalogUrl: "https://github.com/attacker/repo/releases/download/catalog-v1/catalog.json" });
  await assert.rejects(badUrl.manager.catalog({ refresh: true }), /URL|trusted/i);

  const changedBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, repository: REPOSITORY, generatedAt: "2026-10-06T00:00:00Z", abiVersion: 1, components: [] }));
  const mismatch = await fixture(t, [], { catalog: changedBytes, catalogDigest: "sha256:" + "0".repeat(64) });
  await assert.rejects(mismatch.manager.catalog({ refresh: true }), /digest|receipt/i);
});

test("published index rejects tampered catalog bytes, unbound URLs, and incomplete release receipts", async t => {
  const cases = [
    index => { index.repository = "attacker/other"; },
    index => { index.catalog.components[0].version = "9.9.9"; },
    index => { index.releaseReceipts[0].assets[0].browser_download_url = "https://github.com/attacker/repo/releases/download/openai-v1.0.0/openai-v1.0.0.saip.json"; },
    index => { index.releaseReceipts = []; },
  ];
  for (const mutate of cases) {
    const remote = githubFixture([{ version: "1.0.0" }]);
    const index = JSON.parse(remote.distributionIndex.toString("utf8"));
    mutate(index);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "streamer-ai-index-tamper-"));
    t.after(async () => fs.rm(root, { recursive: true, force: true }));
    const manager = new ComponentManager({ root, trustConfig: RECEIPT_TRUST, fetchImpl: async (url, request) => {
      if (url === DISTRIBUTION_URL) return response(Buffer.from(JSON.stringify(index)));
      return remote.fetchImpl(url, request);
    } });
    await assert.rejects(manager.catalog({ refresh: true }), /publisher|catalog|receipt|URL|trusted/i);
    assert.equal(remote.calls.some(call => call.url.startsWith(API_ROOT)), false);
  }
});

test("legacy GitHub API digest mode remains opt-in and does not consume the publisher index", async t => {
  const trustConfig = { schemaVersion: 1, repository: REPOSITORY, catalogTag: "catalog-v1", catalogAsset: "catalog.json", abiVersion: 1, verification: "github-release-digest" };
  const { manager, remote } = await fixture(t, [{ version: "1.0.0" }], { managerTrustConfig: trustConfig });
  const state = await manager.install(PROVIDER);
  assert.equal(state.status, "ready");
  assert.equal(remote.calls.some(call => call.url === DISTRIBUTION_URL), false);
  assert.ok(remote.calls.some(call => call.url.startsWith(API_ROOT)));
  assert.equal(manager.load(PROVIDER).provider.id, PROVIDER);
});

test("publisher-receipt mode is pinned to the single reviewed repository path", async t => {
  const { root } = await fixture(t, []);
  let requests = 0;
  const manager = new ComponentManager({ root, trustConfig: { ...RECEIPT_TRUST, distributionBranch: "attacker-branch" }, fetchImpl: async () => { requests++; throw new Error("must not fetch"); } });
  await assert.rejects(manager.catalog({ refresh: true }), /configured GitHub repository/i);
  assert.equal(requests, 0);
});

test("receipt mode replaces a fresh legacy cache before install and then reuses verified metadata", async t => {
  const legacyTrust = { schemaVersion: 1, repository: REPOSITORY, catalogTag: "catalog-v1", catalogAsset: "catalog.json", abiVersion: 1, verification: "github-release-digest" };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "streamer-ai-legacy-cache-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const packageInfo = adapterPackage("1.0.0");
  const legacyRemote = githubFixture([{ version: "1.0.0", bytes: packageInfo.bytes }]);
  const legacy = new ComponentManager({ root, trustConfig: legacyTrust, fetchImpl: legacyRemote.fetchImpl });
  await legacy.catalog({ refresh: true });
  const oldCache = JSON.parse(await fs.readFile(path.join(root, "ai", "adapters", "catalog-cache.json"), "utf8"));
  assert.equal(Object.hasOwn(oldCache, "protectedDistributionIndex"), false);

  const receiptRemote = githubFixture([{ version: "1.0.0", bytes: packageInfo.bytes }]);
  let indexRequests = 0, restRequests = 0, artifactRequests = 0;
  const receiptFetch = async url => {
    if (url === DISTRIBUTION_URL) { indexRequests++; return response(receiptRemote.distributionIndex); }
    if (url.startsWith(API_ROOT)) { restRequests++; throw new Error("REST API should not be called while the publisher index is available"); }
    if (url.includes("/releases/download/openai-v1.0.0/")) { artifactRequests++; return response(packageInfo.bytes); }
    throw new Error("Unexpected fixture request");
  };
  const receiptManager = new ComponentManager({ root, trustConfig: RECEIPT_TRUST, fetchImpl: receiptFetch });
  const installed = await receiptManager.install(PROVIDER);
  assert.equal(installed.version, "1.0.0");
  assert.equal(indexRequests, 1);
  assert.equal(restRequests, 0);
  assert.equal(artifactRequests, 1);

  const same = await receiptManager.install(PROVIDER);
  assert.equal(same.version, "1.0.0");
  assert.equal(indexRequests, 1);
  assert.equal(artifactRequests, 1);
});

test("GitHub REST 403 cooldown prevents repeated release metadata requests", async t => {
  const trustConfig = { schemaVersion: 1, repository: REPOSITORY, catalogTag: "catalog-v1", catalogAsset: "catalog.json", abiVersion: 1, verification: "github-release-digest" };
  const { manager } = await fixture(t, [], { managerTrustConfig: trustConfig });
  let releaseRequests = 0;
  const retryAtSeconds = Math.ceil(Date.now() / 1000) + 120;
  manager.fetchImpl = async (url, request) => {
    if (url.startsWith(API_ROOT)) {
      releaseRequests++;
      return response(Buffer.from("rate limit"), 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(retryAtSeconds) });
    }
    return response(Buffer.from("offline"), 503);
  };
  await assert.rejects(manager.catalog({ refresh: true }), /rate-limited.*retry after/i);
  await assert.rejects(manager.catalog({ refresh: true }), /rate-limited.*retry after/i);
  assert.equal(releaseRequests, 1);
});

test("protected publisher receipts allow a cached install without REST calls during quota exhaustion", async t => {
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from("protected:" + value),
    decryptString: value => {
      const text = Buffer.from(value).toString("utf8");
      if (!text.startsWith("protected:")) throw new Error("invalid protected data");
      return text.slice("protected:".length);
    },
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "streamer-ai-receipt-cache-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const packageInfo = adapterPackage("1.0.0");
  const remote = githubFixture([{ version: "1.0.0", bytes: packageInfo.bytes }]);
  const warm = new ComponentManager({ root, fetchImpl: remote.fetchImpl, storage, trustConfig: RECEIPT_TRUST });
  const checked = await warm.catalog({ refresh: true });
  assert.equal(checked.source, "github-publisher-receipts");
  assert.ok((await fs.readFile(path.join(root, "ai", "adapters", "catalog-cache.json"), "utf8")).includes("protectedDistributionIndex"));

  let restRequests = 0, artifactRequests = 0;
  const offlineFetch = async url => {
    if (url.startsWith(API_ROOT)) {
      restRequests++;
      return response(Buffer.from("rate limit"), 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 120) });
    }
    if (url === DISTRIBUTION_URL) throw new Error("publisher index is temporarily unreachable");
    if (url.includes("/releases/download/openai-v1.0.0/")) {
      artifactRequests++;
      return response(packageInfo.bytes);
    }
    throw new Error("unexpected fetch");
  };
  const restarted = new ComponentManager({ root, fetchImpl: offlineFetch, storage, trustConfig: RECEIPT_TRUST });
  const installed = await restarted.install(PROVIDER);
  assert.equal(installed.version, "1.0.0");
  assert.equal(restRequests, 0);
  assert.equal(artifactRequests, 1);
  assert.equal(restarted.load(PROVIDER).provider.id, PROVIDER);
});

test("installed module and catalog cache are verified on offline restart", async t => {
  const { root, manager } = await fixture(t, [{ version: "1.0.0" }]);
  await manager.install(PROVIDER);
  const offline = new ComponentManager({ root, fetchImpl: async () => { throw new Error("network should not be reached"); } });
  const catalog = await offline.catalog();
  assert.equal(catalog.source, "cache");
  assert.equal(offline.load(PROVIDER).provider.name, "Fixture 1.0.0");
});

test("rejects path traversal, ADS/reserved aliases, duplicate case aliases, and tampering", async t => {
  for (const value of ["../escape.cjs", "folder/../../escape.cjs", "adapter.cjs:payload", "NUL.txt", "trailing./x.cjs"]) {
    assert.throws(() => validateRelativeFile(value), /unsafe/);
  }
  const source = adapterPackage("1.0.0");
  const payload = JSON.parse(Buffer.from(JSON.parse(source.bytes.toString("utf8")).payload, "base64").toString("utf8"));
  const other = Buffer.from("module.exports={};");
  payload.files.push({ path: "ADAPTER.CJS", content: other.toString("base64"), sha256: digest(other) });
  const wrapped = Buffer.from(JSON.stringify({ payload: Buffer.from(JSON.stringify(payload)).toString("base64") }));
  const duplicate = await fixture(t, [{ version: "1.0.0", bytes: wrapped }]);
  await assert.rejects(duplicate.manager.install(PROVIDER), /duplicate/i);

  const good = await fixture(t, [{ version: "1.0.0" }]);
  await good.manager.install(PROVIDER);
  await fs.writeFile(path.join(good.manager._versionPath(PROVIDER, "1.0.0"), "adapter.cjs"), "module.exports = {};", "utf8");
  assert.throws(() => good.manager.load(PROVIDER), /hash|verified regular/i);
});

test("canonical managed paths accept Windows case and 8.3 aliases without allowing escape", () => {
  const win = path.win32;
  const rootReal = "C:\\Users\\RunnerAdmin\\AppData\\Local\\Temp\\streamer-assist";
  const parentReal = win.join(rootReal, "ai", "adapters");
  const aliasParent = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\streamer-assist\\ai\\adapters";
  const aliasTarget = win.join(aliasParent, "catalog-cache.json");

  assert.equal(canonicalManagedTarget({
    rootReal,
    parentReal: parentReal.toLowerCase(),
    targetParentReal: parentReal,
    targetPath: aliasTarget,
    pathImpl: win,
    ignoreCase: true,
  }), win.join(parentReal.toLowerCase(), "catalog-cache.json"));

  assert.throws(() => canonicalManagedTarget({
    rootReal,
    parentReal,
    targetParentReal: "C:\\Users\\RunnerAdmin\\AppData\\Local\\Temp\\outside",
    targetPath: aliasTarget,
    pathImpl: win,
    ignoreCase: true,
  }), /escaped/);
  assert.throws(() => canonicalManagedTarget({
    rootReal,
    parentReal: "C:\\Users\\RunnerAdmin\\AppData\\Local\\outside",
    targetParentReal: "C:\\Users\\RunnerAdmin\\AppData\\Local\\outside",
    targetPath: "C:\\Users\\RunnerAdmin\\AppData\\Local\\outside\\catalog-cache.json",
    pathImpl: win,
    ignoreCase: true,
  }), /escaped/);
});

test("Windows case-variant userData root completes install and offline load", async t => {
  if (process.platform !== "win32") return t.skip("requires Windows path alias behavior");
  const createdRoot = await fs.mkdtemp(path.join(os.tmpdir(), "streamer-ai-case-"));
  t.after(async () => fs.rm(createdRoot, { recursive: true, force: true }));
  const canonicalRoot = await fs.realpath(createdRoot);
  const caseAlias = path.join(path.dirname(canonicalRoot), path.basename(canonicalRoot).toUpperCase());
  let aliasReal;
  try { aliasReal = await fs.realpath(caseAlias); }
  catch (error) {
    if (error.code === "ENOENT") return t.skip("temporary volume is case-sensitive");
    throw error;
  }
  if (aliasReal.toLowerCase() !== canonicalRoot.toLowerCase() || caseAlias === canonicalRoot) {
    return t.skip("temporary volume does not resolve the case-variant path to the same directory");
  }

  const remote = githubFixture([{ version: "1.0.0" }]);
  const manager = new ComponentManager({ root: caseAlias, fetchImpl: remote.fetchImpl, requestTimeoutMs: 1000 });
  const installed = await manager.install(PROVIDER);
  assert.equal(installed.status, "ready");
  assert.equal(manager.root, canonicalRoot);
  assert.equal(manager.adaptersRoot, path.join(canonicalRoot, "ai", "adapters"));
  assert.equal(manager.load(PROVIDER).provider.name, "Fixture 1.0.0");

  const restarted = new ComponentManager({ root: caseAlias, fetchImpl: async () => { throw new Error("offline load must not fetch"); } });
  assert.equal(restarted.load(PROVIDER).provider.name, "Fixture 1.0.0");
});

test("staging rejects an internal junction even when its destination stays inside", async t => {
  const { root, manager } = await fixture(t, []);
  const canonicalRoot = await fs.realpath(root);
  const staging = path.join(canonicalRoot, "staging");
  const realDirectory = path.join(staging, "real-directory");
  const linkedDirectory = path.join(staging, "linked-directory");
  await fs.mkdir(realDirectory, { recursive: true });
  try { await fs.symlink(realDirectory, linkedDirectory, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("symlink creation is unavailable"); throw error; }
  await assert.rejects(manager._ensurePlainAncestors(staging, linkedDirectory), /unsafe directory/i);
});

test("HTTP status stays visible while long filesystem errors expose only a safe phase and code", async t => {
  const http = await fixture(t, [], { managerTrustConfig: {
    schemaVersion: 1, repository: REPOSITORY, catalogTag: "catalog-v1", catalogAsset: "catalog.json", abiVersion: 1, verification: "github-release-digest",
  } });
  http.manager.fetchImpl = async (url, request) => {
    if (url.startsWith(API_ROOT)) return response(Buffer.from("upstream body is not surfaced"), 503);
    return http.remote.fetchImpl(url, request);
  };
  await assert.rejects(http.manager.catalog({ refresh: true }), /HTTP 503/);

  const local = await fixture(t, [{ version: "1.0.0" }]);
  const privatePathMarker = path.join(local.root, "profile-path-marker");
  local.manager._atomicPointer = async () => {
    const error = new Error(`EPERM: simulated rename failure at ${privatePathMarker} `.repeat(12));
    error.code = "EPERM";
    error.syscall = "rename";
    error.path = privatePathMarker;
    throw error;
  };
  await assert.rejects(local.manager.install(PROVIDER), error => {
    assert.equal(error.message, "Adapter installation failed (EPERM, rename).");
    assert.equal(error.message.includes(privatePathMarker), false);
    return true;
  });
  assert.equal(local.manager.snapshot().byId[PROVIDER].error, "Adapter installation failed (EPERM, rename).");
});

test("atomic metadata writes retry transient Windows rename locks and preserve targets on persistent EPERM", async t => {
  const { root, manager } = await fixture(t, []);
  await manager._ensureDirectories(PROVIDER);
  const target = path.join(manager.adaptersRoot, "rename-probe.json");
  await fs.writeFile(target, "old", "utf8");
  const delays = [];
  manager.sleepImpl = async milliseconds => { delays.push(milliseconds); };
  let transientAttempts = 0;
  manager.renameImpl = async (source, destination) => {
    if (destination === target && transientAttempts < 2) {
      transientAttempts++;
      const error = new Error("sharing violation");
      error.code = "EPERM";
      error.syscall = "rename";
      throw error;
    }
    return fs.rename(source, destination);
  };
  await manager._atomicText(target, manager.adaptersRoot, "new");
  assert.equal(transientAttempts, 2);
  assert.deepEqual(delays.splice(0), [50, 100]);
  assert.equal(await fs.readFile(target, "utf8"), "new");

  await fs.writeFile(target, "still-old", "utf8");
  let persistentAttempts = 0;
  manager.renameImpl = async () => {
    persistentAttempts++;
    const error = new Error("locked destination");
    error.code = "EPERM";
    error.syscall = "rename";
    throw error;
  };
  await assert.rejects(manager._atomicText(target, manager.adaptersRoot, "must-not-replace"), { code: "EPERM" });
  assert.equal(persistentAttempts, 6);
  assert.deepEqual(delays.splice(0), [50, 100, 200, 400, 800]);
  assert.equal(await fs.readFile(target, "utf8"), "still-old");
  const leftovers = (await fs.readdir(manager.adaptersRoot)).filter(name => name.startsWith("rename-probe.json.") && name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("version-directory rename retries locks and a locked current pointer keeps the active version", async t => {
  const { manager } = await fixture(t, [{ version: "1.0.0" }]);
  await manager.install(PROVIDER);
  const packageV2 = adapterPackage("1.1.0");
  manager.fetchImpl = githubFixture([{ version: "1.1.0", bytes: packageV2.bytes }]).fetchImpl;
  const versionV2Path = manager._versionPath(PROVIDER, "1.1.0");
  let stagingRenameFailures = 0;
  const delays = [];
  manager.sleepImpl = async milliseconds => { delays.push(milliseconds); };
  manager.renameImpl = async (source, destination) => {
    if (destination === versionV2Path && stagingRenameFailures < 2) {
      stagingRenameFailures++;
      const error = new Error("temporary sharing lock");
      error.code = "EPERM";
      error.syscall = "rename";
      throw error;
    }
    return fs.rename(source, destination);
  };
  const v2 = await manager.update(PROVIDER);
  assert.equal(v2.version, "1.1.0");
  assert.equal(stagingRenameFailures, 2);
  assert.deepEqual(delays.splice(0), [50, 100]);
  assert.equal(manager.load(PROVIDER).provider.name, "Fixture 1.1.0");

  const currentPath = manager._pointerPath(PROVIDER, "current");
  const currentBefore = await fs.readFile(currentPath, "utf8");
  const packageV3 = adapterPackage("1.2.0");
  manager.fetchImpl = githubFixture([{ version: "1.2.0", bytes: packageV3.bytes }]).fetchImpl;
  let currentRenameFailures = 0;
  manager.renameImpl = async (source, destination) => {
    if (destination === currentPath) {
      currentRenameFailures++;
      const error = new Error("current pointer remains locked");
      error.code = "EPERM";
      error.syscall = "rename";
      throw error;
    }
    return fs.rename(source, destination);
  };
  await assert.rejects(manager.update(PROVIDER), /EPERM/i);
  assert.equal(currentRenameFailures, 6);
  assert.deepEqual(delays.splice(0), [50, 100, 200, 400, 800]);
  assert.equal(await fs.readFile(currentPath, "utf8"), currentBefore);
  assert.equal((await manager._readPointer(PROVIDER, "current")).version, "1.1.0");
  assert.equal(manager.snapshot().byId[PROVIDER].version, "1.1.0");
  assert.equal(manager.load(PROVIDER).provider.name, "Fixture 1.1.0");
  assert.equal((await fs.stat(versionV2Path)).isDirectory(), true);
});

test("cancelled installs publish no files and do not make network requests", async t => {
  const { manager, remote } = await fixture(t, [{ version: "1.0.0" }]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(manager.install(PROVIDER, { signal: controller.signal }), /cancel/i);
  assert.equal(manager.snapshot().byId[PROVIDER].status, "failed");
  assert.throws(() => manager.load(PROVIDER), /not installed/i);
  assert.equal(remote.calls.length, 0);
});

test("device-protected provenance tampering blocks offline loading", async t => {
  const { root, manager } = await fixture(t, [{ version: "1.0.0" }]);
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from("device:" + value),
    decryptString: value => {
      const text = Buffer.from(value).toString("utf8");
      if (!text.startsWith("device:")) throw new Error("invalid protected data");
      return text.slice("device:".length);
    },
  };
  const protectedManager = new ComponentManager({ root, fetchImpl: manager.fetchImpl, storage });
  await protectedManager.install(PROVIDER);
  const pointer = path.join(root, "ai", "adapters", PROVIDER, "current.json");
  assert.match(await fs.readFile(pointer, "utf8"), /^dpapi:v1:/);
  assert.equal(protectedManager.load(PROVIDER).provider.id, PROVIDER);
  await fs.writeFile(pointer, "dpapi:v1:Zm9yZ2Vk", "utf8");
  assert.throws(() => protectedManager.load(PROVIDER), /integrity|decrypt/i);
});

test("remove refuses a symlink in the managed tree", async t => {
  const { root, manager } = await fixture(t, [{ version: "1.0.0" }]);
  await manager.install(PROVIDER);
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  const outsideFile = path.join(outside, "sentinel.txt");
  await fs.writeFile(outsideFile, "keep");
  const link = path.join(manager._versionPath(PROVIDER, "1.0.0"), "linked.txt");
  try { await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("symlink creation is unavailable"); throw error; }
  await assert.rejects(manager.remove(PROVIDER), /linked adapter path/i);
  assert.equal(await fs.readFile(outsideFile, "utf8"), "keep");
});
