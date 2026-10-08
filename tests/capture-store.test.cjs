const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {CaptureStore}=require("../electron/capture-store.cjs"),{Engine}=require("../electron/engine.cjs");
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),"capture-store-proof-")),key=crypto.randomBytes(32),storage={isEncryptionAvailable:()=>true,encryptString(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",key,iv),data=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},decryptString(data){const c=crypto.createDecipheriv("aes-256-gcm",key,data.subarray(0,12));c.setAuthTag(data.subarray(12,28));return Buffer.concat([c.update(data.subarray(28)),c.final()]).toString();}};const store=new CaptureStore(root,storage,{maxPendingBytes:128*1024*1024});t.after(async()=>{await store.shutdown();const resolved=fs.realpathSync(root);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"capture-store-proof-"));fs.rmSync(resolved,{recursive:true,force:true});});const engine=new Engine({}, {journal:store});engine.start("worker");return{root,storage,store,engine};}
test("lazy capture worker keeps encrypted records, exact large participants and disk-backed source-ID dedup after cache eviction",async t=>{
  const {root,store,engine}=fixture(t);assert.equal(store.worker,undefined);
  for(let first=0;first<62000;first+=10000){for(let i=first;i<Math.min(62000,first+10000);i++)engine.ingest({platform:"chzzk",id:"message"+i,userId:"person"+i,name:"PRIVATE_NAME_"+i,text:"private_chat_"+i,timestamp:Date.now()});await store.flush(engine.current);}
  assert.equal(store.state(engine.current.id).analysis.participants.size,62000);const before=store.state(engine.current.id).analysis.chats;
  engine.ingest({platform:"chzzk",id:"repeat-person",userId:"person50000",name:"PRIVATE_NAME_50000",text:"repeat",timestamp:Date.now()});engine.ingest({platform:"chzzk",id:"message0",userId:"person0",name:"PRIVATE_NAME_0",text:"duplicate old",timestamp:Date.now()});await store.flush(engine.current);
  assert.equal(store.state(engine.current.id).analysis.participants.size,62000);assert.equal(store.state(engine.current.id).analysis.chats,before+1);assert.equal(store.status(engine.current).pending,0);
  for(const file of fs.readdirSync(path.join(root,engine.current.id)).filter(n=>/\.enc$|sqlite/.test(n))){const data=fs.readFileSync(path.join(root,engine.current.id,file));assert.equal(data.includes(Buffer.from("PRIVATE_NAME_")),false);assert.equal(data.includes(Buffer.from("private_chat_")),false);}
});
test("disk failure retains owned packets; recovery stores one message and restores a clean queue",async t=>{
  const {root,store,engine}=fixture(t);await store.warm(engine.current);const blocked=path.join(root,engine.current.id,"000000000001.enc.tmp");fs.mkdirSync(blocked);
  const message={platform:"chzzk",id:"recover",userId:"person",name:"Recovery",text:"save exactly once",timestamp:Date.now()};engine.ingest(message);assert.equal(await store.flush(engine.current),false);assert.ok(store.status(engine.current).pending>0);
  fs.rmdirSync(blocked);assert.equal(await store.flush(engine.current),true);engine.ingest(message);await store.flush(engine.current);assert.equal(store.state(engine.current.id).analysis.chats,1);assert.equal(store.status(engine.current).pending,0);
  const result=await store.queryAll([engine.current],{text:"save exactly once",limit:100});assert.equal(result.events.length,1);
});
test("unexpected writer exit replays unacknowledged owner packets and remains queryable",async t=>{
  const {store,engine}=fixture(t);await store.warm(engine.current);
  for(let i=0;i<1000;i++)engine.ingest({platform:"chzzk",id:"restart"+i,userId:"u"+(i%10),text:"recover packet",timestamp:Date.now()});
  store.sendPending();await store.worker.terminate();await new Promise(resolve=>setTimeout(resolve,250));await store.flush(engine.current);
  assert.equal(store.state(engine.current.id).analysis.chats,1000);assert.equal(store.status(engine.current).pending,0);
});
test("writer exit before its ready handshake preserves unsent owned packets",async t=>{
  const {store,engine}=fixture(t);engine.ingest({platform:"chzzk",id:"before-ready",userId:"u",text:"preserve handshake",timestamp:Date.now()});store.sendPending();await store.worker.terminate();await new Promise(resolve=>setTimeout(resolve,250));await store.flush(engine.current);assert.equal(store.state(engine.current.id).analysis.chats,1);assert.equal(store.pending.size,0);
});

test("pending counters cover mixed sessions, rejected admission, acknowledgements and clear", async t => {
  const { store, engine } = fixture(t), first = engine.current, second = { id: crypto.randomUUID(), startedAt: Date.now() };
  const event = id => ({ type: "chat", platform: "chzzk", id, text: "pending counter", timestamp: Date.now() });
  store.appendBatch(first, [event("first-a"), event("first-b")]); store.append(second, event("second"));
  const packetId = store.pending.keys().next().value;
  assert.equal(store.status().pending, 3); assert.equal(store.status(first).pending, 2); assert.equal(store.status(second).pending, 1);
  const limit = store.maxPendingBytes; store.maxPendingBytes = store.pendingBytes;
  assert.throws(() => store.append(first, event("rejected")), /대기량/);
  assert.equal(store.status().pending, 3); store.maxPendingBytes = limit;
  await store.flush(first); await store.flush(second);
  assert.equal(store.status().pending, 0); assert.equal(store.pendingCounts.size, 0);
  store.worker.emit("message", { type: "ack", id: packetId });
  assert.equal(store.status().pending, 0, "duplicate acknowledgement cannot subtract pending work twice");
  await store.clear(); assert.equal(store.status(first).pending, 0); assert.equal(store.pendingEvents, 0);
});
