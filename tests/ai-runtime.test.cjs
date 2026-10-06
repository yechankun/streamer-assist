"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { RuntimeManager, extractTarGz } = require("../electron/ai-runtime.cjs");
const { loadTestAdapters } = require("./ai-test-adapters.cjs");

let adapters;
test.before(async () => { adapters = await loadTestAdapters(); });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "streamer-ai-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function sri512(bytes) { return `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`; }

function tarHeader(name, size, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(32, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

function tarGz(entries) {
  const pieces = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data || "");
    pieces.push(tarHeader(entry.name, data.length, entry.type || "0"));
    if (data.length) pieces.push(data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) pieces.push(Buffer.alloc(padding));
  }
  pieces.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(pieces));
}

function response(body, headers = {}) {
  return new Response(body, { status: 200, headers: { "content-length": String(Buffer.byteLength(body)), ...headers } });
}

function runtimeManager(options, providerId = "anthropic") {
  const manager = new RuntimeManager(options);
  manager.registerRuntime(adapters[providerId].runtime);
  return manager;
}

function claudeFetch(getVersion, getBinary, { badChecksum = () => false, onBinary } = {}) {
  return async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "downloads.claude.ai") throw new Error(`Unexpected Claude release host: ${parsed.hostname}`);
    if (parsed.pathname.endsWith("/latest")) return response(getVersion(), { "content-type": "text/plain" });
    if (parsed.pathname.endsWith("/manifest.json")) {
      const version = parsed.pathname.split("/").at(-2);
      const bytes = getBinary(version);
      const checksum = badChecksum(version) ? "0".repeat(64) : sha256(bytes);
      return response(JSON.stringify({ platforms: { "win32-x64": { checksum } } }), { "content-type": "application/json" });
    }
    if (parsed.pathname.endsWith("/win32-x64/claude.exe")) {
      onBinary?.(options);
      const version = parsed.pathname.split("/").at(-3);
      return response(getBinary(version));
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

function codexFetch(getVersion, getArchive, { onBinary, badChecksum = false } = {}) {
  return async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "registry.npmjs.org") throw new Error(`Unexpected Codex release host: ${parsed.hostname}`);
    if (parsed.pathname.endsWith("/latest")) {
      const version = getVersion();
      return response(JSON.stringify({ version, optionalDependencies: { "@openai/codex-win32-x64": `npm:@openai/codex@${version}-win32-x64` } }), { "content-type": "application/json" });
    }
    if (parsed.pathname.endsWith(".tgz")) {
      onBinary?.(options);
      return response(getArchive());
    }
    const nativeVersion = parsed.pathname.split("/").at(-1);
    const archive = getArchive();
    const integrity = badChecksum ? sri512(Buffer.from("wrong archive")) : sri512(archive);
    return response(JSON.stringify({ version: nativeVersion, dist: { integrity, tarball: `https://registry.npmjs.org/@openai/codex/-/codex-${nativeVersion}.tgz` } }), { "content-type": "application/json" });
  };
}

function kimiFetch(getVersion, getBinary, { calls = [], onBinary } = {}) {
  return async (url, options) => {
    const parsed = new URL(url);
    calls.push({ host: parsed.hostname, pathname: parsed.pathname, redirect: options?.redirect });
    if (!["code.kimi.com", "code.kimi.ai"].includes(parsed.hostname)) throw new Error(`Unexpected Kimi release host: ${parsed.hostname}`);
    if (parsed.hostname === "code.kimi.com") throw new TypeError("fetch failed");
    if (parsed.pathname.endsWith("/latest")) return response(getVersion(), { "content-type": "text/plain" });
    if (parsed.pathname.endsWith("/manifest.json")) {
      return response(JSON.stringify({ platforms: { "win32-x64": { filename: "kimi-code-win32-x64.exe", checksum: sha256(getBinary()) } } }), { "content-type": "application/json" });
    }
    if (parsed.pathname.endsWith("/kimi-code-win32-x64.exe")) {
      onBinary?.(options);
      return response(getBinary());
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

test("installs checksummed native runtimes, keeps one previous release, and rolls back", async t => {
  const root = await fixture(t);
  let latest = "1.2.0";
  const binaries = new Map([["1.2.0", Buffer.from("synthetic claude 1")], ["1.3.0", Buffer.from("synthetic claude 2")]]);
  const events = [];
  const manager = runtimeManager({ root, platform: "win32", arch: "x64", fetchImpl: claudeFetch(() => latest, version => binaries.get(version)), notify: state => events.push(state) });

  const first = await manager.install("claude");
  assert.equal(first.version, "1.2.0");
  assert.equal(first.source, "managed");
  assert.equal(first.previousVersion, null);
  assert.equal(first.totalInstalledBytes, binaries.get("1.2.0").length);
  assert.equal(await fs.readFile(first.executable, "utf8"), "synthetic claude 1");
  assert.deepEqual(await manager.info("claude"), { id: "claude", latestVersion: "1.2.0", installedVersion: "1.2.0", updateAvailable: false, source: "managed", provenance: "claude:1.2.0:win32-x64" });

  latest = "1.3.0";
  const second = await manager.install("claude");
  assert.equal(second.version, "1.3.0");
  assert.equal((await manager.snapshot()).byId.claude.bytes, binaries.get("1.3.0").length);
  assert.equal(second.previousVersion, "1.2.0");
  assert.equal(second.totalInstalledBytes, binaries.get("1.2.0").length + binaries.get("1.3.0").length);

  // A fresh manager verifies both pointers from disk and restores rollback availability after restart.
  const restarted = runtimeManager({ root, platform: "win32", arch: "x64", fetchImpl: async () => { throw new Error("No network expected"); } });
  const detected = await restarted.detect("claude");
  assert.equal(detected.version, "1.3.0");
  assert.equal(detected.previousVersion, "1.2.0");
  assert.equal(detected.totalInstalledBytes, binaries.get("1.2.0").length + binaries.get("1.3.0").length);

  const rolledBack = await restarted.rollback("claude");
  assert.equal(rolledBack.version, "1.2.0");
  assert.equal(rolledBack.previousVersion, "1.3.0");
  assert.equal(rolledBack.totalInstalledBytes, binaries.get("1.2.0").length + binaries.get("1.3.0").length);
  assert.equal(await restarted.resolve("claude"), first.executable);
  const pinned = await restarted.pin("claude");
  assert.equal(pinned, first.executable);
  await assert.rejects(restarted.remove("claude"), /in use/);
  assert.equal(restarted.release("claude"), true);
  assert.deepEqual(await restarted.remove("claude"), { removed: true, source: "managed" });
  assert.equal(await restarted.resolve("claude"), null);
  assert.equal(restarted.snapshot().byId.claude.previousVersion, null);
  assert.equal(restarted.snapshot().byId.claude.totalInstalledBytes, 0);
  assert.ok(events.every(state => state.progress >= 0 && state.progress <= 1));
});

test("a checksum failure leaves the active version unchanged", async t => {
  const root = await fixture(t);
  let latest = "2.0.0";
  const binaries = new Map([["2.0.0", Buffer.from("good release 1")], ["2.0.5", Buffer.from("good release 2")], ["2.1.0", Buffer.from("untrusted release")]]);
  const manager = runtimeManager({
    root,
    platform: "win32",
    arch: "x64",
    fetchImpl: claudeFetch(() => latest, version => binaries.get(version), { badChecksum: version => version === "2.1.0" }),
  });
  await manager.install("claude");
  latest = "2.0.5";
  const installed = await manager.install("claude");
  latest = "2.1.0";
  await assert.rejects(manager.install("claude"), /checksum/);
  assert.match((await manager.snapshot()).byId.claude.error, /checksum/);
  assert.equal((await manager.snapshot()).byId.claude.version, "2.0.5");
  assert.equal((await manager.snapshot()).byId.claude.previousVersion, "2.0.0");
  assert.equal((await manager.snapshot()).byId.claude.totalInstalledBytes, binaries.get("2.0.0").length + binaries.get("2.0.5").length);
  assert.equal(await manager.resolve("claude"), installed.executable);
  const current = JSON.parse(await fs.readFile(path.join(root, "ai", "components", "claude", "current.json"), "utf8"));
  assert.equal(current.version, "2.0.5");
});

test("verified installs recover orphan versions while retaining current, previous, and pinned releases", async t => {
  const root = await fixture(t);
  let latest = "3.0.0";
  let badChecksum = false;
  const manager = runtimeManager({ root, platform: "win32", arch: "x64", fetchImpl: claudeFetch(() => latest, version => Buffer.from(`verified ${version}`), { badChecksum: () => badChecksum }) });
  const first = await manager.install("claude");
  const pinned = await manager.pin("claude");
  latest = "3.1.0";
  const second = await manager.install("claude");
  const versionsDir = path.join(root, "ai", "components", "claude", "versions");
  latest = "3.2.0";
  const orphan = path.join(versionsDir, latest);
  await fs.mkdir(orphan);
  await fs.writeFile(path.join(orphan, "claude.exe"), "unrecorded old binary");
  await fs.writeFile(path.join(orphan, "sentinel.txt"), "retain until verification");
  badChecksum = true;
  await assert.rejects(manager.install("claude"), /checksum/);
  assert.equal(await fs.readFile(path.join(orphan, "sentinel.txt"), "utf8"), "retain until verification");
  badChecksum = false;
  const recovered = await manager.install("claude");
  assert.equal(recovered.version, "3.2.0");
  assert.equal(recovered.previousVersion, "3.1.0");
  assert.equal(await fs.readFile(recovered.executable, "utf8"), "verified 3.2.0");
  assert.equal(await fs.readFile(first.executable, "utf8"), "verified 3.0.0");
  assert.equal(await fs.readFile(second.executable, "utf8"), "verified 3.1.0");
  await assert.rejects(fs.stat(path.join(orphan, "sentinel.txt")), { code: "ENOENT" });
  assert.deepEqual((await fs.readdir(versionsDir)).sort(), ["3.0.0", "3.1.0", "3.2.0"]);
  manager.release("claude", pinned);
});

test("orphan recovery without pointers cleans staging and restores originals after publication failure", async t => {
  const root = await fixture(t);
  const version = "1.3.0";
  const versionsDir = path.join(root, "ai", "components", "claude", "versions");
  const orphan = path.join(versionsDir, version);
  await fs.mkdir(orphan, { recursive: true });
  await fs.writeFile(path.join(orphan, "claude.exe"), "original orphan binary");
  await fs.writeFile(path.join(orphan, "keep.txt"), "original orphan data");
  const manager = runtimeManager({ root, platform: "win32", arch: "x64", fetchImpl: claudeFetch(() => version, () => Buffer.from("verified replacement")) });
  const atomicJson = manager._atomicJson.bind(manager);
  manager._atomicJson = async (target, value) => { if (target.endsWith("current.json")) throw new Error("simulated pointer publication failure"); return atomicJson(target, value); };
  await assert.rejects(manager.install("claude"), /publication failure/);
  assert.equal(await manager.resolve("claude"), null);
  assert.equal(await fs.readFile(path.join(orphan, "claude.exe"), "utf8"), "original orphan binary");
  assert.equal(await fs.readFile(path.join(orphan, "keep.txt"), "utf8"), "original orphan data");
  assert.deepEqual(await fs.readdir(versionsDir), [version]);
  manager._atomicJson = atomicJson;
  const result = await manager.install("claude");
  assert.equal(await fs.readFile(result.executable, "utf8"), "verified replacement");
  assert.deepEqual(await fs.readdir(versionsDir), [version]);
  const restarted = runtimeManager({ root, platform: "win32", arch: "x64", fetchImpl: async () => { throw new Error("No network expected"); } });
  assert.equal((await restarted.detect("claude")).version, version);
});

test("same-version and previous-version retries reuse verified binaries and leave no staging payload", async t => {
  const root = await fixture(t);
  let latest = "5.0.0";
  let binaryDownloads = 0;
  const manager = runtimeManager({ root, platform: "win32", arch: "x64", fetchImpl: claudeFetch(() => latest, version => Buffer.from(`verified ${version}`), { onBinary: () => binaryDownloads++ }) });
  const first = await manager.install("claude");
  assert.equal((await manager.install("claude")).executable, first.executable);
  assert.equal(binaryDownloads, 1);
  latest = "5.1.0";
  await manager.install("claude");
  latest = "5.0.0";
  const reused = await manager.install("claude");
  assert.equal(reused.executable, first.executable);
  assert.equal(reused.previousVersion, "5.1.0");
  assert.deepEqual((await fs.readdir(path.join(root, "ai", "components", "claude", "versions"))).sort(), ["5.0.0", "5.1.0"]);
});

test("orphan recovery does not replace a pinned release whose pointer is missing", async t => {
  const root = await fixture(t);
  const manager = runtimeManager({ root, platform: "win32", arch: "x64", fetchImpl: claudeFetch(() => "6.0.0", () => Buffer.from("pinned binary")) });
  const installed = await manager.install("claude");
  const pinned = await manager.pin("claude");
  await fs.rm(path.join(root, "ai", "components", "claude", "current.json"));
  await assert.rejects(manager.install("claude"), /in use/);
  assert.equal(await fs.readFile(installed.executable, "utf8"), "pinned binary");
  assert.deepEqual(await fs.readdir(path.join(root, "ai", "components", "claude", "versions")), ["6.0.0"]);
  manager.release("claude", pinned);
});

test("npm native package integrity is checked and tar extraction rejects traversal and links", async t => {
  const root = await fixture(t);
  const archive = tarGz([{ name: "package/codex.exe", data: "synthetic codex payload" }]);
  const manager = runtimeManager({ root, platform: "win32", arch: "x64", fetchImpl: codexFetch(() => "0.9.0", () => archive) }, "openai");
  const installed = await manager.install("codex");
  assert.equal(installed.version, "0.9.0");
  assert.equal(await fs.readFile(installed.executable, "utf8"), "synthetic codex payload");

  for (const entry of [
    { name: "package/../../escaped.exe", data: "bad" },
    { name: "package/link", data: "../escaped.exe", type: "2" },
    { name: "package/codex.exe:payload", data: "alternate data stream" },
    { name: "package/trailing.", data: "trailing dot alias" },
    { name: "package/trailing ", data: "trailing space alias" },
    { name: "package/NUL.txt", data: "reserved device" },
    { name: "package/CON", data: "reserved device" },
    { name: "package/LPT1.exe", data: "reserved device with extension" },
    { name: "package/control\u0001.exe", data: "control character" },
    { name: "package/bad|name.exe", data: "invalid Windows path character" },
  ]) {
    const archivePath = path.join(root, `bad-${Math.random()}.tgz`);
    const extractPath = path.join(root, `extract-${Math.random()}`);
    await fs.writeFile(archivePath, tarGz([entry]));
    await assert.rejects(extractTarGz(archivePath, extractPath, 1024), /unsafe .*path|outside|link|special/i);
  }
  assert.equal(await manager.resolve("codex"), installed.executable);
});

function compressedGrokManager(options, archive, { integrity = sri512(archive), compression = "brotli" } = {}) {
  const manager = new RuntimeManager({ ...options, platform: "win32", arch: "x64", fetchImpl: async () => response(archive) });
  manager.registerRuntime({
    id: "grok", executable: "grok.exe", allowedHosts: ["registry.npmjs.org"],
    resolveRelease: async () => ({ version: "1.0.46", url: "https://registry.npmjs.org/grok-fixture.tgz", artifact: "tar.gz", integrity, executableCompression: compression }),
  });
  return manager;
}

test("checksummed Grok archives materialize Brotli executables and remain reinstallable", async t => {
  const root = await fixture(t);
  const executable = Buffer.from("MZ synthetic Grok native executable");
  const archive = tarGz([
    { name: "package/bin/grok.exe.br", data: zlib.brotliCompressSync(executable) },
    { name: "package/notices.txt", data: "preserved package notices" },
  ]);
  const manager = compressedGrokManager({ root }, archive);
  const installed = await manager.install("grok");
  assert.equal(installed.status, "installed");
  assert.deepEqual(await fs.readFile(installed.executable), executable);
  assert.equal(installed.totalInstalledBytes, executable.length + Buffer.byteLength("preserved package notices"));
  await assert.rejects(fs.stat(`${installed.executable}.br`), { code: "ENOENT" });
  const restarted = compressedGrokManager({ root }, archive);
  assert.equal((await restarted.detect("grok")).executable, installed.executable);
  await restarted.remove("grok");
  const reinstalled = await restarted.install("grok");
  assert.deepEqual(await fs.readFile(reinstalled.executable), executable);

  // Older official platform packages can contain an already materialized exe.
  const legacyRoot = await fixture(t);
  const legacy = compressedGrokManager({ root: legacyRoot }, tarGz([{ name: "package/bin/grok.exe", data: executable }]));
  assert.deepEqual(await fs.readFile((await legacy.install("grok")).executable), executable);
});

test("Brotli materialization verifies archive integrity first and rejects corrupt or oversized binaries", async t => {
  for (const scenario of ["checksum", "corrupt", "oversized"]) {
    const root = await fixture(t);
    const compressed = scenario === "oversized" ? zlib.brotliCompressSync(Buffer.alloc(8192, 65)) : Buffer.from("invalid Brotli payload");
    const archive = tarGz([{ name: "package/bin/grok.exe.br", data: compressed }]);
    const manager = compressedGrokManager({ root, maxExtractedBytes: 2048 }, archive,
      scenario === "checksum" ? { integrity: sri512(Buffer.from("different package")) } : {});
    await assert.rejects(manager.install("grok"), scenario === "checksum" ? /checksum/ : scenario === "oversized" ? /extraction limit/ : /brotli|decompress/i);
    assert.equal(await manager.resolve("grok"), null);
    assert.deepEqual(await fs.readdir(path.join(root, "ai", "components", "grok", "versions")), []);
  }
});

test("runtime release metadata rejects undeclared executable compression formats", async t => {
  const root = await fixture(t);
  const manager = compressedGrokManager({ root }, Buffer.from("unused"), { compression: "zip" });
  await assert.rejects(manager.info("grok"), /compression is unsupported/);
});

test("Kimi metadata and downloads fall back only across official mirrors and retain manifest checksum verification", async t => {
  const root = await fixture(t);
  const binary = Buffer.from("synthetic Kimi Code payload");
  const calls = [];
  const manager = runtimeManager({ root, platform: "win32", arch: "x64", fetchImpl: kimiFetch(() => "2.1.1", () => binary, { calls }) }, "moonshot");

  const info = await manager.info("kimi");
  assert.equal(info.latestVersion, "2.1.1");
  assert.equal(info.source, null);
  assert.ok(calls.some(call => call.host === "code.kimi.com" && call.pathname.endsWith("/latest")));
  assert.ok(calls.some(call => call.host === "code.kimi.ai" && call.pathname.endsWith("/manifest.json")));

  const installed = await manager.install("kimi");
  assert.equal(installed.version, "2.1.1");
  assert.equal(installed.source, "managed");
  assert.deepEqual(await fs.readFile(installed.executable), binary);
  assert.ok(calls.some(call => call.host === "code.kimi.ai" && call.pathname.endsWith("/kimi-code-win32-x64.exe")));
});

test("abort during a streamed transfer removes staging and preserves no partial install", async t => {
  const root = await fixture(t);
  let binaryOptions;
  let streamController;
  const manager = runtimeManager({
    root,
    platform: "win32",
    arch: "x64",
    fetchImpl: claudeFetch(() => "3.0.0", () => Buffer.from("unused"), {
      onBinary: options => { binaryOptions = options; },
    }),
  });
  const originalFetch = manager.fetchImpl;
  manager.fetchImpl = async (url, options) => {
    if (url.endsWith("/claude.exe")) {
      binaryOptions = options;
      return new Response(new ReadableStream({ start(controller) {
        streamController = controller;
        options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
      } }));
    }
    return originalFetch(url, options);
  };
  const controller = new AbortController();
  const pending = manager.install("claude", { signal: controller.signal });
  while (!streamController) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort(new Error("test abort"));
  await assert.rejects(pending, /abort/i);
  assert.equal(await manager.resolve("claude"), null);
  const versions = path.join(root, "ai", "components", "claude", "versions");
  assert.deepEqual(await fs.readdir(versions), []);
});

test("system PATH executables are detected and remove never deletes them", async t => {
  const root = await fixture(t);
  const bin = path.join(root, "system-bin");
  await fs.mkdir(bin);
  const external = path.join(bin, "kimi.exe");
  await fs.writeFile(external, "test fixture");
  const manager = runtimeManager({ root: path.join(root, "userdata"), platform: "win32", env: { PATH: bin, USERPROFILE: root }, fetchImpl: async () => { throw new Error("No network expected"); } }, "moonshot");
  const found = await manager.detect("kimi");
  assert.equal(found.source, "external");
  assert.equal(found.previousVersion, null);
  assert.equal(found.totalInstalledBytes, 0);
  assert.equal(await manager.resolve("kimi"), external);
  assert.deepEqual(await manager.remove("kimi"), { removed: false, source: "external" });
  assert.equal(await fs.readFile(external, "utf8"), "test fixture");
});

test("remove rejects a component directory redirected through a junction", async t => {
  const root = await fixture(t);
  const outside = path.join(root, "outside");
  const userData = path.join(root, "userdata");
  await fs.mkdir(outside);
  await fs.mkdir(path.join(userData, "ai", "components"), { recursive: true });
  const protectedFile = path.join(outside, "keep.txt");
  await fs.writeFile(protectedFile, "keep");
  try { await fs.symlink(outside, path.join(userData, "ai", "components", "codex"), "junction"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("Directory symlinks are unavailable in this Windows environment");
    throw error;
  }
  const manager = runtimeManager({ root: userData, platform: "win32", fetchImpl: async () => { throw new Error("No network expected"); } }, "openai");
  await assert.rejects(manager.remove("codex"), /plain directory|escaped/);
  assert.equal(await fs.readFile(protectedFile, "utf8"), "keep");
});
