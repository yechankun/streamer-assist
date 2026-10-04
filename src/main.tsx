import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Icon, PlatformIcon } from "./icons";

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
  windowFrame: { maximized: boolean };
  auth: {
    pending: string | null;
    accounts: Record<
      "chzzk" | "youtube",
      {
        configured: boolean;
        connected: boolean;
        name: string;
        channelId?: string;
      }
    >;
  };
};
declare global {
  interface Window {
    assist?: {
      call: (
        action: string,
        payload?: unknown,
      ) => Promise<{ ok: boolean; error?: string }>;
      windowControl: (
        action: "minimize" | "toggle-maximize" | "close",
      ) => Promise<{ maximized: boolean }>;
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
  windowFrame: { maximized: false },
  auth: {
    pending: null,
    accounts: {
      chzzk: { configured: false, connected: false, name: "" },
      youtube: { configured: false, connected: false, name: "" },
    },
  },
};
function tc(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
function App() {
  const [state, setState] = useState(empty);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("streamer-assist-theme") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("streamer-assist-theme", theme);
    } catch {}
  }, [theme]);
  const [tab, setTab] = useState("timeline");
  const [title, setTitle] = useState("오늘의 방송");
  const [offset, setOffset] = useState(0);
  const [label, setLabel] = useState("");
  const [question, setQuestion] = useState("다음엔 어떤 게임을 할까요?");
  const [options, setOptions] = useState("마인크래프트\n리그 오브 레전드");
  const [mode, setMode] = useState("native");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
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
  async function controlWindow(
    action: "minimize" | "toggle-maximize" | "close",
  ) {
    try {
      await window.assist?.windowControl(action);
    } catch {
      setError("창 상태를 변경하지 못했습니다.");
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
      <header className="app-header">
        <button
          className="brand"
          onClick={() => setTab("timeline")}
          aria-label="Streamer Assist 홈"
        >
          <span className="brand-icon">
            <Icon name="activity" size={22} />
          </span>
          <span>
            Streamer <strong>Assist</strong>
          </span>
        </button>
        <nav aria-label="방송 도구">
          {[
            {
              id: "timeline",
              icon: "timeline" as const,
              text: "방송 타임라인",
            },
            { id: "poll", icon: "poll" as const, text: "통합 투표" },
            { id: "settings", icon: "link" as const, text: "플랫폼 연결" },
          ].map(({ id, icon, text }) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon name={icon} size={18} />
              {text}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          {(["chzzk", "youtube"] as const).map((platform) => (
            <button
              className="platform-status"
              key={platform}
              onClick={() => setTab("settings")}
              title={state.connections[platform]}
              aria-label={
                (platform === "chzzk" ? "치지직" : "YouTube") +
                " 연결: " +
                state.connections[platform]
              }
            >
              <PlatformIcon platform={platform} size={18} />
              <span>{platform === "chzzk" ? "치지직" : "YouTube"}</span>
              <i
                className={
                  state.connections[platform] === "연결됨" ? "dot green" : "dot"
                }
              />
            </button>
          ))}
          <span className={state.current ? "live-badge live" : "live-badge"}>
            <i className="dot" />
            {state.demo
              ? "테스트 기록"
              : state.current
                ? "기록 중"
                : "방송 대기"}
          </span>
          <button
            className="icon-button theme-toggle"
            aria-label={
              theme === "dark" ? "밝은 테마로 전환" : "어두운 테마로 전환"
            }
            title={theme === "dark" ? "밝은 테마" : "어두운 테마"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
          </button>
        </div>
        <div className="window-controls" aria-label="창 제어">
          <button
            aria-label="창 최소화"
            title="최소화"
            disabled={!window.assist}
            onClick={() => void controlWindow("minimize")}
          >
            <Icon name="minimize" size={15} />
          </button>
          <button
            aria-label={
              state.windowFrame.maximized ? "창 크기 복원" : "창 최대화"
            }
            title={state.windowFrame.maximized ? "크기 복원" : "최대화"}
            disabled={!window.assist}
            onClick={() => void controlWindow("toggle-maximize")}
          >
            <Icon
              name={state.windowFrame.maximized ? "restore" : "maximize"}
              size={14}
            />
          </button>
          <button
            className="window-close"
            aria-label="창 닫기"
            title="트레이로 닫기"
            disabled={!window.assist}
            onClick={() => void controlWindow("close")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>
      <main>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">STREAMER WORKSPACE</div>
              <h1>
                {tab === "timeline"
                  ? "방송 타임라인"
                  : tab === "poll"
                    ? "통합 투표"
                    : "방송 플랫폼 연결"}
              </h1>
              <p>
                {tab === "timeline"
                  ? "기억할 순간을 남기고, 채팅 속 하이라이트를 찾아보세요."
                  : tab === "poll"
                    ? "치지직 번호 투표와 유튜브 실시간 투표를 한곳에서 관리하세요."
                    : "치지직은 채널 주소로, YouTube는 브라우저 로그인으로 연결하세요."}
              </p>
            </div>
            {tab === "timeline" && (
              <div className="export-actions">
                <button
                  className="secondary"
                  disabled={busy || !session}
                  onClick={() =>
                    call("export", { sessionId: selected || undefined })
                  }
                >
                  <Icon name="export" size={16} /> 기록 내보내기
                </button>
                <button
                  className="secondary json-export"
                  disabled={busy || !session}
                  title="JSON으로 내보내기"
                  aria-label="JSON으로 내보내기"
                  onClick={() =>
                    call("export", {
                      sessionId: selected || undefined,
                      format: "json",
                    })
                  }
                >
                  JSON
                </button>
              </div>
            )}
          </div>
          {(error || state.notice || !window.assist) && (
            <div
              className="notice"
              role="alert"
              title={error || state.notice || "데스크톱 앱에서 실행하세요."}
            >
              {error ||
                state.notice ||
                "브라우저 미리보기입니다. 실제 기록과 트레이 기능은 Electron 앱에서 실행됩니다."}
            </div>
          )}
          {tab === "timeline" && (
            <div className="timeline-page page-body">
              <section className="session-card">
                <div className="session-top">
                  <div>
                    <span className="session-label">
                      <i className={state.current ? "dot green" : "dot"} />
                      {state.current ? "현재 방송" : "방송 세션"}
                    </span>
                    <h2 title={state.current?.title}>
                      {state.current?.title || "방송 기록을 시작하세요"}
                    </h2>
                  </div>
                  <div className="clock-wrap">
                    <span>방송 경과 시간</span>
                    <div className="clock">{elapsed}</div>
                  </div>
                </div>
                {!state.current ? (
                  <div className="start-form">
                    <label className="title-field">
                      방송 제목
                      <input
                        aria-label="방송 제목"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="오늘의 방송"
                        maxLength={120}
                      />
                    </label>
                    <label className="offset-field">
                      이미 방송 중이라면
                      <span className="input-unit">
                        <input
                          aria-label="방송 경과 초"
                          className="offset"
                          type="number"
                          min="0"
                          max="86400"
                          value={offset}
                          onChange={(e) => setOffset(+e.target.value)}
                        />
                        <span>초 경과</span>
                      </span>
                    </label>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        setSelected("");
                        void call("start", { title, offset });
                      }}
                    >
                      <Icon name="play" size={16} /> 방송 기록 시작
                    </button>
                  </div>
                ) : (
                  <div className="record-controls">
                    <div className="key-tip">
                      {(state.shortcut || "CommandOrControl+Shift+F8")
                        .replace("CommandOrControl", "Ctrl")
                        .split("+")
                        .map((key, index) => (
                          <React.Fragment key={key}>
                            {index > 0 && " + "}
                            <kbd>{key}</kbd>
                          </React.Fragment>
                        ))}
                      <span>어떤 창에서도 마커 기록</span>
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => call("stop")}
                    >
                      <Icon name="stop" size={16} /> 기록 종료
                    </button>
                  </div>
                )}
              </section>
              <div className="stats">
                {[
                  {
                    label: "기록한 순간",
                    value: markers.length,
                    icon: "bookmark" as const,
                  },
                  {
                    label: "자동 하이라이트",
                    value: markers.filter((m) => m.kind === "auto").length,
                    icon: "sparkles" as const,
                  },
                  {
                    label: "수집한 채팅",
                    value: state.chatCount,
                    icon: "message" as const,
                  },
                  {
                    label: "최근 10초 반응",
                    value: state.recentCount,
                    icon: "activity" as const,
                  },
                ].map((stat) => (
                  <div className="stat-card" key={stat.label}>
                    <div className="stat-heading">
                      <span>{stat.label}</span>
                      <Icon name={stat.icon} size={18} />
                    </div>
                    <strong>
                      {stat.value.toLocaleString()}
                      <small>개</small>
                    </strong>
                  </div>
                ))}
              </div>
              <div className="columns">
                <section className="panel timeline">
                  <div className="panel-heading">
                    <h2>
                      <Icon name="timeline" size={18} /> 타임라인{" "}
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
                      <Icon name="plus" size={16} /> 마커
                    </button>
                  </div>
                  {!markers.length ? (
                    <div className="empty">
                      <div>
                        <Icon name="timeline" size={32} />
                      </div>
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
                      <h2>
                        <Icon name="sparkles" size={18} /> 하이라이트 감지
                      </h2>
                      <span className={state.current ? "tag auto" : "tag"}>
                        <i className={state.current ? "dot green" : "dot"} />
                        {state.current ? "감지 중" : "대기"}
                      </span>
                    </div>
                    <div className="detector-display">
                      <Icon name="activity" size={38} />
                    </div>
                    <h3>
                      {state.current
                        ? "채팅 속 순간을 찾고 있어요"
                        : "방송 시작과 함께 감지합니다"}
                    </h3>
                    <p>
                      채팅 증가율, 참여자 수, 웃음·감탄 반응으로 편집 후보를
                      발견합니다.
                    </p>
                    <details className="detector-details">
                      <summary>
                        감지 기준 보기
                        <Icon name="arrow" size={14} />
                      </summary>
                      <div className="info-popover">
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
                          감지한 순간의 타임코드와 채팅 반응을 함께 저장합니다.
                          방송 종료 후 편집 후보로 확인하세요.
                        </div>
                      </div>
                    </details>
                  </section>
                </div>
              </div>
            </div>
          )}
          {tab === "poll" && (
            <div className="columns poll-page page-body">
              <section className="panel poll-editor">
                <h2>
                  <Icon name="poll" size={19} /> 새 투표 만들기
                </h2>
                <p className="panel-description">
                  양쪽 플랫폼에 같은 질문을 던져보세요.
                </p>
                <label>
                  질문
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    maxLength={100}
                  />
                </label>
                <label className="options-field">
                  <span>
                    선택지 <small>한 줄에 하나씩, 2~4개</small>
                  </span>
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
                <details className="poll-help">
                  <summary>
                    투표 참여 안내
                    <Icon name="arrow" size={14} />
                  </summary>
                  <div className="info-popover">
                    {" "}
                    <p className="subtle-note">
                      채팅에서는 번호만 입력합니다. 플랫폼별 계정당 첫 표만
                      집계합니다. 서로 다른 플랫폼의 동일인은 식별할 수
                      없습니다. 투표를 만든 뒤 안내를 복사해서 치지직 채팅에
                      올려주세요.
                    </p>
                  </div>
                </details>
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
                  <Icon name="play" size={16} /> 투표 시작
                </button>
              </section>
              <section className="panel poll-result">
                <div className="panel-heading">
                  <h2>
                    <Icon name="poll" size={18} /> 투표 결과
                  </h2>
                  <span className={poll?.active ? "tag auto" : "tag"}>
                    {poll?.active ? "진행 중" : poll ? "종료" : "대기"}
                  </span>
                </div>
                {poll ? (
                  <>
                    <h3 title={poll.question}>{poll.question}</h3>
                    <p className="poll-total">
                      <strong>{total.toLocaleString()}</strong>표 집계
                    </p>
                    <div className="result-legend">
                      <span>
                        <i className="dot green" /> 번호 채팅
                      </span>
                      {poll.mode === "native" && (
                        <span>
                          <i className="dot red" /> YouTube 투표
                        </span>
                      )}
                    </div>
                    <div className="vote-list">
                      {poll.options.map((o, i) => (
                        <div className="result-row" key={i}>
                          <div>
                            <span>
                              <span className="option-number">{i + 1}</span> {o}
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
                            <span
                              className="chat-fill"
                              style={{
                                width:
                                  String(
                                    total ? (poll.counts[i] / total) * 100 : 0,
                                  ) + "%",
                              }}
                            />
                            <span
                              className="youtube-fill"
                              style={{
                                width:
                                  String(
                                    total
                                      ? ((poll.youtubeCounts?.[i] || 0) /
                                          total) *
                                          100
                                      : 0,
                                  ) + "%",
                              }}
                            />
                          </div>
                          <small>
                            번호 채팅 {poll.counts[i]}표
                            {poll.mode === "native" && (
                              <>
                                {" "}
                                · YouTube 투표{" "}
                                {poll.youtubeCounts?.[i] ?? "집계 대기"}
                              </>
                            )}
                          </small>
                        </div>
                      ))}
                      {poll.mode === "native" &&
                        poll.youtubeCounts === null && (
                          <p className="notice">
                            YouTube 집계 대기 중입니다. 방송 채널 소유자로
                            로그인해야 기본 투표의 득표수를 확인할 수 있습니다.
                          </p>
                        )}
                    </div>
                    <div className="poll-actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => call("poll-copy")}
                      >
                        <Icon name="message" size={16} /> 투표 안내 복사
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || !poll.active}
                        onClick={() => call("poll-stop")}
                      >
                        <Icon name="stop" size={16} /> 투표 종료
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty">
                    <div>
                      <Icon name="poll" size={32} />
                    </div>
                    <h3>시청자의 선택을 모아보세요</h3>
                    <p>같은 질문, 같은 선택지로 함께 투표합니다.</p>
                  </div>
                )}
              </section>
            </div>
          )}
          {tab === "settings" && (
            <div className="settings-grid page-body">
              <section className="panel account-card chzzk-account">
                <div className="panel-heading">
                  <div className="platform-heading">
                    <span className="platform-avatar">
                      <PlatformIcon platform="chzzk" size={26} />
                    </span>
                    <div>
                      <h2>치지직</h2>
                      <span title={state.auth.accounts.chzzk.name}>
                        {state.auth.accounts.chzzk.connected
                          ? state.auth.accounts.chzzk.name
                          : "공개 방송 채팅"}
                      </span>
                    </div>
                  </div>
                  <span className="tag auto">채널 주소로 연결</span>
                </div>
                <label>
                  치지직 채널 주소
                  <input
                    aria-label="치지직 채널 주소"
                    value={channelUrl}
                    onChange={(e) => setChannelUrl(e.target.value)}
                    placeholder={
                      state.auth.accounts.chzzk.channelId
                        ? "https://chzzk.naver.com/" +
                          state.auth.accounts.chzzk.channelId
                        : "https://chzzk.naver.com/채널ID"
                    }
                    maxLength={2048}
                  />
                </label>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || !channelUrl.trim()}
                    onClick={() =>
                      call("chzzk-select", { channel: channelUrl })
                    }
                  >
                    <Icon name="link" size={16} /> 치지직 연결
                  </button>
                  {state.auth.accounts.chzzk.connected && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => call("auth-logout", { platform: "chzzk" })}
                    >
                      채널 연결 해제
                    </button>
                  )}
                </div>
                <div className="account-footer">
                  <div
                    className="account-status"
                    title={state.connections.chzzk}
                  >
                    <i
                      className={
                        state.connections.chzzk === "연결됨"
                          ? "dot green"
                          : "dot"
                      }
                    />
                    {state.connections.chzzk}
                  </div>
                  <details className="account-help">
                    <summary>
                      연결 안내
                      <Icon name="arrow" size={12} />
                    </summary>
                    <div className="info-popover">
                      <p>
                        공개 채팅을 로그인 없이 읽습니다. 번호 투표 안내는
                        복사해서 채팅에 올려주세요. 로그인이 필요한 방송은
                        지원하지 않습니다.
                      </p>
                    </div>
                  </details>
                </div>
              </section>
              <section className="panel account-card youtube-account">
                <div className="panel-heading">
                  <div className="platform-heading">
                    <span className="platform-avatar">
                      <PlatformIcon platform="youtube" size={27} />
                    </span>
                    <div>
                      <h2>YouTube</h2>
                      <span title={state.auth.accounts.youtube.name}>
                        {state.auth.accounts.youtube.connected
                          ? state.auth.accounts.youtube.name
                          : "실시간 채팅과 기본 투표"}
                      </span>
                    </div>
                  </div>
                  <span
                    className={
                      state.auth.accounts.youtube.connected
                        ? "tag youtube-tag"
                        : "tag"
                    }
                  >
                    {state.auth.accounts.youtube.connected
                      ? "계정 연결됨"
                      : "계정 미연결"}
                  </span>
                </div>
                <div className="youtube-connect-info">
                  <Icon
                    name={
                      state.auth.accounts.youtube.connected ? "check" : "link"
                    }
                    size={20}
                  />
                  <div>
                    <strong>
                      {state.auth.pending
                        ? "브라우저에서 승인을 기다리고 있어요"
                        : state.auth.accounts.youtube.connected
                          ? "방송 계정이 연결되어 있어요"
                          : "안전한 브라우저 로그인"}
                    </strong>
                    <p>방송 채널 소유자 계정으로 연결하세요.</p>
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="primary youtube-button"
                    disabled={busy || !state.auth.accounts.youtube.configured}
                    onClick={() => call("auth-login", { platform: "youtube" })}
                  >
                    <PlatformIcon platform="youtube" size={18} />
                    {state.auth.pending === "youtube"
                      ? "브라우저에서 로그인 중…"
                      : state.auth.accounts.youtube.connected
                        ? "계정 다시 연결"
                        : "YouTube 로그인"}
                  </button>
                  {state.auth.pending && (
                    <button
                      className="text-button"
                      onClick={() => void window.assist?.call("auth-cancel")}
                    >
                      로그인 취소
                    </button>
                  )}
                  {state.auth.accounts.youtube.connected &&
                    !state.auth.pending && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          call("auth-logout", { platform: "youtube" })
                        }
                      >
                        계정 연결 해제
                      </button>
                    )}
                </div>
                {!state.auth.accounts.youtube.configured && (
                  <p className="config-hint">
                    앱의 YouTube 연결 설정이 준비 중입니다.
                  </p>
                )}
                <div className="account-footer">
                  <div
                    className="account-status"
                    title={state.connections.youtube}
                  >
                    <i
                      className={
                        state.connections.youtube === "연결됨"
                          ? "dot red"
                          : "dot"
                      }
                    />
                    {state.connections.youtube}
                  </div>
                  <details className="account-help">
                    <summary>
                      연결 안내
                      <Icon name="arrow" size={12} />
                    </summary>
                    <div className="info-popover">
                      <p>
                        로그인과 권한 승인은 브라우저에서 진행합니다. 연결한
                        채널과 계정은 다음 실행에도 유지됩니다.
                      </p>
                    </div>
                  </details>
                </div>
              </section>
              <div className="connection-actions">
                <p>방송을 켠 뒤 채팅을 다시 찾을 수 있어요.</p>
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      (!state.auth.accounts.chzzk.connected &&
                        !state.auth.accounts.youtube.connected)
                    }
                    onClick={() => call("connect")}
                  >
                    <Icon name="refresh" size={16} /> 방송 채팅 다시 찾기
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => call("disconnect")}
                  >
                    채팅 수집 중지
                  </button>
                </div>
              </div>
              <section className="panel app-settings">
                <div className="app-setting-header">
                  <h2>
                    <Icon name="tray" size={18} /> 백그라운드 실행
                  </h2>
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => call("login-startup", { enabled: true })}
                    >
                      자동 시작 켜기
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => call("login-startup", { enabled: false })}
                    >
                      끄기
                    </button>
                  </div>
                </div>
                <p>창을 닫아도 트레이에서 계속 기록합니다.</p>
              </section>
              <section className="panel app-settings">
                <div className="app-setting-header">
                  <h2>
                    <Icon name="activity" size={18} /> 연결 없이 체험하기
                  </h2>
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={busy || !state.current}
                      onClick={() => call("demo")}
                    >
                      <Icon name="play" size={15} />
                      {state.demo ? "테스트 채팅 끄기" : "테스트 채팅 켜기"}
                    </button>
                  </div>
                </div>
                <p>테스트 채팅으로 하이라이트와 투표를 확인하세요.</p>
              </section>
            </div>
          )}
          <footer>
            <span>
              <Icon name="activity" size={14} /> Streamer Assist{" "}
              <span className="version">v0.1.0</span>
            </span>
            <span>
              <Icon name="tray" size={14} />
              {state.demo
                ? "테스트 채팅 사용 중 · 실제 시청자 데이터가 아닙니다."
                : "창을 닫아도 트레이에서 계속 실행됩니다."}
            </span>
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
