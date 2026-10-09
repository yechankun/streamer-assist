const { createHash } = require("node:crypto");
const terms = require("../resources/terms.json");
const privacy = require("../resources/privacy.json");
const RETENTION_DAYS = 30;
// Content changes invalidate previous acceptance even if the displayed date is unchanged.
const version = createHash("sha256").update(JSON.stringify({ terms, privacy, retentionDays: RETENTION_DAYS })).digest("hex");
function current(value) {
  return value?.version === version && value.terms === true && value.privacy === true && value.retention === true
    && Number.isFinite(value.acceptedAt) && value.acceptedAt > 0 && value.acceptedAt <= Date.now();
}
function acceptance(payload) {
  if (payload?.version !== version) throw new Error("안내가 갱신되었습니다. 확인 화면을 다시 열어 주세요.");
  if (payload.terms !== true || payload.privacy !== true || payload.retention !== true)
    throw new Error("YouTube 연결 전에 약관·개인정보·보관 정책을 확인하고 동의하세요.");
  return { version, terms: true, privacy: true, retention: true, acceptedAt: Date.now(), termsVersion: terms.version, privacyVersion: privacy.version };
}
function links() {
  return [{ label: terms.title, url: terms.url }, { label: privacy.title, url: privacy.url },
    ...terms.sections.flatMap(section => section.links || []), ...privacy.sections.flatMap(section => section.links || [])];
}
module.exports = { version, current, acceptance, links, RETENTION_DAYS };
