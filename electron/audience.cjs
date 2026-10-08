const { randomInt, randomUUID } = require("node:crypto");
const { validateVotePrefix, parseChatVote } = require("./vote-input.cjs");
const CURRENCIES = ["KRW", "USD", "JPY", "EUR", "GBP", "CAD", "AUD"];
const MAX_CANDIDATES = 10000;
const MAX_EVENTS = 50000;
const info = require("./platform-info.json");
const PLATFORM_IDS = [...Object.keys(info), "demo"];
function targets(platforms) {
  if (
    !Array.isArray(platforms) ||
    !platforms.length ||
    new Set(platforms).size !== platforms.length ||
    platforms.some((p) => !PLATFORM_IDS.includes(p)) ||
    (platforms.includes("demo") && platforms.length !== 1)
  )
    throw new Error("사용할 방송 플랫폼을 선택하세요.");
  return [...platforms];
}
function deadline(seconds, now) {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400)
    throw new Error("타이머는 1~86400초로 설정하세요.");
  return now + seconds * 1000;
}
function choices(question, options) {
  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > 100 ||
    !Array.isArray(options) ||
    options.length < 2 ||
    options.length > 4 ||
    options.some((o) => typeof o !== "string" || !o.trim() || o.length > 50) ||
    new Set(options.map((o) => o.trim())).size !== options.length
  )
    throw new Error("질문은 100자 이하, 서로 다른 선택지 2~4개를 입력하세요.");
}
function validMessage(message) {
  return (
    message &&
    PLATFORM_IDS.includes(message.platform) &&
    typeof message.userId === "string" &&
    !!message.userId &&
    message.userId.length <= 200 &&
    typeof message.text === "string" &&
    message.text.length <= 10000
  );
}
function fresh(message, openedAt, now) {
  return (
    now >= openedAt &&
    (!Number.isFinite(message.timestamp) || message.timestamp >= openedAt)
  );
}
class AudienceTools {
  constructor(saved = {}, changed = () => {}) {
    this.snapshotCache = null;
    this.changed = () => { this.snapshotCache = null; changed(); };
    this.raffle = saved.raffle || null;
    this.candidates = new Map(
      (saved.raffle?.candidates || []).map((p) => [p.key, p]),
    );
    this.drawn = new Set((saved.raffle?.draws || []).map((d) => d.winner.key));
    this.reel = saved.raffleReel?.id === this.raffle?.latestDraw?.id
      ? saved.raffleReel : null;
    this.donationPoll = saved.donationPoll || null;
    this.donationSeen = new Set(saved.donationSeen || []);
    this.donationVoters = new Map(saved.donationVoters || []);
    this.recentCandidates=[...this.candidates.values()].slice(-100);
    this.eligibleTotal=this.eligible().length;
  }
  startRaffle(input, now = Date.now()) {
    if (this.raffle?.active) throw new Error("참여자 모집을 먼저 종료하세요.");
    if (this.raffle?.latestDraw?.endsAt > now)
      throw new Error("추첨이 끝난 뒤 다시 모집하세요.");
    const platforms = targets(input.platforms);
    if (
      !["any", "keyword"].includes(input.entryMode) ||
      typeof input.keyword !== "string" ||
      input.keyword.length > 30 ||
      /[\u0000-\u001f\u007f]/.test(input.keyword) ||
      (input.entryMode === "keyword" && !input.keyword.trim()) ||
      typeof input.subscribersOnly !== "boolean" ||
      typeof input.excludeWinners !== "boolean" ||
      typeof input.title !== "string" ||
      input.title.length > 100
    )
      throw new Error("참여 방식과 추첨 조건을 확인하세요.");
    const endsAt = deadline(input.timerSeconds, now);
    this.raffle = {
      id: randomUUID(),
      title: input.title.trim() || "시청자 추첨",
      active: true,
      openedAt: now,
      endsAt,
      config: {
        platforms,
        entryMode: input.entryMode,
        keyword: input.keyword.trim(),
        subscribersOnly: input.subscribersOnly,
        excludeWinners: input.excludeWinners,
        timerSeconds: input.timerSeconds ?? null,
      },
      draws: [],
      latestDraw: null,
    };
    this.candidates.clear();
    this.recentCandidates=[];this.eligibleTotal=0;
    this.drawn.clear();
    this.reel = null;
    this.changed();
    return this.raffle;
  }
  stopRaffle(now = Date.now()) {
    if (this.raffle?.active) {
      this.raffle.active = false;
      this.raffle.closedAt = now;
      this.changed();
    }
  }
  eligible() {
    if (!this.raffle) return [];
    return [...this.candidates.values()].filter(
      (p) =>
        (!this.raffle.config.subscribersOnly || p.subscriber) &&
        (!this.raffle.config.excludeWinners || !this.drawn.has(p.key)),
    );
  }
  isEligible(p){return!!this.raffle&&(!this.raffle.config.subscribersOnly||p.subscriber)&&(!this.raffle.config.excludeWinners||!this.drawn.has(p.key));}
  drawRaffle(reducedMotion = false, now = Date.now(), draw = randomInt) {
    this.expire(now);
    if (typeof reducedMotion !== "boolean")
      throw new Error("추첨 표시 설정을 확인하세요.");
    if (this.raffle?.latestDraw?.endsAt > now)
      throw new Error("추첨이 진행 중입니다.");
    const eligible = this.eligible();
    if (!eligible.length) throw new Error("추첨 가능한 참여자가 없습니다.");
    const index = draw(eligible.length);
    if (!Number.isInteger(index) || index < 0 || index >= eligible.length)
      throw new Error("추첨 값을 생성하지 못했습니다.");
    const result = {
      id: randomUUID(),
      winner: { ...eligible[index] },
      participantCount: eligible.length,
      startedAt: now,
      endsAt: now + (reducedMotion ? 0 : 3000),
    };
    // One frozen roster for the latest draw, in playback order with the winner last.
    // Keep it out of draw history and frequent state broadcasts.
    this.reel = {
      id: result.id,
      participants: [...eligible.slice(index + 1), ...eligible.slice(0, index + 1)]
        .map((participant) => ({ ...participant })),
    };
    this.raffle.draws.push(result);
    this.raffle.latestDraw = result;
    this.drawn.add(result.winner.key);
    if(this.raffle.config.excludeWinners)this.eligibleTotal--;
    this.changed();
    return result;
  }
  getRaffleReel(id) {
    if (typeof id !== "string" || id !== this.raffle?.latestDraw?.id)
      throw new Error("현재 추첨 정보를 확인하세요.");
    // Older saved results have no playback roster.
    return this.reel?.id === id ? this.reel.participants : [this.raffle.latestDraw.winner];
  }
  releaseRaffleReel(now = Date.now()) {
    if (!this.reel || this.raffle?.latestDraw?.endsAt > now) return false;
    this.reel = null; this.changed(); return true;
  }
  startDonation(input, now = Date.now()) {
    if (this.donationPoll?.active)
      throw new Error("진행 중인 도네 투표를 종료하세요.");
    choices(input.question, input.options);
    const platforms = targets(input.platforms);
    if (platforms.some((platform) => platform !== "demo" && !info[platform].donation))
      throw new Error("선택한 플랫폼의 도네 투표는 아직 지원하지 않습니다.");
    validateVotePrefix(input.chatPrefix);
    if (
      !CURRENCIES.includes(input.currency) ||
      !Number.isSafeInteger(input.minimumMicros) ||
      input.minimumMicros < 1 ||
      input.minimumMicros > 1e15 ||
      typeof input.plural !== "boolean" ||
      (platforms.includes("chzzk") && input.currency !== "KRW")
    )
      throw new Error(
        "투표 통화와 1표당 금액을 확인하세요. 치지직 치즈는 KRW로 집계합니다.",
      );
    const endsAt = deadline(input.timerSeconds, now);
    this.donationPoll = {
      id: randomUUID(),
      question: input.question.trim(),
      options: input.options.map((o) => o.trim()),
      counts: input.options.map(() => 0),
      active: true,
      mode: "donation",
      platforms,
      chatPrefix: input.chatPrefix,
      openedAt: now,
      endsAt,
      donation: {
        currency: input.currency,
        minimumMicros: input.minimumMicros,
        plural: input.plural,
      },
      acceptedEvents: 0,
      ignoredCurrency: 0,
    };
    this.donationSeen.clear();
    this.donationVoters.clear();
    this.changed();
    return this.donationPoll;
  }
  stopDonation(now = Date.now()) {
    if (this.donationPoll?.active) {
      this.donationPoll.active = false;
      this.donationPoll.closedAt = now;
      this.changed();
    }
  }
  expire(now = Date.now()) {
    if (this.raffle?.active && this.raffle.endsAt && now >= this.raffle.endsAt)
      this.stopRaffle(this.raffle.endsAt);
    if (
      this.donationPoll?.active &&
      this.donationPoll.endsAt &&
      now >= this.donationPoll.endsAt
    )
      this.stopDonation(this.donationPoll.endsAt);
  }
  ingest(message, now = Date.now()) {
    this.expire(now);
    if (!validMessage(message)) return;
    const identity = message.platform + ":" + message.userId;
    if (message.kind !== "donation") {
      const r = this.raffle;
      if (
        !r?.active ||
        !r.config.platforms.includes(message.platform) ||
        !fresh(message, r.openedAt, now) ||
        !message.text.trim()
      )
        return;
      const keyword = r.config.keyword;
      if (
        r.config.entryMode === "keyword" &&
        message.text !== keyword &&
        !message.text.startsWith(keyword + " ")
      )
        return;
      if (r.config.subscribersOnly && message.subscriber !== true) return;
      const old = this.candidates.get(identity);
      const name = (
        typeof message.name === "string" && message.name.trim()
          ? message.name.trim()
          : "시청자 " + message.userId.slice(0, 6)
      ).slice(0, 120);
      if (old) {
        const eligible=this.isEligible(old);
        if (
          old.name !== name ||
          old.subscriber !== (message.subscriber === true)
        ) {
          old.name = name;
          old.subscriber = message.subscriber === true;
          this.eligibleTotal+=Number(this.isEligible(old))-Number(eligible);
          this.changed();
        }
        return;
      }
      const candidate={
        key: identity,
        platform: message.platform,
        userId: message.userId,
        name,
        subscriber: message.subscriber === true,
      };this.candidates.set(identity,candidate);this.recentCandidates.push(candidate);if(this.recentCandidates.length>100)this.recentCandidates.shift();if(this.isEligible(candidate))this.eligibleTotal++;
      this.changed();
      return;
    }
    const p = this.donationPoll;
    if (
      !p?.active ||
      !p.platforms.includes(message.platform) ||
      !fresh(message, p.openedAt, now) ||
      typeof message.id !== "string" ||
      !message.id ||
      message.id.length > 1000 ||
      !Number.isSafeInteger(message.amountMicros) ||
      message.amountMicros <= 0
    )
      return;
    const eventKey = message.platform + ":" + message.id;
    if (this.donationSeen.has(eventKey)) return;
    this.donationSeen.add(eventKey);
    this.changed();
    if (message.currency !== p.donation.currency) {
      p.ignoredCurrency++;
      return;
    }
    const choice = parseChatVote(message.text, p.chatPrefix);
    if (
      !choice ||
      choice > p.options.length ||
      message.amountMicros < p.donation.minimumMicros
    )
      return;
    const index = choice - 1;
    const votes = p.donation.plural
      ? Number(BigInt(message.amountMicros) / BigInt(p.donation.minimumMicros))
      : 1;
    const previous = this.donationVoters.get(identity);
    if (p.counts[index] + votes > 1e9) {
      p.reason = "선택지의 집계 한도에 도달하여 투표를 종료했습니다.";
      this.stopDonation(now);
      return;
    }
    if (!p.donation.plural && previous !== undefined) p.counts[previous]--;
    p.counts[index] += votes;
    this.donationVoters.set(identity, index);
    p.acceptedEvents++;
    this.changed();
  }
  snapshot() {
    if (this.snapshotCache) return this.snapshotCache;
    return this.snapshotCache = {
      raffle: this.raffle
        ? {
            ...this.raffle,
            candidates: this.recentCandidates.slice(),
            candidateCount: this.candidates.size,
            eligibleCount: this.eligibleTotal,
            draws: this.raffle.draws.slice(-30),
          }
        : null,
      donationPoll: this.donationPoll,
    };
  }
  persisted() {
    return {
      raffle: this.raffle
        ? { ...this.raffle, candidates: [...this.candidates.values()] }
        : null,
      raffleReel: this.reel,
      donationPoll: this.donationPoll,
      donationSeen: [...this.donationSeen],
      donationVoters: [...this.donationVoters],
    };
  }
}
module.exports = { AudienceTools, CURRENCIES, deadline };
