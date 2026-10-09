import { useEffect, useRef, useState } from "react";
import terms from "../resources/terms.json";
import privacy from "../resources/privacy.json";
import "./youtube-consent.css";
type Preview = { version: string; before: number; chats: number; donations: number; participants: number; viewerSamples: number; affectedSessions: number; aiResults: number; includesRecoveryRecords: boolean };
export type YoutubeAcceptance = { version: string; terms: boolean; privacy: boolean; retention: boolean };
export function YoutubeConsentDialog({ onClose, onAccept, onOpenLink, resume }: {
  onClose: () => void; onAccept: (value: YoutubeAcceptance) => Promise<boolean>; onOpenLink: (url: string) => void; resume: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview>();
  const [agreedTerms, setTerms] = useState(false), [agreedPrivacy, setPrivacy] = useState(false), [agreedRetention, setRetention] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); return () => { dialog.current?.close(); }; }, []);
  useEffect(() => {
    let active = true;
    void window.assist?.call("youtube-consent-preview").then(result => {
      if (!active) return;
      if (!result.ok) setError(result.error || "기록 보관 정보를 확인하지 못했습니다.");
      else setPreview(result.data as Preview);
    }).catch(() => { if (active) setError("기록 보관 정보를 확인하지 못했습니다. 잠시 후 다시 열어 주세요."); });
    return () => { active = false; };
  }, []);
  async function accept() {
    if (!preview || !agreedTerms || !agreedPrivacy || !agreedRetention || pending) return;
    setPending(true); setError("");
    try { if (!(await onAccept({ version: preview.version, terms: true, privacy: true, retention: true }))) setError("동의를 적용하지 못했습니다. 잠시 후 재시도하세요."); }
    catch (error) { setError(error instanceof Error ? error.message : "동의를 적용하지 못했습니다."); }
    finally { setPending(false); }
  }
  const document = (policy: typeof terms | typeof privacy) => <details className="youtube-policy-document">
    <summary>{policy.title} 전문 · {policy.version}</summary>
    <div>{policy.sections.map(section => <section key={section.title}><h4>{section.title}</h4>{section.paragraphs.map((text, index) => <p key={index}>{text}</p>)}
      {"links" in section && section.links?.map(link => <button type="button" className="text-button" key={link.url} onClick={() => onOpenLink(link.url)}>{link.label}</button>)}
    </section>)}</div>
  </details>;
  return <dialog ref={dialog} className="youtube-consent-dialog" aria-labelledby="youtube-consent-title" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <div className="youtube-consent-heading"><h2 id="youtube-consent-title">YouTube 연결 전 확인</h2><button type="button" className="text-button" aria-label="동의 안내 닫기" disabled={pending} onClick={onClose}>닫기</button></div>
    <div className="youtube-consent-body">
      <p>본인 방송 채널의 정보·활성 방송·실시간 채팅·지원되는 슈퍼챗을 받아 기록과 시청자 참여에 사용합니다. 기본 실시간 투표는 사용자가 실행할 때 YouTube에 생성·종료합니다.</p>
      <p>연결 토큰과 원본 기록은 이 PC에 암호화합니다. Google 비밀번호는 앱에 입력하지 않습니다. Google 권한 승인은 다음 단계에서 기본 브라우저로 진행합니다.</p>
      <div className="youtube-policy-links">
        {[{ label: "앱 이용약관", url: terms.url }, { label: "개인정보처리방침", url: privacy.url }, { label: "YouTube 서비스 약관", url: "https://www.youtube.com/t/terms" }, { label: "Google 개인정보처리방침", url: "https://policies.google.com/privacy" }].map(link => <button type="button" className="text-button" key={link.url} onClick={() => onOpenLink(link.url)}>{link.label}</button>)}
      </div>
      {document(terms)}{document(privacy)}
      <section className="youtube-retention-preview" aria-live="polite"><h3>기록 보관과 기존 데이터</h3>
        <p>YouTube 원본·식별 정보·방송 정보는 방송별 최초 수집일부터 최대 30일간 보관합니다. 앱 실행 중 정리하며 장기간 종료한 뒤에는 사용 전에 만료 여부를 확인합니다.</p>
        {preview ? <p><strong>현재 삭제 대상: {preview.affectedSessions.toLocaleString()}개 방송 · 채팅 {preview.chats.toLocaleString()}건 · 후원 {preview.donations.toLocaleString()}건</strong><br />참여자 {preview.participants.toLocaleString()}명 · 시청자 표본 {preview.viewerSamples.toLocaleString()}개 · 관련 AI 결과 {preview.aiResults.toLocaleString()}개{preview.includesRecoveryRecords ? " · 복구 기록 포함" : ""}</p> : <p>이전 기록의 삭제 대상을 확인하고 있습니다…</p>}
        <p>30일이 지난 YouTube 데이터와 분리할 수 없는 합산 분석·참여 결과를 정리합니다. 이전 YouTube 웹 다시보기 수집 기록과 세션 정보를 확인할 수 없는 복구 기록도 위 범위에 포함합니다. 다른 플랫폼 원본과 직접 작성한 마커는 유지합니다. 내보낸 파일·외부 AI 서비스·CLI 자체 기록은 사용자가 별도로 관리합니다. 삭제는 되돌릴 수 없습니다.</p>
      </section>
      <div className="youtube-consent-checks">
        <label><input type="checkbox" checked={agreedTerms} disabled={pending} onChange={event => setTerms(event.target.checked)} />앱 이용약관과 YouTube 서비스 약관에 동의합니다.</label>
        <label><input type="checkbox" checked={agreedPrivacy} disabled={pending} onChange={event => setPrivacy(event.target.checked)} />개인정보처리방침과 데이터 사용 내용을 확인하고 동의합니다.</label>
        <label><input type="checkbox" checked={agreedRetention} disabled={pending || !preview} onChange={event => setRetention(event.target.checked)} />30일 보관 정책과 위 삭제 범위를 확인했으며, 기존 YouTube 기록에도 적용하는 데 동의합니다.</label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <div className="youtube-consent-actions"><button type="button" className="secondary" disabled={pending} onClick={onClose}>취소</button><button type="button" className="primary" disabled={pending || !preview || !agreedTerms || !agreedPrivacy || !agreedRetention} onClick={() => void accept()}>{pending ? "정책 적용 중…" : resume ? "동의하고 연결 재개" : "동의하고 Google 로그인"}</button></div>
  </dialog>;
}
