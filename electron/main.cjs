const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  clipboard,
  screen,
} = require("electron");
const { WorkspaceWindows } = require("./workspace-windows.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { Engine } = require("./engine.cjs");
const { RecordStore } = require("./record-store.cjs");
const { TimelineStore } = require("./timeline-store.cjs");
const { exportTimeline } = require("./timeline-export.cjs");
const {
  BroadcastReaders,
  BroadcastMonitor,
  recordingDecision,
} = require("./broadcast-monitor.cjs");
const { startupSettings } = require("./startup.cjs");
const { spinRoulette } = require("./roulette.cjs");
const { Platforms, pollAnnouncement } = require("./platforms.cjs");
const { AuthManager } = require("./oauth.cjs");
const { Preferences, shortcutLabel } = require("./preferences.cjs");
const { loadAppIcon } = require("./app-icon.cjs");
const platformInfo = require("./platform-info.json");
const { RuntimeActivity, StatePublisher } = require("./runtime-activity.cjs");
const { CaptureStore } = require("./capture-store.cjs");
const { ReplayManager } = require("./replay-manager.cjs");
const { IngressQueue } = require("./ingress-queue.cjs");
const aiObservers = new WeakSet();
// Draggable header regions trigger a native menu rather than a DOM contextmenu.
app.on("browser-window-created", (_event, win) => {
  win.on("system-context-menu", event => event.preventDefault());
  win.on("show", () => broadcast(true, win));
  win.on("restore", () => broadcast(true, win));
  win.webContents.on("did-start-loading", () => aiObservers.delete(win));
});
let window,
  workspace,
  tray,
  engine,
  platforms,
  auth,
  preferences,
  appIcon,
  captureTimer,
  captureWindow,
  quitting = false,
  demoTimer,
  activity,
  stateFile,
  records,
  timelineStore,
  aiRuntime,
  aiComponents,
  aiService,
  replay,
  monitor,
  savedRevision = -1,
  savedAt = 0,
  persistenceRetryAt = 0;
let notice = "",
  pollBusy = false,
  connectionRequest = 0;
let recordingStop = null;
let pollStop = null, pollEndRetryAt = 0;
const dev = !app.isPackaged && process.argv.includes("--dev");
const publisher = new StatePublisher({
  windows: () => workspace?.all() || (window ? [window] : []),
  build: createSnapshot,
  send: (target, snapshot) => target.webContents.send("assist:state", {
    ...snapshot, windowFrame: { maximized: target.isMaximized() },
    settings: { ...snapshot.settings, shortcutCapturing: preferences.capturing && captureWindow === target },
  }),
});
const defaultShortcut =
  (!app.isPackaged && process.env.STREAMER_ASSIST_SHORTCUT) ||
  (dev ? "CommandOrControl+Alt+F8" : "CommandOrControl+Shift+F8");
if (dev) {
  const profile = path.join(__dirname, "../.dev/profile");
  fs.mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
  process.on("message", (message) => {
    if (message?.type === "dev-shutdown") app.quit();
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    records = new RecordStore(app.getPath("userData"), safeStorage);
    stateFile = records.file;
    let saved = {};
    try {
      saved = records.load();
    } catch {
      notice =
        "저장 파일을 읽지 못했습니다. 원본을 백업하고 새 기록을 시작합니다.";
      records.backupCorrupt();
    }
    timelineStore = safeStorage.isEncryptionAvailable() ? new CaptureStore(path.join(app.getPath("userData"),"timeline-data"),safeStorage,{
      notify:broadcast,onCounts:counts=>{const session=[engine?.current,...(engine?.sessions||[])].find(s=>s?.id===counts.id);if(session){session.telemetry||={chats:0,donations:0,participants:0,viewerSamples:0};let changed=session.telemetry.participants!==counts.participants;session.telemetry.participants=counts.participants;if(session.endedAt){changed ||= session.telemetry.chats!==counts.chats||session.telemetry.donations!==counts.donations;session.telemetry.chats=counts.chats;session.telemetry.donations=counts.donations;}if(changed)engine.revision++;}}
    }) : new TimelineStore(path.join(app.getPath("userData"),"timeline-data"),safeStorage);
    await timelineStore.warm?.(saved.current);
    engine = new Engine(saved, { journal: timelineStore });
    if(timelineStore.key)replay=new ReplayManager({root:app.getPath("userData"),store:timelineStore,auth:null,engine,notify:()=>{persist(false);broadcast();}});
    // Save the installation's stable viewer-ID salt before any chat chunk can be flushed.
    if (records.available()) {
      records.save(engine.persisted());
      savedRevision = engine.revision;
    }
    const preferencesFile = path.join(
      app.getPath("userData"),
      "preferences.json",
    );
    const preferencesOptions = {
      file: preferencesFile,
      defaultShortcut,
      shortcuts: globalShortcut,
      onMark: () => mark(),
    };
    try {
      preferences = new Preferences(preferencesOptions);
    } catch {
      fs.copyFileSync(
        preferencesFile,
        preferencesFile + ".corrupt-" + Date.now(),
      );
      fs.unlinkSync(preferencesFile);
      preferences = new Preferences(preferencesOptions);
      notice = "설정 파일을 읽지 못해 기본 설정을 복원했습니다.";
    }
    auth = new AuthManager({
      file: path.join(app.getPath("userData"), "accounts.enc"),
      storage: safeStorage,
      openBrowser: (url) => shell.openExternal(url),
      notify: broadcast,
      dev,
      releaseConfigFile: app.isPackaged
        ? path.join(process.resourcesPath, "oauth-client.json")
        : null,
    });
    if(replay){replay.auth=auth;replay.providers.auth=auth;}
    const ingress=timelineStore.key?new IngressQueue({engine,store:timelineStore,notify:broadcast}):null;
    platforms = new Platforms(engine, broadcast, auth,{ingress,youtubeStreamFactory:options=>new(require("./youtube-stream.cjs").YouTubeStream)(options),commitPage:async()=>{await ingress?.drain();if(engine.current&&engine.current.chatCaptureMode!=="replay"){if(!(await timelineStore.flush(engine.current)))throw Error("채팅 저장 복구 중");engine.retryCapture();if(engine.captureRetries.size)throw Error("채팅 재수용 대기 중");}}});
    await ingress?.restore();
    platforms.setBroadcastReader(new BroadcastReaders(auth));
    monitor = new BroadcastMonitor({
      reader: { read: (channel, now) => platforms.readBroadcast(channel, now) },
      onUpdate: updateBroadcasts,
    });
    monitor.suppressed = new Map(saved.monitorSuppression || []);
    if (engine.current) notice = "이전 방송 기록을 복원했습니다.";
    appIcon = loadAppIcon(
      nativeImage,
      app.isPackaged ? process.resourcesPath : undefined,
    );
    window = new BrowserWindow({
      width: 1240,
      height: 850,
      minWidth: 900,
      minHeight: 650,
      frame: false,
      show:
        !process.argv.includes("--hidden") || !preferences.value.trayEnabled,
      backgroundColor: "#111214",
      title: dev ? "Streamer Assist · 개발 모드" : "Streamer Assist",
      icon: appIcon,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    Menu.setApplicationMenu(null);
    workspace = new WorkspaceWindows({
      main: window, BrowserWindow, screen, icon: appIcon, dev,
      hidden: process.argv.includes("--hidden") && preferences.value.trayEnabled,
      file: path.join(app.getPath("userData"), "workspace-layout.json"),
      broadcast: () => broadcast(true),
      onSettings: (target, payload) => target.webContents.send("assist:workspace-settings", payload),
      onBlur: target => cancelShortcutCapture(target),
      onMainChanged: target => { window = target; },
      onMainClose: closeMainWindow,
    });
    window.webContents.on("did-finish-load", () => { workspace.emit(); broadcast(true); });
    workspace.restore();
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("close", event => closeMainWindow(event, window));
    window.on("show", () => broadcast());
    window.on("maximize", () => broadcast());
    window.on("unmaximize", () => broadcast());
    window.on("blur", () => cancelShortcutCapture(window));
    window.webContents.on("did-start-loading", () => {
      cancelShortcutCapture(window);
      if (workspace.drag?.source === "main") workspace.finish(true);
    });
    updateTray();
    if (!preferences.register())
      notice =
        shortcutLabel(preferences.value.shortcut) +
        " 단축키 등록 실패. 설정에서 다른 조합을 지정하세요.";
    if (dev) {
      window.on("page-title-updated", (event) => event.preventDefault());
      window.webContents.on("before-input-event", (event, input) => {
        if (
          input.type === "keyDown" &&
          input.key === "F12" &&
          !input.control &&
          !input.alt &&
          !input.meta &&
          !preferences.capturing
        ) {
          event.preventDefault();
          window.webContents.toggleDevTools();
        }
      });
      window.webContents.once("did-finish-load", async () => {
        const renderer = await window.webContents.executeJavaScript(
          "new Promise(resolve => { const deadline = Date.now() + 10000; const check = () => { const value = { uiReady: !!document.querySelector('main:not([hidden])'), bridgeReady: typeof window.assist?.call === 'function' }; if (value.uiReady && value.bridgeReady || Date.now() >= deadline) resolve(value); else setTimeout(check, 40); }; check(); })",
        );
        if (process.connected) process.send({ type: "dev-ready", ...renderer });
        if (process.argv.includes("--devtools"))
          window.webContents.openDevTools({ mode: "detach" });
      });
      window.loadURL("http://127.0.0.1:5173");
    } else window.loadFile(path.join(__dirname, "../dist/index.html"));
    activity = new RuntimeActivity({
      read: () => ({
        recording: !!engine.current, dirty: savedRevision !== engine.revision,
        saveAt: Math.max(savedAt + 5000, persistenceRetryAt),
        deadlines: [
          engine.audience.raffle?.active ? engine.audience.raffle.endsAt : null,
          engine.audience.donationPoll?.active ? engine.audience.donationPoll.endsAt : null,
          engine.audience.reel ? engine.audience.raffle?.latestDraw?.endsAt : null,
          replay?.nextAt,
          engine.poll?.active && engine.poll.endsAt && !pollBusy && !recordingStop ? Math.max(engine.poll.endsAt, pollEndRetryAt) : null,
        ],
      }),
      run: (now, maintenance) => {
        engine.audience.expire(now);
        engine.audience.releaseRaffleReel(now);
        engine.retryCapture();
        engine.recent.expire(now);
        if(!historyBusy)replay?.tick(now);
        const poll = engine.poll;
        if (poll?.active && poll.endsAt && now >= poll.endsAt && now >= pollEndRetryAt && !pollBusy && !recordingStop)
          void finishPoll(true);
        broadcast();
        if (maintenance && engine.current) timelineStore.flush(engine.current);
        persist(false);
      },
    });
    activity.refresh();
    if (
      Object.values(auth.snapshot().accounts).some(
        (account) => account.connected,
      )
    )
      void syncChats().catch((error) => {
        notice = error.message;
        broadcast();
      });
  });
}
function aiTargets() {
  return (workspace?.all() || []).filter(target => aiObservers.has(target) && target.isVisible() && !target.isMinimized());
}
function ensureAiService() {
  if (aiService) return aiService;
  const { RuntimeManager } = require("./ai-runtime.cjs"), { ComponentManager } = require("./ai-components.cjs"), { CommonAiService } = require("./ai-service.cjs");
  aiComponents = new ComponentManager({ root: app.getPath("userData"), storage: safeStorage, notify: () => aiService?.emit?.() });
  aiRuntime = new RuntimeManager({ root: app.getPath("userData"), notify: () => aiService?.emit?.() });
  aiService = new CommonAiService({
    root: app.getPath("userData"), storage: safeStorage, runtime: aiRuntime, components: aiComponents, api: require("./ai-api.cjs"),
    isObserved: () => aiTargets().length > 0,
    notify: snapshot => { for (const target of aiTargets()) target.webContents.send("assist:ai-state", snapshot); },
    shellOpenExternal: url => shell.openExternal(url),
  });
  return aiService;
}
function currentLivePlatforms() {
  return Object.fromEntries(Object.keys(platformInfo).map(platform => [platform,
    platform === "twitch" && platforms.twitchChat?.current?.ready ? platforms.live.twitch : monitor?.status[platform]?.live === true,
  ]));
}
function broadcast(force = false, target) {
  activity?.refresh();
  publisher.request(force, target);
}
function createSnapshot() {
  const storageStatus=timelineStore?.status(engine.current);
  return {
      ...engine.snapshot(),
      appInfo: {
        version: require("../package.json").version,
        distribution: dev
          ? "development"
          : process.windowsStore === true
            ? "msix"
            : "nsis",
      },
      connections: platforms.status,
      monitoring: monitor?.snapshot(),
      recordStorage: {...storageStatus,pending:(storageStatus?.pending||0)+(platforms?.ingress?.pending||0),ingressPending:platforms?.ingress?.pending||0,ingressBytes:platforms?.ingress?.bytes||0,error:platforms?.ingress?.error||timelineStore?.failure||""},
      replay: replay?.snapshot(),
      livePlatforms: currentLivePlatforms(),
      demo: !!demoTimer,
      notice,
      shortcut: preferences.value.shortcut,
      settings: {
        ...preferences.snapshot(),
        ...startupSettings(app, process.windowsStore === true),
        recordsEncrypted: records.available(),
      },
      auth: auth.snapshot(),
    };
}
function closeMainWindow(event, target) {
  if(!quitting&&((preferences.value.trayEnabled&&tray&&!tray.isDestroyed())||workspace.all().length>1)){event.preventDefault();target.hide();}
  else if(!quitting)app.quit();
}
function showWindow() {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function updateTray() {
  if (!preferences.value.trayEnabled) {
    if (tray && !tray.isDestroyed()) tray.destroy();
    tray = null;
    if (!workspace.all().some(target => target.isVisible())) showWindow();
    return;
  }
  if (!tray || tray.isDestroyed()) {
    tray = new Tray(appIcon);
    tray.on("double-click", showWindow);
  }
  const label = shortcutLabel(preferences.value.shortcut);
  tray.setToolTip(
    (dev ? "Streamer Assist 개발 모드" : "Streamer Assist") +
      " · " +
      label +
      " 마커",
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Streamer Assist 열기", click: showWindow },
      { label: "하이라이트 마커 기록 (" + label + ")", click: () => mark() },
      { type: "separator" },
      { label: "완전히 종료", click: () => app.quit() },
    ]),
  );
}
function cancelShortcutCapture(target) {
  if (target && captureWindow && target !== captureWindow) return;
  clearTimeout(captureTimer);
  captureWindow = null;
  if (!preferences?.capturing || quitting) return;
  try {
    preferences.cancelCapture();
  } catch (error) {
    notice = error.message;
  }
  broadcast();
}
function persist(immediate = true) {
  if (!immediate && Date.now() < persistenceRetryAt) return;
  if (!immediate && Date.now() - savedAt < 5000) return;
  if (!engine || savedRevision === engine.revision) return;
  try {
    records.save({
      ...engine.persisted(),
      monitorSuppression: [...(monitor?.suppressed || [])],
    });
    savedRevision = engine.revision;
    savedAt = Date.now();
    persistenceRetryAt = 0;
  } catch {
    persistenceRetryAt = Date.now() + 5000;
    notice = "기록 저장 실패. 내보내기로 기록을 보관하세요.";
  }
}
function mark(label) {
  try {
    engine.mark(label);
    persist();
    broadcast();
  } catch (error) {
    notice = error.message;
    broadcast();
  }
}
function stopDemo() {
  clearInterval(demoTimer);
  demoTimer = null;
}
async function syncChats(liveInfos, force = false) {
  if (!demoTimer) monitor?.configure(auth.monitoringChannels());
  const requestId = ++connectionRequest;
  const channels = auth.monitoringChannels();
  const yt = liveInfos?.find(
    (info) => info.platform === "youtube" && info.live,
  );
  const twitch = channels.find((channel) => channel.platform === "twitch");
  const config = liveInfos
    ? {
        chzzkChannelId:
          channels.find((channel) => channel.platform === "chzzk")?.channelId ||
          "",
        youtube: !!yt?.liveChatId,
        liveChatId: yt?.liveChatId || "",
        youtubeStatus: "방송 대기",
        twitch: !!twitch,
        twitchUserId: twitch?.channelId || "",
        twitchStatus: "미연결",
      }
    : await auth.chatConfig((channel, now) => platforms.readBroadcast(channel, now, force ? 0 : 30000));
  if (requestId !== connectionRequest || quitting) return;
  if (config.youtube || config.chzzkChannelId || config.twitch)
    await (force ? platforms.connect(config) : platforms.ensureConnected(config));
  else platforms.disconnect();
  if (!config.youtube) platforms.status.youtube = config.youtubeStatus;
  if (!config.twitch) platforms.status.twitch = config.twitchStatus;
  broadcast();
}
async function finishPoll(automatic = false) {
  if (pollStop) return pollStop;
  if (pollBusy) throw new Error("투표 요청을 처리 중입니다.");
  const poll = engine.poll;
  if (!poll?.active) return;
  pollBusy = true;
  const operation = (async () => {
    try {
      await platforms.closePoll(poll);
      engine.endPoll(automatic ? poll.endsAt : Date.now());
      pollEndRetryAt = 0;
      if (automatic && notice.startsWith("투표 자동 종료에 실패")) notice = "";
    } catch (error) {
      if (!automatic) throw error;
      pollEndRetryAt = Date.now() + 5000;
      notice = "투표 자동 종료에 실패해 다시 시도합니다. " + error.message;
    }
    persist();
    broadcast();
  })();
  pollStop = operation;
  try { await operation; }
  finally { pollStop = null; pollBusy = false; activity?.refresh(); }
}
async function finishRecording(automatic = false) {
  if (recordingStop) return recordingStop;
  if (!engine.current) return;
  if (pollBusy) {
    if (automatic) return;
    throw new Error("투표 요청 처리 후 다시 시도하세요.");
  }
  const operation = (async () => {
    try {
      await platforms.closePoll(engine.poll);
    } catch (error) {
      if (!automatic) throw error;
    }
    if (!automatic) monitor?.suppressCurrent();
    await platforms.drain();
    engine.endPoll();
    engine.audience.stopRaffle();
    engine.audience.stopDonation();
    const completed=engine.current;
    if(!(await timelineStore.flush(completed)))throw Error(timelineStore.failure||"미저장 채팅을 복구한 뒤 방송 기록을 종료하세요.");
    engine.retryCapture(20000);
    if(engine.captureRetries.size||!(await timelineStore.flush(completed)))throw Error("미저장 채팅 복구를 기다리고 있습니다.");
    engine.stop();
    stopDemo();
    if (!automatic) platforms.disconnect();
    persist();
    replay?.afterStop(completed);
    broadcast();
  })();
  recordingStop = operation;
  try { return await operation; }
  finally { if (recordingStop === operation) recordingStop = null; activity?.refresh(); }
}
async function updateBroadcasts(infos, now) {
  if (quitting || demoTimer) return;
  const live = infos.filter((info) => info.live === true);
  const decision = recordingDecision(
    engine.current,
    infos,
    preferences.value.autoRecord,
    (info) => monitor.allow(info),
    now,
  );
  if (decision.action === "start") {
    engine.start(decision.title, 0, now, {
      automatic: true,
      startedAt: decision.startedAt,
      sources: [],
      chatCaptureMode: preferences.value.chatCaptureMode,
      replayAutoAnalyze: preferences.value.replayAutoAnalyze,
    });
    notice = "방송 시작을 감지해 자동으로 기록을 시작했습니다.";
  }
  if (engine.current) {
    engine.attachSources(live);
    engine.sampleViewers(infos, now);
    if (decision.action === "stop") {
      await finishRecording(true);
      notice = "모든 연결 방송이 종료되어 기록을 저장하고 자동 종료했습니다.";
    }
  }
  const youtube = infos.find((info) => info.platform === "youtube");
  if (
    youtube?.live &&
    youtube.liveChatId &&
    platforms.config?.liveChatId !== youtube.liveChatId
  ) {
    await syncChats(infos);
  }
  persist();
  broadcast();
}
function historySessions(id) {
  const sessions = [...(engine.current ? [engine.current] : []), ...engine.sessions];
  return id ? [findSession(id)] : sessions;
}
let historyBusy = false;
function syncHistoryMetadata() {
  if (!timelineStore.recovered.size) return;
  let changed = false;
  for (const [id, telemetry] of timelineStore.recovered) {
    const session = engine.sessions.find(s => s.id === id);
    if (session) { session.telemetry = telemetry; changed = true; }
  }
  timelineStore.recovered.clear();
  if (changed) { engine.revision++; persist(); broadcast(); }
}
function findSession(id) {
  const session = id
    ? engine.current?.id === id
      ? engine.current
      : engine.sessions.find((s) => s.id === id)
    : engine.current || engine.sessions[0];
  if (!session) throw new Error("조회할 방송 기록이 없습니다.");
  return session;
}
function checkConnectionChange() {
  if (demoTimer) throw new Error("테스트 채팅을 끈 후 계정을 연결하세요.");
  if (
    pollBusy ||
    ((engine.poll?.active ||
      engine.audience.raffle?.active ||
      engine.audience.donationPoll?.active) &&
      platforms.config)
  )
    throw new Error("투표 종료 후 연결을 변경하세요.");
}
ipcMain.handle("assist:window", (event, action) => {
  const target = workspace?.owner(event);
  if (!target) throw new Error("허용되지 않은 요청");
  switch (action) {
    case "minimize":
      target.minimize();
      break;
    case "toggle-maximize":
      target.isMaximized() ? target.unmaximize() : target.maximize();
      break;
    case "close":
      target.close();
      break;
    default:
      throw new Error("지원하지 않는 창 동작");
  }
  return { maximized: !target.isDestroyed() && target.isMaximized() };
});
ipcMain.handle("assist:workspace", async (event, action, payload) => {
  const target = workspace?.owner(event);
  if (!target) throw new Error("허용되지 않은 요청");
  try { return { ok: true, data: await workspace.handle(target, action, payload) }; }
  catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.on("assist:ai-subscription", (event, observed) => {
  const target = workspace?.owner(event); if (!target || typeof observed !== "boolean") return;
  if (observed) aiObservers.add(target); else aiObservers.delete(target);
});
ipcMain.handle("assist:call", async (event, action, payload = {}) => {
  const caller = workspace?.owner(event);
  if (!caller) throw new Error("허용되지 않은 요청");
  const isAiAction = action.startsWith("ai-");
  const readOnly = ["state", "replay-state", "replay-discover", "raffle-reel", "timeline-calendar", "timeline-history", "timeline-query", "timeline-analysis", "ai-state", "ai-model-options", "ai-preview", "ai-job-status", "ai-results-get", "ai-update-check", "ai-adapter-check"].includes(action);
  try {
    if (readOnly && action !== "raffle-reel" && historyBusy) throw new Error("선택한 기록을 정리 중입니다.");
    if (isAiAction) ensureAiService();
    if (!readOnly && !isAiAction && action !== "shortcut-cancel") notice = "";
    let data;
    switch (action) {
      case "roulette-spin":
        data = spinRoulette(payload.items);
        break;
      case "raffle-start": {
        const config = platforms.pollConfiguration(payload.platforms, {
          demo: !!demoTimer,
          accounts: auth.snapshot().accounts,
          livePlatforms: currentLivePlatforms(),
          youtubeMethod: "chat",
        });
        engine.audience.startRaffle({
          ...payload,
          platforms: config.platforms,
        });
        break;
      }
      case "raffle-stop":
        engine.audience.stopRaffle();
        break;
      case "raffle-draw":
        data = engine.audience.drawRaffle(payload.reducedMotion ?? false);
        break;
      case "raffle-reel":
        return { ok: true, data: engine.audience.getRaffleReel(payload.id) };
      case "raffle-copy": {
        const r = engine.audience.raffle;
        if (!r) throw new Error("참여자 모집을 먼저 시작하세요.");
        clipboard.writeText(
          "[시청자 추첨] " +
            r.title +
            " | " +
            (r.config.entryMode === "any"
              ? "채팅에 아무 말이나 입력하면 참여됩니다."
              : r.config.keyword + "를 메시지 앞에 입력하면 참여됩니다.") +
            " | 1인 1회 참여" +
            (r.config.subscribersOnly ? " · 구독자/멤버십 전용" : ""),
        );
        break;
      }
      case "donation-start": {
        const config = platforms.pollConfiguration(payload.platforms, {
          demo: !!demoTimer,
          accounts: auth.snapshot().accounts,
          livePlatforms: currentLivePlatforms(),
          youtubeMethod: "chat",
          feature: "donation",
        });
        engine.audience.startDonation({
          ...payload,
          platforms: config.platforms,
        });
        break;
      }
      case "donation-stop":
        engine.audience.stopDonation();
        break;
      case "donation-copy": {
        const p = engine.audience.donationPoll;
        if (!p) throw new Error("도네 투표를 먼저 시작하세요.");
        const price = (p.donation.minimumMicros / 1000000).toLocaleString(
          "ko-KR",
          { maximumFractionDigits: 6 },
        );
        clipboard.writeText(
          "[도네 투표] " +
            p.question +
            " | " +
            p.options
              .map((name, i) => (p.chatPrefix ?? "") + (i + 1) + ": " + name)
              .join(" / ") +
            " | 후원 메시지 앞에 선택 번호 입력 · " +
            price +
            " " +
            p.donation.currency +
            (p.donation.plural
              ? "당 1표 · 건별 내림 · 추가 후원은 누적"
              : " 이상 · 1인 1표 · 추가 후원 시 선택 변경"),
        );
        break;
      }
      case "state":
        broadcast(true, caller);
        return { ok: true };
      case "startup-settings":
        await shell.openExternal("ms-settings:startupapps");
        break;
      case "privacy-open":
        await shell.openExternal(
          "https://yechankun.github.io/streamer-assist/privacy.html",
        );
        break;
      case "support-open":
        await shell.openExternal(
          "https://github.com/yechankun/streamer-assist/issues",
        );
        break;
      case "history-clear": {
        if (historyBusy) throw new Error("선택한 기록을 정리 중입니다.");
        if(replay?.active)throw Error("다시보기 수집·분석을 중지한 뒤 기록을 삭제하세요.");
        if (payload.confirm !== true)
          throw new Error("기록 삭제 확인이 필요합니다.");
        if (
          engine.current ||
          engine.poll?.active ||
          engine.audience.raffle?.active ||
          engine.audience.donationPoll?.active ||
          engine.audience.raffle?.latestDraw?.endsAt > Date.now()
        )
          throw new Error("방송 기록·모집·투표·추첨을 종료한 뒤 삭제하세요.");
        historyBusy=true;try{
        aiService?.clearResults();
        await platforms.drain();await timelineStore.clear();
        monitor?.suppressCurrent();
        const cleared = new Engine({}, { journal: timelineStore });
        records.save(cleared.persisted());
        records.clearRecovery();
        engine = cleared;
        platforms.engine = cleared;
        if(platforms.ingress)platforms.ingress.engine=cleared;
        if(replay){replay.engine=cleared;replay.jobs.clear();replay.save();}
        savedRevision = cleared.revision;
        notice = "방송·참여·투표 기록을 삭제했습니다.";
        }finally{historyBusy=false;}
        break;
      }
      case "start":
        engine.start(payload.title, Number(payload.offset || 0),Date.now(),{chatCaptureMode:preferences.value.chatCaptureMode,replayAutoAnalyze:preferences.value.replayAutoAnalyze});
        if (
          Object.values(auth.snapshot().accounts).some(
            (account) => account.connected,
          )
        )
          void syncChats().catch((error) => {
            notice = error.message;
            broadcast();
          });
        break;
      case "mark":
        engine.mark(payload.label);
        break;
      case "stop":
        await finishRecording(false);
        break;
      case "chzzk-select":
        checkConnectionChange();
        await auth.selectChzzkChannel(payload.channel);
        await syncChats();
        break;
      case "auth-login":
        checkConnectionChange();
        await auth.login(payload.platform);
        window.show();
        window.focus();
        await syncChats(undefined, true);
        break;
      case "auth-cancel":
        auth.cancel();
        break;
      case "auth-logout":
        checkConnectionChange();
        if (
          engine.poll?.active ||
          engine.audience.raffle?.active ||
          engine.audience.donationPoll?.active
        )
          throw new Error(
            "투표와 참여자 모집을 종료한 뒤 계정 연결을 해제하세요.",
          );
        if (!Object.hasOwn(platformInfo, payload.platform))
          throw new Error("지원하지 않는 플랫폼입니다.");
        connectionRequest++;
        platforms.disconnect();
        await auth.logout(payload.platform);
        await syncChats();
        break;
      case "connect":
        checkConnectionChange();
        await syncChats(undefined, true);
        break;
      case "disconnect":
        if (
          pollBusy ||
          engine.poll?.active ||
          engine.audience.raffle?.active ||
          engine.audience.donationPoll?.active
        )
          throw new Error("투표와 참여자 모집을 종료한 뒤 연결을 해제하세요.");
        monitor?.stop();
        connectionRequest++;
        platforms.disconnect();
        break;
      case "demo":
        if (!engine.current) throw new Error("방송 기록을 먼저 시작하세요.");
        if (demoTimer) {
          stopDemo();
          break;
        }
        if (
          platforms.config ||
          engine.poll?.active ||
          engine.audience.raffle?.active ||
          engine.audience.donationPoll?.active
        )
          throw new Error("실제 연결과 투표·모집을 종료한 후 테스트하세요.");
        monitor?.stop();
        demoTimer = setInterval(() => {
          engine.sampleViewers([
            {
              platform: "demo",
              live: true,
              viewers: 120 + Math.round(30 * Math.sin(Date.now() / 10000)),
            },
          ]);
          for (let i = 0; i < 20; i++)
            engine.ingest({
              platform: "demo",
              name: "테스트 시청자 " + (i + 1),
              subscriber: i % 2 === 0,
              userId: "demo-" + i,
              text:
                i % 3 === 0
                  ? "ㅋㅋㅋㅋ 대박"
                  : (engine.poll?.chatPrefix ?? "!투표") + String((i % 4) + 1),
            });
          const raffle = engine.audience.raffle;
          if (raffle?.active && raffle.config.entryMode === "keyword")
            for (let i = 0; i < 8; i++)
              engine.ingest({
                platform: "demo",
                userId: "raffle-demo-" + i,
                name: "테스트 시청자 " + (i + 1),
                subscriber: i % 2 === 0,
                text: raffle.config.keyword,
              });
          const donation = engine.audience.donationPoll;
          if (donation?.active)
            for (let i = 0; i < donation.options.length; i++)
              engine.ingest({
                kind: "donation",
                platform: "demo",
                id: "demo-paid-" + Date.now() + ":" + i,
                userId: "donation-demo-" + i,
                name: "테스트 후원자 " + (i + 1),
                text: donation.chatPrefix + (i + 1),
                currency: donation.donation.currency,
                amountMicros: donation.donation.minimumMicros * (i + 1),
              });
          broadcast();
        }, 3000);
        break;
      case "poll-start": {
        if (pollBusy) throw new Error("투표 요청을 처리 중입니다.");
        const config = platforms.pollConfiguration(payload.platforms, {
          demo: !!demoTimer,
          accounts: auth.snapshot().accounts,
          livePlatforms: currentLivePlatforms(),
          youtubeMethod: payload.youtubeMethod,
        });
        const poll = engine.createPoll(
          payload.question,
          payload.options,
          config.mode,
          config.platforms,
          payload.chatPrefix,
          payload.timerSeconds,
        );
        pollBusy = true;
        pollEndRetryAt = 0;
        try {
          if (poll.mode === "native") await platforms.publishPoll(poll);
          if (poll.mode !== "demo")
            notice =
              poll.mode === "chat" ||
              poll.platforms.some((platform) => platform !== "youtube")
                ? "투표가 시작됐습니다. ‘투표 안내 복사’로 선택한 플랫폼의 채팅에 참여 명령을 알려주세요."
                : "YouTube 실시간 투표가 시작됐습니다.";
        } catch (error) {
          engine.endPoll();
          throw error;
        } finally {
          pollBusy = false;
        }
        break;
      }
      case "poll-copy":
        if (!engine.poll) throw new Error("투표를 먼저 만드세요.");
        clipboard.writeText(pollAnnouncement(engine.poll));
        notice = "투표 안내를 복사했습니다. 방송 채팅에 붙여 넣으세요.";
        break;
      case "poll-stop":
        await finishPoll();
        break;
      case "auto-record-set":
        preferences.setAutoRecord(payload.enabled);
        engine.revision++;
        if (payload.enabled) {
          monitor.suppressed.clear();
          monitor.configure(auth.monitoringChannels());
          void monitor.poll();
        }
        break;
      case "capture-mode-set":
        preferences.setCaptureMode(payload.mode,payload.autoAnalyze);engine.revision++;break;
      case "timeline-calendar":
        if (historyBusy) throw new Error("선택한 기록을 정리 중입니다.");
        data = await timelineStore.catalog(historySessions(payload.sessionId), engine.current?.id, payload.dates || []);
        break;
      case "replay-state": data=replay?.snapshot();break;
      case "replay-discover":if(!replay)throw Error("암호화 저장소를 사용할 수 없습니다.");data=await replay.discover(payload.sessionId);break;
      case "replay-start":
        if(historyBusy)throw Error("기록 정리가 끝난 뒤 수집하세요.");
        if(!replay)throw Error("암호화 저장소를 사용할 수 없습니다.");
        void replay.start(payload.sessionId,payload).catch(error=>{notice=error.message;broadcast();});data={started:true};break;
      case "replay-cancel": replay?.cancel(payload.sessionId);break;
      case "replay-analyze":
        if(historyBusy)throw Error("기록 정리가 끝난 뒤 분석하세요.");
        if(!replay)throw Error("암호화 저장소를 사용할 수 없습니다.");
        void replay.analyze(payload.sessionId).catch(error=>{notice=error.message;broadcast();});data={started:true};break;
      case "replay-tool-install":
        if(!replay)throw Error("암호화 저장소를 사용할 수 없습니다.");
        void replay.tools.ensure(payload.platform).catch(error=>{notice=error.message;broadcast();});data={started:true};break;
      case "replay-tool-remove":if(!replay)throw Error("수집 도구를 확인하세요.");replay.tools.remove(payload.platform);break;
      case "timeline-history":
        if (historyBusy) throw new Error("선택한 기록을 정리 중입니다.");
        data = await timelineStore.queryAll(historySessions(payload.sessionId), payload);
        break;
      case "timeline-delete-dates": {
        if(replay?.active)throw Error("다시보기 수집·분석을 중지한 뒤 기록을 삭제하세요.");
        if (historyBusy) throw new Error("선택한 기록을 정리 중입니다.");
        const sessions = historySessions(payload.sessionId);
        const preview = await timelineStore.catalog(sessions, engine.current?.id, payload.dates || []);
        if (!preview.selectedDates.length) throw new Error("삭제할 날짜를 선택하세요.");
        if (preview.days.some(d => preview.selectedDates.includes(d.date) && d.protected))
          throw new Error("기록 중인 방송의 날짜는 종료 후 삭제할 수 있습니다.");
        if (preview.token !== payload.token) throw new Error("기록이 변경되었습니다. 날짜와 용량을 다시 확인하세요.");
        historyBusy = true;
        try {
          const confirmation = await dialog.showMessageBox(caller, {
            type: "warning", title: "선택 날짜 기록 삭제",
            message: preview.selectedDates.length + "개 날짜의 모든 플랫폼 채팅·후원·시청자 기록을 삭제할까요?",
            detail: preview.selectedDates.join(", ") + "\n\n선택한 기록 파일: " + (preview.selectedBytes / 1048576).toFixed(2) + " MiB\n다른 날짜와 방송 마커는 유지됩니다. 삭제한 원문은 복구할 수 없습니다.",
            buttons: ["취소", "선택 기록 삭제"], defaultId: 0, cancelId: 0, noLink: true
          });
          if (confirmation.response !== 1) { data = { canceled: true }; break; }
          data = await timelineStore.deleteDates(sessions, preview.selectedDates, { currentId: engine.current?.id, token: preview.token });
          aiService?.deleteResultsForDates({ sessionIds: sessions.map(session => session.id), dates: preview.selectedDates });
          for (const update of data.updated) {
            const session = engine.sessions.find(s => s.id === update.id);
            if (session) session.telemetry = update.telemetry;
            timelineStore.recovered.delete(update.id);
          }
          engine.revision++;
          notice = preview.selectedDates.length + "개 날짜의 기록을 삭제했습니다. 원본 파일 " + (data.freedBytes / 1048576).toFixed(2) + " MiB를 확보했습니다.";
        } finally { historyBusy = false; }
        break;
      }
      case "timeline-query":
        data = await timelineStore.query(
          findSession(payload.sessionId),
          payload,
        );
        break;
      case "timeline-analysis":
        {const session=findSession(payload.sessionId);data=engine.current?.id===session.id&&session.chatCaptureMode!=="live"&&timelineStore.basicSummary?{...await timelineStore.basicSummary(session,payload),analysisDeferred:true}:await timelineStore.analyze(session,payload);}
        break;
      case "timeline-export": {
        const session = findSession(payload.sessionId);
        const result = await dialog.showSaveDialog(caller, {
          defaultPath: "stream-" + session.id.slice(0, 8) + ".analysis.jsonl",
          filters: [{ name: "AI 분석용 JSON Lines", extensions: ["jsonl"] }],
        });
        if (result.canceled || !result.filePath) break;
        await exportTimeline(
          timelineStore,
          session,
          result.filePath,
          payload.includeIdentity === true,
        );
        notice =
          "AI 분석용 기록을 저장했습니다. 채팅 본문은 원문이며 외부 AI 연결은 아직 수행하지 않습니다.";
        break;
      }
      case "export": {
        const session = payload.sessionId
          ? engine.sessions.find((s) => s.id === payload.sessionId)
          : engine.current || engine.sessions[0];
        if (!session) throw new Error("내보낼 방송 기록이 없습니다.");
        const json = payload.format === "json";
        const result = await dialog.showSaveDialog(caller, {
          defaultPath: `stream-${session.id.slice(0, 8)}.${json ? "json" : "md"}`,
          filters: [
            {
              name: json ? "JSON" : "Markdown",
              extensions: [json ? "json" : "md"],
            },
          ],
        });
        if (!result.canceled && result.filePath)
          fs.writeFileSync(
            result.filePath,
            json ? JSON.stringify(session, null, 2) : engine.summary(session),
            "utf8",
          );
        break;
      }
      case "shortcut-capture":
        if (!caller.isFocused())
          throw new Error("앱 창에서 단축키를 변경하세요.");
        if (captureWindow && captureWindow !== caller) cancelShortcutCapture();
        captureWindow = caller;
        preferences.beginCapture();
        clearTimeout(captureTimer);
        captureTimer = setTimeout(cancelShortcutCapture, 30000);
        break;
      case "shortcut-cancel":
        cancelShortcutCapture(caller);
        break;
      case "shortcut-set":
        if (preferences.capturing && captureWindow !== caller) throw new Error("단축키를 입력 중인 창에서 변경하세요.");
        clearTimeout(captureTimer);
        preferences.setShortcut(payload.shortcut);
        captureWindow = null;
        updateTray();
        break;
      case "tray-set":
        preferences.setTray(payload.enabled);
        updateTray();
        break;
      case "text-scale-set":
        preferences.setTextScale(payload.scale);
        break;
      case "login-startup":
        if (process.windowsStore === true)
          throw new Error(
            "MSIX 자동 시작은 Windows 시작 앱 설정에서 관리하세요.",
          );
        if (!app.isPackaged)
          throw new Error("Windows 자동 시작 설정은 설치 버전에서 사용하세요.");
        app.setLoginItemSettings({
          openAtLogin: !!payload.enabled,
          args: ["--hidden"],
        });
        break;
      default:
        if (isAiAction && aiService) {
          data = await aiService.handle(action, payload, {
            dialog, shell, timelineStore, sessions: historySessions,
            historyBusy, isHistoryBusy: () => historyBusy,
          });
          break;
        }
        throw new Error("알 수 없는 요청");
    }
    if (readOnly) syncHistoryMetadata();
    else if (isAiAction) broadcast();
    else { persist(); broadcast(true, caller); broadcast(); }
    return { ok: true, data };
  } catch (error) {
    if (!readOnly && !isAiAction) { notice = error.message; broadcast(); }
    return { ok: false, error: isAiAction ? aiService?.redact?.(error.message) || "AI 요청을 완료하지 못했습니다." : error.message };
  }
});
let quitDrain=null,quitFlushed=false;
app.on("before-quit", event => {
  if(quitFlushed)return;
  if(timelineStore?.shutdown){
    event.preventDefault();if(quitDrain)return;quitting=true;
    replay?.close();connectionRequest++;stopDemo();monitor?.stop();platforms?.disconnect();auth?.cancel();
    activity?.close();publisher.close();clearTimeout(captureTimer);
    quitDrain=(async()=>{
      await replay?.close();
      await platforms?.ingress?.close();
      if(engine.current){if(!(await timelineStore.flush(engine.current)))throw Error(timelineStore.failure);engine.retryCapture(20000);if(engine.captureRetries.size||!(await timelineStore.flush(engine.current)))throw Error("미저장 채팅 복구를 기다리고 있습니다.");}
      await timelineStore.shutdown();persist();workspace?.shutdown();aiService?.shutdown();quitFlushed=true;app.quit();
    })().catch(error=>{notice=error.message||"기록 저장 실패";quitting=false;quitDrain=null;publisher.closed=false;if(activity){activity.closed=false;activity.refresh();}if(workspace)workspace.quitting=false;showWindow();broadcast(true);});
    return;
  }
  quitting = true;
  try { workspace?.shutdown(); } catch (error) { console.error(error.message); }
  connectionRequest++;
  stopDemo();
  activity?.close();
  publisher.close();
  clearTimeout(captureTimer);
  monitor?.stop();
  if (engine?.current) timelineStore?.flush(engine.current);
  platforms?.disconnect();
  auth?.cancel();
  aiService?.shutdown();
  persist();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
