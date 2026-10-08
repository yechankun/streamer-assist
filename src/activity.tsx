import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
export const PageActivityContext = createContext(true);
const visible = () => document.visibilityState !== "hidden";
const subscribe = (notify: () => void) => { document.addEventListener("visibilitychange", notify); return () => document.removeEventListener("visibilitychange", notify); };
export const useDocumentVisible = () => useSyncExternalStore(subscribe, visible, () => true);
export const usePageActive = () => { const page = useContext(PageActivityContext), documentVisible = useDocumentVisible(); return page && documentVisible; };
// Background completion is a single wake-up; elapsed UI clocks pause while hidden.
export function useActivityClock(running: boolean, deadline?: number, fast = false) {
  const active = usePageActive(), [now, setNow] = useState(Date.now);
  const pending = Number.isFinite(deadline) && now < deadline!;
  const milliseconds = fast && pending ? 80 : 1000;
  useEffect(() => {
    setNow(Date.now());
    if (!active) {
      if (Number.isFinite(deadline) && deadline! > Date.now()) {
        const timer = setTimeout(() => setNow(Date.now()), Math.min(0x7fffffff, deadline! - Date.now() + 1));
        return () => clearTimeout(timer);
      }
      return;
    }
    if (!running && !pending) return;
    const timer = setInterval(() => setNow(Date.now()), milliseconds);
    return () => clearInterval(timer);
  }, [active, running, deadline, pending, milliseconds]);
  return now;
}
