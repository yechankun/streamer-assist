import { createContext, useContext, useState } from "react";
import { Icon } from "./icons";

export const ChatSpeechPreferenceContext = createContext(false);

export function useChatSpeechPreference() {
  const enabled = useContext(ChatSpeechPreferenceContext);
  const setEnabled = async (next: boolean) => {
    const reply = await window.assist?.call("chat-speech-set", { enabled: next });
    if (!reply?.ok) throw Error(reply?.error || "채팅 음성 설정을 저장하지 못했습니다.");
  };
  return { enabled, setEnabled };
}

export function ChatSpeechToggle() {
  const preference = useChatSpeechPreference();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  return <div className="raffle-speech-preference">
    <button type="button" className={"icon-button raffle-speech-toggle" + (preference.enabled ? " enabled" : "")}
      aria-label="시청자·당첨자 채팅 자동 읽기" aria-pressed={preference.enabled}
      title={preference.enabled ? "채팅 자동 읽기 켜짐 · 창을 열기 전 마지막 채팅부터 읽기" : "채팅 자동 읽기 꺼짐"}
      disabled={pending || !window.assist} onClick={async () => {
        setPending(true); setError("");
        try { await preference.setEnabled(!preference.enabled); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "음성 설정을 저장하지 못했습니다."); }
        finally { setPending(false); }
      }}><Icon name={preference.enabled ? "volume" : "volumeOff"} size={20} /></button>
    {error && <span className="chat-speech-error" role="alert">{error}</span>}
  </div>;
}
