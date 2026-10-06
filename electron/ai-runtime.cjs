"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const RUNTIME_IDS = Object.freeze(["codex", "claude", "grok", "agy", "kimi"]);
const DEFAULT_DOWNLOAD_LIMIT = 512 * 1024 * 1024;
const DEFAULT_EXTRACT_LIMIT = 1024 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const METADATA_TIMEOUT_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
function validId(id) {
  if (!RUNTIME_IDS.includes(id)) throw new Error(`Unknown AI runtime: ${String(id)}`);
  return id;
}

function validVersion(version) {
  const text = String(version || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(text) || text === "." || text === "..") throw new Error("Release version is invalid");
  return text;
}

function within(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
}

function parseJson(buffer, label) {
  try { return JSON.parse(buffer.toString("utf8")); }
  catch { throw new Error(`${label} metadata is invalid`); }
}

function responseError(status) {
  return new Error(`Download request failed (HTTP ${status})`);
}

function metadataText(text, label) {
  if (typeof text !== "string") throw new Error(`${label} version is invalid`);
  const value = text.trim();
  if (!value || value.length > 128 || /[\r\n/\\]/.test(value)) throw new Error(`${label} version is invalid`);
  return validVersion(value);
}

function parseSRI(value) {
  if (typeof value !== "string") throw new Error("Package metadata has no integrity value");
  const item = value.trim().split(/\s+/).find(part => part.startsWith("sha512-"));
  if (!item) throw new Error("Package integrity must use SHA-512");
  const digest = item.slice("sha512-".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(digest)) throw new Error("Package integrity value is invalid");
  return { algorithm: "sha512", expected: Buffer.from(digest, "base64") };
}

function parseHexDigest(value, algorithm) {
  const length = algorithm === "sha512" ? 128 : 64;
  if (typeof value !== "string" || !new RegExp(`^[a-fA-F0-9]{${length}}$`).test(value)) throw new Error(`${algorithm.toUpperCase()} checksum is invalid`);
  return { algorithm, expected: Buffer.from(value, "hex") };
}

function verifyDigest(actual, expected) {
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function hashFile(filePath, algorithm) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest();
}

async function directoryBytes(directory) {
  let total = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) total += (await fsp.lstat(target)).size;
    }
  }
  return total;
}

function safeTarPath(raw) {
  if (typeof raw !== "string" || !raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw) || raw.includes("\\") || raw.startsWith("/")) throw new Error("Archive contains an unsafe path");
  const rawComponents = raw.split("/");
  if (rawComponents.some(part => part === "" || part === "." || part === "..")) throw new Error("Archive contains an unsafe path");
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) throw new Error("Archive contains a path outside its install directory");
  const components = normalized.split("/");
  const invalidWindowsName = part => {
    if (!part || part === "." || part === ".." || /[<>:"|?*]/.test(part) || /[. ]$/.test(part)) return true;
    // Windows treats these device names as reserved even when an extension follows.
    const stem = part.split(".", 1)[0].replace(/[ .]+$/g, "");
    return /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])$/i.test(stem);
  };
  if (components.some(invalidWindowsName)) throw new Error("Archive contains an unsafe Windows path component");
  if (components[0] === "package") components.shift();
  if (!components.length) return "";
  return components.join(path.sep);
}

class ByteReader {
  constructor(iterable) { this.iterator = iterable[Symbol.asyncIterator](); this.chunk = Buffer.alloc(0); this.offset = 0; this.done = false; }
  async _fill() {
    while (this.offset >= this.chunk.length && !this.done) {
      const next = await this.iterator.next();
      if (next.done) { this.done = true; this.chunk = Buffer.alloc(0); this.offset = 0; }
      else { this.chunk = Buffer.from(next.value); this.offset = 0; }
    }
  }
  async readExact(length, allowEof = false) {
    const parts = [];
    let got = 0;
    while (got < length) {
      await this._fill();
      if (this.done) {
        if (allowEof && got === 0) return null;
        throw new Error("Archive ended unexpectedly");
      }
      const take = Math.min(length - got, this.chunk.length - this.offset);
      parts.push(this.chunk.subarray(this.offset, this.offset + take));
      this.offset += take;
      got += take;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, length);
  }
  async transfer(length, writeChunk) {
    let remaining = length;
    while (remaining > 0) {
      await this._fill();
      if (this.done) throw new Error("Archive ended inside a file");
      const take = Math.min(remaining, this.chunk.length - this.offset);
      await writeChunk(this.chunk.subarray(this.offset, this.offset + take));
      this.offset += take;
      remaining -= take;
    }
  }
  async skip(length) { await this.transfer(length, async () => {}); }
  async close() { try { await this.iterator.return?.(); } catch {} }
}

function tarNumber(field) {
  const text = field.toString("ascii").replace(/\0.*$/, "").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error("Archive contains an invalid file size");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Archive file size is invalid");
  return value;
}

function parsePax(buffer) {
  const result = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(32, offset);
    if (space < 0) throw new Error("Archive contains invalid PAX metadata");
    const length = Number(buffer.toString("ascii", offset, space));
    if (!Number.isInteger(length) || length <= space - offset + 1 || offset + length > buffer.length || buffer[offset + length - 1] !== 10) throw new Error("Archive contains invalid PAX metadata");
    const record = buffer.toString("utf8", space + 1, offset + length - 1);
    const equals = record.indexOf("=");
    if (equals <= 0) throw new Error("Archive contains invalid PAX metadata");
    const key = record.slice(0, equals);
    if (key === "path" || key === "size") result[key] = record.slice(equals + 1);
    offset += length;
  }
  return result;
}

async function extractTarGz(archivePath, destination, maxBytes) {
  await fsp.mkdir(destination, { recursive: true });
  const gunzip = fs.createReadStream(archivePath).pipe(zlib.createGunzip());
  const reader = new ByteReader(gunzip);
  let extracted = 0;
  let files = 0;
  let pax = null;
  try {
    while (true) {
      const header = await reader.readExact(512, true);
      if (!header) break;
      if (header.every(byte => byte === 0)) break;
      const type = String.fromCharCode(header[156] || 48);
      const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
      const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/, "");
      let entryName = prefix ? `${prefix}/${name}` : name;
      let size = tarNumber(header.subarray(124, 136));

      if (type === "x" || type === "g") {
        if (size > 64 * 1024) throw new Error("Archive metadata entry is too large");
        const metadata = await reader.readExact(size);
        await reader.skip((512 - (size % 512)) % 512);
        if (type === "g") throw new Error("Archive global metadata is not supported");
        pax = parsePax(metadata);
        continue;
      }
      if (type === "L") {
        if (size > 64 * 1024) throw new Error("Archive path entry is too large");
        entryName = (await reader.readExact(size)).toString("utf8").replace(/\0.*$/, "").replace(/\n$/, "");
        await reader.skip((512 - (size % 512)) % 512);
        pax = { ...(pax || {}), path: entryName };
        continue;
      }
      if (pax?.path !== undefined) entryName = pax.path;
      if (pax?.size !== undefined) {
        if (!/^(0|[1-9][0-9]*)$/.test(pax.size)) throw new Error("Archive has an invalid extended size");
        size = Number(pax.size);
        if (!Number.isSafeInteger(size)) throw new Error("Archive file size is invalid");
      }
      pax = null;
      if (type !== "0" && type !== "\0" && type !== "5") throw new Error("Archive contains a link or unsupported special entry");
      const relative = safeTarPath(entryName.replace(/\/$/, ""));
      if (relative) {
        const target = path.resolve(destination, relative);
        if (!within(destination, target)) throw new Error("Archive contains a path outside its install directory");
        if (type === "5") {
          if (size !== 0) throw new Error("Archive directory entry has content");
          await fsp.mkdir(target, { recursive: true });
        } else {
          extracted += size;
          files++;
          if (extracted > maxBytes || files > 50000) throw new Error("Archive exceeds the extraction limit");
          await fsp.mkdir(path.dirname(target), { recursive: true });
          const handle = await fsp.open(target, "wx", 0o600);
          try { await reader.transfer(size, chunk => handle.write(chunk)); }
          finally { await handle.close(); }
        }
      } else if (type !== "5") {
        throw new Error("Archive entry has an empty path");
      } else if (size) {
        throw new Error("Archive directory entry has content");
      }
      await reader.skip((512 - (size % 512)) % 512);
    }
  } catch (error) {
    gunzip.destroy();
    throw error;
  } finally {
    await reader.close();
  }
  return { extractedBytes: extracted, files };
}

function findNamedExecutable(root, executable, maxDepth = 8) {
  const pending = [[root, 0]];
  while (pending.length) {
    const [folder, depth] = pending.pop();
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(folder, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) return candidate;
      if (entry.isDirectory() && depth < maxDepth) pending.push([candidate, depth + 1]);
    }
  }
  return null;
}

function externalExecutable(executable, env = process.env) {
  if (typeof executable !== "string" || !/^[A-Za-z0-9._-]+\.exe$/i.test(executable)) return null;
  const directDirs = [];
  for (const entry of String(env.PATH || "").split(path.delimiter)) if (entry) directDirs.push(entry.replace(/^"|"$/g, ""));
  if (env.USERPROFILE) directDirs.push(path.join(env.USERPROFILE, ".local", "bin"));
  if (env.HOME) directDirs.push(path.join(env.HOME, ".local", "bin"));
  const seen = new Set();
  for (const folder of directDirs) {
    const key = path.resolve(folder).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const direct = path.join(folder, executable);
    try {
      const stat = fs.lstatSync(direct);
      if (stat.isFile() && !stat.isSymbolicLink()) return direct;
    } catch {}
  }
  return null;
}

class RuntimeManager {
  constructor({ root, fetchImpl = globalThis.fetch, notify = () => {}, platform = process.platform, arch = process.arch, env = process.env, maxDownloadBytes = DEFAULT_DOWNLOAD_LIMIT, maxExtractedBytes = DEFAULT_EXTRACT_LIMIT, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!root || !path.isAbsolute(root)) throw new Error("RuntimeManager requires an absolute userData root");
    if (typeof fetchImpl !== "function") throw new Error("RuntimeManager requires fetch support");
    this.root = path.resolve(root);
    this.runtimeRoot = path.join(this.root, "ai", "components");
    this.fetchImpl = fetchImpl;
    this.notify = typeof notify === "function" ? notify : () => {};
    this.platform = platform;
    this.arch = arch;
    this.env = env;
    this.maxDownloadBytes = maxDownloadBytes;
    this.maxExtractedBytes = maxExtractedBytes;
    this.requestTimeoutMs = requestTimeoutMs;
    this.runtimeDescriptors = new Map();
    this.states = new Map(RUNTIME_IDS.map(id => [id, this._emptyState(id)]));
    this.locks = new Map();
    this.pins = new Map();
    this.pinOrder = new Map();
    this.verified = new Map();
  }

  _emptyState(id) {
    return { id, name: id, status: "unknown", version: null, previousVersion: null, source: null, executable: null, progress: 0, bytes: 0, totalBytes: null, totalInstalledBytes: 0, error: null, pinned: false };
  }

  _componentDir(id) { validId(id); return path.join(this.runtimeRoot, id); }

  registerRuntime(runtime) {
    if (!runtime || typeof runtime !== "object" || !RUNTIME_IDS.includes(runtime.id) ||
        typeof runtime.executable !== "string" || !/^[A-Za-z0-9._-]+\.exe$/i.test(runtime.executable) ||
        !Array.isArray(runtime.allowedHosts) || runtime.allowedHosts.length < 1 || runtime.allowedHosts.length > 12 ||
        runtime.allowedHosts.some(host => typeof host !== "string" || !/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i.test(host)) ||
        typeof runtime.resolveRelease !== "function") throw new Error("Provider runtime descriptor is invalid.");
    this.runtimeDescriptors.set(runtime.id, runtime);
    return runtime;
  }

  runtimeFor(id, runtime) {
    validId(id);
    if (runtime) this.registerRuntime(runtime);
    const descriptor = this.runtimeDescriptors.get(id);
    if (!descriptor) throw new Error("Install this provider adapter before managing its CLI runtime.");
    return descriptor;
  }

  snapshot() {
    const components = RUNTIME_IDS.map(id => ({ ...this.states.get(id), pinned: Boolean(this.pins.get(id)?.size) }));
    return { components, byId: Object.fromEntries(components.map(component => [component.id, component])) };
  }

  _emit(id, patch) {
    const previous = this.states.get(id) || this._emptyState(id);
    const state = { ...previous, ...patch, id, name: id, pinned: Boolean(this.pins.get(id)?.size) };
    this.states.set(id, state);
    try { this.notify({ ...state }); } catch {}
  }

  async _lock(id, work) {
    const before = this.locks.get(id) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const tail = before.catch(() => {}).then(() => gate);
    this.locks.set(id, tail);
    await before.catch(() => {});
    try { return await work(); }
    finally {
      release();
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  _combineSignal(signal, timeoutMs = this.requestTimeoutMs) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason || new Error("Operation aborted"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Network request timed out")), timeoutMs);
    timer.unref?.();
    return { signal: controller.signal, dispose: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
  }

  _assertUrl(id, value) {
    let url;
    try { url = new URL(value); } catch { throw new Error("Release metadata contains an invalid URL"); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Release URL is not trusted");
    const runtime = this.runtimeFor(id);
    if (!runtime.allowedHosts.includes(url.hostname.toLowerCase())) throw new Error("Release URL is outside the provider adapter's allowed hosts");
    return url;
  }

  async _request(id, value, { signal, responseType = "json", maxBytes = MAX_JSON_BYTES } = {}) {
    let url = this._assertUrl(id, value);
    for (let attempt = 0; attempt < 6; attempt++) {
      const combined = this._combineSignal(signal, Math.min(this.requestTimeoutMs, METADATA_TIMEOUT_MS));
      try {
        let response;
        try { response = await this.fetchImpl(url.href, { signal: combined.signal, redirect: "manual" }); }
        catch (error) { throw signal?.aborted ? (signal.reason || new Error("Operation aborted")) : error; }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers?.get?.("location");
          if (!location) throw new Error("Release server returned an invalid redirect");
          url = this._assertUrl(id, new URL(location, url).href);
          continue;
        }
        if (!response.ok) throw responseError(response.status);
        if (response.url) this._assertUrl(id, response.url);
        if (responseType === "text") {
          const reader = response.body?.getReader ? response.body.getReader() : null;
          if (!reader) {
            const text = await response.text();
            if (Buffer.byteLength(text) > maxBytes) throw new Error("Release metadata exceeds the size limit");
            return text;
          }
          const chunks = [];
          let total = 0;
          try {
            while (true) {
              const item = await reader.read();
              if (item.done) break;
              total += item.value.byteLength;
              if (total > maxBytes) throw new Error("Release metadata exceeds the size limit");
              chunks.push(Buffer.from(item.value));
            }
          } finally { reader.releaseLock?.(); }
          return Buffer.concat(chunks, total).toString("utf8");
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes) throw new Error("Release metadata exceeds the size limit");
        return parseJson(buffer, "Release");
      } finally { combined.dispose(); }
    }
    throw new Error("Release server redirected too many times");
  }

  async _download(id, value, destination, { signal, expectedBytes = null } = {}) {
    let url = this._assertUrl(id, value);
    for (let attempt = 0; attempt < 6; attempt++) {
      const combined = this._combineSignal(signal);
      let response;
      try { response = await this.fetchImpl(url.href, { signal: combined.signal, redirect: "manual" }); }
      catch (error) { combined.dispose(); throw signal?.aborted ? (signal.reason || new Error("Operation aborted")) : error; }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        combined.dispose();
        const location = response.headers?.get?.("location");
        if (!location) throw new Error("Release server returned an invalid redirect");
        url = this._assertUrl(id, new URL(location, url).href);
        continue;
      }
      if (!response.ok) { combined.dispose(); throw responseError(response.status); }
      if (response.url) {
        try { this._assertUrl(id, response.url); }
        catch (error) { combined.dispose(); throw error; }
      }
      const declared = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(declared) && declared > this.maxDownloadBytes) { combined.dispose(); throw new Error("Download exceeds the size limit"); }
      if (expectedBytes !== null && Number.isFinite(declared) && declared !== expectedBytes) { combined.dispose(); throw new Error("Download size does not match release metadata"); }
      const progressTotal = expectedBytes || (Number.isFinite(declared) && declared > 0 ? declared : null);
      if (!response.body) { combined.dispose(); throw new Error("Release server returned an empty download"); }
      let handle;
      try {
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        handle = await fsp.open(destination, "wx", 0o600);
      } catch (error) { combined.dispose(); throw error; }
      let bytes = 0;
      let lastNotify = 0;
      const reader = response.body.getReader ? response.body.getReader() : null;
      try {
        if (reader) {
          while (true) {
            if (signal?.aborted) throw signal.reason || new Error("Operation aborted");
            const item = await reader.read();
            if (item.done) break;
            const chunk = Buffer.from(item.value);
            bytes += chunk.length;
            if (bytes > this.maxDownloadBytes) throw new Error("Download exceeds the size limit");
            if (expectedBytes !== null && bytes > expectedBytes) throw new Error("Download is larger than release metadata");
            await handle.write(chunk);
            const now = Date.now();
            if (now - lastNotify >= 200) {
              this._emit(id, { status: "installing", progress: progressTotal ? Math.min(0.99, bytes / progressTotal) : 0, bytes, totalBytes: progressTotal, error: null });
              lastNotify = now;
            }
          }
        } else {
          for await (const item of response.body) {
            if (signal?.aborted) throw signal.reason || new Error("Operation aborted");
            const chunk = Buffer.from(item);
            bytes += chunk.length;
            if (bytes > this.maxDownloadBytes || (expectedBytes !== null && bytes > expectedBytes)) throw new Error("Download exceeds release metadata limits");
            await handle.write(chunk);
            this._emit(id, { status: "installing", progress: progressTotal ? Math.min(0.99, bytes / progressTotal) : 0, bytes, totalBytes: progressTotal, error: null });
          }
        }
      } catch (error) {
        reader?.cancel?.().catch?.(() => {});
        await handle.close();
        await fsp.rm(destination, { force: true });
        combined.dispose();
        throw error;
      }
      await handle.close();
      combined.dispose();
      if (expectedBytes !== null && bytes !== expectedBytes) { await fsp.rm(destination, { force: true }); throw new Error("Download size does not match release metadata"); }
      if (Number.isFinite(declared) && declared > 0 && bytes !== declared) { await fsp.rm(destination, { force: true }); throw new Error("Download size does not match the server content length"); }
      this._emit(id, { status: "installing", progress: 1, bytes, totalBytes: bytes, error: null });
      return bytes;
    }
    throw new Error("Release server redirected too many times");
  }

  async _latestRelease(id, { version, signal, runtime } = {}) {
    const descriptor = this.runtimeFor(id, runtime);
    const release = await descriptor.resolveRelease(
      { platform: this.platform, arch: this.arch, version, componentId: id },
      {
        fetchJson: url => this._request(id, url, { signal }),
        fetchText: url => this._request(id, url, { signal, responseType: "text", maxBytes: 256 * 1024 }),
      },
    );
    if (!release || typeof release !== "object") throw new Error("Provider runtime returned invalid release metadata.");
    const resolvedVersion = validVersion(release.version);
    if (version && resolvedVersion !== validVersion(version)) throw new Error("The requested runtime version is unavailable.");
    const url = this._assertUrl(id, release.url).href;
    if (!["exe", "tar.gz"].includes(release.artifact)) throw new Error("Provider runtime returned an unsupported artifact type.");
    let integrity;
    if (release.checksum && typeof release.checksum === "object" &&
        ["sha256", "sha512"].includes(release.checksum.algorithm)) {
      integrity = parseHexDigest(release.checksum.value, release.checksum.algorithm);
    } else if (typeof release.integrity === "string") {
      integrity = parseSRI(release.integrity);
    } else throw new Error("Provider runtime returned no supported checksum.");
    const executable = release.executable || descriptor.executable;
    if (typeof executable !== "string" || !/^[A-Za-z0-9._-]+\.exe$/i.test(executable)) throw new Error("Provider runtime executable name is invalid.");
    const executableCompression = release.executableCompression;
    if (executableCompression !== undefined && (executableCompression !== "brotli" || release.artifact !== "tar.gz")) throw new Error("Provider runtime executable compression is unsupported.");
    return {
      id, version: resolvedVersion, url, integrity, source: "managed", artifact: release.artifact,
      provenance: String(release.provenance || "provider metadata").slice(0, 300), executable,
      ...(executableCompression ? { executableCompression } : {}),
    };
  }

  async info(id, { runtime } = {}) {
    validId(id);
    const release = await this._latestRelease(id, { runtime });
    const managed = await this._readPointer(id, "current").catch(() => null);
    return { id, latestVersion: release.version, installedVersion: managed?.version || null, updateAvailable: Boolean(managed && managed.version !== release.version), source: managed ? "managed" : null, provenance: release.provenance };
  }

  async _ensureRoot() {
    await fsp.mkdir(this.runtimeRoot, { recursive: true });
    const rootReal = await fsp.realpath(this.root);
    const runtimeReal = await fsp.realpath(this.runtimeRoot);
    if (!within(rootReal, runtimeReal) || runtimeReal === rootReal) throw new Error("AI runtime directory escaped userData");
    return runtimeReal;
  }

  async _assertComponentDirectory(id, create = false) {
    const runtimeReal = await this._ensureRoot();
    const directory = this._componentDir(id);
    if (create) await fsp.mkdir(directory, { recursive: true });
    let stat;
    try { stat = await fsp.lstat(directory); } catch (error) { if (error.code === "ENOENT") return { directory, runtimeReal, exists: false }; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("AI component directory is not a plain directory");
    const real = await fsp.realpath(directory);
    if (!within(runtimeReal, real) || real === runtimeReal) throw new Error("AI component directory escaped the runtime root");
    return { directory, runtimeReal, real, exists: true };
  }

  async _assertVersionsDirectory(id, create = false) {
    const component = await this._assertComponentDirectory(id, create);
    const directory = path.join(component.directory, "versions");
    if (create) await fsp.mkdir(directory, { recursive: true });
    let stat;
    try { stat = await fsp.lstat(directory); } catch (error) { if (error.code === "ENOENT") return { directory, exists: false }; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("AI runtime versions directory is unsafe");
    const real = await fsp.realpath(directory);
    if (!component.real || !within(component.real, real) || real === component.real) throw new Error("AI runtime versions directory escaped its component");
    return { directory, real, exists: true };
  }

  async _removeOwnedStaging(id, staging) {
    const versions = await this._assertVersionsDirectory(id);
    if (!versions.exists) return;
    const target = path.resolve(staging);
    if (path.dirname(target) !== versions.directory || !/^\.staging-[0-9]+-[a-f0-9]{16}$/.test(path.basename(target))) throw new Error("Refusing to remove an unsafe AI runtime staging path");
    let stat;
    try { stat = await fsp.lstat(target); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("AI runtime staging directory is unsafe");
    const real = await fsp.realpath(target);
    if (!within(versions.real, real) || real === versions.real) throw new Error("AI runtime staging directory escaped its versions directory");
    await fsp.rm(real, { recursive: true, force: false, maxRetries: 2, retryDelay: 50 });
  }

  async _readPointer(id, which) {
    const { directory, exists } = await this._assertComponentDirectory(id);
    if (!exists) return null;
    const pointerPath = path.join(directory, which === "current" ? "current.json" : "previous.json");
    let stat;
    try { stat = await fsp.lstat(pointerPath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new Error("AI runtime pointer is unsafe");
    const pointer = parseJson(await fsp.readFile(pointerPath), "AI runtime pointer");
    if (pointer.schema !== 1 || pointer.id !== id || pointer.source !== "managed" || typeof pointer.version !== "string" || typeof pointer.executable !== "string" || typeof pointer.sha256 !== "string") throw new Error("AI runtime pointer is invalid");
    const version = validVersion(pointer.version);
    const versionRoot = path.resolve(directory, "versions", version);
    const executable = path.resolve(versionRoot, pointer.executable);
    if (!within(versionRoot, executable) || !pointer.executable || pointer.executable.split(/[\\/]/).some(part => part === ".." || part === ".")) throw new Error("AI runtime executable path is unsafe");
    let binaryStat;
    try {
      const [versionStat, executableStat] = await Promise.all([fsp.lstat(versionRoot), fsp.lstat(executable)]);
      binaryStat = executableStat;
      if (!versionStat.isDirectory() || versionStat.isSymbolicLink() || !binaryStat.isFile() || binaryStat.isSymbolicLink()) return null;
      const [versionReal, binaryReal, runtimeReal] = await Promise.all([fsp.realpath(versionRoot), fsp.realpath(executable), fsp.realpath(this.runtimeRoot)]);
      if (!within(runtimeReal, versionReal) || !within(versionReal, binaryReal)) return null;
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const cached = this.verified.get(executable);
    if (!(cached && cached.size === binaryStat.size && cached.mtimeMs === binaryStat.mtimeMs && cached.ctimeMs === binaryStat.ctimeMs && cached.sha256 === pointer.sha256)) {
      const sha = await hashFile(executable, "sha256");
      if (sha.toString("hex") !== pointer.sha256) return null;
      this.verified.set(executable, { size: binaryStat.size, mtimeMs: binaryStat.mtimeMs, ctimeMs: binaryStat.ctimeMs, sha256: pointer.sha256 });
    }
    return { ...pointer, executablePath: executable };
  }

  async _retainedVersions(id, current) {
    if (!current) return { previous: null, currentBytes: 0, previousBytes: 0 };
    let previous = null;
    try { previous = await this._readPointer(id, "previous"); } catch {}
    if (!previous || previous.version === current.version) previous = null;
    const bytesFor = async pointer => {
      if (!pointer) return 0;
      if (Number.isSafeInteger(pointer.bytes) && pointer.bytes >= 0) return pointer.bytes;
      const component = await this._assertComponentDirectory(id);
      if (!component.exists) return 0;
      const versionsDir = path.join(component.directory, "versions");
      const resolved = path.resolve(versionsDir, validVersion(pointer.version));
      if (!within(versionsDir, resolved) || resolved === versionsDir) return 0;
      return directoryBytes(resolved);
    };
    const currentBytes = await bytesFor(current);
    const previousBytes = await bytesFor(previous);
    return { previous, currentBytes, previousBytes };
  }

  async detect(id, { runtime } = {}) {
    validId(id);
    const descriptor = this.runtimeFor(id, runtime);
    let managed = null;
    try { managed = await this._readPointer(id, "current"); } catch (error) {
      this._emit(id, { status: "error", version: null, previousVersion: null, source: null, executable: null, bytes: 0, totalBytes: null, totalInstalledBytes: 0, error: error.message });
      throw error;
    }
    if (managed) {
      const retained = await this._retainedVersions(id, managed);
      this._emit(id, { status: "installed", version: managed.version, previousVersion: retained.previous?.version || null, source: "managed", executable: managed.executablePath, progress: 1, bytes: retained.currentBytes, totalBytes: retained.currentBytes, totalInstalledBytes: retained.currentBytes + retained.previousBytes, error: null });
      return { ...this.states.get(id) };
    }
    const external = externalExecutable(descriptor.executable, this.env);
    if (external) {
      this._emit(id, { status: "installed", version: null, previousVersion: null, source: "external", executable: external, progress: 1, bytes: 0, totalBytes: null, totalInstalledBytes: 0, error: null });
    } else {
      this._emit(id, { status: "available", version: null, previousVersion: null, source: null, executable: null, progress: 0, bytes: 0, totalBytes: null, totalInstalledBytes: 0, error: null });
    }
    return { ...this.states.get(id) };
  }

  async resolve(id, { runtime } = {}) {
    const found = await this.detect(id, { runtime });
    return found.executable || null;
  }

  async _atomicJson(target, object) {
    const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    const handle = await fsp.open(temp, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(object, null, 2)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await fsp.rename(temp, target);
  }

  async _findInstalledExe(id, root, executable) {
    const exe = findNamedExecutable(root, executable);
    if (!exe) throw new Error(`Runtime archive did not contain ${executable}`);
    const stat = await fsp.lstat(exe);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("AI runtime executable is not a regular file");
    const realRoot = await fsp.realpath(root);
    const realExe = await fsp.realpath(exe);
    if (!within(realRoot, realExe)) throw new Error("AI runtime executable escaped its install directory");
    return path.relative(root, exe);
  }

  async _materializeExecutable(id, root, release) {
    if (release.executableCompression !== "brotli" || findNamedExecutable(root, release.executable)) return;
    // Only the adapter's declared executable may be materialized, after the
    // complete package has passed its official archive-integrity check.
    const relative = await this._findInstalledExe(id, root, `${release.executable}.br`);
    const source = path.join(root, relative);
    const target = source.slice(0, -3);
    const compressedBytes = (await fsp.stat(source)).size;
    const retainedBytes = (await directoryBytes(root)) - compressedBytes;
    const maxOutputBytes = this.maxExtractedBytes - retainedBytes;
    let outputBytes = 0;
    const limit = new Transform({
      transform(chunk, encoding, callback) {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) callback(new Error("Runtime executable exceeds the extraction limit"));
        else callback(null, chunk);
      },
    });
    await pipeline(
      fs.createReadStream(source),
      zlib.createBrotliDecompress(),
      limit,
      fs.createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    if (!outputBytes) throw new Error("Runtime executable decompressed to an empty file");
    await fsp.rm(source, { force: false });
  }

  async _cleanupVersions(id) {
    const component = await this._assertComponentDirectory(id);
    if (!component.exists) return;
    const versionsDir = path.join(component.directory, "versions");
    const keep = new Set();
    for (const which of ["current", "previous"]) {
      try { const pointer = await this._readPointer(id, which); if (pointer) keep.add(pointer.version); } catch {}
    }
    for (const exe of this.pins.get(id)?.keys() || []) {
      const rel = path.relative(versionsDir, exe);
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) keep.add(rel.split(path.sep)[0]);
    }
    let entries;
    try { entries = await fsp.readdir(versionsDir, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".staging-")) continue;
      if (!keep.has(entry.name)) await this._safeRemoveVersion(id, entry.name);
    }
  }

  async _safeRemoveVersion(id, version) {
    const safeVersion = validVersion(version);
    const versions = await this._assertVersionsDirectory(id);
    if (!versions.exists) return;
    const versionsDir = versions.directory;
    const target = path.resolve(versionsDir, safeVersion);
    if (!within(versionsDir, target) || target === versionsDir) throw new Error("Refusing to remove an unsafe AI runtime path");
    let stat;
    try { stat = await fsp.lstat(target); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Refusing to remove a linked AI runtime directory");
    const realTarget = await fsp.realpath(target);
    if (!within(versions.real, realTarget) || realTarget === versions.real) throw new Error("AI runtime removal escaped its directory");
    await fsp.rm(target, { recursive: true, force: false, maxRetries: 2, retryDelay: 50 });
  }

  async install(id, { signal, version, runtime } = {}) {
    validId(id);
    const descriptor = this.runtimeFor(id, runtime);
    return this._lock(id, async () => {
      if (this.platform !== "win32") throw new Error("AI runtime installation is supported on Windows only");
      if (signal?.aborted) throw signal.reason || new Error("Operation aborted");
      this._emit(id, { status: "installing", progress: 0, bytes: 0, totalBytes: null, error: null });
      let staging = null;
      let promotedVersion = null;
      let quarantined = null;
      let pointerPublished = false;
      try {
        await this._assertComponentDirectory(id, true);
        const release = await this._latestRelease(id, { version, signal, runtime: descriptor });
        const componentDir = this._componentDir(id);
        const existing = await this._readPointer(id, "current").catch(() => null);
        if (existing?.version === release.version) {
          const retained = await this._retainedVersions(id, existing);
          this._emit(id, { status: "installed", source: "managed", version: existing.version, previousVersion: retained.previous?.version || null, executable: existing.executablePath, progress: 1, bytes: retained.currentBytes, totalBytes: retained.currentBytes, totalInstalledBytes: retained.currentBytes + retained.previousBytes, error: null });
          return { ...this.states.get(id) };
        }
        const versions = await this._assertVersionsDirectory(id, true);
        const versionsDir = versions.directory;
        const stageName = `.staging-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
        staging = path.join(versionsDir, stageName);
        await fsp.mkdir(staging, { recursive: false });
        const payloadPath = path.join(staging, release.artifact === "tar.gz" ? "runtime.tgz" : release.executable);
        const downloadUrls = [release.url, ...(Array.isArray(release.fallbackUrls) ? release.fallbackUrls : [])];
        let bytes;
        let downloadError;
        for (let index = 0; index < downloadUrls.length; index++) {
          try {
            bytes = await this._download(id, downloadUrls[index], payloadPath, { signal });
            break;
          } catch (error) {
            downloadError = error;
            await fsp.rm(payloadPath, { force: true }).catch(() => {});
            if (signal?.aborted || index === downloadUrls.length - 1) throw error;
          }
        }
        if (bytes === undefined) throw downloadError || new Error("AI runtime download failed");
        const actualHash = await hashFile(payloadPath, release.integrity.algorithm);
        if (!verifyDigest(actualHash, release.integrity.expected)) throw new Error("Downloaded runtime checksum does not match official metadata");

        const payloadRoot = path.join(staging, "payload");
        if (release.artifact === "tar.gz") {
          await extractTarGz(payloadPath, payloadRoot, this.maxExtractedBytes);
          await fsp.rm(payloadPath, { force: true });
        } else {
          await fsp.mkdir(payloadRoot, { recursive: true });
          await fsp.rename(payloadPath, path.join(payloadRoot, release.executable));
        }
        await this._materializeExecutable(id, payloadRoot, release);
        const executableRelativeInPayload = await this._findInstalledExe(id, payloadRoot, release.executable);
        const versionDir = path.join(versionsDir, release.version);
        const previousPointer = await this._readPointer(id, "current").catch(() => null);
        let targetExists = false;
        let reusable = null;
        try {
          const stat = await fsp.lstat(versionDir);
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Version directory is unsafe");
          const real = await fsp.realpath(versionDir);
          if (!within(versions.real, real) || real === versions.real) throw new Error("Version directory escaped its versions directory");
          targetExists = true;
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (!targetExists) {
          await fsp.rename(payloadRoot, versionDir);
          promotedVersion = release.version;
        }
        else {
          // Keep verified current/previous releases. An orphan is replaced only
          // after the newly downloaded package and executable have verified.
          reusable = previousPointer?.version === release.version ? previousPointer : await this._readPointer(id, "previous").catch(() => null);
          if (reusable?.version !== release.version) {
            reusable = null;
            if ([...(this.pins.get(id)?.keys() || [])].some(exe => within(versionDir, exe))) throw new Error("Release version directory is in use and cannot be replaced");
            const quarantine = { path: path.join(staging, "orphan"), target: versionDir, version: release.version };
            await fsp.rename(versionDir, quarantine.path);
            quarantined = quarantine;
            await fsp.rename(payloadRoot, versionDir);
            promotedVersion = release.version;
          }
        }
        const finalExe = path.join(versionDir, reusable ? reusable.executable : executableRelativeInPayload);
        const finalHash = (await hashFile(finalExe, "sha256")).toString("hex");
        const finalStat = await fsp.stat(finalExe);
        this.verified.set(finalExe, { size: finalStat.size, mtimeMs: finalStat.mtimeMs, ctimeMs: finalStat.ctimeMs, sha256: finalHash });
        const installedBytes = reusable?.bytes ?? await directoryBytes(versionDir);
        const pointer = { schema: 1, id, version: release.version, source: "managed", executable: path.relative(versionDir, finalExe), sha256: finalHash, integrity: `${release.integrity.algorithm}:${release.integrity.expected.toString("hex")}`, provenance: release.provenance, installedAt: new Date().toISOString(), bytes: installedBytes };
        const currentPath = path.join(componentDir, "current.json");
        const previousPath = path.join(componentDir, "previous.json");
        const oldPrevious = await this._readPointer(id, "previous").catch(() => null);
        let previousChanged = false;
        try {
          if (previousPointer && previousPointer.version !== release.version) {
            await this._atomicJson(previousPath, this._pointerForDisk(previousPointer));
            previousChanged = true;
          } else if (!previousPointer) {
            await fsp.rm(previousPath, { force: true });
            previousChanged = true;
          }
          await this._atomicJson(currentPath, pointer);
          pointerPublished = true;
        } catch (error) {
          if (previousChanged) {
            if (oldPrevious) await this._atomicJson(previousPath, this._pointerForDisk(oldPrevious)).catch(() => {});
            else await fsp.rm(previousPath, { force: true }).catch(() => {});
          }
          throw error;
        }
        await this._removeOwnedStaging(id, staging);
        staging = null;
        await this._cleanupVersions(id).catch(() => {});
        const previousBytes = previousPointer && previousPointer.version !== release.version
          ? (Number.isSafeInteger(previousPointer.bytes) && previousPointer.bytes >= 0 ? previousPointer.bytes : await directoryBytes(path.join(versionsDir, previousPointer.version)))
          : 0;
        this._emit(id, { status: "installed", source: "managed", version: release.version, previousVersion: previousBytes ? previousPointer.version : (previousPointer && previousPointer.version !== release.version ? previousPointer.version : null), executable: finalExe, progress: 1, bytes: installedBytes, totalBytes: installedBytes, totalInstalledBytes: installedBytes + previousBytes, error: null });
        return { ...this.states.get(id) };
      } catch (error) {
        let preserveStaging = false;
        if (quarantined && !pointerPublished) {
          try {
            if (promotedVersion) await this._safeRemoveVersion(id, promotedVersion);
            await fsp.rename(quarantined.path, quarantined.target);
            promotedVersion = null;
          } catch (restoreError) {
            // Keep the quarantined original if an OS lock prevents recovery.
            preserveStaging = true;
            error = new Error(`${error.message}; original runtime directory preserved for recovery (${restoreError.code || "restore failed"})`);
          }
        }
        if (staging && !preserveStaging) await this._removeOwnedStaging(id, staging).catch(() => {});
        const installed = await this._readPointer(id, "current").catch(() => null);
        if (promotedVersion && installed?.version !== promotedVersion && !this.pins.get(id)?.size) {
          await this._safeRemoveVersion(id, promotedVersion).catch(() => {});
        }
        const retained = installed ? await this._retainedVersions(id, installed) : { previous: null, currentBytes: 0, previousBytes: 0 };
        this._emit(id, installed ? { status: "installed", source: "managed", version: installed.version, previousVersion: retained.previous?.version || null, executable: installed.executablePath, bytes: retained.currentBytes, totalBytes: retained.currentBytes, totalInstalledBytes: retained.currentBytes + retained.previousBytes, error: error.message } : { status: "error", source: null, version: null, previousVersion: null, executable: null, totalInstalledBytes: 0, error: error.message });
        throw error;
      }
    });
  }

  _pointerForDisk(pointer) {
    const { executablePath, ...stored } = pointer;
    return stored;
  }

  async rollback(id, { runtime } = {}) {
    validId(id);
    this.runtimeFor(id, runtime);
    return this._lock(id, async () => {
      const current = await this._readPointer(id, "current");
      const previous = await this._readPointer(id, "previous");
      if (!previous) throw new Error(`${id} has no previous managed version`);
      const componentDir = this._componentDir(id);
      const previousPath = path.join(componentDir, "previous.json");
      await this._atomicJson(previousPath, this._pointerForDisk(current));
      try { await this._atomicJson(path.join(componentDir, "current.json"), this._pointerForDisk(previous)); }
      catch (error) {
        await this._atomicJson(previousPath, this._pointerForDisk(previous)).catch(() => {});
        throw error;
      }
      await this._cleanupVersions(id).catch(() => {});
      const retained = await this._retainedVersions(id, previous);
      this._emit(id, { status: "installed", source: "managed", version: previous.version, previousVersion: retained.previous?.version || null, executable: previous.executablePath, progress: 1, bytes: retained.currentBytes, totalBytes: retained.currentBytes, totalInstalledBytes: retained.currentBytes + retained.previousBytes, error: null });
      return { ...this.states.get(id) };
    });
  }

  async remove(id, { runtime } = {}) {
    validId(id);
    const descriptor = this.runtimeFor(id, runtime);
    return this._lock(id, async () => {
      if (this.pins.get(id)?.size) throw new Error(`${id} is in use and cannot be removed`);
      const component = await this._assertComponentDirectory(id);
      if (!component.exists) {
        const external = externalExecutable(descriptor.executable, this.env);
        this._emit(id, external ? { status: "installed", source: "external", version: null, previousVersion: null, executable: external, progress: 1, bytes: 0, totalBytes: null, totalInstalledBytes: 0, error: null } : { status: "available", source: null, version: null, previousVersion: null, executable: null, progress: 0, bytes: 0, totalBytes: null, totalInstalledBytes: 0, error: null });
        return { removed: false, source: external ? "external" : null };
      }
      const managed = await this._readPointer(id, "current").catch(() => null);
      if (!managed) {
        const external = externalExecutable(descriptor.executable, this.env);
        this._emit(id, external ? { status: "installed", source: "external", version: null, previousVersion: null, executable: external, progress: 1, bytes: 0, totalBytes: null, totalInstalledBytes: 0, error: null } : { status: "available", source: null, version: null, previousVersion: null, executable: null, progress: 0, bytes: 0, totalBytes: null, totalInstalledBytes: 0, error: null });
        return { removed: false, source: external ? "external" : null };
      }
      const currentPath = path.join(component.directory, "current.json");
      const previousPath = path.join(component.directory, "previous.json");
      await fsp.rm(currentPath, { force: true });
      await fsp.rm(previousPath, { force: true });
      await this._cleanupVersions(id);
      this._emit(id, { status: "available", source: null, version: null, previousVersion: null, executable: null, progress: 0, bytes: 0, totalBytes: null, totalInstalledBytes: 0, error: null });
      return { removed: true, source: "managed" };
    });
  }

  async pin(id, { runtime } = {}) {
    validId(id);
    this.runtimeFor(id, runtime);
    return this._lock(id, async () => {
      const executable = await this.resolve(id, { runtime });
      if (!executable) throw new Error(`${id} is not installed`);
      let pins = this.pins.get(id);
      if (!pins) this.pins.set(id, pins = new Map());
      pins.set(executable, (pins.get(executable) || 0) + 1);
      let order = this.pinOrder.get(id);
      if (!order) this.pinOrder.set(id, order = []);
      order.push(executable);
      this._emit(id, { pinned: true });
      return executable;
    });
  }

  release(id, executable = null) {
    validId(id);
    const pins = this.pins.get(id);
    if (!pins?.size) return false;
    const order = this.pinOrder.get(id) || [];
    const index = executable ? order.indexOf(executable) : 0;
    if (index < 0 || index >= order.length) return false;
    const pinnedExecutable = order.splice(index, 1)[0];
    const count = pins.get(pinnedExecutable) || 0;
    if (count <= 1) pins.delete(pinnedExecutable); else pins.set(pinnedExecutable, count - 1);
    if (!pins.size) this.pins.delete(id);
    if (!order.length) this.pinOrder.delete(id);
    this._emit(id, { pinned: Boolean(this.pins.get(id)?.size) });
    this._lock(id, () => this._cleanupVersions(id)).catch(() => {});
    return true;
  }
}

module.exports = { RuntimeManager, RUNTIME_IDS, extractTarGz, safeTarPath };
