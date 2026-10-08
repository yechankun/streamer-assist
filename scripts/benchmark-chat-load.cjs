const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{spawn}=require("node:child_process");
async function main(){
  const args=process.argv.slice(2),option=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
  const rate=Number(option("--rate","20000")),seconds=Number(option("--seconds","10")),users=Number(option("--users","1000")),mode=option("--mode","live");
  if(![10000,20000,50000].includes(rate)||seconds<2||seconds>120||!Number.isInteger(users)||users<1||!["live","deferred","replay"].includes(mode))throw Error("Use rate 10000/20000/50000, seconds 2–120 and mode live/deferred/replay.");
  const root=path.resolve(__dirname,".."),profile=fs.mkdtempSync(path.join(os.tmpdir(),"capture-load-benchmark-")),output=path.resolve(option("--output",path.join(root,"release/chat-load-"+mode+"-"+rate+".json")));
  try{for(const file of [path.join(__dirname,"chat-load-app.cjs"),...fs.readdirSync(path.join(root,"electron")).filter(f=>f.endsWith(".cjs")).map(f=>path.join(root,"electron",f))])new(require("node:vm").Script)(require("node:module").wrap(fs.readFileSync(file,"utf8")),{filename:file});
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[require.resolve("electron/cli.js"),path.join(__dirname,"chat-load-app.cjs")],{cwd:root,windowsHide:true,stdio:"inherit",env:{...process.env,CAPTURE_LOAD_PROFILE:profile,CAPTURE_LOAD_RATE:String(rate),CAPTURE_LOAD_SECONDS:String(seconds),CAPTURE_LOAD_USERS:String(users),CAPTURE_LOAD_MODE:mode,CAPTURE_LOAD_OUTPUT:output}});const timer=setTimeout(()=>{child.kill();reject(Error("Load benchmark timed out"));},(seconds+180)*1000);child.once("error",reject);child.once("exit",code=>{clearTimeout(timer);code===0?resolve():reject(Error("Benchmark exit "+code));});});
  }finally{const resolved=fs.realpathSync(profile);if(!resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"capture-load-benchmark-")||fs.lstatSync(profile).isSymbolicLink())throw Error("Unsafe benchmark cleanup");fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
