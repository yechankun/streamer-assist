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
test('paged participant wall includes early entrants outside the recent-100 snapshot and preserves order, updates and restart', () => {
  const a=new AudienceTools();a.startRaffle(raffle,1000);
  for(let i=0;i<135;i++)a.ingest(chat('viewer-'+i),1001+i);
  const id=a.raffle.id;
  assert.equal(a.snapshot().raffle.candidates.length,100);
  assert.equal(a.getRaffleParticipants({id,offset:0,limit:20}).participants[0].userId,'viewer-0');
  const final=a.getRaffleParticipants({id,offset:120,limit:20});
  assert.equal(final.total,135);assert.equal(final.participants.length,15);assert.equal(final.participants.at(-1).userId,'viewer-134');
  const revision=a.snapshot().raffle.rosterRevision;
  a.ingest(chat('viewer-0',{name:'바뀐 이름'}),1200);
  assert.ok(a.snapshot().raffle.rosterRevision>revision);
  assert.equal(a.getRaffleParticipants({id,offset:0,limit:1}).participants[0].name,'바뀐 이름');
  const restored=new AudienceTools(a.persisted());
  assert.equal(restored.getRaffleParticipants({id,offset:0,limit:1}).participants[0].name,'바뀐 이름');
  for(const input of [{id:'stale'},{id,offset:-1},{id,offset:0.5},{id,limit:121},{id,limit:0}])assert.throws(()=>a.getRaffleParticipants(input));
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
test("unchanged recruitment snapshots reuse bounded data and invalidate after membership changes", () => {
  const a = new AudienceTools(); a.startRaffle(raffle, 1000);
  const empty = a.snapshot(); assert.equal(a.snapshot(), empty);
  a.ingest(chat("viewer", {subscriber:true}), 1001);
  const joined = a.snapshot(); assert.notEqual(joined, empty); assert.equal(joined.raffle.candidateCount, 1);
  for (let i = 0; i < 1000; i++) a.ingest(chat("viewer", {subscriber:true}), 1002);
  assert.equal(a.snapshot(), joined, "repeated participant messages do not rebuild an unchanged roster");
  a.ingest(chat("viewer", {name:"new name",subscriber:false}), 1003);
  assert.notEqual(a.snapshot(), joined); assert.equal(a.snapshot().raffle.candidates[0].name,"new name");
});
test("completed playback memory is released without losing candidates, winners or draw history", () => {
  const a = new AudienceTools(); a.startRaffle(raffle,1000);
  for(let i=0;i<137;i++)a.ingest(chat("viewer-"+i),1001);
  const draw=a.drawRaffle(false,1010,()=>55);
  assert.equal(a.releaseRaffleReel(4009),false);assert.equal(a.getRaffleReel(draw.id).length,137);
  assert.equal(a.releaseRaffleReel(4010),true);assert.equal(a.persisted().raffleReel,null);
  assert.equal(a.snapshot().raffle.candidateCount,137);assert.deepEqual(a.snapshot().raffle.latestDraw.winner,draw.winner);
  assert.deepEqual(a.getRaffleReel(draw.id),[draw.winner]);assert.equal(a.releaseRaffleReel(9999),false);
});

test("winner preview freezes the latest chat and follows only the exact winner even after recruitment closes", () => {
  const a = new AudienceTools();
  a.startRaffle({ ...raffle, entryMode: "keyword", keyword: "!참여" }, 1000);
  a.ingest(chat("winner", { id: "entry", text: "!참여", timestamp: 1001 }), 1001);
  a.ingest(chat("winner", { id: "latest", text: "마지막으로 남긴 채팅", timestamp: 1004 }), 1004);
  a.stopRaffle(1005);
  a.ingest(chat("winner", { id: "after-recruitment", text: "모집이 끝났네요", timestamp: 1006 }), 1006);
  const draw = a.drawRaffle(false, 1010, () => 0);
  assert.equal(a.snapshot().raffle.winnerChat.lastMessage.text, "모집이 끝났네요");
  a.ingest(chat("winner", { platform: "youtube", id: "other-platform", text: "다른 플랫폼", timestamp: 1011 }), 1011);
  a.ingest(chat("other", { name: "winner", id: "same-name", text: "동명이인", timestamp: 1011 }), 1011);
  a.ingest(paid("donation", "winner", "후원", 1e9, { timestamp: 1011 }), 1011);
  a.ingest(chat("winner", { id: "stale", text: "지연된 옛 채팅", timestamp: 1009 }), 1011);
  a.ingest(chat("winner", { id: "live", text: "제가 당첨됐나요?", timestamp: 1012 }), 1012);
  a.ingest(chat("winner", { id: "live", text: "제가 당첨됐나요?", timestamp: 1012 }), 1013);
  const details = a.snapshot().raffle.winnerChat;
  assert.equal(details.drawId, draw.id);
  assert.equal(details.lastMessage.text, "모집이 끝났네요", "draw-time message stays fixed");
  assert.deepEqual(details.messages.map(row => row.text), ["제가 당첨됐나요?"], "animation-time chat is retained without duplicates");
  assert.equal(a.snapshot().raffle.candidateCount, 1);
});

test("winner chat is bounded, released on close, replaced on redraw and never persisted", () => {
  const a = new AudienceTools(); a.startRaffle({ ...raffle, excludeWinners: false }, 1000);
  a.ingest(chat("winner", { id: "entry", text: "첫 채팅", timestamp: 1001 }), 1001);
  const first = a.drawRaffle(true, 1010, () => 0);
  for (let i = 0; i < 80; i++) a.ingest(chat("winner", { id: "live-" + i, text: "새 채팅 " + i, timestamp: 1011 + i }), 1011 + i);
  const details = a.snapshot().raffle.winnerChat;
  assert.equal(details.messageCount, 80); assert.equal(details.messages.length, 50);
  assert.equal(details.messages[0].text, "새 채팅 30"); assert.equal(details.lastMessage.text, "첫 채팅");
  assert.equal(a.persisted().raffle.winnerChat, undefined);
  assert.equal(new AudienceTools(a.persisted()).snapshot().raffle.winnerChat, null);
  assert.throws(() => a.closeWinnerChat("wrong-result"));
  a.closeWinnerChat(first.id); const closed = a.snapshot();
  a.ingest(chat("winner", { id: "closed", text: "닫은 뒤 채팅", timestamp: 1100 }), 1100);
  assert.equal(a.snapshot(), closed, "closed result stops live preview broadcasts");
  const next = a.drawRaffle(true, 1110, () => 0);
  assert.notEqual(next.id, first.id); assert.equal(a.snapshot().raffle.winnerChat.lastMessage.text, "닫은 뒤 채팅");
  assert.equal(a.snapshot().raffle.winnerChat.messages.length, 0);
  a.stopRaffle(1120);a.startRaffle(raffle, 1121);
  assert.equal(a.snapshot().raffle.winnerChat, null); assert.equal(a.lastChats.size, 0);
});

test("last-chat previews include entrants beyond the recent list and former recruitment limit", () => {
  const a = new AudienceTools(); a.startRaffle(raffle, 1000);
  for (let i = 0; i < 10001; i++) a.ingest(chat("viewer-" + i, { text: "참여 " + i }), 1001);
  assert.equal(a.getRaffleParticipants({id:a.raffle.id,offset:10000,limit:1}).participants[0].userId,"viewer-10000");
  assert.equal(a.snapshot().raffle.candidates.length, 100);
  a.drawRaffle(true, 1010, () => 0);
  assert.equal(a.snapshot().raffle.winnerChat.lastMessage.text, "참여 0");
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
