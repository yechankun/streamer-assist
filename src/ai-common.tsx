import { useCallback, useEffect, useState } from "react";
import type { AiMode, AiProvider, AiState, AiQuota, AiJob } from "./ai-types";
export async function aiCall<T>(action: string, payload?: unknown): Promise<T> {
  if (!window.assist) throw new Error("데스크톱 앱에서 AI 연결을 사용할 수 있습니다.");
  const result = await window.assist.call(action, payload);
  if (!result.ok) throw new Error(result.error || "AI 요청을 처리하지 못했습니다.");
  return result.data as T;
}
const managedActions = new Set(["ai-install", "ai-update", "ai-component-remove", "ai-rollback", "ai-component-rollback", "ai-adapter-install", "ai-adapter-update", "ai-adapter-remove", "ai-adapter-rollback"]);
export async function aiOperation<T>(action: string, payload?: unknown): Promise<T> {
  const result = await aiCall<T>(action, payload);
  const id = (result as { id?: string } | null)?.id;
  if (!managedActions.has(action) || !id) return result;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const job = await aiCall<{ status: string; error?: string }>("ai-job-status", { id });
    if (job.status === "completed") return result;
    if (job.status === "failed") throw new Error(job.error || "구성요소 작업을 완료하지 못했습니다.");
    if (job.status === "canceled") throw new Error("구성요소 작업이 취소되었습니다.");
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("구성요소 작업 시간이 초과되었습니다. 진행 상태를 확인하세요.");
}
export function useAiState() {
  const [state, setState] = useState<AiState>({ providers: [], job: null, results: [], encrypted: false });
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try { const next = await aiCall<AiState>("ai-state"); setState(next); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    let active = true, pending = false;
    const update = async () => { if (pending || !active) return; pending = true;
      try { const next = await aiCall<AiState>("ai-state"); if (active) { setState(next); setError(""); } }
      catch (e) { if (active) setError((e as Error).message); } finally { pending = false; }
    };
    void update(); const timer = setInterval(() => void update(), 1500);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return { state, error, refresh };
}
export const effortLabels: Record<string, string> = { default: "서비스 기본값", none: "추론 끄기", minimal: "최소", low: "낮음", medium: "보통", high: "높음", xhigh: "매우 높음", max: "최대", ultra: "Ultra" };
export function ModelControls({ provider, mode, model, effort, onModel, onEffort, disabled, onRefresh, revision = 0, canRefresh = true }: {
  provider?: AiProvider; mode: AiMode; model: string; effort: string;
  onModel: (value: string) => void; onEffort: (value: string) => void; disabled?: boolean;
  onRefresh?: () => void; revision?: number; canRefresh?: boolean;
}) {
  const [choices, setChoices] = useState(["default"]);
  const [models, setModels] = useState(provider?.models || []);
  const modelSignature = (provider?.models || []).map(row => row.id + ":" + (row.efforts || []).join(",")).join("|");
  useEffect(() => {
    let active = true;
    setChoices(["default"]);
    setModels(mode === provider?.mode ? provider?.models || [] : []);
    const timer = setTimeout(() => { if (provider) void aiCall<{ efforts: string[]; models?: AiProvider["models"] }>("ai-model-options", { providerId: provider.id, mode, model })
      .then(result => { if (active) { const values = result.efforts || ["default"]; setChoices(values); if (result.models) setModels(result.models); if (!values.includes(effort)) onEffort("default"); } }).catch(() => {});
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [provider?.id, mode, model, modelSignature, revision]);
  return <div className="ai-model-controls">
    <label><span className="ai-select-label">모델{onRefresh && <button className="text-button" type="button" aria-label="AI 모델 목록 조회" disabled={disabled || !canRefresh} onClick={onRefresh}>목록 조회</button>}</span><select aria-label="AI 모델" title={model} value={models.some(row => row.id === model) ? model : ""} disabled={disabled || !models.length} onChange={e => onModel(e.target.value)}><option value="" disabled>{models.length ? "사용 가능한 모델 선택" : "먼저 모델 목록을 조회하세요"}</option>{models.map(row => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}</select>
    </label>
    <label>추론 정도<select aria-label="AI 추론 정도" value={choices.includes(effort) ? effort : "default"} disabled={disabled || choices.length === 1} onChange={e => onEffort(e.target.value)}>{choices.map(value => <option key={value} value={value}>{effortLabels[value] || value}</option>)}</select></label>
  </div>;
}
export const byteSize = (value: number) => value >= 1048576 ? (value / 1048576).toFixed(1) + " MB" : (value / 1024).toFixed(1) + " KB";
export const activeJob = (status?: string) => status === "preparing" || status === "running";
export function QuotaDisplay({ quota }: { quota?: AiQuota | null }) {
  if (!quota?.available || !quota.windows?.length) return <small className="ai-quota-unavailable" title={quota?.reason}>{quota?.reason || "CLI에서 제공하는 한도 정보를 아직 조회하지 않았습니다."}</small>;
  return <div className="ai-quota-windows">{quota.windows.slice(0, 3).map((item, i) => <div className="ai-quota-window" key={item.key || i} title={item.resetsAt ? "초기화: " + new Date(item.resetsAt).toLocaleString("ko-KR") : "초기화 시각 제공 안 됨"}><span title={item.name}>{/week|seven_day/i.test(item.name) ? "주간" : /hour|five_hour/i.test(item.name) ? "세션" : item.name}</span><progress max="100" value={item.usedPercent} /><strong>{Math.round(item.remainingPercent)}% 남음</strong>{item.resetsAt && <small>{new Date(item.resetsAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 초기화</small>}</div>)}</div>;
}
export function UsageDisplay({ job }: { job: AiJob }) {
  const number = (value?: number | null) => typeof value === "number" ? value.toLocaleString("ko-KR") : "미제공";
  const cost = job.cost;
  const basis = [cost?.source || cost?.reason, cost?.checkedAt ? "기준일: " + new Date(cost.checkedAt).toLocaleDateString("ko-KR") : ""].filter(Boolean).join(" · ");
  return <div className="ai-usage-strip"><div><small>입력 / 출력 토큰</small><strong>{number(job.usage?.inputTokens)} / {number(job.usage?.outputTokens)}</strong></div><div><small>캐시 / 추론 토큰</small><strong>{number(job.usage?.cachedInputTokens)} / {number(job.usage?.reasoningTokens)}</strong></div><div title={basis}><small>{job.mode === "cli" && job.providerId !== "deepseek" ? "CLI 이용 요금" : cost?.estimated ? "추정 비용" : "비용"}</small><strong>{job.mode === "cli" && job.providerId !== "deepseek" ? "계정 플랜 기준" : cost && typeof cost.amount === "number" ? "$" + cost.amount.toFixed(cost.amount < .01 ? 6 : 4) : "요금 정보 미제공"}</strong></div></div>;
}
