const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { LocalSpeech } = require("../electron/local-speech.cjs");
function fixture(t) {
  const writes = [], notices = [], children = [];
  const speech = new LocalSpeech({ platform: "win32", notify: (owner, state) => notices.push({ owner, state }), spawnProcess: (file, args, options) => {
    assert.equal(options.windowsHide, true); assert.equal(options.shell, undefined);
    assert.ok(args.includes("-EncodedCommand"));
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new EventEmitter();
    child.stdin.writable = true; child.stdin.write = line => { writes.push(JSON.parse(line)); return true; }; child.stdin.end = () => {};
    child.kill = () => { child.stdin.writable = false; queueMicrotask(() => child.emit("exit", 0)); };
    children.push(child); queueMicrotask(() => child.stdout.write(JSON.stringify({ event: "ready", voice: "Windows test voice", voices: [{ name: "Windows test voice", lang: "ko-KR" }, { name: "Other voice", lang: "en-US" }] }) + "\n")); return child;
  } });
  t.after(() => speech.close());
  return { speech, writes, notices, children };
}
test("local TTS reads plain text with a bounded fresh queue; mute cancels immediately and late completions cannot restart it", async t => {
  const { speech, writes, children } = fixture(t), owner = { windowId: 1, channel: "winner:a" };
  await speech.start(owner);
  assert.equal(speech.speak(owner, "\u0000\n"), true);
  assert.equal(speech.active, null); assert.equal(speech.queue.length, 0);
  for (let index = 0; index < 12; index++) speech.speak(owner, "<speak>채팅 " + index + "</speak>");
  assert.equal(speech.queue.length, 5); assert.equal(writes.filter(row => row.action === "speak").length, 1);
  const first = speech.active.id;
  children[0].stdout.write(JSON.stringify({ event: "done", id: first }) + "\n");
  assert.equal(writes.at(-1).text, "<speak>채팅 7</speak>");
  const active = speech.active.id; speech.stop(owner);
  assert.equal(writes.at(-1).action, "cancel"); assert.equal(speech.queue.length, 0);
  children[0].stdout.write(JSON.stringify({ event: "done", id: active }) + "\n");
  assert.equal(writes.at(-1).action, "cancel"); assert.equal(speech.speak(owner, "muted"), false);
});
test("TTS ownership stays with one dialog/window; previous owners cannot speak or stop the current reader", async t => {
  const { speech, notices, writes } = fixture(t);
  const first = { windowId: 1, channel: "viewer:a" }, second = { windowId: 2, channel: "winner:b" };
  await speech.start(first); await speech.start(second);
  assert.equal(notices[0].owner, first); assert.equal(notices[0].state.active, false);
  assert.equal(speech.speak(first, "wrong account"), false);
  speech.speak(second, "x".repeat(1000)); assert.equal(writes.at(-1).text.length, 500);
  speech.speak(second, "x".repeat(499) + "😀");
  assert.equal(speech.queue.at(-1).text.length, 499, "truncation never leaves half of an emoji in a native prompt");
  speech.stop(first); assert.equal(speech.owner, second);
  speech.stopWindow(2); assert.equal(speech.owner, null);
});
test("worker failures report only a fixed message, never chat text, commands or raw diagnostics", async t => {
  const { speech, children, notices } = fixture(t), owner = { windowId: 1, channel: "viewer:a" };
  await speech.start(owner); children[0].stderr.write("PRIVATE RAW SOURCE AND CHAT");
  children[0].emit("error", Error("PRIVATE ERROR"));
  assert.equal(speech.owner, null); assert.equal(speech.ready, null);
  assert.equal(JSON.stringify(notices).includes("PRIVATE"), false);
  assert.match(notices.at(-1).state.error, /Windows/);
});

test("native voice inventory validates explicit selection and preview stops after completion", async t => {
  const { speech, writes, children } = fixture(t), owner = { windowId: 1, channel: "viewer:a:preview" };
  const inventory = await speech.worker(); assert.equal(inventory.voices.length, 2);
  await assert.rejects(speech.start(owner, { backend: "native", voice: "missing" }), /다시 선택/);
  await speech.start(owner, { backend: "native", voice: "Other voice" }, true);
  speech.speak(owner, "Preview only"); const id = speech.active.id;
  assert.equal(writes.at(-1).voice, "Other voice");
  children[0].stdout.write(JSON.stringify({ event: "done", id }) + "\n");
  assert.equal(speech.owner, null); assert.equal(speech.active, null);
});

test("Web Speech shares the bounded queue and ownership; stale sessions and completions cannot stop a newer reader", async t => {
  const { speech, notices, children } = fixture(t), choice = { backend: "browser", voice: "Yuna", lang: "ko-KR", local: true };
  const first = { windowId: 1, channel: "viewer:a", session: "one" }, second = { ...first, session: "two" };
  await speech.start(first, choice);
  assert.equal(children.length, 0, "browser playback does not start PowerShell");
  speech.speak(first, "one"); const staleId = speech.active.id;
  speech.speak(first, "two"); assert.equal(speech.queue.length, 1);
  assert.equal(notices.at(-1).state.utterance.text, "one");
  speech.complete(first, staleId); assert.equal(notices.at(-1).state.utterance.text, "two");
  await speech.start(second, choice, true); speech.speak(second, "preview"); const id = speech.active.id;
  speech.stop(first); speech.complete(first, staleId); assert.equal(speech.owner, second);
  assert.equal(speech.speak(first, "old"), false);
  speech.complete(second, id); assert.equal(speech.owner, null);
});
