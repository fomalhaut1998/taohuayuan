import * as THREE from 'three';

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _nv = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _tn = new THREE.Vector3();
const UNIT_X = new THREE.Vector3(1, 0, 0);
const UNIT_Y = new THREE.Vector3(0, 1, 0);

function createSink() {
  return { pos: [], nor: [], col: [] };
}

function pushGeo(sk, geo, mat, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  _nm.getNormalMatrix(mat);
  for (let i = 0; i < pos.length; i += 3) {
    _v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(mat);
    sk.pos.push(_v.x, _v.y, _v.z);
    _nv.set(nor[i], nor[i + 1], nor[i + 2]).applyMatrix3(_nm).normalize();
    sk.nor.push(_nv.x, _nv.y, _nv.z);
    sk.col.push(color.r, color.g, color.b);
  }
  if (g !== geo) g.dispose();
}

// 以矩阵摆放一份几何（用于舱板、船篷等零件）
function put(sk, geo, x, y, z, sx, sy, sz, color, rotX, rotY, rotZ) {
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _q.setFromEuler(new THREE.Euler(rotX || 0, rotY || 0, rotZ || 0, 'YXZ'));
  _m.compose(_p, _q, _s);
  pushGeo(sk, geo, _m, color);
}

// 两点之间摆一根方料：桨、舷缘、船篷脊杆都用它
function putBar(sk, geo, ax, ay, az, bx, by, bz, thick, wide, color) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  _dir.subVectors(_b, _a);
  const len = _dir.length() || 0.001;
  _dir.multiplyScalar(1 / len);
  _p.addVectors(_a, _b).multiplyScalar(0.5);
  _q.setFromUnitVectors(UNIT_X, _dir);
  _s.set(len, thick, wide);
  _m.compose(_p, _q, _s);
  pushGeo(sk, geo, _m, color);
}

function putRope(sk, ax, ay, az, bx, by, bz, radius, color) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  _dir.subVectors(_b, _a);
  const len = _dir.length() || 0.001;
  _dir.multiplyScalar(1 / len);
  _p.addVectors(_a, _b).multiplyScalar(0.5);
  _q.setFromUnitVectors(UNIT_Y, _dir);
  _s.set(radius * 2, len, radius * 2);
  _m.compose(_p, _q, _s);
  pushGeo(sk, CYL, _m, color);
}

function tri(sk, a, b, c, color) {
  _t1.subVectors(b, a);
  _t2.subVectors(c, a);
  _tn.crossVectors(_t1, _t2).normalize();
  sk.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < 3; i++) {
    sk.nor.push(_tn.x, _tn.y, _tn.z);
    sk.col.push(color.r, color.g, color.b);
  }
}

function quad(sk, a, b, c, d, color) {
  tri(sk, a, b, c, color);
  tri(sk, a, c, d, color);
}

// 船体：五道截面放样，舷缘 / 舭线 / 龙骨三段折面，保持低多边形折面感
function buildHull(sk, cfg, colors) {
  const rings = [];
  for (let i = 0; i < cfg.sections.length; i++) {
    const s = cfg.sections[i];
    const x = s.x * cfg.length;
    const w = cfg.width * 0.5 * s.w;
    const rim = cfg.freeboard * s.rim;
    const bot = -cfg.draft * s.bot;
    rings.push({
      rimL: new THREE.Vector3(x, rim, -w),
      rimR: new THREE.Vector3(x, rim, w),
      chL: new THREE.Vector3(x, rim - cfg.chine, -w * 0.68),
      chR: new THREE.Vector3(x, rim - cfg.chine, w * 0.68),
      keel: new THREE.Vector3(x, bot, 0)
    });
  }

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    quad(sk, a.rimL, a.chL, b.chL, b.rimL, colors.wood);
    quad(sk, a.rimR, b.rimR, b.chR, a.chR, colors.wood);
    quad(sk, a.chL, a.keel, b.keel, b.chL, colors.woodDark);
    quad(sk, a.chR, b.chR, b.keel, a.keel, colors.woodDark);
    // 舷缘压条用浅竹色勾一道边，船影再暗也能看出轮廓
    putBar(sk, BOX, a.rimL.x, a.rimL.y + 0.015, a.rimL.z, b.rimL.x, b.rimL.y + 0.015, b.rimL.z, 0.055, 0.075, colors.bamboo);
    putBar(sk, BOX, a.rimR.x, a.rimR.y + 0.015, a.rimR.z, b.rimR.x, b.rimR.y + 0.015, b.rimR.z, 0.055, 0.075, colors.bamboo);
  }

  const stern = rings[0];
  const bow = rings[rings.length - 1];
  tri(sk, stern.keel, stern.chL, stern.rimL, colors.woodDark);
  tri(sk, stern.keel, stern.rimR, stern.chR, colors.woodDark);
  tri(sk, stern.keel, stern.rimL, stern.rimR, colors.woodDark);
  tri(sk, bow.keel, bow.rimL, bow.chL, colors.woodDark);
  tri(sk, bow.keel, bow.chR, bow.rimR, colors.woodDark);
  tri(sk, bow.keel, bow.rimR, bow.rimL, colors.woodDark);

  // 舱底板与横坐板
  put(sk, BOX, 0, cfg.freeboard * 0.12, 0, cfg.length * 0.62, 0.035, cfg.width * 0.5, colors.inside, 0, 0, 0);
  for (let i = 0; i < cfg.seats.length; i++) {
    put(sk, BOX, cfg.seats[i] * cfg.length, cfg.freeboard * 0.58, 0, 0.22, 0.05, cfg.width * 0.8, colors.woodDark, 0, 0, 0);
  }
}

// 乌篷：半圆拱棚，前端敞口可见竹篾拱肋与幽深船舱，后端深色隔板，脊上竹檩
function buildCanopy(sk, cfg, colors) {
  const c = cfg.canopy;
  const R = cfg.width * c.radius;
  const H = R * c.height;
  const x0 = c.x0 * cfg.length;
  const x1 = c.x1 * cfg.length;
  const baseY = cfg.freeboard + 0.02;
  const arc = [];
  const innerArc = [];
  for (let i = 0; i <= c.segs; i++) {
    const a = Math.PI * (i / c.segs);
    arc.push({ z: Math.cos(a) * R, y: Math.sin(a) * H });
    innerArc.push({ z: Math.cos(a) * R * 0.92, y: Math.sin(a) * H * 0.92 });
  }
  const linerCol = colors.canopy.clone().multiplyScalar(0.72);
  const ribX = [x0, x0 + (x1 - x0) * 0.34, x0 + (x1 - x0) * 0.68, x1];
  for (let i = 0; i < c.segs; i++) {
    // 乌篷外层竹席拱顶
    quad(sk,
      new THREE.Vector3(x0, baseY + arc[i].y, arc[i].z),
      new THREE.Vector3(x0, baseY + arc[i + 1].y, arc[i + 1].z),
      new THREE.Vector3(x1, baseY + arc[i + 1].y, arc[i + 1].z),
      new THREE.Vector3(x1, baseY + arc[i].y, arc[i].z),
      colors.canopy);
    // 舱内深褐篾衬（敞口望入有厚度与阴影层次）
    quad(sk,
      new THREE.Vector3(x1, baseY + innerArc[i].y, innerArc[i].z),
      new THREE.Vector3(x1, baseY + innerArc[i + 1].y, innerArc[i + 1].z),
      new THREE.Vector3(x0 + 0.04, baseY + innerArc[i + 1].y, innerArc[i + 1].z),
      new THREE.Vector3(x0 + 0.04, baseY + innerArc[i].y, innerArc[i].z),
      linerCol);
    // 四道竹篾箍肋（首尾与两道中拱肋）
    for (let r = 0; r < ribX.length; r++) {
      const rx = ribX[r];
      const thick = (r === 0 || r === ribX.length - 1) ? 0.036 : 0.024;
      putBar(sk, BOX, rx, baseY + arc[i].y, arc[i].z, rx, baseY + arc[i + 1].y, arc[i + 1].z, thick, thick * 1.25, colors.bamboo);
    }
    // 敞口前缘竹席厚度封边
    quad(sk,
      new THREE.Vector3(x1, baseY + arc[i].y, arc[i].z),
      new THREE.Vector3(x1, baseY + arc[i + 1].y, arc[i + 1].z),
      new THREE.Vector3(x1, baseY + innerArc[i + 1].y, innerArc[i + 1].z),
      new THREE.Vector3(x1, baseY + innerArc[i].y, innerArc[i].z),
      colors.bamboo);
  }
  // 后端设微内凹的乌篷尾板（避免前后贯通穿帮），前端保持敞口拱洞！
  const sternCenter = new THREE.Vector3(x0 + 0.04, baseY, 0);
  for (let i = 0; i < c.segs; i++) {
    tri(sk, sternCenter,
      new THREE.Vector3(x0 + 0.04, baseY + innerArc[i + 1].y, innerArc[i + 1].z),
      new THREE.Vector3(x0 + 0.04, baseY + innerArc[i].y, innerArc[i].z),
      linerCol);
  }
  // 脊顶主竹檩与左右两道侧檩
  putBar(sk, BOX, x0, baseY + H + 0.01, 0, x1, baseY + H + 0.01, 0, 0.044, 0.044, colors.bamboo);
  for (const side of [-1, 1]) {
    const iz = Math.cos(Math.PI * 0.25) * R * side;
    const iy = Math.sin(Math.PI * 0.25) * H;
    putBar(sk, BOX, x0, baseY + iy, iz, x1, baseY + iy, iz, 0.024, 0.026, colors.bamboo);
  }
}

function addOars(sk, cfg, colors) {
  // 舷边架设木桨（圆柱长柄 + 舷边木橹桩 + 木桨叶与中脊棱），另一支斜搁舱内
  putRope(sk, -0.4, cfg.freeboard + 0.16, -0.5, 1.66, cfg.freeboard - 0.01, 0.31, 0.024, colors.woodDark);
  // 舷边短橹桩
  putRope(sk, 0.14, cfg.freeboard - 0.02, -0.26, 0.14, cfg.freeboard + 0.16, -0.26, 0.022, colors.wood);
  // 外展木桨叶与中脊加强棱（精确保留原始外沿包络，不改变船体碰撞半径）
  putBar(sk, BOX, 1.62, cfg.freeboard - 0.03, 0.3, 2.12, cfg.freeboard - 0.09, 0.52, 0.26, 0.025, colors.wood);
  putRope(sk, 1.54, cfg.freeboard - 0.01, 0.27, 2.04, cfg.freeboard - 0.08, 0.49, 0.016, colors.woodDark);
  // 舱内备用木桨
  putRope(sk, -1.2, cfg.freeboard * 0.34, 0.3, 0.28, cfg.freeboard * 0.29, 0.15, 0.021, colors.woodDark);
  putBar(sk, BOX, 0.20, cfg.freeboard * 0.29, 0.15, 0.62, cfg.freeboard * 0.28, 0.12, 0.024, 0.16, colors.wood);
}

function addNet(sk, cfg, colors) {
  // 层叠收拢渔网堆 + 串绳红褐木浮标 + 带竹节长撑篙
  const roll = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const netDark = colors.net.clone().multiplyScalar(0.84);
  put(sk, roll, -0.64, cfg.freeboard * 0.28, 0.10, 0.34, cfg.width * 0.66, 0.24, colors.net, Math.PI / 2, 0.16, 0.08);
  put(sk, roll, -0.20, cfg.freeboard * 0.31, 0.14, 0.32, cfg.width * 0.62, 0.24, netDark, Math.PI / 2, -0.14, -0.06);
  put(sk, roll, 0.22, cfg.freeboard * 0.28, 0.08, 0.30, cfg.width * 0.58, 0.22, colors.net, Math.PI / 2, 0.22, 0.05);
  put(sk, roll, -0.34, cfg.freeboard * 0.44, 0.12, 0.26, cfg.width * 0.48, 0.18, colors.net, Math.PI / 2, -0.05, 0.12);
  roll.dispose();
  // 网缘 5 枚木浮子
  for (let i = 0; i < 5; i++) {
    const fx = -0.68 + i * 0.24;
    const fz = 0.24 + (i % 2 ? 0.08 : -0.06);
    put(sk, CYL, fx, cfg.freeboard * 0.48, fz, 0.065, 0.095, 0.065, colors.wood, 0.4, i * 0.7, 0.5);
  }
  // 细圆长竹篙与竹节环
  putRope(sk, -1.22, cfg.freeboard + 0.12, -1.16, 0.68, cfg.freeboard + 0.12, 1.02, 0.021, colors.bamboo);
  for (let n = 1; n <= 4; n++) {
    const t = n / 5;
    const nx = -1.22 + (0.68 + 1.22) * t;
    const nz = -1.16 + (1.02 + 1.16) * t;
    put(sk, CYL, nx, cfg.freeboard + 0.12, nz, 0.052, 0.025, 0.052, colors.woodDark, 0, 0, Math.PI / 2);
  }
}

function addBasket(sk, cfg, colors) {
  // 束腰敞口竹编鱼篓（Lathe 中空内腔 + 深色竹口沿箍）+ 两尾探出篓口的活鱼
  const y0 = cfg.freeboard * 0.12;
  const creel = new THREE.LatheGeometry([
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.16, 0),
    new THREE.Vector2(0.24, 0.14),
    new THREE.Vector2(0.22, 0.26),
    new THREE.Vector2(0.16, 0.34),
    new THREE.Vector2(0.19, 0.38),
    new THREE.Vector2(0.165, 0.38),
    new THREE.Vector2(0.135, 0.31),
    new THREE.Vector2(0.16, 0.12),
    new THREE.Vector2(0.01, 0.06)
  ], 10);
  put(sk, creel, -0.80, y0, -0.16, 1, 1, 1, colors.basket, 0, 0.4, 0);
  creel.dispose();
  const rim = new THREE.LatheGeometry([
    new THREE.Vector2(0.165, 0.35),
    new THREE.Vector2(0.198, 0.365),
    new THREE.Vector2(0.195, 0.39),
    new THREE.Vector2(0.162, 0.39)
  ], 10);
  put(sk, rim, -0.80, y0, -0.16, 1, 1, 1, colors.woodDark, 0, 0.4, 0);
  rim.dispose();
  // 两尾银灰溪鱼斜倚篓口（流线鱼腹 + 分叉燕尾）
  const fishDark = colors.fish.clone().multiplyScalar(0.80);
  for (const [fx, fy, fz, tx, ty, tz] of [
    [-0.86, y0 + 0.24, -0.11, -0.90, y0 + 0.44, -0.07],
    [-0.73, y0 + 0.24, -0.22, -0.68, y0 + 0.42, -0.27]
  ]) {
    putRope(sk, fx, fy, fz, (fx + tx) * 0.5, (fy + ty) * 0.5, (fz + tz) * 0.5, 0.042, colors.fish);
    putRope(sk, (fx + tx) * 0.5, (fy + ty) * 0.5, (fz + tz) * 0.5, tx, ty, tz, 0.022, colors.fish);
    putRope(sk, tx, ty, tz, tx - 0.04, ty + 0.07, tz + 0.02, 0.014, fishDark);
    putRope(sk, tx, ty, tz, tx + 0.04, ty + 0.06, tz - 0.02, 0.014, fishDark);
  }
}

function createGeometry(sk) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sk.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(sk.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(sk.col, 3));
  geo.computeBoundingSphere();
  return geo;
}

function nearestT(curve, x, z) {
  let best = Infinity;
  let bt = 0;
  const N = 600;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = curve.getPointAt(t);
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < best) {
      best = d;
      bt = t;
    }
  }
  return bt;
}

export function createBoats(cfg, stream, terrainCfg, curve, field) {
  const rand = lcg(cfg.seed);
  const group = new THREE.Group();
  const colors = {};
  for (const key in cfg.colors) colors[key] = new THREE.Color(cfg.colors[key]);
  const waterLevel = terrainCfg.waterLevel;
  const list = [];
  const moor = createSink();
  const halfLength = cfg.length * 0.5;

  const hullMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide
  });

  for (let i = 0; i < cfg.boats.length; i++) {
    const spec = cfg.boats[i];
    const t = nearestT(curve, spec.x, spec.z);
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nx = tan.z;
    const nz = -tan.x;
    const lat = (spec.x - p.x) * nx + (spec.z - p.z) * nz;
    const face = spec.face || 1;
    const yaw = Math.atan2(-tan.z * face, tan.x * face) + spec.rot;

    const sk = createSink();
    buildHull(sk, cfg, colors);
    if (spec.canopy) buildCanopy(sk, cfg, colors);
    if (spec.fit === 'oar') addOars(sk, cfg, colors);
    else if (spec.fit === 'net') addNet(sk, cfg, colors);
    else if (spec.fit === 'basket') addBasket(sk, cfg, colors);

    const hull = new THREE.Mesh(createGeometry(sk), hullMat);
    hull.name = 'boat-' + i;
    hull.position.set(spec.x, waterLevel, spec.z);
    hull.rotation.order = 'YXZ';
    hull.rotation.set(0, yaw, 0, 'YXZ');
    group.add(hull);

    // 岸桩与缆绳：从船头往岸上一段一段找干地，找到就钉桩
    const bx = spec.x + Math.cos(yaw) * (halfLength - 0.06);
    const bz = spec.z - Math.sin(yaw) * (halfLength - 0.06);
    const by = waterLevel + cfg.freeboard * 0.95;
    const outward = lat >= 0 ? 1 : -1;
    const ox = nx * outward;
    const oz = nz * outward;
    let bank = null;
    for (let d = 2; d <= cfg.mooring.search; d += cfg.mooring.step) {
      const px = spec.x + ox * d;
      const pz = spec.z + oz * d;
      const h = field.sample(px, pz);
      if (h > waterLevel + cfg.mooring.dry) {
        bank = { x: px, z: pz, y: h };
        break;
      }
    }
    if (!bank) {
      bank = { x: spec.x + ox * cfg.mooring.search, z: spec.z + oz * cfg.mooring.search, y: waterLevel + 0.4 };
    }
    const top = bank.y + cfg.mooring.poleHeight - 0.05;
    put(moor, CYL, bank.x, bank.y + cfg.mooring.poleHeight * 0.5 - 0.04, bank.z,
      cfg.mooring.poleRadius * 2, cfg.mooring.poleHeight, cfg.mooring.poleRadius * 2,
      colors.bamboo, 0, 0, 0);
    // 缆绳分几段往下垂，避免两点之间一根直杆似的折线
    let px = bank.x;
    let py = top;
    let pz = bank.z;
    for (let s = 1; s <= cfg.mooring.segments; s++) {
      const u = s / cfg.mooring.segments;
      const nx2 = bank.x + (bx - bank.x) * u;
      const nz2 = bank.z + (bz - bank.z) * u;
      const ny2 = top + (by - top) * u - Math.sin(Math.PI * u) * cfg.mooring.sag;
      putRope(moor, px, py, pz, nx2, ny2, nz2, cfg.mooring.ropeRadius, colors.rope);
      px = nx2;
      py = ny2;
      pz = nz2;
    }

    list.push({
      mesh: hull,
      t: t,
      yaw: yaw,
      phase: rand() * Math.PI * 2
    });
  }

  if (moor.pos.length > 0) {
    const moorMesh = new THREE.Mesh(createGeometry(moor), hullMat);
    moorMesh.name = 'boat-moorings';
    group.add(moorMesh);
  }

  function update(dt, elapsed) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const bob = Math.sin(elapsed * cfg.bob.speed + b.phase);
      const sway = Math.sin(elapsed * cfg.bob.speed * 0.73 + b.phase + 1.7);
      b.mesh.position.y = stream.surfaceY(b.t, elapsed) + bob * cfg.bob.amp;
      b.mesh.rotation.set(sway * cfg.bob.pitch, b.yaw, bob * cfg.bob.roll, 'YXZ');
    }
  }

  return { group: group, count: list.length, update: update };
}
