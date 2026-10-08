const { createHmac } = require("node:crypto");
const { rankedCounts } = require("./ranked-counts.cjs");
const STOP_WORDS = new Set([
  "그리고",
  "그런데",
  "그냥",
  "정말",
  "진짜",
  "이거",
  "그거",
  "저거",
  "저는",
  "나는",
  "하는",
  "있어요",
  "없어요",
  "ㅋㅋ",
  "ㅎㅎ",
  "the",
  "and",
  "this",
  "that",
]);
function participantKey(salt, platform, userId) {
  return createHmac("sha256", salt)
    .update(platform + "\0" + userId)
    .digest("base64url");
}
function reactionFlags(text) {
  return {
    laugh: /ㅋ{2,}|ㅎ{2,}|\b(?:lol|lmao|rofl)\b/i.test(text),
    question: /[?？]|(?:어떻게|무엇|뭐예요|인가요|나요|까요|어디)/.test(text),
    excitement: /대박|미쳤|와[!ㅋㅎ\s]|최고|와우|\bwow\b/i.test(text),
    link: /https?:\/\/|www\./i.test(text),
  };
}
function tokens(text) {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]{2,30}/gu) || []
  )
    .filter((word) => !STOP_WORDS.has(word) && !/^[ㅋㅎ]+$|^\d+$/.test(word))
    .slice(0, 50);
}
function profileOf(message, key, now) {
  return {
    key,
    platform: message.platform,
    platformUserId: String(message.userId).slice(0, 256),
    displayName:
      typeof message.name === "string" ? message.name.slice(0, 120) : "",
    subscriber:
      typeof message.subscriber === "boolean" ? message.subscriber : null,
    roles: Array.isArray(message.roles)
      ? message.roles.filter((v) => typeof v === "string").slice(0, 12)
      : [],
    badges: Array.isArray(message.badges)
      ? message.badges.filter((v) => typeof v === "string").slice(0, 24)
      : [],
    observedAt: now,
  };
}
class ChatAnalysis {
  constructor(saved = {}) {
    this.chats = saved.chats || 0;
    this.donations = saved.donations || 0;
    this.reactions = saved.reactions || {
      laugh: 0,
      question: 0,
      excitement: 0,
      link: 0,
    };
    this.platforms = saved.platforms || {};
    this.money = saved.money || {};
    this.words = new Map(saved.words || []);
    this.phrases = new Map(saved.phrases || []);
    this.participants = new Map(saved.participants || []);
    this.bins = new Map(saved.bins || []);
    this.viewers = saved.viewers || [];
    this.limited = saved.limited || false;
  }
  accept(event, startedAt, {statistics = true} = {}) {
    if (event.type === "participant") {
      const previous = this.participants.get(event.key);
      const names = previous?.names || [];
      if (event.displayName && names.at(-1) !== event.displayName)
        names.push(event.displayName);
      this.participants.set(event.key, {
        ...previous,
        ...event,
        names: names.slice(-20),
        firstSeenAt: previous?.firstSeenAt ?? event.observedAt,
        lastSeenAt: event.observedAt,
        chats: previous?.chats || 0,
        donations: previous?.donations || 0,
        money: previous?.money || {},
      });
      return;
    }
    if (event.type === "viewers") {
      this.viewers.push(event);
      if (this.viewers.length > 10000) {
        this.viewers.shift();
        this.limited = true;
      }
      return;
    }
    if (!["chat", "donation"].includes(event.type)) return;
    const actor =
      event.participantKey && this.participants.get(event.participantKey);
    if (actor) actor.lastSeenAt = Math.max(actor.lastSeenAt, event.timestamp);
    if (event.type === "donation") {
      this.donations++;
      this.money[event.currency] =
        (this.money[event.currency] || 0) + event.amountMicros;
      if (actor) {
        actor.donations++;
        actor.money[event.currency] =
          (actor.money[event.currency] || 0) + event.amountMicros;
      }
      return;
    }
    this.chats++;
    if (actor) actor.chats++;
    this.platforms[event.platform] = (this.platforms[event.platform] || 0) + 1;
    if(!statistics)return;
    const flags = reactionFlags(event.text);
    const minute = Math.max(
      0,
      Math.floor((event.timestamp - startedAt) / 60000),
    );
    const bin = this.bins.get(minute) || {
      minute,
      chats: 0,
      laugh: 0,
      question: 0,
      excitement: 0,
      link: 0,
      platforms: {},
    };
    bin.chats++;
    bin.platforms[event.platform] = (bin.platforms[event.platform] || 0) + 1;
    for (const flag of Object.keys(flags))
      if (flags[flag]) {
        this.reactions[flag]++;
        bin[flag]++;
      }
    this.bins.set(minute, bin);
    for (const word of tokens(event.text)) {
      if (this.words.has(word) || this.words.size < 10000)
        this.words.set(word, (this.words.get(word) || 0) + 1);
      else this.limited = true;
    }
    const phrase = event.text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 200);
    if (phrase && (this.phrases.has(phrase) || this.phrases.size < 10000))
      this.phrases.set(phrase, (this.phrases.get(phrase) || 0) + 1);
  }
  snapshot({ from = 0, to = Infinity, platform = "" } = {}) {
    const bins = [...this.bins.values()]
      .filter((b) => b.minute * 60000 >= from && b.minute * 60000 <= to)
      .sort((a, b) => a.minute - b.minute);
    const participants = (this.participants.top ? this.participants.top(30,platform) : [...this.participants.values()])
      .filter((p) => !platform || p.platform === platform)
      .sort((a, b) => b.chats - a.chats)
      .slice(0, 30)
      .map((p) => ({
        key: p.key,
        platform: p.platform,
        displayName: p.displayName,
        chats: p.chats,
        donations: p.donations,
        subscriber: p.subscriber,
        roles: p.roles,
        firstSeenAt: p.firstSeenAt,
        lastSeenAt: p.lastSeenAt,
        nameChanges: Math.max(0, p.names.length - 1),
      }));
    return {
      method: "local-statistics-v1",
      chats: this.chats,
      donations: this.donations,
      uniqueParticipants: this.participants.size,
      reactions: this.reactions,
      money: this.money,
      platforms: this.platforms,
      keywords: rankedCounts(this.words, 20),
      repeats: rankedCounts(this.phrases, 10, 1),
      bins,
      participants,
      viewers: this.viewers.filter(
        (v) => v.timestamp >= from && v.timestamp <= to,
      ),
      limited: this.limited,
    };
  }
  persisted() {
    return {
      chats: this.chats,
      donations: this.donations,
      reactions: this.reactions,
      money: this.money,
      platforms: this.platforms,
      limited: this.limited,
      words: [...this.words],
      phrases: [...this.phrases],
      ...(this.participants.descriptor ? {participantIndex:this.participants.descriptor()} : {participants:[...this.participants]}),
      bins: [...this.bins],
      viewers: this.viewers,
    };
  }
}
module.exports = {
  ChatAnalysis,
  participantKey,
  profileOf,
  reactionFlags,
  tokens,
};
