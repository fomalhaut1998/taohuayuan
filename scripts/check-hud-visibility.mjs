import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createGodFlight } from '../src/systems/god-flight.js';
import { createAudioHud } from '../src/systems/audio-hud.js';
import { createSky } from '../src/systems/sky.js';
import { createWorldClock } from '../src/systems/world-clock.js';
import { createPhenologySystem } from '../src/systems/phenology-mist.js';

const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const audioHudSrc = readFileSync(new URL('../src/systems/audio-hud.js', import.meta.url), 'utf8');
const scrollStudioSrc = readFileSync(new URL('../src/systems/scroll-studio.js', import.meta.url), 'utf8');
const godFlightSrc = readFileSync(new URL('../src/systems/god-flight.js', import.meta.url), 'utf8');
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

function extractTemplateCss(source, varName) {
  const m = source.match(new RegExp(`const ${varName}\\s*=\\s*\`([\\s\\S]*?)\`;`));
  assert.ok(m, `expected template literal ${varName}`);
  return m[1].replace(/\$\{[^}]+\}/g, 'serif');
}

function extractArrayCss(source, varName) {
  const m = source.match(new RegExp(`const ${varName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\.join`));
  assert.ok(m, `expected array literal ${varName}`);
  return [...m[1].matchAll(/'([^']*)'/g)].map((entry) => entry[1]).join('\n');
}

const combinedCss = [
  styleCss,
  extractArrayCss(audioHudSrc, 'AUDIO_HUD_CSS'),
  extractTemplateCss(scrollStudioSrc, 'STUDIO_CSS')
].join('\n');

/**
 * Strip comments and top-level @media / @keyframes blocks so base desktop rules
 * can be inspected cleanly in cascade order.
 */
function parseBaseRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  while (i < stripped.length) {
    while (i < stripped.length && /\s/.test(stripped[i])) i++;
    if (i >= stripped.length) break;
    if (stripped[i] === '@') {
      const brace = stripped.indexOf('{', i);
      const semi = stripped.indexOf(';', i);
      if (semi !== -1 && (brace === -1 || semi < brace)) {
        i = semi + 1;
        continue;
      }
      if (brace === -1) break;
      let depth = 1;
      let j = brace + 1;
      while (j < stripped.length && depth > 0) {
        if (stripped[j] === '{') depth++;
        else if (stripped[j] === '}') depth--;
        j++;
      }
      i = j;
      continue;
    }
    const open = stripped.indexOf('{', i);
    if (open === -1) break;
    const close = stripped.indexOf('}', open + 1);
    if (close === -1) break;
    const selectors = stripped
      .slice(i, open)
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    const body = stripped.slice(open + 1, close);
    const props = {};
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon <= 0) continue;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      const val = decl.slice(colon + 1).trim();
      if (prop) props[prop] = val;
    }
    rules.push({ selectors, props });
    i = close + 1;
  }
  return rules;
}

const rules = parseBaseRules(combinedCss);

function computeProps(...matchSelectors) {
  const result = {};
  for (const rule of rules) {
    if (rule.selectors.some((sel) => matchSelectors.includes(sel))) {
      Object.assign(result, rule.props);
    }
  }
  return result;
}

function parseColor(str) {
  if (!str) return null;
  const raw = str.trim();
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
        1
      ];
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      1
    ];
  }
  const rgba = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    return [
      Number(rgba[1]),
      Number(rgba[2]),
      Number(rgba[3]),
      rgba[4] === undefined ? 1 : Number(rgba[4])
    ];
  }
  return null;
}

function compositeOver(fg, bgRgb) {
  const a = fg[3] ?? 1;
  return [
    fg[0] * a + bgRgb[0] * (1 - a),
    fg[1] * a + bgRgb[1] * (1 - a),
    fg[2] * a + bgRgb[2] * (1 - a)
  ];
}

function relativeLuminance(rgb) {
  return rgb
    .map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, idx) => sum + v * [0.2126, 0.7152, 0.0722][idx], 0);
}

function contrastRatio(rgbA, rgbB) {
  const la = relativeLuminance(rgbA);
  const lb = relativeLuminance(rgbB);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// 1. Verify no low-opacity container regression on visible HUD elements
assert.ok(!/viewEl\.style\.opacity\s*=/.test(godFlightSrc), 'god-flight does not override #view opacity inline');

const hudContainers = [
  { name: '.sky', day: ['.sky'], night: ['.sky', 'body.is-night .sky'] },
  { name: '#hint', day: ['#hint'], night: ['#hint', 'body.is-night #hint'] },
  { name: '#view', day: ['#view'], night: ['#view', 'body.is-night #view'] },
  { name: '.fps', day: ['.fps'], night: ['.fps', 'body.is-night #fps'] },
  { name: '#stats', day: ['#stats'], night: ['#stats', 'body.is-night #stats'] },
  { name: '#prompt', day: ['#prompt'], night: ['#prompt', 'body.is-night #prompt'] },
  { name: '#talk', day: ['#talk'], night: ['#talk', 'body.is-night #talk'] },
  { name: '.plain', day: ['.plain'], night: ['.plain', 'body.is-night .plain'] },
  { name: '.journal-open', day: ['.journal-open'], night: ['.journal-open', 'body.is-night .journal-open'] },
  { name: '#scroll-open', day: ['#scroll-open'], night: ['#scroll-open', 'body.is-night #scroll-open'] },
  { name: '.ui-toggle', day: ['.ui-toggle'], night: ['.ui-toggle', 'body.is-night .ui-toggle'] },
  { name: '.quiet-exit', day: ['.quiet-exit'], night: ['.quiet-exit', 'body.is-night .quiet-exit'] },
  { name: '.sky-toast', day: ['.sky-toast'], night: ['.sky-toast', 'body.is-night .sky-toast'] },
  { name: '.toast', day: ['.toast'], night: ['.toast', 'body.is-night .toast'] },
  { name: '.quiet-notice', day: ['.quiet-notice'], night: ['.quiet-notice', 'body.is-night .quiet-notice'] },
  { name: '#mystery-note', day: ['#mystery-note'], night: ['#mystery-note', 'body.is-night #mystery-note'] }
];

const SCENE_BACKGROUNDS = [
  { label: 'deep shadow (#000000)', rgb: [0, 0, 0] },
  { label: 'tilled earth (#4A3A28)', rgb: [74, 58, 40] },
  { label: 'paddy green (#3B4B2B)', rgb: [59, 75, 43] },
  { label: 'dawn sky (#E6D6C9)', rgb: [230, 214, 201] },
  { label: 'winter snow (#FFFFFF)', rgb: [255, 255, 255] }
];

let minPrimaryContrast = Infinity;
let minSecondaryContrast = Infinity;
let checks = 0;

for (const item of hudContainers) {
  for (const mode of ['day', 'night']) {
    const props = computeProps(...item[mode]);
    const bg = parseColor(props.background || props['background-color']);
    assert.ok(bg && bg[3] >= 0.88, `${item.name} (${mode}) must have solid-enough backdrop >= 0.88, got ${props.background || props['background-color']}`);
    if (props.opacity !== undefined) {
      const op = Number(props.opacity);
      // Hidden-by-default toasts/prompts start at opacity 0; resting visible panels must be 1
      assert.ok(op === 0 || op === 1, `${item.name} (${mode}) resting opacity must not dim visible text (got ${op})`);
    }
    if (props.color) {
      const fg = parseColor(props.color);
      assert.ok(fg, `${item.name} (${mode}) valid color: ${props.color}`);
      for (const sceneBg of SCENE_BACKGROUNDS) {
        const cardRgb = compositeOver(bg, sceneBg.rgb);
        const textRgb = compositeOver(fg, cardRgb);
        const cr = contrastRatio(textRgb, cardRgb);
        minPrimaryContrast = Math.min(minPrimaryContrast, cr);
        assert.ok(cr >= 7.0, `${item.name} (${mode}) on ${sceneBg.label} primary contrast ${cr.toFixed(2)} < 7.0`);
        checks++;
      }
    }
  }
}

// Verify secondary labels, keycaps, talk metadata, fly active button, modern clock, and muted audio row
const secondaryChecks = [
  { label: '.sky__modern (day)', bgSel: ['.sky'], fgSel: ['.sky__modern'], minCr: 7.0 },
  { label: '.sky__modern (night)', bgSel: ['.sky', 'body.is-night .sky'], fgSel: ['.sky__modern', 'body.is-night .sky__modern'], minCr: 7.0 },
  { label: '.sky__k (day)', bgSel: ['.sky'], fgSel: ['.sky__k'] },
  { label: '.sky__k (night)', bgSel: ['.sky', 'body.is-night .sky'], fgSel: ['.sky__k', 'body.is-night .sky__k'] },
  { label: '#view .view__k (day)', bgSel: ['#view'], fgSel: ['#view .view__k'] },
  { label: '#view .view__k (night)', bgSel: ['#view', 'body.is-night #view'], fgSel: ['#view .view__k', 'body.is-night #view .view__k'] },
  { label: '.fps .fps__u (day)', bgSel: ['.fps'], fgSel: ['.fps .fps__u'] },
  { label: '.fps .fps__u (night)', bgSel: ['.fps', 'body.is-night #fps'], fgSel: ['.fps .fps__u', 'body.is-night #fps .fps__u'] },
  { label: '#stats .k (day)', bgSel: ['#stats'], fgSel: ['#stats .k'] },
  { label: '#stats .k (night)', bgSel: ['#stats', 'body.is-night #stats'], fgSel: ['#stats .k', 'body.is-night #stats .k'] },
  { label: '#talk-who (day)', bgSel: ['#talk'], fgSel: ['#talk-who'] },
  { label: '#talk-who (night)', bgSel: ['#talk', 'body.is-night #talk'], fgSel: ['#talk-who', 'body.is-night #talk-who'] },
  { label: '.toast__k (day)', bgSel: ['.toast'], fgSel: ['.toast__k'] },
  { label: '.toast__k (night)', bgSel: ['.toast', 'body.is-night .toast'], fgSel: ['.toast__k', 'body.is-night .toast__k'] },
  { label: '#sky-audio-row.is-muted .sky__v (day)', bgSel: ['.sky'], fgSel: ['#sky-audio-row.is-muted .sky__v'] },
  { label: '#sky-audio-row.is-muted .sky__v (night)', bgSel: ['.sky', 'body.is-night .sky'], fgSel: ['#sky-audio-row.is-muted .sky__v', 'body.is-night #sky-audio-row.is-muted .sky__v'] },
  { label: '.sky .key (day)', bgSel: ['.sky'], subBgSel: ['.sky .key'], fgSel: ['.sky .key'] },
  { label: '.sky .key (night)', bgSel: ['.sky', 'body.is-night .sky'], subBgSel: ['.sky .key', 'body.is-night .sky .key'], fgSel: ['.sky .key', 'body.is-night .sky .key'] },
  { label: '#view .view__key (day)', bgSel: ['#view'], subBgSel: ['#view .view__key'], fgSel: ['#view .view__key'] },
  { label: '#view .view__key (night)', bgSel: ['#view', 'body.is-night #view'], subBgSel: ['#view .view__key', 'body.is-night #view .view__key'], fgSel: ['#view .view__key', 'body.is-night #view .view__key'] },
  { label: '#prompt .key (day)', bgSel: ['#prompt'], subBgSel: ['#prompt .key'], fgSel: ['#prompt .key'] },
  { label: '#prompt .key (night)', bgSel: ['#prompt', 'body.is-night #prompt'], subBgSel: ['#prompt .key', 'body.is-night #prompt .key'], fgSel: ['#prompt .key', 'body.is-night #prompt .key'] },
  { label: '#view .view__fly.is-active (day)', bgSel: ['#view'], subBgSel: ['#view .view__fly.is-active'], fgSel: ['#view .view__fly.is-active'] },
  { label: '#view .view__fly.is-active (night)', bgSel: ['#view', 'body.is-night #view'], subBgSel: ['#view .view__fly.is-active', 'body.is-night #view .view__fly.is-active'], fgSel: ['#view .view__fly.is-active', 'body.is-night #view .view__fly.is-active'] }
];

for (const entry of secondaryChecks) {
  const outerProps = computeProps(...entry.bgSel);
  const subProps = entry.subBgSel ? computeProps(...entry.subBgSel) : null;
  const fgProps = computeProps(...entry.fgSel);
  const outerBg = parseColor(outerProps.background || outerProps['background-color']);
  const subBg = subProps ? parseColor(subProps.background || subProps['background-color']) : null;
  const fg = parseColor(fgProps.color);
  assert.ok(outerBg && fg, `resolved colors for ${entry.label}`);
  if (fgProps.opacity !== undefined) {
    assert.equal(Number(fgProps.opacity), 1, `${entry.label} must not use partial opacity`);
  }
  for (const sceneBg of SCENE_BACKGROUNDS) {
    let surfaceRgb = compositeOver(outerBg, sceneBg.rgb);
    if (subBg) surfaceRgb = compositeOver(subBg, surfaceRgb);
    const textRgb = compositeOver(fg, surfaceRgb);
    const cr = contrastRatio(textRgb, surfaceRgb);
    const threshold = entry.minCr ?? 4.5;
    if (threshold >= 7.0) minPrimaryContrast = Math.min(minPrimaryContrast, cr);
    else minSecondaryContrast = Math.min(minSecondaryContrast, cr);
    assert.ok(cr >= threshold, `${entry.label} on ${sceneBg.label} contrast ${cr.toFixed(2)} < ${threshold}`);
    checks++;
  }
}

// Verify full-row interactive hit targets & adaptive narrow/high-zoom CSS contracts
assert.ok(indexHtml.includes('id="sky-time-row"') && indexHtml.includes('id="sky-weather-row"'), 'index.html exposes #sky-time-row and #sky-weather-row');
const skyRowProps = computeProps('.sky__row');
assert.equal(skyRowProps['pointer-events'], 'auto', '.sky__row enables full-row click targeting');
assert.equal(skyRowProps.cursor, 'pointer', '.sky__row shows pointer affordance');
const skyModernProps = computeProps('.sky__modern');
assert.equal(skyModernProps['pointer-events'], 'auto', '.sky__modern enables click targeting');
assert.equal(skyModernProps.cursor, 'pointer', '.sky__modern shows pointer affordance');
assert.ok(
  /body\.ui-hidden #sky \*,\s*body\.map-open #sky \*\s*\{[^}]*pointer-events:\s*none\s*!important/s.test(styleCss),
  'ui-hidden and map-open disable pointer events on interactive #sky rows'
);
assert.ok(
  /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.sky\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,/s.test(styleCss),
  '<= 480px collapses .sky into a compact 2-column grid capsule'
);
assert.ok(
  /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.sky__modern\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s.test(styleCss),
  '<= 480px spans .sky__modern across both grid columns'
);
assert.ok(
  /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?#scroll-open\s*\{/s.test(scrollStudioSrc),
  'scroll-studio aligns #scroll-open with compact <= 480px layout'
);
assert.ok(
  /@media\s*\(max-height:\s*540px\)\s*\{[\s\S]*?\.sky\s*\{/s.test(styleCss),
  'short-height viewports tighten top HUD vertical footprint'
);

// Verify #talk primary text color & solid backdrop (not transparent gradient)
const talkProps = computeProps('#talk');
assert.ok(!/gradient/i.test(talkProps.background || ''), '#talk uses solid translucent paper backdrop without transparent top band');
const plainProps = computeProps('.plain');
assert.ok(!/gradient/i.test(plainProps.background || ''), '.plain uses uniform translucent paper backdrop');

// 2. Runtime DOM behavior check for createGodFlight & createAudioHud
{
  const makeClassList = () => {
    const s = new Set();
    return {
      add: (...xs) => xs.forEach((x) => s.add(x)),
      remove: (...xs) => xs.forEach((x) => s.delete(x)),
      contains: (x) => s.has(x),
      toggle: (x, force) => {
        const next = force === undefined ? !s.has(x) : Boolean(force);
        if (next) s.add(x);
        else s.delete(x);
        return next;
      }
    };
  };
  const makeNode = (tag, id = '') => {
    const node = {
      tagName: tag.toUpperCase(),
      id,
      className: '',
      classList: makeClassList(),
      style: { cssText: '' },
      textContent: '',
      innerHTML: '',
      title: '',
      dataset: {},
      children: [],
      attributes: new Map(),
      listeners: new Map(),
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      remove() {
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
          this.parentNode = null;
        }
      },
      setAttribute(k, v) { this.attributes.set(k, String(v)); },
      addEventListener(k, fn) {
        if (!this.listeners.has(k)) this.listeners.set(k, new Set());
        this.listeners.get(k).add(fn);
      },
      removeEventListener(k, fn) { this.listeners.get(k)?.delete(fn); },
      blur() {},
      querySelectorAll() { return []; }
    };
    return node;
  };

  const head = makeNode('head');
  const body = makeNode('body');
  const skyHud = makeNode('div', 'sky');
  const skyModern = makeNode('div', 'sky-modern-time');
  const skyTimeRow = makeNode('div', 'sky-time-row');
  const skyTimeVal = makeNode('span', 'sky-time');
  skyTimeRow.appendChild(skyTimeVal);
  const skyWeatherRow = makeNode('div', 'sky-weather-row');
  const skyWeatherVal = makeNode('span', 'sky-weather');
  skyWeatherRow.appendChild(skyWeatherVal);
  skyHud.appendChild(skyModern);
  skyHud.appendChild(skyTimeRow);
  skyHud.appendChild(skyWeatherRow);

  const skyToast = makeNode('div', 'sky-toast');
  const journalDialog = makeNode('dialog', 'journal');
  journalDialog.open = false;
  const viewEl = makeNode('div', 'view');
  const viewNameEl = makeNode('span', 'view-name');
  const hintEl = makeNode('div', 'hint');
  hintEl.innerHTML = '<span class="hint__group">WASD 行走</span>';
  body.appendChild(skyHud);
  body.appendChild(skyToast);
  body.appendChild(journalDialog);
  body.appendChild(viewEl);
  body.appendChild(viewNameEl);
  body.appendChild(hintEl);

  const byId = new Map([
    ['sky', skyHud],
    ['sky-modern-time', skyModern],
    ['sky-time-row', skyTimeRow],
    ['sky-time', skyTimeVal],
    ['sky-weather-row', skyWeatherRow],
    ['sky-weather', skyWeatherVal],
    ['sky-toast', skyToast],
    ['journal', journalDialog],
    ['view', viewEl],
    ['view-name', viewNameEl],
    ['hint', hintEl]
  ]);

  const ctx2d = {
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    clearRect() {},
    fillStyle: ''
  };
  const doc = {
    head,
    body,
    createElement(tag) {
      const el = makeNode(tag);
      if (tag === 'canvas') {
        el.width = 0;
        el.height = 0;
        el.getContext = () => ctx2d;
      }
      return el;
    },
    getElementById(id) {
      if (byId.has(id)) return byId.get(id);
      const search = (root) => {
        for (const c of root.children || []) {
          if (c.id === id) return c;
          const hit = search(c);
          if (hit) return hit;
        }
        return null;
      };
      return search(head) || search(body);
    }
  };
  const winListeners = new Map();
  const win = {
    location: { search: '' },
    addEventListener(k, fn) {
      if (!winListeners.has(k)) winListeners.set(k, new Set());
      winListeners.get(k).add(fn);
    },
    removeEventListener(k, fn) { winListeners.get(k)?.delete(fn); }
  };

  const fireClick = (node) => {
    let stopped = false;
    const ev = { target: node, stopPropagation() { stopped = true; } };
    for (const fn of [...(node.listeners.get('click') || [])]) fn(ev);
    return stopped;
  };

  const player = { state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, view: 'first' }, clearInput() {} };
  const avatar = { group: new THREE.Group() };
  const canvas = makeNode('canvas', 'scene');
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 200);
  const field = { sample: () => 0 };

  const gf = createGodFlight({ scene: new THREE.Scene(), camera, player, avatar, canvas, world, field, doc, win });
  assert.equal(gf.enter(), true);
  assert.equal(viewEl.classList.contains('view--flight'), true, 'god-flight toggles semantic view--flight class');
  assert.equal(viewEl.style.opacity, undefined, 'god-flight never sets inline viewEl.style.opacity');
  assert.equal(gf.exit(), true);
  assert.equal(viewEl.classList.contains('view--flight'), false, 'god-flight exit clears view--flight class');
  assert.equal(viewEl.style.opacity, undefined, 'god-flight exit keeps viewEl.style.opacity untouched');

  assert.equal(gf.enter(), true);
  gf.dispose();
  assert.equal(viewEl.classList.contains('view--flight'), false, 'god-flight dispose cleans view--flight class');

  const modes = [
    { mode: 'full', volume: 1, muted: false, label: '畅响' },
    { mode: 'soft', volume: 0.42, muted: false, label: '轻音' },
    { mode: 'mute', volume: 0, muted: true, label: '寂静' }
  ];
  let modeIdx = 0;
  let soundUnlocks = 0;
  const mockSound = {
    unlock() { soundUnlocks++; },
    getAudioPrefs: () => modes[modeIdx],
    cycleAudioMode: () => { modeIdx = (modeIdx + 1) % modes.length; return modes[modeIdx]; }
  };

  // Full-row click tests for #sky-time-row, #sky-weather-row, #sky-modern-time, #sky-phenology-row, #sky-audio-row
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = doc;
  globalThis.window = win;
  const skyScene = new THREE.Scene();
  skyScene.fog = new THREE.Fog('#F2EAD9', 40, 260);
  const sky = createSky(world.sky, skyScene, { getPixelRatio: () => 1 }, camera, { sound: mockSound });
  const worldClock = createWorldClock({ sky, smoke: {}, doc, win });
  const phenology = createPhenologySystem({ world, field, sky, doc, win });
  const audioHud = createAudioHud({ sound: mockSound, doc, win });

  const phenRow = doc.getElementById('sky-phenology-row');
  const audioRow = doc.getElementById('sky-audio-row');
  assert.ok(phenRow, 'phenology mounts full-row #sky-phenology-row target');
  assert.ok(audioRow, 'audio HUD mounts full-row #sky-audio-row target');

  // 1) Click #sky-time-row cycles time of day (day -> dusk) & unlocks sound without changing clock speed
  assert.equal(sky.timeId, 'day');
  assert.equal(worldClock.getState().speedScale, 1);
  assert.equal(fireClick(skyTimeRow), true, 'clicking #sky-time-row stops propagation');
  assert.equal(sky.timeId, 'dusk', 'clicking #sky-time-row cycles time of day');
  assert.equal(worldClock.getState().speedScale, 1, 'clicking #sky-time-row keeps clock flow speed unchanged');
  assert.ok(soundUnlocks >= 1, 'clicking #sky-time-row unlocks sound');

  // 2) Click #sky-modern-time toggles clock flow speed (1x -> 4x -> paused -> 1x) without cycling time phase
  assert.equal(fireClick(skyModern), true, 'clicking #sky-modern-time stops propagation');
  assert.equal(worldClock.getState().speedScale, 4, 'first click on #sky-modern-time sets 4x speed');
  assert.equal(sky.timeId, 'dusk', 'clicking #sky-modern-time does not jump time phase');
  fireClick(skyModern);
  assert.equal(worldClock.getState().auto, false, 'second click on #sky-modern-time pauses time');
  fireClick(skyModern);
  assert.equal(worldClock.getState().auto, true, 'third click on #sky-modern-time resumes normal speed');
  assert.equal(worldClock.getState().speedScale, 1);

  // 3) Click #sky-weather-row cycles weather immediately & refreshes row title
  assert.equal(sky.weatherId, 'clear');
  assert.equal(fireClick(skyWeatherRow), true, 'clicking #sky-weather-row stops propagation');
  assert.equal(sky.weatherId, 'mist', 'clicking #sky-weather-row cycles weather');
  assert.equal(skyWeatherVal.textContent, '雾', '#sky-weather text updates immediately on click');
  assert.ok(skyWeatherRow.title.includes('雾'), '#sky-weather-row title updates with active weather');

  // 4) Click #sky-phenology-row cycles phenology across seasons
  assert.equal(phenology.getStats().phenologyId, 'spring');
  assert.equal(fireClick(phenRow), true, 'clicking #sky-phenology-row stops propagation');
  assert.equal(phenology.getStats().phenologyId, 'summer', 'clicking #sky-phenology-row cycles season');
  assert.equal(doc.getElementById('sky-phenology').textContent, '夏初');

  // 5) Click #sky-audio-row cycles audio mode (full -> soft -> mute)
  assert.equal(audioRow.classList.contains('is-muted'), false);
  assert.equal(fireClick(audioRow), true, 'clicking #sky-audio-row stops propagation');
  assert.equal(doc.getElementById('sky-audio').textContent, '轻音');
  fireClick(audioRow);
  assert.equal(doc.getElementById('sky-audio').textContent, '寂静');
  assert.equal(audioRow.classList.contains('is-muted'), true, 'mute mode sets is-muted class');

  // 6) ui-hidden and map-open block all 5 interactive #sky click targets
  body.classList.add('ui-hidden');
  fireClick(skyTimeRow);
  fireClick(skyWeatherRow);
  fireClick(skyModern);
  fireClick(phenRow);
  fireClick(audioRow);
  assert.equal(sky.timeId, 'dusk', 'ui-hidden blocks #sky-time-row click');
  assert.equal(sky.weatherId, 'mist', 'ui-hidden blocks #sky-weather-row click');
  assert.equal(worldClock.getState().speedScale, 1, 'ui-hidden blocks #sky-modern-time click');
  assert.equal(phenology.getStats().phenologyId, 'summer', 'ui-hidden blocks #sky-phenology-row click');
  assert.equal(doc.getElementById('sky-audio').textContent, '寂静', 'ui-hidden blocks #sky-audio-row click');
  body.classList.remove('ui-hidden');

  body.classList.add('map-open');
  fireClick(skyTimeRow);
  fireClick(skyWeatherRow);
  fireClick(skyModern);
  fireClick(phenRow);
  fireClick(audioRow);
  assert.equal(sky.timeId, 'dusk', 'map-open blocks #sky-time-row click');
  assert.equal(sky.weatherId, 'mist', 'map-open blocks #sky-weather-row click');
  assert.equal(phenology.getStats().phenologyId, 'summer', 'map-open blocks #sky-phenology-row click');
  body.classList.remove('map-open');

  // 7) Clean dispose removes all click listeners & injected nodes
  audioHud.dispose();
  phenology.dispose();
  worldClock.dispose();
  sky.dispose();
  assert.equal(doc.getElementById('sky-audio-row'), null, 'audioHud dispose removes injected row');
  assert.equal(doc.getElementById('audio-hud-styles'), null, 'audioHud dispose removes injected style');
  assert.equal(skyTimeRow.listeners.get('click')?.size ?? 0, 0, 'sky dispose removes #sky-time-row click listener');
  assert.equal(skyWeatherRow.listeners.get('click')?.size ?? 0, 0, 'sky dispose removes #sky-weather-row click listener');
  assert.equal(skyModern.listeners.get('click')?.size ?? 0, 0, 'worldClock dispose removes #sky-modern-time click listener');
  assert.equal(phenRow.listeners.get('click')?.size ?? 0, 0, 'phenology dispose removes #sky-phenology-row click listener');
  globalThis.document = prevDoc;
  globalThis.window = prevWin;
}

console.log(JSON.stringify({
  hudVisibility: 'PASS',
  contrastChecks: checks,
  minPrimaryContrast: Number(minPrimaryContrast.toFixed(2)),
  minSecondaryContrast: Number(minSecondaryContrast.toFixed(2))
}));
