import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, PlatformIcon } from "./icons";
import { platformLabel, type Platform } from "./platforms";
import type {
  TimelineAnalysis,
  TimelineEvent,
  TimelineSession,
  ViewerPoint,
} from "./timeline-types";
import "./timeline.css";
import { HistoryWorkspace } from "./history";
import { AiAnalysisWorkspace } from "./ai-analysis";
const timecode = (ms: number) => {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};
const label = (platform: string) =>
  platform === "demo" ? "테스트" : platformLabel(platform as Platform);
const blank: TimelineAnalysis = {
  method: "local-statistics-v1",
  chats: 0,
  donations: 0,
  uniqueParticipants: 0,
  money: {},
  reactions: {},
  keywords: [],
  repeats: [],
  bins: [],
  participants: [],
  viewers: [],
  limited: false,
};
function useRows(ref: React.RefObject<HTMLDivElement | null>, rowHeight: number, maximum = 10, screen = "") {
  const [rows,setRows] = useState(1);
  useLayoutEffect(()=>{
    const element=ref.current;
    if(!element)return;
    const measure=(height:number)=>setRows(Math.max(1,Math.min(maximum,Math.floor((height-48)/rowHeight))));
    measure(element.clientHeight);
    const observer=new ResizeObserver(([entry])=>measure(entry.contentRect.height));
    observer.observe(element);
    return()=>observer.disconnect();
  },[ref,rowHeight,maximum,screen]);
  return rows;
}
function ViewerChart({
  points,
  platform,
  onPlatform,
}: {
  points: ViewerPoint[];
  platform: string;
  onPlatform: (s: string) => void;
}) {
  const value = (point: ViewerPoint) => {
    const sources = platform
      ? point.sources.filter((s) => s.platform === platform)
      : point.sources;
    return !sources.length ||
      sources.some((s) => !s.available || s.count === null)
      ? null
      : sources.reduce((sum, s) => sum + (s.count || 0), 0);
  };
  const known = points.map(value).filter((v): v is number => v !== null);
  const peak = known.length ? Math.max(...known) : null;
  const latest = points.length ? value(points.at(-1)!) : null;
  const mean = known.length
    ? Math.round(known.reduce((a, b) => a + b, 0) / known.length)
    : null;
  const max = Math.max(10, peak || 0),
    end = Math.max(60000, points.at(-1)?.at || 0);
  const visible = points.filter(
    (_, i) =>
      i === points.length - 1 ||
      i % Math.max(1, Math.ceil(points.length / 300)) === 0,
  );
  let path = "",
    gap = true;
  for (const point of visible) {
    const count = value(point);
    if (count === null) {
      gap = true;
      continue;
    }
    const x = 38 + (point.at / end) * 510,
      y = 148 - (count / max) * 120;
    path += (gap ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
    gap = false;
  }
  const choices = [
    ...new Set(points.flatMap((p) => p.sources.map((s) => s.platform))),
  ];
  return (
    <section className="panel viewer-panel">
      <div className="panel-heading">
        <h2>
          <Icon name="activity" size={17} /> 동시 시청자 수
        </h2>
        <select
          aria-label="시청자 그래프 플랫폼"
          value={platform}
          onChange={(e) => onPlatform(e.target.value)}
        >
          <option value="">전체 합계</option>
          {choices.map((p) => (
            <option key={p} value={p}>
              {label(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="viewer-kpis">
        {[
          ["현재", latest],
          ["평균", mean],
          ["최고", peak],
        ].map(([name, count]) => (
          <div key={String(name)}>
            <span>{name}</span>
            <strong>
              {count === null ? "—" : Number(count).toLocaleString()}
              <small>명</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="viewer-chart">
        {known.length ? (
          <svg
            viewBox="0 0 570 176"
            preserveAspectRatio="none"
            role="img"
            aria-label="방송 경과 시간에 따른 실제 동시 시청자 수 그래프"
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1="38"
                  x2="548"
                  y1={148 - f * 120}
                  y2={148 - f * 120}
                  className="chart-grid"
                />
                <text x="30" y={152 - f * 120} textAnchor="end">
                  {Math.round(max * f)}
                </text>
              </g>
            ))}
            <path d={path} className={"viewer-line " + platform} />
            <text x="38" y="169">
              {timecode(0)}
            </text>
            <text x="548" y="169" textAnchor="end">
              {timecode(end)}
            </text>
          </svg>
        ) : (
          <div className="telemetry-empty">
            <Icon name="activity" size={27} />
            <strong>시청자 수 데이터를 기다리고 있어요</strong>
            <span>
              연결된 방송의 동접을 수집합니다. 비공개·조회 불가 값은 0명으로
              추정하지 않습니다.
            </span>
          </div>
        )}
      </div>
      <small>
        플랫폼이 전달한 동시 시청자 수입니다. 조회할 수 없는 구간은 그래프가
        끊겨 표시됩니다.
      </small>
    </section>
  );
}
export function TimelineWorkspace({
  current,
  session,
  sessions,
  chatCount,
  recentCount,
  autoRecord,
  monitoring,
  recordStorage,
  busy,
  shortcut,
  selected,
  onSelect,
  onAction,
  demo,
  onAiSettings,
}: {
  current: TimelineSession | null;
  session?: TimelineSession;
  sessions: TimelineSession[];
  chatCount: number;
  recentCount: number;
  autoRecord: boolean;
  monitoring?: {
    active: boolean;
    error?: string;
    platforms: Record<string, { live: boolean | null; error?: string }>;
  };
  recordStorage?: { pending: number; error: string; encrypted: boolean };
  busy: boolean;
  shortcut: string;
  selected: string;
  onSelect: (id: string) => void;
  onAction: (action: string, payload?: unknown) => Promise<boolean>;
  demo: boolean;
  onAiSettings?: (functionId?: string) => void;
}) {
  const [title, setTitle] = useState(""),
    [offset, setOffset] = useState(0),
    [marker, setMarker] = useState("");
  const [view, setView] = useState<"overview" | "records" | "analysis" | "ai">(
    "overview",
  );
  const [analysis, setAnalysis] = useState<TimelineAnalysis>(blank),
    [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [kind, setKind] = useState("all"),
    [platform, setPlatform] = useState(""),
    [query, setQuery] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [participant, setParticipant] = useState("");
  const [page, setPage] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [markerPage, setMarkerPage] = useState(0);
  const [viewerPlatform, setViewerPlatform] = useState(""),
    [includeIdentity, setIncludeIdentity] = useState(false);
  const [clock, setClock] = useState(Date.now()),
    [refresh, setRefresh] = useState(0);
  const recordArea = useRef<HTMLDivElement>(null),
    markerArea = useRef<HTMLDivElement>(null),
    participantArea = useRef<HTMLDivElement>(null);
  const recordRows = useRows(recordArea, 51, 10, view),
    markerRows = useRows(markerArea, 64, 8, view),
    participantRows = useRows(participantArea, 42, 10, view);
  const request = useRef(0);
  const active = !!current && current.id === session?.id;
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setPage(0);
  }, [kind, platform, query, from, to, participant, session?.id, recordRows]);
  useEffect(() => {
    setMarkerPage(0);
    setAnalysis(blank);
    setEvents([]);
  }, [session?.id]);
  useEffect(() => {
    if (!session || !window.assist || (view === "records" || view === "ai")) return;
    let disposed = false;
    const update = async () => {
      const generation = ++request.current;
      setLoading(true);
      const filters = {
        sessionId: session.id,
        from: from ? Number(from) * 60000 : 0,
        to: to ? Number(to) * 60000 : undefined,
        platform,
        participantKey: participant || undefined,
        text: query,
        kind,
        page,
        limit: recordRows,
      };
      try {
        const summary = await window.assist!.call("timeline-analysis", filters);
        if (disposed || generation !== request.current) return;
        if (!summary.ok) throw new Error(summary.error);
        setAnalysis(summary.data as TimelineAnalysis);
        setError("");
      } catch (err) {
        if (!disposed)
          setError(err instanceof Error ? err.message : "기록 조회 실패");
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void update();
    const timer = active ? setInterval(() => void update(), 5000) : undefined;
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [
    session?.id,
    active,
    view,
    kind,
    platform,
    query,
    from,
    to,
    participant,
    page,
    recordRows,
    refresh,
  ]);
  const duration = session ? (session.endedAt || clock) - session.startedAt : 0;
  const markers = [...(session?.markers || [])].reverse();
  const markerPages = Math.max(1, Math.ceil(markers.length / markerRows));
  const markerIndex = Math.min(markerPage, markerPages - 1);
  const totals = session?.telemetry;
  const status = !autoRecord
    ? "수동 기록"
    : current
      ? "자동 감지 켜짐"
      : monitoring?.active
        ? "방송 시작 감지 중"
        : "연결된 채널 대기";
  const filters = (
    <div className="telemetry-filters">
      <select
        aria-label="기록 플랫폼"
        value={platform}
        onChange={(e) => setPlatform(e.target.value)}
      >
        <option value="">모든 플랫폼</option>
        {["chzzk", "youtube", "twitch", "demo"].map((p) => (
          <option key={p} value={p}>
            {label(p)}
          </option>
        ))}
      </select>
      <label className="time-range">
        <input
          aria-label="분석 시작 분"
          type="number"
          min="0"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="시작"
        />
        <span>~</span>
        <input
          aria-label="분석 종료 분"
          type="number"
          min="0"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="종료"
        />
        <span>분</span>
      </label>
      <input
        aria-label="채팅 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="내용·닉네임 검색"
      />
      {participant && (
        <button className="secondary" onClick={() => setParticipant("")}>
          시청자 필터 해제
        </button>
      )}
      <button
        className="text-button"
        aria-label="분석 새로고침"
        onClick={() => setRefresh((n) => n + 1)}
      >
        {loading ? "조회 중" : "새로고침"}
      </button>
    </div>
  );
  return (
    <div className={"timeline-workspace page-body" + (view === "ai" ? " ai-timeline-view" : "")}>
      <section className="session-card telemetry-session">
        <div className="session-top">
          <div>
            <span className="session-label">
              <i className={current ? "dot green" : "dot"} />
              {session?.recordingMode === "automatic"
                ? "자동 기록"
                : current
                  ? "방송 기록"
                  : "방송 세션"}
              {demo && " · 테스트"}
            </span>
            <h2 title={session?.title}>
              {session?.title || "연결된 방송을 기다리고 있어요"}
            </h2>
          </div>
          <div className="telemetry-session-actions">
            <button
              className="auto-detection-control"
              role="switch"
              aria-label="자동 방송 감지"
              aria-checked={autoRecord}
              disabled={busy}
              onClick={() =>
                void onAction("auto-record-set", { enabled: !autoRecord })
              }
            >
              <i className={autoRecord ? "dot green" : "dot"} />
              {status}
            </button>
            <div className="clock">{timecode(duration)}</div>
          </div>
        </div>
        {!current ? (
          <div className="start-form">
            <label className="title-field">
              방송 제목
              <input
                aria-label="방송 제목"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="자동 감지 또는 직접 입력"
                maxLength={120}
              />
            </label>
            <label className="offset-field">
              경과 시간
              <span className="input-unit">
                <input
                  aria-label="방송 경과 초"
                  type="number"
                  min="0"
                  max="86400"
                  value={offset}
                  onChange={(e) => setOffset(+e.target.value)}
                />
                <span>초</span>
              </span>
            </label>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                onSelect("");
                void onAction("start", { title, offset });
              }}
            >
              <Icon name="play" size={15} /> 방송 기록 시작
            </button>
          </div>
        ) : (
          <div className="telemetry-live-row">
            <span>
              {current.recordingMode === "automatic"
                ? "방송 시작 시각을 감지해 자동 기록합니다."
                : "수동으로 기록 중입니다."}{" "}
              · {shortcut.replace("CommandOrControl", "Ctrl")} 마커
            </span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void onAction("stop")}
            >
              <Icon name="stop" size={15} /> 기록 종료
            </button>
          </div>
        )}
      </section>
      <div className="telemetry-stat-strip">
        {[
          ["마커", markers.length],
          ["저장할 채팅", totals?.chats ?? (active ? chatCount : 0)],
          ["후원", totals?.donations || 0],
          ["참여 시청자", totals?.participants || analysis.uniqueParticipants],
        ].map(([name, value]) => (
          <div key={String(name)}>
            <span>{name}</span>
            <strong>{Number(value).toLocaleString()}</strong>
          </div>
        ))}
        {(recordStorage?.error || (recordStorage?.pending ?? 0) > 0) && <span
          className={
            "record-save-state " + (recordStorage?.error ? "error" : "")
          }
          title={
            recordStorage?.error ||
            "채팅·후원·시청자 기록은 Windows 암호화로 이 PC에 저장합니다."
          }
        >
          {recordStorage?.error
            ? "저장 확인 필요"
            : "기록 저장 중"}
        </span>}
      </div>
      <div className="telemetry-toolbar">
        <div
          className="telemetry-tabs"
          role="tablist"
          aria-label="타임라인 화면"
        >
          {[
            ["overview", "타임라인"],
            ["records", "채팅·후원"],
            ["analysis", "분석·AI 데이터"],
            ["ai", "AI 분석"],
          ].map(([id, name]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id as typeof view)}
            >
              {name}
            </button>
          ))}
        </div>
        {view !== "records" && <select
          aria-label="방송 기록 선택"
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">현재 / 최근 방송</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>}
      </div>
      {(error || monitoring?.error) && (
        <div
          className="telemetry-error"
          role="alert"
          title={error || monitoring?.error}
        >
          {error || monitoring?.error}
        </div>
      )}
      {view === "overview" && (
        <div className="telemetry-overview">
          <ViewerChart
            points={analysis.viewers}
            platform={viewerPlatform}
            onPlatform={setViewerPlatform}
          />
          <section className="panel telemetry-markers">
            <div className="panel-heading">
              <h2>
                <Icon name="bookmark" size={16} /> 기억할 순간{" "}
                <span className="count">{markers.length}</span>
              </h2>
              <span className="tag">{recentCount}개 / 10초</span>
            </div>
            <div className="marker-form">
              <input
                aria-label="마커 메모"
                value={marker}
                onChange={(e) => setMarker(e.target.value)}
                placeholder="이 순간의 메모"
                maxLength={300}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && active) {
                    void onAction("mark", { label: marker || "하이라이트" });
                    setMarker("");
                  }
                }}
              />
              <button
                className="primary"
                disabled={busy || !active}
                onClick={() => {
                  void onAction("mark", { label: marker || "하이라이트" });
                  setMarker("");
                }}
              >
                <Icon name="plus" size={15} /> 마커
              </button>
            </div>
            <div className="telemetry-marker-area" ref={markerArea}>
              {markers.length ? (
                markers
                  .slice(
                    markerIndex * markerRows,
                    (markerIndex + 1) * markerRows,
                  )
                  .map((m) => (
                    <article className="telemetry-marker" key={m.id}>
                      <time>{m.timecode}</time>
                      <div>
                        <strong title={m.label}>{m.label}</strong>
                        <span>
                          {m.kind === "auto" ? "반응 자동 감지" : "직접 기록"}
                          {m.evidence &&
                            ` · ${m.evidence.messages}개 / ${m.evidence.unique}명`}
                        </span>
                      </div>
                    </article>
                  ))
              ) : (
                <div className="telemetry-empty">
                  <Icon name="timeline" size={28} />
                  <strong>첫 번째 순간을 기다리고 있어요</strong>
                  <span>단축키와 마커 버튼으로 기억할 순간을 남기세요.</span>
                </div>
              )}
              <div className="telemetry-pagination">
                <button
                  disabled={markerIndex === 0}
                  onClick={() => setMarkerPage((n) => n - 1)}
                >
                  이전
                </button>
                <span>
                  {markerIndex + 1} / {markerPages}
                </span>
                <button
                  disabled={markerIndex + 1 >= markerPages}
                  onClick={() => setMarkerPage((n) => n + 1)}
                >
                  다음
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {view === "records" && <HistoryWorkspace sessions={sessions} current={current} initialText={query} initialParticipant={participant} onDeleted={()=>setRefresh(n=>n+1)}/>}
      {view === "ai" && <AiAnalysisWorkspace session={session} sessions={sessions} onSettings={onAiSettings} />}
      {view === "analysis" && (
        <div className="telemetry-analysis">
          {filters}
          <div className="analysis-columns">
            <section className="panel chat-insights">
              <div className="panel-heading">
                <h2>
                  <Icon name="activity" size={17} /> 채팅 반응 분석
                </h2>
                <span className="tag">로컬 통계</span>
              </div>
              <div className="reaction-grid">
                {[
                  ["웃음", "laugh"],
                  ["질문", "question"],
                  ["감탄", "excitement"],
                  ["링크", "link"],
                ].map(([name, key]) => (
                  <div key={key}>
                    <span>{name}</span>
                    <strong>
                      {(analysis.reactions[key] || 0).toLocaleString()}
                    </strong>
                  </div>
                ))}
              </div>
              <div
                className="chat-volume-chart"
                role="img"
                aria-label="분 단위 채팅량"
              >
                <div>
                  {analysis.bins.slice(-100).map((bin) => (
                    <i
                      key={bin.minute}
                      title={`${timecode(bin.minute * 60000)} · ${bin.chats}개`}
                      style={{
                        height:
                          Math.max(
                            3,
                            (bin.chats /
                              Math.max(
                                1,
                                ...analysis.bins.map((b) => b.chats),
                              )) *
                              100,
                          ) + "%",
                      }}
                    />
                  ))}
                </div>
                <small>
                  분 단위 채팅량 · {analysis.chats.toLocaleString()}개 분석
                </small>
              </div>
              <h3>자주 등장한 표현</h3>
              <div className="keyword-cloud">
                {analysis.keywords.slice(0, 10).map((word) => (
                  <button
                    key={word.text}
                    title={word.text + " · " + word.count + "회"}
                    onClick={() => {
                      setQuery(word.text);
                      setView("records");
                    }}
                  >
                    <span>{word.text}</span>
                    <b>{word.count}</b>
                  </button>
                ))}
                {!analysis.keywords.length && (
                  <small>기록이 쌓이면 키워드가 표시됩니다.</small>
                )}
              </div>
              <p className="analysis-caption">
                문구 기반 집계입니다. 문맥·감정에 대한 AI 판정은 아직 실행하지
                않습니다.
                {analysis.limited &&
                  " 장시간 집계 일부는 표시 범위가 제한되며 원본은 기록 파일에 유지됩니다."}
              </p>
            </section>
            <div className="analysis-right">
              <section className="panel participant-panel">
                <div className="panel-heading">
                  <h2>
                    참여 시청자{" "}
                    <span className="count">{analysis.uniqueParticipants}</span>
                  </h2>
                  <small>같은 플랫폼 계정은 같은 분석 ID</small>
                </div>
                <div className="participant-area" ref={participantArea}>
                  {analysis.participants
                    .slice(0, participantRows)
                    .map((person) => (
                      <button
                        key={person.key}
                        className="participant-row"
                        title={"분석용 ID: " + person.key}
                        onClick={() => {
                          setParticipant(person.key);
                          setView("records");
                        }}
                      >
                        <span>
                          {person.platform === "demo" ? (
                            <Icon name="message" size={15} />
                          ) : (
                            <PlatformIcon
                              platform={person.platform}
                              size={15}
                            />
                          )}{" "}
                          {person.displayName || "시청자"}
                        </span>
                        <small>
                          {person.subscriber
                            ? "구독/멤버"
                            : person.roles.join(" · ")}
                        </small>
                        <b>{person.chats}개</b>
                      </button>
                    ))}
                </div>
              </section>
              <section className="panel ai-data-panel">
                <h2>
                  <Icon name="export" size={17} /> AI 분석용 데이터
                </h2>
                <p>
                  시점·화자 ID·역할·채팅·후원·시청자 수·마커와 통계를 JSONL로
                  저장합니다.
                </p>
                <label className="identity-option">
                  <input
                    type="checkbox"
                    checked={includeIdentity}
                    onChange={(e) => setIncludeIdentity(e.target.checked)}
                  />{" "}
                  공개 닉네임·플랫폼 ID 포함
                </label>
                <small>
                  {includeIdentity
                    ? "플랫폼에서 제공된 공개 식별 정보를 포함합니다."
                    : "공개 계정 ID 제외·닉네임 가명화. 화자 키·본문은 유지합니다."}
                </small>
                <button
                  className="primary"
                  disabled={busy || !session}
                  onClick={() =>
                    void onAction("timeline-export", {
                      sessionId: session?.id,
                      includeIdentity,
                    })
                  }
                >
                  <Icon name="export" size={15} /> 분석 데이터 내보내기
                </button>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
