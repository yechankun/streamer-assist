const fs=require("node:fs"),path=require("node:path"),{Worker}=require("node:worker_threads");
const {TimelineStore}=require("./timeline-store.cjs"),{captureKey,configure}=require("./capture-codec.cjs");
class CaptureStore {
  constructor(directory,storage,{notify=()=>{},onCounts=()=>{},maxPendingBytes=32*1024*1024}={}){
    this.directory=path.resolve(directory);this.storage=storage;this.notify=notify;this.onCounts=onCounts;this.maxPendingBytes=maxPendingBytes;this.pendingBytes=0;
    this.key=captureKey(this.directory,storage);this.reader=configure(new TimelineStore(this.directory,storage),this.key);
    this.pending=new Map();this.pendingCounts=new Map();this.pendingEvents=0;this.unsent=new Map();this.requests=new Map();this.projections=new Map();this.migrated=new Set();this.recovered=new Map();this.revision=0;this.failure="";this.next=0;this.handlesParticipantCounts=true;
  }
  startWorker(){
    this.worker=new Worker(path.join(__dirname,"capture-store-worker.cjs"),{workerData:{directory:this.directory,key:this.key}});
    const worker=this.worker;
    this.ready=new Promise((resolve,reject)=>{worker.once("exit",()=>reject(Error("기록 워커가 준비되기 전에 종료됐습니다.")));this.worker.once("error",reject);this.worker.on("message",packet=>{
      if(this.worker!==worker)return;
      if(packet.type==="ready"){this.restartAttempts=0;resolve();if(this.restartPending){this.restartPending=false;for(const p of this.pending.values())if(p.sent||this.unsent.get(p.packet.session.id)!==p){p.sent=true;this.worker.postMessage(p.packet);}}}
      if(packet.type==="ack"){const item=this.pending.get(packet.id);if(item){this.pendingBytes-=item.bytes;this.pending.delete(packet.id);this.pendingEvents-=item.packet.events.length;const counts=this.pendingCounts.get(item.packet.session.id);counts.events-=item.packet.events.length;if(--counts.packets===0)this.pendingCounts.delete(item.packet.session.id);}this.updateCounts(packet.counts);this.failure="";}
      if(packet.type==="state"){this.updateCounts(packet.counts);if(packet.error)this.failure=packet.error;}
      if(packet.type==="failure"){this.failure=packet.error;this.failedPackets||=new Set();this.failedPackets.add(packet.id);this.notify();if(!this.retryTimer)this.retryTimer=setTimeout(()=>{this.retryTimer=null;const ids=[...this.failedPackets].sort((a,b)=>a-b);this.failedPackets.clear();for(const id of ids){const item=this.pending.get(id);if(item&&this.worker)this.worker.postMessage(item.packet);}},1000);}
      if(packet.type==="reply"){const req=this.requests.get(packet.id);if(!req)return;this.requests.delete(packet.id);packet.error?req.reject(Error(packet.error)):req.resolve(packet.value);}
    });});
    this.ready.catch(()=>{}); // Consumers receive the error; restart itself has no caller.
    this.worker.on("error",error=>{this.failure=error.message;for(const r of this.requests.values())r.reject(error);this.requests.clear();this.notify();});
    worker.on("exit",code=>{if(this.closing||this.worker!==worker)return;this.failure="기록 워커를 복구하고 있습니다.";for(const r of this.requests.values())r.reject(Error(this.failure));this.requests.clear();this.worker=null;this.restartPending=true;this.notify();this.restartAttempts=(this.restartAttempts||0)+1;this.restartTimer=setTimeout(()=>{if(!this.closing&&!this.worker)this.startWorker();},Math.min(10000,100*2**Math.min(7,this.restartAttempts-1)));});
  }
  updateCounts(c){if(!c)return;const s=this.state(c.id),changed=s.seq!==c.seq||s.pending!==c.pending||s.analysis.participants.size!==c.participants;s.analysis.chats=c.chats;s.analysis.donations=c.donations;s.analysis.participants.size=c.participants;s.seq=c.seq;s.pending=c.pending;if(changed){this.onCounts(c);this.revision++;this.notify();}}
  available(){return this.storage.isEncryptionAvailable();}
  dayOf(event){return this.reader.dayOf(event);}
  state(id){if(!this.projections.has(id))this.projections.set(id,{seq:0,pending:0,analysis:{chats:0,donations:0,participants:{size:0,has:()=>true},viewers:[]}});return this.projections.get(id);}
  async warm(session){if(!session)return;await this.migrate(session);this.updateCounts(await this.call("counts",session));}
  async migrate(session){
    if(this.migrated.has(session.id))return;
    const folder=this.reader.folder(session.id);if(!fs.existsSync(folder))return;
    for(const name of fs.readdirSync(folder).filter(name=>/^\d{12}\.enc$|^(summary|index)\.enc$/.test(name))){
      const file=path.join(folder,name),fd=fs.openSync(file,"r"),header=Buffer.alloc(4);fs.readSync(fd,header);fs.closeSync(fd);
      if(header.toString()==="SAT3")continue;const decoded=this.reader.decode(file);fs.writeFileSync(file+".tmp",this.reader.encode(decoded),{flush:true});fs.renameSync(file+".tmp",file);await new Promise(setImmediate);
    }
    this.migrated.add(session.id);
  }
  append(session,event){return this.appendBatch(session,[event])[0];}
  appendBatch(session,events){
    if(!this.available())throw Error("암호화 기록을 사용할 수 없습니다.");
    const bytes=events.reduce((sum,e)=>sum+512+(e.text?.length||0)*3,0);
    if(this.pendingBytes+bytes>this.maxPendingBytes)throw Error("기록 대기량이 증가했습니다. 저장 복구를 기다립니다.");
    let item=this.unsent.get(session.id);
    if(!item){const id=++this.next;item={packet:{type:"append",id,session:{id:session.id,startedAt:session.startedAt,chatCaptureMode:session.chatCaptureMode,analysisDeferred:true},events:[]},bytes:0};this.unsent.set(session.id,item);this.pending.set(id,item);const counts=this.pendingCounts.get(session.id)||{packets:0,events:0};counts.packets++;this.pendingCounts.set(session.id,counts);}
    item.packet.events.push(...events);item.bytes+=bytes;this.pendingBytes+=bytes;this.pendingEvents+=events.length;this.pendingCounts.get(session.id).events+=events.length;
    if(item.packet.events.length>=2000)this.sendPending(session.id);
    else if(!this.sendTimer){this.sendTimer=setTimeout(()=>{this.sendTimer=null;this.sendPending();},20);this.sendTimer.unref?.();}
    return events;
  }
  sendPending(sessionId){if(this.unsent.size&&!this.worker)this.startWorker();for(const [id,item]of this.unsent){if(sessionId&&id!==sessionId)continue;this.unsent.delete(id);this.ready.then(()=>{if(this.pending.has(item.packet.id)){item.sent=true;this.worker.postMessage(item.packet);}}).catch(()=>{});}}
  async call(action,...args){if(!this.worker)this.startWorker();this.sendPending();await this.ready;const id=++this.next;return new Promise((resolve,reject)=>{this.requests.set(id,{resolve,reject});this.worker.postMessage({id,action,args});});}
  async flush(session){if(!session)return true;try{return await this.call("flush",session);}catch(error){this.failure=error.message;this.notify();return false;}}
  status(session){return{encrypted:this.available(),pending:session?this.pendingCounts.get(session.id)?.events||0:this.pendingEvents,pendingBytes:this.pendingBytes,error:this.failure};}
  async queryAll(sessions,filters){for(const s of sessions)await this.prepare(s);return this.call("queryAll",sessions,filters);}
  async prepare(session){await this.migrate(session);if(session.endedAt&&!this.pendingCounts.has(session.id))return;if(!(await this.flush(session)))throw Error(this.failure||"채팅 저장을 복구한 뒤 조회하세요.");}
  async basicSummary(session,filters){await this.prepare(session);return this.call("summary",session,filters);}
  async catalog(sessions,currentId,dates){for(const s of sessions)await this.prepare(s);return this.call("catalog",sessions,currentId,dates);}
  async query(session,filters){await this.prepare(session);return this.call("query",session,filters);}
  async analysisCall(action,session,filters){
    if(!this.analysisWorker){
      const requests=this.analysisRequests=new Map(),worker=this.analysisWorker=new Worker(path.join(__dirname,"capture-analysis-worker.cjs"),{workerData:{directory:this.directory,key:this.key}});
      const fail=error=>{for(const req of requests.values())req.reject(error);requests.clear();};
      worker.on("message",p=>{const req=requests.get(p.id);if(!req)return;requests.delete(p.id);p.error?req.reject(Error(p.error)):req.resolve(p.value);});
      worker.on("error",fail);worker.on("exit",()=>{fail(Error("분석 워커가 종료됐습니다. 다시 분석할 수 있습니다."));if(this.analysisWorker===worker)this.analysisWorker=null;});
    }
    const id=++this.next;return new Promise((resolve,reject)=>{this.analysisRequests.set(id,{resolve,reject});this.analysisWorker.postMessage({id,action,session,filters});});
  }
  async analyze(session,filters){await this.prepare(session);return this.analysisCall("analyze",session,filters);}
  async summary(session,filters){await this.prepare(session);return this.analysisCall("summary",session,filters);}
  async cancelAnalysis(){if(!this.analysisWorker)return;const worker=this.analysisWorker;this.analysisWorker=null;for(const req of this.analysisRequests.values())req.reject(Error("통계 분석을 중단했습니다."));this.analysisRequests.clear();await worker.terminate();}
  async deleteDates(sessions,dates,options){await this.cancelAnalysis();for(const s of sessions)await this.prepare(s);return this.call("deleteDates",sessions,dates,options);}
  async rebuild(session){await this.prepare(session);return this.analysisCall("rebuild",session);}
  async clear(){await this.shutdown();this.reader.clear();this.worker=null;this.analysisWorker=null;this.ready=null;this.closing=false;this.pending.clear();this.pendingCounts.clear();this.pendingEvents=0;this.unsent.clear();this.requests.clear();this.projections.clear();this.migrated.clear();this.pendingBytes=0;this.failure="";this.revision++;}
  async *events(session,newest=false,filters={}){await this.prepare(session);const token=await this.call("events-open",session,newest,filters);try{for(;;){const p=await this.call("events-next",token);for(const e of p.events)yield e;if(p.done)break;}}finally{await this.call("events-close",token);}}
  async shutdown(){clearTimeout(this.sendTimer);clearTimeout(this.retryTimer);clearTimeout(this.restartTimer);if(this.worker||this.pending.size){await this.call("shutdown");if(this.pending.size)throw Error(this.failure||"미저장 채팅을 복구한 뒤 종료하세요.");this.closing=true;await this.worker.terminate();}else this.closing=true;if(this.analysisWorker){const worker=this.analysisWorker;await this.analysisCall("shutdown");await worker.terminate();}}
}
module.exports={CaptureStore};
