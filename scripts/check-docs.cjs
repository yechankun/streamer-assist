const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
function files(directory){
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const full=path.join(directory,entry.name);
  return entry.isDirectory()?files(full):/\.(md|html)$/.test(entry.name)?[full]:[];
 });
}
function slug(value){
 return value.replace(/<[^>]+>/g,"").replace(/[*_]/g,"").trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,"").replace(/\s/g,"-");
}
function anchors(file){
 const text=fs.readFileSync(file,"utf8"),result=new Set(),counts=new Map();
 for(const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)){
  const id=slug(match[1]),count=counts.get(id)||0;result.add(id+(count?"-"+count:""));counts.set(id,count+1);
 }
 for(const match of text.matchAll(/\bid=["']([^"']+)["']/g))result.add(match[1]);
 return result;
}
let checked=0,errors=[];
for(const file of [...files(path.join(root,"docs")),...["README.md","README.ko.md","CONTRIBUTING.md"].map(name=>path.join(root,name))]){
 const text=fs.readFileSync(file,"utf8").replace(/\x60{3}[\s\S]*?\x60{3}/g,"");
 const links=[...text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(match=>match[1])
  .concat([...text.matchAll(/\b(?:href|src|srcset)=["']([^"']+)["']/g)].map(match=>match[1]));
 for(const link of links){
  if(/^(https?:|mailto:|data:|app:|\/\/)/i.test(link))continue;
  const [pathname,fragment]=link.replace(/^<|>$/g,"").split("#");
  const target=pathname?path.resolve(path.dirname(file),decodeURIComponent(pathname)):file;
  if(!fs.existsSync(target)){errors.push(path.relative(root,file)+": missing "+link);continue;}
  if(fragment && /\.(md|html)$/.test(target) && !anchors(target).has(decodeURIComponent(fragment)))
   errors.push(path.relative(root,file)+": missing anchor "+link);
  checked++;
 }
}
if(errors.length){console.error(errors.join("\n"));process.exitCode=1;}
else console.log("PASS: "+checked+" local documentation links, images and anchors.");
