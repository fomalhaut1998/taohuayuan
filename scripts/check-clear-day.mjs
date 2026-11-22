import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../.visual-round2-baseline/src/data/world.json', import.meta.url), 'utf8'));
const changedDayKeys = new Set([
  'skyTop', 'skyBottom', 'fogColor', 'cloudCover', 'cloudSoft', 'cloudShade',
  'fogNear', 'fogFar', 'hemiSky', 'glowAmount'
]);
for (const [key, value] of Object.entries(baseline.sky.times.day)) {
  if (!changedDayKeys.has(key)) assert.deepEqual(world.sky.times.day[key], value, 'preserve day.' + key);
}
const preservedSky = structuredClone(world.sky);
preservedSky.times.day = baseline.sky.times.day;
assert.deepEqual(preservedSky, baseline.sky, 'dawn/dusk/night/weather and timing settings remain unchanged');

const classList = () => ({ add() {}, remove() {}, toggle() {} });
const context = new Proxy({}, { get: () => () => context });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  getElementById: () => ({ textContent: '', classList: classList() }),
  body: { classList: classList() }
};
globalThis.window = new EventTarget();
window.location = { search: '?hour=day&weather=clear' };
const { createSky } = await import('../src/systems/sky.js');
const scene = new THREE.Scene();
scene.background = new THREE.Color(world.render.background);
scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
const camera = new THREE.PerspectiveCamera(62, 16 / 9, .1, 800);
const sky = createSky(world.sky, scene, { getPixelRatio: () => 1 }, camera, {
  lights: { sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight() }
});
sky.setAuto(false);
const uniforms = scene.getObjectByName('sky-dome').material.uniforms;
const rgb = color => color.clone().convertLinearToSRGB();
const blueGap = color => { const s = rgb(color); return s.b - s.r; };
function converge(time, weather) {
  sky.setTime(time);
  sky.setWeather(weather);
  for (let i = 0; i < 240; i++) sky.update(.12, camera);
  return {
    top: uniforms.uTop.value.clone(), bottom: uniforms.uBottom.value.clone(),
    far: scene.fog.far, near: scene.fog.near,
    cover: uniforms.uCloudCover.value, low: uniforms.uCloudLow.value
  };
}
const clear = converge('day', 'clear');
assert(blueGap(clear.top) > .28, 'clear-day zenith must be distinctly blue, not merely blue-grey');
assert(blueGap(clear.bottom) > .09, 'clear-day horizon must retain blue rather than beige');
// The real dome gradient at normal walking elevations, before cloud blending.
for (const elevation of [.04, .12, .3]) {
  const color = clear.bottom.clone().lerp(clear.top, Math.pow(elevation, .62));
  assert(blueGap(color) > .13, 'low-angle walking view needs visibly blue sky');
}
assert(clear.near >= 55 && clear.far >= 285, 'clear air must not grey out the nearby village');
assert(clear.cover <= .32, 'clear day leaves substantial sky between white clouds');
assert(uniforms.uCloudOpacity.value > .5, 'white clouds remain visible');
const mist = converge('day', 'mist');
const rain = converge('day', 'rain');
const night = converge('night', 'clear');
assert(mist.far < clear.far * .6 && rain.far < clear.far * .6, 'mist and rain still reduce visibility');
assert(mist.cover > clear.cover + .2 && rain.cover > mist.cover, 'weather cloud layers remain distinct');
assert(mist.low > clear.low && rain.low > mist.low, 'wet weather retains a low cloud deck');
assert(blueGap(rain.top) < blueGap(clear.top) * .7, 'rain is noticeably less blue');
assert(night.top.r + night.top.g + night.top.b < clear.top.r + clear.top.g + clear.top.b,
  'night is not brightened by clear-day work');
console.log(JSON.stringify({
  clearDay: true, zenith: rgb(clear.top).getHexString(THREE.LinearSRGBColorSpace),
  horizon: rgb(clear.bottom).getHexString(THREE.LinearSRGBColorSpace),
  fog: [clear.near, clear.far], clearCover: clear.cover,
  mistFar: mist.far, rainFar: rain.far, weatherSeparation: true, untouchedSkyPreserved: true
}));
