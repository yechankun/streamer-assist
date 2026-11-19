const { randomInt, randomUUID } = require("node:crypto");
const { validateVotePrefix, parseChatVote } = require("./vote-input.cjs");
const CURRENCIES = ["KRW", "USD", "JPY", "EUR", "GBP", "CAD", "AUD"];
const MAX_EVENTS = 50000;
const MAX_WINNER_MESSAGES = 50;
const info = require("./platform-info.json");
const { checkSession, revisedChoices, remapVoters, dataPlatforms, settingsHistory, publicPoll } = require("./live-options.cjs");
const PLATFORM_IDS = [...Object.keys(info), "demo"];
function targets(platforms, allowEmpty = false) {
  if (
    !Array.isArray(platforms) ||
    (!allowEmpty && !platforms.length) ||
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
function raffleSettings(input, allowEmpty = false) {
  const platforms = targets(input.platforms, allowEmpty);
  if (!["any", "keyword"].includes(input.entryMode) || typeof input.keyword !== "string" || input.keyword.length > 30 ||
    /[\u0000-\u001f\u007f]/.test(input.keyword) || (input.entryMode === "keyword" && !input.keyword.trim()) ||
    typeof input.subscribersOnly !== "boolean" || typeof input.excludeWinners !== "boolean" ||
    typeof input.title !== "string" || input.title.length > 100) throw Error("참여 방식과 추첨 조건을 확인하세요.");
  return { title: input.title.trim() || "시청자 추첨", config: { platforms, entryMode: input.entryMode, keyword: input.keyword.trim(),
    subscribersOnly: input.subscribersOnly, excludeWinners: input.excludeWinners, timerSeconds: input.timerSeconds ?? null } };
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
    this.donationVoters = new Map(saved.donationVoterRules === 2 || !saved.donationPoll?.donation?.plural ? saved.donationVoters || [] : []);
    this.rosterRows=[...this.candidates.values()]; this.rosterRevision=0;
    this.recentCandidates=this.rosterRows.slice(-100);
    this.eligibleTotal=this.eligible().length;
    // Chat previews exist only for this runtime, not saved draw history.
    this.lastChats = new Map();
    this.winnerChat = null;
    this.winnerMessageIds = new Set();
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
    this.clearRaffleRoster();
    this.changed();
    return this.raffle;
  }
  resetRaffle(id, now = Date.now()) {
    if (!this.raffle || this.raffle.id !== id) throw Error("현재 모집 정보를 확인하세요.");
    if (this.raffle.active || this.raffle.latestDraw?.endsAt > now) throw Error("모집과 추첨이 끝난 뒤 초기화하세요.");
    this.raffle = null;
    this.clearRaffleRoster();
    this.changed();
  }
  clearRaffleRoster() {
    this.candidates.clear();
    this.rosterRows=[]; this.rosterRevision++;
    this.recentCandidates=[];this.eligibleTotal=0;
    this.drawn.clear();
    this.reel = null;
    this.lastChats.clear();
    this.winnerChat = null;
    this.winnerMessageIds.clear();
  }
  stopRaffle(now = Date.now()) {
    if (this.raffle?.active) {
      this.raffle.active = false;
      this.raffle.closedAt = now;
      this.changed();
    }
  }
  updateRaffle(input, now = Date.now()) {
    this.expire(now);
    checkSession(this.raffle, input, "모집");
    if (this.raffle.latestDraw?.endsAt > now) throw Error("추첨이 끝난 뒤 설정을 변경하세요.");
    const changedTimer = Object.hasOwn(input, "timerSeconds");
    const settings = raffleSettings({ ...input, timerSeconds: changedTimer ? input.timerSeconds : this.raffle.config.timerSeconds });
    const endsAt = changedTimer ? deadline(input.timerSeconds, now) : this.raffle.endsAt;
    this.raffle = { ...this.raffle, ...settings, dataPlatforms:dataPlatforms(this.raffle,settings.config.platforms), endsAt, settingsRevision: (this.raffle.settingsRevision || 0) + 1, settingsChangedAt: now,settingsHistory:settingsHistory(this.raffle,now) };
    this.eligibleTotal = this.eligible().length;
    this.rosterRevision++;
    this.changed();
    return this.raffle;
  }
  configureRaffle(input, now = Date.now()) {
    this.expire(now);
    const current = this.raffle, changes = input?.changes;
    if (!current || input.id !== current.id) throw Error("현재 모집 정보를 확인하세요.");
    if (current.latestDraw?.endsAt > now) throw Error("추첨이 끝난 뒤 설정을 변경하세요.");
    const fields = ["title", "entryMode", "keyword", "subscribersOnly", "excludeWinners", "platforms", "timerSeconds"];
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length ||
      Object.keys(changes).some(key => !fields.includes(key))) throw Error("모집 설정을 확인하세요.");
    // Merge partial controls against the current state, so independent clicks
    // and other windows cannot overwrite each other's settings or roster.
    const settings = raffleSettings({ title: current.title, ...current.config, ...changes }, true);
    const changedTimer = Object.hasOwn(changes, "timerSeconds");
    const endsAt = changedTimer ? deadline(changes.timerSeconds, now) : current.endsAt;
    const resume = changedTimer && endsAt !== null;
    this.raffle = { ...current, ...settings, endsAt,
      ...(resume ? { active: true, closedAt: undefined, reason: undefined } : {}),
      dataPlatforms: dataPlatforms(current, settings.config.platforms),
      settingsRevision: (current.settingsRevision || 0) + 1, settingsChangedAt: now, settingsHistory: settingsHistory(current, now) };
    this.eligibleTotal = this.eligible().length;
    this.rosterRevision++;
    this.changed();
    return this.raffle;
  }
  toggleRaffle(input, now = Date.now()) {
    if (!this.raffle || input?.id !== this.raffle.id) throw Error("현재 모집 정보를 확인하세요.");
    const config = this.raffle.config;
    let changes;
    if (input.field === "platforms" && PLATFORM_IDS.includes(input.platform))
      changes = { platforms: config.platforms.includes(input.platform) ? config.platforms.filter(p => p !== input.platform) : [...config.platforms, input.platform] };
    else if (["subscribersOnly", "excludeWinners"].includes(input.field)) changes = { [input.field]: !config[input.field] };
    else throw Error("모집 조건을 확인하세요.");
    return this.configureRaffle({ id: input.id, changes }, now);
  }
  resumeRaffle(id, now = Date.now()) {
    if (!this.raffle || id !== this.raffle.id) throw Error("현재 모집 정보를 확인하세요.");
    if (this.raffle.latestDraw?.endsAt > now) throw Error("추첨이 끝난 뒤 다시 모집하세요.");
    if (this.raffle.active) return this.raffle;
    this.raffle = { ...this.raffle, active: true, closedAt: undefined, reason: undefined,
      endsAt: deadline(this.raffle.config.timerSeconds, now) };
    this.changed();
    return this.raffle;
  }
  eligible() {
    if (!this.raffle) return [];
    return [...this.candidates.values()].filter(
      (p) =>
        this.raffle.config.platforms.includes(p.platform) &&
        (!this.raffle.config.subscribersOnly || p.subscriber) &&
        (!this.raffle.config.excludeWinners || !this.drawn.has(p.key)),
    );
  }
  isEligible(p){return!!this.raffle&&this.raffle.config.platforms.includes(p.platform)&&(!this.raffle.config.subscribersOnly||p.subscriber)&&(!this.raffle.config.excludeWinners||!this.drawn.has(p.key));}
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
    // Only a successful draw closes recruitment, in the same state change as
    // freezing the eligible roster. Winner chat remains live after closing.
    if (this.raffle.active) { this.raffle.active = false; this.raffle.closedAt = now; }
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
    const lastMessage = this.lastChats.get(result.winner.key) || null;
    this.winnerChat = { drawId: result.id, lastMessage, messages: [], messageCount: 0 };
    this.winnerMessageIds = new Set(lastMessage?.id ? [lastMessage.id] : []);
    this.drawn.add(result.winner.key);
    if(this.raffle.config.excludeWinners)this.eligibleTotal--;
    this.changed();
    return result;
  }
  getRaffleParticipants({ id, offset = 0, limit = 60 } = {}) {
    if (!this.raffle || id !== this.raffle.id) throw Error("현재 모집 명단을 확인하세요.");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 120)
      throw Error("참여자 명단 범위를 확인하세요.");
    return { id, revision: this.rosterRevision, total: this.rosterRows.length, offset, participants: this.rosterRows.slice(offset, offset + limit).map(p => ({...p, eligible:this.isEligible(p)})) };
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
  closeWinnerChat(id) {
    if (typeof id !== "string" || id !== this.raffle?.latestDraw?.id)
      throw new Error("현재 당첨 결과를 확인하세요.");
    if (this.winnerChat?.drawId !== id) return;
    this.winnerChat = null;
    this.winnerMessageIds.clear();
    this.changed();
  }
  trackRaffleChat(message, identity, now) {
    const r = this.raffle;
    if (!r || !r.config.platforms.includes(message.platform)
      || !fresh(message, r.openedAt, now) || message.historical || message.replay || !message.text.trim()) return;
    const row = {
      id: typeof message.id === "string" && message.id ? message.platform + ":" + message.id : null,
      text: message.text,
      timestamp: Number.isFinite(message.timestamp) && Math.abs(message.timestamp) <= 8640000000000000 ? message.timestamp : now,
      receivedAt: now,
    };
    if (this.candidates.has(identity)) {
      const previous = this.lastChats.get(identity);
      if (!previous || row.timestamp >= previous.timestamp) {
        this.lastChats.set(identity, row);
      }
    }
    const draw = r.latestDraw, detail = this.winnerChat;
    if (!draw || detail?.drawId !== draw.id || draw.winner.key !== identity
      || !fresh(message, draw.startedAt, now) || (row.id && this.winnerMessageIds.has(row.id))) return;
    if (row.id) {
      this.winnerMessageIds.add(row.id);
      if (this.winnerMessageIds.size > 500) this.winnerMessageIds.delete(this.winnerMessageIds.values().next().value);
    }
    this.winnerChat = { ...detail, messages: [...detail.messages, row].slice(-MAX_WINNER_MESSAGES), messageCount: detail.messageCount + 1 };
    this.changed();
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
  updateDonation(input, now = Date.now()) {
    this.expire(now);
    checkSession(this.donationPoll, input, "도네 투표");
    const p = this.donationPoll, next = revisedChoices(p, input);
    const platforms = targets(input.platforms);
    if (platforms.some(platform => platform !== "demo" && !info[platform].donation) || !CURRENCIES.includes(input.currency) ||
      !Number.isSafeInteger(input.minimumMicros) || input.minimumMicros < 1 || input.minimumMicros > 1e15 ||
      typeof input.plural !== "boolean" || (platforms.includes("chzzk") && input.currency !== "KRW"))
      throw Error("투표 통화와 후원 금액을 확인하세요. 치지직 치즈는 KRW로 집계합니다.");
    const endsAt = Object.hasOwn(input,"timerSeconds") ? deadline(input.timerSeconds,now) : p.endsAt;
    const voters = remapVoters(this.donationVoters, next.mapping);
    this.donationPoll = { ...p, question:next.question, options:next.options, counts:next.counts, platforms, chatPrefix:input.chatPrefix,
      donation:{currency:input.currency,minimumMicros:input.minimumMicros,plural:input.plural}, endsAt,
      dataPlatforms:dataPlatforms(p,platforms),settingsRevision:(p.settingsRevision || 0)+1,settingsChangedAt:now,settingsHistory:settingsHistory(p,now),...(Object.hasOwn(input,"timerSeconds")?{timerDurationSeconds:input.timerSeconds}:{}) };
    this.donationVoters = voters;
    this.changed();
    return this.donationPoll;
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
      this.trackRaffleChat(message, identity, now);
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
      const old = this.candidates.get(identity);
      if (r.config.subscribersOnly && message.subscriber !== true && !old) return;
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
          this.rosterRevision++;
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
      };this.candidates.set(identity,candidate);this.rosterRows.push(candidate);this.rosterRevision++;this.recentCandidates.push(candidate);if(this.recentCandidates.length>100)this.recentCandidates.shift();if(this.isEligible(candidate))this.eligibleTotal++;
      this.trackRaffleChat(message, identity, now);
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
    if (!p.donation.plural) this.donationVoters.set(identity, index);
    p.acceptedEvents++;
    this.changed();
  }
  snapshot() {
    if (this.snapshotCache) return this.snapshotCache;
    return this.snapshotCache = {
      raffle: this.raffle
        ? {
            ...publicPoll(this.raffle),
            candidates: this.recentCandidates.map(p => ({...p, eligible:this.isEligible(p)})),
            candidateCount: this.candidates.size,
            rosterRevision: this.rosterRevision,
            eligibleCount: this.eligibleTotal,
            draws: this.raffle.draws.slice(-30),
            winnerChat: this.winnerChat,
          }
        : null,
      donationPoll: publicPoll(this.donationPoll),
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
      donationVoterRules: 2,
    };
  }
}
module.exports = { AudienceTools, CURRENCIES, deadline };
