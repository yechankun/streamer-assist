const test=require('node:test'),assert=require('node:assert/strict');
const{m,kit,skinContains,pixel}=require('./character-pixel-fixture.cjs');
test('cosmetic selection is deterministic, diverse and compatible with the selected top',()=>{
 const sets=Object.fromEntries(['body','hair','top','bottom','hat','accessory','footwear'].map(k=>[k,new Set()])),keys=new Set();
 for(let i=0;i<6000;i++){const l=m.selectCharacter('v9-'+i);assert.deepEqual(l,m.selectCharacter('v9-'+i));assert.equal(m.isCharacterAccessoryCompatible(l.top,l.accessory),true);for(const k in sets)sets[k].add(l[k]);keys.add(m.characterKey(l));}
 assert.deepEqual(Object.fromEntries(Object.entries(sets).map(([k,s])=>[k,s.size])),{body:5,hair:6,top:6,bottom:4,hat:5,accessory:7,footwear:4});assert.ok(keys.size>5500);assert.equal(m.characterCombinations,93600);
});
test('all sources have fixed registration shared by every combination and anatomical depth',()=>{
 const base={body:0,hair:4,top:4,bottom:3,footwear:0,hat:3,accessory:0},layers=m.characterLayers(base),order=layers.map(l=>l.name);
 for(const[a,b]of[['top-back','hair-back'],['hat-back','hair-back'],['hair-back','bottom'],['bottom','footwear'],['footwear','top'],['top','head'],['head','accessory'],['accessory','hair'],['hair','hat']])assert.ok(order.indexOf(a)<order.indexOf(b),a+' before '+b);
 assert.deepEqual(m.characterLayers({...base,body:4}).map(l=>l.source),layers.map(l=>l.source));assert.equal(layers.find(l=>l.name==='hair').id,'hair-covered');
 for(const source of Object.values(kit.assets))assert.ok(source.placement.length>=2&&source.placement.length<=3&&source.placement.every(Number.isFinite));
});
test('hood excludes obstructing neck accessories and retired torso bags stay removed',()=>{
 const top=m.characterParts.top.findIndex(p=>p.id==='hoodie');
 for(const id of['headphones','bowtie','scarf']){const a=m.characterParts.accessory.findIndex(p=>p.id===id);assert.equal(m.isCharacterAccessoryCompatible(top,a),false);}
 assert.ok(m.characterParts.accessory.every(p=>!['satchel','round-pouch','camera','lanyard'].includes(p.id)));
});
test('skin masks preserve eyes, mouth and colored fabric',()=>{
 assert.equal(skinContains('head',452,646),false);assert.equal(skinContains('head',560,710),false);assert.equal(skinContains('head',560,650),true);
 assert.equal(skinContains('top-cardigan',460,880),false);
 for(const id of Object.keys(kit.assets))if(kit.assets[id].skinPath){assert.ok(kit.assets[id].skinPath.length>50);assert.ok(pixel(id,0,0)[3]===0);}
});
const atWorld=(id,x,y)=>{const[dx,dy,scale=1]=kit.assets[id].placement;return pixel(id,(x-dx)/scale,(y-dy)/scale);};
test('both glasses keep the full pupil areas transparent',()=>{
 for(const id of ['prop-round-glasses','prop-square-glasses'])for(const cx of [452,670])for(const dx of [-10,10])for(const y of [627,668])assert.ok(atWorld(id,cx+dx,y)[3]<64,id+': glasses must not paint over a pupil edge');
});
test('near and far earflaps are separate complete sources and neck band arches behind nape',()=>{
 assert.ok(atWorld('hat-earflap-front',300,650)[3]>220);
 assert.equal(atWorld('hat-earflap-front',850,650)[3],0,'far flap is absent from front artwork');
 assert.ok(atWorld('hat-earflap-back',850,650)[3]>220,'far flap has solid lining in its own rear source');
 assert.ok(atWorld('prop-headphones-back',561,790)[3]>220,'headphone band rises behind nape');
 assert.equal(atWorld('prop-headphones-back',561,850)[3],0,'rear band must not hang across the front chest');
});
