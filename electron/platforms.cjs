const io = require("socket.io-client");
async function request(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `플랫폼 API 오류 (${response.status}). 토큰 권한·만료·방송 상태를 확인하세요.`,
    );
  return response.status === 204 ? {} : response.json();
}
class Platforms {
  constructor(engine, notify) {
    this.engine = engine;
    this.notify = notify;
    this.status = { youtube: "미연결", chzzk: "미연결" };
    this.generation = 0;
  }
  disconnect() {
    this.generation++;
    clearTimeout(this.timer);
    this.socket?.disconnect();
    this.socket = null;
    this.config = null;
    this.status = { youtube: "미연결", chzzk: "미연결" };
    this.notify();
  }
  async connect(config) {
    this.disconnect();
    this.config = config;
    const generation = this.generation;
    const tasks = [];
    if (config.youtubeToken && config.liveChatId)
      tasks.push(this.youtubeLoop(generation));
    if (config.chzzkToken) tasks.push(this.chzzkConnect(generation));
    if (!tasks.length)
      throw new Error(
        "연결할 플랫폼의 액세스 토큰과 YouTube liveChatId를 입력하세요.",
      );
    await Promise.all(tasks);
  }
  async youtubeLoop(generation, pageToken) {
    if (generation !== this.generation || !this.config) return;
    try {
      const query = new URLSearchParams({
        liveChatId: this.config.liveChatId,
        part: "snippet,authorDetails",
        maxResults: "200",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const data = await request(
        `https://www.googleapis.com/youtube/v3/liveChat/messages?${query}`,
        this.config.youtubeToken,
      );
      if (generation !== this.generation) return;
      this.status.youtube = "연결됨";
      // The initial page includes older chat: do not treat it as a live burst or vote.
      for (const m of data.items || []) {
        this.engine.updateYoutubePoll(m);
        if (pageToken && m.snippet?.type === "textMessageEvent")
          this.engine.ingest({
            platform: "youtube",
            id: m.id,
            userId: m.authorDetails?.channelId,
            text: m.snippet.textMessageDetails?.messageText,
            timestamp: Date.parse(m.snippet.publishedAt),
          });
      }
      if (data.activePollItem)
        this.engine.updateYoutubePoll(data.activePollItem);
      this.notify();
      if (data.offlineAt) {
        this.status.youtube = "방송 종료";
        this.notify();
        return;
      }
      this.timer = setTimeout(
        () => this.youtubeLoop(generation, data.nextPageToken),
        Math.max(1000, data.pollingIntervalMillis || 5000),
      );
    } catch (error) {
      if (generation === this.generation) {
        this.status.youtube = error.message;
        this.notify();
      }
    }
  }
  async chzzkConnect(generation) {
    try {
      const token = this.config.chzzkToken;
      const data = await request(
        "https://openapi.chzzk.naver.com/open/v1/sessions/auth",
        token,
      );
      if (generation !== this.generation) return;
      if (!data.content?.url)
        throw new Error("치지직 세션 URL을 받지 못했습니다.");
      const socket = io(data.content.url, {
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
        timeout: 10000,
      });
      this.socket = socket;
      this.status.chzzk = "구독 대기";
      this.notify();
      const parse = (raw) => (typeof raw === "string" ? JSON.parse(raw) : raw);
      socket.on("SYSTEM", async (raw) => {
        if (generation !== this.generation) return;
        try {
          const event = parse(raw);
          if (event.type === "connected") {
            const query = new URLSearchParams({
              sessionKey: event.data.sessionKey,
            });
            await request(
              `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?${query}`,
              token,
              { method: "POST" },
            );
          }
          if (generation !== this.generation) return;
          if (event.type === "subscribed") this.status.chzzk = "연결됨";
          if (event.type === "revoked") {
            this.status.chzzk = "권한 취소";
            socket.disconnect();
          }
          this.notify();
        } catch (error) {
          if (generation === this.generation) {
            this.status.chzzk = error.message;
            this.notify();
          }
        }
      });
      socket.on("CHAT", (raw) => {
        if (generation !== this.generation) return;
        try {
          const m = parse(raw);
          this.engine.ingest({
            platform: "chzzk",
            userId: m.senderChannelId,
            text: m.content,
            timestamp: m.messageTime,
          });
        } catch {
          this.status.chzzk = "채팅 형식 오류";
          this.notify();
        }
      });
      socket.on("connect_error", () => {
        if (generation === this.generation) {
          this.status.chzzk = "소켓 연결 실패";
          this.notify();
        }
      });
      socket.on("disconnect", () => {
        if (generation === this.generation) {
          this.status.chzzk = "연결 끊김";
          this.notify();
        }
      });
    } catch (error) {
      if (generation === this.generation) {
        this.status.chzzk = error.message;
        this.notify();
      }
    }
  }
  async publishPoll(poll) {
    const config = this.config;
    if (
      !config?.youtubeToken ||
      !config.liveChatId ||
      this.status.youtube !== "연결됨"
    )
      throw new Error("유튜브 방송 채팅에 먼저 연결하세요.");
    const result = await request(
      "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
      config.youtubeToken,
      {
        method: "POST",
        body: JSON.stringify({
          snippet: {
            liveChatId: config.liveChatId,
            type: "pollEvent",
            pollDetails: {
              metadata: {
                questionText: poll.question,
                options: poll.options.map((optionText) => ({ optionText })),
              },
            },
          },
        }),
      },
    );
    if (!result.id) throw new Error("유튜브 투표 ID를 받지 못했습니다.");
    poll.youtubeId = result.id;
    this.engine.updateYoutubePoll(result);
    this.engine.revision++;
    this.notify();
  }
  async announcePoll(poll) {
    if (!this.config?.chzzkToken || this.status.chzzk !== "연결됨")
      throw new Error("치지직 채팅에 먼저 연결하세요.");
    const content = `[투표] ${poll.question} | ${poll.options.map((o, i) => `${i + 1}: ${o}`).join(" / ")} | 번호만 입력! 1인 1표`;
    await request(
      "https://openapi.chzzk.naver.com/open/v1/chats/send",
      this.config.chzzkToken,
      { method: "POST", body: JSON.stringify({ content }) },
    );
  }
  async closePoll(poll) {
    if (!poll?.youtubeId || !poll.active) return;
    if (!this.config?.youtubeToken)
      throw new Error("유튜브 투표 종료를 위해 토큰을 다시 연결하세요.");
    const query = new URLSearchParams({
      id: poll.youtubeId,
      status: "closed",
      part: "snippet",
    });
    const result = await request(
      `https://www.googleapis.com/youtube/v3/liveChat/messages/transition?${query}`,
      this.config.youtubeToken,
      { method: "POST" },
    );
    this.engine.updateYoutubePoll(result);
  }
}
module.exports = { Platforms, request };
