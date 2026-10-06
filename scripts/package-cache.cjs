const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const { cacheDirectory }=require("./build-cache.cjs");
const assetFiles=["build/icon.ico","build/appx/AppIcon256.png","build/appx/StoreLogo.png","build/appx/Square44x44Logo.png","build/appx/Square150x150Logo.png","build/appx/Wide310x150Logo.png","docs/store-assets/icon-300.png"];
const digest=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function assetState(root){
  return {source:digest(path.join(root,"scripts/generate-assets.ps1")),files:Object.fromEntries(assetFiles.map(file=>[file,fs.existsSync(path.join(root,file))?digest(path.join(root,file)):null]))};
}
function assetsFresh(root){
  try{return JSON.stringify(assetState(root))===fs.readFileSync(path.join(root,".build-cache/assets.json"),"utf8");}catch{return false;}
}
function recordAssets(root){
  fs.writeFileSync(path.join(cacheDirectory(root),"assets.json"),JSON.stringify(assetState(root)));
}
function nativeFiles(directory){
  if(!fs.existsSync(directory))return true;
  return fs.readdirSync(directory,{withFileTypes:true}).some(entry=>{
    if(entry.name==="node_modules")return false;
    const full=path.join(directory,entry.name);
    return entry.isDirectory()?nativeFiles(full):/\.node$/.test(entry.name)||entry.name==="binding.gyp";
  });
}
function needsNativeRebuild(root){
  try{
    const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
    const lock=JSON.parse(fs.readFileSync(path.join(root,"package-lock.json"),"utf8"));
    const modules=Object.entries(lock.packages||{}).filter(([name,info])=>name.startsWith("node_modules/")&&!info.dev);
    if(Object.keys(pkg.dependencies||{}).length&&!modules.length)return true;
    return modules.some(([name,info])=>info.hasInstallScript||info.gypfile||nativeFiles(path.join(root,name)));
  }catch{return true;}
}
module.exports={assetsFresh,recordAssets,needsNativeRebuild};
