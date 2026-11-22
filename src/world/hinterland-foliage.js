import * as THREE from 'three';

// Visual-only upper-node foliage. The parent owns the culms, terrain and safety
// reservation: never re-plan their positions or consume their placement RNG.
const TRIANGLE_BUDGET = 3500;
function localRandom(b) {
  let seed = (Math.imul(Math.round(b.x * 4096), 73856093) ^
    Math.imul(Math.round(b.z * 4096), 19349663) ^ Math.round(b.rot * 65536) ^ 0x46b9a13d) >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function geometry(triangles) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(triangles.flat(2), 3));
  // Non-indexed triangles retain their own flat, nonzero normals along the fold.
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
function leafGeometry() {
  const root = [0, 0, 0], ridge = [0.4, 0.055, 0], tip = [1, -0.52, 0];
  const left = [0.36, -0.035, 0.15], right = [0.36, -0.035, -0.15];
  return geometry([[root, ridge, left], [ridge, tip, left], [root, right, ridge], [ridge, right, tip]]);
}
function twigGeometry() {
  // Two thin crossing tapered ribbons, not coincident front/back leaf copies.
  return geometry([
    [[0, -0.012, 0], [1, -0.086, 0], [1, -0.074, 0]],
    [[0, -0.012, 0], [1, -0.074, 0], [0, 0.012, 0]],
    [[0, 0, -0.012], [1, -0.08, -0.006], [1, -0.08, 0.006]],
    [[0, 0, -0.012], [1, -0.08, 0.006], [0, 0, 0.012]],
  ]);
}

/**
 * Add the result.group beneath hinterland.group BEFORE optimizeStaticVisibility.
 * Both the current spread layout API and a wrapped { layout } API are accepted.
 * Every rendered vertex stays inside its existing bamboo.radius reservation.
 */
export function createHinterlandFoliage(hinterland, field, palette = {}) {
  const layout = hinterland.layout || hinterland;
  const bamboo = layout.bamboo || [];
  const context = layout.context || hinterland.context;
  const world = context?.world;
  const group = new THREE.Group(); group.name = 'hinterland-foliage';
  const leaves = leafGeometry(), twigs = twigGeometry();
  const leafRows = [], twigRows = [];
  const dummy = new THREE.Object3D(), point = new THREE.Vector3();
  const bounds = new THREE.Box3();
  const stats = { clumps: bamboo.length, culms: 0, sprays: 0, leaves: 0, twigs: 0,
    triangles: 0, rejectedSprays: 0, maxFootprintRadius: 0, minGroundClearance: Infinity };
  const leafColor = new THREE.Color(palette.mulberry || palette.bamboo || '#658353');
  const twigColor = new THREE.Color(palette.bamboo || '#70885b');
  function row(g, x, y, z, sx, sy, sz, yaw, color, source) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
    return { geometry: g, matrix: dummy.matrix.clone(), color, source };
  }
  function inspect(rows, b) {
    const extent = world?.map.extent, margin = world?.hinterland.edgeMargin || 0;
    let radius = 0, groundClearance = Infinity;
    const box = new THREE.Box3();
    for (const item of rows) {
      const positions = item.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(item.matrix);
        if (![point.x, point.y, point.z].every(Number.isFinite)) return null;
        const r = Math.hypot(point.x - b.x, point.z - b.z), ground = field.sample(point.x, point.z);
        // A small inset protects the reservation after float32 GPU matrix rounding.
        if (r > b.radius - 0.004 || !Number.isFinite(ground) || point.y < ground + 0.35) return null;
        if (extent && (point.x < extent.x[0] + margin || point.x > extent.x[1] - margin ||
            point.z < extent.z[0] + margin || point.z > extent.z[1] - margin)) return null;
        radius = Math.max(radius, r); groundClearance = Math.min(groundClearance, point.y - ground);
        box.expandByPoint(point);
      }
    }
    return { radius, groundClearance, box };
  }
  bamboo.forEach((b, clump) => {
    if (![b.x, b.z, b.radius, b.height, b.rot].every(Number.isFinite) || b.radius <= 0 || b.height <= 0) return;
    const rand = localRandom(b);
    for (let culm = 0; culm < 3; culm++) {
      // Match createHinterland's actual three terrain-rooted, slightly leaning culms.
      const a = b.rot + culm * 2.1, x = b.x + Math.cos(a) * 0.22, z = b.z + Math.sin(a) * 0.22;
      const ground = field.sample(x, z), h = b.height * (0.85 + culm * 0.06);
      if (!Number.isFinite(ground)) continue;
      stats.culms++;
      for (const node of [3, 5]) {
        // Alternating heights/directions leave real gaps; no spherical crown.
        const yaw = a + (node === 3 ? -1 : 1) * (0.9 + rand() * 0.65);
        const anchor = [x + Math.cos(a) * 0.03 * node, ground + h * node / 6, z + Math.sin(a) * 0.03 * node];
        const source = { clump, culm, node, anchor };
        const branchLength = 0.28 + rand() * 0.055;
        const branch = row(twigs, ...anchor, branchLength, 1, 1, yaw, twigColor.clone(), source);
        const spray = [branch];
        for (let k = 0; k < 4; k++) {
          const t = 0.18 + k * 0.245, sign = k % 2 ? 1 : -1;
          const length = 0.43 + rand() * 0.11;
          const c = leafColor.clone().offsetHSL((rand() - 0.5) * 0.018, 0, (rand() - 0.5) * 0.075);
          spray.push(row(leaves, anchor[0] + Math.cos(yaw) * branchLength * t,
            anchor[1] - 0.08 * t, anchor[2] - Math.sin(yaw) * branchLength * t,
            length, 0.72 + rand() * 0.21, 0.61 + rand() * 0.13,
            yaw + sign * (0.48 + rand() * 0.45), c, { ...source, leaf: k }));
        }
        const checked = inspect(spray, b);
        // Fail closed as a connected spray, never detach leaves or alter layout.
        if (!checked || stats.triangles + 20 > TRIANGLE_BUDGET) { stats.rejectedSprays++; continue; }
        twigRows.push(branch); leafRows.push(...spray.slice(1));
        stats.sprays++; stats.triangles += 20;
        stats.maxFootprintRadius = Math.max(stats.maxFootprintRadius, checked.radius);
        stats.minGroundClearance = Math.min(stats.minGroundClearance, checked.groundClearance);
        bounds.union(checked.box);
      }
    }
  });
  function batch(g, rows, name) {
    if (!rows.length) { g.dispose(); return; }
    const material = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });
    // Instance colors work without vertexColors. No missing black color attribute.
    const mesh = new THREE.InstancedMesh(g, material, rows.length); mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.userData.foliageSources = rows.map(r => r.source);
    rows.forEach((r, i) => { mesh.setMatrixAt(i, r.matrix); mesh.setColorAt(i, r.color); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.setUsage(THREE.StaticDrawUsage); mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
  }
  batch(leaves, leafRows, 'hinterland-foliage-leaves');
  batch(twigs, twigRows, 'hinterland-foliage-twigs');
  stats.leaves = leafRows.length; stats.twigs = twigRows.length;
  return { group, getStats: () => ({ ...stats,
    minGroundClearance: Number.isFinite(stats.minGroundClearance) ? stats.minGroundClearance : null,
    bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() } }) };
}
