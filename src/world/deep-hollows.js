import * as THREE from 'three';
import hollowsCfg from '../data/deep-hollows.json' with { type: 'json' };
import { createCommunityActors } from '../systems/community-actors.js';
import { habitatSurface, createHabitatContext } from './habitat-details.js';
import { createRigidBatchMesh } from './qin-han-fauna-geometry.js';
import {
  createVertexColorBaker as createRawBaker,
  buildTeaOrHerbShrubGeometry,
  buildStratifiedCragGeometry,
  buildMeadowTuftGeometry,
  buildWaterFxGeometry
} from './valley-borderlands-geometry.js';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function makeRng(seed, tag = '') {
  let s = (seed >>> 0) || 20261121;
  for (let i = 0; i < tag.length; i++) {
    s = Math.imul(s ^ tag.charCodeAt(i), 16777619) >>> 0;
  }
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
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

function addScallopedCloud(baker, key, cx, cy, cz, rx, ry, rz, sides, cTop, cMid, cBot, phase = 0) {
  const eq = [];
  const hi = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * TAU;
    const lobe = i % 2 === 0 ? 1.06 : 0.84;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
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

function addHippedRoof(baker, key, toLocal, hw, hd, eaveY, ridgeY, ridgeHalfX, cLight, cMid, cDark) {
  const mY = lerp(eaveY, ridgeY, 0.46);
  const mW = lerp(hw, Math.max(0.18, ridgeHalfX), 0.52);
  const mD = hd * 0.50;
  const ePts = [toLocal(-hw, eaveY, hd), toLocal(hw, eaveY, hd), toLocal(hw, eaveY, -hd), toLocal(-hw, eaveY, -hd)];
  const eDn = [toLocal(-hw, eaveY - 0.11, hd), toLocal(hw, eaveY - 0.11, hd), toLocal(hw, eaveY - 0.11, -hd), toLocal(-hw, eaveY - 0.11, -hd)];
  const mPts = [toLocal(-mW, mY, mD), toLocal(mW, mY, mD), toLocal(mW, mY, -mD), toLocal(-mW, mY, -mD)];
  const rL = toLocal(-ridgeHalfX, ridgeY, 0);
  const rR = toLocal(ridgeHalfX, ridgeY, 0);
  for (let k = 0; k < 4; k++) {
    const nk = (k + 1) % 4;
    baker.addQuad(key, ePts[k], ePts[nk], mPts[nk], mPts[k], k % 2 === 0 ? cLight : cMid, 0.02);
    baker.addQuad(key, ePts[k], eDn[k], eDn[nk], ePts[nk], cDark, -0.04);
  }
  baker.addQuad(key, mPts[0], mPts[1], rR, rL, cMid, 0.01);
  baker.addQuad(key, mPts[2], mPts[3], rL, rR, cMid, 0.01);
  baker.addTri(key, mPts[1][0], mPts[1][1], mPts[1][2], mPts[2][0], mPts[2][1], mPts[2][2], rR[0], rR[1], rR[2], cLight, 0.02);
  baker.addTri(key, mPts[3][0], mPts[3][1], mPts[3][2], mPts[0][0], mPts[0][1], mPts[0][2], rL[0], rL[1], rL[2], cLight, 0.02);
  baker.addBeam(key, toLocal(-ridgeHalfX - 0.16, ridgeY + 0.04, 0), toLocal(ridgeHalfX + 0.16, ridgeY + 0.04, 0), 0.09, 0.09, 6, cLight, cDark, true);
}

function buildBannerRibbonGeometry(hex = '#9E4639') {
  const b = createVertexColorBaker();
  b.addQuad('unit', [-0.11, 0, 0], [0.11, 0, 0], [0.09, -0.58, 0.04], [-0.09, -0.58, 0.04], hex, 0.02);
  b.addQuad('unit', [0.11, 0, 0], [-0.11, 0, 0], [-0.09, -0.58, 0.04], [0.09, -0.58, 0.04], '#7E352B', -0.02);
  b.addTri('unit', -0.09, -0.58, 0.04, 0.09, -0.58, 0.04, 0, -0.86, 0.07, '#B85A4A', 0.03);
  b.addTri('unit', 0.09, -0.58, 0.04, -0.09, -0.58, 0.04, 0, -0.86, 0.07, '#7E352B', -0.02);
  return b.buildGeometry('unit');
}

const LANTERN_HALO_VERT = /* glsl */`
varying vec2 vLocal;
varying vec3 vColor;

void main() {
  vLocal = position.xy;
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0, 0.77, 0.45);
  #endif
  #ifdef USE_INSTANCING
    vec3 worldCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float radius = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  #else
    vec3 worldCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float radius = 1.0;
  #endif
  vec4 mvCenter = viewMatrix * vec4(worldCenter, 1.0);
  mvCenter.z += min(0.16, radius * 0.20);
  mvCenter.xy += position.xy * radius;
  gl_Position = projectionMatrix * mvCenter;
}
`;

const LANTERN_HALO_FRAG = /* glsl */`
uniform float uOpacity;
varying vec2 vLocal;
varying vec3 vColor;

void main() {
  float r2 = dot(vLocal, vLocal);
  if (r2 >= 1.0) discard;
  float core = exp(-7.2 * r2) * 0.58;
  float aura = exp(-2.8 * r2) * pow(1.0 - r2, 2.4) * 0.54;
  float falloff = core + aura;
  float intensity = falloff * uOpacity;
  if (intensity < 0.002) discard;
  gl_FragColor = vec4(vColor * intensity, 1.0);
}
`;

function buildLanternHaloGeometry() {
  return new THREE.PlaneGeometry(2, 2);
}

export function createDeepHollows(options = {}) {
  const cfg = options.config || hollowsCfg;
  const pal = cfg.palette;
  const { world, field, distanceToRiver, cliff } = options;

  const group = new THREE.Group();
  group.name = 'deep-hollows';

  const surface = (x, z) => (field ? habitatSurface(field, x, z) : 0);
  const rawGround = (x, z) => (field?.sample ? field.sample(x, z) : 0);
  const slopeAt = (x, z) => (field?.slope ? field.slope(x, z) : 0);
  const waterLevel = world?.terrain?.waterLevel ?? -1;
  const halfBound = (field?.half || 400) - 10;

  const hab = createHabitatContext(options);
  const resCircles = hab.reservations.circles.map(c => ({ ...c }));
  const resCorridors = hab.reservations.corridors.map(c => ({ ...c }));

  const blockers = [];
  const targets = [];
  const woodDecks = [];
  const walkPlatforms = [];
  const interactiveSites = [];
  const shelters = [];
  const restSeats = [];
  const builtTrails = [];
  const poolRecords = [];
  const emberSpecs = [];
  const haloSpecs = [];
  const bannerSpecs = [];
  const dropSpecs = [];
  const smokeSpecs = [];

  const baker = createVertexColorBaker();
  const waterBaker = createVertexColorBaker();

  // ============================================================================
  // 1. 远坞六条山径 (6 trails joining outerWilds/hinterland/borderlands)
  // ============================================================================
  const rngTrail = makeRng(cfg.seed, 'dh-trails');
  baker.withTag('dh-trail', () => {
    for (const tr of cfg.trails || []) {
      const pts = smoothPolyline(tr.points, 5);
      builtTrails.push({ id: tr.id, kind: tr.kind || 'earth', width: tr.width, points: pts });
      resCorridors.push({ points: pts, half: tr.width * 0.5 + 0.65 });
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
        const w0 = hw * (0.92 + 0.14 * Math.sin(i * 0.9));
        const w1 = hw * (0.92 + 0.14 * Math.sin((i + 1) * 0.9));
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
          const mx = (a[0] + b[0]) * 0.5 + (rngTrail() - 0.5) * 0.16;
          const mz = (a[1] + b[1]) * 0.5 + (rngTrail() - 0.5) * 0.16;
          const my = surface(mx, mz) + 0.055;
          baker.addBox('static', mx, my, mz, w0 * 1.12, 0.05, Math.min(0.62, len * 0.7), Math.atan2(dx, dz), pal.stoneLight, pal.stoneDark);
        }
      }
    }
  });

  // ============================================================================
  // 2. 西南古社避秦坛 (Ancient Qin Altar & Sacred Camphor, -124, -116)
  // ============================================================================
  const altar = cfg.sanctuaries.ancientAltar;
  const altarY = surface(altar.x, altar.z);
  {
    resCircles.push({ x: altar.x, z: altar.z, r: 9.5 });
    const yaw = altar.rot || 0.36;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const toA = (lx, ly, lz) => [altar.x + lx * cy + lz * sy, altarY + ly, altar.z - lx * sy + lz * cy];

    // Two-tier mossy stone altar terrace grounded deep into hillside
    baker.withTag('frost-cap', () => {
      baker.addBox('static', altar.x, altarY - 0.12, altar.z, 6.2, 0.72, 6.2, yaw, pal.flagstone, pal.stoneDark);
      baker.addBox('static', altar.x, altarY + 0.34, altar.z, 4.1, 0.30, 4.1, yaw, pal.stoneLight, pal.stone);
    });
    walkPlatforms.push({ x: altar.x, z: altar.z, r: 3.1, bevel: 0.75, y: altarY + 0.49, material: 'stone' });

    // East-facing entry stairs connecting toward sw-orchard-altar-trail
    for (let s = 0; s < 3; s++) {
      const sp = toA(2.45 + s * 0.56, 0.38 - s * 0.13, 0);
      baker.addBox('static', sp[0], sp[1] - 0.14, sp[2], 0.62, 0.28, 1.8, yaw, pal.flagstone, pal.stoneDark);
    }

    // Sacred altar stone stele pillar & offering table at center-west
    const steleP = toA(-1.05, 0.49, 0);
    baker.withTag('frost-cap', () => {
      baker.addBox('static', steleP[0], steleP[1] + 0.20, steleP[2], 0.88, 0.40, 1.12, yaw, pal.stone, pal.stoneDark);
      baker.addBox('static', steleP[0], steleP[1] + 0.88, steleP[2], 0.32, 1.10, 0.64, yaw, pal.stoneLight, pal.stone);
      baker.addBox('static', steleP[0], steleP[1] + 1.48, steleP[2], 0.48, 0.18, 0.80, yaw, pal.stoneDark, pal.mossDeep);
    });
    blockers.push({ x: steleP[0], z: steleP[2], hw: 0.52, hd: 0.64, rot: yaw, minY: steleP[1], maxY: steleP[1] + 1.6, source: 'dh-altar-stele' });

    // Bronze-clay incense burner & offering vessel
    const censerP = toA(-0.22, 0.49, 0);
    baker.addBox('static', censerP[0], censerP[1] + 0.22, censerP[2], 0.46, 0.44, 0.56, yaw, pal.timber, pal.timberDark);
    baker.addCylinder('static', censerP[0], censerP[1] + 0.52, censerP[2], 0.16, 0.12, 0.18, 7, yaw, pal.bronze, pal.stoneDark);
    smokeSpecs.push({ x: censerP[0], y: censerP[1] + 0.64, z: censerP[2], drift: 1.5, scale: 0.15 });

    // Basket of millet ears & fruit offering tray
    const basketP = toA(-0.28, 0.49, 0.72);
    baker.addCylinder('static', basketP[0], basketP[1] + 0.15, basketP[2], 0.22, 0.17, 0.30, 7, 0, pal.thatchLight, pal.timber);
    baker.addCone('static', basketP[0], basketP[1] + 0.34, basketP[2], 0.18, 0.18, 6, 0, '#D4B35B', pal.thatch);

    // Two carved stone lanterns flanking the altar front (open corner mullions around warm paper chamber)
    for (const lz of [-1.72, 1.72]) {
      const lp = toA(1.25, 0.49, lz);
      baker.addCylinder('static', lp[0], lp[1] + 0.32, lp[2], 0.14, 0.20, 0.64, 6, 0, pal.stone, pal.stoneDark);
      baker.addBox('static', lp[0], lp[1] + 0.62, lp[2], 0.30, 0.06, 0.30, yaw, pal.stoneLight, pal.stoneDark);
      baker.addBox('static', lp[0], lp[1] + 0.74, lp[2], 0.18, 0.20, 0.18, yaw, pal.lanternPaper || '#EFE0BC', '#D4C39A');
      for (const [px, pz] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]]) {
        const cp = toA(1.25 + px, 0.49 + 0.74, lz + pz);
        baker.addBox('static', cp[0], cp[1], cp[2], 0.045, 0.20, 0.045, yaw, pal.stone, pal.stoneDark);
      }
      baker.withTag('frost-cap', () => {
        baker.addCone('static', lp[0], lp[1] + 0.96, lp[2], 0.32, 0.26, 6, yaw, pal.stoneLight, pal.mossDeep);
      });
      blockers.push({ x: lp[0], z: lp[2], hw: 0.28, hd: 0.28, rot: yaw, minY: lp[1], maxY: lp[1] + 1.1, source: 'dh-altar-lantern' });
      emberSpecs.push({ x: lp[0], y: lp[1] + 0.74, z: lp[2], sx: 0.44, sy: 0.46, sz: 0.44 });
      haloSpecs.push({ x: lp[0], y: lp[1] + 0.74, z: lp[2], radius: 0.90, color: pal.lanternHalo || '#FFC472', phase: lz > 0 ? 0.6 : 2.2, kind: 'stone' });
    }

    // Twin bamboo prayer poles with 4 animated vermilion ribbons
    for (const lz of [-2.35, 2.35]) {
      const fp = toA(-1.85, 0.24, lz);
      const top = [fp[0], fp[1] + 2.55, fp[2]];
      baker.addBeam('static', fp, top, 0.055, 0.038, 5, pal.bambooCulm, pal.timberDark, true);
      baker.addBeam('static', [top[0] - 0.04, top[1] - 0.14, top[2]], [top[0] + 0.68, top[1] - 0.18, top[2]], 0.025, 0.018, 4, pal.bambooCulm, pal.bambooLeaf, true);
      bannerSpecs.push({ x: top[0] + 0.26, y: top[1] - 0.17, z: top[2], yaw, phase: lz > 0 ? 0.4 : 2.1 });
      bannerSpecs.push({ x: top[0] + 0.56, y: top[1] - 0.18, z: top[2], yaw, phase: lz > 0 ? 1.5 : 3.2 });
    }

    // Ancient Sacred Camphor Tree behind the altar (foliage-camphor tag turns gold in autumn & frosts in winter)
    const treeP = toA(-3.75, 0.0, 0);
    const treeY = surface(treeP[0], treeP[2]);
    const trkBase = [treeP[0], treeY - 0.25, treeP[2]];
    const trkMid = [treeP[0] + sy * 0.15, treeY + 2.1, treeP[2] - cy * 0.15];
    const trkTop = [treeP[0] + 0.18, treeY + 3.9, treeP[2] - 0.12];
    baker.addBeam('static', trkBase, trkMid, 0.46, 0.34, 7, pal.bark, pal.timberDark, false);
    baker.addBeam('static', trkMid, trkTop, 0.33, 0.20, 6, pal.bark, pal.timber, false);
    for (const [rx, rz] of [[-0.78, -0.55], [0.68, -0.68], [-0.45, 0.82], [0.72, 0.62]]) {
      baker.addBeam('static', [treeP[0], treeY + 0.55, treeP[2]], [treeP[0] + rx, treeY - 0.18, treeP[2] + rz], 0.22, 0.09, 5, pal.bark, pal.mossDeep, false);
    }
    const boughs = [
      [trkMid, [treeP[0] + 1.8, treeY + 4.3, treeP[2] + 0.6]],
      [trkMid, [treeP[0] - 1.7, treeY + 4.0, treeP[2] - 1.2]],
      [trkTop, [treeP[0] + 0.4, treeY + 5.2, treeP[2] - 1.6]],
      [trkTop, [treeP[0] - 0.9, treeY + 5.0, treeP[2] + 1.5]]
    ];
    for (const [b0, b1] of boughs) {
      baker.addBeam('static', b0, b1, 0.18, 0.08, 5, pal.bark, pal.timber, false);
    }
    baker.withTag('foliage-camphor', () => {
      addScallopedCloud(baker, 'static', treeP[0], treeY + 5.6, treeP[2], 2.55, 1.18, 2.40, 8, pal.camphorLight, pal.camphorMid, pal.camphorDeep, 0.3);
      addScallopedCloud(baker, 'static', treeP[0] + 1.85, treeY + 4.5, treeP[2] + 0.65, 1.85, 0.92, 1.75, 7, pal.camphorLight, pal.camphorMid, pal.camphorDeep, 1.4);
      addScallopedCloud(baker, 'static', treeP[0] - 1.75, treeY + 4.2, treeP[2] - 1.25, 1.78, 0.88, 1.68, 7, pal.camphorLight, pal.camphorMid, pal.camphorDeep, 2.6);
      addScallopedCloud(baker, 'static', treeP[0] + 0.35, treeY + 5.3, treeP[2] - 1.65, 1.65, 0.85, 1.58, 6, pal.camphorLight, pal.camphorMid, pal.camphorDeep, 3.8);
      addScallopedCloud(baker, 'static', treeP[0] - 0.95, treeY + 5.1, treeP[2] + 1.55, 1.68, 0.86, 1.62, 6, pal.camphorLight, pal.camphorMid, pal.camphorDeep, 5.0);
    });
    blockers.push({ x: treeP[0], z: treeP[2], hw: 0.62, hd: 0.62, rot: 0, minY: treeY, maxY: treeY + 4.2, source: 'dh-altar-camphor' });

    // Wooden resting bench under the camphor shade
    const benchP = toA(0.55, 0.49, -1.78);
    baker.addBox('static', benchP[0], benchP[1] + 0.38, benchP[2], 1.28, 0.08, 0.40, yaw, pal.timber, pal.timberDark);
    for (const bx of [-0.46, 0.46]) {
      const lp = toA(0.55 + bx, 0.49 + 0.18, -1.78);
      baker.addBox('static', lp[0], lp[1], lp[2], 0.10, 0.36, 0.32, yaw, pal.timberDark, pal.bark);
    }
    restSeats.push({
      id: 'dh-altar-bench',
      name: '古社荫下木凳',
      prompt: '落座听风 · 古社木凳',
      x: benchP[0],
      y: benchP[1] + 0.42,
      z: benchP[2],
      lookX: altar.x,
      lookZ: altar.z,
      exitAngle: yaw
    });

    targets.push({ id: altar.id, x: censerP[0], y: censerP[1] + 0.76, z: censerP[2], range: 9.5 });
    interactiveSites.push({
      id: altar.id,
      name: altar.name,
      action: altar.action,
      lines: altar.lines,
      soundKind: 'bell',
      x: censerP[0],
      y: censerP[1],
      z: censerP[2],
      height: 0.72,
      lineIdx: 0,
      cooldown: 0
    });
  }

  // ============================================================================
  // 3. 北涧冷泉幽轩 (Cold-Spring Timber Study & Bamboo Aqueduct, 60, -296)
  // ============================================================================
  const study = cfg.sanctuaries.secludedStudy;
  const studyY = surface(study.x, study.z);
  let studyDeskWorld = [study.x, studyY + 0.9, study.z];
  let coldSpringAnchor = [study.x - 4.7, study.z + 0.2];
  {
    resCircles.push({ x: study.x, z: study.z, r: 9.5 });
    const yaw = study.rot || -0.24;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const toS = (lx, ly, lz) => [study.x + lx * cy + lz * sy, studyY + ly, study.z - lx * sy + lz * cy];

    // Raised timber deck on stone corner piers
    const deckW = 4.8;
    const deckD = 4.0;
    const deckTop = 0.44;
    baker.addBox('static', study.x, studyY + deckTop - 0.08, study.z, deckW, 0.16, deckD, yaw, pal.timber, pal.timberDark);
    for (const [px, pz] of [[-2.15, -1.75], [2.15, -1.75], [-2.15, 1.75], [2.15, 1.75], [0, -1.75], [0, 1.75]]) {
      const pp = toS(px, 0, pz);
      baker.addCylinder('static', pp[0], studyY + 0.14, pp[2], 0.18, 0.24, 0.62, 6, yaw, pal.stone, pal.stoneDark);
    }
    woodDecks.push({
      x: study.x,
      z: study.z,
      tx: cy,
      tz: -sy,
      ux: sy,
      uz: cy,
      length: deckW + 0.3,
      width: deckD + 0.3,
      endY0: studyY + deckTop,
      endY1: studyY + deckTop,
      arch: 0,
      bevelL: 0.52,
      bevelW: 0.52,
      material: 'wood'
    });

    // South-facing entrance steps toward north-cascade-study-trail
    for (let s = 0; s < 2; s++) {
      const stP = toS(0, 0.30 - s * 0.16, 2.22 + s * 0.45);
      baker.addBox('static', stP[0], stP[1] - 0.08, stP[2], 1.65, 0.18, 0.48, yaw, pal.flagstone, pal.stoneDark);
    }

    // 4 Corner columns + beams + hipped tile roof
    const cols = [[-1.95, -1.55], [1.95, -1.55], [-1.95, 1.55], [1.95, 1.55]];
    const colTops = [];
    for (const [px, pz] of cols) {
      const wp = toS(px, 0, pz);
      baker.addBeam('static', [wp[0], studyY + deckTop, wp[2]], [wp[0], studyY + 2.68, wp[2]], 0.09, 0.08, 6, pal.timber, pal.timberDark, true);
      colTops.push([wp[0], studyY + 2.66, wp[2]]);
    }
    baker.addBeam('static', colTops[0], colTops[1], 0.068, 0.068, 5, pal.timber, pal.timberDark, true);
    baker.addBeam('static', colTops[2], colTops[3], 0.068, 0.068, 5, pal.timber, pal.timberDark, true);
    baker.addBeam('static', colTops[0], colTops[2], 0.068, 0.068, 5, pal.timber, pal.timberDark, true);
    baker.addBeam('static', colTops[1], colTops[3], 0.068, 0.068, 5, pal.timber, pal.timberDark, true);

    // Low wooden balustrade on W / N / E sides (South side open for entry)
    baker.addBeam('static', toS(-1.95, deckTop + 0.56, -1.55), toS(1.95, deckTop + 0.56, -1.55), 0.04, 0.04, 4, pal.timberDark, pal.timber, true);
    baker.addBeam('static', toS(-1.95, deckTop + 0.56, -1.55), toS(-1.95, deckTop + 0.56, 1.55), 0.04, 0.04, 4, pal.timberDark, pal.timber, true);
    baker.addBeam('static', toS(1.95, deckTop + 0.56, -1.55), toS(1.95, deckTop + 0.56, 1.55), 0.04, 0.04, 4, pal.timberDark, pal.timber, true);

    baker.withTag('frost-roof', () => {
      addHippedRoof(baker, 'static', toS, 2.55, 2.15, 2.66, 3.82, 0.85, pal.tile, pal.tileDark, '#3F4849');
    });

    // Bamboo-slip bookcase along the back wall + low lacquer study desk + bronze lamp + cushions
    const shelfP = toS(-0.95, deckTop, -1.18);
    baker.addBox('static', shelfP[0], shelfP[1] + 0.72, shelfP[2], 1.18, 1.44, 0.34, yaw, pal.timberDark, pal.bark);
    for (let row = 0; row < 3; row++) {
      const rp = toS(-0.95, deckTop + 0.32 + row * 0.38, -1.12);
      baker.addBox('static', rp[0], rp[1], rp[2], 0.96, 0.14, 0.24, yaw, pal.bambooCulm, pal.thatch);
    }
    blockers.push({ x: shelfP[0], z: shelfP[2], hw: 0.65, hd: 0.26, rot: yaw, minY: shelfP[1], maxY: shelfP[1] + 1.5, source: 'dh-study-shelf' });

    const deskP = toS(0.22, deckTop, -0.10);
    studyDeskWorld = [deskP[0], deskP[1] + 0.42, deskP[2]];
    baker.addBox('static', deskP[0], deskP[1] + 0.32, deskP[2], 1.24, 0.07, 0.68, yaw, pal.lacquerRed, pal.timberDark);
    for (const [lx, lz] of [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]]) {
      const lp = toS(0.22 + lx, deckTop + 0.16, -0.10 + lz);
      baker.addBox('static', lp[0], lp[1], lp[2], 0.07, 0.32, 0.07, yaw, pal.timberDark, pal.bark);
    }
    // Unrolled bamboo scroll + bronze lamp on desk
    const scrollP = toS(0.12, deckTop + 0.38, -0.10);
    baker.addBox('static', scrollP[0], scrollP[1], scrollP[2], 0.48, 0.03, 0.28, yaw + 0.08, pal.plaster, pal.thatch);
    const lampP = toS(0.62, deckTop + 0.36, -0.24);
    baker.addCylinder('static', lampP[0], lampP[1] + 0.11, lampP[2], 0.05, 0.09, 0.22, 6, 0, pal.bronze, pal.stoneDark);
    emberSpecs.push({ x: lampP[0], y: lampP[1] + 0.24, z: lampP[2], sx: 0.22, sy: 0.30, sz: 0.22 });
    haloSpecs.push({ x: lampP[0], y: lampP[1] + 0.24, z: lampP[2], radius: 0.62, color: '#FFD28A', phase: 1.4, kind: 'lamp' });
    // Hanging bamboo-frame paper lantern under front south eave beam
    const studyCordTop = toS(1.08, 2.66, 1.54);
    const studyCordBot = toS(1.08, 2.38, 1.54);
    const studyLanTop = toS(1.08, 2.37, 1.54);
    const studyLanP = toS(1.08, 2.24, 1.54);
    const studyLanBot = toS(1.08, 2.10, 1.54);
    baker.addBeam('static', studyCordTop, studyCordBot, 0.018, 0.018, 4, pal.timberDark, pal.bark, true);
    baker.addCylinder('static', studyLanTop[0], studyLanTop[1], studyLanTop[2], 0.08, 0.12, 0.04, 6, yaw, pal.timberDark, pal.bark);
    baker.addCylinder('static', studyLanP[0], studyLanP[1], studyLanP[2], 0.125, 0.125, 0.26, 6, yaw, pal.lanternPaper || '#EFE0BC', '#D6C39A');
    baker.addCylinder('static', studyLanBot[0], studyLanBot[1], studyLanBot[2], 0.11, 0.08, 0.04, 6, yaw, pal.timberDark, pal.bark);
    emberSpecs.push({ x: studyLanP[0], y: studyLanP[1], z: studyLanP[2], sx: 0.56, sy: 0.56, sz: 0.56 });
    haloSpecs.push({ x: studyLanP[0], y: studyLanP[1], z: studyLanP[2], radius: 0.86, color: pal.lanternHalo || '#FFC472', phase: 3.0, kind: 'hanging' });
    blockers.push({ x: deskP[0], z: deskP[2], hw: 0.68, hd: 0.40, rot: yaw, minY: deskP[1], maxY: deskP[1] + 0.45, source: 'dh-study-desk' });

    const matP = toS(0.22, deckTop + 0.04, 0.56);
    baker.addCylinder('static', matP[0], matP[1], matP[2], 0.40, 0.44, 0.08, 8, 0, pal.thatchLight, pal.thatch);
    restSeats.push({
      id: 'dh-study-mat',
      name: '冷泉幽轩席案',
      prompt: '落座展简 · 冷泉幽轩',
      x: matP[0],
      y: matP[1] + 0.05,
      z: matP[2],
      lookX: deskP[0],
      lookZ: deskP[2],
      exitAngle: yaw
    });

    // Cold spring stone basin & bamboo aqueduct just west of the study
    const poolX = study.x - 4.35;
    const poolZ = study.z + 0.35;
    const poolY = surface(poolX, poolZ);
    baker.withTag('frost-cap', () => {
      baker.addBox('static', poolX, poolY + 0.05, poolZ - 1.15, 2.6, 0.38, 0.28, yaw, pal.stone, pal.stoneDark);
      baker.addBox('static', poolX, poolY + 0.05, poolZ + 1.15, 2.6, 0.38, 0.28, yaw, pal.stone, pal.stoneDark);
      baker.addBox('static', poolX - 1.18, poolY + 0.05, poolZ, 0.28, 0.38, 2.2, yaw, pal.stone, pal.stoneDark);
      baker.addBox('static', poolX + 1.18, poolY + 0.05, poolZ, 0.28, 0.38, 2.2, yaw, pal.stone, pal.stoneDark);
    });
    waterBaker.addQuad(
      'water',
      [poolX - 1.04, poolY + 0.16, poolZ - 1.00],
      [poolX + 1.04, poolY + 0.16, poolZ - 1.00],
      [poolX + 1.04, poolY + 0.16, poolZ + 1.00],
      [poolX - 1.04, poolY + 0.16, poolZ + 1.00],
      pal.water,
      0.02
    );
    poolRecords.push({ x: poolX, z: poolZ, rx: 1.2, rz: 1.1 });
    // Bamboo aqueduct pipe feeding the spring pool
    const pipeTop = [poolX - 1.65, poolY + 1.45, poolZ - 0.85];
    const pipeTip = [poolX - 0.35, poolY + 0.88, poolZ - 0.15];
    coldSpringAnchor = [pipeTip[0], pipeTip[2]];
    baker.addBeam('static', [pipeTop[0] + 0.3, poolY - 0.1, pipeTop[2]], [pipeTop[0] + 0.3, poolY + 1.38, pipeTop[2]], 0.055, 0.045, 4, pal.timber, pal.timberDark, true);
    baker.addBeam('static', pipeTop, pipeTip, 0.08, 0.072, 6, pal.bambooCulm, pal.bambooLeaf, true);
    for (let k = 0; k < 3; k++) {
      dropSpecs.push({ x0: pipeTip[0], y0: pipeTip[1] - 0.02, z0: pipeTip[2], x1: pipeTip[0] + 0.06, y1: poolY + 0.16, z1: pipeTip[2] + 0.04, phase: k / 3 });
    }

    shelters.push({ id: study.id, name: study.name, x: study.x, y: studyY + deckTop, z: study.z, r: 2.65 });
    targets.push({ id: study.id, x: deskP[0], y: deskP[1] + 0.65, z: deskP[2], range: 9.5 });
    interactiveSites.push({
      id: study.id,
      name: study.name,
      action: study.action,
      lines: study.lines,
      soundKind: 'water',
      x: deskP[0],
      y: deskP[1],
      z: deskP[2],
      height: 0.72,
      lineIdx: 0,
      cooldown: 0
    });
  }

  // ============================================================================
  // 4. 东南碧涧茶坞 (Jade Rill Tea Terrace & Roasting Shed, 186, -114)
  // ============================================================================
  const tea = cfg.sanctuaries.jadeTeaTerrace;
  const teaY = surface(tea.x, tea.z);
  let teaStoveAnchor = [tea.x - 0.3, tea.z - 0.4];
  let jadeRillAnchor = [tea.x - 4.4, tea.z - 4.8];
  {
    resCircles.push({ x: tea.x, z: tea.z, r: 10.5 });
    const yaw = tea.rot || -0.54;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const toT = (lx, ly, lz) => [tea.x + lx * cy + lz * sy, teaY + ly, tea.z - lx * sy + lz * cy];

    // Rammed-earth & flagstone terrace skirt sunk deep into hillside slope (no floating edge)
    baker.withTag('frost-cap', () => {
      baker.addCylinder('static', tea.x, teaY - 0.34, tea.z, 3.85, 4.45, 1.12, 10, yaw, pal.flagstone, pal.stoneDark);
    });
    walkPlatforms.push({ x: tea.x, z: tea.z, r: 3.75, bevel: 0.65, y: teaY + 0.22, material: 'stone' });

    // West entry steps connecting toward se-rill-tea-trail
    for (let s = 0; s < 3; s++) {
      const sp = toT(-3.45 - s * 0.48, 0.14 - s * 0.12, 0.25);
      baker.addBox('static', sp[0], sp[1] - 0.12, sp[2], 0.56, 0.26, 1.25, yaw, pal.flagstone, pal.stoneDark);
    }

    // 4-column thatched tea-roasting shed
    const cols = [[-1.50, -1.40], [1.50, -1.40], [-1.50, 1.40], [1.50, 1.40]];
    const colTops = [];
    for (const [px, pz] of cols) {
      const wp = toT(px, 0, pz);
      const gy = Math.min(teaY, surface(wp[0], wp[2]));
      baker.addCylinder('static', wp[0], teaY + 0.26, wp[2], 0.14, 0.18, 0.20, 6, yaw, pal.stoneLight, pal.stoneDark);
      baker.addBeam('static', [wp[0], gy - 0.18, wp[2]], [wp[0], teaY + 2.22, wp[2]], 0.082, 0.072, 6, pal.timber, pal.timberDark, true);
      colTops.push([wp[0], teaY + 2.20, wp[2]]);
      blockers.push({ x: wp[0], z: wp[2], hw: 0.18, hd: 0.18, rot: yaw, minY: teaY, maxY: teaY + 2.2, source: 'dh-tea-col' });
    }
    baker.addBeam('static', colTops[0], colTops[1], 0.056, 0.056, 5, pal.timber, pal.timberDark, true);
    baker.addBeam('static', colTops[2], colTops[3], 0.056, 0.056, 5, pal.timber, pal.timberDark, true);
    baker.addBeam('static', colTops[0], colTops[2], 0.056, 0.056, 5, pal.timber, pal.timberDark, true);
    baker.addBeam('static', colTops[1], colTops[3], 0.056, 0.056, 5, pal.timber, pal.timberDark, true);
    baker.withTag('frost-roof', () => {
      addHippedRoof(baker, 'static', toT, 2.02, 1.92, 2.20, 3.24, 0.62, pal.thatchLight, pal.thatch, '#8C764D');
    });

    // Clay tea-roasting stove & iron wok (visible front firebox opening facing south)
    const stoveP = toT(-0.45, 0.22, -0.35);
    const stoveVentP = toT(-0.45, 0.22 + 0.22, -0.35 + 0.44);
    teaStoveAnchor = [stoveP[0], stoveP[2]];
    baker.addCylinder('static', stoveP[0], stoveP[1] + 0.28, stoveP[2], 0.44, 0.50, 0.56, 8, yaw, pal.rammedEarth, pal.timberDark);
    baker.addHollowCylinder('static', stoveP[0], stoveP[1] + 0.58, stoveP[2], 0.40, 0.26, 0.12, 8, yaw, pal.tileDark, '#303435');
    emberSpecs.push({ x: stoveVentP[0], y: stoveVentP[1], z: stoveVentP[2], sx: 0.42, sy: 0.32, sz: 0.26 });
    haloSpecs.push({ x: stoveVentP[0], y: stoveVentP[1], z: stoveVentP[2], radius: 0.68, color: pal.emberGlow, phase: 2.9, kind: 'stove' });
    // Hanging thatched-eave wind lantern under front south beam
    const teaCordTop = toT(-0.88, 2.20, 1.38);
    const teaCordBot = toT(-0.88, 1.94, 1.38);
    const teaLanTop = toT(-0.88, 1.93, 1.38);
    const teaLanP = toT(-0.88, 1.80, 1.38);
    const teaLanBot = toT(-0.88, 1.67, 1.38);
    baker.addBeam('static', teaCordTop, teaCordBot, 0.016, 0.016, 4, pal.timberDark, pal.bark, true);
    baker.addCylinder('static', teaLanTop[0], teaLanTop[1], teaLanTop[2], 0.075, 0.11, 0.04, 6, yaw, pal.timberDark, pal.bark);
    baker.addCylinder('static', teaLanP[0], teaLanP[1], teaLanP[2], 0.115, 0.115, 0.24, 6, yaw, pal.lanternPaper || '#EFE0BC', '#D6C39A');
    baker.addCylinder('static', teaLanBot[0], teaLanBot[1], teaLanBot[2], 0.10, 0.075, 0.04, 6, yaw, pal.timberDark, pal.bark);
    emberSpecs.push({ x: teaLanP[0], y: teaLanP[1], z: teaLanP[2], sx: 0.52, sy: 0.52, sz: 0.52 });
    haloSpecs.push({ x: teaLanP[0], y: teaLanP[1], z: teaLanP[2], radius: 0.84, color: pal.lanternHalo || '#FFC472', phase: 4.1, kind: 'hanging' });
    smokeSpecs.push({ x: stoveP[0], y: stoveP[1] + 0.68, z: stoveP[2], drift: 1.9, scale: 0.18 });
    blockers.push({ x: stoveP[0], z: stoveP[2], hw: 0.52, hd: 0.52, rot: yaw, minY: stoveP[1], maxY: stoveP[1] + 0.7, source: 'dh-tea-stove' });

    // Bamboo drying rack with 3 round tea trays
    const rackP = toT(0.68, 0.22, 0.24);
    baker.addBox('static', rackP[0], rackP[1] + 0.36, rackP[2], 0.92, 0.72, 1.48, yaw, pal.timberDark, pal.bark);
    for (const tz of [-0.46, 0.0, 0.46]) {
      const tp = toT(0.68, 0.22 + 0.75, 0.24 + tz);
      baker.addHollowCylinder('static', tp[0], tp[1], tp[2], 0.34, 0.26, 0.08, 8, 0, pal.thatchLight, pal.bambooCulm);
      baker.addCylinder('static', tp[0], tp[1] - 0.01, tp[2], 0.27, 0.27, 0.03, 7, 0, pal.teaMid, pal.teaDeep);
    }
    blockers.push({ x: rackP[0], z: rackP[2], hw: 0.50, hd: 0.78, rot: yaw, minY: rackP[1], maxY: rackP[1] + 0.85, source: 'dh-tea-rack' });

    // Firewood stack & tea bench
    const woodP = toT(-0.98, 0.22, 0.78);
    baker.addBox('static', woodP[0], woodP[1] + 0.22, woodP[2], 0.68, 0.44, 0.56, yaw, pal.bark, pal.timberDark);

    const tBenchP = toT(-0.35, 0.22, 1.85);
    baker.addBox('static', tBenchP[0], tBenchP[1] + 0.36, tBenchP[2], 1.24, 0.07, 0.38, yaw, pal.timber, pal.timberDark);
    for (const bx of [-0.44, 0.44]) {
      const lp = toT(-0.35 + bx, 0.22 + 0.18, 1.85);
      baker.addBox('static', lp[0], lp[1], lp[2], 0.09, 0.34, 0.30, yaw, pal.timberDark, pal.bark);
    }
    restSeats.push({
      id: 'dh-tea-bench',
      name: '碧涧茶坞歇凳',
      prompt: '试茶歇脚 · 碧涧茶坞',
      x: tBenchP[0],
      y: tBenchP[1] + 0.40,
      z: tBenchP[2],
      lookX: tea.x,
      lookZ: tea.z,
      exitAngle: yaw
    });

    // Source jade-rill stone weir spring pool just NW of tea terrace
    const rillSrcX = tea.x - 4.4;
    const rillSrcZ = tea.z - 4.8;
    jadeRillAnchor = [rillSrcX, rillSrcZ];
    const rillSrcY = surface(rillSrcX, rillSrcZ);
    baker.withTag('frost-cap', () => {
      baker.addHollowCylinder('static', rillSrcX, rillSrcY + 0.06, rillSrcZ, 2.25, 1.78, 0.42, 8, yaw, pal.stone, pal.stoneDark);
    });
    waterBaker.addCylinder('water', rillSrcX, rillSrcY + 0.14, rillSrcZ, 1.82, 1.82, 0.04, 8, 0, pal.water, pal.waterDeep);
    poolRecords.push({ x: rillSrcX, z: rillSrcZ, rx: 1.9, rz: 1.9 });

    shelters.push({ id: tea.id, name: tea.name, x: tea.x, y: teaY + 0.22, z: tea.z, r: 2.55 });
    targets.push({ id: tea.id, x: stoveP[0], y: stoveP[1] + 0.85, z: stoveP[2], range: 9.5 });
    interactiveSites.push({
      id: tea.id,
      name: tea.name,
      action: tea.action,
      lines: tea.lines,
      soundKind: 'tea',
      x: stoveP[0],
      y: stoveP[1],
      z: stoveP[2],
      height: 0.72,
      lineIdx: 0,
      cooldown: 0
    });
  }

  const staticGeo = baker.buildGeometry('static');
  const staticTags = baker.getTags('static');
  const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const staticMesh = new THREE.Mesh(staticGeo, staticMat);
  staticMesh.name = 'deep-hollows-static';
  staticMesh.matrixAutoUpdate = false;
  staticMesh.updateMatrix();
  group.add(staticMesh);

  const waterGeo = waterBaker.buildGeometry('water');
  const waterMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.84,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.name = 'deep-hollows-water';
  waterMesh.renderOrder = 1;
  waterMesh.matrixAutoUpdate = false;
  waterMesh.updateMatrix();
  group.add(waterMesh);

  // ============================================================================
  // 5. 茶垄、点睛石块与草蕨实例批次 (InstancedMesh under deep-hollows root)
  // ============================================================================
  const teaRecords = [];
  const cragRecords = [];
  const tuftRecords = [];
  const rngVeg = makeRng(cfg.seed, 'dh-veg');

  // 4 contour arcs of old tea bushes around Jade Rill Tea Terrace
  const teaArcRadii = [5.8, 7.6, 9.4, 11.2];
  const teaTarget = cfg.counts?.teaBushes ?? 64;
  for (let row = 0; row < teaArcRadii.length && teaRecords.length < teaTarget; row++) {
    const r = teaArcRadii[row];
    const perRow = Math.ceil(teaTarget / teaArcRadii.length);
    for (let k = 0; k < perRow && teaRecords.length < teaTarget; k++) {
      const ang = -0.35 + (k / Math.max(1, perRow - 1)) * 2.15 + (rngVeg() - 0.5) * 0.08;
      const tx = tea.x + Math.cos(ang) * r;
      const tz = tea.z - Math.sin(ang) * r;
      if (Math.abs(tx) > halfBound - 4 || Math.abs(tz) > halfBound - 4) continue;
      if (polyDist(tx, tz, builtTrails[4].points) < 1.35 || polyDist(tx, tz, builtTrails[5].points) < 1.35) continue;
      const ty = rawGround(tx, tz);
      if (!Number.isFinite(ty) || ty < waterLevel + 0.6) continue;
      const sc = 0.85 + rngVeg() * 0.34;
      const tints = [pal.teaDeep, pal.teaMid, pal.teaBud];
      teaRecords.push({ x: tx, y: surface(tx, tz) - 0.04, z: tz, scale: sc, yaw: rngVeg() * TAU, tint: tints[(row + k) % tints.length] });
    }
  }

  // Framing crags & tufts near the 3 deep sanctuaries and along their 6 trails
  const anchors = [altar, study, tea];
  const cragTarget = cfg.counts?.crags ?? 24;
  let cragTries = 0;
  while (cragRecords.length < cragTarget && cragTries < cragTarget * 14) {
    cragTries++;
    const anc = anchors[cragTries % anchors.length];
    const a = rngVeg() * TAU;
    const d = 5.4 + rngVeg() * 9.5;
    const cx = anc.x + Math.cos(a) * d;
    const cz = anc.z + Math.sin(a) * d;
    if (Math.abs(cx) > halfBound - 4 || Math.abs(cz) > halfBound - 4) continue;
    if (distanceToRiver && distanceToRiver(cx, cz) < 25) continue;
    if (builtTrails.some(tr => polyDist(cx, cz, tr.points) < 1.6)) continue;
    if (resCircles.some(rc => Math.hypot(cx - rc.x, cz - rc.z) < Math.max(4.5, (rc.r || 4.5) * 0.72))) continue;
    const cy = rawGround(cx, cz);
    if (!Number.isFinite(cy) || cy < waterLevel + 0.7 || slopeAt(cx, cz) > 0.65) continue;
    const sc = 0.65 + rngVeg() * 0.72;
    cragRecords.push({ x: cx, y: surface(cx, cz) - 0.14, z: cz, scale: sc, yaw: rngVeg() * TAU, tint: '#FFFFFF' });
  }

  const tuftTarget = cfg.counts?.tufts ?? 96;
  let tuftTries = 0;
  const tuftTints = ['#7CA056', '#92B068', '#6B8D50', '#B4C67E'];
  while (tuftRecords.length < tuftTarget && tuftTries < tuftTarget * 12) {
    tuftTries++;
    const tr = builtTrails[tuftTries % builtTrails.length];
    const seg = tr.points[Math.floor(rngVeg() * tr.points.length)];
    const a = rngVeg() * TAU;
    const d = 1.05 + rngVeg() * 3.8;
    const tx = seg[0] + Math.cos(a) * d;
    const tz = seg[1] + Math.sin(a) * d;
    if (Math.abs(tx) > halfBound - 3 || Math.abs(tz) > halfBound - 3) continue;
    if (builtTrails.some(t => polyDist(tx, tz, t.points) < 0.88)) continue;
    if (anchors.some(anc => Math.hypot(tx - anc.x, tz - anc.z) < 4.5)) continue;
    const ty = rawGround(tx, tz);
    if (!Number.isFinite(ty) || ty < waterLevel + 0.6 || slopeAt(tx, tz) > 0.68) continue;
    tuftRecords.push({
      x: tx,
      y: surface(tx, tz) - 0.02,
      z: tz,
      scale: 0.72 + rngVeg() * 0.55,
      yaw: rngVeg() * TAU,
      tint: tuftTints[tuftRecords.length % tuftTints.length]
    });
  }

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
      const sc = it.scale ?? 1;
      tmpPos.set(it.x, it.y, it.z);
      tmpEuler.set(0, it.yaw || 0, 0, 'YXZ');
      tmpQuat.setFromEuler(tmpEuler);
      tmpScale.set(sc, sc, sc);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      mesh.setMatrixAt(i, tmpMat);
      mesh.setColorAt(i, tmpCol.set(it.tint || '#FFFFFF'));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  }

  const teaGeo = buildTeaOrHerbShrubGeometry(pal);
  const cragGeo = buildStratifiedCragGeometry(pal);
  const tuftGeo = buildMeadowTuftGeometry();
  const solidInstMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const folInstMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });

  const teaMesh = makeInstanced(teaGeo, solidInstMat(), teaRecords, 'deep-hollows-tea');
  const cragMesh = makeInstanced(cragGeo, solidInstMat(), cragRecords, 'deep-hollows-crags');
  const tuftMesh = makeInstanced(tuftGeo, folInstMat(), tuftRecords, 'deep-hollows-tufts');
  void teaMesh;

  // ============================================================================
  // 6. 单一动态批：社坛祈愿幡、冷泉水花、灶烟香雾 & 夜间暖晕
  // ============================================================================
  const bannerGeo = buildBannerRibbonGeometry(pal.lacquerRed);
  const fxDropGeo = buildWaterFxGeometry();
  const slotGeos = [];
  const bannerSlots = bannerSpecs.map(() => {
    const idx = slotGeos.length;
    slotGeos.push(bannerGeo);
    return idx;
  });
  const dropSlots = dropSpecs.map(() => {
    const idx = slotGeos.length;
    slotGeos.push(fxDropGeo);
    return idx;
  });
  const smokeSlots = [];
  for (let s = 0; s < smokeSpecs.length; s++) {
    for (let k = 0; k < 3; k++) {
      smokeSlots.push({ slot: slotGeos.length, spec: smokeSpecs[s], k });
      slotGeos.push(fxDropGeo);
    }
  }
  const dynMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const dynBatch = createRigidBatchMesh(slotGeos, dynMat, 'deep-hollows-dynamic');
  group.add(dynBatch.mesh);

  const emberGeo = new THREE.SphereGeometry(0.24, 6, 5);
  const emberMat = new THREE.MeshBasicMaterial({ color: pal.emberGlow, transparent: true, opacity: 0.85 });
  emberMat.userData.skyIgnore = true;
  const emberMesh = new THREE.InstancedMesh(emberGeo, emberMat, Math.max(1, emberSpecs.length));
  emberMesh.name = 'deep-hollows-ember';
  emberMesh.userData.dynamic = true;
  emberMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  emberMesh.frustumCulled = false;
  tmpQuat.identity();
  for (let i = 0; i < emberSpecs.length; i++) {
    const e = emberSpecs[i];
    tmpPos.set(e.x, e.y, e.z);
    tmpScale.set(e.sx, e.sy, e.sz);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    emberMesh.setMatrixAt(i, tmpMat);
  }
  emberMesh.instanceMatrix.needsUpdate = true;
  emberMesh.computeBoundingSphere();
  emberMesh.visible = false;
  group.add(emberMesh);

  const haloGeo = buildLanternHaloGeometry();
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.42 } },
    vertexShader: LANTERN_HALO_VERT,
    fragmentShader: LANTERN_HALO_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false
  });
  haloMat.opacity = 0.42;
  haloMat.userData.skyIgnore = true;
  const haloMesh = new THREE.InstancedMesh(haloGeo, haloMat, Math.max(1, haloSpecs.length));
  haloMesh.name = 'deep-hollows-halo';
  haloMesh.userData.dynamic = true;
  haloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  haloMesh.frustumCulled = false;
  haloMesh.renderOrder = 3;
  const haloBaseColors = haloSpecs.map(h => new THREE.Color(h.color || pal.lanternHalo || '#FFC472'));
  const tmpHaloCol = new THREE.Color();
  for (let i = 0; i < haloSpecs.length; i++) {
    const h = haloSpecs[i];
    tmpPos.set(h.x, h.y, h.z);
    tmpScale.setScalar(h.radius);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    haloMesh.setMatrixAt(i, tmpMat);
    haloMesh.setColorAt(i, tmpHaloCol.copy(haloBaseColors[i]));
  }
  haloMesh.instanceMatrix.needsUpdate = true;
  if (haloMesh.instanceColor) {
    haloMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    haloMesh.instanceColor.needsUpdate = true;
  }
  haloMesh.computeBoundingSphere();
  haloMesh.visible = false;
  group.add(haloMesh);
  let activeHaloCount = 0;

  const lsCfg = cfg.lanternSeasons || {};
  const lanternSeasons = {
    spring: {
      ember: new THREE.Color(lsCfg.spring?.ember || pal.emberGlow),
      haloTint: new THREE.Color(lsCfg.spring?.haloTint || '#FFFFFF'),
      gain: Number.isFinite(lsCfg.spring?.gain) ? lsCfg.spring.gain : 1.0
    },
    summer: {
      ember: new THREE.Color(lsCfg.summer?.ember || '#FFB35C'),
      haloTint: new THREE.Color(lsCfg.summer?.haloTint || '#FFF3D8'),
      gain: Number.isFinite(lsCfg.summer?.gain) ? lsCfg.summer.gain : 0.96
    },
    autumn: {
      ember: new THREE.Color(lsCfg.autumn?.ember || '#FF9142'),
      haloTint: new THREE.Color(lsCfg.autumn?.haloTint || '#FFD8B0'),
      gain: Number.isFinite(lsCfg.autumn?.gain) ? lsCfg.autumn.gain : 1.04
    },
    winter: {
      ember: new THREE.Color(lsCfg.winter?.ember || '#FF7F34'),
      haloTint: new THREE.Color(lsCfg.winter?.haloTint || '#FFC288'),
      gain: Number.isFinite(lsCfg.winter?.gain) ? lsCfg.winter.gain : 1.12
    }
  };
  let activeLanternSeason = lanternSeasons.spring;

  // ============================================================================
  // 7. 远坞三位山民 (Community Actors)
  // ============================================================================
  const actorGroup = new THREE.Group();
  actorGroup.name = 'deep-hollows-actors';
  actorGroup.userData.dynamic = true;
  group.add(actorGroup);
  const rig = createCommunityActors(actorGroup, 3);

  const altarKeeperX = altar.x + 1.55;
  const altarKeeperZ = altar.z + 1.15;
  const scholarX = study.x + 1.05;
  const scholarZ = study.z + 1.10;
  const roasterX = tea.x + 0.45;
  const roasterZ = tea.z - 0.85;

  const villagers = [
    {
      index: 0,
      id: 'dh-altar-keeper',
      key: 'c_dh-altar-keeper',
      name: '社祝老翁',
      label: '社祝老翁',
      role: 'altar_keeper',
      voiceRole: 'elder',
      kind: 'elder',
      female: false,
      child: false,
      x: altarKeeperX,
      y: altarY + 0.49,
      z: altarKeeperZ,
      facing: -0.78,
      s: 1.0,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '古社大樟树荫下风清日长，春祈秋报皆在这里摆果献粟，保佑合村顺遂安居。',
        '先世避乱初入此谷时栽下这株社樟，如今树干三人合抱，枝叶常青不改旧盟。'
      ]
    },
    {
      index: 1,
      id: 'dh-spring-scholar',
      key: 'c_dh-spring-scholar',
      name: '北涧书生',
      label: '北涧书生',
      role: 'spring_scholar',
      voiceRole: 'villager',
      kind: 'villager',
      female: false,
      child: false,
      x: scholarX,
      y: studyY + 0.44,
      z: scholarZ,
      facing: -2.4,
      s: 1.0,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '崖间竹笕引来北山冷泉，煮茶读书两相宜；坐倦了抬眼便是梯田水镜与万绿春畴。',
        '架上收着历代村人抄录的农桑节候竹简，唯记花开稻熟，不问山外改朝换代。'
      ]
    },
    {
      index: 2,
      id: 'dh-tea-roaster',
      key: 'c_dh-tea-roaster',
      name: '茶坡山农',
      label: '茶坡山农',
      role: 'tea_roaster',
      voiceRole: 'farmer',
      kind: 'farmer',
      female: false,
      child: false,
      x: roasterX,
      y: teaY + 0.22,
      z: roasterZ,
      facing: 2.1,
      s: 1.0,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '碧涧源头水汽最润，这四排老茶树不施肥药全凭山岚露水滋养，炒一锅满岭清香！',
        '客人远道走到东坡尽头，快坐下歇歇肩，竹匾里新焙的春茶正好泡一盏解渴。'
      ]
    }
  ];
  const activeActors = [];

  // ============================================================================
  // 8. 四候物候色彩快照与无损还原
  // ============================================================================
  let currentPhenology = 'spring';
  let snapshotted = false;
  const snaps = {
    staticCol: null,
    waterCol: null,
    teaCol: null,
    cragCol: null,
    tuftCol: null
  };

  function ensureSnapshots() {
    if (snapshotted) return;
    snapshotted = true;
    snaps.staticCol = new Float32Array(staticGeo.attributes.color.array);
    snaps.waterCol = new Float32Array(waterGeo.attributes.color.array);
    snaps.teaCol = new Float32Array(teaGeo.attributes.color.array);
    snaps.cragCol = new Float32Array(cragGeo.attributes.color.array);
    snaps.tuftCol = new Float32Array(tuftGeo.attributes.color.array);
  }
  ensureSnapshots();

  const _snowC = new THREE.Color('#E9E7DF');
  const _winterIce = new THREE.Color('#8BAAB0');
  const _autCamphorA = new THREE.Color('#D59B3E');
  const _autCamphorB = new THREE.Color('#C47A3C');
  const _sumCamphor = new THREE.Color('#47753C');

  function setPhenology(id) {
    const next = (id === 'summer' || id === 'autumn' || id === 'winter') ? id : 'spring';
    if (next === currentPhenology && (next !== 'spring' || !snapshotted)) return false;
    ensureSnapshots();
    currentPhenology = next;
    activeLanternSeason = lanternSeasons[next] || lanternSeasons.spring;
    emberMat.color.copy(activeLanternSeason.ember);

    staticGeo.attributes.color.array.set(snaps.staticCol);
    staticGeo.attributes.color.needsUpdate = true;
    waterGeo.attributes.color.array.set(snaps.waterCol);
    waterGeo.attributes.color.needsUpdate = true;
    teaGeo.attributes.color.array.set(snaps.teaCol);
    teaGeo.attributes.color.needsUpdate = true;
    cragGeo.attributes.color.array.set(snaps.cragCol);
    cragGeo.attributes.color.needsUpdate = true;
    tuftGeo.attributes.color.array.set(snaps.tuftCol);
    tuftGeo.attributes.color.needsUpdate = true;

    if (next === 'spring') return true;

    const sDst = staticGeo.attributes.color.array;
    const sNor = staticGeo.attributes.normal.array;
    const wDst = waterGeo.attributes.color.array;
    const tDst = tuftGeo.attributes.color.array;

    if (next === 'summer') {
      for (const t of staticTags) {
        if (t.tag === 'foliage-camphor') {
          for (let v = t.start; v < t.end; v++) {
            const i = v * 3;
            sDst[i] = lerp(snaps.staticCol[i], _sumCamphor.r, 0.45);
            sDst[i + 1] = lerp(snaps.staticCol[i + 1], _sumCamphor.g, 0.45);
            sDst[i + 2] = lerp(snaps.staticCol[i + 2], _sumCamphor.b, 0.45);
          }
        } else if (t.tag === 'dh-trail') {
          for (let v = t.start; v < t.end; v++) {
            const i = v * 3;
            sDst[i] = clamp(snaps.staticCol[i] * 0.90, 0.05, 1);
            sDst[i + 1] = clamp(snaps.staticCol[i + 1] * 1.05, 0.05, 1);
            sDst[i + 2] = clamp(snaps.staticCol[i + 2] * 0.92, 0.05, 1);
          }
        }
      }
      staticGeo.attributes.color.needsUpdate = true;
      return true;
    }

    if (next === 'autumn') {
      for (const t of staticTags) {
        if (t.tag === 'foliage-camphor') {
          for (let v = t.start; v < t.end; v++) {
            const i = v * 3;
            const cRef = (v % 3 === 0) ? _autCamphorB : _autCamphorA;
            sDst[i] = lerp(snaps.staticCol[i], cRef.r, 0.72);
            sDst[i + 1] = lerp(snaps.staticCol[i + 1], cRef.g, 0.72);
            sDst[i + 2] = lerp(snaps.staticCol[i + 2], cRef.b, 0.72);
          }
        } else if (t.tag === 'dh-trail') {
          for (let v = t.start; v < t.end; v++) {
            const i = v * 3;
            sDst[i] = clamp(snaps.staticCol[i] * 1.12 + 0.03, 0.05, 1);
            sDst[i + 1] = clamp(snaps.staticCol[i + 1] * 0.96, 0.05, 1);
            sDst[i + 2] = clamp(snaps.staticCol[i + 2] * 0.78, 0.05, 1);
          }
        }
      }
      staticGeo.attributes.color.needsUpdate = true;
      for (let i = 0; i < tDst.length; i += 3) {
        tDst[i] = Math.min(1, snaps.tuftCol[i] * 1.2 + 0.05);
        tDst[i + 1] = Math.min(1, snaps.tuftCol[i + 1] * 1.0);
        tDst[i + 2] = snaps.tuftCol[i + 2] * 0.75;
      }
      tuftGeo.attributes.color.needsUpdate = true;
      return true;
    }

    // Winter snow dusting
    for (const t of staticTags) {
      if (t.tag !== 'frost-cap' && t.tag !== 'frost-roof' && t.tag !== 'dh-trail' && t.tag !== 'foliage-camphor') continue;
      for (let v = t.start; v < t.end; v++) {
        const i = v * 3;
        const ny = Math.abs(sNor[i + 1]);
        if (ny < 0.15) continue;
        const f = (t.tag === 'dh-trail' ? 0.52 : 0.65) * clamp(ny, 0.22, 1);
        sDst[i] = lerp(snaps.staticCol[i], _snowC.r, f);
        sDst[i + 1] = lerp(snaps.staticCol[i + 1], _snowC.g, f);
        sDst[i + 2] = lerp(snaps.staticCol[i + 2], _snowC.b, f);
      }
    }
    staticGeo.attributes.color.needsUpdate = true;

    for (let i = 0; i < wDst.length; i += 3) {
      wDst[i] = lerp(snaps.waterCol[i], _winterIce.r, 0.55);
      wDst[i + 1] = lerp(snaps.waterCol[i + 1], _winterIce.g, 0.55);
      wDst[i + 2] = lerp(snaps.waterCol[i + 2], _winterIce.b, 0.55);
    }
    waterGeo.attributes.color.needsUpdate = true;

    const teaDst = teaGeo.attributes.color.array;
    const teaNor = teaGeo.attributes.normal.array;
    for (let i = 0; i < teaDst.length; i += 3) {
      const ny = teaNor[i + 1];
      if (ny > 0.18) {
        const f = 0.6 * clamp(ny, 0.2, 1);
        teaDst[i] = lerp(snaps.teaCol[i], _snowC.r, f);
        teaDst[i + 1] = lerp(snaps.teaCol[i + 1], _snowC.g, f);
        teaDst[i + 2] = lerp(snaps.teaCol[i + 2], _snowC.b, f);
      }
    }
    teaGeo.attributes.color.needsUpdate = true;

    const cDst = cragGeo.attributes.color.array;
    const cNor = cragGeo.attributes.normal.array;
    for (let i = 0; i < cDst.length; i += 3) {
      const ny = cNor[i + 1];
      if (ny > 0.25) {
        const f = 0.56 * clamp(ny, 0.25, 1);
        cDst[i] = lerp(snaps.cragCol[i], _snowC.r, f);
        cDst[i + 1] = lerp(snaps.cragCol[i + 1], _snowC.g, f);
        cDst[i + 2] = lerp(snaps.cragCol[i + 2], _snowC.b, f);
      }
    }
    cragGeo.attributes.color.needsUpdate = true;

    for (let i = 0; i < tDst.length; i += 3) {
      tDst[i] = lerp(snaps.tuftCol[i], _snowC.r, 0.65);
      tDst[i + 1] = lerp(snaps.tuftCol[i + 1], _snowC.g, 0.65);
      tDst[i + 2] = lerp(snaps.tuftCol[i + 2], _snowC.b, 0.65);
    }
    tuftGeo.attributes.color.needsUpdate = true;
    return true;
  }

  // ============================================================================
  // 9. 交互与动态模拟 (E 交互 + dt=0 严格冻结)
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
      if (site.soundKind === 'water') (sound?.bambooSpring || sound?.waterCup || sound?.gurgle || sound?.bell)?.call(sound, site.x, site.z);
      else if (site.soundKind === 'tea') {
        if (typeof sound?.teaSimmer === 'function') sound.teaSimmer(site.x, site.z, { withEmberCrackle: true });
        else (sound?.waterCup || sound?.bell)?.call(sound, site.x, site.z);
      }
      else (sound?.bell || sound?.wood)?.call(sound, site.x, site.z);
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
      const dx = s.x - eyeX;
      const dy = ty - eyeY;
      const dz = s.z - eyeZ;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const dot = (dx * fx + dy * fy + dz * fz) / dist;
      if (distXZ > 2.2 && dot < 0.68) continue;
      const score = dist + (1 - dot) * (pickCfg.alignBias || 2.5);
      if (!best || score < best.score) {
        best = {
          kind: 'mystery',
          key: 'dh:' + s.id,
          id: s.id,
          isDeepHollowProp: true,
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
    if (!mysteries || mysteries._deepHollowsBound) return;
    mysteries._deepHollowsBound = true;
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
      if (target?.isDeepHollowProp) {
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

  function writeDynamics(t, sky, playerState) {
    const timeId = sky?.timeId || 'day';
    const isNight = timeId === 'night' || timeId === 'dusk';
    const windX = Number(sky?.windX ?? 0.14) || 0;
    const windZ = Number(sky?.windZ ?? 0.06) || 0;
    const windAmp = 0.08 + Math.hypot(windX, windZ) * 0.26;

    for (let i = 0; i < bannerSpecs.length; i++) {
      const b = bannerSpecs[i];
      const sway = Math.sin(t * 2.2 + b.phase) * windAmp;
      const twist = Math.cos(t * 1.4 + b.phase) * 0.12;
      dynBatch.writePart(bannerSlots[i], b.x, b.y, b.z, sway, b.yaw + twist, sway * 0.45, 1, 1, 1);
    }
    for (let i = 0; i < dropSpecs.length; i++) {
      const d = dropSpecs[i];
      const u = ((t * 1.15 + d.phase) % 1 + 1) % 1;
      const px = lerp(d.x0, d.x1, u);
      const py = lerp(d.y0, d.y1, u * u);
      const pz = lerp(d.z0, d.z1, u);
      const sc = 0.11 + 0.06 * Math.sin(u * Math.PI);
      dynBatch.writePart(dropSlots[i], px, py, pz, 0, 0, 0, sc, sc * 1.2, sc);
    }
    for (let i = 0; i < smokeSlots.length; i++) {
      const item = smokeSlots[i];
      const sp = item.spec;
      const u = ((t * 0.28 + item.k / 3) % 1 + 1) % 1;
      const px = sp.x + windX * u * sp.drift + Math.sin(t * 1.2 + item.k) * 0.12 * u;
      const py = sp.y + u * sp.drift;
      const pz = sp.z + windZ * u * sp.drift + Math.cos(t * 1.0 + item.k) * 0.12 * u;
      const sc = Math.sin(u * Math.PI) * (sp.scale + u * sp.scale);
      dynBatch.writePart(item.slot, px, py, pz, 0, t * 0.4 + item.k, 0, sc, sc * 0.78, sc);
    }
    dynBatch.commit();

    const deepNight = timeId === 'night';
    const hasPlayer = Boolean(playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z));
    rig.begin();
    for (let i = 0; i < villagers.length; i++) {
      const v = villagers[i];
      v.active = !deepNight;
      if (!v.active) continue;
      if (hasPlayer && Math.hypot(playerState.x - v.x, playerState.z - v.z) > 105) continue;
      const isGreet = v.greetUntil > t;
      const yaw = isGreet
        ? Math.atan2(v.greetX - v.x, v.greetZ - v.z)
        : v.facing + Math.sin(t * 0.35 + i) * 0.14;
      rig.actor(v.x, v.y, v.z, yaw, v.s);
      rig.human(v, {
        lean: 0.06,
        crouch: 0.04,
        nod: isGreet ? Math.sin(t * 2.1) * 0.05 : 0.03,
        headTurn: isGreet ? 0 : Math.sin(t * 0.52 + i) * 0.16,
        left: [-0.20, 0.94, 0.22],
        right: [0.20, 0.96 + Math.sin(t * 1.4 + i) * 0.04, 0.26],
        walk: 0
      });
      if (v.role === 'spring_scholar') {
        rig.part('box', [0.02, 0.98, 0.28], [0.18, 0.04, 0.12], 0xd9cfb4);
      } else if (v.role === 'tea_roaster') {
        rig.part('fan', [0.22, 0.94, 0.32], [0.13, 0.13, 0.13], 0xd5c396, [0.3, Math.sin(t * 2.8) * 0.16, 0.4]);
      }
    }
    rig.finish();

    if (!isNight) {
      emberMesh.visible = false;
      haloMesh.visible = false;
      emberMesh.count = 0;
      haloMesh.count = 0;
      activeHaloCount = 0;
      return;
    }

    let visCount = 0;
    const timeGain = deepNight ? 1.0 : 0.56;
    const breeze = clamp(Math.hypot(windX, windZ), 0, 2.5);
    const seasonGain = activeLanternSeason.gain;
    tmpQuat.identity();
    for (let i = 0; i < emberSpecs.length; i++) {
      const e = emberSpecs[i];
      const h = haloSpecs[i];
      const dist = hasPlayer ? Math.hypot(playerState.x - e.x, playerState.z - e.z) : 0;
      if (dist > 105) continue;
      const fade = clamp((105 - dist) / 15, 0, 1);
      const flutterScale = h.kind === 'hanging' ? 1.25 : (h.kind === 'lamp' ? 1.0 : 0.75);
      const slowWave = Math.sin(t * 2.4 + h.phase);
      const flutter = Math.sin(t * (5.8 + breeze * 1.6) + h.phase * 2.3) * (0.028 + 0.036 * Math.min(1, breeze)) * flutterScale;
      const breath = clamp(0.90 + 0.075 * slowWave + flutter, 0.78, 1.06);
      const ePulse = 0.94 + 0.06 * breath;
      tmpPos.set(e.x, e.y, e.z);
      tmpScale.set(e.sx * ePulse, e.sy * ePulse, e.sz * ePulse);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      emberMesh.setMatrixAt(visCount, tmpMat);

      const hScale = h.radius * (0.94 + 0.08 * breath);
      tmpPos.set(h.x, h.y, h.z);
      tmpScale.set(hScale, hScale, hScale);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      haloMesh.setMatrixAt(visCount, tmpMat);
      tmpHaloCol.copy(haloBaseColors[i]).multiply(activeLanternSeason.haloTint).multiplyScalar(fade * timeGain * seasonGain * breath);
      haloMesh.setColorAt(visCount, tmpHaloCol);
      visCount++;
    }
    activeHaloCount = visCount;
    emberMesh.count = visCount;
    haloMesh.count = visCount;
    emberMesh.visible = visCount > 0;
    haloMesh.visible = visCount > 0;
    if (visCount > 0) {
      emberMesh.instanceMatrix.needsUpdate = true;
      haloMesh.instanceMatrix.needsUpdate = true;
      if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
      emberMat.color.copy(activeLanternSeason.ember);
      emberMat.opacity = (deepNight ? 0.86 : 0.62) * (0.91 + 0.06 * Math.sin(t * 3.8) + 0.03 * Math.sin(t * (7.2 + breeze * 1.4)));
      const nextHaloOpacity = clamp((deepNight ? 0.42 : 0.24) * seasonGain, 0.18, 0.50);
      haloMat.opacity = nextHaloOpacity;
      haloMat.uniforms.uOpacity.value = nextHaloOpacity;
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
    if (noteTimer > 0) {
      noteTimer = Math.max(0, noteTimer - step);
      if (noteTimer <= 0 && noteEl && noteEl.textContent === lastNoteText) {
        noteEl.classList?.remove?.('show');
        noteEl.setAttribute?.('aria-hidden', 'true');
      }
    }
    writeDynamics(simTime, sky, playerState);
  }

  function isOnWood(x, z) {
    for (let i = 0; i < woodDecks.length; i++) {
      const d = woodDecks[i];
      if (d.material === 'stone') continue;
      const dx = x - d.x;
      const dz = z - d.z;
      if (Math.abs(dx * d.tx + dz * d.tz) <= d.length * 0.52 && Math.abs(dx * d.ux + dz * d.uz) <= d.width * 0.52) {
        return true;
      }
    }
    return false;
  }

  function getInteractables() {
    activeActors.length = 0;
    if (!group.visible) return activeActors;
    for (let i = 0; i < villagers.length; i++) {
      if (villagers[i].active) activeActors.push(villagers[i]);
    }
    return activeActors;
  }

  function greet(id, px, pz, duration = 4.2) {
    for (let i = 0; i < villagers.length; i++) {
      const v = villagers[i];
      if (v.id === id || v.key === id) {
        v.greetUntil = simTime + Math.max(1.5, duration || 4.2);
        v.greetX = px;
        v.greetZ = pz;
        return true;
      }
    }
    return false;
  }

  function getStats() {
    return {
      enabled: true,
      disposed,
      simTime: +simTime.toFixed(3),
      phenology: currentPhenology,
      sanctuaries: interactiveSites.length,
      trails: builtTrails.length,
      teaBushes: teaRecords.length,
      crags: cragRecords.length,
      tufts: tuftRecords.length,
      villagers: villagers.length,
      lanternHalos: haloSpecs.length,
      activeLanternHalos: activeHaloCount,
      targets: targets.length,
      blockers: blockers.length
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    rig.dispose();
    group.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material?.dispose?.();
      }
    });
    bannerGeo.dispose();
    fxDropGeo.dispose();
    haloGeo.dispose();
    haloMat.dispose();
    emberGeo.dispose();
    emberMat.dispose();
    group.removeFromParent();
  }

  void cliff;
  void studyDeskWorld;

  return {
    group,
    blockers,
    targets,
    shelters,
    restSeats,
    quietSpots: cfg.quietSpots || [],
    layout: {
      trails: builtTrails,
      woodDecks,
      walkPlatforms,
      sanctuaries: cfg.sanctuaries,
      pools: poolRecords,
      teaSpots: teaRecords.map(it => [it.x, it.z]),
      cragSpots: cragRecords.map(it => [it.x, it.z]),
      soundAnchors: {
        coldSpring: { x: coldSpringAnchor[0], z: coldSpringAnchor[1] },
        teaStove: { x: teaStoveAnchor[0], z: teaStoveAnchor[1] },
        jadeRill: { x: jadeRillAnchor[0], z: jadeRillAnchor[1] },
        ancientAltar: { x: altar.x, z: altar.z }
      }
    },
    isOnWood,
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
