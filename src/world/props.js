import * as THREE from 'three';
import { foliageGeometry, openVesselGeometry, hayGeometry, revolvedGeometry } from './model-geometry.js';

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 合并几何的小工具：所有家什烘进一个 mesh，村子里的零碎只花一个 draw call
function sink() {
  return { pos: [], nor: [], col: [] };
}

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function push(sk, geo, mat, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  // 花团几何自带逐面明度（红通道）；其余几何没有 color 属性，系数一律为 1。
  const vc = g.attributes.color ? g.attributes.color.array : null;
  _n.getNormalMatrix(mat);
  for (let i = 0; i < p.length; i += 3) {
    _v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(mat);
    sk.pos.push(_v.x, _v.y, _v.z);
    _v.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(_n).normalize();
    sk.nor.push(_v.x, _v.y, _v.z);
    const s = vc ? vc[i] : 1;
    sk.col.push(color.r * s, color.g * s, color.b * s);
  }
}

// Exact-triangle bespoke silhouettes keeping props.tris === baselineProps.tris (55,208).
function wineJarGeometry() {
  // 7-sided revolved Qin-Han amphora (42 tris) + 2-tri cloth seal lid = 44 tris (replaces ico 20 + cyl6 24).
  const body = revolvedGeometry([[0.28, 0], [0.50, 0.36], [0.42, 0.74], [0.25, 1.0]], 7, 0.08);
  const pos = Array.from(body.attributes.position.array);
  const col = Array.from(body.attributes.color.array);
  const y = 1.01, r = 0.24;
  pos.push(-r, y, -r, -r, y, r, r, y, r, -r, y, -r, r, y, r, r, y, -r);
  for (let i = 0; i < 6; i++) col.push(1.06, 1.06, 1.06);
  body.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function wavyClothGeometry() {
  // 3 cols x 1 row front+back gently draped wavy hemp cloth = 12 tris (exact match for BoxGeometry).
  const p = [], c = [];
  const pt = (u, v) => [(u - 0.5), (0.5 - v), 0.10 * Math.sin(u * Math.PI * 2.5) * (0.25 + 0.75 * v) + 0.04 * v];
  for (let i = 0; i < 3; i++) {
    const a = pt(i / 3, 0), b = pt((i + 1) / 3, 0), d = pt(i / 3, 1), e = pt((i + 1) / 3, 1);
    const s = 0.94 + 0.08 * (i % 2);
    p.push(...a, ...d, ...e, ...a, ...e, ...b, ...a, ...e, ...d, ...a, ...b, ...e);
    for (let k = 0; k < 12; k++) c.push(s, s, s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}
function gableRoofGeometry() {
  // Pitched two-slope thatched gable roof = 12 tris (exact match for BoxGeometry).
  const hw = 0.5, hd = 0.5, hy = 0.5;
  const p = [
    // Left slope (2 tris)
    -hw, -hy, hd, 0, hy, hd, 0, hy, -hd, -hw, -hy, hd, 0, hy, -hd, -hw, -hy, -hd,
    // Right slope (2 tris)
    0, hy, hd, hw, -hy, hd, hw, -hy, -hd, 0, hy, hd, hw, -hy, -hd, 0, hy, -hd,
    // Front & back gables (2 tris)
    -hw, -hy, hd, hw, -hy, hd, 0, hy, hd, hw, -hy, -hd, -hw, -hy, -hd, 0, hy, -hd,
    // Bottom soffit (2 tris) + Left/Right eaves fascia (4 tris)
    -hw, -hy, -hd, hw, -hy, -hd, hw, -hy, hd, -hw, -hy, -hd, hw, -hy, hd, -hw, -hy, hd,
    -hw, -hy, hd, -hw, -hy, -hd, -hw, -hy - 0.18, -hd, -hw, -hy, hd, -hw, -hy - 0.18, -hd, -hw, -hy - 0.18, hd,
    hw, -hy, -hd, hw, -hy, hd, hw, -hy - 0.18, hd, hw, -hy, -hd, hw, -hy - 0.18, hd, hw, -hy - 0.18, -hd
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
function wellCanopyGeometry() {
  // Small pitched well-frame roof = 20 tris (2 slopes top+bottom + 2 gables + ridge cap).
  const hw = 0.5, hd = 0.5, h = 0.5;
  const p = [
    // Top slopes (4 tris)
    -hw, 0, hd, 0, h, hd, 0, h, -hd, -hw, 0, hd, 0, h, -hd, -hw, 0, -hd,
    0, h, hd, hw, 0, hd, hw, 0, -hd, 0, h, hd, hw, 0, -hd, 0, h, -hd,
    // Underside slopes (4 tris)
    -hw, 0, -hd, 0, h, -hd, 0, h, hd, -hw, 0, -hd, 0, h, hd, -hw, 0, hd,
    0, h, -hd, hw, 0, -hd, hw, 0, hd, 0, h, -hd, hw, 0, hd, 0, h, hd,
    // Front/back gables (2 tris) + overhanging eaves fascia (4 tris) + ridge (6 tris)
    -hw, 0, hd, hw, 0, hd, 0, h, hd, hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
    -hw, 0, hd, -hw, 0, -hd, -hw, -0.09, -hd, -hw, 0, hd, -hw, -0.09, -hd, -hw, -0.09, hd,
    hw, 0, -hd, hw, 0, hd, hw, -0.09, hd, hw, 0, -hd, hw, -0.09, hd, hw, -0.09, -hd,
    -0.05, h, hd, 0.05, h, hd, 0.05, h + 0.07, -hd, -0.05, h, hd, 0.05, h + 0.07, -hd, -0.05, h + 0.07, -hd,
    -0.05, h, -hd, -0.05, h + 0.07, -hd, -0.05, h + 0.07, hd, -0.05, h, -hd, -0.05, h + 0.07, hd, -0.05, h, hd,
    0.05, h, hd, 0.05, h + 0.07, hd, 0.05, h + 0.07, -hd, 0.05, h, hd, 0.05, h + 0.07, -hd, 0.05, h, -hd
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

const RES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  vat: openVesselGeometry('vat'),
  basket: openVesselGeometry('basket'),
  bucket: openVesselGeometry('bucket'),
  hay: hayGeometry(),
  wellCurb: revolvedGeometry([[0.48, 0], [0.50, 0.42], [0.56, 0.48], [0.56, 0.56], [0.36, 0.56], [0.36, 0.06]], 10, 0.07),
  wellCanopy: wellCanopyGeometry(),
  wineJar: wineJarGeometry(),
  cloth: wavyClothGeometry(),
  gableRoof: gableRoofGeometry(),
  band: new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, true),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cylTaper: new THREE.CylinderGeometry(0.3, 0.5, 1, 6),
  cyl10: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  ico: new THREE.IcosahedronGeometry(0.5, 0)
};

export function createProps(cfg, field, houses, plots, road) {
  const rand = lcg(51713);
  const sk = sink();
  // 舆图要画的那些家什：3D 里摆过一遍，图上照着同一份坐标再画一遍，
  // 免得图和景各说各话（图上有井、场景里没有之类）。
  const marks = [];
  const cWood = new THREE.Color(cfg.wood);
  const cWoodDark = new THREE.Color(cfg.woodDark);
  const cStone = new THREE.Color(cfg.stone);
  const cClay = new THREE.Color(cfg.clay);
  const cStraw = new THREE.Color(cfg.straw);
  const cCloth = new THREE.Color(cfg.cloth);
  const cGreen = new THREE.Color(cfg.cabbage);
  const cPaper = new THREE.Color(cfg.paper || '#E8DFC8');
  const cDoor = new THREE.Color(cfg.door || '#4C3A2A');
  const cSoil = new THREE.Color(cfg.soil || '#6B5A44');

  // ---------- 杂树：屋前舍后的桃、桑、榆 ----------
  // 保留既有树位、外包半径与合并预算；曲干分叉和偏冠不新增独立树 mesh。
  const cLeaf = [
    new THREE.Color('#6C8B4E'),
    new THREE.Color('#5E7C3E'),
    new THREE.Color('#7C9463')
  ];
  const cBloom = new THREE.Color('#E8A0A8');

  // 一核 + 错落叶簇：48 面的三瓣轻扁轮廓，替代 20 面大尖三角。
  // 只生成少量共享模板后烘入静态批次；柔和明暗避免宝石/拼球感。
  const tp = cfg.tree || {};
  const faceShade = tp.faceShade || [0.82, 1.12];
  const puffSeed = tp.seed ?? 9137;
  // 变体仅改变局部叶簇的相位，绝不消费世界布置的 rand。
  const puffPool = [];
  const poolSize = tp.puffVariants ?? 4;
  for (let i = 0; i < poolSize; i++) {
    const g = foliageGeometry(puffSeed + i * 37, 0.5, faceShade), p = g.attributes.position, vc = g.attributes.color;
    // Props-only Song-Yuan painterly cloud profile: flatter shaded base, terraced irregular upper lobes.
    for (let j = 0; j < p.count; j++) {
      const x = p.getX(j), y = p.getY(j), z = p.getZ(j), a = Math.atan2(z, x);
      const notch = 1 - 0.28 * Math.pow(0.5 + 0.5 * Math.sin(a * 3 + i * 1.7), 2.5);
      const yy = y < 0 ? y * 0.56 : y * (0.86 + 0.14 * Math.cos(a * 2 + i));
      p.setXYZ(j, x * notch, yy, z * notch);
      if (vc) {
        const s = vc.getX(j) * (y < 0 ? 0.89 : 1.03);
        vc.setXYZ(j, s, s, s);
      }
    }
    g.computeVertexNormals(); g.computeBoundingBox();
    puffPool.push(g);
  }
  const puffCore = puffPool[0];
  // Adjacent rings have the same diameter, so three wooden sections read as
  // one tapering curved stem, not three stacked cones with shelf-like collars.
  const stemPool = [[2.1, 1.62], [1.62, 1.15], [1.15, 0.68]].map(([base, tip]) =>
    new THREE.CylinderGeometry(0.5 * tip / base, 0.5, 1, 6));

  // A tree has exactly the old six timber pieces and original foliage slots.
  // All endpoints are shared: bending the stem cannot produce floating forks.
  function treeLimb(base, from, to, width, color, geo = RES.cylTaper) {
    const c = Math.cos(base.rot), s = Math.sin(base.rot);
    const point = p => new THREE.Vector3(base.x + p[0] * c + p[2] * s, base.y + p[1], base.z - p[0] * s + p[2] * c);
    const a = point(from), b = point(to), dir = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    _m.compose(a.add(b).multiplyScalar(0.5), q, new THREE.Vector3(width, dir.length(), width));
    push(sk, geo, _m, color);
  }
  function tree(x, z, h, r, col, blossom) {
    const gy = field.sample(x, z);
    const b = { x, y: gy, z, rot: rand() * 6.28 };
    const th = h * 0.42, tw = 0.13 + r * 0.05;
    const nodes = [[0, -0.04, 0]], levels = [0.34, 0.65, 1.02];
    for (let k = 0; k < 3; k++) {
      // Same two draws as the old randomly disconnected trunk segments.
      const px = tw * ([0.55, -0.18, 0.8][k] + (rand() - 0.5) * 0.18);
      const pz = tw * ([0.1, 0.7, 0.4][k] + (rand() - 0.5) * 0.18);
      nodes.push([px, th * levels[k], pz]);
      treeLimb(b, nodes[k], nodes[k + 1], tw * [2.1, 1.62, 1.15][k], cWoodDark.clone().offsetHSL(0, 0, k * 0.012), stemPool[k]);
    }
    const tips = [], brR = tw * (tp.branchRadius ?? 0.62) * 1.6;
    for (let k = 0; k < 3; k++) {
      const a = [0.32, 2.9, 4.7][k] + rand() * 0.28;
      const bl = r * (0.85 + rand() * 0.35), reach = Math.min(r * 0.48, bl * 0.43);
      const tip = [Math.cos(a) * reach, th * 1.02 + r * [0.52, 0.10, 0.32][k], Math.sin(a) * reach];
      treeLimb(b, nodes[k === 1 ? 1 : 2], tip, brR * [1, 0.82, 0.72][k], cWoodDark);
      tips.push(tip);
    }
    // No central ellipsoid cap: the dominant crown follows the highest bough.
    // Lower side and rear boughs leave visible notches and daylight at the fork.
    const cy = tips[0][1], cr = tp.coreRadius ?? 0.66;
    put(puffCore, b, tips[0][0], cy + r * 0.12, tips[0][2], r * cr * 1.45, r * cr * 0.9, r * cr * 1.1,
      col.clone().offsetHSL(0, 0, -0.025), rand() * 3);
    const sat = tp.satellitePuffs ?? 9;
    const sr0 = (tp.satelliteRadius || [0.34, 0.52])[0], sr1 = (tp.satelliteRadius || [0.34, 0.52])[1];
    const spread = tp.crownSpread ?? 0.56, vLift = tp.crownVertical ?? 0.72;
    const hueVar = tp.hueVar ?? 0.025, lightVar = Math.min(tp.lightVar ?? 0.11, 0.055);
    for (let k = 0; k < sat; k++) {
      const a = k / sat * Math.PI * 2 + rand() * 0.9;
      const rr = r * (sr0 + rand() * (sr1 - sr0)), tip = tips[k % 3];
      const ox = Math.cos(a) * r * spread * (0.13 + rand() * 0.15);
      const oy = (rand() - 0.3) * r * vLift * 0.45;
      const oz = Math.sin(a) * r * spread * (0.13 + rand() * 0.15);
      const weight = [1, 0.85, 0.95][k % 3];
      put(puffPool[(k + 1) % puffPool.length], b, tip[0] + ox, tip[1] + oy, tip[2] + oz,
        rr * 1.2 * weight, rr * 0.92, rr * 1.05 * weight,
        col.clone().offsetHSL((rand() - 0.5) * hueVar * 2, (rand() - 0.5) * hueVar * 2,
          (rand() - 0.5) * lightVar * 2), rand() * 3);
    }
    if (blossom) {
      const bp = tp.bloomPuffs ?? 5;
      const br0 = (tp.bloomRadius || [0.24, 0.38])[0], br1 = (tp.bloomRadius || [0.24, 0.38])[1];
      for (let k = 0; k < bp; k++) {
        const rr = r * (br0 + rand() * (br1 - br0)), tip = tips[k % 3];
        put(puffPool[(k + 2) % puffPool.length], b,
          tip[0] + (rand() - 0.5) * r * 0.23, tip[1] + r * (0.08 + rand() * 0.16), tip[2] + (rand() - 0.5) * r * 0.23,
          rr * 1.1, rr * 0.78, rr * 0.95,
          cBloom.clone().offsetHSL(0, 0, (rand() - 0.5) * (tp.bloomLightVar ?? 0.06) * 2), rand() * 3);
      }
    }
    marks.push({ kind: 'tree', x, z, r, h, blossom: !!blossom });
  }

  function put(geo, base, lx, ly, lz, sx, sy, sz, color, rotY, rotX) {
    _e.set(rotX || 0, (base.rot || 0) + (rotY || 0), 0, 'YXZ');
    _q.setFromEuler(_e);
    // 局部坐标要按屋子朝向转过来：局部 (x,z) → 世界
    const a = base.rot || 0;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    _m.compose(
      new THREE.Vector3(base.x + lx * ca + lz * sa, base.y + ly, base.z - lx * sa + lz * ca),
      _q,
      new THREE.Vector3(sx, sy, sz)
    );
    push(sk, geo, _m, color);
  }

  // 以屋子为原点的局部坐标架：局部 +z 朝门口外边
  function local(hi) {
    return {
      x: hi.x,
      y: hi.gy,
      z: hi.z,
      rot: hi.rot,
      px: function (lx, lz) {
        return {
          x: hi.x + lx * Math.cos(hi.rot) + lz * Math.sin(hi.rot),
          z: hi.z - lx * Math.sin(hi.rot) + lz * Math.cos(hi.rot)
        };
      }
    };
  }

  // ---------- 篱笆 ----------
  function fence(hi, halfW, front, color) {
    const b = local(hi);
    marks.push({ kind: 'fence', x: hi.x, z: hi.z, rot: hi.rot, halfW: halfW, front: front, back: -1.4, gap: 0.85 });
    const postH = 0.9;
    const step = 1.15;
    const posts = [];
    // 两侧
    for (let s = -1; s <= 1; s += 2) {
      for (let z = -1.4; z <= front; z += step) posts.push([s * halfW, z]);
    }
    // 正面留门口
    const gap = 0.85;
    for (let x = -halfW + step * 0.5; x <= halfW; x += step) {
      if (Math.abs(x) < gap) continue;
      posts.push([x, front]);
    }
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      put(RES.box, b, p[0], postH * 0.5, p[1], 0.09, postH, 0.09,
        cWood.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.06), rand() * 0.2);
    }
    // 两道横杆：正面与两侧各拉一段
    const railY = [0.34, 0.66];
    for (let r = 0; r < railY.length; r++) {
      for (let s = -1; s <= 1; s += 2) {
        const len = front + 1.4;
        put(RES.box, b, s * halfW, railY[r], (front - 1.4) * 0.5, 0.055, 0.075, len, color, 0);
      }
      // 正面（门口断开）
      const segW = (halfW - gap) * 0.5;
      for (let s = -1; s <= 1; s += 2) {
        put(RES.box, b, s * (gap + segW), railY[r], front, segW * 2, 0.075, 0.055, color, 0);
      }
    }
  }

  // ---------- 水缸 ----------
  function vat(hi, lx, lz) {
    const b = local(hi);
    const r = 0.34 + rand() * 0.08;
    const vp = b.px(lx, lz);
    marks.push({ kind: 'vat', x: vp.x, z: vp.z, rot: hi.rot, r: r * 1.1 });
    put(RES.vat, b, lx, 0, lz, r * 2, 0.495, r * 2, cClay.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.05), rand());
    // Recessed water, not a clay cap. Keep the legacy RNG draw for stable layouts.
    put(RES.cyl10, b, lx, 0.30, lz, r * 1.43, 0.008, r * 1.43, new THREE.Color('#526C60'), rand());
  }

  // ---------- 石磨 ----------
  function mill(hi, lx, lz) {
    const b = local(hi);
    const mp = b.px(lx, lz);
    marks.push({ kind: 'mill', x: mp.x, z: mp.z, rot: hi.rot, r: 0.7 });
    put(RES.cyl10, b, lx, 0.16, lz, 1.05, 0.32, 1.05, cStone, 0);
    put(RES.cyl10, b, lx, 0.4, lz, 0.92, 0.16, 0.92, cStone.clone().offsetHSL(0, 0, 0.06), 0);
    put(RES.box, b, lx + 0.62, 0.42, lz, 0.7, 0.07, 0.09, cWoodDark, 0);
  }

  // ---------- 水井 ----------
  function well(x, z) {
    marks.push({ kind: 'well', x: x, z: z, rot: 0, r: 0.75 });
    const gy = field.sample(x, z);
    const b = { x: x, y: gy, z: z, rot: 0 };
    // 整圈雕凿石井栏（含折边压顶石与深井口）+ 扎实石踏步圆台 + 辘轳木架、卷绳木筒与双坡小井亭顶（精确保持 344 三角面）
    put(RES.wellCurb, b, 0, 0.04, 0, 1.44, 1.04, 1.44, cStone, 0);
    put(RES.cyl10, b, 0, -0.02, 0, 1.72, 0.24, 1.72, cStone.clone().offsetHSL(0, 0, -0.07), 0);
    // 井架双柱 + 辘轳横轴 + 缠绳辘轳木筒 + 双坡小茅檐顶 + 悬桶
    for (let s = -1; s <= 1; s += 2) {
      put(RES.box, b, s * 0.66, 0.96, 0, 0.11, 1.56, 0.11, cWoodDark, 0);
    }
    put(RES.box, b, 0, 1.42, 0, 1.46, 0.07, 0.07, cWoodDark, 0);
    put(RES.band, b, 0.12, 1.42, 0, 0.20, 0.42, 0.20, cWood, 0, Math.PI * 0.5);
    put(RES.wellCanopy, b, 0, 1.72, 0, 1.74, 0.54, 1.18, cStraw.clone().offsetHSL(0, -0.04, -0.05), 0);
    put(RES.bucket, b, 0.18, 0.86, 0, 0.28, 0.30, 0.28, cWood, 0);
    put(RES.band, b, 0.18, 1.02, 0, 0.25, 0.022, 0.25, cWoodDark, 0);
    put(RES.box, b, 0.18, 1.24, 0, 0.022, 0.26, 0.022, cStraw, 0);
  }

  // ---------- 柴堆 ----------
  function woodpile(hi, lx, lz) {
    const b = local(hi);
    const wp = b.px(lx, lz);
    marks.push({ kind: 'woodpile', x: wp.x, z: wp.z, rot: hi.rot, w: 1.2, d: 1.0 });
    for (let row = 0; row < 3; row++) {
      const n = 5 - row;
      for (let i = 0; i < n; i++) {
        // 水平横码柴薪（rotX = π/2），顶层柴脊贴合公鸡司晨落脚高度 0.72m
        const y = 0.14 + row * 0.23;
        const x = lx + (i - (n - 1) * 0.5) * 0.23;
        put(RES.cyl6, b, x, y, lz, 0.24, 1.02, 0.24, cWoodDark.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.09), 0, Math.PI / 2);
      }
    }
  }

  // ---------- 酒坛 ----------
  function jars(hi, lx, lz) {
    const b = local(hi);
    const jp = b.px(lx, lz);
    marks.push({ kind: 'jars', x: jp.x, z: jp.z, rot: hi.rot, r: 0.42 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const x = lx + Math.cos(a) * 0.34;
      const z = lz + Math.sin(a) * 0.34;
      const h = 0.36 + rand() * 0.12;
      put(RES.wineJar, b, x, 0, z, 0.34, h + 0.06, 0.34, cClay.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.07), rand());
    }
  }

  // ---------- 菜畦 ----------
  function garden(hi, lx, lz, w, d) {
    const b = local(hi);
    const gp = b.px(lx, lz);
    marks.push({ kind: 'garden', x: gp.x, z: gp.z, rot: hi.rot, w: w, d: d });
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const x = lx + (c - 1.5) * (w / 4);
        const z = lz + (r - 1) * (d / 3);
        put(RES.ico, b, x, 0.16, z, 0.34, 0.26, 0.34, cGreen.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.1), rand() * 3);
      }
    }
  }

  // ---------- 晾衣绳 ----------
  function clothesLine(hi, lx, lz) {
    const b = local(hi);
    const cp = b.px(lx, lz);
    marks.push({ kind: 'clothesline', x: cp.x, z: cp.z, rot: hi.rot, len: 3.1 });
    for (let s = -1; s <= 1; s += 2) {
      put(RES.box, b, lx + s * 1.5, 0.9, lz, 0.09, 1.8, 0.09, cWoodDark, 0);
    }
    put(RES.box, b, lx, 1.72, lz, 3.1, 0.03, 0.03, cWood, 0);
    for (let i = 0; i < 3; i++) {
      const x = lx - 0.9 + i * 0.9;
      put(RES.cloth, b, x, 1.34, lz, 0.64, 0.74, 0.42, cCloth.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.1), 0);
    }
  }

  // ---------- 石凳 ----------
  function bench(hi, lx, lz) {
    const b = local(hi);
    const bp = b.px(lx, lz);
    marks.push({ kind: 'bench', x: bp.x, z: bp.z, rot: hi.rot, len: 1.1 });
    put(RES.box, b, lx, 0.42, lz, 1.1, 0.12, 0.4, cStone, 0);
    for (let s = -1; s <= 1; s += 2) {
      put(RES.box, b, lx + s * 0.42, 0.18, lz, 0.14, 0.36, 0.32, cStone.clone().offsetHSL(0, 0, -0.05), 0);
    }
  }

  // ---------- 鸡窝 ----------
  function coop(hi, lx, lz) {
    const b = local(hi);
    const op = b.px(lx, lz);
    marks.push({ kind: 'coop', x: op.x, z: op.z, rot: hi.rot, w: 1.15, d: 0.95 });
    const rot = rand();
    put(RES.box, b, lx, 0.28, lz, 0.92, 0.56, 0.72, cWood, rot);
    put(RES.gableRoof, b, lx, 0.72, lz, 1.18, 0.34, 0.96, cStraw, rot);
    void rand();
    put(RES.ico, b, lx + 0.1, 0.12, lz + 0.5, 0.5, 0.16, 0.4, cStraw.clone().offsetHSL(0, 0, 0.05), 0);
  }

  // ---------- 门面：门框 / 门槛 / 石阶 / 秦汉直棂窗 ----------
  const cWinTimber = new THREE.Color('#6B523B');
  const cWinJamb = new THREE.Color('#584330');
  const cWinInterior = new THREE.Color('#332920');
  const cWinShade = new THREE.Color('#5A4938');
  const cSillBlend = cWinTimber.clone().lerp(cStone, 0.32);

  function facade(hi) {
    const b = local(hi);
    // 石脚 + 四角木骨：一整面平墙最假，先给它一条基座和四根柱子
    put(RES.box, b, 0, 0.19, 0, hi.w + 0.3, 0.38, hi.d + 0.3, cStone.clone().offsetHSL(0, 0, -0.04), 0);
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        put(RES.box, b, sx * (hi.w * 0.5 - 0.02), hi.h * 0.5, sz * (hi.d * 0.5 - 0.02),
          0.17, hi.h, 0.17, cWoodDark, 0);
      }
    }
    // 檐口板：把墙顶和屋顶的接缝压住
    put(RES.box, b, 0, hi.h + 0.04, hi.d * 0.5 + 0.12, hi.w + 0.5, 0.16, 0.2, cWoodDark, 0);
    const fz = hi.d * 0.5 + 0.032;
    const doorW = 1.15;
    const doorH = 2.0;
    // 门框两柱 + 门楣（温润老榆木色）
    for (let s = -1; s <= 1; s += 2) {
      put(RES.box, b, s * (doorW * 0.5 + 0.065), doorH * 0.5 + 0.08, fz + 0.012, 0.13, doorH + 0.18, 0.14, cWinTimber, 0);
    }
    put(RES.box, b, 0, doorH + 0.20, fz + 0.016, doorW + 0.38, 0.15, 0.18, cWinTimber, 0);
    // 两扇木门板（略退入框内，既合闭户人家，也不穿出敞门人家的暗室门槛）
    for (let s = -1; s <= 1; s += 2) {
      put(RES.box, b, s * 0.275, 1.01, hi.d * 0.5 + 0.036, 0.52, 1.86, 0.022, cDoor, 0);
      put(RES.box, b, s * 0.275, 1.01, hi.d * 0.5 + 0.046, 0.048, 1.86, 0.016, cWinJamb, 0);
    }
    // 门槛石 + 阶前石
    put(RES.box, b, 0, 0.09, fz + 0.14, doorW + 0.3, 0.18, 0.5, cStone, 0);
    put(RES.box, b, 0, 0.05, fz + 0.62, doorW + 0.9, 0.14, 0.55, cStone.clone().offsetHSL(0, 0, -0.04), 0);
    // 两扇秦汉直棂木窗：精准对齐 village.js (±0.29 * hi.w) 与直棂窗位，深色内室暗影取代刺眼亮白窗纸
    const wy = -0.15 + 0.565 * hi.h;
    const winW = 0.17 * hi.w;
    const winH = 0.26 * hi.h;
    const wz = hi.d * 0.5 + 0.012;
    for (let s = -1; s <= 1; s += 2) {
      void rand(); // 保持旧版随机数序列严格一致
      const wx = s * hi.w * 0.29;
      // 老木窗楣、窗台与两侧窗框立颊
      put(RES.box, b, wx, wy + winH * 0.5 + 0.038, wz + 0.018, winW + 0.16, 0.064, 0.072, cWinTimber, 0);
      put(RES.box, b, wx, wy - winH * 0.5 - 0.034, wz + 0.020, winW + 0.18, 0.062, 0.082, cWinTimber, 0);
      put(RES.box, b, wx - winW * 0.5 - 0.038, wy, wz + 0.016, 0.064, winH + 0.08, 0.066, cWinJamb, 0);
      put(RES.box, b, wx + winW * 0.5 + 0.038, wy, wz + 0.016, 0.064, winH + 0.08, 0.066, cWinJamb, 0);
      // 内退暗室与竹帘油绢底影（不再是耀眼白纸块）
      put(RES.box, b, wx, wy, hi.d * 0.5 + 0.006, winW, winH, 0.014, cWinInterior, 0);
      for (let k = -1; k <= 1; k++) {
        put(RES.box, b, wx + k * (winW * 0.20), wy, wz + 0.014, 0.024, winH, 0.024, cWinShade, 0);
      }
      put(RES.box, b, wx, wy + winH * 0.34, wz + 0.010, winW, 0.022, 0.018, cWinShade, 0);
      // 窗台承托老木石沿
      put(RES.box, b, wx, wy - winH * 0.5 - 0.078, wz + 0.028, winW + 0.24, 0.058, 0.12, cSillBlend, 0);
    }
    // 檐下压一道暗影：屋顶与墙面的接缝不压住，整栋房子像一块切开的蛋糕
    const cShade = cWoodDark.clone().multiplyScalar(0.52);
    put(RES.box, b, 0, hi.h - 0.1, hi.d * 0.5 + 0.05, hi.w + 0.42, 0.2, 0.06, cShade, 0);
    put(RES.box, b, 0, hi.h - 0.1, -hi.d * 0.5 - 0.05, hi.w + 0.42, 0.2, 0.06, cShade, 0);
    put(RES.box, b, hi.w * 0.5 + 0.05, hi.h - 0.1, 0, 0.06, 0.2, hi.d + 0.42, cShade, 0);
    put(RES.box, b, -hi.w * 0.5 - 0.05, hi.h - 0.1, 0, 0.06, 0.2, hi.d + 0.42, cShade, 0);
    sideWindows(hi);
  }

  // ---------- 侧墙 / 背墙的秦汉直棂窗 ----------
  function sideWindows(hi) {
    const b = local(hi);
    const wy = -0.15 + 0.565 * hi.h;
    const winZ = 0.23 * hi.d;
    const winH = 0.26 * hi.h;
    const n = hi.d > 8.6 ? 2 : 1;
    for (let s = -1; s <= 1; s += 2) {
      const lx = s * (hi.w * 0.5 + 0.008);
      for (let k = 0; k < n; k++) {
        const lz = n === 1 ? (rand() * 0) : (k === 0 ? -1 : 1) * (hi.d * 0.28);
        put(RES.box, b, lx + s * 0.018, wy + winH * 0.5 + 0.036, lz, 0.068, 0.062, winZ + 0.16, cWinTimber, 0);
        put(RES.box, b, lx + s * 0.020, wy - winH * 0.5 - 0.034, lz, 0.078, 0.060, winZ + 0.18, cWinTimber, 0);
        put(RES.box, b, lx + s * 0.016, wy, lz - winZ * 0.5 - 0.036, 0.064, winH + 0.08, 0.064, cWinJamb, 0);
        put(RES.box, b, lx + s * 0.016, wy, lz + winZ * 0.5 + 0.036, 0.064, winH + 0.08, 0.064, cWinJamb, 0);
        put(RES.box, b, lx, wy, lz, 0.014, winH, winZ, cWinInterior, 0);
        for (let m = -1; m <= 1; m++) {
          put(RES.box, b, lx + s * 0.014, wy, lz + m * (winZ * 0.22), 0.024, winH, 0.026, cWinShade, 0);
        }
        put(RES.box, b, lx + s * 0.010, wy + winH * 0.34, lz, 0.020, 0.022, winZ, cWinShade, 0);
        put(RES.box, b, lx + s * 0.028, wy - winH * 0.5 - 0.076, lz, 0.11, 0.056, winZ + 0.22, cSillBlend, 0);
      }
    }
    // 背墙一扇小直棂窗（后窗）
    const bz = -hi.d * 0.5 - 0.008;
    const bWinW = 0.78;
    const bWinH = 0.66;
    put(RES.box, b, 0, wy + bWinH * 0.5 + 0.034, bz - 0.018, bWinW + 0.14, 0.058, 0.068, cWinTimber, 0);
    put(RES.box, b, 0, wy - bWinH * 0.5 - 0.034, bz - 0.020, bWinW + 0.16, 0.060, 0.076, cWinTimber, 0);
    put(RES.box, b, -bWinW * 0.5 - 0.034, wy, bz - 0.016, 0.062, bWinH + 0.06, 0.062, cWinJamb, 0);
    put(RES.box, b, bWinW * 0.5 + 0.034, wy, bz - 0.016, 0.062, bWinH + 0.06, 0.062, cWinJamb, 0);
    put(RES.box, b, 0, wy, bz, bWinW, bWinH, 0.016, cWinInterior, 0);
    put(RES.box, b, 0, wy, bz - 0.014, 0.028, bWinH, 0.026, cWinShade, 0);
    void cPaper;
  }

  // ---------- 檐下挂的蒜辫与草药（汉晋合时风物） ----------
  function hanging(hi) {
    const b = local(hi);
    const z = hi.d * 0.5 + 0.12;
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const x = -0.55 + i * 0.55 + (rand() - 0.5) * 0.2;
      const y = 1.9 - rand() * 0.25;
      const col = rand() < 0.5
        ? new THREE.Color('#DFD6C2')
        : new THREE.Color('#6E7F52');
      put(RES.box, b, x, y + 0.16, z, 0.03, 0.32, 0.03, cWoodDark, 0);
      for (let k = 0; k < 5; k++) {
        const yy = y + 0.06 - k * 0.075;
        const r = 0.055 - k * 0.006;
        put(RES.ico, b, x + (rand() - 0.5) * 0.03, yy, z, r * 2, r * 2.4, r * 2,
          col.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.06 + k * 0.012), rand() * 3);
      }
    }
  }

  // ---------- 晒谷场 ----------
  function thresh(x, z, r) {
    const gy = field.sample(x, z);
    const b = { x: x, y: gy, z: z, rot: 0 };
    const tHay = [];
    const tGrain = [];
    // 夯实的土面（加厚土台裙边，在微坡地上也严丝合缝不悬空）
    put(RES.cyl10, b, 0, -0.16, 0, r * 2, 0.56, r * 2, cStraw.clone().offsetHSL(0, -0.06, -0.09), 0);
    put(RES.cyl10, b, 0, 0.1, 0, r * 1.5, 0.06, r * 1.5, cStraw.clone().offsetHSL(0, -0.05, -0.03), 0);
    // 两座草垛
    for (let i = 0; i < 2; i++) {
      const a = 1.1 + i * 2.3;
      const hx = Math.cos(a) * r * 0.62;
      const hz = Math.sin(a) * r * 0.62;
      tHay.push([x + hx, z + hz]);
      put(RES.hay, b, hx, 0, hz, 2.0, 2.0, 2.0, cStraw.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.07), rand());
      put(RES.cyl6, b, hx, 2.05, hz, 0.13, 0.4, 0.13, cWoodDark, 0);
      // 草垛下压一圈散草
      put(RES.cyl10, b, hx, 0.14, hz, 2.4, 0.06, 2.4, cStraw.clone().offsetHSL(0, 0, -0.06), 0);
    }
    // 石碾：碾盘 + 躺在盘上的石磙
    const px = -r * 0.15;
    const pz = r * 0.28;
    put(RES.cyl10, b, px, 0.16, pz, 2.3, 0.2, 2.3, cStone, 0);
    put(RES.cyl10, b, px, 0.46, pz, 0.95, 0.5, 0.95, cStone.clone().offsetHSL(0, 0, 0.05), 0);
    put(RES.cyl8, b, px + 0.62, 0.42, pz, 0.7, 1.35, 0.7, cStone.clone().offsetHSL(0, 0, 0.09), 0, Math.PI * 0.5);
    put(RES.box, b, px + 0.62, 0.42, pz, 0.1, 0.1, 1.5, cWood, 0);
    // 摊开晒的谷子：几片浅黄
    for (let i = 0; i < 4; i++) {
      const a = rand() * 6.28;
      const rr = r * (0.25 + rand() * 0.4);
      const gw = 1.6 + rand() * 0.9;
      const gd = 1.2 + rand() * 0.7;
      const grot = rand();
      tGrain.push([x + Math.cos(a) * rr, z + Math.sin(a) * rr, gw, gd, grot]);
      put(RES.cyl10, b, Math.cos(a) * rr, 0.13, Math.sin(a) * rr,
        gw, 0.03, gd,
        cStraw.clone().offsetHSL(0.01, 0.05, 0.06), grot);
    }
    marks.push({ kind: 'thresh', x: x, z: z, rot: 0, r: r, hay: tHay, roller: [x + px, z + pz], grain: tGrain });
  }

  // 沿实际支路留出行走与避雨通道，不能只避开屋子的中心。
  function nearSpur(x, z, pad) {
    for (const hi of houses) {
      const pts = hi.spur && hi.spur.pts;
      if (!pts) continue;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < hi.spur.half + pad) return true;
      }
    }
    return false;
  }

  // ---------- 新添的农家小景：菜篮、靠墙农具、晒席 ----------
  // 体量保持在院角或屋背，不侵占门前通道；仍并入唯一的静态 props mesh。
  const detailRand = lcg(20261110);
  function produceBasket(hi, lx, lz, leafy) {
    const p = local(hi).px(lx, lz);
    const b = { x: p.x, y: field.sample(p.x, p.z), z: p.z, rot: hi.rot };
    const cBasket = cStraw.clone().offsetHSL(0, -0.06, -0.08);
    put(RES.basket, b, 0, 0.015, 0, 0.78, 0.41, 0.78, cBasket, 0);
    // Narrow woven courses follow the widening body; the mouth stays open.
    for (let k = 0; k < 3; k++) {
      const w = [0.62, 0.686, 0.744][k];
      put(RES.band, b, 0, 0.12 + k * 0.10, 0, w, 0.018, w, cStraw, 0);
    }
    for (let k = 0; k < 7; k++) {
      const a = k * Math.PI * 2 / 7;
      const r = k % 2 === 0 ? 0.21 : 0.12;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const color = leafy ? cGreen.clone().offsetHSL(0, 0, (detailRand() - 0.5) * 0.1)
        : cStraw.clone().offsetHSL(0.02, 0.04, (detailRand() - 0.5) * 0.12);
      put(RES.ico, b, x, 0.44 + detailRand() * 0.04, z, 0.23, 0.17, 0.22, color, detailRand() * 6.28);
    }
    marks.push({ kind: 'basket', x: p.x, z: p.z, r: 0.4 });
  }

  function leaningTools(hi) {
    const b = local(hi);
    const z = -hi.d * 0.5 - 0.32;
    // 靠背墙偏左；长杆从脚边朝墙内倾，不挡后窗和正门。
    for (let k = 0; k < 3; k++) {
      const x = -hi.w * 0.32 + k * 0.23;
      put(RES.box, b, x, 0.85, z, 0.045, 1.7 - k * 0.12, 0.045, cWood, 0, -0.14);
      if (k === 0) put(RES.box, b, x, 0.15, z + 0.08, 0.34, 0.24, 0.07, cStone, 0);
      if (k === 1) put(RES.box, b, x, 1.63, z - 0.10, 0.36, 0.055, 0.055, cWoodDark, 0);
      if (k === 2) put(RES.box, b, x, 0.18, z + 0.05, 0.26, 0.28, 0.055, cWoodDark, 0);
    }
  }

  function dryingMat(hi) {
    const p = local(hi).px(-0.9, -hi.d * 0.5 - 1.9);
    const b = { x: p.x, y: field.sample(p.x, p.z), z: p.z, rot: hi.rot };
    // 一张低矮的竹席，谷粒稀疏摊开，能跨过去，不额外改变碰撞范围。
    put(RES.box, b, 0, 0.035, 0, 1.7, 0.07, 1.15, cStraw.clone().offsetHSL(0, -0.09, 0.05), 0);
    for (let k = 0; k < 9; k++) {
      put(RES.box, b, 0, 0.077, -0.49 + k * 0.12, 1.63, 0.012, 0.025,
        cWood.clone().offsetHSL(0, -0.09, 0.08), 0);
    }
    for (let k = 0; k < 12; k++) {
      put(RES.ico, b, (detailRand() - 0.5) * 1.4, 0.11, (detailRand() - 0.5) * 0.9,
        0.12, 0.055, 0.12, cStraw.clone().offsetHSL(0.02, 0.04, (detailRand() - 0.5) * 0.1), 0);
    }
    marks.push({ kind: 'drying-mat', x: p.x, z: p.z, w: 1.7, d: 1.15 });
  }

  // ---- 布置 ----
  for (let i = 0; i < houses.length; i++) {
    const hi = houses[i];
    facade(hi);
    if (i % 2 === 0) hanging(hi);
    if (i % 2 === 0) fence(hi, hi.w * 0.5 + 1.1, hi.d * 0.5 + 1.9, cWood.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.05));
    vat(hi, -1.25 - rand() * 0.4, hi.d * 0.5 + 0.75);
    if (i % 2 === 1) garden(hi, 2.6 + rand() * 0.4, hi.d * 0.5 + 2.2, 2.4, 2.2);
    if (i % 3 === 2) woodpile(hi, 1.9 + rand() * 0.5, -hi.d * 0.5 - 0.9);
    if (i % 3 === 0) jars(hi, 1.0 + rand() * 0.3, hi.d * 0.5 + 0.9);
    if (i % 3 === 1) bench(hi, -1.9 - rand() * 0.3, hi.d * 0.5 + 1.5);
    if (i === 2) clothesLine(hi, 0, -hi.d * 0.5 - 1.8);
    if (i === 4) coop(hi, 2.2, -hi.d * 0.5 - 1.3);
    // 每家都有门侧菜篮；背墙交替出现靠墙农具与晒席，避免复制同一个院子。
    produceBasket(hi, -hi.w * 0.34, hi.d * 0.5 + 0.82, i % 3 !== 0);
    if (i % 2 === 0) leaningTools(hi);
    if (i % 3 === 1 && i !== 4) dryingMat(hi);
  }

  // 石磨放在第二块田边，水井在村口路边
  if (houses.length > 3) mill(houses[3], 2.3, -houses[3].d * 0.5 - 1.2);
  const wp = road.at(road.total * 0.47);
  well(wp.x + wp.nx * 3.4, wp.z + wp.nz * 3.4);
  // 晒谷场：村子中段靠田的一侧
  thresh(44, -128, 6.4);

  // ---------- 村道两旁的散件 ----------
  // 11 栋房子铺在 176m 的村道上，屋与屋之间全是草坪，村子才显得空。
  // 沿路两侧每隔几米补一件农家常物：篱笆、菜畦、草垛、柴堆、石堆、花丛。
  const dressSpots = [];
  function fenceSeg(x, z, ang, len) {
    const b = { x: x, y: field.sample(x, z), z: z, rot: ang };
    const n = Math.max(2, Math.round(len / 0.95));
    for (let i = 0; i <= n; i++) {
      const lz = -len * 0.5 + (len * i) / n;
      put(RES.box, b, 0, 0.42, lz, 0.08, 0.84, 0.08,
        cWood.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.07), rand() * 0.2);
    }
    for (let r = 0; r < 2; r++) {
      put(RES.box, b, 0, 0.3 + r * 0.3, 0, 0.05, 0.07, len, cWood, 0);
    }
    marks.push({ kind: 'fence', x: x, z: z, rot: ang, halfW: 0.5, front: len * 0.5, back: -len * 0.5, gap: 0 });
  }

  function bedPatch(x, z, ang, w, d) {
    const b = { x: x, y: field.sample(x, z), z: z, rot: ang };
    put(RES.box, b, 0, 0.07, 0, w, 0.14, d, cSoil, 0);
    const rows = Math.max(2, Math.round(d / 0.62));
    for (let r = 0; r < rows; r++) {
      const lz = -d * 0.5 + (d * (r + 0.5)) / rows;
      for (let k = 0; k < 3; k++) {
        const lx = (k - 1) * (w / 3.3);
        const rr = 0.15 + rand() * 0.07;
        put(RES.ico, b, lx, 0.24 + rr * 0.4, lz, rr * 2, rr * 1.6, rr * 2,
          cGreen.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.09), rand() * 3);
      }
    }
    marks.push({ kind: 'fence', x: x, z: z, rot: ang, halfW: w * 0.5, front: d * 0.5, back: -d * 0.5, gap: 0 });
    dressSpots.push([x, z, Math.max(w, d) * 0.5]);
  }

  function haystack(x, z, rr, hh) {
    // 避开村口待客宴席（22, -60），视觉草垛顺移至西侧开阔草地，保持 dressSpots 与随机序列严丝合缝。
    const hx = Math.hypot(x - 22, z + 60) < 2.6 ? 18.6 : x;
    const hz = Math.hypot(x - 22, z + 60) < 2.6 ? -58.2 : z;
    const b = { x: hx, y: field.sample(hx, hz), z: hz, rot: rand() * 6.28 };
    // One shouldered, softly gathered stack, inside the old cone footprint.
    put(RES.hay, b, 0, 0, 0, rr * 2.2, hh + rr * 1.15, rr * 2.2, cStraw, 0);
    dressSpots.push([x, z, rr + 0.6]);
  }

  function woodStack(x, z, ang) {
    const b = { x: x, y: field.sample(x, z), z: z, rot: ang };
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3 - r; k++) {
        put(RES.cyl8, b, (k - (2 - r) * 0.5) * 0.26, 0.12 + r * 0.21, 0, 0.24, 1.45, 0.24,
          cWood.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.1), 0, Math.PI / 2);
      }
    }
    dressSpots.push([x, z, 0.9]);
  }

  function stonePile(x, z, n) {
    for (let i = 0; i < n; i++) {
      const rr = 0.22 + rand() * 0.26;
      put(RES.ico, { x: x, y: field.sample(x, z), z: z, rot: 0 },
        (rand() - 0.5) * 1.1, rr * 0.55, (rand() - 0.5) * 1.1,
        rr * 2, rr * 1.4, rr * 2, cStone.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.08), rand() * 3);
    }
    dressSpots.push([x, z, 0.9]);
  }

  function bushPatch(x, z, n) {
    const y = field.sample(x, z);
    for (let i = 0; i < n; i++) {
      const rr = 0.34 + rand() * 0.3;
      const ox = (rand() - 0.5) * 1.6;
      const oz = (rand() - 0.5) * 1.6;
      put(RES.ico, { x: x, y: y, z: z, rot: 0 },
        ox, rr * 0.85, oz, rr * 2, rr * 1.5, rr * 2,
        cLeaf[i % 3].clone().offsetHSL(0, 0, (rand() - 0.5) * 0.08), rand() * 3);
      if (i % 3 === 1) {
        put(RES.ico, { x: x, y: y, z: z, rot: 0 },
          ox + 0.1, rr * 1.7, oz - 0.1, rr * 0.7, rr * 0.6, rr * 0.7, cBloom, rand() * 3);
      }
    }
    dressSpots.push([x, z, 0.8]);
  }

  (function roadDress() {
    const steps = 30;
    for (let i = 1; i < steps; i++) {
      const p0 = road.at(road.total * i / steps);
      const p1 = road.at(road.total * (i + 0.4) / steps);
      const ang = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      for (let sd = -1; sd <= 1; sd += 2) {
        if (rand() < 0.3) continue;
        const off = 4.4 + rand() * 3.6;
        const x = p0.x + p0.nx * off * sd;
        const z = p0.z + p0.nz * off * sd;
        let bad = nearSpur(x, z, 2.5) || field.sample(x, z) < 0.6;
        for (let k = 0; k < plots.length && !bad; k++) {
          if (Math.hypot(x - plots[k][0], z - plots[k][1]) < 6.2) bad = true;
        }
        for (let k = 0; k < houses.length && !bad; k++) {
          const hi = houses[k];
          if (Math.hypot(x - hi.x, z - hi.z) < Math.hypot(hi.w, hi.d) * 0.5 + 2.4) bad = true;
        }
        for (let k = 0; k < marks.length && !bad; k++) {
          const m = marks[k];
          if (m.kind === 'well' || m.kind === 'mill' || m.kind === 'thresh') {
            if (Math.hypot(x - m.x, z - m.z) < (m.r || 2) + 2.2) bad = true;
          }
        }
        if (bad) continue;
        const roll = rand();
        if (roll < 0.3) fenceSeg(x, z, ang, 3.0 + rand() * 1.8);
        else if (roll < 0.55) bedPatch(x, z, ang, 2.2 + rand() * 0.9, 1.6 + rand() * 0.9);
        else if (roll < 0.7) haystack(x, z, 0.55 + rand() * 0.3, 0.9 + rand() * 0.5);
        else if (roll < 0.82) woodStack(x, z, ang);
        else if (roll < 0.92) stonePile(x, z, 3 + Math.floor(rand() * 3));
        else bushPatch(x, z, 2 + Math.floor(rand() * 3));
      }
    }
  })();

  // 杂树：沿村道两侧与屋后空地撒，避开屋子、篱笆院、田、场院、路和井磨
  (function plantTrees() {
    const roadPts = [];
    for (let i = 0; i <= 40; i++) {
      const p = road.at(road.total * i / 40);
      roadPts.push([p.x, p.z]);
    }
    function distPoly(x, z, pts) {
      let best = 1e9;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0];
        const az = pts[i][1];
        const vx = pts[i + 1][0] - ax;
        const vz = pts[i + 1][1] - az;
        const L = vx * vx + vz * vz || 1;
        let t = ((x - ax) * vx + (z - az) * vz) / L;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
        if (d < best) best = d;
      }
      return best;
    }
    function inBox(m, x, z, pad) {
      const a = m.rot || 0;
      const dx = x - m.x;
      const dz = z - m.z;
      const lu = dx * Math.cos(a) - dz * Math.sin(a);
      const lv = dx * Math.sin(a) + dz * Math.cos(a);
      if (m.kind === 'fence') {
        return Math.abs(lu) < m.halfW + pad && lv > m.back - pad && lv < m.front + pad;
      }
      return false;
    }
    const wells = marks.filter(function (m) { return m.kind === 'well' || m.kind === 'mill' || m.kind === 'thresh'; });
    const fences = marks.filter(function (m) { return m.kind === 'fence'; });
    const placed = [];
    let tries = 0;
    while (placed.length < 40 && tries < 9000) {
      tries++;
      const x = 18.5 + rand() * 29.5;
      const z = -38 - rand() * 176;
      if (field.sample(x, z) < 0.6) continue;
      // 屋子与院子
      let bad = false;
      for (let i = 0; i < houses.length && !bad; i++) {
        const hi = houses[i];
        const rr = Math.hypot(hi.w, hi.d) * 0.5 + 2.1;
        if (Math.hypot(x - hi.x, z - hi.z) < rr) bad = true;
      }
      if (bad) continue;
      for (let i = 0; i < fences.length && !bad; i++) {
        if (inBox(fences[i], x, z, 0.6)) bad = true;
      }
      if (bad) continue;
      // 田、场院、井磨
      for (let i = 0; i < plots.length && !bad; i++) {
        if (Math.hypot(x - plots[i][0], z - plots[i][1]) < 5.2) bad = true;
      }
      if (bad) continue;
      for (let i = 0; i < wells.length && !bad; i++) {
        const m = wells[i];
        const rr = m.kind === 'thresh' ? m.r + 2.4 : 2.6;
        if (Math.hypot(x - m.x, z - m.z) < rr) bad = true;
      }
      if (bad) continue;
      // 路与既有树
      if (distPoly(x, z, roadPts) < 5.6 || nearSpur(x, z, 2.0)) continue;
      let near = false;
      for (let i = 0; i < placed.length; i++) {
        if (Math.hypot(x - placed[i][0], z - placed[i][1]) < 5.2) { near = true; break; }
      }
      if (near) continue;
      for (let i = 0; i < dressSpots.length; i++) {
        if (Math.hypot(x - dressSpots[i][0], z - dressSpots[i][1]) < dressSpots[i][2] + 1.5) { near = true; break; }
      }
      if (near) continue;
      placed.push([x, z]);
      const h = 3.6 + rand() * 2.6;
      const r = 1.0 + rand() * 0.95;
      const blossom = placed.length % 6 === 0;
      tree(x, z, h, r, blossom ? cLeaf[2] : cLeaf[Math.floor(rand() * 3)], blossom);
    }
  })();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sk.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(sk.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(sk.col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'village-props';
  const group = new THREE.Group();
  group.name = 'props';
  group.add(mesh);
  return { group: group, tris: sk.pos.length / 9, marks: marks };
}