import { getBlockerGrid } from './spatial-grid.js';

// Deliberately small CPU-only helpers: no timers, DOM, audio, persistence or AI.
export function livingStep(dt) {
  return Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;
}

export function awayVector(x, z, px, pz, fallbackYaw = 0) {
  const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
  return d > 1e-6 ? { x: dx / d, z: dz / d } : { x: Math.sin(fallbackYaw), z: Math.cos(fallbackYaw) };
}

function clipBlockerSegment(b, ax, az, bx, bz, margin) {
  const rBound = (b.hw || 0) + (b.hd || 0) + margin;
  if ((ax < b.x - rBound && bx < b.x - rBound) || (ax > b.x + rBound && bx > b.x + rBound) ||
      (az < b.z - rBound && bz < b.z - rBound) || (az > b.z + rBound && bz > b.z + rBound)) {
    return false;
  }
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const x = (ax - b.x) * c - (az - b.z) * s;
  const z = (ax - b.x) * s + (az - b.z) * c;
  const dx = (bx - ax) * c - (bz - az) * s;
  const dz = (bx - ax) * s + (bz - az) * c;
  let lo = 0, hi = 1;
  const hx = b.hw + margin;
  if (Math.abs(dx) < 1e-9) {
    if (Math.abs(x) > hx) return false;
  } else {
    const u = (-hx - x) / dx, v = (hx - x) / dx;
    lo = Math.max(lo, Math.min(u, v));
    hi = Math.min(hi, Math.max(u, v));
  }
  const hz = b.hd + margin;
  if (Math.abs(dz) < 1e-9) {
    if (Math.abs(z) > hz) return false;
  } else {
    const u = (-hz - z) / dz, v = (hz - z) / dz;
    lo = Math.max(lo, Math.min(u, v));
    hi = Math.min(hi, Math.max(u, v));
  }
  return lo <= hi;
}

// OBB segment clipping, not per-frame path sampling. Tangency counts as blocked.
export function sightClear(ax, az, bx, bz, blockers = [], margin = 0.08) {
  if (![ax, az, bx, bz].every(Number.isFinite)) return false;
  if (blockers.length >= 24) {
    const grid = getBlockerGrid(blockers, 8, Math.max(2.0, margin));
    if (grid) {
      const hit = grid.testSegment(ax, az, bx, bz, margin, clipBlockerSegment);
      if (hit !== null) return !hit;
    }
  }
  for (let i = 0; i < blockers.length; i++) {
    if (clipBlockerSegment(blockers[i], ax, az, bx, bz, margin)) return false;
  }
  return true;
}

export function habitatAllows(kind, x, z, context = {}, field) {
  if (![x, z].every(Number.isFinite)) return false;
  const p = context.pond;
  const pond = p && Math.hypot(x - p.x, z - p.z) < p.radius + 0.3;
  const river = typeof context.distanceToRiver === 'function' && context.distanceToRiver(x, z) < (context.riverHalfWidth || 0) + 0.3;
  if (kind === 'duck') {
    // Existing ducks live on pond banks too; retain that home microhabitat.
    return !p || Math.hypot(x - p.x, z - p.z) <= p.radius + 3;
  }
  if (pond || river) return false;
  return !Number.isFinite(context.waterLevel) || !field || field.sample(x, z) >= context.waterLevel + 0.05;
}

export function safeSegment(kind, ax, az, bx, bz, context = {}, field) {
  if (!sightClear(ax, az, bx, bz, context.blockers || [], 0.22)) return false;
  const distance = Math.hypot(bx - ax, bz - az);
  // Never accept an unbounded/NaN path or tunnel across a narrow shore.
  if (!Number.isFinite(distance) || distance > 26) return false;
  const steps = Math.max(1, Math.ceil(distance / 0.3));
  for (let j = 0; j <= steps; j++) {
    if (!habitatAllows(kind, ax + (bx - ax) * j / steps, az + (bz - az) * j / steps, context, field)) return false;
  }
  return true;
}

export function createEncounter() {
  return { armed: true, dwell: 0, outside: 0, count: 0 };
}

// One event per approach: standing nearby does not continually re-trigger it.
export function encounterEvent(state, distance, visible, step, cfg = {}) {
  if (!Number.isFinite(step) || step <= 0) return false;
  const range = cfg.range ?? 4;
  if (distance > (cfg.exitRange ?? range + 2)) {
    state.outside += step; state.dwell = 0;
    if (state.outside >= (cfg.rearm ?? 1)) state.armed = true;
  } else {
    state.outside = 0;
    if (state.armed && visible && distance < range) {
      state.dwell += step;
      if (state.dwell >= (cfg.dwell ?? 0.4)) {
        state.armed = false; state.dwell = 0; state.count++;
        return true;
      }
    } else state.dwell = 0;
  }
  return false;
}

const _profileOut = { rear: 0, front: 0, radius: 0.3, mass: 1 };
const _gapOut = { dist: 0, minDist: 0, gap: 0, overlap: 0, nx: 0, nz: 1, s: 0, t: 0 };
const _steerOut = { x: 0, z: 0, weight: 0, tx: 0, tz: 0 };

// Oriented XZ capsule footprints matching actual sculpted mesh extents (+Z = forward).
export function capsuleProfile(kind, scale, out = _profileOut) {
  if (kind === 'ox') {
    const k = (scale || 1.3) / 1.3;
    out.rear = -0.44 * k; out.front = 0.90 * k; out.radius = 0.46 * k; out.mass = 12;
  } else if (kind === 'buffalo') {
    const k = scale || 1;
    out.rear = -0.36 * k; out.front = 0.54 * k; out.radius = 0.45 * k; out.mass = 12;
  } else if (kind === 'dog') {
    const k = scale || 1;
    out.rear = -0.14 * k; out.front = 0.26 * k; out.radius = 0.25 * k; out.mass = 1.8;
  } else if (kind === 'henBrood') {
    const k = scale || 1;
    out.rear = -0.36 * k; out.front = 0.08 * k; out.radius = 0.36 * k; out.mass = 1.4;
  } else if (kind === 'chicken') {
    const k = (scale || 0.78) / 0.78;
    out.rear = -0.04 * k; out.front = 0.06 * k; out.radius = 0.24 * k; out.mass = 1.0;
  } else if (kind === 'duck') {
    const k = (scale || 0.80) / 0.80;
    out.rear = -0.04 * k; out.front = 0.07 * k; out.radius = 0.26 * k; out.mass = 1.0;
  } else if (kind === 'bird') {
    const k = (scale || 0.62) / 0.62;
    out.rear = 0; out.front = 0; out.radius = 0.18 * k; out.mass = 0.22;
  } else {
    const k = scale || 1;
    out.rear = 0; out.front = 0; out.radius = 0.30 * k; out.mass = 3.2;
  }
  return out;
}

// Exact closest-point distance & outward unit normal (from B toward A) between two XZ capsules.
export function capsuleGap(
  ax, az, ayaw, aRear, aFront, aRadius,
  bx, bz, byaw, bRear, bFront, bRadius,
  out = _gapOut
) {
  const asx = Math.sin(ayaw || 0), asz = Math.cos(ayaw || 0);
  const bsx = Math.sin(byaw || 0), bsz = Math.cos(byaw || 0);
  const a0x = ax + asx * aRear, a0z = az + asz * aRear;
  const a1x = ax + asx * aFront, a1z = az + asz * aFront;
  const b0x = bx + bsx * bRear, b0z = bz + bsz * bRear;
  const b1x = bx + bsx * bFront, b1z = bz + bsz * bFront;

  const ux = a1x - a0x, uz = a1z - a0z;
  const vx = b1x - b0x, vz = b1z - b0z;
  const wx = a0x - b0x, wz = a0z - b0z;
  const a = ux * ux + uz * uz;
  const b = ux * vx + uz * vz;
  const c = vx * vx + vz * vz;
  const d = ux * wx + uz * wz;
  const e = vx * wx + vz * wz;

  let s = 0, t = 0;
  if (a <= 1e-8 && c <= 1e-8) {
    s = 0; t = 0;
  } else if (a <= 1e-8) {
    s = 0;
    t = Math.max(0, Math.min(1, e / c));
  } else if (c <= 1e-8) {
    t = 0;
    s = Math.max(0, Math.min(1, -d / a));
  } else {
    const denom = a * c - b * b;
    s = denom > 1e-8 ? Math.max(0, Math.min(1, (b * e - c * d) / denom)) : 0;
    const tNom = b * s + e;
    if (tNom < 0) {
      t = 0;
      s = Math.max(0, Math.min(1, -d / a));
    } else if (tNom > c) {
      t = 1;
      s = Math.max(0, Math.min(1, (b - d) / a));
    } else {
      t = tNom / c;
    }
  }

  const px = a0x + ux * s, pz = a0z + uz * s;
  const qx = b0x + vx * t, qz = b0z + vz * t;
  const dx = px - qx, dz = pz - qz;
  const dist = Math.hypot(dx, dz);
  let nx, nz;
  if (dist > 1e-6) {
    nx = dx / dist;
    nz = dz / dist;
  } else if (c > 0.01) {
    // Spines touch/cross: push laterally perpendicular to B's body axis for shortest exit.
    const perpX = bsz, perpZ = -bsx;
    const side = (ax - bx) * perpX + (az - bz) * perpZ;
    nx = side >= 0 ? perpX : -perpX;
    nz = side >= 0 ? perpZ : -perpZ;
  } else {
    const cdx = ax - bx, cdz = az - bz, cd = Math.hypot(cdx, cdz);
    if (cd > 1e-6) { nx = cdx / cd; nz = cdz / cd; }
    else { nx = bsz; nz = -bsx; }
  }

  const minDist = aRadius + bRadius;
  out.dist = dist;
  out.minDist = minDist;
  out.gap = dist - minDist;
  out.overlap = minDist > dist ? minDist - dist : 0;
  out.nx = nx;
  out.nz = nz;
  out.s = s;
  out.t = t;
  return out;
}

export function pointClearOfBlockers(x, z, blockers = [], margin = 0.10) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (blockers.length >= 24) {
    const grid = getBlockerGrid(blockers, 8, Math.max(2.5, margin));
    if (grid) {
      const count = grid.collectPoint(x, z, margin);
      if (count >= 0) {
        const buf = grid.buf;
        for (let i = 0; i < count; i++) {
          const b = blockers[buf[i]];
          const rBound = (b.hw || 0) + (b.hd || 0) + margin;
          const dx = x - b.x, dz = z - b.z;
          if (Math.abs(dx) > rBound || Math.abs(dz) > rBound) continue;
          const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
          if (Math.abs(dx * c - dz * s) < b.hw + margin && Math.abs(dx * s + dz * c) < b.hd + margin) return false;
        }
        return true;
      }
    }
  }
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    const rBound = (b.hw || 0) + (b.hd || 0) + margin;
    const dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx) > rBound || Math.abs(dz) > rBound) continue;
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
    if (Math.abs(dx * c - dz * s) < b.hw + margin && Math.abs(dx * s + dz * c) < b.hd + margin) return false;
  }
  return true;
}

export function safeStep(kind, ax, az, nx, nz, context = {}, field, blockerMargin = 0.10) {
  if (!Number.isFinite(nx) || !Number.isFinite(nz)) return false;
  const blockers = context.blockers || [];
  if (!pointClearOfBlockers(nx, nz, blockers, blockerMargin)) return false;
  if (!sightClear(ax, az, nx, nz, blockers, 0.06)) return false;
  return habitatAllows(kind, nx, nz, context, field);
}

// Smooth tangential + outward steering vector when moving toward a capsule's comfort shell.
export function steerAroundCapsule(ux, uz, gapInfo, margin, tieSign = 1, out = _steerOut) {
  const gap = gapInfo.gap;
  const nx = gapInfo.nx, nz = gapInfo.nz;
  const approach = ux * nx + uz * nz;
  if (gap >= margin || (gap > 0.04 && approach >= 0.12)) {
    out.x = 0; out.z = 0; out.weight = 0; out.tx = 0; out.tz = 0;
    return out;
  }
  const u = Math.min(1, Math.max(0, (margin - gap) / Math.max(0.05, margin)));
  const w = u * (2 - u);
  const tLx = -nz, tLz = nx;
  const tRx = nz, tRz = -nx;
  const dL = ux * tLx + uz * tLz;
  const dR = ux * tRx + uz * tRz;
  const pickLeft = Math.abs(dL - dR) > 0.06 ? dL > dR : tieSign >= 0;
  const tx = pickLeft ? tLx : tRx;
  const tz = pickLeft ? tLz : tRz;
  const outPush = gap < 0.08 ? 0.62 : 0.28 * u;
  let sx = tx * 0.88 + nx * outPush;
  let sz = tz * 0.88 + nz * outPush;
  const sl = Math.hypot(sx, sz) || 1;
  out.x = (sx / sl) * w;
  out.z = (sz / sl) * w;
  out.weight = w;
  out.tx = tx;
  out.tz = tz;
  return out;
}
