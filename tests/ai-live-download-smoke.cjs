// Opt-in live integration smoke. Unlike ai-component-smoke.cjs this uses the
// real ComponentManager, main IPC and CommonAiService and downloads one public
// adapter package from GitHub. It never stores a key, calls a model API, or
// launches a provider CLI. Run only with a fresh STREAMER_ASSIST_TEST_PROFILE.
const { app, safeStorage } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
if (process.platform !== "win32") throw new Error("The live adapter smoke requires Windows DPAPI.");
if (!process.argv.includes("--hidden")) process.argv.push("--hidden");

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { waitFor } = require("./layout-check.cjs");

const profile = process.env.STREAMER_ASSIST_TEST_PROFILE;
if (!profile || !path.isAbsolute(profile)) throw new Error("Set STREAMER_ASSIST_TEST_PROFILE to a fresh absolute temporary directory.");
const userData = path.resolve(profile);
if (userData === path.parse(userData).root) throw new Error("The live adapter smoke refuses a filesystem root as userData.");
if (fs.existsSync(userData)) {
  const profileStat = fs.lstatSync(userData);
  if (!profileStat.isDirectory() || profileStat.isSymbolicLink() || fs.readdirSync(userData).length !== 0)
    throw new Error("The live adapter smoke requires a fresh, empty userData directory.");
} else fs.mkdirSync(userData, { recursive: false });
app.setPath("userData", userData);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F5";

const providerNames = ["OpenAI", "Anthropic", "xAI", "Google", "DeepSeek", "Moonshot"];
let testFinished = false;
const timeout = setTimeout(() => {
  console.error("AI live-download smoke timed out during provider add/install.");
  app.exit(1);
}, 150000);

function safePhaseError(value) {
  return String(value?.message || value || "Unknown failure").replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function finish(code, message) {
  if (testFinished) return;
  testFinished = true;
  clearTimeout(timeout);
  if (message) (code === 0 ? console.log : console.error)(message);
  if (code === 0) app.quit();
  else app.exit(code);
}

app.on("browser-window-created", (_event, browserWindow) => {
  browserWindow.webContents.once("did-finish-load", async () => {
    try {
      assert.equal(browserWindow.isVisible(), false, "the live integration window stays hidden");
      assert.equal(typeof safeStorage.isEncryptionAvailable, "function", "Electron safeStorage is available");
      assert.equal(safeStorage.isEncryptionAvailable(), true, "Windows DPAPI encryption is available");
      const run = code => browserWindow.webContents.executeJavaScript(code);
      const call = async (action, payload = {}) => {
        const result = await run("window.assist.call(" + JSON.stringify(action) + "," + JSON.stringify(payload) + ")");
        assert.equal(result.ok, true, `${action}: ${result.error || "IPC request failed"}`);
        return result.data;
      };
      const script = (fn, ...args) => run("(" + fn.toString() + ")(" + args.map(value => JSON.stringify(value)).join(",") + ")");
      const aiState = () => call("ai-state");
      const openPicker = async () => {
        await script(() => {
          const button = document.querySelector('[aria-label="AI 추가"]') || document.querySelector('[aria-label="AI 연결 추가"]') ||
            [...document.querySelectorAll("button")].find(item => item.textContent.trim() === "AI 추가");
          if (!button || button.disabled) throw new Error("AI add-provider picker is unavailable");
          button.click();
        });
        await waitFor(() => script(() => document.querySelector("dialog[open]")?.tagName === "DIALOG"), "native AI provider picker");
      };
      const chooseOpenAI = async () => {
        await script(() => {
          const button = document.querySelector('dialog[open] [aria-label="OpenAI 추가"]');
          if (!button || button.disabled) throw new Error("OpenAI is not available in the add-provider picker");
          button.click();
        });
      };
      const openaiRow = state => state.providers.find(row => row.id === "openai");

      await call("state");
      await script(() => {
        const button = [...document.querySelectorAll("nav button")].find(item => item.textContent.includes("설정"));
        if (!button) throw new Error("Settings navigation is missing");
        button.click();
      });
      await waitFor(() => script(() => document.querySelector(".settings-tabs") !== null), "settings tabs");
      await script(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find(item => item.textContent.includes("AI 연결"));
        if (!tab) throw new Error("AI settings tab is missing");
        tab.click();
      });
      await waitFor(() => script(() => document.querySelector(".ai-settings") !== null), "AI settings view");

      const initial = await aiState();
      assert.ok(initial.providers.length >= providerNames.length, "the service exposes all available providers");
      assert.ok(initial.providers.every(row => row.added === false), "a fresh profile starts with no providers added");
      assert.equal(await script(() => document.querySelectorAll(".ai-provider").length), 0, "the renderer provider list is initially empty");
      assert.equal(await script(() => !!document.querySelector(".ai-connection-panel, .ai-component-panel, .ai-mode-switch")), false, "fresh settings show no provider configuration");

      await openPicker();
      const choices = await script(() => [...document.querySelectorAll('dialog[open] button[aria-label]')]
        .map(item => item.getAttribute("aria-label")).filter(label => label.endsWith(" 추가")).sort());
      assert.deepEqual(choices, providerNames.map(name => name + " 추가").sort(), "the native picker offers all six unadded providers");
      await chooseOpenAI();

      await waitFor(async () => openaiRow(await aiState())?.added === true, "OpenAI provider added", 15000);
      await waitFor(async () => {
        const state = await aiState();
        const row = openaiRow(state);
        const job = state.job;
        if (job?.providerId === "openai" && job.mode === "adapter" && job.status === "failed") {
          throw new Error("OpenAI adapter install phase failed: " + safePhaseError(job.error));
        }
        return row?.component?.status === "installed" && typeof row.component.version === "string" &&
          job?.providerId === "openai" && job.mode === "adapter" && job.status === "completed";
      }, "real GitHub adapter download, verification and completed install job", 120000);
      await waitFor(() => script(() => !document.querySelector("dialog[open]") && !!document.querySelector(".ai-mode-switch")), "OpenAI settings after adapter install");

      const installed = openaiRow(await aiState());
      assert.equal(installed.added, true);
      assert.equal(installed.component.status, "installed");
      assert.equal(installed.component.source, "github");
      assert.ok(installed.component.version, "the live GitHub adapter version is present");
      const pointerFile = path.join(userData, "ai", "adapters", "openai", "current.json");
      const pointer = fs.readFileSync(pointerFile, "utf8");
      assert.ok(pointer.startsWith("dpapi:v1:"), "the installed adapter pointer is protected by Windows DPAPI");

      await script(() => {
        const button = document.querySelector('[aria-label="OpenAI 제거"]');
        if (!button || button.disabled) throw new Error("OpenAI remove-provider button is missing or disabled");
        button.click();
      });
      await waitFor(async () => openaiRow(await aiState())?.added === false, "OpenAI provider removed from the renderer list");
      await waitFor(() => script(() => !document.querySelector(".ai-connection-panel, .ai-component-panel")), "empty AI settings after provider removal");
      const settingsFile = path.join(userData, "ai", "settings.json");
      const persisted = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      assert.equal(persisted.providers.openai.added, false, "provider removal is persisted");
      assert.equal(fs.readFileSync(pointerFile, "utf8"), pointer, "provider removal retains the verified adapter module");

      await openPicker();
      await chooseOpenAI();
      await waitFor(async () => openaiRow(await aiState())?.added === true, "OpenAI provider re-added");
      const restored = openaiRow(await aiState());
      assert.equal(restored.component.version, installed.component.version, "re-adding uses the retained verified adapter without a native CLI action");
      assert.equal(restored.component.source, "github");
      assert.equal(fs.readFileSync(pointerFile, "utf8"), pointer, "re-adding the provider preserves the DPAPI-protected module pointer");
      assert.equal(await script(() => !document.querySelector("dialog[open]") && !!document.querySelector(".ai-mode-switch")), true, "re-added provider returns to settings");

      finish(0, `PASS: real GitHub OpenAI adapter ${installed.component.version} downloaded and installed, DPAPI pointer verified, provider removal persisted and re-add retained the adapter. No key, model request, or CLI execution used.`);
    } catch (error) {
      finish(1, "AI live-download smoke failed: " + safePhaseError(error));
    }
  });
});

require("../electron/main.cjs");
