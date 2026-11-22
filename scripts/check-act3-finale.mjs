import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createCliff } from '../src/world/cliff.js';
import { segmentDistance } from '../src/world/hinterland.js';
import { createCaveGleam } from '../src/world/cave-gleam.js';
import { createAct3Finale } from '../src/world/act3-finale.js';
import { createOpeningCurtain } from '../src/systems/opening-curtain.js';
import { createDialogue } from '../src/systems/dialogue.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const script = JSON.parse(readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8'));
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

// Mock DOM with event listeners & element lookup
const nodes = new Map();
function mockEl(id) {
  const key = String(id).replace(/^#/, '');
  if (!nodes.has(key)) {
    const classes = new Set();
    const listeners = new Map();
    const el = {
      id: key,
      textContent: '',
      hidden: false,
      style: {},
      dataset: {},
      classList: {
        add: (...cs) => cs.forEach((c) => classes.add(c)),
        remove: (...cs) => cs.forEach((c) => classes.delete(c)),
        contains: (c) => classes.has(c),
        toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)),
      },
      setAttribute() {},
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type);
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      },
      dispatch(type, evt = {}) {
        const list = [...(listeners.get(type) || [])];
        for (const fn of list) fn({ target: el, preventDefault() {}, stopPropagation() {}, ...evt });
      },
      querySelector: (sel) => mockEl(sel),
      querySelectorAll: () => [],
      focus() {},
    };
    nodes.set(key, el);
  }
  return nodes.get(key);
}

const bodyClasses = new Set(['curtain-open']);
const timerQueue = [];
globalThis.document = {
  hidden: false,
  getElementById: mockEl,
  addEventListener: () => {},
  removeEventListener: () => {},
  body: {
    classList: {
      add: (...cs) => cs.forEach((c) => bodyClasses.add(c)),
      remove: (...cs) => cs.forEach((c) => bodyClasses.delete(c)),
      contains: (c) => bodyClasses.has(c),
    },
  },
};
globalThis.window = {
  location: { search: '' },
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: (fn) => {
    fn(16);
    return 1;
  },
  cancelAnimationFrame() {},
  setTimeout: (fn, ms) => {
    const id = timerQueue.length + 1;
    timerQueue.push({ id, fn, ms, canceled: false });
    return id;
  },
  clearTimeout: (id) => {
    const item = timerQueue.find((t) => t.id === id);
    if (item) item.canceled = true;
  },
};

function flushAllTimers() {
  let guard = 0;
  while (timerQueue.length > 0 && guard++ < 40) {
    const item = timerQueue.shift();
    if (!item.canceled) item.fn();
  }
}

// 1. HTML + CSS Ink Curtain / Epilogue Contracts
assert.ok(indexHtml.includes('ink-paper-grain'), 'index.html includes paper grain overlay');
assert.ok(indexHtml.includes('ink-left') && indexHtml.includes('ink-right'), 'index.html holds split ink mountain scrolls');
assert.ok(indexHtml.includes('class="ink-transition-card"') && indexHtml.includes('class="ink-epilogue-scroll"'), 'index.html holds Act 3 transition & epilogue DOM');
assert.ok(indexHtml.includes('id="epilogue-linger"') && indexHtml.includes('id="epilogue-replay"'), 'index.html holds linger & replay buttons');

const veilStart = indexHtml.indexOf('id="veil"');
const veilEnd = indexHtml.indexOf('<div id="gloom">', veilStart + 20);
const veilHtml = indexHtml.slice(veilStart, veilEnd > veilStart ? veilEnd : undefined);
const gradIds = [...veilHtml.matchAll(/<(?:linear|radial)Gradient[^>]*id="([^"]+)"/g)].map((m) => m[1]);
assert.ok(gradIds.length >= 4, 'ink SVG contains gradient definitions');
assert.equal(new Set(gradIds).size, gradIds.length, 'SVG gradient IDs inside #veil are strictly unique');

assert.ok(
  styleCss.includes('body.curtain-open:not(.curtain-parting) #veil:not(.on):not(.valley-bloom):not(.ink-transition):not(.ink-epilogue)'),
  'style.css guards #veil to hidden when idle after opening'
);
assert.ok(styleCss.includes('visibility: hidden;'), 'idle #veil uses visibility: hidden');

// 2. Opening Curtain Controller (Transition + Epilogue + Reset)
bodyClasses.clear();
const soundEvents = [];
const mockSound = {
  unlock() { soundEvents.push('unlock'); },
  voice(role) { soundEvents.push(`voice:${role}`); },
  wood() { soundEvents.push('wood'); },
  gatherSound(k) { soundEvents.push(`gather:${k}`); },
  guqinPluck() { soundEvents.push('guqin'); },
  bell() { soundEvents.push('bell'); },
};
const curtain = createOpeningCurtain({ sound: mockSound, veilEl: mockEl('veil') });
assert.equal(curtain.isOpen(), false);
curtain.openNow();
flushAllTimers();
assert.equal(curtain.isOpen(), true);
assert.equal(curtain.triggerValleyBloom(), true);
assert.equal(curtain.triggerValleyBloom(), false);
curtain.resetValleyBloom();
assert.equal(curtain.triggerValleyBloom(), true, 'resetValleyBloom permits replay valley bloom');

let midDone = false;
let transDone = false;
curtain.triggerInkTransition({
  seal: '太守复寻',
  classic: '既出，得其船……',
  plain: '重寻向路……',
  holdMs: 1200,
  onMidpoint: () => { midDone = true; },
  onComplete: () => { transDone = true; },
});
assert.equal(curtain.isTransitioning(), true);
assert.equal(mockEl('.ink-trans-seal').textContent, '太守复寻');
flushAllTimers();
assert.equal(midDone, true);
assert.equal(transDone, true);
assert.equal(curtain.isTransitioning(), false);

let lingered = 0;
let replayed = 0;
curtain.showEpilogue({ onLinger: () => lingered++, onReplay: () => replayed++ });
assert.equal(curtain.isEpilogueOpen(), true);
mockEl('epilogue-linger').dispatch('click');
assert.equal(lingered, 1);
assert.equal(curtain.isEpilogueOpen(), false);
curtain.showEpilogue({ onLinger: () => lingered++, onReplay: () => replayed++ });
mockEl('epilogue-replay').dispatch('click');
assert.equal(replayed, 1);
assert.equal(curtain.isEpilogueOpen(), false);

// 3. Act 3 Finale Geometry, Safety & State Flow on Real World Terrain
const curve = createRiverCurve(world.stream.points);
const river = createRiverDistance(sampleRiverSpine(curve, 160));
const height = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from({ length: grid.attributes.position.count }, (_, i) =>
  height(grid.attributes.position.getX(i), grid.attributes.position.getZ(i))
);
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const cliff = createCliff(world.cliff, field);
const basin = world.terrain.basin;
const floraField = {
  half: field.half,
  sample: (x, z) => field.sample(x, z),
  slope: (x, z) => (Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z)),
};
const near = (x, z) =>
  Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34 ||
  Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40 ||
  world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);
const flora = createFlora(world.flora, floraField, river, curve, world.player.spawn, near);
const boats = createBoats(world.boats, { surfaceY: () => world.terrain.waterLevel }, world.terrain, curve, field);

const preBlockers = [];
const act3 = createAct3Finale({
  world,
  field,
  distanceToRiver: river,
  riverCurve: curve,
  flora,
  boats,
  cliff,
  targetBlockers: preBlockers,
});
assert.equal(preBlockers.length, 1, 'sealBlocker pre-registered into targetBlockers');
assert.equal(preBlockers[0].hw, 0, 'sealBlocker inactive initially');

// Verify dry safe exterior placement for all sites & returnSpawn
const initStats = act3.getStats();
assert.equal(initStats.markers.length, 4);
const waterLevel = world.waterLevel ?? -1;
for (const m of [...initStats.markers, initStats.departFerry, initStats.returnSpawn]) {
  const groundY = field.sample(m.x, m.z);
  const rd = river(m.x, m.z);
  assert.ok(groundY >= waterLevel + 0.35, `site sits dry above creek: (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) y=${groundY.toFixed(2)}`);
  assert.ok(rd >= 2.0, `site clear of stream water: rd=${rd.toFixed(2)}`);
  assert.ok(Math.hypot(m.x - cliff.slit.x, m.z - cliff.slit.z) >= 9.0, 'site clear of cave mouth throat');
}

// Verify geometry & materials (zero NaN/black vertex colors, skyIgnore on overlays)
let meshCount = 0;
act3.group.traverse((obj) => {
  if (!obj.isMesh) return;
  meshCount++;
  const geo = obj.geometry;
  const pos = geo.getAttribute('position');
  assert.ok(pos && pos.count > 0, `mesh has vertices: ${obj.name}`);
  if (obj.material?.vertexColors) {
    const col = geo.getAttribute('color');
    assert.ok(col && col.count === pos.count, `vertexColors mesh has complete color attribute: ${obj.name}`);
    let nonZero = false;
    for (let i = 0; i < col.count; i++) {
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      assert.ok(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b), 'finite vertex colors');
      if (r + g + b > 0.05) nonZero = true;
    }
    assert.ok(nonZero, `non-black vertex color values: ${obj.name}`);
  }
  if (obj.material?.transparent) {
    assert.equal(obj.material.userData?.skyIgnore, true, `transparent overlay marks skyIgnore: ${obj.name}`);
  }
});
assert.ok(meshCount >= 20, 'Act 3 builds markers, ferry post, seal boulders & mist sheets');

// Setup systems to drive full narrative sequence
const gleam = createCaveGleam({ world, cliff, field });
const firedDialogues = [];
const dlg = createDialogue(script, (pt) => firedDialogues.push(pt.id));
let clearedJournalCount = 0;
const journal = {
  onClear() { clearedJournalCount++; },
};
let weatherId = 'clear';
const sky = {
  get weatherId() { return weatherId; },
  setWeather(id) { weatherId = id; },
  wind: { strength: 0.4, angle: 0.5 },
  getAppearance: () => ({ nightAmount: 0 }),
};
let aboard = true;
let disembarkCount = 0;
const riverSkiff = {
  isAboard: () => aboard,
  disembark() { aboard = false; disembarkCount++; },
};
const player = {
  state: {
    x: 26,
    y: field.sample(26, 204),
    z: 204,
    yaw: 0,
    targetYaw: 0,
    pitch: 0,
    targetPitch: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.62,
    view: 'first',
    aboardSkiff: false,
    still: false,
  },
  clearInput() {},
  syncCamera(cam) {
    cam?.position?.set(this.state.x, this.state.y + this.state.eyeHeight, this.state.z);
  },
};
const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 400);
const mysteries = {
  pickTarget: () => null,
  interact: () => false,
  hide: () => {},
};

act3.bind({
  doc: globalThis.document,
  player,
  dialogue: dlg,
  mysteries,
  riverSkiff,
  caveGleam: gleam,
  openingCurtain: curtain,
  sky,
  sound: mockSound,
  journal,
  camera,
});

// Phase 3.1: Should stay idle at spawn and mid exterior before visiting valley
act3.update(0.016, 0.1, sky, player.state, camera);
assert.equal(act3.getState().stage, 'idle');

// Simulate visiting deep inside basin + feast
player.state.x = 20;
player.state.z = -115;
act3.update(0.016, 0.2, sky, player.state, camera);
dlg.trigger('valley-open');
dlg.trigger('feast-invite');

// Return to inner cave mouth -> auto transitions to 'marking' & fires farewell
player.state.x = 22.5;
player.state.z = -16;
act3.update(0.016, 0.3, sky, player.state, camera);
assert.equal(act3.getState().stage, 'marking', 'returning near cave mouth starts Act 3 marking');
assert.ok(firedDialogues.includes('act3-farewell'), 'farewell classic subtitle triggered');
assert.ok(soundEvents.includes('voice:elder'), 'elder voice plays at farewell');

// Phase 3.2: Place first 2 markers interactively with E
const m0 = initStats.markers[0];
const m1 = initStats.markers[1];
player.state.x = m0.x;
player.state.z = m0.z + 2.2;
player.state.y = m0.y;
player.state.yaw = Math.atan2(-(m0.x - player.state.x), -(m0.z - player.state.z));
player.syncCamera(camera);
const pick0 = mysteries.pickTarget(camera, {});
assert.ok(pick0?.isAct3Finale && pick0.siteId === m0.id, 'pickTarget detects nearby unplaced marker');
assert.equal(mysteries.interact(pick0), true);
assert.equal(act3.getState().placedCount, 1);
assert.ok(firedDialogues.includes('act3-mark-trail'), 'first marker fires act3-mark-trail subtitle');

// Downstream auto-mark for m1 + m2
player.state.x = m1.x;
player.state.z = m1.z + 4.5;
player.state.vz = 1.2;
act3.update(0.016, 0.4, sky, player.state, camera);
assert.equal(act3.getState().placedCount, 2, 'downstream pass-by auto-places marker');

// Approach depart-ferry and trigger prefect return
const ferry = initStats.departFerry;
player.state.x = ferry.x;
player.state.z = ferry.z + 2.6;
player.state.y = ferry.y;
player.state.yaw = Math.atan2(-(ferry.x - player.state.x), -(ferry.z - player.state.z));
player.state.pitch = 0;
player.syncCamera(camera);
const pickFerry = mysteries.pickTarget(camera, {});
assert.ok(pickFerry?.act3Kind === 'depart', 'depart-ferry interactable once >=2 markers placed');
mysteries.interact(pickFerry);
assert.ok(firedDialogues.includes('act3-prefect-return'), 'prefect return subtitle triggered');
flushAllTimers();

assert.equal(act3.getState().stage, 'returning');
assert.equal(weatherId, 'mist', 'return trip switches weather to mist');
assert.equal(disembarkCount, 1, 'disembarks skiff smoothly at return midpoint');
assert.equal(gleam.getStats().suppressed, true, 'cave gleam suppressed during lost return');
assert.equal(act3.getState().caveSealed, true, 'cave mouth sealed');
assert.ok(preBlockers[0].hw > 3 && preBlockers[0].hd > 2, 'sealBlocker blocks cliff opening');
const fwdZ = -Math.cos(player.state.yaw);
assert.ok(fwdZ < -0.8, 'returned player faces upstream (-Z) toward sealed cliff');

// Phase 3.3: Search upstream to sealed cliff -> 'lost' -> 'epilogue'
player.state.x = cliff.slit.x;
player.state.z = cliff.slit.z + 18;
act3.update(1.5, 2.0, sky, player.state, camera);
assert.equal(act3.getState().stage, 'lost', 'reaching sealed cliff triggers lost state');
assert.ok(firedDialogues.includes('act3-lost-way'), '遂迷，不复得路 subtitle triggered');

act3.update(5.0, 7.0, sky, player.state, camera);
assert.equal(act3.getState().stage, 'epilogue', 'lost lingers into epilogue scroll');
assert.ok(firedDialogues.includes('act3-no-seeker'), '后遂无问津者 subtitle triggered');
assert.equal(curtain.isEpilogueOpen(), true);

// Test Linger option + Journal.onClear auto-reset
mockEl('epilogue-linger').dispatch('click');
assert.equal(act3.getState().stage, 'linger');
assert.equal(act3.getState().caveSealed, true);

journal.onClear();
assert.equal(clearedJournalCount, 1, 'wrapped journal.onClear preserves base clear behavior');
assert.equal(act3.getState().stage, 'idle');
assert.equal(weatherId, 'clear');
assert.equal(preBlockers[0].hw, 0, 'sealBlocker deactivated after reset');
assert.equal(gleam.getStats().suppressed, false, 'caveGleam restored after reset');

// Test advanceToStage -> epilogue -> Replay button
act3.advanceToStage('epilogue');
assert.equal(curtain.isEpilogueOpen(), true);
mockEl('epilogue-replay').dispatch('click');
assert.equal(act3.getState().stage, 'idle');
assert.equal(Math.round(player.state.z), world.player.spawn.z, 'replay respawns player at start');

// 3,600-frame update soak check
act3.advanceToStage('returning');
for (let f = 0; f < 3600; f++) {
  act3.update(1 / 60, f / 60, sky, player.state, camera);
}

act3.dispose();
act3.dispose();
gleam.dispose();
curtain.dispose();
console.log(JSON.stringify({ ok: true, meshes: meshCount, stageAfterSoak: act3.getState().stage }));
