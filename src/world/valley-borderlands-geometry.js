import * as THREE from 'three';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hash01(seed) {
  let s = (Math.imul(seed | 0, 1664525) + 1013904223) >>> 0;
  s ^= s >>> 15;
  s = Math.imul(s, 2246822519) >>> 0;
  return (s >>> 0) / 4294967296;
}

export function createVertexColorBaker() {
  const buckets = new Map();
  const tmpCol = new THREE.Color();
  const tmpColB = new THREE.Color();
  const tmpV0 = new THREE.Vector3();
  const tmpV1 = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpE1 = new THREE.Vector3();
  const tmpE2 = new THREE.Vector3();
  const tmpN = new THREE.Vector3();

  function getBucket(key) {
    let b = buckets.get(key);
    if (!b) {
      b = { pos: [], nor: [], col: [], tags: [] };
      buckets.set(key, b);
    }
    return b;
  }

  function withTag(tag, fn) {
    const starts = new Map();
    for (const [k, b] of buckets.entries()) {
      starts.set(k, b.col.length / 3);
    }
    fn();
    for (const [k, b] of buckets.entries()) {
      const start = starts.has(k) ? starts.get(k) : 0;
      const end = b.col.length / 3;
      if (end > start) {
        b.tags.push({ tag, start, end });
      }
    }
  }

  function addTri(key, ax, ay, az, bx, by, bz, cx, cy, cz, hexOrColor, shadeBias = 0) {
    const b = getBucket(key);
    tmpV0.set(ax, ay, az);
    tmpV1.set(bx, by, bz);
    tmpV2.set(cx, cy, cz);
    tmpE1.subVectors(tmpV1, tmpV0);
    tmpE2.subVectors(tmpV2, tmpV0);
    tmpN.crossVectors(tmpE1, tmpE2);
    const len = tmpN.length();
    if (len < 1e-8) return;
    tmpN.multiplyScalar(1 / len);

    if (typeof hexOrColor === 'string' || typeof hexOrColor === 'number') {
      tmpCol.set(hexOrColor);
    } else {
      tmpCol.copy(hexOrColor);
    }
    const shade = clamp(0.92 + 0.12 * Math.max(0, tmpN.y) - 0.05 * Math.max(0, -tmpN.y) + shadeBias, 0.58, 1.12);
    const cr = clamp(tmpCol.r * shade, 0.032, 1);
    const cg = clamp(tmpCol.g * shade, 0.032, 1);
    const cb = clamp(tmpCol.b * shade, 0.032, 1);

    b.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    b.nor.push(tmpN.x, tmpN.y, tmpN.z, tmpN.x, tmpN.y, tmpN.z, tmpN.x, tmpN.y, tmpN.z);
    b.col.push(cr, cg, cb, cr, cg, cb, cr, cg, cb);
  }

  function addQuad(key, p0, p1, p2, p3, hexOrColor, shadeBias = 0) {
    addTri(key, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], hexOrColor, shadeBias);
    addTri(key, p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], hexOrColor, shadeBias);
  }

  function addGeo(key, geo, hexTop, hexBot = null, matrix = null) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    g.computeBoundingBox();
    const minY = g.boundingBox ? g.boundingBox.min.y : 0;
    const spanY = Math.max(1e-4, (g.boundingBox ? g.boundingBox.max.y : 1) - minY);
    const cTop = new THREE.Color(hexTop);
    const cBot = new THREE.Color(hexBot || hexTop);
    const cMix = new THREE.Color();
    const pos = g.attributes.position;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const ay = pos.getY(i), by = pos.getY(i + 1), cy = pos.getY(i + 2);
      const t = clamp(((ay + by + cy) / 3 - minY) / spanY, 0, 1);
      cMix.copy(cBot).lerp(cTop, t);
      addTri(
        key,
        pos.getX(i), ay, pos.getZ(i),
        pos.getX(i + 1), by, pos.getZ(i + 1),
        pos.getX(i + 2), cy, pos.getZ(i + 2),
        cMix
      );
    }
    g.dispose();
  }

  function addBox(key, cx, cy, cz, sx, sy, sz, yaw, hexTop, hexBot = null) {
    const box = new THREE.BoxGeometry(sx, sy, sz);
    const m = new THREE.Matrix4().makeRotationY(yaw || 0).setPosition(cx, cy, cz);
    addGeo(key, box, hexTop, hexBot || hexTop, m);
    box.dispose();
  }

  function addTiltedBox(key, cx, cy, cz, sx, sy, sz, rx, ry, rz, hexTop, hexBot = null) {
    const box = new THREE.BoxGeometry(sx, sy, sz);
    const e = new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ');
    const m = new THREE.Matrix4().makeRotationFromEuler(e).setPosition(cx, cy, cz);
    addGeo(key, box, hexTop, hexBot || hexTop, m);
    box.dispose();
  }

  function addCylinder(key, cx, cy, cz, rTop, rBot, h, segs, yaw, hexTop, hexBot = null) {
    const cyl = new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, false);
    const m = new THREE.Matrix4().makeRotationY(yaw || 0).setPosition(cx, cy, cz);
    addGeo(key, cyl, hexTop, hexBot || hexTop, m);
    cyl.dispose();
  }

  function addCone(key, cx, cy, cz, radius, h, segs, yaw, hexTop, hexBot = null) {
    const cone = new THREE.ConeGeometry(radius, h, segs, 1, false);
    const m = new THREE.Matrix4().makeRotationY(yaw || 0).setPosition(cx, cy, cz);
    addGeo(key, cone, hexTop, hexBot || hexTop, m);
    cone.dispose();
  }

  /**
   * Oriented 3D tapered beam / branch / rafter / bamboo culm between arbitrary points p0 -> p1.
   */
  function addBeam(key, p0, p1, r0, r1 = r0, segs = 6, hex0 = '#785F40', hex1 = null, capEnds = true) {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    const ax = dx / len, ay = dy / len, az = dz / len;
    const upX = Math.abs(ay) < 0.92 ? 0 : 1;
    const upY = Math.abs(ay) < 0.92 ? 1 : 0;
    let ux = ay * 0 - az * upY;
    let uy = az * upX - ax * 0;
    let uz = ax * upY - ay * upX;
    const uLen = Math.hypot(ux, uy, uz) || 1;
    ux /= uLen; uy /= uLen; uz /= uLen;
    const vx = ay * uz - az * uy;
    const vy = az * ux - ax * uz;
    const vz = ax * uy - ay * ux;

    const c0 = new THREE.Color(hex0);
    const c1 = new THREE.Color(hex1 || hex0);
    tmpColB.copy(c0).lerp(c1, 0.5);

    const ring0 = [];
    const ring1 = [];
    const n = Math.max(3, segs | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = ux * ca + vx * sa;
      const ny = uy * ca + vy * sa;
      const nz = uz * ca + vz * sa;
      ring0.push([p0[0] + nx * r0, p0[1] + ny * r0, p0[2] + nz * r0]);
      ring1.push([p1[0] + nx * r1, p1[1] + ny * r1, p1[2] + nz * r1]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      addQuad(key, ring0[i], ring0[j], ring1[j], ring1[i], i % 2 === 0 ? c1 : c0);
      if (capEnds) {
        if (r0 > 0.015) addTri(key, p0[0], p0[1], p0[2], ring0[j][0], ring0[j][1], ring0[j][2], ring0[i][0], ring0[i][1], ring0[i][2], c0);
        if (r1 > 0.015) addTri(key, p1[0], p1[1], p1[2], ring1[i][0], ring1[i][1], ring1[i][2], ring1[j][0], ring1[j][1], ring1[j][2], c1);
      }
    }
  }

  /**
   * Raised 3D ring / woven tray rim / hollowed stone basin wall.
   */
  function addHollowCylinder(key, cx, cy, cz, rOuter, rInner, h, segs = 8, yaw = 0, hexTop = '#BEA870', hexSide = null) {
    const sideCol = hexSide || hexTop;
    const n = Math.max(4, segs | 0);
    const y0 = cy - h * 0.5;
    const y1 = cy + h * 0.5;
    for (let i = 0; i < n; i++) {
      const a0 = yaw + (i / n) * TAU;
      const a1 = yaw + ((i + 1) / n) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const ox0 = cx + c0 * rOuter, oz0 = cz + s0 * rOuter;
      const ox1 = cx + c1 * rOuter, oz1 = cz + s1 * rOuter;
      const ix0 = cx + c0 * rInner, iz0 = cz + s0 * rInner;
      const ix1 = cx + c1 * rInner, iz1 = cz + s1 * rInner;
      // Outer wall (outward normal)
      addQuad(key, [ox1, y0, oz1], [ox0, y0, oz0], [ox0, y1, oz0], [ox1, y1, oz1], sideCol);
      // Inner wall (inward cavity normal)
      addQuad(key, [ix0, y0, iz0], [ix1, y0, iz1], [ix1, y1, iz1], [ix0, y1, iz0], sideCol, -0.04);
      // Top rim annulus (upward normal)
      addQuad(key, [ix0, y1, iz0], [ix1, y1, iz1], [ox1, y1, oz1], [ox0, y1, oz0], hexTop, 0.03);
    }
  }

  /**
   * Cambered 3D arch slab (along local X axis, width along local Z, rotated by yaw).
   */
  function addArchSlab(key, cx, cy, cz, length, width, thickness, archLift, segs = 5, yaw = 0, hexTop = '#9BA093', hexSide = '#5F675F') {
    const n = Math.max(2, segs | 0);
    const hw = width * 0.5;
    const cyaw = Math.cos(yaw);
    const syaw = Math.sin(yaw);
    const toWorld = (lx, ly, lz) => [
      cx + lx * cyaw + lz * syaw,
      cy + ly,
      cz - lx * syaw + lz * cyaw
    ];
    for (let i = 0; i < n; i++) {
      const u0 = i / n;
      const u1 = (i + 1) / n;
      const x0 = (u0 - 0.5) * length;
      const x1 = (u1 - 0.5) * length;
      const yTop0 = Math.sin(u0 * Math.PI) * archLift + thickness * 0.5;
      const yTop1 = Math.sin(u1 * Math.PI) * archLift + thickness * 0.5;
      const yBot0 = yTop0 - thickness;
      const yBot1 = yTop1 - thickness;

      const tl0 = toWorld(x0, yTop0, -hw), tr0 = toWorld(x0, yTop0, hw);
      const tl1 = toWorld(x1, yTop1, -hw), tr1 = toWorld(x1, yTop1, hw);
      const bl0 = toWorld(x0, yBot0, -hw), br0 = toWorld(x0, yBot0, hw);
      const bl1 = toWorld(x1, yBot1, -hw), br1 = toWorld(x1, yBot1, hw);

      addQuad(key, tl0, tr0, tr1, tl1, hexTop, i % 2 === 0 ? 0.02 : -0.01);
      addQuad(key, bl1, br1, br0, bl0, hexSide, -0.06);
      addQuad(key, bl1, bl0, tl0, tl1, hexSide);
      addQuad(key, br0, br1, tr1, tr0, hexSide);
      if (i === 0) addQuad(key, bl0, br0, tr0, tl0, hexSide);
      if (i === n - 1) addQuad(key, br1, bl1, tl1, tr1, hexSide);
    }
  }

  /**
   * Song-Yuan Axe-Cut ('斧劈皴 / 折带皴') Stratified Faceted Rock & Cliff Massif.
   * Replaces boxy rectangular cliffs & boulders with angular overhanging mineral-stone strata + moss cap.
   */
  function addFacetedRock(key, cx, cy, cz, rx, ry, rz, yaw = 0, seed = 1, opts = {}) {
    const sides = opts.sides || 7;
    const stoneDark = opts.stoneDark || '#58625B';
    const stoneMid = opts.stoneMid || '#7E867B';
    const stoneCyan = opts.stoneCyan || '#5C7B6F';
    const stoneLight = opts.stoneLight || '#9CA395';
    const moss = opts.moss || '#6E8F56';
    const mossBright = opts.mossBright || '#84A464';
    const hasMoss = opts.hasMoss !== false;
    const mossTag = opts.mossTag || null;

    const cyaw = Math.cos(yaw);
    const syaw = Math.sin(yaw);
    const rotW = (lx, ly, lz) => [
      cx + lx * cyaw + lz * syaw,
      cy + ly,
      cz - lx * syaw + lz * cyaw
    ];

    const bRing = [];
    const lRing = [];
    const uRing = [];
    const tRing = [];
    const leanX = (hash01(seed * 13 + 1) - 0.5) * rx * 0.24;
    const leanZ = (hash01(seed * 17 + 3) - 0.5) * rz * 0.24;

    for (let i = 0; i < sides; i++) {
      const jitter = (hash01(seed * 31 + i * 7) - 0.5) * (TAU / sides) * 0.34;
      const a = (i / sides) * TAU + jitter;
      const ca = Math.cos(a), sa = Math.sin(a);
      const radJ = 0.76 + hash01(seed * 43 + i * 11) * 0.38;
      const shelfJ = 0.80 + hash01(seed * 59 + i * 13) * 0.36;
      const topJ = 0.46 + hash01(seed * 71 + i * 19) * 0.34;

      bRing.push(rotW(ca * rx * 1.06 * radJ, -ry * 0.5, sa * rz * 1.04 * radJ));
      lRing.push(rotW(ca * rx * 0.98 * shelfJ + leanX * 0.35, -ry * 0.04 + (i % 2) * ry * 0.06, sa * rz * 0.96 * shelfJ + leanZ * 0.35));
      uRing.push(rotW(ca * rx * 0.84 * radJ + leanX * 0.78, ry * 0.34 + ((i + 1) % 2) * ry * 0.05, sa * rz * 0.82 * radJ + leanZ * 0.78));
      tRing.push(rotW(ca * rx * topJ + leanX, ry * 0.48 + hash01(seed * 89 + i) * ry * 0.06, sa * rz * topJ + leanZ));
    }

    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const cLower = i % 2 === 0 ? stoneDark : stoneCyan;
      const cMid = i % 3 === 0 ? stoneCyan : (i % 2 === 0 ? stoneMid : stoneDark);
      const cUpper = i % 2 === 0 ? stoneLight : stoneMid;
      addQuad(key, bRing[j], bRing[i], lRing[i], lRing[j], cLower, -0.02);
      addQuad(key, lRing[j], lRing[i], uRing[i], uRing[j], cMid);
      addQuad(key, uRing[j], uRing[i], tRing[i], tRing[j], cUpper, 0.02);
    }

    const apex = rotW(leanX * 1.05, ry * 0.54, leanZ * 1.05);
    const emitCap = () => {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        const capCol = hasMoss ? (i % 2 === 0 ? mossBright : moss) : (i % 2 === 0 ? stoneLight : stoneMid);
        addTri(key, apex[0], apex[1], apex[2], tRing[j][0], tRing[j][1], tRing[j][2], tRing[i][0], tRing[i][1], tRing[i][2], capCol, 0.03);
      }
    };
    if (mossTag && hasMoss) {
      withTag(mossTag, emitCap);
    } else {
      emitCap();
    }
  }

  function buildMesh(key, material, name) {
    const b = buckets.get(key);
    if (!b || b.pos.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.colorTags = b.tags.slice();
    return mesh;
  }

  return {
    withTag,
    addTri,
    addQuad,
    addGeo,
    addBox,
    addTiltedBox,
    addCylinder,
    addCone,
    addBeam,
    addHollowCylinder,
    addArchSlab,
    addFacetedRock,
    buildMesh
  };
}

function bakeGeometryFromBuilder(fn) {
  const baker = createVertexColorBaker();
  fn(baker);
  const mesh = baker.buildMesh('unit', new THREE.MeshBasicMaterial(), 'unit');
  const geo = mesh.geometry;
  mesh.material.dispose();
  return geo;
}

/**
 * Helper: sculpted multi-faceted organic foliage / blossom cloud dome (replaces boxy raw IcosahedronGeometry).
 */
function addOrganicCanopyCluster(b, cx, cy, cz, rx, ry, rz, sides, hexTop, hexMid, hexBot, seed = 1) {
  const eqRing = [];
  const hiRing = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU + (seed * 0.37);
    const lobe = i % 2 === 0 ? 1.04 : 0.88;
    const jx = (hash01(seed * 29 + i * 5) - 0.5) * 0.08;
    const jz = (hash01(seed * 37 + i * 7) - 0.5) * 0.08;
    const ca = Math.cos(a), sa = Math.sin(a);
    eqRing.push([
      cx + (ca * lobe + jx) * rx,
      cy - ry * 0.08 + (i % 2) * ry * 0.07,
      cz + (sa * lobe + jz) * rz
    ]);
    hiRing.push([
      cx + (ca * lobe * 0.64 + jx * 0.5) * rx,
      cy + ry * 0.58 + ((i + 1) % 2) * ry * 0.06,
      cz + (sa * lobe * 0.64 + jz * 0.5) * rz
    ]);
  }
  const topApex = [cx, cy + ry * 0.96, cz];
  const botApex = [cx, cy - ry * 0.54, cz];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    b.addQuad('unit', eqRing[j], eqRing[i], hiRing[i], hiRing[j], hexMid, 0.02);
    b.addTri('unit', topApex[0], topApex[1], topApex[2], hiRing[j][0], hiRing[j][1], hiRing[j][2], hiRing[i][0], hiRing[i][1], hiRing[i][2], hexTop, 0.04);
    b.addTri('unit', botApex[0], botApex[1], botApex[2], eqRing[i][0], eqRing[i][1], eqRing[i][2], eqRing[j][0], eqRing[j][1], eqRing[j][2], hexBot, -0.02);
  }
}

/**
 * 1. 宋元迎客苍松 (Gnarled buttress roots + 5-segment twisted trunk & welcoming boughs + 5 scalloped cloud-needle pads)
 */
export function buildCliffPineGeometry(pal = {}) {
  const barkDark = pal.pineBark || '#4D3F35';
  const barkLight = '#6E5949';
  const needleDeep = pal.pineDeep || '#2E4D43';
  const needleMid = pal.pineMid || '#456D5E';
  const needleTop = pal.pineLight || '#648E78';

  return bakeGeometryFromBuilder((b) => {
    // 3 gnarled buttress roots anchoring into cliff/slope ground
    const roots = [
      [[0.02, 0.16, 0.0], [-0.36, -0.14, 0.22], 0.11, 0.048],
      [[-0.02, 0.14, 0.02], [0.34, -0.14, 0.20], 0.10, 0.045],
      [[0.0, 0.15, -0.02], [0.04, -0.14, -0.36], 0.10, 0.045]
    ];
    for (const [p0, p1, r0, r1] of roots) {
      b.addBeam('unit', p0, p1, r0, r1, 4, barkDark, barkLight, false);
    }

    // Twisted 4-stage main trunk + welcoming outstretched arm & secondary boughs
    const limbs = [
      [[0.0, -0.12, 0.0], [0.09, 0.86, 0.05], 0.21, 0.155, 6],
      [[0.08, 0.82, 0.05], [-0.16, 1.88, -0.06], 0.152, 0.115, 6],
      [[-0.15, 1.84, -0.06], [0.06, 2.76, 0.04], 0.112, 0.082, 5],
      [[0.05, 2.72, 0.04], [0.16, 3.36, 0.07], 0.080, 0.048, 5],
      // Iconic Song-painting welcoming horizontal bough + upturned tip
      [[-0.06, 1.62, -0.02], [0.68, 1.86, 0.18], 0.088, 0.056, 5],
      [[0.65, 1.85, 0.17], [1.22, 2.08, 0.28], 0.055, 0.032, 4],
      // Counter-balancing west & north boughs
      [[-0.12, 2.12, -0.05], [-0.74, 2.52, -0.22], 0.072, 0.036, 4],
      [[0.06, 2.68, 0.04], [-0.24, 3.04, 0.48], 0.058, 0.030, 4]
    ];
    for (const [p0, p1, r0, r1, segs] of limbs) {
      b.addBeam('unit', p0, p1, r0, r1, segs, barkDark, barkLight, false);
    }

    // 5 layered sculpted Song pine needle cloud-pads (fuller painterly domes with outward normals)
    const pads = [
      { cx: 1.12, cy: 2.12, cz: 0.26, rx: 1.08, rz: 0.88, hTop: 0.36, hSkirt: 0.14, n: 8, rot: 0.15, top: needleMid },
      { cx: 0.56, cy: 1.94, cz: 0.16, rx: 0.78, rz: 0.68, hTop: 0.28, hSkirt: 0.12, n: 6, rot: 0.65, top: needleMid },
      { cx: -0.68, cy: 2.58, cz: -0.20, rx: 1.06, rz: 0.88, hTop: 0.38, hSkirt: 0.14, n: 8, rot: 0.85, top: needleMid },
      { cx: -0.22, cy: 3.08, cz: 0.46, rx: 0.90, rz: 0.78, hTop: 0.32, hSkirt: 0.12, n: 6, rot: 1.25, top: needleTop },
      { cx: 0.16, cy: 3.44, cz: 0.06, rx: 1.32, rz: 1.12, hTop: 0.44, hSkirt: 0.16, n: 8, rot: 1.55, top: needleTop }
    ];
    for (let p = 0; p < pads.length; p++) {
      const pd = pads[p];
      const apex = [pd.cx, pd.cy + pd.hTop, pd.cz];
      const under = [pd.cx, pd.cy - pd.hSkirt * 1.35, pd.cz];
      const midRing = [];
      const rimRing = [];
      for (let i = 0; i < pd.n; i++) {
        const a = pd.rot + (i / pd.n) * TAU;
        const scallop = i % 2 === 0 ? 1.06 : 0.82;
        const ca = Math.cos(a), sa = Math.sin(a);
        const rimDrop = i % 2 === 0 ? 0.32 : 0.08;
        midRing.push([pd.cx + ca * pd.rx * 0.60 * scallop, pd.cy + pd.hTop * 0.54, pd.cz + sa * pd.rz * 0.60 * scallop]);
        rimRing.push([pd.cx + ca * pd.rx * scallop, pd.cy - pd.hSkirt * rimDrop, pd.cz + sa * pd.rz * scallop]);
      }
      for (let i = 0; i < pd.n; i++) {
        const j = (i + 1) % pd.n;
        b.addTri('unit', apex[0], apex[1], apex[2], midRing[j][0], midRing[j][1], midRing[j][2], midRing[i][0], midRing[i][1], midRing[i][2], pd.top, 0.03);
        b.addQuad('unit', rimRing[j], rimRing[i], midRing[i], midRing[j], i % 2 === 0 ? pd.top : needleMid, 0.01);
        b.addTri('unit', under[0], under[1], under[2], rimRing[i][0], rimRing[i][1], rimRing[i][2], rimRing[j][0], rimRing[j][1], rimRing[j][2], needleDeep, -0.04);
      }
    }
  });
}

/**
 * 2. 山杏野梅花树 (Crooked '曲铁古干' plum/apricot trunk & twigs + 6 layered scalloped blossom cloud clusters)
 * Crown vertices stay bright neutral (#DCE2D6..#FFFFFF) so seasonal instance/vertex tinting + spring restore are exact.
 */
export function buildBlossomTreeGeometry() {
  const barkDark = '#524036';
  const barkMid = '#6B5547';
  return bakeGeometryFromBuilder((b) => {
    // Flared root base + crooked S-bent trunk + forked branches & delicate twigs
    const branches = [
      [[0.0, -0.12, 0.0], [0.06, 0.68, 0.03], 0.17, 0.125, 5],
      [[0.05, 0.64, 0.03], [-0.04, 1.34, -0.02], 0.122, 0.095, 5],
      [[-0.03, 1.28, -0.02], [-0.62, 2.28, 0.24], 0.082, 0.042, 4],
      [[-0.58, 2.24, 0.22], [-0.98, 2.48, 0.42], 0.040, 0.022, 4],
      [[-0.02, 1.30, -0.01], [0.66, 2.34, -0.22], 0.082, 0.042, 4],
      [[0.62, 2.30, -0.20], [1.02, 2.16, -0.34], 0.038, 0.020, 4],
      [[-0.02, 1.32, 0.0], [0.08, 2.78, 0.14], 0.074, 0.036, 4],
      [[0.04, 1.92, 0.06], [0.24, 2.38, 0.64], 0.050, 0.025, 4]
    ];
    for (const [p0, p1, r0, r1, segs] of branches) {
      b.addBeam('unit', p0, p1, r0, r1, segs, barkDark, barkMid, false);
    }

    // 6 asymmetric layered blossom cloud clusters ('疏影横斜')
    const clusters = [
      { x: 0.06, y: 3.04, z: 0.12, rx: 1.02, ry: 0.62, rz: 0.96, s: 8, seed: 1 },
      { x: -0.66, y: 2.46, z: 0.26, rx: 0.86, ry: 0.54, rz: 0.82, s: 7, seed: 2 },
      { x: 0.68, y: 2.54, z: -0.22, rx: 0.88, ry: 0.56, rz: 0.84, s: 7, seed: 3 },
      { x: -1.04, y: 2.56, z: 0.44, rx: 0.56, ry: 0.38, rz: 0.54, s: 6, seed: 4 },
      { x: 1.06, y: 2.20, z: -0.36, rx: 0.54, ry: 0.36, rz: 0.52, s: 6, seed: 5 },
      { x: 0.26, y: 2.48, z: 0.68, rx: 0.64, ry: 0.42, rz: 0.62, s: 6, seed: 6 }
    ];
    for (const cl of clusters) {
      addOrganicCanopyCluster(b, cl.x, cl.y, cl.z, cl.rx, cl.ry, cl.rz, cl.s, '#FFFFFF', '#F2F4EC', '#DCE2D6', cl.seed);
    }
  });
}

/**
 * 3. 山坡修竹丛 (4 multi-segment arching culms with raised node rings + 2 bamboo shoots + airy '个字' lancet leaf sprays)
 */
export function buildHillsideBambooGeometry(pal = {}) {
  const culmBase = pal.bamboo || '#6D854D';
  const culmMid = '#7F965A';
  const culmTop = pal.bambooCulm || '#95AA6E';
  const nodeRingHex = '#B8C48E';
  const leafTop = '#98B56F';
  const leafMid = '#7D9B56';
  const leafDeep = '#58753F';

  return bakeGeometryFromBuilder((b) => {
    const culms = [
      { x: 0.0, z: 0.0, lx: 0.28, lz: 0.12, h: 4.65, r: 0.052 },
      { x: -0.28, z: 0.20, lx: -0.32, lz: 0.22, h: 4.05, r: 0.046 },
      { x: 0.26, z: -0.21, lx: 0.24, lz: -0.28, h: 3.62, r: 0.042 },
      { x: -0.10, z: -0.26, lx: -0.16, lz: -0.24, h: 2.95, r: 0.035 }
    ];

    const addLeafSpray = (ox, oy, oz, baseYaw, scale) => {
      // 3 radiating arched lancet bamboo leaves ('个/介' brushwork silhouette, zero wasted caps)
      for (let k = 0; k < 3; k++) {
        const yaw = baseYaw + (k - 1) * 0.72;
        const ca = Math.cos(yaw), sa = Math.sin(yaw);
        const nx = -sa * 0.088 * scale;
        const nz = ca * 0.088 * scale;
        const midX = ox + ca * 0.35 * scale;
        const midY = oy + 0.065 * scale;
        const midZ = oz + sa * 0.35 * scale;
        const tipX = ox + ca * 0.74 * scale;
        const tipY = oy - 0.17 * scale;
        const tipZ = oz + sa * 0.74 * scale;
        const hex = k === 1 ? leafTop : leafMid;
        b.addTri('unit', ox, oy, oz, midX + nx, midY, midZ + nz, midX - nx, midY, midZ - nz, hex, 0.02);
        b.addTri('unit', midX - nx, midY, midZ - nz, midX + nx, midY, midZ + nz, tipX, tipY, tipZ, hex, 0.01);
        b.addTri('unit', ox, oy - 0.01, oz, midX - nx, midY - 0.01, midZ - nz, tipX, tipY, tipZ, leafDeep, -0.02);
      }
    };

    for (let ci = 0; ci < culms.length; ci++) {
      const c = culms[ci];
      const p0 = [c.x, -0.10, c.z];
      const p1 = [c.x + c.lx * 0.26, c.h * 0.36, c.z + c.lz * 0.26];
      const p2 = [c.x + c.lx * 0.64, c.h * 0.70, c.z + c.lz * 0.64];
      const p3 = [c.x + c.lx, c.h, c.z + c.lz];

      b.addBeam('unit', p0, p1, c.r, c.r * 0.86, 4, culmBase, culmMid, false);
      b.addBeam('unit', p1, p2, c.r * 0.85, c.r * 0.66, 4, culmMid, culmTop, false);
      b.addBeam('unit', p2, p3, c.r * 0.65, c.r * 0.38, 4, culmTop, culmTop, false);

      // Raised bamboo node collars (竹节环 — open-ended sleeves, zero hidden end-cap waste)
      b.addBeam('unit', [p1[0], p1[1] - 0.018, p1[2]], [p1[0], p1[1] + 0.018, p1[2]], c.r * 1.12, c.r * 1.12, 4, nodeRingHex, nodeRingHex, false);
      b.addBeam('unit', [p2[0], p2[1] - 0.015, p2[2]], [p2[0], p2[1] + 0.015, p2[2]], c.r * 0.90, c.r * 0.90, 4, nodeRingHex, nodeRingHex, false);

      // Layered bamboo leaf sprays along upper culm
      const baseAng = Math.atan2(c.lz, c.lx);
      addLeafSpray(p2[0], p2[1] + 0.05, p2[2], baseAng + 0.55, 0.94);
      if (ci < 3) {
        addLeafSpray(lerp(p2[0], p3[0], 0.55), lerp(p2[1], p3[1], 0.55), lerp(p2[2], p3[2], 0.55), baseAng - 0.65, 1.0);
      }
      addLeafSpray(p3[0], p3[1], p3[2], baseAng + 0.1, 0.88);
    }

    // 2 emerging conical bamboo shoots (春笋) at cluster base (open-base 4-sided shoots)
    for (const [sx, sz, sr, sh, syaw] of [[0.16, 0.15, 0.068, 0.34, 0.3], [-0.18, -0.06, 0.054, 0.26, 1.1]]) {
      for (let k = 0; k < 4; k++) {
        const a0 = syaw + (k / 4) * TAU;
        const a1 = syaw + ((k + 1) / 4) * TAU;
        b.addTri(
          'unit',
          sx, sh, sz,
          sx + Math.cos(a1) * sr, -0.03, sz + Math.sin(a1) * sr,
          sx + Math.cos(a0) * sr, -0.03, sz + Math.sin(a0) * sr,
          k % 2 === 0 ? '#C8B07A' : '#7C6545'
        );
      }
    }
  });
}

/**
 * 4. 云雾茶垄与药畦圆丛 (Multi-lobed cushion bush + woody stems + 4 upright tender shoot tips)
 */
export function buildTeaOrHerbShrubGeometry() {
  return bakeGeometryFromBuilder((b) => {
    // Basal woody stems
    b.addBeam('unit', [0, -0.06, 0], [-0.16, 0.20, 0.08], 0.045, 0.028, 3, '#6A5844', '#85725B', false);
    b.addBeam('unit', [0, -0.06, 0], [0.18, 0.22, -0.06], 0.045, 0.028, 3, '#6A5844', '#85725B', false);

    // 3 overlapping scalloped foliage cushions
    addOrganicCanopyCluster(b, 0.0, 0.30, 0.0, 0.56, 0.32, 0.50, 6, '#FFFFFF', '#E6EFE0', '#BAC8AE', 11);
    addOrganicCanopyCluster(b, -0.22, 0.24, 0.12, 0.38, 0.24, 0.36, 5, '#F7FBF2', '#DCE8D2', '#B2C0A6', 17);
    addOrganicCanopyCluster(b, 0.24, 0.25, -0.10, 0.38, 0.25, 0.36, 5, '#F7FBF2', '#DCE8D2', '#B2C0A6', 23);

    // 4 upright tender tea buds / herb flower spikes (open-base 3-sided shoots)
    const buds = [
      [0.02, 0.45, 0.0, 0.11, 0.22, 0.2],
      [-0.18, 0.39, 0.10, 0.085, 0.18, 1.1],
      [0.19, 0.40, -0.08, 0.085, 0.18, 2.3],
      [0.05, 0.41, -0.16, 0.08, 0.16, 3.6]
    ];
    for (const [bx, by, bz, br, bh, byaw] of buds) {
      for (let k = 0; k < 3; k++) {
        const a0 = byaw + (k / 3) * TAU;
        const a1 = byaw + ((k + 1) / 3) * TAU;
        b.addTri(
          'unit',
          bx, by + bh, bz,
          bx + Math.cos(a1) * br, by, bz + Math.sin(a1) * br,
          bx + Math.cos(a0) * br, by, bz + Math.sin(a0) * br,
          k === 0 ? '#FFFFFF' : '#DCE8D2'
        );
      }
    }
  });
}

/**
 * 5. 宋元青绿山骨叠石 (3-mass axe-cut '斧劈叠石': tall main crag + leaning shoulder stone + mossy toe boulder)
 */
export function buildStratifiedCragGeometry(pal = {}) {
  const dark = pal.stoneDark || '#58625A';
  const mid = pal.stone || '#838A7F';
  const light = pal.stoneLight || '#A3AA9B';
  const cyanStone = '#597B6E';
  const moss = pal.moss || '#6E8F56';
  const mossHi = pal.mossBright || '#86A865';

  return bakeGeometryFromBuilder((b) => {
    const rockOpts = {
      sides: 7,
      stoneDark: dark,
      stoneMid: mid,
      stoneCyan: cyanStone,
      stoneLight: light,
      moss,
      mossBright: mossHi,
      hasMoss: true
    };
    // Main towering tilted crag (grounded down to y = -0.38)
    b.addFacetedRock('unit', 0.06, 0.36, -0.02, 0.92, 1.48, 0.78, 0.18, 101, rockOpts);
    // Leaning secondary shoulder slab
    b.addFacetedRock('unit', -0.58, 0.10, 0.22, 0.62, 0.96, 0.54, -0.65, 203, rockOpts);
    // Low mossy toe stone
    b.addFacetedRock('unit', 0.48, -0.04, 0.34, 0.46, 0.64, 0.42, 0.92, 307, rockOpts);
  });
}

/**
 * 6. 山野芳草蕨丛 (7 two-segment gracefully arching grass/fern blades + 3-petal mountain wildflower floret)
 */
export function buildMeadowTuftGeometry() {
  return bakeGeometryFromBuilder((b) => {
    const blades = [
      { ang: 0.0, rMid: 0.10, rTip: 0.28, hMid: 0.28, hTip: 0.54, w: 0.062, c0: '#D6E6C4', c1: '#FFFFFF' },
      { ang: 0.92, rMid: 0.12, rTip: 0.34, hMid: 0.24, hTip: 0.44, w: 0.058, c0: '#CEE0BA', c1: '#EAF4DE' },
      { ang: 1.84, rMid: 0.11, rTip: 0.30, hMid: 0.26, hTip: 0.50, w: 0.060, c0: '#D6E6C4', c1: '#F4F9EC' },
      { ang: 2.75, rMid: 0.13, rTip: 0.35, hMid: 0.22, hTip: 0.40, w: 0.056, c0: '#C8DCBA', c1: '#E4F0D6' },
      { ang: 3.68, rMid: 0.10, rTip: 0.29, hMid: 0.27, hTip: 0.48, w: 0.058, c0: '#D6E6C4', c1: '#FFFFFF' },
      { ang: 4.58, rMid: 0.12, rTip: 0.33, hMid: 0.23, hTip: 0.42, w: 0.056, c0: '#CEE0BA', c1: '#EAF4DE' },
      { ang: 5.45, rMid: 0.09, rTip: 0.25, hMid: 0.29, hTip: 0.52, w: 0.058, c0: '#D6E6C4', c1: '#F6FAEE' }
    ];
    for (const bl of blades) {
      const ca = Math.cos(bl.ang), sa = Math.sin(bl.ang);
      const px = -sa * bl.w, pz = ca * bl.w;
      const mx = ca * bl.rMid, mz = sa * bl.rMid;
      const tx = ca * bl.rTip, tz = sa * bl.rTip;
      b.addQuad(
        'unit',
        [px, -0.05, pz],
        [-px, -0.05, -pz],
        [mx - px * 0.62, bl.hMid, mz - pz * 0.62],
        [mx + px * 0.62, bl.hMid, mz + pz * 0.62],
        bl.c0
      );
      b.addTri(
        'unit',
        mx + px * 0.62, bl.hMid, mz + pz * 0.62,
        mx - px * 0.62, bl.hMid, mz - pz * 0.62,
        tx, bl.hTip, tz,
        bl.c1
      );
    }
    // Delicate 3-petal wildflower floret in center
    const fy = 0.48;
    for (let p = 0; p < 3; p++) {
      const a0 = (p / 3) * TAU + 0.2;
      const a1 = a0 + 0.85;
      b.addTri(
        'unit',
        0.02, fy - 0.02, 0.01,
        0.02 + Math.cos(a0) * 0.075, fy + 0.03, 0.01 + Math.sin(a0) * 0.075,
        0.02 + Math.cos(a1) * 0.075, fy + 0.03, 0.01 + Math.sin(a1) * 0.075,
        '#FFFDF4',
        0.05
      );
    }
  });
}

/**
 * 7. 飞泉水练/雾气轻羽几何 (Sculpted 6-faceted spindrift splash plume)
 */
export function buildWaterFxGeometry() {
  return bakeGeometryFromBuilder((b) => {
    const segs = 6;
    const eq = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU;
      const r = i % 2 === 0 ? 0.44 : 0.34;
      eq.push([Math.cos(a) * r, 0.02, Math.sin(a) * r]);
    }
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      b.addTri('unit', 0, 0.56, 0, eq[j][0], eq[j][1], eq[j][2], eq[i][0], eq[i][1], eq[i][2], '#FFFFFF', 0.04);
      b.addTri('unit', 0, -0.48, 0, eq[i][0], eq[i][1], eq[i][2], eq[j][0], eq[j][1], eq[j][2], '#D8ECE6', -0.02);
    }
  });
}

// ============================================================================
// 8. 边界生灵精细雕刻部件 (Mountain Goat, Soaring Crane, Herb Butterfly, Petal/Leaf)
// ============================================================================

/**
 * 东皋散牧白山羊 (Anatomical ribcage, brisket, haunches, tapered legs + cloven hooves, 3-segment curved horns & beard)
 */
export function createMountainGoatParts() {
  const WOOL_TOP = '#F5F2E7';
  const WOOL_SIDE = '#E5DFD2';
  const WOOL_BELLY = '#D5CEC0';
  const HOOF = '#4A433B';
  const HORN_BASE = '#8F8064';
  const HORN_TIP = '#6E6049';

  const bodyGeo = bakeGeometryFromBuilder((b) => {
    // Smooth 7-sided organic torso barrel + chest brisket + haunch + upturned tail
    b.addBeam('unit', [0, 0.45, -0.25], [0, 0.48, 0.20], 0.148, 0.162, 7, WOOL_SIDE, WOOL_TOP, true);
    b.addBeam('unit', [0, 0.43, 0.14], [0, 0.50, 0.29], 0.148, 0.118, 6, WOOL_BELLY, WOOL_TOP, true);
    b.addBeam('unit', [0, 0.46, -0.19], [0, 0.44, -0.32], 0.140, 0.102, 6, WOOL_SIDE, WOOL_TOP, true);
    b.addBeam('unit', [0, 0.49, -0.30], [0, 0.63, -0.37], 0.044, 0.022, 5, WOOL_TOP, WOOL_SIDE, true);

    const legs = [
      [-0.095, 0.21, 0.015],
      [0.095, 0.21, -0.015],
      [-0.098, -0.22, -0.015],
      [0.098, -0.22, 0.015]
    ];
    for (const [lx, lz, stride] of legs) {
      const kneeZ = lz + stride;
      b.addBeam('unit', [lx, 0.40, lz], [lx, 0.20, kneeZ], 0.056, 0.036, 5, WOOL_SIDE, WOOL_BELLY, false);
      b.addBeam('unit', [lx, 0.21, kneeZ], [lx, 0.045, lz + stride * 0.4], 0.034, 0.027, 5, WOOL_BELLY, '#CEC6B5', false);
      b.addCylinder('unit', lx, 0.026, lz + stride * 0.4 + 0.008, 0.030, 0.036, 0.052, 5, 0, HOOF, HOOF);
    }
  });

  // Head local origin at neck base [0, 0.52, 0.25]
  const headGeo = bakeGeometryFromBuilder((b) => {
    // Tapered muscular neck
    b.addBeam('unit', [0, -0.02, 0.0], [0, 0.19, 0.11], 0.082, 0.064, 6, WOOL_SIDE, WOOL_TOP, true);
    // Cranium + tapered muzzle + dark nose tip
    b.addBeam('unit', [0, 0.21, 0.09], [0, 0.18, 0.27], 0.072, 0.044, 6, WOOL_TOP, '#DDD6C7', true);
    b.addBox('unit', 0, 0.175, 0.285, 0.046, 0.038, 0.032, 0, HOOF, HOOF);
    // Flowing goatee beard
    b.addBeam('unit', [0, 0.15, 0.22], [0, 0.04, 0.25], 0.032, 0.008, 4, '#EAE4D5', '#CFC8B5', false);
    // Outstretched ears + 3-segment sweeping curved ridged mountain-goat horns
    for (const s of [-1, 1]) {
      b.addBeam('unit', [s * 0.055, 0.22, 0.11], [s * 0.135, 0.20, 0.09], 0.024, 0.010, 4, WOOL_SIDE, '#D8CFC0', false);
      const h0 = [s * 0.032, 0.25, 0.10];
      const h1 = [s * 0.058, 0.34, 0.05];
      const h2 = [s * 0.082, 0.38, -0.04];
      const h3 = [s * 0.095, 0.34, -0.12];
      b.addBeam('unit', h0, h1, 0.024, 0.019, 5, HORN_BASE, HORN_BASE, false);
      b.addBeam('unit', h1, h2, 0.019, 0.013, 5, HORN_BASE, HORN_TIP, false);
      b.addBeam('unit', h2, h3, 0.013, 0.005, 4, HORN_TIP, HORN_TIP, false);
    }
  });

  return {
    bodyGeo,
    headGeo,
    neckPivot: [0, 0.52, 0.25]
  };
}

/**
 * 云间丹顶白鹤 (Streamlined fusiform torso, S-curved neck, crimson crown, feathered primaries & trailing legs)
 */
export function createSoaringCraneParts() {
  const WHITE = '#F7F6F0';
  const SHADE = '#DDE2DE';
  const INK = '#34393C';
  const CROWN = '#C84739';
  const BEAK = '#A39268';

  const bodyGeo = bakeGeometryFromBuilder((b) => {
    // Fusiform avian body (chest taper -> belly -> tail base)
    b.addBeam('unit', [0, 0.0, -0.30], [0, 0.01, 0.28], 0.095, 0.125, 6, SHADE, WHITE, true);
    b.addBeam('unit', [0, 0.01, 0.24], [0, 0.03, 0.42], 0.118, 0.058, 6, WHITE, WHITE, true);
    // Graceful S-curved outstretched neck (white base -> ink throat stripe -> white head)
    b.addBeam('unit', [0, 0.03, 0.39], [0, 0.07, 0.58], 0.044, 0.034, 5, INK, WHITE, false);
    b.addBeam('unit', [0, 0.07, 0.57], [0, 0.09, 0.73], 0.034, 0.038, 5, INK, WHITE, true);
    // Crimson '丹顶' crown cap + slender pointed beak
    b.addBox('unit', 0, 0.118, 0.72, 0.054, 0.028, 0.068, 0, CROWN, CROWN);
    b.addBeam('unit', [0, 0.088, 0.75], [0, 0.075, 0.98], 0.022, 0.005, 4, BEAK, '#7E704E', false);
    // Fan-spread ink-black tail coverts & slender trailing legs
    b.addBeam('unit', [0, 0.01, -0.26], [0, 0.02, -0.44], 0.085, 0.115, 5, INK, INK, true);
    for (const s of [-1, 1]) {
      b.addBeam('unit', [s * 0.045, -0.03, -0.28], [s * 0.052, -0.06, -0.82], 0.015, 0.010, 4, INK, INK, false);
    }
  });

  const makeWing = (side) => bakeGeometryFromBuilder((b) => {
    // Cambered inner wing covert + mid arch + 4 spread ink-black primary finger feathers
    const pRootF = [0, 0.02, 0.19], pRootB = [0, 0.01, -0.18];
    const pMidF = [side * 0.52, 0.07, 0.16], pMidB = [side * 0.50, 0.04, -0.16];
    const pOuterF = [side * 0.88, 0.04, 0.10], pOuterB = [side * 0.82, 0.02, -0.18];

    // Double-sided cambered white coverts
    b.addQuad('unit', pRootF, pRootB, pMidB, pMidF, WHITE, 0.03);
    b.addQuad('unit', pRootB, pRootF, pMidF, pMidB, SHADE, -0.02);
    b.addQuad('unit', pMidF, pMidB, pOuterB, pOuterF, WHITE, 0.02);
    b.addQuad('unit', pMidB, pMidF, pOuterF, pOuterB, SHADE, -0.02);

    // Ink-tipped secondaries along trailing edge + 3 splayed primary wingtips
    b.addQuad('unit', [side * 0.42, 0.04, -0.14], [side * 0.82, 0.02, -0.18], [side * 0.78, 0.01, -0.27], [side * 0.38, 0.02, -0.23], INK);
    b.addQuad('unit', [side * 0.82, 0.02, -0.18], [side * 0.42, 0.04, -0.14], [side * 0.38, 0.02, -0.23], [side * 0.78, 0.01, -0.27], INK);

    for (let f = 0; f < 3; f++) {
      const z0 = 0.09 - f * 0.09;
      const tipX = side * (1.14 - f * 0.06);
      const tipZ = 0.05 - f * 0.12;
      b.addTri('unit', side * 0.84, 0.035, z0 + 0.04, side * 0.82, 0.025, z0 - 0.05, tipX, 0.01, tipZ, INK);
      b.addTri('unit', side * 0.82, 0.025, z0 - 0.05, side * 0.84, 0.035, z0 + 0.04, tipX, 0.01, tipZ, INK);
    }
  });

  return {
    bodyGeo,
    wingLGeo: makeWing(-1),
    wingRGeo: makeWing(1)
  };
}

/**
 * 药畦粉蝶 (Forewing + swallowtail hindwing butterfly)
 */
export function createButterflyParts() {
  const makeWing = (side) => bakeGeometryFromBuilder((b) => {
    // Forewing (warm cream-apricot)
    b.addTri('unit', 0, 0.004, 0.035, side * 0.105, 0.014, 0.075, side * 0.088, 0.008, -0.005, '#F6E5C4', 0.04);
    b.addTri('unit', 0, 0.004, 0.035, side * 0.088, 0.008, -0.005, side * 0.105, 0.014, 0.075, '#E4D6B8');
    // Hindwing with delicate celadon-jade tint
    b.addTri('unit', 0, 0.002, 0.005, side * 0.082, 0.006, -0.008, side * 0.058, -0.002, -0.082, '#DCECE4', 0.03);
    b.addTri('unit', 0, 0.002, 0.005, side * 0.058, -0.002, -0.082, side * 0.082, 0.006, -0.008, '#C8DFD4');
  });
  return {
    wingLGeo: makeWing(-1),
    wingRGeo: makeWing(1)
  };
}

/**
 * 东皋落英 / 秋林霜叶轻羽面片 (4-triangle double-sided cambered petal/leaf for zero-draw-call faunaBatch)
 */
export function createDriftingPetalLeafGeometry(baseHex = '#F4CBD2', tipHex = '#F8F1E7') {
  return bakeGeometryFromBuilder((b) => {
    b.addTri('unit', 0, 0.008, 0.082, -0.052, 0, 0.006, 0.052, 0, 0.006, baseHex, 0.03);
    b.addTri('unit', -0.052, 0, 0.006, 0, -0.006, -0.082, 0.052, 0, 0.006, tipHex, 0.02);
    b.addTri('unit', 0, 0.008, 0.082, 0.052, 0, 0.006, -0.052, 0, 0.006, baseHex);
    b.addTri('unit', -0.052, 0, 0.006, 0.052, 0, 0.006, 0, -0.006, -0.082, tipHex);
  });
}
