import * as THREE from 'three';
import outskirtsData from '../data/wuling-outskirts.json' with { type: 'json' };
import { createExteriorContext, exteriorSiteSafe } from './exterior-exploration.js';
import { createGroveBaker } from './leisure-grove-geometry.js';
import { roughRockGeometry } from './rock.js';
import { createCommunityActors } from '../systems/community-actors.js';
import { segmentDistance } from './hinterland.js';
import { chainProgramCacheKey } from '../systems/shader-cache-key.js';

const TAU = Math.PI * 2;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapAngle(a) {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x < -Math.PI) x += TAU;
  return x;
}

function boxDistXZ(x, z, b) {
  const c = Math.cos(b.rot || 0);
  const s = Math.sin(b.rot || 0);
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = Math.max(0, Math.abs(dx * c - dz * s) - (b.hw || 0.5));
  const lz = Math.max(0, Math.abs(dx * s + dz * c) - (b.hd || 0.5));
  return Math.hypot(lx, lz);
}

function buildEgretGeometries() {
  // 低模水墨白鹭：修长双胫与流线白羽躯干（body）+ 曲颈黄喙冠羽（head），合为 2 次 InstancedMesh 绘制
  const bodyBaker = createGroveBaker();
  // 细长涉水青黑双胫
  bodyBaker.beam([-0.045, 0.0, 0.0], [-0.042, 0.34, 0.01], 0.012, '#353B38', 0.014, 5, 'body');
  bodyBaker.beam([0.045, 0.0, 0.0], [0.042, 0.34, -0.01], 0.012, '#353B38', 0.014, 5, 'body');
  // 素白纺锤流线身躯与收拢翼尖
  bodyBaker.orb([0, 0.38, -0.02], [0.105, 0.095, 0.21], '#F5F6F1', 'body', 0.6);
  bodyBaker.orb([0, 0.39, -0.15], [0.075, 0.062, 0.13], '#EAECE6', 'body', 1.7);
  bodyBaker.leaf([0, 0.38, -0.18], [0, 0.33, -0.34], 0.055, '#E4E7E0', 'body');
  const dummyMat = new THREE.MeshBasicMaterial();
  const bodyMeshTmp = bodyBaker.finish('body', dummyMat);
  const bodyGeo = bodyMeshTmp.geometry;
  bodyBaker.dispose();

  const headBaker = createGroveBaker();
  // 曲折修颈（以胸前 [0,0,0] 为俯仰轴心）
  headBaker.beam([0, 0, 0], [0, 0.16, 0.055], 0.024, '#F4F5F0', 0.019, 6, 'head');
  headBaker.beam([0, 0.15, 0.052], [0, 0.27, 0.022], 0.019, '#F7F8F3', 0.016, 6, 'head');
  // 白鹭头颅、飘逸枕冠与明黄长尖喙
  headBaker.orb([0, 0.285, 0.035], [0.034, 0.032, 0.046], '#F8F9F4', 'head', 2.1);
  headBaker.beam([0, 0.295, 0.01], [0, 0.325, -0.085], 0.008, '#EEF0EA', 0.003, 4, 'head');
  headBaker.beam([0, 0.280, 0.072], [0, 0.262, 0.205], 0.013, '#D8A63A', 0.003, 5, 'head');
  const headMeshTmp = headBaker.finish('head', dummyMat);
  const headGeo = headMeshTmp.geometry;
  headBaker.dispose();
  dummyMat.dispose();

  return { bodyGeo, headGeo };
}

function buildBambooRaftMesh(waterY) {
  const b = createGroveBaker();
  const poles = 7;
  const spacing = 0.155;
  const halfW = ((poles - 1) * spacing) * 0.5;
  for (let i = 0; i < poles; i++) {
    const px = -halfW + i * spacing;
    const tone = i % 2 === 0 ? '#8C9658' : '#7E8A4F';
    // 主筏身长竹竿 + 微翘筏首
    b.beam([px, 0.055, -1.35], [px, 0.055, 1.05], 0.068, tone, 0.065, 7, 'raft');
    b.beam([px, 0.055, 1.02], [px, 0.19, 1.58], 0.064, tone, 0.054, 7, 'raft');
    for (const zNode of [-0.95, -0.35, 0.25, 0.85]) {
      b.ring([px, 0.055, zNode], 0.073, 0.058, 0.022, '#5F683B', 6, 'raft');
    }
  }
  // 横向藤绑竹档
  for (const zBar of [-0.98, -0.12, 0.78]) {
    b.beam([-halfW - 0.06, 0.128, zBar], [halfW + 0.06, 0.128, zBar], 0.042, '#6E5A3E', 0.042, 6, 'raft');
  }
  // 筏上竹编鱼篓、斗笠与斜倚长竹篙 + 船头弯竹渔火灯架（灯架与未亮灯体入 raft 静态网格）
  b.beam([-0.16, 0.14, -0.36], [-0.16, 0.48, -0.36], 0.18, '#B3935E', 0.13, 8, 'raft');
  b.ring([-0.16, 0.47, -0.36], 0.145, 0.105, 0.04, '#7E643E', 8, 'raft');
  b.beam([0.20, 0.14, 0.18], [0.20, 0.25, 0.18], 0.24, '#C5AD78', 0.03, 8, 'raft');
  b.beam([-0.32, 0.15, -1.48], [0.36, 0.24, 1.72], 0.024, '#989E5E', 0.018, 6, 'raft');
  // 船头弯竹渔火小杆（挂渔灯于 [0.34, 0.72, 1.24]）
  b.beam([0.34, 0.14, 1.02], [0.34, 0.94, 1.12], 0.020, '#6F7A48', 0.015, 5, 'raft');
  b.beam([0.34, 0.93, 1.12], [0.34, 0.96, 1.26], 0.014, '#7D8750', 0.011, 5, 'raft');
  b.beam([0.34, 0.95, 1.24], [0.34, 0.83, 1.24], 0.008, '#5E4B39', 0.008, 4, 'raft');
  b.beam([0.34, 0.82, 1.24], [0.34, 0.85, 1.24], 0.095, '#594433', 0.055, 6, 'raft');
  b.beam([0.34, 0.63, 1.24], [0.34, 0.82, 1.24], 0.082, '#DFD5B9', 0.088, 6, 'raft');
  b.beam([0.34, 0.60, 1.24], [0.34, 0.63, 1.24], 0.086, '#594433', 0.072, 6, 'raft');

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = b.finish('raft', mat);
  mesh.name = 'wuling-bamboo-raft';
  mesh.matrixAutoUpdate = true;
  mesh.position.y = waterY + 0.02;
  b.dispose();
  return { mesh, mat, lanternLocal: [0.34, 0.725, 1.24] };
}

function createLanternGlowTexture() {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext?.('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient?.(32, 32, 2, 32, 32, 31);
  if (g && typeof g.addColorStop === 'function') {
    g.addColorStop(0.0, 'rgba(255, 232, 168, 0.94)');
    g.addColorStop(0.28, 'rgba(252, 186, 94, 0.56)');
    g.addColorStop(0.62, 'rgba(232, 138, 56, 0.18)');
    g.addColorStop(1.0, 'rgba(220, 120, 42, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect?.(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const STEAM_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;

void main() {
  vAlpha = aAlpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPos;
  gl_PointSize = clamp(aSize * 380.0 / max(1.0, -mvPos.z), 2.0, 76.0);
}
`;

const STEAM_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 >= 1.0) discard;
  float soft = pow(1.0 - r2, 1.65);
  float alpha = vAlpha * soft;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
}
`;

function createSteamCloud(name, capacity) {
  const posArr = new Float32Array(capacity * 3);
  const sizeArr = new Float32Array(capacity);
  const alphaArr = new Float32Array(capacity);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posArr, 3);
  const sizeAttr = new THREE.BufferAttribute(sizeArr, 1);
  const alphaAttr = new THREE.BufferAttribute(alphaArr, 1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr.setUsage(THREE.DynamicDrawUsage);
  alphaAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aSize', sizeAttr);
  geo.setAttribute('aAlpha', alphaAttr);
  geo.setDrawRange(0, 0);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#F3F4F0') }
    },
    vertexShader: STEAM_VERT,
    fragmentShader: STEAM_FRAG,
    transparent: true,
    depthWrite: false
  });
  mat.userData.skyIgnore = true;

  const points = new THREE.Points(geo, mat);
  points.name = name;
  points.visible = false;
  points.frustumCulled = false;
  points.renderOrder = 6;

  let count = 0;
  return {
    points,
    mat,
    get count() { return count; },
    reset() { count = 0; },
    push(x, y, z, size, alpha) {
      if (count >= capacity) return;
      const i3 = count * 3;
      posArr[i3] = x;
      posArr[i3 + 1] = y;
      posArr[i3 + 2] = z;
      sizeArr[count] = size;
      alphaArr[count] = alpha;
      count += 1;
    },
    commit() {
      geo.setDrawRange(0, count);
      points.visible = count > 0;
      if (count > 0) {
        posAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      points.removeFromParent();
    }
  };
}

const SNOW_FOOTPRINT_VERT = /* glsl */`
attribute float aFade;
varying vec2 vUv;
varying float vFade;

void main() {
  vUv = uv;
  vFade = aFade;
  vec4 pos = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    pos = instanceMatrix * pos;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * pos;
}
`;

const SNOW_FOOTPRINT_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uRimColor;
varying vec2 vUv;
varying float vFade;

void main() {
  if (vFade <= 0.004) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float waist = 1.0 - 0.14 * exp(-pow((p.y + 0.08) * 3.0, 2.0));
  float r = length(vec2(p.x / waist, p.y));
  if (r >= 1.0) discard;
  float core = 1.0 - smoothstep(0.18, 0.84, r);
  float rim = smoothstep(0.58, 0.84, r) * (1.0 - smoothstep(0.84, 1.0, r));
  float alpha = (core * 0.46 + rim * 0.16) * vFade;
  if (alpha < 0.004) discard;
  vec3 col = mix(uColor, uRimColor, rim * 0.62);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

function createSnowFootprintTrail(capacity = 28) {
  const geo = new THREE.PlaneGeometry(0.17, 0.34, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const fadeArr = new Float32Array(capacity);
  const fadeAttr = new THREE.InstancedBufferAttribute(fadeArr, 1);
  fadeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFade', fadeAttr);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#778B9F') },
      uRimColor: { value: new THREE.Color('#E2EAEF') }
    },
    vertexShader: SNOW_FOOTPRINT_VERT,
    fragmentShader: SNOW_FOOTPRINT_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  mat.userData.skyIgnore = true;

  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.name = 'wuling-snow-footprints';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;

  const slots = Array.from({ length: capacity }, () => ({ fade: 0, zone: 'exterior' }));
  const _mat = new THREE.Matrix4();
  const _rot = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
  const _dayCore = new THREE.Color('#778B9F');
  const _nightCore = new THREE.Color('#1D2835');
  const _dayRim = new THREE.Color('#E4ECEF');
  const _nightRim = new THREE.Color('#344557');
  for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, _zeroMat);
  mesh.instanceMatrix.needsUpdate = true;

  let cursor = 0;
  let activeCount = 0;
  let side = 1;
  let lastValid = false;
  let lastX = 0;
  let lastZ = 0;

  return {
    mesh,
    get activeCount() { return activeCount; },
    resetAnchor() { lastValid = false; },
    clear() {
      let hadAny = activeCount > 0;
      for (let i = 0; i < capacity; i++) {
        if (slots[i].fade > 0) hadAny = true;
        slots[i].fade = 0;
        fadeArr[i] = 0;
      }
      activeCount = 0;
      lastValid = false;
      mesh.visible = false;
      if (hadAny) fadeAttr.needsUpdate = true;
    },
    stamp(x, y, z, yaw, nx, ny, nz, zone) {
      const idx = cursor;
      cursor = (cursor + 1) % capacity;
      _up.set(nx, ny, nz).normalize();
      _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
      // 将步向投影到坡面切平面，保证雪印紧贴斜坡不悬空
      const dot = _fwd.dot(_up);
      _fwd.addScaledVector(_up, -dot);
      if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, 1);
      else _fwd.normalize();
      _right.crossVectors(_up, _fwd).normalize();
      _rot.makeBasis(_right, _up, _fwd);
      _pos.set(x + _up.x * 0.026, y + _up.y * 0.026, z + _up.z * 0.026);
      _mat.copy(_rot).setPosition(_pos);
      mesh.setMatrixAt(idx, _mat);
      mesh.instanceMatrix.needsUpdate = true;
      slots[idx].fade = 1.0;
      slots[idx].zone = zone;
      fadeArr[idx] = 1.0;
      fadeAttr.needsUpdate = true;
    },
    update(step, snowAmt, isWinter, playerState, sampleY, waterY, slitX, slitZ, extVis, intVis, timeId) {
      if (!isWinter) {
        if (activeCount > 0 || mesh.visible || lastValid) this.clear();
        return;
      }
      if (playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z)) {
        const px = playerState.x;
        const pz = playerState.z;
        const gy = sampleY(px, pz);
        const grounded = !playerState.aboardSkiff && !playerState.onWood
          && gy >= waterY + 0.08
          && (!Number.isFinite(playerState.y) || playerState.y - gy < 0.38)
          && Math.hypot(px - slitX, pz - slitZ) > 7.5;
        if (!grounded) {
          lastValid = false;
        } else if (!lastValid) {
          lastX = px;
          lastZ = pz;
          lastValid = true;
        } else {
          const dx = px - lastX;
          const dz = pz - lastZ;
          const dist = Math.hypot(dx, dz);
          if (dist > 6.5) {
            // 传送或跨步过大时重置起点，不留跳跃印记
            lastX = px;
            lastZ = pz;
          } else if (dist >= 0.64) {
            const yaw = Math.atan2(dx, dz);
            const perpX = Math.cos(yaw) * (0.135 * side);
            const perpZ = -Math.sin(yaw) * (0.135 * side);
            side = -side;
            const fx = px + perpX;
            const fz = pz + perpZ;
            const fy = sampleY(fx, fz);
            const hL = sampleY(fx - 0.18, fz);
            const hR = sampleY(fx + 0.18, fz);
            const hD = sampleY(fx, fz - 0.18);
            const hU = sampleY(fx, fz + 0.18);
            const zone = fz > 6 ? 'exterior' : 'interior';
            this.stamp(fx, fy, fz, yaw, (hL - hR) / 0.36, 1.0, (hD - hU) / 0.36, zone);
            lastX = px;
            lastZ = pz;
          }
        }
      }

      const decay = step * (0.048 + clamp(snowAmt, 0, 1) * 0.092);
      let alive = 0;
      let visibleAlive = 0;
      let dirty = false;
      for (let i = 0; i < capacity; i++) {
        const s = slots[i];
        if (s.fade <= 0) continue;
        s.fade = Math.max(0, s.fade - decay);
        const zoneVis = s.zone === 'exterior' ? extVis : intVis;
        const shown = zoneVis ? s.fade : 0;
        if (Math.abs(fadeArr[i] - shown) > 1e-4) {
          fadeArr[i] = shown;
          dirty = true;
        }
        if (s.fade > 0) {
          alive += 1;
          if (zoneVis) visibleAlive += 1;
        }
      }
      activeCount = alive;
      mesh.visible = visibleAlive > 0;
      if (dirty) fadeAttr.needsUpdate = true;

      if (mesh.visible) {
        const dayTone = timeId === 'night' ? 0.08 : (timeId === 'dusk' ? 0.42 : (timeId === 'dawn' ? 0.62 : 1.0));
        mat.uniforms.uColor.value.copy(_nightCore).lerp(_dayCore, dayTone);
        mat.uniforms.uRimColor.value.copy(_nightRim).lerp(_dayRim, dayTone);
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    }
  };
}

const CRAG_CLOUD_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CRAG_CLOUD_FRAG = /* glsl */`
uniform float uDrift;
uniform float uOpacity;
uniform vec3 uColor;
uniform vec2 uSunXZ;
uniform float uSunRim;
uniform vec3 uSunCol;
varying vec2 vUv;
varying vec3 vWorldPos;

float ccHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float ccNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(ccHash(i), ccHash(i + vec2(1.0, 0.0)), f.x),
    mix(ccHash(i + vec2(0.0, 1.0)), ccHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float ccFbm(vec2 p) {
  return 0.56 * ccNoise(p) + 0.30 * ccNoise(p * 2.03 + vec2(5.2, 1.7)) + 0.14 * ccNoise(p * 4.11 + vec2(2.3, 6.9));
}

void main() {
  if (uOpacity <= 0.005) discard;
  float ang = vUv.x * 6.2831853;
  vec2 ringP = vec2(cos(ang), sin(ang)) * 2.6 + vec2(uDrift, -uDrift * 0.42);
  float warp = ccFbm(ringP * 0.85 + vec2(0.0, vUv.y * 1.9)) - 0.5;
  float n1 = ccFbm(ringP * 1.35 + vec2(warp * 1.25, vUv.y * 2.2));
  float n2 = ccNoise(ringP * 2.75 - vec2(uDrift * 1.5, vUv.y * 3.1));
  float cloud = smoothstep(0.30, 0.74, n1 * 0.72 + n2 * 0.28);
  float vFeather = pow(max(0.0, sin(vUv.y * 3.14159265)), 1.75);
  float camDist = length(vWorldPos - cameraPosition);
  float nearFade = smoothstep(22.0, 68.0, camDist);
  float alpha = cloud * vFeather * nearFade * uOpacity;
  if (alpha < 0.004) discard;
  vec3 col = uColor;
  if (uSunRim > 0.005) {
    vec2 dirXZ = normalize((vWorldPos.xz - cameraPosition.xz) + vec2(0.0001));
    float sunAlign = pow(clamp(dot(dirXZ, normalize(uSunXZ)) * 0.5 + 0.5, 0.0, 1.0), 2.2);
    float rimBand = smoothstep(0.28, 0.85, vUv.y) * (0.45 + 0.55 * cloud);
    col = mix(col, uSunCol, sunAlign * rimBand * uSunRim * 0.62);
  }
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

function createCragCloudBelt(world) {
  const cx = world?.cliff?.center?.[0] ?? 30;
  const cz = world?.cliff?.center?.[1] ?? -140;
  const baseR = (world?.cliff?.radius ?? 132) + 11;
  const segU = 48;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segU; i++) {
    const u = i / segU;
    const th = u * Math.PI * 2;
    const r = baseR + Math.sin(th * 3.0 + 0.6) * 7.5 + Math.cos(th * 5.0 - 0.8) * 3.5;
    const x = cx + Math.cos(th) * r;
    const z = cz + Math.sin(th) * r;
    const yBot = 14.5 + Math.sin(th * 2.0 - 0.5) * 2.1 + Math.cos(th * 4.0 + 1.1) * 1.2;
    const yTop = yBot + 13.2 + Math.sin(th * 3.0 + 1.4) * 1.8;
    positions.push(x, yBot, z, x, yTop, z);
    uvs.push(u, 0, u, 1);
  }
  for (let i = 0; i < segU; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDrift: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color('#E8EFEF') },
      uSunXZ: { value: new THREE.Vector2(0.899, -0.437) },
      uSunRim: { value: 0 },
      uSunCol: { value: new THREE.Color('#FFE0B0') }
    },
    vertexShader: CRAG_CLOUD_VERT,
    fragmentShader: CRAG_CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  mat.userData.skyIgnore = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'wuling-crag-cloud-belt';
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  const _fogCol = new THREE.Color('#CFD8D6');
  const _dawnCol = new THREE.Color('#F2DFC6');
  const _duskCol = new THREE.Color('#EBCAA4');
  const _snowCol = new THREE.Color('#EDF2F4');
  const _rainCol = new THREE.Color('#CCD7D4');
  const _nightCol = new THREE.Color('#223244');
  const _sunDawnCol = new THREE.Color('#FFE2B4');
  const _sunDuskCol = new THREE.Color('#FFC68A');
  const _sunTargetXZ = new THREE.Vector2(0.899, -0.437);
  const _targetCol = new THREE.Color('#E8EFEF');

  return {
    mesh,
    get opacity() { return mat.uniforms.uOpacity.value; },
    get drift() { return mat.uniforms.uDrift.value; },
    get sunRim() { return mat.uniforms.uSunRim.value; },
    update(step, sky, isWinter) {
      const timeId = sky?.timeId || 'day';
      const rain = clamp(Number(sky?.rainIntensity) || 0, 0, 1);
      const snow = clamp(Number(sky?.snowIntensity) || 0, 0, 1);
      const windAmt = clamp(Number(sky?.wind ?? 0.55), 0.15, 2.2);
      mat.uniforms.uDrift.value += step * (0.012 + windAmt * 0.016);

      let targetOp = 0;
      if (isWinter) targetOp = Math.max(targetOp, 0.34 + snow * 0.15);
      if (snow > 0.08) targetOp = Math.max(targetOp, 0.32 + snow * 0.18);
      if (rain > 0.08) targetOp = Math.max(targetOp, 0.28 + rain * 0.18);
      if (timeId === 'dawn') targetOp = Math.max(targetOp, 0.36);
      else if (timeId === 'dusk') targetOp = Math.max(targetOp, 0.32);
      if (timeId === 'night') targetOp = Math.min(targetOp, 0.20);

      const cur = mat.uniforms.uOpacity.value;
      const next = cur + (targetOp - cur) * (1 - Math.exp(-step * 2.2));
      mat.uniforms.uOpacity.value = next < 0.004 && targetOp === 0 ? 0 : next;
      mesh.visible = mat.uniforms.uOpacity.value > 0.01;

      const tw = sky?.getTwilightState?.();
      const dawnAmt = Number.isFinite(tw?.dawn) ? tw.dawn : (timeId === 'dawn' ? 1 : 0);
      const duskAmt = Number.isFinite(tw?.dusk) ? tw.dusk : (timeId === 'dusk' ? 1 : 0);
      const precipFade = clamp(1 - rain * 0.58 - snow * 0.34, 0.28, 1.0);
      const twPhase = clamp(Math.max(dawnAmt + duskAmt, (timeId === 'dawn' || timeId === 'dusk') ? 0.68 * precipFade : 0), 0, 1);
      const targetRim = twPhase * 0.85;
      mat.uniforms.uSunRim.value += (targetRim - mat.uniforms.uSunRim.value) * Math.min(1, step * 2.4);
      if ((timeId === 'dusk' || duskAmt >= dawnAmt) && (timeId === 'dusk' || duskAmt > 0.01)) {
        _sunTargetXZ.set(-0.851, -0.525);
        mat.uniforms.uSunCol.value.lerp(_sunDuskCol, Math.min(1, step * 2.4));
      } else if (timeId === 'dawn' || dawnAmt > 0.01) {
        _sunTargetXZ.set(0.899, -0.437);
        mat.uniforms.uSunCol.value.lerp(_sunDawnCol, Math.min(1, step * 2.4));
      }
      mat.uniforms.uSunXZ.value.lerp(_sunTargetXZ, Math.min(1, step * 2.6)).normalize();

      if (mesh.visible) {
        const fogHex = sky?.getAppearance?.()?.fogColor;
        if (typeof fogHex === 'string' && /^#?[0-9a-f]{6}$/i.test(fogHex)) {
          _fogCol.set(fogHex.startsWith('#') ? fogHex : '#' + fogHex);
        }
        if (timeId === 'night') _targetCol.copy(_fogCol).lerp(_nightCol, 0.35);
        else if (timeId === 'dawn') _targetCol.copy(_fogCol).lerp(_dawnCol, 0.45);
        else if (timeId === 'dusk') _targetCol.copy(_fogCol).lerp(_duskCol, 0.45);
        else if (isWinter || snow > 0.08) _targetCol.copy(_fogCol).lerp(_snowCol, 0.54);
        else _targetCol.copy(_fogCol).lerp(_rainCol, 0.48);
        mat.uniforms.uColor.value.lerp(_targetCol, Math.min(1, step * 2.4));
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    }
  };
}

const RAFT_WAKE_VERT = /* glsl */`
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RAFT_WAKE_FRAG = /* glsl */`
uniform float uTime;
uniform float uActivity;
uniform float uKnockAge;
uniform float uKnockPulse;
uniform float uLanternGlow;
uniform vec2 uStakeLocal;
uniform vec3 uColor;
uniform vec3 uLanternColor;
varying vec2 vUv;

void main() {
  vec2 lp = vec2((vUv.x - 0.5) * 6.8, (0.5 - vUv.y) * 6.8);
  // 1) 随竹筏摇摆自船舷散开的 3 道断续水墨椭圆余波
  vec2 hullP = vec2(lp.x / 0.88, lp.y / 1.84);
  float hd = length(hullP);
  float hang = atan(hullP.y, hullP.x);
  float brushBreak = 0.58 + 0.42 * sin(hang * 4.0 + uTime * 0.7) * cos(hang * 2.0 - uTime * 0.45);
  float hullRings = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float phase = fract(uTime * 0.34 + fi * 0.3333);
    float rad = 0.90 + phase * 1.38;
    float line = exp(-pow((hd - rad) * 14.0, 2.0));
    float env = sin(phase * 3.14159265) * (1.0 - phase * 0.32);
    hullRings += line * env;
  }
  float hullFade = smoothstep(0.76, 0.98, hd) * (1.0 - smoothstep(1.95, 2.42, hd));
  float alpha = hullRings * hullFade * brushBreak * (0.20 + 0.16 * uActivity);

  // 2) 竹筏轻磕老杉木桩瞬间（raftKnock 同步）荡开的圆形水波
  if (uKnockPulse > 0.005) {
    float sd = length(lp - uStakeLocal);
    float sRad = 0.16 + uKnockAge * 1.15;
    float sRing = exp(-pow((sd - sRad) * 11.5, 2.0));
    float sRing2 = exp(-pow((sd - max(0.08, sRad - 0.32)) * 13.5, 2.0)) * 0.52;
    float sEnv = uKnockPulse * (1.0 - smoothstep(1.85, 2.65, sd));
    alpha += (sRing + sRing2) * sEnv * 0.44;
  }

  // 外缘防裁切柔和收口
  float edgeMask = 1.0 - smoothstep(2.65, 3.35, length(lp));
  alpha *= edgeMask;
  if (alpha < 0.004) discard;

  // 暮夜/冬雪竹筏船头渔火在水波上投下微温倒影
  vec3 col = uColor;
  if (uLanternGlow > 0.01) {
    float prowD = length(lp - vec2(0.0, 1.32));
    float glowW = exp(-prowD * 0.85) * uLanternGlow * 0.65;
    col = mix(col, uLanternColor, clamp(glowW, 0.0, 0.72));
  }
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.56));
  #include <colorspace_fragment>
}
`;

function createRaftWakeRipples(raftInfo, waterY) {
  const geo = new THREE.PlaneGeometry(6.8, 6.8, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const dxS = raftInfo.stakeX - raftInfo.x;
  const dzS = raftInfo.stakeZ - raftInfo.z;
  const cosY = Math.cos(raftInfo.baseYaw);
  const sinY = Math.sin(raftInfo.baseYaw);
  const stakeLx = dxS * cosY - dzS * sinY;
  const stakeLz = dxS * sinY + dzS * cosY;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.45 },
      uKnockAge: { value: 0 },
      uKnockPulse: { value: 0 },
      uLanternGlow: { value: 0 },
      uStakeLocal: { value: new THREE.Vector2(stakeLx, stakeLz) },
      uColor: { value: new THREE.Color('#DCE6E5') },
      uLanternColor: { value: new THREE.Color('#FFCA78') }
    },
    vertexShader: RAFT_WAKE_VERT,
    fragmentShader: RAFT_WAKE_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  mat.userData.skyIgnore = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'wuling-raft-wake';
  mesh.position.set(raftInfo.x, waterY + 0.022, raftInfo.z);
  mesh.rotation.set(0, raftInfo.baseYaw, 0);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const _dayCol = new THREE.Color('#DCE6E5');
  const _twiCol = new THREE.Color('#F0D8B8');
  const _nightCol = new THREE.Color('#6C849A');
  const _snowCol = new THREE.Color('#E6EEF0');
  const _targetCol = new THREE.Color('#DCE6E5');

  return {
    mesh,
    get pulse() { return mat.uniforms.uKnockPulse.value; },
    triggerKnock() {
      mat.uniforms.uKnockPulse.value = 1.0;
      mat.uniforms.uKnockAge.value = 0;
    },
    update(step, windAmt, timeId, isWinter, lanternPwr, nearRaft) {
      mesh.visible = nearRaft;
      if (mat.uniforms.uKnockPulse.value > 0) {
        mat.uniforms.uKnockAge.value += step;
        mat.uniforms.uKnockPulse.value = Math.max(0, mat.uniforms.uKnockPulse.value - step * 0.46);
      }
      if (!nearRaft) return;
      mat.uniforms.uTime.value += step * (0.85 + windAmt * 0.25);
      mat.uniforms.uActivity.value = clamp(0.32 + windAmt * 0.42, 0.25, 1.0);
      mat.uniforms.uLanternGlow.value = clamp(lanternPwr, 0, 1);
      if (timeId === 'night') _targetCol.copy(_nightCol);
      else if (timeId === 'dawn' || timeId === 'dusk') _targetCol.copy(_twiCol);
      else if (isWinter) _targetCol.copy(_snowCol);
      else _targetCol.copy(_dayCol);
      mat.uniforms.uColor.value.lerp(_targetCol, Math.min(1, step * 2.5));
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    }
  };
}

function buildIciclesCollection(name, eaveLines, seed, mat) {
  if (!Array.isArray(eaveLines) || eaveLines.length === 0) return { mesh: null, tips: [] };
  const r = mulberry32(seed);
  const positions = [];
  const anchors = [];
  const tips = [];
  const pushTri = (a, b, c, ay) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    anchors.push(ay, ay, ay);
  };
  for (let ei = 0; ei < eaveLines.length; ei++) {
    const line = eaveLines[ei];
    const { a, b, count = 4, insetX = 0, insetZ = 0, lenScale = 1, collectTips = false } = line;
    const ay = (a[1] + b[1]) * 0.5;
    for (let k = 0; k < count; k++) {
      const u = (k + 0.28 + r() * 0.44) / count;
      const wx = lerp(a[0], b[0], u) + insetX;
      const wz = lerp(a[2], b[2], u) + insetZ;
      const len = (0.16 + r() * 0.24) * lenScale;
      const rad = (0.015 + r() * 0.012) * Math.min(1.15, 0.8 + lenScale * 0.25);
      const rot = r() * TAU;
      const tip = [wx + (r() - 0.5) * 0.012, ay - len, wz + (r() - 0.5) * 0.012];
      if (collectTips) tips.push({ x: tip[0], anchorY: ay, len, z: tip[2] });
      const ring = [];
      for (let s = 0; s < 4; s++) {
        const ang = rot + (s * TAU) / 4;
        ring.push([wx + Math.cos(ang) * rad, ay + 0.018, wz + Math.sin(ang) * rad]);
      }
      for (let s = 0; s < 4; s++) {
        pushTri(ring[s], tip, ring[(s + 1) % 4], ay);
      }
    }
  }
  if (positions.length === 0) return { mesh: null, tips: [] };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aAnchorY', new THREE.Float32BufferAttribute(anchors, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.visible = false;
  mesh.renderOrder = 2;
  return { mesh, tips };
}

const THAW_DRIP_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;

void main() {
  vAlpha = aAlpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPos;
  gl_PointSize = clamp(aSize * 210.0 / max(1.0, -mvPos.z), 2.0, 18.0);
}
`;

const THAW_DRIP_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  // 细长晶莹水滴形（上尖下圆，带一点晴日高光）
  float xStretch = p.x * (1.75 - p.y * 0.45);
  float r2 = xStretch * xStretch + p.y * p.y;
  if (r2 >= 1.0) discard;
  float body = pow(1.0 - r2, 1.35);
  float glint = exp(-dot(p - vec2(-0.14, 0.16), p - vec2(-0.14, 0.16)) * 18.0) * 0.45;
  float alpha = vAlpha * clamp(body + glint, 0.0, 1.0);
  if (alpha < 0.01) discard;
  vec3 col = mix(uColor, vec3(1.0), clamp(glint * 1.4, 0.0, 0.65));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

function createIcicleThawDrips(extTips, intTips, sampleY, capacity = 12) {
  const posArr = new Float32Array(capacity * 3);
  const sizeArr = new Float32Array(capacity);
  const alphaArr = new Float32Array(capacity);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posArr, 3);
  const sizeAttr = new THREE.BufferAttribute(sizeArr, 1);
  const alphaAttr = new THREE.BufferAttribute(alphaArr, 1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr.setUsage(THREE.DynamicDrawUsage);
  alphaAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aSize', sizeAttr);
  geo.setAttribute('aAlpha', alphaAttr);
  geo.setDrawRange(0, 0);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#DCF4FA') } },
    vertexShader: THAW_DRIP_VERT,
    fragmentShader: THAW_DRIP_FRAG,
    transparent: true,
    depthWrite: false
  });
  mat.userData.skyIgnore = true;

  const points = new THREE.Points(geo, mat);
  points.name = 'wuling-icicle-thaw-drips';
  points.visible = false;
  points.frustumCulled = false;
  points.renderOrder = 6;

  const allExt = (extTips || []).map(t => ({ ...t, groundY: sampleY(t.x, t.z), zone: 'exterior' }));
  const allInt = (intTips || []).map(t => ({ ...t, groundY: sampleY(t.x, t.z), zone: 'interior' }));
  const drops = Array.from({ length: capacity }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    startY: 0,
    groundY: 0,
    age: 0,
    hangDur: 0.22,
    zone: 'exterior'
  }));

  let spawnTimer = 0.35;
  let audioCooldown = 0;
  let seq = 0;
  let activeCount = 0;

  function clear() {
    for (let i = 0; i < capacity; i++) drops[i].active = false;
    activeCount = 0;
    geo.setDrawRange(0, 0);
    points.visible = false;
  }

  return {
    points,
    get activeCount() { return activeCount; },
    clear,
    update(step, thawReady, icicleGrow, extVis, intVis, playerState, pendingEvents) {
      if (!thawReady) {
        if (activeCount > 0 || points.visible) clear();
        return;
      }
      if (audioCooldown > 0) audioCooldown = Math.max(0, audioCooldown - step);
      const nearExt = extVis && allExt.length > 0 && (!playerState || Math.hypot(playerState.x - allExt[0].x, playerState.z - allExt[0].z) < 26);
      const nearInt = intVis && allInt.length > 0 && (!playerState || Math.hypot(playerState.x - allInt[0].x, playerState.z - allInt[0].z) < 26);

      if (nearExt || nearInt) {
        spawnTimer -= step;
        if (spawnTimer <= 0) {
          spawnTimer = 0.42 + ((seq * 37) % 100) / 100 * 0.58;
          const pool = nearInt && nearExt ? (seq % 2 === 0 ? allInt : allExt) : (nearInt ? allInt : allExt);
          const tip = pool[seq % pool.length];
          seq += 1;
          for (let i = 0; i < capacity; i++) {
            const d = drops[i];
            if (!d.active) {
              d.active = true;
              d.x = tip.x;
              d.z = tip.z;
              d.startY = tip.anchorY - tip.len * icicleGrow;
              d.y = d.startY;
              d.groundY = tip.groundY + 0.04;
              d.age = 0;
              d.hangDur = 0.16 + ((seq * 19) % 10) * 0.014;
              d.zone = tip.zone;
              break;
            }
          }
        }
      }

      let count = 0;
      for (let i = 0; i < capacity; i++) {
        const d = drops[i];
        if (!d.active) continue;
        const zoneVis = d.zone === 'exterior' ? extVis : intVis;
        if (!zoneVis) {
          d.active = false;
          continue;
        }
        d.age += step;
        if (d.age <= d.hangDur) {
          d.y = d.startY - (d.age / d.hangDur) * 0.03;
          const sz = 0.045 + (d.age / d.hangDur) * 0.045;
          const i3 = count * 3;
          posArr[i3] = d.x; posArr[i3 + 1] = d.y; posArr[i3 + 2] = d.z;
          sizeArr[count] = sz;
          alphaArr[count] = 0.55 + (d.age / d.hangDur) * 0.35;
          count += 1;
        } else {
          const ft = d.age - d.hangDur;
          d.y = d.startY - 0.03 - 0.5 * 8.2 * ft * ft;
          if (d.y <= d.groundY) {
            d.active = false;
            if (audioCooldown <= 0 && pendingEvents && (!playerState || Math.hypot(playerState.x - d.x, playerState.z - d.z) < 18)) {
              audioCooldown = 1.65;
              pendingEvents.push({ type: 'dewDrop', x: d.x, z: d.z, intensity: 0.34 });
            }
          } else {
            const i3 = count * 3;
            posArr[i3] = d.x; posArr[i3 + 1] = d.y; posArr[i3 + 2] = d.z;
            sizeArr[count] = 0.095;
            alphaArr[count] = 0.86;
            count += 1;
          }
        }
      }
      activeCount = count;
      geo.setDrawRange(0, count);
      points.visible = count > 0;
      if (count > 0) {
        posAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      points.removeFromParent();
    }
  };
}

function buildPavilionEaveLines(spec, count = 4) {
  if (!spec || !spec.corners || spec.corners.length < 4) return [];
  const { x: cx, eaveY, z: cz, corners } = spec;
  const out = [];
  for (let side = 0; side < 4; side++) {
    const a = corners[side];
    const b = corners[(side + 1) % 4];
    const mx = (a[0] + b[0]) * 0.5;
    const mz = (a[2] + b[2]) * 0.5;
    out.push({
      a: [a[0], eaveY, a[2]],
      b: [b[0], eaveY, b[2]],
      count,
      insetX: (cx - mx) * 0.018,
      insetZ: (cz - mz) * 0.018,
      lenScale: 1.0,
      collectTips: true
    });
  }
  return out;
}

function buildVillageCottageEaveLines(houseInfo, overhang = 0.52) {
  if (!Array.isArray(houseInfo) || houseInfo.length === 0) return { lines: [], houseCount: 0 };
  const lines = [];
  let houseCount = 0;
  for (let i = 0; i < houseInfo.length; i++) {
    const hi = houseInfo[i];
    if (!hi || !Number.isFinite(hi.x) || !Number.isFinite(hi.z) || !Number.isFinite(hi.gy) || !Number.isFinite(hi.h)) continue;
    const W = (hi.w || 5) + overhang * 2;
    const D = (hi.d || 4) + overhang * 2;
    const baseY = hi.gy + hi.h - 0.18;
    const c = Math.cos(hi.rot || 0);
    const s = Math.sin(hi.rot || 0);
    const pt = (lx, lz) => [hi.x + lx * c + lz * s, baseY, hi.z - lx * s + lz * c];
    const count = Math.max(4, Math.min(6, Math.round(D / 1.05)));
    for (const side of [-1, 1]) {
      const lx = side * (W * 0.5 - 0.05);
      lines.push({
        a: pt(lx, -D * 0.46),
        b: pt(lx, D * 0.46),
        count,
        insetX: 0,
        insetZ: 0,
        lenScale: 1.05
      });
    }
    houseCount += 1;
  }
  return { lines, houseCount };
}

function buildCreekShoreIce(riverCurve, sampleY, waterY, avoidSpots, mat) {
  if (!riverCurve?.getPointAt || !riverCurve?.getTangentAt) return { mesh: null, anchors: [] };
  const r = mulberry32(91307);
  const positions = [];
  const colors = [];
  const anchors = [];
  const cLand = new THREE.Color('#F1F5F6');
  const cMid = new THREE.Color('#D5ECF2');
  const cTip = new THREE.Color('#A6D2DF');
  const cFloeCenter = new THREE.Color('#E8F5F8');
  const cFloeRim = new THREE.Color('#ADD6E1');

  const pushTri = (a, ca, b, cb, c, cc) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const ny = uz * vx - ux * vz;
    if (ny >= 0) {
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      colors.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    } else {
      positions.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
      colors.push(ca[0], ca[1], ca[2], cc[0], cc[1], cc[2], cb[0], cb[1], cb[2]);
    }
  };

  const tintCol = (base, jitter) => [
    clamp(base.r + jitter, 0, 1),
    clamp(base.g + jitter * 0.9, 0, 1),
    clamp(base.b + jitter * 0.7, 0, 1)
  ];

  const avoid = Array.isArray(avoidSpots) ? avoidSpots : [];
  const clearanceAt = (x, z) => {
    let f = 1;
    for (let i = 0; i < avoid.length; i++) {
      const a = avoid[i];
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < a.r + 1.5) {
        f *= smoothstep(a.r * 0.65, a.r + 1.5, d);
      }
    }
    return f;
  };

  const findShoreDist = (px, pz, nx, nz) => {
    let prevD = 1.6;
    let prevY = sampleY(px + nx * prevD, pz + nz * prevD);
    for (let d = 2.1; d <= 24.5; d += 0.5) {
      const y = sampleY(px + nx * d, pz + nz * d);
      if (prevY < waterY && y >= waterY) {
        let lo = prevD;
        let hi = d;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) * 0.5;
          if (sampleY(px + nx * mid, pz + nz * mid) < waterY) lo = mid;
          else hi = mid;
        }
        return (lo + hi) * 0.5;
      }
      prevD = d;
      prevY = y;
    }
    return null;
  };

  const tMin = 0.36;
  const tMax = 0.87;
  const steps = 76;

  for (const side of [-1, 1]) {
    const phase = side > 0 ? 0.45 : 2.42;
    const slices = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = lerp(tMin, tMax, u);
      const pt = riverCurve.getPointAt(t);
      const tan = riverCurve.getTangentAt(t);
      const tl = Math.hypot(tan.x, tan.z) || 1;
      const nx = (tan.z / tl) * side;
      const nz = (-tan.x / tl) * side;
      const dShore = findShoreDist(pt.x, pt.z, nx, nz);
      if (dShore === null || dShore < 3.0) {
        slices.push(null);
        continue;
      }
      const sx = pt.x + nx * dShore;
      const sz = pt.z + nz * dShore;
      const endFade = smoothstep(tMin, tMin + 0.04, t) * (1 - smoothstep(tMax - 0.04, tMax, t));
      const wave = 0.5
        + 0.34 * Math.sin(t * 27.0 + phase)
        + 0.24 * Math.cos(t * 53.0 - phase * 1.35)
        + 0.14 * Math.sin(t * 95.0 + phase * 0.7);
      const clearF = clearanceAt(sx, sz);
      const rawW = Math.max(0, (wave - 0.24) / 0.76) * endFade * clearF;
      if (rawW <= 0.08) {
        slices.push(null);
        continue;
      }

      const inland = 0.26 + rawW * 0.22;
      const waterOut = clamp(0.42 + rawW * (1.28 + (r() - 0.5) * 0.36), 0.32, Math.max(0.36, dShore - 1.55));
      const midOut = waterOut * (0.42 + (r() - 0.5) * 0.08);
      const lx = pt.x + nx * (dShore + inland);
      const lz = pt.z + nz * (dShore + inland);
      const mx = pt.x + nx * (dShore - midOut);
      const mz = pt.z + nz * (dShore - midOut);
      const tx = pt.x + nx * (dShore - waterOut);
      const tz = pt.z + nz * (dShore - waterOut);
      const ly = Math.max(waterY + 0.068, sampleY(lx, lz) + 0.032);
      const my = Math.max(waterY + 0.056, sampleY(mx, mz) + 0.028);
      const ty = Math.max(waterY + 0.028, sampleY(tx, tz) + 0.022);
      const j = (r() - 0.5) * 0.045;
      const capPt = [sx, Math.max(waterY + 0.042, sampleY(sx, sz) + 0.026), sz];

      slices.push({
        pt, nx, nz, dShore, waterOut, clearF,
        land: [lx, ly, lz],
        mid: [mx, my, mz],
        tip: [tx, ty, tz],
        cap: capPt,
        cLand: tintCol(cLand, j),
        cMid: tintCol(cMid, j * 0.9),
        cTip: tintCol(cTip, j * 0.8)
      });
    }

    for (let i = 0; i < slices.length; i++) {
      const cur = slices[i];
      const prev = i > 0 ? slices[i - 1] : null;
      const next = i + 1 < slices.length ? slices[i + 1] : null;
      if (!cur) continue;
      if (!prev && next) {
        // 冰带起点收尖至岸线，避免方头齐切
        const txDir = cur.land[0] - next.land[0];
        const tzDir = cur.land[2] - next.land[2];
        const tl = Math.hypot(txDir, tzDir) || 1;
        const leadX = cur.cap[0] + (txDir / tl) * 0.85;
        const leadZ = cur.cap[2] + (tzDir / tl) * 0.85;
        const lead = [leadX, Math.max(waterY + 0.036, sampleY(leadX, leadZ) + 0.025), leadZ];
        pushTri(lead, cur.cMid, cur.land, cur.cLand, cur.mid, cur.cMid);
        pushTri(lead, cur.cTip, cur.mid, cur.cMid, cur.tip, cur.cTip);
      }
      if (prev) {
        pushTri(prev.land, prev.cLand, cur.land, cur.cLand, cur.mid, cur.cMid);
        pushTri(prev.land, prev.cLand, cur.mid, cur.cMid, prev.mid, prev.cMid);
        pushTri(prev.mid, prev.cMid, cur.mid, cur.cMid, cur.tip, cur.cTip);
        pushTri(prev.mid, prev.cMid, cur.tip, cur.cTip, prev.tip, prev.cTip);
      }
      if (!next && prev) {
        const txDir = cur.land[0] - prev.land[0];
        const tzDir = cur.land[2] - prev.land[2];
        const tl = Math.hypot(txDir, tzDir) || 1;
        const tailX = cur.cap[0] + (txDir / tl) * 0.85;
        const tailZ = cur.cap[2] + (tzDir / tl) * 0.85;
        const tail = [tailX, Math.max(waterY + 0.036, sampleY(tailX, tailZ) + 0.025), tailZ];
        pushTri(cur.land, cur.cLand, tail, cur.cMid, cur.mid, cur.cMid);
        pushTri(cur.mid, cur.cMid, tail, cur.cTip, cur.tip, cur.cTip);
      }

      // 岸冰外缘偶缀几枚低模薄浮冰碎片（合入同一批次，零额外 draw call）
      if (cur.waterOut > 0.90 && cur.dShore - cur.waterOut > 2.35 && cur.clearF > 0.85 && r() < 0.24) {
        const gap = 0.42 + r() * 0.72;
        const fx = cur.tip[0] - cur.nx * gap + (r() - 0.5) * 0.45;
        const fz = cur.tip[2] - cur.nz * gap + (r() - 0.5) * 0.45;
        if (clearanceAt(fx, fz) > 0.85 && sampleY(fx, fz) < waterY - 0.08) {
          const fr = 0.24 + r() * 0.26;
          const rot0 = r() * TAU;
          const fy = waterY + 0.030;
          const center = [fx, fy + 0.016, fz];
          const jF = (r() - 0.5) * 0.04;
          const ccF = tintCol(cFloeCenter, jF);
          const crF = tintCol(cFloeRim, jF);
          const sides = 5;
          const ring = [];
          for (let s = 0; s < sides; s++) {
            const ang = rot0 + (s * TAU) / sides + (r() - 0.5) * 0.22;
            const rad = fr * (0.76 + r() * 0.42);
            ring.push([fx + Math.cos(ang) * rad, fy, fz + Math.sin(ang) * rad]);
          }
          for (let s = 0; s < sides; s++) {
            pushTri(center, ccF, ring[s], crF, ring[(s + 1) % sides], crF);
          }
        }
      }

      // 采集供「识物（G）与游记图鉴（J）」使用的真实岸冰锚点（零额外随机数消耗，优先覆盖东岸渡口至桃林湾）
      if (anchors.length < 6 && cur.waterOut > 0.72 && cur.clearF > 0.75) {
        const ax = cur.mid[0], ay = cur.mid[1] + 0.08, az = cur.mid[2];
        if (anchors.every(a => Math.hypot(a.x - ax, a.z - az) > 18)) {
          anchors.push({ x: ax, y: ay, z: az });
        }
      }
    }
  }

  if (positions.length === 0) return { mesh: null, anchors: [] };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'wuling-ext-shore-ice';
  mesh.visible = false;
  mesh.renderOrder = 2;
  mesh.frustumCulled = true;
  return { mesh, anchors };
}

function buildFerryNetMesh() {
  // 渡口晒网架下悬垂麻线渔网（以顶横竹杆中点 [0, 0, 0] 为摆轴，随风绕 Z 轴轻摆）
  const b = createGroveBaker();
  for (let s = 0; s <= 5; s++) {
    const u = s / 5;
    const zTop = -0.75 + u * 1.50;
    const zBot = -0.72 + u * 1.44;
    const sagX = 0.09 + Math.sin(u * Math.PI) * 0.13;
    b.beam([0, -0.02, zTop], [sagX, -1.34, zBot], 0.011, '#C5B89A', 0.009, 4, 'net');
    if (s < 5) {
      const zNext = -0.75 + (u + 0.2) * 1.50;
      const zMidA = -0.735 + u * 1.47;
      const zMidB = -0.735 + (u + 0.2) * 1.47;
      const midX = 0.055 + Math.sin((u + 0.1) * Math.PI) * 0.08;
      b.beam([0, -0.02, zTop], [midX, -0.70, zMidB], 0.009, '#B9AC8F', 0.009, 4, 'net');
      b.beam([0, -0.02, zNext], [midX, -0.70, zMidA], 0.009, '#B9AC8F', 0.009, 4, 'net');
      b.beam([midX, -0.70, zMidA], [sagX, -1.34, -0.72 + (u + 0.2) * 1.44], 0.008, '#B3A689', 0.008, 4, 'net');
      b.orb([0, 0.0, -0.62 + u * 1.45], [0.042, 0.032, 0.032], '#AD7448', 'net', s);
    }
  }
  // 底部坠网石沉子与底纲绳
  b.beam([0.09, -1.34, -0.72], [0.22, -1.34, 0.0], 0.013, '#9C8F74', 0.013, 4, 'net');
  b.beam([0.22, -1.34, 0.0], [0.09, -1.34, 0.72], 0.013, '#9C8F74', 0.013, 4, 'net');
  for (let w = 0; w < 4; w++) {
    const u = (w + 0.5) / 4;
    const wx = 0.09 + Math.sin(u * Math.PI) * 0.13;
    b.orb([wx, -1.36, -0.72 + u * 1.44], [0.028, 0.024, 0.028], '#6E746C', 'net', w + 3);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = b.finish('net', mat);
  mesh.name = 'wuling-ferry-net';
  mesh.matrixAutoUpdate = true;
  b.dispose();
  return { mesh, mat };
}

// 零额外 draw call 的渐进薄雪着色器钩子（链式兼容 architecturalCraft / sky 材质补丁，可完整还原）
export function attachProgressiveSnowMaterial(material, snowUniform, key = 'wuling-prog-snow-v1') {
  if (!material || typeof material !== 'object' || !snowUniform) return null;
  if (material.userData?._progSnowKeys?.has(key)) return null;
  if (!material.userData) material.userData = {};
  if (!material.userData._progSnowKeys) material.userData._progSnowKeys = new Set();
  material.userData._progSnowKeys.add(key);

  const prevHook = material.onBeforeCompile;
  const prevKeyFn = material.customProgramCacheKey;
  const baseKey = typeof prevKeyFn === 'function' ? prevKeyFn.call(material) : '';

  const chainedHook = function onBeforeCompileProgressiveSnow(shader, renderer) {
    if (typeof prevHook === 'function') prevHook.call(this, shader, renderer);
    shader.uniforms.uProgSnowAccum = snowUniform;
    if (!shader.vertexShader.includes('vProgSnowUp')) {
      shader.vertexShader = 'varying vec3 vProgSnowPos;\nvarying float vProgSnowUp;\n' + shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvProgSnowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvProgSnowUp = normalize(mat3(modelMatrix) * objectNormal).y;'
        );
    }
    if (!shader.fragmentShader.includes('uProgSnowAccum')) {
      shader.fragmentShader = 'uniform float uProgSnowAccum;\nvarying vec3 vProgSnowPos;\nvarying float vProgSnowUp;\n' + shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if (uProgSnowAccum > 0.001) {
  float psUp = smoothstep(0.32, 0.86, vProgSnowUp);
  float psGrain = 0.5 + 0.30 * sin(vProgSnowPos.x * 2.15 + vProgSnowPos.z * 1.65)
    + 0.20 * cos(vProgSnowPos.x * 4.30 - vProgSnowPos.z * 3.70);
  float psCover = clamp((uProgSnowAccum * 1.18 - (1.0 - psGrain) * 0.32) * psUp, 0.0, 0.82);
  vec3 psSnowCol = mix(vec3(0.84, 0.87, 0.89), vec3(0.95, 0.95, 0.92), psUp);
  diffuseColor.rgb = mix(diffuseColor.rgb, psSnowCol, psCover);
}`
        );
    }
  };

  const chainedKey = function customProgramCacheKeyProgressiveSnow() {
    const prefix = (typeof prevKeyFn === 'function' && prevKeyFn !== THREE.Material.prototype.customProgramCacheKey)
      ? prevKeyFn.call(this)
      : baseKey;
    return prefix ? `${prefix}|${key}` : key;
  };

  material.onBeforeCompile = chainedHook;
  material.customProgramCacheKey = chainedKey;
  material.needsUpdate = true;

  return function restoreProgressiveSnowMaterial() {
    material.userData?._progSnowKeys?.delete(key);
    if (material.onBeforeCompile === chainedHook) material.onBeforeCompile = prevHook;
    if (material.customProgramCacheKey === chainedKey) material.customProgramCacheKey = prevKeyFn;
    material.needsUpdate = true;
  };
}

export function createWulingOutskirts(options = {}) {
  const {
    world,
    field,
    distanceToRiver,
    riverCurve,
    flora,
    boats,
    cliff,
    exterior,
    village,
    props,
    hinterland,
    villageScenes,
    villageLife,
    leisureGrove,
    hospitalityFeast,
    qinHanHomestead,
    qinHanCompletion,
    qianmoPaths,
    outerWilds,
    act3Finale,
    config = outskirtsData
  } = options;

  const rand = mulberry32(config.seed || 20261119);
  const group = new THREE.Group();
  group.name = 'wuling-outskirts';

  const exteriorGroup = new THREE.Group();
  exteriorGroup.name = 'wuling-outskirts-exterior';
  const interiorGroup = new THREE.Group();
  interiorGroup.name = 'wuling-outskirts-interior';
  group.add(exteriorGroup, interiorGroup);

  const waterY = world?.terrain?.waterLevel ?? -1;
  const boundsR = (world?.player?.boundsRadius ?? 255) - 3.5;
  const spawn = world?.player?.spawn || { x: 26, z: 204 };
  const slit = cliff?.slit || { x: 22.9, z: -8.19, ground: 2, gap: 3 };
  const roadPts = world?.village?.road?.points || [];
  const pond = world?.terrain?.pond || null;

  const sampleY = (x, z) => (
    typeof field?.walkSurface === 'function'
      ? field.walkSurface(x, z)
      : (field?.sample ? field.sample(x, z) : 0)
  );
  const sampleSlope = (x, z) => (field?.slope ? field.slope(x, z) : 0);
  const riverDist = (x, z) => (distanceToRiver ? distanceToRiver(x, z) : 30);

  const extContext = exterior?.layout?.context ||
    (flora && boats && cliff ? createExteriorContext(world, field, distanceToRiver, riverCurve, flora, boats, cliff) : null);
  const extPaths = exterior?.layout?.paths || [];
  const extStops = exterior?.layout?.stops || [];

  const existingIntBoxes = [
    ...(cliff?.blockers || []),
    ...(village?.blockers || []),
    ...(props?.blockers || []),
    ...(hinterland?.blockers || []),
    ...(villageScenes?.blockers || []),
    ...(villageLife?.blockers || []),
    ...(leisureGrove?.blockers || []),
    ...(hospitalityFeast?.blockers || []),
    ...(qinHanHomestead?.blockers || []),
    ...(qinHanCompletion?.blockers || []),
    ...(outerWilds?.blockers || [])
  ];
  const existingHouses = village?.houseInfo || [];
  const existingPlots = village?.plots || [];
  const act3Markers = act3Finale?.markers || [];

  const placedOutskirts = [];
  const blockers = [];
  const targets = [];
  const shelters = [];
  const quietSpots = [];
  const sites = [];

  function nearTrailOrStop(x, z, r) {
    for (const p of extPaths) {
      const pts = p.points || [];
      for (let i = 1; i < pts.length; i++) {
        if (segmentDistance(x, z, pts[i - 1], pts[i]) < 0.72 + r + 0.55) return true;
      }
    }
    for (const s of extStops) {
      if (Math.hypot(x - s.x, z - s.z) < (s.quietRadius || 3) + r + 0.65) return true;
      if (s.target) {
        if (segmentDistance(x, z, [s.x, s.z], [s.target.x, s.target.z]) < r + 0.85) return true;
      }
    }
    for (const m of act3Markers) {
      if (Math.hypot(x - m.x, z - m.z) < 4.5 + r) return true;
    }
    return false;
  }

  function isExteriorValid(x, z, radius, allowNearCave = false) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (Math.hypot(x, z) + radius > boundsR) return false;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 5.2 + radius) return false;
    if (Math.hypot(x - slit.x, z - slit.z) < 11.5 + radius) return false;
    if (nearTrailOrStop(x, z, radius)) return false;
    for (const prev of placedOutskirts) {
      if (Math.hypot(x - prev.x, z - prev.z) < prev.r + radius + 0.65) return false;
    }
    if (!allowNearCave && extContext && z - radius >= extContext.minZ && z + radius <= extContext.maxZ) {
      return exteriorSiteSafe(x, z, radius, extContext, true);
    }
    // 洞前幽谷段（z = 18..45）：独立校验干岸、缓坡、河道净空、碰撞体与树冠
    if (z < 18 || z > 214) return false;
    if (riverDist(x, z) < (world?.stream?.halfWidth || 7) + 1.8 + radius) return false;
    for (let k = -1; k < 8; k++) {
      const dx = k < 0 ? 0 : Math.cos((k * TAU) / 8) * radius;
      const dz = k < 0 ? 0 : Math.sin((k * TAU) / 8) * radius;
      const y = sampleY(x + dx, z + dz);
      const sl = sampleSlope(x + dx, z + dz);
      if (y < waterY + 0.65 || sl > 0.52) return false;
    }
    for (const b of cliff?.blockers || []) {
      if (boxDistXZ(x, z, b) < radius + 0.6) return false;
    }
    if (extContext) {
      for (const c of extContext.queryCircles(x, z, radius + 0.5)) {
        if (Math.hypot(x - c.x, z - c.z) < radius + c.r + 0.45) return false;
      }
    }
    return true;
  }

  function findSafeExteriorPos(ax, az, radius, allowNearCave = false) {
    if (isExteriorValid(ax, az, radius, allowNearCave)) {
      return { x: ax, y: sampleY(ax, az), z: az };
    }
    for (let ring = 1; ring <= 18; ring++) {
      const dist = ring * 0.85;
      const steps = 10 + ring * 2;
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * TAU + ring * 0.37;
        const cx = ax + Math.cos(ang) * dist;
        const cz = az + Math.sin(ang) * dist;
        if (isExteriorValid(cx, cz, radius, allowNearCave)) {
          return { x: cx, y: sampleY(cx, cz), z: cz };
        }
      }
    }
    return null;
  }

  function isInteriorValid(x, z, radius) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (z > -39.5 || z < -225) return false;
    if (Math.hypot(x, z) + radius > boundsR) return false;
    if (Math.hypot(x - slit.x, z - slit.z) < 14 + radius) return false;
    if (pond && Math.hypot(x - pond.x, z - pond.z) < (pond.radius || 9.5) + 2.8 + radius) return false;
    for (let i = 1; i < roadPts.length; i++) {
      if (segmentDistance(x, z, roadPts[i - 1], roadPts[i]) < 3.6 + radius) return false;
    }
    for (const h of existingHouses) {
      const hr = Math.hypot(h.w || 4, h.d || 4) * 0.55 + 2.2;
      if (Math.hypot(x - h.x, z - h.z) < hr + radius) return false;
    }
    for (const pl of existingPlots) {
      const px = Array.isArray(pl) ? pl[0] : pl.x;
      const pz = Array.isArray(pl) ? pl[1] : pl.z;
      const pw = (pl.w || pl.hw * 2 || 8) * 0.5 + 1.4;
      const pd = (pl.d || pl.hd * 2 || 8) * 0.5 + 1.4;
      if (Number.isFinite(px) && Number.isFinite(pz)) {
        if (Math.abs(x - px) < pw + radius && Math.abs(z - pz) < pd + radius) return false;
      }
    }
    for (const b of existingIntBoxes) {
      if (boxDistXZ(x, z, b) < radius + 0.65) return false;
    }
    for (const m of props?.marks || []) {
      if (!Number.isFinite(m?.x) || !Number.isFinite(m?.z)) continue;
      if (m.kind === 'fence') {
        const fb = { x: m.x, z: m.z, rot: m.rot || 0, hw: (m.halfW || 0.5) + 0.25, hd: Math.max(Math.abs(m.front || 0), Math.abs(m.back || 0)) + 0.25 };
        if (boxDistXZ(x, z, fb) < radius + 0.55) return false;
      } else if (m.kind === 'well' || m.kind === 'mill' || m.kind === 'coop' || m.kind === 'bench' || m.kind === 'drying-mat') {
        const mr = m.r || Math.hypot(m.w || 1, m.d || 1) * 0.5 + 0.4;
        if (Math.hypot(x - m.x, z - m.z) < radius + mr + 0.5) return false;
      }
    }
    for (const prev of placedOutskirts) {
      if (Math.hypot(x - prev.x, z - prev.z) < prev.r + radius + 0.65) return false;
    }
    for (let k = -1; k < 8; k++) {
      const dx = k < 0 ? 0 : Math.cos((k * TAU) / 8) * radius;
      const dz = k < 0 ? 0 : Math.sin((k * TAU) / 8) * radius;
      const y = sampleY(x + dx, z + dz);
      const sl = sampleSlope(x + dx, z + dz);
      if (y < waterY + 0.65 || sl > 0.44) return false;
    }
    return true;
  }

  function findSafeInteriorPos(ax, az, radius) {
    if (isInteriorValid(ax, az, radius)) {
      return { x: ax, y: sampleY(ax, az), z: az };
    }
    for (let ring = 1; ring <= 20; ring++) {
      const dist = ring * 0.9;
      const steps = 10 + ring * 2;
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * TAU + ring * 0.41;
        const cx = ax + Math.cos(ang) * dist;
        const cz = az + Math.sin(ang) * dist;
        if (isInteriorValid(cx, cz, radius)) {
          return { x: cx, y: sampleY(cx, cz), z: cz };
        }
      }
    }
    return null;
  }

  function reserve(x, z, r, tag) {
    placedOutskirts.push({ x, z, r, tag });
  }

  const baker = createGroveBaker();
  const rockTemplates = [
    roughRockGeometry(7101, 0, 0.34),
    roughRockGeometry(7109, 0, 0.38),
    roughRockGeometry(7123, 0, 0.30)
  ];

  function localPt(ox, oy, oz, rot, lx, ly, lz) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return [ox + lx * c + lz * s, oy + ly, oz - lx * s + lz * c];
  }

  function bakeLathe(pos, profile, segs, col, rotY, batch) {
    const pts = profile.map(([r, py]) => new THREE.Vector2(r, py));
    const g = new THREE.LatheGeometry(pts, segs);
    baker.add(g, pos, [1, 1, 1], col, [0, rotY || 0, 0], batch);
    g.dispose();
  }

  // 2 层倒角青石块（保证所有外表面法线朝外，适配 FrontSide 材质）
  function bakeChamferSlab(ox, oy, oz, w, h, d, rot, topCol, sideCol, batch, chamfer = 0.09, taper = 0.04) {
    const hx = w * 0.5;
    const hz = d * 0.5;
    const ch = Math.min(chamfer, hx * 0.38, hz * 0.38);
    const ring = (ly, sx, sz, sc) => {
      const rx = hx * sx;
      const rz = hz * sz;
      const rc = ch * sc;
      const pts = [
        [rx - rc, rz], [rx, rz - rc], [rx, -rz + rc], [rx - rc, -rz],
        [-rx + rc, -rz], [-rx, -rz + rc], [-rx, rz - rc], [-rx + rc, rz]
      ];
      return pts.map(([lx, lz]) => localPt(ox, oy, oz, rot, lx, ly, lz));
    };
    const r0 = ring(0, 1 + taper, 1 + taper, 0.9);
    const r1 = ring(h * 0.78, 1.0, 1.0, 1.0);
    const r2 = ring(h, 1 - taper * 1.1, 1 - taper * 1.1, 1.15);
    const topC = localPt(ox, oy, oz, rot, 0, h, 0);
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      baker.quad(r0[i], r0[j], r1[j], r1[i], sideCol, batch);
      baker.quad(r1[i], r1[j], r2[j], r2[i], topCol, batch);
      baker.tri(topC, r2[i], r2[j], topCol, batch);
    }
  }

  // 双坡折檐加厚茅草亭顶（外顶法线朝上自动承雪 + 厚茅草檐口立面 + 内顶深褐衬里）
  function bakeThatchRoof(p, opts, batch) {
    const {
      halfX, halfZ, eaveY, ridgeHalf, ridgeH, overhangX, overhangZ,
      thatchA, thatchB, thatchEdge, soffitA, soffitB, thick = 0.11
    } = opts;
    const ex = halfX + overhangX;
    const ez = halfZ + overhangZ;
    const mx = halfX + overhangX * 0.34;
    const mz = halfZ + overhangZ * 0.34;
    const midY = eaveY + ridgeH * 0.40;
    const topY = eaveY + ridgeH;
    const rL = p(-ridgeHalf, topY, 0);
    const rR = p(ridgeHalf, topY, 0);
    const mFL = p(-mx, midY, mz);
    const mFR = p(mx, midY, mz);
    const mBR = p(mx, midY, -mz);
    const mBL = p(-mx, midY, -mz);
    const cFL = p(-ex, eaveY - 0.08, ez);
    const cFR = p(ex, eaveY - 0.08, ez);
    const cBR = p(ex, eaveY - 0.08, -ez);
    const cBL = p(-ex, eaveY - 0.08, -ez);
    // 上层陡坡
    if (ridgeHalf > 0.02) {
      baker.quad(mFL, mFR, rR, rL, thatchA, batch);
      baker.quad(mBR, mBL, rL, rR, thatchB, batch);
      baker.tri(mBL, mFL, rL, thatchB, batch);
      baker.tri(mFR, mBR, rR, thatchA, batch);
    } else {
      const apex = p(0, topY, 0);
      baker.tri(mFL, mFR, apex, thatchA, batch);
      baker.tri(mFR, mBR, apex, thatchB, batch);
      baker.tri(mBR, mBL, apex, thatchB, batch);
      baker.tri(mBL, mFL, apex, thatchA, batch);
    }
    // 下层轻挑茅草折檐裙坡
    baker.quad(cFL, cFR, mFR, mFL, thatchA, batch);
    baker.quad(cFR, cBR, mBR, mFR, thatchB, batch);
    baker.quad(cBR, cBL, mBL, mBR, thatchB, batch);
    baker.quad(cBL, cFL, mFL, mBL, thatchA, batch);
    // 檐口垂厚草边（避免侧看如薄纸片）
    const uFL = p(-ex, eaveY - 0.08 - thick, ez);
    const uFR = p(ex, eaveY - 0.08 - thick, ez);
    const uBR = p(ex, eaveY - 0.08 - thick, -ez);
    const uBL = p(-ex, eaveY - 0.08 - thick, -ez);
    baker.quad(uFL, uFR, cFR, cFL, thatchEdge, batch);
    baker.quad(uFR, uBR, cBR, cFR, thatchEdge, batch);
    baker.quad(uBR, uBL, cBL, cBR, thatchEdge, batch);
    baker.quad(uBL, uFL, cFL, cBL, thatchEdge, batch);
    // 亭内深褐仰视衬里（法线朝下，冬季不积雪）
    const uTopY = topY - 0.07;
    if (ridgeHalf > 0.02) {
      const uRL = p(-ridgeHalf, uTopY, 0);
      const uRR = p(ridgeHalf, uTopY, 0);
      baker.quad(uFR, uFL, uRL, uRR, soffitA, batch);
      baker.quad(uBL, uBR, uRR, uRL, soffitB, batch);
      baker.tri(uFL, uBL, uRL, soffitB, batch);
      baker.tri(uBR, uFR, uRR, soffitA, batch);
      // 脊顶压茅竹杠与端头草结
      baker.beam(p(-ridgeHalf - 0.08, topY + 0.02, 0), p(ridgeHalf + 0.08, topY + 0.02, 0), 0.082, '#786244', 0.082, 6, batch);
      baker.beam(p(-ridgeHalf - 0.02, topY + 0.04, 0), p(-ridgeHalf + 0.02, topY + 0.14, 0), 0.072, '#8F7852', 0.045, 6, batch);
      baker.beam(p(ridgeHalf + 0.02, topY + 0.04, 0), p(ridgeHalf - 0.02, topY + 0.14, 0), 0.072, '#8F7852', 0.045, 6, batch);
    } else {
      const uApex = p(0, uTopY, 0);
      baker.tri(uFR, uFL, uApex, soffitA, batch);
      baker.tri(uBR, uFR, uApex, soffitB, batch);
      baker.tri(uBL, uBR, uApex, soffitB, batch);
      baker.tri(uFL, uBL, uApex, soffitA, batch);
      // 攒尖顶草扎宝结
      baker.beam(p(0, topY - 0.04, 0), p(0, topY + 0.18, 0), 0.13, '#7C6546', 0.055, 7, batch);
    }
    // 四角压脊竹条与檐下角椽
    const hipPairs = ridgeHalf > 0.02
      ? [[rL, cFL], [rR, cFR], [rR, cBR], [rL, cBL]]
      : [[p(0, topY + 0.01, 0), cFL], [p(0, topY + 0.01, 0), cFR], [p(0, topY + 0.01, 0), cBR], [p(0, topY + 0.01, 0), cBL]];
    for (const [a, b] of hipPairs) {
      baker.beam(a, b, 0.032, '#7B6646', 0.026, 5, batch);
    }
    return [cFL, cFR, cBR, cBL];
  }

  // ---- 几何构件库 ----
  function bakeMossBoulder(x, z, scale, batchSolid, batchFoliage) {
    const gy = sampleY(x, z);
    const rGeo = rockTemplates[Math.floor(rand() * rockTemplates.length)];
    const rotY = rand() * TAU;
    const sx = (0.72 + rand() * 0.38) * scale;
    const sy = (0.46 + rand() * 0.28) * scale;
    const sz = (0.68 + rand() * 0.36) * scale;
    const tone = rand() > 0.5 ? '#848C7F' : '#768075';
    baker.add(rGeo, [x, gy + sy * 0.34 - 0.08, z], [sx, sy, sz], tone, [(rand() - 0.5) * 0.2, rotY, (rand() - 0.5) * 0.2], batchSolid);
    // 石背青苔垫
    baker.orb([x + (rand() - 0.5) * 0.14, gy + sy * 0.62, z + (rand() - 0.5) * 0.14], [sx * 0.58, sy * 0.22, sz * 0.54], '#5F7752', batchFoliage, rotY);
  }

  function bakeBambooCluster(x, z, scale, batchSolid, batchFoliage) {
    const culms = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < culms; i++) {
      const ang = (i / culms) * TAU + rand() * 0.5;
      const rOff = 0.16 + rand() * 0.38;
      const bx = x + Math.cos(ang) * rOff;
      const bz = z + Math.sin(ang) * rOff;
      const gy = sampleY(bx, bz);
      const h = (3.4 + rand() * 2.1) * scale;
      const leanX = Math.cos(ang) * (0.28 + rand() * 0.32);
      const leanZ = Math.sin(ang) * (0.28 + rand() * 0.32);
      const culmCol = i % 2 === 0 ? '#5C7F4D' : '#6A8B56';
      baker.beam([bx, gy - 0.08, bz], [bx + leanX * 0.45, gy + h * 0.52, bz + leanZ * 0.45], 0.044 * scale, culmCol, 0.036 * scale, 5, batchSolid);
      baker.beam([bx + leanX * 0.45, gy + h * 0.50, bz + leanZ * 0.45], [bx + leanX, gy + h, bz + leanZ], 0.035 * scale, culmCol, 0.018 * scale, 5, batchSolid);
      for (let l = 0; l < 4; l++) {
        const ly = gy + h * (0.58 + l * 0.11);
        const lx = bx + leanX * (0.55 + l * 0.12);
        const lz = bz + leanZ * (0.55 + l * 0.12);
        const la = ang + (l - 1.5) * 0.85;
        const leafCol = l % 2 === 0 ? '#4B7744' : '#5D8A50';
        baker.leaf([lx, ly, lz], [lx + Math.cos(la) * 0.72 * scale, ly + 0.12 - l * 0.04, lz + Math.sin(la) * 0.72 * scale], 0.13 * scale, leafCol, batchFoliage);
      }
    }
  }

  function bakeWildShrub(x, z, scale, withCamellia, batchFoliage) {
    const gy = sampleY(x, z);
    // 凤尾蕨叶环
    const fronds = 6;
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * TAU + rand() * 0.35;
      const len = (0.58 + rand() * 0.28) * scale;
      baker.leaf(
        [x, gy + 0.04, z],
        [x + Math.cos(a) * len, gy + (0.26 + rand() * 0.18) * scale, z + Math.sin(a) * len],
        0.11 * scale,
        i % 2 === 0 ? '#4A7243' : '#5B844E',
        batchFoliage
      );
    }
    if (withCamellia) {
      // 山茶灌木圆簇与绛红/粉白山茶花苞
      baker.orb([x, gy + 0.36 * scale, z], [0.46 * scale, 0.34 * scale, 0.44 * scale], '#3E663B', batchFoliage, x + z);
      baker.orb([x + 0.18 * scale, gy + 0.48 * scale, z - 0.12 * scale], [0.30 * scale, 0.24 * scale, 0.28 * scale], '#4B7545', batchFoliage, x * 2);
      for (let b = 0; b < 4; b++) {
        const ba = b * 1.55 + 0.4;
        const br = 0.28 * scale;
        const flowerCol = b % 2 === 0 ? '#D95B66' : '#ECA0A8';
        baker.peach([x + Math.cos(ba) * br, gy + (0.48 + (b % 2) * 0.09) * scale, z + Math.sin(ba) * br], [0.068 * scale, 0.058 * scale, 0.068 * scale], flowerCol, batchFoliage);
      }
    }
  }

  function bakeWeepingWillow(x, z, scale, leanDir, batchSolid, batchFoliage) {
    const gy = sampleY(x, z);
    const leanX = leanDir * 0.98 * scale;
    const leanZ = -0.34 * scale;
    // 苍褐根座与三段曲倚老柳干
    baker.beam([x, gy - 0.24, z], [x + leanX * 0.14, gy + 0.52 * scale, z + leanZ * 0.14], 0.30 * scale, '#514033', 0.23 * scale, 7, batchSolid);
    baker.beam([x + leanX * 0.12, gy + 0.46 * scale, z + leanZ * 0.12], [x + leanX * 0.50, gy + 1.98 * scale, z + leanZ * 0.50], 0.23 * scale, '#5C4A3B', 0.16 * scale, 7, batchSolid);
    baker.beam([x + leanX * 0.48, gy + 1.92 * scale, z + leanZ * 0.48], [x + leanX, gy + 3.42 * scale, z + leanZ], 0.16 * scale, '#675444', 0.092 * scale, 7, batchSolid);

    const boughs = [
      [leanX + 1.18 * scale, 3.82 * scale, leanZ + 0.54 * scale],
      [leanX - 0.86 * scale, 3.74 * scale, leanZ + 0.92 * scale],
      [leanX + 0.68 * scale, 3.96 * scale, leanZ - 0.92 * scale],
      [leanX - 0.74 * scale, 3.64 * scale, leanZ - 0.70 * scale]
    ];
    // 顶部轻云状垂柳主冠（扁薄分层，告别厚重圆球）
    baker.orb([x + leanX * 1.02, gy + 3.98 * scale, z + leanZ], [1.18 * scale, 0.40 * scale, 1.08 * scale], '#6D9557', batchFoliage, 0.7);
    for (let i = 0; i < boughs.length; i++) {
      const [bx, by, bz] = boughs[i];
      const midX = x + leanX * 0.88 + (bx - leanX * 0.88) * 0.55;
      const midY = gy + 3.15 * scale + (by - 3.15 * scale) * 0.65 + 0.16 * scale;
      const midZ = z + leanZ * 0.88 + (bz - leanZ * 0.88) * 0.55;
      baker.beam([x + leanX * 0.88, gy + 3.15 * scale, z + leanZ * 0.88], [midX, midY, midZ], 0.082 * scale, '#6A5645', 0.056 * scale, 6, batchSolid);
      baker.beam([midX, midY, midZ], [x + bx, gy + by, z + bz], 0.055 * scale, '#725D4B', 0.032 * scale, 5, batchSolid);
      baker.orb([x + bx, gy + by + 0.10 * scale, z + bz], [0.92 * scale, 0.36 * scale, 0.88 * scale], i % 2 === 0 ? '#678F52' : '#78A05E', batchFoliage, i * 1.7);
      // 细柔双节垂丝柳绦（轻拂水面，摒弃粗大宽叶矛）
      for (let k = 0; k < 5; k++) {
        const ka = (k / 5) * TAU + i * 0.82;
        const rad = (0.44 + (k % 2) * 0.24) * scale;
        const sx = x + bx + Math.cos(ka) * rad;
        const sz = z + bz + Math.sin(ka) * rad;
        const topY = gy + by - 0.04 * scale;
        const dropLen = (1.58 + (k % 3) * 0.34) * scale;
        const mx = sx + leanDir * 0.14 * scale + Math.cos(ka) * 0.08 * scale;
        const my = topY - dropLen * 0.52;
        const mz = sz + 0.05 * scale + Math.sin(ka) * 0.08 * scale;
        const ex = mx + leanDir * 0.09 * scale;
        const ey = topY - dropLen;
        const ez = mz + 0.04 * scale;
        const colA = (i + k) % 2 === 0 ? '#749E58' : '#85AD63';
        const colB = (i + k) % 2 === 0 ? '#87B066' : '#96BA72';
        baker.leaf([sx, topY, sz], [mx, my, mz], 0.046 * scale, colA, batchFoliage);
        baker.leaf([mx, my + 0.04 * scale, mz], [ex, ey, ez], 0.034 * scale, colB, batchFoliage);
      }
    }
  }

  function bakeFerryPavilion(pos, rot) {
    const { x, y, z } = pos;
    const p = (lx, ly, lz) => localPt(x, y, z, rot, lx, ly, lz);
    const woodDark = '#5E4836';
    const woodMid = '#785E46';
    const thatchA = '#B49A67';
    const thatchB = '#9F8656';
    const bamboo = '#8C945A';

    // 四柱二阶鼓形石柱础 + 圆木立柱 + 八道檐下雀替斜撑
    const halfX = 1.32;
    const halfZ = 1.18;
    const eaveY = 2.28;
    for (const sx of [-halfX, halfX]) {
      for (const sz of [-halfZ, halfZ]) {
        const wp = p(sx, 0, sz);
        const footY = sampleY(wp[0], wp[2]);
        baker.beam([wp[0], footY - 0.18, wp[2]], [wp[0], y + 0.10, wp[2]], 0.19, '#7B8277', 0.175, 8, 'ext-solid');
        baker.beam([wp[0], y + 0.09, wp[2]], [wp[0], y + 0.22, wp[2]], 0.155, '#8F968A', 0.125, 8, 'ext-solid');
        baker.beam([wp[0], y + 0.20, wp[2]], [wp[0], y + eaveY, wp[2]], 0.086, woodDark, 0.076, 7, 'ext-solid');
        // 纵横双向木斜撑
        const dxIn = sx > 0 ? -0.44 : 0.44;
        const dzIn = sz > 0 ? -0.40 : 0.40;
        baker.beam(p(sx, eaveY - 0.48, sz), p(sx + dxIn, eaveY - 0.02, sz), 0.042, woodMid, 0.038, 5, 'ext-solid');
        baker.beam(p(sx, eaveY - 0.48, sz), p(sx, eaveY - 0.02, sz + dzIn), 0.042, woodMid, 0.038, 5, 'ext-solid');
      }
    }
    // 檐枋横梁与出挑梁头
    baker.beam(p(-halfX - 0.18, eaveY, -halfZ), p(halfX + 0.18, eaveY, -halfZ), 0.068, woodMid, 0.068, 6, 'ext-solid');
    baker.beam(p(-halfX - 0.18, eaveY, halfZ), p(halfX + 0.18, eaveY, halfZ), 0.068, woodMid, 0.068, 6, 'ext-solid');
    baker.beam(p(-halfX, eaveY, -halfZ - 0.18), p(-halfX, eaveY, halfZ + 0.18), 0.068, woodMid, 0.068, 6, 'ext-solid');
    baker.beam(p(halfX, eaveY, -halfZ - 0.18), p(halfX, eaveY, halfZ + 0.18), 0.068, woodMid, 0.068, 6, 'ext-solid');
    // 亭内穿斗抬梁横枋与瓜柱
    baker.beam(p(-halfX, eaveY + 0.02, 0), p(halfX, eaveY + 0.02, 0), 0.062, woodDark, 0.062, 6, 'ext-solid');
    baker.beam(p(-0.56, eaveY + 0.04, 0), p(-0.56, eaveY + 0.88, 0), 0.054, woodDark, 0.048, 6, 'ext-solid');
    baker.beam(p(0.56, eaveY + 0.04, 0), p(0.56, eaveY + 0.88, 0), 0.054, woodDark, 0.048, 6, 'ext-solid');

    // 双坡折檐加厚茅草屋顶（保留法线朝上承雪 + 垂厚草边 + 内顶衬里）
    const [cFL, cFR, cBR, cBL] = bakeThatchRoof(p, {
      halfX,
      halfZ,
      eaveY,
      ridgeHalf: 0.68,
      ridgeH: 0.98,
      overhangX: 0.44,
      overhangZ: 0.40,
      thatchA,
      thatchB,
      thatchEdge: '#8D764B',
      soffitA: '#6E5A3F',
      soffitB: '#635038',
      thick: 0.12
    }, 'ext-solid');
    extIcicleSpec = { x, eaveY: y + eaveY - 0.14, z, corners: [cFL, cFR, cBR, cBL] };

    // 渡口临溪檐下悬垂竹骨油纸风灯（物理灯架入 ext-solid，暮夜/寒雪点亮暖烛芯与微晕）
    const lpTop = p(-0.52, eaveY - 0.02, halfZ + 0.04);
    const lpCap = p(-0.52, eaveY - 0.24, halfZ + 0.04);
    const lpMid = p(-0.52, eaveY - 0.37, halfZ + 0.04);
    const lpBot = p(-0.52, eaveY - 0.50, halfZ + 0.04);
    baker.beam(lpTop, lpCap, 0.010, '#5A4534', 0.010, 4, 'ext-solid');
    baker.beam(lpCap, p(-0.52, eaveY - 0.20, halfZ + 0.04), 0.135, '#594433', 0.068, 6, 'ext-solid');
    baker.beam(lpBot, lpCap, 0.105, '#E2D8BF', 0.115, 6, 'ext-solid');
    baker.beam(p(-0.52, eaveY - 0.53, halfZ + 0.04), lpBot, 0.102, '#594433', 0.116, 6, 'ext-solid');
    lanternAnchors.push({ id: 'wuling-ferry-lantern', zone: 'exterior', x: lpMid[0], y: lpMid[1], z: lpMid[2], scale: 1.0, glowScale: 2.15, phase: 0.4 });

    // 亭内倒角青石坐榻 + 束腰敞口竹编鱼篓 + 搁置榻端的竹编斗笠
    const benchC = p(0, 0.30, -0.68);
    bakeChamferSlab(benchC[0], benchC[1], benchC[2], 1.68, 0.14, 0.48, rot, '#949A8E', '#7F867B', 'ext-solid', 0.06, 0.03);
    for (const lx of [-0.56, 0.56]) {
      const fp = p(lx, 0, -0.68);
      const fy = sampleY(fp[0], fp[2]);
      const legH = Math.max(0.32, y + 0.31 - fy + 0.14);
      bakeChamferSlab(fp[0], fy - 0.12, fp[2], 0.26, legH, 0.36, rot, '#848A7F', '#72786D', 'ext-solid', 0.04, 0.08);
    }
    // 收腰敞口竹鱼篓（真中空内腔 + 口沿竹箍）
    const creelP = p(0.88, 0, 0.45);
    const creelY = sampleY(creelP[0], creelP[2]);
    bakeLathe([creelP[0], creelY - 0.02, creelP[2]], [
      [0.01, 0], [0.16, 0], [0.22, 0.16], [0.20, 0.32], [0.13, 0.44],
      [0.16, 0.52], [0.14, 0.53], [0.11, 0.43], [0.16, 0.26], [0.12, 0.05], [0.01, 0.05]
    ], 10, '#B4945C', rot, 'ext-solid');
    bakeLathe([creelP[0], creelY + 0.48, creelP[2]], [
      [0.142, 0], [0.168, 0.02], [0.164, 0.055], [0.135, 0.055]
    ], 10, '#785E3A', rot, 'ext-solid');
    // 搁在石榻一侧的斜扣渔夫竹斗笠
    const hatP = p(-0.50, 0.44, -0.66);
    bakeLathe(hatP, [
      [0.24, 0], [0.15, 0.075], [0.05, 0.145], [0.005, 0.17]
    ], 10, '#C7B078', rot + 0.4, 'ext-solid');
    bakeLathe(hatP, [
      [0.244, 0], [0.236, 0.022], [0.222, 0.022], [0.228, 0]
    ], 10, '#7A633E', rot + 0.4, 'ext-solid');

    // 亭侧竹制晒网架（加斜撑与横梁绑结，立柱入地生根）
    const nA = p(-2.05, 0, -0.35);
    const nB = p(-2.05, 0, 1.35);
    const nyA = sampleY(nA[0], nA[2]);
    const nyB = sampleY(nB[0], nB[2]);
    baker.beam([nA[0], nyA - 0.15, nA[2]], [nA[0], y + 1.84, nA[2]], 0.052, bamboo, 0.044, 6, 'ext-solid');
    baker.beam([nB[0], nyB - 0.15, nB[2]], [nB[0], y + 1.84, nB[2]], 0.052, bamboo, 0.044, 6, 'ext-solid');
    baker.beam([nA[0], y + 1.76, nA[2]], [nB[0], y + 1.76, nB[2]], 0.044, bamboo, 0.044, 6, 'ext-solid');
    // 两端落地斜撑
    const braceA = p(-2.42, 0, -0.45);
    const braceB = p(-2.42, 0, 1.45);
    baker.beam([braceA[0], sampleY(braceA[0], braceA[2]) - 0.10, braceA[2]], [nA[0], y + 0.92, nA[2]], 0.032, '#79814C', 0.028, 5, 'ext-solid');
    baker.beam([braceB[0], sampleY(braceB[0], braceB[2]) - 0.10, braceB[2]], [nB[0], y + 0.92, nB[2]], 0.032, '#79814C', 0.028, 5, 'ext-solid');
    const netPivot = p(-2.05, 1.76, 0.50);
    ferryNetAnchor = { x: netPivot[0], y: netPivot[1], z: netPivot[2], rot };

    const ferryBlocker = { x, z, hw: 1.48, hd: 1.32, minY: y, maxY: y + 3.1, rot, source: 'wuling-ferry-pavilion' };
    blockers.push(ferryBlocker);
    shelters.push({
      id: 'wuling-ferry-pavilion',
      kind: 'pavilion',
      x,
      y,
      z,
      rx: 1.55,
      rz: 1.40,
      rot,
      radius: 2.55,
      eaveY: y + eaveY,
      roofY: y + eaveY + 0.96
    });
    quietSpots.push({
      id: 'wuling-ferry-bench',
      name: '武陵津渡口茅亭',
      x,
      z,
      radius: 2.6,
      seatY: y + 0.44,
      line: '茅檐下渔网轻晃，桃花流水自渡前拍岸而去。',
      winterLine: '朔雪落溪无声，竹筏轻磕杉桩，寒江渔火独明',
      winterClearLine: '晴午冰檐滴玉，寒溪薄冰映天光，竹筏随波微晃',
      winterNightLine: '寒星低垂溪湾，两盏渔火映碎岸畔薄冰'
    });
    targets.push({
      id: 'wuling-ferry-pavilion',
      x,
      y: y + 1.85,
      z,
      range: 11,
      ownBlocker: ferryBlocker,
      resolve: () => (exteriorGroup.visible !== false ? { x, y: y + 1.85, z } : { x: NaN, y: NaN, z: NaN })
    });
  }

  function bakeWestBankFishery(pos, rot) {
    const { x, y, z } = pos;
    const p = (lx, ly, lz) => localPt(x, y, z, rot, lx, ly, lz);
    // 竹编矮渔篱 + 丫杈晾鱼架 + 麻绳垂吊溪鱼干 + 敞口渔篓 + 溪岸青苔石
    for (let i = 0; i < 6; i++) {
      const lx = -1.25 + i * 0.50;
      const wp = p(lx, 0, 0);
      const fy = sampleY(wp[0], wp[2]);
      baker.beam([wp[0], fy - 0.12, wp[2]], [wp[0], y + 0.80, wp[2]], 0.036, '#7E8750', 0.031, 5, 'ext-solid');
    }
    for (const railY of [0.28, 0.58]) {
      baker.beam(p(-1.32, railY, 0), p(1.32, railY, 0), 0.025, '#958758', 0.025, 5, 'ext-solid');
    }
    baker.beam(p(-1.18, 0.10, 0), p(-0.55, 0.68, 0), 0.022, '#86784E', 0.022, 5, 'ext-solid');
    baker.beam(p(1.18, 0.10, 0), p(0.55, 0.68, 0), 0.022, '#86784E', 0.022, 5, 'ext-solid');

    const rA = p(-0.65, 0, 0.75);
    const rB = p(0.75, 0, 0.75);
    baker.beam([rA[0], sampleY(rA[0], rA[2]) - 0.12, rA[2]], [rA[0], y + 1.48, rA[2]], 0.046, '#68523F', 0.038, 6, 'ext-solid');
    baker.beam([rB[0], sampleY(rB[0], rB[2]) - 0.12, rB[2]], [rB[0], y + 1.48, rB[2]], 0.046, '#68523F', 0.038, 6, 'ext-solid');
    // 顶部木叉与斜撑
    baker.beam(p(-0.65, 1.38, 0.75), p(-0.74, 1.56, 0.75), 0.024, '#68523F', 0.016, 5, 'ext-solid');
    baker.beam(p(0.75, 1.38, 0.75), p(0.84, 1.56, 0.75), 0.024, '#68523F', 0.016, 5, 'ext-solid');
    baker.beam([rA[0], y + 1.42, rA[2]], [rB[0], y + 1.42, rB[2]], 0.035, '#8A9258', 0.035, 6, 'ext-solid');
    // 4 尾系麻绳垂挂的晾晒溪鱼干（麻绳 + 鱼首 + 渐收鱼腹 + 燕尾双叉）
    for (let f = 0; f < 4; f++) {
      const fx = -0.42 + f * 0.28;
      const drop = (f % 2) * 0.04;
      const bodyCol = f % 2 === 0 ? '#D4D6CC' : '#C5C9BF';
      const finCol = '#8E948C';
      baker.beam(p(fx, 1.42, 0.75), p(fx, 1.25 - drop, 0.75), 0.008, '#A9966E', 0.008, 4, 'ext-solid');
      baker.beam(p(fx, 1.25 - drop, 0.75), p(fx, 1.13 - drop, 0.75), 0.030, '#ABB0A8', 0.052, 6, 'ext-solid');
      baker.beam(p(fx, 1.13 - drop, 0.75), p(fx, 0.96 - drop, 0.75), 0.052, bodyCol, 0.018, 6, 'ext-solid');
      // 燕尾分叉尾鳍
      baker.beam(p(fx, 0.97 - drop, 0.75), p(fx - 0.048, 0.87 - drop, 0.75), 0.016, finCol, 0.006, 4, 'ext-solid');
      baker.beam(p(fx, 0.97 - drop, 0.75), p(fx + 0.048, 0.87 - drop, 0.75), 0.016, finCol, 0.006, 4, 'ext-solid');
    }
    // 晒鱼架旁搁置小竹篓
    const bskP = p(-1.02, 0, 0.56);
    const bskY = sampleY(bskP[0], bskP[2]);
    bakeLathe([bskP[0], bskY - 0.02, bskP[2]], [
      [0.01, 0], [0.15, 0], [0.21, 0.14], [0.19, 0.28], [0.14, 0.38],
      [0.16, 0.43], [0.135, 0.43], [0.11, 0.35], [0.14, 0.16], [0.01, 0.04]
    ], 9, '#B2935E', rot, 'ext-solid');
    const bldP = p(1.88, 0, -0.35);
    bakeMossBoulder(bldP[0], bldP[2], 0.88, 'ext-solid', 'ext-foliage');
    blockers.push({ x, z, hw: 1.4, hd: 0.9, minY: y, maxY: y + 1.55, rot, source: 'wuling-west-fishery' });
  }

  function bakeWaystone(pos) {
    const { x, y, z } = pos;
    const rot = -0.25;
    const p = (lx, ly, lz) => localPt(x, y, z, rot, lx, ly, lz);
    // 二阶倒角青石碑座 + 秦汉圆首收分石碣 + 浅刻碑额与竖排阴刻字槽 + 苔冠与山茶蕨丛
    bakeChamferSlab(x, y - 0.12, z, 0.92, 0.24, 0.62, rot, '#848B80', '#737A70', 'ext-solid', 0.09, 0.06);
    bakeChamferSlab(x, y + 0.11, z, 0.68, 0.14, 0.44, rot, '#8D9489', '#7B8277', 'ext-solid', 0.07, 0.05);
    // 略微收分的石碣碑身
    bakeChamferSlab(x, y + 0.24, z, 0.48, 0.80, 0.22, rot, '#959C91', '#848B80', 'ext-solid', 0.04, 0.07);
    // 秦汉圆首石额（顶部圆弧收冠）
    const headBase = p(0, 1.03, 0);
    bakeChamferSlab(headBase[0], headBase[1], headBase[2], 0.38, 0.14, 0.20, rot, '#9BA297', '#899085', 'ext-solid', 0.08, 0.18);
    // 正面浅凹碑框与三道竖行刻字槽
    baker.block(p(0, 0.66, 0.106), [0.30, 0.56, 0.016], '#737B70', [0, rot, 0], 'ext-solid');
    for (const cx of [-0.085, 0, 0.085]) {
      baker.block(p(cx, 0.66, 0.116), [0.022, 0.44, 0.010], '#596057', [0, rot, 0], 'ext-solid');
    }
    baker.orb(p(0.14, 1.14, -0.02), [0.19, 0.07, 0.12], '#5F7752', 'ext-foliage', 1.2);
    bakeWildShrub(x - 0.48, z + 0.28, 0.78, true, 'ext-foliage');
    blockers.push({ x, z, hw: 0.48, hd: 0.38, minY: y, maxY: y + 1.25, rot: -0.25, source: 'wuling-waystone' });
  }

  function bakeWoodcutterRest(pos) {
    const { x, y, z } = pos;
    const rot = 0.32;
    const p = (lx, ly, lz) => localPt(x, y, z, rot, lx, ly, lz);
    // 二层天然叠石歇脚台（宽阔青石基岩 + 倒角平顶青石坐面 + 苔藓垫）
    bakeChamferSlab(x, y - 0.10, z, 1.46, 0.32, 0.80, rot, '#7F867B', '#6F766C', 'ext-solid', 0.14, 0.08);
    bakeChamferSlab(x, y + 0.21, z, 1.24, 0.24, 0.64, rot, '#92998D', '#80877C', 'ext-solid', 0.11, 0.05);
    baker.orb(p(-0.38, 0.46, 0.10), [0.32, 0.055, 0.20], '#617954', 'ext-foliage', 2.4);

    // 两捆圆木松柴担（竖向麻绳捆扎围箍，贴合圆木束）
    for (const side of [-1, 1]) {
      const bx = x + 0.92 + side * 0.28;
      const bz = z - 0.25 + side * 0.22;
      const by = sampleY(bx, bz);
      for (let row = 0; row < 2; row++) {
        for (let col = -1; col <= 1; col++) {
          baker.beam(
            [bx + col * 0.085, by + 0.09 + row * 0.13, bz - 0.34],
            [bx + col * 0.085, by + 0.09 + row * 0.13, bz + 0.34],
            0.055,
            (row + col) % 2 === 0 ? '#6E533B' : '#826449',
            0.052,
            6,
            'ext-solid'
          );
        }
      }
      // 竖直绕束的麻绳箍（8 段围绕 Z 轴圆木截面收紧）
      const rCx = bx, rCy = by + 0.155, rRx = 0.158, rRy = 0.132;
      for (let s = 0; s < 8; s++) {
        const a0 = (s / 8) * TAU;
        const a1 = ((s + 1) / 8) * TAU;
        baker.beam(
          [rCx + Math.cos(a0) * rRx, rCy + Math.sin(a0) * rRy, bz],
          [rCx + Math.cos(a1) * rRx, rCy + Math.sin(a1) * rRy, bz],
          0.015, '#B7A274', 0.015, 4, 'ext-solid'
        );
      }
    }
    // 微拱双节青竹扁担 + 节环木塞竹水筒
    const poleMid = [x + 0.89, y + 0.56, z - 0.06];
    baker.beam([x + 0.52, sampleY(x + 0.52, z - 0.48), z - 0.48], poleMid, 0.028, '#8E9958', 0.032, 6, 'ext-solid');
    baker.beam(poleMid, [x + 1.26, y + 0.92, z + 0.36], 0.032, '#869252', 0.024, 6, 'ext-solid');
    const canP = p(0.28, 0.45, -0.06);
    baker.beam(canP, [canP[0], canP[1] + 0.25, canP[2]], 0.056, '#6C8B52', 0.053, 8, 'ext-solid');
    baker.beam([canP[0], canP[1] + 0.11, canP[2]], [canP[0], canP[1] + 0.135, canP[2]], 0.061, '#587442', 0.061, 8, 'ext-solid');
    baker.beam([canP[0], canP[1] + 0.24, canP[2]], [canP[0], canP[1] + 0.295, canP[2]], 0.032, '#8F6F4E', 0.028, 6, 'ext-solid');

    blockers.push({ x, z, hw: 0.72, hd: 0.46, minY: y, maxY: y + 0.62, rot: 0.32, source: 'wuling-woodcutter-rest' });
    quietSpots.push({
      id: 'wuling-woodcutter-bench',
      name: '桃溪山樵石台',
      x,
      z,
      radius: 2.3,
      seatY: y + 0.45,
      line: '松柴微带山脂清香，坐看夹岸落英随溪流转。',
      winterLine: '雪覆松柴暗香浮，寒溪流过素白桃林',
      winterClearLine: '雪霁松脂微暖，寒溪岸冰映日，远岭流岚舒缓',
      winterNightLine: '雪林夜静无声，霜石冷月照寒溪'
    });
  }

  function bakeWelcomingPine(pos, rot) {
    const { x, y, z } = pos;
    const p = (lx, ly, lz) => localPt(x, y, z, rot, lx, ly, lz);
    // 村口「豁然开朗」迎客苍松（盘曲赤褐老干 + 横展迎客长臂 + 五叠苍翠云片松针 + 青苔界石）
    baker.beam([x, y - 0.22, z], p(0.32, 1.65, 0.18), 0.26, '#5A4234', 0.20, 7, 'int-solid');
    baker.beam(p(0.30, 1.58, 0.16), p(-0.22, 3.25, -0.12), 0.20, '#644A3B', 0.14, 7, 'int-solid');
    baker.beam(p(-0.20, 3.18, -0.10), p(0.15, 4.45, 0.08), 0.14, '#6A4E3E', 0.08, 7, 'int-solid');
    // 横伸迎客大枝（向村道方向舒展揖客）
    baker.beam(p(0.12, 2.55, 0.05), p(-1.85, 2.78, 0.55), 0.11, '#624839', 0.052, 6, 'int-solid');
    baker.beam(p(-0.08, 3.55, -0.05), p(1.35, 3.85, -0.42), 0.085, '#624839', 0.042, 6, 'int-solid');

    const pads = [
      [p(-1.92, 2.92, 0.58), [1.28, 0.36, 1.05], '#2F5838'],
      [p(-0.95, 3.18, 0.32), [1.02, 0.32, 0.90], '#386440'],
      [p(0.18, 4.62, 0.10), [1.35, 0.40, 1.18], '#35603D'],
      [p(1.38, 3.98, -0.44), [1.08, 0.34, 0.94], '#3E6B44'],
      [p(-0.32, 4.12, -0.58), [0.96, 0.32, 0.88], '#2E5536']
    ];
    for (let i = 0; i < pads.length; i++) {
      baker.orb(pads[i][0], pads[i][1], pads[i][2], 'int-foliage', i * 1.9);
    }
    // 根畔青苔界石与蕨丛
    bakeMossBoulder(x - 0.95, z + 0.65, 1.12, 'int-solid', 'int-foliage');
    bakeWildShrub(x + 0.82, z + 0.58, 0.92, true, 'int-foliage');
    const pineBlocker = { x, z, hw: 0.85, hd: 0.85, minY: y, maxY: y + 4.6, rot, source: 'outskirt-welcoming-pine' };
    blockers.push(pineBlocker);
    targets.push({
      id: 'outskirt-welcoming-pine',
      x,
      y: y + 2.6,
      z,
      range: 12,
      ownBlocker: pineBlocker,
      resolve: () => (interiorGroup.visible !== false ? { x, y: y + 2.6, z } : { x: NaN, y: NaN, z: NaN })
    });
  }

  function bakeEntranceTeaShelter(pos, rot) {
    const { x, y, z } = pos;
    const p = (lx, ly, lz) => localPt(x, y, z, rot, lx, ly, lz);
    const halfX = 1.15;
    const halfZ = 1.02;
    const eaveY = 2.15;
    // 四柱青石柱础 + 圆木立柱 + 八道雀替斜撑
    for (const sx of [-halfX, halfX]) {
      for (const sz of [-halfZ, halfZ]) {
        const wp = p(sx, 0, sz);
        const fy = sampleY(wp[0], wp[2]);
        baker.beam([wp[0], fy - 0.15, wp[2]], [wp[0], y + 0.16, wp[2]], 0.16, '#81887C', 0.125, 8, 'int-solid');
        baker.beam([wp[0], y + 0.14, wp[2]], [wp[0], y + eaveY, wp[2]], 0.076, '#604A38', 0.068, 7, 'int-solid');
        const dxIn = sx > 0 ? -0.38 : 0.38;
        const dzIn = sz > 0 ? -0.34 : 0.34;
        baker.beam(p(sx, eaveY - 0.44, sz), p(sx + dxIn, eaveY - 0.02, sz), 0.036, '#765C45', 0.032, 5, 'int-solid');
        baker.beam(p(sx, eaveY - 0.44, sz), p(sx, eaveY - 0.02, sz + dzIn), 0.036, '#765C45', 0.032, 5, 'int-solid');
      }
    }
    // 四面檐枋横梁（补全左右山墙横梁）
    baker.beam(p(-halfX - 0.15, eaveY, -halfZ), p(halfX + 0.15, eaveY, -halfZ), 0.060, '#775D46', 0.060, 6, 'int-solid');
    baker.beam(p(-halfX - 0.15, eaveY, halfZ), p(halfX + 0.15, eaveY, halfZ), 0.060, '#775D46', 0.060, 6, 'int-solid');
    baker.beam(p(-halfX, eaveY, -halfZ - 0.15), p(-halfX, eaveY, halfZ + 0.15), 0.060, '#775D46', 0.060, 6, 'int-solid');
    baker.beam(p(halfX, eaveY, -halfZ - 0.15), p(halfX, eaveY, halfZ + 0.15), 0.060, '#775D46', 0.060, 6, 'int-solid');

    // 双层折檐攒尖加厚茅草亭顶（含宝顶草结、压脊竹条、垂厚草边与内顶衬里）
    const [c1, c2, c3, c4] = bakeThatchRoof(p, {
      halfX,
      halfZ,
      eaveY,
      ridgeHalf: 0,
      ridgeH: 0.90,
      overhangX: 0.38,
      overhangZ: 0.36,
      thatchA: '#B69C69',
      thatchB: '#A18858',
      thatchEdge: '#8A744B',
      soffitA: '#6B573C',
      soffitB: '#5F4D35',
      thick: 0.11
    }, 'int-solid');
    intIcicleSpec = { x, eaveY: y + eaveY - 0.12, z, corners: [c1, c2, c3, c4] };

    // 村口施茶草寮临路檐下迎客暖灯（穿洞出谷「豁然开朗」暮夜与寒雪归灯）
    const tlTop = p(0.32, eaveY - 0.02, halfZ + 0.04);
    const tlCap = p(0.32, eaveY - 0.22, halfZ + 0.04);
    const tlMid = p(0.32, eaveY - 0.35, halfZ + 0.04);
    const tlBot = p(0.32, eaveY - 0.48, halfZ + 0.04);
    baker.beam(tlTop, tlCap, 0.010, '#5A4534', 0.010, 4, 'int-solid');
    baker.beam(tlCap, p(0.32, eaveY - 0.18, halfZ + 0.04), 0.13, '#594433', 0.065, 6, 'int-solid');
    baker.beam(tlBot, tlCap, 0.102, '#E2D8BF', 0.112, 6, 'int-solid');
    baker.beam(p(0.32, eaveY - 0.51, halfZ + 0.04), tlBot, 0.098, '#594433', 0.112, 6, 'int-solid');
    lanternAnchors.push({ id: 'outskirt-tea-lantern', zone: 'interior', x: tlMid[0], y: tlMid[1], z: tlMid[2], scale: 0.98, glowScale: 2.05, phase: 2.2 });

    // 四足木框青石面施茶案（摒弃实心大灰方块）+ 鼓腹收口粗陶大茶瓮 + 竹水瓢 + 敞口陶茶碗
    const tableC = p(-0.28, 0.61, 0.18);
    bakeChamferSlab(tableC[0], tableC[1], tableC[2], 0.94, 0.085, 0.60, rot, '#91978C', '#7C8277', 'int-solid', 0.05, 0.04);
    for (const tx of [-0.68, 0.12]) {
      for (const tz of [-0.06, 0.42]) {
        const lp = p(tx, 0, tz);
        const ly = sampleY(lp[0], lp[2]);
        baker.beam([lp[0], ly - 0.10, lp[2]], [lp[0], y + 0.62, lp[2]], 0.046, '#5D4635', 0.040, 6, 'int-solid');
      }
    }
    // 案下横枨与置茶木搁板
    baker.beam(p(-0.68, 0.24, -0.06), p(0.12, 0.24, -0.06), 0.028, '#6F5640', 0.028, 5, 'int-solid');
    baker.beam(p(-0.68, 0.24, 0.42), p(0.12, 0.24, 0.42), 0.028, '#6F5640', 0.028, 5, 'int-solid');
    baker.block(p(-0.28, 0.25, 0.18), [0.78, 0.036, 0.44], '#7E634A', [0, rot, 0], 'int-solid');

    // 鼓腹收颈真中空粗陶施茶大瓮 + 悬置竹水瓢
    const urnBase = p(-0.46, 0.69, 0.18);
    bakeLathe(urnBase, [
      [0.01, 0], [0.15, 0], [0.24, 0.14], [0.26, 0.30], [0.20, 0.43],
      [0.16, 0.49], [0.195, 0.525], [0.175, 0.535], [0.135, 0.48], [0.17, 0.32], [0.01, 0.22]
    ], 12, '#7D5C46', rot, 'int-solid');
    // 瓮腹暗褐弦纹与壶内热茶汤面
    bakeLathe([urnBase[0], urnBase[1] + 0.29, urnBase[2]], [
      [0.258, 0], [0.266, 0.015], [0.258, 0.03]
    ], 12, '#5F4332', rot, 'int-solid');
    baker.beam(p(-0.46, 1.07, 0.18), p(-0.46, 1.09, 0.18), 0.16, '#5D6644', 0.16, 10, 'int-solid');
    // 竹水瓢（瓢斗 + 斜倚长竹柄）
    baker.beam(p(-0.44, 1.18, 0.18), p(-0.20, 1.35, 0.32), 0.016, '#A99262', 0.013, 5, 'int-solid');
    bakeLathe(p(-0.45, 1.14, 0.18), [
      [0.01, 0], [0.055, 0.01], [0.068, 0.05], [0.058, 0.052], [0.044, 0.016], [0.01, 0.012]
    ], 8, '#B69B66', rot, 'int-solid');
    const jarRim = p(-0.46, 1.25, 0.18);
    teaJarSteamAnchor = { x: jarRim[0], y: jarRim[1], z: jarRim[2] };

    // 两只撇口粗陶茶碗（真中空 Lathe + 淡碧茶汤）
    for (const [bx, bz, col] of [[-0.08, 0.24, '#CDBFA4'], [0.09, 0.10, '#C4B598']]) {
      const bp = p(bx, 0.695, bz);
      bakeLathe(bp, [
        [0.01, 0], [0.048, 0], [0.062, 0.018], [0.092, 0.068], [0.080, 0.070], [0.056, 0.024], [0.01, 0.018]
      ], 10, col, rot, 'int-solid');
      baker.beam(p(bx, 0.725, bz), p(bx, 0.742, bz), 0.068, '#6B7850', 0.072, 8, 'int-solid');
    }

    // 行客歇脚倒角木长凳（含横枨与落地四脚）
    const seatC = p(0.48, 0.34, -0.35);
    bakeChamferSlab(seatC[0], seatC[1], seatC[2], 0.98, 0.085, 0.42, rot, '#917352', '#7B5F42', 'int-solid', 0.04, 0.03);
    for (const lx of [0.14, 0.82]) {
      for (const lz of [-0.48, -0.22]) {
        const fp = p(lx, 0, lz);
        baker.beam([fp[0], sampleY(fp[0], fp[2]) - 0.10, fp[2]], [fp[0], y + 0.36, fp[2]], 0.038, '#5E4836', 0.034, 5, 'int-solid');
      }
      baker.beam(p(lx, 0.15, -0.48), p(lx, 0.15, -0.22), 0.024, '#6A513C', 0.024, 5, 'int-solid');
    }
    baker.beam(p(0.14, 0.15, -0.35), p(0.82, 0.15, -0.35), 0.026, '#6A513C', 0.026, 5, 'int-solid');

    const teaBlocker = { x, z, hw: 1.25, hd: 1.12, minY: y, maxY: y + 2.9, rot, source: 'outskirt-tea-shelter' };
    blockers.push(teaBlocker);
    shelters.push({
      id: 'outskirt-tea-shelter',
      kind: 'pavilion',
      x,
      y,
      z,
      rx: 1.38,
      rz: 1.25,
      rot,
      radius: 2.35,
      eaveY: y + eaveY,
      roofY: y + eaveY + 0.86
    });
    quietSpots.push({
      id: 'outskirt-tea-bench',
      name: '村口施茶草寮',
      x,
      z,
      radius: 2.4,
      seatY: y + 0.43,
      line: '才出山洞便逢施茶草寮，清茗微温，阡陌炊烟尽在眼前。',
      winterLine: '茅檐冰凌微垂，瓦瓮姜茗生烟，暖灯照雪迎归客',
      winterClearLine: '雪霁晴昼，茅檐冰棱叮咚滴水，瓦瓮姜茗暖香轻浮',
      winterNightLine: '冬夜灯暖，茅檐冰凌泛微光，一瓮陈桑姜茗迎远客'
    });
    targets.push({
      id: 'outskirt-tea-shelter',
      x,
      y: y + 1.35,
      z,
      range: 10,
      ownBlocker: teaBlocker,
      resolve: () => (interiorGroup.visible !== false ? { x, y: y + 1.35, z } : { x: NaN, y: NaN, z: NaN })
    });
  }

  function bakeFieldBarrow(pos, rot) {
    const { x, y, z } = pos;
    const p = (lx, ly, lz) => localPt(x, y, z, rot, lx, ly, lz);
    // 秦汉独轮木推车：真正竖立的 10 段木辋 6 辐条大木轮（前置轮轴 + 护轮挡板，与后载稻禾零穿模）
    const wx = 0.36, wy = 0.30, wR = 0.285;
    const wheelSegs = 10;
    for (let i = 0; i < wheelSegs; i++) {
      const a0 = (i / wheelSegs) * TAU;
      const a1 = ((i + 1) / wheelSegs) * TAU;
      baker.beam(
        p(wx + Math.cos(a0) * wR, wy + Math.sin(a0) * wR, 0),
        p(wx + Math.cos(a1) * wR, wy + Math.sin(a1) * wR, 0),
        0.026, '#5B4534', 0.026, 5, 'int-solid'
      );
    }
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * TAU;
      baker.beam(p(wx, wy, 0), p(wx + Math.cos(a) * (wR - 0.01), wy + Math.sin(a) * (wR - 0.01), 0), 0.017, '#7A5E44', 0.014, 5, 'int-solid');
    }
    // 轮毂与穿轴横木
    baker.beam(p(wx, wy, -0.095), p(wx, wy, 0.095), 0.068, '#4F3B2C', 0.068, 8, 'int-solid');
    baker.beam(p(wx, wy, -0.21), p(wx, wy, 0.21), 0.026, '#5F4936', 0.026, 6, 'int-solid');

    // 双辕推柄（前夹轮轴，后展握手）+ 接地支腿 + 横撑
    baker.beam(p(-0.88, 0.56, -0.27), p(0.66, 0.30, -0.17), 0.036, '#785D44', 0.030, 6, 'int-solid');
    baker.beam(p(-0.88, 0.56, 0.27), p(0.66, 0.30, 0.17), 0.036, '#785D44', 0.030, 6, 'int-solid');
    baker.beam(p(0.64, 0.30, -0.19), p(0.64, 0.30, 0.19), 0.028, '#6B523B', 0.028, 5, 'int-solid');
    baker.beam(p(-0.52, 0.50, -0.26), p(-0.52, 0.50, 0.26), 0.030, '#6B523B', 0.030, 5, 'int-solid');
    for (const sz of [-0.24, 0.24]) {
      const legP = p(-0.56, 0, sz);
      const ly = sampleY(legP[0], legP[2]);
      baker.beam([legP[0], ly - 0.06, legP[2]], p(-0.54, 0.50, sz), 0.034, '#664E39', 0.028, 5, 'int-solid');
    }
    baker.beam(p(-0.56, 0.18, -0.24), p(-0.56, 0.18, 0.24), 0.022, '#664E39', 0.022, 5, 'int-solid');

    // 载禾木车厢板、前护轮挡板与侧围栏（位于大轮后方，绝不与车轮穿插）
    baker.block(p(-0.24, 0.48, 0), [0.62, 0.052, 0.56], '#8B6F4E', [0, rot, -0.12], 'int-solid');
    baker.block(p(0.05, 0.58, 0), [0.045, 0.26, 0.54], '#785D44', [0, rot, -0.12], 'int-solid');
    for (const sz of [-0.27, 0.27]) {
      baker.beam(p(-0.52, 0.52, sz), p(-0.52, 0.72, sz), 0.022, '#735840', 0.020, 5, 'int-solid');
      baker.beam(p(0.04, 0.44, sz), p(0.04, 0.68, sz), 0.022, '#735840', 0.020, 5, 'int-solid');
      baker.beam(p(-0.54, 0.71, sz), p(0.06, 0.66, sz), 0.024, '#8A6D4C', 0.024, 5, 'int-solid');
    }
    // 车厢内三捆束腰金黄稻禾束（贴合木板与围栏，清晰可辨且与车轮完全分离）
    for (const [sx, sy, sz, yawOff] of [[-0.27, 0.60, -0.13, 0.08], [-0.25, 0.60, 0.13, -0.09], [-0.22, 0.74, 0.0, 0.04]]) {
      const sp = p(sx, sy, sz);
      const sheafGeo = new THREE.LatheGeometry([
        new THREE.Vector2(0.01, -0.26),
        new THREE.Vector2(0.105, -0.23),
        new THREE.Vector2(0.125, -0.10),
        new THREE.Vector2(0.082, 0.0),
        new THREE.Vector2(0.125, 0.11),
        new THREE.Vector2(0.098, 0.24),
        new THREE.Vector2(0.01, 0.27)
      ], 7);
      sheafGeo.rotateZ(Math.PI * 0.5);
      baker.add(sheafGeo, sp, [1, 1, 1], '#C8AE6B', [0, rot + yawOff, -0.12], 'int-solid');
      sheafGeo.dispose();
      baker.beam(p(sx - 0.022, sy, sz), p(sx + 0.022, sy, sz), 0.092, '#7B6342', 0.092, 7, 'int-solid');
    }

    // 田头丰润肩圆禾草垛（置于独轮车后侧留出明晰空隙，与车柄/车轮零穿模）
    const rickP = p(-0.35, 0, -2.10);
    const rx = rickP[0];
    const rz = rickP[2];
    const ry = sampleY(rx, rz);
    bakeLathe([rx, ry - 0.10, rz], [
      [0.74, 0], [0.80, 0.25], [0.86, 0.72], [0.82, 1.10],
      [0.64, 1.44], [0.38, 1.72], [0.16, 1.88], [0.04, 1.94]
    ], 11, '#C4A869', rot, 'int-solid');
    // 草垛顶盖草冠与中心立柱尖
    bakeLathe([rx, ry + 1.56, rz], [
      [0.44, 0], [0.34, 0.14], [0.18, 0.26], [0.06, 0.34]
    ], 10, '#D2B87A', rot + 0.3, 'int-solid');
    baker.beam([rx, ry + 1.80, rz], [rx, ry + 2.02, rz], 0.036, '#6E553D', 0.028, 6, 'int-solid');

    blockers.push({ x, z, hw: 0.95, hd: 0.65, minY: y, maxY: y + 1.1, rot, source: 'outskirt-wheelbarrow' });
    blockers.push({ x: rx, z: rz, hw: 0.78, hd: 0.78, minY: ry, maxY: ry + 1.9, rot: 0, source: 'outskirt-hayrick' });
  }

  function bakeWestMulberryStation(pos, rot) {
    const { x, y, z } = pos;
    const p = (lx, ly, lz) => localPt(x, y, z, rot, lx, ly, lz);
    // 西郊桑林竹晒架、双层圆竹匾（铺满鲜翠桑叶）与采桑高竹篓
    for (const sx of [-0.68, 0.68]) {
      const wp = p(sx, 0, 0);
      baker.beam([wp[0], sampleY(wp[0], wp[2]) - 0.12, wp[2]], [wp[0], y + 0.92, wp[2]], 0.042, '#7D8750', 0.038, 6, 'int-solid');
    }
    baker.beam(p(-0.76, 0.78, -0.22), p(0.76, 0.78, -0.22), 0.032, '#8E965B', 0.032, 6, 'int-solid');
    baker.beam(p(-0.76, 0.68, 0.24), p(0.76, 0.68, 0.24), 0.032, '#8E965B', 0.032, 6, 'int-solid');
    for (const tx of [-0.34, 0.34]) {
      baker.ring(p(tx, 0.74, 0), 0.32, 0.27, 0.05, '#BDA26E', 10, 'int-solid');
      baker.orb(p(tx, 0.76, 0), [0.26, 0.04, 0.26], '#588548', 'int-foliage', tx * 3);
    }
    const bx = p(0.95, 0, 0.32);
    const by = sampleY(bx[0], bx[2]);
    baker.beam([bx[0], by - 0.05, bx[2]], [bx[0], by + 0.56, bx[2]], 0.22, '#B59661', 0.26, 8, 'int-solid');
    baker.orb([bx[0], by + 0.56, bx[2]], [0.22, 0.09, 0.22], '#4E7D42', 'int-foliage', 4.1);
    blockers.push({ x, z, hw: 1.05, hd: 0.62, minY: y, maxY: y + 1.05, rot, source: 'outskirt-mulberry-rack' });
  }

  // ---- 1. 安置并烘焙山洞外（武陵溪岸与桃林）核心景物 ----
  const extCfg = config.exterior || {};
  let ferryPlaced = null;
  let ferryNetAnchor = null;
  let teaJarSteamAnchor = null;
  let extIcicleSpec = null;
  let intIcicleSpec = null;
  const lanternAnchors = [];
  if (extCfg.ferryPavilion) {
    const fp = findSafeExteriorPos(extCfg.ferryPavilion.anchor[0], extCfg.ferryPavilion.anchor[1], extCfg.ferryPavilion.radius);
    if (fp) {
      ferryPlaced = fp;
      reserve(fp.x, fp.z, extCfg.ferryPavilion.radius, 'ferry-pavilion');
      bakeFerryPavilion(fp, extCfg.ferryPavilion.rot || -0.4);
    }
  }

  if (extCfg.westBankFishery) {
    const wp = findSafeExteriorPos(extCfg.westBankFishery.anchor[0], extCfg.westBankFishery.anchor[1], extCfg.westBankFishery.radius);
    if (wp) {
      reserve(wp.x, wp.z, extCfg.westBankFishery.radius, 'west-fishery');
      bakeWestBankFishery(wp, extCfg.westBankFishery.rot || 0.48);
    }
  }

  // 互动古迹与人文小景（石碣、山樵歇脚台、村口施茶草寮）
  for (const spec of config.sites || []) {
    const pos = spec.zone === 'exterior'
      ? findSafeExteriorPos(spec.anchor[0], spec.anchor[1], spec.radius)
      : findSafeInteriorPos(spec.anchor[0], spec.anchor[1], spec.radius);
    if (!pos) continue;
    reserve(pos.x, pos.z, spec.radius, spec.id);
    if (spec.id === 'wuling-waystone') bakeWaystone(pos);
    else if (spec.id === 'woodcutter-rest') bakeWoodcutterRest(pos);
    else if (spec.id === 'entrance-tea-shelter') bakeEntranceTeaShelter(pos, 0.42);
    sites.push({
      id: spec.id,
      zone: spec.zone,
      name: spec.name,
      action: spec.action,
      soundKind: spec.soundKind || 'wood',
      line: spec.line,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      height: spec.height || 0.9,
      cooldown: 0
    });
  }

  // 临水垂柳
  for (const w of extCfg.willows || []) {
    const wp = findSafeExteriorPos(w.anchor[0], w.anchor[1], 1.35);
    if (wp) {
      reserve(wp.x, wp.z, 1.35, 'willow');
      bakeWeepingWillow(wp.x, wp.z, w.scale || 1.0, w.lean || -0.2, 'ext-solid', 'ext-foliage');
    }
  }

  // 溪谷翠竹丛、山茶蕨草丛与青苔卧石
  for (const [ax, az, sc] of extCfg.bambooClusters || []) {
    const bp = findSafeExteriorPos(ax, az, 0.95, az < 48);
    if (bp) {
      reserve(bp.x, bp.z, 0.85, 'ext-bamboo');
      bakeBambooCluster(bp.x, bp.z, sc || 1.0, 'ext-solid', 'ext-foliage');
    }
  }
  for (const [ax, az, sc, hasFlower] of extCfg.wildShrubs || []) {
    const sp = findSafeExteriorPos(ax, az, 0.72, az < 48);
    if (sp) {
      reserve(sp.x, sp.z, 0.65, 'ext-shrub');
      bakeWildShrub(sp.x, sp.z, sc || 1.0, Boolean(hasFlower), 'ext-foliage');
    }
  }
  for (const [ax, az, sc] of extCfg.mossBoulders || []) {
    const rp = findSafeExteriorPos(ax, az, 0.82, az < 48);
    if (rp) {
      reserve(rp.x, rp.z, 0.75, 'ext-rock');
      bakeMossBoulder(rp.x, rp.z, sc || 1.0, 'ext-solid', 'ext-foliage');
    }
  }

  // ---- 2. 安置并烘焙桃源村口与外郊核心景物 ----
  const intCfg = config.interior || {};
  if (intCfg.welcomingPine) {
    const pp = findSafeInteriorPos(intCfg.welcomingPine.anchor[0], intCfg.welcomingPine.anchor[1], intCfg.welcomingPine.radius);
    if (pp) {
      reserve(pp.x, pp.z, intCfg.welcomingPine.radius, 'welcoming-pine');
      bakeWelcomingPine(pp, intCfg.welcomingPine.rot || 0.35);
    }
  }
  if (intCfg.fieldBarrow) {
    const bp = findSafeInteriorPos(intCfg.fieldBarrow.anchor[0], intCfg.fieldBarrow.anchor[1], intCfg.fieldBarrow.radius);
    if (bp) {
      reserve(bp.x, bp.z, intCfg.fieldBarrow.radius, 'field-barrow');
      bakeFieldBarrow(bp, intCfg.fieldBarrow.rot || -0.55);
    }
  }
  if (intCfg.westMulberryStation) {
    const mp = findSafeInteriorPos(intCfg.westMulberryStation.anchor[0], intCfg.westMulberryStation.anchor[1], intCfg.westMulberryStation.radius);
    if (mp) {
      reserve(mp.x, mp.z, intCfg.westMulberryStation.radius, 'west-mulberry');
      bakeWestMulberryStation(mp, intCfg.westMulberryStation.rot || 0.62);
    }
  }
  for (const [ax, az, sc, hasFlower] of intCfg.outskirtRocksAndShrubs || []) {
    const op = findSafeInteriorPos(ax, az, 0.85);
    if (op) {
      reserve(op.x, op.z, 0.8, 'int-scatter');
      bakeMossBoulder(op.x, op.z, sc || 1.0, 'int-solid', 'int-foliage');
      bakeWildShrub(op.x + 0.55, op.z - 0.35, (sc || 1.0) * 0.9, Boolean(hasFlower), 'int-foliage');
    }
  }

  // ---- 3. 预定位武陵渡口系泊竹筏，并将系筏木桩与垂弧麻缆并入 ext-solid（零额外 draw call）----
  let raftInfo = null;
  let raftPlacement = null;
  if (riverCurve?.getPointAt) {
    // t = 0.452 位于武陵渡口正前方东岸浅滩（z ≈ 197.5，避开 z = 188 处已有扁舟系缆点）
    const rt = 0.452;
    const rCenter = riverCurve.getPointAt(rt);
    const rTan = riverCurve.getTangentAt(rt);
    // riverCurve 自南向北（tan.z < 0），东岸法向为 (-tan.z, +tan.x)
    const nx = -rTan.z;
    const nz = rTan.x;
    let rx = rCenter.x + nx * 6.4;
    let rz = rCenter.z + nz * 6.4;
    for (let d = 3.5; d <= 12.5; d += 0.45) {
      const tx = rCenter.x + nx * d;
      const tz = rCenter.z + nz * d;
      const ty = sampleY(tx, tz);
      if (ty > waterY - 0.72 && ty < waterY - 0.14) {
        rx = tx;
        rz = tz;
        break;
      }
    }
    const baseYaw = Math.atan2(rTan.x, rTan.z) + 0.18;
    // 临水系筏老杉木桩（靠东岸一侧）与五段垂弧系缆麻绳
    const stakeX = rx + nx * 1.48;
    const stakeZ = rz + nz * 1.48;
    const stakeBedY = sampleY(stakeX, stakeZ);
    const stakeTopY = Math.max(waterY + 0.72, stakeBedY + 0.78);
    baker.beam([stakeX, stakeBedY - 0.25, stakeZ], [stakeX, stakeTopY, stakeZ], 0.092, '#5E4735', 0.078, 7, 'ext-solid');
    baker.ring([stakeX, stakeTopY - 0.16, stakeZ], 0.102, 0.076, 0.075, '#A99568', 8, 'ext-solid');
    const prowX = rx + Math.sin(baseYaw) * 1.38;
    const prowZ = rz + Math.cos(baseYaw) * 1.38;
    const prowY = waterY + 0.21;
    const collarY = stakeTopY - 0.14;
    for (let seg = 0; seg < 5; seg++) {
      const u0 = seg / 5;
      const u1 = (seg + 1) / 5;
      const sag0 = Math.sin(u0 * Math.PI) * 0.14;
      const sag1 = Math.sin(u1 * Math.PI) * 0.14;
      baker.beam(
        [lerp(stakeX, prowX, u0), lerp(collarY, prowY, u0) - sag0, lerp(stakeZ, prowZ, u0)],
        [lerp(stakeX, prowX, u1), lerp(collarY, prowY, u1) - sag1, lerp(stakeZ, prowZ, u1)],
        0.015,
        '#B6A378',
        0.015,
        5,
        'ext-solid'
      );
    }
    raftPlacement = { x: rx, z: rz, stakeX, stakeZ, baseYaw };
  }

  // 生成合并后的静态低模批次（洞外 2 批次 + 村口外郊 2 批次）
  const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const foliageMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const staticMeshes = [];
  for (const [bName, parentGrp, mat] of [
    ['ext-solid', exteriorGroup, staticMat],
    ['ext-foliage', exteriorGroup, foliageMat],
    ['int-solid', interiorGroup, staticMat],
    ['int-foliage', interiorGroup, foliageMat]
  ]) {
    const m = baker.finish(bName, mat);
    if (m) {
      m.name = 'wuling-outskirts-' + bName;
      parentGrp.add(m);
      staticMeshes.push(m);
    }
  }
  baker.dispose();
  for (const g of rockTemplates) g.dispose();

  if (raftPlacement) {
    const built = buildBambooRaftMesh(waterY);
    built.mesh.position.set(raftPlacement.x, waterY + 0.02, raftPlacement.z);
    built.mesh.rotation.set(0, raftPlacement.baseYaw, 0);
    exteriorGroup.add(built.mesh);
    raftInfo = {
      mesh: built.mesh,
      mat: built.mat,
      lanternLocal: built.lanternLocal,
      x: raftPlacement.x,
      z: raftPlacement.z,
      stakeX: raftPlacement.stakeX,
      stakeZ: raftPlacement.stakeZ,
      baseY: waterY + 0.02,
      baseYaw: raftPlacement.baseYaw
    };
  }

  // ---- 3b. 武陵渡口随风微摆的晒网麻网（独立 1 draw call，位于 exteriorGroup 内）----
  let netInfo = null;
  if (ferryNetAnchor) {
    const builtNet = buildFerryNetMesh();
    builtNet.mesh.position.set(ferryNetAnchor.x, ferryNetAnchor.y, ferryNetAnchor.z);
    builtNet.mesh.rotation.set(0, ferryNetAnchor.rot, 0);
    exteriorGroup.add(builtNet.mesh);
    netInfo = {
      mesh: builtNet.mesh,
      mat: builtNet.mat,
      x: ferryNetAnchor.x,
      y: ferryNetAnchor.y,
      z: ferryNetAnchor.z,
      baseRotY: ferryNetAnchor.rot
    };
  }

  // ---- 3c. 暮夜/寒雪渔火与草寮暖灯（晴昼隐藏 0 draw call；暮/夜/大雪自动亮起微晕烛光）----
  const lanternCoreGeo = new THREE.CylinderGeometry(0.118, 0.108, 0.255, 6);
  const lanternGlowTex = createLanternGlowTexture();
  const lanterns = [];
  function createWarmLantern(spec, parentObj, localPos) {
    const coreMat = new THREE.MeshBasicMaterial({ color: '#FFCF7A', transparent: true, opacity: 0.94 });
    coreMat.userData.skyIgnore = true;
    const core = new THREE.Mesh(lanternCoreGeo, coreMat);
    core.name = spec.id + '-core';
    core.position.set(localPos[0], localPos[1], localPos[2]);
    core.scale.setScalar(spec.scale || 1.0);
    core.visible = false;
    parentObj.add(core);

    let glow = null;
    let glowMat = null;
    if (lanternGlowTex) {
      glowMat = new THREE.SpriteMaterial({
        map: lanternGlowTex,
        color: '#FFBF66',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      glowMat.userData.skyIgnore = true;
      glow = new THREE.Sprite(glowMat);
      glow.name = spec.id + '-glow';
      glow.position.set(localPos[0], localPos[1], localPos[2]);
      const gs = spec.glowScale || 2.0;
      glow.scale.set(gs, gs, 1);
      glow.renderOrder = 5;
      glow.visible = false;
      parentObj.add(glow);
    }
    lanterns.push({
      id: spec.id,
      zone: spec.zone,
      wx: spec.wx ?? localPos[0],
      wz: spec.wz ?? localPos[2],
      maxGlowDist: spec.maxGlowDist ?? (spec.zone === 'interior' ? 78 : 96),
      core,
      coreMat,
      glow,
      glowMat,
      baseGlowScale: spec.glowScale || 2.0,
      phase: spec.phase || 0
    });
  }
  for (const la of lanternAnchors) {
    createWarmLantern({ ...la, wx: la.x, wz: la.z }, la.zone === 'exterior' ? exteriorGroup : interiorGroup, [la.x, la.y, la.z]);
  }
  let raftWake = null;
  if (raftInfo?.mesh && raftInfo.lanternLocal) {
    createWarmLantern(
      { id: 'wuling-raft-lantern', zone: 'exterior', wx: raftInfo.x, wz: raftInfo.z, scale: 0.78, glowScale: 1.65, phase: 4.1 },
      raftInfo.mesh,
      raftInfo.lanternLocal
    );
    raftWake = createRaftWakeRipples(raftInfo, waterY);
    exteriorGroup.add(raftWake.mesh);
  }
  let lanternPower = 0;
  const _lanternDimCol = new THREE.Color('#D89C4E');
  const _lanternBrightCol = new THREE.Color('#FFE096');

  // ---- 3d. 冬日热茗蒸汽与近距寒天呵气白雾（分属洞外/村口双池，春夏秋晴昼 0 draw call）----
  const extSteam = createSteamCloud('wuling-outskirts-ext-steam', 24);
  const intSteam = createSteamCloud('wuling-outskirts-int-steam', 40);
  exteriorGroup.add(extSteam.points);
  interiorGroup.add(intSteam.points);
  let teaSteamBoost = 0;
  const _steamDayCol = new THREE.Color('#F3F5F2');
  const _steamWarmCol = new THREE.Color('#F7E4C4');
  const _steamNightCol = new THREE.Color('#B9C9D6');

  // ---- 3d2. 冬雪踏雪浅印（28 槽实例化衰减池）+ 中景山腰墨韵云带 + 冬寂檐角淡青小冰凌（春夏秋 0 draw call）----
  const snowFootprints = createSnowFootprintTrail(28);
  const cragCloudBelt = createCragCloudBelt(world);
  group.add(snowFootprints.mesh, cragCloudBelt.mesh);

  const icicleGrowUniform = { value: 0.52 };
  const icicleMat = new THREE.MeshLambertMaterial({
    color: '#D8EEF5',
    flatShading: true,
    transparent: true,
    opacity: 0.78
  });
  icicleMat.onBeforeCompile = function (shader) {
    shader.uniforms.uIcicleGrow = icicleGrowUniform;
    if (!shader.vertexShader.includes('aAnchorY')) {
      shader.vertexShader = 'attribute float aAnchorY;\nuniform float uIcicleGrow;\n' + shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.y = aAnchorY + (transformed.y - aAnchorY) * uIcicleGrow;'
        );
    }
  };
  chainProgramCacheKey(icicleMat, 'wuling-icicles-v1');

  const extIcicleLines = buildPavilionEaveLines(extIcicleSpec, 4);
  const teaIcicleLines = buildPavilionEaveLines(intIcicleSpec, 4);
  const cottageIcicles = buildVillageCottageEaveLines(existingHouses, world?.village?.houses?.overhang ?? 0.52);
  const villageIcicleHouses = cottageIcicles.houseCount;
  const intIcicleLines = teaIcicleLines.concat(cottageIcicles.lines);

  const extIcicleBuilt = buildIciclesCollection('wuling-ext-icicles', extIcicleLines, 91211, icicleMat);
  const intIcicleBuilt = buildIciclesCollection('wuling-int-icicles', intIcicleLines, 91217, icicleMat);
  const extIcicles = extIcicleBuilt.mesh;
  const intIcicles = intIcicleBuilt.mesh;
  if (extIcicles) exteriorGroup.add(extIcicles);
  if (intIcicles) interiorGroup.add(intIcicles);
  const thawDrips = createIcicleThawDrips(extIcicleBuilt.tips, intIcicleBuilt.tips, sampleY, 12);
  group.add(thawDrips.points);

  // ---- 3e. 渐进积雪材质钩子（降雪时长累积覆雪：渡口竹筏、茅亭、村口施茶寮与村中木桥）----
  let snowAccum = 0;
  const snowAccumUniform = { value: 0 };
  const snowHookRestorers = [];
  function hookProgressiveSnow(material, key) {
    const restore = attachProgressiveSnowMaterial(material, snowAccumUniform, key);
    if (restore) snowHookRestorers.push(restore);
  }
  hookProgressiveSnow(staticMat, 'wuling-prog-snow-static');
  if (raftInfo?.mat) hookProgressiveSnow(raftInfo.mat, 'wuling-prog-snow-raft');
  if (netInfo?.mat) hookProgressiveSnow(netInfo.mat, 'wuling-prog-snow-net');
  const lgSolid = leisureGrove?.group?.getObjectByName?.('leisure-grove-solid');
  if (lgSolid?.material) hookProgressiveSnow(lgSolid.material, 'wuling-prog-snow-bridge-lg');
  if (qianmoPaths?.solidMesh?.material) hookProgressiveSnow(qianmoPaths.solidMesh.material, 'wuling-prog-snow-bridge-qm');

  // ---- 4. 溪滩涉水白鹭（4 只，仅 2 次 InstancedMesh 绘制）----
  const egretSpecs = [];
  if (riverCurve?.getPointAt) {
    for (const eg of extCfg.egrets || []) {
      const pt = riverCurve.getPointAt(clamp(eg.streamT || 0.2, 0.04, 0.88));
      const tan = riverCurve.getTangentAt(clamp(eg.streamT || 0.2, 0.04, 0.88));
      const nx = tan.z * (eg.side || 1);
      const nz = -tan.x * (eg.side || 1);
      let bestX = pt.x + nx * (eg.offset || 2.3);
      let bestZ = pt.z + nz * (eg.offset || 2.3);
      for (let d = 3.5; d <= 15.5; d += 0.45) {
        const tx = pt.x + nx * d;
        const tz = pt.z + nz * d;
        const gy = sampleY(tx, tz);
        if (gy >= waterY - 0.24 && gy <= waterY + 0.14) {
          bestX = tx;
          bestZ = tz;
          break;
        }
      }
      const ey = Math.max(waterY - 0.16, sampleY(bestX, bestZ));
      egretSpecs.push({
        x: bestX,
        y: ey,
        z: bestZ,
        yaw: Math.atan2(-nx, -nz) + (rand() - 0.5) * 0.6,
        phase: eg.phase || 0,
        scale: 0.94 + rand() * 0.14
      });
    }
  }
  const { bodyGeo: egretBodyGeo, headGeo: egretHeadGeo } = buildEgretGeometries();
  const egretMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const egretBodyMesh = new THREE.InstancedMesh(egretBodyGeo, egretMat, Math.max(1, egretSpecs.length));
  const egretHeadMesh = new THREE.InstancedMesh(egretHeadGeo, egretMat, Math.max(1, egretSpecs.length));
  egretBodyMesh.name = 'wuling-outskirts-egret-body';
  egretHeadMesh.name = 'wuling-outskirts-egret-head';
  egretHeadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  egretBodyMesh.frustumCulled = true;
  egretHeadMesh.frustumCulled = true;
  egretBodyMesh.visible = egretSpecs.length > 0;
  egretHeadMesh.visible = egretSpecs.length > 0;
  exteriorGroup.add(egretBodyMesh, egretHeadMesh);

  const _egDummy = new THREE.Object3D();
  let egMinX = Infinity, egMinY = Infinity, egMinZ = Infinity;
  let egMaxX = -Infinity, egMaxY = -Infinity, egMaxZ = -Infinity;
  for (let i = 0; i < egretSpecs.length; i++) {
    const e = egretSpecs[i];
    if (e.x < egMinX) egMinX = e.x;
    if (e.x > egMaxX) egMaxX = e.x;
    if (e.y < egMinY) egMinY = e.y;
    if (e.y > egMaxY) egMaxY = e.y;
    if (e.z < egMinZ) egMinZ = e.z;
    if (e.z > egMaxZ) egMaxZ = e.z;
    _egDummy.position.set(e.x, e.y, e.z);
    _egDummy.rotation.set(0, e.yaw, 0);
    _egDummy.scale.setScalar(e.scale);
    _egDummy.updateMatrix();
    egretBodyMesh.setMatrixAt(i, _egDummy.matrix);
  }
  egretBodyMesh.instanceMatrix.needsUpdate = true;
  if (egretSpecs.length > 0) {
    const egCx = (egMinX + egMaxX) * 0.5;
    const egCy = (egMinY + egMaxY) * 0.5 + 0.6;
    const egCz = (egMinZ + egMaxZ) * 0.5;
    const egRad = Math.hypot(egMaxX - egMinX, egMaxY - egMinY, egMaxZ - egMinZ) * 0.5 + 2.2;
    egretBodyMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(egCx, egCy, egCz), egRad);
    egretHeadMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(egCx, egCy, egCz), egRad);
  }

  // ---- 4b. 武陵溪冬寂断续寒溪薄冰缘与近岸浮冰微片（1 静态合批，春夏秋 0 draw call）----
  const shoreIceMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: 0.70,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const shoreIceAvoid = [];
  for (const b of world?.boats?.boats || []) {
    if (Number.isFinite(b?.x) && Number.isFinite(b?.z)) {
      shoreIceAvoid.push({ x: b.x, z: b.z, r: 3.1 });
    }
  }
  if (raftPlacement) {
    shoreIceAvoid.push({ x: raftPlacement.x, z: raftPlacement.z, r: 2.55 });
  }
  for (const e of egretSpecs) {
    shoreIceAvoid.push({ x: e.x, z: e.z, r: 0.95 });
  }
  const shoreIceBuilt = buildCreekShoreIce(riverCurve, sampleY, waterY, shoreIceAvoid, shoreIceMat);
  const extShoreIce = shoreIceBuilt.mesh;
  if (extShoreIce) exteriorGroup.add(extShoreIce);

  // 注册武陵溪竹筏、涉水白鹭与冬寂限定寒溪薄冰缘至「识物（G）/ 游记图鉴（J）」
  if (raftInfo?.mesh) {
    targets.push({
      id: 'wuling-bamboo-raft',
      x: raftInfo.x,
      y: waterY + 0.45,
      z: raftInfo.z,
      range: 14,
      resolve: () => (
        exteriorGroup.visible !== false && raftInfo?.mesh
          ? { x: raftInfo.mesh.position.x, y: raftInfo.mesh.position.y + 0.45, z: raftInfo.mesh.position.z }
          : { x: NaN, y: NaN, z: NaN }
      )
    });
  }
  for (const e of egretSpecs) {
    targets.push({
      id: 'wuling-creek-egret',
      x: e.x,
      y: e.y + 0.52,
      z: e.z,
      range: 13,
      resolve: () => (exteriorGroup.visible !== false ? { x: e.x, y: e.y + 0.52, z: e.z } : { x: NaN, y: NaN, z: NaN })
    });
  }
  for (const a of shoreIceBuilt.anchors) {
    targets.push({
      id: 'wuling-shore-ice',
      x: a.x,
      y: a.y,
      z: a.z,
      range: 14,
      resolve: () => (extShoreIce?.visible && exteriorGroup.visible !== false ? { x: a.x, y: a.y, z: a.z } : { x: NaN, y: NaN, z: NaN })
    });
  }

  // ---- 5. 洞外与村口鲜活人物（分属 exteriorGroup 与 interiorGroup，严格服从门洞裁剪）----
  const exteriorRig = createCommunityActors(exteriorGroup, 4);
  const interiorRig = options.actorRig ? options.actorRig.createChannel(interiorGroup, 4) : createCommunityActors(interiorGroup, 4);
  const liveActors = [];

  for (let idx = 0; idx < (config.actors || []).length; idx++) {
    const ac = config.actors[idx];
    const finder = ac.zone === 'exterior' ? findSafeExteriorPos : findSafeInteriorPos;
    const home = finder(ac.anchor[0], ac.anchor[1], 0.85);
    if (!home) continue;

    // 校验巡游端点安全性，若受阻则退回原地驻足劳作
    const p0Off = ac.patrol?.[0] || [0, 0];
    const p1Off = ac.patrol?.[1] || [0, 0];
    const wp0 = finder(home.x + p0Off[0], home.z + p0Off[1], 0.65) || home;
    const wp1 = finder(home.x + p1Off[0], home.z + p1Off[1], 0.65) || home;

    liveActors.push({
      index: idx + 2,
      id: ac.id,
      zone: ac.zone,
      role: ac.role,
      voiceRole: ac.voiceRole || 'farmer',
      kind: ac.kind || 'adult',
      name: ac.name,
      prompt: ac.prompt || ('与' + ac.name + '交谈'),
      hat: Boolean(ac.hat),
      female: Boolean(ac.female),
      activity: ac.activity || 'idle',
      homeX: home.x,
      homeZ: home.z,
      wpA: [wp0.x, wp0.z],
      wpB: [wp1.x, wp1.z],
      x: home.x,
      y: home.y,
      z: home.z,
      yaw: ac.yaw || 0,
      baseYaw: ac.yaw || 0,
      phase: idx * 1.73 + 0.4,
      greetTimer: 0,
      greetTargetYaw: ac.yaw || 0
    });
  }

  // 预分配姿态对象（update 零 GC 分配）
  const _pose = {
    walk: 0,
    crouch: 0,
    lean: 0,
    nod: 0,
    headTurn: 0,
    left: [-0.22, 0.92, 0.16],
    right: [0.22, 0.92, 0.16]
  };

  let egretsTucked = false;
  let actorsResting = false;

  function updateEgretPose(t, timeId = 'day', rainAmt = 0) {
    if (!egretSpecs.length) return;
    const resting = timeId === 'night' || rainAmt > 0.28;
    egretsTucked = resting;
    for (let i = 0; i < egretSpecs.length; i++) {
      const e = egretSpecs[i];
      let dip = 0;
      let turn = 0;
      if (resting) {
        // 入夜或雨急时缩颈静立水岸避风栖息，不再深夜俯喙啄水
        dip = 0.52;
        turn = 0;
      } else {
        const cyc = (t * 0.52 + e.phase) % 6.0;
        // 偶有俯颈轻啄浅水涟漪，其余时间悠然顾盼
        if (cyc > 4.2 && cyc < 5.3) {
          dip = Math.sin(((cyc - 4.2) / 1.1) * Math.PI) * 0.78;
        }
        turn = Math.sin(t * 0.75 + e.phase * 1.3) * 0.32 * (1 - dip * 0.7);
      }
      const chestX = e.x + Math.sin(e.yaw) * 0.08 * e.scale;
      const chestZ = e.z + Math.cos(e.yaw) * 0.08 * e.scale;
      const chestY = e.y + (resting ? 0.39 : 0.41) * e.scale;
      _egDummy.position.set(chestX, chestY, chestZ);
      _egDummy.rotation.set(dip, e.yaw + turn, 0);
      _egDummy.scale.setScalar(e.scale);
      _egDummy.updateMatrix();
      egretHeadMesh.setMatrixAt(i, _egDummy.matrix);
    }
    egretHeadMesh.instanceMatrix.needsUpdate = true;
  }

  function renderActorZone(rig, zoneId, t, step, wetWeather, playerState, isNight = false) {
    rig.begin();
    for (let i = 0; i < liveActors.length; i++) {
      const a = liveActors[i];
      if (a.zone !== zoneId) continue;

      if (a.greetTimer > 0 && step > 0) {
        a.greetTimer = Math.max(0, a.greetTimer - step);
      }

      // 慢速往返踱步 + 驻足劳作循环；入夜后守灯静息不再暗中往返踱步，与玩家交谈时转身相迎
      const span = Math.hypot(a.wpB[0] - a.wpA[0], a.wpB[1] - a.wpA[1]);
      let walkAmp = 0;
      if (a.greetTimer > 0) {
        if (playerState) {
          a.greetTargetYaw = Math.atan2(playerState.x - a.x, playerState.z - a.z);
        }
        a.yaw += wrapAngle(a.greetTargetYaw - a.yaw) * Math.min(1, (step || 0.016) * 7.5);
      } else if (span > 0.35 && !wetWeather && !isNight) {
        const period = 16.0;
        const u = ((t + a.phase * 2.3) % period) / period;
        let travel = 0;
        let moving = 0;
        if (u < 0.30) {
          travel = u / 0.30;
          moving = 1;
        } else if (u < 0.50) {
          travel = 1;
          moving = 0;
        } else if (u < 0.80) {
          travel = 1 - (u - 0.50) / 0.30;
          moving = -1;
        } else {
          travel = 0;
          moving = 0;
        }
        const smoothU = travel * travel * (3 - 2 * travel);
        const nx = lerp(a.wpA[0], a.wpB[0], smoothU);
        const nz = lerp(a.wpA[1], a.wpB[1], smoothU);
        a.x = nx;
        a.z = nz;
        a.y = sampleY(nx, nz);
        if (moving !== 0) {
          const dirYaw = moving > 0
            ? Math.atan2(a.wpB[0] - a.wpA[0], a.wpB[1] - a.wpA[1])
            : Math.atan2(a.wpA[0] - a.wpB[0], a.wpA[1] - a.wpB[1]);
          a.yaw += wrapAngle(dirYaw - a.yaw) * Math.min(1, (step || 0.016) * 5.0);
          walkAmp = Math.sin(t * 4.4 + a.phase) * 0.82;
        } else {
          a.yaw += wrapAngle(a.baseYaw - a.yaw) * Math.min(1, (step || 0.016) * 3.5);
        }
      } else {
        a.x = a.homeX;
        a.z = a.homeZ;
        a.y = sampleY(a.x, a.z);
        a.yaw += wrapAngle(a.baseYaw - a.yaw) * Math.min(1, (step || 0.016) * 3.5);
      }

      // 若玩家走近（< 5.8m），自然侧首温和致意；远于 92m 的遮挡外围人物不提交渲染批次
      let nearTurn = 0;
      let nearWave = 0;
      if (playerState) {
        const dp = Math.hypot(playerState.x - a.x, playerState.z - a.z);
        if (dp > 92) continue;
        if (dp < 5.8) {
          const toPlayer = wrapAngle(Math.atan2(playerState.x - a.x, playerState.z - a.z) - a.yaw);
          nearTurn = clamp(toPlayer * 0.55, -0.52, 0.52);
          if (a.activity === 'tea' && dp < 5.2) nearWave = 1;
        }
      }

      _pose.walk = walkAmp;
      _pose.crouch = 0;
      _pose.lean = isNight ? 0.02 : 0.04;
      _pose.nod = a.greetTimer > 0
        ? Math.sin(t * 5.2) * 0.11 + 0.08
        : (isNight ? Math.sin(t * 0.9 + a.phase) * 0.024 : Math.sin(t * 1.5 + a.phase) * 0.05);
      _pose.headTurn = nearTurn + (isNight ? Math.sin(t * 0.45 + a.phase) * 0.055 : Math.sin(t * 0.9 + a.phase) * 0.14);

      const sw = isNight ? Math.sin(t * 0.9 + a.phase) * 0.25 : Math.sin(t * 2.2 + a.phase);
      if (wetWeather) {
        // 雨雪天执油纸伞遮护
        _pose.left[0] = -0.18; _pose.left[1] = 0.96; _pose.left[2] = 0.14;
        _pose.right[0] = 0.14; _pose.right[1] = 1.18; _pose.right[2] = 0.22;
      } else if (a.activity === 'net') {
        _pose.lean = 0.08;
        _pose.left[0] = -0.18; _pose.left[1] = 0.98 + sw * 0.05; _pose.left[2] = 0.28;
        _pose.right[0] = 0.18; _pose.right[1] = 0.94 - sw * 0.06; _pose.right[2] = 0.30 + sw * 0.04;
      } else if (a.activity === 'firewood') {
        _pose.lean = 0.06;
        _pose.left[0] = -0.24; _pose.left[1] = 1.06; _pose.left[2] = 0.14;
        _pose.right[0] = 0.24; _pose.right[1] = 0.92 - walkAmp * 0.06; _pose.right[2] = 0.16 + walkAmp * 0.08;
      } else if (a.activity === 'herb') {
        const stoop = walkAmp === 0 ? Math.max(0, Math.sin(t * 0.85 + a.phase)) * 0.36 : 0;
        _pose.crouch = stoop;
        _pose.lean = 0.05 + stoop * 0.32;
        _pose.left[0] = -0.22; _pose.left[1] = 0.92 - stoop * 0.22; _pose.left[2] = 0.20;
        _pose.right[0] = 0.16; _pose.right[1] = 0.88 - stoop * 0.38; _pose.right[2] = 0.28 + stoop * 0.10;
      } else if (a.activity === 'tea') {
        _pose.left[0] = -0.16; _pose.left[1] = 0.96; _pose.left[2] = 0.24;
        if (nearWave || a.greetTimer > 0) {
          _pose.right[0] = 0.24; _pose.right[1] = 1.26 + Math.sin(t * 4.2) * 0.06; _pose.right[2] = 0.22;
        } else {
          _pose.right[0] = 0.16; _pose.right[1] = 0.96; _pose.right[2] = 0.24;
        }
      } else if (a.activity === 'hoe') {
        _pose.lean = 0.07;
        _pose.left[0] = 0.08; _pose.left[1] = 0.98; _pose.left[2] = 0.26;
        _pose.right[0] = 0.22; _pose.right[1] = 0.86 + sw * 0.04; _pose.right[2] = 0.28;
      } else {
        // basket (采桑妇)
        _pose.left[0] = -0.23; _pose.left[1] = 0.94; _pose.left[2] = 0.20;
        _pose.right[0] = 0.18; _pose.right[1] = 1.04 + sw * 0.08; _pose.right[2] = 0.26;
      }

      rig.actor(a.x, a.y, a.z, a.yaw, 1.0);
      rig.human(a, _pose);

      // 斗笠与随身劳作器具（共享 community-actors 批次，零新增材质）
      if (a.hat) {
        const shoulder = 1.34 - _pose.crouch * 0.38;
        rig.part('hat', [_pose.headTurn * 0.02, shoulder + 0.24, _pose.lean * 0.6 + 0.02], [1.05, 1.05, 1.05], 0xffffff, [_pose.nod, _pose.headTurn, 0]);
      }
      if (wetWeather) {
        // 油纸竹伞
        rig.segment('taper', [0.14, 1.02, 0.20], [0.14, 1.86, 0.20], 0.022, 0.022, 0x7c6344);
        rig.part('cone', [0.14, 1.88, 0.20], [0.62, 0.22, 0.62], 0xd8c69c);
      } else if (a.activity === 'net') {
        rig.part('box', [0.18, 0.94 - sw * 0.06, 0.34], [0.04, 0.03, 0.22], 0xb89a64);
      } else if (a.activity === 'firewood') {
        rig.segment('taper', [-0.46, 1.24, 0.04], [0.36, 1.18, 0.12], 0.028, 0.028, 0x8e9858);
      } else if (a.activity === 'herb' || a.activity === 'basket') {
        const by = _pose.left[1] - 0.14;
        rig.part('taper', [-0.26, by, 0.20], [0.15, 0.20, 0.15], 0xb2935e);
        rig.part('round', [-0.26, by + 0.09, 0.20], [0.13, 0.05, 0.13], 0x578348);
      } else if (a.activity === 'tea') {
        rig.part('taper', [-0.16, 0.98, 0.27], [0.065, 0.075, 0.065], 0xcabaa0);
      } else if (a.activity === 'hoe') {
        rig.segment('taper', [0.24, 0.06, 0.34], [0.06, 1.26, 0.22], 0.026, 0.026, 0x6f563d);
        rig.part('box', [0.24, 0.07, 0.40], [0.14, 0.04, 0.12], 0x585d5e);
      }
    }
    rig.finish();
  }

  // 初始静帧构建，保证首帧人物与白鹭即刻就位
  let simTime = 0;
  updateEgretPose(0);
  renderActorZone(exteriorRig, 'exterior', 0, 0, false, null);
  renderActorZone(interiorRig, 'interior', 0, 0, false, null);

  // ---- 6. 可逆四时物候快照（春深精确字节还原）----
  let snapshotted = false;
  let currentPhenology = 'spring';
  const colorSnaps = [];
  const SNOW_ROOF = new THREE.Color('#E8E6DE');
  const SNOW_GROUND = new THREE.Color('#EAE8E0');
  const AUTUMN_WILLOW = new THREE.Color('#D8A944');
  const AUTUMN_SHRUB = new THREE.Color('#C86836');

  function ensurePhenologySnaps() {
    if (snapshotted) return;
    snapshotted = true;
    for (const m of staticMeshes) {
      if (m?.geometry?.attributes?.color) {
        colorSnaps.push({
          name: m.name,
          geo: m.geometry,
          colors: new Float32Array(m.geometry.attributes.color.array)
        });
      }
    }
    if (raftInfo?.mesh?.geometry?.attributes?.color) {
      colorSnaps.push({
        name: raftInfo.mesh.name,
        geo: raftInfo.mesh.geometry,
        colors: new Float32Array(raftInfo.mesh.geometry.attributes.color.array)
      });
    }
    if (netInfo?.mesh?.geometry?.attributes?.color) {
      colorSnaps.push({
        name: netInfo.mesh.name,
        geo: netInfo.mesh.geometry,
        colors: new Float32Array(netInfo.mesh.geometry.attributes.color.array)
      });
    }
  }

  function setPhenology(id) {
    if (!id) return;
    const isWin = id === 'winter';
    if (extIcicles) extIcicles.visible = isWin;
    if (intIcicles) intIcicles.visible = isWin;
    if (extShoreIce) extShoreIce.visible = isWin;
    if (isWin) {
      icicleGrowUniform.value = 0.52 + 0.48 * snowAccum;
      shoreIceMat.opacity = 0.56 + 0.26 * snowAccum;
    } else {
      snowAccum = 0;
      snowAccumUniform.value = 0;
      icicleGrowUniform.value = 0.52;
      snowFootprints.clear();
      thawDrips.clear();
      icicleMat.emissive.setRGB(0, 0, 0);
      shoreIceMat.opacity = 0.62;
      shoreIceMat.emissive.setRGB(0, 0, 0);
    }
    if (id === 'spring' && !snapshotted) {
      currentPhenology = 'spring';
      return;
    }
    ensurePhenologySnaps();
    currentPhenology = id;

    if (id === 'spring') {
      for (const s of colorSnaps) {
        s.geo.attributes.color.array.set(s.colors);
        s.geo.attributes.color.needsUpdate = true;
      }
      return;
    }

    for (const s of colorSnaps) {
      const dst = s.geo.attributes.color.array;
      const src = s.colors;
      const nor = s.geo.attributes.normal?.array;
      const isFoliage = s.name.endsWith('-foliage');
      for (let i = 0; i < src.length; i += 3) {
        const sr = src[i], sg = src[i + 1], sb = src[i + 2];
        const ny = nor ? nor[i + 1] : 0.5;
        const isCamelliaBloom = isFoliage && sr > sg + 0.16 && sr > 0.45;
        if (id === 'winter') {
          if (isCamelliaBloom) {
            // 寒冬山茶傲雪微绽，保留胭脂红点缀素白溪谷
            dst[i] = clamp(sr * 1.05, 0, 1);
            dst[i + 1] = sg * 0.92;
            dst[i + 2] = sb * 0.95;
          } else if (isFoliage) {
            const f = ny > 0.15 ? 0.54 * clamp(ny, 0.25, 1) : 0.26;
            dst[i] = lerp(sr, SNOW_GROUND.r, f);
            dst[i + 1] = lerp(sg, SNOW_GROUND.g, f);
            dst[i + 2] = lerp(sb, SNOW_GROUND.b, f);
          } else if (ny > 0.38) {
            const f = 0.58 * clamp((ny - 0.30) / 0.70, 0, 1);
            dst[i] = lerp(sr, SNOW_ROOF.r, f);
            dst[i + 1] = lerp(sg, SNOW_ROOF.g, f);
            dst[i + 2] = lerp(sb, SNOW_ROOF.b, f);
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        } else if (id === 'summer') {
          if (isFoliage && !isCamelliaBloom) {
            dst[i] = sr * 0.70;
            dst[i + 1] = clamp(sg * 1.08, 0, 1);
            dst[i + 2] = sb * 0.76;
          } else if (isCamelliaBloom) {
            // 夏初春茶谢尽化作深绿新叶
            dst[i] = 0.11; dst[i + 1] = 0.28; dst[i + 2] = 0.10;
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        } else {
          // autumn: 垂柳染鹅黄霜金，灌丛带暖赭，古松翠竹苍劲留青
          if (isCamelliaBloom) {
            dst[i] = AUTUMN_SHRUB.r; dst[i + 1] = AUTUMN_SHRUB.g; dst[i + 2] = AUTUMN_SHRUB.b;
          } else if (isFoliage && sg > 0.24 && sr > 0.12) {
            const lum = clamp((0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / 0.28, 0.75, 1.22);
            dst[i] = clamp(AUTUMN_WILLOW.r * lum, 0, 1);
            dst[i + 1] = clamp(AUTUMN_WILLOW.g * lum, 0, 1);
            dst[i + 2] = clamp(AUTUMN_WILLOW.b * lum, 0, 1);
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        }
      }
      s.geo.attributes.color.needsUpdate = true;
    }
  }

  // ---- 7. 互动绑定（石碣、歇脚台、施茶瓮 + 人物交谈致意）----
  let noteEl = null;
  let boundJournal = null;
  let noteTimer = 0;
  let lastTimeId = 'day';
  let lastSnowAmt = 0;
  let disposed = false;

  function triggerSite(site, sound, doc) {
    if (!site || disposed) return null;
    site.cooldown = 1.2;
    if (site.id === 'entrance-tea-shelter') {
      teaSteamBoost = 1.0;
      boundJournal?.observe?.('outskirt-tea-shelter');
    }
    let displayLine = site.line;
    if (currentPhenology === 'winter') {
      if (site.id === 'entrance-tea-shelter') {
        if (lastSnowAmt > 0.20) {
          displayLine = '朔雪寒深，施茶瓦瓮内滚热温着陈桑姜茗，掬饮一口热香扑面，茅檐暖灯与淡青冰凌下顿时寒意尽消。';
        } else if (lastTimeId === 'night' || lastTimeId === 'dusk') {
          displayLine = '冬夜灯暖，瓦瓮内陈桑姜茗热气袅袅，掬饮一口驱尽山风寒意，草寮檐角淡青冰凌在灯晕中微泛晶光。';
        } else {
          displayLine = '雪霁晴昼，茅檐冰凌正叮咚化水，瓦瓮内陈桑姜茗温润生香，掬饮一碗「雪村暖茗」，周身暖意融融。';
        }
      } else if (site.id === 'wuling-waystone') {
        displayLine = '青石古碣覆着一层薄雪，拂去霜屑仍辨「武陵」二字；寒溪浅滩凝起断续薄冰，芦苇含霜，水声自雪覆桃林深处潺潺而来。';
      } else if (site.id === 'woodcutter-rest') {
        displayLine = '苍苔石台落满干雪，青竹扁担与松柴束皆覆薄霜；坐歇片刻，可见寒溪岸冰映雪、远峰云岚缓移，山林静寂如画。';
      }
    }
    const el = noteEl || doc?.getElementById?.('mystery-note');
    if (el) {
      el.textContent = displayLine;
      el.hidden = false;
      el.classList?.add?.('is-open');
      noteTimer = 5.4;
    }
    try {
      if (site.soundKind === 'water') (sound?.waterCup || sound?.gurgle)?.call(sound, site.x, site.z);
      else sound?.wood?.(site.x, site.z);
    } catch (_) { /* noop */ }
    return { id: site.id, name: site.name, line: displayLine };
  }

  function pickOutskirtSite(camera, playerState, cfg = {}) {
    if (disposed || !playerState) return null;
    const third = playerState.view === 'third';
    const eyeX = third ? playerState.x : camera.position.x;
    const eyeY = third ? playerState.y + (playerState.eyeHeight || 1.62) : camera.position.y;
    const eyeZ = third ? playerState.z : camera.position.z;
    const cp = Math.cos(playerState.pitch || 0);
    const fx = -Math.sin(playerState.yaw || 0) * cp;
    const fy = Math.sin(playerState.pitch || 0);
    const fz = -Math.cos(playerState.yaw || 0) * cp;
    let best = null;
    for (const s of sites) {
      if (s.zone === 'exterior' && exteriorGroup.visible === false) continue;
      if (s.zone === 'interior' && interiorGroup.visible === false) continue;
      if (s.cooldown > 0) continue;
      const distXZ = Math.hypot(s.x - playerState.x, s.z - playerState.z);
      if (distXZ > 4.0) continue;
      const ty = s.y + s.height;
      const dx = s.x - eyeX, dy = ty - eyeY, dz = s.z - eyeZ;
      const dist = Math.hypot(dx, dy, dz);
      const dot = (dx * fx + dy * fy + dz * fz) / (dist || 1);
      if (distXZ > 2.2 && dot < 0.70) continue;
      const score = dist + (1 - dot) * (cfg.alignBias || 2.5);
      if (!best || score < best.score) {
        best = {
          kind: 'mystery',
          key: 'outskirt:' + s.id,
          id: s.id,
          isWulingOutskirt: true,
          name: s.name,
          label: s.name,
          prompt: s.action + ' · ' + s.name,
          x: s.x,
          y: ty,
          z: s.z,
          dist,
          dot,
          score
        };
      }
    }
    return best;
  }

  function bind({ mysteries, sound, player, doc, journal } = {}) {
    noteEl = doc?.getElementById?.('mystery-note') || null;
    if (journal) boundJournal = journal;
    if (!mysteries || mysteries._wulingOutskirtsBound) return;
    mysteries._wulingOutskirtsBound = true;
    const prevPick = mysteries.pickTarget;
    const prevInteract = mysteries.interact;
    const prevHide = mysteries.hide;

    mysteries.pickTarget = function (camera, cfg) {
      const a = prevPick?.(camera, cfg) || null;
      const b = pickOutskirtSite(camera, player?.state, cfg);
      if (!a) return b;
      if (!b) return a;
      return b.score < a.score ? b : a;
    };

    mysteries.interact = function (target) {
      if (target?.isWulingOutskirt) {
        const s = sites.find(item => item.id === target.id);
        return triggerSite(s, sound, doc);
      }
      return prevInteract?.(target) || null;
    };

    mysteries.hide = function () {
      noteTimer = 0;
      prevHide?.();
    };
  }

  function interactById(id, sound, doc) {
    const s = sites.find(item => item.id === id);
    return triggerSite(s, sound, doc);
  }

  const interactableList = liveActors.map(a => ({
    id: a.id,
    role: a.role,
    voiceRole: a.voiceRole,
    name: a.name,
    prompt: a.prompt,
    x: a.x,
    y: a.y,
    z: a.z,
    radius: 3.5,
    eyeY: 1.56,
    active: true
  }));

  function getInteractables() {
    for (let i = 0; i < liveActors.length; i++) {
      const a = liveActors[i];
      const item = interactableList[i];
      item.x = a.x;
      item.y = a.y;
      item.z = a.z;
      item.active = a.zone === 'exterior' ? exteriorGroup.visible !== false : interiorGroup.visible !== false;
    }
    return interactableList;
  }

  function greet(id, playerState) {
    const a = liveActors.find(item => item.id === id);
    if (!a) return false;
    a.greetTimer = 4.2;
    if (playerState) {
      a.greetTargetYaw = Math.atan2(playerState.x - a.x, playerState.z - a.z);
    }
    return true;
  }

  let raftKnockTimer = 4.2;
  let netRustleTimer = 5.6;
  const pendingEvents = [];
  const EMPTY_EVENTS = Object.freeze([]);

  function consumeEvents() {
    if (pendingEvents.length === 0) return EMPTY_EVENTS;
    const out = pendingEvents.slice();
    pendingEvents.length = 0;
    return out;
  }

  function update(dt, elapsed, sky, playerState) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(0.1, dt);
    simTime += step;

    for (let i = 0; i < sites.length; i++) {
      if (sites[i].cooldown > 0) sites[i].cooldown = Math.max(0, sites[i].cooldown - step);
    }
    if (noteTimer > 0) {
      noteTimer -= step;
      if (noteTimer <= 0 && noteEl) {
        noteEl.classList?.remove?.('is-open');
        noteEl.hidden = true;
      }
    }

    const rainAmt = Number(sky?.rainIntensity) || 0;
    const snowAmt = Number(sky?.snowIntensity) || 0;
    const windAmt = clamp(Number(sky?.wind ?? 0.55), 0.15, 2.2);
    const wetWeather = rainAmt > 0.25 || snowAmt > 0.25;

    // 降雪渐进覆雪积累：冬日下雪时约 22 秒渐厚至满层；雪歇后缓融至薄霜，离冬即清零
    if (currentPhenology === 'winter') {
      if (snowAmt > 0.12) {
        snowAccum = Math.min(1, snowAccum + step * (0.045 * snowAmt));
      } else if (snowAccum > 0.18) {
        snowAccum = Math.max(0.18, snowAccum - step * 0.022);
      }
    } else if (snowAccum > 0) {
      snowAccum = 0;
    }
    snowAccumUniform.value = snowAccum;

    // 渡口渔火与施茶草寮暖灯：暮/夜明亮、晨微亮、冬雪/阴雨柔和亮起，晴昼完全隐藏零开销
    const timeId = sky?.timeId || 'day';
    lastTimeId = timeId;
    lastSnowAmt = snowAmt;
    let targetLantern = 0;
    if (timeId === 'night') targetLantern = 1.0;
    else if (timeId === 'dusk') targetLantern = 0.88;
    else if (timeId === 'dawn') targetLantern = 0.42;
    if (snowAmt > 0.20) targetLantern = Math.max(targetLantern, 0.58 * clamp(snowAmt, 0, 1));
    if (rainAmt > 0.35) targetLantern = Math.max(targetLantern, 0.36 * clamp(rainAmt, 0, 1));
    lanternPower += (targetLantern - lanternPower) * (1 - Math.exp(-step * 2.8));
    if (lanternPower < 0.004 && targetLantern === 0) lanternPower = 0;
    const showLanterns = lanternPower > 0.02;
    for (let i = 0; i < lanterns.length; i++) {
      const l = lanterns[i];
      const zoneVis = l.zone === 'exterior' ? exteriorGroup.visible !== false : interiorGroup.visible !== false;
      const lit = showLanterns && zoneVis;
      const nearGlow = !playerState || Math.hypot(playerState.x - l.wx, playerState.z - l.wz) <= l.maxGlowDist;
      l.core.visible = lit;
      if (l.glow) l.glow.visible = lit && nearGlow;
      if (lit) {
        const flicker = 1 + Math.sin(simTime * 5.1 + l.phase) * 0.045 + Math.sin(simTime * 8.9 + l.phase * 1.7) * 0.025;
        const pwr = clamp(lanternPower * flicker, 0, 1.08);
        l.coreMat.color.copy(_lanternDimCol).lerp(_lanternBrightCol, clamp(pwr, 0, 1));
        l.coreMat.opacity = clamp(0.45 + pwr * 0.52, 0, 0.98);
        if (l.glow && l.glowMat && l.glow.visible) {
          l.glowMat.opacity = clamp(pwr * (timeId === 'night' ? 0.68 : 0.52), 0, 0.78);
          const gs = l.baseGlowScale * (0.86 + 0.18 * clamp(pwr, 0, 1));
          l.glow.scale.set(gs, gs, 1);
        }
      }
    }

    if (exteriorGroup.visible !== false) {
      if (raftInfo?.mesh) {
        const waveY = Math.sin(simTime * 1.45) * 0.026;
        const rollWave = Math.sin(simTime * 1.12 + 0.6);
        raftInfo.mesh.position.y = raftInfo.baseY + waveY;
        raftInfo.mesh.rotation.z = rollWave * (0.020 + windAmt * 0.008);
        raftInfo.mesh.rotation.x = Math.cos(simTime * 0.95) * (0.013 + windAmt * 0.005);

        const raftDist = playerState ? Math.hypot(playerState.x - raftInfo.x, playerState.z - raftInfo.z) : 0;
        // 靠近武陵渡口时，随竹筏摇摆波峰偶发「竹筏轻磕木桩」空间微响并同步荡开水墨余波
        if (playerState && raftDist < 24) {
          raftKnockTimer -= step;
          if (raftKnockTimer <= 0 && Math.abs(rollWave) > 0.84) {
            raftKnockTimer = 6.8 + ((Math.sin(simTime * 3.1) * 0.5 + 0.5) * 4.8);
            raftWake?.triggerKnock();
            pendingEvents.push({
              type: 'raftKnock',
              x: raftInfo.stakeX,
              z: raftInfo.stakeZ,
              intensity: clamp(0.48 + windAmt * 0.24, 0.4, 0.95)
            });
          }
        }
        raftWake?.update(step, windAmt, timeId, currentPhenology === 'winter', lanternPower, raftDist < 44);
      }
      if (netInfo?.mesh) {
        // 晒网麻网绕顶竹横杆随微风轻柔摆荡
        const swayAmp = 0.024 + clamp(windAmt - 0.3, 0, 1.8) * 0.046;
        const sway = Math.sin(simTime * 1.32 + 0.4) * swayAmp + Math.sin(simTime * 2.55 + 1.7) * swayAmp * 0.34;
        netInfo.mesh.rotation.z = sway;

        if (playerState && windAmt > 0.28 && Math.hypot(playerState.x - netInfo.x, playerState.z - netInfo.z) < 22) {
          netRustleTimer -= step * (0.75 + windAmt * 0.45);
          if (netRustleTimer <= 0 && Math.abs(sway) > swayAmp * 0.65) {
            netRustleTimer = 7.8 + ((Math.cos(simTime * 2.7) * 0.5 + 0.5) * 5.2);
            pendingEvents.push({
              type: 'netRustle',
              x: netInfo.x,
              z: netInfo.z,
              intensity: clamp(0.42 + windAmt * 0.28, 0.35, 0.95)
            });
          }
        }
      }
      const isDeepNight = timeId === 'night';
      actorsResting = isDeepNight;
      updateEgretPose(simTime, timeId, rainAmt);
      renderActorZone(exteriorRig, 'exterior', simTime, step, wetWeather, playerState, isDeepNight);
    }

    if (interiorGroup.visible !== false) {
      const isDeepNight = timeId === 'night';
      actorsResting = isDeepNight;
      renderActorZone(interiorRig, 'interior', simTime, step, wetWeather, playerState, isDeepNight);
    }

    // 冬日施茶瓦瓮热茗白气 + 寒天近距人物微弱呵气（零分配、门洞隔离、晴暖昼隐藏）
    if (teaSteamBoost > 0) {
      teaSteamBoost = Math.max(0, teaSteamBoost - step * 0.28);
    }
    const windX = Number(sky?.windX) || 0.10;
    const windZ = Number(sky?.windZ) || 0.05;
    const isWinter = currentPhenology === 'winter';
    const isCoolLight = timeId === 'dawn' || timeId === 'dusk' || timeId === 'night';

    // 1) 洞外人物冬日寒天呵气
    extSteam.reset();
    if (isWinter && exteriorGroup.visible !== false) {
      extSteam.mat.uniforms.uColor.value.copy(
        timeId === 'night' ? _steamNightCol : (timeId === 'dusk' ? _steamWarmCol : _steamDayCol)
      );
      const breathGain = 0.44 + 0.16 * clamp(snowAmt, 0, 1);
      for (let i = 0; i < liveActors.length; i++) {
        const a = liveActors[i];
        if (a.zone !== 'exterior') continue;
        if (playerState && Math.hypot(playerState.x - a.x, playerState.z - a.z) > 24) continue;
        const cycle = (simTime + a.phase * 1.37) % 3.4;
        if (cycle > 1.55) continue;
        const sinY = Math.sin(a.yaw);
        const cosY = Math.cos(a.yaw);
        const mx = a.x + sinY * 0.22;
        const my = a.y + 1.46;
        const mz = a.z + cosY * 0.22;
        for (let k = 0; k < 5; k++) {
          const age = cycle - k * 0.14;
          if (age < 0 || age > 0.92) continue;
          const u = age / 0.92;
          const fwd = 0.08 + u * 0.42;
          const rise = u * 0.26 + u * u * 0.08;
          const sway = Math.sin(simTime * 2.4 + a.phase + k * 1.1) * 0.035 * u;
          const px = mx + sinY * fwd + cosY * sway + windX * u * 0.18;
          const py = my + rise;
          const pz = mz + cosY * fwd - sinY * sway + windZ * u * 0.18;
          const alpha = Math.sin(u * Math.PI) * (1 - u * 0.28) * breathGain;
          if (alpha > 0.01) extSteam.push(px, py, pz, 0.16 + u * 0.28, alpha);
        }
      }
    }
    extSteam.commit();

    // 2) 村口施茶瓦瓮热气 + 村口人物冬日寒天呵气
    intSteam.reset();
    if (interiorGroup.visible !== false) {
      intSteam.mat.uniforms.uColor.value.copy(
        lanternPower > 0.25 ? _steamWarmCol : (timeId === 'night' ? _steamNightCol : _steamDayCol)
      );
      if (teaJarSteamAnchor) {
        const teaBase = isWinter ? (0.68 + 0.20 * clamp(snowAmt, 0, 1)) : (isCoolLight ? 0.42 : 0);
        const teaGain = clamp(teaBase + teaSteamBoost * 0.45, 0, 0.95);
        const nearJar = !playerState || Math.hypot(playerState.x - teaJarSteamAnchor.x, playerState.z - teaJarSteamAnchor.z) < 28;
        if (teaGain > 0.02 && nearJar) {
          for (let k = 0; k < 14; k++) {
            const u = ((simTime * 0.38 + k / 14) % 1 + 1) % 1;
            const ang = simTime * 1.55 + k * 1.75;
            const swirlR = (0.035 + u * 0.16) * (1 + teaSteamBoost * 0.38);
            const px = teaJarSteamAnchor.x + Math.cos(ang) * swirlR + windX * u * 0.34;
            const py = teaJarSteamAnchor.y + 0.02 + u * (0.95 + teaSteamBoost * 0.28);
            const pz = teaJarSteamAnchor.z + Math.sin(ang) * swirlR + windZ * u * 0.34;
            const alpha = Math.sin(u * Math.PI) * (1 - u * 0.30) * teaGain * 0.72;
            if (alpha > 0.01) intSteam.push(px, py, pz, 0.24 + u * 0.48, alpha);
          }
        }
      }
      if (isWinter) {
        const breathGain = 0.44 + 0.16 * clamp(snowAmt, 0, 1);
        for (let i = 0; i < liveActors.length; i++) {
          const a = liveActors[i];
          if (a.zone !== 'interior') continue;
          if (playerState && Math.hypot(playerState.x - a.x, playerState.z - a.z) > 24) continue;
          const cycle = (simTime + a.phase * 1.37) % 3.4;
          if (cycle > 1.55) continue;
          const sinY = Math.sin(a.yaw);
          const cosY = Math.cos(a.yaw);
          const mx = a.x + sinY * 0.22;
          const my = a.y + 1.46;
          const mz = a.z + cosY * 0.22;
          for (let k = 0; k < 5; k++) {
            const age = cycle - k * 0.14;
            if (age < 0 || age > 0.92) continue;
            const u = age / 0.92;
            const fwd = 0.08 + u * 0.42;
            const rise = u * 0.26 + u * u * 0.08;
            const sway = Math.sin(simTime * 2.4 + a.phase + k * 1.1) * 0.035 * u;
            const px = mx + sinY * fwd + cosY * sway + windX * u * 0.18;
            const py = my + rise;
            const pz = mz + cosY * fwd - sinY * sway + windZ * u * 0.18;
            const alpha = Math.sin(u * Math.PI) * (1 - u * 0.28) * breathGain;
            if (alpha > 0.01) intSteam.push(px, py, pz, 0.16 + u * 0.28, alpha);
          }
        }
      }
    }
    intSteam.commit();

    // 3) 冬雪踏雪浅印（紧贴坡面，落雪渐平，回春清空；门洞裁剪同步）
    snowFootprints.update(
      step,
      snowAmt,
      isWinter,
      playerState,
      sampleY,
      waterY,
      slit.x,
      slit.z,
      exteriorGroup.visible !== false,
      interiorGroup.visible !== false,
      timeId
    );

    // 4) 中景山腰墨韵云带随风慢移（冬雪/细雨/晨昏轻流于危峰山腰，晴暖昼隐藏零开销）
    cragCloudBelt.update(step, sky, isWinter);

    // 5) 冬寂屋檐淡青晶莹小冰凌（覆盖渡亭、施茶草寮与全村茅舍，仅 1 洞内批 + 1 洞外批，春夏秋 0 draw call）
    const icicleSy = 0.52 + 0.48 * snowAccum;
    icicleGrowUniform.value = icicleSy;
    if (extIcicles) extIcicles.visible = isWinter;
    if (intIcicles) intIcicles.visible = isWinter;
    if (extShoreIce) extShoreIce.visible = isWinter;
    if (isWinter) {
      const glint = clamp(lanternPower, 0, 1);
      icicleMat.emissive.setRGB(glint * 0.14, glint * 0.09, glint * 0.03);
      shoreIceMat.opacity = 0.56 + 0.26 * snowAccum;
      shoreIceMat.emissive.setRGB(glint * 0.08, glint * 0.075, glint * 0.055);
    }

    // 6) 雪霁初晴、冰檐微滴：仅冬寂晴昼（非雨雪）且靠近亭寮时偶落晶莹水滴并同步 dewDrop 空间轻响
    const thawReady = isWinter && timeId === 'day' && snowAmt < 0.12 && rainAmt < 0.12;
    thawDrips.update(
      step,
      thawReady,
      icicleSy,
      exteriorGroup.visible !== false,
      interiorGroup.visible !== false,
      playerState,
      pendingEvents
    );
  }

  function getStats() {
    let staticTriangles = 0;
    let staticDraws = 0;
    for (const m of staticMeshes) {
      const parentVisible = m.parent?.visible !== false;
      if (parentVisible && m.visible) {
        staticDraws += 1;
        staticTriangles += m.geometry.attributes.position.count / 3;
      }
    }
    const extStats = exteriorGroup.visible !== false ? exteriorRig.stats() : { triangles: 0, drawCalls: 0 };
    const intStats = interiorGroup.visible !== false ? interiorRig.stats() : { triangles: 0, drawCalls: 0 };
    const egretDraws = exteriorGroup.visible !== false && egretSpecs.length > 0 ? 2 : 0;
    const egretTris = egretDraws
      ? ((egretBodyGeo.attributes.position.count + egretHeadGeo.attributes.position.count) / 3) * egretSpecs.length
      : 0;
    const raftDraws = exteriorGroup.visible !== false && raftInfo?.mesh ? 1 : 0;
    const raftTris = raftDraws ? raftInfo.mesh.geometry.attributes.position.count / 3 : 0;
    const raftWakeDraw = exteriorGroup.visible !== false && raftWake?.mesh?.visible ? 1 : 0;
    const raftWakeTris = raftWakeDraw ? 2 : 0;
    const netDraws = exteriorGroup.visible !== false && netInfo?.mesh ? 1 : 0;
    const netTris = netDraws ? netInfo.mesh.geometry.attributes.position.count / 3 : 0;
    let lanternDraws = 0;
    let lanternTris = 0;
    for (const l of lanterns) {
      const zoneVis = l.zone === 'exterior' ? exteriorGroup.visible !== false : interiorGroup.visible !== false;
      if (!zoneVis) continue;
      if (l.core.visible) {
        lanternDraws += 1;
        lanternTris += (lanternCoreGeo.index ? lanternCoreGeo.index.count : lanternCoreGeo.attributes.position.count) / 3;
      }
      if (l.glow?.visible) {
        lanternDraws += 1;
        lanternTris += 2;
      }
    }
    const extSteamDraw = exteriorGroup.visible !== false && extSteam.points.visible ? 1 : 0;
    const intSteamDraw = interiorGroup.visible !== false && intSteam.points.visible ? 1 : 0;
    const footprintDraw = snowFootprints.mesh.visible ? 1 : 0;
    const footprintTris = footprintDraw ? snowFootprints.activeCount * 2 : 0;
    const cragCloudDraw = cragCloudBelt.mesh.visible ? 1 : 0;
    const cragCloudTris = cragCloudDraw ? (cragCloudBelt.mesh.geometry.index.count / 3) : 0;
    const extIcicleDraw = exteriorGroup.visible !== false && extIcicles?.visible ? 1 : 0;
    const intIcicleDraw = interiorGroup.visible !== false && intIcicles?.visible ? 1 : 0;
    const extShoreIceDraw = exteriorGroup.visible !== false && extShoreIce?.visible ? 1 : 0;
    const thawDripDraw = thawDrips.points.visible ? 1 : 0;
    const icicleTris = (extIcicleDraw ? extIcicles.geometry.attributes.position.count / 3 : 0)
      + (intIcicleDraw ? intIcicles.geometry.attributes.position.count / 3 : 0);
    const extShoreIceTris = extShoreIceDraw ? extShoreIce.geometry.attributes.position.count / 3 : 0;

    return {
      phenology: currentPhenology,
      snowAccum: +snowAccum.toFixed(3),
      snowHookCount: snowHookRestorers.length,
      ferryNetAnimated: Boolean(netInfo?.mesh),
      lanternCount: lanterns.length,
      lanternPower: +lanternPower.toFixed(3),
      lanternsLit: lanternDraws > 0,
      extSteamVisible: Boolean(extSteamDraw),
      intSteamVisible: Boolean(intSteamDraw),
      steamActivePuffs: (extSteamDraw ? extSteam.count : 0) + (intSteamDraw ? intSteam.count : 0),
      teaSteamBoost: +teaSteamBoost.toFixed(3),
      snowFootprints: snowFootprints.activeCount,
      snowFootprintVisible: Boolean(footprintDraw),
      cragCloudVisible: Boolean(cragCloudDraw),
      cragCloudOpacity: +cragCloudBelt.opacity.toFixed(3),
      cragCloudDrift: +cragCloudBelt.drift.toFixed(4),
      cragCloudSunRim: +cragCloudBelt.sunRim.toFixed(3),
      raftWakeVisible: Boolean(raftWakeDraw),
      raftWakePulse: +(raftWake?.pulse || 0).toFixed(3),
      extIciclesVisible: Boolean(extIcicleDraw),
      intIciclesVisible: Boolean(intIcicleDraw),
      extShoreIceVisible: Boolean(extShoreIceDraw),
      extShoreIceOpacity: +(extShoreIce?.visible ? shoreIceMat.opacity : 0).toFixed(3),
      extShoreIceTris: Math.round(extShoreIceTris),
      villageIcicleHouses,
      icicleScale: +((extIcicles?.visible || intIcicles?.visible) ? icicleGrowUniform.value : 0).toFixed(3),
      thawDripsVisible: Boolean(thawDripDraw),
      thawDripsActive: thawDrips.activeCount,
      sites: sites.map(s => ({ id: s.id, zone: s.zone, x: +s.x.toFixed(2), z: +s.z.toFixed(2) })),
      actors: liveActors.map(a => ({ id: a.id, zone: a.zone, role: a.role, x: +a.x.toFixed(2), z: +a.z.toFixed(2) })),
      egretCount: egretSpecs.length,
      egretsTucked,
      actorsResting,
      ferryPlaced: Boolean(ferryPlaced),
      drawCalls: staticDraws + extStats.drawCalls + intStats.drawCalls + egretDraws + raftDraws + raftWakeDraw + netDraws + lanternDraws + extSteamDraw + intSteamDraw + footprintDraw + cragCloudDraw + extIcicleDraw + intIcicleDraw + extShoreIceDraw + thawDripDraw,
      triangles: Math.round(staticTriangles + extStats.triangles + intStats.triangles + egretTris + raftTris + raftWakeTris + netTris + lanternTris + footprintTris + cragCloudTris + icicleTris + extShoreIceTris),
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const restore of snowHookRestorers) {
      try { restore(); } catch (_) {}
    }
    snowHookRestorers.length = 0;
    pendingEvents.length = 0;
    exteriorRig.dispose();
    interiorRig.dispose();
    extSteam.dispose();
    intSteam.dispose();
    snowFootprints.dispose();
    cragCloudBelt.dispose();
    raftWake?.dispose();
    thawDrips.dispose();
    if (extIcicles) {
      extIcicles.geometry.dispose();
      extIcicles.removeFromParent();
    }
    if (intIcicles) {
      intIcicles.geometry.dispose();
      intIcicles.removeFromParent();
    }
    icicleMat.dispose();
    if (extShoreIce) {
      extShoreIce.geometry.dispose();
      extShoreIce.removeFromParent();
    }
    shoreIceMat.dispose();
    staticMat.dispose();
    foliageMat.dispose();
    egretMat.dispose();
    egretBodyGeo.dispose();
    egretHeadGeo.dispose();
    lanternCoreGeo.dispose();
    lanternGlowTex?.dispose?.();
    for (const l of lanterns) {
      l.coreMat.dispose();
      l.glowMat?.dispose?.();
    }
    if (raftInfo) {
      raftInfo.mesh.geometry.dispose();
      raftInfo.mat.dispose();
    }
    if (netInfo) {
      netInfo.mesh.geometry.dispose();
      netInfo.mat.dispose();
    }
    for (const m of staticMeshes) m.geometry.dispose();
    group.removeFromParent();
  }

  return {
    group,
    exteriorGroup,
    interiorGroup,
    blockers,
    targets,
    shelters,
    quietSpots,
    sites,
    actors: liveActors,
    layout: { ferryPavilion: ferryPlaced, sites, trails: [], woodDecks: [], walkPlatforms: [] },
    getInteractables,
    greet,
    setPhenology,
    bind,
    interactById,
    consumeEvents,
    update,
    getStats,
    dispose
  };
}
