const fs = require("node:fs");
const path = require("node:path");
const { ChatAnalysis } = require("./chat-analysis.cjs");
const CHUNK = /^\d{12}\.enc$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const formatters = new Map();
const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
function dayKey(timestamp, timeZone = LOCAL_ZONE) {
  if (!Number.isFinite(timestamp)) throw new Error("기록 시각을 확인하세요.");
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }));
  if (timeZone === LOCAL_ZONE) {
    const date = new Date(timestamp);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
  }
  const parts = Object.fromEntries(formatters.get(timeZone).formatToParts(timestamp).map(p => [p.type, p.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}
function datesOf(value) {
  if (!Array.isArray(value) || value.length > 100000 || value.some(d => typeof d !== "string" || !DATE.test(d) || new Date(d + "T00:00:00Z").toISOString().slice(0, 10) !== d))
    throw new Error("선택한 날짜를 확인하세요.");
  return [...new Set(value)].sort();
}
const historyMethods = {
  atomic(file, value) {
    fs.writeFileSync(file + ".tmp", this.encode(value),{flush:true});
    fs.renameSync(file + ".tmp", file);
  },
  safeFolder(id) {
    const folder = this.folder(id), root = fs.realpathSync(this.directory);
    if (!fs.existsSync(folder)) return null;
    const stat = fs.lstatSync(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("허용되지 않은 기록 경로입니다.");
    const resolved = fs.realpathSync(folder);
    if (!resolved.startsWith(root + path.sep)) throw new Error("허용되지 않은 기록 경로입니다.");
    return resolved;
  },
  dayOf(event) {
    const timestamp = event.timestamp ?? event.observedAt;
    if (this.timeZone !== LOCAL_ZONE) return dayKey(timestamp, this.timeZone);
    if (this.dayCache && timestamp >= this.dayCache.from && timestamp < this.dayCache.to) return this.dayCache.date;
    const day = new Date(timestamp);
    day.setHours(0,0,0,0);
    const from = day.getTime(), date = dayKey(timestamp, this.timeZone);
    day.setDate(day.getDate()+1);
    this.dayCache = { from, to: day.getTime(), date };
    return date;
  },
  describe(file, batch, bytes) {
    const days = new Map();
    let min = Infinity, max = -Infinity, maxSeq = 0;
    for (const event of batch.events) {
      const timestamp = event.timestamp ?? event.observedAt;
      min = Math.min(min, timestamp); max = Math.max(max, timestamp); maxSeq = Math.max(maxSeq, event.seq || 0);
      const date = this.dayOf(event), day = days.get(date) || { date, chats: 0, donations: 0, events: 0 };
      day.events++; if (event.type === "chat") day.chats++; if (event.type === "donation") day.donations++;
      days.set(date, day);
    }
    return { file, bytes, min, max, maxSeq, days: [...days.values()] };
  },
  index(session) {
    if (this.deleting?.has(session.id)) throw new Error("선택한 기록을 정리 중입니다.");
    if (this.indexes.has(session.id)) return this.indexes.get(session.id);
    this.recoverDeletion(session.id);
    const folder = this.safeFolder(session.id);
    const index = { version: 1, timeZone: this.timeZone, entries: [], dirty: false };
    if (!folder) return index;
    const checkpoint = path.join(folder, "index.enc");
    if (fs.existsSync(checkpoint)) {
      try {
        const saved = this.decode(checkpoint);
        if (saved.version === 1 && saved.timeZone === this.timeZone && Array.isArray(saved.entries)) index.entries = saved.entries.filter(e => CHUNK.test(e.file));
      } catch { /* A corrupt acceleration index is rebuilt from original encrypted files. */ }
    }
    const known = new Map(index.entries.map(e => [e.file, e]));
    const files = fs.readdirSync(folder).filter(n => CHUNK.test(n)).sort();
    index.entries = files.map(file => {
      const full = path.join(folder, file), stat = fs.lstatSync(full);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("허용되지 않은 기록 파일입니다.");
      const saved = known.get(file);
      if (saved && saved.bytes === stat.size) return saved;
      index.dirty = true;
      return this.describe(file, this.decode(full), stat.size);
    });
    if (known.size !== files.length) index.dirty = true;
    if (this.indexes.size >= 64) this.indexes.delete(this.indexes.keys().next().value);
    this.indexes.set(session.id, index);
    return index;
  },
  saveIndex(session) {
    const index = this.index(session);
    if (!index.dirty) return;
    this.atomic(path.join(this.folder(session.id), "index.enc"), { version: 1, timeZone: this.timeZone, entries: index.entries });
    index.dirty = false;
  },
  chunkMatches(entry, session, filters = {}) {
    if (filters.dates?.length && !entry.days.some(d => filters.dates.includes(d.date))) return false;
    return entry.max >= session.startedAt + (Number(filters.from) || 0) &&
      (filters.to == null || entry.min <= session.startedAt + Number(filters.to));
  },
  catalog(sessions, currentId = null, selected = []) {
    const dates = datesOf(selected), chosen = new Set(dates), days = new Map();
    let totalBytes = 0, selectedBytes = 0, sharedBytes = 0;
    for (const session of sessions) {
      const index = this.index(session);
      this.saveIndex(session);
      const entries = index.entries.slice();
      const pending = this.states.get(session.id)?.queue;
      if (pending?.length) entries.push(this.describe("", { events: pending }, 0));
      for (const entry of entries) {
        totalBytes += entry.bytes;
        const matching = entry.days.filter(d => chosen.has(d.date));
        if (matching.length) {
          selectedBytes += entry.bytes;
          if (matching.length !== entry.days.length) sharedBytes += entry.bytes;
        }
        for (const day of entry.days) {
          const row = days.get(day.date) || { date: day.date, chats: 0, donations: 0, bytes: 0, sessions: [], protected: false };
          row.chats += day.chats; row.donations += day.donations; row.bytes += entry.bytes;
          if (!row.sessions.includes(session.id)) row.sessions.push(session.id);
          if (session.id === currentId) row.protected = true;
          days.set(day.date, row);
        }
      }
    }
    return { days: [...days.values()].sort((a,b) => b.date.localeCompare(a.date)), totalBytes, selectedBytes, sharedBytes,
      timeZone: this.timeZone, token: this.epoch + ":" + require("node:crypto").createHash("sha256").update(JSON.stringify([...days.values()].filter(d => !dates.length || chosen.has(d.date)))).digest("hex"), selectedDates: dates };
  },
  async queryAll(sessions, filters = {}) {
    const dates = datesOf(filters.dates || []), selected = new Set(dates);
    const from = Math.max(0, Number(filters.from) || 0), to = filters.to == null ? Infinity : Number(filters.to);
    if (!Number.isFinite(from) || Number.isNaN(to) || to < from) throw new Error("기록 조회 범위를 확인하세요.");
    const page = Math.max(0, Math.floor(Number(filters.page) || 0));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(filters.limit) || 30)));
    if (page > 10000) throw new Error("기록 조회 범위를 확인하세요.");
    const before = filters.before ?? null;
    if (before !== null && (typeof before !== "object" || !Number.isFinite(before.timestamp) ||
      !Number.isSafeInteger(before.seq) || before.seq < 1 || typeof before.sessionId !== "string" || !SESSION_ID.test(before.sessionId) || page !== 0))
      throw new Error("기록 조회 위치를 확인하세요.");
    const needed = (page + 1) * limit + 1;
    const chunks = [];
    for (const session of sessions) {
      const index = this.index(session);
      for (const entry of index.entries) {
        if (dates.length && !entry.days.some(d => selected.has(d.date))) continue;
        if (!this.chunkMatches(entry,session,filters)) continue;
        if (filters.kind === "chat" && !entry.days.some(d => d.chats)) continue;
        if (filters.kind === "donation" && !entry.days.some(d => d.donations)) continue;
        chunks.push({ session, entry });
      }
      const pending = this.states.get(session.id)?.queue;
      if (pending?.length) chunks.push({ session, pending: [...pending], entry: this.describe("", { events: pending }, 0) });
    }
    chunks.sort((a,b) => b.entry.max - a.entry.max);
    let result = [];
    const needle = String(filters.text || "").toLocaleLowerCase().slice(0, 200);
    const compare = (a,b) => b.timestamp - a.timestamp || b.sessionId.localeCompare(a.sessionId) || b.seq - a.seq;
    for (const chunk of chunks) {
      if (before && chunk.entry.min > before.timestamp) continue;
      if (result.length >= needed && chunk.entry.max < result.at(-1).timestamp) break;
      await new Promise(resolve => setImmediate(resolve));
      const events = chunk.pending || this.decode(path.join(this.folder(chunk.session.id), chunk.entry.file)).events;
      for (const event of events) {
        if (event.seq > chunk.entry.maxSeq) continue;
        if (!["chat","donation"].includes(event.type) ||
          (dates.length && !selected.has(this.dayOf(event))) ||
          event.timestamp < chunk.session.startedAt + from || event.timestamp > chunk.session.startedAt + to ||
          (filters.kind && filters.kind !== "all" && event.type !== filters.kind) ||
          (filters.platform && event.platform !== filters.platform) ||
          (filters.participantKey && event.participantKey !== filters.participantKey) ||
          (needle && !((event.text || "") + " " + (event.displayName || "")).toLocaleLowerCase().includes(needle))) continue;
        const row = { ...event, at: Math.max(0, event.timestamp - chunk.session.startedAt), sessionId: chunk.session.id, sessionTitle: chunk.session.title, date: this.dayOf(event) };
        if (before && compare(row, before) <= 0) continue;
        result.push(row);
      }
      result.sort(compare);
      if (result.length > needed) result.length = needed;
    }
    const events = result.slice(page * limit, (page + 1) * limit), last = events.at(-1);
    return { events, page, limit, hasMore: result.length > (page + 1) * limit,
      nextCursor: last ? { timestamp: last.timestamp, sessionId: last.sessionId, seq: last.seq } : null };
  },
  deletionBatch(batch, plan) {
    const chosen = new Set(plan.dates);
    const remaining = batch.events.filter(e => !chosen.has(this.dayOf(e)));
    const events = [];
    for (const event of remaining) {
      if (event.type === "participant") plan.retained.add(event.key);
      if (event.participantKey && !plan.retained.has(event.participantKey)) {
        const profile = plan.profiles.get(event.participantKey);
        if (profile) {
          events.push({ ...profile, type: "participant", seq: event.seq, displayName: event.displayName, subscriber: event.subscriber, roles: event.roles, observedAt: event.timestamp });
          plan.retained.add(event.participantKey);
        }
      }
      events.push(event);
    }
    return { ...batch, events };
  },
  deletionPlan(saved) {
    return { ...saved, profiles: new Map(saved.profiles || []), retained: new Set() };
  },
  compactChunk(folder, file, plan) {
    const full = path.join(folder, file);
    if (fs.lstatSync(full).isSymbolicLink()) throw new Error("허용되지 않은 기록 파일입니다.");
    const batch = this.decode(full), next = this.deletionBatch(batch, plan);
    if (!next.events.length) fs.unlinkSync(full);
    else if (JSON.stringify(next.events) !== JSON.stringify(batch.events)) this.atomic(full, next);
  },
  finishDeletion(id, folder, startedAt) {
    const analysis = new ChatAnalysis();
    let seq = 0, chunk = 0;
    const entries = [];
    for (const file of fs.readdirSync(folder).filter(n => CHUNK.test(n)).sort()) {
      const full = path.join(folder,file), batch = this.decode(full);
      for (const event of batch.events) { analysis.accept(event, startedAt); seq = Math.max(seq, event.seq || 0); }
      chunk = Math.max(chunk, Number(file.slice(0,12)));
      entries.push(this.describe(file,batch,fs.statSync(full).size));
    }
    this.atomic(path.join(folder,"summary.enc"), { seq, chunk, analysis: analysis.persisted() });
    this.atomic(path.join(folder,"index.enc"), { version: 1, timeZone: this.timeZone, entries });
    fs.unlinkSync(path.join(folder,"deletion.enc"));
    this.states.delete(id); this.indexes.delete(id); this.revision++;
    const telemetry = { chats: analysis.chats, donations: analysis.donations, participants: analysis.participants.size, viewerSamples: analysis.viewers.length };
    this.recovered.set(id,telemetry);
    return telemetry;
  },
  recoverDeletion(id) {
    if (this.deleting?.has(id)) return;
    const folder = this.safeFolder(id);
    if (!folder || !fs.existsSync(path.join(folder,"deletion.enc"))) return;
    const saved = this.decode(path.join(folder,"deletion.enc")), plan = this.deletionPlan(saved);
    // The encrypted intent stays until compaction and the rebuilt checkpoint are both durable.
    for (const file of fs.readdirSync(folder).filter(n => CHUNK.test(n)).sort()) this.compactChunk(folder,file,plan);
    this.finishDeletion(id,folder,saved.startedAt);
  },
  async deleteDates(sessions, selected, { currentId = null, token } = {}) {
    const dates = datesOf(selected);
    if (!dates.length) throw new Error("삭제할 날짜를 선택하세요.");
    const preview = this.catalog(sessions,currentId,dates);
    if (token && token !== preview.token) throw new Error("기록이 변경되었습니다. 날짜와 용량을 다시 확인하세요.");
    if (preview.days.some(d => dates.includes(d.date) && d.protected)) throw new Error("기록 중인 방송의 날짜는 종료 후 삭제할 수 있습니다.");
    let before = preview.totalBytes;
    const updated = [];
    this.deleting ||= new Set();
    for (const session of sessions) {
      const index = this.index(session);
      if (!index.entries.some(e => e.days.some(d => dates.includes(d.date)))) continue;
      const state = this.state(session.id);
      if (state.queue.length && !this.flush(session)) throw new Error("기록 저장을 완료한 후 다시 시도하세요.");
      const profiles = [...state.analysis.participants].map(([key,p]) => [key, {
        key, platform: p.platform, platformUserId: p.platformUserId, badges: p.badges || []
      }]);
      const folder = this.safeFolder(session.id);
      const saved = { dates, startedAt: session.startedAt, profiles };
      this.atomic(path.join(folder,"deletion.enc"),saved);
      this.deleting.add(session.id);
      const plan = this.deletionPlan(saved);
      try {
        for (const file of fs.readdirSync(folder).filter(n => CHUNK.test(n)).sort()) {
          await new Promise(resolve => setImmediate(resolve));
          this.compactChunk(folder,file,plan);
        }
        updated.push({ id: session.id, telemetry: this.finishDeletion(session.id,folder,session.startedAt) });
      } finally {
        this.deleting.delete(session.id);
        // A failed compaction must re-enter recovery, even in this same process.
        if (fs.existsSync(path.join(folder,"deletion.enc"))) {
          this.states.delete(session.id); this.indexes.delete(session.id);
        }
      }
    }
    const after = this.catalog(sessions,currentId);
    return { dates, updated, freedBytes: Math.max(0,before-after.totalBytes), catalog: after };
  }
};
module.exports = { historyMethods, dayKey, datesOf };
