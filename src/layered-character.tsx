import{useId}from'react';
import{characterImages}from'./character-v9-images';
import{characterLayers,characterNativeSize,characterViewport,characterSkinColors,characterSkinSource,type CharacterLook,type CharacterTint,type CharacterSource}from'./character-look';
import{characterSkinMatrix}from'./character-palette';
import palettes from'./assets/characters/color-palettes.json';
import './character-idle.css';
const rgb=(s:string)=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16)/255);
function ramp(tint:CharacterTint){const ink=rgb('#030824'),base=rgb(palettes.colors[tint]),paper=rgb('#fff4dc'),mix=(a:number[],b:number[],n:number)=>a.map((v,i)=>v*(1-n)+b[i]*n);const steps=[ink,ink,mix(ink,base,.4),mix(ink,base,.65),mix(ink,base,.85),base,mix(base,paper,.3),mix(base,paper,.65),paper,paper];return[0,1,2].map(c=>steps.map(s=>s[c].toFixed(5)).join(' '));}
export function LayeredCharacterSprite({look,only,artwork,idle=false}:{look:CharacterLook;only?:readonly string[];idle?:boolean;artwork?:{sources:Record<string,CharacterSource>;images:Record<string,string>}}){
 const uid=useId().replace(/:/g,'-'),[width,height]=characterNativeSize,layers=characterLayers(look);
 const shoe=layers.find(layer=>layer.name==='footwear')!.source;
 // One foot-anchored parent rig keeps every anatomical join and depth unchanged.
 const ground=shoe.placement[1]+shoe.bounds[3]*(shoe.placement[2]??1),center=characterViewport[0]+characterViewport[2]/2;
 return <svg className="winner-pixel-character" viewBox={characterViewport.join(' ')} focusable="false" aria-hidden="true" data-layered-kit="9" data-source-canvas={width+'x'+height} data-character-idle={idle&&!only?'true':'false'}>
  <g transform={'translate('+center+' '+ground+')'} data-character-ground={ground}>
  <g className="character-idle-breath" data-character-rig="global">
  <g transform={'translate('+(-center)+' '+(-ground)+')'}>
  {layers.filter(l=>!only||only.includes(l.name)).map((layer,i)=>{
   const id=uid+'-'+i,skinId=id+'-skin',materialId=id+'-paint',maskId=id+'-mask',source=artwork?.sources[layer.id]??layer.source,[x,y,scale=1]=source.placement,href=artwork?.images[layer.id]??characterImages[layer.id],skin=!!source.skinPath&&(look.body!==0||!!layer.tint);
   const channels=layer.tint?ramp(layer.tint):undefined;
   return <g key={layer.id} data-character-layer={layer.name} data-part-id={layer.id} data-color={layer.color} transform={'translate('+x+' '+y+') scale('+scale+')'}>
    {(skin||channels)&&<defs>
     {skin&&<><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}><path d={source.skinPath} fill="white"/></mask><filter id={skinId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values={characterSkinMatrix(characterSkinSource,characterSkinColors[look.body])}/></filter></>}
     {channels&&<filter id={materialId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values=".2126 .7152 .0722 0 0 .2126 .7152 .0722 0 0 .2126 .7152 .0722 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="table" tableValues={channels[0]}/><feFuncG type="table" tableValues={channels[1]}/><feFuncB type="table" tableValues={channels[2]}/></feComponentTransfer></filter>}
    </defs>}
    <image href={href} width={source.width} height={source.height} filter={channels?'url(#'+materialId+')':undefined}/>
    {skin&&<image href={href} width={source.width} height={source.height} mask={'url(#'+maskId+')'} filter={'url(#'+skinId+')'} data-skin-only="true"/>}
   </g>;
  })}
  </g></g></g>
 </svg>;
}
