// 远景两级低面数水墨几何（仅供 static-visibility 远距代理渲染，原几何/碰撞/射线/季节快照零侵入）
import * as THREE from 'three';

function makeBuilder(withTip = false) {
  const pos = [];
  const nor = [];
  const col = [];
  const role = []; // 0 = stem/trunk, 1 = canopy side/under, 2 = canopy top (snow-catching)
  const tips = withTip ? [] : null;
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _e1 = new THREE.Vector3();
  const _e2 = new THREE.Vector3();
  const _n = new THREE.Vector3();

  function tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b, roleId, tipA = 0, tipB = 0, tipC = 0) {
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
    if (tips) tips.push(tipA, tipB, tipC);
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

  function addBladeWedge(ox, y0, oz, yaw, lean, h, w, cMid) {
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const px = -dz, pz = dx;
    const mx = ox + dx * lean * 0.48;
    const my = y0 + h * 0.56;
    const mz = oz + dz * lean * 0.48;
    const tx = ox + dx * lean;
    const ty = y0 + h;
    const tz = oz + dz * lean;
    const lx = mx + px * w, lz = mz + pz * w;
    const rx = mx - px * w, rz = mz - pz * w;
    tri(ox, y0, oz, rx, my, rz, lx, my, lz, cMid.r, cMid.g, cMid.b, 0);
    tri(lx, my, lz, rx, my, rz, tx, ty, tz, cMid.r, cMid.g, cMid.b, 2, 0, 0, 1);
  }

  function build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (tips) geo.setAttribute('aTip', new THREE.Float32BufferAttribute(tips, 1));
    geo.userData.lodRoles = new Uint8Array(role);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  return { addPrism, addLeafBlade, addCanopyPad, addBladeWedge, build };
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

/**
 * Hillside blossom tree far LOD (44 tris vs 228 tris source = -80.7% tris).
 * Fits local bounds [-1.56..1.61, -0.13..3.64, -1.10..1.19].
 */
export function createFarBlossomTreeGeometry(source) {
  const b = makeBuilder();
  const cTrunk = new THREE.Color('#664C3B');
  const cTop = new THREE.Color('#F2B8C8');
  const cSide = new THREE.Color('#D47E96');
  b.addPrism(0, -0.13, 0, 0.20, 0.04, 2.15, 0.02, 0.09, 4, cTrunk, 0);
  b.addCanopyPad(-0.02, 2.52, 0.02, 1.42, 0.72, 1.02, 6, cTop, cSide);
  b.addCanopyPad(0.62, 3.06, -0.18, 0.92, 0.56, 0.78, 6, cTop, cSide);
  b.addCanopyPad(-0.66, 2.22, 0.24, 0.86, 0.46, 0.74, 6, cTop, cSide);
  const geo = b.build();
  if (source) syncLodVertexColors(source, geo, 1.75);
  return geo;
}

/**
 * Hillside red maple far LOD (44 tris vs 164 tris source = -73.2% tris).
 * Fits local bounds [-1.39..1.45, -0.15..3.53, -1.03..1.09].
 */
export function createFarMapleGeometry(source) {
  const b = makeBuilder();
  const cTrunk = new THREE.Color('#5A4335');
  const cTop = new THREE.Color('#CE563E');
  const cSide = new THREE.Color('#9E3B2B');
  b.addPrism(0, -0.15, 0, 0.19, -0.06, 2.02, 0.04, 0.08, 4, cTrunk, 0);
  b.addCanopyPad(0.10, 2.18, -0.04, 1.28, 0.48, 0.96, 6, cTop, cSide);
  b.addCanopyPad(-0.24, 2.68, 0.10, 1.08, 0.46, 0.84, 6, cTop, cSide);
  b.addCanopyPad(0.18, 3.12, -0.06, 0.84, 0.40, 0.68, 6, cTop, cSide);
  const geo = b.build();
  if (source) syncLodVertexColors(source, geo, 1.75);
  return geo;
}

/**
 * Hillside crag boulder far LOD (36 tris vs 147 tris source = -75.5% tris).
 * Fits local bounds [-1.22..0.95, -0.38..1.16, -0.82..0.86].
 */
export function createFarCragGeometry(source) {
  const b = makeBuilder();
  const cTop = new THREE.Color('#7F877D');
  const cSide = new THREE.Color('#5F675E');
  b.addPrism(-0.12, -0.36, 0.02, 0.92, -0.12, 0.18, 0.02, 0.84, 6, cSide, 1);
  b.addCanopyPad(-0.18, 0.34, 0.02, 0.96, 0.80, 0.76, 6, cTop, cSide);
  b.addCanopyPad(0.38, 0.14, 0.14, 0.55, 0.46, 0.54, 6, cTop, cSide);
  const geo = b.build();
  if (source) syncLodVertexColors(source, geo, 0.25);
  return geo;
}

/**
 * Tea shrub cushion far LOD (24 tris vs 88 tris source = -72.7% tris).
 * Fits local bounds [-0.55..0.59, -0.08..0.67, -0.47..0.48].
 */
export function createFarShrubGeometry(source) {
  const b = makeBuilder();
  const cTop = new THREE.Color('#6A904C');
  const cSide = new THREE.Color('#4B6C37');
  b.addCanopyPad(0.04, 0.24, 0.0, 0.52, 0.42, 0.44, 6, cTop, cSide);
  b.addCanopyPad(-0.14, 0.20, 0.06, 0.38, 0.30, 0.34, 6, cTop, cSide);
  const geo = b.build();
  if (source) syncLodVertexColors(source, geo, 0.05);
  return geo;
}

function sourceBounds(source, fallbackMin, fallbackMax) {
  const g = source?.geometry;
  if (g) {
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox) return { min: g.boundingBox.min, max: g.boundingBox.max };
  }
  return {
    min: new THREE.Vector3(fallbackMin[0], fallbackMin[1], fallbackMin[2]),
    max: new THREE.Vector3(fallbackMax[0], fallbackMax[1], fallbackMax[2])
  };
}

/**
 * Far peach tree LOD (44 tris vs 124-138 tris source = ~-67% tris),
 * fitted dynamically to each variant's exact bounding box.
 */
export function createFarPeachTreeGeometry(source) {
  const b = makeBuilder();
  const cTrunk = new THREE.Color('#694E3C');
  const cTop = new THREE.Color('#F3BAC8');
  const cSide = new THREE.Color('#D57B96');
  const { min, max } = sourceBounds(source, [-2.1, 0, -1.8], [2.3, 5.4, 1.6]);
  const w = Math.max(1.2, max.x - min.x);
  const d = Math.max(1.2, max.z - min.z);
  const h = Math.max(2.0, max.y - min.y);
  const cx = (min.x + max.x) * 0.5;
  const cz = (min.z + max.z) * 0.5;
  const splitY = min.y + h * 0.42;
  b.addPrism(0, min.y, 0, 0.19, cx * 0.55, min.y + h * 0.54, cz * 0.55, 0.09, 4, cTrunk, 0);
  const ryMain = Math.max(0.45, h * 0.30);
  b.addCanopyPad(cx * 0.75, min.y + h * 0.68, cz * 0.75, Math.max(0.7, w * 0.42), ryMain, Math.max(0.6, d * 0.42), 6, cTop, cSide);
  b.addCanopyPad(cx * 0.25 + w * 0.14, min.y + h * 0.74, cz * 0.35 - d * 0.10, Math.max(0.55, w * 0.32), ryMain * 0.84, Math.max(0.5, d * 0.32), 6, cTop, cSide);
  b.addCanopyPad(cx * 0.35 - w * 0.16, min.y + h * 0.60, cz * 0.55 + d * 0.14, Math.max(0.50, w * 0.28), ryMain * 0.72, Math.max(0.45, d * 0.28), 6, cTop, cSide);
  const geo = b.build();
  geo.userData.splitY = splitY;
  if (source) syncLodVertexColors(source, geo, splitY);
  return geo;
}

/**
 * Far grass tuft LOD (blades*2 tris vs 15-25 tris source), preserving `aTip`
 * so flower-tip materials render wildflower flecks identically.
 */
export function createFarGrassGeometry(source, blades = 3) {
  const count = Math.max(2, Math.floor(blades));
  const b = makeBuilder(true);
  const cGrass = new THREE.Color('#6F8F4A');
  const { min, max } = sourceBounds(source, [-0.45, -0.01, -0.45], [0.55, 0.85, 0.50]);
  const h = Math.max(0.35, max.y - min.y);
  const rad = Math.max(0.22, Math.min(max.x - min.x, max.z - min.z) * 0.38);
  const cx = (min.x + max.x) * 0.35;
  const cz = (min.z + max.z) * 0.35;
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + 0.35;
    const ox = cx + Math.cos(yaw) * rad * 0.22;
    const oz = cz + Math.sin(yaw) * rad * 0.22;
    b.addBladeWedge(ox, min.y, oz, yaw, rad * 0.88, h * (0.86 + (i % 2) * 0.11), 0.098, cGrass);
  }
  const geo = b.build();
  if (source) syncLodVertexColors(source, geo, 0.18);
  return geo;
}

/**
 * Far millet clump LOD (10 tris vs 31 tris source = -67.7% tris).
 * Fits local bounds [-0.23..0.22, 0..0.73, -0.26..0.20].
 */
export function createFarMilletGeometry(source) {
  const b = makeBuilder();
  const cMillet = new THREE.Color('#A2AF5A');
  const { min, max } = sourceBounds(source, [-0.22, 0, -0.24], [0.21, 0.72, 0.19]);
  const h = Math.max(0.4, max.y - min.y);
  const cx = (min.x + max.x) * 0.5;
  const cz = (min.z + max.z) * 0.5;
  for (let i = 0; i < 5; i++) {
    const yaw = (i / 5) * Math.PI * 2 + 0.2;
    b.addBladeWedge(cx + Math.cos(yaw) * 0.04, min.y, cz + Math.sin(yaw) * 0.04, yaw, 0.17, h * (0.86 + (i % 2) * 0.12), 0.056, cMillet);
  }
  const geo = b.build();
  if (source) syncLodVertexColors(source, geo, 0.30);
  return geo;
}
