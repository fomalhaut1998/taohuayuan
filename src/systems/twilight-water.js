import * as THREE from 'three';
import inkWater from '../data/ink-water.json' with { type: 'json' };

// Both modes remain ordinary transparent Lambert draws, with no static-audit
// exemption. The default twilight path is unchanged; optional ink attributes
// are owned and restored by createWaterSurface without changing topology.
const installed = new WeakMap();
const PROJECT = '#include <project_vertex>';
const OUTPUT = '#include <opaque_fragment>';
const VARYING = 'varying vec3 vTwilightWaterPosition;\n';
const MAX_GAIN = 0.18;
const FRAGMENT = /* glsl */`
uniform float uTwilightWaterAmount;
uniform float uTwilightWaterClock;
uniform vec3 uTwilightWaterDirection;
uniform vec3 uTwilightWaterColor;
varying vec3 vTwilightWaterPosition;

// Scalar, guarded math also permits a focused numeric oracle of this exact GLSL.
// p and eye are world-space: projection, geometry and existing CPU waves are not
// touched. The small analytic normal only controls fragment highlights.
float twilightWaterGain(vec3 p, vec3 eye, vec3 sun, float clock) {
  float dx = eye.x - p.x;
  float dy = eye.y - p.y;
  float dz = eye.z - p.z;
  float horizontal2 = dx * dx + dz * dz;
  float sunHorizontal2 = sun.x * sun.x + sun.z * sun.z;
  if (horizontal2 < 0.000001 || sunHorizontal2 < 0.000001 || dy <= 0.0 || sun.y <= 0.0) return 0.0;
  float facing = -(dx * sun.x + dz * sun.z) / sqrt(horizontal2 * sunHorizontal2);
  float path = smoothstep(0.25, 0.90, facing);
  if (path <= 0.0) return 0.0;
  float distance = sqrt(horizontal2 + dy * dy);
  float hx = dx / distance + sun.x;
  float hy = dy / distance + sun.y;
  float hz = dz / distance + sun.z;
  float half2 = max(hx * hx + hy * hy + hz * hz, 0.000001);
  float nx = 0.11 * sin(p.z * 2.1 + sin(p.x * 0.45) * 1.6 + clock * 1.3) + 0.065 * sin(p.x * 3.4 - p.z * 1.1 - clock * 0.85);
  float nz = 0.10 * cos(p.x * 1.9 + cos(p.z * 0.52) * 1.5 + clock * 0.9) + 0.048 * sin(p.z * 3.9 + p.x * 1.7 + clock * 1.65);
  float normal2 = nx * nx + 1.0 + nz * nz;
  float specular = pow(clamp((nx * hx + hy + nz * hz) / sqrt(normal2 * half2), 0.0, 1.0), 68.0);
  float wA = sin(p.x * 1.35 + p.z * 3.65 + sin(p.x * 0.58 - p.z * 0.44) * 2.1 + clock * 1.65);
  float wB = cos(p.x * 2.85 - p.z * 2.25 + cos(p.z * 0.72 + p.x * 0.42) * 1.8 - clock * 1.20);
  float wC = sin(p.x * 5.10 + p.z * 6.20 - clock * 2.25);
  float fleck = 0.46 * wA + 0.36 * wB + 0.18 * wC;
  float ripple = smoothstep(0.22, 0.78, 0.5 + 0.5 * fleck);
  return 0.18 * path * specular * ripple;
}
`;
const ADD_LIGHT = /* glsl */`
// Zero amount bypasses the addition entirely: settled day/night keep the
// original Lambert output (including its existing appearance/texture/alpha).
if (uTwilightWaterAmount > 0.0) {
  outgoingLight += uTwilightWaterColor * (uTwilightWaterAmount * twilightWaterGain(
    vTwilightWaterPosition, cameraPosition, uTwilightWaterDirection, uTwilightWaterClock));
}
`;

const unit = value => Math.max(0, Math.min(1, value));


// Shared by stream and pond; no new draw, texture, render target or reflection.
const MAX_REFLECTORS = 8;
const INK_VERTEX = 'attribute float inkWaterDepth;\nattribute float inkWaterBank;\nvarying vec2 vInkWaterShore;\n';
const INK_FRAGMENT = /* glsl */`
uniform float uInkWaterClock;
uniform float uInkWaterKind;
uniform float uInkWaterDepthScale;
uniform float uInkWaterMix;
uniform float uInkWaterRipple;
uniform float uInkWaterContrast;
uniform vec3 uInkWaterShallow;
uniform vec3 uInkWaterDeep;
uniform vec3 uInkSkyTop;
uniform vec3 uInkSkyHorizon;
uniform vec3 uInkSilColor;
uniform vec4 uInkReflParams;
uniform vec2 uInkReflStretch;
uniform int uInkReflectCount;
uniform vec4 uInkReflectPos[8];
uniform vec4 uInkReflectShape[8];
varying vec2 vInkWaterShore;
float inkWaterHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float inkWaterNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = inkWaterHash21(i);
  float b = inkWaterHash21(i + vec2(1.0, 0.0));
  float c = inkWaterHash21(i + vec2(0.0, 1.0));
  float d = inkWaterHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float inkWaterFbm2(vec2 p) {
  return inkWaterNoise2(p) * 0.64 + inkWaterNoise2(p * 2.07 + vec2(5.3, 1.7)) * 0.36;
}
float inkWaterFlow(vec3 p) {
  return 0.56 * sin(p.x * 0.42 + p.z * 0.61 - uInkWaterClock)
       + 0.31 * sin(p.x * -0.83 + p.z * 1.29 - uInkWaterClock * 0.68)
       + 0.13 * cos(p.x * 1.95 + p.z * 2.35 + uInkWaterClock * 1.35);
}
float inkCasterMask(vec3 p, vec2 hDir, float effSlope, vec4 rPos, vec4 rShape) {
  vec2 rel = rPos.xz - p.xz;
  float t = dot(rel, hDir);
  if (t <= 0.35 || t >= 48.0) return 0.0;
  vec2 closest = p.xz + hDir * t - rPos.xz;
  float latSigned = closest.x * (-hDir.y) + closest.y * hDir.x;
  float lat = abs(latSigned);
  float rad = max(rPos.w, 0.35);
  if (lat > rad * 1.45) return 0.0;
  float h = max(rShape.x, 0.5);
  float bankSetback = clamp((rPos.y - p.y) * 5.6, 0.0, t * 0.72);
  float localY = (t - bankSetback) * effSlope;
  if (localY < -0.12 || localY > h * 1.06) return 0.0;
  float uY = clamp(localY / h, 0.0, 1.0);
  float kind = rShape.y;
  float mask = 0.0;
  if (kind > 0.5 && kind < 1.5) {
    float posts = (1.0 - smoothstep(0.11, 0.34, abs(lat - rad * 0.72))) * (1.0 - smoothstep(0.58, 0.64, uY)) * 0.86;
    float tableCore = (1.0 - smoothstep(0.10, 0.42, lat)) * (1.0 - smoothstep(0.24, 0.34, uY)) * 0.45;
    float tieBeam = smoothstep(0.51, 0.58, uY) * (1.0 - smoothstep(0.60, 0.65, uY)) * (1.0 - smoothstep(rad * 0.76, rad * 0.96, lat)) * 0.82;
    float roofT = clamp((uY - 0.56) / 0.44, 0.0, 1.0);
    float roofHalf = rad * mix(1.20, 0.14, pow(roofT, 0.80));
    float roof = (1.0 - smoothstep(roofHalf * 0.76, roofHalf * 1.06, lat)) * smoothstep(0.53, 0.60, uY) * (1.0 - smoothstep(0.95, 1.05, uY));
    mask = max(max(posts, tableCore), max(tieBeam, roof));
  } else if (kind >= 1.5 && kind < 2.5) {
    float sway = sin(uY * 2.5 + uInkWaterClock * 0.42 + rPos.x * 0.3) * 0.16 * uY * uY * rad;
    float shifted = latSigned - sway;
    float comb = 0.5 + 0.5 * cos(shifted * 8.2 + rPos.z * 1.7);
    float stalks = smoothstep(0.46, 0.90, comb) * (1.0 - smoothstep(rad * 0.58, rad * 1.02, abs(shifted))) * (1.0 - smoothstep(0.88, 1.02, uY)) * 0.80;
    float leafR = rad * (0.98 - 0.34 * abs(uY - 0.74) / 0.30);
    float leaves = (1.0 - smoothstep(leafR * 0.52, leafR * 1.12, abs(shifted))) * smoothstep(0.44, 0.60, uY) * (1.0 - smoothstep(0.94, 1.05, uY)) * (0.70 + 0.30 * sin(shifted * 5.4 + localY * 4.2));
    mask = max(stalks, leaves);
  } else if (kind >= 2.5) {
    float wall = (1.0 - smoothstep(rad * 0.76, rad * 0.95, lat)) * (1.0 - smoothstep(0.56, 0.62, uY)) * 0.72;
    float rHalf = rad * mix(1.12, 0.16, clamp((uY - 0.56) / 0.44, 0.0, 1.0));
    float gable = (1.0 - smoothstep(rHalf * 0.78, rHalf * 1.05, lat)) * smoothstep(0.54, 0.61, uY) * (1.0 - smoothstep(0.95, 1.04, uY)) * 0.88;
    mask = max(wall, gable);
  } else {
    float trunk = (1.0 - smoothstep(rad * 0.10, rad * 0.24, lat)) * (1.0 - smoothstep(0.50, 0.60, uY)) * 0.72;
    vec2 crownD = vec2(lat / (rad * 1.06), (uY - 0.68) / 0.35);
    float droop = 0.78 + 0.22 * sin(latSigned * 6.2 - uInkWaterClock * 0.48);
    float crown = (1.0 - smoothstep(0.60, 1.08, length(crownD))) * smoothstep(0.32, 0.46, uY) * droop * 0.88;
    mask = max(trunk, crown);
  }
  float distFade = 1.0 - smoothstep(26.0, 46.0, t);
  return mask * rShape.z * distFade;
}
`;
const INK_NOON = /* glsl */`
uniform float uInkDayWeight;
uniform vec4 uInkNoon;
uniform vec4 uInkMoonSheen;
// Day-weighted noon brushwork: deeper mid-channel read and a foam line that
// hugs the true bank. day=0 reproduces the legacy formulas exactly.
float inkNoonDepth(float depth, float bank, float day, float clarity) {
  float d = clamp(depth / max(0.2, 1.0 - day * clarity), 0.0, 1.0);
  return d * (1.0 - smoothstep(0.38, 1.0, bank));
}
float inkNoonFoam(float bank, float wave, float day, float foamEdge) {
  float edge = mix(0.76, foamEdge, day);
  return smoothstep(edge, 0.99, bank) * smoothstep(0.16, 0.88, wave) * 0.16;
}
`;
const INK_COLOR = /* glsl */`
float inkBank = mix(clamp(vInkWaterShore.y, 0.0, 1.0), abs(vInkWaterShore.y * 2.0 - 1.0), uInkWaterKind);
float inkDepth = inkNoonDepth(clamp(vInkWaterShore.x / uInkWaterDepthScale, 0.0, 1.0), inkBank, uInkDayWeight, uInkNoon.x);
vec3 inkTint = mix(uInkWaterShallow, uInkWaterDeep, inkDepth);
diffuseColor.rgb = mix(diffuseColor.rgb, inkTint, uInkWaterMix);
float inkWavelet = inkWaterFlow(vTwilightWaterPosition);
float inkShoalFoam = inkNoonFoam(inkBank, inkWavelet, uInkDayWeight, uInkNoon.y);
diffuseColor.rgb *= 1.0 + uInkWaterContrast * inkWavelet;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.91), inkShoalFoam * uInkWaterMix);
vec3 inkToEye = cameraPosition - vTwilightWaterPosition;
float inkHoriz2 = inkToEye.x * inkToEye.x + inkToEye.z * inkToEye.z;
if (inkHoriz2 > 0.0001 && inkToEye.y > 0.02) {
  float inkInvHoriz = inversesqrt(inkHoriz2);
  float inkHoriz = inkHoriz2 * inkInvHoriz;
  vec2 inkViewXZ = -inkToEye.xz * inkInvHoriz;
  vec3 inkV = inkToEye * inversesqrt(inkHoriz2 + inkToEye.y * inkToEye.y);
  float rw1 = sin(vTwilightWaterPosition.x * 2.15 + vTwilightWaterPosition.z * 1.65 - uInkWaterClock * 1.18);
  float rw2 = cos(vTwilightWaterPosition.x * 1.45 - vTwilightWaterPosition.z * 2.35 + uInkWaterClock * 0.86);
  float calmMirror = 1.0 - 0.58 * uInkWaterKind;
  float fresnel = (0.30 + 0.70 * pow(1.0 - clamp(inkV.y, 0.0, 1.0), 2.3)) * calmMirror;
  float reflElev = clamp(inkV.y + rw1 * uInkReflParams.w * 0.5, 0.02, 0.95);
  vec3 skyMirror = mix(uInkSkyHorizon, uInkSkyTop, smoothstep(0.03, 0.48, reflElev));
  vec2 cloudUV = vTwilightWaterPosition.xz * 0.042 + inkViewXZ * (0.45 / (reflElev + 0.22)) + vec2(uInkWaterClock * 0.018, -uInkWaterClock * 0.011);
  float cloudWave = 0.5 + 0.32 * sin(cloudUV.x * 2.3 + sin(cloudUV.y * 1.7)) + 0.18 * cos(cloudUV.y * 3.1 - cloudUV.x * 1.4);
  float cloudVeil = smoothstep(0.50, 0.84, cloudWave) * (1.0 - smoothstep(0.52, 0.92, reflElev));
  diffuseColor.rgb = mix(diffuseColor.rgb, skyMirror, clamp(uInkReflParams.x * fresnel, 0.0, 0.45));
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(uInkSkyHorizon, vec3(0.96, 0.96, 0.93), 0.42), clamp(cloudVeil * uInkReflParams.y * calmMirror, 0.0, 0.28));
  if (uInkMoonSheen.w > 0.005) {
    // 晴夜月色碎银：基于二维值噪声 FBM 的横向拉丝水纹银光（绝无周期棋盘格），白昼/晨暮严格归零
    vec3 mDir = normalize(uInkMoonSheen.xyz);
    vec2 viewXZ = inkViewXZ;
    vec2 acrossXZ = vec2(-viewXZ.y, viewXZ.x);
    vec2 moonXZ = normalize(mDir.xz + vec2(0.0001));
    float mCorridor = smoothstep(0.24, 0.94, dot(viewXZ, moonXZ));
    vec2 mp = vTwilightWaterPosition.xz;
    vec2 rUV = vec2(dot(mp, acrossXZ) * 0.34, dot(mp, viewXZ) * 1.42);
    float f1 = inkWaterFbm2(rUV + vec2(uInkWaterClock * 0.16, -uInkWaterClock * 0.38));
    float f2 = inkWaterFbm2(rUV * vec2(1.75, 2.25) + vec2(-uInkWaterClock * 0.24, uInkWaterClock * 0.52) + vec2(f1 * 1.35, -f1 * 0.85));
    float silverThread = smoothstep(0.54, 0.88, f1 * 0.46 + f2 * 0.54);
    float fineGlint = smoothstep(0.68, 0.94, f2) * mCorridor;
    float calmSilver = (0.14 + 0.86 * mCorridor) * (0.35 + 0.65 * fresnel);
    float mPath = (fineGlint * 0.52 + silverThread * calmSilver * 0.34 + mCorridor * fresnel * 0.09) * uInkMoonSheen.w;
    diffuseColor.rgb += vec3(0.58, 0.73, 0.87) * clamp(mPath, 0.0, 0.34);
  }
  if (uInkReflectCount > 0 && uInkWaterKind < 0.5) {
    vec2 rawRay = inkViewXZ;
    vec2 perpRay = vec2(-rawRay.y, rawRay.x);
    vec2 hDir = normalize(rawRay + perpRay * (rw1 * 0.65 + rw2 * 0.35) * uInkReflParams.w);
    float viewSlope = inkToEye.y / max(inkHoriz, 0.5);
    float effSlope = max(0.05, viewSlope * uInkReflStretch.x + uInkReflStretch.y + (rw2 * 0.5 + inkWavelet * 0.25) * uInkReflParams.w * 0.55);
    float sil = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uInkReflectCount) break;
      sil = max(sil, inkCasterMask(vTwilightWaterPosition, hDir, effSlope, uInkReflectPos[i], uInkReflectShape[i]));
    }
    float reedAng = atan(vTwilightWaterPosition.z + 152.0, vTwilightWaterPosition.x - 68.0);
    float reedComb = smoothstep(0.54, 0.92, 0.5 + 0.5 * sin(reedAng * 26.0 + rw1 * 1.8));
    float reedRim = smoothstep(0.72, 0.98, inkBank) * reedComb * 0.54;
    float waveStroke = 0.74 + 0.26 * sin(vTwilightWaterPosition.z * 5.8 + vTwilightWaterPosition.x * 2.1 - uInkWaterClock * 1.6);
    float inkWash = clamp(max(sil, reedRim) * waveStroke * uInkReflParams.z, 0.0, 0.54);
    diffuseColor.rgb = mix(diffuseColor.rgb, uInkSilColor, inkWash);
  }
}
`;
const INK_NORMAL = /* glsl */`
vec2 inkWPos = vTwilightWaterPosition.xz;
float inkNx = inkWaterFbm2(inkWPos * vec2(0.48, 0.96) + vec2(uInkWaterClock * 0.22, -uInkWaterClock * 0.36)) * 2.0 - 1.0;
float inkNz = inkWaterFbm2(inkWPos * vec2(0.76, 0.52) + vec2(-uInkWaterClock * 0.28, uInkWaterClock * 0.31) + vec2(7.3, 4.1)) * 2.0 - 1.0;
vec3 inkRipple = vec3(inkNx * 0.78, 0.0, inkNz * 0.78);
normal = normalize(normal + mat3(viewMatrix) * (inkRipple * uInkWaterRipple));
`;

function surfaceInputs(mesh, options) {
  const geometry = mesh.geometry;
  const positions = geometry.attributes.position;
  const isStream = options.kind === 'stream' || mesh.name === 'stream';
  const depths = new Float32Array(positions.count);
  const banks = new Float32Array(positions.count);
  const point = new THREE.Vector3();
  const other = new THREE.Vector3();
  const previous = { depth: geometry.getAttribute('inkWaterDepth'), bank: geometry.getAttribute('inkWaterBank') };
  mesh.updateWorldMatrix(true, false);
  let radius = 0.001;
  if (!isStream) for (let i = 0; i < positions.count; i++) radius = Math.max(radius, Math.hypot(positions.getX(i), positions.getZ(i)));
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    if (isStream) {
      const pair = Math.floor(i / 2) * 2;
      point.fromBufferAttribute(positions, pair);
      other.fromBufferAttribute(positions, Math.min(pair + 1, positions.count - 1));
      point.add(other).multiplyScalar(0.5);
      banks[i] = i % 2;
    } else banks[i] = Math.min(1, Math.hypot(point.x, point.z) / radius);
    point.applyMatrix4(mesh.matrixWorld);
    const ground = options.field?.sample?.(point.x, point.z);
    depths[i] = Number.isFinite(ground) ? Math.max(0, point.y - ground) : 1.2;
  }
  const depth = new THREE.BufferAttribute(depths, 1), bank = new THREE.BufferAttribute(banks, 1);
  geometry.setAttribute('inkWaterDepth', depth);
  geometry.setAttribute('inkWaterBank', bank);
  return { isStream, restore() {
    for (const [name, owned, before] of [['inkWaterDepth', depth, previous.depth], ['inkWaterBank', bank, previous.bank]]) {
      if (geometry.getAttribute(name) !== owned) continue;
      if (before) geometry.setAttribute(name, before); else geometry.deleteAttribute(name);
    }
  } };
}

// Use instead of, not in addition to, createTwilightWater on a given material.
export function createWaterSurface(mesh, sky, options = {}) {
  return createTwilightWater(mesh, sky, { ...options, inkSurface: true });
}

export function createTwilightWater(mesh, sky, options = {}) {
  let disposed = false;
  let enabled = false;
  let compileCount = 0;
  const uniforms = {
    uTwilightWaterAmount: { value: 0 },
    uTwilightWaterClock: { value: 0 },
    uTwilightWaterDirection: { value: new THREE.Vector3(0, 1, 0) },
    uTwilightWaterColor: { value: new THREE.Color().setRGB(1, 0.55, 0.22) },
  };
  const material = mesh?.material;
  const valid = mesh?.isMesh === true && !mesh.isInstancedMesh &&
    mesh.geometry?.attributes?.position && material?.isMeshLambertMaterial === true &&
    typeof material.onBeforeCompile === 'function' &&
    typeof material.customProgramCacheKey === 'function' && !installed.has(material);
  let previousHook, previousKey, hook, key, record, inkInputs;
  let reflectorCount = 0;
  const inkConfig = options.config?.surface || inkWater.surface;
  const reflConfig = { ...(inkWater.reflection || {}), ...(options.config?.reflection || {}) };
  const baseSilColor = new THREE.Color(reflConfig.inkColor || '#233733');
  if (valid && options.inkSurface === true) {
    inkInputs = surfaceInputs(mesh, options);
    const reflectPos = Array.from({ length: MAX_REFLECTORS }, () => new THREE.Vector4());
    const reflectShape = Array.from({ length: MAX_REFLECTORS }, () => new THREE.Vector4());
    const rawReflectors = Array.isArray(options.reflectors) ? options.reflectors : [];
    for (let i = 0; i < rawReflectors.length && reflectorCount < MAX_REFLECTORS; i++) {
      const r = rawReflectors[i];
      if (!r || ![r.x, r.y, r.z].every(Number.isFinite)) continue;
      reflectPos[reflectorCount].set(r.x, r.y, r.z, Math.max(0.35, Number(r.radius) || 1.6));
      reflectShape[reflectorCount].set(
        Math.max(0.6, Number(r.height) || 3.6),
        Number.isFinite(r.kind) ? r.kind : 0,
        unit(Number.isFinite(r.shade) ? r.shade : 0.88),
        0
      );
      reflectorCount++;
    }
    Object.assign(uniforms, {
      uInkWaterClock: { value: 0 }, uInkWaterKind: { value: inkInputs.isStream ? 1 : 0 },
      uInkWaterDepthScale: { value: Math.max(0.1, inkConfig.depthScale) },
      uInkWaterMix: { value: unit(inkConfig.mix) }, uInkWaterRipple: { value: inkConfig.rippleAmplitude },
      uInkWaterContrast: { value: inkConfig.contrast },
      uInkDayWeight: { value: 0 },
      uInkNoon: { value: new THREE.Vector4(
        unit(inkWater.noon?.clarity ?? 0.55),
        unit(inkWater.noon?.foamEdge ?? 0.86),
        unit(inkWater.noon?.silhouetteBoost ?? 0.14),
        unit(inkWater.noon?.stretchScale ?? 0.82)
      ) },
      uInkMoonSheen: { value: new THREE.Vector4(0.32, 0.62, 0.71, 0) },
      uInkWaterShallow: { value: new THREE.Color(inkConfig.shallow) }, uInkWaterDeep: { value: new THREE.Color(inkConfig.deep) },
      uInkSkyTop: { value: new THREE.Color('#B8D0DD') },
      uInkSkyHorizon: { value: new THREE.Color('#E8ECE0') },
      uInkSilColor: { value: baseSilColor.clone() },
      uInkReflParams: { value: new THREE.Vector4(
        unit(reflConfig.skyStrength ?? 0.24),
        unit(reflConfig.cloudStrength ?? 0.17),
        unit(reflConfig.silhouetteStrength ?? 0.34),
        Math.max(0, reflConfig.rippleDistort ?? 0.055)
      ) },
      uInkReflStretch: { value: new THREE.Vector2(
        Math.max(0.5, reflConfig.verticalStretch ?? 1.65),
        Math.max(0, reflConfig.slopeBias ?? 0.085)
      ) },
      uInkReflectCount: { value: reflectorCount },
      uInkReflectPos: { value: reflectPos },
      uInkReflectShape: { value: reflectShape }
    });
  }
  if (valid) {
    previousHook = material.onBeforeCompile;
    previousKey = material.customProgramCacheKey;
    // Three's default key reads this.onBeforeCompile. Capture BEFORE wrapping,
    // not from inside our key, to avoid recursion and accidental cache drift.
    const baseKey = previousKey.call(material);
    hook = function (shader, renderer) {
      previousHook.call(this, shader, renderer);
      // A later owner may have captured this closure before we were disposed.
      if (disposed) return;
      if (!shader.vertexShader.includes(PROJECT) || !shader.fragmentShader.includes(OUTPUT)) return;
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = VARYING + shader.vertexShader.replace(PROJECT,
        PROJECT + '\nvTwilightWaterPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = FRAGMENT + shader.fragmentShader.replace(OUTPUT, ADD_LIGHT + '\n' + OUTPUT);
      if (inkInputs) {
        shader.vertexShader = INK_VERTEX + shader.vertexShader.replace(PROJECT, PROJECT + '\nvInkWaterShore = vec2(inkWaterDepth, inkWaterBank);');
        shader.fragmentShader = INK_FRAGMENT + INK_NOON + shader.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + INK_COLOR)
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + INK_NORMAL);
      }
      compileCount++;
    };
    key = function () { return baseKey + '|twilight-water-v1' + (inkInputs ? '|ink-surface-v2' : ''); };
    record = { hook, key };
    installed.set(material, record);
    material.onBeforeCompile = hook;
    material.customProgramCacheKey = key;
    material.needsUpdate = true;
    enabled = true;
  }

  function syncInkReflection() {
    if (!inkInputs) return;
    const rain = unit(Number(sky?.rainIntensity) || 0);
    let night = sky?.timeId === 'night' ? 1 : 0;
    // The live view borrows sky-owned LINEAR Colors. Copy into our existing
    // uniforms, avoiding debug object/hex allocations and a color-space roundtrip.
    // Retain string snapshots for old/custom sky adapters.
    const live = typeof sky?.getAppearanceState === 'function' ? sky.getAppearanceState() : null;
    const app = live || (typeof sky?.getAppearance === 'function' ? sky.getAppearance() : null);
    if (app) {
      if (app.skyTop?.isColor) uniforms.uInkSkyTop.value.copy(app.skyTop);
      else if (typeof app.skyTop === 'string' && app.skyTop.length === 6) uniforms.uInkSkyTop.value.set('#' + app.skyTop);
      if (app.skyBottom?.isColor) uniforms.uInkSkyHorizon.value.copy(app.skyBottom);
      else if (typeof app.skyBottom === 'string' && app.skyBottom.length === 6) uniforms.uInkSkyHorizon.value.set('#' + app.skyBottom);
      if (Number.isFinite(app.night)) night = unit(app.night);
    } else if (sky?.timeId === 'dusk') {
      uniforms.uInkSkyTop.value.set('#8D8AA6');
      uniforms.uInkSkyHorizon.value.set('#E2AC88');
    } else if (sky?.timeId === 'dawn') {
      uniforms.uInkSkyTop.value.set('#9DB7C6');
      uniforms.uInkSkyHorizon.value.set('#E8CFC2');
    } else if (night > 0.5) {
      uniforms.uInkSkyTop.value.set('#233244');
      uniforms.uInkSkyHorizon.value.set('#3A4D61');
    }
    const rainSoften = 1 - rain * 0.34;
    const nightScale = 1 - night * 0.38;
    // Noon brushwork: day-weighted layer deepens the channel, tightens the foam
    // line and lets shore silhouettes stand up in clear daylight. Dawn keeps a
    // partial wash; dusk/night keep their legacy pigment exactly.
    const noon = inkWater.noon ?? {};
    const dayBase = sky?.timeId === 'day' ? 1 : sky?.timeId === 'dawn' ? 0.35 : 0;
    const day = unit(dayBase * (1 - rain * 0.7));
    uniforms.uInkDayWeight.value = day;
    uniforms.uInkReflParams.value.set(
      unit((reflConfig.skyStrength ?? 0.24) * (1 - rain * 0.22)),
      unit((reflConfig.cloudStrength ?? 0.17) * (1 - rain * 0.45) * nightScale),
      unit(((reflConfig.silhouetteStrength ?? 0.34) + (noon.silhouetteBoost ?? 0.14) * day) * rainSoften * (1 - night * 0.22)),
      Math.max(0.015, (reflConfig.rippleDistort ?? 0.055) * (1 + rain * 0.85))
    );
    uniforms.uInkReflStretch.value.x = Math.max(0.5, (reflConfig.verticalStretch ?? 1.65) * (1 - day * (1 - (noon.stretchScale ?? 0.82))));
    uniforms.uInkSilColor.value.copy(baseSilColor).lerp(uniforms.uInkSkyHorizon.value, 0.14 * (1 - night));
    const lunar = typeof sky?.getLunarState === 'function' ? sky.getLunarState() : null;
    const moonDir = lunar?.direction;
    const fullness = Number.isFinite(lunar?.fullness) ? unit(lunar.fullness) : 1;
    const snow = unit(Number(sky?.snowIntensity) || 0);
    const moonAmt = night > 0.45 ? unit((night - 0.45) / 0.55 * (0.35 + 0.65 * fullness) * (1 - rain * 0.78) * (1 - snow * 0.65)) : 0;
    if (moonDir && Number.isFinite(moonDir.x) && Number.isFinite(moonDir.y) && Number.isFinite(moonDir.z)) {
      uniforms.uInkMoonSheen.value.set(moonDir.x, Math.max(0.18, moonDir.y), moonDir.z, moonAmt);
    } else {
      uniforms.uInkMoonSheen.value.w = moonAmt;
    }
  }

  function update(dt) {
    if (!enabled || disposed) return;
    if (Number.isFinite(dt) && dt > 0) {
      // Independent of the sky clock: dt=0 (paused/inspection) freezes ripples.
      uniforms.uTwilightWaterClock.value = (uniforms.uTwilightWaterClock.value + Math.min(dt, 0.1)) % 4096;
      if (inkInputs) uniforms.uInkWaterClock.value = (uniforms.uInkWaterClock.value + Math.min(dt, 0.1) * inkConfig.flowSpeed) % 4096;
    }
    syncInkReflection();
    uniforms.uTwilightWaterAmount.value = 0;
    if (sky?.enabled === false || sky?.disabled === true || typeof sky?.getTwilightState !== 'function') return;
    let state;
    try { state = sky.getTwilightState(); } catch { return; }
    if (!state || !Number.isFinite(state.amount) || state.amount <= 0) return;
    const direction = state.direction;
    const color = state.color;
    if (!direction || !color || !Number.isFinite(direction.x) || !Number.isFinite(direction.y) ||
        !Number.isFinite(direction.z) || !Number.isFinite(color.r) || !Number.isFinite(color.g) || !Number.isFinite(color.b)) return;
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (!Number.isFinite(length) || length < 0.000001) return;
    uniforms.uTwilightWaterDirection.value.set(direction.x / length, direction.y / length, direction.z / length);
    // The sky already supplies LINEAR color and weather-attenuated amount. Do
    // not apply another weather curve or color-space conversion here.
    uniforms.uTwilightWaterColor.value.setRGB(unit(color.r), unit(color.g), unit(color.b));
    uniforms.uTwilightWaterAmount.value = unit(state.amount);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    uniforms.uTwilightWaterAmount.value = 0;
    inkInputs?.restore();
    if (!enabled || installed.get(material) !== record) return;
    installed.delete(material);
    let restored = false;
    // Restore only properties still owned by this adapter, independently.
    if (material.onBeforeCompile === hook) { material.onBeforeCompile = previousHook; restored = true; }
    if (material.customProgramCacheKey === key) { material.customProgramCacheKey = previousKey; restored = true; }
    if (restored) material.needsUpdate = true;
  }

  function getStats() {
    return { enabled: enabled && !disposed, disposed, amount: uniforms.uTwilightWaterAmount.value,
      clock: uniforms.uTwilightWaterClock.value, inkEnabled: Boolean(inkInputs) && !disposed,
      inkClock: uniforms.uInkWaterClock?.value ?? 0,
      inkMoonSheen: uniforms.uInkMoonSheen?.value?.w ?? 0,
      reflectors: reflectorCount,
      maxGain: MAX_GAIN, compileCount,
      addedDraws: 0, addedTextures: 0, addedRenderTargets: 0 };
  }
  update(0);
  return { update, dispose, getStats };
}
