const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { participantKey, profileOf } = require("./chat-analysis.cjs");
const { AudienceTools, deadline } = require("./audience.cjs");
const { ChatWindow } = require("./chat-window.cjs");
const { FifoCache, FifoSet } = require("./fifo-cache.cjs");
const PLATFORM_IDS = Object.keys(require("./platform-info.json"));
const {
  DEFAULT_VOTE_PREFIX,
  validateVotePrefix,
  parseChatVote,
} = require("./vote-input.cjs");
function timecode(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
class Engine {
  constructor(saved = {}, { journal = null } = {}) {
    this.journal = journal;
    this.identitySalt = saved.identitySalt || randomBytes(32).toString("hex");
    this.profiles = new FifoCache();
    this.sessions = saved.sessions || [];
    this.current = saved.current || null;
    this.poll = saved.poll || null;
    if (this.poll && !this.poll.platforms)
      this.poll.platforms =
        this.poll.mode === "demo" ? ["demo"] : ["chzzk", "youtube"];
    if (this.poll && this.poll.chatPrefix === undefined)
      this.poll.chatPrefix = "";
    if (this.poll && !this.poll.votePolicy) this.poll.votePolicy = "first";
    this.recent = new ChatWindow();
    this.captureRetries = new Map();
    this.lastAuto = -Infinity;
    this.chatCount = this.current?.telemetry?.chats || 0;
    this.voters = new Map(saved.voters || []);
    this.seen = new FifoSet(saved.seen || []);
    this.revision = 0;
    this.audience = new AudienceTools(
      saved.audience || {},
      () => this.revision++,
    );
    if (this.current?.endedAt) this.current = null;
    if(this.current&&!this.current.chatCaptureMode)this.current.chatCaptureMode="live";
    if (this.current && this.journal) {
      const analysis = this.journal.state(this.current.id).analysis;
      this.current.telemetry = {
        chats: analysis.chats,
        donations: analysis.donations,
        participants: analysis.participants.size,
        viewerSamples:
          this.current.telemetry?.viewerSamples || analysis.viewers.length,
      };
      this.chatCount = analysis.chats;
    }
  }
  start(title, offsetSeconds = 0, now = Date.now(), options = {}) {
    if (this.current) throw new Error("이미 방송을 기록하고 있습니다.");
    if (
      !Number.isFinite(offsetSeconds) ||
      offsetSeconds < 0 ||
      offsetSeconds > 86400
    )
      throw new Error("시작 오프셋은 0~86400초여야 합니다.");
    this.current = {
      id: randomUUID(),
      title: String(title || "새 방송").slice(0, 120),
      startedAt: Number.isFinite(options.startedAt)
        ? Math.min(now, options.startedAt)
        : now - offsetSeconds * 1000,
      captureStartedAt: now,
      recordingMode: options.automatic ? "automatic" : "manual",
      chatCaptureMode: ["live", "deferred", "replay"].includes(options.chatCaptureMode) ? options.chatCaptureMode : "live",
      replayAutoAnalyze: options.replayAutoAnalyze === true,
      schemaVersion: 2,
      sources: options.sources || [],
      telemetry: { chats: 0, donations: 0, participants: 0, viewerSamples: 0 },
      markers: [],
    };
    this.recent.reset();
    this.captureRetries.clear();
    this.lastAuto = -Infinity;
    this.chatCount = 0;
    this.seen.clear();
    this.profiles.clear();
    this.revision++;
    return this.current;
  }
  mark(
    label = "하이라이트",
    kind = "manual",
    evidence = null,
    now = Date.now(),
  ) {
    if (!this.current) throw new Error("먼저 방송 기록을 시작하세요.");
    const at = Math.max(0, now - this.current.startedAt);
    const marker = {
      id: randomUUID(),
      at,
      timecode: timecode(at),
      label: String(label).slice(0, 300),
      kind,
      evidence,
    };
    this.current.markers.push(marker);
    this.revision++;
    return marker;
  }
  stop(now = Date.now()) {
    if (!this.current) throw new Error("진행 중인 방송이 없습니다.");
    this.journal?.flush(this.current);
    this.current.endedAt = now;
    this.sessions.unshift(this.current);
    // Keep metadata for every retained chat archive; history is removed through explicit data controls.
    const result = this.current;
    this.current = null;
    this.recent.reset();
    this.revision++;
    return result;
  }
  capture(message, now, historical = false) {
    if (!this.current || !this.journal) return;
    // Transport catch-up pages are still live-connection traffic. Replay imports
    // use the archive writer directly, never this gameplay capture path.
    if (this.current.chatCaptureMode === "replay") return;
    const kind = message.kind === "donation" ? "donation" : "chat";
    if (
      ![...PLATFORM_IDS, "demo"].includes(message.platform) ||
      typeof message.text !== "string" ||
      message.text.length > 10000
    )
      return;
    const timestamp = Number.isFinite(message.timestamp)
      ? message.timestamp
      : now;
    if (timestamp < this.current.startedAt || timestamp > now + 120000) return;
    if (
      kind === "donation" &&
      (!Number.isSafeInteger(message.amountMicros) ||
        message.amountMicros <= 0 ||
        !/^[A-Z]{3,12}$/.test(message.currency || ""))
    )
      return;
    const userId =
      typeof message.userId === "string" &&
      message.userId &&
      message.userId !== "anonymous"
        ? message.userId
        : null;
    if (kind === "chat" && !userId) return;
    const key = message.id
      ? "record:" +
        message.platform +
        ":" +
        createHash("sha256")
          .update(kind + ":" + message.id)
          .digest("hex")
      : null;
    if (key && this.seen.has(key)) return;
    const actorKey = userId
      ? participantKey(this.identitySalt, message.platform, userId)
      : null;
    this.current.telemetry ||= {
      chats: 0,
      donations: 0,
      participants: 0,
      viewerSamples: 0,
    };
    const events = []; let signature, known = true;
    if (actorKey) {
      const profile = profileOf(message, actorKey, timestamp);
      signature = JSON.stringify({ ...profile, observedAt: 0 });
      if (this.profiles.get(actorKey) !== signature) {
        known = this.journal.handlesParticipantCounts ? true : this.journal
          .state(this.current.id)
          .analysis.participants.has(actorKey);
        events.push({ type: "participant", ...profile });
      }
    }
    events.push({
      id: key || randomUUID(),
      type: kind,
      platform: message.platform,
      participantKey: actorKey,
      displayName: actorKey ? (message.name || "").slice(0, 120) : "익명 후원",
      subscriber:
        typeof message.subscriber === "boolean" ? message.subscriber : null,
      roles: Array.isArray(message.roles)
        ? message.roles.filter((v) => typeof v === "string").slice(0, 12)
        : [],
      text: message.text,
      timestamp,
      receivedAt: now,
      historical,
      sourceMessageId:
        typeof message.id === "string" ? message.id.slice(0, 1024) : null,
      ...(kind === "donation"
        ? {
            amountMicros: message.amountMicros,
            currency: message.currency,
            providerType: message.providerType || "donation",
          }
        : {}),
    });
    if (this.journal.appendBatch) this.journal.appendBatch(this.current, events);
    else for (const event of events) this.journal.append(this.current, event);
    if (actorKey && signature) {
      if (!known) this.current.telemetry.participants++;
      this.profiles.set(actorKey, signature);
      if(this.profiles.size>10000)this.profiles.evictOldest();
    }
    // Admission is atomic. Failed messages are eligible for redelivery/retry.
    if(key){this.seen.add(key);if(this.seen.size>25000)this.seen.evictOldest();}
    const retryId = kind+":"+message.platform+":"+(message.id || "");
    if(this.captureRetries.delete(retryId))this.current.captureGaps=Math.max(0,(this.current.captureGaps||0)-1);
    this.current.telemetry[kind === "chat" ? "chats" : "donations"]++;
    this.revision++;
  }
  sampleViewers(infos, now = Date.now()) {
    if (!this.current || !this.journal) return;
    const sources = infos.map((info) => ({
      platform: info.platform,
      count: info.viewers ?? null,
      live: info.live,
      available: Number.isSafeInteger(info.viewers),
    }));
    this.journal.append(this.current, {
      type: "viewers",
      timestamp: now,
      sources,
    });
    this.current.telemetry ||= {
      chats: 0,
      donations: 0,
      participants: 0,
      viewerSamples: 0,
    };
    this.current.telemetry.viewerSamples++;
    this.revision++;
  }
  attachSources(infos) {
    if (!this.current) return;
    const before = JSON.stringify(this.current.sources || []);
    const sourceKey=s=>s.key+":"+(s.broadcastId||s.startedAt||"");
    const byKey = new Map((this.current.sources || []).map((s) => [sourceKey(s), s]));
    for (const info of infos.filter((info) => info.live && info.key))
      byKey.set(sourceKey(info), {
        key: info.key,
        platform: info.platform,
        channelId: info.channelId,
        name: info.name,
        broadcastId: info.broadcastId,
        startedAt: info.startedAt,
        title: info.title,
        startTimeQuality: info.startedAt ? "platform" : "detected",
      });
    this.current.sources = [...byKey.values()];
    if (before !== JSON.stringify(this.current.sources)) this.revision++;
  }
  ingest(message, now = Date.now(), { historical = false } = {}) {
    try {
      this.capture(message, now, historical);
    } catch (error) {
      if (this.journal) this.journal.failure = error.message;
      if (this.current) {
        const retryId=(message.kind==="donation"?"donation":"chat")+":"+message.platform+":"+(message.id||"");
        if(!this.captureRetries.has(retryId))this.current.captureGaps=(this.current.captureGaps||0)+1;
        if(message.id&&this.captureRetries.size<20000)this.captureRetries.set(retryId,{message,now,historical});
        this.revision++;
      }
    }
    if (historical) return;
    this.audience.ingest(message, now);
    if (!this.current || message.kind === "donation") return;
    const { platform, userId, text, id, timestamp } = message;
    if (
      !userId ||
      typeof text !== "string" ||
      ![...PLATFORM_IDS, "demo"].includes(platform)
    )
      return;
    if (Number.isFinite(timestamp) && timestamp < this.current.startedAt)
      return;
    const key = `${platform}:${id}`;
    if (id && this.seen.has(key)) return;
    if (id) {
      this.seen.add(key);
      if (this.seen.size > 20000)
        this.seen.evictOldest();
    }
    this.chatCount++;
    if (this.current.chatCaptureMode === "live" || !this.current.chatCaptureMode)
      this.recent.push(`${platform}:${userId}`, text, now);
    if (
      this.poll?.active &&
      (!this.poll.endsAt || (now < this.poll.endsAt && (!Number.isFinite(timestamp) || timestamp < this.poll.endsAt))) &&
      this.poll.platforms.includes(platform) &&
      (platform === "chzzk" ||
        platform === "twitch" ||
        (this.poll.mode === "chat" && platform === "youtube") ||
        (this.poll.mode === "demo" && platform === "demo"))
    ) {
      const choice = parseChatVote(text, this.poll.chatPrefix);
      const voter = `${platform}:${userId}`;
      if (choice && choice <= this.poll.options.length) {
        const previous = this.voters.get(voter);
        const next = choice - 1;
        if (
          previous !== next &&
          (previous === undefined || this.poll.votePolicy === "latest")
        ) {
          // Keep one current choice per account, including after restoration.
          if (previous !== undefined) this.poll.counts[previous]--;
          this.voters.set(voter, next);
          this.poll.counts[next]++;
          this.revision++;
        }
      }
    }
    if(this.current.chatCaptureMode&&this.current.chatCaptureMode!=="live")return;
    if (now - this.lastAuto <= 45000) return;
    const stats=this.recent.stats(now, false),unique=stats.unique,ratio=stats.ratio;
    if (
      stats.messages >= 15 &&
      unique >= 5 &&
      ratio >= 2.5 &&
      now - this.lastAuto > 45000
    ) {
      const laughs = stats.laughs;
      const evidence = {
        messages: stats.messages,
        unique,
        ratio: +ratio.toFixed(1),
        laughs,
        samples: this.recent.sampleTexts(now),
      };
      this.mark(
        laughs >= 4 ? "웃음·감탄 반응 급증" : "채팅 반응 급증",
        "auto",
        evidence,
        now,
      );
      this.lastAuto = now;
    }
  }
  createPoll(
    question,
    options,
    mode = "chat",
    platforms = mode === "demo" ? ["demo"] : ["chzzk", "youtube"],
    chatPrefix = DEFAULT_VOTE_PREFIX,
    timerSeconds = null,
    now = Date.now(),
  ) {
    if (!this.current) throw new Error("방송 기록을 시작하세요.");
    if (this.poll?.active) throw new Error("진행 중인 투표를 먼저 종료하세요.");
    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 100 ||
      !Array.isArray(options) ||
      options.length < 2 ||
      options.length > 4 ||
      options.some((o) => typeof o !== "string" || !o.trim() || o.length > 50)
    )
      throw new Error(
        "질문은 100자 이하, 선택지는 2~4개, 각각 50자 이하로 입력하세요.",
      );
    if (new Set(options.map((o) => o.trim())).size !== options.length)
      throw new Error("선택지는 서로 달라야 합니다.");
    const allowed = mode === "demo" ? ["demo"] : PLATFORM_IDS;
    if (
      !["native", "chat", "demo"].includes(mode) ||
      !Array.isArray(platforms) ||
      !platforms.length ||
      new Set(platforms).size !== platforms.length ||
      platforms.some((platform) => !allowed.includes(platform)) ||
      (mode === "native" && !platforms.includes("youtube"))
    )
      throw new Error("투표에 사용할 플랫폼을 선택하세요.");
    validateVotePrefix(chatPrefix);
    const endsAt = deadline(timerSeconds, now);
    this.poll = {
      id: randomUUID(),
      question: question.trim(),
      options: options.map((o) => o.trim()),
      counts: options.map(() => 0),
      youtubeCounts: null,
      active: true,
      mode,
      platforms: [...platforms],
      chatPrefix,
      votePolicy: "latest",
      openedAt: now,
      endsAt,
    };
    this.voters.clear();
    this.revision++;
    return this.poll;
  }
  updateYoutubePoll(message, now = Date.now()) {
    if (
      !this.poll?.youtubeId ||
      !this.poll.platforms.includes("youtube") ||
      this.poll.mode !== "native" ||
      message.id !== this.poll.youtubeId
    )
      return;
    const metadata = message.snippet?.pollDetails?.metadata;
    const options = metadata?.options;
    if (
      Array.isArray(options) &&
      options.length === this.poll.options.length &&
      (!this.poll.endsAt || now < this.poll.endsAt || metadata?.status === "closed") &&
      options.every((o) => /^\d+$/.test(o.tally))
    ) {
      this.poll.youtubeCounts = options.map((o) => Number(o.tally));
      this.revision++;
    }
    if (metadata?.status === "closed") {
      this.endPoll(this.poll.endsAt && now >= this.poll.endsAt ? this.poll.endsAt : now);
    }
  }
  endPoll(now = Date.now()) {
    if (this.poll) {
      this.poll.closedAt = Math.min(this.poll.closedAt ?? now, now);
      this.poll.active = false;
      if (this.current) {
        this.current.polls ||= [];
        const existing = this.current.polls.findIndex(
          (p) => p.id === this.poll.id,
        );
        const result = JSON.parse(JSON.stringify(this.poll));
        if (existing >= 0) this.current.polls[existing] = result;
        else this.current.polls.push(result);
      }
      this.revision++;
    }
  }
  snapshot() {
    return {
      current: this.current,
      sessions: this.sessions,
      audience: this.audience.snapshot(),
      poll: this.poll,
      chatCount: this.chatCount,
      recentCount: this.recent.count(Date.now()),
    };
  }
  persisted() {
    return {
      identitySalt: this.identitySalt,
      seen: [...this.seen].slice(-3000),
      current: this.current,
      sessions: this.sessions,
      poll: this.poll,
      voters: [...this.voters],
      audience: this.audience.persisted(),
    };
  }
  retryCapture(limit = 256) {
    for(const row of [...this.captureRetries.values()].slice(0,limit)) {
      try { this.capture(row.message,row.now,row.historical); } catch { break; }
    }
  }
  summary(session = this.current || this.sessions[0]) {
    if (!session) throw new Error("내보낼 방송 기록이 없습니다.");
    const lines = [
      `# ${session.title}`,
      "",
      `방송 시작: ${new Date(session.startedAt).toISOString()}`,
      "",
      "채팅 반응 기반 편집 후보입니다. 영상 내용을 직접 판독한 결과가 아닙니다.",
      "",
    ];
    for (const m of session.markers) {
      lines.push(
        `- ${m.timecode} · ${m.label} (${m.kind === "manual" ? "수동" : "자동"})`,
      );
      if (m.evidence)
        lines.push(
          `  - 10초간 ${m.evidence.messages}개 채팅 / ${m.evidence.unique}명 / 평소 대비 ${m.evidence.ratio}배`,
          `  - 클립 시작 후보: ${timecode(m.at - 15000)}`,
          `  - 반응 예시: ${m.evidence.samples.map((s) => s.replace(/[\r\n]/g, " ")).join(" / ")}`,
        );
    }
    if (!session.markers.length) lines.push("기록된 마커가 없습니다.");
    return lines.join("\n");
  }
}
module.exports = { Engine, timecode };
