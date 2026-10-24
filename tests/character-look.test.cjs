const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function loadModel(name){
  const file=path.join(__dirname,'../src',name),model={exports:{}};
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',compiled)(require('node:module').createRequire(file),model,model.exports);
  return model.exports;
}
const {selectCharacter,characterKey,characterParts,characterAtlases,characterCombinations,characterTints,characterColorSchemes}=loadModel('character-look.ts');
const {characterColorFilter}=loadModel('character-palette.ts');

test('winner appearance is repeatable, independently composed and substantially exceeds a fixed cast',()=>{
  const seen=new Set(),pairs=new Map(),categories={};
  for(let i=0;i<6000;i++){
    const seed='draw-'+i,look=selectCharacter(seed);
    assert.deepEqual(selectCharacter(seed),look,'reopening the draw keeps its parts');
    seen.add(characterKey(look));
    for(const part of Object.keys(characterParts)){
      (categories[part]??=new Set()).add(look[part]);
      if(look[part]!==null)assert.ok(Number.isInteger(look[part])&&look[part]>=0&&look[part]<characterParts[part].length);
    }
    const tops=pairs.get(look.hair)??new Set();tops.add(look.top);pairs.set(look.hair,tops);
  }
  assert.equal(characterCombinations,4320000);
  assert.ok(seen.size>5500,'the generator does not pick a small list of preset people');
  assert.equal(categories.body.size,5);
  for(const part of ['hair','top','bottom'])assert.equal(categories[part].size,15,'all three collections are sampled');
  for(const part of ['hat','accessory']){assert.equal(categories[part].size,16);assert.ok(categories[part].has(null));}
  for(const tops of pairs.values())assert.equal(tops.size,15,'each hairstyle can appear with every top across collections');
});

test('every modular source frame is inside the atlas and has a finite placement',()=>{
  for(const atlas of Object.values(characterAtlases)){
    const png=fs.readFileSync(path.join(__dirname,'../src/assets/characters',atlas.file));
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],atlas.size,'catalog dimensions match the actual bundled PNG');
  }
  const ids=new Set();
  for(const pieces of Object.values(characterParts))for(const piece of pieces){
    const [width,height]=characterAtlases[piece.atlas].size;
    const [x,y,w,h]=piece.src;
    assert.ok(!ids.has(piece.id),'part identifiers are unique');ids.add(piece.id);
    assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height,piece.id);
    assert.equal(piece.dest.length,4);assert.ok(piece.dest.every(Number.isFinite));
    assert.ok(piece.dest[2]>0&&piece.dest[3]>0);
    if(piece.hairCutoff!==undefined)assert.ok(Number.isFinite(piece.hairCutoff)&&piece.hairCutoff>=-4&&piece.hairCutoff<80);
  }
});

test('palette choices are repeatable and varied independently of hairstyle and clothes',()=>{
  const schemes=new Set(),hairTints=new Map(),topTints=new Map();let original=0;
  for(let i=0;i<6000;i++){
    const seed='palette-draw-'+i,look=selectCharacter(seed);
    assert.deepEqual(selectCharacter(seed).colors,look.colors);
    if(!look.colors){original++;continue;}
    schemes.add(look.colors.scheme);
    const scheme=characterColorSchemes.find(s=>s.id===look.colors.scheme);assert.ok(scheme);
    for(const category of ['hair','top','bottom','hat','accessory']){
      assert.ok(characterTints[look.colors[category]],'only defined palette colors are selected');
      assert.ok(scheme[category].includes(look.colors[category]),'colors stay in the coordinated scheme');
    }
    for(const [category,map] of [['hair',hairTints],['top',topTints]]){
      const tints=map.get(look[category])??new Set();tints.add(look.colors[category]);map.set(look[category],tints);
    }
    assert.notEqual(characterKey(look),characterKey({...look,colors:undefined}),'appearance identity includes visible colors');
  }
  assert.equal(schemes.size,8);assert.ok(original>0,'original artwork colors are still available');
  for(const [category,map] of [['hair',hairTints],['top',topTints]]){
    const available=new Set(characterColorSchemes.flatMap(scheme=>scheme[category])).size;
    assert.ok(available>=6);assert.equal(map.size,15);
    for(const tints of map.values())assert.equal(tints.size,available,'each shape can use every color allowed for that category');
  }
});

test('all colored parts preserve alpha and ordered shading across the palette',()=>{
  for(const [category,pieces] of Object.entries(characterParts))for(const piece of pieces){
    if(category==='body'){assert.equal(piece.toneRange,undefined,'skin has no recoloring metadata');continue;}
    assert.equal(piece.toneRange.length,2);
    const [low,high]=piece.toneRange;assert.ok(Number.isFinite(low)&&Number.isFinite(high)&&low>=0&&low<high&&high<=1,piece.id);
    for(const tint of Object.keys(characterTints)){
      const filter=characterColorFilter(piece.toneRange,tint),matrix=filter.matrix.split(' ').map(Number);
      assert.equal(matrix.length,20);assert.ok(matrix.every(Number.isFinite));
      assert.deepEqual(matrix.slice(15),[0,0,0,1,0],'transparency is unchanged');
      for(const channel of filter.channels){const shades=channel.split(' ').map(Number);assert.equal(shades.length,9);assert.ok(shades.every((value,i)=>value>=0&&value<=1&&(i===0||value>=shades[i-1])),'light and dark details remain ordered');}
    }
  }
});
