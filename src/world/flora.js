import * as THREE from 'three';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 远景树改成「整棵烘成一个几何、多种形态循环用」：见 makeFarTreeGeometry。
// 形态、枝数、花簇数、色相层次全部由 world.json flora.farTree 给，不在这里写死。

// ---------- 近景树：真正带枝干的桃树，只给路边几十棵用 ----------
// 合并几何的小工具：所有零件烘进一个 BufferGeometry，一棵树一个 draw call 的料
function partSink() {
  const pos = [];
  const nor = [];
  const col = [];
  return {
    pos: pos, nor: nor, col: col,
    // a→b 的圆润锥台，seg 段（5–6 边形），支持首尾渐变顶点色与精确朝外法线
    tube: function (ax, ay, az, bx, by, bz, r1, r2, seg, colA, colB, twist) {
      const c0 = colA;
      const c1 = colB || colA;
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const L = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / L;
      const uy = dy / L;
      const uz = dz / L;
      let px = 0;
      let py = 0;
      let pz = 0;
      if (Math.abs(uy) < 0.9) {
        px = 1; py = 0; pz = 0;
      } else {
        px = 0; py = 1; pz = 0;
      }
      let qx = uy * pz - uz * py;
      let qy = uz * px - ux * pz;
      let qz = ux * py - uy * px;
      const ql = Math.hypot(qx, qy, qz) || 1;
      qx /= ql; qy /= ql; qz /= ql;
      px = qy * uz - qz * uy;
      py = qz * ux - qx * uz;
      pz = qx * uy - qy * ux;
      const t0 = twist || 0;
      const t1 = t0 + 0.16;
      const ring = function (cx, cy, cz, r, t) {
        const out = [];
        for (let k = 0; k < seg; k++) {
          const a = t + (k / seg) * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const rx = px * ca + qx * sa;
          const ry = py * ca + qy * sa;
          const rz = pz * ca + qz * sa;
          out.push([cx + rx * r, cy + ry * r, cz + rz * r, rx, ry, rz]);
        }
        return out;
      };
      const A = ring(ax, ay, az, r1, t0);
      const B = ring(bx, by, bz, r2, t1);
      const slope = (r1 - r2) / L;
      const pushVert = function (v, c) {
        pos.push(v[0], v[1], v[2]);
        let nx = v[3] + ux * slope;
        let ny = v[4] + uy * slope;
        let nz = v[5] + uz * slope;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / nl, ny / nl, nz / nl);
        col.push(c.r, c.g, c.b);
      };
      for (let k = 0; k < seg; k++) {
        const k2 = (k + 1) % seg;
        const shade = 0.94 + 0.10 * Math.cos((k / seg) * Math.PI * 2 + 0.6);
        const ca0 = { r: c0.r * shade, g: c0.g * shade, b: c0.b * shade };
        const cb1 = { r: c1.r * shade, g: c1.g * shade, b: c1.b * shade };
        pushVert(A[k], ca0); pushVert(B[k], cb1); pushVert(B[k2], cb1);
        pushVert(A[k], ca0); pushVert(B[k2], cb1); pushVert(A[k2], ca0);
      }
    },
    // 嫩绿新芽：两枚轻折的春叶小芽烘成 4 个小三角面，轻巧自然
    leafBud: function (cx, cy, cz, dirAngle, size, colorA, colorB) {
      const len = size * 1.45;
      const wid = size * 0.56;
      for (let b = 0; b < 2; b++) {
        const ang = dirAngle + (b === 0 ? -0.48 : 0.52);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const lift = size * (b === 0 ? 0.65 : 0.42);
        const bx = cx + ca * len;
        const by = cy + lift;
        const bz = cz + sa * len;
        const mx = cx + ca * len * 0.48;
        const my = cy + lift * 0.58 + wid * 0.28;
        const mz = cz + sa * len * 0.48;
        const sx = -sa * wid;
        const sz = ca * wid;
        const c = b === 0 ? colorA : colorB;
        const tris = [
          [cx, cy, cz, mx + sx, my - wid * 0.12, mz + sz, bx, by, bz],
          [cx, cy, cz, bx, by, bz, mx - sx, my - wid * 0.12, mz - sz]
        ];
        for (let t = 0; t < tris.length; t++) {
          const tr = tris[t];
          const e1x = tr[3] - tr[0], e1y = tr[4] - tr[1], e1z = tr[5] - tr[2];
          const e2x = tr[6] - tr[0], e2y = tr[7] - tr[1], e2z = tr[8] - tr[2];
          let nx = e1y * e2z - e1z * e2y;
          let ny = e1z * e2x - e1x * e2z;
          let nz = e1x * e2y - e1y * e2x;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          for (let v = 0; v < 3; v++) {
            pos.push(tr[v * 3], tr[v * 3 + 1], tr[v * 3 + 2]);
            nor.push(nx, ny, nz);
            col.push(c.r, c.g, c.b);
          }
        }
      }
    }
  };
}

const _rawIcosa = new THREE.IcosahedronGeometry(1, 0);
const _baseIcosa = _rawIcosa.index ? _rawIcosa.toNonIndexed() : _rawIcosa;
const _rawOcta = new THREE.OctahedronGeometry(1, 0);
const _baseOcta = _rawOcta.index ? _rawOcta.toNonIndexed() : _rawOcta;

// 计算旧版几何的精确 float32 最外层水平顶点 (bestX, bestZ)，以保证外围探索预约半径 100% 逐位一致
function legacyOutermostNear(cfg, seed) {
  const rnd = mulberry32(seed);
  const maxBest = { x: 0, z: 0, r: 0 };
  const record = function (x, z) {
    const fx = Math.fround(x);
    const fz = Math.fround(z);
    const d = Math.hypot(fx, fz);
    if (d > maxBest.r) { maxBest.x = fx; maxBest.z = fz; maxBest.r = d; }
  };
  const h = cfg.heightRange[0] + rnd() * (cfg.heightRange[1] - cfg.heightRange[0]);
  const r0 = cfg.trunkRadius * (1.2 + rnd() * 0.35);
  const leanX = (rnd() - 0.5) * 0.6;
  const leanZ = (rnd() - 0.5) * 0.6;
  const forkX = leanX * 0.75;
  const forkZ = leanZ * 0.75;
  rnd(); rnd();
  const crownW = cfg.canopyRadius * (1.3 + rnd() * 0.45);
  const crownH = crownW * (0.6 + rnd() * 0.18);
  const crownY = h - crownH * 0.55;
  const branches = 3 + ((rnd() * 2) | 0);
  const tips = [];
  for (let b = 0; b < branches; b++) {
    const a = (b / branches) * Math.PI * 2 + rnd() * 0.8;
    const len = crownW * (0.62 + rnd() * 0.3);
    const sx = forkX + Math.cos(a) * 0.06;
    const sz = forkZ + Math.sin(a) * 0.06;
    const sy = h * (0.5 + rnd() * 0.14);
    const ex = sx + Math.cos(a) * len;
    const ez = sz + Math.sin(a) * len;
    const ey = sy + len * (0.5 + rnd() * 0.45);
    rnd();
    tips.push([ex, ey, ez]);
    if (rnd() < 0.65) {
      const a2 = a + (rnd() - 0.5) * 1.4;
      const tx = ex + Math.cos(a2) * len * 0.4;
      const ty = ey + len * 0.26;
      const tz = ez + Math.sin(a2) * len * 0.4;
      rnd();
      tips.push([tx, ty, tz]);
    }
  }
  const clusters = [];
  const n = cfg.nearTree?.clusterCount ?? 12;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.55);
    const px2 = forkX + Math.cos(a) * rr * crownW * 0.92;
    const pz2 = forkZ + Math.sin(a) * rr * crownW * 0.92;
    const py2 = crownY + (rnd() - 0.35) * crownH * (1 - rr * 0.55);
    clusters.push([px2, py2, pz2, crownW * (0.21 + rnd() * 0.10) * (1 - rr * 0.24)]);
  }
  for (let i = 0; i < tips.length; i++) {
    const tp = tips[i];
    clusters.push([tp[0], tp[1] + 0.05, tp[2], crownW * (0.17 + rnd() * 0.07)]);
  }
  const nCfg = cfg.nearTree || {};
  const njr = nCfg.jitter || [0.86, 1.14];
  const scanPuff = function (kind, cx, cz, rx, rz) {
    const p = (kind === 'octa' ? _baseOcta : _baseIcosa).attributes.position.array;
    const cache = new Map();
    for (let i = 0; i < p.length; i += 9) {
      rnd();
      for (let k = 0; k < 3; k++) {
        const o = i + k * 3;
        const key = Math.round(p[o] * 1000) + ',' + Math.round(p[o + 1] * 1000) + ',' + Math.round(p[o + 2] * 1000);
        let j = cache.get(key);
        if (j === undefined) { j = njr[0] + rnd() * (njr[1] - njr[0]); cache.set(key, j); }
        record(cx + p[o] * rx * j, cz + p[o + 2] * rz * j);
      }
    }
  };
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    rnd(); rnd();
    scanPuff(i % 3 === 0 ? 'octa' : 'icosa', c[0], c[2], c[3], c[3]);
  }
  if (cfg.greenLeaves) {
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = 0.5 + rnd() * 0.45;
      rnd(); rnd();
      scanPuff('octa', forkX + Math.cos(a) * rr * crownW, forkZ + Math.sin(a) * rr * crownW, crownW * 0.13, crownW * 0.13);
    }
  }
  void r0;
  return maxBest;
}

function legacyOutermostFar(cfg, farCfg, seed) {
  const rnd = mulberry32(seed);
  const maxBest = { x: 0, z: 0, r: 0 };
  const record = function (x, z) {
    const fx = Math.fround(x);
    const fz = Math.fround(z);
    const d = Math.hypot(fx, fz);
    if (d > maxBest.r) { maxBest.x = fx; maxBest.z = fz; maxBest.r = d; }
  };
  const jr = farCfg.jitter || [0.84, 1.14];
  const scanPuff = function (kind, cx, cz, rx, rz) {
    const p = (kind === 'octa' ? _baseOcta : _baseIcosa).attributes.position.array;
    const cache = new Map();
    for (let i = 0; i < p.length; i += 9) {
      rnd();
      for (let k = 0; k < 3; k++) {
        const o = i + k * 3;
        const key = Math.round(p[o] * 1000) + ',' + Math.round(p[o + 1] * 1000) + ',' + Math.round(p[o + 2] * 1000);
        let j = cache.get(key);
        if (j === undefined) { j = jr[0] + rnd() * (jr[1] - jr[0]); cache.set(key, j); }
        record(cx + p[o] * rx * j, cz + p[o + 2] * rz * j);
      }
    }
  };
  const consumePink = function () { rnd(); rnd(); rnd(); };
  const h = cfg.heightRange[0] + rnd() * (cfg.heightRange[1] - cfg.heightRange[0]);
  const r0 = cfg.trunkRadius * (1.0 + rnd() * 0.3);
  const lean = farCfg.lean ?? 0.9;
  const leanX = (rnd() - 0.5) * lean;
  const leanZ = (rnd() - 0.5) * lean;
  const forkX = leanX * 0.85;
  const forkZ = leanZ * 0.85;
  rnd(); rnd();
  const cs = farCfg.crownScale || [1.1, 1.7];
  const ca = farCfg.crownAspect || [0.55, 0.9];
  const crownW = cfg.canopyRadius * (cs[0] + rnd() * (cs[1] - cs[0]));
  const crownH = crownW * (ca[0] + rnd() * (ca[1] - ca[0]));
  void crownH;
  const tips = [];
  const branchCount = farCfg.branchCount ?? 2;
  for (let b = 0; b < branchCount; b++) {
    const a = (b / branchCount) * Math.PI * 2 + rnd() * 0.9;
    const len = crownW * (0.55 + rnd() * 0.35);
    const sy = h * (0.56 + rnd() * 0.14);
    const ex = forkX + Math.cos(a) * len;
    const ez = forkZ + Math.sin(a) * len;
    const ey = sy + len * (0.36 + rnd() * 0.3);
    rnd();
    tips.push([ex, ey, ez, a]);
  }
  const cr = farCfg.coreRadius ?? 0.78;
  consumePink();
  scanPuff(farCfg.coreDetail || 'icosa', forkX, forkZ, crownW * cr, crownW * cr);
  const sat = farCfg.satelliteClusters ?? 3;
  for (let i = 0; i < sat; i++) {
    const tp = tips[i % tips.length];
    const a = tp[3] + (rnd() - 0.5) * 1.6;
    const rr = 0.55 + rnd() * 0.55;
    const r = crownW * (0.3 + rnd() * 0.18);
    rnd(); rnd();
    consumePink();
    scanPuff(farCfg.satelliteDetail || 'octa', forkX + Math.cos(a) * crownW * rr, forkZ + Math.sin(a) * crownW * rr, r, r);
  }
  const twigs = farCfg.branchTwigs ?? 1;
  for (let i = 0; i < Math.min(twigs, tips.length); i++) {
    const tp = tips[i];
    const r = crownW * (0.2 + rnd() * 0.1);
    consumePink();
    scanPuff('octa', tp[0], tp[2], r, r);
  }
  if (farCfg.leafColor) {
    const gl = farCfg.leafClusters ?? 1;
    for (let i = 0; i < gl; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = 0.5 + rnd() * 0.5;
      const r = crownW * (0.14 + rnd() * 0.08);
      rnd();
      scanPuff('octa', forkX + Math.cos(a) * crownW * rr, forkZ + Math.sin(a) * crownW * rr, r, r);
    }
  }
  void r0;
  return maxBest;
}

// 归一花冠外缘半径：所有顶点水平半径不超过旧版，且最靠近目标方位的共享外缘角点精确对齐 float32 极值
function matchHorizontalExtent(pos, target) {
  if (!(target.r > 0) || !pos.length) return;
  let curMax = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const d = Math.hypot(Math.fround(pos[i]), Math.fround(pos[i + 2]));
    if (d > curMax) curMax = d;
  }
  if (!(curMax > 0)) return;
  const safeRatio = (target.r * 0.9985) / curMax;
  for (let i = 0; i < pos.length; i += 3) {
    const w = Math.max(0, Math.min(1, pos[i + 1] / 0.6));
    const s = 1 + (safeRatio - 1) * w;
    pos[i] = Math.fround(pos[i] * s);
    pos[i + 2] = Math.fround(pos[i + 2] * s);
  }
  let bestDist2 = Infinity;
  let anchorX = 0, anchorY = 0, anchorZ = 0;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 1] < 1.5) continue;
    const dx = pos[i] - target.x;
    const dz = pos[i + 2] - target.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      anchorX = pos[i];
      anchorY = pos[i + 1];
      anchorZ = pos[i + 2];
    }
  }
  if (bestDist2 < Infinity) {
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs(pos[i] - anchorX) < 1e-5 && Math.abs(pos[i + 1] - anchorY) < 1e-5 && Math.abs(pos[i + 2] - anchorZ) < 1e-5) {
        pos[i] = target.x;
        pos[i + 2] = target.z;
      }
    }
  }
}

const _cDeepCarmine = new THREE.Color('#D86A7F');
const _cPeachMain = new THREE.Color('#F09BA8');
const _cBlushTip = new THREE.Color('#FCE4E8');
const _cBudA = new THREE.Color('#7CA659');
const _cBudB = new THREE.Color('#95BC6E');
const _cRootMoss = new THREE.Color('#3F3D2D');
const _cTmp = new THREE.Color();

// 圆润多瓣桃花云团：二十面体底胚 + 三瓣云团轮廓 + 柔和逐面明暗 [0.88, 1.07] + 内深外浅花色层次
function appendBlossomCloud(sink, cx, cy, cz, rx, ry, rz, baseTone, layerBias, rnd, jr, sr) {
  const p = _baseIcosa.attributes.position.array;
  const cache = new Map();
  const phase = rnd() * Math.PI * 2;
  const jMin = Math.max(0.89, jr ? jr[0] : 0.90);
  const jMax = Math.min(1.10, jr ? jr[1] : 1.08);
  const sMin = Math.max(0.88, sr ? sr[0] : 0.88);
  const sMax = Math.min(1.07, sr ? sr[1] : 1.07);

  for (let i = 0; i < p.length; i += 9) {
    const shade = sMin + rnd() * (sMax - sMin);
    const faceY = (p[i + 1] + p[i + 4] + p[i + 7]) / 3;
    const elev = Math.max(-1, Math.min(1, faceY * 0.72 + layerBias * 0.58));
    _cTmp.copy(baseTone);
    if (elev < -0.06) {
      _cTmp.lerp(_cDeepCarmine, Math.min(0.62, (-elev) * 0.68));
    } else {
      _cTmp.lerp(_cPeachMain, 0.22);
      if (elev > 0.16) _cTmp.lerp(_cBlushTip, Math.min(0.66, (elev - 0.16) * 0.78));
    }

    const vx = [0, 0, 0], vy = [0, 0, 0], vz = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const o = i + k * 3;
      const ux = p[o], uy = p[o + 1], uz = p[o + 2];
      const key = Math.round(ux * 1000) + ',' + Math.round(uy * 1000) + ',' + Math.round(uz * 1000);
      let j = cache.get(key);
      if (j === undefined) {
        const ang = Math.atan2(uz, ux);
        const lobe = 1 + 0.095 * Math.sin(ang * 3 + phase) + 0.045 * Math.cos(ang * 2 - phase * 0.7);
        j = (jMin + rnd() * (jMax - jMin)) * lobe;
        cache.set(key, j);
      }
      const domeY = uy < 0 ? uy * 0.78 : uy * 0.94 + 0.04 * (1 - uy * uy);
      vx[k] = cx + ux * rx * j;
      vy[k] = cy + domeY * ry * j;
      vz[k] = cz + uz * rz * j;
    }

    const e1x = vx[1] - vx[0], e1y = vy[1] - vy[0], e1z = vz[1] - vz[0];
    const e2x = vx[2] - vx[0], e2y = vy[2] - vy[0], e2z = vz[2] - vz[0];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    for (let k = 0; k < 3; k++) {
      const vLift = vy[k] > cy ? 1.02 : 0.97;
      sink.pos.push(vx[k], vy[k], vz[k]);
      sink.nor.push(nx, ny, nz);
      sink.col.push(
        Math.min(1, _cTmp.r * shade * vLift),
        Math.min(1, _cTmp.g * shade * vLift),
        Math.min(1, _cTmp.b * shade * vLift)
      );
    }
  }
}

// 一棵近景桃树：三段微弯收分主干、分枝树皮渐变、圆润多瓣桃花云冠与嫩绿春芽
function makeTreeGeometry(cfg, seed, palette) {
  const targetExtent = legacyOutermostNear(cfg, seed);
  const rnd = mulberry32(seed + 17);
  const sink = partSink();
  const cTrunk = new THREE.Color(cfg.trunkColor);
  const cRoot = cTrunk.clone().lerp(_cRootMoss, 0.48);
  const cBark = cTrunk.clone().offsetHSL(0.008, -0.01, 0.08);
  const cTwig = cBark.clone().offsetHSL(0.006, -0.02, 0.05);

  const h = cfg.heightRange[0] + rnd() * (cfg.heightRange[1] - cfg.heightRange[0]);
  const r0 = cfg.trunkRadius * (1.18 + rnd() * 0.30);
  const leanX = (rnd() - 0.5) * 0.58;
  const leanZ = (rnd() - 0.5) * 0.58;
  const bendAngle = rnd() * Math.PI * 2;
  const kneeX = leanX * 0.28 + Math.cos(bendAngle) * 0.09;
  const kneeZ = leanZ * 0.28 + Math.sin(bendAngle) * 0.09;
  const hipX = leanX * 0.56 - Math.cos(bendAngle) * 0.04;
  const hipZ = leanZ * 0.56 - Math.sin(bendAngle) * 0.04;
  const forkX = leanX * 0.78;
  const forkZ = leanZ * 0.78;

  // 三段连续曲干（6→6→5 边形），根部带青苔暗影，往上过渡到暖褐桃木皮
  sink.tube(0, 0, 0, kneeX, h * 0.24, kneeZ, r0 * 1.12, r0 * 0.84, 6, cRoot, cTrunk, rnd() * 2);
  sink.tube(kneeX, h * 0.23, kneeZ, hipX, h * 0.48, hipZ, r0 * 0.84, r0 * 0.64, 6, cTrunk, cBark, rnd() * 2);
  sink.tube(hipX, h * 0.47, hipZ, forkX, h * 0.70, forkZ, r0 * 0.64, r0 * 0.40, 5, cBark, cTwig, rnd() * 2);

  const crownW = cfg.canopyRadius * (1.30 + rnd() * 0.42);
  const crownH = crownW * (0.60 + rnd() * 0.16);
  const crownY = Math.max(h * 0.68, h - crownH * 0.52);

  const branches = 3;
  const tips = [];
  for (let b = 0; b < branches; b++) {
    const a = (b / branches) * Math.PI * 2 + rnd() * 0.75;
    const len = crownW * (0.58 + rnd() * 0.28);
    const sx = forkX + Math.cos(a) * 0.05;
    const sz = forkZ + Math.sin(a) * 0.05;
    const sy = h * (0.54 + rnd() * 0.12);
    const mx = sx + Math.cos(a + 0.14) * len * 0.52;
    const mz = sz + Math.sin(a + 0.14) * len * 0.52;
    const my = sy + len * 0.28;
    const ex = sx + Math.cos(a) * len;
    const ez = sz + Math.sin(a) * len;
    const ey = sy + len * (0.48 + rnd() * 0.36);
    sink.tube(sx, sy, sz, mx, my, mz, r0 * 0.46, r0 * 0.30, 5, cBark, cTwig, rnd() * 2);
    if (b < 2) {
      sink.tube(mx, my - 0.01, mz, ex, ey, ez, r0 * 0.30, r0 * 0.17, 5, cTwig, cTwig, rnd() * 2);
    }
    tips.push([ex, ey, ez, a]);
  }

  const pink = palette.map(function (c) { return new THREE.Color(c); });
  const clusters = [];
  // 中心饱满大云团 + 枝头与冠缘 6 团圆润二十面体花云重叠咬合（零尖钻八面体）
  clusters.push([forkX, crownY + crownH * 0.04, forkZ, crownW * 0.54, 0.15]);
  for (let i = 0; i < tips.length; i++) {
    const tp = tips[i];
    clusters.push([tp[0], Math.max(2.05, tp[1] + 0.08), tp[2], crownW * (0.34 + rnd() * 0.09), i % 2 === 0 ? 0.38 : -0.28]);
  }
  const extra = 3;
  for (let i = 0; i < extra; i++) {
    const a = (i / extra) * Math.PI * 2 + 0.52 + rnd() * 0.65;
    const rr = 0.44 + rnd() * 0.44;
    const px2 = forkX + Math.cos(a) * rr * crownW * 0.88;
    const pz2 = forkZ + Math.sin(a) * rr * crownW * 0.88;
    const py2 = Math.max(2.05, crownY + (rnd() - 0.28) * crownH * 0.68);
    const bias = (py2 - crownY) / Math.max(0.4, crownH) + (i === 0 ? 0.42 : i === 2 ? -0.40 : 0.12);
    clusters.push([px2, py2, pz2, crownW * (0.32 + rnd() * 0.09) * (1 - rr * 0.14), bias]);
  }

  const nCfg = cfg.nearTree || {};
  const njr = nCfg.jitter || [0.90, 1.08];
  const nsr = [0.88, 1.07];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const tone = pink[(rnd() * pink.length) | 0].clone().offsetHSL(0.004, 0.02, 0.03 + (rnd() - 0.5) * 0.03);
    appendBlossomCloud(sink, c[0], c[1], c[2], c[3], c[3] * 0.74, c[3] * 0.96, tone, c[4], rnd, njr, nsr);
  }

  const budA = cfg.greenLeaves ? new THREE.Color(cfg.greenLeaves).lerp(_cBudA, 0.5) : _cBudA;
  for (let i = 0; i < 2; i++) {
    const tp = tips[i % tips.length];
    const ang = tp[3] + (i === 0 ? 0.35 : -0.4);
    sink.leafBud(
      tp[0] + Math.cos(ang) * crownW * 0.10,
      Math.max(2.05, tp[1] - 0.04),
      tp[2] + Math.sin(ang) * crownW * 0.10,
      ang,
      crownW * 0.11,
      budA,
      _cBudB
    );
  }

  matchHorizontalExtent(sink.pos, targetExtent);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sink.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(sink.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(sink.col, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- 远景树：整棵烘成一个几何、多种形态循环用 ----------
// 自然收分 5 边形曲干与分叉枝骨 + 圆润多瓣桃花云团（深绯内衬 / 柔粉主冠 / 浅白花梢 + 嫩绿春芽）
function makeFarTreeGeometry(cfg, farCfg, seed, palette) {
  const targetExtent = legacyOutermostFar(cfg, farCfg, seed);
  const rnd = mulberry32(seed + 29);
  const sink = partSink();
  const cTrunk = new THREE.Color(cfg.trunkColor);
  const cRoot = cTrunk.clone().lerp(_cRootMoss, 0.46);
  const cBark = cTrunk.clone().offsetHSL(0.008, -0.01, 0.08);
  const cTwig = cBark.clone().offsetHSL(0.006, -0.02, 0.05);
  const pinks = palette.map(function (c) { return new THREE.Color(c); });

  const jr = [0.90, 1.08];
  const sr = [0.88, 1.07];
  const pickPink = function (mode) {
    const c = pinks[(rnd() * pinks.length) | 0].clone();
    const lShift = mode < 0 ? -0.04 + (rnd() - 0.5) * 0.03 : mode > 0 ? 0.05 + (rnd() - 0.5) * 0.03 : 0.01 + (rnd() - 0.5) * 0.04;
    c.offsetHSL((rnd() - 0.5) * (farCfg.hueShift ?? 0.02), 0.015, lShift);
    return c;
  };

  const h = cfg.heightRange[0] + rnd() * (cfg.heightRange[1] - cfg.heightRange[0]);
  const r0 = cfg.trunkRadius * (1.02 + rnd() * 0.28);
  const lean = farCfg.lean ?? 0.9;
  const leanX = (rnd() - 0.5) * lean;
  const leanZ = (rnd() - 0.5) * lean;
  const bendAng = rnd() * Math.PI * 2;
  const hipY = h * 0.38;
  const hipX = leanX * 0.42 + Math.cos(bendAng) * 0.08;
  const hipZ = leanZ * 0.42 + Math.sin(bendAng) * 0.08;
  const forkY = h * 0.68;
  const forkX = leanX * 0.82;
  const forkZ = leanZ * 0.82;
  const sides = Math.max(5, farCfg.trunkSides ?? 5);
  const bsides = Math.max(5, farCfg.branchSides ?? 5);

  // 两节自然微弯 5 边形主干（带根部苔影向暖木色过渡）
  sink.tube(0, 0, 0, hipX, hipY, hipZ, r0 * 1.10, r0 * 0.74, sides, cRoot, cTrunk, rnd() * 2);
  sink.tube(hipX, hipY - 0.03, hipZ, forkX, forkY, forkZ, r0 * 0.74, r0 * 0.42, sides, cTrunk, cBark, rnd() * 2);

  const cs = farCfg.crownScale || [1.1, 1.7];
  const ca = farCfg.crownAspect || [0.55, 0.9];
  const crownW = cfg.canopyRadius * (cs[0] + rnd() * (cs[1] - cs[0]));
  const crownH = crownW * (ca[0] + rnd() * (ca[1] - ca[0]));
  const crownY = Math.max(h * 0.68, h - crownH * 0.48);

  // 两至三根有机伸展主枝（5 边形截面，不再是 3 棱细棍）
  const tips = [];
  const branchCount = Math.max(2, farCfg.branchCount ?? 2) + (seed % 2);
  for (let b = 0; b < branchCount; b++) {
    const a = (b / branchCount) * Math.PI * 2 + rnd() * 0.85;
    const len = crownW * (0.50 + rnd() * 0.30);
    const sy = forkY - 0.06 + (b % 2) * 0.10;
    const ex = forkX + Math.cos(a) * len;
    const ez = forkZ + Math.sin(a) * len;
    const ey = sy + len * (0.38 + rnd() * 0.28);
    sink.tube(forkX, sy, forkZ, ex, ey, ez, r0 * 0.40, r0 * 0.19, bsides, cBark, cTwig, rnd() * 2);
    tips.push([ex, ey, ez, a]);
  }

  // 饱满主冠云团 + 3 团圆润多瓣副云团（彻底取代尖锐八面体钻石）
  const coreR = Math.max(0.56, farCfg.coreRadius ?? 0.62);
  appendBlossomCloud(
    sink,
    forkX,
    Math.max(2.05, crownY),
    forkZ,
    crownW * coreR,
    crownH * Math.max(0.78, farCfg.coreFlatten ?? 0.80),
    crownW * coreR * 0.96,
    pickPink(0),
    0.10,
    rnd,
    jr,
    sr
  );

  const sat = 3;
  for (let i = 0; i < sat; i++) {
    const tp = tips[i % tips.length];
    const a = tp[3] + (rnd() - 0.5) * 0.95;
    const rr = 0.78 + rnd() * 0.34;
    const r = crownW * (0.30 + rnd() * 0.10);
    const lift = i === 0 ? 0.46 : i === 1 ? 0.06 : -0.40;
    const py = Math.max(1.98, crownY + lift * crownH + (rnd() - 0.5) * crownH * 0.14);
    const layerBias = i === 0 ? 0.55 : i === 2 ? -0.45 : 0.12;
    appendBlossomCloud(
      sink,
      forkX + Math.cos(a) * crownW * rr,
      py,
      forkZ + Math.sin(a) * crownW * rr,
      r,
      r * (0.70 + rnd() * 0.16),
      r * 0.95,
      pickPink(i === 0 ? 1 : i === 2 ? -1 : 0),
      layerBias,
      rnd,
      jr,
      sr
    );
  }

  // 1–2 簇细嫩春芽轻缀冠下侧，点出「桃花将谢未谢、新叶初生」
  const budBase = farCfg.leafColor ? new THREE.Color(farCfg.leafColor).lerp(_cBudA, 0.45) : _cBudA;
  const budCount = 1 + ((seed & 1) ? 1 : 0);
  for (let i = 0; i < budCount; i++) {
    const tp = tips[(i + 1) % tips.length];
    const ang = tp[3] + 0.4;
    sink.leafBud(
      forkX + Math.cos(ang) * crownW * 0.64,
      Math.max(1.95, crownY - crownH * 0.20 + i * 0.14),
      forkZ + Math.sin(ang) * crownW * 0.64,
      ang,
      crownW * 0.12,
      budBase,
      _cBudB
    );
  }

  matchHorizontalExtent(sink.pos, targetExtent);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sink.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(sink.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(sink.col, 3));
  g.computeVertexNormals();
  return g;
}

// 外溪桃林：按「成林—留白」重排既有远树，不增树、不改近景、不消耗原随机流。
// 近景（出生点、山口、村道）与 landmark 指定的听桃原位固定；每段留白的孤树至少留有 7m 呼吸地。
function layoutGrove(cfg, field, distanceToRiver, curve, spawn, nearFn, spots, far) {
  const opt = typeof cfg.groveLayout === 'object' ? cfg.groveLayout : {};
  const startZ = opt.startZ ?? 64;
  const endZ = opt.endZ ?? 380;
  const period = opt.period ?? 46;
  const gapLen = opt.gap ?? 19;
  const spread = opt.spread ?? 13;
  const minSep = opt.minSeparation ?? 2.2;
  const landmark = opt.landmark || [16, 120]; // 听桃原位：数据未配置时也固定保护
  const half = field.half;
  const spawnClear2 = cfg.spawnClearRadius * cfg.spawnClearRadius;
  const samples = 256;
  const pts = new Array(samples + 1);
  const tans = new Array(samples + 1);
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    pts[i] = curve.getPointAt(u);
    tans[i] = curve.getTangentAt(u);
  }
  const hash01 = (n) => {
    let h = Math.imul(n + 73, 374761393);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const nearestU = (x, z) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i <= samples; i++) {
      const dx = pts[i].x - x;
      const dz = pts[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const nearestZ = (z) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i <= samples; i++) {
      const d = Math.abs(pts[i].z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const sideAt = (i, x, z) => {
    const t = tans[i];
    const nl = Math.hypot(t.x, t.z) || 1;
    return ((x - pts[i].x) * (t.z / nl) + (z - pts[i].z) * (-t.x / nl)) >= 0 ? 1 : -1;
  };

  let landmarkSpot = null;
  let landmarkDist = Infinity;
  if (landmark) {
    for (let i = 0; i < spots.length; i++) {
      const d = Math.hypot(spots[i][0] - landmark[0], spots[i][2] - landmark[1]);
      if (d < landmarkDist) { landmarkDist = d; landmarkSpot = spots[i]; }
    }
  }

  // 只挑外溪留白段中的远树；近树、出生地、山口、村道一律不参与。
  const entries = [];
  const groups = new Map();
  for (let i = 0; i < far.length; i++) {
    const s = far[i];
    if (s === landmarkSpot) continue;
    if (!(s[2] >= startZ && s[2] < endZ)) continue;
    const ui = nearestU(s[0], s[2]);
    const zRel = s[2] - startZ;
    const cell = Math.floor(zRel / period);
    const inCell = zRel - cell * period;
    if (inCell >= gapLen) continue;
    const e = { s: s, i: i, ui: ui, cell: cell, gapZ: startZ + cell * period + gapLen * 0.5, solitary: false };
    entries.push(e);
    const key = cell + ':' + sideAt(ui, s[0], s[2]);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  // 每段留白最多留一棵孤树，位置放在留白中央，四周 7m 不落别的树。
  for (const list of groups.values()) {
    let pick = list[0];
    let best = -1;
    for (const e of list) {
      const h = hash01(e.i * 3891 + e.cell * 131);
      if (h > best) { best = h; pick = e; }
    }
    if (entries.length && best > 0.32) pick.solitary = true;
  }

  const plans = new Map();
  const finalAt = (o) => plans.get(o) || o;
  const fits = (x, z, s, need) => {
    if (Math.abs(x) > half - 8 || Math.abs(z) > half - 8) return false;
    if (!(z >= startZ && z < endZ)) return false;
    if (distanceToRiver(x, z) < cfg.bandInner - 3) return false;
    const dx = x - spawn.x;
    const dz = z - spawn.z;
    if (dx * dx + dz * dz < spawnClear2) return false;
    if (field.slope(x, z) > cfg.slopeLimit) return false;
    if (nearFn && nearFn(x, z)) return false;
    if (landmark && Math.hypot(x - landmark[0], z - landmark[1]) < landmarkDist + 0.05) return false;
    for (let i = 0; i < spots.length; i++) {
      const o = spots[i];
      if (o === s) continue;
      const p = finalAt(o);
      if (Math.hypot(x - p[0], z - p[2]) < need) return false;
    }
    return true;
  };

  // 留白段的树向同侧成林段收拢，林下留出可读的空隙。
  for (const e of entries) {
    if (e.solitary) continue;
    const s = e.s;
    const ui = nearestU(s[0], s[2]);
    const side = sideAt(ui, s[0], s[2]);
    const zi = nearestZ(startZ + e.cell * period + (gapLen + period) * 0.5);
    const p = pts[zi];
    const t = tans[zi];
    const nl = Math.hypot(t.x, t.z) || 1;
    const nx = t.z / nl;
    const nz = -t.x / nl;
    const base = Math.max(cfg.bandInner + 4, Math.min(cfg.bandOuter - 6, distanceToRiver(s[0], s[2])));
    for (let a = 0; a < 26; a++) {
      const h1 = hash01(e.i * 977 + a * 53 + 7);
      const h2 = hash01(e.i * 131 + a * 37 + 19);
      const along = (h1 - 0.5) * 2 * spread;
      const offset = base + (h2 - 0.5) * 10;
      const x = p.x + nx * offset * side + (t.x / nl) * along;
      const z = p.z + nz * offset * side + (t.z / nl) * along;
      if (!fits(x, z, s, minSep)) continue;
      plans.set(s, [x, z]);
      break;
    }
  }
  // 孤树最后落点：与所有最终位置保持 7m，让留白里仍有一两株可驻足的桃。
  for (const e of entries) {
    if (!e.solitary) continue;
    const s = e.s;
    const side = sideAt(nearestU(s[0], s[2]), s[0], s[2]);
    const zi = nearestZ(e.gapZ);
    const p = pts[zi];
    const t = tans[zi];
    const nl = Math.hypot(t.x, t.z) || 1;
    const nx = t.z / nl;
    const nz = -t.x / nl;
    const base = Math.max(cfg.bandInner + 5, Math.min(cfg.bandOuter - 5, distanceToRiver(s[0], s[2])));
    for (let a = 0; a < 22; a++) {
      const h1 = hash01(e.i * 613 + a * 29 + 3);
      const h2 = hash01(e.i * 419 + a * 71 + 11);
      const along = (h1 - 0.5) * 2 * spread * 0.45;
      const offset = base + (h2 - 0.5) * 8;
      const x = p.x + nx * offset * side + (t.x / nl) * along;
      const z = p.z + nz * offset * side + (t.z / nl) * along;
      if (!fits(x, z, s, 7)) continue;
      plans.set(s, [x, z]);
      break;
    }
  }
  for (const [s, t] of plans) {
    s[0] = t[0];
    s[1] = field.sample(t[0], t[1]);
    s[2] = t[1];
  }
}

export function createFlora(cfg, field, distanceToRiver, curve, spawn, nearFn) {
  const rand = mulberry32(20260118);
  const half = field.half;
  const spots = [];
  const clear2 = cfg.spawnClearRadius * cfg.spawnClearRadius;
  const maxTries = cfg.treeCount * 60;

  let tries = 0;
  while (spots.length < cfg.treeCount && tries < maxTries) {
    tries++;
    let px;
    let pz;

    if (rand() < cfg.nearRiverRatio) {
      const t = rand();
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const nl = Math.hypot(tan.x, tan.z) || 1;
      const side = rand() < 0.5 ? -1 : 1;
      const off = cfg.bandInner + rand() * (cfg.bandOuter - cfg.bandInner);
      px = p.x + (tan.z / nl) * off * side;
      pz = p.z - (tan.x / nl) * off * side;
    } else {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * cfg.scatterRadius;
      px = Math.cos(a) * r;
      pz = Math.sin(a) * r;
    }

    if (Math.abs(px) > half - 8 || Math.abs(pz) > half - 8) continue;
    if (distanceToRiver(px, pz) < cfg.bandInner - 3) continue;

    const dx = px - spawn.x;
    const dz = pz - spawn.z;
    if (dx * dx + dz * dz < clear2) continue;
    if (field.slope(px, pz) > cfg.slopeLimit) continue;

    spots.push([px, field.sample(px, pz), pz]);
  }

  const near = [];
  const far = [];
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    if (nearFn && nearFn(s[0], s[2])) near.push(s);
    else far.push(s);
  }
  if (cfg.groveLayout !== false) layoutGrove(cfg, field, distanceToRiver, curve, spawn, nearFn, spots, far);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = cfg.blossomColors;
  const group = new THREE.Group();
  group.name = 'flora';

  // ---- 远景：整树预制几何，多种形态循环用，不再是「直圆柱 + 两团球」----
  const farCfg = cfg.farTree || {};
  const farVariants = farCfg.variants ?? 5;
  const farGeos = [];
  for (let v = 0; v < farVariants; v++) {
    farGeos.push(makeFarTreeGeometry(cfg, farCfg, (farCfg.seed ?? 4409) + v * 191, palette));
  }
  const farBuckets = [];
  for (let v = 0; v < farVariants; v++) farBuckets.push([]);
  for (let i = 0; i < far.length; i++) farBuckets[i % farVariants].push(far[i]);
  // 所有变体共用一份材质，省一次 shader 编译
  const farMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const isc = farCfg.instanceScale || [0.85, 1.2];
  const tint = farCfg.instanceTint ?? 0.08;
  for (let v = 0; v < farVariants; v++) {
    const list = farBuckets[v];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(farGeos[v], farMat, list.length);
    mesh.name = 'tree-far-' + v;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const sc = isc[0] + rand() * (isc[1] - isc[0]);
      dummy.position.set(s[0], s[1] - 0.1, s[2]);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(sc, sc * (0.92 + rand() * 0.2), sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // 逐棵只做极轻的明度扰动，色相层次交给顶点色
      const b2 = 1 + (rand() - 0.5) * tint;
      mesh.setColorAt(i, color.setRGB(b2, b2, b2));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // ---- 近景：带枝干的桃树，三种形态循环用 ----
  const variants = cfg.nearVariants || 3;
  const geos = [];
  for (let v = 0; v < variants; v++) geos.push(makeTreeGeometry(cfg, 7717 + v * 131, palette));
  const buckets = [];
  for (let v = 0; v < variants; v++) buckets.push([]);
  for (let i = 0; i < near.length; i++) buckets[i % variants].push(near[i]);

  for (let v = 0; v < variants; v++) {
    const list = buckets[v];
    if (!list.length) continue;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.InstancedMesh(geos[v], mat, list.length);
    mesh.name = 'tree-near-' + v;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const sc = 0.9 + rand() * 0.3;
      dummy.position.set(s[0], s[1] - 0.08, s[2]);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(sc, sc * (0.95 + rand() * 0.15), sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // 只做明度微调，色相还交给顶点色
      const b = 0.9 + rand() * 0.2;
      mesh.setColorAt(i, color.setRGB(b, b, b));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  return { group: group, count: spots.length, nearCount: near.length, spots: spots, nearSpots: near };
}