import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
export type TabId = "timeline" | "raffle" | "poll" | "donation" | "roulette";
export type PageId = TabId | "home" | "settings";
export const workspaceTabs = [
  { id: "timeline", icon: "timeline", text: "방송 타임라인" },
  { id: "raffle", icon: "viewers", text: "시청자 추첨" },
  { id: "poll", icon: "poll", text: "숫자 투표" },
  { id: "donation", icon: "donation", text: "도네 투표" },
  { id: "roulette", icon: "roulette", text: "룰렛" },
] as const;
export type ToolTab = { id: string; kind: TabId; mode: "loaded" | "unloaded" };
export type WorkspaceState = {
  version: number; windowId: string; isMain: boolean;
  tabs: ToolTab[]; active: string; hideInactive: boolean; hideTopbar: boolean;
  topbarPeek?: boolean;
  drafts: Record<string, Record<string, unknown>>;
  drop: { id: string; before: string | null } | null;
  epochs: Record<string, number>;
  rouletteSpinning: Record<string, boolean>;
};
export type SettingsTarget = { section?: string; aiTarget?: string; aiPage?: "connections" | "assignments"; revision?: number };
export const TabDraftContext = createContext<{ id: string; kind: PageId; draft: Record<string, unknown> }>({ id: "home", kind: "home", draft: {} });
export const rouletteStorageKey = (name: "items" | "title", id: string) => "streamer-assist-roulette-" + name + (id === "roulette" ? "" : "." + id);
// Instance-owned drafts transfer between windows, and are released on close.
export function useTabState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(TabDraftContext);
  const [value, setValue] = useState<T>(() => Object.hasOwn(context.draft, key) ? context.draft[key] as T :
    typeof initial === "function" ? (initial as () => T)() : initial);
  const latest = useRef(value), mounted = useRef(true);
  const save = useCallback((value: T) => {
    if (workspaceTabs.some(tab => tab.id === context.kind)) void window.assist?.workspace("draft", { id: context.id, key, value }).catch(() => {});
  }, [context.id, context.kind, key]);
  useEffect(() => { mounted.current = true; save(latest.current); return () => { mounted.current = false; }; }, [save]);
  const update = useCallback<Dispatch<SetStateAction<T>>>(next => {
    if (!mounted.current) return;
    const result = typeof next === "function" ? (next as (previous: T) => T)(latest.current) : next;
    latest.current = result; setValue(result); save(result);
  }, [save]);
  return [value, update];
}
