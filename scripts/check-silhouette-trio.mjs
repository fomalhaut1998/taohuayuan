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
import { createReeds } from '../src/world/reeds.js';
import { createScatter } from '../src/world/scatter.js';
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

// ---- 1. Pond Ink-Wash Silhouette & Sky-Cloud Reflection Checks ----
const pondMesh = village.group.getObjectByName('pond');

// ---- Round 2 silhouette trio contract ----
const reeds = createReeds(world.reeds, field, riverCurve, world.terrain);
const scatter = createScatter(world.scatter, field, () => false, world.village.road, world.village.road, riverCurve);

const far = flora.group.getObjectByName('tree-far-0');
assert.ok(far, 'tree-far-0 exists');
const fpos = far.geometry.attributes.position, fcol = far.geometry.attributes.color;
let pink = 0, maxR = 0, minY = 1e9, maxY = -1e9;
const radii = [];
for (let i = 0; i < fpos.count; i++) {
  const r = fcol.getX(i), g = fcol.getY(i);
  if (r > 0.7 && r > g + 0.1) {
    pink++;
    const rad = Math.hypot(fpos.getX(i), fpos.getZ(i));
    radii.push(rad); maxR = Math.max(maxR, rad);
    minY = Math.min(minY, fpos.getY(i)); maxY = Math.max(maxY, fpos.getY(i));
  }
}
assert.equal((far.geometry.index ? far.geometry.index.count / 3 : fpos.count / 3) * far.count, 42366, 'far tree tris unchanged (silhouette retune only)');
assert.ok(pink >= 230, 'blossom faces present, pink=' + pink);
radii.sort((a, b) => a - b);
const coreEdge = radii[Math.floor(radii.length * 0.25)];
const bins = new Array(24).fill(false);
for (let i = 0; i < fpos.count; i++) {
  const r = fcol.getX(i), g = fcol.getY(i);
  if (r > 0.7 && r > g + 0.1) {
    const rad = Math.hypot(fpos.getX(i), fpos.getZ(i));
    if (rad > coreEdge * 1.25) {
      let ang = Math.atan2(fpos.getZ(i), fpos.getX(i)); if (ang < 0) ang += Math.PI * 2;
      bins[Math.min(23, Math.floor(ang / (Math.PI * 2) * 24))] = true;
    }
  }
}
const rimFrac = bins.filter(Boolean).length / 24;
assert.ok(rimFrac >= 0.3 && rimFrac <= 0.66, 'rim clusters break the umbrella edge (gaps between crowns), coverage=' + rimFrac.toFixed(3));
assert.ok((maxY - minY) / maxR >= 0.62, 'crown has vertical relief, not a pancake: ' + ((maxY - minY) / maxR).toFixed(3));
const floraSrc = readFileSync(new URL('../src/world/flora.js', import.meta.url), 'utf8');
assert.ok(/coreRadius \?\? 0\.62/.test(floraSrc), 'far core radius tightened to expose forks');
assert.ok(/0\.78 \+ rnd\(\) \* 0\.34/.test(floraSrc), 'satellites pushed to the rim');

const reedMesh = reeds.group.getObjectByName('reeds');
const rp = reedMesh.geometry.attributes.position;
const rpl = reedMesh.geometry.attributes.aPlume;
let tipY = -1, tipX = 0;
for (let i = 0; i < rp.count; i++) { if (rpl.getX(i) === 0 && rp.getY(i) > tipY) { tipY = rp.getY(i); tipX = Math.hypot(rp.getX(i), rp.getZ(i)); } }
assert.ok(tipY <= 0.75, 'reed tips droop, tipY=' + tipY.toFixed(3));
assert.ok(tipX >= 0.35, 'reed blades arch outward, tipX=' + tipX.toFixed(3));
const plumeAttr = reedMesh.geometry.attributes.aPlume;
assert.ok(plumeAttr, 'plume flag attribute exists');
let plumeVerts = 0; for (let i = 0; i < plumeAttr.count; i++) plumeVerts += plumeAttr.getX(i);
assert.equal(plumeVerts, 16, 'two crossed plume quads on two blade tips per clump');
const rb = Math.max(5, world.reeds.bladesPerClump || 5);
const rs = Math.max(5, world.reeds.segmentsPerBlade || 5);
assert.equal(reedMesh.geometry.index.count / 3, rb * rs * 2 + 8, 'reed tris = blades*segments*2 + plume quads');
const rmat = reedMesh.material;
const rsh = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
rmat.onBeforeCompile(rsh, null);
assert.ok(rsh.uniforms.uPlume && rsh.uniforms.uPlumeColor, 'plume uniforms');
reeds.update(0, 0.5, 0);
reeds.update(10, 0.5, 1);
const p1 = rsh.uniforms.uPlume.value;
assert.ok(p1 > 0.9, 'autumn plume blends in, p1=' + p1);
reeds.update(10, 0.5, 1);
assert.equal(rsh.uniforms.uPlume.value, p1, 'dt=0 freezes plume blend');
reeds.update(14, 0.5, 0);
assert.ok(rsh.uniforms.uPlume.value < p1, 'plume recedes outside autumn');

const near = scatter.group.getObjectByName('grass-near');
assert.ok(near.geometry.attributes.aTip, 'grass tip flag for flower dots');
const nsh = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
near.material.onBeforeCompile(nsh, null);
assert.ok(nsh.uniforms.uFlowerA && nsh.uniforms.uFlowerB, 'flower dot colors');
assert.equal(near.count, 6800, 'near grass instance count unchanged');
assert.equal(scatter.group.getObjectByName('grass').count, 6200, 'meadow grass count unchanged');
assert.equal(scatter.group.getObjectByName('grass-approach').count, 2200, 'approach grass count unchanged');
const bamboo = village.group.getObjectByName('bamboo');
assert.equal(bamboo.count, 110, 'bamboo clump count unchanged');
assert.equal((bamboo.geometry.index ? bamboo.geometry.index.count / 3 : bamboo.geometry.attributes.position.count / 3) * bamboo.count, 121440, 'bamboo tris unchanged');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.ok(/allowShader: function \(mesh\) \{[\s\S]{0,120}grass-near/.test(mainSrc), 'flower-dot grass stays in shader-aware instance compaction (tri budget)');
const villageSrc = readFileSync(new URL('../src/world/village.js', import.meta.url), 'utf8');
assert.ok(/\* 0\.62/.test(villageSrc) && /\* 0\.58/.test(villageSrc), 'bamboo leaf fans widened within protected width bound');
assert.ok(/leafDroop \* \(0\.86 \+ 0\.14 \* \(\(b2 % 3\) \/ 2\)\)/.test(villageSrc), 'bamboo leaves fan in layered ge-zi droop');

const pondReeds = village.group.getObjectByName('reeds');
assert.equal(pondReeds.geometry.attributes.position.count, 240 * 2 * 3, 'pond reeds keep baseline face count');
const pp = pondReeds.geometry.attributes.position;
for (let c = 0; c < 240; c++) for (let b = 0; b < 2; b++) {
  const i = c * 6 + b * 3;
  const rise = pp.getY(i + 2) - pp.getY(i);
  assert.ok(rise >= 0.42 && rise <= 1.0, 'pond reed tip droops below full height, rise=' + rise.toFixed(3));
  const span = Math.hypot(pp.getX(i + 1) - pp.getX(i), pp.getZ(i + 1) - pp.getZ(i));
  assert.ok(span < 0.16, 'pond reed blade narrowed, span=' + span.toFixed(3));
}
const baseSum = 170000 + 121440 + 93000 + 48000 + 44000 + 42366 * 2 + 42228 + 38068 + 37944 * 2 + 480;
let newSum = 0;
for (const n of ['grass-near', 'grass', 'grass-approach', 'reeds', 'bamboo']) {
  const m = (n === 'reeds' ? reeds.group : n === 'bamboo' ? village.group : scatter.group).getObjectByName(n);
  newSum += (m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3) * m.count;
}
for (let i = 0; i < 6; i++) { const m = flora.group.getObjectByName('tree-far-' + i); newSum += (m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3) * m.count; }
newSum += pondReeds.geometry.attributes.position.count / 3;
assert.ok(newSum - baseSum <= 60000, 'tri budget <=60k, delta=' + (newSum - baseSum));
console.log('check-silhouette-trio: PASS rimFrac=' + rimFrac.toFixed(3) + ' relief=' + ((maxY - minY) / maxR).toFixed(3) + ' tipY=' + tipY.toFixed(3) + ' triDelta=' + (newSum - baseSum));
