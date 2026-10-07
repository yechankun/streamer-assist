"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emptyAssignments, normalizeAssignments, saveAssignment, clearAssignment, resolveAssignment } = require("../electron/ai-assignments.cjs");

const binding = (providerId, effort = "default") => ({ providerId, mode: "api", model: "queried-model", effort });

test("function, group, and default assignments inherit without mutating prior settings", () => {
  const original = emptyAssignments();
  const global = saveAssignment(original, { scope: "default" }, binding("openai"));
  const grouped = saveAssignment(global, { scope: "group", id: "chat" }, binding("anthropic", "high"));
  const specific = saveAssignment(grouped, { scope: "function", id: "chat.questions" }, binding("xai", "low"));
  assert.equal(original.default, null);
  assert.deepEqual(resolveAssignment(specific, "chat.questions"), { binding: binding("xai", "low"), source: "function" });
  assert.deepEqual(resolveAssignment(specific, "chat.custom"), { binding: binding("anthropic", "high"), source: "group" });
  assert.deepEqual(resolveAssignment(specific, "broadcast.summary"), { binding: binding("openai"), source: "default" });
  const inherited = clearAssignment(specific, { scope: "function", id: "chat.questions" });
  assert.equal(resolveAssignment(inherited, "chat.questions").source, "group");
  assert.equal(resolveAssignment(clearAssignment(inherited, { scope: "group", id: "chat" }), "chat.questions").source, "default");
  const resolved = resolveAssignment(specific, "chat.questions");
  resolved.binding.model = "cannot-mutate-settings";
  assert.equal(specific.functions["chat.questions"].model, "queried-model");
});

test("applying a whole group clears only that group's explicit function overrides", () => {
  let settings = saveAssignment(emptyAssignments(), { scope: "default" }, binding("openai"));
  settings = saveAssignment(settings, { scope: "function", id: "chat.questions" }, binding("xai"));
  settings = saveAssignment(settings, { scope: "function", id: "broadcast.summary" }, binding("google"));
  const preserved = saveAssignment(settings, { scope: "group", id: "chat" }, binding("anthropic"));
  assert.equal(resolveAssignment(preserved, "chat.questions").source, "function");
  const replaced = saveAssignment(preserved, { scope: "group", id: "chat", resetOverrides: true }, binding("anthropic"));
  assert.equal(resolveAssignment(replaced, "chat.questions").source, "group");
  assert.equal(resolveAssignment(replaced, "broadcast.summary").source, "function");
  const everything = saveAssignment(replaced, { scope: "default", resetOverrides: true }, binding("moonshot"));
  assert.deepEqual(everything.groups, {});
  assert.deepEqual(everything.functions, {});
  assert.equal(resolveAssignment(everything, "broadcast.summary").binding.providerId, "moonshot");
});

test("normalization drops corrupt rows independently and accepts only known scopes and bindings", () => {
  const settings = normalizeAssignments({ schemaVersion: 1, default: binding("openai"), groups: {
    chat: binding("anthropic"), broadcast: { ...binding("google"), mode: "invalid" }, unknown: binding("openai"),
  }, functions: {
    "chat.custom": binding("xai"), "chat.questions": { ...binding("xai"), model: "bad\nmodel" },
    "support.summary": { ...binding("moonshot"), effort: "impossible" }, "unknown.feature": binding("xai"),
  } }, ["openai", "anthropic", "xai", "google", "moonshot"]);
  assert.equal(settings.default.providerId, "openai");
  assert.deepEqual(Object.keys(settings.groups), ["chat"]);
  assert.deepEqual(Object.keys(settings.functions), ["chat.custom"]);
  assert.equal(resolveAssignment(settings, "chat.questions").source, "group");
  assert.deepEqual(normalizeAssignments({ schemaVersion: 20 }), emptyAssignments());
  assert.throws(() => resolveAssignment(settings, "__proto__"), /지원하지/);
  assert.throws(() => saveAssignment(settings, { scope: "group", id: "__proto__" }, binding("openai")), /확인/);
  assert.throws(() => clearAssignment(settings, { scope: "function", id: "unknown.feature" }), /확인/);
});
