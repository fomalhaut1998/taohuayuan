import * as THREE from 'three';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 把一个二十面体按顶点做径向扰动，得到一块「凿出来的石头」。
// 顶点按坐标哈希取同一个偏移量，否则非索引几何会在共边处裂开。
export function roughRockGeometry(seed, detail, amp) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const rnd = mulberry32(seed);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const cache = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = Math.round(v.x * 2048) + ':' + Math.round(v.y * 2048) + ':' + Math.round(v.z * 2048);
    let k = cache.get(key);
    if (k === undefined) {
      k = 1 + (rnd() - 0.5) * amp;
      cache.set(key, k);
    }
    pos.setXYZ(i, v.x * k, v.y * k * 0.86, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}
