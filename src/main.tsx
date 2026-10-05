import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./presentation.css";
import { PollPresentation, changeScreen } from "./presentation";
import { RoulettePage, type RouletteImport } from "./roulette";
import { Icon, PlatformIcon } from "./icons";
import { shortcutFromKey, formatShortcut } from "./shortcut";

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
type PollPlatform = "chzzk" | "youtube" | "demo";
type Poll = {
  id: string;
  question: string;
  options: string[];
  counts: number[];
  youtubeCounts: number[] | null;
  active: boolean;
  mode: string;
  platforms?: PollPlatform[];
  chatPrefix?: string;
  votePolicy?: "first" | "latest";
  youtubeId?: string;
  openedAt?: number;
  closedAt?: number;
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
  settings: {
    trayEnabled: boolean;
    defaultShortcut: string;
    shortcutCapturing: boolean;
    shortcutRegistered: boolean;
    startupAvailable: boolean;
    openAtLogin: boolean;
  };
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
      ) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
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
  settings: {
    trayEnabled: true,
    defaultShortcut: "",
    shortcutCapturing: false,
    shortcutRegistered: false,
    startupAvailable: false,
    openAtLogin: false,
  },
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
function validVotePrefix(prefix: string) {
  return (
    prefix.length <= 12 &&
    !/^\s/.test(prefix) &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(prefix)
  );
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
  const [pollView, setPollView] = useState<"setup" | "broadcast">("setup");
  const [rouletteSpinning, setRouletteSpinning] = useState(false);
  const [rouletteImport, setRouletteImport] = useState<RouletteImport | null>(
    null,
  );
  const seenPoll = useRef<string | null>(null);
  useEffect(() => {
    const poll = state.poll;
    if (
      poll?.active &&
      poll.id !== seenPoll.current &&
      (poll.mode !== "native" || poll.youtubeId)
    ) {
      const frame = requestAnimationFrame(() => {
        seenPoll.current = poll.id;
        changeScreen(() => setPollView("broadcast"));
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [state.poll?.id, state.poll?.active, state.poll?.youtubeId]);
  const [title, setTitle] = useState("오늘의 방송");
  const [offset, setOffset] = useState(0);
  const [label, setLabel] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<{ id: number; text: string }[]>([]);
  const nextOptionId = useRef(1);
  const optionDraftRef = useRef<HTMLInputElement>(null);
  const [optionDraft, setOptionDraft] = useState("");
  const [optionError, setOptionError] = useState("");
  const [settingsSection, setSettingsSection] = useState("general");
  const [capturing, setCapturing] = useState(false);
  const capturePending = useRef(false);
  const captureButtonRef = useRef<HTMLButtonElement>(null);
  const [pollPlatforms, setPollPlatforms] = useState({
    chzzk: true,
    youtube: true,
  });
  const [chatPrefix, setChatPrefix] = useState(() => {
    try {
      const saved = localStorage.getItem("streamer-assist-vote-prefix");
      return saved !== null && validVotePrefix(saved) ? saved : "!투표";
    } catch {
      return "!투표";
    }
  });
  const [youtubeMethod, setYoutubeMethod] = useState<"chat" | "native">(() => {
    try {
      return localStorage.getItem("streamer-assist-youtube-poll-method") ===
        "native"
        ? "native"
        : "chat";
    } catch {
      return "chat";
    }
  });
  useEffect(() => {
    try {
      if (validVotePrefix(chatPrefix))
        localStorage.setItem("streamer-assist-vote-prefix", chatPrefix);
      localStorage.setItem(
        "streamer-assist-youtube-poll-method",
        youtubeMethod,
      );
    } catch {}
  }, [chatPrefix, youtubeMethod]);
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
  useEffect(() => {
    if (!capturing) return;
    const cancel = () => {
      setCapturing(false);
    };
    const handleKey = async (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        cancel();
        return;
      }
      if (capturePending.current) return;
      try {
        const shortcut = shortcutFromKey(event);
        if (!shortcut) return;
        capturePending.current = true;
        setCapturing(false);
        await call("shortcut-set", { shortcut });
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "단축키를 인식하지 못했습니다.",
        );
      } finally {
        capturePending.current = false;
      }
    };
    window.addEventListener("keydown", handleKey, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("blur", cancel);
      void window.assist?.call("shortcut-cancel");
    };
  }, [capturing]);
  useEffect(() => {
    if (tab !== "settings" || settingsSection !== "general")
      setCapturing(false);
  }, [tab, settingsSection]);
  useEffect(() => {
    if (!state.settings.shortcutCapturing) setCapturing(false);
  }, [state.settings.shortcutCapturing]);
  async function beginShortcutCapture() {
    setError("");
    const result = await window.assist?.call("shortcut-capture");
    if (!result?.ok) {
      setError(result?.error || "단축키 입력을 시작하지 못했습니다.");
      return;
    }
    setCapturing(true);
    captureButtonRef.current?.focus();
  }
  function openSettings(section = "general") {
    setSettingsSection(section);
    setTab("settings");
  }
  function addOption() {
    const text = optionDraft.trim();
    if (!text || options.length >= 4) return;
    if (options.some((option) => option.text.trim() === text)) {
      setOptionError("같은 선택지가 이미 있습니다.");
      optionDraftRef.current?.focus();
      return;
    }
    setOptions([...options, { id: nextOptionId.current++, text }]);
    setOptionDraft("");
    setOptionError("");
    requestAnimationFrame(() => optionDraftRef.current?.focus());
  }
  async function call(action: string, payload?: unknown) {
    if (!window.assist) {
      setError("데스크톱 앱에서 실행하세요. npm run dev");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const result = await window.assist.call(action, payload);
      if (!result.ok) setError(result.error || "요청 실패");
      return result.ok;
    } catch {
      setError("앱과 통신하지 못했습니다.");
      return false;
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
  const availablePlatforms = (["chzzk", "youtube"] as const).filter(
    (platform) => state.auth.accounts[platform].connected,
  );
  const selectedPlatforms: PollPlatform[] = state.demo
    ? ["demo"]
    : availablePlatforms.filter((platform) => pollPlatforms[platform]);
  const pollTargets =
    poll?.platforms ||
    (poll?.mode === "demo" ? ["demo"] : ["chzzk", "youtube"]);
  const hasChatVotes =
    !!poll &&
    (poll.mode === "demo" ||
      pollTargets.includes("chzzk") ||
      (poll.mode === "chat" && pollTargets.includes("youtube")));
  const hasYoutubePoll =
    poll?.mode === "native" && pollTargets.includes("youtube");
  const chatVoteLabel =
    poll?.mode === "demo"
      ? "테스트 채팅"
      : pollTargets.includes("chzzk") &&
          pollTargets.includes("youtube") &&
          poll?.mode === "chat"
        ? "채팅 투표"
        : pollTargets.includes("chzzk")
          ? "치지직 채팅"
          : "YouTube 채팅";
  const selectedReady =
    state.demo ||
    selectedPlatforms.every(
      (platform) =>
        platform !== "demo" && state.connections[platform] === "연결됨",
    );
  const displayedPrefix = poll?.active ? (poll.chatPrefix ?? "") : chatPrefix;
  const displayedYoutubeMethod = poll?.active
    ? poll.mode === "native"
      ? "native"
      : "chat"
    : youtubeMethod;
  const voteCommands = [1, 2]
    .map((number) => displayedPrefix + number)
    .join(" · ");
  const prefixValid = validVotePrefix(chatPrefix);
  const combined =
    poll?.counts.map(
      (n, i) =>
        (hasChatVotes ? n : 0) +
        (hasYoutubePoll ? poll.youtubeCounts?.[i] || 0 : 0),
    ) || [];
  const total = combined.reduce((a, b) => a + b, 0);
  const nativePending = !!hasYoutubePoll && poll?.youtubeCounts === null;
  const canImportPoll =
    !!poll && !poll.active && total > 0 && !nativePending && !rouletteSpinning;
  const broadcastView = tab === "poll" && pollView === "broadcast" && !!poll;
  const visibleNotice =
    broadcastView &&
    /^(투표가 시작됐습니다|YouTube 실시간 투표가 시작됐습니다|투표 안내를 복사했습니다)/.test(
      state.notice,
    )
      ? ""
      : state.notice;

  function importPoll() {
    if (!poll || !canImportPoll) return;
    changeScreen(() => {
      setRouletteImport({
        id: crypto.randomUUID(),
        title: poll.question,
        items: poll.options.map((name, index) => ({
          name,
          weight: combined[index],
        })),
      });
      setTab("roulette");
    });
  }
  function newPoll() {
    changeScreen(() => {
      setQuestion("");
      setOptions([]);
      setOptionDraft("");
      setOptionError("");
      setPollView("setup");
    });
  }
  async function startPoll() {
    await call("poll-start", {
      question,
      options: options.map((option) => option.text.trim()),
      platforms: selectedPlatforms,
      chatPrefix,
      youtubeMethod,
    });
  }

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
            { id: "roulette", icon: "roulette" as const, text: "룰렛" },
            { id: "settings", icon: "settings" as const, text: "설정" },
          ].map(({ id, icon, text }) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              aria-current={tab === id ? "page" : undefined}
              onClick={() =>
                changeScreen(() =>
                  id === "settings" ? openSettings() : setTab(id),
                )
              }
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
              onClick={() => openSettings("platforms")}
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
            title={state.settings.trayEnabled ? "트레이로 닫기" : "앱 종료"}
            disabled={!window.assist}
            onClick={() => void controlWindow("close")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>
      <main>
        <div
          className={"content" + (broadcastView ? " broadcast-content" : "")}
        >
          {!broadcastView && tab !== "roulette" && (
            <div className="page-heading">
              <div>
                <div className="eyebrow">STREAMER WORKSPACE</div>
                <h1>
                  {tab === "timeline"
                    ? "방송 타임라인"
                    : tab === "poll"
                      ? "통합 투표"
                      : tab === "roulette"
                        ? "룰렛"
                        : "설정"}
                </h1>
                <p>
                  {tab === "timeline"
                    ? "기억할 순간을 남기고, 채팅 속 하이라이트를 찾아보세요."
                    : tab === "poll"
                      ? "치지직·YouTube의 채팅 투표와 기본 투표를 한곳에서 관리하세요."
                      : tab === "roulette"
                        ? "항목과 확률을 정하고, 룰렛으로 다음 선택을 골라보세요."
                        : "기록 단축키, 앱 실행 방식과 방송 플랫폼을 관리하세요."}
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
          )}
          {(error || visibleNotice || !window.assist) && (
            <div
              className="notice"
              role="alert"
              title={error || visibleNotice || "데스크톱 앱에서 실행하세요."}
            >
              {error ||
                visibleNotice ||
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
                        .replace("Super", "Win")
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
          {broadcastView && poll && (
            <PollPresentation
              poll={poll}
              counts={combined}
              busy={busy}
              nativePending={nativePending}
              canRoulette={canImportPoll}
              sources={[
                ...(hasChatVotes ? [chatVoteLabel] : []),
                ...(hasYoutubePoll ? ["YouTube 기본 투표"] : []),
              ]}
              onCopy={() => void call("poll-copy")}
              onStop={() => void call("poll-stop")}
              onSetup={() => changeScreen(() => setPollView("setup"))}
              onNew={newPoll}
              onRoulette={importPoll}
            />
          )}
          {tab === "poll" && !broadcastView && (
            <div className="columns poll-page page-body screen-enter">
              <section className="panel poll-editor">
                <h2>
                  <Icon name="poll" size={19} /> 새 투표 만들기
                </h2>
                <p className="panel-description">
                  질문과 선택지를 만들고 참여할 플랫폼을 켜세요.
                </p>
                <label>
                  질문
                  <input
                    aria-label="투표 질문"
                    placeholder="예: 다음엔 어떤 게임을 할까요?"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    maxLength={100}
                  />
                </label>
                <div
                  className="options-field"
                  role="group"
                  aria-label="투표 선택지"
                >
                  <div className="options-heading">
                    <span>
                      선택지 <small>{options.length}/4 · 최소 2개</small>
                    </span>
                    <span className="option-hint" role="status">
                      {optionError ||
                        (options.length === 4
                          ? "최대 4개까지 추가할 수 있어요"
                          : "추가 버튼 또는 Enter")}
                    </span>
                  </div>
                  <ol className="option-list">
                    {options.map((option, index) => (
                      <li className="option-row" key={option.id}>
                        <span className="option-number">{index + 1}</span>
                        <input
                          aria-label={"선택지 " + (index + 1)}
                          value={option.text}
                          placeholder="선택지를 입력하세요"
                          maxLength={50}
                          onChange={(event) => {
                            setOptions(
                              options.map((item) =>
                                item.id === option.id
                                  ? { ...item, text: event.target.value }
                                  : item,
                              ),
                            );
                            setOptionError("");
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" &&
                              !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault();
                              optionDraftRef.current?.focus();
                            }
                          }}
                        />
                        <button
                          className="icon-button option-remove"
                          aria-label={"선택지 " + (index + 1) + " 삭제"}
                          title="선택지 삭제"
                          onClick={() => {
                            setOptions(
                              options.filter((item) => item.id !== option.id),
                            );
                            setOptionError("");
                            requestAnimationFrame(() =>
                              optionDraftRef.current?.focus(),
                            );
                          }}
                        >
                          <Icon name="close" size={15} />
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="option-add">
                    <input
                      ref={optionDraftRef}
                      aria-label="새 선택지"
                      placeholder={
                        options.length === 4
                          ? "선택지를 삭제하면 추가할 수 있어요"
                          : "선택지를 입력하세요. 예: 마인크래프트"
                      }
                      value={optionDraft}
                      maxLength={50}
                      readOnly={options.length === 4}
                      onChange={(event) => {
                        setOptionDraft(event.target.value);
                        setOptionError("");
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.nativeEvent.isComposing &&
                          event.nativeEvent.keyCode !== 229
                        ) {
                          event.preventDefault();
                          addOption();
                        }
                      }}
                    />
                    <button
                      className="secondary"
                      aria-label="선택지 추가"
                      disabled={!optionDraft.trim() || options.length >= 4}
                      onClick={addOption}
                    >
                      <Icon name="plus" size={15} /> 추가
                    </button>
                  </div>
                </div>
                <div
                  className="poll-platform-field"
                  role="group"
                  aria-label="투표 플랫폼"
                >
                  <span>투표 플랫폼</span>
                  <div className="poll-platform-buttons">
                    {state.demo || (poll?.active && poll.mode === "demo") ? (
                      <span className="test-poll-target">
                        <Icon name="activity" size={16} /> 테스트 채팅
                      </span>
                    ) : availablePlatforms.length ? (
                      availablePlatforms.map((platform) => {
                        const enabled = poll?.active
                          ? pollTargets.includes(platform)
                          : pollPlatforms[platform];
                        return (
                          <button
                            key={platform}
                            className={"poll-platform-toggle " + platform}
                            data-platform={platform}
                            aria-label={
                              (platform === "chzzk" ? "치지직" : "YouTube") +
                              " 투표 사용"
                            }
                            aria-pressed={enabled}
                            title={state.connections[platform]}
                            disabled={busy || !!poll?.active}
                            onClick={() =>
                              setPollPlatforms((previous) => ({
                                ...previous,
                                [platform]: !previous[platform],
                              }))
                            }
                          >
                            <PlatformIcon platform={platform} size={18} />
                            <span>
                              {platform === "chzzk" ? "치지직" : "YouTube"}
                            </span>
                            <span className="toggle-state">
                              {enabled ? "켜짐" : "꺼짐"}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="poll-connect-guide">
                        <span>연결된 플랫폼이 없습니다.</span>
                        <button
                          className="text-button"
                          onClick={() => openSettings("platforms")}
                        >
                          플랫폼 연결 <Icon name="arrow" size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  <small className="poll-platform-hint">
                    {state.demo || (poll?.active && poll.mode === "demo")
                      ? "테스트 채팅으로만 집계합니다."
                      : !availablePlatforms.length
                        ? "설정에서 플랫폼을 연결하면 버튼이 표시됩니다."
                        : !selectedPlatforms.length
                          ? "투표에 사용할 플랫폼을 켜세요."
                          : !selectedReady
                            ? "선택한 플랫폼의 방송 채팅 연결을 기다리고 있습니다."
                            : selectedPlatforms.includes("chzzk") &&
                                selectedPlatforms.includes("youtube")
                              ? displayedYoutubeMethod === "native"
                                ? "치지직 채팅과 YouTube 기본 투표를 함께 집계합니다."
                                : "치지직과 YouTube의 채팅 명령을 함께 집계합니다."
                              : selectedPlatforms.includes("chzzk")
                                ? "치지직 채팅 명령만 집계합니다."
                                : displayedYoutubeMethod === "native"
                                  ? "YouTube 기본 실시간 투표를 생성합니다."
                                  : "YouTube 채팅 명령만 집계합니다."}
                  </small>
                </div>
                <details className="poll-help vote-format-settings">
                  <summary>
                    <span>
                      투표 방식{" "}
                      <strong className="vote-format-example">
                        {selectedPlatforms.length === 1 &&
                        selectedPlatforms[0] === "youtube" &&
                        displayedYoutubeMethod === "native"
                          ? "YouTube 기본 투표"
                          : voteCommands}
                      </strong>
                    </span>
                    <Icon name="settings" size={15} />
                  </summary>
                  <div className="info-popover vote-format-popover">
                    <h3>채팅 투표 입력</h3>
                    <div
                      className="vote-format-presets"
                      role="group"
                      aria-label="채팅 입력 형식"
                    >
                      <button
                        aria-pressed={displayedPrefix === "!투표"}
                        disabled={busy || !!poll?.active}
                        onClick={() => setChatPrefix("!투표")}
                      >
                        !투표 <small>기본</small>
                      </button>
                      <button
                        aria-pressed={displayedPrefix === "!"}
                        disabled={busy || !!poll?.active}
                        onClick={() => setChatPrefix("!")}
                      >
                        !번호
                      </button>
                      <button
                        aria-pressed={displayedPrefix === ""}
                        disabled={busy || !!poll?.active}
                        onClick={() => setChatPrefix("")}
                      >
                        번호만
                      </button>
                    </div>
                    <label>
                      원하는 접두어
                      <input
                        aria-label="채팅 투표 접두어"
                        value={displayedPrefix}
                        maxLength={12}
                        placeholder="예: !, #, !투표 "
                        disabled={busy || !!poll?.active}
                        onChange={(event) => setChatPrefix(event.target.value)}
                      />
                    </label>
                    <p
                      className={
                        prefixValid
                          ? "vote-command-preview"
                          : "vote-format-error"
                      }
                      title={voteCommands}
                    >
                      {prefixValid
                        ? "입력 예: " + voteCommands
                        : "앞 공백·줄바꿈 없이 12자 이하로 입력하세요."}
                    </p>
                    {availablePlatforms.includes("youtube") && (
                      <div className="youtube-vote-method">
                        <span>YouTube 참여 방식</span>
                        <div
                          className="vote-format-presets"
                          role="group"
                          aria-label="YouTube 참여 방식"
                        >
                          <button
                            aria-pressed={displayedYoutubeMethod === "chat"}
                            disabled={busy || !!poll?.active}
                            onClick={() => setYoutubeMethod("chat")}
                          >
                            채팅 명령
                          </button>
                          <button
                            aria-pressed={displayedYoutubeMethod === "native"}
                            disabled={busy || !!poll?.active}
                            onClick={() => setYoutubeMethod("native")}
                          >
                            기본 투표
                          </button>
                        </div>
                      </div>
                    )}
                    <p className="vote-format-note">
                      채팅 맨 앞에 접두어와 번호를 입력하세요. 둘 사이에 공백을
                      넣어도 됩니다. 접두어를 비우면 번호만 입력합니다.
                      {poll?.active && poll.votePolicy !== "latest"
                        ? " 이 투표는 계정당 첫 표만 집계합니다."
                        : " 계정당 1표이며 다시 입력하면 마지막 선택으로 변경됩니다."}
                      {availablePlatforms.includes("youtube") &&
                        " YouTube 기본 투표는 투표 창에서 선택합니다."}
                      {poll?.active &&
                        " 진행 중인 투표는 입력 방식이 고정됩니다."}
                    </p>
                  </div>
                </details>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !state.current ||
                    !!poll?.active ||
                    !question.trim() ||
                    !prefixValid ||
                    !selectedPlatforms.length ||
                    !selectedReady ||
                    options.length < 2 ||
                    options.some((option) => !option.text.trim()) ||
                    new Set(options.map((option) => option.text.trim()))
                      .size !== options.length ||
                    !!optionDraft.trim()
                  }
                  onClick={() => void startPoll()}
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
                      {hasChatVotes && (
                        <span>
                          <i className="dot green" /> {chatVoteLabel}
                        </span>
                      )}
                      {hasYoutubePoll && (
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
                            {hasChatVotes && (
                              <span
                                className="chat-fill"
                                style={{
                                  width:
                                    String(
                                      total
                                        ? (poll.counts[i] / total) * 100
                                        : 0,
                                    ) + "%",
                                }}
                              />
                            )}
                            {hasYoutubePoll && (
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
                            )}
                          </div>
                          <small>
                            {hasChatVotes && (
                              <>
                                {chatVoteLabel} {poll.counts[i]}표
                              </>
                            )}
                            {hasYoutubePoll && (
                              <>
                                {hasChatVotes && " · "}YouTube 투표{" "}
                                {poll.youtubeCounts?.[i] ?? "집계 대기"}
                              </>
                            )}
                          </small>
                        </div>
                      ))}
                      {hasYoutubePoll && poll.youtubeCounts === null && (
                        <p className="notice">
                          YouTube 집계 대기 중입니다. 방송 채널 소유자로
                          로그인해야 기본 투표의 득표수를 확인할 수 있습니다.
                        </p>
                      )}
                    </div>
                    <div className="poll-actions">
                      <button
                        className="secondary"
                        onClick={() =>
                          changeScreen(() => setPollView("broadcast"))
                        }
                      >
                        <Icon name="maximize" size={16} /> 현황 보기
                      </button>
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
            <div className="settings-page page-body">
              <div
                className="settings-tabs"
                role="tablist"
                aria-label="설정 항목"
              >
                <button
                  role="tab"
                  aria-selected={settingsSection === "general"}
                  aria-controls="settings-general"
                  onClick={() => setSettingsSection("general")}
                >
                  <Icon name="settings" size={16} /> 일반
                </button>
                <button
                  role="tab"
                  aria-selected={settingsSection === "platforms"}
                  aria-controls="settings-platforms"
                  onClick={() => setSettingsSection("platforms")}
                >
                  <Icon name="link" size={16} /> 플랫폼 연결
                </button>
              </div>
              {settingsSection === "general" ? (
                <div
                  className="general-settings"
                  id="settings-general"
                  role="tabpanel"
                  aria-label="일반 설정"
                >
                  <section className="panel shortcut-settings">
                    <div className="panel-heading">
                      <h2>
                        <Icon name="bookmark" size={18} /> 타임라인 기록 단축키
                      </h2>
                      <span
                        className={
                          state.settings.shortcutRegistered ? "tag auto" : "tag"
                        }
                      >
                        {capturing
                          ? "키 입력 대기"
                          : state.settings.shortcutRegistered
                            ? "사용 가능"
                            : "등록 필요"}
                      </span>
                    </div>
                    <p>
                      원하는 키를 직접 눌러 지정하세요. 다른 창에서도 순간을
                      기록합니다.
                    </p>
                    <button
                      ref={captureButtonRef}
                      className={
                        capturing
                          ? "shortcut-recorder recording"
                          : "shortcut-recorder"
                      }
                      aria-label="기록 단축키 변경"
                      aria-pressed={capturing}
                      disabled={busy || !window.assist}
                      onClick={() =>
                        capturing
                          ? setCapturing(false)
                          : void beginShortcutCapture()
                      }
                    >
                      <span>
                        {capturing
                          ? "원하는 단축키를 눌러 주세요"
                          : formatShortcut(
                              state.shortcut || state.settings.defaultShortcut,
                            )}
                      </span>
                      <span>{capturing ? "Esc로 취소" : "클릭해서 변경"}</span>
                    </button>
                    <div className="shortcut-bottom">
                      <small>Ctrl · Alt · Shift · Win 조합 또는 F1~F24</small>
                      <button
                        className="text-button"
                        disabled={busy || capturing}
                        onClick={() =>
                          call("shortcut-set", {
                            shortcut: state.settings.defaultShortcut,
                          })
                        }
                      >
                        기본값 복원
                      </button>
                    </div>
                  </section>
                  <section className="panel behavior-settings">
                    <h2>
                      <Icon name="tray" size={18} /> 앱 실행
                    </h2>
                    <div className="setting-row">
                      <div>
                        <strong>시스템 트레이 사용</strong>
                        <p>
                          {state.settings.trayEnabled
                            ? "창을 닫아도 트레이에서 계속 기록합니다."
                            : "창을 닫으면 앱을 종료하고 기록을 저장합니다."}
                        </p>
                      </div>
                      <button
                        className="switch"
                        role="switch"
                        aria-label="시스템 트레이 사용"
                        aria-checked={state.settings.trayEnabled}
                        disabled={busy}
                        onClick={() =>
                          call("tray-set", {
                            enabled: !state.settings.trayEnabled,
                          })
                        }
                      >
                        <span />
                      </button>
                    </div>
                    <div className="setting-row">
                      <div>
                        <strong>Windows 로그인 시 자동 시작</strong>
                        <p>
                          {state.settings.startupAvailable
                            ? "로그인하면 저장한 실행 설정으로 앱을 엽니다."
                            : "설치 버전에서 사용할 수 있습니다."}
                        </p>
                      </div>
                      <button
                        className="switch"
                        role="switch"
                        aria-label="Windows 로그인 시 자동 시작"
                        aria-checked={state.settings.openAtLogin}
                        disabled={busy || !state.settings.startupAvailable}
                        onClick={() =>
                          call("login-startup", {
                            enabled: !state.settings.openAtLogin,
                          })
                        }
                      >
                        <span />
                      </button>
                    </div>
                  </section>
                  <section className="panel appearance-settings">
                    <h2>
                      <Icon
                        name={theme === "dark" ? "moon" : "sun"}
                        size={18}
                      />{" "}
                      화면 테마
                    </h2>
                    <div
                      className="theme-options"
                      role="group"
                      aria-label="화면 테마"
                    >
                      <button
                        aria-pressed={theme === "dark"}
                        onClick={() => setTheme("dark")}
                      >
                        <Icon name="moon" size={17} /> 다크
                      </button>
                      <button
                        aria-pressed={theme === "light"}
                        onClick={() => setTheme("light")}
                      >
                        <Icon name="sun" size={17} /> 라이트
                      </button>
                    </div>
                    <p>선택한 테마는 다음 실행에도 유지됩니다.</p>
                  </section>
                  <section className="panel demo-settings">
                    <h2>
                      <Icon name="activity" size={18} /> 연결 없이 체험하기
                    </h2>
                    <p>테스트 채팅으로 하이라이트 감지와 투표를 확인하세요.</p>
                    <button
                      className="secondary"
                      disabled={busy || !state.current}
                      onClick={() => call("demo")}
                    >
                      <Icon name={state.demo ? "stop" : "play"} size={15} />
                      {state.demo ? "테스트 채팅 끄기" : "테스트 채팅 켜기"}
                    </button>
                  </section>
                </div>
              ) : (
                <div
                  className="settings-grid"
                  id="settings-platforms"
                  role="tabpanel"
                  aria-label="플랫폼 연결 설정"
                >
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
                          onClick={() =>
                            call("auth-logout", { platform: "chzzk" })
                          }
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
                          state.auth.accounts.youtube.connected
                            ? "check"
                            : "link"
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
                        disabled={
                          busy || !state.auth.accounts.youtube.configured
                        }
                        onClick={() =>
                          call("auth-login", { platform: "youtube" })
                        }
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
                          onClick={() =>
                            void window.assist?.call("auth-cancel")
                          }
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
                </div>
              )}
            </div>
          )}
          <RoulettePage
            active={tab === "roulette"}
            imported={rouletteImport}
            canImport={canImportPoll}
            onImport={importPoll}
            onSpinningChange={setRouletteSpinning}
          />
          <footer>
            <span>
              <Icon name="activity" size={14} /> Streamer Assist{" "}
              <span className="version">v0.1.0</span>
            </span>
            <span>
              <Icon name="tray" size={14} />
              {state.demo
                ? "테스트 채팅 사용 중 · 실제 시청자 데이터가 아닙니다."
                : state.settings.trayEnabled
                  ? "창을 닫아도 트레이에서 계속 실행됩니다."
                  : "트레이 사용 꺼짐 · 창을 닫으면 앱이 종료됩니다."}
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
