import * as THREE from 'three';
import { foliageGeometry } from './model-geometry.js';

// 外围经营地，不改动主村模型。规划/碰撞/舆图共用下面这份确定的世界坐标布局。
// 先为旧房、田、路、村民活动和既有植物留足净空，再找连接路，最后在剩余地块种树。
const TAU = Math.PI * 2;
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
export function segmentDistance(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}
function lineDistance(x, z, points) {
  let d = Infinity;
  for (let i = 1; i < points.length; i++) d = Math.min(d, segmentDistance(x, z, points[i - 1], points[i]));
  return d;
}
function boxDistance(x, z, b) {
  const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - b.hw), Math.max(0, Math.abs(dx * s + dz * c) - b.hd));
}

export function createHinterlandReservations(world, village, props, cliff) {
  const boxes = [...(cliff.blockers || []), ...village.blockers];
  const circles = [];
  const corridors = [{ points: world.village.road.points, half: world.village.road.width / 2 }];
  for (const h of village.houseInfo) {
    // 院落及谈话、老人/儿童、雨天回家路径均不受新增物体干扰。
    circles.push({ x: h.x, z: h.z, r: Math.hypot(h.w / 2, h.d / 2) + 2 });
    circles.push({ x: h.doorX, z: h.doorZ, r: 6.5 });
    if (h.spur) corridors.push({ points: h.spur.pts, half: h.spur.half + 0.5 });
  }
  for (const b of world.village.fields.blocks) boxes.push({ x: b.x, z: b.z, rot: 0,
    hw: (b.cols * b.plot[0] + (b.cols - 1) * b.gap) / 2 + 0.8,
    hd: (b.rows * b.plot[1] + (b.rows - 1) * b.gap) / 2 + 0.8 });
  for (const m of props.marks || []) {
    if (m.kind === 'fence') {
      // 老院篱笆已被上面的院落圈包住；独立篱笆按自身朝向保留。
      boxes.push({ x: m.x, z: m.z, rot: m.rot || 0, hw: (m.halfW || 0.5) + 0.25,
        hd: Math.max(Math.abs(m.front || 0), Math.abs(m.back || 0)) + 0.25 });
    } else circles.push({ x: m.x, z: m.z, r: m.r || Math.hypot(m.w || 1, m.d || 1) / 2 + 0.4 });
  }
  for (const b of village.bamboo || []) circles.push({ x: b[0], z: b[1], r: 0.75 });
  for (const m of village.mulberry || []) circles.push({ x: m[0], z: m[1], r: m[2] });
  return { boxes, circles, corridors };
}

// radius 是整个景物/树冠的占地预算，不是只检查树干中心。
export function hinterlandSiteSafe(x, z, radius, context, corridors = true) {
  const { world, field, distanceToRiver, reservations } = context;
  const cfg = world.hinterland, basin = world.terrain.basin, pond = world.terrain.pond;
  const extent = world.map.extent;
  if (x - radius < extent.x[0] + cfg.edgeMargin || x + radius > extent.x[1] - cfg.edgeMargin ||
      z - radius < extent.z[0] + cfg.edgeMargin || z + radius > extent.z[1] - cfg.edgeMargin) return false;
  if (Math.hypot(x - basin.x, z - basin.z) + radius > cfg.maxBasinRadius) return false;
  if (Math.hypot(x - pond.x, z - pond.z) < pond.radius + cfg.clearance + radius) return false;
  if (distanceToRiver(x, z) < world.stream.halfWidth + cfg.waterMargin + radius) return false;
  for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius],
    [radius * 0.707, radius * 0.707], [-radius * 0.707, radius * 0.707],
    [radius * 0.707, -radius * 0.707], [-radius * 0.707, -radius * 0.707]]) {
    if (field.sample(x + dx, z + dz) < world.terrain.waterLevel + cfg.waterMargin ||
        field.slope(x + dx, z + dz) > cfg.maxSlope) return false;
  }
  for (const b of reservations.boxes) if (boxDistance(x, z, b) < radius + cfg.clearance) return false;
  for (const c of reservations.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + radius + cfg.clearance) return false;
  if (corridors) for (const c of reservations.corridors) {
    if (lineDistance(x, z, c.points) < c.half + radius + cfg.routeMargin) return false;
  }
  return true;
}

// Small deterministic A*: every edge is sampled, including diagonal edges. No visual-only shortcuts.
export function planHinterlandPath(start, goal, width, context) {
  const cfg = context.world.hinterland, step = cfg.pathGrid, half = width / 2;
  const ex = context.world.map.extent;
  const ox = Math.floor(ex.x[0] / step) * step, oz = Math.floor(ex.z[0] / step) * step;
  const nx = Math.ceil((ex.x[1] - ox) / step) + 1;
  const id = (x, z) => Math.round((z - oz) / step) * nx + Math.round((x - ox) / step);
  const point = k => [ox + (k % nx) * step, oz + Math.floor(k / nx) * step];
  const cache = new Map();
  function safe(x, z) {
    if (!hinterlandSiteSafe(x, z, half, context, false)) return false;
    for (const c of context.reservations.corridors) {
      // 只在旧路的接入口允许重叠，不横穿旧支路。
      if (lineDistance(x, z, c.points) < c.half + half + cfg.routeMargin &&
          Math.hypot(x - start[0], z - start[1]) > cfg.joinRadius) return false;
    }
    return true;
  }
  function edge(a, b) {
    const n = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / cfg.pathSample));
    for (let i = 0; i <= n; i++) if (!safe(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)) return false;
    return true;
  }
  const sk = id(...start), gk = id(...goal);
  if (!edge(start, point(sk)) || !edge(point(gk), goal)) return null;
  const open = [sk], scores = new Map([[sk, 0]]), previous = new Map(), closed = new Set();
  const heuristic = k => { const p = point(k); return Math.hypot(p[0] - goal[0], p[1] - goal[1]); };
  let visits = 0;
  while (open.length && visits++ < cfg.maxPathNodes) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (scores.get(open[i]) + heuristic(open[i]) < scores.get(open[best]) + heuristic(open[best])) best = i;
    const k = open.splice(best, 1)[0];
    if (k === gk) {
      const raw = [goal];
      let at = k;
      while (at !== sk) { raw.push(point(at)); at = previous.get(at); }
      raw.push(point(sk), start); raw.reverse();
      // 逐段视线裁剪，保留绕障弯折；不在寻路后用样条抄近路穿物体。
      const points = [raw[0]];
      for (let i = 0; i < raw.length - 1;) {
        let j = Math.min(raw.length - 1, i + 8);
        while (j > i + 1 && !edge(raw[i], raw[j])) j--;
        if (Math.hypot(raw[j][0] - points.at(-1)[0], raw[j][1] - points.at(-1)[1]) > 0.01) points.push(raw[j]);
        i = j;
      }
      return { points, width };
    }
    closed.add(k);
    const a = point(k);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const b = [a[0] + dx * step, a[1] + dz * step], nk = id(...b);
      if (closed.has(nk) || b[0] <= ex.x[0] || b[0] >= ex.x[1] || b[1] <= ex.z[0] || b[1] >= ex.z[1]) continue;
      if (!cache.has(nk)) cache.set(nk, safe(...b));
      if (!cache.get(nk) || !edge(a, b)) continue;
      const score = scores.get(k) + step * Math.hypot(dx, dz);
      if (score < (scores.get(nk) ?? Infinity)) {
        scores.set(nk, score); previous.set(nk, k);
        if (!open.includes(nk)) open.push(nk);
      }
    }
  }
  return null;
}

export function planHinterland(world, field, distanceToRiver, village, props, cliff) {
  const cfg = world.hinterland, rand = seeded(cfg.seed);
  const context = { world, field, distanceToRiver, reservations: createHinterlandReservations(world, village, props, cliff) };
  const paths = [], trees = [], bamboo = [], structures = [], rejected = [];
  // 每个锚点从旧路连出；外围锚点之间再连为经营地小径，合起来有回游而不是死胡同。
  for (const route of cfg.paths) {
    const path = planHinterlandPath(route.points[0], route.points.at(-1), route.width, context);
    if (path) paths.push({ ...path, id: route.id }); else rejected.push(route.id);
  }
  const pathFree = (x, z, r) => paths.every(p => lineDistance(x, z, p.points) >= p.width / 2 + r + cfg.routeMargin);
  const occupied = (x, z, r) => [...trees, ...bamboo, ...structures].every(p => Math.hypot(x - p.x, z - p.z) >= r + p.radius + cfg.plantGap);
  for (const s of cfg.structures) {
    const radius = Math.hypot(s.w / 2, s.d / 2) + 0.5;
    if (hinterlandSiteSafe(s.x, s.z, radius, context) && pathFree(s.x, s.z, radius) && occupied(s.x, s.z, radius)) {
      structures.push({ ...s, radius, y: field.sample(s.x, s.z) });
    } else rejected.push(s.id);
  }
  for (const patch of cfg.groves) {
    // Ordered rows suggest a tended grove; omitted cells, jitter and mixed ages avoid plantation regularity.
    for (let z = patch.z[0] + patch.spacing / 2; z < patch.z[1]; z += patch.spacing) {
      for (let x = patch.x[0] + patch.spacing / 2; x < patch.x[1]; x += patch.spacing) {
        const px = x + (rand() - 0.5) * patch.spacing * 0.65;
        const pz = z + (rand() - 0.5) * patch.spacing * 0.65;
        if (rand() > patch.density) continue;
        const radius = patch.crown[0] + rand() * (patch.crown[1] - patch.crown[0]);
        if (!hinterlandSiteSafe(px, pz, radius, context) || !pathFree(px, pz, radius) || !occupied(px, pz, radius)) continue;
        trees.push({ x: px, z: pz, y: field.sample(px, pz), radius, kind: patch.kind, patch: patch.id,
          height: patch.height[0] + rand() * (patch.height[1] - patch.height[0]), rot: rand() * TAU, variant: Math.floor(rand() * 4) });
      }
    }
  }
  for (const patch of cfg.bamboo) {
    for (let i = 0; i < patch.attempts && bamboo.filter(b => b.patch === patch.id).length < patch.count; i++) {
      const x = patch.x[0] + rand() * (patch.x[1] - patch.x[0]), z = patch.z[0] + rand() * (patch.z[1] - patch.z[0]);
      const radius = 1.15;
      if (hinterlandSiteSafe(x, z, radius, context) && pathFree(x, z, radius) && occupied(x, z, radius)) {
        bamboo.push({ x, z, y: field.sample(x, z), radius, height: 3.6 + rand() * 1.8, rot: rand() * TAU, patch: patch.id });
      }
    }
  }
  return { trees, bamboo, structures, paths, rejected, context };
}

// Shared primitives + colour instances: all trees/structures share ~12 batches, never one mesh per leaf.
function distortedCrown(seed) { return foliageGeometry(Math.round(seed * 977) + 317, 1); }
// Four folded-lance triangles replace each twenty-face leaf, in the same slot.
function leafFanGeometry() {
  const g = new THREE.BufferGeometry();
  const a = [-1, 0, 0], b = [0, 0.12, 0], c = [1, -0.08, 0], l = [0.05, 0, 0.65], r = [-0.05, 0, -0.65];
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...l, ...b, ...c, ...l,
    ...a, ...r, ...b, ...b, ...r, ...c], 3));
  g.computeVertexNormals(); return g;
}
export function createHinterland(cfg, field, distanceToRiver, world, village, props, cliff) {
  const layout = planHinterland(world, field, distanceToRiver, village, props, cliff);
  const group = new THREE.Group(); group.name = 'hinterland';
  const blockers = [], batches = new Map();
  // Instance tints do not require vertexColors: only crowns have baked color data.
  const mat = new THREE.MeshLambertMaterial({ flatShading: true });
  const crownMat = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true });
  const leafMat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });
  const geos = { beam: new THREE.CylinderGeometry(0.72, 1, 1, 6), box: new THREE.BoxGeometry(1, 1, 1),
    leaf: leafFanGeometry(), fruit: new THREE.IcosahedronGeometry(1, 0) };
  for (let i = 0; i < 4; i++) geos['crown' + i] = distortedCrown(i * 2.3);
  const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  function add(kind, x, y, z, sx, sy, sz, color, rot = 0, q = null) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, rot, 0);
    if (q) dummy.quaternion.copy(q);
    dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
    if (!batches.has(kind)) batches.set(kind, []);
    batches.get(kind).push({ matrix: dummy.matrix.clone(), color: new THREE.Color(color) });
  }
  function beam(a, b, r, color) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length(), q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
    add('beam', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, r, len, r, color, 0, q);
  }
  function block(x, z, hw, hd, rot, minY, maxY, source) { blockers.push({ x, z, hw, hd, rot, minY, maxY, source }); }
  const rand = seeded(cfg.seed ^ 0x785);
  for (const t of layout.trees) {
    const trunkH = t.height * 0.52, tr = 0.12 + t.radius * 0.035;
    beam([t.x, t.y - 0.12, t.z], [t.x + 0.15, t.y + trunkH, t.z - 0.08], tr, cfg.palette.bark);
    block(t.x, t.z, tr, tr, 0, t.y - 0.1, t.y + trunkH, 'trunk');
    const base = new THREE.Color(t.kind === 'mulberry' ? cfg.palette.mulberry : cfg.palette.orchard);
    for (let k = 0; k < 5; k++) {
      const a = t.rot + k * TAU / 5, spread = t.radius * (k === 0 ? 0.12 : 0.38);
      const x = t.x + Math.cos(a) * spread, z = t.z + Math.sin(a) * spread;
      const y = t.y + t.height - t.radius * (0.63 + (k % 2) * 0.16);
      const join = 0.59 + k * 0.07;
      beam([t.x + 0.15 * join, t.y - 0.12 + (trunkH + 0.12) * join, t.z - 0.08 * join], [x, y, z], tr * (k ? 0.38 : 0.58), cfg.palette.bark);
      const r = t.radius * ((k === 0 ? 0.57 : 0.28 + (k % 2) * 0.055) + rand() * 0.055), c = base.clone().offsetHSL((rand() - 0.5) * 0.022, 0, (rand() - 0.5) * 0.09);
      add('crown' + t.variant, x, y, z, r, r * (k ? 0.75 : 0.86), r, c, a);
      // A few visible leaf fans break the broad crown, not a stack of perfect spheres.
      for (let j = 0; j < 3; j++) {
        const a2 = a + j * 1.8;
        add('leaf', x + Math.cos(a2) * r * 0.8, y + 0.1, z + Math.sin(a2) * r * 0.8,
          r * 0.32, 0.1, r * 0.14, c.clone().offsetHSL(0, 0, 0.035), a2);
      }
    }
  }
  for (const b of layout.bamboo) {
    for (let k = 0; k < 3; k++) {
      const a = b.rot + k * 2.1, x = b.x + Math.cos(a) * 0.22, z = b.z + Math.sin(a) * 0.22, y = field.sample(x, z), h = b.height * (0.85 + k * 0.06);
      beam([x, y, z], [x + Math.cos(a) * 0.2, y + h, z + Math.sin(a) * 0.2], 0.045, cfg.palette.bamboo);
      for (let j = 1; j < 6; j++) {
        add('beam', x + Math.cos(a) * 0.03 * j, y + h * j / 6, z + Math.sin(a) * 0.03 * j, 0.058, 0.045, 0.058, cfg.palette.bambooNode);
        if (j < 3) continue;
        for (let side = -1; side <= 1; side += 2) {
          const la = a + side * (0.85 + j * 0.1);
          add('leaf', x + Math.cos(la) * (0.28 + j * 0.025), y + h * j / 6, z + Math.sin(la) * (0.28 + j * 0.025), 0.34 + j * 0.025, 0.055, 0.13, cfg.palette.mulberry, la);
        }
      }
    }
    block(b.x, b.z, 0.26, 0.26, 0, b.y, b.y + b.height, 'bamboo');
  }
  for (const s of layout.structures) {
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    const at = (x, z) => [s.x + x * c + z * sn, s.z - x * sn + z * c];
    function pole(x, z, h, r = 0.085) {
      const p = at(x, z), y = field.sample(...p);
      beam([p[0], y - 0.08, p[1]], [p[0], y + h, p[1]], r, cfg.palette.wood);
      block(...p, r, r, 0, y, y + h, s.id);
    }
    if (s.kind === 'shed') {
      // Each post ends under its sloping eave, even where the terrain is not perfectly level.
      const slope = 0.36, roofY = s.y + 2.9;
      for (const x of [-s.w / 2 + 0.25, s.w / 2 - 0.25]) {
        const top = roofY - Math.abs(x) * Math.tan(slope) - 0.16;
        for (const z of [-s.d / 2 + 0.25, s.d / 2 - 0.25]) {
          const p = at(x, z); pole(x, z, top - field.sample(...p), 0.12);
        }
        const a = at(x, -s.d / 2 + 0.15), b = at(x, s.d / 2 - 0.15);
        beam([a[0], top, a[1]], [b[0], top, b[1]], 0.095, cfg.palette.wood);
      }
      const ridgeA = at(0, -s.d / 2 - 0.12), ridgeB = at(0, s.d / 2 + 0.12);
      beam([ridgeA[0], roofY - 0.14, ridgeA[1]], [ridgeB[0], roofY - 0.14, ridgeB[1]], 0.1, cfg.palette.wood);
      // Two pitched reed/thatch planes, exposed frame, open front; no invisible full-box collision.
      for (const side of [-1, 1]) {
        const p = at(side * s.w / 4, 0);
        dummy.rotation.set(0, s.rot, -side * slope);
        const q = dummy.quaternion.clone();
        add('box', p[0], roofY - s.w / 4 * Math.tan(slope), p[1], s.w / 2 / Math.cos(slope) + 0.4, 0.24, s.d + 0.7, cfg.palette.thatch, 0, q);
        for (let j = 0; j < 9; j++) {
          const pp = at(side * s.w / 4, -s.d / 2 + j * s.d / 8);
          add('box', pp[0], roofY - s.w / 4 * Math.tan(slope) + 0.13, pp[1], s.w / 2 / Math.cos(slope) + 0.4, 0.045, 0.07,
            j % 2 ? cfg.palette.thatch : cfg.palette.straw, 0, q);
        }
      }
      for (let k = 0; k < 6; k++) {
        const p = at(-s.w * 0.23 + k * 0.25, -s.d * 0.22), y = field.sample(...p);
        add('beam', p[0], y + 0.4, p[1], 0.34, 0.8, 0.34, cfg.palette.straw, k * 0.7);
      }
      const pile = at(-s.w * 0.1, -s.d * 0.22);
      block(...pile, 1.05, 0.5, s.rot, s.y, s.y + 0.9, s.id + '-straw');
    } else if (s.kind === 'trellis') {
      for (const x of [-s.w / 2, s.w / 2]) for (const z of [-s.d / 2, 0, s.d / 2]) {
        const p = at(x, z); pole(x, z, s.y + 2.15 - field.sample(...p), 0.065);
      }
      for (let i = 0; i < 7; i++) {
        const z = -s.d / 2 + i * s.d / 6, a = at(-s.w / 2 - 0.2, z), b = at(s.w / 2 + 0.2, z);
        beam([a[0], s.y + 2.15, a[1]], [b[0], s.y + 2.15, b[1]], 0.035, cfg.palette.wood);
        for (let j = 0; j < 4; j++) {
          const p = at(-s.w / 2 + (j + rand()) * s.w / 4, z + (rand() - 0.5) * 0.3);
          add('leaf', p[0], s.y + 2.18, p[1], 0.42, 0.07, 0.28, cfg.palette.mulberry, rand() * TAU);
          if (i % 3 === 0 && j % 2 === 0) add('fruit', p[0], s.y + 1.91, p[1], 0.1, 0.22, 0.1, cfg.palette.gourd);
        }
      }
    } else if (s.kind === 'drying') {
      for (const x of [-s.w / 2, s.w / 2]) for (const z of [-s.d / 2, s.d / 2]) {
        const p = at(x, z); pole(x, z, s.y + 0.95 - field.sample(...p), 0.055);
      }
      add('box', s.x, s.y + 0.95, s.z, s.w + 0.2, 0.09, s.d + 0.2, cfg.palette.wood, s.rot);
      for (let i = 0; i < 5; i++) {
        const p = at(-s.w / 2 + 0.25 + i * (s.w - 0.5) / 4, 0);
        add('beam', p[0], s.y + 1.03, p[1], 0.24, 0.04, 0.24, cfg.palette.straw);
      }
      block(s.x, s.z, s.w / 2 + 0.1, s.d / 2 + 0.1, s.rot, s.y, s.y + 1.08, s.id);
    }
  }
  for (const [kind, instances] of batches) {
    const material = kind === 'leaf' ? leafMat : kind.startsWith('crown') ? crownMat : mat;
    const mesh = new THREE.InstancedMesh(geos[kind], material, instances.length);
    mesh.name = 'hinterland-' + kind;
    instances.forEach((o, i) => { mesh.setMatrixAt(i, o.matrix); mesh.setColorAt(i, o.color); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); group.add(mesh);
  }
  // Ground ribbons sample each vertex from the same heightfield as the controller.
  const positions = [], colors = [];
  function tri(a, b, c, color) {
    for (const p of [a, b, c]) { positions.push(p[0], field.sample(...p) + cfg.pathLift, p[1]); colors.push(color.r, color.g, color.b); }
  }
  for (const path of layout.paths) {
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.ceil(len / cfg.pathSample), nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      for (let j = 0; j < count; j++) {
        const p = [a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count];
        const q = [a[0] + (b[0] - a[0]) * (j + 1) / count, a[1] + (b[1] - a[1]) * (j + 1) / count];
        const h = path.width / 2, c = new THREE.Color(cfg.palette.path).offsetHSL(0, 0, Math.sin(i + j * 0.4) * 0.018);
        const l0 = [p[0] + nx * h, p[1] + nz * h], r0 = [p[0] - nx * h, p[1] - nz * h];
        const l1 = [q[0] + nx * h, q[1] + nz * h], r1 = [q[0] - nx * h, q[1] - nz * h];
        tri(l0, r0, r1, c); tri(l0, r1, l1, c);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  ground.name = 'hinterland-paths'; group.add(ground);
  return { group, blockers, ...layout };
}
