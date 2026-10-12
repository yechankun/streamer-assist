const WebSocket = require("ws");
async function attach(port, targetId) {
  if (![9331, 9332].includes(port)) throw Error("Select an owned OAuth recording page.");
  const pages = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  const candidates = pages.filter(item => item.type === "page");
  const page = targetId ? candidates.find(item => item.id === targetId)
    : port === 9332 ? candidates.find(item => {
      try { const url = new URL(item.url); return url.hostname === "accounts.google.com" || url.hostname === "127.0.0.1" && url.pathname === "/oauth/youtube"; }
      catch { return false; }
    }) || candidates.find(item => item.url.startsWith("https://streamer-assist.foreground.day/")) || candidates[0]
    : candidates[0];
  if (!page) throw Error("The recording page is not ready.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  let id = 0; const pending = new Map();
  socket.on("message", bytes => {
    const packet = JSON.parse(bytes); const reply = pending.get(packet.id);
    if (!reply) return; pending.delete(packet.id); clearTimeout(reply.timer);
    packet.error ? reply.reject(Error("Recording page operation failed.")) : reply.resolve(packet.result);
  });
  return { call(method, params = {}) {
    const requestId = ++id;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(requestId); reject(Error("Recording page operation timed out.")); }, 12000); pending.set(requestId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params })); });
  }, close() { socket.close(); } };
}
module.exports = { attach };
