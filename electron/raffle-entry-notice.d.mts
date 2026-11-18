import type { RaffleState } from "../src/audience-types";
import type { Platform } from "../src/platforms";

export function raffleEntryNotice(
  raffle: RaffleState, connections: Record<Platform, string>, demo: boolean
): string | null;
