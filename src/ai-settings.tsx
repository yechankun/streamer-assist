import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { aiCall, aiOperation, byteSize, ModelControls, QuotaDisplay, useAiState } from "./ai-common";
import type { AiMode, AiProvider } from "./ai-types";
import "./ai.css";
import { AiComponentPanel } from "./ai-components";
import { AiProviderPicker } from "./ai-provider-picker";
import { AiLoginDialog } from "./ai-login-dialog";
export function AiSettings() {
  const { state, error, refresh } = useAiState();
  const [selected, setSelected] = useState(""), [providerPage, setProviderPage] = useState(0), [manageComponents, setManageComponents] = useState(false), [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<AiMode>("cli"), [model, setModel] = useState(""), [effort, setEffort] = useState("default");
  const [key, setKey] = useState(""), [pending, setPending] = useState(false), [message, setMessage] = useState(""), [modelRevision, setModelRevision] = useState(0);
  const [loginTarget, setLoginTarget] = useState<{ id: string; mode: AiMode; operation?: "login" | "logout" } | null>(null);
  const addedProviders = state.providers.filter(row => row.added);
  const provider = addedProviders.find(row => row.id === selected) || addedProviders[0];
  useEffect(() => { setProviderPage(page => Math.min(page, Math.max(0, Math.ceil(addedProviders.length / 6) - 1))); }, [addedProviders.length]);
  useEffect(() => {
    if (!provider) { setKey(""); setModel(""); setManageComponents(false); return; }
    setMode(provider.mode); setModel(provider.model || ""); setEffort(provider.effort || "default"); setKey(""); setMessage(""); setManageComponents(false);
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
  return <div className="ai-settings" id="settings-ai" role="tabpanel" aria-label="AI 연결 설정">
    <aside className="ai-provider-rail">
      <div className="ai-rail-heading"><span>AI 연결</span><button className="text-button" disabled={pending} aria-label="AI 연결 추가" aria-haspopup="dialog" title="AI 선택해서 추가" onClick={() => { setMessage(""); setPickerOpen(true); }}>+</button></div>
      {addedProviders.slice(providerPage * 6, providerPage * 6 + 6).map(row => <div key={row.id} className="ai-provider-row"><button className={provider?.id === row.id ? "ai-provider selected" : "ai-provider"} disabled={pending} onClick={() => setSelected(row.id)}>
        <span className="ai-provider-monogram">{row.name.slice(0, 1)}</span><span><strong>{row.name}</strong><small>{row.component?.status === "installing" ? "준비 중" : row.enabled ? row.mode === "cli" ? "CLI 사용" : "API 사용" : row.component?.version || row.custom ? "설정 필요" : "모듈 준비 필요"}</small></span><i className={row.enabled ? "dot green" : "dot"} />
      </button><button className="text-button ai-provider-remove" aria-label={row.name + " 제거"} title="목록에서 제거" disabled={pending} onClick={() => void removeProvider(row)}><Icon name="close" size={13} /></button></div>)}
      {addedProviders.length > 6 && <div className="ai-page-controls"><button aria-label="이전 AI 연결 페이지" disabled={providerPage === 0} onClick={() => setProviderPage(providerPage - 1)}>‹</button><span>{providerPage + 1} / {Math.ceil(addedProviders.length / 6)}</span><button aria-label="다음 AI 연결 페이지" disabled={(providerPage + 1) * 6 >= addedProviders.length} onClick={() => setProviderPage(providerPage + 1)}>›</button></div>}
      <p className="ai-rail-note">각 연결 모듈은 GitHub에서 추가·업데이트·제거합니다. 앱 설치 프로그램에 포함하지 않습니다.</p>
    </aside>
    {!provider ? <div className="ai-empty-settings"><span className="ai-empty-symbol"><Icon name="link" size={29} /></span><strong>필요한 AI를 추가하세요</strong><p>왼쪽 + 버튼에서 사용할 AI를 선택합니다.</p><button className="primary" disabled={pending} onClick={() => { setMessage(""); setPickerOpen(true); }}><Icon name="plus" size={15} /> AI 추가</button>{(message || error) && <small role="status">{message || error}</small>}</div> : <section className="panel ai-connection-panel">
      <div className="ai-connection-heading"><div><span className="eyebrow">AI CONNECTION</span><h2>{provider?.name || "연결 불러오는 중"}</h2></div><div className="ai-heading-actions">{!provider?.custom && <button className="text-button" aria-label="AI 연결 모듈 관리" disabled={pending} onClick={() => setManageComponents(!manageComponents)}>연결 모듈{component?.version ? " v" + component.version : ""}</button>}<button className="text-button" disabled={!provider || pending || !componentReady} onClick={() => void act("ai-docs-open")}>공식 안내 <Icon name="link" size={13} /></button></div></div>
      {showComponents ? <AiComponentPanel name={provider?.name || "AI"} component={component} pending={pending} message={message || error} onAction={(action, success) => void act(action, {}, success)} onConfigure={() => setManageComponents(false)} /> : <>
      <div className="ai-mode-switch" role="group" aria-label="AI 연결 방식">
        <button aria-pressed={mode === "cli"} disabled={!cli || pending} onClick={() => { if (mode !== "cli") setModel(""); setMode("cli"); setEffort("default"); }}><span>CLI</span><small>{provider?.id === "deepseek" ? "API 키로 Codex 실행" : "앱 전용 로그인"}</small></button>
        <button aria-pressed={mode === "api"} disabled={pending} onClick={() => { if (mode !== "api") setModel(""); setMode("api"); setEffort("default"); }}><span>{provider?.apiName || "API"}</span><small>API 키로 직접 연결</small></button>
      </div>
      <div className="ai-connection-body">
        {mode === "cli" ? <div className="ai-runtime-card">
          <div className="ai-runtime-title"><Icon name="activity" size={17} /><strong>{downloading ? "구성요소 설치 중" : installed ? "CLI 사용 가능" : "CLI 설치 확인"}</strong><small>{cli?.version ? "v" + cli.version : "설치 후 로그인"}</small></div>
          <p>{provider?.cliProfile?.shared ? "PC의 Antigravity 로그인 정보를 공유합니다. 앱 전용 인증은 API 방식으로 연결하세요." : provider?.cliProfile?.supported ? cli?.source === "external" || cli?.source === "system" ? "PC의 CLI를 실행하며, 로그인 정보는 앱 전용으로 관리합니다." : "실행 파일과 로그인 정보를 앱 전용 폴더에서 관리합니다." : provider?.cliProfile?.reason || "앱 전용 로그인을 지원하는 연결 모듈로 업데이트하세요."}</p>
          {downloading && <progress aria-label="CLI 다운로드 진행률" max="1" value={cli?.progress || 0} />}
          <div className="ai-runtime-actions">
            <button className="secondary" disabled={pending || downloading} onClick={() => void act("ai-detect")}>설치 찾기</button>
            {provider.id === "google" && !provider.cliProfile?.supported && <button className="secondary" aria-pressed={provider.cliProfile?.shared === true} disabled={pending || downloading} onClick={() => void act("ai-cli-sharing", { enabled: !provider.cliProfile?.shared })}>{provider.cliProfile?.shared && <Icon name="check" size={13} />}PC 로그인 공유</button>}
            <button className="primary" disabled={pending || downloading} onClick={() => void act(installed ? "ai-update" : "ai-install", {}, "다운로드 상태를 확인하고 있습니다.")}>{installed ? "업데이트" : "다운로드·설치"}</button>
            <button className="secondary" aria-haspopup="dialog" disabled={pending || !installed || downloading || provider.id === "google" && !provider.cliProfile?.supported && !provider.cliProfile?.shared} onClick={() => setLoginTarget({ id: provider.id, mode: "cli" })}>{provider.id === "deepseek" ? "API 키 연결" : "로그인"}</button>
            {canLogoutCli && <button className="text-button" aria-haspopup="dialog" disabled={pending || !installed || downloading} onClick={() => setLoginTarget({ id: provider.id, mode: "cli", operation: "logout" })}>로그아웃</button>}
            {cli?.source === "managed" && <button className="text-button" disabled={pending || downloading} onClick={() => void act("ai-component-remove", {}, "앱에서 설치한 CLI를 제거했습니다.")}>제거</button>}
            {cli?.previousVersion && <button className="text-button" disabled={pending || downloading} onClick={() => void act("ai-component-rollback", {}, "이전 버전으로 복원했습니다.")}>이전 버전</button>}
          </div>
          {cli?.bytes ? <small>{cli.totalInstalledBytes ? "보관 용량 " + byteSize(cli.totalInstalledBytes) : "현재 버전 용량 " + byteSize(cli.bytes)}</small> : null}
          {provider?.id !== "deepseek" && <><div className="ai-quota-heading"><small>계정 사용 한도</small><button className="text-button" disabled={pending || !installed} onClick={() => void act("ai-quota-refresh")}>한도 조회</button></div><QuotaDisplay quota={provider?.quota} /></>}
        </div> : <div className="ai-key-card"><label>API 키<input aria-label="AI API 키" type="password" disabled={pending} value={key} onChange={e => setKey(e.target.value)} placeholder={provider?.hasKey ? "키 저장됨 · 변경할 때만 입력" : "이 PC에 암호화해 저장할 API 키"} autoComplete="off" maxLength={4096} /></label><small>Windows 보안 저장소에 암호화해 저장합니다.</small><div className="ai-runtime-actions"><button className="secondary" aria-haspopup="dialog" disabled={pending} onClick={() => setLoginTarget({ id: provider.id, mode: "api" })}>API 연결 창 열기</button>{provider.hasKey && <button className="text-button" aria-haspopup="dialog" disabled={pending} onClick={() => setLoginTarget({ id: provider.id, mode: "api", operation: "logout" })}>로그아웃</button>}</div></div>}
        <div className={"ai-settings-model-row" + (mode === "cli" && provider?.id === "deepseek" ? " has-key" : "")}>
          {mode === "cli" && provider?.id === "deepseek" && <label className="ai-deepseek-key">DeepSeek API 키<input aria-label="DeepSeek CLI API 키" type="password" disabled={pending} value={key} onChange={e => setKey(e.target.value)} placeholder={provider.hasKey ? "키 저장됨" : "API 키"} autoComplete="off" maxLength={4096} /></label>}
          <ModelControls provider={provider} mode={mode} model={model} effort={effort} onModel={setModel} onEffort={setEffort} disabled={pending} revision={modelRevision} onRefresh={() => void queryModels()} canRefresh={mode === "api" ? !!(provider?.hasKey || key) : installed && (provider?.id !== "deepseek" || !!(provider?.hasKey || key))} />
        </div>
        <p className="ai-model-caption">CLI 또는 API에서 조회한 모델을 선택합니다. 추론 강도도 이 설정에서 지정합니다.</p>
      </div>
      <div className="ai-settings-footer"><span className="ai-message" role="status" title={message || error || cli?.error}>{message || error || cli?.error || (state.encrypted ? "키와 분석 결과를 이 PC에 암호화해 보관합니다." : "보안 저장소를 확인하고 있습니다.")}</span><div className="ai-runtime-actions"><button className="primary" disabled={pending || !model.trim()} onClick={async () => { if (await act("ai-save", { mode, model: model.trim(), effort, enabled: true, ...(key ? { key } : {}) }, "AI 연결 설정을 저장했습니다.")) setKey(""); }}><Icon name="check" size={15} /> 연결 저장</button></div></div>
      </>}
    </section>}
    {pickerOpen && <AiProviderPicker providers={state.providers} pending={pending} message={message} onAdd={row => void addProvider(row)} onImport={() => void act("ai-provider-import").then(ok => { if (ok) setPickerOpen(false); })} onClose={() => setPickerOpen(false)} />}
    {loginTarget && state.providers.find(row => row.added && row.id === loginTarget.id) && <AiLoginDialog key={loginTarget.id + loginTarget.mode + loginTarget.operation} provider={state.providers.find(row => row.id === loginTarget.id)!} mode={loginTarget.mode} operation={loginTarget.operation} onLoggedOut={() => { setModel(""); setEffort("default"); setKey(""); void refresh(); }} onClose={() => { setLoginTarget(null); void refresh(); }} onUpdate={() => { setLoginTarget(null); setManageComponents(true); void act("ai-adapter-update", {}, "연결 모듈을 업데이트했습니다."); }} onModels={(models, currentModelId) => {
      setModel(previous => models.some(row => row.id === previous) ? previous : models.some(row => row.id === currentModelId) ? currentModelId! : models[0].id);
      setEffort("default"); setModelRevision(value => value + 1); setKey("");
      setMessage("사용 가능한 모델 " + models.length + "개를 조회했습니다. 모델과 추론 강도를 선택하고 연결을 저장하세요."); void refresh();
    }} />}
  </div>;
}
