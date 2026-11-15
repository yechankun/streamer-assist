// Actual React/preload/actions/engine with an isolated profile. Account labels are
// renderer-only fixtures; no real login, network subscription or paid event occurs.
const {app}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {waitFor,settleUI,assertLayout}=require('./layout-check.cjs');
app.setPath('userData',process.env.STREAMER_ASSIST_TEST_PROFILE||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'assist-live-stage-')));
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
process.env.STREAMER_ASSIST_SHORTCUT='CommandOrControl+Alt+Shift+F18';
let engine, disconnected=false;
const platforms=require('../electron/platforms.cjs'),Original=platforms.Platforms;
platforms.Platforms=class extends Original{constructor(...args){super(...args);engine=this.engine;}};
const timeout=setTimeout(()=>{console.error('Live stage smoke timed out');app.exit(1);},110000);
app.once('browser-window-created',(_,window)=>{
  const web=window.webContents,send=web.send.bind(web);
  web.send=(channel,...args)=>{
    if(channel==='assist:state')args[0]={...args[0],auth:{...args[0].auth,accounts:{
      chzzk:{configured:true,connected:true,name:'별빛 방송',channelId:'fixture'},
      youtube:{configured:true,connected:!disconnected,name:'별빛 YouTube'},twitch:{configured:true,connected:true,name:'별빛 Twitch'}
    }},connections:{chzzk:'연결됨',youtube:'연결됨',twitch:'연결됨'},livePlatforms:{chzzk:true,youtube:!disconnected,twitch:true}};
    return send(channel,...args);
  };
  web.once('did-finish-load',async()=>{
    const js=(fn,...args)=>web.executeJavaScript(`(${fn})(${args.map(value=>JSON.stringify(value)).join(',')})`);
    const call=async(a,p={})=>{const r=await js((a,p)=>window.assist.call(a,p),a,p);assert.ok(r.ok,r.error);return r;};
    const click=async selector=>{await js(selector=>{const el=document.querySelector(selector);if(!el)throw Error('Missing '+selector);el.click();},selector);await settleUI(window);};
    const input=async(selector,value)=>{
      await js((selector,value)=>{const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));},selector,value);await settleUI(window);
    };
    const tab=async name=>{await call('state');await js(name=>[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes(name)).click(),name);await settleUI(window);};
    const openSettings=async selector=>{await click(selector);await waitFor(()=>js(()=>!!document.querySelector('.live-options-dialog[open]')),'live settings dialog');};
    const closeSettings=()=>click('[aria-label="실시간 설정 닫기"]');
    const apply=async()=>{await click('.live-options-dialog button[type="submit"]');await waitFor(()=>js(()=>!document.querySelector('.live-options-dialog[open]')),'applied live settings');};
    const timerGeometry=async()=>{
      const fields=await js(()=>[...document.querySelectorAll('.live-options-dialog .poll-timer-field input')].map(el=>({width:el.getBoundingClientRect().width,value:el.value})));
      assert.equal(fields.length,2);assert.ok(fields.every(f=>f.width>70&&f.value!==''),JSON.stringify(fields));
    };
    const message=(id,text,extra={})=>({platform:'chzzk',id,userId:id,name:id,text,...extra});
    try {
      window.setContentSize(1280,850);web.debugger.attach('1.3');
      await web.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await call('start',{title:'진행 화면 테스트'});
      const now=Date.now();
      engine.audience.startRaffle({title:'테스트 추첨',entryMode:'any',keyword:'!참여',subscribersOnly:false,excludeWinners:true,platforms:['chzzk','youtube'],timerSeconds:600},now-61000);
      engine.audience.ingest(message('member','hi',{subscriber:true}),now);engine.audience.ingest(message('other','hi'),now);
      await tab('시청자 추첨');await waitFor(()=>js(()=>!!document.querySelector('.raffle-stage')),'raffle stage');
      assert.match(await js(()=>document.querySelector('.stage-participation').innerText),/채팅을 남기면/);
      assert.ok(await js(()=>[...document.querySelectorAll('.raffle-primary-controls button')].some(b=>b.textContent.includes('모집 종료'))));
      await openSettings('[aria-label="모집 설정"]');await timerGeometry();
      await input('[aria-label="진행 중 제목"]','수정된 시청자 추첨');
      await js(()=>[...document.querySelectorAll('.live-options-dialog .segmented-buttons button')].find(b=>b.textContent==='참여 키워드').click());await settleUI(window);
      await input('[aria-label="진행 중 참여 키워드"]','!새참여');
      await js(()=>[...document.querySelectorAll('.live-checks label')].find(el=>el.textContent.includes('구독자')).querySelector('input').click());
      await input('[aria-label="자동 종료 분"]','1');await input('[aria-label="자동 종료 초"]','5');await apply();
      assert.equal(engine.audience.raffle.title,'수정된 시청자 추첨');assert.equal(engine.audience.candidates.size,2);
      assert.equal(engine.audience.snapshot().raffle.eligibleCount,1);assert.equal(engine.audience.raffle.openedAt,now-61000);
      assert.ok(Math.abs(engine.audience.raffle.endsAt-Date.now()-65000)<3000);
      assert.match(await js(()=>document.querySelector('.stage-participation').innerText),/!새참여/);
      await openSettings('[aria-label="모집 설정"]');
      const r=engine.audience.raffle;
      engine.audience.updateRaffle({id:r.id,revision:r.settingsRevision,title:'다른 창에서 수정',...r.config,timerSeconds:null});await call('state');
      await waitFor(()=>js(()=>document.querySelector('.live-options-dialog button[type="submit"]').disabled),'stale edits disabled');
      assert.match(await js(()=>document.querySelector('.live-options-dialog footer').innerText),/다른 창/);await closeSettings();
      await click('.broadcast-profile-trigger');await click('.broadcast-profile-menu button[role="menuitemradio"]:nth-of-type(2)');
      await waitFor(()=>js(()=>document.querySelector('.broadcast-profile-trigger').innerText.includes('별빛 YouTube')),'selected representative');
      assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'preferences.json'),'utf8')).broadcastProfile,'youtube');
      disconnected=true;await call('state');await waitFor(()=>js(()=>document.querySelector('.broadcast-profile-trigger').innerText.includes('별빛 방송')),'disconnected representative fallback');
      disconnected=false;await call('state');await waitFor(()=>js(()=>document.querySelector('.broadcast-profile-trigger').innerText.includes('별빛 YouTube')),'saved representative restored');
      await js(()=>[...document.querySelectorAll('.raffle-primary-controls button')].find(b=>b.textContent.includes('모집 종료')).click());
      await waitFor(()=>!engine.audience.raffle.active,'recruitment stopped');await settleUI(window);
      const frozen=await js(()=>document.querySelector('.raffle-stage .live-stage-timer > time').textContent);
      await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(await js(()=>document.querySelector('.raffle-stage .live-stage-timer > time').textContent),frozen);

      engine.createPoll('원래 질문',['A','B','빈 항목'],'chat',['chzzk','youtube'],'!투표',600);
      engine.ingest(message('vote-one','!투표1'));engine.ingest(message('vote-two','!투표2'));
      await tab('숫자 투표');await openSettings('.broadcast-toolbar button');
      assert.equal(await js(()=>document.querySelector('[aria-label="진행 중 선택지 1 삭제"]').disabled),true);
      await input('[aria-label="진행 중 제목"]','수정된 질문');await input('[aria-label="진행 중 선택지 1"]','수정 A');
      await click('[aria-label="진행 중 선택지 3 삭제"]');await click('.live-add-choice');await input('[aria-label="진행 중 선택지 3"]','새 항목');
      await input('[aria-label="진행 중 투표 접두어"]','!골라');const pollEnd=engine.poll.endsAt;await apply();
      assert.equal(engine.poll.question,'수정된 질문');assert.deepEqual(engine.poll.options,['수정 A','B','새 항목']);assert.deepEqual(engine.poll.counts,[1,1,0]);assert.equal(engine.poll.endsAt,pollEnd);
      engine.ingest(message('vote-one','!골라3',{id:'vote-one-updated'}));assert.deepEqual(engine.poll.counts,[0,1,1]);await call('state');
      assert.match(await js(()=>document.querySelector('.broadcast-poll .stage-participation').innerText),/!골라/);
      await call('poll-stop');
      engine.createPoll('기본 투표',['A','B'],'native',['chzzk','youtube'],'!투표',600);engine.poll.youtubeId='fixture-native';engine.revision++;
      await call('state');await openSettings('.broadcast-toolbar button');
      assert.equal(await js(()=>document.querySelector('[aria-label="진행 중 제목"]').disabled),true);
      assert.equal(await js(()=>document.querySelector('[aria-label="진행 중 선택지 1"]').disabled),true);
      assert.equal(await js(()=>document.querySelector('[aria-label="자동 종료 분"]').disabled),false);await closeSettings();
      // Do not dispatch the native-stop API: this local fixture has no YouTube account.
      engine.endPoll();engine.poll.youtubeId=null;engine.revision++;

      engine.audience.startDonation({question:'벌칙',options:['노래','댄스','게임','요리'],platforms:['chzzk','youtube'],chatPrefix:'!도네',currency:'KRW',minimumMicros:1e9,plural:true,timerSeconds:600});
      engine.audience.ingest(message('paid','!도네1',{kind:'donation',currency:'KRW',amountMicros:3e9}));
      await tab('도네 투표');await openSettings('.donation-page .broadcast-toolbar button');await timerGeometry();
      await input('[aria-label="진행 중 제목"]','수정한 벌칙');await input('[aria-label="진행 중 도네 금액"]','2000');await apply();
      assert.equal(engine.audience.donationPoll.donation.minimumMicros,2e9);assert.deepEqual(engine.audience.donationPoll.counts,[3,0,0,0]);
      assert.match(await js(()=>document.querySelector('.donation-page .stage-participation').innerText),/2,000 KRW/);

      for(const theme of ['dark','light']) {
        if(await js(()=>document.documentElement.dataset.theme)!==theme)await click('.theme-toggle');
        window.setContentSize(900,650);await call('text-scale-set',{scale:150});
        for(const name of ['도네 투표','숫자 투표','시청자 추첨']) {
          await tab(name);await assertLayout(window,name+' live stage '+theme+' at minimum size 150%');
          const selector=name==='시청자 추첨'?'[aria-label="모집 설정"]':name==='도네 투표'?'.donation-page .broadcast-toolbar button':'.broadcast-toolbar button';
          // Reopen a live raffle so the same modal is exercised on all tools.
          if(name==='시청자 추첨'){engine.audience.raffle.active=true;engine.audience.raffle.endsAt=Date.now()+60000;engine.audience.changed();await call('state');}
          if(name==='숫자 투표'){engine.poll.active=true;engine.poll.endsAt=Date.now()+60000;engine.revision++;await call('state');}
          await openSettings(selector);await timerGeometry();await assertLayout(window,name+' live settings '+theme+' at 150%');
          assert.ok(await js(()=>{const el=document.querySelector('.live-options-dialog footer button[type="submit"]'),r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'apply stays reachable');
          await closeSettings();
        }
      }
      console.log('PASS: live raffle/poll/donation editing through IPC, retained ballots, future rules, native locks, stale edits, clocks, saved representative/fallback, both themes and minimum size at 150%');
      clearTimeout(timeout);app.quit();
    } catch(error){console.error(error.stack||error);clearTimeout(timeout);app.exit(1);}
  });
});
require('../electron/main.cjs');
