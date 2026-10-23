import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { useChatSpeech } from "./use-chat-speech";
import { availableBrowserVoices, sortVoices, voiceKey, type SpeechChoice, type SpeechVoice } from "./speech-voices";
import "./speech-voice.css";

const languages = new Intl.DisplayNames(["ko"], { type: "language" });
const korean = (voice: SpeechChoice) => /^ko\b/i.test(voice.lang);
function languageName(lang: string) { try { return languages.of(lang) || lang; } catch { return lang; } }
function voiceName(voice: SpeechVoice) {
  // Keep the full system name in the accessible label/title; let the card lead with the name.
  return voice.name.startsWith("Microsoft ") ? voice.name.slice(10).split(" - ")[0].replace(/ Desktop$/, "") : voice.name;
}
const sourceName = (voice: SpeechChoice) => voice.backend === "browser" ? "브라우저" : "Windows";

export function SpeechVoiceDialog({ channel, onClose }: { channel: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), mounted = useRef(true), revision = useRef(0), onlineNotice = useRef<HTMLDivElement>(null);
  const [webVoices, setWebVoices] = useState<SpeechVoice[]>(availableBrowserVoices), [nativeVoices, setNativeVoices] = useState<SpeechVoice[]>([]);
  const [choice, setChoice] = useState<SpeechChoice | null>(null), [saved, setSaved] = useState<SpeechChoice | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [onlineAccepted, setOnlineAccepted] = useState(false);
  const [filter, setFilter] = useState<"ko" | "all">("ko"), [query, setQuery] = useState(""), [previewKey, setPreviewKey] = useState<string | null>(null);
  const reader = useChatSpeech(channel, true);
  useLayoutEffect(() => {
    const e = dialog.current; e?.showModal();
    return () => { if (e?.open) e.close(); };
  }, []);
  const refresh = async (initial = false) => {
    const request = ++revision.current; setLoading(true); setError(""); reader.clearError(); reader.stop(); setPreviewKey(null);
    setWebVoices(availableBrowserVoices());
    try {
      const reply = await window.assist?.speech("inventory", { channel });
      if (!mounted.current || request !== revision.current) return;
      if (!reply?.ok) throw Error(reply?.error || "음성 목록을 가져오지 못했습니다.");
      const installed: SpeechVoice[] = (reply.data?.voices || []).map(voice => ({ backend: "native", voice: voice.name, name: voice.name, lang: voice.lang, local: true }));
      setNativeVoices(installed);
      if (initial) {
        const selection = reply.data?.selection ?? null;
        setChoice(selection); setSaved(selection);
        if ((selection && !korean(selection)) || ![...availableBrowserVoices(), ...installed].some(korean)) setFilter("all");
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "음성 목록을 가져오지 못했습니다."); }
    finally { if (mounted.current && request === revision.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true; void refresh(true);
    const changed = () => setWebVoices(availableBrowserVoices());
    window.speechSynthesis?.addEventListener("voiceschanged", changed);
    return () => { mounted.current = false; revision.current++; window.speechSynthesis?.removeEventListener("voiceschanged", changed); };
  }, []);
  const voices = sortVoices([...webVoices, ...nativeVoices], choice), selected = voices.find(voice => voiceKey(voice) === voiceKey(choice));
  const missing = !!choice && !selected, selectionKey = voiceKey(choice), online = !!selected && !selected.local;
  const approved = (voice: SpeechChoice | null) => !voice || voice.local || (saved?.local === false && voiceKey(saved) === voiceKey(voice)) || (onlineAccepted && selectionKey === voiceKey(voice));
  const consented = approved(selected ?? choice);
  const usable = !loading && !saving && !missing && consented && (!!selected || nativeVoices.length > 0);
  const playing = reader.enabled || reader.pending;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = voices.filter(voice => (filter === "all" || korean(voice)) &&
    `${voice.name} ${voice.lang} ${languageName(voice.lang)} ${sourceName(voice)}`.toLocaleLowerCase().includes(needle));
  useEffect(() => {
    if (!loading) dialog.current?.querySelector('input[type="radio"]:checked')?.closest(".speech-voice-card")?.scrollIntoView({ block: "nearest" });
  }, [selectionKey, loading]);
  const choose = (voice: SpeechVoice | null) => {
    reader.stop(); reader.clearError(); setPreviewKey(null); setError(""); setOnlineAccepted(false); setChoice(voice);
  };
  useEffect(() => {
    if (online) onlineNotice.current?.scrollIntoView({ block: "nearest" });
  }, [selectionKey, online]);
  const preview = async (voice: SpeechVoice | null) => {
    const key = voiceKey(voice);
    if (previewKey === key && playing) { reader.stop(); setPreviewKey(null); return; }
    const allowed = approved(voice);
    if (selectionKey !== key) choose(voice); else reader.stop();
    if (!allowed) return;
    setPreviewKey(key);
    if (await reader.start(voice, true)) await reader.speak(!voice || korean(voice)
      ? "안녕하세요. 스트리머 어시스트의 채팅 음성입니다." : "Hello! This is the Streamer Assist chat voice.");
  };
  const save = async () => {
    setSaving(true); setError(""); reader.stop();
    try {
      const reply = await window.assist?.speech("select", { channel, choice: selected ?? choice });
      if (!reply?.ok) throw Error(reply?.error || "음성 설정을 저장하지 못했습니다.");
      if (mounted.current) onClose();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "음성 설정을 저장하지 못했습니다."); }
    finally { if (mounted.current) setSaving(false); }
  };
  const card = (voice: SpeechVoice | null) => {
    const key = voiceKey(voice), checked = selectionKey === key, reading = previewKey === key && playing;
    const name = voice ? voiceName(voice) : "자동 선택";
    const disabled = loading || saving || (!voice && !nativeVoices.length);
    return <div key={key} className={"speech-voice-card" + (checked ? " selected" : "") + (!voice ? " automatic" : "") + (reading ? " reading" : "")}
      data-voice={key} data-language={voice?.lang ?? "auto"}>
      <label className="speech-voice-pick">
        <input type="radio" name={channel + ":voice"} value={key} checked={checked} disabled={disabled} onChange={() => choose(voice)}
          aria-label={voice ? `${voice.name} · ${languageName(voice.lang)} · ${sourceName(voice)}` : "자동 선택 · 한국어 우선"} />
        <span className={"speech-voice-avatar" + (!voice || korean(voice) ? " korean" : "")} aria-hidden="true">
          {reading ? <span className="speech-voice-wave"><i /><i /><i /><i /></span> : voice ? korean(voice) ? "가" : "Aa" : <Icon name="sparkles" size={22} />}
        </span>
        <span className="speech-voice-copy"><strong title={voice?.name}>{name}</strong>
          <span>{voice ? <>{languageName(voice.lang)}{voice.local && <><span aria-hidden="true"> · </span>기기 내</>}</> : "한국어 우선 · Windows 기본 음성"}</span>
          {voice && !voice.local && <span className="speech-voice-online">온라인</span>}
        </span>
        <span className="speech-voice-selected" aria-hidden="true">{checked && <Icon name="check" size={16} />}</span>
      </label>
      <button type="button" className="speech-voice-listen" disabled={disabled || (!reading && !approved(voice))}
        aria-label={name + (reading ? " 미리듣기 중지" : " 미리듣기")} aria-pressed={reading}
        title={voice && !voice.local && !approved(voice) ? "음성을 선택한 뒤 텍스트 전송 안내에 동의하세요" : reading ? "미리듣기 중지" : "이 목소리로 미리듣기"}
        onClick={() => void preview(voice)}><Icon name={reading ? "stop" : "play"} size={18} /><span>{reading ? "중지" : "듣기"}</span></button>
      {checked && voice && !voice.local && <div ref={onlineNotice} className="speech-online-notice">
        <p>온라인 음성은 읽을 텍스트를 해당 음성 제공자에게 전송합니다.</p>
        <label><input type="checkbox" checked={consented} disabled={saving} onChange={event => { reader.stop(); setSaved(null); setOnlineAccepted(event.target.checked); }} />텍스트 전송에 동의합니다.</label>
      </div>}
    </div>;
  };
  return <dialog ref={dialog} className="speech-voice-dialog" aria-labelledby={channel + ":title"} data-loading={loading}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header><div className="speech-voice-title"><span className="speech-voice-title-icon"><Icon name="volume" size={24} /></span>
      <div><h2 id={channel + ":title"}>채팅 목소리</h2><p>목소리를 고르고, 직접 들어보세요.</p></div></div>
      <button type="button" className="icon-button" aria-label="음성 설정 닫기" onClick={onClose}><Icon name="close" size={20} /></button></header>
    <div className="speech-voice-tools">
      <div className="speech-voice-search-row"><label className="speech-voice-search"><Icon name="search" size={18} />
        <input autoFocus type="search" aria-label="목소리 검색" placeholder="목소리·언어 검색" value={query} maxLength={128} onChange={event => setQuery(event.target.value)} /></label>
        <button type="button" className="icon-button speech-voice-refresh" aria-label="음성 목록 새로고침" title="목록 새로고침" disabled={loading || saving} onClick={() => void refresh()}><Icon name="refresh" size={19} /></button></div>
      <div className="speech-voice-filters" role="group" aria-label="음성 언어 필터">
        <button type="button" aria-pressed={filter === "ko"} onClick={() => setFilter("ko")}>한국어 <span>{voices.filter(korean).length}</span></button>
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>전체 <span>{voices.length}</span></button>
      </div>
    </div>
    <div className="speech-voice-scroll" aria-busy={loading}>
      {loading ? <div className="speech-voice-empty" role="status"><Icon name="volume" size={28} /><p>사용 가능한 목소리를 불러오고 있어요…</p></div> : <>
        <div className={"speech-voice-list" + (filtered.length === 1 ? " single" : "")} role="radiogroup" aria-label="채팅 TTS 음성">
          {!needle && card(null)}
          {filtered.map(card)}
        </div>
        {!filtered.length && <div className="speech-voice-empty" role="status"><Icon name={needle ? "search" : "volumeOff"} size={28} />
          <strong>{needle ? "검색 결과가 없어요" : voices.length ? "한국어 목소리가 없어요" : "사용할 수 있는 목소리가 없어요"}</strong>
          <p>{needle ? "다른 이름이나 언어로 검색해 보세요." : voices.length ? "전체 목록에서 다른 언어를 선택할 수 있어요." : "기기에 음성 언어를 설치한 뒤 앱을 다시 실행하세요."}</p>
          {(needle || filter === "ko") && <button type="button" className="text-button" onClick={() => { if (filter === "ko") setFilter("all"); else setQuery(""); }}>{filter === "ko" ? needle ? "전체 언어에서 검색" : "전체 목소리 보기" : "검색 지우기"} <Icon name="arrow" size={14} /></button>}</div>}
        <details className="speech-voice-help"><summary><Icon name="info" size={15} />원하는 목소리가 없나요?</summary>
          <p>이 기기와 앱에서 제공되는 음성만 표시합니다. 유나(Yuna)·Google 한국어 등은 운영체제와 브라우저에 따라 제공 여부가 달라집니다. 음성을 추가했다면 앱을 다시 실행하세요.</p></details>
      </>}
    </div>
    <footer><div className="speech-voice-current" role="status"><span>{previewKey === selectionKey && playing ? reader.pending ? "음성 준비 중…" : "미리듣는 중" : "선택한 목소리"}</span>
      <strong title={selected?.name}>{missing ? "다른 목소리를 선택하세요" : selected ? voiceName(selected) : "자동 선택"}</strong>
      <span>{missing ? "이전에 선택한 음성을 찾을 수 없습니다." : selected ? `${languageName(selected.lang)} · ${selected.local ? "이 기기에서 재생" : "온라인 음성"}` : "한국어 우선"}</span></div>
      {(error || reader.error) && <p className="speech-voice-error" role="alert">{error || reader.error}</p>}
      <div className="speech-voice-actions"><button type="button" className="secondary" onClick={onClose}>취소</button><button type="button" className="primary" disabled={!usable} onClick={() => void save()}>{saving ? "저장 중…" : "이 음성 사용"}</button></div></footer>
  </dialog>;
}
