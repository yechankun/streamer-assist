const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { AuthManager } = require("../electron/oauth.cjs");
const consent = require("../electron/youtube-consent.cjs");
const { CaptureStore } = require("../electron/capture-store.cjs"), { Engine } = require("../electron/engine.cjs");
const { expireYoutubeRecords } = require("../electron/youtube-data.cjs");
const { ReplayManager } = require("../electron/replay-manager.cjs"), { ReplayProviders } = require("../electron/replay-providers.cjs");
const accepted = () => ({ version: consent.version, terms: true, privacy: true, retention: true });
function fixture(t, fetcher = async () => { throw Error("Unexpected HTTP"); }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "assist-policy-proof-")), disposers = [];
  const storage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from("encrypted:" + s), decryptString: d => d.toString().slice(10) };
  const makeAuth = () => new AuthManager({ file: path.join(root, "accounts.enc"), storage, config: { youtubeClientId: "fake", youtubeClientSecret: "fake" }, openBrowser: async () => { throw Error("Unexpected browser"); }, notify: () => {}, fetcher });
  const auth = makeAuth();
  t.after(async () => { for (const dispose of disposers) await dispose(); assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^assist-policy-proof-/); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, storage, auth, makeAuth, disposers };
}
test("missing, partial and obsolete consent cannot open OAuth or enable collection", async t => {
  const { auth, makeAuth } = fixture(t);
  auth.saveYoutube({ accessToken: "fake", refreshToken: "fake", expiresAt: Date.now() + 3600000, channelId: "channel" });
  await assert.rejects(auth.login("youtube"), /동의/);
  await assert.rejects(auth.getAccess("youtube"), /동의/);
  assert.deepEqual(auth.monitoringChannels(), []);
  assert.equal((await auth.chatConfig()).youtubeStatus, "약관 확인 필요");
  assert.throws(() => auth.acceptYoutubeConsent({ ...accepted(), retention: false }), /동의/);
  assert.throws(() => auth.acceptYoutubeConsent({ ...accepted(), version: "old" }), /갱신/);
  auth.acceptYoutubeConsent(accepted());
  await assert.rejects(auth.getAccess("youtube"), /기록 정리/);
  assert.equal(makeAuth().hasYoutubeConsent(), true);
  auth.saveAccount("youtubeMaintenance", null);
  assert.equal(await auth.getAccess("youtube"), "fake");
  auth.saveAccount("youtubeConsent", { ...auth.vault.accounts.youtubeConsent, version: "old" });
  await assert.rejects(auth.getAccess("youtube"), /동의/);
});
test("consent persistence failure rolls back acceptance and a resumed cleanup keeps its provenance", t => {
  const { auth } = fixture(t);
  const save = auth.vault.save.bind(auth.vault);
  auth.vault.save = () => { throw Error("Disk failure"); };
  assert.throws(() => auth.acceptYoutubeConsent(accepted()), /Disk/);
  assert.equal(auth.hasYoutubeConsent(), false);
  auth.vault.save = save; auth.acceptYoutubeConsent(accepted());
  const ticket = { ...auth.vault.accounts.youtubeMaintenance, affectedSessionIds: ["keep"] };
  auth.saveAccount("youtubeMaintenance", ticket); auth.acceptYoutubeConsent(accepted());
  assert.deepEqual(auth.vault.accounts.youtubeMaintenance, ticket);
});
test("paused accounts are periodically verified and cached without resuming chat", async t => {
  const requests = [];
  const { auth } = fixture(t, async (url, options) => {
    requests.push(url);
    if (url.includes("/token")) { assert.equal(new URLSearchParams(options.body).get("refresh_token"), "refresh"); return { ok: true, json: async () => ({ access_token: "renewed", expires_in: 3600 }) }; }
    return { ok: true, json: async () => ({ items: [{ id: "channel", snippet: { title: "Updated channel" } }] }) };
  });
  auth.saveAccount("youtubeConsent", consent.acceptance(accepted()));
  auth.saveYoutube({ accessToken: "old", refreshToken: "refresh", expiresAt: 0, channelId: "channel", name: "old", paused: true });
  await auth.verifyYoutubeAuthorization();
  assert.equal(requests.length, 2); assert.equal(auth.vault.accounts.youtube.name, "Updated channel");
  assert.equal(auth.vault.accounts.youtube.paused, true); assert.deepEqual(auth.monitoringChannels(), []);
  await auth.verifyYoutubeAuthorization(); assert.equal(requests.length, 2);
});
test("transient verification failure preserves consent; invalid grant creates durable deletion intent", async t => {
  let invalid = false;
  const { auth, makeAuth } = fixture(t, async () => { if (!invalid) throw Error("Offline"); return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) }; });
  auth.saveAccount("youtubeConsent", consent.acceptance(accepted()));
  auth.saveYoutube({ accessToken: "old", refreshToken: "refresh", expiresAt: 0, channelId: "channel", paused: true });
  await assert.rejects(auth.verifyYoutubeAuthorization(), /Offline/);
  assert.equal(auth.snapshot().accounts.youtube.connected, true);
  invalid = true; await assert.rejects(auth.verifyYoutubeAuthorization(), /정리 후/);
  assert.equal(makeAuth().snapshot().accounts.youtube.removalPending, true);
});
test("retention compaction removes only the expired archive's YouTube originals", async t => {
  const { root, storage, disposers } = fixture(t), store = new CaptureStore(path.join(root, "timeline"), storage);
  disposers.push(() => store.shutdown());
  const engine = new Engine({}, { journal: store }), now = Date.now(), old = now - 31 * 86400000;
  for (const started of [old, now]) {
    engine.start("archive", 0, started);
    for (const platform of ["youtube", "twitch"]) engine.ingest({ platform, id: platform + started, userId: platform, text: platform + " original", timestamp: started + 1 }, started + 1);
    engine.mark("manual", "manual", null, started + 2); await store.flush(engine.current); engine.stop(started + 1000);
  }
  const [recent, expired] = engine.sessions;
  const preview = await store.platformInventory([expired], "youtube"); assert.equal(preview.chats, 1);
  const result = await store.deletePlatform([expired], "youtube", { includeOrphans: false });
  const cleaned = expireYoutubeRecords(engine.persisted(), result.updated, now - 30 * 86400000);
  assert.equal((await store.queryAll([expired], { limit: 100 })).events[0].platform, "twitch");
  assert.deepEqual((await store.queryAll([recent], { limit: 100 })).events.map(e => e.platform).sort(), ["twitch", "youtube"]);
  assert.equal(cleaned.sessions[0].youtubeRetentionStartedAt, recent.youtubeRetentionStartedAt);
  assert.equal(cleaned.sessions[1].markers[0].label, "manual");
});
test("YouTube is recorded through the live API when other platforms use replay mode", async t => {
  const { root, storage, disposers } = fixture(t), store = new CaptureStore(path.join(root, "timeline"), storage);
  disposers.push(() => store.shutdown()); const engine = new Engine({}, { journal: store }); engine.start("live fallback", 0, Date.now(), { chatCaptureMode: "replay" });
  for (const platform of ["youtube", "chzzk"]) engine.ingest({ platform, userId: platform, id: platform, text: "original", timestamp: Date.now() });
  await store.flush(engine.current);
  const rows = await store.queryAll([engine.current], { limit: 100 }); assert.deepEqual(rows.events.map(e => e.platform), ["youtube"]);
  assert.equal(engine.current.youtubeLiveCaptured, true);
});
test("unsupported YouTube replay never invokes tools/providers or mutates an existing job", async t => {
  const { root } = fixture(t); const session = { id: crypto.randomUUID(), startedAt: 1, endedAt: 2, chatCaptureMode: "replay" };
  const manager = new ReplayManager({ root, store: { key: crypto.randomBytes(32) }, engine: { sessions: [session] }, tools: { snapshot: () => [] }, providers: { collect: () => assert.fail("Provider must not run") } });
  const job = { sessionId: session.id, status: "paused", sources: [{ platform: "twitch", videoId: "123", url: "https://www.twitch.tv/videos/123" }] }; manager.jobs.set(session.id, job);
  await assert.rejects(manager.start(session.id, { sources: ["https://www.youtube.com/watch?v=abcdefghijk"] }), /지원하지 않습니다/);
  assert.deepEqual(manager.jobs.get(session.id), job);
  const providers = new ReplayProviders({ tools: { ensure: () => assert.fail("Downloader must not run") } });
  await assert.rejects(async () => { for await (const _ of providers.collect({ platform: "youtube" })) {} }, /지원하지 않습니다/);
});
test("YouTube-only broadcasts use stored live records and never enter an automatic replay retry loop", async t => {
  const { root } = fixture(t), id = crypto.randomUUID();
  const session = { id, startedAt: 1, endedAt: 2, chatCaptureMode: "replay", sources: [{ platform: "youtube", broadcastId: "abcdefghijk" }], youtubeLiveCaptured: true };
  const manager = new ReplayManager({ root, store: { key: crypto.randomBytes(32) }, engine: { sessions: [session] }, tools: { snapshot: () => [] }, providers: { discover: () => assert.fail("Unsupported discovery must not run") } });
  manager.afterStop(session);
  assert.equal(manager.jobs.size, 0); assert.equal(manager.nextAt, null);
  await assert.rejects(manager.start(id), /전체 채팅 조회 API/);
  manager.jobs.set(id, { sessionId: id, status: "waiting", nextAt: 1, sources: [{ platform: "youtube", videoId: "abcdefghijk" }] });
  manager.save();
  const restored = new ReplayManager({ root, store: manager.store, engine: manager.engine, tools: manager.tools, providers: manager.providers });
  assert.equal(restored.jobs.get(id).status, "paused"); assert.equal(restored.nextAt, null);
  manager.jobs.set(id, { sessionId: id, status: "waiting", nextAt: 1, sources: [] }); manager.save();
  const undiscovered = new ReplayManager({ root, store: manager.store, engine: manager.engine, tools: manager.tools, providers: manager.providers });
  assert.equal(undiscovered.jobs.get(id).status, "paused"); assert.equal(undiscovered.nextAt, null);
});
test("retention preserves a user's manual suppression of an ongoing broadcast", t => {
  fixture(t);
  const suppression = [["youtube:channel", "youtube:channel:active-broadcast"]];
  const saved = { current: { id: crypto.randomUUID(), startedAt: Date.now(), sources: [{ platform: "youtube" }], markers: [] }, sessions: [], monitorSuppression: suppression };
  const cleaned = expireYoutubeRecords(saved, [], Date.now() - 30 * 86400000);
  assert.deepEqual(cleaned.monitorSuppression, suppression);
});
