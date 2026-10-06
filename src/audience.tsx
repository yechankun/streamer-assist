import { useEffect, useRef, useState } from "react";
import { Icon, PlatformIcon } from "./icons";
import { AnimatedNumber, changeScreen, PollPresentation } from "./presentation";
import type {
  AudiencePlatform,
  DonationPoll,
  Participant,
  RaffleState,
} from "./audience-types";
import type { RouletteItem } from "./roulette";
export const tools = [
  {
    id: "raffle",
    title: "시청자 추첨",
    icon: "viewers" as const,
    description: "채팅 참여자를 추첨해요",
  },
  {
    id: "poll",
    title: "숫자 투표",
    icon: "poll" as const,
    description: "채팅과 실시간 투표",
  },
  {
    id: "donation",
    title: "도네 투표",
    icon: "donation" as const,
    description: "후원 금액으로 모아요",
  },
  {
    id: "roulette",
    title: "룰렛",
    icon: "roulette" as const,
    description: "다음 선택을 돌려요",
  },
];
type HomeProps = {
  onOpen: (id: string) => void;
  onSettings: () => void;
  recording: boolean;
  title: string;
  elapsed: string;
  markers: { label: string; timecode: string; kind: string }[];
  activities: Record<string, { active: boolean; label: string }>;
  demo: boolean;
};
export function ToolsHome({
  onOpen,
  onSettings,
  recording,
  title,
  elapsed,
  markers,
  activities,
  demo,
}: HomeProps) {
  const highlights = markers.filter((marker) => marker.kind === "auto").length;
  return (
    <section
      className="tools-home page-body screen-enter"
      aria-label="방송 워크스페이스"
    >
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">YOUR STREAM, YOUR MOMENTS</span>
          <h1>방송의 흐름을 한눈에.</h1>
          <p>기억할 순간을 남기고, 다음 장면을 함께 정해요.</p>
        </div>
        <span className={"workspace-status" + (recording ? " recording" : "")}>
          <i className={recording ? "dot green" : "dot"} />
          {demo ? "테스트 모드" : recording ? "기록 중" : "방송 준비"}
        </span>
      </header>
      <div className="workspace-grid">
        <article className="workspace-session">
          <div className="workspace-session-heading">
            <span className="workspace-symbol">
              <Icon name="activity" size={22} />
            </span>
            <div>
              <span className="field-caption">내 방송 타임라인</span>
              <h2 title={recording ? title : undefined}>
                {recording ? title : "좋은 순간을 놓치지 않도록"}
              </h2>
            </div>
          </div>
          <div className="workspace-clock">
            <span className="field-caption">
              {recording ? "기록 경과 시간" : "기록 대기"}
            </span>
            <time>{recording ? elapsed : "00:00:00"}</time>
            <span className="workspace-clock-line" aria-hidden="true" />
          </div>
          <div className="workspace-metrics">
            <div>
              <span>기록한 순간</span>
              <strong>
                {markers.length}
                <small>개</small>
              </strong>
            </div>
            <div>
              <span>채팅 하이라이트</span>
              <strong>
                {highlights}
                <small>개</small>
              </strong>
            </div>
          </div>
          <div className="workspace-moments">
            <span className="field-caption">최근 기록</span>
            {markers.length ? (
              markers
                .slice(-2)
                .reverse()
                .map((marker, index) => (
                  <div className="workspace-moment" key={index}>
                    <time>{marker.timecode}</time>
                    <span title={marker.label}>{marker.label}</span>
                  </div>
                ))
            ) : (
              <p>기록을 시작하면 남긴 순간이 이곳에 쌓여요.</p>
            )}
          </div>
          <button
            className="workspace-timeline"
            onClick={() => onOpen("timeline")}
          >
            <Icon name="timeline" size={17} />
            {recording ? "타임라인 이어보기" : "기록 시작하러 가기"}
            <Icon name="arrow" size={17} />
          </button>
        </article>
        <section className="workspace-tools" aria-label="시청자 참여 도구">
          <div className="workspace-tools-heading">
            <div>
              <span className="eyebrow">AUDIENCE TOOLS</span>
              <h2>시청자와 만드는 다음 장면</h2>
            </div>
            <span className="workspace-tool-count">04</span>
          </div>
          <div className="tool-cards">
            {tools.map((tool, index) => (
              <button
                className="tool-card"
                key={tool.id}
                data-tool={tool.id}
                onClick={() => onOpen(tool.id)}
              >
                <span className="tool-number">0{index + 1}</span>
                <span className="tool-symbol">
                  <Icon name={tool.icon} size={25} />
                </span>
                <div className="tool-copy">
                  <h2>{tool.title}</h2>
                  <span>{tool.description}</span>
                </div>
                <span
                  className={
                    "tool-state" +
                    (activities[tool.id]?.active ? " active" : "")
                  }
                >
                  {activities[tool.id]?.active && <i className="dot green" />}
                  {activities[tool.id]?.label || "시작하기"}
                </span>
                <span className="tool-card-arrow">
                  <Icon name="arrow" size={18} />
                </span>
              </button>
            ))}
          </div>
          <div className="workspace-tools-note">
            <Icon name="info" size={15} />
            <span>도구를 시작하면 방송용 현황으로 전환돼요.</span>
          </div>
        </section>
      </div>
      <div className="workspace-bottom">
        <span>
          <Icon name="bookmark" size={14} /> 기록은 이 PC에 보관돼요.
        </span>
        <button className="text-button" onClick={onSettings}>
          <Icon name="link" size={15} /> 플랫폼 연결 관리{" "}
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </section>
  );
}

type ConnectionProps = {
  available: ("chzzk" | "youtube")[];
  connections: Record<"chzzk" | "youtube", string>;
  demo: boolean;
  onSettings: () => void;
};
function PlatformPicker({
  available,
  connections,
  demo,
  onSettings,
  value,
  onChange,
  disabled = false,
}: ConnectionProps & {
  value: AudiencePlatform[];
  onChange: (value: AudiencePlatform[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="audience-platforms">
      <span className="field-caption">참여 플랫폼</span>
      <div className="platform-picker">
        {demo ? (
          <span className="tag">테스트 채팅</span>
        ) : (
          available.map((platform) => (
            <button
              type="button"
              key={platform}
              className={
                "audience-platform " +
                platform +
                (value.includes(platform) ? " selected" : "")
              }
              aria-label={
                (platform === "chzzk" ? "치지직" : "YouTube") + " 참여 플랫폼"
              }
              aria-pressed={value.includes(platform)}
              disabled={disabled}
              title={connections[platform]}
              onClick={() =>
                onChange(
                  value.includes(platform)
                    ? value.filter((p) => p !== platform)
                    : [...value, platform],
                )
              }
            >
              <PlatformIcon platform={platform} size={18} />
              {platform === "chzzk" ? "치지직" : "YouTube"}
              {value.includes(platform) && <Icon name="check" size={13} />}
            </button>
          ))
        )}
        {!demo && !available.length && (
          <button type="button" className="secondary" onClick={onSettings}>
            <Icon name="link" size={15} /> 플랫폼 연결
          </button>
        )}
      </div>
    </div>
  );
}
function useTargets(props: ConnectionProps, value: AudiencePlatform[]) {
  const selected: AudiencePlatform[] = props.demo
    ? ["demo"]
    : value.filter((p) => p !== "demo" && props.available.includes(p));
  return {
    selected,
    ready:
      selected.length > 0 &&
      (props.demo ||
        selected.every(
          (p) => p !== "demo" && props.connections[p] === "연결됨",
        )),
  };
}
async function invoke(action: string, payload: unknown = {}) {
  const reply = await window.assist?.call(action, payload);
  if (!reply?.ok)
    throw new Error(reply?.error || "데스크톱 앱에서 실행하세요.");
  return reply.data;
}
function useActions() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false);
  async function run(action: string, payload?: unknown) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await invoke(action, payload);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "실행하지 못했습니다.");
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
function TimerInput({
  enabled,
  seconds,
  onEnabled,
  onSeconds,
  disabled = false,
}: {
  enabled: boolean;
  seconds: string;
  onEnabled: (value: boolean) => void;
  onSeconds: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="audience-timer">
      <label className="check-label">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onEnabled(e.target.checked)}
        />{" "}
        자동 종료 타이머
      </label>
      {enabled && (
        <label className="timer-seconds">
          <input
            aria-label="자동 종료 시간"
            type="number"
            min={1}
            max={86400}
            value={seconds}
            disabled={disabled}
            onChange={(e) => onSeconds(e.target.value)}
          />
          <span>초</span>
        </label>
      )}
    </div>
  );
}
function timerValid(enabled: boolean, seconds: string) {
  return (
    !enabled ||
    (Number.isInteger(Number(seconds)) &&
      Number(seconds) >= 1 &&
      Number(seconds) <= 86400)
  );
}
function clock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
function ParticipantName({ participant }: { participant: Participant }) {
  return (
    <>
      <span className="participant-platform">
        {participant.platform === "demo" ? (
          <Icon name="message" size={16} />
        ) : (
          <PlatformIcon platform={participant.platform} size={16} />
        )}
      </span>
      <span title={participant.name}>{participant.name}</span>
      {participant.subscriber && <Icon name="sparkles" size={13} />}
    </>
  );
}
export function RafflePage({
  active,
  raffle,
  ...connection
}: ConnectionProps & { active: boolean; raffle: RaffleState | null }) {
  const [view, setView] = useState<"setup" | "stage">("setup");
  const [title, setTitle] = useState(""),
    [entryMode, setEntryMode] = useState<"any" | "keyword">("any"),
    [keyword, setKeyword] = useState("!참여");
  const [subscribersOnly, setSubscribersOnly] = useState(false),
    [excludeWinners, setExcludeWinners] = useState(true);
  const [platforms, setPlatforms] = useState<AudiencePlatform[]>([
    "chzzk",
    "youtube",
  ]);
  const [timerEnabled, setTimerEnabled] = useState(false),
    [seconds, setSeconds] = useState("60");
  const { selected, ready } = useTargets(connection, platforms);
  const { busy, error, setError, run } = useActions();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!raffle) return;
    setTitle(raffle.title);
    setEntryMode(raffle.config.entryMode);
    setKeyword(raffle.config.keyword);
    setSubscribersOnly(raffle.config.subscribersOnly);
    setExcludeWinners(raffle.config.excludeWinners);
    setPlatforms(raffle.config.platforms);
    setTimerEnabled(raffle.config.timerSeconds !== null);
    setSeconds(String(raffle.config.timerSeconds ?? 60));
    const timer = setTimeout(() => changeScreen(() => setView("stage")), 0);
    return () => clearTimeout(timer);
  }, [raffle?.id]);
  useEffect(() => {
    if (!active || !raffle) return;
    setNow(Date.now());
    const timer = setInterval(
      () => setNow(Date.now()),
      raffle.latestDraw && raffle.latestDraw.endsAt > Date.now() ? 80 : 500,
    );
    return () => clearInterval(timer);
  }, [active, raffle?.id, raffle?.latestDraw?.id, raffle?.active]);
  const drawing = !!raffle?.latestDraw && now < raffle.latestDraw.endsAt;
  const result = raffle?.latestDraw;
  const candidates = raffle?.candidates || [];
  const slot = drawing
    ? candidates[
        Math.floor((now - (result?.startedAt ?? now)) / 80) %
          Math.max(1, candidates.length)
      ]
    : result?.winner;
  const canStart =
    ready &&
    timerValid(timerEnabled, seconds) &&
    (entryMode === "any" || !!keyword.trim()) &&
    !busy;
  const frozen = !!raffle?.active;
  async function start() {
    await run("raffle-start", {
      title,
      entryMode,
      keyword,
      subscribersOnly,
      excludeWinners,
      platforms: selected,
      timerSeconds: timerEnabled ? Number(seconds) : null,
    });
  }
  return (
    <section
      hidden={!active}
      className="raffle-page page-body"
      aria-label="시청자 추첨"
    >
      {view === "setup" ? (
        <div className="audience-setup screen-enter">
          <section className="panel audience-editor">
            <div className="panel-heading">
              <h2>
                <Icon name="viewers" size={19} /> 시청자 추첨
              </h2>
              <span className="tag">CHAT RAFFLE</span>
            </div>
            <label>
              추첨 제목
              <input
                aria-label="추첨 제목"
                placeholder="예: 오늘 함께할 시청자를 뽑아요"
                maxLength={100}
                value={title}
                disabled={frozen}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="entry-method">
              <span className="field-caption">참여 방식</span>
              <div className="segmented-buttons">
                <button
                  type="button"
                  className={entryMode === "any" ? "selected" : ""}
                  disabled={frozen}
                  onClick={() => setEntryMode("any")}
                >
                  아무 채팅
                </button>
                <button
                  type="button"
                  className={entryMode === "keyword" ? "selected" : ""}
                  disabled={frozen}
                  onClick={() => setEntryMode("keyword")}
                >
                  참여 키워드
                </button>
              </div>
            </div>
            {entryMode === "keyword" && (
              <input
                aria-label="추첨 참여 키워드"
                maxLength={30}
                placeholder="예: !참여"
                value={keyword}
                disabled={frozen}
                onChange={(e) => setKeyword(e.target.value)}
              />
            )}
            <PlatformPicker
              {...connection}
              value={platforms}
              onChange={setPlatforms}
              disabled={frozen}
            />
            <div className="raffle-filters">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={subscribersOnly}
                  disabled={frozen}
                  onChange={(e) => setSubscribersOnly(e.target.checked)}
                />{" "}
                구독자·멤버십만 참여
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={excludeWinners}
                  disabled={frozen}
                  onChange={(e) => setExcludeWinners(e.target.checked)}
                />{" "}
                이미 뽑힌 참여자 제외
              </label>
            </div>
            <TimerInput
              enabled={timerEnabled}
              seconds={seconds}
              onEnabled={setTimerEnabled}
              onSeconds={setSeconds}
              disabled={frozen}
            />
            <div className="audience-form-bottom">
              <p role="status" className="audience-form-error">
                {error ||
                  (!ready
                    ? "연결된 방송 채팅을 선택하세요."
                    : "같은 플랫폼 계정은 한 번만 참여합니다.")}
              </p>
              <button
                className="primary"
                disabled={frozen ? busy : !canStart}
                onClick={() =>
                  frozen ? changeScreen(() => setView("stage")) : void start()
                }
              >
                <Icon name="play" size={17} />{" "}
                {frozen ? "모집 현황 보기" : "참여자 모집 시작"}
              </button>
              {raffle && !frozen && (
                <button
                  className="secondary"
                  onClick={() => changeScreen(() => setView("stage"))}
                >
                  이전 모집 현황
                </button>
              )}
            </div>
          </section>
          <section className="audience-intro">
            <div className="intro-symbol">
              <Icon name="viewers" size={108} />
            </div>
            <span className="eyebrow">EVERY VIEWER, ONE CHANCE</span>
            <h2>함께할 주인공을 찾아요</h2>
            <p>
              {entryMode === "any"
                ? "모집 중 채팅을 남긴 시청자가 자동으로 참여합니다."
                : "참여 키워드를 입력한 시청자를 모읍니다."}
              <br />
              모집 중에도 추첨하고, 종료 후에도 다시 뽑을 수 있어요.
            </p>
          </section>
        </div>
      ) : (
        raffle && (
          <div
            className="raffle-stage screen-enter"
            aria-label="방송용 시청자 추첨"
          >
            <div className="roulette-stage-heading">
              <div>
                <span
                  className={
                    raffle.active ? "stage-status live" : "stage-status"
                  }
                >
                  {raffle.active ? "LIVE RECRUITMENT" : "RECRUITMENT CLOSED"}
                </span>
                <h2 title={raffle.title}>{raffle.title}</h2>
              </div>
              <button
                className="text-button"
                disabled={drawing}
                onClick={() => changeScreen(() => setView("setup"))}
              >
                <Icon name="settings" size={16} /> 모집 설정
              </button>
            </div>
            <div className="raffle-metrics">
              <div>
                <span>참여자</span>
                <strong>
                  <AnimatedNumber value={raffle.candidateCount} />
                  <small>명</small>
                </strong>
              </div>
              <div>
                <span>추첨 가능한 시청자</span>
                <strong>
                  <AnimatedNumber value={raffle.eligibleCount} />
                  <small>명</small>
                </strong>
              </div>
              <div className="raffle-clock">
                <span>
                  {raffle.active && raffle.endsAt
                    ? "모집 남은 시간"
                    : "모집 경과 시간"}
                </span>
                <time>
                  {clock(
                    raffle.active && raffle.endsAt
                      ? raffle.endsAt - now
                      : (raffle.closedAt ?? now) - raffle.openedAt,
                  )}
                </time>
              </div>
            </div>
            <div className="raffle-stage-main">
              <section
                className={
                  "raffle-pick " +
                  (drawing ? "drawing" : result ? "revealed" : "")
                }
                aria-live="polite"
              >
                <span className="eyebrow">
                  {drawing
                    ? "WHO WILL BE THE WINNER?"
                    : result
                      ? "WINNER"
                      : "READY TO DRAW"}
                </span>
                <div className="raffle-slot">
                  {slot ? (
                    <div
                      key={drawing ? Math.floor(now / 80) : result?.id}
                      className="raffle-slot-name"
                    >
                      <ParticipantName participant={slot} />
                    </div>
                  ) : (
                    <Icon name="viewers" size={88} />
                  )}
                </div>
                <p>
                  {drawing
                    ? "두근두근… 시청자를 뽑고 있어요."
                    : result
                      ? "축하합니다! 오늘의 주인공이에요."
                      : "시청자의 채팅을 기다리고 있습니다."}
                </p>
                <button
                  className="primary raffle-draw"
                  disabled={busy || drawing || raffle.eligibleCount === 0}
                  onClick={() =>
                    void run("raffle-draw", {
                      reducedMotion: matchMedia(
                        "(prefers-reduced-motion: reduce)",
                      ).matches,
                    })
                  }
                >
                  <Icon name="sparkles" size={20} />
                  {drawing ? "추첨 중…" : result ? "다시 추첨하기" : "추첨하기"}
                </button>
                {raffle.draws.filter((d) => d.endsAt <= now).length > 0 && (
                  <div className="raffle-winners">
                    <span>당첨 기록</span>
                    <ol>
                      {raffle.draws
                        .filter((d) => d.endsAt <= now)
                        .slice(-5)
                        .reverse()
                        .map((d) => (
                          <li key={d.id}>
                            <ParticipantName participant={d.winner} />
                          </li>
                        ))}
                    </ol>
                  </div>
                )}
              </section>
              <section className="panel raffle-participants">
                <div className="panel-heading">
                  <h2>최근 참여자</h2>
                  <span className="tag">{candidates.length}명</span>
                </div>
                <ul>
                  {[...candidates].reverse().map((p) => (
                    <li key={p.key}>
                      <ParticipantName participant={p} />
                    </li>
                  ))}
                </ul>
                {!candidates.length && (
                  <p className="audience-empty">
                    {raffle.config.entryMode === "keyword"
                      ? raffle.config.keyword + "를 입력하면 참여할 수 있어요."
                      : "채팅에 아무 말이나 입력하면 참여할 수 있어요."}
                  </p>
                )}
              </section>
            </div>
            {(error || raffle.reason) && (
              <p className="stage-hint" role="status">
                {error || raffle.reason}
              </p>
            )}
            <div className="broadcast-controls">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void run("raffle-copy")}
              >
                <Icon name="message" size={17} /> 참여 안내 복사
              </button>
              {raffle.active ? (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run("raffle-stop")}
                >
                  <Icon name="stop" size={17} /> 모집 종료
                </button>
              ) : (
                <button
                  className="secondary"
                  disabled={drawing}
                  onClick={() =>
                    changeScreen(() => {
                      setTitle("");
                      setError("");
                      setView("setup");
                    })
                  }
                >
                  참여자 다시 모집
                </button>
              )}
              <span className="raffle-rule">
                {raffle.config.subscribersOnly ? "구독자·멤버십 전용 · " : ""}
                {raffle.config.excludeWinners
                  ? "이전 당첨자 제외"
                  : "이전 당첨자 포함"}
              </span>
            </div>
          </div>
        )
      )}
    </section>
  );
}
function decimalMicros(value: string) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return NaN;
  const [whole, fraction = ""] = value.split(".");
  const micros = Number(
    BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0")),
  );
  return Number.isSafeInteger(micros) ? micros : NaN;
}
function donationRule(poll: DonationPoll) {
  const price = (poll.donation.minimumMicros / 1000000).toLocaleString(
    "ko-KR",
    { maximumFractionDigits: 6 },
  );
  return (
    price +
    " " +
    poll.donation.currency +
    (poll.donation.plural
      ? "당 1표 · 건별 내림 · 누적 투표"
      : " 이상 · 1인 1표 · 추가 후원 시 선택 변경")
  );
}
export function DonationPage({
  active,
  poll,
  canRoulette,
  onRoulette,
  ...connection
}: ConnectionProps & {
  active: boolean;
  poll: DonationPoll | null;
  canRoulette: boolean;
  onRoulette: (title: string, items: RouletteItem[]) => void;
}) {
  const [view, setView] = useState<"setup" | "stage">("setup");
  const [question, setQuestion] = useState(""),
    [options, setOptions] = useState<{ id: number; text: string }[]>([]);
  const [draft, setDraft] = useState(""),
    [prefix, setPrefix] = useState("!투표"),
    [currency, setCurrency] = useState("KRW"),
    [price, setPrice] = useState("1000"),
    [plural, setPlural] = useState(false);
  const [timerEnabled, setTimerEnabled] = useState(false),
    [seconds, setSeconds] = useState("60"),
    [platforms, setPlatforms] = useState<AudiencePlatform[]>([
      "chzzk",
      "youtube",
    ]);
  const draftRef = useRef<HTMLInputElement>(null),
    nextId = useRef(100);
  const { busy, error, setError, run } = useActions();
  const applicable = {
    ...connection,
    available: connection.available.filter(
      (p) => p !== "chzzk" || currency === "KRW",
    ),
  };
  const { selected, ready } = useTargets(applicable, platforms);
  const frozen = !!poll?.active;
  useEffect(() => {
    if (!poll) return;
    setQuestion(poll.question);
    setOptions(poll.options.map((text) => ({ id: nextId.current++, text })));
    setDraft("");
    setPrefix(poll.chatPrefix);
    setCurrency(poll.donation.currency);
    setPrice(String(poll.donation.minimumMicros / 1000000));
    setPlural(poll.donation.plural);
    setPlatforms(poll.platforms);
    setTimerEnabled(poll.endsAt !== null);
    setSeconds(String(poll.endsAt ? (poll.endsAt - poll.openedAt) / 1000 : 60));
    const timer = setTimeout(() => changeScreen(() => setView("stage")), 0);
    return () => clearTimeout(timer);
  }, [poll?.id]);
  const minimumMicros = decimalMicros(price);
  const prefixValid =
    prefix.length <= 12 &&
    !/^\s/.test(prefix) &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(prefix);
  const valid =
    ready &&
    !!question.trim() &&
    options.length >= 2 &&
    options.every((o) => o.text.trim()) &&
    new Set(options.map((o) => o.text.trim())).size === options.length &&
    !draft.trim() &&
    prefixValid &&
    minimumMicros >= 1 &&
    minimumMicros <= 1e15 &&
    timerValid(timerEnabled, seconds);
  function add() {
    const text = draft.trim();
    if (!text || options.length >= 4 || frozen) return;
    if (options.some((o) => o.text.trim() === text)) {
      setError("같은 선택지가 이미 있습니다.");
      draftRef.current?.focus();
      return;
    }
    setOptions([...options, { id: nextId.current++, text }]);
    setDraft("");
    setError("");
    requestAnimationFrame(() => draftRef.current?.focus());
  }
  function reset() {
    changeScreen(() => {
      setQuestion("");
      setOptions([]);
      setDraft("");
      setError("");
      setView("setup");
    });
  }
  async function start() {
    await run("donation-start", {
      question,
      options: options.map((o) => o.text.trim()),
      platforms: selected,
      chatPrefix: prefix,
      currency,
      minimumMicros,
      plural,
      timerSeconds: timerEnabled ? Number(seconds) : null,
    });
  }
  return (
    <section hidden={!active} className="donation-page" aria-label="도네 투표">
      {view === "setup" ? (
        <div className="donation-setup page-body screen-enter">
          <section className="panel audience-editor donation-editor">
            <div className="panel-heading">
              <h2>
                <Icon name="donation" size={19} /> 도네 투표
              </h2>
              <span className="tag">{options.length}/4</span>
            </div>
            <label>
              투표 질문
              <input
                aria-label="도네 투표 질문"
                placeholder="예: 다음 콘텐츠를 골라주세요"
                maxLength={100}
                value={question}
                disabled={frozen}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            <span className="field-caption">선택지</span>
            <ol className="donation-options">
              {options.map((option, index) => (
                <li key={option.id}>
                  <span>{prefix + (index + 1)}</span>
                  <input
                    aria-label={"도네 선택지 " + (index + 1)}
                    value={option.text}
                    maxLength={50}
                    disabled={frozen}
                    onChange={(e) =>
                      setOptions(
                        options.map((o) =>
                          o.id === option.id
                            ? { ...o, text: e.target.value }
                            : o,
                        ),
                      )
                    }
                  />
                  <button
                    className="icon-button"
                    aria-label={"도네 선택지 " + (index + 1) + " 삭제"}
                    disabled={frozen}
                    onClick={() => {
                      setOptions(options.filter((o) => o.id !== option.id));
                      requestAnimationFrame(() => draftRef.current?.focus());
                    }}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </li>
              ))}
            </ol>
            <div className="roulette-add">
              <input
                ref={draftRef}
                aria-label="새 도네 선택지"
                placeholder={
                  options.length >= 4
                    ? "선택지는 최대 4개예요"
                    : "새 선택지를 입력하세요"
                }
                value={draft}
                maxLength={50}
                disabled={frozen}
                readOnly={options.length >= 4}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    e.nativeEvent.keyCode !== 229
                  ) {
                    e.preventDefault();
                    add();
                  }
                }}
              />
              <button
                className="secondary"
                aria-label="도네 선택지 추가"
                disabled={frozen || !draft.trim() || options.length >= 4}
                onClick={add}
              >
                <Icon name="plus" size={16} /> 추가
              </button>
            </div>
            <PlatformPicker
              {...applicable}
              value={platforms}
              onChange={setPlatforms}
              disabled={frozen}
            />
            <div className="audience-form-bottom">
              <p className="audience-form-error" role="status">
                {error ||
                  (!ready
                    ? "연결된 방송 채팅을 선택하세요."
                    : "후원 메시지 앞에 참여 명령을 입력하면 집계됩니다.")}
              </p>
              <button
                className="primary"
                disabled={frozen ? busy : !valid || busy}
                onClick={() =>
                  frozen ? changeScreen(() => setView("stage")) : void start()
                }
              >
                <Icon name="play" size={17} />
                {frozen ? "투표 현황 보기" : "도네 투표 시작"}
              </button>
              {poll && !frozen && (
                <button
                  className="secondary"
                  onClick={() => changeScreen(() => setView("stage"))}
                >
                  이전 투표 현황
                </button>
              )}
            </div>
          </section>
          <section className="panel donation-config">
            <div className="panel-heading">
              <h2>집계 방식</h2>
              <Icon name="settings" size={18} />
            </div>
            <div className="donation-price-fields">
              <label>
                투표 통화
                <select
                  aria-label="도네 투표 통화"
                  value={currency}
                  disabled={frozen}
                  onChange={(e) => {
                    setCurrency(e.target.value);
                    setPrice(
                      e.target.value === "KRW"
                        ? "1000"
                        : e.target.value === "JPY"
                          ? "100"
                          : "1",
                    );
                  }}
                >
                  {["KRW", "USD", "JPY", "EUR", "GBP", "CAD", "AUD"].map(
                    (c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {plural ? "1표당 금액" : "최소 후원 금액"}
                <input
                  aria-label="도네 투표 금액"
                  type="number"
                  min="0.000001"
                  max="1000000000"
                  step={currency === "KRW" || currency === "JPY" ? 1 : 0.01}
                  value={price}
                  disabled={frozen}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
            </div>
            <div className="entry-method">
              <span className="field-caption">투표수 계산</span>
              <div className="segmented-buttons">
                <button
                  type="button"
                  className={!plural ? "selected" : ""}
                  disabled={frozen}
                  onClick={() => setPlural(false)}
                >
                  1인 1표
                </button>
                <button
                  type="button"
                  className={plural ? "selected" : ""}
                  disabled={frozen}
                  onClick={() => setPlural(true)}
                >
                  금액 배수
                </button>
              </div>
            </div>
            <label>
              참여 명령 접두어
              <input
                aria-label="도네 투표 접두어"
                value={prefix}
                maxLength={12}
                placeholder="예: !투표"
                disabled={frozen}
                onChange={(e) => setPrefix(e.target.value)}
              />
            </label>
            <TimerInput
              enabled={timerEnabled}
              seconds={seconds}
              onEnabled={setTimerEnabled}
              onSeconds={setSeconds}
              disabled={frozen}
            />
            <div className="donation-instructions">
              <Icon name="donation" size={28} />
              <h3>
                {plural
                  ? "후원 금액만큼 선택에 힘을 더해요"
                  : "후원으로 한 번의 선택을 남겨요"}
              </h3>
              <p>
                {plural
                  ? "건별로 금액을 내림 계산합니다. 남는 금액은 다음 후원에 합산하지 않습니다."
                  : "최소 금액 이상이면 1표입니다. 같은 계정이 다시 후원하면 이전 선택을 변경합니다."}
              </p>
              <p>
                {currency === "KRW"
                  ? "치지직 치즈와 KRW 슈퍼챗을 집계합니다."
                  : currency + " 슈퍼챗을 집계합니다."}{" "}
                다른 통화와 익명 후원은 집계하지 않습니다.
              </p>
            </div>
          </section>
        </div>
      ) : (
        poll && (
          <>
            <div className="donation-live-rule">
              <Icon name="donation" size={17} />
              <strong>{donationRule(poll)}</strong>
              <span>
                {poll.acceptedEvents.toLocaleString()}건
                {poll.ignoredCurrency > 0
                  ? " · 다른 통화 " + poll.ignoredCurrency + "건 제외"
                  : ""}
              </span>
            </div>
            <PollPresentation
              poll={poll}
              counts={poll.counts}
              sources={poll.platforms.map((p) =>
                p === "chzzk"
                  ? "치지직 치즈"
                  : p === "youtube"
                    ? "YouTube Super Chat"
                    : "테스트 후원",
              )}
              busy={busy}
              nativePending={false}
              canRoulette={
                canRoulette && !poll.active && poll.counts.some((c) => c > 0)
              }
              onCopy={() => void run("donation-copy")}
              onStop={() => void run("donation-stop")}
              onSetup={() => changeScreen(() => setView("setup"))}
              onNew={reset}
              onRoulette={() =>
                onRoulette(
                  poll.question,
                  poll.options.map((name, i) => ({
                    name,
                    weight: poll.counts[i],
                  })),
                )
              }
            />
            {(error || poll.reason) && (
              <p className="stage-hint" role="status">
                {error || poll.reason}
              </p>
            )}
          </>
        )
      )}
    </section>
  );
}
