import { useEffect, useRef, useState } from "react";
import { useActivityClock, usePageActive } from "./activity";
import { flushSync } from "react-dom";
import { Icon } from "./icons";
import { LiveStageTimer } from "./live-stage";

let screenTransition: ViewTransition | null = null;
export function cancelScreenTransition() {
  screenTransition?.skipTransition(); screenTransition = null;
}

export function changeScreen(update: () => void) {
  if (
    !document.startViewTransition ||
    document.querySelector("dialog[open]") ||
    document.visibilityState !== "visible"
  ) {
    update();
    return;
  }
  const transition = document.startViewTransition(() => flushSync(update));
  screenTransition = transition;
  const clear = () => { if (screenTransition === transition) screenTransition = null; };
  void transition.finished.then(clear, clear);
  void transition.ready.catch(() => {});
}
export function AnimatedNumber({
  value,
  suffix = "",
}: {
  value: number;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  const active = usePageActive();
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (!active || from === value) { setDisplay(value); return; }
    let frame: number;
    const started = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / 550);
      setDisplay(
        Math.round(from + (value - from) * (1 - Math.pow(1 - progress, 3))),
      );
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value, active]);
  return (
    <span className="animated-number">
      {display.toLocaleString()}
      {suffix}
    </span>
  );
}
type LivePoll = {
  id: string;
  question: string;
  options: string[];
  active: boolean;
  openedAt?: number;
  closedAt?: number;
  endsAt?: number | null;
  mode: string;
  chatPrefix?: string;
  donation?:{currency:string;minimumMicros:number;plural:boolean};
  ignoredCurrency?:number;
};
export function PollPresentation({
  poll,
  counts,
  sources,
  hasChatCommands,
  busy,
  nativePending,
  canRoulette,
  onCopy,
  onStop,
  onSetup,
  onNew,
  onRoulette,
}: {
  poll: LivePoll;
  counts: number[] | null;
  sources: string[];
  hasChatCommands: boolean;
  busy: boolean;
  nativePending: boolean;
  canRoulette: boolean;
  onCopy: () => void;
  onStop: () => void;
  onSetup: () => void;
  onNew: () => void;
  onRoulette: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const now = useActivityClock(poll.active, poll.active ? poll.endsAt ?? undefined : undefined);
  useEffect(() => {
    setHidden(false);
  }, [poll.id]);
  const total = counts?.reduce((sum, count) => sum + count, 0) ?? 0;
  const ranked = !poll.active && !nativePending && !hidden && total > 0;
  const rows = poll.options.map((option, index) => ({ option, index, count: counts?.[index] ?? 0 }));
  if (ranked) rows.sort((a, b) => b.count - a.count);
  const donation = poll.donation;
  const amount = donation && (donation.minimumMicros / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 6 });
  const price = donation && (donation.currency === "KRW" ? amount + "원" : amount + " " + donation.currency);
  const showPercent = !hidden && !nativePending;
  return (
    <section
      className={
        "broadcast-poll page-body screen-enter" +
        (hidden ? " results-hidden" : "")
      }
      data-ended={!poll.active}
      aria-label="방송용 투표 현황"
    >
      <div className="broadcast-toolbar">
        <span className={poll.active ? "stage-status live" : "stage-status"}>
          <i className="dot" />
          {poll.active ? "투표 중" : nativePending || hidden ? "투표 종료" : "최종 결과"}
        </span>
        <div className="stage-sources">
          {sources.map((source) => (
            <span key={source}>{source}</span>
          ))}
        </div>
        <button className="text-button" aria-label="투표 설정" onClick={onSetup}>
          <Icon name="settings" size={16} /> {poll.active?"실시간 설정":"투표 설정"}
        </button>
      </div>
      <div className="broadcast-title">
        <h2 title={poll.question}>{poll.question}</h2>
      </div>
      {poll.active && <div className="stage-participation" data-open><Icon name="message" size={20}/><span className="stage-participation-text">
        {poll.mode==="donation"?<><strong>{poll.chatPrefix}1 ~ {poll.chatPrefix}{poll.options.length}</strong>을 후원 메시지에 입력{donation && <> · <strong>{price}{donation.plural ? "당 1표" : " 이상 · 1인 1표"}</strong></>}</>:
          poll.mode==="native"?<>YouTube <strong>기본 투표</strong>에서 선택{hasChatCommands&&<> · 다른 플랫폼 채팅은 <strong>{poll.chatPrefix||""}1 ~ {poll.chatPrefix||""}{poll.options.length}</strong></>}</>:<>채팅에 <strong>{poll.chatPrefix||""}1 ~ {poll.chatPrefix||""}{poll.options.length}</strong> 입력</>}
      </span><div className="stage-rule-tags">{donation ? !!poll.ignoredCurrency && <span>다른 통화 {poll.ignoredCurrency}건 제외</span> : <span>1인 1표 · 선택 변경 가능</span>}</div></div>}
      {!poll.active && nativePending && <div className="stage-participation" data-open="false" role="status">
        <Icon name="timeline" size={17}/><span className="stage-participation-text">YouTube 최종 집계를 기다리고 있습니다.</span>
      </div>}
      {!poll.active && donation && !!poll.ignoredCurrency && <small className="stage-hint">다른 통화 {poll.ignoredCurrency}건 제외</small>}
      <div className="broadcast-stats">
        <div>
          <span>{nativePending && counts ? "채팅 집계" : "총 투표수"}</span>
          <strong>
            {hidden ? (
              "비공개"
            ) : !counts ? "집계 대기" : (
              <>
                <AnimatedNumber key={String(nativePending)} value={total} />
                <small>표</small>
              </>
            )}
          </strong>
        </div>
        <LiveStageTimer className="poll-elapsed" openedAt={poll.openedAt} closedAt={poll.closedAt} endsAt={poll.endsAt} active={poll.active} now={now} remainingFirst/>
      </div>
      <div
        className="broadcast-rows"
        style={{ "--row-count": poll.options.length } as React.CSSProperties}
      >
        {rows.map(({ option, index, count }, position) => {
          const rank = ranked ? rows.findIndex(row => row.count === count) + 1 : 0;
          const tied = ranked && (rows[position - 1]?.count === count || rows[position + 1]?.count === count);
          const winner = rank === 1;
          const percent = total ? count / total * 100 : 0;
          return (
            <div
              className={"broadcast-row" + (winner ? " winner" : "")}
              key={index}
              style={{ "--row-index": position } as React.CSSProperties}
            >
              <div className="broadcast-option">
                {poll.active
                  ? <span className={hasChatCommands ? "poll-entry-command" : undefined}>{hasChatCommands ? (poll.chatPrefix ?? "") + (index + 1) : "OPTION " + (index + 1)}</span>
                  : ranked && <span className="poll-rank">{tied ? "공동 " : ""}{rank}위</span>}
                <h3 title={option}>{option}</h3>
              </div>
              <div
                className="broadcast-track"
                role={showPercent ? "meter" : undefined}
                aria-label={showPercent ? option + " 득표율" : undefined}
                aria-valuenow={showPercent ? Math.round(percent) : undefined}
                aria-valuemin={showPercent ? 0 : undefined}
                aria-valuemax={showPercent ? 100 : undefined}
              >
                {!nativePending && <div
                  className="broadcast-fill"
                  style={{ width: (hidden ? 0 : percent) + "%" }}
                />}
                <div className="broadcast-tally">
                  {hidden ? (
                    <span>{poll.active ? "결과를 가렸습니다" : "—"}</span>
                  ) : !counts ? <span>집계 대기</span> : (
                    <>
                      <b>
                        <AnimatedNumber key={String(nativePending)} value={count} suffix="표" />
                      </b>
                      {showPercent && <span>{percent.toFixed(1)}%</span>}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {nativePending && poll.active && (
        <p className="stage-hint">
          YouTube 기본 투표의 득표수를 기다리고 있습니다.
        </p>
      )}
      <div className="broadcast-controls">
        {poll.active && <button className="secondary" disabled={busy} onClick={onCopy}>
          <Icon name="message" size={17} /> 참여 안내 복사
        </button>}
        <div className="poll-primary-controls">
        {poll.active ? (
          <button
            className="primary stage-primary"
            disabled={busy}
            onClick={onStop}
          >
            <Icon name="stop" size={18} /> 투표 종료
          </button>
        ) : !hidden && !nativePending && counts && total === 0 ? (
          <button className="primary stage-primary" onClick={onNew}>새 투표</button>
        ) : (
          <>
            <button
              className="primary stage-primary"
              disabled={!canRoulette || busy}
              onClick={onRoulette}
            >
              <Icon name="roulette" size={18} /> 결과로 룰렛
            </button>
            <button className="secondary" onClick={onNew}>
              새 투표
            </button>
          </>
        )}
        </div>
        <button
          className="text-button hide-results"
          aria-pressed={hidden}
          onClick={() => setHidden(!hidden)}
        >
          <Icon name={hidden ? "eyeOff" : "eye"} size={17} />
          {hidden ? "결과 보기" : "결과 가리기"}
        </button>
      </div>
    </section>
  );
}
