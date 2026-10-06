const { setTimeout: delay } = require("node:timers/promises");
const TWITCH_SCOPE = "user:read:chat";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
function authError(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}
async function twitchRequest(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data.error || data.message;
    const code = ["authorization_pending", "slow_down", "access_denied", "expired_token"].includes(reason)
      ? reason
      : response.status === 401
        ? "authorization_invalid"
        : url === TOKEN_URL && response.status === 400
          ? "invalid_grant"
          : "request_failed";
    throw authError(`트위치 인증 서비스 오류 (${response.status}). 다시 연결하거나 잠시 후 시도하세요.`, code, response.status);
  }
  return data;
}
async function validateTwitch(token, clientId, userId, fetcher = fetch, signal) {
  const data = await twitchRequest("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: "OAuth " + token },
    signal,
  }, fetcher);
  if (
    data.client_id !== clientId ||
    typeof data.user_id !== "string" || !/^\d+$/.test(data.user_id) ||
    (userId && data.user_id !== userId) ||
    !Array.isArray(data.scopes) || !data.scopes.includes(TWITCH_SCOPE) ||
    !Number.isFinite(data.expires_in) || data.expires_in <= 0
  ) throw authError("트위치 계정 또는 채팅 권한을 확인할 수 없습니다. 계정을 다시 연결하세요.", "authorization_invalid");
  return data;
}
async function deviceLogin({ clientId, openBrowser, progress, signal, fetcher = fetch, sleep = (ms, s) => delay(ms, undefined, { signal: s }) }) {
  const device = await twitchRequest("https://id.twitch.tv/oauth2/device", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scopes: TWITCH_SCOPE }).toString(),
    signal,
  }, fetcher);
  let uri;
  try { uri = new URL(device.verification_uri); } catch {}
  if (
    !uri || uri.origin !== "https://www.twitch.tv" || uri.pathname !== "/activate" ||
    typeof device.device_code !== "string" || !device.device_code ||
    typeof device.user_code !== "string" || !/^[A-Za-z0-9-]{1,32}$/.test(device.user_code) ||
    !Number.isFinite(device.expires_in) || device.expires_in <= 0 || device.expires_in > 3600 ||
    !Number.isFinite(device.interval) || device.interval < 1 || device.interval > 300
  ) throw new Error("트위치 로그인 정보를 받지 못했습니다. 다시 연결하세요.");
  const expiresAt = Date.now() + device.expires_in * 1000;
  progress({ userCode: device.user_code, expiresAt });
  signal.throwIfAborted();
  await openBrowser(uri.href);
  let interval = device.interval * 1000;
  while (Date.now() < expiresAt) {
    await sleep(Math.min(interval, Math.max(1, expiresAt - Date.now())), signal);
    signal.throwIfAborted();
    if (Date.now() >= expiresAt) break;
    try {
      return await twitchRequest(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, scopes: TWITCH_SCOPE, device_code: device.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }).toString(),
        signal,
      }, fetcher);
    } catch (error) {
      if (error.code === "authorization_pending") continue;
      if (error.code === "slow_down") { interval += 5000; continue; }
      if (error.code === "access_denied") throw new Error("트위치 로그인 권한 동의가 취소됐습니다.");
      if (error.code === "expired_token") break;
      throw error;
    }
  }
  throw new Error("트위치 로그인 시간이 지났습니다. 다시 연결하세요.");
}
module.exports = { TWITCH_SCOPE, TOKEN_URL, twitchRequest, validateTwitch, deviceLogin };
