import * as THREE from 'three';
import { chainProgramCacheKey } from './shader-cache-key.js';

const TAU = Math.PI * 2;
const PI = Math.PI;
const UP = new THREE.Vector3(0, 1, 0);

const MAX_WAKE_SLOTS = 48;
const BIRD_CAPACITY = 24;
const DAY_BIRD_COUNT = 14;
const STREAM_PETAL_COUNT = 180;
const SPINE_SAMPLES = 512;

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function inlineChokeFactor(terrainCfg, x, z) {
  const ch = terrainCfg && terrainCfg.choke;
  if (!ch) return 1;
  const d = Math.hypot(x - ch.x, z - ch.z);
  return 1 - (1 - ch.factor) * (1 - smoothstep(ch.r0, ch.r1, d));
}

function parseColorInto(input, out, fallbackHex) {
  if (!input) {
    out.setHex(fallbackHex, THREE.SRGBColorSpace);
    return out;
  }
  if (input.isColor) {
    out.copy(input);
    return out;
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    out.setHex(input, THREE.SRGBColorSpace);
    return out;
  }
  if (typeof input === 'string') {
    const start = input.charCodeAt(0) === 35 ? 1 : 0;
    const len = input.length - start;
    if (len === 6) {
      let hex = 0;
      let valid = true;
      for (let i = 0; i < 6; i++) {
        const cc = input.charCodeAt(start + i);
        let v = -1;
        if (cc >= 48 && cc <= 57) v = cc - 48;
        else if (cc >= 65 && cc <= 70) v = cc - 55;
        else if (cc >= 97 && cc <= 102) v = cc - 87;
        if (v < 0) { valid = false; break; }
        hex = (hex << 4) | v;
      }
      if (valid) {
        out.setHex(hex, THREE.SRGBColorSpace);
        return out;
      }
    }
    out.set(input);
    return out;
  }
  out.setHex(fallbackHex, THREE.SRGBColorSpace);
  return out;
}

function clampColorMax(col, maxChannel) {
  const m = Math.max(col.r, col.g, col.b);
  if (m > maxChannel && m > 1e-6) {
    const s = maxChannel / m;
    col.r *= s;
    col.g *= s;
    col.b *= s;
  }
  return col;
}

// ============================================================================
// 1. 山脊苔点远树 (Song-Yuan distant mountain pine / ink-dot tree, 43 tris)
// ============================================================================
function buildRidgeInkTreeGeometry() {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  let vCount = 0;

  const cBarkBase = new THREE.Color('#332B26');
  const cBarkTop = new THREE.Color('#4A3F38');
  const cUnderCore = new THREE.Color('#263E38');
  const cUnderRim = new THREE.Color('#2F4B44');
  const cMidGreen = new THREE.Color('#4D7366');
  const cUpperCyan = new THREE.Color('#587E74');
  const tmpC = new THREE.Color();

  function addVert(x, y, z, nx, ny, nz, c) {
    const nl = Math.hypot(nx, ny, nz) || 1;
    pos.push(x, y, z);
    nor.push(nx / nl, ny / nl, nz / nl);
    col.push(c.r, c.g, c.b);
    return vCount++;
  }

  // Slender tapered 3-sided trunk (-0.06..0.44) + leaning upper bough (0.44..0.86) = 9 tris
  const b0 = [];
  const b1 = [];
  for (let s = 0; s < 3; s++) {
    const a = (s / 3) * TAU + 0.35;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    b0.push(addVert(ca * 0.036, -0.06, sa * 0.036, ca, 0.08, sa, cBarkBase));
    b1.push(addVert(0.018 + ca * 0.022, 0.44, -0.008 + sa * 0.022, ca, 0.12, sa, cBarkTop));
  }
  const bApex = addVert(0.035, 0.86, 0.005, 0.15, 0.98, 0.05, cBarkTop);

  for (let s = 0; s < 3; s++) {
    const s2 = (s + 1) % 3;
    idx.push(b0[s], b0[s2], b1[s2]);
    idx.push(b0[s], b1[s2], b1[s]);
    idx.push(b1[s], b1[s2], bApex);
  }

  // 3 asymmetric horizontal-layered Song-pine crown pads (6 + 6 + 5 sides -> 12 + 12 + 10 = 34 tris; total 43 tris)
  const pads = [
    { cx: -0.065, cy: 0.50, cz: 0.022, rx: 0.46, rz: 0.40, topH: 0.115, botH: 0.058, sides: 6, rot: 0.22, lift: 0.0 },
    { cx: 0.105, cy: 0.69, cz: -0.030, rx: 0.39, rz: 0.34, topH: 0.105, botH: 0.052, sides: 6, rot: 0.85, lift: 0.38 },
    { cx: -0.020, cy: 0.88, cz: 0.015, rx: 0.31, rz: 0.28, topH: 0.098, botH: 0.048, sides: 5, rot: 1.48, lift: 0.85 }
  ];

  for (let p = 0; p < pads.length; p++) {
    const pad = pads[p];
    tmpC.copy(cMidGreen).lerp(cUpperCyan, 0.35 + pad.lift * 0.65);
    const vTop = addVert(
      pad.cx + (p === 1 ? -0.02 : 0.015),
      pad.cy + pad.topH,
      pad.cz,
      0.04, 1.0, 0.02,
      tmpC
    );
    const vBot = addVert(
      pad.cx,
      pad.cy - pad.botH,
      pad.cz,
      0.0, -1.0, 0.0,
      cUnderCore
    );

    const rimVerts = [];
    for (let s = 0; s < pad.sides; s++) {
      const a = (s / pad.sides) * TAU + pad.rot;
      const scallop = 1 + 0.12 * Math.sin(a * 2 + p * 1.7) + 0.07 * Math.cos(a * 3 - p);
      const dx = Math.cos(a) * pad.rx * scallop;
      const dz = Math.sin(a) * pad.rz * scallop;
      const dy = 0.014 * Math.sin(a * 2.0 + p);
      const sunMix = clamp(0.28 + 0.45 * pad.lift + 0.18 * Math.sin(a + 0.6), 0, 1);
      tmpC.copy(cUnderRim).lerp(cMidGreen, 0.62).lerp(cUpperCyan, sunMix * 0.55);
      rimVerts.push(addVert(
        pad.cx + dx,
        pad.cy + dy,
        pad.cz + dz,
        dx / (pad.rx || 1),
        0.38,
        dz / (pad.rz || 1),
        tmpC
      ));
    }

    for (let s = 0; s < pad.sides; s++) {
      const s2 = (s + 1) % pad.sides;
      // CCW from above (+Y): vTop -> rim[s2] -> rim[s]
      idx.push(vTop, rimVerts[s2], rimVerts[s]);
      // CCW from below (-Y): vBot -> rim[s] -> rim[s2]
      idx.push(vBot, rimVerts[s], rimVerts[s2]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================================
// 2. 山腰横云流岚 (14 curved double-tapered cloud-veil ribbons in 1 BufferGeometry)
// ============================================================================
const WAIST_CLOUD_VERT = /* glsl */`
attribute vec2 aRibbonUV;
attribute float aRibbonPhase;
attribute float aGroundY;

varying vec2 vRibbonUV;
varying float vRibbonPhase;
varying float vGroundY;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vRibbonUV = aRibbonUV;
  vRibbonPhase = aRibbonPhase;
  vGroundY = aGroundY;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WAIST_CLOUD_FRAG = /* glsl */`
uniform float uCloudTime;
uniform vec3 uCloudColor;
uniform vec3 uCloudHighlight;
uniform float uCloudOpacity;

varying vec2 vRibbonUV;
varying float vRibbonPhase;
varying float vGroundY;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float wcHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float wcNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = wcHash(i);
  float b = wcHash(i + vec2(1.0, 0.0));
  float c = wcHash(i + vec2(0.0, 1.0));
  float d = wcHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float wcFbm(vec2 p) {
  float v = 0.0;
  v += 0.52 * wcNoise(p);
  v += 0.31 * wcNoise(p * 2.07 + vec2(4.3, 1.9));
  v += 0.17 * wcNoise(p * 4.19 + vec2(8.7, 5.1));
  return v;
}

void main() {
  float envU = pow(max(0.0, sin(vRibbonUV.x * 3.14159265)), 1.65);
  float envV = pow(max(0.0, sin(vRibbonUV.y * 3.14159265)), 1.85);
  if (envU * envV < 0.002) discard;

  vec3 toCam = cameraPosition - vWorldPos;
  float camDist = length(toCam);
  float nearFade = smoothstep(18.0, 46.0, camDist);
  if (nearFade < 0.002) discard;

  vec3 viewDir = toCam / max(camDist, 0.001);
  float grazing = smoothstep(0.06, 0.42, abs(dot(normalize(vWorldNormal), viewDir)));
  float groundSoft = smoothstep(0.25, 2.4, vWorldPos.y - vGroundY);

  float scroll = uCloudTime * 0.035 + vRibbonPhase;
  float wave = sin(vRibbonUV.x * 9.42477 + scroll * 1.6) * 0.10
             + cos(vRibbonUV.x * 15.7079 + vRibbonPhase * 2.1) * 0.05;
  vec2 p = vec2(vRibbonUV.x * 3.6 - scroll, (vRibbonUV.y + wave) * 1.85 + vRibbonPhase * 0.37);
  float f1 = wcFbm(p);
  float f2 = wcFbm(p * 1.75 + vec2(f1 * 0.85, -scroll * 0.35));
  float xuanFiber = 0.90 + 0.10 * sin(vRibbonUV.x * 42.0 + f1 * 5.0);
  float mistDensity = smoothstep(0.24, 0.78, f1 * 0.58 + f2 * 0.42) * xuanFiber;

  float alpha = uCloudOpacity * mistDensity * envU * envV * nearFade * grazing * groundSoft;
  if (alpha < 0.0015) discard;

  float crestMix = clamp(vRibbonUV.y * 0.65 + f2 * 0.35, 0.0, 1.0);
  vec3 col = mix(uCloudColor * 0.90, uCloudHighlight, crestMix);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

function buildMountainWaistCloudsGeometry(basin, slitX, slitZ, sampleGround, spineLut) {
  const segU = 16;
  const segV = 4;
  const rand = lcg(20260402);

  const pos = [];
  const nor = [];
  const ribUV = [];
  const ribPhase = [];
  const groundYs = [];
  const idx = [];
  let vertOffset = 0;

  function appendRibbon(pointAtU, height, phase) {
    const baseV = vertOffset;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const pt = pointAtU(u);
      const taperH = height * (0.42 + 0.58 * Math.sin(u * PI));
      const gy = sampleGround(pt.x, pt.z);
      const centerY = Math.max(pt.y, gy + taperH * 0.42 + 1.2);

      for (let iv = 0; iv <= segV; iv++) {
        const v = iv / segV;
        const belly = Math.sin(v * PI) * 1.25;
        const vx = pt.x + pt.nx * belly;
        const vy = centerY + (v - 0.5) * taperH;
        const vz = pt.z + pt.nz * belly;
        const ny = (v - 0.5) * 0.32;
        const nl = Math.hypot(pt.nx, ny, pt.nz) || 1;

        pos.push(vx, vy, vz);
        nor.push(pt.nx / nl, ny / nl, pt.nz / nl);
        ribUV.push(u, v);
        ribPhase.push(phase);
        groundYs.push(sampleGround(vx, vz));
        vertOffset++;
      }
    }

    const stride = segV + 1;
    for (let iu = 0; iu < segU; iu++) {
      for (let iv = 0; iv < segV; iv++) {
        const a = baseV + iu * stride + iv;
        const b = a + stride;
        const c = b + 1;
        const d = a + 1;
        idx.push(a, b, c, a, c, d);
      }
    }
  }

  // 10 interior ribbons wrapping around basin (30, -140) at r ≈ 126..166m, y ≈ 13.5..25.0m, avoiding slit within 34m
  const slitAngle = Math.atan2(slitZ - basin.z, slitX - basin.x);
  const safeStart = slitAngle + 0.36;
  const safeSpan = TAU - 0.72;

  for (let i = 0; i < 10; i++) {
    const slotFrac = (i + 0.5) / 10;
    const baseR = 128 + ((i * 37) % 36) + (rand() - 0.5) * 3.0; // 126..166m
    const arcLen = 48 + (i % 4) * 10 + rand() * 6.5;            // 45..85m
    let halfAng = (arcLen * 0.5) / baseR;
    const maxCenterSpan = safeSpan - halfAng * 2;
    let centerAng = safeStart + halfAng + clamp(slotFrac + (rand() - 0.5) * 0.04, 0.02, 0.98) * maxCenterSpan;

    // Enforce > 34m clearance from cave slit on endpoints and midpoint
    for (let guard = 0; guard < 6; guard++) {
      const ex0 = basin.x + Math.cos(centerAng - halfAng) * baseR;
      const ez0 = basin.z + Math.sin(centerAng - halfAng) * baseR;
      const ex1 = basin.x + Math.cos(centerAng + halfAng) * baseR;
      const ez1 = basin.z + Math.sin(centerAng + halfAng) * baseR;
      if (Math.hypot(ex0 - slitX, ez0 - slitZ) < 36) centerAng += 0.08;
      if (Math.hypot(ex1 - slitX, ez1 - slitZ) < 36) centerAng -= 0.08;
    }

    const baseY = (i % 2 === 0 ? 14.2 : 19.4) + rand() * 4.8; // 13.5..25.0m
    const height = 4.6 + rand() * 2.7;                        // 4.5..7.5m
    const phase = rand() * TAU;
    const radialWave = 2.8 + rand() * 2.4;
    const vertWave = 0.65 + rand() * 0.65;

    appendRibbon(function (u) {
      const ang = centerAng + (u - 0.5) * halfAng * 2;
      const r = baseR + Math.sin(u * PI * 2 + phase) * radialWave;
      let rx = basin.x + Math.cos(ang) * r;
      let rz = basin.z + Math.sin(ang) * r;
      const dSlit = Math.hypot(rx - slitX, rz - slitZ);
      if (dSlit < 35.5) {
        const push = (35.5 - dSlit) / (dSlit || 1);
        rx += (rx - slitX) * push;
        rz += (rz - slitZ) * push;
      }
      // Inward normal toward basin center
      const nx = -Math.cos(ang);
      const nz = -Math.sin(ang);
      const ry = baseY + Math.sin(u * PI * 1.5 + phase) * vertWave;
      return { x: rx, y: ry, z: rz, nx, nz };
    }, height, phase);
  }

  // 4 exterior ribbons drifting along Wuling stream gorge cliffs (z ≈ 55..235m, |x| ≈ 38..66m, y ≈ 11.5..19.5m)
  const extSpecs = [
    { z0: 58, z1: 126, side: 1, off: 44, y: 13.0, h: 5.2 },
    { z0: 66, z1: 140, side: -1, off: 48, y: 14.8, h: 5.8 },
    { z0: 142, z1: 218, side: 1, off: 52, y: 17.2, h: 6.4 },
    { z0: 154, z1: 232, side: -1, off: 45, y: 12.6, h: 5.4 }
  ];

  for (let i = 0; i < extSpecs.length; i++) {
    const sp = extSpecs[i];
    const phase = rand() * TAU;
    appendRibbon(function (u) {
      const zTarget = lerp(sp.z0, sp.z1, u);
      const riverX = spineLut.xAtZ(zTarget);
      const waveOff = sp.off + Math.sin(u * PI * 2 + phase) * 4.5;
      let x = riverX + sp.side * waveOff;
      if (Math.abs(x) < 39) x = (x >= 0 ? 1 : -1) * 39;
      if (Math.abs(x) > 65) x = (x >= 0 ? 1 : -1) * 65;
      const y = sp.y + Math.sin(u * PI * 1.4 + phase) * 0.85;
      return { x, y, z: zTarget, nx: -sp.side, nz: 0.12 * Math.cos(u * PI + phase) };
    }, sp.h, phase);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aRibbonUV', new THREE.Float32BufferAttribute(ribUV, 2));
  geo.setAttribute('aRibbonPhase', new THREE.Float32BufferAttribute(ribPhase, 1));
  geo.setAttribute('aGroundY', new THREE.Float32BufferAttribute(groundYs, 1));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================================
// 3. 暮夜窗前与篝火地面暖光晕 (Terrain-conforming Gaussian radial light pools)
// ============================================================================
const WARM_POOL_VERT = /* glsl */`
attribute vec2 aPoolUV;
attribute vec3 aPoolColor;
attribute vec3 aPoolMeta;

varying vec2 vPoolUV;
varying vec3 vPoolColor;
varying vec3 vPoolMeta;

void main() {
  vPoolUV = aPoolUV;
  vPoolColor = aPoolColor;
  vPoolMeta = aPoolMeta;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WARM_POOL_FRAG = /* glsl */`
uniform float uWarmGlow;
uniform float uBonfireFactor;
uniform float uWarmTime;

varying vec2 vPoolUV;
varying vec3 vPoolColor;
varying vec3 vPoolMeta;

void main() {
  float r2 = dot(vPoolUV, vPoolUV);
  if (r2 >= 0.99) discard;

  float weight = vPoolMeta.x;
  float phase = vPoolMeta.y;
  float isBonfire = step(1.5, vPoolMeta.z);

  float mult = uWarmGlow * weight;
  if (isBonfire > 0.5) {
    if (uBonfireFactor <= 0.001) discard;
    float flicker = 1.0 + 0.11 * sin(uWarmTime * 5.6 + phase) + 0.055 * cos(uWarmTime * 10.9 + phase * 1.7);
    mult *= uBonfireFactor * flicker;
  } else {
    float breath = 1.0 + 0.06 * sin(uWarmTime * 2.9 + phase) + 0.03 * sin(uWarmTime * 6.7 + phase * 1.4);
    mult *= breath;
  }

  // Smooth Gaussian-feathered radial decay: warm core, silky outer fade, zero polygon boundary
  float falloff = exp(-2.75 * r2) * pow(max(0.0, 1.0 - r2), 2.25);
  float intensity = mult * falloff;
  if (intensity < 0.002) discard;

  vec3 col = vPoolColor * intensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildWarmLightPoolsGeometry(anchors, sampleGround) {
  const seg = 8;
  const stride = seg + 1;
  const pos = [];
  const puv = [];
  const pcol = [];
  const pmeta = [];
  const idx = [];
  let vOffset = 0;

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const ca = Math.cos(a.rot || 0);
    const sa = Math.sin(a.rot || 0);
    const base = vOffset;

    for (let iz = 0; iz <= seg; iz++) {
      const v = (iz / seg) * 2 - 1;
      for (let ix = 0; ix <= seg; ix++) {
        const u = (ix / seg) * 2 - 1;
        const lx = u * a.sx;
        const lz = v * a.sz;
        const wx = a.x + lx * ca + lz * sa;
        const wz = a.z - lx * sa + lz * ca;
        const hc = sampleGround(wx, wz);
        const hAvg = (
          sampleGround(wx - 0.45, wz) +
          sampleGround(wx + 0.45, wz) +
          sampleGround(wx, wz - 0.45) +
          sampleGround(wx, wz + 0.45)
        ) * 0.25;
        const wy = Math.max(hc, hAvg) + 0.058;

        pos.push(wx, wy, wz);
        puv.push(u, v);
        pcol.push(a.r, a.g, a.b);
        pmeta.push(a.weight, a.phase, a.kind);
        vOffset++;
      }
    }

    for (let iz = 0; iz < seg; iz++) {
      for (let ix = 0; ix < seg; ix++) {
        const v00 = base + iz * stride + ix;
        const v10 = v00 + 1;
        const v01 = v00 + stride;
        const v11 = v01 + 1;
        idx.push(v00, v01, v10);
        idx.push(v10, v01, v11);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPoolUV', new THREE.Float32BufferAttribute(puv, 2));
  geo.setAttribute('aPoolColor', new THREE.Float32BufferAttribute(pcol, 3));
  geo.setAttribute('aPoolMeta', new THREE.Float32BufferAttribute(pmeta, 3));
  geo.setIndex(idx);
  if (pos.length > 0) {
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
  return geo;
}

// ============================================================================
// 4A. 动态清波双环水痕几何 (inner 0.68..0.82 + outer 0.90..1.00 feathered ring)
// ============================================================================
function buildDoubleWakeRingGeometry() {
  const segs = 24;
  const pos = [];
  const nor = [];
  const col = [];
  const feather = [];
  const idx = [];
  let vBase = 0;

  function addBand(rInner, rMid, rOuter, peakAlpha, cPeak, cEdge) {
    const start = vBase;
    const radii = [rInner, rMid, rOuter];
    const alphas = [0.0, peakAlpha, 0.0];
    for (let k = 0; k < 3; k++) {
      const r = radii[k];
      const a = alphas[k];
      const c = k === 1 ? cPeak : cEdge;
      for (let s = 0; s < segs; s++) {
        const ang = (s / segs) * TAU;
        pos.push(Math.cos(ang) * r, 0, Math.sin(ang) * r);
        nor.push(0, 1, 0);
        col.push(c[0], c[1], c[2]);
        feather.push(a);
        vBase++;
      }
    }
    for (let k = 0; k < 2; k++) {
      const r0 = start + k * segs;
      const r1 = start + (k + 1) * segs;
      for (let s = 0; s < segs; s++) {
        const s2 = (s + 1) % segs;
        idx.push(r0 + s, r0 + s2, r1 + s2);
        idx.push(r0 + s, r1 + s2, r1 + s);
      }
    }
  }

  addBand(0.68, 0.75, 0.82, 0.68, [0.92, 0.97, 0.96], [0.80, 0.90, 0.89]);
  addBand(0.90, 0.95, 1.00, 1.00, [1.00, 1.00, 1.00], [0.84, 0.93, 0.92]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aRingFeather', new THREE.Float32BufferAttribute(feather, 1));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================================
// 4B. 池岸碎萍与水际苔石 (42 duckweed clusters + 34 half-submerged mossy pebbles)
// ============================================================================
function buildPondDuckweedGeometry(pondData, sampleGround) {
  const rand = lcg(20260719);
  const px = Number.isFinite(pondData?.x) ? pondData.x : 68;
  const pz = Number.isFinite(pondData?.z) ? pondData.z : -152;
  const waterY = Number.isFinite(pondData?.waterY) ? pondData.waterY : 0.85;
  const fallbackR = Number.isFinite(pondData?.waterRadius) ? pondData.waterRadius : 9.2;
  const rim = Array.isArray(pondData?.rim) && pondData.rim.length >= 8 ? pondData.rim : null;

  function rimAt(ang) {
    const wrapped = ((ang % TAU) + TAU) % TAU;
    if (rim) {
      const f = (wrapped / TAU) * rim.length;
      const i0 = Math.floor(f) % rim.length;
      const i1 = (i0 + 1) % rim.length;
      return lerp(rim[i0], rim[i1], f - Math.floor(f));
    }
    return fallbackR * (1 + 0.04 * Math.sin(wrapped * 3.0 + 1.1));
  }

  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  let vBase = 0;

  const cPadA = new THREE.Color('#6B9454');
  const cPadB = new THREE.Color('#84AA66');
  const cPadEdge = new THREE.Color('#537740');
  const cMossTop = new THREE.Color('#687362');
  const cPebbleWarm = new THREE.Color('#878372');
  const cPebbleWet = new THREE.Color('#4E5649');
  const tmpC = new THREE.Color();
  const tmpEdge = new THREE.Color();

  // 42 natural organic duckweed clusters along sheltered coves (0.76..0.97 * rim[i])
  const clusterCount = 42;
  const coveCount = 9;
  for (let c = 0; c < clusterCount; c++) {
    const coveIdx = c % coveCount;
    const coveCenter = (coveIdx / coveCount) * TAU + 0.28 + Math.sin(coveIdx * 2.1) * 0.16;
    const ang = coveCenter + (rand() - 0.5) * 0.36;
    const shoreR = rimAt(ang);
    const radFrac = 0.76 + rand() * 0.205; // 0.76..0.965
    const cx = px + Math.cos(ang) * shoreR * radFrac;
    const cz = pz + Math.sin(ang) * shoreR * radFrac;

    const padsInCluster = 4 + Math.floor(rand() * 3); // 4..6 rounded 5-sided pads
    for (let p = 0; p < padsInCluster; p++) {
      const pAng = rand() * TAU;
      const pDist = p === 0 ? 0 : (0.09 + rand() * 0.24);
      const ox = cx + Math.cos(pAng) * pDist;
      const oz = cz + Math.sin(pAng) * pDist;
      // Keep strictly inside pond rim
      const dCenter = Math.hypot(ox - px, oz - pz);
      const localRim = rimAt(Math.atan2(oz - pz, ox - px));
      if (dCenter > localRim * 0.975) continue;

      const padR = 0.068 + rand() * 0.066;
      const padRot = rand() * TAU;
      const padY = waterY + 0.014 + (p % 2) * 0.0015;
      tmpC.copy(cPadA).lerp(cPadB, rand()).offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.04);
      tmpEdge.copy(tmpC).lerp(cPadEdge, 0.45);

      const centerIdx = vBase++;
      pos.push(ox, padY + 0.004, oz);
      nor.push(0, 1, 0);
      col.push(tmpC.r, tmpC.g, tmpC.b);

      for (let s = 0; s < 5; s++) {
        const a = padRot + (s / 5) * TAU;
        const rr = padR * (0.86 + 0.24 * ((s * 3 + p) % 2));
        pos.push(ox + Math.cos(a) * rr, padY, oz + Math.sin(a) * rr);
        nor.push(Math.cos(a) * 0.12, 0.99, Math.sin(a) * 0.12);
        col.push(tmpEdge.r, tmpEdge.g, tmpEdge.b);
        vBase++;
      }
      for (let s = 0; s < 5; s++) {
        const s2 = (s + 1) % 5;
        idx.push(centerIdx, centerIdx + 1 + s2, centerIdx + 1 + s);
      }
    }
  }

  // 34 half-submerged mossy shore pebbles right on 0.95..1.04 * rim[i] waterline
  const pebbleCount = 34;
  for (let i = 0; i < pebbleCount; i++) {
    // Anchor near 44-gon vertices with natural jitter to break straight rim edges
    const ang = ((i / pebbleCount) * TAU) + (rand() - 0.5) * 0.11;
    const rRim = rimAt(ang);
    const mult = 0.95 + rand() * 0.09; // 0.95..1.04
    const sx = px + Math.cos(ang) * rRim * mult;
    const sz = pz + Math.sin(ang) * rRim * mult;
    const gy = sampleGround(sx, sz);
    const baseY = Math.min(waterY - 0.045, gy - 0.03);
    const topY = waterY + 0.035 + rand() * 0.065;
    const midY = lerp(baseY, topY, 0.52);

    const rx = 0.16 + rand() * 0.18;
    const rz = 0.14 + rand() * 0.16;
    const yaw = rand() * TAU;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);

    tmpC.copy(cMossTop).lerp(cPebbleWarm, rand() * 0.55);
    tmpEdge.copy(cPebbleWet).lerp(cPebbleWarm, rand() * 0.35);

    const topIdx = vBase++;
    pos.push(sx, topY, sz);
    nor.push(0, 1, 0);
    col.push(tmpC.r, tmpC.g, tmpC.b);

    const sides = 6;
    const midStart = vBase;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * TAU;
      const wob = 0.85 + 0.28 * Math.sin(a * 2 + i);
      const lx = Math.cos(a) * rx * wob;
      const lz = Math.sin(a) * rz * wob;
      const wx = sx + lx * cy + lz * sy;
      const wz = sz - lx * sy + lz * cy;
      const nx = (wx - sx) / (rx || 1);
      const nz = (wz - sz) / (rz || 1);
      const nl = Math.hypot(nx, 0.45, nz) || 1;
      pos.push(wx, midY, wz);
      nor.push(nx / nl, 0.45 / nl, nz / nl);
      col.push(lerp(tmpC.r, tmpEdge.r, 0.55), lerp(tmpC.g, tmpEdge.g, 0.55), lerp(tmpC.b, tmpEdge.b, 0.55));
      vBase++;
    }

    const botStart = vBase;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * TAU;
      const wob = 0.92 + 0.22 * Math.sin(a * 2 + i);
      const lx = Math.cos(a) * rx * 1.12 * wob;
      const lz = Math.sin(a) * rz * 1.12 * wob;
      const wx = sx + lx * cy + lz * sy;
      const wz = sz - lx * sy + lz * cy;
      const nx = (wx - sx) / (rx || 1);
      const nz = (wz - sz) / (rz || 1);
      const nl = Math.hypot(nx, 0.2, nz) || 1;
      pos.push(wx, baseY, wz);
      nor.push(nx / nl, 0.2 / nl, nz / nl);
      col.push(tmpEdge.r, tmpEdge.g, tmpEdge.b);
      vBase++;
    }

    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      idx.push(topIdx, midStart + s2, midStart + s);
      idx.push(midStart + s, midStart + s2, botStart + s2);
      idx.push(midStart + s, botStart + s2, botStart + s);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geo, clusterCount, pebbleCount };
}

// ============================================================================
// 5. 飞鸟归林 (Sculpted 14-tri graceful bird with aWing attribute for GPU flap)
// ============================================================================
function buildValleyBirdGeometry() {
  // Local frame: +Z forward (beak), ±X wingspan ([-1..+1]), +Y dorsal up
  const pos = [];
  const col = [];
  const wing = [];
  const idx = [];
  let vCount = 0;

  function addV(x, y, z, r, g, b, wSpan) {
    pos.push(x, y, z);
    col.push(r, g, b);
    wing.push(wSpan);
    return vCount++;
  }

  // Body / neck / beak / tail vertices (aWing = 0)
  const vBeak = addV(0.0, 0.015, 0.62, 0.84, 0.74, 0.46, 0.0);
  const vNeckTop = addV(0.0, 0.052, 0.24, 0.99, 0.99, 0.97, 0.0);
  const vChestL = addV(-0.068, -0.018, 0.20, 0.96, 0.97, 0.95, 0.04);
  const vChestR = addV(0.068, -0.018, 0.20, 0.96, 0.97, 0.95, 0.04);
  const vBack = addV(0.0, 0.048, -0.14, 0.99, 0.99, 0.97, 0.0);
  const vHipL = addV(-0.055, -0.012, -0.18, 0.94, 0.95, 0.93, 0.04);
  const vHipR = addV(0.055, -0.012, -0.18, 0.94, 0.95, 0.93, 0.04);
  const vTailTip = addV(0.0, 0.012, -0.58, 0.88, 0.90, 0.89, 0.0);

  // Body triangles (6 tris, CCW from above +Y)
  idx.push(vBeak, vChestL, vNeckTop);
  idx.push(vBeak, vNeckTop, vChestR);
  idx.push(vNeckTop, vChestL, vBack);
  idx.push(vNeckTop, vBack, vChestR);
  idx.push(vBack, vHipL, vTailTip);
  idx.push(vBack, vTailTip, vHipR);

  // Left 2-segment swept wing (4 tris)
  const vWristLF = addV(-0.46, 0.032, 0.14, 0.97, 0.98, 0.96, 0.46);
  const vWristLB = addV(-0.44, 0.010, -0.15, 0.92, 0.94, 0.93, 0.44);
  const vMidLF = addV(-0.76, 0.018, 0.02, 0.56, 0.59, 0.61, 0.76);
  const vTipL = addV(-1.00, -0.010, -0.26, 0.30, 0.33, 0.36, 1.00);

  idx.push(vChestL, vWristLF, vWristLB);
  idx.push(vChestL, vWristLB, vHipL);
  idx.push(vWristLF, vMidLF, vTipL);
  idx.push(vWristLF, vTipL, vWristLB);

  // Right 2-segment swept wing (4 tris)
  const vWristRF = addV(0.46, 0.032, 0.14, 0.97, 0.98, 0.96, 0.46);
  const vWristRB = addV(0.44, 0.010, -0.15, 0.92, 0.94, 0.93, 0.44);
  const vMidRF = addV(0.76, 0.018, 0.02, 0.56, 0.59, 0.61, 0.76);
  const vTipR = addV(1.00, -0.010, -0.26, 0.30, 0.33, 0.36, 1.00);

  idx.push(vChestR, vWristRB, vWristRF);
  idx.push(vChestR, vHipR, vWristRB);
  idx.push(vWristRF, vTipR, vMidRF);
  idx.push(vWristRF, vWristRB, vTipR);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================================
// 6. 溪上落英逐水 (Delicate slightly-cupped 4-tri heart/diamond peach petal)
// ============================================================================
function buildStreamPetalGeometry() {
  // Length ~0.16m (-0.080..+0.080 Z), width ~0.11m (-0.055..+0.055 X), 4 tris
  const cBase = new THREE.Color('#F29EB2');
  const cCenter = new THREE.Color('#F6BAC9');
  const cSide = new THREE.Color('#F9CED9');
  const cTip = new THREE.Color('#FCE4EA');

  const pos = new Float32Array([
    0.000, -0.004,  0.004, // 0: cupped center hollow
    0.000,  0.008, -0.080, // 1: tapered petal base
    0.055,  0.014,  0.012, // 2: right rounded lobe
    0.000,  0.011,  0.080, // 3: delicate petal tip
   -0.055,  0.014,  0.012  // 4: left rounded lobe
  ]);

  const col = new Float32Array([
    cCenter.r, cCenter.g, cCenter.b,
    cBase.r,   cBase.g,   cBase.b,
    cSide.r,   cSide.g,   cSide.b,
    cTip.r,    cTip.g,    cTip.b,
    cSide.r,   cSide.g,   cSide.b
  ]);

  // CCW from above (+Y)
  const idx = [
    0, 2, 1,
    0, 3, 2,
    0, 4, 3,
    0, 1, 4
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================================
// 6B. 池岸惊蛙 (Sculpted 18-tri pond frog mid-leap with outstretched hind legs)
// ============================================================================
function buildPondFrogGeometry() {
  // Local frame: +Z forward (snout), +Y dorsal back, ±X bilateral symmetry
  const pos = [];
  const col = [];
  const idx = [];
  let vCount = 0;
  const cTmp = new THREE.Color();

  function addV(x, y, z, hex) {
    cTmp.set(hex);
    pos.push(x, y, z);
    col.push(cTmp.r, cTmp.g, cTmp.b);
    return vCount++;
  }

  const vSnout = addV(0.000, 0.006, 0.068, '#6B8B52');
  const vHeadL = addV(-0.028, 0.022, 0.028, '#557541');
  const vHeadR = addV(0.028, 0.022, 0.028, '#557541');
  const vStripe = addV(0.000, 0.028, -0.008, '#8BA665');
  const vFlankL = addV(-0.042, 0.006, -0.012, '#4E6C3C');
  const vFlankR = addV(0.042, 0.006, -0.012, '#4E6C3C');
  const vBelly = addV(0.000, -0.014, 0.004, '#D6D9C3');
  const vRump = addV(0.000, 0.008, -0.058, '#567442');
  const vForeL = addV(-0.046, -0.018, 0.026, '#64814C');
  const vForeR = addV(0.046, -0.018, 0.026, '#64814C');
  const vKneeL = addV(-0.048, 0.004, -0.094, '#547240');
  const vKneeR = addV(0.048, 0.004, -0.094, '#547240');
  const vFootL = addV(-0.036, -0.008, -0.158, '#688550');
  const vFootR = addV(0.036, -0.008, -0.158, '#688550');

  // Dorsal carapace & pale dorsal stripe (6 tris)
  idx.push(vSnout, vHeadL, vStripe);
  idx.push(vSnout, vStripe, vHeadR);
  idx.push(vHeadL, vFlankL, vStripe);
  idx.push(vStripe, vFlankR, vHeadR);
  idx.push(vFlankL, vRump, vStripe);
  idx.push(vStripe, vRump, vFlankR);

  // Ventral belly & tucked forelimbs (6 tris)
  idx.push(vSnout, vBelly, vHeadL);
  idx.push(vSnout, vHeadR, vBelly);
  idx.push(vHeadL, vForeL, vFlankL);
  idx.push(vHeadR, vFlankR, vForeR);
  idx.push(vFlankL, vBelly, vRump);
  idx.push(vFlankR, vRump, vBelly);

  // Outstretched kicking hind legs (6 tris)
  idx.push(vFlankL, vKneeL, vRump);
  idx.push(vRump, vKneeR, vFlankR);
  idx.push(vRump, vKneeL, vFootL);
  idx.push(vRump, vFootL, vBelly);
  idx.push(vRump, vFootR, vKneeR);
  idx.push(vRump, vBelly, vFootR);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================================
// Pre-baked Zero-Allocation River Spine LUT (513 samples along riverCurve)
// ============================================================================
function buildRiverSpineLut(riverCurve, streamCfg, terrainCfg, field, waterLevel) {
  const halfWidth = streamCfg?.halfWidth ?? 22;
  const edgeWobble = streamCfg?.edgeWobble ?? 0.35;
  const xs = new Float32Array(SPINE_SAMPLES + 1);
  const zs = new Float32Array(SPINE_SAMPLES + 1);
  const nxs = new Float32Array(SPINE_SAMPLES + 1);
  const nzs = new Float32Array(SPINE_SAMPLES + 1);
  const halves = new Float32Array(SPINE_SAMPLES + 1);
  const wetPos = new Float32Array(SPINE_SAMPLES + 1);
  const wetNeg = new Float32Array(SPINE_SAMPLES + 1);
  const canSample = Boolean(field && typeof field.sample === 'function');

  let curve = riverCurve;
  let ownedCurve = null;
  if (!curve && Array.isArray(streamCfg?.points) && streamCfg.points.length >= 2) {
    const pts = streamCfg.points.map(p => new THREE.Vector3(p[0], 0, p[1]));
    ownedCurve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    curve = ownedCurve;
  }

  const pTmp = new THREE.Vector3();
  const tTmp = new THREE.Vector3();
  const length = curve ? curve.getLength() : 407;

  for (let i = 0; i <= SPINE_SAMPLES; i++) {
    const t = i / SPINE_SAMPLES;
    if (curve) {
      curve.getPointAt(t, pTmp);
      curve.getTangentAt(t, tTmp);
    } else {
      pTmp.set(4, 0, lerp(380, -12, t));
      tTmp.set(0, 0, -1);
    }
    const nl = Math.hypot(tTmp.x, tTmp.z) || 1;
    const nx = tTmp.z / nl;
    const nz = -tTmp.x / nl;
    const half = (halfWidth + Math.sin(t * 21.7) * edgeWobble) * inlineChokeFactor(terrainCfg, pTmp.x, pTmp.z);
    const maxAllowed = half * 0.78;
    let cx = pTmp.x;
    let cz = pTmp.z;
    let wPos = half * 0.72;
    let wNeg = half * 0.72;

    if (canSample) {
      // Recenter slightly toward deepest grid thalweg if narrow headwaters cross cell boundaries
      let bestH = field.sample(cx, cz);
      let bestShift = 0;
      for (let s = -2.0; s <= 2.01; s += 0.5) {
        const sh = field.sample(cx + nx * s, cz + nz * s);
        if (Number.isFinite(sh) && sh < bestH) {
          bestH = sh;
          bestShift = s;
        }
      }
      if (bestH < waterLevel - 0.02) {
        cx += nx * bestShift;
        cz += nz * bestShift;
        const maxSearch = Math.max(0.2, maxAllowed - Math.abs(bestShift));
        let safeP = 0;
        let safeN = 0;
        for (let step = 1; step <= 24; step++) {
          const d = (step / 24) * maxSearch;
          const hp = field.sample(cx + nx * d, cz + nz * d);
          if (!Number.isFinite(hp) || hp > waterLevel - 0.04) break;
          safeP = d;
        }
        for (let step = 1; step <= 24; step++) {
          const d = (step / 24) * maxSearch;
          const hn = field.sample(cx - nx * d, cz - nz * d);
          if (!Number.isFinite(hn) || hn > waterLevel - 0.04) break;
          safeN = d;
        }
        wPos = Math.min(maxAllowed, safeP * 0.86);
        wNeg = Math.min(maxAllowed, safeN * 0.86);
      }
    }

    xs[i] = cx;
    zs[i] = cz;
    nxs[i] = nx;
    nzs[i] = nz;
    halves[i] = half;
    wetPos[i] = wPos;
    wetNeg[i] = wNeg;
  }

  return {
    length: Math.max(40, length),
    xs,
    zs,
    nxs,
    nzs,
    halves,
    wetPos,
    wetNeg,
    xAtZ(zTarget) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i <= SPINE_SAMPLES; i += 4) {
        const d = Math.abs(zs[i] - zTarget);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      return xs[bestIdx];
    }
  };
}

// ============================================================================
// Main Factory: createInkAtmosphere
// ============================================================================
export function createInkAtmosphere(options = {}) {
  const {
    world = null,
    field: rawField = null,
    terrain = null,
    stream = null,
    riverCurve = null,
    distanceToRiver = null,
    cliff = null,
    village = null,
    qinHanHomestead = null,
    boats = null,
    riverSkiff = null,
    fauna = null,
    sky: initialSky = null
  } = options;

  const field = rawField || terrain?.field || null;
  const terrainCfg = world?.terrain || {
    size: 800,
    waterLevel: -1,
    basin: { x: 30, z: -140, inner: 96, outer: 168, height: 2 },
    pond: { x: 68, z: -152, radius: 13, waterRadius: 9.2, waterY: 0.85 },
    choke: { x: 9, z: -12, r0: 26, r1: 92, factor: 0.32, bedLift: 0.7 }
  };
  const streamCfg = world?.stream || {
    halfWidth: 22,
    edgeWobble: 0.35,
    waveAmp: 0.11,
    waveSpeed: 1.15
  };
  const basin = terrainCfg.basin || { x: 30, z: -140, inner: 96, outer: 168 };
  const waterLevel = Number.isFinite(terrainCfg.waterLevel) ? terrainCfg.waterLevel : -1;
  const pondData = village?.pond || terrainCfg.pond || { x: 68, z: -152, waterY: 0.85, radius: 13 };
  const pondX = Number.isFinite(pondData.x) ? pondData.x : 68;
  const pondZ = Number.isFinite(pondData.z) ? pondData.z : -152;
  const pondWaterY = Number.isFinite(pondData.waterY) ? pondData.waterY : 0.85;
  const pondMaxR = Array.isArray(pondData.rim) && pondData.rim.length
    ? Math.max(...pondData.rim)
    : (Number.isFinite(pondData.waterRadius) ? pondData.waterRadius : 9.6);

  function pondRimRadiusAt(angle) {
    const rim = pondData.rim;
    if (Array.isArray(rim) && rim.length >= 3) {
      const n = rim.length;
      const normA = ((angle % TAU) + TAU) % TAU;
      const f = (normA / TAU) * n;
      const i0 = Math.floor(f) % n;
      const i1 = (i0 + 1) % n;
      return lerp(rim[i0], rim[i1], f - Math.floor(f));
    }
    return Number.isFinite(pondData.waterRadius) ? pondData.waterRadius : pondMaxR * 0.85;
  }

  const slitX = Number.isFinite(cliff?.slit?.x)
    ? cliff.slit.x
    : (Array.isArray(world?.cliff?.slit) ? world.cliff.slit[0] : 23);
  const slitZ = Number.isFinite(cliff?.slit?.z)
    ? cliff.slit.z
    : (Array.isArray(world?.cliff?.slit) ? world.cliff.slit[1] : -10);

  function sampleGround(x, z) {
    if (field && typeof field.sample === 'function') {
      const h = field.sample(x, z);
      if (Number.isFinite(h)) return h;
    }
    return 0;
  }

  function sampleSlope(x, z) {
    if (field && typeof field.slope === 'function') {
      const s = field.slope(x, z);
      if (Number.isFinite(s)) return s;
    }
    const d = 1.5;
    const gx = (sampleGround(x + d, z) - sampleGround(x - d, z)) / (2 * d);
    const gz = (sampleGround(x, z + d) - sampleGround(x, z - d)) / (2 * d);
    return Math.hypot(gx, gz);
  }

  const group = new THREE.Group();
  group.name = 'ink-atmosphere';
  group.userData.dynamic = true;

  const exteriorGroup = new THREE.Group();
  exteriorGroup.name = 'ink-atmosphere-exterior';

  const interiorGroup = new THREE.Group();
  interiorGroup.name = 'ink-atmosphere-interior';

  const sharedGroup = new THREE.Group();
  sharedGroup.name = 'ink-atmosphere-shared';

  group.add(exteriorGroup, interiorGroup, sharedGroup);

  const spineLut = buildRiverSpineLut(riverCurve || stream?.curve || null, streamCfg, terrainCfg, field, waterLevel);

  // Reusable scratch transforms & colors (zero per-frame heap allocations)
  const _mat = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _scl = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _qYaw = new THREE.Quaternion();
  const _qTilt = new THREE.Quaternion();
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _norm = new THREE.Vector3();
  const _col = new THREE.Color();
  const _colFog = new THREE.Color();
  const _colHoriz = new THREE.Color();
  const _colBase = new THREE.Color();

  // Pre-parsed fallback sky palettes (zero allocation during update)
  const skyTimesCfg = world?.sky?.times || {};
  const presetPalettes = {
    dawn: {
      fog: new THREE.Color(skyTimesCfg.dawn?.fogColor || '#E5D9CB'),
      horiz: new THREE.Color(skyTimesCfg.dawn?.skyBottom || '#F5DEC2'),
      cloudTint: new THREE.Color('#E6D9D5'),
      wake: new THREE.Color('#E8CBB4'),
      opacity: 0.44,
      glow: 0.10,
      night: 0
    },
    day: {
      fog: new THREE.Color(skyTimesCfg.day?.fogColor || '#BAD8E7'),
      horiz: new THREE.Color(skyTimesCfg.day?.skyBottom || '#B6D9F0'),
      cloudTint: new THREE.Color('#E3EFEA'),
      wake: new THREE.Color('#DDF0EC'),
      opacity: 0.32,
      glow: 0.0,
      night: 0
    },
    dusk: {
      fog: new THREE.Color(skyTimesCfg.dusk?.fogColor || '#DCC4B4'),
      horiz: new THREE.Color(skyTimesCfg.dusk?.skyBottom || '#F0C193'),
      cloudTint: new THREE.Color('#DEB9A4'),
      wake: new THREE.Color('#E8CBB4'),
      opacity: 0.42,
      glow: 0.38,
      night: 0
    },
    night: {
      fog: new THREE.Color(skyTimesCfg.night?.fogColor || '#2C3A4A'),
      horiz: new THREE.Color(skyTimesCfg.night?.skyBottom || '#34465B'),
      cloudTint: new THREE.Color('#1E2A38'),
      wake: new THREE.Color('#485E70'),
      opacity: 0.14,
      glow: 0.68,
      night: 1
    }
  };

  // ==========================================================================
  // LAYER 1: 山脊苔点远树 (ridge-ink-trees, 1 InstancedMesh in sharedGroup)
  // ==========================================================================
  const ridgeTreeGeo = buildRidgeInkTreeGeometry();
  const ridgeTreeMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: false
  });
  const targetInteriorTrees = 168;
  const targetExteriorTrees = 28;
  const maxRidgeTrees = targetInteriorTrees + targetExteriorTrees;
  const ridgeTreesMesh = new THREE.InstancedMesh(ridgeTreeGeo, ridgeTreeMat, maxRidgeTrees);
  ridgeTreesMesh.name = 'ridge-ink-trees';
  ridgeTreesMesh.frustumCulled = true;

  let placedInteriorTrees = 0;
  let placedExteriorTrees = 0;
  {
    const rand = lcg(20261115);
    const halfBound = (Number.isFinite(field?.half) ? field.half : (terrainCfg.size || 800) * 0.5) - 10;
    const placedXZ = [];

    function tooCloseToTree(x, z, minDist) {
      const m2 = minDist * minDist;
      for (let i = 0; i < placedXZ.length; i += 2) {
        const dx = placedXZ[i] - x;
        const dz = placedXZ[i + 1] - z;
        if (dx * dx + dz * dz < m2) return true;
      }
      return false;
    }

    function placeRidgeInstance(idx, x, y, z, hScale, wScale, leanX, leanZ, yaw, shadeShift) {
      _pos.set(x, y - 0.14, z);
      _euler.set(leanX, yaw, leanZ, 'YXZ');
      _quat.setFromEuler(_euler);
      _scl.set(wScale, hScale, wScale * (0.92 + (idx % 3) * 0.06));
      _mat.compose(_pos, _quat, _scl);
      ridgeTreesMesh.setMatrixAt(idx, _mat);

      _col.setRGB(
        clamp(0.92 + shadeShift * 0.10, 0.78, 1.04),
        clamp(0.95 + shadeShift * 0.08, 0.82, 1.05),
        clamp(0.94 + shadeShift * 0.09, 0.82, 1.06)
      );
      ridgeTreesMesh.setColorAt(idx, _col);
      placedXZ.push(x, z);
    }

    // Detect if field is a flat unit-test stub so fallback still populates cleanly
    let maxProbeH = -Infinity;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const h = sampleGround(basin.x + Math.cos(a) * 168, basin.z + Math.sin(a) * 168);
      if (h > maxProbeH) maxProbeH = h;
    }
    const minInteriorH = maxProbeH >= 11.5 ? 11.5 : -Infinity;
    const minExteriorH = maxProbeH >= 13.5 ? 13.5 : -Infinity;

    // 1A. Interior basin ridge clusters (r ∈ [136, 224], 国画「攒三聚五、疏可走马」破阵聚落)
    let guard = 0;
    while (placedInteriorTrees < targetInteriorTrees && guard++ < 5200) {
      const ang = rand() * TAU;
      // 留出 5 段宽阔天际留白山坳（「疏可走马」），聚落则在峰脊处攒簇成势（「密不透风」）
      const vistaWave = 0.5 + 0.34 * Math.sin(ang * 5.0 + 0.75) + 0.22 * Math.cos(ang * 3.0 - 1.15);
      if (guard < 4200 && vistaWave < 0.42) continue;

      let bestR = 138 + rand() * 84;
      let cx = basin.x + Math.cos(ang) * bestR;
      let cz = basin.z + Math.sin(ang) * bestR;
      let ch = sampleGround(cx, cz);

      // Nudge toward local radial ridge crest
      for (const dr of [-6, 6]) {
        const tr = clamp(bestR + dr, 136, 224);
        const tx = basin.x + Math.cos(ang) * tr;
        const tz = basin.z + Math.sin(ang) * tr;
        const th = sampleGround(tx, tz);
        if (th > ch) {
          bestR = tr; cx = tx; cz = tz; ch = th;
        }
      }

      if (Math.abs(cx) > halfBound || Math.abs(cz) > halfBound) continue;
      if (ch < minInteriorH || sampleSlope(cx, cz) > 0.88) continue;
      if (Math.hypot(cx - slitX, cz - slitZ) <= 30) continue;
      if (distanceToRiver && distanceToRiver(cx, cz) < 28) continue;

      const clusterSize = 4 + Math.floor(rand() * 5); // 4..8 trees tightly grouped ("攒三聚五")
      const tanX = -Math.sin(ang);
      const tanZ = Math.cos(ang);
      const radX = Math.cos(ang);
      const radZ = Math.sin(ang);

      for (let k = 0; k < clusterSize && placedInteriorTrees < targetInteriorTrees; k++) {
        // 聚落内紧密错落（±6.8m），告别均匀排兵布阵的等距栅栏线
        const spreadT = (rand() - 0.5) * (rand() + 0.35);
        const along = k === 0 ? 0 : spreadT * 13.5;
        const across = k === 0 ? 0 : (rand() - 0.5) * 11.5;
        const tx = cx + tanX * along + radX * across;
        const tz = cz + tanZ * along + radZ * across;
        if (Math.abs(tx) > halfBound || Math.abs(tz) > halfBound) continue;
        const rBasin = Math.hypot(tx - basin.x, tz - basin.z);
        if (rBasin < 136 || rBasin > 224) continue;
        if (Math.hypot(tx - slitX, tz - slitZ) <= 28.5) continue;
        if (distanceToRiver && distanceToRiver(tx, tz) < 26) continue;
        const th = sampleGround(tx, tz);
        if (th < minInteriorH || sampleSlope(tx, tz) > 0.88) continue;
        if (tooCloseToTree(tx, tz, 1.85)) continue;

        // 主树轩昂、客树俯仰、幼松低偎，拉开高低错落天际剪影
        const role = k === 0 ? 0 : (k <= 2 ? 1 : 2);
        const hScale = role === 0
          ? (7.2 + rand() * 2.5)
          : role === 1
            ? (4.8 + rand() * 2.1)
            : (3.1 + rand() * 1.7);
        const wScale = hScale * (role === 2 ? (0.88 + rand() * 0.26) : (0.74 + rand() * 0.24));
        const outLean = along * 0.012;
        const leanX = (rand() - 0.5) * 0.14 + tanX * outLean;
        const leanZ = (rand() - 0.5) * 0.14 + tanZ * outLean;
        placeRidgeInstance(
          placedInteriorTrees,
          tx, th, tz,
          hScale, wScale, leanX, leanZ,
          rand() * TAU,
          (rand() - 0.5) * 2
        );
        placedInteriorTrees++;
      }
    }

    // 1B. Exterior gorge crest pines (z ∈ [18, 260], |x| ∈ [42, 95], h >= 13.5)
    let extGuard = 0;
    while (placedExteriorTrees < targetExteriorTrees && extGuard++ < 1800) {
      const side = extGuard % 2 === 0 ? 1 : -1;
      const cz = 18 + rand() * 242;
      const cx = side * (42 + rand() * 53);
      if (Math.abs(cx) > halfBound || Math.abs(cz) > halfBound) continue;
      if (Math.hypot(cx - slitX, cz - slitZ) <= 28.5) continue;
      if (distanceToRiver && distanceToRiver(cx, cz) < 26) continue;
      const ch = sampleGround(cx, cz);
      if (ch < minExteriorH || sampleSlope(cx, cz) > 0.88) continue;

      const clusterSize = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < clusterSize && placedExteriorTrees < targetExteriorTrees; k++) {
        const tx = cx + (rand() - 0.5) * 9.0;
        const tz = cz + (rand() - 0.5) * 14.0;
        if (Math.abs(tx) < 42 || Math.abs(tx) > 95 || tz < 18 || tz > 260) continue;
        if (Math.hypot(tx - slitX, tz - slitZ) <= 28.5) continue;
        if (distanceToRiver && distanceToRiver(tx, tz) < 25) continue;
        const th = sampleGround(tx, tz);
        if (th < minExteriorH || sampleSlope(tx, tz) > 0.88) continue;
        if (tooCloseToTree(tx, tz, 2.8)) continue;

        const hScale = (k === 0 ? 6.0 : 4.4) + rand() * 2.3;
        const wScale = hScale * (0.78 + rand() * 0.22);
        placeRidgeInstance(
          placedInteriorTrees + placedExteriorTrees,
          tx, th, tz,
          hScale, wScale,
          (rand() - 0.5) * 0.14,
          (rand() - 0.5) * 0.14,
          rand() * TAU,
          (rand() - 0.5) * 2
        );
        placedExteriorTrees++;
      }
    }

    const totalRidgeTrees = placedInteriorTrees + placedExteriorTrees;
    ridgeTreesMesh.count = totalRidgeTrees;
    ridgeTreesMesh.instanceMatrix.needsUpdate = true;
    if (ridgeTreesMesh.instanceColor) ridgeTreesMesh.instanceColor.needsUpdate = true;
    if (totalRidgeTrees > 0) ridgeTreesMesh.computeBoundingSphere();
  }
  sharedGroup.add(ridgeTreesMesh);

  // ==========================================================================
  // LAYER 2: 山腰横云流岚 (mountain-waist-clouds, 1 merged Mesh in sharedGroup)
  // ==========================================================================
  const waistCloudsGeo = buildMountainWaistCloudsGeometry(basin, slitX, slitZ, sampleGround, spineLut);
  const waistCloudUniforms = {
    uCloudTime: { value: 0 },
    uCloudColor: { value: new THREE.Color('#CFE0E4') },
    uCloudHighlight: { value: new THREE.Color('#DCEAE8') },
    uCloudOpacity: { value: 0.22 }
  };
  const waistCloudsMat = new THREE.ShaderMaterial({
    uniforms: waistCloudUniforms,
    vertexShader: WAIST_CLOUD_VERT,
    fragmentShader: WAIST_CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false
  });
  waistCloudsMat.userData.skyIgnore = true;
  const waistCloudsMesh = new THREE.Mesh(waistCloudsGeo, waistCloudsMat);
  waistCloudsMesh.name = 'mountain-waist-clouds';
  waistCloudsMesh.userData.skyIgnore = true;
  waistCloudsMesh.renderOrder = 2;
  waistCloudsMesh.frustumCulled = true;
  sharedGroup.add(waistCloudsMesh);

  // ==========================================================================
  // LAYER 3: 暮夜窗前与篝火地面暖光晕 (warm-light-pools, 1 terrain-conforming Mesh)
  // ==========================================================================
  const warmAnchors = [];
  {
    const houses = Array.isArray(village?.houseInfo) ? village.houseInfo : [];
    const rand = lcg(20260808);

    for (let i = 0; i < houses.length; i++) {
      const hi = houses[i];
      if (!hi || !Number.isFinite(hi.x) || !Number.isFinite(hi.z)) continue;
      const rot = Number.isFinite(hi.rot) ? hi.rot : 0;
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      const w = Number.isFinite(hi.w) ? hi.w : 5.2;
      const d = Number.isFinite(hi.d) ? hi.d : 4.2;
      const isOpenHearth = i === 1 || i === 4 || i === 6;

      // Two warm pools directly below houseLight's two glowing front windows (±w * 0.29, front = d * 0.5 + 1.18)
      for (let side = 0; side < 2; side++) {
        const wlx = (side ? 1 : -1) * w * 0.29;
        const wlz = d * 0.5 + 1.18;
        const wwx = hi.x + wlx * ca + wlz * sa;
        const wwz = hi.z - wlx * sa + wlz * ca;
        warmAnchors.push({
          x: wwx,
          z: wwz,
          rot,
          sx: 2.15,
          sz: 1.95,
          weight: 0.78,
          phase: rand() * TAU,
          kind: 0,
          r: 0.96,
          g: 0.62,
          b: 0.24
        });
      }

      // Open-doorway hearth cottages cast an extra warm central threshold spill
      if (isOpenHearth) {
        const flz = d * 0.5 + 1.38;
        const fwx = hi.x + flz * sa;
        const fwz = hi.z + flz * ca;
        warmAnchors.push({
          x: fwx,
          z: fwz,
          rot,
          sx: 2.65,
          sz: 2.25,
          weight: 0.92,
          phase: rand() * TAU,
          kind: 1,
          r: 1.00,
          g: 0.60,
          b: 0.22
        });
      }
    }

    // Night bonfire feast pool (terrain-conforming 5.2m x 5.2m soft radial firelight, active when rainIntensity < 0.28)
    const hearth = qinHanHomestead?.layout?.hearth || { x: 44, z: -128 };
    warmAnchors.push({
      x: Number.isFinite(hearth.x) ? hearth.x : 44,
      z: Number.isFinite(hearth.z) ? hearth.z : -128,
      rot: 0,
      sx: 5.2,
      sz: 5.2,
      weight: 0.95,
      phase: rand() * TAU,
      kind: 2, // bonfire
      r: 1.00,
      g: 0.58,
      b: 0.20
    });
  }

  const warmPoolCount = warmAnchors.length;
  const warmLightGeo = buildWarmLightPoolsGeometry(warmAnchors, sampleGround);
  const warmPoolUniforms = {
    uWarmGlow: { value: 0 },
    uBonfireFactor: { value: 0 },
    uWarmTime: { value: 0 }
  };
  const warmLightMat = new THREE.ShaderMaterial({
    uniforms: warmPoolUniforms,
    vertexShader: WARM_POOL_VERT,
    fragmentShader: WARM_POOL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false
  });
  warmLightMat.userData.skyIgnore = true;
  warmLightMat.toneMapped = false;

  const warmLightPoolsMesh = new THREE.Mesh(warmLightGeo, warmLightMat);
  warmLightPoolsMesh.name = 'warm-light-pools';
  warmLightPoolsMesh.userData.skyIgnore = true;
  warmLightPoolsMesh.renderOrder = 2;
  warmLightPoolsMesh.frustumCulled = true;
  warmLightPoolsMesh.visible = false;
  interiorGroup.add(warmLightPoolsMesh);

  // ==========================================================================
  // LAYER 4A: 涉水/行船动态清波水痕 (water-wake-rings, 48 pooled slots)
  // ==========================================================================
  const wakeRingGeo = buildDoubleWakeRingGeometry();
  const wakeAlphaArray = new Float32Array(MAX_WAKE_SLOTS);
  const wakeAlphaAttr = new THREE.InstancedBufferAttribute(wakeAlphaArray, 1);
  wakeAlphaAttr.setUsage(THREE.DynamicDrawUsage);
  wakeRingGeo.setAttribute('aWakeAlpha', wakeAlphaAttr);

  const wakeRingMat = new THREE.MeshBasicMaterial({
    color: '#DDF0EC',
    vertexColors: true,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  wakeRingMat.forceSinglePass = true;
  wakeRingMat.toneMapped = false;
  wakeRingMat.userData.skyIgnore = true;
  wakeRingMat.onBeforeCompile = function (shader) {
    shader.vertexShader = 'attribute float aRingFeather;\nattribute float aWakeAlpha;\nvarying float vWakeAlpha;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWakeAlpha = aRingFeather * aWakeAlpha;'
      );
    shader.fragmentShader = 'varying float vWakeAlpha;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= vWakeAlpha;'
      );
  };
  chainProgramCacheKey(wakeRingMat, 'ink-water-wake-rings-v1');

  const waterWakeMesh = new THREE.InstancedMesh(wakeRingGeo, wakeRingMat, MAX_WAKE_SLOTS);
  waterWakeMesh.name = 'water-wake-rings';
  waterWakeMesh.userData.skyIgnore = true;
  waterWakeMesh.frustumCulled = false;
  waterWakeMesh.renderOrder = 3;
  waterWakeMesh.count = 0;
  waterWakeMesh.visible = false;
  waterWakeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX_WAKE_SLOTS; i++) {
    _pos.set(0, -100, 0);
    _quat.identity();
    _scl.set(0, 0, 0);
    _mat.compose(_pos, _quat, _scl);
    waterWakeMesh.setMatrixAt(i, _mat);
  }
  waterWakeMesh.instanceMatrix.needsUpdate = true;
  sharedGroup.add(waterWakeMesh);

  // Zero-allocation ripple pool state
  const ripActive = new Uint8Array(MAX_WAKE_SLOTS);
  const ripX = new Float32Array(MAX_WAKE_SLOTS);
  const ripY = new Float32Array(MAX_WAKE_SLOTS);
  const ripZ = new Float32Array(MAX_WAKE_SLOTS);
  const ripAge = new Float32Array(MAX_WAKE_SLOTS);
  const ripLife = new Float32Array(MAX_WAKE_SLOTS);
  const ripMinR = new Float32Array(MAX_WAKE_SLOTS);
  const ripMaxR = new Float32Array(MAX_WAKE_SLOTS);
  const ripStrength = new Float32Array(MAX_WAKE_SLOTS);
  let activeRipples = 0;
  let lastUploadedRipples = 0;

  // Cached boat hull meshes (no per-frame filtering)
  const mooredHullMeshes = [];
  if (boats?.group?.children) {
    for (let i = 0; i < boats.group.children.length; i++) {
      const ch = boats.group.children[i];
      if (ch && ch.isMesh && typeof ch.name === 'string' && ch.name.indexOf('boat-') === 0 && ch.name !== 'boat-moorings') {
        mooredHullMeshes.push(ch);
      }
    }
  }

  function writeWakeVisuals() {
    let writeIdx = 0;
    _quat.identity();
    for (let i = 0; i < MAX_WAKE_SLOTS; i++) {
      if (!ripActive[i]) continue;
      const p = clamp(ripAge[i] / (ripLife[i] || 1), 0, 1);
      const ease = 1 - Math.pow(1 - p, 2.15);
      const radius = lerp(ripMinR[i], ripMaxR[i], ease);
      // Immediate crisp onset when spawned (even at age=0), smooth sine-tail decay
      const env = Math.sin(Math.min(1, p * 0.88 + 0.12) * PI) * (1 - p * p * 0.35);
      const alpha = clamp(env * ripStrength[i], 0, 1);
      if (alpha > 0.004 && radius > 0.02) {
        _pos.set(ripX[i], ripY[i], ripZ[i]);
        _scl.set(radius, 1, radius);
        _mat.compose(_pos, _quat, _scl);
        waterWakeMesh.setMatrixAt(writeIdx, _mat);
        wakeAlphaArray[writeIdx] = alpha;
        writeIdx++;
      }
    }
    for (let i = writeIdx; i < lastUploadedRipples; i++) {
      _pos.set(0, -100, 0);
      _scl.set(0, 0, 0);
      _mat.compose(_pos, _quat, _scl);
      waterWakeMesh.setMatrixAt(i, _mat);
      wakeAlphaArray[i] = 0;
    }
    lastUploadedRipples = writeIdx;
    activeRipples = writeIdx;
    waterWakeMesh.count = writeIdx;
    waterWakeMesh.visible = writeIdx > 0;
    if (writeIdx > 0) {
      waterWakeMesh.instanceMatrix.needsUpdate = true;
      wakeAlphaAttr.needsUpdate = true;
    }
  }

  function spawnRipple(x, y, z, maxRadius = 1.35, strength = 0.82) {
    if (disposed || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    let slot = -1;
    let oldestFrac = -1;
    let oldestSlot = 0;
    for (let i = 0; i < MAX_WAKE_SLOTS; i++) {
      if (!ripActive[i]) {
        slot = i;
        break;
      }
      const frac = ripAge[i] / (ripLife[i] || 1);
      if (frac > oldestFrac) {
        oldestFrac = frac;
        oldestSlot = i;
      }
    }
    if (slot < 0) slot = oldestSlot;

    const rMax = clamp(Number.isFinite(maxRadius) ? maxRadius : 1.35, 0.28, 4.5);
    const str = clamp(Number.isFinite(strength) ? strength : 0.82, 0.06, 1.4);
    ripActive[slot] = 1;
    ripX[slot] = x;
    ripY[slot] = y;
    ripZ[slot] = z;
    ripAge[slot] = 0;
    ripMaxR[slot] = rMax;
    ripMinR[slot] = Math.max(0.14, rMax * 0.18);
    ripLife[slot] = 1.05 + rMax * 0.52;
    ripStrength[slot] = str;
    writeWakeVisuals();
    return true;
  }

  // ==========================================================================
  // LAYER 4B: 池岸碎萍 (pond-duckweed, 1 static Mesh in interiorGroup)
  // ==========================================================================
  const builtDuckweed = buildPondDuckweedGeometry(pondData, sampleGround);
  const pondDuckweedGeo = builtDuckweed.geo;
  const pondDuckweedMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const pondDuckweedMesh = new THREE.Mesh(pondDuckweedGeo, pondDuckweedMat);
  pondDuckweedMesh.name = 'pond-duckweed';
  pondDuckweedMesh.renderOrder = 2;
  pondDuckweedMesh.frustumCulled = true;
  interiorGroup.add(pondDuckweedMesh);

  // ==========================================================================
  // LAYER 4C: 池岸惊蛙跃水弧影 (pond-startled-frog, hidden when idle -> 0 draws)
  // ==========================================================================
  const pondFrogGeo = buildPondFrogGeometry();
  const pondFrogMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const frogLeapMesh = new THREE.Mesh(pondFrogGeo, pondFrogMat);
  frogLeapMesh.name = 'pond-startled-frog';
  frogLeapMesh.visible = false;
  frogLeapMesh.frustumCulled = false;
  interiorGroup.add(frogLeapMesh);

  // ==========================================================================
  // LAYER 5: 飞鸟归林 (valley-birds, 1 InstancedMesh in sharedGroup, 24 slots)
  // ==========================================================================
  const birdGeo = buildValleyBirdGeometry();
  const birdPhases = new Float32Array(BIRD_CAPACITY);
  {
    const bRand = lcg(20260909);
    for (let i = 0; i < BIRD_CAPACITY; i++) {
      birdPhases[i] = i * 1.19 + bRand() * TAU;
    }
  }
  const birdPhaseAttr = new THREE.InstancedBufferAttribute(birdPhases, 1);
  birdGeo.setAttribute('aBirdPhase', birdPhaseAttr);

  const birdTimeUniform = { value: 0 };
  const birdMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  });
  birdMat.onBeforeCompile = function (shader) {
    shader.uniforms.uBirdTime = birdTimeUniform;
    shader.vertexShader = 'attribute float aWing;\nattribute float aBirdPhase;\nuniform float uBirdTime;\n' +
      shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          [
            '#include <beginnormal_vertex>',
            'float birdGlideN = 0.55 + 0.45 * sin(uBirdTime * 0.9 + aBirdPhase * 0.3);',
            'float birdFlapN = sin(uBirdTime * 6.8 + aBirdPhase) * birdGlideN;',
            'objectNormal.x -= sign(position.x) * birdFlapN * 0.34 * step(0.05, aWing);',
            'objectNormal = normalize(objectNormal);'
          ].join('\n')
        )
        .replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            'float birdGlide = 0.55 + 0.45 * sin(uBirdTime * 0.9 + aBirdPhase * 0.3);',
            'float birdFlap = sin(uBirdTime * 6.8 + aBirdPhase) * birdGlide;',
            'transformed.y += birdFlap * aWing * 0.42 - aWing * aWing * 0.14;'
          ].join('\n')
        );
  };
  chainProgramCacheKey(birdMat, 'ink-valley-birds-v1');

  const valleyBirdsMesh = new THREE.InstancedMesh(birdGeo, birdMat, BIRD_CAPACITY);
  valleyBirdsMesh.name = 'valley-birds';
  valleyBirdsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  valleyBirdsMesh.frustumCulled = true;
  valleyBirdsMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(18, 16, -15), 295);

  // Pre-seeded orbital & flock parameters for the 24 birds
  const birdOrbitCx = new Float32Array(BIRD_CAPACITY);
  const birdOrbitCz = new Float32Array(BIRD_CAPACITY);
  const birdOrbitRx = new Float32Array(BIRD_CAPACITY);
  const birdOrbitRz = new Float32Array(BIRD_CAPACITY);
  const birdOrbitRate = new Float32Array(BIRD_CAPACITY);
  const birdOrbitBaseY = new Float32Array(BIRD_CAPACITY);
  const birdScale = new Float32Array(BIRD_CAPACITY);
  const birdFlockOffAlong = new Float32Array(BIRD_CAPACITY);
  const birdFlockOffLat = new Float32Array(BIRD_CAPACITY);
  const birdFlockOffY = new Float32Array(BIRD_CAPACITY);

  {
    const rand = lcg(20260921);
    for (let i = 0; i < BIRD_CAPACITY; i++) {
      // Day/Dawn: 0..6 soar over Wuling stream (x ≈ 8..22, z ≈ 65..220); 7..13 soar over village pond & paddies (x ≈ 42..76, z ≈ -105..-168)
      if (i < 7) {
        birdOrbitCx[i] = 12 + (rand() - 0.5) * 6;
        birdOrbitCz[i] = 84 + (i / 6) * 116 + (rand() - 0.5) * 12;
        birdOrbitRx[i] = 6.5 + rand() * 5.0;
        birdOrbitRz[i] = 18.0 + rand() * 16.0;
        birdOrbitBaseY[i] = 7.4 + rand() * 5.8;
      } else {
        birdOrbitCx[i] = 56 + (rand() - 0.5) * 18;
        birdOrbitCz[i] = -118 - ((i - 7) % 7) * 7.2 + (rand() - 0.5) * 8;
        birdOrbitRx[i] = 10.5 + rand() * 8.0;
        birdOrbitRz[i] = 12.0 + rand() * 11.0;
        birdOrbitBaseY[i] = 8.2 + rand() * 6.0;
      }
      birdOrbitRate[i] = (0.14 + rand() * 0.08) * (i % 2 === 0 ? 1 : -1);
      birdScale[i] = 0.72 + rand() * 0.24;

      // Dusk: 3 loose V/echelon flocks of 8 birds each
      const rank = i % 8;
      if (rank === 0) {
        birdFlockOffAlong[i] = 0;
        birdFlockOffLat[i] = 0;
        birdFlockOffY[i] = 0;
      } else {
        const wingSide = rank % 2 === 1 ? 1 : -1;
        const stepIdx = Math.ceil(rank / 2);
        birdFlockOffAlong[i] = -stepIdx * 2.55 + (rand() - 0.5) * 0.65;
        birdFlockOffLat[i] = wingSide * (stepIdx * 2.15 + (rand() - 0.5) * 0.55);
        birdFlockOffY[i] = stepIdx * 0.22 + (rand() - 0.5) * 0.45;
      }
    }
  }
  sharedGroup.add(valleyBirdsMesh);

  // ==========================================================================
  // LAYER 6: 溪上落英逐水 (stream-drifting-petals, 180 instances in exteriorGroup)
  // ==========================================================================
  const streamPetalGeo = buildStreamPetalGeometry();
  const streamPetalMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const streamPetalsMesh = new THREE.InstancedMesh(streamPetalGeo, streamPetalMat, STREAM_PETAL_COUNT);
  streamPetalsMesh.name = 'stream-drifting-petals';
  streamPetalsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  streamPetalsMesh.frustumCulled = true;
  streamPetalsMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(2, waterLevel, 175), 240);

  const petT = new Float32Array(STREAM_PETAL_COUNT);
  const petLatNorm = new Float32Array(STREAM_PETAL_COUNT);
  const petSpeed = new Float32Array(STREAM_PETAL_COUNT);
  const petSpin = new Float32Array(STREAM_PETAL_COUNT);
  const petYaw = new Float32Array(STREAM_PETAL_COUNT);
  const petPhase = new Float32Array(STREAM_PETAL_COUNT);
  const petScale = new Float32Array(STREAM_PETAL_COUNT);

  {
    const rand = lcg(20261012);
    const tints = [
      new THREE.Color('#FFFFFF'),
      new THREE.Color('#FFF3F6'),
      new THREE.Color('#FCE6EC'),
      new THREE.Color('#FADBE4')
    ];
    for (let i = 0; i < STREAM_PETAL_COUNT; i++) {
      petT[i] = 0.05 + (i / STREAM_PETAL_COUNT) * 0.89 + (rand() - 0.5) * 0.004;
      petT[i] = clamp(petT[i], 0.05, 0.94);
      // Distribute across center channel and gentle shoreline eddies within submerged channel
      const rawLat = (rand() - 0.5) * 2;
      const latNorm = Math.sign(rawLat) * Math.pow(Math.abs(rawLat), 0.85) * 0.88;
      petLatNorm[i] = latNorm;
      const edgeFrac = clamp(Math.abs(latNorm) / 0.88, 0, 1);
      const centerSpd = 0.85 + rand() * 0.40; // 0.85..1.25 m/s
      const bankSpd = 0.32 + rand() * 0.23;   // 0.32..0.55 m/s
      petSpeed[i] = lerp(centerSpd, bankSpd, smoothstep(0.25, 0.78, edgeFrac));
      petSpin[i] = (rand() - 0.5) * (0.45 + edgeFrac * 0.85);
      petYaw[i] = rand() * TAU;
      petPhase[i] = rand() * TAU;
      petScale[i] = 0.88 + rand() * 0.44;
      streamPetalsMesh.setColorAt(i, tints[i % tints.length]);
    }
    if (streamPetalsMesh.instanceColor) streamPetalsMesh.instanceColor.needsUpdate = true;
  }
  exteriorGroup.add(streamPetalsMesh);

  // ==========================================================================
  // Runtime Simulation State (Strictly dt-driven, Zero Heap Allocations)
  // ==========================================================================
  let disposed = false;
  let boundSky = initialSky || null;
  let registeredSkyRef = null;

  let simTime = 0;
  let curTimeId = 'day';
  let curWeatherId = 'clear';
  let curRain = 0;
  let curCloudOpacity = 0.22;
  let curMaxCloudChannel = 0.82;
  let curWarmGlow = 0;
  let curBonfireFactor = 0;
  let curBirdMode = 'day';
  let curActiveBirds = DAY_BIRD_COUNT;
  let lastBirdColorMode = '';

  let skyCacheTime = '';
  let skyCacheWeather = '';
  let skyTransitionRemain = 0;

  // Ripple spawn timers & motion trackers
  let playerRippleTimer = 0;
  let skiffRippleTimer = 0;
  let boatLapTimer = 0.55;
  let boatLapCursor = 0;
  let duckRippleTimer = 0.35;
  let duckCursor = 0;
  let buffaloRippleTimer = 0.9;
  let lastPlayerX = NaN;
  let lastPlayerZ = NaN;
  let lastSkiffX = NaN;
  let lastSkiffZ = NaN;

  // Startled pond-shore frog state (zero per-frame heap allocation)
  const FROG_LEAP_DUR = 0.16;
  let frogCooldown = 0;
  let frogLeapActive = false;
  let frogLeapAge = 0;
  let frogStartX = 0;
  let frogStartY = 0;
  let frogStartZ = 0;
  let frogEndX = 0;
  let frogEndY = 0;
  let frogEndZ = 0;
  let frogYaw = 0;
  let frogEchoTimer = -1;
  let frogEchoX = 0;
  let frogEchoZ = 0;
  let frogStartleCount = 0;
  const pendingEvents = [];

  function syncSkyState(step, activeSky) {
    const s = activeSky || boundSky;
    let timeId = (s && typeof s.timeId === 'string') ? s.timeId : '';
    let weatherId = (s && typeof s.weatherId === 'string') ? s.weatherId : '';
    let rain = Number.isFinite(s?.rainIntensity) ? clamp(s.rainIntensity, 0, 1) : -1;

    // Prefer zero-allocation getAppearanceState() when available; call getAppearance() only as legacy fallback
    let app = null;
    const hasLiveAppearance = Boolean(s && typeof s.getAppearanceState === 'function');
    if (hasLiveAppearance || (s && typeof s.getAppearance === 'function')) {
      if (!timeId || timeId !== skyCacheTime || weatherId !== skyCacheWeather || skyTransitionRemain > 0) {
        if (timeId !== skyCacheTime || weatherId !== skyCacheWeather) {
          skyCacheTime = timeId;
          skyCacheWeather = weatherId;
          skyTransitionRemain = 3.2;
        } else if (step > 0) {
          skyTransitionRemain = Math.max(0, skyTransitionRemain - step);
        }
        app = hasLiveAppearance ? s.getAppearanceState() : s.getAppearance();
      }
    }

    if (!timeId) timeId = (app && typeof app.timeId === 'string') ? app.timeId : 'day';
    if (!weatherId) weatherId = (app && typeof app.weatherId === 'string') ? app.weatherId : (rain >= 0.45 ? 'rain' : 'clear');
    if (rain < 0) {
      rain = Number.isFinite(app?.rainIntensity)
        ? clamp(app.rainIntensity, 0, 1)
        : (weatherId === 'rain' ? 1 : 0);
    } else if (weatherId === 'rain' && rain === 0) {
      rain = 1;
    }
    const mist = weatherId === 'mist' ? 1 : (weatherId === 'rain' ? 0.35 : (rain * 0.35));

    const pal = presetPalettes[timeId] || presetPalettes.day;
    curTimeId = timeId;
    curWeatherId = weatherId;
    curRain = rain;

    // 1. Mountain-waist clouds: fogColor lerped 0.18 toward horizonColor, strictly safe at night/dusk/dawn
    let nightAmt = timeId === 'night' ? 1 : 0;
    if (app) {
      if (app.fogColor) parseColorInto(app.fogColor, _colFog, 0xBAD8E7);
      else _colFog.copy(pal.fog);
      const horizRaw = app.horizonColor || app.skyBottom;
      if (horizRaw) parseColorInto(horizRaw, _colHoriz, 0xB6D9F0);
      else _colHoriz.copy(pal.horiz);
      const rawN = Number.isFinite(app.nightAmount) ? app.nightAmount : app.night;
      if (Number.isFinite(rawN)) nightAmt = Math.max(nightAmt, clamp(rawN, 0, 1));
    } else {
      _colFog.copy(pal.fog);
      _colHoriz.copy(pal.horiz);
    }

    _colBase.copy(_colFog).lerp(_colHoriz, 0.18).lerp(pal.cloudTint, 0.20);
    if (mist > 0.01 || rain > 0.01) {
      // Damp weather softens saturation slightly without brightening night
      const luma = _colBase.r * 0.2126 + _colBase.g * 0.7152 + _colBase.b * 0.0722;
      const dampMix = clamp(Math.max(mist, rain) * 0.28, 0, 0.28);
      _colBase.r = lerp(_colBase.r, luma, dampMix);
      _colBase.g = lerp(_colBase.g, luma * 1.02, dampMix);
      _colBase.b = lerp(_colBase.b, luma * 1.04, dampMix);
    }

    // Strict color cap: at night max RGB MUST be <= 0.17 (never white!)
    const maxCap = timeId === 'night'
      ? 0.15
      : lerp(timeId === 'dusk' ? 0.66 : (timeId === 'dawn' ? 0.74 : 0.80), 0.15, nightAmt);
    clampColorMax(_colBase, maxCap);
    waistCloudUniforms.uCloudColor.value.copy(_colBase);

    _col.copy(_colBase).multiplyScalar(timeId === 'night' ? 1.06 : 1.08);
    clampColorMax(_col, timeId === 'night' ? 0.165 : Math.min(0.86, maxCap * 1.08));
    waistCloudUniforms.uCloudHighlight.value.copy(_col);

    const dampBoost = clamp(Math.max(mist, rain), 0, 1);
    const targetCloudOp = timeId === 'night'
      ? lerp(0.14, 0.18, dampBoost)
      : lerp(pal.opacity, 0.42, dampBoost);
    curCloudOpacity = targetCloudOp;
    waistCloudUniforms.uCloudOpacity.value = targetCloudOp;
    curMaxCloudChannel = Math.max(
      waistCloudUniforms.uCloudColor.value.r,
      waistCloudUniforms.uCloudColor.value.g,
      waistCloudUniforms.uCloudColor.value.b
    );

    // 2. Water-wake-rings live color (pale jade #DDF0EC day, peach-gold #E8CBB4 dusk/dawn, dim slate #485E70 night)
    wakeRingMat.color.copy(pal.wake);
    if (nightAmt > 0.01 && timeId !== 'night') {
      wakeRingMat.color.lerp(presetPalettes.night.wake, nightAmt);
    }
    wakeRingMat.opacity = timeId === 'night' ? 0.30 : (timeId === 'day' ? 0.48 : 0.44);

    // 3. Warm-light-pools glow (0 in day -> visible=false; ~0.38 dusk; ~0.68 night; ~0.10 dawn)
    let glow = pal.glow;
    if (app && Number.isFinite(app.night)) {
      const n = clamp(app.night, 0, 1);
      if (timeId === 'day') {
        const twAmt = clamp(Number(s?.getTwilightState?.()?.amount) || 0, 0, 1);
        glow = n * 0.68 + twAmt * 0.10;
      } else if (timeId === 'night') {
        glow = lerp(0.38, 0.68, n);
      } else if (timeId === 'dawn') {
        glow = lerp(0.10, 0.68, n);
      }
    }
    curWarmGlow = glow;
    curBonfireFactor = (timeId === 'night' && rain < 0.28)
      ? 1.0
      : (timeId === 'dusk' && rain < 0.28 ? 0.28 : 0.0);
  }

  function updateWarmLightPools() {
    if (curWarmGlow < 0.006 || warmPoolCount === 0) {
      warmLightPoolsMesh.visible = false;
      return;
    }
    warmLightPoolsMesh.visible = true;
    warmPoolUniforms.uWarmGlow.value = curWarmGlow;
    warmPoolUniforms.uBonfireFactor.value = curBonfireFactor;
    warmPoolUniforms.uWarmTime.value = simTime;
  }

  function updateValleyBirds() {
    if (curTimeId === 'night' || curRain >= 0.45) {
      valleyBirdsMesh.visible = false;
      curBirdMode = 'roosting';
      curActiveBirds = 0;
      return;
    }

    valleyBirdsMesh.visible = true;
    birdTimeUniform.value = simTime;

    if (curTimeId === 'dusk') {
      // 山气日夕佳，飞鸟相与还: all 24 birds in 3 loose V/echelon flocks gliding toward W/N mountain groves
      curBirdMode = 'dusk-flock';
      curActiveBirds = BIRD_CAPACITY;
      valleyBirdsMesh.count = BIRD_CAPACITY;

      if (lastBirdColorMode !== 'dusk') {
        lastBirdColorMode = 'dusk';
        for (let i = 0; i < BIRD_CAPACITY; i++) {
          _col.setHex(i % 2 === 0 ? 0x52454A : 0x685658, THREE.SRGBColorSpace);
          valleyBirdsMesh.setColorAt(i, _col);
        }
        if (valleyBirdsMesh.instanceColor) valleyBirdsMesh.instanceColor.needsUpdate = true;
      }

      // Direction vector from (96, -74) -> (-92, -216)
      const startX = 96, startZ = -74;
      const endX = -92, endZ = -216;
      const dirX = endX - startX;
      const dirZ = endZ - startZ;
      const pathLen = Math.hypot(dirX, dirZ) || 1;
      const fwdX = dirX / pathLen;
      const fwdZ = dirZ / pathLen;
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const baseYaw = Math.atan2(fwdX, fwdZ);

      for (let i = 0; i < BIRD_CAPACITY; i++) {
        const flock = (i / 8) | 0;
        const flockProgress = ((simTime * 0.029 + flock * 0.3333) % 1 + 1) % 1;
        const leadX = lerp(startX, endX, flockProgress) + (flock - 1) * rightX * 22.0;
        const leadZ = lerp(startZ, endZ, flockProgress) + (flock - 1) * rightZ * 22.0;
        const leadY = lerp(15.5, 25.5, flockProgress) + flock * 1.1;

        const swayLat = Math.sin(simTime * 0.85 + birdPhases[i]) * 0.45;
        const swayY = Math.cos(simTime * 1.1 + birdPhases[i] * 0.7) * 0.32;
        const bx = leadX + fwdX * birdFlockOffAlong[i] + rightX * (birdFlockOffLat[i] + swayLat);
        const bz = leadZ + fwdZ * birdFlockOffAlong[i] + rightZ * (birdFlockOffLat[i] + swayLat);
        const minSafeY = sampleGround(bx, bz) + 5.2;
        const by = Math.max(minSafeY, leadY + birdFlockOffY[i] + swayY);

        // Seamless envelope at extreme ends outside valley ridge
        const edgeScale = smoothstep(0.0, 0.06, flockProgress) * (1 - smoothstep(0.94, 1.0, flockProgress));
        const sc = birdScale[i] * edgeScale;
        const bank = Math.sin(simTime * 0.7 + birdPhases[i]) * 0.12;
        _pos.set(bx, by, bz);
        _euler.set(-0.04, baseYaw, bank, 'YXZ');
        _quat.setFromEuler(_euler);
        _scl.set(sc, sc, sc);
        _mat.compose(_pos, _quat, _scl);
        valleyBirdsMesh.setMatrixAt(i, _mat);
      }
      valleyBirdsMesh.instanceMatrix.needsUpdate = true;
    } else {
      // Dawn / Day: 14 snow-white egrets soaring low over Wuling stream & village pond/paddies
      curBirdMode = 'day-egrets';
      curActiveBirds = DAY_BIRD_COUNT;
      valleyBirdsMesh.count = DAY_BIRD_COUNT;

      if (lastBirdColorMode !== 'day') {
        lastBirdColorMode = 'day';
        for (let i = 0; i < BIRD_CAPACITY; i++) {
          _col.setHex(i % 2 === 0 ? 0xF3F5EE : 0xECEFE6, THREE.SRGBColorSpace);
          valleyBirdsMesh.setColorAt(i, _col);
        }
        if (valleyBirdsMesh.instanceColor) valleyBirdsMesh.instanceColor.needsUpdate = true;
      }

      for (let i = 0; i < DAY_BIRD_COUNT; i++) {
        const rate = birdOrbitRate[i];
        const ph = birdPhases[i];
        const a = simTime * rate + ph;
        const rx = birdOrbitRx[i];
        const rz = birdOrbitRz[i];
        const isFig8 = (i % 3) === 0;

        let bx, bz, vx, vz;
        if (isFig8) {
          bx = birdOrbitCx[i] + Math.sin(a) * rx;
          bz = birdOrbitCz[i] + Math.sin(a * 2) * rz * 0.55;
          vx = Math.cos(a) * rx * rate;
          vz = Math.cos(a * 2) * 2 * rz * 0.55 * rate;
        } else {
          bx = birdOrbitCx[i] + Math.cos(a) * rx;
          bz = birdOrbitCz[i] + Math.sin(a) * rz;
          vx = -Math.sin(a) * rx * rate;
          vz = Math.cos(a) * rz * rate;
        }

        const vy = Math.cos(a * 1.5 + ph) * 1.15 * Math.abs(rate);
        const rawY = birdOrbitBaseY[i] + Math.sin(a * 1.5 + ph) * 1.4;
        const by = clamp(Math.max(rawY, sampleGround(bx, bz) + 4.2), 6.5, 15.5);

        const yaw = Math.atan2(vx, vz);
        const horizSpd = Math.hypot(vx, vz) || 1;
        const pitch = clamp(-vy / horizSpd, -0.25, 0.25);
        const bank = clamp((isFig8 ? Math.sin(a * 2) : -Math.sign(rate)) * 0.26, -0.42, 0.42);
        const sc = birdScale[i];

        _pos.set(bx, by, bz);
        _euler.set(pitch, yaw, bank, 'YXZ');
        _quat.setFromEuler(_euler);
        _scl.set(sc, sc, sc);
        _mat.compose(_pos, _quat, _scl);
        valleyBirdsMesh.setMatrixAt(i, _mat);
      }
      valleyBirdsMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function updateStreamPetals(step, waveClock) {
    const streamLen = spineLut.length;
    const hasSurfaceY = stream && typeof stream.surfaceY === 'function';
    const xs = spineLut.xs;
    const zs = spineLut.zs;
    const nxs = spineLut.nxs;
    const nzs = spineLut.nzs;
    const halves = spineLut.halves;
    const wetPos = spineLut.wetPos;
    const wetNeg = spineLut.wetNeg;

    for (let i = 0; i < STREAM_PETAL_COUNT; i++) {
      if (step > 0) {
        let tNext = petT[i] - (step * petSpeed[i]) / streamLen;
        if (tNext < 0.05) {
          tNext += 0.89;
          if (tNext > 0.94) tNext = 0.94;
        }
        petT[i] = tNext;
        petYaw[i] = (petYaw[i] + step * petSpin[i]) % TAU;
      }

      const t = petT[i];
      const fIdx = clamp(t, 0, 1) * SPINE_SAMPLES;
      const i0 = Math.min(SPINE_SAMPLES - 1, fIdx | 0);
      const frac = fIdx - i0;

      const cx = lerp(xs[i0], xs[i0 + 1], frac);
      const cz = lerp(zs[i0], zs[i0 + 1], frac);
      const nx = lerp(nxs[i0], nxs[i0 + 1], frac);
      const nz = lerp(nzs[i0], nzs[i0 + 1], frac);
      const half = lerp(halves[i0], halves[i0 + 1], frac);
      const maxPos = Math.min(half * 0.78, lerp(wetPos[i0], wetPos[i0 + 1], frac));
      const maxNeg = Math.min(half * 0.78, lerp(wetNeg[i0], wetNeg[i0 + 1], frac));

      const baseLat = petLatNorm[i];
      const edgeAmt = Math.abs(baseLat) / 0.88;
      const swirl = Math.sin(simTime * (0.62 + edgeAmt * 0.55) + petPhase[i]) * (0.04 + edgeAmt * 0.08);
      const normLat = clamp(baseLat + swirl, -0.96, 0.96);
      const lat = normLat >= 0 ? normLat * maxPos : normLat * maxNeg;

      const wx = cx + nx * lat;
      const wz = cz + nz * lat;

      const wy = (hasSurfaceY ? stream.surfaceY(t, waveClock) : waterLevel) + 0.022;
      const pitch = Math.sin(simTime * 1.8 + petPhase[i]) * 0.075;
      const roll = Math.cos(simTime * 1.5 + petPhase[i]) * 0.085;
      const sc = petScale[i];

      _pos.set(wx, wy, wz);
      _euler.set(pitch, petYaw[i], roll, 'YXZ');
      _quat.setFromEuler(_euler);
      _scl.set(sc, sc, sc);
      _mat.compose(_pos, _quat, _scl);
      streamPetalsMesh.setMatrixAt(i, _mat);
    }
    streamPetalsMesh.instanceMatrix.needsUpdate = true;
  }

  function stepRipplesAndTriggers(step, waveClock, playerState) {
    // Advance existing ripple lifetimes
    let anyActive = false;
    for (let i = 0; i < MAX_WAKE_SLOTS; i++) {
      if (!ripActive[i]) continue;
      ripAge[i] += step;
      if (ripAge[i] >= ripLife[i]) {
        ripActive[i] = 0;
      } else {
        anyActive = true;
      }
    }

    // 1. Player wading in stream or pond + sprinting shore-frog startle
    if (playerRippleTimer > 0) playerRippleTimer -= step;
    if (frogCooldown > 0) frogCooldown = Math.max(0, frogCooldown - step);
    if (frogEchoTimer >= 0) {
      frogEchoTimer -= step;
      if (frogEchoTimer <= 0) {
        frogEchoTimer = -1;
        spawnRipple(frogEchoX, pondWaterY + 0.02, frogEchoZ, 0.68, 0.66);
        anyActive = true;
      }
    }
    if (frogLeapActive) {
      frogLeapAge += step;
      if (frogLeapAge >= FROG_LEAP_DUR) {
        frogLeapActive = false;
        frogLeapMesh.visible = false;
        spawnRipple(frogEndX, pondWaterY + 0.02, frogEndZ, 1.04, 0.94);
        frogEchoTimer = 0.14;
        frogEchoX = frogEndX;
        frogEchoZ = frogEndZ;
        if (pendingEvents.length < 8) {
          pendingEvents.push({ type: 'frogPlop', x: frogEndX, z: frogEndZ });
        }
        anyActive = true;
      } else {
        const u = frogLeapAge / FROG_LEAP_DUR;
        frogLeapMesh.position.set(
          lerp(frogStartX, frogEndX, u),
          lerp(frogStartY, frogEndY, u) + Math.sin(u * PI) * 0.18,
          lerp(frogStartZ, frogEndZ, u)
        );
        frogLeapMesh.rotation.set(lerp(-0.42, 0.68, u), frogYaw, 0, 'YXZ');
      }
    }
    if (playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z) && !playerState.aboardSkiff) {
      const px = playerState.x;
      const pz = playerState.z;
      let pSpeed = Number.isFinite(playerState.speed) ? playerState.speed : 0;
      if (Number.isFinite(playerState.vx) && Number.isFinite(playerState.vz)) {
        pSpeed = Math.max(pSpeed, Math.hypot(playerState.vx, playerState.vz));
      } else if (Number.isFinite(lastPlayerX) && step > 1e-4) {
        pSpeed = Math.hypot(px - lastPlayerX, pz - lastPlayerZ) / step;
      }
      lastPlayerX = px;
      lastPlayerZ = pz;

      // Sprinting near the pond shore startles a basking bank-frog into the water
      const isSprinting = Boolean(playerState.sprinting) || pSpeed > 5.2;
      if (isSprinting && !frogLeapActive && frogCooldown <= 0 && interiorGroup.visible && curRain < 0.65) {
        const dx = px - pondX;
        const dz = pz - pondZ;
        const dCenter = Math.hypot(dx, dz);
        const baseAng = Math.atan2(dz, dx);
        const rimR = pondRimRadiusAt(baseAng);
        if (dCenter >= rimR - 0.85 && dCenter <= rimR + 6.0) {
          const vx = Number.isFinite(playerState.vx) ? playerState.vx : 0;
          const vz = Number.isFinite(playerState.vz) ? playerState.vz : 0;
          const cross = dx * vz - dz * vx;
          const plopAng = baseAng + (Math.abs(cross) > 0.4 ? Math.sign(cross) * 0.20 : 0.10);
          const edgeR = pondRimRadiusAt(plopAng);
          frogStartX = pondX + Math.cos(plopAng) * (edgeR + 0.06);
          frogStartZ = pondZ + Math.sin(plopAng) * (edgeR + 0.06);
          frogStartY = Math.max(pondWaterY + 0.025, sampleGround(frogStartX, frogStartZ) + 0.02);
          const diveR = Math.max(1.2, edgeR - 0.62);
          frogEndX = pondX + Math.cos(plopAng) * diveR;
          frogEndZ = pondZ + Math.sin(plopAng) * diveR;
          frogEndY = pondWaterY - 0.02;
          frogYaw = Math.atan2(frogEndX - frogStartX, frogEndZ - frogStartZ);
          frogLeapActive = true;
          frogLeapAge = 0;
          frogCooldown = 5.4;
          frogStartleCount++;
          frogLeapMesh.visible = true;
          frogLeapMesh.position.set(frogStartX, frogStartY, frogStartZ);
          frogLeapMesh.rotation.set(-0.42, frogYaw, 0, 'YXZ');
          const skimR = Math.max(1.2, edgeR - 0.14);
          spawnRipple(
            pondX + Math.cos(plopAng) * skimR,
            pondWaterY + 0.018,
            pondZ + Math.sin(plopAng) * skimR,
            0.46,
            0.52
          );
          anyActive = true;
        }
      }

      if (pSpeed > 0.22 && playerRippleTimer <= 0) {
        const dPond = Math.hypot(px - pondX, pz - pondZ);
        const inPond = dPond <= pondMaxR + 0.35;
        const inStream = !inPond && (!distanceToRiver || distanceToRiver(px, pz) < 28);
        if (inPond || inStream) {
          const targetWaterY = inPond ? pondWaterY : waterLevel;
          const gy = sampleGround(px, pz);
          if (playerState.wading || gy < targetWaterY + 0.08) {
            spawnRipple(px, targetWaterY + 0.02, pz, clamp(1.05 + pSpeed * 0.11, 1.1, 1.75), 0.80);
            playerRippleTimer = pSpeed > 4.2 ? 0.20 : 0.30;
            anyActive = true;
          }
        }
      }
    }

    // 2. RiverSkiff moving or punting
    if (skiffRippleTimer > 0) skiffRippleTimer -= step;
    if (riverSkiff && skiffRippleTimer <= 0) {
      let sx = NaN, sy = waterLevel, sz = NaN, skSpeed = 0, punting = false;
      if (typeof riverSkiff.getState === 'function') {
        const st = riverSkiff.getState();
        if (st && Number.isFinite(st.x) && Number.isFinite(st.z)) {
          sx = st.x;
          sy = Number.isFinite(st.y) ? st.y : waterLevel;
          sz = st.z;
          skSpeed = Math.hypot(st.speed || 0, st.latSpeed || 0);
          punting = Boolean(st.punting);
        }
      } else {
        const rig = riverSkiff.group?.children?.[0];
        if (rig && rig.position) {
          sx = rig.position.x;
          sz = rig.position.z;
          sy = waterLevel;
          if (Number.isFinite(lastSkiffX) && step > 1e-4) {
            skSpeed = Math.hypot(sx - lastSkiffX, sz - lastSkiffZ) / step;
          }
          lastSkiffX = sx;
          lastSkiffZ = sz;
        }
      }
      if (Number.isFinite(sx) && (skSpeed > 0.22 || punting)) {
        const wy = (stream && typeof stream.surfaceY === 'function' ? stream.surfaceY(0.45, waveClock) : sy) + 0.022;
        spawnRipple(sx, wy, sz, clamp(1.55 + skSpeed * 0.18, 1.5, 2.45), punting ? 0.88 : 0.72);
        skiffRippleTimer = punting ? 0.24 : 0.34;
        anyActive = true;
      }
    }

    // 3. Moored boats gentle hull-lap rings
    if (mooredHullMeshes.length > 0 && exteriorGroup.visible) {
      boatLapTimer -= step;
      if (boatLapTimer <= 0) {
        boatLapTimer = 1.45;
        const hull = mooredHullMeshes[boatLapCursor % mooredHullMeshes.length];
        boatLapCursor = (boatLapCursor + 1) % mooredHullMeshes.length;
        if (hull && hull.visible) {
          spawnRipple(hull.position.x, hull.position.y + 0.022, hull.position.z, 1.48, 0.36);
          anyActive = true;
        }
      }
    }

    // 4. Pond swimming ducks & daytime wallowing water buffalo
    if (interiorGroup.visible) {
      duckRippleTimer -= step;
      const animals = fauna?.animals;
      if (duckRippleTimer <= 0 && Array.isArray(animals) && animals.length > 0) {
        duckRippleTimer = 0.75;
        for (let k = 0; k < animals.length; k++) {
          const idx = (duckCursor + k) % animals.length;
          const a = animals[idx];
          if (a && a.kind === 'duck' && a.mode !== 'sleep' && Number.isFinite(a.x) && Number.isFinite(a.z)) {
            if (Math.hypot(a.x - pondX, a.z - pondZ) < pondMaxR * 0.94) {
              duckCursor = (idx + 1) % animals.length;
              spawnRipple(a.x, pondWaterY + 0.018, a.z, a.mode === 'paddle' ? 0.95 : 0.74, 0.46);
              anyActive = true;
              break;
            }
          }
        }
      }

      buffaloRippleTimer -= step;
      const buf = qinHanHomestead?.layout?.buffalo;
      if (buffaloRippleTimer <= 0 && buf && (curTimeId === 'day' || curTimeId === 'dawn') && curRain < 0.45) {
        buffaloRippleTimer = 2.6;
        if (Number.isFinite(buf.x) && Number.isFinite(buf.z) && Math.hypot(buf.x - pondX, buf.z - pondZ) < pondMaxR) {
          spawnRipple(buf.x, pondWaterY + 0.02, buf.z, 1.55, 0.50);
          anyActive = true;
        }
      }
    }

    if (anyActive || lastUploadedRipples > 0) {
      writeWakeVisuals();
    }
  }

  function registerSky(skyInstance) {
    if (!skyInstance) return;
    boundSky = skyInstance;
    if (typeof skyInstance.registerMaterials === 'function' && registeredSkyRef !== skyInstance) {
      registeredSkyRef = skyInstance;
      skyInstance.registerMaterials(ridgeTreesMesh);
      skyInstance.registerMaterials(pondDuckweedMesh);
      skyInstance.registerMaterials(frogLeapMesh);
      skyInstance.registerMaterials(valleyBirdsMesh);
      skyInstance.registerMaterials(streamPetalsMesh);
    }
    syncSkyState(0, skyInstance);
    updateWarmLightPools();
    updateValleyBirds();
  }

  function update(dt, elapsed, skyInstance, playerState, camera) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.1);
    simTime += step;
    const waveClock = Number.isFinite(elapsed) ? elapsed : simTime;

    if (skyInstance && skyInstance !== boundSky) {
      boundSky = skyInstance;
    }

    syncSkyState(step, skyInstance || boundSky);
    waistCloudUniforms.uCloudTime.value = simTime;

    if (interiorGroup.visible) {
      updateWarmLightPools();
    } else {
      warmLightPoolsMesh.visible = false;
    }

    updateValleyBirds();

    if (exteriorGroup.visible) {
      updateStreamPetals(step, waveClock);
    }

    stepRipplesAndTriggers(step, waveClock, playerState);
  }

  // Initial static & t=0 poses
  syncSkyState(0, boundSky);
  updateWarmLightPools();
  updateValleyBirds();
  updateStreamPetals(0, 0);
  if (boundSky && typeof boundSky.registerMaterials === 'function') {
    registerSky(boundSky);
  }

  function isChainVisible(obj) {
    if (disposed || !obj) return false;
    let reachedRoot = false;
    for (let p = obj; p; p = p.parent) {
      if (p.visible === false) return false;
      if (p === group) {
        reachedRoot = true;
        break;
      }
    }
    return reachedRoot && group.visible !== false;
  }

  function meshTriangles(mesh) {
    const g = mesh.geometry;
    const triPer = (g.index ? g.index.count : g.attributes.position.count) / 3;
    return mesh.isInstancedMesh ? triPer * mesh.count : triPer;
  }

  function getStats() {
    const meshes = [
      ridgeTreesMesh,
      waistCloudsMesh,
      warmLightPoolsMesh,
      waterWakeMesh,
      pondDuckweedMesh,
      frogLeapMesh,
      valleyBirdsMesh,
      streamPetalsMesh
    ];
    let drawCalls = 0;
    let triangles = 0;
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m || !isChainVisible(m)) continue;
      if (m.isInstancedMesh && m.count <= 0) continue;
      drawCalls++;
      triangles += meshTriangles(m);
    }

    return {
      built: true,
      disposed,
      simTime: Math.round(simTime * 1000) / 1000,
      timeId: curTimeId,
      weatherId: curWeatherId,
      drawCalls,
      triangles: Math.round(triangles),
      ridgeTreeCount: ridgeTreesMesh.count,
      cloudRibbonCount: 14,
      cloudOpacity: Math.round(curCloudOpacity * 1000) / 1000,
      warmLightCount: warmPoolCount,
      warmLightGlow: Math.round(curWarmGlow * 1000) / 1000,
      activeRipples,
      startledFrogs: frogStartleCount,
      frogLeaping: frogLeapActive,
      duckweedClusters: builtDuckweed.clusterCount,
      shorePebbles: builtDuckweed.pebbleCount,
      activeBirds: valleyBirdsMesh.visible ? curActiveBirds : 0,
      streamPetalCount: streamPetalsMesh.count,
      ridgeTrees: {
        count: ridgeTreesMesh.count,
        interiorCount: placedInteriorTrees,
        exteriorCount: placedExteriorTrees,
        trianglesPerInstance: (ridgeTreeGeo.index.count / 3),
        visible: isChainVisible(ridgeTreesMesh)
      },
      waistClouds: {
        ribbons: 14,
        interiorRibbons: 10,
        exteriorRibbons: 4,
        opacity: Math.round(curCloudOpacity * 1000) / 1000,
        maxColorChannel: Math.round(curMaxCloudChannel * 10000) / 10000,
        triangles: waistCloudsGeo.index.count / 3,
        visible: isChainVisible(waistCloudsMesh)
      },
      warmLightPools: {
        count: warmPoolCount,
        cottagePools: Math.max(0, warmPoolCount - 1),
        hasBonfirePool: warmPoolCount > 0,
        glow: Math.round(curWarmGlow * 1000) / 1000,
        bonfireFactor: Math.round(curBonfireFactor * 1000) / 1000,
        visible: isChainVisible(warmLightPoolsMesh)
      },
      waterWakeRings: {
        capacity: MAX_WAKE_SLOTS,
        activeRipples,
        visible: isChainVisible(waterWakeMesh) && activeRipples > 0
      },
      pondDuckweed: {
        clusters: builtDuckweed.clusterCount,
        pebbles: builtDuckweed.pebbleCount,
        triangles: pondDuckweedGeo.index.count / 3,
        visible: isChainVisible(pondDuckweedMesh)
      },
      valleyBirds: {
        capacity: BIRD_CAPACITY,
        activeCount: valleyBirdsMesh.visible ? curActiveBirds : 0,
        mode: curBirdMode,
        trianglesPerInstance: birdGeo.index.count / 3,
        visible: isChainVisible(valleyBirdsMesh)
      },
      streamPetals: {
        count: streamPetalsMesh.count,
        trianglesPerInstance: streamPetalGeo.index.count / 3,
        visible: isChainVisible(streamPetalsMesh)
      }
    };
  }

  function consumeEvents() {
    if (!pendingEvents.length) return [];
    return pendingEvents.splice(0, pendingEvents.length);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    activeRipples = 0;
    frogLeapActive = false;
    pendingEvents.length = 0;
    waterWakeMesh.visible = false;
    frogLeapMesh.visible = false;
    warmLightPoolsMesh.visible = false;
    valleyBirdsMesh.visible = false;

    const meshes = [
      ridgeTreesMesh,
      waistCloudsMesh,
      warmLightPoolsMesh,
      waterWakeMesh,
      pondDuckweedMesh,
      frogLeapMesh,
      valleyBirdsMesh,
      streamPetalsMesh
    ];
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m) continue;
      if (typeof m.dispose === 'function') m.dispose();
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
      if (m.parent) m.parent.remove(m);
    }
    group.removeFromParent();
  }

  return {
    group,
    exteriorGroup,
    interiorGroup,
    sharedGroup,
    registerSky,
    spawnRipple,
    consumeEvents,
    update,
    getStats,
    dispose
  };
}
