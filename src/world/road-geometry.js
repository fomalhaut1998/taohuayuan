import * as THREE from 'three';

const TAU = Math.PI * 2;

function defaultRand(seed = 61423) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash2(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
}

/**
 * Chaikin 折角平顺插值，保留首尾锚点（与既有路网端点精确衔接），
 * 消除硬折线与尖角锯齿。
 */
export function chaikinSmooth(points, passes = 2) {
  if (!Array.isArray(points) || points.length < 2) return points ? points.map(p => [p[0], p[1]]) : [];
  let cur = points.map(p => [p[0], p[1]]);
  if (cur.length === 2 || passes <= 0) return cur;
  for (let pass = 0; pass < passes; pass++) {
    const next = [[cur[0][0], cur[0][1]]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      const q = [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25];
      const r = [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75];
      if (i > 0) next.push(q);
      if (i < cur.length - 2) next.push(r);
    }
    next.push([cur[cur.length - 1][0], cur[cur.length - 1][1]]);
    cur = next;
  }
  return cur;
}

/**
 * 按等弧长对折线重采样，使每个横向断面与法向连续过渡。
 */
export function resamplePolyline(points, sampleStep = 0.65) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const cum = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    cum.push(total);
  }
  if (total < 1e-4) return [];
  const segCount = Math.max(2, Math.ceil(total / Math.max(0.2, sampleStep)));
  const out = [];
  let j = 0;
  for (let k = 0; k <= segCount; k++) {
    const d = (k / segCount) * total;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const span = cum[j + 1] - cum[j];
    const u = span > 1e-6 ? (d - cum[j]) / span : 0;
    const x = points[j][0] + (points[j + 1][0] - points[j][0]) * u;
    const z = points[j][1] + (points[j + 1][1] - points[j][1]) * u;
    out.push({ x, z, dist: d, u: k / segCount, total });
  }
  return out;
}

/**
 * 生成平顺自然、带中心路拱、车辙微压痕、草地羽化边缘及可选路缘卵石的乡间土路网格。
 * 保证每个输出三角面面积非零且法线单位化、朝向 +Y（无 NaN 与零法线退化）。
 */
export function buildNaturalRoadRibbon(rawPoints, options = {}) {
  const {
    field,
    halfWidth = 1.1,
    lift = 0.015,
    sampleStep = 0.70,
    smoothPasses = 2,
    roadColor = '#B9A682',
    vergeColor = '#7F9359',
    camber = 0.020,
    vergeWidth = 0.28,
    rutDepth = 0.006,
    startFlare = 0,
    endFlare = 0,
    flareDist = 1.65,
    endFlareDist = flareDist,
    taper = 0,
    scatterPebbles = false,
    pebbleStep = 3,
    rand = defaultRand(61423),
    sink = null
  } = options;

  if (!rawPoints || rawPoints.length < 2 || !field) return sink;
  const smoothed = chaikinSmooth(rawPoints, smoothPasses);
  const pts = resamplePolyline(smoothed, sampleStep);
  if (pts.length < 2) return sink;

  const target = sink || { pos: [], nor: [], col: [] };
  const posArr = target.pos || target.position;
  const norArr = target.nor || target.normal;
  const colArr = target.col || target.color;
  if (!posArr || !norArr || !colArr) return target;

  const cRoad = roadColor instanceof THREE.Color ? roadColor.clone() : new THREE.Color(roadColor);
  const cVergeFallback = vergeColor instanceof THREE.Color ? vergeColor.clone() : new THREE.Color(vergeColor);
  const _colA = new THREE.Color();
  const _colB = new THREE.Color();

  function emitTri(a, ac, b, bc, c, cc) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const lenSq = nx * nx + ny * ny + nz * nz;
    if (lenSq < 1e-10 || !Number.isFinite(lenSq)) return;
    let v1 = b, v1c = bc, v2 = c, v2c = cc;
    if (ny < 0) {
      nx = -nx; ny = -ny; nz = -nz;
      v1 = c; v1c = cc; v2 = b; v2c = bc;
    }
    const inv = 1 / Math.sqrt(lenSq);
    nx *= inv; ny *= inv; nz *= inv;
    posArr.push(a[0], a[1], a[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
    norArr.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    colArr.push(ac.r, ac.g, ac.b, v1c.r, v1c.g, v1c.b, v2c.r, v2c.g, v2c.b);
  }

  function grassSample(x, z) {
    if (typeof field.colorAt === 'function') {
      const c = field.colorAt(x, z);
      if (c && Number.isFinite(c.r)) return c;
    }
    return cVergeFallback;
  }

  const slices = [];
  for (let k = 0; k < pts.length; k++) {
    const pPrev = pts[Math.max(0, k - 1)];
    const pNext = pts[Math.min(pts.length - 1, k + 1)];
    let tx = pNext.x - pPrev.x;
    let tz = pNext.z - pPrev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz;
    const nz = tx;

    const p = pts[k];
    const flareS = startFlare > 0 && p.dist < flareDist ? Math.pow(1 - p.dist / flareDist, 2) * startFlare : 0;
    const endDist = p.total - p.dist;
    const flareE = endFlare > 0 && endDist < endFlareDist ? Math.pow(1 - endDist / endFlareDist, 2) * endFlare : 0;
    const w = Math.max(0.18, halfWidth * (1 - p.u * taper) + flareS + flareE);

    const nL = smoothNoise2(p.x * 0.55 + 3.1, p.z * 0.55 - 1.7);
    const nR = smoothNoise2(p.x * 0.55 - 4.7, p.z * 0.55 + 2.3);
    const edgeW_L = vergeWidth * (0.72 + nL * 0.62);
    const edgeW_R = vergeWidth * (0.72 + nR * 0.62);

    const offsets = [-(w + edgeW_L), -w * 0.60, 0, w * 0.60, w + edgeW_R];
    const midY = field.sample(p.x, p.z);
    const leftTreadY = field.sample(p.x + nx * offsets[1], p.z + nz * offsets[1]);
    const rightTreadY = field.sample(p.x + nx * offsets[3], p.z + nz * offsets[3]);
    const highTread = Math.max(midY, leftTreadY, rightTreadY);

    const verts = [];
    const cols = [];
    const nTint = (smoothNoise2(p.x * 0.35, p.z * 0.35) - 0.5) * 0.045;
    for (let s = 0; s < 5; s++) {
      const vx = p.x + nx * offsets[s];
      const vz = p.z + nz * offsets[s];
      const gy = field.sample(vx, vz);
      let vy;
      if (s === 2) {
        vy = highTread + lift + camber;
        _colA.copy(cRoad).offsetHSL(0, -0.02, 0.015 + nTint);
      } else if (s === 1 || s === 3) {
        vy = Math.max(gy + lift * 0.85, highTread + lift + camber * 0.42 - rutDepth);
        _colA.copy(cRoad).offsetHSL(0, 0.02, -0.024 + nTint);
      } else {
        vy = Math.min(highTread + lift * 0.5, gy + lift * 0.32);
        const gCol = grassSample(vx, vz);
        _colA.copy(cRoad).lerp(gCol, 0.78).offsetHSL(0, 0, nTint * 0.5);
      }
      verts.push([vx, vy, vz]);
      cols.push(_colA.clone());
    }
    slices.push({ verts, cols, p, nx, nz, w });
  }

  for (let k = 0; k < slices.length - 1; k++) {
    const s0 = slices[k];
    const s1 = slices[k + 1];
    for (let st = 0; st < 4; st++) {
      emitTri(s0.verts[st], s0.cols[st], s0.verts[st + 1], s0.cols[st + 1], s1.verts[st + 1], s1.cols[st + 1]);
      emitTri(s0.verts[st], s0.cols[st], s1.verts[st + 1], s1.cols[st + 1], s1.verts[st], s1.cols[st]);
    }
    if (scatterPebbles && k % pebbleStep === 1) {
      for (const side of [-1, 1]) {
        if (rand() > 0.52) continue;
        const off = s0.w + 0.04 + rand() * (vergeWidth * 0.55);
        const px = s0.p.x + s0.nx * side * off;
        const pz = s0.p.z + s0.nz * side * off;
        const py = field.sample(px, pz) + lift * 0.35;
        const pr = 0.07 + rand() * 0.06;
        const ph = 0.028 + rand() * 0.018;
        const ang = rand() * TAU;
        _colB.copy(cRoad).offsetHSL(0, -0.05, -0.06 + rand() * 0.06);
        const rim = [
          [px + Math.cos(ang) * pr, py - 0.012, pz + Math.sin(ang) * pr],
          [px + Math.cos(ang + 1.57) * pr * 0.85, py - 0.012, pz + Math.sin(ang + 1.57) * pr * 0.85],
          [px + Math.cos(ang + 3.14) * pr, py - 0.012, pz + Math.sin(ang + 3.14) * pr],
          [px + Math.cos(ang + 4.71) * pr * 0.85, py - 0.012, pz + Math.sin(ang + 4.71) * pr * 0.85]
        ];
        const peak = [px + (rand() - 0.5) * 0.02, py + ph, pz + (rand() - 0.5) * 0.02];
        const cTop = _colB.clone().offsetHSL(0, 0, 0.05);
        for (let r = 0; r < 4; r++) {
          emitTri(rim[r], _colB, rim[(r + 1) % 4], _colB, peak, cTop);
        }
      }
    }
  }

  return target;
}

/**
 * 基于已冻结的 hinterland.paths 控制点，构建用于实时渲染的平顺山野土路，
 * 不改动 createHinterland() 原始网格以严格兼容基线材质与几何契约。
 */
export function createSmoothHinterlandPaths(hinterland, field, cfg) {
  const ribbonBuf = { pos: [], nor: [], col: [] };
  for (const path of hinterland?.paths || []) {
    buildNaturalRoadRibbon(path.points, {
      field,
      halfWidth: path.width * 0.5,
      lift: cfg.pathLift,
      sampleStep: Math.max(0.65, cfg.pathSample * 0.45),
      smoothPasses: 2,
      roadColor: cfg.palette.path,
      vergeColor: cfg.palette.grass || '#7F9359',
      camber: 0.018,
      vergeWidth: 0.24,
      rutDepth: 0.004,
      scatterPebbles: false,
      sink: ribbonBuf
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(ribbonBuf.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(ribbonBuf.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(ribbonBuf.col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  }));
  mesh.name = 'hinterland-paths-smooth';
  return mesh;
}
