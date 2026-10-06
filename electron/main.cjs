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
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Engine } = require("./engine.cjs");
const { RecordStore } = require("./record-store.cjs");
const { startupSettings } = require("./startup.cjs");
const { spinRoulette } = require("./roulette.cjs");
const { Platforms, pollAnnouncement } = require("./platforms.cjs");
const { AuthManager } = require("./oauth.cjs");
const { Preferences, shortcutLabel } = require("./preferences.cjs");
const { loadAppIcon } = require("./app-icon.cjs");
let window,
  tray,
  engine,
  platforms,
  auth,
  preferences,
  appIcon,
  captureTimer,
  quitting = false,
  demoTimer,
  persistenceTimer,
  stateFile,
  records,
  savedRevision = -1;
let notice = "",
  pollBusy = false,
  connectionRequest = 0;
const dev = !app.isPackaged && process.argv.includes("--dev");
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
  app.whenReady().then(() => {
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
    engine = new Engine(saved);
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
    platforms = new Platforms(engine, broadcast, auth);
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
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("close", (event) => {
      if (
        !quitting &&
        preferences.value.trayEnabled &&
        tray &&
        !tray.isDestroyed()
      ) {
        event.preventDefault();
        window.hide();
      } else if (!quitting) app.quit();
    });
    window.on("show", () => broadcast());
    window.on("maximize", () => broadcast());
    window.on("unmaximize", () => broadcast());
    window.on("blur", cancelShortcutCapture);
    window.webContents.on("did-start-loading", cancelShortcutCapture);
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
          "({ uiReady: !!document.querySelector('main'), bridgeReady: typeof window.assist?.call === 'function' })",
        );
        if (process.connected) process.send({ type: "dev-ready", ...renderer });
        if (process.argv.includes("--devtools"))
          window.webContents.openDevTools({ mode: "detach" });
      });
      window.loadURL("http://127.0.0.1:5173");
    } else window.loadFile(path.join(__dirname, "../dist/index.html"));
    persistenceTimer = setInterval(() => {
      engine.audience.expire();
      broadcast();
      persist();
    }, 1000);
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
function broadcast() {
  if (window && !window.isDestroyed() && window.isVisible())
    window.webContents.send("assist:state", {
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
      demo: !!demoTimer,
      notice,
      shortcut: preferences.value.shortcut,
      settings: {
        ...preferences.snapshot(),
        ...startupSettings(app, process.windowsStore === true),
        recordsEncrypted: records.available(),
      },
      windowFrame: { maximized: window.isMaximized() },
      auth: auth.snapshot(),
    });
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
    if (!window.isVisible()) showWindow();
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
function cancelShortcutCapture() {
  clearTimeout(captureTimer);
  if (!preferences?.capturing || quitting) return;
  try {
    preferences.cancelCapture();
  } catch (error) {
    notice = error.message;
  }
  broadcast();
}
function persist() {
  if (!engine || savedRevision === engine.revision) return;
  try {
    records.save(engine.persisted());
    savedRevision = engine.revision;
  } catch {
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
async function syncChats() {
  const requestId = ++connectionRequest;
  const config = await auth.chatConfig();
  if (requestId !== connectionRequest || quitting) return;
  if (config.youtube || config.chzzkChannelId) await platforms.connect(config);
  else platforms.disconnect();
  if (!config.youtube) platforms.status.youtube = config.youtubeStatus;
  broadcast();
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
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("허용되지 않은 요청");
  switch (action) {
    case "minimize":
      window.minimize();
      break;
    case "toggle-maximize":
      window.isMaximized() ? window.unmaximize() : window.maximize();
      break;
    case "close":
      window.close();
      break;
    default:
      throw new Error("지원하지 않는 창 동작");
  }
  return { maximized: !window.isDestroyed() && window.isMaximized() };
});
ipcMain.handle("assist:call", async (event, action, payload = {}) => {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("허용되지 않은 요청");
  try {
    if (action !== "shortcut-cancel") notice = "";
    let data;
    switch (action) {
      case "roulette-spin":
        data = spinRoulette(payload.items);
        break;
      case "raffle-start": {
        const config = platforms.pollConfiguration(payload.platforms, {
          demo: !!demoTimer,
          accounts: auth.snapshot().accounts,
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
          youtubeMethod: "chat",
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
        break;
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
        const cleared = new Engine();
        records.save(cleared.persisted());
        records.clearRecovery();
        engine = cleared;
        platforms.engine = cleared;
        savedRevision = cleared.revision;
        notice = "방송·참여·투표 기록을 삭제했습니다.";
        break;
      }
      case "start":
        engine.start(payload.title, Number(payload.offset || 0));
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
        connectionRequest++;
        if (pollBusy) throw new Error("투표 요청 처리 후 다시 시도하세요.");
        await platforms.closePoll(engine.poll);
        engine.endPoll();
        engine.audience.stopRaffle();
        engine.audience.stopDonation();
        engine.stop();
        stopDemo();
        platforms.disconnect();
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
        await syncChats();
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
        if (!["chzzk", "youtube"].includes(payload.platform))
          throw new Error("지원하지 않는 플랫폼입니다.");
        connectionRequest++;
        platforms.disconnect();
        await auth.logout(payload.platform);
        await syncChats();
        break;
      case "connect":
        checkConnectionChange();
        await syncChats();
        break;
      case "disconnect":
        if (
          pollBusy ||
          engine.poll?.active ||
          engine.audience.raffle?.active ||
          engine.audience.donationPoll?.active
        )
          throw new Error("투표와 참여자 모집을 종료한 뒤 연결을 해제하세요.");
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
        demoTimer = setInterval(() => {
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
          youtubeMethod: payload.youtubeMethod,
        });
        const poll = engine.createPoll(
          payload.question,
          payload.options,
          config.mode,
          config.platforms,
          payload.chatPrefix,
        );
        pollBusy = true;
        try {
          if (poll.mode === "native") await platforms.publishPoll(poll);
          if (poll.mode !== "demo")
            notice =
              poll.mode === "chat" || poll.platforms.includes("chzzk")
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
        if (pollBusy) throw new Error("투표 요청을 처리 중입니다.");
        pollBusy = true;
        try {
          await platforms.closePoll(engine.poll);
          engine.endPoll();
        } finally {
          pollBusy = false;
        }
        break;
      case "export": {
        const session = payload.sessionId
          ? engine.sessions.find((s) => s.id === payload.sessionId)
          : engine.current || engine.sessions[0];
        if (!session) throw new Error("내보낼 방송 기록이 없습니다.");
        const json = payload.format === "json";
        const result = await dialog.showSaveDialog(window, {
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
        if (!window.isFocused())
          throw new Error("앱 창에서 단축키를 변경하세요.");
        preferences.beginCapture();
        clearTimeout(captureTimer);
        captureTimer = setTimeout(cancelShortcutCapture, 30000);
        break;
      case "shortcut-cancel":
        cancelShortcutCapture();
        break;
      case "shortcut-set":
        clearTimeout(captureTimer);
        preferences.setShortcut(payload.shortcut);
        updateTray();
        break;
      case "tray-set":
        preferences.setTray(payload.enabled);
        updateTray();
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
        throw new Error("알 수 없는 요청");
    }
    persist();
    broadcast();
    return { ok: true, data };
  } catch (error) {
    notice = error.message;
    broadcast();
    return { ok: false, error: error.message };
  }
});
app.on("before-quit", () => {
  quitting = true;
  connectionRequest++;
  stopDemo();
  clearInterval(persistenceTimer);
  clearTimeout(captureTimer);
  platforms?.disconnect();
  auth?.cancel();
  persist();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
