// Exercise shared app-level collection across multiple real renderer instances.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { waitFor, settleUI } = require("./layout-check.cjs");
const profile = process.env.STREAMER_ASSIST_TEST_PROFILE || path.join(__dirname, "../release/collection-profile-" + Date.now());
fs.mkdirSync(profile, { recursive: true }); app.setPath("userData", profile);
fs.writeFileSync(path.join(profile, "preferences.json"), JSON.stringify({ autoRecord: false }));
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F16";
const platformsModule = require("../electron/platforms.cjs"), monitorModule = require("../electron/broadcast-monitor.cjs");
const { AuthManager } = require("../electron/oauth.cjs");
const counts = { platforms: 0, monitors: 0, connects: 0, chatRequests: 0, broadcastRequests: 0, pollCloses: 0 };
let platforms, monitor, main, youtubeError = "";
const channel = { platform: "youtube", channelId: "shared-channel", name: "공통 수집 채널" };
const snapshot = AuthManager.prototype.snapshot;
AuthManager.prototype.snapshot = function () { const state = snapshot.call(this); state.accounts.youtube = { configured: true, connected: true, name: channel.name }; return state; };
AuthManager.prototype.monitoringChannels = () => [channel];
AuthManager.prototype.chatConfig = async () => ({ youtube: true, liveChatId: "shared-chat", chzzkChannelId: "", twitch: false, twitchStatus: "미연결" });
monitorModule.BroadcastReaders.prototype.read = async function () { counts.broadcastRequests++; if (youtubeError) throw new Error(youtubeError); return { ...channel, live: true, broadcastId: "shared-live", title: "공통 방송", viewers: 42, startedAt: Date.now() - 1000, observedAt: Date.now() }; };
const OriginalPlatforms = platformsModule.Platforms;
platformsModule.Platforms = class extends OriginalPlatforms {
  constructor(...args) { super(...args); this.youtubeStreamFactory=undefined; counts.platforms++; platforms = this; }
  async connect(...args) { counts.connects++; return super.connect(...args); }
  async api(_platform, url) {
    assert.ok(url.includes("/liveChat/messages"), "collection fixture allows only its local simulated chat request");
    counts.chatRequests++;
    return { pollingIntervalMillis: counts.chatRequests === 1 ? 1000 : 60000, nextPageToken: "next",
      items: this.engine.current ? [{ id: "shared-message", authorDetails: { channelId: "viewer-1", displayName: "공유 시청자" }, snippet: { type: "textMessageEvent", publishedAt: new Date().toISOString(), textMessageDetails: { messageText: "모든 탭에서 보는 채팅" } } }] : [] };
  }
};
const OriginalMonitor = monitorModule.BroadcastMonitor;
monitorModule.BroadcastMonitor = class extends OriginalMonitor { constructor(options) { super({ ...options, interval: 60000 }); counts.monitors++; monitor = this; } };
const run = (win, fn, ...args) => win.webContents.executeJavaScript("(" + fn.toString() + ")(" + args.map(value => JSON.stringify(value)).join(",") + ")");
const call = (win, action, payload = {}) => run(win, (action, payload) => window.assist.call(action, payload), action, payload);
async function workspace(win, action, payload = {}) { const result = await run(win, (action, payload) => window.assist.workspace(action, payload), action, payload); assert.ok(result.ok, result.error); return result.data; }
const shared = win => run(win, () => new Promise(resolve => { const off = window.assist.subscribe(state => { off(); resolve(state); }); void window.assist.call("state"); }));
const timeout = setTimeout(() => { console.error("Shared collection timed out"); app.exit(1); }, 30000);
app.on("browser-window-created", (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  if (main) return; main = win;
  win.webContents.once("did-finish-load", async () => {
    try {
      await waitFor(() => run(main, () => !!document.querySelector('[data-workspace-ready="true"]')), "shared shell ready");
      await waitFor(() => platforms?.status.youtube === "연결됨" && monitor?.status.youtube?.live, "single initial platform collector");
      const baseline = { connects: counts.connects, chats: counts.chatRequests, broadcasts: counts.broadcastRequests };
      await workspace(main, "open", { id: "timeline" });
      const copy = await workspace(main, "new-tab", { id: "timeline" });
      const separate = await workspace(main, "new-window", { id: "timeline" });
      await waitFor(() => BrowserWindow.getAllWindows().length === 2, "timeline second window");
      const child = BrowserWindow.getAllWindows().find(win => win !== main);
      await waitFor(() => run(child, () => !!document.querySelector('[data-workspace-ready="true"] main:not([hidden])')), "second timeline ready");
      assert.equal(counts.platforms, 1); assert.equal(counts.monitors, 1);
      assert.equal(Object.keys(platforms.workers).length, 3);
      assert.equal(counts.connects, baseline.connects, "new tabs/windows do not create collection connections");
      assert.equal(counts.broadcastRequests, baseline.broadcasts, "new renderers do not poll platforms");
      const starts = await Promise.all([call(main, "start", { title: "공유 기록" }), call(child, "start", { title: "중복 시작" })]);
      assert.equal(starts.filter(result => result.ok).length, 1, "one recording session across concurrent views");
      await waitFor(() => platforms.engine.current?.telemetry.chats === 1, "single chat poll writes one shared record");
      assert.equal(counts.connects, baseline.connects, "recording start reuses the existing collector");
      await monitor.poll();
      const marked = await call(child, "mark", { label: "보조 창의 공유 마커" }); assert.ok(marked.ok, marked.error);
      const first = await shared(main), second = await shared(child);
      assert.deepEqual(second.current, first.current); assert.equal(first.current.telemetry.chats, 1);
      assert.equal(first.current.telemetry.viewerSamples, 1); assert.equal(first.current.markers.length, 1);
      const histories = await Promise.all([call(main, "timeline-history", { limit: 10 }), call(child, "timeline-history", { limit: 10 })]);
      assert.ok(histories.every(result => result.ok)); assert.deepEqual(histories[0].data.events, histories[1].data.events);
      assert.equal(histories[0].data.events.filter(event => event.type === "chat").length, 1);
      const sessionId = first.current.id;
      await workspace(main, "close-tab", { id: "timeline" }); await workspace(main, "close-tab", { id: copy.id }); await workspace(child, "close-tab", { id: separate.id });
      assert.equal(platforms.engine.current.id, sessionId, "closing all timeline views leaves common recording alive");
      assert.equal(platforms.status.youtube, "연결됨"); assert.equal(counts.connects, baseline.connects);
      const reopened = await workspace(child, "open", { id: "timeline" }); await settleUI(child);
      assert.equal((await shared(child)).current.id, sessionId);
      assert.ok(await run(child, id => !!document.querySelector('[data-workspace-instance="' + id + '"] .telemetry-session'), reopened.id));
      youtubeError = "YouTube 방송 조회 권한이 없습니다. 방송 채널 계정을 다시 연결하세요.";
      await monitor.poll();
      await workspace(child, "open", { id: "settings", section: "platforms" });
      await waitFor(() => run(child, expected => document.querySelector('.youtube-account .account-status')?.title === expected, youtubeError), "YouTube monitor error reaches connection settings");
      assert.equal((await shared(main)).monitoring.platforms.youtube.live, null);
      assert.ok(await run(child, () => document.querySelector('.youtube-account .account-status')?.textContent.includes("방송 확인")));
      assert.equal(platforms.engine.current.id, sessionId, "query failure preserves shared recording");
      youtubeError = "";
      await monitor.poll();
      await waitFor(() => run(child, () => document.querySelector('.youtube-account .account-status')?.title === "연결됨"), "recovered YouTube query clears the error");
      assert.equal(counts.connects, baseline.connects, "YouTube query recovery reuses the existing chat connection");
      let timerCloses = 0, releaseTimer;
      platforms.publishPoll = async poll => { poll.youtubeId = "shared-native-timer"; };
      platforms.closePoll = async poll => {
        timerCloses++;
        await new Promise(resolve => { releaseTimer = resolve; });
        platforms.engine.updateYoutubePoll({ id: poll.youtubeId, snippet: { pollDetails: { metadata: { status: "closed", options: [{ tally: "3" }, { tally: "1" }] } } } });
      };
      const timerPoll = await call(main, "poll-start", { question: "공유 타이머", options: ["A", "B"], platforms: ["youtube"], youtubeMethod: "native", timerSeconds: 1 });
      assert.ok(timerPoll.ok, timerPoll.error);
      const endAt = platforms.engine.poll.endsAt;
      await workspace(main, "open", { id: "poll" });
      await workspace(main, "close-tab", { id: "poll" });
      await waitFor(() => timerCloses === 1, "closed number poll view still ends its native platform poll");
      const manualStops = [call(main, "poll-stop"), call(child, "poll-stop")];
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(timerCloses, 1, "manual and automatic stops share one platform operation");
      releaseTimer(); assert.ok((await Promise.all(manualStops)).every(result => result.ok));
      const endedPoll = (await shared(child)).poll;
      assert.equal(endedPoll.active, false); assert.equal(endedPoll.closedAt, endAt);
      assert.deepEqual(endedPoll.youtubeCounts, [3, 1]);
      assert.equal(platforms.engine.current.polls.filter(p => p.id === endedPoll.id).length, 1);
      let retries = 0;
      platforms.closePoll = async () => { if (++retries === 1) throw new Error("temporary platform outage"); };
      assert.ok((await call(main, "poll-start", { question: "자동 종료 재시도", options: ["A", "B"], platforms: ["youtube"], youtubeMethod: "native", timerSeconds: 1 })).ok);
      await waitFor(() => retries === 1, "failed native close is reported");
      assert.match((await shared(main)).notice, /자동 종료에 실패/);
      await waitFor(() => !platforms.engine.poll.active, "native timer automatically retries a failed close", 8000);
      assert.equal(retries, 2); assert.equal((await shared(child)).notice, "");
      let release;
      platforms.closePoll = async () => { counts.pollCloses++; await new Promise(resolve => { release = resolve; }); };
      const stopping = [call(main, "stop"), call(child, "stop")];
      await waitFor(() => counts.pollCloses === 1, "single common stop operation");
      await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(counts.pollCloses, 1);
      release(); assert.ok((await Promise.all(stopping)).every(result => result.ok));
      const stopped = await shared(main); assert.equal(stopped.current, null); assert.equal(stopped.sessions.length, 1);
      assert.equal((await shared(child)).sessions[0].id, stopped.sessions[0].id);
      clearTimeout(timeout);
      console.log("PASS: one worker per platform across multiple timeline tabs/windows, no view-triggered network, reused chat connection, shared chat/viewers/markers/history and single start/stop");
      app.quit();
    } catch (error) { clearTimeout(timeout); console.error(error); console.error(counts); app.exit(1); }
  });
});
require("../electron/main.cjs");
