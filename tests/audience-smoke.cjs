// Exercise the four-tool UI in an isolated profile, without real accounts/payments.
const { app } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { assertLayout, waitFor, renderFixture, settleUI, rendered } = require("./layout-check.cjs");
require("./demo-clock.cjs").installDemoClock();
const profile = process.env.STREAMER_ASSIST_TEST_PROFILE || path.join(
  __dirname,
  "../release/audience-profile-" + Date.now(),
);
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F15";
const deadline = setTimeout(() => {
  console.error("Audience smoke timed out");
  app.exit(1);
}, 65000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.on("browser-window-created", (_event, window) => {
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
      const r = await js((a, p) => window.assist.call(a, p), action, payload);
      assert.ok(r.ok, r.error);
      return r.data;
    };
    const state = () =>
      js(async () => {
        let value;
        const off = window.assist.subscribe((s) => (value = s));
        await window.assist.call("state");
        off();
        return value;
      });
    const click = async (selector) => {
      await js((s) => document.querySelector(s).click(), selector);
      await settleUI(window);
    };
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
    const input = async (selector, value) => {
      await js(
        (s, v) => {
          const element = document.querySelector(s);
          Object.getOwnPropertyDescriptor(
            element.tagName === "SELECT"
              ? HTMLSelectElement.prototype
              : HTMLInputElement.prototype,
            "value",
          ).set.call(element, v);
          element.dispatchEvent(
            new Event(element.tagName === "SELECT" ? "change" : "input", {
              bubbles: true,
            }),
          );
        },
        selector,
        value,
      );
      await rendered(window);
    };
    const capture = async (name) => {
      await settleUI(window);
      await assertLayout(window, name);
      if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") fs.writeFileSync(
        path.join(__dirname, "../release/" + name + ".png"),
        (await window.webContents.capturePage()).toPNG(),
      );
    };
    try {
      window.webContents.setBackgroundThrottling(false);
      window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand(
        "Emulation.setEmulatedMedia",
        {
          features: [
            { name: "prefers-reduced-motion", value: "no-preference" },
          ],
        },
      );
      await delay(150);
      window.setSize(900, 650);
      assert.deepEqual(
        await js(() =>
          [...document.querySelectorAll(".tool-card h2")].map(
            (h) => h.textContent,
          ),
        ),
        ["시청자 추첨", "숫자 투표", "도네 투표", "룰렛"],
      );
      await capture("audience-home");
      await click('[data-tool="raffle"]');
      assert.equal(
        await js(
          () => document.querySelector('[aria-label="추첨 제목"]').value,
        ),
        "",
      );
      assert.equal(
        await js(
          () =>
            document.querySelectorAll(".raffle-page .audience-platform").length,
        ),
        0,
      );
      await assertLayout(window, "raffle without connected accounts");
      await call("start", { title: "audience testing" });
      await call("demo");
      await input('[aria-label="추첨 제목"]', "오늘 함께할 시청자");
      await click(".raffle-page .segmented-buttons button:nth-child(2)");
      await input('[aria-label="추첨 참여 키워드"]', "!입장");
      await click(".raffle-filters label:first-child input");
      await click(".raffle-page .audience-timer .check-label input");
      await input('.raffle-page [aria-label="자동 종료 시간"]', "60");
      await capture("audience-raffle-settings");
      await click(".raffle-page .audience-form-bottom .primary");
      await waitFor(
        () => js(() => !!document.querySelector(".raffle-stage")),
        "automatic recruitment view",
      );
      await waitFor(
        async () => (await state()).audience.raffle.candidateCount === 4,
        "keyword subscribers enter once",
      );
      assert.equal((await state()).audience.raffle.eligibleCount, 4);
      await capture("audience-raffle-live");
      await click(".raffle-draw");
      const first = (await state()).audience.raffle.latestDraw;
      assert.ok(first);
      assert.equal(
        await js(() => document.querySelector(".raffle-draw").disabled),
        true,
      );
      assert.equal(
        await js(() => !!document.querySelector(".raffle-winners")),
        false,
      );
      await tab("숫자 투표");
      await tab("시청자 추첨");
      await waitFor(
        () => js(() => !!document.querySelector(".raffle-pick.revealed")),
        "winner revealed after changing tabs",
      );
      assert.equal(
        await js(
          () =>
            document.querySelector(".raffle-slot-name > span:nth-child(2)")
              .textContent,
        ),
        first.winner.name,
      );
      await capture("audience-raffle-winner");
      await js(() =>
        [
          ...document.querySelectorAll(
            ".raffle-stage .broadcast-controls button",
          ),
        ]
          .find((b) => b.textContent.includes("모집 종료"))
          .click(),
      );
      await waitFor(
        async () => !(await state()).audience.raffle.active,
        "recruitment ends",
      );
      await window.webContents.debugger.sendCommand(
        "Emulation.setEmulatedMedia",
        { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      );
      await click(".raffle-draw");
      const second = (await state()).audience.raffle.latestDraw;
      assert.notEqual(second.winner.key, first.winner.key);
      assert.equal(second.endsAt, second.startedAt);
      await click(".raffle-stage .roulette-stage-heading button");
      await input('.raffle-page [aria-label="자동 종료 시간"]', "1");
      await click(".raffle-page .audience-form-bottom .primary");
      await waitFor(
        async () => !(await state()).audience.raffle.active,
        "recruitment timer ends automatically",
      );
      const timed = (await state()).audience.raffle;
      assert.equal(timed.closedAt, timed.endsAt);
      assert.equal(timed.draws.length, 0);
      await window.webContents.debugger.sendCommand(
        "Emulation.setEmulatedMedia",
        {
          features: [
            { name: "prefers-reduced-motion", value: "no-preference" },
          ],
        },
      );
      await tab("도네 투표");
      assert.equal(
        await js(
          () => document.querySelector('[aria-label="도네 투표 질문"]').value,
        ),
        "",
      );
      assert.equal(
        await js(
          () => document.querySelectorAll(".donation-options li").length,
        ),
        0,
      );
      await input('[aria-label="도네 투표 질문"]', "다음 콘텐츠를 골라주세요");
      for (const name of ["마인크래프트", "발로란트", "리그 오브 레전드"]) {
        await input('[aria-label="새 도네 선택지"]', name);
        await click('[aria-label="도네 선택지 추가"]');
        assert.equal(
          await js(() => document.activeElement.getAttribute("aria-label")),
          "새 도네 선택지",
        );
      }
      await input('[aria-label="새 도네 선택지"]', "스타듀 밸리");
      await js(() =>
        document.querySelector('[aria-label="새 도네 선택지"]').dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            isComposing: true,
            bubbles: true,
          }),
        ),
      );
      assert.equal(
        await js(
          () => document.querySelectorAll(".donation-options li").length,
        ),
        3,
      );
      await js(() =>
        document
          .querySelector('[aria-label="새 도네 선택지"]')
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          ),
      );
      await settleUI(window);
      assert.equal(
        await js(
          () => document.querySelectorAll(".donation-options li").length,
        ),
        4,
      );
      await click(".donation-config .segmented-buttons button:nth-child(2)");
      await input('[aria-label="도네 투표 접두어"]', "!도네");
      await click('.donation-config .poll-timer-settings input[type="checkbox"]');
      await input('.donation-config [aria-label="자동 종료 분"]', "2");
      await input('.donation-config [aria-label="자동 종료 초"]', "30");
      await capture("audience-donation-settings");
      await click(".donation-editor .audience-form-bottom .primary");
      await waitFor(
        () =>
          js(() => !!document.querySelector(".donation-page .broadcast-poll")),
        "automatic donation presentation",
      );
      await waitFor(
        async () => (await state()).audience.donationPoll.acceptedEvents >= 4,
        "generated paid messages counted",
      );
      assert.equal(
        (await state()).poll,
        null,
        "donation events have independent vote storage",
      );
      assert.equal(
        await js(
          () =>
            document.querySelector(".donation-page .broadcast-option > span")
              .textContent,
        ),
        "!도네1",
      );
      await capture("audience-donation-live");
      const donationTimer = (await state()).audience.donationPoll;
      assert.equal(donationTimer.endsAt - donationTimer.openedAt, 150000);
      assert.ok(await js(() => document.querySelector('.donation-page .poll-elapsed')?.textContent.includes("남은 시간")));
      await click(".donation-page .broadcast-toolbar button");
      assert.equal(
        await js(
          () =>
            document.querySelector('[aria-label="도네 투표 금액"]').disabled,
        ),
        true,
      );
      assert.equal(
        await js(
          () =>
            document.querySelector('[aria-label="도네 투표 접두어"]').disabled,
        ),
        true,
      );
      await click(".donation-editor .audience-form-bottom .primary");
      await js(() =>
        [
          ...document.querySelectorAll(
            ".donation-page .broadcast-controls button",
          ),
        ]
          .find((b) => b.textContent.includes("투표 종료"))
          .click(),
      );
      await waitFor(
        async () => !(await state()).audience.donationPoll.active,
        "donation voting ends",
      );
      const stopped = (await state()).audience.donationPoll;
      assert.ok(
        stopped.counts.every(
          (c, i) => c === ((i + 1) * stopped.acceptedEvents) / 4,
        ),
      );
      await js(() =>
        [
          ...document.querySelectorAll(
            ".donation-page .broadcast-controls button",
          ),
        ]
          .find((b) => b.textContent.includes("결과로 룰렛"))
          .click(),
      );
      await waitFor(
        () => js(() => !!document.querySelector(".roulette-stage")),
        "paid result transfers to roulette",
      );
      await click(".roulette-stage .roulette-stage-heading button");
      assert.deepEqual(
        await js(() =>
          [
            ...document.querySelectorAll(
              '.roulette-item-list input[type="number"]',
            ),
          ].map((e) => Number(e.value)),
        ),
        stopped.counts,
      );
      await capture("audience-donation-roulette");
      await tab("도네 투표");
      await click(".donation-page .broadcast-toolbar button");
      await input('.donation-config [aria-label="자동 종료 분"]', "0");
      await input('.donation-config [aria-label="자동 종료 초"]', "0");
      assert.equal(await js(() => document.querySelector('.donation-editor .audience-form-bottom .primary').disabled), true, "zero duration cannot start donation voting");
      await input('.donation-config [aria-label="자동 종료 초"]', "1");
      await click(".donation-editor .audience-form-bottom .primary");
      await waitFor(async () => !(await state()).audience.donationPoll.active, "donation timer automatically finishes");
      const timedDonation = (await state()).audience.donationPoll;
      assert.equal(timedDonation.closedAt, timedDonation.endsAt);
      await tab("숫자 투표");
      await input('[aria-label="투표 질문"]', "자동으로 끝나는 숫자 투표");
      for (const option of ["첫 번째", "두 번째"]) {
        await input('[aria-label="새 선택지"]', option);
        await click('[aria-label="선택지 추가"]');
      }
      await click('.poll-editor .poll-timer-settings input[type="checkbox"]');
      await input('.poll-editor [aria-label="자동 종료 분"]', "1");
      await input('.poll-editor [aria-label="자동 종료 초"]', "60");
      assert.equal(await js(() => document.querySelector('.poll-editor > .primary').disabled), true, "seconds must remain within 0–59");
      await input('.poll-editor [aria-label="자동 종료 분"]', "0");
      await input('.poll-editor [aria-label="자동 종료 초"]', "1");
      await click('.poll-editor > .primary');
      await waitFor(async () => (await state()).poll?.active === false, "number poll timer automatically finishes");
      const timedNumber = (await state()).poll;
      assert.equal(timedNumber.endsAt - timedNumber.openedAt, 1000);
      assert.equal(timedNumber.closedAt, timedNumber.endsAt);
      assert.equal((await state()).current.polls.filter(p => p.id === timedNumber.id).length, 1);
      // Render connected-account/currency and long-name fixtures without contacting APIs.
      const fixture = await state();
      fixture.demo = false;
      fixture.auth.accounts.chzzk.connected = true;
      fixture.auth.accounts.youtube.connected = true;
      fixture.connections = { chzzk: "연결됨", youtube: "연결됨" };
      fixture.audience.raffle = {
        ...timed,
        id: "long-raffle",
        title: "아주 긴 시청자 추첨 제목 ".repeat(5),
        candidateCount: 10000,
        eligibleCount: 9999,
        candidates: Array.from({ length: 100 }, (_, i) => ({
          key: "p" + i,
          userId: "p" + i,
          platform: i % 2 ? "youtube" : "chzzk",
          name: "아주 긴 시청자 닉네임 ".repeat(10),
          subscriber: true,
        })),
        latestDraw: {
          ...first,
          id: "long-winner",
          winner: { ...first.winner, name: "아주 긴 당첨자 이름 ".repeat(10) },
          endsAt: 1,
        },
        draws: [],
      };
      const stopFixture = renderFixture(window, () => fixture);
      try {
        await tab("도네 투표");
        await click(".donation-page .broadcast-toolbar button");
        await settleUI(window);
        assert.equal(
          await js(
            () =>
              document.querySelectorAll(".donation-page .audience-platform")
                .length,
          ),
          2,
        );
        await input('[aria-label="도네 투표 통화"]', "USD");
        assert.equal(
          await js(
            () =>
              document.querySelectorAll(".donation-page .audience-platform")
                .length,
          ),
          1,
        );
        assert.equal(
          await js(() =>
            document
              .querySelector(".donation-page .audience-platform")
              .textContent.trim(),
          ),
          "YouTube",
        );
        await assertLayout(window, "currency and connected platform selector");
        await tab("시청자 추첨");
        await capture("audience-raffle-long");
        await click(".theme-toggle");
        await capture("audience-raffle-light");
        await click(".theme-toggle");
        window.setSize(1240, 850);
        await capture("audience-raffle-large");
      } finally {
        stopFixture();
      }
      await call("stop");
      window.webContents.debugger.detach();
      clearTimeout(deadline);
      console.log(
        "PASS: four-tool home, empty guides, platform filters, keyword and subscriber recruitment, secure draw animation across tabs, previous winner exclusion, automatic deadline, independent paid votes, amount multiplier, frozen settings, IME and add focus, donation-to-roulette, long names, dark/light, no page scroll",
      );
      app.quit();
    } catch (error) {
      clearTimeout(deadline);
      console.error(error);
      console.error(
        await js(() => ({
          visibility: document.visibilityState,
          text: document.querySelector("main").innerText.slice(0, 1400),
        })),
      );
      app.exit(1);
    }
  });
});
require("../electron/main.cjs");
