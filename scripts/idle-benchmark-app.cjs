// Production bundle, private empty profile, no real credentials/chat, no forced GC.
const { app, ipcMain } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const root = process.env.STREAMER_IDLE_ROOT, profile = process.env.STREAMER_IDLE_PROFILE;
app.setPath("userData", profile);
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F14";
const calls = {}, sends = {}, delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const { Engine } = require(path.join(root, "electron/engine.cjs")), snapshot = Engine.prototype.snapshot;
Engine.prototype.snapshot = function (...args) { calls["engine:snapshot"] = (calls["engine:snapshot"] || 0) + 1; return snapshot.apply(this, args); };
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, callback) => handle(channel, (event, action, ...args) => {
  const key = channel + ":" + action; calls[key] = (calls[key] || 0) + 1;
  return callback(event, action, ...args);
});
const difference = (before, after) => Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - (before[key] || 0)]).filter(([, count]) => count));
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
app.once("browser-window-created", (_event, win) => {
  const send = win.webContents.send.bind(win.webContents);
  win.webContents.send = (channel, ...args) => { sends[channel] = (sends[channel] || 0) + 1; return send(channel, ...args); };
  win.webContents.once("did-finish-load", async () => {
    const js = (fn, ...args) => win.webContents.executeJavaScript("(" + fn.toString() + ")(" + args.map(value => JSON.stringify(value)).join(",") + ")");
    const wait = async (fn, label) => { for (let i = 0; i < 150; i++) { if (await js(fn)) return; await delay(30); } throw Error("Not ready: " + label); };
    try {
      await wait(() => !!document.querySelector("main") && !!window.assist, "renderer");
      win.webContents.debugger.attach("1.3");
      await win.webContents.debugger.sendCommand("Performance.enable");
      const renderer = async () => Object.fromEntries((await win.webContents.debugger.sendCommand("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
      const phases = [], milliseconds = Number(process.env.STREAMER_IDLE_SAMPLE_MS);
      const sample = async name => {
        await delay(2000);
        const beforeCalls = {...calls}, beforeSends = {...sends}, before = await renderer(), usage = process.cpuUsage(), started = performance.now();
        let previousMetrics = app.getAppMetrics(), previousAt = performance.now();
        const rows = [];
        for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
          await delay(Math.min(1000, milliseconds - elapsed));
          const metrics = app.getAppMetrics();
          const at = performance.now(), prior = new Map(previousMetrics.map(metric => [metric.pid, metric]));
          const cumulative = metrics.every(metric => Number.isFinite(metric.cpu.cumulativeCPUUsage));
          const cpuPercent = cumulative ? metrics.reduce((sum, metric) => {
            const previous = prior.get(metric.pid); if (!previous || metric.creationTime !== previous.creationTime) return sum;
            return sum + Math.max(0, metric.cpu.cumulativeCPUUsage - previous.cpu.cumulativeCPUUsage);
          }, 0) / ((at - previousAt) / 1000) * 100 / os.cpus().length : metrics.reduce((sum, metric) => sum + Math.max(0, metric.cpu.percentCPUUsage), 0);
          rows.push({ cpu: cpuPercent, cumulative, workingSet: metrics.reduce((sum, metric) => sum + (metric.memory?.workingSetSize || 0), 0), privateBytes: metrics.reduce((sum, metric) => sum + (metric.memory?.privateBytes || 0), 0), processes: metrics.length });
          previousMetrics = metrics; previousAt = at;
        }
        const end = await renderer(), cpu = process.cpuUsage(usage), seconds = (performance.now() - started) / 1000;
        const phase = { name, seconds, cpuPercentMean: mean(rows.map(row => row.cpu)), mainCpuMilliseconds: (cpu.user + cpu.system) / 1000,
          workingSetMiB: mean(rows.map(row => row.workingSet)) / 1024, privateMiB: mean(rows.map(row => row.privateBytes)) / 1024,
          rendererHeapMiB: end.JSHeapUsedSize / 1024 / 1024, rendererTaskMilliseconds: (end.TaskDuration - before.TaskDuration) * 1000,
          rendererScriptMilliseconds: (end.ScriptDuration - before.ScriptDuration) * 1000, processes: rows.at(-1).processes,
          cpuCounterMethod: rows.every(row => row.cumulative) ? "cumulative CPU time normalized by logical processors" : "native percentCPUUsage, clamped nonnegative",
          calls: difference(beforeCalls, calls), sends: difference(beforeSends, sends) };
        phases.push(phase); console.log(JSON.stringify(phase));
      };
      await sample("home-visible");
      win.minimize(); await sample("home-minimized");
      win.restore(); win.hide(); await sample("home-tray");
      win.showInactive();
      await js(() => window.assist.workspace("open", {id:"settings", section:"ai"}));
      await js(() => { const button = [...document.querySelectorAll("button")].find(button => button.textContent.trim() === "AI 연결"); if (button) button.click(); });
      await wait(() => !!document.querySelector(".ai-settings"), "AI settings");
      await sample("ai-visible");
      win.hide(); await sample("ai-tray");
      const report = { capturedAt: new Date().toISOString(), platform: process.platform, electron: process.versions.electron, node: process.versions.node, logicalProcessors: os.cpus().length,
        cpuMethod: "per-phase cpuCounterMethod; cumulative CPU deltas normalized by logical processor count when available", memoryMethod: "sum of app process private bytes/working sets in KiB converted to MiB; shared resident pages may be counted more than once", sampleMilliseconds: milliseconds, noForcedGarbageCollection: true, isolatedEmptyProfile: true, phases };
      const output = process.env.STREAMER_IDLE_OUTPUT; fs.mkdirSync(path.dirname(output), {recursive:true}); fs.writeFileSync(output, JSON.stringify(report, null, 2));
      win.webContents.debugger.detach(); app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require(path.join(root, "electron/main.cjs"));
