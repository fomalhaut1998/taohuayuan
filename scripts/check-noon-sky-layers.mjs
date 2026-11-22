import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const landscape = JSON.parse(readFileSync(new URL('../src/data/ink-landscape.json', import.meta.url), 'utf8'));

const canvasContext = new Proxy({}, { get: () => () => canvasContext });
function classList() {
  const s = new Set();
  return {
    add: (...xs) => xs.forEach(x => s.add(x)),
    remove: (...xs) => xs.forEach(x => s.delete(x)),
    contains: x => s.has(x),
    toggle: (x, on) => { if (on === undefined) { s.has(x) ? s.delete(x) : s.add(x); } else if (on) s.add(x); else s.delete(x); }
  };
}
const nodes = new Map();
for (const id of ['sky-time', 'sky-weather', 'sky-toast']) nodes.set(id, { textContent: '', classList: classList() });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => canvasContext }),
  getElementById: id => nodes.get(id) || null,
  body: { classList: classList() }
};
globalThis.window = new EventTarget();
globalThis.window.location = { search: '?hour=day&weather=clear' };

const { createSky } = await import('../src/systems/sky.js');
const { createMountains } = await import('../src/world/terrain.js');

function makeScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(world.render.background);
  scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
  return scene;
}
const lights = {
  sun: new THREE.DirectionalLight('#FFF6E4', 1.1),
  hemi: new THREE.HemisphereLight('#F6EFDF', '#9AB57A', 1.3),
  fill: new THREE.DirectionalLight('#DDE8F2', 0.34)
};
const renderer = { getPixelRatio: () => 1 };
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 800);


function buildSky(search) {
  globalThis.window.location.search = search;
  const scene = makeScene();
  const sky = createSky(world.sky, scene, renderer, camera, { lights });
  const dome = scene.getObjectByName('sky-dome');
  return { sky, dome, U: dome.material.uniforms, scene };
}
function steps(sky, camera, n, dt = 1 / 30) { for (let i = 0; i < n; i++) sky.update(dt, camera); }

// ---- A. 正午横云 ----
const day = buildSky('?hour=day&weather=clear');
assert.ok(day.U.uNoonCloud && day.U.uNoonCloudColor, 'noon cloud stroke uniforms exist');
assert.ok(day.dome.material.fragmentShader.includes('noonCloudStroke'), 'dome fragment carries noon stroke layer');
steps(day.sky, camera, 120);
const dayAmt = day.U.uNoonCloud.value.x;
assert.ok(dayAmt > 0.6, 'noon stroke amount rises under clear day, amt=' + dayAmt);
const frozen = day.U.uNoonCloud.value.x;
steps(day.sky, camera, 6, 0);
assert.equal(day.U.uNoonCloud.value.x, frozen, 'dt=0 freezes noon cloud amount');
const night = buildSky('?hour=night&weather=clear');
steps(night.sky, camera, 120);
assert.ok(night.U.uNoonCloud.value.x < 0.05, 'night sky carries no noon strokes, amt=' + night.U.uNoonCloud.value.x);
const rainy = buildSky('?hour=day&weather=rain');
steps(rainy.sky, camera, 120);
assert.ok(rainy.U.uNoonCloud.value.x < dayAmt * 0.5, 'rain damps noon strokes, amt=' + rainy.U.uNoonCloud.value.x);

// oracle: pure stroke function, deterministic noise stub
const src = day.dome.material.fragmentShader;
const m = src.match(/float noonCloudStroke\(float dy, float hx, float hz, float t, vec4 p\) \{([\s\S]*?)\n\}/);
assert.ok(m, 'noonCloudStroke is a pure extractable scalar function');
const body = m[1].replace(/\bfloat\b/g, 'let');
const noonNoise2 = (x, y) => 0.5 + 0.5 * Math.sin(x * 1.3) * Math.cos(y * 0.7);
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const stroke = new Function('dy', 'hx', 'hz', 't', 'p', 'noonNoise2', 'smoothstep', body + '\nreturn stroke * band;');
const P = { x: 1, y: 3.1, z: 16.0, w: 0.42 };
const at = (dy, az) => stroke(dy, Math.cos(az), Math.sin(az), 0, P, noonNoise2, smoothstep);
let inBand = 0; for (let i = 0; i < 24; i++) { const az = i / 24 * Math.PI * 2; if (at(0.28, az) > 0.02) inBand++; }
assert.ok(inBand >= 4, 'strokes appear inside the noon elevation band, hits=' + inBand);
assert.equal(at(0.02, 0.4), 0, 'no strokes at the horizon veil');
assert.equal(at(0.8, 0.4), 0, 'no strokes at the zenith');
assert.equal(stroke(0.28, Math.cos(0.4), Math.sin(0.4), 0, { x: 0, y: 3.1, z: 16, w: 0.42 }, noonNoise2, smoothstep), 0, 'zero amount kills the layer');
const wide = at(0.28, 0.4);
const tall = stroke(0.28, Math.cos(0.4), Math.sin(0.4), 0, { x: 1, y: 3.1, z: 4.0, w: 0.42 }, noonNoise2, smoothstep);
assert.ok(Math.abs(wide - tall) > 1e-6, 'elevation frequency shapes horizontal streaks');

// ---- B. 远山三层色阶 ----
assert.ok(Array.isArray(landscape.mountains.noonTiers) && landscape.mountains.noonTiers.length === 3, 'three noon mountain tones configured');
const cfg = world.mountains;
const baseC = new THREE.Color(cfg.color), farC = new THREE.Color(cfg.colorFar), paperC = new THREE.Color(cfg.fadeColor);
const ks = [0.12, 0.50, 0.90];
const created = ks.map(k => { const c = baseC.clone().lerp(farC, k); c.lerp(paperC, cfg.fadeNear + k * (cfg.fadeFar - cfg.fadeNear)); return c; });
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const gap = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const cam = new THREE.PerspectiveCamera(); cam.position.set(30, 4, -140);
const mockSky = (timeId, rain) => ({ timeId, rainIntensity: rain, getAppearance: () => ({ fogColor: 'c9d8e2' }) });
function tiersAfter(timeId, rain, n) {
  const mo = createMountains(cfg);
  for (let i = 0; i < n; i++) mo.update(1 / 60, mockSky(timeId, rain), cam);
  const cols = mo.children.map(mesh => mesh.material.color.clone());
  mo.dispose();
  return cols;
}
const noonCols = tiersAfter('day', 0, 240);
for (let i = 0; i < 3; i++) assert.ok(gap(noonCols[i], created[i]) > 0.03, 'noon tier ' + i + ' leaves the flat paper fade');
assert.ok(lum(noonCols[0]) < lum(noonCols[1]) && lum(noonCols[1]) < lum(noonCols[2]), 'near ridge darker than far ridge at noon');
assert.ok(gap(noonCols[0], noonCols[1]) > 0.03 && gap(noonCols[1], noonCols[2]) > 0.03, 'three readable tonal steps');
const rainCols = tiersAfter('day', 1, 240);
assert.ok(gap(rainCols[0], rainCols[2]) < gap(noonCols[0], noonCols[2]), 'rain flattens the tonal ladder');
const nightCols = tiersAfter('night', 0, 480);
for (let i = 0; i < 3; i++) assert.ok(gap(nightCols[i], created[i]) < 0.012, 'night returns to accepted base tones, tier ' + i);
const mo = createMountains(cfg);
for (let i = 0; i < 120; i++) mo.update(1 / 60, mockSky('day', 0), cam);
const held = mo.children.map(mesh => mesh.material.color.getHexString()).join(',');
for (let i = 0; i < 5; i++) mo.update(0, mockSky('night', 1), cam);
assert.equal(mo.children.map(mesh => mesh.material.color.getHexString()).join(','), held, 'dt=0 freezes tier tones');
mo.dispose();
mo.update(1 / 60, mockSky('day', 0), cam);
const terrainSrc = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
assert.ok(terrainSrc.includes('noonTiers') && terrainSrc.includes('noonAmt'), 'mountain noon ladder wired in createMountains');
console.log('check-noon-sky-layers: PASS dayAmt=' + dayAmt.toFixed(3) + ' bandHits=' + inBand + ' noonLum=' + noonCols.map(c => lum(c).toFixed(3)).join('/'));
