import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
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
import { buildQinHanStatic } from '../src/world/qin-han-props.js';
import { createSmoke } from '../src/systems/smoke.js';
import { createSeasonalGathering } from '../src/systems/seasonal-gathering.js';
import { createAvatar } from '../src/player/avatar.js';
import { CATALOGUE, catalogueEntry } from '../src/systems/catalogue.js';
import { illustrationSVG } from '../src/systems/field-guide.js';
import { collectDiscoveryTargets, resolveDiscoveryTarget } from '../src/systems/discovery-targets.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const scriptData = JSON.parse(readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8'));

const NEW_IDS = [
  'casement-window', 'brushwood-gate', 'eave-herbs', 'swallow-nest', 'chopping-axe',
  'oblique-loom', 'indigo-vat', 'carpenter-bench', 'clay-li-dou',
  'field-hut', 'wooden-plow', 'wallowing-buffalo', 'hen-chicks',
  'radish-basket', 'calamus', 'clay-fou'
];

// 1. Era-accuracy & spoiler & production code hygiene guards
const propsSrc = readFileSync(new URL('../src/world/props.js', import.meta.url), 'utf8');
assert.ok(!propsSrc.includes('#C1543A') && !propsSrc.includes('#D8B459'), '明代辣椒/玉米配色已清除');
for (const file of ['../src/world/qin-han-props.js', '../src/world/qin-han-homestead.js', '../src/world/qin-han-fauna-geometry.js', '../src/systems/seasonal-gathering.js', '../src/systems/smoke.js']) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.ok(!/\bconsole\.log\s*\(/.test(src), `no console.log in ${file}`);
}
const soundSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
assert.ok(!/setTargetAtTime/.test(soundSrc), 'sound.js remains free of setTargetAtTime');
const npcText = JSON.stringify(scriptData.npc || {});
for (const taboo of ['处处志', '太守', '刘子骥', '遂迷', '不复得路']) {
  assert.ok(!npcText.includes(taboo), `script.npc free of Act-3 ambient spoiler: ${taboo}`);
  assert.ok(
    (scriptData.points || []).filter((p) => JSON.stringify(p).includes(taboo)).every((p) => p.manual === true),
    `Act-3 point strictly manual-gated: ${taboo}`
  );
}
for (const role of ['weaver', 'carpenter', 'bamboo_artisan', 'hut_farmer']) {
  assert.ok(scriptData.npc?.roles?.[role]?.lines?.length >= 2, `NPC dialogue exists: ${role}`);
}

// 2. Catalogue + distinct SVG artwork check
const fallbackSvg = illustrationSVG('__nonexistent__');
for (const id of NEW_IDS) {
  const entry = catalogueEntry(id);
  assert.ok(entry && entry.name && entry.text, `CATALOGUE entry exists: ${id}`);
  if (entry.icon !== 'leaf') {
    assert.notEqual(illustrationSVG(entry.icon), fallbackSvg, `dedicated SVG exists for ${id} (${entry.icon})`);
  }
}

// 3. Build complete real world
const ctx = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => t[k] ?? (() => {}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
const curve = createRiverCurve(world.stream.points);
const river = createRiverDistance(sampleRiverSpine(curve, 160));
const height = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from({ length: grid.attributes.position.count }, (_, i) => height(grid.attributes.position.getX(i), grid.attributes.position.getZ(i)));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const cliff = createCliff(world.cliff, field);
const basin = world.terrain.basin;
const floraField = { half: field.half, sample: (x, z) => field.sample(x, z), slope: (x, z) => Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z) };
const near = (x, z) => Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34 || Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40 || world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);
const flora = createFlora(world.flora, floraField, river, curve, world.player.spawn, near);
const boats = createBoats(world.boats, { surfaceY: () => world.terrain.waterLevel }, world.terrain, curve, field);
const village = createVillage(structuredClone(world.village), field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const scenes = createVillageScenes(world, field, river, village, props, cliff, hinterland);
const sites = planMysterySites(world, field, river, village, props, cliff, hinterland, scenes, flora);
const life = createVillageLife(world, field, river, village, props, cliff, hinterland, scenes, { sites });
const exterior = createExteriorExploration(world, field, river, curve, flora, boats, cliff);
const options = { world, field, distanceToRiver: river, riverCurve: curve, flora, hinterland, village, villageScenes: scenes, villageLife: life, props, boats, cliff, exterior };
options.habitatDetails = createHabitatDetails(options);
const pondLife = createPondLife(options);
const waterworks = createWaterworks({ ...options, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...options, reservations: [pondLife, waterworks] });

const qhOptions = { ...options, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove] };
const homestead = createQinHanHomestead(qhOptions);
const homesteadAgain = createQinHanHomestead(qhOptions);

// 4. Determinism + Draw call / Triangle Budgets + Finite Geometry
const stats = homestead.getStats();
console.log('qin-han-homestead stats:', JSON.stringify(stats));
assert.ok(stats.staticTris > 500 && stats.staticTris <= 6500, `staticTris=${stats.staticTris} <= 6500`);
assert.ok(stats.triangles <= 12000, `total triangles=${stats.triangles} <= 12000`);
assert.ok(stats.drawCalls <= 8, `non-rig drawCalls=${stats.drawCalls} <= 8`);
assert.equal(stats.villagers, 4, '4 new living artisan villagers');
assert.equal(stats.swallowCount, 6, '6 eave swallows');
assert.equal(stats.striderCount, 6, '6 pond striders');
assert.equal(stats.poultrySculpted, true, 'sculpted vertex-colored poultry enabled');
assert.equal(stats.henClearOfThresh, true, 'hen spawns clear of thresh overhanging rim');
assert.ok(stats.henPos && Number.isFinite(stats.henPos.x), 'henPos reported cleanly');
for (const t of props.marks.filter(m => m.kind === 'thresh')) {
  assert.ok(Math.hypot(stats.henPos.x - t.x, stats.henPos.z - t.z) > (t.r || 6.4) + 2.0, 'henPos outside thresh radius + 2m');
}
for (const name of ['qin-han-hen', 'qin-han-chicks', 'qin-han-rooster']) {
  const obj = homestead.group.getObjectByName(name);
  assert.ok(obj, `sculpted poultry object exists: ${name}`);
  obj.traverse(m => {
    if (!m.isMesh) return;
    const col = m.geometry.getAttribute('color');
    assert.ok(col && col.count > 0 && [...col.array].every(Number.isFinite), `finite vertex colors on ${name}`);
  });
}
assert.deepEqual(homesteadAgain.layout, homestead.layout, 'deterministic layout across runs');

homestead.group.traverse(obj => {
  if (!obj.isMesh) return;
  const pos = obj.geometry.attributes.position;
  assert.ok([...pos.array].every(Number.isFinite), `finite geometry positions: ${obj.name}`);
  if (obj.isInstancedMesh) {
    assert.ok([...obj.instanceMatrix.array].every(Number.isFinite), `finite instanceMatrix: ${obj.name}`);
  }
});

// 5. Road & spur clearance for blockers
const boxGap = (x, z, b) => {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), dx = x - b.x, dz = z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - b.hw), Math.max(0, Math.abs(dx * s + dz * c) - b.hd));
};
for (const b of homestead.blockers) {
  for (let i = 1; i < world.village.road.points.length; i++) {
    const p0 = world.village.road.points[i - 1], p1 = world.village.road.points[i];
    for (let s = 0; s <= 10; s++) {
      const f = s / 10;
      const rx = p0[0] + (p1[0] - p0[0]) * f, rz = p0[1] + (p1[1] - p0[1]) * f;
      assert.ok(boxGap(rx, rz, b) > world.village.road.width * 0.45, `blocker ${b.tag} clears main road`);
    }
  }
  for (const hi of village.houseInfo) {
    const pts = hi.spur?.pts || [];
    for (const pt of pts) {
      assert.ok(boxGap(pt[0], pt[1], b) > 0.35, `blocker ${b.tag} clears house door spur`);
    }
  }
}

// 6. Discovery integration check
for (const t of homestead.targets) leisureGrove.targets.push(t);
const discovered = collectDiscoveryTargets({ ...options, pondLife, waterworks, leisureGrove, qinHanHomestead: homestead });
const foundIds = new Set(discovered.map(t => t.id));
for (const id of NEW_IDS) {
  assert.ok(foundIds.has(id), `discovery target registered & reachable: ${id}`);
  const desc = discovered.find(t => t.id === id);
  const res = resolveDiscoveryTarget(desc);
  assert.ok([res.x, res.y, res.z].every(Number.isFinite), `finite resolved target: ${id}`);
}
// No duplicates from shared references
assert.equal(discovered.filter(t => t.id === 'wallowing-buffalo').length, 1, 'no duplicate wallowing-buffalo');

// 7. Dynamic Weather, Smoke & Pause Freeze Triggers
const chimneys = village.houseInfo.slice(0, 4).map(h => ({ x: h.x, y: h.gy + h.h + 1.8, z: h.z }));
const smoke = createSmoke(world.smoke, chimneys);

const calmDay = { rainIntensity: 0, wind: 0.1, windX: 0.1, windZ: 0.05, cloudCover: 0.2, timeId: 'day', sunElevation: 0.7 };
smoke.setWeather(calmDay);
smoke.update(0.05, 1.0);
const calmSmokeRise = smoke.getStats().effectiveRise;

const stormDay = { rainIntensity: 1.0, wind: 0.9, windX: 0.85, windZ: 0.3, cloudCover: 0.9, timeId: 'day', sunElevation: 0.45 };
for (let i = 0; i < 70; i++) homestead.update(0.05, 1 + i * 0.05, stormDay, { x: world.player.spawn.x, z: world.player.spawn.z });
const stormStats = homestead.getStats();
assert.ok(stormStats.shelterBlend > 0.85, `storm stows trays & shelters animals (${stormStats.shelterBlend})`);
assert.equal(stormStats.rainCurtainVisible, true, 'eave rain curtains appear in rain');
assert.equal(stormStats.bonfireVisible, false, 'bonfire stays extinguished in daytime rain');
assert.equal(stormStats.swallowPerchCount, 6, 'all swallows roost in nests during storm');

smoke.setWeather(stormDay);
smoke.update(0.05, 4.5);
const stormSmokeRise = smoke.getStats().effectiveRise;
assert.ok(stormSmokeRise <= calmSmokeRise * 0.65, `smoke pressed low in storm (${calmSmokeRise} -> ${stormSmokeRise})`);

// Return to clear day then clear night
const clearDay = calmDay;
for (let i = 0; i < 160; i++) homestead.update(0.05, 5 + i * 0.05, clearDay, { x: 0, z: 0 });
const backCalm = homestead.getStats();
assert.ok(backCalm.shelterBlend < 0.1, `sun returns trays outside (${backCalm.shelterBlend})`);
assert.equal(backCalm.rainCurtainVisible, false, 'eave rain curtains hide on clear day');
assert.equal(backCalm.swallowPerchCount, 0, 'swallows fly out on clear day');

const clearNight = { rainIntensity: 0, wind: 0.1, windX: 0.1, windZ: 0, cloudCover: 0.1, timeId: 'night', sunElevation: -0.4 };
homestead.update(0.05, 15, clearNight, { x: 0, z: 0 });
const nightStats = homestead.getStats();
assert.equal(nightStats.bonfireVisible, true, 'bonfire burns on clear night');
assert.equal(nightStats.swallowPerchCount, 6, 'swallows roost at night');

const rainyNight = { rainIntensity: 0.8, wind: 0.6, windX: 0.4, windZ: 0.4, cloudCover: 0.9, timeId: 'night', sunElevation: -0.4 };
homestead.update(0.05, 15.1, rainyNight, { x: 0, z: 0 });
assert.equal(homestead.getStats().bonfireVisible, false, 'bonfire extinguishes in rainy night');

// Yellow dog greets nearby player
const hi0 = village.houseInfo[0];
const dogX = hi0.x + 0.92 * Math.cos(hi0.rot) + (hi0.d * 0.5 + 0.36) * Math.sin(hi0.rot);
const dogZ = hi0.z - 0.92 * Math.sin(hi0.rot) + (hi0.d * 0.5 + 0.36) * Math.cos(hi0.rot);
homestead.update(0.05, 16, clearDay, { x: dogX + 1.0, z: dogZ + 1.0 });
assert.equal(homestead.getStats().dogAlert, true, 'yellow dog alerts & wags tail when player approaches');

// Pause freeze guard (dt <= 0 / NaN / Infinity)
const snap = () => {
  const out = [];
  homestead.group.traverse(o => {
    if (o.isInstancedMesh) out.push(Array.from(o.instanceMatrix.array.slice(0, 48)));
  });
  return JSON.stringify(out);
};
const frozenBefore = snap();
for (const dt of [0, -0.5, NaN, Infinity]) homestead.update(dt, 999, clearDay, { x: 0, z: 0 });
assert.equal(snap(), frozenBefore, 'invalid dt freezes animations cleanly');

// 8. Gate creak, dawn rooster crow, and hen sprint startle events
const staticProbe = buildQinHanStatic(qhOptions);
const gate0 = staticProbe.anchors.gates[0];
staticProbe.mesh.geometry.dispose();
staticProbe.mesh.material.dispose();
if (gate0) {
  homestead.consumeEvents();
  homestead.update(0.05, 20.0, clearDay, { x: gate0.hx + 0.4, z: gate0.hz + 0.4 });
  const gs = homestead.getStats().gateStates;
  assert.ok(gs.length > 0 && gs[0].swingOffset !== 0, 'approaching player swings brushwood gate open');
  assert.ok(homestead.consumeEvents().some(e => e.type === 'gateCreak'), 'swinging gate emits gateCreak event');
}

const dawnDay = { rainIntensity: 0, wind: 0.1, windX: 0.1, windZ: 0, cloudCover: 0.2, timeId: 'dawn', sunElevation: 0.15 };
homestead.consumeEvents();
let flapStep = -1;
let crowStep = -1;
let maxWingSpread = 0;
let crowObserved = false;
for (let i = 0; i < 12; i++) {
  homestead.update(0.05, 21 + i * 0.05, dawnDay, { x: 0, z: 0 });
  const evs = homestead.consumeEvents();
  if (flapStep < 0 && evs.some(e => e.type === 'roosterFlap')) flapStep = i;
  if (flapStep >= 0 && crowStep < 0 && evs.some(e => e.type === 'roosterCrow')) crowStep = i;
  const st = homestead.getStats();
  if (st.roosterCrowing) crowObserved = true;
  if (st.roosterWingSpread > maxWingSpread) maxWingSpread = st.roosterWingSpread;
}
assert.ok(
  flapStep >= 0 && crowStep >= flapStep + 3 && crowObserved && maxWingSpread > 0.35,
  `dawn rooster flaps wings 0.18s before crowing (flapStep=${flapStep}, crowStep=${crowStep}, maxWingSpread=${maxWingSpread})`
);

const hp = homestead.getStats().henPos;
for (const t of props.marks.filter(m => m.kind === 'thresh')) {
  assert.ok(Math.hypot(hp.x - t.x, hp.z - t.z) > (t.r || 6.4) + 2.0, 'foraging hen stays clear of thresh rim');
}
homestead.consumeEvents();
homestead.update(0.05, 22, clearDay, { x: hp.x + 1.0, z: hp.z + 1.0, sprinting: true });
assert.ok(homestead.consumeEvents().some(e => e.type === 'henStartle'), 'sprinting near hen emits henStartle event');

// 9. Sound world synchronization & gating
{
  class MockParam {
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
  }
  class MockNode {
    constructor() {
      this.gain = new MockParam(1); this.frequency = new MockParam(440);
      this.Q = new MockParam(1); this.pan = new MockParam(0); this.playbackRate = new MockParam(1);
    }
    connect(d) { return d; }
    disconnect() {}
    start() {}
    stop() {}
  }
  class MockAudioContext {
    constructor() { this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 1000; this.destination = new MockNode(); }
    createGain() { return new MockNode(); }
    createBiquadFilter() { return new MockNode(); }
    createStereoPanner() { return new MockNode(); }
    createConvolver() { return new MockNode(); }
    createOscillator() { return new MockNode(); }
    createBufferSource() { return new MockNode(); }
    createDynamicsCompressor() {
      const n = new MockNode();
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new MockParam();
      return n;
    }
    createAnalyser() {
      const n = new MockNode(); n.frequencyBinCount = 1024;
      n.getByteTimeDomainData = a => a.fill(128); n.getByteFrequencyData = a => a.fill(0);
      return n;
    }
    createBuffer(ch, len, rate) { return { duration: len / rate, length: len, numberOfChannels: ch, getChannelData: () => new Float32Array(len) }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const soundModuleSrc = soundSrc
    .replace("import world from '../data/world.json';", `const world = ${JSON.stringify(world)};`)
    .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = { version: 1, clips: [] };')
    .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
  const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(soundModuleSrc).toString('base64'));
  const prevWin = globalThis.window;
  globalThis.window = { AudioContext: MockAudioContext };
  const sound = createSound({ village, cliff, audioCatalogue: { version: 1, clips: [] }, audioFetch: async () => ({ ok: false }) });
  assert.equal(sound.unlock(), true, 'mock sound unlocks cleanly');
  const pondLoc = world.terrain.pond;
  sound.update(0.05, 1, null, { x: pondLoc.x, y: 1, z: pondLoc.z, yaw: 0 }, false);

  assert.equal(sound.laundryPound(pondLoc.x, pondLoc.z, 2), true, 'laundryPound plays');
  assert.equal(sound.wheelCreak(pondLoc.x, pondLoc.z, 0.7), true, 'wheelCreak plays');
  assert.equal(sound.gateCreak(pondLoc.x, pondLoc.z), true, 'gateCreak plays');
  assert.equal(sound.roosterCrow(pondLoc.x, pondLoc.z), true, 'roosterCrow plays');
  assert.equal(sound.gatherSound('fan', pondLoc.x, pondLoc.z), true, 'gatherSound fan plays');
  assert.equal(sound.gatherSound('hoe', pondLoc.x, pondLoc.z), true, 'gatherSound hoe plays');
  assert.equal(sound.frog(pondLoc.x, pondLoc.z), true, 'frog plays');

  const ws0 = sound.getStats().worldSync;
  assert.deepEqual(ws0, { laundryPounds: 1, wheelCreaks: 1, gateCreaks: 1, roosterCrows: 1, gathers: 2 });
  assert.equal(sound.getStats().counts.frogs, 1);

  // Sync waterwheel across pi phase + sync events + suppress laundry in rain/night/freeze
  sound.syncWorld(0.05, { rain: 0, isNight: false, washStation: { x: pondLoc.x, z: pondLoc.z }, wheel: { x: pondLoc.x, z: pondLoc.z, phase: 3.0 }, events: [] });
  sound.syncWorld(0.05, { rain: 0, isNight: false, washStation: { x: pondLoc.x, z: pondLoc.z }, wheel: { x: pondLoc.x, z: pondLoc.z, phase: 3.3 }, events: [{ type: 'gateCreak', x: pondLoc.x, z: pondLoc.z }, { type: 'roosterFlap', x: pondLoc.x, z: pondLoc.z }, { type: 'roosterCrow', x: pondLoc.x, z: pondLoc.z }] });
  const ws1 = sound.getStats().worldSync;
  assert.equal(ws1.wheelCreaks, 2, 'wheel phase crossing PI triggers wheelCreak');
  assert.equal(ws1.gateCreaks, 2, 'syncWorld dispatches gateCreak event');
  assert.equal(ws1.roosterCrows, 2, 'syncWorld dispatches roosterCrow event');
  assert.equal(sound.getStats().completionSync.roosterFlaps, 1, 'syncWorld dispatches roosterFlap event');

  const beforeSuppress = ws1.laundryPounds;
  for (let i = 0; i < 40; i++) sound.syncWorld(0.1, { rain: 0.8, isNight: false, washStation: { x: pondLoc.x, z: pondLoc.z } });
  for (let i = 0; i < 40; i++) sound.syncWorld(0.1, { rain: 0, isNight: true, washStation: { x: pondLoc.x, z: pondLoc.z } });
  assert.equal(sound.getStats().worldSync.laundryPounds, beforeSuppress, 'laundryPound suppressed in rain and night');

  const beforeFreeze = JSON.stringify(sound.getStats().worldSync);
  sound.syncWorld(0, { rain: 0, isNight: false, events: [{ type: 'gateCreak', x: 0, z: 0 }] });
  assert.equal(JSON.stringify(sound.getStats().worldSync), beforeFreeze, 'syncWorld freezes when dt <= 0');

  sound.disposeSamples();
  await sound.context?.close?.();
  if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
}

// 10. Seasonal gathering (night pondside firefly fan + rain/day bamboo-grove shoot hoe)
{
  const gathering = createSeasonalGathering({ world, field, pondLife, leisureGrove });
  const avatar = createAvatar(world.player.avatar, world.player.walkSpeed);
  const noteClasses = new Set();
  const noteEl = {
    textContent: '',
    classList: { add: c => noteClasses.add(c), remove: c => noteClasses.delete(c), contains: c => noteClasses.has(c) }
  };
  const sgDoc = {
    hidden: false,
    hasFocus: () => true,
    activeElement: null,
    body: { classList: { contains: () => false } },
    getElementById: id => (id === 'mystery-note' ? noteEl : null),
    querySelector: () => null
  };
  const gatherAudioCalls = [];
  const sgPlayer = { state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, eyeHeight: 1.65, view: 'third', vx: 0, vz: 0 } };
  const sgSky = { timeId: 'night', weatherId: 'clear', rainIntensity: 0, sunElevation: -0.4, getAppearance: () => sgSky };
  const sgMysteries = { pickTarget: () => null, interact: () => null, hide() {} };
  const sgSound = { unlock: () => true, gatherSound: (k) => { gatherAudioCalls.push(k); return true; } };
  const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 100);

  gathering.bind({ avatar, camera: cam, player: sgPlayer, sky: sgSky, mysteries: sgMysteries, sound: sgSound, field, blockers: [], doc: sgDoc });

  // Dry clear day -> 3 shoot clusters active
  const shSite = gathering.getStats().shootSites[0];
  const dryClearSky = { timeId: 'day', weatherId: 'clear', rainIntensity: 0, sunElevation: 0.65, getAppearance: () => dryClearSky };
  sgPlayer.state.x = shSite.x - 1.4;
  sgPlayer.state.z = shSite.z;
  sgPlayer.state.y = shSite.y;
  gathering.update(0.05, 0.5, dryClearSky, sgPlayer.state, cam);
  assert.equal(gathering.getStats().shootActiveCount, 3, 'dry clear day activates 3 shoot clusters');
  assert.equal(gathering.getStats().currentTool, 'hoe', 'switches to bamboo hoe near clear-day shoots');

  // Clear night pondside firefly gathering -> bamboo fan
  const ffSite = gathering.getStats().fireflySites[0];
  sgPlayer.state.x = ffSite.x - 1.5;
  sgPlayer.state.z = ffSite.z;
  sgPlayer.state.y = ffSite.y;
  sgPlayer.state.yaw = Math.atan2(sgPlayer.state.x - ffSite.x, sgPlayer.state.z - ffSite.z);
  sgPlayer.state.pitch = 0;
  gathering.update(0.05, 1, sgSky, sgPlayer.state, cam);
  assert.equal(gathering.getStats().fireflyActive, true, 'fireflies active on clear night');
  assert.equal(gathering.getStats().currentTool, 'fan', 'switches to bamboo fan near night pond fireflies');
  assert.equal(gathering.getStats().shootActiveCount, 0, 'bamboo shoots dormant at night');
  const ffTarget = sgMysteries.pickTarget(cam, { alignBias: 2 });
  assert.equal(ffTarget?.prompt, '执扇轻扑 · 池畔流萤', 'pickTarget offers fan firefly prompt');
  const ffRes = sgMysteries.interact(ffTarget);
  assert.equal(ffRes?.kind, 'firefly', 'interact captures firefly');
  assert.equal(gathering.getStats().fireflyCount, 1, 'firefly count incremented');
  assert.equal(noteClasses.has('show'), true, 'poetic note displayed on firefly catch');

  // Rainy day rear bamboo grove shoots -> small hoe (5 sites)
  sgSky.timeId = 'day'; sgSky.weatherId = 'rain'; sgSky.rainIntensity = 0.65; sgSky.sunElevation = 0.5;
  sgPlayer.state.x = shSite.x - 1.4;
  sgPlayer.state.z = shSite.z;
  sgPlayer.state.y = shSite.y;
  sgPlayer.state.yaw = Math.atan2(sgPlayer.state.x - shSite.x, sgPlayer.state.z - shSite.z);
  sgPlayer.state.pitch = Math.atan2((shSite.y + 0.18) - (sgPlayer.state.y + 1.65), 1.4);
  gathering.update(0.05, 2, sgSky, sgPlayer.state, cam);
  assert.equal(gathering.getStats().shootActiveCount, 5, '5 post-rain shoot clusters active');
  assert.equal(gathering.getStats().currentTool, 'hoe', 'switches to bamboo hoe near bamboo shoots');
  const shTarget = sgMysteries.pickTarget(cam, { alignBias: 2 });
  assert.equal(shTarget?.prompt, '执锄采挖 · 雨后春笋', 'pickTarget offers wet bamboo shoot prompt');
  const shRes = sgMysteries.interact(shTarget);
  assert.equal(shRes?.kind, 'bamboo', 'interact digs bamboo shoot');
  assert.equal(gathering.getStats().shootCount, 1, 'bamboo shoot count incremented');
  assert.deepEqual(gatherAudioCalls, ['fan', 'hoe'], 'gatherSound invoked for fan and hoe');

  // Freeze guard & dry-day clear count check & dispose
  const sgSnap = () => {
    const m = [];
    gathering.group.traverse(o => { if (o.isInstancedMesh) m.push(Array.from(o.instanceMatrix.array.slice(0, 32))); });
    return JSON.stringify(m);
  };
  const sgFrozenBefore = sgSnap();
  for (const dt of [0, -0.5, NaN, Infinity]) gathering.update(dt, 99, sgSky, sgPlayer.state, cam);
  assert.equal(sgSnap(), sgFrozenBefore, 'seasonalGathering freezes cleanly on invalid dt');

  gathering.dispose();
  assert.equal(gathering.getStats().disposed, true, 'seasonalGathering disposes cleanly');
}

// Dispose cleanup
homestead.dispose();
homesteadAgain.dispose();
assert.equal(homestead.getStats().disposed, true, 'dispose marks homestead disposed');
console.log('ALL qin-han-enrichment CHECKS PASSED!');
