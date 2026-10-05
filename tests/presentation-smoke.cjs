// Actual Electron flow, isolated profile and generated chat; never real accounts.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { assertLayout, waitFor, renderFixture } = require("./layout-check.cjs");
const profile = path.join(
  __dirname,
  "../release/presentation-profile-" + Date.now(),
);
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F14";
const deadline = setTimeout(() => {
  console.error("Presentation smoke timed out");
  app.exit(1);
}, 45000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    const js = (fn, ...args) =>
      window.webContents.executeJavaScript(
        "(" +
          fn.toString() +
          ")(" +
          args.map((value) => JSON.stringify(value)).join(",") +
          ")",
      );
    const call = async (action, payload) => {
      const reply = await js(
        (action, payload) => window.assist.call(action, payload),
        action,
        payload ?? {},
      );
      assert.ok(reply.ok, reply.error);
      return reply.data;
    };
    const state = () =>
      js(async () => {
        let snapshot;
        const off = window.assist.subscribe((value) => (snapshot = value));
        await window.assist.call("state");
        off();
        return snapshot;
      });
    const tab = async (label) => {
      await js(
        (label) =>
          [...document.querySelectorAll("nav button")]
            .find((button) => button.textContent.includes(label))
            .click(),
        label,
      );
      await delay(500);
    };
    const click = async (selector) => {
      await js(
        (selector) => document.querySelector(selector).click(),
        selector,
      );
      await delay(80);
    };
    const input = async (selector, value) => {
      await js(
        (selector, value) => {
          const element = document.querySelector(selector);
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        },
        selector,
        value,
      );
      await delay(60);
    };
    const capture = async (name) => {
      await delay(450);
      await assertLayout(window, name);
      fs.writeFileSync(
        path.join(__dirname, "../release/" + name + ".png"),
        (await window.webContents.capturePage()).toPNG(),
      );
    };
    try {
      window.setSize(900, 650);
      await tab("룰렛");
      assert.equal(
        await js(
          () => document.querySelectorAll(".roulette-item-list li").length,
        ),
        0,
      );
      await assertLayout(window, "empty roulette editor at minimum size");
      assert.equal(
        await js(
          () =>
            document.querySelector(".roulette-form-bottom .secondary").disabled,
        ),
        true,
      );
      await call("start", { title: "presentation" });
      await call("demo");
      await tab("통합 투표");
      await input('[aria-label="투표 질문"]', "다음에는 어떤 게임을 할까요?");
      for (const name of [
        "마인크래프트",
        "리그 오브 레전드",
        "발로란트",
        "스타듀 밸리",
      ]) {
        await input('[aria-label="새 선택지"]', name);
        await click('[aria-label="선택지 추가"]');
      }
      await js(() => {
        const startTransition = document.startViewTransition.bind(document);
        window.broadcastTransitions = [];
        document.startViewTransition = (update) => {
          const entry = {
            before: !!document.querySelector(".poll-editor"),
            after: false,
          };
          const transition = startTransition(async () => {
            await update();
            entry.after = !!document.querySelector(".broadcast-poll");
            window.broadcastTransitions.push(entry);
          });
          return transition;
        };
      });
      await click(".poll-editor > .primary");
      await waitFor(
        () => js(() => !!document.querySelector(".broadcast-poll")),
        "automatic broadcast view after starting",
      );
      await delay(500);
      assert.ok(
        await js(() =>
          window.broadcastTransitions.some(
            (entry) => entry.before && entry.after,
          ),
        ),
        "a view transition captures the editor before showing the broadcast view",
      );
      assert.equal(
        await js(() => document.querySelector(".broadcast-title h2").innerText),
        "다음에는 어떤 게임을 할까요?",
      );
      assert.equal(
        await js(() => !!document.querySelector(".poll-editor")),
        false,
      );
      const width = await js(() => ({
        rows: document.querySelector(".broadcast-rows").getBoundingClientRect()
          .width,
        content: document.querySelector(".content").clientWidth,
      }));
      assert.ok(width.rows > width.content * 0.85);
      await waitFor(
        async () => (await state()).poll.counts.reduce((a, b) => a + b, 0) > 0,
        "generated votes arrive",
      );
      await capture("presentation-vote");
      await click(".hide-results");
      assert.equal(
        await js(() =>
          document.querySelector(".hide-results").getAttribute("aria-pressed"),
        ),
        "true",
      );
      assert.ok(
        await js(() =>
          [...document.querySelectorAll(".broadcast-tally")].every((row) =>
            row.innerText.includes("결과를 가렸습니다"),
          ),
        ),
      );
      assert.equal(
        await js(() =>
          document
            .querySelector(".broadcast-track")
            .hasAttribute("aria-valuenow"),
        ),
        false,
      );
      await assertLayout(window, "hidden broadcast results");
      await click(".hide-results");
      await js(() =>
        [...document.querySelectorAll(".broadcast-controls button")]
          .find((button) => button.textContent.includes("투표 종료"))
          .click(),
      );
      await waitFor(
        async () => !(await state()).poll.active,
        "poll ends through broadcast controls",
      );
      await call("demo");
      await delay(600);
      const ended = await state();
      assert.ok(ended.poll.closedAt);
      const stoppedTime = await js(
        () => document.querySelector(".poll-elapsed time").innerText,
      );
      await delay(1100);
      assert.equal(
        await js(() => document.querySelector(".poll-elapsed time").innerText),
        stoppedTime,
      );
      await capture("presentation-final");
      assert.ok(
        await js(() => !!document.querySelector(".broadcast-row.winner")),
      );
      await click(".hide-results");
      assert.equal(
        await js(
          () => document.querySelectorAll(".broadcast-row.winner").length,
        ),
        0,
        "hiding final results also hides the winning row's glow",
      );
      await click(".hide-results");
      const liveFixture = {
        ...ended,
        poll: {
          ...ended.poll,
          id: "layout-live-fixture",
          active: true,
          mode: "chat",
          platforms: ["chzzk", "youtube"],
          question: "아주 긴 방송용 투표 질문 ".repeat(7),
          options: [
            "아주 긴 선택지 ".repeat(6),
            "두 번째 선택지 ".repeat(5),
            "세 번째 선택지",
            "네 번째 선택지",
          ],
          counts: [10000, 3250, 1000, 750],
          youtubeCounts: null,
          closedAt: undefined,
        },
        notice: "긴 플랫폼 안내 ".repeat(40),
      };
      const stopFixture = renderFixture(window, () => liveFixture);
      try {
        await delay(550);
        await capture("presentation-long");
        assert.equal(
          await js(() => document.querySelectorAll(".broadcast-row").length),
          4,
        );
        for (const rowCount of [3, 2]) {
          liveFixture.poll.options = liveFixture.poll.options.slice(
            0,
            rowCount,
          );
          liveFixture.poll.counts = liveFixture.poll.counts.slice(0, rowCount);
          await delay(120);
          await assertLayout(window, rowCount + " broadcast choices");
        }
        liveFixture.poll.mode = "native";
        liveFixture.poll.platforms = ["youtube"];
        liveFixture.poll.youtubeId = "fixture-native";
        liveFixture.poll.youtubeCounts = null;
        await delay(150);
        assert.ok(
          await js(() =>
            document.querySelector(".stage-hint").innerText.includes("득표수"),
          ),
        );
        assert.equal(
          await js(
            () => document.querySelector(".broadcast-option > span").innerText,
          ),
          "OPTION 1",
        );
        assert.ok(
          await js(() =>
            document
              .querySelector(".notice")
              .innerText.includes("긴 플랫폼 안내"),
          ),
        );
        await assertLayout(window, "native tally pending with long notice");
        liveFixture.poll.youtubeCounts = [200, 100];
        await delay(650);
        assert.equal(
          await js(() =>
            document
              .querySelector(".broadcast-stats strong")
              .innerText.split(" ")
              .join("")
              .replaceAll(String.fromCharCode(10), ""),
          ),
          "300표",
        );
        await capture("presentation-youtube");
      } finally {
        stopFixture();
        await call("state");
      }
      await delay(100);
      await js(() =>
        [...document.querySelectorAll(".broadcast-controls button")]
          .find((button) => button.textContent.includes("결과로 룰렛"))
          .click(),
      );
      await waitFor(
        () =>
          js(
            () =>
              !document.querySelector(".roulette-page").hidden &&
              !!document.querySelector(".roulette-stage"),
          ),
        "import ended poll into roulette",
      );
      await delay(550);
      assert.deepEqual(
        await js(() =>
          [...document.querySelectorAll(".roulette-legend li > span")].map(
            (element) => element.innerText,
          ),
        ),
        ended.poll.options,
      );
      await capture("presentation-roulette");
      await click(".roulette-stage-heading button");
      await delay(450);
      assert.deepEqual(
        await js(() =>
          [
            ...document.querySelectorAll(
              '.roulette-item-list input[type="number"]',
            ),
          ].map((element) => Number(element.value)),
        ),
        ended.poll.counts,
      );
      // Force exactly one nonzero choice: pointer and revealed result must agree.
      for (let index = 0; index < 4; index++)
        await input(
          '[aria-label="룰렛 가중치 ' + (index + 1) + '"]',
          index === 1 ? "4" : "0",
        );
      await click(".roulette-form-bottom .primary");
      await delay(500);
      await click(".roulette-spin");
      assert.equal(
        await js(() => document.querySelector(".roulette-spin").disabled),
        true,
      );
      assert.equal(
        await js(
          () =>
            document.querySelector(".roulette-stage-heading button").disabled,
        ),
        true,
      );
      await assertLayout(window, "spinning roulette at minimum size");
      await tab("방송 타임라인");
      await delay(500);
      await tab("룰렛");
      assert.equal(
        await js(() => document.querySelector(".roulette-spin").disabled),
        true,
      );
      const movingWheel = await js(() => {
        const wheel = document.querySelector(".roulette-disc");
        return {
          target: Number(wheel.dataset.wheelAngle),
          matrix: getComputedStyle(wheel).transform,
        };
      });
      assert.notEqual(movingWheel.matrix, "none");
      const matrix = movingWheel.matrix
        .match(/matrix\(([^)]+)\)/)[1]
        .split(",")
        .map(Number);
      const angle = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
      assert.ok(
        Math.abs(((angle + 360) % 360) - (movingWheel.target % 360)) > 0.01,
        "returning to the tool keeps the spin in progress",
      );
      await delay(4200);
      await waitFor(
        () =>
          js(
            () =>
              document.querySelector(".roulette-outcome").dataset
                .winnerIndex === "1",
          ),
        "spin finishes across tab changes",
      );
      const stoppedWheel = await js(() => ({
        rotation: Number(
          document.querySelector(".roulette-disc").dataset.wheelAngle,
        ),
        middle: Number(
          document.querySelector('[data-segment="1"]').dataset.middleAngle,
        ),
        winner: document.querySelector(".roulette-outcome strong").innerText,
      }));
      assert.equal(stoppedWheel.winner, ended.poll.options[1]);
      assert.ok(
        Math.abs((stoppedWheel.rotation + stoppedWheel.middle) % 360) < 0.0001,
      );
      await capture("presentation-winner");
      // Motion preference skips the spin, while the same weighted result applies.
      window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand(
        "Emulation.setEmulatedMedia",
        { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      );
      await click(".roulette-spin");
      await waitFor(
        () =>
          js(
            () =>
              document.querySelector(".roulette-outcome").dataset
                .winnerIndex === "1" &&
              !document.querySelector(".roulette-spin").disabled,
          ),
        "reduced-motion result",
      );
      window.webContents.debugger.detach();
      await click(".roulette-stage-heading button");
      await delay(450);
      // Long editable lists stay inside their panel; add field remains available.
      for (let i = 4; i < 12; i++) {
        await input('[aria-label="새 룰렛 항목"]', "추가 항목 " + (i + 1));
        await click('[aria-label="룰렛 항목 추가"]');
      }
      assert.equal(
        await js(
          () => document.querySelectorAll(".roulette-item-list li").length,
        ),
        12,
      );
      assert.ok(
        await js(
          () =>
            document.querySelector(".roulette-item-list").scrollHeight >
            document.querySelector(".roulette-item-list").clientHeight,
        ),
      );
      await assertLayout(
        window,
        "twelve roulette items remain inside the editor",
      );
      await js(() => {
        const list = document.querySelector(".roulette-item-list");
        list.scrollTop = list.scrollHeight;
      });
      assert.ok(
        await js(() => {
          const list = document
            .querySelector(".roulette-item-list")
            .getBoundingClientRect();
          const last = document
            .querySelector('[aria-label="룰렛 항목 12"]')
            .getBoundingClientRect();
          return last.top >= list.top && last.bottom <= list.bottom + 1;
        }),
        "the last row is reachable inside the list",
      );
      await click(".roulette-form-bottom .primary");
      await capture("presentation-twelve");
      await click(".roulette-stage-heading button");
      await delay(450);

      const reloadDone = new Promise((resolve) =>
        window.webContents.once("did-finish-load", resolve),
      );
      window.webContents.reload();
      await reloadDone;
      await delay(200);
      await tab("룰렛");
      assert.equal(
        await js(
          () => document.querySelectorAll(".roulette-item-list li").length,
        ),
        12,
      );
      assert.equal(
        await js(
          () => document.querySelector('[aria-label="룰렛 가중치 1"]').value,
        ),
        "0",
      );
      await assertLayout(window, "saved roulette editor");
      await call("stop");
      clearTimeout(deadline);
      console.log(
        "PASS: auto broadcast view, animated counts and bars, hidden results, frozen timer, full-size 2-4 choices, poll-to-roulette weights, zero-weight exclusion, matching pointer and result, spin across tabs, reduced motion, 12-item layout, saved roulette configuration",
      );
      app.quit();
    } catch (error) {
      clearTimeout(deadline);
      console.error(error);
      app.exit(1);
    }
  });
});
require("../electron/main.cjs");
