import { getBlockerGrid } from './spatial-grid.js';

let _obsEyeY = 0;
let _obsTargetY = 0;

function hitBlocker3D(b, ax, az, bx, bz) {
  const rBound = (b.hw || 0) + (b.hd || 0);
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
  if (Math.abs(dx) < 1e-9) {
    if (Math.abs(x) > b.hw) return false;
  } else {
    const a0 = (-b.hw - x) / dx, q0 = (b.hw - x) / dx;
    lo = Math.max(lo, Math.min(a0, q0));
    hi = Math.min(hi, Math.max(a0, q0));
  }
  if (Math.abs(dz) < 1e-9) {
    if (Math.abs(z) > b.hd) return false;
  } else {
    const a1 = (-b.hd - z) / dz, q1 = (b.hd - z) / dz;
    lo = Math.max(lo, Math.min(a1, q1));
    hi = Math.min(hi, Math.max(a1, q1));
  }
  // 墙盒有高度时，仅线段实际穿过其垂直范围才遮挡；未标高度的岩壁保守处理。
  if (lo <= hi && lo < 0.98 && hi > 0.01) {
    const y0 = _obsEyeY + (_obsTargetY - _obsEyeY) * Math.max(lo, 0.01);
    const y1 = _obsEyeY + (_obsTargetY - _obsEyeY) * Math.min(hi, 0.98);
    const minY = b.minY === undefined ? -Infinity : b.minY;
    const maxY = b.maxY === undefined ? Infinity : b.maxY;
    if (Math.max(y0, y1) >= minY && Math.min(y0, y1) <= maxY) return true;
  }
  return false;
}

// 可见性使用角色视线和碰撞墙盒，地形以短间隔采样；这是近似判定而非逐像素遮挡。
export function sightBlocked(eye, target, blockers = [], field) {
  _obsEyeY = eye.y;
  _obsTargetY = target.y;
  let handled = false;
  if (blockers.length >= 24 && Number.isFinite(eye.x) && Number.isFinite(eye.z) && Number.isFinite(target.x) && Number.isFinite(target.z)) {
    const grid = getBlockerGrid(blockers, 8, 2.5);
    if (grid) {
      const hit = grid.testSegment(eye.x, eye.z, target.x, target.z, 0, hitBlocker3D);
      if (hit !== null) {
        if (hit) return true;
        handled = true;
      }
    }
  }
  if (!handled) {
    for (let i = 0; i < blockers.length; i++) {
      if (hitBlocker3D(blockers[i], eye.x, eye.z, target.x, target.z)) return true;
    }
  }
  if (!field || typeof field.sample !== 'function') return true; // Missing terrain is not evidence of clear sight.
  const steps = Math.ceil(Math.hypot(target.x - eye.x, target.z - eye.z) / 1.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const terrainY = field.sample(eye.x + (target.x - eye.x) * t, eye.z + (target.z - eye.z) * t);
    if (!Number.isFinite(terrainY) || terrainY > eye.y + (target.y - eye.y) * t + 0.15) return true;
  }
  return false;
}

// Node 可直接导入本模块（校验脚本不经过打包器），故白名单写在模块内，不 import world.json。
const ANIMAL_KINDS = new Set(['chicken', 'dog', 'bird', 'ox', 'duck']);

export function visibleAnimal(focus, eye, forward, range, blockers, field) {
  if (!focus || !ANIMAL_KINDS.has(focus.kind)) return null;
  if (!Number.isFinite(observationScore(eye, forward, focus, range, blockers, field))) return null;
  return { id: focus.kind, name: focus.name, score: -1 };
}

export function observationScore(eye, forward, target, range, blockers, field) {
  if (![eye, forward, target].every(p => p && [p.x, p.y, p.z].every(Number.isFinite)) || !Number.isFinite(range) || range <= 0) return Infinity;
  const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance > range || distance < 0.01) return Infinity;
  const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / distance;
  if (dot < 0.82 || sightBlocked(eye, target, blockers, field)) return Infinity;
  return distance / range + (1 - dot) * 2;
}
