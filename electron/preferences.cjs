const fs = require("node:fs");
const { defaultTextScale, textScales } = require("../resources/appearance.json");

const modifiers = ["CommandOrControl", "Alt", "Shift", "Super"];
const namedKeys = new Set([
  "Space",
  "Tab",
  "Enter",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Up",
  "Down",
  "Left",
  "Right",
  "Plus",
  "numadd",
  "numsub",
  "nummult",
  "numdiv",
  "numdec",
]);
function normalizeShortcut(value) {
  if (typeof value !== "string" || value.length > 80)
    throw new Error("올바른 단축키를 눌러 주세요.");
  const parts = value
    .split("+")
    .map((part) =>
      ["Control", "Ctrl"].includes(part) ? "CommandOrControl" : part,
    );
  const key = parts.pop();
  if (
    !key ||
    !(
      namedKeys.has(key) ||
      /^[A-Z0-9]$/.test(key) ||
      /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ||
      /^num[0-9]$/.test(key) ||
      /^[,./;\x27\x60\[\]\\=-]$/.test(key)
    )
  )
    throw new Error("지원하지 않는 키입니다. 다른 키를 눌러 주세요.");
  if (
    new Set(parts).size !== parts.length ||
    parts.some((part) => !modifiers.includes(part))
  )
    throw new Error("올바른 단축키 조합을 눌러 주세요.");
  if (!parts.length && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key))
    throw new Error(
      "Ctrl, Alt, Shift 또는 Windows 키를 함께 누르세요. F1~F24는 단독으로 사용할 수 있습니다.",
    );
  const normalized = [
    ...modifiers.filter((part) => parts.includes(part)),
    key,
  ].join("+");
  if (
    [
      "Alt+F4",
      "CommandOrControl+Alt+Delete",
      "Super+L",
      "Super+D",
      "Super+Tab",
    ].includes(normalized)
  )
    throw new Error(
      "Windows에서 사용하는 조합입니다. 다른 단축키를 눌러 주세요.",
    );
  return normalized;
}
function shortcutLabel(value) {
  return value.replace("CommandOrControl", "Ctrl").replace("Super", "Win");
}

class Preferences {
  constructor({
    file,
    defaultShortcut,
    shortcuts,
    onMark,
    write = atomicWrite,
  }) {
    this.file = file;
    this.defaultShortcut = normalizeShortcut(defaultShortcut);
    this.shortcuts = shortcuts;
    this.onMark = onMark;
    this.write = write;
    this.capturing = false;
    this.value = {
      shortcut: this.defaultShortcut,
      trayEnabled: true,
      autoRecord: true,
      textScale: defaultTextScale,
      chatCaptureMode: "live",
      replayAutoAnalyze: false,
    };
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      let shortcut = this.defaultShortcut;
      try {
        shortcut = normalizeShortcut(saved.shortcut);
      } catch {}
      this.value = {
        autoRecord:
          typeof saved.autoRecord === "boolean" ? saved.autoRecord : true,
        shortcut,
        textScale: textScales.includes(saved.textScale) ? saved.textScale : defaultTextScale,
        trayEnabled:
          typeof saved.trayEnabled === "boolean" ? saved.trayEnabled : true,
        chatCaptureMode: ["live","deferred","replay"].includes(saved.chatCaptureMode) ? saved.chatCaptureMode : "live",
        replayAutoAnalyze: saved.replayAutoAnalyze === true,
      };
    }
  }
  register(value = this.value.shortcut) {
    return (
      this.shortcuts.isRegistered(value) ||
      this.shortcuts.register(value, this.onMark)
    );
  }
  beginCapture() {
    this.capturing = true;
    this.shortcuts.unregister(this.value.shortcut);
  }
  cancelCapture() {
    this.capturing = false;
    if (!this.register())
      throw new Error(
        "기존 단축키를 등록하지 못했습니다. 다른 단축키를 지정하세요.",
      );
  }
  setShortcut(value) {
    try {
      const next = normalizeShortcut(value);
      const previous = this.value.shortcut;
      if (next !== previous && this.shortcuts.isRegistered(next))
        throw new Error(
          "이미 사용 중인 단축키입니다. 다른 조합을 눌러 주세요.",
        );
      if (!this.register(next))
        throw new Error(
          "다른 앱이나 Windows에서 사용 중인 단축키입니다. 다른 조합을 눌러 주세요.",
        );
      try {
        this.write(this.file, { ...this.value, shortcut: next });
      } catch (error) {
        if (next !== previous) this.shortcuts.unregister(next);
        throw new Error("단축키 설정을 저장하지 못했습니다.");
      }
      if (next !== previous) this.shortcuts.unregister(previous);
      this.value.shortcut = next;
      this.capturing = false;
    } catch (error) {
      this.capturing = false;
      this.register();
      throw error;
    }
  }
  setTray(enabled) {
    if (typeof enabled !== "boolean")
      throw new Error("올바른 트레이 설정이 아닙니다.");
    this.write(this.file, { ...this.value, trayEnabled: enabled });
    this.value.trayEnabled = enabled;
  }
  setAutoRecord(enabled) {
    if (typeof enabled !== "boolean")
      throw new Error("자동 방송 감지 설정을 확인하세요.");
    this.write(this.file, { ...this.value, autoRecord: enabled });
    this.value.autoRecord = enabled;
  }
  setTextScale(scale) {
    if (!textScales.includes(scale)) throw new Error("지원하는 글자 크기를 선택하세요.");
    this.write(this.file, { ...this.value, textScale: scale });
    this.value.textScale = scale;
  }
  snapshot() {
    return {
      ...this.value,
      defaultShortcut: this.defaultShortcut,
      shortcutCapturing: this.capturing,
      shortcutRegistered: this.shortcuts.isRegistered(this.value.shortcut),
    };
  }
  setCaptureMode(mode,autoAnalyze){
    if(!["live","deferred","replay"].includes(mode)||typeof autoAnalyze!=="boolean")throw Error("채팅 수집 방식을 확인하세요.");
    this.write(this.file,{...this.value,chatCaptureMode:mode,replayAutoAnalyze:autoAnalyze});this.value.chatCaptureMode=mode;this.value.replayAutoAnalyze=autoAnalyze;
  }
}
function atomicWrite(file, value) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, file);
}
module.exports = { Preferences, normalizeShortcut, shortcutLabel };
