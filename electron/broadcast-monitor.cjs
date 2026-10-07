function recordingDecision(
  session,
  infos,
  enabled,
  allow = () => true,
  now = Date.now(),
) {
  if (!enabled) return { action: "none" };
  const live = infos.filter((info) => info.live === true && allow(info));
  if (!session && live.length)
    return {
      action: "start",
      title: live[0].title || live[0].name,
      startedAt: Math.min(...live.map((info) => info.startedAt || now)),
    };
  if (
    session &&
    session.sources?.length &&
    infos.length &&
    infos.every((info) => info.live === false)
  )
    return { action: "stop" };
  return { action: "none" };
}
function parseStartedAt(value, platform, now) {
  if (typeof value === "number" && Number.isFinite(value))
    return value > 0 && value <= now + 60000 ? value : null;
  if (typeof value !== "string") return null;
  const normalized =
    platform === "chzzk" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
      ? value.replace(" ", "T") + "+09:00"
      : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now + 60000
    ? parsed
    : null;
}
function viewerCount(value) {
  const number =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
class BroadcastReaders {
  constructor(auth, fetcher = auth.fetcher || fetch) {
    this.auth = auth;
    this.fetcher = fetcher;
    this.youtube = null;
  }
  async request(url, options = {}) {
    const response = await this.fetcher(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      let message = "방송 조회에 실패했습니다 (" + response.status + ").";
      if (new URL(url).hostname === "www.googleapis.com") {
        const data = await response.json().catch(() => ({}));
        const errors = data?.error?.errors;
        const reasons = Array.isArray(errors) ? errors.map((error) => error?.reason) : [];
        const details = data?.error?.details;
        if (reasons.some((reason) => ["quotaExceeded", "dailyLimitExceeded"].includes(reason)))
          message = "YouTube API 조회 한도를 초과했습니다. 한도 초기화 후 다시 확인합니다.";
        else if (reasons.includes("accessNotConfigured") || (Array.isArray(details) && details.some((detail) => detail?.reason === "SERVICE_DISABLED")))
          message = "앱의 YouTube Data API가 활성화되지 않았습니다.";
        else if (reasons.includes("liveStreamingNotEnabled"))
          message = "연결한 YouTube 채널에서 실시간 방송 기능을 활성화하세요.";
        else if (reasons.some((reason) => ["insufficientPermissions", "insufficientLivePermissions"].includes(reason)))
          message = "YouTube 방송 조회 권한이 없습니다. 방송 채널 계정을 다시 연결하세요.";
        else if (response.status === 401)
          message = "YouTube 로그인 권한이 만료됐습니다. 계정을 다시 연결하세요.";
      }
      throw Object.assign(
        new Error(message),
        { status: response.status },
      );
    }
    return response.json();
  }
  async authorized(platform, url) {
    const run = async (force) =>
      this.request(url, {
        headers: {
          Authorization:
            "Bearer " + (await this.auth.getAccess(platform, force)),
          ...(platform === "twitch"
            ? { "Client-Id": this.auth.config.twitchClientId }
            : {}),
        },
      });
    try {
      return await run(false);
    } catch (error) {
      if (error.status !== 401) throw error;
      return run(true);
    }
  }
  async read(channel, now = Date.now()) {
    if (channel.platform === "youtube") return this.readYoutube(channel, now);
    if (channel.platform === "twitch") {
      const data = await this.authorized(
        "twitch",
        "https://api.twitch.tv/helix/streams?user_id=" +
          encodeURIComponent(channel.channelId),
      );
      if (!Array.isArray(data.data))
        throw new Error("트위치 방송 응답 형식을 확인하지 못했습니다.");
      const stream = data.data.find(
        (item) => item.user_id === channel.channelId && item.type === "live",
      );
      return stream
        ? {
            ...channel,
            live: true,
            broadcastId: stream.id,
            title: stream.title,
            startedAt: parseStartedAt(stream.started_at, "twitch", now),
            viewers: viewerCount(stream.viewer_count),
            observedAt: now,
          }
        : { ...channel, live: false, viewers: 0, observedAt: now };
    }
    if (
      channel.platform !== "chzzk" ||
      !/^[a-f0-9]{32}$/i.test(channel.channelId)
    )
      throw new Error("지원하지 않는 방송 채널입니다.");
    const data = await this.request(
      "https://api.chzzk.naver.com/service/v2/channels/" +
        channel.channelId +
        "/live-detail",
      {
        headers: { "User-Agent": "Mozilla/5.0 StreamerAssist/0.1.0" },
      },
    );
    if (data.code === 200 && data.content === null)
      return { ...channel, live: false, viewers: 0, observedAt: now };
    if (data.code !== 200 || !data.content) {
      if (data.code === 404)
        return { ...channel, live: false, viewers: 0, observedAt: now };
      throw new Error("치지직 방송 상태를 확인하지 못했습니다.");
    }
    const live = data.content;
    if (!["OPEN", "CLOSE"].includes(live.status))
      throw new Error("치지직 방송 상태 형식을 확인하지 못했습니다.");
    return {
      ...channel,
      live: live.status === "OPEN",
      observedAt: now,
      broadcastId: live.liveId == null ? null : String(live.liveId),
      title:
        typeof live.liveTitle === "string"
          ? live.liveTitle.slice(0, 120)
          : channel.name,
      startedAt: parseStartedAt(live.openDate, "chzzk", now),
      viewers:
        live.status === "OPEN" ? viewerCount(live.concurrentUserCount) : 0,
      chatChannelId:
        typeof live.chatChannelId === "string" ? live.chatChannelId : null,
    };
  }
  async readYoutube(channel, now) {
    if (this.youtube?.channelId !== channel.channelId) this.youtube = null;
    let broadcast = this.youtube;
    if (!broadcast) {
      const data = await this.authorized(
        "youtube",
        "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&broadcastStatus=active&broadcastType=all&maxResults=50",
      );
      if (!Array.isArray(data.items))
        throw new Error("YouTube 방송 응답 형식을 확인하지 못했습니다.");
      const item = data.items.find(
        (item) =>
          item.status?.lifeCycleStatus === "live" &&
          item.snippet?.channelId === channel.channelId,
      );
      if (!item)
        return { ...channel, live: false, viewers: 0, observedAt: now };
      broadcast = this.youtube = {
        channelId: channel.channelId,
        id: item.id,
        title: item.snippet.title,
        liveChatId: item.snippet.liveChatId,
        startedAt: parseStartedAt(item.snippet.actualStartTime, "youtube", now),
      };
    }
    const data = await this.authorized(
      "youtube",
      "https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=" +
        encodeURIComponent(broadcast.id),
    );
    if (!Array.isArray(data.items))
      throw new Error("YouTube 방송 응답 형식을 확인하지 못했습니다.");
    const video = data.items.find((item) => item.id === broadcast.id);
    if (!video?.liveStreamingDetails) {
      this.youtube = null;
      throw new Error("YouTube 방송 상세 정보를 받지 못했습니다. 다시 확인합니다.");
    }
    const details = video.liveStreamingDetails;
    const startedAt = parseStartedAt(details.actualStartTime, "youtube", now) || broadcast.startedAt;
    if (details.actualEndTime) {
      this.youtube = null;
      return {
        ...channel,
        live: false,
        viewers: 0,
        observedAt: now,
        endedAt: parseStartedAt(
          details.actualEndTime,
          "youtube",
          now,
        ),
      };
    }
    // Actual start/end times remain reliable while snippet metadata catches up.
    if (!startedAt && !details.activeLiveChatId && video.snippet?.liveBroadcastContent !== "live")
      throw new Error("YouTube 방송 시작 상태를 확인 중입니다. 다시 확인합니다.");
    return {
      ...channel,
      live: true,
      observedAt: now,
      broadcastId: broadcast.id,
      title: video.snippet?.title || broadcast.title || channel.name,
      liveChatId: details.activeLiveChatId || broadcast.liveChatId,
      startedAt,
      viewers: viewerCount(details.concurrentViewers),
    };
  }
}
class BroadcastMonitor {
  constructor({
    reader,
    onUpdate,
    interval = 30000,
    clock = Date.now,
    schedule = setTimeout,
    cancel = clearTimeout,
  }) {
    Object.assign(this, {
      reader,
      onUpdate,
      interval,
      clock,
      schedule,
      cancel,
    });
    this.channels = [];
    this.status = {};
    this.generation = 0;
    this.active = false;
    this.suppressed = new Map();
  }
  configure(channels) {
    const next = channels.filter((c) => c.channelId && c.platform);
    const signature = JSON.stringify(
      next.map((c) => [c.platform, c.channelId]),
    );
    if (this.active && signature === this.signature) return;
    this.stop();
    this.signature = signature;
    this.channels = next;
    this.status = Object.fromEntries(
      next.map((c) => [c.platform, { ...c, live: null, observedAt: null }]),
    );
    if (!next.length) return;
    this.active = true;
    void this.poll();
  }
  stop() {
    this.active = false;
    this.generation++;
    this.cancel(this.timer);
  }
  suppressCurrent() {
    for (const channel of this.channels) {
      const info = this.status[channel.platform];
      if (info?.live === false) continue;
      this.suppressed.set(
        channel.platform + ":" + channel.channelId,
        info?.key || "*",
      );
    }
  }
  allow(info) {
    const held = this.suppressed.get(info.platform + ":" + info.channelId);
    return !held || (held !== "*" && held !== info.key);
  }
  async poll() {
    const generation = this.generation,
      now = this.clock();
    if (!this.active || this.polling === generation) return;
    this.polling = generation;
    const results = await Promise.allSettled(
      this.channels.map((channel) => this.reader.read(channel, now)),
    );
    if (!this.active || generation !== this.generation) return;
    results.forEach((result, index) => {
      const channel = this.channels[index],
        previous = this.status[channel.platform];
      if (result.status === "rejected") {
        this.status[channel.platform] = {
          ...previous,
          ...channel,
          live: null,
          viewers: null,
          observedAt: now,
          error: result.reason.message,
        };
        return;
      }
      const info = result.value;
      const prefix = channel.platform + ":" + channel.channelId + ":";
      const key = info.live
        ? info.broadcastId || info.startedAt
          ? prefix + (info.broadcastId || info.startedAt)
          : previous?.live !== false && previous?.key
            ? previous.key
            : prefix + "detected-" + now
        : previous?.key || null;
      this.status[channel.platform] = { ...info, key, error: "" };
      if (info.live === false)
        this.suppressed.delete(channel.platform + ":" + channel.channelId);
    });
    try {
      await this.onUpdate(Object.values(this.status), now);
      this.error = "";
    } catch (error) {
      this.error = error.message;
    }
    if (this.polling === generation) this.polling = null;
    if (this.active && generation === this.generation) {
      this.timer = this.schedule(() => void this.poll(), this.interval);
      this.timer?.unref?.();
    }
  }
  snapshot() {
    return {
      active: this.active,
      error: this.error || "",
      interval: this.interval,
      platforms: this.status,
    };
  }
}
module.exports = {
  recordingDecision,
  BroadcastReaders,
  BroadcastMonitor,
  parseStartedAt,
  viewerCount,
};
