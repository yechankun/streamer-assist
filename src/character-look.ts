import catalog from "./assets/characters/parts-v3.json";
import expansion from "./assets/characters/parts-v4-extra.json";
import tones from "./assets/characters/parts-tones.json";
import palettes from "./assets/characters/color-palettes.json";

export type CharacterPart = "body" | "hair" | "top" | "bottom" | "hat" | "accessory";
export type CharacterTintPart = Exclude<CharacterPart, "body">;
export type CharacterTint = keyof typeof palettes.colors;
export type CharacterColors = Record<CharacterTintPart, CharacterTint> & { scheme: string };
export type CharacterLook = { body: number; hair: number; top: number; bottom: number; hat: number | null; accessory: number | null; colors?: CharacterColors };
export const characterTints = palettes.colors;
export const characterColorSchemes = palettes.schemes;
export const characterAtlases = { core: { file: "winner-parts-v3.png", size: catalog.sourceSize }, ...expansion.atlases };
export type CharacterAtlas = keyof typeof characterAtlases;
export type SpritePart = { id: string; atlas: CharacterAtlas; src: number[]; dest: number[]; hairCutoff?: number; toneRange?: number[] };
export const characterParts: Record<CharacterPart, SpritePart[]> = {
  body: [], hair: [], top: [], bottom: [], hat: [], accessory: [],
};
for (const category of Object.keys(characterParts) as CharacterPart[]) {
  characterParts[category].push(...catalog.groups[category].map(part => ({ ...part, atlas: "core" as const })));
  if (category !== "body") characterParts[category].push(...expansion.groups[category].map(part => ({ ...part, atlas: part.atlas as CharacterAtlas })));
  if (category !== "body") for (const part of characterParts[category]) part.toneRange = tones[part.id as keyof typeof tones];
}
export const characterCombinations = characterParts.body.length * characterParts.hair.length * characterParts.top.length * characterParts.bottom.length * (characterParts.hat.length + 1) * (characterParts.accessory.length + 1);

// Each category has its own hash channel: choosing a hairstyle does not pick a
// matching canned outfit. No names, accounts, network or selection RNG is used.
function hash(seed: string, part: string) {
  let value = 2166136261;
  for (const char of seed + "\0" + part) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}
export function selectCharacter(seed: string): CharacterLook {
  const pick = (part: CharacterPart) => hash(seed, part) % characterParts[part].length;
  // Optional hats/accessories leave the hair and clothes visible half the time.
  const optional = (part: "hat" | "accessory") => hash(seed, part + "-visible") % 2 ? pick(part) : null;
  const scheme = characterColorSchemes[hash(seed, "color-scheme") % (characterColorSchemes.length + 1)];
  let colors: CharacterColors | undefined;
  // One slot keeps the artist's original colors; other slots mix coordinated
  // colors independently of shape selection and independently for each part.
  if (scheme) {
    const tint = (part: CharacterTintPart) => scheme[part][hash(seed, "tint-" + part) % scheme[part].length] as CharacterTint;
    colors = { scheme: scheme.id, hair: tint("hair"), top: tint("top"), bottom: tint("bottom"), hat: tint("hat"), accessory: tint("accessory") };
  }
  return { body:pick("body"), hair:pick("hair"), top:pick("top"), bottom:pick("bottom"), hat:optional("hat"), accessory:optional("accessory"), ...(colors ? { colors } : {}) };
}
export function characterKey(look: CharacterLook) {
  return (["body","hair","top","bottom","hat","accessory"] as const).map(part => part + ":" + (look[part] === null ? "none" : characterParts[part][look[part]!].id + (part === "body" ? "" : ":" + (look.colors?.[part] ?? "original")))).join("|");
}
