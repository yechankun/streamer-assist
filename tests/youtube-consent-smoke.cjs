// Real UI/IPC and encrypted local stores, with a fake account and offline Google.
const { app, safeStorage, dialog } = require("electron");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { CredentialVault } = require("../electron/oauth.cjs");
const { RecordStore } = require("../electron/record-store.cjs");
const { TimelineStore } = require("../electron/timeline-store.cjs");
const { Engine } = require("../electron/engine.cjs");
const { assertLayout, waitFor, settleUI } = require("./layout-check.cjs");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const profile = process.env.STREAMER_ASSIST_TEST_PROFILE;
assert.ok(profile, "Use the desktop runner's isolated profile");
app.setPath("userData", profile); fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, "preferences.json"), JSON.stringify({ autoRecord: false }));
process.env.STREAMER_ASSIST_GOOGLE_CLIENT_ID = "mock-client";
process.env.STREAMER_ASSIST_GOOGLE_CLIENT_SECRET = "mock-desktop-config";
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F15";
let confirmation = 0, revokeCalls = 0, networkCalls = 0, offline = true, prompts = 0, sessionId, oldSessionId;
dialog.showMessageBox = async (_window, options) => {
  prompts++; assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
  assert.ok(options.detail.includes("되돌릴 수 없습니다")); return { response: confirmation };
};
global.fetch = async (url, options) => {
  networkCalls++;
  if (url === "https://oauth2.googleapis.com/token") return { ok: true, status: 200, json: async () => ({ access_token: "mock-access", expires_in: 3600 }) };
  if (url === "https://oauth2.googleapis.com/revoke") {
    revokeCalls++; assert.equal(new URLSearchParams(options.body).get("token"), "mock-refresh");
    if (offline) throw Error("Offline fixture"); return { ok: true, status: 200 };
  }
  assert.equal(new URL(url).hostname, "www.googleapis.com");
  return { ok: true, status: 200, json: async () => ({ items: url.includes("/channels?") ? [{ id: "mock-channel", snippet: { title: "YouTube 테스트 계정" } }] : [] }) };
};
app.whenReady().then(() => {
  const vault = new CredentialVault(path.join(profile, "accounts.enc"), safeStorage);
  vault.accounts = { youtube: { accessToken: "mock-access", refreshToken: "mock-refresh", expiresAt: Date.now() + 3600000,
    name: "YouTube 테스트 계정", channelId: "mock-channel", paused: false } }; vault.save();
  const store = new TimelineStore(path.join(profile, "timeline-data"), safeStorage);
  const engine = new Engine({}, { journal: store });
  const old = Date.now() - 31 * 86400000;
  engine.start("오래된 혼합 방송", 0, old); oldSessionId = engine.current.id;
  for (const platform of ["youtube", "twitch"]) engine.ingest({ platform, id: "old-" + platform, userId: "old-" + platform, name: "old " + platform, text: "old private " + platform, timestamp: old + 1000 }, old + 1000);
  engine.mark("오래된 수동 메모", "manual", null, old + 2000); store.flush(engine.current); engine.stop(old + 10000);
  engine.start("수동 작성 방송 제목");
  sessionId = engine.current.id;
  engine.attachSources([{ key: "youtube:channel", platform: "youtube", channelId: "mock-channel", live: true, title: "API title" }]);
  for (const platform of ["youtube", "twitch"])
    engine.ingest({ platform, id: platform, userId: platform, name: platform + " PRIVATE name", text: platform + " PRIVATE text", timestamp: Date.now() });
  engine.mark("보존할 수동 메모"); store.flush(engine.current); engine.stop();
  const records = new RecordStore(profile, safeStorage); records.save(engine.persisted());
  fs.copyFileSync(records.file, records.file + ".corrupt-1");
});
const deadline = setTimeout(() => { console.error("YouTube consent smoke timed out"); app.exit(1); }, 45000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on("browser-window-created", (_event, window) => window.webContents.once("did-finish-load", async () => {
  const js = (fn, ...args) => window.webContents.executeJavaScript("(" + fn.toString() + ")(" + args.map(value => JSON.stringify(value)).join(",") + ")");
  const request = (action, payload = {}) => js((a, p) => window.assist.call(a, p), action, payload);
  const call = async (action, payload) => { const result = await request(action, payload); assert.ok(result.ok, result.error); return result.data; };
  const state = () => js(async () => { let value; const off = window.assist.subscribe(s => { value = s; }); await window.assist.call("state"); off(); return value; });
  try {
    window.webContents.setBackgroundThrottling(false);
    await waitFor(() => js(() => !!document.querySelector("nav")), "main renderer");
    await js(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("설정")).click());
    await delay(150);
    await js(() => [...document.querySelectorAll(".settings-tabs button")].find(button => button.textContent.includes("플랫폼 연결")).click());
    await delay(150); window.setSize(900, 650); await delay(100);
    await assertLayout(window, "YouTube pause/revoke controls at minimum size");
    assert.ok(await js(() => document.querySelector(".youtube-account").textContent.includes("연결 재개")));
    assert.equal(networkCalls, 0, "no Google request before policy acceptance");
    const rejected = await request("auth-youtube-pause", { paused: false }); assert.equal(rejected.ok, false); assert.match(rejected.error, /동의/);
    await js(() => [...document.querySelectorAll(".youtube-account button")].find(button => button.textContent.includes("연결 재개")).click());
    await waitFor(() => js(() => document.querySelector(".youtube-consent-dialog")?.open), "policy consent opens before resume");
    await waitFor(() => js(() => document.querySelector(".youtube-retention-preview strong")?.textContent.includes("1개 방송")), "expired YouTube scope is shown");
    assert.equal(await js(() => document.querySelector(".youtube-consent-actions .primary").disabled), true);
    assert.equal(new RecordStore(profile, safeStorage).load().sessions.find(session => session.id === oldSessionId).telemetry.chats, 2);
    await call("state"); await assertLayout(window, "YouTube consent dialog at minimum size");
    await js(() => document.querySelector(".youtube-consent-actions .secondary").click()); await delay(100);
    assert.equal(networkCalls, 0, "cancel does not open OAuth or refresh credentials");
    await js(() => [...document.querySelectorAll(".youtube-account button")].find(button => button.textContent.includes("연결 재개")).click());
    await waitFor(() => js(() => !!document.querySelector(".youtube-retention-preview strong")), "retention review reloads");
    await js(() => document.querySelectorAll(".youtube-consent-checks input").forEach(input => input.click()));
    await waitFor(() => js(() => !document.querySelector(".youtube-consent-actions .primary").disabled), "explicit acceptance enables resume");
    await js(() => document.querySelector(".youtube-consent-actions .primary").click());
    await waitFor(async () => (await state()).auth.accounts.youtube.paused === false, "consent and migration finish before resume");
    assert.equal((await state()).auth.accounts.youtube.paused, false);
    const migrated = new RecordStore(profile, safeStorage).load().sessions.find(session => session.id === oldSessionId);
    assert.equal(migrated.telemetry.chats, 1); assert.equal(migrated.markers[0].label, "오래된 수동 메모");
    await call("auth-youtube-pause", { paused: true });
    assert.equal((await state()).auth.accounts.youtube.paused, true);
    assert.equal(revokeCalls, 0);
    assert.equal((await call("auth-youtube-revoke")).canceled, true);
    assert.equal((await state()).auth.accounts.youtube.connected, true);
    assert.equal(revokeCalls, 0);
    confirmation = 1;
    const failed = await request("auth-youtube-revoke"); assert.equal(failed.ok, false); assert.match(failed.error, /데이터는 삭제/);
    const pending = (await state()).auth.accounts.youtube;
    assert.equal(pending.connected, false); assert.equal(pending.removalPending, true); assert.equal(pending.localDataDeleted, true);
    const disk = new RecordStore(profile, safeStorage).load();
    assert.equal(disk.sessions[0].telemetry.chats, 1);
    assert.equal(disk.sessions[0].markers[0].label, "보존할 수동 메모");
    assert.equal(disk.sessions[0].sources.length, 0);
    const store = new TimelineStore(path.join(profile, "timeline-data"), safeStorage);
    // SAT3 chunks are read through the app's real IPC, not this legacy codec.
    assert.ok(fs.existsSync(store.folder(sessionId)));
    await waitFor(() => js(() => document.querySelector(".youtube-account").textContent.includes("철회·삭제 재시도")), "pending retry control");
    offline = false; await call("auth-youtube-revoke");
    assert.equal(prompts, 2, "retry does not ask for destructive confirmation again");
    assert.equal(revokeCalls, 2);
    assert.equal((await state()).auth.accounts.youtube.removalPending, false);
    await waitFor(() => js(() => document.querySelector(".youtube-account .tag").textContent === "계정 미연결"), "renderer shows completed revocation");
    await call("text-scale-set", { scale: 150 }); await delay(150);
    await settleUI(window);
    await assertLayout(window, "YouTube consent settings at 150 percent text");
    if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") fs.writeFileSync(path.join(__dirname, "../release/youtube-consent-settings.png"), (await window.webContents.capturePage()).toPNG());
    clearTimeout(deadline); console.log("PASS: explicit versioned consent, no pre-consent Google access, reviewed legacy retention, pause/resume, revoke/cancel, offline deletion, retry, preserved other-platform originals/manual markers, minimum size and text scaling");
    app.quit();
  } catch (error) { clearTimeout(deadline); console.error(error); app.exit(1); }
}));
require("../electron/main.cjs");
