import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createFlora } from '../src/world/flora.js';
import { createBarrier } from '../src/systems/barrier.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
const ctx = new Proxy({}, { get: () => () => ctx });
globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
const river = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points), 160));
const h = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = new Float32Array(grid.attributes.position.count);
for (let i = 0; i < heights.length; i++) heights[i] = h(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const cliff = createCliff(world.cliff, field);
const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const scenes = createVillageScenes(world, field, river, village, props, cliff, hinterland);
// Match main's basin exclusion; near/far tree shape selection does not change spots.
const basin = world.terrain.basin;
const floraField = { half: field.half, sample: (x,z) => field.sample(x,z),
  slope: (x,z) => Math.hypot(x-basin.x,z-basin.z) < basin.inner*1.05 ? 9 : field.slope(x,z) };
const flora = createFlora(world.flora, floraField, river, createRiverCurve(world.stream.points), world.player.spawn, () => false);
const mysteries = createMysteries(world, field, river, village, props, cliff, hinterland, scenes, flora);
assert.equal(scenes.scenes.length, 3);
assert.equal(mysteries.sites.length, 3);
assert.deepEqual(scenes.rejected, []);
const newBarrier = createBarrier([...scenes.blockers, ...mysteries.blockers]);
const fullBarrier = createBarrier([...cliff.blockers, ...village.blockers, ...hinterland.blockers, ...scenes.blockers, ...mysteries.blockers]);
let samples = 0;
function free(x, z, barrier, label) {
  const s = { x, z, vx: 0, vz: 0 }; barrier.resolve(s, 0.42);
  assert.ok(Math.hypot(s.x-x, s.z-z) < 1e-7, label + ' at ' + x + ',' + z); samples++;
}
function route(path, barrier) {
  for (let i=1; i<path.points.length; i++) {
    const a=path.points[i-1], b=path.points[i], len=Math.hypot(b[0]-a[0], b[1]-a[1]);
    if (!len) continue;
    const n=Math.max(1,Math.ceil(len/0.25)), nx=-(b[1]-a[1])/len, nz=(b[0]-a[0])/len;
    for (let j=0;j<=n;j++) for (const side of [-1,0,1]) {
      free(a[0]+(b[0]-a[0])*j/n+nx*side*path.width/2, a[1]+(b[1]-a[1])*j/n+nz*side*path.width/2, barrier, path.id);
    }
  }
}
route({id:'old-main-road',points:world.village.road.points,width:world.village.road.width},newBarrier);
for (const house of village.houseInfo) if(house.spur) route({id:'old-door-'+house.x,points:house.spur.pts,width:house.spur.half*2},newBarrier);
for (const path of hinterland.paths) route(path,fullBarrier);
for (const path of scenes.paths) route(path,fullBarrier);
for (const site of mysteries.sites) {
  free(site.approach.x,site.approach.z,fullBarrier,'mystery approach '+site.id);
  assert.ok(Math.hypot(site.x-site.approach.x,site.z-site.approach.z)<=3.5,'within actual interaction range');
}
assert.equal(scenes.mapData.scenes.length,scenes.scenes.length);
for (let i=0;i<scenes.scenes.length;i++) {
  assert.equal(scenes.scenes[i].x,scenes.mapData.scenes[i].x);
  assert.equal(scenes.scenes[i].z,scenes.mapData.scenes[i].z);
}
console.log(JSON.stringify({status:'passed',combinedRoutesAndApproaches:samples,scenes:scenes.scenes.map(s=>s.id),mysteries:mysteries.sites.map(s=>s.id),sceneDraws:scenes.stats.drawCalls}));
