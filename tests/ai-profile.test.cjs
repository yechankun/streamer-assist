"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CliProfileManager, validateProfileRecipe } = require("../electron/ai-profile.cjs");

const codexProfile = {
  supported: true, env: { CODEX_HOME: ".", CODEX_SQLITE_HOME: "sqlite" },
  files: [{ relativePath: "config.toml", contents: "cli_auth_credentials_store = \"file\"\n" }],
  docs: "https://example.test/official-profile-docs",
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "streamer-ai-profile-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return { root, profiles: new CliProfileManager(root) };
}

test("separate app profiles never copy or modify shared PC credentials or inherited auth overrides", t => {
  const { root, profiles } = fixture(t);
  const shared = path.join(root, "shared-pc-account");
  fs.mkdirSync(shared);
  const credential = path.join(shared, "auth.json");
  fs.writeFileSync(credential, "fixture-existing-personal-account");
  const inherited = {
    PATH: "fixture-system-path", SystemRoot: "C:\\Windows", HOME: shared,
    CODEX_HOME: shared, codex_sqlite_home: shared,
    OPENAI_API_KEY: "inherited-key", Anthropic_Auth_Token: "inherited-token",
    GOOGLE_APPLICATION_CREDENTIALS: credential, GROK_AUTH_TOKEN: "inherited-token",
    KIMI_CODE_HOME: shared, CLAUDE_CODE_USE_BEDROCK: "1",
  };
  const openai = profiles.environment("openai", codexProfile, inherited);
  const deepseek = profiles.environment("deepseek", codexProfile, inherited);
  assert.equal(openai.CODEX_HOME, path.join(root, "profiles", "openai"));
  assert.equal(deepseek.CODEX_HOME, path.join(root, "profiles", "deepseek"));
  assert.notEqual(openai.CODEX_HOME, deepseek.CODEX_HOME);
  assert.equal(openai.CODEX_SQLITE_HOME, path.join(openai.CODEX_HOME, "sqlite"));
  assert.equal(openai.PATH, inherited.PATH);
  assert.equal(openai.SystemRoot, inherited.SystemRoot);
  assert.equal(openai.HOME, inherited.HOME, "system HOME stays untouched; official CLI profile overrides isolate authentication");
  assert.equal(openai.OPENAI_API_KEY, undefined);
  assert.equal(openai.Anthropic_Auth_Token, undefined);
  assert.equal(openai.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(openai.GROK_AUTH_TOKEN, undefined);
  assert.equal(openai.KIMI_CODE_HOME, undefined);
  assert.equal(openai.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(openai.codex_sqlite_home, undefined);
  assert.equal(fs.readFileSync(credential, "utf8"), "fixture-existing-personal-account");
  assert.equal(fs.existsSync(path.join(openai.CODEX_HOME, "auth.json")), false);
  assert.match(fs.readFileSync(path.join(openai.CODEX_HOME, "config.toml"), "utf8"), /cli_auth_credentials_store = "file"/);
});

test("existing app configuration stays intact and incompatible credential storage fails closed", t => {
  const { profiles } = fixture(t);
  const env = profiles.environment("openai", codexProfile, {});
  const config = path.join(env.CODEX_HOME, "config.toml");
  const custom = "cli_auth_credentials_store = 'file' # app credentials\nmodel = \"fixture-model\"\n[projects]\nfixture = true\n";
  fs.writeFileSync(config, custom);
  profiles.environment("openai", codexProfile, {});
  assert.equal(fs.readFileSync(config, "utf8"), custom);
  for (const unsafe of [
    "cli_auth_credentials_store = \"keyring\"\n",
    "[projects]\ncli_auth_credentials_store = \"file\"\n",
    "cli_auth_credentials_store = \"file\"\ncli_auth_credentials_store = \"auto\"\n",
  ]) {
    fs.writeFileSync(config, unsafe);
    assert.throws(() => profiles.environment("openai", codexProfile, {}), /덮어쓰지 않았습니다/);
    assert.equal(fs.readFileSync(config, "utf8"), unsafe);
  }
});

test("missing or unsupported official profile metadata never falls back to a shared account", t => {
  const { root, profiles } = fixture(t);
  assert.equal(profiles.state(undefined).supported, false);
  assert.throws(() => profiles.environment("openai", undefined, { CODEX_HOME: "shared" }), /모듈을 업데이트/);
  const unsupported = { supported: false, reason: "공식 인증 저장소 격리가 지원되지 않습니다.", docs: "https://example.test/unsupported-profile" };
  assert.equal(profiles.state(unsupported).supported, false);
  assert.throws(() => profiles.environment("google", unsupported, { HOME: "shared" }), /격리가 지원되지 않습니다/);
  assert.equal(fs.existsSync(path.join(root, "profiles")), false);
});

test("Google shared authentication requires explicit opt-in and never claims isolation", t => {
  const { root, profiles } = fixture(t);
  const unsupported = { supported: false, reason: "공식 인증 저장소 격리가 지원되지 않습니다.", docs: "https://example.test/unsupported-profile" };
  const inherited = { HOME: "fixture-pc-home", USERPROFILE: "fixture-pc-home", PATH: "fixture-path", PATHEXT: ".COM;.EXE;.BAT;.CMD", SystemRoot: "C:\\Windows", GOOGLE_API_KEY: "fixture-inherited-key", ANTIGRAVITY_HOME: "untrusted-profile", CODEX_HOME: "untrusted-profile" };
  assert.throws(() => profiles.environment("google", unsupported, inherited));
  const env = profiles.environment("google", unsupported, inherited, { shared: true });
  assert.equal(profiles.state(unsupported, { providerId: "google", shared: true }).supported, false);
  assert.equal(profiles.state(unsupported, { providerId: "google", shared: true }).shared, true);
  assert.equal(env.HOME, inherited.HOME);
  assert.equal(env.USERPROFILE, inherited.USERPROFILE);
  assert.equal(env.PATH, inherited.PATH);
  assert.equal(env.PATHEXT, inherited.PATHEXT);
  assert.equal(env.SystemRoot, inherited.SystemRoot);
  assert.equal(env.GOOGLE_API_KEY, undefined);
  assert.equal(env.ANTIGRAVITY_HOME, undefined);
  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(fs.existsSync(path.join(root, "profiles")), false, "a shared OS credential store is not presented as an app profile");
  assert.throws(() => profiles.environment("xai", unsupported, inherited, { shared: true }));
  assert.throws(() => profiles.environment("google", undefined, inherited, { shared: true }));
});

test("profile metadata permits only official environment variables and contained relative paths", () => {
  for (const env of [{ HOME: "." }, { PATH: "." }, { NODE_OPTIONS: "." }, { CODEX_HOME: "../shared" }, { CODEX_HOME: "C:\\shared" }, { CODEX_HOME: "%USERPROFILE%" }, { CODEX_HOME: "nul" }, { CODEX_HOME: "child" }])
    assert.throws(() => validateProfileRecipe({ ...codexProfile, env }));
  assert.throws(() => validateProfileRecipe({ ...codexProfile, files: [] }), /file credentials/);
  assert.throws(() => validateProfileRecipe({ ...codexProfile, files: [{ relativePath: "auth.json", contents: "not-authentication" }] }), /config path/);
  assert.throws(() => validateProfileRecipe({ ...codexProfile, files: [{ relativePath: "../config.toml", contents: "x" }] }));
  assert.throws(() => validateProfileRecipe({ ...codexProfile, docs: "http://example.test/docs" }));
});

test("profile provision refuses junctions and linked configuration files", t => {
  const { root, profiles } = fixture(t);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(root, "profiles"));
  fs.symlinkSync(outside, path.join(root, "profiles", "openai"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => profiles.environment("openai", codexProfile, {}), /프로필 경로/);
  assert.deepEqual(fs.readdirSync(outside), []);

  const isolated = profiles.environment("deepseek", codexProfile, {});
  const target = path.join(outside, "unrelated-config.toml");
  const config = path.join(isolated.CODEX_HOME, "config.toml");
  fs.writeFileSync(target, "unrelated-file");
  fs.unlinkSync(config);
  try { fs.symlinkSync(target, config, "file"); }
  catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") { fs.mkdirSync(config); }
    else throw error;
  }
  assert.throws(() => profiles.environment("deepseek", codexProfile, {}), /설정 파일/);
  assert.equal(fs.readFileSync(target, "utf8"), "unrelated-file");
});
