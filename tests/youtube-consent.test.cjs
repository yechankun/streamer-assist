const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { AuthManager } = require("../electron/oauth.cjs");
const { CaptureStore } = require("../electron/capture-store.cjs");
const { TimelineStore } = require("../electron/timeline-store.cjs");
const { Engine } = require("../electron/engine.cjs");
const { RecordStore } = require("../electron/record-store.cjs");
const { stripYoutubeRecords, cleanRecordRecovery } = require("../electron/youtube-data.cjs");
const { CommonAiService } = require("../electron/ai-service.cjs");
const { ReplayManager } = require("../electron/replay-manager.cjs");
function fixture(t, fetcher = async () => ({ ok: true })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "assist-youtube-consent-"));
  const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "test",
    encryptString: value => Buffer.from("encrypted:" + value), decryptString: value => value.toString().slice(10) };
  const makeAuth = () => new AuthManager({ file: path.join(root, "accounts.enc"), storage,
    config: { youtubeClientId: "test", youtubeClientSecret: "test" }, openBrowser: async () => {}, notify: () => {}, fetcher });
  const auth = makeAuth();
  auth.saveAccount("youtubeConsent", require("../electron/youtube-consent.cjs").acceptance({ version: require("../electron/youtube-consent.cjs").version, terms: true, privacy: true, retention: true }));
  auth.saveYoutube({ accessToken: "PRIVATE_ACCESS", refreshToken: "PRIVATE_REFRESH", expiresAt: Date.now() + 3600000, channelId: "channel", name: "Private channel" });
  const disposers = [];
  t.after(async () => {
    for (const dispose of disposers) await dispose();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^assist-youtube-consent-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, storage, auth, makeAuth, disposers };
}
test("YouTube pause persists without revoking or deleting and resume restores access", async t => {
  let requests = 0;
  const { auth, makeAuth } = fixture(t, async () => { requests++; throw Error("Unexpected network"); });
  auth.pauseYoutube(true);
  const restored = makeAuth();
  assert.equal(restored.snapshot().accounts.youtube.paused, true);
  assert.deepEqual(restored.monitoringChannels(), []);
  assert.equal((await restored.chatConfig()).youtubeStatus, "일시 중지");
  await assert.rejects(restored.getAccess("youtube"), /일시 중지/);
  restored.pauseYoutube(false);
  assert.equal(await restored.getAccess("youtube"), "PRIVATE_ACCESS");
  assert.equal(requests, 0);
});
test("revoke posts refresh token, removes account before cleanup, and coalesces retries", async t => {
  let calls = 0, cleanups = 0;
  const { auth } = fixture(t, async (url, options) => {
    calls++; assert.equal(url, "https://oauth2.googleapis.com/revoke");
    assert.equal(options.method, "POST"); assert.equal(new URLSearchParams(options.body).get("token"), "PRIVATE_REFRESH");
    assert.equal(auth.snapshot().accounts.youtube.connected, false);
    return { ok: true };
  });
  const cleanup = async () => { cleanups++; await new Promise(setImmediate); };
  await Promise.all([auth.revokeYoutube(cleanup), auth.revokeYoutube(cleanup)]);
  assert.equal(calls, 1); assert.equal(cleanups, 1);
  assert.equal(auth.snapshot().accounts.youtube.removalPending, false);
  assert.equal(auth.vault.accounts.youtube, undefined);
});
test("network failure retains only a disabled revocation ticket and resumes after restart", async t => {
  let online = false;
  const { auth, makeAuth } = fixture(t, async () => { if (!online) throw Error("PRIVATE_REFRESH"); return { ok: true }; });
  let cleanups = 0;
  await assert.rejects(auth.revokeYoutube(async () => { cleanups++; }), /인터넷 연결/);
  assert.equal(auth.snapshot().accounts.youtube.localDataDeleted, true);
  await assert.rejects(auth.getAccess("youtube"), /먼저 연결/);
  const restarted = makeAuth();
  await assert.rejects(restarted.login("youtube"), /먼저 완료/);
  online = true;
  await restarted.revokeYoutube(async () => { cleanups++; });
  assert.equal(cleanups, 1);
  assert.equal(restarted.vault.accounts.youtubeRemoval, undefined);
});
test("cleanup failure retries locally; transient/unknown Google errors never pretend success", async t => {
  let status = 503, calls = 0;
  const { auth, makeAuth } = fixture(t, async () => { calls++; return { ok: false, status, json: async () => ({ error: status === 400 ? "invalid_token" : "unavailable" }) }; });
  await assert.rejects(auth.revokeYoutube(async () => { throw Error("Disk failure"); }), /Disk failure/);
  assert.equal(calls, 1, "remote revocation is attempted even if local cleanup fails");
  const restarted = makeAuth();
  await assert.rejects(restarted.revokeYoutube(async () => {}), /재시도/);
  assert.equal(restarted.snapshot().accounts.youtube.removalPending, true);
  status = 400;
  await restarted.revokeYoutube();
  assert.equal(restarted.snapshot().accounts.youtube.removalPending, false);
});
test("a refresh racing revocation cannot restore access", async t => {
  let finish;
  const { auth } = fixture(t, () => new Promise(resolve => { finish = resolve; }));
  auth.saveYoutube({ ...auth.vault.accounts.youtube, expiresAt: 0 });
  const refreshing = auth.getAccess("youtube");
  auth.beginYoutubeRemoval();
  finish({ ok: true, json: async () => ({ access_token: "raced", expires_in: 3600 }) });
  await assert.rejects(refreshing, /변경/);
  assert.equal(auth.vault.accounts.youtube, undefined);
  assert.equal(auth.snapshot().accounts.youtube.removalPending, true);
});
test("invalid grant persists deletion intent without claiming that a Google grant was revoked", async t => {
  let invalidations = 0, calls = 0;
  const { auth, makeAuth } = fixture(t, async () => { calls++; return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) }; });
  auth.onYoutubeInvalidated = () => { invalidations++; };
  auth.saveYoutube({ ...auth.vault.accounts.youtube, expiresAt: 0 });
  await assert.rejects(auth.getAccess("youtube"), /정리 후/);
  assert.equal(invalidations, 1);
  const restored = makeAuth();
  assert.equal(restored.vault.accounts.youtubeRemoval.reason, "invalidated");
  const result = await restored.revokeYoutube(async () => {});
  assert.equal(result.deleted, true); assert.equal(result.revoked, false);
  assert.equal(calls, 1, "expired/invalidated credentials are not reused for requests");
});
test("mixed original records, cached SQLite profiles and viewer samples are purged selectively", async t => {
  const { root, storage, disposers } = fixture(t);
  const store = new CaptureStore(path.join(root, "timeline-data"), storage);
  disposers.push(() => store.shutdown());
  const engine = new Engine({}, { journal: store }); engine.start("user title");
  const session = engine.current;
  for (const platform of ["youtube", "twitch", "chzzk"])
    engine.ingest({ platform, id: platform, userId: platform + "-user", name: platform + "-name", text: platform + "-text", timestamp: Date.now() });
  engine.sampleViewers([{ platform: "youtube", viewers: 10, live: true }, { platform: "twitch", viewers: 3, live: true }]);
  await store.flush(session);
  // Force the analysis SQLite/cache to exist as well.
  await store.summary(session);
  const result = await store.deletePlatform([session], "youtube");
  assert.equal(result.updated[0].telemetry.chats, 2);
  assert.equal(result.updated[0].telemetry.participants, 2);
  const rows = await store.queryAll([session], { limit: 100 });
  assert.deepEqual(rows.events.map(row => row.platform).sort(), ["chzzk", "twitch"]);
  const events = []; for await (const event of store.events(session)) events.push(event);
  assert.equal(JSON.stringify(events).includes("youtube"), false);
  assert.deepEqual(events.find(e => e.type === "viewers").sources.map(s => s.platform), ["twitch"]);
  const summary = await store.summary(session);
  assert.equal(JSON.stringify(summary).includes("youtube-name"), false);
  await store.deletePlatform([session], "youtube");
  assert.equal((await store.queryAll([session], { limit: 100 })).events.length, 2);
  await store.shutdown();
});
test("interrupted chunk compaction recovers its intent without losing another platform", async t => {
  const { root, storage } = fixture(t);
  const directory = path.join(root, "legacy-timeline"), store = new TimelineStore(directory, storage, { chunkEventLimit: 1 });
  const session = { id: crypto.randomUUID(), startedAt: Date.now() };
  store.append(session, { type: "chat", platform: "youtube", text: "private", timestamp: session.startedAt });
  store.append(session, { type: "chat", platform: "twitch", text: "keep", timestamp: session.startedAt }); store.flush(session);
  const original = store.compactChunk.bind(store); let chunks = 0;
  store.compactChunk = (...args) => { if (++chunks === 2) throw Error("Interrupted"); return original(...args); };
  await assert.rejects(store.deletePlatform([session], "youtube"), /Interrupted/);
  assert.ok(fs.existsSync(path.join(directory, session.id, "deletion.enc")));
  const recovered = new TimelineStore(directory, storage);
  recovered.recoverDeletion(session.id);
  const rows = await recovered.queryAll([session], { limit: 100 });
  assert.deepEqual(rows.events.map(e => e.text), ["keep"]);
  assert.equal(fs.existsSync(path.join(directory, session.id, "deletion.enc")), false);
});
test("session metadata, mixed results and encrypted legacy recovery remove YouTube but keep manual bookmarks", t => {
  const { root, storage } = fixture(t);
  const saved = { sessions: [{ id: "test", title: "My title", sources: [{ platform: "youtube" }, { platform: "twitch" }], markers: [{ kind: "manual", label: "keep" }, { kind: "auto", evidence: { samples: ["private"] } }], polls: [{ platforms: ["youtube", "twitch"], youtubeId: "secret" }, { platforms: ["twitch"], counts: [1, 2] }] }],
    seen: ["record:chat:youtube:secret", "twitch:keep"], voters: [["youtube:private", 1], ["twitch:keep", 0]],
    audience: { raffle: { platforms: ["youtube", "twitch"], candidates: [{ platform: "youtube" }, { platform: "twitch" }], draws: [] }, donationPoll: { platforms: ["youtube", "twitch"] } } };
  const clean = stripYoutubeRecords(saved);
  assert.equal(JSON.stringify(clean).includes("youtube"), false);
  assert.deepEqual(clean.sessions[0].markers, [{ kind: "manual", label: "keep" }]);
  assert.equal(clean.sessions[0].polls.length, 1); assert.equal(clean.audience.raffle.candidates[0].platform, "twitch");
  const records = new RecordStore(root, storage); records.save(saved);
  const backup = path.join(root, "records.enc.corrupt-1"); fs.copyFileSync(records.file, backup);
  cleanRecordRecovery(records);
  assert.equal(storage.decryptString(Buffer.from(fs.readFileSync(backup, "utf8"), "base64")).includes("youtube"), false);
  const separate = { id: "separate", sources: [{ platform: "twitch" }], markers: [{ kind: "auto", label: "keep twitch analysis" }], analysisComputedAt: 5000 };
  const preserved = stripYoutubeRecords({ sessions: [separate] }, [{ id: "separate", removed: false, telemetry: { chats: 3 } }]);
  assert.deepEqual(preserved.sessions[0].markers, separate.markers);
  assert.equal(preserved.sessions[0].analysisComputedAt, 5000);
  const resumed = stripYoutubeRecords({ sessions: [separate] }, [{ id: "separate", removed: true, telemetry: { chats: 3 } }]);
  assert.deepEqual(resumed.sessions[0].markers, [], "durable affected-session provenance wins over incomplete metadata");
});
test("AI revocation awaits canceled jobs and preserves an explicitly separate platform/session", async t => {
  const { root, storage } = fixture(t);
  const service = new CommonAiService({ root, storage });
  service.results = [{ id: "mixed", scope: { platform: "" } }, { id: "yt", scope: { platform: "youtube" } },
    { id: "keep", scope: { platform: "twitch", sessionId: "twitch-only" } }, { id: "marker-derived", scope: { platform: "twitch", sessionId: "mixed-session" } }];
  const controller = new AbortController(); let done = false;
  const job = { id: crypto.randomUUID(), mode: "api", scope: { platform: "youtube" }, controller,
    completion: new Promise(resolve => controller.signal.addEventListener("abort", () => setImmediate(() => { done = true; resolve(); }), { once: true })) };
  service.jobs.set(job.id, job);
  await service.deleteResultsForPlatform("youtube", ["mixed-session"]);
  assert.equal(done, true); assert.equal(service.jobs.size, 0);
  assert.deepEqual(service.results.map(r => r.id), ["keep"]);
});
test("real mixed raffle keeps other-platform candidates; a separate raffle keeps its draws", t => {
  fixture(t);
  const engine = new Engine();
  const input = platforms => ({ platforms, entryMode: "any", keyword: "", subscribersOnly: false, excludeWinners: true, title: "My raffle" });
  engine.audience.startRaffle(input(["youtube", "twitch"]), 1000);
  for (const platform of ["youtube", "twitch"]) engine.audience.ingest({ platform, userId: platform, name: platform, text: "hello" }, 2000);
  engine.audience.stopRaffle(2500); engine.audience.drawRaffle(true, 3000, () => 1);
  const cleaned = new Engine(stripYoutubeRecords(engine.persisted()));
  assert.equal(cleaned.audience.candidates.size, 1);
  assert.deepEqual(cleaned.audience.raffle.config.platforms, ["twitch"]);
  assert.deepEqual(cleaned.audience.raffle.draws, []);
  assert.equal(cleaned.audience.raffle.latestDraw, null);
  engine.audience.startRaffle(input(["twitch"]), 4000);
  engine.audience.ingest({ platform: "twitch", userId: "keep", name: "keep", text: "hello" }, 4500);
  engine.audience.stopRaffle(4600); engine.audience.drawRaffle(true, 5000, () => 0);
  const separate = new Engine(stripYoutubeRecords(engine.persisted()));
  assert.equal(separate.audience.raffle.draws.length, 1);
  assert.equal(separate.audience.raffle.draws[0].winner.name, "keep");
});
test("replay consent cleanup deletes only matching YouTube work and pauses mixed jobs", async t => {
  const { root } = fixture(t);
  const key = crypto.randomBytes(32), sessionId = crypto.randomUUID();
  const replay = new ReplayManager({ root, store: { key }, engine: { sessions: [{ id: sessionId }] }, providers: {}, tools: { snapshot: () => ({}) } });
  const yt = { platform: "youtube", videoId: "abcdefghijk", saved: 10 }, twitch = { platform: "twitch", videoId: "123", saved: 5 };
  replay.jobs.set(sessionId, { sessionId, sources: [yt, twitch], status: "waiting", error: "private", received: 15 });
  for (const source of [yt, twitch]) fs.mkdirSync(path.join(replay.root, crypto.createHash("sha256").update(sessionId + source.platform + source.videoId).digest("hex")));
  await replay.removeYoutube();
  assert.equal(fs.readdirSync(replay.root).length, 1);
  assert.deepEqual(replay.jobs.get(sessionId).sources, [twitch]);
  assert.equal(replay.jobs.get(sessionId).status, "paused");
});
