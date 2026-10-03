const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Engine, timecode } = require("../electron/engine.cjs");
test("marker uses broadcast offset and can export after ending", () => {
  const e = new Engine();
  e.start("테스트", 60, 100000);
  const m = e.mark("성공", "manual", null, 105000);
  assert.equal(m.timecode, "00:01:05");
  e.stop(110000);
  assert.match(e.summary(), /00:01:05/);
  assert.equal(e.current, null);
  assert.equal(timecode(3600000), "01:00:00");
});
test("burst from multiple participants triggers once, one spammer does not", () => {
  const e = new Engine();
  e.start("burst", 0, 100000);
  for (let i = 0; i < 30; i++)
    e.ingest({ platform: "chzzk", userId: "spam", text: "ㅋㅋㅋ" }, 100000 + i);
  assert.equal(e.current.markers.length, 0);
  for (let i = 0; i < 20; i++)
    e.ingest(
      { platform: "chzzk", userId: `user${i}`, text: "ㅋㅋㅋ" },
      101000 + i,
    );
  assert.equal(e.current.markers.length, 1);
  assert.equal(e.current.markers[0].kind, "auto");
});
test("deduplicates YouTube delivery and first vote per platform account", () => {
  const e = new Engine();
  e.start("vote");
  e.createPoll("Q", ["A", "B"], "chat");
  const m = { platform: "youtube", id: "a", userId: "one", text: "1" };
  e.ingest(m);
  e.ingest(m);
  e.ingest({ ...m, id: "b", text: "2" });
  e.ingest({ platform: "chzzk", userId: "one", text: "2" });
  assert.deepEqual(e.poll.counts, [1, 1]);
  assert.equal(e.chatCount, 3);
  e.endPoll();
  e.ingest({ platform: "chzzk", userId: "new", text: "2" });
  assert.deepEqual(e.poll.counts, [1, 1]);
});
test("native YouTube poll counts never double count YouTube chat votes", () => {
  const e = new Engine();
  e.start("native");
  e.createPoll("Q", ["A", "B"], "native");
  e.poll.youtubeId = "poll";
  e.ingest({ platform: "youtube", userId: "yt", text: "1" });
  e.ingest({ platform: "chzzk", userId: "ch", text: "2" });
  e.updateYoutubePoll({
    id: "poll",
    snippet: {
      pollDetails: { metadata: { options: [{ tally: "4" }, { tally: "7" }] } },
    },
  });
  assert.deepEqual(e.poll.counts, [0, 1]);
  assert.deepEqual(e.poll.youtubeCounts, [4, 7]);
  e.updateYoutubePoll({
    id: "another",
    snippet: {
      pollDetails: {
        metadata: { options: [{ tally: "99" }, { tally: "99" }] },
      },
    },
  });
  assert.deepEqual(e.poll.youtubeCounts, [4, 7]);
});
test("restored sessions preserve markers and voter deduplication", () => {
  const e = new Engine();
  e.start("persist");
  e.mark("marker");
  e.createPoll("Q", ["A", "B"]);
  e.ingest({ platform: "chzzk", userId: "one", text: "1" });
  const restored = new Engine(JSON.parse(JSON.stringify(e.persisted())));
  assert.equal(restored.current.markers.length, 1);
  assert.equal(restored.poll.active, true);
  restored.ingest({ platform: "chzzk", userId: "one", text: "2" });
  assert.deepEqual(restored.poll.counts, [1, 0]);
});
test("ignores chat before session start and invalid votes", () => {
  const e = new Engine();
  e.start("old", 0, 200000);
  e.createPoll("Q", ["A", "B"]);
  e.ingest(
    { platform: "youtube", userId: "old", text: "1", timestamp: 100000 },
    200001,
  );
  for (const text of ["0", "3", "1번", "1 2"])
    e.ingest({ platform: "chzzk", userId: text, text }, 200002);
  assert.equal(e.chatCount, 4);
  assert.deepEqual(e.poll.counts, [0, 0]);
});
test("rejects invalid session and poll state transitions", () => {
  const e = new Engine();
  assert.throws(() => e.mark());
  assert.throws(() => e.createPoll("Q", ["A", "B"]));
  assert.throws(() => e.start("bad", NaN));
  e.start("valid");
  assert.throws(() => e.start("twice"));
  assert.throws(() => e.createPoll("Q", ["A", "A"]));
  e.createPoll("Q", ["A", "B"]);
  assert.throws(() => e.createPoll("Q2", ["C", "D"]));
});
