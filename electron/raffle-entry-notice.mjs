// A null notice means a viewer can enter through at least one selected chat.
export function raffleEntryNotice(raffle, connections, demo) {
  if (!raffle.active) {
    return raffle.candidateCount ? "모집이 종료됐습니다." : "참여자 없이 모집을 종료했습니다.";
  }
  const platforms = raffle.config.platforms;
  if (!platforms.length) return "선택한 플랫폼 없음";
  if (!platforms.some(platform => platform === "demo" ? demo : connections[platform] === "연결됨"))
    return "모집 대기";
  return null;
}
