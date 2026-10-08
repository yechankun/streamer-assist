const fs=require("node:fs"),path=require("node:path"),readline=require("node:readline");
const {videoReference,youtubeReplay,twitchReplay,chzzkReplay,jsonArrayObjects}=require("./replay-parsers.cjs"),{run}=require("./replay-tools.cjs");
const {parseStartedAt}=require("./broadcast-monitor.cjs");
const wait=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted){reject(Object.assign(Error("수집 중단"),{name:"AbortError"}));return;}const timer=setTimeout(done,ms);function done(){signal?.removeEventListener("abort",abort);resolve();}function abort(){clearTimeout(timer);reject(Object.assign(Error("수집 중단"),{name:"AbortError"}));}signal?.addEventListener("abort",abort,{once:true});});
class ReplayProviders {
  constructor({auth,tools,fetcher=fetch,requestsPerSecond=2}={}){Object.assign(this,{auth,tools,fetcher,requestsPerSecond});}
  async json(url,signal,headers={}){for(let attempt=0;;attempt++){let response;try{response=await this.fetcher(url,{headers:{"User-Agent":"Mozilla/5.0 StreamerAssist/0.3.0",...headers},signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(30000)])});}catch(error){if(signal?.aborted||attempt>=4)throw error;await wait(1000*2**attempt,signal);continue;}if(response.ok)return response.json();if(attempt>=4||!(response.status===429||response.status>=500))throw Error("다시보기 조회 HTTP "+response.status);const retry=Number(response.headers?.get("retry-after"));await wait(Math.min(30000,retry>0?retry*1000:1000*2**attempt),signal);}}
  async discover(session,signal){
    const result=[],seen=new Set(),sources=session.sources||[];
    const add=value=>{const key=value.platform+":"+value.videoId;if(!seen.has(key)){seen.add(key);result.push(value);}};
    for(const source of sources){
      if(source.platform==="youtube"&&/^[\w-]{11}$/.test(source.broadcastId||""))add({...videoReference("https://www.youtube.com/watch?v="+source.broadcastId),startedAt:source.startedAt||session.startedAt,match:"broadcast-id"});
      else if(source.platform==="twitch"&&/^\d+$/.test(source.channelId||"")){
        const headers={Authorization:"Bearer "+await this.auth.getAccess("twitch"),"Client-Id":this.auth.config.twitchClientId};let cursor;
        do{const data=await this.json("https://api.twitch.tv/helix/videos?user_id="+source.channelId+"&type=archive&first=100"+(cursor?"&after="+encodeURIComponent(cursor):""),signal,headers);
          for(const video of data.data||[]){const at=Date.parse(video.created_at);if(video.stream_id===source.broadcastId&&/^\d+$/.test(video.id))add({...videoReference("https://www.twitch.tv/videos/"+video.id),startedAt:at,match:"stream-id",title:video.title});}
          const oldest=data.data?.at(-1);cursor=oldest&&Date.parse(oldest.created_at)>=session.startedAt-86400000?data.pagination?.cursor:null;if(cursor)await wait(1000/this.requestsPerSecond,signal);
        }while(cursor);
      }else if(source.platform==="chzzk"&&/^[a-f0-9]{32}$/i.test(source.channelId||"")){
        let page=0;const visited=new Set();for(;;){
          const data=await this.json("https://api.chzzk.naver.com/service/v1/channels/"+source.channelId+"/videos?pagingType=PAGE&page="+page+"&size=50&sortType=LATEST&videoType=REPLAY",signal);
          const videos=data.content?.data||data.content?.videos;if(data.code!==200||!Array.isArray(videos))throw Error("치지직 다시보기 목록 형식을 확인할 수 없습니다.");if(!videos.length)break;
          const signature=videos.map(v=>v.videoNo).join(",");if(visited.has(signature))throw Error("치지직 다시보기 목록 페이지가 반복됐습니다.");visited.add(signature);let oldest=Infinity;
          for(const video of videos){const at=parseStartedAt(video.liveOpenDate||video.openDate,"chzzk",Date.now());if(at)oldest=Math.min(oldest,at);const exact=source.broadcastId!=null&&String(video.liveId||"")===String(source.broadcastId);
            if((exact||at&&Math.abs(at-(source.startedAt||session.startedAt))<60000)&&video.videoNo)add({...videoReference("https://chzzk.naver.com/video/"+video.videoNo),startedAt:at||source.startedAt||session.startedAt,match:exact?"live-id":"start-time",title:video.videoTitle});
          }
          if(oldest<session.startedAt-86400000||Number.isFinite(data.content.totalPages)&&page+1>=data.content.totalPages)break;page++;await wait(1000/this.requestsPerSecond,signal);
        }
      }
    }
    return result.sort((a,b)=>a.startedAt-b.startedAt);
  }
  async *collect(source,{signal,work,onProgress=()=>{},cursor=0}={}){
    if(source.platform==="chzzk"){
      const detail=await this.json("https://api.chzzk.naver.com/service/v3/videos/"+source.videoId,signal),video=detail.content;if(detail.code!==200||!video)throw Error("치지직 다시보기가 없거나 접근할 수 없습니다.");
      if(video.videoChatEnabled===false)throw Error("이 치지직 영상은 다시보기 채팅을 제공하지 않습니다.");
      source.startedAt=parseStartedAt(video.liveOpenDate||video.openDate,"chzzk",Date.now())||source.startedAt;let position=Number(cursor)||0;
      for(;;){if(signal?.aborted)throw Object.assign(Error("수집 중단"),{name:"AbortError"});
        const data=await this.json("https://api.chzzk.naver.com/service/v1/videos/"+source.videoId+"/chats?playerMessageTime="+position+"&previousVideoChatSize=50",signal);if(data.code!==200||!data.content)throw Error("치지직 다시보기 채팅이 제공되지 않습니다.");
        const lists=[data.content.previousVideoChats,data.content.videoChats];if(!lists.some(Array.isArray)||lists.some(value=>value!=null&&!Array.isArray(value)))throw Error("치지직 다시보기 채팅 응답 형식이 변경됐습니다. 수집기 업데이트가 필요합니다.");
        const rows=[...(data.content.previousVideoChats||[]),...(data.content.videoChats||[])],messages=rows.map(row=>chzzkReplay(row,source)).filter(Boolean),next=data.content.nextPlayerMessageTime;
        if(next!=null&&(!Number.isFinite(next)||next<=position))throw Error("치지직 채팅 페이지가 전진하지 않습니다. 저장된 위치에서 재시도하세요.");
        yield{messages,cursor:next??position,source,terminal:next==null,verification:"unofficial-pagination"};onProgress({cursor:position});
        if(next==null)return;position=next;await wait(1000/this.requestsPerSecond,signal);
      }
    }
    const binary=await this.tools.ensure(source.platform,signal);fs.mkdirSync(work,{recursive:true});
    if(source.platform==="youtube"){
      const metadata=JSON.parse(await run(binary,["--ignore-config","--no-cache-dir","--skip-download","--dump-single-json","--",source.url],{signal,maxOutput:16*1024*1024}));
      if(metadata.is_live||metadata.live_status==="is_live")throw Object.assign(Error("방송 종료 후 다시보기 채팅이 준비될 때 수집할 수 있습니다."),{replayCode:"not-ready"});
      if(!metadata.subtitles?.live_chat)throw Object.assign(Error("이 영상에는 다시보기 채팅이 없거나 아직 준비되지 않았습니다."),{replayCode:"not-ready"});
      source.startedAt=Number.isFinite(metadata.release_timestamp)?metadata.release_timestamp*1000:source.startedAt;
      await run(binary,["--ignore-config","--no-cache-dir","--skip-download","--write-subs","--sub-langs","live_chat","--sleep-requests",String(1/this.requestsPerSecond),"--retries","5","--fragment-retries","5","-o",path.join(work,"chat.%(ext)s"),"--",source.url],{signal,onLine:line=>onProgress({message:line.slice(-200)})});
      const name=fs.readdirSync(work).find(name=>/^chat.*live_chat.*\.json$/.test(name));if(!name)throw Error("YouTube 다시보기 채팅 파일을 찾을 수 없습니다.");let number=0;
      const lines=readline.createInterface({input:fs.createReadStream(path.join(work,name)),crlfDelay:Infinity});try{for await(const line of lines){if(signal?.aborted)throw Object.assign(Error("수집 중단"),{name:"AbortError"});if(line.length>8*1024*1024)throw Error("다시보기 채팅 응답이 너무 큽니다.");if(!line.trim())continue;number++;if(number<=cursor)continue;const data=JSON.parse(line);const actions=data.actions||data.continuationContents?.liveChatContinuation?.actions||[];yield{messages:youtubeReplay({actions},source),cursor:number,source,verification:"youtube-chat-replay"};}}finally{lines.close();}
    }else{
      const file=path.join(work,"chat.json");await run(binary,["chatdownload","--id",source.videoId,"-o",file,"--threads","1","--temp-path",work,"--collision","Overwrite","--banner=false"],{signal,onLine:line=>onProgress({message:line.slice(-200)})});
      let number=0,batch=[];for await(const row of jsonArrayObjects(fs.createReadStream(file))){if(signal?.aborted)throw Object.assign(Error("수집 중단"),{name:"AbortError"});number++;if(number<=cursor)continue;const message=twitchReplay(row,source);if(message)batch.push(message);if(batch.length>=200){yield{messages:batch,cursor:number,source,verification:"twitch-vod-internal"};batch=[];await wait(5,signal);}}
      if(batch.length)yield{messages:batch,cursor:number,source,verification:"twitch-vod-internal"};
    }
  }
}
module.exports={ReplayProviders,wait};
