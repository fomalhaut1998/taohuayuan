// 远景两级低面数水墨几何（仅供 static-visibility 远距代理渲染，原几何/碰撞/射线/季节快照零侵入）
import * as THREE from 'three';

function makeBuilder() {
  const pos = [];
  const nor = [];
  const col = [];
  const role = []; // 0 = stem/trunk, 1 = canopy side/under, 2 = canopy top (snow-catching)
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _e1 = new THREE.Vector3();
  const _e2 = new THREE.Vector3();
  const _n = new THREE.Vector3();

  function tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b, roleId) {
    _a.set(ax, ay, az);
    _b.set(bx, by, bz);
    _c.set(cx, cy, cz);
    _e1.subVectors(_b, _a);
    _e2.subVectors(_c, _a);
    _n.crossVectors(_e1, _e2);
    if (_n.lengthSq() > 1e-10) _n.normalize();
    else _n.set(0, 1, 0);
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    nor.push(_n.x, _n.y, _n.z, _n.x, _n.y, _n.z, _n.x, _n.y, _n.z);
    col.push(r, g, b, r, g, b, r, g, b);
    role.push(roleId, roleId, roleId);
  }

  function addPrism(x0, y0, z0, r0, x1, y1, z1, r1, sides, c, roleId) {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p0x = x0 + c0 * r0, p0z = z0 + s0 * r0;
      const p1x = x0 + c1 * r0, p1z = z0 + s1 * r0;
      const q0x = x1 + c0 * r1, q0z = z1 + s0 * r1;
      const q1x = x1 + c1 * r1, q1z = z1 + s1 * r1;
      tri(p0x, y0, p0z, p1x, y0, p1z, q1x, y1, q1z, c.r, c.g, c.b, roleId);
      tri(p0x, y0, p0z, q1x, y1, q1z, q0x, y1, q0z, c.r, c.g, c.b, roleId);
    }
  }

  function addLeafBlade(ox, oy, oz, yaw, len, w, droop, c, roleId) {
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const px = -dz, pz = dx;
    const mx = ox + dx * len * 0.48;
    const my = oy + len * 0.10;
    const mz = oz + dz * len * 0.48;
    const tx = ox + dx * len;
    const ty = oy - droop;
    const tz = oz + dz * len;
    const lx = mx + px * w, lz = mz + pz * w;
    const rx = mx - px * w, rz = mz - pz * w;
    tri(ox, oy, oz, lx, my, lz, tx, ty, tz, c.r, c.g, c.b, roleId);
    tri(ox, oy, oz, tx, ty, tz, rx, my, rz, c.r, c.g, c.b, roleId);
  }

  function addCanopyPad(cx, cy, cz, rx, ry, rz, sides, cTop, cSide) {
    const topY = cy + ry;
    const botY = cy - ry * 0.45;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * rx, z0 = cz + Math.sin(a0) * rz;
      const x1 = cx + Math.cos(a1) * rx, z1 = cz + Math.sin(a1) * rz;
      // Top cap catches winter snow & overhead sunlight
      tri(cx, topY, cz, x1, cy, z1, x0, cy, z0, cTop.r, cTop.g, cTop.b, 2);
      // Tapered underside creates layered ink silhouette
      tri(cx, botY, cz, x0, cy, z0, x1, cy, z1, cSide.r, cSide.g, cSide.b, 1);
    }
  }

  function build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.userData.lodRoles = new Uint8Array(role);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  return { addPrism, addLeafBlade, addCanopyPad, build };
}

/**
 * Syncs far LOD vertex colors from source geometry vertex colors whenever
 * phenology switches seasons (Spring / Summer / Autumn / Winter).
 * Runs only when source.geometry.attributes.color.version changes (0 per-frame cost).
 */
export function syncLodVertexColors(source, lodGeo, splitY = 2.0) {
  const sPos = source?.geometry?.attributes?.position;
  const sCol = source?.geometry?.attributes?.color;
  const sNor = source?.geometry?.attributes?.normal;
  const dCol = lodGeo?.attributes?.color;
  const roles = lodGeo?.userData?.lodRoles;
  if (!sPos || !sCol || !dCol || !roles) return;

  let stR = 0, stG = 0, stB = 0, stN = 0;
  let caR = 0, caG = 0, caB = 0, caN = 0;
  let tpR = 0, tpG = 0, tpB = 0, tpN = 0;
  const step = Math.max(1, Math.floor(sPos.count / 600));
  for (let i = 0; i < sPos.count; i += step) {
    const y = sPos.getY(i);
    const r = sCol.getX(i), g = sCol.getY(i), b = sCol.getZ(i);
    const ny = sNor ? sNor.getY(i) : 0;
    if (y < splitY) {
      stR += r; stG += g; stB += b; stN++;
    } else if (ny > 0.22) {
      tpR += r; tpG += g; tpB += b; tpN++;
    } else {
      caR += r; caG += g; caB += b; caN++;
    }
  }
  if (stN > 0) { stR /= stN; stG /= stN; stB /= stN; }
  if (caN > 0) { caR /= caN; caG /= caN; caB /= caN; }
  else if (tpN > 0) { caR = tpR / tpN; caG = tpG / tpN; caB = tpB / tpN; }
  if (tpN > 0) { tpR /= tpN; tpG /= tpN; tpB /= tpN; }
  else { tpR = caR; tpG = caG; tpB = caB; }
  if (stN === 0) { stR = caR * 0.85; stG = caG * 0.85; stB = caB * 0.85; }

  const dst = dCol.array;
  for (let i = 0; i < roles.length; i++) {
    const k = i * 3;
    const rId = roles[i];
    if (rId === 0) {
      dst[k] = stR; dst[k + 1] = stG; dst[k + 2] = stB;
    } else if (rId === 2) {
      dst[k] = tpR; dst[k + 1] = tpG; dst[k + 2] = tpB;
    } else {
      dst[k] = caR; dst[k + 1] = caG; dst[k + 2] = caB;
    }
  }
  dCol.needsUpdate = true;
}

/**
 * Village bamboo far LOD (~132 tris vs 1,104 tris source = -88% tris).
 * Matches local bounds [-1.22..1.21, 0..6.03, -1.16..1.16].
 */
export function createFarBambooGeometry(source) {
  const b = makeBuilder();
  const cStem = new THREE.Color('#7C9A54');
  const cLeaf = new THREE.Color('#5E7C3E');
  const cLeafTop = new THREE.Color('#6D8C49');
  const culms = [
    { x: -0.46, z: -0.34, lx: -0.26, lz: -0.18, h: 5.55 },
    { x:  0.42, z: -0.28, lx:  0.28, lz: -0.20, h: 5.25 },
    { x:  0.04, z:  0.02, lx:  0.08, lz:  0.10, h: 5.95 },
    { x: -0.32, z:  0.44, lx: -0.22, lz:  0.28, h: 4.85 },
    { x:  0.38, z:  0.36, lx:  0.22, lz:  0.24, h: 5.10 }
  ];
  for (let i = 0; i < culms.length; i++) {
    const c = culms[i];
    const mx = c.x + c.lx * 0.42, my = c.h * 0.52, mz = c.z + c.lz * 0.42;
    const tx = c.x + c.lx, ty = c.h, tz = c.z + c.lz;
    b.addPrism(c.x, 0, c.z, 0.052, mx, my, mz, 0.038, 3, cStem, 0);
    b.addPrism(mx, my, mz, 0.038, tx, ty, tz, 0.020, 3, cStem, 0);
    // 3 fan sprays near crown + mid-upper nodes
    for (let j = 0; j < 3; j++) {
      const ang = i * 1.28 + j * 2.09;
      const frac = j === 0 ? 0.96 : (j === 1 ? 0.78 : 0.62);
      const bx = c.x + c.lx * frac;
      const by = c.h * frac;
      const bz = c.z + c.lz * frac;
      b.addLeafBlade(bx, by, bz, ang, 0.78 + (j % 2) * 0.16, 0.24, 0.26 + j * 0.06, j === 0 ? cLeafTop : cLeaf, j === 0 ? 2 : 1);
    }
  }
  const geo = b.build();
  if (source) syncLodVertexColors(source, geo, 2.3);
  return geo;
}

/**
 * Hillside pine far LOD (~52 tris vs 246 tris source = -79% tris).
 * Matches local bounds [-1.55..2.25, -0.18..3.88, -1.13..1.25].
 */
export function createFarPineGeometry(source) {
  const b = makeBuilder();
  const cBark = new THREE.Color('#564434');
  const cTop = new THREE.Color('#4A6E52');
  const cSide = new THREE.Color('#35523D');
  b.addPrism(-0.08, -0.18, 0.0, 0.22, 0.16, 2.55, 0.02, 0.11, 4, cBark, 0);
  // Two asymmetric Song-Yuan tabular pine bough pads
  b.addCanopyPad(0.55, 2.42, 0.06, 1.55, 0.42, 1.05, 6, cTop, cSide);
  b.addCanopyPad(-0.22, 3.28, -0.04, 1.24, 0.56, 0.98, 6, cTop, cSide);
  const geo = b.build();
  if (source) syncLodVertexColors(source, geo, 1.85);
  return geo;
}

/**
 * Hillside bamboo far LOD (~66 tris vs 267 tris source = -75% tris).
 * Matches local bounds [-1.24..1.15, -0.10..4.71, -1.18..1.09].
 */
export function createFarHillBambooGeometry(source) {
  const b = makeBuilder();
  const cStem = new THREE.Color('#6F8C4E');
  const cLeaf = new THREE.Color('#527442');
  const cLeafTop = new THREE.Color('#628450');
  const culms = [
    { x: -0.34, z: -0.26, lx: -0.18, lz: -0.16, h: 4.50 },
    { x:  0.32, z: -0.20, lx:  0.22, lz: -0.14, h: 4.25 },
    { x:  0.02, z:  0.18, lx:  0.06, lz:  0.18, h: 4.65 },
    { x: -0.26, z:  0.34, lx: -0.18, lz:  0.22, h: 3.95 }
  ];
  for (let i = 0; i < culms.length; i++) {
    const c = culms[i];
    b.addPrism(c.x, -0.10, c.z, 0.048, c.x + c.lx, c.h, c.z + c.lz, 0.020, 3, cStem, 0);
    for (let j = 0; j < 2; j++) {
      const ang = i * 1.55 + j * 2.8;
      const frac = j === 0 ? 0.94 : 0.72;
      b.addLeafBlade(
        c.x + c.lx * frac, c.h * frac, c.z + c.lz * frac,
        ang, 0.74, 0.24, 0.24,
        j === 0 ? cLeafTop : cLeaf,
        j === 0 ? 2 : 1
      );
    }
  }
  const geo = b.build();
  if (source) syncLodVertexColors(source, geo, 1.8);
  return geo;
}
