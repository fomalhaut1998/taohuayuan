import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createSky } from '../src/systems/sky.js';
import { createFloraWind } from '../src/systems/flora-wind.js';
import { createWaterSurface } from '../src/systems/twilight-water.js';
import { createSmoke } from '../src/systems/smoke.js';

// CPU-side lifecycle/uniform checks, not a browser/GPU pixel or heap benchmark.
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const context = new Proxy({}, { get: () => () => context });
const classes = new Set();
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  getElementById: () => null,
  body: { classList: { add: x => classes.add(x), remove: x => classes.delete(x),
    contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) } }
};
globalThis.window = new EventTarget();
window.location = { search: '' };
const scene = new THREE.Scene();
scene.background = new THREE.Color(world.render.background);
scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
const camera = new THREE.PerspectiveCamera();
const flora = new THREE.Group();
const tree = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
tree.name = 'tree-near-hotpath';
flora.add(tree);
const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 2, 2),
  new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.8 }));
const smoke = createSmoke(world.smoke, [{ x: 20, y: 5, z: -120 }]);
scene.add(flora, waterMesh, smoke.points);
const sky = createSky(world.sky, scene, { getPixelRatio: () => 1 }, camera);
assert.equal(typeof sky.getAppearanceState, 'function', 'allocation-free borrowed appearance API');
const view = sky.getAppearanceState();
assert.equal(view, sky.getAppearanceState(), 'one stable view');
assert(Object.isFrozen(view), 'borrowed view fields are read-only');
assert(view.skyTop.isColor && view.skyBottom.isColor && view.fogColor.isColor, 'linear Colors');
const topRef = view.skyTop;
const horizonRef = view.skyBottom;
const legacy = sky.getAppearance();
assert.notEqual(legacy, sky.getAppearance(), 'legacy snapshot stays independent');
assert.equal(legacy.skyTop, view.skyTop.getHexString());
assert.equal(legacy.skyBottom, view.skyBottom.getHexString());
assert.equal(legacy.fogColor, view.fogColor.getHexString());
let snapshotCalls = 0, statsCalls = 0, borrowedCalls = 0;
const originalSnapshot = sky.getAppearance;
const originalStats = sky.getStats;
const originalBorrow = sky.getAppearanceState;
sky.getAppearance = function () { snapshotCalls++; return originalSnapshot.call(this); };
sky.getStats = function () { statsCalls++; return originalStats.call(this); };
sky.getAppearanceState = function () { borrowedCalls++; return originalBorrow.call(this); };
const wind = createFloraWind({ flora, sky });
const water = createWaterSurface(waterMesh, sky, { kind: 'pond' });
function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader, null);
  return shader;
}
const treeShader = compile(tree.material);
const waterShader = compile(waterMesh.material);
const materialSet = new Set();
scene.traverse(o => {
  for (const material of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
    materialSet.add(material);
  }
});
const materials = [...materialSet];
const versions = materials.map(m => m.version);
const keys = materials.map(m => m.customProgramCacheKey());
function resources() {
  let nodes = 0;
  const geometries = new Set(), mats = new Set(), textures = new Set();
  scene.traverse(o => {
    nodes++;
    if (o.geometry) geometries.add(o.geometry);
    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of list) {
      mats.add(mat);
      if (mat.map) textures.add(mat.map);
      for (const uniform of Object.values(mat.uniforms || {})) {
        if (uniform.value?.isTexture) textures.add(uniform.value);
      }
    }
  });
  return { nodes, geometries: geometries.size, materials: mats.size, textures: textures.size };
}
const before = resources();
const waterUniforms = waterShader.uniforms;
const waterTop = waterUniforms.uInkSkyTop.value;
const waterHorizon = waterUniforms.uInkSkyHorizon.value;
const windUniform = treeShader.uniforms.uFloraWindTime;
snapshotCalls = statsCalls = borrowedCalls = 0;
let hexCalls = 0;
const originalHex = THREE.Color.prototype.getHexString;
THREE.Color.prototype.getHexString = function (...args) {
  hexCalls++;
  return originalHex.apply(this, args);
};
const frames = 10 * 60 * 60;
for (let i = 0; i < frames; i++) {
  if (i % 1800 === 0) {
    sky.setTime(world.sky.order[(i / 1800) % world.sky.order.length]);
    sky.setWeather(world.sky.weatherOrder[(i / 1800) % world.sky.weatherOrder.length]);
  }
  sky.update(1 / 60, camera);
  wind.update(1 / 60, i / 60);
  water.update(1 / 60);
  smoke.setWeather(sky);
  smoke.update(1 / 60, i / 60);
  if (i % 1800 === 0) {
    assert.equal(sky.getAppearanceState(), view);
    assert.equal(view.skyTop, topRef);
    assert.equal(view.skyBottom, horizonRef);
    assert(waterTop.equals(view.skyTop), 'live linear top copied without stale cache');
    assert(waterHorizon.equals(view.skyBottom), 'live linear horizon copied during transitions');
    assert.equal(view.timeId, sky.timeId);
    assert.deepEqual(resources(), before, 'bounded scene resources after every phase/weather change');
  }
}
THREE.Color.prototype.getHexString = originalHex;
assert.equal(hexCalls, 0, 'no 8-bit hex serialization in 36,000 environment frames');
assert.equal(snapshotCalls, 0, 'no debug hex snapshots in 36,000 environment frames');
assert.equal(statsCalls, 0, 'no debug stats in environment frames');
assert.equal(borrowedCalls, frames + frames / 1800, 'one borrowed read per water frame plus explicit checks');
assert.deepEqual(materials.map(m => m.version), versions, 'no material recompilation requests');
assert.deepEqual(materials.map(m => m.customProgramCacheKey()), keys, 'stable program keys');
assert.equal(wind.getStats().compileCount, 1);
assert.equal(water.getStats().compileCount, 1);
assert.equal(waterUniforms.uInkSkyTop.value, waterTop, 'reuse water uniform Color');
assert.equal(waterUniforms.uInkSkyHorizon.value, waterHorizon);
assert.notEqual(waterTop, view.skyTop, 'consumers cannot mutate the borrowed sky through uniforms');
const skyClock = sky.getTwilightState().clock;
const waterClock = water.getStats().clock;
const inkClock = water.getStats().inkClock;
const windClock = windUniform.value;
const smokeAttributes = Object.entries(smoke.points.geometry.attributes).map(([name, attr]) =>
  ({ name, version: attr.version, array: attr.array.slice() }));
sky.update(0, camera); wind.update(0); water.update(0); smoke.update(0, 999999);
assert.equal(sky.getTwilightState().clock, skyClock, 'dt=0 freezes sky');
assert.equal(water.getStats().clock, waterClock, 'dt=0 freezes twilight water');
assert.equal(water.getStats().inkClock, inkClock, 'dt=0 freezes ink water');
assert.equal(windUniform.value, windClock, 'dt=0 freezes wind');
for (const { name, version, array } of smokeAttributes) {
  assert.equal(smoke.points.geometry.attributes[name].version, version, 'dt=0 leaves smoke upload versions alone');
  assert.deepEqual(smoke.points.geometry.attributes[name].array, array, 'dt=0 freezes smoke geometry');
}

// Old/custom sky providers remain supported; direct time/rain fields avoid snapshots.
let fallbackCalls = 0;
const fallbackSky = { wind: 1, windX: 1, windZ: 0,
  getAppearance() { fallbackCalls++; return { timeId: 'dusk', rainIntensity: 0.5,
    night: 0.25, skyTop: '123456', skyBottom: '654321' }; } };
const fallbackWind = createFloraWind({ sky: fallbackSky });
const fallbackMesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshLambertMaterial());
const fallbackWater = createWaterSurface(fallbackMesh, fallbackSky, { kind: 'pond' });
const fallbackShader = compile(fallbackMesh.material);
fallbackCalls = 0;
fallbackWind.update(0); fallbackWater.update(0);
assert.equal(fallbackCalls, 2, 'old sky snapshots remain a lazy compatibility fallback');
assert(fallbackShader.uniforms.uInkSkyTop.value.equals(new THREE.Color('#123456')));
assert(fallbackShader.uniforms.uInkSkyHorizon.value.equals(new THREE.Color('#654321')));
assert.equal(fallbackWind.getStats().translucency, 0.58 * (1 - 0.5 * 0.65));
fallbackSky.timeId = 'day'; fallbackSky.rainIntensity = 0;
fallbackCalls = 0;
fallbackWind.update(0);
assert.equal(fallbackCalls, 0, 'direct fields take precedence without calling debug API');
assert.equal(fallbackWind.getStats().translucency, 0.34);
fallbackWind.dispose(); fallbackWater.dispose();
fallbackMesh.geometry.dispose(); fallbackMesh.material.dispose();
// Compare incomplete custom-provider fallback against the original effective
// weather truth table, including direct nonmist + legacy mist OR semantics.
const oracleSmoke = createSmoke(world.smoke, [{ x: 20, y: 5, z: -120 }]);
const actualSmoke = createSmoke(world.smoke, [{ x: 20, y: 5, z: -120 }]);
let smokeCases = 0;
for (const directTime of [undefined, '', null, 'day', 'dusk', 'night']) {
  for (const directWeather of [undefined, '', null, 'clear', 'mist']) {
    if (directTime && directWeather) continue; // Complete providers deliberately skip snapshots.
    for (const app of [null, { timeId: 'dawn', weatherId: 'mist' }, { timeId: 'night', weatherId: 'clear' }]) {
      for (const mist of [undefined, null, 0, -1, NaN, Infinity, 0.25, 2, '0.4', 'invalid']) {
        for (const rain of [0, 0.2, 0.35, 0.9]) {
          let calls = 0;
          const provider = { timeId: directTime, weatherId: directWeather, mist,
            rainIntensity: rain, windX: 0.3, windZ: -0.2,
            getAppearance() { calls++; return app; } };
          const rawMist = Number(mist);
          const expectedMist = Number.isFinite(rawMist) && rawMist > 0 ? Math.min(1, rawMist)
            : (directWeather === 'mist' || app?.weatherId === 'mist' ? 1 : 0);
          oracleSmoke.setWeather({ timeId: directTime || app?.timeId || 'day',
            weatherId: 'clear', mist: expectedMist, rainIntensity: rain, windX: 0.3, windZ: -0.2 });
          actualSmoke.setWeather(provider);
          assert.equal(calls, 1, 'incomplete adapters retain one legacy fallback call');
          actualSmoke.update(1 / 60); oracleSmoke.update(1 / 60);
          assert.deepEqual(actualSmoke.getStats(), oracleSmoke.getStats(), 'legacy smoke weather stats');
          assert(actualSmoke.points.material.uniforms.uColor.value.equals(
            oracleSmoke.points.material.uniforms.uColor.value), 'identical legacy smoke linear color');
          for (const [name, attr] of Object.entries(actualSmoke.points.geometry.attributes)) {
            assert.deepEqual(attr.array, oracleSmoke.points.geometry.attributes[name].array,
              'identical legacy smoke particle positions, sizes, alphas and progress');
          }
          smokeCases++;
        }
      }
    }
  }
}
// Direct IDs are authoritative for complete adapters; no debug method is consulted.
actualSmoke.setWeather({ timeId: 'dusk', weatherId: 'clear', mist: 0,
  getAppearance() { throw new Error('complete smoke provider must not snapshot'); } });
assert.equal(actualSmoke.getStats().timeId, 'dusk');
assert.equal(actualSmoke.getStats().inversion, 0.42);
for (const system of [smoke, actualSmoke, oracleSmoke]) {
  system.points.geometry.dispose(); system.points.material.dispose();
}
console.log('Smoke hotpath: ' + smokeCases + ' legacy fallback cases preserve exact stats, color and all geometry attributes.');
water.dispose(); wind.dispose(); sky.dispose();
tree.geometry.dispose(); tree.material.dispose();
waterMesh.geometry.dispose(); waterMesh.material.dispose();
console.log('Environment hotpath: 600 simulated seconds / 36,000 frames; zero debug snapshots/stats; stable resources, versions, keys, compile counts; legacy fallback and dt=0 passed.');
