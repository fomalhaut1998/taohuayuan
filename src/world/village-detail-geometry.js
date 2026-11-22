import * as THREE from 'three';

// Small untextured parts, always baked into the caller's existing material batches.
function facesGeometry(points, faces) {
  const positions = [];
  for (const face of faces) for (let k = 1; k < face.length - 1; k++) {
    for (const index of [face[0], face[k], face[k + 1]]) positions.push(...points[index]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// A real annular masonry block: unlike a tangent box it leaves a continuous hollow.
export function wellBlockGeometry(a0, a1, inner = 0.43, outer = 0.67) {
  const point = (radius, y, a) => [Math.cos(a) * radius, y, Math.sin(a) * radius];
  const points = [];
  for (const y of [0, 1]) for (const radius of [outer, inner]) {
    points.push(point(radius, y, a0), point(radius, y, a1));
  }
  return facesGeometry(points, [[0,4,5,1],[2,3,7,6],[4,6,7,5],[0,1,3,2],[0,2,6,4],[1,5,7,3]]);
}

// Closed two-pitch roof, with an actual ridge instead of a conical lid.
export function coopRoofGeometry() {
  const points = [];
  for (const z of [-0.55, 0.55]) {
    points.push([-0.685,0,z],[0,0.35,z],[0.685,0,z],[-0.685,-0.055,z],[0,0.295,z],[0.685,-0.055,z]);
  }
  return facesGeometry(points, [[0,6,7,1],[1,7,8,2],[3,4,10,9],[4,5,11,10],
    [0,3,9,6],[2,8,11,5],[0,1,4,3],[1,2,5,4],[6,9,10,7],[7,10,11,8]]);
}

export function grainKernelGeometry() {
  return facesGeometry([[0,0.5,0],[0.5,0,0],[0,0,0.5],[-0.5,0,0],[0,0,-0.5],[0,-0.5,0]],
    [[0,2,1],[0,3,2],[0,4,3],[0,1,4],[5,1,2],[5,2,3],[5,3,4],[5,4,1]]);
}

// Audit the geometry actually emitted, not a declaration that could drift from it.
// Ranges let regressions independently inspect containment, door clearance and colour.
export function recordVillageDetail(records, sinks, active, category, build) {
  const starts = Object.fromEntries(Object.entries(sinks).map(([name, sink]) => [name, sink.position.length / 3]));
  build();
  const ranges = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0, radius = 0;
  const ca = Math.cos(active.rot), sa = Math.sin(active.rot);
  for (const [batch, sink] of Object.entries(sinks)) {
    const start = starts[batch], count = sink.position.length / 3 - start;
    if (!count) continue;
    ranges.push({batch, start, count}); triangles += count / 3;
    for (let i = start * 3; i < sink.position.length; i += 3) {
      const dx = sink.position[i] - active.x, dz = sink.position[i + 2] - active.z;
      const point = [dx * ca - dz * sa, sink.position[i + 1], dx * sa + dz * ca];
      radius = Math.max(radius, Math.hypot(dx, dz));
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]);
      }
    }
  }
  records.push({source: active.id, category, triangles, radius, bounds: {min, max}, ranges});
}
