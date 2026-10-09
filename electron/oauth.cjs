const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const publicConfig = require("./oauth-config.json");
const youtubeConsent = require("./youtube-consent.cjs");
const { channelIdFrom, channelProfile } = require("./chzzk.cjs");
const { TOKEN_URL, twitchRequest, validateTwitch, deviceLogin } = require("./twitch-auth.cjs");
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
    deviceSleep,
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
    this.deviceSleep = deviceSleep;
    this.twitchValidation = null;
    let releaseConfig = {};
    if (releaseConfigFile) {
      try {
        const value = JSON.parse(fs.readFileSync(releaseConfigFile, "utf8"));
        for (const key of ["youtubeClientId", "youtubeClientSecret", "twitchClientId"])
          if (typeof value[key] === "string") releaseConfig[key] = value[key];
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
      twitchClientId:
        process.env.STREAMER_ASSIST_TWITCH_CLIENT_ID ||
        releaseConfig.twitchClientId || publicConfig.twitchClientId || "",
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
        twitchClientId:
          values.STREAMER_ASSIST_TWITCH_CLIENT_ID ?? this.baseConfig.twitchClientId,
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
      pending: this.pending?.platform || null,
      twitchDevice: this.pending?.platform === "twitch" ? this.pending.device || null : null,
      accounts: {
        youtube: {
          configured:
            !!this.config.youtubeClientId && !!this.config.youtubeClientSecret,
          connected: !!this.vault.accounts.youtube,
          name: this.vault.accounts.youtube?.name || "",
          paused: this.vault.accounts.youtube?.paused === true,
          removalPending: !!this.vault.accounts.youtubeRemoval,
          localDataDeleted: this.vault.accounts.youtubeRemoval?.localDone === true,
          consentRequired: !this.hasYoutubeConsent(),
          maintenancePending: !!this.vault.accounts.youtubeMaintenance,
        },
        chzzk: {
          configured: true,
          connected: !!this.chzzk,
          name: this.chzzk?.name || "",
          channelId: this.chzzk?.channelId || "",
        },
        twitch: {
          configured: !!this.config.twitchClientId,
          connected: !!this.vault.accounts.twitch,
          name: this.vault.accounts.twitch?.name || "",
        },
      },
    };
  }
  saveYoutube(account) {
    this.saveAccount("youtube", account);
  }
  hasYoutubeConsent() { return youtubeConsent.current(this.vault.accounts.youtubeConsent); }
  acceptYoutubeConsent(payload) {
    const accepted = youtubeConsent.acceptance(payload);
    const previous = this.vault.accounts;
    this.vault.accounts = { ...previous, youtubeConsent: accepted,
      youtubeMaintenance: previous.youtubeMaintenance || { requestedAt: Date.now(), before: Date.now() - youtubeConsent.RETENTION_DAYS * 86400000, affectedSessionIds: [] } };
    try { this.vault.save(); } catch (error) { this.vault.accounts = previous; throw error; }
    this.notify();
  }
  requireYoutubeConsent() {
    if (!this.hasYoutubeConsent()) throw new Error("YouTube 연결 전에 최신 약관과 개인정보처리방침에 동의하세요.");
    if (this.vault.accounts.youtubeMaintenance) throw new Error("YouTube 보관 정책 적용과 기록 정리를 먼저 완료하세요.");
  }
  saveAccount(platform, account) {
    const previous = this.vault.accounts[platform];
    if (account) this.vault.accounts[platform] = account;
    else delete this.vault.accounts[platform];
    try {
      this.vault.save();
    } catch (error) {
      if (previous) this.vault.accounts[platform] = previous;
      else delete this.vault.accounts[platform];
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
    if (platform === "twitch") return this.loginTwitch();
    if (platform !== "youtube")
      throw new Error("치지직은 채널 주소로 연결하세요.");
    this.requireYoutubeConsent();
    if (this.vault.accounts.youtubeRemoval)
      throw new Error("YouTube 권한 철회와 데이터 정리를 먼저 완료하세요.");
    if (!this.config.youtubeClientId)
      throw new Error("YouTube 앱의 개발자 등록이 아직 완료되지 않았습니다.");
    if (!this.config.youtubeClientSecret)
      throw new Error("YouTube 앱의 Client Secret 설정이 필요합니다.");
    if (this.pending)
      throw new Error("진행 중인 로그인을 먼저 완료하거나 취소하세요.");
    if (!this.vault.available())
      throw new Error("Windows 보안 저장소를 사용할 수 없습니다.");
    const pending = { platform, callback: null, cancelled: false };
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
      const account = { ...this.normalize(data), authorizationCheckedAt: Date.now() };
      const profile = await jsonRequest(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: "Bearer " + account.accessToken } },
        this.fetcher,
      );
      if (!profile.items?.[0])
        throw new Error("로그인한 계정에서 YouTube 채널을 찾지 못했습니다.");
      account.name = profile.items[0].snippet.title;
      account.channelId = profile.items[0].id;
      account.profileCheckedAt = Date.now();
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
      this.pending.controller?.abort();
    }
  }
  async getAccess(platform, force = false, { verificationOnly = false } = {}) {
    if (platform === "twitch") return this.getTwitchAccess(force);
    if (platform !== "youtube")
      throw new Error("치지직 공개 채팅은 계정 토큰을 사용하지 않습니다.");
    const account = this.vault.accounts.youtube;
    if (!account) throw new Error("YouTube 계정을 먼저 연결하세요.");
    this.requireYoutubeConsent();
    if (account.paused && !verificationOnly) throw new Error("YouTube 연결이 일시 중지되었습니다.");
    if (!force && account.expiresAt > Date.now() + 60000)
      return account.accessToken;
    if (this.refreshing.has(platform)) return this.refreshing.get(platform);
    const refresh = (async () => {
      try {
        const data = await this.googleToken("refresh_token", {
          refresh_token: account.refreshToken,
        });
        const next = { ...this.normalize(data, account), authorizationCheckedAt: Date.now() };
        if (this.vault.accounts.youtube !== account)
          throw new Error("계정 연결이 변경됐습니다. 다시 시도하세요.");
        this.saveYoutube(next);
        return next.accessToken;
      } catch (error) {
        if (
          error.code === "invalid_grant" &&
          this.vault.accounts.youtube === account
        ) {
          this.beginYoutubeRemoval(true);
          this.onYoutubeInvalidated?.();
          throw new Error(
            "YouTube 권한이 만료되거나 철회되었습니다. 관련 데이터 정리 후 계정을 다시 연결하세요.",
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
    if (platform === "youtube") return this.revokeYoutube();
    else if (platform === "twitch") {
      if (this.pending?.platform === "twitch") this.cancel();
      this.saveAccount("twitch", null);
      this.twitchValidation = null;
    }
    else if (platform === "chzzk") {
      const temp = this.channelFile + ".tmp";
      fs.writeFileSync(temp, JSON.stringify({ chzzk: null }));
      fs.renameSync(temp, this.channelFile);
      this.chzzk = null;
      this.notify();
    } else throw new Error("지원하지 않는 플랫폼입니다.");
  }
  monitoringChannels() {
    return [
      this.chzzk && { platform: "chzzk", channelId: this.chzzk.channelId, name: this.chzzk.name },
      this.hasYoutubeConsent() && !this.vault.accounts.youtubeMaintenance && !this.vault.accounts.youtube?.paused && this.vault.accounts.youtube?.channelId && { platform: "youtube", channelId: this.vault.accounts.youtube.channelId, name: this.vault.accounts.youtube.name },
      this.vault.accounts.twitch?.userId && { platform: "twitch", channelId: this.vault.accounts.twitch.userId, name: this.vault.accounts.twitch.name },
    ].filter(Boolean);
  }
  async chatConfig(readBroadcast) {
    const config = {
      chzzkChannelId: this.chzzk?.channelId || "",
      youtube: false,
      liveChatId: "",
      youtubeStatus: "미연결",
      twitch: false,
      twitchUserId: "",
      twitchStatus: "미연결",
    };
    if (this.vault.accounts.youtube?.paused) config.youtubeStatus = "일시 중지";
    if (!this.hasYoutubeConsent() && this.vault.accounts.youtube) config.youtubeStatus = "약관 확인 필요";
    if (this.vault.accounts.youtube && !this.vault.accounts.youtube.paused && this.hasYoutubeConsent() && !this.vault.accounts.youtubeMaintenance) {
      config.youtubeStatus = "방송 대기";
      try {
        if (readBroadcast && this.vault.accounts.youtube.channelId) {
          const info = await readBroadcast({ platform: "youtube", channelId: this.vault.accounts.youtube.channelId, name: this.vault.accounts.youtube.name }, Date.now());
          config.youtube = info.live === true && typeof info.liveChatId === "string" && !!info.liveChatId;
          config.liveChatId = config.youtube ? info.liveChatId : "";
        } else {
          const token = await this.getAccess("youtube");
          const data = await jsonRequest(
            "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&maxResults=50",
            { headers: { Authorization: "Bearer " + token } }, this.fetcher,
          );
          const broadcast = data.items?.find((item) => item.snippet?.liveChatId);
          if (broadcast) { config.youtube = true; config.liveChatId = broadcast.snippet.liveChatId; }
        }
      } catch (error) {
        config.youtubeStatus = error.message;
      }
    }
    if (this.vault.accounts.twitch) {
      try {
        await this.getAccess("twitch");
        const account = this.vault.accounts.twitch;
        if (account) {
          config.twitch = true;
          config.twitchUserId = account.userId;
          config.twitchStatus = "연결 중";
        }
      } catch (error) { config.twitchStatus = error.message; }
    }
    return config;
  }
  pauseYoutube(paused) {
    const account = this.vault.accounts.youtube;
    if (!account) throw new Error("YouTube 계정을 먼저 연결하세요.");
    if (!paused) this.requireYoutubeConsent();
    this.saveYoutube({ ...account, paused: paused === true });
  }
  beginYoutubeRemoval(remoteDone = false) {
    if (this.pending?.platform === "youtube") this.cancel();
    if (this.vault.accounts.youtubeRemoval) return;
    const previous = this.vault.accounts;
    // Persist the intent and disable access together, before removing any data.
    this.vault.accounts = { ...previous, youtubeRemoval: {
      requestedAt: Date.now(), remoteDone, localDone: false, reason: remoteDone ? "invalidated" : "user",
      token: remoteDone ? "" : previous.youtube?.refreshToken || previous.youtube?.accessToken || "",
    } };
    delete this.vault.accounts.youtube;
    try { this.vault.save(); } catch (error) { this.vault.accounts = previous; throw error; }
    this.notify();
  }
  async revokeYoutube(cleanup = this.onYoutubeCleanup) {
    if (this.youtubeRemovalTask) return this.youtubeRemovalTask;
    this.beginYoutubeRemoval();
    const operation = (async () => {
      let ticket = this.vault.accounts.youtubeRemoval;
      let remoteError;
      if (!ticket.remoteDone && ticket.token) {
        try {
          const response = await this.fetcher("https://oauth2.googleapis.com/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: ticket.token }).toString(), signal: AbortSignal.timeout(15000),
          });
          // A previously revoked token is an idempotent success; other failures remain pending.
          const body = response.ok ? null : await response.json().catch(() => ({}));
          if (!response.ok && !(response.status === 400 && body?.error === "invalid_token")) throw new Error("revoke_failed");
          this.saveAccount("youtubeRemoval", { ...ticket, remoteDone: true, token: "" });
          ticket = this.vault.accounts.youtubeRemoval;
        } catch { remoteError = new Error("Google 권한 철회를 완료하려면 인터넷 연결을 확인하고 재시도하세요."); }
      }
      // Local deletion also proceeds offline or after a rejected revoke request.
      if (!ticket.localDone) {
        if (typeof cleanup !== "function") throw new Error("YouTube 기록 정리 기능을 사용할 수 없습니다.");
        await cleanup();
        this.saveAccount("youtubeRemoval", { ...this.vault.accounts.youtubeRemoval, localDone: true });
      }
      if (remoteError) throw new Error("YouTube 데이터는 삭제했습니다. " + remoteError.message);
      this.saveAccount("youtubeRemoval", null);
      this.saveAccount("youtubeMaintenance", null);
      this.saveAccount("youtubeConsent", null);
      return { revoked: ticket.reason !== "invalidated", deleted: true };
    })();
    this.youtubeRemovalTask = operation;
    try { return await operation; } finally { this.youtubeRemovalTask = null; }
  }
  async verifyYoutubeAuthorization(now = Date.now()) {
    const account = this.vault.accounts.youtube;
    if (!account || !this.hasYoutubeConsent() || this.vault.accounts.youtubeMaintenance || this.vault.accounts.youtubeRemoval) return;
    if (now - (account.authorizationCheckedAt || 0) < 86400000 && now - (account.profileCheckedAt || 0) < 86400000) return;
    await this.getAccess("youtube", true, { verificationOnly: true });
    const current = this.vault.accounts.youtube;
    if (!current || now - (current.profileCheckedAt || 0) < 86400000) return;
    const profile = await jsonRequest("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: "Bearer " + current.accessToken },
    }, this.fetcher);
    if (this.vault.accounts.youtube !== current) return;
    const channel = profile.items?.find(item => item.id === current.channelId);
    if (!channel) throw new Error("연결한 YouTube 채널 권한을 확인하지 못했습니다. 계정을 다시 연결하세요.");
    this.saveYoutube({ ...current, name: channel.snippet?.title || "YouTube 채널", profileCheckedAt: now });
  }
  async loginTwitch() {
    const clientId = this.config.twitchClientId;
    if (!clientId) throw new Error("트위치 앱의 개발자 등록이 아직 완료되지 않았습니다.");
    if (this.pending) throw new Error("진행 중인 로그인을 먼저 완료하거나 취소하세요.");
    if (!this.vault.available()) throw new Error("Windows 보안 저장소를 사용할 수 없습니다.");
    const pending = { platform: "twitch", cancelled: false, controller: new AbortController() };
    this.pending = pending;
    this.notify();
    try {
      const data = await deviceLogin({
        clientId, openBrowser: this.openBrowser, fetcher: this.fetcher,
        signal: pending.controller.signal, sleep: this.deviceSleep,
        progress: (device) => { pending.device = device; this.notify(); },
      });
      const account = this.normalize(data);
      const validation = await validateTwitch(account.accessToken, clientId, null, this.fetcher, pending.controller.signal);
      const profile = await twitchRequest("https://api.twitch.tv/helix/users", {
        headers: { Authorization: "Bearer " + account.accessToken, "Client-Id": clientId },
        signal: pending.controller.signal,
      }, this.fetcher);
      const user = profile.data?.find((item) => item.id === validation.user_id);
      if (!user || typeof user.display_name !== "string") throw new Error("트위치 채널 정보를 찾지 못했습니다. 다시 연결하세요.");
      if (pending.cancelled) throw new Error("로그인을 취소했습니다.");
      Object.assign(account, { userId: validation.user_id, name: user.display_name.slice(0, 120), clientId, expiresAt: Date.now() + validation.expires_in * 1000 });
      this.saveAccount("twitch", account);
      this.twitchValidation = { account, at: Date.now() };
    } catch (error) {
      if (pending.cancelled) throw new Error("로그인을 취소했습니다.");
      throw error;
    } finally {
      pending.controller.abort();
      if (this.pending === pending) this.pending = null;
      this.notify();
    }
  }
  async getTwitchAccess(force = false) {
    this.refreshConfig();
    const account = this.vault.accounts.twitch;
    if (!account) throw Object.assign(new Error("트위치 계정을 먼저 연결하세요."), { code: "authorization_invalid" });
    const clientId = this.config.twitchClientId;
    if (!clientId) throw new Error("트위치 앱의 개발자 등록이 아직 완료되지 않았습니다.");
    if (this.refreshing.has("twitch")) return this.refreshing.get("twitch");
    if (!force && account.clientId === clientId && account.expiresAt > Date.now() + 60000 && this.twitchValidation?.account === account && this.twitchValidation.at > Date.now() - 50 * 60 * 1000)
      return account.accessToken;
    const operation = (async () => {
      let current = account;
      try {
        if (account.clientId !== clientId) throw Object.assign(new Error("트위치 앱 설정이 변경됐습니다. 계정을 다시 연결하세요."), { code: "authorization_invalid" });
        const refresh = async () => {
          const data = await twitchRequest(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: account.refreshToken }).toString(),
          }, this.fetcher);
          if (this.vault.accounts.twitch !== current) throw new Error("계정 연결이 변경됐습니다. 다시 시도하세요.");
          const next = this.normalize(data, current);
          // Public-client refresh tokens are single-use: persist the replacement
          // before another network request can fail or the app can exit.
          this.saveAccount("twitch", next);
          current = next;
        };
        if (force || account.expiresAt <= Date.now() + 60000) await refresh();
        let validation;
        try {
          validation = await validateTwitch(current.accessToken, clientId, account.userId, this.fetcher);
        } catch (error) {
          // A cached token may have expired earlier than its local expiry time.
          if (error.status !== 401 || current !== account || force) throw error;
          await refresh();
          validation = await validateTwitch(current.accessToken, clientId, account.userId, this.fetcher);
        }
        if (this.vault.accounts.twitch !== current) throw new Error("계정 연결이 변경됐습니다. 다시 시도하세요.");
        current.expiresAt = Date.now() + validation.expires_in * 1000;
        this.twitchValidation = { account: current, at: Date.now() };
        return current.accessToken;
      } catch (error) {
        if (["authorization_invalid", "invalid_grant"].includes(error.code) && this.vault.accounts.twitch === current) {
          this.saveAccount("twitch", null);
          this.twitchValidation = null;
          throw Object.assign(new Error("트위치 로그인 권한이 만료됐습니다. 계정을 다시 연결하세요."), { code: "authorization_invalid" });
        }
        throw error;
      }
    })();
    this.refreshing.set("twitch", operation);
    try { return await operation; } finally { if (this.refreshing.get("twitch") === operation) this.refreshing.delete("twitch"); }
  }
  revokeTwitch(userId) {
    if (this.vault.accounts.twitch?.userId === userId) {
      this.saveAccount("twitch", null);
      this.twitchValidation = null;
    }
  }
}
module.exports = { AuthManager, CredentialVault, listenCallback, hash };
