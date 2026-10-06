// Verify restored settings and true app exit with an isolated local profile.
const { app, globalShortcut, safeStorage } = require("electron");
const { RecordStore } = require("../electron/record-store.cjs");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { assertLayout, waitFor } = require("./layout-check.cjs");
const profile = path.join(
  __dirname,
  "../release/lifecycle-profile-" + Date.now(),
);
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
const restoredShortcut = "CommandOrControl+Alt+Shift+F11";
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F9";
process.argv.push("--hidden");
fs.writeFileSync(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    shortcut: restoredShortcut,
    trayEnabled: false,
  }),
);
let completed = false;
const timeout = setTimeout(() => {
  console.error("Settings lifecycle timed out");
  app.exit(1);
}, 15000);
const fail = (error) => {
  clearTimeout(timeout);
  console.error(error);
  app.exit(1);
};
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    try {
      assert.ok(
        window.isVisible(),
        "tray disabled must override hidden startup",
      );
      assert.ok(
        globalShortcut.isRegistered(restoredShortcut),
        "restore the user's saved global shortcut",
      );
      const run = (fn, ...args) =>
        window.webContents.executeJavaScript(
          "(" +
            fn.toString() +
            ")(" +
            args.map((value) => JSON.stringify(value)).join(",") +
            ")",
        );
      const call = async (action, payload) => {
        const result = await run(
          (action, payload) => window.assist.call(action, payload),
          action,
          payload || {},
        );
        assert.ok(result.ok, result.error);
      };
      await call("state");
      await call("start", { title: "설정 복원 검증" });
      await call("mark", { label: "트레이 없이 종료해도 저장" });
      window.show();
      window.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await call("shortcut-capture");
      assert.equal(globalShortcut.isRegistered(restoredShortcut), false);
      window.hide();
      await waitFor(
        () => globalShortcut.isRegistered(restoredShortcut),
        "focus loss restores the registered key",
      );
      window.show();
      window.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await call("shortcut-capture");
      const loaded = new Promise((resolve) =>
        window.webContents.once("did-finish-load", resolve),
      );
      window.webContents.reload();
      await loaded;
      await waitFor(
        () => globalShortcut.isRegistered(restoredShortcut),
        "reload cancels key capture",
      );
      await call("state");
      await run(() =>
        [...document.querySelectorAll("nav button")]
          .find((button) => button.textContent.includes("설정"))
          .click(),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        await run(() =>
          document
            .querySelector('[aria-label="시스템 트레이 사용"]')
            .getAttribute("aria-checked"),
        ),
        "false",
      );
      await assertLayout(window, "restored general settings");
      app.once("will-quit", () => {
        try {
          const saved = new RecordStore(profile, safeStorage).load();
          assert.equal(
            saved.current.markers[0].label,
            "트레이 없이 종료해도 저장",
          );
          assert.equal(
            JSON.parse(
              fs.readFileSync(path.join(profile, "preferences.json"), "utf8"),
            ).trayEnabled,
            false,
          );
          completed = true;
          clearTimeout(timeout);
          console.log(
            "PASS: saved shortcut and tray settings restore, hidden startup remains reachable, capture cancellation on blur/reload, tray disabled closes and persists before exit",
          );
        } catch (error) {
          fail(error);
        }
      });
      // Closing must actually reach will-quit, rather than leave a hidden background app.
      void run(() =>
        document.querySelector('[aria-label="창 닫기"]').click(),
      ).catch((error) => {
        if (!completed) fail(error);
      });
    } catch (error) {
      fail(error);
    }
  });
});
require("../electron/main.cjs");
