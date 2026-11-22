import * as THREE from 'three';

const TAU = Math.PI * 2;
const INK = '#23201E';

function skin(rings, sides = 8, bandColors = null, caps = true, bellyColor = null) {
  const pos = [];
  const vertShadeY = [];
  for (const ring of rings) {
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU;
      const sy = Math.sin(a);
      const q = new THREE.Vector3(Math.cos(a) * ring.rx, sy * ring.ry, 0);
      if (ring.rotation) q.applyQuaternion(ring.rotation);
      q.add(ring.center);
      pos.push(q.x, q.y, q.z);
      vertShadeY.push(sy);
    }
  }
  const positions = [];
  const colors = (bandColors || bellyColor) ? [] : null;
  const bellyCol = bellyColor ? new THREE.Color(bellyColor) : null;
  const tmpCol = new THREE.Color();
  const pushTri = (i0, i1, i2, col) => {
    positions.push(
      pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2],
      pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2],
      pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2]
    );
    if (colors && col) {
      for (const idx of [i0, i1, i2]) {
        if (bellyCol) {
          const sy = vertShadeY[idx] ?? 0;
          const bellyBlend = Math.max(0, Math.min(1, (-sy + 0.15) * 0.85));
          tmpCol.copy(col).lerp(bellyCol, bellyBlend);
          colors.push(tmpCol.r, tmpCol.g, tmpCol.b);
        } else {
          colors.push(col.r, col.g, col.b);
        }
      }
    }
  };

  for (let i = 0; i < rings.length - 1; i++) {
    const col = bandColors ? new THREE.Color(bandColors[i % bandColors.length]) : new THREE.Color('#FFFFFF');
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      pushTri(a, b, c, col);
      pushTri(b, d, c, col);
    }
  }
  if (caps) {
    for (const [r, end] of [[0, false], [rings.length - 1, true]]) {
      const cIdx = pos.length / 3;
      const p = rings[r].center;
      pos.push(p.x, p.y, p.z);
      vertShadeY.push(0);
      const col = bandColors
        ? new THREE.Color(bandColors[end ? Math.min(bandColors.length - 1, Math.max(0, r - 1)) : 0])
        : new THREE.Color('#FFFFFF');
      for (let j = 0; j < sides; j++) {
        const a = r * sides + j;
        const b = r * sides + ((j + 1) % sides);
        pushTri(cIdx, end ? a : b, end ? b : a, col);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

export function loft(sections, sides = 8, bandColors = null, caps = true, bellyColor = null) {
  return skin(
    sections.map(([z, y, rx, ry, x = 0]) => ({
      center: new THREE.Vector3(x, y, z),
      rx,
      ry
    })),
    sides,
    bandColors,
    caps,
    bellyColor
  );
}

export function sweep(points, sides = 6, bandColors = null, caps = true) {
  const centers = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const zAxis = new THREE.Vector3(0, 0, 1);
  return skin(
    points.map((p, i) => {
      const prev = centers[Math.max(0, i - 1)];
      const next = centers[Math.min(centers.length - 1, i + 1)];
      const dir = next.clone().sub(prev);
      if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
      else dir.normalize();
      return {
        center: centers[i],
        rx: p[3],
        ry: p[4] ?? p[3],
        rotation: new THREE.Quaternion().setFromUnitVectors(zAxis, dir)
      };
    }),
    sides,
    bandColors,
    caps
  );
}

export function ellipsoid(center, scale, detail = 0) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.scale(scale[0], scale[1], scale[2]);
  g.translate(center[0], center[1], center[2]);
  return g;
}

export function octa(center, scale) {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(scale[0], scale[1], scale[2]);
  g.translate(center[0], center[1], center[2]);
  return g;
}

export function wedge(points) {
  const center = new THREE.Vector3();
  const pts = points.map(v => new THREE.Vector3(v[0], v[1], v[2]));
  for (const v of pts) center.add(v);
  center.multiplyScalar(0.25);
  const positions = [];
  for (const ids of [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]) {
    let [a, b, c] = ids.map(i => pts[i]);
    if (b.clone().sub(a).cross(c.clone().sub(a)).dot(a.clone().sub(center)) < 0) {
      [b, c] = [c, b];
    }
    for (const v of [a, b, c]) positions.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

export function createPartBuilder(origin = [0, 0, 0]) {
  const parts = [];
  const ox = origin[0], oy = origin[1], oz = origin[2];

  const add = (geo, color = null) => parts.push({ geo, color });

  function finish(name) {
    const positions = [];
    const normals = [];
    const colors = [];
    const fallbackColor = new THREE.Color('#FFFFFF');
    for (const { geo, color } of parts) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      g.computeVertexNormals();
      const p = g.attributes.position;
      const n = g.attributes.normal;
      const vc = g.attributes.color;
      const fixedCol = color ? new THREE.Color(color) : fallbackColor;
      for (let i = 0; i < p.count; i++) {
        positions.push(p.getX(i) - ox, p.getY(i) - oy, p.getZ(i) - oz);
        const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
        normals.push(nx, ny, nz);
        const shade = 0.94 + 0.06 * Math.max(0, ny);
        if (vc) {
          colors.push(vc.getX(i) * shade, vc.getY(i) * shade, vc.getZ(i) * shade);
        } else {
          colors.push(fixedCol.r * shade, fixedCol.g * shade, fixedCol.b * shade);
        }
      }
      if (g !== geo) g.dispose();
      geo.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    out.computeBoundingBox();
    out.computeBoundingSphere();
    out.userData = { name, triangles: positions.length / 9 };
    return out;
  }

  return { add, finish };
}

/**
 * 芦花母鸡：丰满椭圆纵截面横斑躯干 + 叠层双翼 + 舒展尾羽 + 细腿四趾鸡爪，
 * 头部采用颈根枢轴独立几何以支持真实低头啄食与顾盼雏鸡动作。
 */
export function createBarredHenParts() {
  const BARRED = ['#524C44', '#DCD5C4', '#635B50', '#E4DEC9', '#5A5248', '#CFC7B5'];
  const LEG = '#D5A046';
  const COMB = '#B83A30';
  const BEAK = '#DF9E3C';

  // 1. Body (grounded at y = 0)
  const body = createPartBuilder([0, 0, 0]);
  body.add(loft([
    [-0.29, 0.34, 0.04, 0.06],
    [-0.17, 0.29, 0.18, 0.16],
    [0.01, 0.28, 0.21, 0.18],
    [0.16, 0.32, 0.15, 0.15],
    [0.25, 0.37, 0.08, 0.09]
  ], 5, BARRED));

  // Folded barred wing shields, shanks & claws
  for (const s of [-1, 1]) {
    body.add(loft([
      [-0.17, 0.31, 0.03, 0.05, s * 0.17],
      [0.0, 0.30, 0.065, 0.11, s * 0.195],
      [0.15, 0.34, 0.03, 0.055, s * 0.145]
    ], 4, ['#6A6258', '#DFD9C9'], false));

    body.add(sweep([
      [s * 0.078, 0.20, -0.01, 0.022],
      [s * 0.080, 0.024, -0.008, 0.013]
    ], 3, null, false), LEG);
    body.add(wedge([
      [s * 0.080 - 0.032, 0.014, 0.065],
      [s * 0.080 + 0.032, 0.014, 0.065],
      [s * 0.080, 0.024, -0.008],
      [s * 0.080, 0.014, -0.045]
    ]), LEG);
  }

  // Fanned barred tail feathers
  for (const [tx, ty, tz, col] of [
    [0, 0.50, -0.37, '#4B453E'],
    [-0.085, 0.46, -0.35, '#DFD8C6'],
    [0.085, 0.46, -0.35, '#DFD8C6']
  ]) {
    body.add(wedge([
      [tx * 0.35, 0.33, -0.22],
      [tx, ty, tz],
      [tx * 1.15, ty - 0.06, tz - 0.04],
      [0, 0.38, -0.25]
    ]), col);
  }
  const bodyGeo = body.finish('qh-hen-body');

  // 2. Neck & Head (local origin = neck root [0, 0.34, 0.14])
  const neckPivot = [0, 0.34, 0.14];
  const head = createPartBuilder(neckPivot);
  head.add(sweep([
    [0, 0.33, 0.14, 0.085],
    [0, 0.42, 0.18, 0.072],
    [0, 0.49, 0.21, 0.062]
  ], 5, ['#DCD4C2', '#645C52'], false));
  head.add(octa([0, 0.515, 0.22], [0.084, 0.086, 0.090]), '#B8AFA0');
  // Tapered beak
  head.add(wedge([
    [-0.024, 0.512, 0.285],
    [0.024, 0.512, 0.285],
    [0, 0.490, 0.388],
    [0, 0.486, 0.285]
  ]), BEAK);
  // Scalloped red comb (3 lobes)
  for (let i = 0; i < 3; i++) {
    const h = i === 1 ? 0.036 : 0.026;
    head.add(wedge([
      [-0.012, 0.575, 0.175 + i * 0.042],
      [0.012, 0.575, 0.175 + i * 0.042],
      [0, 0.585 + h, 0.195 + i * 0.042],
      [0, 0.575, 0.215 + i * 0.042]
    ]), COMB);
  }
  // Wattles & bright eyes
  for (const s of [-1, 1]) {
    head.add(wedge([
      [s * 0.012, 0.468, 0.265],
      [s * 0.035, 0.468, 0.285],
      [s * 0.024, 0.415, 0.275],
      [s * 0.018, 0.455, 0.295]
    ]), COMB);
    head.add(wedge([
      [s * 0.072, 0.535, 0.242],
      [s * 0.086, 0.535, 0.256],
      [s * 0.072, 0.548, 0.260],
      [s * 0.068, 0.522, 0.260]
    ]), INK);
  }
  const headGeo = head.finish('qh-hen-head');

  return { bodyGeo, headGeo, neckPivot };
}

/**
 * 毛茸茸小鸡仔（单批实例化几何）：圆润鹅黄绒球身、微仰小脑袋、橘黄小喙与细脚爪
 */
export function createFluffyChickGeometry() {
  const DOWN = ['#E8C55B', '#F4DF89'];
  const FOOT = '#DC8E34';
  const chick = createPartBuilder([0, 0, 0]);

  chick.add(loft([
    [-0.078, 0.105, 0.026, 0.028],
    [0.0, 0.098, 0.070, 0.066],
    [0.062, 0.115, 0.046, 0.048]
  ], 4, DOWN, false));

  chick.add(octa([0, 0.175, 0.055], [0.056, 0.054, 0.056]), '#F3DC80');
  chick.add(wedge([
    [-0.014, 0.176, 0.095],
    [0.014, 0.176, 0.095],
    [0, 0.168, 0.140],
    [0, 0.162, 0.095]
  ]), FOOT);
  chick.add(wedge([
    [-0.018, 0.12, -0.065],
    [0, 0.155, -0.115],
    [0.018, 0.12, -0.065],
    [0, 0.105, -0.05]
  ]), '#DFB84C');

  for (const s of [-1, 1]) {
    chick.add(wedge([
      [s * 0.052, 0.115, 0.025],
      [s * 0.078, 0.108, -0.032],
      [s * 0.052, 0.085, -0.025],
      [s * 0.042, 0.10, 0.0]
    ]), '#DFBA52');
    chick.add(wedge([
      [s * 0.028 - 0.008, 0.056, 0.0],
      [s * 0.028 + 0.008, 0.056, 0.0],
      [s * 0.028, 0.008, 0.036],
      [s * 0.028, 0.008, -0.008]
    ]), FOOT);
  }
  return chick.finish('qh-fluffy-chick');
}

/**
 * 柴垛大公鸡：昂首阔胸赤褐羽衣 + 金红蓑羽领 + 五道拱弯墨绿尾羽 + 高耸红冠
 */
export function createRoosterParts() {
  const PLUME = ['#582F22', '#9D462B', '#B85A34', '#D18236'];
  const HACKLE = '#D68937';
  const TAIL_DARK = '#1C312B';
  const TAIL_SHEEN = '#29493E';
  const COMB = '#C62F26';
  const LEG = '#C9953B';

  const body = createPartBuilder([0, 0, 0]);
  body.add(loft([
    [-0.28, 0.36, 0.04, 0.07],
    [-0.14, 0.32, 0.17, 0.16],
    [0.04, 0.33, 0.19, 0.19],
    [0.18, 0.39, 0.13, 0.15],
    [0.24, 0.44, 0.08, 0.10]
  ], 5, PLUME));

  // Sturdy legs & claws on torso; copper-bronze wings are articulated separately for pre-crow wing-flap
  for (const s of [-1, 1]) {
    body.add(sweep([
      [s * 0.078, 0.22, 0.01, 0.023],
      [s * 0.080, 0.024, 0.005, 0.014]
    ], 3, null, false), LEG);
    body.add(wedge([
      [s * 0.080 - 0.034, 0.014, 0.078],
      [s * 0.080 + 0.034, 0.014, 0.078],
      [s * 0.080, 0.024, 0.005],
      [s * 0.080, 0.014, -0.050]
    ]), LEG);
  }

  // Three sweeping arched sickle tail plumes + two dark side plumes
  const sickleSpecs = [
    [0, 0.40, -0.22, 0.030, -0.34, 0.64, -0.45, 0.42, TAIL_SHEEN],
    [-0.045, 0.39, -0.23, 0.024, -0.38, 0.58, -0.48, 0.38, TAIL_DARK],
    [0.045, 0.39, -0.23, 0.024, -0.38, 0.58, -0.48, 0.38, TAIL_DARK]
  ];
  for (const [sx, sy, sz, w, mz, py, ez, ey, col] of sickleSpecs) {
    body.add(sweep([
      [sx, sy, sz, w, w * 1.4],
      [sx * 1.3, py, mz, w * 0.9, w * 1.6],
      [sx * 1.6, ey, ez, 0.004, 0.010]
    ], 3, null, false), col);
  }
  for (const s of [-1, 1]) {
    body.add(wedge([
      [s * 0.06, 0.37, -0.22],
      [s * 0.14, 0.48, -0.40],
      [s * 0.15, 0.36, -0.43],
      [0, 0.40, -0.25]
    ]), TAIL_SHEEN);
  }
  const bodyGeo = body.finish('qh-rooster-body');

  // Rooster Neck & Head (pivot at chest shoulder)
  const neckPivot = [0, 0.41, 0.13];
  const head = createPartBuilder(neckPivot);
  head.add(sweep([
    [0, 0.40, 0.13, 0.10],
    [0, 0.52, 0.18, 0.082],
    [0, 0.61, 0.21, 0.065]
  ], 5, [PLUME[2], HACKLE], false));
  head.add(octa([0, 0.635, 0.22], [0.082, 0.086, 0.090]), HACKLE);
  head.add(wedge([
    [-0.026, 0.632, 0.285],
    [0.026, 0.632, 0.285],
    [0, 0.610, 0.395],
    [0, 0.602, 0.285]
  ]), LEG);

  // Tall 4-point crimson crown comb
  for (let i = 0; i < 4; i++) {
    const h = i === 1 || i === 2 ? 0.056 : 0.038;
    head.add(wedge([
      [-0.014, 0.70, 0.155 + i * 0.036],
      [0.014, 0.70, 0.155 + i * 0.036],
      [0, 0.70 + h, 0.172 + i * 0.036],
      [0, 0.70, 0.190 + i * 0.036]
    ]), COMB);
  }
  for (const s of [-1, 1]) {
    head.add(wedge([
      [s * 0.014, 0.58, 0.265],
      [s * 0.038, 0.58, 0.285],
      [s * 0.026, 0.52, 0.275],
      [s * 0.020, 0.56, 0.295]
    ]), COMB);
    head.add(wedge([
      [s * 0.070, 0.655, 0.242],
      [s * 0.084, 0.655, 0.256],
      [s * 0.070, 0.668, 0.260],
      [s * 0.066, 0.642, 0.260]
    ]), INK);
  }
  const headGeo = head.finish('qh-rooster-head');

  const buildWing = (s, name) => {
    const pivot = [s * 0.145, 0.40, 0.08];
    const w = createPartBuilder(pivot);
    w.add(loft([
      [-0.16, 0.35, 0.03, 0.05, s * 0.16],
      [-0.01, 0.35, 0.06, 0.10, s * 0.185],
      [0.12, 0.38, 0.045, 0.08, s * 0.16]
    ], 4, ['#6A2E1E', '#B85B33'], false));
    w.add(wedge([
      [s * 0.155, 0.375, -0.11],
      [s * 0.182, 0.335, -0.12],
      [s * 0.148, 0.305, -0.24],
      [s * 0.138, 0.355, -0.13]
    ]), '#4B2015');
    return { geo: w.finish(name), pivot };
  };
  const wingL = buildWing(-1, 'qh-rooster-wing-l');
  const wingR = buildWing(1, 'qh-rooster-wing-r');

  return {
    bodyGeo,
    headGeo,
    wingLGeo: wingL.geo,
    wingRGeo: wingR.geo,
    neckPivot,
    wingLPivot: wingL.pivot,
    wingRPivot: wingR.pivot
  };
}

/**
 * 池畔浸泥水牛（圆浑桶腹 + 高耸肩峰 + 湿泥浸染下腹 + 阔吻弯月双角 + 独立甩耳）
 */
export function createWaterBuffaloParts() {
  const HIDE = ['#4A4846', '#565451', '#5B5956', '#4E4C49'];
  const MUD_BELLY = '#322C26';
  const HORN = ['#292826', '#3A3732', '#242321'];
  const MUZZLE = '#35373A';

  // 1. Barrel torso + muscular shoulder hump + short wet tail
  const body = createPartBuilder([0, 0, 0]);
  body.add(loft([
    [-0.68, -0.02, 0.22, 0.20],
    [-0.36, 0.03, 0.39, 0.28],
    [0.02, 0.05, 0.42, 0.30],
    [0.34, 0.13, 0.34, 0.32],
    [0.58, 0.11, 0.21, 0.22]
  ], 5, HIDE, true, MUD_BELLY));
  body.add(sweep([
    [0, 0.06, -0.66, 0.036],
    [0, -0.08, -0.79, 0.018]
  ], 3, ['#3C3834'], false));
  const bodyGeo = body.finish('qh-buffalo-body');

  // 2. Broad tapered head + damp muzzle + sweeping crescent horns (pivot at neck root)
  const head = createPartBuilder([0, 0, 0]);
  head.add(loft([
    [-0.04, 0.04, 0.17, 0.15],
    [0.12, 0.03, 0.16, 0.14],
    [0.27, -0.02, 0.13, 0.10],
    [0.39, -0.05, 0.11, 0.085]
  ], 4, ['#4D4B48', '#454341', MUZZLE], true, '#2E2B28'));
  for (const s of [-1, 1]) {
    // Sweeping crescent horn (弯角): flares wide, sweeps back, curves inward & upward
    head.add(sweep([
      [s * 0.13, 0.09, 0.04, 0.052, 0.042],
      [s * 0.36, 0.14, -0.08, 0.030, 0.026],
      [s * 0.29, 0.25, -0.16, 0.008, 0.008]
    ], 3, HORN, false));
    head.add(wedge([
      [s * 0.14, 0.055, 0.14],
      [s * 0.165, 0.055, 0.16],
      [s * 0.145, 0.072, 0.165],
      [s * 0.14, 0.038, 0.165]
    ]), INK);
  }
  const headGeo = head.finish('qh-buffalo-head');

  // 3. Leaf-shaped flicking ears (left -X and right +X with outward winding)
  const earL = createPartBuilder([0, 0, 0]);
  earL.add(wedge([
    [0, 0.02, 0.03],
    [0, -0.02, -0.03],
    [-0.17, -0.01, -0.02],
    [-0.09, -0.035, 0.025]
  ]), '#47433F');
  const earLGeo = earL.finish('qh-buffalo-ear-l');

  const earR = createPartBuilder([0, 0, 0]);
  earR.add(wedge([
    [0, 0.02, 0.03],
    [0, -0.02, -0.03],
    [0.17, -0.01, -0.02],
    [0.09, -0.035, 0.025]
  ]), '#47433F');
  const earRGeo = earR.finish('qh-buffalo-ear-r');

  // 4. Sturdy mud-coated articulated legs + broad cloven hooves (hip/shoulder at [0,0,0], sole at y = -0.345)
  const leg = createPartBuilder([0, 0, 0]);
  leg.add(sweep([
    [0, 0.02, 0, 0.072, 0.082],
    [0, -0.16, -0.012, 0.048, 0.052],
    [0, -0.30, 0.006, 0.038, 0.040]
  ], 5, ['#484542', MUD_BELLY], false));
  for (const toe of [-1, 1]) {
    leg.add(wedge([
      [toe * 0.022 - 0.018, -0.295, -0.028],
      [toe * 0.022 + 0.018, -0.295, -0.028],
      [toe * 0.022, -0.345, 0.048],
      [toe * 0.022, -0.345, -0.032]
    ]), '#24211E');
  }
  const legGeo = leg.finish('qh-buffalo-leg');

  return { bodyGeo, headGeo, earLGeo, earRGeo, legGeo };
}

/**
 * 牛背白鹭（修长 S 形曲颈 + 垂羽水滴身 + 敛翼雪羽 + 尖黄长喙）
 */
export function createWhiteEgretParts() {
  const SNOW = ['#F7F5EE', '#ECE9DF', '#F4F2EA'];
  const LEG = '#C9963B';
  const BILL = '#DF952C';

  const body = createPartBuilder([0, 0, 0]);
  for (const s of [-1, 1]) {
    body.add(sweep([
      [s * 0.028, 0.16, -0.01, 0.011],
      [s * 0.026, 0.012, 0.005, 0.008]
    ], 3, null, false), LEG);
    body.add(wedge([
      [s * 0.026 - 0.022, 0.006, 0.045],
      [s * 0.026 + 0.022, 0.006, 0.045],
      [s * 0.026, 0.014, 0.002],
      [s * 0.026, 0.006, -0.025]
    ]), LEG);
  }
  // Teardrop plumed body + folded wings
  body.add(loft([
    [-0.17, 0.16, 0.018, 0.020],
    [-0.06, 0.19, 0.064, 0.058],
    [0.05, 0.21, 0.068, 0.064],
    [0.13, 0.22, 0.038, 0.042]
  ], 5, SNOW, false, '#E0DDD2'));
  for (const s of [-1, 1]) {
    body.add(wedge([
      [s * 0.058, 0.22, 0.08],
      [s * 0.075, 0.195, -0.05],
      [s * 0.022, 0.165, -0.15],
      [s * 0.040, 0.21, -0.02]
    ]), '#FAF9F4');
  }
  const bodyGeo = body.finish('qh-egret-body');

  // S-curved slender neck + plumed head + pointed yellow bill (pivot at [0, 0.22, 0.10])
  const neckHead = createPartBuilder([0, 0, 0]);
  neckHead.add(sweep([
    [0, -0.01, 0, 0.028],
    [0, 0.065, -0.026, 0.019],
    [0, 0.145, 0.012, 0.017],
    [0, 0.205, 0.042, 0.022]
  ], 4, SNOW, false));
  neckHead.add(octa([0, 0.215, 0.052], [0.028, 0.028, 0.036]), '#FAF8F2');
  // Delicate nape breeding plume
  neckHead.add(wedge([
    [-0.008, 0.225, 0.025],
    [0.008, 0.225, 0.025],
    [0, 0.205, -0.065],
    [0, 0.212, 0.020]
  ]), '#EFECE2');
  // Pointed yellow bill
  neckHead.add(wedge([
    [-0.011, 0.218, 0.080],
    [0.011, 0.218, 0.080],
    [0, 0.204, 0.205],
    [0, 0.202, 0.080]
  ]), BILL);
  const headGeo = neckHead.finish('qh-egret-head');

  return { bodyGeo, headGeo };
}

/**
 * 柴门大黄狗（中华田园黄犬：深胸收腰赭黄躯干 + 浅白胸腹 + 警觉立/折耳 + 上卷摇尾 + 四肢）
 */
export function createYellowDogParts() {
  const COAT = ['#BC8440', '#C9924C', '#C28A45'];
  const PALE_CHEST = '#E7D1A8';
  const EAR_COL = '#885A2C';
  const NOSE_COL = '#2A221D';

  const body = createPartBuilder([0, 0, 0]);
  body.add(loft([
    [-0.25, 0.02, 0.085, 0.088],
    [-0.08, 0.01, 0.095, 0.095],
    [0.10, 0.02, 0.118, 0.122],
    [0.24, 0.04, 0.092, 0.105]
  ], 5, COAT, true, PALE_CHEST));
  const bodyGeo = body.finish('qh-dog-body');

  const head = createPartBuilder([0, 0, 0]);
  head.add(octa([0, 0.03, 0.04], [0.088, 0.084, 0.092]), '#C68F4A');
  head.add(octa([0, -0.02, 0.02], [0.072, 0.056, 0.068]), PALE_CHEST);
  // Tapered snout & dark wet nose
  head.add(wedge([
    [-0.046, 0.028, 0.10],
    [0.046, 0.028, 0.10],
    [0, 0.008, 0.215],
    [0, -0.026, 0.105]
  ]), '#B47D3C');
  head.add(wedge([
    [-0.020, 0.020, 0.185],
    [0.020, 0.020, 0.185],
    [0, 0.016, 0.228],
    [0, -0.004, 0.192]
  ]), NOSE_COL);
  for (const s of [-1, 1]) {
    head.add(wedge([
      [s * 0.058, 0.048, 0.088],
      [s * 0.072, 0.048, 0.102],
      [s * 0.060, 0.060, 0.105],
      [s * 0.056, 0.036, 0.105]
    ]), INK);
  }
  const headGeo = head.finish('qh-dog-head');

  const ear = createPartBuilder([0, 0, 0]);
  ear.add(wedge([
    [-0.024, 0, 0.018],
    [0.024, 0, 0.018],
    [0, 0.105, -0.012],
    [0, 0.015, -0.024]
  ]), EAR_COL);
  const earGeo = ear.finish('qh-dog-ear');

  // Upward-curling sickle tail (金钱镰刀尾)
  const tail = createPartBuilder([0, 0, 0]);
  tail.add(sweep([
    [0, 0, 0, 0.030],
    [0, 0.10, -0.085, 0.025],
    [0, 0.20, -0.045, 0.015]
  ], 3, ['#BA8340', '#D9BE92'], false));
  tail.add(wedge([
    [-0.014, 0.19, -0.050],
    [0.014, 0.19, -0.050],
    [0, 0.235, -0.015],
    [0, 0.205, -0.062]
  ]), PALE_CHEST);
  const tailGeo = tail.finish('qh-dog-tail');

  // Articulated tapered leg + cream-tipped paw (hip/shoulder at [0,0,0], paw sole at y = -0.214)
  const leg = createPartBuilder([0, 0, 0]);
  leg.add(sweep([
    [0, 0.01, 0, 0.036],
    [0, -0.195, 0.006, 0.017]
  ], 4, ['#BE8744'], false));
  leg.add(octa([0, -0.198, 0.020], [0.024, 0.016, 0.034]), PALE_CHEST);
  const legGeo = leg.finish('qh-dog-leg');

  return { bodyGeo, headGeo, earGeo, tailGeo, legGeo };
}

/**
 * 堂前屋檐双燕（玄青羽背 + 赭红颔喉 + 雪白胸腹 + 深叉剪尾 + 掠掠尖翼）
 */
export function createSwallowParts() {
  const BACK = '#1E293B';
  const WING = '#28374E';
  const THROAT = '#B84A32';
  const BELLY = '#F0EDE5';

  const body = createPartBuilder([0, 0, 0]);
  body.add(loft([
    [-0.055, 0.004, 0.016, 0.014],
    [0.0, 0.0, 0.032, 0.026],
    [0.052, 0.006, 0.024, 0.022]
  ], 3, [BACK, BACK], false, BELLY));
  // Rust-chestnut chin/throat & sleek head + tiny beak
  body.add(wedge([
    [-0.020, 0.014, 0.046],
    [0.020, 0.014, 0.046],
    [0, 0.008, 0.088],
    [0, -0.014, 0.054]
  ]), THROAT);
  body.add(wedge([
    [-0.020, 0.022, 0.044],
    [0.020, 0.022, 0.044],
    [0, 0.010, 0.094],
    [0, 0.008, 0.048]
  ]), BACK);
  // Iconic forked scissor tail (深叉剪尾)
  for (const s of [-1, 1]) {
    body.add(wedge([
      [s * 0.006, 0.006, -0.048],
      [s * 0.022, 0.004, -0.052],
      [s * 0.046, 0.012, -0.155],
      [s * 0.014, -0.002, -0.072]
    ]), '#182232');
  }
  const bodyGeo = body.finish('qh-swallow-body');

  // Swept-back pointed sickle wings (pivot at shoulder)
  const wingL = createPartBuilder([0, 0, 0]);
  wingL.add(wedge([
    [0, 0.005, 0.032],
    [0, -0.004, -0.028],
    [-0.175, 0.008, -0.068],
    [-0.078, 0.002, 0.016]
  ]), WING);
  const wingLGeo = wingL.finish('qh-swallow-wing-l');

  const wingR = createPartBuilder([0, 0, 0]);
  wingR.add(wedge([
    [0, 0.005, 0.032],
    [0, -0.004, -0.028],
    [0.175, 0.008, -0.068],
    [0.078, 0.002, 0.016]
  ]), WING);
  const wingRGeo = wingR.finish('qh-swallow-wing-r');

  return { bodyGeo, wingLGeo, wingRGeo };
}

/**
 * 池面滑行水黾（修长梭形躯干 + 四支斜张点水长足）
 */
export function createWaterStriderGeometry() {
  const BODY_COL = '#484333';
  const LEG_COL = '#343024';
  const st = createPartBuilder([0, 0, 0]);
  st.add(wedge([
    [0, 0.018, 0.008],
    [-0.015, 0.004, 0],
    [0.015, 0.004, 0],
    [0, 0.006, 0.066]
  ]), BODY_COL);
  st.add(wedge([
    [0, 0.018, 0.008],
    [0.015, 0.004, 0],
    [-0.015, 0.004, 0],
    [0, 0.006, -0.066]
  ]), BODY_COL);
  for (const s of [-1, 1]) {
    // Swept mid skimming leg
    st.add(wedge([
      [s * 0.010, 0.008, 0.014],
      [s * 0.010, 0.004, 0.002],
      [s * 0.095, -0.008, 0.048],
      [s * 0.052, 0.009, 0.028]
    ]), LEG_COL);
    // Swept hind skimming leg
    st.add(wedge([
      [s * 0.010, 0.008, -0.010],
      [s * 0.010, 0.004, -0.022],
      [s * 0.088, -0.008, -0.068],
      [s * 0.048, 0.009, -0.038]
    ]), LEG_COL);
  }
  return st.finish('qh-water-strider');
}

/**
 * 零堆分配单网格刚体关节合批器：将多件雕刻动物部件写入单一 BufferGeometry（1 draw call），
 * 保持法线有限、顶点色丰富、暂停时零更新。
 */
export function createRigidBatchMesh(slotGeos, material, name) {
  let totalVerts = 0;
  const slots = slotGeos.map(srcGeo => {
    const posAttr = srcGeo.getAttribute('position');
    const norAttr = srcGeo.getAttribute('normal');
    const colAttr = srcGeo.getAttribute('color');
    const count = posAttr.count;
    const slot = {
      offset: totalVerts * 3,
      count,
      srcPos: new Float32Array(posAttr.array),
      srcNor: new Float32Array(norAttr.array),
      srcCol: new Float32Array(colAttr.array)
    };
    totalVerts += count;
    return slot;
  });

  const posBuf = new Float32Array(totalVerts * 3);
  const norBuf = new Float32Array(totalVerts * 3);
  const colBuf = new Float32Array(totalVerts * 3);
  for (let s = 0; s < slots.length; s++) {
    const sl = slots[s];
    colBuf.set(sl.srcCol, sl.offset);
    for (let i = 0; i < sl.count; i++) {
      norBuf[sl.offset + i * 3 + 1] = 1;
    }
  }

  const geo = new THREE.BufferGeometry();
  // BufferAttribute 直接共享缓冲引用；Float32BufferAttribute 会拷贝数组，
  // 会使 writePart 对 posBuf/norBuf 的逐帧修改到不了 geometry（牛身塌在原点）。
  const posAttr = new THREE.BufferAttribute(posBuf, 3);
  const norAttr = new THREE.BufferAttribute(norBuf, 3);
  const colAttr = new THREE.BufferAttribute(colBuf, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  norAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', norAttr);
  geo.setAttribute('color', colAttr);

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.userData.dynamic = true;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  // Euler 'YXZ': R = Ry(ry) * Rx(rx) * Rz(rz)
  function writePart(slotIdx, tx, ty, tz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const sl = slots[slotIdx];
    const cx = Math.cos(rx), sxr = Math.sin(rx);
    const cy = Math.cos(ry), syr = Math.sin(ry);
    const cz = Math.cos(rz), szr = Math.sin(rz);
    const r00 = cy * cz + syr * sxr * szr;
    const r01 = cz * syr * sxr - cy * szr;
    const r02 = cx * syr;
    const r10 = cx * szr;
    const r11 = cx * cz;
    const r12 = -sxr;
    const r20 = cy * sxr * szr - cz * syr;
    const r21 = syr * szr + cy * cz * sxr;
    const r22 = cy * cx;
    const sp = sl.srcPos, sn = sl.srcNor;
    let o = sl.offset;
    for (let i = 0, n = sl.count * 3; i < n; i += 3, o += 3) {
      const lx = sp[i] * sx, ly = sp[i + 1] * sy, lz = sp[i + 2] * sz;
      posBuf[o] = r00 * lx + r01 * ly + r02 * lz + tx;
      posBuf[o + 1] = r10 * lx + r11 * ly + r12 * lz + ty;
      posBuf[o + 2] = r20 * lx + r21 * ly + r22 * lz + tz;
      const nx = sn[i], ny = sn[i + 1], nz = sn[i + 2];
      norBuf[o] = r00 * nx + r01 * ny + r02 * nz;
      norBuf[o + 1] = r10 * nx + r11 * ny + r12 * nz;
      norBuf[o + 2] = r20 * nx + r21 * ny + r22 * nz;
    }
  }

  function hidePart(slotIdx) {
    writePart(slotIdx, 0, -50, 0, 0, 0, 0, 0, 0, 0);
  }

  function commit() {
    posAttr.needsUpdate = true;
    norAttr.needsUpdate = true;
  }

  return { mesh, geo, writePart, hidePart, commit, triangles: totalVerts / 3 };
}
