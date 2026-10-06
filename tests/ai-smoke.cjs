// Real Electron IPC and renderer smoke test. Only external runtimes, account
// quota and provider transport are replaced with deterministic local fixtures.
const { app, BrowserWindow } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { assertLayout, waitFor, rendered } = require("./layout-check.cjs");

const profile = process.env.STREAMER_ASSIST_TEST_PROFILE || path.join(__dirname, "../release/ai-smoke-" + Date.now());
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F7";
require("./demo-clock.cjs").installDemoClock();

const PROVIDERS = [
  { id: "openai", name: "OpenAI", cliModel: "smoke-codex-cli", apiModel: "smoke-openai-api", cli: "codex" },
  { id: "anthropic", name: "Anthropic", cliModel: "smoke-claude-cli", apiModel: "smoke-anthropic-api", cli: "claude" },
  { id: "xai", name: "xAI", cliModel: "smoke-grok-cli", apiModel: "smoke-xai-api", cli: "grok" },
  { id: "google", name: "Google", cliModel: "smoke-agy-cli", apiModel: "smoke-google-api", cli: "agy" },
  { id: "deepseek", name: "DeepSeek", cliModel: "smoke-deepseek-model", apiModel: "smoke-deepseek-model", cli: "codex" },
  { id: "moonshot", name: "Moonshot", cliModel: "smoke-kimi-cli", apiModel: "smoke-moonshot-api", cli: "kimi" },
];
const COMPONENTS = ["codex", "claude", "grok", "agy", "kimi"];
const quotaFixture = {
  available: true,
  source: "smoke-fixture",
  updatedAt: Date.now(),
  windows: [
    { name: "5-hour session", key: "fixture:session", usedPercent: 25, remainingPercent: 75, resetsAt: Date.now() + 3600000 },
    { name: "Weekly", key: "fixture:weekly", usedPercent: 40, remainingPercent: 60, resetsAt: Date.now() + 7 * 86400000 },
  ],
};
const quotaModule = require("../electron/ai-quota.cjs");
quotaModule.readCliQuota = async () => structuredClone(quotaFixture);

const modelModule = require("../electron/ai-models.cjs");
const modelQueries = [];
modelModule.readCliModels = async ({ cliId, providerId, executable, cwd, configArgs, env }) => {
  const provider = PROVIDERS.find(row => row.id === providerId);
  assert.ok(provider, "model discovery uses a registered provider");
  assert.equal(cliId, provider.cli);
  assert.equal(executable, `C:\\fixture\\${cliId}.exe`);
  assert.ok(path.isAbsolute(cwd), "model query runs in an isolated absolute directory");
  if (providerId === "deepseek") {
    assert.ok(configArgs?.some(value => value.startsWith("model_catalog_json=")));
    const catalogArg = configArgs.find(value => value.startsWith("model_catalog_json="));
    const catalogPath = catalogArg.slice("model_catalog_json=\"".length, -1);
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    assert.ok(Array.isArray(catalog.models) && catalog.models.length > 0, "DeepSeek uses a generated official Codex catalog");
    assert.ok(!configArgs.join(" ").includes(env.DEEPSEEK_API_KEY), "DeepSeek credential is excluded from argv");
  }
  modelQueries.push(providerId);
  return {
    models: [{ id: provider.cliModel, name: provider.name + " fixture CLI model", effortsReported: true, efforts: ["low", "high"], defaultEffort: "high" }],
    currentModelId: provider.cliModel,
    source: "cli",
    queriedAt: new Date().toISOString(),
  };
};

const runtimeModule = require("../electron/ai-runtime.cjs");
runtimeModule.RuntimeManager.prototype.snapshot = function () {
  const components = COMPONENTS.map(id => ({
    id, status: "ready", version: "smoke-1.0.0", source: "external",
    executable: `C:\\fixture\\${id}.exe`, progress: 0, bytes: 65536, error: null,
  }));
  return { components, byId: Object.fromEntries(components.map(row => [row.id, row])) };
};
// This suite never launches a CLI, even when the fixture snapshot says one is installed.
runtimeModule.RuntimeManager.prototype.resolve = async () => null;
runtimeModule.RuntimeManager.prototype.pin = async function (id) { return `C:\\fixture\\${id}.exe`; };
runtimeModule.RuntimeManager.prototype.release = function () {};
runtimeModule.RuntimeManager.prototype.detect = async function (id) { return this.snapshot().byId[id] || { id, status: "not-detected" }; };

const apiModule = require("../electron/ai-api.cjs");
const apiModelQueries = [];
apiModule.listModels = async ({ provider, key }) => {
  const row = PROVIDERS.find(item => item.id === provider.id);
  assert.ok(row, "API model query uses a registered provider");
  assert.ok(key.startsWith("smoke-" + row.id + "-"), "API model query uses only a fake saved credential");
  apiModelQueries.push(provider.id);
  return [{ id: row.apiModel, name: row.name + " fixture API model", efforts: ["low", "high"] }];
};
const FIXTURE_TEXT = '<script>window.__aiSmokeExecuted=true</script>\n' + "긴 분석 결과가 올바르게 줄바꿈되고 화면 안에 유지됩니다. ".repeat(180);
let apiCalls = 0;
let capturedPrompt = "";
let capturedAnalysis = null;
apiModule.runApi = async ({ provider, key, prompt, model, effort, onText }) => {
  apiCalls++;
  assert.equal(provider.id, "openai");
  assert.ok(key.startsWith("smoke-openai-"), "only the fake test credential reaches the API adapter");
  capturedAnalysis = { model, effort };
  capturedPrompt = JSON.stringify(prompt);
  onText?.(FIXTURE_TEXT);
  return {
    text: FIXTURE_TEXT,
    usage: { inputTokens: 1234, outputTokens: 678, cachedInputTokens: 34, reasoningTokens: 12, totalTokens: 1912 },
    cost: { amount: 0.001234, currency: "USD", estimated: true, source: "smoke-fixture", checkedAt: Date.now() },
    providerId: provider.id,
    model,
  };
};

const timeout = setTimeout(() => {
  console.error("AI desktop smoke timed out");
  app.exit(1);
}, 45000);

async function captureScreenshot(window, file) {
  let timeoutId;
  try {
    const image = await Promise.race([
      window.webContents.capturePage(),
      new Promise((_resolve, reject) => { timeoutId = setTimeout(() => reject(new Error("Screenshot capture timed out")), 3000); }),
    ]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    return true;
  } finally { clearTimeout(timeoutId); }
}

app.on("browser-window-created", (_event, window) => {
  window.webContents.on("console-message", event => console.log("AI smoke renderer:", event.level, event.message));
  window.webContents.once("did-finish-load", async () => {
    try {
      window.webContents.setBackgroundThrottling(false);
      console.log("AI smoke: window ready");
      const run = code => window.webContents.executeJavaScript(code);
      const call = async (action, payload = {}) => {
        const result = await run("window.assist.call(" + JSON.stringify(action) + "," + JSON.stringify(payload) + ")");
        assert.equal(result.ok, true, `${action}: ${result.error || "IPC request failed"}`);
        return result.data;
      };
      const script = (fn, ...args) => run("(" + fn.toString() + ")(" + args.map(value => JSON.stringify(value)).join(",") + ")");
      const appState = () => script(async () => {
        let value;
        const off = window.assist.subscribe(state => { value = state; });
        await window.assist.call("state");
        off();
        return value;
      });
      const setField = (selector, value) => script((query, next) => {
        const input = document.querySelector(query);
        if (!input) throw new Error("Missing input: " + query);
        const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(input, next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, selector, value);
      const setSelect = (selector, value) => script((query, next) => {
        const select = document.querySelector(query);
        if (!select || select.tagName !== "SELECT") throw new Error("Missing model select: " + query);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, next);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, selector, value);
      const assertModelSelectOnly = async (providerId, mode) => {
        const controls = await script(() => {
          const group = document.querySelector(".ai-settings .ai-model-controls");
          const model = group?.querySelector('[aria-label="AI 모델"]');
          return {
            tagName: model?.tagName,
            manual: !!group?.querySelector("input, datalist"),
            queryButton: !!document.querySelector('[aria-label="AI 모델 목록 조회"]'),
            effortTag: group?.querySelector('[aria-label="AI 추론 정도"]')?.tagName,
          };
        });
        assert.equal(controls.tagName, "SELECT", providerId + " " + mode + " model is a select");
        assert.equal(controls.manual, false, providerId + " " + mode + " has no manual model entry or datalist");
        assert.equal(controls.queryButton, true, providerId + " " + mode + " can refresh actual models");
        assert.equal(controls.effortTag, "SELECT", providerId + " " + mode + " effort is a select");
      };
      const queryAndChooseModel = async (provider, mode) => {
        await assertModelSelectOnly(provider.id, mode);
        const before = mode === "cli" ? modelQueries.length : apiModelQueries.length;
        await script(() => {
          const button = document.querySelector('[aria-label="AI 모델 목록 조회"]');
          if (!button || button.disabled) throw new Error("AI model-list query is unavailable");
          button.click();
        });
        await waitFor(() => script(expected => {
          const select = document.querySelector('[aria-label="AI 모델"]');
          return select?.tagName === "SELECT" && select.value === expected && [...select.options].some(option => option.value === expected);
        }, mode === "cli" ? provider.cliModel : provider.apiModel), provider.id + " " + mode + " actual model list");
        await waitFor(() => script(() => document.querySelector('[aria-label="AI 추론 정도"] option[value="high"]') !== null), provider.id + " " + mode + " advertised high effort");
        assert.equal(mode === "cli" ? modelQueries.length : apiModelQueries.length, before + 1, provider.id + " " + mode + " queries the CLI/API once");
        await setSelect('[aria-label="AI 모델"]', mode === "cli" ? provider.cliModel : provider.apiModel);
        await setSelect('[aria-label="AI 추론 정도"]', "high");
        await waitFor(() => script(() => document.querySelector('[aria-label="AI 모델"]')?.value && document.querySelector('[aria-label="AI 추론 정도"]')?.value === "high"), provider.id + " " + mode + " selected model and effort");
      };
      const selectProvider = async provider => {
        await script(name => {
          const button = [...document.querySelectorAll(".ai-provider")].find(row => row.textContent.includes(name));
          if (!button) throw new Error("Missing AI provider: " + name);
          button.click();
        }, provider.name);
        await waitFor(() => script(name => document.querySelector(".ai-connection-heading h2")?.textContent.includes(name), provider.name), provider.id + " settings");
      };
      const chooseMode = mode => script(value => {
        const button = document.querySelectorAll(".ai-mode-switch button")[value === "cli" ? 0 : 1];
        if (!button || button.disabled) throw new Error("AI mode unavailable: " + value);
        button.click();
      }, mode);
      const checkSettingsLayouts = async (label, screenshotPrefix = "") => {
        for (const size of [[1240, 850], [900, 650]]) {
          window.setSize(...size);
          await waitFor(() => script(expected => innerWidth === expected[0] && innerHeight === expected[1], size), "window resized to " + size.join("x"));
          await rendered(window);
          try { await assertLayout(window, label + " " + size.join("x")); }
          catch (error) {
            const diagnostics = await script(() => {
              const selectors = ["html", "body", "#root", ".layout", "main", ".content", ".page-body", ".ai-settings", ".ai-provider-rail", ".ai-connection-panel", ".ai-connection-body", ".ai-runtime-card", ".ai-key-card", ".ai-model-controls", ".ai-settings-footer"];
              return { viewport: { width: innerWidth, height: innerHeight }, elements: selectors.map(selector => {
                const element = document.querySelector(selector);
                if (!element) return { selector, missing: true };
                const rect = element.getBoundingClientRect();
                return { selector, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom }, client: { width: element.clientWidth, height: element.clientHeight }, scroll: { width: element.scrollWidth, height: element.scrollHeight } };
              }) };
            });
            console.error("AI smoke layout diagnostics " + label + " " + size.join("x") + ": " + JSON.stringify(diagnostics));
            try {
              const screenshotPath = path.join(__dirname, "../release/ai-smoke-failure.png");
              await captureScreenshot(window, screenshotPath);
              console.error("AI smoke failure screenshot: " + screenshotPath);
            } catch (captureError) { console.error("AI smoke screenshot capture failed: " + captureError.message); }
            throw error;
          }
          if (screenshotPrefix && process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1")
            await captureScreenshot(window, path.join(__dirname, `../release/${screenshotPrefix}-${size[0]}x${size[1]}.png`));
        }
      };
      const saveVisibleSettings = async () => {
        await script(() => {
          const button = document.querySelector(".ai-settings-footer button.primary");
          if (!button || button.disabled) throw new Error("AI settings cannot be saved");
          button.click();
        });
        await waitFor(() => script(() => document.querySelector(".ai-settings .ai-message")?.textContent.includes("AI 연결 설정을 저장했습니다.") && !document.querySelector(".ai-settings-footer button.primary")?.disabled), "AI settings save");
      };

      await appState();
      console.log("AI smoke: initial state");
      await call("start", { title: "익명화 확인 방송", offset: 125 });
      await call("demo");
      await call("poll-start", { question: "다음 테스트는?", options: ["분석", "기록"], platforms: ["demo"] });
      await waitFor(async () => {
        const data = await call("timeline-query", { limit: 100 });
        return data.events?.some(event => event.platform === "demo");
      }, "real demo timeline events");
      console.log("AI smoke: demo timeline");

      await script(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("설정"))?.click());
      await waitFor(() => script(() => document.querySelector(".settings-tabs") !== null), "settings tabs");
      await script(() => [...document.querySelectorAll('[role="tab"]')].find(button => button.textContent.includes("AI 연결"))?.click());
      await waitFor(() => script(() => document.querySelector(".ai-settings") !== null), "AI settings view");
      console.log("AI smoke: settings view");

      const availableProviders = await call("ai-state");
      assert.deepEqual(availableProviders.providers.map(row => row.id), PROVIDERS.map(row => row.id), "AI state exposes the six available provider profiles");
      assert.ok(availableProviders.providers.every(row => row.added === false), "AI settings start with no providers added");
      assert.equal(await script(() => document.querySelectorAll(".ai-provider").length), 0, "the settings rail starts empty");
      for (const provider of PROVIDERS) await call("ai-provider-add", { providerId: provider.id });
      await waitFor(() => script(expected => document.querySelectorAll(".ai-provider").length === expected, PROVIDERS.length), "six explicitly added providers");
      const addedProviders = await call("ai-state");
      assert.ok(addedProviders.providers.every(row => row.added === true), "the legacy model/settings flow sees only explicitly added providers");

      for (const provider of PROVIDERS) {
        await selectProvider(provider);
        console.log("AI smoke: selected " + provider.id);
        await chooseMode("cli");
        await checkSettingsLayouts(provider.id + " CLI settings");
        let cliKey = null;
        if (provider.id === "deepseek") {
          cliKey = "smoke-deepseek-cli-credential";
          await setField('[aria-label="DeepSeek CLI API 키"]', cliKey);
          assert.equal(await script(() => document.querySelector('[aria-label="DeepSeek CLI API 키"]')?.type), "password");
          assert.equal(await script(secret => document.body.innerText.includes(secret), cliKey), false);
        }
        await queryAndChooseModel(provider, "cli");
        await saveVisibleSettings();
        console.log("AI smoke: saved CLI " + provider.id);
        const cliSaved = await call("ai-state");
        const cliRow = cliSaved.providers.find(row => row.id === provider.id);
        assert.equal(cliRow.modelsSource, "cli", provider.id + " caches only CLI-discovered models");
        assert.deepEqual(cliRow.models.map(row => row.id), [provider.cliModel]);
        assert.equal(cliRow.model, provider.cliModel);
        assert.equal(cliRow.effort, "high");
        const cliOptions = await call("ai-model-options", { providerId: provider.id, mode: "cli", model: provider.cliModel });
        assert.equal(cliOptions.source, "cli", provider.id + " exposes CLI as the model-options source");
        assert.deepEqual(cliOptions.models.map(row => row.id), [provider.cliModel]);

        await chooseMode("api");
        await checkSettingsLayouts(provider.id + " API settings");
        if (provider.id !== "deepseek") {
          const key = `smoke-${provider.id}-api-credential`;
          await setField('[aria-label="AI API 키"]', key);
          assert.equal(await script(() => document.querySelector('[aria-label="AI API 키"]')?.type), "password");
          assert.equal(await script(secret => document.body.innerText.includes(secret), key), false);
        }
        await queryAndChooseModel(provider, "api");
        await saveVisibleSettings();
        console.log("AI smoke: saved API " + provider.id);
        const apiSaved = await call("ai-state");
        const apiRow = apiSaved.providers.find(row => row.id === provider.id);
        assert.equal(apiRow.modelsSource, "api", provider.id + " caches only API-discovered models");
        assert.deepEqual(apiRow.models.map(row => row.id), [provider.apiModel]);
        assert.equal(apiRow.model, provider.apiModel);
        assert.equal(apiRow.effort, "high");
        const apiOptions = await call("ai-model-options", { providerId: provider.id, mode: "api", model: provider.apiModel });
        assert.equal(apiOptions.source, "api", provider.id + " exposes API as the model-options source");
        assert.deepEqual(apiOptions.models.map(row => row.id), [provider.apiModel]);
      }
      assert.deepEqual(modelQueries.slice(0, PROVIDERS.length), PROVIDERS.map(row => row.id), "every CLI provider was refreshed from its actual CLI boundary");
      const apiQueryCounts = Object.fromEntries(PROVIDERS.map(row => [row.id, apiModelQueries.filter(id => id === row.id).length]));
      assert.deepEqual(apiQueryCounts, { openai: 1, anthropic: 1, xai: 1, google: 1, deepseek: 2, moonshot: 1 }, "each API provider is queried, with one additional DeepSeek lookup for the Codex catalog");
      console.log("AI smoke: six provider profiles saved");

      const saved = await call("ai-state");
      assert.deepEqual(saved.providers.map(row => row.id), PROVIDERS.map(row => row.id));
      for (const provider of PROVIDERS) {
        const row = saved.providers.find(item => item.id === provider.id);
        assert.equal(row.enabled, true, provider.id + " enabled");
        assert.equal(row.mode, "api", provider.id + " API mode saved");
        assert.equal(row.model, provider.apiModel, provider.id + " API model saved");
        assert.equal(row.effort, "high", provider.id + " advertised effort saved");
        assert.equal(row.hasKey, true, provider.id + " credential stored");
        assert.equal(row.added, true, provider.id + " explicitly added");
        assert.ok(!Object.hasOwn(row, "key"), provider.id + " credential is not exposed in state");
      }
      const credentialsFile = path.join(profile, "ai", "credentials.enc");
      const encryptedCredentials = fs.readFileSync(credentialsFile, "utf8");
      for (const provider of PROVIDERS) assert.ok(!encryptedCredentials.includes(`smoke-${provider.id}-api-credential`));
      assert.ok(!encryptedCredentials.includes("smoke-deepseek-cli-credential"));

      await selectProvider(PROVIDERS[0]);
      await chooseMode("cli");
      await queryAndChooseModel(PROVIDERS[0], "cli");
      await saveVisibleSettings();
      await script(() => [...document.querySelectorAll(".ai-quota-heading button")].find(button => button.textContent.includes("한도 조회"))?.click());
      await waitFor(() => script(() => document.querySelectorAll(".ai-settings .ai-quota-window").length === 2), "two quota windows");
      console.log("AI smoke: quota windows rendered");
      const quotaBars = await script(() => [...document.querySelectorAll(".ai-settings .ai-quota-window")].map(row => ({ name: row.querySelector("span")?.textContent, value: Number(row.querySelector("progress")?.value) })));
      assert.deepEqual(quotaBars.map(row => row.name), ["세션", "주간"]);
      assert.deepEqual(quotaBars.map(row => row.value), [25, 40]);
      await checkSettingsLayouts("AI settings with two quota windows", "ai-settings");

      await chooseMode("api");
      await queryAndChooseModel(PROVIDERS[0], "api");
      await saveVisibleSettings();

      await script(() => {
        const button = [...document.querySelectorAll("nav button")].find(item => item.textContent.includes("방송 타임라인"));
        if (!button) throw new Error("Timeline navigation button is missing");
        button.click();
      });
      await waitFor(() => script(() => document.querySelector(".page-heading h1")?.textContent === "방송 타임라인"), "timeline page");
      await waitFor(() => script(() => document.querySelector(".telemetry-tabs") !== null), "timeline tabs");
      await script(() => {
        const button = [...document.querySelectorAll(".telemetry-tabs [role=tab]")].find(item => item.textContent === "AI 분석");
        if (!button) throw new Error("AI analysis tab is missing");
        button.click();
      });
      await waitFor(() => script(() => document.querySelector(".ai-analysis-workspace") !== null), "AI analysis workspace");
      const analysisModelControls = await script(() => ({
        modelSelector: !!document.querySelector('.ai-analysis-source [aria-label="AI 모델"]'),
        effortSelector: !!document.querySelector('.ai-analysis-source [aria-label="AI 추론 정도"]'),
        config: document.querySelector(".ai-config-summary")?.textContent || "",
      }));
      assert.equal(analysisModelControls.modelSelector, false, "model selection lives in Settings, not the analysis screen");
      assert.equal(analysisModelControls.effortSelector, false, "effort selection lives in Settings, not the analysis screen");
      assert.ok(analysisModelControls.config.includes(PROVIDERS[0].apiModel), "analysis uses the model saved in Settings");
      const forgedSave = await run("window.assist.call('ai-save'," + JSON.stringify({ providerId: "openai", mode: "api", model: "forged-model", effort: "high", enabled: true }) + ")");
      assert.equal(forgedSave.ok, false, "an unqueried model ID cannot be saved");
      await script(() => {
        const button = document.querySelector('[aria-label="AI 분석 범위 변경"]');
        if (!button) throw new Error("AI scope dialog button is missing");
        button.click();
      });
      await waitFor(() => script(() => document.querySelector("dialog.ai-scope-dialog[open]") !== null), "native AI scope dialog open");
      for (const size of [[1240, 850], [900, 650]]) {
        window.setSize(...size);
        await waitFor(() => script(expected => innerWidth === expected[0] && innerHeight === expected[1], size), "scope dialog resized to " + size.join("x"));
        await rendered(window);
        try { await assertLayout(window, "AI scope dialog " + size.join("x")); }
        catch (error) {
          const diagnostics = await script(() => {
            const selectors = ["html", "body", "main", ".page-body", ".ai-analysis-workspace", ".ai-request-panel", ".ai-scope-dialog", ".ai-scope-dialog .ai-scope-grid", ".ai-scope-dialog .panel-heading", ".ai-scope-dialog .primary"];
            return { viewport: { width: innerWidth, height: innerHeight }, elements: selectors.map(selector => {
              const element = document.querySelector(selector);
              if (!element) return { selector, missing: true };
              const rect = element.getBoundingClientRect();
              return { selector, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom }, client: { width: element.clientWidth, height: element.clientHeight }, scroll: { width: element.scrollWidth, height: element.scrollHeight } };
            }) };
          });
          console.error("AI scope dialog diagnostics " + size.join("x") + ": " + JSON.stringify(diagnostics));
          try { await captureScreenshot(window, path.join(__dirname, "../release/ai-smoke-failure.png")); console.error("AI scope dialog screenshot: release/ai-smoke-failure.png"); }
          catch (captureError) { console.error("AI smoke screenshot capture failed: " + captureError.message); }
          throw error;
        }
        if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1")
          await captureScreenshot(window, path.join(__dirname, `../release/ai-scope-${size[0]}x${size[1]}.png`));
      }
      await script(() => document.querySelector('[aria-label="AI 분석 범위 닫기"]')?.click());
      await waitFor(() => script(() => document.querySelector("dialog.ai-scope-dialog[open]") === null), "native AI scope dialog closed");
      await setField('[aria-label="AI 분석 요청"]', "데모 채팅의 반응을 간결하게 요약하세요.");
      const latestAppState = await appState();
      const session = latestAppState.current || latestAppState.sessions?.[0];
      assert.ok(session?.id, "the real demo recording is available to AI");
      const preview = await call("ai-preview", {
        providerId: "openai", mode: "api", model: PROVIDERS[0].apiModel,
        prompt: "데모 채팅의 반응을 간결하게 요약하세요.",
        scope: { sessionId: session.id }, includeIdentity: false,
      });
      assert.ok(preview.totalEvents > 0, "preview includes saved demo timeline events");
      await waitFor(() => script(() => Number(document.querySelector(".ai-preview strong")?.textContent.split("/")[0]?.replaceAll(",", "")) > 0), "rendered AI preview");
      await script(() => [...document.querySelectorAll(".ai-submit-row button")].find(button => button.textContent.includes("분석 실행"))?.click());
      await waitFor(() => script(() => document.querySelector(".ai-job-status")?.textContent.includes("분석 완료")), "AI analysis completion", 15000);
      console.log("AI smoke: API result completed");
      assert.equal(apiCalls, 1, "the fixture adapter is the only provider call");
      assert.deepEqual(capturedAnalysis, { model: PROVIDERS[0].apiModel, effort: "high" }, "analysis receives the saved model and effort");
      assert.ok(capturedPrompt, "the adapter received a built prompt");
      assert.ok(!capturedPrompt.includes("테스트 시청자 1"), "default context pseudonymizes display names");
      assert.ok(!capturedPrompt.includes("demo-0"), "default context excludes raw platform IDs");

      const results = await call("ai-state");
      const resultId = results.results?.[0]?.id;
      assert.ok(resultId, "completed AI result is saved");
      const job = await call("ai-results-get", { id: resultId });
      assert.equal(job.status, "completed");
      assert.equal(job.text, FIXTURE_TEXT);
      assert.equal(job.usage.inputTokens, 1234);
      assert.equal(job.usage.outputTokens, 678);
      assert.equal(job.cost.amount, 0.001234);
      await waitFor(() => script(() => document.querySelector(".ai-usage-strip")?.textContent.includes("1,234 / 678")), "usage and cost display");
      await rendered(window);
      await waitFor(() => script(() => {
        const area = document.querySelector(".ai-result-reader"), pre = area?.querySelector("pre");
        return !!area && !!pre && area.scrollHeight <= area.clientHeight + 1 && pre.scrollWidth <= pre.clientWidth + 1;
      }), "result pages measured after the usage strip changes reader height");
      const reader = await script(() => {
        const area = document.querySelector(".ai-result-reader");
        const pre = area?.querySelector("pre");
        return { text: area?.textContent || "", html: area?.innerHTML || "", injected: !!area?.querySelector("script, img, iframe"), scrollHeight: area?.scrollHeight, clientHeight: area?.clientHeight, preScrollWidth: pre?.scrollWidth, preClientWidth: pre?.clientWidth };
      });
      assert.ok(reader.text.replace(/\s+/g, "").startsWith("<script>window.__aiSmokeExecuted=true</script>"), "result displays HTML-like text literally");
      assert.ok(reader.html.includes("&lt;script&gt;"), "React escapes provider output");
      assert.equal(reader.injected, false, "provider output cannot create DOM elements");
      assert.ok(reader.scrollHeight <= reader.clientHeight + 1, "measured result page fits the result reader vertically");
      assert.ok(reader.preScrollWidth <= reader.preClientWidth + 1, "measured result page fits the result reader horizontally");
      const firstPage = reader.text;
      assert.equal(await script(() => !!document.querySelector('[aria-label="다음 AI 결과 페이지"]') && !document.querySelector('[aria-label="다음 AI 결과 페이지"]').disabled), true, "long output has another measured page");
      await script(() => document.querySelector('[aria-label="다음 AI 결과 페이지"]')?.click());
      await waitFor(() => script(text => document.querySelector(".ai-result-reader")?.textContent !== text, firstPage), "next long-result page");
      for (const size of [[1240, 850], [900, 650]]) {
        window.setSize(...size);
        await waitFor(() => script(expected => innerWidth === expected[0] && innerHeight === expected[1], size), "analysis result resized to " + size.join("x"));
        await rendered(window);
        try { await assertLayout(window, "AI analysis result " + size.join("x")); }
        catch (error) {
          const diagnostics = await script(() => {
            const selectors = ["html", "body", "#root", ".layout", "main", ".content", ".page-body", ".ai-analysis-workspace", ".ai-request-panel", ".ai-analysis-source", ".ai-scope-grid", ".ai-prompt", ".ai-submit-row", ".ai-result-panel", ".ai-result-reader", ".ai-result-reader pre", ".ai-result-footer"];
            return { viewport: { width: innerWidth, height: innerHeight }, elements: selectors.map(selector => {
              const element = document.querySelector(selector);
              if (!element) return { selector, missing: true };
              const rect = element.getBoundingClientRect();
              return { selector, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom }, client: { width: element.clientWidth, height: element.clientHeight }, scroll: { width: element.scrollWidth, height: element.scrollHeight } };
            }) };
          });
          console.error("AI smoke layout diagnostics analysis " + size.join("x") + ": " + JSON.stringify(diagnostics));
          try { await captureScreenshot(window, path.join(__dirname, "../release/ai-smoke-failure.png")); console.error("AI smoke failure screenshot: release/ai-smoke-failure.png"); }
          catch (captureError) { console.error("AI smoke screenshot capture failed: " + captureError.message); }
          throw error;
        }
        await waitFor(() => script(() => {
          const area = document.querySelector(".ai-result-reader"), pre = area?.querySelector("pre");
          return !!area && !!pre && area.scrollHeight <= area.clientHeight + 1 && pre.scrollWidth <= pre.clientWidth + 1;
        }), "measured result page fits after resize " + size.join("x"));
        if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1")
          await captureScreenshot(window, path.join(__dirname, `../release/ai-analysis-${size[0]}x${size[1]}.png`));
      }

      clearTimeout(timeout);
      console.log("PASS: real AI settings and timeline IPC, six CLI/API provider profiles, encrypted keys, two quota windows, anonymized demo context, fixture API usage/cost, escaped long output and responsive layout");
      app.quit();
    } catch (error) {
      console.error(error?.stack || error);
      try {
        await captureScreenshot(window, path.join(__dirname, "../release/ai-smoke-failure.png"));
      } catch (captureError) { console.error("AI smoke failure screenshot capture failed: " + captureError.message); }
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});

const { loadTestAdapters, fakeComponentManager } = require("./ai-test-adapters.cjs");
const componentsModule = require("../electron/ai-components.cjs");
const fetchBeforeAdapterLoad = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("AI smoke requires preverified local adapter fixtures; network access is disabled."); };
loadTestAdapters().then(descriptors => {
  globalThis.fetch = fetchBeforeAdapterLoad;
  componentsModule.ComponentManager = class SmokeComponentManager {
    constructor() { Object.assign(this, fakeComponentManager(descriptors)); }
  };
  require("../electron/main.cjs");
}, error => {
  globalThis.fetch = fetchBeforeAdapterLoad;
  clearTimeout(timeout);
  console.error("AI smoke test adapters are unavailable:", error?.message || error);
  app.exit(1);
});
