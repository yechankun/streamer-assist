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
const { assertLayout, waitFor, renderFixture } = require("./layout-check.cjs");
const profile = path.join(__dirname, "../release/smoke-profile-" + Date.now());
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
        await call('poll-start', { question: '다음 게임은?', options: ['마인크래프트', '리그 오브 레전드'], platforms: ['demo'] });
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
      await waitFor(
        () =>
          window.webContents.executeJavaScript(
            "document.body.innerText.includes('첫 번째 멋진 순간')",
          ),
        "manual marker rendered after the IPC snapshot",
      );
      await assertLayout(window, "timeline at default size");
      assert.ok(
        window.getBounds().height - window.getContentBounds().height < 24,
        "native title bar must be removed",
      );
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
        assert.ok(clipboard.readText().includes("!투표1: 마인크래프트"));
      } finally {
        clipboard.writeText(previousClipboard);
      }
      const accountUi = await window.webContents
        .executeJavaScript(`(async () => {
        [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('설정')).click();
        await new Promise(resolve => setTimeout(resolve, 60));
        [...document.querySelectorAll('.settings-tabs button')].find(b => b.textContent.includes('플랫폼 연결')).click();
        await new Promise(resolve => setTimeout(resolve, 100));
        return { text: document.body.innerText, passwords: document.querySelectorAll('input[type=password]').length };
      })()`);
      assert.equal(accountUi.passwords, 0);
      assert.ok(accountUi.text.includes("YouTube 로그인"));
      assert.ok(accountUi.text.includes("치지직 연결"));
      assert.ok(
        globalShortcut.isRegistered(process.env.STREAMER_ASSIST_SHORTCUT),
      );
      await assertLayout(window, "settings at default size");
      window.setSize(900, 650);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await assertLayout(window, "settings at minimum size");
      await window.webContents.executeJavaScript(
        "[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('통합 투표')).click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
      await assertLayout(window, "broadcast poll at minimum size");
      await window.webContents.executeJavaScript(
        "document.querySelector('.broadcast-toolbar button').click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 450));
      const optionUi = async () =>
        window.webContents.executeJavaScript(
          "({ options: [...document.querySelectorAll('.option-row input')].map(input => input.value), draft: document.querySelector('[aria-label=\"새 선택지\"]').value, focused: document.activeElement?.getAttribute('aria-label') })",
        );
      const setDraft = async (text) => {
        await window.webContents.executeJavaScript(
          "(" +
            ((value) => {
              const input = document.querySelector('[aria-label="새 선택지"]');
              Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
              ).set.call(input, value);
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.focus();
            }).toString() +
            ")(" +
            JSON.stringify(text) +
            ")",
        );
        await new Promise((resolve) => setTimeout(resolve, 40));
      };
      assert.deepEqual((await optionUi()).options, []);
      assert.equal((await optionUi()).draft, "");
      const questionUi = await window.webContents.executeJavaScript(
        "(" +
          (() => {
            const input = document.querySelector('[aria-label="투표 질문"]');
            return { value: input.value, placeholder: input.placeholder };
          }).toString() +
          ")()",
      );
      assert.equal(questionUi.value, "");
      assert.ok(questionUi.placeholder.includes("예:"));
      for (const text of ["마인크래프트", "리그 오브 레전드"]) {
        await setDraft(text);
        await window.webContents.executeJavaScript(
          "document.querySelector('.option-add button').click()",
        );
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal((await optionUi()).focused, "새 선택지");
        assert.equal((await optionUi()).draft, "");
      }
      await setDraft("세 번째 게임");
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"선택지 추가\"]').click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual((await optionUi()).options, [
        "마인크래프트",
        "리그 오브 레전드",
        "세 번째 게임",
      ]);
      assert.equal((await optionUi()).focused, "새 선택지");
      assert.equal((await optionUi()).draft, "");
      await setDraft("네 번째 게임");
      // Enter during IME composition must finish composition without adding a row.
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"새 선택지\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))",
      );
      assert.equal((await optionUi()).options.length, 3);
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"새 선택지\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))",
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal((await optionUi()).options.length, 4);
      assert.equal((await optionUi()).focused, "새 선택지");
      assert.equal((await optionUi()).draft, "");
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('[aria-label=\"선택지 추가\"]').disabled",
        ),
        true,
      );
      await assertLayout(window, "four editable poll options at minimum size");
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"선택지 3 삭제\"]').click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.deepEqual((await optionUi()).options, [
        "마인크래프트",
        "리그 오브 레전드",
        "네 번째 게임",
      ]);
      assert.equal((await optionUi()).focused, "새 선택지");
      await setDraft("마인크래프트");
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"선택지 추가\"]').click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal((await optionUi()).options.length, 3);
      await setDraft("");
      const js = (fn, ...args) =>
        window.webContents.executeJavaScript(
          "(" +
            fn.toString() +
            ")(" +
            args.map((value) => JSON.stringify(value)).join(",") +
            ")",
        );
      const setInput = async (selector, value) => {
        await js(
          (selector, value) => {
            const input = document.querySelector(selector);
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          },
          selector,
          value,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      await window.webContents.executeJavaScript(
        "window.assist.call('poll-stop')",
      );
      await new Promise((resolve) => setTimeout(resolve, 70));
      await js(() => {
        document.querySelector(".poll-help").open = true;
      });
      assert.equal(
        await js(
          () => document.querySelector('[aria-label="채팅 투표 접두어"]').value,
        ),
        "!투표",
      );
      await setInput('[aria-label="투표 질문"]', "선택 방식 확인");
      await setInput('[aria-label="채팅 투표 접두어"]', " wrong");
      assert.equal(
        await js(
          () => document.querySelector(".poll-editor > .primary").disabled,
        ),
        true,
      );
      await setInput('[aria-label="채팅 투표 접두어"]', "#.");
      await assertLayout(window, "custom prefix popup at minimum size");
      await js(() => {
        document.querySelector(".poll-help").open = false;
        document.querySelector(".poll-editor > .primary").click();
      });
      await waitFor(
        () => js(() => !!document.querySelector(".broadcast-poll")),
        "start via actual UI with custom command",
      );
      const customPoll = await js(async () => {
        let state;
        const off = window.assist.subscribe((value) => (state = value));
        await window.assist.call("state");
        off();
        return state.poll;
      });
      assert.equal(customPoll.chatPrefix, "#.");
      assert.equal(customPoll.votePolicy, "latest");
      await js(() =>
        document.querySelector(".broadcast-toolbar button").click(),
      );
      await new Promise((resolve) => setTimeout(resolve, 450));
      await js(() => {
        document.querySelector(".poll-help").open = true;
      });
      assert.equal(
        await js(
          () =>
            document.querySelector('[aria-label="채팅 투표 접두어"]').disabled,
        ),
        true,
      );
      assert.equal(
        await js(
          () => document.querySelector('[aria-label="채팅 투표 접두어"]').value,
        ),
        "#.",
      );
      await js(() => {
        document.querySelector(".poll-help").open = false;
      });
      await window.webContents.executeJavaScript(
        "[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('설정')).click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      await assertLayout(window, "general settings at minimum size");
      window.show();
      window.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"기록 단축키 변경\"]').click()",
      );
      await waitFor(
        () =>
          !globalShortcut.isRegistered(process.env.STREAMER_ASSIST_SHORTCUT),
        "old shortcut released for capture",
      );
      await waitFor(
        () =>
          window.webContents.executeJavaScript(
            "document.querySelector('.shortcut-recorder').getAttribute('aria-pressed') === 'true'",
          ),
        "capture UI ready",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await window.webContents.executeJavaScript(
        "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))",
      );
      await waitFor(
        () => globalShortcut.isRegistered(process.env.STREAMER_ASSIST_SHORTCUT),
        "Escape restores shortcut",
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"기록 단축키 변경\"]').click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      await window.webContents.executeJavaScript(
        "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F11', code: 'F11', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true }))",
      );
      const changedShortcut = "CommandOrControl+Alt+Shift+F11";
      await waitFor(
        () => globalShortcut.isRegistered(changedShortcut),
        "pressed keys register new global shortcut",
      );
      assert.equal(
        globalShortcut.isRegistered(process.env.STREAMER_ASSIST_SHORTCUT),
        false,
      );
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(profile, "preferences.json"), "utf8"),
        ).shortcut,
        changedShortcut,
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('.shortcut-recorder').click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await window.webContents.executeJavaScript(
        "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'KeyK', ctrlKey: true, altKey: true, shiftKey: true, isComposing: true, bubbles: true }))",
      );
      await waitFor(
        () => globalShortcut.isRegistered("CommandOrControl+Alt+Shift+K"),
        "physical letter key recognized with Korean IME",
      );
      await window.webContents.executeJavaScript(
        "window.assist.call('shortcut-set', { shortcut: 'CommandOrControl+Alt+Shift+F11' })",
      );
      // A binding owned by another feature must not replace the user's saved key.
      const conflictShortcut = "CommandOrControl+Alt+Shift+F12";
      assert.ok(globalShortcut.register(conflictShortcut, () => {}));
      const conflictResult = await window.webContents.executeJavaScript(
        "window.assist.call('shortcut-set', { shortcut: 'CommandOrControl+Alt+Shift+F12' })",
      );
      assert.equal(conflictResult.ok, false);
      assert.ok(globalShortcut.isRegistered(changedShortcut));
      globalShortcut.unregister(conflictShortcut);
      const invalidResult = await window.webContents.executeJavaScript(
        "window.assist.call('shortcut-set', { shortcut: 'A' })",
      );
      assert.equal(invalidResult.ok, false);
      assert.ok(globalShortcut.isRegistered(changedShortcut));
      await window.webContents.executeJavaScript(
        "window.assist.call('shortcut-set', { shortcut: " +
          JSON.stringify(process.env.STREAMER_ASSIST_SHORTCUT) +
          " })",
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"시스템 트레이 사용\"]').click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(profile, "preferences.json"), "utf8"),
        ).trayEnabled,
        false,
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('[aria-label=\"시스템 트레이 사용\"]').getAttribute('aria-checked')",
        ),
        "false",
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelector('[aria-label=\"창 닫기\"]').title",
        ),
        "앱 종료",
      );
      await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"시스템 트레이 사용\"]').click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(profile, "preferences.json"), "utf8"),
        ).trayEnabled,
        true,
      );
      // End the generated poll before editable fixtures: a periodic real state
      // update must not briefly lock the fixture's form as an active poll.
      await window.webContents.executeJavaScript(
        "window.assist.call('poll-stop')",
      );
      // Stress renderer fixtures without opening browsers or changing real credentials.
      const actualState = await window.webContents.executeJavaScript(
        "(async () => { let value; const off = window.assist.subscribe(state => value = state); await window.assist.call('state'); off(); return value; })()",
      );
      await window.webContents.executeJavaScript(
        "[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('통합 투표')).click()",
      );
      const fixtureState = {
        ...actualState,
        demo: false,
        poll: null,
        notice: "",
        connections: { chzzk: "연결됨", youtube: "연결됨" },
        auth: {
          ...actualState.auth,
          accounts: {
            chzzk: { configured: true, connected: false, name: "" },
            youtube: { configured: true, connected: false, name: "" },
          },
        },
      };
      const stopFixture = renderFixture(window, () => fixtureState);
      const toggleStates = () =>
        window.webContents.executeJavaScript(
          "(" +
            (() =>
              [...document.querySelectorAll(".poll-platform-toggle")].map(
                (button) => ({
                  platform: button.dataset.platform,
                  enabled: button.getAttribute("aria-pressed"),
                }),
              )).toString() +
            ")()",
        );
      const clickPlatform = (platform) =>
        window.webContents.executeJavaScript(
          "(" +
            ((platform) =>
              document
                .querySelector('[data-platform="' + platform + '"]')
                .click()).toString() +
            ")(" +
            JSON.stringify(platform) +
            ")",
        );
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.deepEqual(await toggleStates(), []);
        await assertLayout(window, "poll with no linked platforms");
        assert.ok(
          await window.webContents.executeJavaScript(
            "!!document.querySelector('.poll-connect-guide')",
          ),
        );
        await window.webContents.executeJavaScript(
          "document.querySelector('.poll-connect-guide button').click()",
        );
        await new Promise((resolve) => setTimeout(resolve, 80));
        assert.ok(
          await window.webContents.executeJavaScript(
            "!!document.querySelector('#settings-platforms')",
          ),
        );
        await window.webContents.executeJavaScript(
          "[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('통합 투표')).click()",
        );
        fixtureState.auth.accounts.chzzk.connected = true;
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.deepEqual(await toggleStates(), [
          { platform: "chzzk", enabled: "true" },
        ]);
        await clickPlatform("chzzk");
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.deepEqual(await toggleStates(), [
          { platform: "chzzk", enabled: "false" },
        ]);
        await assertLayout(window, "poll with one platform turned off");
        await clickPlatform("chzzk");
        fixtureState.auth.accounts.youtube.connected = true;
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.deepEqual(await toggleStates(), [
          { platform: "chzzk", enabled: "true" },
          { platform: "youtube", enabled: "true" },
        ]);
        await js(() => {
          document.querySelector(".poll-help").open = true;
        });
        assert.equal(
          await js(() =>
            document
              .querySelector('[aria-label="YouTube 참여 방식"] button')
              .getAttribute("aria-pressed"),
          ),
          "true",
        );
        await js(() =>
          document
            .querySelector('[aria-label="채팅 입력 형식"] button:last-child')
            .click(),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(
          await js(
            () =>
              document.querySelector('[aria-label="채팅 투표 접두어"]').value,
          ),
          "",
        );
        await js(() =>
          document
            .querySelector('[aria-label="채팅 입력 형식"] button:nth-child(2)')
            .click(),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(
          await js(
            () =>
              document.querySelector('[aria-label="채팅 투표 접두어"]').value,
          ),
          "!",
        );
        await js(() =>
          document
            .querySelector('[aria-label="채팅 입력 형식"] button:first-child')
            .click(),
        );
        await js(() =>
          document
            .querySelector('[aria-label="YouTube 참여 방식"] button:last-child')
            .click(),
        );
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(
          await js(() => localStorage.getItem("streamer-assist-vote-prefix")),
          "!투표",
        );
        assert.equal(
          await js(() =>
            localStorage.getItem("streamer-assist-youtube-poll-method"),
          ),
          "native",
        );
        await setInput(
          '[aria-label="채팅 투표 접두어"]',
          "!아주긴투표명령어예시",
        );
        await assertLayout(
          window,
          "vote format popup with both platforms and long prefix",
        );
        await js(() =>
          document
            .querySelector('[aria-label="채팅 입력 형식"] button:first-child')
            .click(),
        );
        await js(() =>
          document
            .querySelector(
              '[aria-label="YouTube 참여 방식"] button:first-child',
            )
            .click(),
        );
        await js(() => {
          document.querySelector(".poll-help").open = false;
        });
        await clickPlatform("youtube");
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.deepEqual(await toggleStates(), [
          { platform: "chzzk", enabled: "true" },
          { platform: "youtube", enabled: "false" },
        ]);
        await assertLayout(window, "poll with both platforms and one disabled");
        fixtureState.auth.accounts.chzzk.connected = false;
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.deepEqual(await toggleStates(), [
          { platform: "youtube", enabled: "false" },
        ]);
        await clickPlatform("youtube");
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.deepEqual(await toggleStates(), [
          { platform: "youtube", enabled: "true" },
        ]);
        fixtureState.poll = {
          ...actualState.poll,
          active: true,
          mode: "native",
          platforms: ["youtube"],
          counts: [0, 0],
          youtubeCounts: [3, 4],
        };
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.ok(
          await window.webContents.executeJavaScript(
            "document.querySelector('.poll-platform-toggle').disabled",
          ),
        );
        assert.equal(
          await window.webContents.executeJavaScript(
            "document.querySelector('.result-legend').innerText.trim()",
          ),
          "YouTube 투표",
        );
        assert.ok(
          !(await window.webContents.executeJavaScript(
            "document.querySelector('.vote-list').innerText.includes('치지직')",
          )),
        );
        await assertLayout(window, "YouTube-only result at minimum size");
        await js(() => {
          document.querySelector(".poll-help").open = true;
        });
        assert.equal(
          await js(() =>
            document
              .querySelector(
                '[aria-label="YouTube 참여 방식"] button:last-child',
              )
              .getAttribute("aria-pressed"),
          ),
          "true",
        );
        assert.equal(
          await js(
            () =>
              document.querySelector(
                '[aria-label="YouTube 참여 방식"] button:last-child',
              ).disabled,
          ),
          true,
        );
        await assertLayout(window, "active native vote format popup");
        await js(() => {
          document.querySelector(".poll-help").open = false;
        });
      } finally {
        stopFixture();
        await window.webContents.executeJavaScript(
          "window.assist.call('state')",
        );
      }
      const stressState = {
        ...actualState,
        demo: false,
        connections: { chzzk: "연결됨", youtube: "연결됨" },
        notice: "레이아웃 검증용 긴 안내 ".repeat(40),
        current: {
          ...actualState.current,
          title: "아주 긴 방송 제목 ".repeat(12),
        },
        auth: {
          pending: "youtube",
          accounts: {
            chzzk: {
              configured: true,
              connected: true,
              name: "긴 치지직 채널 이름 ".repeat(10),
            },
            youtube: {
              configured: true,
              connected: true,
              name: "긴 YouTube 계정 이름 ".repeat(10),
            },
          },
        },
        poll: {
          ...actualState.poll,
          options: [
            "첫 번째 선택",
            "두 번째 선택",
            "세 번째 선택",
            "네 번째 선택",
          ],
          counts: [3, 4, 2, 1],
          youtubeCounts: [5, 3, 6, 4],
          mode: "native",
          platforms: ["chzzk", "youtube"],
        },
      };
      const stopStressFixture = renderFixture(window, () => stressState);
      try {
        for (const tab of ["통합 투표", "설정", "방송 타임라인"]) {
          await window.webContents.executeJavaScript(
            "[...document.querySelectorAll('nav button')].find(button => button.textContent.includes(" +
              JSON.stringify(tab) +
              ")).click()",
          );
          await new Promise((resolve) => setTimeout(resolve, 80));
          await assertLayout(
            window,
            tab + " with long notice and pending login",
          );
          if (tab === "설정") {
            await window.webContents.executeJavaScript(
              "document.querySelectorAll('.settings-tabs button')[1].click()",
            );
            await new Promise((resolve) => setTimeout(resolve, 80));
            await assertLayout(
              window,
              "platform settings with long notice and pending login",
            );
          }
        }
      } finally {
        stopStressFixture();
        await window.webContents.executeJavaScript(
          "window.assist.call('state')",
        );
      }
      const reloadDone = new Promise((resolve) =>
        window.webContents.once("did-finish-load", resolve),
      );
      window.webContents.reload();
      await reloadDone;
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(
        await js(() => localStorage.getItem("streamer-assist-vote-prefix")),
        "!투표",
      );
      assert.equal(
        await js(() =>
          localStorage.getItem("streamer-assist-youtube-poll-method"),
        ),
        "chat",
      );
      await window.webContents.executeJavaScript(
        "[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('방송 타임라인')).click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
      await window.webContents.executeJavaScript(
        "(async () => { for (let i = 0; i < 20; i++) await window.assist.call('mark', { label: '긴 기록 ' + i + ' · ' + '방송에서 기억할 순간 '.repeat(10) }); })()",
      );
      await assertLayout(window, "timeline with long list at minimum size");
      assert.ok(
        await window.webContents.executeJavaScript(
          "document.querySelector('.marker-list').scrollHeight > document.querySelector('.marker-list').clientHeight",
        ),
        "long lists must remain scrollable inside their panel",
      );
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('.window-controls button')[1].click()",
      );
      await waitFor(() => window.isMaximized(), "custom maximize button");
      await new Promise((resolve) => setTimeout(resolve, 120));
      await assertLayout(window, "maximized timeline");
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.querySelectorAll('.window-controls button')[1].getAttribute('aria-label')",
        ),
        "창 크기 복원",
      );
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('.window-controls button')[1].click()",
      );
      await waitFor(() => !window.isMaximized(), "custom restore button");
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('.window-controls button')[0].click()",
      );
      await waitFor(() => window.isMinimized(), "custom minimize button");
      window.restore();
      window.show();
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (process.argv.includes("--screenshot")) {
        window.show();
        window.focus();
        await new Promise((resolve) => setTimeout(resolve, 300));
        fs.writeFileSync(
          path.join(__dirname, "../release/smoke.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
      }
      await window.webContents.executeJavaScript(
        `(async () => { await window.assist.call('poll-stop'); await window.assist.call('demo'); await window.assist.call('stop'); })()`,
      );
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('.window-controls button')[2].click()",
      );
      await waitFor(() => !window.isVisible(), "custom close hides to tray");
      assert.equal(window.isDestroyed(), false);
      assert.equal(window.isVisible(), false);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      clearTimeout(timeout);
      console.log(
        "PASS: actual React UI, preload IPC, offset marker, automatic highlight, demo votes, editable option list, connected platform toggles, selected-only results, configurable commands and YouTube methods, frozen active vote rules, key capture, saved settings, global shortcut, frameless window controls, no page overflow, tray close, local persistence",
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
