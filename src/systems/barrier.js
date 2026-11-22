// 盒式碰撞：把玩家从墙里推出来。世界 → 局部用 THREE 的 Y 旋转约定，
// 与渲染时的 rotation.y 完全一致，所以碰撞体可以和模型共用一套参数。
import { createBlockerGrid } from './spatial-grid.js';

export function isJumpableBlocker(b) {
  if (!b || !Number.isFinite(b.maxY)) return false;
  if (b.source === 'act3-cave-seal' || b.source === 'plowing-ox' || b.source === 'cave-passage-wall') return false;
  if (Number.isFinite(b.minY) && (b.maxY - b.minY) > 1.55) return false;
  return true;
}

export function createBarrier(list) {
  const n = list.length;
  const grid = n >= 24 ? createBlockerGrid(list, 8, 2.5) : null;

  function canClearBlocker(b, state) {
    if (!state || !Number.isFinite(state.y)) return false;
    if (!state.airborne && !state.onObstacle) return false;
    if (!isJumpableBlocker(b)) return false;
    const clearance = state.airborne ? 0.14 : 0.05;
    return state.y >= b.maxY - clearance;
  }

  function pushBox(b, state, radius) {
    if (canClearBlocker(b, state)) return false;

    const dx = state.x - b.x;
    const dz = state.z - b.z;
    const reach = b.hw + b.hd + radius;
    if (dx * dx + dz * dz > reach * reach) return false;

    const ca = Math.cos(b.rot);
    const sa = Math.sin(b.rot);
    let lx = dx * ca - dz * sa;
    let lz = dx * sa + dz * ca;

    const px = b.hw + radius - Math.abs(lx);
    const pz = b.hd + radius - Math.abs(lz);
    if (px <= 0 || pz <= 0) return false;

    if (px < pz) lx += lx >= 0 ? px : -px;
    else lz += lz >= 0 ? pz : -pz;

    state.x = b.x + lx * ca + lz * sa;
    state.z = b.z + (-lx * sa + lz * ca);
    // 起跳上升擦碰低障时保留较多前冲动量，便于贴篱起跳顺滑越过
    const damp = (state.airborne && (state.vy || 0) > 0 && isJumpableBlocker(b)) ? 0.68 : 0.3;
    state.vx *= damp;
    state.vz *= damp;
    return true;
  }

  function resolve(state, radius) {
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      let anchorX = state.x;
      let anchorZ = state.z;
      let count = grid ? grid.collectPoint(anchorX, anchorZ, radius + 0.8) : -1;
      if (count >= 0) {
        const buf = grid.buf;
        let k = 0;
        while (k < count) {
          const idx = buf[k++];
          if (pushBox(list[idx], state, radius)) {
            moved = true;
            if (Math.abs(state.x - anchorX) > 1.2 || Math.abs(state.z - anchorZ) > 1.2) {
              anchorX = state.x;
              anchorZ = state.z;
              const nextCount = grid.collectPoint(anchorX, anchorZ, radius + 0.8);
              if (nextCount < 0) {
                for (let i = idx + 1; i < n; i++) {
                  if (pushBox(list[i], state, radius)) moved = true;
                }
                break;
              }
              count = nextCount;
              k = 0;
              while (k < count && buf[k] <= idx) k++;
            }
          }
        }
      } else {
        for (let i = 0; i < n; i++) {
          if (pushBox(list[i], state, radius)) moved = true;
        }
      }
      if (!moved) break;
    }
  }

  return { count: n, resolve: resolve };
}
