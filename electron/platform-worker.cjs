// One app-owned worker per platform. Views only consume the shared engine/store.
class PlatformWorker {
  constructor(platform) {
    this.platform = platform;
    this.transport = null;
    this.timer = null;
    this.broadcast = null;
    this.broadcastRequest = null;
    this.broadcastRevision = 0;
  }
  async readBroadcast(channel, now, reader, maxAgeMs = 0) {
    if (channel.platform !== this.platform) throw new Error("플랫폼 수집기를 확인하세요.");
    const key = channel.channelId;
    if (this.broadcastRequest?.key === key) return this.broadcastRequest.promise.then(data => ({ ...data, ...channel }));
    if (maxAgeMs > 0 && this.broadcast?.key === key && now - this.broadcast.at >= 0 && now - this.broadcast.at < maxAgeMs)
      return { ...this.broadcast.data, ...channel };
    const revision = ++this.broadcastRevision;
    const request = { key, promise: null };
    request.promise = Promise.resolve().then(() => reader.read(channel, now)).then(data => {
      if (revision === this.broadcastRevision) this.broadcast = { key, at: now, data };
      return data;
    }).finally(() => { if (this.broadcastRequest === request) this.broadcastRequest = null; });
    this.broadcastRequest = request;
    return request.promise.then(data => ({ ...data, ...channel }));
  }
  disconnectChat() {
    clearTimeout(this.timer); this.timer = null;
    this.transport?.disconnect(); this.transport = null;
  }
}
module.exports = { PlatformWorker };
