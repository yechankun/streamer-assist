const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { TimelineStore } = require("../electron/timeline-store.cjs");
const { dayKey, datesOf } = require("../electron/timeline-history.cjs");
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"streamer-history-"));
  const key=crypto.randomBytes(32);
  const secure={
    isEncryptionAvailable:()=>true,
    encryptString(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",key,iv);const bytes=Buffer.concat([c.update(text,"utf8"),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]);},
    decryptString(bytes){const d=crypto.createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString("utf8");}
  };
  t.after(()=>{const target=fs.realpathSync(directory);assert.ok(target.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"streamer-history-"));fs.rmSync(target,{recursive:true,force:true});});
  return { directory,secure,store:new TimelineStore(directory,secure) };
}
const at=(date,hour=12)=>new Date(date+"T"+String(hour).padStart(2,"0")+":00:00").getTime();
const session=(date)=>({id:crypto.randomUUID(),title:date,startedAt:at(date,0),markers:[{label:"keep"}]});
function chat(store,s,date,id="chat",timestamp=at(date)) {
  store.append(s,{type:"participant",key:"actor",platform:"youtube",platformUserId:"account",displayName:"시청자",roles:[],badges:[],observedAt:timestamp});
  store.append(s,{type:"chat",id,platform:"youtube",participantKey:"actor",displayName:"시청자",roles:[],text:"안녕하세요 "+id,timestamp});
}
test("calendar dates respect Korean midnight and DST offsets; malformed selections are rejected",()=>{
  assert.equal(dayKey(Date.parse("2026-10-01T15:00:00Z"),"Asia/Seoul"),"2026-10-02");
  assert.equal(dayKey(Date.parse("2026-03-08T04:59:00Z"),"America/New_York"),"2026-03-07");
  assert.equal(dayKey(Date.parse("2026-03-08T05:00:00Z"),"America/New_York"),"2026-03-08");
  assert.equal(dayKey(Date.parse("2026-11-01T06:30:00Z"),"America/New_York"),"2026-11-01");
  assert.deepEqual(datesOf(["2026-10-02","2026-10-01","2026-10-02"]),["2026-10-01","2026-10-02"]);
  assert.throws(()=>datesOf(["2026-02-30"]));
  assert.throws(()=>datesOf(["../../outside"]));
});
test("cross-midnight broadcasts use separate encrypted day files with exact selected physical bytes",t=>{
  const {store}=fixture(t),s=session("2026-10-01");
  chat(store,s,"2026-10-01","one");chat(store,s,"2026-10-02","two");store.flush(s);
  const entries=store.index(s).entries;
  assert.equal(entries.length,2);
  assert.ok(entries.every(e=>e.days.length===1));
  const catalog=store.catalog([s],null,["2026-10-01"]);
  assert.equal(catalog.days.length,2);
  assert.equal(catalog.selectedBytes,fs.statSync(path.join(store.folder(s.id),entries[0].file)).size);
  assert.equal(catalog.totalBytes,entries.reduce((n,e)=>n+e.bytes,0));
  assert.equal(catalog.sharedBytes,0);
});
test("all broadcasts are sorted by original timestamp; pagination and date/type/sender filters preserve full coverage",async t=>{
  const {store}=fixture(t),a=session("2026-10-01"),b=session("2026-10-02");
  chat(store,a,"2026-10-01","old");
  chat(store,b,"2026-10-02","new");
  // Late provider history is written last but must appear at its original timestamp.
  store.append(b,{type:"chat",id:"late",platform:"youtube",participantKey:"actor",displayName:"시청자",text:"late",timestamp:at("2026-10-02",1)});
  store.append(b,{type:"donation",id:"paid",platform:"chzzk",participantKey:null,text:"응원",amountMicros:1000000,currency:"KRW",timestamp:at("2026-10-02",13)});
  store.flush(a);store.flush(b);
  const first=await store.queryAll([a,b],{limit:2});
  assert.deepEqual(first.events.map(e=>e.id),["paid","new"]);assert.equal(first.hasMore,true);
  assert.deepEqual((await store.queryAll([a,b],{limit:2,page:1})).events.map(e=>e.id),["late","old"]);
  const filtered=await store.queryAll([a,b],{dates:["2026-10-01"],participantKey:"actor",kind:"chat",text:"시청자"});
  assert.equal(filtered.events[0].sessionId,a.id);assert.equal(filtered.events.length,1);
  assert.equal((await store.queryAll([],{})).events.length,0);
});
test("scroll cursors cover timestamp ties across broadcasts without duplicates after new live rows arrive",async t=>{
  const {store}=fixture(t), a=session("2026-10-01"), b=session("2026-10-01");
  const sessions=[a,b].sort((x,y)=>y.id.localeCompare(x.id)), timestamp=at("2026-10-01");
  for(const s of sessions) for(let i=0;i<7;i++) store.append(s,{type:"chat",id:s.id+"-"+i,platform:"youtube",text:"same time",timestamp});
  store.flush(a);store.flush(b);
  const baseline=(await store.queryAll(sessions,{limit:100})).events;
  const first=await store.queryAll(sessions,{limit:3});
  store.append(sessions[0],{type:"chat",id:"new-tie",platform:"youtube",text:"new",timestamp});
  store.append(sessions[0],{type:"chat",id:"newer",platform:"youtube",text:"new",timestamp:timestamp+1000});
  store.flush(sessions[0]);
  let cursor=first.nextCursor, remaining=first.hasMore, rows=[...first.events];
  while(remaining){const next=await store.queryAll(sessions,{before:cursor,limit:3});rows.push(...next.events);cursor=next.nextCursor;remaining=next.hasMore;}
  assert.deepEqual(rows.map(e=>e.id),baseline.map(e=>e.id));
  assert.equal(new Set(rows.map(e=>e.sessionId+":"+e.seq)).size,14);
  assert.ok((await store.queryAll(sessions,{limit:3})).events.some(e=>e.id==="newer"));
});
test("scroll cursors preserve date, sender, platform and text filters and skip unrelated newer chunks",async t=>{
  const {store}=fixture(t), s=session("2026-10-01");
  for(let day=1;day<=8;day++)chat(store,s,"2026-10-"+String(day).padStart(2,"0"),"date-"+day);
  store.flush(s);store.catalog([s]);
  const filters={dates:["2026-10-02","2026-10-04","2026-10-06"],kind:"chat",platform:"youtube",participantKey:"actor",text:"시청자",limit:1};
  const first=await store.queryAll([s],filters);
  assert.equal(first.events[0].id,"date-6");
  const second=await store.queryAll([s],{...filters,before:first.nextCursor});
  assert.equal(second.events[0].id,"date-4");
  const last=await store.queryAll([s],{...filters,before:second.nextCursor});
  assert.equal(last.events[0].id,"date-2");assert.equal(last.hasMore,false);
  const decode=store.decode.bind(store);let reads=0;store.decode=file=>{reads++;return decode(file);};
  const older=await store.queryAll([s],{before:second.nextCursor,limit:1});
  assert.equal(older.events[0].id,"date-3");assert.ok(reads<=3,"newer encrypted chunks are not reread while scrolling backward");
});
test("invalid scroll positions and mixed offset/cursor requests are rejected",async t=>{
  const {store}=fixture(t), s=session("2026-10-01"), valid={timestamp:at("2026-10-01"),sessionId:s.id,seq:1};
  for(const before of [false,"",[],{}, {...valid,sessionId:"../outside"}, {...valid,seq:0}, {...valid,seq:1.5}, {...valid,timestamp:NaN}])
    await assert.rejects(store.queryAll([s],{before}),/위치/);
  await assert.rejects(store.queryAll([s],{before:valid,page:1}),/위치/);
});
test("indexed date queries decrypt only matching chunks and warm catalogs avoid transcript/summary reads",async t=>{
  const {store}=fixture(t),s=session("2026-10-01");
  for(let i=1;i<=12;i++)chat(store,s,"2026-10-"+String(i).padStart(2,"0"),"date-"+i);
  store.flush(s);store.catalog([s]);
  let reads=0;const decode=store.decode.bind(store);store.decode=file=>{reads++;return decode(file);};
  const result=await store.queryAll([s],{dates:["2026-10-01"]});
  assert.equal(result.events.length,1);assert.equal(reads,1);
  reads=0;store.catalog([s]);assert.equal(reads,0);
  const a=store.summary(s);store.state(s.id).analysis.snapshot=()=>{throw Error("uncached ranking");};
  assert.strictEqual(store.summary(s),a);
});
test("selected nonadjacent dates are removed while surviving chat identities, money, viewer records and markers remain correct after restart",async t=>{
  const {store,directory,secure}=fixture(t),s=session("2026-10-01");
  chat(store,s,"2026-10-01","delete-a");
  store.append(s,{type:"chat",id:"keep",platform:"youtube",participantKey:"actor",displayName:"새 이름",roles:["moderator"],text:"remain",timestamp:at("2026-10-02")});
  store.append(s,{type:"donation",id:"money",platform:"youtube",participantKey:"actor",text:"remain donation",amountMicros:5000000,currency:"USD",timestamp:at("2026-10-02",13)});
  store.append(s,{type:"viewers",timestamp:at("2026-10-02",14),sources:[{platform:"youtube",count:123,available:true}]});
  chat(store,s,"2026-10-03","delete-b");store.flush(s);
  const preview=store.catalog([s],null,["2026-10-01","2026-10-03"]);
  const deleted=await store.deleteDates([s],preview.selectedDates,{token:preview.token});
  assert.ok(deleted.freedBytes > 0 && deleted.freedBytes <= preview.selectedBytes);
  assert.equal(deleted.freedBytes,preview.totalBytes-deleted.catalog.totalBytes);
  const restored=new TimelineStore(directory,secure), rows=await restored.queryAll([s]);
  assert.deepEqual(rows.events.map(e=>e.id),["money","keep"]);
  const summary=restored.summary(s);
  assert.equal(summary.chats,1);assert.equal(summary.donations,1);assert.equal(summary.money.USD,5000000);assert.equal(summary.uniqueParticipants,1);assert.equal(summary.viewers.length,1);
  assert.equal(restored.state(s.id).analysis.participants.get("actor").platformUserId,"account");
  assert.deepEqual(s.markers,[{label:"keep"}]);
  assert.equal(fs.existsSync(path.join(store.folder(s.id),"deletion.enc")),false);
});
test("legacy base64 files spanning multiple dates show shared physical bytes and compact only the chosen date",async t=>{
  const {store,secure}=fixture(t),s=session("2026-10-01");
  const folder=store.folder(s.id);fs.mkdirSync(folder);
  const batch={schemaVersion:1,startedAt:s.startedAt,events:[
    {seq:1,type:"chat",id:"remove",platform:"youtube",text:"old",timestamp:at("2026-10-01")},
    {seq:2,type:"chat",id:"keep",platform:"youtube",text:"new",timestamp:at("2026-10-02")}
  ]};
  const legacy=secure.encryptString(gzipSync(Buffer.from(JSON.stringify(batch))).toString("base64")).toString("base64");
  fs.writeFileSync(path.join(folder,"000000000001.enc"),legacy);
  const preview=store.catalog([s],null,["2026-10-01"]);
  assert.equal(preview.sharedBytes,Buffer.byteLength(legacy));
  assert.equal(preview.selectedBytes,preview.totalBytes);
  await store.deleteDates([s],["2026-10-01"],{token:preview.token});
  assert.deepEqual((await store.queryAll([s])).events.map(e=>e.id),["keep"]);
  assert.equal(fs.readFileSync(path.join(folder,"000000000001.enc")).subarray(0,4).toString(),"SAT2");
});
test("deleting active broadcasts or stale previews is rejected without changing files",async t=>{
  const {store}=fixture(t),s=session("2026-10-01");chat(store,s,"2026-10-01");store.flush(s);
  const preview=store.catalog([s],s.id,["2026-10-01"]);
  await assert.rejects(store.deleteDates([s],["2026-10-01"],{currentId:s.id,token:preview.token}),/기록 중/);
  const old=store.catalog([s],null,["2026-10-01"]);
  chat(store,s,"2026-10-01","added");store.flush(s);
  await assert.rejects(store.deleteDates([s],["2026-10-01"],{token:old.token}),/변경/);
  assert.equal((await store.queryAll([s])).events.length,2);
});
test("interrupted compaction is completed on reopening and never resurrects deleted original rows",async t=>{
  const {store,directory,secure}=fixture(t),s=session("2026-10-01");
  chat(store,s,"2026-10-01","delete");chat(store,s,"2026-10-02","keep");store.flush(s);
  store.finishDeletion=()=>{throw Error("simulated process crash");};
  await assert.rejects(store.deleteDates([s],["2026-10-01"]),/simulated/);
  assert.equal(fs.existsSync(path.join(store.folder(s.id),"deletion.enc")),true);
  const restored=new TimelineStore(directory,secure);
  assert.deepEqual((await restored.queryAll([s])).events.map(e=>e.id),["keep"]);
  assert.equal(restored.summary(s).chats,1);
  assert.equal(fs.existsSync(path.join(store.folder(s.id),"deletion.enc")),false);
});
test("unchanged recording checkpoints are not rewritten during idle ticks",t=>{
  const {store}=fixture(t),s=session("2026-10-01");chat(store,s,"2026-10-01");store.flush(s);
  let writes=0;const atomic=store.atomic.bind(store);store.atomic=(...args)=>{writes++;return atomic(...args);};
  store.state(s.id).lastCheckpoint=0;
  store.flush(s);store.flush(s);
  assert.equal(writes,0);
});
test("day/week/month grouping uses Monday weeks across year boundaries and retains date identities",()=>{
  const ts=require("typescript"),vm=require("node:vm");
  const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,"../src/history-utils.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};vm.runInNewContext(js,{exports,Map,Date});
  const days=["2026-01-01","2025-12-31","2025-12-29","2025-12-28"].map(date=>({date,chats:1,bytes:1,sessions:[],donations:0,protected:false}));
  const weekly=exports.groupDays(days,"week");
  assert.equal(weekly.length,2);assert.equal(weekly[0].key,"2025-12-29");
  assert.equal(weekly[0].dates.length,3);
  assert.equal(exports.groupDays(days,"month").length,2);
  assert.equal(exports.groupDays(days,"day").length,4);
});

test("low-volume one-second flushes share a bounded day tail and recover sequences written after its checkpoint",async t=>{
  const {store,directory,secure}=fixture(t),s=session("2026-10-01");
  chat(store,s,"2026-10-01","first");store.flush(s);
  for(let i=1;i<=64;i++){
    store.append(s,{type:"chat",id:"slow-"+i,platform:"youtube",participantKey:"actor",displayName:"시청자",text:"slow "+i,timestamp:at("2026-10-01")+i*1000});
    store.flush(s,false);
  }
  assert.equal(store.index(s).entries.length,1);
  const restored=new TimelineStore(directory,secure);
  assert.equal(restored.summary(s).chats,65);
  assert.equal((await restored.queryAll([s],{limit:100})).events.length,65);
  assert.ok(restored.index(s).entries.every(e=>e.days.length===1&&e.days[0].events<=256));
});
test("live tail extension while awaiting a query cannot duplicate its pending snapshot or leak later rows",async t=>{
  const {store}=fixture(t),s=session("2026-10-01");chat(store,s,"2026-10-01","old");store.flush(s);
  store.append(s,{type:"chat",id:"pending",platform:"youtube",text:"pending",timestamp:at("2026-10-01")+1000});
  const promise=store.queryAll([s],{limit:100});
  store.append(s,{type:"chat",id:"later",platform:"youtube",text:"later",timestamp:at("2026-10-01")+2000});
  store.flush(s,false);
  assert.deepEqual((await promise).events.map(e=>e.id),["pending","old"]);
  assert.equal((await store.queryAll([s],{limit:100})).events.length,3);
  const iterator=store.events(s,true);
  const first=await iterator.next();
  store.append(s,{type:"chat",id:"after-start",platform:"youtube",text:"after",timestamp:at("2026-10-01")+3000});
  store.flush(s,false);
  const rows=[first.value];for await(const event of iterator)rows.push(event);
  assert.equal(rows.filter(e=>e.type==="chat").length,3);
});
