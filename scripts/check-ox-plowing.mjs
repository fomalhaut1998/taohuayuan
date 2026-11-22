import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createOxPlowing } from '../src/world/ox-plowing.js';
import { collectDiscoveryTargets, resolveDiscoveryTarget, discoveryScore } from '../src/systems/discovery-targets.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { createInteraction } from '../src/systems/interaction.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const scriptData = JSON.parse(readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8'));
const ctx2d = new Proxy({}, { get: () => () => ctx2d });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d, style: {} }) };

const river = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points), 160));
const h = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = new Float32Array(grid.attributes.position.count);
for (let i = 0; i < heights.length; i++) heights[i] = h(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);

// ---- 1) 配置与无调试日志卫生检查 ----
for (const rel of ['../src/world/ox-plowing.js', '../src/systems/fauna-models.js', '../src/systems/sound.js', '../src/systems/villager-dialogue.js']) {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.ok(!/\bconsole\.log\s*\(/.test(src), `no console.log in ${rel}`);
}
const pp = JSON.parse(readFileSync(new URL('../src/data/ox-plowing.json', import.meta.url), 'utf8')).plowedPlot;
assert.ok(pp && pp.block === 0 && pp.row === 1 && pp.col === 2, 'plowedPlot 指向 block0 row1 col2');
const blk = world.village.fields.blocks[pp.block];
const x0 = blk.x + pp.col * (blk.plot[0] + blk.gap), z0 = blk.z - pp.row * (blk.plot[1] + blk.gap);
const pw = blk.plot[0], ph = blk.plot[1];
assert.equal((pp.block + pp.row + pp.col) % 3, 0, '耕田须为旱地（非水田）');

// ---- 2) completion 跳过耕田作物 ----
const completion = createQinHanCompletion({ world, field, village, props, leisureGrove: { blockers: [], targets: [] }, qinHanHomestead: { layout: {} }, blockers: [] });
let cropMesh = null;
completion.group.traverse(o => { if (o.isInstancedMesh && o.name === 'qin-han-millet-crops') cropMesh = o; });
assert.ok(cropMesh, 'completion 有粟米实例 mesh');
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
let inside = 0, total = 0;
for (let i = 0; i < cropMesh.count; i++) {
  cropMesh.getMatrixAt(i, _m); _m.decompose(_p, _q, _s);
  if (_s.x < 1e-4) continue; total++;
  if (_p.x > x0 + 0.3 && _p.x < x0 + pw - 0.3 && _p.z < z0 - 0.3 && _p.z > z0 - ph + 0.3) inside++;
}
assert.equal(inside, 0, `耕田内无粟米实例（inside=${inside}, total=${total}）`);
assert.ok(total > 200, '其余田块作物仍在');

// ---- 3) 模块契约与精细耕牛建模校验 ----
const ox = createOxPlowing({ world, field, homestead: { layout: {} } });
assert.ok(ox.group && ox.group.children.length >= 3, 'group 含翻土底/犁沟/刚体批');
const b0 = ox.blockers[0];
assert.ok(
  b0 && Number.isFinite(b0.x) && Number.isFinite(b0.z) && Number.isFinite(b0.rot) &&
  b0.hw > 0 && b0.hd > 0 && Number.isFinite(b0.minY) && Number.isFinite(b0.maxY) && (b0.maxY - b0.minY) < 1.0,
  '障碍带有限高度 minY/maxY (<1.0m)，防穿模且不误挡交谈/识物视线'
);
const tg = ox.targets[0];
assert.equal(tg.id, 'plowing-ox', '识物目标 id');
const anchor0 = tg.resolve();
assert.ok(Number.isFinite(anchor0.x) && Number.isFinite(anchor0.z) && anchor0.y > b0.maxY, 'target.resolve 锚点高于牛体碰撞盒顶面');

// 验证 G 键识物射线不被牛自身 blocker 误遮挡
const discTargets = collectDiscoveryTargets({ world, field, leisureGrove: { targets: ox.targets } });
const plowDisc = discTargets.find(t => t.id === 'plowing-ox');
assert.ok(plowDisc, 'plowing-ox 注册入识物系统');
const resolvedDisc = resolveDiscoveryTarget(plowDisc);
const eyePos = { x: resolvedDisc.x, y: field.sample(resolvedDisc.x, resolvedDisc.z + 3.8) + 1.68, z: resolvedDisc.z + 3.8 };
const lookVec = (() => {
  const dx = resolvedDisc.x - eyePos.x, dy = resolvedDisc.y - eyePos.y, dz = resolvedDisc.z - eyePos.z;
  const l = Math.hypot(dx, dy, dz);
  return { x: dx / l, y: dy / l, z: dz / l };
})();
const discScore = discoveryScore(eyePos, lookVec, resolvedDisc, ox.blockers, field);
assert.ok(Number.isFinite(discScore), `识物射线不被牛体自身碰撞盒遮挡 (score=${discScore})`);

const inter = ox.getInteractables();
assert.equal(inter.length, 2, '牛+农夫两个接触阴影 actor');
assert.ok(inter.every(a => a.owner === ox.group && Number.isFinite(a.x)), 'actor 带 owner 与坐标');
const villagers = ox.getVillagers();
assert.equal(villagers.length, 1, '暴露扶犁农夫可交谈村民');
assert.equal(villagers[0].role, 'plowman');
assert.match(villagers[0].key, /^c_[\w-]+$/, '农夫 key 兼容 taohua.journal.v1 存档');
assert.equal(ox.getAnimalObstacles()[0].kind, 'buffalo', '活体障碍 kind');

const st0 = ox.getStats();
assert.ok(st0.drawCalls >= 3 && st0.drawCalls <= 16, `模块 draw calls 经济（${st0.drawCalls}）`);
assert.ok(st0.oxBatchTriangles >= 1500 && st0.oxBatchTriangles <= 4500, `精雕耕牛+曲辕犁面数充实且克制（${st0.oxBatchTriangles}）`);
assert.ok(st0.triangles < 12000, `模块总三角面经济（${st0.triangles}）`);

// 校验顶点色丰富度与无全黑死面
const batchMesh = ox.group.getObjectByName('ox-plowing-batch');
assert.ok(batchMesh, 'ox-plowing-batch 存在');
const bPos = batchMesh.geometry.getAttribute('position');
const bNor = batchMesh.geometry.getAttribute('normal');
const bCol = batchMesh.geometry.getAttribute('color');
assert.ok(bPos.array.every(Number.isFinite) && bNor.array.every(Number.isFinite) && bCol.array.every(Number.isFinite), '刚体批顶点/法线/颜色全部有限');
const distinctShades = new Set();
for (let i = 0; i < bCol.count; i += 9) {
  const r = bCol.getX(i), g = bCol.getY(i), b = bCol.getZ(i);
  assert.ok(r > 0.008 && g > 0.008 && b > 0.008, '无纯黑死面（线性色值全大于墨阶下限）');
  distinctShades.add(`${Math.round(r * 25)}_${Math.round(g * 25)}_${Math.round(b * 25)}`);
}
assert.ok(distinctShades.size >= 12, `耕牛与曲辕犁具备丰富水墨色阶层次（${distinctShades.size} 阶）`);

// ---- 4) 行为 + 音效事件发射：白日耕作 / 沙沙声与低鸣 / dt=0 严格冻结 / 入夜风雨歇息 ----
const daySky = { timeId: 'day', sunElevation: 1, rainIntensity: 0, wind: 0, cloudCover: 0, getAppearance: () => ({}) };
const nightSky = { timeId: 'night', sunElevation: -0.3, rainIntensity: 0, wind: 0, cloudCover: 0, getAppearance: () => ({}) };
const stormSky = { timeId: 'day', sunElevation: 0.6, rainIntensity: 0.6, wind: 0.2, cloudCover: 0.7, getAppearance: () => ({}) };

ox.consumeEvents();
let scrapeCount = 0, lowCount = 0;
for (let i = 0; i < 360; i++) {
  const nearPlayer = i === 180 ? { x: ox.blockers[0].x + 2.5, z: ox.blockers[0].z + 2.0 } : null;
  ox.update(1 / 60, i / 60, daySky, nearPlayer);
  for (const ev of ox.consumeEvents()) {
    if (ev.type === 'plowScrape') scrapeCount++;
    if (ev.type === 'oxLow') lowCount++;
  }
}
const work = ox.getStats();
assert.equal(work.mode, 'work', '白日耕作');
assert.ok(work.headDist > 0.5, '犁头前进');
assert.ok(scrapeCount >= 6, `白日耕作持续发射犁土沙沙声事件（scrapeCount=${scrapeCount}）`);
assert.ok(lowCount >= 1, `玩家走近或耕间发射牛低鸣事件（lowCount=${lowCount}）`);

const bx0 = ox.blockers[0].x, bz0 = ox.blockers[0].z;
// dt=0 严格冻结（位姿、障碍、音效全冻结）
const before = JSON.stringify([ox.getStats().headDist, ox.getStats().restBlend, ox.blockers[0].x, ox.blockers[0].z, ox.getInteractables()[0].x]);
for (let i = 0; i < 30; i++) ox.update(0, 999, daySky, { x: bx0 + 1, z: bz0 + 1 });
const after = JSON.stringify([ox.getStats().headDist, ox.getStats().restBlend, ox.blockers[0].x, ox.blockers[0].z, ox.getInteractables()[0].x]);
assert.equal(before, after, 'dt=0 时犁头/歇息/障碍/识物全冻结');
assert.equal(ox.consumeEvents().length, 0, 'dt=0 时绝不产生新音效事件');

// 障碍随牛移动
for (let i = 0; i < 240; i++) ox.update(1 / 60, i / 60, daySky, null);
assert.ok(Math.abs(ox.blockers[0].x - bx0) > 0.3 || Math.abs(ox.blockers[0].z - bz0) > 0.3, '碰撞盒随牛移动');
assert.ok(Math.abs(ox.blockers[0].x - ox.getInteractables()[0].x) < 1e-6, '障碍与牛位一致');

// 入夜歇息（不再发射犁土沙沙声）
for (let i = 0; i < 900; i++) ox.update(1 / 60, i / 60, nightSky, null);
const night = ox.getStats();
assert.equal(night.mode, 'rest', '入夜歇息');
assert.ok(night.restBlend > 0.9, '曲膝卧下过渡完成');
assert.ok([...bPos.array].every(Number.isFinite), '卧姿顶点全部有限');
ox.consumeEvents();
for (let i = 0; i < 120; i++) ox.update(1 / 60, i / 60, nightSky, null);
assert.equal(ox.consumeEvents().filter(e => e.type === 'plowScrape').length, 0, '入夜歇息不发犁土沙沙声');

// 风雨歇息（先回白日复工再转风雨）
for (let i = 0; i < 900; i++) ox.update(1 / 60, i / 60, daySky, null);
assert.equal(ox.getStats().mode, 'work', '天明复工');
for (let i = 0; i < 900; i++) ox.update(1 / 60, i / 60, stormSky, null);
assert.equal(ox.getStats().mode, 'rest', '风雨歇息');

// ---- 5) WebAudio 空间合成与采样调度实证（plowScrape & oxLow）----
{
  class Param {
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
  }
  class AudioNodeMock {
    constructor(kind) {
      this.kind = kind;
      this.gain = new Param(1);
      this.frequency = new Param(440);
      this.Q = new Param(1);
      this.pan = new Param(0);
      this.playbackRate = new Param(1);
    }
    connect(n) { return n; }
    disconnect() {}
    start() {}
    stop() { this.onended?.(); }
  }
  class CtxMock {
    constructor() {
      this.currentTime = 0;
      this.state = 'suspended';
      this.sampleRate = 22050;
      this.destination = new AudioNodeMock('dest');
      this.nodes = [];
    }
    n(k) { const x = new AudioNodeMock(k); this.nodes.push(x); return x; }
    createBufferSource() { return this.n('source'); }
    createGain() { return this.n('gain'); }
    createBiquadFilter() { return this.n('filter'); }
    createStereoPanner() { return this.n('pan'); }
    createConvolver() { return this.n('convolver'); }
    createOscillator() { return this.n('osc'); }
    createDynamicsCompressor() {
      const c = this.n('comp');
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) c[k] = new Param();
      return c;
    }
    createAnalyser() {
      const a = this.n('ana');
      a.frequencyBinCount = 256;
      a.getByteTimeDomainData = arr => arr.fill(128);
      return a;
    }
    createBuffer(ch, len, sr) {
      return { duration: len / sr, length: len, numberOfChannels: ch, getChannelData: () => new Float32Array(len) };
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    async decodeAudioData() { return { duration: 2.3, length: 50715, numberOfChannels: 1 }; }
  }

  const rawSoundSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8')
    .replace("import world from '../data/world.json';", 'const world = { sound: { animals: { low: 0.6 } }, terrain: {} };')
    .replace("import catalogue from '../data/audio-samples.json';", "const catalogue = { version: 1, clips: [{ id: 'low-01', category: 'low', src: '/audio/round3/low-01.mp3' }] };")
    .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
  const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(rawSoundSrc).toString('base64'));
  const prevWin = globalThis.window, prevSetTimeout = globalThis.setTimeout;
  globalThis.window = { AudioContext: CtxMock };
  globalThis.setTimeout = (...args) => { const t = prevSetTimeout(...args); t.unref?.(); return t; };
  try {
    const snd = createSound({
      audioFetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer })
    });
    snd.unlock();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    snd.update(0.05, 1.0, null, { x: 65, y: 2, z: -78, yaw: 0 }, false);
    snd.syncWorld(0.05, {
      rain: 0,
      isNight: false,
      events: [
        { type: 'plowScrape', x: 66, z: -78, intensity: 1.0, creak: true },
        { type: 'oxLow', x: 67, z: -78 }
      ]
    });
    const sst = snd.getStats();
    assert.equal(sst.completionSync.plowScrapes, 1, 'syncWorld 触发犁土沙沙声并计数');
    assert.equal(sst.completionSync.oxLows, 1, 'syncWorld 触发耕牛低鸣并计数');
    assert.ok(sst.counts.lows >= 1 && sst.counts.rustles >= 1, 'lows 与 rustles 统计同步递增');
    snd.disposeSamples();
  } finally {
    globalThis.window = prevWin;
    globalThis.setTimeout = prevSetTimeout;
  }
}

// ---- 6) 乡民对白提及牛耕 + 扶犁农人多轮交谈 + Digit3 键选检验 ----
{
  assert.ok(scriptData.npc?.roles?.plowman?.lines?.length >= 3, 'script.json 含扶犁农人对白');
  const oxMentionRoles = ['plowman', 'worker', 'elder', 'walker', 'hut_farmer', 'child'];
  for (const r of oxMentionRoles) {
    const joined = (scriptData.npc?.roles?.[r]?.lines || []).join(' ');
    assert.ok(/牛|犁/.test(joined), `script.json 角色 ${r} 对白自然提及牛耕`);
  }

  const skyStub = { timeId: 'day', weatherId: 'clear', rainIntensity: 0 };
  const vd = createVillagerDialogue({
    sky: skyStub,
    getWorldClock: () => ({ getState: () => ({ shichenName: '巳正' }) })
  });

  // 扶犁农人多轮交谈（白日扶犁 vs 雨天歇牛）
  const plowTarget = {
    kind: 'community',
    key: 'c_plowman',
    name: '扶犁农人',
    lines: scriptData.npc.roles.plowman.lines,
    ref: { id: 'plowman', role: 'plowman', mode: 'work', activity: 'plowing' }
  };
  const turn0 = vd.beginOrAdvance(plowTarget);
  assert.ok(turn0 && turn0.who.includes('扶犁农人'), '扶犁农人身份头衔正确');
  assert.ok(turn0.meta.includes('稳扶曲木犁梢'), '状态栏描写扶犁动作');
  assert.ok(/青牯|木轭|犁/.test(turn0.line), '首轮寒暄提及耕牛与木犁');
  const turn1 = vd.chooseReply(0);
  assert.ok(/曲木犁辕|铁铧|犁壁/.test(turn1.line), '分支详解曲辕铁铧与扶犁深浅之法');
  const turn2 = vd.chooseReply(0);
  assert.equal(turn2.hasMore, false, '三轮自然收束');

  // 牧牛人与普通田夫对白联动提及东垄牛耕 + 键盘 Digit3 选第 3 项（plowing）
  const herderTurn = vd.beginOrAdvance({
    kind: 'community',
    key: 'c_herder',
    name: '牧牛人',
    lines: ['老牛泡塘泥'],
    ref: { role: 'herder', mode: 'work', activity: 'herding' }
  });
  assert.ok(/曲木犁|青牯/.test(herderTurn.line), '牧牛人对白呼应东垄扶犁耕牛');
  vd.close();

  // 验证 interaction.js 支持 Digit3 触发第 3 个回复（问田里扶犁耕牛之事）
  const els = new Map();
  const mkEl = (tag = 'div', id = '') => {
    const cls = new Set();
    const el = {
      id, tagName: tag.toUpperCase(), textContent: '', hidden: false, dataset: {}, children: [], parentNode: null,
      classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
      appendChild(ch) { ch.parentNode = el; el.children.push(ch); if (ch.id) els.set(ch.id, ch); return ch; },
      insertBefore(ch, ref) { ch.parentNode = el; const i = el.children.indexOf(ref); if (i >= 0) el.children.splice(i, 0, ch); else el.children.push(ch); if (ch.id) els.set(ch.id, ch); return ch; },
      addEventListener() {}
    };
    if (id) els.set(id, el);
    return el;
  };
  for (const id of ['prompt', 'prompt-text', 'reticle', 'talk', 'talk-who', 'talk-line']) mkEl('div', id);
  els.get('talk').appendChild(els.get('talk-who'));
  els.get('talk').appendChild(els.get('talk-line'));
  const bodyEl = mkEl('body', 'body');
  bodyEl.classList.add('curtain-open');
  const keyListeners = [];
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  globalThis.document = {
    body: bodyEl,
    hidden: false,
    createElement: tag => mkEl(tag),
    getElementById: id => els.get(id) || null,
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.window = {
    addEventListener: (ev, fn) => { if (ev === 'keydown') keyListeners.push(fn); },
    removeEventListener() {}
  };
  try {
    const pState = { state: { x: 40, y: 2, z: -90, yaw: 0, pitch: 0, view: 'third', eyeHeight: 1.65 } };
    const camTest = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
    camTest.position.set(40, 3.8, -86);
    const workerPeople = { list: [{ x: 40, y: 2, z: -91.4, s: 1, role: 'worker', mode: 'work' }], greet() {} };
    const interSys = createInteraction(
      world.interaction, scriptData, workerPeople, { animals: [], react: () => null },
      { sample: () => 2 }, pState, { voice() {} }, null
    );
    interSys.setDialogueDirector(vd);
    interSys.update(0.016, 0.1, camTest);
    for (const fn of keyListeners) fn({ code: 'KeyE', preventDefault() {} });
    assert.equal(els.get('talk').classList.contains('show'), true);
    for (const fn of keyListeners) fn({ code: 'Digit3', preventDefault() {} });
    assert.ok(els.get('talk-line').textContent.includes('曲木犁'), '按 Digit3 顺利进入田夫牛耕问答分支');
    interSys.dispose();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
}

// ---- 7) main.js 装配完整性与视口渲染预算实测 ----
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.ok(mainSrc.includes('oxPlowing.getVillagers'), 'main.js 将扶犁农人接入交谈列表');
assert.ok(mainSrc.includes('oxPlowing.greet'), 'main.js 将扶犁农人接入交谈颔首反馈');
assert.ok(mainSrc.includes('oxPlowing.consumeEvents()'), 'main.js 将牛耕音效事件接入 sound.syncWorld');
assert.ok(mainSrc.includes("'春畴牛耕'"), 'main.js 注册春畴牛耕静听点');

const scene = new THREE.Scene();
scene.add(village.group, completion.group, ox.group);
const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 420);
const frustum = new THREE.Frustum(), projMat = new THREE.Matrix4();
function measure(x, y, z, yaw, pitch) {
  cam.position.set(x, y, z); cam.rotation.set(pitch, yaw, 0); cam.updateProjectionMatrix();
  let calls = 0, triangles = 0;
  scene.updateMatrixWorld(true); cam.updateWorldMatrix(true, false);
  projMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projMat);
  (function visit(o) {
    if (!o.visible) return;
    if (o.isMesh && o.layers.test(cam.layers) && (!o.frustumCulled || frustum.intersectsObject(o))) {
      const g = o.geometry, n = o.isInstancedMesh ? o.count : 1;
      const start = g.drawRange.start, end = Math.min(g.index?.count ?? g.attributes.position.count, start + g.drawRange.count);
      if (o.material.visible) { calls++; triangles += (end - start) / 3 * n; }
    }
    for (const c of o.children) visit(c);
  })(scene);
  return { calls, triangles: Math.round(triangles) };
}
const gy = field.sample(60, -78) + 1.7;
const vpField = measure(60, gy, -78, Math.PI / 2, -0.10);
const vpWide = measure(48, field.sample(48, -70) + 2.2, -70, 0.9, -0.12);
assert.ok(vpField.calls < 200 && vpField.triangles < 450000, `田块机位预算 (${vpField.calls} calls, ${vpField.triangles} tris)`);
assert.ok(vpWide.calls < 200 && vpWide.triangles < 450000, `村落望田机位预算 (${vpWide.calls} calls, ${vpWide.triangles} tris)`);

ox.dispose(); completion.dispose?.(); village.dispose?.();
console.log(`PASS check-ox-plowing: 耕田无作物 inside=${inside}/${total}; 模块 ${st0.drawCalls} calls ${st0.triangles} tris (牛犁刚体批 ${st0.oxBatchTriangles} tris, ${distinctShades.size} 色阶); 沙沙声=${scrapeCount} 低鸣=${lowCount}; 识物/交谈/Digit3/dt=0冻结/昼夜风雨歇息 全通过; 田块机位 ${vpField.calls} calls ${vpField.triangles} tris`);
