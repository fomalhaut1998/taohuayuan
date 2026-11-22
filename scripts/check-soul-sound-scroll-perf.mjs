import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createRiverSkiff } from '../src/systems/river-skiff.js';
import { createPoeticInteractions } from '../src/systems/poetic-interactions.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { createSituationalRest } from '../src/systems/situational-rest.js';
import { createRiverCurve, sampleRiverSpine, createStream } from '../src/world/stream.js';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { Heightfield } from '../src/player/collision.js';
import { createCliff } from '../src/world/cliff.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

// 1. Verify zero debug console.log in all newly added or modified source modules
const auditedFiles = [
  'src/systems/poetic-interactions.js',
  'src/systems/river-skiff.js',
  'src/systems/sound.js',
  'src/systems/scroll-studio.js',
  'src/systems/villager-dialogue.js',
  'src/systems/situational-rest.js',
  'src/systems/living-behavior.js',
  'src/systems/interaction.js',
  'src/systems/map-time-theme.js',
  'src/systems/map.js',
  'src/world/outer-wilds.js',
  'src/world/act3-finale.js',
  'src/world/people.js',
  'src/systems/fauna.js'
];
for (const rel of auditedFiles) {
  const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  assert.equal(src.includes('console.log('), false, `zero console.log allowed in ${rel}`);
}

// 2. Verify Acoustic Portal & distant air absorption wiring in sound.js + shader prewarm in main.js
const soundSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
for (const token of ['tunnelOcclusion', 'portalBloom', 'stoneSkip', 'canopyRain', 'goStoneClick', 'kilnCrackle', 'fouTone']) {
  assert.ok(soundSrc.includes(token), `sound.js includes ${token}`);
}
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.ok(mainSrc.includes('renderer.compile(scene, camera)'), 'main.js prewarms WebGL shaders via renderer.compile');
assert.ok(mainSrc.includes('createPoeticInteractions'), 'main.js wires createPoeticInteractions');

// 3. Build real terrain & stream fixture for River Skiff + Poetic Interactions
const curve = createRiverCurve(world.stream.points);
const spine = sampleRiverSpine(curve, 160);
const distRiver = createRiverDistance(spine);
const hFn = createHeightFunction(world.terrain, distRiver);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = new Float32Array(grid.attributes.position.count);
for (let i = 0; i < heights.length; i++) {
  heights[i] = hFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
}
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const canvasCtxProxy = new Proxy({}, { get: () => () => canvasCtxProxy });
globalThis.document = { createElement: () => ({ width: 32, height: 32, getContext: () => canvasCtxProxy }) };
const stream = createStream(world.stream, world.terrain, curve);
const cliff = createCliff(world.cliff, field);

// 4. Test River Skiff: 收篙随波, 舟中听雨, 夜航渔火伴鱼
{
  const keyListeners = {};
  const winMock = {
    addEventListener: (ev, fn) => { keyListeners[ev] = fn; },
    removeEventListener: () => {}
  };
  const noteEl = { textContent: '', classList: { add() {}, remove() {}, contains: () => false }, setAttribute() {} };
  const docMock = {
    body: { classList: { contains: () => false } },
    getElementById: (id) => (id === 'mystery-note' ? noteEl : null)
  };
  const player = {
    state: { x: 26, y: 0, z: 210, vx: 0, vz: 0, yaw: Math.PI, pitch: 0, view: 'third', eyeHeight: 1.65 }
  };
  const cam = new THREE.PerspectiveCamera(55, 1.6, 0.1, 500);
  const skiff = createRiverSkiff({ world, field, stream, riverCurve: curve, distanceToRiver: distRiver, boats: { list: [] }, cliff });
  skiff.bind({ player, camera: cam, doc: docMock, win: winMock, autoBoard: true });

  // Toggle pole stow via KeyX
  assert.equal(skiff.getStats().drifting, false);
  keyListeners.keydown({ code: 'KeyX', preventDefault() {} });
  assert.equal(skiff.getStats().drifting, true, 'KeyX toggles 收篙随波');

  // Rainy drift emits canopyRain sound events
  const rainSky = { timeId: 'day', weatherId: 'rain', rainIntensity: 0.75 };
  for (let i = 0; i < 20; i++) skiff.update(0.05, i * 0.05, rainSky, player.state, cam, false);
  const skiffEvents = skiff.consumeEvents();
  assert.ok(skiffEvents.some(e => e.type === 'canopyRain'), 'rainy skiff emits canopyRain events');

  // Night lantern fish companion
  assert.equal(skiff.getStats().lanternFishVisible, false, 'lantern fish hidden during daytime');
  const nightSky = { timeId: 'night', weatherId: 'clear', rainIntensity: 0 };
  skiff.update(0.05, 2.0, nightSky, player.state, cam, false);
  assert.equal(skiff.getStats().lanternFishVisible, true, 'lantern fish appear around bow lantern at night');
  skiff.dispose();
}

// 5. Test Poetic Interactions: 临水微戏, 五声抚琴相和, 檐下奉茶, 垂髫黄犬引路, 灵兽抚触, dt=0 freeze
{
  const soundLog = [];
  const ripples = [];
  const soundMock = {
    unlock() {},
    waterCup: (x, z) => soundLog.push(['waterCup', x, z]),
    stoneSkip: (x, z, hop) => soundLog.push(['stoneSkip', hop]),
    guqinPluck: (x, z, idx) => soundLog.push(['guqinPluck', idx]),
    fouTone: (x, z, idx) => soundLog.push(['fouTone', idx]),
    chirp: (x, z) => soundLog.push(['chirp', x, z]),
    bell: (x, z) => soundLog.push(['bell', x, z]),
    teaSimmer: (x, z) => soundLog.push(['teaSimmer', x, z]),
    voice: (r) => soundLog.push(['voice', r]),
    bark: () => soundLog.push(['bark']),
    stagCall: () => soundLog.push(['stagCall'])
  };
  const keyListeners = {};
  const winMock = {
    addEventListener: (ev, fn) => { keyListeners[ev] = fn; },
    removeEventListener: () => {}
  };
  const noteEl = { textContent: '', classList: { add() {}, remove() {}, contains: () => false }, setAttribute() {} };
  const docMock = {
    body: { classList: { contains: () => false } },
    getElementById: (id) => (id === 'mystery-note' ? noteEl : null)
  };
  const player = {
    state: { x: 40, y: 0, z: -120, vx: 0, vz: 0, yaw: 0, pitch: -0.15, view: 'first', eyeHeight: 1.65 }
  };
  const cam = new THREE.PerspectiveCamera(55, 1.6, 0.1, 500);
  cam.position.set(40, 1.65, -120);
  let deerPetted = 0;
  const deerObs = [{ x: 40, z: -122.2, radius: 0.48, pet: () => { deerPetted++; } }];
  const sitRestMock = { active: false, currentSeat: null };
  const skyObj = { timeId: 'day', weatherId: 'clear', rainIntensity: 0, windX: 0.2, windZ: 0.1 };

  const poetic = createPoeticInteractions({
    world,
    field,
    riverCurve: curve,
    riverSpine: spine,
    distanceToRiver: distRiver,
    player,
    camera: cam,
    sky: skyObj,
    sound: soundMock,
    inkAtmosphere: { spawnRipple: (...args) => ripples.push(args) },
    easterEggs: { sites: [{ id: 'cloud-guqin-stone', name: '云台卧石古琴', x: 40, y: 0, z: -121 }] },
    situationalRest: sitRestMock,
    people: { list: [{ x: 41.2, z: -120.5, role: 'elder' }], greet() {} },
    shelters: [{ x: 40, z: -120, r: 3.0 }],
    outerWilds: { getAnimalObstacles: () => deerObs, layout: { teaShelter: { x: 82, z: -235.5 } } },
    doc: docMock,
    win: winMock
  });

  // (a) Waterside float & skipping stone + dt=0 freeze
  poetic.triggerWatersidePlay('float');
  assert.equal(poetic.getStats().watersideFloatsLaunched, 1);
  assert.ok(ripples.length >= 1, 'bamboo leaf float spawns initial water ripple');

  poetic.triggerWatersidePlay('skip');
  assert.equal(poetic.getStats().stonesSkipped, 1);
  const simBefore = poetic.getStats().simTime;
  poetic.update(0, 1.0, skyObj, player.state);
  assert.equal(poetic.getStats().simTime, simBefore, 'poetic interactions strictly freeze on dt=0');
  for (let i = 0; i < 20; i++) poetic.update(0.05, i * 0.05, skyObj, player.state);
  assert.ok(soundLog.filter(s => s[0] === 'stoneSkip').length >= 4, 'skipping stone triggers multi-hop stoneSkip sounds');

  // (b) Pentatonic Digit1..5 + bird/bell echo
  keyListeners.keydown({ code: 'Digit3', preventDefault() {} });
  assert.equal(poetic.getStats().pentatonicCount, 1);
  assert.equal(poetic.getStats().lastPentatonicNote, 2);
  for (let i = 0; i < 12; i++) poetic.update(0.05, 2 + i * 0.05, skyObj, player.state);
  assert.ok(soundLog.some(s => s[0] === 'chirp'), 'mountain bird answers pentatonic guqin note after half-beat');

  // Seated at bonfire plays clay fou
  sitRestMock.active = true;
  sitRestMock.currentSeat = { id: 'bonfire-mat' };
  keyListeners.keydown({ code: 'Digit5', preventDefault() {} });
  assert.ok(soundLog.some(s => s[0] === 'fouTone' && s[1] === 4), 'bonfire seat plays clay fou tone');
  sitRestMock.active = false;

  // (c) Rainy-eave hot tea hospitality
  skyObj.rainIntensity = 0.65;
  for (let i = 0; i < 8; i++) poetic.update(0.05, 4 + i * 0.05, skyObj, player.state);
  assert.equal(poetic.getStats().rainTeaCount, 1, 'sheltering in rain near villager triggers hot tea encounter');
  assert.ok(soundLog.some(s => s[0] === 'teaSimmer'), 'hot tea encounter plays teaSimmer');
  skyObj.rainIntensity = 0;

  // (d) Gentle Sika deer touch
  const animTarget = poetic.pickTarget(cam, {});
  assert.ok(animTarget && animTarget.poeticAction === 'pet-animal', 'picks gentle Sika deer touch target');
  poetic.interact(animTarget);
  assert.equal(deerPetted, 1, 'petting Sika deer invokes deer.pet()');
  assert.ok(soundLog.some(s => s[0] === 'stagCall'), 'petting Sika deer plays gentle stagCall');

  // (e) Child & yellow dog wordless guide
  const gRes = poetic.triggerChildDogGuide(true);
  assert.equal(gRes.state, 'wave');
  for (let i = 0; i < 45; i++) poetic.update(0.05, 6 + i * 0.05, skyObj, player.state);
  assert.ok(['lead', 'wait', 'arrive'].includes(poetic.getStats().guideState), 'child & dog guide transitions into leading/waiting');

  poetic.dispose();
}

// 6. Test Villager Dialogue seasonal & mountain personas + SituationalRest mountain-tea-seat
{
  let curPhen = 'winter';
  const vd = createVillagerDialogue({
    sky: { timeId: 'day', weatherId: 'clear', rainIntensity: 0 },
    getWorldClock: () => ({ getState: () => ({ shichenName: '巳正' }) }),
    getPhenology: () => ({ getStats: () => ({ phenologyId: curPhen }) })
  });
  const s0 = vd.beginOrAdvance({
    kind: 'community',
    key: 'ow-tea-host',
    name: '松风茶翁',
    ref: { role: 'mountain_tea_host' },
    lines: ['岭上风清，喝碗松火煎茶罢！']
  });
  assert.ok(s0.who.includes('松风茶翁'), 'mountain tea host persona built');
  assert.ok(s0.meta.includes('冬岭凝霜'), 'villager dialogue meta reflects winter phenology');
  assert.ok(s0.line.includes('薄雪'), 'villager greeting reflects winter snow');

  const sr = createSituationalRest({
    field,
    outerWilds: {
      restSeats: [{
        id: 'mountain-tea-seat',
        name: '北岭松风茶寮',
        prompt: '落座品茗 · 北岭松风茶寮',
        x: 82, y: 12, z: -235, seatY: 0.42, lookX: 26, lookY: 8, lookZ: -246
      }]
    }
  });
  assert.ok(sr.getStats().availableSeats.includes('mountain-tea-seat'), 'situational rest includes mountain-tea-seat');
  sr.dispose();
}

console.log('PASS check-soul-sound-scroll-perf: skiff drift/fish, poetic interactions, acoustic portal, seasonal mountain dialogues & perf invariants');
