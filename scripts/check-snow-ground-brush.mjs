import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, createStream, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';
import { planMysterySites } from '../src/world/mysteries.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createWaterSurface } from '../src/systems/twilight-water.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

const ctx2d = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => t[k] ?? (() => {}) });
globalThis.document = {
  body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  createElement: () => ({ getContext: () => ctx2d }),
  getElementById: () => null
};

const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const heightFn = createHeightFunction(world.terrain, distanceToRiver);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from(
  { length: grid.attributes.position.count },
  (_, i) => heightFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i))
);
grid.dispose();
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);

const stream = createStream(world.stream, world.terrain, riverCurve);
const cliff = createCliff(world.cliff, field);
const basin = world.terrain.basin;
const floraField = {
  half: field.half,
  sample: (x, z) => field.sample(x, z),
  slope: (x, z) => (Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z))
};
const nearTree = (x, z) =>
  Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34 ||
  Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40 ||
  world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);
const flora = createFlora(world.flora, floraField, distanceToRiver, riverCurve, world.player.spawn, nearTree);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, field, distanceToRiver, world, village, props, cliff);
const villageScenes = createVillageScenes(world, field, distanceToRiver, village, props, cliff, hinterland);
const villageLife = createVillageLife(
  world, field, distanceToRiver, village, props, cliff, hinterland, villageScenes,
  { anchors: planMysterySites(world, field, distanceToRiver, village, props, cliff, flora) }
);
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, field);
const exterior = createExteriorExploration(world, field, distanceToRiver, riverCurve, flora, boats, cliff);
const habitatDetails = createHabitatDetails({
  world, field, distanceToRiver, riverCurve, flora, hinterland, village, villageScenes, villageLife, props, boats, cliff, exterior
});
const baseOpts = {
  world, field, distanceToRiver, riverCurve, stream: world.stream, flora,
  village, props, hinterland, villageScenes, villageLife, mysteryWorld: { blockers: [] },
  boats, cliff, exterior, habitatDetails
};
const pondLife = createPondLife({ ...baseOpts, reservations: [] });
const waterworks = createWaterworks({ ...baseOpts, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...baseOpts, reservations: [pondLife, waterworks] });
const qinHanHomestead = createQinHanHomestead({
  ...baseOpts, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove]
});
const allBlockers = [...cliff.blockers, ...village.blockers, ...leisureGrove.blockers, ...qinHanHomestead.blockers];
const completion = createQinHanCompletion({
  world, field, village, props, leisureGrove, qinHanHomestead, blockers: allBlockers
});

// ---- 轮7：雪的地面笔意 ----
const { createPhenologySystem } = await import('../src/systems/phenology-mist.js')
const skyStub = { timeId: 'day', rainIntensity: 0, wind: 0.4, getAppearance: () => ({ fogColor: 'c9d8e2', timeId: 'day' }), getTwilightState: () => ({ amount: 0, dawn: 0, dusk: 0 }) };
const stoneMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.3, 0), new THREE.MeshLambertMaterial(), 10);
for (let i = 0; i < 10; i++) stoneMesh.setColorAt(i, new THREE.Color('#8A8578'));
stoneMesh.name = 'stones';
const scatterGroup = new THREE.Group(); scatterGroup.add(stoneMesh);
const springStones = Float32Array.from(stoneMesh.instanceColor.array);
const staticMesh = completion.group.getObjectByName('qin-han-completion-static');
assert.ok(staticMesh?.geometry?.attributes?.color, 'completion static batch carries vertex colors');
const springStatic = Float32Array.from(staticMesh.geometry.attributes.color.array);
const rim = village.group.getObjectByName('pond-ice-rim');
assert.ok(rim && rim.isMesh, 'pond ice rim exists');
assert.equal(rim.visible, false, 'ice rim hidden outside winter');
const paddyMat = completion.group.getObjectByName('qin-han-paddy-water').material;
const shaderStub = { uniforms: {}, vertexShader: 'void main() { gl_Position = vec4(0.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' };
paddyMat.onBeforeCompile(shaderStub, null);
const lum = a => { let s = 0; for (let i = 0; i < a.length; i += 3) s += 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; return s / (a.length / 3); };
const clum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const phen = createPhenologySystem({ world: { terrain: {} }, field, flora, village, qinHanCompletion: completion, scatter: { group: scatterGroup }, sky: skyStub });
completion.update(1 / 60, 1, skyStub, {});
const springPaddy = paddyMat.color.clone();
const springShim = shaderStub.uniforms.uPaddyShimmerAmt.value;
phen.setPhenology('winter');
completion.update(1 / 60, 2, skyStub, {});
assert.ok(clum(paddyMat.color) > clum(springPaddy) + 0.12, 'winter paddy water reads as pale ice sheet');
assert.ok(shaderStub.uniforms.uPaddyShimmerAmt.value < springShim * 0.5, 'frozen paddy loses its shimmer');
assert.equal(rim.visible, true, 'ice rim shows in winter');
assert.ok(lum(staticMesh.geometry.attributes.color.array) > lum(springStatic) + 0.03, 'bund caps and eaves carry snow');
assert.ok(lum(stoneMesh.instanceColor.array) > lum(springStones) + 0.1, 'stones dust with snow');
phen.setPhenology('spring');
completion.update(1 / 60, 3, skyStub, {});
assert.ok(Math.hypot(paddyMat.color.r - springPaddy.r, paddyMat.color.g - springPaddy.g, paddyMat.color.b - springPaddy.b) < 0.01, 'spring restores paddy water color');
assert.equal(rim.visible, false, 'spring hides ice rim');
assert.deepEqual(Array.from(staticMesh.geometry.attributes.color.array), Array.from(springStatic), 'spring restores static batch bytes');
assert.deepEqual(Array.from(stoneMesh.instanceColor.array), Array.from(springStones), 'spring restores stone bytes');
phen.dispose();
console.log('check-snow-ground-brush: PASS paddyLum ' + clum(springPaddy).toFixed(3) + '->' + clum(paddyMat.color).toFixed(3));