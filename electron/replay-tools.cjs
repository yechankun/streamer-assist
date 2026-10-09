const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{spawn}=require("node:child_process"),{pipeline}=require("node:stream/promises"),{Readable}=require("node:stream");
const TOOLS={twitch:{repo:"lay295/TwitchDownloader",asset:"TwitchDownloaderCLI-1.56.5-Windows-x64.zip",exe:"TwitchDownloaderCLI.exe",version:"1.56.5",sha256:"8b1b0695f2b1b6bf0d2535fab4b84032951cded8cf4078dfdf4d58e391c813a0"}};
function run(exe,args,{signal,cwd,onLine=()=>{},maxOutput=4*1024*1024}={}){
  const env={};for(const name of ["PATH","Path","PATHEXT","SystemRoot","SYSTEMROOT","WINDIR","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","PROGRAMDATA","COMSPEC","NUMBER_OF_PROCESSORS","PROCESSOR_ARCHITECTURE"] )if(process.env[name])env[name]=process.env[name];env.PYTHONIOENCODING="utf-8";
  return new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd,env,windowsHide:true,shell:false,stdio:["ignore","pipe","pipe"]});let output="",failure="";
    const abort=()=>{if(process.platform==="win32"&&child.pid)spawn("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});else child.kill();};signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
    const collect=(data,error)=>{const text=data.toString();onLine(text);if(error)failure=(failure+text).slice(-16000);else{output+=text;if(output.length>maxOutput){child.kill();reject(Error("수집 도구 응답이 너무 큽니다."));}}};child.stdout.on("data",d=>collect(d,false));child.stderr.on("data",d=>collect(d,true));
    child.once("error",reject);child.once("close",code=>{signal?.removeEventListener("abort",abort);if(signal?.aborted)reject(Object.assign(Error("채팅 수집을 중단했습니다."),{name:"AbortError"}));else if(code!==0)reject(Error((failure||"다시보기 수집 도구가 종료됐습니다.").slice(-1600)));else resolve(output);});
  });
}
class ReplayTools {
  constructor(root,{fetcher=fetch,notify=()=>{}}={}){this.root=path.resolve(root,"replay-tools");fs.mkdirSync(this.root,{recursive:true});this.fetcher=fetcher;this.notify=notify;this.installing=new Map();this.controllers=new Map();}
  binary(platform){const t=TOOLS[platform];return t?path.join(this.root,platform,t.version,t.exe):null;}
  snapshot(){return Object.entries(TOOLS).map(([platform,t])=>({platform,name:"TwitchDownloaderCLI",version:t.version,installed:fs.existsSync(this.binary(platform)),busy:this.installing.has(platform)}));}
  async ensure(platform,signal){if(this.installing.has(platform))return this.installing.get(platform);const controller=new AbortController();this.controllers.set(platform,controller);const promise=this.install(platform,signal?AbortSignal.any([signal,controller.signal]):controller.signal);this.installing.set(platform,promise);this.notify();try{return await promise;}finally{this.installing.delete(platform);this.controllers.delete(platform);this.notify();}}
  async install(platform,signal){const t=TOOLS[platform];if(!t)throw Error("지원하지 않는 수집 도구입니다.");const target=this.binary(platform);if(fs.existsSync(target))return target;
    const folder=path.dirname(target);fs.mkdirSync(folder,{recursive:true});const archive=path.join(folder,t.asset+".part"),url="https://github.com/"+t.repo+"/releases/download/"+t.version+"/"+t.asset;
    try{const response=await this.fetcher(url,{signal,headers:{"User-Agent":"StreamerAssist/0.3.0"}});if(!response.ok||!response.body)throw Error("수집 도구 다운로드 HTTP "+response.status);
      const hash=crypto.createHash("sha256");let bytes=0;const source=Readable.fromWeb(response.body);source.on("data",data=>{bytes+=data.length;if(bytes>128*1024*1024)source.destroy(Error("수집 도구 파일 크기를 확인하세요."));hash.update(data);});await pipeline(source,fs.createWriteStream(archive));if(hash.digest("hex")!==t.sha256)throw Error("수집 도구 SHA-256 검증에 실패했습니다.");
      const helper=path.join(folder,"extract-helper.ps1");fs.writeFileSync(helper,fs.readFileSync(path.join(__dirname,"extract-replay-tool.ps1")));try{await run("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-File",helper,"-Archive",archive,"-Target",target],{signal});}finally{fs.rmSync(helper,{force:true});}fs.unlinkSync(archive);
      return target;
    }catch(error){fs.rmSync(archive,{force:true});throw error;}
  }
  remove(platform){if(this.installing.has(platform))throw Error("다운로드가 완료된 뒤 도구를 제거하세요.");const target=this.binary(platform);if(!target)throw Error("수집 도구를 확인하세요.");if(fs.existsSync(target))fs.unlinkSync(target);this.notify();}
  async close(){for(const controller of this.controllers.values())controller.abort();await Promise.allSettled([...this.installing.values()]);}
}
module.exports={ReplayTools,run,TOOLS};
