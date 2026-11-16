// Render the real winner dialog; verify pixels, explicit motion preferences and
// cleanup without connecting an account or changing the user's Windows settings.
const {app}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {waitFor,settleUI,assertLayout}=require('./layout-check.cjs');
app.setPath('userData',process.env.STREAMER_ASSIST_TEST_PROFILE||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'assist-winner-effects-')));
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
process.env.STREAMER_ASSIST_SHORTCUT='CommandOrControl+Alt+Shift+F18';
let engine;
const platforms=require('../electron/platforms.cjs'),Original=platforms.Platforms;
platforms.Platforms=class extends Original{constructor(...args){super(...args);engine=this.engine;}};
const timeout=setTimeout(()=>{console.error('Winner effect smoke timed out');app.exit(1);},45000);
app.once('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',async()=>{
  const web=window.webContents;
  const js=(fn,...args)=>web.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`);
  const call=async(action,payload={})=>{const r=await js((a,p)=>window.assist.call(a,p),action,payload);assert.ok(r.ok,r.error);return r.data;};
  const motion=async value=>{await web.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value}]});};
  const draw=async()=>{await js(()=>document.querySelector('.raffle-draw').click());await waitFor(()=>js(()=>!!document.querySelector('.raffle-winner-dialog[open]')),'winner dialog',5000);};
  const close=async()=>{await js(()=>document.querySelector('.raffle-winner-close').click());await waitFor(()=>js(()=>!document.querySelector('.raffle-winner-dialog')),'winner closed');};
  const painted=()=>js(()=>{const canvas=document.querySelector('.winner-fireworks canvas'),layer=document.querySelector('.winner-celebration');
    return layer?.dataset.running==='true'&&getComputedStyle(layer).display!=='none'&&!!canvas?.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0);});
  try {
    web.setBackgroundThrottling(false);web.debugger.attach('1.3');await motion('reduce');
    window.setContentSize(1280,850);await call('start',{title:'당첨 효과 검증'});await call('draw-animations-set',{enabled:true});
    engine.audience.startRaffle({title:'당첨 축하',entryMode:'any',keyword:'',subscribersOnly:false,excludeWinners:false,platforms:['chzzk'],timerSeconds:null});
    engine.ingest({platform:'chzzk',userId:'winner',name:'테스트 당첨자',text:'참여합니다',timestamp:Date.now()});await call('state');
    await js(()=>[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('시청자 추첨')).click());await settleUI(window);
    await draw();await waitFor(painted,'fireworks paint despite Windows reduced motion',2500);
    await waitFor(()=>js(()=>document.querySelector('.winner-confetti')?.width===innerWidth),'confetti worker viewport');
    assert.equal(await js(()=>{try{document.querySelector('.winner-confetti').getContext('2d');return false;}catch{return true;}}),true,'confetti uses the worker even with system reduced motion');
    await assertLayout(window,'winner effects with Windows reduced motion');
    if(process.env.STREAMER_ASSIST_TEST_SCREENSHOTS==='1'){
      const directory=path.join(__dirname,'../release/winner-effects');fs.mkdirSync(directory,{recursive:true});
      fs.writeFileSync(path.join(directory,'system-reduced-effects-on.png'),(await web.capturePage()).toPNG());
    }
    await motion('no-preference');assert.equal(await js(()=>document.querySelector('.winner-celebration').dataset.running),'true','changing Windows motion does not cancel an explicitly enabled celebration');
    await call('draw-animations-set',{enabled:false});await waitFor(()=>js(()=>document.querySelector('.winner-celebration')?.dataset.running!=='true'),'turning off effects cancels the current celebration');
    await call('draw-animations-set',{enabled:true});assert.equal(await js(()=>document.querySelector('.winner-celebration')?.dataset.running==='true'),false,'enabling the setting does not replay an already shown winner');
    await close();await call('draw-animations-set',{enabled:false});await draw();
    assert.equal(await painted(),false,'app setting disables celebration with Windows motion enabled');
    await call('draw-animations-set',{enabled:true});await settleUI(window);assert.equal(await painted(),false,'a previously skipped winner is not replayed');
    await close();await motion('reduce');await draw();await waitFor(painted,'a new winner celebrates after re-enabling effects',2500);
    await js(()=>[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('숫자 투표')).click());await settleUI(window);
    assert.equal(await js(()=>document.querySelector('.winner-celebration')?.dataset.running==='true'),false,'inactive tab stops the celebration');
    await js(()=>[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('시청자 추첨')).click());await settleUI(window);
    assert.equal(await painted(),false,'returning to the same winner does not replay effects');
    await close();clearTimeout(timeout);console.log('PASS: actual winner fireworks/confetti with Windows reduced motion, explicit app setting, immediate cleanup, no old-result replay and new-winner replay');app.quit();
  }catch(error){console.error(error.stack||error);clearTimeout(timeout);app.exit(1);}
}));
require('../electron/main.cjs');
