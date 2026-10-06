const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { TimelineStore } = require("../electron/timeline-store.cjs");
const { Engine } = require("../electron/engine.cjs");
const {
  recordingDecision,
  BroadcastMonitor,
  BroadcastReaders,
  parseStartedAt,
  viewerCount,
} = require("../electron/broadcast-monitor.cjs");
function storage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), data]);
    },
    decryptString(data) {
      const d = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        data.subarray(0, 12),
      );
      d.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString(
        "utf8",
      );
    },
  };
}
function fixture(t) {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "streamer-timeline-test-"),
    ),
    secure = storage();
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.ok(
      resolved.startsWith(
        fs.realpathSync(os.tmpdir()) + path.sep + "streamer-timeline-test-",
      ),
    );
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const journal = new TimelineStore(directory, secure),
    engine = new Engine({}, { journal });
  engine.start("분석 테스트", 0, 100000);
  return { directory, secure, journal, engine };
}
test("any live platform starts recording; only confirmed all-offline ends; errors and manual notes remain active", () => {
  const live = [
    { platform: "youtube", live: false },
    { platform: "chzzk", live: true, title: "방송", startedAt: 1000 },
  ];
  assert.deepEqual(
    recordingDecision(null, live, true, () => true, 5000),
    { action: "start", title: "방송", startedAt: 1000 },
  );
  const session = { sources: [{ platform: "chzzk" }] };
  assert.equal(recordingDecision(session, live, true).action, "none");
  assert.equal(
    recordingDecision(
      session,
      [{ live: false }, { live: null, error: "network" }],
      true,
    ).action,
    "none",
  );
  assert.equal(
    recordingDecision(session, [{ live: false }, { live: false }], true).action,
    "stop",
  );
  assert.equal(
    recordingDecision({ sources: [] }, [{ live: false }], true).action,
    "none",
  );
  assert.equal(recordingDecision(null, live, false).action, "none");
  assert.equal(recordingDecision(null, live, true, () => false).action, "none");
});
test("monitor continues polling, separates failures from offline, and ignores stale configuration replies", async () => {
  let now = 1000,
    timer,
    updates = [],
    fail = false;
  const monitor = new BroadcastMonitor({
    reader: {
      read: async (c) => {
        if (fail) throw Error("offline unknown");
        return { ...c, live: true, broadcastId: "live", viewers: 10 };
      },
    },
    onUpdate: (i) => updates.push(i),
    clock: () => now,
    schedule: (fn) => (timer = fn),
    cancel: () => {},
  });
  monitor.configure([{ platform: "youtube", channelId: "channel" }]);
  await new Promise((r) => setImmediate(r));
  assert.equal(updates.length, 1);
  monitor.suppressCurrent();
  assert.equal(monitor.allow(updates[0][0]), false);
  now += 30000;
  timer();
  await new Promise((r) => setImmediate(r));
  assert.equal(updates.length, 2);
  fail = true;
  timer();
  await new Promise((r) => setImmediate(r));
  assert.equal(updates.at(-1)[0].live, null);
  assert.equal(updates.at(-1)[0].viewers, null);
  monitor.stop();
  let finish;
  const stale = new BroadcastMonitor({
    reader: { read: () => new Promise((r) => (finish = r)) },
    onUpdate: () => {
      throw Error("stale callback");
    },
    schedule: () => 0,
    cancel: () => {},
  });
  stale.configure([{ platform: "chzzk", channelId: "old" }]);
  stale.stop();
  finish({ live: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(stale.active, false);
});
test("chat and paid events persist encrypted with original time, stable viewer identities, profile changes, and replay dedup", async (t) => {
  const f = fixture(t),
    chat = {
      platform: "youtube",
      userId: "public-account",
      name: "시청자A",
      subscriber: true,
      roles: ["moderator"],
      id: "event-1",
      text: "ㅋㅋㅋ 다음 게임은 뭐예요?",
      timestamp: 103000,
    };
  f.engine.ingest(chat, 106000);
  f.engine.ingest(chat, 107000);
  f.engine.ingest(
    {
      ...chat,
      id: "event-2",
      name: "새 닉네임",
      text: "와! 대박",
      timestamp: 108000,
    },
    109000,
  );
  f.engine.ingest(
    {
      ...chat,
      id: "gift",
      name: "새 닉네임",
      kind: "donation",
      amountMicros: 5000000,
      currency: "USD",
      timestamp: 110000,
    },
    111000,
  );
  f.engine.ingest(
    { ...chat, id: "other", platform: "chzzk", timestamp: 112000 },
    113000,
  );
  f.engine.sampleViewers(
    [
      { platform: "youtube", live: true, viewers: null },
      { platform: "chzzk", live: true, viewers: 42 },
    ],
    114000,
  );
  assert.equal(f.engine.current.telemetry.chats, 3);
  assert.equal(f.engine.current.telemetry.donations, 1);
  f.journal.flush(f.engine.current);
  for (const name of fs.readdirSync(f.journal.folder(f.engine.current.id)))
    assert.ok(
      !fs
        .readFileSync(
          path.join(f.journal.folder(f.engine.current.id), name),
          "utf8",
        )
        .includes("시청자"),
    );
  const saved = f.engine.persisted(),
    restored = new TimelineStore(f.directory, f.secure),
    resumed = new Engine(saved, { journal: restored });
  resumed.ingest(chat, 115000);
  const result = await restored.query(resumed.current, { limit: 10 });
  assert.equal(result.events.length, 4);
  const first = result.events.find((e) => e.sourceMessageId === "event-1");
  assert.equal(first.timestamp, 103000);
  assert.equal(first.receivedAt, 106000);
  assert.equal(first.at, 3000);
  const summary = restored.summary(resumed.current);
  assert.equal(summary.uniqueParticipants, 2);
  assert.equal(summary.money.USD, 5000000);
  assert.equal(
    summary.participants.find((p) => p.platform === "youtube").nameChanges,
    1,
  );
  assert.equal(summary.viewers[0].sources[0].count, null);
  const another = new Engine(saved, { journal: restored });
  another.stop(120000);
  another.start("두번째", 0, 130000);
  another.ingest({ ...chat, id: "next", timestamp: 131000 }, 132000);
  assert.equal(
    (await restored.query(another.current)).events[0].participantKey,
    first.participantKey,
  );
});
test("time, platform, keyword and viewer queries and analysis scope use original event times", async (t) => {
  const { journal, engine } = fixture(t);
  engine.ingest(
    {
      platform: "youtube",
      userId: "a",
      id: "a1",
      name: "viewer",
      text: "첫 구간",
      timestamp: 110000,
    },
    120000,
  );
  engine.ingest(
    {
      platform: "youtube",
      userId: "a",
      id: "a2",
      name: "viewer",
      text: "다음 구간 질문?",
      timestamp: 170000,
    },
    171000,
  );
  engine.ingest(
    {
      platform: "chzzk",
      userId: "b",
      id: "b1",
      text: "질문?",
      timestamp: 175000,
    },
    176000,
  );
  const row = (await journal.query(engine.current, { text: "다음" })).events[0];
  assert.equal(row.at, 70000);
  assert.equal(
    (
      await journal.query(engine.current, {
        from: 60000,
        to: 90000,
        platform: "youtube",
      })
    ).events.length,
    1,
  );
  const analysis = await journal.analyze(engine.current, {
    from: 60000,
    to: 90000,
    participantKey: row.participantKey,
  });
  assert.equal(analysis.chats, 1);
  assert.equal(analysis.reactions.question, 1);
  await assert.rejects(journal.query(engine.current, { from: 100, to: 1 }));
  assert.throws(() => journal.folder("../other"));
});
test("checkpoint crash recovery keeps flushed events added after the last summary", async (t) => {
  const f = fixture(t);
  f.engine.ingest(
    {
      platform: "chzzk",
      userId: "one",
      id: "first",
      text: "first",
      timestamp: 101000,
    },
    101000,
  );
  f.journal.flush(f.engine.current);
  f.engine.ingest(
    {
      platform: "chzzk",
      userId: "one",
      id: "second",
      text: "second",
      timestamp: 102000,
    },
    102000,
  );
  f.journal.flush(f.engine.current, false);
  const recovered = new TimelineStore(f.directory, f.secure);
  assert.equal(recovered.summary(f.engine.current).chats, 2);
  recovered.clear();
  assert.equal(fs.readdirSync(f.directory).length, 0);
});
test("provider timestamps and viewer counts preserve missing values", () => {
  assert.equal(
    parseStartedAt(
      "2026-10-06 14:00:00",
      "chzzk",
      Date.parse("2026-10-06T15:00:00+09:00"),
    ),
    Date.parse("2026-10-06T14:00:00+09:00"),
  );
  assert.equal(viewerCount(undefined), null);
  assert.equal(viewerCount("42"), 42);
  assert.equal(viewerCount(0), 0);
  assert.equal(viewerCount(-1), null);
});

test("AI JSONL export preserves timing and stable speakers while default identity fields are masked", async (t) => {
  const f = fixture(t),
    { exportTimeline } = require("../electron/timeline-export.cjs");
  f.engine.ingest(
    {
      platform: "youtube",
      userId: "private-public-id",
      name: "진짜 닉네임",
      id: "chat-id",
      text: "원문 유지",
      timestamp: 101000,
    },
    102000,
  );
  const file = path.join(f.directory, "analysis.jsonl");
  await exportTimeline(f.journal, f.engine.current, file);
  const text = fs.readFileSync(file, "utf8"),
    lines = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  assert.ok(!text.includes("private-public-id"));
  assert.ok(!text.includes("진짜 닉네임"));
  assert.equal(lines[0].identities, "pseudonymous");
  assert.equal(lines.find((line) => line.type === "chat").at, 1000);
  assert.equal(lines.find((line) => line.type === "chat").text, "원문 유지");
  await exportTimeline(f.journal, f.engine.current, file, true);
  assert.ok(fs.readFileSync(file, "utf8").includes("private-public-id"));
});

test("live metadata readers keep actual starts, hidden YouTube viewers and valid zero/offline counts", async () => {
  const requests = [];
  const auth = {
    config: { twitchClientId: "test-client" },
    getAccess: async () => "test-only-token",
  };
  const reader = new BroadcastReaders(auth, async (url, options) => {
    requests.push([url, options.headers]);
    if (url.includes("liveBroadcasts"))
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "video",
              snippet: {
                channelId: "own",
                title: "live",
                liveChatId: "chat",
                actualStartTime: "2026-10-06T01:00:00Z",
              },
              status: { lifeCycleStatus: "live" },
            },
          ],
        }),
      };
    if (url.includes("/videos"))
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "video",
              snippet: { title: "live", liveBroadcastContent: "live" },
              liveStreamingDetails: { actualStartTime: "2026-10-06T01:00:00Z" },
            },
          ],
        }),
      };
    if (url.includes("/streams"))
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: "stream",
              user_id: "123",
              type: "live",
              title: "live",
              viewer_count: 0,
              started_at: "2026-10-06T01:00:00Z",
            },
          ],
        }),
      };
    return { ok: true, json: async () => ({ code: 200, content: null }) };
  });
  const now = Date.parse("2026-10-06T02:00:00Z");
  const youtube = await reader.read(
    { platform: "youtube", channelId: "own" },
    now,
  );
  assert.equal(youtube.live, true);
  assert.equal(youtube.viewers, null);
  assert.equal(youtube.liveChatId, "chat");
  const twitch = await reader.read(
    { platform: "twitch", channelId: "123" },
    now,
  );
  assert.equal(twitch.live, true);
  assert.equal(twitch.viewers, 0);
  assert.equal(requests.at(-1)[1]["Client-Id"], "test-client");
  const chzzk = await reader.read(
    { platform: "chzzk", channelId: "a".repeat(32) },
    now,
  );
  assert.equal(chzzk.live, false);
});

test("anonymous CHZZK donations and YouTube paid stickers retain money and privacy without voting identities", () => {
  const {
    parseAnonymousDonation,
    parseDonation,
  } = require("../electron/chzzk.cjs");
  const raw = {
    msgTypeCode: 10,
    msg: "응원",
    msgTime: 1000,
    msgSn: 123,
    profile: JSON.stringify({
      userIdHash: "hidden-id",
      nickname: "hidden-name",
    }),
    extras: JSON.stringify({ isAnonymous: true, payAmount: 2000 }),
  };
  assert.equal(parseDonation(raw), null);
  const anonymous = parseAnonymousDonation(raw);
  assert.equal(anonymous.userId, null);
  assert.equal(anonymous.name, "익명 후원");
  assert.equal(anonymous.amountMicros, 2000000000);
  const { youtubeMessage } = require("../electron/platforms.cjs");
  const paid = youtubeMessage({
    id: "sticker",
    authorDetails: { channelId: "public-id" },
    snippet: {
      publishedAt: "2026-10-06T01:00:00Z",
      type: "superStickerEvent",
      superStickerDetails: {
        amountMicros: "2500000",
        currency: "USD",
        superStickerMetadata: { altText: "박수" },
      },
    },
  });
  assert.equal(paid.text, "박수");
  assert.equal(paid.providerType, "super-sticker");
  assert.equal(paid.amountMicros, 2500000);
});
