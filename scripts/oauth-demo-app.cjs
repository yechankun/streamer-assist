// Real application, real OAuth and real platform APIs. A separate profile keeps
// local demo records apart from the broadcaster's normal installation.
const fs = require("node:fs"), path = require("node:path"), { parseEnv } = require("node:util");
const root = path.resolve(__dirname, ".."), { app } = require("electron");
const profile = process.env.STREAMER_ASSIST_OAUTH_DEMO_PROFILE;
if (!profile || !path.resolve(profile).startsWith(path.join(root, "release", "google-oauth-demo") + path.sep))
  throw Error("The OAuth demo requires its dedicated recording profile.");
const source = parseEnv(fs.readFileSync(path.join(root, ".env.local"), "utf8"));
const expected = require("../electron/oauth-config.json").youtubeClientId;
if (source.STREAMER_ASSIST_GOOGLE_CLIENT_ID !== expected || !source.STREAMER_ASSIST_GOOGLE_CLIENT_SECRET)
  throw Error("The demo must use the submitted OAuth client configuration.");
process.env.STREAMER_ASSIST_GOOGLE_CLIENT_ID = expected;
process.env.STREAMER_ASSIST_GOOGLE_CLIENT_SECRET = source.STREAMER_ASSIST_GOOGLE_CLIENT_SECRET;
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F10";
if (process.env.STREAMER_ASSIST_OAUTH_DEMO_BROWSER_PORT === "9332") {
  const authModule = require("../electron/oauth.cjs"), RealAuth = authModule.AuthManager;
  authModule.AuthManager = class extends RealAuth {
    constructor(options) { super({ ...options, openBrowser: async url => {
      const { attach } = require("./oauth-demo-cdp.cjs"); const browser = await attach(9332);
      try { const target = new URL(url); target.searchParams.set("hl", "en"); await browser.call("Page.navigate", { url: target.toString() }); }
      finally { browser.close(); }
    } }); }
  };
}
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
if (!fs.existsSync(path.join(profile, "preferences.json")))
  fs.writeFileSync(path.join(profile, "preferences.json"), JSON.stringify({ autoRecord: false, trayEnabled: false, chatCaptureMode: "deferred" }));
app.on("browser-window-created", (_event, window) => {
  window.setTitle("Streamer Assist · OAuth recording profile");
  window.webContents.once("did-finish-load", () => {
    // Selecting a visible section changes no account or platform data.
    void window.webContents.executeJavaScript("new Promise(resolve => { const deadline = Date.now() + 10000; function ready() { const button = [...document.querySelectorAll('nav button')].find(button => button.textContent.includes('설정')); if (button) { button.click(); resolve(); } else if (Date.now() < deadline) setTimeout(ready, 40); else resolve(); } ready(); })").catch(() => {});
  });
});
require("../electron/main.cjs");
