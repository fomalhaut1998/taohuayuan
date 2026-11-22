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

const day = buildSky('?hour=day&weather=clear');
steps(day.sky, camera, 120);

// ---- 轮5：笔意云无缝 + 干笔 + 晨权重 ----
const frag = day.dome.material.fragmentShader;
const m = frag.match(/float noonCloudStroke\(([\s\S]*?)\n}/);
assert.ok(m, 'noonCloudStroke present');
const sig = m[1].slice(0, m[1].indexOf(')'));
assert.ok(/hx/.test(sig) && /hz/.test(sig) && !/\baz\b/.test(sig), 'noon stroke uses seamless horizontal coords, got: ' + sig);
const body = m[1].slice(m[1].indexOf(')') + 1);
function stroke(dy, hx, hz, t) {
  const helpers = {
    clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
    smoothstep: (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); },
    mix: (a, b, t) => a + (b - a) * t,
    cnoise: (v) => 0.5 + 0.5 * Math.sin(v.x * 1.3) * Math.cos(v.y * 0.7),
    noonNoise2: (x, y) => 0.5 + 0.5 * Math.sin(x * 1.3) * Math.cos(y * 0.7),
  };
  const js = body.replace(/\bfloat\b/g, 'let').replace(/noonNoise2\(/g, 'H.noonNoise2(').replace(/vec2\(([^)]*)\)/g, '({x:$1})') + '\n}';
  const fn = new Function('H', 'smoothstep', 'clamp', 'mix', 'dy', 'hx', 'hz', 't', 'p', js);
  return fn(helpers, helpers.smoothstep, helpers.clamp, helpers.mix, dy, hx, hz, t, { x: 1, y: 3.1, z: 16.0, w: 0.42 });
}
const e = 0.0015;
const sA = stroke(0.28, Math.cos(Math.PI - e), Math.sin(Math.PI - e), 7);
const sB = stroke(0.28, Math.cos(-Math.PI + e), Math.sin(-Math.PI + e), 7);
assert.ok(Math.abs(sA - sB) < 0.02, 'no azimuth wrap seam: ' + sA + ' vs ' + sB);
let hits = 0;
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  for (const dy of [0.2, 0.28, 0.36]) if (stroke(dy, Math.cos(a), Math.sin(a), 7) > 0.05) hits++;
}
assert.ok(hits >= 8, 'brush strokes cover the band, hits=' + hits);
assert.ok(/cnoise\(uv \* 0\.16/.test(frag), 'main deck domain warp bends parallel bands');
assert.ok(/cp \* vec2\(0\.9, 3\.2\)/.test(frag), 'main deck dry-brush grain');
assert.ok(/ux \* 2\.9/.test(frag), 'noon stroke dry-brush erosion');
assert.ok(!/atan\(spDir/.test(frag) && !/atan\(d\.z, d\.x\)/.test(frag), 'no atan wrap anywhere in dome');
const dawn = buildSky('?hour=dawn&weather=clear');
steps(dawn.sky, camera, 240);
const dawnAmt = dawn.U.uNoonCloud.value.x;
assert.ok(dawnAmt > 0.04 && dawnAmt < 0.16, 'dawn noon-cloud weight damped, got ' + dawnAmt);
const t0 = dawn.U.uCloudTime.value, a0 = dawn.U.uNoonCloud.value.x;
dawn.sky.update(0, camera);
assert.equal(dawn.U.uCloudTime.value, t0, 'dt=0 freezes cloud clock');
assert.equal(dawn.U.uNoonCloud.value.x, a0, 'dt=0 freezes noon weight');
console.log('check-brush-clouds: PASS seamDelta=' + Math.abs(sA - sB).toFixed(4) + ' hits=' + hits + ' dawnAmt=' + dawnAmt.toFixed(3));