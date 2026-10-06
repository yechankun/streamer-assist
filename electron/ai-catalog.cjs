const EFFORTS = ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
// This built-in registry deliberately contains identity only. Versioned provider
// metadata, model IDs, effort capabilities, endpoints and implementation live
// in the separately updateable provider component.
const providers = [
  { id: "openai", name: "OpenAI", packId: "openai" },
  { id: "anthropic", name: "Anthropic", packId: "anthropic" },
  { id: "xai", name: "xAI", packId: "xai" },
  { id: "google", name: "Google", packId: "google" },
  { id: "deepseek", name: "DeepSeek", packId: "deepseek" },
  { id: "moonshot", name: "Moonshot", packId: "moonshot" },
];
function endpoint(value) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash)
    throw new Error("API 주소는 HTTPS 또는 이 PC의 localhost 주소여야 합니다.");
  return url.href.replace(/\/$/, "");
}
function validateProvider(input) {
  if (!input || input.schemaVersion !== 1 || !/^custom-[a-z0-9-]{1,40}$/.test(input.id) || !["chat", "responses", "anthropic", "gemini"].includes(input.protocol))
    throw new Error("지원하지 않는 AI 연결 파일입니다. schemaVersion 1과 custom- ID가 필요합니다.");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 60 || !Array.isArray(input.models) || input.models.length > 100)
    throw new Error("AI 이름 또는 모델 목록이 올바르지 않습니다.");
  const models = input.models.map(model => {
    const row = typeof model === "string" ? { id: model, efforts: [] } : model;
    if (!row || typeof row.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(row.id) || !Array.isArray(row.efforts || []) || (row.efforts || []).some(x => !EFFORTS.includes(x)))
      throw new Error("모델 또는 추론 단계가 올바르지 않습니다.");
    return { id: row.id, efforts: (row.efforts || []).filter(x => x !== "default") };
  });
  return { schemaVersion: 1, id: input.id, name: input.name.trim(), baseUrl: endpoint(input.baseUrl), protocol: input.protocol, models, custom: true };
}
function efforts(provider, model, mode, advertised) {
  return ["default", ...new Set((Array.isArray(advertised) ? advertised : []).filter(x => EFFORTS.includes(x) && x !== "default"))];
}
function validateCapabilityProfile(input, knownIds) {
  if (!input || input.schemaVersion !== 1 || input.type !== "model-capabilities" || !knownIds.includes(input.providerId) || !Array.isArray(input.models) || !input.models.length || input.models.length > 1000)
    throw new Error("지원하지 않는 모델 호환성 파일입니다.");
  const checked = validateProvider({ schemaVersion: 1, id: "custom-validation", name: "Capabilities", protocol: "chat", baseUrl: "https://example.invalid/v1", models: input.models.slice(0, 100) }).models;
  if (input.models.length > 100) {
    for (let start = 100; start < input.models.length; start += 100)
      checked.push(...validateProvider({ schemaVersion: 1, id: "custom-validation", name: "Capabilities", protocol: "chat", baseUrl: "https://example.invalid/v1", models: input.models.slice(start, start + 100) }).models);
  }
  if (new Set(checked.map(row => row.id)).size !== checked.length) throw new Error("중복된 모델 ID가 있습니다.");
  return { schemaVersion: 1, type: "model-capabilities", providerId: input.providerId, models: checked };
}
module.exports = { providers, endpoint, validateProvider, validateCapabilityProfile, efforts, EFFORTS };
