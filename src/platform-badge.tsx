import { Icon, PlatformIcon } from "./icons";
import { platformLabel, type ParticipationPlatform } from "./platforms";
import "./platform-badge.css";

export function PlatformBadge({ platform, compact = false }: { platform: ParticipationPlatform; compact?: boolean }) {
  const label = platform === "demo" ? "테스트" : platformLabel(platform);
  return <span className={"participant-platform platform-badge " + platform + (compact ? " compact" : "")} role="img" aria-label={label} title={label}>
    {platform === "demo" ? <Icon name="message" size={14} /> : <PlatformIcon platform={platform} size={14} />}
  </span>;
}
