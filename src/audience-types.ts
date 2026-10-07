import type { ParticipationPlatform } from "./platforms";
export type AudiencePlatform = ParticipationPlatform;
export type Participant = {
  key: string;
  platform: AudiencePlatform;
  userId: string;
  name: string;
  subscriber: boolean;
};
export type RaffleDraw = {
  id: string;
  winner: Participant;
  participantCount?: number;
  startedAt: number;
  endsAt: number;
};
export type RaffleState = {
  id: string;
  title: string;
  active: boolean;
  openedAt: number;
  endsAt: number | null;
  closedAt?: number;
  reason?: string;
  config: {
    platforms: AudiencePlatform[];
    entryMode: "any" | "keyword";
    keyword: string;
    subscribersOnly: boolean;
    excludeWinners: boolean;
    timerSeconds: number | null;
  };
  candidates: Participant[];
  candidateCount: number;
  eligibleCount: number;
  draws: RaffleDraw[];
  latestDraw: RaffleDraw | null;
};
export type DonationPoll = {
  id: string;
  question: string;
  options: string[];
  counts: number[];
  platforms: AudiencePlatform[];
  active: boolean;
  mode: "donation";
  chatPrefix: string;
  openedAt: number;
  closedAt?: number;
  endsAt: number | null;
  donation: { currency: string; minimumMicros: number; plural: boolean };
  acceptedEvents: number;
  ignoredCurrency: number;
  reason?: string;
};
export type AudienceState = {
  raffle: RaffleState | null;
  donationPoll: DonationPoll | null;
};
