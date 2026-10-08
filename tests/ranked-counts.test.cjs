const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rankedCounts } = require("../electron/ranked-counts.cjs");
const reference = (rows, limit, minimum = -Infinity) => [...rows].filter(([, n]) => minimum === -Infinity || n > minimum).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([text, count]) => ({ text, count }));

test("bounded ranking retains exact counts and insertion order for ties", () => {
  const rows = new Map(Array.from({ length: 10000 }, (_, i) => ["word-" + i, (i * 1543) % 61]));
  for (const limit of [1, 10, 20, 100]) for (const minimum of [-Infinity, 1, 30])
    assert.deepEqual(rankedCounts(rows, limit, minimum), reference(rows, limit, minimum));
  assert.deepEqual(rankedCounts(new Map([["first", 4], ["second", 4], ["third", 4]]), 2), [{ text: "first", count: 4 }, { text: "second", count: 4 }]);
});

test("ranking keeps legacy numeric values and handles empty or non-finite saved counts", () => {
  for (const rows of [new Map(), new Map([["a", "12"], ["b", 12], ["c", -1]]), new Map([["a", 2], ["unknown", undefined], ["b", 5]]), new Map([["infinite", Infinity], ["b", 3]])])
    assert.deepEqual(rankedCounts(rows, 20), reference(rows, 20));
  assert.deepEqual(rankedCounts(new Map([["a", 1]]), 0), []);
});
