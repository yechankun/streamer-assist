const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const TABS = ["timeline", "raffle", "poll", "donation", "roulette"];
const isTab = kind => TABS.includes(kind);
const validId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id) && !["home", "settings", "__proto__", "constructor", "prototype"].includes(id);
const makeTab = (kind, id = "tab-" + randomUUID()) => {
  if (!isTab(kind) || !validId(id)) throw new Error("지원하지 않는 탭입니다.");
  return { id, kind, mode: "loaded" };
};
function bounds(value) {
  if (!value || !["x", "y", "width", "height"].every(key => Number.isFinite(value[key]))) return undefined;
  return { x: Math.round(Math.max(-100000, Math.min(100000, value.x))),
    y: Math.round(Math.max(-100000, Math.min(100000, value.y))),
    width: Math.round(Math.max(900, Math.min(10000, value.width))),
    height: Math.round(Math.max(650, Math.min(10000, value.height))) };
}
const inactiveTab = (kind, id) => ({ ...makeTab(kind, id), mode: "unloaded" });
const mainWindow = () => ({ id: "main", tabs: TABS.map(kind => inactiveTab(kind, kind)), active: "home", hideInactive: false, hideTopbar: false });
function completeWindows(windows) {
  const reserved = new Set(windows.flatMap(win => win.tabs.map(tab => tab.id)));
  for (const win of windows) {
    // A placeholder represents an absent tool; it does not retain a tool view.
    const loaded = new Set(win.tabs.filter(tab => tab.mode === "loaded").map(tab => tab.kind)), inactive = new Set();
    win.tabs = win.tabs.filter(tab => {
      if (tab.mode === "loaded") return true;
      if (loaded.has(tab.kind) || inactive.has(tab.kind)) return false;
      inactive.add(tab.kind); return true;
    });
    for (const kind of TABS) {
      if (win.tabs.some(tab => tab.kind === kind)) continue;
      const base = "inactive-" + win.id.slice(0, 48) + "-" + kind;
      let id = base, suffix = 1;
      while (reserved.has(id)) id = base + "-" + suffix++;
      reserved.add(id); win.tabs.push(inactiveTab(kind, id));
    }
  }
  return { version: 2, windows };
}
function normalize(saved = {}) {
  if (!saved || typeof saved !== "object") saved = {};
  if (saved.version !== 2 || !Array.isArray(saved.windows)) {
    const main = mainWindow(), windows = [main];
    const order = [...new Set((Array.isArray(saved.order) ? saved.order : []).filter(isTab))];
    for (const id of TABS) if (!order.includes(id)) order.push(id);
    main.tabs = order.flatMap(kind => {
      const previous = saved.tabs?.[kind];
      const tab = previous && ["docked", "detached"].includes(previous.mode) ? makeTab(kind, kind) : inactiveTab(kind, kind);
      if (previous?.mode === "detached") {
        windows.push({ id: "window-" + kind, tabs: [tab], active: tab.id, hideInactive: false, hideTopbar: false,
          ...(bounds(previous.bounds) ? { bounds: bounds(previous.bounds) } : {}) });
        return [];
      }
      if (previous?.mode === "unloaded") tab.mode = "unloaded";
      return [tab];
    });
    if (["home", "settings"].includes(saved.active) || main.tabs.some(tab => tab.id === saved.active && tab.mode === "loaded")) main.active = saved.active;
    return completeWindows(windows);
  }
  const windowIds = new Set(), tabIds = new Set();
  const windows = saved.windows.filter(win => win && validId(win.id) && !windowIds.has(win.id) && windowIds.add(win.id)).map(win => {
    const tabs = (Array.isArray(win.tabs) ? win.tabs : []).filter(tab => tab && isTab(tab.kind) && validId(tab.id) && !tabIds.has(tab.id) && tabIds.add(tab.id))
      .map(tab => ({ id: tab.id, kind: tab.kind, mode: tab.mode === "unloaded" ? "unloaded" : "loaded" }));
    const active = ["home", "settings"].includes(win.active) || tabs.some(tab => tab.id === win.active && tab.mode === "loaded") ? win.active : tabs.find(tab => tab.mode === "loaded")?.id || "home";
    return { id: win.id, tabs, active, hideInactive: win.hideInactive === true, hideTopbar: win.hideTopbar === true,
      ...(bounds(win.bounds) ? { bounds: bounds(win.bounds) } : {}) };
  });
  if (!windows.some(win => win.id === "main")) {
    const main = mainWindow(); main.tabs = main.tabs.filter(tab => !tabIds.has(tab.id)); windows.unshift(main);
  }
  return completeWindows(windows);
}
const fallback = win => { if (!win.tabs.some(tab => tab.id === win.active && tab.mode === "loaded") && !["home", "settings"].includes(win.active)) win.active = win.tabs.find(tab => tab.mode === "loaded")?.id || "home"; };
function findTab(value, id) {
  for (const win of value.windows) {
    const index = win.tabs.findIndex(tab => tab.id === id);
    if (index >= 0) return { window: win, tab: win.tabs[index], index };
  }
  return null;
}
class WorkspaceLayout {
  constructor(file) {
    this.file = file; let saved;
    try { saved = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT" && fs.existsSync(file)) fs.copyFileSync(file, file + ".corrupt-" + Date.now()); }
    this.value = normalize(saved);
  }
  window(id) { return this.value.windows.find(win => win.id === id); }
  tab(id) { return findTab(this.value, id); }
  update(change) {
    const next = structuredClone(this.value); change(next);
    const value = normalize(next), temporary = this.file + ".tmp";
    try { fs.writeFileSync(temporary, JSON.stringify(value)); fs.renameSync(temporary, this.file); }
    catch (error) { try { fs.unlinkSync(temporary); } catch {} throw new Error("탭 배치를 저장하지 못했습니다.", { cause: error }); }
    this.value = value; return value;
  }
  move(id, targetId, before = null) {
    if (!this.tab(id) || !this.window(targetId)) throw new Error("이동할 탭과 창을 확인하세요.");
    if (before === id && this.tab(id).window.id === targetId) return this.value;
    return this.update(next => {
      const source = findTab(next, id), target = next.windows.find(win => win.id === targetId);
      source.window.tabs.splice(source.index, 1); fallback(source.window);
      if (source.window !== target && !source.window.tabs.some(tab => tab.kind === source.tab.kind)) {
        source.window.tabs.splice(source.index, 0, inactiveTab(source.tab.kind));
      }
      if (source.window !== target) {
        // Replace the target's absence marker at its existing position.
        const placeholder = target.tabs.findIndex(tab => tab.kind === source.tab.kind && tab.mode === "unloaded");
        if (placeholder >= 0 && (before === null || before === target.tabs[placeholder].id)) {
          target.tabs.splice(placeholder, 1, source.tab);
          if (source.tab.mode === "loaded") target.active = id;
          return;
        }
        if (source.tab.mode === "loaded") target.tabs = target.tabs.filter(tab => tab.kind !== source.tab.kind || tab.mode === "loaded");
      }
      const index = target.tabs.findIndex(tab => tab.id === before);
      target.tabs.splice(index < 0 ? target.tabs.length : index, 0, source.tab);
      if (source.tab.mode === "loaded") target.active = id;
    });
  }
  close(id) {
    if (!this.tab(id)) throw new Error("변경할 수 없는 탭입니다.");
    return this.update(next => { const entry = findTab(next, id); entry.tab.mode = "unloaded"; fallback(entry.window); });
  }
  closeAll(windowId) {
    if (!this.window(windowId)) throw new Error("변경할 창을 찾을 수 없습니다.");
    return this.update(next => {
      const window = next.windows.find(row => row.id === windowId);
      for (const tab of window.tabs) tab.mode = "unloaded";
      fallback(window);
    });
  }
}
function visibleBounds(rectangle, displays) {
  const areas = displays.map(display => display.workArea);
  const chosen = areas.find(area => rectangle.x + 100 > area.x && rectangle.x < area.x + area.width - 100 && rectangle.y + 40 > area.y && rectangle.y < area.y + area.height - 40) || areas[0];
  if (!chosen) return rectangle;
  return { ...rectangle,
    x: Math.round(Math.max(chosen.x, Math.min(rectangle.x, chosen.x + chosen.width - Math.min(rectangle.width, chosen.width)))),
    y: Math.round(Math.max(chosen.y, Math.min(rectangle.y, chosen.y + chosen.height - Math.min(rectangle.height, chosen.height)))) };
}
module.exports = { TABS, isTab, makeTab, inactiveTab, findTab, normalize, bounds, visibleBounds, WorkspaceLayout };
