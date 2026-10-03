import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Marker = {
  id: string;
  at: number;
  timecode: string;
  label: string;
  kind: string;
  evidence?: {
    messages: number;
    unique: number;
    ratio: number;
    samples: string[];
  };
};
type Session = {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  markers: Marker[];
};
type Poll = {
  id: string;
  question: string;
  options: string[];
  counts: number[];
  youtubeCounts: number[] | null;
  active: boolean;
  mode: string;
  youtubeId?: string;
};
type State = {
  current: Session | null;
  sessions: Session[];
  poll: Poll | null;
  chatCount: number;
  recentCount: number;
  connections: { youtube: string; chzzk: string };
  demo: boolean;
  notice: string;
  shortcut: string;
};
declare global {
  interface Window {
    assist?: {
      call: (
        action: string,
        payload?: unknown,
      ) => Promise<{ ok: boolean; error?: string }>;
      subscribe: (cb: (state: State) => void) => () => void;
    };
  }
}
const empty: State = {
  current: null,
  sessions: [],
  poll: null,
  chatCount: 0,
  recentCount: 0,
  connections: { youtube: "미연결", chzzk: "미연결" },
  demo: false,
  notice: "",
  shortcut: "",
};
function tc(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
function App() {
  const [state, setState] = useState(empty);
  const [tab, setTab] = useState("timeline");
  const [title, setTitle] = useState("오늘의 방송");
  const [offset, setOffset] = useState(0);
  const [label, setLabel] = useState("");
  const [tokens, setTokens] = useState({
    youtubeToken: "",
    liveChatId: "",
    chzzkToken: "",
  });
  const [question, setQuestion] = useState("다음엔 어떤 게임을 할까요?");
  const [options, setOptions] = useState("마인크래프트\n리그 오브 레전드");
  const [mode, setMode] = useState("native");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!window.assist) return;
    const unsub = window.assist.subscribe(setState);
    void window.assist.call("state");
    return unsub;
  }, []);
  async function call(action: string, payload?: unknown) {
    if (!window.assist) {
      setError("데스크톱 앱에서 실행하세요. npm run dev");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await window.assist.call(action, payload);
      if (!result.ok) setError(result.error || "요청 실패");
    } catch {
      setError("앱과 통신하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  const session = selected
    ? state.sessions.find((s) => s.id === selected)
    : state.current || state.sessions[0];
  const markers = session?.markers || [];
  const elapsed = state.current
    ? tc(Date.now() - state.current.startedAt)
    : "00:00:00";
  const poll = state.poll;
  const combined =
    poll?.counts.map((n, i) => n + (poll.youtubeCounts?.[i] || 0)) || [];
  const total = combined.reduce((a, b) => a + b, 0);
  return (
    <div className="layout">
      <aside>
        <div className="brand">
          <span className="brand-icon">◈</span>
          <div>
            Streamer<span>ASSIST</span>
          </div>
        </div>
        <div className="nav-label">방송 도구</div>
        <nav>
          {[
            ["timeline", "◷", "방송 타임라인"],
            ["poll", "▤", "통합 투표"],
            ["settings", "⚙", "플랫폼 연결"],
          ].map(([id, icon, text]) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              onClick={() => setTab(id)}
            >
              <span>{icon}</span>
              {text}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <i
              className={
                state.connections.chzzk === "연결됨" ? "dot green" : "dot"
              }
            />{" "}
            CHZZK{" "}
            <small>
              {state.connections.chzzk === "연결됨" ? "연결됨" : "미연결"}
            </small>
          </div>
          <div className="connection">
            <i
              className={
                state.connections.youtube === "연결됨" ? "dot red" : "dot"
              }
            />{" "}
            YouTube{" "}
            <small>
              {state.connections.youtube === "연결됨" ? "연결됨" : "미연결"}
            </small>
          </div>
          <p>창을 닫아도 트레이에서 기록합니다.</p>
          <span className="version">v0.1.0 · Windows</span>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            내 방송 <span>/</span>{" "}
            {tab === "timeline"
              ? "타임라인"
              : tab === "poll"
                ? "통합 투표"
                : "플랫폼 연결"}
          </div>
          <span className={state.current ? "live-badge live" : "live-badge"}>
            <i className="dot" />
            {state.current ? "기록 중" : "방송 대기"}
          </span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR STREAM, EVERY MOMENT.</div>
              <h1>
                {tab === "timeline"
                  ? "놓치고 싶지 않은 순간들"
                  : tab === "poll"
                    ? "두 채팅창, 하나의 질문"
                    : "방송 플랫폼 연결"}
              </h1>
              <p>
                {tab === "timeline"
                  ? "방송에 집중하세요. 기억할 순간은 여기에 남겨둘게요."
                  : tab === "poll"
                    ? "치지직 번호 투표와 유튜브 실시간 투표를 한곳에서 관리하세요."
                    : "공식 API 액세스 토큰으로 채팅을 연결합니다."}
              </p>
            </div>
            {tab === "timeline" && (
              <button
                className="secondary"
                disabled={busy || !session}
                onClick={() =>
                  call("export", { sessionId: selected || undefined })
                }
              >
                ↗ 기록 내보내기
              </button>
            )}
          </div>
          {(error || state.notice || !window.assist) && (
            <div className="notice" role="alert">
              {error ||
                state.notice ||
                "브라우저 미리보기입니다. 실제 기록과 트레이 기능은 Electron 앱에서 실행됩니다."}
            </div>
          )}
          {state.demo && (
            <div className="notice demo">
              테스트 채팅 사용 중 · 실제 시청자 데이터가 아닙니다.
            </div>
          )}
          {tab === "timeline" && (
            <>
              <section className="session-card">
                <div className="session-top">
                  <div>
                    <span className="eyebrow">STREAM SESSION</span>
                    <h2>
                      {state.current?.title || "방송을 시작할 준비가 됐나요?"}
                    </h2>
                  </div>
                  <div className="clock">{elapsed}</div>
                </div>
                {!state.current ? (
                  <div className="start-form">
                    <input
                      aria-label="방송 제목"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="방송 제목"
                      maxLength={120}
                    />
                    <label>
                      이미 방송 중이라면{" "}
                      <input
                        className="offset"
                        type="number"
                        min="0"
                        max="86400"
                        value={offset}
                        onChange={(e) => setOffset(+e.target.value)}
                      />
                      초 경과
                    </label>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        setSelected("");
                        void call("start", { title, offset });
                      }}
                    >
                      ● 방송 기록 시작
                    </button>
                  </div>
                ) : (
                  <div className="record-controls">
                    <div className="key-tip">
                      <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F8</kbd>
                      <span>어떤 창에서도 마커 기록</span>
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => call("stop")}
                    >
                      ■ 기록 종료
                    </button>
                  </div>
                )}
              </section>
              <div className="stats">
                <div>
                  <span>기록한 순간</span>
                  <strong>
                    {markers.length}
                    <small>개</small>
                  </strong>
                </div>
                <div>
                  <span>자동 하이라이트</span>
                  <strong>
                    {markers.filter((m) => m.kind === "auto").length}
                    <small>개</small>
                  </strong>
                </div>
                <div>
                  <span>수집한 채팅</span>
                  <strong>
                    {state.chatCount.toLocaleString()}
                    <small>개</small>
                  </strong>
                </div>
                <div>
                  <span>최근 10초 반응</span>
                  <strong>
                    {state.recentCount}
                    <small>개</small>
                  </strong>
                </div>
              </div>
              <div className="columns">
                <section className="panel timeline">
                  <div className="panel-heading">
                    <h2>
                      방송 타임라인{" "}
                      <span className="count">{markers.length}</span>
                    </h2>
                    <select
                      aria-label="방송 기록 선택"
                      value={selected}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      <option value="">
                        {state.current ? "현재 방송" : "최근 방송"}
                      </option>
                      {state.sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title} ·{" "}
                          {new Date(s.startedAt).toLocaleDateString("ko-KR")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="marker-input">
                    <input
                      aria-label="마커 메모"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !busy && state.current) {
                          void call("mark", { label: label || "하이라이트" });
                          setLabel("");
                        }
                      }}
                      placeholder="이 순간, 어떤 일이 있었나요?"
                      maxLength={300}
                    />
                    <button
                      className="primary"
                      disabled={busy || !state.current}
                      onClick={() => {
                        void call("mark", { label: label || "하이라이트" });
                        setLabel("");
                      }}
                    >
                      ＋ 마커
                    </button>
                  </div>
                  {!markers.length ? (
                    <div className="empty">
                      <div>◷</div>
                      <h3>첫 번째 순간을 기다리고 있어요</h3>
                      <p>
                        방송을 시작하고 단축키로 순간을 남기세요.
                        <br />
                        채팅 반응이 급증하면 자동으로 기록합니다.
                      </p>
                    </div>
                  ) : (
                    <div className="marker-list">
                      {[...markers].reverse().map((m) => (
                        <article key={m.id} className="marker">
                          <div className={"marker-dot " + m.kind} />
                          <time>{m.timecode}</time>
                          <div>
                            <div className="marker-title">
                              {m.label}{" "}
                              <span className={"tag " + m.kind}>
                                {m.kind === "auto" ? "자동 감지" : "직접 기록"}
                              </span>
                            </div>
                            {m.evidence && (
                              <>
                                <p>
                                  10초간 {m.evidence.messages}개 채팅 ·{" "}
                                  {m.evidence.unique}명 참여 · 평소 대비{" "}
                                  {m.evidence.ratio}배
                                </p>
                                <div className="samples">
                                  {m.evidence.samples.slice(0, 2).join(" / ")}
                                </div>
                              </>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <div className="right-panels">
                  <section className="panel detector">
                    <div className="panel-heading">
                      <h2>✦ 하이라이트 감지</h2>
                      <span className="tag auto">LOCAL</span>
                    </div>
                    <div className="detector-orb">✦</div>
                    <h3>
                      {state.current
                        ? "채팅 속 순간을 찾고 있어요"
                        : "방송 시작과 함께 감지합니다"}
                    </h3>
                    <p>
                      채팅 증가율, 참여자 수, 웃음·감탄 반응으로 편집 후보를
                      발견합니다.
                    </p>
                    <div className="rule">
                      <span>반응 증가</span>
                      <b>2.5배 이상</b>
                    </div>
                    <div className="rule">
                      <span>10초간 참여</span>
                      <b>5명 · 15개 채팅</b>
                    </div>
                    <div className="rule">
                      <span>중복 감지 간격</span>
                      <b>45초</b>
                    </div>
                    <div className="subtle-note">
                      영상 내용 판독은 포함하지 않습니다.
                      <br />
                      AI 호출 없이 PC에서 가볍게 분석합니다.
                    </div>
                  </section>
                  <section className="panel quick">
                    <h3>종료 후 바로 편집으로</h3>
                    <p>
                      타임코드와 반응 근거를 Markdown 또는 JSON으로 내보낼 수
                      있습니다.
                    </p>
                    <button
                      className="text-button"
                      disabled={busy || !session}
                      onClick={() =>
                        call("export", {
                          sessionId: selected || undefined,
                          format: "json",
                        })
                      }
                    >
                      JSON으로 내보내기 ↗
                    </button>
                  </section>
                </div>
              </div>
            </>
          )}
          {tab === "poll" && (
            <div className="columns">
              <section className="panel poll-editor">
                <h2>새 투표 만들기</h2>
                <label>
                  질문
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    maxLength={100}
                  />
                </label>
                <label>
                  선택지 <small>한 줄에 하나씩, 2~4개</small>
                  <textarea
                    value={options}
                    onChange={(e) => setOptions(e.target.value)}
                    rows={5}
                  />
                </label>
                <label>
                  투표 방식
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="native">
                      치지직 채팅 + YouTube 기본 투표
                    </option>
                    <option value="chat">양쪽 채팅 번호 투표</option>
                    <option value="demo">테스트 채팅 투표</option>
                  </select>
                </label>
                <p className="subtle-note">
                  채팅에서는 번호만 입력합니다. 플랫폼별 계정당 첫 표만
                  집계합니다. 서로 다른 플랫폼의 동일인은 식별할 수 없습니다.
                </p>
                <button
                  className="primary"
                  disabled={busy || !state.current || !!poll?.active}
                  onClick={() =>
                    call("poll-start", {
                      question,
                      options: options
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      mode,
                    })
                  }
                >
                  투표 시작
                </button>
              </section>
              <section className="panel poll-result">
                <div className="panel-heading">
                  <h2>투표 결과</h2>
                  <span className="tag auto">
                    {poll?.active ? "진행 중" : "대기 / 종료"}
                  </span>
                </div>
                {poll ? (
                  <>
                    <h3>{poll.question}</h3>
                    <p>{total}표 집계</p>
                    {poll.options.map((o, i) => (
                      <div className="result-row" key={i}>
                        <div>
                          <span>
                            {i + 1}. {o}
                          </span>
                          <b>
                            {combined[i]}표 ·{" "}
                            {total
                              ? Math.round((combined[i] / total) * 100)
                              : 0}
                            %
                          </b>
                        </div>
                        <div className="bar">
                          <div
                            style={{
                              width: `${total ? (combined[i] / total) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <small>
                          채팅 {poll.counts[i]} · YouTube 기본 투표{" "}
                          {poll.youtubeCounts?.[i] ?? "미확인"}
                        </small>
                      </div>
                    ))}
                    {poll.mode === "native" && poll.youtubeCounts === null && (
                      <p className="notice">
                        YouTube 집계 대기 중입니다. 채널 소유자 토큰에만 기본
                        투표의 득표수가 제공됩니다.
                      </p>
                    )}
                    <button
                      className="secondary"
                      disabled={busy || !poll.active}
                      onClick={() => call("poll-stop")}
                    >
                      투표 종료
                    </button>
                  </>
                ) : (
                  <div className="empty">
                    <div>▤</div>
                    <h3>시청자의 선택을 모아보세요</h3>
                    <p>같은 질문, 같은 선택지로 함께 투표합니다.</p>
                  </div>
                )}
              </section>
            </div>
          )}
          {tab === "settings" && (
            <div className="columns">
              <section className="panel settings">
                <h2>공식 API 연결</h2>
                <p>
                  토큰은 메모리에만 보관하며 종료 시 삭제합니다. 자동 갱신·OAuth
                  로그인은 아직 제공하지 않습니다.
                </p>
                <label>
                  YouTube 액세스 토큰
                  <input
                    type="password"
                    autoComplete="off"
                    value={tokens.youtubeToken}
                    onChange={(e) =>
                      setTokens({ ...tokens, youtubeToken: e.target.value })
                    }
                  />
                </label>
                <label>
                  YouTube liveChatId
                  <input
                    value={tokens.liveChatId}
                    onChange={(e) =>
                      setTokens({ ...tokens, liveChatId: e.target.value })
                    }
                  />
                </label>
                <small>
                  방송 URL이 아닌 liveChatId입니다. 투표에는 youtube.force-ssl
                  권한과 채널 소유자 인증이 필요합니다.
                </small>
                <label>
                  치지직 액세스 토큰
                  <input
                    type="password"
                    autoComplete="off"
                    value={tokens.chzzkToken}
                    onChange={(e) =>
                      setTokens({ ...tokens, chzzkToken: e.target.value })
                    }
                  />
                </label>
                <small>
                  치지직 개발자 앱의 ‘채팅 메시지 조회’ 및 ‘채팅 메시지 쓰기’
                  권한이 필요합니다.
                </small>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      await call("connect", tokens);
                      setTokens({
                        youtubeToken: "",
                        liveChatId: "",
                        chzzkToken: "",
                      });
                    }}
                  >
                    채팅 연결
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => call("disconnect")}
                  >
                    연결 해제
                  </button>
                </div>
                <p>CHZZK: {state.connections.chzzk}</p>
                <p>YouTube: {state.connections.youtube}</p>
              </section>
              <div className="right-panels">
                <section className="panel">
                  <h2>앱 동작</h2>
                  <p>
                    창 닫기 → 트레이에서 계속 실행
                    <br />
                    완전 종료 → 트레이 메뉴 ‘완전히 종료’
                  </p>
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => call("login-startup", { enabled: true })}
                    >
                      Windows 시작 시 실행 켜기
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => call("login-startup", { enabled: false })}
                    >
                      끄기
                    </button>
                  </div>
                </section>
                <section className="panel">
                  <h2>연결 없이 체험하기</h2>
                  <p>
                    테스트 채팅으로 자동 마킹과 투표 집계를 검증합니다. 실제
                    플랫폼 연결과 동시에 사용할 수 없습니다.
                  </p>
                  <button
                    className="secondary"
                    disabled={busy || !state.current}
                    onClick={() => call("demo")}
                  >
                    {state.demo ? "테스트 채팅 끄기" : "테스트 채팅 켜기"}
                  </button>
                </section>
              </div>
            </div>
          )}
          <footer>
            <span>◈ Streamer Assist</span>
            <span>모든 순간을, 당신의 페이스로.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
