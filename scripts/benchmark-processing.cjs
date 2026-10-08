// CPU-only synthetic comparisons. Full collection uses benchmark-chat-load.cjs.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto"), assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { Engine } = require("../electron/engine.cjs"), { ChatAnalysis } = require("../electron/chat-analysis.cjs"), { CaptureStore } = require("../electron/capture-store.cjs");
const root = path.resolve(__dirname, "..");
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function engineSample(Type, users, messages = 100000) {
  let chats = 0, profiles = 0;
  const journal = { handlesParticipantCounts: true, appendBatch: (_session, events) => {
    for (const event of events) { if (event.type === "chat") chats++; if (event.type === "participant") profiles++; }
    return events;
  } };
  const engine = new Type({ identitySalt: "synthetic-benchmark-salt" }, { journal }); engine.start("Synthetic processing", 0, 100000);
  const began = performance.now();
  for (let i = 0; i < messages; i++) {
    const timestamp = 100000 + Math.floor(i / 20);
    engine.ingest({ platform: "chzzk", id: "m" + i, userId: "u" + (i % users), name: "Viewer", text: "hello", timestamp }, timestamp);
  }
  const milliseconds = performance.now() - began;
  assert.equal(chats, messages); assert.equal(engine.chatCount, messages);
  return { milliseconds, signature: digest({ chats, profiles, seen: [...engine.seen], profilesCache: [...engine.profiles], stats: engine.recent.stats(100000 + Math.floor((messages - 1) / 20)) }) };
}
function rankSample(Type) {
  const words = Array.from({ length: 10000 }, (_, i) => ["word-" + i, (i * 1543) % 101]);
  const phrases = words.map(([text, count]) => [text + " phrase", count]);
  const analysis = new Type({ words, phrases }); let result;
  const began = performance.now();
  for (let i = 0; i < 100; i++) result = analysis.snapshot();
  return { milliseconds: performance.now() - began, signature: digest(result) };
}
function statusSample(optimized) {
  const store = Object.create(CaptureStore.prototype); store.storage = { isEncryptionAvailable: () => true };
  store.pending = new Map(); store.pendingCounts = new Map([["a", { events: 10000, packets: 5000 }], ["b", { events: 10000, packets: 5000 }]]);
  store.pendingEvents = 20000; store.pendingBytes = 10000000; store.failure = "";
  for (let i = 0; i < 10000; i++) store.pending.set(i, { packet: { session: { id: i % 2 ? "a" : "b" }, events: [1, 2] } });
  const legacy = session => ({ encrypted: store.available(), pending: [...store.pending.values()].filter(p => !session || p.packet.session.id === session.id).reduce((sum, p) => sum + p.packet.events.length, 0), pendingBytes: store.pendingBytes, error: store.failure });
  const began = performance.now(); let result;
  for (let i = 0; i < 1000; i++) result = optimized ? store.status({ id: "a" }) : legacy({ id: "a" });
  assert.equal(result.pending, 10000);
  return { milliseconds: performance.now() - began, signature: digest(result) };
}
function compare(before, after) {
  const left = [], right = [];
  for (let i = 0; i < 3; i++) {
    const pair = i % 2 ? [after(), before()].reverse() : [before(), after()];
    assert.equal(pair[0].signature, pair[1].signature, "optimization must preserve processing results");
    left.push(pair[0].milliseconds); right.push(pair[1].milliseconds);
  }
  const beforeMs = median(left), afterMs = median(right);
  return { beforeMs, afterMs, speedup: beforeMs / afterMs, samplesBeforeMs: left, samplesAfterMs: right };
}
function main() {
  const args = process.argv.slice(2), at = args.indexOf("--baseline-revision"), revision = at < 0 ? null : args[at + 1];
  if (at >= 0 && !revision) throw Error("Provide a compatible baseline revision, such as 84aa93f.");
  let temporary, baseline = path.join(root, ".dev/processing-baseline");
  if (revision) {
    temporary = baseline = fs.mkdtempSync(path.join(os.tmpdir(), "streamer-processing-baseline-"));
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", revision, "electron"], { cwd: root, encoding: "utf8" }).trim().split("\n");
    for (const file of files.filter(file => /^electron\/[^/]+\.(cjs|json)$/.test(file)))
      fs.writeFileSync(path.join(baseline, path.basename(file)), execFileSync("git", ["show", revision + ":" + file], { cwd: root }));
  }
  try {
  if (!fs.existsSync(path.join(baseline, "engine.cjs"))) throw Error("Use --baseline-revision 84aa93f or capture an isolated processing baseline.");
  const previous = require(path.join(baseline, "engine.cjs")).Engine, PreviousAnalysis = require(path.join(baseline, "chat-analysis.cjs")).ChatAnalysis;
  const result = {
    repeatedUsers: compare(() => engineSample(previous, 1000), () => engineSample(Engine, 1000)),
    distinctUsers: compare(() => engineSample(previous, 100000), () => engineSample(Engine, 100000)),
    rankings: compare(() => rankSample(PreviousAnalysis), () => rankSample(ChatAnalysis)),
    queuedStatus: compare(() => statusSample(false), () => statusSample(true)),
  };
  const report = { at: new Date().toISOString(), node: process.version, baselineRevision: revision, host: os.cpus()[0].model,
    note: "Three alternating samples, median; exact synthetic result digests compared. CPU fixture has no network, disk writer, SQLite, IPC or renderer. Status fixture contains 10000 parked packets.", result };
  fs.mkdirSync(path.join(root, "release"), { recursive: true });
  fs.writeFileSync(path.join(root, "release/processing-performance.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  } finally {
    if (temporary) {
      const resolved = fs.realpathSync(temporary);
      if (fs.lstatSync(temporary).isSymbolicLink() || !resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep + "streamer-processing-baseline-")) throw Error("Unsafe baseline cleanup");
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}
if (require.main === module) main();
