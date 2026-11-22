import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createSky } from '../src/systems/sky.js';
import { createSky as createLegacySky } from '../.visual-round4-baseline/src/systems/sky.js';
import { isSkyAppearanceMaterial } from '../src/systems/scene-appearance.js';
import { createTerrain, createRiverDistance, createMountains } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { createCliff } from '../src/world/cliff.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const before = JSON.stringify(world);
function freeze(o) { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(freeze); } }
freeze(world);
const context = new Proxy({}, { get: () => () => context });
globalThis.document = { createElement: () => ({ getContext: () => context }), getElementById: () => null,
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } } };
globalThis.window = new EventTarget(); window.location = { search: '' };
const near = (a, b, label, eps = 1e-9) => assert(Math.abs(a - b) < eps, label + ': ' + a + ' vs ' + b);
function colorNear(a, b, label) { for (const n of ['r', 'g', 'b']) near(a[n], b[n], label + '.' + n); }
function setup(factory) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(world.render.background);
  scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
  const bases = ['#FFFFFF', '#243C19', '#D37495'].map(c => new THREE.Color(c));
  const mats = bases.map(color => new THREE.MeshBasicMaterial({ color }));
  const lambert = new THREE.MeshLambertMaterial({ color: '#6F923E' });
  for (const mat of [...mats, lambert]) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), mat));
  const mountain = new THREE.Group(); mountain.name = 'mountains';
  const hill = new THREE.MeshBasicMaterial({ color: '#A8B5A0' });
  mountain.add(new THREE.Mesh(new THREE.BoxGeometry(), hill)); scene.add(mountain);
  const lights = { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), fill: new THREE.DirectionalLight() };
  const camera = new THREE.PerspectiveCamera(); camera.position.set(30, 4, -140);
  const sky = factory(world.sky, scene, { getPixelRatio: () => 1 }, camera, { lights }); sky.setAuto(false);
  return { scene, bases, mats, lambert, hill, lights, camera, sky, U: scene.getObjectByName('sky-dome').material.uniforms };
}
const actual = setup(createSky), legacy = setup(createLegacySky);
assert.equal(typeof actual.sky.getTwilightState, 'function', 'stable twilight API exists');
const state = actual.sky.getTwilightState(), direction = state.direction, color = state.color;
assert.deepEqual(Object.keys(state).sort(), ['amount', 'clock', 'color', 'dawn', 'direction', 'dusk']);
assert(direction.isVector3 && color.isColor);
function converge(env, time, weather = 'clear') {
  env.sky.setTime(time); env.sky.setWeather(weather);
  for (let i = 0; i < 400; i++) env.sky.update(.1, env.camera);
}
function stableState() {
  assert.equal(actual.sky.getTwilightState(), state); assert.equal(state.direction, direction); assert.equal(state.color, color);
  near(direction.length(), 1, 'normalized sunlight');
  colorNear(state.color, actual.lights.sun.color, 'linear actual sunlight color');
  assert(direction.distanceTo(actual.lights.sun.position.clone().normalize()) < 1e-10);
}
// Accepted day and original night, including weather-modified fog/hills and light.
for (const time of ['day', 'night']) for (const weather of world.sky.weatherOrder) {
  converge(actual, time, weather); converge(legacy, time, weather); stableState();
  near(state.amount, 0, time + ' extra light off'); near(state.dawn, 0, time + ' dawn off'); near(state.dusk, 0, time + ' dusk off');
  near(actual.sky.getAppearance().desaturation, 0, 'no round4 gray albedo');
  for (let i = 0; i < actual.mats.length; i++) colorNear(actual.mats[i].color, legacy.mats[i].color, time + '/' + weather + ' exact basic');
  colorNear(actual.lambert.color, legacy.lambert.color, time + ' saturated Lambert');
  colorNear(actual.hill.color, legacy.hill.color, time + '/' + weather + ' exact hill');
  for (const key of ['uTop', 'uBottom', 'uCloudColor', 'uGlow']) colorNear(actual.U[key].value, legacy.U[key].value, time + key);
  for (const name of ['sky-moon', 'sky-stars']) {
    const a = actual.scene.getObjectByName(name), b = legacy.scene.getObjectByName(name);
    assert.equal(a.visible, b.visible); colorNear(a.material.color || a.material.uniforms.uColor.value, b.material.color || b.material.uniforms.uColor.value, name);
    near(a.material.opacity ?? 1, b.material.opacity ?? 1, name + ' opacity');
    if (a.material.uniforms?.uOpacity) near(a.material.uniforms.uOpacity.value, b.material.uniforms.uOpacity.value, 'star opacity');
  }
  for (const key of ['sun', 'hemi', 'fill']) {
    colorNear(actual.lights[key].color, legacy.lights[key].color, time + key); near(actual.lights[key].intensity, legacy.lights[key].intensity, key + ' intensity');
  }
  if (time === 'night') near(actual.sky.getAppearance().night, 1, weather + ' independent legacyNight');
}
const observations = {};
for (const time of ['dawn', 'dusk']) {
  converge(actual, time); stableState();
  assert(state.amount > .65 && state[time] > .65, time + ' visible');
  const clearAmount = state.amount;
  observations[time] = { amount: state.amount, top: actual.U.uTop.value.getHexString(), bottom: actual.U.uBottom.value.getHexString(), direction: direction.toArray() };
  const sun = actual.scene.getObjectByName('sky-sun');
  assert(sun.visible && sun.material.opacity > .7 && sun.material.depthTest, 'readable sun with terrain depth preserved');
  assert(sun.position.clone().sub(actual.camera.position).normalize().distanceTo(direction) < 1e-10, 'sun shares actual light direction');
  for (const weather of ['mist', 'rain']) {
    converge(actual, time, weather); stableState();
    assert(state.amount < clearAmount * (weather === 'rain' ? .15 : .5), weather + ' suppresses added light');
    assert(sun.material.opacity < .4, weather + ' suppresses solar disc');
  }
}
assert.notDeepEqual(observations.dawn, observations.dusk);
converge(actual, 'night', 'rain');
const frozen = { ...state, direction: direction.clone(), color: color.clone(), cloudClock: actual.U.uCloudTime.value };
actual.sky.setTime('dawn'); actual.sky.setWeather('clear'); actual.sky.update(0, actual.camera);
near(state.amount, frozen.amount, 'dt0 twilight'); near(state.clock, frozen.clock, 'dt0 clock');
assert(direction.equals(frozen.direction) && color.equals(frozen.color));
assert.equal(actual.U.uCloudTime.value, frozen.cloudClock);
let previous = state.amount;
for (let i = 0; i < 90; i++) {
  actual.sky.update(.016, actual.camera);
  assert(state.amount >= previous && state.amount - previous < .04, 'smooth twilight transition'); previous = state.amount;
}
assert(state.amount > .1 && state.amount < 1);
converge(actual, 'night', 'rain');
const late = new THREE.MeshBasicMaterial({ color: '#D37495' }), lateBase = late.color.clone();
const lateMesh = new THREE.Mesh(new THREE.BoxGeometry(), late); actual.scene.add(lateMesh);
actual.sky.registerMaterials(lateMesh); assert(isSkyAppearanceMaterial(late));
const night = world.sky.times.night, rain = world.sky.weathers.rain;
colorNear(late.color, lateBase.clone().multiplyScalar(night.unlitScale * rain.unlit).lerp(new THREE.Color(night.unlitTint), night.unlitMix), 'late exact legacy night');
const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
late.onBeforeCompile(shader, null); near(shader.uniforms.uSkyDesaturation.value, 0, 'identity audit shader');
assert.equal(shader.vertexShader, THREE.ShaderLib.basic.vertexShader);
const source = actual.scene.getObjectByName('sky-dome').material.fragmentShader;
assert(source.includes('if (uTwilightAmount > 0.0)'), 'extra sky work gated away from accepted day/night');
assert(source.includes('twilightFacing') && source.includes('twilightBand') && source.includes('twilightCloud'), 'directional layered shader contract');
assert.equal(actual.scene.children.length, legacy.scene.children.length + 1, 'only the explicitly registered test mesh is extra; zero new sky draws');
assert.equal(JSON.stringify(world), before);
actual.sky.dispose(); legacy.sky.dispose();
assert(late.color.equals(lateBase)); assert.equal(isSkyAppearanceMaterial(late), false);
// CPU ray evidence only: terrain, cliff and camera-following mountain silhouettes.
// This does not claim tree/building clearance or substitute for real browser pixels.
const curve = createRiverCurve(world.stream.points), distance = createRiverDistance(sampleRiverSpine(curve, 160));
const terrain = createTerrain(world.terrain, distance, { road: world.village.road, pond: world.terrain.pond });
const cliff = createCliff(world.cliff, terrain.field), mountains = createMountains(world.mountains);
const geometryScene = new THREE.Scene(); geometryScene.add(terrain.mesh, cliff.group, mountains);
const cameraViews = {};
for (const time of ['dawn', 'dusk']) {
  const solar = new THREE.Vector3(...world.sky.times[time].sunDir).normalize();
  const views = [];
  for (const [x, z] of [[30, -140], [24, -70], [36, -104], [20, -176], time === 'dawn' ? [-20, 80] : [30, 80]]) {
    for (const lift of [2, 6, 12, 20]) {
      const position = new THREE.Vector3(x, terrain.field.sample(x, z) + lift, z);
      mountains.position.set(x, 0, z); geometryScene.updateMatrixWorld(true);
      const hits = new THREE.Raycaster(position, solar, 0, world.sky.sun.distance).intersectObjects(geometryScene.children, true);
      if (!hits.length) { views.push({ position: position.toArray().map(n => +n.toFixed(3)), target: position.clone().addScaledVector(solar, 100).toArray().map(n => +n.toFixed(3)), lift, clear: 'terrain/cliff/mountains; other geometry unverified' }); break; }
    }
  }
  cameraViews[time] = views;
}
geometryScene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
console.log(JSON.stringify({ softTwilight: true, exactPreRound4Night: world.sky.weatherOrder, exactAcceptedDay: true,
  stableState: true, dtZero: true, noNewSkyDraws: true, observations, cameraViews, gpuPixels: false }));
