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
test("deduplicates YouTube delivery and retains one latest vote per platform account", () => {
  const e = new Engine();
  e.start("vote");
  e.createPoll("Q", ["A", "B"], "chat");
  const m = { platform: "youtube", id: "a", userId: "one", text: "!투표1" };
  e.ingest(m);
  e.ingest(m);
  e.ingest({ ...m, id: "b", text: "!투표2" });
  e.ingest({ platform: "chzzk", userId: "one", text: "!투표2" });
  assert.deepEqual(e.poll.counts, [0, 2]);
  assert.equal(e.chatCount, 3);
  e.endPoll();
  e.ingest({ platform: "chzzk", userId: "new", text: "!투표2" });
  assert.deepEqual(e.poll.counts, [0, 2]);
});
test("native YouTube poll counts never double count YouTube chat votes", () => {
  const e = new Engine();
  e.start("native");
  e.createPoll("Q", ["A", "B"], "native");
  e.poll.youtubeId = "poll";
  e.ingest({ platform: "youtube", userId: "yt", text: "!투표1" });
  e.ingest({ platform: "chzzk", userId: "ch", text: "!투표2" });
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
test("timed number polls reject votes at the deadline and preserve it across restart", () => {
  const e = new Engine(); e.start("timer", 0, 1000);
  e.createPoll("Q", ["A", "B"], "chat", ["chzzk"], "!투표", 90, 1000);
  assert.equal(e.poll.endsAt - e.poll.openedAt, 90000);
  e.ingest({ platform: "chzzk", userId: "early", text: "!투표1" }, 90999);
  const restored = new Engine(JSON.parse(JSON.stringify(e.persisted())));
  assert.equal(restored.poll.endsAt, 91000);
  restored.ingest({ platform: "chzzk", userId: "late", text: "!투표2" }, 91000);
  restored.ingest({ platform: "chzzk", userId: "early", text: "!투표2" }, 92000);
  assert.deepEqual(restored.poll.counts, [1, 0]);
  restored.endPoll(restored.poll.endsAt);
  assert.equal(restored.poll.active, false);
  assert.equal(restored.poll.closedAt, 91000);
  assert.equal(restored.current.polls.length, 1);
  assert.deepEqual(restored.current.polls[0].counts, [1, 0]);
});

test("number poll timers are optional, validate duration before replacing results and allow manual early close", () => {
  const e = new Engine(); e.start("timer");
  const previous = e.createPoll("Q", ["A", "B"]);
  assert.equal(previous.endsAt, null); e.endPoll();
  for (const seconds of [0, -1, 1.5, 86401, NaN, "60"]) {
    assert.throws(() => e.createPoll("Q", ["A", "B"], "chat", ["chzzk"], "!투표", seconds), /타이머/);
    assert.equal(e.poll, previous);
  }
  e.createPoll("Q", ["A", "B"], "chat", ["chzzk"], "!투표", 86400, 1000);
  e.endPoll(2000);
  assert.equal(e.poll.closedAt, 2000);
  assert.equal(e.poll.endsAt, 86401000);
});

test("timed native polls ignore overdue open updates, keep final platform results and archive the deadline", () => {
  const e = new Engine(); e.start("native", 0, 1000);
  e.createPoll("Q", ["A", "B"], "native", ["youtube"], "!투표", 1, 1000);
  e.poll.youtubeId = "remote-poll";
  const result = (status, count) => ({ id: "remote-poll", snippet: { pollDetails: { metadata: { status, options: [{ tally: String(count) }, { tally: "0" }] } } } });
  e.updateYoutubePoll(result("active", 2), 1999);
  e.updateYoutubePoll(result("active", 20), 2000);
  assert.deepEqual(e.poll.youtubeCounts, [2, 0]);
  e.updateYoutubePoll(result("closed", 3), 2500);
  assert.equal(e.current.polls[0].closedAt, 2000, "platform-confirmed closure archives results without a separate manual stop");
  e.endPoll(e.poll.endsAt);
  assert.equal(e.poll.closedAt, 2000);
  assert.deepEqual(e.current.polls[0].youtubeCounts, [3, 0]);
});

test("restored sessions preserve markers and voter deduplication", () => {
  const e = new Engine();
  e.start("persist");
  e.mark("marker");
  e.createPoll("Q", ["A", "B"]);
  e.ingest({ platform: "chzzk", userId: "one", text: "!투표1" });
  const restored = new Engine(JSON.parse(JSON.stringify(e.persisted())));
  assert.equal(restored.current.markers.length, 1);
  assert.equal(restored.poll.active, true);
  restored.ingest({ platform: "chzzk", userId: "one", text: "!투표2" });
  assert.deepEqual(restored.poll.counts, [0, 1]);
  assert.equal(restored.voters.size, 1);
});
test("ignores chat before session start and invalid votes", () => {
  const e = new Engine();
  e.start("old", 0, 200000);
  e.createPoll("Q", ["A", "B"]);
  e.ingest(
    { platform: "youtube", userId: "old", text: "!투표1", timestamp: 100000 },
    200001,
  );
  for (const text of [
    "1",
    "!투표0",
    "!투표3",
    "오늘 !투표1",
    " !투표1",
    "!투표",
  ])
    e.ingest({ platform: "chzzk", userId: text, text }, 200002);
  assert.equal(e.chatCount, 6);
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

test("YouTube-only poll excludes CHZZK votes but continues collecting chat reactions", () => {
  const e = new Engine();
  e.start("YouTube only");
  e.createPoll("Q", ["A", "B"], "native", ["youtube"]);
  e.poll.youtubeId = "native";
  e.ingest({ platform: "chzzk", userId: "ch", text: "!투표1" });
  e.ingest({ platform: "youtube", userId: "yt", text: "!투표2" });
  e.updateYoutubePoll({
    id: "native",
    snippet: {
      pollDetails: { metadata: { options: [{ tally: "3" }, { tally: "4" }] } },
    },
  });
  assert.deepEqual(e.poll.counts, [0, 0]);
  assert.deepEqual(e.poll.youtubeCounts, [3, 4]);
  assert.equal(e.chatCount, 2);
  assert.equal(e.voters.size, 0);
});
test("CHZZK-only poll ignores YouTube votes and retains its selection after restart", () => {
  const e = new Engine();
  e.start("CHZZK only");
  const selected = ["chzzk"];
  e.createPoll("Q", ["A", "B"], "chat", selected);
  selected.push("youtube");
  e.ingest({ platform: "youtube", userId: "one", text: "!투표1" });
  e.ingest({ platform: "chzzk", userId: "one", text: "!투표2" });
  const restored = new Engine(JSON.parse(JSON.stringify(e.persisted())));
  restored.ingest({ platform: "youtube", userId: "two", text: "!투표1" });
  assert.deepEqual(restored.poll.platforms, ["chzzk"]);
  assert.deepEqual(restored.poll.counts, [0, 1]);
  assert.equal(e.chatCount, 2);
});
test("legacy saved polls preserve their original platform scope", () => {
  const e = new Engine();
  e.start("legacy");
  e.createPoll("Q", ["A", "B"], "native");
  const saved = JSON.parse(JSON.stringify(e.persisted()));
  delete saved.poll.platforms;
  delete saved.poll.chatPrefix;
  delete saved.poll.votePolicy;
  const restored = new Engine(saved);
  assert.deepEqual(restored.poll.platforms, ["chzzk", "youtube"]);
  restored.ingest({ platform: "chzzk", userId: "ch", text: "2" });
  restored.ingest({ platform: "chzzk", userId: "ch", text: "1" });
  assert.equal(restored.poll.chatPrefix, "");
  assert.equal(restored.poll.votePolicy, "first");
  assert.deepEqual(restored.poll.counts, [0, 1]);
});
test("invalid or empty platform selections never create a poll", () => {
  const e = new Engine();
  e.start("invalid");
  for (const selection of [
    [],
    ["other"],
    ["youtube", "youtube"],
    ["demo"],
    null,
  ]) {
    assert.throws(
      () => e.createPoll("Q", ["A", "B"], "native", selection),
      /플랫폼/,
    );
    assert.equal(e.poll, null);
  }
  assert.throws(
    () => e.createPoll("Q", ["A", "B"], "native", ["chzzk"]),
    /플랫폼/,
  );
});

test("reference commands accept optional spaces and trailing text and move the previous vote", () => {
  const e = new Engine();
  e.start("reference");
  e.createPoll("Q", ["A", "B"]);
  assert.equal(e.poll.chatPrefix, "!투표");
  assert.equal(e.poll.votePolicy, "latest");
  e.ingest({
    platform: "youtube",
    userId: "one",
    id: "a",
    text: "!투표1 좋다",
  });
  e.ingest({ platform: "youtube", userId: "one", id: "b", text: "!투표 2" });
  e.ingest({
    platform: "youtube",
    userId: "one",
    id: "a",
    text: "!투표1 좋다",
  });
  e.ingest({ platform: "youtube", userId: "one", id: "c", text: "!투표2" });
  e.ingest({ platform: "chzzk", userId: "one", text: "!투표01" });
  assert.deepEqual(e.poll.counts, [1, 1]);
  assert.equal(e.voters.size, 2);
  const restored = new Engine(JSON.parse(JSON.stringify(e.persisted())));
  restored.ingest({ platform: "youtube", userId: "one", text: "!투표1" });
  restored.ingest({ platform: "youtube", userId: "one", text: "!투표99" });
  assert.deepEqual(restored.poll.counts, [2, 0]);
  assert.equal(restored.voters.size, 2);
  restored.endPoll();
  restored.ingest({ platform: "youtube", userId: "one", text: "!투표2" });
  assert.deepEqual(restored.poll.counts, [2, 0]);
});

test("custom prefixes are literal, persisted, and isolated from other commands", () => {
  const e = new Engine();
  e.start("custom");
  e.createPoll("Q", ["A", "B"], "chat", ["chzzk"], "#.");
  for (const text of ["!투표1", "#x1", " #.1", "#.99999999999999999999999"])
    e.ingest({ platform: "chzzk", userId: text, text });
  e.ingest({ platform: "chzzk", userId: "one", text: "#. 1 후기" });
  const restored = new Engine(JSON.parse(JSON.stringify(e.persisted())));
  assert.equal(restored.poll.chatPrefix, "#.");
  restored.ingest({ platform: "chzzk", userId: "one", text: "#.2" });
  assert.deepEqual(restored.poll.counts, [0, 1]);
  assert.equal(restored.voters.size, 1);
});

test("number-only mode accepts exact numbers and rejects surrounding text", () => {
  const e = new Engine();
  e.start("bare");
  e.createPoll("Q", ["A", "B"], "chat", ["chzzk"], "");
  for (const text of ["!투표1", "1번", "12", "1 2"])
    e.ingest({ platform: "chzzk", userId: "one", text });
  e.ingest({ platform: "chzzk", userId: "one", text: " 1 " });
  e.ingest({ platform: "chzzk", userId: "one", text: "2" });
  assert.deepEqual(e.poll.counts, [0, 1]);
  assert.equal(e.voters.size, 1);
});

test("invalid prefixes do not create or replace a poll", () => {
  const e = new Engine();
  e.start("invalid");
  for (const prefix of [
    null,
    3,
    {},
    " ".repeat(1),
    "x".repeat(13),
    "bad" + String.fromCharCode(10),
  ]) {
    assert.throws(
      () => e.createPoll("Q", ["A", "B"], "chat", ["chzzk"], prefix),
      /접두어/,
    );
    assert.equal(e.poll, null);
  }
});
