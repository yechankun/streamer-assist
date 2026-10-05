const DEFAULT_VOTE_PREFIX = "!투표";
function validateVotePrefix(prefix) {
  if (
    typeof prefix !== "string" ||
    prefix.length > 12 ||
    /^\s/.test(prefix) ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(prefix)
  )
    throw new Error("접두어는 앞 공백과 줄바꿈 없이 12자 이하로 입력하세요.");
  return prefix;
}
function voteCommand(prefix, number) {
  return prefix + String(number);
}
function parseChatVote(text, prefix) {
  // Bare-number mode keeps the old exact-number rule. Commands, like the
  // reference site, must start the message and may be followed by chat text.
  if (prefix === "")
    return /^[1-4]$/.test(text.trim()) ? Number(text.trim()) : null;
  if (!text.startsWith(prefix)) return null;
  const match = text.slice(prefix.length).match(/^\s*(\d+)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}
module.exports = {
  DEFAULT_VOTE_PREFIX,
  validateVotePrefix,
  voteCommand,
  parseChatVote,
};
