"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ComponentManager } = require("../electron/ai-components.cjs");

const PROVIDER_IDS = new Set(["openai", "anthropic", "xai", "google", "deepseek", "moonshot"]);
const REQUIRED_FILES = [
  "adapter.cjs",
  "providers/{id}/adapter.cjs",
  "lib/provider-adapter.cjs",
  "lib/provider-common.cjs",
  "lib/runtime-recipes.cjs",
];
const REPOSITORY = "yechankun/streamer-assist-ai-connectors";

function regularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}

function assertFiles(root, id, { rootWrapper = true } = {}) {
  for (const relative of REQUIRED_FILES) {
    if (!rootWrapper && relative === "adapter.cjs") continue;
    const file = path.join(root, relative.replace("{id}", id));
    if (!regularFile(file)) throw new Error(`Verified AI component fixture is missing a regular file: ${relative}`);
  }
}

function cacheVersion(id, cacheRoot) {
  const componentRoot = path.join(cacheRoot, "ai", "adapters", id);
  const pointerFile = path.join(componentRoot, "current.json");
  if (!regularFile(pointerFile)) return null;
  const stat = fs.lstatSync(pointerFile);
  if (stat.size > 32 * 1024) throw new Error("AI component fixture cache pointer is too large.");
  const stored = fs.readFileSync(pointerFile, "utf8");
  if (!stored.startsWith("plain:v1:")) throw new Error("AI component fixture cache must be prepared by the plain Node CI helper.");
  let pointer;
  try { pointer = JSON.parse(stored.slice("plain:v1:".length)); }
  catch { throw new Error("AI component fixture cache pointer is invalid JSON."); }
  if (pointer?.schemaVersion !== 1 || pointer.id !== id || pointer.source !== "github" ||
      pointer.repository !== REPOSITORY || pointer.releaseTag !== `${id}-v${pointer.version}` ||
      typeof pointer.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(pointer.version)) {
    throw new Error("AI component fixture cache pointer does not match the expected GitHub component.");
  }
  return pointer.version;
}

function resolveProviderSource(id, { repositoryRoot = path.resolve(__dirname, ".."), cacheRoot = path.join(repositoryRoot, ".build-cache", "ai-test-components") } = {}) {
  if (!PROVIDER_IDS.has(id)) throw new Error(`Unknown AI component fixture: ${String(id)}`);

  const localRoot = path.join(repositoryRoot, "ai-connectors");
  try {
    assertFiles(localRoot, id, { rootWrapper: false });
    return { root: localRoot, version: null, source: "checkout" };
  } catch (error) {
    if (error.code !== "ENOENT" && !/missing a regular file/.test(error.message)) throw error;
  }

  const version = cacheVersion(id, cacheRoot);
  if (!version) throw new Error(`AI component fixture ${id} is missing; run scripts/fetch-ai-test-components.cjs first.`);
  const versionRoot = path.join(cacheRoot, "ai", "adapters", id, "versions", version);
  const versionReal = fs.realpathSync(versionRoot);
  const versionsReal = fs.realpathSync(path.join(cacheRoot, "ai", "adapters", id, "versions"));
  const relative = path.relative(versionsReal, versionReal);
  if (!relative || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`)) throw new Error("AI component fixture cache escaped its managed versions directory.");

  // Reuse the real manager's pointer, package hash, extracted-file hash, and
  // descriptor checks before the smoke test copies these bytes into its local
  // mocked release fixture.
  const manager = new ComponentManager({ root: cacheRoot });
  const adapter = manager.load(id);
  if (adapter?.abiVersion !== 1 || adapter?.provider?.id !== id) throw new Error(`Verified AI component fixture ${id} has an invalid descriptor.`);
  assertFiles(versionRoot, id);
  return { root: versionRoot, version, source: "verified-cache" };
}

module.exports = { resolveProviderSource };
