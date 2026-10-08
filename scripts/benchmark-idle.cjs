const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawn } = require("node:child_process");
async function main() {
  const args = process.argv.slice(2), value = (key, fallback) => { const at = args.indexOf(key); return at < 0 ? fallback : args[at + 1]; };
  const root = path.resolve(value("--root", path.join(__dirname, "..")));
  const output = path.resolve(value("--output", path.join(root, "release/idle-performance.json")));
  const milliseconds = Number(value("--sample-ms", "8000"));
  if (!Number.isFinite(milliseconds) || milliseconds < 2000 || milliseconds > 60000) throw Error("Sample duration must be between 2000 and 60000 ms.");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "streamer-idle-benchmark-"));
  try {
    const sources = [path.join(__dirname, "idle-benchmark-app.cjs"), ...fs.readdirSync(path.join(root, "electron")).filter(name => name.endsWith(".cjs")).map(name => path.join(root, "electron", name))];
    for (const file of sources) new (require("node:vm").Script)(require("node:module").wrap(fs.readFileSync(file, "utf8")), {filename: file});
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [require.resolve("electron/cli.js"), path.join(__dirname, "idle-benchmark-app.cjs")], {
        cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, STREAMER_IDLE_ROOT: root, STREAMER_IDLE_PROFILE: profile, STREAMER_IDLE_OUTPUT: output, STREAMER_IDLE_SAMPLE_MS: String(milliseconds) },
      });
      const timeout = setTimeout(() => { child.kill(); reject(Error("Idle benchmark timed out.")); }, milliseconds * 5 + 70000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error("Idle benchmark exited with " + code)); });
    });
  } finally {
    const resolved = fs.realpathSync(profile);
    if (!resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep + "streamer-idle-benchmark-") || fs.lstatSync(profile).isSymbolicLink()) throw Error("Unsafe benchmark cleanup.");
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
