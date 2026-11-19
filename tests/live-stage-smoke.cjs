// Actual React/preload/actions/engine with an isolated profile. Account labels are
// renderer-only fixtures; no real login, network subscription or paid event occurs.
const {app,clipboard}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {waitFor,settleUI,assertLayout}=require('./layout-check.cjs');
app.setPath('userData',process.env.STREAMER_ASSIST_TEST_PROFILE||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'assist-live-stage-')));
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
process.env.STREAMER_ASSIST_SHORTCUT='CommandOrControl+Alt+Shift+F18';
let engine, disconnected=false;
let copiedGuide;
clipboard.writeText=text=>{copiedGuide=text;};
const platforms=require('../electron/platforms.cjs'),Original=platforms.Platforms;
platforms.Platforms=class extends Original{constructor(...args){super(...args);engine=this.engine;}};
const timeout=setTimeout(()=>{console.error('Live stage smoke timed out');app.exit(1);},110000);
app.once('browser-window-created',(_,window)=>{
  const web=window.webContents,send=web.send.bind(web);
  web.send=(channel,...args)=>{
    if(channel==='assist:state')args[0]={...args[0],auth:{...args[0].auth,accounts:{
      chzzk:{configured:true,connected:true,name:'별빛 방송',channelId:'fixture'},
      youtube:{configured:true,connected:!disconnected,name:'별빛 YouTube'},twitch:{configured:true,connected:true,name:'별빛 Twitch'}
    }},connections:{chzzk:'연결됨',youtube:disconnected?'미연결':'연결됨',twitch:'연결됨'},livePlatforms:{chzzk:true,youtube:!disconnected,twitch:true}};
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
      await tab('시청자 추첨');await waitFor(()=>js(()=>!!document.querySelector('.raffle-stage')),'raffle stage');
      const entryText=()=>js(()=>document.querySelector('.raffle-stage .stage-participation-text')?.textContent);
      await click('[aria-label="모집 종료"]');
      assert.equal(await entryText(),undefined,'closed roster states the phase once and removes entry instructions');
      assert.equal(await js(()=>document.querySelector('.raffle-stage .stage-status').textContent),'모집 종료');
      assert.match(await js(()=>document.querySelector('.raffle-roster-empty').innerText),/등록된 참여자가 없습니다/);
      await call('raffle-copy');assert.ok(copiedGuide.endsWith('참여자 없이 모집을 종료했습니다.'));
      await click('[aria-label="모집 재개"]');
      engine.audience.ingest(message('member','hi',{subscriber:true}),now);engine.audience.ingest(message('other','hi'),now);
      await call('state');
      assert.match(await js(()=>document.querySelector('.stage-participation').innerText),/채팅을 남기면/);
      assert.ok(await js(()=>[...document.querySelectorAll('.raffle-primary-controls button')].some(b=>b.textContent.includes('모집 종료'))));
      assert.equal(await js(()=>document.querySelector('[aria-label="모집 설정"]')),null,'live controls need no settings modal');
      await click('.raffle-title-edit');
      await js(()=>document.querySelector('.raffle-inline-title').focus());
      await input('.raffle-inline-title','수정된 시청자 추첨');await js(()=>document.querySelector('.raffle-inline-title').blur());
      await waitFor(()=>engine.audience.raffle.title==='수정된 시청자 추첨','inline title saved before editing further rules');
      await click('.raffle-entry-toggles button:last-child');
      assert.equal(await js(()=>document.querySelector('.raffle-keyword-control > span')?.textContent),'참여 키워드','keyword mode visibly labels the editable keyword');
      assert.equal(await js(()=>document.querySelector('[aria-label="실시간 참여 키워드"]').value),'!참여','keyword mode shows the current keyword');
      assert.equal(await js(()=>document.activeElement?.getAttribute('aria-label')),'실시간 참여 키워드','keyword toggle focuses the editor');
      await js(()=>document.querySelector('[aria-label="실시간 참여 키워드"]').focus());await input('[aria-label="실시간 참여 키워드"]','!새참여');
      const filterPoint=await js(()=>{const r=document.querySelector('[aria-label="구독자·멤버십만 참여"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
      await web.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',...filterPoint,button:'left',clickCount:1});
      await web.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',...filterPoint,button:'left',clickCount:1});await settleUI(window);
      assert.equal(engine.audience.raffle.config.keyword,'!새참여','blur commits keyword');assert.equal(engine.audience.raffle.config.subscribersOnly,true,'the same click also toggles the filter');
      await click('.raffle-entry-toggles button:first-child');
      assert.equal(await js(()=>!!document.querySelector('.raffle-keyword-control')),false,'any-chat mode hides keyword editing');
      await click('.raffle-entry-toggles button:last-child');
      assert.equal(await js(()=>document.querySelector('[aria-label="실시간 참여 키워드"]').value),'!새참여','switching modes retains the saved keyword');
      await input('[aria-label="실시간 참여 키워드"]','!새참여2');
      await js(()=>document.querySelector('[aria-label="실시간 참여 키워드"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));await settleUI(window);
      assert.equal(engine.audience.raffle.config.keyword,'!새참여','Enter during Korean text composition does not prematurely commit the keyword');
      await js(()=>document.querySelector('[aria-label="실시간 참여 키워드"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));await settleUI(window);
      assert.equal(engine.audience.raffle.config.keyword,'!새참여2','Enter applies edits without opening another screen');
      const originalEnd=engine.audience.raffle.endsAt;
      await waitFor(()=>js(()=>!document.querySelector('.raffle-timer-trigger').disabled),'keyword edit finishes before timer interaction');
      const moveMouse=point=>web.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await js(()=>window.assist.workspace('hide-topbar',{enabled:true}));
      await moveMouse({x:10,y:300});
      await waitFor(()=>js(()=>document.querySelector('.workspace-layout').dataset.topbarVisible==='false'),'hidden topbar before timer interaction');
      await settleUI(window);
      const hover=await js(()=>{const r=document.querySelector('.raffle-timer-trigger').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};});
      const clockRight=await js(()=>document.querySelector('.raffle-timer-trigger').getBoundingClientRect().right);
      await moveMouse(hover);
      await waitFor(()=>js(()=>document.querySelector('.raffle-timer-control').classList.contains('expanded')),'timer expands on hover');
      await settleUI(window);
      assert.ok(Math.abs(await js(()=>document.querySelector('.raffle-timer-trigger').getBoundingClientRect().right)-clockRight)<1,'expansion keeps the clock anchored at the right');
      assert.ok(await js(()=>parseFloat(getComputedStyle(document.querySelector('.raffle-timer-expansion')).transitionDuration)>0),'hover expansion has a smooth transition');
      assert.equal(engine.audience.raffle.endsAt,originalEnd,'hover never applies a countdown');
      await moveMouse({x:10,y:300});
      await waitFor(()=>js(()=>!document.querySelector('.raffle-timer-control').classList.contains('expanded')),'leaving untouched timer collapses it');
      await web.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',...hover,button:'left',clickCount:1});
      await web.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',...hover,button:'left',clickCount:1});await settleUI(window);
      assert.equal(await js(()=>document.activeElement?.classList.contains('raffle-timer-trigger')),true,'mouse click focuses the clock');
      assert.equal(await js(()=>document.querySelector('.workspace-layout').dataset.topbarVisible),'false','clock interaction keeps the hidden title bar out of the way');
      await moveMouse({x:10,y:300});
      await waitFor(()=>js(()=>!document.querySelector('.raffle-timer-control').classList.contains('expanded')),'leaving an untouched mouse-focused clock also collapses the editor');
      assert.equal(engine.audience.raffle.endsAt,originalEnd,'mouse focus alone never applies a timer');
      await click('.raffle-timer-trigger');await input('[aria-label="모집 타이머 슬라이더"]','500');
      assert.equal(await js(()=>document.querySelector('[aria-label="모집 타이머 초"]').value),'294','slider updates the numeric draft');
      assert.equal(engine.audience.raffle.endsAt,originalEnd,'slider changes are not applied before confirmation');
      await js(()=>document.querySelector('.raffle-timer-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await settleUI(window);
      assert.equal(engine.audience.raffle.endsAt,originalEnd,'Escape discards timer edits');
      await moveMouse(hover);
      await waitFor(()=>js(()=>document.querySelector('.raffle-timer-control').classList.contains('expanded')),'hover reopens after keyboard dismissal');await settleUI(window);
      await moveMouse({x:10,y:300});
      await waitFor(()=>js(()=>!document.querySelector('.raffle-timer-control').classList.contains('expanded')),'leaving untouched hover after Escape closes it again');
      await click('.raffle-timer-trigger');await input('[aria-label="모집 타이머 초"]','65');
      await js(()=>document.querySelector('.raffle-timer-trigger').focus());
      web.sendInputEvent({type:'keyDown',keyCode:'Tab'});web.sendInputEvent({type:'keyUp',keyCode:'Tab'});await settleUI(window);
      assert.equal(await js(()=>document.activeElement?.getAttribute('aria-label')),'모집 타이머 슬라이더','keyboard flows from clock to expanded controls');
      assert.equal(engine.audience.raffle.endsAt,originalEnd,'editing never applies before confirmation');
      await click('.raffle-timer-panel button[type="submit"]');
      assert.equal(await js(()=>document.querySelector('.raffle-timer-trigger .live-stage-timer > span').textContent),'남은 시간','confirmation switches the clock to a countdown immediately');
      assert.equal(engine.audience.raffle.title,'수정된 시청자 추첨');assert.equal(engine.audience.candidates.size,2);
      assert.equal(engine.audience.snapshot().raffle.eligibleCount,1);assert.equal(engine.audience.raffle.openedAt,now-61000);
      assert.ok(Math.abs(engine.audience.raffle.endsAt-Date.now()-65000)<3000);
      assert.match(await js(()=>document.querySelector('.stage-participation').innerText),/!새참여/);
      for(const name of ['치지직','YouTube'])await click('[aria-label="'+name+' 추첨 대상"]');
      assert.deepEqual(engine.audience.raffle.config.platforms,[]);assert.equal(engine.audience.snapshot().raffle.eligibleCount,0);
      assert.equal(await entryText(),'선택한 플랫폼 없음');
      await call('raffle-copy');assert.ok(copiedGuide.endsWith(await entryText()));
      assert.equal(await js(()=>!!document.querySelector('.stage-hint,.live-options-dialog')),false,'all platforms off needs no warning');
      disconnected=true;await call('state');await click('[aria-label="YouTube 추첨 대상"]');
      assert.deepEqual(engine.audience.raffle.config.platforms,['youtube'],'disconnected platform is still a valid eligibility filter');
      assert.match(await entryText(),/채팅 연결을 기다리고/);
      await click('[aria-label="치지직 추첨 대상"]');disconnected=false;await call('state');
      assert.match(await entryText(),/!새참여/);
      await js(()=>window.assist.workspace('hide-topbar',{enabled:false}));await settleUI(window);
      await click('.broadcast-profile-trigger');await click('.broadcast-profile-menu button[role="menuitemradio"]:nth-of-type(2)');
      await waitFor(()=>js(()=>document.querySelector('.broadcast-profile-trigger').innerText.includes('별빛 YouTube')),'selected representative');
      assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'preferences.json'),'utf8')).broadcastProfile,'youtube');
      disconnected=true;await call('state');await waitFor(()=>js(()=>document.querySelector('.broadcast-profile-trigger').innerText.includes('별빛 방송')),'disconnected representative fallback');
      disconnected=false;await call('state');await waitFor(()=>js(()=>document.querySelector('.broadcast-profile-trigger').innerText.includes('별빛 YouTube')),'saved representative restored');
      await js(()=>[...document.querySelectorAll('.raffle-primary-controls button')].find(b=>b.textContent.includes('모집 종료')).click());
      await waitFor(()=>!engine.audience.raffle.active,'recruitment stopped');await settleUI(window);
      const frozen=await js(()=>document.querySelector('.raffle-stage .live-stage-timer > time').textContent);
      await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(await js(()=>document.querySelector('.raffle-stage .live-stage-timer > time').textContent),frozen);
      await click('.raffle-timer-trigger');await input('[aria-label="모집 타이머 초"]','1');await click('.raffle-timer-panel button[type="submit"]');
      await waitFor(()=>engine.audience.raffle.active,'confirming a timer on a closed roster resumes recruitment');
      await waitFor(()=>!engine.audience.raffle.active,'countdown expiry stops recruitment',4000);
      assert.equal(engine.audience.raffle.closedAt,engine.audience.raffle.endsAt,'recruitment closes at the confirmed deadline');
      assert.equal(engine.audience.candidates.size,2,'countdown preserves the existing roster');

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
      assert.match(await js(()=>document.querySelector('.donation-page .stage-participation').innerText),/2,000원/);

      for(const theme of ['dark','light']) {
        if(await js(()=>document.documentElement.dataset.theme)!==theme)await click('.theme-toggle');
        window.setContentSize(900,650);await call('text-scale-set',{scale:150});
        for(const name of ['도네 투표','숫자 투표','시청자 추첨']) {
          await tab(name);await assertLayout(window,name+' live stage '+theme+' at minimum size 150%');
          if(name==='시청자 추첨') {
            await click('.raffle-timer-trigger');await settleUI(window);await assertLayout(window,'inline raffle timer '+theme+' at 150%');
            assert.ok(await js(()=>{const r=document.querySelector('.raffle-timer-panel button[type="submit"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),'timer confirmation stays reachable');
            if(process.env.STREAMER_ASSIST_TEST_SCREENSHOTS!=='0')fs.writeFileSync(path.join(__dirname,'../release/raffle-inline-'+theme+'.png'),(await web.capturePage()).toPNG());
            await js(()=>document.querySelector('.raffle-timer-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await settleUI(window);
            continue;
          }
          const selector=name==='도네 투표'?'.donation-page .broadcast-toolbar button':'.broadcast-toolbar button';
          // Reopen a live raffle so the same modal is exercised on all tools.
          if(name==='시청자 추첨'){engine.audience.raffle.active=true;engine.audience.raffle.endsAt=Date.now()+60000;engine.audience.changed();await call('state');}
          if(name==='숫자 투표'){engine.poll.active=true;engine.poll.endsAt=Date.now()+60000;engine.revision++;await call('state');}
          await openSettings(selector);await timerGeometry();await assertLayout(window,name+' live settings '+theme+' at 150%');
          assert.ok(await js(()=>{const el=document.querySelector('.live-options-dialog footer button[type="submit"]'),r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'apply stays reachable');
          await closeSettings();
        }
      }
      if(process.env.STREAMER_ASSIST_TEST_SCREENSHOTS!=='0') {
        window.setContentSize(1280,850);await call('text-scale-set',{scale:100});
        if(await js(()=>document.documentElement.dataset.theme)!=='dark')await click('.theme-toggle');
        await tab('시청자 추첨');
        const id=engine.audience.raffle.id;
        await call('raffle-configure',{id,changes:{entryMode:'any',title:'오늘 함께할 시청자',subscribersOnly:false,excludeWinners:true,platforms:['chzzk','youtube','twitch'],timerSeconds:null}});
        await call('raffle-resume',{id});
        for(const [index,name]of ['별빛','햇살다람쥐','초록고양이','구름산책','포근한오후','반짝이는별','달빛여우','푸른바다','작은도토리','오후의산책','밤하늘고래','행복한수달','고요한숲','반가운바람','하늘다람쥐','노란우산'].entries())engine.audience.ingest({platform:['chzzk','youtube','twitch'][index%3],userId:'preview-'+index,name,text:'참여',subscriber:index%2===0});
        await call('chat-speech-set',{enabled:true});await call('state');await js(()=>document.activeElement?.blur());web.sendInputEvent({type:'mouseMove',x:5,y:500});await settleUI(window);await assertLayout(window,'saved speaker and inline controls preview');
        fs.writeFileSync(path.join(__dirname,'../release/raffle-controls-preview.png'),(await web.capturePage()).toPNG());
        await click('.raffle-timer-trigger');await settleUI(window);await assertLayout(window,'expanded timer preview');
        fs.writeFileSync(path.join(__dirname,'../release/raffle-timer-preview.png'),(await web.capturePage()).toPNG());
        await js(()=>document.querySelector('.raffle-timer-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
        await call('raffle-configure',{id,changes:{entryMode:'keyword',keyword:'!함께해요'}});await settleUI(window);await assertLayout(window,'editable participation keyword preview');
        const keywordBounds=await js(()=>{const r=document.querySelector('.raffle-rule-toggles').getBoundingClientRect();return{x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};});
        fs.writeFileSync(path.join(__dirname,'../release/raffle-keyword-preview.png'),(await web.capturePage(keywordBounds)).toPNG());
        await call('raffle-stop');await waitFor(()=>js(()=>!!document.querySelector('.raffle-reset')),'closed raffle controls');
        await settleUI(window);await assertLayout(window,'closed raffle with reset action');
        fs.writeFileSync(path.join(__dirname,'../release/raffle-reset-preview.png'),(await web.capturePage()).toPNG());
      }
      console.log('PASS: live raffle/poll/donation editing through IPC, retained ballots, future rules, native locks, stale edits, clocks, saved representative/fallback, both themes and minimum size at 150%');
      clearTimeout(timeout);app.quit();
    } catch(error){console.error(error.stack||error);console.error(await js(()=>{const el=document.querySelector('.raffle-timer-control'),p=el?.querySelector('.raffle-timer-expansion');return{timerOpen:el?.classList.contains('expanded'),inert:p?.inert,timerBounds:el?.getBoundingClientRect().toJSON(),panelBounds:p?.getBoundingClientRect().toJSON(),focused:document.activeElement?.className};}));clearTimeout(timeout);app.exit(1);}
  });
});
require('../electron/main.cjs');
