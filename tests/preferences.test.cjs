const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  Preferences,
  normalizeShortcut,
} = require("../electron/preferences.cjs");

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "streamer-preferences-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const registered = new Map();
  const blocked = new Set();
  const shortcuts = {
    isRegistered: (key) => registered.has(key),
    register: (key, callback) => {
      if (blocked.has(key)) return false;
      registered.set(key, callback);
      return true;
    },
    unregister: (key) => registered.delete(key),
  };
  let marks = 0;
  const config = {
    file: path.join(directory, "preferences.json"),
    defaultShortcut: "CommandOrControl+Shift+F8",
    shortcuts,
    onMark: () => marks++,
    ...overrides,
  };
  const preferences = new Preferences(config);
  preferences.register();
  return { preferences, config, registered, blocked, marks: () => marks };
}
test("shortcut changes replace the handler and persist across restart", (t) => {
  const f = fixture(t);
  f.preferences.setShortcut("Alt+Ctrl+F7");
  assert.equal(f.preferences.value.shortcut, "CommandOrControl+Alt+F7");
  assert.equal(f.registered.has(f.config.defaultShortcut), false);
  f.registered.get("CommandOrControl+Alt+F7")();
  assert.equal(f.marks(), 1);
  const restored = new Preferences(f.config);
  assert.equal(restored.value.shortcut, "CommandOrControl+Alt+F7");
});

test("speech voice selection survives restart, validates values and leaves the prior choice on write failure", t => {
  const f = fixture(t), choice = { backend: "browser", voice: "Google 한국의", lang: "ko-KR", local: false };
  assert.equal(f.preferences.value.speechVoice, null);
  f.preferences.setSpeechVoice(choice);
  assert.deepEqual(new Preferences(f.config).value.speechVoice, choice);
  for (const bad of ["Yuna", {}, { ...choice, voice: "x\n" }, { ...choice, backend: "url" }, { ...choice, local: undefined }])
    assert.throws(() => f.preferences.setSpeechVoice(bad), /다시 선택/);
  f.preferences.write = () => { throw Error("disk full"); };
  assert.throws(() => f.preferences.setSpeechVoice(null), /disk full/);
  assert.deepEqual(f.preferences.value.speechVoice, choice);
  fs.writeFileSync(f.config.file, JSON.stringify({ speechVoice: { backend: "url", voice: "bad" } }));
  assert.equal(new Preferences(f.config).value.speechVoice, null);
});
test("capture temporarily releases the old key and cancellation restores it", (t) => {
  const f = fixture(t);
  f.preferences.beginCapture();
  assert.equal(f.registered.size, 0);
  assert.equal(f.preferences.snapshot().shortcutCapturing, true);
  f.preferences.cancelCapture();
  assert.equal(f.registered.size, 1);
  assert.equal(f.preferences.snapshot().shortcutCapturing, false);
});
test("conflicting shortcut restores the old binding after capture", (t) => {
  const f = fixture(t);
  f.blocked.add("CommandOrControl+Alt+F6");
  f.preferences.beginCapture();
  assert.throws(() => f.preferences.setShortcut("Ctrl+Alt+F6"), /사용 중/);
  assert.equal(f.preferences.value.shortcut, f.config.defaultShortcut);
  assert.equal(f.registered.has(f.config.defaultShortcut), true);
  assert.equal(f.preferences.capturing, false);
});
test("failed disk save rolls back a newly registered shortcut", (t) => {
  const f = fixture(t, {
    write: () => {
      throw new Error("disk full");
    },
  });
  f.preferences.beginCapture();
  assert.throws(() => f.preferences.setShortcut("Ctrl+F7"), /저장하지/);
  assert.deepEqual([...f.registered.keys()], [f.config.defaultShortcut]);
  assert.equal(f.preferences.value.shortcut, f.config.defaultShortcut);
});
test("tray preference persists and failed writes keep the prior behavior", (t) => {
  const f = fixture(t);
  f.preferences.setTray(false);
  assert.equal(new Preferences(f.config).value.trayEnabled, false);
  f.preferences.write = () => {
    throw new Error("disk full");
  };
  assert.throws(() => f.preferences.setTray(true), /disk full/);
  assert.equal(f.preferences.value.trayEnabled, false);
  assert.throws(() => f.preferences.setTray("false"), /올바른/);
});
test("invalid preferences restore defaults without accepting malformed shortcuts", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    f.config.file,
    JSON.stringify({ shortcut: "Process.exit()", trayEnabled: "false" }),
  );
  const restored = new Preferences(f.config);
  assert.equal(restored.value.shortcut, f.config.defaultShortcut);
  assert.equal(restored.value.trayEnabled, true);
  assert.equal(restored.value.textScale, 100);
});
test("text size choices persist across restart without changing other preferences", (t) => {
  const f = fixture(t);
  f.preferences.setTray(false);
  for (const scale of [95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150]) {
    f.preferences.setTextScale(scale);
    const restored = new Preferences(f.config);
    assert.equal(restored.snapshot().textScale, scale);
    assert.equal(restored.value.trayEnabled, false);
    assert.equal(restored.value.shortcut, f.config.defaultShortcut);
  }
});

test("raffle name size persists independently, rejects invalid choices and rolls back failed saves", t => {
  const f = fixture(t);
  assert.equal(f.preferences.value.raffleNameSize, 28);
  f.preferences.setTextScale(125);
  for (const size of [18, 28, 30, 48]) {
    f.preferences.setRaffleNameSize(size);
    const restored = new Preferences(f.config);
    assert.equal(restored.snapshot().raffleNameSize, size);
    assert.equal(restored.value.textScale, 125);
  }
  for (const size of [0, 17, 19, 49, 100, "28", null, NaN, Infinity])
    assert.throws(() => f.preferences.setRaffleNameSize(size), /이름 크기/);
  f.preferences.write = () => { throw Error("disk full"); };
  assert.throws(() => f.preferences.setRaffleNameSize(28), /disk full/);
  assert.equal(f.preferences.value.raffleNameSize, 48);
  fs.writeFileSync(f.config.file, JSON.stringify({ raffleNameSize: "48" }));
  assert.equal(new Preferences(f.config).value.raffleNameSize, 28);
});
test("optional winner character survives restart and a failed save preserves its prior state", t => {
  const f = fixture(t);
  assert.equal(f.preferences.value.raffleCharacterEnabled, false);
  f.preferences.setRaffleCharacter(true);
  assert.equal(new Preferences(f.config).snapshot().raffleCharacterEnabled, true);
  f.preferences.setRaffleCharacter(false);
  assert.equal(new Preferences(f.config).snapshot().raffleCharacterEnabled, false);
  for (const value of [1, "true", null, undefined, {}]) assert.throws(() => f.preferences.setRaffleCharacter(value), /캐릭터/);
  f.preferences.write = () => { throw Error("disk full"); };
  assert.throws(() => f.preferences.setRaffleCharacter(true), /disk full/);
  assert.equal(f.preferences.value.raffleCharacterEnabled, false);
  fs.writeFileSync(f.config.file, JSON.stringify({ raffleCharacterEnabled: "true" }));
  assert.equal(new Preferences(f.config).snapshot().raffleCharacterEnabled, false);
});

test("invalid text sizes and failed writes preserve the current size", (t) => {
  const f = fixture(t);
  f.preferences.setTextScale(130);
  for (const value of [0, 90, 94, 149, 151, 500, "150", null, NaN, Infinity]) assert.throws(() => f.preferences.setTextScale(value), /글자 크기/);
  assert.equal(f.preferences.value.textScale, 130);
  f.preferences.write = () => { throw Error("disk full"); };
  assert.throws(() => f.preferences.setTextScale(150), /disk full/);
  assert.equal(f.preferences.value.textScale, 130);
  fs.writeFileSync(f.config.file, JSON.stringify({ textScale: -1 }));
  assert.equal(new Preferences(f.config).value.textScale, 100);
});
test("shortcut validation accepts function keys and common physical keys", () => {
  for (const key of [
    "F2",
    "F24",
    "Ctrl+Space",
    "Ctrl+Alt+K",
    "Shift+num2",
    "Ctrl+Plus",
    "Ctrl+/",
    "Alt+-",
  ])
    assert.ok(normalizeShortcut(key));
  for (const key of [
    "A",
    "Enter",
    "Alt+F4",
    "Ctrl+Alt+Delete",
    "Win+L",
    "Ctrl+Ctrl+F8",
    "F25",
    "",
    null,
  ])
    assert.throws(() => normalizeShortcut(key));
});
