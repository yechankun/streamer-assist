const { app, BrowserWindow, dialog } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
let confirmDelete = false, confirmations = [];
dialog.showMessageBox = async (_window, options) => { confirmations.push(options); return { response: confirmDelete ? 1 : 0 }; };
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { assertLayout, waitFor, settleUI } = require("./layout-check.cjs");
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
}, 60000);
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    try {
      window.webContents.setBackgroundThrottling(false);
      window.show(); window.focus();
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
      for (let i = 0; i < 450; i++)
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
          timestamp: start + 60000 + i * 300,
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
      assert.equal(await run("document.querySelector('.viewer-panel > small')!==null"), true, "missing viewer intervals retain a visible notice");
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
      await settleUI(window);
      const screenshot = await window.webContents.capturePage();
      fs.writeFileSync(
        path.join(__dirname, "../release/timeline-analytics.png"),
        screenshot.toPNG(),
      );
      }
      for (const scale of [1, 1.5]) {
        await run("document.documentElement.style.setProperty('--text-scale', '" + scale + "')");
        let originalLabels;
        for (const size of [[900, 650], [1240, 850], [1600, 1000]]) {
          window.setSize(...size);
          await settleUI(window);
          const labels = await run("[...document.querySelectorAll('.viewer-y-axis span, .viewer-x-axis span')].map(label => { const rect = label.getBoundingClientRect(); return { text: label.textContent, width: rect.width, height: rect.height }; })");
          assert.equal(labels.length, 5, "viewer axes contain three values and two timestamps");
          originalLabels ??= labels;
          labels.forEach((label, index) => {
            assert.equal(label.text, originalLabels[index].text);
            assert.ok(Math.abs(label.width - originalLabels[index].width) <= 1 && Math.abs(label.height - originalLabels[index].height) <= 1, "axis labels retain their proportions when the chart is resized");
          });
          if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1") fs.writeFileSync(path.join(__dirname, "../release/timeline-chart-" + size.join("x") + "-" + scale + ".png"), (await window.webContents.capturePage()).toPNG());
        }
      }
      await run("document.documentElement.style.setProperty('--text-scale', '1')");
      window.setSize(1240, 850);
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
      const all = await call("timeline-history",{limit:100,page:4});
      await waitFor(()=>script(()=>Number(document.querySelector('.history-records')?.dataset.loadedCount)===100),"first bounded scroll batch");
      assert.equal(await script(()=>!!document.querySelector('.history-area .telemetry-pagination')),false,"chat history has no page buttons");
      const head=await script(()=>[...document.querySelectorAll('.history-chat-row')].map(row=>row.dataset.recordId));
      let loaded=100;
      while(loaded<455){
        await script(()=>{const node=document.querySelector('.history-records');node.focus();});
        // End animates natively; let it finish before targeting an expanded list.
        let previousTop=-1, stableFrames=0;
        await waitFor(async()=>{
          const top=await script(()=>document.querySelector('.history-records').scrollTop);
          stableFrames=top===previousTop?stableFrames+1:0;previousTop=top;
          return stableFrames>=3;
        },"keyboard scrolling settles");
        window.webContents.sendInputEvent({type:"keyDown",keyCode:"End"});window.webContents.sendInputEvent({type:"keyUp",keyCode:"End"});
        await waitFor(()=>script(previous=>Number(document.querySelector('.history-records').dataset.loadedCount)>previous,loaded),"scroll appends the next batch");
        loaded=await script(()=>Number(document.querySelector('.history-records').dataset.loadedCount));
        assert.ok(await script(()=>document.querySelectorAll('.history-chat-row').length<30),"offscreen records do not allocate hundreds of DOM rows");
      }
      assert.equal(loaded,455);
      assert.equal(await script(()=>document.querySelector('.history-records').dataset.hasMore),"false");
      await script(()=>{const node=document.querySelector('.history-records');node.scrollTop=node.scrollHeight;node.dispatchEvent(new Event('scroll'));});
      await waitFor(()=>script(id=>[...document.querySelectorAll('.history-chat-row')].some(row=>row.dataset.recordId===id),all.events.at(-1).id),"oldest record reached by scrolling");
      await assertLayout(window,"virtual chat history end");
      await script(()=>{const node=document.querySelector('.history-records');node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});
      await waitFor(()=>script(ids=>ids.every(id=>[...document.querySelectorAll('.history-chat-row')].some(row=>row.dataset.recordId===id)),head),"scrolling back restores the first records");
      await script(()=>{const node=document.querySelector('.history-records');node.scrollTop=1250;node.dispatchEvent(new Event('scroll'));});
      await call("text-scale-set",{scale:150});
      await waitFor(()=>script(()=>Math.abs(document.querySelector('.history-records').scrollTop-1875)<2),"font changes preserve the row being read");
      await assertLayout(window,"enlarged virtual chat history");
      if(process.env.STREAMER_ASSIST_TEST_SCREENSHOTS==="1")fs.writeFileSync(path.join(__dirname,"../release/history-scroll-150.png"),(await window.webContents.capturePage()).toPNG());
      await call("text-scale-set",{scale:100});
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
      assert.equal(engine.sessions.find(s=>s.id===currentId).telemetry.chats,450);
      window.setSize(1240,850);
      await new Promise(r=>setTimeout(r,180));
      if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") fs.writeFileSync(path.join(__dirname,"../release/history-calendar.png"),(await window.webContents.capturePage()).toPNG());
      await call("start", { title: "빈 타임라인 배치 확인", offset: 0 });
      await call("stop");
      await script(() => [...document.querySelectorAll(".telemetry-tabs [role=tab]")].find(button => button.textContent === "타임라인").click());
      await waitFor(() => script(() => !!document.querySelector(".viewer-chart .telemetry-empty") && !!document.querySelector(".start-form")), "empty timeline controls");
      for (const size of [[1232, 836], [900, 650], [1240, 850]]) {
        window.setSize(...size);
        await waitFor(() => script(expected => innerWidth === expected[0] && innerHeight === expected[1], size), "idle timeline viewport");
        await assertLayout(window, "empty timeline " + size.join("x"));
        const bounds = await script(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
          return {
            icon: rect(".viewer-chart .telemetry-empty .icon"), heading: rect(".viewer-chart .telemetry-empty strong"),
            description: rect(".viewer-chart .telemetry-empty span"), panel: rect(".viewer-panel"), caption: document.querySelector(".viewer-panel > small")?.getBoundingClientRect().toJSON(),
            form: rect(".marker-form"), input: rect(".marker-form input"), button: rect(".marker-form button"),
            unitInput: rect(".input-unit input"), unitLabel: rect(".input-unit > span"),
            encryptedLabel: document.querySelector(".record-save-state")?.textContent,
          };
        });
        assert.ok(bounds.icon.height <= 48, "placeholder icon stays compact instead of inheriting graph dimensions");
        assert.ok(bounds.icon.bottom <= bounds.heading.top + 1 && bounds.heading.bottom <= bounds.description.top + 1, "empty-state content does not overlap");
        assert.equal(bounds.caption, undefined, "idle chart omits the repeated caption");
        assert.ok(bounds.description.bottom < bounds.panel.bottom, "empty viewer explanation stays inside its panel");
        assert.ok(bounds.button.left > bounds.input.right && Math.abs(bounds.button.right - bounds.form.right) <= 1, "marker field and button fill the row with a visible gap");
        assert.ok(Math.abs(bounds.input.height - bounds.button.height) <= 1, "marker controls align vertically");
        assert.ok(bounds.unitInput.right <= bounds.unitLabel.left + 1, "elapsed input leaves room for its unit");
        assert.notEqual(bounds.encryptedLabel, "암호화 기록", "idle encryption label is omitted");
        if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1") fs.writeFileSync(path.join(__dirname, "../release/timeline-empty-" + size.join("x") + ".png"), (await window.webContents.capturePage()).toPNG());
      }
      for (const size of [[900, 650], [1240, 850]]) {
        window.setSize(...size);
        await waitFor(() => script(expected => innerWidth === expected[0] && innerHeight === expected[1], size), "tab layout viewport");
        for (const scale of [1, 1.5]) {
          await script(scale => document.documentElement.style.setProperty("--text-scale", String(scale)), scale);
          let firstBounds;
          for (const name of ["타임라인", "채팅·후원", "분석·AI 데이터", "AI 분석", "다시보기 수집"]) {
            await script(name => [...document.querySelectorAll(".telemetry-tabs [role=tab]")].find(button => button.textContent === name).click(), name);
            await settleUI(window);
            if (name === "AI 분석") {
              await waitFor(() => script(() => !!document.querySelector(".ai-route-unavailable")), "AI analysis panel loaded");
              await settleUI(window);
              assert.equal(await script(() => getComputedStyle(document.querySelector(".ai-route-unavailable")).display), "flex", "AI assignment notice is styled before opening Settings");
            }
            const bounds = await script(() => {
              const tabs = document.querySelector(".telemetry-tabs");
              const selected = tabs.querySelector('[aria-selected="true"]');
              selected.focus({ preventScroll: true });
              const rect = tabs.getBoundingClientRect();
              const session = document.querySelector(".telemetry-session");
              return { top: rect.top, left: rect.left, width: rect.width, height: rect.height,
                sessionTop: session.getClientRects().length ? session.getBoundingClientRect().top : null,
                focusOffset: getComputedStyle(selected).outlineOffset,
                filterOffsets: [...document.querySelectorAll(".telemetry-filters select")].map(control => {
                  control.focus({ preventScroll: true });
                  return getComputedStyle(control).outlineOffset;
                }) };
            });
            firstBounds ??= bounds;
            for (const key of ["top", "left", "width", "height"]) assert.ok(Math.abs(bounds[key] - firstBounds[key]) <= 1, name + " keeps the tab bar " + key + " at scale " + scale);
            if (bounds.sessionTop !== null) assert.ok(bounds.top + bounds.height <= bounds.sessionTop, "navigation precedes broadcast controls");
            assert.equal(bounds.focusOffset, "-2px", "tab focus stays within the button");
            assert.ok(bounds.filterOffsets.every(offset => offset === "-2px"), "filter focus stays within the control");
            if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1") fs.writeFileSync(path.join(__dirname, "../release/timeline-tabs-" + size.join("x") + "-" + scale + "-" + ["타임라인", "채팅·후원", "분석·AI 데이터", "AI 분석", "다시보기 수집"].indexOf(name) + ".png"), (await window.webContents.capturePage()).toPNG());
          }
        }
      }
      clearTimeout(timeout);
      console.log(
        "PASS: auto live start/stop, encrypted chat/donation history, 455-record scrolling and bounded DOM, end/back navigation, enlarged-text reading position, filters, viewer analysis, date selection/deletion and bounded outer layout",
      );
      app.quit();
    } catch (error) {
      console.error(error);
      console.error("Timeline window:", { bounds: window.getBounds(), content: window.getContentBounds(), visible: window.isVisible(), minimized: window.isMinimized(), maximized: window.isMaximized(), destroyed: window.isDestroyed(), windows: BrowserWindow.getAllWindows().map(win => win.getBounds()) });
      console.error(await window.webContents.executeJavaScript("JSON.stringify({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,active:document.querySelector('[data-workspace-page]:not([hidden])')?.dataset.workspacePage,errors:document.querySelector('.workspace-error')?.textContent})"));
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
