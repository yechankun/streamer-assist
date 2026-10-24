const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache=new Map();
module.exports=function load(name){
  if(cache.has(name))return cache.get(name);
  const file=path.join(__dirname,'../src',name),module={exports:{}},nativeRequire=require('node:module').createRequire(file);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const requireFile=request=>request.endsWith('.png')?request:request.endsWith('.css')?{}:request==='./character-look'?load('character-look.ts'):request==='./character-v9-images'?load('character-v9-images.ts'):request==='./character-palette'?load('character-palette.ts'):request==='./character-raster'?load('character-raster.ts'):request==='./layered-character'?load('layered-character.tsx'):nativeRequire(request);
  new Function('require','module','exports',source)(requireFile,module,module.exports);cache.set(name,module.exports);return module.exports;
};
