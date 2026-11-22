import * as THREE from 'three';
import {
  mergeColoredParts,
  part,
  ringGeometry,
  makeHead,
  makeHat,
  makeShoe,
  surfaceBand,
  fitRing
} from '../character-parts.js';

const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
const _up = new THREE.Vector3(0, 1, 0);

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / ((e1 - e0) || 1));
  return t * t * (3 - 2 * t);
}

function shiftHSL(hex, dh = 0, ds = 0, dl = 0) {
  const c = new THREE.Color(hex);
  c.getHSL(_hsl);
  c.setHSL((_hsl.h + dh + 1) % 1, clamp01(_hsl.s + ds), clamp01(_hsl.l + dl));
  return c;
}

function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

// 顶点晕染环截面：保留单批无贴图绘制，同时根据高度、法线与方位赋予手绘青衫/竹器明暗。
function shadedRingGeometry(rings, sides, baseColor, shadeFn, caps = true) {
  const geo = ringGeometry(rings, sides, caps);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const base = new THREE.Color(baseColor);
  base.getHSL(_hsl);
  const bh = _hsl.h;
  const bs = _hsl.s;
  const bl = _hsl.l;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const mod = shadeFn ? shadeFn(x, y, z, nx, ny, nz) : 0;
    if (mod && typeof mod === 'object') {
      _c.setHSL(
        (bh + (mod.dh || 0) + 1) % 1,
        clamp01(bs + (mod.ds || 0)),
        clamp01(bl + (mod.dl || 0))
      );
    } else {
      _c.setHSL(bh, bs, clamp01(bl + (Number(mod) || 0)));
    }
    colors[i * 3] = clamp01(_c.r);
    colors[i * 3 + 1] = clamp01(_c.g);
    colors[i * 3 + 2] = clamp01(_c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

// 贴合环截面的立体衣褶/竖篾棱条（双斜面隆起、两侧微埋入基底，保证所有法线严格朝外且不浮空）。
function sculptedSurfaceRidge(rings, opts) {
  const {
    yTop,
    yBot,
    aTop,
    aBot = aTop,
    wTop,
    wBot = wTop,
    crestTop,
    crestBot = crestTop,
    steps = 8,
    taperTop = false,
    taperBot = false,
    crestColor,
    edgeColor = crestColor
  } = opts;

  const positions = [];
  const rawColors = [];
  const cCrest = new THREE.Color(crestColor);
  const cEdge = new THREE.Color(edgeColor);

  function sampleRow(t) {
    const y = yTop + (yBot - yTop) * t;
    const a = aTop + (aBot - aTop) * t;
    const w = wTop + (wBot - wTop) * t;
    let env = 1;
    if (taperTop) env *= smoothstep(0, 0.22, t);
    if (taperBot) env *= 1 - smoothstep(0.80, 1, t);
    const crest = (crestTop + (crestBot - crestTop) * t) * (0.18 + 0.82 * env);
    const r = fitRing(rings, y);
    const rr = Math.hypot(r.rx, r.rz) || 1;
    const da = (w * 0.5) / rr;
    const sink = -0.0012;
    return {
      L: [Math.sin(a - da) * (r.rx + sink), y, Math.cos(a - da) * (r.rz + sink)],
      M: [Math.sin(a) * (r.rx + crest), y, Math.cos(a) * (r.rz + crest)],
      R: [Math.sin(a + da) * (r.rx + sink), y, Math.cos(a + da) * (r.rz + sink)]
    };
  }

  function pushTri(p1, c1, p2, c2, p3, c3) {
    positions.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
    rawColors.push(c1.r, c1.g, c1.b, c2.r, c2.g, c2.b, c3.r, c3.g, c3.b);
  }

  for (let i = 0; i < steps; i++) {
    const r0 = sampleRow(i / steps);
    const r1 = sampleRow((i + 1) / steps);
    pushTri(r0.L, cEdge, r1.L, cEdge, r0.M, cCrest);
    pushTri(r0.M, cCrest, r1.L, cEdge, r1.M, cCrest);
    pushTri(r0.M, cCrest, r1.M, cCrest, r0.R, cEdge);
    pushTri(r0.R, cEdge, r1.M, cCrest, r1.R, cEdge);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(rawColors, 3));
  geo.computeVertexNormals();
  return geo;
}

// 环绕衣身的闭合立体斜挎肩带：顺应圆融左肩弧面翻越至右胯束带，平滑贴体零折角。
function strapHeightAtAngle(a) {
  return 1.236 - 0.214 * Math.sin(a) - 0.008 * Math.cos(a);
}

function closedTorsoStrap(rings, cfg) {
  const steps = 36;
  const hw = 0.0160;
  const thick = 0.0068;
  const cOuter = shiftHSL(cfg.sash, -0.006, 0.02, 0.02);
  const cSide = shiftHSL(cfg.sash, -0.01, 0.02, -0.08);
  const pts = [];
  const nrms = [];

  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const y = strapHeightAtAngle(a);
    const r = fitRing(rings, y);
    const rUp = fitRing(rings, Math.min(1.488, y + 0.010));
    const rDn = fitRing(rings, Math.max(0.795, y - 0.010));
    const dy = (rUp.y - rDn.y) || 0.020;
    const drx = (rUp.rx - rDn.rx) / dy;
    const drz = (rUp.rz - rDn.rz) / dy;

    const sashClear = (1 - smoothstep(1.008, 1.078, y)) * 0.0085;
    const collarClear = Math.max(0, ca) * smoothstep(1.09, 1.19, y) * (1 - smoothstep(1.37, 1.47, y)) * 0.0055;
    const off = 0.0020 + sashClear + collarClear;

    pts.push(new THREE.Vector3(sa * (r.rx + off), y, ca * (r.rz + off)));
    const dSa = new THREE.Vector3(ca * r.rx, 0, -sa * r.rz);
    const dSy = new THREE.Vector3(sa * drx, 1, ca * drz);
    nrms.push(new THREE.Vector3().crossVectors(dSa, dSy).normalize());
  }

  const rings4 = [];
  for (let i = 0; i < steps; i++) {
    const prev = pts[(i - 1 + steps) % steps];
    const next = pts[(i + 1) % steps];
    const T = new THREE.Vector3().subVectors(next, prev).normalize();
    const N = nrms[i];
    const B = new THREE.Vector3().crossVectors(T, N).normalize();
    const P = pts[i];
    rings4.push([
      P.clone().addScaledVector(B, -hw).addScaledVector(N, -0.003),
      P.clone().addScaledVector(B, -hw * 0.86).addScaledVector(N, thick),
      P.clone().addScaledVector(B, hw * 0.86).addScaledVector(N, thick),
      P.clone().addScaledVector(B, hw).addScaledVector(N, -0.003)
    ]);
  }

  const positions = [];
  const colors = [];
  function emitQuad(a, b, c, d, col) {
    positions.push(
      a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z,
      b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z
    );
    for (let k = 0; k < 6; k++) colors.push(col.r, col.g, col.b);
  }

  for (let i = 0; i < steps; i++) {
    const cur = rings4[i];
    const nxt = rings4[(i + 1) % steps];
    emitQuad(cur[0], cur[1], nxt[0], nxt[1], cSide);
    emitQuad(cur[1], cur[2], nxt[1], nxt[2], cOuter);
    emitQuad(cur[2], cur[3], nxt[2], nxt[3], cSide);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// 顺应后裙弧度自然垂落的立体腰带垂绅（尾端设双采样硬边织锦镶头，利落分明不糊色）。
function drapedRearSashTail(rings, opts) {
  const {
    x0, y0, x1, y1,
    w0 = 0.022, w1 = 0.028,
    off0 = 0.015, off1 = 0.0085,
    thick = 0.005,
    bodyColor,
    tipColor
  } = opts;

  const cBody = new THREE.Color(bodyColor);
  const cSide = shiftHSL(bodyColor, 0, 0.02, -0.07);
  const cTip = new THREE.Color(tipColor);

  const stops = [
    [0.00, cBody],
    [0.18, cBody],
    [0.42, cBody],
    [0.64, cBody],
    [0.82, cBody],
    [0.825, cTip],
    [0.92, cTip],
    [1.00, cTip]
  ];

  const rows = stops.map(([t, col]) => {
    const tipTaper = t > 0.88 ? Math.max(0.24, 1 - (t - 0.88) / 0.12 * 0.76) : 1;
    const hw = (w0 + (w1 - w0) * t) * 0.5 * tipTaper;
    const x = x0 + (x1 - x0) * t + (x1 >= x0 ? 1 : -1) * 0.003 * Math.sin(t * Math.PI);
    const y = y0 + (y1 - y0) * t - (t === 1 ? 0.005 : 0);
    const r = fitRing(rings, y);
    const off = off0 + (off1 - off0) * smoothstep(0, 0.36, t) + 0.002 * Math.sin(t * Math.PI * 1.3);
    const zAt = (px, extra) => {
      const ratio = Math.min(0.94, Math.abs(px) / (r.rx || 1));
      return -r.rz * Math.sqrt(1 - ratio * ratio) - extra;
    };
    return {
      col,
      pts: [
        new THREE.Vector3(x + hw, y, zAt(x + hw, off - thick * 0.35)),
        new THREE.Vector3(x + hw * 0.9, y, zAt(x + hw * 0.9, off + thick)),
        new THREE.Vector3(x - hw * 0.9, y, zAt(x - hw * 0.9, off + thick)),
        new THREE.Vector3(x - hw, y, zAt(x - hw, off - thick * 0.35))
      ]
    };
  });

  const positions = [];
  const colors = [];
  function quad(a, b, c, d, c0, c1) {
    positions.push(
      a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z,
      b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z
    );
    colors.push(
      c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c0.r, c0.g, c0.b,
      c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c1.r, c1.g, c1.b
    );
  }

  for (let i = 0; i < rows.length - 1; i++) {
    const r0 = rows[i];
    const r1 = rows[i + 1];
    quad(r0.pts[0], r0.pts[1], r1.pts[0], r1.pts[1], cSide, cSide);
    quad(r0.pts[1], r0.pts[2], r1.pts[1], r1.pts[2], r0.col, r1.col);
    quad(r0.pts[2], r0.pts[3], r1.pts[2], r1.pts[3], cSide, cSide);
  }
  const end = rows[rows.length - 1].pts;
  positions.push(
    end[0].x, end[0].y, end[0].z, end[3].x, end[3].y, end[3].z, end[1].x, end[1].y, end[1].z,
    end[1].x, end[1].y, end[1].z, end[3].x, end[3].y, end[3].z, end[2].x, end[2].y, end[2].z
  );
  for (let k = 0; k < 6; k++) colors.push(cTip.r, cTip.g, cTip.b);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// 后脑束发贴合发壳：补齐后枕隆起处的乌发包裹、梳拢发纹与后颈燕尾发际。
function makeRearHairCap(hairHex) {
  const occiput = [
    { y: -0.082, rx: 0.084, rz: 0.072 },
    { y: -0.048, rx: 0.105, rz: 0.090 },
    { y: -0.004, rx: 0.115, rz: 0.098 },
    { y: 0.044, rx: 0.117, rz: 0.100 },
    { y: 0.094, rx: 0.106, rz: 0.090 }
  ];
  const positions = [];
  const colors = [];
  const cMain = new THREE.Color(hairHex);
  const cSheen = shiftHSL(hairHex, -0.01, 0.02, 0.032);
  const cNape = shiftHSL(hairHex, 0, 0, -0.035);
  const stepsA = 10;
  const a0 = Math.PI * 0.54;
  const a1 = Math.PI * 1.46;

  function pt(ri, ti) {
    const u = ti / stepsA;
    const a = a0 + (a1 - a0) * u;
    const r = occiput[ri];
    const napeArch = ri === 0 ? Math.cos((u - 0.5) * Math.PI) * -0.012 : 0;
    const comb = ri >= 1 && ri <= 3 ? Math.cos(u * Math.PI * 6) * 0.0018 : 0;
    return [Math.sin(a) * (r.rx + 0.0022 + comb), r.y + napeArch, Math.cos(a) * (r.rz + 0.0022 + comb)];
  }

  for (let ri = 0; ri < occiput.length - 1; ri++) {
    const col0 = ri === 0 ? cNape : (ri === 2 ? cSheen : cMain);
    const col1 = ri + 1 === 2 ? cSheen : cMain;
    for (let ti = 0; ti < stepsA; ti++) {
      const a = pt(ri, ti), b = pt(ri, ti + 1);
      const c = pt(ri + 1, ti), d = pt(ri + 1, ti + 1);
      positions.push(...a, ...b, ...c, ...b, ...d, ...c);
      colors.push(
        col0.r, col0.g, col0.b, col0.r, col0.g, col0.b, col1.r, col1.g, col1.b,
        col0.r, col0.g, col0.b, col1.r, col1.g, col1.b, col1.r, col1.g, col1.b
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// 连接任意两点的圆柱绳段/竹竿段，零角度误差。
function segmentPart(parts, color, x1, y1, z1, x2, y2, z2, r1, r2 = r1, radialSegs = 5) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return;
  const geo = new THREE.CylinderGeometry(r2, r1, len, radialSegs);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    _up,
    new THREE.Vector3(dx / len, dy / len, dz / len)
  );
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3((x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5),
    quat,
    new THREE.Vector3(1, 1, 1)
  );
  parts.push({ geo, color, matrix, keepColor: false });
}

function sagCord(parts, color, x1, y1, z1, x2, y2, z2, radius, sag = 0.012, segs = 3) {
  let px = x1, py = y1, pz = z1;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const dip = Math.sin(t * Math.PI) * sag;
    const nx = x1 + (x2 - x1) * t;
    const ny = y1 + (y2 - y1) * t - dip;
    const nz = z1 + (z2 - z1) * t - dip * 0.28;
    segmentPart(parts, color, px, py, pz, nx, ny, nz, radius, radius, 5);
    px = nx;
    py = ny;
    pz = nz;
  }
}

// 精编竹斗笠附加细部（与 makeHat 完全同源缩放 + 8°后仰错切矩阵，严丝合缝贴合笠面）。
function makeHatCraftAccents(cfg, size = 1.02) {
  const hp = [];
  const crown = [
    { y: 0.104, rx: 0.250, rz: 0.250 },
    { y: 0.126, rx: 0.234, rz: 0.234 },
    { y: 0.170, rx: 0.152, rz: 0.152 },
    { y: 0.212, rx: 0.062, rz: 0.062 },
    { y: 0.246, rx: 0.014, rz: 0.014 }
  ];

  // 1. 三道同心细竹箍：外檐包边箍 + 中坡竹箍 + 上坡束顶箍
  const hoopSpecs = [
    { y: 0.104, r: 0.2515, tube: 0.0050 },
    { y: 0.168, r: 0.1555, tube: 0.0044 },
    { y: 0.206, r: 0.0745, tube: 0.0040 }
  ];
  for (const h of hoopSpecs) {
    part(hp, new THREE.TorusGeometry(h.r, h.tube, 5, 16), cfg.hatBand, 0, h.y, 0, 1, 1, 1, Math.PI / 2, 0, 0);
  }

  // 2. 放射状细竹骨篾筋（俯视近看有清晰编织骨架感）
  const ribCol = shiftHSL(cfg.hat, -0.01, 0.02, -0.11);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    part(hp, surfaceBand(crown, 0.238, a, 0.107, a, 0.0075, 0.0022, 4), ribCol);
  }

  // 3. 笠顶竹宝顶（温润熟竹色雕竹笠顶结）
  const finialBamboo = shiftHSL(cfg.hat, -0.016, 0.06, -0.16);
  part(hp, ringGeometry([
    { y: 0.232, rx: 0.036, rz: 0.036 },
    { y: 0.247, rx: 0.019, rz: 0.019 }
  ], 10, false), cfg.hatBand);
  part(hp, new THREE.TorusGeometry(0.0185, 0.0038, 4, 10), finialBamboo, 0, 0.247, 0, 1, 1, 1, Math.PI / 2, 0, 0);
  part(hp, ringGeometry([
    { y: 0.246, rx: 0.016, rz: 0.016 },
    { y: 0.258, rx: 0.019, rz: 0.019 },
    { y: 0.271, rx: 0.009, rz: 0.009 },
    { y: 0.278, rx: 0.002, rz: 0.002 }
  ], 8), finialBamboo);

  const geo = mergeColoredParts(hp);
  if (size !== 1) geo.scale(size, size, size);
  geo.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0.145, 0, 0, 0, 1, 0, 0, 0, 0, 1));
  return geo;
}

// 玩家保留五批绘制；肩线圆融自然，以青衫晕染、双层垂裾、精编竹笠、斜挎木扣、垂绅腰带、细编鱼篓与腰间小匏瓜塑造行者背影。
const TORSO = [
  { y: 0.792, rx: 0.250, rz: 0.164 },
  { y: 0.848, rx: 0.241, rz: 0.157 },
  { y: 0.935, rx: 0.207, rz: 0.136 },
  { y: 1.035, rx: 0.177, rz: 0.119 },
  { y: 1.165, rx: 0.184, rz: 0.121 },
  { y: 1.300, rx: 0.192, rz: 0.122 },
  { y: 1.395, rx: 0.212, rz: 0.116 },
  { y: 1.445, rx: 0.184, rz: 0.102 },
  { y: 1.472, rx: 0.130, rz: 0.084 },
  { y: 1.490, rx: 0.083, rz: 0.067 }
];

const CREEL_RINGS = [
  { y: 0.718, rx: 0.088, rz: 0.076 },
  { y: 0.794, rx: 0.136, rz: 0.116 },
  { y: 0.858, rx: 0.127, rz: 0.109 },
  { y: 0.922, rx: 0.084, rz: 0.074 },
  { y: 0.972, rx: 0.106, rz: 0.094 }
];

const GOURD_RINGS = [
  { y: -0.068, rx: 0.015, rz: 0.015 },
  { y: -0.052, rx: 0.038, rz: 0.038 },
  { y: -0.025, rx: 0.044, rz: 0.044 },
  { y: 0.002, rx: 0.033, rz: 0.033 },
  { y: 0.016, rx: 0.015, rz: 0.015 },
  { y: 0.034, rx: 0.029, rz: 0.029 },
  { y: 0.054, rx: 0.024, rz: 0.024 },
  { y: 0.069, rx: 0.010, rz: 0.010 }
];

function bodyGeometry(cfg) {
  const p = [];

  // 1. 双层曲裾下摆：内衬深青下摆 (clothes2) 自外袍浅青镶边 (collar) 之下利落露出
  part(p, shadedRingGeometry([
    { y: 0.758, rx: 0.244, rz: 0.158 },
    { y: 0.778, rx: 0.241, rz: 0.156 },
    { y: 0.800, rx: 0.236, rz: 0.152 }
  ], 12, cfg.clothes2, (_x, y, _z, _nx, ny) => {
    const underTuck = smoothstep(0.778, 0.798, y) * -0.045;
    const hemCrisp = (1 - smoothstep(0.758, 0.772, y)) * 0.018;
    const capDark = ny < -0.7 ? -0.06 : 0;
    return underTuck + hemCrisp + capDark;
  }), null);

  // 外袍下缘浅青镶边（曲裾裾缘）
  part(p, shadedRingGeometry([
    { y: 0.790, rx: 0.253, rz: 0.167 },
    { y: 0.814, rx: 0.248, rz: 0.163 }
  ], 12, cfg.collar, (_x, y, z) => {
    const edgeLift = (1 - smoothstep(0.790, 0.812, y)) * 0.02;
    const backSoft = z < 0 ? -0.012 : 0.008;
    return edgeLift + backSoft;
  }, false), null);

  // 主体青衫：肩头受光微暖提亮 (+0.04)，束腰褶聚微暗 (-0.05)，下摆柔暗过渡衬出浅边
  part(p, shadedRingGeometry(TORSO, 12, cfg.clothes, (x, y, z, _nx, ny) => {
    const sunShoulder = smoothstep(1.31, 1.45, y);
    const waistBell = Math.exp(-(((y - 1.032) / 0.048) ** 2));
    const lowerGather = (1 - smoothstep(0.81, 0.89, y)) * -0.022;
    const skyUp = Math.max(0, ny) * 0.018;
    const flankShade = Math.abs(x) > 0.16 && y > 1.08 && y < 1.32 ? -0.014 : 0;
    const backBlade = z < -0.07 && y > 1.20 && y < 1.36 ? 0.012 : 0;
    return {
      dh: -0.010 * sunShoulder,
      ds: 0.018 * sunShoulder - 0.012 * waistBell,
      dl: 0.042 * sunShoulder - 0.052 * waistBell + lowerGather + skyUp + flankShade + backBlade
    };
  }), null);

  // 背部中缝衣褶与后摆左右垂褶
  const pleatCrest = shiftHSL(cfg.clothes, -0.006, 0.01, 0.022);
  const pleatShadow = shiftHSL(cfg.clothes, 0.006, 0.02, -0.062);
  part(p, sculptedSurfaceRidge(TORSO, {
    yTop: 1.462, yBot: 1.064, aTop: Math.PI, aBot: Math.PI,
    wTop: 0.016, wBot: 0.020, crestTop: 0.0045, crestBot: 0.006,
    steps: 6, taperTop: true, taperBot: false,
    crestColor: pleatCrest, edgeColor: pleatShadow
  }), null);
  part(p, sculptedSurfaceRidge(TORSO, {
    yTop: 1.012, yBot: 0.800, aTop: Math.PI, aBot: Math.PI,
    wTop: 0.024, wBot: 0.036, crestTop: 0.0085, crestBot: 0.0115,
    steps: 6, taperTop: false, taperBot: true,
    crestColor: pleatCrest, edgeColor: pleatShadow
  }), null);
  for (const side of [-1, 1]) {
    part(p, sculptedSurfaceRidge(TORSO, {
      yTop: 1.008, yBot: 0.804,
      aTop: Math.PI + side * 0.27, aBot: Math.PI + side * 0.34,
      wTop: 0.020, wBot: 0.030, crestTop: 0.0065, crestBot: 0.0090,
      steps: 6, taperTop: false, taperBot: true,
      crestColor: pleatCrest, edgeColor: pleatShadow
    }), null);
  }

  // 交领右衽：12 边形同源护领圈 + 前胸 V 领与右衽斜襟
  part(p, ringGeometry([
    { y: 1.472, rx: 0.134, rz: 0.088 },
    { y: 1.492, rx: 0.087, rz: 0.071 }
  ], 12, false), cfg.collar);
  part(p, surfaceBand(TORSO, 1.462, 0.66, 1.212, 0.075, 0.026, 0.005), cfg.collar);
  part(p, surfaceBand(TORSO, 1.462, -0.66, 1.212, -0.075, 0.026, 0.005), cfg.collar);
  part(p, surfaceBand(TORSO, 1.212, 0.075, 1.090, 0.395, 0.026, 0.005), cfg.collar);

  // 腰封束带与中线编绳压条
  part(p, shadedRingGeometry([
    { y: 1.010, rx: 0.184, rz: 0.126 },
    { y: 1.038, rx: 0.188, rz: 0.130 },
    { y: 1.066, rx: 0.186, rz: 0.128 }
  ], 12, cfg.sash, (_x, y) => {
    return Math.abs(y - 1.038) < 0.012 ? 0.024 : -0.022;
  }), null);
  part(p, ringGeometry([
    { y: 1.033, rx: 0.190, rz: 0.1315 },
    { y: 1.043, rx: 0.190, rz: 0.1315 }
  ], 12, false), cfg.hatBand);

  // 正面腰结与短垂带
  part(p, new THREE.BoxGeometry(0.040, 0.026, 0.020), cfg.sash, 0.019, 1.04, 0.146);
  part(p, new THREE.BoxGeometry(0.022, 0.148, 0.013), cfg.sash, 0.040, 0.950, 0.150, 1, 1, 1, 0, 0, -0.1);

  // 3. 后腰绅带结 (z ≈ -0.132, y ≈ 1.038) 与两条不对称斜垂飘带
  const sashKnotCore = shiftHSL(cfg.sash, -0.008, 0.03, -0.05);
  const sashLoopCol = shiftHSL(cfg.sash, 0.004, 0.02, 0.04);
  const sashTailLong = shiftHSL(cfg.sash, -0.012, 0.04, -0.055);
  const sashTailShort = shiftHSL(cfg.sash, 0.004, 0.02, -0.025);
  const sashTipTrim = shiftHSL(cfg.collar, -0.02, -0.03, -0.05);
  part(p, new THREE.BoxGeometry(0.044, 0.030, 0.018), sashLoopCol, 0, 1.038, -0.133);
  part(p, new THREE.BoxGeometry(0.020, 0.036, 0.022), sashKnotCore, 0, 1.038, -0.136);
  for (const side of [-1, 1]) {
    part(p, new THREE.SphereGeometry(1, 6, 4), sashLoopCol, side * 0.026, 1.040, -0.133, 0.015, 0.013, 0.010, 0, 0, side * 0.25);
  }
  part(p, drapedRearSashTail(TORSO, {
    x0: -0.011, y0: 1.028, x1: -0.052, y1: 0.838,
    w0: 0.022, w1: 0.028, off0: 0.014, off1: 0.009,
    bodyColor: sashTailLong, tipColor: sashTipTrim
  }), null);
  part(p, drapedRearSashTail(TORSO, {
    x0: 0.011, y0: 1.028, x1: 0.045, y1: 0.886,
    w0: 0.020, w1: 0.025, off0: 0.013, off1: 0.0085,
    bodyColor: sashTailShort, tipColor: sashTipTrim
  }), null);

  // 闭合斜挎肩带（左肩至右胯）与背部雕木系扣
  part(p, closedTorsoStrap(TORSO, cfg), null);
  const buckleAngle = Math.PI + 0.34;
  const buckleY = strapHeightAtAngle(buckleAngle);
  const buckleR = fitRing(TORSO, buckleY);
  const bx = Math.sin(buckleAngle) * (buckleR.rx + 0.008);
  const bz = Math.cos(buckleAngle) * (buckleR.rz + 0.008);
  const buckleWood = shiftHSL(cfg.hatBand, -0.008, 0.04, -0.02);
  const togglePinWood = shiftHSL(cfg.hat, -0.016, 0.06, -0.15);
  part(p, new THREE.BoxGeometry(0.044, 0.032, 0.011), buckleWood, bx, buckleY, bz, 1, 1, 1, 0.05, -0.28, 0.62);
  part(p, new THREE.CylinderGeometry(0.0058, 0.0058, 0.054, 6), togglePinWood, bx - 0.002, buckleY, bz - 0.006, 1, 1, 1, 0.05, -0.28, -0.95);
  part(p, new THREE.BoxGeometry(0.014, 0.018, 0.014), cfg.sash, bx - 0.001, buckleY, bz - 0.005, 1, 1, 1, 0.05, -0.28, 0.62);

  // 头部、后脑乌发补壳与精编竹斗笠（保持 (0, 1.605, 0) 原位）
  const head = makeHead({
    skin: cfg.skin, hair: cfg.hair, elderHair: cfg.hair,
    sash: cfg.sash, hatBand: cfg.hatBand, jade: cfg.clothes2, mouth: cfg.hatBand,
    eye: cfg.eye, lip: cfg.lip, earShade: cfg.earShade
  });
  part(p, head, null, 0, 1.605, 0);
  part(p, makeRearHairCap(cfg.hair), null, 0, 1.605, 0);
  part(p, makeHat(cfg, 1.02), null, 0, 1.605, 0);
  part(p, makeHatCraftAccents(cfg, 1.02), null, 0, 1.605, 0);

  // 斗笠颌下双耳 Y 字麻绳系带与颏下绳结（贴着耳后与两颊外沿自然收拢至下巴外侧）
  const cordHemp = shiftHSL(cfg.hatBand, 0, -0.02, -0.04);
  for (const side of [-1, 1]) {
    // 耳后斜拉支绳
    segmentPart(p, cordHemp, side * 0.116, 1.694, -0.024, side * 0.096, 1.536, -0.003, 0.0028, 0.0028, 5);
    segmentPart(p, cordHemp, side * 0.096, 1.536, -0.003, side * 0.075, 1.492, 0.036, 0.0028, 0.0027, 5);
    // 鬓前贴颊主绳
    segmentPart(p, cordHemp, side * 0.098, 1.698, 0.032, side * 0.094, 1.545, 0.034, 0.0028, 0.0028, 5);
    segmentPart(p, cordHemp, side * 0.094, 1.545, 0.034, side * 0.075, 1.492, 0.036, 0.0028, 0.0027, 5);
    // 颌骨收向颏下绳结
    segmentPart(p, cordHemp, side * 0.075, 1.492, 0.036, side * 0.036, 1.462, 0.054, 0.0027, 0.0026, 5);
    segmentPart(p, cordHemp, side * 0.036, 1.462, 0.054, 0, 1.452, 0.058, 0.0026, 0.0026, 5);
  }
  part(p, new THREE.SphereGeometry(1, 5, 4), cordHemp, 0, 1.451, 0.058, 0.0062, 0.0052, 0.0058);
  segmentPart(p, cordHemp, -0.002, 1.450, 0.058, -0.009, 1.430, 0.061, 0.0020, 0.0016, 4);
  segmentPart(p, cordHemp, 0.002, 1.450, 0.058, 0.008, 1.433, 0.060, 0.0020, 0.0016, 4);

  // 斜背竹节钓竿：置于后背与鱼篓之间的肩带外侧
  const rx1 = 0.226, ry1 = 0.855, rz1 = -0.150;
  const rx2 = -0.228, ry2 = 1.744, rz2 = -0.146;
  segmentPart(p, cfg.pole, rx1, ry1, rz1, rx2, ry2, rz2, 0.0138, 0.0064, 8);
  const rdx = rx2 - rx1, rdy = ry2 - ry1, rdz = rz2 - rz1;
  const rLen = Math.hypot(rdx, rdy, rdz);
  const rodQuat = new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(rdx / rLen, rdy / rLen, rdz / rLen));
  for (const nt of [0.18, 0.42, 0.66, 0.87]) {
    const nr = (0.0138 * (1 - nt) + 0.0064 * nt) * 1.24;
    const nodeGeo = new THREE.CylinderGeometry(nr, nr, 0.014, 8);
    const nodeMat = new THREE.Matrix4().compose(
      new THREE.Vector3(rx1 + rdx * nt, ry1 + rdy * nt, rz1 + rdz * nt),
      rodQuat,
      new THREE.Vector3(1, 1, 1)
    );
    p.push({ geo: nodeGeo, color: cfg.hatBand, matrix: nodeMat, keepColor: false });
  }
  part(p, new THREE.TorusGeometry(0.0155, 0.0042, 4, 8), cfg.sash, rx1 + rdx * 0.34, ry1 + rdy * 0.34, rz1 + rdz * 0.34 + 0.006, 1, 1, 1, 0.3, 0.2, 0.46);
  segmentPart(p, cfg.hatBand, rx2 + 0.005, ry2 - 0.012, rz2 - 0.005, rx1 + rdx * 0.66 + 0.010, ry1 + rdy * 0.66 - 0.014, rz1 + rdz * 0.66 - 0.011, 0.0018, 0.0018, 4);
  part(p, new THREE.SphereGeometry(1, 5, 4), shiftHSL(cfg.sash, 0.01, 0.05, 0.08), rx1 + rdx * 0.72 + 0.009, ry1 + rdy * 0.72 - 0.010, rz1 + rdz * 0.72 - 0.010, 0.0045, 0.015, 0.0045, 0, 0, 0.46);

  // 4A. 右后胯束颈鼓腹细编竹鱼篓 (x ≈ 0.158, z ≈ -0.245)
  const cx = 0.158, cz = -0.245;
  part(p, shadedRingGeometry(CREEL_RINGS, 14, cfg.basket, (_x, y, z) => {
    const baseDark = (1 - smoothstep(0.718, 0.775, y)) * -0.065;
    const bellyWarm = Math.exp(-(((y - 0.822) / 0.052) ** 2)) * 0.048;
    const neckShade = Math.exp(-(((y - 0.922) / 0.026) ** 2)) * -0.055;
    const rimSun = smoothstep(0.945, 0.972, y) * 0.042;
    const weaveBand = Math.sin(y * 155) * 0.014;
    const bodySide = z > 0.04 ? -0.018 : 0.008;
    return {
      dh: 0.008 * bellyWarm,
      ds: 0.025 * bellyWarm,
      dl: baseDark + bellyWarm + neckShade + rimSun + weaveBand + bodySide
    };
  }, false), null, cx, 0, cz);
  // 鱼篓平底封盖 + 真正下凹向内收束的立体篓口内壁（法线朝内上方，俯视可见深邃编竹内腔）
  part(p, ringGeometry([
    { y: 0.716, rx: 0.010, rz: 0.010 },
    { y: 0.718, rx: 0.088, rz: 0.076 }
  ], 14, false), shiftHSL(cfg.basket, 0, 0, -0.10), cx, 0, cz);
  part(p, shadedRingGeometry([
    { y: 0.971, rx: 0.104, rz: 0.092 },
    { y: 0.932, rx: 0.072, rz: 0.063 },
    { y: 0.933, rx: 0.001, rz: 0.001 }
  ], 14, cfg.basket, (_x, y) => {
    const depthT = 1 - smoothstep(0.932, 0.971, y);
    return {
      dh: -0.008 * depthT,
      ds: -0.04 * depthT,
      dl: -0.06 - 0.22 * depthT
    };
  }, false), null, cx, 0, cz);

  // 鱼篓四道横编竹箍
  for (const hy of [0.730, 0.806, 0.922, 0.970]) {
    const hr = fitRing(CREEL_RINGS, hy);
    const rad = hr.rx - 0.0012;
    const szRatio = (hr.rz - 0.0012) / rad;
    const tube = hy > 0.96 ? 0.0064 : hy > 0.90 ? 0.0058 : 0.0052;
    part(p, new THREE.TorusGeometry(rad, tube, 5, 14), cfg.hatBand, cx, hy, cz, 1, 1, szRatio, Math.PI / 2, 0, 0);
  }
  // 鱼篓八根贴腹竖篾筋
  const creelRibCol = shiftHSL(cfg.hatBand, 0.006, 0.02, 0.05);
  const creelRibEdge = shiftHSL(cfg.hatBand, 0, 0, -0.04);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    part(p, sculptedSurfaceRidge(CREEL_RINGS, {
      yTop: 0.966, yBot: 0.724, aTop: a, aBot: a,
      wTop: 0.010, wBot: 0.011, crestTop: 0.0038, crestBot: 0.0042,
      steps: 6, taperTop: false, taperBot: false,
      crestColor: creelRibCol, edgeColor: creelRibEdge
    }), null, cx, 0, cz);
  }
  // 编绳提耳与系向斜挎肩带的双股挂绳
  const braidCol = shiftHSL(cfg.sash, -0.008, 0.02, -0.03);
  const lugA1 = Math.PI - 0.62;
  const lugY1 = strapHeightAtAngle(lugA1);
  const lugR1 = fitRing(TORSO, lugY1);
  const strapX1 = Math.sin(lugA1) * (lugR1.rx + 0.006);
  const strapZ1 = Math.cos(lugA1) * (lugR1.rz + 0.006);
  part(p, new THREE.TorusGeometry(0.013, 0.0036, 4, 8), cfg.hatBand, cx - 0.050, 0.924, cz + 0.060, 1, 1, 1, 0.3, 0.5, 0);
  part(p, new THREE.TorusGeometry(0.013, 0.0036, 4, 8), cfg.hatBand, cx + 0.050, 0.924, cz + 0.058, 1, 1, 1, 0.3, -0.5, 0);
  sagCord(p, braidCol, cx - 0.048, 0.928, cz + 0.062, strapX1, lugY1, strapZ1, 0.0040, 0.012, 3);
  sagCord(p, braidCol, cx + 0.048, 0.928, cz + 0.060, 0.174, 1.036, -0.072, 0.0040, 0.010, 3);
  part(p, new THREE.TorusGeometry(0.012, 0.0036, 4, 8), cfg.hatBand, strapX1, lugY1, strapZ1, 1, 1, 1, 0.2, 0.4, 0.6);

  // 4B. 左后腰暖赭双腹小酒葫芦 (x ≈ -0.165, y ≈ 0.905, z ≈ -0.138)
  const gx = -0.165, gy = 0.905, gz = -0.138;
  const gourdParts = [];
  const gourdBase = '#C7964E';
  part(gourdParts, shadedRingGeometry(GOURD_RINGS, 12, gourdBase, (_x, y, _z, _nx, ny) => {
    const waistPinch = Math.exp(-(((y - 0.016) / 0.012) ** 2)) * -0.075;
    const baseDeep = (1 - smoothstep(-0.068, -0.030, y)) * -0.055;
    const sunBulb = Math.max(0, ny) * 0.045 + smoothstep(0.022, 0.050, y) * 0.025;
    return {
      dh: -0.008 * baseDeep + 0.006 * sunBulb,
      ds: 0.03,
      dl: waistPinch + baseDeep + sunBulb
    };
  }), null);
  const gourdCordCol = '#7D4734';
  part(gourdParts, new THREE.TorusGeometry(0.0168, 0.0042, 5, 10), gourdCordCol, 0, 0.016, 0, 1, 1, 1, Math.PI / 2, 0, 0);
  part(gourdParts, new THREE.SphereGeometry(1, 5, 4), gourdCordCol, -0.018, 0.016, -0.004, 0.0065, 0.0065, 0.0065);
  segmentPart(gourdParts, gourdCordCol, -0.019, 0.015, -0.004, -0.032, -0.016, -0.010, 0.0024, 0.0018, 4);
  segmentPart(gourdParts, gourdCordCol, -0.018, 0.014, -0.003, -0.026, -0.024, 0.004, 0.0024, 0.0018, 4);
  part(gourdParts, new THREE.CylinderGeometry(0.0082, 0.0068, 0.017, 6), cfg.hatBand, 0, 0.076, 0);
  segmentPart(gourdParts, shiftHSL(cfg.hatBand, 0, 0, 0.08), 0, 0.083, 0, -0.006, 0.095, -0.003, 0.0030, 0.0018, 5);
  const gourdGeo = mergeColoredParts(gourdParts);
  part(p, gourdGeo, null, gx, gy, gz, 1, 1, 1, -0.11, 0.08, -0.15);
  sagCord(p, gourdCordCol, gx + 0.005, gy + 0.018, gz + 0.004, -0.138, 1.022, -0.092, 0.0034, 0.009, 3);
  part(p, new THREE.TorusGeometry(0.011, 0.0032, 4, 8), cfg.hatBand, -0.138, 1.022, -0.092, 1, 1, 1, 0.4, -0.3, 0.2);

  return mergeColoredParts(p);
}

const LEG_RINGS = [
  { y: -0.756, rx: 0.044, rz: 0.046 },
  { y: -0.660, rx: 0.050, rz: 0.052 },
  { y: -0.555, rx: 0.055, rz: 0.057 },
  { y: -0.445, rx: 0.057, rz: 0.059 },
  { y: -0.355, rx: 0.059, rz: 0.062, front: 0.004 },
  { y: -0.180, rx: 0.066, rz: 0.068 },
  { y: 0.012, rx: 0.071, rz: 0.073 }
];

function legGeometry(cfg) {
  const p = [];
  // 5B. 束口裤腿与行滕绑腿基底晕染
  part(p, shadedRingGeometry(LEG_RINGS, 10, cfg.pants, (_x, y, z) => {
    const putteeZone = 1 - smoothstep(-0.465, -0.430, y);
    const kneeHollow = z < -0.015 && y > -0.42 && y < -0.28 ? -0.032 : 0;
    const wrapBand = putteeZone * (0.026 + Math.sin(y * 85) * 0.012);
    return {
      dh: -0.018 * putteeZone,
      ds: -0.02 * putteeZone,
      dl: wrapBand + kneeHollow
    };
  }), null);

  const wrapDark = cfg.hatBand;
  const wrapLight = shiftHSL(cfg.sash, -0.008, -0.04, -0.04);
  part(p, ringGeometry([
    { y: -0.464, rx: 0.059, rz: 0.061 },
    { y: -0.440, rx: 0.059, rz: 0.061 }
  ], 10, false), wrapDark);
  part(p, ringGeometry([
    { y: -0.732, rx: 0.047, rz: 0.049 },
    { y: -0.696, rx: 0.050, rz: 0.052 }
  ], 10, false), wrapDark);

  // 利落交叉缠绕的行滕绑腿绳带
  part(p, surfaceBand(LEG_RINGS, -0.452, 0, -0.706, Math.PI * 1.5, 0.014, 0.0028, 10), wrapLight);
  part(p, surfaceBand(LEG_RINGS, -0.452, Math.PI, -0.706, Math.PI * 2.5, 0.014, 0.0028, 10), wrapLight);
  part(p, surfaceBand(LEG_RINGS, -0.452, Math.PI * 0.5, -0.706, -Math.PI, 0.013, 0.0040, 10), wrapDark);
  part(p, surfaceBand(LEG_RINGS, -0.452, Math.PI * 1.5, -0.706, 0, 0.013, 0.0040, 10), wrapDark);

  const shoeGeo = makeShoe({ shoe: cfg.shoe, hat: cfg.hat, hatBand: cfg.hatBand, trim: cfg.trim, collar: cfg.collar });
  part(p, shoeGeo, null, 0, -0.806, 0.008, 1.05, 1.05, 1.05);
  return mergeColoredParts(p);
}

const SLEEVE_RINGS = [
  { y: -0.474, rx: 0.051, rz: 0.050 },
  { y: -0.440, rx: 0.069, rz: 0.074, back: -0.010 },
  { y: -0.375, rx: 0.066, rz: 0.070, back: -0.008 },
  { y: -0.265, rx: 0.061, rz: 0.062 },
  { y: -0.150, rx: 0.067, rz: 0.066 },
  { y: -0.052, rx: 0.071, rz: 0.072 },
  { y: 0.006, rx: 0.064, rz: 0.066 },
  { y: 0.032, rx: 0.048, rz: 0.050 },
  { y: 0.048, rx: 0.014, rz: 0.014 }
];

function armGeometry(cfg) {
  const p = [];
  // 5A. 秦汉垂袂袖型：肩头衔接主袍受光提亮，小臂至袖口做纵向垂褶晕染与立体袖襞
  part(p, shadedRingGeometry(SLEEVE_RINGS, 10, cfg.clothes, (x, y, z, _nx, ny) => {
    const shoulderSun = smoothstep(-0.08, 0.02, y);
    const cuffZone = 1 - smoothstep(-0.474, -0.290, y);
    const ang = Math.atan2(x, z);
    const cuffPleat = Math.cos(ang * 4) * 0.022 * cuffZone;
    const cuffTuck = Math.exp(-(((y + 0.432) / 0.022) ** 2)) * -0.032;
    const skyUp = Math.max(0, ny) * 0.015;
    return {
      dh: -0.010 * shoulderSun,
      ds: 0.015 * shoulderSun,
      dl: 0.038 * shoulderSun + cuffPleat + cuffTuck + skyUp
    };
  }), null);

  const sleeveCrest = shiftHSL(cfg.clothes, -0.006, 0.01, 0.020);
  const sleeveEdge = shiftHSL(cfg.clothes, 0.006, 0.02, -0.055);
  for (const side of [-1, 1]) {
    part(p, sculptedSurfaceRidge(SLEEVE_RINGS, {
      yTop: -0.255, yBot: -0.432,
      aTop: Math.PI + side * 0.30, aBot: Math.PI + side * 0.36,
      wTop: 0.015, wBot: 0.020, crestTop: 0.0040, crestBot: 0.0055,
      steps: 5, taperTop: true, taperBot: true,
      crestColor: sleeveCrest, edgeColor: sleeveEdge
    }), null);
  }

  part(p, shadedRingGeometry([
    { y: -0.486, rx: 0.050, rz: 0.048 },
    { y: -0.474, rx: 0.065, rz: 0.068, back: -0.006 },
    { y: -0.444, rx: 0.071, rz: 0.075, back: -0.008 },
    { y: -0.428, rx: 0.058, rz: 0.060 }
  ], 10, cfg.clothes2, (x, y, z) => {
    const ang = Math.atan2(x, z);
    const fold = Math.cos(ang * 5) * 0.020;
    const wristDeep = (1 - smoothstep(-0.486, -0.468, y)) * -0.040;
    return fold + wristDeep;
  }), null);
  part(p, ringGeometry([
    { y: -0.488, rx: 0.051, rz: 0.049 },
    { y: -0.479, rx: 0.058, rz: 0.060 }
  ], 10, false), cfg.collar);

  part(p, new THREE.SphereGeometry(1, 7, 4), cfg.skin, 0, -0.525, 0, 0.045, 0.059, 0.034);
  part(p, new THREE.SphereGeometry(1, 6, 4), cfg.skin, 0.034, -0.513, 0.005, 0.016, 0.026, 0.017, 0, 0, -0.35);
  return mergeColoredParts(p);
}

export function createAvatar(cfg, walkSpeed) {
  const group = new THREE.Group();
  group.name = 'player-avatar';
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const body = new THREE.Group();
  body.name = 'player-body';
  group.add(body);
  const bodyMesh = new THREE.Mesh(bodyGeometry(cfg), material);
  bodyMesh.name = 'player-body-mesh';
  body.add(bodyMesh);
  const legL = new THREE.Group();
  legL.name = 'player-leg-l';
  legL.position.set(-0.1, 0.82, 0);
  const legR = new THREE.Group();
  legR.name = 'player-leg-r';
  legR.position.set(0.1, 0.82, 0);
  group.add(legL, legR);
  const legGeo = legGeometry(cfg);
  legL.add(new THREE.Mesh(legGeo, material));
  legR.add(new THREE.Mesh(legGeo, material));
  const armL = new THREE.Group();
  armL.name = 'player-arm-l';
  armL.position.set(-0.198, 1.398, 0);
  armL.rotation.z = -0.16;
  const armR = new THREE.Group();
  armR.name = 'player-arm-r';
  armR.position.set(0.198, 1.398, 0);
  armR.rotation.z = 0.16;
  body.add(armL, armR);
  const armGeo = armGeometry(cfg);
  armL.add(new THREE.Mesh(armGeo, material));
  armR.add(new THREE.Mesh(armGeo, material));
  const state = { yaw: null, gait: 0, speed: 0, sitAmount: 0, bowAmount: 0, airAmount: 0, landAmount: 0 };
  let animElapsed = null;
  const meshes = [bodyMesh, legL.children[0], legR.children[0], armL.children[0], armR.children[0]];
  function update(dt, elapsed, player) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (animElapsed === null) animElapsed = Number.isFinite(elapsed) ? elapsed : 0;
    else animElapsed += step;
    group.position.set(player.x, player.y, player.z);
    const speed = Math.hypot(player.vx || 0, player.vz || 0);
    const sit = Math.max(0, Math.min(1, Number(player.sitAmount ?? state.sitAmount) || 0));
    const bow = Math.max(0, Math.min(1, Number(player.bowAmount ?? state.bowAmount) || 0));
    const airTarget = (player.jumpPhase !== undefined && Number.isFinite(player.jumpPhase))
      ? Math.max(0, Math.min(1, player.jumpPhase))
      : (player.airborne ? 1 : 0);
    const air = step > 0
      ? state.airAmount + (airTarget - state.airAmount) * (1 - Math.exp(-16 * step))
      : airTarget;
    const land = Math.max(0, Math.min(1, Number(player.landImpulse) || 0)) * (1 - sit);
    const vy = Number.isFinite(player.vy) ? player.vy : 0;
    const rise = clamp01((vy + 1.2) / 5.5);
    state.sitAmount = sit;
    state.bowAmount = bow;
    state.airAmount = air;
    state.landAmount = land;
    const rawMotion = Math.min(1, speed / Math.max(0.001, walkSpeed));
    const groundFactor = 1 - air;
    const motion = rawMotion * (1 - Math.max(sit, bow * 0.85)) * groundFactor;
    state.speed = speed;
    if (state.yaw === null) state.yaw = player.yaw + Math.PI;
    if (step > 0) {
      if (speed > 0.15 && sit < 0.5) {
        state.yaw = angleLerp(state.yaw, Math.atan2(player.vx, player.vz), 1 - Math.exp(-cfg.turnSpeed * step));
        if (air < 0.35) state.gait += step * (cfg.gaitBase + speed * cfg.gaitRate);
      } else {
        state.yaw = angleLerp(state.yaw, player.yaw + Math.PI, 1 - Math.exp(-cfg.turnSpeed * 0.55 * step));
      }
    }
    group.rotation.y = state.yaw;
    const swing = Math.sin(state.gait) * cfg.legSwing * motion;
    const jumpLegL = (-0.54 * rise - 0.24 * (1 - rise)) * (1 - sit);
    const jumpLegR = (0.36 * rise - 0.18 * (1 - rise)) * (1 - sit);
    const landLeg = -0.14 * land;
    const rotL = (swing * (1 - sit) - 1.08 * sit) * groundFactor + jumpLegL * air + landLeg;
    const rotR = (-swing * (1 - sit) - 1.08 * sit) * groundFactor + jumpLegR * air + landLeg;
    const liftL = Math.max(0, -Math.cos(state.gait)) * 0.044 * motion * (1 - sit);
    const liftR = Math.max(0, Math.cos(state.gait)) * 0.044 * motion * (1 - sit);
    const jumpLiftL = (0.125 * rise + 0.085 * (1 - rise)) * air * (1 - sit);
    const jumpLiftR = (0.068 * rise + 0.075 * (1 - rise)) * air * (1 - sit);
    // 严格保证摆腿时鞋尖 (+0.155) 与鞋跟 (-0.080) 均不低于角色落脚面 y = 0
    const clearL = (1 - sit) * groundFactor * Math.max(0, 0.822 - (0.8186 * Math.cos(rotL) - (rotL >= 0 ? 0.155 : -0.080) * Math.sin(rotL)));
    const clearR = (1 - sit) * groundFactor * Math.max(0, 0.822 - (0.8186 * Math.cos(rotR) - (rotR >= 0 ? 0.155 : -0.080) * Math.sin(rotR)));
    legL.position.set(-0.1, 0.82 - 0.30 * sit - 0.045 * land + clearL + liftL + jumpLiftL, 0.05 * sit + 0.045 * air);
    legR.position.set(0.1, 0.82 - 0.30 * sit - 0.045 * land + clearR + liftR + jumpLiftR, 0.05 * sit - 0.025 * air * rise);
    legL.rotation.x = rotL;
    legR.rotation.x = rotR;
    const armWalkL = (-swing * cfg.armSwing * (1 - sit) - 0.32 * sit) * groundFactor;
    const armWalkR = (swing * cfg.armSwing * (1 - sit) - 0.32 * sit) * groundFactor;
    const armJumpL = (0.28 * rise - 0.22 * (1 - rise)) * air;
    const armJumpR = (-0.42 * rise - 0.18 * (1 - rise)) * air;
    armL.rotation.x = (armWalkL + armJumpL) * (1 - bow) - 0.86 * bow - 0.10 * land;
    armR.rotation.x = (armWalkR + armJumpR) * (1 - bow) - 0.88 * bow - 0.10 * land;
    armL.rotation.z = (-0.16 - 0.24 * air - 0.06 * land) * (1 - bow) + 0.38 * bow;
    armR.rotation.z = (0.16 + 0.24 * air + 0.06 * land) * (1 - bow) - 0.38 * bow;
    const baseBodyY = Math.abs(Math.sin(state.gait)) * cfg.bob * motion + Math.sin(animElapsed * 1.6) * cfg.idleBreath * (1 - motion) * groundFactor;
    body.position.y = baseBodyY - 0.30 * sit + 0.045 * air * rise - 0.072 * land;
    body.rotation.x = cfg.lean * motion * (1 - sit) + 0.06 * sit + 0.24 * bow + (0.13 * rise + 0.04 * (1 - rise)) * air + 0.08 * land;
    body.rotation.y = ((-swing * 0.10 * (1 - sit) * (1 - bow)) + 0.06 * air * rise) || 0;
    body.rotation.z = (Math.cos(state.gait) * 0.016 * motion * (1 - sit)) || 0;
  }
  function setVisible(v) { group.visible = v; }
  function dispose() {
    group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    material.dispose();
  }
  return { group, update, setVisible, dispose, state, count: meshes.length };
}
