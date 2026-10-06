const fs=require("node:fs"),path=require("node:path");
const { spawn }=require("node:child_process");
const { performance }=require("node:perf_hooks");
const cache=require("./build-cache.cjs");
const compiler=require.resolve("typescript/lib/tsc.js");
function publishRenderer(root,staging,cacheRoot) {
  const dist=path.join(root,"dist");
  if(fs.existsSync(dist)&&fs.lstatSync(dist).isSymbolicLink())throw Error("Renderer output cannot be a linked directory.");
  fs.mkdirSync(dist,{recursive:true});
  const resolved=fs.realpathSync(dist);
  if(!resolved.startsWith(fs.realpathSync(root)+path.sep))throw Error("Renderer output escaped the project.");
  const previous=cache.files(dist),next=cache.files(staging),keep=new Set(next.map(file=>path.relative(staging,file)));
  const stamp=path.join(cacheRoot,"renderer.json");
  if(fs.existsSync(stamp))fs.unlinkSync(stamp);
  // Copy small checked bundles; publish index last, using same-directory atomic
  // file replacement. Windows can keep directory handles open in editors.
  for(const source of next.sort((a,b)=>Number(path.basename(a)==="index.html")-Number(path.basename(b)==="index.html"))){
    const destination=path.join(dist,path.relative(staging,source));
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.copyFileSync(source,destination+".build.tmp");
    fs.renameSync(destination+".build.tmp",destination);
  }
  for(const obsolete of previous)if(!keep.has(path.relative(dist,obsolete)))fs.unlinkSync(obsolete);
}
async function buildRenderer({root=cache.ROOT,force=false}={}) {
  const start=performance.now(),cacheRoot=cache.cacheDirectory(root);
  if(!force&&cache.checkedBuild(root)){
    console.log("Renderer unchanged: verified cached type-check and bundle.");
    return {cached:true,milliseconds:Math.round(performance.now()-start)};
  }
  const lock=path.join(cacheRoot,"renderer.lock");
  let held=false;
  const deadline=Date.now()+120000;
  while(!held){
    try{
      const fd=fs.openSync(lock,"wx");fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);held=true;
    }catch(error){
      if(error.code!=="EEXIST")throw error;
      let owner;
      try{owner=JSON.parse(fs.readFileSync(lock,"utf8"));}catch{
        if(Date.now()-fs.statSync(lock).mtimeMs<2000){await new Promise(resolve=>setTimeout(resolve,50));continue;}
      }
      let alive=false;
      if(Number.isInteger(owner?.pid)&&owner.pid>0){
        try{process.kill(owner.pid,0);alive=true;}catch(error){alive=error.code==="EPERM";}
      }
      if(!alive){fs.unlinkSync(lock);continue;}
      if(Date.now()>deadline)throw Error("Another renderer build is still running.");
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  const staging=path.join(cacheRoot,"renderer-"+process.pid+"-"+Date.now());
  try{
    if(!force&&cache.checkedBuild(root))return {cached:true,milliseconds:Math.round(performance.now()-start)};
    const oldDependencies=cache.readStamp(root)?.dependencies||[];
    const input=cache.inputFingerprint(root,oldDependencies),wallStart=Date.now(),dependencies=new Set();

    const typeCheck=new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[compiler,"--noEmit","--incremental","--tsBuildInfoFile",path.join(cacheRoot,"typescript.tsbuildinfo")],
        {cwd:root,stdio:"inherit",windowsHide:true});
      child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(Error("TypeScript check failed ("+code+").")));
    });

    const bundle=import("vite").then(({build})=>build({
      root,base:"./",build:{outDir:staging,emptyOutDir:true},
      plugins:[{
        name:"checked-build-inputs",
        configResolved(config){
          for(const file of config.configFileDependencies||[])dependencies.add(file);
        },
        generateBundle(){
          for(const file of [...this.getModuleIds(),...this.getWatchFiles()]){
            const clean=file.split("?")[0];
            if(!clean.includes("node_modules")&&fs.existsSync(clean)&&fs.statSync(clean).isFile())dependencies.add(clean);
          }
        }
      }]
    }));
    const results=await Promise.allSettled([typeCheck,bundle]);
    const failure=results.find(result=>result.status==="rejected");
    if(failure)throw failure.reason;
    if(input!==cache.inputFingerprint(root,oldDependencies) ||
       [...dependencies].some(file=>fs.statSync(file).mtimeMs>wallStart))
      throw Error("Build inputs changed during compilation. Run the build again.");
    const watched=[...dependencies].map(file=>path.relative(root,file)).sort();
    const checkedInput=cache.inputFingerprint(root,watched);
    publishRenderer(root,staging,cacheRoot);
    cache.saveStamp(root,watched,checkedInput);
    const milliseconds=Math.round(performance.now()-start);
    console.log("Checked renderer build: "+milliseconds+"ms (type checking and bundling in parallel).");
    return {cached:false,milliseconds};
  }finally{
    cache.removeScratch(staging,cacheRoot);
    if(held)fs.unlinkSync(lock);
  }
}
async function main(){
  const result=await buildRenderer({force:process.argv.includes("--force")});
  fs.mkdirSync(path.join(cache.ROOT,"release"),{recursive:true});
  fs.writeFileSync(path.join(cache.ROOT,"release/renderer-build-timings.json"),JSON.stringify(result,null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={buildRenderer,publishRenderer};
