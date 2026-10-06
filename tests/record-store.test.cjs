const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { RecordStore } = require("../electron/record-store.cjs");
const key = crypto.randomBytes(32);
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  },
  decryptString: (bytes) => {
    const d = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(0, 12),
    );
    d.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString(
      "utf8",
    );
  },
};
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "streamer-records-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test("records and recoverable legacy backups are encrypted before plaintext is removed", (t) => {
  const directory = fixture(t),
    value = {
      current: { title: "private-title" },
      audience: { participants: ["private-user"] },
    };
  fs.writeFileSync(
    path.join(directory, "sessions.json"),
    JSON.stringify(value),
  );
  fs.writeFileSync(
    path.join(directory, "sessions.json.corrupt-123"),
    "broken private-user",
  );
  const store = new RecordStore(directory, storage);
  assert.deepEqual(store.load(), value);
  store.save(value);
  assert.deepEqual(store.load(), value);
  assert.equal(fs.existsSync(store.legacy), false);
  assert.equal(
    fs.existsSync(path.join(directory, "sessions.json.corrupt-123")),
    false,
  );
  for (const name of fs.readdirSync(directory))
    assert.ok(
      !fs
        .readFileSync(path.join(directory, name), "utf8")
        .includes("private-user"),
    );
  const backup = JSON.parse(
    storage.decryptString(
      Buffer.from(
        fs.readFileSync(
          path.join(directory, "records-legacy-sessions.json.enc"),
          "utf8",
        ),
        "base64",
      ),
    ),
  );
  assert.deepEqual(
    JSON.parse(Buffer.from(backup.rawLegacyDataBase64, "base64").toString()),
    value,
  );
});
test("encryption failure preserves the legacy record and never falls back to plaintext writes", (t) => {
  const directory = fixture(t);
  fs.writeFileSync(path.join(directory, "sessions.json"), '{"safe":true}');
  const store = new RecordStore(directory, {
    isEncryptionAvailable: () => false,
  });
  assert.throws(() => store.save({ safe: false }));
  assert.equal(fs.readFileSync(store.legacy, "utf8"), '{"safe":true}');
  assert.equal(fs.existsSync(store.file), false);
});
test("damaged encrypted data is backed up and history clearing removes only owned recovery files", (t) => {
  const directory = fixture(t),
    store = new RecordStore(directory, storage);
  store.save({ sessions: [1] });
  fs.writeFileSync(store.file, "invalid");
  assert.throws(() => store.load());
  store.backupCorrupt();
  fs.writeFileSync(path.join(directory, "accounts.enc"), "keep-account");
  store.save({ sessions: [] });
  store.clearRecovery();
  assert.deepEqual(store.load(), { sessions: [] });
  assert.equal(
    fs.readFileSync(path.join(directory, "accounts.enc"), "utf8"),
    "keep-account",
  );
  assert.deepEqual(fs.readdirSync(directory).sort(), [
    "accounts.enc",
    "records.enc",
  ]);
});
