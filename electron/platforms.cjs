const { PublicChat } = require("./chzzk.cjs");
const { voteCommand } = require("./vote-input.cjs");
function pollAnnouncement(poll) {
  const youtubeOnly =
    poll.mode === "native" &&
    !poll.platforms?.includes("chzzk") &&
    poll.platforms?.includes("youtube");
  const prefix = poll.chatPrefix ?? "";
  const choices = poll.options.map(
    (option, index) =>
      (youtubeOnly ? String(index + 1) : voteCommand(prefix, index + 1)) +
      ": " +
      option,
  );
  return (
    "[투표] " +
    poll.question +
    " | " +
    choices.join(" / ") +
    (youtubeOnly
      ? " | YouTube 실시간 투표에서 선택하세요."
      : " | " +
        poll.options
          .map((_, index) => voteCommand(prefix, index + 1))
          .join(" / ") +
        "를 메시지 앞에 입력 · 1인 1표" +
        (poll.votePolicy === "latest" ? " · 다시 입력하면 선택 변경" : "") +
        (poll.mode === "native" ? " · YouTube 실시간 투표에서 선택" : ""))
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
function youtubeMessage(message) {
  const snippet = message.snippet;
  const author = message.authorDetails;
  if (!author?.channelId || !snippet || !message.id) return null;
  const base = {
    platform: "youtube",
    id: message.id,
    userId: author.channelId,
    name:
      typeof author.displayName === "string"
        ? author.displayName.slice(0, 120)
        : undefined,
    subscriber: author.isChatSponsor === true,
    timestamp: Date.parse(snippet.publishedAt),
  };
  if (!Number.isFinite(base.timestamp)) return null;
  if (snippet.type === "textMessageEvent") {
    const text = snippet.textMessageDetails?.messageText;
    return typeof text === "string" ? { ...base, text } : null;
  }
  if (snippet.type !== "superChatEvent") return null;
  const details = snippet.superChatDetails;
  const amountMicros = /^\d+$/.test(String(details?.amountMicros))
    ? Number(details.amountMicros)
    : NaN;
  if (
    !Number.isSafeInteger(amountMicros) ||
    amountMicros <= 0 ||
    !/^[A-Z]{3}$/.test(details.currency) ||
    typeof details.userComment !== "string"
  )
    return null;
  return {
    ...base,
    kind: "donation",
    text: details.userComment,
    currency: details.currency,
    amountMicros,
  };
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
        if (pageToken) {
          const message = youtubeMessage(m);
          if (message) this.engine.ingest(message);
        }
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
  pollConfiguration(
    targets,
    { demo = false, accounts = {}, youtubeMethod = "chat" } = {},
  ) {
    if (!["chat", "native"].includes(youtubeMethod))
      throw new Error("YouTube 투표 방식을 선택하세요.");
    const allowed = demo ? ["demo"] : ["chzzk", "youtube"];
    if (
      !Array.isArray(targets) ||
      !targets.length ||
      new Set(targets).size !== targets.length ||
      targets.some((platform) => !allowed.includes(platform))
    )
      throw new Error(
        demo
          ? "테스트 채팅 투표를 선택하세요."
          : "투표에 사용할 플랫폼을 켜세요.",
      );
    if (demo) return { mode: "demo", platforms: ["demo"] };
    for (const platform of targets) {
      const label = platform === "chzzk" ? "치지직" : "YouTube";
      if (!accounts[platform]?.connected)
        throw new Error(label + " 계정을 설정에서 먼저 연결하세요.");
      const configured =
        platform === "chzzk"
          ? this.config?.chzzkChannelId
          : this.config?.youtube && this.config?.liveChatId;
      if (!configured || this.status[platform] !== "연결됨")
        throw new Error(
          label +
            " 방송 채팅이 준비되지 않았습니다. 방송을 켠 뒤 다시 연결하세요.",
        );
    }
    return {
      mode:
        targets.includes("youtube") && youtubeMethod === "native"
          ? "native"
          : "chat",
      platforms: allowed.filter((platform) => targets.includes(platform)),
    };
  }
  async publishPoll(poll) {
    if (!poll.platforms.includes("youtube") || poll.mode !== "native") return;
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
module.exports = { Platforms, request, pollAnnouncement, youtubeMessage };
