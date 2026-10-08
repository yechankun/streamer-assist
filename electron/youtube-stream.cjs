// Native HTTP/2 gRPC transport using Google's published stream_list.proto field
// numbers: https://developers.google.com/youtube/v3/live/streaming-live-chat
// No grpc runtime or generated toolchain is bundled into the desktop app.
const http2=require("node:http2"),zlib=require("node:zlib");
const TYPES={1:"textMessageEvent",2:"tombstone",4:"chatEndedEvent",7:"newSponsorEvent",10:"userBannedEvent",15:"superChatEvent",16:"superStickerEvent",17:"memberMilestoneChatEvent",18:"membershipGiftingEvent",19:"giftMembershipReceivedEvent",20:"pollEvent",21:"giftEvent"};
const SCHEMAS={
  response:{2:["offlineAt","s"],100602:["nextPageToken","s"],1007:["items","message",true],1008:["activePollItem","message"]},
  message:{101:["id","s"],2:["snippet","snippet"],3:["authorDetails","author"]},
  author:{10101:["channelId","s"],103:["displayName","s"],4:["isVerified","b"],5:["isChatOwner","b"],6:["isChatSponsor","b"],7:["isChatModerator","b"]},
  snippet:{1:["type","type"],301:["authorChannelId","s"],4:["publishedAt","s"],16:["displayMessage","s"],19:["textMessageDetails","text"],27:["superChatDetails","superchat"],28:["superStickerDetails","sticker"],30:["memberMilestoneChatDetails","milestone"],33:["pollDetails","poll"]},
  text:{1:["messageText","s"]},milestone:{3:["userComment","s"]},
  superchat:{1:["amountMicros","decimal"],2:["currency","s"],3:["amountDisplayString","s"],4:["userComment","s"]},
  sticker:{1:["amountMicros","decimal"],2:["currency","s"],5:["superStickerMetadata","stickerMeta"]},stickerMeta:{2:["altText","s"]},
  poll:{1:["metadata","pollMeta"],2:["status","pollStatus"]},pollMeta:{1:["questionText","s"],2:["options","pollOption",true]},pollOption:{1:["optionText","s"],2:["tally","decimal"]}
};
function varint(data,state){let value=0n,shift=0n;for(let i=0;i<10;i++){if(state.at>=data.length)throw Error("잘린 YouTube 스트리밍 응답");const b=data[state.at++];value|=BigInt(b&127)<<shift;if(!(b&128))return value;shift+=7n;}throw Error("잘못된 YouTube 정수 응답");}
function encodeVarint(value){let n=BigInt(value),bytes=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;bytes.push(b);}while(n);return Buffer.from(bytes);}
function stringField(number,text){const data=Buffer.from(text);return Buffer.concat([encodeVarint(number*8+2),encodeVarint(data.length),data]);}
function requestBytes(liveChatId,pageToken){return Buffer.concat([stringField(1,liveChatId),stringField(100,"id"),stringField(100,"snippet"),stringField(100,"authorDetails"),...(pageToken?[stringField(99,pageToken)]:[])]);}
function decodeMessage(data,schema="response",depth=0){
  if(depth>16)throw Error("복잡한 YouTube 스트리밍 응답");const state={at:0},result={},fields=SCHEMAS[schema];
  while(state.at<data.length){const tag=Number(varint(data,state)),number=tag>>>3,wire=tag&7;let raw;
    if(wire===0)raw=varint(data,state);else if(wire===2){const length=Number(varint(data,state));if(!Number.isSafeInteger(length)||length<0||state.at+length>data.length)throw Error("잘못된 YouTube 응답 길이");raw=data.subarray(state.at,state.at+length);state.at+=length;}
    else if(wire===1||wire===5){state.at+=wire===1?8:4;if(state.at>data.length)throw Error("잘린 YouTube 응답");continue;}else throw Error("지원하지 않는 YouTube 응답 인코딩");
    const field=fields[number];if(!field)continue;const [name,type,repeated]=field;let value;
    if(type==="s")value=raw.toString("utf8");else if(type==="b")value=raw!==0n;else if(type==="decimal")value=raw.toString();else if(type==="type")value=TYPES[Number(raw)]||"unknown";else if(type==="pollStatus")value=["unknown","active","closed"][Number(raw)]||"unknown";else value=decodeMessage(raw,type,depth+1);
    if(repeated)(result[name]||=[]).push(value);else result[name]=value;
  }return result;
}
class YouTubeStream {
  constructor({token,liveChatId,pageToken,onPage,onReady=()=>{},connect=http2.connect}){Object.assign(this,{token,liveChatId,pageToken,onPage,onReady,connect});this.closed=false;}
  start(){return new Promise((resolve,reject)=>{
    const client=this.client=this.connect("https://youtube.googleapis.com"),stream=this.stream=client.request({":method":"POST",":path":"/youtube.api.v3.V3DataLiveChatMessageService/StreamList","content-type":"application/grpc","te":"trailers","authorization":"Bearer "+this.token,"grpc-accept-encoding":"gzip"});let buffer=Buffer.alloc(0),status=0,detail="",settled=false,ending=false,chain=Promise.resolve();
    const connectTimer=setTimeout(()=>fail(Error("YouTube 스트리밍 연결 시간이 초과됐습니다.")),30000);connectTimer.unref?.();
    const finish=error=>{if(settled)return;settled=true;clearTimeout(connectTimer);clearInterval(this.ping);client.close();error?reject(error):resolve({pageToken:this.pageToken,closed:this.closed});};
    const fail=error=>{stream.close();finish(error);};client.on("error",fail);stream.on("error",fail);
    stream.on("response",headers=>{clearTimeout(connectTimer);if(headers[":status"]!==200){fail(Object.assign(Error("YouTube 스트리밍 HTTP "+headers[":status"]),{status:headers[":status"]}));return;}if(headers["grpc-status"]){status=Number(headers["grpc-status"]);try{detail=decodeURIComponent(headers["grpc-message"]||"");}catch{detail="";}}this.onReady();});
    stream.on("trailers",headers=>{status=Number(headers["grpc-status"]||0);try{detail=decodeURIComponent(headers["grpc-message"]||"");}catch{detail="";}});
    stream.on("data",chunk=>{stream.pause();chain=chain.then(async()=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=5){const size=buffer.readUInt32BE(1);if(size>16*1024*1024)throw Error("YouTube 채팅 응답이 너무 큽니다.");if(buffer.length<size+5)break;const flag=buffer[0],raw=buffer.subarray(5,size+5);buffer=buffer.subarray(size+5);const data=decodeMessage(flag===1?zlib.gunzipSync(raw,{maxOutputLength:16*1024*1024}):raw);await this.onPage(data);if(data.nextPageToken)this.pageToken=data.nextPageToken;}stream.resume();}).catch(fail);});
    stream.on("end",()=>{ending=true;void chain.then(()=>{if(status)finish(Object.assign(Error(detail||"YouTube 스트리밍 연결 종료"),{grpcStatus:status}));else if(buffer.length)finish(Error("YouTube 스트리밍 응답이 잘렸습니다."));else finish();});});
    stream.on("close",()=>{if(!settled&&!ending)finish(this.closed?null:Error("YouTube 스트리밍 연결이 끊겼습니다. 재연결합니다."));});client.on("close",()=>{if(!settled&&!ending)finish(this.closed?null:Error("YouTube 스트리밍 세션이 종료됐습니다."));});this.ping=setInterval(()=>{try{if(!client.destroyed&&!client.closed)client.ping(error=>{if(error&&!this.closed)fail(error);});}catch(error){fail(error);}},20000);this.ping.unref?.();
    const payload=requestBytes(this.liveChatId,this.pageToken),header=Buffer.alloc(5);header.writeUInt32BE(payload.length,1);stream.end(Buffer.concat([header,payload]));
  });}
  disconnect(){this.closed=true;clearInterval(this.ping);this.stream?.close();this.client?.close();}
}
module.exports={YouTubeStream,decodeMessage,requestBytes,encodeVarint,stringField};
