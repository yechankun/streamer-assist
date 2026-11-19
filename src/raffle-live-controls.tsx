import { useEffect, useId, useRef, useState } from "react";
import type { AudiencePlatform, RaffleState } from "./audience-types";
import { Icon, PlatformIcon } from "./icons";
import { platformLabel, type Platform } from "./platforms";
import { LiveStageTimer } from "./live-stage";

export type RaffleChanges = Partial<RaffleState["config"] & { title: string }>;
type Configure = (changes: RaffleChanges) => Promise<boolean>;
type Toggle = (field: "subscribersOnly" | "excludeWinners" | "platforms", platform?: AudiencePlatform) => Promise<boolean>;

export function RaffleTitle({ title, disabled, configure }: { title: string; disabled: boolean; configure: Configure }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(title);
  useEffect(() => { if (!editing) setDraft(title); }, [title, editing]);
  return editing ? <input autoFocus className="raffle-inline-title" aria-label="추첨 제목 변경" value={draft} maxLength={100}
    onChange={event => setDraft(event.target.value)} onBlur={() => { setEditing(false); if (draft.trim() !== title) void configure({ title: draft }); }}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(title); setEditing(false); } }} /> :
    <h2><button type="button" className="raffle-title-edit" title="추첨 제목 변경" disabled={disabled} onClick={() => setEditing(true)}><span>{title}</span><Icon name="edit" size={16} /></button></h2>;
}

export function RaffleRuleToggles({ raffle, disabled, configure, toggle }: { raffle: RaffleState; disabled: boolean; configure: Configure; toggle: Toggle }) {
  const { config } = raffle;
  const [keyword, setKeyword] = useState(config.keyword || "!참여");
  const keywordInput = useRef<HTMLInputElement>(null), [focusKeyword, setFocusKeyword] = useState(false);
  useEffect(() => { setKeyword(config.keyword || "!참여"); }, [config.keyword]);
  useEffect(() => {
    if (config.entryMode !== "keyword" || !focusKeyword || disabled) return;
    keywordInput.current?.focus(); keywordInput.current?.select(); setFocusKeyword(false);
  }, [config.entryMode, focusKeyword, disabled]);
  return <div className="raffle-rule-toggles" role="group" aria-label="모집 조건">
    <div className="raffle-entry-toggles" role="group" aria-label="참여 방식">
      <button type="button" aria-pressed={config.entryMode === "any"} disabled={disabled} onClick={() => void configure({ entryMode: "any" })}>아무 채팅</button>
      <button type="button" aria-pressed={config.entryMode === "keyword"} disabled={disabled} onClick={async () => {
        setFocusKeyword(true);
        if (!await configure({ entryMode: "keyword", keyword: keyword.trim() || "!참여" })) setFocusKeyword(false);
      }}>키워드</button>
    </div>
    {config.entryMode === "keyword" && <label className="raffle-keyword-control"><span>참여 키워드</span><input ref={keywordInput} aria-label="실시간 참여 키워드" className="raffle-inline-keyword" maxLength={30} value={keyword} disabled={disabled} placeholder="!참여"
      size={Math.max(6, Math.min(20, [...keyword].reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0)))}
      onChange={event => setKeyword(event.target.value)} onBlur={() => { const value = keyword.trim(); if (value && value !== config.keyword) void configure({ keyword: value }); else setKeyword(config.keyword); }}
      onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.preventDefault(); setKeyword(config.keyword); } }} /><Icon name="edit" size={13} /></label>}
    <div className="raffle-filter-toggles" role="group" aria-label="추첨 대상 조건">
    <button type="button" aria-label="구독자·멤버십만 참여" aria-pressed={config.subscribersOnly} disabled={disabled}
      onClick={() => void toggle("subscribersOnly")}><span className="raffle-check" aria-hidden="true">{config.subscribersOnly && <Icon name="check" size={12}/>}</span>구독자·멤버십만</button>
    <button type="button" aria-label="이미 뽑힌 참여자 제외" aria-pressed={config.excludeWinners} disabled={disabled}
      onClick={() => void toggle("excludeWinners")}><span className="raffle-check" aria-hidden="true">{config.excludeWinners && <Icon name="check" size={12}/>}</span>당첨자 제외</button>
    </div>
  </div>;
}

export function RafflePlatformToggles({ raffle, available, disabled, demo, toggle }: { raffle: RaffleState; available: Platform[]; disabled: boolean; demo: boolean; toggle: Toggle }) {
  if (!demo && (!available.length || raffle.config.platforms.includes("demo") || raffle.dataPlatforms?.includes("demo") || raffle.candidates.some(p => p.platform === "demo"))) return null;
  const platforms: AudiencePlatform[] = demo ? ["demo"] : available;
  return <div className="raffle-platform-toggles" role="group" aria-label="추첨 대상 플랫폼">
    {platforms.map(platform => <button key={platform} type="button" className={"icon-button " + platform} aria-label={(platform === "demo" ? "테스트" : platformLabel(platform)) + " 추첨 대상"}
      aria-pressed={raffle.config.platforms.includes(platform)} title={(platform === "demo" ? "테스트" : platformLabel(platform)) + " 추첨 대상 " + (raffle.config.platforms.includes(platform) ? "켜짐" : "꺼짐")}
      disabled={disabled} onClick={() => void toggle("platforms", platform)}>
      {platform === "demo" ? <Icon name="viewers" size={18} /> : <PlatformIcon platform={platform} size={18} />}
    </button>)}
  </div>;
}

export function RaffleTimerControl({ raffle, now, disabled, configure }: { raffle: RaffleState; now: number; disabled: boolean; configure: Configure }) {
  const editorId = useId();
  const [open, setOpen] = useState(false), [seconds, setSeconds] = useState("60"), [pending, setPending] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const suppressFocus = useRef(false), pointerFocus = useRef(false);
  const reset = () => setSeconds(String(raffle.config.timerSeconds ?? 60));
  const expand = () => { if (!disabled && !open) { reset(); setOpen(true); } };
  const collapse = () => { setOpen(false); pointerFocus.current = false; reset(); };
  useEffect(() => { collapse(); }, [raffle.id, disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) collapse(); };
    const blur = () => collapse();
    document.addEventListener("pointerdown", outside); window.addEventListener("blur", blur);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("blur", blur); };
  }, [open]);
  const valid = /^\d+$/.test(seconds) && Number(seconds) >= 1 && Number(seconds) <= 86400;
  // A logarithmic slider keeps short countdowns usable while numeric input can
  // still specify every whole second up to 24 hours.
  const position = Math.round(Math.log(Math.max(1, Math.min(86400, Number(seconds) || 1))) / Math.log(86400) * 1000);
  const apply = async (timerSeconds: number | null) => {
    setPending(true);
    try { if (await configure({ timerSeconds })) { collapse(); trigger.current?.blur(); } }
    finally { setPending(false); }
  };
  return <div ref={root} className={"raffle-timer-control" + (open ? " expanded" : "")}
    onPointerEnter={event => { if (event.pointerType === "mouse") { pointerFocus.current = true; expand(); } }}
    onPointerDown={() => { pointerFocus.current = true; }}
    onPointerLeave={() => {
      const focused = document.activeElement;
      // A mouse click on the clock is still only a preview. Keyboard focus and
      // focused editor fields stay open so typing/Tab navigation remain usable.
      if (focused === trigger.current && pointerFocus.current) { trigger.current?.blur(); collapse(); }
      else if (!root.current?.contains(focused)) collapse();
    }}
    onFocus={() => {
      if (document.activeElement === trigger.current && trigger.current?.matches(":focus-visible")) pointerFocus.current = false;
      if (!suppressFocus.current) expand();
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) collapse(); }}
    onKeyDown={event => { pointerFocus.current = false; if (event.key === "Escape") { event.preventDefault(); suppressFocus.current = true; trigger.current?.focus(); collapse(); suppressFocus.current = false; } }}>
    <button ref={trigger} type="button" className="raffle-timer-trigger" aria-label="모집 타이머 설정 열기" aria-expanded={open} aria-controls={editorId} disabled={disabled}
      title="모집 타이머 설정" onClick={expand}>
      <Icon name="timeline" size={16} />
      <LiveStageTimer openedAt={raffle.openedAt} closedAt={raffle.closedAt} endsAt={raffle.endsAt} active={raffle.active} now={now} remainingFirst />
    </button>
    <div id={editorId} className="raffle-timer-expansion" aria-hidden={!open} inert={!open}>
      <form className="raffle-timer-panel" aria-label="모집 타이머 설정" onSubmit={event => { event.preventDefault(); if (valid && !pending) void apply(Number(seconds)); }}>
        <label htmlFor={editorId + "-seconds"}>모집 타이머{!raffle.active && <span> · 적용 시 모집 재개</span>}</label>
        <div className="raffle-timer-inputs">
          <input type="range" aria-label="모집 타이머 슬라이더" aria-valuetext={seconds + "초"} min="0" max="1000" value={position} disabled={pending}
            onChange={event => setSeconds(String(Math.round(Math.pow(86400, Number(event.target.value) / 1000))))} />
          <div className="raffle-timer-number"><input id={editorId + "-seconds"} type="number" aria-label="모집 타이머 초" min="1" max="86400" step="1" value={seconds} disabled={pending} onChange={event => setSeconds(event.target.value)} /><span>초</span></div>
          <button className="primary" type="submit" disabled={!valid || pending}>{raffle.active ? "확인" : "모집 재개"}</button>
          {raffle.active && raffle.endsAt && <button className="icon-button" type="button" aria-label="모집 타이머 끄기" title="타이머 끄기" disabled={pending} onClick={() => void apply(null)}><Icon name="close" size={16} /></button>}
        </div>
      </form>
    </div>
  </div>;
}
