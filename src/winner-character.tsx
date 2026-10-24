import { useId, useMemo } from "react";
import partsAtlas from "./assets/characters/winner-parts-v3.png";
import casualAtlas from "./assets/characters/winner-parts-v4-casual.png";
import cozyAtlas from "./assets/characters/winner-parts-v4-cozy-clean.png";
import { characterAtlases, characterKey, characterParts, selectCharacter, type CharacterLook, type CharacterPart, type CharacterTintPart } from "./character-look";
import { characterColorFilter } from "./character-palette";
import "./winner-character.css";

const atlasImages = { core: partsAtlas, casual: casualAtlas, cozy: cozyAtlas };

export function CharacterToggle({ enabled, disabled, onChange }: { enabled: boolean; disabled?: boolean; onChange: (enabled: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={enabled} aria-label="픽셀 캐릭터로 당첨자 표시"
    title={"픽셀 캐릭터로 당첨자 표시 · " + (enabled ? "켜짐" : "꺼짐")} disabled={disabled}
    className={"icon-button winner-character-toggle" + (enabled ? " enabled" : "")} onClick={() => onChange(!enabled)}>
    <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M5 2h10v2h2v12h-2v2H5v-2H3V4h2zm0 4v8h2v2h6v-2h2V6z" />
      <path d="M7 8h2v3H7zm4 0h2v3h-2zM8 13h4v1H8z" />
    </svg>
  </button>;
}

function SpriteLayer({ category, index, colorFilter }: { category: CharacterPart; index: number; colorFilter?: string }) {
  const part = characterParts[category][index], [x,y,width,height] = part.dest;
  const [sourceWidth, sourceHeight] = characterAtlases[part.atlas].size;
  return <svg x={x} y={y} width={width} height={height} viewBox={part.src.join(" ")} preserveAspectRatio="none" overflow="hidden" data-part-id={part.id}>
    <image href={atlasImages[part.atlas]} width={sourceWidth} height={sourceHeight} data-atlas={part.atlas} filter={colorFilter} />
  </svg>;
}

export function CharacterSprite({ look }: { look: CharacterLook }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Open-top headwear keeps the complete hair silhouette beneath it.
  const hairCutoff = look.hat === null ? -4 : characterParts.hat[look.hat].hairCutoff ?? 22;
  const filterFor = (part: CharacterTintPart) => look.colors ? "url(#" + id + "-" + part + "-color)" : undefined;
  return <svg className="winner-pixel-character" viewBox="0 -4 128 164" focusable="false" aria-hidden="true">
    <defs>
      {look.colors && (["hair", "top", "bottom", "hat", "accessory"] as const).map(part => {
        const index = look[part];
        if (index === null) return null;
        const piece = characterParts[part][index], filter = characterColorFilter(piece.toneRange!, look.colors![part]);
        // The filter region is the source part, never the complete atlas. SVG
        // filters otherwise paint neighboring sprites outside the viewport.
        return <filter key={part} id={id + "-" + part + "-color"} filterUnits="userSpaceOnUse" x={piece.src[0]} y={piece.src[1]} width={piece.src[2]} height={piece.src[3]} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={filter.matrix} />
          <feComponentTransfer><feFuncR type="table" tableValues={filter.channels[0]} /><feFuncG type="table" tableValues={filter.channels[1]} /><feFuncB type="table" tableValues={filter.channels[2]} /></feComponentTransfer>
        </filter>;
      })}
      <clipPath id={id + "-hair-back"}><rect x="0" y={hairCutoff} width="128" height="168" /></clipPath>
      <clipPath id={id + "-hair-front"}><rect x="0" y={hairCutoff} width="128" height={80 - hairCutoff} /></clipPath>
      <clipPath id={id + "-skin"}><rect x="0" y="0" width="128" height="77" /><rect x="29" y="105" width="16" height="12" /><rect x="91" y="105" width="16" height="12" /></clipPath>
    </defs>
    <g data-character-layer="hair-back" clipPath={"url(#" + id + "-hair-back)"}><SpriteLayer category="hair" index={look.hair} colorFilter={filterFor("hair")} /></g>
    <g data-character-layer="body"><SpriteLayer category="body" index={look.body} /></g>
    <g data-character-layer="bottom"><SpriteLayer category="bottom" index={look.bottom} colorFilter={filterFor("bottom")} /></g>
    <g data-character-layer="top"><SpriteLayer category="top" index={look.top} colorFilter={filterFor("top")} /></g>
    <g clipPath={"url(#" + id + "-skin)"}><SpriteLayer category="body" index={look.body} /></g>
    <g data-character-layer="hair" clipPath={"url(#" + id + "-hair-front)"}><SpriteLayer category="hair" index={look.hair} colorFilter={filterFor("hair")} /></g>
    {look.hat !== null && <g data-character-layer="hat"><SpriteLayer category="hat" index={look.hat} colorFilter={filterFor("hat")} /></g>}
    {look.accessory !== null && <g data-character-layer="accessory"><SpriteLayer category="accessory" index={look.accessory} colorFilter={filterFor("accessory")} /></g>}
  </svg>;
}

export function WinnerCharacter({ seed, messageCount, active }: { seed: string; messageCount: number; active: boolean }) {
  const look = useMemo(() => selectCharacter(seed), [seed]);
  return <div className="winner-character-stage" aria-hidden="true" data-outfit={characterKey(look)} data-active={active} data-composite="parts-v4">
    <div className="character-halo" />
    <div className="character-shadow" />
    <div className="character-portrait"><CharacterSprite look={look} /></div>
    {active && messageCount > 0 && <span key={messageCount} className="character-chat-response" />}
  </div>;
}
