const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const cache=require("../scripts/build-cache.cjs"),pack=require("../scripts/package-cache.cjs");
const {publishRenderer}=require("../scripts/build.cjs");
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"streamer-build-cache-"));
 for(const folder of ["src","dist/assets","scripts","resources","electron"])fs.mkdirSync(path.join(root,folder),{recursive:true});
 fs.writeFileSync(path.join(root,"src/main.ts"),"export const value=1;");
 fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({name:"fixture",dependencies:{ws:"8"}}));
 fs.writeFileSync(path.join(root,"package-lock.json"),JSON.stringify({packages:{"node_modules/ws":{version:"8"}}}));
 fs.mkdirSync(path.join(root,"node_modules/ws"),{recursive:true});
 fs.writeFileSync(path.join(root,"node_modules/ws/index.js"),"module.exports={};");
 fs.writeFileSync(path.join(root,"dist/index.html"),"<script src='./assets/app.js'></script>");
 fs.writeFileSync(path.join(root,"dist/assets/app.js"),"checked output");
 t.after(()=>{const resolved=fs.realpathSync(root);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"streamer-build-cache-"));fs.rmSync(resolved,{recursive:true,force:true});});
 return root;
}
test("verified build cache invalidates content edits even if file timestamps are restored",t=>{
 const root=fixture(t),source=path.join(root,"src/main.ts"),stat=fs.statSync(source);
 cache.saveStamp(root,[]);assert.equal(cache.checkedBuild(root),true);
 fs.writeFileSync(source,"export const value=2;");fs.utimesSync(source,stat.atime,stat.mtime);
 assert.equal(cache.checkedBuild(root),false);assert.throws(()=>cache.assertCheckedBuild(root),/stale/);
});
test("bundle mutation, addition or deletion invalidates the checked output",t=>{
 const root=fixture(t);cache.saveStamp(root,[]);
 fs.writeFileSync(path.join(root,"dist/assets/app.js"),"tampered");assert.equal(cache.checkedBuild(root),false);
 cache.saveStamp(root,[]);fs.writeFileSync(path.join(root,"dist/extra.js"),"extra");assert.equal(cache.checkedBuild(root),false);
 cache.saveStamp(root,[]);fs.unlinkSync(path.join(root,"dist/index.html"));assert.equal(cache.checkedBuild(root),false);
});
test("external imported JSON and Vite environment changes invalidate checked builds",t=>{
 const root=fixture(t),file=path.join(root,"resources/privacy.json"),before=process.env.VITE_BUILD_CACHE_TEST;
 t.after(()=>{if(before==null)delete process.env.VITE_BUILD_CACHE_TEST;else process.env.VITE_BUILD_CACHE_TEST=before;});
 fs.writeFileSync(file,'{"policy":"one"}');cache.saveStamp(root,["resources/privacy.json"]);
 fs.writeFileSync(file,'{"policy":"two"}');assert.equal(cache.checkedBuild(root),false);
 cache.saveStamp(root,["resources/privacy.json"]);process.env.VITE_BUILD_CACHE_TEST="changed";assert.equal(cache.checkedBuild(root),false);
});
test("stamp uses the validated snapshot rather than a source changed after compilation",t=>{
 const root=fixture(t),input=cache.inputFingerprint(root);
 fs.writeFileSync(path.join(root,"src/main.ts"),"export const value=99;");
 cache.saveStamp(root,[],input);assert.equal(cache.checkedBuild(root),false);
});
test("checked output is invalidated before publication; HTML is published after its assets",t=>{
 const root=fixture(t),scratch=path.join(cache.cacheDirectory(root),"stage");
 fs.mkdirSync(path.join(scratch,"assets"),{recursive:true});fs.writeFileSync(path.join(scratch,"index.html"),"new");fs.writeFileSync(path.join(scratch,"assets/new.js"),"new asset");
 cache.saveStamp(root,[]);
 publishRenderer(root,scratch,cache.cacheDirectory(root));
 assert.equal(fs.readFileSync(path.join(root,"dist/index.html"),"utf8"),"new");
 assert.equal(fs.existsSync(path.join(root,"dist/assets/app.js")),false);
 assert.equal(cache.checkedBuild(root),false);
 cache.saveStamp(root,[]);assert.equal(cache.checkedBuild(root),true);
});
test("native modules added to production dependencies automatically retain the Electron rebuild",t=>{
 const root=fixture(t);assert.equal(pack.needsNativeRebuild(root),false);
 fs.writeFileSync(path.join(root,"node_modules/ws/binding.node"),"fixture");
 assert.equal(pack.needsNativeRebuild(root),true);
 fs.unlinkSync(path.join(root,"node_modules/ws/binding.node"));fs.unlinkSync(path.join(root,"package-lock.json"));
 assert.equal(pack.needsNativeRebuild(root),true);
});
test("asset reuse requires matching generator and every generated asset",t=>{
 const root=fixture(t);
 fs.writeFileSync(path.join(root,"scripts/generate-assets.ps1"),"generator");
 for(const file of ["build/icon.ico","build/appx/AppIcon256.png","build/appx/StoreLogo.png","build/appx/Square44x44Logo.png","build/appx/Square150x150Logo.png","build/appx/Wide310x150Logo.png","docs/store-assets/icon-300.png"]){
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),"fixture asset");
 }
 pack.recordAssets(root);assert.equal(pack.assetsFresh(root),true);
 fs.writeFileSync(path.join(root,"build/appx/AppIcon256.png"),"corrupt");assert.equal(pack.assetsFresh(root),false);
});
