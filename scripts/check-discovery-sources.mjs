import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine, createStream } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createFauna } from '../src/systems/fauna.js';
import { collectDiscoveryTargets, resolveDiscoveryTarget, discoveryScore } from '../src/systems/discovery-targets.js';
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
// No WebGL, browser or server: canvas drawing itself is outside this provenance check.
const ctx = new Proxy({}, { get: () => () => ctx });
globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
const curve = createRiverCurve(world.stream.points), riverSpine = sampleRiverSpine(curve, 160);
const river = createRiverDistance(riverSpine), height = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments); grid.rotateX(-Math.PI / 2);
const heights = new Float32Array(grid.attributes.position.count);
for (let i = 0; i < heights.length; i++) heights[i] = height(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const cliff = createCliff(world.cliff, field);
const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const villageScenes = createVillageScenes(world, field, river, village, props, cliff, hinterland);
const villageLife = createVillageLife(world, field, river, village, props, cliff, hinterland, villageScenes, {});
const flora = createFlora(world.flora, field, river, curve, world.player.spawn, () => true);
const stream = createStream(world.stream, world.terrain, curve);
const boats = createBoats(world.boats, stream, world.terrain, curve, field);
const fauna = createFauna(world.fauna, field, {});
const targets = collectDiscoveryTargets({ world, field, riverSpine, village, props, cliff, hinterland, villageScenes, villageLife, flora, boats, fauna });
assert.equal(targets.filter(t => t.source === 'flora').length, flora.count, 'nearSpots are a subset, never duplicate labels');
for (const t of targets) assert([t.x, t.y, t.z, t.range].every(Number.isFinite), t.source + ' finite successful anchor');
for (const id of ['peach', 'bamboo', 'mulberry', 'field', 'pond', 'cave', 'stream', 'well', 'stone-mill', 'boat', 'chicken', 'dog', 'bird', 'ox', 'duck']) assert(targets.some(t => t.id === id), id + ' represented by real production output');
for (const t of targets.filter(t => t.source === 'flora')) assert(flora.spots.some(p => p[0] === t.x && p[1] + 1.3 === t.y && p[2] === t.z));
for (const t of targets.filter(t => t.source.startsWith('village-life-'))) {
  const i = Number(t.source.slice('village-life-'.length)), p = villageLife.items[i];
  assert.equal(t.x, p.x); assert.equal(t.z, p.z);
  if (t.ownBlocker) assert.equal(t.ownBlocker.source, p.kind + '-' + i);
}
const trunks = targets.filter(t => t.source === 'hinterland-tree' || t.source === 'hinterland-bamboo');
assert(trunks.length > 0); assert(trunks.every(t => t.ownBlocker), 'real opaque trunks have exact verified front-surface anchors');
for (const t of trunks) {
  const eye = { x: t.x, y: t.y, z: t.z + 3 };
  assert(Number.isFinite(discoveryScore(eye, { x: 0, y: 0, z: -1 }, t, [t.ownBlocker], { sample: () => -100 })), t.source + ' own visible surface');
}
const liveBoat = targets.find(t => t.id === 'boat'), boatBefore = resolveDiscoveryTarget(liveBoat).y;
boats.update(.5, 2.7); assert.notEqual(resolveDiscoveryTarget(liveBoat).y, boatBefore, 'boat follows the generated hull after production update');
const liveAnimal = targets.find(t => t.id === 'dog'), dog = fauna.animals.find(a => a.kind === 'dog');
dog.x += .5; assert.equal(resolveDiscoveryTarget(liveAnimal).x, dog.x, 'animal refers to its real live state');
console.log('production discovery sources passed:', targets.length, 'anchors;', new Set(targets.map(t => t.id)).size, 'kinds;', trunks.length, 'verified tree/bamboo surfaces');
