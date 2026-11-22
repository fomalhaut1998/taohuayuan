import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createSky } from '../src/systems/sky.js';
import { installSkyAppearance, isSkyAppearanceMaterial } from '../src/systems/scene-appearance.js';
import { createStream } from '../src/world/stream.js';
import { createFlora } from '../src/world/flora.js';
import { createReeds } from '../src/world/reeds.js';
import { createTerrain } from '../src/world/terrain.js';
import { createPetals } from '../src/systems/petals.js';
import { createHouseLight } from '../src/systems/house-light.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const cfgBefore = JSON.stringify(world);
function freeze(o) { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; }
freeze(world);
const classes = new Set();
const context = new Proxy({}, { get: () => () => context });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  getElementById: () => null,
  body: { classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) } }
};
globalThis.window = new EventTarget();
window.location = { search: '' };
const near = (a, b, message, tolerance = 1e-8) => assert(Math.abs(a - b) < tolerance, message + ': ' + a + ' vs ' + b);
const luma = c => c.r * .2126 + c.g * .7152 + c.b * .0722;
const span = c => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
function compile(material) {
  const lib = material.isMeshBasicMaterial ? THREE.ShaderLib.basic : THREE.ShaderLib.lambert;
  const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  material.onBeforeCompile(shader, null);
  assert(shader.uniforms.uSkyDesaturation, 'live appearance uniform installed on actual material');
  assert(shader.fragmentShader.includes('dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))'));
  assert(shader.fragmentShader.includes('mix(diffuseColor.rgb, vec3(skyAlbedoLuma), uSkyDesaturation)'));
  assert(!shader.vertexShader.includes('uSkyDesaturation'), 'appearance is not vertex displacement');
  return shader;
}
// CPU oracle of the verified GLSL expression only; this is not a WebGL pixel test.
function albedo(shader, color) {
  const amount = shader.uniforms.uSkyDesaturation.value;
  return color.clone().lerp(new THREE.Color().setRGB(luma(color), luma(color), luma(color)), amount);
}

// Private brand cannot be forged, copied between materials, or retained after hook replacement.
const counterfeit = new THREE.MeshLambertMaterial();
counterfeit.userData.skyAppearance = { fragmentOnly: true };
assert.equal(isSkyAppearanceMaterial(counterfeit), false);
const audit = new THREE.MeshLambertMaterial();
const oldHook = audit.onBeforeCompile, oldKey = audit.customProgramCacheKey;
const restoreAudit = installSkyAppearance(audit, { value: .3 });
assert.equal(isSkyAppearanceMaterial(audit), true);
const auditHook = audit.onBeforeCompile;
counterfeit.onBeforeCompile = auditHook;
assert.equal(isSkyAppearanceMaterial(counterfeit), false, 'copying the branded hook is not sufficient');
audit.onBeforeCompile = () => {};
assert.equal(isSkyAppearanceMaterial(audit), false, 'replaced hook revokes static eligibility');
audit.onBeforeCompile = auditHook;
const auditShader = compile(audit);
assert.equal(auditShader.vertexShader, THREE.ShaderLib.lambert.vertexShader);
restoreAudit();
assert.equal(isSkyAppearanceMaterial(audit), false);
assert.equal(audit.onBeforeCompile, oldHook);
assert.equal(audit.customProgramCacheKey, oldKey);
const custom = new THREE.MeshLambertMaterial();
custom.onBeforeCompile = shader => { shader.vertexShader += '\n// original custom vertex'; };
const restoreCustom = installSkyAppearance(custom, { value: 0 });
assert.equal(isSkyAppearanceMaterial(custom), false, 'prior custom vertices remain unaudited');
assert(compile(custom).vertexShader.endsWith('// original custom vertex'));
restoreCustom();

const scene = new THREE.Scene();
scene.background = new THREE.Color(world.render.background);
scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
const camera = new THREE.PerspectiveCamera();
const curve = new THREE.LineCurve3(new THREE.Vector3(-100, 0, 0), new THREE.Vector3(100, 0, 0));
const field = { half: 400, sample: () => world.terrain.waterLevel + .2, slope: () => 0 };
// Real factories, original geometry/material paths: baked terrain, far/near trees,
// Basic instanced reeds with custom wind, translucent mapped stream and petals.
const terrain = createTerrain(world.terrain, () => 50, { road: world.village.road, pond: world.terrain.pond });
const flora = createFlora(world.flora, field, () => 50, curve, { x: 0, z: 0 }, x => x > 0);
const reeds = createReeds(world.reeds, field, curve, world.terrain);
const stream = createStream(world.stream, world.terrain, curve);
const petals = createPetals(world.petals, field);
const houseLight = createHouseLight([{ x: 0, z: 0, w: 5, d: 4, gy: 0, h: 4, rot: 0 }]);
const mountains = new THREE.Group(); mountains.name = 'mountains';
const hillMat = new THREE.MeshBasicMaterial({ color: '#A8B5A0', fog: false });
mountains.add(new THREE.Mesh(new THREE.BoxGeometry(), hillMat));
const ignored = new THREE.MeshBasicMaterial({ color: '#DDAA44' }); ignored.userData.skyIgnore = true;
scene.add(terrain.mesh, flora.group, reeds.group, stream.mesh, petals.mesh, houseLight.mesh, mountains,
  new THREE.Mesh(new THREE.BoxGeometry(), ignored));
const surfaces = [terrain.mesh, flora.group.children.find(m => m.name.startsWith('tree-far-')),
  flora.group.children.find(m => m.name.startsWith('tree-near-')), reeds.group.children[0], stream.mesh, petals.mesh, houseLight.mesh];
assert(surfaces.every(Boolean), 'actual major surfaces exist');
const bases = new Map(surfaces.map(mesh => [mesh.material, mesh.material.color.clone()]));
const originalHooks = new Map(surfaces.map(mesh => [mesh.material, mesh.material.onBeforeCompile]));
const originalKeys = new Map(surfaces.map(mesh => [mesh.material, mesh.material.customProgramCacheKey]));
const geometryBefore = surfaces.map(mesh => ({
  positions: mesh.geometry.attributes.position.array.slice(), colors: mesh.geometry.attributes.color?.array.slice(),
  instances: mesh.instanceMatrix?.array.slice(), tints: mesh.instanceColor?.array.slice()
}));
const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), fill: new THREE.DirectionalLight() };
scene.add(lights.sun, lights.hemi, lights.fill);
let weatherState, previousWeatherState, weatherRain;
const sky = createSky(world.sky, scene, { getPixelRatio: () => 1 }, camera, {
  lights, weather: { update(dt, cam, state) {
    if (previousWeatherState) assert.equal(state, previousWeatherState, 'reuse weather payload rather than allocate each frame');
    previousWeatherState = weatherState = state; weatherRain = state.rain;
  } }
});
sky.setAuto(false);
const U = scene.getObjectByName('sky-dome').material.uniforms;
const shaders = surfaces.map(mesh => compile(mesh.material));
const uniform = shaders[0].uniforms.uSkyDesaturation;
for (const shader of shaders) assert.equal(shader.uniforms.uSkyDesaturation, uniform, 'water/trees/ground/reeds share live smoothed value');
for (let i = 0; i < shaders.length; i++) {
  if (i !== 3) assert.equal(shaders[i].vertexShader, THREE.ShaderLib[surfaces[i].material.isMeshBasicMaterial ? 'basic' : 'lambert'].vertexShader, 'unchanged ordinary vertices');
}
assert(shaders[3].vertexShader.includes('uniform float uSway;'), 'original reeds wind hook preserved');
assert.equal(isSkyAppearanceMaterial(reeds.group.children[0].material), false);
assert.equal(isSkyAppearanceMaterial(terrain.mesh.material), true);
assert.equal(ignored.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
assert(shaders[6].fragmentShader.includes('#include <emissivemap_fragment>'), 'warm emissive path remains outside albedo change');
const materialVersions = surfaces.map(mesh => mesh.material.version);
const programKeys = surfaces.map(mesh => mesh.material.customProgramCacheKey());
const opacity = stream.mesh.material.opacity;
const warm = houseLight.mesh.material.emissive.clone();

assert.equal(U.uTop.value.getHexString(), '68a9e2');
assert.equal(U.uBottom.value.getHexString(), 'b6d9f0');
assert.equal(scene.fog.color.getHexString(), 'bad8e7');
assert.equal(uniform.value, 0, 'day albedo shader is identity');
for (const mesh of surfaces) assert(mesh.material.color.equals(bases.get(mesh.material)), 'day leaves all albedos unchanged');
const sample = new THREE.Color('#6F923E');
assert(albedo(shaders[0], sample).equals(sample));
const dayPetal = luma(petals.mesh.material.color);
const daySun = lights.sun.intensity;

// After initial registration update must not traverse the scene.
scene.traverse = () => { throw new Error('per-frame scene traversal'); };
function converge(time, weather = 'clear') {
  sky.setTime(time); sky.setWeather(weather);
  for (let i = 0; i < 240; i++) { sky.update(.05, camera); houseLight.update(.05, sky.timeId); }
  return sky.getAppearance();
}
const dusk = converge('dusk');
near(uniform.value, 0, 'dusk retains original saturated albedo');
assert(lights.sun.color.r > lights.sun.color.b, 'real dusk sun is warm');
assert(luma(petals.mesh.material.color) < dayPetal, 'actual unlit petals dim at dusk');
const duskPetal = luma(petals.mesh.material.color);
const duskSun = lights.sun.intensity;

const beforeTransition = sky.getAppearance().night;
sky.setTime('night');
assert.equal(sky.getAppearance().night, beforeTransition, 'changing a target does not snap material appearance');
assert.equal(uniform.value, 0, 'audited albedo remains identity');
for (let i = 0; i < 90; i++) {
  const before = sky.getAppearance().night, previousSun = lights.sun.intensity;
  sky.update(.016, camera);
  const legacyNight = sky.getAppearance().night;
  assert(legacyNight >= before && legacyNight - before < .03, 'independent legacy-night material continuity');
  assert.equal(uniform.value, 0, 'no gray desaturation during transition');
  assert(lights.sun.intensity <= previousSun && previousSun - lights.sun.intensity < .009, 'light continuity shares sky interpolation');
}
assert(sky.getAppearance().night > beforeTransition && sky.getAppearance().night < 1, 'real intermediate, not a label');
const night = converge('night');
near(uniform.value, 0, 'original night albedo convergence');
near(night.night, 1, 'independent legacy-night convergence');
assert(lights.sun.color.b > lights.sun.color.r, 'real moonlight is cool');
assert(lights.sun.intensity < duskSun && duskSun < daySun);
assert(luma(petals.mesh.material.color) < duskPetal && luma(petals.mesh.material.color) < dayPetal * .3);
const muted = albedo(shaders[0], sample);
near(luma(muted), luma(sample), 'identity albedo preserves luminance');
near(span(muted) / span(sample), 1, 'original night retains full albedo hue');
assert(houseLight.intensity > .99 && houseLight.mesh.material.emissive.equals(warm), 'warm windows survive moonlight');
assert.equal(stream.mesh.material.opacity, opacity, 'water transparency is not replaced by a filter');
assert(classes.has('is-night'));

// Changing targets while paused may update labels only: no clocks, lighting, weather or uniform advance.
const paused = { appearance: sky.getAppearance(), top: U.uTop.value.clone(), sun: lights.sun.intensity,
  cloudTime: U.uCloudTime.value, desaturation: uniform.value, color: petals.mesh.material.color.clone(), rain: sky.rainIntensity };
sky.setTime('day'); sky.setWeather('rain'); sky.update(0, camera);
assert.equal(uniform.value, paused.desaturation); assert.equal(U.uCloudTime.value, paused.cloudTime);
assert(U.uTop.value.equals(paused.top)); assert(petals.mesh.material.color.equals(paused.color));
assert.equal(lights.sun.intensity, paused.sun); assert.equal(sky.rainIntensity, paused.rain);
assert(classes.has('is-night'), 'night DOM flag reflects current appearance, not new target');
// Preserve existing weather ordering: old weight is sampled before it advances at frame end.
sky.update(.05, camera); assert.equal(weatherRain, 0);
sky.update(.05, camera); assert(weatherRain > 0);
const rainyNight = converge('night', 'rain');
assert(lights.sun.intensity < world.sky.times.night.sunIntensity);
near(uniform.value, 0, 'rain retains original saturated night');
near(rainyNight.night, 1, 'rain does not weaken independent legacy night');
assert(scene.fog.far < world.sky.times.night.fogFar);
assert.equal(weatherState.rainColor.isColor, true);

// Late roots register once, shade immediately, and share the already live uniform.
const late = new THREE.Group();
const lateMaterial = new THREE.MeshBasicMaterial({ color: '#48662B' });
const lateBase = lateMaterial.color.clone();
late.add(new THREE.Mesh(new THREE.BoxGeometry(), lateMaterial)); scene.add(late);
sky.registerMaterials(late);
const lateHook = lateMaterial.onBeforeCompile, lateColor = lateMaterial.color.clone();
sky.registerMaterials(late);
assert.equal(lateMaterial.onBeforeCompile, lateHook); assert(lateMaterial.color.equals(lateColor), 'registration never compounds tint');
assert.equal(compile(lateMaterial).uniforms.uSkyDesaturation, uniform);
assert(luma(lateColor) < luma(lateBase));
const back = converge('day');
near(uniform.value, 0, 'return-to-day convergence');
for (const mesh of surfaces) {
  const base = bases.get(mesh.material), actual = mesh.material.color;
  near(actual.r, base.r, 'no red tint drift'); near(actual.g, base.g, 'no green tint drift'); near(actual.b, base.b, 'no blue tint drift');
}
for (let i = 0; i < surfaces.length; i++) {
  const mesh = surfaces[i], before = geometryBefore[i];
  assert.deepEqual(mesh.geometry.attributes.position.array, before.positions);
  assert.deepEqual(mesh.geometry.attributes.color?.array, before.colors);
  assert.deepEqual(mesh.instanceMatrix?.array, before.instances);
  assert.deepEqual(mesh.instanceColor?.array, before.tints);
  assert.equal(mesh.material.version, materialVersions[i], 'no recompilation during transitions');
  assert.equal(mesh.material.customProgramCacheKey(), programKeys[i], 'stable program cache key');
}
assert.equal(JSON.stringify(world), cfgBefore, 'deep-frozen config unchanged');
sky.dispose();
for (const mesh of surfaces) {
  assert.equal(mesh.material.onBeforeCompile, originalHooks.get(mesh.material));
  assert.equal(mesh.material.customProgramCacheKey, originalKeys.get(mesh.material));
  assert.equal(isSkyAppearanceMaterial(mesh.material), false);
  assert(mesh.material.color.equals(bases.get(mesh.material)), 'dispose returns original material color');
}
assert(lateMaterial.color.equals(lateBase));
assert.equal(classes.has('is-night'), false);
console.log(JSON.stringify({ timeAppearance: true, realSurfaces: surfaces.map(m => m.name),
  desaturation: { day: back.desaturation, dusk: dusk.desaturation, night: night.desaturation, rainyNight: rainyNight.desaturation },
  dayIdentity: true, intermediateContinuity: true, dtZero: true, weatherOrdering: true,
  privateShaderAudit: true, stablePrograms: true, geometryUntouched: true, noPerFrameTraversal: true,
  gpuPixelValidation: false }));
