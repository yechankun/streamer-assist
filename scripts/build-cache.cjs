const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const ROOT=path.resolve(__dirname,"..");
const CACHE_VERSION=1;
function files(directory,ancestors=new Set()) {
  if(!fs.existsSync(directory))return [];
  const real=fs.realpathSync(directory);
  if(ancestors.has(real))throw Error("A cyclic directory link is not a build input.");
  const seen=new Set(ancestors);seen.add(real);
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const full=path.join(directory,entry.name),stat=entry.isSymbolicLink()?fs.statSync(full):entry;
    return stat.isDirectory()?files(full,seen):stat.isFile()?[full]:[];
  }).sort();
}
function hashFiles(list,root) {
  const hash=crypto.createHash("sha256");
  for(const file of [...new Set(list)].sort()){
    hash.update(path.relative(root,file).replaceAll("\\","/"));hash.update("\0");
    hash.update(fs.existsSync(file)?fs.readFileSync(file):"<missing>");hash.update("\0");
  }
  return hash;
}
function inputFingerprint(root=ROOT,dependencies=[]) {
  const sources=[
    ...files(path.join(root,"src")),...files(path.join(root,"public")),
    ...["index.html","vite.config.ts","vite.config.js","tsconfig.json","package.json","package-lock.json",
      "electron/platform-info.json","resources/privacy.json","scripts/build.cjs","scripts/build-cache.cjs"]
      .map(file=>path.join(root,file)),
    ...fs.readdirSync(root).filter(n=>/^\.env(?:\.|$)/.test(n)).map(n=>path.join(root,n)),
    ...dependencies.map(file=>path.resolve(root,file))
  ];
  const hash=hashFiles(sources,root);
  const names=new Set(["NODE_ENV","BROWSERSLIST_ENV",...Object.keys(process.env).filter(n=>n.startsWith("VITE_")&&n!=="VITE_USER_NODE_ENV")]);
  // Track static process.env references used by app/config sources as well.
  for(const file of sources.filter(file=>/\.[cm]?[jt]sx?$/.test(file)&&!file.includes(path.sep+"scripts"+path.sep)&&fs.existsSync(file))){
    const source=fs.readFileSync(file,"utf8");
    for(const match of source.matchAll(/process\.env(?:\.([A-Za-z_]\w*)|\[["']([A-Za-z_]\w*)["']\])/g))names.add(match[1]||match[2]);
  }
  const environment=Object.fromEntries([...names].sort().map(n=>[n,n==="NODE_ENV"?(process.env[n]||"production"):(process.env[n]??null)]));
  hash.update(JSON.stringify({version:CACHE_VERSION,node:process.version,platform:process.platform,arch:process.arch,environment}));
  return hash.digest("hex");
}
function outputFingerprint(directory) {
  const list=files(directory);
  if(!list.length || !fs.existsSync(path.join(directory,"index.html")))return null;
  return hashFiles(list,directory).digest("hex");
}
function cacheDirectory(root=ROOT) {
  const directory=path.join(root,".build-cache");
  if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error("Build cache cannot be a linked directory.");
  fs.mkdirSync(directory,{recursive:true});
  return directory;
}
function readStamp(root=ROOT) {
  try{return JSON.parse(fs.readFileSync(path.join(root,".build-cache/renderer.json"),"utf8"));}catch{return null;}
}
function checkedBuild(root=ROOT) {
  const stamp=readStamp(root);
  return !!stamp && stamp.version===CACHE_VERSION &&
    stamp.input===inputFingerprint(root,stamp.dependencies) &&
    stamp.output===outputFingerprint(path.join(root,"dist"));
}
function assertCheckedBuild(root=ROOT) {
  if(!checkedBuild(root))throw Error("Renderer output is missing, changed or stale. Run npm run build first.");
}
function saveStamp(root,dependencies,input=inputFingerprint(root,dependencies)) {
  const directory=cacheDirectory(root);
  const stamp={version:CACHE_VERSION,input,output:outputFingerprint(path.join(root,"dist")),dependencies};
  if(!stamp.output)throw Error("Renderer output is incomplete.");
  const file=path.join(directory,"renderer.json");
  fs.writeFileSync(file+".tmp",JSON.stringify(stamp));fs.renameSync(file+".tmp",file);
  return stamp;
}
function removeScratch(directory,cacheRoot) {
  if(!fs.existsSync(directory))return;
  const resolved=fs.realpathSync(directory),allowed=fs.realpathSync(cacheRoot)+path.sep;
  if(fs.lstatSync(directory).isSymbolicLink()||!resolved.startsWith(allowed))throw Error("Build cleanup escaped its cache directory.");
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
module.exports={ROOT,CACHE_VERSION,files,inputFingerprint,outputFingerprint,cacheDirectory,readStamp,checkedBuild,assertCheckedBuild,saveStamp,removeScratch};
