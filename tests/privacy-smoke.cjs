const { app, safeStorage } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { RecordStore } = require("../electron/record-store.cjs");
const { assertLayout, waitFor, renderFixture } = require("./layout-check.cjs");
const profile = path.join(
  __dirname,
  "../release/privacy-profile-" + Date.now(),
);
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F16";
fs.writeFileSync(
  path.join(profile, "sessions.json"),
  JSON.stringify({
    sessions: [
      {
        id: "legacy",
        title: "legacy-private-title",
        startedAt: 1000,
        endedAt: 2000,
        markers: [],
      },
    ],
  }),
);
const deadline = setTimeout(() => {
  console.error("Privacy smoke timed out");
  app.exit(1);
}, 20000);
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
    const call = async (a, p = {}) => {
      const r = await js((a, p) => window.assist.call(a, p), a, p);
      assert.ok(r.ok, r.error);
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
      await delay(100);
    };
    try {
      window.webContents.setBackgroundThrottling(false);
      window.setSize(900, 650);
      await delay(350);
      await js(() => {
        localStorage.setItem(
          "streamer-assist-roulette-items",
          JSON.stringify([
            { name: "saved-one", weight: 1 },
            { name: "saved-two", weight: 2 },
          ]),
        );
        localStorage.setItem("streamer-assist-roulette-title", "saved-title");
      });
      await js(() =>
        [...document.querySelectorAll("nav button")]
          .find((b) => b.textContent.includes("설정"))
          .click(),
      );
      await delay(450);
      await js(() =>
        [...document.querySelectorAll(".settings-tabs button")]
          .find((b) => b.textContent.includes("정보·데이터"))
          .click(),
      );
      await delay(100);
      await assertLayout(window, "information settings at minimum size");
      await click(".privacy-card .secondary");
      assert.ok(
        await js(() =>
          document
            .querySelector(".privacy-document")
            .innerText.includes("Windows 보안 저장소"),
        ),
      );
      await assertLayout(window, "privacy dialog at minimum size");
      assert.ok(
        await js(
          () =>
            document.querySelector(".privacy-document").scrollHeight >
            document.querySelector(".privacy-document").clientHeight,
        ),
      );
      await click('[aria-label="안내 닫기"]');
      await waitFor(
        () => fs.existsSync(path.join(profile, "records.enc")),
        "legacy records migrate to encrypted storage",
      );
      assert.equal(fs.existsSync(path.join(profile, "sessions.json")), false);
      assert.ok(
        !fs
          .readFileSync(path.join(profile, "records.enc"), "utf8")
          .includes("legacy-private-title"),
      );
      const noConfirm = await js(() => window.assist.call("history-clear"));
      assert.equal(noConfirm.ok, false);
      await call("start", { title: "active guard" });
      assert.equal(
        (await js(() => window.assist.call("history-clear", { confirm: true })))
          .ok,
        false,
      );
      await call("stop");
      await click(".data-card .danger-action");
      await click(".information-dialog-actions .secondary:first-child");
      assert.ok((await state()).sessions.length >= 1);
      await click(".data-card .danger-action");
      await click(".information-dialog-actions .danger-action");
      await waitFor(
        async () => (await state()).sessions.length === 0,
        "confirmed history deletion",
      );
      assert.equal(
        new RecordStore(profile, safeStorage).load().sessions.length,
        0,
      );
      assert.equal(
        fs.readdirSync(profile).filter((n) => n.startsWith("records-legacy-"))
          .length,
        0,
      );
      await click(".data-card .information-actions .secondary:last-child");
      await click(".information-dialog-actions .danger-action");
      assert.equal(
        await js(
          () =>
            JSON.parse(
              localStorage.getItem("streamer-assist-roulette-items") || "[]",
            ).length,
        ),
        0,
      );
      const snapshot = await state();
      snapshot.settings.startupManagedByWindows = true;
      snapshot.settings.startupAvailable = false;
      const stopFixture = renderFixture(window, () => snapshot);
      try {
        await js(() =>
          [...document.querySelectorAll(".settings-tabs button")]
            .find((b) => b.textContent.includes("일반"))
            .click(),
        );
        await delay(150);
        assert.equal(
          await js(() => !!document.querySelector(".startup-system-button")),
          true,
        );
        assert.equal(
          await js(
            () =>
              !!document.querySelector(
                '[aria-label="Windows 로그인 시 자동 시작"]',
              ),
          ),
          false,
        );
        await assertLayout(window, "MSIX Windows-managed startup view");
      } finally {
        stopFixture();
      }
      await js(() =>
        [...document.querySelectorAll(".settings-tabs button")]
          .find((b) => b.textContent.includes("정보·데이터"))
          .click(),
      );
      await delay(150);
      fs.writeFileSync(
        path.join(__dirname, "../release/privacy-settings.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      clearTimeout(deadline);
      console.log(
        "PASS: privacy document and internal scroll, encrypted migration, delete confirmation and active guards, recovery cleanup, roulette reset, MSIX startup control, no layout overflow",
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
