// Keep message-port/socket bursts from monopolizing the main event loop. Storage
// pressure pauses dispatch, not admission, and large raw-recording bursts spill
// into an encrypted receipt journal before their gameplay/analysis processing.
const {Worker}=require("node:worker_threads"),path=require("node:path"),fs=require("node:fs"),crypto=require("node:crypto");
class IngressQueue {
  constructor({engine,store,notify=()=>{},maxMemoryBytes=16*1024*1024}){Object.assign(this,{engine,store,notify,maxMemoryBytes});this.items=[];this.head=0;this.bytes=0;this.spilling=false;this.diskBatches=[];this.diskCounts=new Map();this.pendingSpills=0;this.spillingRows=0;this.requests=new Map();this.next=0;this.receiptClock=Date.now()*1000;this.waiters=[];this.processing=false;this.closed=false;this.dropped=0;this.spoolDirectory=path.join(store.directory,"receipts");}
  ensureSpool(){if(this.spoolWorker)return;const worker=this.spoolWorker=new Worker(path.join(__dirname,"ingress-spool-worker.cjs"),{workerData:{directory:this.spoolDirectory,key:this.store.key}});worker.on("message",p=>{const request=this.requests.get(p.id);if(request){this.requests.delete(p.id);p.error?request.reject(Error(p.error)):request.resolve(p.value);}});worker.on("error",error=>{this.error=error.message;for(const r of this.requests.values())r.reject(error);this.requests.clear();this.notify();});worker.on("exit",()=>{if(this.spoolWorker!==worker)return;this.spoolWorker=null;for(const r of this.requests.values())r.reject(Error("수신 기록 워커가 종료됐습니다. 복구를 시도합니다."));this.requests.clear();});}
  rpc(action,...args){this.ensureSpool();const id=++this.next;return new Promise((resolve,reject)=>{this.requests.set(id,{resolve,reject});this.spoolWorker.postMessage({id,action,args});});}
  push(message,now,options){
    const row={message,now,options,sessionId:this.engine.current?.id},bytes=512+(message.text?.length||0)*3;
    if(this.engine.current&&this.engine.current.chatCaptureMode!=="replay"&&this.store.key&&(this.bytes>this.maxMemoryBytes||this.spilling)){
      this.spilling=true;this.spillBuffer||=[];this.spillBuffer.push(row);if(this.spillBuffer.length>=1000)this.flushSpill();else if(!this.spillTimer)this.spillTimer=setTimeout(()=>{this.spillTimer=null;this.flushSpill();},20);
    }else{this.items.push(row);this.bytes+=bytes;}
    this.schedule();
  }
  flushSpill(){if(!this.spillBuffer?.length)return;const rows=this.spillBuffer;this.spillBuffer=[];this.pendingSpills++;this.spillingRows+=rows.length;this.receiptClock=Math.max(Date.now()*1000,this.receiptClock+1);const name=String(this.receiptClock).padStart(16,"0")+"-"+crypto.randomUUID()+".enc";
    void this.rpc("write",name,rows).then(()=>{this.diskBatches.push(name);this.diskCounts.set(name,rows.length);}).catch(error=>{this.error=error.message;this.items.push(...rows);this.bytes+=rows.reduce((n,r)=>n+512+(r.message.text?.length||0)*3,0);this.notify();}).finally(()=>{this.pendingSpills--;this.spillingRows-=rows.length;this.schedule();});
  }
  schedule(){if(this.scheduled||this.processing||this.closed)return;this.scheduled=true;setImmediate(()=>{this.scheduled=false;void this.pump();});}
  async pump(){if(this.processing||this.closed)return;this.processing=true;try{
    if(this.store.pendingBytes>this.store.maxPendingBytes*0.6){this.processing=false;setTimeout(()=>this.schedule(),10);return;}
    const start=performance.now();let count=0;
    while(this.head<this.items.length&&count<1000&&performance.now()-start<4&&this.store.pendingBytes<this.store.maxPendingBytes*0.6){const row=this.items[this.head];if(row.sessionId&&row.sessionId!==this.engine.current?.id){const session=this.engine.sessions?.find(s=>s.id===row.sessionId);if(!session)throw Error("수신 기록의 방송 세션을 복구할 수 없습니다.");const current=this.engine.current;try{this.engine.current=session;this.engine.capture(row.message,row.now,row.options?.historical);}finally{this.engine.current=current;}}else this.engine.ingest(row.message,row.now,row.options);this.head++;this.bytes-=512+(row.message.text?.length||0)*3;count++;}
    if(this.head===this.items.length){this.items=[];this.head=0;}
    else if(this.head>10000){this.items=this.items.slice(this.head);this.head=0;}
    if(this.activeDisks?.length&&!this.items.length){let durable=true;for(const session of this.activeSessions)if(!(await this.store.flush(session)))durable=false;if(durable){if(this.engine.current)this.engine.retryCapture(20000);if(!this.engine.captureRetries.size){for(const session of this.activeSessions)if(!(await this.store.flush(session)))durable=false;if(durable){await this.rpc("remove-many",this.activeDisks);this.diskBatches.splice(0,this.activeDisks.length);for(const name of this.activeDisks)this.diskCounts.delete(name);this.activeDisks=null;this.activeSessions=null;this.error="";}}}}
    if(!this.items.length&&!this.activeDisks?.length&&this.diskBatches.length){const names=this.diskBatches.slice(0,20),rows=await this.rpc("read-many",names);this.activeSessions=[...new Set(rows.map(r=>r.sessionId).filter(Boolean))].map(id=>[this.engine.current,...(this.engine.sessions||[])].find(s=>s?.id===id));if(this.activeSessions.some(s=>!s))throw Error("수신 기록의 방송 세션을 복구할 수 없습니다.");this.items=rows;this.head=0;this.bytes=rows.reduce((n,r)=>n+512+(r.message.text?.length||0)*3,0);this.activeDisks=names;}
    if(!this.items.length&&!this.diskBatches.length&&!this.pendingSpills&&!this.spillBuffer?.length){this.spilling=false;for(const resolve of this.waiters.splice(0))resolve();}
    if(count)this.notify();
  }catch(error){this.error=error.message;this.notify();setTimeout(()=>this.schedule(),1000);return;}finally{this.processing=false;}
    if(this.items.length||this.diskBatches.length)this.schedule();
  }
  get pending(){const active=new Set(this.activeDisks||[]);return this.items.length-this.head+(this.spillBuffer?.length||0)+this.spillingRows+this.diskBatches.reduce((n,name)=>n+(active.has(name)?0:this.diskCounts.get(name)||1),0);}
  async restore(){if(!fs.existsSync(this.spoolDirectory))return;const names=await this.rpc("list");if(names.length){this.receiptClock=names.reduce((latest,name)=>Math.max(latest,Number(name.slice(0,16))),this.receiptClock);this.diskBatches=names;this.spilling=true;this.schedule();}}
  drain(){this.flushSpill();if(!this.pending&&!this.diskBatches.length&&!this.pendingSpills&&!this.processing)return Promise.resolve();return new Promise(resolve=>{this.waiters.push(resolve);this.schedule();});}
  async close(){await this.drain();this.closed=true;clearTimeout(this.spillTimer);if(this.spoolWorker)await this.spoolWorker.terminate();}
}
module.exports={IngressQueue};
