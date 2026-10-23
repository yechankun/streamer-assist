const { spawn } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const unavailable = "Windows 음성을 사용할 수 없습니다. Windows 설정의 음성 언어와 오디오 출력을 확인하세요.";
const same = (a, b) => a && b && a.windowId === b.windowId && a.channel === b.channel && (!a.session || !b.session || a.session === b.session);

class LocalSpeech {
  constructor({ notify = () => {}, spawnProcess = spawn, platform = process.platform } = {}) {
    Object.assign(this, { notify, spawnProcess, platform });
    this.queue = []; this.sequence = 0; this.generation = 0; this.owner = null; this.child = null; this.active = null;
  }
  worker() {
    if (this.ready) return this.ready;
    if (this.platform !== "win32") return Promise.reject(Error(unavailable));
    const script = fs.readFileSync(path.join(__dirname, "tts-worker.ps1"), "utf8");
    const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const child = this.spawnProcess(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.ready = new Promise((resolve, reject) => {
      let buffer = "", settled = false;
      const timeout = setTimeout(() => fail(), 10000);
      const fail = () => {
        if (!settled) { settled = true; clearTimeout(timeout); reject(Error(unavailable)); }
        if (this.child !== child) return;
        if (this.choice?.backend !== "browser") this.stopCurrent(unavailable);
        this.child = null; this.ready = null; child.kill();
      };
      child.once("error", fail); child.once("exit", fail); child.stdin.on("error", fail);
      // PowerShell diagnostics can contain source fragments: never surface them.
      child.stderr.on("data", () => {});
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        buffer += chunk; if (buffer.length > 65536) { fail(); return; }
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          let message; try { message = JSON.parse(line); } catch { continue; }
          if (message.event === "ready" && !settled) {
            settled = true; clearTimeout(timeout);
            resolve({ voice: String(message.voice || "Windows").slice(0, 160), voices: (Array.isArray(message.voices) ? message.voices : [])
              .filter(row => typeof row.name === "string" && typeof row.lang === "string")
              .map(row => ({ name: row.name.slice(0, 160), lang: row.lang.slice(0, 40) })) });
          }
          else if (message.event === "error") fail();
          else if (message.event === "done" && message.id === this.active?.id) {
            if (message.error) fail(); else this.complete(this.owner, message.id);
          }
        }
      });
    });
    return this.ready;
  }
  async start(owner, choice = null, preview = false) {
    const generation = ++this.generation;
    this.stopCurrent(); this.owner = owner;
    try {
      const status = choice?.backend === "browser" ? { voice: choice.voice } : await this.worker();
      if (generation !== this.generation || !same(this.owner, owner)) return { active: false };
      if (choice?.backend === "native" && !status.voices?.some(row => row.name === choice.voice)) throw Error("선택한 음성이 없습니다. 음성을 다시 선택하세요.");
      this.choice = choice; this.preview = preview;
      return { active: true, ...status };
    } catch (error) { if (same(this.owner, owner)) this.stopCurrent(error.message); throw error; }
  }
  speak(owner, text) {
    if (!same(this.owner, owner)) return false;
    if (typeof text !== "string" || text.length > 10000) throw Error("읽을 채팅을 확인하세요.");
    let clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
    // Keep a truncated emoji's surrogate pair out of the native text parser.
    if (/[\ud800-\udbff]$/.test(clean)) clean = clean.slice(0, -1);
    if (!clean) return true; // Ignoring a silent message does not mute this owner.
    this.queue.push({ id: ++this.sequence, text: clean });
    // Prefer fresh reactions to an ever-growing audio backlog.
    if (this.queue.length > 5) this.queue.shift();
    this.pump(); return true;
  }
  pump() {
    if (this.active || !this.owner || !this.queue.length) return;
    this.active = this.queue.shift();
    const id = this.active.id, owner = this.owner;
    this.playbackTimeout = setTimeout(() => this.complete(owner, id, true), 60000);
    this.playbackTimeout.unref?.();
    if (this.choice?.backend === "browser") this.notify(owner, { active: true, utterance: this.active });
    else this.write({ action: "speak", ...this.active, voice: this.choice?.voice || "" });
  }
  complete(owner, id, error = false) {
    if (!same(this.owner, owner) || this.active?.id !== id) return;
    clearTimeout(this.playbackTimeout); this.active = null;
    if (error) this.stopCurrent("음성을 재생하지 못했습니다. 다른 음성을 선택하세요.");
    else if (this.preview && !this.queue.length) this.stopCurrent();
    else this.pump();
  }
  write(value) { if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(value) + "\n"); }
  stopCurrent(error) {
    clearTimeout(this.playbackTimeout);
    const owner = this.owner; this.owner = null; this.queue = []; this.active = null; this.choice = null; this.preview = false;
    this.write({ action: "cancel" });
    if (owner) this.notify(owner, { active: false, ...(error ? { error } : {}) });
  }
  stop(owner) { if (same(this.owner, owner)) { this.generation++; this.stopCurrent(); } }
  stopWindow(windowId) { if (this.owner?.windowId === windowId) { this.generation++; this.stopCurrent(); } }
  stopChannel(channel) { if (this.owner?.channel === channel) { this.generation++; this.stopCurrent(); } }
  close() {
    this.generation++; this.stopCurrent();
    const child = this.child; this.child = null; this.ready = null;
    child?.stdin.end(); child?.kill();
  }
}
module.exports = { LocalSpeech };
