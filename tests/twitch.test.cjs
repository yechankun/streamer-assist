const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { TwitchChat, twitchMessage, reconnectUrl } = require("../electron/twitch.cjs");
const { Engine } = require("../electron/engine.cjs");
const { Platforms, pollAnnouncement } = require("../electron/platforms.cjs");
const turn = () => new Promise((r) => setImmediate(r));
const packet = (type, payload) => ({ metadata: { message_type: type, message_timestamp: new Date().toISOString() }, payload });
const welcome = (id) => packet("session_welcome", { session: { id, keepalive_timeout_seconds: 30 } });
const chatMessage = (id = "message", text = "!투표1") => packet("notification", {
  subscription: { type: "channel.chat.message" },
  event: { broadcaster_user_id: "123", chatter_user_id: "456", chatter_user_name: "Viewer", message_id: id, message: { text }, badges: [{ set_id: "subscriber", id: "1" }] },
});
function fixture(t, overrides = {}) {
  const sockets = [], statuses = [], messages = [], requests = [], live = [];
  class Socket extends EventEmitter {
    constructor(url) { super(); this.url = url; sockets.push(this); }
    receive(value) { this.emit("message", Buffer.from(JSON.stringify(value))); }
    terminate() { this.closed = true; this.emit("close", 1006); }
  }
  const auth = { config: { twitchClientId: "public-client" }, getAccess: async () => "token", ...overrides.auth };
  const client = new TwitchChat({ auth, userId: "123", Socket, retryBaseMs: 5,
    onStatus: (s) => statuses.push(s), onMessage: (m) => messages.push(m),
    onLive: (value) => live.push(value),
    fetcher: async (url, options) => {
      if (url.includes("/helix/streams")) return { ok: true, json: async () => ({ data: [] }) };
      const body = JSON.parse(options.body);
      requests.push({ url, options, body });
      return { ok: true, json: async () => ({ data: [{ type: body.type, status: "enabled", transport: body.transport }] }) };
    }, ...overrides,
  });
  t.after(() => client.disconnect());
  return { client, sockets, statuses, messages, requests, live };
}
test("Twitch chat subscribes after welcome and normalizes local subscriber messages", async (t) => {
  const f = fixture(t);
  await f.client.connect();
  assert.equal(f.requests.length, 0);
  f.sockets[0].receive(welcome("session"));
  await turn();
  assert.equal(f.statuses.at(-1), "연결됨");
  assert.deepEqual(f.requests[0].body.condition, { broadcaster_user_id: "123", user_id: "123" });
  assert.equal(f.requests[0].options.headers["Client-Id"], "public-client");
  f.sockets[0].receive(chatMessage());
  assert.equal(f.messages[0].platform, "twitch");
  assert.equal(f.messages[0].subscriber, true);
  assert.equal(f.messages[0].name, "Viewer");
});
test("shared-chat messages, missing identities, and malformed timestamps cannot participate", () => {
  for (const edit of [
    (p) => { p.payload.event.source_broadcaster_user_id = "999"; },
    (p) => { p.payload.event.broadcaster_user_id = "999"; },
    (p) => { p.payload.event.chatter_user_id = ""; },
    (p) => { p.metadata.message_timestamp = "invalid"; },
    (p) => { p.payload.event.message.text = null; },
  ]) {
    const p = chatMessage(); edit(p);
    assert.equal(twitchMessage(p, "123"), null);
  }
  const founder = chatMessage();
  founder.payload.event.badges = [{ set_id: "founder" }];
  assert.equal(twitchMessage(founder, "123").subscriber, true);
});
test("a chat notification arriving before the subscription response is not lost", async (t) => {
  let complete;
  const f = fixture(t, { fetcher: async (_url, options) => {
    if (!options.body) return { ok: true, json: async () => ({ data: [] }) };
    const body = JSON.parse(options.body);
    if (body.type !== "channel.chat.message") return { ok: true, json: async () => ({ data: [{ type: body.type, status: "enabled", transport: body.transport }] }) };
    await new Promise((r) => { complete = r; });
    return { ok: true, json: async () => ({ data: [{ type: body.type, status: "enabled", transport: body.transport }] }) };
  } });
  await f.client.connect();
  f.sockets[0].receive(welcome("one"));
  f.sockets[0].receive(chatMessage());
  assert.equal(f.messages.length, 1);
  complete();
  await turn();
});
test("server reconnect preserves subscriptions and deduplication across socket replacement", async (t) => {
  const f = fixture(t);
  await f.client.connect();
  const old = f.sockets[0];
  old.receive(welcome("one")); await turn();
  old.receive(chatMessage("duplicate"));
  old.receive(packet("session_reconnect", { session: { reconnect_url: "wss://eventsub.wss.twitch.tv/ws?session=resume" } }));
  assert.equal(old.closed, undefined);
  f.sockets[1].receive(welcome("two")); await turn();
  assert.equal(old.closed, true);
  assert.equal(f.requests.length, 3);
  f.sockets[1].receive(chatMessage("duplicate"));
  old.receive(chatMessage("stale"));
  f.sockets[1].receive(chatMessage("new"));
  assert.deepEqual(f.messages.map((m) => m.id), ["duplicate", "new"]);
});
test("unexpected disconnect creates a new session and resubscribes", async (t) => {
  const f = fixture(t);
  await f.client.connect();
  f.sockets[0].receive(welcome("one")); await turn();
  f.sockets[0].emit("close", 1006);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(f.sockets.length, 2);
  f.sockets[1].receive(welcome("two")); await turn();
  assert.equal(f.requests.length, 6);
  assert.equal(f.statuses.at(-1), "연결됨");
});
test("disconnect during token retrieval prevents a late socket from opening", async (t) => {
  let complete;
  const f = fixture(t, { auth: { config: { twitchClientId: "public-client" }, getAccess: () => new Promise((r) => { complete = r; }) } });
  const connecting = f.client.connect();
  f.client.disconnect();
  complete("token");
  await connecting;
  assert.equal(f.sockets.length, 0);
});
test("disconnect cancels an in-flight subscription and prevents a stale connected status", async (t) => {
  let complete;
  const f = fixture(t, { fetcher: async (_url, options) => {
    if (!options.body) return { ok: true, json: async () => ({ data: [] }) };
    const body = JSON.parse(options.body);
    if (body.type !== "channel.chat.message") return { ok: true, json: async () => ({ data: [{ type: body.type, status: "enabled", transport: body.transport }] }) };
    await new Promise((r) => { complete = r; });
    assert.equal(options.signal.aborted, true);
    return { ok: true, json: async () => ({ data: [{ type: body.type, status: "enabled", transport: body.transport }] }) };
  } });
  await f.client.connect();
  f.sockets[0].receive(welcome("one"));
  f.client.disconnect(); complete(); await turn();
  assert.ok(!f.statuses.includes("연결됨"));
});
test("Twitch authorization revocation closes the socket and never retries", async (t) => {
  let revoked;
  const f = fixture(t, { auth: { config: { twitchClientId: "public-client" }, getAccess: async () => "token", revokeTwitch: (id) => { revoked = id; } } });
  await f.client.connect();
  f.sockets[0].receive(welcome("one")); await turn();
  f.sockets[0].receive(packet("revocation", { subscription: { type: "channel.chat.message", status: "authorization_revoked" } }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(revoked, "123");
  assert.equal(f.sockets.length, 1);
  assert.equal(f.sockets[0].closed, true);
  assert.match(f.statuses.at(-1), /다시 연결/);
});
test("subscription authorization is refreshed once and repeated 401 stops retries", async (t) => {
  let requests = 0, refreshes = 0;
  const f = fixture(t, {
    auth: { config: { twitchClientId: "public-client" }, getAccess: async (_platform, force) => { if (force) refreshes++; return "token"; } },
    fetcher: async () => { requests++; return { ok: false, status: 401 }; },
  });
  await f.client.connect();
  f.sockets[0].receive(welcome("one")); await turn();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(requests, 6);
  assert.equal(refreshes, 1);
  assert.equal(f.sockets.length, 1);
  assert.match(f.statuses.at(-1), /다시 연결/);
});
test("keepalive timeout reconnects and a keepalive message renews the deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture(t);
  await f.client.connect();
  f.sockets[0].receive(packet("session_welcome", { session: { id: "one", keepalive_timeout_seconds: 1 } })); await turn();
  t.mock.timers.tick(2000);
  f.sockets[0].receive(packet("session_keepalive", {}));
  t.mock.timers.tick(2000);
  assert.equal(f.sockets.length, 1);
  t.mock.timers.tick(1001);
  assert.equal(f.statuses.at(-1), "재연결 대기");
  t.mock.timers.tick(10); await turn();
  assert.equal(f.sockets.length, 2);
});
test("server reconnect URLs cannot redirect the app to another host or protocol", () => {
  for (const value of ["ws://eventsub.wss.twitch.tv/ws", "wss://example.com/ws", "wss://user@eventsub.wss.twitch.tv/ws", "wss://eventsub.wss.twitch.tv/other"])
    assert.throws(() => reconnectUrl(value), /주소/);
});
test("Twitch broadcast state comes from Streams and online/offline events, independently of chat", async (t) => {
  const f = fixture(t, { fetcher: async (url, options) => {
    if (url.includes("/helix/streams")) return { ok: true, json: async () => ({ data: [{ user_id: "123", type: "live" }] }) };
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ data: [{ type: body.type, status: "enabled", transport: body.transport }] }) };
  } });
  await f.client.connect(); f.sockets[0].receive(welcome("one")); await turn();
  assert.equal(f.live.at(-1), true);
  f.sockets[0].receive(packet("notification", { subscription: { type: "stream.offline" }, event: { broadcaster_user_id: "123" } }));
  assert.equal(f.live.at(-1), false);
  assert.equal(f.statuses.at(-1), "연결됨");
  f.sockets[0].receive(packet("notification", { subscription: { type: "stream.online" }, event: { broadcaster_user_id: "999", type: "live" } }));
  assert.equal(f.live.at(-1), false);
  f.sockets[0].receive(packet("notification", { subscription: { type: "stream.online" }, event: { broadcaster_user_id: "123", type: "live" } }));
  assert.equal(f.live.at(-1), true);
  f.client.disconnect(); assert.equal(f.live.at(-1), false);
});
test("a delayed Streams response cannot overwrite a newer offline event or logout", async (t) => {
  const pending = [];
  const f = fixture(t, { fetcher: async (url, options) => {
    if (url.includes("/helix/streams")) return new Promise((resolve) => pending.push(() => resolve({ ok: true, json: async () => ({ data: [{ user_id: "123", type: "live" }] }) })));
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ data: [{ type: body.type, status: "enabled", transport: body.transport }] }) };
  } });
  await f.client.connect(); f.sockets[0].receive(welcome("one")); await turn();
  f.sockets[0].receive(packet("notification", { subscription: { type: "stream.offline" }, event: { broadcaster_user_id: "123" } }));
  pending.shift()(); await turn(); assert.equal(f.live.at(-1), false);
  const querying = f.client.queryLive(f.client.current, "token");
  f.client.disconnect(); pending.shift()(); await querying;
  assert.equal(f.live.at(-1), false);
});
test("Twitch votes combine with YouTube native results and remain isolated by account/platform", () => {
  const engine = new Engine();
  engine.start("mixed", 0, 1000);
  const poll = engine.createPoll("Q", ["A", "B"], "native", ["chzzk", "youtube", "twitch"], "!투표", "latest");
  engine.ingest({ platform: "twitch", userId: "same", id: "1", text: "!투표1" });
  engine.ingest({ platform: "chzzk", userId: "same", id: "1", text: "!투표2" });
  engine.ingest({ platform: "youtube", userId: "same", id: "1", text: "!투표1" });
  assert.deepEqual(poll.counts, [1, 1]);
  engine.ingest({ platform: "twitch", userId: "same", id: "2", text: "!투표2" });
  engine.ingest({ platform: "twitch", userId: "same", id: "1", text: "!투표1" });
  assert.deepEqual(poll.counts, [0, 2]);
  const restored = new Engine(engine.persisted());
  restored.ingest({ platform: "twitch", userId: "same", id: "3", text: "!투표1" });
  assert.deepEqual(restored.poll.counts, [1, 1]);
  assert.match(pollAnnouncement({ ...poll, platforms: ["youtube", "twitch"] }), /!투표1/);
});
test("Twitch supports subscriber recruitment while donation voting remains disabled", () => {
  const engine = new Engine();
  engine.audience.startRaffle({ title: "R", platforms: ["twitch"], entryMode: "keyword", keyword: "!참여", subscribersOnly: true, excludeWinners: true });
  engine.ingest({ platform: "twitch", userId: "456", text: "!참여", subscriber: false });
  assert.equal(engine.audience.snapshot().raffle.candidateCount, 0);
  engine.ingest({ platform: "twitch", userId: "456", text: "!참여", subscriber: true });
  assert.equal(engine.audience.snapshot().raffle.candidateCount, 1);
  const platforms = new Platforms(engine, () => {});
  platforms.config = { twitch: true, twitchUserId: "123" };
  platforms.status.twitch = "연결됨";
  const accounts = { twitch: { connected: true } };
  assert.deepEqual(platforms.pollConfiguration(["twitch"], { accounts }), { mode: "chat", platforms: ["twitch"] });
  assert.throws(() => platforms.pollConfiguration(["twitch"], { accounts, feature: "donation" }), /지원하지/);
  assert.throws(() => engine.audience.startDonation({ platforms: ["twitch"], question: "Q", options: ["A", "B"] }), /지원하지/);
});
test("one platform's initial connection failure does not prevent another from connecting", async () => {
  const p = new Platforms(new Engine(), () => {});
  p.chzzkConnect = async () => { throw new Error("CHZZK unavailable"); };
  p.twitchConnect = async () => { p.status.twitch = "연결됨"; };
  await p.connect({ chzzkChannelId: "channel", twitch: true, twitchUserId: "123" });
  assert.equal(p.status.twitch, "연결됨");
  assert.equal(p.status.chzzk, "CHZZK unavailable");
  p.disconnect();
});
