import { useEffect, useRef, useState } from "react";
import type { WinnerChatMessage } from "./audience-types";
import { Icon } from "./icons";
import { SpeechVoiceDialog } from "./speech-voice-dialog";
import { useChatSpeech } from "./use-chat-speech";
import { useChatSpeechPreference } from "./chat-speech-preference";

export function ChatSpeechButton({ channel, active, messages, messageCount }: {
  channel: string; active: boolean; messages: WinnerChatMessage[]; messageCount: number;
}) {
  const reader = useChatSpeech(channel, active), [settings, setSettings] = useState(false);
  const preference = useChatSpeechPreference();
  const [saveError, setSaveError] = useState("");
  const [visible, setVisible] = useState(!document.hidden);
  const lastSeen = useRef(messageCount), currentCount = useRef(messageCount);
  currentCount.current = messageCount;
  useEffect(() => { if (!active) setSettings(false); }, [active]);
  useEffect(() => { const update = () => setVisible(!document.hidden); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); }, []);
  // Start once per opening/preference change. Losing queue ownership must not
  // start a loop that steals speech back from another window or a preview.
  useEffect(() => {
    let cancelled = false;
    if (!active || !visible || !preference.enabled || settings) { reader.stop(); return; }
    void reader.start().then(started => { if (!cancelled && started) lastSeen.current = currentCount.current; });
    return () => { cancelled = true; reader.stop(); };
  }, [channel, active, visible, preference.enabled, settings]);
  useEffect(() => {
    const delta = Math.max(0, messageCount - lastSeen.current); lastSeen.current = messageCount;
    if (!reader.enabled || !active || document.hidden || !delta) return;
    for (const message of messages.slice(-Math.min(delta, 5))) void reader.speak(message.text);
  }, [messages, messageCount, reader.enabled, active, channel]);
  const toggle = async () => {
    setSaveError("");
    const next = !reader.enabled && !reader.pending;
    if (!next) reader.stop();
    try {
      await preference.setEnabled(next);
      // If another window took ownership or a voice failed to start, the saved
      // preference is already on; this click retries rather than muting it.
      if (next && preference.enabled && await reader.start()) lastSeen.current = currentCount.current;
    }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : "음성 설정을 저장하지 못했습니다."); }
  };
  return <div className="chat-speech-control">
    <button className={"icon-button chat-speech-toggle" + (reader.enabled ? " enabled" : "")} type="button" aria-label={reader.enabled || reader.pending ? "채팅 TTS 끄기" : "채팅 TTS 켜기"}
      aria-pressed={reader.enabled} aria-busy={reader.pending} title={reader.pending ? "음성 준비 중 · 눌러서 취소" : reader.enabled ? "새 채팅 읽기 켜짐 · 눌러서 끄기" : "새 채팅 읽기"}
      disabled={!window.assist || !active} onClick={() => void toggle()}><Icon name={reader.enabled ? "volume" : "volumeOff"} size={21} /></button>
    <button className="icon-button chat-voice-settings" type="button" aria-label="TTS 음성 설정" title="음성 선택·미리듣기" disabled={!window.assist || !active}
      onClick={() => { reader.stop(); setSettings(true); }}><Icon name="settings" size={16} /></button>
    {(saveError || reader.error) && !settings && <span className="chat-speech-error" role="alert">{saveError || reader.error}</span>}
    {settings && active && <SpeechVoiceDialog channel={channel + ":preview"} onClose={() => setSettings(false)} />}
  </div>;
}
