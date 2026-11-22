import assert from 'node:assert/strict';
import { assertStreamBehavior } from './stream-behavior-contract.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createTwilightWater } from '../src/systems/twilight-water.js';
import { installSkyAppearance, isSkyAppearanceMaterial } from '../src/systems/scene-appearance.js';
import { createStream } from '../src/world/stream.js';

// These checks exercise real Three Lambert source with a mock compiler and a
// numeric translation of the injected scalar GLSL. They do NOT prove GPU pixels.
const near = (a, b, message) => assert(Math.abs(a - b) < 1e-10, message);
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
await assertStreamBehavior('.visual-round5-baseline/src/world/stream.js');
const context = new Proxy({}, { get: () => () => context });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const stream = createStream(world.stream, world.terrain,
  new THREE.LineCurve3(new THREE.Vector3(-30, 0, 0), new THREE.Vector3(30, 0, 0)));
const mesh = stream.mesh;
const material = mesh.material;
const initial = {
  geometry: mesh.geometry, positions: mesh.geometry.attributes.position.array.slice(),
  normals: mesh.geometry.attributes.normal.array.slice(), uvs: mesh.geometry.attributes.uv.array.slice(),
  color: material.color.clone(), map: material.map, opacity: material.opacity,
  transparent: material.transparent, depthWrite: material.depthWrite, side: material.side,
  surfaceY: stream.surfaceY, userData: JSON.stringify(material.userData),
};
const originalHook = material.onBeforeCompile, originalKey = material.customProgramCacheKey;
const appearanceUniform = { value: 0.2 };
const restoreAppearance = installSkyAppearance(material, appearanceUniform);
const appearanceHook = material.onBeforeCompile, appearanceKey = material.customProgramCacheKey;
const baseKey = appearanceKey.call(material);
let getterCalls = 0;
const state = { amount: 1, dawn: 0, dusk: 1,
  direction: new THREE.Vector3(1, 0.12, 0).normalize(),
  color: new THREE.Color().setRGB(1, 0.55, 0.22), clock: 100 };
const sky = { getTwilightState() { getterCalls++; return state; } };
const water = createTwilightWater(mesh, sky);
const installedVersion = material.version;
for (const name of ['update', 'dispose', 'getStats']) assert.equal(typeof water[name], 'function');
assert.equal(water.getStats().enabled, true);
assert.equal(material.customProgramCacheKey(), baseKey + '|twilight-water-v1');
assert.equal(material.customProgramCacheKey(), material.customProgramCacheKey(), 'stable key, no recursion');
assert.equal(isSkyAppearanceMaterial(material), false, 'no forged static audit eligibility');
assert.equal(material.transparent, true, 'water naturally stays excluded from opaque static batches');
function compile(mat = material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  mat.onBeforeCompile(shader, null);
  return shader;
}
const shader = compile();
assert.equal(shader.uniforms.uSkyDesaturation, appearanceUniform, 'appearance hook composed first');
assert(shader.fragmentShader.includes('uSkyDesaturation'));
assert(shader.fragmentShader.includes('outgoingLight += uTwilightWaterColor'));
assert(shader.fragmentShader.indexOf('outgoingLight +=') < shader.fragmentShader.indexOf('#include <opaque_fragment>'));
assert(shader.fragmentShader.includes('if (uTwilightWaterAmount > 0.0)'), 'zero amount bypasses all additive math');
assert.equal(shader.vertexShader.replace('varying vec3 vTwilightWaterPosition;\n', '')
  .replace('\nvTwilightWaterPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;', ''),
  THREE.ShaderLib.lambert.vertexShader, 'vertex projection is byte-identical after stripping varying assignment');
const uniforms = shader.uniforms;
const directionRef = uniforms.uTwilightWaterDirection.value;
const colorRef = uniforms.uTwilightWaterColor.value;
const amountRef = uniforms.uTwilightWaterAmount;
// Compile the ACTUAL injected pure scalar GLSL function into a JS oracle. There
// is no independently duplicated gain formula which could drift from the shader.
const gainSource = shader.fragmentShader.match(/float twilightWaterGain\(vec3 p, vec3 eye, vec3 sun, float clock\) \{([\s\S]*?)\n\}/);
assert(gainSource, 'actual scalar gain function is available for numerical checks');
const gainBody = gainSource[1].replace(/\bfloat\b/g, 'let');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gain = new Function('p', 'eye', 'sun', 'clock', 'sqrt', 'max', 'min', 'sin', 'cos', 'pow', 'clamp', 'smoothstep', gainBody);
const evaluate = (p, eye, sun = directionRef, clock = uniforms.uTwilightWaterClock.value) =>
  gain(p, eye, sun, clock, Math.sqrt, Math.max, Math.min, Math.sin, Math.cos, Math.pow, clamp, smoothstep);
const position = new THREE.Vector3();
const facingEye = new THREE.Vector3(-10, 1.2, 0);
let peak = 0, trough = Infinity;
for (let z = -5; z <= 5; z += 0.13) for (let x = -3; x <= 3; x += 0.17) {
  const g = evaluate(new THREE.Vector3(x, 0, z), facingEye);
  assert(Number.isFinite(g) && g >= 0 && g <= 0.18 + 1e-12, 'finite bounded additive gain');
  peak = Math.max(peak, g); trough = Math.min(trough, g);
}
assert(peak > 0.04, 'sun-facing ripples contain readable glints');
assert(trough < peak * 0.01, 'spatial variation prevents uniform gold repaint');
assert.equal(evaluate(position, new THREE.Vector3(10, 1.2, 0)), 0, 'sun behind viewer rejects highlights');
assert.equal(evaluate(position, facingEye, new THREE.Vector3(1, -0.01, 0).normalize()), 0, 'below-horizon sun rejected');
for (const eye of [position, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 10, 0)]) {
  for (const sun of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 1e-12, 0)])
    assert(Number.isFinite(evaluate(position, eye, sun)), 'surface/grazing/vertical cases never produce NaN');
}
function contribution(p, eye) {
  const a = amountRef.value;
  if (a <= 0) return [0, 0, 0];
  const g = evaluate(p, eye) * a;
  return [colorRef.r * g, colorRef.g * g, colorRef.b * g];
}
water.update(0.05);
near(uniforms.uTwilightWaterClock.value, 0.05, 'own ripple clock advances by dt');
const oldClock = uniforms.uTwilightWaterClock.value;
state.clock = 9999;
water.update(0);
assert.equal(uniforms.uTwilightWaterClock.value, oldClock, 'dt0 freezes despite sky clock changes');
for (const dt of [NaN, Infinity, -1, undefined]) { water.update(dt); assert.equal(uniforms.uTwilightWaterClock.value, oldClock); }
water.update(1000);
near(uniforms.uTwilightWaterClock.value, oldClock + 0.1, 'large finite dt clamped');
const full = contribution(new THREE.Vector3(0.3, 0, 0.2), facingEye);
assert(full.some(v => v > 0), 'weather attenuation sample has actual positive light');
state.amount = 0.2; water.update(0);
const rainy = contribution(new THREE.Vector3(0.3, 0, 0.2), facingEye);
full.forEach((v, i) => near(rainy[i], v * 0.2, 'weather-attenuated sky amount propagated linearly'));
for (const a of [0, -1, NaN, Infinity]) { state.amount = a; water.update(0); assert.deepEqual(contribution(position, facingEye), [0, 0, 0]); }
state.amount = 1;
state.direction.set(NaN, 0, 0); water.update(0); assert.equal(amountRef.value, 0);
state.direction.set(0, 0, 0); water.update(0); assert.equal(amountRef.value, 0);
state.direction.set(8, 1, 0); state.color.r = NaN; water.update(0); assert.equal(amountRef.value, 0);
state.color.setRGB(5, -1, 0.3); water.update(0);
near(directionRef.length(), 1, 'direction defensively normalized');
assert.deepEqual(colorRef.toArray(), [1, 0, 0.3], 'linear color bounded without a color-space conversion');
sky.disabled = true; water.update(0); assert.equal(amountRef.value, 0); delete sky.disabled;
sky.enabled = false; water.update(0); assert.equal(amountRef.value, 0); delete sky.enabled;
water.update(0);
assert.equal(uniforms.uTwilightWaterDirection.value, directionRef);
assert.equal(uniforms.uTwilightWaterColor.value, colorRef);
assert.equal(uniforms.uTwilightWaterAmount, amountRef);
assert.equal(compile().uniforms.uTwilightWaterClock, uniforms.uTwilightWaterClock, 'recompiles retain live uniforms');
assert.equal(material.customProgramCacheKey(), baseKey + '|twilight-water-v1', 'state changes never affect cache key');
assert(getterCalls > 5, 'reads current stable sky state on updates');
assert.equal(mesh.geometry, initial.geometry);
for (const [attribute, snapshot] of [['position', initial.positions], ['normal', initial.normals], ['uv', initial.uvs]])
  assert.deepEqual(mesh.geometry.attributes[attribute].array, snapshot, attribute + ' untouched');
for (const key of ['map', 'opacity', 'transparent', 'depthWrite', 'side']) assert.equal(material[key], initial[key], key + ' untouched');
assert(material.color.equals(initial.color));
assert.equal(stream.surfaceY, initial.surfaceY);
assert.equal(JSON.stringify(material.userData), initial.userData, 'no counterfeit audit userData');
assert.equal(material.version, installedVersion, 'updates never request shader recompilation');
const version = material.version;
water.dispose(); water.dispose();
assert.equal(material.onBeforeCompile, appearanceHook);
assert.equal(material.customProgramCacheKey, appearanceKey);
assert.equal(material.version, version + 1, 'idempotent real disposal invalidates program once');
assert.equal(amountRef.value, 0, 'already-compiled shaders become dark on disposal');
const finalClock = uniforms.uTwilightWaterClock.value;
water.update(1); assert.equal(uniforms.uTwilightWaterClock.value, finalClock);
assert.equal(water.getStats().disposed, true);
restoreAppearance();
assert.equal(material.onBeforeCompile, originalHook); assert.equal(material.customProgramCacheKey, originalKey);

// A later owner may retain our hook in its closure. Disposing must not overwrite
// its hook/key, and that closure must compile without resurrecting disposed light.
const laterMesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshLambertMaterial());
const laterWater = createTwilightWater(laterMesh, sky);
const ourHook = laterMesh.material.onBeforeCompile;
const laterHook = function(shader, renderer) { ourHook.call(this, shader, renderer); };
const laterKey = () => 'later-owner';
laterMesh.material.onBeforeCompile = laterHook; laterMesh.material.customProgramCacheKey = laterKey;
laterWater.dispose();
assert.equal(laterMesh.material.onBeforeCompile, laterHook); assert.equal(laterMesh.material.customProgramCacheKey, laterKey);
assert(!compile(laterMesh.material).uniforms.uTwilightWaterAmount, 'disposed captured hook does not re-install');
for (const candidate of [null, {}, { isMesh: true }, new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()), { isMesh: true, material: [material] }]) {
  const adapter = createTwilightWater(candidate, sky);
  assert.equal(adapter.getStats().enabled, false); adapter.update(0.1); adapter.dispose(); adapter.dispose();
}
for (const source of [null, {}, { getTwilightState: () => null }, { getTwilightState() { throw new Error('disabled'); } }]) {
  const safeMesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshLambertMaterial());
  const adapter = createTwilightWater(safeMesh, source); adapter.update(0.1);
  assert.equal(adapter.getStats().amount, 0); adapter.dispose();
}
const duplicateMesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshLambertMaterial());
const first = createTwilightWater(duplicateMesh, sky), firstHook = duplicateMesh.material.onBeforeCompile;
const second = createTwilightWater(duplicateMesh, sky);
assert.equal(second.getStats().enabled, false); second.dispose();
assert.equal(duplicateMesh.material.onBeforeCompile, firstHook, 'duplicate adapter cannot steal ownership');
first.dispose();
// The hook and cache key are independently owned: replacing just one must not
// prevent restoration of the other, or overwrite the later replacement.
for (const changed of ['hook', 'key']) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshLambertMaterial());
  const oldHook = m.material.onBeforeCompile, oldKey = m.material.customProgramCacheKey;
  const adapter = createTwilightWater(m, sky);
  const later = () => 'later';
  if (changed === 'hook') m.material.onBeforeCompile = later;
  else m.material.customProgramCacheKey = later;
  adapter.dispose();
  assert.equal(m.material.onBeforeCompile, changed === 'hook' ? later : oldHook);
  assert.equal(m.material.customProgramCacheKey, changed === 'key' ? later : oldKey);
}
console.log('PASS twilight water: Lambert hook composition, numeric GLSL oracle, bounds/direction/weather/zero, dt/cache/disposal, unchanged stream. NOT GPU proof.');
