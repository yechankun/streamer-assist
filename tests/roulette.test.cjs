const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rouletteItems, spinRoulette } = require("../electron/roulette.cjs");
const { Engine } = require("../electron/engine.cjs");
test("weighted boundaries select the correct item and skip zero-weight entries", () => {
  const items = [
    { name: "A", weight: 1 },
    { name: "Excluded", weight: 0 },
    { name: "B", weight: 3 },
  ];
  for (const ticket of [0, 1, 2, 3]) {
    const result = spinRoulette(items, (total) => {
      assert.equal(total, 4);
      return ticket;
    });
    assert.equal(result.index, ticket === 0 ? 0 : 2);
    assert.equal(result.name, ticket === 0 ? "A" : "B");
  }
});
test("one positive item wins even if other listed items have zero votes", () => {
  const items = [
    { name: "No votes", weight: 0 },
    { name: " Winner ", weight: 1000000000 },
  ];
  const result = spinRoulette(items);
  assert.equal(result.name, "Winner");
  assert.equal(result.index, 1);
  assert.equal(items[1].name, " Winner ");
});
test("invalid, duplicated, or all-zero roulette input is rejected before a draw", () => {
  const valid = [
    { name: "A", weight: 1 },
    { name: "B", weight: 2 },
  ];
  for (const input of [
    null,
    {},
    [],
    [valid[0]],
    Array.from({ length: 13 }, (_, i) => ({ name: String(i), weight: 1 })),
    [
      { name: "A", weight: 0 },
      { name: "B", weight: 0 },
    ],
    [
      { name: "A", weight: 1 },
      { name: " A ", weight: 1 },
    ],
  ]) {
    assert.throws(
      () =>
        spinRoulette(input, () => {
          throw new Error("draw must not be called");
        }),
      /항목|가중치/,
    );
  }
  for (const weight of [-1, NaN, Infinity, 0.5, "1", 1000000001])
    assert.throws(
      () => rouletteItems([valid[0], { name: "B", weight }]),
      /가중치/,
    );
  for (const name of ["", " ", "x".repeat(51), 4])
    assert.throws(() => rouletteItems([valid[0], { name, weight: 1 }]), /항목/);
});
test("invalid random boundaries are rejected and validated inputs are copied", () => {
  const items = [
    { name: "A", weight: 1 },
    { name: "B", weight: 2 },
  ];
  for (const value of [-1, 3, 0.5, NaN])
    assert.throws(() => spinRoulette(items, () => value), /추첨 값/);
  const result = spinRoulette(items, () => 2);
  result.items[0].weight = 9;
  assert.equal(items[0].weight, 1);
});
test("poll end time is captured once and persists for the broadcast result timer", () => {
  const engine = new Engine();
  engine.start("clock");
  engine.createPoll("Q", ["A", "B"]);
  engine.endPoll();
  const closedAt = engine.poll.closedAt;
  assert.ok(closedAt >= engine.poll.openedAt);
  const restored = new Engine(JSON.parse(JSON.stringify(engine.persisted())));
  restored.endPoll();
  assert.equal(restored.poll.closedAt, closedAt);
  assert.equal(restored.current.polls[0].closedAt, closedAt);
});
