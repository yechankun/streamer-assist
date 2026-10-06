// Capture the real application renderer with an isolated profile and generated demo data.
const { app } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertLayout,
  waitFor,
  renderFixture,
} = require("../tests/layout-check.cjs");
const root = path.resolve(__dirname, "..");
const storeCapture = process.argv.includes("--store");
const output = path.join(
  root,
  storeCapture ? "release/store-assets/screenshots" : "release/readme-screens",
);
fs.mkdirSync(output, { recursive: true });
app.setPath(
  "userData",
  path.join(root, "release/readme-profile-" + Date.now()),
);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F18";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = setTimeout(() => {
  console.error("Screenshot capture timed out");
  app.exit(1);
}, 45000);
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
      await delay(500);
    };
    const capture = async (name) => {
      await delay(750);
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
      await call("start", {
        title: "시청자와 함께하는 오늘의 방송",
        offset: 1800,
      });
      await call("mark", { label: "첫 번째 라운드의 역전승" });
      await delay(1000);
      await call("mark", { label: "시청자 미션 성공!" });
      await call("demo");
      await tab("방송 타임라인");
      await waitFor(
        async () =>
          (await state()).current.markers.some((m) => m.kind === "auto"),
        "demo highlight arrives",
      );
      await capture("timeline");
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
      });
      await tab("숫자 투표");
      const pollFixture = await state();
      pollFixture.poll.counts = [384, 231, 122, 63];
      let stopFixture = renderFixture(window, () => pollFixture);
      try {
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
        timerSeconds: null,
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
        await delay(500);
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
