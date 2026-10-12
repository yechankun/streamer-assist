const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), WebSocket = require("ws");
class ObsControl {
  constructor(configFile) {
    const originalConfig = path.join(process.env.APPDATA, "obs-studio/plugin_config/obs-websocket/config.json");
    if (path.resolve(configFile).toLowerCase() !== path.resolve(originalConfig).toLowerCase())
      throw Error("The user requires the original OBS instance and profile only.");
    try { this.config = JSON.parse(fs.readFileSync(configFile, "utf8").replace(/^\uFEFF/, "")); }
    catch { throw Error("OBS control configuration could not be read. Its contents were withheld."); }
    this.pending = new Map();
  }
  async connect() {
    const cfg = this.config;
    await new Promise((resolve, reject) => {
      const socket = this.socket = new WebSocket("ws://127.0.0.1:" + cfg.server_port);
      const timeout = setTimeout(() => reject(Error("OBS local control connection timed out")), 12000);
      socket.on("error", reject);
      socket.on("message", bytes => {
        const packet = JSON.parse(bytes.toString());
        if (packet.op === 0) {
          const hello = { rpcVersion: 1, eventSubscriptions: 0 };
          if (packet.d.authentication) {
            const secret = crypto.createHash("sha256").update(cfg.server_password + packet.d.authentication.salt).digest("base64");
            hello.authentication = crypto.createHash("sha256").update(secret + packet.d.authentication.challenge).digest("base64");
          }
          socket.send(JSON.stringify({ op: 1, d: hello }));
        } else if (packet.op === 2) { clearTimeout(timeout); resolve(); }
        else if (packet.op === 7) {
          const callback = this.pending.get(packet.d.requestId);
          if (!callback) return; this.pending.delete(packet.d.requestId); clearTimeout(callback.timeout);
          packet.d.requestStatus.result ? callback.resolve(packet.d.responseData || {}) : callback.reject(Error(packet.d.requestType + ": " + packet.d.requestStatus.comment));
        }
      });
      socket.on("close", () => { clearTimeout(timeout); for (const value of this.pending.values()) { clearTimeout(value.timeout); value.reject(Error("OBS connection closed")); } this.pending.clear(); });
    });
  }
  request(requestType, requestData = {}) {
    if (requestType === "GetOutputList")
      return Promise.reject(Error("Output enumeration is blocked because it crashed the existing OBS installation with its additional outputs."));
    if (["CreateProfile", "CreateSceneCollection", "RemoveProfile", "RemoveSceneCollection"].includes(requestType)
      || requestType === "SetCurrentProfile" && requestData.profileName !== "Untitled"
      || requestType === "SetCurrentSceneCollection" && requestData.sceneCollectionName !== "Untitled")
      return Promise.reject(Error("OBS profile and scene collection changes are blocked by the user's instruction."));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(requestId); reject(Error(requestType + " timed out")); }, 15000);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }
  close() { this.socket?.close(); }
}
async function main() {
  if (process.argv.includes("--demo")) throw Error("Additional OBS instances are blocked. Use the existing profile.");
  const args = process.argv.slice(2);
  const file = path.join(process.env.APPDATA, "obs-studio/plugin_config/obs-websocket/config.json");
  const client = new ObsControl(file); await client.connect();
  try {
    const result = await client.request(args[0], args[1] ? JSON.parse(fs.readFileSync(args[1], "utf8").replace(/^\uFEFF/, "")) : {});
    if (args[0] === "GetVersion") console.log(JSON.stringify({ obsVersion: result.obsVersion, rpcVersion: result.rpcVersion, requestCount: result.availableRequests?.length }));
    else if (args[0] === "GetStreamServiceSettings") { let serverHost = ""; try { serverHost = new URL(result.streamServiceSettings?.server).hostname; } catch {} console.log(JSON.stringify({ type: result.streamServiceType, service: result.streamServiceSettings?.service, serverHost, hasStreamKey: !!result.streamServiceSettings?.key, configured: !!result.streamServiceSettings?.server || !!result.streamServiceSettings?.service })); }
    else console.log(JSON.stringify(result));
  } finally { client.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { ObsControl };
