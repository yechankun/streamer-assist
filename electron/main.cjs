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
const { Platforms, pollAnnouncement } = require("./platforms.cjs");
const { AuthManager } = require("./oauth.cjs");
let window,
  tray,
  engine,
  platforms,
  auth,
  quitting = false,
  demoTimer,
  persistenceTimer,
  stateFile,
  savedRevision = -1;
let notice = "",
  pollBusy = false,
  connectionRequest = 0;
const dev = !app.isPackaged && process.argv.includes("--dev");
const shortcut =
  (!app.isPackaged && process.env.STREAMER_ASSIST_SHORTCUT) ||
  (dev ? "CommandOrControl+Alt+F8" : "CommandOrControl+Shift+F8");
const shortcutLabel = shortcut.replace("CommandOrControl", "Ctrl");
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
    stateFile = path.join(app.getPath("userData"), "sessions.json");
    let saved = {};
    try {
      if (fs.existsSync(stateFile))
        saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      notice =
        "저장 파일을 읽지 못했습니다. 원본을 백업하고 새 기록을 시작합니다.";
      if (fs.existsSync(stateFile))
        fs.copyFileSync(stateFile, `${stateFile}.corrupt-${Date.now()}`);
    }
    engine = new Engine(saved);
    auth = new AuthManager({
      file: path.join(app.getPath("userData"), "accounts.enc"),
      storage: safeStorage,
      openBrowser: (url) => shell.openExternal(url),
      notify: broadcast,
      dev,
    });
    platforms = new Platforms(engine, broadcast, auth);
    if (engine.current) notice = "이전 방송 기록을 복원했습니다.";
    const icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABFklEQVQ4T6WTsQ3CMBRE/5sFGIERaAEaCigQBSOkgAJGYAQWoAEzMAIrkLJhAyMwAh0AAXm2YidO4hSiqOQ8v//+9nORUrYAZwCLJLJF8gygthFwBG6SCG5rW1UOlgJcgCsStUEKGALHgEuSf1fSaYAc0OSdScBVOUACTlXrAuBO8n4QWAOsKrYKJLuSbhtyCY7ABXAkuRmIAK7AFkAeJFWJ3UVyI/kAeGadQIhnAWzJ9wEp3Za8ByAMUqOAeZDkcBLIk14sShMAM/Mc4AE86/uAdTEqZ3kBzJLsFuHuIKzQSFrCdfyfgOwTyTVAiTcRKxXGtBlZU4EyToDh7LtJcy3VWlvAJ2HHXaMPNNZmaIEPZvZdczKvZDnvAZ10EEflJk+YAAAAAElFTkSuQmCC",
    );
    window = new BrowserWindow({
      width: 1240,
      height: 850,
      minWidth: 900,
      minHeight: 650,
      show: !process.argv.includes("--hidden"),
      backgroundColor: "#10131b",
      title: dev ? "Streamer Assist · 개발 모드" : "Streamer Assist",
      icon,
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
      if (!quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    window.on("show", () => broadcast());
    tray = new Tray(icon);
    tray.setToolTip(
      `${dev ? "Streamer Assist 개발 모드" : "Streamer Assist"} · ${shortcutLabel} 마커`,
    );
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Streamer Assist 열기", click: () => window.show() },
        { label: "하이라이트 마커 기록", click: () => mark() },
        { type: "separator" },
        { label: "완전히 종료", click: () => app.quit() },
      ]),
    );
    tray.on("double-click", () => window.show());
    if (!globalShortcut.register(shortcut, () => mark()))
      notice = `${shortcutLabel} 단축키 등록 실패. 다른 앱이 사용 중인지 확인하세요.`;
    if (dev) {
      window.on("page-title-updated", (event) => event.preventDefault());
      window.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "F12") {
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
      connections: platforms.status,
      demo: !!demoTimer,
      notice,
      shortcut,
      auth: auth.snapshot(),
    });
}
function persist() {
  if (!engine || savedRevision === engine.revision) return;
  try {
    const temp = `${stateFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(engine.persisted(), null, 2));
    fs.renameSync(temp, stateFile);
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
  if (pollBusy || (engine.poll?.active && platforms.config))
    throw new Error("투표 종료 후 연결을 변경하세요.");
}
ipcMain.handle("assist:call", async (event, action, payload = {}) => {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("허용되지 않은 요청");
  try {
    notice = "";
    switch (action) {
      case "state":
        break;
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
        if (engine.poll?.active)
          throw new Error("투표 종료 후 계정 연결을 해제하세요.");
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
        if (pollBusy || engine.poll?.active)
          throw new Error("투표 종료 후 연결을 해제하세요.");
        connectionRequest++;
        platforms.disconnect();
        break;
      case "demo":
        if (!engine.current) throw new Error("방송 기록을 먼저 시작하세요.");
        if (demoTimer) {
          stopDemo();
          break;
        }
        if (platforms.config || engine.poll?.active)
          throw new Error("실제 연결과 투표를 종료한 후 테스트하세요.");
        demoTimer = setInterval(() => {
          for (let i = 0; i < 20; i++)
            engine.ingest({
              platform: "demo",
              userId: `demo-${Date.now()}-${i}`,
              text: i % 3 === 0 ? "ㅋㅋㅋㅋ 대박" : String((i % 4) + 1),
            });
          broadcast();
        }, 3000);
        break;
      case "poll-start": {
        if (pollBusy) throw new Error("투표 요청을 처리 중입니다.");
        if (demoTimer && payload.mode !== "demo")
          throw new Error("테스트 중에는 테스트 투표를 선택하세요.");
        if (!demoTimer && payload.mode === "demo")
          throw new Error("테스트 채팅을 먼저 켜세요.");
        const mode = ["native", "chat", "demo"].includes(payload.mode)
          ? payload.mode
          : "chat";
        if (
          mode === "chat" &&
          !Object.values(platforms.status).includes("연결됨")
        )
          throw new Error("방송 채팅을 먼저 연결하세요.");
        const poll = engine.createPoll(payload.question, payload.options, mode);
        pollBusy = true;
        try {
          if (mode === "native") await platforms.publishPoll(poll);
          if (mode !== "demo")
            notice =
              "투표가 시작됐습니다. ‘투표 안내 복사’로 채팅에 질문과 번호를 알려주세요.";
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
      case "login-startup":
        if (dev)
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
    return { ok: true };
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
  platforms?.disconnect();
  auth?.cancel();
  persist();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
