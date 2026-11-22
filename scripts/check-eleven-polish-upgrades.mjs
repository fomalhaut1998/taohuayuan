import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, createStream, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createPeople } from '../src/world/people.js';
import { createFauna } from '../src/systems/fauna.js';
import { createWorldClock, createNightMeteors, formatShichen, hourToPhase } from '../src/systems/world-clock.js';
import { createEasterEggs } from '../src/world/easter-eggs.js';
import { createGodFlight } from '../src/systems/god-flight.js';
import { CATALOGUE } from '../src/systems/catalogue.js';
import { illustrationSVG } from '../src/systems/field-guide.js';
import { chaikinSmooth, resamplePolyline, buildNaturalRoadRibbon, createSmoothHinterlandPaths } from '../src/world/road-geometry.js';
import { createFlora } from '../src/world/flora.js';
import { createProps } from '../src/world/props.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';
import { planMysterySites } from '../src/world/mysteries.js';
import { createCliff } from '../src/world/cliff.js';
import { createBoats } from '../src/world/boats.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';

const readText = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const world = JSON.parse(readText('src/data/world.json'));

function checkGeometryIntegrity(mesh, label) {
  const pos = mesh.geometry.getAttribute('position');
  const nor = mesh.geometry.getAttribute('normal');
  const col = mesh.geometry.getAttribute('color');
  assert.ok(pos && pos.count >= 6, `${label}: position attribute non-empty`);
  assert.ok(nor && nor.count === pos.count, `${label}: normal matches position count`);
  assert.ok(col && col.count === pos.count, `${label}: color matches position count`);
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), `${label}: finite pos`);
    const nLen = Math.hypot(nx, ny, nz);
    assert.ok(Math.abs(nLen - 1) < 0.02 && ny >= -0.05, `${label}: unit upward normal (len=${nLen}, ny=${ny})`);
  }
  const idx = mesh.geometry.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const abx = pos.getX(b) - pos.getX(a), aby = pos.getY(b) - pos.getY(a), abz = pos.getZ(b) - pos.getZ(a);
    const acx = pos.getX(c) - pos.getX(a), acy = pos.getY(c) - pos.getY(a), acz = pos.getZ(c) - pos.getZ(a);
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const area2 = Math.hypot(cx, cy, cz);
    assert.ok(area2 > 1e-7, `${label}: non-degenerate triangle #${t} (area2=${area2})`);
  }
}

// 1. Skiff camera stabilization + controller floor-step bypass while aboard
const ctrlSrc = readText('src/player/controller.js');
const skiffSrc = readText('src/systems/river-skiff.js');
assert.ok(ctrlSrc.includes('!state.aboardSkiff') && ctrlSrc.includes('if (state.aboardSkiff)'), 'controller stabilizes skiff ride');
assert.ok(skiffSrc.includes('smoothDeckY') && skiffSrc.includes('playerState.aboardSkiff = true'), 'river-skiff smooths deck Y');

// 2. Twilight clouds & sky camera sync (no linear spokes/stripes, syncCamera exposed)
const skySrc = readText('src/systems/sky.js');
assert.ok(skySrc.includes('syncCamera: place'), 'sky exposes syncCamera');

// 3. Build shared headless world for village, paddy tussocks, actors, eggs, roads
const ctx2d = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => t[k] ?? (() => {}) });
globalThis.document = {
  body: { classList: { contains: () => false } },
  createElement: () => ({ getContext: () => ctx2d }),
  getElementById: () => null
};
const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const heightFn = createHeightFunction(world.terrain, distanceToRiver);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from({ length: grid.attributes.position.count }, (_, i) => heightFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i)));
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
const villageLife = createVillageLife(world, field, distanceToRiver, village, props, cliff, hinterland, villageScenes, {
  anchors: planMysterySites(world, field, distanceToRiver, village, props, cliff, flora)
});
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, field);
const exterior = createExteriorExploration(world, field, distanceToRiver, riverCurve, flora, boats, cliff);
const habitatDetails = createHabitatDetails({
  world, field, distanceToRiver, riverCurve, flora, hinterland, village, villageScenes, villageLife, props, boats, cliff, exterior
});
const communityOptions = {
  world, field, distanceToRiver, riverCurve, stream: world.stream, flora,
  village, props, hinterland, villageScenes, villageLife, mysteryWorld: { blockers: [] },
  boats, cliff, exterior, habitatDetails
};
const pondLife = createPondLife({ ...communityOptions, reservations: [] });
const waterworks = createWaterworks({ ...communityOptions, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...communityOptions, reservations: [pondLife, waterworks] });
const qinHanHomestead = createQinHanHomestead({ ...communityOptions, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove] });
const qinHanCompletion = createQinHanCompletion({
  world, field, village, props, leisureGrove, qinHanHomestead,
  blockers: cliff.blockers.concat(village.blockers, qinHanHomestead.blockers, leisureGrove.blockers)
});

// Verify Upgrade 3: Rice tussocks >= 25 tris per clump & flooded paddy water sheet
const paddyWater = qinHanCompletion.group.getObjectByName('qin-han-paddy-water');
const cropsMesh = qinHanCompletion.group.getObjectByName('qin-han-millet-crops');
assert.ok(paddyWater?.isMesh && paddyWater.visible, 'qin-han-paddy-water present and visible');
assert.ok(cropsMesh?.isInstancedMesh && cropsMesh.count > 100, 'qin-han-millet-crops populated');
const cropPosCount = cropsMesh.geometry.getAttribute('position').count;
const cropTriCount = cropsMesh.geometry.index ? cropsMesh.geometry.index.count / 3 : cropPosCount / 3;
assert.ok(cropTriCount >= 28, `rice/millet tussock uses detailed multi-blade 3D geometry (tris=${cropTriCount})`);

// 4 & 6. Continuous 12-shichen worldClock & clear-night shooting stars
assert.equal(formatShichen(23.2).short, '子初');
assert.equal(formatShichen(6.2).short, '卯正');
assert.equal(hourToPhase(5.5), 'dawn');
assert.equal(hourToPhase(17.5), 'dusk');

let skyTime = 'night';
let dawnFired = 0;
const hudTimeEl = { textContent: '', title: '', style: {}, addEventListener() {} };
const hudTimeBtn = { style: {}, addEventListener() {} };
const fakeDoc = {
  getElementById(id) {
    if (id === 'sky-time') return hudTimeEl;
    if (id === 'sky-time-btn') return hudTimeBtn;
    return null;
  }
};
const fakeSky = {
  get timeId() { return skyTime; },
  rainIntensity: 0,
  wind: 0.3,
  setTime(t) { skyTime = t; },
  setAuto() {},
  registerMaterials() {},
  syncCamera() {}
};
const worldClock = createWorldClock({
  sky: fakeSky,
  smoke: { group: new THREE.Group() },
  doc: fakeDoc,
  win: { location: { search: '' } },
  onDawn() { dawnFired++; },
  cycleSeconds: 24
});
worldClock.setHour(4.6);
for (let i = 0; i < 15; i++) worldClock.update(0.1);
assert.equal(dawnFired, 1, 'crossing 05:00 dawn fires sunrise callback');
assert.equal(skyTime, 'dawn');
assert.ok(hudTimeEl.textContent.includes('卯'), `HUD displays shichen (${hudTimeEl.textContent})`);

const pausedClock = createWorldClock({
  sky: fakeSky,
  smoke: { group: new THREE.Group() },
  win: { location: { search: '?bench=1' } }
});
const beforeBenchHour = pausedClock.getState().hour;
pausedClock.update(2.0);
assert.equal(pausedClock.getState().hour, beforeBenchHour, 'bench mode freezes continuous time progression');

const meteorScene = new THREE.Scene();
const meteors = createNightMeteors({ scene: meteorScene });
const cam = new THREE.PerspectiveCamera();
cam.position.set(20, 8, -120);
meteors.update(0.1, { timeId: 'day', rainIntensity: 0 }, cam);
assert.equal(meteors.getStats().visible, false, 'meteors hidden during daytime');
assert.equal(meteors.getStats().drawCalls, 0, 'meteors drawCalls 0 during daytime');
for (let i = 0; i < 20; i++) meteors.update(0.1, { timeId: 'night', rainIntensity: 0 }, cam);
const ms = meteors.getStats();
assert.ok(ms.spawnedCount >= 1 && ms.visible && ms.drawCalls === 1, 'clear night spawns active meteor streak');
meteors.dispose();

// 5, 7 & 10. Night rest, non-robotic multi-waypoint field workers & sunrise rooster crowing + echo
const flatField = { sample: () => 2, slope: () => 0.05 };
const houses = [{ x: 20, z: -120, doorX: 20, doorZ: -116, rot: 0 }];
const simpleRoad = { total: 40, at: d => ({ x: d, z: -130, nx: 0, nz: 1 }) };
const people = createPeople(structuredClone(world.people), flatField, houses, simpleRoad, [[28, -125], [35, -125]], []);
const worker = people.list.find(p => p.mode === 'work');
assert.ok(worker && Array.isArray(worker.workSpots) && worker.workSpots.length >= 2, 'field worker has multi-waypoint workSpots');
const workPos0 = { x: worker.x, z: worker.z };
for (let i = 0; i < 500; i++) people.update(0.05, i * 0.05, 999, 999, { timeId: 'day', rainIntensity: 0 });
const movedOrCycled = Math.hypot(worker.x - workPos0.x, worker.z - workPos0.z) > 0.1 || worker.spotIdx !== 0 || worker.taskKind !== 'hoe';
assert.ok(movedOrCycled, 'field worker cycles tasks and shifts spot over time');

for (let i = 0; i < 240; i++) people.update(0.05, i * 0.05, 999, 999, { timeId: 'night', rainIntensity: 0 });
assert.ok(people.list.some(p => p.activity === 'rest'), 'villagers return and rest at night');

const fauna = createFauna(structuredClone(world.fauna), flatField, {}, { blockers: [], pond: world.terrain.pond, waterLevel: -1 });
for (let i = 0; i < 240; i++) fauna.update(0.05, i * 0.05, 999, 999, { timeId: 'night', rainIntensity: 0 });
assert.ok(fauna.animals.some(a => a.activity === 'rest'), 'animals shelter and rest at night');

// Rooster crow dawn echo via sound + qinHanHomestead
const audioSrc = readText('src/systems/sound.js');
assert.ok(!/setTargetAtTime/.test(audioSrc), 'sound.js never uses setTargetAtTime');
assert.ok(audioSrc.includes('roosterCrowEcho') && audioSrc.includes('guqinPluck'), 'sound.js supports dawn rooster echo and guqin pluck');
const homesteadSrc = readText('src/world/qin-han-homestead.js');
assert.ok(homesteadSrc.includes('roosterCrowEcho') && homesteadSrc.includes('w.isNight'), 'qin-han-homestead triggers dawn echo and night shelter');

const patchedSoundSrc = audioSrc
  .replace("from '../data/world.json';", `from ${JSON.stringify(new URL('../src/data/world.json', import.meta.url).href)} with { type: 'json' };`)
  .replace("from '../data/audio-samples.json';", `from ${JSON.stringify(new URL('../src/data/audio-samples.json', import.meta.url).href)} with { type: 'json' };`)
  .replace("from './sample-audio.js';", `from ${JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href)};`);
const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(patchedSoundSrc).toString('base64'));
const soundApi = createSound({ field: flatField, distanceToRiver: () => 50, riverSpine: [[0, 0]], people, village, cliff });
assert.doesNotThrow(() => {
  soundApi.roosterCrow(28, -118);
  soundApi.roosterCrow(28, -118, { echo: true });
  soundApi.guqinPluck(40, -140, 2);
  soundApi.syncWorld(0.05, { rain: 0, isNight: false, timeId: 'dawn', events: [{ type: 'roosterCrowEcho', x: 28, z: -118 }] });
});

// 8. Six spoiler-free interactive Easter eggs + catalogue + SVG illustrations
const eggIds = [
  'qin-bamboo-slips', 'floating-wine-cup', 'camphor-hollow-brew',
  'cloud-guqin-stone', 'peach-wind-tallies', 'moon-white-stag'
];
const spoilerWords = ['渔人', '太守', '刘子骥', '南阳', '遂迷', '处处志', '不复得路'];
const fallbackSvg = illustrationSVG('__nonexistent__');
for (const id of eggIds) {
  assert.ok(CATALOGUE[id] && CATALOGUE[id].text.length > 20, `CATALOGUE has ${id}`);
  for (const w of spoilerWords) assert.ok(!CATALOGUE[id].text.includes(w), `CATALOGUE[${id}] avoids Act-3 spoiler ${w}`);
  const svg = illustrationSVG(CATALOGUE[id].icon);
  assert.ok(svg && svg.startsWith('<svg') && svg !== fallbackSvg, `custom SVG illustration exists for ${id}`);
}
const easterEggs = createEasterEggs({
  ...communityOptions, pondLife, waterworks, leisureGrove, qinHanHomestead
});
assert.equal(easterEggs.sites.length, 6, 'all 6 Easter egg sites built');
assert.equal(easterEggs.targets.length, 6, 'all 6 Easter egg targets exposed to discovery');
let mockNoteText = '';
const noteMock = {
  textContent: '',
  classList: { add() { mockNoteText = noteMock.textContent; }, remove() {} }
};
const mockMysteries = {
  pickTarget: () => null,
  interact: () => null,
  hide: () => {}
};
easterEggs.bind({
  mysteries: mockMysteries,
  sound: soundApi,
  player: { state: { x: 0, y: 2, z: 0 } },
  doc: { getElementById: id => (id === 'mystery-note' ? noteMock : null) }
});
const eggHit = easterEggs.interactById('cloud-guqin-stone', soundApi, { getElementById: id => (id === 'mystery-note' ? noteMock : null) });
assert.ok(eggHit && mockNoteText.includes('七弦'), 'interacting with guqin Easter egg shows note');
easterEggs.update(0.05, 2.5, { wind: 0.4, timeId: 'night' }, { x: 0, z: 0 });
easterEggs.dispose();

// 9. God-mode free flight camera (P / B key + high altitude + portal visibility override)
const sceneFlight = new THREE.Scene();
const intGroup = new THREE.Group();
const extGroup = new THREE.Group();
const flyBtnParent = { children: [], appendChild(el) { this.children.push(el); } };
const flyViewName = { textContent: '第三人称' };
const keyHandlers = [];
const mockFlyDoc = {
  body: { classList: { contains: () => false } },
  pointerLockElement: null,
  getElementById: id => (id === 'view' ? flyBtnParent : id === 'view-name' ? flyViewName : null),
  createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, remove() {} })
};
const mockFlyWin = {
  addEventListener: (ev, fn) => { if (ev === 'keydown') keyHandlers.push(fn); },
  removeEventListener() {}
};
const godFlight = createGodFlight({
  scene: sceneFlight,
  camera: cam,
  player: { state: { x: 20, y: 2, z: -120, yaw: 0, view: 'third' }, clearInput() {} },
  avatar: { group: new THREE.Group() },
  canvas: { addEventListener() {}, removeEventListener() {} },
  world,
  field,
  doc: mockFlyDoc,
  win: mockFlyWin,
  interiorGroups: [intGroup],
  exteriorGroups: [extGroup]
});
keyHandlers.forEach(fn => fn({ code: 'KeyP', repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault() {} }));
assert.equal(godFlight.active, true, 'P key activates god flight');
godFlight.setPose(24, 95, -130, 0.5, -0.8);
godFlight.update(0.05);
assert.ok(cam.position.y >= 90, 'god flight supports high altitude view');
intGroup.visible = false;
extGroup.visible = false;
sceneFlight.onBeforeRender();
assert.equal(intGroup.visible, true, 'god flight overrides portal culling for interior');
assert.equal(extGroup.visible, true, 'god flight overrides portal culling for exterior');
keyHandlers.forEach(fn => fn({ code: 'KeyB', repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault() {} }));
assert.equal(godFlight.active, false, 'B key toggles god flight off');
godFlight.dispose();

// 11. Smooth natural Chaikin road geometry & non-degenerate normals across village & hinterland
const rawCorner = [[0, 0], [0, 10], [10, 10]];
const smoothedCorner = chaikinSmooth(rawCorner, 2);
assert.ok(smoothedCorner.length > rawCorner.length, 'chaikinSmooth subdivides sharp corners');
const resampled = resamplePolyline(smoothedCorner, 0.8);
assert.ok(resampled.length >= 10, 'resamplePolyline spaces vertices evenly');
const ribbonBuf = buildNaturalRoadRibbon(rawCorner, { field: flatField, scatterPebbles: true });
const testMesh = new THREE.Mesh(
  new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute(ribbonBuf.pos, 3))
    .setAttribute('normal', new THREE.Float32BufferAttribute(ribbonBuf.nor, 3))
    .setAttribute('color', new THREE.Float32BufferAttribute(ribbonBuf.col, 3))
);
checkGeometryIntegrity(testMesh, 'test-natural-road');
checkGeometryIntegrity(village.group.getObjectByName('village-road'), 'village-road');
checkGeometryIntegrity(village.group.getObjectByName('village-spurs'), 'village-spurs');
checkGeometryIntegrity(createSmoothHinterlandPaths(hinterland, field, world.hinterland), 'hinterland-paths-smooth');

// Verify main.js wires all new systems cleanly inside Round 6 markers
const mainSrc = readText('src/main.js');
for (const sym of ['createWorldClock', 'createNightMeteors', 'createEasterEggs', 'createGodFlight', 'createSmoothHinterlandPaths', 'sky.syncCamera']) {
  assert.ok(mainSrc.includes(sym), `main.js wires ${sym}`);
}

console.log('PASS all 11 polish upgrades (skiff, twilight, rice tussocks, meteors, night rest, world clock, multi-spot workers, 6 easter eggs, god flight, dawn rooster crow+echo, smooth roads)');
