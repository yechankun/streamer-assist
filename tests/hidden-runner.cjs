// Keep layout observers active for hidden desktop tests without changing the
// app's normal tray/background behavior.
const { app } = require("electron");
const path = require("node:path");
app.on("browser-window-created", (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
});
require(path.resolve(process.argv[2]));
