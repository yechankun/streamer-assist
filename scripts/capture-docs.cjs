const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {spawn}=require("node:child_process");
const {buildRenderer}=require("./build.cjs");
async function main(){
 await buildRenderer();
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),"streamer-doc-capture-"));
 try{
  await new Promise((resolve,reject)=>{
   const args=[require.resolve("electron/cli.js"),path.join(__dirname,"capture-readme.cjs")];
   if(process.argv.includes("--store"))args.push("--store");
   const child=spawn(process.execPath,args,{stdio:"inherit",windowsHide:true,env:{...process.env,STREAMER_ASSIST_CAPTURE_PROFILE:profile}});
   child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(Error("Capture exited with "+code)));
  });
 }finally{
  const resolved=fs.realpathSync(profile);
  if(!resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"streamer-doc-capture-")||fs.lstatSync(profile).isSymbolicLink())throw Error("Invalid capture cleanup path.");
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:200});
 }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
