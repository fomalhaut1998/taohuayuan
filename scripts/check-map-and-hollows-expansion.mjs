import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

if (!globalThis.document) {
  const ctxStub = new Proxy({
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; }
  }, {
    get(t, k) { return k in t ? t[k] : () => {}; }
  });
  globalThis.document = {
    body: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} } },
    createElement() {
      return { width: 0, height: 0, getContext: () => ctxStub };
    },
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    pointerLockElement: null
  };
}
if (!globalThis.Path2D) {
  globalThis.Path2D = class { moveTo() {} lineTo() {} };
}

import world from '../src/data/world.json' with { type: 'json' };
import outerWildsCfg from '../src/data/outer-wilds.json' with { type: 'json' };
import deepHollowsCfg from '../src/data/deep-hollows.json' with { type: 'json' };
import mapExpansion from '../src/data/map-expansion.json' with { type: 'json' };
import { CATALOGUE } from '../src/systems/catalogue.js';
import { collectDiscoveryTargets, discoveryScore } from '../src/systems/discovery-targets.js';
import { createRiverCurve, sampleRiverSpine, createStream } from '../src/world/stream.js';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createOuterWilds } from '../src/world/outer-wilds.js';
import { createDeepHollows } from '../src/world/deep-hollows.js';
import { attachGroundSurface } from '../src/world/ground-surface.js';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { createPlayer } from '../src/player/controller.js';
import { createPoeticWayfinder } from '../src/systems/poetic-wayfinder.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { projectionFor, paintBase } from '../src/systems/mapdraw.js';

let checks = 0;
function check(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

// 1. Code hygiene: zero console.log in all new/modified modules
for (const rel of [
  'src/world/deep-hollows.js',
  'src/player/controller.js',
  'src/world/static-visibility.js',
  'src/systems/poetic-wayfinder.js',
  'src/systems/map.js',
  'src/systems/mapdraw.js'
]) {
  const txt = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  check(!/\bconsole\.log\s*\(/.test(txt), `no console.log in ${rel}`);
}

// 2. Build real terrain + village + outerWilds + deepHollows
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
  world, field: terrain.field, distanceToRiver, riverCurve, stream, village, props, cliff, reservations: []
});
const deepHollows = createDeepHollows({
  world, field: terrain.field, distanceToRiver, riverCurve, stream, village, props, cliff, outerWilds, reservations: []
});
const groundSurface = attachGroundSurface(terrain.field);
groundSurface.register({ world, village, props, outerWilds, deepHollows });

const dhStats = deepHollows.getStats();
check(dhStats.sanctuaries === 3, `deepHollows builds 3 sanctuaries (got ${dhStats.sanctuaries})`);
check(dhStats.trails === 6, `deepHollows builds 6 trails (got ${dhStats.trails})`);
check(dhStats.villagers === 3, `deepHollows builds 3 mountain villagers (got ${dhStats.villagers})`);
check(dhStats.teaBushes >= 40, `deepHollows populates tea bushes (got ${dhStats.teaBushes})`);
check(dhStats.crags >= 16, `deepHollows populates crags (got ${dhStats.crags})`);
check(dhStats.tufts >= 60, `deepHollows populates tufts (got ${dhStats.tufts})`);
check(deepHollows.restSeats.length === 3, 'deepHollows registers 3 restSeats');
check(deepHollows.shelters.length === 2, 'deepHollows registers 2 rain shelters (study & tea shed)');

// Check finite vertices on all deepHollows meshes
deepHollows.group.traverse(obj => {
  if (!obj.isMesh) return;
  const pos = obj.geometry?.attributes?.position?.array;
  check(pos && pos.length > 0, `mesh ${obj.name} has position buffer`);
  for (let i = 0; i < pos.length; i++) {
    if (!Number.isFinite(pos[i])) assert.fail(`non-finite vertex in ${obj.name}`);
  }
});

// Check walkSurface & isOnWood on Cold Spring Study timber deck
const studySite = deepHollows.layout.sanctuaries.secludedStudy;
check(deepHollows.isOnWood(studySite.x, studySite.z) === true, 'isOnWood true on secludedStudy deck');
check(deepHollows.isOnWood(0, -130) === false, 'isOnWood false away from deck');
const studyWalkY = terrain.field.walkSurface(studySite.x, studySite.z);
const studyGroundY = terrain.field.sample(studySite.x, studySite.z);
check(studyWalkY > studyGroundY + 0.35, `walkSurface elevated on timber deck (${studyWalkY.toFixed(2)} > ${studyGroundY.toFixed(2)})`);

// Check Field Guide entries & unobstructed LOS discovery for all 3 deep hollows
const dhIds = ['ancient-qin-altar', 'cold-spring-study', 'jade-rill-tea-terrace'];
for (const id of dhIds) {
  check(Boolean(CATALOGUE[id]?.name && CATALOGUE[id]?.text?.length > 15), `CATALOGUE has ${id}`);
}
const collected = collectDiscoveryTargets({ leisureGrove: { targets: deepHollows.targets } });
check(collected.length === 3, 'all 3 deepHollows targets accepted by collectDiscoveryTargets');
const allBlockers = [...cliff.blockers, ...village.blockers, ...outerWilds.blockers, ...deepHollows.blockers];
for (const tgt of collected) {
  const px = tgt.x + 2.1, pz = tgt.z + 2.1;
  const py = terrain.field.walkSurface(px, pz) + 1.62;
  const dx = tgt.x - px, dy = tgt.y - py, dz = tgt.z - pz;
  const len = Math.hypot(dx, dy, dz);
  const s = discoveryScore({ x: px, y: py, z: pz }, { x: dx / len, y: dy / len, z: dz / len }, tgt, allBlockers, terrain.field);
  check(Number.isFinite(s) && s >= 0, `unobstructed discovery LOS for ${tgt.id} (score=${s})`);
}

// Check Villager Dialogue for 3 new deep-hollow roles
const vd = createVillagerDialogue({
  sky: { timeId: 'day', weatherId: 'clear', rainIntensity: 0 },
  getWorldClock: () => ({ getState: () => ({ shichenName: '巳正' }) }),
  getPhenology: () => ({ getStats: () => ({ phenologyId: 'spring' }) })
});
for (const v of deepHollows.getInteractables()) {
  const s0 = vd.beginOrAdvance({ kind: 'community', key: v.key, id: v.id, name: v.name, ref: v, lines: v.lines });
  check(Boolean(s0?.who && s0?.line && s0?.replies?.length >= 2), `dialogue valid for ${v.role}`);
}
vd.dispose?.();

// Check 4-season transitions & byte-exact spring restoration
const dhStaticGeo = deepHollows.group.getObjectByName('deep-hollows-static').geometry;
const dhWaterGeo = deepHollows.group.getObjectByName('deep-hollows-water').geometry;
const springStaticSnap = new Float32Array(dhStaticGeo.attributes.color.array);
const springWaterSnap = new Float32Array(dhWaterGeo.attributes.color.array);
for (const season of ['summer', 'autumn', 'winter', 'spring']) {
  deepHollows.setPhenology(season);
}
assert.deepEqual(dhStaticGeo.attributes.color.array, springStaticSnap, 'deepHollows static color byte-exact spring restore');
assert.deepEqual(dhWaterGeo.attributes.color.array, springWaterSnap, 'deepHollows water color byte-exact spring restore');
checks += 2;

// Check dt = 0 freeze on deepHollows
deepHollows.update(0.4, 1.0, { timeId: 'day', windX: 0.4, windZ: 0.2 }, { x: studySite.x, z: studySite.z });
const dynMesh = deepHollows.group.getObjectByName('deep-hollows-dynamic');
const dynSnap = new Float32Array(dynMesh.geometry.attributes.position.array);
deepHollows.update(0, 2.5, { timeId: 'day', windX: 0.9, windZ: 0.4 }, { x: studySite.x, z: studySite.z });
assert.deepEqual(dynMesh.geometry.attributes.position.array, dynSnap, 'deepHollows dynamic geometry frozen at dt = 0');
checks++;

// Check 105m-gated night/dusk lantern halos (0 global lights, 0 daytime draws, dt=0 frozen)
const emberMesh = deepHollows.group.getObjectByName('deep-hollows-ember');
const haloMesh = deepHollows.group.getObjectByName('deep-hollows-halo');
let dhLightCount = 0;
deepHollows.group.traverse(o => {
  if (o.isPointLight || o.isSpotLight || o.type === 'PointLight' || o.type === 'SpotLight') dhLightCount++;
});
check(dhLightCount === 0, `deepHollows uses zero PointLight/SpotLight (got ${dhLightCount})`);
check(deepHollows.getStats().lanternHalos === 6, 'deepHollows registers 6 lantern halos');
check(Boolean(emberMesh && haloMesh), 'deep-hollows-ember and deep-hollows-halo meshes exist');
check(haloMesh.material.fog === false, 'deep-hollows-halo disables fog for clean additive falloff');
check(emberMesh.visible === false && haloMesh.visible === false && deepHollows.getStats().activeLanternHalos === 0, 'lanterns & halos hidden at day');

deepHollows.update(0.1, 1.1, { timeId: 'night', windX: 0.2, windZ: 0.1 }, { x: 30, z: -140 });
check(emberMesh.visible === false && haloMesh.visible === false && deepHollows.getStats().activeLanternHalos === 0, 'lanterns & halos hidden at night when player > 105m away');

for (const site of Object.values(deepHollowsCfg.sanctuaries)) {
  deepHollows.update(0.1, 1.2, { timeId: 'dusk', windX: 0.2, windZ: 0.1 }, { x: site.x, z: site.z });
  const duskOpacity = haloMesh.material.opacity;
  check(emberMesh.visible === true && haloMesh.visible === true && deepHollows.getStats().activeLanternHalos === 2, `dusk activates 2 halos near ${site.name}`);
  deepHollows.update(0.1, 1.3, { timeId: 'night', windX: 0.2, windZ: 0.1 }, { x: site.x, z: site.z });
  const nightOpacity = haloMesh.material.opacity;
  check(emberMesh.visible === true && haloMesh.visible === true && deepHollows.getStats().activeLanternHalos === 2, `night activates 2 halos near ${site.name}`);
  check(duskOpacity < nightOpacity, `dusk halo opacity (${duskOpacity}) < night (${nightOpacity}) for ${site.name}`);
}

const haloMatSnap = new Float32Array(haloMesh.instanceMatrix.array);
const haloColSnap = new Float32Array(haloMesh.instanceColor.array);
const haloOpSnap = haloMesh.material.opacity;
deepHollows.update(0, 99, { timeId: 'night', windX: 0.8, windZ: 0.8 }, { x: studySite.x, z: studySite.z });
assert.deepEqual(haloMesh.instanceMatrix.array, haloMatSnap, 'halo instanceMatrix frozen at dt = 0');
assert.deepEqual(haloMesh.instanceColor.array, haloColSnap, 'halo instanceColor frozen at dt = 0');
check(haloMesh.material.opacity === haloOpSnap, 'halo material opacity frozen at dt = 0');
checks += 2;
deepHollows.update(0.1, 1.4, { timeId: 'day', windX: 0.2, windZ: 0.1 }, { x: 30, z: -140 });

// 3. Verify player controller frees all 6 outer-wilds + 3 deep-hollows sites while sealing cliff flanks
const mockCanvas = {
  addEventListener() {},
  removeEventListener() {},
  requestPointerLock: () => Promise.resolve()
};
const origWin = globalThis.window;
globalThis.window = {
  addEventListener() {},
  removeEventListener() {}
};
const player = createPlayer(mockCanvas, world.player, terrain.field, world.terrain, null, { cliff: world.cliff });
const camStub = { position: new THREE.Vector3(), rotation: new THREE.Euler() };

const allMountainSites = [
  ...Object.values(outerWildsCfg.sanctuaries),
  ...Object.values(deepHollowsCfg.sanctuaries)
];
for (const s of allMountainSites) {
  player.state.x = s.x;
  player.state.z = s.z;
  player.state.vx = 0;
  player.state.vz = 0;
  player.state.y = terrain.field.walkSurface(s.x, s.z);
  player.update(0.016, camStub);
  const drift = Math.hypot(player.state.x - s.x, player.state.z - s.z);
  check(drift < 0.05, `player stands freely at ${s.name} [${s.x}, ${s.z}] (drift=${drift.toFixed(3)})`);
}

// Verify flank seals prevent sneaking around east/west cliff ends from interior or exterior
const flankZ = world.cliff.center[1] + Math.sin(world.cliff.arcFrom) * world.cliff.radius;
player.state.x = 165;
player.state.z = flankZ - 12;
player.state.vx = 0;
player.state.vz = 60;
player.update(0.25, camStub);
check(player.state.z <= flankZ - 5, `interior east flank sealed against bypassing cliff (z=${player.state.z.toFixed(1)})`);

player.state.x = 165;
player.state.z = flankZ + 12;
player.state.vx = 0;
player.state.vz = -60;
player.update(0.25, camStub);
check(player.state.z >= flankZ + 5, `exterior east flank sealed against sneaking into wilds (z=${player.state.z.toFixed(1)})`);

player.dispose?.();
globalThis.window = origWin;

// 4. Verify directional cliffPortal in static-visibility keeps village visible from far north & deep hollows
const visScene = new THREE.Scene();
visScene.add(village.group, outerWilds.group, deepHollows.group);
const sv = optimizeStaticVisibility(visScene, {
  cliffPortal: { center: world.cliff.center, radius: world.cliff.radius, arcFrom: world.cliff.arcFrom, slit: cliff.slit }
});
check(sv.getStats().staticMeshes >= 2, `static-visibility pages outer-wilds-static & deep-hollows-static (staticMeshes=${sv.getStats().staticMeshes})`);

const testCam = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 800);
testCam.position.set(60, 12, -260);
testCam.lookAt(30, 2, -120);
testCam.updateMatrixWorld(true);
sv.render({ render() {} }, testCam);
const northVisCount = sv.getStats().visiblePages + sv.getStats().visibleInstances;
check(northVisCount > 0, `looking south from far north (-260) keeps valley visible (visible=${northVisCount})`);

testCam.position.set(26, 2, 190);
testCam.lookAt(26, 2, 100);
testCam.updateMatrixWorld(true);
sv.render({ render() {} }, testCam);
const extInteriorPages = sv.entries
  .filter(e => e.kind === 'pages' && e.source.name !== 'outer-wilds-exterior-static')
  .reduce((sum, e) => sum + (e.visiblePages || 0), 0);
const extWulingPages = sv.entries
  .filter(e => e.kind === 'pages' && e.source.name === 'outer-wilds-exterior-static')
  .reduce((sum, e) => sum + (e.visiblePages || 0), 0);
check(extInteriorPages === 0, `from exterior Wuling (z=190), interior/deep-hollow static pages are portal-culled (pages=${extInteriorPages})`);
check(extWulingPages > 0, `from exterior Wuling (z=190), outer-wilds-exterior-static stays visible (pages=${extWulingPages})`);
sv.dispose();

// 5. Verify poetic-wayfinder treats all 9 outer/deep sites as interior (no routing back through cave)
const fakeMap = { getDestination: () => null };
let wayDest = null;
const wf = createPoeticWayfinder({
  world,
  field: terrain.field,
  cliff,
  map: { getDestination: () => wayDest },
  player,
  village,
  outerWilds,
  deepHollows,
  sky: { timeId: 'day', weatherId: 'clear', windX: 0, windZ: 0 }
});
for (const s of allMountainSites) {
  wayDest = { id: s.id, x: s.x, z: s.z };
  wf.update(0.05, { x: 30, y: 2, z: -96, yaw: 0, pitch: 0 });
  const ws = wf.getStats();
  check(ws.routingViaCave === false && ws.routeMode !== 'sealed', `wayfinder routes directly inside valley to ${s.name}`);
}
wf.dispose();

// 6. Verify 24-POI expanded map projection (no clipping, no overlap) & outerWilds/deepHollows mapdraw painting
const ext = mapExpansion.extent;
check(Boolean(ext && ext.x[0] <= -150 && ext.x[1] >= 200 && ext.z[0] <= -320), 'mapExpansion defines expanded extent');
const W = 1200, H = 700;
const proj = projectionFor(ext, W, H);
const allPois = [...world.map.pois, ...mapExpansion.pois];
check(allPois.length === 24, `total map POIs === 24 (got ${allPois.length})`);

const labelBoxes = [];
for (let i = 0; i < allPois.length; i++) {
  const p = allPois[i];
  const bx = p.badge ? p.x + p.badge[0] : p.x;
  const bz = p.badge ? p.z + p.badge[1] : p.z;
  const x = proj.px(bx, bz);
  const y = proj.py(bx, bz);
  const lx = x + p.label.x * proj.ppm;
  const ly = y - p.label.y * proj.ppm;
  const lw = p.name.length * 12;
  const xMin = p.label.align === 'end' ? lx - lw : lx;
  const xMax = p.label.align === 'end' ? lx : lx + lw;
  check(x >= 14 && x <= W - 14 && y >= 14 && y <= H - 14, `POI ${p.name} badge inside map frame`);
  check(xMin >= 14 && xMax <= W - 14 && ly >= 16 && ly <= H - 16, `POI ${p.name} label inside map frame`);
  labelBoxes.push({ name: p.name, x, y, xMin, xMax, ly });
}
for (let i = 0; i < labelBoxes.length; i++) {
  for (let j = i + 1; j < labelBoxes.length; j++) {
    const a = labelBoxes[i], b = labelBoxes[j];
    const badgeDist = Math.hypot(a.x - b.x, a.y - b.y);
    check(badgeDist >= 24, `POI badges spaced >= 24px: ${a.name} <-> ${b.name} (${badgeDist.toFixed(1)})`);
    const overlap = a.xMin < b.xMax + 2 && a.xMax + 2 > b.xMin && Math.abs(a.ly - b.ly) < 13;
    check(!overlap, `POI labels non-overlapping: ${a.name} <-> ${b.name}`);
  }
}

// Verify mountainLabels fit cleanly without colliding with POI badges
const mLabels = mapExpansion.mountainLabels || [];
check(mLabels.length === 7, `mapExpansion defines 7 mountainLabels (got ${mLabels.length})`);
for (const ml of mLabels) {
  const mx = proj.px(ml.x, ml.z);
  const my = proj.py(ml.x, ml.z);
  check(mx >= 20 && mx <= W - 20 && my >= 28 && my <= H - 28, `mountainLabel ${ml.name} inside map frame`);
  for (const lb of labelBoxes) {
    const d = Math.hypot(mx - lb.x, my - lb.y);
    check(d >= 24, `mountainLabel ${ml.name} spaced >= 24px from POI ${lb.name} (${d.toFixed(1)})`);
  }
}

// Verify paintBase actually draws outerWilds & deepHollows geometry across all 4 seasons on expanded canvas
const drawCounts = { strokes: 0, fills: 0 };
const recCtx = new Proxy({
  globalAlpha: 1,
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
  createRadialGradient() { return { addColorStop() {} }; },
  createLinearGradient() { return { addColorStop() {} }; },
  stroke() { drawCounts.strokes++; },
  fill() { drawCounts.fills++; }
}, {
  get(t, k) { return k in t ? t[k] : () => {}; }
});
const baseSrc = {
  field: terrain.field,
  spots: [],
  houseInfo: village.houseInfo,
  marks: props.marks,
  bamboo: village.bamboo,
  mulberry: village.mulberry,
  pond: village.pond,
  chimneys: village.chimneys,
  spine: riverSpine,
  leisureGrove: { outerWilds: outerWilds.layout, deepHollows: deepHollows.layout }
};
for (const season of ['spring', 'summer', 'autumn', 'winter']) {
  const beforeStrokes = drawCounts.strokes;
  paintBase(recCtx, proj, { ...world.map, extent: ext, phenologyId: season }, world, baseSrc);
  const deltaStrokes = drawCounts.strokes - beforeStrokes;
  check(deltaStrokes > 100, `paintBase renders expanded map in ${season} (strokes=${deltaStrokes})`);
}

// 7. Verify deep-hollows spatial audio day/night distance gating (zero setTargetAtTime, dt=0 & suspended freeze)
let audioNodesCreated = 0;
let setTargetCalls = 0;
function makeParam(init = 0) {
  return {
    value: init,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
    setTargetAtTime(v) { setTargetCalls++; this.value = v; }
  };
}
function makeNode(extra = {}) {
  audioNodesCreated++;
  return { connect() {}, disconnect() {}, ...extra };
}
class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.sampleRate = 44100;
    this.currentTime = 1.0;
    this.destination = {};
  }
  createGain() { return makeNode({ gain: makeParam(1) }); }
  createOscillator() {
    return makeNode({
      type: 'sine',
      frequency: makeParam(440),
      onended: null,
      start() {},
      stop() { if (this.onended) this.onended(); }
    });
  }
  createBiquadFilter() { return makeNode({ type: 'lowpass', frequency: makeParam(1000), Q: makeParam(1) }); }
  createBufferSource() {
    return makeNode({
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      start() {},
      stop() { if (this.onended) this.onended(); }
    });
  }
  createStereoPanner() { return makeNode({ pan: makeParam(0) }); }
  createDynamicsCompressor() {
    return makeNode({
      threshold: makeParam(-16), knee: makeParam(22), ratio: makeParam(4),
      attack: makeParam(0.005), release: makeParam(0.25)
    });
  }
  createAnalyser() {
    return makeNode({
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0.78,
      getByteTimeDomainData(a) { a.fill(128); },
      getByteFrequencyData(a) { a.fill(0); }
    });
  }
  createConvolver() { return makeNode({ buffer: null }); }
  createBuffer(ch, len, sr) {
    const chs = Array.from({ length: ch }, () => new Float32Array(len));
    return { duration: len / sr, getChannelData: i => chs[i] };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

const soundRawSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
const soundModSrc = soundRawSrc
  .replace("import world from '../data/world.json';", `const world = ${JSON.stringify(world)};`)
  .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = { version: 1, clips: [] };')
  .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(soundModSrc).toString('base64'));

const prevAudioWin = globalThis.window;
globalThis.window = { AudioContext: MockAudioContext };
const dhSound = createSound({
  field: terrain.field,
  distanceToRiver,
  riverSpine,
  cliff,
  village,
  deepHollows,
  audioCatalogue: { version: 1, clips: [] },
  audioFetch: async () => ({ ok: false })
});
check(dhSound.unlock() === true, 'deepHollows sound unlocks cleanly');
assert.deepEqual(
  Object.keys(dhSound.getStats().worldSync),
  ['laundryPounds', 'wheelCreaks', 'gateCreaks', 'roosterCrows', 'gathers'],
  'worldSync enumerable keys strictly preserved after adding springDrips'
);
checks++;

const dhPayload = {
  rain: 0,
  snow: 0,
  isNight: false,
  timeId: 'day',
  phenology: 'spring',
  deepHollows: deepHollows.layout
};
const stepAudioFrames = (px, pz, frames, { night = 0, isNight = false } = {}) => {
  dhSound.setAmbience({ wind: 0.25, rain: 0, night });
  dhPayload.isNight = isNight;
  dhPayload.timeId = isNight ? 'night' : 'day';
  const cam = { position: { x: px, y: 2, z: pz }, rotation: { y: 0 } };
  const ps = { x: px, y: 2, z: pz, yaw: 0 };
  for (let i = 0; i < frames; i++) {
    dhSound.context.currentTime += 0.05;
    dhSound.update(0.05, dhSound.context.currentTime, cam, ps, false);
    dhSound.syncWorld(0.05, dhPayload);
  }
  return dhSound.getStats().completionSync;
};

// Far village center (30, -130): zero triggers day or night
stepAudioFrames(30, -130, 80, { night: 0, isNight: false });
let cs = stepAudioFrames(30, -130, 80, { night: 1, isNight: true });
check(cs.springDrips === 0 && cs.teaSimmers === 0, `no deep-hollows spring/tea triggers at village (${cs.springDrips}, ${cs.teaSimmers})`);

// Cold Spring bamboo aqueduct gating: day <26m, night <34m
const sp = deepHollows.layout.soundAnchors.coldSpring;
cs = stepAudioFrames(sp.x, sp.z + 10, 90, { night: 0, isNight: false });
check(cs.springDrips >= 1, `coldSpring plays within 10m at day (count=${cs.springDrips})`);
const spBeforeDayFar = cs.springDrips;
cs = stepAudioFrames(sp.x, sp.z + 29, 90, { night: 0, isNight: false });
check(cs.springDrips === spBeforeDayFar, `coldSpring gated off at 29m (>26m) at day (${cs.springDrips} === ${spBeforeDayFar})`);
cs = stepAudioFrames(sp.x, sp.z + 29, 90, { night: 1, isNight: true });
check(cs.springDrips > spBeforeDayFar, `coldSpring audible at 29m (<34m) in quiet night (${cs.springDrips} > ${spBeforeDayFar})`);
const spBeforeNightFar = cs.springDrips;
cs = stepAudioFrames(sp.x, sp.z + 40, 90, { night: 1, isNight: true });
check(cs.springDrips === spBeforeNightFar, `coldSpring gated off at 40m (>34m) at night (${cs.springDrips} === ${spBeforeNightFar})`);

// Jade Tea Terrace clay stove gating: day <20m, deep night <26m
const ts = deepHollows.layout.soundAnchors.teaStove;
cs = stepAudioFrames(ts.x, ts.z + 10, 110, { night: 0, isNight: false });
check(cs.teaSimmers >= 1, `teaStove plays within 10m at day (count=${cs.teaSimmers})`);
const tsBeforeDayFar = cs.teaSimmers;
cs = stepAudioFrames(ts.x, ts.z + 23, 110, { night: 0, isNight: false });
check(cs.teaSimmers === tsBeforeDayFar, `teaStove gated off at 23m (>20m) at day (${cs.teaSimmers} === ${tsBeforeDayFar})`);
cs = stepAudioFrames(ts.x, ts.z + 23, 150, { night: 1, isNight: true });
check(cs.teaSimmers > tsBeforeDayFar, `teaStove audible at 23m (<26m) at deep night (${cs.teaSimmers} > ${tsBeforeDayFar})`);
const tsBeforeNightFar = cs.teaSimmers;
cs = stepAudioFrames(ts.x, ts.z + 30, 150, { night: 1, isNight: true });
check(cs.teaSimmers === tsBeforeNightFar, `teaStove gated off at 30m (>26m) at night (${cs.teaSimmers} === ${tsBeforeNightFar})`);

check(setTargetCalls === 0, `zero AudioParam.setTargetAtTime calls (got ${setTargetCalls})`);

// Suspended context & dt = 0 / frozen must create 0 new audio nodes
const nodesBeforeFreeze = audioNodesCreated;
dhSound.update(0, 100, { position: { x: sp.x, y: 2, z: sp.z + 5 }, rotation: { y: 0 } }, { x: sp.x, y: 2, z: sp.z + 5 }, true);
dhSound.syncWorld(0, dhPayload);
dhSound.context.state = 'suspended';
dhSound.bambooSpring(sp.x, sp.z);
dhSound.teaSimmer(ts.x, ts.z, { withEmberCrackle: true });
check(audioNodesCreated === nodesBeforeFreeze, `zero audio nodes allocated when frozen/suspended (${audioNodesCreated} === ${nodesBeforeFreeze})`);

globalThis.window = prevAudioWin;

outerWilds.dispose();
deepHollows.dispose();

console.log(JSON.stringify({ result: 'PASS', checks, pois: allPois.length, dhStats }));
