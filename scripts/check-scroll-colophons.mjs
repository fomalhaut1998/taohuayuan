import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  CLASSICAL_COLOPHONS,
  FORBIDDEN_PLACE_NAMES,
  analyzeScrollScene,
  composeContextualColophons,
  buildScrollColophonQueue,
  resolveExpandedRegionAt
} from '../src/systems/scroll-colophons.js';
import { createScrollStudio } from '../src/systems/scroll-studio.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const mapExpansion = JSON.parse(readFileSync(new URL('../src/data/map-expansion.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------
// 1. Code Hygiene: zero console.log in scroll-colophons.js & scroll-studio.js
// ---------------------------------------------------------------------------
for (const rel of ['../src/systems/scroll-colophons.js', '../src/systems/scroll-studio.js']) {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.equal(/\bconsole\.log\s*\(/.test(src), false, `zero console.log in ${rel}`);
}

// ---------------------------------------------------------------------------
// 2. Treasury Integrity, Uniqueness, Hanging-Scroll Layout Bounds & Coverage
// ---------------------------------------------------------------------------
assert.ok(CLASSICAL_COLOPHONS.length >= 200, `expected >= 200 curated colophons, got ${CLASSICAL_COLOPHONS.length}`);

const legacyIds = [
  'grove-petals', 'stream-wander', 'cave-gleam', 'pond-village',
  'fields-harmony', 'dusk-mulberry', 'night-realm', 'timeless-song',
  'winter-snow', 'winter-ferry', 'winter-tea', 'winter-dawn', 'winter-dusk'
];
for (const id of legacyIds) {
  assert.ok(CLASSICAL_COLOPHONS.some(c => c.id === id), `preserves legacy colophon id: ${id}`);
}

const seenIds = new Set();
const seenVerses = new Set();
for (const entry of CLASSICAL_COLOPHONS) {
  assert.ok(entry.id && !seenIds.has(entry.id), `unique id: ${entry.id}`);
  seenIds.add(entry.id);
  assert.ok(entry.verse && !seenVerses.has(entry.verse), `unique verse: ${entry.verse}`);
  seenVerses.add(entry.verse);

  assert.ok(
    entry.verse.length >= 8 && entry.verse.length <= 26,
    `verse length within 8..26 chars (${entry.id}: ${entry.verse.length})`
  );
  const clauses = entry.verse.split(/[，。；！？、]+/).map(s => s.trim()).filter(Boolean);
  assert.ok(
    clauses.length >= 2 && clauses.length <= 4,
    `clause count 2..4 for hanging scroll (${entry.id}: ${clauses.length})`
  );
  for (const cl of clauses) {
    assert.ok(cl.length >= 2 && cl.length <= 10, `clause length 2..10 (${entry.id}: ${cl})`);
  }
  assert.ok(entry.seal && entry.seal.length >= 2 && entry.seal.length <= 4, `seal 2..4 chars (${entry.id}: ${entry.seal})`);

  for (const bad of FORBIDDEN_PLACE_NAMES) {
    assert.equal(entry.verse.includes(bad), false, `no unrelated place name ${bad} in ${entry.id}`);
    assert.equal(entry.seal.includes(bad), false, `no unrelated place name ${bad} in seal ${entry.id}`);
  }
}

const allRegions = [...new Set([
  ...world.map.regions.map(r => r.name),
  ...mapExpansion.regions.map(r => r.name)
])];
assert.equal(allRegions.length, 32, 'all 32 world + expansion regions enumerated');
for (const rName of allRegions) {
  assert.ok(
    CLASSICAL_COLOPHONS.some(c => c.matchRegions?.includes(rName)),
    `region ${rName} has dedicated colophons`
  );
  const resolved = resolveExpandedRegionAt(
    (world.map.regions.find(r => r.name === rName) || mapExpansion.regions.find(r => r.name === rName)).x,
    (world.map.regions.find(r => r.name === rName) || mapExpansion.regions.find(r => r.name === rName)).z,
    world
  );
  assert.ok(typeof resolved === 'string' && resolved.length > 0, `resolveExpandedRegionAt resolves near ${rName}`);
}

const seasons = ['spring', 'summer', 'autumn', 'winter'];
const times = ['dawn', 'day', 'dusk', 'night'];
const weathers = ['clear', 'mist', 'rain', 'wind', 'snow'];
for (const s of seasons) {
  for (const t of times) {
    for (const w of weathers) {
      if (w === 'snow' && s !== 'winter') continue;
      const prof = analyzeScrollScene({
        pose: { x: 40, z: -120, yaw: 0 },
        region: '桃源村',
        phenology: { id: s },
        skyInfo: { timeId: t, weatherId: w },
        world
      });
      const q = buildScrollColophonQueue(prof, { includeComposed: false });
      assert.ok(q.items.length >= 10, `combo ${s}/${t}/${w} has >= 10 compatible verses (got ${q.items.length})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: Headless Scroll Studio Harness
// ---------------------------------------------------------------------------
function makeStudioHarness({ sceneContext, skyState, phenologyState, clockState, godFlightState, skiffState }) {
  const els = new Map();
  const winListeners = new Map();
  const make2dCtx = (texts) => {
    const base = {
      fillStyle: '#000', strokeStyle: '#000', font: '14px serif',
      textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1,
      save() {}, restore() {}, clearRect() {}, fillRect() {}, strokeRect() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, rect() {}, clip() {},
      stroke() {}, drawImage() {},
      fillText(txt) { texts.push(String(txt)); },
      createLinearGradient() { return { addColorStop() {} }; },
      createRadialGradient() { return { addColorStop() {} }; }
    };
    return base;
  };
  const makeEl = (tag, id = '') => {
    const listeners = new Map();
    const texts = [];
    const attrs = new Map();
    const classes = new Set();
    const ctx = make2dCtx(texts);
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      id,
      value: '',
      textContent: '',
      hidden: false,
      disabled: false,
      open: false,
      width: 640,
      height: 360,
      style: {},
      children: [],
      _texts: texts,
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); }
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      appendChild(ch) {
        if (ch) {
          ch.parentNode = this;
          this.children.push(ch);
          if (ch.id) els.set(ch.id, ch);
        }
        return ch;
      },
      replaceChildren() { this.children.length = 0; },
      querySelector() { return null; },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener(ev, fn) {
        const arr = listeners.get(ev);
        if (!arr) return;
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      },
      dispatch(ev, payload = {}) {
        for (const fn of (listeners.get(ev) || [])) fn({ target: el, preventDefault() {}, stopPropagation() {}, ...payload });
      },
      click() { this.dispatch('click'); },
      focus() {},
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() { if (this.id) els.delete(this.id); },
      getContext: () => ctx,
      toDataURL: () => 'data:image/png;base64,iVBORw0KGgo='
    };
    if (id) els.set(id, el);
    return el;
  };
  const body = makeEl('body', 'body');
  const head = makeEl('head', 'head');
  const doc = {
    body,
    head,
    pointerLockElement: null,
    activeElement: body,
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => els.get(id) || null
  };
  const win = {
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, []);
      winListeners.get(ev).push(fn);
    },
    removeEventListener(ev, fn) {
      const arr = winListeners.get(ev);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    confirm: () => true
  };
  const store = new Map();
  const storage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const canvas = makeEl('canvas', 'scene');
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.2, 500);
  const player = { state: { x: 50, y: 1.2, z: -178, yaw: Math.PI, pitch: 0.08, camPitch: 0.08 }, clearInput() {}, syncCamera() {} };
  const field = { sample: () => 1.2, walkSurface: () => 1.2 };

  const studio = createScrollStudio({
    canvas,
    player,
    camera,
    field,
    riverSkiff: skiffState,
    journal: { isOpen: () => false },
    map: { isOpen: () => false, getStats: () => ({ region: '' }) },
    sky: skyState,
    getPhenology: () => ({ getStats: () => phenologyState }),
    getWorldClock: () => ({ getState: () => clockState }),
    getTravelerGuide: () => ({ cruiseActive: false }),
    getGodFlight: () => godFlightState,
    getSceneContext: () => sceneContext,
    renderSceneNow() {},
    world,
    doc,
    win,
    storage
  });

  return { studio, doc, els, camera, player, skyState, phenologyState, clockState, godFlightState, skiffState };
}

// ---------------------------------------------------------------------------
// 3. Exact User Screenshot Scenario: 夏荷 · 晴夜 · 良田 · 芒种 (水田/亭/竹/暖灯/流萤/星夜)
// ---------------------------------------------------------------------------
{
  const sceneContext = {
    village: {
      houseInfo: [
        { x: 24, z: -140, gy: 1.2 },
        { x: 38, z: -145, gy: 1.2 },
        { x: 52, z: -148, gy: 1.2 }
      ],
      plots: [[46, -162], [54, -162], [46, -172], [54, -172]],
      bamboo: [[44, -138, 1], [60, -142, 1]],
      pond: world.terrain.pond
    },
    leisureGrove: {
      targets: [
        { id: 'thatched-pavilion', x: 32, y: 1.5, z: -148 }
      ]
    },
    seasonalGathering: { getStats: () => ({ fireflyActive: true }) },
    seasonalCycle: { getStats: () => ({ rainbowVisible: false, geeseVisible: false }) }
  };
  const h = makeStudioHarness({
    sceneContext,
    skyState: { timeId: 'night', weatherId: 'clear', getLunarState: () => ({ name: '峨眉月' }) },
    phenologyState: { phenologyId: 'summer', short: '夏荷' },
    clockState: { modernText: '公元386年06月18日 22时05分', solarTerm: '芒种', solarWhisper: '水田插秧正忙，池荷初绽' },
    godFlightState: { active: false },
    skiffState: { isAboard: () => false, getStats: () => ({ drifting: false }) }
  });
  h.camera.position.set(50, 2.8, -178);
  h.camera.rotation.set(0.08, Math.PI, 0, 'YXZ');
  h.camera.updateMatrixWorld();

  assert.equal(h.studio.openCapture(), true, 'opens studio in summer-night paddy scene');
  const stats = h.studio.getStats();
  assert.ok(stats.librarySize >= 200, 'reports librarySize >= 200');
  assert.ok(stats.matchedCount >= 12, `reports strong matchedCount >= 12 (got ${stats.matchedCount})`);
  assert.ok(stats.sceneFeatures.includes('水田'), `detects 水田 in frame (${stats.sceneFeatures.join(',')})`);
  assert.ok(stats.sceneFeatures.includes('流萤'), `detects 流萤 in summer night frame (${stats.sceneFeatures.join(',')})`);
  assert.ok(stats.sceneFeatures.includes('暖灯'), `detects 暖灯 in village night frame (${stats.sceneFeatures.join(',')})`);
  assert.ok(h.doc.getElementById('scroll-scene-cues')?.textContent?.includes('画心取象：'), 'renders #scroll-scene-cues banner');

  const previewTexts = h.els.get('scroll-preview-canvas')._texts;
  const firstVerse = previewTexts.find(t => /[，。]/.test(t) && !t.startsWith('桃源行纪') && !t.startsWith('时维'));
  assert.ok(firstVerse, 'renders verse on canvas');
  assert.notEqual(
    firstVerse,
    '阡陌交通，鸡犬相闻，黄发垂髫，并怡然自乐。',
    'summer-night starry paddy does NOT pick daytime 阡陌交通 verse'
  );

  // Clicking 换一句题跋 15 times produces 15 distinct summer-night compatible verses
  const cycledVerses = new Set([firstVerse]);
  const verseBtn = h.doc.getElementById('scroll-verse-cycle');
  for (let i = 0; i < 14; i++) {
    previewTexts.length = 0;
    verseBtn.click();
    const v = previewTexts.find(t => t.endsWith('。') && !t.startsWith('时维'));
    assert.ok(v, `cycle #${i + 1} renders a verse`);
    assert.equal(v.includes('白雪') || v.includes('飞雪') || v.includes('寒梅'), false, `cycle #${i + 1} has no winter snow leakage: ${v}`);
    cycledVerses.add(v);
  }
  assert.equal(cycledVerses.size, 15, '15 cycles yield 15 completely distinct verses');

  // Anti-repetition across repeated openCapture() at the same spot
  h.studio.close();
  const repeatedTopVerses = new Set();
  for (let i = 0; i < 8; i++) {
    previewTexts.length = 0;
    assert.equal(h.studio.openCapture(), true);
    const v = previewTexts.find(t => t.endsWith('。') && !t.startsWith('时维'));
    repeatedTopVerses.add(v);
    h.studio.close();
  }
  assert.ok(repeatedTopVerses.size >= 6, `8 repeated captures rotate >= 6 distinct opening verses (got ${repeatedTopVerses.size})`);
  h.studio.dispose();
}

// ---------------------------------------------------------------------------
// 4. Camera Orientation Sensitivity, Landmarks, Sky Phenomena, Aerial & Skiff
// ---------------------------------------------------------------------------
{
  const sceneContext = {
    village: {
      houseInfo: [{ x: 24, z: -140, gy: 1.2 }],
      plots: [[50, -170]],
      bamboo: [[114, -129, 1]],
      pond: world.terrain.pond
    },
    leisureGrove: {
      targets: [
        { id: 'lotus', x: 68, y: 0.9, z: -152 },
        { id: 'dragonfly', x: 68, y: 1.2, z: -152 },
        { id: 'thatched-pavilion', x: 58, y: 1.5, z: -130 },
        { id: 'liubo-board', x: 58, y: 1.8, z: -130 },
        { id: 'mountain-cascade', x: 26, y: 4.0, z: -249 },
        { id: 'lanke-chess-crag', x: 156, y: 3.0, z: -164 }
      ]
    },
    seasonalCycle: { getStats: () => ({ rainbowVisible: true, geeseVisible: false }) }
  };

  // Camera near pond facing pond vs facing away
  const camPond = new THREE.PerspectiveCamera(55, 16 / 9, 0.2, 500);
  camPond.position.set(68, 2.5, -166);
  camPond.lookAt(68, 1.0, -152);
  camPond.updateMatrixWorld();
  const profPond = analyzeScrollScene({
    pose: { x: 68, z: -166, yaw: Math.PI },
    camera: camPond,
    region: '美池',
    phenology: { id: 'summer' },
    skyInfo: { timeId: 'day', weatherId: 'clear' },
    world,
    sceneContext
  });
  assert.ok((profPond.tags.lotus || 0) > 0 && (profPond.tags.pond || 0) > 0, 'facing lotus pond detects lotus & pond');
  assert.ok((profPond.tags.rainbow || 0) > 0, 'rainbow visible adds rainbow tag');
  const qPond = buildScrollColophonQueue(profPond);
  assert.ok(qPond.items[0].matchTags?.some(t => t === 'lotus' || t === 'rainbow'), `pond+rainbow top pick fits frame (${qPond.items[0].verse})`);

  // Facing three-tier waterfall during rain
  const camFall = new THREE.PerspectiveCamera(55, 16 / 9, 0.2, 500);
  camFall.position.set(26, 2.5, -230);
  camFall.lookAt(26, 4.0, -249);
  camFall.updateMatrixWorld();
  const profFall = analyzeScrollScene({
    pose: { x: 26, z: -230, yaw: 0 },
    camera: camFall,
    region: '北涧三叠泉',
    phenology: { id: 'summer' },
    skyInfo: { timeId: 'day', weatherId: 'rain' },
    world,
    sceneContext: { ...sceneContext, seasonalCycle: { getStats: () => ({ rainbowVisible: false, geeseVisible: false }) } }
  });
  assert.ok((profFall.tags.waterfall || 0) > 0, 'facing waterfall detects waterfall tag');
  const qFall = buildScrollColophonQueue(profFall);
  assert.ok(qFall.items[0].verse.includes('泉') || qFall.items[0].verse.includes('瀑'), `waterfall top pick sings of cascade (${qFall.items[0].verse})`);

  // Aerial godFlight vantage
  const camFly = new THREE.PerspectiveCamera(55, 16 / 9, 0.2, 500);
  camFly.position.set(30, 32, -100);
  camFly.lookAt(30, 2, -140);
  camFly.updateMatrixWorld();
  const profFly = analyzeScrollScene({
    pose: { x: 30, z: -100, yaw: 0, detached: true },
    camera: camFly,
    region: '桃源村',
    phenology: { id: 'spring' },
    skyInfo: { timeId: 'day', weatherId: 'clear' },
    godFlight: { active: true },
    world,
    sceneContext: { ...sceneContext, seasonalCycle: { getStats: () => ({ rainbowVisible: false, geeseVisible: false }) } }
  });
  assert.ok((profFly.tags.aerial || 0) > 0, 'godFlight elevation triggers aerial tag');
  const qFly = buildScrollColophonQueue(profFly);
  assert.ok(qFly.items[0].matchTags?.includes('aerial'), `aerial capture picks panoramic aerial verse (${qFly.items[0].verse})`);

  // River skiff drifting aboard in spring rain
  const profSkiff = analyzeScrollScene({
    pose: { x: 26, z: 200, yaw: Math.PI },
    region: '武陵溪',
    phenology: { id: 'spring' },
    skyInfo: { timeId: 'day', weatherId: 'rain' },
    riverSkiff: { isAboard: () => true, getStats: () => ({ drifting: true }) },
    world
  });
  assert.ok((profSkiff.tags['skiff-aboard'] || 0) > 0 && (profSkiff.tags['skiff-drifting'] || 0) > 0, 'riverSkiff aboard & drifting detected');
  const qSkiff = buildScrollColophonQueue(profSkiff);
  assert.ok(qSkiff.items[0].matchTags?.includes('skiff-aboard'), `skiff rain capture picks boat/rain verse (${qSkiff.items[0].verse})`);

  // Winter-snow deterministic 武陵溪 ferry check
  const profWinFerry = analyzeScrollScene({
    pose: { x: 27.2, z: 203.5, yaw: 0.7, detached: true },
    region: '武陵溪',
    phenology: { id: 'winter' },
    skyInfo: { timeId: 'day', weatherId: 'snow' },
    world
  });
  const qWinFerry = buildScrollColophonQueue(profWinFerry);
  assert.equal(qWinFerry.items[0].seal, '寒江渔火', 'fresh winter-snow 武陵溪 capture deterministically picks 寒江渔火');
}

// ---------------------------------------------------------------------------
// 5. Composed Couplet Engine Quality Across 20+ Diverse Profiles
// ---------------------------------------------------------------------------
{
  const knownSet = new Set(CLASSICAL_COLOPHONS.map(c => c.verse));
  const testProfiles = [
    { region: '良田', phenologyId: 'summer', timeId: 'night', weatherId: 'clear', tags: { paddy: 3, fireflies: 2.5, stars: 2, 'warm-lights': 2, bamboo: 1.5, pavilion: 1.5 } },
    { region: '良田', phenologyId: 'summer', timeId: 'day', weatherId: 'clear', tags: { paddy: 3, field: 2.5, 'ox-plowing': 2, clouds: 1.5 } },
    { region: '美池', phenologyId: 'summer', timeId: 'night', weatherId: 'clear', tags: { pond: 3, lotus: 3, moon: 2, fireflies: 2 } },
    { region: '美池', phenologyId: 'summer', timeId: 'day', weatherId: 'rain', tags: { pond: 3, lotus: 3, rain: 2.5 } },
    { region: '桃花林', phenologyId: 'spring', timeId: 'day', weatherId: 'clear', tags: { peach: 3, petals: 2.8, stream: 2, bird: 1.8 } },
    { region: '桃花林', phenologyId: 'spring', timeId: 'dawn', weatherId: 'mist', tags: { peach: 3, 'mist-sea': 2.5, sunrise: 2, village: 2 } },
    { region: '武陵溪', phenologyId: 'winter', timeId: 'night', weatherId: 'snow', tags: { ferry: 3, boat: 2.5, snow: 2.5, 'shore-ice': 2 } },
    { region: '武陵溪', phenologyId: 'autumn', timeId: 'dusk', weatherId: 'clear', tags: { boat: 2.8, stream: 2.5, sunset: 2.2, egret: 1.8 } },
    { region: '北涧三叠泉', phenologyId: 'summer', timeId: 'day', weatherId: 'rain', tags: { waterfall: 3, rain: 2.4, stream: 2, 'mist-sea': 2 } },
    { region: '北山层梯', phenologyId: 'autumn', timeId: 'dusk', weatherId: 'clear', tags: { terrace: 3, millet: 2.5, sunset: 2, mountains: 2 } },
    { region: '东皋晒秋坪', phenologyId: 'autumn', timeId: 'day', weatherId: 'clear', tags: { sunning: 3, millet: 2.8, mountains: 2, clouds: 1.5 } },
    { region: '东皋观云亭', phenologyId: 'spring', timeId: 'day', weatherId: 'mist', tags: { 'cloud-pavilion': 3, clouds: 2.8, mountains: 2.5, pine: 2 } },
    { region: '竹坞药庐', phenologyId: 'summer', timeId: 'day', weatherId: 'clear', tags: { herbs: 3, bamboo: 2.8, pavilion: 2, 'tea-hut': 2 } },
    { region: '北岭松风茶寮', phenologyId: 'winter', timeId: 'dusk', weatherId: 'snow', tags: { 'tea-hut': 3, snow: 2.6, pine: 2.4, cottage: 2 } },
    { region: '山阿秦汉古窑', phenologyId: 'autumn', timeId: 'day', weatherId: 'clear', tags: { kiln: 3, smoke: 2.4, mountains: 2 } },
    { region: '东岭烂柯石枰', phenologyId: 'spring', timeId: 'day', weatherId: 'clear', tags: { 'lanke-chess': 3, pine: 2.5, bamboo: 2 } },
    { region: '西岭鹿柴望川台', phenologyId: 'autumn', timeId: 'dusk', weatherId: 'clear', tags: { hermitage: 3, stag: 2.6, bamboo: 2, sunset: 2 } },
    { region: '西岭云樵茅舍', phenologyId: 'autumn', timeId: 'dusk', weatherId: 'clear', tags: { 'woodcutter-hut': 3, sunset: 2.4, smoke: 2, cottage: 2 } },
    { region: '桃源村', phenologyId: 'summer', timeId: 'night', weatherId: 'clear', tags: { bonfire: 3, feast: 2.6, 'warm-lights': 2.5, village: 2.2 } },
    { region: '桃源村', phenologyId: 'winter', timeId: 'night', weatherId: 'snow', tags: { snow: 3, cottage: 2.5, 'warm-lights': 2.2, feast: 2 } },
    { region: '山口', phenologyId: 'spring', timeId: 'dawn', weatherId: 'mist', tags: { cave: 3, 'mist-sea': 2.5, mountains: 2 } },
    { region: '桃源村', phenologyId: 'autumn', timeId: 'day', weatherId: 'clear', tags: { aerial: 3.4, geese: 2.8, mountains: 2.5, village: 2.2, clouds: 2 } }
  ];

  let totalComposed = 0;
  for (const prof of testProfiles) {
    const fullProf = { ...prof, secondaryRegions: [], solarTerm: '', lunarName: '', elevation: 2, pitch: 0, topTags: Object.keys(prof.tags) };
    const composed = composeContextualColophons(fullProf, { limit: 6 });
    assert.ok(composed.length >= 1, `composed >= 1 couplet for ${prof.region} (${prof.phenologyId}/${prof.timeId}/${prof.weatherId})`);
    totalComposed += composed.length;
    for (const c of composed) {
      assert.equal(knownSet.has(c.verse), false, `composed verse is fresh: ${c.verse}`);
      const parts = c.verse.replace(/。$/, '').split('，');
      assert.equal(parts.length, 2, `composed verse has 2 symmetric clauses: ${c.verse}`);
      assert.equal(parts[0].length, parts[1].length, `equal 5+5 or 7+7 meter: ${c.verse}`);
      assert.ok(parts[0].length === 5 || parts[0].length === 7, `meter is 5 or 7: ${c.verse}`);
      const setA = new Set(Array.from(parts[0]));
      for (const ch of parts[1]) {
        assert.equal(setA.has(ch), false, `no shared Hanzi (${ch}) between halves in ${c.verse}`);
      }
      assert.equal(c.seal.length, 4, `composed seal is 4 chars: ${c.seal}`);
    }
  }
  assert.ok(totalComposed >= 40, `22 profiles produced ${totalComposed} rich composed couplets`);
}

console.log(`PASS check-scroll-colophons: treasury (${CLASSICAL_COLOPHONS.length} verses), 3D frustum scene sensing, composed couplets, and anti-repetition verified`);
