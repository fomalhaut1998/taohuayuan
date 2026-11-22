import * as THREE from 'three';
import { createGroveBaker } from './leisure-grove-geometry.js';
import { createHabitatContext, habitatSiteSafe, habitatSurface } from './habitat-details.js';

const TAU = Math.PI * 2;
const unwrap = v => v?.layout || v || {};

const P = {
  wood: '#886743',
  darkWood: '#5B4530',
  bark: '#6E5840',
  bamboo: '#9FA067',
  bambooOld: '#8D8C57',
  thatch: '#B6A268',
  thatchDark: '#8F7D4C',
  grayClay: '#7D7D77',
  blackClay: '#3D3E3C',
  redClay: '#A56348',
  potRim: '#65655E',
  hemp: '#CBBFA1',
  hempDark: '#A89B7D',
  indigo: '#2E4C6D',
  indigoDeep: '#1F3652',
  moss: '#5C7743',
  wasong: '#6E8550',
  garlic: '#DFD6C2',
  zhuyu: '#B44335',
  mugwort: '#677C51',
  ginger: '#C5A46B',
  fishAmber: '#8D6137',
  sunDry: '#D2A663',
  radish: '#E2E0D4',
  radishLeaf: '#5C8245',
  stone: '#8D9586',
  stoneDark: '#6A7165',
  iron: '#555A5E',
  ash: '#4A4B47',
  straw: '#C8B87C',
  mudWall: '#9B8968'
};

function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function localHousePt(hi, lx, ly, lz) {
  const c = Math.cos(hi.rot);
  const s = Math.sin(hi.rot);
  return [hi.x + lx * c + lz * s, hi.gy + ly, hi.z - lx * s + lz * c];
}

function reserveCircle(context, x, z, radius, source = 'qin-han') {
  if (!context || ![x, z, radius].every(Number.isFinite)) return;
  context.reservations.circles.push({ x, z, r: radius, source });
}

function findSafeSite(anchorX, anchorZ, radius, context, radii = [0, 4, 8, 12, 16, 20], angles = 16) {
  if (!context || !Number.isFinite(anchorX) || !Number.isFinite(anchorZ)) return null;
  for (const r of radii) {
    const steps = r === 0 ? 1 : angles;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU + (r * 0.21);
      const x = anchorX + Math.cos(a) * r;
      const z = anchorZ + Math.sin(a) * r;
      if (habitatSiteSafe(x, z, radius, context)) return { x, z };
    }
  }
  return null;
}

export function buildQinHanStatic(options) {
  const {
    world, field, village, props, villageScenes, leisureGrove, pondLife,
    reservations = []
  } = options;

  const baker = createGroveBaker();
  const blk = (p, s, c, ry = 0) => baker.block(p, s, c, [0, ry, 0], 'solid');
  const frond = (base, dir, len, w, c) => {
    const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    baker.leaf(base, [base[0] + dir[0] / n * len, base[1] + dir[1] / n * len, base[2] + dir[2] / n * len], w, c, 'solid');
  };
  // Open-ended tapered rod (2*segs tris vs 4*segs for capped CylinderGeometry — saves 50% on buried joints).
  const rod = (p0, p1, r0, c, r1 = r0, segs = 4) => {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    const ax = dx / len, ay = dy / len, az = dz / len;
    const upX = Math.abs(ay) < 0.92 ? 0 : 1, upY = Math.abs(ay) < 0.92 ? 1 : 0;
    let ux = -az * upY, uy = az * upX, uz = ax * upY - ay * upX;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    const ring0 = [], ring1 = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
      ring0.push([p0[0] + nx * r0, p0[1] + ny * r0, p0[2] + nz * r0]);
      ring1.push([p1[0] + nx * r1, p1[1] + ny * r1, p1[2] + nz * r1]);
    }
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      baker.quad(ring0[i], ring0[j], ring1[j], ring1[i], c, 'solid');
    }
  };
  // Lightweight open-shell revolved pottery/basket profile (DoubleSide material -> crisp silhouette at ~24-40 tris).
  const revolved = (base, profile, c, segs = 6, yaw = 0, capBot = false, capTop = false) => {
    const [bx, by, bz] = base;
    const ring = (r, y) => Array.from({ length: segs }, (_, i) => {
      const a = yaw + (i / segs) * TAU;
      return [bx + Math.cos(a) * r, by + y, bz + Math.sin(a) * r];
    });
    const rings = profile.map(([r, y]) => ring(r, y));
    for (let k = 0; k < rings.length - 1; k++) {
      const r0 = rings[k], r1 = rings[k + 1];
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % segs;
        baker.quad(r0[j], r0[i], r1[i], r1[j], c, 'solid');
      }
    }
    if (capBot && profile[0][0] > 0.005) {
      const ctr = [bx, by + profile[0][1], bz], r0 = rings[0];
      for (let i = 0; i < segs; i++) baker.tri(ctr, r0[i], r0[(i + 1) % segs], c, 'solid');
    }
    if (capTop && profile[profile.length - 1][0] > 0.005) {
      const top = profile[profile.length - 1];
      const ctr = [bx, by + top[1], bz], rT = rings[rings.length - 1];
      for (let i = 0; i < segs; i++) baker.tri(ctr, rT[(i + 1) % segs], rT[i], c, 'solid');
    }
  };
  const disc = (center, r, c, segs = 7, yaw = 0) => {
    const [cx, cy, cz] = center;
    const pts = Array.from({ length: segs }, (_, i) => {
      const a = yaw + (i / segs) * TAU;
      return [cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r];
    });
    for (let i = 0; i < segs; i++) baker.tri(center, pts[(i + 1) % segs], pts[i], c, 'solid');
  };
  const basinRing = (p, outer, thick, height, c, segs = 7) => {
    baker.ring(p, outer, Math.max(0.01, outer - thick), height, c, segs, 'solid');
  };
  const basinBowl = (p, r, c, segs = 6) => {
    revolved(p, [[r * 0.56, 0], [r * 0.88, r * 0.24], [r, r * 0.52], [r * 0.94, r * 0.54]], c, segs, 0.2, true, false);
  };

  const rand = makeRand(20261114);
  const blockers = [];
  const targets = [];
  const anchors = {
    swallowNests: [],
    woodpiles: [],
    eaveShelters: [],
    gates: [],
    weaving: null,
    carpentry: null,
    pottery: null,
    fieldHut: null,
    hearth: null,
    dryingTrays: [],
    dyeRack: null,
    laundryEdge: null
  };

  const context = (field && options.riverCurve && options.distanceToRiver && options.flora && options.boats && options.cliff)
    ? createHabitatContext(options)
    : null;

  if (context) {
    for (const source of [options.habitatDetails, ...(Array.isArray(reservations) ? reservations : [reservations])].filter(Boolean)) {
      const lay = unwrap(source);
      const res = lay.reservations || [];
      if (Array.isArray(res)) {
        for (const item of res) {
          if (!item || ![item.x, item.z].every(Number.isFinite)) continue;
          const r = item.radius ?? item.r;
          if (Number.isFinite(r)) context.reservations.circles.push({ x: item.x, z: item.z, r, source: 'round6-ext' });
          else if ([item.hw, item.hd].every(Number.isFinite)) context.reservations.boxes.push({ ...item });
        }
      } else {
        for (const k of ['circles', 'boxes', 'corridors']) {
          if (Array.isArray(res[k])) context.reservations[k].push(...res[k].map(v => ({ ...v })));
        }
      }
      for (const cl of lay.clusters || []) reserveCircle(context, cl.x, cl.z, cl.radius || 1.2, 'habitat');
      for (const pl of lay.placements || []) reserveCircle(context, pl.x, pl.z, pl.radius || 0.8, 'pond');
      for (const b of source.blockers || []) {
        if ([b.x, b.z, b.hw, b.hd].every(Number.isFinite)) context.reservations.boxes.push({ ...b });
      }
    }
    const lgRegions = unwrap(leisureGrove).regions || [];
    for (const rg of lgRegions) reserveCircle(context, rg.x, rg.z, (rg.r || rg.radius || 3.5) + 0.6, 'leisure-region');
  }

  const surface = (x, z) => habitatSurface(field, x, z);
  const addTarget = (id, x, y, z, range = 5.5) => {
    if (!targets.some(t => t.id === id) && [x, y, z].every(Number.isFinite)) {
      targets.push({ id, x, y, z, range });
    }
  };
  const addBlocker = (x, z, hw, hd, rot = 0, minY = null, maxY = null, tag = 'qin-han') => {
    if (![x, z, hw, hd].every(Number.isFinite)) return;
    const gy = surface(x, z);
    blockers.push({
      x, z, hw, hd, rot,
      minY: minY ?? gy - 0.5,
      maxY: maxY ?? gy + 2.4,
      tag
    });
  };
  const ptAbs = (cx, baseY, cz, yaw, lx, ly, lz) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [cx + lx * c + lz * s, baseY + ly, cz - lx * s + lz * c];
  };

  // ============================================================================
  // 1. 院落与居所（控制在 2 座主院落，保持 <= 1,900 三角面以兼顾 4 名人物骨骼）
  // ============================================================================
  const houses = village?.houseInfo || [];
  const marks = props?.marks || [];

  for (let i = 0; i < Math.min(4, houses.length); i++) {
    const hi = houses[i];
    const sideSign = i % 2 === 0 ? 1 : -1;

    const shPos = localHousePt(hi, sideSign * (hi.w * 0.32), 0.12, hi.d * 0.5 + 0.24);
    anchors.eaveShelters.push({
      x: shPos[0],
      y: hi.gy + 0.12,
      z: shPos[2],
      eaveY: hi.gy + hi.h,
      hi
    });

    // 1a. 支摘窗（精准对齐农舍真侧窗顶部合页，竹编斜撑雨帘扇 + 双竹支杆，绝不与原窗框错位重影）
    if (i < 2) {
      const winX = sideSign * (hi.w * 0.5 + 0.032);
      const winW = hi.d * 0.245;
      const topY = hi.h * 0.695 - 0.15;
      const botY = hi.h * 0.435 - 0.15;
      const reach = 0.48;
      const drop = 0.22;
      const pTopL = localHousePt(hi, winX, topY, -winW * 0.5);
      const pTopR = localHousePt(hi, winX, topY, winW * 0.5);
      const pOutL = localHousePt(hi, winX + sideSign * reach, topY - drop, -winW * 0.5);
      const pOutR = localHousePt(hi, winX + sideSign * reach, topY - drop, winW * 0.5);
      // 窗扇四周细木框 + 斜向竹编扇面 + 横向竹筋
      rod(pTopL, pTopR, 0.020, P.darkWood, 0.020, 3);
      rod(pOutL, pOutR, 0.020, P.darkWood, 0.020, 3);
      rod(pTopL, pOutL, 0.018, P.darkWood, 0.018, 3);
      rod(pTopR, pOutR, 0.018, P.darkWood, 0.018, 3);
      baker.quad(pTopL, pTopR, pOutR, pOutL, P.bamboo, 'solid');
      const sL = localHousePt(hi, winX + sideSign * reach * 0.52, topY - drop * 0.52 - 0.012, -winW * 0.48);
      const sR = localHousePt(hi, winX + sideSign * reach * 0.52, topY - drop * 0.52 - 0.012, winW * 0.48);
      rod(sL, sR, 0.012, P.bambooOld, 0.012, 3);
      // 两侧支窗细竹撑杆（由窗台外沿斜抵竹扇前缘）
      for (const sz of [-winW * 0.40, winW * 0.40]) {
        const sillPt = localHousePt(hi, winX + sideSign * 0.02, botY, sz);
        const propPt = localHousePt(hi, winX + sideSign * (reach * 0.88), topY - drop * 0.88, sz);
        rod(sillPt, propPt, 0.013, P.bambooOld, 0.012, 3);
      }
      const wFrameTop = localHousePt(hi, winX + sideSign * 0.12, topY + 0.04, 0);
      if (i === 0) addTarget('casement-window', wFrameTop[0], wFrameTop[1], wFrameTop[2], 5.5);

      // 1c. 屋脊瓦松与墙角苔痕
      const rp = localHousePt(hi, 0, hi.h + 2.26, 0);
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * TAU + i;
        frond([rp[0], rp[1] + 0.02, rp[2]], [Math.cos(ang), 0.7, Math.sin(ang)], 0.18, 0.045, P.wasong);
      }
      const mp = localHousePt(hi, -sideSign * (hi.w * 0.5 + 0.02), 0.10, 0);
      blk([mp[0], surface(mp[0], mp[2]) + 0.07, mp[2]], [0.06, 0.14, 0.52], P.moss, hi.rot);
    }

    // 1d. 燕子泥窝
    if (i < 2) {
      const nx = -sideSign * (hi.w * 0.5 + 0.07);
      const ny = hi.h - 0.14;
      const nz = hi.d * 0.20;
      const np = localHousePt(hi, nx, ny, nz);
      basinBowl(np, 0.12, P.mudWall);
      anchors.swallowNests.push({ x: np[0], y: np[1] + 0.08, z: np[2], sideSign, hi });
      if (anchors.swallowNests.length === 1) addTarget('swallow-nest', np[0], np[1], np[2], 5.5);
    }

    // 1e. 汉晋檐下挂串（蒜辫、茱萸串、艾草束与熏腊鱼）
    if (i < 2) {
      const ez = hi.d * 0.5 + 0.16;
      // 蒜辫：三枚圆润蒜球串联于草绳
      rod(localHousePt(hi, -0.78, 2.22, ez), localHousePt(hi, -0.78, 1.88, ez), 0.008, P.straw, 0.008, 3);
      for (let k = 0; k < 3; k++) {
        revolved(localHousePt(hi, -0.78 + (k % 2 ? 0.018 : -0.018), 1.92 + k * 0.085, ez), [[0.012, 0], [0.044, 0.025], [0.022, 0.068]], P.garlic, 4, k);
      }
      // 茱萸串：细枝垂挂朱红果簇
      rod(localHousePt(hi, -0.34, 2.22, ez), localHousePt(hi, -0.34, 1.90, ez), 0.009, P.bark, 0.007, 3);
      for (let k = 0; k < 3; k++) {
        blk(localHousePt(hi, -0.34 + (k - 1) * 0.025, 1.94 + k * 0.065, ez), [0.042, 0.042, 0.036], P.zhuyu, hi.rot + k * 0.6);
      }
      // 倒挂艾草束：束腰扎绳 + 舒展叶簇
      rod(localHousePt(hi, 0.36, 2.18, ez), localHousePt(hi, 0.36, 2.04, ez), 0.022, P.straw, 0.028, 4);
      for (let k = -1; k <= 1; k++) {
        frond(localHousePt(hi, 0.36, 2.08, ez), [k * 0.35, -1, 0.18], 0.24, 0.042, k === 0 ? P.wasong : P.mugwort);
      }
      // 熏腊鱼：悬绳 + 梭形鱼身 + 叉尾
      rod(localHousePt(hi, 0.76, 2.24, ez), localHousePt(hi, 0.76, 2.12, ez), 0.007, P.straw, 0.007, 3);
      rod(localHousePt(hi, 0.76, 2.12, ez), localHousePt(hi, 0.76, 1.96, ez), 0.024, P.fishAmber, 0.044, 4);
      rod(localHousePt(hi, 0.76, 1.96, ez), localHousePt(hi, 0.76, 1.84, ez), 0.044, P.fishAmber, 0.012, 4);
      frond(localHousePt(hi, 0.76, 1.85, ez), [0, -1, 0], 0.08, 0.048, P.darkWood);
      if (i === 0) {
        const tp = localHousePt(hi, -0.34, 2.05, ez);
        addTarget('eave-herbs', tp[0], tp[1], tp[2], 5.5);
      }
    }
  }

  // 1f-h. 柴木荆扉、缸瓢花瓣、木墩铁斧
  let gateCount = 0;
  let vatCount = 0;
  let axeCount = 0;
  for (const m of marks) {
    if (m.kind === 'fence' && m.gap > 0.2 && gateCount < 2) {
      gateCount++;
      const c = Math.cos(m.rot), s = Math.sin(m.rot);
      const hx = m.x - (m.gap * 0.5) * c + m.front * s;
      const hz = m.z + (m.gap * 0.5) * s + m.front * c;
      const gy = surface(hx, hz);
      const restSwing = m.rot - 0.66;
      const sc = Math.cos(restSwing), ss = Math.sin(restSwing);
      const gateLen = Math.min(0.76, m.gap * 0.88);
      blk([hx, gy + 0.43, hz], [0.07, 0.86, 0.07], P.bark, m.rot);
      anchors.gates.push({
        id: gateCount - 1,
        hx,
        gy,
        hz,
        baseRot: m.rot,
        restSwing,
        gateLen
      });
      if (gateCount === 1) {
        addTarget('brushwood-gate', hx + gateLen * 0.4 * sc, gy + 0.5, hz - gateLen * 0.4 * ss, 5.5);
      }
    } else if (m.kind === 'vat' && vatCount < 2) {
      vatCount++;
      const vy = surface(m.x, m.z) + 0.64;
      const lx = m.x + 0.11, lz = m.z - 0.06;
      basinBowl([lx, vy - 0.02, lz], 0.10, P.sunDry);
      blk([lx - 0.08, vy + 0.04, lz + 0.05], [0.22, 0.025, 0.025], P.bambooOld, 0.5);
      frond([m.x - 0.12, vy + 0.015, m.z + 0.10], [1, 0.1, 0.5], 0.06, 0.03, '#E9B7BC');
    } else if (m.kind === 'woodpile' && axeCount < 3) {
      axeCount++;
      const c = Math.cos(m.rot || 0), s = Math.sin(m.rot || 0);
      const sx = m.x + 0.72 * c + 0.25 * s;
      const sz = m.z - 0.72 * s + 0.25 * c;
      const sy = surface(sx, sz);
      if (axeCount === 1) {
        baker.beam([sx, sy - 0.04, sz], [sx, sy + 0.40, sz], 0.20, P.bark, 0.18, 5);
        blk([sx + 0.06 * c, sy + 0.58, sz - 0.06 * s], [0.04, 0.36, 0.04], P.wood, m.rot || 0);
        blk([sx + 0.03 * c, sy + 0.44, sz - 0.03 * s], [0.11, 0.08, 0.032], P.iron, (m.rot || 0) + 0.35);
        addTarget('chopping-axe', sx, sy + 0.55, sz, 5.5);
      }
      anchors.woodpiles.push({
        x: m.x, z: m.z, y: surface(m.x, m.z), rot: m.rot || 0,
        shelterX: m.x - 0.35 * c + 0.62 * s,
        shelterZ: m.z + 0.35 * s + 0.62 * c
      });
    }
  }

  // ============================================================================
  // 2. 四季百工与生活手作区：织染角、木作竹编摊、土窑陶器场
  // ============================================================================
  const sceneAnchor = (id, fbX, fbZ) => {
    const it = villageScenes?.scenes?.find(s => s.id === id);
    return it ? [it.x, it.z] : [fbX, fbZ];
  };

  // 2a. 织染角
  const [linenX, linenZ] = sceneAnchor('linen-court', -18, -176);
  const weaveSite = findSafeSite(linenX, linenZ, 2.75, context, [0, 4, 7.5, 11, 15, 19]);
  if (weaveSite) {
    reserveCircle(context, weaveSite.x, weaveSite.z, 3.0, 'qh-weaving');
    const wx = weaveSite.x, wz = weaveSite.z, wy = surface(wx, wz), wyaw = 0.35;
    const wp = (lx, ly, lz) => ptAbs(wx, wy, wz, wyaw, lx, ly, lz);

    // 织染草棚：石础柱脚 + 围桁斜撑 + 椽木 + 带压草竹筋的双层披水茅顶
    for (const [px, pz, h] of [[-1.25, -0.95, 2.08], [1.25, -0.95, 2.08], [-1.25, 0.95, 1.72], [1.25, 0.95, 1.72]]) {
      const pBase = wp(px, 0, pz);
      const pg = surface(pBase[0], pBase[2]);
      revolved([pBase[0], pg - 0.02, pBase[2]], [[0.14, 0], [0.11, 0.11]], P.stone, 4, wyaw + 0.4, false, true);
      rod([pBase[0], pg + 0.06, pBase[2]], [pBase[0], wy + h, pBase[2]], 0.052, P.bark, 0.046, 5);
      // 檐角斜撑
      rod(wp(px, h - 0.42, pz), wp(px - Math.sign(px) * 0.40, h - 0.02, pz), 0.028, P.darkWood, 0.026, 3);
    }
    // 前后檩条 + 两侧斜椽 + 茅檐垂边
    rod(wp(-1.38, 2.07, -0.95), wp(1.38, 2.07, -0.95), 0.044, P.darkWood, 0.044, 4);
    rod(wp(-1.38, 1.71, 0.95), wp(1.38, 1.71, 0.95), 0.044, P.darkWood, 0.044, 4);
    for (const rx of [-1.25, -0.42, 0.42, 1.25]) {
      rod(wp(rx, 2.10, -1.16), wp(rx, 1.68, 1.18), 0.030, P.bambooOld, 0.028, 3);
    }
    // 披水厚茅草屋面（上覆浅草、下托深茅檐口 + 屋面顺坡竹压筋）
    const rTL = wp(-1.52, 2.22, -1.18), rTR = wp(1.52, 2.22, -1.18);
    const rML = wp(-1.52, 1.98, 0.0), rMR = wp(1.52, 1.98, 0.0);
    const rBL = wp(-1.52, 1.72, 1.22), rBR = wp(1.52, 1.72, 1.22);
    const rBLd = wp(-1.52, 1.62, 1.22), rBRd = wp(1.52, 1.62, 1.22);
    const rTLd = wp(-1.52, 2.12, -1.18), rTRd = wp(1.52, 2.12, -1.18);
    baker.quad(rTL, rTR, rMR, rML, P.thatch, 'solid');
    baker.quad(rML, rMR, rBR, rBL, P.straw, 'solid');
    baker.quad(rBL, rBR, rBRd, rBLd, P.thatchDark, 'solid');
    baker.quad(rTL, rBL, rBLd, rTLd, P.thatchDark, 'solid');
    baker.quad(rTR, rTRd, rBRd, rBR, P.thatchDark, 'solid');
    for (const rx of [-1.05, 0.0, 1.05]) {
      rod(wp(rx, 2.24, -1.16), wp(rx, 1.74, 1.20), 0.018, P.thatchDark, 0.016, 3);
    }
    rod(wp(-1.56, 2.24, -1.18), wp(1.56, 2.24, -1.18), 0.048, P.thatchDark, 0.048, 4);
    rod(wp(-1.14, 1.54, 0.66), wp(1.14, 1.54, 0.66), 0.026, P.bambooOld, 0.024, 4);

    // 汉代斜织机（机架、综框、卷布轴、斜拉经面与舟形木梭）
    for (const dx of [-0.42, 0.42]) {
      rod(wp(dx, 0.02, -0.52), wp(dx, 0.02, 0.36), 0.032, P.darkWood, 0.032, 4);
      rod(wp(dx, 0.02, -0.45), wp(dx, 0.94, -0.45), 0.032, P.darkWood, 0.028, 4);
      rod(wp(dx, 0.02, 0.25), wp(dx, 1.18, 0.14), 0.032, P.darkWood, 0.028, 4);
      rod(wp(dx, 0.56, -0.45), wp(dx, 0.56, 0.22), 0.024, P.wood, 0.024, 4);
    }
    rod(wp(-0.46, 0.56, 0.22), wp(0.46, 0.56, 0.22), 0.036, P.wood, 0.036, 4);
    rod(wp(-0.46, 1.10, -0.14), wp(0.46, 1.10, -0.14), 0.028, P.bamboo, 0.028, 4);
    rod(wp(-0.46, 0.88, -0.45), wp(0.46, 0.88, -0.45), 0.034, P.wood, 0.034, 4);
    baker.quad(wp(-0.34, 0.58, 0.21), wp(0.34, 0.58, 0.21), wp(0.34, 1.04, -0.06), wp(-0.34, 1.04, -0.06), P.hemp, 'solid');
    baker.quad(wp(-0.34, 1.04, -0.06), wp(0.34, 1.04, -0.06), wp(0.34, 0.88, -0.44), wp(-0.34, 0.88, -0.44), P.hempDark, 'solid');
    // 舟形木梭
    rod(wp(0.06, 0.62, 0.08), wp(0.28, 0.62, 0.06), 0.018, P.sunDry, 0.010, 4);

    // 木制手摇纺车（底座、立柱、六辐大纺轮与锭子）
    const spX = 0.88, spZ = -0.18;
    blk(wp(spX, 0.05, spZ), [0.58, 0.07, 0.28], P.wood, wyaw);
    rod(wp(spX - 0.16, 0.08, spZ), wp(spX - 0.16, 0.58, spZ), 0.028, P.darkWood, 0.024, 4);
    rod(wp(spX + 0.18, 0.08, spZ), wp(spX + 0.18, 0.42, spZ), 0.022, P.darkWood, 0.018, 4);
    const wCtr = wp(spX - 0.16, 0.58, spZ);
    const wSegs = 6, wR = 0.24;
    for (let k = 0; k < wSegs; k++) {
      const a0 = (k / wSegs) * TAU, a1 = ((k + 1) / wSegs) * TAU;
      const p0 = wp(spX - 0.16 + Math.cos(a0) * wR, 0.58 + Math.sin(a0) * wR, spZ);
      const p1 = wp(spX - 0.16 + Math.cos(a1) * wR, 0.58 + Math.sin(a1) * wR, spZ);
      rod(p0, p1, 0.015, P.wood, 0.015, 3);
      if (k % 2 === 0) rod(wCtr, p0, 0.010, P.bambooOld, 0.010, 3);
    }

    // 靛青大染缸（七面鼓腹陶缸 + 缸内贴合靛青染液 + 斜靠搅布木棍，彻底消除蓝块穿模）
    const vatC = wp(-1.75, 0, 1.35);
    const vatG = surface(vatC[0], vatC[2]);
    revolved([vatC[0], vatG, vatC[2]], [
      [0.27, 0.0], [0.39, 0.22], [0.41, 0.46], [0.36, 0.62], [0.38, 0.66], [0.32, 0.66]
    ], P.grayClay, 7, wyaw, true, false);
    disc([vatC[0], vatG + 0.54, vatC[2]], 0.33, P.indigoDeep, 7, wyaw);
    disc([vatC[0], vatG + 0.546, vatC[2]], 0.24, P.indigo, 6, wyaw + 0.3);
    rod([vatC[0] - 0.06, vatG + 0.36, vatC[2] - 0.04], [vatC[0] + 0.28, vatG + 0.88, vatC[2] + 0.14], 0.020, P.darkWood, 0.016, 4);

    // 树杈老毛竹晾架（斜撑脚 + 叉口）+ 广口红陶接水盆
    const rLeft = wp(-0.92, 0, 1.95);
    const rRight = wp(0.92, 0, 1.95);
    const rMid = wp(0, 0, 1.95);
    for (const [p, sx] of [[rLeft, -1], [rRight, 1]]) {
      const g = surface(p[0], p[2]);
      rod([p[0], g - 0.04, p[2]], [p[0], wy + 1.48, p[2]], 0.040, P.bark, 0.032, 4);
      const brFoot = wp(sx * 1.18, 0, 1.95);
      rod([brFoot[0], surface(brFoot[0], brFoot[2]) - 0.02, brFoot[2]], [p[0], wy + 0.56, p[2]], 0.026, P.darkWood, 0.022, 4);
    }
    rod([rLeft[0], wy + 1.45, rLeft[2]], [rRight[0], wy + 1.45, rRight[2]], 0.030, P.bambooOld, 0.028, 4);
    const basinG = surface(rMid[0], rMid[2]);
    basinBowl([rMid[0], basinG + 0.01, rMid[2]], 0.28, P.redClay, 6);
    disc([rMid[0], basinG + 0.11, rMid[2]], 0.21, P.indigo, 6, wyaw);

    addBlocker(wx, wz, 1.05, 0.85, wyaw, wy - 0.3, wy + 2.1, 'weaving-loom');
    addTarget('oblique-loom', wx, wy + 0.85, wz, 5.5);
    addTarget('indigo-vat', vatC[0], vatG + 0.65, vatC[2], 5.5);

    const weaverP = wp(-0.1, 0, -0.78);
    anchors.weaving = {
      x: wx, y: wy, z: wz, yaw: wyaw,
      workerPos: [weaverP[0], surface(weaverP[0], weaverP[2]), weaverP[2]],
      workerFacing: wyaw + Math.PI,
      rackCenter: [rMid[0], wy + 1.43, rMid[2]],
      rackYaw: wyaw,
      basinY: basinG + 0.12,
      eaveBar: wp(0, 1.50, 0.66),
      trayShelter: wp(0.55, 0.10, -0.25)
    };
    anchors.dyeRack = anchors.weaving;
  }

  // 2b. 木作竹编摊
  const [teaX, teaZ] = sceneAnchor('wayside-tea', -19, -139);
  const carpSite = findSafeSite(teaX + 12, teaZ - 6, 2.5, context, [0, 4, 8, 12, 16, 20]);
  if (carpSite) {
    reserveCircle(context, carpSite.x, carpSite.z, 2.75, 'qh-carpentry');
    const cx = carpSite.x, cz = carpSite.z, cy = surface(cx, cz), cyaw = -0.5;
    const cp = (lx, ly, lz) => ptAbs(cx, cy, cz, cyaw, lx, ly, lz);

    // 木作长凳：撇脚榫卯木马 + 刨花长木案 + 传统推刨
    for (const lx of [-0.88, 0.88]) {
      rod(cp(lx, 0.0, -0.28), cp(lx, 0.56, -0.10), 0.038, P.bark, 0.034, 4);
      rod(cp(lx, 0.0, 0.28), cp(lx, 0.56, 0.10), 0.038, P.bark, 0.034, 4);
      rod(cp(lx, 0.26, -0.20), cp(lx, 0.26, 0.20), 0.024, P.darkWood, 0.024, 4);
    }
    blk(cp(0, 0.63, 0), [2.42, 0.16, 0.28], P.wood, cyaw);
    blk(cp(-0.85, 0.76, 0.02), [0.16, 0.10, 0.11], P.darkWood, cyaw);
    // 传统横柄木刨
    blk(cp(0.28, 0.76, 0), [0.24, 0.065, 0.075], P.sunDry, cyaw);
    rod(cp(0.26, 0.79, -0.11), cp(0.26, 0.79, 0.11), 0.014, P.darkWood, 0.014, 3);
    for (let k = 0; k < 3; k++) {
      const sp = cp(-0.5 + k * 0.5, 0, 0.36);
      frond([sp[0], surface(sp[0], sp[2]) + 0.02, sp[2]], [Math.cos(k * 1.4), 0.25, Math.sin(k * 1.4)], 0.18, 0.045, P.straw);
    }

    const bsX = 1.65, bsZ = 0.42;
    const bsBase = cp(bsX, 0, bsZ);
    const bsY = surface(bsBase[0], bsBase[2]);
    const bp = (lx, ly, lz) => ptAbs(bsBase[0], bsY, bsBase[2], cyaw + 0.4, lx, ly, lz);
    // 竹凳 + 竹篾丝 + 编织竹篮与竹篓
    blk(bp(0, 0.32, 0), [0.42, 0.05, 0.36], P.bamboo, cyaw + 0.4);
    for (const [dx, dz] of [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.12], [0.15, 0.12]]) {
      rod(bp(dx, 0, dz), bp(dx * 0.9, 0.31, dz * 0.9), 0.022, P.bambooOld, 0.020, 4);
    }
    for (let k = 0; k < 3; k++) {
      blk(bp(-0.25 + k * 0.12, 0.02, -0.45), [0.03, 0.015, 0.48], P.moss, cyaw + 0.2 * k);
    }
    basinBowl(bp(-0.48, 0.01, 0.28), 0.24, P.bamboo, 6);
    revolved(bp(0.45, 0.01, -0.35), [[0.14, 0], [0.22, 0.16], [0.20, 0.34], [0.22, 0.36]], P.bambooOld, 6, cyaw, true, false);

    addBlocker(cx, cz, 0.95, 0.45, cyaw, cy - 0.3, cy + 1.2, 'carpenter-bench');
    addTarget('carpenter-bench', cx, cy + 0.85, cz, 5.5);

    const carpWorker = cp(0.1, 0, -0.52);
    anchors.carpentry = {
      x: cx, y: cy, z: cz, yaw: cyaw,
      carpenterPos: [carpWorker[0], surface(carpWorker[0], carpWorker[2]), carpWorker[2]],
      carpenterFacing: cyaw,
      bambooPos: [bsBase[0], bsY + 0.18, bsBase[2]],
      bambooFacing: cyaw - 1.2
    };
  }

  // 2c. 先秦汉晋土窑制陶场
  const [potX, potZ] = sceneAnchor('potter-corner', 9, -207);
  const potSite = findSafeSite(potX + 3, potZ + 5, 2.5, context, [0, 4.5, 8.5, 13, 17]);
  if (potSite) {
    reserveCircle(context, potSite.x, potSite.z, 2.8, 'qh-pottery');
    const px = potSite.x, pz = potSite.z, py = surface(px, pz), pyaw = -2.1;
    const pp = (lx, ly, lz) => ptAbs(px, py, pz, pyaw, lx, ly, lz);

    // 穹顶石基夯土馒头窑（石基座 + 八面鼓腹穹窿 + 红砖箍带 + 拱券砖砌窑门 + 带雨帽窑囱 + 窑旁松柴）
    const kilnBase = pp(0, 0, -0.58);
    revolved(kilnBase, [[1.15, -0.02], [1.10, 0.18]], P.stoneDark, 8, pyaw, false, false);
    revolved([kilnBase[0], kilnBase[1] + 0.16, kilnBase[2]], [
      [1.06, 0.0], [1.01, 0.22], [0.90, 0.64], [0.66, 0.98], [0.34, 1.14]
    ], P.mudWall, 8, pyaw, false, true);
    // 窑腰红砖防裂箍带
    revolved([kilnBase[0], kilnBase[1] + 0.50, kilnBase[2]], [[0.985, 0], [0.975, 0.085]], P.redClay, 8, pyaw, false, false);
    // 拱券砖砌窑门与炭灰膛口 + 门前铺砖火道
    blk(pp(-0.24, 0.30, 0.34), [0.15, 0.56, 0.42], P.redClay, pyaw);
    blk(pp(0.24, 0.30, 0.34), [0.15, 0.56, 0.42], P.redClay, pyaw);
    blk(pp(0, 0.61, 0.34), [0.62, 0.12, 0.44], P.redClay, pyaw);
    blk(pp(0, 0.28, 0.38), [0.32, 0.48, 0.18], P.ash, pyaw);
    blk(pp(0, 0.03, 0.64), [0.66, 0.06, 0.34], P.stone, pyaw);
    // 窑侧码放的待烧松柴堆
    for (const [lx, ly] of [[0.98, 0.07], [1.12, 0.07], [1.05, 0.18]]) {
      rod(pp(lx, ly, -0.26), pp(lx, ly, 0.22), 0.056, ly > 0.1 ? P.bark : P.darkWood, 0.052, 4);
    }
    // 顶部收分陶窑烟囱 + 四角砖撑 + 六棱防雨瓦帽
    revolved(pp(0, 1.24, -0.64), [[0.22, 0], [0.16, 0.46], [0.20, 0.52]], P.redClay, 6, pyaw, false, false);
    for (const [dx, dz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
      rod(pp(dx, 1.75, -0.64 + dz), pp(dx, 1.85, -0.64 + dz), 0.024, P.grayClay, 0.024, 3);
    }
    revolved(pp(0, 1.84, -0.64), [[0.30, 0], [0.02, 0.15]], P.grayClay, 6, pyaw, false, false);

    // 晾坯长木案（四足斜撑）
    blk(pp(-0.40, 0.56, 1.08), [1.98, 0.055, 0.50], P.wood, pyaw);
    for (const bx of [-1.22, 0.42]) {
      for (const bz of [0.90, 1.26]) {
        rod(pp(bx, 0, bz), pp(bx, 0.55, bz), 0.032, P.bark, 0.028, 4);
      }
      rod(pp(bx, 0.24, 0.90), pp(bx, 0.24, 1.26), 0.022, P.darkWood, 0.022, 4);
    }

    // 1) 三足陶鬲（三只中空袋足 + 鼓肩折沿广口灰陶）
    const liC = pp(-0.92, 0.59, 1.08);
    for (let f = 0; f < 3; f++) {
      const a = pyaw + (f / 3) * TAU + 0.3;
      const fx = Math.cos(a), fz = Math.sin(a);
      rod([liC[0] + fx * 0.095, liC[1], liC[2] + fz * 0.095], [liC[0] + fx * 0.045, liC[1] + 0.14, liC[2] + fz * 0.045], 0.022, P.potRim, 0.068, 4);
    }
    revolved([liC[0], liC[1] + 0.11, liC[2]], [
      [0.105, 0], [0.125, 0.06], [0.092, 0.12], [0.126, 0.155]
    ], P.grayClay, 6, pyaw);

    // 2) 高足黑陶豆（喇叭圈足 + 细高豆柄 + 浅腹敞口黑陶盘）
    const douC = pp(-0.34, 0.59, 1.08);
    revolved(douC, [
      [0.095, 0.0], [0.042, 0.04], [0.034, 0.175], [0.056, 0.205], [0.148, 0.268]
    ], P.blackClay, 6, pyaw);

    // 3) 红陶双耳罐（圆腹细颈撇口红陶罐 + 两侧弧形泥耳）
    const jarC = pp(0.24, 0.59, 1.08);
    revolved(jarC, [
      [0.075, 0.0], [0.138, 0.10], [0.128, 0.18], [0.072, 0.235], [0.094, 0.275]
    ], P.redClay, 6, pyaw);
    for (const s of [-1, 1]) {
      const e0 = ptAbs(jarC[0], jarC[1], jarC[2], pyaw, s * 0.125, 0.15, 0);
      const eMid = ptAbs(jarC[0], jarC[1], jarC[2], pyaw, s * 0.165, 0.20, 0);
      const e1 = ptAbs(jarC[0], jarC[1], jarC[2], pyaw, s * 0.082, 0.24, 0);
      rod(e0, eMid, 0.014, P.redClay, 0.013, 3);
      rod(eMid, e1, 0.013, P.redClay, 0.012, 3);
    }

    addBlocker(px, pz, 1.05, 0.95, pyaw, py - 0.3, py + 1.8, 'clay-kiln');
    addTarget('clay-li-dou', douC[0], douC[1] + 0.2, douC[2], 5.5);
    anchors.pottery = { x: px, y: py, z: pz };
  }

  // ============================================================================
  // 3. 良田美池旁：田埂瓜庐、曲木犁轭、采桑木梯、连筒菖蒲、池边浸泥白萝卜
  // ============================================================================
  const fields = world?.village?.fields?.blocks || [];
  const f0 = fields[0];
  if (f0) {
    const fw = f0.cols * f0.plot[0] + (f0.cols - 1) * f0.gap;
    const hutSite = findSafeSite(f0.x + fw + 3.2, f0.z - 4.0, 2.35, context, [0, 3.5, 7, 11, 16, 21]);
    if (hutSite) {
      reserveCircle(context, hutSite.x, hutSite.z, 2.6, 'qh-field-hut');
      const hx = hutSite.x, hz = hutSite.z, hy = surface(hx, hz), hyaw = -0.35;
      const hp = (lx, ly, lz) => ptAbs(hx, hy, hz, hyaw, lx, ly, lz);

      // 田埂瓜庐：石柱础 + 四根圆木立柱 + 围枋斜撑 + 双折攒尖厚茅顶 + 竹脊宝盖
      const posts = [[-0.95, -0.88], [0.95, -0.88], [-0.95, 0.88], [0.95, 0.88]];
      for (const [px, pz] of posts) {
        const pBase = hp(px, 0, pz);
        const pg = surface(pBase[0], pBase[2]);
        revolved([pBase[0], pg - 0.02, pBase[2]], [[0.12, 0], [0.10, 0.09]], P.stone, 4, hyaw + 0.4, false, true);
        rod([pBase[0], pg + 0.05, pBase[2]], [pBase[0], hy + 1.88, pBase[2]], 0.050, P.bark, 0.044, 5);
      }
      // 顶部四方围枋 + 四角斜撑 + 后背低矮竹靠栏
      rod(hp(-1.02, 1.84, -0.88), hp(1.02, 1.84, -0.88), 0.040, P.darkWood, 0.040, 4);
      rod(hp(-1.02, 1.84, 0.88), hp(1.02, 1.84, 0.88), 0.040, P.darkWood, 0.040, 4);
      rod(hp(-0.95, 1.84, -0.95), hp(-0.95, 1.84, 0.95), 0.040, P.darkWood, 0.040, 4);
      rod(hp(0.95, 1.84, -0.95), hp(0.95, 1.84, 0.95), 0.040, P.darkWood, 0.040, 4);
      for (const [px, pz] of posts) {
        rod(hp(px, 1.46, pz), hp(px - Math.sign(px) * 0.36, 1.84, pz), 0.026, P.darkWood, 0.024, 3);
      }
      rod(hp(-0.95, 0.54, -0.88), hp(0.95, 0.54, -0.88), 0.026, P.bambooOld, 0.026, 3);
      // 凹曲两折四坡攒尖茅顶（带檐口厚度、顺坡压草竹筋与草脊顶帽）
      const peak = hp(0, 2.58, 0);
      const midE = [hp(-0.66, 2.16, -0.62), hp(0.66, 2.16, -0.62), hp(0.66, 2.16, 0.62), hp(-0.66, 2.16, 0.62)];
      const eaves = [hp(-1.32, 1.76, -1.24), hp(1.32, 1.76, -1.24), hp(1.32, 1.76, 1.24), hp(-1.32, 1.76, 1.24)];
      const eaveDn = [hp(-1.32, 1.67, -1.24), hp(1.32, 1.67, -1.24), hp(1.32, 1.67, 1.24), hp(-1.32, 1.67, 1.24)];
      for (let k = 0; k < 4; k++) {
        const nk = (k + 1) % 4;
        baker.quad(eaves[k], eaves[nk], midE[nk], midE[k], k % 2 ? P.straw : P.thatch, 'solid');
        baker.tri(midE[k], midE[nk], peak, k % 2 ? P.thatch : P.thatchDark, 'solid');
        baker.quad(eaves[k], eaves[nk], eaveDn[nk], eaveDn[k], P.thatchDark, 'solid');
        rod(eaves[k], peak, 0.028, P.bambooOld, 0.018, 3);
        const eMid = [(eaves[k][0] + eaves[nk][0]) * 0.5, (eaves[k][1] + eaves[nk][1]) * 0.5 + 0.015, (eaves[k][2] + eaves[nk][2]) * 0.5];
        const mMid = [(midE[k][0] + midE[nk][0]) * 0.5, (midE[k][1] + midE[nk][1]) * 0.5 + 0.015, (midE[k][2] + midE[nk][2]) * 0.5];
        rod(eMid, mMid, 0.016, P.thatchDark, 0.014, 3);
      }
      revolved(hp(0, 2.52, 0), [[0.20, 0], [0.12, 0.10], [0.03, 0.18]], P.thatchDark, 5, hyaw);
      // 镶边竹席 + 旋削灰陶饮水罐
      blk(hp(0, 0.04, 0.08), [1.38, 0.04, 1.06], P.straw, hyaw);
      blk(hp(0, 0.055, 0.08), [1.26, 0.02, 0.94], P.hemp, hyaw);
      const hutJar = hp(0.36, 0.06, 0.24);
      revolved(hutJar, [[0.08, 0], [0.14, 0.12], [0.125, 0.22], [0.075, 0.27], [0.095, 0.30]], P.grayClay, 6, hyaw);
      rod([hutJar[0] - 0.12, hutJar[1] + 0.31, hutJar[2]], [hutJar[0] + 0.14, hutJar[1] + 0.31, hutJar[2] + 0.04], 0.012, P.bambooOld, 0.012, 3);

      // 曲木犁轭（曲犁辕、犁梢扶手、楔形铁犁铧与弧形牛轭）
      const plBase = hp(1.48, 0, 0.25);
      const plY = surface(plBase[0], plBase[2]);
      const plp = (lx, ly, lz) => ptAbs(plBase[0], plY, plBase[2], hyaw + 0.5, lx, ly, lz);
      rod(plp(0, 0.08, -0.56), plp(0, 0.26, 0.02), 0.034, P.wood, 0.032, 4);
      rod(plp(0, 0.26, 0.02), plp(0, 0.38, 0.62), 0.032, P.wood, 0.026, 4);
      rod(plp(0, 0.08, -0.45), plp(0, 0.88, -0.70), 0.030, P.darkWood, 0.024, 4);
      rod(plp(0, 0.88, -0.70), plp(0.14, 0.88, -0.72), 0.020, P.darkWood, 0.018, 3);
      rod(plp(0, 0.24, -0.18), plp(0, 0.10, -0.42), 0.022, P.darkWood, 0.022, 3);
      // 楔形铁犁铧
      rod(plp(0, 0.05, -0.64), plp(0, 0.08, -0.34), 0.018, P.iron, 0.068, 4);
      // 弧形牛轭
      rod(plp(-0.34, 0.30, 0.58), plp(0, 0.37, 0.60), 0.028, P.wood, 0.032, 4);
      rod(plp(0, 0.37, 0.60), plp(0.34, 0.30, 0.58), 0.032, P.wood, 0.028, 4);

      addBlocker(hx, hz, 0.15, 0.15, hyaw, hy - 0.3, hy + 2.2, 'field-hut-post-core');
      addTarget('field-hut', hx, hy + 0.9, hz, 5.5);
      addTarget('wooden-plow', plBase[0], plY + 0.4, plBase[2], 5.5);

      const farmerPos = hp(-0.18, 0, -0.05);
      anchors.fieldHut = {
        x: hx, y: hy, z: hz, yaw: hyaw,
        farmerPos: [farmerPos[0], surface(farmerPos[0], farmerPos[2]), farmerPos[2]],
        farmerFacing: hyaw + 0.3,
        trayShelter: hp(-0.35, 0.10, -0.25)
      };
    }
  }

  // 3b. 后山桑林采桑木梯与蚕匾
  const mulTrees = village?.mulberry || [];
  if (mulTrees.length) {
    const mt = mulTrees[Math.min(2, mulTrees.length - 1)];
    const tx = mt[0], tz = mt[1], tr = mt[2] || 0.9;
    const lx = tx + tr * 0.72, lz = tz + tr * 0.32;
    const gy = surface(lx, lz);
    const leanTop = [tx + 0.25, surface(tx, tz) + 2.25, tz + 0.12];
    for (const off of [-0.18, 0.18]) {
      baker.beam([lx - off * 0.3, gy - 0.04, lz + off], [leanTop[0] - off * 0.3, leanTop[1], leanTop[2] + off], 0.025, P.bambooOld, 0.022, 3);
    }
    for (let r = 1; r <= 4; r++) {
      const f = r / 5;
      const rx = lx + (leanTop[0] - lx) * f, ry = gy + (leanTop[1] - gy) * f, rz = lz + (leanTop[2] - lz) * f;
      blk([rx, ry, rz], [0.04, 0.03, 0.36], P.wood, 0);
    }
  }

  // 3c. 连筒引水接口翠绿菖蒲（支持 2 点或以上连筒，兜底于池塘岸畔）
  const pond = world?.terrain?.pond;
  const conduit = unwrap(leisureGrove).conduit;
  const cPts = conduit?.points || [];
  if (cPts.length >= 2) {
    const p = cPts[cPts.length > 2 ? 1 : 0];
    const gy = surface(p.x, p.z);
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * TAU;
      const bx = p.x + Math.cos(a) * 0.16, bz = p.z + Math.sin(a) * 0.16;
      const by = surface(bx, bz);
      frond([bx, by, bz], [Math.cos(a) * 0.12, 0.45 + (b % 2) * 0.1, Math.sin(a) * 0.12], 0.46, 0.035, b % 2 ? P.radishLeaf : P.moss);
    }
    addTarget('calamus', p.x, gy + 0.25, p.z, 5.0);
  } else if (pond) {
    const cx = pond.x + (pond.waterRadius || 8.5) * 0.92;
    const cz = pond.z;
    const cy = surface(cx, cz);
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * TAU;
      frond([cx, cy, cz], [Math.cos(a) * 0.12, 0.45, Math.sin(a) * 0.12], 0.46, 0.035, b % 2 ? P.radishLeaf : P.moss);
    }
    addTarget('calamus', cx, cy + 0.25, cz, 5.0);
  }

  // 3d. 池塘捣衣青石旁泡泥白萝卜竹篮
  const placements = unwrap(pondLife).placements || [];
  const laundryStone = placements.find(p => p.target === 'laundry' || p.target === 'laundry-stone' || p.mesh === 'pond-life-shore');
  if (pond && laundryStone) {
    const dirX = pond.x - laundryStone.x, dirZ = pond.z - laundryStone.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const tx = -dirZ / len, tz = dirX / len;
    const bx = laundryStone.x + tx * 0.92 + (dirX / len) * 0.35;
    const bz = laundryStone.z + tz * 0.92 + (dirZ / len) * 0.35;
    const by = Math.max(surface(bx, bz) + 0.04, pond.waterY - 0.14);
    basinBowl([bx, by, bz], 0.26, P.bambooOld);
    for (let r = 0; r < 3; r++) {
      const a = (r / 3) * TAU + 0.4;
      const rx = bx + Math.cos(a) * 0.10, rz = bz + Math.sin(a) * 0.10;
      const top = [rx + Math.cos(a) * 0.12, by + 0.22, rz + Math.sin(a) * 0.12];
      blk([(rx + top[0]) * 0.5, by + 0.14, (rz + top[2]) * 0.5], [0.06, 0.18, 0.06], P.radish, a);
      frond(top, [Math.cos(a), 0.7, Math.sin(a)], 0.15, 0.04, P.radishLeaf);
    }
    addTarget('radish-basket', bx, by + 0.22, bz, 5.5);
    anchors.laundryEdge = { x: laundryStone.x, z: laundryStone.z, y: pond.waterY };
  }

  // ============================================================================
  // 4. 村心晒谷场：篝火石坛 + 汉晋席地矮木食案与击缶而歌陶缶
  // ============================================================================
  const thresh = marks.find(m => m.kind === 'thresh');
  if (thresh) {
    const hSite = findSafeSite(thresh.x + thresh.r * 0.68, thresh.z + thresh.r * 0.42, 1.9, context, [0, 2.2, 4.0, 6.2, 8.5]);
    if (hSite) {
      reserveCircle(context, hSite.x, hSite.z, 2.1, 'qh-hearth');
      const fx = hSite.x, fz = hSite.z, fy = surface(fx, fz);
      // 密叠八石河卵石篝火坛 + 炭灰窝 + 井字交叉柴架
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU + 0.15;
        const rOff = 0.44 + (k % 2) * 0.03;
        const sx = fx + Math.cos(a) * rOff, sz = fz + Math.sin(a) * rOff;
        revolved([sx, surface(sx, sz) - 0.03, sz], [[0.16, 0], [0.165, 0.09], [0.10, 0.17]], k % 2 ? P.stone : P.stoneDark, 4, a, false, true);
      }
      disc([fx, fy + 0.04, fz], 0.39, P.ash, 6, 0.2);
      for (let k = 0; k < 4; k++) {
        const a = k * 0.82 + 0.25;
        const ca = Math.cos(a) * 0.30, sa = Math.sin(a) * 0.30;
        rod([fx - ca, fy + 0.06, fz - sa], [fx + ca * 0.55, fy + 0.22 + (k % 2) * 0.04, fz + sa * 0.55], 0.034, k % 2 ? P.bark : P.darkWood, 0.026, 3);
      }

      const ox = -1.08, oz = -0.58, rot = 0.45;
      const tp = (lx, ly, lz) => ptAbs(fx + ox, surface(fx + ox, fz + oz), fz + oz, rot, lx, ly, lz);
      blk(tp(0, 0.02, 0.25), [0.90, 0.03, 0.58], P.straw, rot);
      blk(tp(0, 0.24, -0.18), [0.78, 0.045, 0.46], P.wood, rot);
      for (const [ax, az] of [[-0.31, -0.35], [0.31, -0.35], [-0.31, -0.01], [0.31, -0.01]]) {
        rod(tp(ax, 0, az), tp(ax * 0.94, 0.23, az), 0.026, P.darkWood, 0.024, 3);
      }
      rod(tp(-0.30, 0.11, -0.35), tp(0.30, 0.11, -0.35), 0.018, P.darkWood, 0.018, 3);
      rod(tp(-0.30, 0.11, -0.01), tp(0.30, 0.11, -0.01), 0.018, P.darkWood, 0.018, 3);
      basinBowl(tp(-0.16, 0.265, -0.18), 0.10, P.blackClay, 5);
      // 秦汉鼓腹小口陶缶 + 击缶竹箸
      const fp = tp(0.24, 0.265, -0.18);
      revolved(fp, [[0.075, 0], [0.125, 0.08], [0.115, 0.15], [0.068, 0.185], [0.082, 0.205]], P.grayClay, 6, rot);
      rod([fp[0] - 0.06, fp[1] + 0.21, fp[2] - 0.04], [fp[0] + 0.16, fp[1] + 0.22, fp[2] + 0.10], 0.010, P.bambooOld, 0.008, 3);
      addTarget('clay-fou', fp[0], fp[1] + 0.18, fp[2], 5.5);

      anchors.hearth = { x: fx, y: fy, z: fz };
    }

    for (const [k, ang] of [[0, -0.8], [1, 2.35]]) {
      const tx = thresh.x + Math.cos(ang) * (thresh.r * 0.58);
      const tz = thresh.z + Math.sin(ang) * (thresh.r * 0.58);
      const ty = surface(tx, tz);
      const fallbackShelter = anchors.eaveShelters[0]
        ? [anchors.eaveShelters[0].x, anchors.eaveShelters[0].y, anchors.eaveShelters[0].z]
        : [tx, ty + 0.15, tz];
      const sh = k === 0 && anchors.weaving ? anchors.weaving.trayShelter : fallbackShelter;
      anchors.dryingTrays.push({
        sun: [tx, ty + 0.06, tz],
        shelter: [sh[0] + k * 0.28, sh[1] + 0.04, sh[2]],
        cropKind: k
      });
    }
    if (anchors.fieldHut) {
      const fhp = anchors.fieldHut;
      anchors.dryingTrays.push({
        sun: [fhp.x + 1.45, surface(fhp.x + 1.45, fhp.z - 0.85) + 0.06, fhp.z - 0.85],
        shelter: fhp.trayShelter,
        cropKind: 2
      });
    }
  }

  const staticMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide
  });
  const mesh = baker.finish('solid', staticMat);
  mesh.name = 'qin-han-static';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const triCount = (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3;
  baker.dispose();

  return { mesh, blockers, targets, anchors, context, triCount };
}
