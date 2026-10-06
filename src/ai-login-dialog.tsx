import { useEffect, useRef, useState } from "react";
import { aiCall } from "./ai-common";
import { Icon } from "./icons";
import type { AiLogin, AiMode, AiProvider } from "./ai-types";

const active = (status?: string) => ["starting", "waiting", "verifying"].includes(status || "");
const labels: Record<AiLogin["status"], string> = {
  idle: "로그인 준비", starting: "로그인을 준비하고 있습니다", waiting: "계정 인증을 기다리고 있습니다",
  verifying: "연결 상태를 확인하고 있습니다", succeeded: "로그인이 완료되었습니다",
  failed: "로그인을 완료하지 못했습니다", canceled: "로그인을 취소했습니다",
};

export function AiLoginDialog({ provider, mode, onClose, onModels, onUpdate }: {
  provider: AiProvider; mode: AiMode; onClose: () => void;
  onModels: (models: { id: string }[], currentModelId?: string) => void;
  onUpdate: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const started = useRef(false);
  const [login, setLogin] = useState<AiLogin>(provider.login || { supported: false, status: "idle" });
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [keyVerified, setKeyVerified] = useState(false);
  const [modelCount, setModelCount] = useState(0);
  const keyMode = mode === "api" || provider.id === "deepseek" || login.kind === "api-key";
  useEffect(() => {
    if (provider.login) setLogin(current => ({ ...current, supported: provider.login!.supported, kind: provider.login!.kind, instructions: provider.login!.instructions, keyUrl: provider.login!.keyUrl }));
  }, [provider.login?.supported, provider.login?.kind, provider.login?.instructions, provider.login?.keyUrl]);

  const perform = async (action: string) => {
    setPending(true); setError("");
    try {
      const result = await aiCall<AiLogin>(action, { providerId: provider.id, mode });
      if (alive.current && result && typeof result.status === "string") setLogin(result);
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setPending(false); }
  };
  useEffect(() => {
    alive.current = true;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!keyMode && !started.current) { started.current = true; void perform("ai-login"); }
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (keyMode) return;
    let polling = false;
    const poll = async () => {
      if (polling || !alive.current) return;
      polling = true;
      try { const state = await aiCall<AiLogin>("ai-login-status", { providerId: provider.id }); if (alive.current) setLogin(state); }
      catch (e) { if (alive.current) setError((e as Error).message); }
      finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), 1000);
    return () => clearInterval(timer);
  }, [keyMode, provider.id]);
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
    setPending(true); setError("");
    try {
      if (saveKey && key) { await aiCall("ai-key-save", { providerId: provider.id, key }); setKey(""); }
      const result = await aiCall<{ models: { id: string }[]; currentModelId?: string }>("ai-models", { providerId: provider.id, mode });
      if (!result.models.length) throw new Error("사용 가능한 모델을 확인하지 못했습니다. 계정 권한을 확인하세요.");
      if (alive.current) {
        onModels(result.models, result.currentModelId);
        if (keyMode) { setKeyVerified(true); setModelCount(result.models.length); }
        else {
          if (login.kind === "terminal" && active(login.status)) await aiCall("ai-login-cancel", { providerId: provider.id });
          onClose();
        }
      }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setPending(false); }
  };
  const terminal = login.kind === "terminal";
  const succeeded = keyMode ? keyVerified : login.status === "succeeded";
  return <dialog ref={dialog} className="panel ai-login-dialog" aria-label={provider.name + (keyMode ? " API 연결" : " 로그인")} onCancel={event => { event.preventDefault(); void close(); }}>
    <div className="panel-heading"><div><span className="eyebrow">{keyMode ? "API CONNECTION" : "ACCOUNT CONNECTION"}</span><h2>{provider.name} {keyMode ? "API 연결" : "로그인"}</h2></div><button className="text-button" disabled={pending} aria-label="AI 로그인 창 닫기" onClick={() => void close()}><Icon name="close" size={18} /></button></div>
    <div className={"ai-login-identity" + (succeeded ? " complete" : "")}><span className="ai-provider-monogram">{provider.name.slice(0, 1)}</span><div><strong>{keyMode ? provider.apiName || provider.name + " API" : provider.cli?.id || provider.name}</strong><small>{keyMode ? "API 키로 연결" : terminal ? "공식 CLI의 인증 창으로 연결" : "공식 계정으로 연결"}</small></div>{succeeded && <Icon name="check" size={20} />}</div>
    {keyMode ? <>
      <p className="ai-login-description">공식 콘솔에서 계정에 로그인하고 API 키를 발급하세요. CLI 구독과 API 사용 권한은 별도로 관리됩니다.</p>
      {login.keyUrl && <button className="secondary ai-login-browser" disabled={pending} onClick={() => void perform("ai-login-open-browser")}><Icon name="link" size={16} /> 공식 콘솔 열기</button>}
      <label className="ai-login-key">API 키<input type="password" aria-label="로그인 창 API 키" value={key} disabled={pending} onChange={event => { setKey(event.target.value); setKeyVerified(false); }} placeholder={provider.hasKey ? "키 저장됨 · 변경할 때만 입력" : "발급한 API 키를 붙여넣으세요"} maxLength={4096} autoComplete="off" spellCheck={false} /></label>
      <small className="ai-login-description">Windows 보안 저장소에 암호화해 저장합니다. 모델 목록을 조회해 연결을 확인합니다.</small>
      {keyVerified && <p className="ai-login-status complete" role="status"><Icon name="check" size={17} /> 연결 확인됨 · 사용 가능한 모델 {modelCount}개</p>}
    </> : <>
      <p className="ai-login-description">{login.instructions || "공식 로그인 페이지에서 인증을 완료하세요. 인증 결과는 이 창에 표시됩니다."}</p>
      <div className={"ai-login-status " + login.status} role="status"><span className={active(login.status) ? "ai-login-spinner" : ""}>{!active(login.status) && <Icon name={succeeded ? "check" : "info"} size={18} />}</span><div><strong>{labels[login.status] || labels.idle}</strong><small>{login.message || (active(login.status) ? "로그인 페이지가 열리면 계정 인증을 진행하세요." : "")}</small></div></div>
      {login.code && <div className="ai-login-code"><small>일회용 인증 코드</small><code>{login.code}</code><span>공식 로그인 페이지에 이 코드를 입력하세요.</span></div>}
      {login.url && <button className="primary ai-login-browser" disabled={pending} onClick={() => void perform("ai-login-open-browser")}><Icon name="link" size={16} /> 로그인 페이지 열기</button>}
    </>}
    {(error || login.error) && <p className="ai-login-error" role="alert">{error || login.error}</p>}
    <div className="ai-login-footer"><button className="secondary" disabled={pending} onClick={() => void close()}>{!keyMode && active(login.status) ? "로그인 취소" : "닫기"}</button>
      {keyMode ? <button className="primary" disabled={pending || (!key.trim() && !provider.hasKey)} onClick={() => void queryModels(true)}>{pending ? "연결 확인 중…" : keyVerified ? "연결 다시 확인" : "저장하고 연결 확인"}</button>
      : succeeded || terminal ? <button className="primary" disabled={pending} onClick={() => void queryModels(false)}>{succeeded ? "모델 조회하고 계속" : "로그인 후 모델 조회"}</button>
      : !login.supported ? <button className="primary" disabled={pending} onClick={onUpdate}>연결 모듈 업데이트</button>
      : !active(login.status) && <button className="primary" disabled={pending} onClick={() => void perform("ai-login")}>다시 로그인</button>}
    </div>
  </dialog>;
}
