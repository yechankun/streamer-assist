import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "./workspace-state";
import { usePageActive } from "./activity";
import { Icon } from "./icons";
import { HelpTip } from "./help-tip";
import { textScaleEvent } from "./text-size";
import { aiCall, activeJob, byteSize, jobCostLabel, effortLabels, QuotaDisplay, UsageDisplay, useAiState } from "./ai-common";
import type { AiJob, AiPreview, AiScope } from "./ai-types";
import type { TimelineSession } from "./timeline-types";
import functionCatalog from "../electron/ai-functions.json";
import "./ai.css";
import "./ai-assignments.css";
const jobLabel: Record<string, string> = { preparing: "기록 준비 중", running: "분석 중", completed: "분석 완료", canceled: "취소됨", failed: "분석 실패" };
function resultPagesFor(text: string, width: number, rows: number, font: string) {
  if (!text) return [""];
  const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
  if (!context) return [text];
  context.font = font;
  const lines: string[] = [];
  for (const paragraph of text.replace(/\t/g, "  ").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.match(/\S+\s*|\s+/g) || []) {
      if (context.measureText(line + word).width <= width) { line += word; continue; }
      if (line) { lines.push(line.trimEnd()); line = ""; }
      if (context.measureText(word).width <= width) { line = word; continue; }
      for (const character of word) { if (context.measureText(line + character).width > width && line) { lines.push(line); line = ""; } line += character; }
    }
    lines.push(line.trimEnd());
  }
  const pages: string[] = [];
  for (let start = 0; start < lines.length; start += rows) pages.push(lines.slice(start, start + rows).join("\n"));
  return pages.length ? pages : [""];
}
export function AiAnalysisWorkspace({ session, sessions, onSettings }: { session?: TimelineSession; sessions: TimelineSession[]; onSettings?: (functionId?: string) => void }) {
  const pageActive = usePageActive();
  const { state, error, refresh } = useAiState();
  const [functionId, setFunctionId] = useTabState("analysis.functionId", "chat.custom");
  const [scopeMode, setScopeMode] = useTabState("analysis.scopeMode", "session"), [platform, setPlatform] = useTabState("analysis.platform", ""), [scopeOpen, setScopeOpen] = useState(false);
  const scopeDialog = useRef<HTMLDialogElement>(null);
  const [dateFrom, setDateFrom] = useTabState("analysis.dateFrom", ""), [dateTo, setDateTo] = useTabState("analysis.dateTo", "");
  const [from, setFrom] = useTabState("analysis.from", ""), [to, setTo] = useTabState("analysis.to", "");
  const [prompt, setPrompt] = useTabState("analysis.prompt", ""), [includeIdentity, setIncludeIdentity] = useTabState("analysis.includeIdentity", false);
  const [preview, setPreview] = useState<AiPreview | null>(null), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [chosenId, setChosenId] = useState("");
  const [detail, setDetail] = useState<AiJob | null>(null);
  const [resultPage, setResultPage] = useState(0);
  const latest = state.job && (!state.job.mode || ["api", "cli"].includes(state.job.mode)) ? state.job : null;
  const running = activeJob(state.job?.status);
  const activeAnalysis = latest && activeJob(latest.status) ? latest : null;
  const saved = state.results.find(row => row.id === chosenId);
  const summary = (latest?.id === chosenId ? latest : saved) ?? latest ?? state.results[0];
  const selectedId = summary?.id;
  const selectedStatus = summary?.status;
  const job = detail && detail.id === selectedId ? detail : summary;
  const readingActive = activeJob(job?.status);
  const generation = useRef(0);
  const reader = useRef<HTMLDivElement>(null);
  const [readerSize, setReaderSize] = useState({ width: 300, rows: 8, font: '12px "Segoe UI", "Malgun Gothic", sans-serif' });
  useLayoutEffect(() => {
    if (!pageActive) return;
    const element = reader.current; if (!element) return;
    const measure = () => { const style = getComputedStyle(element), fontSize = parseFloat(style.fontSize); setReaderSize({ width: Math.max(40, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 8), rows: Math.max(1, Math.floor((element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 5) / (fontSize * 1.8))), font: `${fontSize}px ${style.fontFamily}` }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); window.addEventListener(textScaleEvent,measure);
    return () => { observer.disconnect();window.removeEventListener(textScaleEvent,measure); };
  }, [pageActive]);
  const resolved = state.resolvedFunctions?.[functionId];
  const binding = resolved?.binding;
  const provider = state.providers.find(row => row.id === binding?.providerId);
  const available = !!resolved?.available;
  const sourceLabel = { function: "개별 기능 설정", group: "그룹 설정", default: "전체 기본 설정", none: "지정되지 않음" }[resolved?.source || "none"];
  const openSettings = () => onSettings?.(functionId);

  const scope: AiScope = useMemo(() => ({ sessionId: scopeMode === "session" ? session?.id : undefined, platform: platform || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, from: from ? +from * 60000 : undefined, to: to ? +to * 60000 : undefined }), [scopeMode, session?.id, platform, dateFrom, dateTo, from, to]);
  useEffect(() => { if (scopeOpen && scopeDialog.current && !scopeDialog.current.open) scopeDialog.current.showModal(); }, [scopeOpen]);
  const request = useMemo(() => ({ functionId, scope, includeIdentity, prompt }), [functionId, scope, includeIdentity, prompt]);
  useEffect(() => {
    setPreview(null); setMessage(""); const current = ++generation.current;
    if (!pageActive || !available || (scopeMode === "session" && !session)) return;
    let active = true;
    const timer = setTimeout(() => void aiCall<AiPreview>("ai-preview", { ...request, prompt: prompt.trim() || "분석 범위 미리보기" }).then(value => { if (active && current === generation.current) setPreview(value); }).catch(e => { if (active) setMessage((e as Error).message); }), 220);
    return () => { active = false; clearTimeout(timer); };
  }, [pageActive, available, functionId, binding?.providerId, binding?.mode, binding?.model, binding?.effort, scope, includeIdentity, prompt, scopeMode, session?.id]);
  useEffect(() => {
    setResultPage(0);
  }, [selectedId]);
  useEffect(() => {
    if (!pageActive || !selectedId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = await aiCall<AiJob>("ai-job-status", { id: selectedId });
        if (disposed) return;
        setDetail(next);
        if (activeJob(next.status)) timer = setTimeout(read, 700);
        else if (activeJob(selectedStatus)) void refresh();
      } catch (e) {
        if (!disposed) setMessage((e as Error).message);
      }
    };
    void read();
    return () => { disposed = true; clearTimeout(timer); };
  }, [pageActive, selectedId, selectedStatus, refresh]);
  const run = async () => {
    if (!available) { openSettings(); return; }
    setPending(true); setMessage(""); setResultPage(0);
    try { const value = await aiCall<{ id?: string; canceled?: boolean }>("ai-run", request); if (value.canceled || !value.id) return; setChosenId(value.id); await refresh(); }
    catch (e) { setMessage((e as Error).message); } finally { setPending(false); }
  };
  const resultTexts = useMemo(() => resultPagesFor(job?.text || "", readerSize.width, readerSize.rows, readerSize.font), [job?.text, readerSize.width, readerSize.rows, readerSize.font]);
  const resultPages = resultTexts.length;
  const page = Math.min(resultPage, resultPages - 1);
  const resultText = resultTexts[page];
  return <div className="ai-analysis-workspace">
    <section className="panel ai-request-panel">
      <div className="panel-heading"><h2><Icon name="activity" size={17} /> 분석 요청</h2>{onSettings && available && <button className="text-button" onClick={openSettings}>기능별 AI 설정</button>}</div>
        <div className="ai-analysis-source compact"><label>분석 기능<select aria-label="AI 분석 기능" value={functionId} disabled={running} onChange={e => { const selected = functionCatalog.functions.find(row => row.id === e.target.value); if (selected) { setFunctionId(selected.id); setPrompt(selected.prompt); } }}>{functionCatalog.groups.map(group => <optgroup key={group.id} label={group.name}>{functionCatalog.functions.filter(row => row.groupId === group.id).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</optgroup>)}</select></label>{binding && <span className="ai-config-summary" title={`${binding.model} · ${effortLabels[binding.effort] || binding.effort} · ${sourceLabel}`}><strong className="ai-function-binding" data-function-id={functionId} data-provider-id={binding.providerId} data-mode={binding.mode} data-model={binding.model} data-effort={binding.effort}>{`${provider?.name || binding.providerId} · ${binding.mode.toUpperCase()}`}</strong><span>{binding.model}</span></span>}</div>
        {!available && <div className="ai-route-unavailable" role="status"><Icon name="link" size={16} /><span>{resolved?.reason || "설정에서 이 기능에 사용할 AI와 모델을 지정하세요."}</span>{onSettings && <button className="secondary" onClick={openSettings}>AI 지정하기</button>}</div>}
        <label className="ai-question">분석 질문
          <textarea aria-label="AI 분석 요청" className="ai-prompt" placeholder="궁금한 내용을 입력하세요. 예: 30분 이후 시청자가 가장 많이 질문한 주제와 시점을 정리해줘." value={prompt} maxLength={6000} disabled={running} onChange={e => setPrompt(e.target.value)} />
        </label>
        <button className="ai-scope-summary" aria-label="AI 분석 범위 변경" disabled={running} onClick={() => setScopeOpen(true)}><Icon name="timeline" size={14} /><span>{scopeMode === "session" ? "선택한 방송" : "전체 방송"} · {platform ? ({ chzzk: "치지직", youtube: "YouTube", twitch: "Twitch", demo: "테스트" }[platform]) : "전체 플랫폼"} · {dateFrom || dateTo ? (dateFrom || "처음") + " ~ " + (dateTo || "최근") : "전체 날짜"}{from || to ? " · 시간 지정" : ""}</span><strong>범위 선택</strong></button>
        {scopeOpen && <dialog ref={scopeDialog} className="panel ai-scope-dialog" aria-label="AI 분석 범위 설정" onCancel={() => setScopeOpen(false)}><div className="panel-heading"><h2>분석할 기록 범위</h2><button className="text-button" aria-label="AI 분석 범위 닫기" onClick={() => setScopeOpen(false)}>닫기</button></div>
        <div className="ai-scope-grid"><label>기록 범위<select aria-label="AI 분석 기록 범위" value={scopeMode} onChange={e => setScopeMode(e.target.value)} disabled={running}><option value="session">선택한 방송</option><option value="all">전체 방송</option></select></label><label>플랫폼<select aria-label="AI 분석 플랫폼" value={platform} onChange={e => setPlatform(e.target.value)} disabled={running}><option value="">전체 플랫폼</option><option value="chzzk">치지직</option><option value="youtube">YouTube</option><option value="twitch">Twitch</option><option value="demo">테스트</option></select></label><label>시작 일자<input aria-label="AI 분석 시작 일자" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={running} /></label><label>종료 일자<input aria-label="AI 분석 종료 일자" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={running} /></label><label>시작 시점 · 분<input aria-label="AI 분석 시작 시점" type="number" min="0" max="10080" value={from} placeholder="제한 없음" disabled={running} onChange={e => setFrom(e.target.value)} /></label><label>종료 시점 · 분<input aria-label="AI 분석 종료 시점" type="number" min="0" max="10080" value={to} placeholder="제한 없음" disabled={running} onChange={e => setTo(e.target.value)} /></label></div>
          <p>날짜: PC 시간대 · 시점: 방송 시작 후 경과 분</p><button className="primary" onClick={() => setScopeOpen(false)}>범위 적용</button></dialog>}

        <label className="ai-identity-control"><input type="checkbox" checked={includeIdentity} disabled={running} onChange={e => setIncludeIdentity(e.target.checked)} /> 공개 닉네임·플랫폼 ID 포함</label>
        {available && <div className="ai-preview" aria-live="polite">{preview ? <><strong>{preview.sampledEvents.toLocaleString()} / {preview.totalEvents.toLocaleString()}건</strong><span>{byteSize(preview.bytes)} · 약 {preview.estimatedTokens.toLocaleString()}토큰</span>{preview.truncated && <small>전체 집계 + 채팅 샘플 · 일부 원문 제외</small>}</> : <small>{scopeMode === "session" && !session ? "선택한 방송 기록 없음" : message ? "기록 미리보기 실패" : "전송할 기록 확인 중"}</small>}</div>}
        <div className="ai-submit-row"><small>지정된 AI에 기록 원문 전송 · {includeIdentity ? "공개 닉네임·ID 포함" : "닉네임 가명화·공개 ID 제외"}</small>{activeAnalysis ? <button className="secondary" disabled={pending} onClick={async () => {
          setPending(true);
          try { await aiCall("ai-cancel", { id: activeAnalysis.id }); await refresh(); }
          catch (e) { setMessage((e as Error).message); } finally { setPending(false); }
        }}><Icon name="stop" size={14} /> 분석 중지</button> : <button className="primary" disabled={pending || running || !available || !prompt.trim() || !preview || preview.totalEvents === 0} onClick={() => void run()}><Icon name="play" size={14} /> {running ? "AI 연결 작업 중" : "분석 실행"}</button>}</div>
      {(message || error) && <div className="ai-inline-message" role="status" title={message || error}>{message || error}</div>}
    </section>
    <section className="panel ai-result-panel">
      <div className="panel-heading"><h2>분석 결과 <HelpTip label="AI 분석 결과 안내">AI의 해석이므로 원문·시점을 함께 확인하세요. 결과는 이 PC에 암호화해 보관하며, 요청 없이 기록을 자동 전송하지 않습니다.</HelpTip></h2><span className={readingActive ? "ai-job-status running" : "ai-job-status"}>{job ? jobLabel[job.status] : "요청 대기"}</span></div>
      {!!state.results.length && <div className="ai-result-picker"><select aria-label="저장된 AI 분석" value={selectedId ?? ""} onChange={e => setChosenId(e.target.value)}>{latest && !state.results.some(row => row.id === latest.id) && <option value={latest.id}>{jobLabel[latest.status]}</option>}{state.results.map(row => <option key={row.id} value={row.id}>{new Date(row.createdAt || 0).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {functionCatalog.functions.find(item => item.id === row.functionId)?.name || "분석"} · {state.providers.find(item => item.id === row.providerId)?.name || row.providerId}</option>)}</select><button className="text-button" disabled={!job || readingActive || pending || !state.results.some(row => row.id === selectedId)} onClick={() => { if (!job) return; void aiCall("ai-result-delete", { id: job.id }).then(() => { setChosenId(""); setDetail(null); void refresh(); }).catch(e => setMessage((e as Error).message)); }}>삭제</button></div>}
      <div ref={reader} className="ai-result-reader" tabIndex={0} aria-label="AI 분석 결과 본문" aria-live="off">{resultText ? <pre>{resultText}</pre> : <div className="ai-result-empty"><Icon name={readingActive ? "activity" : "message"} size={32} /><strong>{readingActive ? "분석 중" : job ? jobLabel[job.status] : "분석 결과 없음"}</strong>{job?.error && <p role="alert">{job.error}</p>}{readingActive && <span className="ai-working"><i /><i /><i /></span>}</div>}</div>
      {job && <details className="ai-result-details" key={job.id}>
        <summary>{job.model || "CLI 기본 모델"} · {job.cost?.estimated ? "추정 비용 " : ""}{jobCostLabel(job)}</summary>
        <div className="ai-result-meta">
          {job.functionId && <span>{functionCatalog.functions.find(row => row.id === job.functionId)?.name || job.functionId}</span>}
          <span>{state.providers.find(row => row.id === job.providerId)?.name || job.providerId}</span>
          {job.effort && <span>{effortLabels[job.effort] || job.effort}</span>}
        </div>
        <UsageDisplay job={job}/>
        {job.mode === "cli" && <QuotaDisplay quota={job.quotaAfter || job.quotaBefore}/>}
      </details>}
      {job?.resultTruncated && <div className="ai-inline-message" role="status">긴 결과는 보관 한도까지 표시합니다. 전체 응답이 아닐 수 있습니다.</div>}
      {job?.error && resultText && <div className="ai-inline-message" role="alert">{job.error}</div>}
      {resultPages > 1 && <div className="ai-result-footer"><div className="ai-page-controls"><button aria-label="이전 AI 결과 페이지" disabled={page === 0} onClick={() => setResultPage(page - 1)}>‹</button><span>{page + 1} / {resultPages}</span><button aria-label="다음 AI 결과 페이지" disabled={page >= resultPages - 1} onClick={() => setResultPage(page + 1)}>›</button></div></div>}
    </section>
  </div>;
}
