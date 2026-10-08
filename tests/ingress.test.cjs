const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {IngressQueue}=require("../electron/ingress-queue.cjs");
function fixture(t,{mode="live",limit=8192}={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),"ingress-test-")),messages=[];const engine={current:{id:crypto.randomUUID(),chatCaptureMode:mode},ingest:(m,now)=>messages.push({id:m.id,now}),captureRetries:new Map(),retryCapture(){}};const store={directory:root,key:crypto.randomBytes(32),pendingBytes:0,maxPendingBytes:1024*1024,flush:async()=>true};const queue=new IngressQueue({engine,store,maxMemoryBytes:limit});t.after(async()=>{await queue.close();const resolved=fs.realpathSync(root);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"ingress-test-"));fs.rmSync(resolved,{recursive:true,force:true});});return{root,engine,store,queue,messages};}
test("fair ingress and encrypted spill preserve every message's FIFO order and actual receive time",async t=>{
  const {root,queue,messages}=fixture(t);for(let i=0;i<6000;i++)queue.push({id:"m"+i,text:"PRIVATE_MESSAGE_"+i},1000+i);await queue.drain();
  assert.deepEqual(messages.map(m=>m.id),Array.from({length:6000},(_,i)=>"m"+i));assert.equal(messages.at(-1).now,6999);assert.equal(queue.pending,0);assert.equal(queue.diskBatches.length,0);assert.equal(fs.readdirSync(path.join(root,"receipts")).filter(n=>n.endsWith(".enc")).length,0);
});
test("replay live-features mode never writes a raw receipt journal",async t=>{
  const {root,queue,messages}=fixture(t,{mode:"replay",limit:1024});for(let i=0;i<3000;i++)queue.push({id:"m"+i,text:"no disk"},i);await queue.drain();assert.equal(messages.length,3000);assert.equal(fs.existsSync(path.join(root,"receipts")),false);
});
test("storage pressure stops dispatch and resumes without dropping accepted input",async t=>{
  const {queue,store,messages}=fixture(t);store.pendingBytes=store.maxPendingBytes;for(let i=0;i<100;i++)queue.push({id:"m"+i,text:"keep"},i);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(messages.length,0);store.pendingBytes=0;await queue.drain();assert.equal(messages.length,100);
});
test("encrypted receipts from an ended session recover without an active broadcast",async t=>{
  const {engine,store,queue,messages}=fixture(t);const session=engine.current;
  engine.sessions=[session];engine.current=null;engine.capture=(message,now)=>{assert.equal(engine.current,session);messages.push({id:message.id,now});};
  const flushed=[];store.flush=async value=>{assert.equal(value,session);flushed.push(value.id);return true;};
  const name=String(Date.now()*1000).padStart(16,"0")+"-"+crypto.randomUUID()+".enc";
  await queue.rpc("write",name,[{sessionId:session.id,message:{id:"recover",text:"preserve"},now:123}]);
  await queue.restore();await queue.drain();assert.deepEqual(messages,[{id:"recover",now:123}]);assert.ok(flushed.length>=2);assert.equal(engine.current,null);assert.equal(queue.diskBatches.length,0);
});
