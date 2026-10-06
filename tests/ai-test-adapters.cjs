"use strict";

let loading;

function loadTestAdapters() {
  if (!loading) loading = require("../scripts/fetch-ai-test-components.cjs").prepareTestComponents();
  return loading;
}

function fakeComponentManager(descriptors, version = "test-verified") {
  const rows = Object.fromEntries(Object.keys(descriptors).map(id => [id, { id, status: "ready", version, source: "test-fixture", progress: 1, bytes: 0, totalInstalledBytes: 0 }]));
  return {
    snapshot: () => ({ components: Object.values(rows), byId: { ...rows } }),
    async detect(id) { return rows[id] || { id, status: "not-installed" }; },
    async update(id) { return rows[id] || { id, status: "not-installed" }; },
    load(id) { return descriptors[id] || null; },
    async pin(id) {
      const adapter = descriptors[id];
      if (!adapter) throw new Error("Test adapter is unavailable.");
      return { version, adapter };
    },
    release() { return true; },
  };
}

module.exports = { loadTestAdapters, fakeComponentManager };
