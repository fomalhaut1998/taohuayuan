import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createMap } from '../src/systems/map.js';
import { projectionFor } from '../src/systems/mapdraw.js';
import { createMapTimeTheme, mapTimePalette, mapTimeWeights, mixMapColor } from '../src/systems/map-time-theme.js';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
const mapExpansion = JSON.parse(readFileSync(new URL('../src/data/map-expansion.json', import.meta.url)));
const original = JSON.stringify(world);
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
freeze(world);
const cfg = world.map;
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function luminance(hex) { return channels(hex).map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
let minTextContrast = Infinity, minSealContrast = Infinity;
let samples = 0;
for (const from of ['day', 'dawn', 'dusk', 'night']) for (const to of ['day', 'dawn', 'dusk', 'night']) {
  const theme = createMapTimeTheme(cfg.palette);
  theme.setTarget(from); for (let i = 0; i < 480; i++) theme.update(1 / 60);
  const before = theme.palette;
  theme.setTarget(to, 100, 'rain');
  assert.deepEqual(theme.palette, before, 'setter must not advance dt');
  let previous = channels(theme.palette.paper);
  for (let i = 0; i < 480; i++) {
    theme.update(1 / 60);
    const p = theme.palette, next = channels(p.paper);
    assert.ok(next.every((v, j) => Math.abs(v - previous[j]) <= 3), 'no visible palette jump');
    previous = next;
    minTextContrast = Math.min(minTextContrast, contrast(mixMapColor(p.ink, p.paper, 0.2), p.paper));
    minSealContrast = Math.min(minSealContrast, contrast(mixMapColor(p.seal, p.ink, 0.12), p.paper));
    assert.ok(contrast(p.ink, p.paper) >= 7, 'crisp ink on paper');
    assert.ok(contrast(mixMapColor(p.ink, p.paper, 0.2), p.paper) >= 4.5, 'muted sidebar text AA');
    assert.ok(contrast(mixMapColor(p.seal, p.ink, 0.12), p.paper) >= 4.5, 'destination/seal text AA');
    assert.ok(Math.abs(theme.weights.reduce((a, b) => a + b) - 1) < 1e-12);
    samples++;
  }
  assert.deepEqual(Object.fromEntries(Object.entries(theme.palette).map(([k, v]) => [k, v.toLowerCase()])), Object.fromEntries(Object.entries(mapTimePalette(cfg.palette, to)).map(([k, v]) => [k, v.toLowerCase()])), to + ' exact endpoint');
}
const invalid = createMapTimeTheme(cfg.palette);
assert.deepEqual(invalid.palette, cfg.palette, 'old cfg default day untouched');
invalid.setTarget('unknown'); assert.deepEqual(invalid.getStats().target, [1, 0, 0]);
invalid.setTarget('night');
for (const dt of [0, -1, NaN, Infinity, undefined]) assert.equal(invalid.update(dt), false);
const thirty = createMapTimeTheme(cfg.palette), sixty = createMapTimeTheme(cfg.palette);
thirty.setTarget('night'); sixty.setTarget('night');
for (let i = 0; i < 30; i++) thirty.update(1 / 30);
for (let i = 0; i < 60; i++) sixty.update(1 / 60);
assert.ok(thirty.weights.every((v, i) => Math.abs(v - sixty.weights[i]) < 1e-12), 'frame-rate-independent sky easing');
assert.deepEqual(mapTimeWeights('dawn'), [0.72, 0.28, 0]);

// Read no implementation source and do not mock paintBase: execute its actual
// paper/relief/contours/river/fields/buildings pipeline against a recording canvas.
const canvases = [];
const geometryMethods = new Set(['moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'bezierCurveTo', 'quadraticCurveTo', 'strokeRect']);
class RecordingContext {
  constructor(canvas) { this.canvas = canvas; this.globalAlpha = 1; this.fillStyle = '#000000'; this.strokeStyle = '#000000'; this.stack = []; this.images = []; this.text = []; this.counts = {}; this.geometry = createHash('sha256'); this.firstPaper = null; this.styles = new Set(); }
  save() { this.stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle }); }
  restore() { Object.assign(this, this.stack.pop()); }
  clearRect() { this.images = []; this.text = []; }
  fillRect() { if (!this.firstPaper) this.firstPaper = this.fillStyle; this.styles.add(this.fillStyle); }
  fill() { this.styles.add(this.fillStyle); }
  stroke() { this.styles.add(this.strokeStyle); this.counts.stroke = (this.counts.stroke || 0) + 1; }
  fillText(value) { this.text.push({ value, color: this.fillStyle, alpha: this.globalAlpha }); }
  drawImage(canvas, ...rect) { this.images.push({ canvas, rect, alpha: this.globalAlpha }); }
  createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createLinearGradient() { return { addColorStop() {} }; }
}
for (const name of ['beginPath', 'closePath', 'clip', 'setTransform', 'translate', 'rotate', 'scale', 'setLineDash', 'putImageData', 'strokeText', ...geometryMethods]) {
  RecordingContext.prototype[name] = function (...args) { this.counts[name] = (this.counts[name] || 0) + 1; if (geometryMethods.has(name)) this.geometry.update(name + JSON.stringify(args)); };
}
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.variables = new Map(); this.style = { setProperty: (k, v) => this.variables.set(k, v) }; this.clientWidth = 1200; this.clientHeight = 500; this.width = 300; this.height = 150;
    const classes = new Set(); this.classList = { add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k), toggle: (k, yes) => yes ? classes.add(k) : classes.delete(k) };
    if (tag === 'canvas') { this.context = new RecordingContext(this); canvases.push(this); }
  }
  appendChild(e) { this.children.push(e); }
  setAttribute(k, v) { this.attributes.set(k, v); }
  addEventListener(k, cb) { this.listeners.set(k, cb); }
  removeEventListener(k) { this.listeners.delete(k); }
  dispatch(k, event = {}) { this.listeners.get(k)?.({ target: this, preventDefault() {}, ...event }); }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
}
const ids = new Map(['map', 'map-sheet', 'map-canvas', 'map-close', 'map-list', 'map-region', 'map-dest', 'map-count', 'map-note-name', 'map-note-poem', 'map-dist', 'minimap', 'minimap-canvas', 'minimap-region', 'toast', 'toast-k', 'toast-name'].map(id => [id, new Element(id.includes('canvas') ? 'canvas' : 'div')]));
const windowListeners = new Map(), raf = new Map(); let rafId = 0;
globalThis.window = { devicePixelRatio: 1.5, addEventListener: (k, cb) => windowListeners.set(k, cb), removeEventListener: k => windowListeners.delete(k) };
globalThis.document = { getElementById: id => ids.get(id), createElement: tag => new Element(tag), body: new Element(), pointerLockElement: null };
globalThis.requestAnimationFrame = cb => { raf.set(++rafId, cb); return rafId; };
globalThis.cancelAnimationFrame = id => raf.delete(id);
globalThis.Path2D = class { moveTo() {} lineTo() {} };
function modalFrame() { const [id, cb] = raf.entries().next().value; raf.delete(id); cb(performance.now() + 1000); }
const spine = sampleRiverSpine(createRiverCurve(world.stream.points), 160);
const river = createRiverDistance(spine), height = createHeightFunction(world.terrain, river);
let fieldSamples = 0, visits = 0;
const player = { state: { x: -80, z: 280, yaw: 0 }, clearInput() {} };
const api = createMap(cfg, world, { player, field: { sample(x, z) { fieldSamples++; return height(x, z); } }, spine, spots: [[16, 3, 120]], marks: [], houseInfo: [], chimneys: [], visited: [cfg.pois[0].id], onVisit() { visits++; } });
api.update(1 / 60);
const miniCtx = ids.get('minimap-canvas').context, mapCtx = ids.get('map-canvas').context;
assert.equal(api.getStats().appearance.cacheRasters, 1);
assert.equal(api.getStats().appearance.baseBakes, 1);
assert.equal(miniCtx.images[0].canvas.context.firstPaper, cfg.palette.paper);
const initialDayRaster = miniCtx.images[0].canvas;
ids.get('map-list').children[0].children[0].dispatch('click');
const stableDest = api.getStats().dest;
assert.equal(stableDest, cfg.pois[0].id);
api.open(); modalFrame();
assert.equal(api.isOpen(), true);
assert.equal(mapCtx.images[0].canvas, initialDayRaster, 'main and mini share exact day raster');
const previous = api.getStats().appearance.weights;
api.setTimeAppearance('dusk', 9, 'rain');
assert.deepEqual(api.getStats().appearance.weights, previous, 'actual map setter does not advance');
api.update(1 / 60); modalFrame();
const duskWeights = api.getStats().appearance.weights;
assert.ok(Math.abs(duskWeights[1] - (1 - Math.exp(-(1 / 60) / world.sky.smoothing))) < 1e-12, 'exactly one dt');
assert.equal(api.getStats().appearance.cacheRasters, 2);
assert.equal(miniCtx.images.length, 2); assert.equal(mapCtx.images.length, 2);
for (let i = 0; i < 2; i++) { assert.equal(mapCtx.images[i].canvas, miniCtx.images[i].canvas); assert.equal(mapCtx.images[i].alpha, miniCtx.images[i].alpha); }
assert.equal(ids.get('map').variables.get('--map-paper'), ids.get('minimap').variables.get('--map-paper'));
assert.equal(mapCtx.text.find(t => t.value === cfg.pois[0].name).color, api.getStats().appearance.ink, 'live POI text uses current ink');
assert.equal(miniCtx.text.find(t => t.value === '北').color, api.getStats().appearance.ink);
assert.ok(mapCtx.text.every(t => t.alpha === 1), 'raster alpha restored before text and markers');
api.setTimeAppearance('night', 99, 'clear'); api.update(1 / 60); modalFrame();
assert.equal(api.getStats().appearance.cacheRasters, 3, 'rapid reversal can contain only three anchors');
assert.ok(api.getStats().appearance.weights.every(w => w > 0));
const expectedWeights = api.getStats().appearance.weights;
const effectiveWeights = mapCtx.images.map((image, i, all) => image.alpha * all.slice(i + 1).reduce((transmission, later) => transmission * (1 - later.alpha), 1));
assert.ok(effectiveWeights.every((w, i) => Math.abs(w - expectedWeights[i]) < 1e-12), 'actual source-over draws reproduce three-way pigment weights');
const frozenWeights = api.getStats().appearance.weights;
modalFrame(); modalFrame();
assert.deepEqual(api.getStats().appearance.weights, frozenWeights, 'modal RAF does not advance frozen world clock');
const trio = miniCtx.images.map(i => i.canvas);
assert.deepEqual(trio.map(c => c.context.firstPaper), ['day', 'dusk', 'night'].map(t => mapTimePalette(cfg.palette, t).paper));
assert.deepEqual(trio.map(c => c.context.geometry.copy().digest('hex')), Array(3).fill(trio[0].context.geometry.copy().digest('hex')), 'identical topology/texture seeds in every pigment');
assert.ok(trio.every(c => c.context.counts.stroke > 50 && c.context.styles.size > 20), 'actual detailed linework and color rendering executed');
const bakedSamples = fieldSamples;
for (let i = 0; i < 480; i++) { api.setTimeAppearance(i < 240 ? 'night' : 'dawn', 1 / 60, 'wind'); api.update(1 / 60); }
assert.equal(fieldSamples, bakedSamples, 'no terrain sampling/rebaking in transition frames');
assert.equal(api.getStats().appearance.baseBakes, 3);
assert.equal(api.getStats().dest, stableDest);
assert.equal(visits, 0, 'appearance never triggers visits');
assert.equal(api.getStats().visited, 1, 'saved visited preserved');
assert.ok(api.getStats().appearance.rasterBytes <= 28771200);
// Original hit testing, keyboard guards and mini opener remain connected.
const poi = cfg.pois[0], proj = projectionFor(mapExpansion.extent || cfg.extent, 1200, 500);
ids.get('map-canvas').dispatch('click', { clientX: proj.px(poi.x + (poi.badge?.[0] || 0), poi.z + (poi.badge?.[1] || 0)), clientY: proj.py(poi.x + (poi.badge?.[0] || 0), poi.z + (poi.badge?.[1] || 0)) });
assert.equal(api.getStats().dest, null, 'same projected destination click toggles it');
windowListeners.get('keydown')({ repeat: false, code: 'KeyM', target: { tagName: 'INPUT' } }); assert.ok(api.isOpen(), 'typing M stays guarded');
windowListeners.get('keydown')({ repeat: false, code: 'Escape' }); assert.equal(api.isOpen(), false);
ids.get('minimap').dispatch('click'); assert.ok(api.isOpen());
window.devicePixelRatio = 2; ids.get('map-sheet').clientWidth = 4000; ids.get('map-sheet').clientHeight = 1600;
api.resize();
assert.ok(trio.every(c => c.width === 0 && c.height === 0), 'old backing stores explicitly released');
const rw = api.getStats().appearance.rasterWidth;
assert.ok(rw >= 1800 && rw <= 2400, 'resized raster width stays within budget: ' + rw);
for (const id of ['day', 'dusk', 'night']) { api.setTimeAppearance(id); api.update(0.1); modalFrame(); }
const stats = api.getStats().appearance;
assert.ok(stats.cacheRasters <= 3); assert.ok(stats.rasterBytes <= 28771200); assert.ok(stats.baseBakes <= 6);
const finalSamples = fieldSamples;
for (let i = 0; i < 120; i++) api.update(1 / 60);
assert.equal(fieldSamples, finalSamples, 'no rebake after resize generation filled');
api.clearVisited(); assert.equal(api.getStats().visited, 0);
api.dispose(); assert.equal(api.getStats().appearance.rasterBytes, 0); assert.equal(raf.size, 0);
assert.equal(JSON.stringify(world), original, 'entire frozen legacy config unchanged');
const css = readFileSync(new URL('../src/map-time-theme.css', import.meta.url), 'utf8');
for (const selector of ['.map__poem', '.map__dist', '.map__hint', '.map__meta .k', '.minimap__cap', ':focus-visible']) assert.ok(css.includes(selector), 'paper secondary text/focus themed: ' + selector);
assert.ok(!/brightness|filter\s*:/.test(css), 'no global brightness filter');
console.log(JSON.stringify({ result: 'PASS', pureTransitionSamples: samples, minTextContrast: +minTextContrast.toFixed(2), minSealContrast: +minSealContrast.toFixed(2), actualPaintBaseBakes: stats.baseBakes, cacheCap: 3, maxRasterWidth: stats.rasterWidth, actualRasterBytes: stats.rasterBytes, fieldSamples, limits: 'Recording Canvas + scoped DOM; no real browser pixels/GPU/FPS measured. Weather accepted as metadata, time controls pigments.' }));
