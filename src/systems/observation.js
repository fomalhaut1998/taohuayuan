// 可见性使用角色视线和碰撞墙盒，地形以短间隔采样；这是近似判定而非逐像素遮挡。
export function sightBlocked(eye, target, blockers = [], field) {
  for (const b of blockers) {
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
    const x = (eye.x - b.x) * c - (eye.z - b.z) * s;
    const z = (eye.x - b.x) * s + (eye.z - b.z) * c;
    const dx = (target.x - eye.x) * c - (target.z - eye.z) * s;
    const dz = (target.x - eye.x) * s + (target.z - eye.z) * c;
    let lo = 0, hi = 1;
    for (const [v, d, half] of [[x, dx, b.hw], [z, dz, b.hd]]) {
      if (Math.abs(d) < 1e-9) { if (Math.abs(v) > half) { lo = 2; break; } }
      else { const a = (-half - v) / d, q = (half - v) / d; lo = Math.max(lo, Math.min(a, q)); hi = Math.min(hi, Math.max(a, q)); }
    }
    // 墙盒有高度时，仅线段实际穿过其垂直范围才遮挡；未标高度的岩壁保守处理。
    if (lo <= hi && lo < 0.98 && hi > 0.01) {
      const y0 = eye.y + (target.y - eye.y) * Math.max(lo, 0.01);
      const y1 = eye.y + (target.y - eye.y) * Math.min(hi, 0.98);
      const minY = b.minY === undefined ? -Infinity : b.minY;
      const maxY = b.maxY === undefined ? Infinity : b.maxY;
      if (Math.max(y0, y1) >= minY && Math.min(y0, y1) <= maxY) return true;
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
