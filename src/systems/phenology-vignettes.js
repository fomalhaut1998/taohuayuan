import * as THREE from 'three';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 构建「夏初新荷 / 秋熟残荷」池面立体荷盖、浮水睡莲与菡萏花苞（单 Mesh 顶点色合批）。
 * 所有顶点严格限制在 pondWaterY - 0.38 .. pondWaterY + 0.44 之间，确保涉水锚定且低矮自然。
 */
export function buildSeasonalLotusGeometry(spots, pond, field, rand) {
  const ox = pond.x || 0;
  const oy = pond.waterY || 0;
  const oz = pond.z || 0;
  const pos = [];
  const col = [];
  const summerCols = [];
  const autumnCols = [];
  const cTmpS = new THREE.Color();
  const cTmpA = new THREE.Color();

  function pushTri(a, b, c, hexS, hexA) {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    cTmpS.set(hexS);
    cTmpA.set(hexA);
    for (let k = 0; k < 3; k++) {
      col.push(cTmpS.r, cTmpS.g, cTmpS.b);
      summerCols.push(cTmpS.r, cTmpS.g, cTmpS.b);
      autumnCols.push(cTmpA.r, cTmpA.g, cTmpA.b);
    }
  }

  function pushRod(p0, p1, r0, r1, sides, hexS, hexA) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const refX = Math.abs(uy) < 0.9 ? 1 : 0;
    const refY = Math.abs(uy) < 0.9 ? 0 : 1;
    let qx = -uz * refY;
    let qy = uz * refX;
    let qz = ux * refY - uy * refX;
    const ql = Math.hypot(qx, qy, qz) || 1;
    qx /= ql; qy /= ql; qz /= ql;
    const px = qy * uz - qz * uy;
    const py = qz * ux - qx * uz;
    const pz = qx * uy - qy * ux;

    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * TAU;
      const a1 = ((i + 1) / sides) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const A0 = [p0[0] + (px * c0 + qx * s0) * r0, p0[1] + (py * c0 + qy * s0) * r0, p0[2] + (pz * c0 + qz * s0) * r0];
      const A1 = [p0[0] + (px * c1 + qx * s1) * r0, p0[1] + (py * c1 + qy * s1) * r0, p0[2] + (pz * c1 + qz * s1) * r0];
      const B0 = [p1[0] + (px * c0 + qx * s0) * r1, p1[1] + (py * c0 + qy * s0) * r1, p1[2] + (pz * c0 + qz * s0) * r1];
      const B1 = [p1[0] + (px * c1 + qx * s1) * r1, p1[1] + (py * c1 + qy * s1) * r1, p1[2] + (pz * c1 + qz * s1) * r1];
      pushTri(A0, B0, B1, hexS, hexA);
      pushTri(A0, B1, A1, hexS, hexA);
    }
  }

  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const toCenterX = ox - sp.x;
    const toCenterZ = oz - sp.z;
    const centerDist = Math.hypot(toCenterX, toCenterZ) || 1;
    const ux = toCenterX / centerDist;
    const uz = toCenterZ / centerDist;
    const tx = -uz;
    const tz = ux;
    const inward = centerDist > 2.0 ? (0.16 + rand() * 0.22) : 0;
    const tang = (rand() - 0.5) * 0.42;
    const worldLx = sp.x + ux * inward + tx * tang;
    const worldLz = sp.z + uz * inward + tz * tang;
    const lx = worldLx - ox;
    const lz = worldLz - oz;

    const tier = (Math.floor(i / 3) + i) % 3;
    const stemH = 0.08 + tier * 0.055 + rand() * 0.045;
    const leafR = 0.34 + tier * 0.058 + rand() * 0.035;
    const topY = stemH;
    const tiltX = (rand() - 0.5) * 0.07;
    const tiltZ = (rand() - 0.5) * 0.07;
    const cx = lx + tiltX * 0.5;
    const cz = lz + tiltZ * 0.5;

    const groundY = field?.sample ? field.sample(worldLx, worldLz) : (oy - 0.65);
    const baseY = clamp((Number.isFinite(groundY) ? groundY - oy : -0.65) + 0.03, -0.38, -0.08);

    pushRod([lx, baseY, lz], [lx, 0, lz], 0.021, 0.019, 5, '#416838', '#605938');
    pushRod([lx, 0, lz], [cx, topY, cz], 0.019, 0.014, 5, '#507D42', '#70683E');

    // 微卷杯状碧绿荷盖（10 瓣扇面）
    const segs = 10;
    const leafHexS = i % 2 === 0 ? '#3E7A3E' : '#4E8B48';
    const leafRimS = '#629E56';
    const leafHexA = i % 2 === 0 ? '#7E6C3E' : '#70643C';
    const leafRimA = '#957C48';
    const centerPt = [cx, topY - 0.018, cz];
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * TAU;
      const a1 = ((k + 1) / segs) * TAU;
      const r0 = leafR * (0.94 + 0.08 * Math.sin(k * 2.1 + i));
      const r1 = leafR * (0.94 + 0.08 * Math.sin((k + 1) * 2.1 + i));
      const rim0 = [cx + Math.cos(a0) * r0, topY + 0.026 + Math.sin(k * 1.7) * 0.010, cz + Math.sin(a0) * r0];
      const rim1 = [cx + Math.cos(a1) * r1, topY + 0.026 + Math.sin((k + 1) * 1.7) * 0.010, cz + Math.sin(a1) * r1];
      pushTri(centerPt, rim1, rim0, k % 2 ? leafHexS : leafRimS, k % 2 ? leafHexA : leafRimA);
    }

    // 贴水缺口睡莲浮叶（增加池缘与荷丛间的丰富过渡）
    const padX = lx + (i % 2 === 0 ? 0.34 : -0.32);
    const padZ = lz + (i % 3 === 0 ? -0.26 : 0.28);
    const padR = 0.21 + (i % 3) * 0.035;
    const padCenter = [padX, 0.016, padZ];
    const notchStart = rand() * TAU;
    for (let k = 0; k < 7; k++) {
      const a0 = notchStart + (k / 8) * TAU;
      const a1 = notchStart + ((k + 1) / 8) * TAU;
      const p0 = [padX + Math.cos(a0) * padR, 0.018, padZ + Math.sin(a0) * padR];
      const p1 = [padX + Math.cos(a1) * padR, 0.018, padZ + Math.sin(a1) * padR];
      pushTri(padCenter, p1, p0, k % 2 ? '#4C8446' : '#5D9454', k % 2 ? '#78683C' : '#8A7644');
    }

    // 每丛配一枝盛放荷花/菡萏（秋日化作熟褐莲蓬）
    if (i % 2 === 0 || i % 3 === 1) {
      const fx = lx + (i % 4 === 0 ? -0.17 : 0.18);
      const fz = lz + (tier === 0 ? 0.15 : -0.15);
      const fy = stemH + 0.085 + rand() * 0.055;
      const fGroundY = field?.sample ? field.sample(ox + fx, oz + fz) : (oy - 0.65);
      const fBaseY = clamp((Number.isFinite(fGroundY) ? fGroundY - oy : -0.65) + 0.03, -0.38, -0.08);
      pushRod([fx - 0.02, fBaseY, fz], [fx - 0.01, 0, fz], 0.019, 0.017, 5, '#4A723F', '#605838');
      pushRod([fx - 0.01, 0, fz], [fx, fy, fz], 0.017, 0.013, 5, '#588248', '#70663E');
      const petals = 8;
      for (let layer = 0; layer < 2; layer++) {
        const pr = layer === 0 ? 0.15 : 0.10;
        const ph = layer === 0 ? 0.125 : 0.16;
        const pColS = layer === 0 ? '#E48EA6' : '#F8DCE4';
        const pTipS = '#FBF0F3';
        const pColA = layer === 0 ? '#8C7046' : '#9E8252';
        for (let p = 0; p < petals; p++) {
          const ang = (p / petals) * TAU + layer * 0.39;
          const aL = ang - 0.28;
          const aR = ang + 0.28;
          const base = [fx, fy, fz];
          const midL = [fx + Math.cos(aL) * pr * 0.68, fy + ph * 0.48, fz + Math.sin(aL) * pr * 0.68];
          const midR = [fx + Math.cos(aR) * pr * 0.68, fy + ph * 0.48, fz + Math.sin(aR) * pr * 0.68];
          const tip = [fx + Math.cos(ang) * pr, fy + ph, fz + Math.sin(ang) * pr];
          pushTri(base, midR, midL, pColS, pColA);
          pushTri(midL, midR, tip, pTipS, pColA);
        }
      }
      const podTop = [fx, fy + 0.12, fz];
      for (let p = 0; p < 6; p++) {
        const a0 = (p / 6) * TAU;
        const a1 = ((p + 1) / 6) * TAU;
        pushTri(
          podTop,
          [fx + Math.cos(a1) * 0.055, fy + 0.075, fz + Math.sin(a1) * 0.055],
          [fx + Math.cos(a0) * 0.055, fy + 0.075, fz + Math.sin(a0) * 0.055],
          '#DFC565',
          '#665032'
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return {
    geo,
    summerColors: new Float32Array(summerCols),
    autumnColors: new Float32Array(autumnCols)
  };
}

function segDist2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function makeGeomSink() {
  const pos = [];
  const col = [];
  const cTmp = new THREE.Color();

  function tri(a, b, c, hex) {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    cTmp.set(hex);
    for (let i = 0; i < 3; i++) col.push(cTmp.r, cTmp.g, cTmp.b);
  }

  function quad(a, b, c, d, hex) {
    tri(a, b, c, hex);
    tri(a, c, d, hex);
  }

  function rod(p0, p1, r0, r1, sides, hex) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const refX = Math.abs(uy) < 0.9 ? 0 : 1;
    const refY = Math.abs(uy) < 0.9 ? 1 : 0;
    let qx = -uz * refY;
    let qy = uz * refX;
    let qz = ux * refY - uy * refX;
    const ql = Math.hypot(qx, qy, qz) || 1;
    qx /= ql; qy /= ql; qz /= ql;
    const px = qy * uz - qz * uy;
    const py = qz * ux - qx * uz;
    const pz = qx * uy - qy * ux;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * TAU;
      const a1 = ((i + 1) / sides) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const A0 = [p0[0] + (px * c0 + qx * s0) * r0, p0[1] + (py * c0 + qy * s0) * r0, p0[2] + (pz * c0 + qz * s0) * r0];
      const A1 = [p0[0] + (px * c1 + qx * s1) * r0, p0[1] + (py * c1 + qy * s1) * r0, p0[2] + (pz * c1 + qz * s1) * r0];
      const B0 = [p1[0] + (px * c0 + qx * s0) * r1, p1[1] + (py * c0 + qy * s0) * r1, p1[2] + (pz * c0 + qz * s0) * r1];
      const B1 = [p1[0] + (px * c1 + qx * s1) * r1, p1[1] + (py * c1 + qy * s1) * r1, p1[2] + (pz * c1 + qz * s1) * r1];
      tri(A0, B0, B1, hex);
      tri(A0, B1, A1, hex);
    }
  }

  function puff(cx, cy, cz, rx, ry, rz, hex) {
    const seg = 5;
    const top = [cx, cy + ry, cz];
    const bot = [cx, cy - ry * 0.45, cz];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU;
      const a1 = ((i + 1) / seg) * TAU;
      const p0 = [cx + Math.cos(a0) * rx, cy + ry * 0.15, cz + Math.sin(a0) * rz];
      const p1 = [cx + Math.cos(a1) * rx, cy + ry * 0.15, cz + Math.sin(a1) * rz];
      tri(top, p1, p0, hex);
      tri(bot, p0, p1, hex);
    }
  }

  // 折叶柔瓣（低多边形双三角弧叶，告别圆锥/棱锥块感）
  function leafBlade(p0, angle, len, w, lift, hex) {
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const sx = -dz * w, sz = dx * w;
    const m = [p0[0] + dx * len * 0.52, p0[1] + lift * 0.65, p0[2] + dz * len * 0.52];
    const tip = [p0[0] + dx * len, p0[1] + lift * 0.42, p0[2] + dz * len];
    const l = [m[0] + sx, m[1] - w * 0.12, m[2] + sz];
    const r = [m[0] - sx, m[1] - w * 0.12, m[2] - sz];
    tri(p0, l, tip, hex);
    tri(p0, tip, r, hex);
  }

  // 纤细花梗（单面窄长尖梗，保持纤秀不占面数预算）
  function twig(p0, p1, w, hex) {
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
    const h = Math.hypot(dx, dz) || 1;
    const sx = (-dz / h) * w, sz = (dx / h) * w;
    tri([p0[0] + sx, p0[1], p0[2] + sz], [p0[0] - sx, p0[1], p0[2] - sz], p1, hex);
  }

  // 舒展多瓣低模花朵（4~6 瓣微翘杯状花瓣 + 可选三面花蕊）
  function floret(cx, cy, cz, r, petals, cupH, petalHex, centerHex) {
    const c = [cx, cy, cz];
    const spread = Math.min(0.46, (Math.PI / petals) * 0.68);
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU + cx * 1.7 + cz * 1.3;
      const pL = [cx + Math.cos(a - spread) * r, cy + cupH, cz + Math.sin(a - spread) * r];
      const pR = [cx + Math.cos(a + spread) * r, cy + cupH, cz + Math.sin(a + spread) * r];
      tri(c, pR, pL, petalHex);
    }
    if (centerHex) {
      const cr = r * 0.25;
      const top = [cx, cy + cupH * 0.55 + cr * 0.55, cz];
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * TAU, a1 = ((i + 1) / 3) * TAU;
        tri(top, [cx + Math.cos(a1) * cr, cy + 0.008, cz + Math.sin(a1) * cr], [cx + Math.cos(a0) * cr, cy + 0.008, cz + Math.sin(a0) * cr], centerHex);
      }
    }
  }

  // 五瓣纵棱老南瓜 + 弯曲绿瓜蒂
  function pumpkin(cx, cy, cz, r, h, hexA, hexB) {
    const seg = 10;
    const bot = [cx, cy, cz];
    const top = [cx, cy + h * 0.90, cz];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const rib0 = 0.88 + 0.16 * Math.abs(Math.sin(a0 * 2.5));
      const rib1 = 0.88 + 0.16 * Math.abs(Math.sin(a1 * 2.5));
      const lo0 = [cx + Math.cos(a0) * r * 0.72 * rib0, cy + h * 0.14, cz + Math.sin(a0) * r * 0.72 * rib0];
      const lo1 = [cx + Math.cos(a1) * r * 0.72 * rib1, cy + h * 0.14, cz + Math.sin(a1) * r * 0.72 * rib1];
      const md0 = [cx + Math.cos(a0) * r * rib0, cy + h * 0.52, cz + Math.sin(a0) * r * rib0];
      const md1 = [cx + Math.cos(a1) * r * rib1, cy + h * 0.52, cz + Math.sin(a1) * r * rib1];
      const hi0 = [cx + Math.cos(a0) * r * 0.68 * rib0, cy + h * 0.92, cz + Math.sin(a0) * r * 0.68 * rib0];
      const hi1 = [cx + Math.cos(a1) * r * 0.68 * rib1, cy + h * 0.92, cz + Math.sin(a1) * r * 0.68 * rib1];
      const col = i % 2 === 0 ? hexA : hexB;
      tri(bot, lo0, lo1, hexB);
      quad(lo0, md0, md1, lo1, col);
      quad(md0, hi0, hi1, md1, col);
      tri(top, hi1, hi0, hexA);
    }
    rod([cx, cy + h * 0.86, cz], [cx + 0.03, cy + h * 1.18, cz - 0.02], 0.018, 0.012, 3, '#56743E');
  }

  // 带外翘竹沿的浅敞口晒秋竹匾
  function tray(cx, cy, cz, r, rimH, baseHex, rimHex) {
    const seg = 8;
    const c = [cx, cy + 0.015, cz];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const in0 = [cx + Math.cos(a0) * r * 0.90, cy + 0.015, cz + Math.sin(a0) * r * 0.90];
      const in1 = [cx + Math.cos(a1) * r * 0.90, cy + 0.015, cz + Math.sin(a1) * r * 0.90];
      const out0 = [cx + Math.cos(a0) * r, cy + rimH, cz + Math.sin(a0) * r];
      const out1 = [cx + Math.cos(a1) * r, cy + rimH, cz + Math.sin(a1) * r];
      tri(c, in1, in0, baseHex);
      quad(in0, in1, out1, out0, rimHex);
    }
  }

  function finish(name) {
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.frustumCulled = true;
    return mesh;
  }

  return { tri, quad, rod, puff, leafBlade, twig, floret, pumpkin, tray, finish };
}

/**
 * 构建春/夏/秋三季专属低多边形风物层（每季 1 个静态合批 Mesh，切换时仅改 visible）。
 */
export function buildSeasonalVignettes({ world, field, village }) {
  const blocks = world?.village?.fields?.blocks;
  const houses = village?.houseInfo;
  if (!field?.sample || !Array.isArray(blocks) || !blocks.length || !Array.isArray(houses) || !houses.length) {
    return { springMesh: null, summerMesh: null, autumnMesh: null, dispose() {} };
  }

  const rand = lcg(20261119);
  const waterLevel = world?.terrain?.waterLevel ?? -1;
  const pond = world?.terrain?.pond || { x: 68, z: -152, radius: 13, waterY: 0.85 };
  const roadPts = world?.village?.road?.points || [];
  const roadHalf = (world?.village?.road?.width || 3.6) * 0.5;

  const fieldRects = blocks.map(blk => {
    const bw = blk.cols * blk.plot[0] + (blk.cols - 1) * blk.gap;
    const bd = blk.rows * blk.plot[1] + (blk.rows - 1) * blk.gap;
    return { xMin: blk.x, xMax: blk.x + bw, zMin: blk.z - bd, zMax: blk.z };
  });

  function isSpotSafe(x, z, clearance = 1.0, allowNearPond = false) {
    const y = field.sample(x, z);
    if (!Number.isFinite(y) || y < waterLevel + 0.55) return false;
    if (field.slope && field.slope(x, z) > 0.34) return false;
    const pondDist = Math.hypot(x - pond.x, z - pond.z);
    if (!allowNearPond && pondDist < pond.radius + 1.25) return false;
    if (allowNearPond && y < (pond.waterY ?? 0.85) + 0.03) return false;
    for (let i = 1; i < roadPts.length; i++) {
      if (segDist2D(x, z, roadPts[i - 1][0], roadPts[i - 1][1], roadPts[i][0], roadPts[i][1]) < roadHalf + clearance) {
        return false;
      }
    }
    for (const h of houses) {
      if (Math.hypot(x - h.x, z - h.z) < Math.hypot(h.w, h.d) * 0.5 + clearance + 0.8) return false;
      if (Math.hypot(x - h.doorX, z - h.doorZ) < 2.2) return false;
    }
    for (const r of fieldRects) {
      if (x > r.xMin - 0.35 && x < r.xMax + 0.35 && z > r.zMin - 0.35 && z < r.zMax + 0.35) return false;
    }
    return true;
  }

  // 生成沿田块外缘的候选落点
  const marginSpots = [];
  for (let bi = 0; bi < fieldRects.length; bi++) {
    const r = fieldRects[bi];
    const candidates = [
      [r.xMin - 0.9, r.zMax - 1.5], [r.xMin - 0.9, r.zMin + 1.5],
      [r.xMax + 0.9, r.zMax - 1.5], [r.xMax + 0.9, r.zMin + 1.5],
      [(r.xMin + r.xMax) * 0.5, r.zMax + 0.9], [(r.xMin + r.xMax) * 0.5, r.zMin - 0.9],
      [r.xMin + 2.5, r.zMax + 0.9], [r.xMax - 2.5, r.zMin - 0.9]
    ];
    for (const [cx, cz] of candidates) {
      if (isSpotSafe(cx, cz, 0.85, false)) marginSpots.push([cx, cz]);
    }
  }

  // 生成农家院侧空地候选落点（避开门口通道）
  const yardSpots = [];
  for (let hi = 0; hi < houses.length; hi++) {
    const h = houses[hi];
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    for (const [lx, lz] of [[h.w * 0.62 + 0.85, h.d * 0.28], [-h.w * 0.62 - 0.85, h.d * 0.28], [h.w * 0.55, -h.d * 0.65 - 0.75]]) {
      const wx = h.x + lx * c + lz * s;
      const wz = h.z - lx * s + lz * c;
      if (isSpotSafe(wx, wz, 0.45, false)) yardSpots.push([wx, wz, h.rot]);
    }
  }

  // 1) 春深：田畔分枝金黄芸薹菜花 + 紫云英折叶碎花甸
  const springSink = makeGeomSink();
  for (let i = 0; i < marginSpots.length; i++) {
    const [cx, cz] = marginSpots[i];
    const isCanola = i % 2 === 0;
    const count = isCanola ? 4 : 3;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU + rand() * 0.8;
      const rr = 0.22 + rand() * 0.42;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const y = field.sample(x, z);
      if (isCanola) {
        const h = 0.44 + rand() * 0.22;
        const leanX = (rand() - 0.5) * 0.10;
        const leanZ = (rand() - 0.5) * 0.10;
        const topX = x + leanX, topY = y + h, topZ = z + leanZ;
        // 细长菜苔主茎 + 两片互生折叶 + 两道分枝花序 + 三簇四瓣十字金黄小花
        springSink.rod([x, y - 0.02, z], [topX, topY, topZ], 0.015, 0.008, 3, '#568042');
        springSink.leafBlade([x + leanX * 0.3, y + h * 0.30, z + leanZ * 0.3], a + 0.8, 0.18, 0.055, 0.08, '#5E8A48');
        springSink.leafBlade([x + leanX * 0.55, y + h * 0.52, z + leanZ * 0.55], a - 1.6, 0.15, 0.048, 0.07, '#6C9850');
        const flCol = k % 2 === 0 ? '#E8C542' : '#F2D85C';
        springSink.floret(topX, topY + 0.01, topZ, 0.095, 4, 0.032, flCol, '#C69B2B');
        for (const side of [-1, 1]) {
          const ba = a + side * 1.15;
          const bx = x + leanX * 0.72 + Math.cos(ba) * 0.10;
          const by = y + h * 0.86 + (side > 0 ? 0.02 : -0.02);
          const bz = z + leanZ * 0.72 + Math.sin(ba) * 0.10;
          springSink.twig([x + leanX * 0.68, y + h * 0.70, z + leanZ * 0.68], [bx, by, bz], 0.010, '#628D49');
          springSink.floret(bx, by + 0.008, bz, 0.078, 4, 0.026, side > 0 ? '#F2D85C' : '#E5BE3B', null);
        }
      } else {
        // 紫云英：四叶莲座翠绿小叶 + 两朵微翘粉紫碎花
        for (let l = 0; l < 4; l++) {
          const la = (l / 4) * TAU + k * 0.7;
          springSink.leafBlade([x, y + 0.025, z], la, 0.21, 0.062, 0.06, l % 2 ? '#618E48' : '#729E54');
        }
        for (let b = 0; b < 2; b++) {
          const ba = b * 2.8 + k;
          const fx = x + Math.cos(ba) * 0.085, fz = z + Math.sin(ba) * 0.085;
          const fy = y + 0.11 + (b % 2) * 0.035;
          springSink.twig([x, y + 0.02, z], [fx, fy, fz], 0.010, '#5A8544');
          springSink.floret(fx, fy, fz, 0.074, 5, 0.026, (k + b) % 2 === 0 ? '#CA82B4' : '#E0A2CB', '#F2DCE8');
        }
      }
    }
  }

  // 2) 夏初：院篱杯瓣蜀葵花穗 + 田头弧叶橙金萱草 + 池岸翠菖蒲
  const summerSink = makeGeomSink();
  for (let i = 0; i < Math.min(yardSpots.length, 16); i++) {
    const [wx, wz] = yardSpots[i];
    const y = field.sample(wx, wz);
    const h = 1.15 + rand() * 0.45;
    const bloomHex = i % 3 === 0 ? '#DF6B82' : (i % 3 === 1 ? '#F3C4CE' : '#F6F2E4');
    summerSink.rod([wx, y - 0.02, wz], [wx, y + h, wz], 0.022, 0.010, 3, '#3D7640');
    for (let l = 0; l < 3; l++) {
      summerSink.leafBlade([wx, y + 0.14 + l * 0.12, wz], l * 2.1 + i, 0.24, 0.075, 0.09, '#488248');
    }
    for (let b = 0; b < 4; b++) {
      const by = y + h * (0.44 + b * 0.17);
      const ang = b * 2.1 + i;
      summerSink.floret(wx + Math.cos(ang) * 0.065, by, wz + Math.sin(ang) * 0.065, 0.105 - b * 0.010, 5, 0.045, bloomHex, '#E8CE6B');
    }
  }
  for (let i = 0; i < marginSpots.length; i++) {
    const [cx, cz] = marginSpots[i];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + i * 0.5;
      const x = cx + Math.cos(a) * 0.32;
      const z = cz + Math.sin(a) * 0.32;
      const y = field.sample(x, z);
      summerSink.leafBlade([x, y + 0.02, z], a + 0.4, 0.28, 0.045, 0.14, '#447D44');
      summerSink.leafBlade([x, y + 0.02, z], a - 1.5, 0.24, 0.040, 0.12, '#538E4F');
      summerSink.rod([x, y - 0.02, z], [x + Math.cos(a) * 0.10, y + 0.48, z + Math.sin(a) * 0.10], 0.014, 0.008, 3, '#3F7840');
      summerSink.floret(x + Math.cos(a) * 0.10, y + 0.49, z + Math.sin(a) * 0.10, 0.105, 5, 0.055, k % 2 === 0 ? '#EB852E' : '#F4AA42', '#A84E1E');
    }
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + 0.15;
    const rr = (pond.waterRadius || pond.radius * 0.72) + 1.45;
    const px = pond.x + Math.cos(a) * rr;
    const pz = pond.z + Math.sin(a) * rr;
    const py = field.sample(px, pz);
    if (!isSpotSafe(px, pz, 0.5, true) || py < (pond.waterY ?? 0.85) + 0.04 || py > (pond.waterY ?? 0.85) + 1.2) continue;
    for (let b = 0; b < 3; b++) {
      const lean = (b - 1) * 0.09;
      const bh = 0.52 + b * 0.10;
      summerSink.tri(
        [px - 0.03, py - 0.02, pz],
        [px + 0.03, py - 0.02, pz],
        [px + lean, py + bh, pz + (b % 2 === 0 ? 0.06 : -0.06)],
        b % 2 === 0 ? '#3F7F44' : '#569C56'
      );
    }
  }

  // 3) 秋熟：田头束腰金黄禾垛 + 院前带边晒秋竹匾与纵棱老南瓜 + 篱角多瓣金菊丛
  const autumnSink = makeGeomSink();
  for (let i = 0; i < marginSpots.length; i++) {
    const [cx, cz] = marginSpots[i];
    const y = field.sample(cx, cz);
    if (i % 2 === 0) {
      // 束腰分冠金黄稻粟禾垛
      autumnSink.rod([cx, y - 0.02, cz], [cx, y + 0.44, cz], 0.25, 0.14, 6, '#CFA03B');
      autumnSink.rod([cx, y + 0.42, cz], [cx, y + 0.49, cz], 0.155, 0.155, 6, '#7D5B2E');
      autumnSink.rod([cx, y + 0.48, cz], [cx, y + 0.78, cz], 0.14, 0.24, 6, '#DEB044');
      autumnSink.rod([cx, y + 0.78, cz], [cx, y + 0.94, cz], 0.23, 0.06, 6, '#E8BF52');
    } else {
      // 东篱金菊丛（折叶底簇 + 多瓣金菊）
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + i;
        const x = cx + Math.cos(a) * 0.26;
        const z = cz + Math.sin(a) * 0.26;
        const fy = field.sample(x, z);
        for (let l = 0; l < 3; l++) {
          autumnSink.leafBlade([x, fy + 0.04, z], l * 2.09 + k, 0.19, 0.055, 0.08, '#5E743E');
        }
        autumnSink.rod([x, fy + 0.02, z], [x, fy + 0.24, z], 0.012, 0.008, 3, '#5A703C');
        autumnSink.floret(x, fy + 0.24, z, 0.115, 6, 0.036, k === 0 ? '#EBB834' : (k === 1 ? '#E08232' : '#F4D45C'), '#B06A22');
      }
    }
  }
  for (let i = 0; i < Math.min(yardSpots.length, 10); i++) {
    const [wx, wz] = yardSpots[i];
    const y = field.sample(wx, wz);
    // 敞口浅沿晒秋竹匾：盛满朱红晒柿与金黄粟米，旁依纵棱老南瓜
    autumnSink.tray(wx, y + 0.01, wz, 0.48, 0.085, '#B6945A', '#8D6F3E');
    autumnSink.puff(wx - 0.11, y + 0.075, wz - 0.04, 0.20, 0.06, 0.20, '#D94C2C');
    autumnSink.puff(wx + 0.12, y + 0.075, wz + 0.06, 0.19, 0.055, 0.19, '#EAB838');
    autumnSink.pumpkin(wx + 0.58, y, wz - 0.16, 0.21, 0.24, i % 2 === 0 ? '#DE7D2B' : '#C96226', i % 2 === 0 ? '#C96B22' : '#B5531E');
  }

  const springMesh = springSink.finish('phenology-spring-vignette');
  const summerMesh = summerSink.finish('phenology-summer-vignette');
  const autumnMesh = autumnSink.finish('phenology-autumn-vignette');
  if (springMesh) springMesh.visible = true;
  if (summerMesh) summerMesh.visible = false;
  if (autumnMesh) autumnMesh.visible = false;

  return {
    springMesh,
    summerMesh,
    autumnMesh,
    dispose() {
      for (const m of [springMesh, summerMesh, autumnMesh]) {
        if (!m) continue;
        m.geometry?.dispose?.();
        m.material?.dispose?.();
      }
    }
  };
}
