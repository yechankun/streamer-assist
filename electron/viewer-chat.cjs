const { randomUUID } = require("node:crypto");
const { participantKey } = require("./chat-analysis.cjs");
const platforms = [...Object.keys(require("./platform-info.json")), "demo"];

// Only live previews, never persisted or included in shared window snapshots.
class ViewerChats {
  constructor(salt, changed = () => {}) {
    this.salt = salt; this.changed = changed; this.channels = new Map(); this.recent = new Map(); this.seen = new Map();
  }
  open(owner, target, now = Date.now()) {
    if (!target || !platforms.includes(target.platform) || typeof target.name !== "string" || target.name.length > 120)
      throw Error("채팅을 볼 시청자를 선택하세요.");
    let key = target.participantKey;
    if (typeof target.userId === "string" && target.userId && target.userId.length <= 200)
      key = participantKey(this.salt, target.platform, target.userId);
    if (typeof key !== "string" || !/^[\w-]{43}$/.test(key)) throw Error("시청자 계정을 확인할 수 없습니다.");
    const recent = this.recent.get(key);
    const channel = { id: randomUUID(), participant: { key, platform: target.platform, name: target.name || "시청자", subscriber: target.subscriber === true },
      openedAt: now, lastMessage: recent && now - recent.receivedAt < 300000 ? recent : null, messages: [], messageCount: 0 };
    this.channels.set(owner, channel); this.seen.set(owner, new Set(channel.lastMessage?.id ? [channel.lastMessage.id] : [])); this.changed(); return channel;
  }
  snapshot(owner) { return this.channels.get(owner) || null; }
  close(owner, id) {
    const channel = this.channels.get(owner);
    if (channel && (!id || channel.id === id)) { this.channels.delete(owner); this.seen.delete(owner); this.changed(); }
  }
  ingest(message, now = Date.now()) {
    if (!message || message.historical || message.replay || message.kind === "donation" || !platforms.includes(message.platform)
      || typeof message.userId !== "string" || !message.userId || message.userId === "anonymous" || message.userId.length > 200
      || typeof message.text !== "string" || !message.text.trim() || message.text.length > 10000) return;
    const timestamp = Number.isFinite(message.timestamp) ? message.timestamp : now;
    if (timestamp < now - 300000 || timestamp > now + 120000 || Math.abs(timestamp) > 8640000000000000) return;
    const key = participantKey(this.salt, message.platform, message.userId);
    const previous = this.recent.get(key);
    const row = { id: typeof message.id === "string" && message.id ? message.platform + ":" + message.id : null, text: message.text, timestamp, receivedAt: now };
    if (previous && row.id && previous.id === row.id) return;
    if (!previous || timestamp >= previous.timestamp) {
      this.recent.delete(key); this.recent.set(key, row);
      if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value);
    }
    for (const [owner, channel] of this.channels) {
      if (channel.participant.key !== key || channel.participant.platform !== message.platform || timestamp < channel.openedAt
        || (row.id && this.seen.get(owner).has(row.id))) continue;
      if (row.id) { const ids = this.seen.get(owner); ids.add(row.id); if (ids.size > 500) ids.delete(ids.values().next().value); }
      this.channels.set(owner, { ...channel, messages: [...channel.messages, row].slice(-50), messageCount: channel.messageCount + 1 });
      this.changed();
    }
  }
}
module.exports = { ViewerChats };
