const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../electron/engine.cjs');
const {AudienceTools}=require('../electron/audience.cjs');
const {stripYoutubeRecords,expireYoutubeRecords}=require('../electron/youtube-data.cjs');
const raffle={title:'같이 놀아요',platforms:['chzzk','youtube'],entryMode:'any',keyword:'!참여',subscribersOnly:false,excludeWinners:true,timerSeconds:null};
const donation={question:'벌칙',options:['노래','댄스','게임'],platforms:['chzzk','youtube'],chatPrefix:'!투표',currency:'KRW',minimumMicros:1e9,plural:false,timerSeconds:600};
const chat=(user,text='!투표1',extra={})=>({platform:'chzzk',userId:user,name:user,text,...extra});
const paid=(id,user,text,amount=1e9,extra={})=>chat(user,text,{id,kind:'donation',amountMicros:amount,currency:'KRW',...extra});
function pollEngine(mode='chat') {
  const e=new Engine();e.start('방송',0,1000);e.createPoll('다음 게임',['A','B','C'],mode,['chzzk','youtube'],'!투표',600,1000);return e;
}
const pollEdit=(p,extra={})=>({id:p.id,revision:p.settingsRevision||0,question:p.question,options:p.options.slice(),optionIndices:p.options.map((_,i)=>i),platforms:p.platforms.slice(),chatPrefix:p.chatPrefix,...extra});
const raffleEdit=(p,extra={})=>{const {timerSeconds,...rules}=p.config;return {id:p.id,revision:p.settingsRevision||0,title:p.title,...rules,...extra};};
const donorEdit=(p,extra={})=>({...pollEdit(p),...p.donation,...extra});

test('live poll rename, empty-choice removal and addition preserve ballots and remap subsequent changes',()=>{
  const e=pollEngine();e.ingest(chat('one','!투표1'),1100);e.ingest(chat('two','!투표3'),1101);
  const id=e.poll.id, opened=e.poll.openedAt, deadline=e.poll.endsAt;
  e.updatePoll(pollEdit(e.poll,{question:'수정한 질문',options:['C 수정','A 수정','새 선택'],optionIndices:[2,0,null],chatPrefix:'!골라'}),2000);
  assert.equal(e.poll.id,id);assert.equal(e.poll.openedAt,opened);assert.equal(e.poll.endsAt,deadline);
  assert.deepEqual(e.poll.counts,[1,1,0]);assert.deepEqual([...e.voters],[['chzzk:one',1],['chzzk:two',0]]);
  e.ingest(chat('one','!투표3'),2100);assert.deepEqual(e.poll.counts,[1,1,0]);
  e.ingest(chat('one','!골라3'),2101);assert.deepEqual(e.poll.counts,[1,0,1]);
  const restored=new Engine(e.persisted());restored.ingest(chat('two','!골라3'),2200);
  assert.deepEqual(restored.poll.counts,[0,0,2]);
  assert.equal(restored.poll.settingsHistory[0].question,'다음 게임');
  assert.equal(restored.snapshot().poll.settingsHistory,undefined);
});
test('invalid, stale, completed and expired edits cannot replace live poll state',()=>{
  const e=pollEngine();e.ingest(chat('one'),1100);
  for(const change of [{options:['B','C'],optionIndices:[1,2]}, {options:['A','A','C']}, {optionIndices:[0,0,2]},
    {platforms:[]}, {timerSeconds:-1},{revision:99},{id:'old'}]) {
    const before=JSON.stringify(e.persisted());assert.throws(()=>e.updatePoll(pollEdit(e.poll,change),2000));assert.equal(JSON.stringify(e.persisted()),before);
  }
  assert.throws(()=>e.updatePoll(pollEdit(e.poll,{timerSeconds:120}),e.poll.endsAt),/終了|종료/);
  e.endPoll(3000);assert.throws(()=>e.updatePoll(pollEdit(e.poll),3100),/진행 중/);
});
test('timer changes count from apply time while elapsed time and automatic stop keep original identity',()=>{
  const e=pollEngine();e.updatePoll(pollEdit(e.poll,{timerSeconds:120}),2000);
  assert.equal(e.poll.endsAt,122000);assert.equal(e.poll.timerDurationSeconds,120);assert.equal(e.poll.openedAt,1000);
  e.updatePoll(pollEdit(e.poll),3000);assert.equal(e.poll.endsAt,122000);
  e.updatePoll(pollEdit(e.poll,{timerSeconds:null}),4000);assert.equal(e.poll.endsAt,null);
});
test('native YouTube poll permits timer and chat rules but locks published question and choice identity',()=>{
  const e=pollEngine('native');e.poll.youtubeId='native';e.poll.youtubeCounts=[3,2,0];
  for(const edit of [{question:'변경'}, {options:['A','B','D']}, {platforms:['chzzk']}, {optionIndices:[1,0,2]}])
    assert.throws(()=>e.updatePoll(pollEdit(e.poll,edit),2000),/YouTube/);
  e.updatePoll(pollEdit(e.poll,{chatPrefix:'!골라',timerSeconds:30}),2000);
  assert.deepEqual(e.poll.youtubeCounts,[3,2,0]);assert.equal(e.poll.youtubeId,'native');assert.equal(e.poll.endsAt,32000);
});
test('raffle edits preserve roster, winner history and deadline while updating eligibility and command',()=>{
  const a=new AudienceTools();a.startRaffle({...raffle,timerSeconds:600},1000);
  a.ingest(chat('member','hello',{subscriber:true}),1100);a.ingest(chat('nonmember'),1101);
  a.ingest(chat('youtube','hello',{platform:'youtube',subscriber:true}),1102);
  a.drawRaffle(true,1200,()=>0);
  a.resumeRaffle(a.raffle.id,1250);
  const draws=a.raffle.draws.slice(), id=a.raffle.id, end=a.raffle.endsAt, revision=a.snapshot().raffle.rosterRevision;
  a.updateRaffle(raffleEdit(a.raffle,{entryMode:'keyword',keyword:'!새참여',platforms:['chzzk'],subscribersOnly:true,excludeWinners:false}),1300);
  assert.equal(a.raffle.id,id);assert.equal(a.raffle.endsAt,end);assert.equal(a.raffle.openedAt,1000);assert.deepEqual(a.raffle.draws,draws);
  assert.equal(a.snapshot().raffle.candidateCount,3);assert.equal(a.snapshot().raffle.eligibleCount,1);assert.ok(a.snapshot().raffle.rosterRevision>revision);
  assert.deepEqual(a.getRaffleParticipants({id}).participants.map(p=>p.eligible),[true,false,false]);
  a.ingest(chat('new','!참여',{subscriber:true}),1400);assert.equal(a.candidates.size,3);
  a.ingest(chat('new','!새참여',{subscriber:true}),1401);assert.equal(a.candidates.size,4);
  a.ingest(chat('blocked','!새참여'),1402);assert.equal(a.candidates.size,4);
  a.updateRaffle(raffleEdit(a.raffle,{excludeWinners:true,timerSeconds:60}),1500);
  assert.equal(a.snapshot().raffle.eligibleCount,1);assert.equal(a.raffle.endsAt,61500);
  assert.equal(a.snapshot().raffle.settingsHistory,undefined);
});
test('raffle live rules cannot change during the frozen draw or after the deadline',()=>{
  const a=new AudienceTools();a.startRaffle({...raffle,timerSeconds:60},1000);a.ingest(chat('one'),1100);a.drawRaffle(false,1200,()=>0);
  assert.throws(()=>a.configureRaffle({id:a.raffle.id,changes:{subscribersOnly:true}},1300),/추첨이 끝난/);
  a.resumeRaffle(a.raffle.id,5000);a.updateRaffle(raffleEdit(a.raffle),5100);
  assert.throws(()=>a.updateRaffle(raffleEdit(a.raffle),65000),/진행 중/);
  assert.equal(a.raffle.closedAt,65000);
});
test('donation question, choice, currency and price edits preserve old amounts and apply only to future events',()=>{
  const a=new AudienceTools();a.startDonation(donation,1000);a.ingest(paid('old','one','!투표1'),1100);
  a.updateDonation(donorEdit(a.donationPoll,{question:'수정한 벌칙',options:['노래 변경','댄스','새 게임'],optionIndices:[0,1,2],minimumMicros:2e9,plural:true,chatPrefix:'!도네'}),2000);
  assert.deepEqual(a.donationPoll.counts,[1,0,0]);assert.equal(a.donationPoll.endsAt,601000);
  a.ingest(paid('old','one','!도네3',10e9),2100);assert.deepEqual(a.donationPoll.counts,[1,0,0]);
  a.ingest(paid('low','two','!도네3',1e9),2101);a.ingest(paid('wrong-prefix','two','!투표3',4e9),2102);
  a.ingest(paid('new','two','!도네3',5e9),2103);assert.deepEqual(a.donationPoll.counts,[1,0,2]);
  a.updateDonation(donorEdit(a.donationPoll,{platforms:['youtube'],currency:'USD',minimumMicros:1e6}),2200);
  a.ingest(paid('usd','three','!도네2',3e6,{platform:'youtube',currency:'USD'}),2300);
  assert.deepEqual(a.donationPoll.counts,[1,3,2]);assert.equal(a.donationPoll.acceptedEvents,3);
  assert.equal(a.snapshot().donationPoll.settingsHistory,undefined);
});
test('switching donation counting modes retains plural contributions and the latest single ballot across restart',()=>{
  let a=new AudienceTools();a.startDonation(donation,1000);a.ingest(paid('single','one','!투표1'),1100);
  a.updateDonation(donorEdit(a.donationPoll,{plural:true}),1200);a.ingest(paid('plural','one','!투표2',3e9),1300);
  a=new AudienceTools(a.persisted());a.updateDonation(donorEdit(a.donationPoll,{plural:false}),1400);a.ingest(paid('single-again','one','!투표3'),1500);
  assert.deepEqual(a.donationPoll.counts,[0,3,1]);
  a.updateDonation(donorEdit(a.donationPoll,{plural:true}),1600);a.ingest(paid('new-plural','one','!투표1',2e9),1700);
  a=new AudienceTools(a.persisted());a.updateDonation(donorEdit(a.donationPoll,{plural:false}),1800);a.ingest(paid('single-third','one','!투표2'),1900);
  assert.deepEqual(a.donationPoll.counts,[2,4,0]);
});
test('YouTube deletion and retention remember data provenance after repeated platform changes',()=>{
  const e=pollEngine();e.ingest(chat('youtube','!투표1',{platform:'youtube'}),1100);
  e.updatePoll(pollEdit(e.poll,{platforms:['chzzk']}),1200);
  for(let i=0;i<35;i++)e.updatePoll(pollEdit(e.poll),1300+i);
  assert.equal(e.poll.settingsHistory.length,30);assert.ok(e.poll.dataPlatforms.includes('youtube'));
  const a=e.audience;a.startDonation(donation,1000);a.ingest(paid('yt','yt','!투표1',1e9,{platform:'youtube'}),1100);
  a.updateDonation(donorEdit(a.donationPoll,{platforms:['chzzk']}),1200);
  a.startRaffle(raffle,1000);a.ingest(chat('yt','hello',{platform:'youtube'}),1100);a.ingest(chat('keep'),1100);
  a.updateRaffle(raffleEdit(a.raffle,{platforms:['chzzk']}),1200);
  const saved=e.persisted(),clean=stripYoutubeRecords(saved);
  assert.equal(clean.poll,null);assert.equal(clean.audience.donationPoll,null);
  assert.deepEqual(clean.audience.raffle.dataPlatforms,['chzzk']);assert.deepEqual(clean.audience.raffle.settingsHistory,[]);
  assert.equal(clean.audience.raffle.candidates.length,1);assert.equal(clean.audience.raffle.candidates[0].userId,'keep');
  assert.equal(expireYoutubeRecords(saved,[],2000).poll,null);
  assert.equal(expireYoutubeRecords(saved,[],500).poll.id,e.poll.id,'new records remain until retention expires');
});
