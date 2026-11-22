import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createPlayer } from '../src/player/controller.js';
import { createAvatar } from '../src/player/avatar.js';
import { createTouchControls } from '../src/player/touch-controls.js';
import { createBarrier } from '../src/systems/barrier.js';
import { createFootstepFx } from '../src/systems/footstep-fx.js';
import { createHeightFunction, createRiverDistance, createTerrain } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createSmoothHinterlandPaths } from '../src/world/road-geometry.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createQianmoPaths } from '../src/world/qianmo-paths.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { attachGroundSurface } from '../src/world/ground-surface.js';
import { createPhenologySystem } from '../src/systems/phenology-mist.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

// Hygiene check on seasonal-roads.js
const srSrc = readFileSync(new URL('../src/world/seasonal-roads.js', import.meta.url), 'utf8');
assert.equal(/\bconsole\.log\s*\(/.test(srSrc), false, 'seasonal-roads.js must not contain console.log');

function createMockEnv() {
  const els = new Map();
  const makeClassList = () => {
    const set = new Set();
    return {
      add: (...xs) => xs.forEach(x => set.add(x)),
      remove: (...xs) => xs.forEach(x => set.delete(x)),
      toggle: (x, f) => {
        const on = f === undefined ? !set.has(x) : Boolean(f);
        if (on) set.add(x); else set.delete(x);
        return on;
      },
      contains: x => set.has(x)
    };
  };
  const makeEl = (tag = 'div', id = '') => {
    const listeners = new Map();
    const el = {
      id,
      tagName: String(tag).toUpperCase(),
      textContent: '',
      innerHTML: '',
      hidden: false,
      open: false,
      style: { cssText: '', transform: '' },
      children: [],
      parentNode: null,
      classList: makeClassList(),
      appendChild(child) {
        child.parentNode = el;
        el.children.push(child);
        if (child.id) els.set(child.id, child);
        return child;
      },
      remove() {
        if (el.id) els.delete(el.id);
        if (el.parentNode) {
          const idx = el.parentNode.children.indexOf(el);
          if (idx >= 0) el.parentNode.children.splice(idx, 1);
          el.parentNode = null;
        }
      },
      setAttribute(k, v) { if (k === 'id') { el.id = String(v); els.set(el.id, el); } },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type);
        if (!arr) return;
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      },
      dispatch(type, ev = {}) {
        for (const fn of [...(listeners.get(type) || [])]) {
          fn({ target: el, preventDefault() {}, stopPropagation() {}, ...ev });
        }
      },
      closest() { return null; },
      getBoundingClientRect: () => ({ left: 20, top: 200, width: 100, height: 100 }),
      getContext: () => new Proxy({
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData() {},
        createRadialGradient: () => ({ addColorStop() {} })
      }, { get: (t, k) => t[k] ?? (() => {}) })
    };
    if (id) els.set(id, el);
    return el;
  };
  const body = makeEl('body', 'body');
  body.classList.add('curtain-open');
  const journal = makeEl('dialog', 'journal');
  body.appendChild(journal);
  const winListeners = new Map();
  const dispatched = [];
  const win = {
    innerWidth: 1280,
    innerHeight: 720,
    navigator: { maxTouchPoints: 5 },
    matchMedia: () => ({ matches: true }),
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = winListeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(ev) {
      dispatched.push(ev);
      const list = winListeners.get(ev.type) || [];
      for (const fn of [...list]) fn(ev);
    },
    dispatchKey(type, code, extra = {}) {
      let prevented = false;
      const ev = {
        type,
        code,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        target: body,
        get defaultPrevented() { return prevented; },
        preventDefault() { prevented = true; },
        stopPropagation() {},
        ...extra
      };
      win.dispatchEvent(ev);
      return ev;
    }
  };
  const doc = {
    body,
    head: makeEl('head', 'head'),
    pointerLockElement: null,
    getElementById: id => els.get(id) || null,
    createElement: tag => makeEl(tag),
    addEventListener() {},
    removeEventListener() {}
  };
  return { doc, win, body, journal, dispatched };
}

// ============================================================================
// PART 1: Player Jumping & Vaulting Low Obstacles
// ============================================================================
{
  const env = createMockEnv();
  globalThis.document = env.doc;
  globalThis.window = env.win;

  const flatField = {
    sample: () => 2.0,
    walkSurface: () => 2.0,
    surfaceMaterial: () => 'dirt'
  };
  const terrainCfg = { waterLevel: -1.2 };
  const playerCfg = {
    ...world.player,
    spawn: { x: 0, z: 3.0, yaw: 0, pitch: 0 }
  };

  // Low bamboo fence at z = 0 (height 1.05m), wide low bench at x = 8, z = 0 (height 0.55m),
  // tall house wall at x = -8, z = 0 (height 4.5m), unheighted cliff at x = -16, z = 0
  const testBlockers = [
    { x: 0, z: 0, hw: 2.0, hd: 0.16, rot: 0, minY: 2.0, maxY: 3.05, source: 'bamboo-fence' },
    { x: 8, z: 0, hw: 1.2, hd: 0.9, rot: 0, minY: 2.0, maxY: 2.55, source: 'bench' },
    { x: -8, z: 0, hw: 2.5, hd: 1.5, rot: 0, minY: 1.85, maxY: 6.5, source: 'house' },
    { x: -16, z: 0, hw: 2.5, hd: 2.0, rot: 0, source: 'cliff-wall' }
  ];

  const canvas = env.doc.createElement('canvas');
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  const player = createPlayer(canvas, playerCfg, flatField, terrainCfg, null, { blockers: testBlockers });
  const barrier = createBarrier(testBlockers);
  const avatar = createAvatar(world.player.avatar, world.player.walkSpeed);
  const footstepFx = createFootstepFx({ field: flatField, world: { terrain: terrainCfg } });

  // 1A. Walking grounded into 1.05m bamboo fence is blocked
  env.win.dispatchKey('keydown', 'KeyW');
  for (let i = 0; i < 90; i++) {
    player.update(1 / 60, cam);
    barrier.resolve(player.state, 0.42);
    player.syncCamera(cam);
  }
  assert.ok(player.state.z > 0.50, `grounded walk must be blocked by 1.05m fence (z=${player.state.z.toFixed(2)})`);
  assert.equal(player.state.grounded, true, 'player remains grounded against fence');

  // 1B. Pressing Space jumps cleanly OVER the 1.05m bamboo fence (even from nose-to-fence!)
  let peakY = player.state.y;
  let sawAirborne = false;
  let sawLanded = false;
  env.win.dispatchKey('keydown', 'Space');
  for (let i = 0; i < 80; i++) {
    player.update(1 / 60, cam);
    barrier.resolve(player.state, 0.42);
    player.syncCamera(cam);
    avatar.update(1 / 60, i / 60, player.state);
    footstepFx.update(1 / 60, i / 60, player.state, { rainIntensity: 0, snowIntensity: 0 }, { phenologyId: 'spring' });
    if (player.state.y > peakY) peakY = player.state.y;
    if (player.state.airborne) sawAirborne = true;
    if (player.state.justLanded) sawLanded = true;
  }
  env.win.dispatchKey('keyup', 'KeyW');
  env.win.dispatchKey('keyup', 'Space');
  assert.ok(sawAirborne, 'Space enters airborne state');
  assert.ok(peakY > 3.15 && peakY < 3.45, `jump peak (${(peakY - 2.0).toFixed(2)}m) clears 1.05m fence naturally`);
  assert.ok(player.state.z < -0.5, `jumping while moving forward clears the 1.05m fence (ended z=${player.state.z.toFixed(2)})`);
  assert.equal(player.state.grounded, true, 'player lands cleanly after crossing fence');
  assert.ok(sawLanded, 'landing triggers justLanded flag');
  assert.equal(avatar.count, 5, 'avatar retains exact 5 draw calls during jump');
  assert.ok(footstepFx.getStats().totalEmitted >= 1, 'jump takeoff/landing emits footstep dust FX');

  // 1C. Jumping ONTO a wide low obstacle (0.55m bench at x=8, z=0) perches on top & walks off cleanly
  player.state.x = 8;
  player.state.z = 1.65;
  player.state.y = 2.0;
  player.state.vx = 0;
  player.state.vz = 0;
  player.state.yaw = 0;
  player.state.targetYaw = 0;
  env.win.dispatchKey('keydown', 'KeyW');
  env.win.dispatchKey('keydown', 'Space');
  let perched = false;
  for (let i = 0; i < 70; i++) {
    if (i === 24) env.win.dispatchKey('keyup', 'KeyW'); // stop above bench so we land on top
    player.update(1 / 60, cam);
    barrier.resolve(player.state, 0.42);
    player.syncCamera(cam);
    if (player.state.onObstacle && Math.abs(player.state.y - 2.55) < 0.03) perched = true;
  }
  env.win.dispatchKey('keyup', 'Space');
  assert.ok(perched, `player lands smoothly on top of 0.55m bench (y=${player.state.y.toFixed(2)}, onObstacle=${player.state.onObstacle})`);

  // Walk off the bench edge -> smoothly descends back to ground y = 2.0
  env.win.dispatchKey('keydown', 'KeyW');
  for (let i = 0; i < 80; i++) {
    player.update(1 / 60, cam);
    barrier.resolve(player.state, 0.42);
  }
  env.win.dispatchKey('keyup', 'KeyW');
  assert.ok(Math.abs(player.state.y - 2.0) < 0.03 && !player.state.onObstacle, `walking off bench returns cleanly to ground (y=${player.state.y.toFixed(2)})`);

  // 1D. Tall house wall (4.5m) & unheighted cliff wall CANNOT be jumped over
  for (const [bx, label] of [[-8, '4.5m house'], [-16, 'cliff wall']]) {
    player.state.x = bx;
    player.state.z = 3.0;
    player.state.y = 2.0;
    player.state.vx = 0;
    player.state.vz = 0;
    env.win.dispatchKey('keydown', 'KeyW');
    env.win.dispatchKey('keydown', 'Space');
    for (let i = 0; i < 80; i++) {
      player.update(1 / 60, cam);
      barrier.resolve(player.state, 0.42);
    }
    env.win.dispatchKey('keyup', 'KeyW');
    env.win.dispatchKey('keyup', 'Space');
    assert.ok(player.state.z > 1.5, `cannot jump over ${label} (ended z=${player.state.z.toFixed(2)})`);
  }

  // 1E. Blocked when seated, aboardSkiff, godFlight, or map open
  player.state.x = 0; player.state.z = 8; player.state.y = 2.0;
  player.state.seated = true;
  assert.equal(player.jump(), false, 'jump blocked while seated');
  player.state.seated = false;
  player.state.aboardSkiff = true;
  assert.equal(player.jump(), false, 'jump blocked aboard skiff');
  player.state.aboardSkiff = false;
  env.body.classList.add('map-open');
  assert.equal(player.jump(), false, 'jump blocked when map open');
  env.body.classList.remove('map-open');
  assert.equal(player.jump(), true, 'jump allowed in normal walking state');

  // 1F. Touch controls include '跃' jump button that dispatches Space
  const tc = createTouchControls({ canvas, player, doc: env.doc, win: env.win, forceEnable: true });
  const jumpBtn = env.doc.getElementById('touch-act-jump');
  assert.ok(jumpBtn, 'touch controls mount #touch-act-jump button');
  const before = env.dispatched.length;
  jumpBtn.dispatch('click', { preventDefault() {}, stopPropagation() {} });
  assert.equal(env.dispatched.length, before + 1);
  assert.equal(env.dispatched.at(-1).code, 'Space', 'touch jump pill dispatches Space');
  tc.dispose();

  player.dispose();
  avatar.dispose();
  footstepFx.dispose();
  console.log(`PASS Part 1: Player jump & low obstacle vaulting (peak=${(peakY - 2.0).toFixed(2)}m, 1.05m fence cleared, 0.55m bench perched, tall walls blocked)`);
}

// ============================================================================
// PART 2: Four-Season Road Modeling & Vertex Color Differentiation
// ============================================================================
{
  const env = createMockEnv();
  globalThis.document = env.doc;
  globalThis.window = env.win;

  const curve = createRiverCurve(world.stream.points);
  const spine = sampleRiverSpine(curve, 160);
  const river = createRiverDistance(spine);
  const terrain = createTerrain(world.terrain, river, { road: world.village.road, pond: world.terrain.pond });
  terrain.field.colorAt = terrain.colorAt;
  const cliff = createCliff(world.cliff, terrain.field);
  const basin = world.terrain.basin;
  const floraField = {
    half: terrain.field.half,
    sample: (x, z) => terrain.field.sample(x, z),
    slope: (x, z) => (Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : terrain.field.slope(x, z))
  };
  const flora = createFlora(world.flora, floraField, river, curve, world.player.spawn, () => false);
  const boats = createBoats(world.boats, { surfaceY: () => world.terrain.waterLevel }, world.terrain, curve, terrain.field);
  const village = createVillage(structuredClone(world.village), terrain.field, world.terrain.pond);
  const props = createProps(world.props, terrain.field, village.houseInfo, village.plots, village.road);
  const hinterland = createHinterland(world.hinterland, terrain.field, river, world, village, props, cliff);
  const smoothHinterlandPaths = createSmoothHinterlandPaths(hinterland, terrain.field, world.hinterland);
  const exterior = createExteriorExploration(world, terrain.field, river, curve, flora, boats, cliff);
  const qianmoPaths = createQianmoPaths({
    world, field: terrain.field, terrain, colorAt: terrain.colorAt, village, props, hinterland, exterior
  });
  attachGroundSurface(terrain.field, { world, village, props, exterior, qianmoPaths });

  const roadMesh = village.group.getObjectByName('village-road');
  const spurMesh = village.group.getObjectByName('village-spurs');
  const laneStones = village.group.getObjectByName('lane-stones');
  const qianmoMesh = qianmoPaths.group.getObjectByName('qianmo-paths-ground');
  const extRoadMesh = exterior.group.getObjectByName('exterior-exploration-ground');

  assert.ok(roadMesh && spurMesh && qianmoMesh && smoothHinterlandPaths && extRoadMesh, 'all 5 road meshes present');

  const springSnaps = {
    road: Float32Array.from(roadMesh.geometry.attributes.color.array),
    spur: Float32Array.from(spurMesh.geometry.attributes.color.array),
    qianmo: Float32Array.from(qianmoMesh.geometry.attributes.color.array),
    hinterland: Float32Array.from(smoothHinterlandPaths.geometry.attributes.color.array),
    exterior: Float32Array.from(extRoadMesh.geometry.attributes.color.array),
    laneStones: laneStones ? Float32Array.from(laneStones.instanceColor.array) : null
  };

  const skyStub = { timeId: 'day', weatherId: 'clear', rainIntensity: 0, snowIntensity: 0, wind: 0.3 };
  const phen = createPhenologySystem({
    world,
    field: terrain.field,
    riverCurve: curve,
    cliff,
    terrain,
    village,
    hinterland,
    smoothHinterlandPaths,
    exterior,
    qianmoPaths,
    sky: skyStub,
    doc: env.doc,
    win: env.win
  });

  // 2A. Startup in spring keeps all base road buffers byte-exact
  assert.deepEqual(Array.from(roadMesh.geometry.attributes.color.array), Array.from(springSnaps.road), 'spring startup keeps village-road byte-exact');
  assert.deepEqual(Array.from(smoothHinterlandPaths.geometry.attributes.color.array), Array.from(springSnaps.hinterland), 'spring startup keeps smoothHinterlandPaths byte-exact');
  assert.deepEqual(Array.from(extRoadMesh.geometry.attributes.color.array), Array.from(springSnaps.exterior), 'spring startup keeps exterior road byte-exact');

  // 2B. Verify all 4 seasonal road 3D dressing meshes exist, have valid finite non-black geometry, and differ in modeling
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  const triCounts = {};
  for (const s of seasons) {
    const im = phen.interiorGroup.getObjectByName(`seasonal-road-${s}`);
    const em = phen.exteriorGroup.getObjectByName(`seasonal-road-ext-${s}`);
    assert.ok(im && im.isMesh, `seasonal-road-${s} built in interiorGroup`);
    assert.ok(em && em.isMesh, `seasonal-road-ext-${s} built in exteriorGroup`);
    for (const m of [im, em]) {
      const p = m.geometry.attributes.position;
      const n = m.geometry.attributes.normal;
      const c = m.geometry.attributes.color;
      const tris = p.count / 3;
      assert.ok(tris >= 50 && tris < 15000, `${m.name} triangle count (${tris}) healthy`);
      for (let i = 0; i < p.count; i++) {
        assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)), `${m.name} finite pos`);
        const nLen = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
        assert.ok(nLen > 0.9 && nLen < 1.1, `${m.name} unit normal`);
        assert.ok(c.getX(i) + c.getY(i) + c.getZ(i) > 0.15, `${m.name} non-black vertex colors`);
      }
    }
    triCounts[s] = Math.round((im.geometry.attributes.position.count + em.geometry.attributes.position.count) / 3);
  }
  assert.ok(new Set(Object.values(triCounts)).size >= 3, `seasonal road 3D modeling differs geometrically across seasons (${JSON.stringify(triCounts)})`);

  // 2C. Measure mean RGB of road meshes across all 4 seasons & verify every pair differs
  const meanRgb = (arr) => {
    let r = 0, g = 0, b = 0;
    const n = arr.length / 3;
    for (let i = 0; i < arr.length; i += 3) { r += arr[i]; g += arr[i + 1]; b += arr[i + 2]; }
    return { r: r / n, g: g / n, b: b / n };
  };
  const rgbDist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

  const bySeason = {};
  for (const s of seasons) {
    phen.setPhenology(s, false);
    assert.equal(phen.getStats().roadDressingVisible, `seasonal-road-${s}`, `active road dressing switches to ${s}`);
    // Ensure only the active season's road dressing is visible
    for (const other of seasons) {
      const m = phen.interiorGroup.getObjectByName(`seasonal-road-${other}`);
      assert.equal(m.visible, other === s, `seasonal-road-${other} visibility matches active season ${s}`);
    }
    bySeason[s] = {
      road: meanRgb(roadMesh.geometry.attributes.color.array),
      spur: meanRgb(spurMesh.geometry.attributes.color.array),
      qianmo: meanRgb(qianmoMesh.geometry.attributes.color.array),
      hinterland: meanRgb(smoothHinterlandPaths.geometry.attributes.color.array),
      exterior: meanRgb(extRoadMesh.geometry.attributes.color.array)
    };
  }

  for (let i = 0; i < seasons.length; i++) {
    for (let j = i + 1; j < seasons.length; j++) {
      const a = seasons[i], b = seasons[j];
      assert.ok(rgbDist(bySeason[a].road, bySeason[b].road) > 0.015, `village-road differs clearly: ${a} vs ${b}`);
      assert.ok(rgbDist(bySeason[a].qianmo, bySeason[b].qianmo) > 0.015, `qianmo-paths differs clearly: ${a} vs ${b}`);
      assert.ok(rgbDist(bySeason[a].hinterland, bySeason[b].hinterland) > 0.015, `hinterland road differs clearly: ${a} vs ${b}`);
      assert.ok(rgbDist(bySeason[a].exterior, bySeason[b].exterior) > 0.015, `exterior road differs clearly: ${a} vs ${b}`);
    }
  }
  // Winter snow road clearly brighter than spring clay road
  const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  assert.ok(lum(bySeason.winter.road) > lum(bySeason.spring.road) + 0.08, 'winter village-road clearly snow-covered vs spring');
  assert.ok(bySeason.autumn.road.r > bySeason.autumn.road.b + 0.14, 'autumn village-road warms to russet-ochre');

  // 2D. Exact round-trip restoration back to spring
  phen.setPhenology('spring', false);
  assert.deepEqual(Array.from(roadMesh.geometry.attributes.color.array), Array.from(springSnaps.road), 'village-road restored byte-exact on spring return');
  assert.deepEqual(Array.from(spurMesh.geometry.attributes.color.array), Array.from(springSnaps.spur), 'village-spurs restored byte-exact on spring return');
  assert.deepEqual(Array.from(qianmoMesh.geometry.attributes.color.array), Array.from(springSnaps.qianmo), 'qianmo-paths restored byte-exact on spring return');
  assert.deepEqual(Array.from(smoothHinterlandPaths.geometry.attributes.color.array), Array.from(springSnaps.hinterland), 'hinterland road restored byte-exact on spring return');
  assert.deepEqual(Array.from(extRoadMesh.geometry.attributes.color.array), Array.from(springSnaps.exterior), 'exterior road restored byte-exact on spring return');
  if (laneStones && springSnaps.laneStones) {
    assert.deepEqual(Array.from(laneStones.instanceColor.array), Array.from(springSnaps.laneStones), 'lane-stones restored byte-exact on spring return');
  }

  phen.dispose();
  console.log(`PASS Part 2: Four-season road modeling & vertex colors verified (${JSON.stringify(triCounts)})`);
}
