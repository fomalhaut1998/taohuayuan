import * as THREE from 'three';
import wildsCfg from '../data/outer-wilds.json' with { type: 'json' };
import deepHollowsCfg from '../data/deep-hollows.json' with { type: 'json' };
import { createCommunityActors } from '../systems/community-actors.js';
import { habitatSurface, createHabitatContext } from './habitat-details.js';
import { createRigidBatchMesh } from './qin-han-fauna-geometry.js';
import {
  createVertexColorBaker as createRawBaker,
  buildCliffPineGeometry,
  buildBlossomTreeGeometry,
  buildHillsideBambooGeometry,
  buildTeaOrHerbShrubGeometry,
  buildStratifiedCragGeometry,
  buildMeadowTuftGeometry,
  buildWaterFxGeometry
} from './valley-borderlands-geometry.js';

function createVertexColorBaker() {
  const raw = createRawBaker();
  const tagMap = new Map();
  return {
    ...raw,
    buildGeometry(key) {
      const mat = new THREE.MeshBasicMaterial();
      const mesh = raw.buildMesh(key, mat, key);
      mat.dispose();
      if (!mesh) {
        const empty = new THREE.BufferGeometry();
        empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
        empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
        empty.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
        tagMap.set(key, []);
        return empty;
      }
      tagMap.set(key, mesh.userData.colorTags || []);
      return mesh.geometry;
    },
    getTags(key) {
      return tagMap.get(key) || [];
    }
  };
}

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function makeRng(seed, tag = '') {
  let s = (seed >>> 0) || 20261118;
  for (let i = 0; i < tag.length; i++) {
    s = Math.imul(s ^ tag.charCodeAt(i), 16777619) >>> 0;
  }
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function segDist(x, z, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1);
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

function polyDist(x, z, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = segDist(x, z, pts[i - 1], pts[i]);
    if (d < best) best = d;
  }
  return best;
}

function boxDistance(x, z, b) {
  const c = Math.cos(b.rot || 0);
  const s = Math.sin(b.rot || 0);
  const dx = x - b.x;
  const dz = z - b.z;
  return Math.hypot(
    Math.max(0, Math.abs(dx * c - dz * s) - (b.hw || 0)),
    Math.max(0, Math.abs(dx * s + dz * c) - (b.hd || 0))
  );
}

function smoothPolyline(pts, subdiv = 5) {
  if (!pts || pts.length < 2) return pts ? pts.slice() : [];
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        2 * p1[0] +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
      );
      const z = 0.5 * (
        2 * p1[1] +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
      );
      out.push([x, z]);
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

// Painterly scalloped foliage cloud (outward normals, flat-shaded ink-wash silhouette, zero raw octahedrons)
function addScallopedCloud(baker, key, cx, cy, cz, rx, ry, rz, sides, cTop, cMid, cBot, phase = 0) {
  const eq = [];
  const hi = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * TAU;
    const lobe = i % 2 === 0 ? 1.06 : 0.84;
    const ca = Math.cos(a), sa = Math.sin(a);
    eq.push([cx + ca * rx * lobe, cy - ry * 0.14 + (i % 2) * ry * 0.08, cz + sa * rz * lobe]);
    hi.push([cx + ca * rx * lobe * 0.62, cy + ry * 0.56 + ((i + 1) % 2) * ry * 0.07, cz + sa * rz * lobe * 0.62]);
  }
  const apex = [cx, cy + ry * 0.94, cz];
  const under = [cx, cy - ry * 0.42, cz];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    baker.addQuad(key, eq[j], eq[i], hi[i], hi[j], cMid, 0.02);
    baker.addTri(key, apex[0], apex[1], apex[2], hi[j][0], hi[j][1], hi[j][2], hi[i][0], hi[i][1], hi[i][2], cTop, 0.04);
    baker.addTri(key, under[0], under[1], under[2], eq[i][0], eq[i][1], eq[i][2], eq[j][0], eq[j][1], eq[j][2], cBot, -0.03);
  }
}

// Revolved pottery / dome profile with outward normals
function addRevolvedShell(baker, key, cx, by, cz, profile, segs, yaw, hexTop, hexBot, capTop = false) {
  const cTop = new THREE.Color(hexTop);
  const cBot = new THREE.Color(hexBot || hexTop);
  const cMix = new THREE.Color();
  const rings = profile.map(([r, y]) => Array.from({ length: segs }, (_, i) => {
    const a = yaw + (i / segs) * TAU;
    return [cx + Math.cos(a) * r, by + y, cz + Math.sin(a) * r];
  }));
  const maxY = Math.max(0.01, profile[profile.length - 1][1]);
  for (let k = 0; k < rings.length - 1; k++) {
    const t = clamp((profile[k][1] + profile[k + 1][1]) * 0.5 / maxY, 0, 1);
    cMix.copy(cBot).lerp(cTop, t);
    const r0 = rings[k], r1 = rings[k + 1];
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      baker.addQuad(key, r0[j], r0[i], r1[i], r1[j], cMix);
    }
  }
  if (capTop) {
    const last = profile[profile.length - 1];
    const ctr = [cx, by + last[1] + 0.02, cz];
    const rT = rings[rings.length - 1];
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      baker.addTri(key, ctr[0], ctr[1], ctr[2], rT[j][0], rT[j][1], rT[j][2], rT[i][0], rT[i][1], rT[i][2], cTop, 0.03);
    }
  }
}

// Two-tier concave hipped/gable Qin-Han thatched roof with ridge pole & thick fascia eaves
function addHippedThatchRoof(baker, key, toLocal, hw, hd, eaveY, ridgeY, ridgeHalfX, cLight, cMid, cDark) {
  const mY = lerp(eaveY, ridgeY, 0.46);
  const mW = lerp(hw, Math.max(0.18, ridgeHalfX), 0.52);
  const mD = hd * 0.50;
  const ePts = [toLocal(-hw, eaveY, hd), toLocal(hw, eaveY, hd), toLocal(hw, eaveY, -hd), toLocal(-hw, eaveY, -hd)];
  const eDn = [toLocal(-hw, eaveY - 0.11, hd), toLocal(hw, eaveY - 0.11, hd), toLocal(hw, eaveY - 0.11, -hd), toLocal(-hw, eaveY - 0.11, -hd)];
  const mPts = [toLocal(-mW, mY, mD), toLocal(mW, mY, mD), toLocal(mW, mY, -mD), toLocal(-mW, mY, -mD)];
  const rL = toLocal(-ridgeHalfX, ridgeY, 0);
  const rR = toLocal(ridgeHalfX, ridgeY, 0);
  // Lower concave eaves apron + fascia thickness
  for (let k = 0; k < 4; k++) {
    const nk = (k + 1) % 4;
    baker.addQuad(key, ePts[k], ePts[nk], mPts[nk], mPts[k], k % 2 === 0 ? cLight : cMid, 0.02);
    baker.addQuad(key, ePts[k], eDn[k], eDn[nk], ePts[nk], cDark, -0.04);
  }
  // Upper hipped slopes (South, North, East, West)
  baker.addQuad(key, mPts[0], mPts[1], rR, rL, cMid, 0.01);
  baker.addQuad(key, mPts[2], mPts[3], rL, rR, cMid, 0.01);
  baker.addTri(key, mPts[1][0], mPts[1][1], mPts[1][2], mPts[2][0], mPts[2][1], mPts[2][2], rR[0], rR[1], rR[2], cLight, 0.02);
  baker.addTri(key, mPts[3][0], mPts[3][1], mPts[3][2], mPts[0][0], mPts[0][1], mPts[0][2], rL[0], rL[1], rL[2], cLight, 0.02);
  // Bound thatch ridge pole
  baker.addBeam(key, toLocal(-ridgeHalfX - 0.16, ridgeY + 0.04, 0), toLocal(ridgeHalfX + 0.16, ridgeY + 0.04, 0), 0.095, 0.095, 6, cLight, cDark, true);
}

// 山野枫香 / 乌桕（曲干疏枝 + 五叠水墨花瓣云冠，春青绿、夏翠浓、秋染丹砂流金、冬疏枝微霜）
function buildMountainMapleGeometry(pal) {
  const baker = createVertexColorBaker();
  const barkTop = '#665140';
  const barkBot = pal.bark || '#4A3B30';

  baker.addBeam('m', [0, -0.14, 0], [0.08, 0.85, -0.04], 0.16, 0.115, 5, barkBot, barkTop, false);
  baker.addBeam('m', [0.07, 0.80, -0.04], [-0.04, 1.54, 0.03], 0.112, 0.082, 5, barkTop, barkTop, false);
  baker.addBeam('m', [-0.02, 1.38, 0.02], [-0.58, 2.34, 0.22], 0.076, 0.036, 4, barkTop, barkTop, false);
  baker.addBeam('m', [-0.02, 1.44, 0.02], [0.56, 2.54, -0.22], 0.078, 0.038, 4, barkTop, barkTop, false);
  baker.addBeam('m', [-0.03, 1.52, 0.02], [0.06, 2.92, 0.26], 0.066, 0.030, 4, barkTop, barkTop, false);
  baker.addBeam('m', [0.02, 1.72, 0.0], [-0.14, 2.24, -0.46], 0.052, 0.026, 4, barkTop, barkTop, false);

  const pads = [
    { x: -0.62, y: 2.46, z: 0.24, rx: 0.96, ry: 0.44, rz: 0.88, s: 6, cTop: '#84AC66', cMid: '#6E9653', cBot: '#4E723E' },
    { x: 0.60, y: 2.68, z: -0.24, rx: 1.02, ry: 0.48, rz: 0.92, s: 6, cTop: '#8FB56E', cMid: '#769E59', cBot: '#547843' },
    { x: 0.06, y: 3.10, z: 0.24, rx: 0.92, ry: 0.46, rz: 0.84, s: 6, cTop: '#9AC077', cMid: '#7FA760', cBot: '#5B8048' },
    { x: -0.18, y: 2.34, z: -0.50, rx: 0.74, ry: 0.36, rz: 0.70, s: 5, cTop: '#7BA35E', cMid: '#648B4B', cBot: '#476938' },
    { x: 0.24, y: 2.32, z: 0.56, rx: 0.68, ry: 0.34, rz: 0.64, s: 5, cTop: '#86AE67', cMid: '#6E9553', cBot: '#4E713D' }
  ];
  baker.withTag('maple-crown', () => {
    for (let p = 0; p < pads.length; p++) {
      const pd = pads[p];
      addScallopedCloud(baker, 'm', pd.x, pd.y, pd.z, pd.rx, pd.ry, pd.rz, pd.s, pd.cTop, pd.cMid, pd.cBot, p * 0.9 + 0.3);
    }
  });
  return baker.buildGeometry('m');
}

// 呦鹿双件刚体（解剖放样体态、两节屈膝修长四肢蹄部 + 曲线颈首双耳与分叉鹿角）
function createSikaDeerParts(pal) {
  const bBody = createVertexColorBaker();
  const coat = pal.deerCoat || '#B9895B';
  const coatHi = '#CE9E6E';
  const belly = pal.deerBelly || '#E6DAC6';
  const legDark = '#826040';
  const hoof = '#3F3831';

  // Organic multi-segment ribcage, chest brisket & graceful haunch
  bBody.addBeam('d', [0, 0.57, -0.26], [0, 0.61, 0.20], 0.135, 0.148, 7, coat, coatHi, true);
  bBody.addBeam('d', [0, 0.56, 0.14], [0, 0.63, 0.30], 0.132, 0.105, 6, belly, coatHi, true);
  bBody.addBeam('d', [0, 0.59, -0.20], [0, 0.55, -0.35], 0.128, 0.088, 6, coat, coatHi, true);
  // White heart-shaped rump & flicking white tail
  bBody.addBeam('d', [0, 0.57, -0.33], [0, 0.67, -0.42], 0.048, 0.020, 5, '#F4EFE4', '#ECE5D6', true);
  // 4 slender two-segment articulated legs with knees/hocks and dark cloven hooves
  const legs = [
    [-0.082, 0.21, 0.015], [0.082, 0.21, -0.015],
    [-0.088, -0.24, -0.032], [0.088, -0.24, -0.018]
  ];
  for (const [lx, lz, kneeOff] of legs) {
    const kz = lz + kneeOff;
    bBody.addBeam('d', [lx * 1.06, 0.53, lz], [lx, 0.28, kz], 0.048, 0.028, 5, coat, legDark, false);
    bBody.addBeam('d', [lx, 0.29, kz], [lx, 0.045, lz + kneeOff * 0.3], 0.026, 0.020, 5, legDark, '#6E5035', false);
    bBody.addCylinder('d', lx, 0.024, lz + kneeOff * 0.3 + 0.008, 0.022, 0.026, 0.048, 5, 0, hoof, hoof);
  }
  // Subtle cream sika spots along flanks
  for (const [sx, sy, sz] of [
    [-0.132, 0.65, 0.08], [0.132, 0.65, 0.10],
    [-0.138, 0.63, -0.04], [0.138, 0.63, -0.02],
    [-0.128, 0.64, -0.16], [0.128, 0.64, -0.14]
  ]) {
    bBody.addCylinder('d', sx, sy, sz, 0.016, 0.016, 0.028, 5, 0.4, '#F1EAD9', '#F1EAD9');
  }

  const bHead = createVertexColorBaker();
  // Pivot at base of neck (0, 0, 0) -> graceful arched neck, sculpted cranium & tapered muzzle
  bHead.addBeam('h', [0, -0.03, -0.01], [0, 0.16, 0.06], 0.072, 0.056, 6, belly, coatHi, false);
  bHead.addBeam('h', [0, 0.14, 0.05], [0, 0.30, 0.12], 0.056, 0.048, 6, coat, coatHi, true);
  bHead.addBeam('h', [0, 0.32, 0.10], [0, 0.29, 0.25], 0.064, 0.042, 6, coatHi, belly, true);
  bHead.addBeam('h', [0, 0.29, 0.23], [0, 0.26, 0.34], 0.040, 0.026, 5, coat, belly, true);
  bHead.addCylinder('h', 0, 0.262, 0.348, 0.024, 0.022, 0.028, 5, 0, hoof, hoof);
  // Leaf-shaped alert ears
  for (const s of [-1, 1]) {
    bHead.addBeam('h', [s * 0.046, 0.35, 0.12], [s * 0.125, 0.43, 0.09], 0.026, 0.008, 4, coat, belly, true);
  }
  // Sculpted 3-tine branching antlers (鹿角)
  for (const s of [-1, 1]) {
    const a0 = [s * 0.036, 0.36, 0.14];
    const a1 = [s * 0.082, 0.47, 0.10];
    const a2 = [s * 0.126, 0.59, 0.03];
    const a3 = [s * 0.112, 0.68, 0.08];
    bHead.addBeam('h', a0, a1, 0.014, 0.011, 4, '#D8CEB8', '#B8AB90', false);
    bHead.addBeam('h', a1, a2, 0.011, 0.008, 4, '#DFD6C3', '#C4B89E', false);
    bHead.addBeam('h', a2, a3, 0.008, 0.004, 4, '#EAE3D2', '#DFD6C3', false);
    bHead.addBeam('h', a1, [s * 0.068, 0.53, 0.20], 0.009, 0.004, 3, '#E5DEC9', '#D2C7AE', false);
    bHead.addBeam('h', a2, [s * 0.165, 0.65, -0.02], 0.007, 0.003, 3, '#EAE3D2', '#DFD6C3', false);
  }

  return {
    bodyGeo: bBody.buildGeometry('d'),
    headGeo: bHead.buildGeometry('h'),
    headPivot: [0, 0.66, 0.28]
  };
}

export function createOuterWilds(options = {}) {
  const cfg = options.config || wildsCfg;
  const pal = cfg.palette;
  const { world, field, distanceToRiver, riverCurve, cliff, village, valleyBorderlands } = options;

  const group = new THREE.Group();
  group.name = 'outer-wilds';

  const interiorGroup = new THREE.Group();
  interiorGroup.name = 'outer-wilds-interior';
  const exteriorGroup = new THREE.Group();
  exteriorGroup.name = 'outer-wilds-exterior';
  // Named 'valley-borderlands' so optimizeStaticVisibility applies lossless per-instance frustum + fog compaction
  const sharedGroup = new THREE.Group();
  sharedGroup.name = 'valley-borderlands';
  group.add(interiorGroup, exteriorGroup, sharedGroup);

  const surface = (x, z) => (field ? habitatSurface(field, x, z) : 0);
  const rawGround = (x, z) => (field?.sample ? field.sample(x, z) : 0);
  const slopeAt = (x, z) => (field?.slope ? field.slope(x, z) : 0);

  const basin = world?.terrain?.basin || { x: 30, z: -140, inner: 96, outer: 168 };
  const pondCfg = world?.terrain?.pond || { x: 68, z: -152, radius: 13, waterY: 0.85 };
  const waterLevel = world?.terrain?.waterLevel ?? -1;
  const slitX = cliff?.slit?.x ?? 23;
  const slitZ = cliff?.slit?.z ?? -10;
  const halfBound = (field?.half || 400) - 10;

  const hab = createHabitatContext(options);
  const resCircles = hab.reservations.circles.map(c => ({ ...c }));
  const resBoxes = hab.reservations.boxes.map(b => ({ ...b }));
  const resCorridors = hab.reservations.corridors.map(c => ({ ...c }));

  if (valleyBorderlands?.layout) {
    const vbl = valleyBorderlands.layout;
    for (const p of vbl.paths || []) {
      if (p.points?.length >= 2) resCorridors.push({ points: p.points, half: (p.width || 1.4) * 0.5 + 0.5 });
    }
    if (vbl.brook?.points?.length >= 2) {
      resCorridors.push({ points: vbl.brook.points, half: (vbl.brook.width || 1.8) * 0.5 + 1.0 });
    }
    for (const key of ['cloudPavilion', 'sunningTerrace', 'ancientStele', 'watchtower', 'herbCottage', 'eastPasture']) {
      const lm = vbl[key];
      if (lm && Number.isFinite(lm.x) && Number.isFinite(lm.z)) {
        resCircles.push({ x: lm.x, z: lm.z, r: (lm.radius || 4.0) + 1.2 });
      }
    }
  }

  if (deepHollowsCfg?.enabled !== false) {
    for (const s of Object.values(deepHollowsCfg.sanctuaries || {})) {
      if (s && Number.isFinite(s.x) && Number.isFinite(s.z)) {
        resCircles.push({ x: s.x, z: s.z, r: 11.0 });
      }
    }
    for (const tr of deepHollowsCfg.trails || []) {
      if (tr?.points?.length >= 2) {
        resCorridors.push({ points: smoothPolyline(tr.points, 4), half: (tr.width || 1.3) * 0.5 + 0.75 });
      }
    }
  }

  const blockers = [];
  const targets = [];
  const woodDecks = [];
  const interactiveSites = [];
  const shelters = [];
  const restSeats = [];

  const baker = createVertexColorBaker();
  const rillBaker = createVertexColorBaker();

  // ============================================================================
  // 1. 远郊烟岚山脚环 (Seamless foothill collar r=368..452 hiding square ±400 rim)
  // ============================================================================
  let collarGeo = null;
  {
    const collarBaker = createVertexColorBaker();
    const segU = 128;
    const segV = 4;
    const cInner = new THREE.Color('#8BA37C');
    const cMid = new THREE.Color('#9CB09A');
    const cOuter = new THREE.Color(pal.foothillMist || '#B2C2BC');
    const mixC = new THREE.Color();

    const grid = [];
    for (let iu = 0; iu <= segU; iu++) {
      const ang = (iu / segU) * TAU;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const maxAxis = Math.max(Math.abs(ca), Math.abs(sa)) || 1;
      const squareEdgeR = Math.min(392, 386 / maxAxis);
      const r0 = squareEdgeR - 18;
      const r1 = 456;
      const h0 = rawGround(ca * r0, sa * r0) - 0.35;
      const swell = 6.5 * Math.sin(ang * 5.0 + 0.9) + 4.2 * Math.cos(ang * 9.0 - 0.5);
      const row = [];
      for (let iv = 0; iv <= segV; iv++) {
        const v = iv / segV;
        const r = lerp(r0, r1, v);
        const arch = Math.sin(v * Math.PI) * (5.5 + swell * 0.45);
        const y = lerp(h0, -16.0, v * v) + arch;
        row.push([ca * r, y, sa * r, v]);
      }
      grid.push(row);
    }
    for (let iu = 0; iu < segU; iu++) {
      for (let iv = 0; iv < segV; iv++) {
        const p00 = grid[iu][iv];
        const p10 = grid[iu + 1][iv];
        const p11 = grid[iu + 1][iv + 1];
        const p01 = grid[iu][iv + 1];
        const vm = (p00[3] + p11[3]) * 0.5;
        if (vm < 0.5) mixC.copy(cInner).lerp(cMid, vm * 2);
        else mixC.copy(cMid).lerp(cOuter, (vm - 0.5) * 2);
        collarBaker.addQuad('collar', p00, p10, p11, p01, mixC);
      }
    }
    collarGeo = collarBaker.buildGeometry('collar');
    const collarMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    collarMesh.name = 'outer-wilds-foothill-collar';
    collarMesh.matrixAutoUpdate = false;
    collarMesh.updateMatrix();
    sharedGroup.add(collarMesh);
  }

  // ============================================================================
  // 2. 山樵幽径 (7 winding footpaths & flagstone trails into East/NE/West wilds)
  // ============================================================================
  const builtTrails = [];
  const rngTrail = makeRng(cfg.seed, 'wild-trails');
  baker.withTag('ow-trail', () => {
    for (const tr of cfg.trails || []) {
      const pts = smoothPolyline(tr.points, 5);
      builtTrails.push({ id: tr.id, kind: tr.kind || 'dirt', width: tr.width, points: pts });
      resCorridors.push({ points: pts, half: tr.width * 0.5 + 0.55 });

      const hw = tr.width * 0.5;
      const isStone = tr.kind === 'flagstone';
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const ya = surface(a[0], a[1]) + 0.048;
        const yb = surface(b[0], b[1]) + 0.048;
        const w0 = hw * (0.90 + 0.18 * Math.sin(i * 0.9));
        const w1 = hw * (0.90 + 0.18 * Math.sin((i + 1) * 0.9));

        const pL0 = [a[0] + nx * w0, ya - 0.015, a[1] + nz * w0];
        const pM0 = [a[0], ya + 0.016, a[1]];
        const pR0 = [a[0] - nx * w0, ya - 0.015, a[1] - nz * w0];
        const pL1 = [b[0] + nx * w1, yb - 0.015, b[1] + nz * w1];
        const pM1 = [b[0], yb + 0.016, b[1]];
        const pR1 = [b[0] - nx * w1, yb - 0.015, b[1] - nz * w1];

        const coreCol = isStone ? (i % 2 === 0 ? pal.flagstone : pal.stoneLight) : pal.trailEarth;
        const edgeCol = isStone ? pal.stone : pal.trailEdge;
        baker.addQuad('static', pL0, pM0, pM1, pL1, i % 3 === 0 ? edgeCol : coreCol);
        baker.addQuad('static', pM0, pR0, pR1, pM1, coreCol);

        if (isStone && i % 2 === 0) {
          const mx = (a[0] + b[0]) * 0.5 + (rngTrail() - 0.5) * 0.18;
          const mz = (a[1] + b[1]) * 0.5 + (rngTrail() - 0.5) * 0.18;
          const my = surface(mx, mz) + 0.055;
          baker.addBox('static', mx, my, mz, w0 * 1.15, 0.05, Math.min(0.65, len * 0.72), Math.atan2(dx, dz), pal.stoneLight, pal.stoneDark);
        }
      }
    }
  });

  // ============================================================================
  // 3. 东涧清溪与独木山桥 (Cascading East Rill + Split-Log Footbridge)
  // ============================================================================
  const rillPts = smoothPolyline(cfg.rill.points, 6);
  resCorridors.push({ points: rillPts, half: cfg.rill.width * 0.5 + 1.1 });
  const rillDroplets = [];
  {
    const baseRw = cfg.rill.width * 0.5;
    const segCount = Math.max(1, rillPts.length - 1);
    const widthAt = (idx) => {
      const u = idx / segCount;
      const endTaper = Math.pow(Math.sin(clamp(u, 0.03, 0.97) * Math.PI), 0.45);
      const poolPulse = 0.72 + 0.44 * Math.sin(idx * 0.62 + 0.8) + 0.20 * Math.cos(idx * 1.35);
      return baseRw * endTaper * poolPulse;
    };
    for (let i = 0; i < segCount; i++) {
      const a = rillPts[i];
      const b = rillPts[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const ya = surface(a[0], a[1]);
      const yb = surface(b[0], b[1]);
      const rw0 = widthAt(i);
      const rw1 = widthAt(i + 1);

      // Recessed mossy shingle bed
      const bedA = ya + 0.022;
      const bedB = yb + 0.022;
      baker.addQuad(
        'static',
        [a[0] + nx * (rw0 + 0.38), bedA, a[1] + nz * (rw0 + 0.38)],
        [a[0] - nx * (rw0 + 0.38), bedA, a[1] - nz * (rw0 + 0.38)],
        [b[0] - nx * (rw1 + 0.38), bedB, b[1] - nz * (rw1 + 0.38)],
        [b[0] + nx * (rw1 + 0.38), bedB, b[1] + nz * (rw1 + 0.38)],
        i % 2 === 0 ? '#657564' : '#73826E'
      );

      // Translucent celadon-jade mountain brook sheet
      const wa = ya + 0.068;
      const wb = yb + 0.068;
      const wCol = (ya - yb) > 0.16 ? pal.waterFoam : (i % 3 === 0 ? '#84B0A4' : pal.water);
      rillBaker.addQuad(
        'rill',
        [a[0] + nx * rw0, wa, a[1] + nz * rw0],
        [a[0] - nx * rw0, wa, a[1] - nz * rw0],
        [b[0] - nx * rw1, wb, b[1] - nz * rw1],
        [b[0] + nx * rw1, wb, b[1] + nz * rw1],
        wCol
      );

      // Clustered mossy boulders & bank stones breaking the shoreline rhythm
      if (i % 2 === 0) {
        const side = (i % 4 === 0) ? 1 : -1;
        const rx = a[0] + nx * side * (rw0 + 0.26);
        const rz = a[1] + nz * side * (rw0 + 0.26);
        const scaleR = 0.38 + (i % 3) * 0.18;
        baker.withTag('frost-cap', () => {
          baker.addFacetedRock('static', rx, ya - 0.04, rz, scaleR * 1.15, scaleR * 0.62, scaleR, i * 0.9, 300 + i, {
            sides: 6,
            stoneDark: pal.stoneDark,
            stoneMid: pal.stone,
            moss: pal.moss
          });
        });
      }
      if (i % 4 === 1) {
        rillDroplets.push({ x0: a[0], y0: wa + 0.04, z0: a[1], x1: b[0], y1: wb + 0.04, z1: b[1] });
      }
    }
    // Springhead mossy rock grotto & lower mossy soak-pool boulders
    const head = rillPts[0];
    const foot = rillPts[rillPts.length - 1];
    baker.withTag('frost-cap', () => {
      baker.addFacetedRock('static', head[0] + 0.6, surface(head[0], head[1]) - 0.1, head[1] + 0.4, 1.35, 0.95, 1.15, 0.5, 901, { sides: 7 });
      baker.addFacetedRock('static', foot[0] - 0.5, surface(foot[0], foot[1]) - 0.1, foot[1] - 0.4, 1.15, 0.68, 1.05, 1.2, 902, { sides: 7 });
    });
  }

  // Split-log footbridge (东涧独木山桥)
  {
    const br = cfg.sanctuaries.logBridge;
    const by = Math.max(surface(br.x - 2.0, br.z - 0.8), surface(br.x + 2.0, br.z + 0.8)) + 0.28;
    const cy = Math.cos(br.yaw);
    const sy = Math.sin(br.yaw);
    const toW = (lx, ly, lz) => [br.x + lx * cy + lz * sy, by + ly, br.z - lx * sy + lz * cy];

    // Two-tier chamfered bluestone bridge abutments with tapered wing stones
    for (const endZ of [-br.length * 0.46, br.length * 0.46]) {
      const pBase = toW(0, -0.26, endZ);
      const pCap = toW(0, -0.07, endZ);
      baker.addBox('static', pBase[0], pBase[1], pBase[2], br.width + 0.62, 0.28, 0.84, br.yaw, pal.stone, pal.stoneDark);
      baker.addBox('static', pCap[0], pCap[1], pCap[2], br.width + 0.40, 0.12, 0.64, br.yaw, pal.stoneLight, pal.stone);
      for (const sideX of [-1, 1]) {
        const pWing = toW(sideX * (br.width * 0.5 + 0.34), -0.18, endZ + Math.sign(endZ) * 0.26);
        baker.addBox('static', pWing[0], pWing[1], pWing[2], 0.34, 0.24, 0.46, br.yaw + sideX * 0.32, pal.stone, pal.stoneDark);
      }
    }
    // Three transverse under-log mortise cross-ties binding the split cedar logs
    for (const tz of [-br.length * 0.34, 0, br.length * 0.34]) {
      const lift = tz === 0 ? -0.14 : -0.16;
      baker.addBeam('static', toW(-0.62, lift, tz), toW(0.62, lift, tz), 0.068, 0.068, 5, pal.timberDark, pal.bark, true);
    }
    // Two adzed split-cedar logs side-by-side
    for (const sideX of [-0.30, 0.30]) {
      const p0 = toW(sideX, 0.0, -br.length * 0.5);
      const p1 = toW(sideX, 0.04, 0);
      const p2 = toW(sideX, 0.0, br.length * 0.5);
      baker.withTag('frost-cap', () => {
        baker.addBeam('static', p0, p1, 0.24, 0.25, 6, '#8B6F4C', pal.timberDark, true);
        baker.addBeam('static', p1, p2, 0.25, 0.24, 6, '#8B6F4C', pal.timberDark, true);
      });
    }
    // Crafted single-side lashed bamboo handrail (posts + node collars + top & mid rails + diagonal end struts)
    const postZ = [-br.length * 0.42, 0, br.length * 0.42];
    const railTops = [];
    const railMids = [];
    for (const pz of postZ) {
      const base = toW(0.58, -0.05, pz);
      const mid = toW(0.59, 0.46, pz);
      const top = toW(0.60, 0.88, pz);
      railTops.push(top);
      railMids.push(mid);
      baker.addBeam('static', base, top, 0.046, 0.040, 5, pal.bambooCulm, pal.timberDark, true);
      baker.addCylinder('static', top[0], top[1] + 0.02, top[2], 0.052, 0.048, 0.04, 6, 0, pal.timberDark, pal.bark);
    }
    baker.addBeam('static', railTops[0], railTops[1], 0.044, 0.044, 5, '#9CB070', pal.bambooCulm, true);
    baker.addBeam('static', railTops[1], railTops[2], 0.044, 0.044, 5, '#9CB070', pal.bambooCulm, true);
    baker.addBeam('static', railMids[0], railMids[1], 0.028, 0.028, 4, pal.bambooCulm, pal.timberDark, true);
    baker.addBeam('static', railMids[1], railMids[2], 0.028, 0.028, 4, pal.bambooCulm, pal.timberDark, true);
    baker.addBeam('static', toW(0.58, 0.10, postZ[0]), toW(0.59, 0.46, postZ[0] + 0.52), 0.024, 0.024, 4, pal.timberDark, pal.bark, true);
    baker.addBeam('static', toW(0.58, 0.10, postZ[2]), toW(0.59, 0.46, postZ[2] - 0.52), 0.024, 0.024, 4, pal.timberDark, pal.bark, true);

    // Herb-gatherer's rimmed bamboo basket on two-tier boulder beside bridge
    const bPos = toW(-1.25, -0.12, 1.35);
    const bGround = surface(bPos[0], bPos[2]);
    baker.addBox('static', bPos[0], bGround + 0.14, bPos[2], 0.78, 0.28, 0.66, 0.4, pal.stoneLight, pal.stoneDark);
    baker.addCylinder('static', bPos[0], bGround + 0.40, bPos[2], 0.21, 0.15, 0.26, 8, 0, '#BC9E63', '#8A7142');
    baker.addCylinder('static', bPos[0], bGround + 0.535, bPos[2], 0.23, 0.22, 0.036, 8, 0, pal.timberDark, '#A68850');
    baker.addCone('static', bPos[0], bGround + 0.60, bPos[2], 0.18, 0.11, 7, 0.3, '#6B9654', '#4F7740');

    resCircles.push({ x: br.x, z: br.z, r: br.radius + 1.2 });
    woodDecks.push({
      x: br.x,
      z: br.z,
      tx: sy,
      tz: cy,
      ux: cy,
      uz: -sy,
      length: br.length,
      width: br.width + 0.3,
      endY0: by + 0.24,
      endY1: by + 0.24,
      arch: 0.04,
      bevelL: 0.45,
      bevelW: 0.22,
      material: 'wood'
    });
    targets.push({ id: br.id, x: br.x, y: by + 0.95, z: br.z, range: 8.5 });
    interactiveSites.push({
      id: br.id,
      name: br.name,
      action: br.action,
      lines: br.lines,
      soundKind: 'water',
      x: br.x,
      y: by,
      z: br.z,
      height: 0.85,
      lineIdx: 0,
      cooldown: 0
    });
  }

  // ============================================================================
  // 4. 东岭 · 烂柯松弈台 (Lanke Ancient Stone Chess Crag at 156, -164)
  // ============================================================================
  {
    const lk = cfg.sanctuaries.lankeCrag;
    const ly = surface(lk.x, lk.z);
    resCircles.push({ x: lk.x, z: lk.z, r: lk.radius + 1.8 });

    // Natural stepped mossy flagstone platform with deep hillside skirt (zero floating lip on slope)
    baker.withTag('frost-cap', () => {
      baker.addCylinder('static', lk.x, ly - 0.24, lk.z, 3.15, 3.65, 0.98, 9, 0.22, pal.stoneLight, pal.stoneDark);
      baker.addCylinder('static', lk.x + 0.15, ly + 0.28, lk.z - 0.10, 2.35, 2.55, 0.14, 8, 0.55, pal.flagstone, pal.stone);
    });

    // Sculpted flat-topped chess boulder table ('烂柯青石枰' with carved base collar & cornice bevel)
    const tblY = ly + 0.35;
    baker.addCylinder('static', lk.x, tblY + 0.04, lk.z, 0.66, 0.72, 0.09, 8, 0.3, pal.stoneDark, pal.stoneDark);
    baker.addCylinder('static', lk.x, tblY + 0.26, lk.z, 0.60, 0.50, 0.44, 7, 0.3, pal.stone, pal.stoneDark);
    baker.addCylinder('static', lk.x, tblY + 0.48, lk.z, 0.72, 0.60, 0.07, 8, 0.3, pal.stoneLight, pal.stone);
    baker.withTag('frost-cap', () => {
      baker.addBox('static', lk.x, tblY + 0.55, lk.z, 1.18, 0.10, 1.12, 0.12, '#B6BCB0', pal.stone);
    });
    // Incised dark-ink board frame & subtle black/white river-stone pieces ("残局")
    baker.addBox('static', lk.x, tblY + 0.606, lk.z, 0.76, 0.012, 0.76, 0.12, '#6A7066', '#6A7066');
    baker.addBox('static', lk.x, tblY + 0.614, lk.z, 0.70, 0.010, 0.70, 0.12, '#AEB5A8', '#AEB5A8');
    const stones = [
      [-0.18, -0.14, '#2A2D2A'], [0.14, -0.18, '#F0EDE2'], [-0.06, 0.08, '#2A2D2A'],
      [0.19, 0.12, '#F0EDE2'], [0.04, -0.05, '#2A2D2A'], [-0.20, 0.16, '#F0EDE2'],
      [0.09, 0.21, '#2A2D2A']
    ];
    for (const [sx, sz, scol] of stones) {
      baker.addCylinder('static', lk.x + sx, tblY + 0.63, lk.z + sz, 0.032, 0.036, 0.022, 6, 0, scol, scol);
    }

    // Two carved mossy stone drum stools anchored cleanly onto terrace top tblY (no hillside sink/swallow!)
    for (const [dx, dz] of [[-1.08, 0.19], [1.04, -0.22]]) {
      baker.addCylinder('static', lk.x + dx, tblY + 0.18, lk.z + dz, 0.23, 0.27, 0.36, 7, 0.4, pal.stone, pal.mossDeep);
      baker.addCylinder('static', lk.x + dx, tblY + 0.38, lk.z + dz, 0.25, 0.23, 0.05, 7, 0.4, pal.stoneLight, pal.stone);
    }
    // Revolved hourglass calabash wine gourd ('素匏葫芦') with crimson silk waist tie & wood stopper
    addRevolvedShell(baker, 'static', lk.x - 0.40, tblY + 0.60, lk.z + 0.34, [
      [0.042, 0.0], [0.084, 0.055], [0.072, 0.105], [0.034, 0.145], [0.054, 0.195], [0.022, 0.245], [0.016, 0.268]
    ], 7, 0.3, '#DFB56C', '#9E7438', true);
    baker.addCylinder('static', lk.x - 0.40, tblY + 0.745, lk.z + 0.34, 0.039, 0.039, 0.018, 7, 0.3, '#A84336', '#86342A');
    baker.addCylinder('static', lk.x - 0.40, tblY + 0.875, lk.z + 0.34, 0.014, 0.016, 0.024, 6, 0.3, pal.timberDark, pal.timberDark);

    // Solid grounded bluestone stairs descending to west & south trails + mossy terrace-rim accent rocks (keeping SW LOS clear)
    for (let st = 0; st < 3; st++) {
      const sx = lk.x - 2.72 - st * 0.46;
      const sz = lk.z + 0.42 + st * 0.10;
      const sy = lerp(tblY - 0.08, surface(sx, sz) + 0.05, (st + 1) / 3.2);
      baker.addBox('static', sx, sy - 0.22, sz, 0.56, 0.48, 1.08, -0.18, pal.flagstone, pal.stoneDark);
    }
    for (let st = 0; st < 2; st++) {
      const sx = lk.x + 0.12 + st * 0.08;
      const sz = lk.z + 2.95 + st * 0.48;
      const sy = lerp(tblY - 0.12, surface(sx, sz) + 0.05, (st + 1) / 2.2);
      baker.addBox('static', sx, sy - 0.22, sz, 1.04, 0.48, 0.54, 0.06, pal.flagstone, pal.stoneDark);
    }
    for (const [rx, rz, rRad, rH, rRot] of [
      [-1.55, -2.05, 0.62, 0.58, 0.4],
      [1.05, -2.18, 0.54, 0.52, 1.2],
      [2.12, -0.82, 0.52, 0.48, 2.1]
    ]) {
      const ry = Math.max(tblY, surface(lk.x + rx, lk.z + rz)) + rH * 0.30;
      baker.addFacetedRock('static', lk.x + rx, ry, lk.z + rz, rRad, rH, rRad * 0.84, rRot, 410 + Math.round(rx * 17), {
        base: pal.stone,
        dark: pal.stoneDark,
        light: pal.stoneLight,
        moss: pal.moss,
        sides: 6,
        hasMoss: true
      });
    }

    blockers.push({ x: lk.x, z: lk.z, hw: 0.62, hd: 0.60, rot: 0.12, minY: ly, maxY: tblY + 0.64, source: 'ow-lanke' });
    targets.push({ id: lk.id, x: lk.x, y: tblY + 0.92, z: lk.z, range: 9.0 });
    interactiveSites.push({
      id: lk.id,
      name: lk.name,
      action: lk.action,
      lines: lk.lines,
      soundKind: 'stone',
      x: lk.x,
      y: tblY + 0.55,
      z: lk.z,
      height: 0.45,
      lineIdx: 0,
      cooldown: 0
    });
  }

  // ============================================================================
  // 5. 东北山阿 · 秦汉古陶窑 (Ancient Hillside Pottery Kiln at 136.5, -221.5)
  // ============================================================================
  const kiln = cfg.sanctuaries.climbingKiln;
  const kilnY = surface(kiln.x, kiln.z);
  let kilnChimneyTop = [kiln.x, kilnY + 3.1, kiln.z];
  let kilnFireboxWorld = [kiln.x, kilnY + 0.45, kiln.z];
  {
    resCircles.push({ x: kiln.x, z: kiln.z, r: kiln.radius + 2.2 });
    const cr = Math.cos(kiln.rot);
    const sr = Math.sin(kiln.rot);
    const toK = (lx, ly, lz) => [kiln.x + lx * cr + lz * sr, kilnY + ly, kiln.z - lx * sr + lz * cr];

    // Grounded stone-and-earth retaining kiln yard terrace (deep hillside skirt eliminates any floating lip!)
    baker.addCylinder('static', kiln.x, kilnY - 0.56, kiln.z, 4.45, 5.15, 1.42, 10, kiln.rot, pal.stone, pal.stoneDark);
    baker.addCylinder('static', kiln.x, kilnY + 0.12, kiln.z, 4.22, 4.38, 0.14, 10, kiln.rot, pal.trailEarth, pal.trailEdge);

    // Sculpted Qin-Han vaulted bun-kiln dome ('馒头窑依坡叠筑', charred stone plinth + brick waist belt + mud-brick curve)
    const domeBase = toK(0, 0.16, -0.35);
    baker.addCylinder('static', domeBase[0], domeBase[1] + 0.11, domeBase[2], 1.92, 2.02, 0.24, 10, kiln.rot, pal.stoneDark, pal.kilnSoot);
    baker.withTag('frost-cap', () => {
      addRevolvedShell(baker, 'static', domeBase[0], domeBase[1], domeBase[2], [
        [1.86, 0.0], [1.80, 0.36], [1.66, 0.95], [1.32, 1.50], [0.76, 1.88], [0.22, 2.04]
      ], 10, kiln.rot, '#CBB592', pal.kilnBrick, true);
    });
    baker.addCylinder('static', domeBase[0], domeBase[1] + 0.86, domeBase[2], 1.70, 1.74, 0.13, 10, kiln.rot, '#A46F4F', pal.kilnBrick);

    // Tapered hexagonal rear brick chimney flue with 4 vent piers & pitched clay smoke rain-cap
    const chimPos = toK(0, 0.16, -1.85);
    addRevolvedShell(baker, 'static', chimPos[0], chimPos[1], chimPos[2], [
      [0.44, 0.0], [0.36, 1.25], [0.30, 2.48], [0.38, 2.60], [0.36, 2.74], [0.26, 2.74]
    ], 6, kiln.rot, pal.kilnBrick, pal.kilnSoot, false);
    for (const [vx, vz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
      const vp = toK(vx, 0.16 + 2.83, -1.85 + vz);
      baker.addBox('static', vp[0], vp[1], vp[2], 0.075, 0.19, 0.075, kiln.rot, pal.kilnBrick, pal.kilnSoot);
    }
    baker.addCone('static', chimPos[0], chimPos[1] + 2.98, chimPos[2], 0.48, 0.16, 6, kiln.rot, '#926D52', pal.kilnSoot);
    kilnChimneyTop = [chimPos[0], chimPos[1] + 3.10, chimPos[2]];

    // Arched brick firebox tunnel + corbeled brick crown + bluestone hearth apron + recessed charcoal mouth
    const fbPos = toK(0, 0.16, 1.28);
    for (const s of [-1, 1]) {
      const jamb = toK(s * 0.38, 0.54, 1.28);
      baker.addBox('static', jamb[0], jamb[1], jamb[2], 0.30, 0.76, 0.62, kiln.rot, pal.kilnBrick, pal.kilnSoot);
    }
    const lintel = toK(0, 1.00, 1.28);
    baker.addBox('static', lintel[0], lintel[1], lintel[2], 1.12, 0.22, 0.68, kiln.rot, '#A67856', pal.kilnBrick);
    const archCrown = toK(0, 1.16, 1.26);
    baker.addBox('static', archCrown[0], archCrown[1], archCrown[2], 0.74, 0.12, 0.58, kiln.rot, '#B58460', pal.kilnBrick);
    const apronP = toK(0, 0.20, 1.72);
    baker.addBox('static', apronP[0], apronP[1], apronP[2], 1.18, 0.08, 0.52, kiln.rot, pal.flagstone, pal.stoneDark);
    const hearthPos = toK(0, 0.42, 1.44);
    baker.addBox('static', hearthPos[0], hearthPos[1], hearthPos[2], 0.54, 0.54, 0.22, kiln.rot, '#3A2820', '#241A16');
    kilnFireboxWorld = toK(0, 0.34, 1.62);
    // Two freshly fired Qin-Han ceramic amphorae resting beside the kiln mouth
    for (const [ax, az, col] of [[-1.12, 1.38, pal.potteryGrey], [1.15, 1.34, pal.potteryRed]]) {
      const ap = toK(ax, 0.18, az);
      addRevolvedShell(baker, 'static', ap[0], ap[1], ap[2], [
        [0.10, 0.0], [0.21, 0.16], [0.19, 0.32], [0.10, 0.42], [0.135, 0.49]
      ], 7, kiln.rot, col, pal.kilnSoot, false);
    }
    // 3 stepped bluestone stairs descending from kiln terrace to the SW trail approach
    for (let st = 0; st < 3; st++) {
      const sx = kiln.x - 3.65 - st * 0.48;
      const sz = kiln.z + 1.85 + st * 0.24;
      const sy = lerp(kilnY + 0.06, surface(sx, sz) + 0.04, (st + 1) / 3.2);
      baker.addBox('static', sx, sy - 0.10, sz, 0.56, 0.26, 1.24, -0.46, pal.flagstone, pal.stoneDark);
    }

    // Crafted timber-framed thatched pottery drying shed beside kiln (plinths, tie-beams, hipped roof, legged table & revolved pottery!)
    const shedC = toK(3.05, 0.10, 0.25);
    const shedGround = surface(shedC[0], shedC[2]);
    const toShed = (lx, ly, lz) => [shedC[0] + lx * cr + lz * sr, shedGround + ly, shedC[2] - lx * sr + lz * cr];
    const shedPosts = [[-1.15, -0.85], [1.15, -0.85], [-1.15, 0.85], [1.15, 0.85]];
    const postTops = [];
    for (const [px, pz] of shedPosts) {
      const pW = toShed(px, 0, pz);
      const gy = surface(pW[0], pW[2]);
      baker.addCylinder('static', pW[0], gy + 0.06, pW[2], 0.12, 0.15, 0.20, 6, kiln.rot, pal.stoneLight, pal.stoneDark);
      baker.addBeam('static', [pW[0], gy - 0.12, pW[2]], [pW[0], shedGround + 2.02, pW[2]], 0.072, 0.062, 6, pal.timber, pal.timberDark, true);
      postTops.push([pW[0], shedGround + 1.98, pW[2]]);
    }
    // Perimeter tie-beams + diagonal knee braces
    baker.addBeam('static', postTops[0], postTops[1], 0.052, 0.052, 5, pal.timberDark, pal.timber, true);
    baker.addBeam('static', postTops[2], postTops[3], 0.052, 0.052, 5, pal.timberDark, pal.timber, true);
    baker.addBeam('static', postTops[0], postTops[2], 0.052, 0.052, 5, pal.timberDark, pal.timber, true);
    baker.addBeam('static', postTops[1], postTops[3], 0.052, 0.052, 5, pal.timberDark, pal.timber, true);
    for (const [px, pz] of shedPosts) {
      baker.addBeam('static', toShed(px, 1.56, pz), toShed(px * 0.68, 1.96, pz), 0.032, 0.030, 4, pal.timberDark, pal.timber, false);
    }
    baker.withTag('frost-roof', () => {
      addHippedThatchRoof(baker, 'static', toShed, 1.58, 1.24, 1.92, 2.86, 0.56, '#CEB98A', '#B8A070', '#8E7850');
    });
    // Legged timber drying bench + lower shelf + sculpted revolved grey & terracotta Qin-Han jars
    const tblTopY = 0.66;
    const tblC = toShed(0, tblTopY, 0);
    baker.addBox('static', tblC[0], tblC[1], tblC[2], 1.92, 0.075, 0.92, kiln.rot, '#9B7A54', pal.timberDark);
    for (const [lx, lz] of [[-0.82, -0.34], [0.82, -0.34], [-0.82, 0.34], [0.82, 0.34]]) {
      const lp = toShed(lx, 0, lz);
      const lgy = surface(lp[0], lp[2]);
      baker.addBeam('static', [lp[0], lgy - 0.14, lp[2]], [lp[0], shedGround + tblTopY - 0.02, lp[2]], 0.044, 0.038, 5, pal.timberDark, pal.timber, false);
    }
    baker.addBeam('static', toShed(-0.82, 0.28, -0.34), toShed(0.82, 0.28, -0.34), 0.028, 0.028, 4, pal.timberDark, pal.timber, false);
    baker.addBeam('static', toShed(-0.82, 0.28, 0.34), toShed(0.82, 0.28, 0.34), 0.028, 0.028, 4, pal.timberDark, pal.timber, false);
    for (let j = -2; j <= 2; j++) {
      const jp = toShed(j * 0.34, tblTopY + 0.04, (j % 2) * 0.10 - 0.04);
      const isRed = Math.abs(j) % 2 === 1;
      const potCol = isRed ? pal.potteryRed : pal.potteryGrey;
      addRevolvedShell(baker, 'static', jp[0], jp[1], jp[2], [
        [0.075, 0.0], [0.135, 0.11], [0.125, 0.20], [0.068, 0.26], [0.092, 0.31]
      ], 7, kiln.rot + j * 0.5, potCol, pal.kilnSoot, false);
    }
    // Tight interlocking 4-3-2 stacked pine firewood pile on left terrace
    const woodPos = toK(-2.35, 0.18, 0.65);
    const kilnWoodRows = [4, 3, 2];
    for (let row = 0; row < kilnWoodRows.length; row++) {
      const cnt = kilnWoodRows[row];
      for (let col = 0; col < cnt; col++) {
        const offX = (col - (cnt - 1) * 0.5) * 0.155;
        const wy = woodPos[1] + 0.075 + row * 0.132;
        const lp0 = [woodPos[0] + offX * cr - 0.42 * sr, wy, woodPos[2] - offX * sr - 0.42 * cr];
        const lp1 = [woodPos[0] + offX * cr + 0.42 * sr, wy, woodPos[2] - offX * sr + 0.42 * cr];
        baker.addBeam('static', lp0, lp1, 0.078, 0.075, 5, (row + col) % 2 === 0 ? '#93724C' : '#836340', pal.timberDark, true);
      }
    }

    blockers.push({ x: domeBase[0], z: domeBase[2], hw: 1.75, hd: 1.95, rot: kiln.rot, minY: kilnY - 0.1, maxY: kilnY + 2.35, source: 'ow-kiln' });
    blockers.push({ x: shedC[0], z: shedC[2], hw: 1.25, hd: 0.95, rot: kiln.rot, minY: shedGround - 0.1, maxY: shedGround + 2.1, source: 'ow-kiln-shed' });
    targets.push({ id: kiln.id, x: fbPos[0], y: kilnY + 2.55, z: fbPos[2], range: 10.5 });
    interactiveSites.push({
      id: kiln.id,
      name: kiln.name,
      action: kiln.action,
      lines: kiln.lines,
      soundKind: 'jar',
      x: fbPos[0],
      y: kilnY + 0.85,
      z: fbPos[2],
      height: 0.65,
      lineIdx: 0,
      cooldown: 0
    });
  }

  // ============================================================================
  // 6. 西岭 · 鹿柴望川台 (West Ridge Brushwood Gate & Timber Overlook at -82, -176)
  // ============================================================================
  const dh = cfg.sanctuaries.deerHermitage;
  const dhY = surface(dh.x, dh.z);
  {
    resCircles.push({ x: dh.x, z: dh.z, r: dh.radius + 2.4 });
    const cr = Math.cos(dh.rot);
    const sr = Math.sin(dh.rot);
    const toD = (lx, ly, lz) => [dh.x + lx * cr + lz * sr, dhY + ly, dh.z - lx * sr + lz * cr];

    // Cantilevered timber viewing deck facing East over the valley (with stone plinths, floor joists, mid-rails & post caps)
    const deckW = 3.8;
    const deckD = 3.0;
    const deckTopY = 0.42;
    for (const [px, pz] of [[-1.65, -1.25], [1.65, -1.25], [-1.65, 1.25], [1.65, 1.25]]) {
      const wp = toD(px, 0, pz);
      const gy = surface(wp[0], wp[2]);
      baker.addCylinder('static', wp[0], gy + 0.06, wp[2], 0.14, 0.19, 0.22, 6, dh.rot, pal.stoneLight, pal.stoneDark);
      baker.addBeam('static', [wp[0], gy - 0.12, wp[2]], [wp[0], dhY + deckTopY + 0.92, wp[2]], 0.085, 0.075, 6, pal.timber, pal.timberDark, true);
      const capP = toD(px, deckTopY + 0.95, pz);
      baker.addBox('static', capP[0], capP[1], capP[2], 0.17, 0.06, 0.17, dh.rot, pal.timberDark, pal.bark);
    }
    // Under-deck longitudinal & transverse floor joists + front corner knee braces
    for (const jx of [-1.65, 0, 1.65]) {
      baker.addBeam('static', toD(jx, deckTopY - 0.08, -1.35), toD(jx, deckTopY - 0.08, 1.35), 0.062, 0.062, 5, pal.timberDark, pal.bark, true);
    }
    for (const jz of [-1.25, 1.25]) {
      baker.addBeam('static', toD(-1.72, deckTopY - 0.12, jz), toD(1.72, deckTopY - 0.12, jz), 0.065, 0.065, 5, pal.timberDark, pal.bark, true);
    }
    baker.withTag('frost-cap', () => {
      for (let p = -6; p <= 6; p++) {
        const plankC = toD(0, deckTopY, p * 0.22);
        baker.addBox('static', plankC[0], plankC[1], plankC[2], deckW, 0.07, 0.19, dh.rot, p % 2 === 0 ? '#8B6E4B' : pal.timber, pal.timberDark);
      }
    });
    // Viewing balustrades (top + mid rails + intermediate balusters on front and sides, open entry on back)
    const cFL = toD(-1.65, deckTopY + 0.86, 1.25);
    const cFR = toD(1.65, deckTopY + 0.86, 1.25);
    const cBL = toD(-1.65, deckTopY + 0.86, -1.25);
    const cBR = toD(1.65, deckTopY + 0.86, -1.25);
    const mFL = toD(-1.65, deckTopY + 0.45, 1.25);
    const mFR = toD(1.65, deckTopY + 0.45, 1.25);
    const mBL = toD(-1.65, deckTopY + 0.45, -1.25);
    const mBR = toD(1.65, deckTopY + 0.45, -1.25);
    baker.addBeam('static', cFL, cFR, 0.050, 0.050, 5, '#9C7E58', pal.timber, true);
    baker.addBeam('static', cBL, cFL, 0.046, 0.046, 5, '#9C7E58', pal.timber, true);
    baker.addBeam('static', cBR, cFR, 0.046, 0.046, 5, '#9C7E58', pal.timber, true);
    baker.addBeam('static', mFL, mFR, 0.032, 0.032, 4, pal.timber, pal.timberDark, true);
    baker.addBeam('static', mBL, mFL, 0.030, 0.030, 4, pal.timber, pal.timberDark, true);
    baker.addBeam('static', mBR, mFR, 0.030, 0.030, 4, pal.timber, pal.timberDark, true);
    for (const bx of [-0.55, 0.55]) {
      baker.addBeam('static', toD(bx, deckTopY + 0.02, 1.25), toD(bx, deckTopY + 0.86, 1.25), 0.034, 0.032, 4, pal.timber, pal.timberDark, true);
    }
    for (const sideX of [-1.65, 1.65]) {
      baker.addBeam('static', toD(sideX, deckTopY + 0.02, 0), toD(sideX, deckTopY + 0.86, 0), 0.034, 0.032, 4, pal.timber, pal.timberDark, true);
    }

    // Entry steps on back (-Z)
    for (let s = 1; s <= 2; s++) {
      const sp = toD(0, deckTopY - s * 0.14, -1.45 - s * 0.28);
      baker.addBox('static', sp[0], sp[1], sp[2], 1.55, 0.12, 0.30, dh.rot, pal.stoneLight, pal.stoneDark);
    }

    // Poetic lashed brushwood fence & half-open wicket gate ("柴扉半掩")
    const fencePts = [];
    for (let f = 0; f < 6; f++) {
      const fx = -3.4 + f * 0.42;
      const fp = toD(fx, 0, -1.85);
      const fgy = surface(fp[0], fp[2]);
      fencePts.push([fp[0], fgy, fp[2]]);
      baker.addBeam('static', [fp[0], fgy - 0.05, fp[2]], [fp[0], fgy + 0.96 + (f % 2) * 0.08, fp[2]], 0.036, 0.026, 4, pal.bambooCulm, pal.timberDark, true);
    }
    // Two continuous horizontal lashed bamboo fence rails + woven vertical twigs
    for (let f = 0; f < 5; f++) {
      const a = fencePts[f], b = fencePts[f + 1];
      baker.addBeam('static', [a[0], a[1] + 0.34, a[2]], [b[0], b[1] + 0.34, b[2]], 0.024, 0.024, 4, pal.timber, pal.timberDark, true);
      baker.addBeam('static', [a[0], a[1] + 0.74, a[2]], [b[0], b[1] + 0.74, b[2]], 0.024, 0.024, 4, pal.timber, pal.timberDark, true);
      const midX = (a[0] + b[0]) * 0.5, midZ = (a[2] + b[2]) * 0.5, midY = (a[1] + b[1]) * 0.5;
      baker.addBeam('static', [midX, midY - 0.02, midZ], [midX, midY + 0.90, midZ], 0.018, 0.014, 3, pal.bambooCulm, pal.timberDark, true);
    }
    // Half-open woven brushwood wicket gate swinging ajar from the inner fence end post
    const gatePivot = fencePts[5];
    const gSwing = 0.55;
    const gEdge = toD(-1.30 + Math.cos(gSwing) * 0.88, 0, -1.85 + Math.sin(gSwing) * 0.88);
    const gEdgeY = surface(gEdge[0], gEdge[2]);
    baker.addBeam('static', [gatePivot[0], gatePivot[1] + 0.26, gatePivot[2]], [gEdge[0], gEdgeY + 0.26, gEdge[2]], 0.026, 0.024, 4, pal.timberDark, pal.bark, true);
    baker.addBeam('static', [gatePivot[0], gatePivot[1] + 0.76, gatePivot[2]], [gEdge[0], gEdgeY + 0.76, gEdge[2]], 0.026, 0.024, 4, pal.timberDark, pal.bark, true);
    baker.addBeam('static', [gatePivot[0], gatePivot[1] + 0.26, gatePivot[2]], [gEdge[0], gEdgeY + 0.76, gEdge[2]], 0.022, 0.022, 4, pal.timber, pal.timberDark, true);
    for (let k = 1; k <= 3; k++) {
      const u = k / 3;
      const sx = gatePivot[0] + (gEdge[0] - gatePivot[0]) * u;
      const sy = gatePivot[1] + (gEdgeY - gatePivot[1]) * u;
      const sz = gatePivot[2] + (gEdge[2] - gatePivot[2]) * u;
      baker.addBeam('static', [sx, sy + 0.08, sz], [sx, sy + 0.92 - (k % 2) * 0.05, sz], 0.022, 0.018, 4, pal.bambooCulm, pal.timberDark, true);
    }
    // Mossy stone lantern cairn
    const cairnP = toD(2.45, 0, -1.35);
    const cgy = surface(cairnP[0], cairnP[2]);
    baker.addCylinder('static', cairnP[0], cgy + 0.32, cairnP[2], 0.16, 0.24, 0.64, 6, 0, pal.stone, pal.stoneDark);
    baker.withTag('frost-cap', () => {
      baker.addCone('static', cairnP[0], cgy + 0.78, cairnP[2], 0.36, 0.24, 6, 0.3, pal.stoneLight, pal.mossDeep);
    });

    woodDecks.push({
      x: dh.x,
      z: dh.z,
      tx: sr,
      tz: cr,
      ux: cr,
      uz: -sr,
      length: deckD + 0.3,
      width: deckW + 0.3,
      endY0: dhY + deckTopY + 0.035,
      endY1: dhY + deckTopY + 0.035,
      arch: 0,
      bevelL: 0.55,
      bevelW: 0.24,
      material: 'wood'
    });
    targets.push({ id: dh.id, x: dh.x, y: dhY + 1.55, z: dh.z, range: 9.5 });
    interactiveSites.push({
      id: dh.id,
      name: dh.name,
      action: dh.action,
      lines: dh.lines,
      soundKind: 'stag',
      x: dh.x,
      y: dhY + deckTopY,
      z: dh.z,
      height: 0.85,
      lineIdx: 0,
      cooldown: 0
    });
  }

  // ============================================================================
  // 6b. 北岭松风茶寮 & 西岭云樵茅舍 (Mountain Human-Warmth Shelters & Smoke)
  // ============================================================================
  const teaHut = cfg.sanctuaries.mountainTeaHut || {
    id: 'mountain-tea-shelter',
    name: '北岭松风茶寮',
    action: '品茗',
    x: 82.0,
    z: -235.5,
    rot: 0.28,
    radius: 4.6,
    lines: [
      '半山樵径转入松阴，四柱茅顶茶寮下泥炉微沸，竹匾摊着刚采的带露野茶，清香扑鼻。',
      '担柴樵夫与采茶山姑常在此歇肩饮泉，俯望谷中层梯水镜与千家炊烟，山上山下皆是人间暖意。'
    ]
  };
  const teaHutY = surface(teaHut.x, teaHut.z);
  let teaStoveTop = [teaHut.x, teaHutY + 0.82, teaHut.z];
  let teaLanternWorld = [teaHut.x, teaHutY + 2.02, teaHut.z];
  {
    resCircles.push({ x: teaHut.x, z: teaHut.z, r: (teaHut.radius || 4.6) + 2.4 });
    const cr = Math.cos(teaHut.rot || 0);
    const sr = Math.sin(teaHut.rot || 0);
    const toT = (lx, ly, lz) => [teaHut.x + lx * cr + lz * sr, teaHutY + ly, teaHut.z - lx * sr + lz * cr];

    // Levelled mountain stone & rammed-earth terrace with deep hillside skirt (zero floating lip)
    baker.withTag('frost-cap', () => {
      baker.addCylinder('static', teaHut.x, teaHutY - 0.28, teaHut.z, 3.65, 4.25, 0.98, 10, teaHut.rot, pal.flagstone, pal.stoneDark);
    });
    // 4 cedar corner columns with chamfered bluestone plinths, knee braces & golden four-slope thatched roof
    const colOffsets = [[-1.55, -1.45], [1.55, -1.45], [-1.55, 1.45], [1.55, 1.45]];
    const colTops = [];
    for (const [px, pz] of colOffsets) {
      const wp = toT(px, 0, pz);
      const gy = Math.min(teaHutY, surface(wp[0], wp[2]));
      baker.addCylinder('static', wp[0], teaHutY + 0.24, wp[2], 0.13, 0.16, 0.18, 6, teaHut.rot, pal.stoneLight, pal.stoneDark);
      baker.addBeam('static', [wp[0], gy - 0.18, wp[2]], [wp[0], teaHutY + 2.18, wp[2]], 0.082, 0.072, 6, pal.timber, pal.timberDark, true);
      baker.addBeam('static', toT(px, 1.68, pz), toT(px * 0.72, 2.14, pz), 0.036, 0.034, 4, pal.timberDark, pal.timber, false);
      baker.addBeam('static', toT(px, 1.68, pz), toT(px, 2.14, pz * 0.72), 0.036, 0.034, 4, pal.timberDark, pal.timber, false);
      colTops.push([wp[0], teaHutY + 2.16, wp[2]]);
    }
    // 3 stepped bluestone stairs descending smoothly to the SW north-tea-ridge-trail
    for (let st = 0; st < 3; st++) {
      const sx = teaHut.x - 3.15 - st * 0.45;
      const sz = teaHut.z + 1.95 + st * 0.28;
      const sy = lerp(teaHutY + 0.12, surface(sx, sz) + 0.04, (st + 1) / 3.2);
      baker.addBox('static', sx, sy - 0.09, sz, 0.54, 0.24, 1.12, -0.56, pal.flagstone, pal.stoneDark);
    }
    baker.addBeam('static', colTops[0], colTops[1], 0.058, 0.058, 5, pal.timber, pal.timberDark, true);
    baker.addBeam('static', colTops[2], colTops[3], 0.058, 0.058, 5, pal.timber, pal.timberDark, true);
    baker.addBeam('static', colTops[0], colTops[2], 0.058, 0.058, 5, pal.timber, pal.timberDark, true);
    baker.addBeam('static', colTops[1], colTops[3], 0.058, 0.058, 5, pal.timber, pal.timberDark, true);
    baker.withTag('frost-roof', () => {
      addHippedThatchRoof(baker, 'static', toT, 2.18, 2.02, 2.12, 3.24, 0.58, '#CEB98A', '#B59E6E', '#8E7952');
    });

    // Low timber tea table + sculpted clay teapot (with spout, handle & lid knob) & cups + 2 legged bamboo benches
    const tblP = toT(-0.18, 0.46, 0.08);
    baker.addBox('static', tblP[0], tblP[1], tblP[2], 1.18, 0.07, 0.72, teaHut.rot, '#8F714D', pal.timberDark);
    for (const [lx, lz] of [[-0.46, -0.26], [0.46, -0.26], [-0.46, 0.26], [0.46, 0.26]]) {
      const lp = toT(-0.18 + lx, 0.24, 0.08 + lz);
      baker.addBox('static', lp[0], lp[1], lp[2], 0.07, 0.42, 0.07, teaHut.rot, pal.timberDark, pal.timberDark);
    }
    baker.addCylinder('static', tblP[0] + 0.12, tblP[1] + 0.10, tblP[2] - 0.06, 0.075, 0.095, 0.14, 7, 0, pal.potteryRed, pal.kilnSoot);
    baker.addCylinder('static', tblP[0] + 0.12, tblP[1] + 0.18, tblP[2] - 0.06, 0.020, 0.025, 0.026, 6, 0, '#B87258', pal.potteryRed);
    baker.addBeam('static', [tblP[0] + 0.05, tblP[1] + 0.10, tblP[2] - 0.06], [tblP[0] - 0.02, tblP[1] + 0.16, tblP[2] - 0.06], 0.018, 0.011, 4, pal.potteryRed, pal.kilnSoot, false);
    baker.addBeam('static', [tblP[0] + 0.19, tblP[1] + 0.14, tblP[2] - 0.06], [tblP[0] + 0.23, tblP[1] + 0.08, tblP[2] - 0.06], 0.014, 0.014, 4, pal.kilnSoot, pal.potteryRed, false);
    for (const [cx, cz] of [[-0.22, 0.08], [-0.04, 0.16], [0.24, 0.12]]) {
      baker.addCylinder('static', tblP[0] + cx, tblP[1] + 0.065, tblP[2] + cz, 0.038, 0.030, 0.055, 6, 0, '#D8D2C3', pal.potteryGrey);
    }
    const guestBench = toT(-0.18, 0.32, 0.88);
    const hostBench = toT(-0.18, 0.32, -0.72);
    for (const bz of [0.88, -0.72]) {
      const bp = toT(-0.18, 0.32, bz);
      baker.addBox('static', bp[0], bp[1], bp[2], 1.06, 0.06, 0.32, teaHut.rot, '#9A8258', pal.timberDark);
      for (const bx of [-0.40, 0.40]) {
        const leg = toT(-0.18 + bx, 0.16, bz);
        baker.addBox('static', leg[0], leg[1], leg[2], 0.07, 0.28, 0.26, teaHut.rot, pal.timberDark, pal.timberDark);
      }
    }

    // Earthen stove + clay kettle on east side of shelter
    const stv = toT(1.08, 0.34, -0.45);
    baker.addCylinder('static', stv[0], stv[1], stv[2], 0.32, 0.36, 0.46, 8, 0, pal.kilnEarth, pal.kilnBrick);
    baker.addCylinder('static', stv[0], stv[1] + 0.32, stv[2], 0.16, 0.21, 0.22, 7, 0, pal.kilnSoot, pal.potteryGrey);
    teaStoveTop = [stv[0], stv[1] + 0.48, stv[2]];

    // Hanging bamboo lantern under front eave
    const lanP = toT(1.38, 1.92, 1.28);
    baker.addCylinder('static', lanP[0], lanP[1], lanP[2], 0.11, 0.11, 0.22, 6, 0, '#C8B07E', pal.timberDark);
    teaLanternWorld = [lanP[0], lanP[1] - 0.02, lanP[2]];

    // Legged bamboo tea-leaf sunning racks outside shelter ("晒青竹匾")
    const rackP = toT(-2.45, 0, 0.45);
    const rackY = surface(rackP[0], rackP[2]);
    baker.addBox('static', rackP[0], rackY + 0.56, rackP[2], 1.65, 0.06, 0.82, (teaHut.rot || 0) + 0.18, pal.bambooCulm, pal.timberDark);
    for (const [rx, rz] of [[-0.68, -0.28], [0.68, -0.28], [-0.68, 0.28], [0.68, 0.28]]) {
      const rpW = [rackP[0] + rx * cr + rz * sr, rackY, rackP[2] - rx * sr + rz * cr];
      baker.addBeam('static', [rpW[0], surface(rpW[0], rpW[2]) - 0.08, rpW[2]], [rpW[0], rackY + 0.55, rpW[2]], 0.032, 0.028, 4, pal.timberDark, pal.bambooCulm, false);
    }
    for (const off of [-0.45, 0.45]) {
      const tp = [rackP[0] + off * cr, rackY + 0.63, rackP[2] - off * sr];
      baker.addCylinder('static', tp[0], tp[1], tp[2], 0.36, 0.34, 0.05, 8, 0, '#C7AE78', '#988052');
      baker.addCylinder('static', tp[0], tp[1] + 0.032, tp[2], 0.30, 0.30, 0.025, 8, 0, '#5E854B', '#466A39');
    }

    shelters.push({ x: teaHut.x, z: teaHut.z, rx: 2.15, rz: 2.15, rot: teaHut.rot || 0, roofY: teaHutY + 2.6, kind: 'pavilion' });
    restSeats.push({
      id: 'mountain-tea-seat',
      name: teaHut.name,
      prompt: '落座品茗 · ' + teaHut.name,
      x: guestBench[0],
      y: teaHutY,
      z: guestBench[2],
      seatY: 0.36,
      lookX: teaHut.x - 16 * sr,
      lookY: teaHutY - 2.2,
      lookZ: teaHut.z + 16 * cr,
      exitAngle: Math.atan2(guestBench[2] - teaHut.z, guestBench[0] - teaHut.x)
    });
    blockers.push({ x: tblP[0], z: tblP[2], hw: 0.62, hd: 0.42, rot: teaHut.rot || 0, minY: teaHutY, maxY: teaHutY + 0.62, source: 'ow-tea-table' });
    targets.push({ id: teaHut.id, x: teaHut.x, y: teaHutY + 1.55, z: teaHut.z, range: 10.5 });
    interactiveSites.push({
      id: teaHut.id,
      name: teaHut.name,
      action: teaHut.action,
      lines: teaHut.lines,
      soundKind: 'tea',
      x: stv[0],
      y: teaHutY + 0.62,
      z: stv[2],
      height: 0.55,
      lineIdx: 0,
      cooldown: 0
    });
  }

  const woodHut = cfg.sanctuaries.woodcutterHut || {
    id: 'cloud-ridge-woodcutter-hut',
    name: '西岭云樵茅舍',
    action: '访樵',
    x: -68.0,
    z: -234.0,
    rot: 0.72,
    radius: 4.6,
    lines: [
      '依西北云岭缓坡筑起夯土茅舍，廊下码满松柴与竹扁担，劈柴木墩上犹留松脂清香。',
      '屋脊矮烟囱飘出一缕淡白炊烟，与山下村落遥遥相望，空山深处亦有人家安居。'
    ]
  };
  const woodHutY = surface(woodHut.x, woodHut.z);
  let woodChimneyTop = [woodHut.x, woodHutY + 3.05, woodHut.z];
  {
    resCircles.push({ x: woodHut.x, z: woodHut.z, r: (woodHut.radius || 4.6) + 2.4 });
    const cr = Math.cos(woodHut.rot || 0);
    const sr = Math.sin(woodHut.rot || 0);
    const toW = (lx, ly, lz) => [woodHut.x + lx * cr + lz * sr, woodHutY + ly, woodHut.z - lx * sr + lz * cr];

    // Deep grounded hillside stone plinth (top stays at exact woodHutY + 0.28) + rammed-earth & timber mountain cottage
    baker.addBox('static', woodHut.x, woodHutY - 0.32, woodHut.z, 3.85, 1.20, 3.15, woodHut.rot, pal.stoneLight, pal.stoneDark);
    const cabP = toW(0, 1.18, -0.25);
    baker.addBox('static', cabP[0], cabP[1], cabP[2], 3.1, 1.85, 2.2, woodHut.rot, '#D5C7AD', '#B4A488');
    // Corner timber columns & veranda posts with chamfered stone plinths on front veranda
    for (const [cx, cz] of [[-1.54, -1.34], [1.54, -1.34], [-1.54, 0.84], [1.54, 0.84], [-1.54, 1.44], [1.54, 1.44]]) {
      const cp = toW(cx, 1.18, cz);
      baker.addBox('static', cp[0], cp[1], cp[2], 0.12, 1.86, 0.12, woodHut.rot, pal.timber, pal.timberDark);
      if (cz > 1.2) {
        const pl = toW(cx, 0.34, cz);
        baker.addCylinder('static', pl[0], pl[1], pl[2], 0.11, 0.14, 0.14, 6, woodHut.rot, pal.stoneLight, pal.stoneDark);
      }
    }
    // Framed Qin-Han plank door (jambs, overhanging lintel, sill, center seam & bronze pull ring) + lattice window
    const doorP = toW(0, 0.99, 0.86);
    baker.addBox('static', doorP[0], doorP[1], doorP[2], 0.74, 1.40, 0.06, woodHut.rot, '#6F5438', pal.timberDark);
    for (const jx of [-0.40, 0.40]) {
      const jp = toW(jx, 1.00, 0.89);
      baker.addBox('static', jp[0], jp[1], jp[2], 0.09, 1.46, 0.10, woodHut.rot, pal.timberDark, pal.timberDark);
    }
    const doorLintel = toW(0, 1.74, 0.90);
    baker.addBox('static', doorLintel[0], doorLintel[1], doorLintel[2], 0.98, 0.10, 0.13, woodHut.rot, pal.timberDark, '#4A3724');
    const doorSill = toW(0, 0.30, 0.90);
    baker.addBox('static', doorSill[0], doorSill[1], doorSill[2], 0.92, 0.06, 0.12, woodHut.rot, pal.timberDark, '#4A3724');
    const doorSeam = toW(0, 0.99, 0.895);
    baker.addBox('static', doorSeam[0], doorSeam[1], doorSeam[2], 0.022, 1.36, 0.018, woodHut.rot, '#493622', '#493622');
    const doorRing = toW(0.14, 0.96, 0.905);
    baker.addCylinder('static', doorRing[0], doorRing[1], doorRing[2], 0.036, 0.036, 0.022, 6, woodHut.rot, '#C49C58', '#8C6C36');
    const winP = toW(0.92, 1.22, 0.87);
    baker.addBox('static', winP[0], winP[1], winP[2], 0.56, 0.52, 0.08, woodHut.rot, '#4B3C2E', pal.timberDark);
    for (const wx of [-0.14, 0, 0.14]) {
      const mp = toW(0.92 + wx, 1.22, 0.90);
      baker.addBox('static', mp[0], mp[1], mp[2], 0.03, 0.50, 0.03, woodHut.rot, pal.timber, pal.timberDark);
    }
    // Veranda diagonal knee braces & stone doorstep slab
    for (const cx of [-1.54, 1.54]) {
      baker.addBeam('static', toW(cx, 1.56, 1.44), toW(cx - Math.sign(cx) * 0.36, 2.02, 1.44), 0.042, 0.042, 5, pal.timber, pal.timberDark, false);
      baker.addBeam('static', toW(cx, 1.56, 1.44), toW(cx, 2.02, 1.06), 0.042, 0.042, 5, pal.timber, pal.timberDark, false);
    }
    const stepP = toW(0, 0.14, 1.72);
    baker.addBox('static', stepP[0], stepP[1], stepP[2], 1.18, 0.28, 0.56, woodHut.rot, pal.stoneLight, pal.stoneDark);
    // Crafted overhanging hipped thatched roof + sculpted Qin-Han brick chimney with clay rain-cap
    baker.withTag('frost-roof', () => {
      const toHutRoof = (lx, ly, lz) => toW(lx, ly, lz + 0.05);
      addHippedThatchRoof(baker, 'static', toHutRoof, 2.15, 1.86, 2.04, 3.18, 0.92, '#CBB486', '#B39B6D', '#8C764F');
    });
    const chimBase = toW(-1.12, 2.34, -0.62);
    const chimShaft = toW(-1.12, 2.68, -0.62);
    const chimNeck = toW(-1.12, 2.94, -0.62);
    const chimCap = toW(-1.12, 3.07, -0.62);
    baker.addBox('static', chimBase[0], chimBase[1], chimBase[2], 0.52, 0.36, 0.52, woodHut.rot, pal.stoneDark, pal.kilnSoot);
    baker.addBox('static', chimShaft[0], chimShaft[1], chimShaft[2], 0.40, 0.44, 0.40, woodHut.rot, pal.kilnBrick, pal.kilnSoot);
    baker.addBox('static', chimNeck[0], chimNeck[1], chimNeck[2], 0.46, 0.10, 0.46, woodHut.rot, '#6E5948', pal.kilnSoot);
    baker.addBox('static', chimCap[0], chimCap[1], chimCap[2], 0.56, 0.07, 0.56, woodHut.rot, '#7D6753', '#59483A');
    woodChimneyTop = [chimCap[0], chimCap[1] + 0.08, chimCap[2]];

    // Tight interlocking 4-3-2 stacked split firewood pyramid resting solidly on porch slab + leaning bamboo pole & chopping stump
    const hutWoodRows = [4, 3, 2];
    for (let r = 0; r < hutWoodRows.length; r++) {
      const cnt = hutWoodRows[r];
      for (let c = 0; c < cnt; c++) {
        const lx = -1.06 + (c - (cnt - 1) * 0.5) * 0.138;
        const ly = 0.345 + r * 0.118;
        const lp0 = toW(lx, ly, 0.94);
        const lp1 = toW(lx, ly, 1.38);
        baker.addBeam('static', lp0, lp1, 0.070, 0.066, 5, (r + c) % 2 === 0 ? '#96744E' : '#856442', pal.timberDark, true);
      }
    }
    baker.addBeam('static', toW(-1.46, 0.30, 1.16), toW(-1.26, 1.72, 0.90), 0.026, 0.022, 5, pal.bambooCulm, pal.timberDark, true);
    const stumpP = toW(1.85, 0, 1.15);
    const stumpY = surface(stumpP[0], stumpP[2]);
    baker.addCylinder('static', stumpP[0], stumpY + 0.24, stumpP[2], 0.26, 0.30, 0.48, 7, 0, '#A88A62', pal.bark);
    baker.addCylinder('static', stumpP[0] + 0.03, stumpY + 0.54, stumpP[2] - 0.02, 0.075, 0.085, 0.16, 5, 0.3, '#B79362', '#7E5E3C');

    const frontAnchor = toW(-0.65, 0, 1.48);
    shelters.push({ x: woodHut.x, z: woodHut.z, rx: 2.2, rz: 2.0, rot: woodHut.rot || 0, roofY: woodHutY + 2.5, kind: 'eave' });
    woodDecks.push({
      x: woodHut.x,
      z: woodHut.z,
      tx: sr,
      tz: cr,
      ux: cr,
      uz: -sr,
      length: 3.2,
      width: 3.8,
      endY0: woodHutY + 0.28,
      endY1: woodHutY + 0.28,
      arch: 0,
      bevelL: 0.35,
      bevelW: 0.35,
      material: 'stone'
    });
    blockers.push({ x: cabP[0], z: cabP[2], hw: 1.62, hd: 1.18, rot: woodHut.rot || 0, minY: woodHutY, maxY: woodHutY + 2.6, source: 'ow-woodcutter-hut' });
    targets.push({ id: woodHut.id, x: frontAnchor[0], y: woodHutY + 1.85, z: frontAnchor[2], range: 10.5 });
    interactiveSites.push({
      id: woodHut.id,
      name: woodHut.name,
      action: woodHut.action,
      lines: woodHut.lines,
      soundKind: 'wood',
      x: doorP[0],
      y: woodHutY + 0.85,
      z: doorP[2],
      height: 0.65,
      lineIdx: 0,
      cooldown: 0
    });
  }

  // ============================================================================
  // 7. 水岸破阵笔意：美池汀渚沙嘴、卧石与「桃柳拂波」蘸水枝 (Quote 1 Water Banks)
  // ============================================================================
  {
    // 3 asymmetric shallow silt/pebble spits & mossy stepping stones breaking the pond ellipse
    const pondSpits = [
      { ang: 0.72, len: 2.35, wid: 1.55 },
      { ang: 2.68, len: 2.05, wid: 1.35 },
      { ang: 4.55, len: 2.45, wid: 1.65 }
    ];
    for (let s = 0; s < pondSpits.length; s++) {
      const sp = pondSpits[s];
      const ca = Math.cos(sp.ang);
      const sa = Math.sin(sp.ang);
      const rEdge = pondCfg.radius * 0.72;
      const sx = pondCfg.x + ca * rEdge;
      const sz = pondCfg.z + sa * rEdge;
      const wy = pondCfg.waterY;
      // Gently submerged-to-exposed silt/moss tongue
      baker.withTag('frost-cap', () => {
        baker.addCylinder('static', sx, wy - 0.01, sz, sp.wid * 0.72, sp.wid, 0.09, 7, sp.ang, '#A8A389', '#6B7E6C');
        baker.addCylinder('static', sx - ca * (sp.len * 0.46), wy + 0.015, sz - sa * (sp.len * 0.46), sp.wid * 0.42, sp.wid * 0.65, 0.08, 6, sp.ang + 0.4, pal.moss, '#5F7564');
      });
      // Stepping flat mossy stone at the tip
      const tipX = sx - ca * (sp.len * 0.76);
      const tipZ = sz - sa * (sp.len * 0.76);
      baker.addTiltedBox('static', tipX, wy + 0.03, tipZ, 0.54, 0.11, 0.42, 0.04, sp.ang + 0.6, -0.03, pal.stoneLight, pal.stoneDark);
    }

    // Overhanging weeping-willow & gnarled old-peach boughs gracefully arching over the pond mirror ("桃柳拂波")
    const dippingTrees = [
      { ang: 0.82, kind: 'willow', lean: 3.15 },
      { ang: 4.42, kind: 'peach', lean: 2.85 }
    ];
    for (const dt of dippingTrees) {
      const ca = Math.cos(dt.ang);
      const sa = Math.sin(dt.ang);
      const sx = -sa;
      const sz = ca;
      const bx = pondCfg.x + ca * (pondCfg.radius * 0.90);
      const bz = pondCfg.z + sa * (pondCfg.radius * 0.90);
      const by = surface(bx, bz);
      const wy = pondCfg.waterY;
      // Flared mossy root boulder & 4-segment gracefully arching gnarled bole (zero sharp inverted-V kink)
      baker.addCylinder('static', bx + ca * 0.14, by + 0.08, bz + sa * 0.14, 0.24, 0.38, 0.28, 6, dt.ang, pal.bark, pal.moss);
      const p0 = [bx, by - 0.14, bz];
      const p1 = [bx - ca * (dt.lean * 0.22) + sx * 0.14, by + 0.88, bz - sa * (dt.lean * 0.22) + sz * 0.14];
      const p2 = [bx - ca * (dt.lean * 0.54) + sx * 0.08, by + 1.56, bz - sa * (dt.lean * 0.54) + sz * 0.08];
      const p3 = [bx - ca * (dt.lean * 0.86) - sx * 0.06, Math.max(wy + 1.24, by + 1.44), bz - sa * (dt.lean * 0.86) - sz * 0.06];
      const p4 = [bx - ca * (dt.lean * 1.08) - sx * 0.12, Math.max(wy + 0.92, by + 1.06), bz - sa * (dt.lean * 1.08) - sz * 0.12];
      baker.addBeam('static', p0, p1, 0.16, 0.125, 6, '#544233', pal.bark, false);
      baker.addBeam('static', p1, p2, 0.125, 0.095, 6, '#5D4A3A', '#544233', false);
      baker.addBeam('static', p2, p3, 0.095, 0.062, 5, '#665240', '#5D4A3A', false);
      baker.addBeam('static', p3, p4, 0.062, 0.030, 5, '#6F5A47', '#665240', true);
      // Secondary forked lateral limb for Song-Yuan calligraphic balance
      const sideA = [p2[0] + sx * 0.82 - ca * 0.28, p2[1] + 0.42, p2[2] + sz * 0.82 - sa * 0.28];
      const sideB = [p2[0] - sx * 0.72 - ca * 0.36, p2[1] + 0.26, p2[2] - sz * 0.72 - sa * 0.36];
      baker.addBeam('static', p2, sideA, 0.065, 0.026, 5, '#665240', '#5B4838', true);
      baker.addBeam('static', p2, sideB, 0.056, 0.024, 5, '#665240', '#5B4838', true);
      if (dt.kind === 'willow') {
        baker.withTag('willow-frond', () => {
          // Tiered painterly willow canopy crowns along the arching limbs
          addScallopedCloud(baker, 'static', p2[0], p2[1] + 0.34, p2[2], 0.96, 0.36, 0.88, 6, '#7DA85E', '#67914B', '#4F773A', 0.5);
          addScallopedCloud(baker, 'static', sideA[0], sideA[1] + 0.14, sideA[2], 0.78, 0.30, 0.72, 6, '#87B266', '#6F9952', '#557D3F', 1.6);
          addScallopedCloud(baker, 'static', sideB[0], sideB[1] + 0.12, sideB[2], 0.72, 0.28, 0.68, 6, '#79A45A', '#618B46', '#4A7036', 2.4);
          addScallopedCloud(baker, 'static', p3[0], p3[1] + 0.16, p3[2], 0.82, 0.30, 0.74, 6, '#84AE63', '#6A944E', '#50783B', 3.3);
          // 9 graceful 2-segment weeping willow fronds draping gently down to kiss the pond mirror
          const frondOrigins = [
            [p3[0] + sx * 0.42, p3[1] + 0.06, p3[2] + sz * 0.42],
            [p3[0] - sx * 0.38, p3[1] + 0.04, p3[2] - sz * 0.38],
            [p4[0] + sx * 0.26, p4[1] + 0.02, p4[2] + sz * 0.26],
            [p4[0], p4[1] + 0.04, p4[2]],
            [p4[0] - sx * 0.28, p4[1] + 0.02, p4[2] - sz * 0.28],
            [sideA[0] - ca * 0.22, sideA[1], sideA[2] - sa * 0.22],
            [sideA[0] + sx * 0.24, sideA[1] - 0.04, sideA[2] + sz * 0.24],
            [sideB[0] - ca * 0.20, sideB[1], sideB[2] - sa * 0.20],
            [p2[0] - ca * 0.18, p2[1] + 0.14, p2[2] - sa * 0.18]
          ];
          for (let f = 0; f < frondOrigins.length; f++) {
            const o = frondOrigins[f];
            const midY = (o[1] + wy + 0.16) * 0.5;
            const drift = (f % 2 === 0 ? 0.12 : -0.10);
            const mid = [o[0] - ca * 0.10 + sx * drift * 0.5, midY, o[2] - sa * 0.10 + sz * drift * 0.5];
            const bot = [o[0] - ca * 0.22 + sx * drift, wy + 0.12 + (f % 3) * 0.12, o[2] - sa * 0.22 + sz * drift];
            baker.addBeam('static', o, mid, 0.036, 0.026, 4, '#7AA55A', '#8AB468', false);
            baker.addBeam('static', mid, bot, 0.026, 0.010, 4, '#8AB468', '#9EC47B', false);
          }
        });
      } else {
        baker.withTag('dip-blossom', () => {
          addScallopedCloud(baker, 'static', p2[0], p2[1] + 0.28, p2[2], 0.84, 0.34, 0.78, 6, '#FFF2F4', pal.blossomPale, pal.blossomPink, 0.4);
          addScallopedCloud(baker, 'static', sideA[0], sideA[1] + 0.12, sideA[2], 0.66, 0.28, 0.62, 6, pal.blossomPale, pal.blossomPink, '#D88E97', 1.3);
          addScallopedCloud(baker, 'static', sideB[0], sideB[1] + 0.10, sideB[2], 0.58, 0.25, 0.54, 5, '#FFF5F6', pal.blossomPale, pal.blossomPink, 2.2);
          addScallopedCloud(baker, 'static', p3[0], p3[1] + 0.12, p3[2], 0.72, 0.28, 0.66, 6, pal.blossomPale, pal.blossomPink, '#D88E97', 3.1);
          addScallopedCloud(baker, 'static', p4[0], p4[1] + 0.06, p4[2], 0.56, 0.24, 0.52, 5, '#FFF5F6', pal.blossomPale, pal.blossomPink, 4.0);
        });
      }
    }

    // 4 gnarled overhanging peach boughs along Wuling exterior stream ("夹岸桃枝蘸水")
    if (riverCurve) {
      for (const [uVal, side] of [[0.24, 1], [0.44, -1], [0.64, 1], [0.80, -1]]) {
        const pt = riverCurve.getPointAt(uVal);
        const tan = riverCurve.getTangentAt(uVal);
        const nl = Math.hypot(tan.x, tan.z) || 1;
        const nx = (tan.z / nl) * side;
        const nz = (-tan.x / nl) * side;
        const tx = tan.x / nl;
        const tz = tan.z / nl;
        // Start search from channel edge (5.5m) so the root sits on the true water's edge and the bough genuinely overhangs the stream
        let bankR = 5.5;
        while (bankR < 26 && rawGround(pt.x + nx * bankR, pt.z + nz * bankR) < waterLevel + 0.26) bankR += 0.5;
        const rx = pt.x + nx * (bankR + 0.55);
        const rz = pt.z + nz * (bankR + 0.55);
        const ry = rawGround(rx, rz);
        const reach = 3.25;
        // Root mossy stone + 4-segment sinuous arching gnarled peach trunk leaning out over the blue creek
        baker.addCylinder('exterior', rx + nx * 0.18, ry + 0.06, rz + nz * 0.18, 0.26, 0.38, 0.26, 6, uVal * 6, pal.stoneLight, pal.moss);
        const b0 = [rx, ry - 0.18, rz];
        const b1 = [rx - nx * (reach * 0.22) + tx * 0.22, ry + 0.84, rz - nz * (reach * 0.22) + tz * 0.22];
        const b2 = [rx - nx * (reach * 0.55) + tx * 0.14, ry + 1.48, rz - nz * (reach * 0.55) + tz * 0.14];
        const b3 = [rx - nx * (reach * 0.88) - tx * 0.10, Math.max(waterLevel + 1.18, ry + 1.24), rz - nz * (reach * 0.88) - tz * 0.10];
        const b4 = [rx - nx * (reach * 1.14) - tx * 0.18, Math.max(waterLevel + 0.78, ry + 0.84), rz - nz * (reach * 1.14) - tz * 0.18];
        baker.addBeam('exterior', b0, b1, 0.155, 0.118, 6, '#564336', pal.bark, false);
        baker.addBeam('exterior', b1, b2, 0.118, 0.088, 6, '#604C3E', '#564336', false);
        baker.addBeam('exterior', b2, b3, 0.088, 0.056, 5, '#6B5647', '#604C3E', false);
        baker.addBeam('exterior', b3, b4, 0.056, 0.026, 5, '#745E4E', '#6B5647', true);
        // Two forked gnarled side twigs framing the arching crown
        const twA = [b2[0] + tx * 0.86 - nx * 0.18, b2[1] + 0.44, b2[2] + tz * 0.86 - nz * 0.18];
        const twB = [b2[0] - tx * 0.74 - nx * 0.32, b2[1] + 0.24, b2[2] - tz * 0.74 - nz * 0.32];
        baker.addBeam('exterior', b2, twA, 0.058, 0.024, 5, '#695546', '#5C4A3D', true);
        baker.addBeam('exterior', b2, twB, 0.050, 0.022, 5, '#695546', '#5C4A3D', true);
        baker.withTag('dip-blossom', () => {
          addScallopedCloud(baker, 'exterior', b2[0], b2[1] + 0.26, b2[2], 0.86, 0.36, 0.78, 6, '#FFF2F4', pal.blossomPale, pal.blossomPink, uVal * 5);
          addScallopedCloud(baker, 'exterior', twA[0], twA[1] + 0.12, twA[2], 0.68, 0.28, 0.62, 6, pal.blossomPale, pal.blossomPink, '#D88E97', uVal * 7 + 1.1);
          addScallopedCloud(baker, 'exterior', twB[0], twB[1] + 0.10, twB[2], 0.60, 0.26, 0.56, 5, '#FFF5F6', pal.blossomPale, pal.blossomPink, uVal * 9 + 2.2);
          addScallopedCloud(baker, 'exterior', b3[0], b3[1] + 0.12, b3[2], 0.74, 0.28, 0.66, 6, pal.blossomPale, pal.blossomPink, '#D88E97', uVal * 11 + 0.6);
          addScallopedCloud(baker, 'exterior', b4[0], b4[1] + 0.04, b4[2], 0.54, 0.22, 0.50, 5, '#FFF5F6', pal.blossomPale, pal.blossomPink, uVal * 13 + 1.8);
        });
      }
    }
  }

  const staticGeo = baker.buildGeometry('static');
  const staticTags = baker.getTags('static');
  const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const staticMesh = new THREE.Mesh(staticGeo, staticMat);
  staticMesh.name = 'outer-wilds-static';
  staticMesh.matrixAutoUpdate = false;
  staticMesh.updateMatrix();
  interiorGroup.add(staticMesh);

  const extStaticGeo = baker.buildGeometry('exterior');
  const extStaticTags = baker.getTags('exterior');
  const extStaticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const extStaticMesh = new THREE.Mesh(extStaticGeo, extStaticMat);
  extStaticMesh.name = 'outer-wilds-exterior-static';
  extStaticMesh.matrixAutoUpdate = false;
  extStaticMesh.updateMatrix();
  exteriorGroup.add(extStaticMesh);

  const rillGeo = rillBaker.buildGeometry('rill');
  const rillMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.84,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const rillMesh = new THREE.Mesh(rillGeo, rillMat);
  rillMesh.name = 'outer-wilds-rill';
  rillMesh.renderOrder = 1;
  rillMesh.matrixAutoUpdate = false;
  rillMesh.updateMatrix();
  interiorGroup.add(rillMesh);

  // ============================================================================
  // 8. 外山四隅「攒三聚五、疏可走马」林石草木群落 (Filling Image 1's Empty Expanse)
  // ============================================================================
  function isWildSafe(x, z, radius, maxSlope = 0.62) {
    if (Math.abs(x) > halfBound - radius || Math.abs(z) > halfBound - radius) return false;
    if (Math.hypot(x - slitX, z - slitZ) < 28 + radius) return false;
    if (distanceToRiver && distanceToRiver(x, z) < (world?.stream?.halfWidth || 22) + 4.5 + radius) return false;

    // Protect core village & existing inner borderlands: populate outer basin ring plus empty NE/North/NW high slopes
    const rBasin = Math.hypot(x - basin.x, z - basin.z);
    const inEastEmpty = x > 128 && z < -68;
    const inWestEmpty = x < -56 && z < -68;
    const inNorthEmpty = z < -242;
    const inNorthSlopeGap = z < -180 && rBasin > 88 && (x > 36 || x < -26 || z < -224);
    const inSouthCorners = z >= -108 && z <= -66 && (x > 96 || x < -36) && rBasin < 126;
    if (rBasin < 116 && !inEastEmpty && !inWestEmpty && !inNorthEmpty && !inNorthSlopeGap && !inSouthCorners) return false;

    // Avoid blocking the south cliff wall exterior face near peach valley (z > -55 and |x - 10| < 120)
    if (z > -52 && x > -95 && x < 135) return false;

    const h = rawGround(x, z);
    if (!Number.isFinite(h) || h < waterLevel + 0.85 || slopeAt(x, z) > maxSlope) return false;

    for (let i = 0; i < resCircles.length; i++) {
      const c = resCircles[i];
      if (Math.hypot(x - c.x, z - c.z) < c.r + radius + 0.35) return false;
    }
    for (let i = 0; i < resBoxes.length; i++) {
      if (boxDistance(x, z, resBoxes[i]) < radius + 0.45) return false;
    }
    for (let i = 0; i < resCorridors.length; i++) {
      const cor = resCorridors[i];
      if (polyDist(x, z, cor.points) < cor.half + radius + 0.45) return false;
    }
    return true;
  }

  // Zones targeting East/NE expanse, the NE/North Cascade-to-Kiln mountain slopes (Image 3), NW slopes, and West hills
  const wildZones = [
    { x0: 38,  x1: 148, z0: -288, z1: -180, weight: 0.24 }, // Core NE/North slope gap between North Cascade & Kiln (Image 3!)
    { x0: 138, x1: 235, z0: -312, z1: -205, weight: 0.14 }, // Upper NE ridge foreground of Image 3
    { x0: 128, x1: 205, z0: -215, z1: -78,  weight: 0.16 }, // East village-to-ridge gap
    { x0: 205, x1: 335, z0: -290, z1: 35,   weight: 0.11 }, // Outer East foothills
    { x0: -145, x1: 22, z0: -298, z1: -186, weight: 0.16 }, // NW / North-West mountain tea & woodcutter ridge
    { x0: -165, x1: -56, z0: -245, z1: -72, weight: 0.11 }, // West / Southwest basin-to-ridge gap
    { x0: -325, x1: -160, z0: -285, z1: 35, weight: 0.08 }  // Far West rolling hills
  ];

  function pickZone(rng) {
    let r = rng();
    for (let i = 0; i < wildZones.length; i++) {
      r -= wildZones[i].weight;
      if (r <= 0) return wildZones[i];
    }
    return wildZones[0];
  }

  // Song-Yuan "疏可走马" meadow clearing field: keeps ~38% of slopes as open grassy breathing glades!
  function inPoeticGrovePatch(x, z) {
    const n = 0.5
      + 0.28 * Math.sin(x * 0.034 + z * 0.029 + 0.8)
      + 0.22 * Math.cos(x * 0.058 - z * 0.049 - 1.1)
      + 0.14 * Math.sin((x - z) * 0.092);
    return n > 0.34;
  }

  const pineRecords = [];
  const mapleRecords = [];
  const blossomRecords = [];
  const bambooRecords = [];
  const teaRecords = [];
  const cragRecords = [];
  const tuftRecords = [];

  // Hero framing trees at the 6 mountain sanctuaries
  const heroSpecs = [
    { list: pineRecords, x: 159.4, z: -161.2, sc: 1.38, yaw: -0.8, tint: '#FFFFFF' },
    { list: pineRecords, x: 152.2, z: -167.4, sc: 1.22, yaw: 1.4, tint: '#EAF2ED' },
    { list: mapleRecords, x: 158.6, z: -167.8, sc: 1.26, yaw: 0.6, tint: '#FFFFFF' },
    { list: mapleRecords, x: 145.2, z: -120.4, sc: 1.18, yaw: 2.1, tint: '#F5F7EC' },
    { list: pineRecords, x: 132.0, z: -225.2, sc: 1.28, yaw: 0.5, tint: '#FFFFFF' },
    { list: pineRecords, x: -85.6, z: -172.5, sc: 1.35, yaw: -1.5, tint: '#FFFFFF' },
    { list: mapleRecords, x: -78.8, z: -180.6, sc: 1.20, yaw: 0.9, tint: '#FFFFFF' },
    { list: pineRecords, x: teaHut.x + 4.4, z: teaHut.z - 3.2, sc: 1.42, yaw: -0.6, tint: '#FFFFFF' },
    { list: mapleRecords, x: teaHut.x - 4.8, z: teaHut.z - 2.6, sc: 1.28, yaw: 1.2, tint: '#F5F7EC' },
    { list: blossomRecords, x: teaHut.x - 3.9, z: teaHut.z + 3.4, sc: 1.18, yaw: 0.4, tint: pal.blossomPink },
    { list: pineRecords, x: woodHut.x - 4.6, z: woodHut.z - 2.8, sc: 1.36, yaw: 0.9, tint: '#EAF2ED' },
    { list: mapleRecords, x: woodHut.x + 4.2, z: woodHut.z - 3.1, sc: 1.24, yaw: -1.1, tint: '#FFFFFF' }
  ];
  for (const h of heroSpecs) {
    const hy = surface(h.x, h.z);
    h.list.push({ x: h.x, y: hy, z: h.z, scale: h.sc, yaw: h.yaw, tint: h.tint });
    resCircles.push({ x: h.x, z: h.z, r: 1.45 * h.sc });
  }

  // Clustered scatter helper ("攒三聚五": 3..6 items per cluster with varied leader/follower scales)
  function populateClustered(targetCount, seedTag, radiusBase, scaleRange, tints, outList, allowClearings = false) {
    const rng = makeRng(cfg.seed, seedTag);
    let tries = 0;
    while (outList.length < targetCount && tries < targetCount * 22) {
      tries++;
      const zn = pickZone(rng);
      const cx = lerp(zn.x0, zn.x1, rng());
      const cz = lerp(zn.z0, zn.z1, rng());
      if (!allowClearings && !inPoeticGrovePatch(cx, cz)) continue;
      const groupN = 2 + Math.floor(rng() * 5); // 2..6 per cluster
      for (let k = 0; k < groupN && outList.length < targetCount; k++) {
        const ang = rng() * TAU;
        const dist = k === 0 ? 0 : (1.8 + rng() * 6.8);
        const x = cx + Math.cos(ang) * dist;
        const z = cz + Math.sin(ang) * dist;
        const sc = k === 0
          ? lerp(scaleRange[0] * 1.15, scaleRange[1], rng())
          : lerp(scaleRange[0] * 0.78, scaleRange[1] * 0.88, rng());
        if (!isWildSafe(x, z, radiusBase * sc, 0.64)) continue;
        const y = surface(x, z);
        outList.push({
          x, y, z,
          scale: sc,
          yaw: rng() * TAU,
          tint: tints[outList.length % tints.length]
        });
        resCircles.push({ x, z, r: radiusBase * sc * 0.88 });
      }
    }
  }

  populateClustered(cfg.counts.pines, 'ow-pines', 1.5, [0.85, 1.52], ['#FFFFFF', '#EBF3EE', '#DCEAE2', '#F2F5EC'], pineRecords);
  populateClustered(cfg.counts.maples, 'ow-maples', 1.4, [0.82, 1.42], ['#FFFFFF', '#F4F7EA', '#EBF2E4'], mapleRecords);
  populateClustered(cfg.counts.wildBlossoms, 'ow-blossoms', 1.35, [0.80, 1.32], [pal.blossomPink, pal.blossomPale, '#DCE8CE'], blossomRecords);
  populateClustered(cfg.counts.bambooClumps, 'ow-bamboo', 1.0, [0.84, 1.36], ['#FFFFFF', '#EEF4E2', '#E4EED8'], bambooRecords);

  // Contour-hugging mountain wild-tea & medicinal herb rows near Pine-Breeze Tea Shelter & NW Ridge
  {
    const rngTea = makeRng(cfg.seed, 'ow-tea-shrubs');
    const targetTea = cfg.counts.teaShrubs || 165;
    const teaPatches = [
      { cx: 70.5, cz: -226.5, rx: 14.0, rz: 8.5, rows: 5 },
      { cx: 94.5, cz: -242.5, rx: 13.0, rz: 7.5, rows: 4 },
      { cx: 116.0, cz: -232.0, rx: 14.0, rz: 8.5, rows: 4 },
      { cx: 56.0, cz: -236.0, rx: 11.5, rz: 7.0, rows: 4 },
      { cx: -56.5, cz: -226.0, rx: 11.0, rz: 7.0, rows: 4 }
    ];
    for (let p = 0; p < teaPatches.length && teaRecords.length < targetTea; p++) {
      const tp = teaPatches[p];
      for (let r = 0; r < tp.rows && teaRecords.length < targetTea; r++) {
        const v = tp.rows > 1 ? (r / (tp.rows - 1)) * 2 - 1 : 0;
        const zBase = tp.cz + v * tp.rz;
        const cols = 10;
        for (let c = 0; c < cols && teaRecords.length < targetTea; c++) {
          const u = (c / (cols - 1)) * 2 - 1;
          const x = tp.cx + u * tp.rx + Math.sin(r * 1.4 + c * 0.5) * 0.55;
          const z = zBase + Math.sin(u * 2.2 + p) * 1.15;
          const sc = 0.82 + rngTea() * 0.36;
          if (!isWildSafe(x, z, 0.52 * sc, 0.62)) continue;
          teaRecords.push({
            x,
            y: surface(x, z),
            z,
            scale: sc,
            yaw: rngTea() * TAU,
            tint: (r + c) % 3 === 0 ? '#DCE8CE' : '#FFFFFF'
          });
          resCircles.push({ x, z, r: 0.48 * sc });
        }
      }
    }
  }

  // Stratified Song-Yuan mossy crags along ridges, trails & rill banks
  {
    const rngCrag = makeRng(cfg.seed, 'ow-crags');
    let tries = 0;
    while (cragRecords.length < cfg.counts.crags && tries < cfg.counts.crags * 20) {
      tries++;
      const zn = pickZone(rngCrag);
      const x = lerp(zn.x0, zn.x1, rngCrag());
      const z = lerp(zn.z0, zn.z1, rngCrag());
      const sc = 0.85 + rngCrag() * 1.65;
      if (!isWildSafe(x, z, 0.85 * sc, 0.75)) continue;
      const y = surface(x, z);
      cragRecords.push({
        x, y, z,
        sx: sc * (0.85 + rngCrag() * 0.38),
        sy: sc * (0.68 + rngCrag() * 0.56),
        sz: sc * (0.84 + rngCrag() * 0.36),
        yaw: rngCrag() * TAU,
        tint: cragRecords.length % 3 === 0 ? '#E6EFEA' : '#FFFFFF'
      });
      resCircles.push({ x, z, r: 0.78 * sc });
    }
  }

  // Mountain ferns & wildflower grass tufts (enriching trail edges, rill banks & open glades)
  populateClustered(
    cfg.counts.fernsAndTufts,
    'ow-tufts',
    0.26,
    [0.68, 1.35],
    ['#7CA056', '#92B068', '#6B8D50', '#B4C67E', '#DAE1B4'],
    tuftRecords,
    true
  );

  const tmpMat = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpScale = new THREE.Vector3();
  const tmpCol = new THREE.Color();

  function makeInstanced(geo, mat, list, name) {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = name;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const sx = it.sx ?? it.scale ?? 1;
      const sy = it.sy ?? it.scale ?? 1;
      const sz = it.sz ?? it.scale ?? 1;
      tmpPos.set(it.x, it.y, it.z);
      tmpEuler.set(0, it.yaw || 0, 0, 'YXZ');
      tmpQuat.setFromEuler(tmpEuler);
      tmpScale.set(sx, sy, sz);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      mesh.setMatrixAt(i, tmpMat);
      mesh.setColorAt(i, tmpCol.set(it.tint || '#FFFFFF'));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    sharedGroup.add(mesh);
    return mesh;
  }

  const pineGeo = buildCliffPineGeometry(pal);
  const mapleGeo = buildMountainMapleGeometry(pal);
  const mapleCrownTags = [{ tag: 'maple-crown', start: 0, end: mapleGeo.attributes.position.count }];
  void mapleCrownTags;
  const blossomGeo = buildBlossomTreeGeometry(pal);
  const bambooGeo = buildHillsideBambooGeometry(pal);
  const teaGeo = buildTeaOrHerbShrubGeometry(pal);
  const cragGeo = buildStratifiedCragGeometry(pal);
  const tuftGeo = buildMeadowTuftGeometry();

  const folMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const solidInstMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  const pineMesh = makeInstanced(pineGeo, solidInstMat(), pineRecords, 'outer-wilds-pines');
  const mapleMesh = makeInstanced(mapleGeo, solidInstMat(), mapleRecords, 'outer-wilds-maples');
  const blossomMesh = makeInstanced(blossomGeo, solidInstMat(), blossomRecords, 'outer-wilds-blossoms');
  const bambooMesh = makeInstanced(bambooGeo, folMat(), bambooRecords, 'outer-wilds-bamboo');
  const teaMesh = makeInstanced(teaGeo, solidInstMat(), teaRecords, 'outer-wilds-tea-shrubs');
  const cragMesh = makeInstanced(cragGeo, solidInstMat(), cragRecords, 'outer-wilds-crags');
  const tuftMesh = makeInstanced(tuftGeo, folMat(), tuftRecords, 'outer-wilds-tufts');
  void pineMesh; void bambooMesh; void teaMesh; void cragMesh; void tuftMesh;

  // ============================================================================
  // 9. 活态呦鹿、山居炊烟茶雾、涧水飞沫与山人劳作对弈 (Shared dynamic batches)
  // ============================================================================
  const deerParts = createSikaDeerParts(pal);
  const fxDropGeo = buildWaterFxGeometry();
  const slotGeos = [];
  const deerSlots = [];
  const deerActors = [
    { x: dh.x - 3.6, z: dh.z + 2.8, yaw: 0.85, scale: 1.0, phase: 0.0, petTimer: 0, petX: 0, petZ: 0 },
    { x: dh.x - 5.1, z: dh.z + 1.4, yaw: 1.42, scale: 0.76, phase: 2.1, petTimer: 0, petX: 0, petZ: 0 }
  ];
  for (let i = 0; i < deerActors.length; i++) {
    deerActors[i].y = surface(deerActors[i].x, deerActors[i].z);
    deerSlots.push({ body: slotGeos.length, head: slotGeos.length + 1 });
    slotGeos.push(deerParts.bodyGeo, deerParts.headGeo);
  }
  const KILN_SMOKE_COUNT = 6;
  const smokeSlots = [];
  for (let i = 0; i < KILN_SMOKE_COUNT; i++) {
    smokeSlots.push(slotGeos.length);
    slotGeos.push(fxDropGeo);
  }
  const TEA_STEAM_COUNT = 4;
  const teaSteamSlots = [];
  for (let i = 0; i < TEA_STEAM_COUNT; i++) {
    teaSteamSlots.push(slotGeos.length);
    slotGeos.push(fxDropGeo);
  }
  const HUT_SMOKE_COUNT = 5;
  const hutSmokeSlots = [];
  for (let i = 0; i < HUT_SMOKE_COUNT; i++) {
    hutSmokeSlots.push(slotGeos.length);
    slotGeos.push(fxDropGeo);
  }
  const dropSlots = [];
  for (let i = 0; i < rillDroplets.length; i++) {
    dropSlots.push(slotGeos.length);
    slotGeos.push(fxDropGeo);
  }

  const dynMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const dynBatch = createRigidBatchMesh(slotGeos, dynMat, 'outer-wilds-dynamic');
  interiorGroup.add(dynBatch.mesh);

  // Warm firebox charcoal glow & tea-shelter风灯 at dusk/night (strictly hidden in day -> 0 daytime draw!)
  const emberGeo = new THREE.SphereGeometry(0.24, 6, 5);
  const emberMat = new THREE.MeshBasicMaterial({ color: pal.emberGlow, transparent: true, opacity: 0.85 });
  emberMat.userData.skyIgnore = true;
  const emberMesh = new THREE.InstancedMesh(emberGeo, emberMat, 2);
  emberMesh.name = 'outer-wilds-kiln-ember';
  tmpQuat.identity();
  tmpScale.set(1, 0.78, 1);
  tmpPos.set(kilnFireboxWorld[0], kilnFireboxWorld[1], kilnFireboxWorld[2]);
  tmpMat.compose(tmpPos, tmpQuat, tmpScale);
  emberMesh.setMatrixAt(0, tmpMat);
  tmpScale.set(0.68, 0.85, 0.68);
  tmpPos.set(teaLanternWorld[0], teaLanternWorld[1], teaLanternWorld[2]);
  tmpMat.compose(tmpPos, tmpQuat, tmpScale);
  emberMesh.setMatrixAt(1, tmpMat);
  emberMesh.instanceMatrix.needsUpdate = true;
  emberMesh.computeBoundingSphere();
  emberMesh.visible = false;
  interiorGroup.add(emberMesh);

  // 7 Living Mountain Villagers bringing human warmth to the mountain slopes ("山上有人气")
  const mountainActorGroup = new THREE.Group();
  mountainActorGroup.name = 'outer-wilds-actors';
  mountainActorGroup.userData.dynamic = true;
  interiorGroup.add(mountainActorGroup);
  const mountainRig = createCommunityActors(mountainActorGroup, 7);

  const lkCfg = cfg.sanctuaries.lankeCrag;
  const woodcutterWaypoints = [
    [56.5, -222.5],
    [64.5, -227.2],
    [74.5, -231.8],
    [80.2, -233.2]
  ];
  const mountainVillagers = [
    {
      index: 0,
      id: 'ow-tea-host',
      key: 'c_ow-tea-host',
      name: '松风茶翁',
      label: '松风茶翁',
      role: 'mountain_tea_host',
      voiceRole: 'elder',
      kind: 'elder',
      female: false,
      child: false,
      x: teaHut.x + 0.58,
      y: surface(teaHut.x + 0.58, teaHut.z - 0.52),
      z: teaHut.z - 0.52,
      facing: 0.42,
      s: 1.0,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '半山风凉，泥炉上山泉正沸，抓一把早晨刚摘的云雾毛尖，客人快坐下吃碗热茶歇歇脚！',
        '这北岭坡向阳又笼着三叠泉的水雾，野茶树自己顺坡长成绿垄，过路担柴的、采药的都爱在这儿聚聚。'
      ]
    },
    {
      index: 1,
      id: 'ow-woodcutter',
      key: 'c_ow-woodcutter',
      name: '云岭樵夫',
      label: '云岭樵夫',
      role: 'woodcutter',
      voiceRole: 'villager',
      kind: 'beekeeper',
      female: false,
      child: false,
      x: woodcutterWaypoints[1][0],
      y: surface(woodcutterWaypoints[1][0], woodcutterWaypoints[1][1]),
      z: woodcutterWaypoints[1][1],
      facing: 1.15,
      s: 1.02,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '哈，山路微陡，客人好脚力！我只拣风折的干松枝捆成两担挑去古窑与村里，活树新枝一概不伤。',
        '挑担走累了就往松风茶寮一歇，低头能望见满谷稻田水池，风一吹汗就消尽啰！'
      ]
    },
    {
      index: 2,
      id: 'ow-tea-picker',
      key: 'c_ow-tea-picker',
      name: '采茶山姑',
      label: '采茶山姑',
      role: 'tea_picker',
      voiceRole: 'woman',
      kind: 'wash',
      female: true,
      child: false,
      x: 71.8,
      y: surface(71.8, -227.2),
      z: -227.2,
      facing: -0.45,
      s: 0.96,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '趁山岚未散，专掐这一旗一枪的嫩芽尖儿；竹匾摊在茶寮檐下晒上半日，满坡都是清香呢！',
        '山上清净却不冷清，东头有烧陶的大叔和下棋的老爷爷，北涧泉声伴着鸟啼，采起茶来一点不觉乏。'
      ]
    },
    {
      index: 3,
      id: 'ow-lanke-elder-a',
      key: 'c_ow-lanke-elder-a',
      name: '对弈白发翁',
      label: '对弈白发翁',
      role: 'lanke_elder',
      voiceRole: 'elder',
      kind: 'elder',
      female: false,
      child: false,
      x: lkCfg.x - 0.96,
      y: surface(lkCfg.x, lkCfg.z) + 0.35,
      z: lkCfg.z + 0.17,
      facing: Math.atan2(0.96, -0.17),
      s: 1.0,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '哈哈，远客也寻上东岭来观棋？这一着黑子借松花落处做眼，老周头想了半晌还没应出来哩！',
        '山中无甲子，黑白溪石随手摆开便是天地，输赢皆付一壶村酿，客人不妨石畔同看。'
      ]
    },
    {
      index: 4,
      id: 'ow-lanke-elder-b',
      key: 'c_ow-lanke-elder-b',
      name: '观局松下叟',
      label: '观局松下叟',
      role: 'lanke_elder',
      voiceRole: 'elder',
      kind: 'elder',
      female: false,
      child: false,
      x: lkCfg.x + 0.92,
      y: surface(lkCfg.x, lkCfg.z) + 0.35,
      z: lkCfg.z - 0.21,
      facing: Math.atan2(-0.92, 0.21),
      s: 0.99,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '莫急莫急，听这松风过耳、涧水淙淙，棋子落在青石枰上自有清音，何必争那一目半目？',
        '往下看去，村里阡陌如棋格，耕牛白鹭便是活棋子——那才是百看不厌的大好局面呐。'
      ]
    },
    {
      index: 5,
      id: 'ow-kiln-potter',
      key: 'c_ow-kiln-potter',
      name: '守窑陶匠',
      label: '守窑陶匠',
      role: 'kiln_potter',
      voiceRole: 'villager',
      kind: 'villager',
      female: false,
      child: false,
      x: kiln.x + 2.15,
      y: surface(kiln.x + 2.15, kiln.z + 1.35),
      z: kiln.z + 1.35,
      facing: -0.65,
      s: 1.01,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '取北涧下沉淀的细腻澄泥拉坯阴干，入这座馒头窑用干松柴慢火烧足三昼夜，敲起来声如清磬！',
        '村里温粟酒的陶鬲、盛山泉的大瓮，还有曲水流觞的漆胎耳杯，全是从这山阿窑火里出来的。'
      ]
    },
    {
      index: 6,
      id: 'ow-nw-woodman',
      key: 'c_ow-nw-woodman',
      name: '西岭山人',
      label: '西岭山人',
      role: 'woodcutter',
      voiceRole: 'elder',
      kind: 'elder',
      female: false,
      child: false,
      x: woodHut.x + 1.45,
      y: surface(woodHut.x + 1.45, woodHut.z + 1.55),
      z: woodHut.z + 1.55,
      facing: 0.55,
      s: 1.0,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '老汉贪图西北岭上松风清旷，便在此结庐守林；清晨常有两只梅花鹿踱到鹿柴边吃青苔哩。',
        '晴日晒松柴、雨天编竹篓，望见谷底烟火袅袅，心里便觉安稳踏实。'
      ]
    }
  ];
  const activeMountainActors = [];

  // ============================================================================
  // 10. 四时物候染色与回春精确字节恢复 (Spring / Summer / Autumn / Winter)
  // ============================================================================
  let currentPhenology = 'spring';
  let snapshotted = false;
  const snaps = {};

  function ensureSnapshots() {
    if (snapshotted) return;
    snapshotted = true;
    snaps.staticCol = new Float32Array(staticGeo.attributes.color.array);
    snaps.extStaticCol = new Float32Array(extStaticGeo.attributes.color.array);
    snaps.mapleGeoCol = new Float32Array(mapleGeo.attributes.color.array);
    // Crown mask on mapleGeo (greenish vertices where g > r * 1.05)
    const mc = snaps.mapleGeoCol;
    const mMask = new Uint8Array(mc.length / 3);
    for (let v = 0, i = 0; v < mMask.length; v++, i += 3) {
      if (mc[i + 1] > mc[i] * 1.04 && mc[i + 1] > 0.35) mMask[v] = 1;
    }
    snaps.mapleCrownMask = mMask;
    if (mapleMesh?.instanceColor) snaps.mapleInst = new Float32Array(mapleMesh.instanceColor.array);

    snaps.blossomGeoCol = new Float32Array(blossomGeo.attributes.color.array);
    const bc = snaps.blossomGeoCol;
    const bMask = new Uint8Array(bc.length / 3);
    for (let v = 0, i = 0; v < bMask.length; v++, i += 3) {
      if (bc[i] > 0.32 && bc[i + 2] > 0.16 && (bc[i] - bc[i + 1]) > 0.04) bMask[v] = 1;
    }
    snaps.blossomCrownMask = bMask;
    if (blossomMesh?.instanceColor) snaps.blossomInst = new Float32Array(blossomMesh.instanceColor.array);
    snaps.cragGeoCol = new Float32Array(cragGeo.attributes.color.array);
    snaps.teaGeoCol = new Float32Array(teaGeo.attributes.color.array);
    snaps.tuftGeoCol = new Float32Array(tuftGeo.attributes.color.array);
    if (collarGeo) snaps.collarCol = new Float32Array(collarGeo.attributes.color.array);
  }

  const _snowC = new THREE.Color('#EAE8E0');
  const _autRed = new THREE.Color(pal.mapleAutumn || '#C86442');
  const _autGold = new THREE.Color(pal.mapleGold || '#D69E49');
  const _sumLeafA = new THREE.Color('#488246');
  const _sumLeafB = new THREE.Color('#5F9954');

  function applyStaticTagSnow(geo, baseArr, tags, snowStrength) {
    const dst = geo.attributes.color.array;
    const nor = geo.attributes.normal.array;
    dst.set(baseArr);
    for (const t of tags) {
      if (t.tag !== 'frost-cap' && t.tag !== 'frost-roof' && t.tag !== 'dip-blossom' && t.tag !== 'willow-frond' && t.tag !== 'ow-trail') continue;
      for (let v = t.start; v < t.end; v++) {
        const i = v * 3;
        const ny = Math.abs(nor[i + 1]);
        if (ny < 0.15) continue;
        const f = (t.tag === 'ow-trail' ? snowStrength * 0.85 : snowStrength) * clamp(ny, 0.2, 1);
        dst[i] = lerp(baseArr[i], _snowC.r, f);
        dst[i + 1] = lerp(baseArr[i + 1], _snowC.g, f);
        dst[i + 2] = lerp(baseArr[i + 2], _snowC.b, f);
      }
    }
    geo.attributes.color.needsUpdate = true;
  }

  function applyStaticTrailSeason(geo, baseArr, tags, seasonId) {
    const dst = geo.attributes.color.array;
    let touched = false;
    for (const t of tags) {
      if (t.tag !== 'ow-trail') continue;
      touched = true;
      for (let v = t.start; v < t.end; v++) {
        const i = v * 3;
        const sr = baseArr[i], sg = baseArr[i + 1], sb = baseArr[i + 2];
        if (seasonId === 'summer') {
          dst[i] = clamp(sr * 0.90, 0.05, 1);
          dst[i + 1] = clamp(sg * 1.05 + 0.012, 0.05, 1);
          dst[i + 2] = clamp(sb * 0.92, 0.05, 1);
        } else {
          dst[i] = clamp(sr * 1.12 + 0.035, 0.05, 1);
          dst[i + 1] = clamp(sg * 0.96, 0.05, 1);
          dst[i + 2] = clamp(sb * 0.78, 0.05, 1);
        }
      }
    }
    if (touched) geo.attributes.color.needsUpdate = true;
  }

  function setPhenology(id) {
    const next = (id === 'summer' || id === 'autumn' || id === 'winter') ? id : 'spring';
    if (next === currentPhenology && (next !== 'spring' || !snapshotted)) return false;
    ensureSnapshots();
    currentPhenology = next;

    // Restore base spring colors first
    staticGeo.attributes.color.array.set(snaps.staticCol);
    staticGeo.attributes.color.needsUpdate = true;
    extStaticGeo.attributes.color.array.set(snaps.extStaticCol);
    extStaticGeo.attributes.color.needsUpdate = true;
    mapleGeo.attributes.color.array.set(snaps.mapleGeoCol);
    mapleGeo.attributes.color.needsUpdate = true;
    if (mapleMesh?.instanceColor && snaps.mapleInst) {
      mapleMesh.instanceColor.array.set(snaps.mapleInst);
      mapleMesh.instanceColor.needsUpdate = true;
    }
    blossomGeo.attributes.color.array.set(snaps.blossomGeoCol);
    blossomGeo.attributes.color.needsUpdate = true;
    if (blossomMesh?.instanceColor && snaps.blossomInst) {
      blossomMesh.instanceColor.array.set(snaps.blossomInst);
      blossomMesh.instanceColor.needsUpdate = true;
    }
    cragGeo.attributes.color.array.set(snaps.cragGeoCol);
    cragGeo.attributes.color.needsUpdate = true;
    teaGeo.attributes.color.array.set(snaps.teaGeoCol);
    teaGeo.attributes.color.needsUpdate = true;
    tuftGeo.attributes.color.array.set(snaps.tuftGeoCol);
    tuftGeo.attributes.color.needsUpdate = true;
    if (collarGeo && snaps.collarCol) {
      collarGeo.attributes.color.array.set(snaps.collarCol);
      collarGeo.attributes.color.needsUpdate = true;
    }

    if (next === 'spring') return true;

    if (collarGeo && snaps.collarCol) {
      const cDst = collarGeo.attributes.color.array;
      const cSrc = snaps.collarCol;
      const tint = next === 'winter'
        ? new THREE.Color('#E3E5DF')
        : next === 'autumn'
          ? new THREE.Color('#BFA36F')
          : new THREE.Color('#6F9668');
      const mixAmt = next === 'winter' ? 0.66 : next === 'autumn' ? 0.56 : 0.25;
      for (let i = 0; i < cSrc.length; i += 3) {
        cDst[i] = lerp(cSrc[i], tint.r, mixAmt);
        cDst[i + 1] = lerp(cSrc[i + 1], tint.g, mixAmt);
        cDst[i + 2] = lerp(cSrc[i + 2], tint.b, mixAmt);
      }
      collarGeo.attributes.color.needsUpdate = true;
    }

    if (next === 'summer') {
      applyStaticTrailSeason(staticGeo, snaps.staticCol, staticTags, 'summer');
      applyStaticTrailSeason(extStaticGeo, snaps.extStaticCol, extStaticTags, 'summer');
      const mDst = mapleGeo.attributes.color.array;
      for (let v = 0, i = 0; v < snaps.mapleCrownMask.length; v++, i += 3) {
        if (!snaps.mapleCrownMask[v]) continue;
        mDst[i] *= 0.82;
        mDst[i + 1] = Math.min(1, mDst[i + 1] * 1.10);
        mDst[i + 2] *= 0.88;
      }
      mapleGeo.attributes.color.needsUpdate = true;
      const bDst = blossomGeo.attributes.color.array;
      for (let v = 0, i = 0; v < snaps.blossomCrownMask.length; v++, i += 3) {
        if (!snaps.blossomCrownMask[v]) continue;
        const cRef = (v % 3 === 0) ? _sumLeafB : _sumLeafA;
        bDst[i] = lerp(snaps.blossomGeoCol[i], cRef.r, 0.84);
        bDst[i + 1] = lerp(snaps.blossomGeoCol[i + 1], cRef.g, 0.84);
        bDst[i + 2] = lerp(snaps.blossomGeoCol[i + 2], cRef.b, 0.84);
      }
      blossomGeo.attributes.color.needsUpdate = true;
      if (blossomMesh?.instanceColor) {
        const sumTint = [new THREE.Color('#DCECD4'), new THREE.Color('#CBE2C4'), new THREE.Color('#E6F2DC')];
        const bInst = blossomMesh.instanceColor.array;
        for (let idx = 0, i = 0; i < bInst.length; idx++, i += 3) {
          const tc = sumTint[idx % sumTint.length];
          bInst[i] = tc.r; bInst[i + 1] = tc.g; bInst[i + 2] = tc.b;
        }
        blossomMesh.instanceColor.needsUpdate = true;
      }
      return true;
    }

    if (next === 'autumn') {
      applyStaticTrailSeason(staticGeo, snaps.staticCol, staticTags, 'autumn');
      applyStaticTrailSeason(extStaticGeo, snaps.extStaticCol, extStaticTags, 'autumn');
      // 丹枫乌桕：外山层林尽染朱赭与流金
      const mDst = mapleGeo.attributes.color.array;
      for (let v = 0, i = 0; v < snaps.mapleCrownMask.length; v++, i += 3) {
        if (!snaps.mapleCrownMask[v]) continue;
        const cRef = (v % 3 === 0) ? _autGold : _autRed;
        mDst[i] = lerp(snaps.mapleGeoCol[i], cRef.r, 0.78);
        mDst[i + 1] = lerp(snaps.mapleGeoCol[i + 1], cRef.g, 0.78);
        mDst[i + 2] = lerp(snaps.mapleGeoCol[i + 2], cRef.b, 0.78);
      }
      mapleGeo.attributes.color.needsUpdate = true;
      const bDst = blossomGeo.attributes.color.array;
      for (let v = 0, i = 0; v < snaps.blossomCrownMask.length; v++, i += 3) {
        if (!snaps.blossomCrownMask[v]) continue;
        const cRef = (v % 3 === 0) ? _autGold : _autRed;
        bDst[i] = lerp(snaps.blossomGeoCol[i], cRef.r, 0.80);
        bDst[i + 1] = lerp(snaps.blossomGeoCol[i + 1], cRef.g, 0.80);
        bDst[i + 2] = lerp(snaps.blossomGeoCol[i + 2], cRef.b, 0.80);
      }
      blossomGeo.attributes.color.needsUpdate = true;
      if (blossomMesh?.instanceColor) {
        const autTint = [new THREE.Color('#F2D088'), new THREE.Color('#E6A266'), new THREE.Color('#ECDC98')];
        const bInst = blossomMesh.instanceColor.array;
        for (let idx = 0, i = 0; i < bInst.length; idx++, i += 3) {
          const tc = autTint[idx % autTint.length];
          bInst[i] = tc.r; bInst[i + 1] = tc.g; bInst[i + 2] = tc.b;
        }
        blossomMesh.instanceColor.needsUpdate = true;
      }
      if (mapleMesh?.instanceColor && snaps.mapleInst) {
        const iDst = mapleMesh.instanceColor.array;
        for (let idx = 0, i = 0; i < iDst.length; idx++, i += 3) {
          if (idx % 3 === 0) {
            iDst[i] = 1.05; iDst[i + 1] = 0.92; iDst[i + 2] = 0.72;
          } else {
            iDst[i] = 1.02; iDst[i + 1] = 0.78; iDst[i + 2] = 0.68;
          }
        }
        mapleMesh.instanceColor.needsUpdate = true;
      }
      const tDst = tuftGeo.attributes.color.array;
      for (let i = 0; i < tDst.length; i += 3) {
        tDst[i] = Math.min(1, tDst[i] * 1.22 + 0.05);
        tDst[i + 1] = Math.min(1, tDst[i + 1] * 1.02);
        tDst[i + 2] *= 0.76;
      }
      tuftGeo.attributes.color.needsUpdate = true;
      return true;
    }

    // Winter snow dusting across outer crags, sanctuaries, maples & tufts
    applyStaticTagSnow(staticGeo, snaps.staticCol, staticTags, 0.62);
    applyStaticTagSnow(extStaticGeo, snaps.extStaticCol, extStaticTags, 0.62);

    const mDst = mapleGeo.attributes.color.array;
    for (let v = 0, i = 0; v < snaps.mapleCrownMask.length; v++, i += 3) {
      if (!snaps.mapleCrownMask[v]) continue;
      mDst[i] = lerp(snaps.mapleGeoCol[i], _snowC.r, 0.74);
      mDst[i + 1] = lerp(snaps.mapleGeoCol[i + 1], _snowC.g, 0.74);
      mDst[i + 2] = lerp(snaps.mapleGeoCol[i + 2], _snowC.b, 0.74);
    }
    mapleGeo.attributes.color.needsUpdate = true;

    const bDst = blossomGeo.attributes.color.array;
    const bNor = blossomGeo.attributes.normal?.array;
    for (let v = 0, i = 0; v < snaps.blossomCrownMask.length; v++, i += 3) {
      if (!snaps.blossomCrownMask[v]) continue;
      const ny = bNor ? bNor[i + 1] : 0.4;
      const snowMix = ny > 0.15 ? 0.86 : 0.45;
      const baseTone = ny > 0.15 ? 0.72 : 0.36;
      bDst[i] = lerp(baseTone, _snowC.r, snowMix);
      bDst[i + 1] = lerp(baseTone * 1.01, _snowC.g, snowMix);
      bDst[i + 2] = lerp(baseTone * 1.02, _snowC.b, snowMix);
    }
    blossomGeo.attributes.color.needsUpdate = true;
    if (blossomMesh?.instanceColor) {
      // 冬候洗净花树实例粉色（防白顶点×粉实例透出春桃粉），呈霜枝薄雪色阶
      const winTint = [new THREE.Color('#ECEEE9'), new THREE.Color('#E1E5E2'), new THREE.Color('#D6DCDA'), new THREE.Color('#F2F3EE')];
      const bInst = blossomMesh.instanceColor.array;
      for (let idx = 0, i = 0; i < bInst.length; idx++, i += 3) {
        const tc = winTint[idx % winTint.length];
        bInst[i] = tc.r; bInst[i + 1] = tc.g; bInst[i + 2] = tc.b;
      }
      blossomMesh.instanceColor.needsUpdate = true;
    }

    const cDst = cragGeo.attributes.color.array;
    const cNor = cragGeo.attributes.normal.array;
    for (let i = 0; i < cDst.length; i += 3) {
      const ny = cNor[i + 1];
      if (ny > 0.25) {
        const f = 0.56 * clamp(ny, 0.25, 1);
        cDst[i] = lerp(snaps.cragGeoCol[i], _snowC.r, f);
        cDst[i + 1] = lerp(snaps.cragGeoCol[i + 1], _snowC.g, f);
        cDst[i + 2] = lerp(snaps.cragGeoCol[i + 2], _snowC.b, f);
      }
    }
    cragGeo.attributes.color.needsUpdate = true;

    const tDst = tuftGeo.attributes.color.array;
    for (let i = 0; i < tDst.length; i += 3) {
      tDst[i] = lerp(snaps.tuftGeoCol[i], _snowC.r, 0.65);
      tDst[i + 1] = lerp(snaps.tuftGeoCol[i + 1], _snowC.g, 0.65);
      tDst[i + 2] = lerp(snaps.tuftGeoCol[i + 2], _snowC.b, 0.65);
    }
    tuftGeo.attributes.color.needsUpdate = true;
    const teaDst = teaGeo.attributes.color.array;
    const teaNor = teaGeo.attributes.normal.array;
    for (let i = 0; i < teaDst.length; i += 3) {
      const ny = teaNor[i + 1];
      if (ny > 0.15) {
        const f = 0.62 * clamp(ny, 0.2, 1);
        teaDst[i] = lerp(snaps.teaGeoCol[i], _snowC.r, f);
        teaDst[i + 1] = lerp(snaps.teaGeoCol[i + 1], _snowC.g, f);
        teaDst[i + 2] = lerp(snaps.teaGeoCol[i + 2], _snowC.b, f);
      }
    }
    teaGeo.attributes.color.needsUpdate = true;
    return true;
  }

  // ============================================================================
  // 11. 交互绑定 (`E` 近观触发风物题注 + 空间轻音) 与暂停冻结更新
  // ============================================================================
  let disposed = false;
  let simTime = 0;
  let hasDrawnInitial = false;
  let noteEl = null;
  let noteTimer = 0;
  let lastNoteText = '';

  function triggerSite(site, sound, doc) {
    if (!site || disposed) return null;
    const text = site.lines[site.lineIdx % site.lines.length];
    site.lineIdx = (site.lineIdx + 1) % site.lines.length;
    site.cooldown = 0.75;
    const el = noteEl || doc?.getElementById?.('mystery-note') || null;
    if (el) {
      noteEl = el;
      el.textContent = text;
      el.classList?.add?.('show');
      el.setAttribute?.('aria-hidden', 'false');
      lastNoteText = text;
      noteTimer = 5.4;
    }
    try {
      sound?.unlock?.();
      if (site.soundKind === 'water') (sound?.waterCup || sound?.gurgle || sound?.bell)?.call(sound, site.x, site.z);
      else if (site.soundKind === 'tea') (sound?.teaSimmer || sound?.waterCup || sound?.bell)?.call(sound, site.x, site.z);
      else if (site.soundKind === 'jar') (sound?.jar || sound?.wood || sound?.bell)?.call(sound, site.x, site.z);
      else if (site.soundKind === 'stag') (sound?.stagCall || sound?.stag || sound?.bell || sound?.wood)?.call(sound, site.x, site.z);
      else if (site.id === 'lanke-chess-crag') (sound?.goStoneClick || sound?.wood || sound?.bell)?.call(sound, site.x, site.z);
      else (sound?.wood || sound?.bell)?.call(sound, site.x, site.z);
    } catch (_) {
      // Headless safe
    }
    return { id: site.id, name: site.name, line: text };
  }

  function pickSite(camera, playerState, pickCfg = {}) {
    if (disposed || !playerState || !camera) return null;
    const third = playerState.view === 'third';
    const eyeX = third ? playerState.x : camera.position.x;
    const eyeY = third ? playerState.y + (playerState.eyeHeight || 1.62) : camera.position.y;
    const eyeZ = third ? playerState.z : camera.position.z;
    const cp = Math.cos(playerState.pitch || 0);
    const fx = -Math.sin(playerState.yaw || 0) * cp;
    const fy = Math.sin(playerState.pitch || 0);
    const fz = -Math.cos(playerState.yaw || 0) * cp;
    let best = null;
    for (const s of interactiveSites) {
      if (s.cooldown > 0) continue;
      const distXZ = Math.hypot(s.x - playerState.x, s.z - playerState.z);
      if (distXZ > 4.2) continue;
      const ty = s.y + s.height;
      const dx = s.x - eyeX, dy = ty - eyeY, dz = s.z - eyeZ;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const dot = (dx * fx + dy * fy + dz * fz) / dist;
      if (distXZ > 2.2 && dot < 0.68) continue;
      const score = dist + (1 - dot) * (pickCfg.alignBias || 2.5);
      if (!best || score < best.score) {
        best = {
          kind: 'mystery',
          key: 'ow:' + s.id,
          id: s.id,
          isOuterWildProp: true,
          name: s.name,
          label: s.name,
          prompt: s.action + ' · ' + s.name,
          x: s.x,
          y: ty,
          z: s.z,
          dist,
          dot,
          score
        };
      }
    }
    return best;
  }

  function bind({ mysteries, sound, player, doc } = {}) {
    noteEl = doc?.getElementById?.('mystery-note') || null;
    if (!mysteries || mysteries._outerWildsBound) return;
    mysteries._outerWildsBound = true;
    const prevPick = mysteries.pickTarget;
    const prevInteract = mysteries.interact;
    const prevHide = mysteries.hide;

    mysteries.pickTarget = function (camera, pickCfg) {
      const a = prevPick?.(camera, pickCfg) || null;
      const b = pickSite(camera, player?.state, pickCfg);
      if (!a) return b;
      if (!b) return a;
      return b.score < a.score ? b : a;
    };

    mysteries.interact = function (target) {
      if (target?.isOuterWildProp) {
        const s = interactiveSites.find(item => item.id === target.id);
        return triggerSite(s, sound, doc);
      }
      return prevInteract?.(target) || null;
    };

    mysteries.hide = function () {
      noteTimer = 0;
      prevHide?.();
    };
  }

  function isOnWood(x, z) {
    for (let i = 0; i < woodDecks.length; i++) {
      const d = woodDecks[i];
      if (d.material === 'stone') continue;
      const dx = x - d.x;
      const dz = z - d.z;
      const along = Math.abs(dx * d.tx + dz * d.tz);
      const across = Math.abs(dx * d.ux + dz * d.uz);
      if (along <= d.length * 0.52 && across <= d.width * 0.52) return true;
    }
    return false;
  }

  function writeDynamics(t, sky, playerState) {
    const timeId = sky?.timeId || 'day';
    const isNight = timeId === 'night' || timeId === 'dusk';
    const windX = Number(sky?.windX ?? 0.14) || 0;
    const windZ = Number(sky?.windZ ?? 0.06) || 0;

    // 1. Sika deer (梅花鹿：晨昏活跃觅食、白昼悠然、入夜卧林安眠；来客抚鹿时温和颔首)
    const isDeepNight = timeId === 'night';
    const crepuscular = timeId === 'dawn' || timeId === 'dusk';
    for (let i = 0; i < deerActors.length; i++) {
      const d = deerActors[i];
      const sl = deerSlots[i];
      const isPetted = d.petTimer > 0;
      const nearPlayer = playerState && Math.hypot(playerState.x - d.x, playerState.z - d.z) < 11.0;
      const deerSleeping = isDeepNight && !isPetted && !nearPlayer;
      const swayRate = crepuscular ? 0.48 : 0.32;
      const swayYaw = isPetted
        ? Math.atan2(d.petX - d.x, d.petZ - d.z)
        : (deerSleeping ? d.yaw : d.yaw + Math.sin(t * swayRate + d.phase) * 0.14);
      const grazeCycle = Math.sin(t * (crepuscular ? 0.95 : 0.72) + d.phase);
      const headPitch = isPetted
        ? 0.24 * Math.sin(t * 4.2) + 0.08
        : deerSleeping
          ? 0.22 + Math.sin(t * 0.85 + d.phase) * 0.015
          : nearPlayer
            ? -0.10 + Math.sin(t * 1.8 + i) * 0.05
            : (grazeCycle > 0.15 ? 0.56 * Math.min(1, (grazeCycle - 0.15) * 1.8) : -0.06);
      const headYaw = isPetted
        ? swayYaw + Math.sin(t * 2.6) * 0.08
        : deerSleeping
          ? swayYaw + 0.18
          : nearPlayer
            ? Math.atan2(playerState.x - d.x, playerState.z - d.z)
            : swayYaw + Math.sin(t * 0.6 + d.phase) * 0.16;

      const cy = Math.cos(swayYaw);
      const sy = Math.sin(swayYaw);
      const sc = d.scale;
      const scY = deerSleeping ? sc * 0.84 : sc;
      const dy = d.y + 0.008 - (deerSleeping ? 0.18 * sc : 0);
      dynBatch.writePart(sl.body, d.x, dy, d.z, 0, swayYaw, 0, sc, scY, sc);
      dynBatch.writePart(
        sl.head,
        d.x + deerParts.headPivot[0] * sc * cy + deerParts.headPivot[2] * sc * sy,
        dy + deerParts.headPivot[1] * scY,
        d.z - deerParts.headPivot[0] * sc * sy + deerParts.headPivot[2] * sc * cy,
        headPitch,
        headYaw,
        0,
        sc, sc, sc
      );
    }

    // 2. Climbing kiln chimney smoke, tea-shelter steam & woodcutter cottage cooking smoke
    for (let i = 0; i < KILN_SMOKE_COUNT; i++) {
      const u = ((t * 0.24 + i / KILN_SMOKE_COUNT) % 1 + 1) % 1;
      const sx = kilnChimneyTop[0] + windX * u * 3.4 + Math.sin(t * 1.1 + i) * 0.22 * u;
      const sz = kilnChimneyTop[2] + windZ * u * 3.4 + Math.cos(t * 0.9 + i) * 0.22 * u;
      const sy = kilnChimneyTop[1] + u * 3.6;
      const sc = Math.sin(u * Math.PI) * (0.26 + u * 0.38);
      dynBatch.writePart(smokeSlots[i], sx, sy, sz, 0, t * 0.4 + i, 0, sc, sc * 0.78, sc);
    }
    for (let i = 0; i < TEA_STEAM_COUNT; i++) {
      const u = ((t * 0.42 + i / TEA_STEAM_COUNT) % 1 + 1) % 1;
      const sx = teaStoveTop[0] + windX * u * 1.1 + Math.sin(t * 1.9 + i) * 0.09 * u;
      const sz = teaStoveTop[2] + windZ * u * 1.1 + Math.cos(t * 1.6 + i) * 0.09 * u;
      const sy = teaStoveTop[1] + u * 1.35;
      const sc = Math.sin(u * Math.PI) * (0.11 + u * 0.14);
      dynBatch.writePart(teaSteamSlots[i], sx, sy, sz, 0, t * 0.6 + i, 0, sc, sc * 0.85, sc);
    }
    for (let i = 0; i < HUT_SMOKE_COUNT; i++) {
      const u = ((t * 0.22 + i / HUT_SMOKE_COUNT) % 1 + 1) % 1;
      const sx = woodChimneyTop[0] + windX * u * 3.1 + Math.sin(t * 0.95 + i) * 0.19 * u;
      const sz = woodChimneyTop[2] + windZ * u * 3.1 + Math.cos(t * 0.85 + i) * 0.19 * u;
      const sy = woodChimneyTop[1] + u * 3.4;
      const sc = Math.sin(u * Math.PI) * (0.22 + u * 0.34);
      dynBatch.writePart(hutSmokeSlots[i], sx, sy, sz, 0, t * 0.35 + i, 0, sc, sc * 0.78, sc);
    }

    // 3. East rill cascading foam droplets
    for (let i = 0; i < rillDroplets.length; i++) {
      const rd = rillDroplets[i];
      const u = ((t * (0.85 + (i % 3) * 0.15) + i * 0.27) % 1 + 1) % 1;
      const dx = lerp(rd.x0, rd.x1, u);
      const dy = lerp(rd.y0, rd.y1, u) + Math.sin(u * Math.PI) * 0.05;
      const dz = lerp(rd.z0, rd.z1, u);
      const sc = 0.16 + 0.10 * Math.sin(u * Math.PI);
      dynBatch.writePart(dropSlots[i], dx, dy, dz, 0, 0, 0, sc, sc * 0.55, sc);
    }
    dynBatch.commit();

    // 4. Mountain Villagers (day/dawn/dusk outdoor life; night rest indoors; >105m perimeter LOD skips sub-pixel distant draws)
    const deepNight = timeId === 'night';
    const hasPlayerPos = Boolean(playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z));
    mountainRig.begin();
    for (let i = 0; i < mountainVillagers.length; i++) {
      const v = mountainVillagers[i];
      v.active = !deepNight;
      if (!v.active) continue;
      const isGreet = v.greetUntil > t;

      if (v.id === 'ow-woodcutter') {
        // Strolls calmly along the NE ridge trail with shoulder pole & twin pine bundles; pauses when greeted
        if (!isGreet) {
          const cyc = (t * 0.055) % 2;
          const u = cyc <= 1 ? cyc : 2 - cyc;
          const segF = u * (woodcutterWaypoints.length - 1);
          const si = Math.min(woodcutterWaypoints.length - 2, Math.floor(segF));
          const sf = segF - si;
          const a = woodcutterWaypoints[si];
          const b = woodcutterWaypoints[si + 1];
          v.x = lerp(a[0], b[0], sf);
          v.z = lerp(a[1], b[1], sf);
          v.y = surface(v.x, v.z);
          const dirSign = cyc <= 1 ? 1 : -1;
          v.facing = Math.atan2((b[0] - a[0]) * dirSign, (b[1] - a[1]) * dirSign);
        }
        if (hasPlayerPos && Math.hypot(playerState.x - v.x, playerState.z - v.z) > 105) continue;
        const yaw = isGreet ? Math.atan2(v.greetX - v.x, v.greetZ - v.z) : v.facing;
        const gait = isGreet ? 0 : Math.sin(t * 3.4);
        mountainRig.actor(v.x, v.y, v.z, yaw, v.s);
        mountainRig.human(v, {
          lean: isGreet ? 0.05 : 0.11,
          crouch: isGreet ? 0.02 : 0.05,
          nod: isGreet ? Math.sin(t * 2.2) * 0.06 : 0.04,
          headTurn: isGreet ? 0 : Math.sin(t * 0.6) * 0.14,
          left: [-0.20, 1.24, 0.14],
          right: isGreet ? [0.22, 1.05, 0.28] : [0.22, 1.26, 0.10],
          walk: gait
        });
        // Bamboo carrying pole across shoulder + front/back tied firewood bundles
        mountainRig.segment('taper', [0.02, 1.33, -0.78], [0.02, 1.31, 0.78], 0.032, 0.026, 0xb59b62);
        for (const bz of [-0.66, 0.66]) {
          const swing = gait * 0.025 * (bz > 0 ? 1 : -1);
          mountainRig.segment('taper', [0.02, 1.31, bz], [0.02 + swing, 0.88, bz], 0.014, 0.014, 0x796143);
          mountainRig.part('taper', [0.02 + swing, 0.80, bz], [0.18, 0.34, 0.18], 0x7d5f3e, [0, 0, Math.PI * 0.5]);
        }
      } else {
        if (hasPlayerPos && Math.hypot(playerState.x - v.x, playerState.z - v.z) > 105) continue;
        if (v.id === 'ow-lanke-elder-a' || v.id === 'ow-lanke-elder-b') {
        // Seated on top of the Lanke stone terrace & stools contemplating the Go board
        const isA = v.id === 'ow-lanke-elder-a';
        const yaw = isGreet ? Math.atan2(v.greetX - v.x, v.greetZ - v.z) : v.facing;
        const thinkCycle = Math.sin(t * 0.85 + (isA ? 0 : 2.2));
        const platY = surface(cfg.sanctuaries.lankeCrag.x, cfg.sanctuaries.lankeCrag.z) + 0.35;
        mountainRig.actor(v.x, platY, v.z, yaw, v.s);
        mountainRig.human(v, {
          lean: 0.14,
          crouch: 0.52,
          nod: isGreet ? Math.sin(t * 2.0) * 0.06 : 0.14 + thinkCycle * 0.04,
          headTurn: isGreet ? 0 : Math.sin(t * 0.45 + i) * 0.10,
          left: [-0.20, 0.76, 0.24],
          right: isA
            ? [0.10, 0.94 + Math.max(0, thinkCycle) * 0.10, 0.36 + Math.max(0, thinkCycle) * 0.12]
            : [0.08, 1.08 + thinkCycle * 0.03, 0.20], // stroking white beard
          walk: 0
        });
        } else if (v.id === 'ow-tea-picker') {
        const yaw = isGreet
          ? Math.atan2(v.greetX - v.x, v.greetZ - v.z)
          : v.facing + Math.sin(t * 0.5) * 0.20;
        const reach = isGreet ? 0 : Math.sin(t * 2.4);
        mountainRig.actor(v.x, v.y, v.z, yaw, v.s);
        mountainRig.human(v, {
          lean: isGreet ? 0.04 : 0.16,
          crouch: isGreet ? 0.02 : 0.12,
          nod: isGreet ? Math.sin(t * 2.1) * 0.05 : 0.12,
          headTurn: isGreet ? 0 : Math.sin(t * 0.7) * 0.15,
          left: [-0.22, 0.88, 0.20],
          right: isGreet ? [0.20, 0.98, 0.28] : [0.16 + reach * 0.05, 0.84 + Math.abs(reach) * 0.06, 0.34],
          walk: 0
        });
        // Waist bamboo tea creel filled with green tea leaves
        mountainRig.part('taper', [-0.25, 0.78, 0.16], [0.12, 0.17, 0.12], 0xb89c64);
        mountainRig.part('round', [-0.25, 0.87, 0.16], [0.10, 0.04, 0.10], 0x5c894b);
        } else if (v.id === 'ow-tea-host') {
        const yaw = isGreet
          ? Math.atan2(v.greetX - v.x, v.greetZ - v.z)
          : v.facing + Math.sin(t * 0.4) * 0.14;
        const fanWave = Math.sin(t * 3.2) * 0.18;
        mountainRig.actor(v.x, teaHutY + 0.21, v.z, yaw, v.s);
        const hands = mountainRig.human(v, {
          lean: 0.08,
          crouch: isGreet ? 0.03 : 0.16,
          nod: isGreet ? Math.sin(t * 2.0) * 0.06 : 0.06,
          headTurn: isGreet ? 0 : Math.sin(t * 0.65) * 0.14,
          left: [-0.22, 0.92, 0.22],
          right: [0.22, 0.88 + Math.sin(t * 3.2) * 0.04, 0.30],
          walk: 0
        });
        void hands;
        mountainRig.part('fan', [0.24, 0.88, 0.36], [0.14, 0.14, 0.14], 0xd5c396, [0.3, fanWave, 0.4]);
        } else {
        // Kiln potter & NW mountain woodman
        const yaw = isGreet
          ? Math.atan2(v.greetX - v.x, v.greetZ - v.z)
          : v.facing + Math.sin(t * 0.38 + i) * 0.16;
        mountainRig.actor(v.x, v.y, v.z, yaw, v.s);
        mountainRig.human(v, {
          lean: 0.07,
          crouch: 0.05,
          nod: isGreet ? Math.sin(t * 1.9) * 0.05 : 0.04,
          headTurn: isGreet ? 0 : Math.sin(t * 0.55 + i) * 0.18,
          left: [-0.22, 0.92, 0.24],
          right: [0.20, 0.94 + Math.sin(t * 1.6 + i) * 0.04, 0.28],
          walk: 0
        });
        if (v.id === 'ow-kiln-potter') {
          mountainRig.part('taper', [0.0, 0.88, 0.32], [0.11, 0.16, 0.11], 0xa4634a);
        } else {
          mountainRig.segment('taper', [-0.24, 0.02, 0.24], [-0.22, 1.22, 0.22], 0.026, 0.026, 0x796143);
        }
        }
      }
    }
    mountainRig.finish();

    emberMesh.visible = isNight;
    if (isNight) {
      const pulse = 0.88 + 0.12 * Math.sin(t * 5.2);
      emberMat.opacity = 0.78 * pulse;
    }
  }

  writeDynamics(0, null, null);
  hasDrawnInitial = true;

  function update(dt, elapsed = 0, sky = null, playerState = null) {
    if (disposed) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;
    if (step <= 0 && hasDrawnInitial) return;
    void elapsed;
    simTime += step;

    for (let i = 0; i < interactiveSites.length; i++) {
      if (interactiveSites[i].cooldown > 0) {
        interactiveSites[i].cooldown = Math.max(0, interactiveSites[i].cooldown - step);
      }
    }
    for (let i = 0; i < deerActors.length; i++) {
      if (deerActors[i].petTimer > 0) {
        deerActors[i].petTimer = Math.max(0, deerActors[i].petTimer - step);
      }
    }
    if (noteTimer > 0) {
      noteTimer = Math.max(0, noteTimer - step);
      if (noteTimer <= 0 && noteEl && noteEl.textContent === lastNoteText) {
        noteEl.classList?.remove?.('show');
        noteEl.setAttribute?.('aria-hidden', 'true');
      }
    }
    writeDynamics(simTime, sky, playerState);
  }

  function getStats() {
    return {
      enabled: true,
      disposed,
      simTime: +simTime.toFixed(3),
      phenology: currentPhenology,
      pines: pineRecords.length,
      maples: mapleRecords.length,
      blossoms: blossomRecords.length,
      bamboo: bambooRecords.length,
      teaShrubs: teaRecords.length,
      crags: cragRecords.length,
      tufts: tuftRecords.length,
      trails: builtTrails.length,
      sanctuaries: interactiveSites.length,
      villagers: mountainVillagers.length,
      deer: deerActors.length,
      targets: targets.length,
      blockers: blockers.length
    };
  }

  const deerObstacles = deerActors.map((d, idx) => ({
    id: 'ow-deer-' + idx,
    kind: 'deer',
    x: d.x,
    y: d.y,
    z: d.z,
    yaw: d.yaw,
    radius: 0.72,
    pet: (px, pz, dur = 3.6) => {
      d.petTimer = dur;
      d.petX = px;
      d.petZ = pz;
    }
  }));
  function getAnimalObstacles() {
    return deerObstacles;
  }

  function getInteractables() {
    activeMountainActors.length = 0;
    if (!interiorGroup.visible) return activeMountainActors;
    for (let i = 0; i < mountainVillagers.length; i++) {
      const v = mountainVillagers[i];
      if (v.active) activeMountainActors.push(v);
    }
    return activeMountainActors;
  }

  function greet(id, px, pz, duration = 4.2) {
    for (let i = 0; i < mountainVillagers.length; i++) {
      const v = mountainVillagers[i];
      if (v.id === id || v.key === id) {
        v.greetUntil = simTime + Math.max(1.5, duration || 4.2);
        v.greetX = px;
        v.greetZ = pz;
        return true;
      }
    }
    return false;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mountainRig.dispose();
    group.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material?.dispose?.();
      }
    });
    deerParts.bodyGeo.dispose();
    deerParts.headGeo.dispose();
    fxDropGeo.dispose();
    group.removeFromParent();
  }

  return {
    group,
    interiorGroup,
    exteriorGroup,
    sharedGroup,
    blockers,
    targets,
    shelters,
    restSeats,
    quietSpots: cfg.quietSpots || [],
    layout: {
      trails: builtTrails,
      woodDecks,
      walkPlatforms: [
        { x: cfg.sanctuaries.lankeCrag.x, z: cfg.sanctuaries.lankeCrag.z, r: 2.55, bevel: 0.65, y: surface(cfg.sanctuaries.lankeCrag.x, cfg.sanctuaries.lankeCrag.z) + 0.35, material: 'stone' },
        { x: kiln.x, z: kiln.z, r: 4.35, bevel: 0.45, y: kilnY + 0.17, material: 'dirt' },
        { x: teaHut.x, z: teaHut.z, r: 3.65, bevel: 0.60, y: teaHutY + 0.21, material: 'stone' }
      ],
      sanctuaries: cfg.sanctuaries,
      teaShelter: cfg.sanctuaries.mountainTeaHut,
      lankeCrag: cfg.sanctuaries.lankeCrag,
      ancientKiln: cfg.sanctuaries.climbingKiln,
      woodcutterHut: cfg.sanctuaries.woodcutterHut,
      rill: { width: cfg.rill.width, points: rillPts },
      pineSpots: pineRecords.map(p => [p.x, p.z]),
      mapleSpots: mapleRecords.map(p => [p.x, p.z]),
      bambooSpots: bambooRecords.map(p => [p.x, p.z]),
      cragSpots: cragRecords.map(p => [p.x, p.z]),
      pines: pineRecords.length,
      maples: mapleRecords.length,
      teaShrubs: teaRecords.length
    },
    isOnWood,
    getAnimalObstacles,
    getInteractables,
    greet,
    setPhenology,
    interactById(id, sound, doc) {
      const s = interactiveSites.find(item => item.id === id);
      return triggerSite(s, sound, doc);
    },
    bind,
    update,
    getStats,
    dispose
  };
}
