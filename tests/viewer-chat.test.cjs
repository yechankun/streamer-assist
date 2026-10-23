const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ViewerChats } = require("../electron/viewer-chat.cjs");
const { Engine } = require("../electron/engine.cjs");
const { participantKey } = require("../electron/chat-analysis.cjs");
const target = { platform: "chzzk", userId: "viewer", name: "같은 이름" };
const chat = (id, extra = {}) => ({ ...target, id, text: "메시지 " + id, timestamp: 1100, ...extra });

test("viewer previews isolate exact accounts and windows, freeze the previous chat and ignore replay/duplicates", () => {
  const rooms = new ViewerChats("salt");
  rooms.ingest(chat("before"), 1100);
  const first = rooms.open(1, target, 1200);
  rooms.open(2, { ...target, platform: "youtube" }, 1200);
  assert.equal(first.lastMessage.text, "메시지 before");
  for (const extra of [{ userId: "other" }, { platform: "youtube" }, { historical: true }, { replay: true }, { timestamp: 1100 }, { kind: "donation" }])
    rooms.ingest(chat("ignored", { timestamp: 1300, ...extra }), 1300);
  rooms.ingest(chat("live", { timestamp: 1300 }), 1300);
  rooms.ingest(chat("live", { timestamp: 1300 }), 1301);
  assert.equal(rooms.snapshot(1).messageCount, 1);
  assert.equal(rooms.snapshot(1).lastMessage.text, "메시지 before");
  assert.equal(rooms.snapshot(2).messages[0].id, "youtube:ignored");
  assert.equal(rooms.snapshot(1).messages[0].id, "chzzk:live");
  rooms.close(1, "stale"); assert.ok(rooms.snapshot(1));
  rooms.close(1, first.id); assert.equal(rooms.snapshot(1), null); assert.ok(rooms.snapshot(2));
});

test("history participant keys open the same live identity, with bounded memory and no saved chat previews", () => {
  const engine = new Engine(); const rooms = engine.viewerChats;
  const key = participantKey(engine.identitySalt, target.platform, target.userId);
  rooms.open(1, { platform: target.platform, name: target.name, participantKey: key }, 1000);
  for (let index = 0; index < 100; index++) engine.ingest(chat(String(index), { timestamp: 1100 + index, text: "runtime-preview-" + index }), 1100 + index);
  assert.equal(rooms.snapshot(1).messageCount, 100); assert.equal(rooms.snapshot(1).messages.length, 50);
  assert.equal(rooms.snapshot(1).messages[0].text, "runtime-preview-50");
  engine.ingest(chat("0", { timestamp: 1200, text: "duplicate old message" }), 1200);
  assert.equal(rooms.snapshot(1).messageCount, 100, "duplicates remain suppressed after leaving the visible 50-message window");
  assert.equal(JSON.stringify(engine.persisted()).includes("runtime-preview"), false);
  for (let index = 0; index < 1000; index++) rooms.ingest(chat(String(index), { userId: "other-" + index }), 2000);
  assert.equal(rooms.recent.size, 500);
  assert.equal(rooms.open(2, target, 400000).lastMessage, null);
  assert.throws(() => rooms.open(3, { ...target, userId: "", participantKey: "invalid" }));
});
