// Runs the actual Electron app with an isolated profile; never uses real credentials.
const {
  app,
  BrowserWindow,
  globalShortcut,
  safeStorage,
  clipboard,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const profile = path.join(__dirname, "../release/smoke-profile");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
// Keep local checks independent of a running installed/development app.
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F9";
const timeout = setTimeout(() => {
  console.error("Desktop smoke timed out");
  app.exit(1);
}, 25000);
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const states = []; const off = window.assist.subscribe(s => states.push(s));
        const call = async (action, payload) => { const r = await window.assist.call(action, payload); if (!r.ok) throw new Error(r.error); };
        await call('state');
        if (states.at(-1).current) await call('stop');
        await call('start', { title: '테스트 방송 · 하이라이트 기록', offset: 125 });
        await call('mark', { label: '첫 번째 멋진 순간' });
        await call('demo');
        await call('poll-start', { question: '다음 게임은?', options: ['마인크래프트', '리그 오브 레전드'], mode: 'demo' });
        await new Promise(resolve => setTimeout(resolve, 3400));
        await call('state');
        const state = states.at(-1);
        off(); return { markers: state.current.markers, poll: state.poll, count: state.chatCount, text: document.body.innerText };
      })()`);
      assert.equal(result.markers.length, 2);
      assert.equal(result.markers[0].timecode, "00:02:05");
      assert.equal(result.markers[1].kind, "auto");
      assert.equal(result.poll.active, true);
      assert.ok(result.poll.counts.reduce((a, b) => a + b, 0) > 0);
      assert.ok(result.text.includes("첫 번째 멋진 순간"));
      const { CredentialVault } = require("../electron/oauth.cjs");
      const vaultFile = path.join(profile, "test-credentials.enc");
      const vault = new CredentialVault(vaultFile, safeStorage);
      vault.accounts = {
        test: { accessToken: "smoke-secret", refreshToken: "smoke-refresh" },
      };
      vault.save();
      assert.ok(!fs.readFileSync(vaultFile, "utf8").includes("smoke-secret"));
      const restored = new CredentialVault(vaultFile, safeStorage);
      restored.load();
      assert.equal(restored.accounts.test.accessToken, "smoke-secret");
      fs.unlinkSync(vaultFile);
      const previousClipboard = clipboard.readText();
      try {
        await window.webContents.executeJavaScript(
          "window.assist.call('poll-copy')",
        );
        assert.ok(clipboard.readText().includes("[투표] 다음 게임은?"));
        assert.ok(clipboard.readText().includes("1: 마인크래프트"));
      } finally {
        clipboard.writeText(previousClipboard);
      }
      const accountUi = await window.webContents
        .executeJavaScript(`(async () => {
        [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('플랫폼 연결')).click();
        await new Promise(resolve => setTimeout(resolve, 100));
        return { text: document.body.innerText, passwords: document.querySelectorAll('input[type=password]').length };
      })()`);
      assert.equal(accountUi.passwords, 0);
      assert.ok(accountUi.text.includes("YouTube 로그인"));
      assert.ok(accountUi.text.includes("치지직 연결"));
      assert.ok(
        globalShortcut.isRegistered(process.env.STREAMER_ASSIST_SHORTCUT),
      );
      if (process.argv.includes("--screenshot")) {
        window.show();
        window.focus();
        await new Promise(resolve => setTimeout(resolve, 300));
        fs.writeFileSync(
          path.join(__dirname, "../release/smoke.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
      }
      await window.webContents.executeJavaScript(
        `(async () => { await window.assist.call('poll-stop'); await window.assist.call('demo'); await window.assist.call('stop'); })()`,
      );
      window.close();
      assert.equal(window.isDestroyed(), false);
      assert.equal(window.isVisible(), false);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      clearTimeout(timeout);
      console.log(
        "PASS: actual React UI, preload IPC, offset marker, automatic highlight, demo votes, global shortcut, tray close, local persistence",
      );
      app.quit();
    } catch (error) {
      clearTimeout(timeout);
      console.error(error);
      app.exit(1);
    }
  });
});
require("../electron/main.cjs");
