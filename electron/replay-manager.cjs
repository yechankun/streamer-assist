const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {encode,decode}=require("./capture-codec.cjs"),{ReplayTools}=require("./replay-tools.cjs"),{ReplayProviders}=require("./replay-providers.cjs"),{videoReference}=require("./replay-parsers.cjs"),{participantKey,profileOf}=require("./chat-analysis.cjs");
class ReplayManager {
  constructor({root,store,auth,engine,notify=()=>{},providers,tools}){
    Object.assign(this,{store,auth,engine,notify});this.root=path.resolve(root,"replay-work");fs.mkdirSync(this.root,{recursive:true});this.file=path.join(root,"replay-jobs.enc");this.jobs=new Map();this.active=null;this.closed=false;
    this.tools=tools||new ReplayTools(root,{notify});this.providers=providers||new ReplayProviders({auth,tools:this.tools});
    if(fs.existsSync(this.file)){try{for(const job of decode(fs.readFileSync(this.file),store.key)){if(["running","discovering","analyzing"].includes(job.status))job.status="paused";this.jobs.set(job.sessionId,job);}}catch{this.loadError="이전 다시보기 작업 목록을 읽지 못했습니다.";}}
  }
  session(id){const found=[this.engine.current,...this.engine.sessions].find(s=>s?.id===id);if(!found)throw Error("방송 기록을 선택하세요.");return found;}
  save(){fs.writeFileSync(this.file+".tmp",encode([...this.jobs.values()],this.store.key),{flush:true});fs.renameSync(this.file+".tmp",this.file);this.notify();}
  snapshot(){return{jobs:[...this.jobs.values()].map(job=>({...job,sessionTitle:this.sessionTitle(job.sessionId)})),tools:this.tools.snapshot(),error:this.loadError||""};}
  sessionTitle(id){return[this.engine.current,...this.engine.sessions].find(s=>s?.id===id)?.title||"삭제된 방송";}
  get nextAt(){const values=[...this.jobs.values()].filter(j=>j.status==="waiting").map(j=>j.nextAt);return values.length?Math.min(...values):null;}
  afterStop(session){if(session.chatCaptureMode==="replay"){const job=this.jobs.get(session.id)||{sessionId:session.id,sources:[],received:0,saved:0,analyze:session.replayAutoAnalyze===true,attempts:0};Object.assign(job,{status:"waiting",nextAt:Date.now()+30000});this.jobs.set(session.id,job);session.replay={origin:"vod-replay",status:"waiting",coverage:"available-replay-only"};this.save();}else if(session.replayAutoAnalyze)void this.analyze(session.id);}
  tick(now=Date.now()){if(this.closed||this.active)return;const job=[...this.jobs.values()].find(j=>j.status==="waiting"&&j.nextAt<=now);if(job)void this.start(job.sessionId).catch(()=>{});}
  async discover(id){const session=this.session(id);if(!session.endedAt)throw Error("방송이 종료된 뒤 다시보기를 조회하세요.");return this.providers.discover(session,new AbortController().signal);}
  async start(id,{sources,analyze,requestsPerSecond=2}={}){
    const session=this.session(id);if(!session.endedAt)throw Error("방송 종료 후 채팅을 가져올 수 있습니다.");if(session.chatCaptureMode!=="replay"&&(session.telemetry?.chats||session.telemetry?.donations))throw Error("실시간 원본이 있는 방송은 기존 기록의 분석을 사용하세요.");
    if(this.active)throw Error("다른 다시보기 작업이 진행 중입니다.");
    if(!Number.isFinite(requestsPerSecond)||requestsPerSecond<0.1||requestsPerSecond>10)throw Error("수집 속도는 초당 0.1~10회로 선택하세요.");this.providers.requestsPerSecond=requestsPerSecond;
    const job=this.jobs.get(id)||{sessionId:id,sources:[],received:0,saved:0,attempts:0,analyze:false};
    if(sources){if(!Array.isArray(sources)||!sources.length||sources.length>100)throw Error("다시보기 영상을 추가하세요.");job.sources=sources.map(row=>({...videoReference(typeof row==="string"?row:row.url),startedAt:Number.isFinite(row.startedAt)?row.startedAt:session.startedAt,cursor:0,saved:0}));}
    if(typeof analyze==="boolean")job.analyze=analyze;this.jobs.set(id,job);const controller=new AbortController();let finish;const done=new Promise(resolve=>{finish=resolve;});this.active={id,controller,done};job.status="discovering";job.error="";this.save();
    try{
      if(!job.sources.length)job.sources=(await this.providers.discover(session,controller.signal)).map(row=>({...row,cursor:0,saved:0}));
      if(!job.sources.length){job.status=Date.now()-session.endedAt<86400000?"waiting":"failed";job.attempts++;job.nextAt=Date.now()+Math.min(3600000,60000*2**Math.min(6,job.attempts));job.error="다시보기가 아직 없거나 방송과 연결할 수 없습니다. 영상 주소를 직접 추가할 수 있습니다.";this.save();return job;}
      job.status="running";this.save();
      for(const source of job.sources){if(source.completed)continue;
        const work=path.join(this.root,crypto.createHash("sha256").update(id+source.platform+source.videoId).digest("hex"));fs.mkdirSync(work,{recursive:true});
        try{for await(const page of this.providers.collect(source,{signal:controller.signal,work,cursor:source.cursor,onProgress:p=>{job.progress=p;this.notify();}})){
          const beforeSaved=this.store.state(id).analysis.chats+this.store.state(id).analysis.donations;
          const events=[];for(const message of page.messages){if(typeof message.text!=="string"||message.text.length>10000||!Number.isFinite(message.timestamp))continue;const key=message.userId?participantKey(this.engine.identitySalt,message.platform,message.userId):null;
            if(key)events.push({type:"participant",...profileOf(message,key,message.timestamp)});
            events.push({type:message.kind==="donation"?"donation":"chat",id:"record:"+message.platform+":"+crypto.createHash("sha256").update((message.kind==="donation"?"donation":"chat")+":"+message.id).digest("hex"),platform:message.platform,participantKey:key,displayName:message.name||"",text:message.text,timestamp:message.timestamp,receivedAt:Date.now(),sourceMessageId:message.id,historical:true,origin:"vod-replay",sourceVideoId:source.videoId,replayOffsetMs:message.offsetMs,replayDonationText:message.replayDonationText,subscriber:message.subscriber??null,roles:message.roles||[],...(message.kind==="donation"?{amountMicros:message.amountMicros,currency:message.currency,donationDisplayText:message.donationDisplayText,providerType:"replay"}:{})});
          }
          for(let first=0;first<events.length;first+=2000){const batch=events.slice(first,first+2000);try{this.store.appendBatch({...session,analysisDeferred:!job.analyze},batch);}catch(error){if(!(await this.store.flush(session)))throw error;this.store.appendBatch({...session,analysisDeferred:!job.analyze},batch);}}
          if(!(await this.store.flush(session)))throw Error(this.store.failure||"다시보기 저장 실패. 같은 위치에서 다시 시작할 수 있습니다.");
          job.received+=page.messages.length;source.cursor=page.cursor;source.verification=page.verification;job.saved=this.store.state(id).analysis.chats+this.store.state(id).analysis.donations;source.saved+=Math.max(0,job.saved-beforeSaved);session.telemetry={...session.telemetry,chats:this.store.state(id).analysis.chats,donations:this.store.state(id).analysis.donations,participants:this.store.state(id).analysis.participants.size};this.save();
        }source.completed=true;this.save();}finally{const resolved=fs.realpathSync(work);if(!resolved.startsWith(fs.realpathSync(this.root)+path.sep)||fs.lstatSync(work).isSymbolicLink())throw Error("허용되지 않은 임시 경로입니다.");fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
      }
      session.replay={origin:"vod-replay",status:"completed",coverage:"available-replay-only",sources:job.sources.map(s=>({platform:s.platform,videoId:s.videoId,verification:s.verification,startedAt:s.startedAt})),completedAt:Date.now()};job.status="completed";job.error="";
      if(job.analyze){job.status="analyzing";this.save();await this.applyAnalysis(session);job.status="completed";}
      this.engine.revision++;this.save();return job;
    }catch(error){job.status=controller.signal.aborted?"paused":"failed";if(error.replayCode==="not-ready"&&Date.now()-session.endedAt<86400000){job.status="waiting";job.attempts++;job.nextAt=Date.now()+Math.min(3600000,60000*2**Math.min(6,job.attempts));}job.error=error.message.slice(0,1600);session.replay={...session.replay,status:job.status,coverage:"available-replay-only"};this.save();return job;}
    finally{this.active=null;finish();this.notify();}
  }
  async applyAnalysis(session){const result=await this.store.rebuild(session);session.markers=session.markers.filter(m=>m.kind!=="replay-auto").concat(result.markers).sort((a,b)=>a.at-b.at);session.analysisComputedAt=Date.now();session.analysisDeferred=false;this.engine.revision++;this.notify();return result;}
  async analyze(id){if(this.active)throw Error("진행 중인 수집을 완료한 뒤 분석하세요.");const session=this.session(id);if(!session.endedAt)throw Error("방송 종료 후 분석하세요.");let finish;const done=new Promise(resolve=>{finish=resolve;});this.active={id,controller:new AbortController(),done,kind:"analysis"};const job=this.jobs.get(id)||{sessionId:id,sources:[],received:0,saved:session.telemetry?.chats||0};job.status="analyzing";this.jobs.set(id,job);this.save();try{const result=await this.applyAnalysis(session);job.status="completed";this.save();return result;}catch(error){job.status=this.active?.controller.signal.aborted?"paused":"failed";job.error=error.message;this.save();throw error;}finally{this.active=null;finish();this.notify();}}
  cancel(id){if(this.active?.id===id){this.active.controller.abort();if(this.active.kind==="analysis"||this.jobs.get(id)?.status==="analyzing")void this.store.cancelAnalysis?.();}const job=this.jobs.get(id);if(job?.status==="waiting"){job.status="paused";this.save();}}
  async close(){this.closed=true;const active=this.active;if(active){this.cancel(active.id);await active.done;}await this.tools.close?.();}
}
module.exports={ReplayManager};
