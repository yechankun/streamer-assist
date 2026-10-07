// End-to-end component-management pane smoke. Adapter payloads are built from
// a sibling source checkout or the verified CI component cache and served
// through a local fetch fixture. No GitHub request, CLI execution, or paid
// model request is made.
const { app } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { assertLayout, waitFor, rendered, settleUI } = require("./layout-check.cjs");
const { resolveProviderSource } = require("./ai-component-fixture.cjs");

const profile = process.env.STREAMER_ASSIST_TEST_PROFILE || path.join(__dirname, "../release/ai-component-smoke-" + Date.now());
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F6";

const repository = "yechankun/streamer-assist-ai-connectors";
const apiRoot = "https://api.github.com/repos/" + repository + "/releases/tags/";
const distributionUrl = "https://raw.githubusercontent.com/" + repository + "/distribution-v1/index.json";
const catalogUrl = "https://github.com/" + repository + "/releases/download/catalog-v1/catalog.json";
const providerIds = ["openai", "anthropic", "xai", "google", "deepseek", "moonshot"];
const providerSources = Object.fromEntries(providerIds.map(id => [id, resolveProviderSource(id)]));
const latestVersions = Object.fromEntries(providerIds.map(id => [id, providerSources[id].version || "0.1.0"]));
const packages = new Map();
const fetchRequests = [];
let failVersionChecks = false;
let nativeRemoveCalls = 0;
let apiModelListCalls = 0;

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function packProvider(id, version) {
  const root = providerSources[id].root;
  const relativeFiles = [
    "adapter.cjs",
    "providers/" + id + "/adapter.cjs",
    "lib/provider-adapter.cjs",
    "lib/provider-auth.cjs",
    "lib/provider-profile.cjs",
    "lib/provider-common.cjs",
    "lib/runtime-recipes.cjs",
  ];
  const files = relativeFiles.map(relative => {
    const file = path.join(root, relative);
    const content = relative === "adapter.cjs" && !fs.existsSync(file)
      ? Buffer.from("module.exports = require('./providers/" + id + "/adapter.cjs');")
      : fs.readFileSync(file);
    return { path: relative, content: content.toString("base64"), sha256: sha256(content) };
  });
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, abiVersion: 1, id, version, entry: "adapter.cjs", files }));
  const bytes = Buffer.from(JSON.stringify({ payload: payload.toString("base64") }));
  packages.set(id + "@" + version, bytes);
  return bytes;
}

for (const id of providerIds) packProvider(id, latestVersions[id]);

function catalogBytes() {
  const components = providerIds.map(id => {
    const version = latestVersions[id];
    const bytes = packages.get(id + "@" + version) || packProvider(id, version);
    return { id, version, abiVersion: 1, asset: id + "-v" + version + ".saip.json", sha256: sha256(bytes), size: bytes.length };
  });
  return Buffer.from(JSON.stringify({
    schemaVersion: 1, repository, generatedAt: "2026-10-06T00:00:00.000Z", abiVersion: 1, components,
  }));
}

function jsonResponse(bytes, status = 200) {
  return {
    ok: status >= 200 && status < 300, status, url: "",
    headers: { get() { return null; } },
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
  };
}

function distributionIndexBytes() {
  const publishedCatalogBytes = catalogBytes();
  const catalog = JSON.parse(publishedCatalogBytes.toString("utf8"));
  assert.equal(catalog.repository, repository, "fixture catalog identity matches the pinned repository");
  assert.equal(catalog.abiVersion, 1, "fixture catalog ABI matches the desktop");
  const catalogReceipt = {
    tag_name: "catalog-v1",
    assets: [{
      id: 7001,
      name: "catalog.json",
      size: publishedCatalogBytes.length,
      digest: "sha256:" + sha256(publishedCatalogBytes),
      browser_download_url: catalogUrl,
    }],
  };
  const assetIds = new Set([catalogReceipt.assets[0].id]);
  const releaseReceipts = catalog.components.map((row, index) => {
    const tag = row.id + "-v" + row.version;
    const bytes = packages.get(row.id + "@" + row.version);
    const name = row.asset;
    const url = "https://github.com/" + repository + "/releases/download/" + tag + "/" + name;
    assert.ok(bytes, "fixture package bytes exist for " + tag);
    assert.equal(row.size, bytes.length, "catalog size matches package fixture bytes for " + tag);
    assert.equal(row.sha256, sha256(bytes), "catalog digest matches package fixture bytes for " + tag);
    const assetId = 7002 + index;
    assert.equal(assetIds.has(assetId), false, "fixture release receipt asset IDs are unique");
    assetIds.add(assetId);
    return {
      tag_name: tag,
      assets: [{
        id: assetId,
        name,
        size: bytes.length,
        digest: "sha256:" + sha256(bytes),
        browser_download_url: url,
      }],
    };
  });
  assert.equal(catalogReceipt.assets[0].size, publishedCatalogBytes.length, "catalog receipt size matches its exact bytes");
  assert.equal(catalogReceipt.assets[0].digest, "sha256:" + sha256(publishedCatalogBytes), "catalog receipt digest matches its exact bytes");
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    repository,
    abiVersion: 1,
    generatedAt: catalog.generatedAt,
    catalog,
    catalogReceipt,
    catalogBytes: publishedCatalogBytes.toString("base64"),
    releaseReceipts,
  }));
}

async function fixtureFetch(url, options = {}) {
  fetchRequests.push({ url, options });
  if (options.method !== "GET" || options.referrerPolicy !== "no-referrer")
    throw new Error("Unexpected adapter request options");
  if (Object.keys(options.headers || {}).some(key => /authorization|cookie|referer/i.test(key)))
    throw new Error("Adapter fixture must not send credentials or referrers");
  if (url === distributionUrl) return failVersionChecks ? jsonResponse(Buffer.from("Fixture catalog unavailable"), 503) : jsonResponse(distributionIndexBytes());
  const assetMatch = /^https:\/\/github\.com\/yechankun\/streamer-assist-ai-connectors\/releases\/download\/(openai|anthropic|xai|google|deepseek|moonshot)-v([^/]+)\/\1-v\2\.saip\.json$/.exec(url);
  if (assetMatch) {
    const bytes = packages.get(assetMatch[1] + "@" + assetMatch[2]);
    if (bytes) return jsonResponse(bytes);
  }
  throw new Error("Blocked unmocked network request: " + url);
}

global.fetch = fixtureFetch;

const nativeExe = path.join(profile, "machine-cli", "codex.exe");
fs.mkdirSync(path.dirname(nativeExe), { recursive: true });
fs.writeFileSync(nativeExe, "native system CLI fixture");
class SmokeRuntimeManager {
  constructor({ root }) { this.root = root; }
  snapshot() {
    const components = ["codex", "claude", "grok", "agy", "kimi"].map(id => ({
      id, status: "ready", version: "system-fixture", source: "external", executable: id === "codex" ? nativeExe : null,
      progress: 0, bytes: 24, error: null,
    }));
    return { components, byId: Object.fromEntries(components.map(row => [row.id, row])) };
  }
  async resolve() { return null; }
  async pin() { return null; }
  release() {}
  async detect(id) { return this.snapshot().byId[id] || { id, status: "not-detected" }; }
  async info(id) { return { id, installedVersion: "system-fixture", latestVersion: "system-fixture", source: "smoke-fixture" }; }
  async remove() {
  nativeRemoveCalls++;
  fs.rmSync(nativeExe, { force: true });
  }
}
const mainFilename = path.resolve(__dirname, "../electron/main.cjs");
const originalModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "./ai-runtime.cjs" && parent?.filename === mainFilename) return { RuntimeManager: SmokeRuntimeManager };
  return originalModuleLoad.call(this, request, parent, isMain);
};

const apiModule = require("../electron/ai-api.cjs");
apiModule.listModels = async ({ provider }) => {
  apiModelListCalls++;
  return [{ id: "smoke-" + provider.id + "-model", name: "Local fixture model", efforts: ["low", "high"] }];
};
apiModule.runApi = async () => { throw new Error("Paid/provider analysis calls are disabled in this smoke test."); };
const modelModule = require("../electron/ai-models.cjs");
modelModule.readCliModels = async () => { throw new Error("CLI execution is disabled in this smoke test."); };

const timeout = setTimeout(() => {
  console.error("AI component desktop smoke timed out");
  app.exit(1);
}, 45000);

async function captureScreenshot(window, file) {
  let timer;
  try {
    const image = await Promise.race([
      window.webContents.capturePage(),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Screenshot capture timed out")), 3000); }),
    ]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, image.toPNG());
  } finally { clearTimeout(timer); }
}

app.on("browser-window-created", (_event, window) => {
  window.webContents.on("console-message", event => console.log("AI component renderer:", event.level, event.message));
  window.webContents.once("did-finish-load", async () => {
    try {
      window.webContents.setBackgroundThrottling(false);
      const run = code => window.webContents.executeJavaScript(code);
      const script = (fn, ...args) => run("(" + fn.toString() + ")(" + args.map(value => JSON.stringify(value)).join(",") + ")");
      const call = async (action, payload = {}) => {
        const result = await run("window.assist.call(" + JSON.stringify(action) + "," + JSON.stringify(payload) + ")");
        assert.equal(result.ok, true, action + ": " + (result.error || "IPC request failed"));
        return result.data;
      };
      const getState = () => script(async () => {
        let value;
        const off = window.assist.subscribe(state => { value = state; });
        await window.assist.call("state");
        off();
        return value;
      });
      const aiState = async () => (await call("ai-state"));
      const providerRow = async () => (await aiState()).providers.find(row => row.id === "openai");
      const providerNames = { openai: "OpenAI", anthropic: "Anthropic", xai: "xAI", google: "Google", deepseek: "DeepSeek", moonshot: "Moonshot" };
      const clickText = async (selector, text, index = 0) => {
        await waitFor(() => script((query, label, position) => {
          const button = [...document.querySelectorAll(query)].filter(item => item.textContent.includes(label))[position];
          return !!button && !button.disabled;
        }, selector, text, index), "component operation ready: " + text);
        return script((query, label, position) => {
        const button = [...document.querySelectorAll(query)].filter(item => item.textContent.includes(label))[position];
        if (!button) throw new Error("Missing button: " + query + " / " + label);
        if (button.disabled) throw new Error("Button is disabled: " + label);
        button.click();
        }, selector, text, index);
      };
      const openProviderPicker = async () => {
        await script(() => {
          const button = document.querySelector('[aria-label="AI 추가"]') || document.querySelector('[aria-label="AI 연결 추가"]') ||
            [...document.querySelectorAll("button")].find(item => item.textContent.trim() === "AI 추가");
          if (!button || button.disabled) throw new Error("AI add-provider picker is unavailable");
          button.click();
        });
        await waitFor(() => script(() => document.querySelector("dialog[open]")?.tagName === "DIALOG"), "native AI add-provider dialog");
      };
      const availablePickerChoices = () => script(() => {
        const dialog = document.querySelector("dialog[open]");
        return dialog ? [...dialog.querySelectorAll("button[aria-label]")].map(button => button.getAttribute("aria-label")).filter(label => label.endsWith(" 추가")) : [];
      });
      const addProviderFromPicker = async id => {
        const name = providerNames[id];
        await script(label => {
          const dialog = document.querySelector("dialog[open]");
          const button = [...(dialog?.querySelectorAll("button[aria-label]") || [])].find(item => item.getAttribute("aria-label") === label + " 추가");
          if (!button || button.disabled) throw new Error("Missing add-provider choice: " + label);
          button.click();
        }, name);
      };
      const assertPickerViewport = async (size, label) => {
        window.setSize(size[0], size[1]);
        await waitFor(() => script(expected => innerWidth === expected[0] && innerHeight === expected[1], size), label + " resize " + size.join("x"));
        await rendered(window);
        await assertLayout(window, label + " " + size.join("x"));
        const roots = await script(() => ["html", "body", "#root", ".layout", "main"].map(selector => {
          const element = document.querySelector(selector);
          return element ? { selector, height: element.clientHeight, scrollHeight: element.scrollHeight } : null;
        }).filter(Boolean));
        for (const root of roots) assert.ok(root.scrollHeight <= root.height + 1, label + " causes outer-page scroll at " + size.join("x") + ": " + JSON.stringify(root));
      };
      const setSelect = (selector, value) => script((query, next) => {
        const select = document.querySelector(query);
        if (!select || select.tagName !== "SELECT") throw new Error("Missing model select: " + query);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, next);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, selector, value);
      const setInput = (selector, value) => script((query, next) => {
        const input = document.querySelector(query);
        if (!input) throw new Error("Missing input: " + query);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, selector, value);
      const saveSettings = async () => {
        await clickText(".ai-settings-footer button.primary", "연결 저장");
        await waitFor(() => script(() => !document.querySelector(".ai-settings-footer button.primary")?.disabled), "settings saved");
      };
      const waitVersion = async (version, previous) => waitFor(async () => {
        const row = await providerRow();
        return row.component?.version === version && (previous === undefined || (previous === null ? row.component?.previousVersion === undefined : row.component?.previousVersion === previous));
      }, "adapter version " + version + (previous ? " with previous " + previous : ""));
      const waitRenderedVersion = (version, previous) => waitFor(() => script(expected => {
        const installed = document.querySelector(".ai-component-versions > div:first-child strong")?.textContent;
        const previousControl = document.querySelector(".ai-component-secondary button");
        return installed === expected.version && (expected.previous === null
          ? !previousControl
          : previousControl?.textContent.includes(expected.previous));
      }, { version: "v" + version, previous: previous ? "v" + previous : null }), "rendered adapter version " + version);

      await call("state");
      console.log("AI component smoke: app ready");
      await script(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("설정"))?.click());
      await waitFor(() => script(() => document.querySelector(".settings-tabs") !== null), "settings tabs");
      await script(() => [...document.querySelectorAll('[role="tab"]')].find(button => button.textContent.includes("AI 연결"))?.click());
      await waitFor(() => script(() => document.querySelector(".ai-settings") !== null), "AI settings view");
      console.log("AI component smoke: settings ready");
      const initialProviders = await aiState();
      assert.deepEqual(initialProviders.providers.map(row => row.id), providerIds, "all six available providers are represented in state");
      assert.ok(initialProviders.providers.every(row => row.added === false), "AI settings begin with an empty provider list");
      assert.equal(await script(() => document.querySelectorAll(".ai-provider").length), 0, "the provider rail starts empty");
      assert.equal(await script(() => !!document.querySelector(".ai-connection-panel, .ai-component-panel, .ai-mode-switch")), false, "empty settings do not show provider configuration");
      await assertPickerViewport([900, 650], "empty AI settings");
      await assertPickerViewport([1240, 850], "empty AI settings");

      await openProviderPicker();
      const choiceLabels = (await availablePickerChoices()).sort();
      assert.deepEqual(choiceLabels, Object.values(providerNames).map(name => name + " 추가").sort(), "picker offers every provider that has not been added");
      await waitFor(() => script(() => {
        const images = [...document.querySelectorAll(".ai-picker-grid .ai-provider-icon")];
        return images.length === 6 && images.every(image => image.complete && image.naturalWidth > 0);
      }), "all six bundled provider SVGs decode in the real renderer");
      for (const size of [[900, 650], [1240, 850]]) {
        await assertPickerViewport(size, "AI add-provider dialog");
        if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1")
          await captureScreenshot(window, path.join(__dirname, "../release/ai-component-picker-" + size[0] + "x" + size[1] + ".png"));
      }
      await script(() => { document.documentElement.dataset.theme = "light"; });
      await assertPickerViewport([900, 650], "AI brand icons in light theme");
      await settleUI(window);
      if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1")
        await captureScreenshot(window, path.join(__dirname, "../release/ai-component-picker-light.png"));
      await script(() => { document.documentElement.dataset.theme = "dark"; });
      await settleUI(window);

      await addProviderFromPicker("openai");
      await waitFor(async () => (await providerRow()).added === true, "OpenAI provider added from picker");
      await waitFor(async () => (await providerRow()).component?.version === latestVersions.openai, "adapter automatically installed when OpenAI was added", 15000);
      await waitFor(() => script(() => !document.querySelector("dialog[open]") && !!document.querySelector(".ai-mode-switch")), "OpenAI settings after automatic install");
      const installedRow = await providerRow();
      assert.equal(installedRow.component.status, "installed");
      assert.equal(installedRow.component.source, "github");
      assert.ok(fetchRequests.some(item => item.url === distributionUrl), "provider addition reads the fixed raw publisher index");
      assert.equal(fetchRequests.some(item => item.url.startsWith(apiRoot)), false, "publisher-receipt mode makes no per-user GitHub REST API calls");
      assert.equal(fetchRequests.some(item => item.url === catalogUrl), false, "the exact catalog bytes come from the verified publisher index");
      assert.ok(fetchRequests.some(item => item.url.includes(`/openai-v${latestVersions.openai}/`)), "provider addition automatically downloads the selected adapter fixture");
      assert.equal(fetchRequests.some(item => item.url !== distributionUrl && !item.url.startsWith("https://github.com/" + repository + "/releases/download/")), false, "requests use only the fixed raw index and pinned repository release asset URLs");

      await clickText('[aria-label="AI 연결 모듈 관리"]', "");
      await waitFor(() => script(() => !!document.querySelector(".ai-component-panel")), "installed component maintenance opened");
      await waitFor(async () => (await providerRow()).component?.updateCheckStatus === "checked", "automatic component version check");
      await waitFor(() => script(() => document.querySelector('[aria-label="AI 연결 모듈 업데이트"]')?.disabled && document.querySelector('[aria-label="AI 연결 모듈 업데이트"]')?.textContent.includes("최신 버전")), "current component does not offer an unnecessary update");
      failVersionChecks = true;
      await clickText(".ai-component-buttons button", "버전 확인");
      await waitFor(async () => (await providerRow()).component?.updateCheckStatus === "failed", "failed component release check is recorded");
      await waitFor(() => script(() => document.querySelector('[aria-label="AI 연결 모듈 업데이트"]')?.disabled && document.querySelector(".ai-component-message")?.textContent.length > 0), "failed component check disables update and shows the error");
      failVersionChecks = false;
      await clickText(".ai-component-buttons button", "버전 확인");
      await waitFor(async () => (await providerRow()).component?.updateCheckStatus === "checked", "component version lookup can recover after a failure");
      await clickText(".ai-component-buttons button", "연결 설정");

      // Use the actual installed provider adapter for the API model list. The
      // transport itself is mocked and no analysis prompt is sent.
      await clickText(".ai-mode-switch button", "API");
      await setInput('[aria-label="AI API 키"]', "smoke-openai-api-credential");
      await clickText('[aria-label="AI 모델 목록 조회"]', "");
      await waitFor(() => script(() => document.querySelector('[aria-label="AI 모델"]')?.value === "smoke-openai-model"), "mocked API model list");
      assert.equal(apiModelListCalls, 1);
      await setSelect('[aria-label="AI 모델"]', "smoke-openai-model");
      await setSelect('[aria-label="AI 추론 정도"]', "high");
      await saveSettings();
      let savedProvider = await providerRow();
      assert.equal(savedProvider.mode, "api");
      assert.equal(savedProvider.hasKey, true);

      // Publish an update only to the local fixture, then exercise update,
      // rollback and module removal through renderer IPC.
      const [major, minor, patch] = latestVersions.openai.split(".").map(Number);
      latestVersions.openai = `${major}.${minor}.${patch + 1}`;
      packProvider("openai", latestVersions.openai);
      await clickText('[aria-label="AI 연결 모듈 관리"]', "");
      await waitFor(() => script(() => !!document.querySelector(".ai-component-panel")), "component management pane reopened");
      await clickText(".ai-component-buttons button", "버전 확인");
      await waitFor(async () => (await providerRow()).component?.latestVersion === latestVersions.openai, "new component version checked");
      await waitFor(() => script(() => !document.querySelector(".ai-component-buttons button.primary")?.disabled), "update check action completed");
      await clickText(".ai-component-buttons button.primary", "업데이트");
      await waitVersion(latestVersions.openai, providerSources.openai.version || "0.1.0");
      await waitRenderedVersion(latestVersions.openai, providerSources.openai.version || "0.1.0");
      await waitFor(() => script(() => document.querySelector('[aria-label="AI 연결 모듈 업데이트"]')?.disabled && document.querySelector('[aria-label="AI 연결 모듈 업데이트"]')?.textContent.includes("최신 버전")), "installing the latest component disables update again");
      await clickText(".ai-component-secondary button", "복원");
      await waitVersion(providerSources.openai.version || "0.1.0", latestVersions.openai);
      await waitRenderedVersion(providerSources.openai.version || "0.1.0", latestVersions.openai);
      await waitFor(() => script(() => document.querySelector('[aria-label="AI 연결 모듈 업데이트"]')?.disabled === false), "rollback enables the confirmed newer component again");
      await clickText(".ai-component-secondary button", "연결 모듈 제거");
      await waitFor(async () => (await providerRow()).component?.version === undefined, "adapter removed");
      await waitFor(() => script(() => !!document.querySelector(".ai-component-panel")), "removed component pane rendered");
      savedProvider = await providerRow();
      assert.equal(savedProvider.hasKey, true, "removing a connector module does not delete the separately saved API key");
      assert.equal(savedProvider.component.status, "not-installed");
      assert.equal(nativeRemoveCalls, 0, "adapter removal never calls native CLI removal");
      assert.equal(fs.readFileSync(nativeExe, "utf8"), "native system CLI fixture", "native CLI file remains untouched");

      await waitFor(() => script(() => document.querySelector('[aria-label="OpenAI 제거"]')?.disabled === false), "adapter removal job finished before removing provider");
      await script(() => {
        const button = document.querySelector('[aria-label="OpenAI 제거"]');
        if (!button || button.disabled) throw new Error("OpenAI remove-provider button is missing or disabled");
        button.click();
      });
      await waitFor(async () => (await providerRow()).added === false, "OpenAI provider removed from settings");
      await waitFor(() => script(() => !document.querySelector(".ai-connection-panel, .ai-component-panel")), "empty settings after provider removal");
      savedProvider = await providerRow();
      assert.equal(savedProvider.hasKey, true, "removing a provider profile retains its encrypted API key");
      assert.equal(savedProvider.component.status, "not-installed", "removing the provider does not reinstall or remove a different component");
      assert.equal(nativeRemoveCalls, 0, "removing a provider profile never removes its native CLI");
      assert.equal(fs.readFileSync(nativeExe, "utf8"), "native system CLI fixture", "native CLI survives provider removal");

      await openProviderPicker();
      const choicesAfterRemoval = (await availablePickerChoices()).sort();
      assert.deepEqual(choicesAfterRemoval, Object.values(providerNames).map(name => name + " 추가").sort(), "removed provider is available to add again");
      const requestsBeforeReadd = fetchRequests.length;
      await addProviderFromPicker("openai");
      await waitFor(async () => (await providerRow()).added === true, "OpenAI provider re-added");
      await waitFor(async () => (await providerRow()).component?.version === latestVersions.openai, "adapter automatically reinstalled after provider re-add", 15000);
      await waitFor(() => script(() => !document.querySelector("dialog[open]") && !!document.querySelector(".ai-mode-switch")), "OpenAI settings after provider re-add");
      savedProvider = await providerRow();
      assert.equal(savedProvider.hasKey, true, "re-adding the provider restores access to its retained encrypted API key");
      assert.equal(savedProvider.component.source, "github");
      assert.ok(fetchRequests.length > requestsBeforeReadd, "re-adding a provider with a removed adapter performs a local-fixture download");
      assert.equal(nativeRemoveCalls, 0, "provider removal and re-add never invoke native CLI removal");

      const providerState = await aiState();
      assert.equal(providerState.providers.find(row => row.id === "openai").hasKey, true);
      assert.equal(providerState.providers.find(row => row.id === "openai").added, true);
      assert.equal(Object.hasOwn(providerState.providers.find(row => row.id === "openai"), "key"), false);
      const credentialFile = path.join(profile, "ai", "credentials.enc");
      assert.equal(fs.readFileSync(credentialFile, "utf8").includes("smoke-openai-api-credential"), false, "saved fixture key is not plaintext");
      assert.ok(packages.size >= 7, "fixture included verified adapters and an update payload");
      clearTimeout(timeout);
      console.log("PASS: empty AI settings and provider picker, offline auto-install/update/rollback/module and provider removal/re-add, protected key retention, no native CLI removal, responsive picker layout");
      app.quit();
    } catch (error) {
      console.error(error?.stack || error);
      try { await captureScreenshot(window, path.join(__dirname, "../release/ai-component-smoke-failure.png")); }
      catch (captureError) { console.error("Component smoke screenshot failed: " + captureError.message); }
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});

require("../electron/main.cjs");
