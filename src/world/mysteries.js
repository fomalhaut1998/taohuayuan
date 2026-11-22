import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createHinterlandReservations, hinterlandSiteSafe } from './hinterland.js';

const TAU = Math.PI * 2;
const DEFINITIONS = [
  { id: 'bell', name: '林间古钟', action: '轻叩', line: '山中无历日，一响过千春。', cooldown: 8, height: 1.65 },
  { id: 'chess', name: '苔石残棋', action: '细看', line: '石上余残局，松间不计年。', cooldown: 9, height: 0.85 },
  { id: 'fireflies', name: '草际流萤', action: '静观', line: '草间星未落，疑是故人灯。', cooldown: 10, height: 1.1 }
];

// No quest pins: sites are only exposed for deterministic tests and developer inspection.
export function planMysterySites(world, field, distanceToRiver, village, props, cliff, hinterland, scenes = {}, flora = {}) {
  const reservations = createHinterlandReservations(world, village, props, cliff);
  reservations.boxes.push(...(hinterland.blockers || []), ...(scenes.blockers || []));
  for (const t of [...(hinterland.trees || []), ...(hinterland.bamboo || [])]) reservations.circles.push({ x: t.x, z: t.z, r: t.radius || 1 });
  for (const t of flora.spots || []) reservations.circles.push({ x: t[0], z: t[2], r: 0.7 });
  for (const p of hinterland.paths || []) reservations.corridors.push({ points: p.points, half: p.width / 2 });
  for (const s of [...(scenes.mapData?.scenes || []), ...(scenes.mapData?.nature || [])]) reservations.circles.push({ x: s.x, z: s.z, r: s.radius });
  for (const p of scenes.mapData?.paths || []) reservations.corridors.push({ points: p.points, half: p.width / 2 + 0.42 });
  const context = { world, field, distanceToRiver, reservations };
  const paths = (hinterland.paths || []).map(p => p.points).concat([world.village.road.points]);
  const candidates = [];
  for (const points of paths) for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / 2));
    for (let j = 0; j <= count; j++) for (const side of [-1, 1]) for (const offset of [4.8, 6.2, 8]) {
      const anchor = [a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count];
      const nx = -(b[1] - a[1]) / (length || 1) * side, nz = (b[0] - a[0]) / (length || 1) * side;
      candidates.push({ x: anchor[0] + nx * offset, z: anchor[1] + nz * offset, anchor, nx, nz, offset });
    }
  }
  const preferred = [[-30, -98], [-30, -178], [84, -207]];
  const sites = [];
  DEFINITIONS.forEach((definition, index) => {
    const ordered = [...candidates].sort((a, b) => Math.hypot(a.x - preferred[index][0], a.z - preferred[index][1]) - Math.hypot(b.x - preferred[index][0], b.z - preferred[index][1]));
    for (const c of ordered) {
      if (sites.some(p => Math.hypot(p.x - c.x, p.z - c.z) < 17) || !hinterlandSiteSafe(c.x, c.z, 1.65, context)) continue;
      // The final 1.9 m belongs to the object. The route to its reachable front must stay walkable.
      let connected = true;
      for (let d = 0; d <= c.offset - 1.9; d += 0.4) {
        if (!hinterlandSiteSafe(c.anchor[0] + c.nx * d, c.anchor[1] + c.nz * d, 0.45, context, false)) { connected = false; break; }
      }
      if (!connected) continue;
      const site = { ...definition, x: c.x, z: c.z, y: field.sample(c.x, c.z),
        approach: { x: c.x - c.nx * 2.4, z: c.z - c.nz * 2.4 }, rot: Math.atan2(c.nx, c.nz) };
      sites.push(site);
      reservations.circles.push({ x: c.x, z: c.z, r: 3 });
      break;
    }
  });
  return sites;
}

export function fireflyWeather(sky) {
  return !!sky && (sky.timeId === 'dusk' || sky.timeId === 'night') && sky.weatherId !== 'rain' && (sky.rainIntensity || 0) < 0.18;
}

export function createMysteries(world, field, distanceToRiver, village, props, cliff, hinterland, scenes, flora) {
  const group = new THREE.Group(); group.name = 'mysteries';
  const sites = planMysterySites(world, field, distanceToRiver, village, props, cliff, hinterland, scenes, flora);
  const blockers = [], states = new Map();
  const geos = new Set(), materials = new Set();
  let disposed = false, clock = 0;
  function mesh(parent, geo, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    geos.add(geo); materials.add(material);
    const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m;
  }
  const box = new THREE.BoxGeometry(1, 1, 1), cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
  const stone = new THREE.MeshLambertMaterial({ color: '#8D9785', flatShading: true });
  const moss = new THREE.MeshLambertMaterial({ color: '#657451', flatShading: true });
  const wood = new THREE.MeshLambertMaterial({ color: '#77674E', flatShading: true });
  const bronze = new THREE.MeshLambertMaterial({ color: '#6C7969', flatShading: true, side: THREE.DoubleSide });
  const pale = new THREE.MeshLambertMaterial({ color: '#C0BAA3', flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: '#4D5148', flatShading: true });
  [box, cylinder].forEach(g => geos.add(g)); [stone, moss, wood, bronze, pale, dark].forEach(m => materials.add(m));
  for (const site of sites) {
    const root = new THREE.Group(); root.position.set(site.x, site.y, site.z); root.rotation.y = site.rot; group.add(root);
    const state = { site, root, age: Infinity, activations: 0, glow: 0, enabled: site.id !== 'fireflies' }; states.set(site.id, state);
    function block(x, z, hw, hd, maxY) {
      const c = Math.cos(site.rot), s = Math.sin(site.rot);
      const wx = site.x + x * c + z * s, wz = site.z - x * s + z * c;
      blockers.push({ x: wx, z: wz, hw, hd, rot: site.rot, minY: field.sample(wx, wz), maxY: site.y + maxY, mysteryId: site.id });
    }
    if (site.id === 'bell') {
      for (const x of [-0.91, 0.91]) {
        const c = Math.cos(site.rot), s = Math.sin(site.rot), ground = field.sample(site.x + x * c, site.z - x * s) - site.y;
        mesh(root, box, wood, x, (ground + 2.63) / 2, 0, 0.17, 2.63 - ground, 0.19); block(x, 0, 0.10, 0.11, 2.63);
        mesh(root, box, stone, x, ground + 0.10, 0, 0.36, 0.22, 0.38);
        mesh(root, box, stone, x, ground + 0.24, 0, 0.26, 0.08, 0.28);
        // Diagonal timber knee braces under bell lintel
        const brace = mesh(root, box, wood, x * 0.72, 2.34, 0, 0.09, 0.56, 0.10);
        brace.rotation.z = x > 0 ? -0.68 : 0.68;
      }
      mesh(root, box, wood, 0, 2.63, 0, 2.36, 0.19, 0.25);
      // Small overhanging pitched wooden rain-eave hood ('古钟飞檐小覆顶')
      for (const side of [-1, 1]) {
        const slope = mesh(root, box, dark, 0, 2.86, side * 0.28, 2.68, 0.07, 0.66);
        slope.rotation.x = side * 0.34;
      }
      mesh(root, box, wood, 0, 3.00, 0, 2.74, 0.09, 0.12);
      const pivot = new THREE.Group(); pivot.position.y = 2.42; root.add(pivot); state.pivot = pivot;
      mesh(pivot, cylinder, dark, 0, -0.14, 0, 0.04, 0.28, 0.04);
      // Open flared shell and lip: visibly a hollow bell, not a solid cup.
      mesh(pivot, new THREE.CylinderGeometry(0.29, 0.48, 0.73, 14, 1, true), bronze, 0, -0.64, 0);
      const lip = mesh(pivot, new THREE.TorusGeometry(0.48, 0.035, 5, 18), bronze, 0, -1.005, 0); lip.rotation.x = Math.PI / 2;
      mesh(pivot, cylinder, bronze, 0, -0.28, 0, 0.29, 0.07, 0.29);
      mesh(pivot, cylinder, dark, 0, -0.91, 0, 0.075, 0.26, 0.075);
      block(0, 0, 0.5, 0.5, 2.1);
      for (let i = 0; i < 4; i++) mesh(root, box, moss, -0.96 + i * 0.65, 0.04, 0.28, 0.23, 0.04, 0.29);
    } else if (site.id === 'chess') {
      mesh(root, new THREE.CylinderGeometry(0.94, 1.12, 0.6, 7), stone, 0, 0.3, 0);
      mesh(root, box, stone, 0, 0.68, 0, 1.63, 0.19, 1.63); block(0, 0, 0.88, 0.88, 0.79);
      mesh(root, box, moss, -0.62, 0.785, 0.45, 0.38, 0.025, 0.58);
      for (let i = -2; i <= 2; i++) {
        mesh(root, box, dark, i * 0.26, 0.78, 0, 0.012, 0.008, 1.27);
        mesh(root, box, dark, 0, 0.78, i * 0.26, 1.27, 0.008, 0.012);
      }
      const moves = [[-1, 0], [1, 1], [0, -1], [2, -1], [-1, 2]];
      moves.forEach(([x, z], i) => { const p = mesh(root, cylinder, i % 2 ? pale : dark, x * 0.26, 0.815, z * 0.26, 0.075, 0.06, 0.075); if (i === 0) state.piece = p; });
      const glow = new THREE.MeshBasicMaterial({ color: '#C0C99B', transparent: true, opacity: 0, depthWrite: false });
      // Only this tiny response is luminous. All ordinary geometry participates in sky lighting.
      glow.userData.skyIgnore = true;
      const trace = mesh(root, new THREE.RingGeometry(0.11, 0.14, 20), glow, -0.26, 0.787, 0); trace.rotation.x = -Math.PI / 2; state.trace = trace;
    } else {
      // A weather-gated living detail, not a permanent beacon.
      const flyGeo = new THREE.BufferGeometry();
      flyGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(27), 3));
      flyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(27), 3));
      const flyMat = new THREE.PointsMaterial({ color: '#CFD9A0', vertexColors: true, size: 0.065, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false });
      flyMat.userData.skyIgnore = true; geos.add(flyGeo); materials.add(flyMat);
      state.flies = new THREE.Points(flyGeo, flyMat); state.flies.frustumCulled = false; root.add(state.flies);
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4, x = Math.cos(a) * 0.65, z = Math.sin(a) * 0.65;
        const ground = field.sample(site.x + x, site.z + z) - site.y;
        const leaf = mesh(root, box, moss, x, ground + 0.16, z, 0.045, 0.34, 0.1); leaf.rotation.z = Math.sin(i) * 0.35;
      }
    }
  }
  // Five draw calls total: static world, moving bell, moving stone, trace, fireflies.
  // Merge transformed geometry with per-vertex colours instead of one draw per detail.
  function consolidate(meshes, parent) {
    if (!meshes.length) return;
    parent.updateWorldMatrix(true, true);
    const inverse = parent.matrixWorld.clone().invert();
    const pieces = meshes.map(m => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, m.matrixWorld));
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = m.material.color.r; colors[i + 1] = m.material.color.g; colors[i + 2] = m.material.color.b; }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return g;
    });
    const geometry = mergeGeometries(pieces);
    if (!geometry) throw new Error('Mystery geometry attributes must match');
    pieces.forEach(g => g.dispose()); geos.add(geometry);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, side: THREE.DoubleSide }); materials.add(material);
    const merged = new THREE.Mesh(geometry, material); parent.add(merged);
    meshes.forEach(m => m.removeFromParent());
  }
  group.updateMatrixWorld(true);
  const moving = new Set();
  for (const s of states.values()) {
    if (s.piece) moving.add(s.piece);
    if (s.pivot) { const parts = []; s.pivot.traverse(o => { if (o.isMesh) { parts.push(o); moving.add(o); } }); consolidate(parts, s.pivot); moving.add(s.pivot.children.find(o => o.isMesh)); }
  }
  const staticParts = [];
  group.traverse(o => { if (o.isMesh && o.material.isMeshLambertMaterial && !moving.has(o)) staticParts.push(o); });
  consolidate(staticParts, group);
  const stats = { drawCalls: 0, triangles: 0 };
  group.traverse(o => { if (o.isMesh || o.isPoints) { stats.drawCalls++; if (o.isMesh) stats.triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; } });
  function activate(id) {
    const s = states.get(id); if (disposed || !s) return false;
    s.age = 0; s.activations++; return true;
  }
  function update(dt, elapsed, sky) {
    if (disposed) return;
    clock += dt;
    for (const s of states.values()) {
      s.age += dt;
      if (s.pivot) s.pivot.rotation.z = Math.sin(s.age * 8.5) * Math.exp(-s.age * 1.5) * 0.16 || 0;
      if (s.piece) { s.piece.position.y = 0.815 + (s.age < 2.8 ? Math.sin(s.age * Math.PI / 2.8) * 0.028 : 0); s.trace.material.opacity = s.age < 4 ? Math.sin(Math.min(s.age / 4, 1) * Math.PI) * 0.28 : 0; }
      if (s.flies) {
        s.enabled = fireflyWeather(sky);
        s.glow += ((s.enabled ? 1 : 0) - s.glow) * Math.min(1, dt * 1.2);
        const positions = s.flies.geometry.attributes.position, colors = s.flies.geometry.attributes.color;
        for (let i = 0; i < 9; i++) {
          const a = i * 2.4 + clock * 0.16;
          positions.setXYZ(i, Math.cos(a) * (0.6 + i % 3 * 0.25), 0.6 + (i % 4) * 0.18 + Math.sin(clock * 0.7 + i) * 0.12, Math.sin(a) * 0.9);
          const flicker = 0.6 + 0.4 * Math.sin(clock * 1.5 + i * 1.7); colors.setXYZ(i, flicker, flicker, flicker);
        }
        positions.needsUpdate = true; colors.needsUpdate = true;
        s.flies.material.opacity = s.glow * 0.5;
      }
    }
  }
  function dispose() {
    if (disposed) return; disposed = true; group.removeFromParent();
    geos.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); states.clear();
  }
  return { group, sites, blockers, states, stats, activate, update, dispose, get disposed() { return disposed; } };
}
