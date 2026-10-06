import { useEffect, useRef } from "react";
import { Icon } from "./icons";
import type { AiProvider } from "./ai-types";

const connectionNames: Record<string, string> = {
  openai: "Codex · OpenAI API", anthropic: "Claude · Claude API", xai: "Grok · xAI API",
  google: "Antigravity · Gemini API", deepseek: "Codex 연결 · DeepSeek API", moonshot: "Kimi · Moonshot API",
};

export function AiProviderPicker({ providers, pending, message, onAdd, onImport, onClose }: {
  providers: AiProvider[]; pending: boolean; message: string;
  onAdd: (provider: AiProvider) => void; onImport: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  const available = providers.filter(row => !row.added && !row.custom);
  return <dialog ref={dialog} className="panel ai-provider-picker" aria-label="AI 연결 추가 선택" onCancel={onClose}>
    <div className="panel-heading"><h2>AI 추가</h2><button className="text-button" aria-label="AI 추가 선택 닫기" onClick={onClose}><Icon name="close" size={17} /></button></div>
    <p className="ai-picker-description">사용할 AI를 선택하세요. 연결 모듈을 준비한 뒤 로그인과 모델을 설정할 수 있습니다.</p>
    <div className="ai-picker-grid">{available.map(row => <button key={row.id} className="ai-picker-item" disabled={pending} aria-label={row.name + " 추가"} onClick={() => onAdd(row)}>
      <span className="ai-provider-monogram">{row.name.slice(0, 1)}</span><span><strong>{row.name}</strong><small>{connectionNames[row.id] || "API 연결"}</small></span><Icon name="plus" size={16} />
    </button>)}</div>
    {!available.length && <p className="ai-picker-description">사용 가능한 AI를 모두 추가했습니다.</p>}
    {message && <p className="ai-picker-message" role="status">{message}</p>}
    <div className="ai-picker-footer"><small>추가한 AI만 연결 목록에 표시됩니다.</small><button className="text-button" disabled={pending} onClick={onImport}>호환 API 파일 가져오기</button></div>
  </dialog>;
}
