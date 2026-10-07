const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AudienceTools } = require("../electron/audience.cjs");
const { Engine } = require("../electron/engine.cjs");
const { parseDonation, parseChat } = require("../electron/chzzk.cjs");
const { youtubeMessage } = require("../electron/platforms.cjs");
const raffle = {
  title: "",
  platforms: ["chzzk", "youtube"],
  entryMode: "any",
  keyword: "!참여",
  subscribersOnly: false,
  excludeWinners: true,
  timerSeconds: null,
};
const donation = {
  question: "다음 게임?",
  options: ["A", "B"],
  platforms: ["chzzk", "youtube"],
  chatPrefix: "!투표",
  currency: "KRW",
  minimumMicros: 1e9,
  plural: false,
  timerSeconds: null,
};
const chat = (user, overrides = {}) => ({
  platform: "chzzk",
  userId: user,
  name: user,
  text: "안녕하세요",
  timestamp: 1001,
  ...overrides,
});
const paid = (id, user, text = "!투표1", amountMicros = 1e9, extra = {}) => ({
  ...chat(user),
  kind: "donation",
  id,
  text,
  amountMicros,
  currency: "KRW",
  ...extra,
});
test("raffle collects fresh selected-platform text once per identity and draws without replacement", () => {
  const a = new AudienceTools();
  a.startRaffle(raffle, 1000);
  a.ingest(chat("one"), 1001);
  a.ingest(chat("one"), 1002);
  a.ingest(chat("one", { platform: "youtube" }), 1003);
  a.ingest(chat("late", { timestamp: 999 }), 1004);
  a.ingest(chat("demo", { platform: "demo" }), 1004);
  a.ingest(paid("not-chat", "paid"), 1004);
  assert.equal(a.snapshot().raffle.candidateCount, 2);
  const first = a.drawRaffle(false, 1010, () => 1);
  assert.equal(first.winner.platform, "youtube");
  assert.throws(() => a.drawRaffle(false, 1011));
  const second = a.drawRaffle(true, 4010, () => 0);
  assert.equal(second.winner.platform, "chzzk");
  assert.throws(() => a.drawRaffle(true, 4011));
});
test("raffle keyword and membership filters, deadline and previous winners survive restoration", () => {
  const a = new AudienceTools();
  a.startRaffle(
    { ...raffle, entryMode: "keyword", subscribersOnly: true, timerSeconds: 1 },
    1000,
  );
  a.ingest(chat("no-member", { text: "!참여" }), 1001);
  a.ingest(chat("wrong", { text: "앞 !참여", subscriber: true }), 1001);
  a.ingest(chat("right", { text: "!참여 응모", subscriber: true }), 1001);
  a.drawRaffle(true, 1010, () => 0);
  const b = new AudienceTools(JSON.parse(JSON.stringify(a.persisted())));
  b.ingest(chat("after", { subscriber: true, text: "!참여" }), 2000);
  assert.equal(b.raffle.active, false);
  assert.equal(b.raffle.closedAt, 2000);
  assert.equal(b.snapshot().raffle.candidateCount, 1);
  assert.equal(b.snapshot().raffle.eligibleCount, 0);
  b.startRaffle({ ...raffle, excludeWinners: false }, 3000);
  b.ingest(chat("again", { timestamp: 3001 }), 3001);
  assert.equal(b.drawRaffle(true, 3002, () => 0).winner.name, "again");
  assert.equal(b.drawRaffle(true, 3003, () => 0).winner.name, "again");
});
for (const count of [1, 2, 137, 10000]) {
  test(`raffle reel has exactly ${count} eligible identities in one cycle and lands on the secure winner`, () => {
    const a = new AudienceTools();
    a.startRaffle(raffle, 1000);
    for (let i = 0; i < count; i++) a.ingest(chat("viewer-" + i), 1001);
    const eligible = a.eligible(), index = Math.floor(count / 2);
    let randomCalls = 0;
    const draw = a.drawRaffle(false, 1010, (limit) => {
      assert.equal(limit, count); randomCalls++; return index;
    });
    const reel = a.getRaffleReel(draw.id);
    assert.equal(randomCalls, 1);
    assert.equal(draw.participantCount, count);
    assert.equal(reel.length, count);
    assert.equal(new Set(reel.map(p => p.key)).size, count);
    assert.deepEqual(reel, [...eligible.slice(index + 1), ...eligible.slice(0, index + 1)]);
    assert.deepEqual(reel.at(-1), draw.winner);
    assert.equal(a.snapshot().raffle.candidates.length, Math.min(100, count));
    assert.ok(!("raffleReel" in a.snapshot()));
    assert.ok(!("participants" in a.snapshot().raffle.latestDraw));
    const b = new AudienceTools(JSON.parse(JSON.stringify(a.persisted())));
    assert.deepEqual(b.getRaffleReel(draw.id), reel, "restart preserves the frozen playback roster");
  });
}
test("raffle reel freezes draw-time names and filters, keeping only the latest roster outside history", () => {
  const a = new AudienceTools();
  a.startRaffle({ ...raffle, subscribersOnly: true }, 1000);
  for (const user of ["one", "two", "three"]) a.ingest(chat(user, { subscriber: true }), 1001);
  a.ingest(chat("not-a-member"), 1001);
  const first = a.drawRaffle(false, 1010, () => 0);
  const frozen = JSON.parse(JSON.stringify(a.getRaffleReel(first.id)));
  a.ingest(chat("two", { name: "changed-name", subscriber: true }), 1011);
  a.ingest(chat("late", { subscriber: true }), 1011);
  assert.deepEqual(a.getRaffleReel(first.id), frozen, "incoming chat cannot change an in-progress reel");
  const second = a.drawRaffle(false, 4010, () => 1);
  const next = a.getRaffleReel(second.id);
  assert.equal(second.participantCount, 3);
  assert.ok(!next.some(p => p.key === first.winner.key), "previous winner is excluded before freezing the next reel");
  assert.ok(!next.some(p => p.userId === "not-a-member"));
  assert.ok(next.some(p => p.name === "changed-name"));
  assert.deepEqual(next.at(-1), second.winner);
  assert.throws(() => a.getRaffleReel(first.id));
  const saved = JSON.parse(JSON.stringify(a.persisted()));
  assert.equal(saved.raffleReel.id, second.id);
  assert.ok(saved.raffle.draws.every(draw => !("participants" in draw)));
  assert.deepEqual(new AudienceTools(saved).getRaffleReel(second.id), next);
  delete saved.raffleReel;
  assert.deepEqual(new AudienceTools(saved).getRaffleReel(second.id), [second.winner], "legacy saved results remain readable");
  a.stopRaffle(7010);
  a.startRaffle(raffle, 7010);
  assert.equal(a.persisted().raffleReel, null, "new recruitment releases the last roster");
});
test("donation one-person mode replaces valid choices, rejects regular chat, duplicates, stale and mismatched currency", () => {
  const a = new AudienceTools();
  a.startDonation(donation, 1000);
  a.ingest(chat("regular", { text: "!투표1" }), 1001);
  a.ingest(paid("one", "u1"), 1001);
  a.ingest(paid("one", "u1"), 1002);
  a.ingest(paid("small", "u1", "!투표2", 999e6), 1003);
  a.ingest(paid("two", "u1", "!투표2", 5e9), 1003);
  a.ingest(paid("old", "u2", "!투표1", 1e9, { timestamp: 999 }), 1003);
  a.ingest(paid("usd", "u2", "!투표1", 1e9, { currency: "USD" }), 1003);
  assert.deepEqual(a.donationPoll.counts, [0, 1]);
  assert.equal(a.donationPoll.ignoredCurrency, 1);
  const b = new AudienceTools(JSON.parse(JSON.stringify(a.persisted())));
  b.ingest(paid("two", "u1", "!투표2", 5e9), 1004);
  b.ingest(paid("new", "u1"), 1005);
  assert.deepEqual(b.donationPoll.counts, [1, 0]);
  assert.equal(b.donationPoll.acceptedEvents, 3);
});
test("plural donations floor each transaction, accumulate and stop at the timer deadline", () => {
  const a = new AudienceTools();
  a.startDonation({ ...donation, plural: true, timerSeconds: 1 }, 1000);
  a.ingest(paid("one", "u1", "!투표 1 좋아요", 25e8), 1001);
  a.ingest(paid("two", "u1", "!투표2", 15e8), 1002);
  a.ingest(paid("three", "u1", "!투표1", 15e8), 1003);
  assert.deepEqual(a.donationPoll.counts, [3, 1]);
  a.ingest(paid("after", "u1"), 2000);
  assert.deepEqual(a.donationPoll.counts, [3, 1]);
  assert.equal(a.donationPoll.closedAt, 2000);
});
test("invalid audience settings never replace an existing completed result", () => {
  const a = new AudienceTools();
  a.startDonation(donation, 1000);
  a.stopDonation(1100);
  for (const override of [
    { minimumMicros: 0 },
    { minimumMicros: NaN },
    { currency: "USD" },
    { plural: "yes" },
    { timerSeconds: 0 },
    { options: ["A", "A"] },
  ])
    assert.throws(() => a.startDonation({ ...donation, ...override }, 2000));
  assert.equal(a.donationPoll.openedAt, 1000);
  assert.throws(() =>
    a.startRaffle({ ...raffle, keyword: "", entryMode: "keyword" }, 1000),
  );
  assert.throws(() =>
    a.startRaffle({ ...raffle, platforms: ["demo", "chzzk"] }, 1000),
  );
});
test("platform adapters preserve paid amounts, identity and memberships while ignoring anonymous or malformed paid events", () => {
  const raw = {
    msgTypeCode: 10,
    msg: "!투표2",
    msgTime: 1001,
    msgSn: "tx1",
    profile: JSON.stringify({
      userIdHash: "u",
      nickname: "닉네임",
      streamingProperty: { subscription: {} },
    }),
    extras: JSON.stringify({ payAmount: 2500 }),
  };
  const m = parseDonation(raw);
  assert.equal(m.kind, "donation");
  assert.equal(m.amountMicros, 25e8);
  assert.equal(m.subscriber, true);
  assert.equal(m.name, "닉네임");
  assert.equal(parseDonation({ ...raw, profile: null }), null);
  assert.equal(parseDonation({ ...raw, extras: '{"payAmount":-1}' }), null);
  assert.equal(parseChat({ ...raw, msgTypeCode: 1 }).subscriber, true);
  const yt = {
    id: "sc1",
    authorDetails: {
      channelId: "u",
      displayName: "Member",
      isChatSponsor: true,
    },
    snippet: {
      type: "superChatEvent",
      publishedAt: new Date(1001).toISOString(),
      superChatDetails: {
        amountMicros: "2500000",
        currency: "USD",
        userComment: "!투표1",
      },
    },
  };
  const event = youtubeMessage(yt);
  assert.equal(event.amountMicros, 2500000);
  assert.equal(event.currency, "USD");
  assert.equal(event.subscriber, true);
  assert.equal(youtubeMessage({ ...yt, authorDetails: {} }), null);
  assert.equal(
    youtubeMessage({
      ...yt,
      snippet: {
        ...yt.snippet,
        superChatDetails: {
          amountMicros: "9007199254740992",
          currency: "USD",
          userComment: "!투표1",
        },
      },
    }),
    null,
  );
});
test("audience tools can receive connected chat without a timeline, paid events never inflate normal votes or highlights", () => {
  const e = new Engine();
  e.audience.startRaffle(raffle, 1000);
  e.ingest(chat("u1"), 1001);
  assert.equal(e.snapshot().audience.raffle.candidateCount, 1);
  e.start("timeline", 0, 1000);
  e.createPoll("Q", ["A", "B"]);
  e.audience.startDonation(donation, 1000);
  const before = e.revision;
  e.ingest(paid("tx", "u1"), 1001);
  assert.equal(e.chatCount, 0);
  assert.deepEqual(e.poll.counts, [0, 0]);
  assert.deepEqual(e.audience.donationPoll.counts, [1, 0]);
  assert.ok(e.revision > before);
});
