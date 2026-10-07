import { Icon } from "./icons";
import { byteSize } from "./ai-common";
import type { AiComponent } from "./ai-types";
export function AiComponentPanel({ name, component, pending, message, onAction, onConfigure }: {
  name: string; component?: AiComponent; pending: boolean; message?: string;
  onAction: (action: string, success?: string) => void; onConfigure: () => void;
}) {
  const installed = !!component?.version;
  const downloading = ["checking", "installing", "downloading", "updating", "removing", "rolling-back"].includes(component?.status || "");
  const checking = component?.updateCheckStatus === "checking";
  const updateAvailable = component?.updateCheckStatus === "checked" && component.updateAvailable === true && !!component.latestVersion;
  return <section className="ai-component-panel" aria-label="AI 연결 모듈 관리">
    <div className="ai-component-intro"><span className="ai-component-symbol"><Icon name="link" size={30} /></span><div><h3>{name} 연결 모듈</h3></div></div>
    <div className="ai-component-versions"><div><span>설치된 버전</span><strong>{component?.version ? "v" + component.version : "설치 전"}</strong></div><div><span>최신 버전</span><strong>{component?.latestVersion ? "v" + component.latestVersion : "조회 필요"}</strong></div><div><span>보관 용량</span><strong>{component?.totalInstalledBytes || component?.bytes ? byteSize(component.totalInstalledBytes || component.bytes || 0) : "—"}</strong></div></div>
    <details className="ai-component-distribution"><summary>배포 정보</summary><div className="ai-component-source"><span>GitHub 저장소</span><strong>{component?.repository || "yechankun/streamer-assist-ai-connectors"}</strong></div><p>CLI 설치와 계정 연결은 연결 설정에서 관리합니다.</p></details>
    {downloading && <div className="ai-component-progress"><progress aria-label="연결 모듈 다운로드 진행률" max="1" value={component?.progress || 0} /><span>연결 모듈을 준비하고 있습니다.</span></div>}
    <div className="ai-component-buttons"><button className="secondary" disabled={pending || downloading || checking} onClick={() => onAction("ai-adapter-check", "GitHub의 최신 버전을 확인했습니다.")}>{checking ? "버전 확인 중…" : "버전 확인"}</button><button className="primary" aria-label="AI 연결 모듈 업데이트" disabled={pending || downloading || installed && !updateAvailable} onClick={() => onAction(installed ? "ai-adapter-update" : "ai-adapter-install", "GitHub 연결 모듈을 준비했습니다.")}><Icon name="link" size={14} />{!installed ? "다운로드·추가" : checking ? "확인 중…" : updateAvailable ? "업데이트" : component?.updateCheckStatus === "failed" ? "버전 확인 실패" : component?.updateCheckStatus === "checked" && component.latestVersion ? "최신 버전" : "업데이트 확인 필요"}</button>{installed && <button className="secondary" disabled={pending || downloading} onClick={onConfigure}>연결 설정</button>}</div>
    <div className="ai-component-secondary">{component?.previousVersion && <button className="text-button" disabled={pending || downloading} onClick={() => onAction("ai-adapter-rollback", "이전 연결 모듈로 복원했습니다.")}>이전 버전 v{component.previousVersion} 복원</button>}{installed && <button className="text-button" disabled={pending || downloading} onClick={() => onAction("ai-adapter-remove", "연결 모듈을 제거했습니다.")}>연결 모듈 제거</button>}</div>
    {(component?.error || component?.updateCheckError || message) && <p className="ai-component-message" role="status" title={component?.error || component?.updateCheckError || message}>{component?.error || component?.updateCheckError || message}</p>}
  </section>;
}
