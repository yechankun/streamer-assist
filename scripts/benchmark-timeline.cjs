// Synthetic records only: never opens the user's Electron profile.
const fs=require("node:fs"), path=require("node:path"), os=require("node:os"), crypto=require("node:crypto");
const { performance }=require("node:perf_hooks");
const { gzipSync }=require("node:zlib");
const { TimelineStore }=require("../electron/timeline-store.cjs");
const key=crypto.randomBytes(32);
const storage={
  isEncryptionAvailable:()=>true,
  encryptString(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",key,iv);return Buffer.concat([iv,Buffer.concat([c.update(text,"utf8"),c.final()]),c.getAuthTag()]);},
  decryptString(data){const d=crypto.createDecipheriv("aes-256-gcm",key,data.subarray(0,12));d.setAuthTag(data.subarray(-16));return Buffer.concat([d.update(data.subarray(12,-16)),d.final()]).toString("utf8");}
};
async function run(Store) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"streamer-benchmark-"));
  try {
    const store=new Store(directory,storage),startedAt=new Date("2026-08-01T00:00:00").getTime();
    const session={id:crypto.randomUUID(),title:"Synthetic 24000 chats",startedAt};
    const writing=performance.now();
    store.append(session,{type:"participant",key:"viewer",platform:"youtube",platformUserId:"synthetic",displayName:"테스트",subscriber:false,roles:[],badges:[],observedAt:startedAt});
    for(let i=0;i<24000;i++){
      const day=new Date(startedAt); day.setDate(day.getDate()+Math.floor(i/1000));
      store.append(session,{type:"chat",id:"synthetic-"+i,platform:"youtube",participantKey:"viewer",displayName:"테스트",subscriber:false,roles:[],text:"오늘 방송 재밌어요 ㅋㅋ 질문 "+i,timestamp:day.getTime()+(i%1000)*1000,receivedAt:day.getTime()+(i%1000)*1000});
    }
    store.flush(session);
    const writeMs=performance.now()-writing;
    const diskBytes=fs.readdirSync(store.folder(session.id)).reduce((n,file)=>n+fs.statSync(path.join(store.folder(session.id),file)).size,0);
    let reads=0;const decode=store.decode.bind(store);store.decode=file=>{reads++;return decode(file);};
    const samples=[];
    for(let i=0;i<5;i++){
      const begin=performance.now();
      const result=await store.query(session,{from:0,to:1000000,limit:30});
      if(result.events.length!==30)throw Error("Benchmark result mismatch");
      samples.push(performance.now()-begin);
    }
    const queryMs=samples.sort((a,b)=>a-b)[2];
    const sample={events:[{type:"chat",text:"압축 비교",timestamp:startedAt}]};
    const binaryBytes=store.encode(sample).length;
    const legacyBytes=storage.encryptString(gzipSync(Buffer.from(JSON.stringify(sample))).toString("base64")).toString("base64").length;
    return {chats:24000,days:24,diskBytes,writeMs:+writeMs.toFixed(2),queryMedianMs:+queryMs.toFixed(2),chunksDecodedPerQuery:reads/5,binaryBytes,legacyBytes};
  }finally{
    const resolved=fs.realpathSync(directory), allowed=fs.realpathSync(os.tmpdir())+path.sep+"streamer-benchmark-";
    if(!resolved.startsWith(allowed))throw Error("Unsafe benchmark cleanup");
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
async function lowVolume(Store) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"streamer-benchmark-"));
  try {
    const store=new Store(directory,storage),startedAt=new Date("2026-08-01T00:00:00").getTime();
    const session={id:crypto.randomUUID(),title:"Synthetic low-volume",startedAt};
    for(let i=0;i<120;i++){
      store.append(session,{type:"chat",id:"slow-"+i,platform:"youtube",displayName:"테스트",text:"방송 재밌어요 "+i,timestamp:startedAt+i*1000});
      store.flush(session,false);
    }
    const files=fs.readdirSync(store.folder(session.id)).filter(n=>/^\d{12}\.enc$/.test(n));
    return {oneSecondFlushes:120,files:files.length,originalFileBytes:files.reduce((n,file)=>n+fs.statSync(path.join(store.folder(session.id),file)).size,0)};
  }finally{
    const resolved=fs.realpathSync(directory);
    if(!resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"streamer-benchmark-"))throw Error("Unsafe benchmark cleanup");
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
async function main(){
  const baseline=path.resolve(__dirname,"../.dev/optimization-baseline/timeline-store.cjs");
  const before=fs.existsSync(baseline)?await run(require(baseline).TimelineStore):null;
  const after=await run(TimelineStore);
  const lowVolumeAfter=await lowVolume(TimelineStore);
  const lowVolumeBefore=fs.existsSync(baseline)?await lowVolume(require(baseline).TimelineStore):null;
  const report={note:"Synthetic AES-GCM fixture; actual Windows DPAPI timing varies.",before,after,lowVolume:{before:lowVolumeBefore,after:lowVolumeAfter}};
  if(before)report.improvement={diskPercent:+((1-after.diskBytes/before.diskBytes)*100).toFixed(1),querySpeedup:+(before.queryMedianMs/after.queryMedianMs).toFixed(1)};
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
