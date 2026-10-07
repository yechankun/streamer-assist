const WebSocket = require("ws");
const ENDPOINT = "wss://eventsub.wss.twitch.tv/ws";
function reconnectUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === "wss://eventsub.wss.twitch.tv" && url.pathname === "/ws" && !url.username && !url.password) return url.href;
  } catch {}
  throw new Error("트위치 재연결 주소를 확인할 수 없습니다.");
}
function twitchMessage(payload, broadcasterId) {
  const event = payload.payload?.event;
  const timestamp = Date.parse(payload.metadata?.message_timestamp);
  if (
    event?.broadcaster_user_id !== broadcasterId ||
    (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== broadcasterId) ||
    typeof event.message_id !== "string" || !event.message_id || event.message_id.length > 200 ||
    typeof event.chatter_user_id !== "string" || !/^\d{1,200}$/.test(event.chatter_user_id) ||
    typeof event.message?.text !== "string" || event.message.text.length > 10000 ||
    !Number.isFinite(timestamp)
  ) return null;
  return {
    platform: "twitch", id: event.message_id, userId: event.chatter_user_id,
    name: typeof event.chatter_user_name === "string" ? event.chatter_user_name.slice(0, 120) : undefined,
    text: event.message.text, timestamp,
    roles: Array.isArray(event.badges) ? event.badges.map(b => b?.set_id).filter(v => ["broadcaster","moderator","vip","staff"].includes(v)) : [],
    badges: Array.isArray(event.badges) ? event.badges.filter(b => typeof b?.set_id === "string" && typeof b?.id === "string").map(b => b.set_id + ":" + b.id).slice(0,24) : [],
    subscriber: Array.isArray(event.badges) && event.badges.some((badge) => ["subscriber", "founder"].includes(badge?.set_id)),
  };
}
class TwitchChat {
  constructor({ auth, userId, onStatus, onMessage, onLive = () => {}, readBroadcast, Socket = WebSocket, fetcher = fetch, retryBaseMs = 1000 }) {
    Object.assign(this, { auth, userId, onStatus, onMessage, onLive, readBroadcast, Socket, fetcher, retryBaseMs });
    this.generation = 0;
    this.contexts = new Set();
    this.seen = new Set();
    this.attempt = 0;
    this.liveRevision = 0;
  }
  async connect() {
    this.disconnect();
    this.active = true;
    const generation = this.generation;
    this.authTimer = setInterval(() => {
      this.auth.getAccess("twitch").then((token) => {
        if (this.active && generation === this.generation && this.current?.ready)
          return this.queryLive(this.current, token);
      }).catch((error) => {
        if (this.active && generation === this.generation) this.fail(this.current, error, error.code === "authorization_invalid");
      });
    }, 60000);
    this.authTimer.unref?.();
    await this.start(generation);
  }
  async start(generation) {
    this.onStatus("연결 중");
    try {
      const token = await this.auth.getAccess("twitch");
      if (!this.active || generation !== this.generation) return;
      this.open(ENDPOINT, token, generation);
    } catch (error) {
      if (this.active && generation === this.generation) this.fail(null, error, error.code === "authorization_invalid");
    }
  }
  open(url, token, generation, old = null) {
    if (!this.active || generation !== this.generation) return;
    let socket;
    try { socket = new this.Socket(url); } catch (error) { this.fail(null, error); return; }
    const context = { socket, token, generation, old, controller: new AbortController(), ready: false, retired: false };
    this.contexts.add(context);
    if (old) this.replacement = context;
    else this.current = context;
    context.welcome = setTimeout(() => this.fail(context, new Error("트위치 연결 응답 시간이 지났습니다.")), 15000);
    socket.on("message", (raw) => {
      if (!this.active || generation !== this.generation || context.retired) return;
      if (Buffer.byteLength(raw) > 1024 * 1024) { this.fail(context, new Error("트위치 응답 크기가 너무 큽니다.")); return; }
      let payload;
      try { payload = JSON.parse(raw.toString()); } catch { this.fail(context, new Error("트위치 응답을 읽지 못했습니다.")); return; }
      this.receive(context, payload).catch((error) => {
        if (!context.retired && this.active && generation === this.generation) this.fail(context, error, error.code === "authorization_invalid" || error.status === 403);
      });
    });
    socket.on("error", () => this.fail(context, new Error("트위치 채팅 연결에 실패했습니다.")));
    socket.on("close", (code) => this.fail(context, new Error(`트위치 채팅 연결이 종료됐습니다 (${code}).`)));
  }
  touch(context) {
    clearTimeout(context.keepalive);
    if (context.keepaliveSeconds) context.keepalive = setTimeout(() => this.fail(context, new Error("트위치 채팅 응답이 끊겼습니다.")), (context.keepaliveSeconds + 2) * 1000);
  }
  async receive(context, payload) {
    const type = payload.metadata?.message_type;
    this.touch(context);
    if (type === "session_welcome") {
      if (context.welcomed) return;
      context.welcomed = true;
      clearTimeout(context.welcome);
      const session = payload.payload?.session;
      if (typeof session?.id !== "string" || !session.id) throw new Error("트위치 세션 정보를 받지 못했습니다.");
      context.keepaliveSeconds = Number.isFinite(session.keepalive_timeout_seconds) && session.keepalive_timeout_seconds >= 1 ? Math.min(600, session.keepalive_timeout_seconds) : 10;
      this.touch(context);
      if (!context.old) await this.subscribe(context, session.id);
      if (!this.active || context.generation !== this.generation || context.retired) return;
      context.ready = true;
      this.attempt = 0;
      if (context.old) {
        this.current = context;
        this.replacement = null;
        this.dispose(context.old);
        context.old = null;
      }
      this.onStatus("연결됨");
      if (!context.streamUpdated) void this.queryLive(context, context.token);
    } else if (type === "notification" && context.welcomed && payload.payload?.subscription?.type === "channel.chat.message") {
      const message = twitchMessage(payload, this.userId);
      if (!message || this.seen.has(message.id)) return;
      this.seen.add(message.id);
      if (this.seen.size > 20000) this.seen.delete(this.seen.values().next().value);
      this.onMessage(message);
      const bits = payload.payload?.event?.cheer?.bits;
      if (Number.isSafeInteger(bits) && bits > 0 && Number.isSafeInteger(bits*1000000)) this.onMessage({
        ...message, id: message.id + ":cheer", kind: "donation", currency: "BITS",
        amountMicros: bits*1000000, providerType: "cheer",
      });
    } else if (type === "notification" && context.welcomed && ["stream.online", "stream.offline"].includes(payload.payload?.subscription?.type)) {
      if (payload.payload.event?.broadcaster_user_id !== this.userId) return;
      if (payload.payload.subscription.type === "stream.online" && payload.payload.event.type !== "live") return;
      context.streamUpdated = true;
      this.liveRevision++;
      this.onLive(payload.payload.subscription.type === "stream.online");
    } else if (type === "session_reconnect" && context.ready && !this.replacement) {
      this.onStatus("재연결 중");
      this.open(reconnectUrl(payload.payload?.session?.reconnect_url), context.token, context.generation, context);
    } else if (type === "revocation") {
      const revoked = payload.payload?.subscription;
      if (["stream.online", "stream.offline"].includes(revoked?.type)) { this.liveRevision++; this.onLive(false); return; }
      if (revoked?.type !== "channel.chat.message") return;
      if (revoked.status === "authorization_revoked") this.auth.revokeTwitch?.(this.userId);
      this.fail(context, new Error("트위치 채팅 권한이 해제됐습니다. 계정을 다시 연결하세요."), true);
    }
  }
  async subscribe(context, sessionId) {
    const clientId = this.auth.config.twitchClientId;
    const request = async (token, type) => {
      const response = await this.fetcher("https://api.twitch.tv/helix/eventsub/subscriptions", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Client-Id": clientId, "Content-Type": "application/json" },
        body: JSON.stringify({ type, version: "1", condition: { broadcaster_user_id: this.userId, ...(type === "channel.chat.message" ? { user_id: this.userId } : {}) }, transport: { method: "websocket", session_id: sessionId } }),
        signal: AbortSignal.any([context.controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) throw Object.assign(new Error(`트위치 채팅 구독 오류 (${response.status}). 계정을 다시 연결하세요.`), { status: response.status });
      const result = await response.json();
      if (!result.data?.some((item) => item.type === type && item.status === "enabled" && item.transport?.session_id === sessionId)) throw new Error("트위치 구독을 확인하지 못했습니다.");
    };
    let refreshed;
    const subscribe = async (type) => {
      try { await request(context.token, type); } catch (error) {
        if (error.status !== 401 || context.retired) throw error;
        context.token = await (refreshed ||= this.auth.getAccess("twitch", true));
        if (context.retired) return;
        try { await request(context.token, type); } catch (next) {
          if (next.status === 401) next.code = "authorization_invalid";
          throw next;
        }
      }
    };
    await Promise.all(["channel.chat.message", "stream.online", "stream.offline"].map(subscribe));
  }
  async queryLive(context, token) {
    const revision = this.liveRevision;
    try {
      if (this.readBroadcast) {
        const data = await this.readBroadcast();
        if (context.retired || !this.active || context.generation !== this.generation || revision !== this.liveRevision) return;
        if (typeof data.live === "boolean") this.onLive(data.live);
        return;
      }
      const response = await this.fetcher("https://api.twitch.tv/helix/streams?user_id=" + this.userId, {
        headers: { Authorization: "Bearer " + token, "Client-Id": this.auth.config.twitchClientId },
        signal: AbortSignal.any([context.controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) return;
      const data = await response.json();
      if (context.retired || !this.active || context.generation !== this.generation || revision !== this.liveRevision) return;
      if (Array.isArray(data.data)) this.onLive(data.data.some((stream) => stream.user_id === this.userId && stream.type === "live"));
    } catch {}
  }
  dispose(context) {
    if (!context || context.retired) return;
    context.retired = true;
    context.controller.abort();
    clearTimeout(context.welcome);
    clearTimeout(context.keepalive);
    this.contexts.delete(context);
    context.socket.terminate();
  }
  fail(context, error, terminal = false) {
    if (!this.active || (context && (context.retired || context.generation !== this.generation))) return;
    for (const item of this.contexts) this.dispose(item);
    this.current = null;
    this.replacement = null;
    this.liveRevision++;
    this.onLive(false);
    clearTimeout(this.retry);
    if (terminal) {
      this.active = false;
      clearInterval(this.authTimer);
      this.onStatus(error.message);
      return;
    }
    this.onStatus("재연결 대기");
    const generation = this.generation;
    this.retry = setTimeout(() => this.start(generation), Math.min(30000, this.retryBaseMs * 2 ** Math.min(this.attempt++, 5)));
  }
  disconnect() {
    this.active = false;
    this.generation++;
    clearTimeout(this.retry);
    clearInterval(this.authTimer);
    for (const item of this.contexts) this.dispose(item);
    this.current = null;
    this.replacement = null;
    this.seen.clear();
    this.attempt = 0;
    this.liveRevision++;
    this.onLive(false);
  }
}
module.exports = { TwitchChat, twitchMessage, reconnectUrl };
