import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';

// Texture drawing is irrelevant to placement: stub canvas only, retaining the real
// terrain height field, seeded house generation and arc-length road sampler.
const context = new Proxy({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  createRadialGradient: () => ({ addColorStop() {} })
}, { get: (target, name) => target[name] ?? (() => {}) });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const world = JSON.parse(fs.readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const spine = sampleRiverSpine(createRiverCurve(world.stream.points), 160);
const { field } = createTerrain(world.terrain, createRiverDistance(spine));
const village = createVillage(structuredClone(world.village), field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
assert.equal(props.group.children.length, 1, 'Static props remain one mesh');
const geo = props.group.children[0].geometry;
for (const name of ['position', 'normal', 'color']) {
  assert(Array.from(geo.attributes[name].array).every(Number.isFinite), name + ' must be finite');
  assert.equal(geo.attributes[name].count, geo.attributes.position.count);
}
const baskets = props.marks.filter(m => m.kind === 'basket');
const mats = props.marks.filter(m => m.kind === 'drying-mat');
assert.equal(baskets.length, village.houseInfo.length);
assert.equal(mats.length, 3);
for (const [i, basket] of baskets.entries()) {
  const h = village.houseInfo[i], dx = basket.x - h.x, dz = basket.z - h.z;
  const localX = dx * Math.cos(h.rot) - dz * Math.sin(h.rot);
  assert(Math.abs(localX) - basket.r > 0.9, 'Basket leaves door centre clear');
}
const roadside = props.marks.filter(m => m.kind === 'fence' && m.halfW === 0.5);
assert(roadside.length >= 2, 'Roadside fence segments should be generated');
assert(Math.max(...roadside.map(m => m.z)) - Math.min(...roadside.map(m => m.z)) > 70,
  'Roadside dressing must span the village, not its first metre');
for (const tree of props.marks.filter(m => m.kind === 'tree')) {
  let nearest = Infinity;
  for (let i = 0; i <= 800; i++) {
    const p = village.road.at(village.road.total * i / 800);
    nearest = Math.min(nearest, Math.hypot(p.x - tree.x, p.z - tree.z));
  }
  assert(nearest >= 5.5, 'Trees must leave the actual whole road clear');
}
const again = createProps(world.props, field, village.houseInfo, village.plots, village.road);
assert.deepEqual(again.marks, props.marks, 'Placement stays deterministic');
console.log(JSON.stringify({status:'passed', baskets:baskets.length, dryingMats:mats.length,
  roadsideFences:roadside.length, trees:props.marks.filter(m=>m.kind==='tree').length,
  triangles:props.tris, meshCount:props.group.children.length}));
