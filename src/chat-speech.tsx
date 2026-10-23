import { useEffect, useRef, useState } from "react";
import type { WinnerChatMessage } from "./audience-types";
import { Icon } from "./icons";
import { SpeechVoiceDialog } from "./speech-voice-dialog";
import { useChatSpeech } from "./use-chat-speech";

export function ChatSpeechButton({ channel, active, messages, messageCount }: {
  channel: string; active: boolean; messages: WinnerChatMessage[]; messageCount: number;
}) {
  const reader = useChatSpeech(channel, active), [settings, setSettings] = useState(false);
  const lastSeen = useRef(messageCount), currentCount = useRef(messageCount);
  currentCount.current = messageCount;
  useEffect(() => { if (!active) setSettings(false); }, [active]);
  useEffect(() => {
    const delta = Math.max(0, messageCount - lastSeen.current); lastSeen.current = messageCount;
    if (!reader.enabled || !active || document.hidden || !delta) return;
    for (const message of messages.slice(-Math.min(delta, 5))) void reader.speak(message.text);
  }, [messages, messageCount, reader.enabled, active, channel]);
  const toggle = async () => {
    if (reader.enabled || reader.pending) { reader.stop(); return; }
    if (await reader.start()) lastSeen.current = currentCount.current;
  };
  return <div className="chat-speech-control">
    <button className={"icon-button chat-speech-toggle" + (reader.enabled ? " enabled" : "")} type="button" aria-label={reader.enabled || reader.pending ? "채팅 TTS 끄기" : "채팅 TTS 켜기"}
      aria-pressed={reader.enabled} aria-busy={reader.pending} title={reader.pending ? "음성 준비 중 · 눌러서 취소" : reader.enabled ? "새 채팅 읽기 켜짐 · 눌러서 끄기" : "새 채팅 읽기"}
      disabled={!window.assist || !active} onClick={() => void toggle()}><Icon name={reader.enabled ? "volume" : "volumeOff"} size={21} /></button>
    <button className="icon-button chat-voice-settings" type="button" aria-label="TTS 음성 설정" title="음성 선택·미리듣기" disabled={!window.assist || !active}
      onClick={() => { reader.stop(); setSettings(true); }}><Icon name="settings" size={16} /></button>
    {reader.error && !settings && <span className="chat-speech-error" role="alert">{reader.error}</span>}
    {settings && active && <SpeechVoiceDialog channel={channel + ":preview"} onClose={() => setSettings(false)} />}
  </div>;
}
