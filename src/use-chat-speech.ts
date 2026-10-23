import { useEffect, useRef, useState } from "react";
import { findBrowserVoice, type SpeechChoice } from "./speech-voices";

// One main-process queue arbitrates native and Web Speech playback across windows.
export function useChatSpeech(channel: string, active: boolean) {
  const [enabled, setEnabled] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), shown = useRef(active), voice = useRef<SpeechSynthesisVoice | null>(null), utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const session = useRef("");
  shown.current = active;
  const cancelBrowser = () => {
    if (!utterance.current) return;
    utterance.current = null; window.speechSynthesis?.cancel();
  };
  const stop = () => {
    const stoppedSession = session.current; session.current = "";
    generation.current++; cancelBrowser(); setEnabled(false); setPending(false);
    if (stoppedSession) void window.assist?.speech("stop", { channel, session: stoppedSession }).catch(() => {});
  };
  useEffect(() => {
    if (!active) stop();
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility);
    const off = window.assist?.subscribeSpeech(status => {
      if (status.channel !== channel || status.session !== session.current) return;
      setEnabled(status.active);
      if (!status.active) { generation.current++; setPending(false); cancelBrowser(); }
      if (status.error) setError(status.error);
      if (status.active && status.utterance) {
        const { id, text } = status.utterance;
        const playingSession = session.current;
        const complete = (error = false) => { void window.assist?.speech("complete", { channel, session: playingSession, id, error }).catch(() => stop()); };
        if (!shown.current || document.hidden || !voice.current) { complete(true); return; }
        try {
          const prompt = new SpeechSynthesisUtterance(text);
          prompt.voice = voice.current; prompt.lang = voice.current.lang;
          utterance.current = prompt;
          const done = (failed: boolean) => { if (utterance.current !== prompt) return; utterance.current = null; complete(failed); };
          prompt.onend = () => done(false); prompt.onerror = () => done(true);
          window.speechSynthesis.speak(prompt);
        } catch { utterance.current = null; complete(true); }
      }
    });
    return () => { generation.current++; cancelBrowser(); document.removeEventListener("visibilitychange", visibility); off?.(); if (session.current) void window.assist?.speech("stop", { channel, session: session.current }).catch(() => {}); };
  }, [channel, active]);
  const start = async (choice?: SpeechChoice | null, preview = false) => {
    const request = ++generation.current; setPending(true); setError("");
    try {
      if (choice === undefined) {
        const reply = await window.assist?.speech("selection", { channel });
        if (!reply?.ok) throw Error(reply?.error || "음성 설정을 읽지 못했습니다.");
        choice = reply.data?.selection ?? null;
      }
      const selectedVoice = choice?.backend === "browser" ? await findBrowserVoice(choice) : null;
      if (request !== generation.current || !shown.current || document.hidden) return false;
      voice.current = selectedVoice;
      const startedSession = crypto.randomUUID(); session.current = startedSession;
      const reply = await window.assist?.speech("start", { channel, session: startedSession, choice, preview });
      if (request !== generation.current || !shown.current || document.hidden) { void window.assist?.speech("stop", { channel, session: startedSession }); return false; }
      if (!reply?.ok) throw Error(reply?.error || "음성을 사용할 수 없습니다.");
      setEnabled(reply.data?.active === true); return reply.data?.active === true;
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : "음성을 사용할 수 없습니다."); return false; }
    finally { if (request === generation.current) setPending(false); }
  };
  const speak = async (text: string) => {
    try {
      const reply = await window.assist?.speech("speak", { channel, session: session.current, text });
      if (!reply?.ok) { setError(reply?.error || "음성을 재생하지 못했습니다."); stop(); }
      else if (reply.data?.accepted === false) { cancelBrowser(); setEnabled(false); }
    } catch { setError("음성을 재생하지 못했습니다."); stop(); }
  };
  return { enabled, pending, error, start, stop, speak, clearError: () => setError("") };
}
