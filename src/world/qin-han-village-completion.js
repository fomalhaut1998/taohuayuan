import * as THREE from 'three';
import { createCommunityActors } from '../systems/community-actors.js';
import { livingStep } from '../systems/living-behavior.js';
import { chainProgramCacheKey } from '../systems/shader-cache-key.js';
import inkWater from '../data/ink-water.json' with { type: 'json' };
import oxPlowingCfg from '../data/ox-plowing.json' with { type: 'json' };

const TAU = Math.PI * 2;

const _mat = new THREE.Matrix4();
const _nmat = new THREE.Matrix3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _v = new THREE.Vector3();
const _col = new THREE.Color();

function createSink() {
  return { pos: [], nor: [], col: [] };
}

function pushGeo(sk, geo, mat, hexOrColor) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pa = g.attributes.position.array;
  const na = g.attributes.normal.array;
  _col.set(hexOrColor);
  _nmat.getNormalMatrix(mat);
  for (let i = 0; i < pa.length; i += 3) {
    _v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(mat);
    sk.pos.push(_v.x, _v.y, _v.z);
    _v.set(na[i], na[i + 1], na[i + 2]).applyMatrix3(_nmat).normalize();
    sk.nor.push(_v.x, _v.y, _v.z);
    sk.col.push(_col.r, _col.g, _col.b);
  }
  if (g !== geo) g.dispose();
}

function pushTri(sk, a, b, c, color) {
  _col.set(color);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  sk.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) {
    sk.nor.push(nx, ny, nz);
    sk.col.push(_col.r, _col.g, _col.b);
  }
}

function pushQuadPts(sk, p0, p1, p2, p3, color) {
  pushTri(sk, p0, p1, p2, color);
  pushTri(sk, p0, p2, p3, color);
}

function pushUpQuadPts(sk, p0, p1, p2, p3, color) {
  const ux = p1[0] - p0[0], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vz = p2[2] - p0[2];
  if (uz * vx - ux * vz >= 0) {
    pushQuadPts(sk, p0, p1, p2, p3, color);
  } else {
    pushQuadPts(sk, p0, p3, p2, p1, color);
  }
}

function toGeometry(sk) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sk.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(sk.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(sk.col, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function localToWorld(hx, hz, rot, lx, lz) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [hx + lx * c + lz * s, hz - lx * s + lz * c];
}

function boxDistance(x, z, b) {
  const c = Math.cos(b.rot || 0);
  const s = Math.sin(b.rot || 0);
  const dx = x - b.x;
  const dz = z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - (b.hw || 0)),
    Math.max(0, Math.abs(dx * s + dz * c) - (b.hd || 0)));
}

function readWeather(sky) {
  const app = sky?.getAppearance?.();
  const rain = Math.max(0, Math.min(1, Number(sky?.rainIntensity ?? app?.rainIntensity ?? 0) || 0));
  const wind = Math.max(0, Number(sky?.wind ?? app?.wind ?? 0.25) || 0);
  const windX = Number(sky?.windX ?? app?.windX ?? 0) || 0;
  const windZ = Number(sky?.windZ ?? app?.windZ ?? 0) || 0;
  const timeId = sky?.timeId ?? app?.timeId ?? 'day';
  const isNight = timeId === 'night' || timeId === 'dusk';
  const isTrueNight = timeId === 'night';
  return { rain, wind, windX, windZ, timeId, isNight, isTrueNight };
}

function buildCropClumpGeometry() {
  const pos = [];
  const col = [];
  const idx = [];
  let base = 0;

  function addTri(ax, ay, az, bx, by, bz, cx, cy, cz, cA, cB, cC) {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    col.push(cA[0], cA[1], cA[2], cB[0], cB[1], cB[2], cC[0], cC[1], cC[2]);
    idx.push(base, base + 1, base + 2);
    base += 3;
  }

  // 7 slender arching rice/millet blades in lush greens (3 tris each = 21 tris)
  const leafCount = 7;
  const cRoot = [0.30, 0.46, 0.22];
  const cMid = [0.44, 0.65, 0.30];
  const cTip = [0.58, 0.76, 0.37];

  for (let i = 0; i < leafCount; i++) {
    const ang = (i / leafCount) * TAU + (i % 2 === 0 ? 0.19 : -0.14);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const tx = -sa;
    const tz = ca;
    const r0 = 0.025 + (i % 3) * 0.011;
    const hMid = 0.28 + (i % 3) * 0.045;
    const rMid = 0.09 + (i % 2) * 0.035;
    const hTip = 0.34 + (i % 3) * 0.055;
    const rTip = 0.22 + (i % 2) * 0.055;
    const w0 = 0.021;
    const w1 = 0.013;

    const bLx = ca * r0 - tx * w0, bLz = sa * r0 - tz * w0;
    const bRx = ca * r0 + tx * w0, bRz = sa * r0 + tz * w0;
    const mLx = ca * rMid - tx * w1, mLz = sa * rMid - tz * w1;
    const mRx = ca * rMid + tx * w1, mRz = sa * rMid + tz * w1;
    const tX = ca * rTip, tZ = sa * rTip;

    addTri(bLx, 0, bLz, bRx, 0, bRz, mRx, hMid, mRz, cRoot, cRoot, cMid);
    addTri(bLx, 0, bLz, mRx, hMid, mRz, mLx, hMid, mLz, cRoot, cMid, cMid);
    addTri(mLx, hMid, mLz, mRx, hMid, mRz, tX, hTip, tZ, cMid, cMid, cTip);
  }

  // 2 tall culm stems + heavy golden drooping grain panicles (#D4B86A, 6 tris each = 12 tris; total 31+ tris)
  const cStem = [0.54, 0.66, 0.34];
  const cEar = [0.85, 0.74, 0.43];     // #D4B86A golden grain panicle body
  const cEarTip = [0.91, 0.79, 0.47];  // sun-kissed golden spikelet tip
  const panicles = [
    { ang: 0.45, h: 0.72, reach: 0.16, drop: 0.14 },
    { ang: 3.55, h: 0.65, reach: 0.15, drop: 0.12 }
  ];
  for (const p of panicles) {
    const ca = Math.cos(p.ang);
    const sa = Math.sin(p.ang);
    const tx = -sa;
    const tz = ca;
    // Lower vertical-to-arched culm
    addTri(ca * 0.01 - tx * 0.01, 0, sa * 0.01 - tz * 0.01,
      ca * 0.01 + tx * 0.01, 0, sa * 0.01 + tz * 0.01,
      ca * 0.06, p.h * 0.72, sa * 0.06, cRoot, cRoot, cStem);
    // Arching neck up to crest
    addTri(ca * 0.05 - tx * 0.008, p.h * 0.68, sa * 0.05 - tz * 0.008,
      ca * 0.05 + tx * 0.008, p.h * 0.68, sa * 0.05 + tz * 0.008,
      ca * (p.reach * 0.65), p.h, sa * (p.reach * 0.65), cStem, cStem, cEar);
    // Two crossed drooping grain-panicle blades for 3D fullness from every angle
    const cx0 = ca * (p.reach * 0.55), cz0 = sa * (p.reach * 0.55), cy0 = p.h - 0.01;
    const cx1 = ca * p.reach, cz1 = sa * p.reach, cy1 = p.h - p.drop;
    addTri(cx0 - tx * 0.022, cy0, cz0 - tz * 0.022, cx0 + tx * 0.022, cy0, cz0 + tz * 0.022, cx1, cy1, cz1, cEar, cEar, cEarTip);
    addTri(cx0 - ca * 0.016, cy0 + 0.018, cz0 - sa * 0.016, cx0 + ca * 0.016, cy0 - 0.016, cz0 + sa * 0.016, cx1, cy1, cz1, cEar, cEar, cEarTip);
    // Second smaller drooping spikelet cluster
    const bx = ca * (p.reach * 0.85), bz = sa * (p.reach * 0.85), by = p.h - p.drop * 0.45;
    addTri(bx - tx * 0.018, by + 0.015, bz - tz * 0.018, bx + tx * 0.018, by - 0.01, bz + tz * 0.018, cx1 + ca * 0.02, cy1 - 0.04, cz1 + sa * 0.02, cEar, cEarTip, cEarTip);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function createQinHanCompletion(options = {}) {
  const { world, field, village, props, leisureGrove, qinHanHomestead, blockers = [] } = options;
  const group = new THREE.Group();
  group.name = 'qin-han-completion';

  const targets = [];
  const shelters = [];
  const sheltersRaw = [];
  const emberAnchors = [];
  const rand = lcg(20261114);
  const surface = (x, z) => (field ? field.sample(x, z) : 0);
  const walkY = (x, z) => (typeof field?.walkSurface === 'function' ? field.walkSurface(x, z) : surface(x, z));

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
  const rockGeo = new THREE.DodecahedronGeometry(0.5, 0);
  const staticSk = createSink();
  const emberSk = createSink();

  const putSolid = (geo, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0, targetSk = staticSk) => {
    _euler.set(rx, ry, rz, 'YXZ');
    _quat.setFromEuler(_euler);
    _mat.compose(_pos.set(x, y, z), _quat, _scl.set(sx, sy, sz));
    pushGeo(targetSk, geo, _mat, color);
  };

  const putLocal = (hi, geo, lx, ly, lz, sx, sy, sz, color, rx = 0, ry = 0, rz = 0, targetSk = staticSk) => {
    const [wx, wz] = localToWorld(hi.x, hi.z, hi.rot, lx, lz);
    _euler.set(rx, hi.rot + ry, rz, 'YXZ');
    _quat.setFromEuler(_euler);
    _mat.compose(_pos.set(wx, ly, wz), _quat, _scl.set(sx, sy, sz));
    pushGeo(targetSk, geo, _mat, color);
  };

  // Colors consistent with Qin-Han natural palette
  const cEarth = '#967E59';
  const cEarthDark = '#766143';
  const cStone = '#868A7C';
  const cMoss = '#6A7A56';
  const cTimber = '#5D4832';
  const cTimberLight = '#8B6D49';
  const cThatch = '#AC955F';
  const cThatchDark = '#877246';
  const cBamboo = '#A8965A';
  const cDarkAlcove = '#241D17';
  const cPottery = '#7B746C';
  const cMat = '#C2AF78';

  // ============================================================================
  // 1. 晒谷场与晒席防悬空夯土斜坡裙边 + 毛石护脚
  // ============================================================================
  let skirtCount = 0;
  const marks = props?.marks || [];
  for (const m of marks) {
    if (m.kind === 'thresh') {
      const cy = surface(m.x, m.z);
      const topR = Math.max(1, (m.r || 6.4) - 0.04);
      const botR = topR + 0.48;
      const segs = 28;
      const topY = cy + 0.045;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU;
        const a1 = ((i + 1) / segs) * TAU;
        const tx0 = m.x + Math.cos(a0) * topR;
        const tz0 = m.z + Math.sin(a0) * topR;
        const tx1 = m.x + Math.cos(a1) * topR;
        const tz1 = m.z + Math.sin(a1) * topR;
        const bx0 = m.x + Math.cos(a0) * botR;
        const bz0 = m.z + Math.sin(a0) * botR;
        const bx1 = m.x + Math.cos(a1) * botR;
        const bz1 = m.z + Math.sin(a1) * botR;
        const by0 = Math.min(cy - 0.16, surface(bx0, bz0) - 0.42);
        const by1 = Math.min(cy - 0.16, surface(bx1, bz1) - 0.42);
        pushQuadPts(staticSk, [tx0, topY, tz0], [bx0, by0, bz0], [bx1, by1, bz1], [tx1, topY, tz1],
          i % 2 === 0 ? cEarth : cEarthDark);
        // Add mossy retaining fieldstones along pronounced downhill arcs
        const drop = cy - Math.min(surface(bx0, bz0), surface(bx1, bz1));
        if (drop > 0.09 && i % 2 === 0) {
          const sx = (tx0 + bx1) * 0.5;
          const sz = (tz0 + bz1) * 0.5;
          const sy = surface(sx, sz);
          const sh = Math.max(0.28, drop + 0.18);
          putSolid(rockGeo, sx, sy + sh * 0.15, sz, 0.85 + rand() * 0.35, sh, 0.72 + rand() * 0.3,
            i % 4 === 0 ? cMoss : cStone, 0.1, a0 + rand() * 0.4, 0);
        }
      }
      skirtCount++;
    } else if (m.kind === 'drying-mat') {
      const cy = surface(m.x, m.z);
      const hw = (m.w || 1.7) * 0.5 - 0.02;
      const hd = (m.d || 1.15) * 0.5 - 0.02;
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const x0 = m.x + a[0], z0 = m.z + a[1];
        const x1 = m.x + b[0], z1 = m.z + b[1];
        const by0 = Math.min(cy - 0.06, surface(x0, z0) - 0.16);
        const by1 = Math.min(cy - 0.06, surface(x1, z1) - 0.16);
        pushQuadPts(staticSk, [x0, cy + 0.02, z0], [x0, by0, z0], [x1, by1, z1], [x1, cy + 0.02, z1], cEarthDark);
      }
    }
  }

  // ============================================================================
  // 2. 主村11栋屋舍秦汉化：防悬空夯土台基、厚茅草挑檐、直棂/支摘窗与3处半掩柴门火塘
  // ============================================================================
  const houseInfo = village?.houseInfo || [];
  const hc = world?.village?.houses || { overhang: 0.45, roofHeight: 2.3 };
  const overhang = hc.overhang ?? 0.45;
  const roofH = hc.roofHeight ?? 2.3;

  // Select 3 well-spaced front-row houses for open-door hearth alcoves
  const doorCandidates = houseInfo
    .map((hi, idx) => ({ hi, idx }))
    .filter(({ hi, idx }) => idx < 8 && surface(hi.doorX, hi.doorZ) > (world?.terrain?.waterLevel ?? -1) + 0.4);
  const openDoorIndices = new Set();
  for (const preferred of [1, 4, 6, 0, 2, 5]) {
    if (openDoorIndices.size >= 3) break;
    const hit = doorCandidates.find(c => c.idx === preferred);
    if (hit) openDoorIndices.add(hit.idx);
  }

  let houseDressedCount = 0;
  let openHearthCount = 0;
  for (let i = 0; i < houseInfo.length; i++) {
    const hi = houseInfo[i];
    houseDressedCount++;

    // 2A. Continuous sloped plinth skirt eliminating foundation hover on sloped plots
    const padX = hi.w * 0.5 + 0.10;
    const padZ = hi.d * 0.5 + 0.10;
    const toeX = padX + 0.28;
    const toeZ = padZ + 0.28;
    const perimeter = [
      [-padX, padZ, -toeX, toeZ],
      [0, padZ, 0, toeZ],
      [padX, padZ, toeX, toeZ],
      [padX, 0, toeX, 0],
      [padX, -padZ, toeX, -toeZ],
      [0, -padZ, 0, -toeZ],
      [-padX, -padZ, -toeX, -toeZ],
      [-padX, 0, -toeX, 0]
    ];
    for (let s = 0; s < perimeter.length; s++) {
      const p0 = perimeter[s];
      const p1 = perimeter[(s + 1) % perimeter.length];
      const [tx0, tz0] = localToWorld(hi.x, hi.z, hi.rot, p0[0], p0[1]);
      const [tx1, tz1] = localToWorld(hi.x, hi.z, hi.rot, p1[0], p1[1]);
      const [bx0, bz0] = localToWorld(hi.x, hi.z, hi.rot, p0[2], p0[3]);
      const [bx1, bz1] = localToWorld(hi.x, hi.z, hi.rot, p1[2], p1[3]);
      const by0 = Math.min(hi.gy - 0.16, surface(bx0, bz0) - 0.36);
      const by1 = Math.min(hi.gy - 0.16, surface(bx1, bz1) - 0.36);
      pushQuadPts(staticSk, [tx0, hi.gy + 0.03, tz0], [bx0, by0, bz0], [bx1, by1, bz1], [tx1, hi.gy + 0.03, tz1],
        s % 2 === 0 ? cEarth : cEarthDark);
    }
    // 2-tier chamfered bluestone doorstep grounded into actual ground height
    const [dx, dz] = localToWorld(hi.x, hi.z, hi.rot, 0, hi.d * 0.5 + 0.42);
    const stepBase = Math.min(hi.gy - 0.1, surface(dx, dz) - 0.2);
    const stepTop = hi.gy + 0.04;
    const stepH = Math.max(0.22, stepTop - stepBase);
    putLocal(hi, boxGeo, 0, stepBase + stepH * 0.36, hi.d * 0.5 + 0.44, 1.54, stepH * 0.72, 0.88, '#7A7E71');
    putLocal(hi, boxGeo, 0, stepTop - 0.045, hi.d * 0.5 + 0.32, 1.34, 0.09, 0.56, cStone);

    // 2B. Thick Qin-Han thatch eave bundles, ridge binding beam & ridge wasong
    const W = hi.w + overhang * 2;
    const D = hi.d + overhang * 2;
    const baseRoofY = hi.gy + hi.h - 0.16;
    for (const s of [-1, 1]) {
      putLocal(hi, boxGeo, s * (W * 0.5 - 0.02), baseRoofY + 0.04, 0, 0.26, 0.18, D + 0.14, cThatchDark, 0, 0, s * 0.25);
      putLocal(hi, cylGeo, s * (W * 0.5 + 0.05), baseRoofY + 0.01, 0, 0.09, D + 0.12, 0.09, cThatch, Math.PI * 0.5, 0, 0);
    }
    putLocal(hi, cylGeo, 0, baseRoofY + roofH + 0.07, 0, 0.18, D + 0.18, 0.18, cTimber, Math.PI * 0.5, 0, 0);
    for (let t = 0; t < 3; t++) {
      const wz = -D * 0.3 + t * D * 0.3;
      putLocal(hi, rockGeo, (t % 2 === 0 ? 0.08 : -0.07), baseRoofY + roofH + 0.12, wz, 0.18, 0.14, 0.18, cMoss, 0, t * 1.1, 0);
    }

    // 2C. Qin-Han vertical-mullion windows & propped casement shutters covering front & side cross-grids
    const winY = (hi.gy - 0.15) + 0.565 * hi.h;
    const frontWinW = 0.17 * hi.w;
    const frontWinH = 0.26 * hi.h;
    for (const wx of [-0.29 * hi.w, 0.29 * hi.w]) {
      const zFace = hi.d * 0.5 + 0.014;
      putLocal(hi, boxGeo, wx, winY, zFace, frontWinW + 0.04, frontWinH + 0.02, 0.02, cDarkAlcove);
      putLocal(hi, boxGeo, wx, winY + frontWinH * 0.5 + 0.02, zFace + 0.01, frontWinW + 0.12, 0.05, 0.04, cTimber);
      putLocal(hi, boxGeo, wx, winY - frontWinH * 0.5 - 0.02, zFace + 0.01, frontWinW + 0.14, 0.05, 0.05, cTimberLight);
      for (let mIdx = 0; mIdx < 5; mIdx++) {
        const mx = wx - frontWinW * 0.4 + (mIdx / 4) * frontWinW * 0.8;
        putLocal(hi, cylGeo, mx, winY, zFace + 0.012, 0.025, frontWinH + 0.01, 0.025, cBamboo);
      }
      // Outward-propped casement leaf angled overhead (above player shoulder clearance)
      if ((i + (wx > 0 ? 1 : 0)) % 2 === 0) {
        const topY = winY + frontWinH * 0.5;
        putLocal(hi, boxGeo, wx, topY + 0.06, zFace + 0.26, frontWinW + 0.04, 0.032, 0.54, cThatchDark, 0.36, 0, 0);
        putLocal(hi, cylGeo, wx - frontWinW * 0.28, winY + 0.05, zFace + 0.22, 0.024, 0.50, 0.024, cTimberLight, 0.72, 0, 0);
      }
    }
    if (i < 2) {
      const sideSign = i % 2 === 0 ? 1 : -1;
      const sx = sideSign * (hi.w * 0.5 + 0.016);
      const sideWinW = 0.23 * hi.d;
      const sideWinH = 0.26 * hi.h;
      putLocal(hi, boxGeo, sx, winY, 0, 0.02, sideWinH + 0.02, sideWinW + 0.03, cDarkAlcove);
      putLocal(hi, boxGeo, sx + sideSign * 0.01, winY + sideWinH * 0.5 + 0.02, 0, 0.04, 0.05, sideWinW + 0.10, cTimber);
      putLocal(hi, boxGeo, sx + sideSign * 0.01, winY - sideWinH * 0.5 - 0.02, 0, 0.05, 0.05, sideWinW + 0.12, cTimberLight);
      for (let mIdx = 0; mIdx < 4; mIdx++) {
        const mz = -sideWinW * 0.36 + (mIdx / 3) * sideWinW * 0.72;
        putLocal(hi, cylGeo, sx + sideSign * 0.012, winY, mz, 0.022, sideWinH + 0.01, 0.022, cBamboo);
      }
    }

    // Register shallow house front eave shelter for rain listening (full cover on open-doorway porch hoods)
    const isOpenDoor = openDoorIndices.has(i);
    if (isOpenDoor) {
      openHearthCount++;
      // Sculpted pitched thatched doorway hood (厚茅草挑檐门罩 + 椽木檐枋 + 门柱斜撑雀替)
      const hoodY = hi.gy + hi.h - 0.10;
      const wallZ = hi.d * 0.5 + 0.05;
      // Wall header ledger beam + front eave purlin + 4 sloped rafters
      putLocal(hi, boxGeo, 0, hoodY + 0.14, wallZ + 0.06, 2.04, 0.10, 0.12, cTimber);
      putLocal(hi, boxGeo, 0, hoodY - 0.12, wallZ + 0.76, 2.08, 0.08, 0.09, cTimber);
      for (const rx of [-0.82, -0.28, 0.28, 0.82]) {
        putLocal(hi, boxGeo, rx, hoodY + 0.02, wallZ + 0.42, 0.065, 0.075, 0.86, cTimberLight, 0.32, 0, 0);
      }
      // Thick sloped thatched canopy + rounded straw eave roll + ridge binding bar
      putLocal(hi, boxGeo, 0, hoodY + 0.08, wallZ + 0.44, 2.18, 0.14, 0.94, cThatch, 0.32, 0, 0);
      putLocal(hi, boxGeo, 0, hoodY + 0.12, wallZ + 0.40, 2.12, 0.08, 0.86, cThatchDark, 0.32, 0, 0);
      putLocal(hi, cylGeo, 0, hoodY - 0.07, wallZ + 0.86, 0.11, 2.20, 0.11, cThatchDark, 0, 0, Math.PI * 0.5);
      putLocal(hi, cylGeo, 0, hoodY + 0.22, wallZ + 0.06, 0.075, 2.16, 0.075, cTimber, 0, 0, Math.PI * 0.5);
      // Sturdy corbel brackets & diagonal timber knee braces anchored into door frame jambs
      for (const bx of [-0.66, 0.66]) {
        putLocal(hi, boxGeo, bx, hoodY - 0.12, wallZ + 0.38, 0.08, 0.09, 0.72, cTimber);
        putLocal(hi, boxGeo, bx, hoodY - 0.34, wallZ + 0.28, 0.075, 0.075, 0.62, cTimberLight, -0.68, 0, 0);
      }

      // Dark interior alcove vignette + ajar brushwood/plank door + indoor hearth & low bed
      const doorPlane = hi.d * 0.5 + 0.064;
      putLocal(hi, boxGeo, 0, hi.gy + 0.92, doorPlane, 1.16, 2.02, 0.024, cDarkAlcove);
      // Heavy timber door frame
      putLocal(hi, boxGeo, -0.62, hi.gy + 0.96, doorPlane + 0.06, 0.11, 2.08, 0.15, cTimber);
      putLocal(hi, boxGeo, 0.62, hi.gy + 0.96, doorPlane + 0.06, 0.11, 2.08, 0.15, cTimber);
      putLocal(hi, boxGeo, 0, hi.gy + 1.98, doorPlane + 0.07, 1.42, 0.14, 0.18, cTimber);
      // Sculpted interior relief: left low timber couch (矮榻) & shouldered gray clay storage jar (灰陶瓮)
      putLocal(hi, boxGeo, -0.28, hi.gy + 0.26, doorPlane + 0.032, 0.52, 0.26, 0.04, '#6A533B');
      putLocal(hi, boxGeo, -0.28, hi.gy + 0.40, doorPlane + 0.035, 0.48, 0.04, 0.04, cMat);
      putLocal(hi, cylGeo, -0.05, hi.gy + 0.26, doorPlane + 0.042, 0.24, 0.26, 0.13, cPottery);
      putLocal(hi, cylGeo, -0.05, hi.gy + 0.42, doorPlane + 0.042, 0.15, 0.08, 0.10, '#6A635B');
      // Right sunken clay hearth ring (土灶火塘) + iron/clay cooking pot + warm charcoal bed
      putLocal(hi, cylGeo, 0.25, hi.gy + 0.16, doorPlane + 0.042, 0.36, 0.14, 0.10, cPottery);
      putLocal(hi, boxGeo, 0.25, hi.gy + 0.24, doorPlane + 0.046, 0.26, 0.06, 0.05, '#3E2B1E');

      // Glowing ember relief placed in dedicated emberSk (skyIgnore: true)
      const [ex, ez] = localToWorld(hi.x, hi.z, hi.rot, 0.25, doorPlane + 0.052);
      const ey = hi.gy + 0.28;
      emberAnchors.push({ x: ex, y: ey, z: ez, phase: i * 1.4 });
      putLocal(hi, rockGeo, 0.25, ey, doorPlane + 0.054, 0.22, 0.12, 0.06, '#E86A28', 0, 0, 0, emberSk);
      putLocal(hi, boxGeo, 0.25, ey + 0.08, doorPlane + 0.055, 0.11, 0.14, 0.04, '#FFBA49', 0, 0, 0.18, emberSk);

      // Ajar brushwood/plank door leaf swung partially open (protrudes < 0.45 m, stays clear of path)
      const hingeX = -0.54;
      const hingeZ = doorPlane + 0.10;
      const openAngle = 0.62; // ~35 deg ajar
      const leafX = hingeX + Math.sin(openAngle) * 0.32;
      const leafZ = hingeZ + Math.cos(openAngle) * 0.32;
      putLocal(hi, boxGeo, leafX, hi.gy + 0.90, leafZ, 0.05, 1.88, 0.66, '#7C6140', 0, openAngle, 0);
      for (const bz of [-0.18, 0, 0.18]) {
        putLocal(hi, cylGeo,
          hingeX + Math.sin(openAngle) * (0.32 + bz),
          hi.gy + 0.90,
          hingeZ + Math.cos(openAngle) * (0.32 + bz),
          0.032, 1.84, 0.032, cBamboo, 0, openAngle, 0);
      }

      if (openHearthCount === 1) {
        const [tx, tz] = localToWorld(hi.x, hi.z, hi.rot, 0, doorPlane + 0.55);
        targets.push({ id: 'hearth-alcove', x: tx, y: hi.gy + 0.9, z: tz, range: 5.5 });
      }
    }

    if (i < 8) {
      const [sx, sz] = localToWorld(hi.x, hi.z, hi.rot, 0, hi.d * 0.5 + 0.34);
      sheltersRaw.push({
        kind: isOpenDoor ? 'porch' : 'eave',
        x: sx,
        z: sz,
        rx: isOpenDoor ? 1.15 : hi.w * 0.45,
        rz: isOpenDoor ? 0.68 : 0.48,
        rot: hi.rot,
        eaveY: hi.gy + hi.h - 0.1,
        roofY: hi.gy + hi.h + 1.2
      });
    }
  }

  const emberGeo = toGeometry(emberSk);
  const emberMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  emberMat.userData.skyIgnore = true;
  const emberMesh = new THREE.Mesh(emberGeo, emberMat);
  emberMesh.name = 'qin-han-hearth-embers';
  emberMesh.frustumCulled = true;

  // ============================================================================
  // 3. 「良田」立体田埂、映天浅水水田与自然错落水稻/粟黍（零额外 DrawCall）
  // ============================================================================
  const cBundSoil = '#76684E';
  const cBundSoilDark = '#695B43';
  const cBundCrown = '#6E8750';
  const cBundCrownAlt = '#748C55';

  function addBeveledBundEdge(ax, az, bx, bz, inX, inZ, segs, sluiceIdx = -1) {
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const x0e = ax + (bx - ax) * t0;
      const z0e = az + (bz - az) * t0;
      const x1e = ax + (bx - ax) * t1;
      const z1e = az + (bz - az) * t1;

      const crownLift = s === sluiceIdx ? 0.022 : 0.072;
      const crownColor = s === sluiceIdx
        ? cBundSoilDark
        : ((s & 1) === 0 ? cBundCrown : cBundCrownAlt);
      const soilOuterColor = (s & 1) === 0 ? cBundSoil : cBundSoilDark;

      // Cross-section offsets along inward normal (inX, inZ):
      // outerToe (-0.24) -> outerCrown (-0.09) -> innerCrown (+0.09) -> innerToe (+0.23)
      const oTx0 = x0e - inX * 0.24, oTz0 = z0e - inZ * 0.24;
      const oTx1 = x1e - inX * 0.24, oTz1 = z1e - inZ * 0.24;
      const oCx0 = x0e - inX * 0.09, oCz0 = z0e - inZ * 0.09;
      const oCx1 = x1e - inX * 0.09, oCz1 = z1e - inZ * 0.09;
      const iCx0 = x0e + inX * 0.09, iCz0 = z0e + inZ * 0.09;
      const iCx1 = x1e + inX * 0.09, iCz1 = z1e + inZ * 0.09;
      const iTx0 = x0e + inX * 0.23, iTz0 = z0e + inZ * 0.23;
      const iTx1 = x1e + inX * 0.23, iTz1 = z1e + inZ * 0.23;

      const pOT0 = [oTx0, surface(oTx0, oTz0) - 0.038, oTz0];
      const pOT1 = [oTx1, surface(oTx1, oTz1) - 0.038, oTz1];
      const pOC0 = [oCx0, surface(oCx0, oCz0) + fieldLift + crownLift, oCz0];
      const pOC1 = [oCx1, surface(oCx1, oCz1) + fieldLift + crownLift, oCz1];
      const pIC0 = [iCx0, surface(iCx0, iCz0) + fieldLift + crownLift, iCz0];
      const pIC1 = [iCx1, surface(iCx1, iCz1) + fieldLift + crownLift, iCz1];
      const pIT0 = [iTx0, surface(iTx0, iTz0) + fieldLift - 0.016, iTz0];
      const pIT1 = [iTx1, surface(iTx1, iTz1) + fieldLift - 0.016, iTz1];

      pushUpQuadPts(staticSk, pOT0, pOT1, pOC1, pOC0, soilOuterColor);
      pushUpQuadPts(staticSk, pOC0, pOC1, pIC1, pIC0, crownColor);
      pushUpQuadPts(staticSk, pIC0, pIC1, pIT1, pIT0, cBundSoil);
    }
  }

  const cropTransforms = [];
  const cropColors = [];
  const riceTints = ['#DDECC6', '#E8EEC2', '#D3E5BC', '#EFECC0'];
  const milletTints = ['#F7E9BF', '#FCEEC6', '#EDDAAA', '#FFF2CD'];
  const cropRand = lcg(55417);
  const fieldBlocks = world?.village?.fields?.blocks || [];
  const fieldLift = world?.village?.fields?.lift ?? 0.025;
  let cropMinX = Infinity, cropMaxX = -Infinity;
  let cropMinY = Infinity, cropMaxY = -Infinity;
  let cropMinZ = Infinity, cropMaxZ = -Infinity;
  let bundPlotCount = 0;
  let paddyPhenId = 'spring';

  const paddyPos = [];
  const paddyCol = [];
  const paddyNrm = [];
  const paddyUV = [];
  const _pcDeep = new THREE.Color('#BFDCD5');
  const _pcMid = new THREE.Color('#CBE2DB');
  const _pcShallow = new THREE.Color('#C5D7BC');
  function pushPaddyTri(ax, ay, az, ac, au, av, bx, by, bz, bc, bu, bv, cx, cy, cz, cc, cu, cv) {
    paddyPos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    paddyCol.push(ac.r, ac.g, ac.b, bc.r, bc.g, bc.b, cc.r, cc.g, cc.b);
    paddyNrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    paddyUV.push(au, av, bu, bv, cu, cv);
  }

  for (let bi = 0; bi < fieldBlocks.length; bi++) {
    const blk = fieldBlocks[bi];
    const pw = blk.plot[0];
    const ph = blk.plot[1];
    for (let r = 0; r < blk.rows; r++) {
      for (let c = 0; c < blk.cols; c++) {
        const x0 = blk.x + c * (pw + blk.gap);
        const z0 = blk.z - r * (ph + blk.gap);
        const isPaddy = (bi + r + c) % 3 !== 0;
        const plowedCfg = oxPlowingCfg.plowedPlot;
        const isPlowed = !!plowedCfg && bi === plowedCfg.block && r === plowedCfg.row && c === plowedCfg.col;

        // 3A. 3D beveled earthen bund ridges (田埂) hugging terrain around each plot
        const rimIn = 0.22;
        const rx0 = x0 + rimIn;
        const rx1 = x0 + pw - rimIn;
        const rz0 = z0 - rimIn;
        const rz1 = z0 - ph + rimIn;
        const sluiceSeg = isPaddy ? ((bi + r + c) % 5) + 1 : -1;
        addBeveledBundEdge(rx0, rz0, rx1, rz0, 0, -1, 6, sluiceSeg); // North bund
        addBeveledBundEdge(rx0, rz1, rx1, rz1, 0, 1, 6, -1);         // South bund
        addBeveledBundEdge(rx0, rz1, rx0, rz0, 1, 0, 4, -1);         // West bund
        addBeveledBundEdge(rx1, rz1, rx1, rz0, -1, 0, 4, -1);        // East bund
        if (isPaddy && (r + c) % 2 === 0) {
          // Small mossy sluice stone beside irrigation notch
          const sx = rx0 + (rx1 - rx0) * ((sluiceSeg + 0.5) / 6);
          const sz = rz0;
          putSolid(rockGeo, sx + 0.22, surface(sx + 0.22, sz) + fieldLift + 0.04, sz, 0.22, 0.14, 0.18, cStone, 0, (r + c) * 0.9, 0);
        }
        bundPlotCount++;

        if (isPaddy) {
          // 3B. Subdivided level-clamped paddy water mirror (4x3 grid = 24 tris per paddy plot)
          // Guaranteed >= +8mm above village-fields' flat plot quad (centerY + 0.028) so water never sinks under soil
          const wx0 = x0 + 0.30;
          const wx1 = x0 + pw - 0.30;
          const wz0 = z0 - 0.30;
          const wz1 = z0 - ph + 0.30;
          const plotFlatY = surface(x0 + pw * 0.5, z0 - ph * 0.5) + fieldLift + 0.036;
          const wLift = fieldLift + 0.034;
          const gxCount = 4;
          const gzCount = 3;
          for (let iz = 0; iz < gzCount; iz++) {
            const v0 = iz / gzCount;
            const v1 = (iz + 1) / gzCount;
            const za = wz0 + (wz1 - wz0) * v0;
            const zb = wz0 + (wz1 - wz0) * v1;
            for (let ix = 0; ix < gxCount; ix++) {
              const u0 = ix / gxCount;
              const u1 = (ix + 1) / gxCount;
              const xa = wx0 + (wx1 - wx0) * u0;
              const xb = wx0 + (wx1 - wx0) * u1;
              const colFor = (u, v) => {
                const edgeDist = Math.min(u, 1 - u, v, 1 - v);
                if (edgeDist < 0.03) return _pcShallow;
                return edgeDist > 0.26 ? _pcDeep : _pcMid;
              };
              const ya0 = Math.max(plotFlatY, surface(xa, za) + wLift);
              const yb0 = Math.max(plotFlatY, surface(xb, za) + wLift);
              const yb1 = Math.max(plotFlatY, surface(xb, zb) + wLift);
              const ya1 = Math.max(plotFlatY, surface(xa, zb) + wLift);
              const c00 = colFor(u0, v0);
              const c10 = colFor(u1, v0);
              const c11 = colFor(u1, v1);
              const c01 = colFor(u0, v1);
              // Note: wz1 < wz0 (-Z northward) while wx1 > wx0 (+X eastward), so CCW upward (+Y) winding is:
              // (xa, za) -> (xb, za) -> (xb, zb) and (xa, za) -> (xb, zb) -> (xa, zb)
              pushPaddyTri(xa, ya0, za, c00, u0, v0, xb, yb0, za, c10, u1, v0, xb, yb1, zb, c11, u1, v1);
              pushPaddyTri(xa, ya0, za, c00, u0, v0, xb, yb1, zb, c11, u1, v1, xa, ya1, zb, c01, u0, v1);
            }
          }
        }

        // 3C. Organic hand-planted tussocks with furrow meander, micro-jitter, tilt & ripeness patches
        const rows = isPaddy ? 5 : 4;
        const colsPerStrip = isPaddy ? 14 : 11;
        const marginX = isPaddy ? 0.64 : 0.68;
        const marginZ = isPaddy ? 0.54 : 0.50;
        const rh = (ph - marginZ * 2) / rows;
        const spanX = pw - marginX * 2;
        const plotPhase = cropRand() * TAU;
        const plotSkew = (cropRand() - 0.5) * 0.22;

        for (let k = 0; k < rows; k++) {
          const zBase = z0 - marginZ - (k + 0.5) * rh;
          const rowWavePhase = plotPhase + k * 0.85;
          for (let j = 0; j < colsPerStrip; j++) {
            const uRaw = (j + 0.5 + ((k & 1) ? 0.18 : -0.08)) / colsPerStrip;
            const u = Math.min(0.985, Math.max(0.015, uRaw + (cropRand() - 0.5) * 0.045));
            const meanderZ = Math.sin(u * Math.PI * 1.65 + rowWavePhase) * 0.14 + (u - 0.5) * plotSkew;
            const jitterX = (cropRand() - 0.5) * (isPaddy ? 0.24 : 0.34);
            const jitterZ = (cropRand() - 0.5) * (isPaddy ? 0.22 : 0.36);

            const cx = Math.min(x0 + pw - 0.50, Math.max(x0 + 0.50, x0 + marginX + u * spanX + jitterX));
            const cz = Math.min(z0 - 0.50, Math.max(z0 - ph + 0.50, zBase + meanderZ + jitterZ));
            const cy = surface(cx, cz) + fieldLift;

            // Gentle spatial fertility wave so tussock heights undulate naturally across each plot
            const patchVigour = 0.92 + 0.14 * Math.sin(cx * 0.28 + cz * 0.22 + plotPhase);
            const scXZ = ((isPaddy ? 0.74 : 0.84) + cropRand() * 0.30) * patchVigour;
            const scY = ((isPaddy ? 0.76 : 0.90) + cropRand() * 0.32) * patchVigour;
            const yaw = cropRand() * TAU;
            const tiltX = (cropRand() - 0.5) * 0.15;
            const tiltZ = (cropRand() - 0.5) * 0.15;

            if (!isPlowed) cropTransforms.push({ x: cx, y: cy, z: cz, sx: scXZ, sy: scY, sz: scXZ, yaw, tiltX, tiltZ });

            const pal = isPaddy ? riceTints : milletTints;
            const palIdx = Math.floor(cropRand() * pal.length);
            _col.set(pal[(palIdx + k) % pal.length]);
            const ripeShift = (cropRand() - 0.5) * 0.08;
            _col.r = Math.min(1, Math.max(0.35, _col.r + ripeShift));
            _col.g = Math.min(1, Math.max(0.38, _col.g + ripeShift * 0.7));
            _col.b = Math.min(1, Math.max(0.28, _col.b - ripeShift * 0.35));
            if (!isPlowed) {
              cropColors.push(_col.clone());
              if (cx < cropMinX) cropMinX = cx;
              if (cx > cropMaxX) cropMaxX = cx;
              if (cy < cropMinY) cropMinY = cy;
              if (cy + 1.18 > cropMaxY) cropMaxY = cy + 1.18;
              if (cz < cropMinZ) cropMinZ = cz;
              if (cz > cropMaxZ) cropMaxZ = cz;
            }
          }
        }
      }
    }
  }

  const staticGeo = toGeometry(staticSk);
  const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const staticMesh = new THREE.Mesh(staticGeo, staticMat);
  staticMesh.name = 'qin-han-completion-static';
  staticMesh.frustumCulled = true;
  group.add(staticMesh);
  group.add(emberMesh);

  const PADDY_NOON_C = inkWater.noon?.paddyRowContrast ?? 0.06;
  const PADDY_NOON_G = inkWater.noon?.paddySheetGain ?? 0.35;
  const paddyWaterUniforms = {
    uPaddyTime: { value: 0 },
    uPaddySunDir: { value: new THREE.Vector3(0.44, 0.72, 0.39) },
    uPaddyShimmer: { value: new THREE.Color('#E8F4EC') },
    uPaddyShimmerAmt: { value: 0.68 },
    uPaddySkyTop: { value: new THREE.Color('#B8D0DD') },
    uPaddySkyHorizon: { value: new THREE.Color('#E8ECE0') },
    uPaddyMist: { value: 0 },
    uPaddyRain: { value: 0 },
    uPaddyDay: { value: 0 }
  };
  const paddyWaterGeo = new THREE.BufferGeometry();
  paddyWaterGeo.setAttribute('position', new THREE.Float32BufferAttribute(paddyPos.length ? paddyPos : [0, -20, 0, 0, -20, 0.1, 0.1, -20, 0], 3));
  paddyWaterGeo.setAttribute('color', new THREE.Float32BufferAttribute(paddyCol.length ? paddyCol : [0.5, 0.6, 0.5, 0.5, 0.6, 0.5, 0.5, 0.6, 0.5], 3));
  paddyWaterGeo.setAttribute('normal', new THREE.Float32BufferAttribute(paddyNrm.length ? paddyNrm : [0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  paddyWaterGeo.setAttribute('aPaddyUV', new THREE.Float32BufferAttribute(paddyUV.length ? paddyUV : [0, 0, 0, 1, 1, 0], 2));
  paddyWaterGeo.computeBoundingBox();
  paddyWaterGeo.computeBoundingSphere();

  const paddyWaterMat = new THREE.MeshLambertMaterial({
    color: '#88BAA9',
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  paddyWaterMat.onBeforeCompile = shader => {
    shader.uniforms.uPaddyTime = paddyWaterUniforms.uPaddyTime;
    shader.uniforms.uPaddyDay = paddyWaterUniforms.uPaddyDay;
    shader.uniforms.uPaddySunDir = paddyWaterUniforms.uPaddySunDir;
    shader.uniforms.uPaddyShimmer = paddyWaterUniforms.uPaddyShimmer;
    shader.uniforms.uPaddyShimmerAmt = paddyWaterUniforms.uPaddyShimmerAmt;
    shader.uniforms.uPaddySkyTop = paddyWaterUniforms.uPaddySkyTop;
    shader.uniforms.uPaddySkyHorizon = paddyWaterUniforms.uPaddySkyHorizon;
    shader.uniforms.uPaddyMist = paddyWaterUniforms.uPaddyMist;
    shader.uniforms.uPaddyRain = paddyWaterUniforms.uPaddyRain;
    shader.vertexShader = 'attribute vec2 aPaddyUV;\nvarying vec3 vPaddyWPos;\nvarying vec2 vPaddyUV;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      'vPaddyWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPaddyUV = aPaddyUV;\n#include <project_vertex>'
    );
    shader.fragmentShader =
      'uniform float uPaddyTime;\nuniform vec3 uPaddySunDir;\nuniform vec3 uPaddyShimmer;\nuniform float uPaddyShimmerAmt;\nuniform vec3 uPaddySkyTop;\nuniform vec3 uPaddySkyHorizon;\nuniform float uPaddyMist;\nuniform float uPaddyRain;\nuniform float uPaddyDay;\nvarying vec3 vPaddyWPos;\nvarying vec2 vPaddyUV;\nfloat pNoonRowLo(float day, float c) {\n  return 0.84 - day * c;\n}\nfloat pNoonRowHi(float day, float c) {\n  return 1.06 + day * c;\n}\nfloat pNoonSheetGain(float day, float g) {\n  return 1.0 + day * g;\n}\n' +
      shader.fragmentShader;
    const paddyColorGlsl = `
      float pEdge = min(min(vPaddyUV.x, 1.0 - vPaddyUV.x), min(vPaddyUV.y, 1.0 - vPaddyUV.y));
      float pBankOpen = smoothstep(0.0, 0.13, pEdge);
      float pRowMirror = 0.64 + 0.36 * cos(vPaddyUV.y * 5.0 * 6.2831853);
      diffuseColor.rgb *= mix(pNoonRowLo(uPaddyDay, ${PADDY_NOON_C}), pNoonRowHi(uPaddyDay, ${PADDY_NOON_C}), pBankOpen * pRowMirror);
    `;
    if (shader.fragmentShader.includes('#include <color_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' + paddyColorGlsl
      );
    }
    const shimmerGlsl = `
      float pw1 = sin(vPaddyWPos.x * 2.35 + vPaddyWPos.z * 1.65 - uPaddyTime * 1.55);
      float pw2 = cos(vPaddyWPos.x * 1.75 - vPaddyWPos.z * 2.55 + uPaddyTime * 1.22);
      float pRainRing = sin(length(fract(vPaddyWPos.xz * 0.85) - 0.5) * 26.0 - uPaddyTime * 9.5) * uPaddyRain;
      float pRipple = 0.5 + 0.5 * (pw1 * 0.54 + pw2 * 0.40 + pRainRing * 0.35);
      vec3 pViewDir = normalize(cameraPosition - vPaddyWPos);
      vec3 pNormal = normalize(vec3((pw1 + pRainRing * 0.6) * 0.062, 1.0, (pw2 - pRainRing * 0.5) * 0.062));
      vec3 pHalf = normalize(normalize(uPaddySunDir) + pViewDir);
      float pSpec = pow(max(dot(pNormal, pHalf), 0.0), 17.0);
      float pFresnel = pow(1.0 - clamp(pViewDir.y, 0.0, 1.0), 2.15);
      float pMirrorMask = (0.55 + 0.45 * cos(vPaddyUV.y * 5.0 * 6.2831853)) * smoothstep(0.0, 0.12, min(min(vPaddyUV.x, 1.0 - vPaddyUV.x), min(vPaddyUV.y, 1.0 - vPaddyUV.y)));
      vec3 pSkyMirror = mix(uPaddySkyHorizon, uPaddySkyTop, clamp(0.18 + pViewDir.y * 1.15 + pw1 * 0.07, 0.0, 1.0));
      float pCloud = smoothstep(-0.22, 0.62, sin(vPaddyWPos.x * 0.11 + uPaddyTime * 0.09) * 0.6 + cos(vPaddyWPos.z * 0.09 - uPaddyTime * 0.07) * 0.4);
      vec3 pMistTone = mix(pSkyMirror, vec3(0.84, 0.92, 0.91), 0.58);
      vec3 pSkySheet = mix(pSkyMirror + vec3(0.05) * pCloud, pMistTone, uPaddyMist * 0.68) * (0.20 + 0.42 * pFresnel) * (0.62 + 0.38 * pMirrorMask) * pNoonSheetGain(uPaddyDay, ${PADDY_NOON_G});
      vec3 pGlint = pSkySheet + uPaddyShimmer * (pSpec * 0.48 + pRipple * pFresnel * 0.32 + pRipple * 0.08) * uPaddyShimmerAmt * (0.70 + 0.30 * pMirrorMask);
    `;
    if (shader.fragmentShader.includes('#include <opaque_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        shimmerGlsl + '\noutgoingLight += pGlint;\n#include <opaque_fragment>'
      );
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        shimmerGlsl + '\ngl_FragColor.rgb += pGlint;\n#include <fog_fragment>'
      );
    }
  };
  chainProgramCacheKey(paddyWaterMat, 'qin-han-paddy-water-v5');

  const paddyWaterMesh = new THREE.Mesh(paddyWaterGeo, paddyWaterMat);
  paddyWaterMesh.name = 'qin-han-paddy-water';
  paddyWaterMesh.visible = paddyPos.length > 0;
  paddyWaterMesh.renderOrder = 2;
  paddyWaterMesh.frustumCulled = true;
  group.add(paddyWaterMesh);

  const cropUniforms = {
    uCropTime: { value: 0 },
    uCropWind: { value: 0.5 }
  };
  const cropGeo = buildCropClumpGeometry();
  const cropMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  });
  cropMat.onBeforeCompile = shader => {
    shader.uniforms.uCropTime = cropUniforms.uCropTime;
    shader.uniforms.uCropWind = cropUniforms.uCropWind;
    shader.vertexShader = 'uniform float uCropTime;\nuniform float uCropWind;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 cOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float cWave = sin(uCropTime * 1.95 + cOrigin.x * 0.34 + cOrigin.z * 0.28) * 0.72
              + cos(uCropTime * 2.85 + cOrigin.x * 0.21 - cOrigin.z * 0.39) * 0.28;
  float cBend = clamp(position.y, 0.0, 1.3);
  cBend = cBend * cBend * uCropWind * 0.18;
  transformed.x += cWave * cBend;
  transformed.z += cWave * 0.45 * cBend;
#endif`
    );
  };
  chainProgramCacheKey(cropMat, 'qin-han-crop-wave-v1');

  const cropCount = cropTransforms.length;
  const cropMesh = new THREE.InstancedMesh(cropGeo, cropMat, Math.max(1, cropCount));
  cropMesh.name = 'qin-han-millet-crops';
  cropMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  cropMesh.frustumCulled = true;
  for (let i = 0; i < cropCount; i++) {
    const tr = cropTransforms[i];
    _euler.set(tr.tiltX, tr.yaw, tr.tiltZ, 'YXZ');
    _quat.setFromEuler(_euler);
    _mat.compose(_pos.set(tr.x, tr.y, tr.z), _quat, _scl.set(tr.sx, tr.sy, tr.sz));
    cropMesh.setMatrixAt(i, _mat);
    cropMesh.setColorAt(i, cropColors[i]);
  }
  cropMesh.count = cropCount;
  cropMesh.instanceMatrix.needsUpdate = true;
  if (cropMesh.instanceColor) cropMesh.instanceColor.needsUpdate = true;
  if (cropCount > 0) {
    const cx = (cropMinX + cropMaxX) * 0.5;
    const cy = (cropMinY + cropMaxY) * 0.5;
    const cz = (cropMinZ + cropMaxZ) * 0.5;
    cropMesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(cx, cy, cz),
      Math.hypot(cropMaxX - cropMinX, cropMaxY - cropMinY, cropMaxZ - cropMinZ) * 0.5 + 2.5
    );
    const mid = cropTransforms[Math.floor(cropCount * 0.45)];
    targets.push({ id: 'millet-field', x: mid.x, y: mid.y + 0.55, z: mid.z, range: 6.5 });
  }
  group.add(cropMesh);

  // ============================================================================
  // 4. 晴夜晒谷场篝火围坐、矮木食案与击缶欢歌
  // ============================================================================
  const hearth = qinHanHomestead?.layout?.hearth || { x: 44, y: surface(44, -128), z: -128 };
  const nightFeastGroup = new THREE.Group();
  nightFeastGroup.name = 'qin-han-night-feast';
  nightFeastGroup.visible = false;
  group.add(nightFeastGroup);

  const nightActorGroup = new THREE.Group();
  nightActorGroup.name = 'qin-han-night-feast-actors';
  nightFeastGroup.add(nightActorGroup);
  const nightActorRig = options.actorRig ? options.actorRig.createChannel(nightActorGroup, 3) : createCommunityActors(nightActorGroup, 3);

  const nightSk = createSink();
  const nightVillagers = [];
  const candidatesAngles = [0.65, 2.35, -1.35, 3.65, -2.55, 1.45];

  function isFeastSeatClear(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (surface(x, z) < (world?.terrain?.waterLevel ?? -1) + 0.4) return false;
    if (field?.slope && field.slope(x, z) > 0.36) return false;
    return blockers.every(b => boxDistance(x, z, b) > 0.62);
  }

  const chosenSeats = [];
  for (const ang of candidatesAngles) {
    if (chosenSeats.length >= 3) break;
    const dist = chosenSeats.length === 0 ? 1.55 : 1.72;
    const sx = hearth.x + Math.cos(ang) * dist;
    const sz = hearth.z + Math.sin(ang) * dist;
    if (isFeastSeatClear(sx, sz)) {
      chosenSeats.push({ x: sx, y: walkY(sx, sz), z: sz, ang });
    }
  }
  // Guaranteed fallback ring near hearth if site was crowded
  for (let i = 0; i < 3 && chosenSeats.length < 3; i++) {
    const ang = -0.8 + i * 2.1;
    const sx = hearth.x + Math.cos(ang) * 1.45;
    const sz = hearth.z + Math.sin(ang) * 1.45;
    chosenSeats.push({ x: sx, y: walkY(sx, sz), z: sz, ang });
  }

  // Open 4th straw mat spot for situational player communion ("围火夜话 · 晒场篝火")
  let guestMat = null;
  for (const ang of [-0.35, 1.48, -2.28, 3.12, -0.85]) {
    const mx = hearth.x + Math.cos(ang) * 1.68;
    const mz = hearth.z + Math.sin(ang) * 1.68;
    const clearOfVillagers = chosenSeats.every(s => Math.hypot(s.x - mx, s.z - mz) > 0.98);
    if (clearOfVillagers && isFeastSeatClear(mx, mz)) {
      guestMat = { x: mx, y: walkY(mx, mz), z: mz, seatY: 0.08 };
      break;
    }
  }
  if (!guestMat) {
    const fallbackAng = -0.35;
    const mx = hearth.x + Math.cos(fallbackAng) * 1.62;
    const mz = hearth.z + Math.sin(fallbackAng) * 1.62;
    guestMat = { x: mx, y: walkY(mx, mz), z: mz, seatY: 0.08 };
  }
  {
    const gYaw = Math.atan2(hearth.x - guestMat.x, hearth.z - guestMat.z);
    putSolid(cylGeo, guestMat.x, guestMat.y + 0.03, guestMat.z, 0.74, 0.05, 0.74, cMat, 0, gYaw, 0, nightSk);
    const cupX = guestMat.x + Math.sin(gYaw) * 0.44;
    const cupZ = guestMat.z + Math.cos(gYaw) * 0.44;
    putSolid(cylGeo, cupX, walkY(cupX, cupZ) + 0.055, cupZ, 0.13, 0.09, 0.13, '#9E4B37', 0, gYaw, 0, nightSk);
  }

  for (let i = 0; i < chosenSeats.length; i++) {
    const s = chosenSeats[i];
    const faceYaw = Math.atan2(hearth.x - s.x, hearth.z - s.z);
    // Seated straw mat (蒲团/草席)
    putSolid(cylGeo, s.x, s.y + 0.03, s.z, 0.72, 0.05, 0.72, cMat, 0, faceYaw, 0, nightSk);

    if (i === 0) {
      // Clay fou (陶缶) placed right in front of the fou singer
      const fx = s.x + Math.sin(faceYaw) * 0.52;
      const fz = s.z + Math.cos(faceYaw) * 0.52;
      const fy = walkY(fx, fz);
      putSolid(cylGeo, fx, fy + 0.16, fz, 0.36, 0.32, 0.36, cPottery, 0, 0, 0, nightSk);
      putSolid(cylGeo, fx, fy + 0.33, fz, 0.24, 0.05, 0.24, '#5A524B', 0, 0, 0, nightSk);
    } else {
      // Low Han wooden dining table (矮木食案) with clay jar & ear-cup in front of feasters
      const tx = s.x + Math.sin(faceYaw) * 0.58;
      const tz = s.z + Math.cos(faceYaw) * 0.58;
      const ty = walkY(tx, tz);
      putSolid(boxGeo, tx, ty + 0.21, tz, 0.74, 0.045, 0.44, cTimber, 0, faceYaw, 0, nightSk);
      for (const lx of [-0.28, 0.28]) {
        for (const lz of [-0.14, 0.14]) {
          const [px, pz] = localToWorld(tx, tz, -faceYaw, lx, lz);
          putSolid(boxGeo, px, ty + 0.10, pz, 0.05, 0.20, 0.05, cTimberLight, 0, faceYaw, 0, nightSk);
        }
      }
      putSolid(cylGeo, tx, ty + 0.28, tz, 0.14, 0.11, 0.14, '#A44F3B', 0, 0, 0, nightSk);
    }

    const isSinger = i === 0;
    const isFemale = i === 2;
    nightVillagers.push({
      id: isSinger ? 'qh-fou-singer' : `qh-night-feaster-${i}`,
      index: 12 + i,
      kind: isSinger ? 'elder' : 'worker',
      female: isFemale,
      role: isSinger ? 'fou_singer' : 'night_feaster',
      voiceRole: isSinger ? 'elder' : (i === 1 ? 'farmer' : 'woman'),
      mode: 'sit',
      x: s.x,
      y: s.y,
      z: s.z,
      yaw: faceYaw,
      restYaw: faceYaw,
      greetUntil: -10,
      greetX: s.x,
      greetZ: s.z,
      singer: isSinger,
      interactable: {
        id: isSinger ? 'qh-fou-singer' : `qh-night-feaster-${i}`,
        key: isSinger ? 'qh_fou_singer' : `qh_night_feaster_${i}`,
        x: s.x,
        y: s.y,
        z: s.z,
        female: isFemale,
        role: isSinger ? 'fou_singer' : 'night_feaster',
        voiceRole: isSinger ? 'elder' : (i === 1 ? 'farmer' : 'woman'),
        mode: 'sit',
        s: isSinger ? 0.94 : 1.0
      }
    });
  }

  const nightPropGeo = toGeometry(nightSk);
  const nightPropMesh = new THREE.Mesh(nightPropGeo, staticMat);
  nightPropMesh.name = 'qin-han-night-feast-props';
  nightPropMesh.frustumCulled = true;
  nightFeastGroup.add(nightPropMesh);

  // ============================================================================
  // 5. 茅亭、瓜庐、织棚与前屋檐下「雨帘水线 + 地面溅水涟漪」
  // ============================================================================
  const pavilionReg = (leisureGrove?.layout?.regions || []).find(r => r.kind === 'pavilion');
  if (pavilionReg) {
    sheltersRaw.unshift({
      kind: 'pavilion',
      x: pavilionReg.x,
      z: pavilionReg.z,
      rx: 2.25,
      rz: 2.25,
      rot: 0,
      eaveY: pavilionReg.y + 2.62,
      roofY: pavilionReg.y + 4.0
    });
  }
  const hutSite = qinHanHomestead?.layout?.fieldHut;
  if (hutSite) {
    sheltersRaw.push({
      kind: 'hut',
      x: hutSite.x,
      z: hutSite.z,
      rx: 1.50,
      rz: 1.40,
      rot: 0,
      eaveY: hutSite.y + 2.06,
      roofY: hutSite.y + 2.85
    });
  }
  const shedSite = qinHanHomestead?.layout?.weaving;
  if (shedSite) {
    sheltersRaw.push({
      kind: 'shed',
      x: shedSite.x,
      z: shedSite.z,
      rx: 1.85,
      rz: 1.45,
      rot: 0,
      eaveY: shedSite.y + 2.15,
      roofY: shedSite.y + 2.95
    });
  }
  for (const s of sheltersRaw) shelters.push(s);

  const dripPoints = [];
  for (const s of sheltersRaw) {
    const perEdge = s.kind === 'pavilion' ? 9 : (s.kind === 'porch' ? 4 : 5);
    const perimeterSpots = [];
    for (let k = 0; k < perEdge; k++) {
      const f = -0.92 + (2 * 0.92 * k) / Math.max(1, perEdge - 1);
      if (s.kind === 'pavilion' || s.kind === 'hut' || s.kind === 'shed') {
        perimeterSpots.push([f * s.rx, s.rz], [f * s.rx, -s.rz], [s.rx, f * s.rz], [-s.rx, f * s.rz]);
      } else {
        perimeterSpots.push([f * s.rx, s.rz]);
      }
    }
    for (const [lx, lz] of perimeterSpots) {
      const [wx, wz] = localToWorld(s.x, s.z, s.rot || 0, lx, lz);
      const gy = surface(wx, wz);
      dripPoints.push({
        x: wx,
        z: wz,
        topY: s.eaveY,
        floorY: gy,
        phase: rand(),
        speed: 0.82 + rand() * 0.38
      });
    }
  }

  // Tapered 2-segment droplet ribbon for softer, natural eave rain threads
  const streakGeo = new THREE.PlaneGeometry(0.024, 0.64, 1, 2);
  const sPos = streakGeo.attributes.position;
  const sColors = new Float32Array(sPos.count * 3);
  for (let i = 0; i < sPos.count; i++) {
    const py = sPos.getY(i);
    const isEnd = Math.abs(py) > 0.14;
    if (isEnd) {
      sPos.setX(i, sPos.getX(i) * 0.28);
      sColors[i * 3] = 0.68;
      sColors[i * 3 + 1] = 0.77;
      sColors[i * 3 + 2] = 0.83;
    } else {
      sColors[i * 3] = 0.82;
      sColors[i * 3 + 1] = 0.89;
      sColors[i * 3 + 2] = 0.94;
    }
  }
  streakGeo.setAttribute('color', new THREE.BufferAttribute(sColors, 3));
  streakGeo.computeBoundingBox();
  streakGeo.computeBoundingSphere();

  const curtainMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  curtainMat.userData.skyIgnore = true;

  const STREAK_COUNT = Math.min(120, dripPoints.length);
  const curtainMesh = new THREE.InstancedMesh(streakGeo, curtainMat, Math.max(1, STREAK_COUNT));
  curtainMesh.name = 'qin-han-rain-curtain';
  curtainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  curtainMesh.frustumCulled = true;
  curtainMesh.visible = false;
  for (let i = 0; i < STREAK_COUNT; i++) {
    const shade = 0.92 + (i % 5) * 0.02;
    curtainMesh.setColorAt(i, _col.setRGB(0.76 * shade, 0.85 * shade, 0.90 * shade));
  }
  if (curtainMesh.instanceColor) curtainMesh.instanceColor.needsUpdate = true;

  const splashGeo = new THREE.RingGeometry(0.10, 0.19, 12);
  splashGeo.rotateX(-Math.PI / 2);
  const splashNonIdx = splashGeo.toNonIndexed();
  splashGeo.dispose();
  const spColors = new Float32Array(splashNonIdx.attributes.position.count * 3);
  for (let i = 0; i < splashNonIdx.attributes.position.count; i++) {
    spColors[i * 3] = 0.78;
    spColors[i * 3 + 1] = 0.86;
    spColors[i * 3 + 2] = 0.91;
  }
  splashNonIdx.setAttribute('color', new THREE.BufferAttribute(spColors, 3));
  splashNonIdx.computeBoundingBox();
  splashNonIdx.computeBoundingSphere();

  const SPLASH_COUNT = Math.min(64, dripPoints.length);
  const splashMesh = new THREE.InstancedMesh(splashNonIdx, curtainMat, Math.max(1, SPLASH_COUNT));
  splashMesh.name = 'qin-han-rain-splashes';
  splashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  splashMesh.frustumCulled = true;
  splashMesh.visible = false;
  for (let i = 0; i < SPLASH_COUNT; i++) {
    splashMesh.setColorAt(i, _col.setRGB(0.82, 0.90, 0.94));
  }
  if (splashMesh.instanceColor) splashMesh.instanceColor.needsUpdate = true;

  if (dripPoints.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of dripPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.floorY < minY) minY = p.floorY;
      if (p.topY > maxY) maxY = p.topY;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const sphere = new THREE.Sphere(
      new THREE.Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5),
      Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 + 2
    );
    curtainMesh.boundingSphere = sphere.clone();
    splashMesh.boundingSphere = sphere;
  }
  group.add(curtainMesh, splashMesh);

  let simTime = 0;
  let nightActive = false;
  let disposed = false;

  function renderNightActors(sky, playerState) {
    nightActorRig.begin();
    for (const v of nightVillagers) {
      let targetYaw = v.restYaw;
      if (v.greetUntil > simTime && Number.isFinite(v.greetX)) {
        targetYaw = Math.atan2(v.greetX - v.x, v.greetZ - v.z);
      } else if (playerState && Math.hypot(playerState.x - v.x, playerState.z - v.z) < 5.5) {
        targetYaw = Math.atan2(playerState.x - v.x, playerState.z - v.z);
      }
      let dy = targetYaw - v.yaw;
      while (dy > Math.PI) dy -= TAU;
      while (dy < -Math.PI) dy += TAU;
      v.yaw += dy * 0.14;
      v.interactable.x = v.x;
      v.interactable.y = v.y;
      v.interactable.z = v.z;

      // Place shoes cleanly atop the 0.055m woven straw mat so soles never sink into mat or threshing floor
      nightActorRig.actor(v.x, v.y + 0.056, v.z, v.yaw, v.interactable.s);
      const beat = Math.sin(simTime * 7.4 + v.index * 1.1);
      if (v.singer) {
        nightActorRig.human(v, {
          crouch: 0.72,
          lean: 0.14 + Math.max(0, beat) * 0.08,
          left: [-0.14, 0.54 + Math.max(0, beat) * 0.14, 0.44],
          right: [0.14, 0.54 + Math.max(0, -beat) * 0.14, 0.44],
          headTurn: Math.sin(simTime * 1.6) * 0.14,
          nod: 0.08 + beat * 0.08,
          walk: 0
        });
      } else {
        const sway = Math.sin(simTime * 2.2 + v.index);
        nightActorRig.human(v, {
          crouch: 0.72,
          lean: 0.08 + sway * 0.05,
          left: [-0.20, 0.68 + Math.max(0, beat) * 0.08, 0.34],
          right: [0.16, 0.80 + Math.sin(simTime * 2.5 + v.index) * 0.10, 0.38],
          headTurn: sway * 0.18,
          nod: 0.05 + beat * 0.05,
          walk: 0
        });
      }
    }
    nightActorRig.finish();
  }

  function animate(sky, playerState) {
    const w = readWeather(sky);
    cropUniforms.uCropTime.value = simTime;
    cropUniforms.uCropWind.value = Math.max(0.22, Math.min(1.8, 0.35 + w.wind * 1.15));

    // 水田浅水面随天时与云雾微调色温（晓泛晨雾冷碧微绯，昼映青玉留白，暮染暖金桃霞，夜涵月华银靛，雨漾烟青微澜）
    if (paddyWaterMesh.visible) {
      paddyWaterUniforms.uPaddyTime.value = simTime;
      const app = sky?.getAppearance?.();
      const tw = sky?.getTwilightState?.();
      if (tw?.direction && Number.isFinite(tw.direction.x)) {
        paddyWaterUniforms.uPaddySunDir.value.copy(tw.direction).normalize();
      } else if (w.timeId === 'dusk') {
        paddyWaterUniforms.uPaddySunDir.value.set(-0.68, 0.30, 0.42).normalize();
      } else if (w.timeId === 'dawn') {
        paddyWaterUniforms.uPaddySunDir.value.set(0.68, 0.32, 0.40).normalize();
      } else if (w.isTrueNight) {
        paddyWaterUniforms.uPaddySunDir.value.set(-0.28, 0.78, -0.45).normalize();
      } else {
        paddyWaterUniforms.uPaddySunDir.value.set(0.44, 0.72, 0.39).normalize();
      }

      const duskAmt = Math.max(tw?.dusk ?? 0, w.timeId === 'dusk' ? 0.90 : 0);
      const dawnAmt = Math.max(tw?.dawn ?? 0, w.timeId === 'dawn' ? 0.88 : 0);
      const nightAmt = Math.max(Number.isFinite(app?.night) ? app.night : 0, w.isTrueNight ? 1 : 0);
      const rainDamp = Math.min(1, w.rain * 1.1);
      const skyMist = Math.max(0, Math.min(1, Number(sky?.mistIntensity ?? (app?.weatherId === 'mist' ? 0.85 : 0)) || 0));

      const parseHex = raw => (typeof raw === 'string' && raw.length >= 6) ? (raw.startsWith('#') ? raw : '#' + raw) : null;
      const liveTop = parseHex(app?.skyTop);
      const liveBot = parseHex(app?.skyBottom);
      if (liveTop) paddyWaterUniforms.uPaddySkyTop.value.set(liveTop);
      else if (w.timeId === 'dusk') paddyWaterUniforms.uPaddySkyTop.value.set('#8D88A8');
      else if (w.timeId === 'dawn') paddyWaterUniforms.uPaddySkyTop.value.set('#94B6C6');
      else if (w.isTrueNight) paddyWaterUniforms.uPaddySkyTop.value.set('#233246');
      else paddyWaterUniforms.uPaddySkyTop.value.set('#B8D0DD');

      if (liveBot) paddyWaterUniforms.uPaddySkyHorizon.value.set(liveBot);
      else if (w.timeId === 'dusk') paddyWaterUniforms.uPaddySkyHorizon.value.set('#EEAD7E');
      else if (w.timeId === 'dawn') paddyWaterUniforms.uPaddySkyHorizon.value.set('#E6D0C6');
      else if (w.isTrueNight) paddyWaterUniforms.uPaddySkyHorizon.value.set('#3C5068');
      else paddyWaterUniforms.uPaddySkyHorizon.value.set('#E8ECE0');

      let baseR = 0.49, baseG = 0.74, baseB = 0.66;
      let shimR = 0.90, shimG = 0.96, shimB = 0.94;
      let shimAmt = 0.70;
      let targetOpacity = 0.66;
      let mistVeil = skyMist * 0.72;

      if (nightAmt > 0.45 && duskAmt < 0.25 && dawnAmt < 0.25) {
        // 夜：月华银靛
        const nk = Math.min(1, nightAmt);
        baseR = baseR * (1 - nk) + 0.38 * nk;
        baseG = baseG * (1 - nk) + 0.51 * nk;
        baseB = baseB * (1 - nk) + 0.70 * nk;
        shimR = 0.64; shimG = 0.76; shimB = 0.92;
        shimAmt = 0.56;
        targetOpacity = 0.65;
      } else if (duskAmt >= dawnAmt && duskAmt > 0.04) {
        // 暮：暖金桃霞映田畴
        const k = Math.min(1, duskAmt);
        baseR = baseR * (1 - k) + 0.89 * k;
        baseG = baseG * (1 - k) + 0.60 * k;
        baseB = baseB * (1 - k) + 0.40 * k;
        shimR = 1.00; shimG = 0.77; shimB = 0.48;
        shimAmt = 0.70 + k * 0.34;
        targetOpacity = 0.66 + k * 0.06;
        paddyWaterUniforms.uPaddySkyHorizon.value.lerp(_col.set('#F4B27A'), 0.45 * k);
      } else if (dawnAmt > 0.04) {
        // 晓：晨雾冷碧微绯（清冷翠青水底配天际微粉晨光）
        const k = Math.min(1, dawnAmt);
        baseR = baseR * (1 - k) + 0.50 * k;
        baseG = baseG * (1 - k) + 0.71 * k;
        baseB = baseB * (1 - k) + 0.73 * k;
        shimR = 0.95; shimG = 0.85; shimB = 0.82;
        shimAmt = 0.66 + k * 0.16;
        targetOpacity = 0.66 + k * 0.04;
        mistVeil = Math.max(mistVeil, 0.44 * k);
        paddyWaterUniforms.uPaddySkyTop.value.lerp(_col.set('#8EB6C4'), 0.48 * k);
      }

      if (rainDamp > 0.08) {
        const slate = w.isTrueNight ? 0.38 : 0.62;
        const rk = rainDamp * 0.56;
        baseR = baseR * (1 - rk) + slate * 0.85 * rk;
        baseG = baseG * (1 - rk) + slate * 0.95 * rk;
        baseB = baseB * (1 - rk) + slate * 1.00 * rk;
        shimAmt *= (1 - rainDamp * 0.38);
        targetOpacity = Math.min(0.72, targetOpacity + rainDamp * 0.05);
        mistVeil = Math.max(mistVeil, rainDamp * 0.32);
      }

      if (paddyPhenId === 'summer') {
        baseR *= 0.80;
        baseG = Math.min(1, baseG * 1.07);
        baseB *= 0.94;
        shimAmt = Math.min(1, shimAmt * 1.12);
      } else if (paddyPhenId === 'autumn') {
        // 秋收：水田浅干显暖金秋畴影
        const ak = 0.64;
        baseR = baseR * (1 - ak) + 0.72 * ak;
        baseG = baseG * (1 - ak) + 0.56 * ak;
        baseB = baseB * (1 - ak) + 0.30 * ak;
        shimAmt *= 0.42;
        targetOpacity = Math.max(0.46, targetOpacity - 0.14);
      } else if (paddyPhenId === 'winter') {
        // 冬：田水收为淡冰面，微光近乎冻住
        const wk = 0.78;
        baseR = baseR * (1 - wk) + 0.80 * wk;
        baseG = baseG * (1 - wk) + 0.86 * wk;
        baseB = baseB * (1 - wk) + 0.88 * wk;
        shimAmt *= 0.35;
        targetOpacity = Math.min(0.80, targetOpacity + 0.10);
        mistVeil = Math.max(mistVeil, 0.30);
      }

      paddyWaterMat.color.setRGB(baseR, baseG, baseB);
      paddyWaterMat.opacity = targetOpacity;
      paddyWaterUniforms.uPaddyShimmer.value.setRGB(shimR, shimG, shimB);
      paddyWaterUniforms.uPaddyShimmerAmt.value = shimAmt;
      paddyWaterUniforms.uPaddyMist.value = Math.min(1, mistVeil);
      paddyWaterUniforms.uPaddyRain.value = Math.min(1, w.rain);
      const paddyDayBase = w.timeId === 'day' ? 1 : w.timeId === 'dawn' ? 0.35 : 0;
      paddyWaterUniforms.uPaddyDay.value = Math.max(0, Math.min(1, paddyDayBase * (1 - rainDamp * 0.7)));
    }

    // Hearth ember flicker (modulate color rather than mesh Y scale so world-baked coals stay anchored)
    if (emberAnchors.length) {
      const f = 0.88 + Math.sin(simTime * 7.2) * 0.12;
      emberMat.color.setRGB(1, 0.82 * f + 0.18, 0.68 * f + 0.18);
    }

    // Clear-night bonfire gatherers
    nightActive = w.isNight && w.rain < 0.25 && nightVillagers.length > 0;
    nightFeastGroup.visible = nightActive;
    if (nightActive) {
      renderNightActors(sky, playerState);
    }

    // Softer natural rain curtains & splashes under pavilion / eaves
    const rainActive = w.rain > 0.04 && dripPoints.length > 0;
    curtainMesh.visible = rainActive;
    splashMesh.visible = rainActive;
    if (rainActive) {
      const nightDim = w.isTrueNight ? 0.66 : 1.0;
      curtainMat.opacity = Math.min(0.42, 0.14 + w.rain * 0.28) * nightDim;
      const tiltZ = Math.max(-0.22, Math.min(0.22, w.windX * 0.11));
      const tiltX = Math.max(-0.22, Math.min(0.22, w.windZ * 0.11));
      const fallRate = 1.48 + w.rain * 1.25;
      for (let i = 0; i < STREAK_COUNT; i++) {
        const dp = dripPoints[i % dripPoints.length];
        const f = (simTime * fallRate * (dp.speed || 1) + dp.phase) % 1;
        const span = Math.max(0.5, dp.topY - dp.floorY);
        const y = dp.topY - f * span * 0.92;
        const envelope = 0.45 + 0.55 * Math.sin(f * Math.PI);
        const lenScale = (0.42 + w.rain * 0.64) * envelope;
        const widScale = 0.72 + 0.28 * envelope;
        _euler.set(tiltX, (i * 0.7) % Math.PI, tiltZ);
        _quat.setFromEuler(_euler);
        _mat.compose(_pos.set(dp.x + w.windX * f * 0.14, y, dp.z + w.windZ * f * 0.14), _quat, _scl.set(widScale, lenScale, widScale));
        curtainMesh.setMatrixAt(i, _mat);
      }
      curtainMesh.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < SPLASH_COUNT; i++) {
        const dp = dripPoints[i % dripPoints.length];
        const f = (simTime * 2.05 * (dp.speed || 1) + dp.phase * 1.37) % 1;
        const sc = (0.30 + f * 1.35) * (0.42 + w.rain * 0.58) * Math.sin(f * Math.PI);
        _quat.identity();
        _mat.compose(_pos.set(dp.x, dp.floorY + 0.032, dp.z), _quat, _scl.set(Math.max(0.05, sc), 1, Math.max(0.05, sc)));
        splashMesh.setMatrixAt(i, _mat);
      }
      splashMesh.instanceMatrix.needsUpdate = true;
    }
  }

  animate(null, null);

  function update(dt, elapsed, sky, playerState) {
    if (disposed) return;
    const step = livingStep(dt);
    if (step <= 0) return;
    simTime += step;
    animate(sky, playerState);
  }

  function getInteractables() {
    if (!nightActive || disposed) return [];
    return nightVillagers.map(v => v.interactable);
  }

  function greet(id, px, pz, dur = 3.5) {
    for (const v of nightVillagers) {
      if (v.id === id) {
        v.greetUntil = simTime + dur;
        v.greetX = px;
        v.greetZ = pz;
      }
    }
  }

  function getNightFeastState() {
    return {
      active: nightActive,
      x: hearth.x,
      y: hearth.y,
      z: hearth.z,
      guestMat: guestMat ? { ...guestMat } : null
    };
  }

  function getStats() {
    let drawCalls = 0;
    let triangles = 0;
    for (const m of [staticMesh, emberMesh, cropMesh, paddyWaterMesh, curtainMesh, splashMesh]) {
      if (!m || !m.geometry) continue;
      if (m.visible) drawCalls++;
      const t = (m.geometry.index?.count || m.geometry.attributes.position.count) / 3;
      triangles += t * (m.isInstancedMesh ? m.count : 1);
    }
    const nightActorStats = nightActive ? (nightActorRig.stats?.() || { triangles: 0, drawCalls: 0 }) : { triangles: 0, drawCalls: 0 };
    if (nightActive && nightPropMesh.visible) {
      drawCalls++;
      triangles += (nightPropGeo.attributes.position.count) / 3;
    }
    return {
      built: true,
      skirtCount,
      bundPlotCount,
      houseDressedCount,
      openHearthCount,
      cropInstances: cropCount,
      shelters: shelters.length,
      dripPoints: dripPoints.length,
      nightFeastActive: nightActive,
      nightVillagers: nightVillagers.length,
      rainCurtainVisible: curtainMesh.visible,
      drawCalls: drawCalls + nightActorStats.drawCalls,
      triangles: Math.round(triangles + nightActorStats.triangles),
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    nightActorRig.dispose();
    staticGeo.dispose();
    staticMat.dispose();
    emberGeo.dispose();
    emberMat.dispose();
    cropGeo.dispose();
    cropMat.dispose();
    paddyWaterGeo.dispose();
    paddyWaterMat.dispose();
    nightPropGeo.dispose();
    streakGeo.dispose();
    splashNonIdx.dispose();
    curtainMat.dispose();
    boxGeo.dispose();
    cylGeo.dispose();
    rockGeo.dispose();
    group.removeFromParent();
  }

  return {
    group,
    targets,
    shelters,
    update,
    setPhenology(id) {
      paddyPhenId = (id === 'summer' || id === 'autumn' || id === 'winter') ? id : 'spring';
    },
    getInteractables,
    greet,
    getNightFeastState,
    getStats,
    dispose
  };
}
