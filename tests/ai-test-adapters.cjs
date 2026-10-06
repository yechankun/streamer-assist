"use strict";

let loading;

function loadTestAdapters() {
  if (!loading) loading = require("../scripts/fetch-ai-test-components.cjs").prepareTestComponents();
  return loading;
}

function fakeComponentManager(descriptors, version = "test-verified", { preserveUnsupportedProfiles = false } = {}) {
  // Fake subprocess tests declare an artificial private profile when their
  // cached adapter predates this extension, or cannot isolate a real CLI.
  // This never changes a published adapter or launches a real CLI account.
  const fixtures = Object.fromEntries(Object.entries(descriptors).map(([id, adapter]) => [id,
    adapter.cli?.profile && (adapter.cli.profile.supported || preserveUnsupportedProfiles) ? adapter : { ...adapter, cli: { ...adapter.cli, profile: {
      supported: true, env: { CODEX_HOME: "." },
      files: [{ relativePath: "config.toml", contents: 'cli_auth_credentials_store = "file"\n' }],
      docs: "https://learn.chatgpt.com/docs/auth",
    } } },
  ]));
  const rows = Object.fromEntries(Object.keys(descriptors).map(id => [id, { id, status: "ready", version, source: "test-fixture", progress: 1, bytes: 0, totalInstalledBytes: 0 }]));
  return {
    snapshot: () => ({ components: Object.values(rows), byId: { ...rows } }),
    async detect(id) { return rows[id] || { id, status: "not-installed" }; },
    async update(id) { return rows[id] || { id, status: "not-installed" }; },
    load(id) { return fixtures[id] || null; },
    async pin(id) {
      const adapter = fixtures[id];
      if (!adapter) throw new Error("Test adapter is unavailable.");
      return { version, adapter };
    },
    release() { return true; },
  };
}

module.exports = { loadTestAdapters, fakeComponentManager };
