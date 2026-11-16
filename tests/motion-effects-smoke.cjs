// Exercise the renderer under both Windows motion preferences. CSS probes use
// the app's real loaded styles; vote counters, bars and transitions use real UI.
const {app}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {waitFor,settleUI}=require('./layout-check.cjs');
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
app.setPath('userData',process.env.STREAMER_ASSIST_TEST_PROFILE||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'assist-motion-effects-')));
process.env.STREAMER_ASSIST_SHORTCUT='CommandOrControl+Alt+Shift+F18';
let engine;
const platforms=require('../electron/platforms.cjs'),Original=platforms.Platforms;
platforms.Platforms=class extends Original{constructor(...args){super(...args);engine=this.engine;}};
const timeout=setTimeout(()=>{console.error('Motion effect smoke timed out');app.exit(1);},60000);
app.once('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',async()=>{
  const web=window.webContents,js=(fn,...args)=>web.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`);
  const call=async(action,payload={})=>{const r=await js((a,p)=>window.assist.call(a,p),action,payload);assert.ok(r.ok,r.error);};
  const tab=async name=>{await js(name=>[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes(name)).click(),name);await settleUI(window);};
  try {
    web.setBackgroundThrottling(false);web.debugger.attach('1.3');window.setContentSize(1280,850);
    await tab('설정');await js(()=>[...document.querySelectorAll('.settings-tabs button')].find(b=>b.textContent.includes('AI 연결')).click());
    await waitFor(()=>js(()=>!!document.querySelector('.ai-settings')),'AI styles loaded');await settleUI(window);
    await call('start',{title:'전체 연출 검사'});await call('draw-animations-set',{enabled:true});
    await js(()=>{const original=document.startViewTransition.bind(document);document.startViewTransition=update=>{const transition=original(update);window.__motionTransition=transition;return transition;};});
    for(const preference of ['reduce','no-preference']) {
      await web.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:preference}]});
      assert.equal(await js(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),preference==='reduce');
      const css=await js(async()=>{
        const root=document.createElement('div');root.style.cssText='position:fixed;left:0;top:0;width:12px;height:12px;overflow:hidden;pointer-events:none;z-index:-1';
        root.innerHTML='<div data-probe="page" class="screen-enter"></div><div data-probe="winner" class="winner-panel"></div>'+
          '<div class="winner-pixel-character" data-character-idle="true"><div data-probe="breathing" class="character-idle-breath"></div></div>'+
          '<div data-probe="response" class="character-chat-response"></div><div class="winner-character-mode"><div data-probe="chat" class="winner-chat-current"></div></div>'+
          '<div data-probe="login" class="ai-login-spinner"></div><div class="ai-working"><i data-probe="working"></i></div>'+
          '<div class="speech-voice-wave"><i data-probe="speech"></i></div><div class="speech-voice-card"></div>'+
          '<div class="workspace-layout" data-topbar-hidden="true"><header class="app-header"></header></div>';
        document.body.append(root);await new Promise(resolve=>requestAnimationFrame(resolve));
        const before=[...root.querySelectorAll('[data-probe]')].map(el=>({name:el.dataset.probe,animation:el.getAnimations()[0],time:el.getAnimations()[0]?.currentTime}));
        // Hosted Windows may delay compositor frames. Still require every
        // animation to advance, without assuming a fixed sub-frame latency.
        const deadline=performance.now()+3000;let progress;
        do {
          await new Promise(resolve=>setTimeout(resolve,30));
          progress=before.map(row=>({name:row.name,animated:!!row.animation&&row.animation.currentTime>row.time}));
        } while(progress.some(row=>!row.animated)&&performance.now()<deadline);
        const transitions=['.speech-voice-card','.app-header'].map(selector=>({selector,animated:getComputedStyle(root.querySelector(selector)).transitionDuration.split(',').some(time=>parseFloat(time)>0)}));
        root.remove();return {progress,transitions};
      });
      assert.equal(css.progress.length,8);assert.ok(css.progress.every(row=>row.animated),preference+': CSS effects advance '+JSON.stringify(css));
      assert.ok(css.transitions.every(row=>row.animated),preference+': voice cards and top bar retain transitions');
      if(engine.poll?.active)engine.endPoll();
      engine.createPoll('움직이는 득표수와 그래프',['첫 번째','두 번째'],'chat',['chzzk'],'!투표');engine.revision++;
      await call('state');await tab('숫자 투표');await waitFor(()=>js(()=>!!document.querySelector('.broadcast-poll')),'vote presentation');await settleUI(window);
      await js(()=>{
        const number=document.querySelector('.broadcast-stats .animated-number'),bar=document.querySelector('.broadcast-fill');
        const read=()=>({total:Number(number.textContent.replaceAll(',','')),width:bar.getBoundingClientRect().width});
        window.__motionSamples=[read()];window.__motionSamplesDone=false;const until=performance.now()+1000;let previous=0;
        const tick=now=>{if(now-previous>=30){window.__motionSamples.push(read());previous=now;}if(now<until)requestAnimationFrame(tick);else window.__motionSamplesDone=true;};requestAnimationFrame(tick);
      });
      engine.poll.counts=[4500,500];engine.revision++;await call('state');
      await waitFor(()=>js(()=>window.__motionSamplesDone),'counter and graph samples');
      const samples=await js(()=>window.__motionSamples);
      assert.equal(samples[0].total,0);assert.equal(samples.at(-1).total,5000);
      assert.ok(samples.some(row=>row.total>0&&row.total<5000),preference+': counter renders intermediate values');
      const finalWidth=samples.at(-1).width;
      assert.ok(finalWidth>0&&samples.some(row=>row.width>0&&row.width<finalWidth-1),preference+': graph fills through intermediate widths');
      await tab('방송 타임라인');
      await js(()=>{const number=document.querySelector('.broadcast-stats .animated-number');window.__hiddenTotals=[];window.__hiddenCounterObserver=new MutationObserver(()=>window.__hiddenTotals.push(Number(number.textContent.replaceAll(',',''))));window.__hiddenCounterObserver.observe(number,{childList:true,characterData:true,subtree:true});});
      engine.poll.counts=[4600,600];engine.revision++;await call('state');
      await waitFor(()=>js(()=>window.__hiddenTotals.includes(5200)),preference+': inactive counter updates to the latest total');
      const hiddenTotals=await js(()=>{window.__hiddenCounterObserver.disconnect();return window.__hiddenTotals;});
      assert.ok(hiddenTotals.every(value=>value===5200),preference+': inactive counter does not run intermediate frames');
      await tab('숫자 투표');
      await call('poll-stop');await settleUI(window);
      const transition=await js(async()=>{
        window.__motionTransition=null;document.querySelector('.broadcast-toolbar button').click();
        await new Promise(resolve=>setTimeout(resolve,0));const transition=window.__motionTransition;
        if(!transition)return {started:false,animated:false};
        await transition.ready;await new Promise(resolve=>requestAnimationFrame(resolve));
        const animated=document.getAnimations().some(animation=>animation.animationName==='workspace-in'&&animation.playState==='running'&&Number(animation.effect.getComputedTiming().duration)>0);
        await transition.finished;return {started:true,animated};
      });
      assert.deepEqual(transition,{started:true,animated:true},preference+': setup uses an actual animated view transition');
    }
    await tab('룰렛');
    await js(async()=>{for(const [label,value] of [['룰렛 항목 1','첫 번째'],['룰렛 항목 2','두 번째']]){
      const input=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(resolve));
    }document.querySelector('.roulette-form-bottom .primary').click();});
    await waitFor(()=>js(()=>!!document.querySelector('.roulette-spin')),'ordinary roulette stage');await settleUI(window);
    for(const preference of ['reduce','no-preference']){
      await web.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:preference}]});
      await js(()=>document.querySelector('.roulette-spin').click());
      await waitFor(()=>js(()=>document.querySelector('.roulette-disc').getAnimations().some(animation=>animation.playState==='running'&&animation.currentTime>20)),preference+': ordinary wheel rotates');
      assert.equal(await js(()=>document.querySelector('.roulette-outcome').dataset.winnerIndex),'','winner stays hidden during rotation');
      await waitFor(()=>js(()=>!!document.querySelector('.roulette-outcome').dataset.winnerIndex&&!document.querySelector('.roulette-spin').disabled),preference+': ordinary wheel reaches winner',8000);
    }
    clearTimeout(timeout);console.log('PASS: Windows motion ON/OFF preserves CSS effects, character/chat animations, AI/TTS indicators, card/header transitions, real vote counter/bar interpolation, native view transitions and ordinary roulette spins');app.quit();
  }catch(error){console.error(error.stack||error);clearTimeout(timeout);app.exit(1);}
}));
require('../electron/main.cjs');
