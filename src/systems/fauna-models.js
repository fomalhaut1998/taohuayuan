import * as THREE from 'three';

// Model-space proportions, not world placement. +Z is the direction of travel.
// Closed, eight-sided section lofts give shoulders, tucked waists and hocks a
// deliberate silhouette without either subdivided spheres or stacked boxes.
const INK = '#262626';
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const still = { channel: 0, pivot: [0, 0, 0], axis: X, amplitude: 0, offset: 0 };
const joint = (channel, pivot, axis, amplitude = 1, offset = 0) => ({ channel, pivot, axis, amplitude, offset });

function skin(rings, sides = 8) {
  const vertices = [], indices = [];
  for (const ring of rings) for (let j = 0; j < sides; j++) {
    const a = j / sides * Math.PI * 2;
    const q = new THREE.Vector3(Math.cos(a) * ring.rx, Math.sin(a) * ring.ry, 0);
    if (ring.rotation) q.applyQuaternion(ring.rotation);
    q.add(ring.center);
    vertices.push(q.x, q.y, q.z);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    const c = a + sides, d = b + sides;
    indices.push(a, b, c, b, d, c);
  }
  for (const [r, end] of [[0, false], [rings.length - 1, true]]) {
    const n = vertices.length / 3, p = rings[r].center;
    vertices.push(p.x, p.y, p.z);
    for (let j = 0; j < sides; j++) {
      const a = r * sides + j, b = r * sides + (j + 1) % sides;
      indices.push(n, end ? a : b, end ? b : a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  return g;
}

function loft(sections, sides = 8) {
  return skin(sections.map(([z, y, rx, ry, x = 0]) => ({ center: new THREE.Vector3(x, y, z), rx, ry })), sides);
}

function sweep(points, sides = 6) {
  const centers = points.map(p => new THREE.Vector3(...p.slice(0, 3)));
  return skin(points.map((p, i) => {
    const direction = centers[Math.min(i + 1, centers.length - 1)].clone().sub(centers[Math.max(0, i - 1)]).normalize();
    return { center: centers[i], rx: p[3], ry: p[4] ?? p[3], rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction) };
  }), sides);
}

function ellipsoid(center, scale) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(...scale); g.translate(...center);
  return g;
}

// A thick four-point wedge; mirrored ears and feather tips remain closed solids.
function wedge(points) {
  const center = new THREE.Vector3();
  const p = points.map(v => new THREE.Vector3(...v));
  for (const v of p) center.add(v); center.multiplyScalar(0.25);
  const positions = [];
  for (const ids of [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]) {
    let [a, b, c] = ids.map(i => p[i]);
    if (b.clone().sub(a).cross(c.clone().sub(a)).dot(a.clone().sub(center)) < 0) [b, c] = [c, b];
    for (const v of [a, b, c]) positions.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); return g;
}

function builder(kind, baseY = 0) {
  const parts = [];
  const add = (geo, color, motion = still) => parts.push({ geo, color, motion });
  function finish() {
    const arrays = { position: [], normal: [], color: [], faunaPivot: [], faunaAxis: [], faunaMotion: [] };
    const ranges = [];
    let radius = 0;
    for (const { geo, color, motion } of parts) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      g.computeVertexNormals();
      const p = g.attributes.position, n = g.attributes.normal, c = new THREE.Color(color);
      const start = arrays.position.length / 3;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i), pivot = new THREE.Vector3(...motion.pivot);
        v.y += baseY; pivot.y += baseY;
        // This analytic sphere contains EVERY rigid part rotation, not just a
        // sampled pose. A little larger than a rest-pose box, but never clips a wing.
        radius = Math.max(radius, pivot.length() + v.distanceTo(pivot));
        arrays.position.push(v.x, v.y, v.z);
        arrays.normal.push(n.getX(i), n.getY(i), n.getZ(i));
        const tone = 0.96 + 0.04 * Math.max(0, n.getY(i));
        arrays.color.push(c.r * tone, c.g * tone, c.b * tone);
        arrays.faunaPivot.push(pivot.x, pivot.y, pivot.z); arrays.faunaAxis.push(...motion.axis);
        arrays.faunaMotion.push(motion.channel, motion.amplitude, motion.offset);
      }
      ranges.push({ channel: motion.channel, start, count: p.count });
      if (g !== geo) g.dispose(); geo.dispose();
    }
    const g = new THREE.BufferGeometry();
    for (const [name, values] of Object.entries(arrays)) g.setAttribute(name, new THREE.Float32BufferAttribute(values, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-radius, -radius, -radius), new THREE.Vector3(radius, radius, radius));
    g.userData = { kind, parts: ranges, animationRadius: radius, triangles: arrays.position.length / 9 };
    return g;
  }
  return { add, finish };
}

function chicken(cfg) {
  const { add, finish } = builder('chicken');
  add(loft([[-0.3,0.39,0.04,0.08],[-0.16,0.36,0.2,0.19],[0.08,0.36,0.22,0.21],[0.23,0.4,0.12,0.14]]), cfg.body);
  const head = joint(1, [0,0.39,0.14], X);
  add(sweep([[0,0.4,0.14,0.1],[0,0.55,0.23,0.08],[0,0.59,0.26,0.07]]), cfg.body, head);
  add(ellipsoid([0,0.6,0.27],[0.105,0.115,0.11]), cfg.body, head);
  add(sweep([[0,0.59,0.34,0.04],[0,0.575,0.46,0.003]],4), cfg.beak, head);
  // Three separate serrations read as a comb instead of a red cuboid.
  for (let i=0;i<3;i++) add(ellipsoid([0,0.71 + (i===1 ? 0.018 : 0),0.22+i*0.047],[0.026,0.057,0.043]),cfg.comb,head);
  add(ellipsoid([0,0.505,0.34],[0.035,0.055,0.027]),cfg.comb,head);
  for (const s of [-1,1]) {
    add(ellipsoid([s*0.09,0.625,0.313],[0.016,0.018,0.019]), INK, head);
    add(ellipsoid([s*0.183,0.39,-0.02],[0.055,0.13,0.22]), new THREE.Color(cfg.body).multiplyScalar(0.86), joint(4,[s*0.16,0.43,0.08],Z,s));
    const leg = joint(3,[s*0.085,0.23,0.04],X,0.30,s>0 ? Math.PI : 0);
    add(sweep([[s*0.085,0.25,0.04,0.026],[s*0.085,0.068,0.016,0.018]]),cfg.beak,leg);
    for (const toe of [-1,0,1]) add(sweep([[s*0.085,0.038,0.012,0.012],[s*0.085+toe*0.034,0.028,0.102,0.006]],4),cfg.beak,leg);
    add(sweep([[s*0.085,0.038,0.010,0.010],[s*0.085,0.028,-0.038,0.005]],4),cfg.beak,leg);
    add(wedge([[s*0.05,0.4,-0.2],[s*0.17,0.58,-0.42],[s*0.065,0.67,-0.38],[0,0.45,-0.23]]),cfg.body);
  }
  return finish();
}

function dog(cfg) {
  const { add, finish } = builder('dog');
  add(loft([[-0.34,0.46,0.065,0.1],[-0.23,0.46,0.145,0.16],[-0.01,0.48,0.12,0.13],[0.2,0.46,0.17,0.2],[0.31,0.5,0.09,0.14]]),cfg.body);
  add(sweep([[0,0.48,0.22,0.115],[0,0.63,0.32,0.105],[0,0.67,0.36,0.085]]),cfg.body);
  const head=joint(1,[0,0.57,0.29],X,0.5);
  add(loft([[0.27,0.67,0.07,0.07],[0.35,0.67,0.12,0.12],[0.46,0.65,0.1,0.09],[0.51,0.62,0.06,0.055]]),cfg.body,head);
  add(loft([[0.46,0.615,0.075,0.055],[0.6,0.6,0.062,0.04],[0.65,0.605,0.042,0.03]],6),cfg.belly,head);
  add(ellipsoid([0,0.615,0.65],[0.045,0.028,0.022]),INK,head);
  for(const s of [-1,1]) {
    add(wedge([[s*0.05,0.73,0.32],[s*0.14,0.73,0.34],[s*0.115,0.87,0.31],[s*0.08,0.74,0.41]]),cfg.body,head);
    add(wedge([[s*0.073,0.75,0.35],[s*0.122,0.75,0.352],[s*0.108,0.835,0.326],[s*0.095,0.758,0.36]]),cfg.belly,head);
    add(ellipsoid([s*0.086,0.684,0.452],[0.013,0.015,0.013]),INK,head);
    for(const t of [-1,1]) {
      const z=t*0.22, leg=joint(3,[s*0.115,0.43,z],X,0.34,s*t>0 ? Math.PI : 0);
      add(sweep([[s*0.115,0.44,z,0.065],[s*0.13,0.26,z-(t<0?0.065:0),0.041],[s*0.13,0.078,z+0.008,0.027]],5),cfg.body,leg);
      add(ellipsoid([s*0.13,0.052,z+0.038],[0.044,0.034,0.068]),cfg.belly,leg);
    }
  }
  add(sweep([[0,0.53,-0.28,0.047],[0,0.66,-0.43,0.042],[0,0.77,-0.44,0.03],[0,0.8,-0.33,0.009]],6),cfg.body,joint(2,[0,0.53,-0.28],Y,0.5));
  return finish();
}

function bird(cfg) {
  // Ground the toes rather than leaving the entire sparrow hovering at rest.
  const { add, finish } = builder('bird', -0.22);
  add(loft([[-0.23,0.39,0.025,0.05],[-0.08,0.41,0.13,0.12],[0.08,0.44,0.13,0.135],[0.19,0.48,0.065,0.07]]),cfg.body);
  add(ellipsoid([0,0.55,0.17],[0.095,0.1,0.095]),cfg.body);
  add(ellipsoid([0,0.425,0.115],[0.095,0.1,0.08]),new THREE.Color(cfg.body).lerp(new THREE.Color('#F2EAD9'),0.35));
  add(sweep([[0,0.54,0.24,0.028],[0,0.535,0.34,0.003]],4),cfg.beak);
  for(const s of [-1,1]) {
    add(ellipsoid([s*0.079,0.57,0.213],[0.014,0.016,0.015]),INK);
    const wing=joint(4,[s*0.1,0.47,0.06],Z,s);
    // Spread tapered feather blades, with their roots hidden inside the shoulder.
    add(wedge([[s*0.1,0.47,0.1],[s*0.37,0.43,-0.08],[s*0.3,0.44,-0.26],[s*0.1,0.43,-0.15]]),cfg.wing,wing);
    for(let i=0;i<3;i++) add(wedge([[s*(0.18+i*0.04),0.445,-0.08-i*0.028],[s*(0.29+i*0.035),0.43,-0.2-i*0.04],[s*(0.23+i*0.025),0.435,-0.24-i*0.035],[s*(0.18+i*0.04),0.46,-0.1-i*0.028]]),cfg.wing,wing);
    add(wedge([[s*0.03,0.43,-0.13],[s*0.1,0.44,-0.4],[s*0.01,0.43,-0.35],[0,0.45,-0.19]]),cfg.wing);
    add(sweep([[s*0.05,0.32,0.03,0.013],[s*0.05,0.242,0.01,0.009],[s*0.05,0.240,0.078,0.005]],4),cfg.beak,joint(3,[s*0.05,0.33,0.03],X,0.16,s>0?Math.PI:0));
  }
  return finish();
}

function ox(cfg) {
  const { add, finish } = builder('ox');
  const coat = new THREE.Color(cfg.body);
  const darkCoat = coat.clone().multiplyScalar(0.86);
  const lightBelly = coat.clone().lerp(new THREE.Color(cfg.muzzle), 0.58);
  const innerEar = coat.clone().lerp(new THREE.Color(cfg.muzzle), 0.45);
  // Anatomical 8-section torso: rounded rump -> broad hips -> tucked loin -> deep barrel -> high withers hump -> deep brisket.
  add(loft([
    [-0.60, 0.72, 0.11, 0.14],
    [-0.46, 0.73, 0.27, 0.25],
    [-0.24, 0.72, 0.30, 0.27],
    [-0.04, 0.70, 0.28, 0.26],
    [0.16, 0.71, 0.32, 0.30],
    [0.34, 0.77, 0.29, 0.32],
    [0.48, 0.74, 0.22, 0.26],
    [0.57, 0.68, 0.12, 0.16]
  ], 8), cfg.body);
  // Thoracic shoulder hump (鬐甲肩峰) & hanging brisket dewlap (胸垂) — signature Chinese draft-ox silhouette.
  add(loft([
    [0.16, 0.95, 0.11, 0.08],
    [0.33, 1.03, 0.14, 0.12],
    [0.47, 0.96, 0.10, 0.08]
  ], 6), darkCoat);
  add(loft([
    [0.18, 0.56, 0.038, 0.08],
    [0.36, 0.51, 0.048, 0.12],
    [0.54, 0.56, 0.036, 0.09]
  ], 6), lightBelly);
  const head = joint(1, [0, 0.75, 0.42], X);
  // Muscular lowered draft neck + soft throat dewlap fold.
  add(sweep([[0, 0.74, 0.40, 0.20, 0.22], [0, 0.78, 0.55, 0.17, 0.19], [0, 0.80, 0.67, 0.135, 0.15]], 8), cfg.body, head);
  add(loft([[0.44, 0.61, 0.038, 0.085], [0.58, 0.64, 0.042, 0.095], [0.70, 0.69, 0.030, 0.07]], 6), lightBelly, head);
  // Broad frontal poll, prominent brow, sculpted cheeks & low broad bovine muzzle.
  add(loft([
    [0.60, 0.86, 0.13, 0.11],
    [0.70, 0.85, 0.185, 0.155],
    [0.82, 0.77, 0.135, 0.125],
    [0.92, 0.70, 0.125, 0.095]
  ], 8), cfg.body, head);
  add(loft([
    [0.86, 0.69, 0.115, 0.082],
    [0.96, 0.675, 0.148, 0.092],
    [1.02, 0.68, 0.118, 0.068]
  ], 8), cfg.muzzle, head);
  for (const s of [-1, 1]) {
    // Smooth lofted lateral shoulder scapula & pelvic haunch muscles so legs blend into torso.
    add(loft([
      [0.24, 0.68, 0.065, 0.12, s * 0.20],
      [0.36, 0.67, 0.098, 0.16, s * 0.22],
      [0.47, 0.67, 0.065, 0.12, s * 0.19]
    ], 6), darkCoat);
    add(loft([
      [-0.50, 0.70, 0.075, 0.13, s * 0.20],
      [-0.38, 0.69, 0.105, 0.17, s * 0.22],
      [-0.25, 0.69, 0.075, 0.13, s * 0.20]
    ], 6), darkCoat);
    // Outward-sweeping, gracefully curved bovine horns + rooted leaf ears.
    add(sweep([
      [s * 0.135, 0.92, 0.67, 0.056, 0.046],
      [s * 0.275, 0.95, 0.62, 0.044, 0.038],
      [s * 0.375, 1.03, 0.60, 0.031, 0.028],
      [s * 0.385, 1.125, 0.64, 0.018, 0.017],
      [s * 0.335, 1.185, 0.69, 0.006, 0.006]
    ], 6), cfg.horn, head);
    add(wedge([
      [s * 0.135, 0.855, 0.66],
      [s * 0.34, 0.84, 0.61],
      [s * 0.28, 0.775, 0.69],
      [s * 0.155, 0.805, 0.70]
    ]), innerEar, head);
    add(ellipsoid([s * 0.168, 0.835, 0.748], [0.021, 0.023, 0.023]), INK, head);
    add(ellipsoid([s * 0.072, 0.70, 0.998], [0.026, 0.019, 0.014]), INK, head);
    // Foreleg (with carpal knee) & Hindleg (with backward-angled hock) + split cloven hooves.
    for (const t of [-1, 1]) {
      const z = t > 0 ? 0.36 : -0.39;
      const lx = s * (t > 0 ? 0.205 : 0.215);
      const leg = joint(3, [lx, 0.58, z], X, 0.20, s * t > 0 ? Math.PI : 0);
      const midZ = t > 0 ? z + 0.018 : z - 0.068;
      const footZ = t > 0 ? z + 0.012 : z - 0.015;
      add(sweep([
        [lx, 0.61, z, 0.096, 0.112],
        [lx, 0.33, midZ, 0.056, 0.062],
        [lx, 0.092, footZ, 0.042, 0.045]
      ], 6), cfg.body, leg);
      for (const toe of [-1, 1]) {
        const tx = lx + toe * 0.024;
        add(loft([
          [footZ - 0.038, 0.058, 0.023, 0.042, tx],
          [footZ + 0.052, 0.046, 0.026, 0.034, tx]
        ], 5), cfg.hoof, leg);
      }
    }
  }
  const tail = joint(2, [0, 0.79, -0.54], Y, 0.5);
  add(sweep([[0, 0.79, -0.54, 0.032], [0.03, 0.56, -0.66, 0.023], [0.05, 0.31, -0.67, 0.016]], 5), cfg.body, tail);
  add(ellipsoid([0.05, 0.25, -0.67], [0.046, 0.095, 0.042]), cfg.hoof, tail);
  return finish();
}

function duck(cfg) {
  const { add, finish } = builder('duck');
  add(loft([[-0.36,0.28,0.025,0.045],[-0.19,0.23,0.19,0.12],[0.05,0.22,0.22,0.16],[0.22,0.25,0.14,0.14],[0.29,0.28,0.055,0.06]]),cfg.body);
  const head=joint(1,[0,0.3,0.19],X,0.5);
  add(sweep([[0,0.27,0.18,0.11],[0,0.42,0.2,0.07],[0,0.51,0.26,0.075]],7),cfg.head,head);
  add(ellipsoid([0,0.535,0.27],[0.105,0.105,0.12]),cfg.head,head);
  // A broad, flattened bill (not the conical beak of chicken/sparrow).
  add(loft([[0.34,0.51,0.053,0.027],[0.43,0.505,0.073,0.022],[0.48,0.502,0.05,0.015]],6),cfg.beak,head);
  for(const s of [-1,1]) {
    add(ellipsoid([s*0.083,0.557,0.319],[0.015,0.017,0.016]),INK,head);
    add(ellipsoid([s*0.175,0.28,-0.035],[0.05,0.085,0.23]),new THREE.Color(cfg.body).multiplyScalar(0.9));
    const foot=joint(5,[s*0.1,0.14,-0.02],X,0.36,s>0?Math.PI:0);
    add(sweep([[s*0.1,0.16,-0.02,0.018],[s*0.1,0.060,-0.045,0.012]],5),cfg.beak,foot);
    add(wedge([[s*0.1,0.042,-0.06],[s*0.16,0.034,0.075],[s*0.035,0.034,0.075],[s*0.1,0.062,0.022]]),cfg.beak,foot);
  }
  add(wedge([[-0.075,0.28,-0.21],[0,0.4,-0.4],[0.075,0.28,-0.21],[0,0.31,-0.16]]),cfg.body);
  return finish();
}

export function createFaunaModels(cfg) {
  return { chicken: chicken(cfg.chickens), dog: dog(cfg.dogs), bird: bird(cfg.birds), ox: ox(cfg.oxen), duck: duck(cfg.ducks) };
}
