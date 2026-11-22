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
import { createRiverSkiff } from '../src/systems/river-skiff.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createAvatar } from '../src/player/avatar.js';
import { CATALOGUE, catalogueEntry } from '../src/systems/catalogue.js';
import { illustrationSVG } from '../src/systems/field-guide.js';
import { installSkyAppearance, isSkyAppearanceMaterial } from '../src/systems/scene-appearance.js';
import { collectDiscoveryTargets } from '../src/systems/discovery-targets.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const scriptData = JSON.parse(readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8'));

// 1. Code hygiene, Act-3 exclusion & sound invariant checks
for (const file of ['../src/systems/river-skiff.js', '../src/world/qin-han-village-completion.js']) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.ok(!/\bconsole\.log\s*\(/.test(src), `no console.log in ${file}`);
}
const soundSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
assert.ok(!/setTargetAtTime/.test(soundSrc), 'sound.js must not use setTargetAtTime');

const npcText = JSON.stringify(scriptData.npc || {});
for (const taboo of ['处处志', '太守', '刘子骥', '遂迷', '不复得路']) {
  assert.ok(!npcText.includes(taboo), `script.npc free of Act-3 ambient spoiler: ${taboo}`);
  assert.ok(
    (scriptData.points || []).filter((p) => JSON.stringify(p).includes(taboo)).every((p) => p.manual === true),
    `Act-3 point strictly manual-gated: ${taboo}`
  );
}
for (const role of ['fou_singer', 'night_feaster']) {
  assert.ok(scriptData.npc?.roles?.[role]?.lines?.length >= 3, `night feast dialogue present: ${role}`);
}

const fallbackSvg = illustrationSVG('__nonexistent__');
for (const id of ['fishing-skiff', 'millet-field', 'hearth-alcove']) {
  const entry = catalogueEntry(id);
  assert.ok(entry && entry.text.length > 16, `catalogue entry exists: ${id}`);
  assert.notEqual(illustrationSVG(entry.icon), fallbackSvg, `custom SVG exists for ${id} (${entry.icon})`);
}

// 2. Build real world context with harmless canvas/DOM shim
const ctx2d = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => t[k] ?? (() => {}) });
const elementsById = new Map();
function makeMockEl(id) {
  const classes = new Set();
  const el = {
    id,
    textContent: '',
    open: false,
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      toggle: (c, force) => (force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c))),
      contains: c => classes.has(c)
    }
  };
  elementsById.set(id, el);
  return el;
}
const hintEl = makeMockEl('hint');
hintEl.textContent = 'WASD 漫步';
makeMockEl('mystery-note');
makeMockEl('journal');
makeMockEl('classic');
makeMockEl('plain');

globalThis.document = {
  body: makeMockEl('body'),
  createElement: () => ({ getContext: () => ctx2d }),
  getElementById: id => elementsById.get(id) || null
};
const winListeners = new Map();
const mockWin = {
  addEventListener: (ev, fn) => {
    if (!winListeners.has(ev)) winListeners.set(ev, []);
    winListeners.get(ev).push(fn);
  },
  removeEventListener: (ev, fn) => {
    const arr = winListeners.get(ev) || [];
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  },
  emit: (ev, payload) => {
    for (const fn of (winListeners.get(ev) || [])) fn(payload);
  }
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
const villageLife = createVillageLife(world, field, distanceToRiver, village, props, cliff, hinterland, villageScenes, { anchors: planMysterySites(world, field, distanceToRiver, village, props, cliff, flora) });
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

// 3. Item 2 Verification: River Skiff navigation, controls, disembark & re-board
const skiff = createRiverSkiff({ world, field, stream, riverCurve, distanceToRiver, boats, cliff });
const skiffStats0 = skiff.getStats();
assert.ok(skiffStats0.built && skiffStats0.drawCalls <= 3 && skiffStats0.triangles <= 1200,
  `skiff geometry lean: ${skiffStats0.drawCalls} draws, ${skiffStats0.triangles} tris`);
skiff.group.traverse(obj => {
  if (obj.isMesh || obj.isInstancedMesh) {
    assert.equal(obj.frustumCulled, true, `skiff mesh ${obj.name} frustumCulled`);
    assert.ok(obj.geometry.boundingSphere && Number.isFinite(obj.geometry.boundingSphere.radius), `skiff mesh ${obj.name} valid boundingSphere`);
  }
});

const playerState = {
  x: world.player.spawn.x, z: world.player.spawn.z, y: field.sample(world.player.spawn.x, world.player.spawn.z),
  yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, vx: 0, vz: 0, speed: 0, view: 'third', camDist: 4, still: false
};
const avatar = createAvatar(world.player.avatar, world.player.walkSpeed);
const cam = new THREE.PerspectiveCamera(65, 1.5, 0.1, 500);
const mysteriesStub = {
  pickTarget: () => null,
  interact: () => null,
  hide: () => {}
};
const allBlockers = [...cliff.blockers, ...village.blockers, ...leisureGrove.blockers, ...qinHanHomestead.blockers];
const playerStub = {
  state: playerState,
  syncCamera: c => {
    c.position.set(playerState.x, playerState.y + 1.65, playerState.z);
    c.rotation.set(playerState.pitch, playerState.yaw, 0, 'YXZ');
    c.updateMatrixWorld();
  }
};

skiff.bind({
  player: playerStub,
  avatar,
  camera: cam,
  mysteries: mysteriesStub,
  blockers: allBlockers,
  hintEl,
  doc: globalThis.document,
  win: mockWin,
  autoBoard: true
});
assert.equal(skiff.isAboard(), true, 'normal entry starts aboard skiff');
assert.equal(playerState.aboardSkiff, true);
assert.equal(playerState.still, true);
assert.ok(hintEl.textContent.includes('撑篙泛舟'), 'aboard hint shown');
for (const mb of world.boats.boats) {
  const bx = mb.x ?? mb[0];
  const bz = mb.z ?? mb[1];
  assert.ok(Math.hypot(skiff.getStats().x - bx, skiff.getStats().z - bz) >= 2.65, 'skiff starts clear of moored boats');
}

// Passive downstream drift ("缘溪行")
const startT = skiff.getStats().t;
for (let i = 0; i < 40; i++) skiff.update(0.05, i * 0.05, null, playerState, cam);
assert.ok(skiff.getStats().t > startT, 'skiff drifts downstream naturally');

// Punting with W + D updates boat position & emits boatPole sound events
const tAfterDrift = skiff.getStats().t;
mockWin.emit('keydown', { code: 'KeyW', target: {} });
mockWin.emit('keydown', { code: 'KeyD', target: {} });
let poleEvents = 0;
for (let i = 0; i < 30; i++) {
  skiff.update(0.05, 2 + i * 0.05, null, playerState, cam);
  poleEvents += skiff.consumeEvents().filter(e => e.type === 'boatPole').length;
}
mockWin.emit('keyup', { code: 'KeyW' });
mockWin.emit('keyup', { code: 'KeyD' });
assert.ok(skiff.getStats().t > tAfterDrift + 0.01, 'punting with W accelerates downstream progress');
assert.ok(poleEvents >= 1, 'punting emits boatPole sound events');
assert.ok(field.sample(skiff.getStats().x, skiff.getStats().z) <= world.terrain.waterLevel - 0.16, 'skiff remains in wet channel');

// Teleport protection releases skiff without clobbering destination
playerState.x = 44;
playerState.z = -128;
skiff.update(0.05, 4, null, playerState, cam);
assert.equal(skiff.isAboard(), false, 'external teleport cleanly disembarks skiff');
assert.equal(playerState.aboardSkiff, false);
assert.equal(playerState.x, 44, 'teleport X preserved');
assert.equal(playerState.z, -128, 'teleport Z preserved');
assert.equal(hintEl.textContent, 'WASD 漫步', 'original hint restored');

// Re-board via mystery interaction from nearby shore & advance to headwaters disembark
const anchor = skiff.getAnchor();
playerState.x = anchor.x + 2.8;
playerState.z = anchor.z;
playerState.y = world.terrain.waterLevel + 0.2;
cam.position.set(playerState.x, playerState.y + 1.6, playerState.z);
cam.lookAt(anchor.x, anchor.y, anchor.z);
cam.updateMatrixWorld();
const boardTarget = mysteriesStub.pickTarget(cam, {});
assert.ok(boardTarget && boardTarget.key === 'skiff:board', 'looking at moored skiff prompts boarding');
mysteriesStub.interact(boardTarget);
assert.equal(skiff.isAboard(), true, 'interacting boards skiff');

mockWin.emit('keydown', { code: 'KeyW', target: {} });
for (let i = 0; i < 900 && skiff.getStats().t < 0.89; i++) {
  skiff.update(0.05, 5 + i * 0.05, null, playerState, cam);
}
mockWin.emit('keyup', { code: 'KeyW' });
assert.ok(skiff.getStats().t >= 0.885, `skiff reaches headwaters shoal (t=${skiff.getStats().t})`);
const disTarget = mysteriesStub.pickTarget(cam, {});
assert.ok(disTarget && disTarget.key === 'skiff:disembark', 'headwaters prompts 便舍船，从口入');
const landed = mysteriesStub.interact(disTarget);
assert.ok(landed && field.sample(landed.x, landed.z) >= world.terrain.waterLevel + 0.65, 'disembarked onto dry bank');
assert.equal(skiff.isAboard(), false);
assert.ok(elementsById.get('mystery-note').textContent.includes('便舍船，从口入'), 'poetic disembark note shown');

// 4. Items 3, 4 & 5 Verification: createQinHanCompletion
const completion = createQinHanCompletion({
  world, field, village, props, leisureGrove, qinHanHomestead, blockers: allBlockers
});
const compStats0 = completion.getStats();
assert.ok(compStats0.built && compStats0.skirtCount >= 1, 'threshing floor slope skirt built');
assert.equal(compStats0.houseDressedCount, village.houseInfo.length, 'all 11 village houses dressed in Qin-Han style');
assert.equal(compStats0.openHearthCount, 3, '3 open-door hearth alcoves sculpted');
assert.ok(compStats0.cropInstances >= 1200, `3D millet/hemp/rice crops populated (${compStats0.cropInstances} clumps)`);
assert.equal(compStats0.nightVillagers, 3, '3 nighttime bonfire villagers configured');
assert.ok(compStats0.shelters >= 5, `pavilion, hut, shed & house eaves registered as acoustic shelters (${compStats0.shelters})`);

// Verify threshing skirt extends well beneath lowest ground point around (44, -128)
const threshMark = props.marks.find(m => m.kind === 'thresh');
assert.ok(threshMark, 'thresh mark exists');
let minPerimeterGround = Infinity;
for (let k = 0; k < 32; k++) {
  const a = (k / 32) * Math.PI * 2;
  const gx = threshMark.x + Math.cos(a) * (threshMark.r + 0.48);
  const gz = threshMark.z + Math.sin(a) * (threshMark.r + 0.48);
  minPerimeterGround = Math.min(minPerimeterGround, field.sample(gx, gz));
}
const staticMesh = completion.group.getObjectByName('qin-han-completion-static');
const posAttr = staticMesh.geometry.attributes.position;
let skirtMinY = Infinity;
for (let i = 0; i < posAttr.count; i++) {
  const vx = posAttr.getX(i), vy = posAttr.getY(i), vz = posAttr.getZ(i);
  if (Math.hypot(vx - threshMark.x, vz - threshMark.z) <= threshMark.r + 1.0) {
    skirtMinY = Math.min(skirtMinY, vy);
  }
}
assert.ok(skirtMinY <= minPerimeterGround - 0.15,
  `thresh skirt grounds completely beneath slope (skirtMinY=${skirtMinY.toFixed(2)}, minGround=${minPerimeterGround.toFixed(2)})`);

// Verify 3D crop mesh draws, non-black instanceColor & skyAppearance compatibility
const cropMesh = completion.group.getObjectByName('qin-han-millet-crops');
assert.ok(cropMesh && cropMesh.isInstancedMesh && cropMesh.frustumCulled === true, 'crop mesh is frustum-culled InstancedMesh');
assert.ok(cropMesh.instanceColor, 'crop mesh has instanceColor');
const cArr = cropMesh.instanceColor.array;
assert.ok(cArr[0] + cArr[1] + cArr[2] > 0.2, 'crop instanceColor non-black');
installSkyAppearance(cropMesh.material, { value: 0 });
assert.equal(typeof cropMesh.material.onBeforeCompile, 'function');

// Verify ember mesh has skyIgnore and daytime vs clear-night feast vs rainy night switching
const emberMesh = completion.group.getObjectByName('qin-han-hearth-embers');
assert.equal(emberMesh.material.userData.skyIgnore, true, 'hearth embers keep glow regardless of sky tint');

completion.update(0.05, 1, { timeId: 'day', rainIntensity: 0, wind: 0.4, windX: 0.2, windZ: 0.1 }, playerState);
assert.equal(completion.getStats().nightFeastActive, false, 'daytime hides night bonfire feast');
assert.equal(completion.getInteractables().length, 0, 'daytime exposes zero night feasters');
assert.equal(completion.getStats().rainCurtainVisible, false, 'dry day hides eave rain curtains');
assert.ok(completion.getStats().drawCalls <= 4, `daytime village completion stays under 4 draw calls (${completion.getStats().drawCalls})`);

completion.update(0.05, 2, { timeId: 'night', rainIntensity: 0.75, wind: 0.8, windX: 0.3, windZ: 0.2 }, playerState);
assert.equal(completion.getStats().nightFeastActive, false, 'heavy rain suppresses night outdoor feast');
assert.equal(completion.getStats().rainCurtainVisible, true, 'rain activates eave water-curtain streaks and splashes');

completion.update(0.05, 3, { timeId: 'night', rainIntensity: 0, wind: 0.2, windX: 0, windZ: 0 }, playerState);
assert.equal(completion.getStats().nightFeastActive, true, 'clear night activates bonfire feast & fou singer');
assert.equal(completion.getInteractables().length, 3, 'clear night exposes all 3 interactable villagers');

// Discovery targets resolve into catalogue cleanly
const lgWithCompletion = {
  targets: [
    ...leisureGrove.targets,
    { id: 'fishing-skiff', ...skiff.getAnchor(), range: 6.5, resolve: () => skiff.getAnchor() },
    ...completion.targets
  ]
};
const dTargets = collectDiscoveryTargets({ leisureGrove: lgWithCompletion });
assert.ok(
  dTargets.some(t => t.id === 'fishing-skiff') &&
  dTargets.some(t => t.id === 'millet-field') &&
  dTargets.some(t => t.id === 'hearth-alcove'),
  'new discovery targets registered & resolved'
);

// 5. Sound System Verification: skiff footstep skip, boatPole, fouBeats & shelter acoustic filtering
function installFakeWebAudio() {
  const mkParam = v => ({ value: v, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x) { this.value = x; }, exponentialRampToValueAtTime(x) { this.value = x; } });
  const prevWin = globalThis.window;
  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
    }
    createGain() { return { gain: mkParam(1), connect(d) { return d; }, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: mkParam(0), knee: mkParam(0), ratio: mkParam(0), attack: mkParam(0), release: mkParam(0), connect(d) { return d; }, disconnect() {} }; }
    createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.8, getByteTimeDomainData() {}, getByteFrequencyData() {}, connect(d) { return d; }, disconnect() {} }; }
    createStereoPanner() { return { pan: mkParam(0), connect(d) { return d; }, disconnect() {} }; }
    createBiquadFilter() { return { type: 'lowpass', frequency: mkParam(1000), Q: mkParam(1), connect(d) { return d; }, disconnect() {} }; }
    createConvolver() { return { buffer: null, connect(d) { return d; }, disconnect() {} }; }
    createBuffer(ch, n, sr) { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { duration: n / sr, getChannelData: i => d[i] }; }
    createBufferSource() { return { buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: mkParam(1), connect(d) { return d; }, disconnect() {}, start() {}, stop() {} }; }
    createOscillator() { return { type: 'sine', frequency: mkParam(440), connect(d) { return d; }, disconnect() {}, start() {}, stop() {} }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: FakeAudioContext };
  return prevWin;
}
const prevWin = installFakeWebAudio();
const soundModuleSrc = soundSrc
  .replace("import world from '../data/world.json';", `const world = ${JSON.stringify(world)};`)
  .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = { version: 1, clips: [] };')
  .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(soundModuleSrc).toString('base64'));
const sound = createSound({
  field, distanceToRiver, riverSpine, village, cliff,
  audioCatalogue: { version: 1, clips: [] },
  audioFetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
});
assert.equal(sound.unlock(), true, 'sound unlocked with fake WebAudio');
sound.setAmbience({ rain: 0.8, wind: 0.4, night: 0 });

const openPos = { x: 48, z: -130, y: field.sample(48, -130), yaw: 0, aboardSkiff: true };
for (let i = 0; i < 20; i++) {
  sound.update(0.05, i * 0.05, null, { ...openPos, x: openPos.x + i * 0.25 }, false);
  sound.syncWorld(0.05, { rain: 0.8, isNight: false, shelters: completion.shelters, events: [] });
}
assert.equal(sound.getStats().counts.steps, 0, 'skiff riding suppresses walking footsteps');
const openBeds = sound.getStats().beds;
assert.ok(openBeds.rainCutoffHz >= 5800, `open-air rain cutoff high (${openBeds.rainCutoffHz})`);
assert.equal(sound.getStats().completionSync.shelter, 0, 'open field has 0 shelter factor');

// Step under thatched pavilion in rain
const pavShelter = completion.shelters.find(s => s.kind === 'pavilion');
assert.ok(pavShelter, 'pavilion shelter registered');
const pavPos = { x: pavShelter.x, z: pavShelter.z, y: field.sample(pavShelter.x, pavShelter.z) + 1.6, yaw: 0 };
for (let i = 0; i < 30; i++) {
  sound.update(0.05, 1 + i * 0.05, null, pavPos, false);
  sound.syncWorld(0.05, { rain: 0.8, isNight: false, shelters: completion.shelters, events: [] });
}
const shelteredStats = sound.getStats();
assert.ok(shelteredStats.completionSync.shelter > 0.75, `pavilion shelter factor high (${shelteredStats.completionSync.shelter})`);
assert.ok(shelteredStats.beds.rainCutoffHz < openBeds.rainCutoffHz - 1800,
  `rain cutoff lowers under thatch roof (${shelteredStats.beds.rainCutoffHz} vs ${openBeds.rainCutoffHz})`);
assert.ok(shelteredStats.beds.rainHighGain < openBeds.rainHighGain * 0.5,
  'high-frequency open rain attenuated under shelter');
assert.ok(shelteredStats.completionSync.eaveDrips >= 1, 'eave rain drips triggered around shelter perimeter');

// Boat pole + night fou beat + frozen pause guard
const nf = completion.getNightFeastState();
sound.update(0.05, 3, null, { x: nf.x + 2, z: nf.z, y: nf.y + 1.5, yaw: 0 }, false);
for (let i = 0; i < 20; i++) {
  sound.syncWorld(0.05, {
    rain: 0,
    isNight: true,
    shelters: completion.shelters,
    nightFeast: nf,
    events: i === 0 ? [{ type: 'boatPole', x: nf.x, z: nf.z, intensity: 0.9 }] : []
  });
}
const feastAudioStats = sound.getStats().completionSync;
assert.ok(feastAudioStats.boatPoles >= 1, 'boatPole event produces splash sound');
assert.ok(feastAudioStats.fouBeats >= 1, 'clear night feast produces clay-fou & pentatonic xun sound');

// Frozen / dt=0 schedules zero new events
sound.syncWorld(0, { rain: 0.8, isNight: true, shelters: completion.shelters, nightFeast: nf, events: [{ type: 'boatPole', x: 0, z: 0 }] });
assert.equal(sound.getStats().completionSync.boatPoles, feastAudioStats.boatPoles, 'dt=0 syncWorld emits zero audio events');

skiff.dispose();
completion.dispose();
avatar.dispose();
sound.disposeSamples();
await sound.context?.close?.();
if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;

console.log(JSON.stringify({
  passed: true,
  item2SkiffTris: skiffStats0.triangles,
  item3SkirtMinY: +skirtMinY.toFixed(2),
  item3OpenHearths: compStats0.openHearthCount,
  item4CropInstances: compStats0.cropInstances,
  item4NightVillagers: compStats0.nightVillagers,
  item5ShelterFactor: shelteredStats.completionSync.shelter,
  item5RainCutoffOpen: Math.round(openBeds.rainCutoffHz),
  item5RainCutoffSheltered: Math.round(shelteredStats.beds.rainCutoffHz),
  item5EaveDrips: shelteredStats.completionSync.eaveDrips,
  fouBeats: feastAudioStats.fouBeats,
  boatPoles: feastAudioStats.boatPoles
}));
