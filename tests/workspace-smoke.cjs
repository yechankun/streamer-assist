const { app, BrowserWindow, globalShortcut } = require("electron");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { waitFor, assertLayout, settleUI } = require("./layout-check.cjs");
const profile = process.env.STREAMER_ASSIST_TEST_PROFILE || path.join(__dirname, "../release/workspace-profile-" + Date.now());
fs.mkdirSync(profile, { recursive: true }); app.setPath("userData", profile);
const shortcut = "CommandOrControl+Alt+Shift+F9";
process.env.STREAMER_ASSIST_SHORTCUT = shortcut;
const restarting = process.env.STREAMER_ASSIST_WORKSPACE_RESTART === "1";
let main;
const timeout = setTimeout(() => { console.error("Workspace smoke timed out"); app.exit(1); }, 60000);
const run = (win, fn, ...args) => win.webContents.executeJavaScript("(" + fn.toString() + ")(" + args.map(value => JSON.stringify(value)).join(",") + ")").catch(error => { throw new Error(error.message + "\nWorkspace script: " + fn.toString().slice(0, 600)); });
async function call(win, action, payload = {}) {
  const result = await run(win, (action, payload) => window.assist.workspace(action, payload), action, payload);
  assert.ok(result.ok, result.error); return result.data;
}
const state = win => call(win, "state");
const native = id => id === "main" ? main : BrowserWindow.getAllWindows().find(win => {
  const url = win.webContents.getURL(); return url && new URL(url).searchParams.get("workspace") === id;
});
async function loaded(win) { await waitFor(() => run(win, () => !!document.querySelector('[data-workspace-ready="true"] main:not([hidden])')), "window page loaded"); await settleUI(win); }
async function open(win, id) {
  await call(win, "open", { id });
  await waitFor(() => run(win, id => !!document.querySelector('[data-workspace-instance="' + id + '"]:not([hidden])'), id), "instance active " + id);
  await settleUI(win);
}
async function menu(win, id) {
  await run(win, id => { const button = document.querySelector('[data-tab="' + id + '"]'); button.scrollIntoView({ block: "nearest", inline: "nearest" }); const box = button.getBoundingClientRect(); button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: box.x + 8, clientY: box.y + 12 })); }, id);
  await waitFor(() => run(win, () => !!document.querySelector('.tab-context-menu[aria-label="탭 관리"]')), "tab context menu");
}
async function choose(win, name) {
  await run(win, name => { const button = [...document.querySelectorAll(".tab-context-menu button")].find(button => button.textContent.trim() === name); if (!button || button.disabled) throw new Error("Menu item unavailable: " + name); button.click(); }, name);
}
async function text(win, id, selector, value) {
  await run(win, (id, selector, value) => { const input = document.querySelector('[data-workspace-instance="' + id + '"] ' + selector); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }, id, selector, value);
}
const value = (win, id, selector) => run(win, (id, selector) => document.querySelector('[data-workspace-instance="' + id + '"] ' + selector)?.value, id, selector);
async function add(win, kind) {
  const before = (await state(win)).tabs.filter(tab => tab.mode === "loaded").map(tab => tab.id);
  await run(win, () => document.querySelector('[aria-label="새 탭 추가"]').click());
  const names = { timeline: "방송 타임라인", raffle: "시청자 추첨", poll: "숫자 투표", donation: "도네 투표", roulette: "룰렛" };
  await choose(win, names[kind]);
  await waitFor(async () => (await state(win)).tabs.some(tab => !before.includes(tab.id) && tab.kind === kind && tab.mode === "loaded"), "new tool in this window");
  const tab = (await state(win)).tabs.find(tab => !before.includes(tab.id) && tab.kind === kind && tab.mode === "loaded");
  await open(win, tab.id); return tab.id;
}
async function newWindow(win, id) {
  const before = new Set(BrowserWindow.getAllWindows().map(win => win.id));
  await menu(win, id); await choose(win, "새 창에서 보기");
  await waitFor(() => BrowserWindow.getAllWindows().some(win => !before.has(win.id)), "context menu opens new window");
  const child = BrowserWindow.getAllWindows().find(win => !before.has(win.id)); await loaded(child); return child;
}
const pointerPositions=new Map();
function input(win, event) { const origin = win.getContentBounds(); win.webContents.sendInputEvent({ ...event, globalX: origin.x + event.x, globalY: origin.y + event.y }); }
async function down(win, id) {
  win.show(); win.focus(); win.webContents.focus(); await waitFor(()=>run(win,()=>document.hasFocus()),"drag source has keyboard focus"); await settleUI(win);
  await run(win, id => document.querySelector('[data-tab="' + id + '"]').scrollIntoView({ block: "nearest", inline: "nearest" }), id);
  await new Promise(resolve => setTimeout(resolve, 60));
  const box = await run(win, id => { const r = document.querySelector('[data-tab="' + id + '"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, id);
  input(win, { type: "mouseMove", ...box }); input(win, { type: "mouseDown", ...box, button: "left", clickCount: 1 }); return box;
}
async function move(win, p) { const origin=win.getContentBounds();pointerPositions.set(win,{local:p,screen:{x:origin.x+p.x,y:origin.y+p.y}});input(win, { type: "mouseMove", ...p, button: "left", modifiers: ["leftButtonDown"] }); await new Promise(resolve => setTimeout(resolve, 80)); }
function up(win, p) { const remembered=pointerPositions.get(win),origin=win.getContentBounds();const position=remembered&&remembered.local.x===p.x&&remembered.local.y===p.y?{x:remembered.screen.x-origin.x,y:remembered.screen.y-origin.y}:p;pointerPositions.delete(win);input(win, { type: "mouseUp", ...position, button: "left", clickCount: 1 }); }
async function moveAtScreen(win,p){const origin=win.getContentBounds();const local={x:p.x-origin.x,y:p.y-origin.y};await move(win,local);return local;}
async function exchange(source, id, target, before = null) {
  const windowCount=BrowserWindow.getAllWindows().length;
  const last=(await state(source)).tabs.filter(tab=>tab.mode==="loaded").length===1,primary=source===main;
  target.show(); target.focus(); await settleUI(target); const start=await down(source, id);
  const targetRect = await run(target, before => { const element = before ? document.querySelector('[data-tab="' + before + '"]') : document.querySelector(".workspace-tabstrip"); const r = element.getBoundingClientRect(); return { x: Math.round(r.x + 6), y: Math.round(r.y + 20) }; }, before);
  const sourceBounds = source.getContentBounds(), targetBounds = target.getContentBounds();
  const point={x:targetBounds.x+targetRect.x,y:targetBounds.y+targetRect.y};
  if((await state(source)).tabs.filter(tab=>tab.mode==="loaded").length>1){
    await moveAtScreen(source,{x:sourceBounds.x+start.x,y:sourceBounds.y+115});
    await waitFor(()=>BrowserWindow.getAllWindows().length===windowCount+1,"drag crosses the strip through a temporary floating window");
  }
  const p=await moveAtScreen(source,point); await waitFor(async () => (await state(target)).drop?.id === id, "target window insertion marker"); up(source, p);
  await waitFor(async () => (await state(target)).tabs.some(tab => tab.id === id), "tab enters another window"); await open(target, id);
  await waitFor(()=>BrowserWindow.getAllWindows().length===windowCount-(last?1:0),"merge removes a consumed source and temporary floating windows");
  if(last){assert.equal(source.isDestroyed(),true,"a merged window's last tab consumes that window");if(primary)main=target;}
  for(const win of BrowserWindow.getAllWindows())assert.equal(win.getOpacity(),1,"merge restores every window's opacity");
}
async function hide(win, id, expected) { await menu(win, id); await choose(win, "비활성 탭 숨김"); await waitFor(async () => (await state(win)).hideInactive === expected, "window visibility option"); }
app.on("browser-window-created", (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on("console-message", event => { if (event.level >= 2) console.error("Workspace renderer:", event.message); });
  if (main) return; main = win;
  win.webContents.once("did-finish-load", async () => {
    try {
      await loaded(main);
      if (restarting) {
        const expected = JSON.parse(fs.readFileSync(path.join(profile, "workspace-expected.json"), "utf8"));
        await waitFor(() => BrowserWindow.getAllWindows().length === expected.windows.length, "all saved full windows restored");
        for (const row of expected.windows) {
          const win = native(row.id); await loaded(win); const current = await state(win);
          assert.deepEqual(current.tabs, row.tabs); assert.equal(current.active, row.active); assert.equal(current.hideInactive, row.hideInactive);
          for (const tab of current.tabs) {
            assert.equal(await run(win, id => !!document.querySelector('[data-workspace-instance="' + id + '"]'), tab.id), tab.mode === "loaded", "all restored loaded views retain memory even when another tab is selected");
          }
          assert.deepEqual(win.getNormalBounds(), row.bounds);
          assert.ok(await run(win, () => !!document.querySelector('.settings-tab') && !!document.querySelector('[aria-label="새 탭 추가"]')), "restored window has full tools and settings");
          await assertLayout(win, "restored multi-tab window");
        }
        const roulette = JSON.parse(fs.readFileSync(path.join(profile, "roulette-expected.json"), "utf8")), win = native(roulette.windowId);
        for (const [id, title] of Object.entries(roulette.titles)) {
          await open(win, id); assert.equal(await value(win, id, '[aria-label="룰렛 제목"]'), title, "each roulette restores its own saved title");
        }
        console.log("PASS: actual restart restores duplicate instances, window ownership/order, per-window hide options and all window bounds");
      } else {
        main.setBounds({ x: 0, y: 30, width: 900, height: 650 }); await settleUI(main);
        assert.ok((await state(main)).tabs.every(tab => tab.mode === "unloaded"), "fresh tools begin inactive and allocate no tool views");
        assert.deepEqual((await state(main)).drafts, {});
        assert.equal(await run(main, () => document.querySelectorAll('[data-workspace-page]:not([data-workspace-page="home"]):not([data-workspace-page="settings"])').length), 0);
        await open(main, "poll"); await text(main, "poll", '.poll-editor input[placeholder]', "원래 탭의 투표");
        const loneBounds=main.getBounds(),lonePointer=await down(main,"poll");await move(main,{x:lonePointer.x+60,y:lonePointer.y+85});
        await waitFor(()=>main.getBounds().x===loneBounds.x+60&&main.getBounds().y===loneBounds.y+85,"sole-window last tab reuses its window");
        await run(main,()=>window.dispatchEvent(new PointerEvent("pointermove",{pointerId:1,screenX:897,screenY:423,buttons:0,bubbles:true})));
        await new Promise(resolve=>setTimeout(resolve,30));
        assert.equal(main.getBounds().x,loneBounds.x+60,"buttonless native movement cannot move a captured tab");
        assert.equal(BrowserWindow.getAllWindows().length,1);assert.equal(main.getOpacity(),1);up(main,{x:lonePointer.x+60,y:lonePointer.y+85});
        const emptyWindow=await newWindow(main,"poll");emptyWindow.setBounds({x:920,y:30,width:900,height:650});await call(emptyWindow,"close-all");
        assert.equal((await state(main)).tabs.filter(tab=>tab.mode==="loaded").length,1);
        const singleBounds=main.getBounds(), singlePointer=await down(main,"poll");
        await move(main,{x:singlePointer.x+80,y:singlePointer.y+85});
        await waitFor(()=>main.getBounds().x===singleBounds.x+80&&main.getBounds().y===singleBounds.y+85,"last loaded tab moves its existing window");
        assert.equal(BrowserWindow.getAllWindows().length,2);assert.ok(main.getOpacity()<.8);assert.equal(emptyWindow.getOpacity(),1);
        assert.equal(await run(main,()=>!!document.querySelector('.nav.dragging')),false,"last tab keeps its normal appearance");
        up(main,{x:singlePointer.x+80,y:singlePointer.y+85});
        await waitFor(async()=>(await state(main)).bounds?.x===singleBounds.x+80,"window move is saved immediately");
        assert.equal(main.getOpacity(),1,"release restores a reused window's opacity");
        const cancelBounds=main.getBounds(), singleCancel=await down(main,"poll");await move(main,{x:singleCancel.x+70,y:singleCancel.y+90});
        main.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});up(main,{x:singleCancel.x+70,y:singleCancel.y+90});
        await waitFor(()=>main.getBounds().x===cancelBounds.x&&main.getBounds().y===cancelBounds.y,"Escape restores a reused window");
        assert.equal(main.getOpacity(),1);
        emptyWindow.close();await waitFor(()=>BrowserWindow.getAllWindows().length===1,"empty scope-check window removed");
        main.setBounds({x:0,y:30,width:900,height:650});
        await open(main, "timeline");
        await waitFor(()=>run(main,()=>!!document.querySelector('[data-workspace-instance="timeline"] .telemetry-session')),"timeline module ready");
        assert.equal(await value(main, "poll", '.poll-editor input[placeholder]'), "원래 탭의 투표", "switching tabs retains loaded view and its data");
        assert.equal((await state(main)).tabs.find(tab => tab.id === "poll").mode, "loaded");
        const logoBounds=main.getBounds(), logoActive=(await state(main)).active;
        main.show();main.focus();main.webContents.focus();await waitFor(()=>run(main,()=>document.hasFocus()),"logo drag window focus");
        const logo=await run(main,()=>{const box=document.querySelector('.brand').getBoundingClientRect();return{x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};});
        input(main,{type:"mouseMove",...logo});input(main,{type:"mouseDown",...logo,button:"left",clickCount:1});await move(main,{x:logo.x+90,y:logo.y+85});
        await waitFor(()=>main.getBounds().x===logoBounds.x+90&&main.getBounds().y===logoBounds.y+85,"logo drags the complete window");
        assert.equal(main.getOpacity(),1);up(main,{x:logo.x+90,y:logo.y+85});
        assert.equal((await state(main)).active,logoActive,"dragging the logo does not navigate away");
        await run(main,()=>document.querySelector('.brand').click());await waitFor(async()=>(await state(main)).active==="home","logo still opens home on click");
        main.setBounds({x:0,y:30,width:900,height:650});
        await open(main, "poll");
        const fadePointer=await down(main,"poll");await move(main,{x:fadePointer.x+12,y:fadePointer.y});
        assert.equal(main.getOpacity(),1,"reordering a tab does not fade the stationary original window");
        main.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});up(main,{x:fadePointer.x+12,y:fadePointer.y});
        await waitFor(()=>main.getOpacity()===1,"cancel restores opacity");
        const bulk=await newWindow(main,"poll"),bulkPoll=(await state(bulk)).tabs[0].id;await add(bulk,"roulette");
        await menu(bulk,bulkPoll);await choose(bulk,"모두 닫기");
        await waitFor(async()=>(await state(bulk)).tabs.every(tab=>tab.mode==="unloaded"),"close all unloads every local tool");
        assert.deepEqual((await state(bulk)).drafts,{});assert.equal((await state(bulk)).active,"home");
        assert.equal(await run(bulk,()=>document.querySelectorAll('[data-workspace-instance]:not([data-workspace-instance="home"]):not([data-workspace-instance="settings"])').length),0);
        await open(bulk,bulkPoll);assert.equal(await value(bulk,bulkPoll,'.poll-editor input[placeholder]'),"","closed drafts are released");
        await call(bulk,"close-tab",{id:bulkPoll});bulk.close();await waitFor(()=>BrowserWindow.getAllWindows().length===1,"temporary close-all window removed");
        assert.equal(await value(main,"poll",'.poll-editor input[placeholder]'),"원래 탭의 투표","close all belongs to its window");
        await menu(main,"poll");
        await run(main,()=>{const field=document.querySelector('.poll-editor input[placeholder]');field.addEventListener('pointerdown',event=>event.stopPropagation(),{once:true});field.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));});
        await waitFor(()=>run(main,()=>!document.querySelector('.tab-context-menu')),"outside pointer dismisses menu even when propagation is stopped");
        await menu(main,"poll");await run(main,()=>document.querySelector('.poll-editor h2').click());
        await waitFor(()=>run(main,()=>!document.querySelector('.tab-context-menu')),"outside click dismisses menu");
        await menu(main,"poll");main.emit("move");
        await waitFor(()=>run(main,()=>!document.querySelector('.tab-context-menu')),"native window movement dismisses menu");
        if(process.platform==="win32")assert.equal(main.isWindowMessageHooked(0x00a1),true,"draggable title-bar clicks have a native dismiss hook");
        await menu(main, "poll");
        const options = await run(main, () => [...document.querySelectorAll('.tab-context-menu button')].map(button => button.textContent.trim()));
        assert.deepEqual(options, ["새 창에서 보기", "새 탭에서 보기", "닫기", "모두 닫기", "비활성 탭 숨김"]);
        await choose(main, "새 탭에서 보기");
        await waitFor(async () => (await state(main)).tabs.filter(tab => tab.kind === "poll").length === 2, "same-kind second tab");
        const duplicate = (await state(main)).tabs.find(tab => tab.kind === "poll" && tab.id !== "poll").id;
        assert.deepEqual(await run(main, () => [...document.querySelectorAll('[data-tab-kind="poll"]')].map(tab => tab.textContent.trim())), ["숫자 투표 1", "숫자 투표 2"]);
        await open(main, duplicate); assert.equal(await value(main, duplicate, '.poll-editor input[placeholder]'), "원래 탭의 투표");
        await text(main, duplicate, '.poll-editor input[placeholder]', "복제 탭의 독립 입력");
        assert.equal(await value(main, "poll", '.poll-editor input[placeholder]'), "원래 탭의 투표");
        await open(main, "raffle"); await menu(main, "raffle"); await choose(main, "닫기");
        await waitFor(() => run(main, () => !document.querySelector('[data-workspace-instance="raffle"]') && !!document.querySelector('[data-tab="raffle"].unloaded')), "close releases view and leaves inactive placeholder");
        await hide(main, "poll", true);
        assert.equal(await run(main, () => !!document.querySelector('[data-tab="raffle"]')), false);
        const child = await newWindow(main, "poll"); child.setBounds({ x: 920, y: 30, width: 900, height: 650 });
        const childState = await state(child), childPoll = childState.tabs[0].id;
        assert.equal(childState.hideInactive, true, "new window copies source option");
        assert.deepEqual([...new Set(childState.tabs.map(tab => tab.kind))].sort(), ["donation", "poll", "raffle", "roulette", "timeline"], "each new window contains every tool kind");
        assert.equal(childState.tabs.filter(tab => tab.mode === "unloaded").length, 4);
        const localBounds=child.getBounds(),localPointer=await down(child,childPoll);await move(child,{x:localPointer.x,y:115});
        await waitFor(()=>child.getBounds().y===localBounds.y+115-localPointer.y,"a window's last tab moves its existing window despite other active tabs");
        assert.equal(BrowserWindow.getAllWindows().length,2);assert.ok(child.getOpacity()<.8);assert.equal(main.getOpacity(),1);
        child.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});up(child,{x:localPointer.x,y:115});
        await waitFor(async()=>BrowserWindow.getAllWindows().length===2&&(await state(child)).tabs.some(tab=>tab.id===childPoll&&tab.mode==="loaded"),"cancel restores the local single tab");
        await waitFor(()=>child.getBounds().y===localBounds.y&&child.getOpacity()===1,"cancel restores local window bounds and opacity");
        for (const tab of childState.tabs.filter(tab => tab.mode === "unloaded")) assert.equal(await run(child, id => !!document.querySelector('[data-workspace-instance="' + id + '"]'), tab.id), false, "default inactive slots allocate no tool view");
        assert.notEqual(childPoll, "poll"); assert.ok((await state(main)).tabs.some(tab => tab.id === "poll"), "view in new window keeps original tab");
        assert.equal(await value(child, childPoll, '.poll-editor input[placeholder]'), "원래 탭의 투표");
        await hide(child, childPoll, false); assert.equal((await state(main)).hideInactive, true, "option belongs to each window");
        assert.equal(await run(child, () => document.querySelectorAll('[data-tab].unloaded').length), 4, "unhiding shows all default placeholders");
        await open(child, "settings"); assert.notEqual((await state(main)).active, "settings", "settings opens inside the secondary window");
        await assertLayout(child, "secondary window settings");
        child.show(); child.focus(); await new Promise(resolve => setTimeout(resolve, 50));
        const capture = await run(child, () => window.assist.call("shortcut-capture")); assert.ok(capture.ok, capture.error);
        assert.equal(globalShortcut.isRegistered(shortcut), false);
        child.hide(); await waitFor(() => globalShortcut.isRegistered(shortcut), "secondary focus loss restores global shortcut"); child.show();
        const timeline = await add(child, "timeline");
        const started = await run(child, () => window.assist.call("start", { title: "모든 창에서 관리하는 방송" })); assert.ok(started.ok);
        const marked = await run(child, () => window.assist.call("mark", { label: "보조 창에서 기록" })); assert.ok(marked.ok);
        await waitFor(() => run(main, () => document.querySelector('.live-badge').textContent.includes("기록 중")), "backend broadcasts to all windows");
        await waitFor(() => run(child, () => document.body.innerText.includes("보조 창에서 기록")), "timeline works in secondary window");
        const roulette = await add(child, "roulette");
        let third = await newWindow(child, roulette); third.setBounds({ x: 0, y: 340, width: 900, height: 650 });
        const removedThirdId=(await state(third)).windowId,thirdRoulette = (await state(third)).tabs[0].id;
        assert.equal((await state(third)).hideInactive, false);
        await exchange(third, thirdRoulette, child, roulette);
        assert.equal(third.isDestroyed(), true, "moving a window's last loaded tool removes the consumed source");
        assert.ok(!JSON.parse(fs.readFileSync(path.join(profile,"workspace-layout.json"),"utf8")).windows.some(win=>win.id===removedThirdId));
        third=await newWindow(child,thirdRoulette);await call(third,"close-all");
        const thirdId=(await state(third)).windowId;
        third.setBounds({x:0,y:340,width:900,height:650});
        const absent = await state(third);
        assert.ok(absent.tabs.every(tab => tab.mode === "unloaded"));
        assert.deepEqual(absent.drafts, {});
        assert.equal(await run(third, () => document.querySelectorAll('[data-workspace-instance]:not([data-workspace-instance="home"]):not([data-workspace-instance="settings"])').length), 0, "inactive slots contain no loaded views");
        const emptyRoulette = absent.tabs.find(tab => tab.kind === "roulette").id;
        await exchange(child, thirdRoulette, third, emptyRoulette);
        await hide(third, thirdRoulette, true); assert.equal((await state(child)).hideInactive, false);
        const donation = await add(third, "donation");
        await exchange(main, "poll", child, childPoll);
        assert.equal(await run(main, id => document.querySelector('[data-tab="' + id + '"]').textContent.trim(), duplicate), "숫자 투표", "moving one instance away removes the last instance's number");
        assert.equal(await run(main, () => !!document.querySelector('[data-workspace-instance="poll"]')), false, "transferred source tree is released");
        assert.equal(await value(child, "poll", '.poll-editor input[placeholder]'), "원래 탭의 투표");
        await exchange(child, childPoll, third, donation);
        assert.equal(await value(third, childPoll, '.poll-editor input[placeholder]'), "원래 탭의 투표");
        await exchange(third, donation, main, "timeline");
        assert.equal((await state(main)).tabs[0].id, donation);
        assert.ok((await state(child)).tabs.some(tab => tab.id === timeline) && (await state(child)).tabs.some(tab => tab.id === roulette), "moving a tab keeps other tabs and full window functional");
        const denied = await run(main, id => window.assist.workspace("draft", { id, key: "forged", value: "foreign" }), thirdRoulette); assert.equal(denied.ok, false);
        // A cloned roulette stores configuration independently of its source.
        await open(third, thirdRoulette); await text(third, thirdRoulette, '[aria-label="룰렛 제목"]', "세 번째 창 룰렛");
        await menu(third, thirdRoulette); await choose(third, "새 탭에서 보기");
        await waitFor(async () => (await state(third)).tabs.filter(tab => tab.kind === "roulette").length === 2, "two roulette instances");
        let rouletteCopy = (await state(third)).tabs.filter(tab => tab.kind === "roulette").find(tab => tab.id !== thirdRoulette).id;
        await open(third, rouletteCopy); await text(third, rouletteCopy, '[aria-label="룰렛 제목"]', "복제 룰렛의 제목");
        assert.equal(await value(third, thirdRoulette, '[aria-label="룰렛 제목"]'), "세 번째 창 룰렛");
        await menu(third, rouletteCopy); await choose(third, "닫기");
        await waitFor(() => run(third, id => document.querySelector('[data-tab="' + id + '"]').textContent.trim() === "룰렛", thirdRoulette), "closing a copy removes the remaining live instance's number even with a closed placeholder");
        await menu(third, thirdRoulette); await choose(third, "새 탭에서 보기");
        await waitFor(async () => (await state(third)).tabs.some(tab => tab.kind === "roulette" && tab.id !== thirdRoulette), "recreate closed extra view");
        rouletteCopy = (await state(third)).tabs.find(tab => tab.kind === "roulette" && tab.id !== thirdRoulette).id;
        await open(third, rouletteCopy);
        await text(third, rouletteCopy, '[aria-label="룰렛 제목"]', "복제 룰렛의 제목");
        await menu(third, childPoll); await choose(third, "닫기");
        await waitFor(() => run(third, id => !document.querySelector('[data-workspace-instance="' + id + '"]') && !document.querySelector('[data-tab="' + id + '"]'), childPoll), "hidden inactive tab releases its view");
        assert.equal((await state(third)).drafts[childPoll], undefined);
        await call(third, "draft", { id: childPoll, key: "late-response", value: "discard" });
        await open(third, childPoll); assert.equal((await state(third)).drafts[childPoll]["late-response"], undefined);
        assert.equal(await value(third, childPoll, '.poll-editor input[placeholder]'), "", "closed transient draft is freed");
        // Rearrange by pointer inside a window; fixed Settings stays outside the strip.
        await open(main, "roulette");
        const pinned = await run(main, () => document.querySelector('.settings-tab').getBoundingClientRect().x);
        await down(main, "roulette");
        await run(main, () => { document.querySelector('.workspace-tabstrip').scrollLeft = 0; });
        await new Promise(resolve => setTimeout(resolve, 60));
        const first = await run(main, () => { const r = document.querySelector('.workspace-tabstrip').getBoundingClientRect(); return { x: Math.round(r.x + 4), y: Math.round(r.y + 20) }; });
        await move(main, first); up(main, first);
        await waitFor(async () => (await state(main)).tabs[0].id === "roulette", "pointer reorders instances");
        assert.equal(await run(main, () => document.querySelector('.settings-tab').getBoundingClientRect().x), pinned);
        // Pull out a tab and cancel; original ownership and option are restored.
        const cancel = await down(child, "poll"); await move(child, { x: cancel.x, y: 115 });
        await waitFor(() => BrowserWindow.getAllWindows().length === 4, "drag creates fourth full window");
        const floating=BrowserWindow.getAllWindows().find(win=>![main,child,third].includes(win));assert.ok(floating.getOpacity()<.8,"floating drag window is translucent");
        for(const win of [main,child,third])assert.equal(win.getOpacity(),1,"only the moving floating window is translucent");
        child.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" }); up(child, { x: cancel.x, y: 115 });
        await waitFor(async () => BrowserWindow.getAllWindows().length === 3 && (await state(child)).tabs.some(tab => tab.id === "poll"), "Escape restores cross-window layout");
        assert.equal(child.getOpacity(),1);
        const spare=await add(main,"poll"),sparePointer=await down(main,spare);
        await move(main,{x:sparePointer.x,y:115});
        await waitFor(()=>BrowserWindow.getAllWindows().length===4,"temporary tab detaches for a completed drag");
        const completed=BrowserWindow.getAllWindows().find(win=>![main,child,third].includes(win));
        assert.ok(completed.getOpacity()<.8);for(const win of [main,child,third])assert.equal(win.getOpacity(),1);
        up(main,{x:sparePointer.x,y:115});await loaded(completed);
        await waitFor(()=>completed.getOpacity()===1,"release restores the moved window's opacity");
        await call(completed,"close-tab",{id:spare});completed.close();
        await waitFor(()=>BrowserWindow.getAllWindows().length===3,"temporary opacity-check window removed");
        for (const win of [main, child, third]) {
          await settleUI(win); await assertLayout(win, "full multi-tab window 900x650");
          assert.deepEqual([...new Set((await state(win)).tabs.map(tab => tab.kind))].sort(), ["donation", "poll", "raffle", "roulette", "timeline"], "all windows keep every baseline tool slot");
          const header = await run(win, () => [document.querySelector('.settings-tab'), document.querySelector('[aria-label="새 탭 추가"]'), ...document.querySelectorAll('.window-controls button')].map(element => ({ label: element.getAttribute('aria-label') || element.textContent, rect: element.getBoundingClientRect().toJSON(), display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility, opacity: getComputedStyle(element).opacity })));
          for (const control of header) assert.ok(control.rect.width > 0 && control.rect.height > 0 && control.rect.right <= 901 && control.visibility === "visible" && control.opacity !== "0", "every window exposes visible full header control: " + JSON.stringify(control));
        }
        if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS === "1") {
          await menu(main, "roulette");
          fs.writeFileSync(path.join(__dirname, "../release/workspace-tabs.png"), (await main.webContents.capturePage()).toPNG());
          await run(main, () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
          const capturedBounds = child.getBounds();
          child.setPosition(0, 0); child.show(); child.focus();
          child.setSize(capturedBounds.width + 1, capturedBounds.height);
          await new Promise(resolve => setTimeout(resolve, 70));
          child.setSize(capturedBounds.width, capturedBounds.height);
          await run(child, () => window.assist.call("state"));
          await settleUI(child);
          fs.writeFileSync(path.join(__dirname, "../release/workspace-header.json"), JSON.stringify(await run(child, () => ({ viewport: [innerWidth, innerHeight], elements: [...document.querySelectorAll('.settings-tab,.workspace-add-tab,.header-actions,.window-controls')].map(element => ({ name: element.className, rect: element.getBoundingClientRect().toJSON(), style: { display: getComputedStyle(element).display, opacity: getComputedStyle(element).opacity, visibility: getComputedStyle(element).visibility } })) })), null, 2));
          fs.writeFileSync(path.join(__dirname, "../release/workspace-detached.png"), (await child.webContents.capturePage()).toPNG());
          child.setBounds(capturedBounds);
        }
        const originalPrimary=main,originalPrimaryId=(await state(main)).windowId;
        for(const tab of (await state(originalPrimary)).tabs.filter(tab=>tab.mode==="loaded"))await exchange(originalPrimary,tab.id,child);
        assert.equal(originalPrimaryId,"main");assert.equal(originalPrimary.isDestroyed(),true);assert.equal(main,child);assert.equal((await state(main)).windowId,"main");
        const sharedAfterMerge=await run(main,()=>new Promise(resolve=>{const off=window.assist.subscribe(value=>{off();resolve(value);});void window.assist.call("state");}));
        assert.ok(sharedAfterMerge.current,"primary promotion preserves common recording");
        assert.ok((await run(main,()=>window.assist.call("mark",{label:"합친 창의 기록"}))).ok,"promoted primary retains all backend actions");
        main.close();await waitFor(()=>!main.isVisible(),"promoted primary close retains tray/window behavior");main.show();main.focus();await loaded(main);
        await new Promise(resolve => setTimeout(resolve, 240));
        const expected = JSON.parse(fs.readFileSync(path.join(profile, "workspace-layout.json"), "utf8"));
        assert.equal(expected.windows.length, 2); fs.writeFileSync(path.join(profile, "workspace-expected.json"), JSON.stringify(expected));
        fs.writeFileSync(path.join(profile, "roulette-expected.json"), JSON.stringify({ windowId: thirdId, titles: { [thirdRoulette]: "세 번째 창 룰렛", [rouletteCopy]: "복제 룰렛의 제목" } }));
        console.log("PASS: five context actions, last-tab window reuse and opacity, logo move/click, close all isolation and memory release, duplicate drafts/roulettes, three-way pointer exchange, translucent dragging and cancellation");
      }
      clearTimeout(timeout); app.quit();
    } catch (error) { clearTimeout(timeout); console.error(error); console.error(await run(main, () => ({ events: window.__workspaceEvents, strip: document.querySelector('.workspace-tabstrip')?.getBoundingClientRect().toJSON(), tabs: [...document.querySelectorAll('[data-tab]')].map(tab => ({ id: tab.dataset.tab, rect: tab.getBoundingClientRect().toJSON() })) })).catch(() => null)); console.error(await state(main).catch(() => null)); app.exit(1); }
  });
});
require("../electron/main.cjs");
