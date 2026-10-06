// Exercise real Electron IPC/UI and a local EventSub socket, without live accounts.
const { app, safeStorage } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { WebSocketServer } = require("ws");
const { CredentialVault } = require("../electron/oauth.cjs");
const { TwitchChat } = require("../electron/twitch.cjs");
const { assertLayout, waitFor, renderFixture } = require("./layout-check.cjs");
const profile = process.env.STREAMER_ASSIST_TEST_PROFILE || path.join(__dirname, "../release/twitch-profile-" + Date.now());
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, "preferences.json"), JSON.stringify({ autoRecord: false }));
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_TWITCH_CLIENT_ID = "desktop-public";
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F17";
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
const sockets = [];
let sequence = 0;
const event = (type, payload) => JSON.stringify({ metadata: { message_type: type, message_timestamp: new Date().toISOString() }, payload });
server.on("connection", (socket) => {
  sockets.push(socket);
  socket.send(event("session_welcome", { session: { id: "local-session", keepalive_timeout_seconds: 60 } }));
});
const originalOpen = TwitchChat.prototype.open;
TwitchChat.prototype.open = function (_url, ...args) {
  return originalOpen.call(this, `ws://127.0.0.1:${server.address().port}`, ...args);
};
global.fetch = async (url, options) => {
  const data = url === "https://id.twitch.tv/oauth2/validate"
    ? { client_id: "desktop-public", user_id: "123", login: "local-streamer", scopes: ["user:read:chat"], expires_in: 14400 }
    : url === "https://api.twitch.tv/helix/eventsub/subscriptions"
      ? { data: [{ ...JSON.parse(options.body), status: "enabled" }] }
      : url === "https://api.twitch.tv/helix/streams?user_id=123"
        ? { data: [{ user_id: "123", type: "live" }] }
      : assert.fail("Unexpected network request: " + new URL(url).origin);
  return { ok: true, status: 200, json: async () => data };
};
app.whenReady().then(() => {
  const vault = new CredentialVault(path.join(profile, "accounts.enc"), safeStorage);
  vault.accounts = { twitch: { userId: "123", clientId: "desktop-public", name: "로컬 테스트 방송", accessToken: "local-access", refreshToken: "local-refresh", expiresAt: Date.now() + 14400000 } };
  vault.save();
});
const deadline = setTimeout(() => { console.error("Twitch desktop smoke timed out"); app.exit(1); }, 45000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.on("browser-window-created", (_event, window) => window.webContents.once("did-finish-load", async () => {
  const js = (fn, ...args) => window.webContents.executeJavaScript("(" + fn.toString() + ")(" + args.map((v) => JSON.stringify(v)).join(",") + ")");
  const call = async (action, payload = {}) => {
    const result = await js((a, p) => window.assist.call(a, p), action, payload);
    assert.ok(result.ok, result.error);
    return result.data;
  };
  const state = () => js(async () => {
    let value;
    const off = window.assist.subscribe((s) => { value = s; });
    await window.assist.call("state"); off(); return value;
  });
  const tab = async (label) => {
    await js((label) => [...document.querySelectorAll("nav button")].find((b) => b.textContent.includes(label)).click(), label);
    await delay(450);
  };
  const send = (text, subscriber = true) => sockets.at(-1).send(event("notification", {
    subscription: { type: "channel.chat.message" },
    event: { broadcaster_user_id: "123", chatter_user_id: "456", chatter_user_name: "트위치 참여자", message_id: "local-" + (++sequence), message: { text }, badges: subscriber ? [{ set_id: "subscriber", id: "1" }] : [] },
  }));
  let stopFixture;
  try {
    window.webContents.setBackgroundThrottling(false);
    assert.equal((await state()).current, null, "fresh isolated profile: " + profile + " actual=" + app.getPath("userData"));
    await waitFor(async () => (await state()).connections.twitch === "연결됨", "initial Twitch connection");
    await waitFor(() => js(() => document.querySelectorAll(".platform-status").length === 1), "live Twitch icon appears");
    assert.equal(await js(() => document.querySelector(".platform-status").textContent.trim()), "");
    sockets.at(-1).send(event("notification", { subscription: { type: "stream.offline" }, event: { broadcaster_user_id: "123" } }));
    await waitFor(() => js(() => document.querySelectorAll(".platform-status").length === 0), "offline Twitch icon disappears");
    assert.equal((await state()).connections.twitch, "연결됨");
    sockets.at(-1).send(event("notification", { subscription: { type: "stream.online" }, event: { broadcaster_user_id: "123", type: "live" } }));
    await waitFor(() => js(() => document.querySelectorAll(".platform-status").length === 1), "stream online restores its icon");
    await call("start", { title: "트위치 테스트" });
    await waitFor(async () => (await state()).connections.twitch === "연결됨", "Twitch reconnect after recording start");
    await call("poll-start", { question: "다음 게임?", options: ["A", "B"], platforms: ["twitch"], chatPrefix: "!투표" });
    send("!투표1");
    await waitFor(async () => (await state()).poll.counts[0] === 1, "Twitch vote reaches real engine");
    await call("poll-stop");
    await call("raffle-start", { title: "구독자 추첨", platforms: ["twitch"], entryMode: "keyword", keyword: "!참여", subscribersOnly: true, excludeWinners: true });
    send("!참여", false); await delay(60);
    assert.equal((await state()).audience.raffle.candidateCount, 0);
    send("!참여");
    await waitFor(async () => (await state()).audience.raffle.candidateCount === 1, "subscriber recruitment");
    await call("raffle-stop");
    await tab("설정");
    await js(() => [...document.querySelectorAll(".settings-tabs button")].find((b) => b.textContent.includes("플랫폼 연결")).click());
    await delay(100);
    assert.equal(await js(() => document.querySelectorAll(".account-card").length), 3);
    await assertLayout(window, "three platform cards at default size");
    window.setSize(900, 650); await delay(150);
    await assertLayout(window, "three platform cards at minimum size");
    const snapshot = await state();
    const pending = { ...snapshot, auth: { ...snapshot.auth, pending: "twitch", twitchDevice: { userCode: "FAKE-CODE", expiresAt: Date.now() + 60000 } } };
    stopFixture = renderFixture(window, () => pending);
    await waitFor(() => js(() => document.querySelector(".twitch-account").textContent.includes("FAKE-CODE")), "device code is visible");
    await assertLayout(window, "pending Twitch login at minimum size");
    await js(() => document.querySelector(".theme-toggle").click()); await delay(100);
    await assertLayout(window, "pending Twitch login in light theme");
    if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") fs.writeFileSync(path.join(__dirname, "../release/twitch-platforms.png"), (await window.webContents.capturePage()).toPNG());
    stopFixture(); stopFixture = null;
    await call("state");
    await tab("도네 투표");
    assert.equal(await js(() => document.querySelectorAll(".donation-page [class*=audience-platform][aria-pressed]").length), 0);
    const rejected = await js(() => window.assist.call("donation-start", { platforms: ["twitch"], question: "Q", options: ["A", "B"], currency: "KRW", minimumMicros: 1000000, plural: true }));
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /지원하지/);
    await call("auth-logout", { platform: "twitch" });
    const final = await state();
    assert.equal(final.auth.accounts.twitch.connected, false);
    assert.equal(final.connections.twitch, "미연결");
    const vault = new CredentialVault(path.join(profile, "accounts.enc"), safeStorage); vault.load();
    assert.equal(vault.accounts.twitch, undefined);
    console.log("PASS: Twitch socket → IPC → vote/recruitment, three platform cards, device login UI, donation exclusion and logout.");
    clearTimeout(deadline); app.quit();
  } catch (error) {
    stopFixture?.(); console.error(error);
    console.error(await js(() => [...document.querySelectorAll("body *")].filter((element) => element.getClientRects().length && element.getBoundingClientRect().right > innerWidth + 1).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, text: element.textContent.slice(0, 80) })).slice(0, 15)));
    try { fs.writeFileSync(path.join(__dirname, "../release/twitch-smoke-failed.png"), (await window.webContents.capturePage()).toPNG()); } catch {}
    clearTimeout(deadline); app.exit(1);
  }
}));
app.on("before-quit", () => { for (const socket of sockets) socket.terminate(); server.close(); });
server.once("listening", () => require("../electron/main.cjs"));
