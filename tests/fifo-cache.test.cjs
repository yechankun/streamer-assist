const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FifoCache, FifoSet } = require("../electron/fifo-cache.cjs");

test("FIFO retention matches insertion-ordered maps across growth, repeated keys and wraparound", () => {
  const cache = new FifoCache(), expected = new Map();
  for (let i = 0; i < 30000; i++) {
    const key = "actor-" + (i % 7000), value = i;
    cache.set(key, value); expected.set(key, value);
    if (expected.size > 4096) expected.delete(expected.keys().next().value);
    if (cache.size > 4096) cache.evictOldest();
    if (i % 2000 === 0) assert.deepEqual([...cache], [...expected]);
  }
  assert.deepEqual([...cache], [...expected]);
  assert.ok(cache.order.items.length <= 8192);
  cache.clear(); cache.set("new", 1); assert.deepEqual([...cache], [["new", 1]]);
});

test("message ID FIFO preserves duplicate admission and the two existing retention thresholds", () => {
  const ids = new FifoSet(["saved", "saved", "second"]), expected = new Set(["saved", "second"]);
  for (let i = 0; i < 45000; i++) {
    const id = "message-" + i, limit = i % 2 ? 20000 : 25000;
    ids.add(id); expected.add(id);
    if (expected.size > limit) expected.delete(expected.values().next().value);
    if (ids.size > limit) ids.evictOldest();
  }
  assert.deepEqual([...ids], [...expected]);
  const last = [...ids].at(-1), size = ids.size; ids.add(last); assert.equal(ids.size, size);
  assert.equal(ids.has(last), true); assert.equal(ids.has("saved"), false);
  ids.clear(); assert.equal(ids.size, 0); assert.equal(ids.order.items.length, 1024);
});

test("failed participant writeback keeps the oldest value and its eviction order for retry", () => {
  const cache = new FifoCache(); cache.set("first", { chats: 5 }); cache.set("second", { chats: 2 });
  assert.throws(() => cache.evictOldest(() => { throw Error("disk full"); }), /disk full/);
  assert.deepEqual([...cache.keys()], ["first", "second"]);
  let saved;
  assert.equal(cache.evictOldest(key => { saved = cache.get(key); }), "first");
  assert.equal(saved.chats, 5); assert.equal(cache.evictOldest(), "second");
});
