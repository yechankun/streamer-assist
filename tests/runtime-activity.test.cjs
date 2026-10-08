const {test} = require("node:test"), assert = require("node:assert/strict");
const {RuntimeActivity, StatePublisher} = require("../electron/runtime-activity.cjs");
function clock() {
  let now = 0, next = 0; const timers = new Map();
  return { clock: () => now, schedule: (fn, ms) => { const id = ++next; timers.set(id, {fn, at: now + ms}); return id; }, cancel: id => timers.delete(id),
    advance: ms => { const end = now + ms; for (;;) { const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at-b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].fn(); } now = end; }, timers };
}
test("empty idle runtime schedules no timer, but deadlines run without a renderer", () => {
  const time = clock(), state = {recording:false,dirty:false,deadlines:[]}, calls = [];
  const loop = new RuntimeActivity({...time, read:()=>state, run: now => { calls.push(now); state.deadlines=[]; }});
  for(let i=0;i<1000;i++) loop.refresh(); assert.equal(time.timers.size,0);
  state.deadlines=[2000]; loop.refresh(); time.advance(1999); assert.deepEqual(calls,[]);
  time.advance(1); assert.deepEqual(calls,[2000]); assert.equal(time.timers.size,0);
});
test("continuous traffic cannot postpone recording flush or pending metadata persistence", () => {
  const time=clock(), state={recording:true,dirty:true,saveAt:5000,deadlines:[]}, flushes=[], saves=[];
  const loop=new RuntimeActivity({...time,read:()=>state,run:(now,maintenance)=>{if(maintenance)flushes.push(now);if(state.dirty&&now>=state.saveAt){saves.push(now);state.dirty=false;}}});
  loop.refresh();for(let i=0;i<120;i++){time.advance(50);loop.refresh();}
  assert.deepEqual(flushes,[1000,2000,3000,4000,5000,6000]);assert.deepEqual(saves,[5000]);
  state.recording=false;loop.refresh();assert.equal(time.timers.size,0);
});
test("save retries wait for the retry deadline and closing cancels all work",()=>{
  const time=clock(),state={recording:false,dirty:true,saveAt:0,deadlines:[]},calls=[];
  const loop=new RuntimeActivity({...time,read:()=>state,run:now=>{calls.push(now);state.saveAt=now+5000;}});
  loop.refresh();time.advance(0);time.advance(4999);assert.deepEqual(calls,[0]);time.advance(1);assert.deepEqual(calls,[0,5000]);
  loop.close();time.advance(50000);assert.equal(calls.length,2);assert.equal(time.timers.size,0);
});
function window(visible=true,minimized=false){return{isDestroyed:()=>false,isVisible:()=>visible,isMinimized:()=>minimized};}
test("hidden and minimized windows never build or receive automatic snapshots",()=>{
  const time=clock(),windows=[window(false),window(true,true)];let builds=0,sends=0;
  const publisher=new StatePublisher({...time,windows:()=>windows,build:()=>{builds++;return{};},send:()=>sends++});
  for(let i=0;i<10000;i++)publisher.request();time.advance(1000);assert.equal(builds,0);assert.equal(sends,0);assert.equal(time.timers.size,0);
  publisher.request(true,windows[0]);assert.equal(builds,1);assert.equal(sends,1);
});
test("chat bursts coalesce to one snapshot while explicit reads stay immediate and caller-owned",()=>{
  const time=clock(),first=window(),second=window();let value=0,builds=0;const sent=[];
  const publisher=new StatePublisher({...time,windows:()=>[first,second],build:()=>{builds++;return{value};},send:(win,state)=>sent.push({win,value:state.value})});
  for(let i=0;i<10000;i++){value=i;publisher.request();}assert.equal(time.timers.size,1);
  publisher.request(true,first);assert.deepEqual(sent,[{win:first,value:9999}]);time.advance(100);
  assert.equal(builds,2);assert.equal(sent.length,3);assert.ok(sent.every(row=>row.value===9999));
  publisher.close();publisher.request();publisher.request(true);time.advance(1000);assert.equal(sent.length,3);
});
