const { test } = require("node:test"), assert = require("node:assert/strict");
const { PlatformWorker } = require("../electron/platform-worker.cjs");
test("one platform worker merges simultaneous broadcast reads and preserves each caller's channel metadata", async () => {
  const worker = new PlatformWorker("twitch"); let calls = 0, release;
  const reader = { read: async () => { calls++; await new Promise(resolve => { release = resolve; }); return { live: true, viewers: 42 }; } };
  const first = worker.readBroadcast({ platform: "twitch", channelId: "123" }, 1000, reader);
  const second = worker.readBroadcast({ platform: "twitch", channelId: "123", name: "shared channel" }, 1000, reader);
  await Promise.resolve(); assert.equal(calls, 1); release();
  assert.equal((await first).viewers, 42); assert.equal((await second).name, "shared channel");
  assert.equal(worker.broadcastRequest, null);
  await worker.readBroadcast({ platform: "twitch", channelId: "123" }, 2000, reader, 30000);
  assert.equal(calls, 1, "Twitch transport reuses the common monitor's fresh snapshot");
});
test("channel changes cannot overwrite a newer worker snapshot with an old reply", async () => {
  const worker = new PlatformWorker("youtube"), gates = {};
  const reader = { read: channel => new Promise(resolve => { gates[channel.channelId] = resolve; }) };
  const old = worker.readBroadcast({ platform: "youtube", channelId: "old" }, 1000, reader);
  const current = worker.readBroadcast({ platform: "youtube", channelId: "new" }, 1001, reader);
  await Promise.resolve(); gates.new({ live: true, viewers: 100 }); await current;
  gates.old({ live: false, viewers: 0 }); await old;
  assert.equal(worker.broadcast.key, "new"); assert.equal(worker.broadcast.data.viewers, 100);
});
test("worker read failures clear pending state and allow a later retry", async () => {
  const worker = new PlatformWorker("chzzk"); let calls = 0;
  const reader = { read: async () => { if (++calls === 1) throw new Error("offline request"); return { live: true }; } };
  const channel = { platform: "chzzk", channelId: "channel" };
  await assert.rejects(worker.readBroadcast(channel, 1000, reader), /offline request/);
  assert.equal(worker.broadcastRequest, null);
  assert.equal((await worker.readBroadcast(channel, 2000, reader)).live, true);
});
test("YouTube chat setup consumes the shared broadcast result without another discovery request", async () => {
  const { AuthManager } = require("../electron/oauth.cjs");
  const auth = { vault: { accounts: { youtube: { channelId: "channel", name: "shared" } } }, getAccess: () => assert.fail("no independent token/discovery request") };
  let calls = 0;
  const config = await AuthManager.prototype.chatConfig.call(auth, async channel => { calls++; assert.equal(channel.channelId, "channel"); return { live: true, liveChatId: "shared-live-chat" }; });
  assert.equal(calls, 1); assert.equal(config.youtube, true); assert.equal(config.liveChatId, "shared-live-chat");
});
