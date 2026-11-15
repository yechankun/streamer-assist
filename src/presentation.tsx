import { useEffect, useRef, useState } from "react";
import { useActivityClock } from "./activity";
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
    document.visibilityState !== "visible" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
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
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
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
  }, [value]);
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
  counts: number[];
  sources: string[];
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
  const total = counts.reduce((sum, count) => sum + count, 0);
  const highest = Math.max(...counts);
  return (
    <section
      className={
        "broadcast-poll page-body screen-enter" +
        (hidden ? " results-hidden" : "")
      }
      aria-label="방송용 투표 현황"
    >
      <div className="broadcast-toolbar">
        <span className={poll.active ? "stage-status live" : "stage-status"}>
          <i className="dot" />
          {poll.active ? "투표 중" : "투표 종료"}
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
      <div className="stage-participation"><Icon name="message" size={20}/><span className="stage-participation-text">
        {!poll.active?"투표가 종료됐습니다. 아래에서 최종 결과를 확인하세요.":poll.mode==="donation"?<><strong>{poll.chatPrefix}1 ~ {poll.chatPrefix}{poll.options.length}</strong>을 후원 메시지에 입력</>:
          poll.mode==="native"?<>YouTube <strong>기본 투표</strong>에서 선택{sources.some(source=>source.includes("채팅"))&&<> · 다른 플랫폼 채팅은 <strong>{poll.chatPrefix||""}1 ~ {poll.chatPrefix||""}{poll.options.length}</strong></>}</>:<>채팅에 <strong>{poll.chatPrefix||""}1 ~ {poll.chatPrefix||""}{poll.options.length}</strong> 입력</>}
      </span><div className="stage-rule-tags">{poll.donation?<><span>{(poll.donation.minimumMicros/1000000).toLocaleString("ko-KR",{maximumFractionDigits:6})} {poll.donation.currency}{poll.donation.plural?"당 1표":" 이상"}</span><span>{poll.donation.plural?"금액 배수":"1인 1표"}</span>{!!poll.ignoredCurrency&&<span>다른 통화 {poll.ignoredCurrency}건 제외</span>}</>:<span>1인 1표 · 선택 변경 가능</span>}</div></div>
      <div className="broadcast-stats">
        <div>
          <span>총 투표수</span>
          <strong>
            {hidden ? (
              "집계 중"
            ) : (
              <>
                <AnimatedNumber value={total} />
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
        {poll.options.map((option, index) => {
          const percent = total ? (counts[index] / total) * 100 : 0;
          const winner = !poll.active && total > 0 && counts[index] === highest;
          return (
            <div
              className={"broadcast-row" + (winner && !hidden ? " winner" : "")}
              key={index}
              style={{ "--row-index": index } as React.CSSProperties}
            >
              <div className="broadcast-option">
                <span>
                  {poll.mode === "donation" ||
                  sources.some((source) => source.includes("채팅"))
                    ? (poll.chatPrefix ?? "") + (index + 1)
                    : "OPTION " + (index + 1)}
                </span>
                <h3 title={option}>{option}</h3>
                {winner && !hidden && (
                  <small>
                    <Icon name="check" size={13} /> 가장 많은 선택
                  </small>
                )}
              </div>
              <div
                className="broadcast-track"
                role="meter"
                aria-label={option + " 득표율"}
                aria-valuenow={hidden ? undefined : Math.round(percent)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="broadcast-fill"
                  style={{ width: (hidden ? 0 : percent) + "%" }}
                />
                <div className="broadcast-tally">
                  {hidden ? (
                    <span>결과를 가렸습니다</span>
                  ) : (
                    <>
                      <b>
                        <AnimatedNumber value={counts[index]} suffix="표" />
                      </b>
                      <span>{percent.toFixed(1)}%</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {nativePending && (
        <p className="stage-hint">
          YouTube 기본 투표의 득표수를 기다리고 있습니다.
        </p>
      )}
      <div className="broadcast-controls">
        <button className="secondary" disabled={busy} onClick={onCopy}>
          <Icon name="message" size={17} /> 참여 안내 복사
        </button>
        {poll.active ? (
          <button
            className="primary stage-primary"
            disabled={busy}
            onClick={onStop}
          >
            <Icon name="stop" size={18} /> 투표 종료
          </button>
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
