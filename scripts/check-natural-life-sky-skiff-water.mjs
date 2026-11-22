import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, createStream, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createBoats } from '../src/world/boats.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createPlayer } from '../src/player/controller.js';
import { createAvatar } from '../src/player/avatar.js';
import { createRiverSkiff } from '../src/systems/river-skiff.js';
import { createSky } from '../src/systems/sky.js';
import { createPeople } from '../src/world/people.js';
import { createFauna } from '../src/systems/fauna.js';
import { createCommunityLife } from '../src/systems/community-life.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

// Mock DOM/Canvas environment
const ctx2d = new Proxy(
  { createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) },
  { get: (t, k) => t[k] ?? (() => {}) }
);
const elementsById = new Map();
function makeMockEl(id) {
  const classes = new Set();
  const el = {
    id,
    textContent: '',
    open: false,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ width: 1280, height: 720, left: 0, top: 0 }),
    requestPointerLock() {},
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
const canvas = makeMockEl('canvas');

const winListeners = new Map();
const docListeners = new Map();
const mockWin = {
  location: { search: '' },
  addEventListener: (ev, fn) => {
    if (!winListeners.has(ev)) winListeners.set(ev, []);
    winListeners.get(ev).push(fn);
  },
  removeEventListener: (ev, fn) => {
    const arr = winListeners.get(ev) || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },
  emit: (ev, payload) => {
    for (const fn of [...(winListeners.get(ev) || [])]) fn(payload);
  }
};
globalThis.window = mockWin;
globalThis.document = {
  body: makeMockEl('body'),
  pointerLockElement: null,
  addEventListener: (ev, fn) => {
    if (!docListeners.has(ev)) docListeners.set(ev, []);
    docListeners.get(ev).push(fn);
  },
  removeEventListener: (ev, fn) => {
    const arr = docListeners.get(ev) || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },
  createElement: () => ({ getContext: () => ctx2d }),
  getElementById: id => elementsById.get(id) || null
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
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, field);
const village = createVillage(world.village, field, world.terrain.pond);

// 1. Pond DoubleSide & wading camera/player protection
const pondMesh = village.group.getObjectByName('pond');
const pondFilm = village.group.getObjectByName('pond-film');
assert.ok(pondMesh && pondFilm, 'pond and pond-film meshes exist');
assert.equal(pondMesh.material.side, THREE.DoubleSide, 'pond material renders DoubleSide');
assert.equal(pondFilm.material.side, THREE.DoubleSide, 'pond-film renders DoubleSide');

const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 800);
const player = createPlayer(canvas, world.player, field, world.terrain, hintEl, {
  blockers: village.blockers,
  cliff
});
const pondCfg = world.terrain.pond;
player.state.x = pondCfg.x;
player.state.z = pondCfg.z;
player.state.y = pondCfg.waterY - 2.0; // simulate deep drop attempt
for (const view of ['first', 'third']) {
  player.setView(view);
  player.state.pitch = view === 'third' ? 0.35 : -0.25;
  player.state.targetPitch = player.state.pitch;
  for (let i = 0; i < 40; i++) player.update(0.05, cam);
  assert.equal(player.state.wading, true, `pond deep area sets wading in ${view}`);
  assert.ok(
    player.state.y >= pondCfg.waterY - world.player.wadeDepth - 1e-4,
    `player stays at wading floor in ${view} (y=${player.state.y})`
  );
  assert.ok(
    cam.position.y >= pondCfg.waterY + 0.30,
    `camera stays clear above pond water in ${view} (camY=${cam.position.y}, waterY=${pondCfg.waterY})`
  );
}

// 2. River skiff: punting wave-glide dynamics, 3rd-person hand-pole coupling, disembark & re-board
const avatar = createAvatar(world.player.avatar, world.player.walkSpeed);
const skiff = createRiverSkiff({
  world,
  field,
  stream,
  riverCurve,
  distanceToRiver,
  boats,
  cliff
});
const mysteriesStub = {
  pickTarget: () => null,
  interact: () => null,
  hide: () => {}
};

// Re-bind skiff cleanly with real player controller & avatar in 3rd-person mode
player.setView('third');
player.state.camDist = 3.5;
skiff.bind({
  player,
  avatar,
  camera: cam,
  mysteries: mysteriesStub,
  blockers: [...cliff.blockers, ...village.blockers],
  hintEl,
  doc: globalThis.document,
  win: mockWin,
  autoBoard: true
});

// Track speed envelope over 2.4s of punting + 0.6s release glide
const speeds = [];
mockWin.emit('keydown', { code: 'KeyW', target: {}, preventDefault() {} });
for (let i = 0; i < 48; i++) {
  skiff.update(0.05, i * 0.05, null, player.state, cam);
  speeds.push(skiff.getStats().speed);
}
// Check pole-to-hand geometric alignment mid-stroke in 3rd person
avatar.group.updateMatrixWorld(true);
skiff.group.updateMatrixWorld(true);
const armL = avatar.group.getObjectByName('player-arm-l');
const armR = avatar.group.getObjectByName('player-arm-r');
const pole = skiff.group.getObjectByName('river-skiff-pole');
assert.ok(armL && armR && pole, '3rd-person arms & river-skiff-pole exist');

const palmL = new THREE.Vector3(0, -0.51, 0.02).applyMatrix4(armL.matrixWorld);
const palmR = new THREE.Vector3(0, -0.51, 0.02).applyMatrix4(armR.matrixWorld);
const poleOrigin = new THREE.Vector3();
const poleQuat = new THREE.Quaternion();
pole.getWorldPosition(poleOrigin);
pole.getWorldQuaternion(poleQuat);
const poleDir = new THREE.Vector3(0, 1, 0).applyQuaternion(poleQuat).normalize();
const distPointToRay = p => {
  const v = p.clone().sub(poleOrigin);
  const t = v.dot(poleDir);
  const perp = v.addScaledVector(poleDir, -t).length();
  return { t, perp };
};
const fitL = distPointToRay(palmL);
const fitR = distPointToRay(palmR);
assert.ok(fitL.perp < 0.035 && fitL.t > 0.1 && fitL.t < 3.6, `left palm grips bamboo pole (perp=${fitL.perp}, t=${fitL.t})`);
assert.ok(fitR.perp < 0.035 && fitR.t > 0.1 && fitR.t < 3.6, `right palm grips bamboo pole (perp=${fitR.perp}, t=${fitR.t})`);

// Speed should pulse rather than snap instantly to a flat plateau, then glide upon release
const peakSpeed = Math.max(...speeds);
const minAfterAccel = Math.min(...speeds.slice(18));
assert.ok(peakSpeed - minAfterAccel > 0.25, `punting produces natural surge/glide modulation (peak=${peakSpeed}, min=${minAfterAccel})`);
mockWin.emit('keyup', { code: 'KeyW' });
const speedAtRelease = skiff.getStats().speed;
for (let i = 0; i < 10; i++) skiff.update(0.05, 2.5 + i * 0.05, null, player.state, cam);
assert.ok(skiff.getStats().speed > 1.3 && skiff.getStats().speed < speedAtRelease, 'skiff glides softly and decelerates by water drag');

// Disembark & verify mooring proximity + arm reset + re-board without single-KeyE bounce in both views
for (let i = 0; i < 12; i++) skiff.update(0.05, 3.0 + i * 0.05, null, player.state, cam);
let prevented = false;
mockWin.emit('keydown', { code: 'KeyE', target: {}, repeat: false, defaultPrevented: false, preventDefault() { prevented = true; } });
assert.equal(prevented, true, 'KeyE while aboard calls preventDefault');
assert.equal(skiff.isAboard(), false, 'KeyE disembarks cleanly');
assert.ok(Math.abs(armR.rotation.z - 0.16) < 0.02, 'disembark resets avatar armR pose');
const anchor = skiff.getAnchor();
const shoreDist = Math.hypot(anchor.x - player.state.x, anchor.z - player.state.z);
assert.ok(shoreDist <= 6.8, `skiff moors within comfortable shore reach (${shoreDist.toFixed(2)}m)`);

// Re-board in 3rd-person view after cooldown
for (let i = 0; i < 8; i++) skiff.update(0.05, 3.6 + i * 0.05, null, player.state, cam);
player.setView('third');
player.state.camDist = 3.5;
player.syncCamera(cam);
const reboardTarget3rd = mysteriesStub.pickTarget(cam, {});
assert.ok(reboardTarget3rd && reboardTarget3rd.key === 'skiff:board', '3rd-person shore view picks up moored skiff to re-board');

// Single KeyE event on shore must re-board cleanly without double-firing disembark
mockWin.emit('keydown', { code: 'KeyE', target: {}, repeat: false, defaultPrevented: false, preventDefault() {} });
assert.equal(skiff.isAboard(), true, 'KeyE re-boards skiff in 3rd-person without bouncing back ashore');

// Also verify 1st-person re-boarding after disembarking
for (let i = 0; i < 8; i++) skiff.update(0.05, 4.0 + i * 0.05, null, player.state, cam);
skiff.disembark();
for (let i = 0; i < 8; i++) skiff.update(0.05, 4.5 + i * 0.05, null, player.state, cam);
player.setView('first');
player.syncCamera(cam);
const reboardTarget1st = mysteriesStub.pickTarget(cam, {});
assert.ok(reboardTarget1st && reboardTarget1st.key === 'skiff:board', '1st-person shore view picks up moored skiff');
mysteriesStub.interact(reboardTarget1st);
assert.equal(skiff.isAboard(), true, '1st-person interaction re-boards moored skiff');

// Verify high-FPS (70fps) punting fluidity when main.js calls avatar.update() before skiff.update() each frame
{
  player.setView('third');
  player.state.camDist = 3.5;
  mockWin.emit('keydown', { code: 'KeyW', target: {}, preventDefault() {} });
  const body = avatar.group.getObjectByName('player-body');
  const skiffHull = skiff.group.getObjectByName('river-skiff');
  let minArmLx = Infinity, maxArmLx = -Infinity;
  let minArmRx = Infinity, maxArmRx = -Infinity;
  let minBodyX = Infinity, maxBodyX = -Infinity;
  let minBodyY = Infinity, maxBodyY = -Infinity;
  let minTipRelY = Infinity, maxTipRelY = -Infinity;
  let minTipZ = Infinity, maxTipZ = -Infinity;
  for (let i = 0; i < 160; i++) {
    const dt = 1 / 70;
    const t = 5.0 + i * dt;
    avatar.update(dt, t, player.state);
    skiff.update(dt, t, null, player.state, cam);
    if (i < 25) continue; // after blend-in
    minArmLx = Math.min(minArmLx, armL.rotation.x);
    maxArmLx = Math.max(maxArmLx, armL.rotation.x);
    minArmRx = Math.min(minArmRx, armR.rotation.x);
    maxArmRx = Math.max(maxArmRx, armR.rotation.x);
    minBodyX = Math.min(minBodyX, body.rotation.x);
    maxBodyX = Math.max(maxBodyX, body.rotation.x);
    minBodyY = Math.min(minBodyY, body.rotation.y);
    maxBodyY = Math.max(maxBodyY, body.rotation.y);
    assert.ok(armR.rotation.z < -0.68, `high-FPS armR reaches across chest onto pole (rz=${armR.rotation.z.toFixed(3)})`);

    skiff.group.updateMatrixWorld(true);
    pole.getWorldPosition(poleOrigin);
    pole.getWorldQuaternion(poleQuat);
    const waterYNow = skiff.getStats().y;
    const relWaterY = poleOrigin.y - waterYNow;
    minTipRelY = Math.min(minTipRelY, relWaterY);
    maxTipRelY = Math.max(maxTipRelY, relWaterY);

    const tipLocal = skiffHull.worldToLocal(poleOrigin.clone());
    minTipZ = Math.min(minTipZ, tipLocal.z);
    maxTipZ = Math.max(maxTipZ, tipLocal.z);
    assert.ok(pole.position.x < -0.62 || pole.position.y > 0.30, `pole clears starboard gunwale cleanly (local=${pole.position.x.toFixed(2)},${pole.position.y.toFixed(2)})`);
  }
  assert.ok(maxArmLx - minArmLx > 1.0, `high-FPS guide arm sweeps full stroke arc (${(maxArmLx - minArmLx).toFixed(2)} rad)`);
  assert.ok(maxArmRx - minArmRx > 0.7, `high-FPS thrust arm drives full stroke arc (${(maxArmRx - minArmRx).toFixed(2)} rad)`);
  assert.ok(maxBodyX - minBodyX > 0.16 && maxBodyY - minBodyY > 0.16, 'torso leans and twists organically with each stroke');
  assert.ok(minTipRelY < -0.25 && maxTipRelY > 0.15, `bamboo pole plunges into river (${minTipRelY.toFixed(2)}m) and lifts clear on recovery (+${maxTipRelY.toFixed(2)}m)`);
  assert.ok(maxTipZ - minTipZ > 1.8, `pole sweeps >1.8m fore-to-aft along hull (${(maxTipZ - minTipZ).toFixed(2)}m)`);
  mockWin.emit('keyup', { code: 'KeyW' });
}

// 3. Romantic Dawn & Dusk sky afterglow check
const scene = new THREE.Scene();
scene.background = new THREE.Color(world.render.background);
scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), fill: new THREE.DirectionalLight() };
const sky = createSky(world.sky, scene, { getPixelRatio: () => 1 }, cam, { lights });
sky.setAuto(false);
const domeUniforms = scene.getObjectByName('sky-dome').material.uniforms;
for (const tw of ['dawn', 'dusk']) {
  sky.setTime(tw);
  sky.setWeather('clear');
  for (let i = 0; i < 120; i++) sky.update(0.1, cam);
  assert.ok(domeUniforms.uTwilightAmount.value > 0.7, `${tw} activates twilight shader intensity`);
  assert.ok(domeUniforms.uGlowAmt.value >= 0.35, `${tw} elevates warm glow (${domeUniforms.uGlowAmt.value})`);
  assert.ok(domeUniforms.uBottom.value.r > domeUniforms.uBottom.value.b, `${tw} horizon shifts warm peach/coral`);
}

// 4. Natural villagers & animal quirks
const flatField = { half: 200, sample: () => 2, slope: () => 0 };
const houses = [{ x: 27, z: 4, doorX: 27, doorZ: 1.2, rot: 0 }, { x: 8, z: 9, doorX: 8, doorZ: 6, rot: 0 }];
const road = { total: 60, at: at => ({ x: at, z: 0, nx: 0, nz: 1 }) };
const people = createPeople(structuredClone(world.people), flatField, houses, road, [[12, 5], [15, 5]], []);
for (let i = 0; i < 40; i++) people.update(0.05, i * 0.05, 1000, 1000, { timeId: 'dusk' });
const sitters = people.list.filter(p => p.mode === 'sit');
assert.ok(sitters.length >= 1 && sitters.some(p => p.headPitch < -0.04), 'sitters look peacefully up toward dawn/dusk afterglow');
const listeners = people.list.filter(p => p.mode === 'talk' && !p.speaking);
assert.ok(listeners.some(p => Math.abs(p.headYaw) > 0.02), 'porch listeners turn heads toward the active speaker');

const faunaCfg = structuredClone(world.fauna);
const fauna = createFauna(faunaCfg, flatField, {});
for (let i = 0; i < 80; i++) fauna.update(0.05, i * 0.05, 1000, 1000, {});
const ox = fauna.animals.find(a => a.kind === 'ox');
assert.ok(ox && ox.pitch >= 0, 'ox grazing sweep stays non-negative');
const chickens = fauna.animals.filter(a => a.kind === 'chicken');
assert.ok(chickens.length >= 2, 'chickens exist for flock behavior');

// Direct react() still isolates to one animal
const birdIdx = fauna.animals.findIndex(a => a.kind === 'bird');
assert.ok(birdIdx >= 0);
const beforeBirds = fauna.animals.map(a => a.mode);
fauna.react(birdIdx, fauna.animals[birdIdx].x, fauna.animals[birdIdx].z);
assert.equal(fauna.animals[birdIdx].mode, 'flush');
const changed = fauna.animals.filter((a, i) => i !== birdIdx && a.mode !== beforeBirds[i]);
assert.equal(changed.length, 0, 'direct fauna.react remains strictly single-animal isolated');

// community-life player awareness doesn't break with close playerState
const comm = createCommunityLife({
  world,
  field: flatField,
  stations: [{ kind: 'elder', x: 0, y: 2, z: 0, yaw: 0 }],
  blockers: []
});
comm.update(0.05, 0.05, { night: 0, rain: 0 }, { x: 1.2, z: 2.0 });
assert.equal(comm.getStats().actors, 1);

player.dispose();
skiff.dispose();
console.log('natural-life-sky-skiff-water ok');
