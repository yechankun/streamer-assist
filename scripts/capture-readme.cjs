// Capture the real application renderer with an isolated profile and generated demo data.
const { app } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertLayout,
  waitFor,
  renderFixture,
  settleUI,
} = require("../tests/layout-check.cjs");
const root = path.resolve(__dirname, "..");
require("../tests/demo-clock.cjs").installDemoClock();
let engine;
const platformModule=require("../electron/platforms.cjs");
const OriginalPlatforms=platformModule.Platforms;
platformModule.Platforms=class extends OriginalPlatforms {
  constructor(...args){super(...args);engine=this.engine;}
};
function sampleMessage(platform,id,person,text,timestamp){
  return {platform,id,userId:"docs-viewer-"+person,name:"샘플 시청자 "+(person+1),
    subscriber:person%3===0,roles:person===0?["moderator"]:[],text,timestamp};
}
function seedArchive(){
  for(let ago=62;ago>=1;ago-=2){
    const date=new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()-ago);
    const start=date.getTime();
    engine.start("샘플 방송 · "+date.toLocaleDateString("ko-KR"),0,start);
    for(let i=0;i<36;i++)engine.ingest(sampleMessage(["chzzk","youtube","twitch"][i%3],"archive-"+ago+"-"+i,i%12,["오늘의 시청자 참여 게임","이 장면 다시 보고 싶어요 ㅋㅋ","다음 라운드는 무엇인가요?"][i%3],start+i*1000),start+3600000,{historical:true});
    engine.stop(start+3600000);
  }
}
function seedCurrent(){
  const start=engine.current.startedAt;
  for(let i=0;i<240;i++)engine.ingest(sampleMessage(["chzzk","youtube","twitch"][i%3],"current-"+i,i%24,["ㅋㅋㅋㅋ 마지막 역전 최고","다음 게임은 무엇인가요?","시청자 미션 성공!","오늘 방송 즐겁네요"][i%4],start+60000+i*5000),Date.now(),{historical:true});
  for(let i=0;i<24;i++)engine.sampleViewers([
    {platform:"chzzk",live:true,viewers:250+i*11},
    {platform:"youtube",live:true,viewers:85+i*4},
    {platform:"twitch",live:true,viewers:42+i*2}
  ],start+i*70000);
  engine.ingest({...sampleMessage("youtube","sample-paid",25,"멋진 역전 장면 응원합니다!",start+900000),kind:"donation",currency:"KRW",amountMicros:5000000000},Date.now(),{historical:true});
}
function seedLiveChat(){
  const messages=["마지막 역전 장면 다시 봐도 대박","다음 게임도 함께 참여할게요!","ㅋㅋㅋㅋ 오늘 최고의 순간","시청자 미션 성공 축하해요","다음 라운드는 언제 시작하나요?"];
  for(let i=0;i<20;i++)engine.ingest(sampleMessage(["chzzk","youtube","twitch"][i%3],"live-"+i,i%24,messages[i%5],Date.now()-20000+i*800));
}
const storeCapture = process.argv.includes("--store");
const output = path.join(
  root,
  storeCapture ? "release/store-assets/screenshots" : "release/readme-screens",
);
fs.mkdirSync(output, { recursive: true });
app.setPath(
  "userData",
  process.env.STREAMER_ASSIST_CAPTURE_PROFILE || path.join(root, "release/readme-profile-" + Date.now()),
);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F18";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = setTimeout(() => {
  console.error("Screenshot capture timed out");
  app.exit(1);
}, 90000);
app.on("browser-window-created", (_event, window) =>
  window.webContents.once("did-finish-load", async () => {
    const js = (fn, ...args) =>
      window.webContents.executeJavaScript(
        "(" +
          fn.toString() +
          ")(" +
          args.map((v) => JSON.stringify(v)).join(",") +
          ")",
      );
    const call = async (action, payload = {}) => {
      const result = await js(
        (a, p) => window.assist.call(a, p),
        action,
        payload,
      );
      if (!result.ok) throw Error(result.error);
    };
    const state = () =>
      js(async () => {
        let value;
        const off = window.assist.subscribe((s) => (value = s));
        await window.assist.call("state");
        off();
        return value;
      });
    const tab = async (label) => {
      await js(
        (l) =>
          [...document.querySelectorAll("nav button")]
            .find((b) => b.textContent.includes(l))
            .click(),
        label,
      );
      await settleUI(window);
    };
    const capture = async (name) => {
      await settleUI(window);
      await assertLayout(window, name);
      fs.writeFileSync(
        path.join(output, name + ".png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      console.log("Captured " + name);
    };
    try {
      window.webContents.setBackgroundThrottling(false);
      window.setSize(storeCapture ? 1600 : 1280, storeCapture ? 900 : 800);
      window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand(
        "Emulation.setEmulatedMedia",
        { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      );
      await delay(350);
      await capture("home-dark");
      await js(() => document.querySelector(".theme-toggle").click());
      await capture("home-light");
      await js(() => document.querySelector(".theme-toggle").click());
      seedArchive();
      await call("start", {
        title: "시청자와 함께하는 오늘의 방송",
        offset: 1800,
      });
      seedCurrent();
      await call("state");
      await call("mark", { label: "첫 번째 라운드의 역전승" });
      await delay(1000);
      await call("mark", { label: "시청자 미션 성공!" });
      await call("demo");
      seedLiveChat();
      await call("state");
      await tab("방송 타임라인");
      await waitFor(
        async () =>
          (await state()).current.markers.some((m) => m.kind === "auto"),
        "demo highlight arrives",
      );
      await capture("timeline");
      await js(()=>[...document.querySelectorAll('[role="tab"]')].find(button=>button.textContent==="분석·AI 데이터").click());
      await waitFor(()=>js(()=>document.querySelectorAll(".participant-row").length>0),"chat analysis ready");
      await capture("chat-analysis");
      await js(()=>[...document.querySelectorAll('[role="tab"]')].find(button=>button.textContent==="채팅·후원").click());
      await waitFor(()=>js(()=>document.querySelectorAll(".history-chat-row").length>0),"all-date history ready");
      await capture("chat-history");
      await js(()=>[...document.querySelectorAll(".history-modes button")].find(button=>button.textContent==="날짜·용량 관리").click());
      await waitFor(()=>js(()=>document.querySelectorAll(".history-date").length>4),"calendar ready");
      await js(()=>{const days=[...document.querySelectorAll(".history-date:not(:disabled)")];days[0].click();days[1].click();days[3].click();});
      await waitFor(()=>js(()=>document.querySelector(".history-selection strong").textContent==="3개 날짜 선택"),"selected dates");
      await waitFor(()=>js(()=>!document.querySelector(".history-delete").disabled),"selected disk size ready");
      await capture("chat-storage");
      await js(()=>[...document.querySelectorAll('[role="tab"]')].find(button=>button.textContent==="타임라인").click());

      await js(() => document.querySelector(".brand").click());
      await capture("home-recording");
      await call("raffle-start", {
        title: "다음 라운드를 함께할 시청자는?",
        platforms: ["demo"],
        entryMode: "any",
        keyword: "!참여",
        subscribersOnly: false,
        excludeWinners: true,
        timerSeconds: null,
      });
      await tab("시청자 추첨");
      await waitFor(
        async () => (await state()).audience.raffle.candidateCount > 0,
        "demo participants arrive",
      );
      await call("raffle-draw", { reducedMotion: true });
      await waitFor(
        () => js(() => !!document.querySelector(".raffle-page .raffle-pick.revealed .raffle-slot-name")),
        "raffle winner rendered before capture",
      );
      await capture("viewer-raffle");
      await call("raffle-stop");
      const options = [
        "마인크래프트",
        "발로란트",
        "스타듀 밸리",
        "리그 오브 레전드",
      ];
      await call("poll-start", {
        question: "다음에는 어떤 게임을 할까요?",
        options,
        platforms: ["demo"],
        chatPrefix: "!투표",
        youtubeMethod: "chat",
        timerSeconds: 600,
      });
      await tab("숫자 투표");
      const pollFixture = await state();
      pollFixture.poll.counts = [384, 231, 122, 63];
      let stopFixture = renderFixture(window, () => pollFixture);
      try {
        await waitFor(
          () => js(() => document.querySelector(".broadcast-stats .animated-number")?.textContent === "800"),
          "sample vote totals rendered before capture",
        );
        await capture("live-poll");
      } finally {
        stopFixture();
      }
      await call("poll-stop");
      await call("donation-start", {
        question: "다음 방송 콘텐츠를 골라주세요",
        options: [
          "새로운 게임 도전",
          "시청자 참여 게임",
          "오늘의 하이라이트 리뷰",
        ],
        platforms: ["demo"],
        chatPrefix: "!투표",
        currency: "KRW",
        minimumMicros: 1000000000,
        plural: true,
        timerSeconds: 900,
      });
      await tab("도네 투표");
      const donationFixture = await state();
      donationFixture.audience.donationPoll.counts = [64, 108, 28];
      donationFixture.audience.donationPoll.acceptedEvents = 48;
      stopFixture = renderFixture(window, () => donationFixture);
      try {
        await capture("donation-vote");
      } finally {
        stopFixture();
      }
      await call("donation-stop");
      const rouletteFixture = await state();
      rouletteFixture.audience.donationPoll.counts = [64, 108, 28];
      stopFixture = renderFixture(window, () => rouletteFixture);
      try {
        await delay(150);
        await js(() =>
          [
            ...document.querySelectorAll(
              ".donation-page .broadcast-controls button",
            ),
          ]
            .find((b) => b.textContent.includes("결과로 룰렛"))
            .click(),
        );
        await settleUI(window);
        await capture("roulette");
      } finally {
        stopFixture();
      }
      await call("demo");
      await call("stop");
      await tab("설정");
      await js(() =>
        [...document.querySelectorAll(".settings-tabs button")]
          .find((b) => b.textContent.includes("일반"))
          .click(),
      );
      await capture("settings");
      await js(() =>
        [...document.querySelectorAll(".settings-tabs button")]
          .find((b) => b.textContent.includes("플랫폼 연결"))
          .click(),
      );
      await capture("platforms");
      await js(() =>
        [...document.querySelectorAll(".settings-tabs button")]
          .find((b) => b.textContent.includes("AI 연결"))
          .click(),
      );
      await js(() => document.querySelector('[aria-label="AI 연결 추가"]')?.click());
      await capture("ai-connectors");
      await js(() => document.querySelector('[aria-label="AI 추가 선택 닫기"]')?.click());
      await js(() =>
        [...document.querySelectorAll(".settings-tabs button")]
          .find((b) => b.textContent.includes("정보·데이터"))
          .click(),
      );
      await capture("privacy");
      window.webContents.debugger.detach();
      clearTimeout(deadline);
      console.log(
        "Product screenshots captured without real accounts or external voting.",
      );
      app.quit();
    } catch (error) {
      clearTimeout(deadline);
      console.error(error);
      app.exit(1);
    }
  }),
);
require("../electron/main.cjs");
