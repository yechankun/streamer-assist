export type SpeechChoice = { backend: "native" | "browser"; voice: string; lang: string; local: boolean };
export type SpeechVoice = SpeechChoice & { name: string };
export type SpeechStatus = { channel: string; session?: string; active: boolean; error?: string; utterance?: { id: number; text: string } };
export type SpeechReply = { ok: boolean; error?: string; data?: { active?: boolean; accepted?: boolean; voice?: string; voices?: { name: string; lang: string }[]; selection?: SpeechChoice | null } };
export type SpeechRequest = { channel: string; session?: string; text?: string; choice?: SpeechChoice | null; preview?: boolean; id?: number; error?: boolean };
export type SpeechAction = "start" | "speak" | "stop" | "complete" | "inventory" | "selection" | "select";

export const voiceKey = (voice: SpeechChoice | null) => voice ? JSON.stringify([voice.backend, voice.voice, voice.lang]) : "";
export const browserVoices = () => typeof window.speechSynthesis?.getVoices === "function" ? window.speechSynthesis.getVoices() : [];
export function availableBrowserVoices(): SpeechVoice[] {
  return browserVoices().map(voice => ({ backend: "browser", voice: voice.voiceURI, lang: voice.lang, local: voice.localService, name: voice.name }));
}
function voiceIdentity(voice: SpeechVoice) {
  const name = voice.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  // Windows exposes the same Microsoft voice as e.g. "Heami Desktop" in SAPI
  // and "Heami - Korean (Korean)" in Web Speech. Keep Natural/Online qualifiers.
  if (/^Microsoft /i.test(name)) return JSON.stringify([
    name.replace(/\s+-\s+[^()]+\([^()]*\)$/, "").replace(/ Desktop$/i, "").toLowerCase(),
    voice.lang.replace(/_/g, "-").toLowerCase(), voice.local,
  ]);
  // Different opaque voice IDs can denote different quality/voice variants.
  return voiceKey(voice);
}
export function sortVoices(voices: SpeechVoice[], preferred: SpeechChoice | null = null) {
  const unique = new Map<string, SpeechVoice>(), preferredKey = voiceKey(preferred);
  for (const voice of voices) {
    const key = voiceIdentity(voice), previous = unique.get(key);
    if (!previous || voiceKey(voice) === preferredKey || (voiceKey(previous) !== preferredKey && previous.backend === "native" && voice.backend === "browser")) unique.set(key, voice);
  }
  return [...unique.values()].sort((a, b) =>
    Number(/^ko\b/i.test(b.lang)) - Number(/^ko\b/i.test(a.lang)) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}
export async function findBrowserVoice(choice: SpeechChoice) {
  const find = () => browserVoices().find(voice => voice.voiceURI === choice.voice && voice.lang === choice.lang);
  if (!find() && !browserVoices().length && window.speechSynthesis) await new Promise<void>(resolve => {
    const changed = () => { if (browserVoices().length) done(); };
    const done = () => { clearTimeout(timeout); window.speechSynthesis.removeEventListener("voiceschanged", changed); resolve(); };
    const timeout = setTimeout(done, 2000);
    window.speechSynthesis.addEventListener("voiceschanged", changed);
  });
  const voice = find();
  if (!voice) throw Error("선택한 음성을 사용할 수 없습니다. 음성 설정에서 다시 선택하세요.");
  if (!voice.localService && choice.local) throw Error("이 음성은 온라인으로 제공됩니다. 음성 설정에서 전송 안내를 확인하고 다시 선택하세요.");
  return voice;
}
