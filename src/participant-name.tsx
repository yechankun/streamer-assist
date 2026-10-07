import { Icon, PlatformIcon } from "./icons";
import type { Participant } from "./audience-types";
export function ParticipantName({ participant }: { participant: Participant }) {
  return <><span className="participant-platform">{participant.platform === "demo" ? <Icon name="message" size={16} /> : <PlatformIcon platform={participant.platform} size={16} />}</span><span title={participant.name}>{participant.name}</span>{participant.subscriber && <Icon name="sparkles" size={13} />}</>;
}
