const {test}=require("node:test"),assert=require("node:assert/strict"),{decodeMessage,requestBytes,stringField,encodeVarint}=require("../electron/youtube-stream.cjs");
const nested=(field,bytes)=>Buffer.concat([encodeVarint(field*8+2),encodeVarint(bytes.length),bytes]);
test("Google server-stream protobuf text, sponsor identity and resume tokens decode without a grpc dependency",()=>{
  const snippet=Buffer.concat([encodeVarint(8),encodeVarint(1),stringField(4,"2026-10-08T00:00:00Z"),nested(19,stringField(1,"채팅 😀"))]);const author=Buffer.concat([stringField(10101,"channel"),stringField(103,"name"),encodeVarint(6*8),encodeVarint(1)]);
  const page=decodeMessage(Buffer.concat([stringField(100602,"resume"),nested(1007,Buffer.concat([stringField(101,"message"),nested(2,snippet),nested(3,author)]))]));
  assert.equal(page.nextPageToken,"resume");assert.equal(page.items[0].snippet.type,"textMessageEvent");assert.equal(page.items[0].snippet.textMessageDetails.messageText,"채팅 😀");assert.equal(page.items[0].authorDetails.isChatSponsor,true);assert.ok(requestBytes("chat","resume").includes(Buffer.from("authorDetails")));
  assert.throws(()=>decodeMessage(Buffer.from([0x82,0x01,0xff])),/잘린/);
});
function fakeConnection(){const {EventEmitter}=require("node:events"),stream=new EventEmitter(),client=new EventEmitter();Object.assign(stream,{pause(){},resume(){},end(){},close(){stream.emit("close");}});Object.assign(client,{request:()=>stream,close(){this.closed=true;},ping(cb){cb();}});return{client,stream};}
test("stream frames wait for page commitment before advancing the resume token",async()=>{
  const {YouTubeStream}=require("../electron/youtube-stream.cjs"),{client,stream}=fakeConnection();let commit,called;
  const pageCalled=new Promise(resolve=>{called=resolve;});const transport=new YouTubeStream({token:"fixture",liveChatId:"chat",pageToken:"old",connect:()=>client,onPage:async()=>{called();await new Promise(resolve=>{commit=resolve;});}}),done=transport.start();stream.emit("response",{":status":200});const data=stringField(100602,"new"),header=Buffer.alloc(5);header.writeUInt32BE(data.length,1);stream.emit("data",Buffer.concat([header,data]));await pageCalled;assert.equal(transport.pageToken,"old");stream.emit("end");stream.emit("close");commit();assert.equal((await done).pageToken,"new");
});
test("trailers-only gRPC errors and unexpected disconnects reject for transport retry",async()=>{
  const {YouTubeStream}=require("../electron/youtube-stream.cjs");let fixture=fakeConnection(),transport=new YouTubeStream({token:"fixture",liveChatId:"chat",connect:()=>fixture.client,onPage:async()=>{}}),done=transport.start();fixture.stream.emit("response",{":status":200,"grpc-status":"16","grpc-message":"bad%20token"});fixture.stream.emit("end");await assert.rejects(done,e=>e.grpcStatus===16&&e.message==="bad token");
  fixture=fakeConnection();transport=new YouTubeStream({token:"fixture",liveChatId:"chat",connect:()=>fixture.client,onPage:async()=>{}});done=transport.start();fixture.stream.emit("close");await assert.rejects(done,/끊겼/);
});
