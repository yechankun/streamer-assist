const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { TABS, makeTab, normalize, visibleBounds, WorkspaceLayout } = require("../electron/workspace-layout.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "streamer-workspace-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "workspace-layout.json");
  return { file, layout: new WorkspaceLayout(file) };
}
test("v1 migrates order, closed tools and detached bounds without duplicating IDs", () => {
  const value = normalize({ version: 1, order: ["roulette", "poll", "raffle"], active: "poll", tabs: { poll: { mode: "detached", bounds: { x: -1000, y: 20, width: 1024, height: 740 } }, raffle: { mode: "unloaded" } } });
  assert.equal(value.version, 2);
  assert.equal(value.windows[0].tabs[0].kind, "roulette");
  assert.equal(value.windows[0].tabs.find(tab => tab.kind === "raffle").mode, "unloaded");
  const child = value.windows.find(win => win.id === "window-poll");
  assert.equal(child.tabs[0].id, "poll"); assert.equal(child.active, "poll");
  assert.equal(child.bounds.x, -1000); assert.equal(value.windows[0].active, "home");
  const ids = value.windows.flatMap(win => win.tabs.map(tab => tab.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const win of value.windows) assert.deepEqual([...new Set(win.tabs.map(tab => tab.kind))].sort(), [...TABS].sort());
});
test("same-kind instances, window options, active tabs and order survive a new store", t => {
  const { file, layout } = fixture(t), copy = makeTab("poll"), child = "window-copy";
  layout.update(next => { next.windows[0].tabs.find(tab => tab.id === "poll").mode = "loaded"; });
  layout.update(next => { next.windows.push({ id: child, tabs: [copy], active: copy.id, hideInactive: true, bounds: { x: 20, y: 30, width: 1000, height: 740 } }); });
  layout.move("poll", child, copy.id);
  layout.close(copy.id);
  const restart = new WorkspaceLayout(file);
  assert.deepEqual(restart.value, layout.value);
  assert.equal(restart.window(child).tabs.filter(tab => tab.kind === "poll").length, 1);
  assert.equal(restart.window(child).tabs[0].id, "poll");
  assert.equal(restart.window(child).active, "poll");
  assert.equal(restart.window(child).hideInactive, true);
  assert.equal(restart.window("main").hideInactive, false);
  restart.move("poll", "main", "timeline");
  assert.equal(restart.window("main").tabs[0].id, "poll");
  assert.equal(restart.window(child).active, "home");
});
test("settings is fixed and sparse windows get every inactive tool without repeated IDs", () => {
  for (const saved of [null, 7, {}]) assert.deepEqual(normalize(saved).windows[0].tabs.map(tab => tab.kind), TABS);
  assert.throws(() => makeTab("settings"), /탭/);
  const value = normalize({ version: 2, windows: [
    { id: "main", tabs: [], active: "settings", hideInactive: true },
    { id: "child", tabs: [{ id: "p1", kind: "poll" }, { id: "p2", kind: "poll" }, { id: "p1", kind: "roulette" }, { id: "s1", kind: "settings" }] },
    { id: "child2", tabs: [{ id: "p2", kind: "poll" }, { id: "p3", kind: "poll" }] },
  ] });
  assert.equal(value.windows[0].tabs.length, 5); assert.equal(value.windows[0].active, "settings");
  assert.ok(value.windows[0].tabs.every(tab => tab.mode === "unloaded"));
  assert.deepEqual(value.windows[1].tabs.filter(tab => tab.mode === "loaded").map(tab => tab.id), ["p1", "p2"]);
  assert.deepEqual(value.windows[2].tabs.filter(tab => tab.mode === "loaded").map(tab => tab.id), ["p3"]);
});
test("corruption is backed up and failed atomic writes leave current ownership intact", t => {
  const { file, layout } = fixture(t), original = structuredClone(layout.value);
  assert.throws(() => layout.move("settings", "main"), /탭/);
  fs.mkdirSync(file + ".tmp");
  assert.throws(() => layout.close("poll"), /저장/);
  assert.deepEqual(layout.value, original); fs.rmdirSync(file + ".tmp");
  fs.writeFileSync(file, "bad json");
  assert.deepEqual(new WorkspaceLayout(file).value, normalize());
  assert.ok(fs.readdirSync(path.dirname(file)).some(name => name.startsWith("workspace-layout.json.corrupt-")));
});
test("cross-window moves retain closed state and preserve the selected settings page", t => {
  const { layout } = fixture(t);
  layout.close("poll");
  layout.update(next => { next.windows.push({ id: "empty", tabs: [], active: "settings", hideInactive: false }); });
  layout.move("poll", "empty");
  assert.equal(layout.window("empty").active, "settings");
  assert.equal(layout.window("empty").tabs.find(tab => tab.id === "poll").mode, "unloaded");
  assert.equal(layout.window("main").tabs.find(tab => tab.kind === "poll").mode, "unloaded");
});
test("fresh windows start with zero loaded tools and every kind has one baseline slot", () => {
  const value = normalize();
  assert.ok(value.windows[0].tabs.every(tab => tab.mode === "unloaded"));
  assert.equal(value.windows[0].active, "home");
  const sparse = normalize({ version: 2, windows: [{ id: "main", tabs: [] }, { id: "child", tabs: [makeTab("roulette", "r1")], active: "r1" }] });
  const child = sparse.windows[1];
  assert.equal(child.tabs.length, 5);
  assert.equal(child.tabs.filter(tab => tab.mode === "loaded").length, 1);
  assert.ok(child.tabs.filter(tab => tab.kind !== "roulette").every(tab => tab.mode === "unloaded"));
});
test("moving the last loaded instance leaves a placeholder in its original position", t => {
  const { layout } = fixture(t);
  layout.update(next => {
    next.windows[0].tabs.find(tab => tab.id === "poll").mode = "loaded";
    next.windows[0].active = "poll";
    next.windows.push({ id: "child", tabs: [], active: "home", hideInactive: false });
  });
  const before = layout.window("main").tabs.findIndex(tab => tab.kind === "poll");
  layout.move("poll", "child");
  assert.equal(layout.window("main").tabs[before].kind, "poll");
  assert.equal(layout.window("main").tabs[before].mode, "unloaded");
  assert.notEqual(layout.window("main").tabs[before].id, "poll");
  assert.equal(layout.tab("poll").window.id, "child");
  assert.equal(layout.window("child").tabs.filter(tab => tab.kind === "poll").length, 1);
  layout.close("poll");
  assert.equal(layout.tab("poll").tab.mode, "unloaded");
  assert.ok(layout.window("child").tabs.every(tab => tab.mode === "unloaded"));
});
test("closing all tabs keeps one placeholder per kind, other windows and fixed settings", t => {
  const {layout,file}=fixture(t);
  layout.update(next=>{
    for(const tab of next.windows[0].tabs)tab.mode="loaded";
    next.windows[0].tabs.push(makeTab("poll","poll-copy"));next.windows[0].active="poll-copy";
    next.windows.push({id:"child",tabs:[makeTab("roulette","child-roulette")],active:"child-roulette",hideInactive:true});
  });
  const child=structuredClone(layout.window("child"));
  layout.closeAll("main");
  assert.equal(layout.window("main").active,"home");
  assert.deepEqual(layout.window("main").tabs.map(tab=>tab.kind),TABS);
  assert.ok(layout.window("main").tabs.every(tab=>tab.mode==="unloaded"));
  assert.deepEqual(layout.window("child"),child);
  assert.deepEqual(new WorkspaceLayout(file).value,layout.value);
  layout.update(next=>{next.windows[0].active="settings";next.windows[0].tabs[0].mode="loaded";});
  layout.closeAll("main");assert.equal(layout.window("main").active,"settings");
  assert.throws(()=>layout.closeAll("unknown"));
});
test("restored windows remain reachable after a monitor is removed", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  assert.deepEqual(visibleBounds({ x: 6000, y: -2000, width: 900, height: 650 }, displays), { x: 1020, y: 0, width: 900, height: 650 });
  assert.equal(visibleBounds({ x: -1600, y: 100, width: 1000, height: 740 }, [{ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }, ...displays]).x, -1600);
});

test("topbar visibility is saved per window, copied to new windows and removes invisible drop targets", async t => {
  const { WorkspaceWindows } = require("../electron/workspace-windows.cjs");
  const { layout, file } = fixture(t);
  layout.update(next => {
    next.windows[0].tabs.find(tab => tab.id === "poll").mode = "loaded";
    next.windows.push({ id: "child", tabs: [], active: "home", hideInactive: false });
  });
  const fake = () => ({ isDestroyed: () => false, getNormalBounds: () => ({ x: 0, y: 0, width: 900, height: 650 }), getBounds: () => ({ x: 0, y: 0, width: 900, height: 650 }) });
  const main = fake(), child = fake(), manager = Object.create(WorkspaceWindows.prototype);
  Object.assign(manager, { layout, windows: new Map([["main", main], ["child", child]]), drafts: new Map(), strips: new Map([["main", {}]]), emit: () => {}, create: fake, drag: null });
  await manager.handle(main, "hide-topbar", { enabled: true });
  assert.equal(layout.window("main").hideTopbar, true);
  assert.equal(layout.window("child").hideTopbar, false);
  assert.equal(manager.strips.has("main"), false);
  await manager.handle(main, "strip", { rect: { x: 0, y: 0, width: 800, height: 60 }, tabs: [] });
  assert.equal(manager.strips.has("main"), false, "late geometry cannot restore a hidden drop target");
  const cloned = manager.clone(main, "poll", true);
  assert.equal(layout.window(cloned.windowId).hideTopbar, true);
  await manager.handle(main, "hide-topbar", { enabled: false });
  assert.equal(layout.window(cloned.windowId).hideTopbar, true, "copied window owns its own option");
  assert.deepEqual(new WorkspaceLayout(file).value, layout.value);
  await assert.rejects(manager.handle(main, "hide-topbar", { enabled: "yes" }), /표시 옵션/);
});
test("window reuse depends on local tabs while opacity depends on the total number of windows", async t => {
  const { WorkspaceWindows } = require("../electron/workspace-windows.cjs");
  const fake = () => { const rectangle={x:0,y:0,width:900,height:650};let opacity=1;return {getNormalBounds:()=>rectangle,getBounds:()=>rectangle,isMaximized:()=>false,isDestroyed:()=>false,getOpacity:()=>opacity,setOpacity:value=>{opacity=value;}}; };
  for(const local of [1,2])for(const other of [undefined,0,1]){
    const {layout}=fixture(t);
    layout.update(next=>{next.windows[0].tabs.find(tab=>tab.id==="poll").mode="loaded";if(local===2)next.windows[0].tabs.find(tab=>tab.id==="timeline").mode="loaded";if(other!==undefined)next.windows.push({id:"child",tabs:other?[makeTab("roulette","child-roulette")]:[],active:"settings",hideInactive:true});});
    const main=fake(), manager=Object.create(WorkspaceWindows.prototype);manager.layout=layout;manager.windows=new Map([["main",main]]);manager.drag=null;
    if(other!==undefined)manager.windows.set("child",fake());
    await manager.handle(main,"drag-start",{id:"poll",point:{x:200,y:20}});
    assert.equal(manager.drag.reuseWindow,local===1);assert.equal(manager.drag.floatingId,local===1?"main":null);
    const moving=local===1?main:fake();if(local===2)manager.windows.set("floating",moving);
    manager.fade(manager.drag,moving);
    assert.equal(moving.getOpacity(),manager.all().length>=2?.75:1);
    if(local===2)assert.equal(main.getOpacity(),1,"the stationary origin stays opaque");
  }
});

test("dragging onto an auto-hidden topbar reveals its cached drop geometry and leaving hides it", async t => {
  const { WorkspaceWindows } = require("../electron/workspace-windows.cjs");
  const { layout } = fixture(t); layout.update(next => { next.windows[0].hideTopbar = true; });
  const messages = [], rectangle = { x: 0, y: 0, width: 900, height: 650 };
  const main = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, getBounds: () => rectangle, getContentBounds: () => rectangle, webContents: { send: (name, data) => messages.push([name, data]) } };
  const manager = Object.create(WorkspaceWindows.prototype);
  Object.assign(manager, { layout, windows: new Map([["main", main]]), drafts: new Map(), strips: new Map(), stripGeometry: new Map(), headerHeights: new Map(), topbarPeeks: new Set(), zOrder: ["main"] });
  await manager.handle(main, "strip", { visible: false, headerHeight: 60, rect: { x: 100, y: 7, width: 700, height: 46 }, tabs: [{ id: "poll", x: 150, width: 100 }] });
  assert.equal(manager.target({ x: 200, y: 20 }), null);
  manager.peekTopbars({ x: 200, y: 20 });
  assert.equal(manager.target({ x: 200, y: 20 }).windowId, "main", "an immediate drop can use geometry before the slide animation ends");
  assert.equal(messages.at(-1)[1].topbarPeek, true);
  manager.peekTopbars({ x: 200, y: 180 });
  assert.equal(manager.target({ x: 200, y: 20 }), null);
  assert.equal(messages.at(-1)[1].topbarPeek, false);
  manager.forgetStrip("main"); assert.equal(manager.stripGeometry.size, 0); assert.equal(manager.headerHeights.size, 0);
});
test("drag opacity belongs to only one moving window and stays opaque when only one window exists", () => {
  const { WorkspaceWindows } = require("../electron/workspace-windows.cjs");
  const manager = Object.create(WorkspaceWindows.prototype);
  const fake = () => { let opacity = 1; return { isDestroyed: () => false, getOpacity: () => opacity, setOpacity: value => { opacity = value; } }; };
  const first = fake(), second = fake(), drag = { windowMove: false, opacities: new Map() };
  manager.windows=new Map([["first",first],["second",second]]);
  manager.fade(drag, first); assert.equal(first.getOpacity(), .75);
  manager.fade(drag, second);
  assert.equal(first.getOpacity(), 1); assert.equal(second.getOpacity(), .75);
  assert.equal(drag.opacities.size, 1);
  drag.windowMove=true;manager.fade(drag,second);assert.equal(second.getOpacity(),1,"logo movement stays opaque");
  drag.windowMove=false;manager.windows.delete("second");manager.fade(drag,first);assert.equal(first.getOpacity(),1);
});
test("a window body prevents docking into an occluded tab strip underneath", () => {
  const { WorkspaceWindows } = require("../electron/workspace-windows.cjs");
  const fake = rectangle => ({ isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, getBounds: () => rectangle, getContentBounds: () => rectangle });
  const manager = Object.create(WorkspaceWindows.prototype);
  manager.windows = new Map([["main", fake({ x: 0, y: 0, width: 900, height: 650 })], ["child", fake({ x: 40, y: 80, width: 900, height: 650 })]]);
  manager.strips = new Map([["main", { rect: { x: 60, y: 7, width: 600, height: 46 }, tabs: [] }], ["child", { rect: { x: 60, y: 7, width: 600, height: 46 }, tabs: [] }]]);
  manager.zOrder = ["child", "main"];
  assert.equal(manager.target({ x: 200, y: 110 }), null);
  manager.drag = { source: "main", opacities: new Map() };
  assert.equal(manager.target({ x: 200, y: 110 }), null, "the original window remains opaque and occludes windows behind it");
  manager.zOrder = ["main", "child"];
  assert.deepEqual(manager.target({ x: 200, y: 110 }), { windowId: "child", before: null });
});

function dragFixture(t, local = 2) {
  const {WorkspaceWindows}=require("../electron/workspace-windows.cjs"),{layout}=fixture(t);
  layout.update(next=>{next.windows[0].tabs.find(tab=>tab.id==="poll").mode="loaded";if(local===2)next.windows[0].tabs.find(tab=>tab.id==="timeline").mode="loaded";next.windows.push({id:"child",tabs:[makeTab("roulette","child-roulette")],active:"child-roulette",hideInactive:false,bounds:{x:1000,y:0,width:900,height:650}});});
  const counts={created:0,emits:0,moves:0,opacity:0,writes:0};
  const fake=x=>{let bounds={x,y:0,width:900,height:650},opacity=1,throttling=true,destroyed=false;return{isDestroyed:()=>destroyed,isVisible:()=>true,isMinimized:()=>false,isMaximized:()=>false,getBounds:()=>bounds,getNormalBounds:()=>bounds,getContentBounds:()=>bounds,setPosition:(x,y)=>{counts.moves++;bounds={...bounds,x,y};},setBounds:value=>{bounds=value;},getOpacity:()=>opacity,setOpacity:value=>{counts.opacity++;opacity=value;},show(){},focus(){},destroy(){destroyed=true;},webContents:{send(){},getBackgroundThrottling:()=>throttling,setBackgroundThrottling:value=>{throttling=value;}}};};
  const main=fake(0),child=fake(1000),manager=Object.create(WorkspaceWindows.prototype);
  Object.assign(manager,{main,layout,windows:new Map([["main",main],["child",child]]),strips:new Map([["main",{rect:{x:60,y:0,width:600,height:50},tabs:[]}],["child",{rect:{x:60,y:0,width:600,height:50},tabs:[]}]]),zOrder:["main","child"],drafts:new Map(),epochs:{},drag:null,broadcast(){}});
  manager.emit=()=>{counts.emits++;};
  manager.create=id=>{counts.created++;const win=fake(0);manager.windows.set(id,win);manager.zOrder.push(id);return win;};
  const update=layout.update.bind(layout);layout.update=change=>{counts.writes++;return update(change);};
  t.after(()=>clearTimeout(manager.drag?.timeout));
  return{manager,main,child,counts,file:layout.file};
}
test("native pointer motion does not rewrite layout or rebroadcast every frame and does not reset opacity",async t=>{
  const {manager,main,counts}=dragFixture(t,1);
  await manager.handle(main,"drag-start",{id:"poll",token:"smooth",point:{x:200,y:20}});
  assert.equal(main.webContents.getBackgroundThrottling(),false);
  for(let i=0;i<100;i++)await manager.handle(main,"drag-move",{token:"smooth",point:{x:200+i,y:180}});
  const positions=counts.moves;for(let i=0;i<100;i++)await manager.handle(main,"drag-move",{token:"smooth",point:{x:299,y:180}});
  assert.equal(counts.moves,positions);assert.equal(counts.opacity,1);assert.equal(counts.emits,0);assert.equal(counts.writes,0);assert.equal(counts.created,0);
  await manager.handle(main,"drag-cancel",{token:"smooth"});assert.equal(main.getOpacity(),1);assert.equal(main.webContents.getBackgroundThrottling(),true);
});

test("drag blur retains capture inside app windows and cancels only the matching gesture outside", async t => {
  const {manager, main, child} = dragFixture(t, 1);
  main.isFocused = () => false; child.isFocused = () => true;
  await manager.handle(main, "drag-start", {id: "poll", token: "focused", point: {x: 200, y: 20}});
  assert.equal(await manager.handle(main, "drag-blur", {token: "focused"}), false);
  assert.equal(manager.drag.token, "focused");
  child.isFocused = () => false;
  assert.equal(await manager.handle(main, "drag-blur", {token: "stale"}), false);
  assert.equal(manager.drag.token, "focused");
  assert.equal(await manager.handle(main, "drag-blur", {token: "focused"}), true);
  assert.equal(manager.drag, null);
  assert.equal(main.webContents.getBackgroundThrottling(), true);
});
test("dropping onto an existing window uses release coordinates and never leaves an unnecessary detached window",async t=>{
  const {manager,main,counts}=dragFixture(t);
  await manager.handle(main,"drag-start",{id:"poll",token:"merge",point:{x:200,y:20}});
  await manager.handle(main,"drag-move",{token:"merge",point:{x:300,y:180}});
  assert.equal(counts.created,1);
  await manager.handle(main,"drag-end",{token:"merge",point:{x:1130,y:25}});
  assert.equal(manager.layout.tab("poll").window.id,"child");assert.equal(manager.windows.size,2);assert.equal(manager.layout.value.windows.length,2);assert.equal(main.getOpacity(),1);
});
test("a fast drop needs no intermediate window and stale gesture messages cannot move a later drag",async t=>{
  const {manager,main,counts}=dragFixture(t);
  await manager.handle(main,"drag-start",{id:"poll",token:"first",point:{x:200,y:20}});
  await manager.handle(main,"drag-end",{token:"first",point:{x:1130,y:25}});
  assert.equal(counts.created,0);assert.equal(manager.layout.tab("poll").window.id,"child");
  await manager.handle(main,"drag-start",{id:"timeline",token:"second",point:{x:200,y:20}});
  await manager.handle(main,"drag-move",{token:"first",point:{x:300,y:180}});
  await manager.handle(main,"drag-end",{token:"first",point:{x:1130,y:25}});
  assert.equal(manager.drag.token,"second");assert.equal(manager.layout.tab("timeline").window.id,"main");assert.equal(counts.created,0);
  await manager.handle(main,"drag-cancel",{token:"second"});
});
test("merging a secondary window's last tab destroys that source and preserves its draft and the primary window",async t=>{
  const {manager,main,child,file}=dragFixture(t);
  manager.drafts.set("child-roulette",{"roulette.title":"옮기는 창의 항목"});
  await manager.handle(child,"drag-start",{id:"child-roulette",token:"close-source",point:{x:1200,y:20}});
  await manager.handle(child,"drag-end",{token:"close-source",point:{x:130,y:25}});
  assert.equal(child.isDestroyed(),true);assert.equal(main.isDestroyed(),false);
  assert.equal(manager.windows.size,1);assert.equal(manager.layout.window("child"),undefined);
  assert.equal(manager.layout.tab("child-roulette").window.id,"main");assert.equal(manager.drafts.get("child-roulette")["roulette.title"],"옮기는 창의 항목");
  assert.equal(new WorkspaceLayout(file).value.windows.length,1);
});
test("merging the primary window's last tab promotes the destination without recreating the empty source after restart",async t=>{
  const {manager,main,child,file}=dragFixture(t,1);let primary;
  manager.onMainChanged=win=>{primary=win;};manager.drafts.set("poll",{"page.question":"이동한 투표"});
  await manager.handle(main,"drag-start",{id:"poll",token:"promote",point:{x:200,y:20}});
  await manager.handle(main,"drag-end",{token:"promote",point:{x:1130,y:25}});
  assert.equal(main.isDestroyed(),true);assert.equal(child.isDestroyed(),false);assert.equal(primary,child);assert.equal(manager.main,child);
  assert.equal(manager.id(child),"main");assert.equal(manager.windows.size,1);
  assert.equal(manager.layout.tab("poll").window.id,"main");assert.equal(manager.layout.tab("child-roulette").window.id,"main");
  assert.equal(manager.drafts.get("poll")["page.question"],"이동한 투표");
  const restored=new WorkspaceLayout(file);assert.equal(restored.value.windows.length,1);assert.equal(restored.window("main").tabs.filter(tab=>tab.mode==="loaded").length,2);
});
