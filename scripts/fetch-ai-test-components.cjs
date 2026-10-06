"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ComponentManager } = require("../electron/ai-components.cjs");

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, ".build-cache", "ai-test-components");
const IDS = ["openai", "anthropic", "xai", "google", "deepseek", "moonshot"];
const LOCAL = path.join(ROOT, "ai-connectors", "providers");
let pending;

async function prepareTestComponents() {
  if (pending) return pending;
  pending = (async () => {
    const manager = new ComponentManager({ root: CACHE });
    const descriptors = {};
    for (const id of IDS) {
      const localEntry = path.join(LOCAL, id, "adapter.cjs");
      const useLocalSource = process.env.CI !== "true" && fs.existsSync(localEntry);
      try {
        const state = await manager.detect(id);
        if (state.version) {
          descriptors[id] = manager.load(id);
          continue;
        }
      } catch (error) {
        if (!useLocalSource) throw error;
      }
      // Reuse the nested checkout for fast local development. CI does not include
      // that ignored checkout and always exercises GitHub release verification.
      if (useLocalSource) {
        descriptors[id] = require(localEntry);
        continue;
      }
      await manager.install(id);
      descriptors[id] = manager.load(id);
    }
    if (IDS.some(id => descriptors[id]?.abiVersion !== 1 || descriptors[id]?.provider?.id !== id)) {
      throw new Error("AI test fixtures did not load six ABI v1 provider adapters.");
    }
    return descriptors;
  })();
  try { return await pending; }
  catch (error) { pending = null; throw error; }
}

if (require.main === module) {
  prepareTestComponents().then(() => process.stdout.write("Verified AI test adapters are ready.\n"), error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { prepareTestComponents, IDS, CACHE };
