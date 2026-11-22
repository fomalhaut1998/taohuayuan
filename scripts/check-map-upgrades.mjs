import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createMap } from '../src/systems/map.js';
import { projectionFor, paintBase, rgba } from '../src/systems/mapdraw.js';
import { createJournal } from '../src/systems/journal.js';
import { createPoeticWayfinder } from '../src/systems/poetic-wayfinder.js';
import { createBarrier } from '../src/systems/barrier.js';
import { sightClear } from '../src/systems/living-behavior.js';
import { createMapTimeTheme, mixMapColor, applyPhenologyPalette } from '../src/systems/map-time-theme.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const mapExpansion = JSON.parse(readFileSync(new URL('../src/data/map-expansion.json', import.meta.url), 'utf8'));
const baselineWorldRaw = readFileSync(new URL('../.visual-round6-baseline/src/data/world.json', import.meta.url), 'utf8');
const currentWorldRaw = readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8');
assert.equal(currentWorldRaw, baselineWorldRaw, 'src/data/world.json must remain byte-exact to baseline');

function channels(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(hex) {
  return channels(hex)
    .map(v => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// 1. Minimal recording DOM & Canvas2D harness
class RecCtx {
  constructor(canvas) {
    this.canvas = canvas;
    this.globalAlpha = 1;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.font = '';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.stack = [];
    this.fills = [];
    this.text = [];
  }
  save() { this.stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle }); }
  restore() { Object.assign(this, this.stack.pop()); }
  clearRect() { this.text = []; this.fills = []; }
  fillRect() { this.fills.push(this.fillStyle); }
  strokeRect() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  ellipse() {}
  rect() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  fill() { this.fills.push(this.fillStyle); }
  stroke() {}
  clip() {}
  setTransform() {}
  translate() {}
  rotate() {}
  scale() {}
  setLineDash() {}
  drawImage() {}
  putImageData() {}
  strokeText() {}
  fillText(value, x, y) { this.text.push({ value, x, y, color: this.fillStyle, alpha: this.globalAlpha }); }
  createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createLinearGradient() { return { addColorStop() {} }; }
}

class MockEl {
  constructor(id = '', tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.variables = new Map();
    this.style = { setProperty: (k, v) => this.variables.set(k, v) };
    this.clientWidth = id === 'map-sheet' ? 1200 : 150;
    this.clientHeight = id === 'map-sheet' ? 500 : 150;
    this.width = 300;
    this.height = 150;
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    const cls = new Set();
    this._cls = cls;
    this.classList = {
      add: k => cls.add(k),
      remove: k => cls.delete(k),
      contains: k => cls.has(k),
      toggle: (k, f) => (f === undefined ? (cls.has(k) ? (cls.delete(k), false) : (cls.add(k), true)) : (f ? (cls.add(k), true) : (cls.delete(k), false))),
    };
    if (this.tagName === 'CANVAS') this.ctx = new RecCtx(this);
  }
  get className() { return Array.from(this._cls).join(' '); }
  set className(v) {
    this._cls.clear();
    for (const part of String(v || '').trim().split(/\s+/)) if (part) this._cls.add(part);
  }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...nodes) { this.children = nodes; }
  remove() {}
  setAttribute(k, v) { this.attributes.set(k, v); }
  addEventListener(t, cb) { this.listeners.set(t, cb); }
  removeEventListener(t) { this.listeners.delete(t); }
  dispatch(t, ev = {}) { return this.listeners.get(t)?.({ target: this, preventDefault() {}, stopPropagation() {}, ...ev }); }
  getContext() { return this.ctx; }
  querySelector() { return null; }
  getBoundingClientRect() {
    if (this.id === 'minimap') return { left: 0, top: 0, width: 150, height: 150 };
    return { left: 0, top: 0, width: 1200, height: 500 };
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
}

const storageMap = new Map();
globalThis.localStorage = {
  getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
  setItem: (k, v) => { storageMap.set(k, String(v)); },
  removeItem: k => { storageMap.delete(k); },
};

const ids = new Map([
  'map', 'map-sheet', 'map-canvas', 'map-close', 'map-list', 'map-region', 'map-dest', 'map-count',
  'map-note-name', 'map-note-poem', 'map-dist', 'minimap', 'minimap-canvas', 'minimap-region',
  'toast', 'toast-k', 'toast-name', 'journal', 'journal-open', 'journal-close', 'journal-clear',
  'journal-status', 'journal-places', 'journal-people', 'journal-classics', 'journal-field',
  'journal-notes', 'journal-tab-notes', 'journal-tab-field', 'journal-plants', 'journal-animals',
  'journal-landforms'
].map(id => [id, new MockEl(id, id.includes('canvas') ? 'canvas' : id === 'journal' ? 'dialog' : 'div')]));

const winListeners = new Map();
const rafQueue = new Map();
let rafSeq = 0;
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  confirm: () => true,
  addEventListener: (t, cb) => winListeners.set(t, cb),
  removeEventListener: t => winListeners.delete(t),
};
globalThis.document = {
  getElementById: id => ids.get(id) || null,
  createElement: tag => new MockEl('', tag),
  body: new MockEl('body'),
  pointerLockElement: null,
};
globalThis.requestAnimationFrame = cb => { rafQueue.set(++rafSeq, cb); return rafSeq; };
globalThis.cancelAnimationFrame = id => rafQueue.delete(id);
globalThis.Path2D = class { moveTo() {} lineTo() {} };

function stepModalRaf() {
  const first = rafQueue.entries().next().value;
  if (!first) return;
  rafQueue.delete(first[0]);
  first[1](performance.now() + 1000);
}

// Build real world geometry / terrain / colliders
const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const terrain = createTerrain(world.terrain, distanceToRiver, world.stream);
const field = terrain.field;

// 2. Verify Heightfield.sampleMesh matches exact diagonal triangle split
{
  const s = field.segments + 1;
  const x = 14.35;
  const z = -98.72;
  const fx = (x + field.half) / field.step;
  const fz = (z + field.half) / field.step;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const u = fx - x0, v = fz - z0;
  const a = field.heights[z0 * s + x0];
  const b = field.heights[z0 * s + x0 + 1];
  const c = field.heights[(z0 + 1) * s + x0];
  const d = field.heights[(z0 + 1) * s + x0 + 1];
  const expectedTri = u + v <= 1
    ? a * (1 - u - v) + b * u + c * v
    : d * (u + v - 1) + b * (1 - v) + c * (1 - u);
  assert.ok(Math.abs(field.sampleMesh(x, z) - expectedTri) < 1e-12, 'sampleMesh matches exact triangle interpolation');
}

const cliff = createCliff(world.cliff, field);
const village = createVillage(world.village, field, world.terrain);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const basin = world.terrain.basin;
const floraField = {
  half: field.half,
  sample: (x, z) => field.sample(x, z),
  slope: (x, z) => Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z),
};
const flora = createFlora(world.flora, floraField, distanceToRiver, riverCurve, world.player.spawn, () => false);
const boats = createBoats(world.boats, { surfaceY: () => world.terrain.waterLevel }, world.terrain, riverCurve, field);
const hinterland = createHinterland(world.hinterland, field, distanceToRiver, world, village, props, cliff);
const villageScenes = createVillageScenes(world, field, distanceToRiver, village, props, cliff, hinterland);
const mysteryWorld = createMysteries(world, field, distanceToRiver, village, props, cliff, hinterland, villageScenes, flora);
const villageLife = createVillageLife(world, field, distanceToRiver, village, props, cliff, hinterland, villageScenes, flora);
const exterior = createExteriorExploration(world, field, distanceToRiver, riverCurve, flora, boats, cliff);

// 3. Verify mapdraw.js river fill bug fix & oxPlowing/qinHanCompletion draw
{
  const recCanvas = new MockEl('base-test', 'canvas');
  const recCtx = recCanvas.getContext('2d');
  const proj = projectionFor(world.map.extent, 1200, 500);
  paintBase(recCtx, proj, world.map, world, {
    field,
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
    exterior: exterior.mapData,
    oxPlowing: { getRestAnchor: () => ({ x: 70, z: -76 }) },
    qinHanCompletion: { getNightFeastState: () => ({ x: 44, z: -128 }), targets: [{ id: 'millet-field', x: 56, z: -78 }] },
  });
  const expectedRiverFill = rgba(world.map.palette.water, world.map.river.fill);
  assert.ok(recCtx.fills.includes(expectedRiverFill), 'drawRiver applies cfg.river.fill (0.78) instead of 0.16 shoal halo');
}

// 4. Verify four-season palettes WCAG contrast across all 4 time anchors
for (const phenId of ['spring', 'summer', 'autumn', 'winter']) {
  const theme = createMapTimeTheme(world.map.palette);
  theme.setPhenology(phenId, mapExpansion.phenology);
  for (const tId of ['day', 'dawn', 'dusk', 'night']) {
    theme.setTarget(tId, 0, 'clear');
    for (let i = 0; i < 480; i++) theme.update(1 / 60);
    const p = theme.palette;
    assert.ok(contrast(p.ink, p.paper) >= 7, `${phenId}/${tId} ink contrast >= 7`);
    assert.ok(contrast(mixMapColor(p.ink, p.paper, 0.2), p.paper) >= 4.5, `${phenId}/${tId} muted contrast >= 4.5`);
    assert.ok(contrast(mixMapColor(p.seal, p.ink, 0.12), p.paper) >= 4.5, `${phenId}/${tId} seal contrast >= 4.5`);
  }
}
assert.deepEqual(applyPhenologyPalette(world.map.palette, 'spring', mapExpansion.phenology), world.map.palette);

// 5. Verify Journal accepts expanded scenic POIs while preserving schema
const player = { state: { x: 24, z: 152, yaw: 0, aboardSkiff: false }, clearInput() {} };
storageMap.set('taohua.journal.v1', JSON.stringify({ places: ['wuling', 'feipu'], people: [], classics: [], guide: [] }));
const journal = createJournal(world.map.pois, [], new MockEl('c', 'canvas'), player);
assert.deepEqual(journal.visited(), ['wuling', 'feipu'], 'journal keeps expanded scenic POI id in taohua.journal.v1');
journal.visit({ id: 'yaolu' });
assert.ok(journal.visited().includes('yaolu'));

// 6. Create map with expanded runtime mocks
let gfActive = false;
let gfPose = { x: 26, z: -249, yaw: 0.3 };
const mockGodFlight = {
  get active() { return gfActive; },
  getState: () => ({ ...gfPose, active: gfActive }),
};
let act3Stage = 'idle';
let act3Sealed = false;
const mockAct3 = {
  getState: () => ({ stage: act3Stage, caveSealed: act3Sealed }),
  getStats: () => ({
    stage: act3Stage,
    caveSealed: act3Sealed,
    markers: [{ id: 'm1', x: 24, z: 42, placed: act3Stage === 'marking' }],
  }),
};
const mockScrolls = [
  { id: 'scr-1', title: '桃源行纪 · 飞瀑', verse: '飞泉落三叠，漱玉入澄潭', region: '北涧三叠泉', x: 26, z: -249, dataUrl: 'data:image/jpeg;base64,AAAA' }
];
const mockScrollStudio = { getSavedScrolls: () => mockScrolls };

const map = createMap(world.map, world, {
  field,
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
  canvas: new MockEl('scene', 'canvas'),
  player,
  exterior: exterior.mapData,
  visited: ['wuling'],
  onVisit(poi) { journal.visit(poi); },
});
map.bindRuntime({
  godFlight: mockGodFlight,
  act3Finale: mockAct3,
  scrollStudio: mockScrollStudio,
});

// Check 24 POIs & sidebar index 0 === wuling & scenic header marker
assert.equal(map.getStats().pois, 24, 'expanded map lists 24 POIs');
assert.equal(ids.get('map-list').children.length, 24);
assert.ok(ids.get('map-list').children[8].classList.contains('map__item--scenic-first'), 'scenic section starts after 8 classic POIs');

// Fog-of-war: initially veiled at exterior (24, 152)
map.update(1 / 60);
assert.equal(map.getStats().valleyUnveiled, false, 'hidden valley remains veiled before entering cave');

// Crossing into valley (z = -45) unveils it
player.state.x = 24;
player.state.z = -45;
map.update(1 / 60);
assert.equal(map.getStats().valleyUnveiled, true, 'crossing through cave unveils interior valley');

// Priority regions hit accurately
for (const [rx, rz, expectedName] of [
  [124.5, -170, '东皋观云亭'],
  [26, -249, '北涧三叠泉'],
  [-18.5, -225.5, '竹坞药庐'],
  [-24, -136, '西畴果林'],
]) {
  player.state.x = rx;
  player.state.z = rz;
  map.update(1 / 60);
  assert.equal(map.getStats().region, expectedName, `regionAt(${rx}, ${rz}) === ${expectedName}`);
}

// God flight syncs region without triggering ground POI visits
const visitedBeforeFly = map.getStats().visited;
player.state.x = 24;
player.state.z = 152;
gfActive = true;
gfPose = { x: -18.5, z: -225.5, yaw: 0 };
map.update(1 / 60);
assert.equal(map.getStats().region, '竹坞药庐', 'godFlight updates map region to aerial camera position');
assert.equal(map.getStats().visited, visitedBeforeFly, 'godFlight does not trigger ground POI visits');
gfActive = false;

// Minimap compass click toggles miniMode without opening full map; center click opens full map
ids.get('minimap').dispatch('click', { clientX: 15, clientY: 15 });
assert.equal(map.getStats().miniMode, 'heading', 'clicking minimap compass badge toggles heading-up mode');
assert.equal(map.isOpen(), false, 'compass badge click does not open full map');
ids.get('minimap').dispatch('click', { clientX: 75, clientY: 75 });
assert.equal(map.isOpen(), true, 'clicking minimap center opens full map');
stepModalRaf();

// Scroll stamp rendered with alpha === 1
const mapCtx = ids.get('map-canvas').ctx;
assert.equal(map.getStats().scrollMarks, 1);
assert.ok(mapCtx.text.some(t => t.value === '画' && t.alpha === 1), 'scroll studio seal rendered on map with alpha === 1');

// Wheel zoom reveals micro-labels & preserves alpha === 1 for all text
ids.get('map-canvas').dispatch('wheel', { deltaY: -120, clientX: 600, clientY: 250 });
ids.get('map-canvas').dispatch('wheel', { deltaY: -120, clientX: 600, clientY: 250 });
ids.get('map-canvas').dispatch('wheel', { deltaY: -120, clientX: 600, clientY: 250 });
assert.ok(map.getStats().zoom >= 1.55, 'wheel zoom reaches semantic threshold');
assert.ok(mapCtx.text.some(t => t.value === '晒秋坪' || t.value === '晒谷场'), 'semantic zoom reveals secondary micro-labels');
assert.ok(mapCtx.text.every(t => t.alpha === 1), 'all map text retains ctx.globalAlpha === 1');

// Reset zoom via dblclick, test custom-pin drop & toggle off
ids.get('map-canvas').dispatch('dblclick');
assert.equal(map.getStats().zoom, 1, 'dblclick resets zoom to 1');
const proj1 = projectionFor(mapExpansion.extent || world.map.extent, 1200, 500);
const pinWorld = { x: -45, z: 165 };
ids.get('map-canvas').dispatch('click', { clientX: proj1.px(pinWorld.x, pinWorld.z), clientY: proj1.py(pinWorld.x, pinWorld.z) });
assert.equal(map.getDestination()?.id, 'custom-pin', 'clicking empty scroll drops custom-pin destination');
ids.get('map-canvas').dispatch('click', { clientX: proj1.px(pinWorld.x, pinWorld.z), clientY: proj1.py(pinWorld.x, pinWorld.z) });
assert.equal(map.getDestination(), null, 'clicking existing custom-pin removes it');

// Phenology switching preserves <= 3 rasters & <= 28.77 MB budget and restores spring cleanly
for (const season of ['summer', 'autumn', 'winter', 'spring']) {
  map.setPhenology(season);
  map.update(1 / 60);
  const st = map.getStats().appearance;
  assert.ok(st.cacheRasters <= 3 && st.rasterBytes <= 28771200, `${season} respects 3-raster / 28.77MB cap`);
  assert.equal(st.phenologyId, season);
}
assert.equal(map.getStats().appearance.paper.toLowerCase(), world.map.palette.paper.toLowerCase(), 'spring restores exact original paper color');

// 7. Act 3 marking + cave sealing + poeticWayfinder integration
map.close();
act3Stage = 'marking';
map.setDestination('cun');
assert.equal(map.getDestination()?.id, 'cun');

const wayfinder = createPoeticWayfinder({
  world,
  field,
  cliff,
  map,
  player,
  village,
  act3Finale: mockAct3,
  sky: { timeId: 'day', weatherId: 'clear', windX: 0.2, windZ: 0 },
});
player.state.x = 24;
player.state.z = 152;
for (let i = 0; i < 6; i++) wayfinder.update(0.05, player.state);
assert.equal(wayfinder.getStats().routingViaCave, true);

// Cave seals: wayfinder must enter 'sealed' and fade out; map clears/blocks interior destinations
act3Stage = 'returning';
act3Sealed = true;
map.update(1 / 60);
assert.equal(map.getDestination(), null, 'caveSealed clears interior destination on map');
map.setDestination('cun');
assert.equal(map.getDestination(), null, 'caveSealed blocks setting new interior destination');

// Force a sealed cross-cave wayfinder check (e.g. if destination came from another source)
const wayfinderSealed = createPoeticWayfinder({
  world,
  field,
  cliff,
  map: { getDestination: () => ({ id: 'cun', x: 30, z: -96 }) },
  player,
  village,
  act3Finale: mockAct3,
  sky: { timeId: 'day', weatherId: 'clear', windX: 0, windZ: 0 },
});
wayfinderSealed.update(0.05, player.state);
assert.equal(wayfinderSealed.getStats().routeMode, 'sealed');
assert.equal(wayfinderSealed.getStats().drawCalls, 0);

// 8. Same-side pond detour via road-network
act3Sealed = false;
player.state.x = 50;
player.state.z = -152;
const wfPond = createPoeticWayfinder({
  world,
  field,
  cliff,
  map: { getDestination: () => ({ id: 'east-pond', x: 86, z: -152 }) },
  player,
  village,
  act3Finale: mockAct3,
  sky: { timeId: 'day', weatherId: 'clear', windX: 0, windZ: 0 },
});
for (let i = 0; i < 5; i++) wfPond.update(0.05, player.state);
assert.equal(wfPond.getStats().routeMode, 'road-network', 'pond-blocked direct line switches to road-network detour');
assert.equal(wfPond.getStats().drawCalls, 1);

// 9. Spatial grid 100% mathematical equivalence across 500 random points & rays (including dynamic sealBlocker!)
const dynamicSeal = { x: 99999, z: 99999, hw: 0, hd: 0, rot: 0.2, source: 'act3-cave-seal' };
const dynamicOx = { x: 70, z: -76, hw: 0.46, hd: 0.76, rot: 0, source: 'plowing-ox' };
const allBlockers = cliff.blockers.concat(village.blockers, hinterland.blockers, villageScenes.blockers, mysteryWorld.blockers, villageLife.blockers, exterior.blockers, [dynamicSeal, dynamicOx]);
const barrierGrid = createBarrier(allBlockers);

function bruteResolve(state, radius) {
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (let i = 0; i < allBlockers.length; i++) {
      const b = allBlockers[i];
      const dx = state.x - b.x;
      const dz = state.z - b.z;
      const reach = b.hw + b.hd + radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      const ca = Math.cos(b.rot);
      const sa = Math.sin(b.rot);
      let lx = dx * ca - dz * sa;
      let lz = dx * sa + dz * ca;
      const px = b.hw + radius - Math.abs(lx);
      const pz = b.hd + radius - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      if (px < pz) lx += lx >= 0 ? px : -px;
      else lz += lz >= 0 ? pz : -pz;
      state.x = b.x + lx * ca + lz * sa;
      state.z = b.z + (-lx * sa + lz * ca);
      state.vx *= 0.3;
      state.vz *= 0.3;
      moved = true;
    }
    if (!moved) break;
  }
}

function bruteSightClear(ax, az, bx, bz, margin) {
  for (const b of allBlockers) {
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
    const x = (ax - b.x) * c - (az - b.z) * s;
    const z = (ax - b.x) * s + (az - b.z) * c;
    const dx = (bx - ax) * c - (bz - az) * s;
    const dz = (bx - ax) * s + (bz - az) * c;
    let lo = 0, hi = 1;
    for (const [origin, delta, half] of [[x, dx, b.hw + margin], [z, dz, b.hd + margin]]) {
      if (Math.abs(delta) < 1e-9) { if (Math.abs(origin) > half) { lo = 2; break; } }
      else {
        const u = (-half - origin) / delta, v = (half - origin) / delta;
        lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v));
      }
    }
    if (lo <= hi) return false;
  }
  return true;
}

let seed = 20261119;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

for (let i = 0; i < 500; i++) {
  if (i === 250) {
    // Activate dynamic sealBlocker & move oxBlocker mid-stream!
    dynamicSeal.x = 23; dynamicSeal.z = -10; dynamicSeal.hw = 4.6; dynamicSeal.hd = 3.2;
    dynamicOx.x = 58; dynamicOx.z = -84; dynamicOx.rot = 1.1;
  }
  const px = -60 + rnd() * 190;
  const pz = -240 + rnd() * 480;
  const sGrid = { x: px, z: pz, vx: 1, vz: -1 };
  const sBrute = { x: px, z: pz, vx: 1, vz: -1 };
  barrierGrid.resolve(sGrid, 0.42);
  bruteResolve(sBrute, 0.42);
  assert.ok(Math.abs(sGrid.x - sBrute.x) < 1e-12 && Math.abs(sGrid.z - sBrute.z) < 1e-12, `barrier grid === brute at sample ${i}`);

  const bx = px + (rnd() - 0.5) * 40;
  const bz = pz + (rnd() - 0.5) * 40;
  assert.equal(
    sightClear(px, pz, bx, bz, allBlockers, 0.12),
    bruteSightClear(px, pz, bx, bz, 0.12),
    `sightClear grid === brute at ray ${i}`
  );
}

// Explicit check against activated dynamicSeal
const sealHit = { x: 23, z: -10, vx: 1, vz: 1 };
barrierGrid.resolve(sealHit, 0.42);
assert.ok(Math.hypot(sealHit.x - 23, sealHit.z + 10) > 2.5, 'dynamic sealBlocker pushes player out via spatial grid');
assert.equal(sightClear(23, -18, 23, -2, allBlockers, 0.08), false, 'dynamic sealBlocker blocks sightClear via spatial grid');

const finalRasterBytes = map.getStats().appearance.rasterBytes;
map.dispose();
wayfinder.dispose();
wayfinderSealed.dispose();
wfPond.dispose();

console.log(JSON.stringify({
  result: 'PASS',
  checks: 10,
  pois: 24,
  spatialSamples: 500,
  maxBytes: finalRasterBytes
}));
