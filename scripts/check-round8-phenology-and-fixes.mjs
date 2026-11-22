import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createCliff } from '../src/world/cliff.js';
import { createFlora } from '../src/world/flora.js';
import { createReeds } from '../src/world/reeds.js';
import { createBoats } from '../src/world/boats.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { planMysterySites } from '../src/world/mysteries.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createCavePassage } from '../src/world/cave-passage.js';
import { createBarrier } from '../src/systems/barrier.js';
import { createPlayer } from '../src/player/controller.js';
import { createRiverSkiff } from '../src/systems/river-skiff.js';
import { createInteraction } from '../src/systems/interaction.js';
import { createPetals, createFallenPetals } from '../src/systems/petals.js';
import { createWorldClock } from '../src/systems/world-clock.js';
import { createPhenologySystem } from '../src/systems/phenology-mist.js';
import { createNeighborTheaters } from '../src/systems/neighbor-theaters.js';
import { createTactileProps } from '../src/systems/tactile-props.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { createWeather } from '../src/systems/weather.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const scriptData = JSON.parse(readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8'));

// Code hygiene & no-spoiler checks on all Round 8 modules
for (const rel of [
  '../src/systems/phenology-mist.js',
  '../src/systems/neighbor-theaters.js',
  '../src/systems/tactile-props.js',
  '../src/systems/villager-dialogue.js'
]) {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.ok(!/\bconsole\.log\s*\(/.test(src), `no console.log in ${rel}`);
  for (const taboo of ['处处志', '太守', '刘子骥', '南阳', '寻向所志', '遂迷', '不复得路']) {
    assert.ok(!src.includes(taboo), `no Act-3 spoiler '${taboo}' in ${rel}`);
  }
}

function createDomEnv() {
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
    const attrs = new Map();
    const el = {
      id,
      tagName: String(tag).toUpperCase(),
      textContent: '',
      innerHTML: '',
      hidden: false,
      style: { cssText: '', opacity: '1' },
      dataset: {},
      children: [],
      parentNode: null,
      classList: makeClassList(),
      appendChild(child) {
        child.parentNode = el;
        if (!el.children.includes(child)) el.children.push(child);
        if (child.id) els.set(child.id, child);
        return child;
      },
      insertBefore(child, ref) {
        child.parentNode = el;
        const idx = el.children.indexOf(ref);
        if (idx >= 0) el.children.splice(idx, 0, child);
        else el.children.push(child);
        if (child.id) els.set(child.id, child);
        return child;
      },
      remove() {
        if (el.parentNode) {
          const i = el.parentNode.children.indexOf(el);
          if (i >= 0) el.parentNode.children.splice(i, 1);
          el.parentNode = null;
        }
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') { el.id = String(v); els.set(el.id, el); }
      },
      getAttribute(k) { return attrs.get(k) ?? null; },
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
        const arr = listeners.get(type) || [];
        for (const fn of [...arr]) fn({ target: el, preventDefault() {}, stopPropagation() {}, ...ev });
      },
      closest() { return null; },
      getContext() {
        return new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => t[k] ?? (() => {}) });
      }
    };
    if (id) els.set(id, el);
    return el;
  };
  const body = makeEl('body', 'body');
  body.classList.add('curtain-open');
  const getEl = id => {
    if (!els.has(id)) els.set(id, makeEl('div', id));
    return els.get(id);
  };
  for (const id of ['sky', 'sky-time', 'sky-weather', 'sky-toast', 'reticle', 'prompt', 'prompt-key', 'prompt-text', 'talk', 'talk-who', 'talk-line', 'mystery-note', 'view', 'view-name', 'hint']) {
    body.appendChild(getEl(id));
  }
  const winListeners = new Map();
  const win = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = winListeners.get(type);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchKey(code, extra = {}) {
      let prevented = false;
      const ev = {
        code,
        key: code.replace(/^Key/, '').toLowerCase(),
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
      for (const fn of [...(winListeners.get('keydown') || [])]) fn(ev);
      return ev;
    }
  };
  const doc = {
    body,
    hidden: false,
    pointerLockElement: null,
    hasFocus: () => true,
    getElementById: id => els.get(id) || null,
    createElement: tag => makeEl(tag),
    addEventListener() {},
    removeEventListener() {}
  };
  return { doc, win, getEl };
}

const initEnv = createDomEnv();
globalThis.document = initEnv.doc;
globalThis.window = initEnv.win;

// Build shared world context once
const curve = createRiverCurve(world.stream.points);
const spine = sampleRiverSpine(curve, 160);
const river = createRiverDistance(spine);
const heightFn = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from({ length: grid.attributes.position.count }, (_, i) =>
  heightFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i))
);
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const cliff = createCliff(world.cliff, field);
const basin = world.terrain.basin;
const floraField = {
  half: field.half,
  sample: (x, z) => field.sample(x, z),
  slope: (x, z) => (Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z))
};
const near = (x, z) =>
  Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34 ||
  Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40 ||
  world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);
const flora = createFlora(world.flora, floraField, river, curve, world.player.spawn, near);
const reeds = createReeds(world.reeds, field, curve, world.terrain);
const petals = createPetals(world.petals, field);
const fallen = createFallenPetals(world.fallenPetals, field, flora.spots, curve, world.terrain.waterLevel);
const streamMock = { curve, surfaceY: () => world.terrain.waterLevel };
const boats = createBoats(world.boats, streamMock, world.terrain, curve, field);
const village = createVillage(structuredClone(world.village), field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const scenes = createVillageScenes(world, field, river, village, props, cliff, hinterland);
const sites = planMysterySites(world, field, river, village, props, cliff, hinterland, scenes, flora);
const life = createVillageLife(world, field, river, village, props, cliff, hinterland, scenes, { sites });
const exterior = createExteriorExploration(world, field, river, curve, flora, boats, cliff);
const baseOpts = {
  world, field, distanceToRiver: river, riverCurve: curve, stream: streamMock,
  flora, hinterland, village, villageScenes: scenes, villageLife: life, props, boats, cliff, exterior
};
baseOpts.habitatDetails = createHabitatDetails(baseOpts);
const cavePassage = createCavePassage({ world, cliff, field });
const pondLife = createPondLife(baseOpts);
const waterworks = createWaterworks({ ...baseOpts, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...baseOpts, reservations: [pondLife, waterworks] });
const qinHanHomestead = createQinHanHomestead({
  ...baseOpts, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove]
});
const qinHanCompletion = createQinHanCompletion({
  world, field, village, props, leisureGrove, qinHanHomestead,
  blockers: cliff.blockers.concat(village.blockers, qinHanHomestead.blockers, leisureGrove.blockers)
});

// =========================================================================
// 1. Slowed Default World Clock (cycleSeconds = 720s = 12 min/day)
// =========================================================================
{
  const env = createDomEnv();
  const mockSky = {
    timeId: 'day',
    weatherId: 'clear',
    rainIntensity: 0,
    applyContinuousSolar() {}
  };
  const clock = createWorldClock({ sky: mockSky, smoke: null, doc: env.doc, win: env.win });
  const st0 = clock.getState();
  assert.equal(st0.cycleSeconds, 720, 'default cycleSeconds slowed 4x to 720s (12 minutes per 24h day)');
  for (let i = 0; i < 600; i++) clock.update(0.05); // 30s = +1.0 hour at 720s/day
  const st1 = clock.getState();
  assert.ok(Math.abs((st1.hour - st0.hour) - 1.0) < 0.02, `30s advances 1 solar hour (${st0.hour} -> ${st1.hour})`);
  clock.update(0);
  assert.equal(clock.getState().hour, st1.hour, 'dt=0 freezes world clock');
  clock.dispose?.();
}

// =========================================================================
// 2. Cave Passage Smooth Tangent Blockers + Raised Floor + 3rd-Person Camera
// =========================================================================
{
  const env = createDomEnv();
  globalThis.document = env.doc;
  globalThis.window = env.win;

  const caveStats = cavePassage.getStats();
  assert.ok(caveStats.built && caveStats.lengthMeters >= 40, 'winding cave passage built');

  // Walk simulated player from outer mouth (+19.5) all the way through to inner mouth (-19.5)
  const allCaveBlockers = cliff.blockers.concat(cavePassage.blockers);
  const barrier = createBarrier(allCaveBlockers);
  const canvasMock = { addEventListener() {}, removeEventListener() {}, requestPointerLock() {} };
  const player = createPlayer(canvasMock, world.player, field, world.terrain, env.getEl('hint'), {
    viewEl: env.getEl('view'),
    viewNameEl: env.getEl('view-name'),
    blockers: allCaveBlockers,
    cliff: world.cliff
  });
  player.setView('third');
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);

  const slit = cliff.slit;
  const ux = Math.cos(slit.angle), uz = Math.sin(slit.angle);
  const tx = -uz, tz = ux;
  const sStart = 19.2;
  const clStart = cavePassage.centerLat(sStart);
  player.state.x = slit.x + ux * sStart + tx * clStart;
  player.state.z = slit.z + uz * sStart + tz * clStart;
  player.state.y = field.sample(player.state.x, player.state.z);

  let curS = sStart;
  let stuckSteps = 0;
  let minCoreCamDist = Infinity;
  for (let step = 0; step < 340 && curS > -19.2; step++) {
    // Steer gently toward centerline 1.6m ahead along -u (into valley)
    const lookS = curS - 1.6;
    const lookCl = cavePassage.centerLat(lookS);
    const goalX = slit.x + ux * lookS + tx * lookCl;
    const goalZ = slit.z + uz * lookS + tz * lookCl;
    const dx = goalX - player.state.x;
    const dz = goalZ - player.state.z;
    const len = Math.hypot(dx, dz) || 1;
    const stepDist = 4.2 * 0.04;
    player.state.x += (dx / len) * stepDist;
    player.state.z += (dz / len) * stepDist;
    player.state.yaw = Math.atan2(-dx, -dz);
    player.state.targetYaw = player.state.yaw;
    player.state.camYaw = player.state.yaw;
    barrier.resolve(player.state, 0.42);
    player.syncCamera(cam);

    const relX = player.state.x - slit.x;
    const relZ = player.state.z - slit.z;
    const nextS = relX * ux + relZ * uz;
    const across = relX * tx + relZ * tz;
    const clNow = cavePassage.centerLat(nextS);
    const hwNow = cavePassage.halfWidth(nextS);
    assert.ok(
      Math.abs(across - clNow) <= hwNow - 0.15,
      `player stays inside cave wall without embedding at s=${nextS.toFixed(2)} (offset=${Math.abs(across - clNow).toFixed(2)}, hw=${hwNow.toFixed(2)})`
    );
    if (nextS >= curS - 0.01) stuckSteps++;
    curS = nextS;
    if (Math.abs(curS) < 6.0) {
      minCoreCamDist = Math.min(minCoreCamDist, player.state.camDist);
    }
  }
  assert.ok(curS <= -19.0, `player walked cleanly through entire cave to inner mouth (ended at s=${curS.toFixed(2)})`);
  assert.equal(stuckSteps, 0, 'zero stuck/wedged steps along the winding cave walls');
  assert.ok(
    minCoreCamDist <= world.player.view.third.distance * 0.62 && minCoreCamDist >= world.player.view.third.hideDistance,
    `3rd-person camera tightens smoothly inside cave without hiding avatar (camDist=${minCoreCamDist.toFixed(2)})`
  );
  player.dispose?.();
}

// =========================================================================
// 3. River Skiff Disembark Camera Alignment (faces ashore, no backward pull)
// =========================================================================
{
  const env = createDomEnv();
  globalThis.document = env.doc;
  globalThis.window = env.win;

  const canvasMock = { addEventListener() {}, removeEventListener() {}, requestPointerLock() {} };
  const player = createPlayer(canvasMock, world.player, field, world.terrain, env.getEl('hint'), {
    viewEl: env.getEl('view'),
    viewNameEl: env.getEl('view-name'),
    blockers: [],
    cliff: world.cliff
  });
  player.setView('third');
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
  const avatarMock = { group: new THREE.Group(), state: {}, setSeated() {}, update() {} };

  const mysteriesStub = {
    pickTarget: () => null,
    interact: () => null,
    hide() {}
  };
  const skiff = createRiverSkiff({
    world, field, stream: streamMock, riverCurve: curve, distanceToRiver: river, boats, cliff
  });
  skiff.bind({
    player,
    avatar: avatarMock,
    camera: cam,
    mysteries: mysteriesStub,
    sound: null,
    blockers: [],
    hintEl: env.getEl('hint'),
    doc: env.doc,
    win: env.win,
    autoBoard: true
  });
  assert.equal(skiff.getStats().aboard, true, 'skiff auto-boarded');
  skiff.update(0.05, 0.1, { windX: 0, windZ: 0 }, player.state, cam, false);

  const boatAnchor = skiff.getAnchor();
  assert.ok(skiff.disembark(), 'disembark succeeded');

  const interaction = createInteraction(
    world.interaction,
    scriptData,
    { list: [], greet() {} },
    { animals: [], react: () => null },
    field,
    player,
    { voice() {} },
    null,
    [],
    mysteriesStub,
    null
  );

  // Run several post-disembark frames to ensure camera stays facing ashore and is never pulled back to the skiff
  for (let f = 0; f < 10; f++) {
    player.update(0.016, cam);
    interaction.update(0.016, f * 0.016, cam);
    player.setFocus(interaction.getFocus());
    player.syncCamera(cam);
  }
  const shoreVecX = player.state.x - boatAnchor.x;
  const shoreVecZ = player.state.z - boatAnchor.z;
  const shoreLen = Math.hypot(shoreVecX, shoreVecZ) || 1;
  const camFwdX = -Math.sin(cam.rotation.y);
  const camFwdZ = -Math.cos(cam.rotation.y);
  const dotAshore = (camFwdX * shoreVecX + camFwdZ * shoreVecZ) / shoreLen;
  assert.ok(
    dotAshore > 0.75,
    `post-disembark 3rd-person camera faces ashore away from boat (dot=${dotAshore.toFixed(3)})`
  );
  assert.ok(cam.rotation.x > -0.35, `camera pitch resets to natural horizon instead of overhead boat angle (${cam.rotation.x.toFixed(3)})`);

  interaction.dispose();
  skiff.dispose();
  player.dispose?.();
}

// =========================================================================
// 4. Micro-Phenology (春深落英 / 夏初新荷 / 秋熟金粟) & Drifting Valley Mist
// =========================================================================
{
  const env = createDomEnv();
  const skyStub = { timeId: 'day', weatherId: 'clear', rainIntensity: 0, windX: 0.12, windZ: 0.04 };
  const cropMesh = qinHanCompletion.group.getObjectByName('qin-han-millet-crops');
  assert.ok(cropMesh, 'qin-han-millet-crops present for phenology tinting');
  const springCropSnap = Float32Array.from(cropMesh.geometry.attributes.color.array);

  const phenology = createPhenologySystem({
    world, field, riverCurve: curve, cliff, flora, petals, fallen, reeds, pondLife, qinHanCompletion,
    sky: skyStub, doc: env.doc, win: env.win
  });
  phenology.update(0.05, 0.1, skyStub);
  assert.equal(phenology.getStats().phenologyId, 'spring', 'defaults to untouched spring baseline');
  assert.equal(phenology.getStats().mistVisible, false, 'clear daytime hides valley mist ribbons (0 extra draw calls)');
  assert.equal(phenology.getStats().lotusVisible, false, 'summer lotus hidden in spring');

  // Press KeyK -> Summer (夏初新荷)
  env.win.dispatchKey('KeyK');
  assert.equal(phenology.getStats().phenologyId, 'summer');
  assert.equal(phenology.getStats().lotusVisible, true, 'summer lotus blooms in pond');
  assert.ok(env.doc.getElementById('sky-phenology')?.textContent.includes('夏初'), 'HUD row updates to 夏初');
  {
    const lotusMesh = phenology.group.getObjectByName('phenology-summer-lotus');
    assert.ok(lotusMesh, 'phenology-summer-lotus mesh exists');
    lotusMesh.updateMatrixWorld(true);
    const posAttr = lotusMesh.geometry.attributes.position;
    const vTmp = new THREE.Vector3();
    const restWorldY = new Float32Array(posAttr.count);
    let minWorldY = Infinity;
    let maxWorldY = -Infinity;
    for (let i = 0; i < posAttr.count; i++) {
      vTmp.fromBufferAttribute(posAttr, i).applyMatrix4(lotusMesh.matrixWorld);
      restWorldY[i] = vTmp.y;
      if (vTmp.y < minWorldY) minWorldY = vTmp.y;
      if (vTmp.y > maxWorldY) maxWorldY = vTmp.y;
    }
    const pondWaterY = world.terrain.pond.waterY;
    assert.ok(minWorldY <= pondWaterY - 0.15, `lotus stems root underwater below pondWaterY (minY=${minWorldY.toFixed(3)})`);
    assert.ok(maxWorldY <= pondWaterY + 0.55, `lotus leaves/buds stay low & natural near pond surface (maxY=${maxWorldY.toFixed(3)})`);
    for (let step = 0; step < 60; step++) {
      phenology.update(0.1, step * 0.1, { ...skyStub, wind: 1.0 });
      lotusMesh.updateMatrixWorld(true);
      for (let i = 0; i < posAttr.count; i += 17) {
        vTmp.fromBufferAttribute(posAttr, i).applyMatrix4(lotusMesh.matrixWorld);
        assert.ok(
          Math.abs(vTmp.y - restWorldY[i]) < 1e-5,
          `lotus breeze sway never bounces or tilts world Y (drift=${Math.abs(vTmp.y - restWorldY[i])})`
        );
      }
    }
  }

  // Press KeyK -> Autumn (秋熟金粟)
  env.win.dispatchKey('KeyK');
  assert.equal(phenology.getStats().phenologyId, 'autumn');
  const autumnCropArr = cropMesh.geometry.attributes.color.array;
  let cropChanged = false;
  for (let i = 0; i < autumnCropArr.length; i += 3) {
    if (Math.abs(autumnCropArr[i] - springCropSnap[i]) > 0.05) { cropChanged = true; break; }
  }
  assert.ok(cropChanged, 'autumn phenology ripens millet crops to golden-amber');
  assert.ok(env.doc.getElementById('sky-phenology')?.textContent.includes('秋熟'), 'HUD row updates to 秋熟');

  // Press KeyK -> Winter (冬寂薄雪): fourth season closes the cycle
  env.win.dispatchKey('KeyK');
  assert.equal(phenology.getStats().phenologyId, 'winter');
  assert.ok(env.doc.getElementById('sky-phenology')?.textContent.includes('冬寂'), 'HUD row updates to 冬寂');

  // Press KeyK -> Back to Spring (春深落英) exact restoration
  env.win.dispatchKey('KeyK');
  assert.equal(phenology.getStats().phenologyId, 'spring');
  assert.deepEqual(Array.from(cropMesh.geometry.attributes.color.array), Array.from(springCropSnap), 'returning to spring restores exact crop vertex colors');

  // Switch to dawn -> valley mist ribbons appear and drift with dt > 0, freeze on dt = 0
  skyStub.timeId = 'dawn';
  for (let i = 0; i < 20; i++) phenology.update(0.05, 1 + i * 0.05, skyStub);
  const dawnStats = phenology.getStats();
  assert.equal(dawnStats.mistVisible, true, 'valley mist ribbons appear at dawn');
  assert.ok(dawnStats.mistOpacity > 0.12, `dawn mist opacity > 0.12 (${dawnStats.mistOpacity})`);
  const mistMesh = phenology.group.getObjectByName('valley-mist-ribbons');
  assert.equal(mistMesh.material.isShaderMaterial, true, 'valley mist uses radial-feathered ShaderMaterial (no unfeathered rectangular MeshBasicMaterial)');
  assert.ok(mistMesh.material.fragmentShader.includes('outerGuard') && mistMesh.material.fragmentShader.includes('groundFade') && mistMesh.material.fragmentShader.includes('nearFade'), 'mist shader enforces radial edge guard, terrain clearance fade, and camera near dissolve');
  const groundArr = mistMesh.geometry.getAttribute('aGroundY').array;
  const matTmp = new THREE.Matrix4();
  const posTmp = new THREE.Vector3();
  const quatTmp = new THREE.Quaternion();
  const scaleTmp = new THREE.Vector3();
  const pondX = world.terrain.pond.x;
  const pondZ = world.terrain.pond.z;
  for (let i = 0; i < mistMesh.count; i++) {
    mistMesh.getMatrixAt(i, matTmp);
    matTmp.decompose(posTmp, quatTmp, scaleTmp);
    assert.ok(posTmp.y - scaleTmp.y * 0.5 > groundArr[i] + 0.1, `mist wisp #${i} bottom stays strictly above ground/water (no Z-buffer terrain slice)`);
    assert.ok(Math.hypot(posTmp.x - pondX, posTmp.z - pondZ) > world.terrain.pond.radius + 4, `mist wisp #${i} stays outside central village pond basin`);
  }
  const snapMist = Float32Array.from(mistMesh.instanceMatrix.array.slice(0, 32));
  phenology.update(0, 99, skyStub);
  assert.deepEqual(Array.from(mistMesh.instanceMatrix.array.slice(0, 32)), Array.from(snapMist), 'dt=0 freezes valley mist');

  // Verify dusk/night clear sky never produces bright white mist gain/color
  skyStub.timeId = 'dusk';
  for (let i = 0; i < 15; i++) phenology.update(0.05, 3 + i * 0.05, skyStub);
  assert.ok(mistMesh.material.uniforms.uVisualGain.value <= 0.12, 'clear dusk mist visualGain stays ultra-subtle (no white veil)');
  skyStub.timeId = 'night';
  for (let i = 0; i < 15; i++) phenology.update(0.05, 4 + i * 0.05, skyStub);
  assert.ok(mistMesh.material.uniforms.uVisualGain.value <= 0.09, 'clear night mist visualGain stays ultra-subtle (no white veil)');

  phenology.dispose();

  // Also verify weather.js mist sprites stay elevated & distant (never slicing foreground grass slopes)
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }),
          fillRect() {}
        })
      };
    }
  };
  const weatherScene = new THREE.Scene();
  weatherScene.fog = new THREE.Fog('#B8C8BE', 40, 140);
  const wx = createWeather(world.sky, weatherScene);
  const wxCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 300);
  wxCam.position.set(68, 5.2, -138);
  wx.update(0.05, wxCam, {
    rain: 0,
    mist: 1,
    wind: 0.2,
    windX: 0.1,
    windZ: 0.05,
    rainColor: new THREE.Color('#CFD8DC'),
    mistColor: new THREE.Color('#E2EAEB')
  });
  const mistSprites = weatherScene.children.filter(c => c.isSprite);
  assert.equal(mistSprites.length, world.sky.mist.count, 'weather mist sprites created');
  for (const sp of mistSprites) {
    const horizDist = Math.hypot(sp.position.x - wxCam.position.x, sp.position.z - wxCam.position.z);
    const bottomY = sp.position.y - sp.scale.y * 0.5;
    assert.ok(horizDist >= 30, `weather mist sprite stays out of foreground (${horizDist.toFixed(1)}m)`);
    assert.ok(bottomY >= wxCam.position.y + 3.8, `weather mist sprite bottom stays above ground slopes (bottomY=${bottomY.toFixed(2)}, camY=${wxCam.position.y})`);
  }
  wx.dispose();
  globalThis.document = prevDoc;
}

// =========================================================================
// 5. Neighborly Routines: Dawn Well Water-Drawing, Dusk Buffalo Herding & Rain Eave Chat
// =========================================================================
{
  const env = createDomEnv();
  const theaters = createNeighborTheaters({
    world, field, village, props, qinHanHomestead, blockers: cliff.blockers.concat(village.blockers)
  });

  // Dawn: morning well water-drawing + morning greeting
  const dawnSky = { timeId: 'dawn', weatherId: 'clear', rainIntensity: 0 };
  for (let i = 0; i < 80; i++) theaters.update(0.05, i * 0.05, dawnSky, { x: 0, z: 0 });
  const dawnSt = theaters.getStats();
  assert.equal(dawnSt.theaterState, 'morning-well');
  assert.ok(dawnSt.wellBucketHeight > 0.15, `wooden well bucket hauled up at dawn (${dawnSt.wellBucketHeight.toFixed(2)}m)`);

  // Dusk: buffalo leaves pond onto dry bank & herder walks alongside
  const duskSky = { timeId: 'dusk', weatherId: 'clear', rainIntensity: 0, sunElevation: 0.05 };
  for (let i = 0; i < 90; i++) {
    qinHanHomestead.update(0.05, 5 + i * 0.05, duskSky, { x: 0, z: 0 });
    theaters.update(0.05, 5 + i * 0.05, duskSky, { x: 0, z: 0 });
  }
  const bufDusk = qinHanHomestead.getStats();
  assert.equal(bufDusk.buffaloMode, 'dusk-return', 'water buffalo enters dusk-return pasture walk at dusk');
  assert.ok(bufDusk.buffaloPos.y > world.terrain.pond.waterY + 0.15, 'returning buffalo walks on dry ground above pond waterY');
  assert.equal(theaters.getStats().theaterState, 'dusk-herd', 'herder accompanies returning buffalo at dusk');

  // Rain: sheltered eave conversation
  const rainSky = { timeId: 'day', weatherId: 'rain', rainIntensity: 0.85 };
  for (let i = 0; i < 240; i++) theaters.update(0.05, 10 + i * 0.05, rainSky, { x: 0, z: 0 });
  const rainSt = theaters.getStats();
  assert.equal(rainSt.theaterState, 'rain-eave-chat', 'neighbors gather under porch eave to chat in rain');
  const [a0, a1] = rainSt.actors;
  assert.ok(Math.hypot(a0.x - a1.x, a0.z - a1.z) < 2.2, 'sheltered neighbors stand close together under shared eave');

  // Contextual villager dialogue for well_drawer & herder
  const vd = createVillagerDialogue({
    sky: dawnSky,
    getWorldClock: () => ({ getState: () => ({ shichenName: '卯正' }) }),
    doc: env.doc,
    win: env.win
  });
  const session = vd.beginOrAdvance({
    kind: 'community',
    key: 'c_nt-well-drawer',
    name: '村人',
    ref: theaters.getInteractables()[0],
    lines: []
  });
  assert.ok(session.who.includes('汲水妇'), `custom persona title for well_drawer: ${session.who}`);
  assert.ok(session.meta.includes('汲水') || session.meta.includes('避雨'), `contextual activity meta: ${session.meta}`);
  assert.equal(session.replies.length, 2, 'offers 2 multi-turn reply branches');

  theaters.dispose();
}

// =========================================================================
// 6. Tactile Prop Close-Up Play: Pavilion Liubo Board & Streamside Fish Trap
// =========================================================================
{
  const env = createDomEnv();
  const woodSounds = [];
  const player = {
    state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, view: 'third', eyeHeight: 1.62, seated: false, seatId: null }
  };
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 300);
  const mysteriesStub = {
    pickTarget: () => null,
    interact: () => null,
    hide() {}
  };
  const tactile = createTactileProps({ leisureGrove, waterworks });
  tactile.bind({
    mysteries: mysteriesStub,
    player,
    camera: cam,
    sound: { wood: (x, z) => woodSounds.push([x, z]), footstep() {} },
    communityLife: null,
    doc: env.doc
  });

  const stInit = tactile.getStats();
  assert.equal(stInit.hasLiubo, true, 'Liubo tactile station built');
  assert.equal(stInit.hasFishTrap, true, 'Fish-trap tactile station built');
  assert.equal(stInit.drawCalls, 1, 'idle tactile-props uses only 1 draw call (fish-trap catch hidden)');

  // Stand beside Liubo board and aim at it
  const board = leisureGrove.layout.board;
  player.state.x = board.x;
  player.state.z = board.z + 1.55;
  player.state.y = field.sample(player.state.x, player.state.z);
  player.state.yaw = 0; // looking -Z toward board
  player.state.pitch = -0.22;
  const candLiubo = mysteriesStub.pickTarget(cam, world.interaction);
  assert.ok(candLiubo && candLiubo.key === 'tactile:liubo' && candLiubo.noCameraLock === true, 'Liubo prompt picked cleanly');
  const resLiubo = mysteriesStub.interact(candLiubo);
  assert.equal(resLiubo?.plays, 1, 'Liubo toss & piece move triggered');
  assert.equal(tactile.getStats().liuboAnimating, true);
  assert.ok(woodSounds.length >= 1, 'wood clack sound emitted on Liubo toss');
  assert.ok(env.getEl('mystery-note').textContent.includes('箸') || env.getEl('mystery-note').textContent.includes('采'), 'classical Liubo throw note shown');

  // Freeze check at dt=0
  const liuboMesh = tactile.group.getObjectByName('tactile-liubo-set');
  const snapLiubo = Float32Array.from(liuboMesh.instanceMatrix.array);
  tactile.update(0);
  assert.deepEqual(Array.from(liuboMesh.instanceMatrix.array), Array.from(snapLiubo), 'dt=0 freezes Liubo toss animation');
  for (let i = 0; i < 45; i++) tactile.update(0.05);
  assert.equal(tactile.getStats().liuboAnimating, false, 'Liubo micro-animation finishes cleanly');

  // Fish-trap trigger: verify submerged trap tug + carp splash + clean restore
  const trapGroup = waterworks.group.getObjectByName('waterworks-woven-fish-trap')?.parent;
  const restTrapY = trapGroup.position.y;
  const resTrap = tactile.trigger('fishtrap');
  assert.equal(resTrap?.plays, 1, 'Fish-trap haul & carp splash triggered');
  for (let i = 0; i < 9; i++) tactile.update(0.05);
  assert.equal(tactile.getStats().trapAnimating, true);
  assert.ok(trapGroup.position.y > restTrapY + 0.05, 'submerged bamboo fish trap lifts during haul inspection');
  for (let i = 0; i < 45; i++) tactile.update(0.05);
  assert.equal(tactile.getStats().trapAnimating, false);
  assert.equal(tactile.getStats().drawCalls, 1, 'fish-trap catch meshes hide again after animation (0 idle draw calls)');
  assert.ok(Math.abs(trapGroup.position.y - restTrapY) < 1e-6, 'borrowed submerged trap restored to exact rest height');

  tactile.dispose();
}

console.log('PASS Round 8 phenology & mist, neighborly routines, tactile Liubo/fish-trap props, slowed world clock, cave anti-clip, and skiff disembark camera');
