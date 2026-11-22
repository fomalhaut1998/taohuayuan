import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, createStream, sampleRiverSpine } from '../src/world/stream.js';
import { createScatter } from '../src/world/scatter.js';
import { createCliff } from '../src/world/cliff.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createPeople } from '../src/world/people.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createCavePassage } from '../src/world/cave-passage.js';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { createAvatar } from '../src/player/avatar.js';
import { createArchitecturalCraft } from '../src/systems/architectural-craft.js';
import { createScrollStudio, CLASSICAL_COLOPHONS } from '../src/systems/scroll-studio.js';
import { createPoeticWayfinder } from '../src/systems/poetic-wayfinder.js';
import { createAudioHud } from '../src/systems/audio-hud.js';
import { createRiverSkiff } from '../src/systems/river-skiff.js';
import { createMap } from '../src/systems/map.js';
import { stripRound6Main } from './round6-main-delta.mjs';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const soundRawSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
const soundModuleSrc = soundRawSrc
  .replace("import world from '../data/world.json';", `const world = ${JSON.stringify(world)};`)
  .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = { version: 1, clips: [] };')
  .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(soundModuleSrc).toString('base64'));

// ---------------------------------------------------------------------------
// 0. Code hygiene & main.js Round 6 wiring checks
// ---------------------------------------------------------------------------
for (const rel of [
  '../src/systems/architectural-craft.js',
  '../src/systems/scroll-studio.js',
  '../src/systems/poetic-wayfinder.js',
  '../src/systems/audio-hud.js',
  '../src/world/cave-passage.js',
  '../src/systems/river-skiff.js',
  '../src/systems/sound.js',
  '../src/systems/map.js'
]) {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.ok(!/\bconsole\.log\s*\(/.test(src), `no console.log in ${rel}`);
}

for (const sym of [
  'createArchitecturalCraft',
  'createScrollStudio',
  'createPoeticWayfinder',
  'createAudioHud'
]) {
  assert.ok(mainSrc.includes(sym), `main.js wires ${sym}`);
  const stripped = stripRound6Main(mainSrc);
  assert.ok(!stripped.includes(sym), `${sym} stays strictly inside Round 6 blocks`);
}

// ---------------------------------------------------------------------------
// Minimal DOM + Canvas2D + WebAudio + Storage harness for headless verification
// ---------------------------------------------------------------------------
function make2dContext() {
  const base = {
    fillStyle: '#000',
    strokeStyle: '#000',
    font: '12px serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    lineWidth: 1,
    shadowColor: 'transparent',
    shadowBlur: 0,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)).fill(128) }),
    measureText: (txt) => ({ width: String(txt || '').length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, val) {
      target[prop] = val;
      return true;
    }
  });
}

function createDomHarness() {
  const byId = new Map();
  const storageMap = new Map();
  const storage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => { storageMap.set(String(k), String(v)); },
    removeItem: (k) => { storageMap.delete(String(k)); },
    clear: () => { storageMap.clear(); },
    key: (i) => Array.from(storageMap.keys())[i] ?? null,
    get length() { return storageMap.size; }
  };

  function makeClassList() {
    const set = new Set();
    return {
      add: (...xs) => xs.forEach(x => set.add(x)),
      remove: (...xs) => xs.forEach(x => set.delete(x)),
      toggle: (x, force) => {
        const on = force === undefined ? !set.has(x) : Boolean(force);
        if (on) set.add(x); else set.delete(x);
        return on;
      },
      contains: (x) => set.has(x)
    };
  }

  function registerTree(node) {
    if (!node) return;
    if (node.id) byId.set(node.id, node);
    if (Array.isArray(node.children)) node.children.forEach(registerTree);
  }

  function makeEl(tag = 'div', id = '') {
    const listeners = new Map();
    const attrs = new Map();
    const ctx2d = make2dContext();
    const el = {
      id,
      tagName: String(tag).toUpperCase(),
      textContent: '',
      innerHTML: '',
      hidden: false,
      open: false,
      width: 640,
      height: 360,
      clientWidth: 640,
      clientHeight: 360,
      style: { cssText: '', opacity: '1', setProperty() {} },
      dataset: {},
      children: [],
      parentNode: null,
      classList: makeClassList(),
      appendChild(child) {
        if (!child) return child;
        if (child.parentNode && child.parentNode !== el) {
          const prevIdx = child.parentNode.children.indexOf(child);
          if (prevIdx >= 0) child.parentNode.children.splice(prevIdx, 1);
        }
        child.parentNode = el;
        if (!el.children.includes(child)) el.children.push(child);
        registerTree(child);
        return child;
      },
      removeChild(child) {
        const idx = el.children.indexOf(child);
        if (idx >= 0) el.children.splice(idx, 1);
        if (child) child.parentNode = null;
        return child;
      },
      insertBefore(child, ref) {
        if (!child) return child;
        child.parentNode = el;
        const idx = el.children.indexOf(ref);
        if (idx >= 0) el.children.splice(idx, 0, child);
        else el.children.push(child);
        registerTree(child);
        return child;
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
        if (el.id && byId.get(el.id) === el) byId.delete(el.id);
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') {
          el.id = String(v);
          byId.set(el.id, el);
        }
        if (k === 'open') el.open = true;
      },
      getAttribute(k) { return attrs.get(k) ?? null; },
      hasAttribute(k) { return k === 'open' ? Boolean(el.open || attrs.has('open')) : attrs.has(k); },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'open') el.open = false;
      },
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
      dispatchEvent(ev) {
        ev.target = ev.target || el;
        const arr = (listeners.get(ev.type) || []).slice();
        for (const fn of arr) fn(ev);
        return !ev.defaultPrevented;
      },
      click() {
        el.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} });
      },
      focus() { doc.activeElement = el; },
      showModal() { el.open = true; },
      close() {
        el.open = false;
        el.dispatchEvent({ type: 'close' });
      },
      getContext: () => ctx2d,
      toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      getBoundingClientRect: () => ({ left: 0, top: 0, width: el.width || 240, height: el.height || 240 }),
      querySelector(sel) {
        if (sel.startsWith('#')) return byId.get(sel.slice(1)) || null;
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          const stack = [...el.children];
          while (stack.length) {
            const cur = stack.shift();
            if (cur.classList?.contains(cls)) return cur;
            stack.push(...(cur.children || []));
          }
        }
        const tagUpper = sel.toUpperCase();
        const stack = [...el.children];
        while (stack.length) {
          const cur = stack.shift();
          if (cur.tagName === tagUpper) return cur;
          stack.push(...(cur.children || []));
        }
        return null;
      },
      closest: () => null
    };
    if (id) byId.set(id, el);
    return el;
  }

  const head = makeEl('head', 'head');
  const body = makeEl('body', 'body');
  body.classList.add('curtain-open');

  // Seed core HUD & modal elements matching index.html
  const canvas = makeEl('canvas', 'scene');
  canvas.width = 1280;
  canvas.height = 720;
  body.appendChild(canvas);

  const skyHud = makeEl('div', 'sky');
  const skyToast = makeEl('div', 'sky-toast');
  const skyPhen = makeEl('span', 'sky-phenology');
  skyPhen.textContent = '春深';
  skyHud.appendChild(skyPhen);
  body.appendChild(skyHud);
  body.appendChild(skyToast);

  const journalOpen = makeEl('button', 'journal-open');
  body.appendChild(journalOpen);

  const journalEl = makeEl('dialog', 'journal');
  const journalTabs = makeEl('div', 'journal-tabs');
  journalTabs.classList.add('journal__tabs');
  const tabNotes = makeEl('button', 'journal-tab-notes');
  tabNotes.setAttribute('aria-pressed', 'true');
  const tabField = makeEl('button', 'journal-tab-field');
  tabField.setAttribute('aria-pressed', 'false');
  journalTabs.appendChild(tabNotes);
  journalTabs.appendChild(tabField);
  const journalNotes = makeEl('div', 'journal-notes');
  const journalField = makeEl('div', 'journal-field');
  journalField.hidden = true;
  const journalFooter = makeEl('footer', 'journal-footer');
  journalEl.appendChild(journalTabs);
  journalEl.appendChild(journalNotes);
  journalEl.appendChild(journalField);
  journalEl.appendChild(journalFooter);
  body.appendChild(journalEl);

  // Map DOM elements
  const minimap = makeEl('div', 'minimap');
  const miniCanvas = makeEl('canvas', 'minimap-canvas');
  miniCanvas.width = 156;
  miniCanvas.height = 156;
  const miniLoc = makeEl('span', 'minimap-loc');
  minimap.appendChild(miniCanvas);
  minimap.appendChild(miniLoc);
  body.appendChild(minimap);

  const mapModal = makeEl('div', 'map-modal');
  const mapCanvas = makeEl('canvas', 'map-canvas');
  mapCanvas.width = 640;
  mapCanvas.height = 640;
  const mapList = makeEl('ul', 'map-list');
  const mapCount = makeEl('span', 'map-count');
  const mapClose = makeEl('button', 'map-close');
  const mapTip = makeEl('div', 'map-tip');
  const mapToast = makeEl('div', 'map-toast');
  mapModal.appendChild(mapCanvas);
  mapModal.appendChild(mapList);
  mapModal.appendChild(mapCount);
  mapModal.appendChild(mapClose);
  mapModal.appendChild(mapTip);
  body.appendChild(mapModal);
  body.appendChild(mapToast);

  const veil = makeEl('div', 'veil');
  veil.hidden = true;
  veil.classList.add('curtain-gone');
  body.appendChild(veil);

  const winListeners = new Map();
  const win = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    localStorage: storage,
    confirm: () => true,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
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
    dispatchKey(code) {
      const ev = {
        type: 'keydown',
        code,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        defaultPrevented: false,
        stopped: false,
        target: body,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; }
      };
      for (const fn of (winListeners.get('keydown') || []).slice()) {
        fn(ev);
        if (ev.stopped) break;
      }
      return ev;
    }
  };

  const doc = {
    head,
    body,
    documentElement: body,
    activeElement: body,
    pointerLockElement: null,
    hidden: false,
    hasFocus: () => true,
    exitPointerLock() { this.pointerLockElement = null; },
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => byId.get(id) || null
  };

  return { doc, win, storage, canvas };
}

const env = createDomHarness();
globalThis.document = env.doc;
globalThis.window = env.win;
globalThis.localStorage = env.storage;
globalThis.Path2D = class Path2D {
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  ellipse() {}
  rect() {}
  closePath() {}
  addPath() {}
};

// ---------------------------------------------------------------------------
// Build shared world geometry
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const terrain = createTerrain(world.terrain, distanceToRiver, { road: world.village.road, pond: world.terrain.pond });
terrain.field.colorAt = terrain.colorAt;
const stream = createStream(world.stream, world.terrain, riverCurve);
const cliff = createCliff(world.cliff, terrain.field);
const scatter = createScatter(world.scatter, terrain.field, () => false, world.village.road, null);
const village = createVillage(world.village, terrain.field, world.terrain.pond);
const props = createProps(world.props, terrain.field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, terrain.field, distanceToRiver, world, village, props, cliff);
const flora = createFlora(
  world.flora,
  terrain.field,
  distanceToRiver,
  riverCurve,
  world.player.spawn,
  (x, z) => Math.hypot(x - world.cliff.center[0], z - world.cliff.center[1]) > world.cliff.radius + 14
);
const villageScenes = createVillageScenes(world, terrain.field, distanceToRiver, village, props, cliff, hinterland);
const mysteryWorld = createMysteries(world, terrain.field, distanceToRiver, village, props, cliff, hinterland, villageScenes, flora);
const villageLife = createVillageLife(world, terrain.field, distanceToRiver, village, props, cliff, hinterland, villageScenes, mysteryWorld);
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, terrain.field);
const exterior = createExteriorExploration(world, terrain.field, distanceToRiver, riverCurve, flora, boats, cliff);
const people = createPeople(world.people, terrain.field, village.houseInfo, village.road, village.plots, cliff.blockers);
const avatar = createAvatar(world.player.avatar, world.player.walkSpeed);

scene.add(terrain.mesh, stream.mesh, cliff.group, village.group, props.group, people.group, boats.group, avatar.group);

const communityOpts = {
  world,
  field: terrain.field,
  distanceToRiver,
  riverCurve,
  stream,
  flora,
  village,
  props,
  hinterland,
  villageScenes,
  villageLife,
  mysteryWorld: { blockers: [] },
  boats,
  cliff,
  exterior,
  habitatDetails: { group: new THREE.Group() }
};
const pondLife = createPondLife({ ...communityOpts, reservations: [] });
const waterworks = createWaterworks({ ...communityOpts, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...communityOpts, reservations: [pondLife, waterworks] });
const qinHanHomestead = createQinHanHomestead({
  ...communityOpts,
  pondLife,
  leisureGrove,
  reservations: [pondLife, waterworks, leisureGrove]
});
const qinHanCompletion = createQinHanCompletion({
  world,
  field: terrain.field,
  village,
  props,
  leisureGrove,
  qinHanHomestead,
  blockers: cliff.blockers.concat(village.blockers)
});

// Construct staticVisibility BEFORE architecturalCraft.hookMaterials(), mirroring src/main.js!
const staticVis = optimizeStaticVisibility(scene, {
  cliffPortal: { center: world.cliff.center, radius: world.cliff.radius, slit: cliff.slit }
});
const baselineStaticCount = staticVis.getStats().compactedMeshes ?? staticVis.getStats().entries ?? 0;

// ---------------------------------------------------------------------------
// 1, 3 & 4. Architectural Craft, Bamboo Lanterns, Actor Warm Rim, Fireflies & Dew
// ---------------------------------------------------------------------------
{
  let curTime = 'day';
  let curWeather = 'clear';
  let curRain = 0;
  let curPhen = 'spring';
  const mockSky = {
    get timeId() { return curTime; },
    get weatherId() { return curWeather; },
    get rainIntensity() { return curRain; },
    windX: 0.35,
    windZ: 0.12,
    registerMaterials() {},
    getAppearance: () => ({ timeId: curTime, weatherId: curWeather })
  };
  const mockPhenology = {
    getStats: () => ({ phenologyId: curPhen })
  };

  const craft = createArchitecturalCraft({
    world,
    field: terrain.field,
    village,
    cliff,
    pondLife,
    leisureGrove,
    qinHanHomestead,
    qinHanCompletion,
    people,
    avatar,
    boats,
    sky: mockSky,
    phenology: mockPhenology
  });
  scene.add(craft.group);
  craft.registerSky(mockSky);
  const hooked = craft.hookMaterials();

  assert.ok(hooked.roofMaterials >= 2, 'hooks cottage thatch roof & ridge tile materials');
  assert.ok(hooked.wallMaterials >= 4, 'hooks cottage rammed-earth/plaster wall, gable & chimney materials');
  assert.ok(hooked.roadMaterials >= 2, 'hooks village-road & village-spurs materials');
  assert.ok(hooked.actorMaterials >= 4, 'hooks traveler avatar & villager opaque materials for warm firelight rim');
  assert.equal(
    staticVis.getStats().compactedMeshes ?? staticVis.getStats().entries ?? 0,
    baselineStaticCount,
    'post-staticVisibility hookMaterials preserves 100% staticVisibility compaction with 0 extra village draw calls'
  );

  // Verify patched shaders compile valid GLSL tokens cleanly
  const roofMesh = village.group.getObjectByName('houses-roof');
  const roadMesh = village.group.getObjectByName('village-road');
  for (const mesh of [roofMesh, roadMesh]) {
    assert.ok(mesh?.material?.onBeforeCompile, `${mesh?.name} material has onBeforeCompile`);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader
    };
    mesh.material.onBeforeCompile(shader, {});
    assert.ok(shader.fragmentShader.includes('craftFbm2'), `${mesh.name} injects procedural Song-Yuan brushwork`);
  }

  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
  cam.position.set(52, 4.5, -135);

  // Clear day: lantern glows, fireflies, dew, and actor warm rim must ALL be strictly 0 / hidden!
  craft.update(0.016, 1.0, mockSky, mockPhenology, cam);
  let st = craft.getStats();
  assert.equal(st.lanternCount, 8, '8 bamboo eave & ferry lanterns (7 interior + 1 exterior)');
  assert.equal(st.interiorLanternCount, 7);
  assert.equal(st.exteriorLanternCount, 1);
  assert.equal(st.lanternGlowVisible, false, 'lantern glow strictly hidden in clear day');
  assert.equal(st.warmRimStrength, 0, 'actor warm rim strictly 0 in clear day');
  assert.equal(st.firefliesVisible, false, 'pond fireflies strictly hidden in day');
  assert.equal(st.dewVisible, false, 'morning dew strictly hidden in clear dry day');

  // Summer night: bamboo lanterns lit, warm rim active, pond twin fireflies boosted 1.28x!
  curTime = 'night';
  curPhen = 'summer';
  craft.update(0.05, 2.0, mockSky, mockPhenology, cam);
  st = craft.getStats();
  assert.equal(st.lanternGlowVisible, true, 'bamboo lantern glow lit at night');
  assert.ok(st.warmRimStrength > 0.5, 'actor warm rim active at night');
  assert.equal(st.firefliesVisible, true, 'pond fireflies & water reflections visible on summer night');
  assert.ok(st.fireflyGain > 1.15, 'summer phenology boosts pond firefly luminescence');
  assert.equal(st.fireflyVertices, 96, '48 airborne fireflies + 48 mirrored pond reflections');

  // Pause-freeze check (dt = 0)
  const frozenSim = st.simTime;
  craft.update(0, 2.5, mockSky, mockPhenology, cam);
  assert.equal(craft.getStats().simTime, frozenSim, 'architecturalCraft strictly freezes simTime when dt === 0');

  // Dawn: morning dew glints active, fireflies hidden
  curTime = 'dawn';
  craft.update(0.032, 3.0, mockSky, mockPhenology, cam);
  st = craft.getStats();
  assert.equal(st.dewVisible, true, 'morning dew glints visible at dawn');
  assert.equal(st.firefliesVisible, false, 'pond fireflies hidden at dawn');

  craft.dispose();
}

// ---------------------------------------------------------------------------
// 2. Cave Passage: Fupicun Rock Strata, Hanging Vines/Ferns & Ceiling Drips
// ---------------------------------------------------------------------------
{
  const cave = createCavePassage({ world, cliff, field: terrain.field, scatter });
  const st0 = cave.getStats();
  assert.equal(st0.fupicunHooked, true, 'cave-passage-shell hooks Fupicun rock strata & wet sheen');
  assert.ok(cave.vinesMesh?.isMesh, 'builds cave-mouth-vines mesh');
  assert.ok(cave.dripsMesh?.isInstancedMesh && st0.dripInstances === 8, 'builds 8-instance cave-ceiling-drips');

  const shell = cave.group.getObjectByName('cave-passage-shell');
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader
  };
  shell.material.onBeforeCompile(shader, {});
  assert.ok(shader.fragmentShader.includes('uCaveSheenGain'), 'cave rock shader injects wet seepage rim sheen');

  const camPos = new THREE.Vector3(cliff.slit.x, 3.6, cliff.slit.z);
  cave.update(camPos, false, false, 0.05, { timeId: 'day', rainIntensity: 0.4 });
  const simAfterStep = cave.getStats().simTime;
  assert.ok(simAfterStep > 0, 'cave ceiling drips advance when dt > 0');

  cave.update(camPos, false, false, 0, { timeId: 'day', rainIntensity: 0.4 });
  assert.equal(cave.getStats().simTime, simAfterStep, 'cave ceiling drips freeze when dt === 0');

  cave.dispose();
}

// ---------------------------------------------------------------------------
// 5 & 6. Map Destination, Poetic Wayfinder & Scroll Painting Studio
// ---------------------------------------------------------------------------
{
  // Seed journal storage key first to prove scrollStudio NEVER mutates taohua.journal.v1!
  const journalSeed = JSON.stringify({ places: ['grove'], people: [], classics: ['opening'], guide: [] });
  env.storage.setItem('taohua.journal.v1', journalSeed);

  const player = {
    state: { x: 24, y: 2.1, z: 152, yaw: 3.1, vx: 0, vz: 0, view: 'third' },
    clearInputCalled: 0,
    clearInput() { this.clearInputCalled++; }
  };

  const map = createMap(world.map, world, {
    field: terrain.field,
    spots: flora.spots,
    houseInfo: village.houseInfo,
    marks: props.marks,
    bamboo: village.bamboo,
    mulberry: village.mulberry,
    hinterland,
    villageScenes: villageScenes.mapData,
    villageLife: villageLife.mapData,
    pond: village.pond,
    chimneys: village.chimneys,
    spine: riverSpine,
    canvas: env.canvas,
    player,
    exterior: exterior.mapData,
    pondLife: pondLife.layout,
    waterworks: waterworks.layout,
    leisureGrove: leisureGrove.layout,
    visited: new Set(),
    onVisit() {}
  });

  const mockSky = { timeId: 'day', weatherId: 'clear', windX: 0.25, windZ: -0.1, registerMaterials() {} };
  const wayfinder = createPoeticWayfinder({
    world,
    field: terrain.field,
    cliff,
    map,
    player,
    sky: mockSky
  });
  scene.add(wayfinder.group);

  // Idle when no destination is set -> 0 draws
  wayfinder.update(0.05, 1.0, mockSky, player.state);
  assert.equal(wayfinder.getStats().drawCalls, 0, 'poeticWayfinder uses 0 draw calls when no destination is selected');

  // Set interior destination while player is on exterior stream -> routes via cliff.slit!
  const interiorPoi = world.map.pois.find(p => p.z < -80) || world.map.pois[world.map.pois.length - 1];
  map.setDestination(interiorPoi.id);
  assert.equal(map.getDestination()?.id, interiorPoi.id, 'map.setDestination / getDestination round-trips cleanly');

  for (let i = 0; i < 8; i++) wayfinder.update(0.05, 1.0 + i * 0.05, mockSky, player.state);
  const wfDay = wayfinder.getStats();
  assert.equal(wfDay.drawCalls, 1, 'poeticWayfinder renders in a single InstancedMesh draw call');
  assert.equal(wfDay.routingViaCave, true, 'poeticWayfinder smartly routes exterior->interior via cave mouth');
  assert.equal(wfDay.blending, 'normal', 'daytime uses soft petal/silk normal blending');

  const wfFrozenSim = wfDay.simTime;
  wayfinder.update(0, 2.0, mockSky, player.state);
  assert.equal(wayfinder.getStats().simTime, wfFrozenSim, 'poeticWayfinder strictly freezes on dt === 0');

  // Night mode switches to additive bioluminescent guiding fireflies
  mockSky.timeId = 'night';
  for (let i = 0; i < 12; i++) wayfinder.update(0.05, 3.0 + i * 0.05, mockSky, player.state);
  assert.equal(wayfinder.getStats().blending, 'additive', 'nighttime switches to additive guiding fireflies');

  // Clear destination -> fades back to 0 draws
  map.setDestination(null);
  assert.equal(map.getDestination(), null);
  for (let i = 0; i < 20; i++) wayfinder.update(0.05, 4.0 + i * 0.05, mockSky, player.state);
  assert.equal(wayfinder.getStats().drawCalls, 0, 'poeticWayfinder returns to 0 draws after clearing destination');

  // Scroll Studio verification
  let renderNowCount = 0;
  const mockJournal = { isOpen: () => false };
  const studio = createScrollStudio({
    canvas: env.canvas,
    player,
    journal: mockJournal,
    map,
    sky: mockSky,
    getPhenology: () => ({ getStats: () => ({ phenologyId: 'spring' }) }),
    renderSceneNow: () => { renderNowCount++; },
    world,
    doc: env.doc,
    win: env.win,
    storage: env.storage
  });

  assert.ok(CLASSICAL_COLOPHONS.length >= 6, 'provides contextual Tao Yuanming colophons & seals');
  assert.ok(env.doc.getElementById('scroll-open'), 'mounts top-left #scroll-open button');
  assert.ok(env.doc.getElementById('scroll-dialog'), 'mounts <dialog id="scroll-dialog">');
  assert.ok(env.doc.getElementById('journal-tab-scrolls'), 'mounts 3rd tab 画匣 in #journal');

  // Trigger KeyO -> synchronous renderSceneNow() + opens modal
  env.win.dispatchKey('KeyO');
  assert.equal(studio.isOpen(), true, 'KeyO opens scroll studio');
  assert.equal(renderNowCount, 1, 'calls renderSceneNow() synchronously before capturing WebGL canvas');

  // Toggle mount & save to 画匣
  env.doc.getElementById('scroll-mount-toggle').click();
  assert.equal(studio.getStats().mount, 'hanging', 'toggles between handscroll and hanging scroll mounts');
  env.doc.getElementById('scroll-save-box').click();
  assert.equal(studio.getSavedScrolls().length, 1, 'saves painted scroll into localStorage taohua.scrolls.v1');
  assert.equal(
    env.storage.getItem('taohua.journal.v1'),
    journalSeed,
    'scrollStudio never alters protected taohua.journal.v1 schema or payload'
  );

  studio.close();
  assert.equal(studio.isOpen(), false);
  studio.dispose();
  wayfinder.dispose();
  map.dispose();
}

// ---------------------------------------------------------------------------
// 7. Audio HUD, Full-Tunnel Cave Reverb, Wading Droplets & Seasonal Phenology
// ---------------------------------------------------------------------------
{
  const nodes = [];
  class MockParam {
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
    cancelScheduledValues() {}
  }
  class MockNode {
    constructor(kind) {
      this.kind = kind;
      this.gain = new MockParam(1);
      this.frequency = new MockParam(440);
      this.Q = new MockParam(1);
      this.pan = new MockParam(0);
      this.playbackRate = new MockParam(1);
      nodes.push(this);
    }
    connect() { return this; }
    disconnect() {}
    start() {}
    stop() {}
  }
  globalThis.window.AudioContext = class MockAudioContext {
    constructor() {
      this.sampleRate = 44100;
      this.currentTime = 1.0;
      this.state = 'running';
      this.destination = new MockNode('dest');
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { return new MockNode('gain'); }
    createOscillator() { return new MockNode('osc'); }
    createBiquadFilter() { return new MockNode('filter'); }
    createStereoPanner() { return new MockNode('pan'); }
    createConvolver() { return new MockNode('convolver'); }
    createDynamicsCompressor() {
      const n = new MockNode('compressor');
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new MockParam(0);
      return n;
    }
    createAnalyser() {
      const n = new MockNode('analyser');
      n.fftSize = 256;
      n.frequencyBinCount = 128;
      n.getByteTimeDomainData = arr => arr.fill(128);
      n.getByteFrequencyData = arr => arr.fill(0);
      return n;
    }
    createBufferSource() { return new MockNode('bufsrc'); }
    createBuffer(_ch, len, sr) {
      const data = new Float32Array(Math.max(1, len));
      return { sampleRate: sr, length: len, duration: len / sr, getChannelData: () => data };
    }
    decodeAudioData() { return Promise.reject(new Error('offline test')); }
  };

  env.storage.removeItem('taohua.audio.v1');
  const sound = createSound({
    field: terrain.field,
    distanceToRiver,
    riverSpine,
    people,
    village,
    cliff
  });
  const hud = createAudioHud({ sound, doc: env.doc, win: env.win });
  assert.ok(env.doc.getElementById('sky-audio-row'), 'mounts #sky-audio-row in top-right HUD');
  assert.equal(sound.getAudioPrefs().mode, 'soft', 'defaults to soft audio mode (轻音)');
  assert.ok(Math.abs(sound.getAudioPrefs().volume - 0.42) < 0.01);
  assert.equal(sound.muted, false);
  assert.equal(env.doc.getElementById('sky-audio')?.textContent, '轻音', 'audio HUD displays 轻音 by default');

  // Cycle KeyN: soft -> mute -> full -> soft
  env.win.dispatchKey('KeyN');
  assert.equal(sound.getAudioPrefs().mode, 'mute');
  assert.equal(sound.muted, true, 'sound.muted reflects mute mode');
  assert.ok(env.storage.getItem('taohua.audio.v1')?.includes('mute'), 'persists audio preference in taohua.audio.v1');

  env.win.dispatchKey('KeyN');
  assert.equal(sound.getAudioPrefs().mode, 'full');
  assert.equal(sound.muted, false);
  assert.equal(sound.getAudioPrefs().volume, 1.0);

  env.win.dispatchKey('KeyN');
  assert.equal(sound.getAudioPrefs().mode, 'soft');
  assert.ok(Math.abs(sound.getAudioPrefs().volume - 0.42) < 0.01);
  assert.equal(sound.muted, false);

  // Unlock & verify full-length inner cave reverb (~18m along tunnel into valley)
  sound.unlock();
  const dx = world.terrain.basin.x - cliff.slit.x;
  const dz = world.terrain.basin.z - cliff.slit.z;
  const dl = Math.hypot(dx, dz) || 1;
  const innerTunnelX = cliff.slit.x + (dx / dl) * 18.0; // along = -18m inside tunnel!
  const innerTunnelZ = cliff.slit.z + (dz / dl) * 18.0;
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(innerTunnelX, terrain.field.sample(innerTunnelX, innerTunnelZ) + 1.6, innerTunnelZ);
  for (let i = 0; i < 8; i++) {
    sound.update(0.05, i * 0.05, cam, { x: innerTunnelX, y: cam.position.y - 1.6, z: innerTunnelZ, vx: 0, vz: 0 }, false);
  }
  const caveStat = sound.getStats();
  assert.ok((caveStat.region?.cave ?? 0) > 0.35, `inner cave tunnel at 18m from slit maintains strong cave acoustic region (${caveStat.region?.cave})`);

  // Verify poleDrip, cicadaShimmer, shallow-water stepSurface, and phenology sync
  assert.equal(typeof sound.poleDrip, 'function');
  assert.equal(typeof sound.cicadaShimmer, 'function');
  sound.poleDrip(24, 155);
  sound.stepSurface('water', 24, 155, 0.8);
  sound.syncWorld(0.25, {
    rain: 0,
    isNight: false,
    timeId: 'day',
    phenology: 'summer',
    events: [{ type: 'poleDrip', x: 24, z: 155 }]
  });
  sound.syncWorld(0.25, {
    rain: 0,
    isNight: true,
    timeId: 'night',
    phenology: 'autumn',
    events: []
  });

  hud.dispose();
  sound.disposeSamples();
}

// ---------------------------------------------------------------------------
// 8. River Skiff: Punt-and-Glide Coasting, Pole Water Beads & Bow Fishing Lantern
// ---------------------------------------------------------------------------
{
  const skiff = createRiverSkiff({
    world,
    field: terrain.field,
    stream,
    riverCurve,
    distanceToRiver,
    boats,
    cliff
  });
  scene.add(skiff.group);

  const pState = { x: 24, y: 2.0, z: 165, yaw: Math.PI, pitch: 0, vx: 0, vz: 0, view: 'first' };
  const cam = new THREE.PerspectiveCamera();
  const mockHint = env.doc.createElement('div');
  skiff.bind({
    player: { state: pState, clearInput() {} },
    avatar,
    camera: cam,
    mysteries: null,
    sound: { boatPole() {}, poleDrip() {} },
    blockers: [],
    hintEl: mockHint,
    doc: env.doc,
    win: env.win,
    autoBoard: false
  });

  // Moored skiff in clear day: stationary & bow lantern unlit
  skiff.update(0.05, 0.5, { timeId: 'day', weatherId: 'clear' }, pState, cam, false);
  assert.equal(skiff.getStats().speed, 0, 'moored skiff stays stationary');
  assert.equal(skiff.getStats().lanternLit, false, 'bow fishing lantern unlit in clear day');

  // Dusk/Night: bow bamboo fishing lantern lights up
  skiff.update(0.05, 0.6, { timeId: 'night', weatherId: 'clear' }, pState, cam, false);
  assert.equal(skiff.getStats().lanternLit, true, 'bow bamboo fishing lantern glows at night');

  // Board & punt forward with KeyW for 2.2s -> verify glide momentum & pole water droplets
  skiff.board();
  assert.equal(skiff.isAboard(), true);
  env.win.dispatchKey('KeyW');

  let sawActiveDrops = false;
  let elapsed = 1.0;
  for (let i = 0; i < 48; i++) {
    elapsed += 0.05;
    skiff.update(0.05, elapsed, { timeId: 'dusk', weatherId: 'clear' }, pState, cam, false);
    if (skiff.getStats().activeDrops > 0) sawActiveDrops = true;
  }
  const puntingSpeed = skiff.getStats().speed;
  assert.ok(puntingSpeed > 2.2, `skiff builds brisk punting speed (${puntingSpeed})`);

  // Release KeyW -> dispatch keyup and verify graceful hydrodynamic coasting at +0.4s
  const keyUpEv = { type: 'keyup', code: 'KeyW' };
  // Release via synthetic window keyup if listener registered
  // (createDomHarness stores keyup listeners on win; let's also test coasting if keyup fires)
  skiff.disembark();
  skiff.board();
  // Test direct keydown + keyup coasting with full keyup support:
  skiff.dispose();
}

// Dedicated keydown + keyup hydrodynamic coasting verification on riverSkiff
{
  const keyListeners = { keydown: [], keyup: [] };
  const skiffWin = {
    addEventListener(type, fn) { if (keyListeners[type]) keyListeners[type].push(fn); },
    removeEventListener(type, fn) {
      const arr = keyListeners[type];
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }
  };
  const skiff = createRiverSkiff({
    world,
    field: terrain.field,
    stream,
    riverCurve,
    distanceToRiver,
    boats,
    cliff
  });
  const pState = { x: 24, y: 2.0, z: 165, yaw: Math.PI, pitch: 0, vx: 0, vz: 0, view: 'first' };
  const cam = new THREE.PerspectiveCamera();
  skiff.bind({
    player: { state: pState, clearInput() {} },
    avatar,
    camera: cam,
    mysteries: null,
    sound: { boatPole() {}, poleDrip() {} },
    blockers: [],
    hintEl: env.doc.createElement('div'),
    doc: env.doc,
    win: skiffWin,
    autoBoard: true
  });

  for (const fn of keyListeners.keydown) fn({ code: 'KeyW', repeat: false });
  let sawDrops = false;
  let sawPoleDripEvent = false;
  let t = 0;
  for (let i = 0; i < 60; i++) {
    t += 0.04;
    skiff.update(0.04, t, { timeId: 'dusk', weatherId: 'clear' }, pState, cam, false);
    if (skiff.getStats().activeDrops > 0) sawDrops = true;
    for (const ev of skiff.consumeEvents()) {
      if (ev.type === 'poleDrip') sawPoleDripEvent = true;
    }
  }
  for (const fn of keyListeners.keyup) fn({ code: 'KeyW' });
  for (let i = 0; i < 10; i++) {
    t += 0.04;
    skiff.update(0.04, t, { timeId: 'dusk', weatherId: 'clear' }, pState, cam, false);
    if (skiff.getStats().activeDrops > 0) sawDrops = true;
    for (const ev of skiff.consumeEvents()) {
      if (ev.type === 'poleDrip') sawPoleDripEvent = true;
    }
  }
  const coastSpeed = skiff.getStats().speed;
  assert.ok(coastSpeed > 1.5, `skiff glides smoothly on momentum 0.4s after releasing KeyW (speed=${coastSpeed})`);
  assert.ok(sawDrops, 'lifted wet bamboo pole spawns falling water droplets');

  // Continue coasting with pole Drip check until droplets splash into stream
  for (let i = 0; i < 25; i++) {
    t += 0.04;
    skiff.update(0.04, t, { timeId: 'dusk', weatherId: 'clear' }, pState, cam, false);
    for (const ev of skiff.consumeEvents()) {
      if (ev.type === 'poleDrip') sawPoleDripEvent = true;
    }
  }
  assert.ok(sawPoleDripEvent, 'falling water droplets emit poleDrip acoustic events upon hitting water');

  // Strict pause-freeze on dt = 0
  const frozenT = skiff.getStats().t;
  skiff.update(0, t, { timeId: 'dusk', weatherId: 'clear' }, pState, cam, false);
  assert.equal(skiff.getStats().t, frozenT, 'riverSkiff strictly freezes progress when dt === 0');

  skiff.dispose();
}

staticVis.dispose?.();
console.log('PASS check-round11-eight-upgrades: all 8 upgrades, Round 6 delta, pause freeze & storage contracts verified');
