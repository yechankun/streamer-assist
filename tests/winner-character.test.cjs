const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),load=require('./load-character.cjs');
const{CharacterSprite}=load('winner-character.tsx'),m=load('character-look.ts'),base={body:0,hair:0,top:0,bottom:0,hat:null,accessory:null,footwear:0};
const render=look=>renderToStaticMarkup(React.createElement(CharacterSprite,{look}));
test('accepted baseline uses the approved PNG sources without replacement drawing or color filters',()=>{
 const svg=render(base);assert.match(svg,/data-layered-kit="9"/);assert.match(svg,/modular-v9/);assert.doesNotMatch(svg,/<filter|<mask|clipPath/);assert.match(svg,/hair-swept-front/);
});
test('skin and palette changes use semantic color masks without changing anatomical sources',()=>{
 const look={...base,body:3,colors:{scheme:'test',hair:'rose',top:'sage',bottom:'ink',hat:'ochre',accessory:'teal'}},svg=render(look);
 assert.match(svg,/data-skin-only="true"/);assert.match(svg,/feColorMatrix/);assert.doesNotMatch(svg,/clipPath/);
 assert.deepEqual(m.characterLayers(look).map(l=>l.source),m.characterLayers(base).map(l=>l.source));
});
test('every individual design renders the actual source and stable unique filter IDs',()=>{
 for(const part of['hair','top','bottom','hat','accessory'])for(let i=0;i<m.characterParts[part].length;i++){const look={...base,[part]:i};for(const layer of m.characterLayers(look))assert.ok(render(look).includes('data-part-id="'+layer.id+'"'));}
 const svg=render({...base,body:2});const ids=[...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
});
