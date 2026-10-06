import { useEffect, useRef, useState } from "react";
import { aiCall } from "./ai-common";
import { Icon } from "./icons";
import type { AiLogin, AiMode, AiProvider } from "./ai-types";

const active = (status?: string) => ["starting", "waiting", "verifying"].includes(status || "");
const loginLabels: Record<AiLogin["status"], string> = {
  idle: "로그인 준비", starting: "로그인을 준비하고 있습니다", waiting: "계정 인증을 기다리고 있습니다",
  verifying: "연결 상태를 확인하고 있습니다", succeeded: "로그인이 완료되었습니다",
  failed: "로그인을 완료하지 못했습니다", canceled: "로그인을 취소했습니다",
};
const logoutLabels: Record<AiLogin["status"], string> = {
  idle: "로그아웃 준비", starting: "로그아웃을 준비하고 있습니다", waiting: "공식 CLI에서 로그아웃을 진행하세요",
  verifying: "로그아웃 상태를 확인하고 있습니다", succeeded: "로그아웃이 완료되었습니다",
  failed: "로그아웃을 완료하지 못했습니다", canceled: "로그아웃을 취소했습니다",
};

export function AiLoginDialog({ provider, mode, operation = "login", onClose, onModels, onUpdate, onLoggedOut }: {
  provider: AiProvider; mode: AiMode; operation?: "login" | "logout";
  onClose: () => void; onModels: (models: { id: string }[], currentModelId?: string) => void;
  onUpdate: () => void; onLoggedOut: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), started = useRef(false), working = useRef(false), notified = useRef(false);
  const loggingOut = operation === "logout";
  const keyMode = mode === "api" || provider.id === "deepseek" || provider.login?.kind === "api-key";
  const [login, setLogin] = useState<AiLogin>({ ...provider.login, supported: provider.login?.supported || false, operation, status: loggingOut || !keyMode ? "starting" : "idle", url: undefined, code: undefined, error: undefined });
  const [key, setKey] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState(""), [keyVerified, setKeyVerified] = useState(false), [modelCount, setModelCount] = useState(0);
  useEffect(() => {
    if (loggingOut && login.operation === "logout" && login.status === "succeeded" && !notified.current) { notified.current = true; onLoggedOut(); }
  }, [loggingOut, login.operation, login.status]);
  const perform = async (action: string) => {
    working.current = true; setPending(true); setError("");
    if (["ai-login", "ai-logout"].includes(action)) setLogin(current => ({ ...current, operation, status: "starting", url: undefined, code: undefined, error: undefined }));
    try {
      const result = await aiCall<AiLogin>(action, { providerId: provider.id, mode });
      if (alive.current && result && typeof result.status === "string") setLogin(result);
    } catch (e) { if (alive.current) { setError((e as Error).message); setLogin(current => ({ ...current, status: "failed" })); } }
    finally { working.current = false; if (alive.current) setPending(false); }
  };
  useEffect(() => {
    alive.current = true;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    if ((loggingOut || !keyMode) && !started.current) { started.current = true; void perform(loggingOut ? "ai-logout" : "ai-login"); }
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (keyMode && !loggingOut) return;
    let polling = false;
    const poll = async () => {
      if (polling || !alive.current || working.current) return;
      polling = true;
      try { const state = await aiCall<AiLogin>("ai-login-status", { providerId: provider.id }); if (alive.current && !working.current) setLogin(state); }
      catch (e) { if (alive.current) setError((e as Error).message); }
      finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), 1000);
    return () => clearInterval(timer);
  }, [keyMode, loggingOut, provider.id]);
  const close = async () => {
    if (pending) return;
    if (!keyMode && active(login.status)) {
      setPending(true);
      try { await aiCall("ai-login-cancel", { providerId: provider.id }); }
      catch (e) { setError((e as Error).message); setPending(false); return; }
    }
    setKey(""); onClose();
  };
  const queryModels = async (saveKey: boolean) => {
    working.current = true; setPending(true); setError("");
    try {
      if (saveKey && key) { await aiCall("ai-key-save", { providerId: provider.id, key }); setKey(""); }
      const result = await aiCall<{ models: { id: string }[]; currentModelId?: string }>("ai-models", { providerId: provider.id, mode });
      if (!result.models.length) throw new Error("사용 가능한 모델을 확인하지 못했습니다. 계정 권한을 확인하세요.");
      if (alive.current) {
        onModels(result.models, result.currentModelId);
        if (keyMode) { setKeyVerified(true); setModelCount(result.models.length); }
        else { if (login.kind === "terminal" && active(login.status)) await aiCall("ai-login-cancel", { providerId: provider.id }); onClose(); }
      }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { working.current = false; if (alive.current) setPending(false); }
  };
  const terminal = loggingOut ? login.logoutKind === "terminal" || login.kind === "terminal" : login.kind === "terminal";
  const succeeded = loggingOut ? login.operation === "logout" && login.status === "succeeded" : keyMode ? keyVerified : login.operation !== "logout" && login.status === "succeeded";
  const title = loggingOut ? "로그아웃" : keyMode ? "API 연결" : "로그인";
  const labels = loggingOut ? logoutLabels : loginLabels;
  const cliNames: Record<string, string> = { codex: "Codex", claude: "Claude Code", grok: "Grok", agy: "Antigravity", kimi: "Kimi Code" };
  return <dialog ref={dialog} className="panel ai-login-dialog" aria-label={provider.name + " " + title} onCancel={event => { event.preventDefault(); void close(); }}>
    <div className="panel-heading"><div><span className="eyebrow">{loggingOut ? "ACCOUNT SIGN OUT" : keyMode ? "API CONNECTION" : "ACCOUNT CONNECTION"}</span><h2>{provider.name} {title}</h2></div><button className="text-button" disabled={pending} aria-label="AI 로그인 창 닫기" onClick={() => void close()}><Icon name="close" size={18} /></button></div>
    <div className={"ai-login-identity" + (succeeded ? " complete" : "")}><span className="ai-provider-monogram">{provider.name.slice(0, 1)}</span><div><strong>{keyMode ? provider.apiName || provider.name + " API" : cliNames[provider.cli?.id || ""] || provider.name}</strong><small>{loggingOut ? keyMode ? "저장된 API 키 해제" : "PC의 CLI 로그인 해제" : keyMode ? "API 키로 연결" : "공식 계정으로 연결"}</small></div>{succeeded && <Icon name="check" size={20} />}</div>
    {keyMode && !loggingOut ? <>
      <p className="ai-login-description">공식 콘솔에서 계정에 로그인하고 API 키를 발급하세요. CLI 구독과 API 사용 권한은 별도로 관리됩니다.</p>
      {login.keyUrl && <button className="secondary ai-login-browser" disabled={pending} onClick={() => void perform("ai-login-open-browser")}><Icon name="link" size={16} /> 공식 콘솔 열기</button>}
      <label className="ai-login-key">API 키<input type="password" aria-label="로그인 창 API 키" value={key} disabled={pending} onChange={event => { setKey(event.target.value); setKeyVerified(false); }} placeholder={provider.hasKey ? "키 저장됨 · 변경할 때만 입력" : "발급한 API 키를 붙여넣으세요"} maxLength={4096} autoComplete="off" spellCheck={false} /></label>
      <small className="ai-login-description">Windows 보안 저장소에 암호화해 저장합니다. 모델 목록을 조회해 연결을 확인합니다.</small>
      {keyVerified && <p className="ai-login-status complete" role="status"><Icon name="check" size={17} /> 연결 확인됨 · 사용 가능한 모델 {modelCount}개</p>}
    </> : <>
      <p className="ai-login-description">{loggingOut ? keyMode ? "이 앱에 저장된 API 키와 모델 연결을 해제합니다." : login.logoutInstructions || "공식 CLI 명령으로 로그인 세션을 해제합니다. 이 PC의 해당 CLI 로그인에도 적용됩니다." : terminal ? "열린 CLI에서 계정을 바꾸려면 /logout을 입력한 뒤 새 계정으로 로그인하세요. 완료 후 모델 목록을 조회해 연결을 확인합니다." : login.instructions || "공식 로그인 페이지에서 계정을 인증하세요. 이 PC의 해당 CLI 로그인도 갱신됩니다."}</p>
      <div className={"ai-login-status " + login.status} role="status"><span className={active(login.status) ? "ai-login-spinner" : ""}>{!active(login.status) && <Icon name={succeeded ? "check" : "info"} size={18} />}</span><div><strong>{labels[login.status] || labels.idle}</strong><small>{login.message}</small></div></div>
      {!loggingOut && login.code && <div className="ai-login-code"><small>일회용 인증 코드</small><code>{login.code}</code><span>공식 로그인 페이지에 이 코드를 입력하세요.</span></div>}
      {!loggingOut && login.url && <button className="primary ai-login-browser" disabled={pending} onClick={() => void perform("ai-login-open-browser")}><Icon name="link" size={16} /> 로그인 페이지 열기</button>}
    </>}
    {(error || login.error) && <p className="ai-login-error" role="alert">{error || login.error}</p>}
    <div className="ai-login-footer"><button className="secondary" disabled={pending} onClick={() => void close()}>{!keyMode && active(login.status) ? "취소" : "닫기"}</button>
      {loggingOut ? !succeeded && (terminal ? <button className="primary" disabled={pending || !login.terminalClosed} onClick={() => void perform("ai-logout-confirm")}>{login.terminalClosed ? "CLI에서 로그아웃 완료했어요" : "CLI에서 /logout 후 창을 닫으세요"}</button> : !active(login.status) && <button className="primary" disabled={pending} onClick={() => void perform("ai-logout")}>로그아웃 재시도</button>)
      : keyMode ? <button className="primary" disabled={pending || (!key.trim() && !provider.hasKey)} onClick={() => void queryModels(true)}>{pending ? "연결 확인 중…" : keyVerified ? "연결 다시 확인" : "저장하고 연결 확인"}</button>
      : succeeded || terminal ? <button className="primary" disabled={pending} onClick={() => void queryModels(false)}>{succeeded ? "모델 조회하고 계속" : "로그인 후 모델 조회"}</button>
      : !login.supported ? <button className="primary" disabled={pending} onClick={onUpdate}>연결 모듈 업데이트</button>
      : !active(login.status) && <button className="primary" disabled={pending} onClick={() => void perform("ai-login")}>다시 로그인</button>}
    </div>
  </dialog>;
}
