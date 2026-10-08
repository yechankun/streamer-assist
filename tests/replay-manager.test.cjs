const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {CaptureStore}=require("../electron/capture-store.cjs"),{Engine}=require("../electron/engine.cjs"),{ReplayManager}=require("../electron/replay-manager.cjs");
function fixture(t,providers){const root=fs.mkdtempSync(path.join(os.tmpdir(),"replay-manager-test-")),key=crypto.randomBytes(32),storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:d=>d.toString()};const store=new CaptureStore(path.join(root,"data"),storage),engine=new Engine({}, {journal:store});engine.start("VOD",0,1000,{chatCaptureMode:"replay"});const session=engine.stop(100000);const tools={snapshot:()=>[],close:async()=>{}},manager=new ReplayManager({root,store,engine,tools,providers});t.after(async()=>{await manager.close();await store.shutdown();const resolved=fs.realpathSync(root);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"replay-manager-test-"));fs.rmSync(resolved,{recursive:true,force:true});});return{root,store,engine,session,manager,tools};}
test("multiple VOD pages merge by stable source ID without affecting archived live votes, markers or viewers",async t=>{
  const providers={requestsPerSecond:2,discover:async()=>[],async *collect(source){const message={platform:source.platform,id:"stable",userId:"viewer",name:"시청자",text:"후반 채팅",timestamp:5000,offsetMs:4000};yield{messages:[message],cursor:1,source,verification:"fixture"};yield{messages:[message,{...message,id:"second",timestamp:6000}],cursor:2,source,verification:"fixture"};}};
  const {store,session,manager}=fixture(t,providers);session.markers=[{id:"manual",kind:"manual",at:0,label:"keep"}];session.polls=[{id:"poll",counts:[3,5]}];
  const result=await manager.start(session.id,{sources:["https://www.youtube.com/watch?v=abcdefghijk"],analyze:false});assert.equal(result.status,"completed");assert.equal(result.saved,2);assert.equal(result.received,3);assert.equal(session.replay.coverage,"available-replay-only");assert.equal(session.markers[0].id,"manual");assert.deepEqual(session.polls[0].counts,[3,5]);
  const records=await store.queryAll([session],{limit:100});assert.equal(records.events.length,2);assert.equal(records.events[0].origin,"vod-replay");assert.equal(records.events[0].sourceVideoId,"abcdefghijk");
  await manager.start(session.id);assert.equal(store.state(session.id).analysis.chats,2,"retry completed videos does not import twice");
});
test("missing replay waits for availability and can be paused instead of marking zero-chat success",async t=>{
  const {session,manager}=fixture(t,{discover:async()=>[],requestsPerSecond:2});session.endedAt=Date.now();manager.afterStop(session);const job=await manager.start(session.id);assert.equal(job.status,"waiting");assert.ok(job.nextAt>Date.now());manager.cancel(session.id);assert.equal(job.status,"paused");
});
test("API failure keeps the last durable page cursor and source data for retry",async t=>{
  let fail=true;const provider={requestsPerSecond:2,discover:async()=>[],async *collect(source,{cursor}){if(cursor<1)yield{messages:[{platform:"chzzk",id:"first",userId:"u",name:"name",text:"saved",timestamp:4000}],cursor:1,source,verification:"unofficial-pagination"};if(fail)throw Error("HTTP 429");yield{messages:[{platform:"chzzk",id:"last",userId:"u",name:"name",text:"recovered",timestamp:5000}],cursor:2,source,verification:"unofficial-pagination"};}};
  const {session,manager,store}=fixture(t,provider);let job=await manager.start(session.id,{sources:["https://chzzk.naver.com/video/123"]});assert.equal(job.status,"failed");assert.equal(job.sources[0].cursor,1);assert.equal(store.state(session.id).analysis.chats,1);fail=false;job=await manager.start(session.id);assert.equal(job.status,"completed");assert.equal(job.saved,2);
});
test("highlight analysis combines separately imported platform videos in occurrence order",async t=>{
  const providers={discover:async()=>[],async *collect(source){
    const messages=Array.from({length:10},(_,i)=>({platform:source.platform,id:source.videoId+"-"+i,userId:"u"+i,name:"viewer",text:"ㅋㅋ",timestamp:5000+i*10,offsetMs:4000+i*10}));
    yield{messages,cursor:1,source,verification:"fixture"};
    if(source.platform==="youtube")yield{messages:[{...messages[0],id:"late",timestamp:90000,offsetMs:89000}],cursor:2,source,verification:"fixture"};
  }};
  const {session,manager}=fixture(t,providers);const job=await manager.start(session.id,{sources:["https://www.youtube.com/watch?v=abcdefghijk","https://www.twitch.tv/videos/123"],analyze:true});assert.equal(job.status,"completed");assert.equal(job.saved,21);const marker=session.markers.find(m=>m.kind==="replay-auto");assert.ok(marker);assert.ok(marker.at<5000,"combined early reaction is detected despite the later first-video tail");
});
