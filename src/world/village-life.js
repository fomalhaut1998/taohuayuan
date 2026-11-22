import * as THREE from 'three';
import { openVesselGeometry, revolvedGeometry, wellRimGeometry } from './model-geometry.js';
import { wellBlockGeometry, coopRoofGeometry, recordVillageDetail } from './village-detail-geometry.js';

const TAU = Math.PI * 2;

function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSink() { return { position: [], normal: [], color: [] }; }
function geometryFromSink(sink) {
  const g = new THREE.BufferGeometry();
  for (const key of ['position', 'normal', 'color']) g.setAttribute(key, new THREE.Float32BufferAttribute(sink[key], 3));
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
function clothGeometry(phase = 0) {
  const p = [], w = 1, h = 0.85;
  const uv = (u, v) => [w * (u - 0.5), -h * v, 0.035 * Math.sin(u * TAU * 2 + phase) * (0.3 + v)];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) {
    const a = uv(i / 6, j / 3), b = uv((i + 1) / 6, j / 3), c = uv((i + 1) / 6, (j + 1) / 3), d = uv(i / 6, (j + 1) / 3);
    p.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals(); return g;
}

function segmentDistance(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2)) : 0;
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
function lineDistance(x, z, points) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) best = Math.min(best, segmentDistance(x, z, points[i], points[i + 1]));
  return best;
}
function boxDistance(x, z, b) {
  const dx = x - b.x, dz = z - b.z, ca = Math.cos(b.rot || 0), sa = Math.sin(b.rot || 0);
  const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
  return Math.hypot(Math.max(0, Math.abs(lx) - b.hw), Math.max(0, Math.abs(lz) - b.hd));
}

export function createVillageLife(world, field, distanceToRiver, village, props, cliff, hinterland, villageScenes, mysteryWorld) {
  const cfg = world.villageLife;
  const pal = cfg.palette;
  const rand = seeded(cfg.seed);
  const group = new THREE.Group(); group.name = 'village-life';
  const blockers = [], richness = [];
  const sinks = { solid: makeSink(), botanical: makeSink(), ground: makeSink() };
  const templates = {
    box: new THREE.BoxGeometry(1, 1, 1),
    beam: new THREE.CylinderGeometry(0.88, 1, 1, 5),
    coopRoof: coopRoofGeometry(),
    cone: new THREE.CylinderGeometry(0.22, 1, 1, 7),
    disk: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    wellRim: wellRimGeometry(),
    ico: new THREE.IcosahedronGeometry(0.5, 0),
    leaf: new THREE.BufferGeometry(),
    veggie: new THREE.BufferGeometry(),
    petal: new THREE.SphereGeometry(0.5, 5, 2),
    bucket: openVesselGeometry('bucket'),
    jar: revolvedGeometry([[0, 0], [0.3, 0], [0.48, 0.2], [0.5, 0.52], [0.28, 0.85], [0.25, 1], [0.18, 1], [0.18, 0.84], [0.23, 0.14], [0, 0.14]], 8),
    ring: new THREE.TorusGeometry(0.5, 0.035, 4, 12),
    scarecrowCape: revolvedGeometry([[0.46, 0], [0.31, 0.42], [0.22, 0.68], [0.32, 1.0]], 5, 0.08),
    strawMantle: revolvedGeometry([[0.48, 0], [0.34, 0.62], [0.16, 1.0]], 5, 0.10),
    scarecrowHat: revolvedGeometry([[0.50, 0], [0.28, 0.56], [0, 1.0]], 6, 0.07),
    strawSheaf: revolvedGeometry([[0.46, 0], [0.22, 1.0]], 4, 0.09),
    gourd: revolvedGeometry([[0, 0], [0.48, 0.24], [0.21, 0.56], [0.35, 0.78], [0, 1.0]], 4, 0.07),
    millBase: revolvedGeometry([[0.48, 0], [0.39, 0.28], [0.40, 0.62], [0.50, 0.70], [0.50, 0.84], [0, 0.84]], 8, 0.05),
    millTop: revolvedGeometry([[0.43, 0], [0.44, 0.78], [0.38, 1.0], [0.15, 1.0], [0.11, 0.72], [0, 0.72]], 8, 0.045),
    stoneLeg: revolvedGeometry([[0.52, 0], [0.34, 0.52], [0.48, 1.0]], 4, 0.06)
  };
  templates.leaf.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.14, 0.035, 0.42, 0, 0.07, 1, 0, 0, 0, 0, 0.07, 1, 0.14, 0.035, 0.42], 3));
  templates.leaf.computeVertexNormals();
  {
    const vp = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.25;
      const aL = a - 0.68, aR = a + 0.68;
      vp.push(
        0, 0, 0,
        Math.cos(aL) * 0.56, 0.88 + (k % 2) * 0.10, Math.sin(aL) * 0.56,
        Math.cos(aR) * 0.56, 0.72 + ((k + 1) % 2) * 0.12, Math.sin(aR) * 0.56
      );
    }
    templates.veggie.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
    templates.veggie.computeVertexNormals();
  }
  const flat = new Map(), temp = new THREE.Object3D(), normalMatrix = new THREE.Matrix3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let active = null;

  // 只避真正的硬障碍：房屋本体、田块、老篱笆、崖石、主路/支路、水塘、河、既有景物与彩蛋、彼此。
  // 刻意不放进 hinterland 的「院落圈 r≈6.2 + 门户圈 r6.5」——用户嫌空的正是那片净空区。
  const hardBoxes = [];
  for (const b of village.blockers || []) hardBoxes.push({ x: b.x, z: b.z, hw: b.hw + cfg.avoid.housePad, hd: b.hd + cfg.avoid.housePad, rot: b.rot });
  for (const b of cliff.blockers || []) hardBoxes.push(b);
  for (const blk of world.village.fields.blocks) {
    const bw = blk.cols * (blk.plot[0] + blk.gap), bd = blk.rows * (blk.plot[1] + blk.gap);
    hardBoxes.push({ x: blk.x + bw * 0.5, z: blk.z - bd * 0.5, hw: bw * 0.5 + cfg.avoid.fieldPad, hd: bd * 0.5 + cfg.avoid.fieldPad, rot: 0 });
  }
  const corridors = [{ points: world.village.road.points, half: world.village.road.width / 2 + cfg.avoid.roadPad }];
  for (const h of village.houseInfo) if (h.spur && h.spur.pts) corridors.push({ points: h.spur.pts, half: (h.spur.half || 0.8) + cfg.avoid.spurPad });

  const fixedCircles = [{ x: world.terrain.pond.x, z: world.terrain.pond.z, r: world.terrain.pond.radius + cfg.avoid.pondPad }];
  for (const m of props.marks || []) {
    if (m.kind === 'fence') {
      hardBoxes.push({ x: m.x, z: m.z, rot: m.rot || 0, hw: (m.halfW || 0.5) + 0.25, hd: Math.max(Math.abs(m.front || 0), Math.abs(m.back || 0)) + 0.25 });
      continue;
    }
    const r = m.r || (Math.hypot(m.w || 1, m.d || 1) / 2 + 0.4);
    fixedCircles.push({ x: m.x, z: m.z, r: r + cfg.avoid.propPad });
  }
  for (const p of village.bamboo || []) fixedCircles.push({ x: p[0], z: p[1], r: 0.75 + cfg.avoid.plantPad });
  for (const m of village.mulberry || []) fixedCircles.push({ x: m[0], z: m[1], r: (m[2] || 0.6) + cfg.avoid.plantPad });
  for (const p of [...(hinterland.trees || []), ...(hinterland.bamboo || []), ...(hinterland.structures || [])]) fixedCircles.push({ x: p.x, z: p.z, r: p.radius + cfg.avoid.plantPad });
  const scenes = villageScenes.scenes || (villageScenes.mapData && villageScenes.mapData.scenes) || [];
  for (const s of scenes) fixedCircles.push({ x: s.x, z: s.z, r: (s.radius || 3) + cfg.avoid.scenePad });
  const nature = villageScenes.nature || (villageScenes.mapData && villageScenes.mapData.nature) || [];
  for (const p of nature) fixedCircles.push({ x: p.x, z: p.z, r: 1.4 + cfg.avoid.scenePad });
  for (const s of (mysteryWorld.sites || [])) fixedCircles.push({ x: s.x, z: s.z, r: 2.2 + cfg.avoid.scenePad });
  const placed = [];

  function siteSafe(x, z, radius) {
    const ext = world.map.extent;
    if (x < ext.x[0] + cfg.avoid.edgePad || x > ext.x[1] - cfg.avoid.edgePad || z < ext.z[0] + cfg.avoid.edgePad || z > ext.z[1] - cfg.avoid.edgePad) return false;
    if (distanceToRiver(x, z) < world.stream.halfWidth + cfg.avoid.waterPad + radius) return false;
    const y = field.sample(x, z);
    if (y < world.terrain.waterLevel + cfg.avoid.waterPad) return false;
    for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      if (field.slope(x + dx, z + dz) > cfg.avoid.maxSlope) return false;
      if (Math.abs(field.sample(x + dx, z + dz) - y) > cfg.avoid.maxGroundDelta) return false;
    }
    for (const b of hardBoxes) if (boxDistance(x, z, b) < radius + cfg.avoid.clearance) return false;
    for (const c of fixedCircles) if (Math.hypot(x - c.x, z - c.z) < c.r + radius + cfg.avoid.clearance) return false;
    for (const c of corridors) if (lineDistance(x, z, c.points) < c.half + radius + cfg.avoid.clearance) return false;
    for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < p.r + radius + cfg.avoid.clearance) return false;
    return true;
  }

  // 与 village-scenes.js 完全一致：active 承载位置 + 朝向，所有 helper 用局部坐标，y 用世界高度。
  const local = (x, y, z) => [active.x + Math.cos(active.rot) * x + Math.sin(active.rot) * z, y, active.z - Math.sin(active.rot) * x + Math.cos(active.rot) * z];
  const ground = (x, z) => { const p = local(x, 0, z); return field.sample(p[0], p[2]); };
  function push(geo, x, y, z, sx, sy, sz, color, batch = 'solid', rx = 0, ry = 0, rz = 0) {
    if (!flat.has(geo)) flat.set(geo, geo.index ? geo.toNonIndexed() : geo);
    const g = flat.get(geo), p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    temp.position.set(...local(x, y, z)); temp.rotation.set(rx, ry, rz);
    temp.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up, active.rot));
    temp.scale.set(sx, sy, sz); temp.updateMatrix();
    const ink = new THREE.Color(color), sink = sinks[batch]; normalMatrix.getNormalMatrix(temp.matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(temp.matrix); sink.position.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize(); sink.normal.push(v.x, v.y, v.z);
      const shade = c ? c.getX(i) : 1; sink.color.push(ink.r * shade, ink.g * shade, ink.b * shade);
    }
  }
  function solid(x, z, hw, hd, minY, maxY, part) {
    const p = local(x, 0, z);
    blockers.push({ x: p[0], z: p[2], hw, hd, rot: active.rot, minY, maxY, source: active.id, part });
  }
  function box(x, y, z, w, h, d, color = pal.wood, rot = 0) { push(templates.box, x, y, z, w, h, d, color, 'solid', 0, rot); }
  function beam(a, b, r, color = pal.wood) {
    const pa = local(...a), pb = local(...b), d = new THREE.Vector3(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    const q = new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize());
    temp.position.set((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2);
    temp.quaternion.copy(q); temp.scale.set(r, d.length(), r); temp.updateMatrix();
    const geo = templates.beam; if (!flat.has(geo)) flat.set(geo, geo.toNonIndexed());
    const g = flat.get(geo), sink = sinks.solid, ink = new THREE.Color(color); normalMatrix.getNormalMatrix(temp.matrix);
    for (let i = 0; i < g.attributes.position.count; i++) {
      v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(temp.matrix); sink.position.push(v.x, v.y, v.z);
      v.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(normalMatrix).normalize(); sink.normal.push(v.x, v.y, v.z);
      sink.color.push(ink.r, ink.g, ink.b);
    }
  }
  function vessel(kind, x, z, size, height, y = ground(x, z), color = pal.clay) { push(templates[kind], x, y, z, size, height, size, color); }
  function post(x, z, top, r = 0.06) { const y = ground(x, z); beam([x, y - 0.1, z], [x, top, z], r); }
  function foliage(x, y, z, r, color) {
    for (let k = 0; k < 5; k++) {
      const a = k * TAU / 5 + 0.3;
      push(templates.leaf, x + Math.sin(a) * r * 0.55, y + (k % 2) * 0.12, z + Math.cos(a) * r * 0.55,
        r * 0.8, r * 1.2, r * 0.4, k % 2 ? color : pal.leafLight, 'botanical', -0.5, a);
    }
  }

  // ---- 器物类型（11 种，全部以局部 0,0 为中心，朝向由 active.rot 决定）----
  function bambooFence() {
    const y = ground(0, 0), len = cfg.sizes.fenceLength, h = cfg.sizes.fenceHeight;
    for (let k = -2; k <= 2; k++) post(k * len / 4, 0, y + h, 0.055);
    for (const hh of [0.45, 0.95]) box(0, y + hh, 0, len, 0.06, 0.06, pal.bamboo);
    solid(0, 0, len / 2, 0.16, y, y + h, 'fence');
  }
  function vegetableBed() {
    const y = ground(0, 0), w = cfg.sizes.bedW, d = cfg.sizes.bedD;
    // Deep grounded earth bed (top stays at exact y + 0.12, deep base prevents floating on slopes)
    box(0, y - 0.06, 0, w, 0.36, d, pal.earth);
    for (let r = 0; r < cfg.sizes.bedRows; r++) for (let c = 0; c < cfg.sizes.bedCols; c++) {
      const lx = (c - (cfg.sizes.bedCols - 1) / 2) * (w / cfg.sizes.bedCols);
      const lz = (r - (cfg.sizes.bedRows - 1) / 2) * (d / cfg.sizes.bedRows);
      const topY = Math.max(y + 0.115, ground(lx, lz) + 0.10);
      push(templates.veggie, lx, topY, lz, 0.38, 0.27 + ((r + c) % 2) * 0.04, 0.38, (r + c) % 2 ? pal.leaf : pal.leafLight, 'botanical', 0, (r * 3 + c) * 0.85);
    }
    solid(0, 0, w / 2, d / 2, y, y + 0.4, 'bed');
  }
  function well() {
    const y = ground(0, 0), h = cfg.sizes.wellHeight, f = cfg.sizes.wellFrame;
    // Staggered masonry courses leave an honest open shaft and readable mortar seams.
    for (let row = 0; row < 2; row++) for (let k = 0; k < 8; k++) {
      const a = (k + row * 0.5) * TAU / 8;
      const block = wellBlockGeometry(a + 0.012, a + TAU / 8 - 0.012);
      push(block, 0, y + row * h / 2, 0, 1, h / 2 - 0.018, 1,
        (row + k) % 3 ? pal.stone : pal.stoneLight);
    }
    push(templates.wellRim, 0, y + h + 0.04, 0, 1.3, 0.08, 1.3, pal.stoneLight);
    for (const s of [-1, 1]) {
      post(s * 0.62, 0, y + h + f, 0.065);
      box(s * 0.62, y + h + f - 0.04, 0, 0.19, 0.16, 0.17, pal.wood);
    }
    const axle = y + h + f - 0.02;
    beam([-0.72, axle, 0], [0.78, axle, 0], 0.045, pal.woodDark);
    beam([-0.2, axle, 0], [0.2, axle, 0], 0.095, pal.wood);
    // Rope winds around the drum, then drops to a small suspended bucket.
    const ropePoints = Array.from({length: 25}, (_, k) => {
      const a = k * TAU / 8;
      return new THREE.Vector3(-0.14 + k * 0.28 / 24, Math.sin(a) * 0.104, Math.cos(a) * 0.104);
    });
    const rope = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePoints), 14, 0.009, 3, false);
    push(rope, 0, axle, 0, 1, 1, 1, pal.straw);
    beam([0, axle, 0.1], [0, y + h + f - 0.64, 0.1], 0.012, pal.straw);
    beam([0.78, axle, 0], [0.78, axle - 0.22, 0], 0.028, pal.woodDark);
    beam([0.78, axle - 0.22, 0], [0.78, axle - 0.22, 0.14], 0.036, pal.wood);
    vessel('bucket', 0, 0.1, 0.34, 0.4, y + h + f - 1.04, pal.wood);
    solid(0, 0, 0.75, 0.75, y, y + h + f, 'well');
  }
  function stoneMill() {
    const y = ground(0, 0);
    // 收腰石磨座 + 磨盘接粉缘 + 倒角磨扇（中空磨眼）+ 弯木磨拐
    push(templates.millBase, 0, y, 0, 1.48, 0.66, 1.48, pal.stone);
    push(templates.millTop, 0, y + 0.55, 0, 1.18, 0.24, 1.18, pal.stoneLight);
    beam([0.44, y + 0.68, 0], [0.56, y + 0.69, 0], 0.042, pal.woodDark);
    beam([0.52, y + 0.69, 0], [0.84, y + 0.88, 0], 0.036, pal.woodDark);
    beam([0.84, y + 0.86, 0], [0.84, y + 1.14, 0], 0.030, pal.wood);
    solid(0, 0, 0.78, 0.78, y, y + 1.05, 'mill');
  }
  function dryingRack() {
    const y = ground(0, 0), w = cfg.sizes.rackWidth, h = cfg.sizes.rackHeight;
    for (const s of [-1, 1]) {
      post(s * w / 2, 0, y + h, 0.07);
      beam([s * w / 2, y + h * 0.45, 0], [s * (w / 2 + 0.3), y, 0], 0.045, pal.woodDark);
    }
    beam([-w / 2, y + h, 0], [w / 2, y + h, 0], 0.055, pal.wood);
    for (let k = 0; k < 5; k++) {
      const t = (k / 5) * w - w / 2 + w / 10;
      const cloth = clothGeometry(k * 1.3);
      push(cloth, t, y + h - 0.02, 0, 0.42, 0.85 + rand() * 0.35, 0.42, k % 2 ? pal.cloth : pal.indigo, 'botanical');
    }
    solid(0, 0, w / 2, 0.18, y, y + h, 'rack');
  }
  function firewood() {
    const y = ground(0, 0);
    for (let row = 0; row < 3; row++) for (let j = 0; j < 4 - row; j++) {
      const lx = (j - (3 - row) / 2) * 0.26, ly = ground((j - (3 - row) / 2) * 0.26, 0) + 0.105 + row * 0.20;
      beam([lx, ly, -0.6], [lx, ly, 0.6], 0.11, row % 2 ? pal.wood : pal.woodDark);
    }
    solid(0, 0, 0.6, 0.68, y, y + 0.85, 'woodpile');
  }
  function chickenCoop() {
    const y = ground(0, 0), w = 1.3, d = 1.0, h = 1.1;
    // Raised plank coop: daylight gaps, open entrance, two-pitched thatch and straw nest.
    box(0, y + 0.16, 0, w, 0.08, d, pal.woodDark);
    for (const x of [-0.58, 0.58]) for (const z of [-0.43, 0.43]) {
      box(x, y + 0.57, z, 0.075, 1.14, 0.075, pal.woodDark);
    }
    for (let row = 0; row < 3; row++) {
      const ht = y + 0.34 + row * 0.29;
      box(0, ht, -0.47, w, 0.25, 0.065, row % 2 ? pal.bamboo : pal.wood);
      for (const x of [-0.615, 0.615]) box(x, ht, 0, 0.065, 0.25, d, pal.wood);
    }
    // No dark sticker: the central 0.4 m doorway genuinely has no front wall.
    for (const x of [-0.425, 0.425]) box(x, y + 0.61, 0.47, 0.45, 0.83, 0.065, pal.wood);
    box(0, y + 0.94, 0.47, 0.4, 0.17, 0.065, pal.bamboo);
    push(templates.coopRoof, 0, y + 1.12, 0, 1, 1, 1, pal.thatch);
    beam([0, y + 1.48, -0.5], [0, y + 1.48, 0.5], 0.025, pal.straw);
    for (let k = 0; k < 5; k++) {
      const a = k * TAU / 5;
      box(-0.2 + Math.cos(a) * 0.13, y + 0.23, -0.14 + Math.sin(a) * 0.11,
        0.22, 0.035, 0.045, pal.straw, a);
    }
    push(templates.ico, -0.22, y + 0.265, -0.13, 0.11, 0.14, 0.1, pal.cloth);
    solid(0, 0, w / 2, d / 2, y, y + h + 0.6, 'coop');
  }
  function scarecrow() {
    const y = ground(0, 0), h = cfg.sizes.scarecrowHeight;
    // 蓑衣斗笠稻草人：竹木十字架 + 收腰粗布长衫 + 稻草蓑衣披肩 + 宽檐斗笠与双袖草穗（低于旧方盒面数）
    post(0, 0, y + h + 0.04, 0.060);
    beam([-0.66, y + h * 0.79, 0], [0.66, y + h * 0.79, 0], 0.044, pal.bamboo);
    push(templates.scarecrowCape, 0, y + h * 0.30, 0, 0.70, h * 0.58, 0.50, pal.indigo);
    push(templates.strawMantle, 0, y + h * 0.58, 0, 0.64, h * 0.26, 0.48, pal.straw);
    push(templates.ico, 0, y + h * 0.99, 0, 0.34, 0.36, 0.32, pal.straw);
    push(templates.scarecrowHat, 0, y + h + 0.11, 0, 1.24, 0.36, 1.24, pal.hat, 'solid', -0.06, 0, 0.04);
    for (const s of [-1, 1]) {
      push(templates.strawSheaf, s * 0.20, y + h * 0.79, 0, 0.24, 0.34, 0.20, pal.indigo, 'solid', 0, 0, -s * 1.52);
      push(templates.strawSheaf, s * 0.52, y + h * 0.78, 0, 0.18, 0.20, 0.18, pal.straw, 'solid', 0, 0, -s * 1.56);
    }
    solid(0, 0, 0.45, 0.3, y, y + h + 0.45, 'scarecrow');
  }
  function clayJars() {
    const y = ground(0, 0);
    for (let k = 0; k < 3; k++) {
      const lx = (k - 1) * 0.55;
      vessel('jar', lx, 0, 0.42 + rand() * 0.08, 0.72 + rand() * 0.16, ground(lx, 0), k % 2 ? pal.clay : pal.clayLight);
    }
    solid(0, 0, 0.9, 0.45, y, y + 0.9, 'jars');
  }
  function gourdTrellis() {
    const y = ground(0, 0), w = 2.1, h = cfg.sizes.trellisHeight;
    for (const s of [-1, 1]) {
      post(s * w / 2, 0, y + h, 0.062);
      box(s * w / 2, y + h, 0, 0.055, 0.055, 0.44, pal.bamboo);
    }
    beam([-w / 2 - 0.1, y + h, 0], [w / 2 + 0.1, y + h, 0], 0.046, pal.bamboo);
    for (const tz of [-0.18, 0.18]) box(0, y + h + 0.03, tz, w + 0.14, 0.034, 0.036, pal.bamboo);
    for (let k = 0; k < 4; k++) {
      const lx = (k / 4) * w - w * 0.375;
      const sway = (rand() - 0.5) * 0.2;
      const gx = lx + sway * 0.65;
      const gz = (k % 2 ? 0.07 : -0.07);
      box((lx + gx) * 0.5, y + h - 0.19, gz * 0.5, 0.022, 0.39, 0.022, pal.leaf);
      foliage(lx, y + h - 0.22, gz * 0.6, 0.30, pal.leaf);
      push(templates.gourd, gx, y + h - 0.78, gz, 0.28, 0.42, 0.28, pal.gourd, 'botanical', sway * 0.35, k * 1.1, sway * 0.4);
    }
    solid(0, 0, w / 2, 0.16, y, y + h, 'trellis');
  }
  function stoneBench() {
    const y = ground(0, 0);
    // 叠边青石条凳面 + 束腰石墩双足
    box(0, y + 0.42, 0, 1.28, 0.065, 0.44, pal.stone);
    box(0, y + 0.47, 0, 1.20, 0.045, 0.38, pal.stoneLight);
    for (const s of [-1, 1]) push(templates.stoneLeg, s * 0.45, y - 0.02, 0, 0.34, 0.42, 0.44, pal.stone, 'solid', 0, Math.PI * 0.25);
    solid(0, 0, 0.65, 0.25, y, y + 0.5, 'bench');
  }
  const audited = (category, build) => () => recordVillageDetail(richness, sinks, active, category, build);
  const builders = { bambooFence, vegetableBed, well: audited('masonry-winch-well', well), stoneMill, dryingRack, firewood,
    chickenCoop: audited('plank-gabled-coop', chickenCoop), scarecrow, clayJars, gourdTrellis, stoneBench };

  // ---- 确定性布局：格点抖动 + 安全筛选 + 按类型配额 ----
  const cell = cfg.placement.cell, jitter = cfg.placement.jitter;
  const candidates = [];
  for (let ai = 0; ai < cfg.anchors.length; ai++) {
    const a = cfg.anchors[ai];
    for (let gx = 0; gx < a.cols; gx++) for (let gz = 0; gz < a.rows; gz++) {
      candidates.push({
        x: a.x0 + (gx + 0.5) * cell + (rand() - 0.5) * jitter,
        z: a.z0 + (gz + 0.5) * cell + (rand() - 0.5) * jitter,
        zone: ai, order: rand()
      });
    }
  }
  candidates.sort((p, q) => p.order - q.order);
  const items = [], counts = {};
  for (const t of cfg.placement.order) counts[t] = 0;
  for (const c of candidates) {
    for (const t of cfg.placement.order) {
      if (counts[t] >= cfg.placement.quota[t]) continue;
      const radius = cfg.sizes.radius[t] || cfg.sizes.radius.default;
      if (!siteSafe(c.x, c.z, radius)) continue;
      active = { x: c.x, z: c.z, rot: (rand() - 0.5) * cfg.placement.rotJitter, id: t + '-' + items.length };
      builders[t]();
      items.push({ kind: t, x: c.x, z: c.z, rot: active.rot, radius });
      placed.push({ x: c.x, z: c.z, r: radius });
      counts[t]++;
      break;
    }
  }
  active = null;

  let triangles = 0;
  for (const [name, sink] of Object.entries(sinks)) if (sink.position.length) {
    const mesh = new THREE.Mesh(geometryFromSink(sink), new THREE.MeshLambertMaterial({
      vertexColors: true, side: name === 'solid' ? THREE.FrontSide : THREE.DoubleSide,
      polygonOffset: name === 'ground', polygonOffsetFactor: -1, polygonOffsetUnits: -1, flatShading: true
    }));
    mesh.name = 'village-life-' + name; group.add(mesh); triangles += sink.position.length / 9;
  }
  for (const g of new Set([...Object.values(templates), ...flat.keys(), ...flat.values()])) g.dispose();

  const mapData = { items: items.map(i => ({ ...i })) };
  return {
    group, blockers, mapData, items, counts, richness,
    stats: { drawCalls: group.children.length, triangles },
    update(_dt, _elapsed, _sky) { /* 静态村中生活带，无需逐帧更新 */ }
  };
}
