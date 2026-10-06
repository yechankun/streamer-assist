const fs = require("node:fs");
const path = require("node:path");
class RecordStore {
  constructor(directory, storage) {
    this.directory = path.resolve(directory);
    this.storage = storage;
    this.file = path.join(this.directory, "records.enc");
    this.legacy = path.join(this.directory, "sessions.json");
  }
  available() {
    return (
      this.storage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        this.storage.getSelectedStorageBackend?.() !== "basic_text")
    );
  }
  load() {
    if (fs.existsSync(this.file)) {
      if (!this.available())
        throw new Error(
          "암호화 기록을 여는 Windows 보안 저장소를 사용할 수 없습니다.",
        );
      return JSON.parse(
        this.storage.decryptString(
          Buffer.from(fs.readFileSync(this.file, "utf8"), "base64"),
        ),
      );
    }
    return fs.existsSync(this.legacy)
      ? JSON.parse(fs.readFileSync(this.legacy, "utf8"))
      : {};
  }
  save(value) {
    if (!this.available())
      throw new Error(
        "Windows 보안 저장소를 사용할 수 없어 기록을 저장하지 못했습니다.",
      );
    const encrypted = this.storage
      .encryptString(JSON.stringify(value))
      .toString("base64");
    const temporary = this.file + ".tmp";
    fs.writeFileSync(temporary, encrypted);
    fs.renameSync(temporary, this.file);
    // Preserve a recoverable encrypted copy before removing the old plaintext.
    for (const name of fs
      .readdirSync(this.directory)
      .filter((n) => /^sessions\.json(?:\.corrupt-\d+)?$/.test(n))) {
      const original = path.join(this.directory, name);
      const backup = path.join(
        this.directory,
        "records-legacy-" + name + ".enc",
      );
      const content = JSON.stringify({
        rawLegacyDataBase64: fs.readFileSync(original).toString("base64"),
      });
      const tempBackup = backup + ".tmp";
      fs.writeFileSync(
        tempBackup,
        this.storage.encryptString(content).toString("base64"),
      );
      fs.renameSync(tempBackup, backup);
      fs.unlinkSync(original);
    }
  }
  backupCorrupt() {
    const file = fs.existsSync(this.file) ? this.file : this.legacy;
    if (fs.existsSync(file))
      fs.copyFileSync(file, file + ".corrupt-" + Date.now());
  }
  clearRecovery() {
    for (const name of fs.readdirSync(this.directory))
      if (
        /^records(?:-legacy-.+)?\.enc(?:\.corrupt-\d+)?$/.test(name) &&
        name !== "records.enc"
      )
        fs.unlinkSync(path.join(this.directory, name));
  }
}
module.exports = { RecordStore };
