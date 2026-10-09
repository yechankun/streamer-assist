const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  AuthManager,
  CredentialVault,
  listenCallback,
  hash,
} = require("../electron/oauth.cjs");
function removeFixture(directory) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^assist-(oauth|vault)-/);
  fs.rmSync(resolved, { recursive: true, force: true });
}
function storage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`encrypted:${s}`),
    decryptString: (b) => b.toString().slice(10),
    getSelectedStorageBackend: () => "test",
  };
}
function fixture(
  config = {
    youtubeClientId: "fake",
    youtubeClientSecret: "fake-desktop-secret",
  },
  fetcher = fetch,
  openBrowser = async () => {},
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "assist-oauth-"));
  const manager = new AuthManager({
    file: path.join(directory, "accounts.enc"),
    storage: storage(),
    openBrowser,
    notify: () => {},
    config,
    fetcher,
  });
  manager.saveAccount("youtubeConsent", require("../electron/youtube-consent.cjs").acceptance({ version: require("../electron/youtube-consent.cjs").version, terms: true, privacy: true, retention: true }));
  return { manager, cleanup: () => removeFixture(directory) };
}
test("loopback callback rejects wrong state and only accepts one valid code", async () => {
  const callback = await listenCallback({ state: "unguessable" });
  try {
    assert.equal(
      (await fetch(`${callback.redirectUri}?code=wrong&state=bad`)).status,
      400,
    );
    assert.equal(
      (await fetch(`${callback.redirectUri}?code=valid&state=unguessable`))
        .status,
      200,
    );
    assert.equal(await callback.completed, "valid");
  } finally {
    callback.cancel();
  }
});
test("loopback cancellation and timeout release their listeners", async () => {
  const callback = await listenCallback({ state: "cancel" });
  callback.cancel();
  await assert.rejects(callback.completed, /취소/);
  const timeout = await listenCallback({ state: "timeout", timeout: 20 });
  await assert.rejects(timeout.completed, /시간/);
});
test("YouTube login uses browser PKCE, saves account and discovers live chat automatically", async () => {
  let authorization, tokenBody;
  const fakeFetch = async (url, options) => {
    if (url.includes("/token")) {
      tokenBody = new URLSearchParams(options.body);
      return {
        ok: true,
        json: async () => ({
          access_token: "secret-access",
          refresh_token: "secret-refresh",
          expires_in: 3600,
        }),
      };
    }
    if (url.includes("/channels"))
      return {
        ok: true,
        json: async () => ({
          items: [{ id: "channel", snippet: { title: "My stream" } }],
        }),
      };
    return {
      ok: true,
      json: async () => ({
        items: [{ snippet: { liveChatId: "automatic-chat" } }],
      }),
    };
  };
  const { manager, cleanup } = fixture(undefined, fakeFetch, async (url) => {
    authorization = new URL(url);
    const query = authorization.searchParams;
    const callback = new URL(query.get("redirect_uri"));
    callback.searchParams.set("state", query.get("state"));
    callback.searchParams.set("code", "fake-code");
    await fetch(callback);
  });
  try {
    await manager.login("youtube");
    assert.equal(authorization.origin, "https://accounts.google.com");
    assert.equal(
      authorization.searchParams.get("code_challenge_method"),
      "S256",
    );
    assert.equal(
      authorization.searchParams.get("code_challenge"),
      hash(tokenBody.get("code_verifier")),
    );
    assert.equal(tokenBody.get("client_secret"), "fake-desktop-secret");
    assert.equal(authorization.searchParams.has("client_secret"), false);
    assert.ok(
      !JSON.stringify(manager.snapshot()).includes("fake-desktop-secret"),
    );
    assert.ok(
      !JSON.stringify(manager.vault.accounts).includes("fake-desktop-secret"),
    );
    assert.equal(manager.snapshot().accounts.youtube.name, "My stream");
    assert.ok(!JSON.stringify(manager.snapshot()).includes("secret-access"));
    assert.equal((await manager.chatConfig()).liveChatId, "automatic-chat");
  } finally {
    cleanup();
  }
});
test("YouTube refresh is shared by concurrent requests", async () => {
  let count = 0;
  const { manager, cleanup } = fixture(undefined, async (_url, options) => {
    count++;
    assert.equal(
      new URLSearchParams(options.body).get("refresh_token"),
      "refresh-old",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      ok: true,
      json: async () => ({
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 86400,
      }),
    };
  });
  try {
    manager.vault.accounts.youtube = {
      name: "CHZZK",
      accessToken: "expired",
      refreshToken: "refresh-old",
      expiresAt: 0,
    };
    assert.deepEqual(
      await Promise.all([
        manager.getAccess("youtube"),
        manager.getAccess("youtube"),
      ]),
      ["access-new", "access-new"],
    );
    assert.equal(count, 1);
    assert.equal(manager.vault.accounts.youtube.refreshToken, "refresh-new");
  } finally {
    cleanup();
  }
});
test("invalid refresh grants clear the account instead of retrying indefinitely", async () => {
  const { manager, cleanup } = fixture(undefined, async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "invalid_grant" }),
  }));
  try {
    manager.vault.accounts.youtube = {
      accessToken: "old",
      refreshToken: "expired",
      expiresAt: 0,
    };
    await assert.rejects(() => manager.getAccess("youtube"), /다시 연결/);
    assert.equal(manager.snapshot().accounts.youtube.connected, false);
  } finally {
    cleanup();
  }
});
test("missing app credentials do not open a misleading login page", async () => {
  let opened = false;
  const { manager, cleanup } = fixture(
    { youtubeClientId: "" },
    fetch,
    async () => {
      opened = true;
    },
  );
  try {
    await assert.rejects(() => manager.login("youtube"), /개발자 등록/);
    assert.equal(opened, false);
  } finally {
    cleanup();
  }
});
test("vault never falls back to plaintext storage", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "assist-vault-"));
  const file = path.join(directory, "auth");
  try {
    const vault = new CredentialVault(file, {
      isEncryptionAvailable: () => false,
    });
    vault.accounts = { secret: "token" };
    assert.throws(() => vault.save(), /보안 저장소/);
    assert.equal(fs.existsSync(file), false);
  } finally {
    removeFixture(directory);
  }
});

test("public CHZZK selection works without encryption or developer credentials and restores", async () => {
  const id = "a".repeat(32);
  const { manager, cleanup } = fixture(
    { youtubeClientId: "" },
    async (url, options) => {
      assert.ok(url.endsWith("/" + id));
      assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.headers.Authorization, undefined);
      return {
        ok: true,
        json: async () => ({
          code: 200,
          content: { channelId: id, channelName: "Public channel" },
        }),
      };
    },
  );
  try {
    manager.vault.storage = { isEncryptionAvailable: () => false };
    await manager.selectChzzkChannel("https://chzzk.naver.com/live/" + id);
    assert.equal(manager.snapshot().accounts.chzzk.name, "Public channel");
    const saved = JSON.parse(fs.readFileSync(manager.channelFile, "utf8"));
    assert.deepEqual(saved, {
      chzzk: { channelId: id, name: "Public channel" },
    });
    const restored = new AuthManager({
      file: manager.vault.file,
      storage: storage(),
      openBrowser: async () => {},
      notify: () => {},
      config: { youtubeClientId: "" },
    });
    assert.equal((await restored.chatConfig()).chzzkChannelId, id);
    await restored.logout("chzzk");
    assert.equal(restored.snapshot().accounts.chzzk.connected, false);
  } finally {
    cleanup();
  }
});
test("YouTube API failure does not prevent public CHZZK collection", async () => {
  const { manager, cleanup } = fixture(undefined, async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: "forbidden" }),
  }));
  try {
    manager.chzzk = { channelId: "b".repeat(32), name: "Public" };
    manager.vault.accounts.youtube = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600000,
    };
    const config = await manager.chatConfig();
    assert.equal(config.chzzkChannelId, "b".repeat(32));
    assert.equal(config.youtube, false);
    assert.match(config.youtubeStatus, /403/);
  } finally {
    cleanup();
  }
});
test("revocation intent during token refresh cannot resurrect a disconnected account", async () => {
  let resolve;
  const { manager, cleanup } = fixture(
    undefined,
    async () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  try {
    manager.vault.accounts.youtube = {
      accessToken: "old",
      refreshToken: "refresh",
      expiresAt: 0,
    };
    const pending = manager.getAccess("youtube");
    manager.beginYoutubeRemoval();
    resolve({
      ok: true,
      json: async () => ({ access_token: "new", expires_in: 3600 }),
    });
    await assert.rejects(pending, /변경/);
    assert.equal(manager.snapshot().accounts.youtube.connected, false);
  } finally {
    cleanup();
  }
});
test("storage failure restores the previous in-memory account", () => {
  const { manager, cleanup } = fixture();
  try {
    const old = { accessToken: "old" };
    manager.vault.accounts.youtube = old;
    manager.vault.storage = { isEncryptionAvailable: () => false };
    assert.throws(
      () => manager.saveYoutube({ accessToken: "new" }),
      /보안 저장소/,
    );
    assert.equal(manager.vault.accounts.youtube, old);
  } finally {
    cleanup();
  }
});

test("missing Desktop client secret prevents opening an incomplete login", async () => {
  let opened = false;
  const { manager, cleanup } = fixture(
    { youtubeClientId: "fake" },
    fetch,
    async () => {
      opened = true;
    },
  );
  try {
    assert.equal(manager.snapshot().accounts.youtube.configured, false);
    await assert.rejects(() => manager.login("youtube"), /Client Secret/);
    assert.equal(opened, false);
  } finally {
    cleanup();
  }
});
test("developer local settings update without restarting or exposing the secret", async () => {
  const { manager, cleanup } = fixture();
  const file = path.join(path.dirname(manager.vault.file), ".env.local");
  manager.devConfigFile = file;
  fs.writeFileSync(
    file,
    "STREAMER_ASSIST_GOOGLE_CLIENT_ID=local-id\nSTREAMER_ASSIST_GOOGLE_CLIENT_SECRET=\n",
  );
  try {
    assert.equal(manager.snapshot().accounts.youtube.configured, false);
    fs.writeFileSync(
      file,
      "STREAMER_ASSIST_GOOGLE_CLIENT_ID=local-id\nSTREAMER_ASSIST_GOOGLE_CLIENT_SECRET=private-test-value\n",
    );
    const snapshot = manager.snapshot();
    assert.equal(snapshot.accounts.youtube.configured, true);
    assert.ok(!JSON.stringify(snapshot).includes("private-test-value"));
    let body;
    manager.fetcher = async (_url, options) => {
      body = new URLSearchParams(options.body);
      return {
        ok: true,
        json: async () => ({ access_token: "fake", refresh_token: "fake" }),
      };
    };
    await manager.googleToken("refresh_token", {
      refresh_token: "fake-refresh",
    });
    assert.equal(body.get("client_id"), "local-id");
    assert.equal(body.get("client_secret"), "private-test-value");
    fs.writeFileSync(
      file,
      "STREAMER_ASSIST_GOOGLE_CLIENT_ID=local-id\nSTREAMER_ASSIST_GOOGLE_CLIENT_SECRET=\n",
    );
    assert.equal(manager.snapshot().accounts.youtube.configured, false);
  } finally {
    cleanup();
  }
});

test("release OAuth config enables Desktop login without exposing the app client secret in account state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "assist-oauth-"));
  try {
    const configFile = path.join(directory, "oauth-client.json");
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        youtubeClientId: "release.apps.googleusercontent.com",
        youtubeClientSecret: "fake-release-client-secret",
      }),
    );
    const manager = new AuthManager({
      file: path.join(directory, "accounts.enc"),
      storage: storage(),
      openBrowser: () => {},
      notify: () => {},
      releaseConfigFile: configFile,
    });
    assert.equal(manager.snapshot().accounts.youtube.configured, true);
    assert.ok(
      !JSON.stringify(manager.snapshot()).includes(
        "fake-release-client-secret",
      ),
    );
  } finally {
    removeFixture(directory);
  }
});
