import * as THREE from 'three';
import { foliageGeometry } from './model-geometry.js';
import { buildNaturalRoadRibbon } from './road-geometry.js';
import { chainProgramCacheKey } from '../systems/shader-cache-key.js';

// ---- 小工具：把一堆带色三角塞进一个 BufferGeometry（零外部资源、每类一次 draw call）----
function newBuf() {
  return { pos: [], nor: [], col: [] };
}
function pushTriY(b, ax, az, bx, bz, cx, cz, y, c) {
  b.pos.push(ax, y, az, bx, y, bz, cx, y, cz);
  for (let i = 0; i < 3; i++) {
    b.nor.push(0, 1, 0);
    b.col.push(c.r, c.g, c.b);
  }
}
// 四个角各自带高度的四边形（路面这种要跟着地形起伏的面用它，接缝才不会出台阶）
function pushQuadYv(b, p0, p1, p2, p3, c) {
  b.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
  b.pos.push(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
  for (let i = 0; i < 6; i++) {
    b.nor.push(0, 1, 0);
    b.col.push(c.r, c.g, c.b);
  }
}

// 俯视逆时针的四边形（x0<x1, z0<z1）
function pushQuadY(b, x0, z0, x1, z1, y, c) {
  pushTriY(b, x0, z0, x0, z1, x1, z1, y, c);
  pushTriY(b, x0, z0, x1, z1, x1, z0, y, c);
}
// 任意朝向的四边形（中心 cx,cz，半宽 hw，半长 hd，绕 y 旋转 rot）
function pushQuadRot(b, cx, cz, hw, hd, rot, y, c) {
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const p = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd]
  ];
  const w = [];
  for (let i = 0; i < 4; i++) {
    w.push([cx + p[i][0] * ca + p[i][1] * sa, cz - p[i][0] * sa + p[i][1] * ca]);
  }
  pushTriY(b, w[0][0], w[0][1], w[1][0], w[1][1], w[2][0], w[2][1], y, c);
  pushTriY(b, w[0][0], w[0][1], w[2][0], w[2][1], w[3][0], w[3][1], y, c);
}

function toGeo(b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  return g;
}

function hash1(n) {
  let h = Math.imul(n | 0, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// 一维平滑噪声，用来给池岸一点不规则的呼吸
function valueNoise1(x) {
  const x0 = Math.floor(x);
  const f = x - x0;
  const u = f * f * (3 - 2 * f);
  const a = hash1(x0);
  const b = hash1(x0 + 1);
  return a + (b - a) * u;
}
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}


function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 折线采样器：按弧长取点 + 法向
function polyline(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i][0];
    const az = points[i][1];
    const bx = points[i + 1][0];
    const bz = points[i + 1][1];
    const len = Math.hypot(bx - ax, bz - az) || 1e-6;
    segs.push({ ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, start: total });
    total += len;
  }
  return {
    total: total,
    at: function (s) {
      const d = Math.max(0, Math.min(total - 1e-4, s));
      let seg = segs[segs.length - 1];
      for (let i = 0; i < segs.length; i++) {
        if (d < segs[i].start + segs[i].len) { seg = segs[i]; break; }
      }
      const t = d - seg.start;
      return {
        x: seg.ax + seg.dx * t,
        z: seg.az + seg.dz * t,
        nx: -seg.dz,
        nz: seg.dx
      };
    }
  };
}

// Shared organic leaf masses retain instancing; the palette is baked once.
function crownPuffGeometry(seed, shade, color) {
  const g = foliageGeometry(seed, 1, shade);
  const c = g.attributes.color;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * color.r, c.getY(i) * color.g, c.getZ(i) * color.b);
  return g;
}

// ---- 竹丛：若干根带弯的竹竿 + 竿顶几把下垂的竹叶，整丛烘成一块几何 ----
function bambooClumpGeometry(cfg) {
  // 一丛竹子：若干根带弯的竹竿 + 竿上墨绿竹叶。整丛烘成一块几何，一个 draw call 撒进竹林
  const pos = [];
  const nor = [];
  const col = [];
  const cStem = new THREE.Color(cfg.stemColor || '#7C9A54');
  const cLeaf = new THREE.Color(cfg.leafColor || '#5E7C3E');
  const cLeaf2 = cLeaf.clone().offsetHSL(-0.01, 0.06, 0.085);
  const cStemDark = cStem.clone().offsetHSL(0, 0.03, -0.08);
  const rnd = lcg(90210);
  // 保留配置中的竿/叶数量；把宽折片的面数预算让给五棱竿与细竹节。
  const culms = cfg.culms ?? 9;
  const segs = cfg.segs ?? 5;
  const sides = Math.max(5, cfg.sides ?? 3);
  const H = cfg.height ?? 5.2;
  const tmpC = new THREE.Color();
  const cLeafBase = new THREE.Color();
  const cLeafEdge = new THREE.Color();
  const cLeafRidge = new THREE.Color();
  const cLeafTip = new THREE.Color();

  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, c) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    // 插入阶段暂存，组装后统一计算真实法线，便于阴影及几何回归。
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
  };

  // 逐顶点上色：叶基暗、叶缘中、叶尖亮，竹叶才有厚度
  const tri3 = (ax, ay, az, bx, by, bz, cx, cy, cz, ca, cb2, cc) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    col.push(ca.r, ca.g, ca.b, cb2.r, cb2.g, cb2.b, cc.r, cc.g, cc.b);
  };

  for (let k = 0; k < culms; k++) {
    const ang = (k / culms) * Math.PI * 2 + rnd() * 0.7;
    const rad = 0.1 + rnd() * 0.85;
    const bx = Math.cos(ang) * rad;
    const bz = Math.sin(ang) * rad;
    const h = H * (0.72 + rnd() * 0.5);
    const lean = (0.08 + rnd() * 0.2) * (rnd() < 0.5 ? -1 : 1);
    const leanAng = ang + (rnd() - 0.5) * 1.2;
    const dx = Math.cos(leanAng) * lean;
    const dz = Math.sin(leanAng) * lean;
    const r0 = 0.062 + rnd() * 0.03;
    const rings = [];
    for (let t = 0; t <= segs; t++) {
      const u = t / segs;
      const y = h * u;
      const cx = bx + dx * u * u * h * 0.45;
      const cz = bz + dz * u * u * h * 0.45;
      const r = r0 * (1 - u * 0.34);
      const ring = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2 + k;
        ring.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
      }
      rings.push(ring);
    }
    for (let t = 0; t < segs; t++) {
      // 节间只作轻微明暗变化；节点由后面的窄凸圈表现。
      tmpC.copy(cStem).multiplyScalar(t % 2 === 0 ? 1 : 0.96);
      for (let j = 0; j < sides; j++) {
        const j2 = (j + 1) % sides;
        const a = rings[t][j];
        const b = rings[t][j2];
        const c = rings[t + 1][j2];
        const d = rings[t + 1][j];
        tri(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], tmpC);
        tri(a[0], a[1], a[2], d[0], d[1], d[2], c[0], c[1], c[2], tmpC);
      }
    }
    // Narrow raised collars read as nodes, not alternating metre-long dark bars.
    for (let t = 1; t < segs; t++) for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides, u = t / segs;
      const cx = bx + dx * u * u * h * 0.45, cz = bz + dz * u * u * h * 0.45;
      const a = rings[t][j], b = rings[t][j2];
      const ax = cx + (a[0] - cx) * 1.12, az = cz + (a[2] - cz) * 1.12;
      const bx2 = cx + (b[0] - cx) * 1.12, bz2 = cz + (b[2] - cz) * 1.12;
      tri(ax, a[1] - 0.012, az, ax, a[1] + 0.014, az, bx2, b[1] + 0.014, bz2, cStemDark);
      tri(ax, a[1] - 0.012, az, bx2, b[1] + 0.014, bz2, bx2, b[1] - 0.012, bz2, cStemDark);
    }
    // 竹叶：只在竿上部几簇，每簇是一把朝外的下垂扇面；
    // 一片叶用两枚细三角，短小披针形，轻折而非宽长折片；
    // 不再从竿中段起均匀放射成「试管刷」。
    const clusters = cfg.clusters ?? 4;
    const blades = cfg.blades ?? 6;
    const leafStart = cfg.leafStart ?? 0.66;
    const leafSpan = cfg.leafSpan ?? 0.3;
    const leafLen = cfg.leafLen ?? [0.42, 0.78];
    const leafWidth = cfg.leafWidth ?? 0.075;
    const leafArch = cfg.leafArch ?? 0.22;
    const leafDroop = cfg.leafDroop ?? 0.85;
    const leafFan = cfg.leafFan ?? 1.5;
    const leafShade = cfg.leafShade ?? [0.86, 1.12];
    for (let q = 0; q < clusters; q++) {
      const cu = leafStart + (clusters === 1 ? 0 : (q / (clusters - 1)) * leafSpan) + (rnd() - 0.5) * 0.03;
      const cy = h * cu;
      const ccx = bx + dx * cu * cu * h * 0.45;
      const ccz = bz + dz * cu * cu * h * 0.45;
      const fanDir = leanAng + (q % 2 ? 0.85 : -0.65) + rnd() * 0.7;
      for (let b2 = 0; b2 < blades; b2++) {
        const a2 = fanDir + (b2 / Math.max(1, blades - 1) - 0.5) * leafFan + (rnd() - 0.5) * 0.2;
        const sx = Math.cos(a2);
        const sz = Math.sin(a2);
        const len = (leafLen[0] + rnd() * (leafLen[1] - leafLen[0])) * 0.62;
        const w = leafWidth * (0.78 + rnd() * 0.45) * 0.58;
        const twig = 0.035 + Math.sin((b2 + 1) / (blades + 1) * Math.PI) * 0.20;
        const ox = ccx + Math.cos(fanDir) * twig;
        const oy = cy + (rnd() - 0.5) * 0.12;
        const oz = ccz + Math.sin(fanDir) * twig;
        // 叶轴：根 → 腰（前伸且上弓） → 尖（继续前伸、明显下垂）
        const mx = ox + sx * len * 0.55;
        const my = oy + len * leafArch;
        const mz = oz + sz * len * 0.55;
        const tx = ox + sx * len;
        // 个字叶簇：同簇叶片分层下垂（确定性，不消耗随机序列，保护实例布局）
        const droop = leafDroop * (0.86 + 0.14 * ((b2 % 3) / 2));
        const ty = oy - len * droop + len * leafArch * 0.3;
        const tz = oz + sz * len;
        const px = -sz * w;
        const pz = sx * w;
        const ridge = w * 0.18;
        // 逐叶明暗：叶基暗、叶缘中、中脉亮、叶尖最亮
        tmpC.copy(rnd() < 0.4 ? cLeaf2 : cLeaf);
        const sh = leafShade[0] + rnd() * (leafShade[1] - leafShade[0]);
        cLeafBase.copy(tmpC).offsetHSL(0, 0, -0.09).multiplyScalar(sh);
        cLeafEdge.copy(tmpC).offsetHSL(0, 0, 0.02).multiplyScalar(sh);
        cLeafRidge.copy(cLeafEdge).offsetHSL(0, 0, 0.06).multiplyScalar(sh);
        cLeafTip.copy(tmpC).offsetHSL(0.006, -0.02, 0.055).multiplyScalar(sh);
        // Two small, gently folded facets instead of four broad folded ribbons.
        tri3(ox, oy, oz, mx + px, my + ridge, mz + pz, tx, ty, tz,
          cLeafBase, cLeafEdge, cLeafTip);
        tri3(ox, oy, oz, tx, ty, tz, mx - px, my - ridge, mz - pz,
          cLeafBase, cLeafTip, cLeafRidge);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// Texture-free earth and timber: spend the old wall tessellation on silhouette,
// recessed shutters, jambs and raised sills. Three variants share the same footprint.
function wallGeometry(variant = 0) {
  const wall = new THREE.BoxGeometry(1, 1, 1, 2, 7, 2).toNonIndexed();
  wall.translate(0, 0.5, 0);
  const pos = [], col = [];
  const p = wall.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    pos.push(x, y, z);
    // Coherent earth strata and a dark planted foot, never random gemstone faces.
    const tone = 0.97 - Math.max(0, 0.22 - y) * 0.65 - Math.max(0, y - 0.86) * 0.35
      + Math.sin(y * 24 + variant * 0.6) * 0.018 + (valueNoise2(x * 3 + z * 2, y * 7) - 0.5) * 0.035;
    col.push(tone, tone * 0.994, tone * 0.98);
  }
  const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  function timber(x, y, z, w, h, d, tone, turn = false) {
    const p = box.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i) * w, py = p.getY(i) * h, pz = p.getZ(i) * d;
      pos.push(x + (turn ? pz : px), y + py, z + (turn ? -px : pz));
      col.push(tone, tone * 0.94, tone * 0.82);
    }
  }
  // Corner posts and continuous eave/base ties sit inside the old collision box.
  for (const x of [-0.488, 0.488]) for (const z of [-0.488, 0.488]) timber(x, 0.48, z, 0.024, 0.96, 0.024, 0.46);
  for (const z of [-0.493, 0.493]) for (const y of [0.065, 0.945]) timber(0, y, z, 0.99, 0.035, 0.028, y < 0.1 ? 0.55 : 0.44);
  function window(x, z, turn = false) {
    const w = turn ? 0.23 : 0.17, y = 0.565, h = 0.26;
    const at = (dx, dy, depth, ww, hh, dd, tone) => timber(x + (turn ? depth * 0.74 : dx), y + dy,
      z + (turn ? -dx : depth), ww, hh, turn ? dd * 0.74 : dd, tone, turn);
    at(0, 0, 0.003, w, h, 0.004, 0.27);
    for (const dx of [-w / 2, w / 2]) at(dx, 0, 0.009, 0.012, h + 0.034, 0.008, 0.46);
    at(0, h / 2, 0.009, w + 0.025, 0.022, 0.008, 0.43);
    at(0, -h / 2, 0.01, w + 0.035, 0.028, 0.014, 0.60);
    if (variant === 1) {
      at(0, 0, 0.011, 0.01, h, 0.006, 0.54);
      at(0, 0, 0.011, w, 0.012, 0.006, 0.54);
    } else {
      const bars = variant === 2 ? 3 : 2;
      for (let j = 1; j <= bars; j++) at(-w / 2 + w * j / (bars + 1), 0, 0.011, 0.009, h, 0.006, 0.51);
    }
  }
  for (const x of [-0.29, 0.29]) window(x, 0.5);
  for (const side of [-1, 1]) {
    // Mirror the side window without reversing any triangle winding.
    if (side > 0) window(0.5, 0, true);
    else {
      const start = pos.length; window(0.5, 0, true);
      for (let i = start; i < pos.length; i += 3) { pos[i] = -pos[i]; pos[i + 2] = -pos[i + 2]; }
    }
  }
  // The existing 1.15m door instance is unchanged and remains completely visible.
  for (const side of [-1, 1]) timber(side * 0.107, 0.35, 0.511, 0.016, 0.7, 0.012, 0.42);
  timber(0, 0.72, 0.511, 0.23, 0.035, 0.012, 0.48);
  wall.dispose(); box.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}

function roofGeometry() {
  const pos = [];
  function tri(a, b, c) { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
  const A = [-0.5, 0, 0.5], B = [0.5, 0, 0.5], C = [0.5, 0, -0.5], D = [-0.5, 0, -0.5];
  const E = [0, 1, 0.5], F = [0, 1, -0.5];
  // 只留两坡；两端的山墙单独做一个面，用墙色（不然整座屋顶是一块大三角）
  tri(A, E, F); tri(A, F, D);
  tri(B, C, F); tri(B, F, E);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---- 山墙：屋顶两端的三角面，材质用夯土墙色 ----
function gableGeometry() {
  const pos = [];
  function tri(a, b, c) { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
  const A = [-0.5, 0, 0.5], B = [0.5, 0, 0.5], C = [0.5, 0, -0.5], D = [-0.5, 0, -0.5];
  const E = [0, 1, 0.5], F = [0, 1, -0.5];
  tri(A, B, E);
  tri(C, D, F);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---- 秦汉农舍砖砌烟囱（阶梯屋面泛水座 + 收分烟道 + 透风烟孔 + 双坡小瓦烟帽，52 面）----
function chimneyGeometry() {
  const pos = [];
  const col = [];
  function quad(a, b, c, d, s) {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(s, s, s);
  }
  function tri(a, b, c, s) {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(s, s, s);
  }
  function frustum(y0, y1, rx0, rz0, rx1, rz1, shadeSide) {
    const b0 = [-rx0, y0, rz0], b1 = [rx0, y0, rz0], b2 = [rx0, y0, -rz0], b3 = [-rx0, y0, -rz0];
    const t0 = [-rx1, y1, rz1], t1 = [rx1, y1, rz1], t2 = [rx1, y1, -rz1], t3 = [-rx1, y1, -rz1];
    quad(b0, b1, t1, t0, shadeSide);
    quad(b1, b2, t2, t1, shadeSide * 0.90);
    quad(b2, b3, t3, t2, shadeSide * 0.86);
    quad(b3, b0, t0, t3, shadeSide * 0.94);
  }
  // 1. 屋面泛水灰泥护座 (y = 0..0.68)
  frustum(0.0, 0.68, 0.62, 0.62, 0.56, 0.56, 0.92);
  // 护座顶阶沿 (接烟身底)
  quad([-0.56, 0.68, 0.56], [0.56, 0.68, 0.56], [0.46, 0.68, 0.46], [-0.46, 0.68, 0.46], 1.04);
  quad([0.56, 0.68, 0.56], [0.56, 0.68, -0.56], [0.46, 0.68, -0.46], [0.46, 0.68, 0.46], 0.98);
  quad([0.56, 0.68, -0.56], [-0.56, 0.68, -0.56], [-0.46, 0.68, -0.46], [0.46, 0.68, -0.46], 0.94);
  quad([-0.56, 0.68, -0.56], [-0.56, 0.68, 0.56], [-0.46, 0.68, 0.46], [-0.46, 0.68, -0.46], 1.00);
  // 2. 微收分灰砖烟道 (y = 0.68..0.92) + 焦黑烟膛底面
  frustum(0.68, 0.92, 0.46, 0.46, 0.42, 0.42, 1.04);
  quad([-0.42, 0.92, 0.42], [0.42, 0.92, 0.42], [0.42, 0.92, -0.42], [-0.42, 0.92, -0.42], 0.34);
  // 3. 烟顶两侧出烟砖柱 (y = 0.92..1.00，前后通透出烟口)
  for (const sx of [-0.33, 0.33]) {
    const x0 = sx - 0.08, x1 = sx + 0.08;
    const z0 = -0.34, z1 = 0.34;
    quad([x0, 0.92, z1], [x1, 0.92, z1], [x1, 1.00, z1], [x0, 1.00, z1], 0.88);
    quad([x1, 0.92, z1], [x1, 0.92, z0], [x1, 1.00, z0], [x1, 1.00, z1], 0.82);
    quad([x1, 0.92, z0], [x0, 0.92, z0], [x0, 1.00, z0], [x1, 1.00, z0], 0.80);
    quad([x0, 0.92, z0], [x0, 0.92, z1], [x0, 1.00, z1], [x0, 1.00, z0], 0.86);
  }
  // 4. 双坡出檐小瓦烟帽 (y = 0.98..1.10)
  const hw = 0.68, hd = 0.62, ey = 0.98, ry = 1.10;
  quad([-hw, ey, hd], [0, ry, hd], [0, ry, -hd], [-hw, ey, -hd], 0.86);
  quad([0, ry, hd], [hw, ey, hd], [hw, ey, -hd], [0, ry, -hd], 0.78);
  quad([-hw, ey, -hd], [0, ry, -hd], [0, ry, hd], [-hw, ey, hd], 0.56);
  quad([0, ry, -hd], [hw, ey, -hd], [hw, ey, hd], [0, ry, hd], 0.54);
  tri([-hw, ey, hd], [hw, ey, hd], [0, ry, hd], 0.74);
  tri([hw, ey, -hd], [-hw, ey, -hd], [0, ry, -hd], 0.70);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

export function createVillage(cfg, field, pondCfg) {
  const rand = lcg(77213);
  const group = new THREE.Group();
  group.name = 'village';
  const blockers = [];

  // ---------- 阡陌主路 ----------
  const road = polyline(cfg.road.points);
  const rb = newBuf();
  const hw = cfg.road.width * 0.5;
  // 保持与旧路网一致的 rand() 步进次数，确保村舍/竹林/田畴随机数序列零偏移
  for (let i = 0; i < cfg.road.points.length - 1; i++) {
    const a = cfg.road.points[i];
    const b = cfg.road.points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const cuts = Math.max(1, Math.ceil(len / 0.9));
    for (let s = 0; s < cuts; s++) rand();
  }
  const roadRand = lcg(77214);
  buildNaturalRoadRibbon(cfg.road.points, {
    field,
    halfWidth: hw,
    lift: cfg.road.lift + 0.014,
    sampleStep: 1.10,
    smoothPasses: 2,
    roadColor: cfg.road.color,
    vergeColor: cfg.fields.ridge,
    camber: 0.022,
    vergeWidth: 0.30,
    rutDepth: 0.007,
    scatterPebbles: true,
    pebbleStep: 6,
    rand: roadRand,
    sink: rb
  });
  const roadMesh = new THREE.Mesh(toGeo(rb), new THREE.MeshLambertMaterial({ vertexColors: true }));
  roadMesh.name = 'village-road';
  group.add(roadMesh);

  // 阡陌支路与屋脚暗影的缓冲区（都塞进 road 那条几何里，不额外加 draw call）
  const cPath = new THREE.Color(cfg.road.color).offsetHSL(0, 0.04, -0.06);
  const cPathEdge = cPath.clone().offsetHSL(0, 0.02, -0.07);
  const cLaneStone = new THREE.Color((cfg.spur && cfg.spur.stone) || '#9C968A');
  const cShade = new THREE.Color(cfg.houses.groundShade || '#7E9152');
  const cCurb = new THREE.Color((cfg.spur && cfg.spur.curb) || '#948F81');
  const laneStones = [];
  const xb = newBuf();

  // ---------- 良田 ----------
  const fb = newBuf();
  const cCropA = new THREE.Color(cfg.fields.cropA);
  const cCropB = new THREE.Color(cfg.fields.cropB);
  const cRidge = new THREE.Color(cfg.fields.ridge);
  const paddyRand = lcg(88321);
  const cPaddySoil = new THREE.Color('#5A523F');
  const cMilletSoil = new THREE.Color('#776342');
  const plots = [];
  for (let bi = 0; bi < cfg.fields.blocks.length; bi++) {
    const blk = cfg.fields.blocks[bi];
    const pw = blk.plot[0];
    const ph = blk.plot[1];
    for (let r = 0; r < blk.rows; r++) {
      for (let c = 0; c < blk.cols; c++) {
        const x0 = blk.x + c * (pw + blk.gap);
        const z0 = blk.z - r * (ph + blk.gap);
        const y = field.sample(x0 + pw * 0.5, z0 - ph * 0.5) + cfg.fields.lift;
        const isRicePaddy = (bi + r + c) % 3 !== 0;
        const inset = 0.34;
        // Raised field bund rim (田埂边框) enclosing the submerged soil bed
        const cBund = cRidge.clone().offsetHSL(0, 0, (paddyRand() - 0.5) * 0.04);
        pushQuadY(fb, x0, z0 - ph, x0 + pw, z0, y + 0.014, cBund);
        const bedSoil = isRicePaddy ? cPaddySoil : cMilletSoil;
        const cBed = bedSoil.clone().offsetHSL(0, 0, (paddyRand() - 0.5) * 0.04);
        pushQuadY(fb, x0 + inset, z0 - ph + inset, x0 + pw - inset, z0 - inset, y + 0.022, cBed);
        const crop = (c + r) % 2 === 0 ? cCropA : cCropB;
        const rows = 4;
        const rh = (ph - inset * 2) / rows;
        for (let k = 0; k < rows; k++) {
          const zt = (z0 - inset) - k * rh;
          const cc = crop.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.05);
          const furrowCol = isRicePaddy
            ? cPaddySoil.clone().lerp(cc, 0.42)
            : cc.clone().multiplyScalar(0.88);
          pushQuadY(fb, x0 + inset + 0.14, zt - rh * 0.84, x0 + pw - inset - 0.14, zt - rh * 0.16, y + 0.028, furrowCol);
        }
        plots.push([x0 + pw * 0.5, z0 - ph * 0.5]);
      }
    }
  }
  const fieldMesh = new THREE.Mesh(toGeo(fb), new THREE.MeshLambertMaterial({ vertexColors: true }));
  fieldMesh.name = 'village-fields';
  group.add(fieldMesh);
  // 田块外框（后面撒竹丛时要避开）
  const fieldBlocks = cfg.fields.blocks.map(function (blk) {
    const bw = blk.cols * (blk.plot[0] + blk.gap);
    const bd = blk.rows * (blk.plot[1] + blk.gap);
    return { x: blk.x + bw * 0.5, z: blk.z - bd * 0.5, w: bw, d: bd };
  });

  // ---------- 屋舍 ----------
  const hc = cfg.houses;
  const nMain = hc.count;
  const nb = hc.back ? hc.back.count : 0;
  const n = nMain + nb;
  // Same three instanced draw slots, now three joinery silhouettes and no textures.
  const bodyMeshes = [0, 1, 2].map(variant => new THREE.InstancedMesh(
    wallGeometry(variant), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), n));
  const bodySlots = [0, 0, 0];
  const roofMesh = new THREE.InstancedMesh(
    roofGeometry(),
    new THREE.MeshLambertMaterial({ flatShading: true }),
    n
  );
  roofMesh.name = 'houses-roof';
  const gableMesh = new THREE.InstancedMesh(
    gableGeometry(),
    new THREE.MeshLambertMaterial({ flatShading: true }),
    n
  );
  gableMesh.name = 'houses-gable';
  const doorGeo = new THREE.PlaneGeometry(1, 1);
  doorGeo.translate(0, 0.5, 0);
  const doorMesh = new THREE.InstancedMesh(
    doorGeo,
    new THREE.MeshLambertMaterial({ color: hc.door, side: THREE.DoubleSide }),
    n
  );
  doorMesh.name = 'houses-door';

  const dummy = new THREE.Object3D();
  const cWall = new THREE.Color(hc.wall);
  const cWallDark = new THREE.Color(hc.wallDark);
  const cRoof = new THREE.Color(hc.roof);
  const cRoofDark = new THREE.Color(hc.roofDark);
  const tmp = new THREE.Color();
  const houses = [];
  const houseInfo = [];
  const chimneys = [];
  const chimMat = [];
  // 给舆图留的落点：竹林与桑林按 3D 里的真实位置画，图和景才对得上
  const bambooSpots = [];
  const mulberrySpots = [];

  for (let i = 0; i < n; i++) {
    // 主街一排 + 屋后第二排：第二排退进 24~32 米，长巷连回主路，俯瞰才不是一条线
    let t;
    let side;
    let off;
    if (i < nMain) {
      t = 0.09 + (i / Math.max(1, nMain - 1)) * 0.82;
      side = i % 2 === 0 ? 1 : -1;
      off = hc.offsetRange[0] + rand() * (hc.offsetRange[1] - hc.offsetRange[0]);
    } else {
      const bi = i - nMain;
      const bkc = hc.back;
      t = (bkc.ts && bkc.ts[bi] !== undefined) ? bkc.ts[bi] : 0.2 + (bi / Math.max(1, nb - 1)) * 0.6;
      side = bkc.side !== undefined ? bkc.side : -1;
      off = bkc.offset[0] + rand() * (bkc.offset[1] - bkc.offset[0]);
    }
    const p = road.at(road.total * t);
    const hx = p.x + p.nx * off * side;
    const hz = p.z + p.nz * off * side;
    const gy = field.sample(hx, hz);
    const rot = Math.atan2(-p.nx * side, -p.nz * side);
    const s = hc.sizeRange[0];
    const s2 = hc.sizeRange[1];
    const w = s[0] + rand() * (s2[0] - s[0]);
    const bh = s[1] + rand() * (s2[1] - s[1]);
    const d = s[2] + rand() * (s2[2] - s[2]);

    dummy.position.set(hx, gy - 0.15, hz);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(w, bh, d);
    dummy.updateMatrix();
    const bm = bodyMeshes[i % bodyMeshes.length];
    const bs = bodySlots[i % bodyMeshes.length]++;
    bm.setMatrixAt(bs, dummy.matrix);
    bm.setColorAt(bs, tmp.copy(cWall).lerp(cWallDark, rand() * 0.55));

    dummy.position.set(hx, gy + bh - 0.16, hz);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(w + hc.overhang * 2, hc.roofHeight, d + hc.overhang * 2);
    dummy.updateMatrix();
    roofMesh.setMatrixAt(i, dummy.matrix);
    roofMesh.setColorAt(i, tmp.copy(cRoof).lerp(cRoofDark, rand() * 0.7));

    dummy.position.set(hx, gy + bh - 0.16, hz);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(w + hc.overhang * 2, hc.roofHeight, d + hc.overhang * 2);
    dummy.updateMatrix();
    gableMesh.setMatrixAt(i, dummy.matrix);
    gableMesh.setColorAt(i, tmp.copy(cWall).lerp(cWallDark, rand() * 0.4).offsetHSL(0, -0.02, 0.02));

    const front = d * 0.5 + 0.05;
    dummy.position.set(hx + Math.sin(rot) * front, gy - 0.1, hz + Math.cos(rot) * front);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(1.15, 2.0, 1);
    dummy.updateMatrix();
    doorMesh.setMatrixAt(i, dummy.matrix);

    blockers.push({ x: hx, z: hz, hw: w * 0.5 + 0.1, hd: d * 0.5 + 0.1, rot: rot, minY: gy - 0.15, maxY: gy + bh + hc.roofHeight - 0.16 });
    houses.push([hx, hz]);
    houseInfo.push({
      x: hx, z: hz, rot: rot, w: w, h: bh, d: d, gy: gy, side: side,
      doorX: hx + Math.sin(rot) * (d * 0.5 + 0.35),
      doorZ: hz + Math.cos(rot) * (d * 0.5 + 0.35),
      roadX: p.x, roadZ: p.z, nx: p.nx, nz: p.nz
    });

    // 烟囱：立在屋脊一侧的坡面上，烟从它嘴里出去
    {
      const W = w + hc.overhang * 2;
      const lx = w * 0.24;
      const lz = -d * 0.2;
      const roofY = gy + bh - 0.16 + hc.roofHeight * (1 - Math.abs(lx) / (W * 0.5));
      const c = new THREE.Object3D();
      c.position.set(hx + lx * Math.cos(rot) + lz * Math.sin(rot), roofY - 0.7, hz - lx * Math.sin(rot) + lz * Math.cos(rot));
      c.rotation.set(0, rot, 0);
      c.scale.set(0.34, 1.15, 0.34);
      c.updateMatrix();
      chimMat.push(c.matrix.clone());
      chimneys.push({ x: c.position.x, y: roofY - 0.7 + 1.16, z: c.position.z });
    }

    // 屋脚暗影：一块略大的深色地贴，压住「屋子飘在草地上」
    pushQuadRot(xb, hx, hz, w * 0.5 + 0.55, d * 0.5 + 0.55, rot, gy + 0.02,
      cShade.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.03));

    // 阡陌支路：从主路边斜插到门口。
    // 临街的屋是踩出来的小径；后排那几间走进来的长巷是真正的岔路——
    // 更宽、不收口、两边留两条深色路肩，路心垫几块踏脚石。
    const ax = p.x + p.nx * side * hw * 0.96;
    const az = p.z + p.nz * side * hw * 0.96;
    const sp = cfg.spur;
    const isBack = i >= nMain;
    const laneW = sp.laneWidth || 1.55;
    const bx = hx - p.nx * side * (d * 0.5 + sp.inset);
    const bz = hz - p.nz * side * (d * 0.5 + sp.inset);
    const bow = (rand() - 0.5) * (isBack ? 3.4 : 1.5);
    const mx = (ax + bx) * 0.5 + p.nx * (isBack ? 2.0 : 1.1) + -p.nz * bow;
    const mz = (az + bz) * 0.5 + p.nz * (isBack ? 2.0 : 1.1) + p.nx * bow;
    const steps = isBack ? 10 : 5;
    const baseW = isBack ? laneW : sp.width;
    const tap = isBack ? 0 : sp.taper;
    const spurPts = [[ax, az]];
    let px0 = ax;
    let pz0 = az;
    for (let t = 1; t <= steps; t++) {
      const u = t / steps;
      const iu = 1 - u;
      const qx = iu * iu * ax + 2 * iu * u * mx + u * u * bx;
      const qz = iu * iu * az + 2 * iu * u * mz + u * u * bz;
      spurPts.push([qx, qz]);
      const vx = qx - px0;
      const vz = qz - pz0;
      const vl = Math.hypot(vx, vz) || 1;
      const qw = baseW * (1 - u * tap);
      const nx2 = -vz / vl;
      const nz2 = vx / vl;
      const sy = Math.max(
        field.sample(px0, pz0),
        field.sample(qx, qz),
        field.sample((px0 + qx) * 0.5, (pz0 + qz) * 0.5)
      ) + cfg.road.lift - 0.012;

      if (isBack) {
        // 压边石：沿路缘每段埋几块半露的石头，把岔路从草地里"咬"出来。
        for (let k = -1; k <= 1; k += 2) {
          for (let f = 0.18; f < 1; f += 0.27) {
            const sx3 = px0 + (qx - px0) * f;
            const sz3 = pz0 + (qz - pz0) * f;
            const off = qw + 0.08 + rand() * 0.1;
            laneStones.push({
              x: sx3 + nx2 * k * off,
              y: sy - 0.03 + 0.028 + rand() * 0.012,
              z: sz3 + nz2 * k * off,
              rot: rand() * 6.28,
              sx: 0.22 + rand() * 0.18,
              sy: 0.11 + rand() * 0.07,
              sz: 0.20 + rand() * 0.14
            });
          }
        }

        // 踏脚石：每两段在两肋各摆一枚半埋的扁石，错开半块
        if (t % 2 === 0) {
          const rotS = Math.atan2(vx, vz) + (rand() - 0.5) * 0.35;
          for (let k = -1; k <= 1; k += 2) {
            const off = (t % 4 === 0 ? 1 : -1) * k * qw * 0.52;
            pushQuadRot(xb,
              (px0 + qx) * 0.5 + nx2 * off, (pz0 + qz) * 0.5 + nz2 * off,
              0.22 + rand() * 0.14, 0.17 + rand() * 0.1, rotS, sy + 0.020,
              cLaneStone.clone().offsetHSL(0, (rand() - 0.5) * 0.02, (rand() - 0.5) * 0.07));
          }
        }
      }
      px0 = qx;
      pz0 = qz;
    }
    buildNaturalRoadRibbon(spurPts, {
      field,
      halfWidth: baseW,
      lift: cfg.road.lift + (isBack ? 0.002 : -0.004),
      sampleStep: isBack ? 1.05 : 0.95,
      smoothPasses: 2,
      roadColor: isBack ? cPath : cPath.clone().lerp(cShade, 0.14),
      vergeColor: isBack ? cPathEdge : cShade,
      camber: isBack ? 0.028 : 0.012,
      vergeWidth: isBack ? 0.28 : 0.22,
      rutDepth: isBack ? 0.005 : 0.002,
      startFlare: baseW * 0.45,
      flareDist: 1.5,
      taper: tap,
      scatterPebbles: false,
      sink: xb
    });
    // 支路的折线一并交给舆图——省得图上再按另一套噪声猜一遍，屋和路对不上
    houseInfo[i].spur = { pts: spurPts, half: baseW, taper: tap, back: isBack };
  }
  bodyMeshes.forEach(function (m, k) {
    m.count = bodySlots[k];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.name = 'houses-body-' + k;
  });
  roofMesh.instanceMatrix.needsUpdate = true;
  doorMesh.instanceMatrix.needsUpdate = true;
  gableMesh.instanceMatrix.needsUpdate = true;
  if (gableMesh.instanceColor) gableMesh.instanceColor.needsUpdate = true;
  gableMesh.computeBoundingSphere();
  if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
  roofMesh.computeBoundingSphere();
  doorMesh.computeBoundingSphere();
  // ---- 屋面细部：短而贴坡的瓦/草搭接面，不再铺悬浮粗板条 ----
  // Bake surfaces, thin eaves and ridge into one existing draw-call slot.
  {
    const detail = newBuf();
    const c = new THREE.Color();
    const p = new THREE.Vector3(), normal = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3(), matrix = new THREE.Matrix4();
    const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const quat = new THREE.Quaternion(), euler = new THREE.Euler();
    const bake = (hi, lx, y, lz, sx, sy, sz, tilt, color) => {
      quat.setFromEuler(euler.set(0, hi.rot, tilt, 'YXZ'));
      matrix.compose(new THREE.Vector3(hi.x + lx * Math.cos(hi.rot) + lz * Math.sin(hi.rot),
        y, hi.z - lx * Math.sin(hi.rot) + lz * Math.cos(hi.rot)), quat, new THREE.Vector3(sx, sy, sz));
      normalMatrix.getNormalMatrix(matrix);
      for (let k = 0; k < box.attributes.position.count; k++) {
        p.fromBufferAttribute(box.attributes.position, k).applyMatrix4(matrix);
        normal.fromBufferAttribute(box.attributes.normal, k).applyMatrix3(normalMatrix).normalize();
        detail.pos.push(p.x, p.y, p.z); detail.nor.push(normal.x, normal.y, normal.z);
        detail.col.push(color.r, color.g, color.b);
      }
    };
    for (const [houseIndex, hi] of houseInfo.entries()) {
      const W = hi.w + hc.overhang * 2, D = hi.d + hc.overhang * 2;
      const baseY = hi.gy + hi.h - 0.16;
      const len = Math.hypot(W * 0.5, hc.roofHeight);
      const rows = Math.max(8, Math.round(D / 0.34));
      const courses = Math.max(3, Math.round(len / 0.85));
      const worldPoint = (x, z, lift) => [hi.x + x * Math.cos(hi.rot) + z * Math.sin(hi.rot),
        baseY + hc.roofHeight * (1 - Math.abs(x) / (W * 0.5)) + lift,
        hi.z - x * Math.sin(hi.rot) + z * Math.cos(hi.rot)];
      for (let side = -1; side <= 1; side += 2) for (let row = 0; row < rows; row++) {
        for (let course = 0; course < courses; course++) {
          const x0 = side * W * 0.5 * (course + 0.06) / courses;
          const x1 = side * W * 0.5 * (course + 0.94) / courses;
          const z0 = -D * 0.5 + (row + 0.13) * D / rows;
          const z1 = -D * 0.5 + (row + 0.87) * D / rows;
          c.copy(cRoof).lerp(cRoofDark, 0.12 + hash2(row + houseIndex * 17, course * 3 + side) * 0.20);
          const corners = [worldPoint(x0, z0, 0.018), worldPoint(x0, z1, 0.018),
            worldPoint(x1, z1, 0.026), worldPoint(x1, z0, 0.026)];
          // Winding stays outward on both slopes; normals come from the actual slope.
          const ids = side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
          for (const id of ids) { detail.pos.push(...corners[id]); detail.col.push(c.r, c.g, c.b); }
          for (let k = 0; k < 6; k++) detail.nor.push(0, 1, 0);
        }
      }
      // A shadow under the thin eave and a restrained ridge, within old overhangs.
      c.copy(cRoofDark).lerp(cRoof, 0.35);
      for (const side of [-1, 1]) {
        bake(hi, side * (W * 0.5 - 0.035), baseY - 0.018, 0, 0.07, 0.075, D, 0, c);
        const angle = Math.atan2(hc.roofHeight, W * 0.5) * -side;
        for (const end of [-1, 1]) bake(hi, side * W * 0.25, baseY + hc.roofHeight * 0.5 - 0.014,
          end * (D * 0.5 - 0.025), len - 0.08, 0.055, 0.05, angle, c);
      }
      c.copy(cRoof).lerp(cRoofDark, 0.22);
      bake(hi, 0, baseY + hc.roofHeight + 0.022, 0, 0.17, 0.09, D, 0, c);
    }
    box.dispose();
    const geometry = toGeo(detail);
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const tiles = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
    tiles.name = 'houses-tiles';
    group.add(tiles);
  }

  const chimGeo = chimneyGeometry();
  const chimMesh = new THREE.InstancedMesh(chimGeo, new THREE.MeshLambertMaterial({ color: hc.chimney || '#7A6A55', vertexColors: true, flatShading: true }), chimMat.length);
  chimMesh.name = 'houses-chimney';
  for (let i = 0; i < chimMat.length; i++) chimMesh.setMatrixAt(i, chimMat[i]);
  chimMesh.instanceMatrix.needsUpdate = true;
  chimMesh.computeBoundingSphere();
  group.add(chimMesh);
  // 压边石：半埋的小石头，一个 InstancedMesh 收掉（不额外占太多 draw call）
  if (laneStones.length) {
    const stMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ flatShading: true }),
      laneStones.length
    );
    stMesh.name = 'lane-stones';
    const so = new THREE.Object3D();
    for (let i = 0; i < laneStones.length; i++) {
      const s = laneStones[i];
      so.position.set(s.x, s.y, s.z);
      so.rotation.set((rand() - 0.5) * 0.4, s.rot, (rand() - 0.5) * 0.4);
      so.scale.set(s.sx, s.sy, s.sz);
      so.updateMatrix();
      stMesh.setMatrixAt(i, so.matrix);
      stMesh.setColorAt(i, tmp.copy(cCurb).offsetHSL(0, (rand() - 0.5) * 0.02, (rand() - 0.5) * 0.1));
    }
    stMesh.instanceMatrix.needsUpdate = true;
    if (stMesh.instanceColor) stMesh.instanceColor.needsUpdate = true;
    stMesh.computeBoundingSphere();
    group.add(stMesh);
  }
  const spurMesh = new THREE.Mesh(toGeo(xb), new THREE.MeshLambertMaterial({ vertexColors: true }));
  spurMesh.name = 'village-spurs';
  group.add.apply(group, bodyMeshes.concat([roofMesh, gableMesh, doorMesh, spurMesh]));

  // ---------- 竹林 ----------
  const bb = cfg.bamboo;
  const clumpGeo = bambooClumpGeometry(bb);
  const clumps = new THREE.InstancedMesh(
    clumpGeo,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
    bb.count
  );
  clumps.name = 'bamboo';
  {
    const areas = bb.areas || [bb.area];
    const roadW = cfg.road.width * 0.5 + 1.1;
    let placed = 0;
    let guard = 0;
    while (placed < bb.count && guard++ < bb.count * 120) {
      const ar = areas[Math.floor(rand() * areas.length)];
      const bx = ar[0] + rand() * (ar[2] - ar[0]);
      const bz = ar[1] + rand() * (ar[3] - ar[1]);
      let bad = false;
      for (let s2 = 0; s2 <= 40 && !bad; s2++) {
        const q = road.at(road.total * (s2 / 40));
        if (Math.hypot(q.x - bx, q.z - bz) < roadW) bad = true;
      }
      if (!bad) {
        for (let h = 0; h < houses.length; h++) {
          if (Math.hypot(houses[h][0] - bx, houses[h][1] - bz) < 4.6) { bad = true; break; }
        }
      }
      if (!bad) {
        for (let f = 0; f < fieldBlocks.length && !bad; f++) {
          const fb = fieldBlocks[f];
          if (Math.abs(bx - fb.x) < fb.w * 0.5 + 1.5 && Math.abs(bz - fb.z) < fb.d * 0.5 + 1.5) bad = true;
        }
      }
      if (bad) continue;
      const gy = field.sample(bx, bz);
      dummy.position.set(bx, gy - 0.05, bz);
      dummy.rotation.set(0, rand() * 6.28, 0);
      const sy = 0.78 + rand() * 0.4;
      dummy.scale.set(0.9 + rand() * 0.25, sy, 0.9 + rand() * 0.25);
      dummy.updateMatrix();
      clumps.setMatrixAt(placed, dummy.matrix);
      bambooSpots.push([bx, bz, sy]);
      placed++;
    }
    bb.count = placed;
    clumps.count = placed;
  }
  clumps.instanceMatrix.needsUpdate = true;
  clumps.computeBoundingSphere();
  group.add(clumps);

  // ---------- 桑树 ----------
  const mb = cfg.mulberry;
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshLambertMaterial({ color: mb.trunkColor, flatShading: true }),
    mb.count
  );
  trunks.name = 'mulberry-trunks';
  const branchGeo = new THREE.CylinderGeometry(0.04, 0.07, 1, 4);
  branchGeo.translate(0, 0.5, 0);
  const branches = new THREE.InstancedMesh(
    branchGeo,
    new THREE.MeshLambertMaterial({ color: mb.trunkColor, flatShading: true }),
    mb.count * 3
  );
  branches.name = 'mulberry-branches';
  // 桑叶：一片叶子两枚三角（沿中脉折一下，正反都有面），比"七团多面体"经得起近看
  const leafGeo = (function () {
    const b = [0, 0, 0];
    const tip = [0, 1, 0];
    const lf = [-0.34, 0.44, 0.11];
    const rt = [0.34, 0.44, 0.11];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(
      [].concat(b, lf, tip, b, tip, rt), 3
    ));
    // 叶基压暗、叶尖提亮：一片叶子自己就有明暗，叠起来才不像一层纸
    const cb = 0.80, cm = 0.97, ct = 1.10;
    g.setAttribute('color', new THREE.Float32BufferAttribute(
      [cb, cb, cb, cm, cm, cm, ct, ct, ct, cb, cb, cb, ct, ct, ct, cm, cm, cm], 3
    ));
    g.computeVertexNormals();
    return g;
  })();
  const leavesPer = mb.leavesPer || 240;
  const cans = new THREE.InstancedMesh(
    leafGeo,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    mb.count * leavesPer
  );
  cans.name = 'mulberry-leaves';
  // 远处（60 米开外）叶片缩到零：那时每片叶子只剩两三个像素，只会闪成噪点，
  // 体量交给冠心的两团暗绿。近处（桑园就在路边二三十米）完全不受影响。
  cans.material.onBeforeCompile = function (shader) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '  vec4 leafOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        '  float leafDist = distance(leafOrigin.xyz, cameraPosition);',
        '  transformed *= 1.0 - smoothstep(60.0, 110.0, leafDist);',
        '#endif'
      ].join(String.fromCharCode(10))
    );
  };
  chainProgramCacheKey(cans.material, 'mulberry-leaf-far');
  // 冠心：几团抖动过的暗绿叶团打底。以前是两颗规整的二十面体，
  // 近看像打磨过的宝石压在树中央，和四周飘散的叶片完全脱节。
  const corePuffs = mb.corePuffs ?? 3;
  const coreGeo = crownPuffGeometry(
    mb.coreSeed ?? 4477,
    mb.coreShade ?? [0.78, 1.06],
    new THREE.Color(mb.color).offsetHSL(0, 0.02, mb.coreTint ?? -0.04)
  );
  const cores = new THREE.InstancedMesh(
    coreGeo,
    new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true }),
    mb.count * corePuffs
  );
  cores.name = 'mulberry-core';
  let coreCount = 0;
  const cCan = new THREE.Color(mb.color);
  const upVec = new THREE.Vector3(0, 1, 0);
  const qRoll = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const eTmp = new THREE.Euler();
  const leafDir = new THREE.Vector3();
  let placed = 0;
  let brCount = 0;
  let canCount = 0;
  const spots = [];
  if (mb.parcels) {
    // 桑园：成垄成行，比乱撒更像人种的
    for (let pi = 0; pi < mb.parcels.length; pi++) {
      const pc = mb.parcels[pi];
      const gap = pc.gap || 4.6;
      const cols = Math.max(1, Math.round(pc.w / gap));
      const rows = Math.max(1, Math.round(pc.d / gap));
      for (let r = 0; r < rows; r++) {
        for (let c2 = 0; c2 < cols; c2++) {
          if (spots.length >= mb.count) break;
          const sx = pc.x - pc.w * 0.5 + ((c2 + 0.5) / cols) * pc.w + (rand() - 0.5) * 0.8;
          const sz = pc.z - pc.d * 0.5 + ((r + 0.5) / rows) * pc.d + (rand() - 0.5) * 0.8;
          spots.push([sx, sz]);
        }
      }
    }
  } else {
    let guard = 0;
    while (spots.length < mb.count && guard++ < mb.count * 60) {
      const mx = mb.area[0] + rand() * (mb.area[2] - mb.area[0]);
      const mz = mb.area[1] + rand() * (mb.area[3] - mb.area[1]);
      let near = Infinity;
      for (let s2 = 0; s2 < 40; s2++) {
        const q = road.at(road.total * (s2 / 40));
        const dd = Math.hypot(q.x - mx, q.z - mz);
        if (dd < near) near = dd;
      }
      if (near < 7) continue;
      let blocked = false;
      for (let h = 0; h < houses.length; h++) {
        if (Math.hypot(houses[h][0] - mx, houses[h][1] - mz) < 6) { blocked = true; break; }
      }
      if (blocked) continue;
      spots.push([mx, mz]);
    }
  }
  for (let i = 0; i < spots.length; i++) {
    const mx = spots[i][0];
    const mz = spots[i][1];
    const gy = field.sample(mx, mz);
    const h = 2.0 + rand() * 1.0;
    const r = mb.radiusRange[0] + rand() * (mb.radiusRange[1] - mb.radiusRange[0]);
    mulberrySpots.push([mx, mz, r, h]);
    dummy.position.set(mx, gy, mz);
    dummy.rotation.set((rand() - 0.5) * 0.05, rand() * 6.28, (rand() - 0.5) * 0.05);
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    // 主枝：从树干 2/3 高处斜着分开
    for (let b = 0; b < 3; b++) {
      const a = b * 2.39996 + rand() * 0.48;
      const tilt = 0.42 + rand() * 0.42;
      const len = h * (0.38 + rand() * 0.2);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(upVec, dir);
      dummy.position.set(mx, gy + h * (0.53 + b * 0.065), mz);
      dummy.quaternion.copy(q);
      dummy.scale.set(1, len, 1);
      dummy.updateMatrix();
      branches.setMatrixAt(brCount++, dummy.matrix);
    }
    // 冠心：主团居中、副团绕一圈错落堆开，尺寸收小，让叶片来撑外轮廓
    const cy0 = h * 0.94;
    const coreR = mb.coreRadius ?? [0.52, 0.4, 0.34];
    const coreSpread = mb.coreSpread ?? 0.5;
    const blobs = [];
    for (let c2 = 0; c2 < corePuffs; c2++) {
      const ca = (c2 / corePuffs) * Math.PI * 2 + rand() * 0.8;
      const off = c2 === 0 ? 0 : coreSpread * r * (0.62 + rand() * 0.35);
      const rr = r * (coreR[c2 % coreR.length] ?? coreR[coreR.length - 1]) * (0.9 + rand() * 0.2);
      dummy.position.set(
        mx + Math.cos(ca) * off,
        gy + cy0 + (c2 === 0 ? 0 : (rand() - 0.65) * r * 0.46),
        mz + Math.sin(ca) * off
      );
      dummy.quaternion.setFromEuler(new THREE.Euler(rand() * 0.8, rand() * 6.28, rand() * 0.8));
      dummy.scale.set(rr, rr * (0.63 + rand() * 0.16), rr);
      dummy.updateMatrix();
      cores.setMatrixAt(coreCount++, dummy.matrix);
      blobs.push({ x: dummy.position.x, y: dummy.position.y, z: dummy.position.z, r: rr });
    }
    // 叶片：贴在每个冠心叶团的表面长出来，而不是撒在一个比冠还大的球壳上。
    // 以前叶子飘在实心团外面一大圈，近看就是「爆炸碎片」；现在每片叶随机
    // 挑一团，沿团表面法线朝外，整体读作「几团长着鳞叶的叶簇」。
    const leafShell = mb.leafShell ?? [0.9, 1.06];
    const leafSc = mb.leafScale ?? [0.19, 0.32];
    for (let c2 = 0; c2 < leavesPer; c2++) {
      const bl = blobs[c2 % blobs.length];
      const a = rand() * Math.PI * 2;
      const el = Math.acos(1 - 2 * rand());          // 球面均匀
      const sh = leafShell[0] + rand() * (leafShell[1] - leafShell[0]);
      const nx = Math.sin(el) * Math.cos(a);
      const ny = Math.cos(el);
      const nz = Math.sin(el) * Math.sin(a);
      dummy.position.set(bl.x + nx * bl.r * sh, bl.y + ny * bl.r * sh * 0.8, bl.z + nz * bl.r * sh);
      // 叶轴沿团表面法线朝外（略上扬），再绕自身轴随机滚转，避免整片侧对镜头
      leafDir.set(nx, ny * 0.7 + 0.25, nz).normalize();
      dummy.quaternion.setFromUnitVectors(upVec, leafDir);
      dummy.quaternion.multiply(qRoll.setFromAxisAngle(upVec, rand() * 6.283));
      dummy.quaternion.multiply(qTilt.setFromEuler(
        eTmp.set((rand() - 0.5) * 0.55, 0, (rand() - 0.5) * 0.55)));
      const ls = leafSc[0] + rand() * (leafSc[1] - leafSc[0]);
      dummy.scale.set(ls * (0.85 + rand() * 0.3), ls, ls * (0.85 + rand() * 0.3));
      dummy.updateMatrix();
      cans.setMatrixAt(canCount, dummy.matrix);
      cans.setColorAt(canCount, tmp.copy(cCan).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.13));
      canCount++;
    }
    placed++;
  }
  trunks.count = placed;
  branches.count = brCount;
  cans.count = canCount;
  cores.count = coreCount;
  trunks.instanceMatrix.needsUpdate = true;
  branches.instanceMatrix.needsUpdate = true;
  cans.instanceMatrix.needsUpdate = true;
  if (cans.instanceColor) cans.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  branches.computeBoundingSphere();
  cans.computeBoundingSphere();
  cores.instanceMatrix.needsUpdate = true;
  cores.computeBoundingSphere();
  group.add(trunks, branches, cores, cans);

  // ---------- 美池 ----------
  // 池岸不画成圆规圆：半径按角度做低频起伏，水心略深、岸边略亮
  // 岸线不能靠猜：沿每个方向二分出「地面正好等于水面」的那个半径，
  // 否则水片边缘会悬在坡上（之前就是一整块浮着的浅盘子）
  const segs = 44;
  const shoreR = function (ang) {
    const cx = Math.cos(ang);
    const cz = Math.sin(ang);
    let lo = 1.5;
    let hi = pondCfg.radius * 1.2;
    for (let k = 0; k < 22; k++) {
      const mid = (lo + hi) * 0.5;
      if (field.sample(pondCfg.x + cx * mid, pondCfg.z + cz * mid) < pondCfg.waterY) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const rim = [];
  for (let i = 0; i < segs; i++) {
    const ang = (i / segs) * Math.PI * 2;
    const base = shoreR(ang);
    rim.push(base * (1 + (valueNoise1(ang * 2.3 + 2.1) - 0.5) * 0.03) + 0.04);
  }
  const pPos = [];
  const pNor = [];
  const pCol = [];
  const cMid = new THREE.Color(pondCfg.color).offsetHSL(0.01, 0.1, -0.15);
  const cRimC = new THREE.Color(pondCfg.color).offsetHSL(0, -0.02, 0.02);
  const pushWater = function (ax, az, bx, bz, cx, cz, ca, cb, cc2) {
    pPos.push(ax, 0, az, bx, 0, bz, cx, 0, cz);
    pNor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    pCol.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc2.r, cc2.g, cc2.b);
  };
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const r0 = rim[i];
    const r1 = rim[(i + 1) % segs];
    // 注意绕向：从上看是逆时针，法线才朝上，否则整个水面会被背面剔除掉
    pushWater(0, 0, Math.cos(a1) * r1, Math.sin(a1) * r1, Math.cos(a0) * r0, Math.sin(a0) * r0,
      cMid, cRimC, cRimC);
  }
  const pondGeo = new THREE.BufferGeometry();
  pondGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
  pondGeo.setAttribute('normal', new THREE.Float32BufferAttribute(pNor, 3));
  pondGeo.setAttribute('color', new THREE.Float32BufferAttribute(pCol, 3));
  // 池水半透明：池底与水下鱼群要能透出来。做法与河道水面一致 —— 不写深度，
  // 并排在透明队列前部（renderOrder 1），鱼（renderOrder 3）才能画在水面之上
  const pond = new THREE.Mesh(pondGeo, new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: Math.min(0.56, pondCfg.opacity),
    depthWrite: false,
    side: THREE.DoubleSide
  }));
  pond.name = 'pond';
  pond.renderOrder = 1;
  pond.position.set(pondCfg.x, pondCfg.waterY, pondCfg.z);
  group.add(pond);

  // 冬候薄冰一线：池缘淡冰环，仅冬季可见
  const iceRim = new THREE.Mesh(
    new THREE.RingGeometry(pondCfg.radius * 0.90, pondCfg.radius * 1.02, 48),
    new THREE.MeshBasicMaterial({ color: '#E9F1F2', transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  iceRim.geometry.rotateX(-Math.PI / 2);
  iceRim.name = 'pond-ice-rim';
  iceRim.position.set(pondCfg.x, pondCfg.waterY + 0.02, pondCfg.z);
  iceRim.visible = false;
  group.add(iceRim);

  // 水膜：鱼（renderOrder 3）画完之后再罩一层极淡的池水色，鱼才像沉在水面之下，
  // 夜里也顺带被压暗，不会在月光下发白
  const pondFilm = new THREE.Mesh(pondGeo, new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: Math.min(0.22, pondCfg.filmOpacity),
    depthWrite: false,
    side: THREE.DoubleSide
  }));
  pondFilm.name = 'pond-film';
  pondFilm.renderOrder = 4;
  pondFilm.position.set(pondCfg.x, pondCfg.waterY, pondCfg.z);
  group.add(pondFilm);

  // 池边芦苇：两片交叉的窄叶，绕池一圈，压住水陆交界
  const reedGeo = newBuf();
  const cReedLo = new THREE.Color(cfg.reeds.color);
  const cReedHi = new THREE.Color(cfg.reeds.color2);
  for (let i = 0; i < cfg.reeds.count; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = shoreR(ang) * (0.95 + rand() * 0.22);
    const rx = pondCfg.x + Math.cos(ang) * rr;
    const rz = pondCfg.z + Math.sin(ang) * rr;
    const ry = Math.max(field.sample(rx, rz), pondCfg.waterY - 0.35);
    const h = cfg.reeds.height[0] + rand() * (cfg.reeds.height[1] - cfg.reeds.height[0]);
    const w = 0.035 + rand() * 0.03;
    const lean = (rand() - 0.5) * 0.5;
    const dir = rand() * Math.PI;
    const ux2 = Math.cos(dir) * w;
    const uz2 = Math.sin(dir) * w;
    const vx2 = -Math.sin(dir) * w * 0.6;
    const vz2 = Math.cos(dir) * w * 0.6;
    const cLo = cReedLo.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.06);
    const cHi = cReedHi.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.06);
    // 一片叶：窄底边 → 外倾垂尖（单三角，面数与基线持平；垂尖+外倾+收窄取代直刺）
    const tri = function (sx, sz, ax2, az2) {
      const tY = ry + h * 0.86;
      const tX = rx + lean * 1.7, tZ = rz + lean * 0.68;
      reedGeo.pos.push(
        rx + sx, ry, rz + sz,
        rx + ax2, ry, rz + az2,
        tX, tY, tZ);
      for (let k = 0; k < 3; k++) reedGeo.nor.push(0, 1, 0);
      reedGeo.col.push(
        cLo.r, cLo.g, cLo.b, cLo.r, cLo.g, cLo.b, cHi.r, cHi.g, cHi.b);
    };
    tri(-ux2, -uz2, ux2, uz2);
    tri(-vx2, -vz2, vx2, vz2);
  }
  const reedMesh = new THREE.Mesh(toGeo(reedGeo), new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  }));
  reedMesh.name = 'reeds';
  group.add(reedMesh);

  return {
    group: group,
    blockers: blockers,
    houses: houses,
    houseInfo: houseInfo,
    chimneys: chimneys,
    plots: plots,
    road: road,
    bamboo: bambooSpots,
    mulberry: mulberrySpots,
    pond: { x: pondCfg.x, z: pondCfg.z, rim: rim, waterY: pondCfg.waterY },
    count: n
  };
}

function trapColor(cfg) {
  return cfg.pondColor || '#A8C8BC';
}