const {test}=require("node:test"),assert=require("node:assert/strict"),{Engine}=require("../electron/engine.cjs"),{ChatAnalysis}=require("../electron/chat-analysis.cjs");
function journal(){const analysis=new ChatAnalysis(),events=[];return{events,analysis,state:()=>({analysis}),append(session,event){events.push(event);analysis.accept(event,session.startedAt,{statistics:session.chatCaptureMode!=="deferred"});},flush:()=>true};}
test("replay capture mode keeps live participation, viewer records and markers without raw chat/donation archive",()=>{
  const store=journal(),engine=new Engine({}, {journal:store});engine.start("Replay",0,1000,{chatCaptureMode:"replay"});engine.createPoll("Q",["A","B"],"chat",["chzzk"],"!",null,1000);
  engine.audience.startRaffle({title:"함께할 시청자",platforms:["chzzk"],entryMode:"any",keyword:"!join",subscribersOnly:false,excludeWinners:true,timerSeconds:null},1000);
  for(let i=0;i<100;i++)engine.ingest({platform:"chzzk",id:"chat"+i,userId:"person"+i,text:"!1",timestamp:1100},1100);
  engine.ingest({platform:"youtube",id:"catch-up",userId:"old",text:"reconnect history",timestamp:1100},1100,{historical:true});
  engine.ingest({platform:"chzzk",kind:"donation",id:"tip",userId:"tipper",text:"donation",amountMicros:1000000000,currency:"KRW",timestamp:1100},1100);
  engine.sampleViewers([{platform:"chzzk",live:true,viewers:1234}],1200);engine.mark("keep", "manual", null,1300);
  assert.equal(engine.poll.counts[0],100);assert.equal(engine.audience.candidates.size,100);assert.equal(engine.recent.length,0);assert.equal(engine.current.markers.length,1);
  assert.equal(store.events.filter(e=>e.type==="chat"||e.type==="donation"||e.type==="participant").length,0);assert.equal(store.events.filter(e=>e.type==="viewers").length,1);
});
test("deferred mode retains raw records and basic counts without live full reaction analysis",()=>{
  const store=journal(),engine=new Engine({}, {journal:store});engine.start("defer",0,1000,{chatCaptureMode:"deferred"});
  for(let i=0;i<100;i++)engine.ingest({platform:"chzzk",id:"m"+i,userId:"u"+i,text:"ㅋㅋ 좋네요",timestamp:1100},1100);
  assert.equal(store.analysis.chats,100);assert.equal(store.analysis.participants.size,100);assert.equal(store.analysis.words.size,0);assert.equal(engine.current.markers.length,0);assert.equal(engine.recent.length,0);
});
test("failed admission is retryable without repeating the live vote",()=>{
  const store=journal();let failed=true;const append=store.append;store.append=(session,event)=>{if(failed)throw Error("disk full");return append(session,event);};
  const engine=new Engine({}, {journal:store});engine.start("retry",0,1000);engine.createPoll("Q",["A","B"],"chat",["chzzk"],"!",null,1000);
  const message={platform:"chzzk",id:"failed",userId:"one",text:"!1",timestamp:1100};engine.ingest(message,1100);assert.equal(engine.current.captureGaps,1);failed=false;engine.retryCapture();engine.ingest(message,1100);
  assert.equal(store.events.filter(e=>e.type==="chat").length,1);assert.equal(engine.current.captureGaps,0);assert.equal(engine.captureRetries.size,0);assert.equal(engine.poll.counts[0],1);
});
