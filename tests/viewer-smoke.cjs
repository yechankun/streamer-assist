const { app } = require("electron");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { waitFor, assertLayout, settleUI } = require("./layout-check.cjs");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.setPath("userData", process.env.STREAMER_ASSIST_TEST_PROFILE || path.join(__dirname, "../release/viewer-test-profile"));
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F16";
const platformModule = require("../electron/platforms.cjs"), OriginalPlatforms = platformModule.Platforms;
let engine, speech, primary;
platformModule.Platforms = class extends OriginalPlatforms { constructor(...args) { super(...args); engine = this.engine; } };
const speechModule = require("../electron/local-speech.cjs"), OriginalSpeech = speechModule.LocalSpeech;
const spoken = [];
// Exercise the real speech owner/queue and IPC without playing audio on CI.
speechModule.LocalSpeech = class extends OriginalSpeech {
  constructor(...args) { super(...args); speech = this; }
  worker() {
    this.child ||= { stdin: { writable: true, write: line => { const row = JSON.parse(line); if (row.action === "speak") spoken.push(row.text); }, end() {} }, kill() {} };
    return Promise.resolve({ voice: "Microsoft Heami Desktop", voices: [{ name: "Microsoft Heami Desktop", lang: "ko-KR" }, { name: "English test voice", lang: "en-US" }] });
  }
};
const deadline = setTimeout(() => { console.error("Viewer smoke timed out"); app.exit(1); }, 65000);
app.on("browser-window-created", (_event, win) => {
  if (primary) return; primary = win;
  win.webContents.once("did-finish-load", async () => {
    const js = (fn, ...args) => win.webContents.executeJavaScript("(" + fn.toString() + ")(..." + JSON.stringify(args) + ")");
    const call = async (action, payload) => { const reply = await js((a, p) => window.assist.call(a, p), action, payload); assert.ok(reply.ok, reply.error); return reply.data; };
    const click = async selector => { await js(s => document.querySelector(s).click(), selector); await settleUI(win); };
    const state = () => call("state");
    const assertNameFlow = async label => {
      const problems=await js(()=>{
        const area=document.querySelector('.raffle-roster-area').getBoundingClientRect(),items=[...document.querySelectorAll('.raffle-participants li')];
        const problems=[];let previous;
        for(const item of items){
          const bounds=item.getBoundingClientRect(),name=item.querySelector('.participant-display-name');
          if(bounds.right>area.right+1||bounds.bottom>area.bottom+1)problems.push('name outside roster');
          if(getComputedStyle(name).whiteSpace!=='nowrap')problems.push('nickname can split across lines');
          if(previous&&Math.abs(bounds.top-previous.top)<1&&Math.abs(bounds.left-previous.right-16)>1)problems.push('names do not flow together');
          if(previous&&bounds.top>previous.top+1&&previous.right+16+bounds.width<=area.right-1)problems.push('line wraps before it is full');
          previous=bounds;
        }
        return problems;
      });
      assert.deepEqual(problems,[],label);
    };
    const ingest = (platform, userId, id, text) => engine.ingest({ platform, userId, id, text, name: "같은 닉네임", timestamp: Date.now() });
    try {
      win.webContents.setBackgroundThrottling(false);
      await waitFor(() => js(() => document.querySelector('[data-workspace-ready="true"]')), "workspace ready");
      await click(".fullscreen-toggle"); await waitFor(() => win.isFullScreen(), "fullscreen button");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "F11" }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: "F11" });
      await waitFor(() => !win.isFullScreen(), "F11 exits fullscreen");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "F11" }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: "F11" });
      await waitFor(() => win.isFullScreen(), "F11 enters fullscreen");
      await js(() => window.assist.windowControl("exit-fullscreen")); await waitFor(() => !win.isFullScreen(), "fullscreen restores window");
      win.setSize(1240, 850);
      // A hidden runner explicitly models a visible chat for TTS interactions.
      await js(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); });
      // Model browser-provided voices and asynchronous playback without using speakers/network.
      await js(() => {
        window.__testSpeech = { voices: [
          { name: "Yuna", voiceURI: "test-yuna", lang: "ko-KR", localService: true },
          { name: "Google 한국의", voiceURI: "test-google", lang: "ko-KR", localService: false },
          { name: "Microsoft Heami - Korean (Korean)", voiceURI: "test-heami", lang: "ko-KR", localService: true },
        ], spoken: [], cancelled: 0 };
        const synth = new EventTarget();
        synth.getVoices = () => window.__testSpeech.voices;
        synth.speak = prompt => { window.__testSpeech.spoken.push(prompt.text); window.__testSpeech.prompt = prompt; };
        synth.cancel = () => { window.__testSpeech.cancelled++; window.__testSpeech.prompt?.onerror?.({ error: "canceled" }); };
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      });
      engine.audience.startRaffle({ title: "오늘 함께할 시청자", platforms: ["chzzk", "youtube", "twitch"], entryMode: "any", keyword: "", subscribersOnly: false, excludeWinners: true, timerSeconds: null }, Date.now() - 1000);
      for (const platform of ["chzzk", "youtube", "twitch"]) ingest(platform, "same-id", "before-" + platform, "이전 채팅");
      await js(() => window.assist.workspace("open", { id: "raffle" })); await state();
      await waitFor(() => js(() => document.querySelectorAll(".raffle-participants li").length === 3), "participants");
      assert.equal(await js(() => parseFloat(getComputedStyle(document.querySelector(".raffle-participants li")).fontSize) >= 17), true);
      for (const platform of ["chzzk", "youtube", "twitch"]) assert.equal(await js(p => !!document.querySelector(".raffle-participants .platform-badge." + p), platform), true);
      if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") { await settleUI(win); fs.writeFileSync(path.join(__dirname, "../release/raffle-feedback-preview.png"), (await win.webContents.capturePage()).toPNG()); }
      await js(() => document.querySelector(".raffle-participants .platform-badge.chzzk").closest("button").click()); await state();
      await waitFor(() => js(() => document.querySelector(".viewer-chat-dialog")?.open), "selected viewer chat");
      assert.equal(await js(() => document.querySelector(".viewer-chat-dialog .winner-chat-before p").textContent), "이전 채팅");
      await click(".viewer-chat-dialog .chat-speech-toggle");
      await waitFor(() => js(() => document.querySelector(".viewer-chat-dialog .chat-speech-toggle")?.getAttribute("aria-pressed") === "true"), "TTS enabled");
      assert.equal(spoken.length, 0, "enabling TTS never reads old chat");
      ingest("youtube", "same-id", "wrong-platform", "다른 플랫폼"); ingest("chzzk", "other-id", "wrong-viewer", "다른 계정");
      ingest("chzzk", "same-id", "right-viewer", "선택한 시청자의 새 채팅"); await state();
      await waitFor(() => spoken.length === 1, "only selected viewer spoken"); assert.equal(spoken[0], "선택한 시청자의 새 채팅");
      assert.equal(await js(() => document.querySelector(".viewer-chat-dialog").textContent.includes("다른 계정")), false);
      await click(".viewer-chat-dialog .chat-speech-toggle"); assert.equal(speech.owner, null); assert.equal(speech.queue.length, 0);
      ingest("chzzk", "same-id", "muted", "음소거 후 채팅"); await state(); await settleUI(win); assert.equal(spoken.length, 1);
      await js(() => window.assist.speech('select', { channel:'test', choice:{ backend:'native',voice:'Microsoft Heami Desktop',lang:'ko-KR',local:true } }));
      await click(".viewer-chat-dialog .chat-voice-settings");
      await waitFor(() => js(() => document.querySelector('.speech-voice-dialog')?.dataset.loading === 'false'), "voice inventory");
      assert.equal(await js(() => [...document.querySelectorAll('.speech-voice-card strong')].filter(node => node.textContent === 'Heami').length), 1, 'Windows/browser duplicates share one card');
      assert.equal(await js(() => JSON.parse(document.querySelector('.speech-voice-pick input:checked').value)[0]), 'native', 'the saved playback route stays selected after merging');
      assert.equal(await js(() => document.querySelector('.speech-voice-filters button:first-child span').textContent), '3', 'counts exclude duplicates');
      await click('.speech-voice-dialog .primary');
      assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')).speechVoice.backend, 'native', 'applying an unchanged merged voice preserves the saved route');
      await click(".viewer-chat-dialog .chat-voice-settings");
      await waitFor(() => js(() => document.querySelector('.speech-voice-dialog')?.dataset.loading === 'false'), "merged voice inventory");
      assert.equal(await js(() => document.querySelector('.speech-voice-dialog select')), null, "voice picker uses cards");
      assert.equal(await js(() => [...document.querySelectorAll('.speech-voice-pick input')].some(input => input.getAttribute('aria-label').includes("Yuna"))), true);
      assert.equal(await js(() => [...document.querySelectorAll('.speech-voice-card')].some(card => card.dataset.language === 'en-US')), false, "Korean-first filter");
      const chooseVoice = async name => js(name => {
        [...document.querySelectorAll('.speech-voice-pick input')].find(input => input.getAttribute('aria-label').includes(name)).click();
      }, name);
      await js(() => document.querySelector('.speech-voice-pick input').focus());
      win.webContents.sendInputEvent({ type:'keyDown', keyCode:'Right' }); win.webContents.sendInputEvent({ type:'keyUp', keyCode:'Right' });
      await settleUI(win);
      assert.notEqual(await js(() => document.querySelector('.speech-voice-pick input:checked').value), '', "arrow keys select a card");
      await click('.speech-voice-filters button:last-child');
      assert.equal(await js(() => [...document.querySelectorAll('.speech-voice-card')].some(card => card.dataset.language === 'en-US')), true);
      const searchVoice = async value => js(value => {
        const input=document.querySelector('[aria-label="목소리 검색"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }, value);
      await searchVoice('없는 목소리'); await settleUI(win);
      assert.equal(await js(() => document.querySelector('.speech-voice-empty strong')?.textContent), '검색 결과가 없어요');
      await searchVoice('yuna'); await settleUI(win);
      assert.equal(await js(() => document.querySelectorAll('.speech-voice-card').length), 1, "search matches names without case sensitivity");
      await searchVoice('ko-KR'); await settleUI(win);
      assert.equal(await js(() => document.querySelectorAll('.speech-voice-card').length), 3, "search matches language codes");
      await searchVoice(''); await settleUI(win);
      await chooseVoice("Google 한국의"); await settleUI(win);
      assert.equal(await js(() => document.querySelector('[aria-label="Google 한국의 미리듣기"]').disabled), true, "online voice needs consent before even a preview");
      assert.equal(await js(() => document.querySelector('.speech-voice-dialog .primary').disabled), true);
      await click('.speech-online-notice input');
      assert.equal(await js(() => document.querySelector('[aria-label="Google 한국의 미리듣기"]').disabled), false);
      await click('.speech-online-notice input');
      assert.equal(await js(() => document.querySelector('.speech-voice-dialog .primary').disabled), true, "withdrawing consent disables apply");
      await chooseVoice('자동 선택'); await settleUI(win);
      await click('[aria-label="Yuna 미리듣기"]');
      await waitFor(() => js(() => window.__testSpeech.spoken.length === 1), "Web Speech preview");
      assert.equal(await js(() => document.querySelector('.speech-voice-pick input:checked').getAttribute('aria-label').includes('Yuna')), true, "preview also selects that voice");
      assert.equal(spoken.length, 1, "Web Speech never duplicates native audio");
      assert.equal(await js(() => document.querySelector('[aria-label="Yuna 미리듣기 중지"]').getAttribute('aria-pressed')), 'true');
      await js(() => {
        window.__testSpeech.previousPrompt = window.__testSpeech.prompt;
        window.__testSpeech.voices.push({ name:'Sora',voiceURI:'test-sora',lang:'ko-KR',localService:true });
        window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
      });
      await waitFor(() => js(() => document.querySelector('[aria-label="Sora 미리듣기"]')), 'voice cards update dynamically');
      await click('[aria-label="Sora 미리듣기"]');
      await waitFor(() => js(() => window.__testSpeech.spoken.length === 2), 'preview switches voices');
      assert.ok(await js(() => window.__testSpeech.cancelled > 0));
      await js(() => window.__testSpeech.previousPrompt.onend());
      assert.equal(speech.choice.voice, 'test-sora', 'a late preview completion cannot stop the new voice');
      await click('[aria-label="Sora 미리듣기 중지"]'); assert.equal(speech.owner, null);
      await click('[aria-label="Yuna 미리듣기"]');
      await waitFor(() => js(() => window.__testSpeech.spoken.length === 3), 'preview restarts');
      await js(() => window.__testSpeech.prompt.onend()); await waitFor(() => speech.owner === null, "preview completion stops owner");
      win.setSize(900, 650); await call("text-scale-set", { scale: 150 }); await settleUI(win); await assertLayout(win, "voice settings at 150 percent");
      if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") fs.writeFileSync(path.join(__dirname, "../release/voice-settings-preview.png"), (await win.webContents.capturePage()).toPNG());
      await call("text-scale-set", { scale: 100 }); await settleUI(win);
      await click(".speech-voice-dialog .primary");
      await waitFor(() => js(() => !document.querySelector('.speech-voice-dialog')), "voice setting saved");
      assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')).speechVoice.voice, "test-yuna");
      assert.equal(await js(() => document.querySelector('.viewer-chat-dialog').open), true, "saving voice keeps the viewer open");
      await click(".viewer-chat-dialog .chat-speech-toggle");
      await waitFor(() => js(() => document.querySelector('.viewer-chat-dialog .chat-speech-toggle').getAttribute('aria-pressed') === 'true'), "saved browser voice active");
      ingest("chzzk", "same-id", "web-live", "ブラウザ 음성으로 읽을 새 채팅"); await state();
      await waitFor(() => js(() => window.__testSpeech.spoken.length === 4), "live browser voice");
      await click(".viewer-chat-dialog .chat-speech-toggle"); assert.equal(speech.owner, null);
      assert.ok(await js(() => window.__testSpeech.cancelled > 0));
      // Reset automatic/native selection for the winner path below.
      await js(() => window.assist.speech('select', { channel: 'test', choice: null }));
      for (const [width, height] of [[1240, 850], [900, 650]]) {
        win.setSize(width, height); await settleUI(win); await assertLayout(win, "viewer chat " + width);
      }
      if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") fs.writeFileSync(path.join(__dirname, "../release/viewer-chat-preview.png"), (await win.webContents.capturePage()).toPNG());
      await click('[aria-label="시청자 채팅 닫기"]'); await state();
      assert.equal(engine.viewerChats.snapshot(win.id), null);
      win.setSize(1240, 850);
      const draw = engine.audience.drawRaffle(true);
      // A stable cosmetic seed exercises the corrected ponytail and a palette.
      draw.id = 'character-pony-1'; engine.audience.reel.id = draw.id; engine.audience.winnerChat.drawId = draw.id;
      await state();
      await waitFor(() => js(() => document.querySelector(".raffle-winner-dialog")?.open), "winner dialog");
      assert.equal(await js(() => !!document.querySelector('.winner-character-stage')), false, 'existing winner view is the default');
      await click('.raffle-winner-dialog .winner-character-toggle');
      await waitFor(() => js(() => !!document.querySelector('.winner-character-mode .winner-character-stage')), 'optional character view');
      assert.equal(await js(async () => {
        const layers=[...document.querySelectorAll('.winner-pixel-character image')];
        const sprites=await Promise.all(layers.map(async layer=>{const sprite=new Image();sprite.src=layer.href.baseVal;await sprite.decode();return sprite.naturalWidth===layer.width.baseVal.value&&sprite.naturalHeight===layer.height.baseVal.value;}));
        return sprites.length>0&&sprites.every(Boolean);
      }), true, 'all visible character atlases load at their catalog dimensions');
      assert.equal(await js(() => ['body','hair','top','bottom'].every(part => !!document.querySelector('[data-character-layer="' + part + '"] [data-part-id]'))), true, 'separate body, hair and garment layers are rendered');
      assert.equal(await js(() => {
        const sprite=document.querySelector('.winner-pixel-character');
        const bodies=[...sprite.querySelectorAll('[data-character-layer="body"] image')];
        const tinted=[...sprite.querySelectorAll('image[filter]')];
        return bodies.every(image=>!image.hasAttribute('filter'))&&tinted.length>=4&&tinted.every(image=>{
          const id=image.getAttribute('filter').match(/#([^)]*)/)[1],filter=document.getElementById(id),box=image.parentElement.viewBox.baseVal;
          return filter.getAttribute('filterUnits')==='userSpaceOnUse'&&['x','y','width','height'].every(key=>Number(filter.getAttribute(key))===box[key]);
        });
      }), true, 'skin stays original and each color filter is clipped to its own source part');
      const pony = await js(() => { const part=document.querySelector('[data-character-layer="hair"] [data-part-id="ponytail"]');return {src:[part.viewBox.baseVal.x,part.viewBox.baseVal.y,part.viewBox.baseVal.width,part.viewBox.baseVal.height],dest:['x','y','width','height'].map(key=>Number(part.getAttribute(key)))}; });
      const ponyImage=require('electron').nativeImage.createFromPath(path.join(__dirname,'../src/assets/characters/winner-parts-v3.png'));
      const ponyPixels=ponyImage.toBitmap(),ponyWidth=ponyImage.getSize().width;
      assert.ok([[61,52],[85,50]].some(([x,y])=>{
        const sx=Math.round(pony.src[0]+(x-pony.dest[0])*pony.src[2]/pony.dest[2]),sy=Math.round(pony.src[1]+(y-pony.dest[1])*pony.src[3]/pony.dest[3]);
        return ponyPixels[(sy*ponyWidth+sx)*4+3]<32;
      }), 'the ponytail leaves the eye region open instead of covering the face');
      const outfit = await js(() => document.querySelector('.winner-character-stage').dataset.outfit);
      assert.equal(await js(() => document.querySelector('.raffle-winner-dialog .winner-character-toggle').textContent), '', 'toggle is an icon without a visible label');
      assert.ok(await js(() => document.querySelector('.raffle-winner-dialog .winner-character-toggle').title.includes('픽셀 캐릭터로 당첨자 표시')));
      assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')).raffleCharacterEnabled, true, 'character preference is saved on disk');
      await click(".raffle-winner-dialog .chat-speech-toggle");
      await waitFor(() => js(() => document.querySelector(".raffle-winner-dialog .chat-speech-toggle")?.getAttribute("aria-pressed") === "true"), "winner TTS enabled");
      ingest(draw.winner.platform, draw.winner.userId, "winner-live", "당첨 감사합니다!"); await state();
      await waitFor(() => spoken.at(-1) === "당첨 감사합니다!", "winner chat TTS");
      assert.equal(await js(() => document.querySelector('.winner-character-stage').dataset.outfit), outfit, 'new chat keeps the same outfit');
      const spokenBeforeToggle = spoken.length;
      await click('.raffle-winner-dialog .winner-character-toggle');
      assert.equal(await js(() => !!document.querySelector('.winner-character-stage')), false);
      assert.equal(await js(() => document.querySelector('.raffle-winner-dialog .chat-speech-toggle').getAttribute('aria-pressed')), 'true', 'changing presentation keeps TTS enabled');
      await click('.raffle-winner-dialog .winner-character-toggle');
      assert.equal(await js(() => document.querySelector('.winner-character-stage').dataset.outfit), outfit, 'returning to the character keeps this draw outfit');
      assert.equal(spoken.length, spokenBeforeToggle, 'toggling never replays old messages');
      for (const scale of [100, 150]) {
        win.setSize(900, 650); await call('text-scale-set', { scale }); await settleUI(win); await assertLayout(win, 'character dialogue at ' + scale + ' percent');
        assert.equal(await js(() => { const log=document.querySelector('.raffle-winner-dialog .winner-chat-messages'); return log.scrollWidth<=log.clientWidth+1; }), true, 'speech bubbles do not overflow');
        assert.equal(await js(() => { const toolbar=document.querySelector('.raffle-winner-dialog .winner-chat-toolbar').getBoundingClientRect(),log=document.querySelector('.raffle-winner-dialog .winner-chat-messages').getBoundingClientRect(); return toolbar.bottom<=log.top+1; }), true, 'TTS controls stay outside the scrolling speech bubbles');
      }
      await call('text-scale-set', { scale:100 }); win.setSize(1240,850); await settleUI(win);
      if (process.env.STREAMER_ASSIST_TEST_SCREENSHOTS !== "0") fs.writeFileSync(path.join(__dirname, "../release/winner-tts-preview.png"), (await win.webContents.capturePage()).toPNG());
      await js(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
      await waitFor(() => speech.owner === null, "hidden chat cancels TTS");
      await click(".raffle-winner-close"); await state();
      await js(() => { Object.defineProperty(document, "hidden", { configurable:true,get:()=>false }); });
      engine.audience.stopRaffle();
      engine.audience.startRaffle({title:'명단 전체 확인',platforms:['chzzk','youtube','twitch'],entryMode:'any',keyword:'',subscribersOnly:false,excludeWinners:true,timerSeconds:null},Date.now());
      for(let i=0;i<135;i++)engine.ingest({platform:['chzzk','youtube','twitch'][i%3],userId:'wall-'+i,id:'wall-chat-'+i,name:(i===2?'아주긴닉네임'.repeat(30):['참여자','나','닉네임이긴시청자','별','시청자'][i%5])+String(i).padStart(3,'0'),text:'참여',timestamp:Date.now()});
      await state();
      await waitFor(()=>js(()=>document.querySelector('.raffle-participants .participant-display-name')?.textContent==='참여자000'),'wall includes oldest entrants beyond recent 100');
      assert.equal(await js(()=>document.querySelector('.raffle-count strong').textContent),'100명+');
      assert.equal(await js(()=>!!document.querySelector('.raffle-clock,.raffle-metrics')),false,'only the participant count remains');
      assert.equal(await js(()=>[...document.querySelectorAll('.raffle-participants .platform-badge')].every(badge=>badge.textContent==='')),true,'platform badges contain only icons');
      assert.equal(await js(()=>{const stage=document.querySelector('.raffle-stage').getBoundingClientRect(),wall=document.querySelector('.raffle-participants').getBoundingClientRect();return wall.width/stage.width>.95&&wall.height/stage.height>.7;}),true,'names occupy most of the stage');
      await assertNameFlow('variable-width names wrap as whole units');
      assert.equal(await js(()=>new Set([...document.querySelectorAll('.raffle-participants li')].map(item=>Math.round(item.getBoundingClientRect().width))).size>=3),true,'name lengths determine item widths');
      const nameFont = () => js(() => parseFloat(getComputedStyle(document.querySelector('.raffle-participant-button')).fontSize));
      assert.equal(await nameFont(),28,'moderate default font');
      await click('.raffle-fullscreen');await waitFor(()=>win.isFullScreen(),'roster fullscreen');await settleUI(win);
      assert.equal(await nameFont(),28,'fullscreen does not inflate participant names');
      await assertNameFlow('fullscreen name flow');
      await js(()=>window.assist.windowControl('exit-fullscreen'));await waitFor(()=>!win.isFullScreen(),'roster fullscreen exit');win.setSize(1240,850);await settleUI(win);
      await click('[aria-label="참여자 이름 크게"]');assert.equal(await nameFont(),30);
      assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'preferences.json'),'utf8')).raffleNameSize,30,'name size is saved');
      await click('[aria-label="참여자 이름 작게"]');assert.equal(await nameFont(),28);
      await click('[aria-label="참여자 이름 작게"]');assert.equal(await nameFont(),26);
      await click('[aria-label="참여자 이름 기본 크기로"]');assert.equal(await nameFont(),28);
      await call('raffle-name-size-set',{size:48});await settleUI(win);
      assert.equal(await js(()=>document.querySelector('[aria-label="참여자 이름 크게"]').disabled),true);
      win.setSize(900,650);await call('text-scale-set',{scale:150});await settleUI(win);await assertLayout(win,'largest participant names with 150 percent interface');
      await assertNameFlow('large names remain within the narrow viewport');
      await call('text-scale-set',{scale:100});win.setSize(1240,850);
      await call('raffle-name-size-set',{size:18});await settleUI(win);
      assert.equal(await js(()=>document.querySelector('[aria-label="참여자 이름 작게"]').disabled),true);
      await click('[aria-label="참여자 이름 기본 크기로"]');
      await waitFor(()=>js(()=>document.querySelector('.raffle-participants .participant-display-name')?.textContent==='참여자000'),'default size roster loaded');
      await waitFor(()=>js(()=>{const name=document.querySelector('.raffle-participants .participant-display-name')?.textContent;return !!name&&name!=='참여자000';}),'automatic roster page rotation',10000);
      await click('[aria-label="명단 자동 넘김 끄기"]');
      await click('[aria-label="이전 참여자 명단"]');
      const seen=new Set();let first='';
      for(let turn=0;turn<140;turn++){
        const names=await js(()=>[...document.querySelectorAll('.raffle-participants .participant-display-name')].map(node=>node.textContent));
        await assertNameFlow('every page fits the visible roster');
        if(turn>0&&names[0]===first)break;
        if(!turn)first=names[0];
        for(const name of names)seen.add(name);
        await click('[aria-label="다음 참여자 명단"]');
        await waitFor(()=>js(previous=>{const name=document.querySelector('.raffle-participants .participant-display-name')?.textContent;return !!name&&name!==previous;},names[0]),'manual roster page');
      }
      assert.equal(seen.size,135,'every participant is reachable, including early entrants');
      await click('[aria-label="이전 참여자 명단"]');
      await waitFor(()=>js(()=>[...document.querySelectorAll('.raffle-participants .participant-display-name')].some(node=>node.textContent==='시청자134')),'previous wraps to the final page');
      await click('[aria-label="다음 참여자 명단"]');
      await waitFor(()=>js(()=>document.querySelector('.raffle-participants .participant-display-name')?.textContent==='참여자000'),'next wraps to the first page');
      await call('text-scale-set',{scale:150});await settleUI(win);await assertLayout(win,'full participant wall at 150 percent');
      await assertNameFlow('enlarged interface name flow');
      await call('text-scale-set',{scale:100});await settleUI(win);
      for (const [width, height] of [[1240, 850], [900, 650]]) { win.setSize(width, height); await settleUI(win); await assertLayout(win, "larger raffle " + width); }
      clearTimeout(deadline); console.log("PASS: fullscreen, badges and readable roster; native/Web Speech TTS; searchable voice cards, language filters, keyboard selection, per-card preview and persistence; remote-voice consent, no old chat or duplicate playback, cleanup and 900px/150% layouts."); app.quit();
    } catch (error) { clearTimeout(deadline); console.error(error); try { fs.writeFileSync(path.join(__dirname, "../release/viewer-failure.png"), (await win.webContents.capturePage()).toPNG()); } catch {} app.exit(1); }
  });
});
require("../electron/main.cjs");
