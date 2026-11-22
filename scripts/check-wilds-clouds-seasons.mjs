import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

if (!globalThis.document) {
  const ctxStub = new Proxy({
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; }
  }, {
    get(t, k) { return k in t ? t[k] : () => {}; }
  });
  globalThis.document = {
    createElement() {
      return { width: 0, height: 0, getContext: () => ctxStub };
    }
  };
}

import world from '../src/data/world.json' with { type: 'json' };
import { ROUND6_BLOCKS, stripRound6Main } from './round6-main-delta.mjs';
import { CATALOGUE } from '../src/systems/catalogue.js';
import { collectDiscoveryTargets, discoveryScore } from '../src/systems/discovery-targets.js';
import { createRiverCurve, sampleRiverSpine, createStream } from '../src/world/stream.js';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createOxPlowing } from '../src/world/ox-plowing.js';
import { createOuterWilds } from '../src/world/outer-wilds.js';
import { createSeasonalCycle } from '../src/systems/seasonal-cycle.js';

let checks = 0;
function check(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

// 1. Source & baseline lock checks
const auditedFiles = [
  'src/world/outer-wilds.js',
  'src/systems/seasonal-cycle.js',
  'src/systems/sky.js',
  'src/world/scatter.js',
  'src/systems/phenology-mist.js',
  'src/world/ink-landscape.js',
  'src/systems/twilight-water.js',
  'src/systems/ink-atmosphere.js',
  'src/systems/architectural-craft.js',
  'src/world/ox-plowing.js'
];
for (const rel of auditedFiles) {
  const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  check(!/\bconsole\.log\s*\(/.test(src), `no console.log in ${rel}`);
}

const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
for (const name of ROUND6_BLOCKS) {
  check(mainSrc.split(`// Round 6: ${name} begin`).length - 1 === 1, `single Round 6 begin: ${name}`);
  check(mainSrc.split(`// Round 6: ${name} end`).length - 1 === 1, `single Round 6 end: ${name}`);
}
const strippedMain = stripRound6Main(mainSrc);
check(strippedMain.includes('optimizeStaticVisibility'), 'core main survives Round 6 stripping');

// 2. Sky cloud non-banding check (azimuthal variation at constant elevation dy)
const skySrc = readFileSync(new URL('../src/systems/sky.js', import.meta.url), 'utf8');
check(!/dy\s*\*\s*p\.z\s*\*\s*2\.35/.test(skySrc), 'legacy concentric elevation stripe formula removed');
check(/float\s+invY\s*=\s*1\.0\s*\/\s*\(dy\s*\+\s*0\.28\)/.test(skySrc), '2D ceiling projection installed in noonCloudStroke');

function chash(px, py) {
  const qx = ((px * 127.1) % 1 + 1) % 1;
  const qy = ((py * 311.7) % 1 + 1) % 1;
  const d = qx * (qx + 34.23) + qy * (qy + 34.23);
  return (((qx + d) * (qy + d)) % 1 + 1) % 1;
}
function cnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  let fx = px - ix, fy = py - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = chash(ix, iy), b = chash(ix + 1, iy);
  const c = chash(ix, iy + 1), d = chash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function evalNoonStroke(dy, hx, hz) {
  const band = smoothstep(0.08, 0.20, dy) * (1 - smoothstep(0.38, 0.62, dy));
  const invY = 1 / (dy + 0.28);
  const px = hx * invY + 0.85;
  const pz = hz * invY - 0.35;
  const wx = cnoise(px * 0.42 + 1.7, pz * 0.42 + 4.3) - 0.5;
  const wz = cnoise(px * 0.42 + 8.1, pz * 0.42 + 2.9) - 0.5;
  const qx = px + wx * 1.65;
  const qz = pz + wz * 1.65;
  const ux = (qx * 0.80 - qz * 0.60) * (2.6 * 0.46);
  const uy = (qx * 0.60 + qz * 0.80) * (2.6 * 0.50) + dy * 16.0 * 0.022;
  const n0 = cnoise(ux, uy);
  const n1 = cnoise(ux * 1.93 + 3.7, uy * 2.07 + 5.1);
  const n2 = cnoise(ux * 2.9 + 9.1, uy * 2.85 + 2.3);
  const billow = n0 * 0.52 + n1 * 0.30 + n2 * 0.18;
  return smoothstep(0.42, 0.75, billow) * (0.64 + 0.36 * smoothstep(0.34, 0.76, n1)) * band;
}
{
  const dy = 0.26;
  const rHoriz = Math.sqrt(1 - dy * dy);
  let minS = Infinity, maxS = -Infinity;
  for (let i = 0; i < 36; i++) {
    const az = (i / 36) * Math.PI * 2;
    const v = evalNoonStroke(dy, Math.cos(az) * rHoriz, Math.sin(az) * rHoriz);
    if (v < minS) minS = v;
    if (v > maxS) maxS = v;
  }
  check(maxS - minS > 0.25, `noonCloudStroke breaks concentric bands across azimuths (spread=${(maxS - minS).toFixed(3)})`);
}

// 3. Build real world slice & verify OuterWilds + Catalogue + LOS + Seasons + Freeze
const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const terrain = createTerrain(world.terrain, distanceToRiver, { road: world.village.road, pond: world.terrain.pond });
const cliff = createCliff(world.cliff, terrain.field);
terrain.field.colorAt = terrain.colorAt;
const stream = createStream(world.stream, world.terrain, riverCurve);
const village = createVillage(world.village, terrain.field, world.terrain.pond);
const props = createProps(world.props, terrain.field, village.houseInfo, village.plots, village.road);

const outerWilds = createOuterWilds({
  world,
  field: terrain.field,
  distanceToRiver,
  riverCurve,
  stream,
  village,
  props,
  cliff,
  reservations: []
});
const owStats = outerWilds.getStats();
check(owStats.trails === 9, `outerWilds builds 9 mountain trails (got ${owStats.trails})`);
check(owStats.sanctuaries === 6, `outerWilds builds 6 sanctuaries (got ${owStats.sanctuaries})`);
check(owStats.villagers === 7, `outerWilds builds 7 mountain villagers (got ${owStats.villagers})`);
check(owStats.teaShrubs >= 80, `outerWilds populates mountain tea shrubs (got ${owStats.teaShrubs})`);
check(owStats.pines >= 90, `outerWilds populates outer pines (got ${owStats.pines})`);
check(owStats.maples >= 30, `outerWilds populates mountain maples (got ${owStats.maples})`);
check(owStats.blossoms >= 25, `outerWilds populates wild blossoms (got ${owStats.blossoms})`);
check(owStats.bamboo >= 25, `outerWilds populates hillside bamboo (got ${owStats.bamboo})`);
check(owStats.crags >= 50, `outerWilds populates stratified crags (got ${owStats.crags})`);
check(owStats.tufts >= 120, `outerWilds populates meadow tufts (got ${owStats.tufts})`);
check(owStats.deer === 2, 'outerWilds places 2 grazing sika deer');

// Check finite vertex coordinates on all outerWilds meshes
outerWilds.group.traverse(obj => {
  if (!obj.isMesh) return;
  const pos = obj.geometry?.attributes?.position?.array;
  check(pos && pos.length > 0, `mesh ${obj.name} has position buffer`);
  for (let i = 0; i < pos.length; i++) {
    if (!Number.isFinite(pos[i])) assert.fail(`non-finite vertex in ${obj.name}`);
  }
});

// Check 6 new Field Guide entries & LOS discovery
const newIds = ['lanke-chess-crag', 'split-log-bridge', 'ancient-climbing-kiln', 'deer-brushwood-hermitage', 'mountain-tea-shelter', 'cloud-ridge-woodcutter-hut'];
for (const id of newIds) {
  check(Boolean(CATALOGUE[id]?.name && CATALOGUE[id]?.text?.length > 15), `CATALOGUE has ${id}`);
}
const collected = collectDiscoveryTargets({ leisureGrove: { targets: outerWilds.targets } });
check(collected.length === 6, 'all 6 outerWilds targets accepted by collectDiscoveryTargets');
const allBlockers = [...cliff.blockers, ...village.blockers, ...outerWilds.blockers];
for (const tgt of collected) {
  // Stand 3.2m south-west of target facing it and verify unobstructed discoveryScore
  const px = tgt.x - 2.2, pz = tgt.z + 2.2;
  const py = terrain.field.sample(px, pz) + 1.62;
  const dx = tgt.x - px, dy = tgt.y - py, dz = tgt.z - pz;
  const len = Math.hypot(dx, dy, dz);
  const eye = { x: px, y: py, z: pz };
  const fwd = { x: dx / len, y: dy / len, z: dz / len };
  const s = discoveryScore(eye, fwd, tgt, allBlockers, terrain.field);
  check(Number.isFinite(s) && s >= 0, `unobstructed discovery LOS for ${tgt.id} (score=${s})`);
}

// Check wood bridge footstep detection & E interaction binding
const bridgeSite = outerWilds.layout.sanctuaries.logBridge;
check(outerWilds.isOnWood(bridgeSite.x, bridgeSite.z) === true, 'isOnWood true on split-log bridge');
check(outerWilds.isOnWood(0, -130) === false, 'isOnWood false away from bridge');

let triggeredSound = 0;
const fakeNote = { textContent: '', classList: { add() {}, remove() {} }, setAttribute() {} };
const fakeMysteries = { pickTarget: () => null, interact: () => null, hide() {} };
const fakePlayer = { state: { x: bridgeSite.x - 1.5, y: terrain.field.sample(bridgeSite.x - 1.5, bridgeSite.z + 1.5), z: bridgeSite.z + 1.5 } };
outerWilds.bind({
  mysteries: fakeMysteries,
  sound: { wood: () => { triggeredSound++; }, waterCup: () => { triggeredSound++; }, bell: () => { triggeredSound++; } },
  player: fakePlayer,
  doc: { getElementById: (id) => (id === 'mystery-note' ? fakeNote : null) }
});
const pickCam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500);
pickCam.position.set(fakePlayer.state.x, fakePlayer.state.y + 1.6, fakePlayer.state.z);
pickCam.lookAt(bridgeSite.x, terrain.field.sample(bridgeSite.x, bridgeSite.z) + 0.5, bridgeSite.z);
pickCam.updateMatrixWorld();
const focus = fakeMysteries.pickTarget(pickCam, {});
check(focus && focus.id === 'split-log-bridge', 'mysteries.pickTarget resolves nearby outerWilds sanctuary');
check(fakeMysteries.interact(focus) && fakeNote.textContent.length > 6 && triggeredSound > 0, 'E interaction triggers poetic note & sound');

// Check OuterWilds 4-season color transitions & exact spring byte restoration
const mapleMesh = outerWilds.group.getObjectByName('outer-wilds-maples');
const springMapleGeo = new Float32Array(mapleMesh.geometry.attributes.color.array);
outerWilds.setPhenology('autumn');
const autumnMapleGeo = new Float32Array(mapleMesh.geometry.attributes.color.array);
let mapleDiff = 0;
for (let i = 0; i < springMapleGeo.length; i++) mapleDiff += Math.abs(autumnMapleGeo[i] - springMapleGeo[i]);
check(mapleDiff > 5, 'autumn turns mountain maples crimson-gold');
outerWilds.setPhenology('winter');
outerWilds.setPhenology('summer');
outerWilds.setPhenology('spring');
assert.deepEqual(mapleMesh.geometry.attributes.color.array, springMapleGeo, 'outerWilds spring restores exact Float32 bytes');

// Check dt = 0 freeze on OuterWilds
outerWilds.update(0.5, 1.0, { timeId: 'day', rainIntensity: 0 }, fakePlayer.state);
const dynMesh = outerWilds.group.getObjectByName('outer-wilds-dynamic');
const snapDyn = new Float32Array(dynMesh.geometry.attributes.position.array);
outerWilds.update(0, 2.0, { timeId: 'day', rainIntensity: 0 }, fakePlayer.state);
assert.deepEqual(dynMesh.geometry.attributes.position.array, snapDyn, 'outerWilds freezes strictly at dt=0');

// 4. Verify OxPlowing winter rest + SeasonalCycle (crops, geese, footprints, rainbow, night silhouettes, dt=0)
const fakeLeisure = { layout: { regions: [{ kind: 'bamboo', x: 52, y: 2, z: -146 }] }, blockers: [], targets: [] };
const homestead = createQinHanHomestead({
  world, field: terrain.field, distanceToRiver, riverCurve, stream, village, props, cliff,
  pondLife: { layout: { placements: [] }, blockers: [] },
  leisureGrove: fakeLeisure,
  reservations: []
});
const completion = createQinHanCompletion({
  world, field: terrain.field, village, props, leisureGrove: fakeLeisure, qinHanHomestead: homestead,
  blockers: cliff.blockers.concat(village.blockers)
});
const oxPlowing = createOxPlowing({ world, field: terrain.field, homestead });
const cropMesh = completion.group.getObjectByName('qin-han-millet-crops');
const springCropMat = new Float32Array(cropMesh.instanceMatrix.array);

const liveSky = { timeId: 'day', weatherId: 'clear', rainIntensity: 0 };
const walkPlayer = { state: { x: 30, y: terrain.field.sample(30, -125), z: -125, aboardSkiff: false } };
const seasonalCycle = createSeasonalCycle({
  world,
  field: terrain.field,
  village,
  props,
  leisureGrove: fakeLeisure,
  qinHanCompletion: completion,
  oxPlowing,
  player: walkPlayer,
  sky: liveSky
});

// Summer crop wave scaling
seasonalCycle.setPhenology('summer');
let cropDiff = 0;
for (let i = 0; i < springCropMat.length; i++) cropDiff += Math.abs(cropMesh.instanceMatrix.array[i] - springCropMat[i]);
check(cropDiff > 1, 'summer scales millet/paddy crop stature');

// Autumn southbound wild geese
seasonalCycle.setPhenology('autumn');
seasonalCycle.update(0.2, 1.0, liveSky, walkPlayer.state);
check(seasonalCycle.getStats().geeseVisible === true, 'autumn day displays V-formation southbound wild geese');

// Winter ox shelter + ox rest + snow footprints
oxPlowing.setPhenology('winter');
check(oxPlowing.getStats().mode === 'rest' && oxPlowing.getStats().restBlend === 1, 'oxPlowing rests in winter');
seasonalCycle.setPhenology('winter');
seasonalCycle.update(0.1, 1.1, liveSky, walkPlayer.state);
walkPlayer.state.x += 1.0;
walkPlayer.state.y = terrain.field.sample(walkPlayer.state.x, walkPlayer.state.z);
seasonalCycle.update(0.1, 1.2, liveSky, walkPlayer.state);
walkPlayer.state.x += 1.0;
walkPlayer.state.y = terrain.field.sample(walkPlayer.state.x, walkPlayer.state.z);
seasonalCycle.update(0.1, 1.3, liveSky, walkPlayer.state);
check(seasonalCycle.getStats().oxBreathVisible === true, 'winter shows frosty ox breath');
check(seasonalCycle.getStats().activeFootprints >= 2, 'winter stamps player snow footprints');

// Decay footprints after 10s
for (let k = 0; k < 105; k++) seasonalCycle.update(0.1, 2 + k * 0.1, liveSky, walkPlayer.state);
check(seasonalCycle.getStats().activeFootprints === 0, 'winter snow footprints fade cleanly over time');

// Restore spring exact crop matrices & ox resuming work
oxPlowing.setPhenology('spring');
seasonalCycle.setPhenology('spring');
assert.deepEqual(cropMesh.instanceMatrix.array, springCropMat, 'seasonalCycle restores exact spring crop matrices');
check(oxPlowing.getStats().phenology === 'spring', 'oxPlowing returns to spring phenology');

// Post-rain Xuan-paper double rainbow trigger
liveSky.weatherId = 'rain';
liveSky.rainIntensity = 0.65;
seasonalCycle.update(0.1, 15.0, liveSky, walkPlayer.state);
liveSky.weatherId = 'clear';
liveSky.rainIntensity = 0.02;
seasonalCycle.update(0.5, 15.5, liveSky, walkPlayer.state);
check(seasonalCycle.getStats().postRainBoost > 0.8 && seasonalCycle.getStats().rainbowVisible === true, 'rain->clear unfurls post-rain rainbow & mist boost');

// Night sequential paper-window silhouettes
check(seasonalCycle.getStats().windowSilhouettesVisible === false, 'window silhouettes hidden during daytime');
liveSky.timeId = 'night';
seasonalCycle.update(2.0, 18.0, liveSky, walkPlayer.state);
check(seasonalCycle.getStats().windowSilhouettesVisible === true, 'window silhouettes kindle at night');

// Strict dt = 0 freeze on SeasonalCycle
const geeseMesh = seasonalCycle.group.getObjectByName('autumn-wild-geese');
liveSky.timeId = 'day';
seasonalCycle.setPhenology('autumn');
seasonalCycle.update(0.2, 19.0, liveSky, walkPlayer.state);
const geeseSnap = new Float32Array(geeseMesh.instanceMatrix.array);
seasonalCycle.update(0, 25.0, liveSky, walkPlayer.state);
assert.deepEqual(geeseMesh.instanceMatrix.array, geeseSnap, 'seasonalCycle freezes strictly at dt=0');

seasonalCycle.dispose();
oxPlowing.dispose();
outerWilds.dispose();

console.log(`PASS check-wilds-clouds-seasons (${checks} checks)`);
