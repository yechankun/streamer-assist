// Design stress cases use the real renderer and IPC with local AI metadata only.
const { app } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { assertLayout, waitFor, settleUI } = require("./layout-check.cjs");
const { validateProvider } = require("../electron/ai-catalog.cjs");
const profile = process.env.STREAMER_ASSIST_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), "streamer-design-test-"));
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F6";
const output = path.join(__dirname, "../release/design-audit");
fs.mkdirSync(output, { recursive: true });
const custom = validateProvider({ schemaVersion: 1, id: "custom-design", name: "W".repeat(60), protocol: "chat", baseUrl: "http://127.0.0.1:1234/v1", models: [] });
const provider = (row) => ({ ...row, added: true, enabled: false, mode: "api", model: "", effort: "default", hasKey: false, models: [], component: { status: "ready", version: "design-fixture" } });
let state = { providers: [provider(custom)], encrypted: true, job: null, results: [] };
let login = { supported: true, kind: "api-key", status: "idle" };
const service = require("../electron/ai-service.cjs");
const ActualService = service.CommonAiService;
service.CommonAiService = class extends ActualService {
  async handle(action) {
    if (action === "ai-state") return structuredClone(state);
    if (["ai-login", "ai-login-status", "ai-login-cancel", "ai-logout"].includes(action)) return { ...login };
    if (action === "ai-model-options") return { models: [], source: "design-fixture" };
    throw new Error("Design fixture does not invoke external AI services: " + action);
  }
};
const failures = [];
const contrasts = [];
const deadline = setTimeout(() => { console.error("Design audit timed out"); app.exit(1); }, 45000);
app.on("browser-window-created", (_event, window) => window.webContents.once("did-finish-load", async () => {
  const js = (fn, ...args) => window.webContents.executeJavaScript("(" + fn.toString() + ")(" + args.map((value) => JSON.stringify(value)).join(",") + ")");
  const check = async (name) => {
    await settleUI(window);
    try { await assertLayout(window, name); } catch (error) { failures.push(name + ": " + error.message); }
    const internal = await js(() => [...document.querySelectorAll(".ai-connection-heading, .ai-login-dialog h2, .ai-login-identity, .ai-login-status, .ai-login-code")].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map(element => element.className || element.tagName));
    if (internal.length) failures.push(name + ": text overflow in " + internal.join(", "));
    fs.writeFileSync(path.join(output, name + ".png"), (await window.webContents.capturePage()).toPNG());
  };
  const themeContrast = async (theme) => {
    const samples = await js(() => {
      const style = getComputedStyle(document.documentElement);
      const luminance = (hex) => {
        const channels = hex.trim().replace("#", "").match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      return ["--text", "--muted", "--subtle"].flatMap(foreground => ["--bg", "--surface", "--surface-raised", "--accent-soft", "--warning-bg"].map(background => {
        const first = luminance(style.getPropertyValue(foreground));
        const second = luminance(style.getPropertyValue(background));
        return { foreground, background, ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) };
      }));
    });
    for (const sample of samples) {
      contrasts.push({ theme, ...sample });
      if (sample.ratio < 4.5) failures.push(theme + ": low text contrast " + JSON.stringify(sample));
    }
  };
  const focusBodyControl = async (selector) => {
    const fit = await js(selector => {
      const control = document.querySelector(selector);
      control.focus();
      const bounds = control.getBoundingClientRect();
      const body = document.querySelector(".ai-login-body").getBoundingClientRect();
      return document.activeElement === control && bounds.top >= body.top - 1 && bounds.bottom <= body.bottom + 1 && bounds.left >= body.left - 1 && bounds.right <= body.right + 1;
    }, selector);
    assert.equal(fit, true, "keyboard focus reveals the login control within the scroll area: " + selector);
  };
  const closeLogin = async () => {
    await js(() => document.querySelector('[aria-label="AI 로그인 창 닫기"]').click());
    await waitFor(() => js(() => !document.querySelector(".ai-login-dialog")), "AI login closed");
  };
  try {
    window.webContents.setBackgroundThrottling(false);
    await js(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("설정")).click());
    await waitFor(() => js(() => !!document.querySelector('[aria-controls="settings-ai"]')), "settings tabs");
    await js(() => document.querySelector('[aria-controls="settings-ai"]').click());
    await waitFor(() => js(() => !!document.querySelector(".ai-key-card")), "custom API connection");
    for (const theme of ["dark", "light"]) {
      await js(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await themeContrast(theme);
      for (const size of [[900, 650], [1080, 720], [1240, 850]]) {
        window.setSize(...size);
        await waitFor(() => js(size => innerWidth === size[0] && innerHeight === size[1], size), "audit viewport");
        await check("custom-name-" + theme + "-" + size.join("x"));
      }
      window.setSize(900, 650);
      await waitFor(() => js(() => innerWidth === 900 && innerHeight === 650), "compact help viewport");
      await settleUI(window);
      window.show(); window.focus(); window.webContents.focus();
      await waitFor(() => js(() => document.hasFocus()), "keyboard help window focus");
      await js(() => document.querySelector('[aria-label="AI 연결 저장 안내"]').focus());
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      window.webContents.sendInputEvent({ type: "char", keyCode: "Enter" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      await waitFor(() => js(() => !!document.querySelector('.help-tip-content:popover-open')), "keyboard opens connection help");
      await settleUI(window);
      const helpFits = await js(() => {
        const help = document.querySelector('.help-tip-content:popover-open'), bounds = help.getBoundingClientRect();
        return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight && help.textContent.includes("기본값");
      });
      assert.equal(helpFits, true, "connection help stays readable within a compact window");
      await check("connection-help-" + theme);
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await waitFor(() => js(() => !document.querySelector('.help-tip-content:popover-open')), "Escape dismisses connection help");
      assert.equal(await js(() => document.activeElement?.getAttribute("aria-label") === "AI 연결 저장 안내"), true, "help returns keyboard focus to its trigger");
      await js(() => [...document.querySelectorAll(".ai-runtime-actions button")].find(button => button.textContent.includes("API 연결 창")).click());
      await waitFor(() => js(() => !!document.querySelector(".ai-login-dialog[open]")), "custom API login");
      await check("custom-login-" + theme);
      await focusBodyControl('[aria-label="로그인 창 API 키"]');
      await closeLogin();
    }
    login = { supported: true, kind: "device", status: "waiting", message: "공식 인증 페이지에서 로그인 승인을 기다리고 있습니다. ".repeat(12), code: "ABCD".repeat(8), url: "https://example.invalid/activate" };
    state.providers = [provider({ id: "openai", name: "OpenAI", mode: "cli" })];
    Object.assign(state.providers[0], { mode: "cli", cli: { id: "codex", status: "ready", source: "external", version: "design-fixture" }, cliProfile: { supported: true } });
    await js(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("방송 타임라인")).click());
    await waitFor(() => js(() => !document.querySelector('[data-workspace-page="settings"]:not([hidden]) .settings-page')), "leave settings");
    await js(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("설정")).click());
    await waitFor(() => js(() => !!document.querySelector('[aria-controls="settings-ai"]')), "return settings");
    await js(() => document.querySelector('[aria-controls="settings-ai"]').click());
    await waitFor(() => js(() => !!document.querySelector(".ai-runtime-card")), "CLI fixture ready");
    for (const theme of ["dark", "light"]) {
      await js(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await js(() => [...document.querySelectorAll(".ai-runtime-actions button")].find(button => button.textContent.trim() === "로그인").click());
      await waitFor(() => js(() => document.querySelector(".ai-login-code")?.textContent.includes("ABCDABCD")), "long device code");
      await js(() => document.querySelector(".ai-login-details summary").click());
      for (const size of [[900, 650], [1240, 850]]) {
        window.setSize(...size);
        await waitFor(() => js(size => innerWidth === size[0] && innerHeight === size[1], size), "login viewport");
        await check("long-login-" + theme + "-" + size.join("x"));
        const bounds = await js(() => {
          const dialog = document.querySelector(".ai-login-dialog").getBoundingClientRect();
          const footer = document.querySelector(".ai-login-footer").getBoundingClientRect();
          return { bottom: footer.bottom, maximum: dialog.bottom, viewport: innerHeight };
        });
        if (bounds.bottom > Math.min(bounds.maximum, bounds.viewport) + 1) failures.push("Login actions are clipped: " + JSON.stringify(bounds));
        await focusBodyControl(".ai-login-body .ai-login-browser");
      }
      await closeLogin();
    }
    state.providers = Array.from({ length: 14 }, (_, index) => provider({ ...custom, id: "custom-design-" + index, name: "로컬 AI 연결 " + (index + 1) }));
    await js(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("방송 타임라인")).click());
    await waitFor(() => js(() => !document.querySelector('[data-workspace-page="settings"]:not([hidden]) .settings-page')), "leave long-login settings");
    await js(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("설정")).click());
    await waitFor(() => js(() => !!document.querySelector('[aria-controls="settings-ai"]')), "provider list settings");
    await js(() => document.querySelector('[aria-controls="settings-ai"]').click());
    await waitFor(() => js(() => !!document.querySelector('[aria-label="다음 AI 연결 페이지"]')), "many custom providers use pagination");
    for (const theme of ["dark", "light"]) {
      await js(theme => { document.documentElement.dataset.theme = theme; }, theme);
      window.setSize(900, 650);
      for (let page = 0; page < 4; page++) {
        const hasPrevious = await js(() => !document.querySelector('[aria-label="이전 AI 연결 페이지"]').disabled);
        if (!hasPrevious) break;
        await js(() => document.querySelector('[aria-label="이전 AI 연결 페이지"]').click());
        await settleUI(window);
      }
      const visited = new Set();
      for (let page = 0; page < 4; page++) {
        await check("many-providers-" + theme + "-page-" + page);
        const names = await js(() => [...document.querySelectorAll(".ai-provider strong")].map(element => element.textContent));
        names.forEach(name => visited.add(name));
        const hasNext = await js(() => !document.querySelector('[aria-label="다음 AI 연결 페이지"]').disabled);
        if (!hasNext) break;
        await js(() => document.querySelector('[aria-label="다음 AI 연결 페이지"]').click());
        await settleUI(window);
      }
      assert.equal(visited.size, 14, "every custom provider remains reachable through pagination");
      await js(() => [...document.querySelectorAll(".ai-provider")].at(-1).focus());
    }
    if (failures.length) throw new Error(failures.join("\n"));
    fs.writeFileSync(path.join(output, "contrast.json"), JSON.stringify(contrasts, null, 2));
    console.log("PASS: maximum AI names, long login messages/codes, focus scrolling, pinned actions, 14-provider pagination and 30 text contrast pairs in dark/light at 900x650, 1080x720 and 1240x850.");
    clearTimeout(deadline); app.quit();
  } catch (error) {
    console.error(error);
    console.error("Design input state:", await js(() => ({ focused: document.hasFocus(), active: document.activeElement?.outerHTML, help: document.querySelector('[aria-label="AI 연결 저장 안내"]')?.outerHTML, popovers: [...document.querySelectorAll('.help-tip-content')].map(row => ({ id: row.id, open: row.matches(':popover-open'), style: row.getAttribute('style') })) })));
    clearTimeout(deadline); app.exit(1);
  }
}));
require("../electron/main.cjs");
