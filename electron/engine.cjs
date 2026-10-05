const { randomUUID } = require("node:crypto");
const { AudienceTools } = require("./audience.cjs");
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
  constructor(saved = {}) {
    this.sessions = saved.sessions || [];
    this.current = saved.current || null;
    this.poll = saved.poll || null;
    if (this.poll && !this.poll.platforms)
      this.poll.platforms =
        this.poll.mode === "demo" ? ["demo"] : ["chzzk", "youtube"];
    if (this.poll && this.poll.chatPrefix === undefined)
      this.poll.chatPrefix = "";
    if (this.poll && !this.poll.votePolicy) this.poll.votePolicy = "first";
    this.recent = [];
    this.lastAuto = -Infinity;
    this.chatCount = 0;
    this.voters = new Map(saved.voters || []);
    this.seen = new Set();
    this.revision = 0;
    this.audience = new AudienceTools(
      saved.audience || {},
      () => this.revision++,
    );
    if (this.current?.endedAt) this.current = null;
  }
  start(title, offsetSeconds = 0, now = Date.now()) {
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
      startedAt: now - offsetSeconds * 1000,
      markers: [],
    };
    this.recent = [];
    this.lastAuto = -Infinity;
    this.chatCount = 0;
    this.seen.clear();
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
    this.current.endedAt = now;
    this.sessions.unshift(this.current);
    this.sessions = this.sessions.slice(0, 100);
    const result = this.current;
    this.current = null;
    this.recent = [];
    this.revision++;
    return result;
  }
  ingest(message, now = Date.now()) {
    this.audience.ingest(message, now);
    if (!this.current || message.kind === "donation") return;
    const { platform, userId, text, id, timestamp } = message;
    if (
      !userId ||
      typeof text !== "string" ||
      !["chzzk", "youtube", "demo"].includes(platform)
    )
      return;
    if (Number.isFinite(timestamp) && timestamp < this.current.startedAt)
      return;
    const key = `${platform}:${id}`;
    if (id && this.seen.has(key)) return;
    if (id) {
      this.seen.add(key);
      if (this.seen.size > 20000)
        this.seen.delete(this.seen.values().next().value);
    }
    this.chatCount++;
    this.recent.push({
      at: now,
      user: `${platform}:${userId}`,
      text: text.slice(0, 300),
    });
    this.recent = this.recent.filter((m) => now - m.at < 70000).slice(-10000);
    if (
      this.poll?.active &&
      this.poll.platforms.includes(platform) &&
      (platform === "chzzk" ||
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
    const window = this.recent.filter((m) => now - m.at < 10000);
    const baseline = this.recent.filter((m) => now - m.at >= 10000).length / 6;
    const unique = new Set(window.map((m) => m.user)).size;
    const ratio = window.length / Math.max(3, baseline);
    if (
      window.length >= 15 &&
      unique >= 5 &&
      ratio >= 2.5 &&
      now - this.lastAuto > 45000
    ) {
      const laughs = window.filter((m) =>
        /ㅋ{2,}|ㅎ{2,}|lol|lmao|와|대박/i.test(m.text),
      ).length;
      const evidence = {
        messages: window.length,
        unique,
        ratio: +ratio.toFixed(1),
        laughs,
        samples: [...new Set(window.map((m) => m.text))].slice(-5),
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
    const allowed = mode === "demo" ? ["demo"] : ["chzzk", "youtube"];
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
      openedAt: Date.now(),
    };
    this.voters.clear();
    this.revision++;
    return this.poll;
  }
  updateYoutubePoll(message) {
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
      options.every((o) => /^\d+$/.test(o.tally))
    ) {
      this.poll.youtubeCounts = options.map((o) => Number(o.tally));
      this.revision++;
    }
    if (metadata?.status === "closed") {
      this.poll.active = false;
      this.poll.closedAt ||= Date.now();
      this.revision++;
    }
  }
  endPoll() {
    if (this.poll) {
      this.poll.closedAt ||= Date.now();
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
      recentCount: this.recent.filter((m) => Date.now() - m.at < 10000).length,
    };
  }
  persisted() {
    return {
      current: this.current,
      sessions: this.sessions,
      poll: this.poll,
      voters: [...this.voters],
      audience: this.audience.persisted(),
    };
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
