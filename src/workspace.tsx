import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type PointerEvent } from "react";
import type { State } from "./main";
import { Icon, PlatformIcon } from "./icons";
import { platformLabel, platforms } from "./platforms";
import { changeScreen } from "./presentation";
import { rouletteStorageKey, TabDraftContext, workspaceTabs, type PageId, type SettingsTarget, type WorkspaceState } from "./workspace-state";
import type { RouletteImport } from "./roulette";
import "./workspace.css";
import { textScaleEvent } from "./text-size";
import { WorkspacePointerDrag, type PointerPoint } from "./workspace-pointer.mjs";

export type WorkspacePageProps = {
  state: State; tab: PageId; instanceId: string; active: boolean;
  theme: "dark" | "light"; setTheme: (theme: "dark" | "light") => void;
  openTab: (id: string, settings?: SettingsTarget) => void; settingsTarget: SettingsTarget;
  rouletteImport: RouletteImport | null; rouletteSpinning: boolean; resetRoulette: () => void;
};
const initial: WorkspaceState = {
  version: 2, windowId: "main", isMain: true,
  tabs: workspaceTabs.map(tab => ({ id: tab.id, kind: tab.id, mode: "unloaded" })),
  active: "home", hideInactive: false, drafts: {}, drop: null, epochs: {}, rouletteSpinning: {},
};
type MenuState = { id?: string; x: number; y: number; type: "tab" | "add" };
export function Workspace({ empty, Page }: { empty: State; Page: ComponentType<WorkspacePageProps> }) {
  const [state, setState] = useState(empty), [layout, setLayout] = useState<WorkspaceState>(initial);
  const [ready, setReady] = useState(!window.assist), [localTab, setLocalTab] = useState("home");
  const [visited, setVisited] = useState<Set<string>>(() => new Set(["home"]));
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget>({}), [error, setError] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() => { try { return localStorage.getItem("streamer-assist-theme") === "light" ? "light" : "dark"; } catch { return "dark"; } });
  const [menu, setMenu] = useState<MenuState | null>(null), [dragging, setDragging] = useState<string | null>(null);
  const nav = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null), suppressClick = useRef(false);
  const drag = useRef<{ id: string; windowMove: boolean; pointer: number; x: number; y: number; started: boolean; token?: string; motion?: WorkspacePointerDrag; lastPoint: PointerPoint } | null>(null);
  const active = window.assist ? layout.active : localTab;
  const signature = layout.tabs.map(tab => tab.id + ":" + tab.mode).join(",");
  const request = useCallback(async (action: string, payload?: unknown) => {
    try { const result = await window.assist?.workspace(action, payload); if (result && !result.ok) setError(result.error || "탭을 변경하지 못했습니다."); return result; }
    catch { return undefined; } // A successful window transfer can destroy its source renderer.
  }, []);
  const openTab = useCallback((id: string, settings?: SettingsTarget) => {
    if (settings) setSettingsTarget({ ...settings, revision: Date.now() });
    if (window.assist) void request("open", { id, ...settings }); else changeScreen(() => setLocalTab(id));
  }, [request]);
  useEffect(() => {
    if (!window.assist) return;
    const off = window.assist.subscribe(next => setState({ ...next, connections: { ...empty.connections, ...next.connections }, auth: { ...next.auth, accounts: { ...empty.auth.accounts, ...next.auth.accounts } } }));
    const offWorkspace = window.assist.subscribeWorkspace((kind, value) => {
      if (kind === "state") { setLayout(value as WorkspaceState); setReady(true); }
      else if (kind === "settings") setSettingsTarget({ ...value as SettingsTarget, revision: Date.now() });
      else if (kind === "error") setError(String(value));
      else if (kind === "dismiss-menu") setMenu(null);
      else if (kind === "reset-roulette" && Array.isArray(value)) for (const id of value) {
        try { localStorage.removeItem(rouletteStorageKey("items", id)); localStorage.removeItem(rouletteStorageKey("title", id)); } catch {}
      }
    });
    void window.assist.call("state");
    void request("state").then(result => { if (result?.ok) { setLayout(result.data as WorkspaceState); setReady(true); } });
    return () => { off(); offWorkspace(); };
  }, [empty, request]);
  useEffect(() => {
    setVisited(previous => new Set([...previous, active].filter(id => ["home", "settings"].includes(id) || layout.tabs.some(tab => tab.id === id && tab.mode === "loaded"))));
  }, [active, signature]);
  useEffect(() => { nav.current?.querySelector<HTMLElement>('[data-tab="' + active + '"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [active, signature]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("streamer-assist-theme", theme); } catch {} }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === "streamer-assist-theme") setTheme(event.newValue === "light" ? "light" : "dark"); };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, []);
  const report = useCallback(() => {
    if (!nav.current || !ready) return;
    const rect = nav.current.getBoundingClientRect();
    void request("strip", { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, tabs: [...nav.current.querySelectorAll<HTMLElement>("[data-tab]")].map(button => {
      const box = button.getBoundingClientRect(); return { id: button.dataset.tab, x: box.x, width: box.width };
    }) });
  }, [ready, request]);
  useLayoutEffect(() => {
    const root = document.documentElement, scale = (state.settings.textScale ?? 100) / 100;
    root.style.setProperty("--text-scale", String(scale));
    root.dataset.textScale = String(Math.round(scale * 100));
    root.dataset.textEnlarged = String(scale > 1);
    const resize = () => {
      root.dataset.textCompact = String(scale > 1 && innerWidth < 1150 * scale);
      root.dataset.textShort = String(scale > 1 && innerHeight < 760 * scale);
      report();
    };
    resize(); window.dispatchEvent(new Event(textScaleEvent));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [state.settings.textScale, report]);
  useEffect(() => {
    const observer = new ResizeObserver(report); if (nav.current) observer.observe(nav.current);
    report(); window.addEventListener("resize", report);
    return () => { observer.disconnect(); window.removeEventListener("resize", report); };
  }, [signature, layout.hideInactive, report]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); if (menu.id) nav.current?.querySelector<HTMLButtonElement>('[data-tab="' + menu.id + '"]')?.focus(); } };
    document.addEventListener("pointerdown", close, true); document.addEventListener("click", close, true); window.addEventListener("keydown", key); window.addEventListener("blur", close);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("click", close, true); window.removeEventListener("keydown", key); window.removeEventListener("blur", close); };
  }, [menu]);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const bounds = menuRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(menu.x, innerWidth - bounds.width - 8)), y = Math.max(8, Math.min(menu.y, innerHeight - bounds.height - 8));
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
  }, [menu, state.settings.textScale]);
  const endDrag = useCallback((cancel = false, point?: PointerPoint) => {
    const current = drag.current; if (!current) return; drag.current = null;
    if (current.started) { void current.motion?.finish(cancel, point || current.lastPoint); setDragging(null); suppressClick.current = true; }
    if (nav.current?.hasPointerCapture(current.pointer)) nav.current.releasePointerCapture(current.pointer);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") endDrag(true); }, blur = () => {
      const current = drag.current;
      if (!current?.started) { endDrag(true); return; }
      void request("drag-blur", {token: current.token}).then(result => { if (result?.data && drag.current === current) endDrag(true); });
    };
    window.addEventListener("keydown", key); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("blur", blur); };
  }, [endDrag, request]);
  function startDrag(event: PointerEvent, id: string, windowMove = false) {
    if (event.button !== 0 || !window.assist) return;
    suppressClick.current = false; setMenu(null);
    drag.current = { id, windowMove, pointer: event.pointerId, x: event.screenX, y: event.screenY, started: false, lastPoint: { x: event.screenX, y: event.screenY } };
  }
  function moveDrag(event: globalThis.PointerEvent) {
    const current = drag.current; if (!current || current.pointer !== event.pointerId || !(event.buttons & 1)) return;
    if (!current.started && Math.hypot(event.screenX - current.x, event.screenY - current.y) < 6) return;
    event.preventDefault();
    const last = layout.tabs.some(tab => tab.id === current.id && tab.mode === "loaded") && layout.tabs.filter(tab => tab.mode === "loaded").length === 1;
    const strip = nav.current?.getBoundingClientRect();
    if (!current.windowMove && !last && strip && event.clientY >= strip.top && event.clientY <= strip.bottom) {
      if (event.clientX < strip.left + 24) nav.current?.scrollBy({ left: -12 }); else if (event.clientX > strip.right - 24) nav.current?.scrollBy({ left: 12 });
    }
    if (!current.started) {
      current.started = true; setDragging(current.windowMove || last ? null : current.id); nav.current?.setPointerCapture(event.pointerId);
      current.token = crypto.randomUUID();
      current.motion = new WorkspacePointerDrag(request, { id: current.id, windowMove: current.windowMove, point: { x: current.x, y: current.y }, token: current.token });
    }
    const point = { x: event.screenX, y: event.screenY };
    current.lastPoint = point; current.motion?.move(point);
  }
  useEffect(() => {
    const up = (event: globalThis.PointerEvent) => endDrag(false, { x: event.screenX, y: event.screenY }); window.addEventListener("pointermove", moveDrag); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", moveDrag); window.removeEventListener("pointerup", up); };
  });
  function context(id: string | undefined, x: number, y: number, type: MenuState["type"] = "tab") {
    setMenu({ id, x: Math.max(8, Math.min(x, window.innerWidth - 210)), y: Math.max(8, Math.min(y, window.innerHeight - 200)), type });
  }
  function menuAction(action: string, payload?: unknown) { setMenu(null); void request(action, payload); }
  const shown = layout.tabs.filter(tab => !layout.hideInactive || tab.mode === "loaded");
  const pages = [
    ...[...visited].filter(id => ["home", "settings"].includes(id)).map(id => ({ id, kind: id as PageId })),
    ...layout.tabs.filter(tab => tab.mode === "loaded").map(tab => ({ id: tab.id, kind: tab.kind })),
  ];
  const roulettes = layout.tabs.filter(tab => tab.kind === "roulette" && tab.mode === "loaded");
  const spinningFor = (id: string, kind: PageId) => kind === "roulette" ? !!layout.rouletteSpinning[id] : ["settings", "home"].includes(kind) ? roulettes.some(tab => layout.rouletteSpinning[tab.id]) : roulettes.length > 0 && roulettes.every(tab => layout.rouletteSpinning[tab.id]);
  const control = (action: "minimize" | "toggle-maximize" | "close") => { void window.assist?.windowControl(action).catch(() => setError("창 상태를 변경하지 못했습니다.")); };
  const selectedMenuTab = layout.tabs.find(tab => tab.id === menu?.id);
  return <div className="layout workspace-layout" data-workspace-window={layout.windowId} data-workspace-ready={ready}>
    <header className="app-header">
      <button className="brand" onPointerDown={event => startDrag(event, "home", true)} onClick={event => { if (!suppressClick.current || event.detail === 0) openTab("home"); suppressClick.current = false; }} aria-label="Streamer Assist 홈" title="클릭하여 홈 · 끌어서 창 이동"><span className="brand-icon"><Icon name="activity" size={22} /></span><span>Streamer <strong>Assist</strong></span></button>
      <nav aria-label="방송 도구">
        <div ref={nav} className={"workspace-tabstrip" + (layout.drop ? " drop-ready" : "")} onScroll={report} onPointerCancel={() => endDrag(true)} onLostPointerCapture={() => endDrag(true)}>
          {shown.map(tab => {
            const info = workspaceTabs.find(info => info.id === tab.kind)!, unloaded = tab.mode === "unloaded";
            const peers = layout.tabs.filter(row => row.kind === tab.kind && row.mode === tab.mode);
            const text = info.text + (peers.length > 1 ? " " + (peers.findIndex(row => row.id === tab.id) + 1) : "");
            return <button key={tab.id} data-tab={tab.id} data-tab-kind={tab.kind} className={"nav" + (active === tab.id ? " active" : "") + (unloaded ? " unloaded" : "") + (dragging === tab.id ? " dragging" : "") + (layout.drop?.before === tab.id ? " drop-before" : "")}
              aria-current={active === tab.id ? "page" : undefined} aria-label={unloaded ? text + " 열기" : undefined} title={unloaded ? text + " 열기" : "끌어서 순서 변경 또는 다른 창으로 이동"}
              onPointerDown={event => startDrag(event, tab.id)} onClick={event => { if (!suppressClick.current || event.detail === 0) openTab(tab.id); suppressClick.current = false; }}
              onContextMenu={event => { event.preventDefault(); event.stopPropagation(); context(tab.id, event.clientX, event.clientY); }}
              onKeyDown={event => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); context(tab.id, box.x, box.bottom); } }}>
              <Icon name={info.icon} size={18} />{text}{unloaded && <Icon name="plus" size={13} />}
            </button>;
          })}
          {layout.drop && !layout.drop.before && <span className="drop-at-end" aria-hidden="true" />}
          {!shown.length && <span className="empty-tabstrip">탭을 추가하거나 여기로 끌어오세요</span>}
        </div>
        <button className="icon-button workspace-add-tab" aria-label="새 탭 추가" title="새 탭 추가" aria-expanded={menu?.type === "add"} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); context(undefined, box.right - 202, box.bottom, "add"); }}><Icon name="plus" size={17} /></button>
        <button className={"nav settings-tab" + (active === "settings" ? " active" : "")} aria-current={active === "settings" ? "page" : undefined} onClick={() => openTab("settings")} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); context(undefined, event.clientX, event.clientY); }}><Icon name="settings" size={18} />설정</button>
      </nav>
      <div className="header-actions">
        {platforms.filter(platform => state.livePlatforms?.[platform] === true).map(platform => <button className="platform-status" key={platform} title={platformLabel(platform) + " 방송 중"} aria-label={platformLabel(platform) + " 방송 중 · 연결 설정"} onClick={() => openTab("settings", { section: "platforms" })}><PlatformIcon platform={platform} size={18} /></button>)}
        <span className={state.current ? "live-badge live" : "live-badge"}><i className="dot" />{state.demo ? "테스트 기록" : state.current ? "기록 중" : "방송 대기"}</span>
        <button className="icon-button theme-toggle" aria-label={theme === "dark" ? "밝은 테마로 전환" : "어두운 테마로 전환"} title={theme === "dark" ? "밝은 테마" : "어두운 테마"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><Icon name={theme === "dark" ? "sun" : "moon"} size={20} /></button>
      </div>
      <div className="window-controls" aria-label="창 제어">
        <button aria-label="창 최소화" title="최소화" disabled={!window.assist} onClick={() => control("minimize")}><Icon name="minimize" size={15} /></button>
        <button aria-label={state.windowFrame.maximized ? "창 크기 복원" : "창 최대화"} title={state.windowFrame.maximized ? "크기 복원" : "최대화"} disabled={!window.assist} onClick={() => control("toggle-maximize")}><Icon name={state.windowFrame.maximized ? "restore" : "maximize"} size={14} /></button>
        <button className="window-close" aria-label="창 닫기" title={layout.isMain ? state.settings.trayEnabled ? "트레이로 닫기" : "창 닫기 · 다른 창이 없으면 앱 종료" : "창 닫기 · 열린 탭은 기본 창으로 이동"} disabled={!window.assist} onClick={() => control("close")}><Icon name="close" size={16} /></button>
      </div>
    </header>
    {error && <div className="workspace-error" role="alert">{error}<button className="icon-button" aria-label="알림 닫기" onClick={() => setError("")}><Icon name="close" size={14} /></button></div>}
    {ready && pages.map(page => <TabDraftContext.Provider key={page.id + ":" + (layout.epochs[page.id] || 0)} value={{ id: page.id, kind: page.kind, draft: layout.drafts[page.id] || {} }}>
      <Page state={state} tab={page.kind} instanceId={page.id} active={active === page.id} theme={theme} setTheme={setTheme} openTab={openTab} settingsTarget={settingsTarget}
        rouletteImport={(layout.drafts[page.id]?.imported as RouletteImport) || null} rouletteSpinning={spinningFor(page.id, page.kind)} resetRoulette={() => { void request("roulette-reset"); }} />
    </TabDraftContext.Provider>)}
    {menu && <div ref={menuRef} className="tab-context-menu" role="menu" aria-label={menu.type === "add" ? "새 탭" : "탭 관리"} style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }}>
      {menu.type === "tab" ? <>
        <button role="menuitem" disabled={!selectedMenuTab} onClick={() => menuAction("new-window", { id: menu.id })}><Icon name="maximize" size={15} />새 창에서 보기</button>
        <button role="menuitem" disabled={!selectedMenuTab} onClick={() => menuAction("new-tab", { id: menu.id })}><Icon name="plus" size={15} />새 탭에서 보기</button>
        <button role="menuitem" disabled={!selectedMenuTab || selectedMenuTab.mode === "unloaded"} onClick={() => menuAction("close-tab", { id: menu.id })}><Icon name="close" size={15} />닫기</button>
        <button role="menuitem" disabled={!layout.tabs.some(tab => tab.mode === "loaded")} onClick={() => menuAction("close-all")}><Icon name="close" size={15} />모두 닫기</button>
        <div className="tab-menu-divider" />
        <button role="menuitemcheckbox" aria-checked={layout.hideInactive} onClick={() => menuAction("hide-inactive", { enabled: !layout.hideInactive })}><span className="menu-check">{layout.hideInactive && <Icon name="check" size={15} />}</span>비활성 탭 숨김</button>
      </> : <>
        {workspaceTabs.map(tab => <button role="menuitem" key={tab.id} onClick={() => menuAction("new-tab", { kind: tab.id })}><Icon name={tab.icon} size={15} />{tab.text}</button>)}
        {layout.tabs.some(tab => tab.mode === "unloaded") && <><div className="tab-menu-divider" /><span className="tab-menu-caption">비활성 탭 열기</span>{layout.tabs.filter(tab => tab.mode === "unloaded").map(tab => <button role="menuitem" key={tab.id} onClick={() => { setMenu(null); openTab(tab.id); }}><Icon name="plus" size={15} />{workspaceTabs.find(info => info.id === tab.kind)?.text}</button>)}</>}
      </>}
    </div>}
  </div>;
}
