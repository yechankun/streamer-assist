const WebSocket = require("ws");
const CHANNEL_API = "https://api.chzzk.naver.com";
const TOKEN_API = "https://comm-api.game.naver.com/nng_main";
// Public read protocol: https://github.com/kimcore/chzzk/tree/main/src/chat
// No account cookies, developer credentials, or chat-writing commands are used.
function channelIdFrom(input) {
  if (typeof input !== "string" || input.length > 2048)
    throw new Error("치지직 채널 주소를 입력하세요.");
  const value = input.trim();
  if (/^[a-f0-9]{32}$/i.test(value)) return value.toLowerCase();
  try {
    const url = new URL(value);
    const id = /^\/(?:live\/)?([a-f0-9]{32})\/?$/i.exec(url.pathname)?.[1];
    if (
      url.protocol === "https:" &&
      url.hostname === "chzzk.naver.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      id
    )
      return id.toLowerCase();
  } catch {}
  throw new Error("치지직 채널 주소 또는 라이브 주소를 입력하세요.");
}
async function publicRequest(url, fetcher = fetch, signal) {
  let response;
  try {
    response = await fetcher(url, {
      headers: { "User-Agent": "Mozilla/5.0 StreamerAssist/0.1.0" },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "치지직에 접속하지 못했습니다. 네트워크 상태를 확인하고 다시 연결하세요.",
    );
  }
  if (!response.ok)
    throw new Error(
      "치지직 공개 채팅 요청에 실패했습니다. 잠시 후 다시 연결하세요.",
    );
  const data = await response.json();
  if (data.code === 42601 || data.code === 401 || data.code === 403) {
    const error = new Error(
      "로그인이 필요한 치지직 방송은 공개 채팅 연결을 지원하지 않습니다.",
    );
    error.permanent = true;
    throw error;
  }
  if (data.code !== 200 || !data.content)
    throw new Error(
      "치지직 공개 채팅 정보를 받지 못했습니다. 채널 주소와 방송 상태를 확인하세요.",
    );
  return data.content;
}
async function channelProfile(input, fetcher = fetch) {
  const channelId = channelIdFrom(input);
  const content = await publicRequest(
    CHANNEL_API + "/service/v1/channels/" + channelId,
    fetcher,
  );
  if (
    content.channelId !== channelId ||
    typeof content.channelName !== "string"
  )
    throw new Error("치지직 채널을 찾지 못했습니다.");
  return { channelId, name: content.channelName.slice(0, 120) };
}
function parseChat(raw) {
  if (
    !raw ||
    (raw.msgTypeCode ?? raw.messageTypeCode) !== 1 ||
    (raw.msgStatusType || raw.messageStatusType) === "HIDDEN"
  )
    return null;
  const profile =
    typeof raw.profile === "string" ? JSON.parse(raw.profile) : raw.profile;
  const userId = profile?.userIdHash;
  const text = raw.msg ?? raw.content;
  const timestamp = Number(raw.msgTime ?? raw.messageTime);
  if (!userId || typeof text !== "string" || !Number.isFinite(timestamp))
    return null;
  return {
    platform: "chzzk",
    userId,
    text,
    timestamp,
    name:
      typeof profile.nickname === "string"
        ? profile.nickname.slice(0, 120)
        : undefined,
    subscriber: !!profile.streamingProperty?.subscription,
    id: userId + ":" + timestamp + ":" + text,
  };
}
function parseDonation(raw) {
  if (
    !raw ||
    (raw.msgTypeCode ?? raw.messageTypeCode) !== 10 ||
    (raw.msgStatusType || raw.messageStatusType) === "HIDDEN"
  )
    return null;
  try {
    const profile =
      typeof raw.profile === "string" ? JSON.parse(raw.profile) : raw.profile;
    const extras =
      typeof raw.extras === "string" ? JSON.parse(raw.extras) : raw.extras;
    const userId = profile?.userIdHash;
    const text = raw.msg ?? raw.content;
    const timestamp = Number(raw.msgTime ?? raw.messageTime);
    const amount = extras?.payAmount;
    if (
      typeof userId !== "string" ||
      !userId ||
      userId === "anonymous" ||
      extras?.isAnonymous ||
      typeof text !== "string" ||
      !Number.isFinite(timestamp) ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !Number.isSafeInteger(amount * 1000000)
    )
      return null;
    return {
      kind: "donation",
      platform: "chzzk",
      userId,
      text,
      timestamp,
      name:
        typeof profile.nickname === "string"
          ? profile.nickname.slice(0, 120)
          : undefined,
      subscriber: !!profile.streamingProperty?.subscription,
      currency: "KRW",
      amountMicros: amount * 1000000,
      id: String(
        raw.msgSn ??
          raw.messageId ??
          "donation:" + userId + ":" + timestamp + ":" + amount + ":" + text,
      ),
    };
  } catch {
    return null;
  }
}
class PublicChat {
  constructor({
    channelId,
    onStatus,
    onMessage,
    fetcher = fetch,
    Socket = WebSocket,
    retryDelay = 30000,
  }) {
    this.channelId = channelIdFrom(channelId);
    this.onStatus = onStatus;
    this.onMessage = onMessage;
    this.fetcher = fetcher;
    this.Socket = Socket;
    this.retryDelay = retryDelay;
    this.closed = true;
  }
  async connect() {
    this.disconnect();
    this.closed = false;
    this.controller = new AbortController();
    this.onStatus("연결 중");
    await this.check();
  }
  disconnect() {
    this.closed = true;
    this.controller?.abort();
    clearTimeout(this.timer);
    this.closeSocket();
  }
  closeSocket() {
    const socket = this.socket;
    this.socket = null;
    this.chatChannelId = null;
    clearTimeout(this.handshake);
    clearInterval(this.heartbeat);
    if (socket) socket.terminate();
  }
  schedule() {
    clearTimeout(this.timer);
    if (!this.closed)
      this.timer = setTimeout(() => void this.check(), this.retryDelay);
  }
  async check() {
    if (this.closed || this.checking) return;
    this.checking = true;
    let permanent = false;
    const controller = this.controller;
    try {
      const status = await publicRequest(
        CHANNEL_API + "/polling/v2/channels/" + this.channelId + "/live-status",
        this.fetcher,
        controller.signal,
      );
      if (this.closed || controller !== this.controller) return;
      if (status.status !== "OPEN" || !status.chatChannelId) {
        this.closeSocket();
        this.onStatus("방송 대기");
        return;
      }
      if (this.chatChannelId === status.chatChannelId && this.socket) return;
      this.closeSocket();
      const chatChannelId = status.chatChannelId;
      if (
        typeof chatChannelId !== "string" ||
        !/^[a-z0-9_-]{1,100}$/i.test(chatChannelId)
      )
        throw new Error("치지직 채팅 주소 형식이 변경됐습니다.");
      const query = new URLSearchParams({
        channelId: chatChannelId,
        chatType: "STREAMING",
      });
      const data = await publicRequest(
        TOKEN_API + "/v1/chats/access-token?" + query,
        this.fetcher,
        controller.signal,
      );
      if (this.closed || controller !== this.controller) return;
      if (typeof data.accessToken !== "string" || !data.accessToken)
        throw new Error("치지직 공개 채팅 연결 권한을 받지 못했습니다.");
      this.openSocket(chatChannelId, data.accessToken);
    } catch (error) {
      if (!this.closed && controller === this.controller) {
        permanent = !!error.permanent;
        if (!this.socket?.connected) this.onStatus(error.message);
      }
    } finally {
      this.checking = false;
      if (!permanent) this.schedule();
    }
  }
  openSocket(chatChannelId, token) {
    const server =
      ([...chatChannelId].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
        9) +
      1;
    const socket = new this.Socket(
      "wss://kr-ss" + server + ".chat.naver.com/chat",
      { handshakeTimeout: 10000, maxPayload: 2 * 1024 * 1024 },
    );
    this.socket = socket;
    this.chatChannelId = chatChannelId;
    const current = () => !this.closed && this.socket === socket;
    const send = (packet) => {
      if (current() && socket.readyState === 1)
        socket.send(JSON.stringify(packet));
    };
    this.handshake = setTimeout(() => {
      if (current()) {
        this.closeSocket();
        this.onStatus("치지직 연결 시간 초과 · 다시 연결 중");
        this.schedule();
      }
    }, 15000);
    socket.on("open", () => {
      if (!current()) return;
      send({
        cmd: 100,
        tid: 1,
        cid: chatChannelId,
        svcid: "game",
        ver: "2",
        bdy: { uid: null, devType: 2001, accTkn: token, auth: "READ" },
      });
    });
    socket.on("message", (raw) => {
      if (!current()) return;
      try {
        const packet = JSON.parse(raw.toString());
        this.lastReceived = Date.now();
        if (packet.retCode && packet.retCode !== 0) {
          this.closeSocket();
          this.onStatus("치지직 공개 채팅 접속이 거절됐습니다.");
          return;
        }
        if (packet.cmd === 10100) {
          socket.connected = true;
          clearTimeout(this.handshake);
          this.onStatus("연결됨");
          clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => {
            if (!current()) return;
            if (Date.now() - this.lastReceived > 60000) {
              this.closeSocket();
              this.onStatus("치지직 응답 대기 · 다시 연결 중");
              this.schedule();
            } else send({ cmd: 0, ver: "2" });
          }, 20000);
        } else if (packet.cmd === 0) {
          send({ cmd: 10000, ver: "2" });
        } else if ([93101, 93102].includes(packet.cmd) && socket.connected) {
          // Fresh text and paid messages have separate normalized event types; no history.
          const messages = packet.bdy?.messageList || packet.bdy;
          if (!Array.isArray(messages)) return;
          for (const rawChat of messages) {
            try {
              const message =
                packet.cmd === 93102
                  ? parseDonation(rawChat)
                  : parseChat(rawChat);
              if (message) this.onMessage(message);
            } catch {}
          }
        }
      } catch {}
    });
    socket.on("error", () => {
      if (!current()) return;
      this.closeSocket();
      this.onStatus("치지직 연결 실패 · 다시 연결 중");
      this.schedule();
    });
    socket.on("close", () => {
      if (!current()) return;
      this.closeSocket();
      this.onStatus("치지직 연결 끊김 · 다시 연결 중");
      this.schedule();
    });
  }
}
module.exports = {
  PublicChat,
  channelIdFrom,
  channelProfile,
  parseChat,
  parseDonation,
};
