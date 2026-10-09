import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import policy from "../resources/privacy.json";
export function InformationSettings({
  appVersion,
  encrypted,
  canClearHistory,
  rouletteSpinning,
  busy,
  onClearHistory,
  onResetRoulette,
  onOpenPrivacy,
  onOpenPolicyLink,
  onSupport,
}: {
  appVersion: string;
  encrypted: boolean;
  canClearHistory: boolean;
  rouletteSpinning: boolean;
  busy: boolean;
  onClearHistory: () => Promise<boolean>;
  onResetRoulette: () => void;
  onOpenPrivacy: () => void;
  onOpenPolicyLink: (url: string) => void;
  onSupport: () => void;
}) {
  const [dialog, setDialog] = useState<
    "privacy" | "history" | "roulette" | null
  >(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!dialog) return;
    returnFocus.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();
    return () => returnFocus.current?.focus();
  }, [dialog]);
  async function confirm() {
    if (pending || busy) return;
    setPending(true);
    try {
      if (dialog === "history") {
        if (await onClearHistory()) setDialog(null);
      } else if (dialog === "roulette") {
        onResetRoulette();
        setDialog(null);
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <div
      className="information-settings"
      id="settings-info"
      role="tabpanel"
      aria-label="정보·데이터 설정"
    >
      <div className="information-app-info"><span><Icon name="activity" size={17} /> Streamer Assist</span><span>v{appVersion}</span></div>
      <section className="panel privacy-card">
        <div className="panel-heading">
          <h2>
            <Icon name="info" size={18} /> 개인정보 안내
          </h2>
          <span className="tag">{policy.version}</span>
        </div>
        <p>
          이 PC에 보관하는 정보와 플랫폼 전송·삭제 안내입니다.
        </p>
        <div className="information-actions">
          <button className="secondary" onClick={() => setDialog("privacy")}>
            방침 읽기
          </button>
          <button className="text-button" onClick={onOpenPrivacy}>
            <Icon name="link" size={15} /> 공개 문서
          </button>
          <button className="text-button" onClick={() => onOpenPolicyLink("https://streamer-assist.foreground.day/terms.html")}>이용약관</button>
        </div>
      </section>
      <section className="panel data-card">
        <div className="panel-heading">
          <h2>
            <Icon name="bookmark" size={18} /> 저장 데이터 관리
          </h2>
          <span className={encrypted ? "tag auto" : "tag"}>
            {encrypted ? "Windows 암호화" : "보안 저장소 확인 필요"}
          </span>
        </div>
        {!canClearHistory && <p role="status">기록·참여 도구를 종료하면 삭제할 수 있습니다.</p>}
        {rouletteSpinning && <p role="status">룰렛 회전이 끝나면 목록을 초기화할 수 있습니다.</p>}
        <div className="information-actions">
          <button
            className="secondary danger-action"
            disabled={busy || !canClearHistory}
            onClick={() => setDialog("history")}
          >
            방송·참여 기록 삭제
          </button>
          <button
            className="secondary"
            disabled={busy || rouletteSpinning}
            onClick={() => setDialog("roulette")}
          >
            룰렛 목록 초기화
          </button>
        </div>
      </section>
      <section className="panel review-guide">
        <div className="panel-heading">
          <h2>
            <Icon name="play" size={18} /> 방송 없이 기능 체험
          </h2>
          <button className="text-button" onClick={onSupport}>
            <Icon name="message" size={15} /> 문의
          </button>
        </div>
        <details className="review-details"><summary>체험 방법</summary>
        <ol>
          <li>
            <b>방송 타임라인</b>에서 기록을 시작합니다.
          </li>
          <li>
            <b>설정 → 일반 → 테스트 채팅</b>을 켭니다.
          </li>
          <li>
            시청자 추첨·숫자 투표·도네 투표를 실행하면 모의 참여와 후원이
            들어옵니다. 룰렛은 항목을 추가해 바로 실행할 수 있습니다.
          </li>
        </ol>
        <p>
          계정 연결과 별도로 체험할 수 있습니다. 실제 채팅·후원 집계에는 연결한
          플랫폼의 방송이 켜져 있어야 합니다.
        </p>
        </details>
      </section>
      {dialog && (
        <div
          className="information-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending && !busy)
              setDialog(null);
          }}
        >
          <div
            className="information-dialog"
            role={dialog === "privacy" ? "dialog" : "alertdialog"}
            aria-modal="true"
            aria-labelledby="information-dialog-title"
            tabIndex={-1}
            ref={dialogRef}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !pending && !busy) {
                e.preventDefault();
                setDialog(null);
              }
              if (e.key === "Tab") {
                const controls = [
                  ...(dialogRef.current?.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ) || []),
                ];
                if (!controls.length) {
                  e.preventDefault();
                  return;
                }
                const first = controls[0],
                  last = controls[controls.length - 1];
                if (
                  e.shiftKey &&
                  (document.activeElement === first ||
                    document.activeElement === dialogRef.current)
                ) {
                  e.preventDefault();
                  last.focus();
                } else if (
                  !e.shiftKey &&
                  (document.activeElement === last ||
                    document.activeElement === dialogRef.current)
                ) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="information-dialog-heading">
              <h2 id="information-dialog-title">
                {dialog === "privacy"
                  ? policy.title
                  : dialog === "history"
                    ? "방송·참여 기록을 삭제할까요?"
                    : "룰렛 목록을 초기화할까요?"}
              </h2>
              <button
                className="icon-button"
                aria-label="안내 닫기"
                disabled={pending || busy}
                onClick={() => setDialog(null)}
              >
                <Icon name="close" size={17} />
              </button>
            </div>
            {dialog === "privacy" ? (
              <div className="privacy-document">
                <p>
                  적용일 {policy.version} · {policy.operator}
                </p>
                {policy.sections.map((section) => (
                  <section key={section.title}>
                    <h3>{section.title}</h3>
                    {section.paragraphs.map((p, index) => (
                      <p key={index}>{p}</p>
                    ))}
                    {"links" in section && <div className="privacy-policy-links">{(section.links || []).map(link => <button key={link.url} className="text-button" onClick={() => onOpenPolicyLink(link.url)}>{link.label}</button>)}</div>}
                  </section>
                ))}
              </div>
            ) : (
              <p className="data-confirm-description">
                {dialog === "history"
                  ? "저장된 방송·마커·모집 참여자·당첨 내역·숫자 투표·도네 투표 기록과 암호화 복구 백업을 이 PC에서 삭제합니다. 플랫폼 연결과 앱 설정은 유지합니다. 내보낸 파일은 별도로 관리하세요."
                  : "이 PC에 저장한 룰렛 제목·항목·가중치를 비웁니다. 방송과 투표 기록은 유지합니다."}
              </p>
            )}
            <div className="information-dialog-actions">
              {dialog === "privacy" ? (
                <button className="primary" onClick={() => setDialog(null)}>
                  확인
                </button>
              ) : (
                <>
                  <button
                    className="secondary"
                    disabled={pending || busy}
                    onClick={() => setDialog(null)}
                  >
                    취소
                  </button>
                  <button
                    className="danger-action secondary"
                    disabled={pending || busy}
                    onClick={() => void confirm()}
                  >
                    {pending
                      ? "처리 중…"
                      : dialog === "history"
                        ? "기록 삭제"
                        : "목록 초기화"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
