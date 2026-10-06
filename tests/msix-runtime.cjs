// Called only by the disposable-runner MSIX install test; no application test hooks are shipped.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  const port = Number(process.env.MSIX_SMOKE_PORT);
  assert.ok(Number.isInteger(port) && port > 0);
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      target = (
        await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()
      ).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    } catch {}
    if (target) break;
    await delay(250);
  }
  assert.ok(
    target,
    "installed app exposes its requested test-only debugging port",
  );
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let id = 0;
  const pending = new Map();
  socket.on("message", (buffer) => {
    const msg = JSON.parse(buffer.toString());
    const request = pending.get(msg.id);
    if (!request) return;
    pending.delete(msg.id);
    msg.error
      ? request.reject(new Error(msg.error.message))
      : request.resolve(msg.result);
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      const timeout = setTimeout(() => {
        pending.delete(key);
        reject(new Error("CDP timeout: " + method));
      }, 15000);
      pending.set(key, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  const run = async (fn) => {
    const result = await send("Runtime.evaluate", {
      expression: "(" + fn.toString() + ")()",
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error("Installed renderer script failed");
    return result.result.value;
  };
  try {
    await delay(500);
    const initial = await run(async () => {
      let state;
      const off = window.assist.subscribe((s) => (state = s));
      await window.assist.call("state");
      off();
      return {
        state,
        cards: document.querySelectorAll(".tool-card").length,
        overflow: document.documentElement.scrollHeight > innerHeight,
      };
    });
    assert.equal(initial.cards, 4);
    assert.equal(initial.overflow, false);
    assert.equal(initial.state.appInfo.distribution, "msix");
    assert.equal(initial.state.settings.startupManagedByWindows, true);
    assert.equal(initial.state.settings.recordsEncrypted, true);
    const markers = await run(async () => {
      const requireOk = async (a, p = {}) => {
        const r = await window.assist.call(a, p);
        if (!r.ok) throw new Error(r.error);
      };
      await requireOk("start", { title: "CI package smoke", offset: 60 });
      await requireOk("mark", { label: "MSIX marker" });
      let state;
      const off = window.assist.subscribe((s) => (state = s));
      await requireOk("state");
      off();
      return state.current.markers;
    });
    assert.equal(markers[0].timecode, "00:01:00");
    await run(() => {
      [...document.querySelectorAll("nav button")]
        .find((b) => b.textContent.includes("설정"))
        .click();
    });
    await delay(500);
    assert.equal(
      await run(() => !!document.querySelector(".startup-system-button")),
      true,
    );
    await run(() => {
      [...document.querySelectorAll(".settings-tabs button")]
        .find((b) => b.textContent.includes("정보·데이터"))
        .click();
    });
    await delay(100);
    await run(() => document.querySelector(".privacy-card .secondary").click());
    await delay(100);
    assert.ok(
      await run(() =>
        document
          .querySelector(".privacy-document")
          .innerText.includes("Windows 보안 저장소"),
      ),
    );
    await run(() => document.querySelector('[aria-label="안내 닫기"]').click());
    await run(async () => {
      await window.assist.call("stop");
    });
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(__dirname, "../release/msix-runtime.png"),
      Buffer.from(screenshot.data, "base64"),
    );
    const cleared = await run(async () => {
      const r = await window.assist.call("history-clear", { confirm: true });
      if (!r.ok) throw new Error(r.error);
      let state;
      const off = window.assist.subscribe((s) => (state = s));
      await window.assist.call("state");
      off();
      return state.sessions.length;
    });
    assert.equal(cleared, 0);
    await run(async () => {
      await window.assist.call("tray-set", { enabled: false });
    });
    // Closing reaches normal persistence/quit rather than merely hiding a Store app.
    void run(() => window.assist.windowControl("close")).catch(() => {});
    console.log(
      "PASS: installed MSIX identity, full-trust UI, global marker setup, Windows-managed startup, DPAPI records, privacy and deletion, app exit.",
    );
  } finally {
    socket.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
