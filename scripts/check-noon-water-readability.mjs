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

// ---- Round 1: noon water readability (day-weighted ink layer) ----
const noonCfg = JSON.parse(readFileSync(new URL('../src/data/ink-water.json', import.meta.url), 'utf8')).noon;
assert.ok(noonCfg && typeof noonCfg === 'object', 'ink-water.json declares a noon tuning block');
for (const k of ['clarity', 'foamEdge', 'silhouetteBoost', 'stretchScale', 'paddyRowContrast', 'paddySheetGain']) {
  assert.ok(Number.isFinite(noonCfg[k]) && noonCfg[k] >= 0 && noonCfg[k] <= 1, 'noon.' + k + ' in [0,1]');
}

let skyState = { timeId: 'day', rainIntensity: 0, night: 0 };
const noonSky = {
  get timeId() { return skyState.timeId; },
  get rainIntensity() { return skyState.rainIntensity; },
  getAppearance: () => ({ timeId: skyState.timeId, night: skyState.night, skyTop: 'b8d0dd', skyBottom: 'e8ece0' }),
  getTwilightState: () => ({ amount: 0, direction: new THREE.Vector3(0.44, 0.72, 0.39), color: new THREE.Color(1, 0.95, 0.88) })
};
function compile(mat) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  mat.onBeforeCompile(shader, null);
  return shader;
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function oracle(src, name, params) {
  const re = new RegExp('float ' + name + '\\(' + params.map(p => 'float ' + p).join(', ') + '\\) \\{([\\s\\S]*?)\\n\\}');
  const m = src.match(re);
  assert.ok(m, 'pure GLSL function ' + name + ' is injected and oracle-able');
  const body = m[1].replace(/\bfloat\b/g, 'let');
  const fn = new Function(...params, 'clamp', 'smoothstep', 'max', 'min', 'mix', body);
  return (...args) => fn(...args, clamp, smoothstep, Math.max, Math.min, (a, b, t) => a + (b - a) * t);
}

const pondMesh = village.group.getObjectByName('pond');
assert.ok(pondMesh && pondMesh.isMesh, 'village pond mesh exists');
const px = world.terrain.pond.x, pz = world.terrain.pond.z;
const streamMesh = stream.mesh;
assert.ok(streamMesh && streamMesh.isMesh, 'stream ribbon mesh exists');
const streamWater = createWaterSurface(streamMesh, noonSky, { field, kind: 'stream' });
const pondReflectors = [{ x: px + 6, y: 0.85, z: pz, radius: 2.25, height: 4.15, kind: 1, shade: 0.96 }];
const pondWater = createWaterSurface(pondMesh, noonSky, { field, kind: 'pond', reflectors: pondReflectors });
for (const w of [streamWater, pondWater]) {
  const s = w.getStats();
  assert.equal(s.addedDraws, 0); assert.equal(s.addedTextures, 0); assert.equal(s.addedRenderTargets, 0);
  assert.ok(s.compileCount <= 1, 'at most one compile per material');
}
const sShader = compile(streamMesh.material);
const pShader = compile(pondMesh.material);
assert.equal(streamWater.getStats().compileCount, 1);
assert.equal(pondWater.getStats().compileCount, 1);
assert.ok(sShader.uniforms.uInkDayWeight, 'uInkDayWeight uniform exists');
assert.ok(sShader.uniforms.uInkNoon, 'uInkNoon vec4 uniform exists');
const dayW = sShader.uniforms.uInkDayWeight;
const noonV = sShader.uniforms.uInkNoon.value;
assert.ok(Math.abs(noonV.x - noonCfg.clarity) < 1e-6 && Math.abs(noonV.y - noonCfg.foamEdge) < 1e-6);

// day weight follows time of day, attenuated by rain; dt=0 freezes clocks but syncs state
skyState = { timeId: 'day', rainIntensity: 0, night: 0 };
streamWater.update(0); assert.equal(dayW.value, 1, 'noon weight 1 at clear day');
skyState.timeId = 'dawn'; streamWater.update(0); assert.ok(Math.abs(dayW.value - 0.35) < 1e-6, 'dawn partial weight');
skyState.timeId = 'dusk'; streamWater.update(0); assert.equal(dayW.value, 0, 'dusk keeps legacy pigment');
skyState = { timeId: 'night', rainIntensity: 0, night: 1 }; streamWater.update(0); assert.equal(dayW.value, 0);
skyState = { timeId: 'day', rainIntensity: 1, night: 0 }; streamWater.update(0); assert.ok(Math.abs(dayW.value - 0.3) < 1e-6, 'rain softens noon layer');
skyState = { timeId: 'day', rainIntensity: 0, night: 0 };
streamWater.update(0.5);
const clockA = streamWater.getStats().inkClock;
streamWater.update(0); streamWater.update(0);
assert.equal(streamWater.getStats().inkClock, clockA, 'dt=0 freezes ink ripple clock');

// numeric oracle: noon deepens mid-channel, narrows foam to the true bank; day=0 is byte-equal legacy math
const depthFn = oracle(sShader.fragmentShader, 'inkNoonDepth', ['depth', 'bank', 'day', 'clarity']);
const foamFn = oracle(sShader.fragmentShader, 'inkNoonFoam', ['bank', 'wave', 'day', 'foamEdge']);
const baseDepth = (d, b) => clamp(d, 0, 1) * (1 - smoothstep(0.38, 1.0, b));
const baseFoam = (b, w) => smoothstep(0.76, 0.99, b) * smoothstep(0.16, 0.88, w) * 0.16;
for (const [d, b] of [[0.3, 0], [0.5, 0.2], [0.8, 0.5]]) {
  assert.ok(Math.abs(depthFn(d, b, 0, noonCfg.clarity) - baseDepth(d, b)) < 1e-9, 'legacy depth at day=0');
  assert.ok(depthFn(d, b, 1, noonCfg.clarity) > baseDepth(d, b) + 1e-6, 'noon reads deeper mid-channel');
}
for (const [b, w] of [[0.8, 0.9], [0.9, 0.5], [1.0, 0.9]]) {
  assert.ok(Math.abs(foamFn(b, w, 0, noonCfg.foamEdge) - baseFoam(b, w)) < 1e-9, 'legacy foam at day=0');
}
assert.ok(baseFoam(0.8, 0.9) > 0 && foamFn(0.8, 0.9, 1, noonCfg.foamEdge) === 0, 'noon foam hugs the bank line');
assert.ok(foamFn(1.0, 0.9, 1, noonCfg.foamEdge) > 0, 'bank edge still foams at noon');

// pond: noon compresses vertical stretch and lifts silhouette strength; night formula untouched
const stretch = pShader.uniforms.uInkReflStretch.value;
const params = pShader.uniforms.uInkReflParams.value;
skyState = { timeId: 'day', rainIntensity: 0, night: 0 }; pondWater.update(0);
const stretchDay = stretch.x, silDay = params.z;
skyState = { timeId: 'dusk', rainIntensity: 0, night: 0 }; pondWater.update(0);
const stretchDusk = stretch.x, silDusk = params.z;
assert.ok(stretchDay < stretchDusk - 1e-6, 'noon reflection stands taller (less vertical stretch)');
assert.ok(silDay > silDusk + 1e-6, 'noon silhouette wash stronger');
assert.ok(silDay <= 1, 'strength stays unit-clamped');
skyState = { timeId: 'night', rainIntensity: 0, night: 1 }; pondWater.update(0);
assert.ok(Math.abs(params.z - 0.48 * (1 - 0.22)) < 1e-6, 'night silhouette formula unchanged');
assert.ok(pShader.fragmentShader.includes('clamp(max(sil, reedRim) * waveStroke * uInkReflParams.z, 0.0, 0.54)'), 'ink wash cap 0.54 preserved verbatim');

// paddy: noon row contrast + sky sheet gain; night exactly legacy
let paddyMat = null;
completion.group.traverse(o => { if (o.isMesh && o.material && typeof o.material.customProgramCacheKey === 'function' && o.material.customProgramCacheKey().startsWith('qin-han-paddy-water')) paddyMat = o.material; });
assert.ok(paddyMat, 'paddy water material found');
assert.ok(paddyMat.customProgramCacheKey().endsWith('v5'), 'paddy cache key bumped to v5');
const pdShader = compile(paddyMat);
assert.ok(pdShader.uniforms.uPaddyDay, 'uPaddyDay uniform exists');
const rowLo = oracle(pdShader.fragmentShader, 'pNoonRowLo', ['day', 'c']);
const rowHi = oracle(pdShader.fragmentShader, 'pNoonRowHi', ['day', 'c']);
const sheetGain = oracle(pdShader.fragmentShader, 'pNoonSheetGain', ['day', 'g']);
assert.ok(Math.abs(rowLo(0, noonCfg.paddyRowContrast) - 0.84) < 1e-9 && Math.abs(rowHi(0, noonCfg.paddyRowContrast) - 1.06) < 1e-9 && sheetGain(0, noonCfg.paddySheetGain) === 1, 'night paddy math unchanged');
assert.ok(rowLo(1, noonCfg.paddyRowContrast) < 0.84 && rowHi(1, noonCfg.paddyRowContrast) > 1.06 && sheetGain(1, noonCfg.paddySheetGain) > 1, 'noon paddy rows and sky sheet gain contrast');
skyState = { timeId: 'day', rainIntensity: 0, night: 0 };
completion.update(1 / 60, 1 / 60, noonSky, { speed: 0, moving: false });
assert.equal(pdShader.uniforms.uPaddyDay.value, 1, 'paddy day weight 1 at clear noon');
skyState = { timeId: 'night', rainIntensity: 0, night: 1 };
completion.update(1 / 60, 1 / 60, noonSky, { speed: 0, moving: false });
assert.equal(pdShader.uniforms.uPaddyDay.value, 0, 'paddy day weight 0 at night');

console.log('PASS check-noon-water-readability: day-weighted stream depth/foam, pond silhouette, paddy sky sheet; legacy dawn/dusk/night math unchanged; 0 added draws');
