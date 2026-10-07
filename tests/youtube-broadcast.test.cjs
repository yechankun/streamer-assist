const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BroadcastReaders, BroadcastMonitor, recordingDecision } = require("../electron/broadcast-monitor.cjs");
const { PlatformWorker } = require("../electron/platform-worker.cjs");

const now = Date.parse("2026-10-08T02:00:00Z");
const start = "2026-10-08T01:00:00Z";
const channel = { platform: "youtube", channelId: "own", name: "Test channel" };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const active = () => response({ items: [{
  id: "video", status: { lifeCycleStatus: "live" },
  snippet: { channelId: "own", title: "Live broadcast", actualStartTime: start, liveChatId: "old-chat" },
}] });
const video = (details, liveBroadcastContent = "live") => response({ items: [{
  id: "video", snippet: { title: "Live broadcast", liveBroadcastContent }, liveStreamingDetails: details,
}] });
const auth = () => ({ getAccess: async () => "test-token" });

test("YouTube detects actual live timing despite delayed snippet and uses the active chat ID", async () => {
  let discoveries = 0;
  const reader = new BroadcastReaders(auth(), async url => {
    if (url.includes("/liveBroadcasts")) { discoveries++; return active(); }
    return video({ actualStartTime: start, concurrentViewers: "0", activeLiveChatId: "current-chat" }, "none");
  });
  const info = await reader.read(channel, now);
  assert.equal(info.live, true);
  assert.equal(info.startedAt, Date.parse(start));
  assert.equal(info.viewers, 0);
  assert.equal(info.liveChatId, "current-chat");
  assert.equal(recordingDecision(null, [info], true, undefined, now).action, "start");
  await reader.read(channel, now + 30000);
  assert.equal(discoveries, 1, "ongoing broadcasts reuse the discovered video");
});

test("YouTube actual end overrides stale live snippet and chat metadata", async () => {
  let ended = false, discoveries = 0;
  const reader = new BroadcastReaders(auth(), async url => {
    if (url.includes("/liveBroadcasts")) { discoveries++; return ended ? response({ items: [] }) : active(); }
    return video({ actualStartTime: start, actualEndTime: ended ? new Date(now).toISOString() : undefined, activeLiveChatId: "chat" });
  });
  assert.equal((await reader.read(channel, now)).live, true);
  ended = true;
  const info = await reader.read(channel, now + 30000);
  assert.equal(info.live, false);
  assert.equal(info.endedAt, now);
  assert.equal(info.viewers, 0);
  assert.equal(reader.youtube, null);
  assert.equal((await reader.read(channel, now + 60000)).live, false);
  assert.equal(discoveries, 2);
});

test("missing YouTube details remain unknown without stopping recording, then recover through one worker", async () => {
  let broken = true, discoveries = 0;
  const reader = new BroadcastReaders(auth(), async url => {
    if (url.includes("/liveBroadcasts")) { discoveries++; return active(); }
    return broken ? response({ items: [] }) : video({ actualStartTime: start, concurrentViewers: "42" });
  });
  const worker = new PlatformWorker("youtube");
  let latest;
  const monitor = new BroadcastMonitor({
    reader: { read: (ch, time) => worker.readBroadcast(ch, time, reader) },
    onUpdate: infos => { latest = infos; }, clock: () => now, schedule: () => 1, cancel: () => {},
  });
  monitor.channels = [channel]; monitor.active = true;
  monitor.status.youtube = { ...channel, live: true };
  await monitor.poll();
  assert.equal(latest[0].live, null);
  assert.match(latest[0].error, /상세 정보/);
  assert.equal(recordingDecision({ sources: [channel] }, latest, true).action, "none");
  broken = false;
  await monitor.poll();
  assert.equal(latest[0].live, true);
  assert.equal(latest[0].viewers, 42);
  assert.equal(latest[0].error, "");
  assert.equal(discoveries, 2);
  monitor.stop();
});

test("YouTube API failures identify permissions, quota and disabled APIs without exposing raw responses", async () => {
  for (const [reason, expected] of [
    ["insufficientPermissions", /권한.*다시 연결/],
    ["insufficientLivePermissions", /권한.*다시 연결/],
    ["quotaExceeded", /한도를 초과/],
    ["liveStreamingNotEnabled", /실시간 방송 기능/],
    ["accessNotConfigured", /API가 활성화/],
    ["unexpected", /403/],
  ]) {
    const reader = new BroadcastReaders(auth(), async () => response({ error: {
      message: "sensitive raw server response", errors: [{ reason }],
    } }, 403));
    await assert.rejects(reader.read(channel, now), error => {
      assert.equal(error.status, 403);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /sensitive/);
      return true;
    });
  }
});

test("YouTube still refreshes expired access tokens once before discovering a live broadcast", async () => {
  const refresh = []; let requests = 0;
  const reader = new BroadcastReaders({ getAccess: async (_platform, force) => { refresh.push(force); return "test-token"; } }, async url => {
    if (++requests === 1) return response({ error: {} }, 401);
    return url.includes("/liveBroadcasts") ? active() : video({ actualStartTime: start });
  });
  assert.equal((await reader.read(channel, now)).live, true);
  assert.deepEqual(refresh, [false, true, false]);
});
