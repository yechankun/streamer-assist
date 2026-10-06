"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateDescriptor } = require("../electron/ai-components.cjs");
function descriptor(auth) {
  return { abiVersion: 1,
    provider: { id: "openai", name: "OpenAI", protocol: "responses", docs: "https://developers.openai.com/codex/auth", baseUrl: "https://api.openai.com/v1" },
    api: { buildRequest() {}, parseEvent() {}, buildModelsRequest() {}, parseModelsResponse() {}, normalizeUsage() {} },
    cli: { analysisPlan() {}, parseEvent() {}, models: { driver: "codex-app-server" }, quota: { driver: "codex-rate-limits" }, ...(auth ? { auth } : {}) }, pricing: [],
  };
}
function auth() { return { kind: "browser", loginArgs: ["login"], requiresTty: false, statusArgs: ["login", "status"], parseStatus() {}, authHosts: ["auth.openai.com"], instructions: "Complete account authentication in your browser.", keyUrl: "https://platform.openai.com/api-keys" }; }
test("authentication extension accepts browser and terminal recipes and preserves legacy ABI", () => {
  assert.equal(validateDescriptor(descriptor(auth()), "openai").cli.auth.kind, "browser");
  assert.equal(validateDescriptor(descriptor(), "openai").cli.auth, undefined);
  const terminal = { ...auth(), kind: "terminal", requiresTty: true, loginArgs: [] };
  assert.equal(validateDescriptor(descriptor(terminal), "openai").cli.auth.kind, "terminal");
});
test("authentication metadata rejects control characters, wildcard hosts, missing status parsers and unsafe key URLs", () => {
  const invalid = [
    { loginArgs: ["login\nother-command"] }, { loginArgs: [] }, { requiresTty: true },
    { authHosts: ["*.openai.com"] }, { authHosts: ["auth.openai.com/path"] },
    { statusArgs: ["login", "status"], parseStatus: "not-a-function" },
    { keyUrl: "http://platform.openai.com/api-keys" }, { keyUrl: "https://name:password@platform.openai.com/api-keys" },
    { keyUrl: "https://platform.openai.com/api-keys?token=secret" }, { parseProgress: {} }, { instructions: "x".repeat(501) },
  ];
  for (const value of invalid) assert.throws(() => validateDescriptor(descriptor({ ...auth(), ...value }), "openai"));
});
test("logout hooks validate command arguments and preserve the legacy descriptor contract", () => {
  const logout = { logoutKind: "command", logoutArgs: ["logout"], logoutInstructions: "Sign out of this CLI account.", logoutBeforeLogin: true };
  assert.equal(validateDescriptor(descriptor({ ...auth(), ...logout }), "openai").cli.auth.logoutKind, "command");
  for (const bad of [{ logoutArgs: ["logout\nextra"] }, { logoutKind: "unknown" }, { logoutBeforeLogin: "true" }, { logoutArgs: [] }, { logoutInstructions: "x".repeat(501) }])
    assert.throws(() => validateDescriptor(descriptor({ ...auth(), ...logout, ...bad }), "openai"));
  assert.throws(() => validateDescriptor(descriptor({ ...auth(), logoutBeforeLogin: true }), "openai"));
});
