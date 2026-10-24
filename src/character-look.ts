import kit from './assets/characters/modular-v9/kit.json';
import palettes from './assets/characters/color-palettes.json';

export type CharacterPart='body'|'hair'|'top'|'bottom'|'hat'|'accessory';
export type CharacterTintPart=Exclude<CharacterPart,'body'>;
export type CharacterTint=keyof typeof palettes.colors;
export type CharacterColors=Record<CharacterTintPart,CharacterTint>&{scheme:string};
export type CharacterLook={body:number;hair:number;top:number;bottom:number;hat:number|null;accessory:number|null;footwear?:number;colors?:CharacterColors};
export type SpritePart={id:string;label:string;defaultTint:CharacterTint;back:string[];front:string[];coveredFront?:string[];coversHair?:boolean;blockedAccessories?:string[]};
export type CharacterSource={file:string;sha256:string;width:number;height:number;bounds:number[];placement:number[];skinPath:string};
export type CharacterLayer={name:string;id:string;source:CharacterSource;color:string;tint?:CharacterTint;skin:number};
export const characterTints=palettes.colors;
export const characterColorSchemes=palettes.schemes;
export const characterNativeSize=kit.canvas;
export const characterViewport=kit.viewport;
export const characterAnchors=kit.anchors;
export const characterSources=kit.assets as Record<string,CharacterSource>;
export const characterSkinColors=kit.skinColors.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
export const characterSkinSource=kit.skinSource;
const skinLabels=['밝은 피부','따뜻한 피부','갈색 피부','짙은 피부','복숭아빛 피부'];
export const characterParts:Record<CharacterPart,SpritePart[]>={
 body:skinLabels.map((label,i)=>({id:'skin-'+i,label,defaultTint:'walnut',back:[],front:['head']})),
 hair:kit.groups.hair.map(p=>({...p,coveredFront:['hair-covered']})) as SpritePart[],
 top:kit.groups.top as SpritePart[],bottom:kit.groups.bottom as SpritePart[],
 hat:kit.groups.hat as SpritePart[],accessory:kit.groups.accessory as SpritePart[],
};
export const characterFootwear=kit.groups.footwear as SpritePart[];
export const characterAccessoryIndices=characterParts.accessory.map((_,i)=>i);
export const characterRig={faceEyes:Object.fromEntries(characterParts.body.map(p=>[p.id,kit.anchors.eyes]))};
export function isCharacterAccessoryCompatible(top:number,accessory:number|null){
 if(accessory===null)return true;
 const p=characterParts.accessory[accessory];
 return !!p&&!!characterParts.top[top]&&!characterParts.top[top].blockedAccessories?.includes(p.id);
}
export function compatibleCharacterLook(look:CharacterLook):CharacterLook{
 return isCharacterAccessoryCompatible(look.top,look.accessory)?look:{...look,accessory:null};
}
export const characterCombinations=characterParts.body.length*characterParts.hair.length*characterParts.bottom.length*(characterParts.hat.length+1)*characterFootwear.length*
 characterParts.top.reduce((n,_,top)=>n+1+characterAccessoryIndices.filter(a=>isCharacterAccessoryCompatible(top,a)).length,0);
export function characterAccessoryFor(look:CharacterLook){return look.accessory===null||!isCharacterAccessoryCompatible(look.top,look.accessory)?null:characterParts.accessory[look.accessory];}

// Each asset has one documented registration, shared by every combination.
// Depth is anatomical; no runtime image slicing or silhouette fitting is used.
export function characterLayers(input:CharacterLook):CharacterLayer[]{
 const look=compatibleCharacterLook(input),hair=characterParts.hair[look.hair],top=characterParts.top[look.top],bottom=characterParts.bottom[look.bottom];
 const hat=look.hat===null?null:characterParts.hat[look.hat],accessory=characterAccessoryFor(look),shoe=characterFootwear[look.footwear??0];
 const result:CharacterLayer[]=[];
 const add=(name:string,ids:string[]|undefined,tint?:CharacterTint)=>{
  for(const id of ids??[]){const source=characterSources[id];if(!source)throw new Error('Unknown character source: '+id);result.push({name,id,source,tint,color:tint??'original',skin:look.body});}
 };
 const hairTint=look.colors?.hair??(hat?.coversHair?hair.defaultTint:undefined);
 add('top-back',top.back,look.colors?.top);
 add('hat-back',hat?.back,look.colors?.hat);
 add('hair-back',hair.back,hairTint);
 add('bottom-back',bottom.back,look.colors?.bottom);
 add('bottom',bottom.front,look.colors?.bottom);
 add('footwear',shoe.front);
 add('top',top.front,look.colors?.top);
 add('accessory-back',accessory?.back,look.colors?.accessory);
 add('head',['head']);
 add('accessory',accessory?.front,look.colors?.accessory);
 add('hair',hat?.coversHair?hair.coveredFront:hair.front,hairTint);
 add('hat',hat?.front,look.colors?.hat);
 return result;
}
function hash(seed:string,part:string){let h=2166136261;for(const c of seed+'\0'+part)h=Math.imul(h^c.charCodeAt(0),16777619);h=Math.imul(h^(h>>>16),0x85ebca6b);h=Math.imul(h^(h>>>13),0xc2b2ae35);return(h^(h>>>16))>>>0;}
export function selectCharacter(seed:string):CharacterLook{
 const pick=(part:CharacterPart)=>hash(seed,part)%characterParts[part].length;
 const optional=(part:'hat'|'accessory')=>hash(seed,part+'-visible')%2?pick(part):null;
 const scheme=characterColorSchemes[hash(seed,'color-scheme')%(characterColorSchemes.length+1)];let colors:CharacterColors|undefined;
 if(scheme){const tint=(part:CharacterTintPart)=>scheme[part][hash(seed,'tint-'+part)%scheme[part].length] as CharacterTint;colors={scheme:scheme.id,hair:tint('hair'),top:tint('top'),bottom:tint('bottom'),hat:tint('hat'),accessory:tint('accessory')};}
 const top=pick('top');let accessory=optional('accessory');
 if(!isCharacterAccessoryCompatible(top,accessory)){const allowed=characterAccessoryIndices.filter(a=>isCharacterAccessoryCompatible(top,a));accessory=allowed[hash(seed,'compatible-accessory')%allowed.length];}
 return{body:pick('body'),hair:pick('hair'),top,bottom:pick('bottom'),hat:optional('hat'),accessory,footwear:hash(seed,'footwear')%characterFootwear.length,...(colors?{colors}:{})};
}
export function characterKey(input:CharacterLook){const look=compatibleCharacterLook(input);return(['body','hair','top','bottom','hat','accessory']as const).map(p=>p+':'+(look[p]===null?'none':characterParts[p][look[p]!].id+(p==='body'?'':':'+(look.colors?.[p]??'original')))).join('|')+'|footwear:'+characterFootwear[look.footwear??0].id;}
