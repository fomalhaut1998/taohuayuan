import * as THREE from 'three';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ============================================================================
// Shaders: Autumn Geese, Post-Rain Xuan-Paper Rainbow, Night Window Silhouettes
// ============================================================================

const GEESE_VERT = /* glsl */`
attribute float aPhase;
uniform float uTime;
varying vec3 vColor;
varying float vDist;

void main() {
  vColor = color;
  vec3 pos = position;
  float wingSpan = abs(pos.x);
  if (wingSpan > 0.08) {
    float flap = sin(uTime * 5.4 + aPhase) * 0.42 + cos(uTime * 2.7 + aPhase) * 0.08;
    pos.y += (wingSpan - 0.08) * flap;
    pos.z -= (wingSpan - 0.08) * abs(flap) * 0.12;
  }
  #ifdef USE_INSTANCING
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
  #else
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  #endif
  vDist = length(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const GEESE_FRAG = /* glsl */`
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOpacity;
varying vec3 vColor;
varying float vDist;

void main() {
  float fogF = smoothstep(uFogNear, max(uFogNear + 1.0, uFogFar * 1.35), vDist) * 0.72;
  vec3 col = mix(vColor, uFogColor, fogF);
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}
`;

const RAINBOW_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RAINBOW_FRAG = /* glsl */`
uniform float uOpacity;
uniform float uTime;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec3 vWorldPos;

// 宣纸矿物设色残虹：不用刺眼霓虹饱和色，取赭石、缃黄、石绿、缥碧四色晕染
vec3 xuanSpectrum(float t) {
  vec3 cRed    = vec3(0.84, 0.55, 0.49);
  vec3 cAmber  = vec3(0.87, 0.78, 0.53);
  vec3 cGreen  = vec3(0.56, 0.73, 0.62);
  vec3 cAzur   = vec3(0.53, 0.66, 0.76);
  vec3 cViolet = vec3(0.64, 0.59, 0.71);
  if (t < 0.25) return mix(cRed, cAmber, smoothstep(0.0, 0.25, t));
  if (t < 0.52) return mix(cAmber, cGreen, smoothstep(0.25, 0.52, t));
  if (t < 0.78) return mix(cGreen, cAzur, smoothstep(0.52, 0.78, t));
  return mix(cAzur, cViolet, smoothstep(0.78, 1.0, t));
}

void main() {
  // vUv.x: 0..1 along arch from north-east foot to south-east foot; vUv.y: 0..1 inner to outer radius
  float archEndFade = smoothstep(0.03, 0.26, vUv.x) * (1.0 - smoothstep(0.74, 0.97, vUv.x));
  // Subtle dry-brush break ("残虹断续")
  float wash = 0.72 + 0.28 * sin(vUv.x * 13.0 + uTime * 0.08) * cos(vUv.x * 7.0 - 0.6);

  // Primary bow centered at vUv.y in [0.16..0.52]
  float pT = clamp((vUv.y - 0.16) / 0.36, 0.0, 1.0);
  float primaryBell = sin(pT * 3.14159265);
  primaryBell = pow(max(0.0, primaryBell), 1.45) * step(0.16, vUv.y) * step(vUv.y, 0.52);
  vec3 primaryCol = xuanSpectrum(pT);

  // Faint secondary霓 (reversed spectrum) at vUv.y in [0.66..0.92]
  float sT = clamp((vUv.y - 0.66) / 0.26, 0.0, 1.0);
  float secondaryBell = sin(sT * 3.14159265);
  secondaryBell = pow(max(0.0, secondaryBell), 1.7) * step(0.66, vUv.y) * step(vUv.y, 0.92) * 0.34;
  vec3 secondaryCol = xuanSpectrum(1.0 - sT);

  float bandAlpha = (primaryBell + secondaryBell) * archEndFade * wash * uOpacity;
  if (bandAlpha < 0.002) discard;

  vec3 rainbowCol = (primaryCol * primaryBell + secondaryCol * secondaryBell) / max(0.0001, primaryBell + secondaryBell);
  vec3 finalCol = mix(uFogColor, rainbowCol, 0.88);
  gl_FragColor = vec4(finalCol, bandAlpha);
  #include <colorspace_fragment>
}
`;

const WINDOW_SIL_VERT = /* glsl */`
attribute float aDelay;
attribute float aKind;
varying vec2 vUv;
varying float vDelay;
varying float vKind;
varying float vDist;

void main() {
  vUv = uv;
  vDelay = aDelay;
  vKind = aKind;
  #ifdef USE_INSTANCING
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    vec4 wp = modelMatrix * vec4(position, 1.0);
  #endif
  vDist = length(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WINDOW_SIL_FRAG = /* glsl */`
uniform float uKindleTime;
uniform float uMasterGain;
uniform float uSimTime;
varying vec2 vUv;
varying float vDelay;
varying float vKind;
varying float vDist;

float capsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(0.0001, dot(ba, ba)), 0.0, 1.0);
  return smoothstep(r, r * 0.58, length(pa - ba * h));
}

void main() {
  float localOn = smoothstep(vDelay, vDelay + 1.45, uKindleTime) * uMasterGain;
  if (localOn <= 0.004) discard;
  float distFade = 1.0 - smoothstep(55.0, 118.0, vDist);
  if (distFade <= 0.004) discard;

  vec2 uv = vUv;
  // Qin-Han vertical wooden mullions (直棂窗格) + perimeter frame
  float frame = step(uv.x, 0.055) + step(0.945, uv.x) + step(uv.y, 0.06) + step(0.94, uv.y);
  float mullionV = smoothstep(0.018, 0.007, abs(fract(uv.x * 5.0) - 0.5) * 0.2);
  float mullionH = smoothstep(0.016, 0.006, abs(uv.y - 0.52));
  float lattice = clamp(frame + mullionV * 0.72 + mullionH * 0.78, 0.0, 1.0);

  // Subtle swaying silhouette inside paper screen (织布 / 展卷 / 夜话)
  float sway = sin(uSimTime * 1.55 + vDelay * 2.1) * 0.022;
  float nod = cos(uSimTime * 2.15 + vDelay * 1.3) * 0.014;
  vec2 p = uv;

  float head = smoothstep(0.095, 0.062, length(p - vec2(0.46 + sway, 0.62 + nod)));
  float shoulders = capsule(p, vec2(0.45 + sway * 0.6, 0.50), vec2(0.46, 0.14), 0.145);
  float prop = 0.0;
  if (vKind < 0.5) {
    // Weaver arm & shuttle motion + horizontal loom bar
    float shuttle = sin(uSimTime * 3.1 + vDelay) * 0.065;
    prop += capsule(p, vec2(0.48 + sway, 0.46), vec2(0.68 + shuttle, 0.38), 0.048);
    prop += capsule(p, vec2(0.18, 0.33), vec2(0.82, 0.33), 0.028) * 0.75;
  } else if (vKind < 1.5) {
    // Elder holding open bamboo scroll
    prop += capsule(p, vec2(0.48 + sway, 0.45), vec2(0.64 + sway, 0.44 + nod), 0.052);
    prop += capsule(p, vec2(0.63 + sway, 0.36 + nod), vec2(0.66 + sway, 0.53 + nod), 0.042);
  } else {
    // Warm tea/wine pot on low table beside seated villager
    prop += capsule(p, vec2(0.48 + sway, 0.44), vec2(0.62, 0.36), 0.045);
    prop += smoothstep(0.075, 0.045, length(p - vec2(0.70, 0.27)));
  }

  float figure = clamp(head + shoulders + prop, 0.0, 1.0) * 0.76;
  float darkMask = max(lattice * 0.88, figure);

  float flicker = 0.94 + 0.06 * sin(uSimTime * 5.8 + vDelay * 3.7);
  vec3 paperWarm = vec3(1.0, 0.76, 0.42) * flicker;
  vec3 inkShadow = vec3(0.20, 0.13, 0.08);
  vec3 col = mix(paperWarm, inkShadow, darkMask);

  // Paper halo is brightest where darkMask is low, while silhouette/mullions overlay cleanly
  float alpha = localOn * distFade * (0.26 + 0.64 * darkMask);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

// ============================================================================
// Low-Poly Geometry Builders for Seasonal Vignettes & Fauna
// ============================================================================

function createMiniBaker() {
  const pos = [];
  const col = [];
  const cA = new THREE.Color();
  const cB = new THREE.Color();
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  function addGeo(geo, hexLo, hexHi, mat4) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = Math.max(0.001, maxY - minY);
    cA.set(hexLo);
    cB.set(hexHi || hexLo);
    for (let i = 0; i < p.count; i += 3) {
      v0.fromBufferAttribute(p, i);
      v1.fromBufferAttribute(p, i + 1);
      v2.fromBufferAttribute(p, i + 2);
      const t0 = (v0.y - minY) / span;
      const t1 = (v1.y - minY) / span;
      const t2 = (v2.y - minY) / span;
      if (mat4) {
        v0.applyMatrix4(mat4);
        v1.applyMatrix4(mat4);
        v2.applyMatrix4(mat4);
      }
      pos.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
      for (const t of [t0, t1, t2]) {
        col.push(
          cA.r + (cB.r - cA.r) * t,
          cA.g + (cB.g - cA.g) * t,
          cA.b + (cB.b - cA.b) * t
        );
      }
    }
    if (g !== geo) g.dispose();
  }

  function addBeam(a, b, r0, r1, sides, hexLo, hexHi) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 0.001;
    const cyl = new THREE.CylinderGeometry(r1, r0, len, sides, 1, false);
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    addGeo(cyl, hexLo, hexHi, m);
    cyl.dispose();
  }

  function addTri(a, b, c, hex) {
    cA.set(hex);
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    col.push(cA.r, cA.g, cA.b, cA.r, cA.g, cA.b, cA.r, cA.g, cA.b);
  }

  function addQuad(p0, p1, p2, p3, hex) {
    addTri(p0, p1, p2, hex);
    addTri(p0, p2, p3, hex);
  }

  function addRevolved(cx, by, cz, profile, segs, hexLo, hexHi, yaw = 0, capTop = false) {
    cA.set(hexLo);
    cB.set(hexHi || hexLo);
    const maxY = Math.max(0.01, profile[profile.length - 1][1]);
    const rings = profile.map(([r, y]) => Array.from({ length: segs }, (_, i) => {
      const a = yaw + (i / segs) * TAU;
      return [cx + Math.cos(a) * r, by + y, cz + Math.sin(a) * r];
    }));
    const mix = new THREE.Color();
    for (let k = 0; k < rings.length - 1; k++) {
      const t = clamp((profile[k][1] + profile[k + 1][1]) * 0.5 / maxY, 0, 1);
      mix.copy(cA).lerp(cB, t);
      const r0 = rings[k], r1 = rings[k + 1];
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % segs;
        addQuad(r0[j], r0[i], r1[i], r1[j], mix);
      }
    }
    if (capTop) {
      const last = profile[profile.length - 1];
      const ctr = [cx, by + last[1] + 0.015, cz];
      const rT = rings[rings.length - 1];
      for (let i = 0; i < segs; i++) addTri(ctr, rT[(i + 1) % segs], rT[i], hexHi || hexLo);
    }
  }

  function build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  return { addGeo, addBeam, addTri, addQuad, addRevolved, build, get count() { return pos.length / 9; } };
}

function buildGooseGeometry() {
  const b = createMiniBaker();
  // Streamlined fusiform wild goose body (+Z forward, tapered chest & fan tail)
  b.addBeam([0, 0.0, -0.34], [0, 0.02, 0.22], 0.075, 0.135, 6, '#3B3834', '#635D54');
  b.addBeam([0, 0.02, 0.20], [0, 0.05, 0.42], 0.125, 0.055, 6, '#504B44', '#666057');
  b.addBeam([0, 0.0, -0.30], [0, 0.01, -0.50], 0.072, 0.095, 5, '#2E2C29', '#3F3C37');
  // Outstretched slender neck, head & bill (+Z forward)
  b.addBeam([0, 0.05, 0.39], [0, 0.12, 0.72], 0.046, 0.034, 5, '#2B2926', '#3A3732');
  b.addBeam([0, 0.12, 0.70], [0, 0.11, 0.86], 0.032, 0.008, 4, '#6E5E45', '#8C7A5B');
  // Cambered swept-back 2-segment wings (vertex shader flaps abs(pos.x) > 0.08)
  for (const s of [-1, 1]) {
    const rF = [s * 0.08, 0.05, 0.18], rB = [s * 0.08, 0.03, -0.14];
    const mF = [s * 0.52, 0.09, 0.10], mB = [s * 0.46, 0.05, -0.18];
    const tF = [s * 0.96, 0.04, -0.04], tB = [s * 0.82, 0.02, -0.22];
    const tip = [s * 1.12, 0.02, -0.16];
    b.addQuad(rF, mF, mB, rB, '#524D45');
    b.addQuad(mF, tF, tB, mB, '#3A3733');
    b.addTri(tF, tip, tB, '#2A2825');
  }
  return b.build();
}

function buildRainbowArchGeometry(segments = 44) {
  // Curved ribbon arch over eastern mountain peaks
  const pos = [];
  const uv = [];
  const idx = [];
  const innerR = 122;
  const outerR = 144;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const theta = Math.PI * (0.10 + u * 0.80); // 18 deg .. 162 deg arch above horizon
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    // Span along Z, arch upward in Y, slight graceful curve in X
    const z0 = ct * innerR;
    const y0 = st * innerR * 0.68;
    const x0 = -Math.sin(u * Math.PI) * 12;
    const z1 = ct * outerR;
    const y1 = st * outerR * 0.68;
    const x1 = -Math.sin(u * Math.PI) * 14;
    pos.push(x0, y0, z0, x1, y1, z1);
    uv.push(u, 0, u, 1);
    if (i < segments) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================================
// Main Factory: createSeasonalCycle
// ============================================================================

export function createSeasonalCycle(options = {}) {
  const {
    world,
    field,
    village,
    props,
    leisureGrove,
    qinHanCompletion,
    oxPlowing,
    player,
    sky
  } = options;

  const group = new THREE.Group();
  group.name = 'seasonal-cycle';

  const waterLevel = world?.terrain?.waterLevel ?? 0;
  const sampleY = (x, z) => (field?.sample ? field.sample(x, z) : waterLevel);
  const ownedGeos = [];
  const ownedMats = [];
  let disposed = false;
  let currentPhenology = 'spring';
  let simTime = 0;

  // --------------------------------------------------------------------------
  // 1. Seasonal Crop Stature Snapshot & Scaling (夏初碧浪 / 秋熟金粟)
  // --------------------------------------------------------------------------
  const cropMesh = qinHanCompletion?.group?.getObjectByName?.('qin-han-millet-crops') || null;
  let cropBaseMatrices = null;

  function applyCropStature(id) {
    if (!cropMesh?.instanceMatrix?.array) return;
    if (!cropBaseMatrices) {
      cropBaseMatrices = new Float32Array(cropMesh.instanceMatrix.array);
    }
    const dst = cropMesh.instanceMatrix.array;
    const src = cropBaseMatrices;
    if (id === 'spring') {
      dst.set(src);
      cropMesh.instanceMatrix.needsUpdate = true;
      return;
    }
    // 夏初青苗勃发 / 秋熟金粟微垂 / 冬寂霜覆低矮稻茬
    const sxz = id === 'winter' ? 0.80 : (id === 'summer' ? 1.15 : 1.14);
    const sy = id === 'winter' ? 0.26 : (id === 'summer' ? 1.28 : 1.16);
    const bowX = id === 'autumn' ? 0.055 : (id === 'winter' ? 0.018 : 0.0);
    const bowZ = id === 'autumn' ? 0.038 : (id === 'winter' ? -0.012 : 0.0);
    for (let i = 0; i < src.length; i += 16) {
      dst[i] = src[i] * sxz;
      dst[i + 1] = src[i + 1] * sxz;
      dst[i + 2] = src[i + 2] * sxz;
      dst[i + 3] = src[i + 3];
      dst[i + 4] = src[i + 4] * sy + bowX;
      dst[i + 5] = src[i + 5] * sy;
      dst[i + 6] = src[i + 6] * sy + bowZ;
      dst[i + 7] = src[i + 7];
      dst[i + 8] = src[i + 8] * sxz;
      dst[i + 9] = src[i + 9] * sxz;
      dst[i + 10] = src[i + 10] * sxz;
      dst[i + 11] = src[i + 11];
      dst[i + 12] = src[i + 12];
      dst[i + 13] = src[i + 13];
      dst[i + 14] = src[i + 14];
      dst[i + 15] = src[i + 15];
    }
    cropMesh.instanceMatrix.needsUpdate = true;
  }

  // --------------------------------------------------------------------------
  // 2. Four Seasonal Rural Vignette Meshes (Each season = 1 single Mesh draw)
  // --------------------------------------------------------------------------
  const vignetteMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  ownedMats.push(vignetteMat);

  function makeVignetteMesh(geo, name, visible) {
    ownedGeos.push(geo);
    const m = new THREE.Mesh(geo, vignetteMat);
    m.name = name;
    m.visible = visible;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
    return m;
  }

  // 2A. SPRING: 春蚕青桑箔 (Bamboo silkworm rack + 3 mulberry-leaf trays + basket near mulberry grove)
  const springMesh = (() => {
    const b = createMiniBaker();
    const mul = village?.mulberry?.[0] || [42, -124, 1.3];
    const sx = mul[0] + 2.65;
    const sz = mul[1] + 1.85;
    const sy = sampleY(sx, sz);
    const m = new THREE.Matrix4();

    // 4 bamboo frame uprights
    const hw = 0.62, hd = 0.54;
    for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      b.addBeam([sx + ox, sy - 0.12, sz + oz], [sx + ox * 0.92, sy + 1.48, sz + oz * 0.92], 0.038, 0.032, 5, '#7E8F52', '#A89B62');
    }
    // Crossbars & 3 rimmed woven bamboo silkworm trays heaped with tender mulberry leaves + white cocoons
    const trayFloor = new THREE.CylinderGeometry(0.52, 0.50, 0.02, 9);
    const leafGeo = new THREE.DodecahedronGeometry(0.16, 0);
    const cocoonGeo = new THREE.SphereGeometry(0.048, 5, 4);
    for (const ty of [0.42, 0.86, 1.28]) {
      b.addBeam([sx - hw, sy + ty - 0.04, sz - hd], [sx + hw, sy + ty - 0.04, sz - hd], 0.025, 0.025, 4, '#8E7D4E', '#A8965E');
      b.addBeam([sx - hw, sy + ty - 0.04, sz + hd], [sx + hw, sy + ty - 0.04, sz + hd], 0.025, 0.025, 4, '#8E7D4E', '#A8965E');
      m.identity().setPosition(sx, sy + ty - 0.01, sz);
      b.addGeo(trayFloor, '#9C8754', '#BCA870', m);
      b.addRevolved(sx, sy + ty - 0.02, sz, [[0.52, 0], [0.57, 0.075], [0.54, 0.08]], 9, '#8E7748', '#C6B27B');
      for (let k = 0; k < 4; k++) {
        const a = k * 1.57 + ty * 2.1;
        m.identity().scale(new THREE.Vector3(1.3, 0.35, 1.1)).setPosition(sx + Math.cos(a) * 0.24, sy + ty + 0.045, sz + Math.sin(a) * 0.22);
        b.addGeo(leafGeo, '#4E7B42', '#75A358', m);
        m.identity().scale(new THREE.Vector3(1.2, 0.85, 0.85)).setPosition(sx + Math.cos(a + 0.7) * 0.20, sy + ty + 0.075, sz + Math.sin(a + 0.7) * 0.20);
        b.addGeo(cocoonGeo, '#EAE6DA', '#FAF8F2', m);
      }
    }
    // Woven open-rimmed mulberry basket with arched bamboo handle
    b.addRevolved(sx + 0.92, sy, sz + 0.25, [[0.22, 0], [0.34, 0.24], [0.36, 0.34], [0.33, 0.35]], 8, '#877045', '#B9A16B');
    b.addBeam([sx + 0.62, sy + 0.32, sz + 0.25], [sx + 0.92, sy + 0.56, sz + 0.25], 0.016, 0.016, 4, '#7E673E', '#A38C58');
    b.addBeam([sx + 0.92, sy + 0.56, sz + 0.25], [sx + 1.22, sy + 0.32, sz + 0.25], 0.016, 0.016, 4, '#7E673E', '#A38C58');
    m.identity().scale(new THREE.Vector3(1.5, 0.55, 1.4)).setPosition(sx + 0.92, sy + 0.34, sz + 0.25);
    b.addGeo(leafGeo, '#538246', '#7BA85D', m);

    trayFloor.dispose();
    leafGeo.dispose();
    cocoonGeo.dispose();
    return makeVignetteMesh(b.build(), 'seasonal-vignette-spring', true);
  })();

  // 2B. SUMMER: 竹荫纳凉席与井水浸瓜 (Bamboo-shade bordered rush mat, hooped wooden tub, chilled melons & palm fan)
  const summerMesh = (() => {
    const b = createMiniBaker();
    const bamReg = leisureGrove?.layout?.regions?.find(r => r.kind === 'bamboo');
    const bx = bamReg ? bamReg.x + 3.4 : (village?.bamboo?.[0]?.[0] ?? 56) + 2.8;
    const bz = bamReg ? bamReg.z + 2.6 : (village?.bamboo?.[0]?.[1] ?? -142) + 2.4;
    const by = sampleY(bx, bz);
    const m = new THREE.Matrix4();

    // Woven rush mat with cloth border (凉席镶边)
    const matBorder = new THREE.BoxGeometry(2.04, 0.028, 1.44);
    m.identity().makeRotationY(0.28).setPosition(bx, by + 0.016, bz);
    b.addGeo(matBorder, '#766444', '#8C7852', m);
    matBorder.dispose();
    const matBox = new THREE.BoxGeometry(1.88, 0.036, 1.28);
    m.identity().makeRotationY(0.28).setPosition(bx, by + 0.024, bz);
    b.addGeo(matBox, '#A69864', '#C8BA82', m);
    matBox.dispose();

    // Open-rimmed hooped wooden stave tub of cool spring water + 2 jade melons
    b.addRevolved(bx + 0.52, by, bz - 0.18, [[0.29, 0], [0.36, 0.28], [0.34, 0.29]], 9, '#6A5138', '#8F7150');
    b.addRevolved(bx + 0.52, by + 0.09, bz - 0.18, [[0.328, 0], [0.335, 0.028]], 9, '#48392B', '#5C4A38');
    b.addRevolved(bx + 0.52, by + 0.21, bz - 0.18, [[0.355, 0], [0.362, 0.028]], 9, '#48392B', '#5C4A38');
    const waterDisc = new THREE.CylinderGeometry(0.32, 0.32, 0.016, 9);
    m.identity().setPosition(bx + 0.52, by + 0.22, bz - 0.18);
    b.addGeo(waterDisc, '#6E9B92', '#8BB8AF', m);
    const melon = new THREE.SphereGeometry(0.13, 7, 6);
    m.identity().scale(new THREE.Vector3(1.15, 0.92, 1.0)).setPosition(bx + 0.44, by + 0.24, bz - 0.22);
    b.addGeo(melon, '#3E6E42', '#5F9458', m);
    m.identity().scale(new THREE.Vector3(0.95, 0.88, 0.95)).setPosition(bx + 0.63, by + 0.23, bz - 0.12);
    b.addGeo(melon, '#487A4A', '#6DA362', m);

    // Sculpted waisted stone drum stool & woven palm-leaf fan (蒲扇)
    b.addRevolved(bx - 0.58, by, bz + 0.16, [[0.28, 0], [0.24, 0.12], [0.30, 0.24], [0.27, 0.26]], 8, '#737970', '#9AA095', 0, true);
    const fan = new THREE.CylinderGeometry(0.18, 0.18, 0.016, 7);
    m.identity().makeRotationZ(0.08).scale(new THREE.Vector3(1.1, 1, 0.92)).setPosition(bx - 0.12, by + 0.052, bz + 0.22);
    b.addGeo(fan, '#B5A66E', '#D5C78E', m);
    b.addBeam([bx - 0.12, by + 0.055, bz + 0.22], [bx - 0.29, by + 0.055, bz + 0.35], 0.016, 0.013, 4, '#7D6744', '#9A8158');

    waterDisc.dispose();
    melon.dispose();
    fan.dispose();
    return makeVignetteMesh(b.build(), 'seasonal-vignette-summer', false);
  })();

  // 2C. AUTUMN: 秋熟谷垛、连枷与晒柿竹匾 (Sculpted shouldered grain stacks, threshing flail & rimmed persimmon tray)
  const autumnMesh = (() => {
    const b = createMiniBaker();
    const thresh = props?.marks?.find(mk => mk.kind === 'thresh');
    const tx = thresh ? thresh.x + (thresh.r || 6.2) + 1.45 : 46;
    const tz = thresh ? thresh.z - 1.2 : -132;
    const ty = sampleY(tx, tz);
    const m = new THREE.Matrix4();

    const stacks = [
      [0, 0, 1.0],
      [-1.38, 0.62, 0.82],
      [1.22, 0.78, 0.74]
    ];
    for (const [ox, oz, sc] of stacks) {
      const gx = tx + ox, gz = tz + oz;
      const gy = sampleY(gx, gz);
      b.addRevolved(gx, gy - 0.02, gz, [
        [0.86 * sc, 0], [0.78 * sc, 0.44 * sc], [0.90 * sc, 0.82 * sc],
        [0.64 * sc, 1.26 * sc], [0.24 * sc, 1.56 * sc], [0.04 * sc, 1.68 * sc]
      ], 9, '#9C7C3D', '#DFBA62', ox);
      b.addBeam([gx, gy + 1.50 * sc, gz], [gx, gy + 1.84 * sc, gz], 0.045 * sc, 0.038 * sc, 5, '#59432E', '#755A3E');
    }

    // Wooden threshing flail (连枷) leaning against main grain stack
    b.addBeam([tx + 0.92, ty - 0.04, tz - 0.45], [tx + 0.36, ty + 1.52, tz - 0.14], 0.028, 0.024, 5, '#6B5238', '#8B6D4B');
    b.addBeam([tx + 0.36, ty + 1.52, tz - 0.14], [tx + 0.56, ty + 1.12, tz - 0.34], 0.034, 0.032, 5, '#59432E', '#7A5E42');

    // Rimmed bamboo winnowing tray with crimson persimmons & golden millet
    const tray = new THREE.CylinderGeometry(0.55, 0.53, 0.02, 9);
    const persimmon = new THREE.SphereGeometry(0.085, 6, 5);
    const px = tx - 0.35, pz = tz - 1.25;
    const py = sampleY(px, pz);
    m.identity().setPosition(px, py + 0.025, pz);
    b.addGeo(tray, '#9B8350', '#C2AA72', m);
    b.addRevolved(px, py + 0.01, pz, [[0.54, 0], [0.60, 0.08], [0.57, 0.085]], 9, '#8B7445', '#C8B078');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      m.identity().scale(new THREE.Vector3(1.05, 0.80, 1.05)).setPosition(px + Math.cos(a) * 0.24, py + 0.095, pz + Math.sin(a) * 0.24);
      b.addGeo(persimmon, '#BF4E2E', '#DF6B3A', m);
    }

    tray.dispose();
    persimmon.dispose();
    return makeVignetteMesh(b.build(), 'seasonal-vignette-autumn', false);
  })();

  // 2D. WINTER: 冬日暖牛栏与茅檐冰凌 (Crafted Qin-Han hipped thatched ox pavilion, hollow hay manger, layered straw & eave icicles)
  const oxAnchor = oxPlowing?.getRestAnchor?.() || { x: 24, y: sampleY(24, -138), z: -138, yaw: 0 };
  const winterMesh = (() => {
    const b = createMiniBaker();
    const m = new THREE.Matrix4();
    const ax = oxAnchor.x;
    const az = oxAnchor.z;
    const ay = sampleY(ax, az);
    const yaw = oxAnchor.yaw || 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const toOx = (lat, h, fwd) => [ax + rx * lat + fx * fwd, ay + h, az + rz * lat + fz * fwd];

    // Layered dry golden straw bedding under resting ox (soft stepped cushion + scattered sheaves)
    b.addRevolved(ax - rx * 0.28, ay - 0.01, az - rz * 0.28, [[1.52, 0], [1.34, 0.06], [0.85, 0.095]], 9, '#9A8149', '#CCB370', yaw, true);
    for (let k = 0; k < 4; k++) {
      const a = yaw + k * 1.48 + 0.3;
      const sx = ax - rx * 0.32 + Math.cos(a) * 0.72;
      const sz = az - rz * 0.32 + Math.sin(a) * 0.72;
      b.addBeam([sx - Math.cos(a) * 0.34, ay + 0.05, sz - Math.sin(a) * 0.34], [sx + Math.cos(a) * 0.34, ay + 0.09, sz + Math.sin(a) * 0.34], 0.065, 0.052, 5, '#A68D50', '#D4BC7B');
    }

    // Crafted Qin-Han 4-post timber-framed hipped thatch ox pavilion (石础、立柱、围枋、斜撑、飞椽与双折积雪茅顶)
    // Lateral range [-1.82 .. +0.52] stays 100% clear of the adjacent flooded paddy on +rx!
    const shedLatC = -0.65;
    const shedFwdC = -0.15;
    const posts = [
      [-1.82, -1.52, 2.08],
      [ 0.52, -1.52, 2.08],
      [-1.82,  1.22, 2.08],
      [ 0.52,  1.22, 2.08]
    ];
    const postWorld = posts.map(([lat, fwd, h]) => {
      const wx = ax + rx * lat + fx * fwd;
      const wz = az + rz * lat + fz * fwd;
      const wy = sampleY(wx, wz);
      // Stone post plinth (柱础)
      b.addRevolved(wx, wy - 0.06, wz, [[0.16, 0], [0.13, 0.16]], 6, '#6E7469', '#999E93', yaw, true);
      b.addBeam([wx, wy + 0.04, wz], [wx, ay + h, wz], 0.072, 0.062, 6, '#594533', '#755B43');
      return [wx, ay + h, wz];
    });
    // Perimeter tie beams, back windbreak rail & diagonal timber knee braces (斜撑)
    b.addBeam(postWorld[0], postWorld[1], 0.056, 0.056, 5, '#594533', '#6E563F');
    b.addBeam(postWorld[2], postWorld[3], 0.056, 0.056, 5, '#594533', '#6E563F');
    b.addBeam(postWorld[0], postWorld[2], 0.056, 0.056, 5, '#594533', '#6E563F');
    b.addBeam(postWorld[1], postWorld[3], 0.056, 0.056, 5, '#594533', '#6E563F');
    // Low dry-side rail slats on back (-fwd) and outer (-lat) edges to shelter the ox from north winter wind
    for (const rh of [0.68, 1.24]) {
      b.addBeam(toOx(-1.82, rh, -1.52), toOx(0.52, rh, -1.52), 0.038, 0.038, 4, '#6A523B', '#82674A');
      b.addBeam(toOx(-1.82, rh, -1.52), toOx(-1.82, rh, 1.22), 0.038, 0.038, 4, '#6A523B', '#82674A');
    }
    for (const [lat, fwd] of [[-1.82, -1.52], [0.52, -1.52], [-1.82, 1.22], [0.52, 1.22]]) {
      const inwardLat = lat < shedLatC ? lat + 0.42 : lat - 0.42;
      const inwardFwd = fwd < shedFwdC ? fwd + 0.42 : fwd - 0.42;
      b.addBeam(toOx(lat, 1.64, fwd), toOx(inwardLat, 2.06, fwd), 0.034, 0.032, 4, '#594533', '#705840');
      b.addBeam(toOx(lat, 1.64, fwd), toOx(lat, 2.06, inwardFwd), 0.034, 0.032, 4, '#594533', '#705840');
    }

    // Two-tier concave hipped Qin-Han thatch roof + overhanging rafters + sculpted winter snow blanket
    const eLat0 = -2.28, eLat1 = 0.98, eFwd0 = -2.02, eFwd1 = 1.72;
    const mLat0 = -1.52, mLat1 = 0.22, mFwd0 = -1.24, mFwd1 = 0.94;
    const eY = 1.98, mY = 2.48, rY = 2.94;
    const ePts = [toOx(eLat0, eY, eFwd1), toOx(eLat1, eY, eFwd1), toOx(eLat1, eY, eFwd0), toOx(eLat0, eY, eFwd0)];
    const eDn = [toOx(eLat0, eY - 0.12, eFwd1), toOx(eLat1, eY - 0.12, eFwd1), toOx(eLat1, eY - 0.12, eFwd0), toOx(eLat0, eY - 0.12, eFwd0)];
    const mPts = [toOx(mLat0, mY, mFwd1), toOx(mLat1, mY, mFwd1), toOx(mLat1, mY, mFwd0), toOx(mLat0, mY, mFwd0)];
    const rFront = toOx(shedLatC, rY, shedFwdC + 0.48);
    const rBack = toOx(shedLatC, rY, shedFwdC - 0.48);

    // Protruding timber hip rafters
    for (let k = 0; k < 4; k++) {
      b.addBeam(ePts[k], k < 2 ? rFront : rBack, 0.042, 0.034, 4, '#5B4633', '#765B42');
    }
    // Warm thatch roof slopes & thick fascia eaves
    for (let k = 0; k < 4; k++) {
      const nk = (k + 1) % 4;
      b.addQuad(ePts[k], ePts[nk], mPts[nk], mPts[k], k % 2 === 0 ? '#AE9662' : '#9C8452');
      b.addQuad(ePts[k], eDn[k], eDn[nk], ePts[nk], '#6E5A36');
    }
    b.addQuad(mPts[3], mPts[0], rFront, rBack, '#A38B58');
    b.addQuad(mPts[1], mPts[2], rBack, rFront, '#A38B58');
    b.addTri(mPts[0], mPts[1], rFront, '#B59E6A');
    b.addTri(mPts[2], mPts[3], rBack, '#B59E6A');
    // Bound thatch ridge pole + snow drift blanket nestled on top of the thatch slopes
    b.addBeam(toOx(shedLatC, rY + 0.04, shedFwdC - 0.56), toOx(shedLatC, rY + 0.04, shedFwdC + 0.56), 0.10, 0.10, 6, '#B8A26F', '#947E50');
    const sPts = [
      toOx(eLat0 + 0.16, eY + 0.08, eFwd1 - 0.16),
      toOx(eLat1 - 0.16, eY + 0.08, eFwd1 - 0.16),
      toOx(eLat1 - 0.16, eY + 0.08, eFwd0 + 0.16),
      toOx(eLat0 + 0.16, eY + 0.08, eFwd0 + 0.16)
    ];
    const smPts = mPts.map(p => [p[0], p[1] + 0.065, p[2]]);
    const srF = [rFront[0], rFront[1] + 0.09, rFront[2]];
    const srB = [rBack[0], rBack[1] + 0.09, rBack[2]];
    for (let k = 0; k < 4; k++) {
      const nk = (k + 1) % 4;
      b.addQuad(sPts[k], sPts[nk], smPts[nk], smPts[k], '#ECEAE2');
    }
    b.addQuad(smPts[3], smPts[0], srF, srB, '#F4F2EA');
    b.addQuad(smPts[1], smPts[2], srB, srF, '#F4F2EA');
    b.addTri(smPts[0], smPts[1], srF, '#EFECE4');
    b.addTri(smPts[2], smPts[3], srB, '#EFECE4');
    b.addBeam([srB[0], srB[1] + 0.03, srB[2]], [srF[0], srF[1] + 0.03, srF[2]], 0.095, 0.095, 6, '#E6E4DC', '#F5F3EC');

    // Hollow planked wooden fodder manger on splayed trestle legs filled with golden hay sheaves!
    const tx = ax - rx * 1.18 + fx * 0.58;
    const tz = az - rz * 1.18 + fz * 0.58;
    const ty = sampleY(tx, tz);
    const toTr = (lx, ly, lz) => [tx + rx * lx + fx * lz, ty + ly, tz + rz * lx + fz * lz];
    const qYaw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    // 4 splayed timber legs
    for (const [lx, lz] of [[-0.24, -0.40], [0.24, -0.40], [-0.24, 0.40], [0.24, 0.40]]) {
      b.addBeam(toTr(lx * 1.12, -0.04, lz), toTr(lx * 0.85, 0.42, lz), 0.034, 0.030, 4, '#54402D', '#6D543C');
    }
    // Hollow plank trough sides + floor
    const floorGeo = new THREE.BoxGeometry(0.36, 0.04, 0.90);
    m.compose(new THREE.Vector3(...toTr(0, 0.24, 0)), qYaw, new THREE.Vector3(1, 1, 1));
    b.addGeo(floorGeo, '#5D4632', '#74583F', m);
    floorGeo.dispose();
    const sideGeo = new THREE.BoxGeometry(0.05, 0.24, 0.96);
    for (const sx of [-0.21, 0.21]) {
      m.compose(new THREE.Vector3(...toTr(sx, 0.36, 0)), qYaw, new THREE.Vector3(1, 1, 1));
      b.addGeo(sideGeo, '#6A513A', '#8D6E4F', m);
    }
    sideGeo.dispose();
    const endGeo = new THREE.BoxGeometry(0.46, 0.24, 0.05);
    for (const sz of [-0.46, 0.46]) {
      m.compose(new THREE.Vector3(...toTr(0, 0.36, sz)), qYaw, new THREE.Vector3(1, 1, 1));
      b.addGeo(endGeo, '#624A35', '#826447', m);
    }
    endGeo.dispose();
    // Piled golden winter hay sheaves spilling above the trough rim
    for (let k = -1; k <= 1; k++) {
      b.addBeam(toTr(-0.14, 0.42, k * 0.26 - 0.14), toTr(0.14, 0.48, k * 0.26 + 0.14), 0.10, 0.085, 5, '#B29654', '#DEC47C');
    }

    // Cottage Eave Icicles (茅檐冰凌) across up to 6 village houses
    const houses = village?.houseInfo || [];
    const overhang = world?.village?.houses?.overhang ?? 0.45;
    const icicleCone = new THREE.ConeGeometry(0.026, 0.24, 4);
    const rngIce = lcg(20261221);
    for (let hi = 0; hi < Math.min(6, houses.length); hi++) {
      const h = houses[hi];
      const cr = Math.cos(h.rot), sr = Math.sin(h.rot);
      const frontDist = h.d * 0.5 + overhang * 0.88;
      const eaveY = h.gy + h.h - 0.03;
      const count = 9;
      for (let k = 0; k < count; k++) {
        const lx = ((k / (count - 1)) - 0.5) * (h.w * 0.92);
        const lenScale = 0.65 + rngIce() * 0.75;
        const ix = h.x + cr * lx + sr * frontDist;
        const iz = h.z - sr * lx + cr * frontDist;
        m.identity()
          .makeRotationX(Math.PI)
          .scale(new THREE.Vector3(1, lenScale, 1))
          .setPosition(ix, eaveY - 0.11 * lenScale, iz);
        b.addGeo(icicleCone, '#DCE8EE', '#F8FCFE', m);
      }
    }
    icicleCone.dispose();

    return makeVignetteMesh(b.build(), 'seasonal-vignette-winter', false);
  })();

  // --------------------------------------------------------------------------
  // 3. Winter Ox Frosty Breath Puffs (老牛呵气成霜)
  // --------------------------------------------------------------------------
  const BREATH_COUNT = 6;
  const breathGeo = new THREE.OctahedronGeometry(0.09, 0);
  const breathMat = new THREE.MeshBasicMaterial({
    color: '#F2F4EE',
    transparent: true,
    opacity: 0.34,
    depthWrite: false
  });
  breathMat.userData.skyIgnore = true;
  ownedGeos.push(breathGeo);
  ownedMats.push(breathMat);
  const breathMesh = new THREE.InstancedMesh(breathGeo, breathMat, BREATH_COUNT);
  breathMesh.name = 'winter-ox-breath';
  breathMesh.frustumCulled = false;
  breathMesh.visible = false;
  group.add(breathMesh);

  // --------------------------------------------------------------------------
  // 4. Autumn Southbound Wild Geese V-Formation (秋空南飞雁阵)
  // --------------------------------------------------------------------------
  const GEESE_COUNT = 9;
  const gooseGeo = buildGooseGeometry();
  const goosePhases = new Float32Array(GEESE_COUNT);
  for (let i = 0; i < GEESE_COUNT; i++) goosePhases[i] = i * 0.68;
  gooseGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(goosePhases, 1));
  const geeseMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color('#DCE4DF') },
      uFogNear: { value: 90 },
      uFogFar: { value: 360 },
      uOpacity: { value: 0.90 }
    },
    vertexShader: GEESE_VERT,
    fragmentShader: GEESE_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide
  });
  geeseMat.userData.skyIgnore = true;
  ownedGeos.push(gooseGeo);
  ownedMats.push(geeseMat);
  const geeseMesh = new THREE.InstancedMesh(gooseGeo, geeseMat, GEESE_COUNT);
  geeseMesh.name = 'autumn-wild-geese';
  geeseMesh.frustumCulled = false;
  geeseMesh.visible = false;
  group.add(geeseMesh);

  // V-formation offsets relative to lead goose (人字雁阵)
  const geeseOffsets = [{ lat: 0, back: 0, dy: 0 }];
  for (let w = 1; w <= 4; w++) {
    geeseOffsets.push({ lat: -w * 1.65, back: -w * 1.95, dy: w * 0.14 });
    geeseOffsets.push({ lat:  w * 1.72, back: -w * 2.10, dy: w * 0.12 });
  }

  // --------------------------------------------------------------------------
  // 5. Winter Fading Snow Footprints (踏雪留痕)
  // --------------------------------------------------------------------------
  const FOOTPRINT_MAX = 28;
  const fpGeo = new THREE.CircleGeometry(0.16, 7);
  fpGeo.rotateX(-Math.PI * 0.5);
  fpGeo.scale(0.76, 1, 1.38);
  const fpMat = new THREE.MeshBasicMaterial({
    color: '#B6C1C7',
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2
  });
  fpMat.userData.skyIgnore = true;
  ownedGeos.push(fpGeo);
  ownedMats.push(fpMat);
  const footprintMesh = new THREE.InstancedMesh(fpGeo, fpMat, FOOTPRINT_MAX);
  footprintMesh.name = 'winter-snow-footprints';
  footprintMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  footprintMesh.frustumCulled = false;
  footprintMesh.visible = false;
  group.add(footprintMesh);

  const footprints = Array.from({ length: FOOTPRINT_MAX }, () => ({
    active: false, x: 0, y: -999, z: 0, yaw: 0, age: 99
  }));
  let fpCursor = 0;
  let lastStepX = NaN;
  let lastStepZ = NaN;
  let stepSide = 1;
  const FOOTPRINT_LIFE = 9.5;

  function stampFootprint(x, z, yaw) {
    const gy = sampleY(x, z);
    if (!Number.isFinite(gy) || gy < waterLevel + 0.35) return false;
    const rx = Math.cos(yaw) * 0.13 * stepSide;
    const rz = -Math.sin(yaw) * 0.13 * stepSide;
    stepSide = -stepSide;
    const px = x + rx;
    const pz = z + rz;
    const py = sampleY(px, pz) + 0.028;
    const slot = footprints[fpCursor];
    fpCursor = (fpCursor + 1) % FOOTPRINT_MAX;
    slot.active = true;
    slot.x = px;
    slot.y = py;
    slot.z = pz;
    slot.yaw = yaw;
    slot.age = 0;
    return true;
  }

  // --------------------------------------------------------------------------
  // 6. Post-Rain Xuan-Paper Double Rainbow (雨后初霁 · 东岭残虹)
  // --------------------------------------------------------------------------
  const rainbowGeo = buildRainbowArchGeometry(44);
  const rainbowMat = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color('#E2EBE6') }
    },
    vertexShader: RAINBOW_VERT,
    fragmentShader: RAINBOW_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  rainbowMat.userData.skyIgnore = true;
  ownedGeos.push(rainbowGeo);
  ownedMats.push(rainbowMat);
  const rainbowMesh = new THREE.Mesh(rainbowGeo, rainbowMat);
  rainbowMesh.name = 'post-rain-rainbow';
  rainbowMesh.position.set(178, 8, -144);
  rainbowMesh.rotation.set(0, 0.22, 0.06);
  rainbowMesh.frustumCulled = false;
  rainbowMesh.visible = false;
  rainbowMesh.renderOrder = 2;
  group.add(rainbowMesh);

  let postRainTimer = 0;
  let rainbowAlpha = 0;
  let prevRainIntensity = Number(sky?.rainIntensity ?? 0);
  let prevWeatherId = sky?.weatherId || 'clear';
  let prevTimeId = sky?.timeId || 'day';

  // --------------------------------------------------------------------------
  // 7. Dusk/Night Staggered Lamp-Lighting & Paper-Window Silhouettes (纸窗灯影)
  // --------------------------------------------------------------------------
  const houses = village?.houseInfo || [];
  const winHouseCount = houses.length;
  let windowSilMesh = null;
  let windowSilMat = null;
  let duskKindleTime = 0;
  let lampMasterGain = 0;

  if (winHouseCount > 0) {
    const winGeo = new THREE.PlaneGeometry(1, 1);
    const delays = new Float32Array(winHouseCount);
    const kinds = new Float32Array(winHouseCount);
    for (let i = 0; i < winHouseCount; i++) {
      delays[i] = i * 1.05; // Sequential lamp-lighting over ~5.5s
      kinds[i] = i % 3;     // 0: weaver, 1: scroll reader, 2: evening tea
    }
    winGeo.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delays, 1));
    winGeo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
    windowSilMat = new THREE.ShaderMaterial({
      uniforms: {
        uKindleTime: { value: 0 },
        uMasterGain: { value: 0 },
        uSimTime: { value: 0 }
      },
      vertexShader: WINDOW_SIL_VERT,
      fragmentShader: WINDOW_SIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    windowSilMat.userData.skyIgnore = true;
    ownedGeos.push(winGeo);
    ownedMats.push(windowSilMat);

    windowSilMesh = new THREE.InstancedMesh(winGeo, windowSilMat, winHouseCount);
    windowSilMesh.name = 'night-window-silhouettes';
    windowSilMesh.visible = false;
    windowSilMesh.renderOrder = 4;
    const dummyW = new THREE.Object3D();
    for (let i = 0; i < winHouseCount; i++) {
      const h = houses[i];
      const side = i % 2 === 0 ? -1 : 1;
      const localX = side * h.w * 0.29;
      const front = h.d * 0.5 + 0.074;
      dummyW.position.set(
        h.x + Math.cos(h.rot) * localX + Math.sin(h.rot) * front,
        h.gy + h.h * 0.56,
        h.z - Math.sin(h.rot) * localX + Math.cos(h.rot) * front
      );
      dummyW.rotation.set(0, h.rot, 0);
      dummyW.scale.set(0.66, 0.71, 1);
      dummyW.updateMatrix();
      windowSilMesh.setMatrixAt(i, dummyW.matrix);
    }
    windowSilMesh.instanceMatrix.needsUpdate = true;
    windowSilMesh.computeBoundingSphere();
    group.add(windowSilMesh);
  }

  // --------------------------------------------------------------------------
  // 8. Public API: setPhenology, triggerPostRain, update, getStats, dispose
  // --------------------------------------------------------------------------
  const _dummy = new THREE.Object3D();

  function updateGeeseMatrices(t, fogObj) {
    // Flight path from NNW (-36, -275) across valley sky to SSE (88, 95)
    const cycle = ((t * 0.0155 + 0.36) % 1 + 1) % 1;
    const edgeFade = Math.sin(cycle * Math.PI);
    const dirX = 0.316, dirZ = 0.949;
    const rightX = dirZ, rightZ = -dirX;
    const yaw = Math.atan2(dirX, dirZ);
    const leadX = -32 + dirX * (cycle - 0.5) * 340;
    const leadZ = -132 + dirZ * (cycle - 0.5) * 340;
    const leadY = 82 + Math.sin(t * 0.28) * 1.8;

    for (let i = 0; i < GEESE_COUNT; i++) {
      const o = geeseOffsets[i];
      const bob = Math.sin(t * 1.8 + i * 0.7) * 0.14;
      const gx = leadX + rightX * o.lat + dirX * o.back;
      const gz = leadZ + rightZ * o.lat + dirZ * o.back;
      const gy = leadY + o.dy + bob;
      _dummy.position.set(gx, gy, gz);
      _dummy.rotation.set(0, yaw, Math.sin(t * 0.9 + i) * 0.04, 'YXZ');
      const sc = i === 0 ? 1.12 : 0.98;
      _dummy.scale.setScalar(sc);
      _dummy.updateMatrix();
      geeseMesh.setMatrixAt(i, _dummy.matrix);
    }
    geeseMesh.instanceMatrix.needsUpdate = true;
    geeseMat.uniforms.uTime.value = t;
    geeseMat.uniforms.uOpacity.value = 0.88 * clamp(edgeFade * 2.2, 0, 1);
    if (fogObj?.color) {
      geeseMat.uniforms.uFogColor.value.copy(fogObj.color);
      if (Number.isFinite(fogObj.near)) geeseMat.uniforms.uFogNear.value = fogObj.near;
      if (Number.isFinite(fogObj.far)) geeseMat.uniforms.uFogFar.value = fogObj.far;
    }
  }

  function updateOxBreathMatrices(t) {
    const yaw = oxAnchor.yaw || 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const muzzleX = oxAnchor.x + fx * 0.92;
    const muzzleZ = oxAnchor.z + fz * 0.92;
    const muzzleY = sampleY(oxAnchor.x, oxAnchor.z) + 0.58;

    for (let i = 0; i < BREATH_COUNT; i++) {
      const side = i % 2 === 0 ? -0.09 : 0.09;
      const u = ((t * 0.32 + i / BREATH_COUNT) % 1 + 1) % 1;
      // Exhale burst in first 55% of cycle, dissipate smoothly
      const env = u < 0.68 ? Math.sin((u / 0.68) * Math.PI) : 0;
      const sc = env * (0.45 + u * 1.25);
      _dummy.position.set(
        muzzleX + rx * side + fx * (u * 0.52),
        muzzleY + u * 0.42,
        muzzleZ + rz * side + fz * (u * 0.52)
      );
      _dummy.rotation.set(t * 0.6 + i, t * 0.4, 0);
      _dummy.scale.setScalar(Math.max(0.0001, sc));
      _dummy.updateMatrix();
      breathMesh.setMatrixAt(i, _dummy.matrix);
    }
    breathMesh.instanceMatrix.needsUpdate = true;
  }

  function setPhenology(id) {
    const next = (id === 'summer' || id === 'autumn' || id === 'winter') ? id : 'spring';
    currentPhenology = next;

    springMesh.visible = next === 'spring';
    summerMesh.visible = next === 'summer';
    autumnMesh.visible = next === 'autumn';
    winterMesh.visible = next === 'winter';

    applyCropStature(next);

    if (next === 'autumn') {
      const timeId = sky?.timeId || 'day';
      const rain = Number(sky?.rainIntensity ?? 0);
      geeseMesh.visible = timeId !== 'night' && rain < 0.45;
      if (geeseMesh.visible) updateGeeseMatrices(simTime, group.parent?.fog);
    } else {
      geeseMesh.visible = false;
    }

    if (next === 'winter') {
      breathMesh.visible = true;
      updateOxBreathMatrices(simTime);
    } else {
      breathMesh.visible = false;
      footprintMesh.visible = false;
      for (let i = 0; i < FOOTPRINT_MAX; i++) footprints[i].active = false;
      lastStepX = NaN;
      lastStepZ = NaN;
    }
    return true;
  }

  function triggerPostRain(durationSec = 32) {
    postRainTimer = Math.max(postRainTimer, durationSec);
  }

  function update(dt, elapsed, liveSky = sky, playerState = player?.state) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(0.1, dt);
    const fastJump = dt >= 1.2;
    simTime += step;

    const timeId = liveSky?.timeId || 'day';
    const weatherId = liveSky?.weatherId || 'clear';
    const rain = Number(liveSky?.rainIntensity ?? 0);

    // 1. Detect rain -> clear/mist transition for 30s post-rain rainbow & valley mist bloom
    if ((prevWeatherId === 'rain' || prevRainIntensity > 0.22) && weatherId !== 'rain' && rain < 0.14) {
      postRainTimer = 32;
    }
    prevWeatherId = weatherId;
    prevRainIntensity = rain;

    if (postRainTimer > 0) {
      postRainTimer = Math.max(0, postRainTimer - (fastJump ? 0.5 : step));
    }

    // Rainbow target opacity: post-rain bloom OR gentle summer morning/mist afterglow
    const sunOut = (timeId === 'day' || timeId === 'dawn' || timeId === 'dusk') && rain < 0.16;
    let targetRainbow = 0;
    if (sunOut && postRainTimer > 0) {
      const bell = Math.min(1, postRainTimer / 6.0);
      targetRainbow = 0.42 * bell;
    } else if (currentPhenology === 'summer' && weatherId === 'mist' && (timeId === 'dawn' || timeId === 'day') && rain < 0.08) {
      targetRainbow = 0.30;
    }
    const rbRate = fastJump ? 18 : 1.6;
    rainbowAlpha += (targetRainbow - rainbowAlpha) * (1 - Math.exp(-rbRate * step));
    if (rainbowAlpha > 0.004) {
      rainbowMesh.visible = true;
      rainbowMat.uniforms.uOpacity.value = rainbowAlpha;
      rainbowMat.uniforms.uTime.value = simTime;
      const fogObj = group.parent?.fog;
      if (fogObj?.color) rainbowMat.uniforms.uFogColor.value.copy(fogObj.color);
    } else {
      rainbowMesh.visible = false;
    }

    // 2. Dusk/Night sequential cottage lamp-lighting & paper-window silhouettes
    if (windowSilMesh && windowSilMat) {
      const isEvening = timeId === 'dusk' || timeId === 'night';
      if (isEvening && prevTimeId !== 'dusk' && prevTimeId !== 'night' && !fastJump) {
        duskKindleTime = 0;
      }
      if (isEvening) {
        duskKindleTime = fastJump ? 12 : Math.min(20, duskKindleTime + step);
      } else {
        duskKindleTime = Math.max(0, duskKindleTime - step * 3.0);
      }
      const targetLamp = timeId === 'night' ? 1.0 : timeId === 'dusk' ? 0.72 : 0.0;
      const lampRate = fastJump ? 20 : 1.4;
      lampMasterGain += (targetLamp - lampMasterGain) * (1 - Math.exp(-lampRate * step));
      if (lampMasterGain > 0.005) {
        windowSilMesh.visible = true;
        windowSilMat.uniforms.uKindleTime.value = duskKindleTime;
        windowSilMat.uniforms.uMasterGain.value = lampMasterGain;
        windowSilMat.uniforms.uSimTime.value = simTime;
      } else {
        windowSilMesh.visible = false;
      }
    }
    prevTimeId = timeId;

    // 3. Autumn southbound wild geese
    if (currentPhenology === 'autumn' && timeId !== 'night' && rain < 0.45) {
      geeseMesh.visible = true;
      updateGeeseMatrices(simTime, group.parent?.fog);
    } else {
      geeseMesh.visible = false;
    }

    // 4. Winter ox breath & player snow footprints
    if (currentPhenology === 'winter') {
      breathMesh.visible = true;
      updateOxBreathMatrices(simTime);

      if (playerState && !playerState.aboardSkiff && Number.isFinite(playerState.x) && Number.isFinite(playerState.z)) {
        const px = playerState.x;
        const pz = playerState.z;
        const py = Number.isFinite(playerState.y) ? playerState.y : sampleY(px, pz);
        const gy = sampleY(px, pz);
        const onSnowGround = Math.abs(py - gy) < 0.55 && gy > waterLevel + 0.35;
        if (onSnowGround) {
          if (!Number.isFinite(lastStepX)) {
            lastStepX = px;
            lastStepZ = pz;
          } else {
            const dStep = Math.hypot(px - lastStepX, pz - lastStepZ);
            if (dStep >= 0.68) {
              const moveYaw = Math.atan2(px - lastStepX, pz - lastStepZ);
              stampFootprint(px, pz, moveYaw);
              lastStepX = px;
              lastStepZ = pz;
            }
          }
        }
      }

      let anyActiveFp = false;
      for (let i = 0; i < FOOTPRINT_MAX; i++) {
        const fp = footprints[i];
        if (!fp.active) {
          _dummy.position.set(0, -999, 0);
          _dummy.scale.setScalar(0.0001);
          _dummy.updateMatrix();
          footprintMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }
        fp.age += step;
        if (fp.age >= FOOTPRINT_LIFE) {
          fp.active = false;
          _dummy.position.set(0, -999, 0);
          _dummy.scale.setScalar(0.0001);
          _dummy.updateMatrix();
          footprintMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }
        anyActiveFp = true;
        const fade = 1 - fp.age / FOOTPRINT_LIFE;
        _dummy.position.set(fp.x, fp.y, fp.z);
        _dummy.rotation.set(0, fp.yaw, 0);
        _dummy.scale.setScalar(0.55 + 0.45 * fade);
        _dummy.updateMatrix();
        footprintMesh.setMatrixAt(i, _dummy.matrix);
      }
      footprintMesh.visible = anyActiveFp;
      if (anyActiveFp) footprintMesh.instanceMatrix.needsUpdate = true;
    } else {
      breathMesh.visible = false;
      footprintMesh.visible = false;
    }
  }

  function getPostRainBoost() {
    return postRainTimer > 0 ? clamp(postRainTimer / 32, 0, 1) : 0;
  }

  function getStats() {
    let drawCalls = 0;
    for (const m of [springMesh, summerMesh, autumnMesh, winterMesh, breathMesh, geeseMesh, footprintMesh, rainbowMesh, windowSilMesh]) {
      if (m && m.visible) drawCalls++;
    }
    const activeFootprints = footprints.reduce((acc, f) => acc + (f.active ? 1 : 0), 0);
    return {
      phenology: currentPhenology,
      drawCalls,
      geeseVisible: geeseMesh.visible,
      rainbowVisible: rainbowMesh.visible,
      rainbowOpacity: +rainbowAlpha.toFixed(3),
      postRainBoost: +getPostRainBoost().toFixed(3),
      windowSilhouettesVisible: Boolean(windowSilMesh?.visible),
      oxBreathVisible: breathMesh.visible,
      activeFootprints,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const g of ownedGeos) g.dispose();
    for (const m of ownedMats) m.dispose();
    group.removeFromParent();
  }

  return {
    group,
    setPhenology,
    triggerPostRain,
    stampFootprint,
    getPostRainBoost,
    update,
    getStats,
    dispose
  };
}
