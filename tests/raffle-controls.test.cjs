const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AudienceTools } = require("../electron/audience.cjs");
const { stripYoutubeRecords } = require("../electron/youtube-data.cjs");
const config = { title: "추첨", platforms: ["chzzk", "youtube", "twitch"], entryMode: "any", keyword: "!참여", subscribersOnly: false, excludeWinners: true, timerSeconds: null };
const chat = (userId, platform = "chzzk", text = "참여") => ({ platform, userId, id: userId + text, name: userId, text });
const create = () => { const a = new AudienceTools(); a.startRaffle(config, 1000); a.ingest(chat("one"), 1100); a.ingest(chat("two", "youtube"), 1101); a.ingest(chat("three", "twitch"), 1102); return a; };
test("drawing closes recruitment atomically, freezes entrants, and keeps winner chat running", () => {
  const a = create(), draw = a.drawRaffle(false, 1200, () => 0);
  assert.equal(a.raffle.active, false); assert.equal(a.raffle.closedAt, 1200);
  a.ingest(chat("late"), 1300); assert.equal(a.candidates.size, 3);
  a.ingest(chat(draw.winner.userId, draw.winner.platform, "당첨 후 채팅"), 1301);
  assert.equal(a.winnerChat.messages.at(-1).text, "당첨 후 채팅");
  assert.equal(a.getRaffleReel(draw.id).length, 3);
});
test("empty and failed random draws leave recruitment open", () => {
  const a = new AudienceTools(); a.startRaffle(config, 1000);
  assert.throws(() => a.drawRaffle(false, 1100, () => 0)); assert.equal(a.raffle.active, true);
  a.ingest(chat("one"), 1200);
  assert.throws(() => a.drawRaffle(false, 1300, () => -1)); assert.equal(a.raffle.active, true);
});
test("closed raffle allows all filters off and reversible partial changes without losing entrants or history", () => {
  const a = create(); a.drawRaffle(true, 1200, () => 0); const id = a.raffle.id;
  a.configureRaffle({ id, changes: { platforms: [] } }, 1300);
  a.configureRaffle({ id, changes: { subscribersOnly: true } }, 1301);
  a.configureRaffle({ id, changes: { excludeWinners: false } }, 1302);
  assert.equal(a.raffle.active, false); assert.deepEqual(a.raffle.config.platforms, []);
  assert.equal(a.snapshot().raffle.eligibleCount, 0); assert.equal(a.candidates.size, 3); assert.equal(a.raffle.draws.length, 1);
  a.configureRaffle({ id, changes: { platforms: ["chzzk", "twitch"], subscribersOnly: false } }, 1400);
  assert.equal(a.snapshot().raffle.eligibleCount, 2); assert.equal(a.raffle.config.excludeWinners, false);
  a.resumeRaffle(id, 1500); a.ingest(chat("new"), 1600);
  assert.equal(a.candidates.size, 4); assert.equal(a.raffle.id, id); assert.equal(a.raffle.openedAt, 1000);
  assert.equal(a.raffle.draws.length, 1);
});
test("timer starts at confirmation time and restarts a closed roster without clearing data", () => {
  const a = create(), id = a.raffle.id; a.stopRaffle(1200);
  a.configureRaffle({ id, changes: { timerSeconds: 30 } }, 10000);
  assert.equal(a.raffle.active, true); assert.equal(a.raffle.endsAt, 40000); assert.equal(a.raffle.closedAt, undefined);
  a.configureRaffle({ id, changes: { subscribersOnly: true } }, 11000); assert.equal(a.raffle.endsAt, 40000);
  a.configureRaffle({ id, changes: { timerSeconds: null } }, 12000); assert.equal(a.raffle.endsAt, null);
  a.configureRaffle({ id, changes: { timerSeconds: 1 } }, 20000); a.expire(21000);
  assert.equal(a.raffle.active, false); assert.equal(a.raffle.closedAt, 21000); assert.equal(a.candidates.size, 3);
});
test("invalid partial changes and edits during a draw do not mutate the raffle", () => {
  const a = create(), id = a.raffle.id;
  for (const changes of [{ platforms: ["invalid"] }, { platforms: ["demo", "chzzk"] }, { timerSeconds: 0 }, { active: true }, { subscribersOnly: 1 }, { entryMode: "keyword", keyword: "" }]) {
    const before = JSON.stringify(a.persisted()); assert.throws(() => a.configureRaffle({ id, changes }, 1200)); assert.equal(JSON.stringify(a.persisted()), before);
  }
  assert.throws(() => a.configureRaffle({ id: "old", changes: { platforms: [] } }, 1200));
  a.drawRaffle(false, 1300, () => 0);
  assert.throws(() => a.configureRaffle({ id, changes: { excludeWinners: false } }, 1400));
  assert.throws(() => a.resumeRaffle(id, 1400));
});
test("YouTube cleanup preserves non-YouTube candidates when every platform filter is disabled", () => {
  const a = create(); a.configureRaffle({ id: a.raffle.id, changes: { platforms: [] } }, 1200);
  const clean = stripYoutubeRecords({ audience: a.persisted() });
  assert.deepEqual(clean.audience.raffle.config.platforms, []);
  assert.deepEqual(clean.audience.raffle.candidates.map(p => p.platform), ["chzzk", "twitch"]);
});
test("rapid platform and rule toggles merge against the current backend state", () => {
  const a = create(), id = a.raffle.id;
  for (const platform of ["chzzk", "youtube", "twitch"]) a.toggleRaffle({ id, field: "platforms", platform }, 1200);
  assert.deepEqual(a.raffle.config.platforms, []); assert.equal(a.eligible().length, 0);
  a.toggleRaffle({ id, field: "subscribersOnly" }, 1201);
  a.toggleRaffle({ id, field: "excludeWinners" }, 1201);
  a.toggleRaffle({ id, field: "subscribersOnly" }, 1201);
  assert.equal(a.raffle.config.subscribersOnly, false); assert.equal(a.raffle.config.excludeWinners, false);
  for (const platform of ["youtube", "chzzk"]) a.toggleRaffle({ id, field: "platforms", platform }, 1202);
  assert.deepEqual(a.raffle.config.platforms, ["youtube", "chzzk"]);
  for (const bad of [{ field: "active" }, { field: "platforms", platform: "bad" }, { field: "platforms", platform: "demo" }])
    assert.throws(() => a.toggleRaffle({ id, ...bad }, 1203));
});
