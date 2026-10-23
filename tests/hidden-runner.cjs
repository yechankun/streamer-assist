// Keep layout observers active for hidden desktop tests without changing the
// app's normal tray/background behavior.
const { app, ipcMain } = require("electron");
const path = require("node:path");
// Match browser automation defaults when a test window is behind another app.
// Application visibility handlers and runtime pausing remain under test.
for (const flag of ["disable-background-timer-throttling", "disable-backgrounding-occluded-windows", "disable-renderer-backgrounding", "disable-ipc-flooding-protection"])
  app.commandLine.appendSwitch(flag);
app.on("browser-window-created", (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
});
// The normal tray policy stops renderer snapshots for hidden windows. Tests
// explicitly request a fresh read-only snapshot after IPC operations so their
// observers stay current without changing visibility or shipping test hooks.
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, callback) => {
  if (channel !== "assist:call") return handle(channel, callback);
  return handle(channel, async (event, action, ...args) => {
    const result = await callback(event, action, ...args);
    if (action !== "state" && result?.ok) await callback(event, "state");
    return result;
  });
};
require(path.resolve(process.argv[2]));
