"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROFILE_SCHEMA_VERSION = 1;
const PROFILE_ENV_NAMES = new Set([
  "CODEX_HOME", "CODEX_SQLITE_HOME", "CLAUDE_CONFIG_DIR", "ANTHROPIC_CONFIG_DIR",
  "GROK_HOME", "KIMI_CODE_HOME", "KIMI_SHARE_DIR",
]);
const INHERITED_PROVIDER_ENV = /^(?:OPENAI|CODEX|ANTHROPIC|CLAUDE|XAI|GROK|GOOGLE|GEMINI|ANTIGRAVITY|DEEPSEEK|MOONSHOT|KIMI)_/i;
const PROTECTED_PLAN_ENV = new Set([...PROFILE_ENV_NAMES, "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "PATH", "NODE_OPTIONS", "NODE_PATH", "COMSPEC", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]);
const MAX_CONFIG_BYTES = 256 * 1024;

function plain(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function hasFileCredentialStore(contents) {
  const topLevel = contents.split(/^\s*\[/m)[0];
  const settings = topLevel.match(/^\s*cli_auth_credentials_store\s*=\s*[^\r\n]+/gm) || [];
  return settings.length === 1 && /^\s*cli_auth_credentials_store\s*=\s*["']file["']\s*(?:#.*)?$/.test(settings[0]);
}
function relativeParts(value, allowRoot = false) {
  if (allowRoot && value === ".") return [];
  if (typeof value !== "string" || value.length > 160 || value.includes("\\")) throw new Error("CLI profile path is invalid.");
  const parts = value.split("/");
  if (!parts.length || parts.length > 8 || parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || part.endsWith(".")))
    throw new Error("CLI profile path is invalid.");
  return parts;
}

function validateProfileRecipe(profile) {
  if (!plain(profile) || typeof profile.supported !== "boolean") throw new Error("CLI profile recipe is invalid.");
  let docs;
  try { docs = new URL(profile.docs); } catch { throw new Error("CLI profile documentation is invalid."); }
  if (docs.protocol !== "https:" || !docs.hostname || docs.username || docs.password) throw new Error("CLI profile documentation is invalid.");
  if (!profile.supported) {
    if (typeof profile.reason !== "string" || !profile.reason.trim() || profile.reason.length > 500 || profile.env !== undefined || profile.files !== undefined)
      throw new Error("Unsupported CLI profile recipe is invalid.");
    return { supported: false, reason: profile.reason, docs: docs.href };
  }
  if (!plain(profile.env) || !Object.keys(profile.env).length || Object.keys(profile.env).length > 8 || !Array.isArray(profile.files) || profile.files.length > 8)
    throw new Error("CLI profile recipe is invalid.");
  const env = {};
  for (const [name, relative] of Object.entries(profile.env)) {
    if (!PROFILE_ENV_NAMES.has(name)) throw new Error("CLI profile environment variable is unsupported.");
    relativeParts(relative, true);
    env[name] = relative;
  }
  const seen = new Set();
  const files = profile.files.map(file => {
    if (!plain(file) || typeof file.contents !== "string" || Buffer.byteLength(file.contents) > 8192 || file.contents.includes("\0")) throw new Error("CLI profile config is invalid.");
    relativeParts(file.relativePath);
    if (seen.has(file.relativePath.toLowerCase()) || !/^(?:[A-Za-z0-9._-]+\/)*config\.(?:toml|json)$/i.test(file.relativePath)) throw new Error("CLI profile config path is invalid.");
    seen.add(file.relativePath.toLowerCase());
    return { relativePath: file.relativePath, contents: file.contents };
  });
  if (env.CODEX_HOME !== undefined && (env.CODEX_HOME !== "." || !files.some(file => file.relativePath === "config.toml" && hasFileCredentialStore(file.contents))))
    throw new Error("Codex profile must use file credentials.");
  return { supported: true, env, files, docs: docs.href };
}

function isReparsePoint(stat) { return stat.isSymbolicLink() || Number.isInteger(stat.attributes) && (stat.attributes & 0x400) !== 0; }
function cleanEnvironment(inherited) {
  return Object.fromEntries(Object.entries(inherited).filter(([name]) => !INHERITED_PROVIDER_ENV.test(name)));
}
function assertDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || isReparsePoint(stat) || fs.realpathSync.native(directory) !== path.resolve(directory)) throw new Error("앱 전용 CLI 프로필 경로가 올바르지 않습니다.");
}

class CliProfileManager {
  constructor(root) { this.root = path.resolve(root); }

  state(recipe, { providerId, shared = false } = {}) {
    if (recipe === undefined) return { supported: false, shared: false, reason: "앱 전용 로그인을 사용하려면 연결 모듈을 업데이트하세요." };
    try {
      const checked = validateProfileRecipe(recipe);
      return checked.supported ? { supported: true, shared: false } : { supported: false, shared: providerId === "google" && shared === true, reason: checked.reason };
    } catch { return { supported: false, shared: false, reason: "앱 전용 로그인 설정을 검증하지 못했습니다. 연결 모듈을 업데이트하세요." }; }
  }

  directory(parts) {
    assertDirectory(this.root);
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
      assertDirectory(current);
    }
    return current;
  }

  configFile(profileRoot, file, recipe) {
    const parts = relativeParts(file.relativePath);
    const parent = parts.length > 1 ? this.directory([...path.relative(this.root, profileRoot).split(path.sep), ...parts.slice(0, -1)]) : profileRoot;
    const target = path.join(parent, parts.at(-1));
    try { fs.writeFileSync(target, file.contents, { flag: "wx", mode: 0o600 }); return; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || isReparsePoint(stat) || stat.nlink > 1 || fs.realpathSync.native(target) !== target || stat.size > MAX_CONFIG_BYTES)
      throw new Error("앱 전용 CLI 설정 파일이 올바르지 않습니다.");
    const existing = fs.readFileSync(target, "utf8");
    if (recipe.env.CODEX_HOME !== undefined && file.relativePath === "config.toml") {
      if (hasFileCredentialStore(existing)) return;
    } else if (existing === file.contents) return;
    throw new Error("앱 전용 CLI 설정이 변경되어 인증 격리를 확인하지 못했습니다. 기존 설정은 덮어쓰지 않았습니다.");
  }

  environment(providerId, profile, inherited = process.env, { shared = false } = {}) {
    const state = this.state(profile, { providerId, shared });
    if (!state.supported && !state.shared) {
      const error = new Error(state.reason);
      error.code = "CLI_PROFILE_UNAVAILABLE";
      throw error;
    }
    // Google 공유 로그인은 사용자가 명시적으로 선택한 경우에만 허용합니다.
    if (state.shared) return cleanEnvironment(inherited);
    const recipe = validateProfileRecipe(profile);
    if (typeof providerId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(providerId)) throw new Error("CLI profile provider is invalid.");
    const profileRoot = this.directory(["profiles", providerId]);
    const env = cleanEnvironment(inherited);
    for (const [name, relative] of Object.entries(recipe.env)) env[name] = this.directory(["profiles", providerId, ...relativeParts(relative, true)]);
    for (const file of recipe.files) this.configFile(profileRoot, file, recipe);
    return env;
  }
}

module.exports = { CliProfileManager, validateProfileRecipe, PROFILE_SCHEMA_VERSION, PROTECTED_PLAN_ENV };
