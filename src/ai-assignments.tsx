import { useEffect, useRef, useState } from "react";
import catalog from "../electron/ai-functions.json";
import { aiCall, effortLabels, ModelControls, useAiState } from "./ai-common";
import { Icon } from "./icons";
import type { AiBinding, AiMode, AiProvider, AiResolvedBinding, AiState } from "./ai-types";
import "./ai-assignments.css";

type Target = { scope: "default" | "group" | "function"; id?: string };
const sources = { function: "개별 설정", group: "그룹 기본값", default: "전체 기본값", none: "미지정" };
function connections(providers: AiProvider[]) {
  return providers.filter(p => p.added).flatMap(provider => ([provider.mode, provider.mode === "cli" ? "api" : "cli"] as AiMode[])
    .filter(mode => mode === "api" ? provider.hasKey : provider.hasCliSession)
    .map(mode => ({ provider, mode, key: provider.id + "|" + mode })));
}
function summary(binding: AiBinding | null | undefined, providers: AiProvider[]) {
  if (!binding) return "AI를 지정하세요";
  const provider = providers.find(p => p.id === binding.providerId);
  return `${provider?.name || binding.providerId} · ${binding.mode.toUpperCase()} · ${binding.model} · ${effortLabels[binding.effort] || binding.effort}`;
}
export function AiAssignmentsSettings({ initialFunctionId, onConnections }: { initialFunctionId?: string; onConnections: () => void }) {
  const { state, error, refresh } = useAiState();
  const [groupId, setGroupId] = useState(catalog.groups[0].id);
  const [target, setTarget] = useState<Target | null>(null);
  const openedTarget = useRef<string | undefined>(undefined);
  const group = catalog.groups.find(g => g.id === groupId) || catalog.groups[0];
  const functions = catalog.functions.filter(f => f.groupId === group.id);
  const assignments = state.assignments;
  const groupBinding = assignments?.groups[group.id] || assignments?.default;
  const individualCount = functions.filter(f => assignments?.functions[f.id]).length;
  useEffect(() => {
    if (!state.assignments || !initialFunctionId || openedTarget.current === initialFunctionId) return;
    const item = catalog.functions.find(f => f.id === initialFunctionId);
    if (item) { openedTarget.current = initialFunctionId; setGroupId(item.groupId); setTarget({ scope: "function", id: item.id }); }
  }, [initialFunctionId, state.assignments]);
  return <div className="ai-assignments-settings" aria-label="기능별 AI 설정">
    <aside className="ai-function-groups" aria-label="AI 기능 그룹">
      <span className="eyebrow">기능 그룹</span>
      {catalog.groups.map(item => <button key={item.id} aria-pressed={group.id === item.id} onClick={() => setGroupId(item.id)}><span>{item.name}</span><small>{catalog.functions.filter(f => f.groupId === item.id).length}개 기능</small></button>)}
      <div className="ai-assignment-default"><small>전체 기본값</small><strong title={summary(assignments?.default, state.providers)}>{assignments?.default ? state.providers.find(p => p.id === assignments.default?.providerId)?.name || assignments.default.providerId : "미지정"}</strong><button className="secondary" aria-label="전체 AI 기본값 설정" onClick={() => setTarget({ scope: "default" })}>일괄 설정</button></div>
      <button className="text-button" onClick={onConnections}><Icon name="link" size={14} /> AI 연결 관리</button>
    </aside>
    <section className="panel ai-function-panel">
      <div className="ai-function-heading"><div><span className="eyebrow">기능별 AI</span><h2>{group.name}</h2><p>{group.description}</p></div><span className="ai-function-count">{functions.length}개 기능</span></div>
      <div className="ai-group-binding"><div><small>{assignments?.groups[group.id] ? "그룹 기본값" : "전체 기본값 사용"}</small><strong title={summary(groupBinding, state.providers)}>{summary(groupBinding, state.providers)}</strong><span>{individualCount ? `개별 설정 ${individualCount}개 · 나머지는 그룹 설정을 따릅니다.` : "이 그룹의 모든 기능이 같은 설정을 사용합니다."}</span></div><button className="secondary" aria-label={group.name + " 그룹 AI 설정"} onClick={() => setTarget({ scope: "group", id: group.id })}>그룹 설정</button></div>
      <div className="ai-function-list" aria-label={group.name + " 기능 목록"}>
        {functions.map(item => { const resolved = state.resolvedFunctions?.[item.id]; const individual = !!assignments?.functions[item.id]; return <button className={"ai-function-row" + (individual ? " individual" : "")} key={item.id} data-function-id={item.id} aria-label={item.name + " AI 설정"} onClick={() => setTarget({ scope: "function", id: item.id })}>
          <div className="ai-function-info"><strong>{item.name}</strong><p title={item.description}>{item.description}</p></div>
          <div className="ai-function-config"><span className={"ai-assignment-source " + (resolved?.available ? "available" : "")}>{sources[resolved?.source || "none"]}</span><strong title={summary(resolved?.binding, state.providers)}>{summary(resolved?.binding, state.providers)}</strong>{resolved?.reason && <small title={resolved.reason}>{resolved.reason}</small>}</div><Icon name="settings" size={16} />
        </button>; })}
      </div>
      <div className="ai-function-footer"><small>개별 설정을 먼저 적용하고, 없으면 그룹 → 전체 기본값 순서로 사용합니다.</small>{!connections(state.providers).length && <button className="primary" onClick={onConnections}>AI 연결 추가</button>}</div>
      {error && <p className="ai-inline-message" role="status">{error}</p>}
    </section>
    {target && <AiAssignmentEditor key={target.scope + target.id} target={target} state={state} onClose={() => setTarget(null)} onSaved={() => { setTarget(null); void refresh(); }} onConnections={onConnections} />}
  </div>;
}

function AiAssignmentEditor({ target, state, onClose, onSaved, onConnections }: { target: Target; state: AiState; onClose: () => void; onSaved: () => void; onConnections: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const isFunction = target.scope === "function";
  const item = catalog.functions.find(f => f.id === target.id);
  const group = catalog.groups.find(g => g.id === (isFunction ? item?.groupId : target.id));
  const own = target.scope === "default" ? state.assignments?.default : target.scope === "group" ? state.assignments?.groups[target.id!] : state.assignments?.functions[target.id!];
  const parent = isFunction ? state.assignments?.groups[item!.groupId] || state.assignments?.default : state.assignments?.default;
  const choices = connections(state.providers);
  const initial = own || parent;
  const initialKey = initial ? initial.providerId + "|" + initial.mode : choices[0]?.key || "";
  const [connectionKey, setConnectionKey] = useState(initialKey);
  const selected = choices.find(choice => choice.key === connectionKey);
  const [inherit, setInherit] = useState(isFunction && !own);
  const [model, setModel] = useState(initial?.model || selected?.provider.model || "");
  const [effort, setEffort] = useState(initial?.effort || "default");
  const [resetOverrides, setResetOverrides] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(""), [revision, setRevision] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const title = target.scope === "default" ? "전체 AI 기본값" : target.scope === "group" ? group!.name + " 그룹 설정" : item!.name + " AI 설정";
  const savedOther = target.scope === "default" ? Object.keys(state.assignments?.groups || {}).length + Object.keys(state.assignments?.functions || {}).length : catalog.functions.filter(f => f.groupId === group?.id && state.assignments?.functions[f.id]).length;
  const refreshModels = async () => {
    if (!selected) return;
    setPending(true); setMessage("");
    try { const result = await aiCall<{ models: { id: string }[]; currentModelId?: string }>("ai-models", { providerId: selected.provider.id, mode: selected.mode }); if (!result.models.length) throw new Error("사용 가능한 모델을 확인하지 못했습니다."); setModel(previous => result.models.some(row => row.id === previous) ? previous : result.currentModelId || result.models[0].id); setEffort("default"); setRevision(v => v + 1); }
    catch (e) { setMessage((e as Error).message); } finally { setPending(false); }
  };
  const save = async () => {
    setPending(true); setMessage("");
    try {
      if (isFunction && inherit) await aiCall("ai-assignment-clear", { scope: target.scope, id: target.id });
      else {
        if (!selected || !model) throw new Error("로그인한 AI와 모델을 선택하세요.");
        await aiCall("ai-assignment-save", { scope: target.scope, id: target.id, binding: { providerId: selected.provider.id, mode: selected.mode, model, effort }, resetOverrides });
      }
      onSaved();
    } catch (e) { setMessage((e as Error).message); } finally { setPending(false); }
  };
  const reset = async () => {
    setPending(true); setMessage("");
    try { await aiCall("ai-assignment-clear", { scope: target.scope, id: target.id }); onSaved(); } catch (e) { setMessage((e as Error).message); } finally { setPending(false); }
  };
  return <dialog ref={dialog} className="panel ai-assignment-dialog" aria-label={title} data-assignment-scope={target.scope} data-assignment-id={target.id || "default"} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <div className="panel-heading"><div><span className="eyebrow">{isFunction ? "기능 설정" : "일괄 설정"}</span><h2>{title}</h2></div><button className="text-button" aria-label="기능 AI 설정 닫기" disabled={pending} onClick={onClose}><Icon name="close" size={17} /></button></div>
    {isFunction && <div className="ai-assignment-inheritance" role="group" aria-label="기능 AI 설정 방식"><button aria-pressed={inherit} disabled={pending} onClick={() => setInherit(true)}>그룹 설정 따르기</button><button aria-pressed={!inherit} disabled={pending} onClick={() => setInherit(false)}>개별 설정</button></div>}
    {inherit ? <div className="ai-inherited-preview"><Icon name="link" size={23} /><strong>{summary(parent, state.providers)}</strong><p>그룹 기본값을 바꾸면 이 기능에도 자동으로 적용됩니다.</p></div> : choices.length ? <div className="ai-assignment-fields"><label>로그인한 AI<select aria-label="기능 AI 연결" value={selected?.key || ""} disabled={pending} onChange={e => { setConnectionKey(e.target.value); setModel(""); setEffort("default"); setMessage(""); }}><option value="" disabled>연결 선택</option>{choices.map(choice => <option key={choice.key} value={choice.key}>{choice.provider.name} · {choice.mode === "cli" ? "CLI 로그인" : "API 키"}</option>)}</select></label><ModelControls provider={selected?.provider} mode={selected?.mode || "cli"} model={model} effort={effort} onModel={value => { setModel(value); setEffort("default"); }} onEffort={setEffort} revision={revision} disabled={pending} canRefresh={!!selected} onRefresh={() => void refreshModels()} /><small>{selected?.mode === "api" || selected?.provider.id === "deepseek" ? "API 사용량에 따라 요금이 발생합니다." : "선택한 CLI 계정의 이용 한도를 사용합니다."}</small></div> : <div className="ai-inherited-preview"><Icon name="link" size={23} /><strong>먼저 사용할 AI에 로그인하세요</strong><p>연결한 CLI·API만 선택할 수 있습니다.</p><button className="primary" onClick={onConnections}>AI 연결 관리</button></div>}
    {!isFunction && savedOther > 0 && <label className="ai-assignment-reset"><input type="checkbox" aria-label="개별 AI 설정도 함께 변경" checked={resetOverrides} disabled={pending} onChange={e => setResetOverrides(e.target.checked)} /><span>{target.scope === "default" ? "그룹·개별 설정도 같은 값으로 변경" : "이 그룹의 개별 설정도 같은 값으로 변경"}<small>{resetOverrides ? "기존 개별 설정을 지우고 이 기본값을 적용합니다." : "체크하지 않으면 기존 개별 설정을 유지합니다."}</small></span></label>}
    <p className="ai-assignment-message" role="status">{message || (isFunction ? "이 기능의 AI 설정만 변경합니다." : "같은 그룹의 기능을 한 번에 설정할 수 있습니다.")}</p>
    <div className="ai-assignment-actions"><div>{own && !isFunction && <button className="text-button" disabled={pending} onClick={() => void reset()}>{target.scope === "group" ? "전체 기본값으로 복원" : "기본값 해제"}</button>}</div><button className="secondary" disabled={pending} onClick={onClose}>취소</button><button className="primary" aria-label="기능 AI 설정 적용" disabled={pending || (!inherit && (!selected || !model))} onClick={() => void save()}>{pending ? "적용 중…" : isFunction ? "기능에 적용" : target.scope === "group" ? "그룹에 적용" : "전체 기본값 적용"}</button></div>
  </dialog>;
}
