const { app, BrowserWindow } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { assertLayout, waitFor, settleUI } = require("./layout-check.cjs");
app.setPath("userData", process.env.STREAMER_ASSIST_TEST_PROFILE);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F17";
const restarting = process.env.STREAMER_ASSIST_APPEARANCE_RESTART === "1";
const output = path.join(__dirname, "../release/text-size"); fs.mkdirSync(output, { recursive: true });
const models = [{ id: "fixture-model", name: "Fixture model", efforts: ["default", "high"] }];
const providers = ["openai", "anthropic", "xai", "google", "deepseek", "moonshot"].map((id, i) => ({ id, name: ["OpenAI", "Anthropic", "xAI", "Google", "DeepSeek", "Moonshot"][i], added: true, enabled: true, mode: "api", model: "fixture-model", effort: "default", hasKey: true, hasCliSession: false, models, custom: false, component: { status: "ready", version: "fixture" } }));
const binding = { providerId: "openai", mode: "api", model: "fixture-model", effort: "default" };
const job = { id: "font-result", status: "completed", providerId: "openai", mode: "api", model: "fixture-model", effort: "default", functionId: "chat.custom", createdAt: Date.now(), text: ("큰 글자에서도 결과가 잘리지 않고 다음 페이지로 이어져야 합니다. 한국어와 English 및 123456789를 함께 확인합니다.\n").repeat(40), usage: { inputTokens: 1234, outputTokens: 678 }, cost: { amount: .01, estimated: true } };
const service = require("../electron/ai-service.cjs"), ActualService = service.CommonAiService;
service.CommonAiService = class extends ActualService {
  snapshot() { return { providers, encrypted: true, job, results: [job], assignments: { default: binding, groups: {}, functions: {} }, resolvedFunctions: Object.fromEntries(["chat.custom", "chat.questions", "chat.reactions", "broadcast.summary", "broadcast.highlights", "support.summary"].map(id => [id, { available: true, source: "default", binding }])) }; }
  async handle(action) {
    if (action === "ai-state") return this.snapshot();
    if (action === "ai-model-options") return { models, efforts: ["default", "high"] };
    if (action === "ai-preview") return { sampledEvents: 20, totalEvents: 20, bytes: 4096, estimatedTokens: 1200, truncated: false };
    if (["ai-job-status", "ai-results-get"].includes(action)) return job;
    if (action === "ai-update-check") return {};
    throw Error("Appearance fixture blocks external AI operations: " + action);
  }
};
const platformModule = require("../electron/platforms.cjs"), ActualPlatforms = platformModule.Platforms;
let engine, main;
platformModule.Platforms = class extends ActualPlatforms { constructor(...args) { super(...args); engine = this.engine; } };
const js = (win, fn, ...args) => win.webContents.executeJavaScript("(" + fn.toString() + ")(" + args.map(value => JSON.stringify(value)).join(",") + ")");
const call = async (win, action, payload = {}) => { const value = await js(win, (action, payload) => window.assist.call(action, payload), action, payload); assert.equal(value.ok, true, value.error); return value.data; };
const tab = async name => { await js(main, name => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes(name)).click(), name); await settleUI(main); };
const click = async (selector, text) => { await waitFor(() => js(main, (selector, text) => [...document.querySelectorAll(selector)].some(button => button.textContent.trim() === text), selector, text), "lazy control ready: " + text); await js(main, (selector, text) => [...document.querySelectorAll(selector)].find(button => button.textContent.trim() === text).click(), selector, text); await settleUI(main); };
const check = async name => {
  await settleUI(main); await assertLayout(main, name);
  assert.equal(await js(main,()=>{const area=document.querySelector('[data-workspace-page]:not([hidden]) .content');return area.scrollHeight<=area.clientHeight+1;}),true,name+": whole workspace stays within the window");
  const groupNamesFit=await js(main,()=>[...document.querySelectorAll('.ai-function-groups > button > span')].filter(row=>row.getClientRects().length).every(row=>row.getBoundingClientRect().height<=parseFloat(getComputedStyle(row).fontSize)*1.5));
  assert.equal(groupNamesFit,true,name+": AI group names stay on one readable line");
  const reachable = await js(main, () => {
    const area = document.querySelector('[data-workspace-page]:not([hidden]) .content');
    const controls = [...area.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),summary")].filter(row => row.getClientRects().length && !row.closest("dialog:not([open])"));
    const scroll = area.scrollTop;
    const failures = [];
    for (const control of controls) {
      control.focus(); const box = control.getBoundingClientRect();
      if (box.top < 59 || box.bottom > innerHeight + 1 || box.left < 0 || box.right > innerWidth + 1) failures.push(control.getAttribute("aria-label") || control.textContent);
    }
    document.activeElement?.blur(); area.scrollTop = scroll;
    return failures;
  });
  assert.deepEqual(reachable, [], name + ": controls remain reachable with keyboard scrolling");
  if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1") fs.writeFileSync(path.join(output, name + ".png"), (await main.webContents.capturePage()).toPNG());
};
const deadline = setTimeout(() => { console.error("Appearance check timed out"); app.exit(1); }, 120000);
app.on("browser-window-created", (_event, window) => {
  if (main) return; main = window;
  main.webContents.on("console-message", event => { if (event.level >= 2) console.error("Appearance renderer:", event.message); });
  main.webContents.once("did-finish-load", async () => {
    try {
      main.webContents.setBackgroundThrottling(false);
      await waitFor(() => js(main, () => document.querySelector('[data-workspace-ready="true"]')), "appearance workspace ready");
      if (restarting) {
        const timers = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "poll-timers.json"), "utf8"));
        assert.equal(engine.poll.id, timers.pollId);
        assert.equal(engine.poll.endsAt, timers.pollEnd);
        assert.equal(engine.audience.donationPoll.endsAt, timers.donationEnd);
        await waitFor(() => !engine.poll.active && !engine.audience.donationPoll.active, "restored poll deadlines finish automatically");
        assert.equal(engine.poll.closedAt, timers.pollEnd);
        assert.equal(engine.audience.donationPoll.closedAt, timers.donationEnd);
        assert.equal(engine.current.polls.filter(p => p.id === timers.pollId).length, 1);
        await waitFor(() => js(main, () => document.documentElement.dataset.textScale === "130"), "text size restored after actual restart");
        await tab("설정"); assert.equal(await js(main, () => document.querySelector('[aria-label="글자 크기"]').value), "130");
        await call(main, "text-scale-set", { scale: 100 });
        console.log("PASS: actual restart restores the shared text size"); clearTimeout(deadline); app.quit(); return;
      }
      main.setSize(900, 650);
      await tab("설정");
      assert.equal(await js(main,()=>{const slider=document.querySelector('[aria-label="글자 크기"]');return slider.type==="range"&&slider.min==="95"&&slider.max==="150"&&slider.step==="5";}),true,"text size is a slider with only 5% reduction below default");
      main.show();main.focus();main.webContents.focus();await waitFor(()=>js(main,()=>document.hasFocus()),"slider input window focus");
      const sliderBounds=await js(main,()=>document.querySelector('[aria-label="글자 크기"]').getBoundingClientRect().toJSON());
      const origin=main.getContentBounds(), mouse=(type,x)=>main.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(sliderBounds.top+sliderBounds.height/2),globalX:Math.round(origin.x+x),globalY:Math.round(origin.y+sliderBounds.top+sliderBounds.height/2),button:"left",clickCount:1,modifiers:type==="mouseMove"?["leftButtonDown"]:[]});
      const thumb=sliderBounds.left+8+(sliderBounds.width-16)*5/55;
      mouse("mouseDown",thumb);mouse("mouseMove",sliderBounds.right-8);
      await waitFor(()=>js(main,()=>document.querySelector('[aria-label="글자 크기"]').value==="150"),"native drag previews 150%");
      assert.equal(await js(main,()=>document.documentElement.dataset.textScale),"100","drag preview does not move the slider by reflowing the page");
      const unchanged=await js(main,()=>document.querySelector('[aria-label="글자 크기"]').getBoundingClientRect().toJSON());assert.equal(unchanged.top,sliderBounds.top);assert.equal(unchanged.width,sliderBounds.width);
      mouse("mouseUp",sliderBounds.right-8);
      await waitFor(() => js(main, () => document.documentElement.dataset.textScale === "150"), "settings applies 150% text size");
      assert.equal(await js(main, () => parseFloat(getComputedStyle(document.documentElement).fontSize)), 19.5);
      assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "preferences.json"))).textScale, 150);
      await check("settings-150-900");
      await js(main,()=>document.querySelector('[aria-label="기본 글자 크기로 복원"]').click());await waitFor(()=>js(main,()=>document.documentElement.dataset.textScale==="100"),"reset restores default size");
      await js(main,()=>document.querySelector('[aria-label="글자 크기"]').focus());main.webContents.sendInputEvent({type:"keyDown",keyCode:"Home"});main.webContents.sendInputEvent({type:"keyUp",keyCode:"Home"});
      await waitFor(()=>js(main,()=>document.documentElement.dataset.textScale==="95"),"keyboard minimum only reduces text by 5%");
      for (const size of [95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150]) { await call(main, "text-scale-set", { scale: size }); await waitFor(() => js(main, size => document.documentElement.dataset.textScale === String(size), size), "font scale " + size); await check("settings-" + size); }
      for (let day = 3; day > 0; day--) { const when = Date.now() - day * 86400000; engine.start("지난 방송 " + day, 0, when); for (let i = 0; i < 30; i++) engine.ingest({ platform: "demo", id: day + "-" + i, userId: "viewer-" + i, name: "참여 시청자 " + i, text: "방송 글자 크기 확인 ㅋㅋ", timestamp: when + i * 1000 }, when + i * 1000); engine.stop(when + 60000); }
      await call(main, "start", { title: "글자 크기와 화면 배치 확인", offset: 600 });
      await call(main, "demo");
      for (let i = 0; i < 30; i++) engine.ingest({ platform: "demo", id: "current-" + i, userId: "viewer-" + i, name: "참여 시청자 " + i, text: "다음 방송은 무엇인가요? ㅋㅋ", timestamp: Date.now() });
      engine.sampleViewers([{ platform: "demo", live: true, viewers: 1234 }], Date.now()); await call(main, "state");
      for (const dimensions of [[900,650], [1280,800]]) {
        main.setSize(...dimensions); await waitFor(() => js(main, d => innerWidth === d[0] && innerHeight === d[1], dimensions), "font test viewport");
        const suffix = dimensions.join("x");
        await js(main, () => document.querySelector(".brand").click()); await check("home-150-" + suffix);
        await tab("방송 타임라인"); await click(".telemetry-tabs button","타임라인");await check("timeline-150-" + suffix);
        await click(".telemetry-tabs button", "채팅·후원");await click(".history-modes button","채팅 기록");await check("history-150-" + suffix);
        await click(".history-modes button", "날짜·용량 관리"); await check("calendar-150-" + suffix);
        await click(".telemetry-tabs button", "분석·AI 데이터"); await check("analysis-150-" + suffix);
        await click(".telemetry-tabs button", "AI 분석"); await waitFor(() => js(main, () => !!document.querySelector(".ai-result-reader pre")), "fixture AI result"); await check("ai-result-150-" + suffix);
        assert.equal(await js(main, () => { const pre=document.querySelector(".ai-result-reader pre");return pre.scrollWidth<=pre.clientWidth+1&&pre.scrollHeight<=pre.parentElement.clientHeight; }), true, "AI pagination fits enlarged text");
        for (const name of ["시청자 추첨", "숫자 투표", "도네 투표", "룰렛"]) {
          await tab(name);
          if(await js(main,()=>!!document.querySelector('[data-workspace-page]:not([hidden]) .raffle-stage')))await click(".raffle-page button","모집 설정");
          if(await js(main,()=>!!document.querySelector('[data-workspace-page]:not([hidden]) .broadcast-poll')))await click('[data-workspace-page]:not([hidden]) button',"투표 설정");
          if(await js(main,()=>!!document.querySelector('[data-workspace-page]:not([hidden]) .roulette-stage')))await click(".roulette-page button","항목 수정");
          if (["숫자 투표", "도네 투표"].includes(name)) await js(main, () => {
            const timer = document.querySelector('[data-workspace-page]:not([hidden]) .poll-timer-settings input[type="checkbox"]');
            if (timer && !timer.checked) timer.click();
          });
          await check(name + "-setup-150-" + suffix);
        }
        await tab("설정");
        for (const section of ["일반", "플랫폼 연결", "AI 연결", "정보·데이터"]) { await click(".settings-tabs button", section); await check(section + "-150-" + suffix); if(section==="AI 연결") { await waitFor(() => js(main, () => !!document.querySelector(".ai-key-card")), "fixture AI settings"); await click(".ai-settings-navigation button", "기능별 AI"); await check("ai-functions-150-" + suffix); await click(".ai-settings-navigation button", "AI 연결"); } }
        await call(main,"poll-start",{question:"다음 콘텐츠를 골라주세요",options:["첫 번째 선택", "두 번째 선택", "세 번째 선택", "네 번째 선택"],platforms:["demo"],chatPrefix:"!투표",youtubeMethod:"chat"}); await tab("숫자 투표"); await check("poll-live-150-"+suffix);
        engine.ingest({platform:"demo",id:"font-vote-"+suffix,userId:"font-voter",name:"투표 시청자",text:"!투표1",timestamp:Date.now()});await call(main,"state");await call(main,"poll-stop");
        await click('[data-workspace-page]:not([hidden]) .broadcast-controls button',"결과로 룰렛");await waitFor(()=>js(main,()=>!!document.querySelector('.roulette-stage')),"weighted roulette stage");await check("roulette-live-150-"+suffix);
        await call(main,"raffle-start",{title:"함께할 시청자",platforms:["demo"],entryMode:"any",keyword:"!참여",subscribersOnly:false,excludeWinners:true,timerSeconds:null});
        for(let i=0;i<20;i++)engine.ingest({platform:"demo",id:"font-raffle-"+suffix+"-"+i,userId:"raffle-viewer-"+i,name:"테스트 시청자 "+(i+1),text:"참여합니다",timestamp:Date.now()});await call(main,"state");
        await tab("시청자 추첨"); await check("raffle-live-150-"+suffix); await call(main,"raffle-stop");await check("raffle-closed-150-"+suffix);
        await call(main,"raffle-draw",{reducedMotion:true});await waitFor(()=>js(main,()=>!!document.querySelector('.raffle-pick.revealed')),"raffle winner visible");await check("raffle-winner-150-"+suffix);
        await call(main,"donation-start",{question:"후원으로 콘텐츠를 골라주세요",options:["첫 선택","두 번째 선택"],platforms:["demo"],chatPrefix:"!투표",currency:"KRW",minimumMicros:1000000000,plural:true,timerSeconds:null}); await tab("도네 투표"); await check("donation-live-150-"+suffix); await call(main,"donation-stop");
      }
      main.setSize(1206,762);await tab("시청자 추첨");await check("raffle-user-window-150");
      const childReady = new Promise(resolve => app.once("browser-window-created", (_event, win) => win.webContents.once("did-finish-load", () => resolve(win))));
      const created=await js(main, () => window.assist.workspace("new-window", { id: "timeline" }));assert.equal(created.ok,true,created.error);const child = await childReady;
      await waitFor(() => js(child, () => document.documentElement.dataset.textScale === "150"), "new window inherits text size");
      await call(child,"text-scale-set",{scale:130});
      await waitFor(() => js(main, () => document.documentElement.dataset.textScale === "130"), "secondary setting synchronizes main window");
      child.close(); await call(main,"demo"); await call(main,"stop");
      engine.start("재시작 후 타이머 검증");
      const restorePoll = engine.createPoll("저장한 숫자 투표", ["A", "B"], "demo", ["demo"], "!투표", 1);
      const restoreDonation = engine.audience.startDonation({ question: "저장한 도네 투표", options: ["A", "B"], platforms: ["demo"], chatPrefix: "!투표", currency: "KRW", minimumMicros: 1000000000, plural: false, timerSeconds: 1 });
      fs.writeFileSync(path.join(app.getPath("userData"), "poll-timers.json"), JSON.stringify({ pollId: restorePoll.id, pollEnd: restorePoll.endsAt, donationEnd: restoreDonation.endsAt }));
      await call(main, "state");
      console.log("PASS: stable slider at 95–150%, bounded layouts and keyboard reachability across tools/AI at 900x650 and 1280x800, enlarged AI pagination and multi-window synchronization");
      clearTimeout(deadline); app.quit();
    } catch (error) { console.error(error); console.error(await js(main, () => ({ scale:document.documentElement.dataset.textScale, active:document.querySelector('[data-workspace-page]:not([hidden])')?.dataset.workspacePage }))); fs.writeFileSync(path.join(output,"failure.png"),(await main.webContents.capturePage()).toPNG());clearTimeout(deadline);app.exit(1); }
  });
});
require("../electron/main.cjs");
