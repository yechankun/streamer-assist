const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AuthManager, CredentialVault } = require("../electron/oauth.cjs");
const { deviceLogin, validateTwitch } = require("../electron/twitch-auth.cjs");
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const validation = { client_id: "public-client", user_id: "123", login: "streamer", scopes: ["user:read:chat"], expires_in: 14400 };
const device = { verification_uri: "https://www.twitch.tv/activate?public=true&device-code=FAKE", device_code: "private-device-code", user_code: "FAKE", interval: 1, expires_in: 1800 };
const tokens = { access_token: "access-new", refresh_token: "refresh-new", expires_in: 14400 };
const account = () => ({ userId: "123", clientId: "public-client", name: "Streamer", accessToken: "access-old", refreshToken: "refresh-old", expiresAt: 0 });
const storage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from("encrypted:" + s), decryptString: (b) => b.toString().slice(10) };
function fixture(t, fetcher, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "assist-twitch-auth-"));
  const manager = new AuthManager({ file: path.join(directory, "accounts.enc"), storage, config: { twitchClientId: "public-client" }, fetcher, openBrowser: async () => {}, notify: () => {}, deviceSleep: async () => {}, ...options });
  t.after(() => {
    manager.cancel();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^assist-twitch-auth-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return manager;
}
test("Twitch device login respects polling and slow_down, validates identity, and exposes no credentials", async (t) => {
  let polls = 0, opened;
  const waits = [], bodies = [];
  const manager = fixture(t, async (url, options) => {
    if (url.endsWith("/device")) { bodies.push(new URLSearchParams(options.body)); return reply(device); }
    if (url.endsWith("/token")) {
      bodies.push(new URLSearchParams(options.body));
      polls++;
      return polls === 1 ? reply({ message: "authorization_pending" }, 400) : polls === 2 ? reply({ error: "slow_down" }, 400) : reply(tokens);
    }
    if (url.endsWith("/validate")) return reply(validation);
    return reply({ data: [{ id: "123", display_name: "Streamer" }] });
  }, { deviceSleep: async (ms) => waits.push(ms), openBrowser: async (url) => { opened = url; assert.equal(manager.snapshot().twitchDevice.userCode, "FAKE"); } });
  await manager.login("twitch");
  assert.match(opened, /^https:\/\/www\.twitch\.tv\/activate/);
  assert.deepEqual(waits, [1000, 1000, 6000]);
  assert.ok(bodies.every((body) => !body.has("client_secret")));
  assert.equal(bodies[0].get("scopes"), "user:read:chat");
  assert.equal(bodies.at(-1).get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
  assert.equal(manager.snapshot().pending, null);
  assert.equal(manager.snapshot().twitchDevice, null);
  assert.equal(manager.snapshot().accounts.twitch.name, "Streamer");
  for (const secret of ["access-new", "refresh-new", "private-device-code"]) assert.ok(!JSON.stringify(manager.snapshot()).includes(secret));
  const config = await manager.chatConfig();
  assert.equal(config.twitch, true);
  assert.equal(config.twitchUserId, "123");
  const restored = new CredentialVault(manager.vault.file, storage);
  restored.load();
  assert.equal(restored.accounts.twitch.refreshToken, "refresh-new");
});
test("Twitch device login rejects untrusted browser URLs before opening them", async () => {
  let opened = false;
  await assert.rejects(deviceLogin({ clientId: "public-client", openBrowser: async () => { opened = true; }, progress: () => {}, signal: new AbortController().signal, fetcher: async () => reply({ ...device, verification_uri: "https://example.com/activate" }) }), /로그인 정보/);
  assert.equal(opened, false);
});
test("canceling a pending Twitch login stops polling and cannot save an account", async (t) => {
  let reached;
  const sleeping = new Promise((r) => { reached = r; });
  const manager = fixture(t, async () => reply(device), { deviceSleep: (_ms, signal) => new Promise((_resolve, reject) => { reached(); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }) });
  const login = manager.login("twitch");
  await sleeping;
  manager.cancel();
  await assert.rejects(login, /취소/);
  assert.equal(manager.snapshot().pending, null);
  assert.equal(manager.snapshot().accounts.twitch.connected, false);
});
test("Twitch denial and expired device codes release the pending login", async (t) => {
  for (const reason of ["access_denied", "expired_token"]) {
    const manager = fixture(t, async (url) => reply(url.endsWith("/device") ? device : { message: reason }, url.endsWith("/device") ? 200 : 400));
    await assert.rejects(manager.login("twitch"), /취소|시간/);
    assert.equal(manager.snapshot().pending, null);
  }
});
test("Twitch startup token validation rejects wrong clients, users, or missing chat scopes", async () => {
  for (const data of [{ ...validation, client_id: "other" }, { ...validation, user_id: "456" }, { ...validation, scopes: [] }])
    await assert.rejects(validateTwitch("token", "public-client", "123", async () => reply(data)), /다시 연결/);
});
test("Twitch refresh rotates once for concurrent callers without a client secret", async (t) => {
  let refreshes = 0;
  const manager = fixture(t, async (url, options) => {
    if (url.endsWith("/validate")) return reply(validation);
    refreshes++;
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("refresh_token"), "refresh-old");
    assert.equal(body.has("client_secret"), false);
    await new Promise((r) => setTimeout(r, 10));
    return reply(tokens);
  });
  manager.saveAccount("twitch", account());
  assert.deepEqual(await Promise.all([manager.getAccess("twitch"), manager.getAccess("twitch")]), ["access-new", "access-new"]);
  assert.equal(refreshes, 1);
  assert.equal(manager.vault.accounts.twitch.refreshToken, "refresh-new");
});
test("a validation outage preserves the already rotated refresh token on disk", async (t) => {
  let refreshes = 0, validations = 0;
  const manager = fixture(t, async (url) => {
    if (url.endsWith("/validate")) return ++validations === 1 ? reply({}, 503) : reply(validation);
    refreshes++;
    return reply(tokens);
  });
  manager.saveAccount("twitch", account());
  await assert.rejects(manager.getAccess("twitch"), /503/);
  const restored = new CredentialVault(manager.vault.file, storage);
  restored.load();
  assert.equal(restored.accounts.twitch.refreshToken, "refresh-new");
  assert.equal(await manager.getAccess("twitch"), "access-new");
  assert.equal(refreshes, 1);
});
test("logout during Twitch refresh cannot resurrect a disconnected account", async (t) => {
  let complete, started;
  const inFlight = new Promise((r) => { started = r; });
  const manager = fixture(t, async () => { started(); await new Promise((r) => { complete = r; }); return reply(tokens); });
  manager.saveAccount("twitch", account());
  const refresh = manager.getAccess("twitch");
  await inFlight;
  await manager.logout("twitch");
  complete();
  await assert.rejects(refresh, /변경/);
  assert.equal(manager.snapshot().accounts.twitch.connected, false);
});
test("invalid Twitch refresh clears only Twitch and does not leak upstream details", async (t) => {
  const manager = fixture(t, async () => reply({ message: "Invalid refresh token access-old" }, 400));
  manager.saveAccount("twitch", account());
  manager.vault.accounts.youtube = { name: "YouTube", accessToken: "youtube" };
  await assert.rejects(manager.getAccess("twitch"), (error) => /다시 연결/.test(error.message) && !error.message.includes("access-old"));
  assert.equal(manager.snapshot().accounts.twitch.connected, false);
  assert.equal(manager.snapshot().accounts.youtube.connected, true);
});
test("Twitch fresh tokens are validated after restoring an account and again after 50 minutes", async (t) => {
  let calls = 0;
  const manager = fixture(t, async () => { calls++; return reply(validation); });
  manager.saveAccount("twitch", { ...account(), expiresAt: Date.now() + 14400000 });
  await manager.getAccess("twitch");
  await manager.getAccess("twitch");
  assert.equal(calls, 1);
  manager.twitchValidation.at -= 51 * 60 * 1000;
  await manager.getAccess("twitch");
  assert.equal(calls, 2);
});
test("missing Twitch client configuration prevents browser login", async (t) => {
  let opened = false;
  const manager = fixture(t, async () => assert.fail("must not fetch"), { config: { twitchClientId: "" }, openBrowser: async () => { opened = true; } });
  await assert.rejects(manager.login("twitch"), /개발자 등록/);
  assert.equal(opened, false);
});
