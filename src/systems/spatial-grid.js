// 二维静态空间网格索引：为高频碰撞推离与视线遮挡查询提供常数级候选集，热路径零分配。

const CELL_OFFSET = 32768;
const CELL_STRIDE = 65536;

function cellKey(gx, gz) {
  return (gx + CELL_OFFSET) * CELL_STRIDE + (gz + CELL_OFFSET);
}

function isDynamicOrLarge(b) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) return true;
  if (!(b.hw > 0 && b.hd > 0)) return true;
  if (Math.abs(b.x) > 1000 || Math.abs(b.z) > 1000) return true;
  if (b.hw + b.hd > 20) return true;
  if (b.source === 'plowing-ox' || b.source === 'act3-cave-seal') return true;
  if (b.dynamic === true || '_baseHw' in b) return true;
  return false;
}

export function createBlockerGrid(list, cellSize = 8, maxPad = 2.5) {
  const builtLength = Array.isArray(list) ? list.length : 0;
  const cells = new Map();
  const dynamicIndices = [];
  const padBound = 1.42 * maxPad;

  for (let i = 0; i < builtLength; i++) {
    const b = list[i];
    if (isDynamicOrLarge(b)) {
      dynamicIndices.push(i);
      continue;
    }
    const rot = b.rot || 0;
    const ca = Math.abs(Math.cos(rot));
    const sa = Math.abs(Math.sin(rot));
    const extX = ca * b.hw + sa * b.hd + padBound;
    const extZ = sa * b.hw + ca * b.hd + padBound;
    const cx0 = Math.floor((b.x - extX) / cellSize);
    const cx1 = Math.floor((b.x + extX) / cellSize);
    const cz0 = Math.floor((b.z - extZ) / cellSize);
    const cz1 = Math.floor((b.z + extZ) / cellSize);
    for (let gx = cx0; gx <= cx1; gx++) {
      for (let gz = cz0; gz <= cz1; gz++) {
        const key = cellKey(gx, gz);
        let bucket = cells.get(key);
        if (!bucket) {
          bucket = [];
          cells.set(key, bucket);
        }
        bucket.push(i);
      }
    }
  }

  const stamps = new Uint32Array(builtLength);
  let stamp = 0;
  const buf = new Int32Array(Math.max(64, builtLength));

  function nextStamp() {
    stamp++;
    if (stamp >= 0xfffffff0) {
      stamps.fill(0);
      stamp = 1;
    }
    return stamp;
  }

  function sortBuf(count) {
    for (let i = 1; i < count; i++) {
      const v = buf[i];
      let j = i - 1;
      while (j >= 0 && buf[j] > v) {
        buf[j + 1] = buf[j];
        j--;
      }
      buf[j + 1] = v;
    }
  }

  function collectPoint(x, z, pad) {
    if (list.length !== builtLength || pad > maxPad || !Number.isFinite(x) || !Number.isFinite(z)) {
      return -1;
    }
    const st = nextStamp();
    let count = 0;
    const bucket = cells.get(cellKey(Math.floor(x / cellSize), Math.floor(z / cellSize)));
    if (bucket) {
      for (let i = 0; i < bucket.length; i++) {
        const idx = bucket[i];
        if (stamps[idx] !== st) {
          stamps[idx] = st;
          buf[count++] = idx;
        }
      }
    }
    for (let i = 0; i < dynamicIndices.length; i++) {
      const idx = dynamicIndices[i];
      if (stamps[idx] !== st) {
        stamps[idx] = st;
        buf[count++] = idx;
      }
    }
    if (count > 1) sortBuf(count);
    return count;
  }

  function testCell(gx, gz, st, ax, az, bx, bz, margin, hitFn) {
    const bucket = cells.get(cellKey(gx, gz));
    if (!bucket) return false;
    for (let i = 0; i < bucket.length; i++) {
      const idx = bucket[i];
      if (stamps[idx] === st) continue;
      stamps[idx] = st;
      if (hitFn(list[idx], ax, az, bx, bz, margin)) return true;
    }
    return false;
  }

  function testSegment(ax, az, bx, bz, margin, hitFn) {
    if (list.length !== builtLength || margin > maxPad) return null;
    const st = nextStamp();
    for (let i = 0; i < dynamicIndices.length; i++) {
      const idx = dynamicIndices[i];
      stamps[idx] = st;
      if (hitFn(list[idx], ax, az, bx, bz, margin)) return true;
    }
    const gx0 = Math.floor(ax / cellSize);
    const gz0 = Math.floor(az / cellSize);
    const gx1 = Math.floor(bx / cellSize);
    const gz1 = Math.floor(bz / cellSize);

    if (gx0 === gx1 && gz0 === gz1) {
      return testCell(gx0, gz0, st, ax, az, bx, bz, margin, hitFn);
    }

    if (Math.abs(gx1 - gx0) <= 2 && Math.abs(gz1 - gz0) <= 2) {
      const xMin = gx0 < gx1 ? gx0 : gx1;
      const xMax = gx0 > gx1 ? gx0 : gx1;
      const zMin = gz0 < gz1 ? gz0 : gz1;
      const zMax = gz0 > gz1 ? gz0 : gz1;
      for (let gx = xMin; gx <= xMax; gx++) {
        for (let gz = zMin; gz <= zMax; gz++) {
          if (testCell(gx, gz, st, ax, az, bx, bz, margin, hitFn)) return true;
        }
      }
      return false;
    }

    // Amanatides-Woo 2D grid traversal
    let gx = gx0;
    let gz = gz0;
    const dx = bx - ax;
    const dz = bz - az;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(cellSize / dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(cellSize / dz) : Infinity;
    let tMaxX = stepX > 0
      ? ((gx + 1) * cellSize - ax) / dx
      : stepX < 0 ? (gx * cellSize - ax) / dx : Infinity;
    let tMaxZ = stepZ > 0
      ? ((gz + 1) * cellSize - az) / dz
      : stepZ < 0 ? (gz * cellSize - az) / dz : Infinity;
    if (tMaxX < 0) tMaxX = 0;
    if (tMaxZ < 0) tMaxZ = 0;

    const maxSteps = Math.abs(gx1 - gx0) + Math.abs(gz1 - gz0) + 4;
    for (let s = 0; s < maxSteps; s++) {
      if (testCell(gx, gz, st, ax, az, bx, bz, margin, hitFn)) return true;
      if (gx === gx1 && gz === gz1) break;
      if (tMaxX < tMaxZ) {
        tMaxX += tDeltaX;
        gx += stepX;
      } else {
        tMaxZ += tDeltaZ;
        gz += stepZ;
      }
    }
    return testCell(gx1, gz1, st, ax, az, bx, bz, margin, hitFn);
  }

  return {
    builtLength,
    cellSize,
    maxPad,
    buf,
    collectPoint,
    testSegment,
    get dynamicCount() { return dynamicIndices.length; },
  };
}

const GRID_CACHE = new WeakMap();

export function getBlockerGrid(list, cellSize = 8, maxPad = 2.5) {
  if (!Array.isArray(list) || list.length < 24) return null;
  let grid = GRID_CACHE.get(list);
  if (!grid || grid.builtLength !== list.length || grid.cellSize !== cellSize || grid.maxPad < maxPad) {
    grid = createBlockerGrid(list, cellSize, maxPad);
    GRID_CACHE.set(list, grid);
  }
  return grid;
}
