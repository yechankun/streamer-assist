export type AiMode = "cli" | "api";
export type AiBinding = { providerId: string; mode: AiMode; model: string; effort: string };
export type AiAssignments = { schemaVersion: 1; default: AiBinding | null; groups: Record<string, AiBinding>; functions: Record<string, AiBinding> };
export type AiResolvedBinding = { binding: AiBinding | null; source: "function" | "group" | "default" | "none"; available: boolean; reason?: string };
export type AiLogin = {
  operation?: "login" | "logout"; logoutSupported?: boolean; logoutKind?: "command" | "terminal" | "api-key" | "acp"; logoutInstructions?: string;
  supported: boolean; kind?: "browser" | "device" | "api-key" | "terminal";
  status: "idle" | "starting" | "waiting" | "verifying" | "succeeded" | "failed" | "canceled";
  message?: string; error?: string; instructions?: string; url?: string; code?: string;
  method?: string; keyUrl?: string;
  terminalClosed?: boolean;
};
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
  added: boolean; enabled: boolean; mode: AiMode; model: string; effort: string; hasKey: boolean; hasCliSession?: boolean;
  models: { id: string; name?: string; efforts?: string[] }[];
  cli?: { id?: string; status: string; version?: string; source?: string; progress?: number; bytes?: number; totalInstalledBytes?: number; error?: string; previousVersion?: string };
  error?: string;
  quota?: AiQuota;
  component?: AiComponent;
  cliProfile?: { supported: boolean; shared?: boolean; reason?: string };
  login?: AiLogin;
};
export type AiScope = { sessionId?: string; platform?: string; dateFrom?: string; dateTo?: string; from?: number; to?: number };
export type AiPreview = { totalEvents: number; sampledEvents: number; bytes: number; estimatedTokens: number; truncated: boolean; scope: AiScope };
export type AiJob = {
  id: string; status: "preparing" | "running" | "completed" | "canceled" | "failed";
  providerId: string; model: string; mode?: AiMode; effort?: string; text?: string; error?: string;
  preview?: AiPreview; createdAt?: number; prompt?: string; scope?: AiScope; usage?: AiUsage; cost?: AiCost | null;
  quotaBefore?: AiQuota | null; quotaAfter?: AiQuota | null;
  resultTruncated?: boolean;
  functionId?: string; assignmentSource?: AiResolvedBinding["source"];
};
export type AiState = { providers: AiProvider[]; job: AiJob | null; results: AiJob[]; encrypted: boolean; assignments?: AiAssignments; resolvedFunctions?: Record<string, AiResolvedBinding> };
