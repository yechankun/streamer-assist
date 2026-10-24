import React,{useEffect}from'react';
import{createRoot}from'react-dom/client';
import{LayeredCharacterSprite}from'../../../src/layered-character';
import{characterColorSchemes,type CharacterColors,type CharacterLook,type CharacterTint}from'../../../src/character-look';
import pkg from'../../../package.json';
const base:CharacterLook={body:0,hair:3,top:0,bottom:0,footwear:0,hat:3,accessory:0};
function App(){
 useEffect(()=>{(async()=>{await document.fonts.ready;const urls=new Set([...document.querySelectorAll<SVGImageElement>('image')].map(i=>i.href.baseVal));await Promise.all([...urls].map(async src=>{const i=new Image();i.src=src;await i.decode();}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));(window as any).paletteReady=true;})();},[]);
 const items=[{label:'원래 색',look:base},...characterColorSchemes.map(s=>{const colors={scheme:s.id}as CharacterColors;for(const p of['hair','top','bottom','hat','accessory']as const)colors[p]=s[p][0]as CharacterTint;return{label:s.label,look:{...base,colors}};})];
 return<main><header><span>STREAMER ASSIST · v{pkg.version}</span><h1>같은 의상 · 8개 색상 팔레트</h1><p>앱의 캐릭터 합성 그대로, 부품과 피부색을 유지한 색상 비교</p></header><section>{items.map(item=><article className="palette-card" key={item.label}><div className="portrait"><LayeredCharacterSprite look={item.look}/></div><strong>{item.label}</strong></article>)}</section></main>;
}createRoot(document.getElementById('root')!).render(<App/>);
