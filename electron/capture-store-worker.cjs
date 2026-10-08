const {parentPort,workerData}=require("node:worker_threads");
const {TimelineStore}=require("./timeline-store.cjs"),{configure}=require("./capture-codec.cjs");
const key=Buffer.from(workerData.key),fs=require("node:fs"),path=require("node:path");
// Electron's DPAPI API stays in main; the protected per-profile key encrypts
// chunks here. Legacy files are decoded in main and migrated on demand.
const storage={isEncryptionAvailable:()=>true,encryptString(){throw Error("Legacy encoding is unavailable in the worker");},decryptString(){throw Error("이전 형식 기록은 변환 후 조회하세요.");}};
const store=configure(new TimelineStore(workerData.directory,storage,{maxQueueEvents:200000,chunkEventLimit:20000,chunkBytesLimit:8*1024*1024,autoFlushEvents:20000}),key);
const {CaptureParticipants}=require("./capture-participants.cjs"),{ChatAnalysis}=require("./chat-analysis.cjs");
const actors=new Map(),originalState=store.state.bind(store);
store.state=id=>{
  const state=originalState(id);if(actors.has(id)){const registry=actors.get(id);if(state.analysis.participants!==registry){const saved=registry.stats();if(saved)state.analysis=new ChatAnalysis(saved.analysis);state.analysis.participants=registry;}return state;}
  if(actors.size>=4){for(const [old,registry]of actors){if(![...packets.values()].some(p=>p.session.id===old)){registry.close();actors.delete(old);break;}}}
  const registry=new CaptureParticipants(state.folder,key),saved=registry.stats();
  if(saved){state.analysis=new ChatAnalysis(saved.analysis);state.analysis.participants=registry;state.checkpointSeq=saved.seq;
    const index=store.index({id});for(const chunk of index.entries.filter(e=>e.maxSeq>saved.seq))for(const event of store.decode(path.join(state.folder,chunk.file)).events)if(event.seq>saved.seq){state.analysis.accept(event,0,{statistics:false});if(event.id)registry.remember(event.id);}
  }else{const index=store.index({id});if(index.entries.length){state.analysis=new ChatAnalysis();state.analysis.participants=registry;for(const chunk of index.entries){const batch=store.decode(path.join(state.folder,chunk.file));for(const event of batch.events){state.analysis.accept(event,batch.startedAt,{statistics:false});if(event.id)registry.remember(event.id);}}}else state.analysis.participants=registry;}
  actors.set(id,registry);return state;
};
const packets=new Map(),sessions=new Map(),iterators=new Map();let tail=Promise.resolve(),flushTimer=null;
function scheduleFlush(){if(flushTimer||!packets.size)return;flushTimer=setTimeout(()=>{flushTimer=null;const active=new Map([...packets.values()].map(p=>[p.session.id,p.session]));for(const session of active.values()){store.flush(session);acknowledge(session);}scheduleFlush();},1000);flushTimer.unref();}
function counts(session){const s=store.state(session.id);return{id:session.id,chats:s.analysis.chats,donations:s.analysis.donations,participants:s.analysis.participants.size,viewerSamples:s.analysis.viewers.length,seq:s.seq,pending:s.queue.length};}
function acknowledge(session){const s=store.state(session.id);if(!s.queue.length&&!store.failure)actors.get(session.id)?.commit(s);const durable=s.queue.length?s.queue[0].seq-1:s.seq;for(const [id,p]of packets)if(p.session.id===session.id&&p.end<=durable&&!store.failure){packets.delete(id);parentPort.postMessage({type:"ack",id,counts:counts(session)});}parentPort.postMessage({type:"state",counts:counts(session),error:store.failure});}
parentPort.on("message",packet=>{tail=tail.then(async()=>{
  if(packet.type==="append"){
    if(packets.has(packet.id))return;const session=packet.session;sessions.set(session.id,session);
    const registry=actors.get(session.id)||store.state(session.id).analysis.participants,events=[];let profile;
    if(store.state(session.id).queue.length+packet.events.length>store.maxQueueEvents)throw Error("기록 대기량 복구 중");
    for(const event of packet.events){if(event.type==="participant"){profile=event;continue;}if(event.id&&!registry.remember(event.id)){profile=null;continue;}if(profile){events.push(profile);profile=null;}events.push(event);}
    if(profile)events.push(profile);
    const entries=store.appendBatch(session,events);packets.set(packet.id,{session,end:entries.at(-1)?.seq||store.state(session.id).seq});
    if(!store.state(session.id).queue.length)acknowledge(session);scheduleFlush();return;
  }
  const {id,action,args=[]}=packet;try{
    let value;
    if(action==="flush"){value=store.flush(args[0]);acknowledge(args[0]);}
    else if(action==="counts")value=counts(args[0]);
    else if(action==="deleteDates"){
      value=await store.deleteDates(...args);
      for(const row of value.updated){actors.get(row.id)?.close();actors.delete(row.id);store.states.delete(row.id);store.indexes.delete(row.id);const folder=store.folder(row.id);for(const name of ["participants.sqlite","participants.sqlite-wal","participants.sqlite-shm","analysis-participants.sqlite","analysis-participants.sqlite-wal","analysis-participants.sqlite-shm"]){const file=path.join(folder,name);if(fs.existsSync(file))fs.unlinkSync(file);}const state=store.state(row.id);actors.get(row.id).commit(state);}
    }
    else if(action==="events-open"){const token=require("node:crypto").randomUUID();iterators.set(token,store.events(...args)[Symbol.asyncIterator]());value=token;}
    else if(action==="events-next"){const iterator=iterators.get(args[0]);if(!iterator)throw Error("기록 읽기가 종료됐습니다.");const events=[];let done=false;while(events.length<200){const row=await iterator.next();if(row.done){done=true;iterators.delete(args[0]);break;}events.push(row.value);}value={events,done};}
    else if(action==="events-close"){await iterators.get(args[0])?.return?.();iterators.delete(args[0]);value=true;}
    else if(action==="shutdown"){for(const session of sessions.values()){if(!store.flush(session))throw Error(store.failure);acknowledge(session);}for(const registry of actors.values())registry.close();value=true;}
    else{if(typeof store[action]!=="function")throw Error("지원하지 않는 기록 요청");value=await store[action](...args);}
    parentPort.postMessage({type:"reply",id,value});
  }catch(error){parentPort.postMessage({type:"reply",id,error:error.message});}
}).catch(error=>{parentPort.postMessage({type:"failure",id:packet.id,error:error.message});});});
parentPort.postMessage({type:"ready"});
