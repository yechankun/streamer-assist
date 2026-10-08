import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Workspace, type WorkspacePageProps } from "./workspace";
import { useTabState } from "./workspace-state";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./presentation.css";
import "./audience.css";
import "./privacy.css";
import { InformationSettings } from "./privacy";
import { ToolsHome, RafflePage, DonationPage } from "./audience";
import type { AudienceState } from "./audience-types";
import { PollPresentation, changeScreen } from "./presentation";
import { RoulettePage, type RouletteImport } from "./roulette";
import { Icon, PlatformIcon } from "./icons";
import { shortcutFromKey, formatShortcut } from "./shortcut";
import { platforms, platformLabel, type Platform, type ParticipationPlatform } from "./platforms";
import { TwitchSettings } from "./twitch-settings";
const TimelineWorkspace = lazy(() => import("./timeline").then(module => ({default: module.TimelineWorkspace})));
const AiSettings = lazy(() => import("./ai-settings").then(module => ({default: module.AiSettings})));
import { HelpTip } from "./help-tip";
import appearance from "../resources/appearance.json";
import { TextSizeControl } from "./text-size-control";
import { PollTimerInput, pollTimerSeconds } from "./poll-timer";
import "./text-size.css";
import type { TimelineSession } from "./timeline-types";
import type { ReplayState } from "./replay";

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
type Session = TimelineSession;
type PollPlatform = ParticipationPlatform;
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
  endsAt?: number | null;
};
export type State = {
  appInfo?: { version: string; distribution: "development" | "msix" | "nsis" };
  audience: AudienceState;
  current: Session | null;
  sessions: Session[];
  poll: Poll | null;
  chatCount: number;
  recentCount: number;
  connections: Record<Platform, string>;
  livePlatforms?: Partial<Record<Platform, boolean>>;
  demo: boolean;
  notice: string;
  shortcut: string;
  monitoring?: { active: boolean; error?: string; platforms: Record<string,{live:boolean|null;error?:string}> };
  recordStorage?: { pending: number; error: string; encrypted: boolean };
  replay?: ReplayState;
  settings: {
    textScale?: number;
    autoRecord?: boolean;
    chatCaptureMode?: "live"|"deferred"|"replay";
    replayAutoAnalyze?: boolean;
    trayEnabled: boolean;
    defaultShortcut: string;
    shortcutCapturing: boolean;
    shortcutRegistered: boolean;
    startupManagedByWindows?: boolean;
    recordsEncrypted?: boolean;
    startupAvailable: boolean;
    openAtLogin: boolean;
  };
  windowFrame: { maximized: boolean };
  auth: {
    pending: string | null;
    twitchDevice?: { userCode: string; expiresAt: number } | null;
    accounts: Record<
      Platform,
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
      workspace: (action: string, payload?: unknown) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
      subscribeWorkspace: (cb: (kind: "state" | "settings" | "error" | "reset-roulette" | "dismiss-menu", value: unknown) => void) => () => void;
      subscribe: (cb: (state: State) => void) => () => void;
      subscribeAiState?: (cb: (state: import("./ai-types").AiState) => void) => () => void;
    };
  }
}
const empty: State = {
  audience: { raffle: null, donationPoll: null },
  current: null,
  sessions: [],
  poll: null,
  chatCount: 0,
  recentCount: 0,
  connections: { youtube: "미연결", chzzk: "미연결", twitch: "미연결" },
  demo: false,
  notice: "",
  shortcut: "",
  settings: {
    trayEnabled: true,
    textScale: appearance.defaultTextScale,
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
      twitch: { configured: false, connected: false, name: "" },
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
function WorkspacePage({ state, tab, instanceId, active, theme, setTheme, openTab, settingsTarget, rouletteImport, rouletteSpinning, resetRoulette }: WorkspacePageProps) {
  const setTab = openTab;
  const youtubeError = state.monitoring?.platforms.youtube?.error;
  const youtubeStatus = youtubeError || state.connections.youtube;
  const [pollView, setPollView] = useTabState<"setup" | "broadcast">("page.pollView", "setup");
  const seenPoll = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== "poll") return;
    const poll = state.poll;
    if (
      poll?.active &&
      poll.id !== seenPoll.current &&
      (poll.mode !== "native" || poll.youtubeId)
    ) {
      const timer = setTimeout(() => {
        seenPoll.current = poll.id;
        changeScreen(() => setPollView("broadcast"));
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [tab, state.poll?.id, state.poll?.active, state.poll?.youtubeId]);
  const [title, setTitle] = useTabState("page.title", "오늘의 방송");
  const [offset, setOffset] = useTabState("page.offset", 0);
  const [label, setLabel] = useTabState("page.label", "");
  const [question, setQuestion] = useTabState("page.question", "");
  const [options, setOptions] = useTabState<{ id: number; text: string }[]>("page.options", []);
  const nextOptionId = useRef(Math.max(0, ...options.map(option => option.id)) + 1);
  const optionDraftRef = useRef<HTMLInputElement>(null);
  const [optionDraft, setOptionDraft] = useTabState("page.optionDraft", "");
  const [pollTimerEnabled, setPollTimerEnabled] = useTabState("page.pollTimerEnabled", false);
  const [pollMinutes, setPollMinutes] = useTabState("page.pollMinutes", "1");
  const [pollSeconds, setPollSeconds] = useTabState("page.pollSeconds", "0");
  const timerSeconds = pollTimerSeconds(pollTimerEnabled, pollMinutes, pollSeconds);
  useEffect(() => {
    if (tab !== "poll" || !state.poll) return;
    const duration = state.poll.endsAt && state.poll.openedAt
      ? Math.round((state.poll.endsAt - state.poll.openedAt) / 1000) : 60;
    setPollTimerEnabled(!!state.poll.endsAt);
    setPollMinutes(String(Math.floor(duration / 60)));
    setPollSeconds(String(duration % 60));
  }, [tab, state.poll?.id]);
  const [optionError, setOptionError] = useState("");
  const [settingsSection, setSettingsSection] = useState("general");
  const [aiSettingsPage, setAiSettingsPage] = useState<"connections" | "assignments">("connections");
  const [aiSettingsTarget, setAiSettingsTarget] = useState<string>();
  const [capturing, setCapturing] = useState(false);
  const capturePending = useRef(false);
  const captureButtonRef = useRef<HTMLButtonElement>(null);
  const [pollPlatforms, setPollPlatforms] = useTabState("page.pollPlatforms", {
    chzzk: true,
    youtube: true,
    twitch: true,
  });
  const [chatPrefix, setChatPrefix] = useTabState("page.chatPrefix", () => {
    try {
      const saved = localStorage.getItem("streamer-assist-vote-prefix");
      return saved !== null && validVotePrefix(saved) ? saved : "!투표";
    } catch {
      return "!투표";
    }
  });
  const [youtubeMethod, setYoutubeMethod] = useTabState<"chat" | "native">("page.youtubeMethod", () => {
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
    if (tab !== "poll") return;
    try {
      if (validVotePrefix(chatPrefix))
        localStorage.setItem("streamer-assist-vote-prefix", chatPrefix);
      localStorage.setItem(
        "streamer-assist-youtube-poll-method",
        youtubeMethod,
      );
    } catch {}
  }, [tab, chatPrefix, youtubeMethod]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useTabState("page.selected", "");
  const [channelUrl, setChannelUrl] = useState("");
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
    if (!active || tab !== "settings" || settingsSection !== "general")
      setCapturing(false);
  }, [active, tab, settingsSection]);
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
  useEffect(() => {
    if (tab !== "settings") return;
    setSettingsSection(settingsTarget.section || "general");
    setAiSettingsPage(settingsTarget.aiPage || "connections");
    setAiSettingsTarget(settingsTarget.aiTarget);
  }, [settingsTarget.revision, tab]);
  function openSettings(section = "general") {
    openTab("settings", { section });
  }
  function sendToRoulette(title: string, items: { name: string; weight: number }[]) {
    void window.assist?.workspace("roulette-import", { source: instanceId, title, items });
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
  const availablePlatforms = platforms.filter(
    (platform) => state.auth.accounts[platform].connected,
  );
  const selectedPlatforms: PollPlatform[] = state.demo
    ? ["demo"]
    : availablePlatforms.filter((platform) => state.livePlatforms?.[platform] === true && pollPlatforms[platform]);
  const pollTargets: PollPlatform[] =
    poll?.platforms ||
    (poll?.mode === "demo" ? ["demo"] : ["chzzk", "youtube"]);
  const chatTargets = pollTargets.filter((platform): platform is Platform =>
    platform !== "demo" && (platform !== "youtube" || poll?.mode === "chat"),
  );
  const hasChatVotes = !!poll && (poll.mode === "demo" || chatTargets.length > 0);
  const hasYoutubePoll =
    poll?.mode === "native" && pollTargets.includes("youtube");
  const chatVoteLabel =
    poll?.mode === "demo"
      ? "테스트 채팅"
      : chatTargets.length === 1 ? platformLabel(chatTargets[0]) + " 채팅" : "채팅 투표";
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
      sendToRoulette(poll.question, poll.options.map((name, index) => ({ name, weight: combined[index] })));
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
      timerSeconds,
    });
  }

  return (
    <main hidden={!active} data-workspace-page={tab} data-workspace-instance={instanceId}>
        <div
          className={
            "content" +
            (broadcastView || ["home", "raffle", "donation"].includes(tab)
              ? " broadcast-content"
              : "")
          }
        >
          {!broadcastView && ["timeline", "poll", "settings"].includes(tab) && (
            <div className="page-heading">
              <div>
                <h1>
                  {tab === "timeline"
                    ? "방송 타임라인"
                    : tab === "poll"
                      ? "숫자 투표"
                      : tab === "roulette"
                        ? "룰렛"
                        : "설정"}
                </h1>
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
            <Suspense fallback={<div className="empty-state" role="status">방송 기록 화면을 준비하고 있습니다.</div>}><TimelineWorkspace current={state.current} session={session} sessions={state.sessions}
              chatCount={state.chatCount} recentCount={state.recentCount} autoRecord={state.settings.autoRecord ?? true}
              monitoring={state.monitoring} recordStorage={state.recordStorage} replayState={state.replay} busy={busy} shortcut={state.shortcut}
              selected={selected} onSelect={setSelected} onAction={call} demo={state.demo}
              onAiSettings={functionId => openTab("settings", { section: "ai", aiPage: "assignments", aiTarget: functionId })}/></Suspense>
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
                      {optionError}
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
                      title="Enter로 선택지 추가"
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
                  <span>참여 플랫폼</span>
                  <div className="poll-platform-buttons">
                    {state.demo || (poll?.active && poll.mode === "demo") ? (
                      <span className="test-poll-target">
                        <Icon name="activity" size={16} /> 테스트 채팅
                      </span>
                    ) : availablePlatforms.length ? (
                      availablePlatforms.map((platform) => {
                        const live = state.livePlatforms?.[platform] === true;
                        const enabled = live && (poll?.active
                          ? pollTargets.includes(platform)
                          : pollPlatforms[platform]);
                        return (
                          <button
                            key={platform}
                            className={"poll-platform-toggle " + platform}
                            data-platform={platform}
                            aria-label={
                              platformLabel(platform) +
                              " 투표 사용"
                            }
                            aria-pressed={enabled}
                            title={live ? state.connections[platform] : "방송이 켜져 있을 때 선택할 수 있습니다."}
                            disabled={busy || !!poll?.active || !live}
                            onClick={() =>
                              setPollPlatforms((previous) => ({
                                ...previous,
                                [platform]: !previous[platform],
                              }))
                            }
                          >
                            <PlatformIcon platform={platform} size={18} />
                            <span>
                              {platformLabel(platform)}
                            </span>
                            {enabled && <Icon name="check" size={13} />}
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
                  {(state.demo || (poll?.active && poll.mode === "demo") || (availablePlatforms.length > 0 && (!selectedPlatforms.length || !selectedReady))) && <small className="poll-platform-hint">
                    {state.demo || (poll?.active && poll.mode === "demo")
                      ? "테스트 채팅으로만 집계합니다."
                      : !selectedPlatforms.length
                          ? "투표에 사용할 플랫폼을 켜세요."
                          : "선택한 플랫폼의 채팅 연결 대기 중"}
                  </small>}
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
                <PollTimerInput
                  enabled={pollTimerEnabled} minutes={pollMinutes} seconds={pollSeconds}
                  onEnabled={setPollTimerEnabled} onMinutes={setPollMinutes} onSeconds={setPollSeconds}
                  disabled={busy || !!poll?.active}
                />
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !state.current ||
                    Number.isNaN(timerSeconds) ||
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
                          {hasChatVotes && hasYoutubePoll && <small>
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
                          </small>}
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
                    <h3>진행 중인 투표가 없습니다</h3>
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
                <button role="tab" aria-selected={settingsSection === "capture"} aria-controls="settings-capture" onClick={() => setSettingsSection("capture")}><Icon name="timeline" size={16} /> 방송 기록</button>
                <button role="tab" aria-selected={settingsSection === "ai"} aria-controls="settings-ai" onClick={() => { setAiSettingsPage("connections"); setAiSettingsTarget(undefined); setSettingsSection("ai"); }}><Icon name="activity" size={16} /> AI 연결</button>
                <button
                  role="tab"
                  aria-selected={settingsSection === "info"}
                  aria-controls="settings-info"
                  onClick={() => setSettingsSection("info")}
                >
                  <Icon name="info" size={16} /> 정보·데이터
                </button>
              </div>
              {settingsSection === "capture" && <section id="settings-capture" className="panel" style={{padding:20,overflow:"auto",minHeight:0}} role="tabpanel" aria-label="방송 기록 설정"><h2>방송 기록과 채팅 수집</h2>                      <div className="setting-row"><div><strong>채팅 수집 방식</strong><p>다음 방송부터 적용 · 투표·추첨·시청자 수는 유지합니다.</p></div><select aria-label="채팅 수집 방식" disabled={busy} value={state.settings.chatCaptureMode||"live"} onChange={e=>void call("capture-mode-set",{mode:e.target.value,autoAnalyze:state.settings.replayAutoAnalyze===true})}><option value="live">실시간 저장·분석</option><option value="deferred">실시간 원본 저장 · 종료 후 분석</option><option value="replay">실시간 기능만 · 종료 후 다시보기 수집</option></select></div>
                      <div className="setting-row"><div><strong>종료 후 통계·하이라이트 자동 계산</strong><p>원본 또는 가져온 다시보기 채팅으로 계산합니다.</p></div><button className="switch" role="switch" aria-label="종료 후 자동 채팅 분석" aria-checked={state.settings.replayAutoAnalyze===true} disabled={busy} onClick={()=>void call("capture-mode-set",{mode:state.settings.chatCaptureMode||"live",autoAnalyze:!state.settings.replayAutoAnalyze})}><span/></button></div><p style={{fontSize:12,color:"var(--muted)",lineHeight:1.7}}>다시보기 수집 모드에서는 방송 중 채팅 원문을 저장하지 않습니다. 투표·추첨·마커와 시청자 수 기록은 유지하며, 방송 종료 후 타임라인의 다시보기 수집에서 영상을 선택할 수 있습니다. 영상과 채팅이 제공되는 범위만 가져옵니다.</p></section>}
              {settingsSection === "ai" && <Suspense fallback={<div className="empty-state" role="status">AI 설정을 준비하고 있습니다.</div>}><AiSettings initialPage={aiSettingsPage} initialFunctionId={aiSettingsTarget} /></Suspense>}
              {settingsSection === "info" && (
                <InformationSettings
                  appVersion={state.appInfo?.version || "0.3.0"}
                  encrypted={state.settings.recordsEncrypted ?? false}
                  canClearHistory={
                    !state.current &&
                    !state.poll?.active &&
                    !state.audience?.raffle?.active &&
                    !state.audience?.donationPoll?.active &&
                    !(
                      state.audience?.raffle?.latestDraw &&
                      state.audience.raffle.latestDraw.endsAt > Date.now()
                    )
                  }
                  rouletteSpinning={rouletteSpinning}
                  busy={busy}
                  onClearHistory={async () => {
                    const success = await call("history-clear", {
                      confirm: true,
                    });
                    if (success) setSelected("");
                    return success;
                  }}
                  onResetRoulette={() => {
                    if (rouletteSpinning) return;
                    resetRoulette();
                  }}
                  onOpenPrivacy={() => void call("privacy-open")}
                  onSupport={() => void call("support-open")}
                />
              )}
              {settingsSection !== "info" && settingsSection !== "ai" && settingsSection !== "capture" &&
                (settingsSection === "general" ? (
                  <div
                    className="general-settings"
                    id="settings-general"
                    role="tabpanel"
                    aria-label="일반 설정"
                  >
                    <section className="panel shortcut-settings">
                      <div className="panel-heading">
                        <h2>
                          <Icon name="bookmark" size={18} /> 타임라인 기록
                          단축키
                        </h2>
                        <span
                          className={
                            state.settings.shortcutRegistered
                              ? "tag auto"
                              : "tag"
                          }
                        >
                          {capturing
                            ? "키 입력 대기"
                            : state.settings.shortcutRegistered
                              ? "사용 가능"
                              : "등록 필요"}
                        </span>
                      </div>
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
                                state.shortcut ||
                                  state.settings.defaultShortcut,
                              )}
                        </span>
                        <span>
                          {capturing ? "Esc로 취소" : "클릭해서 변경"}
                        </span>
                      </button>
                      <div className="shortcut-bottom">
                        <HelpTip label="기록 단축키 안내">다른 창에서도 마커를 기록합니다. Ctrl·Alt·Shift·Win 조합 또는 F1~F24를 지정할 수 있습니다.</HelpTip>
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
                        <div><strong>자동 방송 감지</strong><p>하나라도 방송이 켜지면 기록하고, 모두 종료되면 저장합니다.</p></div>
                        <button className="switch" role="switch" aria-label="설정 자동 방송 감지" aria-checked={state.settings.autoRecord ?? true}
                          disabled={busy} onClick={()=>void call("auto-record-set",{enabled:!(state.settings.autoRecord ?? true)})}><span/></button>
                      </div>
                      <div className="setting-row">
                        <div>
                          <strong>시스템 트레이 사용 <HelpTip label="창 닫기와 트레이 안내">분리 창을 닫으면 열린 탭은 기본 창으로 돌아갑니다. 트레이를 사용하거나 다른 창이 열려 있으면 기본 창은 숨겨집니다. 트레이 없이 기본 창만 남아 있으면 닫을 때 앱이 종료됩니다.</HelpTip></strong>
                          <p>
                            {state.settings.trayEnabled ? "기본 창을 닫아도 계속 실행" : "다른 창이 없으면 기본 창을 닫을 때 종료"}
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
                            {state.settings.startupManagedByWindows
                              ? "Windows 시작 앱 설정에서 켜거나 끌 수 있습니다."
                              : state.settings.startupAvailable
                                ? ""
                                : "설치 버전에서 사용할 수 있습니다."}
                          </p>
                        </div>
                        {state.settings.startupManagedByWindows ? (
                          <button
                            className="secondary startup-system-button"
                            onClick={() => void call("startup-settings")}
                          >
                            Windows 설정 열기
                          </button>
                        ) : (
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
                        )}
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
                      <TextSizeControl value={state.settings.textScale ?? appearance.defaultTextScale} disabled={busy || !window.assist} onCommit={scale => void call("text-scale-set", { scale })} />
                    </section>
                    <section className="panel demo-settings">
                      <h2>
                        <Icon name="activity" size={18} /> 연결 없이 체험하기
                      </h2>
                      <p>
                        테스트 채팅으로 하이라이트 감지와 투표를 확인하세요.
                      </p>
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
                          채팅 · {state.connections.chzzk}
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
                      {!state.auth.accounts.youtube.connected && <div className="youtube-connect-info">
                        <Icon name="link" size={20} />
                        <div>
                          <p>방송 채널 소유자 계정으로 연결하세요.</p>
                        </div>
                      </div>}
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
                        {state.auth.pending === "youtube" && (
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
                          title={youtubeStatus}
                        >
                          <i
                            className={
                              !youtubeError && state.connections.youtube === "연결됨"
                                ? "dot red"
                                : "dot"
                            }
                          />
                          {youtubeError ? "방송 확인" : "채팅"} · {youtubeStatus}
                        </div>
                        <details className="account-help">
                          <summary>
                            연결 안내
                            <Icon name="arrow" size={12} />
                          </summary>
                          <div className="info-popover">
                            <p>
                              로그인과 권한 승인은 브라우저에서 진행합니다.
                              연결한 채널과 계정은 다음 실행에도 유지됩니다.
                            </p>
                          </div>
                        </details>
                      </div>
                    </section>
                    <TwitchSettings
                      account={state.auth.accounts.twitch}
                      status={state.connections.twitch}
                      pending={state.auth.pending}
                      device={state.auth.twitchDevice}
                      busy={busy}
                      onLogin={() => void call("auth-login", { platform: "twitch" })}
                      onCancel={() => void window.assist?.call("auth-cancel")}
                      onLogout={() => void call("auth-logout", { platform: "twitch" })}
                    />
                    <div className="connection-actions">
                      <div className="actions">
                        <button
                          className="secondary"
                          disabled={
                            busy ||
                            !platforms.some((platform) => state.auth.accounts[platform].connected)
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
                ))}
              <footer className="settings-credit">
                <span>Special Thanks to</span>{" "}
                <a href="https://www.youtube.com/@mo_ve_" target="_blank" rel="noopener noreferrer"
                  onClick={event => { if (window.assist) { event.preventDefault(); void call("thanks-open"); } }}>모베</a>
              </footer>
            </div>
          )}
          {tab === "home" && (
            <ToolsHome
              onOpen={(id) => changeScreen(() => setTab(id))}
              onSettings={() => openSettings("platforms")}
              recording={!!state.current}
              title={state.current?.title || ""}
              elapsed={elapsed}
              markers={state.current?.markers || []}
              demo={state.demo}
              activities={{
                raffle: {
                  active: !!state.audience?.raffle?.active,
                  label: state.audience?.raffle?.active
                    ? "모집 중"
                    : "시작하기",
                },
                poll: {
                  active: !!poll?.active,
                  label: poll?.active ? "투표 중" : "시작하기",
                },
                donation: {
                  active: !!state.audience?.donationPoll?.active,
                  label: state.audience?.donationPoll?.active
                    ? "투표 중"
                    : "시작하기",
                },
                roulette: {
                  active: rouletteSpinning,
                  label: rouletteSpinning ? "회전 중" : "시작하기",
                },
              }}
            />
          )}
          {tab === "raffle" && <RafflePage
            active={active}
            raffle={state.audience?.raffle || null}
            available={availablePlatforms}
            livePlatforms={state.livePlatforms || {}}
            connections={state.connections}
            demo={state.demo}
            onSettings={() => openSettings("platforms")}
          />}
          {tab === "donation" && <DonationPage
            active={active}
            poll={state.audience?.donationPoll || null}
            available={availablePlatforms}
            livePlatforms={state.livePlatforms || {}}
            connections={state.connections}
            demo={state.demo}
            onSettings={() => openSettings("platforms")}
            canRoulette={!rouletteSpinning}
            onRoulette={(title, items) =>
              changeScreen(() => {
                if (rouletteSpinning) return;
                sendToRoulette(title, items);
              })
            }
          />}
          {tab === "roulette" && <RoulettePage
            active={active}
            imported={rouletteImport}
            canImport={canImportPoll}
            onImport={importPoll}
            onSpinningChange={() => {}}
          />}
          {state.demo && <footer className="demo-status"><span><Icon name="activity" size={14} /> 테스트 데이터 · 실제 집계가 아닙니다.</span></footer>}
        </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Workspace empty={empty} Page={WorkspacePage} />
  </React.StrictMode>,
);
