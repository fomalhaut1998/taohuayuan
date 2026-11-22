import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

if (!globalThis.Path2D) {
  globalThis.Path2D = class { moveTo() {} lineTo() {} };
}

// Install lightweight Canvas2D + localStorage + DOM harness for real map.js + wilds-easter-eggs.js verification
const storageMap = new Map();
globalThis.localStorage = {
  getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
  setItem: (k, v) => storageMap.set(k, String(v)),
  removeItem: k => storageMap.delete(k),
  clear: () => storageMap.clear()
};

class RecCtx {
  constructor(canvas) {
    this.canvas = canvas;
    this.globalAlpha = 1;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.font = '12px serif';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.stack = [];
    this.arcs = [];
    this.texts = [];
  }
  save() {
    this.stack.push({
      globalAlpha: this.globalAlpha,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth
    });
  }
  restore() { Object.assign(this, this.stack.pop() || {}); }
  clearRect() { this.arcs = []; this.texts = []; }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  arc(x, y, r) { this.arcs.push({ x, y, r, fill: this.fillStyle, stroke: this.strokeStyle, alpha: this.globalAlpha }); }
  ellipse() {}
  rect() {}
  clip() {}
  fillRect() {}
  strokeRect() {}
  fill() {}
  stroke() {}
  setTransform() {}
  translate() {}
  rotate() {}
  scale() {}
  setLineDash() {}
  putImageData() {}
  strokeText() {}
  fillText(val, x, y) { this.texts.push({ val: String(val), x, y, color: this.fillStyle, alpha: this.globalAlpha }); }
  drawImage() {}
  measureText(s) { return { width: String(s).length * 10 }; }
  createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
}

class StubEl {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.className = '';
    this.hidden = false;
    this.open = false;
    this.children = [];
    this.listeners = new Map();
    this.attrs = new Map();
    this.vars = new Map();
    this.style = { setProperty: (k, v) => this.vars.set(k, v), cursor: 'default' };
    this.textContent = '';
    this.innerHTML = '';
    this.clientWidth = 1200;
    this.clientHeight = 560;
    this.width = 300;
    this.height = 150;
    const classes = new Set();
    this.classList = {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (on ? classes.add(c) : classes.delete(c)))
    };
    if (tag === 'canvas') this._ctx = new RecCtx(this);
  }
  appendChild(el) { this.children.push(el); return el; }
  append(...els) { this.children.push(...els); }
  replaceChildren(...els) { this.children = [...els]; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  setAttribute(k, v) { this.attrs.set(k, v); }
  getContext() { return this._ctx; }
  addEventListener(k, cb) {
    if (!this.listeners.has(k)) this.listeners.set(k, []);
    this.listeners.get(k).push(cb);
  }
  removeEventListener(k, cb) {
    if (!this.listeners.has(k)) return;
    if (!cb) { this.listeners.delete(k); return; }
    this.listeners.set(k, this.listeners.get(k).filter(fn => fn !== cb));
  }
  dispatch(k, ev = {}) {
    for (const fn of (this.listeners.get(k) || []).slice()) {
      fn({ target: this, preventDefault() {}, ...ev });
    }
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  querySelector(sel) {
    if (!sel || !sel.startsWith('.')) return null;
    const cls = sel.slice(1);
    const walk = (el) => {
      for (const ch of (el?.children || [])) {
        if (String(ch.className || '').split(/\s+/).includes(cls)) return ch;
        const nested = walk(ch);
        if (nested) return nested;
      }
      return null;
    };
    return walk(this);
  }
  remove() {}
}

const elMap = new Map();
for (const id of [
  'map', 'map-sheet', 'map-canvas', 'map-close', 'map-list', 'map-region',
  'map-dest', 'map-time', 'map-count', 'map-note-name', 'map-note-poem',
  'map-dist', 'minimap', 'minimap-canvas', 'minimap-region',
  'toast', 'toast-k', 'toast-name', 'mystery-note',
  'journal', 'journal-open', 'journal-close', 'journal-clear', 'journal-status',
  'journal-places', 'journal-people', 'journal-classics', 'journal-plants',
  'journal-animals', 'journal-landforms', 'journal-field', 'journal-notes',
  'journal-tab-notes', 'journal-tab-field'
]) {
  const el = new StubEl(id.includes('canvas') ? 'canvas' : 'div');
  el.id = id;
  elMap.set(id, el);
}
function findInTree(root, targetId) {
  if (!root || !root.children) return null;
  for (const ch of root.children) {
    if (ch?.id === targetId) return ch;
    const hit = findInTree(ch, targetId);
    if (hit) return hit;
  }
  return null;
}
const rafQueue = new Map();
let rafSeq = 0;
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
  confirm: () => true
};
const bodyEl = new StubEl('body');
const docListeners = new Map();
globalThis.document = {
  body: bodyEl,
  pointerLockElement: null,
  activeElement: bodyEl,
  head: new StubEl('head'),
  addEventListener: (k, cb) => docListeners.set(k, cb),
  removeEventListener: k => docListeners.delete(k),
  querySelector: () => null,
  getElementById: id => {
    if (elMap.has(id)) return elMap.get(id);
    for (const root of elMap.values()) {
      const hit = findInTree(root, id);
      if (hit) return hit;
    }
    return findInTree(bodyEl, id);
  },
  createElement: tag => new StubEl(tag)
};
globalThis.requestAnimationFrame = cb => { rafQueue.set(++rafSeq, cb); return rafSeq; };
globalThis.cancelAnimationFrame = id => rafQueue.delete(id);

function flushRaf(nowTs = 200) {
  const entry = rafQueue.entries().next().value;
  if (!entry) return false;
  rafQueue.delete(entry[0]);
  entry[1](nowTs);
  return true;
}

import world from '../src/data/world.json' with { type: 'json' };
import outerWildsCfg from '../src/data/outer-wilds.json' with { type: 'json' };
import deepHollowsCfg from '../src/data/deep-hollows.json' with { type: 'json' };
import wildsEggsCfg from '../src/data/wilds-easter-eggs.json' with { type: 'json' };
import { CATALOGUE, catalogueEntry } from '../src/systems/catalogue.js';
import { illustrationSVG } from '../src/systems/field-guide.js';
import { collectDiscoveryTargets, discoveryScore } from '../src/systems/discovery-targets.js';
import { createRiverCurve, sampleRiverSpine, createStream } from '../src/world/stream.js';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createOuterWilds } from '../src/world/outer-wilds.js';
import { createDeepHollows } from '../src/world/deep-hollows.js';
import { createWildsEasterEggs } from '../src/world/wilds-easter-eggs.js';
import { createMap } from '../src/systems/map.js';
import { createJournal } from '../src/systems/journal.js';
import { createScrollStudio } from '../src/systems/scroll-studio.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { analyzeScrollScene, buildScrollColophonQueue } from '../src/systems/scroll-colophons.js';

let checks = 0;
function check(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

// 1. Hygiene & spoiler-free copy audit
for (const rel of [
  'src/world/wilds-easter-eggs.js',
  'src/systems/map.js',
  'src/systems/catalogue.js',
  'src/systems/field-guide.js',
  'src/systems/journal.js',
  'src/systems/scroll-studio.js',
  'src/systems/villager-dialogue.js',
  'src/systems/scroll-colophons.js'
]) {
  const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  check(!/\bconsole\.log\s*\(/.test(src), `zero console.log in ${rel}`);
}

for (const dhIcon of ['shrine', 'study', 'tea-terrace']) {
  check(illustrationSVG(dhIcon) !== illustrationSVG('leaf'), `deep-hollows custom non-fallback SVG for ${dhIcon}`);
}

const SPOILER_WORDS = ['渔人', '太守', '刘子骥', '南阳', '遂迷', '处处志', '不复得路'];
for (const site of wildsEggsCfg.sites) {
  const cat = catalogueEntry(site.id);
  check(Boolean(cat), `CATALOGUE has ${site.id}`);
  check(illustrationSVG(cat.icon) !== illustrationSVG('leaf'), `custom non-fallback SVG for ${site.id}`);
  const bag = [site.name, site.rumor, site.poem, ...site.lines, cat.name, cat.text].join(' ');
  for (const w of SPOILER_WORDS) {
    check(!bag.includes(w), `spoiler-free ${site.id} (no "${w}")`);
  }
}

// 2. Build real terrain + village + outerWilds + deepHollows + wildsEasterEggs
const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const terrain = createTerrain(world.terrain, distanceToRiver, { road: world.village.road, pond: world.terrain.pond });
const cliff = createCliff(world.cliff, terrain.field);
terrain.field.colorAt = terrain.colorAt;
const stream = createStream(world.stream, world.terrain, riverCurve);
const village = createVillage(world.village, terrain.field, world.terrain.pond);
const props = createProps(world.props, terrain.field, village.houseInfo, village.plots, village.road);

const outerWilds = createOuterWilds({
  world, field: terrain.field, distanceToRiver, riverCurve, stream, village, props, cliff, reservations: []
});
const deepHollows = createDeepHollows({
  world, field: terrain.field, distanceToRiver, riverCurve, stream, village, props, cliff, outerWilds, reservations: []
});
const wildsEggs = createWildsEasterEggs({
  world, field: terrain.field, valleyBorderlands: null, outerWilds, deepHollows
});

check(wildsEggs.sites.length === 7, `builds 7 wilds Easter eggs (got ${wildsEggs.sites.length})`);
check(wildsEggs.targets.length === 7, `registers 7 discovery targets (got ${wildsEggs.targets.length})`);
check(wildsEggs.blockers.length >= 7, `registers blockers (${wildsEggs.blockers.length})`);
check(wildsEggs.quietSpots.length >= 3, `registers quiet spots (${wildsEggs.quietSpots.length})`);

// Finite geometry & zero PointLight/SpotLight
let lights = 0;
wildsEggs.group.traverse(obj => {
  if (obj.isPointLight || obj.isSpotLight) lights++;
  if (!obj.isMesh) return;
  const p = obj.geometry?.attributes?.position?.array;
  const n = obj.geometry?.attributes?.normal?.array;
  const c = obj.geometry?.attributes?.color?.array;
  if (p) for (let i = 0; i < p.length; i++) assert.ok(Number.isFinite(p[i]), `${obj.name} finite pos`);
  if (n) for (let i = 0; i < n.length; i++) assert.ok(Number.isFinite(n[i]), `${obj.name} finite norm`);
  if (c) for (let i = 0; i < c.length; i++) assert.ok(Number.isFinite(c[i]), `${obj.name} finite color`);
});
check(lights === 0, 'zero PointLight/SpotLight in wildsEasterEggs');

// Grounding & sanctuary clearance & unobstructed discovery LOS
const sancts = [...Object.values(outerWildsCfg.sanctuaries), ...Object.values(deepHollowsCfg.sanctuaries)];
const cliffCx = world.cliff.center[0];
const cliffCz = world.cliff.center[1];
const allBlockers = [...cliff.blockers, ...village.blockers, ...outerWilds.blockers, ...deepHollows.blockers, ...wildsEggs.blockers];
const collected = collectDiscoveryTargets({ leisureGrove: { targets: wildsEggs.targets } });
check(collected.length === 7, 'collectDiscoveryTargets keeps all 7 wilds eggs');

for (const s of wildsEggs.sites) {
  const gy = terrain.field.sample(s.x, s.z);
  check(Math.abs(s.y - gy) < 0.5, `${s.id} grounded cleanly (y=${s.y.toFixed(2)}, gy=${gy.toFixed(2)})`);
  const rC = Math.hypot(s.x - cliffCx, s.z - cliffCz);
  check(rC >= 120 && rC <= 165, `${s.id} in outer wilds band (rC=${rC.toFixed(1)})`);
  for (const sn of sancts) {
    const d = Math.hypot(s.x - sn.x, s.z - sn.z);
    check(d >= 20, `${s.id} separated from ${sn.id} (d=${d.toFixed(1)}m)`);
  }
  for (const cr of [...(outerWilds.layout?.cragSpots || []), ...(deepHollows.layout?.cragSpots || [])]) {
    const dc = Math.hypot(s.x - cr[0], s.z - cr[1]);
    check(dc >= 4.0, `${s.id} clear of surrounding crag (dc=${dc.toFixed(2)}m)`);
  }
}

for (const tgt of collected) {
  const px = tgt.x + 1.5;
  const pz = tgt.z + 1.5;
  const py = terrain.field.sample(px, pz) + 1.62;
  const dx = tgt.x - px;
  const dy = tgt.y - py;
  const dz = tgt.z - pz;
  const len = Math.hypot(dx, dy, dz);
  const sc = discoveryScore({ x: px, y: py, z: pz }, { x: dx / len, y: dy / len, z: dz / len }, tgt, allBlockers, terrain.field);
  check(Number.isFinite(sc) && sc >= 0, `unobstructed discovery LOS for ${tgt.id} (score=${sc.toFixed(3)})`);
}

// 3. Distance gating (85m) + dt=0 freeze + 4-season byte-exact restore
const dynMesh = wildsEggs.group.getObjectByName('wilds-eggs-dynamic');
const glowMesh = wildsEggs.group.getObjectByName('wilds-eggs-glow');
const staticMesh = wildsEggs.group.getObjectByName('wilds-eggs-static');
check(Boolean(dynMesh && glowMesh && staticMesh), '3 core meshes built (static + dyn + glow)');

wildsEggs.update(0.1, 1.0, { timeId: 'day', wind: 0.4 }, { x: 48, z: -140 });
check(dynMesh.visible === false && glowMesh.visible === false, 'dyn & glow culled from village (48,-140)');
check(wildsEggs.getStats().activeDynamicSites === 0 && wildsEggs.getStats().activeGlowInstances === 0, 'zero active dynamic/glow draws from village');

const shrine = wildsEggs.sites.find(s => s.id === 'wilds-firefly-lantern-shrine');
wildsEggs.update(0.1, 1.1, { timeId: 'night', wind: 0.4 }, { x: shrine.x, z: shrine.z });
check(dynMesh.visible === true && glowMesh.visible === true, 'dyn & glow active near shrine');
check(wildsEggs.getStats().activeGlowInstances >= 7, `shrine glow activates >=7 halos (1 site + 6 fireflies, got ${wildsEggs.getStats().activeGlowInstances})`);

const dynSnap = new Float32Array(dynMesh.geometry.attributes.position.array);
const glowMatSnap = new Float32Array(glowMesh.instanceMatrix.array);
const glowColSnap = new Float32Array(glowMesh.instanceColor.array);
const glowOpSnap = glowMesh.material.opacity;
wildsEggs.update(0, 99, { timeId: 'night', wind: 1.5 }, { x: shrine.x, z: shrine.z });
assert.deepEqual(dynMesh.geometry.attributes.position.array, dynSnap, 'dynMesh frozen at dt=0');
assert.deepEqual(glowMesh.instanceMatrix.array, glowMatSnap, 'glow matrix frozen at dt=0');
assert.deepEqual(glowMesh.instanceColor.array, glowColSnap, 'glow colors frozen at dt=0');
check(glowMesh.material.opacity === glowOpSnap, 'glow opacity frozen at dt=0');

const springColorSnap = new Float32Array(staticMesh.geometry.attributes.color.array);
wildsEggs.setPhenology('autumn');
let changedAut = false;
for (let i = 0; i < springColorSnap.length; i++) {
  if (Math.abs(staticMesh.geometry.attributes.color.array[i] - springColorSnap[i]) > 1e-4) {
    changedAut = true;
    break;
  }
}
check(changedAut, 'autumn visibly shifts vertex colors');
wildsEggs.setPhenology('winter');
wildsEggs.setPhenology('spring');
assert.deepEqual(staticMesh.geometry.attributes.color.array, springColorSnap, 'spring restore byte-exact');
checks++;

// 4. Interaction, map snow overlay, map clue & seal persistence + backward compat
const soundCalls = [];
const mockSound = {
  unlock() {},
  craneCall(x, z) { soundCalls.push(['craneCall', x, z]); },
  bell(x, z) { soundCalls.push(['bell', x, z]); },
  goStoneClick(x, z) { soundCalls.push(['goStoneClick', x, z]); },
  waterCup(x, z) { soundCalls.push(['waterCup', x, z]); },
  frogPlop(x, z) { soundCalls.push(['frogPlop', x, z]); },
  guqinPluck(x, z, n) { soundCalls.push(['guqinPluck', x, z, n]); },
  wood(x, z) { soundCalls.push(['wood', x, z]); },
  toastCup(x, z) { soundCalls.push(['toastCup', x, z]); },
  dewDrop(x, z) { soundCalls.push(['dewDrop', x, z]); }
};
const observedJournal = [];
const mockJournal = { observe(id) { observedJournal.push(id); return true; } };
const mockClock = { getState: () => ({ short: '巳初', shichen: '巳时', modernText: '09:30' }) };
const mockMysteries = {
  pickTarget: () => null,
  interact: () => null,
  hide: () => {}
};

// Old save backward compatibility check (taohua.map.v1 without wildsEggs field)
localStorage.setItem('taohua.map.v1', JSON.stringify({
  v: 1, cols: 28, rows: 14, valleyUnveiled: true, explored: [10, 11]
}));
const playerStub = { state: { x: 174, z: -144, yaw: 0, pitch: 0, view: 'third', eyeHeight: 1.62 }, clearInput() {} };
const mapApi = createMap(world.map, world, {
  player: playerStub,
  field: { sample: (x, z) => terrain.field.sample(x, z) },
  spine: riverSpine,
  spots: [],
  marks: [],
  houseInfo: [],
  chimneys: [],
  visited: [world.map.pois[0].id]
});
mapApi.bindRuntime({ worldClock: mockClock, wildsEasterEggs: wildsEggs });
mapApi.update(1 / 60);
check(mapApi.getStats().wildsEggsFound === 0, 'old save without wildsEggs loads with 0 discovered');

const camMock = { position: new THREE.Vector3(112, 10, -242) };
wildsEggs.bind({
  mysteries: mockMysteries,
  sound: mockSound,
  player: playerStub,
  map: mapApi,
  worldClock: mockClock,
  journal: mockJournal,
  doc: globalThis.document
});

// Check snow weather overlay on open scroll map
mapApi.open();
flushRaf(500);
const mapCtx = elMap.get('map-canvas')._ctx;
check(mapApi.getStats().wildsEggMarks === 0, 'default zoom=1 draws 0 undiscovered egg marks');
check(!elMap.get('map-count').textContent.includes('奇踪'), 'initial count omits 奇踪 when 0 discovered');

const clearArcs = mapCtx.arcs.length;
mapApi.setTimeAppearance('day', 0.016, 'snow');
mapApi.update(1 / 60);
flushRaf(700);
const snowArcs = mapCtx.arcs.length;
check(snowArcs >= clearArcs + 26, `snow weather overlay renders >=26 snowflake arcs (clear=${clearArcs}, snow=${snowArcs})`);
check(mapCtx.texts.every(t => t.alpha === 1), 'snow map keeps globalAlpha === 1 on every text draw');

// Zoom in over valley & northern/eastern wilds to reveal undiscovered `觅` clues
mapApi.close();
playerStub.state.x = 30;
playerStub.state.z = -96;
mapApi.update(0.05);
mapApi.open();
flushRaf(900);
mapCtx.texts.length = 0;
while (mapApi.getStats().zoom < 1.75) {
  elMap.get('map-canvas').dispatch('wheel', { deltaY: -200, clientX: 420, clientY: 90 });
}
flushRaf(1050);
check(mapApi.getStats().valleyUnveiled === true, 'valleyUnveiled true after entering valley');
check(mapApi.getStats().wildsEggMarks > 0, `zoom >= 1.55 unveils '觅' clue marks (count=${mapApi.getStats().wildsEggMarks})`);
check(mapCtx.texts.some(t => t.val === '觅'), 'draws 觅 clue glyph at zoom >= 1.55');

// Test hovering & clicking a `觅` mark updates sidebar note to its rumor and toggles customDest
const clueText = mapCtx.texts.find(t => t.val === '觅');
check(Boolean(clueText), 'located drawn 觅 glyph screen coords');
elMap.get('map-canvas').dispatch('mousemove', { clientX: clueText.x, clientY: clueText.y });
check(elMap.get('map-note-name').textContent.includes('山野奇踪'), `hover shows rumor title: ${elMap.get('map-note-name').textContent}`);
check(elMap.get('map-dist').textContent.includes('传闻线索'), `hover shows clue action hint: ${elMap.get('map-dist').textContent}`);
elMap.get('map-canvas').dispatch('click', { clientX: clueText.x, clientY: clueText.y });
check(Boolean(mapApi.getDestination()), 'clicking 觅 sets destination');

// Trigger sundial & echo spring interactions via mysteries wrapper and check delayed audio + persistence
const sundial = wildsEggs.sites.find(s => s.id === 'wilds-stone-sundial');
playerStub.state.x = sundial.x;
playerStub.state.z = sundial.z + 1.6;
playerStub.state.yaw = 0;
playerStub.state.pitch = 0;
const picked = mockMysteries.pickTarget(camMock, { alignBias: 2.5 });
check(Boolean(picked && picked.isWildsEasterEgg && picked.id === 'wilds-stone-sundial'), 'mysteries.pickTarget picks sundial cleanly');
const trigRes = mockMysteries.interact(picked);
check(Boolean(trigRes && trigRes.line.includes('巳初')), 'sundial line appends live worldClock shichen');
check(observedJournal.includes('wilds-stone-sundial'), 'sundial discovery observed in journal');
check(mapApi.getStats().wildsEggsFound === 1, 'map increments wildsEggsFound to 1');
check(elMap.get('map-count').textContent.includes('奇踪 一 / 七'), `count updated: ${elMap.get('map-count').textContent}`);
check(elMap.get('toast-k').textContent === '山野奇遇', 'toast kicker is 山野奇遇');

const persisted = JSON.parse(localStorage.getItem('taohua.map.v1'));
check(Array.isArray(persisted.wildsEggs) && persisted.wildsEggs.includes('wilds-stone-sundial'), 'taohua.map.v1 persists discovered wildsEggs');

// Drain sundial's 0.36s delayed goStoneClick before resetting soundCalls
for (let i = 0; i < 10; i++) {
  wildsEggs.update(0.05, 4.1 + i * 0.05, { timeId: 'day' }, playerStub.state);
}
check(soundCalls.some(c => c[0] === 'goStoneClick'), 'sundial drains delayed goStoneClick');

// Check echo spring 3-beat delayed audio queue freezes at dt=0 and fires at dt>0
soundCalls.length = 0;
wildsEggs.interactById('wilds-jade-echo-spring', mockSound, globalThis.document);
const immediateCalls = soundCalls.length;
check(immediateCalls === 1, `echo spring fires t=0 immediate sound (${immediateCalls})`);
wildsEggs.update(0, 5.0, { timeId: 'day' }, playerStub.state);
check(soundCalls.length === 1, 'delayed echo sounds stay frozen at dt=0');
for (let i = 0; i < 40; i++) {
  wildsEggs.update(0.05, 5.1 + i * 0.05, { timeId: 'day' }, playerStub.state);
}
check(soundCalls.length === 4, `delayed 3-beat echo sounds drain over 2s (got ${soundCalls.length})`);

// Reset zoom back to 1 and confirm discovered egg seal ('奇') stays rendered even at 1x!
elMap.get('map-canvas').dispatch('dblclick');
flushRaf(1200);
check(mapApi.getStats().zoom === 1, 'dblclick resets zoom to 1');
check(mapCtx.texts.some(t => t.val === '奇'), 'discovered 奇 seal draws even at zoom=1');
check(mapCtx.texts.every(t => t.alpha === 1), 'every map text maintains globalAlpha === 1');

// 4b. Scroll map one-click '寻' clue toggle at zoom=1
const cluesBtn = elMap.get('map-sheet').querySelector('.map__tool-clues');
check(Boolean(cluesBtn), 'map mounts .map__tool-clues (寻) toggle button');
check(cluesBtn.hidden === false, 'clues button visible when valleyUnveiled & undiscovered eggs remain');
check(mapApi.getStats().showWildsClues === false, 'showWildsClues defaults to false');
check(mapApi.getStats().wildsEggMarks === 2, `at zoom=1 before toggle only 2 discovered marks show (got ${mapApi.getStats().wildsEggMarks})`);
mapCtx.texts.length = 0;
cluesBtn.dispatch('click');
check(mapApi.getStats().showWildsClues === true, 'clicking 寻 toggles showWildsClues true');
check(cluesBtn.classList.contains('is-active') && cluesBtn.attrs.get('aria-pressed') === 'true', '寻 button enters active state');
check(mapApi.getStats().wildsEggMarks === wildsEggsCfg.sites.length, `all ${wildsEggsCfg.sites.length} marks visible at zoom=1 with 寻 toggled ON`);
check(mapCtx.texts.filter(t => t.val === '觅').length === wildsEggsCfg.sites.length - 2, 'draws 5 觅 clue glyphs at zoom=1');
check(mapCtx.texts.every(t => t.alpha === 1), 'every 觅 glyph maintains globalAlpha === 1');
cluesBtn.dispatch('click');
check(mapApi.getStats().showWildsClues === false, 'second click toggles showWildsClues back off');
check(mapApi.getStats().wildsEggMarks === 2, 'hides undiscovered 觅 marks back to 2 discovered marks when toggled OFF');

// 5. Mountain NPC living rumor network
const mockedEggFound = new Set();
const dynamicWildsProxy = {
  getSites: () => wildsEggsCfg.sites.map(s => ({ ...s, discovered: mockedEggFound.has(s.id) })),
  getStats: () => ({ discovered: [...mockedEggFound] })
};
const rumourDlg = createVillagerDialogue({
  sky: { timeId: 'day', weatherId: 'clear', rain: 0, snow: 0 },
  getWorldClock: () => mockClock,
  getPhenology: () => ({ id: 'spring' }),
  getWildsEasterEggs: () => dynamicWildsProxy,
  doc: globalThis.document
});
const teaRoasterTarget = { key: 'npc-tea-roaster', kind: 'person', ref: { role: 'tea_roaster', name: '采茶女阿青' }, lines: ['山风正好。'] };
const dlg0 = rumourDlg.beginOrAdvance(teaRoasterTarget);
check(dlg0 && dlg0.replies.length === 3 && dlg0.replies.some(r => r.topic === 'rumor'), 'tea_roaster exposes 3rd wilds rumor reply choice');
const dlg1 = rumourDlg.chooseReply(2);
check(Boolean(dlg1 && dlg1.line.includes('风铃廊') && dlg1.line.includes('七处隐秘奇踪')), `tea_roaster rumors bamboo wind chimes initially: ${dlg1?.line}`);
for (const w of SPOILER_WORDS) {
  check(!dlg1.line.includes(w), `npc rumor line spoiler-free (no "${w}")`);
}
rumourDlg.close();
mockedEggFound.add('wilds-bamboo-wind-chimes');
rumourDlg.beginOrAdvance(teaRoasterTarget);
const dlg2 = rumourDlg.chooseReply(2);
check(Boolean(dlg2 && dlg2.line.includes('白鹤') && dlg2.line.includes('余6处')), `tea_roaster shifts rumor to next undiscovered crane nest after chimes found: ${dlg2?.line}`);
rumourDlg.close();

for (const s of wildsEggsCfg.sites) mockedEggFound.add(s.id);
const altarTarget = { key: 'npc-altar', kind: 'person', ref: { role: 'altar_keeper', name: '古社守坛翁' }, lines: ['古樟青青。'] };
rumourDlg.beginOrAdvance(altarTarget);
const dlgDone = rumourDlg.chooseReply(2);
check(Boolean(dlgDone && dlgDone.line.includes('山野秘藏')), 'npc rumor celebrates 山野秘藏 completion once all 7 eggs found');
rumourDlg.close();

const standaloneDlg = createVillagerDialogue({
  sky: { timeId: 'day', weatherId: 'clear', rain: 0, snow: 0 },
  doc: globalThis.document
});
standaloneDlg.beginOrAdvance({ key: 'npc-kiln', kind: 'person', ref: { role: 'kiln_potter', name: '窑匠' }, lines: ['窑火正旺。'] });
const dlgFallback = standaloneDlg.chooseReply(2);
check(Boolean(dlgFallback && dlgFallback.line.includes('青瓷秘匣')), 'villager dialogue still works cleanly when getWildsEasterEggs is omitted');
standaloneDlg.close();

// 6. 《丹青入画》 3D framing & bespoke wilds colophon ranking
for (const [eggId, expectedLabel, expectedColophonId] of [
  ['wilds-crane-nest', '白鹤松巢', 'wilds-crane-nest-verse'],
  ['wilds-stone-sundial', '古石日晷', 'wilds-stone-sundial-verse'],
  ['wilds-jade-echo-spring', '回音碧潭', 'wilds-jade-echo-spring-verse'],
  ['wilds-hermit-wine-cellar', '松坡酒窖', 'wilds-hermit-wine-cellar-verse'],
  ['wilds-firefly-lantern-shrine', '萤石小龛', 'wilds-firefly-lantern-shrine-verse'],
  ['wilds-ancient-kiln-cache', '古窑青瓷', 'wilds-ancient-kiln-cache-verse'],
  ['wilds-bamboo-wind-chimes', '竹风铃廊', 'wilds-bamboo-wind-chimes-verse']
]) {
  const site = wildsEggs.sites.find(s => s.id === eggId);
  const camX = site.x;
  const camZ = site.z + 6;
  const prof = analyzeScrollScene({
    pose: { x: camX, z: camZ, yaw: 0 },
    player: { state: { x: camX, z: camZ, y: terrain.field.sample(camX, camZ), yaw: 0, pitch: 0 } },
    field: terrain.field,
    world,
    region: '山野',
    sky: { timeId: 'day', weatherId: 'clear' },
    phenology: { id: 'spring' },
    clockInfo: { solarTerm: '谷雨' },
    sceneContext: { deepHollows, wildsEasterEggs: wildsEggs, outerWilds }
  });
  check(prof.detectedFeatures.includes(expectedLabel), `${eggId} detected in 画心取象 (${expectedLabel})`);
  const queueRes = buildScrollColophonQueue(prof);
  check(queueRes.items[0]?.id === expectedColophonId, `${eggId} bespoke colophon ranks #1 (got ${queueRes.items[0]?.id})`);
}
// Background-valley dominance regression: overlooking village from bamboo-wind-chimes still picks wind chimes #1 & omits distant crane nest (53m)
const chimesCoords = wildsEggs.sites.find(s => s.id === 'wilds-bamboo-wind-chimes');
const chimesCamX = chimesCoords.x + 1.2;
const chimesCamZ = chimesCoords.z + 4.4;
const chimesOverlook = analyzeScrollScene({
  pose: { x: chimesCamX, z: chimesCamZ, yaw: Math.atan2(-(chimesCoords.x - chimesCamX), -(chimesCoords.z - chimesCamZ)) },
  player: { state: { x: chimesCamX, z: chimesCamZ, y: terrain.field.sample(chimesCamX, chimesCamZ), yaw: 0, pitch: 0 } },
  field: terrain.field,
  world,
  region: '碧涧茶坞',
  sky: { timeId: 'day', weatherId: 'clear' },
  phenology: { id: 'spring' },
  clockInfo: { solarTerm: '清明' },
  sceneContext: { deepHollows, wildsEasterEggs: wildsEggs, outerWilds, village }
});
check(chimesOverlook.detectedFeatures[0] === '竹风铃廊', `foreground 竹风铃廊 leads 画心取象 (got ${chimesOverlook.detectedFeatures.join(',')})`);
check(!chimesOverlook.detectedFeatures.includes('白鹤松巢'), `distant >=48m 白鹤松巢 excluded from 画心取象 (${chimesOverlook.detectedFeatures.join(',')})`);
const overlookQueue = buildScrollColophonQueue({
  ...chimesOverlook,
  secondaryRegions: ['六博亭林', '桑竹', '美池'],
  tags: {
    ...chimesOverlook.tags,
    pavilion: 1.5,
    liubo: 1.4,
    lotus: 1.4,
    pond: 1.4
  }
});
check(overlookQueue.items[0]?.id === 'wilds-bamboo-wind-chimes-verse' && overlookQueue.items[0]?.seal === '清风竹铃', `overlook still ranks wind-chimes colophon #1 (got ${overlookQueue.items[0]?.id})`);

const villageProf = analyzeScrollScene({
  pose: { x: 24, z: -116, yaw: 0 },
  player: { state: { x: 24, z: -116, y: terrain.field.sample(24, -116), yaw: 0, pitch: 0 } },
  field: terrain.field,
  world,
  region: '桃源村',
  sky: { timeId: 'day', weatherId: 'clear' },
  phenology: { id: 'spring' },
  clockInfo: { solarTerm: '谷雨' },
  sceneContext: { deepHollows, wildsEasterEggs: wildsEggs, outerWilds, village }
});
const villageQueue = buildScrollColophonQueue(villageProf);
check(!villageQueue.items.some(it => String(it.id || '').startsWith('wilds-') && String(it.id || '').endsWith('-verse')), 'village scroll never surfaces requiresTag wilds colophons');

// 5. Proximity whispers + minimap radar + Journal wilds-wonders + Scroll Studio collector's seal
const craneSite = wildsEggs.sites.find(s => s.id === 'wilds-crane-nest');
soundCalls.length = 0;
const whBefore = wildsEggs.getStats().whispers;
playerStub.state.x = craneSite.x - 18;
playerStub.state.z = craneSite.z;
playerStub.state.flying = false;
wildsEggs.update(0, 7.0, { timeId: 'day' }, playerStub.state);
check(wildsEggs.getStats().whispers === whBefore, 'proximity whisper does not fire at dt=0');
wildsEggs.update(0.05, 7.1, { timeId: 'day' }, playerStub.state);
check(wildsEggs.getStats().whispers === whBefore + 1, 'proximity whisper fires when approaching undiscovered egg');
check(soundCalls.some(c => c[0] === 'craneCall'), 'crane proximity whisper triggers spatial craneCall');

// Minimap proximity radar draws dashed arc ring when <= 42m from undiscovered egg
mapApi.close();
const miniCtx = elMap.get('minimap-canvas')._ctx;
mapApi.update(0.35);
check(miniCtx.arcs.some(a => a.r >= 3.4 && a.r <= 5.0), 'minimap draws dashed proximity radar ring near undiscovered egg');

// Journal '山野奇遇' section & 7/7 '山野秘藏' collector's seal unlock
const journalApi = createJournal(world.map.pois, [], elMap.get('minimap-canvas'), { clearInput() {} });
const ssApi = createScrollStudio({
  map: mapApi,
  world,
  doc: globalThis.document,
  win: globalThis.window,
  storage: globalThis.localStorage
});

elMap.get('journal-open').dispatch('click');
check(Boolean(globalThis.document.getElementById('journal-wilds-wonders')), 'journal mounts #journal-wilds-wonders section');
check(globalThis.document.getElementById('journal-wonders-progress').textContent.includes('零 / 七'), 'initial journal progress is 零 / 七');
check(!ssApi.getAvailableQuestSeals().some(s => s.seal === '山野秘藏'), '山野秘藏 seal stays locked below 7/7');
journalApi.close();

for (const s of wildsEggs.sites) {
  journalApi.observe(s.id);
  mapApi.markWildsEggDiscovered(s);
}
check(cluesBtn.hidden === true, 'cluesBtn auto-hides once all 7 wilds eggs discovered');
check(mapApi.getStats().showWildsClues === false, 'showWildsClues auto-clears once all 7 wilds eggs discovered');
elMap.get('journal-open').dispatch('click');
check(globalThis.document.getElementById('journal-wonders-progress').textContent.includes('七 / 七'), '7/7 journal progress updates to 七 / 七');
const bodyChildren = globalThis.document.getElementById('journal-wonders-body').children;
check(bodyChildren.some(c => c.classList?.contains?.('journal__wonders-complete') || String(c.className).includes('complete')), 'journal renders collector seal banner at 7/7');
journalApi.close();

const savedJournal = JSON.parse(localStorage.getItem('taohua.journal.v1'));
check(Object.keys(savedJournal).sort().join(',') === 'classics,guide,people,places', 'taohua.journal.v1 preserves exact 4-key schema');

const unlockedSeals = ssApi.getAvailableQuestSeals();
check(unlockedSeals.some(s => s.questId === 'wilds-seven-wonders' && s.seal === '山野秘藏'), 'Scroll Studio unlocks 山野秘藏 collector seal at 7/7');

wildsEggs.clearDiscovered();
check(wildsEggs.getStats().discovered.length === 0, 'clearDiscovered resets wilds eggs discovered set');

ssApi.dispose();
wildsEggs.dispose();
deepHollows.dispose();
outerWilds.dispose();
village.dispose?.();
mapApi.dispose();

console.log(JSON.stringify({
  result: 'PASS',
  checks,
  wildsEggs: wildsEggsCfg.sites.length,
  snowArcs,
  clearArcs,
  persistedEggs: persisted.wildsEggs,
  unlockedSeals: unlockedSeals.map(s => s.seal)
}));
