const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const m=require('./load-character.cjs')('character-look.ts'),kit=require('../src/assets/characters/modular-v9/kit.json');
const root=path.join(__dirname,'../src/assets/characters/modular-v9'),cache=new Map();
function decode(id){
 if(cache.has(id))return cache.get(id);
 const png=fs.readFileSync(path.join(root,kit.assets[id].file)),width=png.readUInt32BE(16),height=png.readUInt32BE(20);
 if(png[24]!==8||png[25]!==6)throw Error('Expected RGBA8 source '+id);
 let at=8,idat=[];while(at<png.length){const n=png.readUInt32BE(at);if(png.toString('ascii',at+4,at+8)==='IDAT')idat.push(png.subarray(at+8,at+8+n));at+=n+12;}
 const raw=zlib.inflateSync(Buffer.concat(idat)),stride=width*4,pixels=Buffer.alloc(height*stride);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let i=0;i<stride;i++){const at=y*stride+i,a=i>=4?pixels[at-4]:0,b=y?pixels[at-stride]:0,c=y&&i>=4?pixels[at-stride-4]:0,n=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):NaN;if(!Number.isFinite(n))throw Error('Unknown PNG row filter');pixels[at]=(raw[y*(stride+1)+i+1]+n)&255;}}
 const result={width,height,pixels};cache.set(id,result);return result;
}
function pixel(id,x,y){const p=decode(id);if(x<0||y<0||x>=p.width||y>=p.height)return[0,0,0,0];return[...p.pixels.subarray((Math.floor(y)*p.width+Math.floor(x))*4,(Math.floor(y)*p.width+Math.floor(x))*4+4)];}
function sample(look,x,y){let owner=null,rgba=[0,0,0,0];for(const layer of m.characterLayers(look)){const[dx,dy,s=1]=layer.source.placement,p=pixel(layer.id,(x-dx)/s,(y-dy)/s);if(p[3]>=220){owner=layer.id;rgba=p;}}return{owner,rgba};}
const skinRects=id=>[...kit.assets[id].skinPath.matchAll(/M(\d+),(\d+)h(\d+)v(\d+)h-\d+z/g)].map(x=>x.slice(1).map(Number));
const skinContains=(id,x,y)=>skinRects(id).some(([sx,sy,w,h])=>x>=sx&&x<sx+w&&y>=sy&&y<sy+h);
module.exports={m,kit,root,decode,pixel,sample,skinRects,skinContains};
