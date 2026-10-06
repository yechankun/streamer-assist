const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const publicConfig = require("./oauth-config.json");
const { channelIdFrom, channelProfile } = require("./chzzk.cjs");
const hash = (value) => createHash("sha256").update(value).digest("base64url");
function same(a, b) {
  const left = Buffer.from(a || ""),
    right = Buffer.from(b || "");
  return left.length === right.length && timingSafeEqual(left, right);
}
async function jsonRequest(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new Error(
      `로그인 서비스 오류 (${response.status}). 잠시 후 다시 연결하세요.`,
    );
    const data = await response.json().catch(() => ({}));
    error.code = ["invalid_grant", "invalid_client", "access_denied"].includes(
      data.error,
    )
      ? data.error
      : "request_failed";
    throw error;
  }
  return response.json();
}
async function listenCallback({
  state,
  port = 0,
  callbackPath = "/oauth/youtube",
  timeout = 180000,
}) {
  let resolve,
    reject,
    finished = false;
  const completed = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  completed.catch(() => {});
  const close = () => {
    clearTimeout(timer);
    server.close();
    server.closeIdleConnections();
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, text) => {
      res.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'",
        Connection: "close",
      });
      res.end(
        `<!doctype html><html lang="ko"><meta charset="utf-8"><title>Streamer Assist</title><p>${text}</p></html>`,
      );
    };
    if (req.method !== "GET" || url.pathname !== callbackPath)
      return send(404, "잘못된 로그인 경로입니다.");
    if (
      url.searchParams.getAll("state").length !== 1 ||
      !same(url.searchParams.get("state"), state)
    )
      return send(
        400,
        "로그인 요청을 확인할 수 없습니다. 앱에서 다시 연결하세요.",
      );
    if (finished) return send(409, "이미 처리된 로그인입니다.");
    const denied = url.searchParams.has("error");
    const code = url.searchParams.get("code");
    if (
      !denied &&
      (!code ||
        code.length > 4096 ||
        url.searchParams.getAll("code").length !== 1)
    )
      return send(400, "인증 코드가 없습니다.");
    finished = true;
    send(
      200,
      denied
        ? "연결을 취소했습니다. 앱으로 돌아가세요."
        : "인증을 받았습니다. 연결 결과는 앱에서 확인하세요. 이 창은 닫아도 됩니다.",
    );
    close();
    if (denied) reject(new Error("로그인 권한 동의가 취소됐습니다."));
    else resolve(code);
  });
  const timer = setTimeout(() => {
    finished = true;
    close();
    reject(new Error("로그인 시간이 지났습니다. 다시 연결하세요."));
  }, timeout);
  try {
    await new Promise((yes, no) => {
      server.once("error", no);
      server.listen(port, "127.0.0.1", yes);
    });
  } catch {
    clearTimeout(timer);
    throw new Error(
      "로그인 수신 포트를 열지 못했습니다. 다른 앱이 사용 중인지 확인하세요.",
    );
  }
  return {
    redirectUri: `http://127.0.0.1:${server.address().port}${callbackPath}`,
    completed,
    cancel() {
      if (!finished) {
        finished = true;
        close();
        reject(new Error("로그인을 취소했습니다."));
      }
    },
  };
}
class CredentialVault {
  constructor(file, storage) {
    this.file = file;
    this.storage = storage;
    this.accounts = {};
  }
  available() {
    return (
      this.storage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        this.storage.getSelectedStorageBackend?.() !== "basic_text")
    );
  }
  load() {
    if (!fs.existsSync(this.file) || !this.available()) return;
    try {
      this.accounts = JSON.parse(
        this.storage.decryptString(
          Buffer.from(fs.readFileSync(this.file, "utf8"), "base64"),
        ),
      );
    } catch {
      this.accounts = {};
    }
  }
  save() {
    if (!this.available())
      throw new Error(
        "Windows 보안 저장소를 사용할 수 없어 로그인을 저장하지 못했습니다.",
      );
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(
      temp,
      this.storage
        .encryptString(JSON.stringify(this.accounts))
        .toString("base64"),
    );
    fs.renameSync(temp, this.file);
  }
}
class AuthManager {
  constructor({
    file,
    storage,
    openBrowser,
    notify,
    fetcher = fetch,
    config,
    dev = false,
    localConfigFile,
    releaseConfigFile,
  }) {
    this.vault = new CredentialVault(file, storage);
    this.vault.load();
    this.channelFile = path.join(path.dirname(file), "channels.json");
    this.chzzk = null;
    try {
      const saved = JSON.parse(fs.readFileSync(this.channelFile, "utf8"));
      if (
        saved.chzzk &&
        channelIdFrom(saved.chzzk.channelId) === saved.chzzk.channelId &&
        typeof saved.chzzk.name === "string"
      )
        this.chzzk = saved.chzzk;
    } catch {}
    this.openBrowser = openBrowser;
    this.notify = notify;
    this.fetcher = fetcher;
    this.pending = null;
    this.refreshing = new Map();
    let releaseConfig = {};
    if (releaseConfigFile) {
      try {
        const value = JSON.parse(fs.readFileSync(releaseConfigFile, "utf8"));
        if (
          typeof value.youtubeClientId === "string" &&
          typeof value.youtubeClientSecret === "string"
        )
          releaseConfig = {
            youtubeClientId: value.youtubeClientId,
            youtubeClientSecret: value.youtubeClientSecret,
          };
      } catch {}
    }
    this.config = config || {
      youtubeClientId:
        process.env.STREAMER_ASSIST_GOOGLE_CLIENT_ID ||
        releaseConfig.youtubeClientId ||
        publicConfig.youtubeClientId,
      youtubeClientSecret:
        process.env.STREAMER_ASSIST_GOOGLE_CLIENT_SECRET ||
        releaseConfig.youtubeClientSecret ||
        "",
    };
    this.baseConfig = this.config;
    this.devConfigFile = dev
      ? localConfigFile || path.join(__dirname, "..", ".env.local")
      : null;
  }
  refreshConfig() {
    if (!this.devConfigFile) return;
    try {
      const source = fs.readFileSync(this.devConfigFile, "utf8");
      if (source === this.lastDevSource) return;
      const values = parseEnv(source);
      this.config = {
        ...this.baseConfig,
        youtubeClientId:
          values.STREAMER_ASSIST_GOOGLE_CLIENT_ID ??
          this.baseConfig.youtubeClientId,
        youtubeClientSecret:
          values.STREAMER_ASSIST_GOOGLE_CLIENT_SECRET ??
          this.baseConfig.youtubeClientSecret,
      };
      this.lastDevSource = source;
    } catch {
      this.config = this.baseConfig;
      this.lastDevSource = undefined;
    }
  }
  snapshot() {
    this.refreshConfig();
    return {
      pending: this.pending ? "youtube" : null,
      accounts: {
        youtube: {
          configured:
            !!this.config.youtubeClientId && !!this.config.youtubeClientSecret,
          connected: !!this.vault.accounts.youtube,
          name: this.vault.accounts.youtube?.name || "",
        },
        chzzk: {
          configured: true,
          connected: !!this.chzzk,
          name: this.chzzk?.name || "",
          channelId: this.chzzk?.channelId || "",
        },
      },
    };
  }
  saveYoutube(account) {
    const previous = this.vault.accounts.youtube;
    if (account) this.vault.accounts.youtube = account;
    else delete this.vault.accounts.youtube;
    try {
      this.vault.save();
    } catch (error) {
      if (previous) this.vault.accounts.youtube = previous;
      else delete this.vault.accounts.youtube;
      throw error;
    }
    this.notify();
  }
  async selectChzzkChannel(input) {
    const next = await channelProfile(input, this.fetcher);
    const temp = this.channelFile + ".tmp";
    fs.writeFileSync(temp, JSON.stringify({ chzzk: next }));
    fs.renameSync(temp, this.channelFile);
    this.chzzk = next;
    this.notify();
  }
  async googleToken(grant, fields) {
    this.refreshConfig();
    if (!this.config.youtubeClientSecret)
      throw new Error("YouTube 앱의 Client Secret 설정이 필요합니다.");
    return jsonRequest(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.youtubeClientId,
          client_secret: this.config.youtubeClientSecret,
          grant_type: grant,
          ...fields,
        }).toString(),
      },
      this.fetcher,
    );
  }
  normalize(data, previous = {}) {
    const accessToken = data.access_token;
    const refreshToken = data.refresh_token || previous.refreshToken;
    if (
      typeof accessToken !== "string" ||
      !accessToken ||
      typeof refreshToken !== "string" ||
      !refreshToken
    )
      throw new Error(
        "로그인을 유지할 인증 정보를 받지 못했습니다. 다시 연결하세요.",
      );
    return {
      ...previous,
      accessToken,
      refreshToken,
      expiresAt:
        Date.now() + Math.max(1, Number(data.expires_in) || 3600) * 1000,
    };
  }
  async login(platform) {
    this.refreshConfig();
    if (platform !== "youtube")
      throw new Error("치지직은 채널 주소로 연결하세요.");
    if (!this.config.youtubeClientId)
      throw new Error("YouTube 앱의 개발자 등록이 아직 완료되지 않았습니다.");
    if (!this.config.youtubeClientSecret)
      throw new Error("YouTube 앱의 Client Secret 설정이 필요합니다.");
    if (this.pending)
      throw new Error("진행 중인 로그인을 먼저 완료하거나 취소하세요.");
    if (!this.vault.available())
      throw new Error("Windows 보안 저장소를 사용할 수 없습니다.");
    const pending = { callback: null, cancelled: false };
    this.pending = pending;
    this.notify();
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    let callback;
    try {
      callback = await listenCallback({ state });
      pending.callback = callback;
      if (pending.cancelled) throw new Error("로그인을 취소했습니다.");
      const query = new URLSearchParams({
        client_id: this.config.youtubeClientId,
        redirect_uri: callback.redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube.force-ssl",
        state,
        code_challenge: hash(verifier),
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
      });
      await this.openBrowser(
        "https://accounts.google.com/o/oauth2/v2/auth?" + query,
      );
      const code = await callback.completed;
      const data = await this.googleToken("authorization_code", {
        redirect_uri: callback.redirectUri,
        code,
        code_verifier: verifier,
      });
      if (pending.cancelled) throw new Error("로그인을 취소했습니다.");
      const account = this.normalize(data);
      const profile = await jsonRequest(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: "Bearer " + account.accessToken } },
        this.fetcher,
      );
      if (!profile.items?.[0])
        throw new Error("로그인한 계정에서 YouTube 채널을 찾지 못했습니다.");
      account.name = profile.items[0].snippet.title;
      account.channelId = profile.items[0].id;
      if (pending.cancelled) throw new Error("로그인을 취소했습니다.");
      this.saveYoutube(account);
    } finally {
      callback?.cancel();
      this.pending = null;
      this.notify();
    }
  }
  cancel() {
    if (this.pending) {
      this.pending.cancelled = true;
      this.pending.callback?.cancel();
    }
  }
  async getAccess(platform, force = false) {
    if (platform !== "youtube")
      throw new Error("치지직 공개 채팅은 계정 토큰을 사용하지 않습니다.");
    const account = this.vault.accounts.youtube;
    if (!account) throw new Error("YouTube 계정을 먼저 연결하세요.");
    if (!force && account.expiresAt > Date.now() + 60000)
      return account.accessToken;
    if (this.refreshing.has(platform)) return this.refreshing.get(platform);
    const refresh = (async () => {
      try {
        const data = await this.googleToken("refresh_token", {
          refresh_token: account.refreshToken,
        });
        const next = this.normalize(data, account);
        if (this.vault.accounts.youtube !== account)
          throw new Error("계정 연결이 변경됐습니다. 다시 시도하세요.");
        this.saveYoutube(next);
        return next.accessToken;
      } catch (error) {
        if (
          error.code === "invalid_grant" &&
          this.vault.accounts.youtube === account
        ) {
          this.saveYoutube(null);
          throw new Error(
            "로그인 권한이 만료됐습니다. 계정을 다시 연결하세요.",
          );
        }
        throw error;
      }
    })();
    this.refreshing.set(platform, refresh);
    try {
      return await refresh;
    } finally {
      this.refreshing.delete(platform);
    }
  }
  async logout(platform) {
    if (platform === "youtube") this.saveYoutube(null);
    else if (platform === "chzzk") {
      const temp = this.channelFile + ".tmp";
      fs.writeFileSync(temp, JSON.stringify({ chzzk: null }));
      fs.renameSync(temp, this.channelFile);
      this.chzzk = null;
      this.notify();
    } else throw new Error("지원하지 않는 플랫폼입니다.");
  }
  async chatConfig() {
    const config = {
      chzzkChannelId: this.chzzk?.channelId || "",
      youtube: false,
      liveChatId: "",
      youtubeStatus: "미연결",
    };
    if (this.vault.accounts.youtube) {
      config.youtubeStatus = "방송 대기";
      try {
        const token = await this.getAccess("youtube");
        const data = await jsonRequest(
          "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&maxResults=50",
          { headers: { Authorization: "Bearer " + token } },
          this.fetcher,
        );
        const broadcast = data.items?.find((item) => item.snippet?.liveChatId);
        if (broadcast) {
          config.youtube = true;
          config.liveChatId = broadcast.snippet.liveChatId;
        }
      } catch (error) {
        config.youtubeStatus = error.message;
      }
    }
    return config;
  }
}
module.exports = { AuthManager, CredentialVault, listenCallback, hash };
