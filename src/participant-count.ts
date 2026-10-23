export function participantCount(value: number) {
  const count = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (count <= 10) return count + "명";
  if (count < 100) return Math.floor(count / 10) * 10 + "명+";
  return 10 ** Math.floor(Math.log10(count)) + "명+";
}
