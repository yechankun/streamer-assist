const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const root = path.resolve(__dirname, "..");
const devDirectory = path.join(root, ".dev");
const statusFile = path.join(devDirectory, "status.json");
let server, watcher, controlWatcher, child, debounce;
let shuttingDown = false;
let ownsStatus = false;
const expectedExits = new WeakSet();
let restartQueue = Promise.resolve();

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
            console.log(`[dev] electron/${filename} changed. Restarting...`);
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
  startElectron();
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
