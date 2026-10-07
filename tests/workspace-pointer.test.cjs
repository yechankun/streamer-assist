const {test}=require("node:test"),assert=require("node:assert/strict");
const imported=import("../src/workspace-pointer.mjs");
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function scheduler(){let next=0;const frames=new Map();return{frames,request:fn=>{frames.set(++next,fn);return next;},cancel:id=>frames.delete(id),tick(){const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn();}};}
test("pointer bursts keep one bridge request in flight and release bypasses stale queued positions",async()=>{
  const {WorkspacePointerDrag}=await imported,clock=scheduler(),calls=[];let releaseStart,releaseMove;
  const send=(action,payload)=>{calls.push({action,payload});if(action==="drag-start")return new Promise(resolve=>{releaseStart=resolve;});if(action==="drag-move")return new Promise(resolve=>{releaseMove=resolve;});return Promise.resolve({ok:true});};
  const drag=new WorkspacePointerDrag(send,{id:"poll",windowMove:false,point:{x:0,y:0},token:"gesture-one"},clock);
  for(let i=1;i<=500;i++)drag.move({x:i,y:i});clock.tick();
  for(let i=501;i<=1000;i++)drag.move({x:i,y:i});
  releaseStart({ok:true});await flush();
  assert.equal(calls.length,2);assert.deepEqual(calls[1].payload.point,{x:1000,y:1000});
  for(let i=1001;i<=2000;i++)drag.move({x:i,y:i});
  const end=drag.finish(false,{x:42,y:24});releaseMove({ok:true});await end;await flush();clock.tick();
  assert.deepEqual(calls.map(c=>c.action),["drag-start","drag-move","drag-end"]);
  assert.deepEqual(calls[2].payload,{token:"gesture-one",point:{x:42,y:24}});assert.equal(clock.frames.size,0);
});
test("quick release sends the actual drop point without creating intermediate moves",async()=>{
  const {WorkspacePointerDrag}=await imported,clock=scheduler(),calls=[];
  const drag=new WorkspacePointerDrag(async(action,payload)=>{calls.push({action,payload});return{ok:true};},{id:"poll",windowMove:false,point:{x:0,y:0},token:"quick"},clock);
  drag.move({x:500,y:500});await drag.finish(false,{x:100,y:20});clock.tick();await flush();
  assert.deepEqual(calls.map(c=>c.action),["drag-start","drag-end"]);assert.deepEqual(calls[1].payload.point,{x:100,y:20});
});
test("motion resumes with the latest position after a busy bridge and stops on cancellation",async()=>{
  const {WorkspacePointerDrag}=await imported,clock=scheduler(),calls=[];let resolveMove;
  const drag=new WorkspacePointerDrag((action,payload)=>{calls.push({action,payload});if(action==="drag-move")return new Promise(resolve=>{resolveMove=resolve;});return Promise.resolve({ok:true});},{id:"poll",windowMove:false,point:{x:0,y:0},token:"cancel"},clock);
  drag.move({x:1,y:1});clock.tick();await flush();drag.move({x:2,y:2});drag.move({x:3,y:3});resolveMove({ok:true});await flush();clock.tick();await flush();
  assert.deepEqual(calls.at(-1).payload.point,{x:3,y:3});
  const canceled=drag.finish(true);resolveMove({ok:true});await canceled;await flush();drag.move({x:4,y:4});clock.tick();
  assert.equal(calls.at(-1).action,"drag-cancel");assert.equal(clock.frames.size,0);
});
test("rejected start does not schedule an endless animation-frame loop",async()=>{
  const {WorkspacePointerDrag}=await imported,clock=scheduler(),calls=[];
  const drag=new WorkspacePointerDrag(async action=>{calls.push(action);return{ok:false};},{id:"poll",windowMove:false,point:{x:0,y:0},token:"rejected"},clock);
  drag.move({x:1,y:1});clock.tick();await flush();assert.equal(clock.frames.size,0);await drag.finish(false,{x:2,y:2});assert.deepEqual(calls,["drag-start"]);
});
