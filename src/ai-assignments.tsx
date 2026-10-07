import { useEffect, useRef, useState } from "react";
import catalog from "../electron/ai-functions.json";
import { aiCall, effortLabels, useAiState } from "./ai-common";
import { Icon } from "./icons";
import type { AiBinding, AiMode, AiProvider } from "./ai-types";
import "./ai-assignments.css";

type Target = { scope: "default" | "group" | "function"; id?: string };
type Connection = { provider: AiProvider; mode: AiMode; key: string };
const sources = { function: "개별 설정", group: "그룹 설정", default: "전체 기본값", none: "미지정" };
const owns = (values: object | undefined, id: string) => Object.hasOwn(values || {}, id);
function connections(providers: AiProvider[]): Connection[] {
  return providers.filter(p => p.added).flatMap(provider => ([provider.mode, provider.mode === "cli" ? "api" : "cli"] as AiMode[])
    .filter(mode => mode === "api" ? provider.hasKey : provider.hasCliSession)
    .map(mode => ({ provider, mode, key: provider.id + "|" + mode })));
}

export function AiAssignmentsSettings({ initialFunctionId, onConnections }: { initialFunctionId?: string; onConnections: () => void }) {
  const { state, error, refresh } = useAiState();
  const [groupId, setGroupId] = useState(catalog.groups[0].id);
  const [overall, setOverall] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const busy = useRef(false), openedTarget = useRef<string | undefined>(undefined);
  const group = catalog.groups.find(g => g.id === groupId) || catalog.groups[0];
  const functions = catalog.functions.filter(f => f.groupId === group.id);
  const assignments = state.assignments;
  const choices = connections(state.providers);
  const groupOwn = owns(assignments?.groups, group.id);
  const groupBinding = groupOwn ? assignments?.groups[group.id] : assignments?.default;
  useEffect(() => {
    if (!initialFunctionId || openedTarget.current === initialFunctionId) return;
    const item = catalog.functions.find(f => f.id === initialFunctionId);
    if (item) { openedTarget.current = initialFunctionId; setGroupId(item.groupId); setOverall(false); }
  }, [initialFunctionId]);
  const perform = async (operation: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage("");
    try { await operation(); await refresh(); setMessage("설정을 저장했습니다."); }
    catch (e) { setMessage((e as Error).message); }
    finally { busy.current = false; setPending(false); }
  };
  const save = (target: Target, binding: AiBinding | null) => aiCall("ai-assignment-save", { ...target, binding });
  const selectConnection = (target: Target, key: string) => void perform(async () => {
    if (key === "none") return save(target, null);
    const choice = choices.find(row => row.key === key);
    if (!choice) throw new Error("로그인한 AI를 선택하세요.");
    let result = await aiCall<{ models: AiProvider["models"] }>("ai-model-options", { providerId: choice.provider.id, mode: choice.mode });
    if (!result.models.length) { result = await aiCall("ai-models", { providerId: choice.provider.id, mode: choice.mode }); setRevision(v => v + 1); }
    const model = result.models.find(row => row.id === choice.provider.model) || result.models[0];
    if (!model) throw new Error("사용 가능한 모델을 조회하지 못했습니다.");
    return save(target, { providerId: choice.provider.id, mode: choice.mode, model: model.id, effort: "default" });
  });
  const fields = (target: Target, binding: AiBinding | null | undefined, disabled = false, explicitOff = false) => <BindingSelects
    key={target.scope + (target.id || "default")} binding={binding} choices={choices} disabled={pending || disabled} explicitOff={explicitOff} revision={revision}
    onConnection={key => selectConnection(target, key)}
    onBinding={value => void perform(() => save(target, value))}
    onRefresh={() => void perform(async () => {
      if (!binding) return;
      const result = await aiCall<{ models: AiProvider["models"] }>("ai-models", { providerId: binding.providerId, mode: binding.mode });
      setRevision(v => v + 1);
      if (!result.models.some(row => row.id === binding.model)) {
        if (!result.models.length) throw new Error("사용 가능한 모델을 조회하지 못했습니다.");
        await save(target, { ...binding, model: result.models[0].id, effort: "default" });
      }
    })}
  />;
  return <div className="ai-assignments-settings" aria-label="기능별 AI 설정" aria-busy={pending}>
    <aside className="ai-function-groups" aria-label="AI 기능 그룹">
      <span className="eyebrow">기능 그룹</span>
      {catalog.groups.map(item => <button key={item.id} aria-pressed={!overall && group.id === item.id} onClick={() => { setGroupId(item.id); setOverall(false); setMessage(""); }}><span>{item.name}</span><small>{catalog.functions.filter(f => f.groupId === item.id).length}개 기능</small></button>)}
      <div className="ai-assignment-default"><small>전체 기본값</small><strong>{assignments?.default ? state.providers.find(p => p.id === assignments.default?.providerId)?.name || assignments.default.providerId : "AI 사용 안 함"}</strong><button className="secondary" aria-label="전체 AI 기본값 설정" aria-pressed={overall} onClick={() => { setOverall(!overall); setMessage(""); }}>전체 기본값 설정</button></div>
      <button className="text-button" onClick={onConnections}><Icon name="link" size={14} /> AI 연결 관리</button>
    </aside>
    <section className="panel ai-function-panel">
      <div className="ai-function-heading"><div><span className="eyebrow">기능별 AI</span><h2>{overall ? "전체 기본값" : group.name}</h2><p>{overall ? "그룹을 따로 지정하지 않은 기능에 적용합니다." : group.description}</p></div><span className="ai-function-count">{overall ? "기본 설정" : functions.length + "개 기능"}</span></div>
      <div className="ai-group-binding" data-assignment-scope={overall ? "default" : "group"} data-assignment-id={overall ? "default" : group.id}>
        <div className="ai-group-binding-heading"><strong>{overall ? "모든 그룹의 기본 AI" : "그룹 AI 설정"}</strong>{!overall && <button className="text-button" aria-label="전체 기본값으로 복원" disabled={pending || !groupOwn} onClick={() => void perform(() => aiCall("ai-assignment-clear", { scope: "group", id: group.id }))}>전체 기본값 사용</button>}</div>
        {fields(overall ? { scope: "default" } : { scope: "group", id: group.id }, overall ? assignments?.default : groupBinding, false, overall ? !assignments?.default : groupBinding === null)}
        <small>{overall ? "그룹·개별 설정은 유지됩니다." : "‘그룹 설정 따르기’가 켜진 기능에만 적용됩니다."}</small>
      </div>
      {overall ? <div className="ai-default-help"><Icon name="settings" size={24} /><strong>그룹과 기능에서 바로 고르세요</strong><p>왼쪽에서 그룹을 선택하면 AI·모델·추론 수준을 목록 안에서 바꿀 수 있습니다.</p><button className="secondary" onClick={() => setOverall(false)}>그룹 설정으로 돌아가기</button></div> : <div className="ai-function-list" aria-label={group.name + " 기능 목록"}>
        {functions.map(item => {
          const resolved = state.resolvedFunctions?.[item.id];
          const individual = owns(assignments?.functions, item.id);
          return <div className={"ai-function-row" + (individual ? " individual" : "") + (initialFunctionId === item.id ? " targeted" : "")} key={item.id} data-function-id={item.id} role="group" aria-label={item.name + " AI 설정"} title={resolved?.reason || item.description}>
            <div className="ai-function-row-heading"><div className="ai-function-info"><strong title={item.description}>{item.name}</strong><span className={"ai-assignment-source " + (resolved?.available ? "available" : "")}>{sources[resolved?.source || "none"]}{resolved?.binding === null && resolved.source !== "none" ? " · AI 사용 안 함" : ""}</span></div><button className="ai-group-follow" type="button" aria-label={item.name + " 그룹 설정 따르기"} aria-pressed={!individual} disabled={pending} onClick={() => void perform(() => aiCall("ai-assignment-inherit", { functionId: item.id, followGroup: individual }))}><Icon name={individual ? "link" : "check"} size={12} /> 그룹 설정 따르기</button></div>
            {fields({ scope: "function", id: item.id }, resolved?.binding, !individual, resolved?.binding === null)}
            {resolved?.reason && resolved.binding && <small className="ai-function-reason" title={resolved.reason}>{resolved.reason}</small>}
          </div>;
        })}
      </div>}
      <div className="ai-function-footer"><small role="status">{message || error || "선택하면 바로 저장됩니다. 개별 설정은 그룹 변경 시 유지됩니다."}</small>{!choices.length && <button className="primary" onClick={onConnections}>AI 연결 추가</button>}</div>
    </section>
  </div>;
}

function BindingSelects({ binding, choices, disabled, explicitOff, revision, onConnection, onBinding, onRefresh }: {
  binding: AiBinding | null | undefined; choices: Connection[]; disabled: boolean; explicitOff: boolean; revision: number;
  onConnection: (key: string) => void; onBinding: (binding: AiBinding) => void; onRefresh: () => void;
}) {
  const [models, setModels] = useState<AiProvider["models"]>([]);
  const [loading, setLoading] = useState(false);
  const selected = choices.find(row => row.key === binding?.providerId + "|" + binding?.mode);
  const modelSignature = selected?.provider.models.map(row => row.id + (row.efforts || []).join(",")).join("|");
  useEffect(() => {
    let active = true;
    setModels([]); setLoading(!!selected);
    if (selected) void aiCall<{ models: AiProvider["models"] }>("ai-model-options", { providerId: selected.provider.id, mode: selected.mode })
      .then(result => { if (active) setModels(result.models); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected?.key, modelSignature, revision]);
  const model = models.find(row => row.id === binding?.model);
  const efforts = model?.efforts?.length ? model.efforts : ["default"];
  const savedKey = binding ? binding.providerId + "|" + binding.mode : explicitOff ? "none" : "";
  return <div className="ai-binding-selects">
    <label>AI 연결<select aria-label="기능 AI 연결" value={savedKey} disabled={disabled} onChange={e => onConnection(e.target.value)}><option value="" disabled>AI 연결 선택</option><option value="none">AI 사용 안 함</option>{binding && !selected && <option value={savedKey} disabled>{binding.providerId} · 연결 필요</option>}{choices.map(choice => <option key={choice.key} value={choice.key}>{choice.provider.name} · {choice.mode.toUpperCase()}</option>)}</select></label>
    <label><span className="ai-select-label">모델<button className="text-button" type="button" aria-label="AI 모델 목록 조회" disabled={disabled || !selected || loading} onClick={onRefresh}>새로고침</button></span><select aria-label="AI 모델" value={binding?.model || ""} title={binding?.model} disabled={disabled || loading || !models.length || !binding} onChange={e => binding && onBinding({ ...binding, model: e.target.value, effort: "default" })}><option value="" disabled>{loading ? "모델 확인 중…" : "모델 선택"}</option>{binding && !model && <option value={binding.model} disabled>{binding.model}</option>}{models.map(row => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}</select></label>
    <label>추론 수준<select aria-label="AI 추론 정도" value={efforts.includes(binding?.effort || "default") ? binding?.effort || "default" : "default"} disabled={disabled || loading || !binding || efforts.length < 2} onChange={e => binding && onBinding({ ...binding, effort: e.target.value })}>{efforts.map(value => <option key={value} value={value}>{effortLabels[value] || value}</option>)}</select></label>
  </div>;
}
