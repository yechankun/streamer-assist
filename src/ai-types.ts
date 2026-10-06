export type AiMode = "cli" | "api";
export type AiQuota = { available: boolean; windows: { name: string; key?: string; usedPercent: number; remainingPercent: number; resetsAt?: number | null }[]; source?: string; updatedAt?: number; reason?: string };
export type AiUsage = { inputTokens: number | null; outputTokens: number | null; cachedInputTokens?: number | null; reasoningTokens?: number | null; totalTokens?: number | null };
export type AiCost = { amount: number | null; currency: string; estimated: boolean; source?: string; checkedAt?: number | string; reason?: string };
export type AiComponent = {
  status: string; version?: string | null; previousVersion?: string | null;
  latestVersion?: string | null; updateAvailable?: boolean; progress?: number;
  bytes?: number; totalInstalledBytes?: number; repository?: string; error?: string | null;
};
export type AiProvider = {
  id: string; name: string; apiName?: string; cliNote?: string; custom?: boolean;
  added: boolean; enabled: boolean; mode: AiMode; model: string; effort: string; hasKey: boolean;
  models: { id: string; efforts?: string[] }[];
  cli?: { id?: string; status: string; version?: string; source?: string; progress?: number; bytes?: number; totalInstalledBytes?: number; error?: string; previousVersion?: string };
  error?: string;
  quota?: AiQuota;
  component?: AiComponent;
};
export type AiScope = { sessionId?: string; platform?: string; dateFrom?: string; dateTo?: string; from?: number; to?: number };
export type AiPreview = { totalEvents: number; sampledEvents: number; bytes: number; estimatedTokens: number; truncated: boolean; scope: AiScope };
export type AiJob = {
  id: string; status: "preparing" | "running" | "completed" | "canceled" | "failed";
  providerId: string; model: string; mode?: AiMode; effort?: string; text?: string; error?: string;
  preview?: AiPreview; createdAt?: number; prompt?: string; scope?: AiScope; usage?: AiUsage; cost?: AiCost | null;
  quotaBefore?: AiQuota | null; quotaAfter?: AiQuota | null;
  resultTruncated?: boolean;
};
export type AiState = { providers: AiProvider[]; job: AiJob | null; results: AiJob[]; encrypted: boolean };
