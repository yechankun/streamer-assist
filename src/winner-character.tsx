import {useMemo} from "react";
import {characterKey,selectCharacter,type CharacterLook} from "./character-look";
import {LayeredCharacterSprite} from "./layered-character";
import "./winner-character.css";
export const CharacterSprite=LayeredCharacterSprite;
export function CharacterToggle({enabled,disabled,onChange}:{enabled:boolean;disabled?:boolean;onChange:(enabled:boolean)=>void}){
 return <button type="button" role="switch" aria-checked={enabled} aria-label="픽셀 캐릭터로 당첨자 표시"
  title={"픽셀 캐릭터로 당첨자 표시 · "+(enabled?"켜짐":"꺼짐")} disabled={disabled}
  className={"icon-button winner-character-toggle"+(enabled?" enabled":"")} onClick={()=>onChange(!enabled)}>
  <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true"><path d="M5 2h10v2h2v12h-2v2H5v-2H3V4h2zm0 4v8h2v2h6v-2h2V6z"/><path d="M7 8h2v3H7zm4 0h2v3h-2zM8 13h4v1H8z"/></svg>
 </button>;
}
export function WinnerCharacter({seed,messageCount,active}:{seed:string;messageCount:number;active:boolean}){
 const look:CharacterLook=useMemo(()=>selectCharacter(seed),[seed]);
 return <div className="winner-character-stage" aria-hidden="true" data-outfit={characterKey(look)} data-active={active} data-composite="retro-v9-artwork">
  <div className="character-halo"/><div className="character-shadow"/><div className="character-portrait"><CharacterSprite look={look}/></div>
  {active&&messageCount>0&&<span key={messageCount} className="character-chat-response"/>}
 </div>;
}
