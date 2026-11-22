import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createFlora } from '../src/world/flora.js';
import { createBarrier } from '../src/systems/barrier.js';
import { createFauna } from '../src/systems/fauna.js';
import { visibleAnimal } from '../src/systems/observation.js';
import { createJournal } from '../src/systems/journal.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const scriptData = JSON.parse(readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8'));

// ---- 1) 配置一致性 -------------------------------------------------------
const fa = world.fauna;
const kinds = fa.species.map(s => s.kind);
assert.deepEqual(kinds, ['chicken', 'dog', 'bird', 'ox', 'duck'], 'species 顺序与种类');
assert.equal(fa.species.length, 5, '五种动物');
for (const sp of fa.species) {
  const cfg = fa[sp.key];
  assert.ok(cfg && cfg.homes && cfg.homes.length, sp.key + ' 配置块存在');
  assert.ok(cfg.count > 0, sp.key + ' count>0');
  assert.ok(cfg.homes.length >= 1, sp.key + ' 至少一个家');
  assert.ok(fa.sounds[sp.kind], sp.kind + ' 有 sounds 映射');
  assert.ok(fa.gaps[sp.kind], sp.kind + ' 有 gaps 映射');
  assert.ok(fa.scales[sp.kind] !== undefined, sp.kind + ' 有 scales 映射');
  assert.ok(world.interaction.heights[sp.kind] !== undefined, sp.kind + ' 有 interaction.heights');
  assert.ok(scriptData.npc.animals[sp.kind], sp.kind + ' 有台词');
  assert.ok(world.sound.animals[fa.sounds[sp.kind]] !== undefined || fa.sounds[sp.kind] === 'cluck' || fa.sounds[sp.kind] === 'bark', sp.kind + ' 声音增益');
  const snd = fa.sounds[sp.kind];
  assert.ok(['cluck', 'bark', 'chirp', 'low', 'quack'].includes(snd), sp.kind + ' 声音函数合法');
  assert.ok(world.sound.animals[snd] === undefined || typeof world.sound.animals[snd] === 'number', sp.kind + ' 增益为数值');
}
// react 新参数全部存在
for (const k of ['flushDistance','flushTime','flushRise','flushSpeed','glanceDuration','glanceStep','glanceSpeed','nod','paddleDistance','paddleTime','paddleSpeed','rock','rockSpeed']) {
  assert.ok(typeof fa.react[k] === 'number', 'react.' + k);
}

// ---- 2) 真实场景：动物之家附近玩家能站住且视线不挡 -------------------------
const ctx = new Proxy({}, { get: () => () => ctx });
globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
const river = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points), 160));
const h = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = new Float32Array(grid.attributes.position.count);
for (let i = 0; i < heights.length; i++) heights[i] = h(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const cliff = createCliff(world.cliff, field);
const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const scenes = createVillageScenes(world, field, river, village, props, cliff, hinterland);
const basin = world.terrain.basin;
const floraField = { half: field.half, sample: (x,z) => field.sample(x,z), slope: (x,z) => Math.hypot(x-basin.x,z-basin.z) < basin.inner*1.05 ? 9 : field.slope(x,z) };
const flora = createFlora(world.flora, floraField, river, createRiverCurve(world.stream.points), world.player.spawn, () => false);
const mysteries = createMysteries(world, field, river, village, props, cliff, hinterland, scenes, flora);
const colliders = [...cliff.blockers, ...village.blockers, ...hinterland.blockers, ...scenes.blockers, ...mysteries.blockers];
const barrier = createBarrier(colliders);

function free(x, z) {
  const s = { x, z, vx: 0, vz: 0 };
  barrier.resolve(s, 0.42);
  return Math.hypot(s.x - x, s.z - z) < 1e-7;
}
// 与 interaction.js blocked() 同款：玩家与目标之间的旋转墙盒线段相交
function blocked(ax, az, bx, bz) {
  for (const b of colliders) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const x = (ax - b.x) * c - (az - b.z) * s;
    const z = (ax - b.x) * s + (az - b.z) * c;
    const dx = (bx - ax) * c - (bz - az) * s;
    const dz = (bx - ax) * s + (bz - az) * c;
    let lo = 0, hi = 1;
    for (const [v, d, half] of [[x, dx, b.hw], [z, dz, b.hd]]) {
      if (Math.abs(d) < 1e-9) { if (Math.abs(v) > half) { lo = 2; break; } }
      else { const a = (-half - v) / d, q = (half - v) / d; lo = Math.max(lo, Math.min(a, q)); hi = Math.min(hi, Math.max(a, q)); }
    }
    if (lo <= hi && lo <= 1 && hi >= 0) return true;
  }
  return false;
}
// 每个「家」在 cfg.range 内找一个玩家可站、且视线不挡的近观点
const range = world.interaction.range;
let reachChecked = 0;
for (const sp of fa.species) {
  for (const home of fa[sp.key].homes) {
    let ok = false;
    for (let a = 0; a < 16 && !ok; a++) {
      const ang = a / 16 * Math.PI * 2;
      const rr = range * 0.75;
      const sx = home[0] + Math.cos(ang) * rr;
      const sz = home[1] + Math.sin(ang) * rr;
      if (free(sx, sz) && !blocked(sx, sz, home[0], home[1])) ok = true;
    }
    assert.ok(ok, sp.key + ' 家 ' + home + ' 在互动距离内可达（存在可站且视线不挡的近观点）');
    reachChecked++;
  }
}

// ---- 3) fauna.js 真实运行：几何、种类数量、各互动态、声音分派 ------------
const calls = [];
const sound = {
  cluck: (x,z)=>calls.push(['cluck',x,z]),
  bark:  (x,z)=>calls.push(['bark',x,z]),
  chirp: (x,z)=>calls.push(['chirp',x,z]),
  low:   (x,z)=>calls.push(['low',x,z]),
  quack: (x,z)=>calls.push(['quack',x,z])
};
const fauna = createFauna(fa, field, sound);
const total = fa.species.reduce((n, sp) => n + fa[sp.key].count, 0);
assert.equal(fauna.count, total, '动物总数');
assert.equal(fauna.animals.length, total, 'animals 数组长度');
assert.equal(fauna.group.children.length, 5, '五个 InstancedMesh（每种 1 draw call）');
for (const sp of fa.species) {
  const mesh = fauna.group.children.find(m => m.name === 'fauna-' + sp.kind);
  assert.ok(mesh, sp.kind + ' 有实例网格');
  assert.equal(mesh.count, fa[sp.key].count, sp.kind + ' 实例数');
  assert.ok(mesh.geometry.attributes.color, sp.kind + ' 有顶点色');
}
// 每种动物各取第一个，E 触发 react，断言返回声音名 + 各自进入不同 mode
const modeByKind = {};
for (const sp of fa.species) {
  const globalIndex = fauna.animals.findIndex(x => x.kind === sp.kind);
  const a = fauna.animals[globalIndex];
  const call = fauna.react(globalIndex, a.x + 1, a.z + 1);
  assert.equal(call, fa.sounds[sp.kind], sp.kind + ' react 返回声音函数名');
  modeByKind[sp.kind] = a.mode;
}
assert.deepEqual(modeByKind, { chicken:'flee', dog:'follow', bird:'flush', ox:'glance', duck:'paddle' }, '五种互动模式互不相同');
// 跑足够帧：新状态产生可见动画量；玩家站在动物家群附近（否则超出 soundRadius 不叫属于正确行为）
for (let t = 0; t < 250; t++) fauna.update(0.03, t * 0.03, 36, -110);
const birdA = fauna.animals.find(x => x.kind === 'bird');
const oxA = fauna.animals.find(x => x.kind === 'ox');
const duckA = fauna.animals.find(x => x.kind === 'duck');
assert.ok(birdA.lift >= 0 && birdA.lift <= fa.react.flushRise + 1e-6, '雀腾空高度在合法区间');
assert.ok(oxA.pitch >= 0, '牛点头俯仰合法');
assert.ok(Number.isFinite(duckA.rock), '鸭轻晃数值有限');
assert.ok(calls.length > 0, 'update 中按 kind 分派出了叫声');
// 把玩家轮流放到每种动物的家旁，覆盖全部 5 种叫声映射（否则只有附近那几种会被叫到）
for (const sp of fa.species) {
  const home = fa[sp.key].homes[0];
  for (let t = 0; t < 260; t++) fauna.update(0.03, (250 + t) * 0.03, home[0] + 0.6, home[1] + 0.6);
}
const callNames = [...new Set(calls.map(c => c[0]))];
assert.ok(callNames.every(n => ['cluck','bark','chirp','low','quack'].includes(n)), '叫声均为已导出的函数');
assert.deepEqual(callNames.slice().sort(), ['bark','chirp','cluck','low','quack'], '五种叫声映射全部实际触发');
// sound.js 用 Vite 专属的非断言 JSON import，Node 不能直接 import；改为静态校验导出接线
const soundSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
for (const fn of ['chirp', 'low', 'quack']) {
  assert.ok(new RegExp('function ' + fn + '\\(x, z\\)').test(soundSrc), fn + ' 函数已定义');
  assert.ok(new RegExp(fn + ': ' + fn).test(soundSrc), fn + ' 已在返回导出表中');
  assert.ok(soundSrc.includes('stats.' + fn + 's++') || soundSrc.includes('stats.' + fn + '++'), fn + ' 已计入 stats');
}
assert.ok(soundSrc.includes('chirps: stats.chirps, lows: stats.lows, quacks: stats.quacks'), 'getStats.counts 暴露新计数');
for (const g of ['chirp', 'low', 'quack']) {
  assert.ok(typeof world.sound.animals[g] === 'number', 'world.sound.animals.' + g + ' 增益');
}

// ---- 4) observation 白名单 / journal 图鉴 --------------------------------
for (const k of kinds) {
  const eye = { x: 0, y: 2, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  // 正前方近距离的目标可被观察；仅断言白名单不被拒（dot/遮挡不合格时返回 null 也合法）
  const focus = { kind: k, name: k, x: 0, y: 1.5, z: -1 };
  // 不强制非 null（受 sightBlocked 影响），但不得抛错
  visibleAnimal(focus, eye, fwd, 20, [], { sample: () => 0 });
}
const store = {};
globalThis.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } };
const journalNode = { addEventListener() {}, setAttribute() {}, focus() {}, replaceChildren() {}, appendChild() {}, open: false, textContent: '' };
globalThis.document = { getElementById: () => journalNode, body: { classList: { contains: () => false } }, activeElement: null };
globalThis.window = { addEventListener() {} };
const journal = createJournal(world.map.pois, scriptData.points, {}, { state: { x:0, z:0 }, clearInput(){}, lock(){}, unlock(){} });
for (const k of [...kinds, 'peach', 'stream', 'cave', 'pond']) {
  assert.equal(journal.observe(k), true, k + ' 在图鉴 GUIDE 白名单内');
}

console.log(JSON.stringify({
  status: 'passed',
  species: kinds,
  animals: fauna.count,
  drawCalls: fauna.group.children.length,
  reachChecked,
  modes: modeByKind,
  soundCalls: calls.length,
  soundNames: callNames,
  guideChecked: kinds.length + 4
}));
