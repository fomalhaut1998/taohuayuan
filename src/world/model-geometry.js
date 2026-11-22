import * as THREE from 'three';

// Shared local geometry only: no placement RNG, textures, objects or draw calls.
// Profiles travel from the outside bottom up over the lip and down the inside.
// This gives vessels a real annular rim and inward-facing cavity, not a dark lid.
export function revolvedGeometry(profile, sides = 10, shade = 0) {
  const pos = [], col = [];
  const tri = (a, b, c, s) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) col.push(s, s, s);
  };
  const point = (p, a) => [Math.cos(a) * p[0], p[1], Math.sin(a) * p[0]];
  for (let i = 0; i < profile.length - 1; i++) {
    const p = profile[i], q = profile[i + 1];
    for (let j = 0; j < sides; j++) {
      const a = j * Math.PI * 2 / sides, b = (j + 1) * Math.PI * 2 / sides;
      const s = 1 - shade * (0.5 + 0.5 * Math.sin(j * 2.4 + i * 0.7));
      if (q[0] > 0) tri(point(p, a), point(q, a), point(q, b), s);
      if (p[0] > 0) tri(point(p, a), point(q, b), point(p, b), s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

export function openVesselGeometry(kind = 'vat') {
  const profiles = {
    vat: [[0, 0], [0.32, 0], [0.46, 0.16], [0.5, 0.54], [0.43, 0.88],
      [0.44, 0.97], [0.42, 1], [0.36, 1], [0.35, 0.88], [0.41, 0.52], [0.3, 0.12], [0, 0.12]],
    basket: [[0, 0], [0.3, 0], [0.4, 0.28], [0.49, 0.88], [0.5, 0.96],
      [0.48, 1], [0.43, 1], [0.42, 0.88], [0.33, 0.2], [0, 0.2]],
    bucket: [[0, 0], [0.37, 0], [0.49, 0.94], [0.5, 1], [0.43, 1],
      [0.42, 0.91], [0.31, 0.14], [0, 0.14]]
  };
  return revolvedGeometry(profiles[kind], kind === 'bucket' ? 8 : 10, kind === 'vat' ? 0.035 : 0.07);
}

// One flattened, planted stone at the same twenty-face cost as the old ico.
// The broad planar underside can be sunk slightly into existing terrain.
export function stoneGeometry(seed = 431) {
  const g = new THREE.IcosahedronGeometry(0.5, 0), p = g.attributes.position, col = [];
  const phase = (seed >>> 0) * 0.017;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x * (0.94 + 0.035 * Math.sin(z * 9 + phase)),
      y < -0.1 ? -0.38 : y * 0.83 + x * 0.055, z * (0.93 + 0.04 * Math.cos(x * 8 + phase)));
    const s = y < -0.1 ? 0.89 : 0.98 + y * 0.06;
    col.push(s, s, s);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}

// Replaces a closed twelve-sided disk (48 triangles) with an eight-sided ring
// (also 48 triangles), retaining the exact outer radius and height.
export function wellRimGeometry() {
  return revolvedGeometry([[0.5, -0.5], [0.5, 0.5], [0.35, 0.5], [0.35, -0.5]], 8, 0.035);
}

export function hayGeometry() {
  // Sculpted tiered-cap Chinese straw rick (束腰披笠草垛): flared straw skirt, cinched hemp waist,
  // overhanging thatched rain-cap eave & tied topknot finial — exact 120 tris, min.y=0, max.y=1.
  const profile = [
    [0, 0, 0.88],
    [0.45, 0, 0.90],
    [0.48, 0.28, 0.98],
    [0.37, 0.55, 0.78],
    [0.50, 0.61, 0.84],
    [0.27, 0.85, 1.07],
    [0.065, 0.94, 0.80],
    [0, 1, 1.04]
  ];
  const sides = 10, pos = [], col = [];
  const tri = (a, b, c, s) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) col.push(s, s, s);
  };
  const pt = (p, a) => [Math.cos(a) * p[0], p[1], Math.sin(a) * p[0]];
  for (let i = 0; i < profile.length - 1; i++) {
    const p = profile[i], q = profile[i + 1];
    const bandShade = (p[2] + q[2]) * 0.5;
    for (let j = 0; j < sides; j++) {
      const a = j * Math.PI * 2 / sides, b = (j + 1) * Math.PI * 2 / sides;
      const s = bandShade * (1 - 0.08 * (0.5 + 0.5 * Math.sin(j * 2.4 + i * 0.9)));
      if (q[0] > 0) tri(pt(p, a), pt(q, a), pt(q, b), s);
      if (p[0] > 0) tri(pt(p, a), pt(q, b), pt(p, b), s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// Forty-eight small facets per shared leaf mass, rather than twenty enormous
// triangular spikes. Three uneven lobes and an offset crown avoid perfect balls.
// Every vertex stays in the original radius: model refinement cannot widen trees.
export function foliageGeometry(seed, radius = 0.5, shade = [0.9, 1.06]) {
  const phase = ((seed >>> 0) % 997) / 997 * Math.PI * 2;
  const rings = [[0, -0.72], [0.77, -0.48], [1, 0.04], [0.68, 0.62], [0, 0.91]];
  const pos = [], col = [], sides = 8;
  const point = (i, j) => {
    const [r, y] = rings[i], a = j * Math.PI * 2 / sides;
    const lobe = 0.89 + 0.065 * Math.sin(a * 3 + phase) + 0.035 * Math.cos(a * 2 - phase);
    return [radius * (Math.cos(a) * r * lobe + y * 0.035),
      radius * (y + (r ? 0.065 * Math.sin(a * 2 + phase) : 0)),
      radius * (Math.sin(a) * r * lobe - y * 0.025)];
  };
  const tri = (a, b, c, j, i) => {
    pos.push(...a, ...b, ...c);
    // Small coherent tone changes, never the random dark/light gemstone mosaic.
    const lo = Math.max(0.9, shade[0]), hi = Math.min(1.07, shade[1]);
    const s = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(j * 1.7 + i * 0.65 + phase));
    for (let k = 0; k < 3; k++) col.push(s, s, s);
  };
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
    if (rings[i + 1][0]) tri(point(i, j), point(i + 1, j), point(i + 1, j + 1), j, i);
    if (rings[i][0]) tri(point(i, j), point(i + 1, j + 1), point(i, j + 1), j, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}
