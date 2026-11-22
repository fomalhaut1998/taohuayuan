// 扶犁牛耕：青苍水牛负曲轭引汉晋曲辕铁铧犁，壮农短褐扶梢，田垄间往返翻土；
// 日暮或风雨便牵牛就田头曲膝卧刍歇息。牛+四肢双节+双耳+尾+轭+双挽索+曲木犁+翻泥块
// 合并为单 draw call 刚体批，翻土底与犁沟各一 mesh，犁沟用 aPathDist+uHead 着色器随犁头显形/淡出。
import * as THREE from 'three';
import {
  createRigidBatchMesh, createPartBuilder, loft, sweep, wedge, octa, ellipsoid
} from './qin-han-fauna-geometry.js';
import { createCommunityActors } from '../systems/community-actors.js';
import { livingStep } from '../systems/living-behavior.js';
import { chainProgramCacheKey } from '../systems/shader-cache-key.js';
import oxPlowingCfg from '../data/ox-plowing.json' with { type: 'json' };

// ---- 造型与行为常量（单物件具名置顶）----
const FURROW_COUNT = 8;        // 犁沟趟数
const FURROW_SPACING = 0.84;   // 沟距（米）
const PASS_INSET = 0.85;       // 趟端距田边留头
const TURN_BULGE = 1.15;       // 端头转弯外凸入阡陌间隙
const PATH_STEP = 0.22;        // 路径采样间距
const WALK_SPEED = 0.50;       // 犁地行进速度 m/s
const RETURN_SPEED = 0.78;     // 收工/回程速度
const STRIDE_FREQ = 3.4;       // 步频
const FURROW_WINDOW = 13.5;    // 新沟显形窗口（米）
const PLOW_OFFSET = 1.28;      // 犁盘 hitch 在牛中心后偏移
const HANDLE_BACK = 1.08;      // 犁梢横桄在 hitch 后偏移
const FARMER_BACK = 0.40;      // 农夫距犁梢横桄后偏移
const BODY_HEIGHT = 0.72;      // 牛体肋腹中心离地高
const REST_DROP = 0.36;        // 曲膝卧下降低量
const REST_RATE = 1.0;         // 歇息过渡速率
const HALF_W = 0.31;           // 犁沟肩半宽
const GROOVE_W = 0.095;        // 犁沟槽半宽

// 水墨青绿×秦汉乡土色阶（避纯黑死灰，拉开肩峰/肋腹/浅苍下腹/月牙白颈纹层次）
const SOIL_COLORS = ['#63523D', '#6D5B44', '#584836', '#736048'];
const FRESH_GROOVE = '#3D3022';
const FRESH_SHOULDER = '#79654B';
const SOIL_AVG = '#63523D';
const P = {
  wood: '#8E6D47',
  darkWood: '#614930',
  yokeTop: '#9A784F',
  iron: '#646C73',
  ironEdge: '#7A838A',
  hemp: '#CFC2A2',
  hempShade: '#B8AA88',
  ring: '#B68F52'
};
const HIDE_BANDS = [
  '#5C554C', '#665E54', '#6D655B', '#625A50',
  '#6B6358', '#746B5F', '#70675C', '#635B51'
];
const HIDE_HUMP = ['#6B6358', '#786E61', '#6E655A'];
const HIDE_HEAD = ['#6B6358', '#645C52', '#5B544B', '#524C45'];
const HIDE_NECK = ['#696157', '#6E665B', '#645C52'];
const HIDE_LIMB_UPPER = ['#665E54', '#5D564D'];
const HIDE_STOCKING = ['#8C8375', '#7B7366'];
const BELLY = '#867C6E';
const DEWLAP = ['#7C7366', '#8E8476'];
const CHEVRON = '#D8CFC0';
const CHEVRON_LO = '#CEC4B3';
const HOOF = '#312D28';
const HORN = ['#786E5F', '#5C554B', '#48433B', '#38342E', '#292622'];
const HORN_RING = '#857A69';
const MUZZLE = ['#4A4446', '#3F3A3C'];
const NOSTRIL = '#282324';
const EYE_INK = '#262320';
const EYE_RIM = '#BEB5A6';
const EAR_OUT = '#5B544B';
const EAR_IN = '#8E776B';
const TAIL_SWITCH = '#2D2925';
const CLOD_COLS = ['#4A3B2A', '#3E3122', '#594733'];

const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
function hash2(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// 天色读取（与 homestead/completion 同口径）
function readWeather(sky) {
  const app = sky?.getAppearance?.() ?? {};
  const rain = clamp01(sky?.rainIntensity ?? app.rainIntensity ?? 0);
  const wind = clamp01(sky?.wind ?? app.wind ?? 0);
  const cloudCover = clamp01(sky?.cloudCover ?? app.cloudCover ?? 0);
  const timeId = sky?.timeId ?? app.timeId ?? 'day';
  const sunEl = sky?.sunElevation ?? app.sunElevation ?? 1;
  const isNight = timeId === 'night' || timeId === 'dusk' || sunEl < 0.08;
  const storm = rain > 0.18 || (wind > 0.78 && cloudCover > 0.45);
  return { rain, wind, cloudCover, timeId, isNight, storm };
}

export function createOxPlowing(ctx) {
  const { world, field } = ctx;
  const group = new THREE.Group();
  group.name = 'ox-plowing';
  const surface = (x, z) => (field ? field.sample(x, z) : 0);
  const fieldLift = world?.village?.fields?.lift ?? 0.025;
  const cfg = oxPlowingCfg.plowedPlot;
  const blk = world.village.fields.blocks[cfg.block];
  const pw = blk.plot[0], ph = blk.plot[1];
  const x0 = blk.x + cfg.col * (pw + blk.gap);
  const z0 = blk.z - cfg.row * (ph + blk.gap);
  const rx0 = x0 + 0.24, rx1 = x0 + pw - 0.24;
  const rzN = z0 - 0.24, rzS = z0 - ph + 0.24;

  // ---- 蛇形犁地回路（含端头转弯与田头回程，闭合）----
  function arcPts(seg) {
    const pts = [];
    const n = 8;
    for (let k = 0; k <= n; k++) {
      const t = k / n, mt = 1 - t;
      pts.push({
        x: mt * mt * seg.a.x + 2 * mt * t * seg.c.x + t * t * seg.b.x,
        z: mt * mt * seg.a.z + 2 * mt * t * seg.c.z + t * t * seg.b.z
      });
    }
    return pts;
  }
  function buildCircuit() {
    const segs = [], xs = [];
    const xCenter = x0 + pw / 2, span = (FURROW_COUNT - 1) * FURROW_SPACING;
    for (let i = 0; i < FURROW_COUNT; i++) xs.push(xCenter - span / 2 + i * FURROW_SPACING);
    const zN = z0 - PASS_INSET, zS = z0 - ph + PASS_INSET;
    for (let i = 0; i < FURROW_COUNT; i++) {
      const even = i % 2 === 0;
      const zFrom = even ? zN : zS, zTo = even ? zS : zN;
      segs.push({ working: true, kind: 'line', a: { x: xs[i], z: zFrom }, b: { x: xs[i], z: zTo } });
      if (i < FURROW_COUNT - 1) {
        const bulge = even ? -TURN_BULGE : TURN_BULGE;
        segs.push({
          working: false,
          kind: 'arc',
          a: { x: xs[i], z: zTo },
          b: { x: xs[i + 1], z: zTo },
          c: { x: (xs[i] + xs[i + 1]) / 2, z: zTo + bulge }
        });
      }
    }
    const retZ = z0 + 0.9, lastX = xs[FURROW_COUNT - 1];
    segs.push({
      working: false,
      kind: 'poly',
      pts: [{ x: lastX, z: zN }, { x: lastX, z: retZ }, { x: xs[0], z: retZ }, { x: xs[0], z: zN }]
    });
    return segs;
  }
  function sampleCircuit(segs) {
    const stations = [], segMeta = [];
    let dist = 0, nextAt = PATH_STEP;
    stations.push({ x: segs[0].a.x, z: segs[0].a.z, dist: 0, working: segs[0].working });
    for (const seg of segs) {
      const startDist = dist;
      const pts = seg.kind === 'line' ? [seg.a, seg.b] : seg.kind === 'arc' ? arcPts(seg) : seg.pts;
      let prev = pts[0];
      for (let k = 1; k < pts.length; k++) {
        const cur = pts[k];
        const segLen = Math.hypot(cur.x - prev.x, cur.z - prev.z);
        if (segLen > 1e-6) {
          while (nextAt <= dist + segLen + 1e-9) {
            const f = (nextAt - dist) / segLen;
            stations.push({
              x: prev.x + (cur.x - prev.x) * f,
              z: prev.z + (cur.z - prev.z) * f,
              dist: nextAt,
              working: seg.working
            });
            nextAt += PATH_STEP;
          }
        }
        dist += segLen;
        prev = cur;
      }
      segMeta.push({ working: seg.working, kind: seg.kind, startDist, endDist: dist, seg });
    }
    const totalLen = dist;
    for (let i = 0; i < stations.length; i++) {
      const a = stations[(i - 1 + stations.length) % stations.length];
      const b = stations[(i + 1) % stations.length];
      stations[i].yaw = Math.atan2(b.x - a.x, b.z - a.z);
    }
    return { stations, totalLen, segMeta };
  }
  const circuit = sampleCircuit(buildCircuit());
  const stations = circuit.stations, totalLen = circuit.totalLen, segMeta = circuit.segMeta;
  function poseAt(d, out) {
    d = ((d % totalLen) + totalLen) % totalLen;
    let lo = 0, hi = stations.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (stations[mid].dist <= d) lo = mid; else hi = mid - 1;
    }
    const a = stations[lo], b = stations[(lo + 1) % stations.length];
    const bDist = (lo + 1 < stations.length) ? b.dist : totalLen;
    const span = bDist - a.dist, f = span > 1e-6 ? (d - a.dist) / span : 0;
    out.x = a.x + (b.x - a.x) * f;
    out.z = a.z + (b.z - a.z) * f;
    out.yaw = lerpAngle(a.yaw, b.yaw, f);
    out.working = a.working;
    return out;
  }

  // ---- 翻土底 mesh（温润熟土，层高严守在 fieldLift 与 furrow 之间避免穿插闪烁）----
  const soilGeo = (() => {
    const GX = 12, GZ = 12;
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (let iz = 0; iz <= GZ; iz++) {
      for (let ix = 0; ix <= GX; ix++) {
        const x = rx0 + (rx1 - rx0) * (ix / GX);
        const z = rzN + (rzS - rzN) * (iz / GZ);
        const n = hash2(x, z);
        const edge = (ix === 0 || ix === GX || iz === 0 || iz === GZ) ? 0 : 1;
        const y = surface(x, z) + fieldLift + 0.016 + (n - 0.5) * 0.014 * edge;
        pos.push(x, y, z);
        c.set(SOIL_COLORS[Math.floor(n * SOIL_COLORS.length) % SOIL_COLORS.length]);
        const v = 0.94 + n * 0.10;
        col.push(c.r * v, c.g * v, c.b * v);
      }
    }
    for (let iz = 0; iz < GZ; iz++) {
      for (let ix = 0; ix < GX; ix++) {
        const a = iz * (GX + 1) + ix, b = a + 1, d = a + GX + 1, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })();
  const soilMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const soilMesh = new THREE.Mesh(soilGeo, soilMat);
  soilMesh.name = 'ox-plowing-soil';
  soilMesh.receiveShadow = true;
  group.add(soilMesh);
  const soilTris = soilGeo.index.count / 3;

  // ---- 犁沟显形 ribbon（五点双肩垄截面：外坡→隆肩→深沟槽→隆肩→外坡，无锯齿穿插）----
  const furrowUniforms = {
    uHead: { value: 0 },
    uTotal: { value: totalLen },
    uWindow: { value: FURROW_WINDOW },
    uSoil: { value: new THREE.Color(SOIL_AVG) }
  };
  const furrowGeo = (() => {
    const pos = [], col = [], pd = [], by = [], idx = [];
    const cEdge = new THREE.Color(SOIL_AVG);
    const cShoulder = new THREE.Color(FRESH_SHOULDER);
    const cGroove = new THREE.Color(FRESH_GROOVE);
    const COLS = 6;
    let vbase = 0;
    for (const sm of segMeta) {
      if (!sm.working || sm.kind !== 'line') continue;
      const a = sm.seg.a, b = sm.seg.b;
      const passLen = Math.hypot(b.x - a.x, b.z - a.z);
      const NZ = Math.max(2, Math.ceil(passLen / 0.36));
      for (let k = 0; k <= NZ; k++) {
        const t = k / NZ;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const endTaper = Math.sin(Math.min(1, Math.min(t, 1 - t) / 0.08) * Math.PI * 0.5);
        const baseY = surface(x, z) + fieldLift + 0.026;
        const pathDist = sm.startDist + t * passLen;
        const verts = [
          [x - HALF_W * 1.15, baseY + 0.002, cEdge],
          [x - HALF_W * 0.68, baseY + 0.036 * endTaper, cShoulder],
          [x - GROOVE_W, baseY + 0.005, cGroove],
          [x + GROOVE_W, baseY + 0.005, cGroove],
          [x + HALF_W * 0.68, baseY + 0.038 * endTaper, cShoulder],
          [x + HALF_W * 1.15, baseY + 0.002, cEdge]
        ];
        for (const [vx, vy, cc] of verts) {
          pos.push(vx, vy, z);
          col.push(cc.r, cc.g, cc.b);
          pd.push(pathDist);
          by.push(baseY);
        }
      }
      for (let k = 0; k < NZ; k++) {
        const s = vbase + k * COLS, n = s + COLS;
        for (let strip = 0; strip < COLS - 1; strip++) {
          const p0 = s + strip, p1 = s + strip + 1, p2 = n + strip + 1, p3 = n + strip;
          idx.push(p0, p3, p1, p1, p3, p2);
        }
      }
      vbase += (NZ + 1) * COLS;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aPathDist', new THREE.Float32BufferAttribute(pd, 1));
    g.setAttribute('aBaseY', new THREE.Float32BufferAttribute(by, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })();
  const furrowMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  chainProgramCacheKey(furrowMat, 'ox-furrow-v2');
  furrowMat.onBeforeCompile = shader => {
    shader.uniforms.uHead = furrowUniforms.uHead;
    shader.uniforms.uTotal = furrowUniforms.uTotal;
    shader.uniforms.uWindow = furrowUniforms.uWindow;
    shader.uniforms.uSoil = furrowUniforms.uSoil;
    shader.vertexShader = 'attribute float aPathDist;\nattribute float aBaseY;\nuniform float uHead;\nuniform float uTotal;\nuniform float uWindow;\nvarying float vFresh;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nfloat fd = mod(uHead - aPathDist, uTotal);\nvFresh = 1.0 - smoothstep(0.0, uWindow, fd);\ntransformed.y = mix(aBaseY - 0.014, transformed.y, vFresh);'
    );
    shader.fragmentShader = 'uniform vec3 uSoil;\nvarying float vFresh;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb = mix(uSoil, diffuseColor.rgb, vFresh);'
    );
  };
  const furrowMesh = new THREE.Mesh(furrowGeo, furrowMat);
  furrowMesh.name = 'ox-plowing-furrows';
  furrowMesh.receiveShadow = true;
  group.add(furrowMesh);
  const furrowTris = furrowGeo.index.count / 3;

  // ============================================================================
  // 雕塑级江南/楚地青苍耕牛 + 曲木牛轭 + 外张双挽索 + 汉晋曲辕铁铧壁犁（单 draw call）
  // ============================================================================
  function buildBody() {
    const b = createPartBuilder([0, 0, 0]);
    // 1. 九段十棱解剖躯干：坐骨圆臀 → 宽阔髋胯 → 微收腰窝 → 浑圆肋桶 → 深阔前胸 → 前膺
    b.add(loft([
      [-0.70, 0.05, 0.13, 0.15],
      [-0.56, 0.06, 0.28, 0.25],
      [-0.36, 0.05, 0.33, 0.29],
      [-0.14, 0.03, 0.30, 0.28],
      [0.08, 0.02, 0.35, 0.32],
      [0.28, 0.04, 0.34, 0.33],
      [0.44, 0.06, 0.29, 0.30],
      [0.57, 0.03, 0.21, 0.23],
      [0.65, 0.01, 0.12, 0.14]
    ], 10, HIDE_BANDS, true, BELLY), null);

    // 2. 高耸鬐甲肩峰（耕牛受轭发力之骨相灵魂）与背脊骨棱
    b.add(loft([
      [0.12, 0.26, 0.14, 0.09],
      [0.27, 0.33, 0.16, 0.12],
      [0.40, 0.35, 0.15, 0.13],
      [0.52, 0.27, 0.11, 0.09]
    ], 8, HIDE_HUMP, true), null);
    b.add(loft([
      [-0.56, 0.24, 0.09, 0.06],
      [-0.26, 0.25, 0.08, 0.055],
      [0.10, 0.27, 0.09, 0.06]
    ], 6, ['#6E655A', '#685F55'], true), null);

    // 3. 胸下垂肉（胸垂 Dewlap）与下胸浅苍灰白过渡（仅在下腹显色，脊背保持青褐）
    b.add(loft([
      [0.16, -0.17, 0.046, 0.12],
      [0.36, -0.21, 0.054, 0.15],
      [0.54, -0.17, 0.048, 0.13],
      [0.64, -0.09, 0.036, 0.08]
    ], 6, DEWLAP, true, CHEVRON_LO), null);
    b.add(loft([
      [0.48, 0.03, 0.245, 0.255],
      [0.56, 0.02, 0.215, 0.235]
    ], 10, ['#685F55'], false, CHEVRON_LO), null);

    // 4. 左右肩胛肌群与后胯臀股肌群（顺滑收束入躯干，消除棱块突兀感）
    for (const s of [-1, 1]) {
      b.add(loft([
        [0.24, 0.01, 0.075, 0.14, s * 0.22],
        [0.38, 0.00, 0.115, 0.19, s * 0.24],
        [0.50, -0.01, 0.075, 0.14, s * 0.21]
      ], 7, ['#685F55', '#5E564D'], true), null);
      b.add(loft([
        [-0.55, 0.02, 0.085, 0.15, s * 0.21],
        [-0.41, 0.01, 0.125, 0.20, s * 0.24],
        [-0.26, 0.00, 0.085, 0.15, s * 0.22]
      ], 7, ['#645C52', '#5B534A'], true), null);
    }
    return b.finish('ox-body');
  }

  function buildHead() {
    // 枢轴设于颈根 [0, +0.08, +0.52]，低首引犁时与前胸垂肉浑然一体
    const b = createPartBuilder([0, 0, 0]);
    // 1. 粗壮前伸牛颈（背脊苍褐、咽喉下缘自然晕出月牙浅白纹）+ 咽下软垂皮
    b.add(sweep([
      [0, -0.01, -0.06, 0.22, 0.23],
      [0, 0.02, 0.09, 0.195, 0.205],
      [0, 0.05, 0.24, 0.16, 0.17]
    ], 8, HIDE_NECK, true), null);
    b.add(loft([
      [0.05, 0.01, 0.198, 0.206],
      [0.14, 0.025, 0.184, 0.194]
    ], 8, ['#6B6358'], false, CHEVRON), null);
    b.add(loft([
      [0.0, -0.14, 0.044, 0.095],
      [0.14, -0.12, 0.046, 0.105],
      [0.27, -0.07, 0.036, 0.080]
    ], 6, DEWLAP, true, CHEVRON), null);

    // 2. 宽阔额隆（角座）→ 眉弓腮颊 → 鼻梁 → 下颌
    b.add(loft([
      [0.18, 0.09, 0.145, 0.125],
      [0.27, 0.11, 0.178, 0.148],
      [0.37, 0.06, 0.152, 0.132],
      [0.47, 0.00, 0.128, 0.105],
      [0.55, -0.035, 0.118, 0.088]
    ], 8, HIDE_HEAD, true, '#797063'), null);
    b.add(loft([
      [0.31, -0.04, 0.105, 0.065],
      [0.44, -0.065, 0.092, 0.058],
      [0.56, -0.080, 0.078, 0.048]
    ], 6, ['#786F62', '#6E6559'], true), null);

    // 3. 湿润阔鼻镜（Muzzle）与黄铜/硬木牛鼻环
    b.add(loft([
      [0.49, -0.035, 0.118, 0.082],
      [0.57, -0.045, 0.142, 0.092],
      [0.625, -0.048, 0.116, 0.072]
    ], 8, MUZZLE, true), null);
    b.add(sweep([
      [-0.036, -0.068, 0.615, 0.011],
      [-0.042, -0.108, 0.622, 0.011],
      [0.0, -0.126, 0.625, 0.012],
      [0.042, -0.108, 0.622, 0.011],
      [0.036, -0.068, 0.615, 0.011]
    ], 5, [P.ring], true), null);

    // 4. 水牛标志性横棱弯月双大角 + 眉弓 + 有神双目 + 阔鼻孔
    for (const s of [-1, 1]) {
      // 角座隆起与两道横棱角节
      b.add(ellipsoid([s * 0.135, 0.138, 0.255], [0.068, 0.054, 0.062]), '#72685B');
      b.add(sweep([
        [s * 0.135, 0.138, 0.255, 0.066, 0.048],
        [s * 0.295, 0.146, 0.185, 0.055, 0.040],
        [s * 0.435, 0.172, 0.055, 0.043, 0.033],
        [s * 0.485, 0.225, -0.095, 0.032, 0.026],
        [s * 0.430, 0.302, -0.205, 0.020, 0.018],
        [s * 0.325, 0.365, -0.210, 0.008, 0.008]
      ], 7, HORN, true), null);
      // 近端角节横棱环
      b.add(sweep([
        [s * 0.185, 0.141, 0.232, 0.064, 0.047],
        [s * 0.215, 0.143, 0.218, 0.062, 0.045]
      ], 6, [HORN_RING], false), null);
      b.add(sweep([
        [s * 0.255, 0.145, 0.202, 0.059, 0.043],
        [s * 0.285, 0.147, 0.188, 0.057, 0.041]
      ], 6, [HORN_RING], false), null);

      // 眉弓、温润牛眼（墨眸配浅色下睑高光点睛）与外张鼻孔
      b.add(ellipsoid([s * 0.150, 0.102, 0.345], [0.038, 0.022, 0.046]), '#524B43');
      b.add(ellipsoid([s * 0.156, 0.072, 0.352], [0.024, 0.025, 0.026]), EYE_INK);
      b.add(ellipsoid([s * 0.154, 0.058, 0.356], [0.022, 0.012, 0.020]), EYE_RIM);
      b.add(ellipsoid([s * 0.074, -0.022, 0.602], [0.030, 0.022, 0.018]), NOSTRIL);
    }
    return b.finish('ox-head');
  }

  function buildEar(side) {
    // 独立竹叶形牛耳（局部原点在耳根，绝不悬空脱节）
    const b = createPartBuilder([0, 0, 0]);
    b.add(sweep([
      [0, 0, 0, 0.034, 0.026],
      [side * 0.085, -0.008, -0.012, 0.046, 0.024],
      [side * 0.165, -0.022, -0.022, 0.032, 0.016],
      [side * 0.205, -0.032, -0.018, 0.010, 0.008]
    ], 5, [EAR_OUT, EAR_OUT, '#4E4840'], true), null);
    b.add(wedge([
      [side * 0.03, -0.004, 0.014],
      [side * 0.16, -0.020, 0.004],
      [side * 0.11, -0.034, -0.012],
      [side * 0.05, -0.024, 0.016]
    ]), EAR_IN);
    return b.finish(side < 0 ? 'ox-ear-l' : 'ox-ear-r');
  }

  function buildClovenHoof(b, cy, cz) {
    // 球节 + 后悬蹄 + 左右分趾偶蹄（底面精准落于 y = cy - 0.08）
    b.add(ellipsoid([0, cy, cz], [0.052, 0.042, 0.054]), '#70685D');
    for (const toe of [-1, 1]) {
      b.add(wedge([
        [toe * 0.026, cy - 0.012, cz - 0.036],
        [toe * 0.046, cy - 0.078, cz + 0.048],
        [toe * 0.006, cy - 0.078, cz + 0.052],
        [toe * 0.024, cy - 0.078, cz - 0.042]
      ]), HOOF);
      b.add(loft([
        [cz - 0.038, cy - 0.046, 0.022, 0.034, toe * 0.026],
        [cz + 0.046, cy - 0.056, 0.024, 0.026, toe * 0.026]
      ], 5, [HOOF], true), null);
      // 悬蹄（Dewclaw）
      b.add(octa([toe * 0.022, cy - 0.022, cz - 0.046], [0.014, 0.018, 0.016]), HOOF);
    }
  }

  function buildForeUpper() {
    // 前肢上段：粗壮前臂收束至圆润腕关节 [0, -0.33, +0.015]
    const b = createPartBuilder([0, 0, 0]);
    b.add(sweep([
      [0, 0.03, 0, 0.112, 0.128],
      [0, -0.16, 0.008, 0.082, 0.090],
      [0, -0.33, 0.015, 0.058, 0.060]
    ], 7, HIDE_LIMB_UPPER, true), null);
    b.add(ellipsoid([0, -0.33, 0.022], [0.060, 0.056, 0.062]), '#6E665B');
    return b.finish('ox-fore-upper');
  }

  function buildForeLower() {
    // 前肢下段（枢轴在腕节 [0,0,0]，浅苍灰袜管骨至 y = -0.33 偶蹄着地）
    const b = createPartBuilder([0, 0, 0]);
    b.add(sweep([
      [0, 0.01, 0, 0.054, 0.056],
      [0, -0.13, 0.005, 0.046, 0.048],
      [0, -0.25, 0.010, 0.048, 0.050]
    ], 6, HIDE_STOCKING, true), null);
    buildClovenHoof(b, -0.25, 0.012);
    return b.finish('ox-fore-lower');
  }

  function buildHindUpper() {
    // 后肢上段：宽厚股胫后掠至鲜明飞节折角 [0, -0.35, -0.08]
    const b = createPartBuilder([0, 0, 0]);
    b.add(sweep([
      [0, 0.04, 0.01, 0.122, 0.152],
      [0, -0.16, -0.035, 0.088, 0.108],
      [0, -0.35, -0.080, 0.056, 0.064]
    ], 7, HIDE_LIMB_UPPER, true), null);
    // 飞节跟骨尖（Hock point）
    b.add(ellipsoid([0, -0.34, -0.102], [0.052, 0.056, 0.066]), '#6E665B');
    return b.finish('ox-hind-upper');
  }

  function buildHindLower() {
    // 后肢下段（枢轴在飞节 [0,0,0]，管骨微向前倾落至 [0, -0.33, +0.068] 偶蹄着地）
    const b = createPartBuilder([0, 0, 0]);
    b.add(sweep([
      [0, 0.01, 0, 0.054, 0.058],
      [0, -0.13, 0.032, 0.045, 0.048],
      [0, -0.25, 0.062, 0.048, 0.050]
    ], 6, HIDE_STOCKING, true), null);
    buildClovenHoof(b, -0.25, 0.068);
    return b.finish('ox-hind-lower');
  }

  function buildTail() {
    const b = createPartBuilder([0, 0, 0]);
    b.add(sweep([
      [0, 0, 0, 0.036],
      [0.015, -0.16, -0.09, 0.026],
      [0.035, -0.34, -0.13, 0.020],
      [0.045, -0.49, -0.12, 0.016]
    ], 6, ['#625A50', '#544D44', '#464039'], true), null);
    // 蓬松水滴形尾帚
    b.add(loft([
      [-0.12, -0.47, 0.022, 0.022, 0.045],
      [-0.12, -0.55, 0.052, 0.046, 0.045],
      [-0.12, -0.64, 0.018, 0.018, 0.045]
    ], 6, [TAIL_SWITCH, '#3B3630'], true), null);
    return b.finish('ox-tail');
  }

  function buildYoke() {
    // 汉晋曲木牛轭：稳跨鬐甲肩峰前颈脊，绝不埋入牛背，两端外张至 x = ±0.43 挂挽索
    const b = createPartBuilder([0, 0, 0]);
    // 拱曲主轭梁
    b.add(sweep([
      [-0.44, -0.05, -0.01, 0.032, 0.036],
      [-0.24, 0.045, 0.0, 0.040, 0.044],
      [0.0, 0.075, 0.008, 0.044, 0.048],
      [0.24, 0.045, 0.0, 0.040, 0.044],
      [0.44, -0.05, -0.01, 0.032, 0.036]
    ], 6, [P.darkWood, P.yokeTop, P.yokeTop, P.darkWood], true), null);
    // 颈侧双曲木牛鞅 + 颔下麻鞅绳 + 轭顶木栓与外端挽环
    for (const s of [-1, 1]) {
      b.add(sweep([
        [s * 0.21, 0.04, 0.0, 0.026],
        [s * 0.23, -0.11, 0.015, 0.024],
        [s * 0.17, -0.25, 0.03, 0.020]
      ], 5, [P.darkWood], true), null);
      b.add(octa([s * 0.21, 0.095, 0.0], [0.022, 0.042, 0.022]), P.wood);
      b.add(octa([s * 0.42, -0.055, -0.02], [0.028, 0.028, 0.028]), P.iron);
    }
    b.add(sweep([
      [-0.17, -0.25, 0.03, 0.014],
      [0.0, -0.28, 0.04, 0.015],
      [0.17, -0.25, 0.03, 0.014]
    ], 4, [P.hemp], true), null);
    return b.finish('ox-yoke');
  }

  function buildTraceRope(side) {
    // 编麻挽索（z: 0 → 1 自轭向后连犁，局部 -side 为牛肋外侧，微向外弧彻底避开肋腹与后胯）
    const b = createPartBuilder([0, 0, 0]);
    b.add(sweep([
      [0, 0, 0, 0.018],
      [-side * 0.055, -0.022, 0.28, 0.016],
      [-side * 0.065, -0.030, 0.54, 0.016],
      [-side * 0.035, -0.020, 0.78, 0.016],
      [0, 0, 1.0, 0.018]
    ], 5, [P.hemp, P.hempShade, P.hemp, P.hempShade], true), null);
    return b.finish(side < 0 ? 'ox-trace-l' : 'ox-trace-r');
  }

  function buildPlow() {
    // 汉晋曲辕铁铧壁犁（原点为前端犁盘挂钩 [0, 0, 0]，入土工作时地面在 y = -0.44）
    const b = createPartBuilder([0, 0, 0]);
    // 1. 前端犁盘横木（Swingle-tree，x = -0.26..+0.26 承接左右挽索）
    b.add(sweep([
      [-0.26, 0, 0.04, 0.024],
      [0, 0.008, 0.05, 0.028],
      [0.26, 0, 0.04, 0.024]
    ], 5, [P.darkWood, P.wood], true), null);
    for (const s of [-1, 1]) b.add(octa([s * 0.25, 0, 0.04], [0.024, 0.024, 0.024]), P.iron);

    // 2. 柔美 S 形曲木主犁辕（自犁盘微拱上扬，再曲折向下榫入犁底后跟）
    b.add(sweep([
      [0, 0.0, 0.04, 0.040, 0.044],
      [0, 0.085, -0.20, 0.044, 0.048],
      [0, 0.025, -0.46, 0.042, 0.046],
      [0, -0.16, -0.66, 0.038, 0.042],
      [0, -0.36, -0.80, 0.035, 0.038]
    ], 6, [P.wood, P.yokeTop, P.wood, P.darkWood], true), null);

    // 3. 贴沟平滑犁底（犁床）+ 竖直穿辕犁箭与犁评木楔
    b.add(sweep([
      [0, -0.415, -0.36, 0.034, 0.028],
      [0, -0.410, -0.62, 0.038, 0.032],
      [0, -0.405, -0.88, 0.032, 0.028]
    ], 5, [P.darkWood], true), null);
    b.add(sweep([
      [0, -0.40, -0.52, 0.026],
      [0, 0.11, -0.44, 0.024]
    ], 4, [P.darkWood], true), null);
    b.add(wedge([
      [-0.03, 0.08, -0.40],
      [0.03, 0.08, -0.40],
      [0, 0.14, -0.45],
      [0, 0.06, -0.50]
    ]), P.yokeTop);

    // 4. 宽翼生铁犁铧（V 形破土锋刃）+ 弧面翻土铁犁壁（Moldboard）
    b.add(wedge([
      [0, -0.435, -0.30],
      [0.165, -0.405, -0.56],
      [-0.165, -0.405, -0.56],
      [0, -0.355, -0.50]
    ]), P.ironEdge);
    b.add(wedge([
      [-0.02, -0.385, -0.45],
      [0.175, -0.225, -0.64],
      [0.03, -0.205, -0.60],
      [0.135, -0.395, -0.57]
    ]), P.iron);

    // 5. 双扶手犁梢与横桄握把（精准落在 [±0.17, +0.46, -1.08]，与农夫双手严丝合缝）
    for (const s of [-1, 1]) {
      b.add(sweep([
        [s * 0.045, -0.38, -0.79, 0.028],
        [s * 0.115, 0.04, -0.94, 0.026],
        [s * 0.175, 0.46, -1.08, 0.024]
      ], 5, [P.darkWood, P.wood], true), null);
    }
    b.add(sweep([
      [-0.12, 0.05, -0.94, 0.018],
      [0.12, 0.05, -0.94, 0.018]
    ], 4, [P.darkWood], true), null);
    b.add(sweep([
      [-0.22, 0.46, -1.08, 0.022],
      [0.22, 0.46, -1.08, 0.022]
    ], 5, [P.yokeTop], true), null);
    return b.finish('ox-plow');
  }

  function buildClodSpray() {
    // 铧尖与犁壁侧翻涌滚动的四粒新湿泥块
    const b = createPartBuilder([0, 0, 0]);
    b.add(octa([0.10, 0.05, 0.04], [0.052, 0.038, 0.048]), CLOD_COLS[0]);
    b.add(octa([-0.08, 0.04, 0.01], [0.044, 0.034, 0.042]), CLOD_COLS[1]);
    b.add(octa([0.16, 0.08, -0.06], [0.040, 0.032, 0.038]), CLOD_COLS[2]);
    b.add(octa([0.04, 0.03, -0.10], [0.046, 0.030, 0.044]), CLOD_COLS[0]);
    return b.finish('ox-clods');
  }

  const foreUpperGeo = buildForeUpper();
  const foreLowerGeo = buildForeLower();
  const hindUpperGeo = buildHindUpper();
  const hindLowerGeo = buildHindLower();
  // Slot map:
  // 0:body, 1:head, 2:earL, 3:earR,
  // 4:FL_up, 5:FR_up, 6:FL_lo, 7:FR_lo,
  // 8:HL_up, 9:HR_up, 10:HL_lo, 11:HR_lo,
  // 12:tail, 13:yoke, 14:traceL, 15:traceR, 16:plow, 17:clods
  const slotGeos = [
    buildBody(), buildHead(), buildEar(-1), buildEar(1),
    foreUpperGeo, foreUpperGeo, foreLowerGeo, foreLowerGeo,
    hindUpperGeo, hindUpperGeo, hindLowerGeo, hindLowerGeo,
    buildTail(), buildYoke(), buildTraceRope(-1), buildTraceRope(1), buildPlow(), buildClodSpray()
  ];
  const batchMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const batch = createRigidBatchMesh(slotGeos, batchMat, 'ox-plowing-batch');
  group.add(batch.mesh);

  // ---- 扶犁农夫（人物 rig）----
  const rig = createCommunityActors(group, 2);

  // ---- 歇息点（田头阡陌）与障碍/识物/交谈状态 ----
  const restSpot = { x: x0 + pw * 0.5, z: z0 + 1.0 };
  const restYaw = Math.PI * 0.5;
  const initGroundY = surface(restSpot.x, restSpot.z) + fieldLift;
  // minY/maxY 精确框定牛体高度（<1.0m 净高），既阻挡穿模又不误挡玩家与农夫交谈及识物射线
  const oxBlocker = {
    x: restSpot.x, z: restSpot.z, rot: restYaw, hw: 0.46, hd: 0.76,
    minY: initGroundY, maxY: initGroundY + 0.92, source: 'plowing-ox'
  };
  const oxObs = {
    id: 'plow-ox', kind: 'buffalo', x: restSpot.x, z: restSpot.z,
    yaw: restYaw, rear: -0.58, front: 0.68, radius: 0.48, mass: 1
  };
  const oxState = {
    id: 'plowing-ox', kind: 'buffalo', x: restSpot.x, y: initGroundY, z: restSpot.z,
    yaw: restYaw, s: 1, owner: group
  };
  const farmerState = {
    id: 'plowman',
    key: 'c_plowman',
    kind: 'person',
    role: 'plowman',
    voiceRole: 'worker',
    female: false,
    child: false,
    x: restSpot.x,
    y: initGroundY,
    z: restSpot.z,
    yaw: restYaw,
    s: 1,
    mode: 'work',
    activity: 'plowing',
    nightRest: false,
    rainRest: 0,
    greetUntil: 0,
    greetX: 0,
    greetZ: 0,
    owner: group
  };
  const blockers = [oxBlocker];
  const targets = [{
    id: 'plowing-ox',
    x: restSpot.x,
    y: initGroundY + 1.06,
    z: restSpot.z,
    range: 7.0,
    resolve: () => ({ x: oxState.x, y: oxState.y + 1.06 - restBlend * 0.28, z: oxState.z })
  }];

  // ---- 行为与问候状态 ----
  let simTime = 0, headDist = 0, restBlend = 0, mode = 'work', plowEngage = 1, transition = null;
  let currentPhenology = 'spring';
  const baseSoilColors = new Float32Array(soilGeo.attributes.color.array);
  const _winterSoil = new THREE.Color('#E6E4DC');
  let oxGlanceTimer = 0, oxGlanceYaw = 0, proximityLowCooldown = 2.5, wasWorkingSeg = true;
  const oxPose = { x: 0, z: 0, yaw: 0, working: true };
  const plowPose = { x: 0, z: 0, yaw: 0, working: true };
  const _tmp = { x: 0, z: 0, yaw: 0, working: true };

  poseAt(0, oxPose);
  const startGy = surface(oxPose.x, oxPose.z) + fieldLift + 0.034;
  oxState.x = oxPose.x; oxState.z = oxPose.z; oxState.y = startGy;
  oxBlocker.x = oxPose.x; oxBlocker.z = oxPose.z; oxBlocker.rot = oxPose.yaw;
  oxBlocker.minY = startGy; oxBlocker.maxY = startGy + 0.92;
  oxObs.x = oxPose.x; oxObs.z = oxPose.z; oxObs.yaw = oxPose.yaw;

  function beginTransition(next) {
    const from = { x: oxPose.x, z: oxPose.z, yaw: oxPose.yaw };
    let to;
    if (next === 'toRest') to = { x: restSpot.x, z: restSpot.z, yaw: restYaw };
    else { const p = poseAt(0, _tmp); to = { x: p.x, z: p.z, yaw: p.yaw }; }
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    transition = { from, to, t: 0, dur: Math.max(1.4, d / RETURN_SPEED), next };
    mode = next;
  }

  // ---- 音效事件（犁土沙沙 / 牛低鸣；dt=0 严格冻结）----
  const pendingEvents = [];
  let scrapeTimer = 0.28, lowTimer = 5.5, scrapeStep = 0, eventSeed = 987654321;
  function eventRnd() {
    eventSeed = (eventSeed * 1103515245 + 12345) & 0x7fffffff;
    return eventSeed / 0x7fffffff;
  }
  function consumeEvents() {
    const e = pendingEvents.slice();
    pendingEvents.length = 0;
    return e;
  }

  function greet(id, px, pz, dur = 2.4) {
    if (id === farmerState.id || id === farmerState.key) {
      farmerState.greetUntil = simTime + Math.max(1.2, dur || 2.4);
      farmerState.greetX = px;
      farmerState.greetZ = pz;
      oxGlanceTimer = Math.max(oxGlanceTimer, 2.2);
      oxGlanceYaw = Math.atan2(px - oxState.x, pz - oxState.z);
    }
  }

  // 局部点经 YXZ 欧拉旋转 (rx, ry, 0) 投射到世界坐标
  function writeRopeBetween(slotIdx, ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) {
      batch.hidePart(slotIdx);
      return;
    }
    const pitch = -Math.asin(Math.max(-1, Math.min(1, dy / len)));
    const yaw = Math.atan2(dx, dz);
    batch.writePart(slotIdx, ax, ay, az, pitch, yaw, 0, 1, 1, len);
  }

  function update(dt, elapsed, sky, playerState) {
    const step = livingStep(dt);
    simTime += step;
    const w = readWeather(sky);
    const isWinterRest = currentPhenology === 'winter';
    const wantRest = w.isNight || w.storm || isWinterRest;

    if (mode === 'work') {
      if (wantRest) beginTransition('toRest');
      else if (step > 0) headDist = (headDist + step * WALK_SPEED) % totalLen;
    } else if (mode === 'toRest' || mode === 'toField') {
      if (step > 0 && transition) {
        transition.t += step / transition.dur;
        if (transition.t >= 1) {
          const nx = transition.next;
          transition = null;
          mode = nx === 'toRest' ? 'rest' : 'work';
          if (mode === 'work') headDist = 0;
        }
      }
    } else if (mode === 'rest') {
      if (!wantRest && restBlend < 0.06) beginTransition('toField');
    }
    const rbTarget = (mode === 'rest' && wantRest) ? 1 : 0;
    if (step > 0) {
      restBlend = clamp01(restBlend + (rbTarget - restBlend) * Math.min(1, step * REST_RATE));
      if (oxGlanceTimer > 0) oxGlanceTimer = Math.max(0, oxGlanceTimer - step);
      if (proximityLowCooldown > 0) proximityLowCooldown = Math.max(0, proximityLowCooldown - step);
    }

    // 牛基准位姿
    let bx, bz, byaw;
    const moving = mode === 'rest' ? 0 : 1;
    if (mode === 'work') {
      const p = poseAt(headDist, oxPose);
      bx = p.x; bz = p.z; byaw = p.yaw;
    } else if (transition) {
      const k = smoothstep(transition.t);
      bx = lerp(transition.from.x, transition.to.x, k);
      bz = lerp(transition.from.z, transition.to.z, k);
      byaw = lerpAngle(transition.from.yaw, transition.to.yaw, k);
      oxPose.x = bx; oxPose.z = bz; oxPose.yaw = byaw;
    } else {
      bx = restSpot.x; bz = restSpot.z; byaw = restYaw;
      oxPose.x = bx; oxPose.z = bz; oxPose.yaw = byaw;
    }

    // 玩家走近田头时，耕牛温和回眸并低哞一声应答（长冷却，绝不吵闹）
    if (step > 0 && playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z)) {
      const pDist = Math.hypot(playerState.x - bx, playerState.z - bz);
      if (pDist < 7.2) {
        oxGlanceYaw = Math.atan2(playerState.x - bx, playerState.z - bz);
        oxGlanceTimer = Math.max(oxGlanceTimer, 1.4);
        if (proximityLowCooldown <= 0 && !w.storm) {
          pendingEvents.push({ type: 'oxLow', x: bx, z: bz, reason: 'greet' });
          proximityLowCooldown = 20 + eventRnd() * 8;
          lowTimer = Math.max(lowTimer, 12);
        }
      }
    }

    const groundY = surface(bx, bz) + fieldLift + 0.034;
    const gaitPhase = simTime * STRIDE_FREQ;
    const walkAmt = moving * (1 - restBlend);
    const bob = Math.abs(Math.sin(gaitPhase)) * 0.028 * walkAmt;
    const bodyY = groundY + BODY_HEIGHT + bob - restBlend * REST_DROP;
    const bc = Math.cos(byaw), bs = Math.sin(byaw);
    const bodyPitch = walkAmt * Math.sin(gaitPhase * 2) * 0.016;
    const bodyRoll = walkAmt * Math.sin(gaitPhase) * 0.022;
    batch.writePart(0, bx, bodyY, bz, bodyPitch, byaw, bodyRoll);

    // 1. 头与粗颈（引犁微低首发力，偶向近处游人温和偏首，卧刍时微抬下颌反刍）
    let glanceAdd = 0;
    if (oxGlanceTimer > 0) {
      let dyaw = oxGlanceYaw - byaw;
      while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
      while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      glanceAdd = Math.max(-0.42, Math.min(0.42, dyaw * 0.55)) * Math.min(1, oxGlanceTimer);
    }
    const chewWave = restBlend * Math.sin(simTime * 2.6) * 0.035;
    const headTurn = Math.sin(simTime * 0.52) * 0.065 * (1 - restBlend) + glanceAdd + chewWave * 0.4;
    const hyaw = byaw + headTurn;
    const hx = bx + bs * 0.52, hz = bz + bc * 0.52;
    const hy = bodyY + 0.08 + bob * 0.65 - restBlend * 0.04;
    const pullStrain = (mode === 'work' && plowEngage > 0.5) ? 0.11 : 0.03;
    const nod = pullStrain + Math.sin(gaitPhase) * 0.038 * walkAmt + Math.sin(simTime * 0.85) * 0.03 - restBlend * 0.06 + chewWave;
    batch.writePart(1, hx, hy, hz, nod, hyaw, 0);

    // 2. 左右独立竹叶耳（精确锚定于头部颞侧角根下方，异步轻扇驱虻）
    const hcosY = Math.cos(hyaw), hsinY = Math.sin(hyaw);
    const hcosX = Math.cos(nod), hsinX = Math.sin(nod);
    for (let eIdx = 0; eIdx < 2; eIdx++) {
      const s = eIdx === 0 ? -1 : 1;
      const elx = s * 0.155, ely = 0.072, elz = 0.255;
      const ry1 = hcosX * ely - hsinX * elz;
      const rz1 = hsinX * ely + hcosX * elz;
      const ewx = hx + elx * hcosY + rz1 * hsinY;
      const ewy = hy + ry1;
      const ewz = hz - elx * hsinY + rz1 * hcosY;
      const flickPulse = Math.pow(Math.max(0, Math.sin(simTime * (2.1 + eIdx * 0.65) + eIdx * 2.3)), 6);
      const earYaw = hyaw + s * (0.06 + flickPulse * 0.36);
      const earRoll = s * flickPulse * 0.22;
      batch.writePart(2 + eIdx, ewx, ewy, ewz, nod * 0.7, earYaw, earRoll);
    }

    // 3. 双节四肢（对角四拍步态：前腕屈抬跨步 + 后飞节蹬地，歇息时真实曲膝折收腹下）
    const foreSpecs = [[-0.225, -0.06, 0.38, 0], [0.225, -0.06, 0.38, Math.PI]];
    for (let i = 0; i < 2; i++) {
      const [lx, ly, lz, ph] = foreSpecs[i];
      const hipX = bx + lx * bc + lz * bs;
      const hipZ = bz - lx * bs + lz * bc;
      const hipY = bodyY + ly;
      const cyc = gaitPhase + ph;
      const walkUp = Math.sin(cyc) * 0.34 * walkAmt;
      const kneeLift = Math.max(0, -Math.cos(cyc)) * 0.48 * walkAmt;
      const upperPitch = lerp(walkUp, -1.16, restBlend);
      const lowerPitch = lerp(walkUp + kneeLift, 1.44, restBlend);
      batch.writePart(4 + i, hipX, hipY, hipZ, upperPitch, byaw, 0);

      const uCos = Math.cos(upperPitch), uSin = Math.sin(upperPitch);
      const ky = -0.33, kz = 0.015;
      const kry = uCos * ky - uSin * kz;
      const krz = uSin * ky + uCos * kz;
      batch.writePart(6 + i, hipX + krz * bs, hipY + kry, hipZ + krz * bc, lowerPitch, byaw, 0);
    }

    const hindSpecs = [[-0.235, -0.04, -0.41, Math.PI + 0.32], [0.235, -0.04, -0.41, 0.32]];
    for (let i = 0; i < 2; i++) {
      const [lx, ly, lz, ph] = hindSpecs[i];
      const hipX = bx + lx * bc + lz * bs;
      const hipZ = bz - lx * bs + lz * bc;
      const hipY = bodyY + ly;
      const cyc = gaitPhase + ph;
      const walkUp = Math.sin(cyc) * 0.32 * walkAmt;
      const hockFlex = Math.max(0, -Math.cos(cyc)) * 0.42 * walkAmt;
      const upperPitch = lerp(walkUp, -1.18, restBlend);
      const lowerPitch = lerp(walkUp * 0.85 - hockFlex, -1.36, restBlend);
      batch.writePart(8 + i, hipX, hipY, hipZ, upperPitch, byaw, 0);

      const uCos = Math.cos(upperPitch), uSin = Math.sin(upperPitch);
      const ky = -0.35, kz = -0.080;
      const kry = uCos * ky - uSin * kz;
      const krz = uSin * ky + uCos * kz;
      batch.writePart(10 + i, hipX + krz * bs, hipY + kry, hipZ + krz * bc, lowerPitch, byaw, 0);
    }

    // 4. 牛尾（自然垂弧甩虻）
    const tailSway = Math.sin(simTime * 1.65) * 0.24 + Math.sin(gaitPhase) * 0.10 * walkAmt;
    batch.writePart(12, bx - bs * 0.66, bodyY + 0.15, bz - bc * 0.66, 0.06, byaw + tailSway, 0);

    // 5. 曲木牛轭（稳架肩峰前颈脊，随步伐微倾）
    const yx = bx + bs * 0.48, yz = bz + bc * 0.48, yy = bodyY + 0.29 - restBlend * 0.02;
    batch.writePart(13, yx, yy, yz, bodyPitch * 0.8, byaw + headTurn * 0.22, 0);

    // 6. 汉晋曲辕木犁（随路径尾随，转弯/回程抬犁；歇息/冬休卸索靠棚柱斜倚）
    const restPlow = mode === 'rest' ? restBlend : 0;
    const rp = smoothstep(restPlow);
    const rFx = Math.sin(restYaw), rFz = Math.cos(restYaw);
    const rRx = Math.cos(restYaw), rRz = -Math.sin(restYaw);
    let plowX, plowZ, plowYaw, engageTarget;
    if (mode === 'work') {
      const p = poseAt(headDist - PLOW_OFFSET, plowPose);
      plowX = p.x; plowZ = p.z; plowYaw = p.yaw;
      engageTarget = p.working ? 1 : 0;
    } else {
      const trailX = bx - bs * PLOW_OFFSET;
      const trailZ = bz - bc * PLOW_OFFSET;
      // 卸犁收于歇牛茅亭背阴干土柱侧（lat=-1.32, fwd=-1.08），不再挂在卧牛身后
      const parkX = restSpot.x + rRx * (-1.32) + rFx * (-1.08);
      const parkZ = restSpot.z + rRz * (-1.32) + rFz * (-1.08);
      plowX = lerp(trailX, parkX, rp);
      plowZ = lerp(trailZ, parkZ, rp);
      plowYaw = lerpAngle(byaw, restYaw + 0.36, rp);
      engageTarget = 0;
    }
    const plowGround = surface(plowX, plowZ) + fieldLift;
    if (step > 0) plowEngage += (engageTarget - plowEngage) * Math.min(1, step * 4);
    const effLift = (1 - plowEngage) * (1 - restPlow);
    const plowVib = (mode === 'work' && plowEngage > 0.6) ? Math.sin(simTime * 15.0) * 0.006 : 0;
    const hitchY = plowGround + 0.44 - rp * 0.08 + effLift * 0.26 + plowVib;
    const plowPitch = -0.22 * effLift + rp * 0.16;
    const plowRoll = rp * 0.26;
    batch.writePart(16, plowX, hitchY, plowZ, plowPitch, plowYaw, plowRoll);

    // 7. 左右外张编麻挽索（耕行时直连牛轭与犁盘；卸犁卧休后收索隐藏，避免拉扯卧牛）
    const yYaw = byaw + headTurn * 0.22;
    const yc = Math.cos(yYaw), ys = Math.sin(yYaw);
    const pc = Math.cos(plowYaw), ps = Math.sin(plowYaw);
    if (rp > 0.55) {
      batch.hidePart(14);
      batch.hidePart(15);
    } else {
      for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
        const s = sideIdx === 0 ? -1 : 1;
        const ax = yx + (s * 0.42) * yc + (-0.02) * ys;
        const ay = yy - 0.055;
        const az = yz - (s * 0.42) * ys + (-0.02) * yc;
        const bxRope = plowX + (s * 0.26) * pc + 0.04 * ps;
        const byRope = hitchY;
        const bzRope = plowZ - (s * 0.26) * ps + 0.04 * pc;
        writeRopeBetween(14 + sideIdx, ax, ay, az, bxRope, byRope, bzRope);
      }
    }

    // 8. 铧尖翻涌新泥粒（破土行进时在犁壁侧微跃滚动，抬犁或歇息时隐入土下）
    if (mode === 'work' && plowEngage > 0.55 && moving) {
      const clodBob = Math.abs(Math.sin(simTime * 9.5)) * 0.045;
      const clodX = plowX + 0.06 * pc - 0.52 * ps;
      const clodZ = plowZ - 0.06 * ps - 0.52 * pc;
      batch.writePart(17, clodX, plowGround + 0.01 + clodBob, clodZ, clodBob * 3, plowYaw + Math.sin(simTime * 7) * 0.25, 0);
    } else {
      batch.hidePart(17);
    }

    // 9. 音效发射（犁土沙沙声随步频绵密交叠；端头回转或耕间偶发牛低鸣；dt=0 严格冻结）
    const nowWorkingSeg = Boolean(mode === 'work' && plowEngage > 0.5 && moving);
    if (step > 0) {
      if (nowWorkingSeg) {
        scrapeTimer -= step;
        if (scrapeTimer <= 0) {
          scrapeStep = (scrapeStep + 1) & 1023;
          const shareX = plowX - 0.48 * ps;
          const shareZ = plowZ - 0.48 * pc;
          pendingEvents.push({
            type: 'plowScrape',
            x: shareX,
            z: shareZ,
            intensity: 0.85 + 0.30 * eventRnd(),
            creak: (scrapeStep % 4 === 0)
          });
          scrapeTimer = 0.44 + eventRnd() * 0.18;
        }
      }
      // 刚犁完一垄到田头抬犁回转时，老牛偶发舒气低哞
      if (wasWorkingSeg && !nowWorkingSeg && mode === 'work' && !w.storm && lowTimer < 8.5 && eventRnd() < 0.45) {
        pendingEvents.push({ type: 'oxLow', x: bx, z: bz, reason: 'turn' });
        lowTimer = 14 + eventRnd() * 10;
      }
      wasWorkingSeg = nowWorkingSeg;

      if ((mode === 'work' || mode === 'rest') && !w.storm) {
        lowTimer -= step;
        if (lowTimer <= 0) {
          pendingEvents.push({ type: 'oxLow', x: bx, z: bz, reason: 'ambient' });
          lowTimer = 13 + eventRnd() * 9;
        }
      }
    }
    batch.commit();

    // 10. 扶犁农夫（耕行时双手锁合曲辕木犁横桄；歇息/冬休时退入茅棚檐下草料槽畔照看卧牛）
    const pCos = Math.cos(plowPitch), pSin = Math.sin(plowPitch);
    const handleDist = pCos * HANDLE_BACK - pSin * 0.46;
    const handleX = plowX - handleDist * ps;
    const handleZ = plowZ - handleDist * pc;
    const handleY = hitchY + pCos * 0.46 + pSin * HANDLE_BACK;
    const workFx = handleX - ps * FARMER_BACK;
    const workFz = handleZ - pc * FARMER_BACK;
    const shelterFx = restSpot.x + rRx * (-1.04) + rFx * (-0.06);
    const shelterFz = restSpot.z + rRz * (-1.04) + rFz * (-0.06);
    const fx = lerp(workFx, shelterFx, rp);
    const fz = lerp(workFz, shelterFz, rp);
    const fYaw = lerpAngle(plowYaw, restYaw - 1.18, rp);
    const fGround = surface(fx, fz) + fieldLift + 0.034;
    const handY = Math.max(0.54, Math.min(1.12, handleY - fGround));
    const tendWave = Math.sin(simTime * 1.45) * 0.025;
    const handLx = lerp(-0.17, -0.13, rp);
    const handRx = lerp(0.17, 0.13, rp);
    const handLy = lerp(handY, 0.96 + tendWave, rp);
    const handRy = lerp(handY, 0.96 - tendWave, rp);
    const handZ = lerp(FARMER_BACK, 0.28, rp);
    const fWalk = Math.sin(gaitPhase) * walkAmt;
    const fLean = 0.15 * (1 - restBlend) + 0.05 * restBlend;
    let fHeadTurn = Math.sin(simTime * 0.42) * 0.07;
    let fNod = Math.sin(simTime * 0.9) * 0.04;
    if (simTime < farmerState.greetUntil) {
      let gyaw = Math.atan2(farmerState.greetX - fx, farmerState.greetZ - fz) - fYaw;
      while (gyaw > Math.PI) gyaw -= 2 * Math.PI;
      while (gyaw < -Math.PI) gyaw += 2 * Math.PI;
      fHeadTurn = Math.max(-0.68, Math.min(0.68, gyaw));
      fNod = 0.08 * Math.sin(simTime * 4.2);
    }
    rig.begin();
    rig.actor(fx, fGround, fz, fYaw, 1.0);
    rig.human({ index: 2, kind: 'villager', role: 'plowman' }, {
      walk: fWalk,
      lean: fLean,
      nod: fNod,
      headTurn: fHeadTurn,
      left: [handLx, handLy, handZ],
      right: [handRx, handRy, handZ]
    });
    rig.finish();

    // 犁沟显形 uniform（对准生铁犁铧破土位置）
    furrowUniforms.uHead.value = headDist - (PLOW_OFFSET + 0.45) * 0.72;

    // 障碍/识物/交谈/阴影状态同步
    oxBlocker.x = bx; oxBlocker.z = bz; oxBlocker.rot = byaw;
    oxBlocker.minY = groundY; oxBlocker.maxY = groundY + 0.92 - restBlend * 0.24;
    oxObs.x = bx; oxObs.z = bz; oxObs.yaw = byaw;
    oxState.x = bx; oxState.y = groundY; oxState.z = bz; oxState.yaw = byaw;
    farmerState.x = fx;
    farmerState.y = fGround;
    farmerState.z = fz;
    farmerState.yaw = fYaw;
    farmerState.mode = mode === 'rest' ? 'rest' : 'work';
    farmerState.activity = mode === 'rest' ? 'rest' : 'plowing';
    farmerState.nightRest = Boolean((w.isNight || isWinterRest) && mode === 'rest');
    farmerState.winterRest = Boolean(isWinterRest && mode === 'rest');
    farmerState.rainRest = w.storm ? 1 : 0;
  }

  function setPhenology(id) {
    const next = (id === 'summer' || id === 'autumn' || id === 'winter') ? id : 'spring';
    if (next === currentPhenology) return false;
    currentPhenology = next;
    const dst = soilGeo.attributes.color.array;
    const furrowMeshObj = group.children.find(c => c !== soilMesh && c !== batch.mesh && c.isMesh);
    if (next === 'winter') {
      for (let i = 0; i < baseSoilColors.length; i += 3) {
        dst[i] = lerp(baseSoilColors[i], _winterSoil.r, 0.56);
        dst[i + 1] = lerp(baseSoilColors[i + 1], _winterSoil.g, 0.56);
        dst[i + 2] = lerp(baseSoilColors[i + 2], _winterSoil.b, 0.56);
      }
      soilGeo.attributes.color.needsUpdate = true;
      if (furrowMeshObj) furrowMeshObj.visible = false;
      transition = null;
      mode = 'rest';
      restBlend = 1;
      plowEngage = 0;
      oxPose.x = restSpot.x;
      oxPose.z = restSpot.z;
      oxPose.yaw = restYaw;
      update(0.001, simTime, null, null);
    } else {
      dst.set(baseSoilColors);
      soilGeo.attributes.color.needsUpdate = true;
      if (furrowMeshObj) furrowMeshObj.visible = true;
      if (mode === 'rest') {
        restBlend = 0.02;
        beginTransition('toField');
      }
    }
    return true;
  }

  function getRestAnchor() {
    return { x: restSpot.x, y: initGroundY, z: restSpot.z, yaw: restYaw };
  }

  function getInteractables() { return [oxState, farmerState]; }
  function getVillagers() { return [farmerState]; }
  function getAnimalObstacles() { return [oxObs]; }
  function getStats() {
    const rs = rig.stats();
    return {
      drawCalls: 3 + rs.drawCalls,
      triangles: batch.triangles + soilTris + furrowTris + rs.triangles,
      oxBatchTriangles: batch.triangles,
      mode,
      phenology: currentPhenology,
      restBlend: +restBlend.toFixed(3),
      headDist: +headDist.toFixed(2),
      totalLen: +totalLen.toFixed(2)
    };
  }
  function dispose() {
    rig.dispose();
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const m = o.material;
        (Array.isArray(m) ? m : [m]).forEach(x => x.dispose());
      }
    });
    group.clear();
  }

  // 首帧摆位（dt=0 也成形）
  update(0, 0, null, null);

  return {
    group,
    blockers,
    targets,
    setPhenology,
    getRestAnchor,
    update,
    greet,
    getInteractables,
    getVillagers,
    getAnimalObstacles,
    consumeEvents,
    getStats,
    dispose
  };
}
