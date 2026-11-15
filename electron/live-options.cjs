const { validateVotePrefix } = require("./vote-input.cjs");

function checkSession(current, input, label) {
  if (!current?.active || current.id !== input.id) throw Error(`진행 중인 ${label}을 확인하세요.`);
  if (!Number.isSafeInteger(input.revision) || input.revision !== (current.settingsRevision || 0))
    throw Error("다른 창에서 설정이 변경됐습니다. 설정을 다시 열어 주세요.");
}
function revisedChoices(current, input) {
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 100 ||
    !Array.isArray(input.options) || input.options.length < 2 || input.options.length > 4 ||
    input.options.some(text => typeof text !== "string" || !text.trim() || text.length > 50) ||
    new Set(input.options.map(text => text.trim())).size !== input.options.length)
    throw Error("질문은 100자 이하, 서로 다른 선택지 2~4개를 입력하세요.");
  const indices = input.optionIndices;
  if (!Array.isArray(indices) || indices.length !== input.options.length || indices.some(index => index !== null &&
    (!Number.isInteger(index) || index < 0 || index >= current.options.length)) ||
    new Set(indices.filter(index => index !== null)).size !== indices.filter(index => index !== null).length)
    throw Error("선택지 연결 정보를 확인하세요.");
  const mapping = new Map(indices.filter(index => index !== null).map(index => [index, indices.indexOf(index)]));
  if (current.options.some((_, index) => !mapping.has(index) &&
    ((current.counts[index] || 0) > 0 || (current.youtubeCounts?.[index] || 0) > 0)))
    throw Error("이미 표를 받은 선택지는 삭제할 수 없습니다. 이름을 수정해 주세요.");
  validateVotePrefix(input.chatPrefix);
  return { question: input.question.trim(), options: input.options.map(text => text.trim()),
    counts: indices.map(index => index === null ? 0 : current.counts[index]), mapping };
}
function remapVoters(voters, mapping) {
  return new Map([...voters].filter(([, index]) => mapping.has(index)).map(([key, index]) => [key, mapping.get(index)]));
}
// Keep data provenance even when the operator deselects a platform later.
function dataPlatforms(current, platforms) {
  return [...new Set([...(current.dataPlatforms || []), ...(current.config?.platforms || current.platforms || []), ...platforms])];
}
function settingsHistory(current, now) {
  return [...(current.settingsHistory || []), { changedAt:now, question:current.question, title:current.title,
    options:current.options?.slice(), counts:current.counts?.slice(), platforms:current.platforms?.slice(),
    chatPrefix:current.chatPrefix, endsAt:current.endsAt, donation:current.donation ? {...current.donation} : undefined,
    config:current.config ? {...current.config,platforms:current.config.platforms.slice()} : undefined }].slice(-30);
}
function publicPoll(poll) {
  if (!poll) return poll;
  const { settingsHistory, ...value } = poll;
  return value;
}
module.exports = { checkSession, revisedChoices, remapVoters, dataPlatforms, settingsHistory, publicPoll };
