const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=function check(){
 const{m,kit,root,sample,skinContains}=require('./character-pixel-fixture.cjs');
 for(const[id,s]of Object.entries(kit.assets)){const bytes=fs.readFileSync(path.join(root,s.file));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),s.sha256,id+' source bytes changed');assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],[s.width,s.height]);}
 const base={body:0,hair:0,top:0,bottom:0,footwear:0,hat:null,accessory:null};let looks=0;
 for(let hair=0;hair<6;hair++)for(const hat of[null,0,1,2,3])for(let top=0;top<6;top++)for(const accessory of[null,0,1]){
  const look={...base,hair,hat,top,accessory};for(const[x,y]of[[452,646],[670,647]])assert.equal(sample(look,x,y).owner,'head',JSON.stringify(look)+': eye must remain visible');looks++;
 }
 for(let top=0;top<6;top++){const id=m.characterParts.top[top].front[0];for(const[x,y]of[[561,789],[373,1030],[748,1030]])assert.ok(skinContains(id,x,y),id+': neck and integrated hands have designated skin paint');assert.equal(skinContains(id,561,900),false,'garment is outside skin mask');}
 for(let bottom=0;bottom<4;bottom++)for(let footwear=0;footwear<4;footwear++)for(const x of[460,666])assert.equal(sample({...base,bottom,footwear},x,1220).owner,m.characterFootwear[footwear].front[0],'footwear covers lower-leg overlap');
 return{sources:Object.keys(kit.assets).length,looks,upperBodies:6};
};
