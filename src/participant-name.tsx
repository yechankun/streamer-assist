import { Icon } from "./icons";
import { PlatformBadge } from "./platform-badge";
import type { Participant } from "./audience-types";
export function ParticipantName({ participant }: { participant: Pick<Participant, "platform" | "name" | "subscriber"> }) {
  return <><PlatformBadge platform={participant.platform} /><span className="participant-display-name" title={participant.name}>{participant.name}</span>{participant.subscriber && <Icon name="sparkles" size={13} />}</>;
}
