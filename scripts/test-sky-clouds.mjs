import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

// ---- 最小 DOM / window：只满足 createSky 里用到的接口，不加载浏览器 ----
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
for (const id of ['sky-time', 'sky-weather', 'sky-toast']) {
  nodes.set(id, { textContent: '', classList: classList() });
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => canvasContext }),
  getElementById: id => nodes.get(id) || null,
  body: { classList: classList() }
};
globalThis.window = new EventTarget();
globalThis.window.location = { search: '' };

const { createSky } = await import('../src/systems/sky.js');

// ---- 最小场景：背景色、雾、一盏灯、一组远山（MeshBasicMaterial） ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(world.render.background);
scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
const mountains = new THREE.Group();
mountains.name = 'mountains';
const hillMat = new THREE.MeshBasicMaterial({ color: '#A8B5A0' });
const hillBase = hillMat.color.clone();
mountains.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hillMat));
scene.add(mountains);

const lights = {
  sun: new THREE.DirectionalLight('#FFF6E4', 1.1),
  hemi: new THREE.HemisphereLight('#F6EFDF', '#9AB57A', 1.3),
  fill: new THREE.DirectionalLight('#DDE8F2', 0.34)
};
const renderer = { getPixelRatio: () => 1 };
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 800);

const sky = createSky(world.sky, scene, renderer, camera, { lights });
const dome = scene.getObjectByName('sky-dome');
assert.ok(dome && dome.material && dome.material.uniforms, 'sky dome created');
const U = dome.material.uniforms;

// 1. 云 uniform 齐备且有限
const cloudUniformNames = ['uCloudColor', 'uCloudCover', 'uCloudOpacity', 'uCloudSoft', 'uCloudShade', 'uCloudLow', 'uCloudTime'];
for (const name of cloudUniformNames) {
  assert.ok(U[name], 'uniform exists: ' + name);
}
function assertFiniteUniforms(label) {
  const nums = ['uCloudCover', 'uCloudOpacity', 'uCloudSoft', 'uCloudShade', 'uCloudLow', 'uCloudTime'];
  for (const n of nums) assert.ok(Number.isFinite(U[n].value), label + ': ' + n + ' finite');
  for (const n of ['uTop', 'uBottom', 'uCloudColor']) {
    const c = U[n].value;
    assert.ok(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b), label + ': ' + n + ' color finite');
  }
}
assertFiniteUniforms('initial');

// 2. 默认 start = day / clear，首帧已落初值：天顶应是自然蓝，不再是米灰
assert.equal(sky.timeId, 'day');
assert.equal(sky.weatherId, 'clear');
assert.ok(U.uTop.value.b > U.uTop.value.r, 'clear day sky top is blue-dominant');
assert.ok(scene.background.b > scene.background.r, 'background/fog is blue-dominant, not beige');
assert.ok(U.uCloudOpacity.value > 0.5, 'day clouds are visible');

// 收敛到指定天时/天气：驱动足够多帧，让权重与 cur 都逼近目标
function converge(timeId, weatherId, frames = 320, dt = 0.12) {
  sky.setTime(timeId);
  sky.setWeather(weatherId);
  for (let i = 0; i < frames; i++) sky.update(dt, camera);
  assertFiniteUniforms(timeId + '/' + weatherId);
  return {
    cover: U.uCloudCover.value,
    opacity: U.uCloudOpacity.value,
    soft: U.uCloudSoft.value,
    shade: U.uCloudShade.value,
    low: U.uCloudLow.value,
    speed: sky.getStats().cloudSpeed,
    top: U.uTop.value.clone(),
    bottom: U.uBottom.value.clone(),
    cloud: U.uCloudColor.value.clone(),
    cloudTime: U.uCloudTime.value,
    fog: scene.background.clone()
  };
}

// 3. 四种天气的云量/云速/低云关系（确定性断言，来自 world.json 增量模型）
const clear = converge('day', 'clear');
const mist = converge('day', 'mist');
const rain = converge('day', 'rain');
const wind = converge('day', 'wind');

assert.ok(rain.cover > mist.cover && mist.cover > wind.cover && wind.cover > clear.cover,
  'cloud cover: rain > mist > wind > clear');
assert.ok(wind.speed > rain.speed && rain.speed > clear.speed && clear.speed > mist.speed,
  'cloud speed: wind > rain > clear > mist (wind drifts fastest, mist slowest)');
assert.ok(rain.low > mist.low && mist.low > 0.4 && clear.low < 0.01 && wind.low < 0.01,
  'low deck only appears for rain/mist');
assert.ok(rain.cloud.b < clear.cloud.b, 'rain cloud color is dimmer than clear white cloud');
assert.ok(rain.top.b < clear.top.b, 'rain sky is less blue / more overcast than clear day');
assert.ok(rain.fog.b < clear.fog.b, 'rain pulls fog toward overcast tint');

// 4. 四时云色/天色：晨昏暖、夜暗且云稀
const dawn = converge('dawn', 'clear');
const dusk = converge('dusk', 'clear');
const night = converge('night', 'clear');
assert.ok(dawn.cloud.r > dawn.cloud.b, 'dawn clouds are warm');
assert.ok(dusk.cloud.r > dusk.cloud.b, 'dusk clouds are warm');
assert.ok(dawn.bottom.r > dawn.bottom.b, 'dawn horizon is warm');
assert.ok(night.top.r + night.top.g + night.top.b < clear.top.r + clear.top.g + clear.top.b,
  'night sky is darker than day');
assert.ok(night.opacity < clear.opacity && night.opacity < 0.4, 'night clouds are faint');
assert.ok(dawn.cover > 0 && dusk.cover > 0 && night.cover > 0, 'every time keeps some clouds');

// 5. 云会随时间飘动，且天气切换后过渡连续（无 NaN、无瞬跳）
const beforeT = converge('day', 'clear').cloudTime;
for (let i = 0; i < 40; i++) sky.update(0.12, camera);
assert.ok(U.uCloudTime.value > beforeT, 'clouds drift as time advances');
sky.setWeather('rain');
let last = sky.getStats().cloudCover;
for (let i = 0; i < 25; i++) {
  sky.update(0.12, camera);
  const now = sky.getStats().cloudCover;
  assert.ok(Number.isFinite(now) && now >= last - 1e-6, 'clear->rain cloud cover rises smoothly without NaN');
  last = now;
}
assert.ok(last > clear.cover, 'rain transition actually increases cloud cover');

// 6. 远山空气透视：随天时向天边色掺入，且颜色有限
assert.ok(Number.isFinite(hillMat.color.r) && Number.isFinite(hillMat.color.g) && Number.isFinite(hillMat.color.b),
  'hill material color stays finite after sky shading');
assert.ok(hillMat.color.b > hillBase.b, 'hills pick up blue aerial perspective from fog');
assert.ok(scene.fog.near > 0 && scene.fog.far > scene.fog.near, 'fog distances stay valid');

// 7. dispose 干净移除穹顶/星/日月，不抛异常
sky.dispose();
assert.equal(scene.getObjectByName('sky-dome'), undefined, 'dome removed on dispose');
assert.equal(scene.getObjectByName('sky-stars'), undefined, 'stars removed on dispose');
assert.equal(scene.getObjectByName('sky-sun'), undefined, 'sun removed on dispose');
assert.equal(scene.getObjectByName('sky-moon'), undefined, 'moon removed on dispose');

console.log('PASS test-sky-clouds: uniforms, four times, four weathers, drift, hills, dispose');
