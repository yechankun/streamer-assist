const {test}=require("node:test"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const {videoReference,twitchReplay,chzzkReplay,jsonArrayObjects}=require("../electron/replay-parsers.cjs");
test("only exact HTTPS video hosts and video IDs are accepted",()=>{
  assert.equal(videoReference("https://youtu.be/abcdefghijk?t=1").videoId,"abcdefghijk");assert.equal(videoReference("https://www.twitch.tv/videos/123").platform,"twitch");assert.equal(videoReference("https://chzzk.naver.com/video/123").platform,"chzzk");
  for(const u of ["https://youtube.com.evil.test/watch?v=abcdefghijk","file:///tmp/video","https://me:password@youtube.com/watch?v=abcdefghijk","https://twitch.tv/channel"] )assert.throws(()=>videoReference(u));
});
test("replay parsers keep source IDs, original timestamps, VOD offsets and roles",()=>{
  const source={startedAt:100000,videoId:"video"};
  const tw=twitchReplay({_id:"tw-id",created_at:"2026-10-08T00:00:00Z",content_offset_seconds:10,commenter:{_id:"person",display_name:"닉"},message:{body:"hello",user_badges:[{_id:"subscriber"}]}},source);assert.equal(tw.subscriber,true);assert.equal(tw.offsetMs,10000);
  const raw={userIdHash:"person",profile:JSON.stringify({nickname:"닉"}),messageTime:102000,playerMessageTime:2000,content:"!1",extras:JSON.stringify({payAmount:1000})};const c=chzzkReplay(raw,source);assert.equal(c.amountMicros,1000000000);assert.equal(c.id,chzzkReplay(raw,source).id);assert.notEqual(c.id,chzzkReplay({...raw,content:"different"},source).id);
});
test("Twitch JSON is consumed one object at a time across arbitrary UTF-8 boundaries",async()=>{
  const rows=[{_id:"one",message:{body:'한글 😀 { brace } "quote"'}},{_id:"two",message:{body:"두 번째"}}],raw=Buffer.from(JSON.stringify({title:"header",comments:rows,footer:[1,2]}));const output=[];
  for await(const row of jsonArrayObjects(Readable.from(Array.from(raw,b=>Buffer.from([b])))))output.push(row);
  assert.deepEqual(output,rows);
  await assert.rejects(async()=>{for await(const row of jsonArrayObjects(Readable.from([Buffer.from('{"comments":[{"x":1}')]))){}},/끝까지/);
});
test("missing Twitch comments array is an invalid archive rather than a successful empty import",async()=>{
  await assert.rejects(async()=>{for await(const row of jsonArrayObjects(Readable.from([Buffer.from('{"error":"unavailable"}')]))){}},/comments/);
});
