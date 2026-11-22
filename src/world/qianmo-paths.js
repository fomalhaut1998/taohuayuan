import * as THREE from 'three';
import qianmoCfg from '../data/qianmo-paths.json' with { type: 'json' };
import { chaikinSmooth, resamplePolyline, buildNaturalRoadRibbon } from './road-geometry.js';
import { createVertexColorBaker } from './valley-borderlands-geometry.js';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
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

function segDist2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-8) return { x: ax, z: az, dist: Math.hypot(px - ax, pz - az), t: 0 };
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return { x: cx, z: cz, dist: Math.hypot(px - cx, pz - cz), t };
}

function nearestOnPolyline(pts, x, z) {
  let best = { x: pts[0][0], z: pts[0][1], dist: Infinity, segIndex: 0, t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const hit = segDist2D(x, z, a[0], a[1], b[0], b[1]);
    if (hit.dist < best.dist) {
      best = { x: hit.x, z: hit.z, dist: hit.dist, segIndex: i, t: hit.t };
    }
  }
  return best;
}

function nearestOnPathSet(paths, x, z) {
  let best = null;
  for (const p of paths) {
    if (!p.points || p.points.length < 2) continue;
    const hit = nearestOnPolyline(p.points, x, z);
    if (!best || hit.dist < best.dist) {
      best = { ...hit, path: p };
    }
  }
  return best;
}

function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return total;
}

function polylineMidpoint(pts) {
  const total = polylineLength(pts);
  if (!pts || pts.length < 2) return { x: 0, z: 0, tx: 1, tz: 0 };
  const half = total * 0.5;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dz = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dz) || 1e-4;
    if (acc + len >= half || i === pts.length - 1) {
      const u = clamp((half - acc) / len, 0, 1);
      return {
        x: pts[i - 1][0] + dx * u,
        z: pts[i - 1][1] + dz * u,
        tx: dx / len,
        tz: dz / len
      };
    }
    acc += len;
  }
  return { x: pts[0][0], z: pts[0][1], tx: 1, tz: 0 };
}

function signedBoxGap(x, z, b) {
  const c = Math.cos(b.rot || 0);
  const s = Math.sin(b.rot || 0);
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = Math.abs(lx) - (b.hw || 0);
  const qz = Math.abs(lz) - (b.hd || 0);
  const outDist = Math.hypot(Math.max(0, qx), Math.max(0, qz));
  const inDist = Math.min(Math.max(qx, qz), 0);
  let nxLocal = 0;
  let nzLocal = 0;
  if (outDist > 0) {
    nxLocal = qx > 0 ? Math.sign(lx) * qx / outDist : 0;
    nzLocal = qz > 0 ? Math.sign(lz) * qz / outDist : 0;
  } else if (qx > qz) {
    nxLocal = Math.sign(lx) || 1;
  } else {
    nzLocal = Math.sign(lz) || 1;
  }
  const wx = nxLocal * c + nzLocal * s;
  const wz = -nxLocal * s + nzLocal * c;
  return { dist: outDist + inDist, nx: wx, nz: wz };
}

function pushOutsideAABB(x, z, box, margin) {
  const cx = (box.xMin + box.xMax) * 0.5;
  const cz = (box.zMin + box.zMax) * 0.5;
  const hw = (box.xMax - box.xMin) * 0.5 + margin;
  const hd = (box.zMax - box.zMin) * 0.5 + margin;
  const dx = x - cx;
  const dz = z - cz;
  const px = hw - Math.abs(dx);
  const pz = hd - Math.abs(dz);
  if (px <= 0 || pz <= 0) return null;
  if (px < pz) return [x + (dx >= 0 ? px : -px), z];
  return [x, z + (dz >= 0 ? pz : -pz)];
}

/** Collect all world solid blockers, pond water, props marks, and farmland plot boxes. */
function collectObstacles(options) {
  const solidBoxes = [];
  const solidCircles = [];
  const plotBoxes = [];
  const blockBounds = [];

  const world = options.world || {};
  const modules = [
    options.village, options.hinterland, options.villageScenes, options.villageLife,
    options.mysteryWorld, options.exterior, options.pondLife, options.waterworks,
    options.leisureGrove, options.hospitalityFeast, options.qinHanHomestead,
    options.easterEggs, options.valleyBorderlands
  ];
  for (const mod of modules) {
    for (const b of mod?.blockers || []) {
      if (Number.isFinite(b?.x) && Number.isFinite(b?.z)) {
        solidBoxes.push({ x: b.x, z: b.z, hw: b.hw || 0.5, hd: b.hd || 0.5, rot: b.rot || 0, source: b.source || '' });
      }
    }
  }

  for (const m of options.props?.marks || []) {
    if (!Number.isFinite(m?.x) || !Number.isFinite(m?.z)) continue;
    if (m.kind === 'thresh') {
      solidCircles.push({ x: m.x, z: m.z, r: (m.r || m.radius || 3.8) + 0.85, tag: 'thresh' });
    } else if (m.kind === 'well' || m.kind === 'mill' || m.kind === 'hay' || m.kind === 'kiln') {
      solidCircles.push({ x: m.x, z: m.z, r: (m.r || m.radius || 1.1) + 0.75, tag: m.kind });
    }
  }

  const sun = options.valleyBorderlands?.layout?.sunningTerrace;
  if (sun && Number.isFinite(sun.x) && Number.isFinite(sun.z)) {
    solidCircles.push({ x: sun.x, z: sun.z, r: (sun.radius || 4.6) + 0.7, tag: 'sunningTerrace' });
  }

  const pond = world?.terrain?.pond || { x: 68, z: -152, radius: 13, waterRadius: 9.2 };
  const pondWaterCircle = { x: pond.x, z: pond.z, r: (pond.waterRadius || 9.2) + 0.85 };

  const blocks = world?.village?.fields?.blocks || [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const blk = blocks[bi];
    const pw = blk.plot[0];
    const ph = blk.plot[1];
    const gap = blk.gap;
    let bxMin = Infinity;
    let bxMax = -Infinity;
    let bzMin = Infinity;
    let bzMax = -Infinity;
    for (let r = 0; r < blk.rows; r++) {
      for (let c = 0; c < blk.cols; c++) {
        const xMin = blk.x + c * (pw + gap);
        const xMax = xMin + pw;
        const zMax = blk.z - r * (ph + gap);
        const zMin = zMax - ph;
        bxMin = Math.min(bxMin, xMin);
        bxMax = Math.max(bxMax, xMax);
        bzMin = Math.min(bzMin, zMin);
        bzMax = Math.max(bzMax, zMax);
        plotBoxes.push({
          bi, r, c, xMin, xMax, zMin, zMax,
          isRicePaddy: (bi + r + c) % 3 !== 0
        });
      }
    }
    blockBounds.push({ bi, blk, xMin: bxMin, xMax: bxMax, zMin: bzMin, zMax: bzMax });
  }

  return { world, pond, pondWaterCircle, solidBoxes, solidCircles, plotBoxes, blockBounds };
}

function isPointClear(x, z, obs, margin = 0.55, plotMargin = 0.14) {
  const { pondWaterCircle, solidBoxes, solidCircles, plotBoxes } = obs;
  if (Math.hypot(x - pondWaterCircle.x, z - pondWaterCircle.z) < pondWaterCircle.r + margin) return false;
  for (const c of solidCircles) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + margin * 0.65) return false;
  }
  for (const b of solidBoxes) {
    if (signedBoxGap(x, z, b).dist < margin) return false;
  }
  for (const p of plotBoxes) {
    if (x > p.xMin - plotMargin && x < p.xMax + plotMargin && z > p.zMin - plotMargin && z < p.zMax + plotMargin) return false;
  }
  return true;
}

function relaxPathPoints(rawPoints, obs, opts = {}) {
  const { keepEnds = false, plotMargin = 0.18, blockerMargin = 0.65, maxSeg = 2.8 } = opts;
  const pts = [];
  for (let i = 0; i < rawPoints.length; i++) {
    const a = rawPoints[i];
    pts.push([a[0], a[1]]);
    if (i < rawPoints.length - 1) {
      const b = rawPoints[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > maxSeg) {
        const sub = Math.ceil(len / maxSeg);
        for (let s = 1; s < sub; s++) {
          const u = s / sub;
          pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
        }
      }
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < pts.length; i++) {
      if (keepEnds && (i === 0 || i === pts.length - 1)) continue;
      let x = pts[i][0];
      let z = pts[i][1];

      const pd = Math.hypot(x - obs.pondWaterCircle.x, z - obs.pondWaterCircle.z);
      const pTarget = obs.pondWaterCircle.r + 0.85;
      if (pd < pTarget) {
        const ang = Math.atan2(z - obs.pondWaterCircle.z, x - obs.pondWaterCircle.x);
        x = obs.pondWaterCircle.x + Math.cos(ang) * pTarget;
        z = obs.pondWaterCircle.z + Math.sin(ang) * pTarget;
      }

      for (const b of obs.solidBoxes) {
        const g = signedBoxGap(x, z, b);
        if (g.dist < blockerMargin) {
          const push = blockerMargin - g.dist + 0.04;
          x += g.nx * push;
          z += g.nz * push;
        }
      }

      for (const c of obs.solidCircles) {
        const cd = Math.hypot(x - c.x, z - c.z);
        if (cd < c.r + 0.45) {
          const push = c.r + 0.48 - cd;
          const ang = Math.atan2(z - c.z, x - c.x);
          x += Math.cos(ang) * push;
          z += Math.sin(ang) * push;
        }
      }

      for (const p of obs.plotBoxes) {
        const pushed = pushOutsideAABB(x, z, p, plotMargin);
        if (pushed) {
          x = pushed[0];
          z = pushed[1];
        }
      }

      pts[i][0] = x;
      pts[i][1] = z;
    }
  }
  return pts;
}

/** Snap branch start points that join the village main road onto its Chaikin centerline. */
function snapStartPointToRoad(pts, smoothedRoad, roadWidth) {
  if (!pts || pts.length < 2 || !smoothedRoad || smoothedRoad.length < 2) return pts;
  const hit = nearestOnPolyline(smoothedRoad, pts[0][0], pts[0][1]);
  if (hit.dist > 14) return pts;
  const dx = pts[1][0] - hit.x;
  const dz = pts[1][1] - hit.z;
  const len = Math.hypot(dx, dz) || 1;
  const off = Math.min(len * 0.45, (roadWidth || 3.6) * 0.30);
  const out = pts.map(p => [p[0], p[1]]);
  out[0] = [hit.x + (dx / len) * off, hit.z + (dz / len) * off];
  return out;
}

function buildDynamicSpurToTarget(id, anchorX, anchorZ, approachOffsets, existingPaths, obs, width) {
  if (!Number.isFinite(anchorX) || !Number.isFinite(anchorZ)) return null;
  let start = null;
  for (const [ox, oz] of approachOffsets) {
    const cx = anchorX + ox;
    const cz = anchorZ + oz;
    if (isPointClear(cx, cz, obs, 0.35)) {
      start = [cx, cz];
      break;
    }
  }
  if (!start) start = [anchorX + approachOffsets[0][0], anchorZ + approachOffsets[0][1]];

  const hit = nearestOnPathSet(existingPaths, start[0], start[1]);
  if (!hit || hit.dist > 45) return null;

  const end = [hit.x, hit.z];
  if (hit.dist < 1.2) return null;

  const mx = (start[0] + end[0]) * 0.5;
  const mz = (start[1] + end[1]) * 0.5;
  const bendA = [start[0], end[1]];
  const bendB = [end[0], start[1]];
  let mid = [mx, mz];
  if (!isPointClear(mx, mz, obs, 0.35)) {
    if (isPointClear(bendA[0], bendA[1], obs, 0.35)) mid = bendA;
    else if (isPointClear(bendB[0], bendB[1], obs, 0.35)) mid = bendB;
  }

  const pts = relaxPathPoints([start, mid, end], obs, { keepEnds: true, plotMargin: 0.25, blockerMargin: 0.55 });
  return { id, tier: 2, width, points: pts, dynamic: true };
}

/** March seam endpoints outward until hitting a Tier 1/2 artery or clear field margin. */
function extendSeamEndpoint(x, z, ux, uz, tier12Paths, obs, maxReach = 6.2) {
  let bestX = x + ux * 0.6;
  let bestZ = z + uz * 0.6;
  for (let d = 0.25; d <= maxReach; d += 0.25) {
    const tx = x + ux * d;
    const tz = z + uz * d;
    if (Math.hypot(tx - obs.pondWaterCircle.x, tz - obs.pondWaterCircle.z) < obs.pondWaterCircle.r + 0.35) {
      break;
    }
    let blocked = false;
    for (const p of obs.plotBoxes) {
      if (tx > p.xMin - 0.14 && tx < p.xMax + 0.14 && tz > p.zMin - 0.14 && tz < p.zMax + 0.14) {
        blocked = true;
        break;
      }
    }
    if (blocked) break;
    for (const b of obs.solidBoxes) {
      if (signedBoxGap(tx, tz, b).dist < 0.45) {
        blocked = true;
        break;
      }
    }
    if (blocked) break;

    bestX = tx;
    bestZ = tz;
    const hit = nearestOnPathSet(tier12Paths, tx, tz);
    if (hit && hit.dist <= 0.45 && d >= 0.4) {
      return [hit.x, hit.z];
    }
  }
  return [bestX, bestZ];
}

function overlapsExistingPath(a, b, existingPaths, tol = 1.15) {
  const steps = 6;
  let closeCount = 0;
  for (let s = 1; s < steps; s++) {
    const u = s / steps;
    const x = a[0] + (b[0] - a[0]) * u;
    const z = a[1] + (b[1] - a[1]) * u;
    const hit = nearestOnPathSet(existingPaths, x, z);
    if (hit && hit.dist < tol) closeCount++;
  }
  return closeCount >= steps - 2;
}

/** Generate Tier 3 inter-plot footpaths across all 7 farmland blocks + mulberry margins. */
function buildTier3InterPlots(tier12Paths, obs) {
  const interPlots = [];
  const rills = [];

  for (const bound of obs.blockBounds) {
    const { bi, blk, xMin, xMax, zMin, zMax } = bound;
    const pw = blk.plot[0];
    const ph = blk.plot[1];
    const gap = blk.gap;
    if (gap < 0.85) continue;

    const clearHalf = Math.min(0.30, (gap - 0.52) * 0.5);

    // N-S internal seams between columns
    for (let c = 0; c < blk.cols - 1; c++) {
      const xSeam = blk.x + c * (pw + gap) + pw + gap * 0.5;
      const pSouth = extendSeamEndpoint(xSeam, zMax, 0, 1, tier12Paths, obs, 5.5);
      const pNorth = extendSeamEndpoint(xSeam, zMin, 0, -1, tier12Paths, obs, 5.5);
      if (overlapsExistingPath(pSouth, pNorth, tier12Paths, 1.0)) continue;

      const id = `inter-b${bi}-c${c}`;
      interPlots.push({
        id, tier: 3, blockIndex: bi, axis: 'qian',
        halfWidth: clearHalf, vergeWidth: Math.min(0.14, Math.max(0.08, (gap - 0.50) * 0.5 - clearHalf + 0.06)),
        points: [pSouth, [xSeam, (zMax + zMin) * 0.5], pNorth]
      });

      // Side irrigation rills along wet paddy columns
      for (let r = 0; r < blk.rows; r++) {
        const wetL = (bi + r + c) % 3 !== 0;
        const wetR = (bi + r + c + 1) % 3 !== 0;
        if (!wetL && !wetR) continue;
        const rSouth = blk.z - r * (ph + gap) - 0.35;
        const rNorth = rSouth - ph + 0.70;
        const xOff = wetL ? -0.46 : 0.46;
        rills.push([[xSeam + xOff, rSouth], [xSeam + xOff, rNorth]]);
      }
    }

    // E-W internal seams between rows
    for (let r = 0; r < blk.rows - 1; r++) {
      const zSeam = blk.z - r * (ph + gap) - ph - gap * 0.5;
      const pWest = extendSeamEndpoint(xMin, zSeam, -1, 0, tier12Paths, obs, 5.2);
      const pEast = extendSeamEndpoint(xMax, zSeam, 1, 0, tier12Paths, obs, 5.2);
      if (overlapsExistingPath(pWest, pEast, tier12Paths, 1.0)) continue;

      const id = `inter-b${bi}-r${r}`;
      interPlots.push({
        id, tier: 3, blockIndex: bi, axis: 'mo',
        halfWidth: clearHalf, vergeWidth: Math.min(0.14, Math.max(0.08, (gap - 0.50) * 0.5 - clearHalf + 0.06)),
        points: [pWest, [(xMin + xMax) * 0.5, zSeam], pEast]
      });

      for (let c = 0; c < blk.cols; c++) {
        const wetS = (bi + r + c) % 3 !== 0;
        const wetN = (bi + r + 1 + c) % 3 !== 0;
        if (!wetS && !wetN) continue;
        const cWest = blk.x + c * (pw + gap) + 0.35;
        const cEast = cWest + pw - 0.70;
        const zOff = wetS ? 0.46 : -0.46;
        rills.push([[cWest, zSeam + zOff], [cEast, zSeam + zOff]]);
      }
    }
  }

  // Additional field-margin & mulberry footpaths so >= 19 Tier 3 lanes link every terrace/mulberry edge
  const extraMargins = [
    { id: 'inter-b4-north-margin', blockIndex: 4, axis: 'mo', halfWidth: 0.31, points: [[48.0, -187.4], [58.8, -187.6], [69.5, -187.4]] },
    { id: 'inter-b3-south-margin', blockIndex: 3, axis: 'mo', halfWidth: 0.31, points: [[68.9, -92.6], [79.4, -92.4], [89.6, -92.2]] },
    { id: 'inter-mulberry-south-seam', blockIndex: 0, axis: 'qian', halfWidth: 0.30, points: [[15.8, -96.6], [15.8, -104.2], [15.8, -112.5]] },
    { id: 'inter-mulberry-north-seam', blockIndex: 4, axis: 'qian', halfWidth: 0.30, points: [[10.2, -146.2], [10.4, -154.0], [10.8, -162.5]] }
  ];
  for (const em of extraMargins) {
    const pts = relaxPathPoints(em.points, obs, { keepEnds: false, plotMargin: 0.25, blockerMargin: 0.65 });
    const mid = pts[Math.floor(pts.length / 2)];
    if (isPointClear(mid[0], mid[1], obs, 0.28) && !overlapsExistingPath(pts[0], pts[pts.length - 1], tier12Paths, 0.9)) {
      interPlots.push({
        id: em.id, tier: 3, blockIndex: em.blockIndex, axis: em.axis,
        halfWidth: em.halfWidth, vergeWidth: 0.13, points: pts
      });
    }
  }

  return { interPlots, rills };
}

/** Ensure no ribbon vertex protrudes into any crop bed interior; push outward and resample Y. */
function clampRibbonSinkOutsidePlots(sink, plotBoxes, field, lift) {
  const { pos, nor, col } = sink;
  const outPos = [];
  const outNor = [];
  const outCol = [];

  const triCount = Math.floor(pos.length / 9);
  const verts = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    let valid = true;
    for (let k = 0; k < 3; k++) {
      let x = pos[base + k * 3];
      let y = pos[base + k * 3 + 1];
      let z = pos[base + k * 3 + 2];
      if (![x, y, z].every(Number.isFinite)) { valid = false; break; }

      for (const p of plotBoxes) {
        const pushed = pushOutsideAABB(x, z, p, 0.04);
        if (pushed) {
          x = pushed[0];
          z = pushed[1];
          y = field.sample(x, z) + lift;
        }
      }
      verts[k][0] = x;
      verts[k][1] = y;
      verts[k][2] = z;
    }
    if (!valid) continue;

    const abx = verts[1][0] - verts[0][0], aby = verts[1][1] - verts[0][1], abz = verts[1][2] - verts[0][2];
    const acx = verts[2][0] - verts[0][0], acy = verts[2][1] - verts[0][1], acz = verts[2][2] - verts[0][2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const lenSq = nx * nx + ny * ny + nz * nz;
    if (lenSq < 1e-8) continue;

    const cBase = t * 9;
    let i1 = 1, i2 = 2;
    if (ny < 0) {
      nx = -nx; ny = -ny; nz = -nz;
      i1 = 2; i2 = 1;
    }
    const inv = 1 / Math.sqrt(lenSq);
    nx *= inv; ny *= inv; nz *= inv;
    if (ny < 0.25) continue;

    outPos.push(
      verts[0][0], verts[0][1], verts[0][2],
      verts[i1][0], verts[i1][1], verts[i1][2],
      verts[i2][0], verts[i2][1], verts[i2][2]
    );
    outNor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    outCol.push(
      col[cBase], col[cBase + 1], col[cBase + 2],
      col[cBase + i1 * 3], col[cBase + i1 * 3 + 1], col[cBase + i1 * 3 + 2],
      col[cBase + i2 * 3], col[cBase + i2 * 3 + 1], col[cBase + i2 * 3 + 2]
    );
  }
  return { pos: outPos, nor: outNor, col: outCol };
}

function clampPointOutsidePlots(x, z, plotBoxes, margin = 0.06) {
  let px = x;
  let pz = z;
  for (const p of plotBoxes) {
    const pushed = pushOutsideAABB(px, pz, p, margin);
    if (pushed) {
      px = pushed[0];
      pz = pushed[1];
    }
  }
  return [px, pz];
}

/** Add an octagonal compacted dirt crossroads apron onto the ground baker. */
function bakeJunctionApron(baker, x, z, radius, lift, colorHex, field, plotBoxes) {
  const cy = field.sample(x, z) + lift + 0.008;
  const ring = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const [rx, rz] = clampPointOutsidePlots(x + Math.cos(a) * radius, z + Math.sin(a) * radius, plotBoxes, 0.06);
    ring.push([rx, field.sample(rx, rz) + lift * 0.45, rz]);
  }
  for (let i = 0; i < 8; i++) {
    const p0 = ring[i];
    const p1 = ring[(i + 1) % 8];
    baker.addTri('ground', x, cy, z, p1[0], p1[1], p1[2], p0[0], p0[1], p0[2], colorHex, 0.01);
  }
}

/** Bake a narrow sunken-edge irrigation rill ribbon beside wet paddies. */
function bakeIrrigationRill(baker, a, b, field, pal, plotBoxes) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1.2) return;
  const nx = -dz / len;
  const nz = dx / len;
  const steps = Math.max(3, Math.ceil(len / 1.4));
  const hw = 0.12;
  for (let s = 0; s < steps; s++) {
    const u0 = s / steps;
    const u1 = (s + 1) / steps;
    const x0 = a[0] + dx * u0, z0 = a[1] + dz * u0;
    const x1 = a[0] + dx * u1, z1 = a[1] + dz * u1;
    const [l0x, l0z] = clampPointOutsidePlots(x0 + nx * hw, z0 + nz * hw, plotBoxes, 0.06);
    const [r0x, r0z] = clampPointOutsidePlots(x0 - nx * hw, z0 - nz * hw, plotBoxes, 0.06);
    const [l1x, l1z] = clampPointOutsidePlots(x1 + nx * hw, z1 + nz * hw, plotBoxes, 0.06);
    const [r1x, r1z] = clampPointOutsidePlots(x1 - nx * hw, z1 - nz * hw, plotBoxes, 0.06);
    const y0L = field.sample(l0x, l0z) + 0.014;
    const y0R = field.sample(r0x, r0z) + 0.014;
    const y1L = field.sample(l1x, l1z) + 0.014;
    const y1R = field.sample(r1x, r1z) + 0.014;
    baker.addQuad('ground', [r0x, y0R, r0z], [l0x, y0L, l0z], [l1x, y1L, l1z], [r1x, y1R, r1z], pal.rillBed);
  }
}

/** Place 18-24 stone & plank culverts across T-junctions and ditch crossings. */
function bakeCulverts(baker, interPlots, tier12Paths, obs, field, pal, rng) {
  const culverts = [];
  const plankBridges = [];
  const minSpacing = 4.6;

  function canPlace(x, z) {
    if (!isPointClear(x, z, obs, 0.28, 0.44)) return false;
    for (const c of culverts) {
      if (Math.hypot(x - c.x, z - c.z) < minSpacing) return false;
    }
    return true;
  }

  function addCulvert(x, z, tx, tz, kind) {
    const yaw = Math.atan2(tx, tz);
    const ux = -tz;
    const uz = tx;
    const y = field.sample(x, z);
    const isPlank = kind === 'plank';

    if (isPlank) {
      const length = 0.96;
      const width = 0.88;
      // 2 stone cheek sills under timber
      for (const sSide of [-0.36, 0.36]) {
        baker.addBox('solid', x + tx * sSide, y + 0.035, z + tz * sSide, width * 1.06, 0.08, 0.16, yaw, pal.culvertStone, pal.culvertStoneDark);
      }
      // 4 split-timber deck planks
      for (let pi = 0; pi < 4; pi++) {
        const off = (pi - 1.5) * 0.21;
        baker.addBox('solid', x + tx * off, y + 0.085, z + tz * off, width, 0.045, 0.18, yaw + (rng() - 0.5) * 0.03, pi % 2 === 0 ? pal.timber : pal.timberDark, pal.timberDark);
      }
      plankBridges.push({ x, z, tx, tz, ux, uz, length: length + 0.18, width: width + 0.18 });
    } else {
      // Bluestone slab bridge over roadside drainage groove
      for (const sSide of [-0.32, 0.32]) {
        baker.addBox('solid', x + tx * sSide, y + 0.032, z + tz * sSide, 0.92, 0.07, 0.18, yaw, pal.culvertStoneDark, pal.moss);
      }
      baker.addBox('solid', x, y + 0.082, z, 0.88, 0.055, 0.72, yaw, pal.culvertStone, pal.culvertStoneDark);
    }

    culverts.push({ x, z, yaw, kind });
  }

  // Primary culvert sites: T-junction ends of Tier 3 inter-plot lanes meeting arteries/spurs
  for (let i = 0; i < interPlots.length && culverts.length < 22; i++) {
    const ip = interPlots[i];
    const pts = ip.points;
    for (const endIdx of [0, pts.length - 1]) {
      if (culverts.length >= 22) break;
      const ep = pts[endIdx];
      const adj = pts[endIdx === 0 ? 1 : pts.length - 2];
      const dx = adj[0] - ep[0];
      const dz = adj[1] - ep[1];
      const len = Math.hypot(dx, dz) || 1;
      const tx = dx / len;
      const tz = dz / len;
      const cx = ep[0] + tx * 0.85;
      const cz = ep[1] + tz * 0.85;
      if (!canPlace(cx, cz)) continue;
      const kind = culverts.filter(c => c.kind === 'plank').length < 8 && (i % 2 === 1) ? 'plank' : 'stone';
      addCulvert(cx, cz, tx, tz, kind);
    }
  }

  // Additional plank/stone culverts along midpoints of Tier 2 spurs & scenic crossings so >= 18 culverts, >= 6 plankBridges
  for (let i = 0; i < tier12Paths.length && (culverts.length < 20 || plankBridges.length < 7); i++) {
    const p = tier12Paths[i];
    if (p.tier !== 2) continue;
    const mid = polylineMidpoint(p.points);
    if (!canPlace(mid.x, mid.z)) continue;
    const kind = plankBridges.length < 7 ? 'plank' : 'stone';
    addCulvert(mid.x, mid.z, mid.tx, mid.tz, kind);
  }

  return { culverts, plankBridges };
}

/** Place mossy boundary marker stones tucked onto shoulders off the tread centerline. */
function bakeBoundaryStones(baker, arteries, obs, field, pal, rng) {
  const stones = [];
  const crossNodes = [];
  for (let i = 0; i < arteries.length; i++) {
    if (arteries[i].axis !== 'qian') continue;
    for (let j = 0; j < arteries.length; j++) {
      if (arteries[j].axis !== 'mo') continue;
      for (const qp of arteries[i].points) {
        const hit = nearestOnPolyline(arteries[j].points, qp[0], qp[1]);
        if (hit.dist < 1.2) {
          crossNodes.push({ x: (qp[0] + hit.x) * 0.5, z: (qp[1] + hit.z) * 0.5 });
        }
      }
    }
  }

  for (const node of crossNodes) {
    if (stones.length >= 12) break;
    const ang = rng() * TAU;
    const sx = node.x + Math.cos(ang) * 1.15;
    const sz = node.z + Math.sin(ang) * 1.15;
    if (!isPointClear(sx, sz, obs, 0.28, 0.28)) continue;
    if (stones.some(s => Math.hypot(s.x - sx, s.z - sz) < 5.5)) continue;
    const y = field.sample(sx, sz);
    const h = 0.34 + rng() * 0.16;
    const yaw = rng() * TAU;
    baker.addTiltedBox('solid', sx, y + h * 0.42, sz, 0.26, h, 0.22, (rng() - 0.5) * 0.08, yaw, (rng() - 0.5) * 0.08, pal.culvertStone, pal.moss);
    baker.addBox('solid', sx + 0.11, y + 0.09, sz - 0.08, 0.18, 0.16, 0.16, yaw + 0.5, pal.moss, pal.culvertStoneDark);
    stones.push({ x: sx, z: sz });
  }
  return stones;
}

/** Place golden harvest straw sheaves & bamboo baskets beside field headlands clear of treads/plots. */
function bakeStrawSheaves(baker, allPaths, obs, field, pal, rng) {
  const sheaves = [];
  const candidates = [];
  for (const bound of obs.blockBounds) {
    candidates.push([bound.xMin - 1.15, bound.zMax + 1.05]);
    candidates.push([bound.xMax + 1.15, bound.zMin - 1.05]);
  }
  for (const [cx, cz] of candidates) {
    if (sheaves.length >= 8) break;
    if (!isPointClear(cx, cz, obs, 0.35, 0.42)) continue;
    const hit = nearestOnPathSet(allPaths, cx, cz);
    if (hit && hit.dist < 0.85) continue;
    if (sheaves.some(s => Math.hypot(s.x - cx, s.z - cz) < 8.0)) continue;
    const y = field.sample(cx, cz);
    const yaw = rng() * TAU;
    // Two waist-cinched golden harvest sheaves (flared skirt + hemp waist band + nodding ear crown) + rimmed bamboo basket
    for (const [ox, oz, sc, aOff, cA, cB] of [
      [0, 0, 1.0, 0, pal.strawGold, pal.strawDark],
      [0.32, 0.18, 0.85, 0.9, pal.strawDark, pal.strawGold]
    ]) {
      const sx = cx + ox, sz = cz + oz, sy = field.sample(sx, sz);
      baker.addCylinder('solid', sx, sy + 0.15 * sc, sz, 0.11 * sc, 0.22 * sc, 0.30 * sc, 7, yaw + aOff, cA, cB);
      baker.addCylinder('solid', sx, sy + 0.30 * sc, sz, 0.125 * sc, 0.125 * sc, 0.055 * sc, 7, yaw + aOff, pal.timber || '#72583B', pal.timber || '#5E462E');
      baker.addCylinder('solid', sx, sy + 0.43 * sc, sz, 0.21 * sc, 0.11 * sc, 0.22 * sc, 7, yaw + aOff, cB, cA);
      baker.addCone('solid', sx, sy + 0.59 * sc, sz, 0.20 * sc, 0.12 * sc, 7, yaw + aOff, cA, cB);
    }
    const bx = cx - 0.28, bz = cz + 0.24, by = field.sample(bx, bz);
    baker.addCylinder('solid', bx, by + 0.13, bz, 0.22, 0.15, 0.26, 8, yaw, pal.bamboo, pal.timber);
    baker.addCylinder('solid', bx, by + 0.258, bz, 0.245, 0.235, 0.032, 8, yaw, pal.timber || '#7B613E', pal.bamboo);
    baker.addCone('solid', bx, by + 0.305, bz, 0.195, 0.075, 8, yaw + 0.3, pal.strawGold, pal.strawDark);
    sheaves.push({ x: cx, z: cz });
  }
  return sheaves;
}

/** Push grass & flower instances down out of active compacted treads without changing mesh counts. */
function trimScatterAlongPaths(scatter, allPaths) {
  const grp = scatter?.group;
  if (!grp) return 0;
  let trimmed = 0;
  const mat = new THREE.Matrix4();
  const trimNames = new Set(['grass', 'grass-near', 'flower-stems', 'flower-heads', 'stones']);

  grp.traverse((obj) => {
    if (!obj.isInstancedMesh || !trimNames.has(obj.name)) return;
    let dirty = false;
    for (let i = 0; i < obj.count; i++) {
      obj.getMatrixAt(i, mat);
      const x = mat.elements[12];
      const y = mat.elements[13];
      const z = mat.elements[14];
      if (y < -4.0) continue;
      const hit = nearestOnPathSet(allPaths, x, z);
      if (hit && hit.dist < (hit.path.halfWidth || hit.path.width * 0.5 || 0.5) * 0.92) {
        mat.elements[13] = y - 5.0;
        obj.setMatrixAt(i, mat);
        dirty = true;
        trimmed++;
      }
    }
    if (dirty) obj.instanceMatrix.needsUpdate = true;
  });
  return trimmed;
}

/**
 * 构建桃源良田多级「阡陌交通 + 畦间小路」路网：
 * Tier 1 阡陌干道 + Tier 2 池畔桑园田头支径 + Tier 3 畦间小路与水渠，
 * 并与村落主路、耕屋、花林溪桥、水卷轴地图与生态发现完全耦合。
 */
export function createQianmoPaths(options = {}) {
  const cfg = { ...qianmoCfg, ...(options.config || {}) };
  const pal = cfg.palette || {};
  const field = options.field;
  const group = new THREE.Group();
  group.name = 'qianmo-paths';

  if (!cfg.enabled || !field) {
    return {
      group,
      groundMesh: null,
      solidMesh: null,
      blockers: [],
      targets: [],
      layout: { enabled: false, arteries: [], spurs: [], interPlots: [], culverts: [], boundaryStones: [], sheaves: [], plankBridges: [] },
      isOnWood: () => false,
      update() {},
      getStats: () => ({ enabled: false }),
      dispose() {}
    };
  }

  const obs = collectObstacles(options);
  const smoothedMainRoad = chaikinSmooth(obs.world?.village?.road?.points || [], 2);
  const mainRoadWidth = obs.world?.village?.road?.width || 3.6;

  // 1) Tier 1 阡陌干道 & Tier 2 支径
  const builtArteries = [];
  for (const aDef of cfg.arteries || []) {
    let pts = aDef.points.map(p => [p[0], p[1]]);
    if (aDef.snapStartToMainRoad) pts = snapStartPointToRoad(pts, smoothedMainRoad, mainRoadWidth);
    const keepEnds = Boolean(aDef.snapStartToMainRoad);
    pts = relaxPathPoints(pts, obs, { keepEnds, plotMargin: 0.22, blockerMargin: 0.65 });
    const halfWidth = aDef.id === 'qian-mid-north' ? 0.30 : (aDef.width || 1.4) * 0.5;
    builtArteries.push({
      id: aDef.id,
      tier: 1,
      axis: aDef.axis || 'mo',
      width: halfWidth * 2,
      halfWidth,
      vergeWidth: aDef.id === 'qian-mid-north' ? 0.14 : 0.24,
      smoothPasses: aDef.id === 'qian-mid-north' ? 1 : 2,
      points: pts
    });
  }

  const builtSpurs = [];
  for (const sDef of cfg.spurs || []) {
    let pts = sDef.points.map(p => [p[0], p[1]]);
    if (sDef.snapStartToMainRoad) pts = snapStartPointToRoad(pts, smoothedMainRoad, mainRoadWidth);
    pts = relaxPathPoints(pts, obs, { keepEnds: Boolean(sDef.snapStartToMainRoad), plotMargin: 0.22, blockerMargin: 0.65 });
    const halfWidth = (sDef.width || 1.04) * 0.5;
    builtSpurs.push({
      id: sDef.id,
      tier: 2,
      axis: 'spur',
      width: sDef.width || 1.04,
      halfWidth,
      vergeWidth: 0.20,
      smoothPasses: 2,
      points: pts
    });
  }

  // Dynamic spurs to qinHanHomestead fieldHut and leisureGrove bridge
  const hut = options.qinHanHomestead?.layout?.fieldHut;
  if (hut && Number.isFinite(hut.x) && Number.isFinite(hut.z)) {
    const fOffsets = Array.isArray(hut.farmerPos) ? [[hut.farmerPos[0] - hut.x, hut.farmerPos[2] - hut.z]] : [];
    const dynHut = buildDynamicSpurToTarget(
      'spur-field-hut', hut.x, hut.z,
      [...fOffsets, [0, 2.8], [2.8, 0], [0, -2.8], [-2.8, 0]],
      [...builtArteries, ...builtSpurs], obs, 1.02
    );
    if (dynHut) builtSpurs.push({ ...dynHut, halfWidth: 0.51, vergeWidth: 0.18, smoothPasses: 2 });
  }

  const groveBridge = options.leisureGrove?.layout?.bridge;
  if (groveBridge && Number.isFinite(groveBridge.x) && Number.isFinite(groveBridge.z)) {
    const halfLen = (groveBridge.length || 3.4) * 0.5 + 0.65;
    const tx = groveBridge.tx ?? 1;
    const tz = groveBridge.tz ?? 0;
    const rawEnds = groveBridge.ends || [
      [groveBridge.x + tx * halfLen, groveBridge.z + tz * halfLen],
      [groveBridge.x - tx * halfLen, groveBridge.z - tz * halfLen]
    ];
    const ends = rawEnds
      .map(e => (Array.isArray(e) ? [e[0], e[1]] : [e?.x, e?.z]))
      .filter(e => Number.isFinite(e[0]) && Number.isFinite(e[1]));
    let bestEnd = ends[0];
    let bestDist = Infinity;
    for (const e of ends) {
      const hit = nearestOnPathSet([...builtArteries, ...builtSpurs], e[0], e[1]);
      if (hit && hit.dist < bestDist) {
        bestDist = hit.dist;
        bestEnd = e;
      }
    }
    if (bestEnd) {
      const dynBridge = buildDynamicSpurToTarget(
        'spur-grove-bridge', bestEnd[0], bestEnd[1],
        [[0, 0], [tx * 0.4, tz * 0.4], [-tx * 0.4, -tz * 0.4]],
        [...builtArteries, ...builtSpurs], obs, 1.00
      );
      if (dynBridge) builtSpurs.push({ ...dynBridge, halfWidth: 0.50, vergeWidth: 0.18, smoothPasses: 2 });
    }
  }

  const tier12Paths = [...builtArteries, ...builtSpurs];
  const { interPlots, rills } = buildTier3InterPlots(tier12Paths, obs);
  const allPaths = [...tier12Paths, ...interPlots];

  // 2) Bake Ground Mesh (ribbons + junction aprons + irrigation rills)
  const rng = makeRng(cfg.seed, 'qianmo');
  const pathField = {
    sample: (x, z) => field.sample(x, z),
    slope: (x, z) => field.slope(x, z),
    colorAt: typeof options.colorAt === 'function' ? options.colorAt : (typeof options.terrain?.colorAt === 'function' ? options.terrain.colorAt : null)
  };
  const ribbonSink = { pos: [], nor: [], col: [] };

  for (const a of builtArteries) {
    const isQian = a.axis === 'qian';
    buildNaturalRoadRibbon(a.points, {
      field: pathField,
      halfWidth: a.halfWidth,
      lift: 0.017,
      sampleStep: 0.72,
      smoothPasses: a.smoothPasses,
      roadColor: isQian ? pal.qianRoad : pal.moRoad,
      vergeColor: isQian ? pal.qianVerge : pal.moVerge,
      camber: 0.016,
      vergeWidth: a.vergeWidth,
      rutDepth: 0.005,
      startFlare: 0.24,
      endFlare: 0.18,
      flareDist: 1.5,
      endFlareDist: 1.3,
      scatterPebbles: false,
      rand: rng,
      sink: ribbonSink
    });
  }

  for (const sp of builtSpurs) {
    buildNaturalRoadRibbon(sp.points, {
      field: pathField,
      halfWidth: sp.halfWidth,
      lift: 0.015,
      sampleStep: 0.72,
      smoothPasses: sp.smoothPasses || 2,
      roadColor: pal.spurRoad || '#B29D76',
      vergeColor: pal.spurVerge || '#78924F',
      camber: 0.012,
      vergeWidth: sp.vergeWidth || 0.20,
      rutDepth: 0.003,
      startFlare: 0.20,
      endFlare: 0.18,
      flareDist: 1.2,
      endFlareDist: 1.2,
      scatterPebbles: false,
      rand: rng,
      sink: ribbonSink
    });
  }

  for (const ip of interPlots) {
    buildNaturalRoadRibbon(ip.points, {
      field: pathField,
      halfWidth: ip.halfWidth,
      lift: 0.014,
      sampleStep: 0.85,
      smoothPasses: 1,
      roadColor: pal.interPlotRoad || '#A7926B',
      vergeColor: pal.interPlotVerge || '#738B4C',
      camber: 0.009,
      vergeWidth: ip.vergeWidth,
      rutDepth: 0.002,
      startFlare: 0.14,
      endFlare: 0.14,
      flareDist: 0.9,
      endFlareDist: 0.9,
      scatterPebbles: false,
      rand: rng,
      sink: ribbonSink
    });
  }

  const clampedGround = clampRibbonSinkOutsidePlots(ribbonSink, obs.plotBoxes, field, 0.014);
  const baker = createVertexColorBaker();

  // Crossroads compacted junction aprons
  const apronNodes = new Set();
  for (const a of builtArteries) {
    if (a.axis !== 'qian') continue;
    for (const b of builtArteries) {
      if (b.axis !== 'mo') continue;
      for (const qp of a.points) {
        const hit = nearestOnPolyline(b.points, qp[0], qp[1]);
        if (hit.dist < 1.1) {
          const jx = (qp[0] + hit.x) * 0.5;
          const jz = (qp[1] + hit.z) * 0.5;
          const key = `${Math.round(jx)}:${Math.round(jz)}`;
          if (!apronNodes.has(key) && isPointClear(jx, jz, obs, 0.25, 0.45)) {
            apronNodes.add(key);
            bakeJunctionApron(baker, jx, jz, 1.05, 0.019, pal.qianRoad || '#C1AD86', field, obs.plotBoxes);
          }
        }
      }
    }
  }

  for (const [ra, rb] of rills) {
    bakeIrrigationRill(baker, ra, rb, field, pal, obs.plotBoxes);
  }

  // 3) Bake Solid Mesh (culverts + boundary stones + straw sheaves)
  const { culverts, plankBridges } = bakeCulverts(baker, interPlots, tier12Paths, obs, field, pal, rng);
  const boundaryStones = bakeBoundaryStones(baker, builtArteries, obs, field, pal, rng);
  const sheaves = bakeStrawSheaves(baker, allPaths, obs, field, pal, rng);

  const groundMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -3
  });
  const solidMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true
  });

  const extraGroundMesh = baker.buildMesh('ground', groundMat, 'qianmo-paths-extra-ground');
  const posList = clampedGround.pos.slice();
  const norList = clampedGround.nor.slice();
  const colList = clampedGround.col.slice();
  if (extraGroundMesh) {
    const eg = extraGroundMesh.geometry;
    const ep = eg.attributes.position.array;
    const en = eg.attributes.normal.array;
    const ec = eg.attributes.color.array;
    for (let i = 0; i < ep.length; i++) {
      posList.push(ep[i]);
      norList.push(en[i]);
      colList.push(ec[i]);
    }
    eg.dispose();
  }

  let groundMesh = null;
  if (posList.length > 0) {
    const groundGeo = new THREE.BufferGeometry();
    groundGeo.setAttribute('position', new THREE.Float32BufferAttribute(posList, 3));
    groundGeo.setAttribute('normal', new THREE.Float32BufferAttribute(norList, 3));
    groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colList, 3));
    groundGeo.computeBoundingBox();
    groundGeo.computeBoundingSphere();
    groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.name = 'qianmo-paths-ground';
    groundMesh.castShadow = false;
    groundMesh.receiveShadow = true;
  } else {
    groundMat.dispose();
  }
  const solidMesh = baker.buildMesh('solid', solidMat, 'qianmo-paths-solid');
  if (groundMesh) group.add(groundMesh);
  if (solidMesh) group.add(solidMesh);

  // 4) Trim instanced grass/flowers along compacted center treads without altering counts
  const trimmedScatterCount = trimScatterAlongPaths(options.scatter, allPaths);

  // 5) Discovery target at the prime central 阡×陌 crossroads near (49.5, -116.8)
  const targetX = 49.5;
  const targetZ = -116.8;
  const targets = [
    { id: 'qianmo-lanes', x: targetX, y: field.sample(targetX, targetZ) + 0.65, z: targetZ, range: 9.5 }
  ];

  function isOnWood(px, pz) {
    if (!Number.isFinite(px) || !Number.isFinite(pz)) return false;
    for (const br of plankBridges) {
      const dx = px - br.x;
      const dz = pz - br.z;
      const along = Math.abs(dx * br.tx + dz * br.tz);
      const across = Math.abs(dx * br.ux + dz * br.uz);
      if (along <= br.length * 0.5 && across <= br.width * 0.5) return true;
    }
    return false;
  }

  const totalLengthMeters = Math.round(
    allPaths.reduce((acc, p) => acc + polylineLength(p.points), 0)
  );

  const layout = {
    enabled: true,
    arteries: builtArteries.map(a => ({ id: a.id, axis: a.axis, width: a.width, points: a.points })),
    spurs: builtSpurs.map(s => ({ id: s.id, width: s.width, points: s.points })),
    interPlots: interPlots.map(ip => ({ id: ip.id, blockIndex: ip.blockIndex, axis: ip.axis, width: ip.halfWidth * 2, points: ip.points })),
    culverts,
    plankBridges,
    boundaryStones,
    sheaves,
    rillsCount: rills.length,
    totalLengthMeters
  };

  function getStats() {
    const gTris = groundMesh?.geometry?.attributes?.position ? groundMesh.geometry.attributes.position.count / 3 : 0;
    const sTris = solidMesh?.geometry?.attributes?.position ? solidMesh.geometry.attributes.position.count / 3 : 0;
    return {
      enabled: true,
      arteries: builtArteries.length,
      spurs: builtSpurs.length,
      interPlots: interPlots.length,
      culverts: culverts.length,
      plankBridges: plankBridges.length,
      boundaryStones: boundaryStones.length,
      sheaves: sheaves.length,
      rills: rills.length,
      trimmedScatter: trimmedScatterCount,
      totalLengthMeters,
      groundTris: Math.round(gTris),
      solidTris: Math.round(sTris),
      totalTris: Math.round(gTris + sTris)
    };
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (groundMesh) {
      groundMesh.geometry?.dispose?.();
      groundMesh.material?.dispose?.();
    }
    if (solidMesh) {
      solidMesh.geometry?.dispose?.();
      solidMesh.material?.dispose?.();
    }
    group.removeFromParent?.();
  }

  return {
    group,
    groundMesh,
    solidMesh,
    blockers: [],
    targets,
    layout,
    isOnWood,
    update() {},
    getStats,
    dispose
  };
}
