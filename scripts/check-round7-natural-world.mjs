import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

import { ROUND6_BLOCKS, stripRound6Main } from './round6-main-delta.mjs';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, createStream, sampleRiverSpine } from '../src/world/stream.js';
import { createFlora } from '../src/world/flora.js';
import { createFloraWind } from '../src/systems/flora-wind.js';
import { installSkyAppearance } from '../src/systems/scene-appearance.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createScatter } from '../src/world/scatter.js';
import { createProps } from '../src/world/props.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { planMysterySites } from '../src/world/mysteries.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createBoats } from '../src/world/boats.js';
import { createExteriorExploration, exteriorTreeReservations } from '../src/world/exterior-exploration.js';
import { createHabitatDetails } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createHospitalityFeast } from '../src/world/hospitality-feast.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createEasterEggs } from '../src/world/easter-eggs.js';
import { createFish } from '../src/world/fish.js';
import { makePeopleParts } from '../src/character-parts.js';
import { createPeople } from '../src/world/people.js';
import { createAvatar } from '../src/player/avatar.js';
import { createSituationalRest } from '../src/systems/situational-rest.js';
import { createQuiet } from '../src/systems/quiet.js';

const readText = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const world = JSON.parse(readText('src/data/world.json'));

// Minimal DOM shim for headless systems
const ctx2d = new Proxy({
  createRadialGradient: () => ({ addColorStop() {} }),
  createImageData: (w, h) => ({ data: new Uint8ClampedArray((w || 64) * (h || 64) * 4) })
}, { get: (t, k) => t[k] ?? (() => {}) });
const makeClassList = () => {
  const set = new Set();
  return {
    add: (...xs) => xs.forEach(x => set.add(x)),
    remove: (...xs) => xs.forEach(x => set.delete(x)),
    contains: x => set.has(x),
    toggle: (x, force) => {
      const on = force === undefined ? !set.has(x) : Boolean(force);
      if (on) set.add(x); else set.delete(x);
      return on;
    }
  };
};
const domEls = new Map();
function getEl(id) {
  if (!domEls.has(id)) {
    domEls.set(id, {
      id,
      textContent: '',
      hidden: true,
      open: false,
      style: {},
      dataset: {},
      classList: makeClassList(),
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {}
    });
  }
  return domEls.get(id);
}
const winListeners = new Map();
const mockWin = {
  addEventListener(type, fn) {
    if (!winListeners.has(type)) winListeners.set(type, new Set());
    winListeners.get(type).add(fn);
  },
  removeEventListener(type, fn) {
    winListeners.get(type)?.delete(fn);
  }
};
const mockDoc = {
  body: { classList: makeClassList() },
  createElement: () => ({ getContext: () => ctx2d, style: {}, classList: makeClassList() }),
  getElementById: id => getEl(id)
};
globalThis.document = mockDoc;

// ============================================================================
// 1. Terrain smooth shading & shoreline vertex color clamping
// ============================================================================
const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const terrain = createTerrain(world.terrain, distanceToRiver, { road: world.village.road, pond: world.terrain.pond });
terrain.field.colorAt = terrain.colorAt;

assert.equal(terrain.mesh.material.flatShading, false, 'terrain uses smooth shading to eliminate 4.17m facets');
const tNor = terrain.mesh.geometry.getAttribute('normal');
const tCol = terrain.mesh.geometry.getAttribute('color');
assert.ok(tNor && tNor.count === tCol.count, 'terrain computes smooth vertex normals');
for (let i = 0; i < tCol.count; i++) {
  const r = tCol.getX(i), g = tCol.getY(i), b = tCol.getZ(i);
  assert.ok(r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1, 'terrain vertex colors clamped in [0,1]');
  const ny = tNor.getY(i);
  assert.ok(Number.isFinite(ny) && ny > 0.1, 'terrain normals point upward');
}

// ============================================================================
// 2. Cliff 青绿山水 crags, Flora crowns + exact layout fingerprint & FloraWind
// ============================================================================
const cliff = createCliff(world.cliff, terrain.field);
const cliffRocks = cliff.group.getObjectByName('cliff-rocks');
assert.ok(cliffRocks?.isInstancedMesh, 'cliff-rocks instanced mesh exists');
const rockTriCount = (cliffRocks.geometry.index ? cliffRocks.geometry.index.count : cliffRocks.geometry.attributes.position.count) / 3;
assert.ok(rockTriCount >= 64, `cliff boulder uses stratified crag geometry (${rockTriCount} tris)`);
assert.ok(cliffRocks.geometry.getAttribute('color'), 'cliff boulder has青绿山水 vertical vertex colors');

const basin = world.terrain.basin;
const floraField = {
  half: terrain.field.half,
  sample: (x, z) => terrain.field.sample(x, z),
  slope: (x, z) => (Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : terrain.field.slope(x, z))
};
const nearTree = (x, z) =>
  Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34 ||
  Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40 ||
  world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);

const stream = createStream(world.stream, world.terrain, riverCurve);
const flora = createFlora(world.flora, floraField, distanceToRiver, stream.curve, world.player.spawn, nearTree);
assert.equal(flora.group.children.length, 10, 'flora preserves 10 instanced batches');

// 第 7 轮的保留位指纹早于外溪桃林布局；用显式旧版种植固定这份历史指纹，
// 活跃 flora 继续供后面的探索、栖居与社区检查使用。
const legacyFlora = createFlora({ ...world.flora, groveLayout: false }, floraField, distanceToRiver, stream.curve, world.player.spawn, nearTree);
const treeReservations = exteriorTreeReservations(legacyFlora);
const reservationHash = createHash('sha256').update(JSON.stringify(treeReservations)).digest('hex');
assert.equal(
  reservationHash,
  '4a29bb0b8ffcb6eb22f8d95ecde57ea9effc96f313946d1c54a3c473bcbd0208',
  'flora preserves bit-exact horizontal tree reservation fingerprint'
);

const village = createVillage(structuredClone(world.village), terrain.field, world.terrain.pond);
const scatter = createScatter(world.scatter, terrain.field, () => false, world.village.road, {
  x: cliff.slit.x, z: cliff.slit.z, dx: 1, dz: 0, len: 36
});
const props = createProps(world.props, terrain.field, village.houseInfo, village.plots, village.road);
assert.equal(props.tris, 55208, 'props preserves exact 55,208 triangle count');

const hinterland = createHinterland(world.hinterland, terrain.field, distanceToRiver, world, village, props, cliff);
const villageScenes = createVillageScenes(world, terrain.field, distanceToRiver, village, props, cliff, hinterland);
const mysterySites = planMysterySites(world, terrain.field, distanceToRiver, village, props, cliff, hinterland, villageScenes, flora);
const mysteryWorld = { sites: mysterySites, blockers: [] };
const villageLife = createVillageLife(world, terrain.field, distanceToRiver, village, props, cliff, hinterland, villageScenes, mysteryWorld);
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, terrain.field);
const exterior = createExteriorExploration(world, terrain.field, distanceToRiver, riverCurve, flora, boats, cliff);
const habitatDetails = createHabitatDetails({
  world, field: terrain.field, distanceToRiver, riverCurve,
  flora, hinterland, village, villageScenes, villageLife, props, boats, cliff, exterior
});

const communityOptions = {
  world, field: terrain.field, distanceToRiver, riverCurve, stream, flora,
  village, props, hinterland, villageScenes, villageLife, mysteryWorld, boats, cliff, exterior, habitatDetails
};
const pondLife = createPondLife({ ...communityOptions, reservations: [] });
const waterworks = createWaterworks({ ...communityOptions, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...communityOptions, reservations: [pondLife, waterworks] });

// Verify sunken spring brook & arched timber footbridge clearance
assert.ok(leisureGrove.layout.brook && leisureGrove.layout.bridge, 'leisure-grove builds sunken spring brook under timber-footbridge');
assert.ok(
  leisureGrove.layout.brook.underBridgeWaterY < leisureGrove.layout.bridge.midDeckBottomY - 0.08,
  'sunken spring brook flows cleanly beneath arched wooden footbridge deck'
);
for (let i = 1; i < leisureGrove.layout.brook.points.length; i++) {
  assert.ok(
    leisureGrove.layout.brook.points[i].y <= leisureGrove.layout.brook.points[i - 1].y + 1e-5,
    'brook flows downhill into village pond'
  );
}

// Verify composable sky appearance + floraWind shader hooks
const desatUniform = { value: 0 };
for (const root of [flora.group, village.group, scatter.group, leisureGrove.group]) {
  root.traverse(o => { if (o.isMesh && o.material) installSkyAppearance(o.material, desatUniform); });
}
const mockSky = {
  timeId: 'day',
  weatherId: 'clear',
  rainIntensity: 0,
  wind: 0.65,
  windX: 0.55,
  windZ: 0.32,
  getAppearance: () => ({ timeId: 'day', weatherId: 'clear', rainIntensity: 0 }),
  getTwilightState: () => ({ dawn: 0, dusk: 0 })
};
const floraWind = createFloraWind({ flora, village, scatter, leisureGrove, sky: mockSky });
const fwStats0 = floraWind.getStats();
assert.ok(fwStats0.enabled && fwStats0.materials >= 6 && fwStats0.meshes >= 14, 'floraWind wraps flora/village/scatter/grove foliage');

const testTreeMat = flora.group.children[0].material;
assert.ok(testTreeMat.customProgramCacheKey().includes('|sky-albedo-v1|flora-wind-v1'), 'floraWind composes cache key atop sky appearance');
const fakeShader = {
  uniforms: {},
  vertexShader: 'void main() {\n#include <begin_vertex>\n}',
  fragmentShader: 'void main() {\n#include <color_fragment>\n}'
};
testTreeMat.onBeforeCompile(fakeShader, {});
assert.ok(fakeShader.fragmentShader.includes('uSkyDesaturation'), 'sky fragment hook preserved');
assert.ok(fakeShader.vertexShader.includes('uFloraWindTime') && fakeShader.vertexShader.includes('uFloraWindVec'), 'floraWind vertex sway injected');

floraWind.update(0.5, 0.5);
const tAfterMove = floraWind.getStats().time;
assert.ok(tAfterMove > 0, 'floraWind advances time on dt > 0');
floraWind.update(0, 1.0);
assert.equal(floraWind.getStats().time, tAfterMove, 'floraWind freezes cleanly on dt = 0');
floraWind.dispose();
assert.ok(!testTreeMat.customProgramCacheKey().includes('|flora-wind-v1'), 'floraWind.dispose restores original program cache key');

// ============================================================================
// 3. Characters, female chignon, stools, upturned-toe shoes, 拱手揖礼 & sculpted fauna
// ============================================================================
const cParts = makePeopleParts(world.people);
const triOf = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
assert.ok(cParts.femaleHead && triOf(cParts.femaleHead) <= 1100 && triOf(cParts.femaleHead) > 400, 'femaleHead chignon within budget');
assert.ok(cParts.stool && triOf(cParts.stool) > 40 && triOf(cParts.stool) <= 400, 'wooden/straw stool part built');
assert.ok(cParts.shoe && triOf(cParts.shoe) >= 80, 'upturned-toe 翘头履 shoe geometry sculpted');

const colliders = cliff.blockers.concat(
  village.blockers, hinterland.blockers, villageScenes.blockers,
  villageLife.blockers, exterior.blockers, pondLife.blockers,
  waterworks.blockers, leisureGrove.blockers
);
const people = createPeople(world.people, terrain.field, village.houseInfo, village.road, village.plots, colliders);
assert.equal(people.group.children.length, 16, 'people renders 16 instanced batches including femaleHead and stool');
assert.ok(people.group.getObjectByName('people-female-head'), 'people-female-head batch present');
assert.ok(people.group.getObjectByName('people-stool'), 'people-stool batch present');

const walkerIdx = Math.max(0, people.list.findIndex(p => p.mode === 'road' && !p.basket));
const walker = people.list[walkerIdx];
people.greet(walkerIdx, walker.x + 1.2, walker.z + 1.2, 3.0);
for (let k = 0; k < 6; k++) {
  people.update(0.1, 1.0 + k * 0.1, walker.x + 1.2, walker.z + 1.2, { timeId: 'day', rainIntensity: 0, playerSpeed: 0 });
}
assert.ok(walker.greetT > 1.5 && walker.headPitch > 0.05, 'greeted villager bows head forward in Qin-Han 拱手揖礼');
const bodyBatch = people.group.getObjectByName('people-torso') || people.group.children[0];
const bodyMat4 = new THREE.Matrix4();
bodyBatch.getMatrixAt(walkerIdx, bodyMat4);
const bodyUpY = new THREE.Vector3(0, 1, 0).transformDirection(bodyMat4).y;
assert.ok(bodyUpY < 0.992 && bodyUpY > 0.90, `greeted villager torso pitches forward in 拱手揖礼 (upY=${bodyUpY.toFixed(4)})`);

const avatar = createAvatar(world.player.avatar, world.player.walkSpeed);
assert.equal(avatar.count, 5, 'player avatar preserves exact 5 draw calls');
const pState = { x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, pitch: 0, view: 'third', eyeHeight: 1.65 };
avatar.state.sitAmount = 0;
avatar.update(0.016, 0.5, pState);
avatar.group.updateMatrixWorld(true);
const standHeadY = new THREE.Box3().setFromObject(avatar.group).max.y;
avatar.state.sitAmount = 1;
avatar.state.seatOffsetY = 0.32;
avatar.update(0.016, 0.6, pState);
avatar.group.updateMatrixWorld(true);
const sitHeadY = new THREE.Box3().setFromObject(avatar.group).max.y;
assert.ok(sitHeadY < standHeadY - 0.18, 'avatar lowers posture cleanly when seated');
avatar.state.sitAmount = 0;
avatar.state.seatOffsetY = 0;

const hospitalityFeast = createHospitalityFeast({
  ...communityOptions,
  reservations: [pondLife, waterworks, leisureGrove],
  targetBlockers: leisureGrove.blockers
});
const qinHanHomestead = createQinHanHomestead({
  ...communityOptions,
  pondLife,
  leisureGrove,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast]
});
const qhStats = qinHanHomestead.getStats();
assert.ok(qhStats.triangles <= 12000 && qhStats.drawCalls <= 8, 'sculpted homestead fauna stays within triangle and draw budgets');
assert.ok(qinHanHomestead.group.getObjectByName('qin-han-sculpted-fauna'), 'sculpted fauna batch replaces BoxGeometry animal cubes');
for (let i = 0; i < 60; i++) qinHanHomestead.update(0.1, i * 0.1, mockSky, { x: 30, y: 0, z: -120 });
const qhEvents = qinHanHomestead.consumeEvents();
assert.ok(qhEvents.some(e => e.type === 'loom'), 'weaver shuttle emits rhythmic loom clack events');

const easterEggs = createEasterEggs({
  ...communityOptions,
  pondLife,
  waterworks,
  leisureGrove,
  qinHanHomestead,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead]
});
let stagSoundCount = 0, cupSoundCount = 0, guqinPlucks = 0, dewDropCount = 0;
const eggMockSound = {
  stagCall: () => { stagSoundCount++; return true; },
  waterCup: () => { cupSoundCount++; return true; },
  guqinPluck: () => { guqinPlucks++; return true; },
  dewDrop: () => { dewDropCount++; return true; },
  bell: () => true,
  gurgle: () => true,
  wood: () => true
};
const eggMysteries = { pickTarget: () => null, interact: () => false };
easterEggs.bind({ mysteries: eggMysteries, sound: eggMockSound, player: { state: pState }, doc: mockDoc });
const stagSite = easterEggs.sites.find(s => s.id === 'moon-white-stag');
const cupSite = easterEggs.sites.find(s => s.id === 'floating-wine-cup');
const guqinSite = easterEggs.sites.find(s => s.id === 'cloud-guqin-stone');
assert.ok(stagSite && cupSite && guqinSite, 'easter egg stag, floating cup, and guqin stone sites placed');
const stagEarL = easterEggs.group.getObjectByName('easter-stag-ear-l');
const stagEarR = easterEggs.group.getObjectByName('easter-stag-ear-r');
const stagDewMesh = easterEggs.group.getObjectByName('easter-stag-pine-dew');
assert.ok(stagEarL && stagEarR && stagDewMesh, 'white stag has independent ears and pine-needle dew instanced mesh');
assert.equal(stagDewMesh.visible, false, 'stag pine-needle dew hidden when idle (0 extra idle draws)');
easterEggs.interactById('moon-white-stag', eggMockSound, mockDoc);
assert.ok(easterEggs.getStats().stagEarFlutter > 2.0, 'stag interaction triggers multi-beat ear flutter');
assert.equal(easterEggs.getStats().stagDewActive, 6, 'stag interaction releases 6 pine-needle dew droplets');
assert.equal(stagDewMesh.visible, true, 'stag pine-needle dew visible while falling');
easterEggs.interactById('floating-wine-cup', eggMockSound, mockDoc);
easterEggs.interactById('cloud-guqin-stone', eggMockSound, mockDoc);
easterEggs.update(0.05, 0.05, mockSky, pState);
easterEggs.update(0.05, 0.10, mockSky, pState);
const earSnapZ = stagEarL.rotation.z;
const flutterSnap = easterEggs.getStats().stagEarFlutter;
assert.ok(stagEarL.rotation.x > 0.05 && stagEarR.rotation.x > 0.05, 'both stag ears perk and flick during greeting');
assert.ok(Math.abs(stagEarL.rotation.z + stagEarR.rotation.z) > 0.005, 'left and right stag ears twitch asymmetrically');
easterEggs.update(0, 0.10, mockSky, pState);
assert.equal(stagEarL.rotation.z, earSnapZ, 'stag ear micro-twitch strictly freezes on dt = 0');
assert.equal(easterEggs.getStats().stagEarFlutter, flutterSnap, 'stag ear flutter timer strictly freezes on dt = 0');
for (let i = 2; i < 40; i++) easterEggs.update(0.05, (i + 1) * 0.05, mockSky, pState);
easterEggs.interactById('cloud-guqin-stone', eggMockSound, mockDoc);
assert.equal(stagSoundCount, 1, 'stag interaction triggers dedicated stagCall');
assert.ok(dewDropCount >= 2, 'falling pine-needle dew droplets trigger crystalline dewDrop on mossy stone');
assert.equal(stagDewMesh.visible, false, 'stag pine-needle dew returns to hidden (0 idle draws) after splash');
assert.equal(cupSoundCount, 1, 'floating cup interaction triggers dedicated waterCup clink');
assert.ok(guqinPlucks >= 2, 'guqin stone allows responsive 0.65s phrase plucking + grace note');

const fish = createFish(world.fish, world.stream, world.terrain, riverCurve, stream);
const fishMesh = fish.group.children[0];
assert.ok(triOf(fishMesh.geometry) >= 28, 'fish geometry sculpted with fins and forked caudal tail');
fish.update(0.25, 0.25);
fish.update(0, 1.0);

// ============================================================================
// 4. Feast guest seat, SituationalRest, Quiet spots & Paddy bunds/ripples
// ============================================================================
const qinHanCompletion = createQinHanCompletion({
  world,
  field: terrain.field,
  village,
  props,
  leisureGrove,
  qinHanHomestead,
  blockers: colliders
});
assert.ok(qinHanCompletion.getStats().drawCalls <= 4, 'qin-han-completion stays within <= 4 non-rig draw calls');
const paddyMesh = qinHanCompletion.group.getObjectByName('qin-han-paddy-water');
assert.ok(paddyMesh?.isMesh && paddyMesh.material.customProgramCacheKey().includes('paddy-water'), 'paddy water uses rippled reflective shader');

const guestSeat = hospitalityFeast.getGuestSeat();
assert.ok(guestSeat && Number.isFinite(guestSeat.x) && Number.isFinite(guestSeat.z), 'hospitalityFeast exposes open 4th guestSeat');

let sitStoolSounds = 0, toastSounds = 0;
const restSound = {
  stoolSit: () => { sitStoolSounds++; return true; },
  toastCup: () => { toastSounds++; return true; },
  voice: () => true
};
const restMysteries = { pickTarget: () => null, interact: () => false };
const restCam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 300);
const aimDx = guestSeat.x - (guestSeat.x + 0.9);
const aimDz = guestSeat.z - (guestSeat.z + 0.9);
const aimTy = guestSeat.y + Math.max(0.24, guestSeat.seatY + 0.12);
const aimEyeY = guestSeat.y + 1.65;
const aimYaw = Math.atan2(-aimDx, -aimDz);
const aimPitch = Math.atan2(aimTy - aimEyeY, Math.hypot(aimDx, aimDz));
const restPlayer = {
  state: {
    x: guestSeat.x + 0.9,
    y: guestSeat.y,
    z: guestSeat.z + 0.9,
    vx: 0,
    vz: 0,
    yaw: aimYaw,
    targetYaw: aimYaw,
    pitch: aimPitch,
    targetPitch: aimPitch,
    view: 'first',
    eyeHeight: 1.65
  },
  syncCamera(cam) { cam.position.set(this.state.x, this.state.y + 1.65, this.state.z); }
};
restPlayer.syncCamera(restCam);
const situationalRest = createSituationalRest({
  world,
  field: terrain.field,
  player: restPlayer,
  avatar,
  camera: restCam,
  sound: restSound,
  sky: mockSky,
  blockers: colliders,
  hospitalityFeast,
  leisureGrove,
  qinHanCompletion,
  mysteries: restMysteries,
  doc: mockDoc,
  win: mockWin
});
const daySeats = situationalRest.getSeats().map(s => s.id);
assert.ok(daySeats.includes('feast-seat') && daySeats.includes('pavilion-seat') && daySeats.includes('social-tree-seat'), 'situationalRest discovers daytime seats');

const pickedSeat = restMysteries.pickTarget(restCam, world.interaction);
assert.equal(pickedSeat?.seatId, 'feast-seat', 'mysteries.pickTarget surfaces feast-seat when player aims at open stool');
assert.ok(Boolean(restMysteries.interact(pickedSeat)), 'first E sits at feast-seat');
assert.equal(situationalRest.active, true, 'situationalRest enters active seated state');
assert.equal(sitStoolSounds, 1, 'sitting plays subtle wooden stoolSit sound');

for (let i = 0; i < 20; i++) situationalRest.update(0.1, i * 0.1, mockSky, restPlayer.state, restCam);
const frozenProgress = situationalRest.sitProgress;
situationalRest.update(0, 3.0, mockSky, restPlayer.state, restCam);
assert.equal(situationalRest.sitProgress, frozenProgress, 'situationalRest freezes cleanly on dt = 0');

const toastTarget = restMysteries.pickTarget(restCam, world.interaction);
assert.equal(toastTarget?.restAction, 'toast', 'while seated at feast-seat, pickTarget offers 再敬一盏');
assert.ok(Boolean(restMysteries.interact(toastTarget)), 'second E while seated at feast-seat raises a communal toast');
assert.ok(situationalRest.getStats().toastCount >= 1, 'toastCount increments');
assert.ok(toastSounds >= 1, 'feast toast plays lacquer/ceramic toastCup sound');

situationalRest.standUp();
assert.equal(situationalRest.active, false, 'standUp exits seated communion cleanly');
assert.ok(restPlayer.state.y > world.terrain.waterLevel + 0.2, 'standUp places player on safe dry ground');
situationalRest.dispose();

// Quiet system open-valley + curated village spots
let quietChanges = 0;
const quiet = createQuiet(restPlayer, null, [{ x: 26, z: 204, radius: 6, name: '溪声' }], {
  doc: mockDoc,
  win: mockWin,
  onChange: () => { quietChanges++; }
});
quiet.addSpots([{ x: guestSeat.x, z: guestSeat.z, radius: 8, name: '村宴笑语' }]);
for (const fn of winListeners.get('keydown') || []) {
  fn({ code: 'KeyC', repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault() {} });
}
assert.equal(quiet.active, true, 'KeyC activates stillness inside village spot');
assert.equal(quiet.spot?.name, '村宴笑语', 'addSpots registers curated village quiet spot');
restPlayer.state.x = 0;
restPlayer.state.z = -95;
quiet.update();
assert.ok(getEl('quiet-notice').textContent.includes('桃源山水'), 'open-valley stillness displays 桃源山水 outside named spots');
quiet.exit();
assert.ok(quietChanges >= 2, 'quiet onChange fires on enter and exit');

// ============================================================================
// 5. Acoustic Realism: decaying envelopes, new one-shots & stepSurface
// ============================================================================
const gainSchedules = [];
class MockParam {
  constructor(v = 0, owner = null) {
    this.value = v;
    this.ops = [];
    this.owner = owner;
  }
  setValueAtTime(v, t) { this.value = v; this.ops.push(['set', v, t]); }
  linearRampToValueAtTime(v, t) { this.value = v; this.ops.push(['lin', v, t]); }
  exponentialRampToValueAtTime(v, t) { this.value = v; this.ops.push(['exp', v, t]); }
  cancelScheduledValues() {}
}
class MockNode {
  connect(dst) { return dst; }
  disconnect() {}
}
class MockAudioContext {
  constructor() {
    this.currentTime = 1.0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = new MockNode();
  }
  resume() { return Promise.resolve(); }
  createGain() {
    const n = new MockNode();
    n.gain = new MockParam(1, 'gain');
    gainSchedules.push(n.gain);
    return n;
  }
  createOscillator() {
    const n = new MockNode();
    n.type = 'sine';
    n.frequency = new MockParam(440, 'osc');
    n.start = () => {};
    n.stop = () => { if (typeof n.onended === 'function') n.onended(); };
    return n;
  }
  createBiquadFilter() {
    const n = new MockNode();
    n.type = 'lowpass';
    n.frequency = new MockParam(1000, 'filter');
    n.Q = new MockParam(1, 'q');
    return n;
  }
  createStereoPanner() {
    const n = new MockNode();
    n.pan = new MockParam(0, 'pan');
    return n;
  }
  createConvolver() {
    const n = new MockNode();
    n.buffer = null;
    return n;
  }
  createDynamicsCompressor() {
    const n = new MockNode();
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new MockParam(0, k);
    return n;
  }
  createAnalyser() {
    const n = new MockNode();
    n.fftSize = 256;
    n.frequencyBinCount = 128;
    n.getByteTimeDomainData = arr => arr.fill(128);
    n.getByteFrequencyData = arr => arr.fill(0);
    return n;
  }
  createBuffer(ch, len, sr) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { duration: len / sr, getChannelData: i => data[i] };
  }
  createBufferSource() {
    const n = new MockNode();
    n.buffer = null;
    n.loop = false;
    n.playbackRate = new MockParam(1, 'rate');
    n.start = () => {};
    n.stop = () => { if (typeof n.onended === 'function') n.onended(); };
    return n;
  }
}

const prevWindow = globalThis.window;
globalThis.window = { AudioContext: MockAudioContext };
const soundSource = readText('src/systems/sound.js');
assert.equal(soundSource.includes('setTargetAtTime'), false, 'sound.js never uses setTargetAtTime');
const soundModuleSrc = soundSource
  .replace("import world from '../data/world.json';", `const world = ${JSON.stringify(world)};`)
  .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = { version: 1, clips: [] };')
  .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(soundModuleSrc).toString('base64'));

let woodFlag = false;
const sound = createSound({
  field: terrain.field,
  distanceToRiver,
  riverSpine,
  people,
  village,
  cliff,
  isOnWood: () => woodFlag,
  audioFetch: async () => ({ ok: false, status: 404 })
});
sound.unlock();
sound.update(0.05, 0.5, { position: { x: 30, y: 2, z: -120 }, rotation: { y: 0 } }, { x: 30, y: 0.5, z: -120 }, false);

const beforeOps = gainSchedules.length;
assert.equal(sound.guqinPluck(30, -120, 0), true, 'guqinPluck plays cleanly');
const guqinEnvs = gainSchedules.slice(beforeOps).filter(g => g.ops.length >= 3);
assert.ok(
  guqinEnvs.some(g => g.ops[1]?.[0] === 'lin' && g.ops[2]?.[0] === 'exp' && g.ops[2][2] - g.ops[1][2] < 0.45),
  'tone() uses immediate two-stage exponential pluck decay rather than flat organ hold'
);

assert.equal(sound.waterCup(30, -120), true, 'waterCup plays');
assert.equal(sound.toastCup(30, -120), true, 'toastCup plays');
assert.equal(sound.stagCall(30, -120), true, 'stagCall plays');
assert.equal(sound.loomClack(30, -120), true, 'loomClack plays');
assert.equal(sound.mortarThud(30, -120), true, 'mortarThud plays');
assert.equal(sound.stoolSit(30, -120), true, 'stoolSit plays');
assert.equal(sound.frogPlop(30, -120), true, 'frogPlop plays');
assert.equal(sound.dewDrop(30, -120), true, 'dewDrop plays');
sound.syncWorld(0.05, {
  rain: 0,
  isNight: true,
  timeId: 'night',
  sprinting: true,
  frogVisualManaged: true,
  events: [{ type: 'frogPlop', x: 32, z: -122 }]
});
assert.equal(sound.setQuietFocus(true), true, 'setQuietFocus activates acoustic focus');

const cs = sound.getStats().completionSync;
assert.equal(cs.waterCups, 1);
assert.equal(cs.toasts, 1);
assert.equal(cs.stagCalls, 1);
assert.equal(cs.loomClacks, 1);
assert.equal(cs.mortarThuds, 1);
assert.equal(cs.stoolSits, 1);
assert.equal(cs.frogPlops, 2, 'frogPlop direct + syncWorld event tracked in completionSync');
assert.equal(cs.dewDrops, 1, 'dewDrop tracked in completionSync');
assert.equal(cs.frogHushed, true, 'frogPlop event hushes nearby pond frogs');
assert.ok(cs.quietFocus > 0.3, 'quietFocus blend tracked in completionSync');

woodFlag = true;
assert.equal(sound.stepSurface(30, -120), 'wood', 'stepSurface detects wooden bridge planks');
woodFlag = false;
assert.equal(sound.stepSurface(world.terrain.pond.x, world.terrain.pond.z), 'water', 'stepSurface detects pond wading');
assert.equal(sound.stepSurface(cliff.slit.x, cliff.slit.z), 'stone', 'stepSurface detects stone cave passage');

sound.disposeSamples();
globalThis.window = prevWindow;

// ============================================================================
// 6. Verify main.js Round 6/7 additive block discipline
// ============================================================================
const mainSrc = readText('src/main.js');
for (const name of ROUND6_BLOCKS) {
  assert.equal(mainSrc.split(`// Round 6: ${name} begin`).length - 1, 1, `single begin marker: ${name}`);
  assert.equal(mainSrc.split(`// Round 6: ${name} end`).length - 1, 1, `single end marker: ${name}`);
}
for (const sym of ['createFloraWind', 'createSituationalRest', 'mortarThud', 'quiet.addSpots', 'setQuietFocus', 'onWood']) {
  assert.ok(mainSrc.includes(sym), `main.js integrates ${sym}`);
  assert.ok(!stripRound6Main(mainSrc).includes(sym), `${sym} stays strictly inside Round 6 additive markers`);
}

console.log('PASS Round 7 natural world check (smooth terrain, organic peach crowns + wind sway, 青绿山水 cliffs, sunken spring brook, female chignon + stools + 拱手揖礼 + sculpted fauna, situational rest + feast toast + quiet spots, natural acoustic envelopes)');
