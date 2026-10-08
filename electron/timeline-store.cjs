const fs = require("node:fs");
const path = require("node:path");
const { gzipSync, gunzipSync } = require("node:zlib");
const { ChatAnalysis } = require("./chat-analysis.cjs");
const MAGIC = Buffer.from("SAT2");
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
class TimelineStore {
  constructor(directory, storage, options = {}) {
    this.directory = path.resolve(directory);
    this.storage = storage;
    this.states = new Map();
    this.indexes = new Map();
    this.recovered = new Map();
    this.epoch = require("node:crypto").randomUUID();
    this.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.revision = 0;
    this.failure = "";
    this.maxQueueEvents=options.maxQueueEvents||20000;
    this.chunkEventLimit=options.chunkEventLimit||256;
    this.chunkBytesLimit=options.chunkBytesLimit||128*1024;
    this.autoFlushEvents=options.autoFlushEvents||256;
    this.entryBytes=new WeakMap();
    fs.mkdirSync(this.directory, { recursive: true });
  }
  available() {
    return (
      this.storage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        this.storage.getSelectedStorageBackend?.() !== "basic_text")
    );
  }
  folder(id) {
    if (!UUID.test(id)) throw new Error("올바른 방송 기록 ID가 아닙니다.");
    return path.join(this.directory, id);
  }
  encode(value) {
    if (!this.available())
      throw new Error("Windows 암호화 저장소를 사용할 수 없습니다.");
    return Buffer.concat([MAGIC, this.storage.encryptString(
      gzipSync(Buffer.from(JSON.stringify(value)), { level: 6 }).toString("base64"),
    )]);
  }
  decode(file) {
    if (!this.available())
      throw new Error("Windows 암호화 저장소를 사용할 수 없습니다.");
    const data = fs.readFileSync(file);
    const compressed = this.storage.decryptString(
      data.subarray(0, 4).equals(MAGIC) ? data.subarray(4) : Buffer.from(data.toString("utf8"), "base64"),
    );
    return JSON.parse(
      gunzipSync(Buffer.from(compressed, "base64"), { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8"),
    );
  }
  state(id) {
    if (this.states.has(id)) return this.states.get(id);
    const folder = this.folder(id);
    fs.mkdirSync(folder, { recursive: true });
    this.recoverDeletion(id);
    let summary = {};
    const checkpoint = path.join(folder, "summary.enc");
    if (fs.existsSync(checkpoint)) {
      try {
        summary = this.decode(checkpoint);
      } catch {
        this.failure =
          "일부 통계 색인을 읽지 못했습니다. 원본 기록은 유지됩니다.";
      }
    }
    const chunks = fs
      .readdirSync(folder)
      .filter((n) => /^\d{12}\.enc$/.test(n))
      .sort();
    const state = {
      folder,
      queue: [],
      bytes: 0,
      analysis: new ChatAnalysis(summary.analysis),
      seq: summary.seq || 0,
      chunk: chunks.length ? Number(chunks.at(-1).slice(0, 12)) : 0,
      checkpointSeq: summary.seq || 0,
      lastCheckpoint: 0,
    };
    // Replay newer sequences, including an atomically extended checkpoint-tail chunk.
    for (const chunk of chunks) {
      if (Number(chunk.slice(0, 12)) < (summary.chunk || 0)) continue;
      const batch = this.decode(path.join(folder, chunk));
      for (const event of batch.events || [])
        if (event.seq > state.checkpointSeq) {
          state.analysis.accept(event, batch.startedAt);
          state.seq = Math.max(state.seq, event.seq);
        }
    }
    if (this.states.size >= 4) {
      for (const [key, old] of this.states)
        if (!old.queue.length && key !== id) {
          this.states.delete(key);
          break;
        }
    }
    this.states.set(id, state);
    return state;
  }
  append(session, event) {
    return this.appendBatch(session,[event])[0];
  }
  appendBatch(session, events) {
    const state = this.state(session.id);
    if (state.queue.length + events.length > this.maxQueueEvents)
      throw new Error("저장 실패로 원본 기록 수집이 일시 중단됐습니다.");
    const entries=events.map(event=>({...event,seq:++state.seq}));
    for(const entry of entries){const bytes=Buffer.byteLength(JSON.stringify(entry));this.entryBytes.set(entry,bytes);state.queue.push(entry);state.bytes+=bytes;state.analysis.accept(entry,session.startedAt,{statistics:session.chatCaptureMode!=="deferred"&&session.analysisDeferred!==true});}
    this.revision++;
    if (state.queue.length >= this.autoFlushEvents || state.bytes > this.chunkBytesLimit)
      this.flush(session, false);
    return entries;
  }
  flush(session, checkpoint = true) {
    const state = this.state(session.id);
    try {
      if (state.queue.length) {
        // A file belongs to one calendar day, even when a broadcast spans midnight.
        const index = this.index(session);
        while (state.queue.length) {
          const date = this.dayOf(state.queue[0]);
          let count = 1, groupBytes=this.entryBytes.get(state.queue[0])||Buffer.byteLength(JSON.stringify(state.queue[0]));
          while (count < state.queue.length && count<this.chunkEventLimit && this.dayOf(state.queue[count]) === date) {
            const bytes=this.entryBytes.get(state.queue[count])||Buffer.byteLength(JSON.stringify(state.queue[count]));if(groupBytes+bytes>this.chunkBytesLimit)break;groupBytes+=bytes;count++;
          }
          const events = state.queue.slice(0, count);
          let chunk = String(state.chunk + 1).padStart(12, "0") + ".enc";
          let batch = { schemaVersion: 2, startedAt: session.startedAt, events };
          let extend = false;
          const previous = index.entries.at(-1);
          // Keep one-second durability while avoiding a separate tiny file per tick.
          // Only a bounded tail from the same day is rewritten, atomically.
          if (previous?.days.length === 1 && previous.days[0].date === date &&
              previous.days[0].events + count <= this.chunkEventLimit) {
            const tail = state.tail?.file === previous.file ? state.tail.batch : this.decode(path.join(state.folder, previous.file));
            const merged = { ...batch, events: [...tail.events, ...events] };
            if (Buffer.byteLength(JSON.stringify(merged)) <= this.chunkBytesLimit) {
              batch = merged; chunk = previous.file; extend = true;
            }
          }
          const file = path.join(state.folder, chunk);
          this.atomic(file, batch);
          if (!extend) state.chunk++;
          state.tail = { file: chunk, batch };
          state.queue.splice(0, count);
          const entry = this.describe(chunk, batch, fs.statSync(file).size);
          if (extend) index.entries[index.entries.length - 1] = entry;
          else index.entries.push(entry);
          index.dirty = true;
          this.revision++;
        }
        state.bytes = 0;
      }
      if (checkpoint && state.seq !== state.checkpointSeq && Date.now() - state.lastCheckpoint > 10000) {
        const file = path.join(state.folder, "summary.enc");
        fs.writeFileSync(
          file + ".tmp",
          this.encode({
            seq: state.seq,
            chunk: state.chunk,
            analysis: state.analysis.persisted(),
          }),
        );
        fs.renameSync(file + ".tmp", file);
        state.lastCheckpoint = Date.now();
        state.checkpointSeq = state.seq;
        this.saveIndex(session);
      }
      this.failure = "";
      return true;
    } catch {
      this.failure =
        "채팅·후원 기록 저장 실패. 기록 내보내기를 사용하고 디스크·보안 저장소를 확인하세요.";
      if (state.queue.length > 20000)
        throw new Error("미저장 기록이 너무 많아 수집을 중단했습니다.");
      return false;
    }
  }
  status(session) {
    const state = session ? this.state(session.id) : null;
    return {
      encrypted: this.available(),
      pending: state?.queue.length || 0,
      error: this.failure,
    };
  }
  summary(session, filters = {}) {
    if (!UUID.test(session.id)) return new ChatAnalysis().snapshot();
    const state = this.state(session.id);
    const cacheKey = JSON.stringify(filters);
    if (state.summaryCache?.seq === state.seq && state.summaryCache.key === cacheKey) return state.summaryCache.value;
    const result = state.analysis.snapshot(filters);
    // Viewer points carry absolute time; filters use broadcast elapsed milliseconds.
    result.viewers = this.state(session.id)
      .analysis.viewers.filter((v) => {
        const at = v.timestamp - session.startedAt;
        return at >= (filters.from ?? 0) && at <= (filters.to ?? Infinity);
      })
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((v) => ({ ...v, at: Math.max(0, v.timestamp - session.startedAt) }));
    result.segments = result.bins.map((bin) => ({
      from: bin.minute * 60000,
      to: (bin.minute + 1) * 60000,
      chats: bin.chats,
      reactions: {
        laugh: bin.laugh,
        question: bin.question,
        excitement: bin.excitement,
      },
      summary:
        bin.chats +
        "개 채팅 · 웃음 " +
        bin.laugh +
        "개 · 질문 " +
        bin.question +
        "개 · 감탄 " +
        bin.excitement +
        "개",
    }));
    state.summaryCache = { seq: state.seq, key: cacheKey, value: result };
    return result;
  }
  async *events(session, newest = false, filters = {}) {
    if (!UUID.test(session.id)) return;
    const pending = [...(this.states.get(session.id)?.queue || [])];
    const index = this.index(session);
    const chunks = index.entries.filter(entry => this.chunkMatches(entry, session, filters));
    const folder = this.folder(session.id);
    if (newest) {
      for (const event of pending.reverse()) yield event;
      for (const chunk of chunks.slice().reverse()) {
        await new Promise(resolve => setImmediate(resolve));
        for (const event of this.decode(path.join(folder, chunk.file)).events.reverse())
          if (event.seq <= chunk.maxSeq) yield event;
      }
    } else {
      for (const chunk of chunks) {
        await new Promise(resolve => setImmediate(resolve));
        for (const event of this.decode(path.join(folder, chunk.file)).events)
          if (event.seq <= chunk.maxSeq) yield event;
      }
      for (const event of pending) yield event;
    }
  }
  async analyze(session, filters = {}) {
    const from = Math.max(0, Number(filters.from) || 0),
      to = filters.to == null ? Infinity : Number(filters.to);
    if (!Number.isFinite(from) || Number.isNaN(to) || to < from)
      throw new Error("분석 시간 범위를 확인하세요.");
    if (
      !from &&
      to === Infinity &&
      !filters.platform &&
      !filters.participantKey &&
      !filters.text && (!filters.kind || filters.kind === "all") && !filters.dates?.length
    )
      return this.summary(session);
    const analysis = new ChatAnalysis(),
      known = this.state(session.id).analysis.participants;
    const needle = String(filters.text || "")
      .toLocaleLowerCase()
      .slice(0, 200);
    for await (const event of this.events(session, false, filters)) {
      if (!["chat", "donation", "viewers"].includes(event.type)) continue;
      const at = event.timestamp - session.startedAt;
      if (at < from || at > to || (filters.dates?.length && !filters.dates.includes(this.dayOf(event)))) continue;
      if (
        event.type !== "viewers" &&
        ((filters.kind &&
          filters.kind !== "all" &&
          event.type !== filters.kind) ||
          (filters.platform && event.platform !== filters.platform) ||
          (filters.participantKey &&
            event.participantKey !== filters.participantKey) ||
          (needle && !event.text.toLocaleLowerCase().includes(needle)))
      )
        continue;
      if (
        event.participantKey &&
        !analysis.participants.has(event.participantKey)
      ) {
        const profile = known.get(event.participantKey);
        if (profile)
          analysis.accept(
            {
              ...profile,
              type: "participant",
              displayName: event.displayName,
              subscriber: event.subscriber,
              roles: event.roles,
              observedAt: event.timestamp,
            },
            session.startedAt,
          );
      }
      analysis.accept(event, session.startedAt);
    }
    const result = analysis.snapshot();
    result.viewers = analysis.viewers.map((v) => ({
      ...v,
      at: Math.max(0, v.timestamp - session.startedAt),
    }));
    result.segments = result.bins.map((bin) => ({
      from: bin.minute * 60000,
      to: (bin.minute + 1) * 60000,
      chats: bin.chats,
      summary:
        bin.chats +
        "개 채팅 · 웃음 " +
        bin.laugh +
        "개 · 질문 " +
        bin.question +
        "개 · 감탄 " +
        bin.excitement +
        "개",
    }));
    result.scope = {
      from,
      to: to === Infinity ? null : to,
      platform: filters.platform || null,
      participantKey: filters.participantKey || null,
    };
    return result;
  }
  async query(session, filters = {}) {
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 30));
    const page = Math.max(0, Math.floor(Number(filters.page) || 0));
    const from = Math.max(0, Number(filters.from) || 0),
      to = filters.to == null ? Infinity : Number(filters.to);
    if (!Number.isFinite(from) || Number.isNaN(to) || to < from || page > 10000)
      throw new Error("기록 조회 범위를 확인하세요.");
    const kind = filters.kind || "all",
      needle = String(filters.text || "")
        .toLocaleLowerCase()
        .slice(0, 200);
    const result = [];
    let skipped = 0,
      hasMore = false;
    for await (const event of this.events(session, true, filters)) {
      if (!["chat", "donation"].includes(event.type)) continue;
      const at = event.timestamp - session.startedAt;
      if (
        at < from ||
        at > to ||
        (filters.dates?.length && !filters.dates.includes(this.dayOf(event))) ||
        (kind !== "all" && event.type !== kind) ||
        (filters.platform && filters.platform !== event.platform) ||
        (filters.participantKey &&
          filters.participantKey !== event.participantKey) ||
        (needle &&
          !((event.text || "") + " " + (event.displayName || ""))
            .toLocaleLowerCase()
            .includes(needle))
      )
        continue;
      if (skipped++ < page * limit) continue;
      if (result.length === limit) {
        hasMore = true;
        break;
      }
      result.push({ ...event, at: Math.max(0, at) });
    }
    return { events: result, page, limit, hasMore };
  }
  clear() {
    const root = fs.realpathSync(this.directory);
    for (const name of fs.readdirSync(root)) {
      if (!UUID.test(name)) continue;
      const target = path.join(root, name);
      const info = fs.lstatSync(target);
      if (info.isSymbolicLink() || !info.isDirectory()) continue;
      const resolved = fs.realpathSync(target);
      if (!resolved.startsWith(root + path.sep))
        throw new Error("허용되지 않은 기록 경로입니다.");
      fs.rmSync(resolved, { recursive: true, force: true });
    }
    this.states.clear();
    this.indexes.clear();
    this.recovered.clear();
    this.revision++;
  }
}
Object.assign(TimelineStore.prototype, require("./timeline-history.cjs").historyMethods);
module.exports = { TimelineStore };
