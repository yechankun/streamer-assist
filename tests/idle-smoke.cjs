// Exercise the production collection callbacks while every app window is hidden.
const {app,globalShortcut} = require("electron");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{spawn}=require("node:child_process");
const {waitFor}=require("./layout-check.cjs");
const profile=process.env.STREAMER_ASSIST_TEST_PROFILE;
if(!profile)throw Error("Use scripts/test-desktop.cjs --suite idle for an isolated profile.");
fs.mkdirSync(profile,{recursive:true});app.setPath("userData",profile);process.argv.push("--hidden");
const shortcut="CommandOrControl+Alt+Shift+F18";
fs.writeFileSync(path.join(profile,"preferences.json"),JSON.stringify({trayEnabled:true,autoRecord:false,shortcut}));
let engine,platforms,builds=0;const transports={};
const chzzk=require("../electron/chzzk.cjs"),twitch=require("../electron/twitch.cjs");
const fake=platform=>class{
  constructor(options){this.options=options;transports[platform]=this;}
  async connect(){this.options.onStatus("연결됨");this.options.onLive?.(true);}
  disconnect(){this.disconnected=true;}
  emit(message){this.options.onMessage({...message,platform});}
};
chzzk.PublicChat=fake("chzzk");twitch.TwitchChat=fake("twitch");
const platformModule=require("../electron/platforms.cjs");
const OriginalPlatforms=platformModule.Platforms;
platformModule.Platforms=class extends OriginalPlatforms{constructor(...args){super(...args);platforms=this;engine=this.engine;}};
const {Engine}=require("../electron/engine.cjs"),snapshot=Engine.prototype.snapshot;
Engine.prototype.snapshot=function(...args){builds++;return snapshot.apply(this,args);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeout=setTimeout(()=>{console.error("Hidden collection test timed out");app.exit(1);},20000);
app.once("browser-window-created",(_event,win)=>win.webContents.once("did-finish-load",async()=>{
  const js=(fn,...args)=>win.webContents.executeJavaScript("("+fn.toString()+")("+args.map(value=>JSON.stringify(value)).join(",")+")");
  const call=async(action,payload={})=>{const reply=await js((action,payload)=>window.assist.call(action,payload),action,payload);assert.ok(reply.ok,reply.error);return reply.data;};
  try{
    await delay(150);assert.equal(win.isVisible(),false);assert.equal(globalShortcut.isRegistered(shortcut),true);
    assert.equal(require.cache[require.resolve("../electron/ai-service.cjs")],undefined,"unused AI service is not initialized");
    await call("start",{title:"트레이에서 보존하는 수집"});
    await platforms.connect({chzzkChannelId:"fixture-channel",twitch:true,twitchUserId:"fixture-user"});
    assert.ok(transports.chzzk&&transports.twitch,"both fixture transports are connected without network access");
    engine.createPoll("숨겨도 자동 종료",["첫 번째","두 번째"],"chat",["chzzk","twitch"],"!",3);
    engine.audience.startDonation({question:"숨긴 후원",options:["첫 번째","두 번째"],platforms:["chzzk"],chatPrefix:"!",currency:"KRW",minimumMicros:1000000,plural:false,timerSeconds:3});
    platforms.notify();await delay(100);const before=builds;
    const started=Date.now();
    for(let i=0;i<2000;i++){
      const transport=transports[i%2?"twitch":"chzzk"];
      const message={id:"message-"+i,userId:"viewer-"+i,name:"시청자 "+i,text:"!1 순서 "+i,timestamp:Date.now()};
      transport.emit(message);if(i%10===0)transport.emit(message);
    }
    for(let i=0;i<10;i++)transports.chzzk.emit({kind:"donation",id:"donation-"+i,userId:"donor-"+i,name:"후원자 "+i,text:"!2",currency:"KRW",amountMicros:1000000,timestamp:Date.now()});
    await platforms.drain();
    assert.equal(engine.chatCount,2000,"all unique messages are counted once");
    assert.equal(engine.poll.counts[0],2000);assert.equal(engine.audience.donationPoll.counts[1],10);
    const markersBeforeShortcut=engine.current.markers.length;
    if(process.platform==="win32")await new Promise((resolve,reject)=>{
      const helper=spawn("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-File",path.join(__dirname,"idle-shortcut.ps1")],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
      let error="";helper.stderr.on("data",value=>error+=value);helper.once("error",reject);helper.once("exit",code=>code===0?resolve():reject(Error(error||"Shortcut probe failed")));
    });
    if(process.platform==="win32")await waitFor(()=>engine.current.markers.length>markersBeforeShortcut,"native shortcut records a marker from the tray");
    await waitFor(()=>!engine.poll.active&&!engine.audience.donationPoll.active,"background vote deadlines",5000);
    assert.equal(engine.poll.closedAt,engine.poll.endsAt);assert.equal(engine.audience.donationPoll.closedAt,engine.audience.donationPoll.endsAt);
    assert.equal(builds,before,"hidden traffic and maintenance never build renderer snapshots");
    assert.ok(!transports.chzzk.disconnected&&!transports.twitch.disconnected,"hiding leaves transports connected");
    const events=[];let cursor;
    do{const data=await call("timeline-history",{limit:100,before:cursor});events.push(...data.events);const next=data.hasMore?data.nextCursor:null;if(next&&cursor)assert.notDeepEqual(next,cursor,"record cursor must advance");cursor=next;}while(cursor);
    const chats=events.filter(event=>event.type==="chat").sort((a,b)=>a.seq-b.seq);
    assert.equal(chats.length,2000);assert.deepEqual(chats.map(event=>event.text),Array.from({length:2000},(_,i)=>"!1 순서 "+i));
    assert.equal(events.filter(event=>event.type==="donation").length,10);
    await js(()=>{window.__idleObserved=null;window.assist.subscribe(state=>window.__idleObserved=state);});
    win.showInactive();await waitFor(()=>js(()=>window.__idleObserved?.chatCount===2000),"fresh snapshot on tray restore");
    win.minimize();const minimizedBuilds=builds;
    transports.chzzk.emit({id:"minimized-message",userId:"minimized-viewer",name:"최소화 시청자",text:"최소화 수집",timestamp:Date.now()});
    await delay(1100);assert.equal(engine.chatCount,2001);assert.equal(builds,minimizedBuilds,"minimized collection also skips snapshots");
    win.restore();await waitFor(()=>js(()=>window.__idleObserved?.chatCount===2001),"fresh snapshot on minimize restore");
    await call("stop");
    const saved=await call("timeline-history",{limit:100,text:"최소화 수집",platform:"chzzk",kind:"chat"});
    assert.deepEqual(saved.events.map(event=>event.text),["최소화 수집"],"the final minimized chat is readable from the completed disk archive");
    clearTimeout(timeout);
    console.log("PASS: hidden/minimized collection: 2,001 chats + 10 donations, duplicate rejection, exact order, real Windows global shortcut, background deadlines, no hidden snapshots, restored UI ("+(Date.now()-started)+"ms)");
    app.quit();
  }catch(error){clearTimeout(timeout);console.error(error);console.error({markers:engine?.current?.markers?.map(marker=>({kind:marker.kind,label:marker.label})),chatCount:engine?.chatCount});app.exit(1);}
}));
require("../electron/main.cjs");
