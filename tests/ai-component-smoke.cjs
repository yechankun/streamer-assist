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
const { assertLayout, waitFor, rendered } = require("./layout-check.cjs");
const { resolveProviderSource } = require("./ai-component-fixture.cjs");

const profile = process.env.STREAMER_ASSIST_TEST_PROFILE || path.join(__dirname, "../release/ai-component-smoke-" + Date.now());
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F6";

const repository = "yechankun/streamer-assist-ai-connectors";
const apiRoot = "https://api.github.com/repos/" + repository + "/releases/tags/";
const catalogUrl = "https://github.com/" + repository + "/releases/download/catalog-v1/catalog.json";
const providerIds = ["openai", "anthropic", "xai", "google", "deepseek", "moonshot"];
const providerSources = Object.fromEntries(providerIds.map(id => [id, resolveProviderSource(id)]));
const latestVersions = Object.fromEntries(providerIds.map(id => [id, providerSources[id].version || "0.1.0"]));
const packages = new Map();
const fetchRequests = [];
let nativeRemoveCalls = 0;
let apiModelListCalls = 0;

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function packProvider(id, version) {
  const root = providerSources[id].root;
  const relativeFiles = [
    "adapter.cjs",
    "providers/" + id + "/adapter.cjs",
    "lib/provider-adapter.cjs",
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

function releaseMetadata(tag, name, bytes, url) {
  return Buffer.from(JSON.stringify({
    tag_name: tag,
    assets: [{ id: 7001, name, size: bytes.length, digest: "sha256:" + sha256(bytes), browser_download_url: url }],
  }));
}

async function fixtureFetch(url, options = {}) {
  fetchRequests.push({ url, options });
  if (options.method !== "GET" || options.referrerPolicy !== "no-referrer")
    throw new Error("Unexpected adapter request options");
  if (Object.keys(options.headers || {}).some(key => /authorization|cookie|referer/i.test(key)))
    throw new Error("Adapter fixture must not send credentials or referrers");
  if (url.startsWith(apiRoot)) {
    const tag = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
    if (tag === "catalog-v1") {
      const bytes = catalogBytes();
      return jsonResponse(releaseMetadata(tag, "catalog.json", bytes, catalogUrl));
    }
    const match = /^(openai|anthropic|xai|google|deepseek|moonshot)-v(.+)$/.exec(tag);
    const bytes = match && packages.get(match[1] + "@" + match[2]);
    if (!bytes) return jsonResponse(Buffer.from("{}"), 404);
    const name = match[1] + "-v" + match[2] + ".saip.json";
    const assetUrl = "https://github.com/" + repository + "/releases/download/" + tag + "/" + name;
    return jsonResponse(releaseMetadata(tag, name, bytes, assetUrl));
  }
  if (url === catalogUrl) return jsonResponse(catalogBytes());
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
      const clickText = (selector, text, index = 0) => script((query, label, position) => {
        const button = [...document.querySelectorAll(query)].filter(item => item.textContent.includes(label))[position];
        if (!button) throw new Error("Missing button: " + query + " / " + label);
        if (button.disabled) throw new Error("Button is disabled: " + label);
        button.click();
      }, selector, text, index);
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
      await waitFor(async () => (await providerRow()).component?.version === undefined, "initial adapter is missing");
      assert.equal(await script(() => !!document.querySelector(".ai-component-panel")), true, "missing component renders GitHub install pane");
      assert.equal(await script(() => !!document.querySelector(".ai-mode-switch")), false, "connection controls stay unavailable before installation");
      const repoLabel = await script(() => document.querySelector(".ai-component-source strong")?.textContent);
      assert.equal(repoLabel, repository, "pane names the fixed connector repository");
      const initialPane = await providerRow();
      assert.equal(initialPane.component.status, "not-installed");

      for (const size of [[900, 650], [1240, 850]]) {
        window.setSize(size[0], size[1]);
        await waitFor(() => script(expected => innerWidth === expected[0] && innerHeight === expected[1], size), "component pane resize " + size.join("x"));
        await rendered(window);
        await assertLayout(window, "missing component pane " + size.join("x"));
        if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1")
          await captureScreenshot(window, path.join(__dirname, "../release/ai-component-missing-" + size[0] + "x" + size[1] + ".png"));
      }

      await clickText(".ai-component-buttons button", "버전 확인");
      console.log("AI component smoke: version check clicked");
      await waitFor(async () => (await providerRow()).component?.latestVersion === latestVersions.openai, "latest component version checked");
      await waitFor(() => script(() => !document.querySelector(".ai-component-buttons button.primary")?.disabled), "version check action completed");
      await clickText(".ai-component-buttons button.primary", "다운로드·추가");
      await waitVersion(latestVersions.openai, null);
      await waitFor(() => script(() => !!document.querySelector(".ai-mode-switch")), "connection controls after install");
      const installedRow = await providerRow();
      assert.equal(installedRow.component.status, "installed");
      assert.equal(installedRow.component.source, "github");
      assert.ok(fetchRequests.some(item => item.url.startsWith(apiRoot)), "local fixtures exercised GitHub release verification flow");
      assert.equal(fetchRequests.some(item => !item.url.startsWith(apiRoot) && item.url !== catalogUrl && !item.url.startsWith("https://github.com/" + repository + "/releases/download/")), false, "no requests escape the local GitHub URL fixture");

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
      await clickText(".ai-component-secondary button", "복원");
      await waitVersion(providerSources.openai.version || "0.1.0", latestVersions.openai);
      await waitRenderedVersion(providerSources.openai.version || "0.1.0", latestVersions.openai);
      await clickText(".ai-component-secondary button", "연결 모듈 제거");
      await waitFor(async () => (await providerRow()).component?.version === undefined, "adapter removed");
      await waitFor(() => script(() => !!document.querySelector(".ai-component-panel")), "removed component pane rendered");
      savedProvider = await providerRow();
      assert.equal(savedProvider.hasKey, true, "removing a connector module does not delete the separately saved API key");
      assert.equal(savedProvider.component.status, "not-installed");
      assert.equal(nativeRemoveCalls, 0, "adapter removal never calls native CLI removal");
      assert.equal(fs.readFileSync(nativeExe, "utf8"), "native system CLI fixture", "native CLI file remains untouched");

      const providerState = await aiState();
      assert.equal(providerState.providers.find(row => row.id === "openai").hasKey, true);
      assert.equal(Object.hasOwn(providerState.providers.find(row => row.id === "openai"), "key"), false);
      const credentialFile = path.join(profile, "ai", "credentials.enc");
      assert.equal(fs.readFileSync(credentialFile, "utf8").includes("smoke-openai-api-credential"), false, "saved fixture key is not plaintext");
      assert.ok(packages.size >= 7, "fixture included verified adapters and an update payload");
      clearTimeout(timeout);
      console.log("PASS: GitHub adapter pane, fixed-source check, offline fixture install/update/rollback/remove, protected key retention, no native CLI removal, responsive missing-module layout");
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
