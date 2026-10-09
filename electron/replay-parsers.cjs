const crypto=require("node:crypto");
function videoReference(input){
  if(typeof input!=="string"||input.length>2048)throw Error("다시보기 주소를 확인하세요.");
  let u;try{u=new URL(input.trim());}catch{throw Error("YouTube·Twitch·치지직 다시보기 주소를 입력하세요.");}
  if(u.protocol!=="https:"||u.username||u.password)throw Error("HTTPS 다시보기 주소를 사용하세요.");
  const host=u.hostname.toLowerCase();let platform,id;
  if(["www.youtube.com","youtube.com","m.youtube.com","youtu.be"].includes(host)){platform="youtube";id=host==="youtu.be"?u.pathname.slice(1):u.searchParams.get("v")||u.pathname.match(/^\/(?:live|shorts)\/([\w-]+)/)?.[1];if(!/^[\w-]{11}$/.test(id||""))throw Error("YouTube 영상 주소를 확인하세요.");}
  else if(["www.twitch.tv","twitch.tv"].includes(host)){platform="twitch";id=u.pathname.match(/^\/videos\/(\d+)\/?$/)?.[1];if(!id)throw Error("Twitch 다시보기 영상 주소를 입력하세요.");}
  else if(host==="chzzk.naver.com"){platform="chzzk";id=u.pathname.match(/^\/video\/(\d+)\/?$/)?.[1];if(!id)throw Error("치지직 다시보기 영상 주소를 입력하세요.");}
  else throw Error("지원하는 다시보기 플랫폼을 선택하세요.");
  return{platform,videoId:id,url:platform==="youtube"?"https://www.youtube.com/watch?v="+id:platform==="twitch"?"https://www.twitch.tv/videos/"+id:"https://chzzk.naver.com/video/"+id};
}
function twitchReplay(row,source){
  if(!row||typeof row._id!=="string"||!row.message)return null;
  const timestamp=Date.parse(row.created_at),offset=Number(row.content_offset_seconds)*1000;
  const text=typeof row.message.body==="string"?row.message.body:(row.message.fragments||[]).map(f=>f.text||"").join("");
  if(!text)return null;
  return{platform:"twitch",id:row._id,userId:row.commenter?._id||row.commenter?.id||null,name:row.commenter?.display_name||row.commenter?.name||"",text,timestamp:Number.isFinite(timestamp)?timestamp:source.startedAt+offset,subscriber:(row.message.user_badges||[]).some(b=>["subscriber","founder"].includes(b._id)),roles:(row.message.user_badges||[]).map(b=>b._id).filter(Boolean),replay:true,videoId:source.videoId,offsetMs:offset};
}
function chzzkReplay(row,source){
  if(typeof row?.content!=="string")return null;let profile={},extras={};try{profile=typeof row.profile==="string"?JSON.parse(row.profile):row.profile||{};extras=typeof row.extras==="string"?JSON.parse(row.extras):row.extras||{};}catch{}
  const offset=Number(row.playerMessageTime),original=Number(row.messageTime),userId=row.userIdHash||profile.userIdHash||null;
  if(!Number.isFinite(offset))return null;
  const id=row.messageId||crypto.createHash("sha256").update(JSON.stringify([source.videoId,userId,original,offset,row.messageTypeCode,row.content,row.extras])).digest("hex");
  const amount=Number(extras.payAmount),donation=Number.isSafeInteger(amount)&&amount>0&&Number.isSafeInteger(amount*1000000);
  return{platform:"chzzk",id:String(id),userId,name:profile.nickname||"",text:row.content,timestamp:Number.isFinite(original)&&original>0?original:source.startedAt+offset,subscriber:profile.subscriptionMonths>0,replay:true,videoId:source.videoId,offsetMs:offset,...(donation?{kind:"donation",currency:"KRW",amountMicros:amount*1000000,providerType:"replay"}:{})};
}
async function *jsonArrayObjects(stream,property="comments"){
  const decoder=new(require("node:string_decoder").StringDecoder)("utf8");
  let inString=false,escaped=false,depth=0,string="",key=null,afterColon=false,targetDepth=null,objectDepth=null,parts=[],found=false;
  for await(const buffer of stream){const chunk=decoder.write(Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer));let start=objectDepth!==null?0:-1;
    for(let i=0;i<chunk.length;i++){const c=chunk[i];
      if(inString){if(escaped){escaped=false;if(objectDepth===null)string+=c;}else if(c==="\\"){escaped=true;if(objectDepth===null)string+=c;}else if(c==='"'){inString=false;if(depth===1&&objectDepth===null)key=string;}else if(objectDepth===null)string+=c;continue;}
      if(c==='"'){inString=true;string="";continue;}
      if(c===':'){afterColon=true;continue;}
      if(c==='['){depth++;if(afterColon&&key===property&&depth===2){targetDepth=depth;found=true;}afterColon=false;}
      else if(c==='{'){depth++;if(targetDepth!==null&&depth===targetDepth+1&&objectDepth===null){objectDepth=depth;parts=[];start=i;}}
      else if(c==='}'){if(objectDepth!==null&&depth===objectDepth){parts.push(chunk.slice(start,i+1));const text=parts.join("");if(text.length>4*1024*1024)throw Error("다시보기 메시지가 너무 큽니다.");yield JSON.parse(text);objectDepth=null;parts=[];start=-1;}depth--;}
      else if(c===']'){if(depth===targetDepth){targetDepth=null;return;}depth--;}
      else if(c===','){afterColon=false;key=null;}
    }if(objectDepth!==null&&start>=0){parts.push(chunk.slice(start));if(parts.reduce((n,p)=>n+p.length,0)>4*1024*1024)throw Error("다시보기 메시지가 너무 큽니다.");}
  }
  if(objectDepth!==null||targetDepth!==null)throw Error("다시보기 채팅 파일이 끝까지 다운로드되지 않았습니다.");
  if(!found)throw Error("다시보기 채팅 파일의 comments 배열을 확인하세요.");
}
module.exports={videoReference,twitchReplay,chzzkReplay,jsonArrayObjects};
