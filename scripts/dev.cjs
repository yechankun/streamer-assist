const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const root = path.resolve(__dirname, "..");
const devDirectory = path.join(root, ".dev");
const statusFile = path.join(devDirectory, "status.json");
const PREFLIGHT_MODULES = Object.freeze([
  "electron/engine.cjs",
  "electron/record-store.cjs",
  "electron/timeline-store.cjs",
  "electron/timeline-export.cjs",
  "electron/broadcast-monitor.cjs",
  "electron/startup.cjs",
  "electron/roulette.cjs",
  "electron/platforms.cjs",
  "electron/oauth.cjs",
  "electron/preferences.cjs",
  "electron/app-icon.cjs",
  "electron/ai-catalog.cjs",
  "electron/ai-context.cjs",
  "electron/ai-usage.cjs",
  "electron/ai-api.cjs",
  "electron/ai-models.cjs",
  "electron/ai-quota.cjs",
  "electron/ai-runtime.cjs",
  "electron/ai-components.cjs",
  "electron/ai-service.cjs",
  "electron/platform-info.json",
]);
const PREFLIGHT_SYNTAX_FILES = Object.freeze(["electron/main.cjs", "electron/preload.cjs"]);
let server, watcher, controlWatcher, child, debounce;
let shuttingDown = false;
let ownsStatus = false;
const expectedExits = new WeakSet();
let restartQueue = Promise.resolve();
let lastPreflightErrorAt = 0;

function reportPreflightFailure(context, result = {}) {
  const now = Date.now();
  if (now - lastPreflightErrorAt < 5000) return;
  lastPreflightErrorAt = now;
  console.error(`[dev] Backend preflight failed (${context}); Electron was not launched or replaced. Waiting for an electron/ file change.`);
  if (result.output) console.error(result.output);
  else if (result.error) console.error(`[dev] Preflight child failed: ${result.error.message}`);
}

function preflightBackend({ root: sourceRoot = root, modules = PREFLIGHT_MODULES, syntaxFiles = PREFLIGHT_SYNTAX_FILES, spawnImpl = spawn, nodePath = process.execPath } = {}) {
  const modulePaths = modules.map(file => path.resolve(sourceRoot, file));
  const syntaxPaths = syntaxFiles.map(file => path.resolve(sourceRoot, file));
  const script = `
    const fs = require('node:fs');
    const vm = require('node:vm');
    const modules = ${JSON.stringify(modulePaths)};
    const syntaxFiles = ${JSON.stringify(syntaxPaths)};
    for (const file of modules) {
      try { require(file); }
      catch (error) {
        process.stderr.write('[preflight] ' + file + ': ' + (error && error.stack || error) + '\\n');
        process.exitCode = 1;
        break;
      }
    }
    if (!process.exitCode) for (const file of syntaxFiles) {
      try { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }); }
      catch (error) {
        process.stderr.write('[preflight] ' + file + ': ' + (error && error.stack || error) + '\\n');
        process.exitCode = 1;
        break;
      }
    }
  `;
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  return new Promise(resolve => {
    let output = "", finished = false;
    const append = chunk => {
      if (output.length < 24 * 1024) output += chunk.toString("utf8").slice(0, 24 * 1024 - output.length);
    };
    const finish = result => {
      if (finished) return;
      finished = true;
      resolve({ ...result, output: output.trim() });
    };
    let candidate;
    try {
      candidate = spawnImpl(nodePath, ["-e", script], {
        cwd: sourceRoot,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      finish({ ok: false, error });
      return;
    }
    candidate.stdout?.on("data", append);
    candidate.stderr?.on("data", append);
    candidate.once("error", error => finish({ ok: false, error }));
    candidate.once("close", (code, signal) => finish({ ok: code === 0, code, signal }));
  });
}

async function preflightAndStart() {
  const sourceSignature = electronTreeSignature();
  if (!sourceSignature) {
    status("preflight-error", null);
    reportPreflightFailure("source files are changing or unavailable");
    return false;
  }
  const result = await preflightBackend();
  if (!result.ok) {
    const active = child && child.exitCode === null && child.signalCode === null;
    if (!active) status("preflight-error", null);
    reportPreflightFailure("module import or syntax validation", result);
    return false;
  }
  if (sourceSignature !== electronTreeSignature()) {
    if (!child || child.exitCode !== null || child.signalCode !== null) status("preflight-error", null);
    console.log("[dev] Electron sources changed during preflight; waiting for another file-change check.");
    return false;
  }
  lastPreflightErrorAt = 0;
  startElectron();
  return true;
}

function status(phase, electronPid = child?.pid) {
  if (!ownsStatus) return;
  fs.writeFileSync(
    statusFile,
    JSON.stringify(
      {
        phase,
        supervisorPid: process.pid,
        electronPid,
        url: "http://127.0.0.1:5173",
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function electronTreeSignature() {
  const directory = path.join(root, "electron");
  const hash = crypto.createHash("sha256");
  const visit = current => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.(?:cjs|js|json)$/.test(entry.name)) {
        hash.update(path.relative(directory, file));
        hash.update(fs.readFileSync(file));
      }
    }
  };
  try {
    visit(directory);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

async function stopElectron() {
  const previous = child;
  if (!previous || previous.exitCode !== null || previous.signalCode !== null)
    return;
  expectedExits.add(previous);
  const exited = once(previous, "exit");
  const force = setTimeout(() => previous.kill(), 5000);
  try {
    if (previous.connected)
      previous.send({ type: "dev-shutdown" }, (error) => {
        if (error) previous.kill();
      });
    else previous.kill();
    await exited;
  } finally {
    clearTimeout(force);
    if (child === previous) child = null;
  }
}

function startElectron() {
  if (shuttingDown) return;
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(
    require("electron"),
    [
      root,
      "--dev",
      ...(process.argv.includes("--devtools") ? ["--devtools"] : []),
    ],
    {
      cwd: root,
      env: environment,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      windowsHide: true,
    },
  );
  const running = child;
  status("starting");
  console.log(`[dev] Electron starting (PID ${running.pid})`);
  running.on("message", (message) => {
    if (message?.type === "dev-ready" && child === running) {
      if (message.uiReady && message.bridgeReady) {
        status("ready");
        console.log(
          "[dev] App ready. React/CSS: instant updates. Electron: automatic restart. F12: DevTools.",
        );
      } else {
        status("renderer-error");
        console.error(
          "[dev] Renderer did not initialize. Open F12 to inspect errors.",
        );
      }
    }
  });
  running.on("error", (error) => {
    console.error(error);
    void shutdown(1);
  });
  running.on("exit", (code) => {
    if (expectedExits.has(running) || shuttingDown) return;
    child = null;
    if (code === 0) void shutdown(0);
    else {
      status("crashed");
      console.error(
        `[dev] Electron exited (${code}). Fix and save an electron/ file to restart.`,
      );
    }
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(debounce);
  watcher?.close();
  controlWatcher?.close();
  await stopElectron();
  await server?.close();
  status("stopped", null);
  process.exit(code);
}

async function main() {
  fs.mkdirSync(devDirectory, { recursive: true });
  const { createServer } = await import("vite");
  server = await createServer({
    root,
    mode: "development",
    clearScreen: false,
  });
  await server.listen();
  ownsStatus = true;
  server.printUrls();
  const envFile = path.join(root, ".env.local");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const stopRequest = path.join(devDirectory, "stop-request");
  if (fs.existsSync(stopRequest)) fs.unlinkSync(stopRequest);
  controlWatcher = fs.watch(devDirectory, (_event, filename) => {
    if (filename === "stop-request" && fs.existsSync(stopRequest)) {
      fs.unlinkSync(stopRequest);
      void shutdown();
    }
  });
  controlWatcher.on("error", (error) => {
    console.error(error);
    void shutdown(1);
  });
  watcher = fs.watch(
    path.join(root, "electron"),
    { recursive: true },
    (_event, filename) => {
      if (!filename || !/\.(cjs|js|json)$/.test(filename)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        restartQueue = restartQueue
          .then(async () => {
            if (shuttingDown) return;
            console.log(`[dev] electron/${filename} changed. Checking backend imports...`);
            const sourceSignature = electronTreeSignature();
            if (!sourceSignature) {
              reportPreflightFailure("source files are changing or unavailable; keeping the current app process");
              if (!child || child.exitCode !== null || child.signalCode !== null) status("preflight-error", null);
              return;
            }
            const preflight = await preflightBackend();
            if (!preflight.ok) {
              const active = child && child.exitCode === null && child.signalCode === null;
              if (!active) status("preflight-error", null);
              reportPreflightFailure("module import or syntax validation; keeping the current app process", preflight);
              return;
            }
            if (sourceSignature !== electronTreeSignature()) {
              if (!child || child.exitCode !== null || child.signalCode !== null) status("preflight-error", null);
              console.log("[dev] Electron sources changed during preflight; keeping the current app process and waiting for another file-change check.");
              return;
            }
            lastPreflightErrorAt = 0;
            console.log("[dev] Backend preflight passed. Restarting Electron...");
            status("restarting");
            await stopElectron();
            startElectron();
          })
          .catch((error) => {
            console.error(error);
            void shutdown(1);
          });
      }, 250);
    },
  );
  watcher.on("error", (error) => {
    console.error(error);
    void shutdown(1);
  });
  restartQueue = restartQueue.then(async () => {
    if (!shuttingDown) await preflightAndStart();
  });
  await restartQueue;
}

async function requestStop() {
  if (
    !fs.existsSync(statusFile) ||
    JSON.parse(fs.readFileSync(statusFile, "utf8")).phase === "stopped"
  ) {
    console.log("[dev] No development app is running.");
    return;
  }
  fs.writeFileSync(path.join(devDirectory, "stop-request"), "stop");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (JSON.parse(fs.readFileSync(statusFile, "utf8")).phase === "stopped") {
      console.log("[dev] App and server stopped.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Development app did not stop. Use its tray menu to quit.");
}

if (require.main === module) {
  if (process.argv.includes("--stop")) {
    requestStop().catch((error) => {
      console.error(`[dev] ${error.message}`);
      process.exitCode = 1;
    });
  } else {
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    main().catch((error) => {
      console.error(`[dev] ${error.message}`);
      void shutdown(1);
    });
  }
}

module.exports = { preflightBackend, PREFLIGHT_MODULES, PREFLIGHT_SYNTAX_FILES };
