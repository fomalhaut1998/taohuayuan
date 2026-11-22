import * as THREE from 'three';

// 程序化角色零件：低分段曲面 + 纯色顶点色。细节只服务轮廓与剪影，不用贴图。
const _white = new THREE.Color('#FFFFFF');
export function lighten(color, k) {
  return new THREE.Color(color).lerp(_white, k);
}

// keepColor: 直接沿用零件自带的顶点色（用于嵌入已上色的头部/斗笠，避免被纯色覆盖）。
export function mergeColoredParts(parts) {
  const pos = [], nor = [], col = [];
  const color = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.applyMatrix4(p.matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pa = g.attributes.position.array;
    const na = g.attributes.normal.array;
    if (p.keepColor && g.attributes.color) {
      const ca = g.attributes.color.array;
      for (let i = 0; i < ca.length; i++) col.push(ca[i]);
    } else {
      color.set(p.color);
      for (let i = 0; i < pa.length; i += 3) col.push(color.r, color.g, color.b);
    }
    for (let i = 0; i < pa.length; i++) {
      pos.push(pa[i]);
      nor.push(na[i]);
    }
    g.dispose();
    p.geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

export function part(parts, geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  parts.push({ geo, color, matrix, keepColor: color === null });
}

export function ellipsoid(parts, color, x, y, z, sx, sy, sz, rz = 0) {
  part(parts, new THREE.SphereGeometry(1, 6, 4), color, x, y, z, sx, sy, sz, 0, 0, rz);
}

// 平贴在正面的细带：眉、唇线、束带垂脚这类需要明确笔画的细节。
export function ribbon(parts, color, x1, y1, x2, y2, width, z) {
  const dx = x2 - x1, dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length * width * 0.5;
  const ny = dx / length * width * 0.5;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    x1 + nx, y1 + ny, z, x1 - nx, y1 - ny, z, x2 + nx, y2 + ny, z,
    x1 - nx, y1 - ny, z, x2 - nx, y2 - ny, z, x2 + nx, y2 + ny, z
  ], 3));
  geo.computeVertexNormals();
  parts.push({ geo, color, matrix: new THREE.Matrix4() });
}

// 环截面：衣服、袖、帽、头骨都由它放样。前/后偏移让发际线可以前塌、后颈可以下探。
export function ringGeometry(rings, sides = 10, caps = true) {
  const positions = [];
  function vertex(r, i) {
    const a = (i % sides) / sides * Math.PI * 2;
    const c = Math.cos(a);
    const y = r.y + (r.front || 0) * Math.max(0, c) + (r.back || 0) * Math.max(0, -c) - (r.drop || 0) * (1 - c) * 0.5;
    return [Math.sin(a) * r.rx, y, c * r.rz + (r.z || 0)];
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const a = vertex(rings[j], i), b = vertex(rings[j], i + 1);
      const c = vertex(rings[j + 1], i), d = vertex(rings[j + 1], i + 1);
      positions.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
  }
  if (caps) {
    const first = rings[0], last = rings[rings.length - 1];
    for (let i = 0; i < sides; i++) {
      positions.push(0, first.y, first.z || 0, ...vertex(first, i + 1), ...vertex(first, i));
      positions.push(0, last.y, last.z || 0, ...vertex(last, i), ...vertex(last, i + 1));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// 沿衣身取一段角度的曲面：交领、前襟、披肩都靠它贴合弧面，而不是浮在身前的平片。
export function arcGeometry(rings, sides, a0, a1, offset = 0) {
  const positions = [];
  const steps = Math.max(2, Math.round((a1 - a0) / (Math.PI * 2 / sides)));
  function v(r, t) {
    const a = a0 + (a1 - a0) * t;
    return [Math.sin(a) * (r.rx + offset), r.y, Math.cos(a) * (r.rz + offset)];
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < steps; i++) {
      const a = v(rings[j], i / steps), b = v(rings[j], (i + 1) / steps);
      const c = v(rings[j + 1], i / steps), d = v(rings[j + 1], (i + 1) / steps);
      positions.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// 贴着衣身、随高度改角度的曲面带：交领与前襟靠它顺着身体走，而不是浮在胸前。
export function surfaceBand(rings, y0, a0, y1, a1, width, off = 0.004, steps = 10) {
  const positions = [];
  function p(t, s) {
    const y = y0 + (y1 - y0) * t;
    const a = a0 + (a1 - a0) * t;
    const r = fitRing(rings, y);
    const rr = Math.hypot(r.rx, r.rz) || 1;
    const da = (width * 0.5) / rr * s;
    return [Math.sin(a + da) * (r.rx + off), y, Math.cos(a + da) * (r.rz + off)];
  }
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const a = p(t0, -1), b = p(t0, 1), c = p(t1, -1), d = p(t1, 1);
    positions.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// 在给定高度上取衣身截面，略放大后者作为压在衣服上的层。
export function fitRing(rings, y, grow = 0) {
  const sorted = rings;
  if (y <= sorted[0].y) return { y, rx: sorted[0].rx + grow, rz: sorted[0].rz + grow };
  const last = sorted[sorted.length - 1];
  if (y >= last.y) return { y, rx: last.rx + grow, rz: last.rz + grow };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y);
      return { y, rx: a.rx + (b.rx - a.rx) * t + grow, rz: a.rz + (b.rz - a.rz) * t + grow };
    }
  }
  return { y, rx: last.rx + grow, rz: last.rz + grow };
}

// 五官贴合实际三角面，而非椭球近似：低面数脸颊的折面也不会吞掉眼角。
function faceSurface(geometry) {
  const a = geometry.attributes.position;
  return (x, y) => {
    let front = -Infinity;
    for (let i = 0; i < a.count; i += 3) {
      const ax = a.getX(i), ay = a.getY(i), bx = a.getX(i + 1), by = a.getY(i + 1);
      const cx = a.getX(i + 2), cy = a.getY(i + 2);
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-10) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) continue;
      front = Math.max(front, u * a.getZ(i) + v * a.getZ(i + 1) + (1 - u - v) * a.getZ(i + 2));
    }
    return Number.isFinite(front) ? front : 0;
  };
}

function faceStroke(parts, color, surface, x0, y0, x1, y1, width, arch = 0, lift = 0.001) {
  const vertices = [];
  function vertex(t, side) {
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * arch
      + side * width * (0.18 + 0.82 * Math.sin(Math.PI * t)) * 0.5;
    return [x, y, surface(x, y) + lift];
  }
  for (let i = 0; i < 4; i++) {
    const a = vertex(i / 4, -1), b = vertex((i + 1) / 4, -1);
    const c = vertex(i / 4, 1), d = vertex((i + 1) / 4, 1);
    // 双侧眉眼都保持朝前的绕序。
    if (x1 > x0) vertices.push(...a, ...b, ...c, ...b, ...d, ...c);
    else vertices.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  part(parts, geo, color);
}

// 发际边缘随头骨收缩，多层贴合头骨曲面不陷落，后颈低、额头高，留出温润水墨发量与发际线。
function scalpGeometry(skull, role) {
  const positions = [], sides = 12;
  const topY = skull[skull.length - 1].y + 0.002;
  const fracs = [0, 0.24, 0.50, 0.76, 0.96];
  const peakGrow = role === 'female' ? 0.0145 : role === 'child' ? 0.0125 : role === 'elder' ? 0.0105 : 0.0118;
  function v(layer, i) {
    const angle = (i % sides) / sides * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
    const forehead = role === 'elder' ? 0.102 : role === 'child' ? 0.062 : role === 'female' ? 0.072 : 0.078;
    const partDip = role === 'female'
      ? -Math.abs(s) * Math.max(0, c) * 0.014
      : role === 'child'
        ? -Math.max(0, c) * (0.008 + 0.004 * Math.cos(angle * 3))
        : Math.max(0, c) * Math.sin(angle * 2 + 0.4) * 0.004;
    const napeDrop = role === 'female' ? 0.098 : role === 'elder' ? 0.068 : 0.078;
    const sideBase = role === 'female' ? 0.014 : 0.022;
    const y0 = sideBase + Math.max(0, c) * (forehead - sideBase) - Math.max(0, -c) * napeDrop + partDip;
    const t = fracs[layer];
    const y = y0 + (topY - y0) * t;
    const dome = Math.sin(t * Math.PI * 0.88);
    const backFull = Math.max(0, -c) * Math.sin(t * Math.PI) * (role === 'female' ? 0.0055 : 0.0038);
    const grow = 0.0045 + dome * (peakGrow - 0.0045) + backFull;
    const r = fitRing(skull, y, grow);
    return [s * r.rx, y, c * r.rz];
  }
  const bands = fracs.length - 1;
  for (let layer = 0; layer < bands; layer++) for (let i = 0; i < sides; i++) {
    const a = v(layer, i), b = v(layer, i + 1), c = v(layer + 1, i), d = v(layer + 1, i + 1);
    positions.push(...a, ...b, ...c, ...b, ...d, ...c);
  }
  const crownY = topY + 0.0025;
  for (let i = 0; i < sides; i++) positions.push(0, crownY, 0, ...v(bands, i), ...v(bands, i + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

function hairLock(parts, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  part(parts, new THREE.SphereGeometry(1, 7, 4), color, x, y, z, sx, sy, sz, rx, ry, rz);
}

// 头部：下颌—颧骨—眉弓—额—顶的环截面，让正面有明确的脸型而不是一颗球。
// 五官全部是极小的低分段体块，远看是干净的笔触，近看有眉目的层次。
export function makeHead(cfg, role = 'adult') {
  const p = [];
  const elder = role === 'elder';
  const child = role === 'child';
  const female = role === 'female';
  const hair = elder ? cfg.elderHair : cfg.hair;
  const eye = cfg.eye || '#3B322B';
  const lip = female ? lighten(cfg.lip || cfg.mouth, 0.04) : (cfg.lip || cfg.mouth);
  const skull = child ? [
    { y: -0.128, rx: 0.054, rz: 0.046 },
    { y: -0.105, rx: 0.082, rz: 0.069 },
    { y: -0.072, rx: 0.099, rz: 0.085 },
    { y: -0.030, rx: 0.114, rz: 0.097 },
    { y: 0.012, rx: 0.120, rz: 0.102 },
    { y: 0.058, rx: 0.116, rz: 0.098 },
    { y: 0.104, rx: 0.099, rz: 0.086 },
    { y: 0.146, rx: 0.062, rz: 0.055 },
    { y: 0.172, rx: 0.018, rz: 0.016 }
  ] : female ? [
    { y: -0.142, rx: 0.045, rz: 0.039 },
    { y: -0.120, rx: 0.069, rz: 0.057 },
    { y: -0.090, rx: 0.083, rz: 0.071 },
    { y: -0.048, rx: 0.101, rz: 0.086 },
    { y: -0.004, rx: 0.110, rz: 0.094 },
    { y: 0.044, rx: 0.112, rz: 0.096 },
    { y: 0.094, rx: 0.102, rz: 0.087 },
    { y: 0.142, rx: 0.069, rz: 0.059 },
    { y: 0.175, rx: 0.020, rz: 0.017 }
  ] : [
    { y: -0.144, rx: 0.050, rz: 0.042 },
    { y: -0.122, rx: 0.074, rz: 0.060 },
    { y: -0.092, rx: 0.086, rz: 0.073 },
    { y: -0.048, rx: 0.104, rz: 0.087 },
    { y: -0.004, rx: 0.113, rz: 0.095 },
    { y: 0.044, rx: 0.115, rz: 0.097 },
    { y: 0.094, rx: 0.104, rz: 0.088 },
    { y: 0.142, rx: 0.070, rz: 0.060 },
    { y: 0.176, rx: 0.020, rz: 0.017 }
  ];
  const skinGeometry = ringGeometry(skull, 12);
  const surface = faceSurface(skinGeometry);
  part(p, skinGeometry, cfg.skin);
  part(p, new THREE.CylinderGeometry(female ? 0.046 : 0.050, female ? 0.056 : 0.061, 0.105, 8), cfg.skin, 0, -0.186, -0.010);
  for (const side of [-1, 1]) {
    part(p, new THREE.SphereGeometry(1, 5, 3), cfg.skin, side * (female ? 0.107 : 0.110), -0.010, 0.000, 0.014, 0.027, 0.012, 0, 0, side * -0.12);
    part(p, new THREE.SphereGeometry(1, 4, 3), cfg.earShade || cfg.mouth, side * (female ? 0.110 : 0.113), -0.010, 0.005, 0.007, 0.015, 0.005);
  }
  for (const side of [-1, 1]) {
    const inner = child ? 0.024 : 0.027, outer = child ? 0.058 : female ? 0.064 : 0.066;
    faceStroke(p, eye, surface, side * inner, 0.003, side * outer, female ? 0.005 : 0.004,
      child ? 0.007 : elder ? 0.0045 : female ? 0.0050 : 0.0055, female ? 0.0024 : 0.002);
    faceStroke(p, hair, surface, side * (inner - 0.003), female ? 0.033 : 0.032,
      side * (outer - 0.002), female ? 0.032 : 0.033, elder ? 0.0065 : female ? 0.0036 : 0.0045, female ? 0.0048 : 0.0035);
  }
  // 宽底浅鼻，根部埋回脸面；不用尖锥与独立鼻球。
  const nose = new THREE.BufferGeometry();
  const nv = (x, y, lift = -0.0002) => [x, y, surface(x, y) + lift];
  const bridge=nv(0,-0.006,0.003), tip=nv(0,-0.032,child ? 0.009 : female ? 0.0105 : 0.012);
  const l=nv(-0.012,-0.036), r=nv(0.012,-0.036), top=nv(0,-0.002), base=nv(0,-0.045);
  nose.setAttribute('position',new THREE.Float32BufferAttribute([
    ...top,...l,...bridge, ...top,...bridge,...r, ...bridge,...l,...tip,
    ...bridge,...tip,...r, ...l,...base,...tip, ...tip,...base,...r
  ],3));
  nose.computeVertexNormals(); part(p,nose,cfg.skin);
  const mouthY = child ? -0.061 : female ? -0.067 : -0.069;
  const mouthW = female ? 0.0145 : 0.016;
  faceStroke(p, lip, surface, -mouthW, mouthY - 0.003, mouthW, mouthY - 0.003, 0.0032, -0.001);
  faceStroke(p, cfg.mouth, surface, -(mouthW + 0.003), mouthY, mouthW + 0.003, mouthY, 0.0023, -0.0015, 0.0012);
  part(p, scalpGeometry(skull, role), hair);
  if (child) {
    // 孩子的脸更圆、更短，眉眼上移，双髻用发绳扎住。
    for (const side of [-1, 1]) {
      ellipsoid(p, hair, side * 0.090, 0.130, -0.030, 0.044, 0.040, 0.042);
      part(p, new THREE.CylinderGeometry(0.020, 0.020, 0.024, 8), cfg.sash, side * 0.090, 0.104, -0.030, 1, 1, 1, 0, 0, side * 0.45);
      ellipsoid(p, hair, side * 0.111, 0.028, 0.014, 0.010, 0.028, 0.015);
    }
  } else if (elder) {
    // 老人：发际线略退、灰眉加粗、温润束髻、唇上短髭与下颌分束长须。
    ellipsoid(p, hair, 0, 0.138, -0.080, 0.046, 0.036, 0.042);
    part(p, new THREE.CylinderGeometry(0.024, 0.025, 0.014, 8), cfg.sash, 0, 0.120, -0.068, 1, 1, 1, Math.PI / 2 - 0.15);
    for (const side of [-1, 1]) {
      ellipsoid(p, hair, side * 0.012, -0.0505, 0.0808, 0.017, 0.0055, 0.0050, side * 0.22);
      ellipsoid(p, hair, side * 0.111, 0.018, 0.006, 0.012, 0.032, 0.018);
    }
    part(p, ringGeometry([
      { y: -0.212, rx: 0.010, rz: 0.008, z: 0.036 },
      { y: -0.172, rx: 0.024, rz: 0.018, z: 0.043 },
      { y: -0.126, rx: 0.032, rz: 0.022, z: 0.046 },
      { y: -0.098, rx: 0.022, rz: 0.014, z: 0.054 }
    ], 7), hair);
    faceStroke(p, cfg.earShade || cfg.mouth, surface, -0.060, -0.016, -0.046, -0.020, 0.002);
    faceStroke(p, cfg.earShade || cfg.mouth, surface, 0.060, -0.016, 0.046, -0.020, 0.002);
  } else if (female) {
    // 秦汉妇人垂鬟椎髻：中分柔鬓拢向耳后，脑后低绾垂髻，横插温润木簪并束浅色布发带。
    for (const side of [-1, 1]) {
      hairLock(p, hair, side * 0.098, 0.052, 0.030, 0.016, 0.032, 0.026, -0.20, 0, side * 0.30);
      hairLock(p, hair, side * 0.109, -0.016, -0.012, 0.012, 0.044, 0.018, 0.12, 0, side * -0.06);
    }
    // 后脑收拢发枕与低垂环形椎髻
    hairLock(p, hair, 0, -0.036, -0.090, 0.056, 0.048, 0.042, 0.15, 0, 0);
    part(p, ringGeometry([
      { y: -0.148, rx: 0.024, rz: 0.020 },
      { y: -0.118, rx: 0.046, rz: 0.036 },
      { y: -0.076, rx: 0.048, rz: 0.038 },
      { y: -0.046, rx: 0.032, rz: 0.026 }
    ], 8), hair, 0, 0, -0.108, 1, 1, 1, -0.20, 0, 0);
    // 素布发带与双垂带
    const ribbonCol = lighten(cfg.sash, 0.20);
    part(p, new THREE.CylinderGeometry(0.036, 0.039, 0.018, 8), ribbonCol, 0, -0.056, -0.100, 1, 1, 0.88, 1.32, 0, 0);
    ribbon(p, ribbonCol, -0.012, -0.068, -0.030, -0.156, 0.016, -0.124);
    ribbon(p, ribbonCol, 0.012, -0.068, 0.028, -0.150, 0.016, -0.124);
    // 温润漆木簪
    part(p, new THREE.CylinderGeometry(0.0035, 0.0025, 0.158, 6), cfg.hatBand, 0.004, -0.062, -0.110, 1, 1, 1, 0, 0.08, Math.PI / 2 - 0.15);
    part(p, new THREE.OctahedronGeometry(1, 0), lighten(cfg.hatBand, 0.24), -0.073, -0.050, -0.104, 0.010, 0.008, 0.008);
  } else {
    // 成人男子：全发覆顶、鬓角服帖，脑后高绾发髻束布冠带并插竹簪玉珠。
    for (const side of [-1, 1]) {
      ellipsoid(p, hair, side * 0.110, 0.022, 0.004, 0.011, 0.030, 0.017);
    }
    ellipsoid(p, hair, 0, 0.132, -0.084, 0.052, 0.042, 0.048);
    part(p, new THREE.CylinderGeometry(0.028, 0.030, 0.018, 8), cfg.sash, 0, 0.114, -0.070, 1, 1, 1, Math.PI / 2 - 0.18);
    part(p, new THREE.CylinderGeometry(0.0032, 0.0032, 0.152, 5), cfg.hatBand, 0, 0.150, -0.090, 1, 1, 1, 0, 0, Math.PI / 2 + 0.12);
    ellipsoid(p, cfg.jade, 0.064, 0.152, -0.088, 0.009, 0.009, 0.009);
  }
  return mergeColoredParts(p);
}

// 斗笠：帽檐抬到眉上、前后微翘，帽里用浅一档的竹色，抬头时不再是一整块黑影。
export function makeHat(cfg, size = 1) {
  const p = [];
  const under = lighten(cfg.hat, 0.42);
  const crown = [
    { y: 0.104, rx: 0.250, rz: 0.250 },
    { y: 0.126, rx: 0.234, rz: 0.234 },
    { y: 0.170, rx: 0.152, rz: 0.152 },
    { y: 0.212, rx: 0.062, rz: 0.062 },
    { y: 0.246, rx: 0.014, rz: 0.014 }
  ];
  part(p, ringGeometry(crown, 16), cfg.hat);
  part(p, ringGeometry([
    { y: 0.104, rx: 0.250, rz: 0.250 },
    { y: 0.092, rx: 0.170, rz: 0.170 },
    { y: 0.082, rx: 0.090, rz: 0.090 }
  ], 16, false), under);
  part(p, new THREE.CylinderGeometry(0.252, 0.254, 0.013, 16, 1, true), cfg.hatBand, 0, 0.102, 0);
  part(p, new THREE.CylinderGeometry(0.212, 0.222, 0.022, 16), cfg.hatBand, 0, 0.138, 0);
  for (const side of [-1, 1]) {
    part(p, new THREE.CylinderGeometry(0.0032, 0.0032, 0.235, 5), cfg.hatBand, side * 0.096, 0.014, 0.030, 1, 1, 1, 0.10, 0, side * -0.22);
  }
  const geo = mergeColoredParts(p);
  if (size !== 1) geo.scale(size, size, size);
  // 整体后仰 8°：帽檐前高后低，脸能接到天光。
  geo.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0.145, 0, 0, 0, 1, 0, 0, 0, 0, 1));
  return geo;
}

const ROBE = [
  { y: -0.430, rx: 0.264, rz: 0.172 },
  { y: -0.386, rx: 0.258, rz: 0.168 },
  { y: -0.270, rx: 0.238, rz: 0.154 },
  { y: -0.160, rx: 0.214, rz: 0.138 },
  { y: -0.060, rx: 0.198, rz: 0.127 },
  { y: 0.050, rx: 0.190, rz: 0.122 },
  { y: 0.140, rx: 0.207, rz: 0.128 },
  { y: 0.205, rx: 0.220, rz: 0.130 },
  { y: 0.242, rx: 0.179, rz: 0.109 },
  { y: 0.263, rx: 0.065, rz: 0.061 }
];

export function makePeopleParts(cfg) {
  const robe = ringGeometry(ROBE, 12);
  const trims = [];
  // 交领右衽：紧贴颈根起一道收窄后领缘，再从颈侧顺肩坡斜交至胸前右衽，利落贴体无断层。
  part(trims, arcGeometry([
    fitRing(ROBE, 0.255, 0.005),
    fitRing(ROBE, 0.263, 0.006),
    { y: 0.273, rx: 0.069, rz: 0.065 }
  ], 12, 0.44, Math.PI * 2 - 0.44, 0), cfg.collar);
  part(trims, surfaceBand(ROBE, 0.259, 0.48, 0.052, -0.02, 0.032, 0.0055, 10), cfg.collar);
  part(trims, surfaceBand(ROBE, 0.259, -0.48, 0.052, 0.16, 0.032, 0.0095, 10), cfg.collar);
  // 内衬前襟：窄窄一条从交叠点垂到腰下，只露一道浅边，下摆处收进衣褶。
  part(trims, surfaceBand(ROBE, 0.050, 0.16, -0.250, 0.12, 0.032, 0.005, 10), cfg.trim);
  // 束带：腰上压一道（省略埋在衣身内的上下盲盖），温润软布结与垂脚偏在一侧。
  part(trims, ringGeometry([fitRing(ROBE, -0.018, 0.007), fitRing(ROBE, 0.058, 0.007)], 12, false), cfg.sash);
  part(trims, ringGeometry([fitRing(ROBE, -0.026, 0.006), fitRing(ROBE, -0.016, 0.006)], 12, false), cfg.hatBand);
  const knotZ = fitRing(ROBE, 0.020).rz + 0.011;
  ellipsoid(trims, cfg.sash, 0.026, 0.018, knotZ, 0.032, 0.022, 0.016, 0.18);
  ribbon(trims, cfg.sash, 0.032, 0.004, 0.068, -0.138, 0.026, knotZ + 0.007);
  ribbon(trims, cfg.sash, 0.014, 0.000, -0.004, -0.100, 0.021, knotZ + 0.005);
  ellipsoid(trims, cfg.jade, 0.026, -0.026, knotZ + 0.011, 0.012, 0.017, 0.008);
  // 下摆：外侧一道浅色镶边，底下再压一层更浅的内衬，走出两道边。
  part(trims, ringGeometry([fitRing(ROBE, -0.430, 0.004), fitRing(ROBE, -0.394, 0.004)], 12, false), cfg.trim);
  part(trims, ringGeometry([{ y: -0.438, rx: 0.268, rz: 0.176 }, { y: -0.428, rx: 0.266, rz: 0.174 }], 12, false), cfg.collar);
  // 袖：肩头一个圆包，往下收细，袖口才外张——整条手臂有粗细节奏，不是一根管子。
  const sleeve = ringGeometry([
    { y: 0.070, rx: 0.046, rz: 0.048 },
    { y: 0.046, rx: 0.070, rz: 0.069 },
    { y: 0.010, rx: 0.077, rz: 0.075 },
    { y: -0.060, rx: 0.077, rz: 0.076 },
    { y: -0.210, rx: 0.067, rz: 0.068 },
    { y: -0.360, rx: 0.068, rz: 0.069 },
    { y: -0.430, rx: 0.082, rz: 0.082 },
    { y: -0.462, rx: 0.094, rz: 0.092 },
    { y: -0.486, rx: 0.078, rz: 0.076 }
  ], 10);
  const cuff = ringGeometry([
    { y: -0.449, rx: 0.091, rz: 0.089 },
    { y: -0.470, rx: 0.096, rz: 0.094 },
    { y: -0.488, rx: 0.079, rz: 0.077 }
  ], 10);
  const hand = [];
  ellipsoid(hand, '#FFFFFF', 0, 0, 0, 0.047, 0.061, 0.035);
  ellipsoid(hand, '#FFFFFF', 0.034, 0.015, 0.005, 0.017, 0.027, 0.018, -0.35);
  // 腿：胯部略粗、踝部收细，脚上一双窄头布鞋。
  const leg = ringGeometry([
    { y: 0.000, rx: 0.082, rz: 0.084 },
    { y: -0.080, rx: 0.076, rz: 0.078 },
    { y: -0.320, rx: 0.064, rz: 0.066 },
    { y: -0.600, rx: 0.056, rz: 0.058 },
    { y: -0.880, rx: 0.048, rz: 0.050 },
    { y: -1.000, rx: 0.043, rz: 0.045 }
  ], 8, false);
  const basket = [];
  part(basket, ringGeometry([
    { y: -0.37, rx: 0.102, rz: 0.102 },
    { y: -0.18, rx: 0.137, rz: 0.137 }
  ], 12), cfg.basket);
  for (const y of [-0.35, -0.285, -0.22, -0.18]) {
    part(basket, new THREE.TorusGeometry(y === -0.18 ? 0.137 : 0.111, 0.007, 4, 12), cfg.hatBand, 0, y, 0, 1, 1, 1, Math.PI / 2);
  }
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    part(basket, new THREE.CylinderGeometry(0.006, 0.006, 0.185, 4), cfg.hatBand, Math.sin(a) * 0.12, -0.275, Math.cos(a) * 0.12, 1, 1, 1, -Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18);
  }
  part(basket, new THREE.TorusGeometry(0.103, 0.01, 5, 12, Math.PI), cfg.hatBand, 0, -0.17, 0);
  return {
    robe,
    trim: mergeColoredParts(trims),
    head: makeHead(cfg),
    femaleHead: makeHead(cfg, 'female'),
    elderHead: makeHead(cfg, 'elder'),
    childHead: makeHead(cfg, 'child'),
    hat: makeHat(cfg),
    sleeve,
    cuff,
    hand: mergeColoredParts(hand),
    leg,
    shoe: makeShoe(cfg),
    basket: mergeColoredParts(basket),
    stool: makeStool(cfg)
  };
}

// 秦汉翘头履（千层草麻厚底 + 玄褐布帮 + 素帛履缘 + 前昂翘头），严格保持鞋底 y = -0.012、踝口 (0, 0.052, 0) 且全部顶点色非黑。
export function makeShoe(cfg) {
  const shoe = [];
  const shoeCol = lighten(cfg.shoe || '#463F35', 0.10);
  const soleCol = lighten(cfg.hat || cfg.basket || '#C6AE7A', 0.04);
  const trimCol = cfg.trim || cfg.collar || '#DCD0B4';
  const crestCol = lighten(soleCol, 0.08);

  // 千层麻编厚履底（无重封内盖）
  part(shoe, ringGeometry([
    { y: -0.012, rx: 0.004, rz: 0.004, z: 0.024 },
    { y: -0.012, rx: 0.061, rz: 0.106, z: 0.024, front: 0.004 },
    { y: 0.004, rx: 0.064, rz: 0.112, z: 0.026, front: 0.006 }
  ], 6, false), soleCol);

  // 玄褐布面鞋帮
  part(shoe, ringGeometry([
    { y: 0.003, rx: 0.061, rz: 0.105, z: 0.024, front: 0.006 },
    { y: 0.024, rx: 0.056, rz: 0.094, z: 0.020, front: 0.007 },
    { y: 0.041, rx: 0.050, rz: 0.067, z: 0.008 }
  ], 6, false), shoeCol);

  // 素帛滚边鞋口、綦带束扣与翘头履前昂双脊翘头（共 84 三角面 >= 80 且顶点色全非黑）
  part(shoe, ringGeometry([
    { y: 0.040, rx: 0.052, rz: 0.066, z: 0.007 },
    { y: 0.053, rx: 0.044, rz: 0.048, z: 0.000 }
  ], 6, false), trimCol);
  part(shoe, new THREE.BoxGeometry(0.102, 0.009, 0.020), trimCol, 0, 0.028, 0.038, 1, 1, 1, 0.18, 0, 0);
  for (const side of [-1, 1]) {
    part(shoe, new THREE.BoxGeometry(0.016, 0.036, 0.018), crestCol, side * 0.012, 0.024, 0.134, 1, 1, 1, 0.36, 0, side * -0.08);
  }
  return mergeColoredParts(shoe);
}

// 门前纳凉老者所坐蒲席木矮凳（接地 y = 0，席面高 ~0.375，贴合坐姿臀高）。
export function makeStool(cfg) {
  const s = [];
  const matCol = cfg.hat || cfg.basket || '#C9B27E';
  const woodCol = cfg.hatBand || '#796143';
  const bandCol = cfg.sash || '#7C6750';
  // 蒲草编织圆润坐垫
  part(s, ringGeometry([
    { y: 0.322, rx: 0.222, rz: 0.182 },
    { y: 0.356, rx: 0.234, rz: 0.192 },
    { y: 0.378, rx: 0.198, rz: 0.162 }
  ], 10), matCol);
  // 木框束边
  part(s, ringGeometry([
    { y: 0.288, rx: 0.216, rz: 0.176 },
    { y: 0.324, rx: 0.224, rz: 0.184 }
  ], 10, false), bandCol);
  // 四足微撇榫卯木腿与横枨
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      part(s, new THREE.CylinderGeometry(0.021, 0.017, 0.31, 5), woodCol,
        sx * 0.152, 0.152, sz * 0.118, 1, 1, 1, sz * -0.08, 0, sx * 0.08);
    }
    part(s, new THREE.BoxGeometry(0.022, 0.022, 0.236), woodCol, sx * 0.156, 0.112, 0);
  }
  part(s, new THREE.BoxGeometry(0.312, 0.022, 0.022), woodCol, 0, 0.112, 0);
  return mergeColoredParts(s);
}
