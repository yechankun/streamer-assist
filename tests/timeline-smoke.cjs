const { app, BrowserWindow, dialog } = require("electron");
let confirmDelete = false, confirmations = [];
dialog.showMessageBox = async (_window, options) => { confirmations.push(options); return { response: confirmDelete ? 1 : 0 }; };
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { assertLayout, waitFor } = require("./layout-check.cjs");
const profile = process.env.STREAMER_ASSIST_TEST_PROFILE || path.join(__dirname, "../release/timeline-smoke-" + Date.now());
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F10";
const monitorModule = require("../electron/broadcast-monitor.cjs"),
  platformsModule = require("../electron/platforms.cjs");
const { AuthManager } = require("../electron/oauth.cjs");
let engine,
  monitor,
  mode = "live";
const channels = [
  { platform: "chzzk", channelId: "a".repeat(32), name: "테스트 치지직" },
  { platform: "youtube", channelId: "test-channel", name: "테스트 YouTube" },
];
AuthManager.prototype.monitoringChannels = () => channels;
monitorModule.BroadcastReaders.prototype.read = async function (channel, now) {
  if (mode === "error" && channel.platform === "youtube")
    throw Error("테스트 네트워크 오류");
  return {
    ...channel,
    live: mode === "live" && channel.platform === "chzzk",
    broadcastId: channel.platform + "-stream",
    title: "자동 기록 · 채팅 분석",
    startedAt: now - 360000,
    viewers: mode === "live" && channel.platform === "chzzk" ? 120 : 0,
    observedAt: now,
  };
};
const OriginalMonitor = monitorModule.BroadcastMonitor;
monitorModule.BroadcastMonitor = class extends OriginalMonitor {
  constructor(options) {
    super({ ...options, interval: 60000 });
    monitor = this;
  }
};
const OriginalPlatforms = platformsModule.Platforms;
platformsModule.Platforms = class extends OriginalPlatforms {
  constructor(...args) {
    super(...args);
    engine = this.engine;
  }
};
const timeout = setTimeout(() => {
  console.error("Timeline desktop check timed out");
  app.exit(1);
}, 30000);
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    try {
      const run = (code) => window.webContents.executeJavaScript(code);
      const call = async (action, payload = {}) => {
        const result = await run(
          "window.assist.call(" +
            JSON.stringify(action) +
            "," +
            JSON.stringify(payload) +
            ")",
        );
        assert.equal(result.ok, true, result.error);
        return result.data;
      };
      await call("auto-record-set", { enabled: true });
      await waitFor(() => !!engine.current, "automatic live detection");
      assert.equal(engine.current.recordingMode, "automatic");
      assert.ok(Date.now() - engine.current.startedAt >= 350000);
      const start = engine.current.startedAt;
      for (let i = 0; i < 100; i++)
        engine.ingest({
          platform: "chzzk",
          id: "chat-" + i,
          userId: "viewer-" + (i % 8),
          name: "테스트 시청자 " + ((i % 8) + 1),
          subscriber: i % 2 === 0,
          roles: i % 8 === 0 ? ["moderator"] : [],
          text:
            i % 4 === 0
              ? "ㅋㅋㅋㅋ 재밌다"
              : i % 4 === 1
                ? "다음 게임은 무엇인가요?"
                : "오늘 방송 대박",
          timestamp: start + 60000 + i * 1000,
        });
      engine.ingest({
        platform: "youtube",
        id: "paid",
        userId: "donor",
        name: "테스트 후원자",
        kind: "donation",
        amountMicros: 5000000000,
        currency: "KRW",
        text: "응원합니다!",
        timestamp: Date.now(),
      });
      for (let i = 0; i < 16; i++)
        engine.sampleViewers(
          [
            { platform: "chzzk", live: true, viewers: 100 + i * 9 },
            {
              platform: "youtube",
              live: true,
              viewers: i === 6 ? null : 25 + i * 2,
            },
          ],
          start + i * 20000,
        );
      await call("state");
      await run(
        "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('방송 타임라인')).click()",
      );
      await waitFor(
        () => run("document.querySelector('.viewer-line')!==null"),
        "viewer graph",
      );
      for (const size of [
        [1240, 850],
        [900, 650],
      ]) {
        window.setSize(...size);
        await new Promise((r) => setTimeout(r, 150));
        await assertLayout(window, "timeline overview " + size.join("x"));
        await run(
          "[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='채팅·후원').click()",
        );
        await waitFor(
          () =>
            run("document.querySelectorAll('.telemetry-chat-row').length>0"),
          "chat history",
        );
        await assertLayout(window, "record history " + size.join("x"));
        const record = await call("timeline-query", { limit: 100 });
        assert.equal(record.events.length, 100);
        assert.ok(record.events.some((e) => e.type === "donation"));
        await run(
          "[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='분석·AI 데이터').click()",
        );
        await waitFor(
          () => run("document.querySelectorAll('.participant-row').length>0"),
          "viewer identities",
        );
        await new Promise((r) => setTimeout(r, 100));
        await assertLayout(window, "chat analysis " + size.join("x"));
        await run(
          "[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='타임라인').click()",
        );
      }
      window.setSize(1240, 850);
      await new Promise((r) => setTimeout(r, 130));
      if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") {
      const screenshot = await window.webContents.capturePage();
      fs.writeFileSync(
        path.join(__dirname, "../release/timeline-analytics.png"),
        screenshot.toPNG(),
      );
      }
      const currentId = engine.current.id;
      mode = "error";
      await monitor.poll();
      assert.equal(
        engine.current.id,
        currentId,
        "network errors must not close the timeline",
      );
      mode = "offline";
      await monitor.poll();
      assert.equal(
        engine.current,
        null,
        "all platforms offline must end recording",
      );
      assert.equal(engine.sessions[0].id, currentId);
      const history = await call("timeline-query", {
        sessionId: currentId,
        kind: "donation",
      });
      assert.equal(history.events.length, 1);
      const script = (fn,...args) => run("("+fn.toString()+")("+args.map(value=>JSON.stringify(value)).join(",")+")");
      for (const ago of [1, 3, 9, 41]) {
        const date = new Date(); date.setHours(12,0,0,0); date.setDate(date.getDate()-ago);
        const when = date.getTime();
        engine.start("지난 방송 " + ago,0,when);
        engine.ingest({ platform: ago % 2 ? "youtube" : "chzzk", id: "archive-" + ago, userId: "old-viewer", name: "기록 시청자", text: "지난 방송 기록", timestamp: when+1000 }, when+2000);
        engine.stop(when+3000);
      }
      await call("state");
      await script(()=>[...document.querySelectorAll("[role=tab]")].find(b=>b.textContent==="채팅·후원").click());
      await waitFor(()=>script(()=>document.querySelector(".history-panel")!==null),"all date history");
      assert.equal(await script(()=>document.querySelector('[aria-label="채팅 기록 방송 범위"]').value), "");
      const all = await call("timeline-history",{limit:100,page:1});
      assert.ok(all.events.some(e=>e.sessionId!==currentId));
      const platformRecords = await call("timeline-history",{platform:"youtube",limit:100});
      assert.ok(platformRecords.events.length>0 && platformRecords.events.every(e=>e.platform==="youtube"));
      window.setSize(900,650);
      await script(id=>{const select=document.querySelector('[aria-label="채팅 기록 방송 범위"]');select.value=id;select.dispatchEvent(new Event("change",{bubbles:true}));},currentId);
      await waitFor(()=>script(()=>document.querySelector('[aria-label="기록 시작 분"]')!==null),"broadcast elapsed filters");
      await assertLayout(window,"single broadcast history filters 900x650");
      await script(()=>{const select=document.querySelector('[aria-label="채팅 기록 방송 범위"]');select.value="";select.dispatchEvent(new Event("change",{bubbles:true}));});
      await script(()=>[...document.querySelectorAll(".history-modes button")].find(b=>b.textContent==="날짜·용량 관리").click());
      await waitFor(()=>script(()=>document.querySelectorAll(".history-date").length>=2),"date groups");
      for (const size of [[1240,850],[900,650]]) {
        window.setSize(...size); await new Promise(r=>setTimeout(r,120));
        for (const zoom of ["일별","주별","월별"]) {
          await script(name=>[...document.querySelectorAll(".history-zoom button")].find(b=>b.textContent===name).click(),zoom);
          await new Promise(r=>setTimeout(r,120));
          await assertLayout(window,"history calendar "+zoom+" "+size.join("x"));
        }
      }
      await script(()=>[...document.querySelectorAll(".history-zoom button")].find(b=>b.textContent==="일별").click());
      await new Promise(r=>setTimeout(r,160));
      await script(()=>{document.querySelectorAll(".history-date")[1].click();document.querySelectorAll(".history-date")[2].click();});
      await waitFor(()=>script(()=>document.querySelector(".history-selection strong").textContent==="2개 날짜 선택"),"multiple dates");
      await script(()=>[...document.querySelectorAll(".history-zoom button")].find(b=>b.textContent==="월별").click());
      assert.equal(await script(()=>document.querySelector(".history-selection strong").textContent),"2개 날짜 선택");
      await waitFor(()=>script(()=>!document.querySelector(".history-delete").disabled),"selected disk preview");
      await script(()=>document.querySelector(".history-delete").click());
      await waitFor(()=>confirmations.length===1,"delete cancellation");
      assert.equal((await call("timeline-calendar")).days.length,5);
      await waitFor(()=>script(()=>!document.querySelector(".history-delete").disabled),"canceled selection retained");
      confirmDelete=true;
      await script(()=>document.querySelector(".history-delete").click());
      await waitFor(()=>script(()=>document.querySelector(".history-selection strong").textContent==="전체 날짜"),"selected deletion");
      assert.equal((await call("timeline-calendar")).days.length,3);
      const remaining=await call("timeline-history",{limit:100});
      assert.ok(remaining.events.some(e=>e.sessionId===currentId));
      assert.equal(engine.sessions.find(s=>s.id===currentId).telemetry.chats,100);
      window.setSize(1240,850);
      await new Promise(r=>setTimeout(r,180));
      if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") fs.writeFileSync(path.join(__dirname,"../release/history-calendar.png"),(await window.webContents.capturePage()).toPNG());
      clearTimeout(timeout);
      console.log(
        "PASS: auto live start/all-offline stop, encrypted chat/donation history, real viewer graph, identity analysis, all/platform history, day/week/month selection, confirmed deletion and no-scroll tabs at 900x650/1240x850",
      );
      app.quit();
    } catch (error) {
      console.error(error);
      try {
      const image = await window.webContents.capturePage();
      fs.writeFileSync(
        path.join(__dirname, "../release/timeline-smoke-failure.png"),
        image.toPNG(),
      );
      } catch { /* Screenshot failure must not mask the original assertion. */ }
      console.error(
        await window.webContents.executeJavaScript(
          "JSON.stringify([...document.querySelectorAll('.participant-panel,.participant-area,.participant-row,.ai-data-panel')].map(e=>({name:e.className,rect:e.getBoundingClientRect().toJSON()})))",
        ),
      );
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});
require("../electron/main.cjs");
