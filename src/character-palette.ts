import palettes from "./assets/characters/color-palettes.json";
import type { CharacterTint } from "./character-look";

const rgb = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
const outline = rgb("#1d1b25"), paper = rgb("#f4e8d5");
const mix = (a: number[], b: number[], weight: number) => a.map((value, i) => value * (1 - weight) + b[i] * weight);

// Recolor the existing skin paint without resampling or moving its silhouette.
export function characterSkinMatrix(source: number[], target: number[]) {
  return [target[0]/source[0],0,0,0,0, 0,target[1]/source[1],0,0,0, 0,0,target[2]/source[2],0,0, 0,0,0,1,0].join(" ");
}

// Normalize each source part's paint values before applying the same curated
// palette. Source alpha, skin layers and the original PNG files are untouched.
export function characterColorFilter(range: number[], tint: CharacterTint) {
  const base = rgb(palettes.colors[tint]);
  const steps = [outline, mix(outline, base, .12), mix(outline, base, .3), mix(outline, base, .56), mix(outline, base, .82), base, mix(base, paper, .12), mix(base, paper, .3), paper];
  const scale = .7 / Math.max(.1, range[1] - range[0]), offset = .08 - range[0] * scale;
  const row = [.2126 * scale, .7152 * scale, .0722 * scale, 0, offset];
  return {
    matrix: [...row, ...row, ...row, 0, 0, 0, 1, 0].join(" "),
    channels: [0, 1, 2].map(channel => steps.map(color => color[channel].toFixed(5)).join(" ")),
  };
}
