import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

import { createTerrain, createRiverDistance, createMountains } from '../src/world/terrain.js';
import { createRiverCurve, createStream, sampleRiverSpine } from '../src/world/stream.js';
import { createCliff } from '../src/world/cliff.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createVillage } from '../src/world/village.js';
import { segmentDistance } from '../src/world/hinterland.js';
import { createWeather } from '../src/systems/weather.js';
import { createSky } from '../src/systems/sky.js';
import { createPhenologySystem } from '../src/systems/phenology-mist.js';
import { createWulingOutskirts } from '../src/world/wuling-outskirts.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { CLASSICAL_COLOPHONS } from '../src/systems/scroll-studio.js';
import { createRainWater } from '../src/systems/rain-water.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const scriptData = JSON.parse(readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8'));

const ctx2d = new Proxy({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray((w || 64) * (h || 64) * 4) })
}, {
  get: (t, k) => t[k] ?? (() => ({ addColorStop() {} }))
});
const makeClassList = () => {
  const s = new Set();
  return {
    add: (...xs) => xs.forEach(x => s.add(x)),
    remove: (...xs) => xs.forEach(x => s.delete(x)),
    contains: x => s.has(x),
    toggle: (x, f) => {
      const on = f === undefined ? !s.has(x) : Boolean(f);
      if (on) s.add(x); else s.delete(x);
      return on;
    }
  };
};
const els = new Map();
function getEl(id) {
  if (!els.has(id)) {
    els.set(id, {
      id,
      textContent: '',
      hidden: true,
      open: false,
      style: {},
      dataset: {},
      children: [],
      classList: makeClassList(),
      appendChild(ch) { this.children.push(ch); return ch; },
      querySelector() { return null; },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {}
    });
  }
  return els.get(id);
}
const mockDoc = {
  body: { classList: makeClassList() },
  createElement: () => ({
    getContext: () => ctx2d,
    style: {},
    children: [],
    classList: makeClassList(),
    appendChild(ch) { this.children.push(ch); return ch; },
    addEventListener() {}
  }),
  getElementById: id => getEl(id)
};
const mockWin = {
  location: { search: '' },
  addEventListener() {},
  removeEventListener() {}
};
globalThis.document = mockDoc;
globalThis.window = mockWin;

function digestGroup(obj) {
  const h = createHash('sha256');
  obj.traverse(o => {
    h.update(o.name || '');
    h.update(JSON.stringify({ p: o.position.toArray(), r: [o.rotation.x, o.rotation.y, o.rotation.z], s: o.scale.toArray(), count: o.count ?? -1 }));
    if (o.geometry) {
      for (const k of Object.keys(o.geometry.attributes).sort()) {
        const a = o.geometry.attributes[k];
        h.update(k);
        h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
      }
    }
    if (o.instanceMatrix) {
      h.update(Buffer.from(o.instanceMatrix.array.buffer, o.instanceMatrix.array.byteOffset, o.instanceMatrix.array.byteLength));
    }
  });
  return h.digest('hex');
}

// ============================================================================
// 1. 冬天专属「雪」天气、粒子冻结门控与物候联动校验
// ============================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(world.render.background);
scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.2, 700);
camera.position.set(26, 3.2, 198);
const sun = new THREE.DirectionalLight('#FFF5E4', 1.1);
const hemi = new THREE.HemisphereLight('#DCE8E4', '#6E7862', 0.72);
scene.add(sun, hemi);
const mockRenderer = { setClearColor() {}, getPixelRatio: () => 1 };

const weather = createWeather(world.sky, scene);
const sky = createSky(world.sky, scene, mockRenderer, camera, {
  weather,
  lights: { sun, hemi, fill: null }
});

const snowPoints = scene.getObjectByName('weather-snow');
assert.ok(snowPoints?.isPoints, 'weather creates GPU snow Points batch');
assert.equal(snowPoints.visible, false, 'snow particles hidden by default in clear spring');
assert.deepEqual(sky.getActiveWeatherOrder(), ['clear', 'mist', 'rain', 'wind'], 'non-winter weather cycle excludes snow');

// 切入冬寂物候，验证 R 循环首步即进入「雪」
sky.setPhenology('winter');
assert.deepEqual(sky.getActiveWeatherOrder(), ['clear', 'snow', 'mist', 'rain', 'wind'], 'winter expands weather cycle with snow');
sky.cycleWeather(1);
assert.equal(sky.weatherId, 'snow', 'first weather step in winter enters snow');

for (let i = 0; i < 45; i++) sky.update(0.1, camera);
assert.equal(getEl('sky-weather').textContent, '雪', 'HUD weather label updates to 雪');
assert.ok(sky.snowIntensity > 0.92, `snowIntensity ramps smoothly toward 1 (got ${sky.snowIntensity.toFixed(3)})`);
assert.equal(snowPoints.visible, true, 'snow Points visible during winter snowfall');
assert.equal(weather.getStats().rainVisible, false, 'rain Lines remain hidden during snowfall');
assert.equal(weather.getStats().snowVisible, true, 'weather stats report active snow');

// dt === 0 冻结门控
const tBeforeFreeze = snowPoints.material.uniforms.uTime.value;
weather.update(0, camera, { rain: 0, snow: 1, windX: 0.4, windZ: 0.2 });
assert.equal(snowPoints.material.uniforms.uTime.value, tBeforeFreeze, 'dt === 0 strictly freezes snow shader clock');

// 从冬季切回春季时，若处于「雪」则自动雪霁转晴并平滑消散
sky.setPhenology('spring');
assert.equal(sky.weatherId, 'clear', 'leaving winter while snowing transitions weatherId back to clear');
for (let i = 0; i < 60; i++) sky.update(0.1, camera);
assert.ok(sky.snowIntensity < 0.01, 'snowIntensity decays cleanly to zero in spring');
assert.equal(snowPoints.visible, false, 'snow Points hidden once snowfall clears');

// 画卷题跋与冬雪专属印章（琼林留白 / 寒江渔火 / 雪村暖茗 / 雪岭朝晖 / 寒山晚照）
assert.ok(CLASSICAL_COLOPHONS.some(c => c.id === 'winter-snow' && c.matchWeather?.includes('snow')), 'scroll-studio colophon matches snow weather');
assert.ok(CLASSICAL_COLOPHONS.some(c => c.id === 'winter-ferry' && c.seal === '寒江渔火' && c.matchRegions?.includes('武陵溪')), 'scroll-studio includes winter Wuling ferry colophon');
assert.ok(CLASSICAL_COLOPHONS.some(c => c.id === 'winter-tea' && c.seal === '雪村暖茗' && c.matchRegions?.includes('豁然开朗')), 'scroll-studio includes winter tea-shelter colophon');
assert.ok(CLASSICAL_COLOPHONS.some(c => c.id === 'winter-dawn' && c.seal === '雪岭朝晖' && c.matchTime?.includes('dawn')), 'scroll-studio includes winter dawn mountain alpenglow colophon');
assert.ok(CLASSICAL_COLOPHONS.some(c => c.id === 'winter-dusk' && c.seal === '寒山晚照' && c.matchTime?.includes('dusk')), 'scroll-studio includes winter dusk mountain alpenglow colophon');
const tgcSrc = readFileSync(new URL('../src/systems/traveler-guide-cruise.js', import.meta.url), 'utf8');
assert.ok(tgcSrc.includes('冬雪寻幽') && tgcSrc.includes('寒溪薄冰') && tgcSrc.includes('冬韵舆图与题跋'), 'traveler-guide help sheet includes winter snow & map tips');
assert.ok(tgcSrc.includes('WINTER_CRUISE_WAYPOINTS') && tgcSrc.includes('武陵渡口 · 寒江渔火') && tgcSrc.includes('雪村暖茗 · 豁然开朗'), 'traveler-guide cruise includes bespoke winter camera route');
const mapSrc = readFileSync(new URL('../src/systems/map.js', import.meta.url), 'utf8');
assert.ok(mapSrc.includes('drawWinterOutskirtSeals') && mapSrc.includes('hitWinterSealAt') && mapSrc.includes('寒江渔火') && mapSrc.includes('雪村暖茗'), 'map.js renders clickable winter landmark seals for Wuling ferry & tea shelter');

// 入画巡游（L）冬雪专属路线、纯净画框、与丹青截画（O）协同校验（含 dt===0 冻结与春日切回原路线）
{
  const { createTravelerGuideAndCruise } = await import('../src/systems/traveler-guide-cruise.js');
  const { createScrollStudio } = await import('../src/systems/scroll-studio.js');
  assert.ok(tgcSrc.includes('body.cruise-active #discovery-label'), 'cruise CSS hides #discovery-label for pure cinema framing');
  const discSrc = readFileSync(new URL('../src/systems/discovery.js', import.meta.url), 'utf8');
  assert.ok(discSrc.includes("contains?.('cruise-active')"), 'discovery.js disables target projection during cruise-active');
  let mockSeason = 'winter';
  let mockScrollOpen = false;
  const cruiseCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.2, 500);
  const tgKeyListeners = [];
  const tgWin = {
    addEventListener(ev, fn) { if (ev === 'keydown') tgKeyListeners.push(fn); },
    removeEventListener(ev, fn) {
      if (ev === 'keydown') {
        const i = tgKeyListeners.indexOf(fn);
        if (i >= 0) tgKeyListeners.splice(i, 1);
      }
    }
  };
  const tgDoc = {
    body: {
      classList: makeClassList(),
      appendChild(ch) {
        if (ch?.id) els.set(ch.id, ch);
        return ch;
      }
    },
    head: { appendChild() {} },
    createElement: tag => {
      const evMap = new Map();
      const n = {
        tagName: String(tag || 'div').toUpperCase(),
        id: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        open: false,
        width: 640,
        height: 360,
        classList: makeClassList(),
        style: {},
        children: [],
        getContext: () => ctx2d,
        toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
        appendChild(c) {
          this.children.push(c);
          if (c?.id) els.set(c.id, c);
          return c;
        },
        querySelector(sel) {
          if (typeof sel === 'string' && sel.startsWith('#')) return els.get(sel.slice(1)) || null;
          return null;
        },
        addEventListener(ev, fn) {
          if (!evMap.has(ev)) evMap.set(ev, []);
          evMap.get(ev).push(fn);
        },
        removeEventListener() {},
        dispatch(ev, payload = {}) {
          for (const fn of evMap.get(ev) || []) fn(payload);
        },
        setAttribute() {},
        focus() {},
        showModal() { this.open = true; },
        close() { this.open = false; },
        remove() { if (this.id) els.delete(this.id); }
      };
      return n;
    },
    getElementById: id => els.get(id) || null
  };
  const tg = createTravelerGuideAndCruise({
    camera: cruiseCam,
    player: { clearInput() {}, syncCamera() {} },
    field: { sample: () => 0 },
    getScrollStudio: () => ({ isOpen: () => mockScrollOpen }),
    getPhenology: () => ({ getStats: () => ({ phenologyId: mockSeason }) }),
    doc: tgDoc,
    win: tgWin
  });
  assert.equal(tg.startCruise(), true, 'starts winter cruise cleanly');
  assert.equal(tg.getStats().winterRoute, true, 'winter phenology activates bespoke winter cruise route');
  assert.ok(tgDoc.getElementById('cruise-banner')?.textContent?.includes('武陵渡口 · 寒江渔火'), 'winter cruise banner displays Cold-River Fishing-Light title');
  const winCamZ0 = cruiseCam.position.z;
  assert.ok(winCamZ0 > 195, `winter cruise opens near Wuling ferry & shore ice (z=${winCamZ0.toFixed(1)})`);
  // 巡游中打开丹青画卷（O）时，按 Esc 只合画卷不中断巡游
  mockScrollOpen = true;
  for (const fn of tgKeyListeners) fn({ code: 'Escape', repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault() {} });
  assert.equal(tg.cruiseActive, true, 'Escape while scroll-studio dialog is open preserves active cruise');
  mockScrollOpen = false;
  // 校验巡游中截画自动契合冬雪「寒江渔火」题跋与真实相机朝向 yaw
  const ssCanvas = tgDoc.createElement('canvas');
  const ssStorage = new Map();
  const ssPlayer = { state: { x: 24, y: 2, z: -48, yaw: 0, pitch: 0 }, clearInput() {}, syncCamera() {} };
  const ss = createScrollStudio({
    canvas: ssCanvas,
    player: ssPlayer,
    camera: cruiseCam,
    field: { sample: () => 0 },
    journal: { isOpen: () => false },
    map: { isOpen: () => false, getStats: () => ({ region: '豁然开朗' }) },
    sky: { timeId: 'day', weatherId: 'snow', getStats: () => ({ time: 'day', weather: 'snow' }) },
    getPhenology: () => ({ getStats: () => ({ phenologyId: 'winter', short: '冬雪' }) }),
    getTravelerGuide: () => tg,
    world,
    doc: tgDoc,
    win: { addEventListener() {}, removeEventListener() {} },
    storage: {
      getItem: k => ssStorage.get(k) ?? null,
      setItem: (k, v) => ssStorage.set(k, String(v)),
      removeItem: k => ssStorage.delete(k)
    }
  });
  assert.equal(ss.openCapture(true), true, 'scroll-studio opens mid-winter-cruise');
  tgDoc.getElementById('scroll-save-box')?.dispatch('click', {});
  const saved = ss.getSavedScrolls()[0];
  assert.ok(saved && saved.region === '武陵溪', `mid-winter-cruise capture resolves camera region 武陵溪 (got ${saved?.region})`);
  assert.equal(saved.seal, '寒江渔火', `mid-winter-cruise capture auto-selects 寒江渔火 seal (got ${saved?.seal})`);
  const expectedYaw = Math.atan2(-(18.4 - 27.2), -(194.2 - 203.5));
  assert.ok(Math.abs(saved.yaw - expectedYaw) < 0.08, `mid-cruise capture saves true world camera yaw (${saved.yaw?.toFixed(3)} vs ${expectedYaw.toFixed(3)})`);
  // 「展卷入画」重游自动退出巡游并将玩家置回精准坐标与朝向
  assert.equal(ss.enterScrollWorld(saved.id), true, 'enterScrollWorld revisits saved cruise painting');
  assert.equal(tg.cruiseActive, false, 'enterScrollWorld cleanly exits cruise before teleporting player');
  assert.ok(Math.abs(ssPlayer.state.yaw - expectedYaw) < 0.08, 'enterScrollWorld restores exact painting yaw');
  ss.close();
  ss.dispose();
  // 重新开启巡游验证 dt === 0 冻结、巡游中按 K 切换季节不跳变视角，以及重新入画后春季恢复原路线
  assert.equal(tg.startCruise(), true, 'restarts cruise cleanly after revisit');
  const frozenClock = tg.getStats().cruiseClock;
  tg.update(0);
  assert.equal(tg.getStats().cruiseClock, frozenClock, 'dt === 0 freezes winter cruise clock');
  const camPosBefore = cruiseCam.position.clone();
  const camQuatBefore = cruiseCam.quaternion.clone();
  mockSeason = 'spring';
  tg.update(0);
  assert.equal(tg.getStats().winterRoute, true, 'switching season mid-cruise keeps active winter route locked without jumping camera');
  assert.equal(cruiseCam.position.distanceTo(camPosBefore), 0, 'mid-cruise season switch preserves camera position');
  assert.equal(cruiseCam.quaternion.equals(camQuatBefore), true, 'mid-cruise season switch preserves camera orientation');
  tg.stopCruise();
  assert.equal(tg.startCruise(), true, 'restarts cruise in spring cleanly');
  assert.equal(tg.getStats().winterRoute, false, 'returning to spring switches cruise back to standard route on next cruise start');
  assert.ok(tgDoc.getElementById('cruise-banner')?.textContent?.includes('武陵溪口 · 芳草鲜美'), 'spring cruise banner restores spring title');
  tg.update(1.5);
  const springPos = cruiseCam.position.clone();
  const springQuat = cruiseCam.quaternion.clone();
  for (const nextSeason of ['summer', 'autumn', 'winter', 'spring']) {
    mockSeason = nextSeason;
    tg.update(0);
    assert.equal(tg.getStats().winterRoute, false, `active spring cruise keeps route locked when cycling to ${nextSeason}`);
    assert.equal(cruiseCam.position.distanceTo(springPos), 0, `cycling to ${nextSeason} mid-cruise preserves camera position`);
    assert.equal(cruiseCam.quaternion.equals(springQuat), true, `cycling to ${nextSeason} mid-cruise preserves camera orientation`);
  }
  tg.dispose();
}

// ============================================================================
// 2. 远山 3D 支脉皴法与黄昏/夜色天光联动（修复昼色剪影假山）+ 中景重峦危峰
// ============================================================================
const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const terrain = createTerrain(world.terrain, distanceToRiver, { road: world.village.road, pond: world.terrain.pond });
terrain.field.colorAt = terrain.colorAt;
const cliff = createCliff(world.cliff, terrain.field);
const mountains = createMountains(world.mountains);
scene.add(terrain.mesh, cliff.group, mountains);

const backPeaks = cliff.group.getObjectByName('cliff-back-peaks');
assert.ok(backPeaks?.isInstancedMesh && backPeaks.count >= 16, 'cliff includes multi-layered background crag peaks flanking canyon');
const cliffRocks = cliff.group.getObjectByName('cliff-rocks');
const cragTris = cliffRocks.geometry.attributes.position.count / 3;
assert.equal(cragTris, 180, 'cliff crags use 180-tri faceted mountain peak geometry');

// 注册材质进 sky，检验正午 vs 黄昏 vs 子夜远山明度与暖色消光响应
sky.registerMaterials(scene);
sky.setTime('day');
sky.setWeather('clear');
for (let i = 0; i < 40; i++) {
  sky.update(0.1, camera);
  mountains.update(0.1, sky, camera);
}
const dayCol = mountains.children[0].material.color.clone();
const dayLum = 0.2126 * dayCol.r + 0.7152 * dayCol.g + 0.0722 * dayCol.b;

sky.setTime('dusk');
for (let i = 0; i < 45; i++) {
  sky.update(0.1, camera);
  mountains.update(0.1, sky, camera);
}
const duskCol = mountains.children[0].material.color.clone();
assert.ok(duskCol.r / Math.max(1e-4, duskCol.b) > dayCol.r / Math.max(1e-4, dayCol.b) * 1.15, 'dusk distant mountains absorb warm twilight tint instead of staying cyan');

sky.setTime('night');
for (let i = 0; i < 45; i++) {
  sky.update(0.1, camera);
  mountains.update(0.1, sky, camera);
}
const nightCol = mountains.children[0].material.color.clone();
const nightLum = 0.2126 * nightCol.r + 0.7152 * nightCol.g + 0.0722 * nightCol.b;
assert.ok(nightLum < dayLum * 0.42, `night distant mountains dim into night sky (${nightLum.toFixed(3)} vs day ${dayLum.toFixed(3)})`);

// 远山墨韵云带风驱流转 + 晨昏日影流金云缘 + dt === 0 冻结校验
const cloudBefore = mountains.getCloudState();
assert.equal(typeof cloudBefore.windDrift, 'number', 'mountains exposes wind-driven cloud belt state');
sky.setTime('dawn');
sky.setWeather('snow');
for (let i = 0; i < 20; i++) {
  sky.update(0.1, camera);
  mountains.update(0.1, sky, camera);
}
const cloudSnowDawn = mountains.getCloudState();
assert.ok(cloudSnowDawn.windDrift > cloudBefore.windDrift, 'distant mountain ink cloud belt drifts smoothly over time');
assert.ok(cloudSnowDawn.cloudMood > 0.65, `dawn snowfall amplifies distant mountain cloud mood (got ${cloudSnowDawn.cloudMood})`);
assert.ok(cloudSnowDawn.sunRim > 0.25, `dawn activates directional sun-gilded mountain cloud rim (got ${cloudSnowDawn.sunRim})`);
mountains.update(0, sky, camera);
assert.deepEqual(mountains.getCloudState(), cloudSnowDawn, 'dt === 0 strictly freezes mountain cloud belt drift, mood and sun rim');

// 远山三层大气透视层级（uInkMountainTier + 雪岭朝晖 alpenGlow + 冷调远岚 coolFarMist，0 额外 draw call）
assert.equal(mountains.children.length, 3, 'distant mountains keep exact 3 draw-call tiers');
for (let ti = 0; ti < mountains.children.length; ti++) {
  const mShader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  mountains.children[ti].material.onBeforeCompile(mShader, {});
  assert.ok(Math.abs(mShader.uniforms.uInkMountainTier.value - ti * 0.5) < 1e-6, `mountain tier ${ti} carries exact uInkMountainTier depth`);
  assert.ok(mShader.fragmentShader.includes('alpenGlow') && mShader.fragmentShader.includes('coolFarMist'), 'mountain shader integrates winter alpenglow & cool tier haze');
}

// 还原正午晴空
sky.setWeather('clear');
sky.setTime('day');
for (let i = 0; i < 40; i++) {
  sky.update(0.1, camera);
  mountains.update(0.1, sky, camera);
}
assert.ok(mountains.getCloudState().sunRim < 0.05, 'midday clear sky cleanly retires twilight sun-gilded rim');

// ============================================================================
// 3. 桃源村外（武陵溪渡口桃林 + 村口外郊）景物、白鹭、人物对话与四时字节还原校验
// ============================================================================
const basin = world.terrain.basin;
const floraField = {
  half: terrain.field.half,
  sample: (x, z) => terrain.field.sample(x, z),
  slope: (x, z) => (Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : terrain.field.slope(x, z))
};
const nearTree = (x, z) =>
  Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34 ||
  Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40 ||
  world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);
const stream = createStream(world.stream, world.terrain, riverCurve);
const flora = createFlora(world.flora, floraField, distanceToRiver, stream.curve, world.player.spawn, nearTree);
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, terrain.field);
const exterior = createExteriorExploration(world, terrain.field, distanceToRiver, riverCurve, flora, boats, cliff);
const village = createVillage(structuredClone(world.village), terrain.field, world.terrain.pond);

const outskirtsA = createWulingOutskirts({
  world, field: terrain.field, distanceToRiver, riverCurve, flora, boats, cliff, exterior, village
});
const outskirtsB = createWulingOutskirts({
  world, field: terrain.field, distanceToRiver, riverCurve, flora, boats, cliff, exterior, village
});
assert.equal(digestGroup(outskirtsA.group), digestGroup(outskirtsB.group), 'createWulingOutskirts is 100% deterministic');
outskirtsB.dispose();

const stats = outskirtsA.getStats();
assert.equal(stats.ferryPlaced, true, 'Wuling ferry thatch pavilion placed near spawn');
assert.equal(stats.egretCount, 4, '4 wading white egrets placed in shallow shoals');
assert.equal(stats.sites.length, 3, 'all 3 interactive outskirt sites placed');
assert.equal(stats.actors.length, 6, 'all 6 exterior & village-outskirt characters placed');
assert.equal(stats.actors.filter(a => a.zone === 'exterior').length, 3, '3 living Wuling characters outside cave');
assert.equal(stats.actors.filter(a => a.zone === 'interior').length, 3, '3 living outskirt characters around village entrance/west edge');

// 验证所有新人物与古迹点均在干岸、远离出生点与一线天洞口、不压占小径与大路
const waterY = world.terrain.waterLevel;
for (const item of [...outskirtsA.sites, ...outskirtsA.actors]) {
  const gy = terrain.field.sample(item.x, item.z);
  assert.ok(gy > waterY + 0.55, `${item.id} stands on dry ground (y=${gy.toFixed(2)})`);
  assert.ok(Math.hypot(item.x - world.player.spawn.x, item.z - world.player.spawn.z) > 5.2, `${item.id} keeps spawn clear`);
  assert.ok(Math.hypot(item.x - cliff.slit.x, item.z - cliff.slit.z) > 11.5, `${item.id} keeps cave slit clear`);
}

// 验证互动石碣/施茶瓮触发与 Portal Culling 显隐隔离
const triggered = outskirtsA.interactById('wuling-waystone', null, mockDoc);
assert.ok(triggered && getEl('mystery-note').textContent.includes('武陵'), 'waystone interaction displays inscription');

outskirtsA.interiorGroup.visible = false;
outskirtsA.exteriorGroup.visible = true;
assert.equal(outskirtsA.getInteractables().filter(x => x.active).length, 3, 'portal culling exposes only exterior actors outside cave');
const extOnlyDraws = outskirtsA.getStats().drawCalls;
outskirtsA.interiorGroup.visible = true;
outskirtsA.exteriorGroup.visible = false;
assert.equal(outskirtsA.getInteractables().filter(x => x.active).length, 3, 'portal culling exposes only interior actors inside village');
const intOnlyDraws = outskirtsA.getStats().drawCalls;
assert.ok(extOnlyDraws <= 16 && intOnlyDraws <= 14, `portal-culled draw budgets stay lean (ext=${extOnlyDraws}, int=${intOnlyDraws})`);
outskirtsA.exteriorGroup.visible = true;

// 验证 dt === 0 冻结门控
outskirtsA.update(0.25, 0.25, sky, { x: 30, y: 1.5, z: 192 });
const snapDigest = digestGroup(outskirtsA.group);
outskirtsA.update(0, 0.25, sky, { x: 30, y: 1.5, z: 192 });
assert.equal(digestGroup(outskirtsA.group), snapDigest, 'dt === 0 freezes all outskirt actors, egrets, and bamboo raft');

// 验证武陵渔父与村口老丈对话脚本 + 冬日飞雪语境台词（且绝无第三幕剧透）
const phenology = createPhenologySystem({
  world, field: terrain.field, riverCurve, cliff, terrain, village, mountains, flora, boats, exterior,
  wulingOutskirts: outskirtsA, sky, doc: mockDoc, win: mockWin
});
const vd = createVillagerDialogue({
  sky,
  getWorldClock: () => null,
  getPhenology: () => phenology,
  people: { list: [], greet() {} },
  communityLife: { greet: (id) => outskirtsA.greet(id) },
  sound: null,
  player: { state: { x: 30, y: 1.5, z: 191 } },
  doc: mockDoc,
  win: mockWin
});
for (const roleId of ['wuling_fisherman', 'wuling_woodcutter', 'wuling_herbalist', 'outskirt_greeter', 'outskirt_farmer', 'outskirt_gatherer']) {
  assert.ok(scriptData.npc.roles[roleId]?.lines?.length >= 3, `script.json provides lines for ${roleId}`);
}
phenology.setPhenology('winter');
sky.cycleWeather(1); // 'snow'
for (let i = 0; i < 30; i++) sky.update(0.1, camera);
const fisherRef = outskirtsA.getInteractables().find(x => x.id === 'wuling-fisherman');
const opened = vd.beginOrAdvance({
  kind: 'person',
  key: 'community:wuling-fisherman',
  name: fisherRef.name,
  lines: scriptData.npc.roles.wuling_fisherman.lines,
  ref: fisherRef,
  x: fisherRef.x,
  y: fisherRef.y,
  z: fisherRef.z
});
assert.ok(opened && opened.who.includes('武陵渔父'), 'villager-dialogue opens for Wuling fisherman');
assert.ok(opened.meta.includes('瑞雪纷飞') && opened.line.includes('朔雪纷飞') && opened.line.includes('冰凌'), 'winter snowfall injects bespoke Cold River Snow context into fisherman dialogue');
assert.ok(!/太守|刘子骥|遂迷/.test(opened.line || ''), 'exterior dialogue contains zero Act 3 spoilers');
vd.close();

// 村口施茶老丈冬雪专属语录（热腾腾陈桑姜茗与檐下小冰凌）
const greeterRef = outskirtsA.getInteractables().find(x => x.id === 'outskirt-greeter');
const openedGreeter = vd.beginOrAdvance({
  kind: 'person',
  key: 'community:outskirt-greeter',
  name: greeterRef.name,
  lines: scriptData.npc.roles.outskirt_greeter.lines,
  ref: greeterRef,
  x: greeterRef.x,
  y: greeterRef.y,
  z: greeterRef.z
});
assert.ok(openedGreeter && openedGreeter.who.includes('施茶老丈') && openedGreeter.line.includes('陈桑姜茗') && openedGreeter.line.includes('冰凌'), `outskirt greeter offers hot winter ginger-mulberry tea dialogue in snowfall (got who=${openedGreeter?.who}, line=${openedGreeter?.line})`);
assert.ok(!/太守|刘子骥|遂迷/.test(openedGreeter.line || ''), 'outskirt greeter dialogue contains zero Act 3 spoilers');
vd.close();

// 冬夜寒江渔火与雪霁初晴冰檐滴水专属对白彩蛋（且零第三幕剧透）
sky.setWeather('clear');
sky.setTime('night');
for (let i = 0; i < 45; i++) sky.update(0.1, camera);
const fisherNight = vd.beginOrAdvance({
  kind: 'person',
  key: 'community:wuling-fisherman-night',
  name: fisherRef.name,
  lines: scriptData.npc.roles.wuling_fisherman.lines,
  ref: fisherRef,
  x: fisherRef.x,
  y: fisherRef.y,
  z: fisherRef.z
});
assert.ok(fisherNight?.line?.includes('寒江渔火') && fisherNight.line.includes('薄冰'), `winter night triggers Cold-River Fishing-Light dialogue easter egg (got ${fisherNight?.line})`);
assert.ok(!/太守|刘子骥|遂迷/.test(fisherNight.line || ''), 'winter night fisher dialogue contains zero Act 3 spoilers');
vd.close();

sky.setTime('day');
for (let i = 0; i < 45; i++) sky.update(0.1, camera);
const fisherThaw = vd.beginOrAdvance({
  kind: 'person',
  key: 'community:wuling-fisherman-thaw',
  name: fisherRef.name,
  lines: scriptData.npc.roles.wuling_fisherman.lines,
  ref: fisherRef,
  x: fisherRef.x,
  y: fisherRef.y,
  z: fisherRef.z
});
assert.ok(fisherThaw?.line?.includes('雪霁初晴') && fisherThaw.line.includes('滴水') && fisherThaw.line.includes('岸冰'), `clear winter day triggers icicle-thaw & shore-ice dialogue (got ${fisherThaw?.line})`);
assert.ok(!/太守|刘子骥|遂迷/.test(fisherThaw.line || ''), 'winter clear day fisher dialogue contains zero Act 3 spoilers');
vd.close();

const greeterThaw = vd.beginOrAdvance({
  kind: 'person',
  key: 'community:outskirt-greeter-thaw',
  name: greeterRef.name,
  lines: scriptData.npc.roles.outskirt_greeter.lines,
  ref: greeterRef,
  x: greeterRef.x,
  y: greeterRef.y,
  z: greeterRef.z
});
assert.ok(greeterThaw?.line?.includes('雪村暖茗') && greeterThaw.line.includes('滴水'), `clear winter day triggers Snow-Village Warm-Tea thaw dialogue (got ${greeterThaw?.line})`);
assert.ok(!/太守|刘子骥|遂迷/.test(greeterThaw.line || ''), 'winter clear day greeter dialogue contains zero Act 3 spoilers');
vd.close();

// 验证四时物候切换后切回春深，outskirts 与 cliff 顶点色精确字节级还原
const springOutskirtsColors = [];
outskirtsA.group.traverse(o => {
  if (o.isMesh && o.geometry?.attributes?.color && o.name.startsWith('wuling-')) {
    springOutskirtsColors.push({ name: o.name, arr: new Float32Array(o.geometry.attributes.color.array) });
  }
});
// 先回春深取基准，再完整跑夏 -> 秋 -> 冬 -> 春
phenology.setPhenology('spring');
const baseCliffColors = new Float32Array(cliffRocks.geometry.attributes.color.array);
const baseOutskirtsMap = new Map();
outskirtsA.group.traverse(o => {
  if (o.isMesh && o.geometry?.attributes?.color && o.name.startsWith('wuling-')) {
    baseOutskirtsMap.set(o.name, new Float32Array(o.geometry.attributes.color.array));
  }
});

for (const s of ['summer', 'autumn', 'winter']) {
  phenology.setPhenology(s);
}
// 冬日危崖阳坡应覆薄雪（平均亮度高于春深）
const winterCliffArr = cliffRocks.geometry.attributes.color.array;
let springCliffSum = 0, winterCliffSum = 0;
for (let i = 0; i < baseCliffColors.length; i++) {
  springCliffSum += baseCliffColors[i];
  winterCliffSum += winterCliffArr[i];
}
assert.ok(winterCliffSum > springCliffSum * 1.04, 'cliff crags receive upward winter snow dusting');

phenology.setPhenology('spring');
assert.equal(
  Buffer.compare(
    Buffer.from(cliffRocks.geometry.attributes.color.array.buffer),
    Buffer.from(baseCliffColors.buffer)
  ),
  0,
  'cliff vertex colors restore byte-for-byte on spring return'
);
outskirtsA.group.traverse(o => {
  if (o.isMesh && baseOutskirtsMap.has(o.name)) {
    assert.equal(
      Buffer.compare(
        Buffer.from(o.geometry.attributes.color.array.buffer),
        Buffer.from(baseOutskirtsMap.get(o.name).buffer)
      ),
      0,
      `${o.name} vertex colors restore byte-for-byte on spring return`
    );
  }
});

// ============================================================================
// 4. 雪落水面涟漪、竹筏/木桥渐进积雪与武陵渡口风动晒网/空间声景校验
// ============================================================================
// 4a. 雪落水面：无额外 draw call，仅产出柔缓消融雪圈，无屋檐雨帘
const pondMesh = village.group.getObjectByName('pond');
const waterCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.2, 200);
waterCam.position.set(22, 8, 192);
waterCam.lookAt(14, -1, 185);
waterCam.updateMatrixWorld();
const rainWater = createRainWater({
  world, field: terrain.field, stream, riverCurve, village, pondMesh,
  shelters: outskirtsA.shelters, sky, camera: waterCam,
  doc: { hidden: false, hasFocus: () => true }
});
rainWater.update(0.05, 1.0, { rainIntensity: 0, snowIntensity: 0 }, waterCam);
assert.equal(rainWater.getStats().drawCalls, 0, 'dry non-snowing water produces 0 draws');
rainWater.update(0.05, 1.2, { rainIntensity: 0, snowIntensity: 0.9 }, waterCam);
const snowWaterStats = rainWater.getStats();
assert.ok(snowWaterStats.snowRings > 0 && snowWaterStats.rings > 0, `snowfall renders delicate water-dissolve rings (got ${snowWaterStats.snowRings})`);
assert.equal(snowWaterStats.eaves, 0, 'pure snowfall does not emit rain eave streaks');
assert.equal(snowWaterStats.drawCalls, 1, 'snow-on-water reuses existing ring batch with 1 draw call');
const snowClockBefore = snowWaterStats.clock;
rainWater.update(0, 9.0, { rainIntensity: 0, snowIntensity: 0.9 }, waterCam);
assert.equal(rainWater.getStats().clock, snowClockBefore, 'dt === 0 freezes snow-on-water ripples');
rainWater.dispose();

// 4b. 竹筏/茅亭/村中木桥渐进积雪 + 晒网麻网微风摆动 + 渡口竹筏/麻网空间声景事件
const mockLgMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const mockQmMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const origLgHook = mockLgMat.onBeforeCompile;
const origQmHook = mockQmMat.onBeforeCompile;
const mockLgGroup = new THREE.Group();
const mockLgMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mockLgMat);
mockLgMesh.name = 'leisure-grove-solid';
mockLgGroup.add(mockLgMesh);
const mockQmMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mockQmMat);

const outskirtsSnow = createWulingOutskirts({
  world, field: terrain.field, distanceToRiver, riverCurve, flora, boats, cliff, exterior, village,
  leisureGrove: { group: mockLgGroup, blockers: [] },
  qianmoPaths: { solidMesh: mockQmMesh }
});
assert.equal(outskirtsSnow.getStats().snowHookCount, 5, 'progressive snow attaches to static, raft, net, and both village bridge materials');
assert.equal(outskirtsSnow.getStats().ferryNetAnimated, true, 'Wuling ferry drying net is an animated hinged mesh');
assert.equal(outskirtsSnow.getStats().lanternCount, 3, 'builds 3 warm lanterns (ferry pavilion, bamboo raft prow, entrance tea shelter)');
assert.equal(outskirtsSnow.getStats().lanternsLit, false, 'lantern glow stays off with 0 draw calls during clear day');
assert.equal(outskirtsSnow.getStats().extSteamVisible, false, 'exterior cold-air breath stays hidden in spring daytime (0 draws)');
assert.equal(outskirtsSnow.getStats().intSteamVisible, false, 'tea-jar steam stays hidden in spring daytime (0 draws)');
assert.equal(outskirtsSnow.getStats().steamActivePuffs, 0, '0 active steam/breath puffs in spring daytime');

const compiledBridgeShader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
mockQmMat.onBeforeCompile(compiledBridgeShader, null);
assert.ok(compiledBridgeShader.uniforms.uProgSnowAccum, 'bridge material exposes uProgSnowAccum uniform');
assert.ok(compiledBridgeShader.fragmentShader.includes('uProgSnowAccum'), 'bridge fragment shader patches progressive snow blend');

outskirtsSnow.setPhenology('winter');
const ferryNetMesh = outskirtsSnow.exteriorGroup.getObjectByName('wuling-ferry-net');
assert.ok(ferryNetMesh?.isMesh, 'wuling-ferry-net exists inside exteriorGroup');
const netRotBefore = ferryNetMesh.rotation.z;
const ferryEvents = [];
const ferryPlayer = { x: 33.2, y: 1.8, z: 192.2 };
let sawExtBreath = false;
let maxExtBreathPuffs = 0;
for (let i = 0; i < 180; i++) {
  outskirtsSnow.update(0.1, i * 0.1, { timeId: 'day', rainIntensity: 0, snowIntensity: 0.95, wind: 0.95 }, ferryPlayer);
  const st = outskirtsSnow.getStats();
  if (st.extSteamVisible) {
    sawExtBreath = true;
    maxExtBreathPuffs = Math.max(maxExtBreathPuffs, st.steamActivePuffs);
  }
  const evs = outskirtsSnow.consumeEvents();
  if (evs.length) ferryEvents.push(...evs);
}
assert.ok(outskirtsSnow.getStats().snowAccum > 0.5, `progressive snowfall builds thick snowAccum (got ${outskirtsSnow.getStats().snowAccum})`);
assert.ok(outskirtsSnow.getStats().lanternsLit && outskirtsSnow.getStats().lanternPower > 0.45, 'heavy winter snowfall lights warm shelter & raft lanterns');
assert.ok(sawExtBreath && maxExtBreathPuffs > 0, `winter near Wuling ferry emits cold-air breath wisps (maxPuffs=${maxExtBreathPuffs})`);
assert.ok(compiledBridgeShader.uniforms.uProgSnowAccum.value > 0.5, 'shared uniform drives village bridge & raft snow cover');
assert.notEqual(ferryNetMesh.rotation.z, netRotBefore, 'ferry drying net sways under creek breeze');
assert.ok(ferryEvents.some(e => e.type === 'raftKnock'), 'ferry emits spatial raftKnock event near bamboo raft');
assert.ok(ferryEvents.some(e => e.type === 'netRustle'), 'ferry emits spatial netRustle event near drying net');

// 村口施茶瓦瓮冬夜热茗蒸汽 + 门洞裁剪隔离校验
const teaSite = outskirtsSnow.sites.find(s => s.id === 'entrance-tea-shelter');
assert.ok(teaSite, 'entrance-tea-shelter site exists');
const teaPlayer = { x: teaSite.x + 2.0, y: teaSite.y, z: teaSite.z + 1.8 };
for (let i = 0; i < 40; i++) {
  outskirtsSnow.update(0.1, 20 + i * 0.1, { timeId: 'night', rainIntensity: 0, snowIntensity: 0, wind: 0.4 }, teaPlayer);
}
assert.ok(outskirtsSnow.getStats().lanternPower > 0.95, 'night lights ferry & tea-shelter lanterns at full warm glow');
assert.equal(outskirtsSnow.getStats().intSteamVisible, true, 'winter night near village entrance emits curling tea-jar steam');
assert.ok(outskirtsSnow.getStats().steamActivePuffs >= 10, `tea-jar emits full curling puff plume (got ${outskirtsSnow.getStats().steamActivePuffs})`);

// 门洞裁剪隔离：洞内不可见时不绘制村口热气；洞外不可见时不绘制渡口呵气
outskirtsSnow.interiorGroup.visible = false;
outskirtsSnow.update(0.05, 24.5, { timeId: 'night', rainIntensity: 0, snowIntensity: 0.6, wind: 0.4 }, teaPlayer);
assert.equal(outskirtsSnow.getStats().intSteamVisible, false, 'portal culling hides interior tea steam when interiorGroup is hidden');
outskirtsSnow.interiorGroup.visible = true;
outskirtsSnow.exteriorGroup.visible = false;
outskirtsSnow.update(0.05, 24.6, { timeId: 'day', rainIntensity: 0, snowIntensity: 0.8, wind: 0.4 }, ferryPlayer);
assert.equal(outskirtsSnow.getStats().extSteamVisible, false, 'portal culling hides exterior breath wisps when exteriorGroup is hidden');
outskirtsSnow.exteriorGroup.visible = true;

// 暮/夜灯光更亮且 dt === 0 冻结灯光、积雪、网摆与热气位置
outskirtsSnow.update(0.05, 24.7, { timeId: 'night', rainIntensity: 0, snowIntensity: 0, wind: 0.4 }, teaPlayer);
const intSteamPts = outskirtsSnow.interiorGroup.getObjectByName('wuling-outskirts-int-steam');
assert.ok(intSteamPts?.isPoints, 'wuling-outskirts-int-steam Points exists inside interiorGroup');
const accumFrozen = outskirtsSnow.getStats().snowAccum;
const netFrozen = ferryNetMesh.rotation.z;
const lanternFrozen = outskirtsSnow.getStats().lanternPower;
const steamY0Frozen = intSteamPts.geometry.attributes.position.array[1];
outskirtsSnow.update(0, 99, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 1.4 }, teaPlayer);
assert.equal(outskirtsSnow.getStats().snowAccum, accumFrozen, 'dt === 0 freezes progressive snow accumulation');
assert.equal(ferryNetMesh.rotation.z, netFrozen, 'dt === 0 freezes ferry net sway');
assert.equal(outskirtsSnow.getStats().lanternPower, lanternFrozen, 'dt === 0 freezes lantern power');
assert.equal(intSteamPts.geometry.attributes.position.array[1], steamY0Frozen, 'dt === 0 freezes tea-jar steam particles');

// 远离渡口与茶寮（>28m）时不触发渡口近距声景事件也不绘制远距蒸汽/呵气；切回晴昼自动熄灯
for (let i = 0; i < 120; i++) {
  outskirtsSnow.update(0.1, 30 + i * 0.1, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 0.9 }, { x: 30, y: 2, z: -120 });
}
assert.equal(outskirtsSnow.consumeEvents().length, 0, 'distant player inside village receives 0 exterior ferry events');
assert.equal(outskirtsSnow.getStats().lanternsLit, false, 'lanterns extinguish cleanly in clear daytime');
assert.equal(outskirtsSnow.getStats().extSteamVisible, false, 'distant player does not render exterior breath wisps');
assert.equal(outskirtsSnow.getStats().intSteamVisible, false, 'distant player (>28m) does not render tea-jar steam');

// 回春晴昼零额外蒸汽 draw call；互动掬饮山茗（E）触发短时暖茗热气并在 dt===0 时冻结、约 4 秒后自然散尽
outskirtsSnow.setPhenology('spring');
assert.equal(outskirtsSnow.getStats().snowAccum, 0, 'returning to spring resets progressive snow accumulation to 0');
outskirtsSnow.update(0.05, 43.0, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 0.4 }, teaPlayer);
assert.equal(outskirtsSnow.getStats().intSteamVisible, false, 'spring clear daytime hides tea-jar steam before sipping');
assert.equal(outskirtsSnow.getStats().extSteamVisible, false, 'spring clear daytime hides breath wisps');
const sipRes = outskirtsSnow.interactById('entrance-tea-shelter', null, null);
assert.equal(sipRes?.id, 'entrance-tea-shelter', 'interactById triggers entrance-tea-shelter sip');
assert.ok(outskirtsSnow.getStats().teaSteamBoost > 0.95, 'sipping mountain tea boosts warm steam burst');
outskirtsSnow.update(0.05, 43.05, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 0.4 }, teaPlayer);
assert.equal(outskirtsSnow.getStats().intSteamVisible, true, 'sipping tea emits brief warm steam even in spring daytime');
assert.ok(outskirtsSnow.getStats().steamActivePuffs >= 10, 'tea sip burst emits full curling plume');
const boostFrozen = outskirtsSnow.getStats().teaSteamBoost;
outskirtsSnow.update(0, 999, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 0.4 }, teaPlayer);
assert.equal(outskirtsSnow.getStats().teaSteamBoost, boostFrozen, 'dt === 0 freezes teaSteamBoost decay');
for (let i = 0; i < 45; i++) {
  outskirtsSnow.update(0.1, 43.2 + i * 0.1, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 0.4 }, teaPlayer);
}
assert.equal(outskirtsSnow.getStats().teaSteamBoost, 0, 'teaSteamBoost decays cleanly to 0 after ~4s');
assert.equal(outskirtsSnow.getStats().intSteamVisible, false, 'spring tea steam hides cleanly back to 0 draws after burst');
assert.equal(outskirtsSnow.getStats().snowFootprints, 0, 'spring clear daytime leaves 0 snow footprints');
assert.equal(outskirtsSnow.getStats().snowFootprintVisible, false, 'snow footprints cost 0 draw calls in spring');
assert.equal(outskirtsSnow.getStats().cragCloudVisible, false, 'crag cloud belt fades out cleanly to 0 draw calls in clear spring daytime');

// 冬雪踏雪浅印（步距落印、木桥/行舟/御风豁免、门洞隔离、dt===0 冻结、落雪渐平、回春清零）+ 中景山腰墨韵云带随风慢移
outskirtsSnow.setPhenology('winter');
let walkX = 31.0;
const walkZ = 195.0;
for (let stepIdx = 0; stepIdx < 10; stepIdx++) {
  walkX += 0.42;
  const wy = terrain.field.sample(walkX, walkZ);
  outskirtsSnow.update(0.1, 50 + stepIdx * 0.1, { timeId: 'day', rainIntensity: 0, snowIntensity: 0.75, wind: 0.9, getAppearance: () => ({ fogColor: '#DFE7EB' }) }, { x: walkX, y: wy, z: walkZ, aboardSkiff: false, onWood: false });
}
const fpStats = outskirtsSnow.getStats();
assert.ok(fpStats.snowFootprints >= 4 && fpStats.snowFootprintVisible, `winter outdoor walking stamps snow footprints (got ${fpStats.snowFootprints})`);
assert.equal(fpStats.cragCloudVisible, true, 'winter snowfall shows drifting mid-ground crag ink cloud belt');
assert.ok(fpStats.cragCloudOpacity > 0.25, `crag cloud belt builds translucent ink veil (got ${fpStats.cragCloudOpacity})`);

// 门洞裁剪隔离：隐藏洞外时洞外脚印同步隐去，恢复可见时重新显现
outskirtsSnow.exteriorGroup.visible = false;
outskirtsSnow.update(0.05, 51.1, { timeId: 'day', rainIntensity: 0, snowIntensity: 0.75, wind: 0.9 }, { x: walkX, y: terrain.field.sample(walkX, walkZ), z: walkZ });
assert.equal(outskirtsSnow.getStats().snowFootprintVisible, false, 'portal culling hides exterior snow footprints when exteriorGroup is hidden');
outskirtsSnow.exteriorGroup.visible = true;
outskirtsSnow.update(0.05, 51.15, { timeId: 'day', rainIntensity: 0, snowIntensity: 0.75, wind: 0.9 }, { x: walkX, y: terrain.field.sample(walkX, walkZ), z: walkZ });
assert.equal(outskirtsSnow.getStats().snowFootprintVisible, true, 'exterior snow footprints reappear when exteriorGroup returns');

// dt === 0 冻结雪印计数、衰减与中景云带漂移
const fpCountFrozen = outskirtsSnow.getStats().snowFootprints;
const cragDriftFrozen = outskirtsSnow.getStats().cragCloudDrift;
outskirtsSnow.update(0, 999, { timeId: 'day', rainIntensity: 0, snowIntensity: 1.0, wind: 2.0 }, { x: walkX + 2.0, y: terrain.field.sample(walkX + 2.0, walkZ), z: walkZ });
assert.equal(outskirtsSnow.getStats().snowFootprints, fpCountFrozen, 'dt === 0 freezes snow footprints');
assert.equal(outskirtsSnow.getStats().cragCloudDrift, cragDriftFrozen, 'dt === 0 freezes crag cloud belt drift');

// 乘舟或走木桥时不追加新雪印；原地停驻于大雪中约 12 秒雪印自然被落雪抚平隐藏
const beforeWoodFp = outskirtsSnow.getStats().snowFootprints;
outskirtsSnow.update(0.1, 51.3, { timeId: 'day', rainIntensity: 0, snowIntensity: 0.9, wind: 0.9 }, { x: walkX + 1.5, y: terrain.field.sample(walkX + 1.5, walkZ), z: walkZ, onWood: true });
assert.ok(outskirtsSnow.getStats().snowFootprints <= beforeWoodFp, 'walking on wooden bridge does not stamp snow footprints');
for (let i = 0; i < 130; i++) {
  outskirtsSnow.update(0.1, 52 + i * 0.1, { timeId: 'day', rainIntensity: 0, snowIntensity: 0.95, wind: 1.0 }, { x: walkX, y: terrain.field.sample(walkX, walkZ), z: walkZ });
}
assert.equal(outskirtsSnow.getStats().snowFootprints, 0, 'heavy snowfall smoothly fills in old snow footprints');
assert.equal(outskirtsSnow.getStats().snowFootprintVisible, false, 'filled-in snow footprints hide cleanly back to 0 draws');
assert.ok(outskirtsSnow.getStats().cragCloudDrift > cragDriftFrozen + 0.2, 'crag cloud belt drifts smoothly under winter wind');

// 武陵渡口竹筏随波水墨余波（与 raftKnock 声景同步荡开）、晨昏云缘流金、远距灯晕 LOD 剔除
let sawRaftWakePulse = false;
for (let i = 0; i < 140; i++) {
  outskirtsSnow.update(0.1, 70 + i * 0.1, { timeId: 'dusk', rainIntensity: 0, snowIntensity: 0.35, wind: 0.95 }, ferryPlayer);
  if (outskirtsSnow.getStats().raftWakePulse > 0.2) sawRaftWakePulse = true;
}
assert.equal(outskirtsSnow.getStats().raftWakeVisible, true, 'bamboo raft water wake ripples render near Wuling ferry');
assert.equal(sawRaftWakePulse, true, 'raftKnock synchronously triggers expanding cedar-stake water ripple pulse');
assert.ok(outskirtsSnow.getStats().cragCloudSunRim > 0.45, `dusk gilds sunward crag cloud rim (got ${outskirtsSnow.getStats().cragCloudSunRim})`);
assert.equal(outskirtsSnow.getStats().extIciclesVisible, true, 'winter ferry pavilion displays eave icicles');
assert.equal(outskirtsSnow.getStats().intIciclesVisible, true, 'winter village tea shelter & cottages display merged eave icicles');
assert.equal(outskirtsSnow.getStats().extShoreIceVisible, true, 'winter Wuling Creek displays merged shoreline shelf ice');
assert.ok(outskirtsSnow.getStats().extShoreIceTris >= 120, `Wuling Creek shore ice has organic multi-cove low-poly geometry (got ${outskirtsSnow.getStats().extShoreIceTris} tris)`);
assert.ok(outskirtsSnow.getStats().extShoreIceOpacity > 0.65, `snow accumulation thickens creek shore ice opacity (got ${outskirtsSnow.getStats().extShoreIceOpacity})`);
const shoreIceMesh = outskirtsSnow.exteriorGroup.getObjectByName('wuling-ext-shore-ice');
assert.ok(shoreIceMesh?.isMesh && shoreIceMesh.geometry?.attributes?.position && shoreIceMesh.geometry?.attributes?.color, 'wuling-ext-shore-ice mesh exists inside exteriorGroup with vertex colors');
{
  const sp = shoreIceMesh.geometry.attributes.position;
  for (let vi = 0; vi < sp.count; vi++) {
    const vx = sp.getX(vi), vy = sp.getY(vi), vz = sp.getZ(vi);
    assert.ok(Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz), 'shore ice vertices are finite');
    assert.ok(vy >= waterY + 0.02, `shore ice vertex sits above creek plane (y=${vy.toFixed(3)})`);
    assert.ok(vy >= terrain.field.sample(vx, vz) + 0.015, 'shore ice vertex never clips beneath bank terrain');
  }
}
const shoreIceOpacityFrozen = outskirtsSnow.getStats().extShoreIceOpacity;
outskirtsSnow.update(0, 999, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 0.2 }, ferryPlayer);
assert.equal(outskirtsSnow.getStats().extShoreIceOpacity, shoreIceOpacityFrozen, 'dt === 0 freezes creek shore ice opacity');
const winterWoodRes = outskirtsSnow.interactById('woodcutter-rest', null, null);
assert.ok(winterWoodRes?.line?.includes('寒溪岸冰'), 'woodcutter-rest site renders winter frost & shore-ice inscription');
assert.ok(outskirtsSnow.getStats().villageIcicleHouses >= 8, `merged village cottage icicles cover all village houses in 1 batch (got ${outskirtsSnow.getStats().villageIcicleHouses})`);
assert.ok(outskirtsSnow.getStats().icicleScale > 0.72, `snow accumulation grows winter eave icicles (got ${outskirtsSnow.getStats().icicleScale})`);
const intIcicleMesh = outskirtsSnow.interiorGroup.getObjectByName('wuling-int-icicles');
assert.ok(intIcicleMesh?.geometry?.attributes?.aAnchorY, 'merged village icicles carry per-vertex aAnchorY eave root attribute');
const compiledIcicleShader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
intIcicleMesh.material.onBeforeCompile(compiledIcicleShader, null);
assert.ok(compiledIcicleShader.uniforms.uIcicleGrow && compiledIcicleShader.vertexShader.includes('aAnchorY'), 'icicle shader grows downward cleanly from per-house eave anchorY');

// 「静听（C）」冬日雪韵雅句校验（含名胜冬雪、冬晴冰檐滴水、冬夜渔火与空谷冬韵及春日还原）
const { createQuiet } = await import('../src/systems/quiet.js');
const teaSpot = outskirtsSnow.quietSpots.find(q => q.id === 'outskirt-tea-bench');
const ferrySpot = outskirtsSnow.quietSpots.find(q => q.id === 'wuling-ferry-bench');
assert.ok(teaSpot?.winterLine?.includes('冰凌') && teaSpot?.winterClearLine?.includes('滴水'), 'tea shelter quiet spot includes snowfall & clear-day thaw poetic lines');
assert.ok(ferrySpot?.winterClearLine?.includes('冰檐滴玉') && ferrySpot?.winterNightLine?.includes('两盏渔火'), 'ferry quiet spot includes winter clear-day & winter night poetic lines');
const qPlayer = { state: { x: teaSpot.x, y: 2, z: teaSpot.z, vx: 0, vz: 0, speed: 0 } };
const qListeners = [];
const qWin = { addEventListener: (ev, fn) => { if (ev === 'keydown') qListeners.push(fn); } };
const qInst = createQuiet(qPlayer, null, outskirtsSnow.quietSpots, { doc: mockDoc, win: qWin });
for (const fn of qListeners) fn({ code: 'KeyC', repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault() {} });
assert.equal(qInst.active, true, 'KeyC activates quiet-listen near tea shelter');
qInst.update({ timeId: 'day', weatherId: 'snow', snowIntensity: 0.85 }, { currentId: 'winter' });
assert.ok(getEl('quiet-notice').textContent.includes('静听 · 村口施茶草寮') && getEl('quiet-notice').textContent.includes('瓦瓮姜茗生烟'), 'winter snowfall quiet-listen renders bespoke tea-shelter verse');
qInst.update({ timeId: 'day', weatherId: 'clear', snowIntensity: 0, rainIntensity: 0 }, { currentId: 'winter' });
assert.ok(getEl('quiet-notice').textContent.includes('雪霁晴昼') && getEl('quiet-notice').textContent.includes('叮咚滴水'), 'winter clear midday quiet-listen at tea shelter renders icicle-thaw verse');
qPlayer.state.x = ferrySpot.x; qPlayer.state.z = ferrySpot.z;
qInst.update({ timeId: 'day', weatherId: 'clear', snowIntensity: 0, rainIntensity: 0 }, { currentId: 'winter' });
assert.ok(getEl('quiet-notice').textContent.includes('晴午冰檐滴玉') && getEl('quiet-notice').textContent.includes('寒溪薄冰'), 'winter clear midday quiet-listen at Wuling ferry renders shore-ice thaw verse');
qInst.update({ timeId: 'night', weatherId: 'clear', snowIntensity: 0, rainIntensity: 0 }, { currentId: 'winter' });
assert.ok(getEl('quiet-notice').textContent.includes('寒星低垂溪湾') && getEl('quiet-notice').textContent.includes('两盏渔火'), 'winter night quiet-listen at Wuling ferry renders fishing-lantern verse');
qPlayer.state.x = 0; qPlayer.state.z = -120;
qInst.update({ timeId: 'day', weatherId: 'snow', snowIntensity: 0.85 }, { currentId: 'winter' });
assert.ok(getEl('quiet-notice').textContent.includes('桃源山水') && getEl('quiet-notice').textContent.includes('朔雪落岭无声'), 'open-valley winter snow quiet-listen renders winter verse');
qInst.update({ timeId: 'day', weatherId: 'clear', snowIntensity: 0, rainIntensity: 0 }, { currentId: 'winter' });
assert.ok(getEl('quiet-notice').textContent.includes('桃源山水') && getEl('quiet-notice').textContent.includes('雪霁初晴'), 'open-valley winter clear midday quiet-listen renders thaw verse');
qInst.update({ timeId: 'day', weatherId: 'clear', snowIntensity: 0 }, { currentId: 'spring' });
assert.ok(getEl('quiet-notice').textContent.includes('静听 · 桃源山水') && !getEl('quiet-notice').textContent.includes('朔雪'), 'spring clear day quiet-listen stays crisp without winter verse');
qInst.exit();

// 游记 / 风物志（G / J）冬雪与武陵外郊 6 项图鉴收录、实景 LOS 可识与冬寂岸冰季节门控校验
const { catalogueEntry } = await import('../src/systems/catalogue.js');
const { illustrationSVG } = await import('../src/systems/field-guide.js');
const { collectDiscoveryTargets, resolveDiscoveryTarget, discoveryScore } = await import('../src/systems/discovery-targets.js');
const newGuideIds = [
  'wuling-ferry-pavilion',
  'wuling-bamboo-raft',
  'wuling-shore-ice',
  'wuling-creek-egret',
  'outskirt-tea-shelter',
  'outskirt-welcoming-pine'
];
for (const gid of newGuideIds) {
  const entry = catalogueEntry(gid);
  assert.ok(entry && entry.text.length > 18, `CATALOGUE includes ${gid}`);
  assert.ok(!/太守|刘子骥|遂迷/.test(entry.text), `CATALOGUE[${gid}] has zero Act 3 spoilers`);
  assert.match(illustrationSVG(entry.icon), /<svg/, `field-guide provides SVG artwork for ${gid}`);
}
const woDiscTargets = collectDiscoveryTargets({ field: terrain.field, leisureGrove: { targets: outskirtsSnow.targets } });
for (const gid of newGuideIds) {
  const anchors = woDiscTargets.filter(t => t.id === gid);
  assert.ok(anchors.length > 0, `collectDiscoveryTargets collects ${gid} from wulingOutskirts.targets`);
  let foundSight = false;
  for (const a of anchors) {
    const res = resolveDiscoveryTarget(a);
    if (!Number.isFinite(res.x)) continue;
    for (let rad = 2.4; rad <= Math.min(11, a.range) && !foundSight; rad += 1.2) {
      for (let stepA = 0; stepA < 32 && !foundSight; stepA++) {
        const ang = (stepA / 32) * Math.PI * 2;
        const ex = res.x + Math.cos(ang) * rad;
        const ez = res.z + Math.sin(ang) * rad;
        const gy = terrain.field.sample(ex, ez);
        if (!Number.isFinite(gy) || gy < waterY + 0.15) continue;
        const eye = { x: ex, y: gy + 1.62, z: ez };
        const dx = res.x - eye.x, dy = res.y - eye.y, dz = res.z - eye.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const sc = discoveryScore(eye, { x: dx / d, y: dy / d, z: dz / d }, res, outskirtsSnow.blockers, terrain.field);
        if (Number.isFinite(sc)) foundSight = true;
      }
    }
  }
  assert.equal(foundSight, true, `${gid} has an unobstructed dry-ground observation viewpoint in winter`);
}
// 施茶瓦瓮交互同步收录图鉴
const observedLog = [];
outskirtsSnow.bind({ journal: { observe: id => { observedLog.push(id); return true; } } });
const teaObsRes = outskirtsSnow.interactById('entrance-tea-shelter', null, null);
assert.ok(teaObsRes && observedLog.includes('outskirt-tea-shelter'), 'sipping winter tea records outskirt-tea-shelter into journal');
// 寒溪薄冰缘在回春后自动退出可识集合（resolve -> NaN）
outskirtsSnow.setPhenology('spring');
const springIceResolved = woDiscTargets.filter(t => t.id === 'wuling-shore-ice').map(resolveDiscoveryTarget);
assert.ok(springIceResolved.every(r => !Number.isFinite(r.x)), 'wuling-shore-ice discovery target is strictly hidden in spring');
outskirtsSnow.setPhenology('winter');

// 冬日施茶瓦瓮互动文案自动切换为热陈桑姜茗；白鹭视锥裁剪与紧致包围球生效
const winterTeaRes = outskirtsSnow.interactById('entrance-tea-shelter', null, null);
assert.ok(winterTeaRes?.line?.includes('陈桑姜茗') && winterTeaRes.line.includes('冰凌'), 'winter tea-jar interaction shows warm winter ginger-mulberry tea note');
const egretBody = outskirtsSnow.exteriorGroup.getObjectByName('wuling-outskirts-egret-body');
assert.equal(egretBody?.frustumCulled, true, 'egret instanced mesh enables tight frustum culling');
assert.ok(egretBody?.boundingSphere?.radius > 0 && egretBody.boundingSphere.radius < 95, 'egret bounding sphere tightly bounds creek shoal flock');

// 校验 community-actors 分批紧致包围球（相隔 80m 的长者与妇人头部批次各自独立紧致裁剪，不再共享巨型包围球）
const { createCommunityActors } = await import('../src/systems/community-actors.js');
const testRigGroup = new THREE.Group();
const testRig = createCommunityActors(testRigGroup, 4);
const dummyPose = { walk: 0, crouch: 0, lean: 0, nod: 0, headTurn: 0, left: [-0.2, 1.0, 0.2], right: [0.2, 1.0, 0.2] };
testRig.begin();
testRig.actor(0, 0, 0, 0, 1);
testRig.human({ index: 0, kind: 'elder', female: false }, dummyPose);
testRig.actor(80, 0, 0, 0, 1);
testRig.human({ index: 1, kind: 'adult', female: true }, dummyPose);
testRig.finish();
const elderHeadMesh = testRigGroup.getObjectByName('community-life-elderHead');
const femaleHeadMesh = testRigGroup.getObjectByName('community-life-femaleHead');
assert.ok(elderHeadMesh.boundingSphere.radius < 10 && Math.abs(elderHeadMesh.boundingSphere.center.x - 0) < 1, 'elderHead batch gets tight bounding sphere around elder only');
assert.ok(femaleHeadMesh.boundingSphere.radius < 10 && Math.abs(femaleHeadMesh.boundingSphere.center.x - 80) < 1, 'femaleHead batch gets tight bounding sphere around female only');
testRig.dispose();

const wakePulseFrozen = outskirtsSnow.getStats().raftWakePulse;
outskirtsSnow.update(0, 999, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 1.5 }, ferryPlayer);
assert.equal(outskirtsSnow.getStats().raftWakePulse, wakePulseFrozen, 'dt === 0 freezes raft wake ripple pulse');

// 雪霁初晴·冰檐化水微滴校验：降雪/夜色时凝冰不滴；冬晴昼靠近施茶草寮时偶落水滴并触发 dewDrop 空间微响，dt===0 冻结
assert.equal(outskirtsSnow.getStats().thawDripsVisible, false, 'dusk/snowfall freezes icicle thaw drips (0 draws)');
let sawThawDrip = false;
let sawThawAudio = false;
for (let i = 0; i < 60; i++) {
  outskirtsSnow.update(0.1, 80 + i * 0.1, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 0.3 }, teaPlayer);
  if (outskirtsSnow.getStats().thawDripsVisible && outskirtsSnow.getStats().thawDripsActive > 0) sawThawDrip = true;
  const evs = outskirtsSnow.consumeEvents();
  if (evs.some(e => e.type === 'dewDrop')) sawThawAudio = true;
}
assert.equal(sawThawDrip, true, 'clear winter midday near tea shelter emits sunlit icicle thaw drips');
assert.equal(sawThawAudio, true, 'icicle thaw drip triggers gentle spatial dewDrop audio event');
const thawPts = outskirtsSnow.group.getObjectByName('wuling-icicle-thaw-drips');
const thawY0 = thawPts?.geometry?.attributes?.position?.array?.[1];
outskirtsSnow.update(0, 999, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 0.3 }, teaPlayer);
assert.equal(thawPts?.geometry?.attributes?.position?.array?.[1], thawY0, 'dt === 0 freezes falling icicle thaw drips');

// 门洞隔离与远距剔除：隐藏洞外时竹筏余波与洞外冰凌隐去；夜色凝冰停滴；深入村北远距时自动收起村口草寮灯晕精灵
outskirtsSnow.exteriorGroup.visible = false;
outskirtsSnow.update(0.05, 87.0, { timeId: 'night', rainIntensity: 0, snowIntensity: 0, wind: 0.4 }, { x: 30, y: 2, z: -170 });
assert.equal(outskirtsSnow.getStats().raftWakeVisible, false, 'portal culling hides raft wake when exteriorGroup is hidden');
assert.equal(outskirtsSnow.getStats().extIciclesVisible, false, 'portal culling hides exterior eave icicles when exteriorGroup is hidden');
assert.equal(outskirtsSnow.getStats().extShoreIceVisible, false, 'portal culling hides Wuling Creek shore ice when exteriorGroup is hidden');
assert.equal(outskirtsSnow.getStats().thawDripsVisible, false, 'winter night freezes icicle thaw drips back to 0 draws');
const farTeaGlow = outskirtsSnow.interiorGroup.getObjectByName('outskirt-tea-lantern-glow');
if (farTeaGlow) assert.equal(farTeaGlow.visible, false, 'distant lantern glow sprite culls cleanly beyond 78m');
outskirtsSnow.exteriorGroup.visible = true;

outskirtsSnow.setPhenology('spring');
for (let i = 0; i < 50; i++) {
  outskirtsSnow.update(0.1, 90 + i * 0.1, { timeId: 'day', rainIntensity: 0, snowIntensity: 0, wind: 0.5 }, { x: 30, y: 2, z: -120 });
}
assert.equal(outskirtsSnow.getStats().cragCloudVisible, false, 'returning to clear spring day hides crag cloud belt (0 draws)');
assert.equal(outskirtsSnow.getStats().raftWakeVisible, false, 'distant player (>44m) hides bamboo raft wake (0 draws)');
assert.equal(outskirtsSnow.getStats().extIciclesVisible, false, 'spring hides exterior eave icicles (0 draws)');
assert.equal(outskirtsSnow.getStats().intIciclesVisible, false, 'spring hides interior eave icicles (0 draws)');
assert.equal(outskirtsSnow.getStats().extShoreIceVisible, false, 'spring hides Wuling Creek shore ice (0 draws)');
assert.equal(outskirtsSnow.getStats().thawDripsVisible, false, 'spring hides icicle thaw drips (0 draws)');

outskirtsSnow.dispose();
assert.equal(mockLgMat.onBeforeCompile, origLgHook, 'dispose restores leisure-grove-solid onBeforeCompile');
assert.equal(mockQmMat.onBeforeCompile, origQmHook, 'dispose restores qianmo-paths-solid onBeforeCompile');
mockLgMesh.geometry.dispose(); mockLgMat.dispose();
mockQmMesh.geometry.dispose(); mockQmMat.dispose();

// 4c. 声景合成与计数校验（raftKnock / netRustle + worldSync 可枚举键兼容 + 静雪高频柔化）
class FakeParam {
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}
class FakeNode {
  constructor() {
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.Q = new FakeParam(1);
    this.pan = new FakeParam(0);
    this.playbackRate = new FakeParam(1);
    this.threshold = new FakeParam(-16);
    this.knee = new FakeParam(22);
    this.ratio = new FakeParam(4);
    this.attack = new FakeParam(0.005);
    this.release = new FakeParam(0.25);
    this.fftSize = 256;
    this.frequencyBinCount = 128;
  }
  connect(dest) { return dest; }
  disconnect() {}
  start() {}
  stop() { if (this.onended) this.onended(); }
  getByteTimeDomainData(a) { a.fill(128); }
  getByteFrequencyData(a) { a.fill(0); }
}
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 1.0; this.sampleRate = 44100; this.destination = new FakeNode(); }
  resume() { return Promise.resolve(); }
  createGain() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createAnalyser() { return new FakeNode(); }
  createConvolver() { return new FakeNode(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
}
const soundRawSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
assert.equal(soundRawSrc.includes('console.log('), false, 'zero console.log in src/systems/sound.js');
const soundModSrc = soundRawSrc
  .replace("import world from '../data/world.json';", `const world = ${JSON.stringify(world)};`)
  .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = { version: 1, clips: [] };')
  .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(soundModSrc).toString('base64'));
globalThis.window.AudioContext = FakeAudioContext;
const sound = createSound({
  field: terrain.field, distanceToRiver, riverSpine, village, cliff,
  audioCatalogue: { version: 1, clips: [] },
  audioFetch: async () => ({ ok: false })
});
sound.unlock();
const ferrySh = outskirtsA.shelters.find(s => s.id === 'wuling-ferry-pavilion');
assert.ok(ferrySh && Number.isFinite(ferrySh.rx) && Number.isFinite(ferrySh.eaveY), 'Wuling ferry pavilion provides acoustic shelter bounds');
sound.update(0.05, 1.0, { position: { x: ferrySh.x, y: ferrySh.y + 1.4, z: ferrySh.z }, rotation: { y: 0 } }, { x: ferrySh.x, y: ferrySh.y, z: ferrySh.z, yaw: 0 }, false);
sound.syncWorld(0.05, {
  rain: 0,
  snow: 0.9,
  phenology: 'winter',
  shelters: outskirtsA.shelters,
  events: [
    { type: 'raftKnock', x: 29, z: 192, intensity: 0.7 },
    { type: 'netRustle', x: 33, z: 193, intensity: 0.65 }
  ]
});
const sStats = sound.getStats();
assert.deepEqual(
  Object.keys(sStats.worldSync),
  ['laundryPounds', 'wheelCreaks', 'gateCreaks', 'roosterCrows', 'gathers'],
  'worldSync enumerable keys strictly preserved'
);
assert.equal(sStats.completionSync.raftKnocks, 1, 'syncWorld dispatches raftKnock and increments completionSync');
assert.equal(sStats.completionSync.netRustles, 1, 'syncWorld dispatches netRustle and increments completionSync');
assert.ok(sStats.completionSync.shelter > 0.2, 'Wuling ferry pavilion activates acoustic shelter muffling');

// 冬寂户外踏雪步声（避雨棚外草地/土路触发踏雪，木桥与春季草地不触发）
sound.syncWorld(0.05, { rain: 0, snow: 0, phenology: 'spring', shelters: [] });
for (let k = 0; k < 10; k++) {
  const z = 198 - k * 0.4;
  sound.update(0.1, 2 + k * 0.1, { position: { x: 26, y: 2.5, z }, rotation: { y: 0 } }, { x: 26, y: 1.2, z, yaw: 0, onWood: false, wading: false }, false);
}
assert.equal(sound.getStats().completionSync.snowSteps, 0, 'spring walking produces zero winter snow steps');

// 切入冬寂并离开避雨棚，户外草地步行应触发踏雪微响
for (let k = 0; k < 12; k++) {
  sound.syncWorld(0.1, { rain: 0, snow: 0.85, phenology: 'winter', shelters: [] });
}
for (let k = 0; k < 10; k++) {
  const z = 194 - k * 0.4;
  sound.update(0.1, 4 + k * 0.1, { position: { x: 26, y: 2.5, z }, rotation: { y: 0 } }, { x: 26, y: 1.2, z, yaw: 0, onWood: false, wading: false }, false);
}
const snowStepsAfterWalk = sound.getStats().completionSync.snowSteps;
assert.ok(snowStepsAfterWalk >= 2, `winter outdoor grass/dirt walking emits snow-crunch footsteps (got ${snowStepsAfterWalk})`);

// 木桥踏步不触发踏雪步声
for (let k = 0; k < 10; k++) {
  const z = 190 - k * 0.4;
  sound.update(0.1, 6 + k * 0.1, { position: { x: 26, y: 2.5, z }, rotation: { y: 0 } }, { x: 26, y: 1.2, z, yaw: 0, onWood: true, wading: false }, false);
}
assert.equal(sound.getStats().completionSync.snowSteps, snowStepsAfterWalk, 'wooden bridge footsteps keep wood resonance instead of snow crunch');
sound.disposeSamples();

// 4d. 零 console.log 审查
for (const rel of [
  'src/world/wuling-outskirts.js',
  'src/systems/villager-dialogue.js',
  'src/systems/scroll-studio.js',
  'src/systems/map.js',
  'src/systems/traveler-guide-cruise.js',
  'src/systems/quiet.js',
  'src/systems/catalogue.js',
  'src/systems/field-guide.js',
  'src/systems/discovery.js',
  'src/systems/discovery-targets.js',
  'src/systems/rain-water.js',
  'src/systems/weather.js',
  'src/systems/sky.js',
  'src/systems/phenology-mist.js',
  'src/world/cliff.js',
  'src/world/terrain.js',
  'src/world/ink-landscape.js'
]) {
  const txt = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  assert.equal(txt.includes('console.log('), false, `zero console.log in ${rel}`);
}

phenology.dispose();
outskirtsA.dispose();
weather.dispose();

console.log('PASS check-snow-outskirts-mountains (winter snow weather, snow-on-water & progressive bridge/raft snow, Wuling ferry breeze/acoustics, outskirts, 3D ink mountains & crags)');
