import * as THREE from 'three';
import borderlandCfg from '../data/valley-borderlands.json' with { type: 'json' };
import { createCommunityActors } from '../systems/community-actors.js';
import { habitatSurface, createHabitatContext } from './habitat-details.js';
import { segmentDistance } from './hinterland.js';
import { createWhiteEgretParts, createRigidBatchMesh } from './qin-han-fauna-geometry.js';
import {
  createVertexColorBaker,
  buildCliffPineGeometry,
  buildBlossomTreeGeometry,
  buildHillsideBambooGeometry,
  buildTeaOrHerbShrubGeometry,
  buildStratifiedCragGeometry,
  buildMeadowTuftGeometry,
  buildWaterFxGeometry,
  createMountainGoatParts,
  createSoaringCraneParts,
  createButterflyParts,
  createDriftingPetalLeafGeometry
} from './valley-borderlands-geometry.js';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function makeRng(seed, tag = '') {
  let s = (seed >>> 0) || 20261116;
  for (let i = 0; i < tag.length; i++) {
    s = Math.imul(s ^ tag.charCodeAt(i), 16777619) >>> 0;
  }
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
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

function smoothPolyline(pts, subdiv = 6) {
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

function buildReservations(options) {
  const hab = createHabitatContext(options);
  const circles = hab.reservations.circles.map(c => ({ ...c }));
  const boxes = hab.reservations.boxes.map(b => ({ ...b }));
  const corridors = hab.reservations.corridors.map(c => ({ ...c }));

  // Exclude exterior peach-tree far dots falsely generated when flora isn't basin-masked;
  // inside basin inner*1.04 there are no exterior peach trees in main.js.
  const basin = options.world?.terrain?.basin || { x: 30, z: -140, inner: 96 };
  const filteredCircles = circles.filter(c => {
    if (typeof c.source === 'string' && c.source.startsWith('tree-') &&
        Math.hypot(c.x - basin.x, c.z - basin.z) < basin.inner * 1.04) {
      return false;
    }
    return true;
  });

  const extraSources = options.reservations || [];
  for (const src of extraSources) {
    const lay = src?.layout || src;
    for (const b of src?.blockers || []) boxes.push({ ...b });
    for (const r of lay?.regions || []) {
      if (Number.isFinite(r.x) && Number.isFinite(r.z)) {
        filteredCircles.push({ x: r.x, z: r.z, r: r.radius || 2.2, source: r.kind || 'r6-region' });
      }
    }
    for (const s of src?.sites || []) {
      if (Number.isFinite(s.x) && Number.isFinite(s.z)) {
        filteredCircles.push({ x: s.x, z: s.z, r: 3.2, source: s.id || 'easter-egg' });
      }
    }
  }
  const qh = options.qinHanHomestead?.layout;
  if (qh) {
    for (const k of ['weaving', 'carpentry', 'pottery', 'fieldHut', 'hearth']) {
      if (qh[k] && Number.isFinite(qh[k].x) && Number.isFinite(qh[k].z)) {
        filteredCircles.push({ x: qh[k].x, z: qh[k].z, r: 4.2, source: 'qh-' + k });
      }
    }
  }

  return {
    world: options.world,
    field: options.field,
    basin,
    dry: hab.dry,
    circles: filteredCircles,
    boxes,
    corridors
  };
}

function isBorderlandSafe(x, z, radius, res, opts = {}) {
  if (![x, z, radius].every(Number.isFinite) || radius <= 0) return false;
  const { world, field, basin, dry, circles, boxes, corridors } = res;
  const half = (world?.terrain?.size || 800) * 0.5 - 6;
  if (Math.abs(x) + radius > half || Math.abs(z) + radius > half) return false;

  const maxBasinR = opts.maxBasinR ?? 123.0;
  const minBasinR = opts.minBasinR ?? 0;
  const rBasin = Math.hypot(x - basin.x, z - basin.z);
  if (rBasin + radius > maxBasinR || rBasin < minBasinR) return false;

  // Keep south cliff mouth & exterior peach valley untouched: only populate z < -78 inside basin
  if (z > (opts.maxZ ?? -80)) return false;

  const clearance = opts.clearance ?? 0.45;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    if (opts.ignoreTag && c.source === opts.ignoreTag) continue;
    if (Math.hypot(x - c.x, z - c.z) < radius + c.r + clearance) return false;
  }
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (opts.ignoreTag && b.source === opts.ignoreTag) continue;
    if (boxDistance(x, z, b) < radius + clearance) return false;
  }
  for (let i = 0; i < corridors.length; i++) {
    const c = corridors[i];
    if (opts.ignoreTag && c.source === opts.ignoreTag) continue;
    for (let j = 1; j < c.points.length; j++) {
      if (segmentDistance(x, z, c.points[j - 1], c.points[j]) < radius + c.half + clearance) return false;
    }
  }

  const maxSlope = opts.maxSlope ?? 0.34;
  const allowWet = Boolean(opts.allowWet);
  const sampleOk = (px, pz) => {
    const h = habitatSurface(field, px, pz);
    if (!Number.isFinite(h)) return false;
    if (!allowWet && field.sample(px, pz) < dry) return false;
    const sl = field.slope(px, pz);
    return Number.isFinite(sl) && sl <= maxSlope;
  };

  if (!sampleOk(x, z)) return false;
  const rings = radius > 1.4 ? 12 : 8;
  for (let i = 0; i < rings; i++) {
    const a = (i / rings) * TAU;
    if (!sampleOk(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) return false;
  }
  return true;
}

export function createValleyBorderlands(options = {}) {
  const cfg = { ...borderlandCfg, ...(options.config || {}) };
  const pal = cfg.palette;
  const field = options.field;
  const group = new THREE.Group();
  group.name = 'valley-borderlands';

  if (!cfg.enabled || !field) {
    return {
      group,
      blockers: [],
      targets: [],
      restSeats: [],
      quietSpots: [],
      shelters: [],
      contactTargets: [],
      layout: {},
      getInteractables: () => [],
      setPhenology() {},
      syncAtmosphere() {},
      greet() {},
      bind() {},
      update() {},
      getStats: () => ({ enabled: false }),
      dispose() {}
    };
  }

  const res = buildReservations(options);
  // Reserve nearby outer-wilds sanctuary footprints so borderland crags/blossoms/pines never clip mountain cottages or viewing decks
  res.circles.push(
    { x: -82.0, z: -176.0, r: 7.2, source: 'ow-deer-hermitage' },
    { x: -68.0, z: -234.0, r: 7.6, source: 'ow-woodcutter-hut' },
    { x: 82.0, z: -235.5, r: 7.6, source: 'ow-mountain-tea-hut' }
  );
  const surface = (x, z) => habitatSurface(field, x, z);
  const baker = createVertexColorBaker();

  const blockers = [];
  const targets = [];
  const restSeats = [];
  const shelters = [];
  const contactTargets = [];
  const interactiveSites = [];

  const tmpPos = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  const tmpCol = new THREE.Color();

  function composeMatrix(x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    tmpPos.set(x, y, z);
    tmpEuler.set(rx, ry, rz, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpScale.set(sx, sy, sz);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    return tmpMat.clone();
  }

  // ============================================================================
  // 1. 山野青石板径与北麓平畴土路 (6 connected trails with staggered flagstones & mossy curbs)
  // ============================================================================
  const builtPaths = [];
  const rockPalOpts = {
    stoneDark: pal.stoneDark,
    stoneMid: pal.stone,
    stoneCyan: '#5B7A6E',
    stoneLight: pal.stoneLight,
    moss: pal.moss,
    mossBright: pal.mossBright
  };

  const brCfgRoad = cfg.landmarks && cfg.landmarks.stoneBridge;
  baker.withTag('vb-road', () => {
    for (const pDef of cfg.paths || []) {
      const dense = smoothPolyline(pDef.points, 5);
      const halfW = (pDef.width || 1.4) * 0.5;
      const isFlagstone = pDef.kind === 'flagstone';
      const baseHex = isFlagstone ? pal.pathEdge : pal.path;
      const edgeHex = isFlagstone ? pal.moss : pal.pathEdge;

      for (let i = 0; i < dense.length - 1; i++) {
        const a = dense[i];
        const b = dense[i + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const segLen = Math.hypot(dx, dz);
        if (segLen < 1e-4) continue;
        const segMx = (a[0] + b[0]) * 0.5;
        const segMz = (a[1] + b[1]) * 0.5;
        if (pDef.id === 'north-foothill-trail') {
          // Stop cleanly at bridge abutments and skip eastern tail already covered by upper-orchard
          if (brCfgRoad && Math.hypot(segMx - brCfgRoad.x, segMz - brCfgRoad.z) < (brCfgRoad.length || 4.8) * 0.40) continue;
          if (segMx > 46.6) continue;
        }
        const nx = -dz / segLen;
        const nz = dx / segLen;
        const wob0 = Math.sin(i * 0.9) * 0.08;
        const wob1 = Math.sin((i + 1) * 0.9) * 0.08;
        const hw0 = halfW + wob0;
        const hw1 = halfW + wob1;

        const l0x = a[0] + nx * hw0, l0z = a[1] + nz * hw0;
        const r0x = a[0] - nx * hw0, r0z = a[1] - nz * hw0;
        const l1x = b[0] + nx * hw1, l1z = b[1] + nz * hw1;
        const r1x = b[0] - nx * hw1, r1z = b[1] - nz * hw1;

        const lift = 0.048;
        const m0y = Math.max(surface(a[0], a[1]), (surface(l0x, l0z) + surface(r0x, r0z)) * 0.5) + lift;
        const m1y = Math.max(surface(b[0], b[1]), (surface(l1x, l1z) + surface(r1x, r1z)) * 0.5) + lift;
        const l0y = surface(l0x, l0z) + 0.024;
        const r0y = surface(r0x, r0z) + 0.024;
        const l1y = surface(l1x, l1z) + 0.024;
        const r1y = surface(r1x, r1z) + 0.024;

        const roadJit = Math.sin(i * 0.65) * 0.014;
        baker.addQuad('ground', [l0x, l0y, l0z], [l1x, l1y, l1z], [b[0], m1y, b[1]], [a[0], m0y, a[1]], baseHex, roadJit);
        baker.addQuad('ground', [a[0], m0y, a[1]], [b[0], m1y, b[1]], [r1x, r1y, r1z], [r0x, r0y, r0z], isFlagstone ? edgeHex : baseHex, -roadJit * 0.5);

        // Staggered dressed bluestone slabs + occasional mossy shoulder stones along mountain trails
        if (isFlagstone) {
          const mx = (a[0] + b[0]) * 0.5;
          const mz = (a[1] + b[1]) * 0.5;
          const my = (m0y + m1y) * 0.5 + 0.016;
          const yaw = Math.atan2(dx, dz);
          const slabLen = Math.min(0.76, segLen * 0.80);
          if (i % 2 === 0) {
            baker.addBox('ground', mx + nx * halfW * 0.24, my, mz + nz * halfW * 0.24, halfW * 0.78, 0.045, slabLen, yaw + 0.03, pal.flagstone, pal.stone);
            baker.addBox('ground', mx - nx * halfW * 0.34, my - 0.004, mz - nz * halfW * 0.34, halfW * 0.54, 0.042, slabLen * 0.86, yaw - 0.04, pal.stoneLight, pal.stone);
          } else {
            baker.addBox('ground', mx - nx * halfW * 0.18, my, mz - nz * halfW * 0.18, halfW * 0.86, 0.045, slabLen * 0.92, yaw - 0.02, '#91978A', pal.stone);
          }
          if (i % 5 === 1) {
            const side = i % 2 === 0 ? 1 : -1;
            const sx = mx + nx * (halfW + 0.18) * side;
            const sz = mz + nz * (halfW + 0.18) * side;
            baker.addFacetedRock('solid', sx, surface(sx, sz) + 0.04, sz, 0.20, 0.18, 0.16, yaw, i * 17 + 3, { ...rockPalOpts, sides: 5 });
          }
        }
      }

      res.corridors.push({ points: dense, half: halfW + 0.55, source: 'vb-path-' + pDef.id });
      builtPaths.push({ id: pDef.id, kind: pDef.kind, width: pDef.width, points: dense });
    }
  });

  // ============================================================================
  // 2. 北麓叠翠曲水梯田 (5 Crescent Stepped Terraced Paddies + Dry-Stone Bunds + Bamboo Spillways + Rice Rows)
  // ============================================================================
  const tCfg = cfg.terraces;
  const builtTerraces = [];
  let prevWaterY = -Infinity;

  // Helper to bake a multi-blade rice tussock + arching grain panicles onto a flooded paddy
  const bakePaddyRiceTussock = (tx, waterY, tz, yaw, seed) => {
    const baseY = waterY - 0.04;
    baker.withTag('paddy-blade', () => {
      for (let k = 0; k < 4; k++) {
        const a = yaw + (k / 4) * TAU + (seed % 3) * 0.18;
        const ca = Math.cos(a), sa = Math.sin(a);
        const w = 0.038;
        const px = -sa * w, pz = ca * w;
        const h = 0.34 + ((seed + k) % 3) * 0.05;
        const lean = 0.14 + (k % 2) * 0.05;
        baker.addTri(
          'solid',
          tx + px, baseY, tz + pz,
          tx - px, baseY, tz - pz,
          tx + ca * lean, waterY + h, tz + sa * lean,
          k % 2 === 0 ? '#84B25B' : '#73A14E',
          0.02
        );
      }
    });
    // Drooping rice panicle ear (tender green in spring/summer -> heavy golden '金粟' in autumn)
    baker.withTag('paddy-panicle', () => {
      const pa = yaw + 0.45;
      const ca = Math.cos(pa), sa = Math.sin(pa);
      const px = -sa * 0.032, pz = ca * 0.032;
      const crestX = tx + ca * 0.11, crestY = waterY + 0.37, crestZ = tz + sa * 0.11;
      const tipX = tx + ca * 0.25, tipY = waterY + 0.27, tipZ = tz + sa * 0.25;
      baker.addTri('solid', tx + px, waterY + 0.22, tz + pz, tx - px, waterY + 0.22, tz - pz, crestX, crestY, crestZ, '#92BD66', 0.03);
      baker.addTri('solid', crestX + px, crestY, crestZ + pz, crestX - px, crestY, crestZ - pz, tipX, tipY, tipZ, '#9EC470', 0.04);
    });
  };

  for (const tier of tCfg.tiers) {
    const segs = 18;
    const arcPtsInner = [];
    const arcPtsOuter = [];
    let maxGroundInTier = -Infinity;

    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const ang = lerp(tier.angFrom, tier.angTo, u);
      const ripple = Math.sin(u * Math.PI * 3 + tier.index * 1.3) * 0.85;
      const rIn = tier.rInner + ripple * 0.45;
      const rOut = tier.rOuter + ripple;
      const ix = tCfg.centerX - Math.cos(ang) * rIn;
      const iz = tCfg.centerZ + Math.sin(ang) * rIn;
      const ox = tCfg.centerX - Math.cos(ang) * rOut;
      const oz = tCfg.centerZ + Math.sin(ang) * rOut;
      arcPtsInner.push([ix, iz]);
      arcPtsOuter.push([ox, oz]);
      maxGroundInTier = Math.max(maxGroundInTier, surface(ix, iz), surface(ox, oz), surface((ix + ox) * 0.5, (iz + oz) * 0.5));
    }

    const waterY = Math.max(maxGroundInTier + 0.10, prevWaterY + 0.30, 2.04 + tier.lift * 0.58);
    prevWaterY = waterY;
    const bundTopY = waterY + 0.095;
    const bundWidth = 0.84;

    for (let s = 0; s < segs; s++) {
      const i0 = arcPtsInner[s];
      const i1 = arcPtsInner[s + 1];
      const o0 = arcPtsOuter[s];
      const o1 = arcPtsOuter[s + 1];
      const m0 = [(i0[0] + o0[0]) * 0.5, (i0[1] + o0[1]) * 0.5];
      const m1 = [(i1[0] + o1[0]) * 0.5, (i1[1] + o1[1]) * 0.5];

      // Two-band flooded water mirror (deeper reflective center + shallow celadon margin)
      const wColOuter = s % 3 === 0 ? '#89B8AA' : pal.water;
      const wColInner = s % 2 === 0 ? '#76A698' : '#82B1A3';
      baker.withTag('terrace-water', () => {
        baker.addQuad('water', [i0[0], waterY, i0[1]], [m0[0], waterY, m0[1]], [m1[0], waterY, m1[1]], [i1[0], waterY, i1[1]], wColInner);
        baker.addQuad('water', [m0[0], waterY, m0[1]], [o0[0], waterY, o0[1]], [o1[0], waterY, o1[1]], [m1[0], waterY, m1[1]], wColOuter);
      });

      // Contour rows of sculpted rice tussocks & panicles across the paddy water mirror
      for (const rFrac of [0.32, 0.68]) {
        const rx = lerp((i0[0] + i1[0]) * 0.5, (o0[0] + o1[0]) * 0.5, rFrac);
        const rz = lerp((i0[1] + i1[1]) * 0.5, (o0[1] + o1[1]) * 0.5, rFrac);
        if ((s + tier.index) % 2 === 0 || rFrac > 0.5) {
          bakePaddyRiceTussock(rx, waterY, rz, s * 1.1 + tier.index * 0.7, tier.index * 31 + s * 7 + (rFrac > 0.5 ? 3 : 1));
        }
      }

      // Outer dry-stone & mossy-turf stepped retaining bund
      const dx0 = o0[0] - tCfg.centerX;
      const dz0 = o0[1] - tCfg.centerZ;
      const dl0 = Math.hypot(dx0, dz0) || 1;
      const dx1 = o1[0] - tCfg.centerX;
      const dz1 = o1[1] - tCfg.centerZ;
      const dl1 = Math.hypot(dx1, dz1) || 1;
      const ux0 = dx0 / dl0, uz0 = dz0 / dl0;
      const ux1 = dx1 / dl1, uz1 = dz1 / dl1;

      const crown0x = o0[0] + ux0 * (bundWidth * 0.48), crown0z = o0[1] + uz0 * (bundWidth * 0.48);
      const crown1x = o1[0] + ux1 * (bundWidth * 0.48), crown1z = o1[1] + uz1 * (bundWidth * 0.48);
      const b0x = o0[0] + ux0 * bundWidth, b0z = o0[1] + uz0 * bundWidth;
      const b1x = o1[0] + ux1 * bundWidth, b1z = o1[1] + uz1 * bundWidth;
      const foot0Y = Math.min(waterY - 0.28, surface(b0x, b0z) - 0.16);
      const foot1Y = Math.min(waterY - 0.28, surface(b1x, b1z) - 0.16);
      const midWall0Y = lerp(bundTopY - 0.02, foot0Y, 0.46);
      const midWall1Y = lerp(bundTopY - 0.02, foot1Y, 0.46);

      // Cambered grassy bund walkway (inner water bevel + outer crown)
      baker.withTag('terrace-bund-grass', () => {
        baker.addQuad(
          'ground',
          [o0[0], waterY + 0.015, o0[1]],
          [crown0x, bundTopY + 0.02, crown0z],
          [crown1x, bundTopY + 0.02, crown1z],
          [o1[0], waterY + 0.015, o1[1]],
          s % 2 === 0 ? pal.mossBright : pal.moss
        );
        baker.addQuad(
          'ground',
          [crown0x, bundTopY + 0.02, crown0z],
          [b0x, bundTopY - 0.02, b0z],
          [b1x, bundTopY - 0.02, b1z],
          [crown1x, bundTopY + 0.02, crown1z],
          s % 2 === 0 ? pal.moss : pal.pathEdge
        );
      });

      // Two-course battered dry-stone retaining face + protruding cap stones
      baker.addQuad(
        'solid',
        [b0x, bundTopY - 0.02, b0z],
        [b0x + ux0 * 0.12, midWall0Y, b0z + uz0 * 0.12],
        [b1x + ux1 * 0.12, midWall1Y, b1z + uz1 * 0.12],
        [b1x, bundTopY - 0.02, b1z],
        s % 2 === 0 ? pal.stoneLight : pal.stone
      );
      baker.addQuad(
        'solid',
        [b0x + ux0 * 0.12, midWall0Y, b0z + uz0 * 0.12],
        [b0x + ux0 * 0.30, foot0Y, b0z + uz0 * 0.30],
        [b1x + ux1 * 0.30, foot1Y, b1z + uz1 * 0.30],
        [b1x + ux1 * 0.12, midWall1Y, b1z + uz1 * 0.12],
        s % 2 === 0 ? pal.stoneDark : '#597469'
      );
      if (s % 2 === 0) {
        const capX = (b0x + b1x) * 0.5;
        const capZ = (b0z + b1z) * 0.5;
        const capYaw = Math.atan2(b1x - b0x, b1z - b0z);
        baker.addBox('solid', capX, bundTopY - 0.03, capZ, 0.32, 0.09, 0.52, capYaw, pal.flagstone, pal.stoneDark);
      }

      const midBx = (b0x + b1x) * 0.5;
      const midBz = (b0z + b1z) * 0.5;
      const groundAtBund = surface(midBx, midBz);
      if (bundTopY - groundAtBund > 0.50) {
        const segDx = b1x - b0x;
        const segDz = b1z - b0z;
        const segL = Math.hypot(segDx, segDz);
        blockers.push({
          x: (o0[0] + o1[0] + b0x + b1x) * 0.25,
          z: (o0[1] + o1[1] + b0z + b1z) * 0.25,
          hw: segL * 0.52,
          hd: 0.55,
          rot: Math.atan2(segDz, segDx),
          minY: groundAtBund - 0.2,
          maxY: bundTopY + 0.9,
          source: 'terrace-bund-' + tier.index
        });
      }
    }

    // Faceted stone-and-moss end closure abutments at left/right ends of each crescent
    for (let eIdx = 0; eIdx < 2; eIdx++) {
      const iPt = eIdx === 0 ? arcPtsInner[0] : arcPtsInner[segs];
      const oPt = eIdx === 0 ? arcPtsOuter[0] : arcPtsOuter[segs];
      for (let k = 0; k < 3; k++) {
        const t = (k + 0.5) / 3;
        const rx = lerp(iPt[0], oPt[0], t);
        const rz = lerp(iPt[1], oPt[1], t);
        const gY = Math.min(waterY - 0.25, surface(rx, rz) - 0.16);
        const h = Math.max(0.36, bundTopY - gY + 0.06);
        baker.addFacetedRock('solid', rx, gY + h * 0.5, rz, 0.62, h, 0.72, k * 0.7 + eIdx, tier.index * 19 + k * 5 + eIdx, rockPalOpts);
      }
    }

    for (let s = 0; s <= segs; s += 2) {
      const mx = (arcPtsInner[s][0] + arcPtsOuter[s][0]) * 0.5;
      const mz = (arcPtsInner[s][1] + arcPtsOuter[s][1]) * 0.5;
      res.circles.push({ x: mx, z: mz, r: (tier.rOuter - tier.rInner) * 0.58, source: 'vb-terrace' });
    }

    builtTerraces.push({
      index: tier.index,
      waterY,
      bundTopY,
      inner: arcPtsInner,
      outer: arcPtsOuter
    });
  }

  // Carved stone & bamboo irrigation spillways ('梯田竹石水口') cascading from upper to lower tiers
  for (let ti = builtTerraces.length - 1; ti >= 1; ti--) {
    const upper = builtTerraces[ti];
    const lower = builtTerraces[ti - 1];
    const sIdx = 5 + ((ti * 3) % 8);
    const uPt = upper.outer[sIdx];
    const dx = uPt[0] - tCfg.centerX;
    const dz = uPt[1] - tCfg.centerZ;
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    const tx = -uz, tz = ux;
    const spoutX = uPt[0] + ux * 0.92;
    const spoutZ = uPt[1] + uz * 0.92;
    // Flanking sluice stones + split-bamboo water spout + falling white foam ribbon
    for (const s of [-1, 1]) {
      baker.addFacetedRock('solid', uPt[0] + ux * 0.45 + tx * s * 0.32, upper.waterY + 0.06, uPt[1] + uz * 0.45 + tz * s * 0.32, 0.22, 0.24, 0.22, ti + s, ti * 41 + s, rockPalOpts);
    }
    baker.addBeam('solid', [uPt[0] + ux * 0.15, upper.waterY + 0.03, uPt[1] + uz * 0.15], [spoutX, upper.waterY - 0.03, spoutZ], 0.065, 0.058, 5, pal.bambooDry, pal.bamboo, false);
    baker.addQuad(
      'water',
      [spoutX - tx * 0.09, upper.waterY - 0.02, spoutZ - tz * 0.09],
      [spoutX + tx * 0.09, upper.waterY - 0.02, spoutZ + tz * 0.09],
      [spoutX + ux * 0.22 + tx * 0.14, lower.waterY + 0.02, spoutZ + uz * 0.22 + tz * 0.14],
      [spoutX + ux * 0.22 - tx * 0.14, lower.waterY + 0.02, spoutZ + uz * 0.22 - tz * 0.14],
      pal.waterFoam,
      0.05
    );
  }

  if (builtTerraces.length > 0) {
    const t0 = builtTerraces[0];
    const midIdx = Math.floor(t0.outer.length * 0.55);
    const tx = (t0.inner[midIdx][0] + t0.outer[midIdx][0]) * 0.5;
    const tz = (t0.inner[midIdx][1] + t0.outer[midIdx][1]) * 0.5;
    targets.push({ id: 'cloud-terraces', x: tx, y: t0.waterY + 0.25, z: tz, range: 9.5 });
  }

  // ============================================================================
  // 3. 北涧三叠飞泉、斧劈崖壁、碧玉潭、观瀑台、清渠与青石拱桥
  // ============================================================================
  const wf = cfg.landmarks.waterfall;
  const poolGroundY = surface(wf.poolX, wf.poolZ);
  const poolWaterY = poolGroundY + 0.28;
  const poolR = wf.poolRadius || 5.4;

  // Concentric multi-tone plunge pool (deep jade center + celadon middle + foam ring under falls)
  const poolSegs = 18;
  for (let i = 0; i < poolSegs; i++) {
    const a0 = (i / poolSegs) * TAU;
    const a1 = ((i + 1) / poolSegs) * TAU;
    const rOuter0 = poolR * (0.92 + 0.08 * Math.sin(i * 2.3));
    const rOuter1 = poolR * (0.92 + 0.08 * Math.sin((i + 1) * 2.3));
    const rInner0 = rOuter0 * 0.52;
    const rInner1 = rOuter1 * 0.52;
    const ix0 = wf.poolX + Math.cos(a0) * rInner0, iz0 = wf.poolZ + Math.sin(a0) * rInner0;
    const ix1 = wf.poolX + Math.cos(a1) * rInner1, iz1 = wf.poolZ + Math.sin(a1) * rInner1;
    const ox0 = wf.poolX + Math.cos(a0) * rOuter0, oz0 = wf.poolZ + Math.sin(a0) * rOuter0;
    const ox1 = wf.poolX + Math.cos(a1) * rOuter1, oz1 = wf.poolZ + Math.sin(a1) * rOuter1;

    baker.addTri('water', wf.poolX, poolWaterY, wf.poolZ, ix1, poolWaterY, iz1, ix0, poolWaterY, iz0, i % 2 === 0 ? '#4E7D73' : '#538379');
    baker.addQuad('water', [ix0, poolWaterY, iz0], [ix1, poolWaterY, iz1], [ox1, poolWaterY, oz1], [ox0, poolWaterY, oz0], i % 2 === 0 ? '#6A9B8F' : '#71A195');

    // Grounded mossy bluestone embankment wall sealing the hillside pool lip (open only at south brook outlet)
    const midA = (a0 + a1) * 0.5;
    const isBrookOutlet = Math.sin(midA) > 0.90 && Math.abs(Math.cos(midA)) < 0.34;
    if (!isBrookOutlet) {
      const botY0 = Math.min(poolWaterY - 0.16, surface(ox0, oz0) - 0.34);
      const botY1 = Math.min(poolWaterY - 0.16, surface(ox1, oz1) - 0.34);
      const topY = poolWaterY + 0.04;
      baker.addQuad(
        'solid',
        [ox0, topY, oz0],
        [ox1, topY, oz1],
        [ox1, botY1, oz1],
        [ox0, botY0, oz0],
        i % 2 === 0 ? pal.stone : pal.stoneDark
      );
      const bx = wf.poolX + Math.cos(midA) * (rOuter0 + 0.28);
      const bz = wf.poolZ + Math.sin(midA) * (rOuter0 + 0.28);
      const by = Math.min(poolWaterY - 0.20, surface(bx, bz) - 0.18);
      const bh = 0.54 + (i % 3) * 0.24;
      baker.addFacetedRock('solid', bx, by + bh * 0.46, bz, 0.66 + (i % 2) * 0.16, bh, 0.54, midA, 500 + i * 13, {
        ...rockPalOpts,
        sides: 6,
        hasMoss: i % 3 !== 2
      });
    }
  }
  // White-water plunge foam ring where the 3rd cascade hits the pool
  const plungeCx = wf.poolX, plungeCz = wf.poolZ - 2.15;
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * TAU, a1 = ((i + 1) / 10) * TAU;
    const rIn = 0.55, rOut = 1.65 + (i % 2) * 0.22;
    baker.addQuad(
      'water',
      [plungeCx + Math.cos(a0) * rIn, poolWaterY + 0.025, plungeCz + Math.sin(a0) * rIn],
      [plungeCx + Math.cos(a1) * rIn, poolWaterY + 0.025, plungeCz + Math.sin(a1) * rIn],
      [plungeCx + Math.cos(a1) * rOut, poolWaterY + 0.012, plungeCz + Math.sin(a1) * rOut],
      [plungeCx + Math.cos(a0) * rOut, poolWaterY + 0.012, plungeCz + Math.sin(a0) * rOut],
      i % 2 === 0 ? pal.waterFoam : '#CBE4DC',
      0.04
    );
  }

  res.circles.push({ x: wf.poolX, z: wf.poolZ, r: poolR + 1.2, source: 'vb-pool' });
  blockers.push({ x: wf.poolX, z: wf.poolZ - 1.2, hw: poolR * 0.78, hd: poolR * 0.65, rot: 0, minY: poolGroundY - 0.5, maxY: poolWaterY + 3.0, source: 'vb-waterfall-pool' });

  // Monumental Song-Yuan axe-cut cliff canyon & 3 stepped rock cascade ledges (zero BoxGeometry!)
  const cliffMassifs = [
    // Flanking west canyon crags (tall rear -> stepped foreground spurs)
    { x: wf.topX - 3.9, z: wf.topZ + 1.2, rx: 2.3, sy: 8.6, rz: 2.4, yaw: 0.24, moss: true },
    { x: wf.topX - 4.8, z: wf.topZ + 4.0, rx: 2.2, sy: 6.8, rz: 2.3, yaw: 0.52, moss: true },
    { x: wf.topX - 5.8, z: wf.topZ + 6.9, rx: 1.9, sy: 4.8, rz: 2.0, yaw: 0.38, moss: true },
    { x: wf.topX - 3.1, z: wf.topZ + 6.6, rx: 1.5, sy: 3.4, rz: 1.6, yaw: 0.85, moss: false },
    // Flanking east canyon crags
    { x: wf.topX + 4.0, z: wf.topZ + 1.1, rx: 2.4, sy: 8.9, rz: 2.5, yaw: -0.28, moss: true },
    { x: wf.topX + 4.9, z: wf.topZ + 3.9, rx: 2.2, sy: 7.0, rz: 2.3, yaw: -0.48, moss: true },
    { x: wf.topX + 5.7, z: wf.topZ + 6.7, rx: 1.9, sy: 5.0, rz: 2.0, yaw: -0.35, moss: true },
    { x: wf.topX + 3.0, z: wf.topZ + 6.5, rx: 1.5, sy: 3.5, rz: 1.6, yaw: -0.78, moss: false },
    // Rear headwall & 3 stepped rocky cascade thresholds (recessed cleanly behind waterfall ribbons)
    { x: wf.topX - 1.6, z: wf.topZ - 1.5, rx: 2.4, sy: 8.8, rz: 1.9, yaw: 0.12, moss: true },
    { x: wf.topX + 1.6, z: wf.topZ - 1.5, rx: 2.4, sy: 8.8, rz: 1.9, yaw: -0.14, moss: true },
    { x: wf.topX, z: wf.topZ + 1.25, rx: 2.3, sy: 6.0, rz: 1.55, yaw: -0.04, moss: false },
    { x: wf.topX - 0.1, z: wf.topZ + 4.15, rx: 2.1, sy: 4.0, rz: 1.55, yaw: 0.03, moss: false },
    { x: wf.topX - 0.15, z: wf.topZ + 6.85, rx: 1.9, sy: 2.1, rz: 1.35, yaw: -0.02, moss: false }
  ];
  for (let i = 0; i < cliffMassifs.length; i++) {
    const cm = cliffMassifs[i];
    const base = Math.min(poolGroundY, surface(cm.x, cm.z)) - 0.55;
    baker.addFacetedRock('solid', cm.x, base + cm.sy * 0.5, cm.z, cm.rx, cm.sy, cm.rz, cm.yaw, 700 + i * 23, {
      ...rockPalOpts,
      sides: 7,
      hasMoss: cm.moss,
      mossTag: cm.moss ? 'frost-cliff-cap' : null
    });
    blockers.push({ x: cm.x, z: cm.z, hw: cm.rx * 0.78, hd: cm.rz * 0.78, rot: cm.yaw, minY: base, maxY: base + cm.sy + 0.4, source: 'vb-cascade-cliff-' + i });
    res.circles.push({ x: cm.x, z: cm.z, r: Math.max(cm.rx, cm.rz) * 1.15, source: 'vb-cascade-cliff' });
  }

  // Multi-ribbon 3-tier waterfall sheets (celadon core + bright white foam crests + intermediate ledge basins, outward +Y/+Z winding!)
  const cascadeTopBase = Math.min(poolGroundY, surface(wf.topX, wf.topZ)) - 0.45;
  const cascadeLedges = [
    { x0: wf.topX, y0: cascadeTopBase + 7.75, z0: wf.topZ + 1.10, x1: wf.topX - 0.04, y1: cascadeTopBase + 5.82, z1: wf.topZ + 3.25, w: 1.75 },
    { x0: wf.topX - 0.04, y0: cascadeTopBase + 5.80, z0: wf.topZ + 3.35, x1: wf.topX - 0.10, y1: cascadeTopBase + 3.82, z1: wf.topZ + 6.10, w: 2.05 },
    { x0: wf.topX - 0.10, y0: cascadeTopBase + 3.80, z0: wf.topZ + 6.18, x1: wf.poolX, y1: poolWaterY + 0.04, z1: wf.poolZ - 2.15, w: 2.38 }
  ];
  for (let ci = 0; ci < cascadeLedges.length; ci++) {
    const cl = cascadeLedges[ci];
    const hw0 = cl.w * 0.5;
    const hw1 = cl.w * 0.58;
    const midX = (cl.x0 + cl.x1) * 0.5;
    const midY = lerp(cl.y0, cl.y1, 0.36) + 0.16;
    const midZ = lerp(cl.z0, cl.z1, 0.52);

    // Upper lip curve -> lower plunge sheet (outward-facing +Y/+Z winding!)
    baker.addQuad('water', [cl.x0 - hw0, cl.y0, cl.z0], [midX - hw0 * 1.05, midY, midZ], [midX + hw0 * 1.05, midY, midZ], [cl.x0 + hw0, cl.y0, cl.z0], '#98CBC0', 0.04);
    baker.addQuad('water', [midX - hw0 * 1.05, midY, midZ], [cl.x1 - hw1, cl.y1, cl.z1], [cl.x1 + hw1, cl.y1, cl.z1], [midX + hw0 * 1.05, midY, midZ], '#B4DCD3', 0.05);
    // Raised central white-water foam crest ribbon (+0.05 forward clearance prevents z-fighting)
    baker.addQuad('water', [cl.x0 - hw0 * 0.44, cl.y0 + 0.04, cl.z0 + 0.05], [midX - hw0 * 0.50, midY + 0.04, midZ + 0.06], [midX + hw0 * 0.50, midY + 0.04, midZ + 0.06], [cl.x0 + hw0 * 0.44, cl.y0 + 0.04, cl.z0 + 0.05], pal.waterFoam, 0.07);
    baker.addQuad('water', [midX - hw0 * 0.50, midY + 0.04, midZ + 0.06], [cl.x1 - hw1 * 0.56, cl.y1 + 0.04, cl.z1 + 0.06], [cl.x1 + hw1 * 0.56, cl.y1 + 0.04, cl.z1 + 0.06], [midX + hw0 * 0.50, midY + 0.04, midZ + 0.06], pal.waterFoam, 0.07);

    // Horizontal intermediate splash shelf pool on tiers 0 & 1 (nested cleanly within waterfall ribbon width)
    if (ci < 2) {
      baker.addCylinder('water', cl.x1, cl.y1 + 0.02, cl.z1 - 0.02, hw1 * 0.92, hw1 * 0.84, 0.07, 8, 0, pal.waterFoam, pal.water);
    }
  }

  // Octagonal bluestone cascade-viewing terrace ('观瀑石台' at 20.2, -242.0) with stone curb, 2 drum stools & low rail
  const vpX = 20.2, vpZ = -242.0;
  const vpY = surface(vpX, vpZ);
  baker.addCylinder('solid', vpX, vpY - 0.14, vpZ, 2.02, 2.22, 0.36, 8, Math.PI / 8, pal.stone, pal.stoneDark);
  baker.addCylinder('ground', vpX, vpY + 0.045, vpZ, 1.92, 1.98, 0.04, 8, Math.PI / 8, pal.flagstone, pal.stone);
  baker.addHollowCylinder('solid', vpX, vpY + 0.08, vpZ, 2.02, 1.80, 0.07, 8, Math.PI / 8, pal.stoneLight, pal.stoneDark);
  // Two carved stone drum stools on west edge of viewing platform + low north viewing rail
  for (const [ox, oz] of [[-1.08, -0.35], [-0.95, 0.68]]) {
    baker.addCylinder('solid', vpX + ox, vpY + 0.24, vpZ + oz, 0.23, 0.20, 0.36, 7, 0, pal.stoneLight, pal.stoneDark);
  }
  const railA0 = [vpX + 0.45, vpY + 0.06, vpZ - 1.62];
  const railA1 = [vpX + 1.58, vpY + 0.06, vpZ - 0.68];
  baker.addCylinder('solid', railA0[0], vpY + 0.28, railA0[2], 0.07, 0.08, 0.48, 6, 0, pal.stone, pal.stoneDark);
  baker.addCylinder('solid', railA1[0], vpY + 0.28, railA1[2], 0.07, 0.08, 0.48, 6, 0, pal.stone, pal.stoneDark);
  baker.addBeam('solid', [railA0[0], vpY + 0.46, railA0[2]], [railA1[0], vpY + 0.46, railA1[2]], 0.048, 0.048, 5, pal.timber, pal.timberDark);
  targets.push({ id: 'mountain-cascade', x: wf.poolX, y: poolWaterY + 2.2, z: wf.poolZ - 2.8, range: 16.0 });

  // Sunken 3-band stone-lined clear brook ('北涧清渠') tapering smoothly downhill across foothill trails into Block 6 rice paddies
  const brookPts = smoothPolyline(cfg.brook.points, 3);
  const brookBaseHalf = (cfg.brook.width || 1.85) * 0.5;
  const brBridgeGroundY = surface(cfg.landmarks.stoneBridge.x, cfg.landmarks.stoneBridge.z);
  const fieldLift = res.world?.village?.fields?.lift ?? 0.05;
  const paddyWaterY = surface(53.7, -208.8) + fieldLift + 0.036;
  const basinX = 49.4;
  const basinZ = -206.5;
  const basinWaterY = paddyWaterY + 0.016;
  const uoBrX = 33.77;
  const uoBrZ = -212.0;
  const qwBrX = 48.0;
  const qwBrZ = -206.6;

  // Cumulative arc-length fraction u in [0, 1] and averaged perpendicular vertex normals (zero corner cracks at bends)
  const nBrook = brookPts.length;
  const brookArc = [0];
  for (let i = 1; i < nBrook; i++) {
    brookArc.push(brookArc[i - 1] + Math.hypot(brookPts[i][0] - brookPts[i - 1][0], brookPts[i][1] - brookPts[i - 1][1]));
  }
  const brookTotalLen = Math.max(1e-4, brookArc[nBrook - 1]);
  const brookU = brookArc.map(d => d / brookTotalLen);
  const brookVnx = [];
  const brookVnz = [];
  const brookHalfW = [];
  const brookYs = [];

  const halfAt = (u) => {
    if (u <= 0.42) return lerp(brookBaseHalf * 1.02, brookBaseHalf * 0.90, u / 0.42);
    if (u <= 0.62) return lerp(brookBaseHalf * 0.90, brookBaseHalf * 0.66, (u - 0.42) / 0.20);
    return lerp(brookBaseHalf * 0.66, 0.36, (u - 0.62) / 0.38);
  };

  for (let i = 0; i < nBrook; i++) {
    const pPrev = brookPts[Math.max(0, i - 1)];
    const pNext = brookPts[Math.min(nBrook - 1, i + 1)];
    const tdx = pNext[0] - pPrev[0];
    const tdz = pNext[1] - pPrev[1];
    const tlen = Math.hypot(tdx, tdz) || 1;
    const sx = -tdz / tlen;
    const sz = tdx / tlen;
    brookVnx.push(sx);
    brookVnz.push(sz);

    const hw = halfAt(brookU[i]);
    brookHalfW.push(hw);

    const px = brookPts[i][0];
    const pz = brookPts[i][1];
    const yMid = surface(px, pz);
    const yL = surface(px + sx * hw * 0.78, pz + sz * hw * 0.78);
    const yR = surface(px - sx * hw * 0.78, pz - sz * hw * 0.78);
    let yGorge = Math.max(yMid, Math.min(yMid + 0.16, Math.max(yL, yR))) + 0.088;
    if (Math.hypot(px - cfg.landmarks.stoneBridge.x, pz - cfg.landmarks.stoneBridge.z) < 2.4) {
      yGorge = Math.min(yGorge, brBridgeGroundY + 0.052);
    }
    const lowerT = clamp((brookU[i] - 0.46) / 0.54, 0, 1);
    const yCanal = Math.max(yMid + 0.055, lerp(brBridgeGroundY + 0.050, basinWaterY, lowerT));
    const blend = clamp((brookU[i] - 0.42) / 0.14, 0, 1);
    brookYs.push(lerp(yGorge, yCanal, blend));
  }
  for (let i = 1; i < nBrook; i++) {
    brookYs[i] = Math.max(surface(brookPts[i][0], brookPts[i][1]) + 0.052, Math.min(brookYs[i - 1], brookYs[i]));
  }

  let uoWaterY = brookYs[Math.min(nBrook - 1, Math.floor(nBrook * 0.55))];
  let qwWaterY = basinWaterY + 0.004;
  for (let i = 0; i < nBrook - 1; i++) {
    const a = brookPts[i];
    const b = brookPts[i + 1];
    if ((a[1] <= uoBrZ && b[1] >= uoBrZ) || (a[1] >= uoBrZ && b[1] <= uoBrZ)) {
      const f = clamp((uoBrZ - a[1]) / ((b[1] - a[1]) || 1), 0, 1);
      uoWaterY = lerp(brookYs[i], brookYs[i + 1], f);
    }
    if ((a[0] <= qwBrX && b[0] >= qwBrX) || (a[0] >= qwBrX && b[0] <= qwBrX)) {
      const f = clamp((qwBrX - a[0]) / ((b[0] - a[0]) || 1), 0, 1);
      qwWaterY = lerp(brookYs[i], brookYs[i + 1], f);
    }
  }

  const nearAnyBridge = (px, pz) =>
    Math.hypot(px - wf.poolX, pz - wf.poolZ) < poolR * 0.72 ||
    Math.hypot(px - cfg.landmarks.stoneBridge.x, pz - cfg.landmarks.stoneBridge.z) < 1.35 ||
    Math.hypot(px - uoBrX, pz - uoBrZ) < 1.05 ||
    Math.hypot(px - qwBrX, pz - qwBrZ) < 0.85;

  for (let i = 0; i < nBrook - 1; i++) {
    const a = brookPts[i];
    const b = brookPts[i + 1];
    const nxa = brookVnx[i], nza = brookVnz[i];
    const nxb = brookVnx[i + 1], nzb = brookVnz[i + 1];
    const hwa = brookHalfW[i], hwb = brookHalfW[i + 1];
    const coreA = hwa * 0.46, coreB = hwb * 0.46;
    const ya = brookYs[i], yb = brookYs[i + 1];
    const ua = brookU[i], ub = brookU[i + 1];

    // Deep celadon channel center + shallow shore margins (+Y upward winding)
    baker.addQuad(
      'water',
      [a[0] + nxa * coreA, ya + 0.006, a[1] + nza * coreA],
      [b[0] + nxb * coreB, yb + 0.006, b[1] + nzb * coreB],
      [b[0] - nxb * coreB, yb + 0.006, b[1] - nzb * coreB],
      [a[0] - nxa * coreA, ya + 0.006, a[1] - nza * coreA],
      '#4F7E74',
      Math.sin(i * 0.55) * 0.015
    );
    for (const s of [-1, 1]) {
      const pInA = [a[0] + nxa * coreA * s, ya + 0.006, a[1] + nza * coreA * s];
      const pOutA = [a[0] + nxa * hwa * s, ya, a[1] + nza * hwa * s];
      const pOutB = [b[0] + nxb * hwb * s, yb, b[1] + nzb * hwb * s];
      const pInB = [b[0] + nxb * coreB * s, yb + 0.006, b[1] + nzb * coreB * s];
      if (s > 0) baker.addQuad('water', pOutA, pOutB, pInB, pInA, pal.water);
      else baker.addQuad('water', pInA, pInB, pOutB, pOutA, pal.water);

      const segMx = (a[0] + b[0]) * 0.5;
      const segMz = (a[1] + b[1]) * 0.5;
      if (nearAnyBridge(segMx, segMz)) continue;

      // Harmonious weathered riverstone inner wall + grounded mossy embankment (no checkerboard striping)
      const bankWa = 0.22 - ua * 0.04;
      const bankWb = 0.22 - ub * 0.04;
      const bTopAx = a[0] + nxa * (hwa + bankWa) * s, bTopAz = a[1] + nza * (hwa + bankWa) * s;
      const bTopBx = b[0] + nxb * (hwb + bankWb) * s, bTopBz = b[1] + nzb * (hwb + bankWb) * s;
      const bankTopA = [bTopAx, ya + 0.095, bTopAz];
      const bankTopB = [bTopBx, yb + 0.095, bTopBz];

      const liftOverSurfA = Math.max(0, ya - surface(bTopAx, bTopAz));
      const liftOverSurfB = Math.max(0, yb - surface(bTopBx, bTopBz));
      const vergeWa = bankWa + 0.38 + liftOverSurfA * 1.45;
      const vergeWb = bankWb + 0.38 + liftOverSurfB * 1.45;
      const vxA = a[0] + nxa * (hwa + vergeWa) * s, vzA = a[1] + nza * (hwa + vergeWa) * s;
      const vxB = b[0] + nxb * (hwb + vergeWb) * s, vzB = b[1] + nzb * (hwb + vergeWb) * s;
      const vergeA = [vxA, Math.min(ya + 0.02, surface(vxA, vzA) - 0.06), vzA];
      const vergeB = [vxB, Math.min(yb + 0.02, surface(vxB, vzB) - 0.06), vzB];
      const bankJit = Math.sin(i * 0.7 + s) * 0.022;

      if (s > 0) {
        baker.addQuad('solid', bankTopA, bankTopB, pOutB, pOutA, '#7B847A', bankJit);
        baker.withTag('terrace-bund-grass', () => {
          baker.addQuad('ground', vergeA, vergeB, bankTopB, bankTopA, pal.moss, bankJit * 0.6);
        });
      } else {
        baker.addQuad('solid', pOutA, pOutB, bankTopB, bankTopA, '#7B847A', bankJit);
        baker.withTag('terrace-bund-grass', () => {
          baker.addQuad('ground', bankTopA, bankTopB, vergeB, vergeA, pal.moss, bankJit * 0.6);
        });
      }
    }

    // Smooth sinusoidal current shimmer ribbon (replaces harsh zigzag)
    const threadOffA = Math.sin(ua * Math.PI * 5.5) * coreA * 0.42;
    const threadOffB = Math.sin(ub * Math.PI * 5.5) * coreB * 0.42;
    const twA = 0.056 * (1 - ua * 0.42);
    const twB = 0.056 * (1 - ub * 0.42);
    baker.addQuad(
      'water',
      [a[0] + nxa * (threadOffA + twA), ya + 0.012, a[1] + nza * (threadOffA + twA)],
      [b[0] + nxb * (threadOffB + twB), yb + 0.012, b[1] + nzb * (threadOffB + twB)],
      [b[0] + nxb * (threadOffB - twB), yb + 0.012, b[1] + nzb * (threadOffB - twB)],
      [a[0] + nxa * (threadOffA - twA), ya + 0.012, a[1] + nza * (threadOffA - twA)],
      '#C2E3DA',
      0.03
    );

    // Sparse asymmetric riverside boulders & meadow bank sedge tufts (avoid all bridge spans & diversion weir)
    const dirYaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    if (i >= 1 && i < nBrook - 3 && (i % 3 === 1 || i === 13)) {
      const s = i % 2 === 0 ? 1 : -1;
      const sx = a[0] + nxa * (hwa + 0.24) * s;
      const sz = a[1] + nza * (hwa + 0.24) * s;
      if (!nearAnyBridge(sx, sz) && Math.hypot(sx - basinX, sz - basinZ) > 1.8) {
        const sc = ua < 0.45 ? 1.0 : 0.78;
        baker.addFacetedRock('solid', sx, Math.max(ya, surface(sx, sz)) + 0.03, sz, 0.24 * sc, 0.20 * sc, 0.21 * sc, dirYaw + s * 0.45, 900 + i * 11, {
          ...rockPalOpts,
          sides: ua < 0.45 ? 5 : 4,
          hasMoss: i % 2 === 1
        });
      }
    }
    if (ua > 0.50 && ua < 0.92 && i % 3 === 2) {
      const s = i % 2 === 0 ? -1 : 1;
      const tx = a[0] + nxa * (hwa + 0.26) * s;
      const tz = a[1] + nza * (hwa + 0.26) * s;
      if (!nearAnyBridge(tx, tz) && Math.hypot(tx - basinX, tz - basinZ) > 1.7) {
        const ty = ya + 0.06;
        for (let k = 0; k < 3; k++) {
          const ang = dirYaw + k * 2.1 + s * 0.5;
          const tipX = tx + Math.cos(ang) * 0.14;
          const tipZ = tz + Math.sin(ang) * 0.14;
          const wX = -Math.sin(ang) * 0.045;
          const wZ = Math.cos(ang) * 0.045;
          const bladeCol = k % 2 === 0 ? '#5D8652' : '#74995E';
          baker.addTri('solid', tx - wX, ty, tz - wZ, tx + wX, ty, tz + wZ, tipX, ty + 0.28 + (k % 2) * 0.07, tipZ, bladeCol, 0.02);
        }
      }
    }
  }
  res.corridors.push({ points: brookPts, half: brookBaseHalf * 0.85, source: 'vb-brook' });

  // Road Bridge 1: 上果园木石平桥 (Timber-and-stone culvert bridge carrying upper-orchard across brook at 33.77, -212.0)
  {
    const uoSurf = surface(uoBrX, uoBrZ);
    const uoDeckY = Math.max(uoSurf + 0.17, uoWaterY + 0.11);
    const abHalfSpan = 1.02;
    const deckHalfLen = 1.25;
    const deckW = 1.80;
    for (const side of [-1, 1]) {
      const ax = uoBrX + side * abHalfSpan;
      const footY = surface(ax, uoBrZ) - 0.14;
      const abH = Math.max(0.32, uoDeckY - 0.06 - footY);
      baker.addBox('solid', ax, footY + abH * 0.5, uoBrZ, 0.52, abH, deckW + 0.24, 0, pal.stone, pal.stoneDark);
    }
    const plankStep = (deckHalfLen * 2) / 5;
    for (let pi = 0; pi < 5; pi++) {
      const px = uoBrX - deckHalfLen + (pi + 0.5) * plankStep;
      baker.addBox('solid', px, uoDeckY - 0.045, uoBrZ, plankStep * 0.90, 0.09, deckW, 0, pi % 2 === 0 ? '#8A6E4E' : pal.timber, pal.timberDark);
    }
    for (const czSide of [-1, 1]) {
      const cz = uoBrZ + czSide * (deckW * 0.5 + 0.04);
      baker.addBox('solid', uoBrX, uoDeckY + 0.02, cz, deckHalfLen * 1.94, 0.09, 0.12, 0, pal.stone, pal.stoneDark);
      for (const endS of [-1, 1]) {
        const bx = uoBrX + endS * (deckHalfLen - 0.08);
        baker.addBox('solid', bx, uoDeckY + 0.12, cz, 0.14, 0.28, 0.14, 0, pal.stoneLight, pal.stoneDark);
      }
    }
    const rampHW = 0.76;
    const rz0 = uoBrZ - rampHW;
    const rz1 = uoBrZ + rampHW;
    const wFootX = uoBrX - 2.35;
    const wDeckX = uoBrX - deckHalfLen;
    const eDeckX = uoBrX + deckHalfLen;
    const eFootX = uoBrX + 2.15;
    const uoRoadHex = '#BDB28E';
    for (let s = 0; s < 3; s++) {
      const t0 = s / 3;
      const t1 = (s + 1) / 3;
      const wx0 = lerp(wFootX, wDeckX, t0), wx1 = lerp(wFootX, wDeckX, t1);
      const wy0 = lerp(surface(wx0, uoBrZ) + 0.068, uoDeckY, t0 * t0 * (3 - 2 * t0));
      const wy1 = lerp(surface(wx1, uoBrZ) + 0.068, uoDeckY, t1 * t1 * (3 - 2 * t1));
      const wb0 = Math.min(wy0, surface(wx0, uoBrZ) - 0.04);
      const wb1 = Math.min(wy1, surface(wx1, uoBrZ) - 0.04);
      baker.withTag('vb-road', () => {
        baker.addQuad('ground', [wx0, wy0, rz0], [wx0, wy0, rz1], [wx1, wy1, rz1], [wx1, wy1, rz0], uoRoadHex, 0.005);
      });
      baker.withTag('terrace-bund-grass', () => {
        baker.addQuad('ground', [wx0, wb0, rz1], [wx1, wb1, rz1], [wx1, wy1, rz1], [wx0, wy0, rz1], pal.moss);
        baker.addQuad('ground', [wx1, wb1, rz0], [wx0, wb0, rz0], [wx0, wy0, rz0], [wx1, wy1, rz0], pal.moss);
      });

      const ex0 = lerp(eDeckX, eFootX, t0), ex1 = lerp(eDeckX, eFootX, t1);
      const ey0 = lerp(uoDeckY, surface(ex0, uoBrZ) + 0.068, t0 * t0 * (3 - 2 * t0));
      const ey1 = lerp(uoDeckY, surface(ex1, uoBrZ) + 0.068, t1 * t1 * (3 - 2 * t1));
      const eb0 = Math.min(ey0, surface(ex0, uoBrZ) - 0.04);
      const eb1 = Math.min(ey1, surface(ex1, uoBrZ) - 0.04);
      baker.withTag('vb-road', () => {
        baker.addQuad('ground', [ex0, ey0, rz0], [ex0, ey0, rz1], [ex1, ey1, rz1], [ex1, ey1, rz0], uoRoadHex, 0.005);
      });
      baker.withTag('terrace-bund-grass', () => {
        baker.addQuad('ground', [ex0, eb0, rz1], [ex1, eb1, rz1], [ex1, ey1, rz1], [ex0, ey0, rz1], pal.moss);
        baker.addQuad('ground', [ex1, eb1, rz0], [ex0, eb0, rz0], [ex0, ey0, rz0], [ex1, ey1, rz0], pal.moss);
      });
    }
    res.circles.push({ x: uoBrX, z: uoBrZ, r: 2.5, source: 'vb-brook-bridge-1' });
  }

  // Road Bridge 2: 阡陌西路石板过水桥 (Dressed bluestone slab bridge carrying qian-west over brook at 48.0, -206.6)
  {
    const qwSurf = surface(qwBrX, qwBrZ);
    const qwDeckY = qwWaterY + 0.082;
    const sillOff = 0.56;
    const slabHalfSpan = 0.62;
    const slabW = 1.56;
    for (const side of [-1, 1]) {
      const az = qwBrZ + side * sillOff;
      const footY = surface(qwBrX, az) - 0.14;
      const abH = Math.max(0.28, qwDeckY - 0.05 - footY);
      baker.addBox('solid', qwBrX, footY + abH * 0.5, az, slabW + 0.14, abH, 0.34, 0, pal.stone, pal.stoneDark);
    }
    const slabStep = (slabHalfSpan * 2) / 3;
    for (let si = 0; si < 3; si++) {
      const sz = qwBrZ - slabHalfSpan + (si + 0.5) * slabStep;
      baker.addBox('solid', qwBrX, qwDeckY - 0.035, sz, slabW, 0.07, slabStep * 0.94, 0, si === 1 ? pal.flagstone : '#92988C', pal.stoneDark);
    }
    for (const sideX of [-1, 1]) {
      baker.addBox('solid', qwBrX + sideX * (slabW * 0.5 + 0.04), qwDeckY + 0.02, qwBrZ, 0.11, 0.09, slabHalfSpan * 1.94, 0, pal.stone, pal.stoneDark);
    }
    const rampHW = 0.70;
    const rx0 = qwBrX - rampHW;
    const rx1 = qwBrX + rampHW;
    const nFootZ = qwBrZ - 1.90;
    const nDeckZ = qwBrZ - slabHalfSpan;
    const sDeckZ = qwBrZ + slabHalfSpan;
    const sFootZ = qwBrZ + 1.90;
    const qwRoadHex = '#C1AD86';
    for (let s = 0; s < 3; s++) {
      const t0 = s / 3;
      const t1 = (s + 1) / 3;
      const nz0 = lerp(nFootZ, nDeckZ, t0), nz1 = lerp(nFootZ, nDeckZ, t1);
      const ny0 = lerp(surface(qwBrX, nz0) + 0.036, qwDeckY, t0 * t0 * (3 - 2 * t0));
      const ny1 = lerp(surface(qwBrX, nz1) + 0.036, qwDeckY, t1 * t1 * (3 - 2 * t1));
      const nb0 = Math.min(ny0, surface(qwBrX, nz0) - 0.04);
      const nb1 = Math.min(ny1, surface(qwBrX, nz1) - 0.04);
      baker.withTag('vb-road', () => {
        baker.addQuad('ground', [rx0, ny0, nz0], [rx0, ny1, nz1], [rx1, ny1, nz1], [rx1, ny0, nz0], qwRoadHex, 0.005);
      });
      baker.withTag('terrace-bund-grass', () => {
        baker.addQuad('ground', [rx0, nb0, nz0], [rx0, nb1, nz1], [rx0, ny1, nz1], [rx0, ny0, nz0], pal.moss);
        baker.addQuad('ground', [rx1, nb1, nz1], [rx1, nb0, nz0], [rx1, ny0, nz0], [rx1, ny1, nz1], pal.moss);
      });

      const sz0 = lerp(sDeckZ, sFootZ, t0), sz1 = lerp(sDeckZ, sFootZ, t1);
      const sy0 = lerp(qwDeckY, surface(qwBrX, sz0) + 0.036, t0 * t0 * (3 - 2 * t0));
      const sy1 = lerp(qwDeckY, surface(qwBrX, sz1) + 0.036, t1 * t1 * (3 - 2 * t1));
      const sb0 = Math.min(sy0, surface(qwBrX, sz0) - 0.04);
      const sb1 = Math.min(sy1, surface(qwBrX, sz1) - 0.04);
      baker.withTag('vb-road', () => {
        baker.addQuad('ground', [rx0, sy0, sz0], [rx0, sy1, sz1], [rx1, sy1, sz1], [rx1, sy0, sz0], qwRoadHex, 0.005);
      });
      baker.withTag('terrace-bund-grass', () => {
        baker.addQuad('ground', [rx0, sb0, sz0], [rx0, sb1, sz1], [rx0, sy1, sz1], [rx0, sy0, sz0], pal.moss);
        baker.addQuad('ground', [rx1, sb1, sz1], [rx1, sb0, sz0], [rx1, sy0, sz0], [rx1, sy1, sz1], pal.moss);
      });
    }
    res.circles.push({ x: qwBrX, z: qwBrZ, r: 2.0, source: 'vb-brook-bridge-2' });
  }

  // Field-Head Diversion Weir, Wooden Sluice Gate & Dual Block-6 Paddy Inlets ('分水石堰·木闸入田' at 49.4, -206.5)
  {
    const addWaterRing = (cx, cy, cz, rIn, rOut, segs, hex) => {
      for (let k = 0; k < segs; k++) {
        const a0 = (k / segs) * TAU;
        const a1 = ((k + 1) / segs) * TAU;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        baker.addQuad(
          'water',
          [cx + c1 * rIn, cy, cz + s1 * rIn],
          [cx + c1 * rOut, cy, cz + s1 * rOut],
          [cx + c0 * rOut, cy, cz + s0 * rOut],
          [cx + c0 * rIn, cy, cz + s0 * rIn],
          hex,
          0.02
        );
      }
    };

    const bx0 = basinX - 0.42, bx1 = basinX + 0.42;
    const bz0 = basinZ - 0.44, bz1 = basinZ + 0.42;
    baker.addQuad('water', [bx0, basinWaterY, bz0], [bx0, basinWaterY, bz1], [bx1, basinWaterY, bz1], [bx1, basinWaterY, bz0], '#548479', 0.02);
    baker.addQuad('water', [basinX - 0.24, basinWaterY + 0.005, basinZ - 0.16], [basinX - 0.10, basinWaterY + 0.005, basinZ + 0.12], [basinX + 0.28, basinWaterY + 0.005, basinZ + 0.08], [basinX + 0.22, basinWaterY + 0.005, basinZ - 0.14], '#C2E3DA', 0.02);

    const wallFootY = surface(basinX, basinZ) - 0.14;
    const wallTopY = basinWaterY + 0.09;
    const wallH = Math.max(0.28, wallTopY - wallFootY);
    const wallCy = wallFootY + wallH * 0.5;
    // Enclosed north wall + northwest/southwest intake cheeks + northeast/southeast weir shoulders (open west/east/south mouths)
    baker.addBox('solid', basinX, wallCy, basinZ - 0.49, 1.06, wallH, 0.20, 0, pal.stone, pal.stoneDark);
    baker.addBox('solid', basinX - 0.42, wallCy - 0.02, basinZ - 0.39, 0.22, wallH, 0.16, 0, pal.stone, pal.stoneDark);
    baker.addBox('solid', basinX - 0.42, wallCy - 0.02, basinZ + 0.37, 0.22, wallH, 0.16, 0, pal.stone, pal.stoneDark);
    baker.addBox('solid', basinX + 0.40, wallCy, basinZ - 0.32, 0.24, wallH, 0.22, 0, pal.stone, pal.stoneDark);
    baker.addBox('solid', basinX + 0.38, wallCy, basinZ + 0.33, 0.28, wallH, 0.24, 0, pal.stone, pal.stoneDark);

    // Mortised timber sluice gate over east paddy mouth (x = 49.82)
    const sluiceX = 49.82;
    const sluiceFoot = surface(sluiceX, basinZ) - 0.10;
    const postTop = basinWaterY + 0.52;
    const postH = postTop - sluiceFoot;
    for (const s of [-1, 1]) {
      baker.addBox('solid', sluiceX, sluiceFoot + postH * 0.5, basinZ + s * 0.24, 0.08, postH, 0.08, 0, pal.timberDark, pal.timberDark);
    }
    baker.addBox('solid', sluiceX, postTop - 0.04, basinZ, 0.10, 0.07, 0.62, 0, pal.timber, pal.timberDark);
    baker.addBox('solid', sluiceX, basinWaterY + 0.17, basinZ, 0.04, 0.22, 0.42, 0, '#8B6E4A', pal.timberDark);

    // East paddy wooden flume crossing Block 6 (r=1, c=0) west bund into paddy mirror + foam spill ripples
    const flumeX0 = 49.70;
    const flumeX1 = 50.62;
    const flumeMidX = (flumeX0 + flumeX1) * 0.5;
    const flumeLen = flumeX1 - flumeX0;
    const sillY = paddyWaterY - 0.025;
    baker.addBox('solid', flumeMidX, sillY - 0.03, basinZ, flumeLen, 0.07, 0.42, 0, pal.timberDark, pal.timberDark);
    for (const s of [-1, 1]) {
      baker.addBox('solid', flumeMidX, basinWaterY + 0.04, basinZ + s * 0.19, flumeLen, 0.13, 0.06, 0, pal.timber, pal.timberDark);
    }
    const chW = 0.15;
    baker.addQuad('water', [flumeX0, basinWaterY + 0.002, basinZ - chW], [flumeX0, basinWaterY + 0.002, basinZ + chW], [flumeX1, paddyWaterY + 0.010, basinZ + chW], [flumeX1, paddyWaterY + 0.010, basinZ - chW], pal.water, 0.03);
    baker.addQuad('water', [flumeX1 - 0.10, paddyWaterY + 0.012, basinZ - 0.12], [flumeX1 - 0.10, paddyWaterY + 0.012, basinZ + 0.12], [flumeX1 + 0.26, paddyWaterY + 0.009, basinZ + 0.22], [flumeX1 + 0.26, paddyWaterY + 0.009, basinZ - 0.22], '#D8EFE8', 0.03);
    addWaterRing(flumeX1 + 0.18, paddyWaterY + 0.008, basinZ, 0.14, 0.21, 8, pal.waterFoam);
    addWaterRing(flumeX1 + 0.18, paddyWaterY + 0.007, basinZ, 0.30, 0.36, 8, '#C8E6DE');

    // South irrigation spur: stepped stone spillway from basin down into Block 6 inter-plot rill (inter-b6-r0 at z = -204.76)
    const rillPts = [
      [basinX, -206.08],
      [basinX, -205.55],
      [basinX, -204.76],
      [50.00, -204.76],
      [50.65, -204.76]
    ];
    const rillYs = [
      basinWaterY - 0.004,
      surface(basinX, -205.55) + 0.072,
      surface(basinX, -204.76) + 0.055,
      surface(50.00, -204.76) + 0.055,
      surface(50.65, -204.76) + 0.052
    ];
    const rillHalf = 0.14;
    for (let k = 0; k < rillPts.length - 1; k++) {
      const ra = rillPts[k], rb = rillPts[k + 1];
      const rdx = rb[0] - ra[0], rdz = rb[1] - ra[1];
      const rlen = Math.hypot(rdx, rdz) || 1;
      const rnx = -rdz / rlen, rnz = rdx / rlen;
      const ya = rillYs[k], yb = rillYs[k + 1];
      baker.addQuad(
        'water',
        [ra[0] + rnx * rillHalf, ya, ra[1] + rnz * rillHalf],
        [rb[0] + rnx * rillHalf, yb, rb[1] + rnz * rillHalf],
        [rb[0] - rnx * rillHalf, yb, rb[1] - rnz * rillHalf],
        [ra[0] - rnx * rillHalf, ya, ra[1] - rnz * rillHalf],
        k === 0 ? '#C2E3DA' : pal.water,
        k === 0 ? 0.04 : 0.01
      );
      for (const s of [-1, 1]) {
        const wInA = [ra[0] + rnx * rillHalf * s, ya - 0.01, ra[1] + rnz * rillHalf * s];
        const wInB = [rb[0] + rnx * rillHalf * s, yb - 0.01, rb[1] + rnz * rillHalf * s];
        const cxA = ra[0] + rnx * (rillHalf + 0.12) * s, czA = ra[1] + rnz * (rillHalf + 0.12) * s;
        const cxB = rb[0] + rnx * (rillHalf + 0.12) * s, czB = rb[1] + rnz * (rillHalf + 0.12) * s;
        const wTopA = [cxA, ya + 0.055, czA];
        const wTopB = [cxB, yb + 0.055, czB];
        const fxA = ra[0] + rnx * (rillHalf + 0.24) * s, fzA = ra[1] + rnz * (rillHalf + 0.24) * s;
        const fxB = rb[0] + rnx * (rillHalf + 0.24) * s, fzB = rb[1] + rnz * (rillHalf + 0.24) * s;
        const wBotA = [fxA, surface(fxA, fzA) - 0.04, fzA];
        const wBotB = [fxB, surface(fxB, fzB) - 0.04, fzB];
        if (s > 0) {
          baker.addQuad('solid', wTopA, wTopB, wInB, wInA, pal.stone);
          baker.addQuad('solid', wBotA, wBotB, wTopB, wTopA, pal.stoneDark);
        } else {
          baker.addQuad('solid', wInA, wInB, wTopB, wTopA, pal.stone);
          baker.addQuad('solid', wTopA, wTopB, wBotB, wBotA, pal.stoneDark);
        }
      }
    }
    res.circles.push({ x: basinX, z: basinZ, r: 2.0, source: 'vb-brook-diversion' });
  }

  // 北涧青石拱桥 (Cambered Qin-Han dressed bluestone slab bridge with cutwater pier & 4 lotus望柱 at 24.5, -224.0)
  const brCfg = cfg.landmarks.stoneBridge;
  const brY = surface(brCfg.x, brCfg.z);
  const brYaw = brCfg.yaw || 0;
  const brCos = Math.cos(brYaw), brSin = Math.sin(brYaw);
  const brPt = (lx, ly, lz) => [brCfg.x + lx * brCos + lz * brSin, brY + ly, brCfg.z - lx * brSin + lz * brCos];

  // Stepped ashlar stone bank abutments + central boat-prow stone cutwater pier
  for (const endS of [-1, 1]) {
    const [ax, ay, az] = brPt(endS * (brCfg.length * 0.43), -0.02, 0);
    baker.addBox('solid', ax, ay, az, 0.78, 0.40, brCfg.width + 0.34, brYaw, pal.stone, pal.stoneDark);
  }
  baker.addCylinder('solid', brCfg.x, brY - 0.02, brCfg.z, 0.26, 0.32, 0.44, 6, brYaw, pal.stone, pal.stoneDark);

  // 3 parallel cambered bluestone arch deck slabs + cambered mossy stone curb rails + 4 carved望柱 end-posts
  const brArch = 0.18;
  for (const zOff of [-brCfg.width * 0.31, 0, brCfg.width * 0.31]) {
    const [sx, , sz] = brPt(0, 0, zOff);
    baker.addArchSlab('solid', sx, brY + 0.13, sz, brCfg.length, brCfg.width * 0.29, 0.13, brArch, 6, brYaw, pal.flagstone, pal.stoneDark);
  }
  for (const curbS of [-1, 1]) {
    const zCurb = curbS * (brCfg.width * 0.48);
    const [cx, , cz] = brPt(0, 0, zCurb);
    baker.addArchSlab('solid', cx, brY + 0.24, cz, brCfg.length * 0.90, 0.15, 0.11, brArch, 6, brYaw, pal.moss, pal.stone);
    for (const endS of [-1, 1]) {
      const [px, py, pz] = brPt(endS * (brCfg.length * 0.44), 0.26, zCurb);
      baker.addBox('solid', px, py, pz, 0.20, 0.30, 0.20, brYaw, pal.stoneLight, pal.stoneDark);
      baker.addCone('solid', px, py + 0.20, pz, 0.14, 0.12, 6, brYaw, pal.mossBright, pal.stoneLight);
    }
  }
  res.circles.push({ x: brCfg.x, z: brCfg.z, r: 3.2, source: 'vb-bridge' });

  // ============================================================================
  // 4. 东皋观云亭与盘陀云根石 (Song-Style Sweeping Concave Hexagonal Pavilion, 美人靠, Tea Table & Cloud Crag)
  // ============================================================================
  const pavCfg = cfg.landmarks.cloudPavilion;
  const pavY = surface(pavCfg.x, pavCfg.z);
  const pavFloorY = pavY + 0.10;
  const pavR = 2.38;

  // Two-tier hexagonal ashlar stone stylobate ('须弥座条石台基') + moulded curb + radial flagstone joints
  baker.addCylinder('solid', pavCfg.x, pavFloorY - 0.50, pavCfg.z, pavR + 0.62, pavR + 0.92, 0.92, 6, Math.PI / 6, pal.stone, pal.stoneDark);
  baker.addCylinder('solid', pavCfg.x, pavFloorY - 0.05, pavCfg.z, pavR + 0.48, pavR + 0.54, 0.14, 6, Math.PI / 6, pal.flagstone, pal.stone);
  baker.addCylinder('ground', pavCfg.x, pavFloorY + 0.02, pavCfg.z, pavR + 0.34, pavR + 0.38, 0.04, 6, Math.PI / 6, pal.stoneLight, pal.flagstone);
  baker.addHollowCylinder('solid', pavCfg.x, pavFloorY + 0.045, pavCfg.z, pavR + 0.46, pavR + 0.28, 0.05, 6, Math.PI / 6, pal.flagstone, pal.stoneDark);

  // 4-stepped west stone stair with sloped side cheek-stones ('垂带踏道')
  for (let st = 1; st <= 4; st++) {
    const sx = pavCfg.x - (pavR + 0.30 + st * 0.42);
    const sz = pavCfg.z;
    const sy = lerp(pavFloorY, surface(sx, sz) + 0.03, st / 4);
    baker.addBox('solid', sx, sy - 0.11, sz, 0.46, 0.24, 1.46, 0, pal.flagstone, pal.stoneDark);
  }
  for (const s of [-1, 1]) {
    const sTop = [pavCfg.x - (pavR + 0.32), pavFloorY + 0.10, pavCfg.z + s * 0.80];
    const sBotX = pavCfg.x - (pavR + 2.02);
    const sBot = [sTop[0] - 1.70, surface(sBotX, pavCfg.z + s * 0.80) + 0.06, pavCfg.z + s * 0.80];
    baker.addBeam('solid', sTop, sBot, 0.11, 0.11, 4, pal.stoneLight, pal.stoneDark, true);
  }

  // 6 moulded stone column bases + tapered columns + angled knee braces ('雀替/叉手') + Song '美人靠' balustrade
  const colH = 2.52;
  const colPts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    colPts.push([pavCfg.x + Math.cos(a) * pavR, pavCfg.z + Math.sin(a) * pavR, a]);
  }
  for (let i = 0; i < 6; i++) {
    const [cx, cz] = colPts[i];
    const [nx, nz] = colPts[(i + 1) % 6];
    // Octagonal stone plinth ('覆盆柱础') + tapered round timber column
    baker.addCylinder('solid', cx, pavFloorY + 0.05, cz, 0.19, 0.23, 0.10, 8, 0, pal.stoneDark, pal.stoneDark);
    baker.addCylinder('solid', cx, pavFloorY + 0.12, cz, 0.14, 0.18, 0.07, 8, 0, pal.stoneLight, pal.stone);
    baker.addCylinder('solid', cx, pavFloorY + colH * 0.5 + 0.12, cz, 0.092, 0.112, colH, 8, 0, pal.timber, pal.timberDark);
    blockers.push({ x: cx, z: cz, hw: 0.18, hd: 0.18, rot: 0, minY: pavFloorY, maxY: pavFloorY + colH, source: 'vb-pav-col-' + i });

    // Double eave ring-beams ('额枋' + '普拍枋') & 2 angled timber knee braces per bay
    const mx = (cx + nx) * 0.5;
    const mz = (cz + nz) * 0.5;
    const segLen = Math.hypot(nx - cx, nz - cz);
    const segYaw = Math.atan2(nx - cx, nz - cz);
    baker.addBox('solid', mx, pavFloorY + colH + 0.04, mz, 0.13, 0.13, segLen + 0.12, segYaw, pal.timber, pal.timberDark);
    baker.addBox('solid', mx, pavFloorY + colH + 0.15, mz, 0.17, 0.09, segLen + 0.18, segYaw, pal.timberDark, pal.timber);

    const b1 = [lerp(cx, nx, 0.24), pavFloorY + colH + 0.02, lerp(cz, nz, 0.24)];
    const b2 = [lerp(cx, nx, 0.76), pavFloorY + colH + 0.02, lerp(cz, nz, 0.76)];
    baker.addBeam('solid', [cx, pavFloorY + colH - 0.42, cz], b1, 0.052, 0.048, 4, pal.timberDark, pal.timber, false);
    baker.addBeam('solid', [nx, pavFloorY + colH - 0.42, nz], b2, 0.052, 0.048, 4, pal.timberDark, pal.timber, false);

    // Song-style outswept '美人靠 / 鹅颈椅' scenic balustrade on non-entrance bays
    if (i !== 2 && i !== 3) {
      const outX = ((cx + nx) * 0.5 - pavCfg.x);
      const outZ = ((cz + nz) * 0.5 - pavCfg.z);
      const outL = Math.hypot(outX, outZ) || 1;
      const ox = outX / outL, oz = outZ / outL;
      // Bottom stone curb + wide timber seat plank + outswept backrest rail & 4 curved鹅颈 struts
      baker.addBox('solid', mx, pavFloorY + 0.14, mz, 0.22, 0.16, segLen - 0.18, segYaw, pal.stone, pal.stoneDark);
      baker.addBox('solid', mx + ox * 0.04, pavFloorY + 0.42, mz + oz * 0.04, 0.32, 0.07, segLen - 0.14, segYaw, pal.timber, pal.timberDark);
      baker.addBeam(
        'solid',
        [lerp(cx, nx, 0.06) + ox * 0.20, pavFloorY + 0.80, lerp(cz, nz, 0.06) + oz * 0.20],
        [lerp(cx, nx, 0.94) + ox * 0.20, pavFloorY + 0.80, lerp(cz, nz, 0.94) + oz * 0.20],
        0.046, 0.046, 6, pal.timber, pal.timberDark, true
      );
      for (let sp = 1; sp <= 4; sp++) {
        const t = sp / 5;
        const sx = lerp(cx, nx, t), sz = lerp(cz, nz, t);
        baker.addBeam('solid', [sx, pavFloorY + 0.18, sz], [sx + ox * 0.04, pavFloorY + 0.42, sz + oz * 0.04], 0.036, 0.036, 4, pal.timberDark, pal.timber, false);
        baker.addBeam('solid', [sx + ox * 0.06, pavFloorY + 0.43, sz + oz * 0.06], [sx + ox * 0.20, pavFloorY + 0.79, sz + oz * 0.20], 0.032, 0.028, 4, pal.timber, pal.bambooDry, false);
      }
    }
  }

  // Sweeping concave hexagonal Song-Yuan thatch roof ('反宇飞檐六角攒尖茅亭') + 18 exposed rafters + 6 hip ribs + gourd finial
  const eaveBaseY = pavFloorY + colH + 0.20;
  const rOutEave = pavR + 1.06;
  const rMidRoof = (pavR + 1.06) * 0.62;
  const rTopRoof = (pavR + 1.06) * 0.24;
  const yOutEave = eaveBaseY - 0.08;
  const yMidRoof = eaveBaseY + 0.56;
  const yTopRoof = eaveBaseY + 1.32;
  const yApexRoof = eaveBaseY + 1.68;

  // 18 radial exposed dark-timber rafters ('飞椽') cleanly tucked inside exact hexagonal eaves boundary
  for (let rf = 0; rf < 18; rf++) {
    const a = (rf / 18) * TAU + Math.PI / 6;
    const ca = Math.cos(a), sa = Math.sin(a);
    const localAng = ((rf % 3) / 3) * (Math.PI / 3) - Math.PI / 6;
    const hexScale = Math.cos(Math.PI / 6) / Math.cos(localAng);
    const rIn = pavR * 0.52 * hexScale;
    const rOut = rOutEave * hexScale - 0.09;
    baker.addBeam(
      'solid',
      [pavCfg.x + ca * rIn, yMidRoof - 0.14, pavCfg.z + sa * rIn],
      [pavCfg.x + ca * rOut, yOutEave - 0.09, pavCfg.z + sa * rOut],
      0.036, 0.028, 4, pal.timberDark, pal.timber, false
    );
  }

  baker.withTag('frost-roof', () => {
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * TAU + Math.PI / 6;
      const a1 = ((i + 1) / 6) * TAU + Math.PI / 6;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);

      const e0 = [pavCfg.x + c0 * rOutEave, yOutEave, pavCfg.z + s0 * rOutEave];
      const e1 = [pavCfg.x + c1 * rOutEave, yOutEave, pavCfg.z + s1 * rOutEave];
      const m0 = [pavCfg.x + c0 * rMidRoof, yMidRoof, pavCfg.z + s0 * rMidRoof];
      const m1 = [pavCfg.x + c1 * rMidRoof, yMidRoof, pavCfg.z + s1 * rMidRoof];
      const t0 = [pavCfg.x + c0 * rTopRoof, yTopRoof, pavCfg.z + s0 * rTopRoof];
      const t1 = [pavCfg.x + c1 * rTopRoof, yTopRoof, pavCfg.z + s1 * rTopRoof];
      const ap = [pavCfg.x, yApexRoof, pavCfg.z];

      // Underside dark woven reed eave lining (downward-facing interior)
      baker.addQuad('solid', e0, e1, m1, m0, pal.timberDark, -0.05);
      // Concave 3-tier exterior roof slopes (upward/outward-facing exterior)
      baker.addQuad('solid', e1, e0, m0, m1, pal.thatchLight, 0.02);
      baker.addQuad('solid', m1, m0, t0, t1, pal.thatch, 0.01);
      baker.addTri('solid', ap[0], ap[1], ap[2], t1[0], t1[1], t1[2], t0[0], t0[1], t0[2], pal.thatchLight, 0.03);

      // Raised staggered thatch shingle courses along each hexagonal face
      for (let row = 0; row < 4; row++) {
        const v0 = row / 4, v1 = (row + 0.86) / 4;
        for (let col = 0; col < 5 - Math.floor(row * 0.7); col++) {
          const colsN = 5 - Math.floor(row * 0.7);
          const u0 = (col + 0.06) / colsN, u1 = (col + 0.94) / colsN;
          const sampleRoof = (u, v) => {
            const pL0 = v < 0.55 ? e0 : m0;
            const pR0 = v < 0.55 ? e1 : m1;
            const pL1 = v < 0.55 ? m0 : t0;
            const pR1 = v < 0.55 ? m1 : t1;
            const vt = v < 0.55 ? v / 0.55 : (v - 0.55) / 0.45;
            const bPt = [lerp(pL0[0], pR0[0], u), lerp(pL0[1], pR0[1], u), lerp(pL0[2], pR0[2], u)];
            const tPt = [lerp(pL1[0], pR1[0], u), lerp(pL1[1], pR1[1], u), lerp(pL1[2], pR1[2], u)];
            return [lerp(bPt[0], tPt[0], vt), lerp(bPt[1], tPt[1], vt) + 0.026 * (1 - vt * 0.3), lerp(bPt[2], tPt[2], vt)];
          };
          baker.addQuad(
            'solid',
            sampleRoof(u1, v0),
            sampleRoof(u0, v0),
            sampleRoof(u0, v1),
            sampleRoof(u1, v1),
            (row + col + i) % 2 === 0 ? pal.thatchLight : pal.thatch
          );
        }
      }

      // Raised corner hip ridge rib ('六角垂脊') with upturned eave tip
      baker.addBeam('solid', [e0[0], e0[1] + 0.04, e0[2]], [m0[0], m0[1] + 0.04, m0[2]], 0.055, 0.050, 5, pal.bambooDry, pal.thatch, true);
      baker.addBeam('solid', [m0[0], m0[1] + 0.04, m0[2]], [ap[0], ap[1] + 0.02, ap[2]], 0.048, 0.040, 5, pal.thatch, pal.timber, false);
    }
  });
  // Sculpted 3-part ceramic lotus & gourd finial ('陶葫芦宝顶')
  baker.addCylinder('solid', pavCfg.x, yApexRoof + 0.06, pavCfg.z, 0.22, 0.28, 0.12, 8, 0, pal.clayGrey, pal.stoneDark);
  baker.addCylinder('solid', pavCfg.x, yApexRoof + 0.20, pavCfg.z, 0.11, 0.17, 0.18, 8, 0, '#8FA89B', pal.clayGrey);
  baker.addCone('solid', pavCfg.x, yApexRoof + 0.38, pavCfg.z, 0.10, 0.22, 8, 0, '#9DB8AA', '#7A9286');
  shelters.push({ x: pavCfg.x, z: pavCfg.z, rx: 2.55, rz: 2.55, rot: 0, roofY: yTopRoof, kind: 'pavilion' });

  // Carved waisted stone drum table ('束腰石鼓桌') + celadon tea set & handscroll + 3 stone drum stools
  const tblX = pavCfg.x + 0.18, tblZ = pavCfg.z;
  baker.addCylinder('solid', tblX, pavFloorY + 0.08, tblZ, 0.38, 0.44, 0.14, 8, 0, pal.stone, pal.stoneDark);
  baker.addCylinder('solid', tblX, pavFloorY + 0.34, tblZ, 0.26, 0.26, 0.40, 8, 0, pal.stoneDark, pal.stone);
  baker.addCylinder('solid', tblX, pavFloorY + 0.62, tblZ, 0.62, 0.56, 0.14, 10, 0, pal.stoneLight, pal.stone);
  // Celadon tea ewer, two cups & rolled landscape scroll on stone table
  baker.addCylinder('solid', tblX - 0.12, pavFloorY + 0.75, tblZ - 0.08, 0.075, 0.095, 0.13, 7, 0, '#9CB8A8', '#789686');
  baker.addCone('solid', tblX - 0.12, pavFloorY + 0.84, tblZ - 0.08, 0.065, 0.06, 7, 0, '#B2CCBE', '#8EA89A');
  baker.addHollowCylinder('solid', tblX + 0.08, pavFloorY + 0.72, tblZ + 0.10, 0.052, 0.036, 0.055, 6, 0, '#B2CCBE', '#829E90');
  baker.addHollowCylinder('solid', tblX - 0.04, pavFloorY + 0.72, tblZ + 0.18, 0.052, 0.036, 0.055, 6, 0, '#B2CCBE', '#829E90');
  baker.addBox('solid', tblX + 0.20, pavFloorY + 0.705, tblZ - 0.12, 0.34, 0.018, 0.20, 0.35, '#EAE2CE', '#C8BC9E');
  baker.addBeam('solid', [tblX + 0.05, pavFloorY + 0.72, tblZ - 0.18], [tblX + 0.21, pavFloorY + 0.72, tblZ - 0.27], 0.022, 0.022, 6, pal.timberDark, pal.timber, true);
  blockers.push({ x: tblX, z: tblZ, hw: 0.58, hd: 0.58, rot: 0, minY: pavFloorY, maxY: pavFloorY + 0.78, source: 'vb-pav-table' });

  const pavSeatX = pavCfg.x - 0.72;
  const pavSeatZ = pavCfg.z + 0.12;
  for (const [sx, sz] of [[pavSeatX, pavSeatZ], [pavCfg.x + 0.88, pavCfg.z - 0.42], [pavCfg.x + 0.42, pavCfg.z + 0.86]]) {
    baker.addCylinder('solid', sx, pavFloorY + 0.09, sz, 0.22, 0.26, 0.16, 8, 0, pal.stone, pal.stoneDark);
    baker.addCylinder('solid', sx, pavFloorY + 0.24, sz, 0.18, 0.18, 0.16, 8, 0, pal.stoneDark, pal.stone);
    baker.addCylinder('solid', sx, pavFloorY + 0.37, sz, 0.27, 0.24, 0.11, 8, 0, pal.stoneLight, pal.stone);
  }

  // Sculpted 4-mass Song-Yuan overhanging '盘陀云根石' crag beside pavilion (replacing single flat box)
  const ptX = pavCfg.x + 2.9, ptZ = pavCfg.z - 2.65;
  const ptY = surface(ptX, ptZ);
  baker.addFacetedRock('solid', ptX, ptY + 0.32, ptZ, 1.15, 0.96, 0.88, 0.35, 1101, { ...rockPalOpts, mossTag: 'frost-cliff-cap' });
  baker.addFacetedRock('solid', ptX - 0.78, ptY + 0.14, ptZ + 0.35, 0.72, 0.62, 0.58, -0.45, 1107, rockPalOpts);
  baker.addFacetedRock('solid', ptX + 0.68, ptY + 0.48, ptZ - 0.24, 0.68, 1.24, 0.62, 0.82, 1113, { ...rockPalOpts, mossTag: 'frost-cliff-cap' });

  res.circles.push({ x: pavCfg.x, z: pavCfg.z, r: 4.8, source: 'vb-cloud-pavilion' });
  targets.push({ id: 'cloud-pavilion', x: pavCfg.x, y: pavFloorY + 1.5, z: pavCfg.z, range: 11.0 });
  contactTargets.push({ id: 'vb-cloud-pavilion', kind: 'house', x: pavCfg.x, z: pavCfg.z, gy: pavFloorY, w: 4.4, d: 4.4, rot: 0, owner: group });

  restSeats.push({
    id: 'cloud-pavilion-seat',
    name: '东皋观云亭',
    prompt: '凭栏观云 · 东皋观云亭',
    x: pavSeatX,
    y: surface(pavSeatX, pavSeatZ),
    z: pavSeatZ,
    seatY: 0.44,
    lookX: 68.0,
    lookY: pavFloorY + 1.05,
    lookZ: -158.0,
    exitAngle: Math.PI
  });

  // ============================================================================
  // 5. 东皋晒秋竹坪与茶寮凉棚 (Paved Sunning Court, Bamboo Pergola & Openwork X-Trestle Harvest Trays)
  // ============================================================================
  const sunCfg = cfg.landmarks.sunningTerrace;
  const sunY = Math.max(
    surface(sunCfg.x, sunCfg.z),
    surface(sunCfg.x - 3.6, sunCfg.z),
    surface(sunCfg.x + 3.6, sunCfg.z),
    surface(sunCfg.x, sunCfg.z - 3.6),
    surface(sunCfg.x, sunCfg.z + 3.6)
  );
  const sunTopY = sunY + 0.14;
  // Grounded 12-sided stone retaining terrace plinth (deep hillside skirt eliminates grass poke-through!)
  baker.addCylinder('solid', sunCfg.x, sunTopY - 0.34, sunCfg.z, 4.38, 4.68, 0.64, 12, 0.15, pal.stone, pal.stoneDark);
  baker.addCylinder('ground', sunCfg.x, sunTopY - 0.01, sunCfg.z, 4.18, 4.24, 0.04, 12, 0.15, pal.path, pal.pathEdge);
  baker.addHollowCylinder('solid', sunCfg.x, sunTopY + 0.035, sunCfg.z, 4.38, 4.12, 0.08, 12, 0.15, pal.stoneLight, pal.stoneDark);

  // Crafted 4-post bamboo sunning shade pergola ('竹编茶寮凉棚') with beams, braces, pitched gable thatch roof & hanging harvest strings
  const shX = sunCfg.x + 1.15, shZ = sunCfg.z - 2.05;
  const shY = sunTopY;
  const shYaw = 0.12;
  const shCos = Math.cos(shYaw), shSin = Math.sin(shYaw);
  const shPt = (lx, ly, lz) => [shX + lx * shCos + lz * shSin, shY + ly, shZ - lx * shSin + lz * shCos];

  for (const [ox, oz] of [[-1.25, -0.92], [1.25, -0.92], [-1.25, 0.92], [1.25, 0.92]]) {
    const pBase = shPt(ox, 0.04, oz);
    const pTop = shPt(ox, 2.14, oz);
    baker.addCylinder('solid', pBase[0], shY + 0.05, pBase[2], 0.12, 0.14, 0.10, 6, 0, pal.stone, pal.stoneDark);
    baker.addBeam('solid', pBase, pTop, 0.062, 0.054, 6, pal.timber, pal.bambooDry, false);
    // Bamboo knee braces
    baker.addBeam('solid', shPt(ox, 1.66, oz), shPt(ox - Math.sign(ox) * 0.42, 2.10, oz), 0.032, 0.030, 4, pal.bambooDry, pal.timber, false);
    baker.addBeam('solid', shPt(ox, 1.66, oz), shPt(ox, 2.10, oz - Math.sign(oz) * 0.36), 0.032, 0.030, 4, pal.bambooDry, pal.timber, false);
  }
  // Perimeter bamboo tie-beams
  for (const oz of [-0.92, 0.92]) {
    baker.addBeam('solid', shPt(-1.42, 2.12, oz), shPt(1.42, 2.12, oz), 0.048, 0.048, 5, pal.timber, pal.bambooDry, true);
  }
  for (const ox of [-1.25, 1.25]) {
    baker.addBeam('solid', shPt(ox, 2.12, -1.04), shPt(ox, 2.12, 1.04), 0.044, 0.044, 5, pal.timber, pal.bambooDry, true);
  }
  // Pitched two-slope thatched gable shade roof + underside lining + bound straw ridge pole
  baker.withTag('frost-roof', () => {
    const pS0 = shPt(-1.54, 2.10, 1.22), pS1 = shPt(1.54, 2.10, 1.22), pR1 = shPt(1.54, 2.66, 0), pR0 = shPt(-1.54, 2.66, 0);
    const pN0 = shPt(1.54, 2.10, -1.22), pN1 = shPt(-1.54, 2.10, -1.22);
    baker.addQuad('solid', pS0, pS1, pR1, pR0, pal.thatchLight, 0.02);
    baker.addQuad('solid', pS1, pS0, pR0, pR1, pal.timberDark, -0.05);
    baker.addQuad('solid', pN0, pN1, pR0, pR1, pal.thatch, 0.01);
    baker.addQuad('solid', pN1, pN0, pR1, pR0, pal.timberDark, -0.05);
    // East & West bamboo gable triangles
    const gE0 = shPt(1.36, 2.12, 1.04), gE1 = shPt(1.36, 2.12, -1.04), gEP = shPt(1.36, 2.62, 0);
    const gW0 = shPt(-1.36, 2.12, -1.04), gW1 = shPt(-1.36, 2.12, 1.04), gWP = shPt(-1.36, 2.62, 0);
    baker.addTri('solid', gE0[0], gE0[1], gE0[2], gE1[0], gE1[1], gE1[2], gEP[0], gEP[1], gEP[2], pal.bambooDry, -0.03);
    baker.addTri('solid', gW0[0], gW0[1], gW0[2], gW1[0], gW1[1], gW1[2], gWP[0], gWP[1], gWP[2], pal.bambooDry, -0.03);
    baker.addBeam('solid', shPt(-1.62, 2.68, 0), shPt(1.62, 2.68, 0), 0.085, 0.085, 6, pal.thatchLight, pal.thatch, true);
  });
  // Hanging strings of crimson chili /山茱萸 & golden corn under south beam of pergola
  baker.withTag('millet-hang', () => {
    for (let k = -2; k <= 2; k++) {
      if (k === 0) continue;
      const hp = shPt(k * 0.44, 2.06, 0.92);
      const isRed = Math.abs(k) === 2;
      baker.addBeam('solid', hp, [hp[0], hp[1] - 0.44, hp[2]], 0.052, 0.028, 5, isRed ? pal.chili : pal.cornGold, isRed ? '#923426' : pal.thatch, true);
    }
  });
  shelters.push({ x: shX, z: shZ, rx: 1.45, rz: 1.15, rot: shYaw, roofY: shY + 2.35, kind: 'eave' });
  blockers.push({ x: shX, z: shZ, hw: 1.25, hd: 0.95, rot: shYaw, minY: shY, maxY: shY + 2.3, source: 'vb-sunning-shed' });

  // 6 round woven bamboo sunning trays ('晒秋圆匾') on openwork crossed bamboo X-trestles (anchored solidly on terrace sunTopY)
  const traySpecs = [
    { ox: -1.8, oz: -0.8, col: pal.chili },
    { ox: -0.5, oz: -0.5, col: pal.cornGold },
    { ox: -1.6, oz: 0.8, col: pal.teaMid },
    { ox: -0.2, oz: 1.0, col: pal.radishDry },
    { ox: 1.3, oz: 0.7, col: pal.cornGold },
    { ox: 2.3, oz: -0.1, col: pal.chili }
  ];
  for (let i = 0; i < traySpecs.length; i++) {
    const tr = traySpecs[i];
    const tx = sunCfg.x + tr.ox;
    const tz = sunCfg.z + tr.oz;
    const ty = sunTopY;
    const tYaw = i * 0.45;
    const tc = Math.cos(tYaw), ts = Math.sin(tYaw);
    const tp = (lx, ly, lz) => [tx + lx * tc + lz * ts, ty + ly, tz - lx * ts + lz * tc];

    // Openwork X-braced 4-legged bamboo trestle
    for (const sideZ of [-0.26, 0.26]) {
      baker.addBeam('solid', tp(-0.34, -0.02, sideZ), tp(0.28, 0.42, sideZ), 0.028, 0.025, 4, pal.timber, pal.bambooDry, false);
      baker.addBeam('solid', tp(0.34, -0.02, sideZ), tp(-0.28, 0.42, sideZ), 0.028, 0.025, 4, pal.timber, pal.bambooDry, false);
    }
    baker.addBeam('solid', tp(-0.26, 0.41, -0.28), tp(-0.26, 0.41, 0.28), 0.024, 0.024, 4, pal.bambooDry, pal.bambooDry, false);
    baker.addBeam('solid', tp(0.26, 0.41, -0.28), tp(0.26, 0.41, 0.28), 0.024, 0.024, 4, pal.bambooDry, pal.bambooDry, false);

    // Woven bamboo tray floor + raised 3D woven bamboo rim + multi-ring harvest mound
    baker.addCylinder('solid', tx, ty + 0.43, tz, 0.58, 0.56, 0.032, 10, tYaw, pal.bambooDry, pal.timber);
    baker.addHollowCylinder('solid', tx, ty + 0.468, tz, 0.60, 0.53, 0.065, 10, tYaw, '#CBB782', pal.bambooDry);
    baker.withTag('sun-tray-' + i, () => {
      baker.addCylinder('solid', tx, ty + 0.462, tz, 0.48, 0.52, 0.045, 9, tYaw, tr.col, tr.col);
      baker.addCone('solid', tx, ty + 0.515, tz, 0.38, 0.095, 8, tYaw + 0.3, tr.col, tr.col);
    });
    blockers.push({ x: tx, z: tz, hw: 0.52, hd: 0.52, rot: 0, minY: ty, maxY: ty + 0.65, source: 'vb-tray-' + i });
  }
  // Two woven harvest baskets ('竹谷篓') beside the sunning pergola
  for (const [bxOff, bzOff, fillHex] of [[-2.65, -0.15, pal.cornGold], [2.45, -1.35, pal.radishDry]]) {
    const bx = sunCfg.x + bxOff, bz = sunCfg.z + bzOff;
    const by = sunTopY;
    baker.addCylinder('solid', bx, by + 0.18, bz, 0.26, 0.21, 0.36, 8, 0, pal.bambooDry, pal.timber);
    baker.addHollowCylinder('solid', bx, by + 0.37, bz, 0.275, 0.22, 0.05, 8, 0, '#CBB782', pal.bambooDry);
    baker.addCone('solid', bx, by + 0.38, bz, 0.22, 0.09, 7, 0, fillHex, fillHex);
  }
  res.circles.push({ x: sunCfg.x, z: sunCfg.z, r: 4.8, source: 'vb-sunning' });

  // ============================================================================
  // 6. 避秦记事残碑 (Sculpted Fractured Bluestone Stele, Tortoise/Cloud Pedestal & Archaic Clerical Strokes)
  // ============================================================================
  const stCfg = cfg.landmarks.ancientStele;
  const stY = surface(stCfg.x, stCfg.z);
  const stYaw = -0.22;
  const stCos = Math.cos(stYaw), stSin = Math.sin(stYaw);
  const stPt = (lx, ly, lz) => [stCfg.x + lx * stCos + lz * stSin, stY + ly, stCfg.z - lx * stSin + lz * stCos];

  // Mossy natural boulder pedestal ('苍苔石趺') + mortised stone socket collar
  baker.addFacetedRock('solid', stCfg.x, stY + 0.14, stCfg.z, 0.82, 0.48, 0.62, stYaw, 1301, rockPalOpts);
  baker.addFacetedRock('solid', stCfg.x + 0.45, stY + 0.08, stCfg.z - 0.28, 0.44, 0.32, 0.38, stYaw + 0.6, 1307, rockPalOpts);
  baker.addBox('solid', stCfg.x, stY + 0.36, stCfg.z, 0.92, 0.14, 0.38, stYaw, pal.stone, pal.stoneDark);

  // Asymmetric fractured bluestone stele body (diagonal weathered break across upper crown + beveled edges)
  const stProf = [
    [-0.40, 0.40], [0.40, 0.40], [0.38, 1.38], [0.16, 1.66], [-0.22, 1.74], [-0.39, 1.52]
  ];
  const halfT = 0.115;
  for (let i = 0; i < stProf.length; i++) {
    const j = (i + 1) % stProf.length;
    const f0 = stPt(stProf[i][0], stProf[i][1], halfT);
    const f1 = stPt(stProf[j][0], stProf[j][1], halfT);
    const b0 = stPt(stProf[i][0], stProf[i][1], -halfT);
    const b1 = stPt(stProf[j][0], stProf[j][1], -halfT);
    // Edge bevel band (outward normal)
    baker.addQuad('solid', f1, f0, b0, b1, i === 2 || i === 3 ? pal.moss : pal.stoneDark);
  }
  const stCenterF = stPt(-0.02, 1.05, halfT);
  const stCenterB = stPt(-0.02, 1.05, -halfT);
  for (let i = 0; i < stProf.length; i++) {
    const j = (i + 1) % stProf.length;
    const f0 = stPt(stProf[i][0], stProf[i][1], halfT);
    const f1 = stPt(stProf[j][0], stProf[j][1], halfT);
    const b0 = stPt(stProf[i][0], stProf[i][1], -halfT);
    const b1 = stPt(stProf[j][0], stProf[j][1], -halfT);
    baker.addTri('solid', stCenterF[0], stCenterF[1], stCenterF[2], f0[0], f0[1], f0[2], f1[0], f1[1], f1[2], i % 2 === 0 ? pal.stoneLight : pal.flagstone);
    baker.addTri('solid', stCenterB[0], stCenterB[1], stCenterB[2], b1[0], b1[1], b1[2], b0[0], b0[1], b0[2], pal.stone);
  }
  // Moss cushion clinging to fractured upper shoulder + 4 vertical columns of incised archaic clerical strokes ('汉隶阴刻')
  const mossCapPt = stPt(0.24, 1.54, 0);
  baker.withTag('frost-cliff-cap', () => {
    baker.addFacetedRock('solid', mossCapPt[0], mossCapPt[1], mossCapPt[2], 0.22, 0.16, 0.15, stYaw + 0.2, 1319, { ...rockPalOpts, sides: 5 });
  });
  for (const colX of [-0.22, -0.07, 0.08, 0.22]) {
    for (let gl = 0; gl < 5; gl++) {
      if (colX > 0.15 && gl === 4) continue; // broken top-right corner lacks glyph
      const gy = 0.62 + gl * 0.19;
      const gp = stPt(colX, gy, halfT + 0.008);
      baker.addBox('solid', gp[0], gp[1], gp[2], 0.085, 0.032, 0.016, stYaw, pal.stoneDark, pal.stoneDark);
    }
  }

  blockers.push({ x: stCfg.x, z: stCfg.z, hw: 0.65, hd: 0.52, rot: stYaw, minY: stY, maxY: stY + 1.75, source: 'vb-ancient-stele' });
  res.circles.push({ x: stCfg.x, z: stCfg.z, r: 2.6, source: 'vb-stele' });
  interactiveSites.push({
    ...cfg.interactions.ancientStele,
    x: stCfg.x,
    y: stY,
    z: stCfg.z,
    height: 1.05,
    soundKind: 'stone',
    playIndex: 0,
    cooldown: 0
  });

  // ============================================================================
  // 7. 北麓望稼草楼 (2-Level Stilted Timber & Thatch Watchtower, 7-Rung Ladder, Hip-Gable Roof & Farm Gear)
  // ============================================================================
  const wtCfg = cfg.landmarks.watchtower;
  const wtY = surface(wtCfg.x, wtCfg.z);
  const wtSpan = 1.35;
  const deckH = 2.25;
  const roofEaveH = 4.02;

  baker.addBox('ground', wtCfg.x, wtY + 0.035, wtCfg.z, 3.8, 0.07, 3.8, 0.04, pal.path, pal.pathEdge);

  // 4 stepped stone plinths + round timber posts + lower cross-tie beams & diagonal X-braces
  for (const [ox, oz] of [[-wtSpan, -wtSpan], [wtSpan, -wtSpan], [-wtSpan, wtSpan], [wtSpan, wtSpan]]) {
    const px = wtCfg.x + ox, pz = wtCfg.z + oz;
    baker.addBox('solid', px, wtY + 0.06, pz, 0.38, 0.14, 0.38, 0, pal.stone, pal.stoneDark);
    baker.addCylinder('solid', px, wtY + 0.16, pz, 0.18, 0.22, 0.09, 8, 0, pal.stoneLight, pal.stone);
    baker.addCylinder('solid', px, wtY + roofEaveH * 0.5 + 0.08, pz, 0.102, 0.125, roofEaveH, 8, 0, pal.timber, pal.timberDark);
  }
  // Lower frame horizontal tie-beams ('穿枋') + diagonal wind braces ('剪刀撑') + knee braces under deck
  for (const s of [-1, 1]) {
    baker.addBeam('solid', [wtCfg.x - wtSpan, wtY + 1.18, wtCfg.z + s * wtSpan], [wtCfg.x + wtSpan, wtY + 1.18, wtCfg.z + s * wtSpan], 0.055, 0.055, 5, pal.timberDark, pal.timber, false);
    baker.addBeam('solid', [wtCfg.x + s * wtSpan, wtY + 1.18, wtCfg.z - wtSpan], [wtCfg.x + s * wtSpan, wtY + 1.18, wtCfg.z + wtSpan], 0.055, 0.055, 5, pal.timberDark, pal.timber, false);
    // Knee braces supporting upper floor joists
    for (const t of [-1, 1]) {
      baker.addBeam('solid', [wtCfg.x + s * wtSpan, wtY + deckH - 0.52, wtCfg.z + t * wtSpan], [wtCfg.x + s * (wtSpan - 0.48), wtY + deckH - 0.06, wtCfg.z + t * wtSpan], 0.045, 0.045, 4, pal.timberDark, pal.timber, false);
      baker.addBeam('solid', [wtCfg.x + s * wtSpan, wtY + deckH - 0.52, wtCfg.z + t * wtSpan], [wtCfg.x + s * wtSpan, wtY + deckH - 0.06, wtCfg.z + t * (wtSpan - 0.48)], 0.045, 0.045, 4, pal.timberDark, pal.timber, false);
    }
  }
  // North bay diagonal X-brace
  baker.addBeam('solid', [wtCfg.x - wtSpan, wtY + 0.25, wtCfg.z - wtSpan], [wtCfg.x + wtSpan, wtY + deckH - 0.12, wtCfg.z - wtSpan], 0.042, 0.042, 4, pal.timberDark, pal.timber, false);
  baker.addBeam('solid', [wtCfg.x + wtSpan, wtY + 0.25, wtCfg.z - wtSpan], [wtCfg.x - wtSpan, wtY + deckH - 0.12, wtCfg.z - wtSpan], 0.042, 0.042, 4, pal.timberDark, pal.timber, false);

  // Under-deck farmstead storage: stacked split firewood logs ('柴薪垛') + 2 woven grain baskets
  for (let row = 0; row < 3; row++) {
    const count = 4 - row;
    for (let k = 0; k < count; k++) {
      const lx = wtCfg.x - 0.55 + (k - (count - 1) * 0.5) * 0.19;
      const ly = wtY + 0.11 + row * 0.14;
      baker.addBeam('solid', [lx, ly, wtCfg.z - 0.85], [lx, ly, wtCfg.z - 0.15], 0.075, 0.072, 5, pal.timberDark, '#A6885E', true);
    }
  }
  baker.addCylinder('solid', wtCfg.x + 0.68, wtY + 0.20, wtCfg.z - 0.42, 0.26, 0.21, 0.38, 8, 0, pal.bambooDry, pal.timber);
  baker.addCone('solid', wtCfg.x + 0.68, wtY + 0.41, wtCfg.z - 0.42, 0.23, 0.09, 7, 0, pal.cornGold, pal.thatch);

  // Cantilevered upper floor joists ('挑梁') + planked lookout deck + openwork bamboo balustrade with vertical balusters
  const deckSpan = wtSpan + 0.26;
  for (let j = -2; j <= 2; j++) {
    const jz = wtCfg.z + j * 0.68;
    baker.addBox('solid', wtCfg.x, wtY + deckH - 0.08, jz, deckSpan * 2 + 0.16, 0.10, 0.11, 0, pal.timberDark, pal.timber);
  }
  for (let pl = 0; pl < 7; pl++) {
    const px = wtCfg.x + lerp(-deckSpan + 0.18, deckSpan - 0.18, pl / 6);
    baker.addBox('solid', px, wtY + deckH + 0.02, wtCfg.z, 0.39, 0.07, deckSpan * 2, 0, pl % 2 === 0 ? pal.timber : '#866C4B', pal.timberDark);
  }
  // Openwork bamboo balustrade (leave narrow ladder entry gap on west side)
  const railR = deckSpan - 0.08;
  for (const s of [-1, 1]) {
    // North & South full bamboo rails + 5 vertical balusters each
    baker.addBeam('solid', [wtCfg.x - railR, wtY + deckH + 0.72, wtCfg.z + s * railR], [wtCfg.x + railR, wtY + deckH + 0.72, wtCfg.z + s * railR], 0.044, 0.044, 5, pal.bambooDry, pal.timber, true);
    baker.addBeam('solid', [wtCfg.x - railR, wtY + deckH + 0.38, wtCfg.z + s * railR], [wtCfg.x + railR, wtY + deckH + 0.38, wtCfg.z + s * railR], 0.034, 0.034, 5, pal.bambooCulm, pal.bambooDry, true);
    for (let bIdx = 0; bIdx <= 5; bIdx++) {
      const bx = wtCfg.x + lerp(-railR, railR, bIdx / 5);
      baker.addBeam('solid', [bx, wtY + deckH + 0.05, wtCfg.z + s * railR], [bx, wtY + deckH + 0.72, wtCfg.z + s * railR], 0.024, 0.024, 4, pal.bambooDry, pal.timber, false);
    }
  }
  // East full rail + balusters
  baker.addBeam('solid', [wtCfg.x + railR, wtY + deckH + 0.72, wtCfg.z - railR], [wtCfg.x + railR, wtY + deckH + 0.72, wtCfg.z + railR], 0.044, 0.044, 5, pal.bambooDry, pal.timber, true);
  baker.addBeam('solid', [wtCfg.x + railR, wtY + deckH + 0.38, wtCfg.z - railR], [wtCfg.x + railR, wtY + deckH + 0.38, wtCfg.z + railR], 0.034, 0.034, 5, pal.bambooCulm, pal.bambooDry, true);
  for (let bIdx = 1; bIdx <= 4; bIdx++) {
    const bz = wtCfg.z + lerp(-railR, railR, bIdx / 5);
    baker.addBeam('solid', [wtCfg.x + railR, wtY + deckH + 0.05, bz], [wtCfg.x + railR, wtY + deckH + 0.72, bz], 0.024, 0.024, 4, pal.bambooDry, pal.timber, false);
  }
  // West rail split around ladder opening
  for (const [z0, z1] of [[-railR, -0.34], [0.34, railR]]) {
    baker.addBeam('solid', [wtCfg.x - railR, wtY + deckH + 0.72, wtCfg.z + z0], [wtCfg.x - railR, wtY + deckH + 0.72, wtCfg.z + z1], 0.044, 0.044, 5, pal.bambooDry, pal.timber, true);
    baker.addBeam('solid', [wtCfg.x - railR, wtY + deckH + 0.38, wtCfg.z + z0], [wtCfg.x - railR, wtY + deckH + 0.38, wtCfg.z + z1], 0.034, 0.034, 5, pal.bambooCulm, pal.bambooDry, true);
  }

  // Real 7-rung wooden ladder ('七级木梯': 2 angled side stringers + 7 round rungs)
  const ladBotX = wtCfg.x - deckSpan - 0.72;
  const ladTopX = wtCfg.x - deckSpan + 0.04;
  for (const lzOff of [-0.24, 0.24]) {
    baker.addBeam('solid', [ladBotX, wtY + 0.02, wtCfg.z + lzOff], [ladTopX, wtY + deckH + 0.45, wtCfg.z + lzOff], 0.042, 0.038, 5, pal.timber, pal.timberDark, true);
  }
  for (let rg = 1; rg <= 7; rg++) {
    const t = rg / 8;
    const rx = lerp(ladBotX, ladTopX, t);
    const ry = lerp(wtY + 0.04, wtY + deckH + 0.36, t);
    baker.addBeam('solid', [rx, ry, wtCfg.z - 0.24], [rx, ry, wtCfg.z + 0.24], 0.024, 0.024, 5, pal.bambooDry, pal.timber, false);
  }

  // Sculpted hanging golden millet & corn bundles under south deck & eave + bamboo bird-clapper
  baker.withTag('millet-hang', () => {
    for (const ox of [-0.95, -0.52, -0.10, 0.35, 0.82]) {
      const hx = wtCfg.x + ox, hz = wtCfg.z + deckSpan + 0.04;
      baker.addBeam('solid', [hx, wtY + deckH - 0.02, hz], [hx - 0.03, wtY + deckH - 0.44, hz + 0.02], 0.072, 0.038, 6, pal.cornGold, '#B68E3C', true);
      baker.addBeam('solid', [hx + 0.04, wtY + deckH - 0.04, hz], [hx + 0.07, wtY + deckH - 0.38, hz - 0.02], 0.058, 0.030, 5, '#DFBC64', pal.cornGold, true);
    }
  });
  // Top eave ring-beams + sweeping hip-gable ('歇山顶') layered thatch roof + gable lattice vents
  for (const s of [-1, 1]) {
    baker.addBox('solid', wtCfg.x, wtY + roofEaveH + 0.04, wtCfg.z + s * wtSpan, wtSpan * 2 + 0.3, 0.13, 0.13, 0, pal.timberDark, pal.timber);
    baker.addBox('solid', wtCfg.x + s * wtSpan, wtY + roofEaveH + 0.04, wtCfg.z, 0.13, 0.13, wtSpan * 2 + 0.3, 0, pal.timberDark, pal.timber);
  }
  const wtEaveW = 2.18;
  const wtRidgeHalf = 0.86;
  const wtEaveY = wtY + roofEaveH - 0.04;
  const wtGableBaseY = wtY + roofEaveH + 0.56;
  const wtRidgeY = wtY + roofEaveH + 1.32;

  // Exposed rafters neatly tucked inside hip-gable trapezoid & below thatch underside (zero roof piercing!)
  for (let rf = -3; rf <= 3; rf++) {
    const rxBot = wtCfg.x + rf * 0.56;
    const rxTop = wtCfg.x + rf * 0.34;
    for (const s of [-1, 1]) {
      baker.addBeam('solid', [rxTop, wtGableBaseY - 0.11, wtCfg.z + s * 1.14], [rxBot, wtEaveY - 0.12, wtCfg.z + s * (wtEaveW - 0.12)], 0.032, 0.026, 4, pal.timberDark, pal.timber, false);
    }
  }
  // East & West triangular timber gable vents ('歇山山花木棂')
  for (const s of [-1, 1]) {
    const gx = wtCfg.x + s * wtRidgeHalf;
    baker.addTri('solid', gx, wtRidgeY - 0.04, wtCfg.z, gx, wtGableBaseY, wtCfg.z - 1.15 * s, gx, wtGableBaseY, wtCfg.z + 1.15 * s, pal.timberDark);
    for (const vz of [-0.45, 0, 0.45]) {
      baker.addBeam('solid', [gx + s * 0.03, wtGableBaseY + 0.04, wtCfg.z + vz], [gx + s * 0.03, wtRidgeY - 0.22 - Math.abs(vz) * 0.42, wtCfg.z + vz], 0.022, 0.022, 4, pal.bambooDry, pal.timber, false);
    }
  }
  baker.withTag('frost-roof', () => {
    const hipFaces = [
      // South & North main upper slopes + flared lower hip skirts
      [[-wtEaveW, wtEaveY, wtEaveW], [wtEaveW, wtEaveY, wtEaveW], [wtRidgeHalf + 0.38, wtGableBaseY, 1.18], [-wtRidgeHalf - 0.38, wtGableBaseY, 1.18], pal.thatchLight],
      [[-wtRidgeHalf - 0.38, wtGableBaseY, 1.18], [wtRidgeHalf + 0.38, wtGableBaseY, 1.18], [wtRidgeHalf, wtRidgeY, 0], [-wtRidgeHalf, wtRidgeY, 0], pal.thatch],
      [[wtEaveW, wtEaveY, -wtEaveW], [-wtEaveW, wtEaveY, -wtEaveW], [-wtRidgeHalf - 0.38, wtGableBaseY, -1.18], [wtRidgeHalf + 0.38, wtGableBaseY, -1.18], pal.thatchLight],
      [[wtRidgeHalf + 0.38, wtGableBaseY, -1.18], [-wtRidgeHalf - 0.38, wtGableBaseY, -1.18], [-wtRidgeHalf, wtRidgeY, 0], [wtRidgeHalf, wtRidgeY, 0], pal.thatch],
      // East & West flared lower hip skirts
      [[wtEaveW, wtEaveY, wtEaveW], [wtEaveW, wtEaveY, -wtEaveW], [wtRidgeHalf + 0.38, wtGableBaseY, -1.18], [wtRidgeHalf + 0.38, wtGableBaseY, 1.18], pal.thatchLight],
      [[-wtEaveW, wtEaveY, -wtEaveW], [-wtEaveW, wtEaveY, wtEaveW], [-wtRidgeHalf - 0.38, wtGableBaseY, 1.18], [-wtRidgeHalf - 0.38, wtGableBaseY, -1.18], pal.thatchLight]
    ];
    for (const [p0, p1, p2, p3, col] of hipFaces) {
      const w0 = [wtCfg.x + p0[0], p0[1], wtCfg.z + p0[2]];
      const w1 = [wtCfg.x + p1[0], p1[1], wtCfg.z + p1[2]];
      const w2 = [wtCfg.x + p2[0], p2[1], wtCfg.z + p2[2]];
      const w3 = [wtCfg.x + p3[0], p3[1], wtCfg.z + p3[2]];
      baker.addQuad('solid', w0, w1, w2, w3, col, 0.02);
      baker.addQuad('solid', w1, w0, w3, w2, pal.timberDark, -0.05);
    }
    // Bound thatch ridge pole ('草脊')
    baker.addBeam('solid', [wtCfg.x - wtRidgeHalf - 0.16, wtRidgeY + 0.04, wtCfg.z], [wtCfg.x + wtRidgeHalf + 0.16, wtRidgeY + 0.04, wtCfg.z], 0.12, 0.12, 7, pal.thatchLight, pal.thatch, true);
  });
  shelters.push({ x: wtCfg.x, z: wtCfg.z, rx: 1.95, rz: 1.95, rot: 0, roofY: wtY + roofEaveH + 0.8, kind: 'pavilion' });
  blockers.push({ x: wtCfg.x, z: wtCfg.z, hw: 1.52, hd: 1.52, rot: 0, minY: wtY, maxY: wtY + 2.4, source: 'vb-watchtower' });

  // Ground-level south veranda mortised timber bench for scenic rest overlooking brook & terraces
  const wtBenchX = wtCfg.x + 0.15;
  const wtBenchZ = wtCfg.z + wtSpan + 0.58;
  const wtBenchY = surface(wtBenchX, wtBenchZ);
  baker.addBox('solid', wtBenchX, wtBenchY + 0.24, wtBenchZ, 1.32, 0.08, 0.40, 0, pal.timber, pal.timberDark);
  for (const bxOff of [-0.48, 0.48]) {
    baker.addBox('solid', wtBenchX + bxOff, wtBenchY + 0.04, wtBenchZ, 0.18, 0.08, 0.38, 0, pal.stone, pal.stoneDark);
    baker.addBeam('solid', [wtBenchX + bxOff, wtBenchY + 0.06, wtBenchZ - 0.13], [wtBenchX + bxOff, wtBenchY + 0.22, wtBenchZ - 0.09], 0.045, 0.042, 4, pal.timberDark, pal.timber, false);
    baker.addBeam('solid', [wtBenchX + bxOff, wtBenchY + 0.06, wtBenchZ + 0.13], [wtBenchX + bxOff, wtBenchY + 0.22, wtBenchZ + 0.09], 0.045, 0.042, 4, pal.timberDark, pal.timber, false);
  }

  res.circles.push({ x: wtCfg.x, z: wtCfg.z, r: 4.4, source: 'vb-watchtower' });
  contactTargets.push({ id: 'vb-watchtower', kind: 'house', x: wtCfg.x, z: wtCfg.z, gy: wtY, w: 3.2, d: 3.2, rot: 0, owner: group });

  restSeats.push({
    id: 'watchtower-seat',
    name: '北麓望稼楼',
    prompt: '小憩望稼 · 北麓望稼楼',
    x: wtBenchX,
    y: wtBenchY,
    z: wtBenchZ,
    seatY: 0.34,
    lookX: 38.0,
    lookY: wtBenchY + 1.25,
    lookZ: -222.0,
    exitAngle: Math.PI * 0.5
  });

  // ============================================================================
  // 8. 西坞山阴药庐、三层竹晒架、石药碾、百草药畦与山泉连筒竹炉茶灶
  // ============================================================================
  const hcCfg = cfg.landmarks.herbCottage;
  const hcY = surface(hcCfg.x, hcCfg.z);
  const hcRot = hcCfg.rot || 0.24;
  const cosH = Math.cos(hcRot);
  const sinH = Math.sin(hcRot);
  const localToWorld = (lx, lz) => [
    hcCfg.x + lx * cosH + lz * sinH,
    hcCfg.z - lx * sinH + lz * cosH
  ];
  const hcPt = (lx, ly, lz) => [
    hcCfg.x + lx * cosH + lz * sinH,
    hcY + ly,
    hcCfg.z - lx * sinH + lz * cosH
  ];

  // Compacted earth courtyard + bluestone stepping stones ('汀步青石') + rubble-stone foundation plinth
  const [courtX, courtZ] = localToWorld(0, 1.35);
  baker.addBox('ground', courtX, hcY + 0.028, courtZ, 7.8, 0.055, 6.8, hcRot, pal.path, pal.pathEdge);
  for (const [stX, stZ] of [[-0.55, 2.35], [-0.42, 3.05], [-0.15, 3.75], [1.45, 2.85], [2.55, 3.15]]) {
    const [wx, wz] = localToWorld(stX, stZ);
    baker.addCylinder('ground', wx, surface(wx, wz) + 0.045, wz, 0.28, 0.31, 0.05, 7, hcRot + stX, pal.flagstone, pal.stone);
  }

  const hwC = hcCfg.w * 0.5;
  const hdC = hcCfg.d * 0.5;
  const plinthTop = 0.26;
  const wallH = 2.28;
  const wallTopY = plinthTop + wallH;
  const ridgeY = wallTopY + 1.24;

  // Stepped rubble-stone plinth + rammed-earth/lime-plaster walls + FULL East & West triangular gable walls (zero roof gaps!)
  baker.addBox('solid', hcCfg.x, hcY + 0.04, hcCfg.z, hcCfg.w + 0.46, 0.48, hcCfg.d + 0.46, hcRot, pal.stone, pal.stoneDark);
  baker.addBox('solid', hcCfg.x, hcY + plinthTop + wallH * 0.5, hcCfg.z, hcCfg.w, wallH, hcCfg.d, hcRot, pal.plaster, pal.rammedEarth);
  for (const s of [-1, 1]) {
    const gx = s * (hwC - 0.02);
    const gPeak = hcPt(gx, ridgeY - 0.04, 0);
    const gSouth = hcPt(gx, wallTopY - 0.02, hdC);
    const gNorth = hcPt(gx, wallTopY - 0.02, -hdC);
    if (s > 0) baker.addTri('solid', gPeak[0], gPeak[1], gPeak[2], gNorth[0], gNorth[1], gNorth[2], gSouth[0], gSouth[1], gSouth[2], pal.plaster);
    else baker.addTri('solid', gPeak[0], gPeak[1], gPeak[2], gSouth[0], gSouth[1], gSouth[2], gNorth[0], gNorth[1], gNorth[2], pal.plaster);
    // Gable timber collar beam & king-post ('山墙梁架')
    baker.addBeam('solid', hcPt(s * (hwC + 0.03), wallTopY, -hdC - 0.05), hcPt(s * (hwC + 0.03), wallTopY, hdC + 0.05), 0.058, 0.058, 4, pal.timberDark, pal.timber, true);
    baker.addBeam('solid', hcPt(s * (hwC + 0.03), wallTopY, 0), hcPt(s * (hwC + 0.03), ridgeY - 0.06, 0), 0.052, 0.048, 4, pal.timberDark, pal.timber, false);
  }
  // 4 corner timber pillars + south/north eave wall-plates
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const [px, pz] = localToWorld(sx * hwC, sz * hdC);
      baker.addBox('solid', px, hcY + plinthTop + wallH * 0.5, pz, 0.14, wallH + 0.04, 0.14, hcRot, pal.timberDark, pal.timber);
    }
    baker.addBeam('solid', hcPt(-hwC - 0.1, wallTopY, sx * hdC), hcPt(hwC + 0.1, wallTopY, sx * hdC), 0.06, 0.06, 4, pal.timberDark, pal.timber, true);
  }

  // Recessed timber doorway + stone threshold + half-open twin wooden plank doors
  const [doorWx, doorWz] = localToWorld(-0.62, hdC + 0.02);
  baker.addBox('solid', doorWx, hcY + plinthTop + 0.88, doorWz, 1.06, 1.78, 0.08, hcRot, '#383029', '#383029');
  // Door jambs, lintel & stone threshold
  for (const dxJ of [-0.52, 0.52]) {
    const [jx, jz] = localToWorld(-0.62 + dxJ, hdC + 0.05);
    baker.addBox('solid', jx, hcY + plinthTop + 0.90, jz, 0.09, 1.82, 0.12, hcRot, pal.timberDark, pal.timber);
  }
  const [lintX, lintZ] = localToWorld(-0.62, hdC + 0.06);
  baker.addBox('solid', lintX, hcY + plinthTop + 1.80, lintZ, 1.18, 0.11, 0.15, hcRot, pal.timberDark, pal.timber);
  baker.addBox('solid', lintX, hcY + plinthTop + 0.05, lintZ, 1.12, 0.10, 0.18, hcRot, pal.stoneLight, pal.stoneDark);
  // Twin plank door leaves (left closed, right swung slightly inward/ajar)
  const [dlX, dlZ] = localToWorld(-0.85, hdC + 0.05);
  baker.addBox('solid', dlX, hcY + plinthTop + 0.89, dlZ, 0.46, 1.68, 0.05, hcRot, pal.timber, pal.timberDark);
  const [drX, drZ] = localToWorld(-0.36, hdC - 0.08);
  baker.addBox('solid', drX, hcY + plinthTop + 0.89, drZ, 0.46, 1.68, 0.05, hcRot + 0.55, pal.timber, pal.timberDark);

  // Detailed propped lattice casement window ('支摘窗': dark recess, frame, 4 vertical lattice bars, sill, propped shutter & 2 bamboo poles)
  const [winWx, winWz] = localToWorld(1.12, hdC + 0.02);
  baker.addBox('solid', winWx, hcY + 1.42, winWz, 1.12, 0.82, 0.07, hcRot, '#3B342D', '#3B342D');
  const [sillX, sillZ] = localToWorld(1.12, hdC + 0.07);
  baker.addBox('solid', sillX, hcY + 1.00, sillZ, 1.24, 0.07, 0.16, hcRot, pal.timber, pal.timberDark);
  baker.addBox('solid', sillX, hcY + 1.84, sillZ, 1.24, 0.07, 0.14, hcRot, pal.timberDark, pal.timber);
  for (let m = -2; m <= 2; m++) {
    const [mx, mz] = localToWorld(1.12 + m * 0.22, hdC + 0.05);
    baker.addBox('solid', mx, hcY + 1.42, mz, m === -2 || m === 2 ? 0.06 : 0.028, 0.78, 0.06, hcRot, m === -2 || m === 2 ? pal.timberDark : pal.bambooDry, pal.timber);
  }
  const [canopyWx, canopyWz] = localToWorld(1.12, hdC + 0.40);
  baker.addTiltedBox('solid', canopyWx, hcY + 1.72, canopyWz, 1.18, 0.05, 0.82, -0.46, hcRot, 0, pal.bambooDry, pal.timber);
  for (const pxOff of [-0.48, 0.48]) {
    baker.addBeam('solid', hcPt(1.12 + pxOff, 1.08, hdC + 0.06), hcPt(1.12 + pxOff, 1.56, hdC + 0.70), 0.018, 0.016, 4, pal.bambooCulm, pal.bambooDry, false);
  }

  // Extended south bamboo veranda posts, hanging dried herb bundles & apothecary wooden mortar
  for (const pxOff of [-hwC + 0.15, hwC - 0.15]) {
    const pFoot = hcPt(pxOff, 0.03, hdC + 0.92);
    const pHead = hcPt(pxOff, wallTopY - 0.18, hdC + 0.92);
    baker.addCylinder('solid', pFoot[0], surface(pFoot[0], pFoot[2]) + 0.05, pFoot[2], 0.11, 0.13, 0.10, 6, 0, pal.stone, pal.stoneDark);
    baker.addBeam('solid', [pFoot[0], surface(pFoot[0], pFoot[2]) + 0.08, pFoot[2]], pHead, 0.052, 0.048, 6, pal.bambooDry, pal.timber, false);
  }
  baker.addBeam('solid', hcPt(-hwC - 0.15, wallTopY - 0.18, hdC + 0.92), hcPt(hwC + 0.15, wallTopY - 0.18, hdC + 0.92), 0.048, 0.048, 5, pal.bambooDry, pal.timber, true);
  // Hanging dried mugwort & perilla herb bundles + warm veranda paper lantern under porch beam + wooden mortar by door
  for (const hxOff of [0.22, 0.62, 1.78, 2.12]) {
    const hbTop = hcPt(hxOff, wallTopY - 0.20, hdC + 0.92);
    baker.addCone('solid', hbTop[0], hbTop[1] - 0.22, hbTop[2], 0.095, 0.34, 6, hxOff, hxOff > 1 ? pal.herbPerilla : pal.teaDeep, pal.bambooDry);
  }
  const hcLanTop = hcPt(1.18, wallTopY - 0.18, hdC + 0.92);
  const hcLanMid = hcPt(1.18, wallTopY - 0.44, hdC + 0.92);
  baker.addBeam('solid', hcLanTop, hcPt(1.18, wallTopY - 0.31, hdC + 0.92), 0.010, 0.010, 4, pal.timberDark, pal.timberDark, false);
  baker.addCylinder('solid', hcLanMid[0], hcLanMid[1] + 0.13, hcLanMid[2], 0.08, 0.12, 0.04, 6, hcRot, pal.timberDark, pal.timber);
  baker.addCylinder('solid', hcLanMid[0], hcLanMid[1] - 0.13, hcLanMid[2], 0.11, 0.08, 0.035, 6, hcRot, pal.timberDark, pal.timber);
  const [mortX, mortZ] = localToWorld(-1.55, hdC + 0.52);
  const mortY = surface(mortX, mortZ);
  baker.addCylinder('solid', mortX, mortY + 0.20, mortZ, 0.20, 0.23, 0.38, 8, 0, pal.timber, pal.timberDark);
  baker.addHollowCylinder('solid', mortX, mortY + 0.40, mortZ, 0.21, 0.14, 0.06, 8, 0, '#967A56', pal.timberDark);
  baker.addBeam('solid', [mortX, mortY + 0.36, mortZ], [mortX + 0.10, mortY + 0.64, mortZ + 0.06], 0.028, 0.036, 5, pal.bambooDry, pal.timber, true);

  // Sweeping multi-course thatched overhang gable roof + 9 exposed bamboo rafters tucked below concave underside + ridge roll + clay stove chimney
  const roofHalfW = hwC + 0.68;
  const southEaveZ = hdC + 1.12;
  const northEaveZ = -hdC - 0.72;
  const southEaveY = wallTopY - 0.28;
  const northEaveY = wallTopY - 0.10;

  for (let rf = 0; rf < 9; rf++) {
    const lx = lerp(-roofHalfW + 0.18, roofHalfW - 0.18, rf / 8);
    baker.addBeam('solid', hcPt(lx, ridgeY - 0.14, 0), hcPt(lx, southEaveY - 0.12, southEaveZ - 0.06), 0.030, 0.024, 4, pal.timberDark, pal.bambooDry, false);
    baker.addBeam('solid', hcPt(lx, ridgeY - 0.14, 0), hcPt(lx, northEaveY - 0.12, northEaveZ + 0.06), 0.030, 0.024, 4, pal.timberDark, pal.bambooDry, false);
  }
  baker.withTag('frost-roof', () => {
    const sMidZ = hdC * 0.48, sMidY = lerp(southEaveY, ridgeY, 0.56) - 0.05;
    const nMidZ = -hdC * 0.48, nMidY = lerp(northEaveY, ridgeY, 0.54) - 0.04;

    // Concave two-segment south & north roof slopes + dark underside reed lining
    const slopes = [
      [hcPt(-roofHalfW, southEaveY, southEaveZ), hcPt(roofHalfW, southEaveY, southEaveZ), hcPt(roofHalfW, sMidY, sMidZ), hcPt(-roofHalfW, sMidY, sMidZ), pal.thatchLight],
      [hcPt(-roofHalfW, sMidY, sMidZ), hcPt(roofHalfW, sMidY, sMidZ), hcPt(roofHalfW, ridgeY, 0), hcPt(-roofHalfW, ridgeY, 0), pal.thatch],
      [hcPt(roofHalfW, northEaveY, northEaveZ), hcPt(-roofHalfW, northEaveY, northEaveZ), hcPt(-roofHalfW, nMidY, nMidZ), hcPt(roofHalfW, nMidY, nMidZ), pal.thatchLight],
      [hcPt(roofHalfW, nMidY, nMidZ), hcPt(-roofHalfW, nMidY, nMidZ), hcPt(-roofHalfW, ridgeY, 0), hcPt(roofHalfW, ridgeY, 0), pal.thatch]
    ];
    for (const [p0, p1, p2, p3, col] of slopes) {
      baker.addQuad('solid', p0, p1, p2, p3, col, 0.02);
      baker.addQuad('solid', p1, p0, p3, p2, pal.timberDark, -0.05);
    }
    // Staggered thatch courses along south & north slopes
    for (const side of [1, -1]) {
      const eZ = side > 0 ? southEaveZ : northEaveZ;
      const eY = side > 0 ? southEaveY : northEaveY;
      for (let row = 0; row < 4; row++) {
        const v0 = row / 4, v1 = (row + 0.88) / 4;
        for (let col = 0; col < 8; col++) {
          const x0 = lerp(-roofHalfW + 0.06, roofHalfW - 0.06, (col + 0.04) / 8);
          const x1 = lerp(-roofHalfW + 0.06, roofHalfW - 0.06, (col + 0.96) / 8);
          const yAt = (v) => lerp(eY, ridgeY, v) - Math.sin(v * Math.PI) * 0.05 + 0.028;
          const zAt = (v) => lerp(eZ, 0, v);
          const q0 = hcPt(x0, yAt(v0), zAt(v0));
          const q1 = hcPt(x1, yAt(v0), zAt(v0));
          const q2 = hcPt(x1, yAt(v1), zAt(v1));
          const q3 = hcPt(x0, yAt(v1), zAt(v1));
          if (side > 0) baker.addQuad('solid', q0, q1, q2, q3, (row + col) % 2 === 0 ? pal.thatchLight : pal.thatch);
          else baker.addQuad('solid', q1, q0, q3, q2, (row + col) % 2 === 0 ? pal.thatchLight : pal.thatch);
        }
      }
    }
    // Bound bamboo & straw ridge roll ('草脊')
    baker.addBeam('solid', hcPt(-roofHalfW - 0.08, ridgeY + 0.05, 0), hcPt(roofHalfW + 0.08, ridgeY + 0.05, 0), 0.12, 0.12, 7, pal.thatchLight, pal.thatch, true);
  });
  // Timber bargeboards ('博风板') + stone-and-clay herb-decoction chimney flue on north-east roof slope
  for (const s of [-1, 1]) {
    const bx = s * roofHalfW;
    baker.addBeam('solid', hcPt(bx, ridgeY + 0.02, 0), hcPt(bx, southEaveY, southEaveZ), 0.048, 0.042, 4, pal.timberDark, pal.timber, true);
    baker.addBeam('solid', hcPt(bx, ridgeY + 0.02, 0), hcPt(bx, northEaveY, northEaveZ), 0.048, 0.042, 4, pal.timberDark, pal.timber, true);
  }
  const [chimX, chimZ] = localToWorld(1.55, -0.68);
  baker.addBox('solid', chimX, hcY + ridgeY - 0.05, chimZ, 0.36, 0.68, 0.36, hcRot, pal.stone, pal.stoneDark);
  baker.addTiltedBox('solid', chimX, hcY + ridgeY + 0.34, chimZ, 0.48, 0.05, 0.48, 0.12, hcRot, 0, pal.clayGrey, pal.stoneDark);

  const [hcEaveX, hcEaveZ] = localToWorld(0, hdC + 0.48);
  shelters.push({ x: hcEaveX, z: hcEaveZ, rx: hcCfg.w * 0.56, rz: 1.25, rot: hcRot, roofY: hcY + wallH + 0.85, kind: 'eave' });

  // Openwork 3-tier A-frame bamboo herb-drying rack ('三层竹编晒药架' — real angled bamboo poles & 3 rimmed herb trays!)
  const [rackX, rackZ] = localToWorld(-2.15, 2.55);
  const rackY = surface(rackX, rackZ);
  const rkPt = (lx, ly, lz) => [rackX + lx * cosH + lz * sinH, rackY + ly, rackZ - lx * sinH + lz * cosH];
  for (const lxEnd of [-0.68, 0.68]) {
    baker.addBeam('solid', rkPt(lxEnd, -0.02, -0.36), rkPt(lxEnd, 1.38, -0.02), 0.032, 0.026, 5, pal.timber, pal.bambooDry, true);
    baker.addBeam('solid', rkPt(lxEnd, -0.02, 0.40), rkPt(lxEnd, 1.38, 0.02), 0.032, 0.026, 5, pal.timber, pal.bambooDry, true);
  }
  baker.addBeam('solid', rkPt(-0.78, 1.35, 0), rkPt(0.78, 1.35, 0), 0.030, 0.030, 5, pal.bambooDry, pal.bambooCulm, true);
  const rackLevels = [
    { h: 0.46, zOff: 0.14, herbHex: pal.herbCalamus },
    { h: 0.86, zOff: 0.09, herbHex: pal.herbChrys },
    { h: 1.22, zOff: 0.04, herbHex: pal.herbPerilla }
  ];
  for (const rl of rackLevels) {
    baker.addBeam('solid', rkPt(-0.74, rl.h - 0.03, rl.zOff - 0.20), rkPt(0.74, rl.h - 0.03, rl.zOff - 0.20), 0.024, 0.024, 4, pal.bambooDry, pal.timber, false);
    baker.addBeam('solid', rkPt(-0.74, rl.h - 0.08, rl.zOff + 0.22), rkPt(0.74, rl.h - 0.08, rl.zOff + 0.22), 0.024, 0.024, 4, pal.bambooDry, pal.timber, false);
    // 2 woven round trays per shelf tier
    for (const txOff of [-0.36, 0.36]) {
      const trayC = rkPt(txOff, rl.h, rl.zOff);
      baker.addCylinder('solid', trayC[0], trayC[1], trayC[2], 0.30, 0.28, 0.028, 8, hcRot, pal.bambooDry, pal.timber);
      baker.addHollowCylinder('solid', trayC[0], trayC[1] + 0.025, trayC[2], 0.31, 0.26, 0.042, 8, hcRot, '#CBB782', pal.bambooDry);
      baker.withTag('herb-rack-top', () => {
        baker.addCone('solid', trayC[0], trayC[1] + 0.055, trayC[2], 0.23, 0.075, 7, txOff, rl.herbHex, rl.herbHex);
      });
    }
  }
  blockers.push({ x: rackX, z: rackZ, hw: 0.75, hd: 0.42, rot: hcRot, minY: rackY, maxY: rackY + 1.4, source: 'vb-herb-rack' });

  // Authentic boat-trough stone apothecary herb roller ('铁轴石药碾')
  const [rollerX, rollerZ] = localToWorld(2.15, 2.35);
  const rollerY = surface(rollerX, rollerZ);
  const rlRot = hcRot + 0.30;
  const rlC = Math.cos(rlRot), rlS = Math.sin(rlRot);
  const rlPt = (lx, ly, lz) => [rollerX + lx * rlC + lz * rlS, rollerY + ly, rollerZ - lx * rlS + lz * rlC];
  // Two stone support blocks + boat-shaped trough cheeks & upturned ends + vertical grinding wheel + wooden axle handle
  for (const sx of [-0.34, 0.34]) {
    const sp = rlPt(sx, 0.09, 0);
    baker.addBox('solid', sp[0], sp[1], sp[2], 0.22, 0.18, 0.44, rlRot, pal.stoneDark, pal.stoneDark);
  }
  baker.addArchSlab('solid', rollerX, rollerY + 0.24, rollerZ, 1.16, 0.38, 0.12, -0.06, 5, rlRot, pal.stone, pal.stoneDark);
  for (const sz of [-0.17, 0.17]) {
    const wp = rlPt(0, 0.32, sz);
    baker.addArchSlab('solid', wp[0], wp[1], wp[2], 1.18, 0.07, 0.14, -0.05, 5, rlRot, pal.stoneLight, pal.stone);
  }
  // Vertical round grinding stone wheel + wooden two-hand axle rod
  baker.addBeam('solid', rlPt(0, 0.44, -0.06), rlPt(0, 0.44, 0.06), 0.25, 0.25, 10, pal.stoneLight, pal.stone, true);
  baker.addBeam('solid', rlPt(0, 0.44, -0.28), rlPt(0, 0.44, 0.28), 0.028, 0.028, 6, pal.timber, pal.timberDark, true);
  blockers.push({ x: rollerX, z: rollerZ, hw: 0.56, hd: 0.32, rot: rlRot, minY: rollerY, maxY: rollerY + 0.75, source: 'vb-herb-roller' });

  blockers.push({ x: hcCfg.x, z: hcCfg.z, hw: hcCfg.w * 0.52, hd: hcCfg.d * 0.52, rot: hcRot, minY: hcY - 0.2, maxY: hcY + wallH + 1.2, source: 'vb-herb-cottage' });
  res.circles.push({ x: hcCfg.x, z: hcCfg.z, r: 5.8, source: 'vb-herb-cottage' });
  contactTargets.push({ id: 'vb-herb-cottage', kind: 'house', x: hcCfg.x, z: hcCfg.z, gy: hcY, w: hcCfg.w, d: hcCfg.d, rot: hcRot, owner: group });

  // 4 Stone-curbed furrowed medicinal herb beds ('百草药畦': individual split-stone curbs + 3 dark-loam ridges + bamboo tally stakes)
  const herbBeds = [];
  for (let bIdx = 0; bIdx < 4; bIdx++) {
    const colIdx = bIdx % 2;
    const rowIdx = Math.floor(bIdx / 2);
    const [bx, bz] = localToWorld(-5.2 - colIdx * 3.1, -0.8 + rowIdx * 2.6);
    const by = surface(bx, bz);
    const hbPt = (lx, ly, lz) => [bx + lx * cosH + lz * sinH, by + ly, bz - lx * sinH + lz * cosH];

    // Dark-loam bed base + 3 raised soil ridges
    baker.addBox('ground', bx, by + 0.04, bz, 2.42, 0.08, 1.82, hcRot, '#6F5F48', '#594C39');
    for (const rzOff of [-0.54, 0.0, 0.54]) {
      const rp = hbPt(0, 0.095, rzOff);
      baker.addBox('ground', rp[0], rp[1], rp[2], 2.26, 0.075, 0.38, hcRot, '#7D6C53', '#63543F');
    }
    // Perimeter split-stone curb blocks around the 4 sides
    for (const s of [-1, 1]) {
      for (let k = -1; k <= 1; k++) {
        const cp = hbPt(k * 0.82, 0.08, s * 0.96);
        baker.addBox('solid', cp[0], surface(cp[0], cp[2]) + 0.08, cp[2], 0.76, 0.18, 0.16, hcRot + (k * 0.03), k % 2 === 0 ? pal.stoneLight : pal.stone, pal.stoneDark);
      }
      for (const kz of [-0.46, 0.46]) {
        const cp = hbPt(s * 1.28, 0.08, kz);
        baker.addBox('solid', cp[0], surface(cp[0], cp[2]) + 0.08, cp[2], 0.16, 0.18, 0.82, hcRot, pal.stone, pal.stoneDark);
      }
    }
    // Small angled bamboo herb-name stake ('竹药签') at front-east corner
    baker.addBeam('solid', hbPt(1.02, 0.06, 0.76), hbPt(1.06, 0.42, 0.80), 0.016, 0.014, 4, pal.bambooDry, '#DECBA0', true);
    const stakeTag = hbPt(1.06, 0.38, 0.80);
    baker.addBox('solid', stakeTag[0], stakeTag[1], stakeTag[2], 0.08, 0.16, 0.018, hcRot + 0.2, '#E2D2AA', pal.bambooDry);

    res.circles.push({ x: bx, z: bz, r: 1.75, source: 'vb-herb-bed' });
    herbBeds.push({ x: bx, y: by, z: bz, rot: hcRot, kind: bIdx });
  }

  // 山泉竹炉茶灶 (Interactive E tactile tea stove at -14.2, -222.2: rock table, tripod clay wind-stove, kettle with handle/spout, forked-post bamboo spring aqueduct & hollowed water basin)
  const tsCfg = cfg.landmarks.teaStove;
  const tsY = surface(tsCfg.x, tsCfg.z);
  // Natural flat-topped bluestone tea rock table + mossy companion rock
  baker.addFacetedRock('solid', tsCfg.x, tsY + 0.18, tsCfg.z, 0.64, 0.46, 0.56, 0.25, 1501, { ...rockPalOpts, hasMoss: false });
  baker.addCylinder('solid', tsCfg.x, tsY + 0.42, tsCfg.z, 0.56, 0.60, 0.08, 8, 0.25, pal.stoneLight, pal.stone);
  baker.addFacetedRock('solid', tsCfg.x - 0.62, tsY + 0.12, tsCfg.z + 0.36, 0.30, 0.34, 0.28, 0.9, 1509, rockPalOpts);

  // Tripod red-clay charcoal wind stove ('红泥三足风炉') with glowing ember opening
  const stvX = tsCfg.x - 0.12, stvZ = tsCfg.z + 0.04, stvBaseY = tsY + 0.46;
  for (let f = 0; f < 3; f++) {
    const a = (f / 3) * TAU + 0.4;
    baker.addBeam('solid', [stvX + Math.cos(a) * 0.13, stvBaseY, stvZ + Math.sin(a) * 0.13], [stvX + Math.cos(a) * 0.10, stvBaseY + 0.09, stvZ + Math.sin(a) * 0.10], 0.032, 0.028, 5, '#7A4331', pal.clayRed, true);
  }
  baker.addCylinder('solid', stvX, stvBaseY + 0.18, stvZ, 0.18, 0.145, 0.21, 8, 0, pal.clayRed, '#733F2E');
  baker.addHollowCylinder('solid', stvX, stvBaseY + 0.29, stvZ, 0.195, 0.14, 0.04, 8, 0, '#B26B52', pal.clayRed);
  // Glowing charcoal hearth vent on south face of stove
  baker.addBox('solid', stvX + 0.02, stvBaseY + 0.15, stvZ + 0.15, 0.09, 0.075, 0.04, 0.15, '#E27A3F', '#8F3E24');

  // Sculpted dark-sand tea kettle ('瓦铫') with spout, lid knob & overarching bamboo handle ('提梁')
  const ketY = stvBaseY + 0.38;
  baker.addCylinder('solid', stvX, ketY, stvZ, 0.125, 0.155, 0.15, 8, 0, pal.clayGrey, pal.stoneDark);
  baker.addCylinder('solid', stvX, ketY + 0.085, stvZ, 0.095, 0.125, 0.035, 8, 0, '#8D8C83', pal.clayGrey);
  baker.addCone('solid', stvX, ketY + 0.12, stvZ, 0.032, 0.04, 6, 0, pal.timberDark, pal.clayGrey);
  baker.addBeam('solid', [stvX + 0.11, ketY + 0.01, stvZ], [stvX + 0.21, ketY + 0.08, stvZ], 0.028, 0.016, 5, pal.clayGrey, pal.stoneDark, false);
  // Overarching bent-bamboo handle
  baker.addBeam('solid', [stvX, ketY + 0.07, stvZ - 0.11], [stvX, ketY + 0.21, stvZ - 0.05], 0.014, 0.013, 4, pal.bambooDry, pal.timber, false);
  baker.addBeam('solid', [stvX, ketY + 0.21, stvZ - 0.05], [stvX, ketY + 0.21, stvZ + 0.05], 0.014, 0.014, 4, pal.bambooDry, pal.bambooDry, false);
  baker.addBeam('solid', [stvX, ketY + 0.21, stvZ + 0.05], [stvX, ketY + 0.07, stvZ + 0.11], 0.013, 0.014, 4, pal.bambooDry, pal.timber, false);

  // Bamboo tea tray, tea canister & 3 thin-rimmed celadon tea bowls
  baker.addBox('solid', tsCfg.x + 0.23, tsY + 0.47, tsCfg.z + 0.02, 0.34, 0.024, 0.28, -0.18, pal.bambooDry, pal.timber);
  baker.addCylinder('solid', tsCfg.x + 0.16, tsY + 0.53, tsCfg.z - 0.08, 0.045, 0.048, 0.10, 7, 0, pal.bambooCulm, pal.bambooDry);
  for (const [cxOff, czOff] of [[0.22, 0.08], [0.31, -0.02], [0.30, 0.11]]) {
    baker.addHollowCylinder('solid', tsCfg.x + cxOff, tsY + 0.505, tsCfg.z + czOff, 0.044, 0.030, 0.048, 7, 0, '#B0CABC', '#7E9B8C');
  }

  // Hollowed round stone spring basin ('石水钵') + 2-stage split-bamboo spring aqueduct ('引泉连筒') on forked wooden Y-posts
  const basX = tsCfg.x + 0.56, basZ = tsCfg.z - 0.42;
  const basY = surface(basX, basZ);
  baker.addCylinder('solid', basX, basY + 0.14, basZ, 0.32, 0.28, 0.28, 8, 0, pal.stone, pal.stoneDark);
  baker.addHollowCylinder('solid', basX, basY + 0.31, basZ, 0.33, 0.23, 0.10, 8, 0, pal.stoneLight, pal.stone);
  baker.addCylinder('water', basX, basY + 0.31, basZ, 0.23, 0.23, 0.03, 8, 0, pal.water, pal.waterDeep);

  const aqSrc = [tsCfg.x + 1.95, surface(tsCfg.x + 1.95, tsCfg.z - 1.65) + 0.92, tsCfg.z - 1.65];
  const aqMid = [tsCfg.x + 1.18, basY + 0.72, tsCfg.z - 0.98];
  const aqLip = [basX + 0.08, basY + 0.54, basZ - 0.08];
  baker.addBeam('solid', aqSrc, aqMid, 0.048, 0.044, 6, pal.bamboo, pal.bambooCulm, true);
  baker.addBeam('solid', [aqMid[0] - 0.02, aqMid[1] - 0.03, aqMid[2] + 0.02], aqLip, 0.044, 0.038, 6, pal.bambooCulm, pal.bambooDry, true);
  // Forked wooden Y-props ('木丫杈') supporting the bamboo aqueduct
  for (const p of [aqMid, [lerp(aqSrc[0], aqMid[0], 0.35), lerp(aqSrc[1], aqMid[1], 0.35), lerp(aqSrc[2], aqMid[2], 0.35)]]) {
    const gy = surface(p[0], p[2]);
    baker.addBeam('solid', [p[0], gy - 0.04, p[2]], [p[0], p[1] - 0.12, p[2]], 0.032, 0.026, 5, pal.timberDark, pal.timber, false);
    baker.addBeam('solid', [p[0], p[1] - 0.12, p[2]], [p[0] - 0.09, p[1] + 0.04, p[2] - 0.04], 0.020, 0.016, 4, pal.timber, pal.timber, false);
    baker.addBeam('solid', [p[0], p[1] - 0.12, p[2]], [p[0] + 0.09, p[1] + 0.04, p[2] + 0.04], 0.020, 0.016, 4, pal.timber, pal.timber, false);
  }
  // Slender glistening spring water thread pouring from bamboo spout into stone basin
  baker.addBeam('water', aqLip, [basX + 0.04, basY + 0.31, basZ - 0.04], 0.022, 0.034, 5, pal.waterFoam, pal.water, false);

  blockers.push({ x: tsCfg.x, z: tsCfg.z, hw: 0.58, hd: 0.58, rot: 0, minY: tsY, maxY: tsY + 0.95, source: 'vb-tea-stove' });
  res.circles.push({ x: tsCfg.x, z: tsCfg.z, r: 1.8, source: 'vb-tea-stove' });

  interactiveSites.push({
    ...cfg.interactions.teaStove,
    x: tsCfg.x,
    y: tsY,
    z: tsCfg.z,
    height: 0.82,
    soundKind: 'tea',
    playIndex: 0,
    cooldown: 0
  });

  // Finalize baked static meshes (ground, solid, water)
  const groundMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2
  });
  const solidMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true
  });
  const waterMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true
  });

  const groundMesh = baker.buildMesh('ground', groundMat, 'valley-borderlands-ground');
  const solidMesh = baker.buildMesh('solid', solidMat, 'valley-borderlands-solid');
  const waterMesh = baker.buildMesh('water', waterMat, 'valley-borderlands-water');
  if (groundMesh) group.add(groundMesh);
  if (solidMesh) group.add(solidMesh);
  if (waterMesh) group.add(waterMesh);

  // ============================================================================
  // 9. 实例化植被与青绿山石合批 (Pines, Blossom Trees, Bamboo, Tea/Herbs, Crags, Meadow)
  // ============================================================================
  const pineGeo = buildCliffPineGeometry(pal);
  const blossomGeo = buildBlossomTreeGeometry();
  const bambooGeo = buildHillsideBambooGeometry(pal);
  const shrubGeo = buildTeaOrHerbShrubGeometry();
  const cragGeo = buildStratifiedCragGeometry(pal);
  const tuftGeo = buildMeadowTuftGeometry();

  const pineMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const blossomMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const bambooMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const shrubMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const cragMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const tuftMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });

  const pineRecords = [];
  const blossomRecords = [];
  const bambooRecords = [];
  const shrubRecords = [];
  const cragRecords = [];
  const tuftRecords = [];
  const teaRowPolylines = [];

  // 9a. Hero & slope Song-Yuan crooked cliff pines (迎客苍松)
  const rngPine = makeRng(cfg.seed, 'cliff-pines');
  const heroPines = [
    [pavCfg.x + 3.6, pavCfg.z + 2.8, 1.32, -0.6],
    [pavCfg.x - 1.2, pavCfg.z - 3.9, 1.18, 1.1],
    [stCfg.x + 1.8, stCfg.z - 1.5, 1.38, -2.4],
    [wf.poolX - 6.8, wf.poolZ + 1.2, 1.28, 0.8],
    [wf.poolX + 6.9, wf.poolZ + 0.6, 1.24, -1.2],
    [hcCfg.x - 4.6, hcCfg.z - 4.2, 1.20, 0.5]
  ];
  for (const [hx, hz, sc, yaw] of heroPines) {
    const hy = surface(hx, hz);
    pineRecords.push({ x: hx, y: hy, z: hz, scale: sc, yaw, tint: '#FFFFFF' });
    res.circles.push({ x: hx, z: hz, r: 1.4, source: 'vb-hero-pine' });
    blockers.push({ x: hx, z: hz, hw: 0.26 * sc, hd: 0.26 * sc, rot: 0, minY: hy - 0.1, maxY: hy + 2.4 * sc, source: 'vb-pine' });
  }
  targets.push({ id: 'cliff-pine', x: heroPines[2][0], y: surface(heroPines[2][0], heroPines[2][1]) + 1.8, z: heroPines[2][1], range: 9.5 });

  // Scatter pines across East slope, North ridge foothills, and West/Northwest rim
  const pineZones = [
    { x0: 108, x1: 146, z0: -206, z1: -102, weight: 0.42 },
    { x0: -68, x1: 92, z0: -260, z1: -226, weight: 0.36 },
    { x0: -84, x1: -36, z0: -228, z1: -112, weight: 0.22 }
  ];
  const pineTints = ['#FFFFFF', '#EBF3EE', '#DCEBE3', '#F2F5EC'];
  let pineTries = 0;
  while (pineRecords.length < cfg.counts.pines && pineTries < 2200) {
    pineTries++;
    const pick = rngPine();
    const zDef = pick < 0.42 ? pineZones[0] : pick < 0.78 ? pineZones[1] : pineZones[2];
    const x = lerp(zDef.x0, zDef.x1, rngPine());
    const z = lerp(zDef.z0, zDef.z1, rngPine());
    if (!isBorderlandSafe(x, z, 1.65, res, { maxBasinR: 142, maxSlope: 0.38, clearance: 0.55 })) continue;
    const sc = 0.88 + rngPine() * 0.54;
    const y = surface(x, z);
    pineRecords.push({
      x, y, z,
      scale: sc,
      yaw: rngPine() * TAU,
      tint: pineTints[pineRecords.length % pineTints.length]
    });
    res.circles.push({ x, z, r: 1.55 * sc, source: 'vb-pine' });
    if (Math.hypot(x - res.basin.x, z - res.basin.z) < 124) {
      blockers.push({ x, z, hw: 0.22 * sc, hd: 0.22 * sc, rot: 0, minY: y - 0.1, maxY: y + 2.2 * sc, source: 'vb-pine' });
    }
  }

  // 9b. Mountain Apricot & Wild Green-Calyx Plum Trees (山杏野梅)
  const rngBlossom = makeRng(cfg.seed, 'blossom-trees');
  const blossomTints = [pal.apricot, pal.plumWhite, pal.apricotDeep, '#DCE8CE'];
  const blossomZones = [
    { x0: 82, x1: 128, z0: -196, z1: -142 },
    { x0: 12, x1: 78, z0: -238, z1: -210 },
    { x0: -62, x1: -6, z0: -242, z1: -196 }
  ];
  let blossomTries = 0;
  while (blossomRecords.length < cfg.counts.blossomTrees && blossomTries < 2000) {
    blossomTries++;
    const zDef = blossomZones[blossomTries % blossomZones.length];
    const x = lerp(zDef.x0, zDef.x1, rngBlossom());
    const z = lerp(zDef.z0, zDef.z1, rngBlossom());
    if (!isBorderlandSafe(x, z, 1.65, res, { maxBasinR: 132, maxSlope: 0.32, clearance: 0.65 })) continue;
    const sc = 0.85 + rngBlossom() * 0.42;
    const y = surface(x, z);
    blossomRecords.push({
      x, y, z,
      scale: sc,
      yaw: rngBlossom() * TAU,
      tint: blossomTints[blossomRecords.length % blossomTints.length]
    });
    res.circles.push({ x, z, r: 1.6 * sc, source: 'vb-blossom' });
    if (Math.hypot(x - res.basin.x, z - res.basin.z) < 124) {
      blockers.push({ x, z, hw: 0.20 * sc, hd: 0.20 * sc, rot: 0, minY: y - 0.1, maxY: y + 2.0 * sc, source: 'vb-blossom' });
    }
  }

  // 9c. Hillside Bamboo Clusters (山坡修竹, bridging East bamboo groves + herb cottage + north brook)
  const rngBam = makeRng(cfg.seed, 'hillside-bamboo');
  const bamZones = [
    { x0: 100, x1: 128, z0: -188, z1: -146 }, // Bridges upper-edge bamboo to village.bamboo!
    { x0: 118, x1: 138, z0: -146, z1: -108 }, // Upper flank behind east bamboo
    { x0: -32, x1: -8, z0: -238, z1: -218 },  // Behind herb cottage
    { x0: 14, x1: 36, z0: -246, z1: -228 }    // Beside north brook & waterfall
  ];
  let bamTries = 0;
  while (bambooRecords.length < cfg.counts.bambooClusters && bamTries < 2200) {
    bamTries++;
    const zDef = bamZones[bamTries % bamZones.length];
    const x = lerp(zDef.x0, zDef.x1, rngBam());
    const z = lerp(zDef.z0, zDef.z1, rngBam());
    if (!isBorderlandSafe(x, z, 1.05, res, { maxBasinR: 134, maxSlope: 0.34, clearance: 0.42 })) continue;
    const sc = 0.86 + rngBam() * 0.38;
    const y = surface(x, z);
    bambooRecords.push({
      x, y, z,
      scale: sc,
      yaw: rngBam() * TAU,
      tint: bambooRecords.length % 3 === 0 ? '#F2F6E6' : '#FFFFFF'
    });
    res.circles.push({ x, z, r: 0.95 * sc, source: 'vb-bamboo' });
  }

  // 9d. Contour Wild Tea Rows + Herb Bed Plants + Terrace Rice/Taro Shoots
  const rngShrub = makeRng(cfg.seed, 'tea-herbs');
  // Structured curved wild tea rows on West foothill (-48..-24, -236..-208)
  for (let row = 0; row < 5; row++) {
    const baseZ = -212.0 - row * 4.4;
    const rowPts = [];
    for (let s = 0; s <= 15; s++) {
      const u = s / 15;
      const x = lerp(-24.5, -49.5, u);
      const z = baseZ - Math.sin(u * Math.PI) * 3.4 + Math.cos(u * 4.2 + row) * 0.6;
      if (!isBorderlandSafe(x, z, 0.52, res, { maxBasinR: 126, maxSlope: 0.34, clearance: 0.22 })) continue;
      const y = surface(x, z);
      shrubRecords.push({
        x, y, z,
        role: 'tea',
        sx: 0.92 + rngShrub() * 0.18,
        sy: 0.85 + rngShrub() * 0.22,
        sz: 0.88 + rngShrub() * 0.18,
        yaw: rngShrub() * TAU,
        tint: (s + row) % 3 === 0 ? pal.teaBud : (s % 2 === 0 ? pal.teaMid : pal.teaDeep)
      });
      rowPts.push([x, z]);
    }
    if (rowPts.length >= 2) teaRowPolylines.push(rowPts);
  }
  if (teaRowPolylines.length > 0) {
    const midRow = teaRowPolylines[Math.floor(teaRowPolylines.length / 2)];
    const mp = midRow[Math.floor(midRow.length / 2)];
    targets.push({ id: 'wild-tea-herbs', x: mp[0], y: surface(mp[0], mp[1]) + 0.55, z: mp[1], range: 8.5 });
  }

  // Herb bed medicinal plants (紫苏, 甘菊, 菖蒲)
  const herbColors = [pal.herbPerilla, pal.herbChrys, pal.herbCalamus, pal.teaBud];
  for (const bed of herbBeds) {
    const cb = Math.cos(bed.rot), sb = Math.sin(bed.rot);
    for (const lx of [-0.75, 0, 0.75]) {
      for (const lz of [-0.45, 0.45]) {
        const wx = bed.x + lx * cb + lz * sb;
        const wz = bed.z - lx * sb + lz * cb;
        shrubRecords.push({
          x: wx,
          y: bed.y + 0.08,
          z: wz,
          role: 'herb',
          bedKind: bed.kind,
          sx: 0.52,
          sy: 0.64,
          sz: 0.52,
          yaw: rngShrub() * TAU,
          tint: herbColors[bed.kind % herbColors.length]
        });
      }
    }
  }

  // Young paddy / taro shoot clusters inside terraced paddies
  for (const tier of builtTerraces) {
    for (let s = 1; s < tier.inner.length - 1; s += 2) {
      if (shrubRecords.length >= cfg.counts.teaAndHerbShrubs) break;
      const tBlend = 0.35 + (s % 3) * 0.18;
      const sx = lerp(tier.inner[s][0], tier.outer[s][0], tBlend);
      const sz = lerp(tier.inner[s][1], tier.outer[s][1], tBlend);
      shrubRecords.push({
        x: sx,
        y: tier.waterY - 0.08,
        z: sz,
        role: 'paddy',
        sx: 0.56,
        sy: 0.68,
        sz: 0.56,
        yaw: rngShrub() * TAU,
        tint: pal.paddyShoot
      });
    }
  }

  // 9e. Song-Yuan Stratified Mossy Crags (青绿山骨叠石 across East/North/West slopes)
  const rngCrag = makeRng(cfg.seed, 'stratified-crags');
  const cragZones = [
    { x0: 102, x1: 148, z0: -206, z1: -98 },
    { x0: -68, x1: 98, z0: -260, z1: -222 },
    { x0: -84, x1: -34, z0: -226, z1: -108 },
    { x0: 84, x1: 112, z0: -164, z1: -132 } // Pasture卧羊石 accents
  ];
  let cragTries = 0;
  while (cragRecords.length < cfg.counts.crags && cragTries < 2400) {
    cragTries++;
    const zDef = cragZones[cragTries % cragZones.length];
    const x = lerp(zDef.x0, zDef.x1, rngCrag());
    const z = lerp(zDef.z0, zDef.z1, rngCrag());
    const inPasture = zDef === cragZones[3];
    const sc = inPasture ? (0.65 + rngCrag() * 0.45) : (0.95 + rngCrag() * 1.35);
    if (!isBorderlandSafe(x, z, 0.95 * sc, res, { maxBasinR: 146, maxSlope: 0.44, clearance: 0.45 })) continue;
    const y = surface(x, z);
    cragRecords.push({
      x, y, z,
      sx: sc * (0.88 + rngCrag() * 0.35),
      sy: sc * (0.72 + rngCrag() * 0.52),
      sz: sc * (0.86 + rngCrag() * 0.34),
      yaw: rngCrag() * TAU,
      tint: cragRecords.length % 3 === 0 ? '#E8EFEA' : '#FFFFFF'
    });
    res.circles.push({ x, z, r: 0.9 * sc, source: 'vb-crag' });
    if (sc > 1.15 && Math.hypot(x - res.basin.x, z - res.basin.z) < 124) {
      blockers.push({ x, z, hw: 0.68 * sc, hd: 0.58 * sc, rot: 0, minY: y - 0.3, maxY: y + 0.95 * sc, source: 'vb-crag' });
    }
  }

  // 9f. Mountain Meadow Grass, Fern & Wildflower Tufts (filling west x < -6, north z < -240, and east slopes)
  const rngTuft = makeRng(cfg.seed, 'meadow-tufts');
  const tuftTints = ['#7EA058', '#95B26B', '#6D8F52', '#B7C882', '#DCE3B8'];
  const tuftZones = [
    { x0: -78, x1: 88, z0: -254, z1: -206 },
    { x0: 78, x1: 142, z0: -202, z1: -108 },
    { x0: -78, x1: -4, z0: -208, z1: -106 }
  ];
  let tuftTries = 0;
  while (tuftRecords.length < cfg.counts.meadowTufts && tuftTries < 3600) {
    tuftTries++;
    const zDef = tuftZones[tuftTries % tuftZones.length];
    const x = lerp(zDef.x0, zDef.x1, rngTuft());
    const z = lerp(zDef.z0, zDef.z1, rngTuft());
    if (!isBorderlandSafe(x, z, 0.32, res, { maxBasinR: 138, maxSlope: 0.40, clearance: 0.15 })) continue;
    const y = surface(x, z);
    const sc = 0.65 + rngTuft() * 0.68;
    tuftRecords.push({
      x, y, z,
      scale: sc,
      yaw: rngTuft() * TAU,
      tint: tuftTints[tuftRecords.length % tuftTints.length]
    });
  }

  function buildStaticInstanced(geo, mat, list, name) {
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
    group.add(mesh);
    return mesh;
  }

  const pineMesh = buildStaticInstanced(pineGeo, pineMat, pineRecords, 'valley-borderlands-pines');
  const blossomMesh = buildStaticInstanced(blossomGeo, blossomMat, blossomRecords, 'valley-borderlands-blossoms');
  const bambooMesh = buildStaticInstanced(bambooGeo, bambooMat, bambooRecords, 'valley-borderlands-bamboo');
  const shrubMesh = buildStaticInstanced(shrubGeo, shrubMat, shrubRecords, 'valley-borderlands-shrubs');
  const cragMesh = buildStaticInstanced(cragGeo, cragMat, cragRecords, 'valley-borderlands-crags');
  const tuftMesh = buildStaticInstanced(tuftGeo, tuftMat, tuftRecords, 'valley-borderlands-tufts');

  // Add select tree contact shadows
  for (let i = 0; i < Math.min(28, pineRecords.length); i += 2) {
    const p = pineRecords[i];
    contactTargets.push({ id: 'vb-pine-' + i, kind: 'tree', x: p.x, z: p.z, scale: clamp(p.scale * 1.05, 0.85, 1.45), owner: group });
  }
  for (let i = 0; i < Math.min(24, blossomRecords.length); i += 2) {
    const p = blossomRecords[i];
    contactTargets.push({ id: 'vb-blossom-' + i, kind: 'tree', x: p.x, z: p.z, scale: clamp(p.scale * 0.95, 0.80, 1.30), owner: group });
  }

  // ============================================================================
  // 10. 动态水花茶烟、昼夜灯火流萤、活态生灵与山野村人
  // ============================================================================
  const dynamicGroup = new THREE.Group();
  dynamicGroup.name = 'valley-borderlands-dynamic';
  dynamicGroup.userData.dynamic = true;
  group.add(dynamicGroup);

  // 10a. Waterfall cascade foam drops + plunge mist + tea-stove steam (1 InstancedMesh = 1 draw call)
  const waterFxGeo = buildWaterFxGeometry();
  const waterFxMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const WATER_FX_SLOTS = 34; // 0..21 cascade drops, 22..27 pool mist, 28..33 tea steam
  const waterFxMesh = new THREE.InstancedMesh(waterFxGeo, waterFxMat, WATER_FX_SLOTS);
  waterFxMesh.name = 'valley-borderlands-water-fx';
  waterFxMesh.userData.dynamic = true;
  waterFxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  waterFxMesh.frustumCulled = false;
  for (let i = 0; i < WATER_FX_SLOTS; i++) {
    waterFxMesh.setColorAt(i, tmpCol.set(i < 22 ? pal.waterFoam : '#F5F7F2'));
  }
  if (waterFxMesh.instanceColor) waterFxMesh.instanceColor.needsUpdate = true;
  dynamicGroup.add(waterFxMesh);

  // 10b. Dusk/Night Warm Lanterns & Brook Fireflies (0 daytime draw calls when hidden!)
  const glowGeo = buildWaterFxGeometry();
  const glowMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
  glowMat.userData.skyIgnore = true;
  const fireflyCount = cfg.counts.fireflies || 18;
  const GLOW_SLOTS = 4 + fireflyCount; // 0: pavilion lantern, 1: watchtower lantern, 2: herb cottage window, 3: tea stove embers, 4..: fireflies
  const glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, GLOW_SLOTS);
  glowMesh.name = 'valley-borderlands-glow';
  glowMesh.userData.dynamic = true;
  glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glowMesh.frustumCulled = false;
  glowMesh.visible = false;

  const lanternPositions = [
    { x: pavCfg.x - 0.55, y: pavFloorY + colH - 0.18, z: pavCfg.z + 0.42, sx: 0.24, sy: 0.34, sz: 0.24, col: pal.lanternWarm },
    { x: wtCfg.x, y: wtY + roofEaveH - 0.22, z: wtCfg.z + wtSpan, sx: 0.24, sy: 0.34, sz: 0.24, col: pal.lanternWarm },
    { x: hcLanMid[0], y: hcLanMid[1], z: hcLanMid[2], sx: 0.22, sy: 0.26, sz: 0.22, col: pal.lanternWarm },
    { x: tsCfg.x - 0.10, y: tsY + 0.54, z: tsCfg.z + 0.04, sx: 0.18, sy: 0.12, sz: 0.18, col: '#FF9E58' }
  ];
  const fireflyAnchors = [];
  const rngFly = makeRng(cfg.seed, 'fireflies');
  for (let i = 0; i < fireflyCount; i++) {
    const onBrook = i % 2 === 0;
    const bp = brookPts[Math.min(brookPts.length - 1, Math.floor(rngFly() * brookPts.length))];
    const fx = onBrook ? bp[0] + (rngFly() - 0.5) * 6.0 : hcCfg.x - 3.5 + (rngFly() - 0.5) * 9.0;
    const fz = onBrook ? bp[1] + (rngFly() - 0.5) * 6.0 : hcCfg.z + (rngFly() - 0.5) * 9.0;
    fireflyAnchors.push({
      x: fx,
      y: surface(fx, fz) + 0.65 + rngFly() * 1.1,
      z: fz,
      phase: rngFly() * TAU,
      speed: 0.7 + rngFly() * 0.6
    });
  }
  for (let i = 0; i < GLOW_SLOTS; i++) {
    const colHex = i < 4 ? lanternPositions[i].col : pal.firefly;
    glowMesh.setColorAt(i, tmpCol.set(colHex));
  }
  if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
  dynamicGroup.add(glowMesh);

  // 10c. Sculpted Borderland Wildlife + Seasonal Petals/Leaves in 1 Single RigidBatchMesh (1 draw call!)
  const goatParts = createMountainGoatParts();
  const egretParts = createWhiteEgretParts();
  const craneParts = createSoaringCraneParts();
  const butterflyParts = createButterflyParts();
  const petalGeoPink = createDriftingPetalLeafGeometry('#F4C9D1', '#F8EFE6');
  const petalGeoIvory = createDriftingPetalLeafGeometry('#F6F1E5', '#E8EFDE');

  const goatCount = cfg.counts.goats || 5;
  const egretCount = cfg.counts.egrets || 3;
  const craneCount = cfg.counts.cranes || 2;
  const butterflyCount = cfg.counts.butterflies || 8;
  const driftingLeafCount = cfg.counts.driftingLeaves || 28;

  const slotGeos = [];
  const goatSlots = [];
  for (let i = 0; i < goatCount; i++) {
    goatSlots.push({ body: slotGeos.length, head: slotGeos.length + 1 });
    slotGeos.push(goatParts.bodyGeo, goatParts.headGeo);
  }
  const egretSlots = [];
  for (let i = 0; i < egretCount; i++) {
    egretSlots.push({ body: slotGeos.length, head: slotGeos.length + 1 });
    slotGeos.push(egretParts.bodyGeo, egretParts.headGeo);
  }
  const craneSlots = [];
  for (let i = 0; i < craneCount; i++) {
    craneSlots.push({ body: slotGeos.length, wingL: slotGeos.length + 1, wingR: slotGeos.length + 2 });
    slotGeos.push(craneParts.bodyGeo, craneParts.wingLGeo, craneParts.wingRGeo);
  }
  const butterflySlots = [];
  for (let i = 0; i < butterflyCount; i++) {
    butterflySlots.push({ wingL: slotGeos.length, wingR: slotGeos.length + 1 });
    slotGeos.push(butterflyParts.wingLGeo, butterflyParts.wingRGeo);
  }

  let leafVertOffset = 0;
  for (let i = 0; i < slotGeos.length; i++) {
    leafVertOffset += slotGeos[i].getAttribute('position').count;
  }
  const driftingLeafSlots = [];
  for (let i = 0; i < driftingLeafCount; i++) {
    driftingLeafSlots.push(slotGeos.length);
    slotGeos.push(i % 3 === 0 ? petalGeoIvory : petalGeoPink);
  }
  const leafVertPerSlot = petalGeoPink.getAttribute('position').count;

  const faunaMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const faunaBatch = createRigidBatchMesh(slotGeos, faunaMat, 'valley-borderlands-fauna');
  dynamicGroup.add(faunaBatch.mesh);

  // Initialize goat herd on East Sunny Pasture (东皋牧羊坡)
  const pastCfg = cfg.landmarks.eastPasture;
  const goatActors = [];
  for (let i = 0; i < goatCount; i++) {
    const ang = (i / goatCount) * TAU + 0.4;
    const rad = i === goatCount - 1 ? 1.4 : 2.6 + (i % 2) * 2.2;
    const gx = pastCfg.x + Math.cos(ang) * rad;
    const gz = pastCfg.z + Math.sin(ang) * rad;
    const isKid = i === goatCount - 1;
    goatActors.push({
      homeX: gx,
      homeZ: gz,
      x: gx,
      y: surface(gx, gz),
      z: gz,
      yaw: ang + Math.PI * 0.5,
      scale: isKid ? 0.66 : (0.94 + (i % 3) * 0.06),
      phase: i * 1.45,
      orbitR: isKid ? 1.5 : 1.1 + (i % 2) * 0.7,
      speed: isKid ? 0.42 : 0.22 + i * 0.03
    });
  }
  if (goatActors.length > 0) {
    const g0 = goatActors[0];
    targets.push({
      id: 'mountain-goat',
      x: g0.x,
      y: g0.y + 0.55,
      z: g0.z,
      range: 8.5,
      resolve: () => ({ x: g0.x, y: g0.y + 0.55, z: g0.z })
    });
  }

  // Initialize wading terrace egrets
  const egretActors = [];
  for (let i = 0; i < egretCount; i++) {
    const tier = builtTerraces[Math.min(builtTerraces.length - 1, i)];
    const idx = Math.min(tier.inner.length - 2, 4 + i * 4);
    const ex = lerp(tier.inner[idx][0], tier.outer[idx][0], 0.52);
    const ez = lerp(tier.inner[idx][1], tier.outer[idx][1], 0.52);
    egretActors.push({
      x: ex,
      y: tier.waterY - 0.03,
      z: ez,
      yaw: -0.6 + i * 0.9,
      phase: i * 2.1
    });
  }

  // Initialize soaring cranes above North Waterfall & Crags
  const craneActors = [];
  for (let i = 0; i < craneCount; i++) {
    craneActors.push({
      cx: wf.poolX + 6.0,
      cz: wf.poolZ + 8.0,
      rx: 18.0 + i * 2.5,
      rz: 12.5 + i * 1.8,
      baseY: poolWaterY + 15.5 + i * 1.6,
      phase: i * 0.55,
      speed: 0.15
    });
  }

  // Initialize butterflies over West Herb Beds & East Sunning Terrace
  const butterflyActors = [];
  for (let i = 0; i < butterflyCount; i++) {
    const inHerbs = i < 5 && herbBeds.length > 0;
    const hb = herbBeds[i % Math.max(1, herbBeds.length)];
    const bx = inHerbs ? hb.x : sunCfg.x + (i - 5.5) * 1.5;
    const bz = inHerbs ? hb.z : sunCfg.z + 1.2;
    butterflyActors.push({
      cx: bx,
      cz: bz,
      baseY: surface(bx, bz) + 0.72,
      phase: i * 1.15
    });
  }

  // Initialize drifting blossom petals (spring) / golden-russet leaves (autumn) around mountain trees
  const rngLeaf = makeRng(cfg.seed, 'drifting-petals');
  const driftingLeafActors = [];
  for (let i = 0; i < driftingLeafCount; i++) {
    const srcTree = blossomRecords.length > 0
      ? blossomRecords[(i * 3) % blossomRecords.length]
      : { x: sunCfg.x + (i % 5) * 2.2, y: sunY, z: sunCfg.z - 2.0, scale: 1.0 };
    driftingLeafActors.push({
      cx: srcTree.x + (rngLeaf() - 0.5) * 3.6,
      cz: srcTree.z + (rngLeaf() - 0.5) * 3.6,
      groundY: surface(srcTree.x, srcTree.z),
      spanY: 2.3 + rngLeaf() * 1.6,
      driftR: 0.75 + rngLeaf() * 1.15,
      fallSpeed: 0.14 + rngLeaf() * 0.09,
      spinSpeed: 1.1 + rngLeaf() * 1.3,
      phase: rngLeaf() * TAU,
      scale: 0.90 + rngLeaf() * 0.45
    });
  }

  // 10d. Two Living Borderland Villagers (西坞采药老丈 & 北垅望稼老农)
  const actorGroup = new THREE.Group();
  actorGroup.name = 'valley-borderlands-actors';
  actorGroup.userData.dynamic = true;
  dynamicGroup.add(actorGroup);
  const actorRig = options.actorRig ? options.actorRig.createChannel(actorGroup, 2) : createCommunityActors(actorGroup, 2);

  const herbalistX = tsCfg.x - 1.05;
  const herbalistZ = tsCfg.z + 0.92;
  const farmerX = wtCfg.x + 2.85;
  const farmerZ = wtCfg.z + 1.35;

  const villagers = [
    {
      index: 0,
      id: 'vb-herbalist',
      key: 'c_vb-herbalist',
      name: '采药老丈',
      label: '采药老丈',
      role: 'herbalist',
      voiceRole: 'elder',
      x: herbalistX,
      y: surface(herbalistX, herbalistZ),
      z: herbalistZ,
      facing: 0.55,
      kind: 'elder',
      female: false,
      child: false,
      s: 1.0,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '西坞背阴多云雾，最宜野茶与紫苏、桔梗生长；山泉刚煮沸，客人可去竹炉边试一盏新茗。',
        '先祖入谷时便在山阴辟了这几畦百草，春采嫩芽焙茶，秋收甘菊晒干，一年四季少有病痛。'
      ]
    },
    {
      index: 1,
      id: 'vb-terrace-farmer',
      key: 'c_vb-terrace-farmer',
      name: '北垅老农',
      label: '北垅老农',
      role: 'terrace_farmer',
      voiceRole: 'elder',
      x: farmerX,
      y: surface(farmerX, farmerZ),
      z: farmerZ,
      facing: 1.25,
      kind: 'elder',
      female: false,
      child: false,
      s: 1.0,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: true,
      lines: [
        '北涧三叠飞泉终年不涸，顺着青石渠引入这五级叠翠梯田，高处种芋、低处插秧，全赖山泉滋养。',
        '闲时登上这座望稼草楼南望，全村屋舍阡陌与梯田天光尽收眼底，最是舒怀。'
      ]
    }
  ];

  // ============================================================================
  // 11. 触感/碑刻交互绑定与逐帧确定性更新 (dt === 0 严格冻结)
  // ============================================================================
  let simTime = 0;
  let hasRenderedOnce = false;
  let teaSteamBoost = 0;
  let noteTimer = 0;
  let noteEl = null;
  let lastNoteText = '';
  let disposed = false;

  function triggerInteractiveSite(site, sound, doc) {
    if (!site) return null;
    site.cooldown = 2.4;
    const lines = site.lines || [];
    const text = lines[site.playIndex % Math.max(1, lines.length)] || site.name;
    site.playIndex++;
    lastNoteText = text;
    noteTimer = 4.8;
    if (site.soundKind === 'tea') {
      teaSteamBoost = 4.5;
    }
    const el = noteEl || doc?.getElementById?.('mystery-note');
    if (el) {
      el.textContent = text;
      el.classList?.add?.('show');
      el.setAttribute?.('aria-hidden', 'false');
    }
    try {
      sound?.unlock?.();
      if (site.soundKind === 'tea') {
        (sound?.teaSimmer || sound?.waterCup || sound?.gurgle || sound?.bell)?.call(sound, site.x, site.z);
      } else {
        (sound?.wood || sound?.bell)?.call(sound, site.x, site.z);
      }
    } catch (_) {
      // Headless / muted safe
    }
    return { id: site.id, name: site.name, line: text };
  }

  function pickBorderlandSite(camera, playerState, pickCfg = {}) {
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
      if (distXZ > 3.8) continue;
      const ty = s.y + s.height;
      const dx = s.x - eyeX, dy = ty - eyeY, dz = s.z - eyeZ;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const dot = (dx * fx + dy * fy + dz * fz) / dist;
      if (distXZ > 2.1 && dot < 0.70) continue;
      const score = dist + (1 - dot) * (pickCfg.alignBias || 2.5);
      if (!best || score < best.score) {
        best = {
          kind: 'mystery',
          key: 'vb:' + s.id,
          id: s.id,
          isBorderlandProp: true,
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
    if (!mysteries || mysteries._valleyBorderlandsBound) return;
    mysteries._valleyBorderlandsBound = true;
    const prevPick = mysteries.pickTarget;
    const prevInteract = mysteries.interact;
    const prevHide = mysteries.hide;

    mysteries.pickTarget = function (camera, pickCfg) {
      const a = prevPick?.(camera, pickCfg) || null;
      const b = pickBorderlandSite(camera, player?.state, pickCfg);
      if (!a) return b;
      if (!b) return a;
      return b.score < a.score ? b : a;
    };

    mysteries.interact = function (target) {
      if (target?.isBorderlandProp) {
        const s = interactiveSites.find(item => item.id === target.id);
        return triggerInteractiveSite(s, sound, doc);
      }
      return prevInteract?.(target) || null;
    };

    mysteries.hide = function () {
      noteTimer = 0;
      prevHide?.();
    };
  }

  // ============================================================================
  // 10e. 节气物候联动染霜 / 金粟 / 落英 (Spring / Summer / Autumn + Autumn Dawn Frost)
  // ============================================================================
  let currentPhenology = 'spring';
  let currentTimeId = 'day';
  let currentFrost = false;
  let colorSnapshotted = false;
  const colorSnaps = {};
  const frostRgb = new THREE.Color('#DCE6EA');
  const phenColA = new THREE.Color();
  const phenColB = new THREE.Color();

  function ensureColorSnapshots() {
    if (colorSnapshotted) return;
    colorSnapshotted = true;

    if (groundMesh?.geometry?.attributes?.color) {
      colorSnaps.ground = new Float32Array(groundMesh.geometry.attributes.color.array);
    }
    if (solidMesh?.geometry?.attributes?.color) {
      colorSnaps.solid = new Float32Array(solidMesh.geometry.attributes.color.array);
    }
    if (waterMesh?.geometry?.attributes?.color) {
      colorSnaps.water = new Float32Array(waterMesh.geometry.attributes.color.array);
    }
    if (pineGeo?.attributes?.color) {
      colorSnaps.pineGeo = new Float32Array(pineGeo.attributes.color.array);
    }
    if (blossomGeo?.attributes?.color) {
      const arr = blossomGeo.attributes.color.array;
      colorSnaps.blossomGeo = new Float32Array(arr);
      const mask = new Uint8Array(arr.length / 3);
      for (let v = 0, i = 0; v < mask.length; v++, i += 3) {
        if (arr[i] > 0.62 && arr[i + 1] > 0.62 && arr[i + 2] > 0.58) mask[v] = 1;
      }
      colorSnaps.blossomCrownMask = mask;
    }
    if (blossomMesh?.instanceColor?.array) {
      colorSnaps.blossomInst = new Float32Array(blossomMesh.instanceColor.array);
    }
    if (shrubGeo?.attributes?.color) {
      colorSnaps.shrubGeo = new Float32Array(shrubGeo.attributes.color.array);
    }
    if (shrubMesh?.instanceColor?.array) {
      colorSnaps.shrubInst = new Float32Array(shrubMesh.instanceColor.array);
    }
    if (cragGeo?.attributes?.color) {
      colorSnaps.cragGeo = new Float32Array(cragGeo.attributes.color.array);
    }
    if (tuftGeo?.attributes?.color) {
      colorSnaps.tuftGeo = new Float32Array(tuftGeo.attributes.color.array);
    }
    if (tuftMesh?.instanceColor?.array) {
      colorSnaps.tuftInst = new Float32Array(tuftMesh.instanceColor.array);
    }
    const faunaCol = faunaBatch.geo.getAttribute('color');
    if (faunaCol?.array) {
      const startF = leafVertOffset * 3;
      const endF = (leafVertOffset + driftingLeafCount * leafVertPerSlot) * 3;
      colorSnaps.faunaLeaves = new Float32Array(faunaCol.array.subarray(startF, endF));
    }
  }

  function tintTaggedVertices(mesh, baseArr, tagFilter, transformVertex) {
    if (!mesh?.geometry?.attributes?.color || !baseArr) return;
    const colAttr = mesh.geometry.attributes.color;
    const norAttr = mesh.geometry.attributes.normal;
    const posAttr = mesh.geometry.attributes.position;
    const dst = colAttr.array;
    const tags = mesh.userData.colorTags || [];
    for (let t = 0; t < tags.length; t++) {
      const entry = tags[t];
      if (!tagFilter(entry.tag)) continue;
      for (let v = entry.start; v < entry.end; v++) {
        const idx = v * 3;
        const ny = norAttr ? norAttr.array[idx + 1] : 1;
        const py = posAttr ? posAttr.array[idx + 1] : 0;
        transformVertex(dst, baseArr, idx, entry.tag, ny, py, v);
      }
    }
    colAttr.needsUpdate = true;
  }

  function applyBorderlandPhenology(phenId, frostActive) {
    ensureColorSnapshots();

    // 1. Exact byte-for-byte baseline restoration first (guarantees 100% clean spring return)
    if (groundMesh && colorSnaps.ground) {
      groundMesh.geometry.attributes.color.array.set(colorSnaps.ground);
      groundMesh.geometry.attributes.color.needsUpdate = true;
    }
    if (solidMesh && colorSnaps.solid) {
      solidMesh.geometry.attributes.color.array.set(colorSnaps.solid);
      solidMesh.geometry.attributes.color.needsUpdate = true;
    }
    if (waterMesh && colorSnaps.water) {
      waterMesh.geometry.attributes.color.array.set(colorSnaps.water);
      waterMesh.geometry.attributes.color.needsUpdate = true;
    }
    if (pineGeo && colorSnaps.pineGeo) {
      pineGeo.attributes.color.array.set(colorSnaps.pineGeo);
      pineGeo.attributes.color.needsUpdate = true;
    }
    if (blossomGeo && colorSnaps.blossomGeo) {
      blossomGeo.attributes.color.array.set(colorSnaps.blossomGeo);
      blossomGeo.attributes.color.needsUpdate = true;
    }
    if (blossomMesh?.instanceColor && colorSnaps.blossomInst) {
      blossomMesh.instanceColor.array.set(colorSnaps.blossomInst);
      blossomMesh.instanceColor.needsUpdate = true;
    }
    if (shrubGeo && colorSnaps.shrubGeo) {
      shrubGeo.attributes.color.array.set(colorSnaps.shrubGeo);
      shrubGeo.attributes.color.needsUpdate = true;
    }
    if (shrubMesh?.instanceColor && colorSnaps.shrubInst) {
      shrubMesh.instanceColor.array.set(colorSnaps.shrubInst);
      shrubMesh.instanceColor.needsUpdate = true;
    }
    if (cragGeo && colorSnaps.cragGeo) {
      cragGeo.attributes.color.array.set(colorSnaps.cragGeo);
      cragGeo.attributes.color.needsUpdate = true;
    }
    if (tuftGeo && colorSnaps.tuftGeo) {
      tuftGeo.attributes.color.array.set(colorSnaps.tuftGeo);
      tuftGeo.attributes.color.needsUpdate = true;
    }
    if (tuftMesh?.instanceColor && colorSnaps.tuftInst) {
      tuftMesh.instanceColor.array.set(colorSnaps.tuftInst);
      tuftMesh.instanceColor.needsUpdate = true;
    }
    const faunaColAttr = faunaBatch.geo.getAttribute('color');
    if (faunaColAttr && colorSnaps.faunaLeaves) {
      faunaColAttr.array.set(colorSnaps.faunaLeaves, leafVertOffset * 3);
      faunaColAttr.needsUpdate = true;
    }

    if (phenId === 'spring') return;

    const isSummer = phenId === 'summer';

    // 2. Stepped Terraced Water Mirror & Bund Turf
    tintTaggedVertices(waterMesh, colorSnaps.water, (tag) => tag === 'terrace-water', (dst, src, idx) => {
      if (isSummer) {
        // Deeper lush celadon-emerald water reflection
        dst[idx] = clamp(src[idx] * 0.86, 0.05, 1);
        dst[idx + 1] = clamp(src[idx + 1] * 1.05, 0.05, 1);
        dst[idx + 2] = clamp(src[idx + 2] * 0.94, 0.05, 1);
      } else {
        // Warm golden-amber panicle & autumn sky reflection in terraced water
        dst[idx] = clamp(src[idx] * 0.66 + 0.76 * 0.34, 0.05, 1);
        dst[idx + 1] = clamp(src[idx + 1] * 0.68 + 0.69 * 0.32, 0.05, 1);
        dst[idx + 2] = clamp(src[idx + 2] * 0.72 + 0.50 * 0.28, 0.05, 1);
      }
    });

    tintTaggedVertices(groundMesh, colorSnaps.ground, (tag) => tag === 'terrace-bund-grass', (dst, src, idx, _tag, ny) => {
      if (isSummer) {
        dst[idx] = clamp(src[idx] * 0.84, 0.05, 1);
        dst[idx + 1] = clamp(src[idx + 1] * 1.12, 0.05, 1);
        dst[idx + 2] = clamp(src[idx + 2] * 0.86, 0.05, 1);
      } else {
        let r = clamp(src[idx] * 1.24 + 0.06, 0.05, 1);
        let g = clamp(src[idx + 1] * 1.04 + 0.02, 0.05, 1);
        let b = clamp(src[idx + 2] * 0.78, 0.05, 1);
        if (frostActive && ny > 0.25) {
          const f = 0.28 * clamp(ny, 0.25, 1);
          r = lerp(r, frostRgb.r, f);
          g = lerp(g, frostRgb.g, f);
          b = lerp(b, frostRgb.b, f);
        }
        dst[idx] = r; dst[idx + 1] = g; dst[idx + 2] = b;
      }
    });

    tintTaggedVertices(groundMesh, colorSnaps.ground, (tag) => tag === 'vb-road', (dst, src, idx, _tag, ny) => {
      const sr = src[idx], sg = src[idx + 1], sb = src[idx + 2];
      const isMossy = sg > sr + 0.015;
      if (isSummer) {
        if (isMossy) {
          dst[idx] = clamp(sr * 0.78, 0.05, 1);
          dst[idx + 1] = clamp(sg * 1.14, 0.05, 1);
          dst[idx + 2] = clamp(sb * 0.80, 0.05, 1);
        } else {
          // 夏日青石与山路泛润青苔色
          dst[idx] = clamp(sr * 0.94, 0.05, 1);
          dst[idx + 1] = clamp(sg * 1.03 + 0.01, 0.05, 1);
          dst[idx + 2] = clamp(sb * 0.96, 0.05, 1);
        }
      } else {
        // 秋日山道转暖赭枯黄，晨霜微白
        let r = isMossy ? clamp(sr * 1.26 + 0.06, 0.05, 1) : clamp(sr * 1.08 + 0.03, 0.05, 1);
        let g = isMossy ? clamp(sg * 0.98 + 0.02, 0.05, 1) : clamp(sg * 0.95, 0.05, 1);
        let b = clamp(sb * 0.80, 0.05, 1);
        if (frostActive && ny > 0.25) {
          const f = 0.26 * clamp(ny, 0.25, 1);
          r = lerp(r, frostRgb.r, f);
          g = lerp(g, frostRgb.g, f);
          b = lerp(b, frostRgb.b, f);
        }
        dst[idx] = r; dst[idx + 1] = g; dst[idx + 2] = b;
      }
    });

    // 3. Sunning Trays, Paddy Rice Rows, Hanging Millet, Herb Rack & Dawn Frost on Thatch Roofs / Cliff Caps
    const summerTrayHex = ['#6A9B58', '#D4B65C', '#4D8252', '#EBE5CF', '#86AC58', '#C98A4B'];
    const autumnTrayHex = ['#C84933', '#E4AD3B', '#8E6238', '#EFE4CA', '#E09E36', '#CE5A34'];
    tintTaggedVertices(
      solidMesh,
      colorSnaps.solid,
      (tag) =>
        tag.startsWith('sun-tray-') ||
        tag === 'paddy-blade' ||
        tag === 'paddy-panicle' ||
        tag === 'millet-hang' ||
        tag === 'herb-rack-top' ||
        tag === 'frost-roof' ||
        tag === 'frost-cliff-cap',
      (dst, src, idx, tag, ny) => {
        if (tag.startsWith('sun-tray-')) {
          const trayIdx = Number(tag.slice(9)) || 0;
          phenColA.set(isSummer ? summerTrayHex[trayIdx % 6] : autumnTrayHex[trayIdx % 6]);
          const shade = clamp(0.92 + 0.10 * Math.max(0, ny), 0.72, 1.08);
          dst[idx] = clamp(phenColA.r * shade, 0.05, 1);
          dst[idx + 1] = clamp(phenColA.g * shade, 0.05, 1);
          dst[idx + 2] = clamp(phenColA.b * shade, 0.05, 1);
        } else if (tag === 'paddy-blade' || tag === 'paddy-panicle') {
          if (isSummer) {
            phenColA.set(tag === 'paddy-panicle' ? '#68AA56' : '#4E9443');
          } else {
            phenColA.set(tag === 'paddy-panicle' ? '#EEB438' : '#C89B42');
          }
          let r = clamp(src[idx] * 0.25 + phenColA.r * 0.75, 0.05, 1);
          let g = clamp(src[idx + 1] * 0.25 + phenColA.g * 0.75, 0.05, 1);
          let b = clamp(src[idx + 2] * 0.25 + phenColA.b * 0.75, 0.05, 1);
          if (!isSummer && frostActive && ny > 0.20) {
            const f = 0.26 * clamp(ny, 0.20, 1);
            r = lerp(r, frostRgb.r, f);
            g = lerp(g, frostRgb.g, f);
            b = lerp(b, frostRgb.b, f);
          }
          dst[idx] = r;
          dst[idx + 1] = g;
          dst[idx + 2] = b;
        } else if (tag === 'millet-hang') {
          phenColA.set(isSummer ? '#A9B85C' : '#E8B342');
          dst[idx] = clamp(src[idx] * 0.32 + phenColA.r * 0.68, 0.05, 1);
          dst[idx + 1] = clamp(src[idx + 1] * 0.32 + phenColA.g * 0.68, 0.05, 1);
          dst[idx + 2] = clamp(src[idx + 2] * 0.32 + phenColA.b * 0.68, 0.05, 1);
        } else if (tag === 'herb-rack-top') {
          phenColA.set(isSummer ? '#5E8E58' : '#CFA048');
          dst[idx] = clamp(src[idx] * 0.35 + phenColA.r * 0.65, 0.05, 1);
          dst[idx + 1] = clamp(src[idx + 1] * 0.35 + phenColA.g * 0.65, 0.05, 1);
          dst[idx + 2] = clamp(src[idx + 2] * 0.35 + phenColA.b * 0.65, 0.05, 1);
        } else if (!isSummer) {
          // 'frost-roof' & 'frost-cliff-cap' in autumn
          let r = tag === 'frost-cliff-cap' ? clamp(src[idx] * 1.16 + 0.04, 0.05, 1) : src[idx];
          let g = tag === 'frost-cliff-cap' ? clamp(src[idx + 1] * 0.98, 0.05, 1) : src[idx + 1];
          let b = tag === 'frost-cliff-cap' ? clamp(src[idx + 2] * 0.84, 0.05, 1) : src[idx + 2];
          if (frostActive && ny > 0.22) {
            const f = (tag === 'frost-roof' ? 0.44 : 0.38) * clamp(ny, 0.22, 1);
            r = lerp(r, frostRgb.r, f);
            g = lerp(g, frostRgb.g, f);
            b = lerp(b, frostRgb.b, f);
          }
          dst[idx] = r; dst[idx + 1] = g; dst[idx + 2] = b;
        }
      }
    );

    // 4. Mountain Apricot & Wild Plum Trees (Summer emerald / Autumn golden-russet / Winter frosty bare snow)
    const isWinter = phenId === 'winter';
    if (blossomGeo && colorSnaps.blossomGeo && colorSnaps.blossomCrownMask) {
      const dst = blossomGeo.attributes.color.array;
      const src = colorSnaps.blossomGeo;
      const mask = colorSnaps.blossomCrownMask;
      const nor = blossomGeo.attributes.normal.array;
      if (isWinter) {
        phenColA.set('#EAECE8');
        phenColB.set('#848C8A');
        for (let v = 0, i = 0; v < mask.length; v++, i += 3) {
          if (!mask[v]) continue;
          const tUp = clamp(nor[i + 1] * 0.5 + 0.5, 0, 1);
          const lum = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
          const shade = clamp(0.72 + lum * 0.35, 0.65, 1.0);
          dst[i] = clamp(lerp(phenColB.r, phenColA.r, tUp) * shade, 0.05, 1);
          dst[i + 1] = clamp(lerp(phenColB.g, phenColA.g, tUp) * shade, 0.05, 1);
          dst[i + 2] = clamp(lerp(phenColB.b, phenColA.b, tUp) * shade, 0.05, 1);
        }
      } else {
        phenColA.set(isSummer ? '#78A466' : '#E8B258');
        phenColB.set(isSummer ? '#4D7648' : '#B66B3E');
        for (let v = 0, i = 0; v < mask.length; v++, i += 3) {
          if (!mask[v]) continue;
          const tUp = clamp(nor[i + 1] * 0.5 + 0.5, 0, 1);
          let r = lerp(phenColB.r, phenColA.r, tUp) * src[i];
          let g = lerp(phenColB.g, phenColA.g, tUp) * src[i + 1];
          let b = lerp(phenColB.b, phenColA.b, tUp) * src[i + 2];
          if (frostActive && nor[i + 1] > 0.25) {
            const f = 0.35 * clamp(nor[i + 1], 0.25, 1);
            r = lerp(r, frostRgb.r, f);
            g = lerp(g, frostRgb.g, f);
            b = lerp(b, frostRgb.b, f);
          }
          dst[i] = clamp(r, 0.05, 1);
          dst[i + 1] = clamp(g, 0.05, 1);
          dst[i + 2] = clamp(b, 0.05, 1);
        }
      }
      blossomGeo.attributes.color.needsUpdate = true;
    }
    if (blossomMesh?.instanceColor) {
      const summerTreeTints = ['#EEF5E2', '#D8EAD0', '#F2F4DC', '#CCE2C4'];
      const autumnTreeTints = ['#F8D992', '#EA9E68', '#F4E2A4', '#DE885C'];
      const winterTreeTints = ['#EAECE9', '#DFE4E2', '#D4DAD8', '#F1F2EE'];
      const palette = isWinter ? winterTreeTints : (isSummer ? summerTreeTints : autumnTreeTints);
      for (let i = 0; i < blossomRecords.length; i++) {
        blossomMesh.setColorAt(i, phenColA.set(palette[i % palette.length]));
      }
      blossomMesh.instanceColor.needsUpdate = true;
    }

    // 5. Tea Rows, Medicinal Herb Beds & Stepped Paddy Rice ('良田金粟' in Autumn / '冬田霜茬' in Winter)
    if (shrubMesh?.instanceColor) {
      const summerHerbHex = ['#7B6288', '#DEC868', '#548E58', '#78A866'];
      const autumnHerbHex = ['#9A624E', '#E6BA48', '#B89650', '#869A58'];
      const winterHerbHex = ['#C8CDC8', '#D4D6CE', '#BFC6C2', '#CDD2CC'];
      const autumnPaddyHex = ['#E2AE42', '#ECA93A', '#D29B38'];
      const winterPaddyHex = ['#D6D8D0', '#CBD0C8', '#DFE1DA'];
      for (let i = 0; i < shrubRecords.length; i++) {
        const rec = shrubRecords[i];
        if (rec.role === 'paddy') {
          if (isWinter) {
            phenColA.set(winterPaddyHex[i % winterPaddyHex.length]);
          } else if (isSummer) {
            phenColA.set(i % 2 === 0 ? '#589C4B' : '#6BAE5A');
          } else {
            phenColA.set(autumnPaddyHex[i % autumnPaddyHex.length]);
          }
        } else if (rec.role === 'herb') {
          const k = (rec.bedKind || 0) % 4;
          phenColA.set(isWinter ? winterHerbHex[k] : (isSummer ? summerHerbHex[k] : autumnHerbHex[k]));
        } else {
          // Wild cloud-mist tea rows
          if (isWinter) {
            phenColA.set(i % 3 === 0 ? '#A4B2A8' : (i % 2 === 0 ? '#8C9B92' : '#7A8A82'));
          } else if (isSummer) {
            phenColA.set(i % 3 === 0 ? '#7EB06A' : (i % 2 === 0 ? '#558652' : '#436E46'));
          } else {
            phenColA.set(i % 3 === 0 ? '#85985A' : (i % 2 === 0 ? '#5B784E' : '#496342'));
          }
        }
        shrubMesh.setColorAt(i, phenColA);
      }
      shrubMesh.instanceColor.needsUpdate = true;
    }
    if (shrubGeo && colorSnaps.shrubGeo && frostActive) {
      const dst = shrubGeo.attributes.color.array;
      const src = colorSnaps.shrubGeo;
      const nor = shrubGeo.attributes.normal.array;
      const pos = shrubGeo.attributes.position.array;
      for (let i = 0; i < src.length; i += 3) {
        if (pos[i + 1] > 0.34 && nor[i + 1] > 0.28) {
          const f = 0.28 * clamp(nor[i + 1], 0.28, 1);
          dst[i] = lerp(src[i], frostRgb.r, f);
          dst[i + 1] = lerp(src[i + 1], frostRgb.g, f);
          dst[i + 2] = lerp(src[i + 2], frostRgb.b, f);
        }
      }
      shrubGeo.attributes.color.needsUpdate = true;
    }

    // 6. Cliff Pines & Stratified Crags (Autumn bronze-moss & Dawn silver hoarfrost '远树微霜')
    if (!isSummer && pineGeo && colorSnaps.pineGeo && frostActive) {
      const dst = pineGeo.attributes.color.array;
      const src = colorSnaps.pineGeo;
      const nor = pineGeo.attributes.normal.array;
      const pos = pineGeo.attributes.position.array;
      for (let i = 0; i < src.length; i += 3) {
        if (pos[i + 1] > 1.85 && nor[i + 1] > 0.22) {
          const f = 0.38 * clamp(nor[i + 1], 0.22, 1);
          dst[i] = lerp(src[i], frostRgb.r, f);
          dst[i + 1] = lerp(src[i + 1], frostRgb.g, f);
          dst[i + 2] = lerp(src[i + 2], frostRgb.b, f);
        }
      }
      pineGeo.attributes.color.needsUpdate = true;
    }
    if (!isSummer && cragGeo && colorSnaps.cragGeo) {
      const dst = cragGeo.attributes.color.array;
      const src = colorSnaps.cragGeo;
      const nor = cragGeo.attributes.normal.array;
      const pos = cragGeo.attributes.position.array;
      for (let i = 0; i < src.length; i += 3) {
        let r = src[i], g = src[i + 1], b = src[i + 2];
        if (pos[i + 1] > 0.42 && g > r * 1.06) {
          // Warm moss cap slightly toward autumn bronze-olive
          r = clamp(r * 1.15 + 0.03, 0.05, 1);
          g = clamp(g * 0.98, 0.05, 1);
          b = clamp(b * 0.84, 0.05, 1);
        }
        if (frostActive && pos[i + 1] > 0.42 && nor[i + 1] > 0.25) {
          const f = 0.38 * clamp(nor[i + 1], 0.25, 1);
          r = lerp(r, frostRgb.r, f);
          g = lerp(g, frostRgb.g, f);
          b = lerp(b, frostRgb.b, f);
        }
        dst[i] = r; dst[i + 1] = g; dst[i + 2] = b;
      }
      cragGeo.attributes.color.needsUpdate = true;
    }

    // 7. Mountain Meadow Grass & Fern Tufts
    if (tuftMesh?.instanceColor) {
      const summerTufts = ['#689B4E', '#7FB05D', '#588846', '#9CC06E', '#CFE2A0'];
      const autumnTufts = ['#C4A65A', '#D5B86A', '#9E8D52', '#DEC67C', '#E6D8A4'];
      const palTufts = isSummer ? summerTufts : autumnTufts;
      for (let i = 0; i < tuftRecords.length; i++) {
        tuftMesh.setColorAt(i, phenColA.set(palTufts[i % palTufts.length]));
      }
      tuftMesh.instanceColor.needsUpdate = true;
    }
    if (!isSummer && tuftGeo && colorSnaps.tuftGeo && frostActive) {
      const dst = tuftGeo.attributes.color.array;
      const src = colorSnaps.tuftGeo;
      const pos = tuftGeo.attributes.position.array;
      for (let i = 0; i < src.length; i += 3) {
        if (pos[i + 1] > 0.18) {
          dst[i] = lerp(src[i], frostRgb.r, 0.36);
          dst[i + 1] = lerp(src[i + 1], frostRgb.g, 0.36);
          dst[i + 2] = lerp(src[i + 2], frostRgb.b, 0.36);
        }
      }
      tuftGeo.attributes.color.needsUpdate = true;
    }

    // 8. Drifting Petals (Summer pale ivory/jade) vs Autumn Leaves (Golden ginkgo & cinnabar russet)
    if (faunaColAttr) {
      const dst = faunaColAttr.array;
      const summerLeaves = ['#F2F5EA', '#F6E5EA', '#E4EFE0'];
      const autumnLeaves = ['#EAB855', '#CF6E46', '#DF9D45', '#D9824D'];
      const leafPal = isSummer ? summerLeaves : autumnLeaves;
      for (let s = 0; s < driftingLeafCount; s++) {
        phenColA.set(leafPal[s % leafPal.length]);
        const baseFloat = (leafVertOffset + s * leafVertPerSlot) * 3;
        for (let v = 0; v < leafVertPerSlot; v++) {
          const k = baseFloat + v * 3;
          const vShade = v >= 3 ? 0.92 : 1.0;
          dst[k] = clamp(phenColA.r * vShade, 0.05, 1);
          dst[k + 1] = clamp(phenColA.g * vShade, 0.05, 1);
          dst[k + 2] = clamp(phenColA.b * vShade, 0.05, 1);
        }
      }
      faunaColAttr.needsUpdate = true;
    }

    // 6. Winter thin snow: wash upward-facing faces of every borderland batch toward frost white
    if (phenId === 'winter') {
      const snowWashGeo = (geo) => {
        if (!geo?.attributes?.color || !geo.attributes.normal) return;
        const dst = geo.attributes.color.array;
        const nor = geo.attributes.normal.array;
        for (let i = 0; i < dst.length; i += 3) {
          const ny = Math.abs(nor[i + 1]);
          if (ny <= 0.15) continue;
          const f = 0.55 * clamp(ny, 0.15, 1);
          dst[i] = lerp(dst[i], frostRgb.r, f);
          dst[i + 1] = lerp(dst[i + 1], frostRgb.g, f);
          dst[i + 2] = lerp(dst[i + 2], frostRgb.b, f);
        }
        geo.attributes.color.needsUpdate = true;
      };
      snowWashGeo(groundMesh?.geometry);
      snowWashGeo(solidMesh?.geometry);
      snowWashGeo(blossomGeo);
      snowWashGeo(shrubGeo);
      snowWashGeo(tuftGeo);
      snowWashGeo(cragGeo);
      const snowWashInst = (mesh) => {
        if (!mesh?.instanceColor) return;
        const dst = mesh.instanceColor.array;
        for (let i = 0; i < dst.length; i += 3) {
          dst[i] = lerp(dst[i], frostRgb.r, 0.5);
          dst[i + 1] = lerp(dst[i + 1], frostRgb.g, 0.5);
          dst[i + 2] = lerp(dst[i + 2], frostRgb.b, 0.5);
        }
        mesh.instanceColor.needsUpdate = true;
      };
      snowWashInst(blossomMesh);
      snowWashInst(shrubMesh);
      snowWashInst(tuftMesh);
    }
  }

  function syncAtmosphere(phenologyId = currentPhenology, timeId = currentTimeId) {
    if (disposed) return false;
    const nextPhen = (phenologyId === 'summer' || phenologyId === 'autumn' || phenologyId === 'winter') ? phenologyId : 'spring';
    const nextTime = typeof timeId === 'string' && timeId ? timeId : currentTimeId;
    const nextFrost = Boolean((nextPhen === 'autumn' && nextTime === 'dawn') || nextPhen === 'winter');
    currentTimeId = nextTime;
    if (nextPhen === currentPhenology && nextFrost === currentFrost) {
      return false;
    }
    if (nextPhen === 'spring' && currentPhenology === 'spring' && !colorSnapshotted) {
      return false;
    }
    currentPhenology = nextPhen;
    currentFrost = nextFrost;
    applyBorderlandPhenology(currentPhenology, currentFrost);
    return true;
  }

  function setPhenology(phenologyId, timeId = currentTimeId) {
    return syncAtmosphere(phenologyId, timeId);
  }

  function writeDynamicTransforms(t, sky, playerState = null) {
    const app = sky?.getAppearance?.();
    const timeId = sky?.timeId ?? app?.timeId ?? 'day';
    const rain = clamp(Number(sky?.rainIntensity ?? app?.rainIntensity ?? 0) || 0, 0, 1);
    const isNight = timeId === 'night' || timeId === 'dusk';

    // 1. Waterfall cascade droplets, pool mist & tea-stove steam
    for (let i = 0; i < 22; i++) {
      const ledge = cascadeLedges[i % cascadeLedges.length];
      const u = ((t * (0.95 + (i % 4) * 0.14) + i * 0.21) % 1);
      const lane = ((i % 5) - 2) * 0.28;
      const wx = lerp(ledge.x0, ledge.x1, u) + lane;
      const wy = lerp(ledge.y0, ledge.y1, u * u) + 0.08;
      const wz = lerp(ledge.z0, ledge.z1, u);
      const stretch = 0.36 + u * 0.45;
      tmpPos.set(wx, wy, wz);
      tmpEuler.set(0.45, 0, 0, 'YXZ');
      tmpQuat.setFromEuler(tmpEuler);
      tmpScale.set(0.24, stretch, 0.20);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      waterFxMesh.setMatrixAt(i, tmpMat);
    }
    for (let i = 0; i < 6; i++) {
      const u = ((t * 0.38 + i / 6) % 1);
      const ang = i * 1.05 + t * 0.25;
      const rad = 0.8 + u * 2.4;
      const mx = wf.poolX + Math.cos(ang) * rad;
      const mz = wf.poolZ - 1.8 + Math.sin(ang) * rad * 0.65;
      const my = poolWaterY + 0.16 + u * 0.95;
      const sc = Math.sin(u * Math.PI) * 0.68;
      tmpPos.set(mx, my, mz);
      tmpQuat.identity();
      tmpScale.set(sc * 1.3, sc * 0.65, sc * 1.3);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      waterFxMesh.setMatrixAt(22 + i, tmpMat);
    }
    const steamGain = teaSteamBoost > 0 ? 1.65 : 0.85;
    for (let i = 0; i < 6; i++) {
      const u = ((t * (teaSteamBoost > 0 ? 0.68 : 0.36) + i / 6) % 1);
      const sx = tsCfg.x - 0.10 + Math.sin(t * 1.8 + i) * 0.12 * u;
      const sz = tsCfg.z + 0.04 + Math.cos(t * 1.5 + i) * 0.12 * u;
      const sy = tsY + 0.88 + u * (0.85 * steamGain);
      const sc = Math.sin(u * Math.PI) * 0.20 * steamGain;
      tmpPos.set(sx, sy, sz);
      tmpQuat.identity();
      tmpScale.set(sc, sc * 1.25, sc);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      waterFxMesh.setMatrixAt(28 + i, tmpMat);
    }
    waterFxMesh.instanceMatrix.needsUpdate = true;

    // 2. Night lanterns & fireflies
    glowMesh.visible = isNight;
    if (isNight) {
      for (let i = 0; i < 4; i++) {
        const lp = lanternPositions[i];
        const flicker = 0.94 + 0.06 * Math.sin(t * 4.2 + i * 1.7);
        tmpPos.set(lp.x, lp.y, lp.z);
        tmpEuler.set(0, i === 2 ? hcRot : 0, 0, 'YXZ');
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(lp.sx * flicker, lp.sy * flicker, lp.sz * flicker);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        glowMesh.setMatrixAt(i, tmpMat);
      }
      const flyShow = rain < 0.25 && currentPhenology !== 'winter';
      for (let i = 0; i < fireflyCount; i++) {
        const fa = fireflyAnchors[i];
        if (!flyShow) {
          tmpPos.set(0, -50, 0);
          tmpScale.set(0, 0, 0);
        } else {
          const pulse = 0.055 + 0.045 * Math.max(0, Math.sin(t * 2.6 + fa.phase));
          tmpPos.set(
            fa.x + Math.sin(t * fa.speed + fa.phase) * 1.15,
            fa.y + Math.sin(t * 1.3 + fa.phase * 1.7) * 0.28,
            fa.z + Math.cos(t * fa.speed * 0.85 + fa.phase) * 1.15
          );
          tmpScale.set(pulse, pulse, pulse);
        }
        tmpQuat.identity();
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        glowMesh.setMatrixAt(4 + i, tmpMat);
      }
      glowMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Borderland Sculpted Fauna (Goats, Egrets, Cranes, Butterflies — 昼夜风雨真实作息)
    const isDeepNight = timeId === 'night';
    const goatResting = isDeepNight || rain > 0.28;
    const np = goatParts.neckPivot;
    for (let i = 0; i < goatActors.length; i++) {
      const g = goatActors[i];
      const cyc = (t * 0.22 + g.phase) % TAU;
      const walking = Math.sin(cyc) > 0.35 && !isNight && !goatResting;
      if (walking) {
        const ang = t * g.speed + g.phase;
        const nx = g.homeX + Math.cos(ang) * g.orbitR;
        const nz = g.homeZ + Math.sin(ang) * g.orbitR;
        g.yaw = Math.atan2(nx - g.x, nz - g.z) || g.yaw;
        g.x = nx;
        g.z = nz;
        g.y = surface(nx, nz);
      }
      const sc = g.scale;
      const restDrop = goatResting ? 0.14 * sc : 0;
      const bob = walking ? Math.abs(Math.sin(t * 5.2 + g.phase)) * 0.025 : 0;
      const grazePitch = walking
        ? 0.05
        : (goatResting ? 0.16 + Math.sin(t * 0.9 + g.phase) * 0.015 : (0.52 + Math.sin(t * 2.4 + g.phase) * 0.14));
      const slots = goatSlots[i];
      const gy = g.y + 0.008 - restDrop + bob;
      faunaBatch.writePart(slots.body, g.x, gy, g.z, 0, g.yaw, 0, sc, goatResting ? sc * 0.86 : sc, sc);
      const sy = Math.sin(g.yaw), cy = Math.cos(g.yaw);
      const hx = g.x + np[0] * sc * cy + np[2] * sc * sy;
      const hy = gy + np[1] * (goatResting ? sc * 0.86 : sc);
      const hz = g.z - np[0] * sc * sy + np[2] * sc * cy;
      const headYaw = goatResting ? g.yaw : g.yaw + Math.sin(t * 0.9 + i) * 0.12;
      faunaBatch.writePart(slots.head, hx, hy, hz, grazePitch, headYaw, 0, sc, sc, sc);
    }

    const egPivot = egretParts.neckPivot || [0, 0.22, 0.10];
    const egretSleeping = isDeepNight || rain > 0.28;
    for (let i = 0; i < egretActors.length; i++) {
      const eg = egretActors[i];
      const peck = egretSleeping ? 0.54 : Math.max(0, Math.sin(t * 0.85 + eg.phase) - 0.55) * 1.45;
      const yaw = egretSleeping ? eg.yaw : eg.yaw + Math.sin(t * 0.32 + eg.phase) * 0.25;
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const slots = egretSlots[i];
      const ey = eg.y + 0.006;
      faunaBatch.writePart(slots.body, eg.x, ey, eg.z, egretSleeping ? 0.08 : 0, yaw, 0, 1, 1, 1);
      faunaBatch.writePart(
        slots.head,
        eg.x + egPivot[0] * cy + (egPivot[2] - (egretSleeping ? 0.03 : 0)) * sy,
        ey + egPivot[1] - (egretSleeping ? 0.04 : 0),
        eg.z - egPivot[0] * sy + (egPivot[2] - (egretSleeping ? 0.03 : 0)) * cy,
        peck,
        yaw,
        0,
        1, 1, 1
      );
    }

    // 仙鹤：晨昼暮盘旋松巅云端，入夜与暴雨归宿崖松隐去飞影
    const showCranes = !isDeepNight && rain < 0.32;
    for (let i = 0; i < craneActors.length; i++) {
      const cr = craneActors[i];
      const slots = craneSlots[i];
      if (!showCranes) {
        faunaBatch.hidePart(slots.body);
        faunaBatch.hidePart(slots.wingL);
        faunaBatch.hidePart(slots.wingR);
        continue;
      }
      const ang = t * cr.speed + cr.phase * TAU;
      const cx = cr.cx + Math.cos(ang) * cr.rx;
      const cz = cr.cz + Math.sin(ang) * cr.rz;
      const cy = cr.baseY + Math.sin(ang * 2.0) * 0.85;
      const dx = -Math.sin(ang) * cr.rx;
      const dz = Math.cos(ang) * cr.rz;
      const yaw = Math.atan2(dx, dz);
      const bank = -0.16;
      const flap = Math.sin(t * 2.5 + i * 1.4) * 0.42;
      faunaBatch.writePart(slots.body, cx, cy, cz, 0, yaw, bank, 1.18, 1.18, 1.18);
      faunaBatch.writePart(slots.wingL, cx, cy, cz, 0, yaw, bank + flap, 1.18, 1.18, 1.18);
      faunaBatch.writePart(slots.wingR, cx, cy, cz, 0, yaw, bank - flap, 1.18, 1.18, 1.18);
    }

    const showButterflies = !isNight && rain < 0.2;
    for (let i = 0; i < butterflyActors.length; i++) {
      const bf = butterflyActors[i];
      const slots = butterflySlots[i];
      if (!showButterflies) {
        faunaBatch.hidePart(slots.wingL);
        faunaBatch.hidePart(slots.wingR);
        continue;
      }
      const ang = t * 0.95 + bf.phase;
      const bx = bf.cx + Math.cos(ang) * 1.05;
      const bz = bf.cz + Math.sin(ang * 1.3) * 0.95;
      const by = bf.baseY + Math.sin(t * 2.8 + bf.phase) * 0.18;
      const yaw = Math.atan2(-Math.sin(ang), Math.cos(ang * 1.3));
      const flap = Math.sin(t * 11.5 + bf.phase) * 0.85;
      faunaBatch.writePart(slots.wingL, bx, by, bz, 0, yaw, flap, 1.1, 1.1, 1.1);
      faunaBatch.writePart(slots.wingR, bx, by, bz, 0, yaw, -flap, 1.1, 1.1, 1.1);
    }

    // Seasonal drifting blossom petals (spring/summer) & golden/russet leaves (autumn)
    const windX = Number(sky?.windX ?? 0.12) || 0;
    const windZ = Number(sky?.windZ ?? 0.06) || 0;
    const activeLeafLimit = rain >= 0.45
      ? 0
      : (currentPhenology === 'summer' ? Math.min(10, driftingLeafCount) : driftingLeafCount);
    for (let i = 0; i < driftingLeafActors.length; i++) {
      const slot = driftingLeafSlots[i];
      if (i >= activeLeafLimit) {
        faunaBatch.hidePart(slot);
        continue;
      }
      const lf = driftingLeafActors[i];
      const u = ((t * lf.fallSpeed + lf.phase / TAU) % 1 + 1) % 1;
      const env = Math.sin(u * Math.PI);
      const swirl = t * 0.85 + lf.phase + u * 3.4;
      const lx = lf.cx + Math.cos(swirl) * lf.driftR + windX * u * 2.4;
      const lz = lf.cz + Math.sin(swirl * 0.9) * lf.driftR + windZ * u * 2.4;
      const ly = lf.groundY + 0.28 + (1 - u) * lf.spanY;
      const sc = lf.scale * (currentPhenology === 'autumn' ? 1.22 : 1.0) * (0.45 + 0.55 * env);
      faunaBatch.writePart(
        slot,
        lx, ly, lz,
        t * lf.spinSpeed + lf.phase,
        swirl,
        Math.sin(t * 2.2 + lf.phase) * 0.65,
        sc, sc, sc
      );
    }
    faunaBatch.commit();

    // 4. Two Living Borderland Villagers
    const nightRest = timeId === 'night';
    const hasPlayer = Boolean(playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z));
    villagers[0].active = !nightRest;
    villagers[1].active = !nightRest;

    actorRig.begin();
    if (!nightRest) {
      const v0 = villagers[0];
      if (!hasPlayer || Math.hypot(playerState.x - v0.x, playerState.z - v0.z) <= 105) {
        const v0Greet = v0.greetUntil > simTime;
        const yaw0 = v0Greet
          ? Math.atan2(v0.greetX - v0.x, v0.greetZ - v0.z)
          : v0.facing + Math.sin(t * 0.45) * 0.14;
        actorRig.actor(v0.x, v0.y, v0.z, yaw0, v0.s);
        actorRig.human(v0, {
          lean: v0Greet ? 0.05 : 0.12,
          crouch: v0Greet ? 0.04 : 0.24,
          nod: v0Greet ? Math.sin(t * 2.1) * 0.06 : 0.10,
          headTurn: v0Greet ? 0 : Math.sin(t * 0.8) * 0.14,
          left: [-0.24, v0Greet ? 0.92 : 0.80, 0.22],
          right: [0.18, v0Greet ? 0.96 : 0.78 + Math.sin(t * 3.0) * 0.045, 0.32],
          walk: 0
        });
        // Woven bamboo herb basket on left arm (reuses taper + round batches: 0 extra draw calls)
        const basketY = v0Greet ? 0.80 : 0.68;
        actorRig.part('taper', [-0.26, basketY, 0.22], [0.13, 0.16, 0.13], 0xb29363);
        actorRig.part('round', [-0.26, basketY + 0.08, 0.22], [0.105, 0.045, 0.105], 0x5c8252);
      }

      const v1 = villagers[1];
      if (!hasPlayer || Math.hypot(playerState.x - v1.x, playerState.z - v1.z) <= 105) {
        const v1Greet = v1.greetUntil > simTime;
        const yaw1 = v1Greet
          ? Math.atan2(v1.greetX - v1.x, v1.greetZ - v1.z)
          : v1.facing + Math.sin(t * 0.35 + 1.2) * 0.18;
        actorRig.actor(v1.x, v1.y, v1.z, yaw1, v1.s);
        actorRig.human(v1, {
          lean: 0.05,
          crouch: 0.02,
          nod: v1Greet ? Math.sin(t * 1.9) * 0.05 : -0.04,
          headTurn: v1Greet ? 0 : Math.sin(t * 0.55 + 0.9) * 0.22,
          left: [-0.24, 0.96, 0.24],
          right: v1Greet ? [0.18, 0.98, 0.28] : [0.15, 1.26 + Math.sin(t * 0.65) * 0.03, 0.26],
          walk: 0
        });
        // Wooden field hoe/staff in left hand (reuses taper + box batches: 0 extra draw calls)
        actorRig.segment('taper', [-0.25, 0.02, 0.25], [-0.23, 1.26, 0.23], 0.026, 0.026, 0x796143);
        actorRig.part('box', [-0.25, 0.05, 0.31], [0.14, 0.04, 0.12], 0x5a5750);
      }
    }
    actorRig.finish();
  }

  function update(dt, elapsed = 0, sky = null, playerState = null) {
    if (disposed) return;
    const liveTime = sky?.timeId ?? sky?.getAppearance?.()?.timeId;
    if (typeof liveTime === 'string' && liveTime !== currentTimeId) {
      syncAtmosphere(currentPhenology, liveTime);
    }
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;
    if (step <= 0 && hasRenderedOnce) return;

    simTime += step;
    hasRenderedOnce = true;

    for (const s of interactiveSites) {
      if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - step);
    }
    if (teaSteamBoost > 0) teaSteamBoost = Math.max(0, teaSteamBoost - step);
    if (noteTimer > 0) {
      noteTimer = Math.max(0, noteTimer - step);
      if (noteTimer <= 0 && noteEl && noteEl.textContent === lastNoteText) {
        noteEl.classList?.remove?.('show');
        noteEl.setAttribute?.('aria-hidden', 'true');
      }
    }

    writeDynamicTransforms(simTime, sky, playerState);
  }

  // Write initial deterministic frame at t = 0
  writeDynamicTransforms(0, null);

  function getInteractables() {
    return villagers;
  }

  function greet(id, px, pz, dur = 4.0) {
    for (const v of villagers) {
      if (v.key === id || v.id === id) {
        v.greetUntil = simTime + dur;
        v.greetX = px;
        v.greetZ = pz;
      }
    }
  }

  const layout = {
    paths: builtPaths,
    brook: { width: cfg.brook.width, points: brookPts },
    terraces: builtTerraces,
    waterfall: { ...wf, poolWaterY },
    cloudPavilion: { ...pavCfg, y: pavFloorY },
    sunningTerrace: { ...sunCfg, y: sunY },
    ancientStele: { ...stCfg, y: stY },
    watchtower: { ...wtCfg, y: wtY },
    stoneBridge: { ...brCfg, y: brY },
    herbCottage: { ...hcCfg, y: hcY },
    teaStove: { ...tsCfg, y: tsY },
    eastPasture: { ...pastCfg, y: surface(pastCfg.x, pastCfg.z) },
    herbBeds,
    teaRows: teaRowPolylines,
    pines: pineRecords.map(p => [p.x, p.z, p.scale]),
    blossoms: blossomRecords.map(p => [p.x, p.z, p.scale]),
    bamboo: bambooRecords.map(p => [p.x, p.z, p.scale]),
    crags: cragRecords.map(p => [p.x, p.z, p.sx])
  };

  function getStats() {
    return {
      enabled: true,
      simTime,
      phenology: currentPhenology,
      frostActive: currentFrost,
      pines: pineRecords.length,
      blossomTrees: blossomRecords.length,
      bambooClusters: bambooRecords.length,
      shrubs: shrubRecords.length,
      crags: cragRecords.length,
      meadowTufts: tuftRecords.length,
      driftingLeaves: driftingLeafCount,
      terraces: builtTerraces.length,
      paths: builtPaths.length,
      blockers: blockers.length,
      targets: targets.length,
      restSeats: restSeats.length,
      shelters: shelters.length,
      villagers: villagers.length,
      faunaTriangles: faunaBatch.triangles
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const m of [groundMesh, solidMesh, waterMesh, pineMesh, blossomMesh, bambooMesh, shrubMesh, cragMesh, tuftMesh, waterFxMesh, glowMesh]) {
      if (m) {
        m.geometry?.dispose?.();
        m.material?.dispose?.();
      }
    }
    for (const partGeo of [
      goatParts.bodyGeo, goatParts.headGeo,
      egretParts.bodyGeo, egretParts.headGeo,
      craneParts.bodyGeo, craneParts.wingLGeo, craneParts.wingRGeo,
      butterflyParts.wingLGeo, butterflyParts.wingRGeo,
      petalGeoPink, petalGeoIvory
    ]) {
      partGeo?.dispose?.();
    }
    faunaBatch.geo.dispose();
    faunaMat.dispose();
    actorRig.dispose?.();
  }

  return {
    group,
    blockers,
    targets,
    restSeats,
    quietSpots: cfg.quietSpots || [],
    shelters,
    contactTargets,
    layout,
    setPhenology,
    syncAtmosphere,
    interactById(id, sound, doc) {
      const s = interactiveSites.find(item => item.id === id);
      return triggerInteractiveSite(s, sound, doc);
    },
    getInteractables,
    greet,
    bind,
    update,
    getStats,
    dispose
  };
}
