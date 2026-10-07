const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { WorkspaceLayout, isTab, makeTab, findTab, visibleBounds } = require("./workspace-layout.cjs");
const point = value => value && Number.isFinite(value.x) && Number.isFinite(value.y) && Math.abs(value.x) < 100000 && Math.abs(value.y) < 100000;
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
class WorkspaceWindows {
  constructor({ main, BrowserWindow, screen, file, icon, dev, hidden, broadcast, onSettings, onBlur, onMainChanged, onMainClose }) {
    Object.assign(this, { main, BrowserWindow, screen, icon, dev, hidden, broadcast, onSettings, onBlur, onMainChanged, onMainClose });
    this.layout = new WorkspaceLayout(file);
    this.windows = new Map([["main", main]]);
    this.zOrder = ["main"];
    this.drafts = new Map(); this.strips = new Map(); this.epochs = {}; this.drag = null; this.quitting = false;
    const rectangle = this.layout.window("main").bounds;
    if (rectangle) main.setBounds(visibleBounds(rectangle, screen.getAllDisplays()));
    this.trackBounds("main", main);
  }
  all() { return [...this.windows.values()].filter(win => !win.isDestroyed()); }
  id(win) { return [...this.windows].find(([, value]) => value === win)?.[0]; }
  owner(event) { return this.all().find(win => win.webContents === event.sender && event.senderFrame === win.webContents.mainFrame); }
  spinning(id) { return (this.drafts.get(id)?.["roulette.spinEndsAt"] || 0) > Date.now(); }
  snapshot(win) {
    const windowId = this.id(win), value = this.layout.window(windowId);
    return { version: 2, ...value, windowId, isMain: windowId === "main",
      drafts: Object.fromEntries((value?.tabs || []).filter(tab => tab.mode === "loaded").map(tab => [tab.id, this.drafts.get(tab.id) || {}])),
      rouletteSpinning: Object.fromEntries((value?.tabs || []).filter(tab => tab.kind === "roulette").map(tab => [tab.id, this.spinning(tab.id)])),
      epochs: this.epochs,
      drop: this.drag?.target?.windowId === windowId ? { id: this.drag.id, before: this.drag.target.before } : null };
  }
  emit() { for (const win of this.all()) win.webContents.send("assist:workspace-state", this.snapshot(win)); }
  restore() {
    for (const entry of this.layout.value.windows) if (entry.id !== "main") this.create(entry.id);
    this.emit();
  }
  trackBounds(id, win) {
    const dismiss = () => { if (!win.isDestroyed()) win.webContents.send("assist:workspace-dismiss-menu"); };
    // Native draggable title-bar areas do not dispatch DOM pointer events.
    if (process.platform === "win32" && win.hookWindowMessage) {
      win.hookWindowMessage(0x00a1, dismiss); // WM_NCLBUTTONDOWN
      win.hookWindowMessage(0x00a4, dismiss); // WM_NCRBUTTONDOWN
    }
    win.on("blur", dismiss); win.on("move", dismiss);
    win.on("focus", () => { const current=this.id(win);if(current){this.zOrder = this.zOrder.filter(value => value !== current); this.zOrder.push(current);} });
    let timer;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const current=this.id(win);
        if (this.quitting || win.isDestroyed() || !current || this.drag?.floatingId === current || !this.layout.window(current)) return;
        try { this.layout.update(next => { next.windows.find(row => row.id === current).bounds = win.getNormalBounds(); }); }
        catch (error) { win.webContents.send("assist:workspace-error", error.message); }
      }, 180);
    };
    win.on("move", save); win.on("resize", save);
    win.on("closed", () => { clearTimeout(timer);const current=this.id(win);if(current){this.strips.delete(current);this.zOrder=this.zOrder.filter(value=>value!==current);this.windows.delete(current);} });
  }
  create(id, inactive = false) {
    if (this.windows.has(id)) return this.windows.get(id);
    const value = this.layout.window(id);
    if (!value) throw new Error("열 창을 찾을 수 없습니다.");
    const saved = value.bounds || { ...this.main.getNormalBounds(), x: this.main.getBounds().x + 40, y: this.main.getBounds().y + 70 };
    const win = new this.BrowserWindow({ ...visibleBounds(saved, this.screen.getAllDisplays()), minWidth: 900, minHeight: 650,
      frame: false, show: false, backgroundColor: "#111214", title: "Streamer Assist · 작업 창", icon: this.icon,
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    this.windows.set(id, win); this.zOrder.push(id); this.trackBounds(id, win);
    win.on("page-title-updated", event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", event => event.preventDefault());
    win.webContents.on("did-finish-load", () => { this.emit(); this.broadcast(true); });
    win.webContents.on("did-start-loading", () => { this.onBlur?.(win); if (this.drag?.source === this.id(win)) this.finish(true); });
    win.on("blur", () => this.onBlur?.(win));
    win.once("ready-to-show", () => { if ((!this.hidden || this.main.isVisible()) && !win.isDestroyed()) inactive ? win.showInactive() : win.show(); });
    win.on("maximize", this.broadcast); win.on("unmaximize", this.broadcast); win.on("show", this.broadcast);
    win.on("close", event => {
      if (this.quitting) return;
      const currentId=this.id(win);
      if(currentId==="main"){this.onMainClose?.(event,win);return;}
      event.preventDefault();
      try {
        if (this.drag) this.finish(true);
        // Preserve open tools when closing an entire secondary window.
        const tabs = this.layout.window(currentId)?.tabs || [];
        this.layout.update(next => {
          const main = next.windows.find(row => row.id === "main");
          main.tabs.push(...tabs);
          const active = tabs.find(tab => tab.mode === "loaded"); if (active) main.active = active.id;
          next.windows = next.windows.filter(row => row.id !== currentId);
        });
        this.destroy(currentId); this.emit(); this.broadcast(true); this.show(this.main);
      } catch (error) { if (!win.isDestroyed()) win.webContents.send("assist:workspace-error", error.message); }
    });
    if (this.dev) {
      win.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "F12" && !input.control && !input.alt && !input.meta) { event.preventDefault(); win.webContents.toggleDevTools(); }
      });
      win.loadURL("http://127.0.0.1:5173/?workspace=" + encodeURIComponent(id));
    } else win.loadFile(path.join(__dirname, "../dist/index.html"), { query: { workspace: id } });
    return win;
  }
  show(win) { if (!win || win.isDestroyed()) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  fade(drag, win) {
    const allowed = !drag.windowMove && this.all().length >= 2;
    for (const [previous, opacity] of drag.opacities) if (previous !== win || !allowed) {
      if (!previous.isDestroyed()) previous.setOpacity?.(opacity);
      drag.opacities.delete(previous);
    }
    if (!allowed || !win || win.isDestroyed()) return;
    if (!drag.opacities.has(win)) { drag.opacities.set(win, win.getOpacity?.() ?? 1); win.setOpacity?.(.75); }
  }
  destroy(id) { const win = this.windows.get(id); this.windows.delete(id); if (win && !win.isDestroyed()) win.destroy(); }
  removeMergedSource(sourceId, destinationId) {
    const source=this.windows.get(sourceId),destination=this.windows.get(destinationId);
    if(!source||!destination)return;
    const promote=sourceId==="main",destinationStrip=this.strips.get(destinationId);
    this.layout.update(next=>{
      next.windows=next.windows.filter(row=>row.id!==sourceId);
      if(promote)next.windows.find(row=>row.id===destinationId).id="main";
    });
    this.onBlur?.(source);
    this.windows.delete(sourceId);this.strips.delete(sourceId);this.zOrder=this.zOrder.filter(id=>id!==sourceId);
    if(promote){
      this.windows.delete(destinationId);this.windows.set("main",destination);
      this.strips.delete(destinationId);if(destinationStrip)this.strips.set("main",destinationStrip);
      this.zOrder=this.zOrder.map(id=>id===destinationId?"main":id);
      this.main=destination;this.onMainChanged?.(destination);
    }
    if(!source.isDestroyed())source.destroy();
  }
  target(p) {
    for (const id of [...this.zOrder].reverse()) {
      const win = this.windows.get(id);
      const strip = this.strips.get(id);
      if (id === this.drag?.floatingId || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) continue;
      if (!inside(p, win.getBounds())) continue;
      // A visible window body occludes any strip underneath it.
      if (!strip) return null;
      const origin = win.getContentBounds();
      if (!inside(p, { ...strip.rect, x: origin.x + strip.rect.x, y: origin.y + strip.rect.y })) return null;
      return { windowId: id, before: strip.tabs.find(tab => tab.id !== this.drag?.id && p.x < origin.x + tab.x + tab.width / 2)?.id || null };
    }
    return null;
  }
  matchesDrag(windowId, payload) { return this.drag?.source === windowId && (!this.drag.token || this.drag.token === payload.token); }
  moveDrag(drag, p) {
    const oldTarget = drag.target;
    drag.point = p;
    clearTimeout(drag.timeout); drag.timeout = setTimeout(() => { try { this.finish(true); } catch {} }, 120000);
    drag.target = drag.windowMove ? null : this.target(p);
    let changed = oldTarget?.windowId !== drag.target?.windowId || oldTarget?.before !== drag.target?.before;
    if (this.layout.tab(drag.id)?.tab.mode !== "unloaded" && (!drag.target || drag.reuseWindow)) {
      if (!drag.floatingId) {
        const source = this.windows.get(drag.source), value = this.layout.window(drag.source);
        drag.floatingId = "win-" + randomUUID();
        this.layout.update(next => { next.windows.push({ id: drag.floatingId, tabs: [], active: "home", hideInactive: value.hideInactive, bounds: source.getNormalBounds() }); });
        this.layout.move(drag.id, drag.floatingId);
        try { this.create(drag.floatingId, true); } catch (error) { this.finish(true); throw error; }
        changed = true;
      }
      const floating = this.windows.get(drag.floatingId);
      if (floating && !floating.isDestroyed()) {
        this.fade(drag, floating);
        if (floating.isMaximized()) {
          floating.unmaximize();
          if (drag.reuseWindow) drag.offset.x = drag.offset.x / drag.width * floating.getBounds().width;
        }
        const x = Math.round(p.x - (drag.reuseWindow ? drag.offset.x : Math.min(drag.offset.x, 150))), y = Math.round(p.y - drag.offset.y);
        if (drag.position?.x !== x || drag.position?.y !== y) { floating.setPosition(x, y); drag.position = { x, y }; }
      }
    }
    // Pointer motion moves the native window; React receives updates only when
    // a tab's ownership or insertion marker changes.
    if (changed) this.emit();
  }
  finish(cancel = false) {
    const drag = this.drag; if (!drag) return;
    clearTimeout(drag.timeout);
    const source = this.windows.get(drag.source);
    if (source && !source.isDestroyed() && drag.backgroundThrottling !== undefined) source.webContents?.setBackgroundThrottling?.(drag.backgroundThrottling);
    for (const [win, opacity] of drag.opacities) if (!win.isDestroyed()) win.setOpacity?.(opacity);
    if (cancel) {
      this.layout.update(next => Object.assign(next, drag.original));
      this.drag = null;
      if (drag.floatingId && !drag.original.windows.some(win => win.id === drag.floatingId)) this.destroy(drag.floatingId);
      else if (drag.floatingId) {
        const win = this.windows.get(drag.floatingId); win?.setBounds(drag.originalBounds);
        if (drag.originalMaximized) win?.maximize();
      }
    } else {
      if (drag.target && !drag.windowMove) this.layout.move(drag.id, drag.target.windowId, drag.target.before);
      const current = drag.windowMove ? { window: this.layout.window(drag.source) } : this.layout.tab(drag.id);
      const destination=current&&this.windows.get(current.window.id);
      this.drag = null;
      if (drag.floatingId && current?.window.id !== drag.floatingId && !drag.original.windows.some(win => win.id === drag.floatingId)) {
        this.layout.update(next => { next.windows = next.windows.filter(win => win.id !== drag.floatingId); });
        this.destroy(drag.floatingId);
      }
      if(drag.target&&!drag.windowMove&&current&&current.window.id!==drag.source&&this.layout.window(drag.source)&&!this.layout.window(drag.source).tabs.some(tab=>tab.mode==="loaded"))
        this.removeMergedSource(drag.source,current.window.id);
      if (destination) this.show(destination);
      const moved = this.windows.get(drag.floatingId);
      if (moved && !moved.isDestroyed() && this.layout.window(drag.floatingId))
        this.layout.update(next => { next.windows.find(row => row.id === drag.floatingId).bounds = moved.getNormalBounds(); });
    }
    this.emit(); this.broadcast(true);
  }
  clone(win, id, separate) {
    const source = this.layout.tab(id);
    if (!source || source.window.id !== this.id(win)) throw new Error("열 탭을 찾을 수 없습니다.");
    const tab = makeTab(source.tab.kind), destination = separate ? "win-" + randomUUID() : source.window.id;
    const original = structuredClone(this.layout.value);
    this.layout.update(next => {
      if (separate) next.windows.push({ id: destination, tabs: [tab], active: tab.id, hideInactive: source.window.hideInactive,
        bounds: { ...win.getNormalBounds(), x: win.getBounds().x + 40, y: win.getBounds().y + 70 } });
      else { const target = next.windows.find(row => row.id === destination); const index = target.tabs.findIndex(row => row.id === id); target.tabs.splice(index + 1, 0, tab); target.active = tab.id; }
    });
    this.drafts.set(tab.id, { ...structuredClone(this.drafts.get(id) || {}), __seedFrom: id });
    try { if (separate) this.create(destination); }
    catch (error) { this.drafts.delete(tab.id); this.layout.update(next => Object.assign(next, original)); throw error; }
    this.emit(); if (!separate) this.show(win);
    return { id: tab.id, windowId: destination };
  }
  async handle(win, action, payload = {}) {
    const windowId = this.id(win), value = this.layout.window(windowId);
    const owned = id => this.layout.tab(id)?.window.id === windowId || (this.drag?.id === id && this.drag.source === windowId);
    switch (action) {
      case "state": return this.snapshot(win);
      case "strip": {
        const { rect, tabs } = payload;
        if (!rect || !["x", "y", "width", "height"].every(key => Number.isFinite(rect[key])) || rect.width < 0 || rect.height < 0 || !Array.isArray(tabs) || tabs.length > value.tabs.length) throw new Error("탭 영역을 확인할 수 없습니다.");
        this.strips.set(windowId, { rect, tabs: tabs.filter(tab => owned(tab.id) && Number.isFinite(tab.x) && Number.isFinite(tab.width)) }); return;
      }
      case "draft": {
        const entry = this.layout.tab(payload.id);
        if (!entry || entry.tab.mode === "unloaded") return;
        if (!owned(payload.id) || typeof payload.key !== "string" || payload.key.length > 80 || ["__proto__", "constructor", "prototype", "__seedFrom"].includes(payload.key) || JSON.stringify(payload.value ?? null).length > 65536) throw new Error("허용되지 않은 탭 변경입니다.");
        const draft = { ...this.drafts.get(payload.id), [payload.key]: payload.value };
        if (JSON.stringify(draft).length > 262144) throw new Error("탭 입력 내용이 너무 큽니다.");
        this.drafts.set(payload.id, draft); if (payload.key === "roulette.spinEndsAt") this.emit(); return;
      }
      case "open": {
        let id = payload.id;
        if (["home", "settings"].includes(id)) {
          this.layout.update(next => { next.windows.find(row => row.id === windowId).active = id; });
          if (id === "settings") this.onSettings?.(win, payload);
        } else {
          let entry = this.layout.tab(id);
          if (!entry || entry.window.id !== windowId) {
            const existing = value.tabs.find(tab => tab.kind === id);
            if (existing) id = existing.id;
            else if (isTab(id)) {
              const tab = makeTab(id); id = tab.id;
              this.layout.update(next => { next.windows.find(row => row.id === windowId).tabs.push(tab); });
            } else throw new Error("지원하지 않는 탭입니다.");
          }
          this.layout.update(next => { const entry = findTab(next, id); entry.tab.mode = "loaded"; entry.window.active = id; });
        }
        this.emit(); return { id };
      }
      case "new-tab": {
        if (payload.id) return this.clone(win, payload.id, false);
        const placeholder = value.tabs.find(tab => tab.kind === payload.kind && tab.mode === "unloaded");
        const tab = placeholder ? { ...placeholder, mode: "loaded" } : makeTab(payload.kind);
        this.layout.update(next => {
          const target = next.windows.find(row => row.id === windowId);
          if (placeholder) target.tabs.find(row => row.id === tab.id).mode = "loaded";
          else target.tabs.push(tab);
          target.active = tab.id;
        });
        this.emit(); return { id: tab.id, windowId };
      }
      case "new-window": return this.clone(win, payload.id, true);
      case "hide-inactive":
        if (typeof payload.enabled !== "boolean") throw new Error("표시 옵션을 확인하세요.");
        this.layout.update(next => { next.windows.find(row => row.id === windowId).hideInactive = payload.enabled; }); this.emit(); return;
      case "close-tab":
        if (!owned(payload.id) || this.drag) throw new Error("닫을 수 없는 탭입니다.");
        this.layout.close(payload.id); this.drafts.delete(payload.id); this.emit(); return;
      case "close-all": {
        if (this.drag) throw new Error("이동을 마친 뒤 탭을 닫으세요.");
        const ids = value.tabs.map(tab => tab.id);
        this.layout.closeAll(windowId);
        for (const id of ids) this.drafts.delete(id);
        this.emit(); return;
      }
      case "drag-start": {
        const windowMove = payload.windowMove === true;
        if ((!windowMove && (!owned(payload.id) || !this.layout.tab(payload.id))) || !point(payload.point) || this.drag || (payload.token !== undefined && (typeof payload.token !== "string" || payload.token.length > 80))) throw new Error("이동할 수 없는 탭입니다.");
        const reuseWindow = windowMove || (this.layout.tab(payload.id)?.tab.mode === "loaded" && value.tabs.filter(tab => tab.mode === "loaded").length === 1);
        this.drag = { id: payload.id, source: windowId, original: structuredClone(this.layout.value), originalBounds: win.getNormalBounds(), originalMaximized: win.isMaximized(),
          offset: { x: payload.point.x - win.getBounds().x, y: payload.point.y - win.getBounds().y }, width: win.getBounds().width,
          windowMove, reuseWindow, token: payload.token, point: payload.point, opacities: new Map(), target: null, floatingId: reuseWindow ? windowId : null };
        if (win.webContents?.setBackgroundThrottling) {
          this.drag.backgroundThrottling = win.webContents.getBackgroundThrottling();
          win.webContents.setBackgroundThrottling(false);
        }
        return;
      }
      case "drag-move": {
        if (this.matchesDrag(windowId, payload) && point(payload.point)) this.moveDrag(this.drag, payload.point);
        return;
      }
      case "drag-end": {
        if (!this.matchesDrag(windowId, payload)) return;
        if (point(payload.point)) {
          const target = this.drag.windowMove ? null : this.target(payload.point);
          if (target) this.drag.target = target;
          else this.moveDrag(this.drag, payload.point);
        }
        this.finish(false); return;
      }
      case "drag-cancel": if (this.matchesDrag(windowId, payload)) this.finish(true); return;
      case "roulette-import": {
        if (!owned(payload.source) || !["poll", "donation", "roulette"].includes(this.layout.tab(payload.source)?.tab.kind) || !Array.isArray(payload.items) || payload.items.length > 12 || typeof payload.title !== "string") throw new Error("룰렛 항목을 확인하세요.");
        let target = this.layout.tab(payload.source)?.tab.kind === "roulette" ? this.layout.tab(payload.source).tab : value.tabs.find(tab => tab.kind === "roulette" && tab.mode === "loaded" && !this.spinning(tab.id));
        if (!target) { target = makeTab("roulette"); this.layout.update(next => { next.windows.find(row => row.id === windowId).tabs.push(target); }); }
        if (this.spinning(target.id)) throw new Error("룰렛이 멈춘 뒤 다시 시도하세요.");
        this.drafts.set(target.id, { ...this.drafts.get(target.id), imported: { id: randomUUID(), title: payload.title.slice(0, 100), items: payload.items } });
        this.layout.update(next => { next.windows.find(row => row.id === windowId).active = target.id; }); this.emit(); return;
      }
      case "roulette-reset": {
        const ids = value.tabs.filter(tab => tab.kind === "roulette").map(tab => tab.id);
        if (ids.some(id => this.spinning(id))) throw new Error("룰렛이 멈춘 뒤 다시 시도하세요.");
        for (const id of ids) { this.drafts.delete(id); this.epochs[id] = (this.epochs[id] || 0) + 1; }
        win.webContents.send("assist:workspace-reset-roulette", ids); this.emit(); return;
      }
      default: throw new Error("지원하지 않는 탭 동작입니다.");
    }
  }
  shutdown() {
    this.quitting = true;
    if (this.drag) this.finish(false);
    this.layout.update(next => { for (const row of next.windows) { const win = this.windows.get(row.id); if (win && !win.isDestroyed()) row.bounds = win.getNormalBounds(); } });
  }
}
module.exports = { WorkspaceWindows };
