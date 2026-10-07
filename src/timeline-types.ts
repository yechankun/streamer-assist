import type { ParticipationPlatform } from "./platforms";
export type TimelineMarker = {
  id: string;
  at: number;
  timecode: string;
  label: string;
  kind: string;
  evidence?: {
    messages: number;
    unique: number;
    ratio: number;
    samples: string[];
  };
};
export type TimelineSession = {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  captureStartedAt?: number;
  recordingMode?: string;
  schemaVersion?: number;
  markers: TimelineMarker[];
  sources?: {
    key: string;
    platform: string;
    name: string;
    title: string;
    startTimeQuality: string;
  }[];
  telemetry?: {
    chats: number;
    donations: number;
    participants: number;
    viewerSamples: number;
  };
};
export type TimelineEvent = {
  id: string;
  sessionId?: string;
  sessionTitle?: string;
  date?: string;
  seq: number;
  type: "chat" | "donation";
  platform: ParticipationPlatform;
  timestamp: number;
  receivedAt: number;
  at: number;
  participantKey: string | null;
  displayName: string;
  text: string;
  subscriber: boolean | null;
  roles: string[];
  currency?: string;
  amountMicros?: number;
  historical?: boolean;
};
export type HistoryCursor = { timestamp: number; sessionId: string; seq: number };
export type HistoryRecordsResult = { events: TimelineEvent[]; hasMore: boolean; nextCursor: HistoryCursor | null };
export type ViewerPoint = {
  timestamp: number;
  at: number;
  sources: {
    platform: ParticipationPlatform;
    count: number | null;
    available: boolean;
    live: boolean | null;
  }[];
};
export type TimelineAnalysis = {
  method: string;
  chats: number;
  donations: number;
  uniqueParticipants: number;
  money: Record<string, number>;
  reactions: Record<string, number>;
  keywords: { text: string; count: number }[];
  repeats: { text: string; count: number }[];
  bins: {
    minute: number;
    chats: number;
    laugh: number;
    question: number;
    excitement: number;
  }[];
  participants: {
    key: string;
    platform: ParticipationPlatform;
    displayName: string;
    chats: number;
    donations: number;
    subscriber: boolean | null;
    roles: string[];
    nameChanges: number;
  }[];
  viewers: ViewerPoint[];
  limited: boolean;
};

export type HistoryDay = { date: string; chats: number; donations: number; bytes: number; sessions: string[]; protected: boolean };
export type HistoryCalendar = { days: HistoryDay[]; totalBytes: number; selectedBytes: number; sharedBytes: number; timeZone: string; token: string; selectedDates: string[] };
