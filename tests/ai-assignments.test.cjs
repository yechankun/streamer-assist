"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emptyAssignments, normalizeAssignments, saveAssignment, clearAssignment, resolveAssignment, setFunctionInheritance } = require("../electron/ai-assignments.cjs");

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

test("turning off group following snapshots the current binding until following is restored", () => {
  const grouped = saveAssignment(emptyAssignments(), { scope: "group", id: "chat" }, binding("openai", "high"));
  const detached = setFunctionInheritance(grouped, "chat.custom", false);
  const changed = saveAssignment(detached, { scope: "group", id: "chat" }, binding("anthropic", "low"));
  assert.deepEqual(resolveAssignment(changed, "chat.custom"), { binding: binding("openai", "high"), source: "function" });
  assert.equal(resolveAssignment(changed, "chat.questions").binding.providerId, "anthropic");
  assert.deepEqual(setFunctionInheritance(changed, "chat.custom", false), changed, "repeated opt-out preserves the existing override");
  const following = setFunctionInheritance(changed, "chat.custom", true);
  assert.equal(resolveAssignment(following, "chat.custom").binding.providerId, "anthropic");
  assert.equal(resolveAssignment(following, "chat.custom").source, "group");
  assert.deepEqual(grouped.functions, {}, "prior settings remain unchanged");
});

test("an unassigned opt-out survives normalization and later group configuration", () => {
  const detached = setFunctionInheritance(emptyAssignments(), "chat.custom", false);
  assert.equal(detached.functions["chat.custom"], null);
  const loaded = normalizeAssignments(JSON.parse(JSON.stringify(detached)));
  const configured = saveAssignment(loaded, { scope: "group", id: "chat" }, binding("openai"));
  assert.deepEqual(resolveAssignment(configured, "chat.custom"), { binding: null, source: "function" });
  assert.equal(resolveAssignment(configured, "chat.questions").binding.providerId, "openai");
  assert.throws(() => setFunctionInheritance(configured, "__proto__", false), /확인/);
  assert.throws(() => setFunctionInheritance(configured, "chat.custom", "false"), /확인/);
});

test("AI off in a group blocks overall fallback while independent functions retain their AI", () => {
  let configured = saveAssignment(emptyAssignments(), { scope: "default" }, binding("openai"));
  configured = saveAssignment(configured, { scope: "function", id: "chat.custom" }, binding("xai"));
  configured = saveAssignment(configured, { scope: "group", id: "chat" }, null);
  const loaded = normalizeAssignments(JSON.parse(JSON.stringify(configured)));
  assert.deepEqual(resolveAssignment(loaded, "chat.questions"), { binding: null, source: "group" });
  assert.equal(resolveAssignment(loaded, "chat.custom").binding.providerId, "xai");
  assert.equal(resolveAssignment(loaded, "broadcast.summary").binding.providerId, "openai");
  const individualOff = saveAssignment(loaded, { scope: "function", id: "chat.custom" }, null);
  assert.deepEqual(resolveAssignment(individualOff, "chat.custom"), { binding: null, source: "function" });
  const restored = clearAssignment(individualOff, { scope: "group", id: "chat" });
  assert.equal(resolveAssignment(restored, "chat.questions").binding.providerId, "openai");
  assert.equal(resolveAssignment(restored, "chat.custom").binding, null);
});

test("overall AI off stays distinguishable from unassigned settings after reloading", () => {
  const initial = emptyAssignments();
  assert.equal(resolveAssignment(initial, "broadcast.summary").source, "none");
  const disabled = saveAssignment(initial, { scope: "default" }, null);
  const loaded = normalizeAssignments(JSON.parse(JSON.stringify(disabled)));
  assert.equal(loaded.defaultDisabled, true);
  assert.deepEqual(resolveAssignment(loaded, "broadcast.summary"), { binding: null, source: "default" });
  const enabled = saveAssignment(loaded, { scope: "default" }, binding("openai"));
  assert.equal(enabled.defaultDisabled, false);
  assert.equal(resolveAssignment(enabled, "broadcast.summary").binding.providerId, "openai");
  assert.equal(clearAssignment(loaded, { scope: "default" }).defaultDisabled, false);
});
