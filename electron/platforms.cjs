const { PublicChat } = require("./chzzk.cjs");
function pollAnnouncement(poll) {
  return (
    "[투표] " +
    poll.question +
    " | " +
    poll.options.map((o, i) => i + 1 + ": " + o).join(" / ") +
    " | 번호만 입력! 1인 1표"
  );
}
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
  if (!response.ok) {
    const error = new Error(
      `플랫폼 API 오류 (${response.status}). 계정 권한·방송 상태를 확인하거나 다시 연결하세요.`,
    );
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? {} : response.json();
}
class Platforms {
  constructor(engine, notify, auth = null) {
    this.engine = engine;
    this.notify = notify;
    this.status = { youtube: "미연결", chzzk: "미연결" };
    this.generation = 0;
    this.auth = auth;
  }
  async api(platform, url, options = {}) {
    const token = await this.auth.getAccess(platform);
    try {
      return await request(url, token, options);
    } catch (error) {
      if (error.status !== 401 || !this.auth) throw error;
      return request(url, await this.auth.getAccess(platform, true), options);
    }
  }
  disconnect() {
    this.generation++;
    clearTimeout(this.timer);
    this.chat?.disconnect();
    this.chat = null;
    this.config = null;
    this.status = { youtube: "미연결", chzzk: "미연결" };
    this.notify();
  }
  async connect(config) {
    this.disconnect();
    this.config = config;
    const generation = this.generation;
    const tasks = [];
    if (config.youtube && config.liveChatId)
      tasks.push(this.youtubeLoop(generation));
    if (config.chzzkChannelId) tasks.push(this.chzzkConnect(generation));
    if (!tasks.length)
      throw new Error("계정을 먼저 연결하고 방송을 시작하세요.");
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
      const data = await this.api(
        "youtube",
        `https://www.googleapis.com/youtube/v3/liveChat/messages?${query}`,
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
    const chat = new PublicChat({
      channelId: this.config.chzzkChannelId,
      onStatus: (status) => {
        if (generation === this.generation) {
          this.status.chzzk = status;
          this.notify();
        }
      },
      onMessage: (message) => {
        if (generation === this.generation) this.engine.ingest(message);
      },
    });
    this.chat = chat;
    await chat.connect();
  }
  async publishPoll(poll) {
    const config = this.config;
    if (
      !config?.youtube ||
      !config.liveChatId ||
      this.status.youtube !== "연결됨"
    )
      throw new Error("유튜브 방송 채팅에 먼저 연결하세요.");
    const result = await this.api(
      "youtube",
      "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
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
  async closePoll(poll) {
    if (!poll?.youtubeId || !poll.active) return;
    if (!this.config?.youtube)
      throw new Error("유튜브 투표 종료를 위해 계정을 다시 연결하세요.");
    const query = new URLSearchParams({
      id: poll.youtubeId,
      status: "closed",
      part: "snippet",
    });
    const result = await this.api(
      "youtube",
      `https://www.googleapis.com/youtube/v3/liveChat/messages/transition?${query}`,
      { method: "POST" },
    );
    this.engine.updateYoutubePoll(result);
  }
}
module.exports = { Platforms, request, pollAnnouncement };
