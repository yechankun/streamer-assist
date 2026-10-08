const {test}=require("node:test"),assert=require("node:assert/strict");
const {ReplayProviders}=require("../electron/replay-providers.cjs");
const response=value=>({ok:true,json:async()=>value});
test("CHZZK discovery follows video pages and retains all segments of one broadcast",async()=>{
  const at=Date.parse("2026-10-08T00:00:00Z"),pages=[];
  const providers=new ReplayProviders({requestsPerSecond:1000,fetcher:async url=>{const page=Number(new URL(url).searchParams.get("page"));pages.push(page);return response({code:200,content:{totalPages:2,data:[{videoNo:page+1,liveId:"broadcast",liveOpenDate:new Date(at).toISOString()}]}});}});
  const result=await providers.discover({startedAt:at,sources:[{platform:"chzzk",channelId:"a".repeat(32),broadcastId:"broadcast",startedAt:at}]});assert.deepEqual(pages,[0,1]);assert.deepEqual(result.map(r=>r.videoId),["1","2"]);
});
test("empty CHZZK chat windows with a progressing cursor do not end collection",async()=>{
  const cursors=[],source={platform:"chzzk",videoId:"1",startedAt:1000};
  const providers=new ReplayProviders({requestsPerSecond:1000,fetcher:async url=>{if(url.includes("/service/v3/"))return response({code:200,content:{}});const cursor=Number(new URL(url).searchParams.get("playerMessageTime"));cursors.push(cursor);return response({code:200,content:{previousVideoChats:[],videoChats:cursor===10?[{userIdHash:"u",messageTime:11000,playerMessageTime:10,content:"after silence"}]:[],nextPlayerMessageTime:cursor===0?10:null}});}});
  const pages=[];for await(const page of providers.collect(source))pages.push(page);assert.deepEqual(cursors,[0,10]);assert.equal(pages[1].messages[0].text,"after silence");assert.equal(pages[1].terminal,true);
});
test("non-progressing CHZZK cursors fail rather than marking a partial archive complete",async()=>{
  const providers=new ReplayProviders({fetcher:async url=>response({code:200,content:url.includes("/service/v3/")?{}:{videoChats:[],nextPlayerMessageTime:0}})});
  await assert.rejects(async()=>{for await(const p of providers.collect({platform:"chzzk",videoId:"1",startedAt:1})){}},/전진하지/);
});
test("transient HTTP failures retry without moving a saved page cursor",async()=>{
  let calls=0;const providers=new ReplayProviders({fetcher:async()=>++calls===1?{ok:false,status:429,headers:{get:()=>"0.001"}}:response({ok:true})});assert.deepEqual(await providers.json("https://api.chzzk.naver.com/test"),{ok:true});assert.equal(calls,2);
});
test("disabled replay chat and changed CHZZK response schemas cannot become zero-chat successes",async()=>{
  for(const disabled of [true,false]){const provider=new ReplayProviders({fetcher:async url=>response({code:200,content:url.includes("/service/v3/")?{videoChatEnabled:!disabled}:{renamedChats:[],nextPlayerMessageTime:null}})});await assert.rejects(async()=>{for await(const page of provider.collect({platform:"chzzk",videoId:"1",startedAt:1})){}},disabled?/제공하지/:/형식이 변경/);}
});
