import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { HelpTip } from "./help-tip";
import { AiProviderIcon } from "./ai-provider-icon";
import { aiCall, aiOperation, byteSize, ModelControls, QuotaDisplay, useAiState } from "./ai-common";
import type { AiMode, AiProvider } from "./ai-types";
import "./ai.css";
import { AiComponentPanel } from "./ai-components";
import { AiProviderPicker } from "./ai-provider-picker";
import { AiLoginDialog } from "./ai-login-dialog";
import { AiAssignmentsSettings } from "./ai-assignments";
export function AiSettings({ initialPage = "connections", initialFunctionId }: { initialPage?: "connections" | "assignments"; initialFunctionId?: string } = {}) {
  const [page, setPage] = useState(initialPage);
  const [targetFunction, setTargetFunction] = useState(initialFunctionId);
  useEffect(() => { setPage(initialPage); setTargetFunction(initialFunctionId); }, [initialPage, initialFunctionId]);
  return <div className="ai-settings-workspace" id="settings-ai" role="tabpanel" aria-label="AI 설정"><nav className="ai-settings-navigation" aria-label="AI 설정 보기"><button aria-pressed={page === "connections"} onClick={() => { setPage("connections"); setTargetFunction(undefined); }}><Icon name="link" size={14} /> AI 연결</button><button aria-pressed={page === "assignments"} onClick={() => { setPage("assignments"); setTargetFunction(undefined); }}><Icon name="settings" size={14} /> 기능별 AI</button></nav>{page === "connections" ? <AiConnections /> : <AiAssignmentsSettings initialFunctionId={targetFunction} onConnections={() => { setPage("connections"); setTargetFunction(undefined); }} />}</div>;
}
function AiConnections() {
  const { state, error, refresh } = useAiState();
  const [selected, setSelected] = useState(""), [providerPage, setProviderPage] = useState(0), [manageComponents, setManageComponents] = useState(false), [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<AiMode>("cli"), [model, setModel] = useState(""), [effort, setEffort] = useState("default");
  const [key, setKey] = useState(""), [pending, setPending] = useState(false), [message, setMessage] = useState(""), [modelRevision, setModelRevision] = useState(0);
  const [loginTarget, setLoginTarget] = useState<{ id: string; mode: AiMode; operation?: "login" | "logout" } | null>(null);
  const [runtimeDetails, setRuntimeDetails] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false), [checkMessage, setCheckMessage] = useState("");
  const checkGeneration = useRef(0);
  const addedProviders = state.providers.filter(row => row.added);
  const provider = addedProviders.find(row => row.id === selected) || addedProviders[0];
  useEffect(() => { setProviderPage(page => Math.min(page, Math.max(0, Math.ceil(addedProviders.length / 6) - 1))); }, [addedProviders.length]);
  useEffect(() => {
    if (!provider) { setKey(""); setModel(""); setManageComponents(false); return; }
    setMode(provider.mode); setModel(provider.model || ""); setEffort(provider.effort || "default"); setKey(""); setMessage(""); setManageComponents(false); setRuntimeDetails(false);
  }, [provider?.id]);
  useEffect(() => () => setKey(""), []);
  const act = async (action: string, payload: Record<string, unknown> = {}, success = "") => {
    setPending(true); setMessage("");
    try { await aiOperation(action, { providerId: provider?.id, ...payload }); setMessage(success); await refresh(); return true; }
    catch (e) { setMessage((e as Error).message); return false; }
    finally { setPending(false); }
  };
  const component = provider?.component;
  const componentReady = provider?.custom || !!component?.version;
  const showComponents = !provider?.custom && (manageComponents || !componentReady);
  const cli = provider?.cli;
  const downloading = ["checking", "installing", "downloading", "removing", "updating", "rolling-back"].includes(cli?.status || "");
  const installed = !!cli?.version || cli?.status === "ready" || cli?.status === "installed";
  const canLogoutCli = provider?.id === "deepseek" ? provider.hasKey : provider?.hasCliSession === true;
  const accountReady = mode === "api" ? !!provider?.hasKey : !!canLogoutCli;
  const aiBusy = state.job?.status === "running" || state.job?.status === "preparing";
  const updatesAllowed = cli?.updateCheckStatus === "checked" && cli.updateAvailable === true && !!cli.latestVersion && !checkingUpdates;
  const checkUpdates = async (force = false) => {
    if (!provider || provider.custom || !componentReady) { setCheckingUpdates(false); setCheckMessage(""); return; }
    const generation = ++checkGeneration.current;
    setCheckingUpdates(true); setCheckMessage("");
    try { await aiCall("ai-update-check", { providerId: provider.id, force }); if (generation === checkGeneration.current) await refresh(); }
    catch (e) { if (generation === checkGeneration.current) setCheckMessage((e as Error).message); }
    finally { if (generation === checkGeneration.current) setCheckingUpdates(false); }
  };
  useEffect(() => {
    void checkUpdates();
    return () => { checkGeneration.current++; };
  }, [provider?.id, component?.version, cli?.version, runtimeDetails, showComponents]);
  const providerStatus = (row: AiProvider) => row.component?.status === "installing" ? "연결 준비 중" : row.hasCliSession && row.hasKey ? "CLI·API 연결됨" : row.hasCliSession ? "CLI 로그인 완료" : row.hasKey ? "API 키 저장됨" : row.component?.version || row.custom ? "로그인 필요" : "연결 준비 필요";
  const addProvider = async (row: AiProvider) => {
    setPending(true); setMessage("");
    try {
      await aiCall("ai-provider-add", { providerId: row.id });
      setSelected(row.id); setProviderPage(Math.floor(addedProviders.length / 6)); setPickerOpen(false);
      await refresh();
      if (!row.custom && (!row.component?.version || !row.login?.kind)) {
        await aiOperation(row.component?.version ? "ai-adapter-update" : "ai-adapter-install", { providerId: row.id });
        await refresh();
      }
    } catch (e) { setMessage((e as Error).message); }
    finally { setPending(false); }
  };
  const removeProvider = async (row: AiProvider) => {
    if (await act("ai-provider-remove", { providerId: row.id })) {
      setKey(""); if (selected === row.id) setSelected("");
    }
  };
  const queryModels = async () => {
    if (!provider) return;
    setPending(true); setMessage("");
    try {
      if (key) { await aiCall("ai-key-save", { providerId: provider.id, key }); setKey(""); }
      const data = await aiCall<{ models: { id: string }[]; currentModelId?: string }>("ai-models", { providerId: provider.id, mode });
      if (!data.models.length) throw new Error("사용 가능한 모델을 조회하지 못했습니다. 로그인과 연결 상태를 확인하세요.");
      setModel(previous => data.models.some(row => row.id === previous) ? previous : data.models.some(row => row.id === data.currentModelId) ? data.currentModelId! : data.models[0].id);
      setEffort("default"); setModelRevision(value => value + 1);
      setMessage((mode === "cli" ? "CLI" : "API") + "에서 " + data.models.length + "개 모델을 조회했습니다.");
      await refresh();
    } catch (e) { setMessage((e as Error).message); }
    finally { setPending(false); }
  };
  return <div className="ai-settings" aria-label="AI 연결 설정">
    <aside className="ai-provider-rail">
      <div className="ai-rail-heading"><span>AI 연결</span><button className="text-button" disabled={pending} aria-label="AI 연결 추가" aria-haspopup="dialog" title="AI 선택해서 추가" onClick={() => { setMessage(""); setPickerOpen(true); }}>+</button></div>
      {addedProviders.slice(providerPage * 6, providerPage * 6 + 6).map(row => <div key={row.id} className="ai-provider-row"><button className={provider?.id === row.id ? "ai-provider selected" : "ai-provider"} disabled={pending} onClick={() => setSelected(row.id)}>
        <AiProviderIcon providerId={row.id} /><span><strong>{row.name}</strong><small>{providerStatus(row)}</small></span><i className={row.hasKey || row.hasCliSession ? "dot green" : "dot"} />
      </button><button className="text-button ai-provider-remove" aria-label={row.name + " 제거"} title="목록에서 제거" disabled={pending} onClick={() => void removeProvider(row)}><Icon name="close" size={13} /></button></div>)}
      {addedProviders.length > 6 && <div className="ai-page-controls"><button aria-label="이전 AI 연결 페이지" disabled={providerPage === 0} onClick={() => setProviderPage(providerPage - 1)}>‹</button><span>{providerPage + 1} / {Math.ceil(addedProviders.length / 6)}</span><button aria-label="다음 AI 연결 페이지" disabled={(providerPage + 1) * 6 >= addedProviders.length} onClick={() => setProviderPage(providerPage + 1)}>›</button></div>}
    </aside>
    {!provider ? <div className="ai-empty-settings"><span className="ai-empty-symbol"><Icon name="link" size={29} /></span><strong>연결된 AI가 없습니다</strong><button className="primary" disabled={pending} onClick={() => { setMessage(""); setPickerOpen(true); }}><Icon name="plus" size={15} /> AI 추가</button>{(message || error) && <small role="status">{message || error}</small>}</div> : <section className="panel ai-connection-panel">
      <div className="ai-connection-heading"><div><span className="eyebrow">AI 연결</span><h2 title={provider?.name}>{provider?.name || "연결 불러오는 중"}</h2></div><div className="ai-heading-actions"><span className={"ai-account-status" + (accountReady ? " connected" : "")}>{accountReady ? <Icon name="check" size={13} /> : <Icon name="info" size={13} />}{accountReady ? mode === "cli" && provider.id !== "deepseek" ? "로그인 완료" : "API 키 저장됨" : componentReady ? "연결 필요" : "준비 필요"}</span>{!provider?.custom && <button className="text-button" aria-label="AI 연결 모듈 관리" title="연결 모듈과 버전 관리" disabled={pending} onClick={() => setManageComponents(!manageComponents)}><Icon name="settings" size={15} /> 고급 관리</button>}</div></div>
      {showComponents ? <AiComponentPanel name={provider?.name || "AI"} component={component} pending={pending} message={message || error} onAction={(action, success) => void act(action, {}, success)} onConfigure={() => setManageComponents(false)} /> : <>
      <div className="ai-mode-switch" role="group" aria-label="AI 연결 방식">
        <button aria-pressed={mode === "cli"} disabled={!cli || pending} onClick={() => { if (mode !== "cli") setModel(""); setMode("cli"); setEffort("default"); }}><span>CLI</span><small>{provider?.id === "deepseek" ? "API 키로 실행" : "로그인·계정 플랜"}</small></button>
        <button aria-pressed={mode === "api"} disabled={pending} onClick={() => { if (mode !== "api") setModel(""); setMode("api"); setEffort("default"); }}><span>{provider?.apiName || "API"}</span><small>API 키·사용량 요금</small></button>
      </div>
      <div className="ai-connection-body">
        {mode === "cli" ? <div className="ai-runtime-card">
          <div className="ai-runtime-title"><Icon name="activity" size={17} /><strong>{downloading ? "CLI 준비 중" : installed ? "CLI" : "CLI 설치 필요"}</strong><HelpTip label="CLI 로그인 정보 안내">{provider?.cliProfile?.shared ? "PC의 Antigravity 로그인 정보를 공유합니다. 앱 전용 인증은 API 방식으로 연결하세요." : provider?.cliProfile?.supported ? cli?.source === "external" || cli?.source === "system" ? "PC의 CLI를 실행하며, 로그인 정보는 앱 전용으로 관리합니다." : "실행 파일과 로그인 정보를 앱 전용 폴더에서 관리합니다." : provider?.cliProfile?.reason || "앱 전용 로그인을 지원하는 연결 모듈로 업데이트하세요."}</HelpTip><small>{cli?.version ? "v" + cli.version : "설치 전"}</small></div>
          {(provider?.cliProfile?.shared || !provider?.cliProfile?.supported) && <p>{provider?.cliProfile?.shared ? "PC의 Antigravity 계정을 공유합니다." : provider?.cliProfile?.reason || "앱 전용 로그인을 지원하는 연결 모듈로 업데이트하세요."}</p>}
          {downloading && <progress aria-label="CLI 다운로드 진행률" max="1" value={cli?.progress || 0} />}
          <div className="ai-runtime-actions">
            {provider.id === "google" && !provider.cliProfile?.supported && <button className="secondary" aria-pressed={provider.cliProfile?.shared === true} disabled={pending || downloading} onClick={() => void act("ai-cli-sharing", { enabled: !provider.cliProfile?.shared })}>{provider.cliProfile?.shared && <Icon name="check" size={13} />}PC 로그인 공유</button>}
            {!installed && <button className="primary" disabled={pending || downloading} onClick={() => void act("ai-install", {}, "CLI 준비를 완료했습니다. 로그인해 연결하세요.")}>다운로드·설치</button>}
            {!canLogoutCli && <button className="primary" aria-haspopup="dialog" disabled={pending || !installed || downloading || provider.id === "google" && !provider.cliProfile?.supported && !provider.cliProfile?.shared} onClick={() => setLoginTarget({ id: provider.id, mode: "cli" })}>{provider.id === "deepseek" ? "API 키 연결" : "로그인"}</button>}
            {canLogoutCli && <button className="text-button" aria-haspopup="dialog" disabled={pending || !installed || downloading} onClick={() => setLoginTarget({ id: provider.id, mode: "cli", operation: "logout" })}>로그아웃</button>}
            <button className="text-button" aria-expanded={runtimeDetails} disabled={pending} onClick={() => setRuntimeDetails(!runtimeDetails)}>설치 관리 <Icon name="settings" size={12} /></button>
          </div>
          {runtimeDetails && <div className="ai-runtime-details"><div className="ai-runtime-actions"><button className="secondary" disabled={pending || downloading} onClick={() => void act("ai-detect")}>설치 찾기</button><button className="secondary" aria-label="CLI 최신 버전 확인" disabled={pending || checkingUpdates} onClick={() => void checkUpdates(true)}>{checkingUpdates ? "버전 확인 중…" : "버전 확인"}</button>{installed && <button className="secondary" aria-label="CLI 업데이트" disabled={pending || downloading || aiBusy || !updatesAllowed} onClick={() => void act("ai-update", {}, "CLI를 최신 버전으로 준비했습니다.")}>{updatesAllowed ? "업데이트" : checkingUpdates || cli?.updateCheckStatus === "checking" ? "업데이트 확인 중" : cli?.updateCheckStatus === "failed" ? "버전 확인 실패" : cli?.updateCheckStatus === "checked" && cli.latestVersion ? cli.version ? "최신 버전" : "설치 버전 확인 불가" : "업데이트 확인 필요"}</button>}{cli?.source === "managed" && <button className="text-button" disabled={pending || downloading} onClick={() => void act("ai-component-remove", {}, "앱에서 설치한 CLI를 제거했습니다.")}>제거</button>}{cli?.previousVersion && <button className="text-button" disabled={pending || downloading} onClick={() => void act("ai-component-rollback", {}, "이전 버전으로 복원했습니다.")}>이전 버전</button>}<button className="text-button" disabled={pending || !componentReady} onClick={() => void act("ai-docs-open")}>공식 안내 <Icon name="link" size={12} /></button></div><small role="status">{checkMessage || cli?.updateCheckError || (checkingUpdates ? "공식 배포처에서 새 버전을 확인하고 있습니다." : cli?.updateCheckStatus === "checked" ? cli.updateAvailable ? "새 버전 v" + cli.latestVersion + " 사용 가능" : cli.version ? "설치된 CLI가 최신 버전입니다." : "외부 CLI의 설치 버전을 확인할 수 없습니다." : "버전을 확인한 뒤 업데이트할 수 있습니다.")}{cli?.bytes ? " · 보관 용량 " + byteSize(cli.totalInstalledBytes || cli.bytes) : ""}</small></div>}
          {provider?.id !== "deepseek" && accountReady && <><div className="ai-quota-heading"><small>계정 사용 한도</small><button className="text-button" disabled={pending || !installed} onClick={() => void act("ai-quota-refresh")}>한도 조회</button></div><QuotaDisplay quota={provider?.quota} /></>}
        </div> : <div className="ai-key-card"><label>API 키<input aria-label="AI API 키" type="password" disabled={pending} value={key} onChange={e => setKey(e.target.value)} placeholder={provider?.hasKey ? "키 저장됨 · 변경할 때만 입력" : "발급한 API 키"} autoComplete="off" maxLength={4096} /></label><div className="ai-runtime-actions"><button className="secondary" aria-haspopup="dialog" disabled={pending} onClick={() => setLoginTarget({ id: provider.id, mode: "api" })}>{provider.hasKey ? "API 키 관리" : "API 연결 창 열기"}</button>{provider.hasKey && <button className="text-button" aria-haspopup="dialog" disabled={pending} onClick={() => setLoginTarget({ id: provider.id, mode: "api", operation: "logout" })}>로그아웃</button>}</div></div>}
        <div className={"ai-settings-model-row" + (mode === "cli" && provider?.id === "deepseek" ? " has-key" : "")}>
          {mode === "cli" && provider?.id === "deepseek" && <label className="ai-deepseek-key">DeepSeek API 키<input aria-label="DeepSeek CLI API 키" type="password" disabled={pending} value={key} onChange={e => setKey(e.target.value)} placeholder={provider.hasKey ? "키 저장됨" : "API 키"} autoComplete="off" maxLength={4096} /></label>}
          <ModelControls provider={provider} mode={mode} model={model} effort={effort} onModel={setModel} onEffort={setEffort} disabled={pending} revision={modelRevision} onRefresh={() => void queryModels()} canRefresh={mode === "api" ? !!(provider?.hasKey || key) : installed && (provider?.id !== "deepseek" || !!(provider?.hasKey || key))} />
        </div>
      </div>
      <div className="ai-settings-footer"><HelpTip label="AI 연결 저장 안내">선택한 모델은 이 연결의 기본값입니다. 기능별 AI에서 그룹·기능마다 다른 모델과 추론 수준을 지정할 수 있습니다. {state.encrypted ? "키와 분석 결과는 이 PC에 암호화해 보관합니다." : "키와 분석 결과를 저장하려면 Windows 보안 저장소를 확인해야 합니다."}</HelpTip><span className="ai-message" role="status" title={message || error || cli?.error}>{message || error || cli?.error || (state.encrypted ? "" : "보안 저장소 확인 필요")}</span><div className="ai-runtime-actions"><button className="primary" disabled={pending || !model.trim()} onClick={async () => { if (await act("ai-save", { mode, model: model.trim(), effort, enabled: true, ...(key ? { key } : {}) }, "AI 연결 설정을 저장했습니다.")) setKey(""); }}><Icon name="check" size={15} /> 연결 저장</button></div></div>
      </>}
    </section>}
    {pickerOpen && <AiProviderPicker providers={state.providers} pending={pending} message={message} onAdd={row => void addProvider(row)} onImport={() => void act("ai-provider-import").then(ok => { if (ok) setPickerOpen(false); })} onClose={() => setPickerOpen(false)} />}
    {loginTarget && state.providers.find(row => row.added && row.id === loginTarget.id) && <AiLoginDialog key={loginTarget.id + loginTarget.mode + loginTarget.operation} provider={state.providers.find(row => row.id === loginTarget.id)!} mode={loginTarget.mode} operation={loginTarget.operation} onLoggedOut={() => { setModel(""); setEffort("default"); setKey(""); void refresh(); }} onClose={() => { setLoginTarget(null); void refresh(); }} onUpdate={() => { setLoginTarget(null); setManageComponents(true); void act("ai-adapter-update", {}, "연결 모듈을 업데이트했습니다."); }} onModels={(models, currentModelId) => {
      setModel(previous => models.some(row => row.id === previous) ? previous : models.some(row => row.id === currentModelId) ? currentModelId! : models[0].id);
      setEffort("default"); setModelRevision(value => value + 1); setKey("");
      setMessage("사용 가능한 모델 " + models.length + "개 조회됨"); void refresh();
    }} />}
  </div>;
}
