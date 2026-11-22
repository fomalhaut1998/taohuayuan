import * as THREE from 'three';

const TAU = Math.PI * 2;
const WARM_SOURCE_SLOTS = 10;
const ROOF_REF_SLOTS = 16;
const FIREFLY_COUNT = 48;
const FIREFLY_VERTICES = FIREFLY_COUNT * 2;
const DEW_COUNT = 120;

const BEGIN_VERTEX = '#include <begin_vertex>';
const COLOR_FRAGMENT = '#include <color_fragment>';
const NORMAL_FRAGMENT_BEGIN = '#include <normal_fragment_begin>';
const OPAQUE_FRAGMENT = '#include <opaque_fragment>';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smooth01(t) {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ptRot(cx, cy, cz, yaw, lx, ly, lz) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    cx + lx * c + lz * s,
    cy + ly,
    cz - lx * s + lz * c
  ];
}

const CRAFT_NOISE_GLSL = /* glsl */`
float craftHash21(vec2 p) {
  vec2 q = fract(p * vec2(127.1, 311.7));
  q += dot(q, q + 34.23);
  return fract(q.x * q.y);
}

float craftNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = craftHash21(i);
  float b = craftHash21(i + vec2(1.0, 0.0));
  float c = craftHash21(i + vec2(0.0, 1.0));
  float d = craftHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float craftFbm2(vec2 p) {
  float v = 0.0;
  v += 0.55 * craftNoise2(p);
  v += 0.30 * craftNoise2(p * 2.13 + vec2(7.3, 3.1));
  v += 0.15 * craftNoise2(p * 4.37 + vec2(2.9, 11.7));
  return v;
}
`;

const LANTERN_SWAY_GLSL = /* glsl */`
vec3 craftLanternSwayOffset(vec3 pivot, float swayWeight, float simTime, vec2 windVec) {
  if (swayWeight <= 0.0001) return vec3(0.0);
  float seed = pivot.x * 0.73 + pivot.z * 0.59 + pivot.y * 0.31;
  float wMag = clamp(length(windVec), 0.04, 1.65);
  vec2 wDir = length(windVec) > 0.001 ? normalize(windVec) : vec2(0.86, 0.51);
  vec2 wPerp = vec2(-wDir.y, wDir.x);
  float primary = sin(simTime * 1.95 + seed) * 0.62 + sin(simTime * 3.15 + seed * 1.7) * 0.26 + 0.22;
  float crossOsc = cos(simTime * 2.35 + seed * 1.3) * 0.34;
  float amp = (0.014 + 0.026 * wMag) * swayWeight;
  vec2 horiz = (wDir * primary + wPerp * crossOsc) * amp;
  float lift = -min(0.012, dot(horiz, horiz) * 1.45);
  return vec3(horiz.x, lift, horiz.y);
}
`;

/**
 * 建筑营造细部、竹编风灯暖光与夏夜流萤朝露系统：
 * 1. 零改 village.js、零增 Draw Call 的宋元界画笔意（顺坡茅草束、夯土灰泥墙根返潮、阡陌车辙细砂与雨湿微光）
 * 2. 竹编纸罩风灯（谷内 7 盏 + 溪津渡口 1 盏）与人物衣袂篝火/风灯暖色边缘光
 * 3. 夏夜荷塘双生流萤（空中 + 水面涟漪倒影）与晓雾草尖朝露微芒
 */
export function createArchitecturalCraft({
  world,
  field,
  village,
  cliff,
  pondLife,
  leisureGrove,
  qinHanHomestead,
  qinHanCompletion,
  hospitalityFeast,
  neighborTheaters,
  communityLife,
  people,
  avatar,
  boats,
  sky,
  phenology,
  sharedCommunityActors
} = {}) {
  const group = new THREE.Group();
  group.name = 'architectural-craft';

  const interiorGroup = new THREE.Group();
  interiorGroup.name = 'architectural-craft-interior';

  const exteriorGroup = new THREE.Group();
  exteriorGroup.name = 'architectural-craft-exterior';

  group.add(interiorGroup, exteriorGroup);

  let boundSky = sky || null;
  let boundPhenology = phenology || null;
  let disposed = false;
  let simTime = 0;

  const waterLevel = world?.terrain?.waterLevel ?? -1.0;
  const rawBasin = world?.terrain?.basin || {};
  const basinX = Number.isFinite(rawBasin.x)
    ? rawBasin.x
    : (Array.isArray(rawBasin.center) && Number.isFinite(rawBasin.center[0]) ? rawBasin.center[0] : 30);
  const basinZ = Number.isFinite(rawBasin.z)
    ? rawBasin.z
    : (Array.isArray(rawBasin.center) && Number.isFinite(rawBasin.center[1]) ? rawBasin.center[1] : -140);
  const basinInner = Number.isFinite(rawBasin.inner)
    ? rawBasin.inner
    : (Number.isFinite(rawBasin.radius) ? rawBasin.radius : 96);
  const pondCfg = world?.terrain?.pond || { x: 68, z: -152, radius: 13, waterRadius: 9.2, waterY: 0.85 };
  const pondWaterY = Number.isFinite(village?.pond?.waterY) ? village.pond.waterY : (Number.isFinite(pondCfg.waterY) ? pondCfg.waterY : 0.85);
  const pondCenterX = Number.isFinite(village?.pond?.x)
    ? village.pond.x
    : (Number.isFinite(pondCfg.x) ? pondCfg.x : (Array.isArray(pondCfg.center) && Number.isFinite(pondCfg.center[0]) ? pondCfg.center[0] : 68));
  const pondCenterZ = Number.isFinite(village?.pond?.z)
    ? village.pond.z
    : (Number.isFinite(pondCfg.z) ? pondCfg.z : (Array.isArray(pondCfg.center) && Number.isFinite(pondCfg.center[1]) ? pondCfg.center[1] : -152));
  const pondWaterRadius = Number.isFinite(pondCfg.waterRadius) ? pondCfg.waterRadius : 9.2;
  const slitX = cliff?.slit?.x ?? 23;
  const slitZ = cliff?.slit?.z ?? -10;

  function sampleGround(x, z) {
    if (field && typeof field.sample === 'function') {
      const y = field.sample(x, z);
      if (Number.isFinite(y)) return y;
    }
    return 2.0;
  }

  // 池岸角度半径查询（兼容数值半径数组 village.pond.rim 与 [x,z] 采样点数组）
  const pondRim = Array.isArray(village?.pond?.rim) ? village.pond.rim : null;
  function rimEntryRadius(entry) {
    if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
    if (Array.isArray(entry) && Number.isFinite(entry[0]) && Number.isFinite(entry[1])) {
      return Math.hypot(entry[0] - pondCenterX, entry[1] - pondCenterZ);
    }
    return pondWaterRadius;
  }
  function samplePondRadiusAtAngle(ang) {
    if (!pondRim || pondRim.length < 6) return pondWaterRadius;
    const norm = ((ang % TAU) + TAU) % TAU;
    const f = (norm / TAU) * pondRim.length;
    const i0 = Math.floor(f) % pondRim.length;
    const i1 = (i0 + 1) % pondRim.length;
    const t = f - Math.floor(f);
    const r0 = rimEntryRadius(pondRim[i0]);
    const r1 = rimEntryRadius(pondRim[i1]);
    return r0 + (r1 - r0) * t;
  }

  // ============================================================================
  // Shared Shader Uniforms & Composable Material Hooking (`chainBeforeCompile`)
  // ============================================================================
  const uCraftRain = { value: 0 };
  const uCraftWetSheen = { value: 0 };
  const uCraftSimTime = { value: 0 };
  const uCraftWindVec = { value: new THREE.Vector2(0.28, 0.10) };

  const roofRefs = Array.from({ length: ROOF_REF_SLOTS }, () => new THREE.Vector4(0, 0, 0, 1.85));
  const uCraftRoofRefs = { value: roofRefs };
  const uCraftRoofRefCount = { value: 0 };

  const warmSources = Array.from({ length: WARM_SOURCE_SLOTS }, () => new THREE.Vector4(0, -1000, 0, 0));
  const uWarmSources = { value: warmSources };
  const uWarmRimStrength = { value: 0 };
  const uMoonSilverStrength = { value: 0 };
  const uWindowWarmBounce = { value: 0 };

  function refreshRoofRefs() {
    const info = Array.isArray(village?.houseInfo) ? village.houseInfo : [];
    const roofH = world?.village?.houses?.roofHeight ?? 1.85;
    const count = Math.min(ROOF_REF_SLOTS, info.length);
    for (let i = 0; i < count; i++) {
      const hi = info[i];
      roofRefs[i].set(hi.x, (hi.gy ?? sampleGround(hi.x, hi.z)) + (hi.h ?? 3.0) - 0.16, hi.z, roofH);
    }
    uCraftRoofRefCount.value = count;
  }
  refreshRoofRefs();

  const hookedKeysByMaterial = new WeakMap();
  const materialRestorers = [];
  let hookedRoofMaterials = 0;
  let hookedWallMaterials = 0;
  let hookedRoadMaterials = 0;
  let hookedActorMaterials = 0;

  function chainBeforeCompile(material, key, patchFn) {
    if (!material || typeof material !== 'object') return false;
    let keySet = hookedKeysByMaterial.get(material);
    if (!keySet) {
      keySet = new Set();
      hookedKeysByMaterial.set(material, keySet);
    }
    if (keySet.has(key)) return false;
    keySet.add(key);

    const prevHook = material.onBeforeCompile;
    const prevKeyFn = material.customProgramCacheKey;
    const baseKey = typeof prevKeyFn === 'function' ? prevKeyFn.call(material) : '';

    const chainedHook = function onBeforeCompileChained(shader, renderer) {
      if (typeof prevHook === 'function') {
        prevHook.call(this, shader, renderer);
      }
      patchFn(shader, renderer);
    };

    const chainedKey = function customProgramCacheKeyChained() {
      const prefix = (typeof prevKeyFn === 'function' && prevKeyFn !== THREE.Material.prototype.customProgramCacheKey)
        ? prevKeyFn.call(this)
        : baseKey;
      return prefix ? `${prefix}|${key}` : key;
    };

    material.onBeforeCompile = chainedHook;
    material.customProgramCacheKey = chainedKey;
    material.needsUpdate = true;

    materialRestorers.push(() => {
      if (keySet.has(key)) keySet.delete(key);
      if (material.onBeforeCompile === chainedHook) {
        material.onBeforeCompile = prevHook;
      }
      if (material.customProgramCacheKey === chainedKey) {
        material.customProgramCacheKey = prevKeyFn;
      }
      material.needsUpdate = true;
    });

    return true;
  }

  function injectCraftVaryings(shader) {
    if (!shader.vertexShader.includes(BEGIN_VERTEX)) return false;
    if (!shader.vertexShader.includes('varying vec3 vCraftWorldPos;')) {
      shader.vertexShader =
        'varying vec3 vCraftWorldPos;\n' +
        'varying vec3 vCraftLocalPos;\n' +
        'varying vec3 vCraftObjNormal;\n' +
        shader.vertexShader.replace(
          BEGIN_VERTEX,
          /* glsl */`
#include <begin_vertex>
vCraftLocalPos = transformed;
vCraftObjNormal = objectNormal;
#ifdef USE_INSTANCING
  mat4 craftInst = instanceMatrix;
  vCraftWorldPos = (modelMatrix * craftInst * vec4(transformed, 1.0)).xyz;
#else
  vCraftWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`
        );
    }
    if (!shader.fragmentShader.includes('varying vec3 vCraftWorldPos;')) {
      shader.fragmentShader =
        'varying vec3 vCraftWorldPos;\n' +
        'varying vec3 vCraftLocalPos;\n' +
        'varying vec3 vCraftObjNormal;\n' +
        shader.fragmentShader;
    }
    if (!shader.fragmentShader.includes('float craftHash21(vec2 p)')) {
      shader.fragmentShader = CRAFT_NOISE_GLSL + '\n' + shader.fragmentShader;
    }
    return true;
  }

  function patchRoofShader(shader, isTilesMesh) {
    if (!shader.fragmentShader.includes(COLOR_FRAGMENT)) return;
    if (!injectCraftVaryings(shader)) return;

    shader.uniforms.uCraftRain = uCraftRain;
    shader.uniforms.uCraftRoofMode = { value: isTilesMesh ? 2.0 : 1.0 };
    shader.uniforms.uMoonSilverStrength = uMoonSilverStrength;

    if (isTilesMesh) {
      shader.uniforms.uCraftRoofRefs = uCraftRoofRefs;
      shader.uniforms.uCraftRoofRefCount = uCraftRoofRefCount;
      if (!shader.vertexShader.includes('varying float vCraftSlopeT;')) {
        shader.vertexShader =
          `uniform vec4 uCraftRoofRefs[${ROOF_REF_SLOTS}];\n` +
          'uniform int uCraftRoofRefCount;\n' +
          'varying float vCraftSlopeT;\n' +
          shader.vertexShader.replace(
            'vCraftWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
            /* glsl */`
  vCraftWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float craftBestD2 = 1e9;
  float craftBestSlope = clamp(1.12 - abs(objectNormal.y), 0.0, 1.0);
  for (int ci = 0; ci < ${ROOF_REF_SLOTS}; ci++) {
    if (ci >= uCraftRoofRefCount) break;
    vec4 rf = uCraftRoofRefs[ci];
    vec2 dXZ = vCraftWorldPos.xz - rf.xz;
    float d2 = dot(dXZ, dXZ);
    if (d2 < craftBestD2) {
      craftBestD2 = d2;
      craftBestSlope = 1.0 - clamp((vCraftWorldPos.y - rf.y) / max(0.5, rf.w), 0.0, 1.0);
    }
  }
  vCraftSlopeT = craftBestSlope;
`
          );
      }
      if (!shader.fragmentShader.includes('varying float vCraftSlopeT;')) {
        shader.fragmentShader = 'varying float vCraftSlopeT;\n' + shader.fragmentShader;
      }
    } else {
      if (!shader.vertexShader.includes('varying float vCraftSlopeT;')) {
        shader.vertexShader =
          'varying float vCraftSlopeT;\n' +
          shader.vertexShader.replace(
            'vCraftLocalPos = transformed;',
            'vCraftLocalPos = transformed;\nvCraftSlopeT = clamp(1.0 - transformed.y, 0.0, 1.0);'
          );
      }
      if (!shader.fragmentShader.includes('varying float vCraftSlopeT;')) {
        shader.fragmentShader = 'varying float vCraftSlopeT;\n' + shader.fragmentShader;
      }
    }

    if (!shader.fragmentShader.includes('uniform float uCraftRoofMode;')) {
      shader.fragmentShader =
        'uniform float uCraftRain;\n' +
        'uniform float uCraftRoofMode;\n' +
        'uniform float uMoonSilverStrength;\n' +
        shader.fragmentShader;
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      COLOR_FRAGMENT,
      /* glsl */`
#include <color_fragment>
{
  float downSlope = clamp(vCraftSlopeT, 0.0, 1.0);
  float alongCoord;
  float slopeRun;
  if (uCraftRoofMode < 1.5) {
    alongCoord = vCraftLocalPos.z * 6.8 + dot(vCraftWorldPos.xz, vec2(0.19, -0.14));
    slopeRun = downSlope * 3.7;
  } else {
    vec2 hNorm = vCraftObjNormal.xz;
    vec2 sDir = dot(hNorm, hNorm) > 0.006 ? normalize(hNorm) : vec2(0.7071, 0.7071);
    vec2 rDir = vec2(-sDir.y, sDir.x);
    alongCoord = dot(vCraftWorldPos.xz, rDir);
    slopeRun = dot(vCraftWorldPos.xz, sDir);
  }

  // 顺坡茅草束肌理：粗细相间的顺坡苇束条纹 + 层叠草阶搭接暗线
  float stalkFine = craftNoise2(vec2(alongCoord * 16.5, slopeRun * 2.1));
  float stalkBundle = craftNoise2(vec2(alongCoord * 5.6 + stalkFine * 0.35, slopeRun * 0.95));
  float reedStriation = (stalkFine - 0.5) * 0.13 + (stalkBundle - 0.5) * 0.15;

  float coursePhase = fract(slopeRun * 2.35 + (stalkBundle - 0.5) * 0.18);
  float courseShadow = (1.0 - smoothstep(0.0, 0.17, coursePhase)) * 0.11;
  float courseTipLight = smoothstep(0.76, 0.98, coursePhase) * 0.045;

  // 檐口烟熏积苔暗晕 + 屋脊苍古干苇提亮
  float isRidgeCap = uCraftRoofMode > 1.5 ? smoothstep(0.93, 0.99, vCraftObjNormal.y) * (1.0 - downSlope) : 0.0;
  float isEaveFascia = uCraftRoofMode > 1.5 ? (1.0 - smoothstep(0.18, 0.45, abs(vCraftObjNormal.y))) * downSlope : 0.0;
  float eaveMask = max(smoothstep(0.66, 0.99, downSlope), isEaveFascia);
  float ridgeMask = max(smoothstep(0.18, 0.0, downSlope), isRidgeCap);

  float mossPatch = craftFbm2(vCraftWorldPos.xz * 1.45);
  vec3 sootMossTint = mix(vec3(0.31, 0.24, 0.17), vec3(0.28, 0.35, 0.21), smoothstep(0.42, 0.78, mossPatch));

  diffuseColor.rgb *= (1.0 + reedStriation - courseShadow + courseTipLight);
  diffuseColor.rgb = mix(diffuseColor.rgb, sootMossTint, eaveMask * 0.24);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.10, 1.08, 1.02) + vec3(0.025, 0.022, 0.015), ridgeMask * 0.48);

  // 雨天湿茅压暗与润泽沉着度
  float wetThatch = clamp(uCraftRain * 1.12, 0.0, 1.0);
  diffuseColor.rgb *= mix(1.0, 0.75, wetThatch);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.96, 0.95, 0.89), wetThatch * 0.45);
}
`
      )
      .replace(
        OPAQUE_FRAGMENT,
        /* glsl */`
if (uMoonSilverStrength > 0.001) {
  vec3 roofViewDir = normalize(vViewPosition);
  float roofRim = pow(clamp(1.0 - abs(dot(normal, roofViewDir)), 0.0, 1.0), 2.35);
  float ridgeSilver = smoothstep(0.18, 0.0, clamp(vCraftSlopeT, 0.0, 1.0));
  float moonMask = clamp(ridgeSilver * 0.46 + roofRim * 0.42, 0.0, 0.82);
  outgoingLight += vec3(0.085, 0.125, 0.175) * (moonMask * uMoonSilverStrength);
}
#include <opaque_fragment>
`
      );
  }

  function patchWallShader(shader, wallKind) {
    if (!shader.fragmentShader.includes(COLOR_FRAGMENT)) return;
    if (!injectCraftVaryings(shader)) return;

    shader.uniforms.uCraftRain = uCraftRain;
    shader.uniforms.uCraftWallKind = { value: wallKind };
    shader.uniforms.uWindowWarmBounce = uWindowWarmBounce;

    if (!shader.vertexShader.includes('varying float vCraftWallH;')) {
      shader.vertexShader =
        'varying float vCraftWallH;\n' +
        shader.vertexShader.replace(
          '#ifdef USE_INSTANCING\n  mat4 craftInst = instanceMatrix;\n  vCraftWorldPos = (modelMatrix * craftInst * vec4(transformed, 1.0)).xyz;\n#else\n  vCraftWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif',
          /* glsl */`
#ifdef USE_INSTANCING
  mat4 craftInst = instanceMatrix;
  vCraftWorldPos = (modelMatrix * craftInst * vec4(transformed, 1.0)).xyz;
  float craftScaleY = length(craftInst[1].xyz);
  vCraftWallH = max(0.0, transformed.y * craftScaleY - 0.13);
#else
  vCraftWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vCraftWallH = max(0.0, transformed.y);
#endif
`
        );
    }

    if (!shader.fragmentShader.includes('varying float vCraftWallH;')) {
      shader.fragmentShader =
        'uniform float uCraftRain;\n' +
        'uniform float uCraftWallKind;\n' +
        'uniform float uWindowWarmBounce;\n' +
        'varying float vCraftWallH;\n' +
        shader.fragmentShader;
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      COLOR_FRAGMENT,
      /* glsl */`
#include <color_fragment>
{
  // 木构窗棂门框保持利落本色，夯土灰泥墙面充分展现版筑层理与斑驳笔触
  float baseLuma = dot(diffuseColor.rgb, vec3(0.3333));
  float plasterMask = smoothstep(0.28, 0.50, baseLuma);

  float horizCoord = dot(vCraftWorldPos.xz, vec2(0.78, -0.62));
  float mottleCoarse = craftFbm2(vec2(horizCoord * 0.92, vCraftWorldPos.y * 1.18));
  float mottleFine = craftNoise2(vec2(horizCoord * 5.4, vCraftWorldPos.y * 6.2));

  // 夯土灰泥斑驳肌理：版筑水平夯层 + 石灰老墙微斑
  float tampWave = sin(vCraftWorldPos.y * 16.8 + mottleCoarse * 2.4);
  float tampSeam = 1.0 - smoothstep(0.0, 0.22, abs(fract(vCraftWorldPos.y * 2.65 + (mottleCoarse - 0.5) * 0.14) - 0.5));
  float earthStrata = tampWave * 0.032 - tampSeam * 0.048 + (mottleCoarse - 0.5) * 0.11 + (mottleFine - 0.5) * 0.05;

  vec3 limePatch = diffuseColor.rgb * (1.0 + earthStrata * plasterMask);
  vec3 warmRammed = diffuseColor.rgb * vec3(0.95, 0.91, 0.83);
  diffuseColor.rgb = mix(limePatch, warmRammed, clamp((0.52 - mottleCoarse) * 0.55, 0.0, 0.28) * plasterMask);

  // 墙根 0..0.65m 返潮青苔与泥溅暗晕（仅主墙体接地段生效）
  if (uCraftWallKind < 0.5) {
    float capillaryTop = 0.65 + (mottleCoarse - 0.5) * 0.14 + uCraftRain * 0.12;
    float dampFoot = smoothstep(capillaryTop, 0.0, vCraftWallH);
    float splashBand = smoothstep(0.26, 0.0, vCraftWallH);
    vec3 oliveMoss = vec3(0.30, 0.36, 0.23);
    vec3 wetMud = vec3(0.27, 0.24, 0.19);
    vec3 footTint = mix(wetMud, oliveMoss, smoothstep(0.36, 0.72, mottleCoarse));
    diffuseColor.rgb = mix(diffuseColor.rgb, footTint, dampFoot * 0.34 * (0.45 + 0.55 * plasterMask));
    diffuseColor.rgb *= (1.0 - dampFoot * (0.16 + 0.09 * uCraftRain) - splashBand * 0.10);
  }

  // 檐下阴翳：主墙顶部、山墙斜博风下缘、烟囱口熏迹
  float underEave = 0.0;
  if (uCraftWallKind < 0.5) {
    underEave = smoothstep(0.80, 0.99, vCraftLocalPos.y);
  } else if (uCraftWallKind < 1.5) {
    float vergeDist = abs(vCraftLocalPos.x) * 2.0 + vCraftLocalPos.y;
    underEave = smoothstep(0.76, 0.99, vergeDist);
  } else {
    float sootRim = smoothstep(0.68, 0.99, vCraftLocalPos.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.21, 0.19), sootRim * 0.28);
    underEave = smoothstep(0.22, 0.0, vCraftLocalPos.y) * 0.75;
  }
  diffuseColor.rgb *= (1.0 - underEave * 0.16);
  diffuseColor.rgb *= mix(1.0, 0.85, clamp(uCraftRain, 0.0, 1.0) * plasterMask * (1.0 - underEave * 0.5));
}
`
      )
      .replace(
        OPAQUE_FRAGMENT,
        /* glsl */`
if (uWindowWarmBounce > 0.001 && uCraftWallKind < 1.5) {
  float winX = abs(abs(vCraftLocalPos.x) - 0.29);
  float winY = abs(vCraftLocalPos.y - 0.56);
  float frontFace = smoothstep(0.42, 0.50, vCraftLocalPos.z);
  float sideWin = smoothstep(0.42, 0.50, abs(vCraftLocalPos.x)) * (1.0 - smoothstep(0.0, 0.26, abs(vCraftLocalPos.z)));
  float winSpill = exp(-(winX * winX * 14.0 + winY * winY * 9.0)) * frontFace
                 + exp(-(winY * winY * 10.0)) * sideWin * 0.55;
  float eaveWarm = smoothstep(0.72, 0.98, vCraftLocalPos.y) * (0.35 + 0.65 * frontFace) * 0.28;
  outgoingLight += vec3(0.32, 0.18, 0.07) * clamp((winSpill * 0.85 + eaveWarm) * uWindowWarmBounce, 0.0, 0.36);
}
#include <opaque_fragment>
`
      );
  }

  function patchRoadShader(shader) {
    if (!shader.fragmentShader.includes(COLOR_FRAGMENT) || !shader.fragmentShader.includes(OPAQUE_FRAGMENT)) return;
    if (!injectCraftVaryings(shader)) return;

    shader.uniforms.uCraftRain = uCraftRain;
    shader.uniforms.uCraftWetSheen = uCraftWetSheen;

    if (!shader.fragmentShader.includes('uniform float uCraftWetSheen;')) {
      shader.fragmentShader =
        'uniform float uCraftRain;\n' +
        'uniform float uCraftWetSheen;\n' +
        shader.fragmentShader;
    }

    shader.fragmentShader = shader.fragmentShader
      .replace(
        COLOR_FRAGMENT,
        /* glsl */`
#include <color_fragment>
float craftRoadPuddle = 0.0;
{
  vec2 wp = vCraftWorldPos.xz;
  float rutMottle = craftFbm2(wp * 0.85);
  float treadStreak = craftNoise2(vec2(wp.x * 2.8 + wp.y * 1.9, wp.y * 2.6 - wp.x * 1.7));
  float fineGrit = craftHash21(floor(wp * 24.0));
  float pebbleGrain = craftNoise2(wp * 11.5);

  // 车辙足印斑驳 + 细砂砾矿物颗粒笔触
  float wornTrack = (rutMottle - 0.5) * 0.13 + (treadStreak - 0.5) * 0.08;
  float gritDelta = (fineGrit - 0.5) * 0.075 + smoothstep(0.76, 0.95, pebbleGrain) * 0.055;
  diffuseColor.rgb *= (1.0 + wornTrack + gritDelta);

  float wetRoad = max(smoothstep(0.05, 0.72, uCraftRain), uCraftWetSheen * 0.65);
  craftRoadPuddle = smoothstep(0.44, 0.76, rutMottle) * wetRoad;
  diffuseColor.rgb *= mix(1.0, 0.73, wetRoad * (0.65 + 0.35 * rutMottle));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.95, 0.94, 0.90), craftRoadPuddle * 0.5);
}
`
      )
      .replace(
        OPAQUE_FRAGMENT,
        /* glsl */`
if (uCraftRain > 0.05 && craftRoadPuddle > 0.001) {
  vec3 roadViewDir = normalize(vViewPosition);
  float roadGrazing = pow(clamp(1.0 - abs(dot(normal, roadViewDir)), 0.0, 1.0), 2.6);
  float rainGate = smoothstep(0.05, 0.55, uCraftRain);
  vec3 wetSkySheen = vec3(0.68, 0.74, 0.77) * (0.05 + 0.13 * roadGrazing) * craftRoadPuddle * rainGate;
  outgoingLight += clamp(wetSkySheen, vec3(0.0), vec3(0.18));
}
#include <opaque_fragment>
`
      );
  }

  function patchActorWarmRimShader(shader) {
    if (!shader.fragmentShader.includes(OPAQUE_FRAGMENT) || !shader.fragmentShader.includes(NORMAL_FRAGMENT_BEGIN)) return;
    if (!injectCraftVaryings(shader)) return;

    shader.uniforms.uWarmSources = uWarmSources;
    shader.uniforms.uWarmRimStrength = uWarmRimStrength;

    if (!shader.fragmentShader.includes('uniform float uWarmRimStrength;')) {
      shader.fragmentShader =
        `uniform vec4 uWarmSources[${WARM_SOURCE_SLOTS}];\n` +
        'uniform float uWarmRimStrength;\n' +
        shader.fragmentShader;
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      OPAQUE_FRAGMENT,
      /* glsl */`
if (uWarmRimStrength > 0.001) {
  vec3 craftWorldN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 craftToCam = cameraPosition - vCraftWorldPos;
  vec3 craftViewW = craftToCam * inversesqrt(max(dot(craftToCam, craftToCam), 0.000001));
  float craftRimFresnel = 0.34 + 0.66 * pow(clamp(1.0 - max(0.0, dot(craftWorldN, craftViewW)), 0.0, 1.0), 1.85);
  vec3 craftWarmSum = vec3(0.0);
  for (int wi = 0; wi < ${WARM_SOURCE_SLOTS}; wi++) {
    vec4 ws = uWarmSources[wi];
    if (ws.w <= 0.0001) continue;
    vec3 dVec = ws.xyz - vCraftWorldPos;
    float d2 = dot(dVec, dVec);
    float invR = ws.w;
    if (d2 * invR * invR >= 1.0) continue;
    float dist = sqrt(max(d2, 0.0001));
    vec3 lDir = dVec / dist;
    float falloff = 1.0 - dist * invR;
    falloff *= falloff;
    float halfL = dot(craftWorldN, lDir) * 0.5 + 0.5;
    halfL *= halfL;
    craftWarmSum += vec3(1.0, 0.64, 0.28) * (falloff * halfL * craftRimFresnel);
  }
  vec3 craftAlbedoWeight = mix(vec3(0.52), clamp(diffuseColor.rgb, vec3(0.18), vec3(1.15)), 0.55);
  outgoingLight += clamp(craftWarmSum * uWarmRimStrength * craftAlbedoWeight, vec3(0.0), vec3(0.42));
}
#include <opaque_fragment>
`
    );
  }

  function isHookableLitMaterial(mat) {
    if (!mat || mat.transparent || mat.userData?.skyIgnore) return false;
    return Boolean(
      mat.isMeshLambertMaterial ||
      mat.isMeshStandardMaterial ||
      mat.isMeshPhongMaterial ||
      mat.isMeshToonMaterial
    );
  }

  function hookActorWarmRim() {
    const actorRoots = [
      avatar?.group,
      people?.group,
      communityLife?.group,
      hospitalityFeast?.group,
      neighborTheaters?.group,
      qinHanCompletion?.group?.getObjectByName?.('qin-han-night-feast-actors'),
      sharedCommunityActors
    ];
    for (let r = 0; r < actorRoots.length; r++) {
      const root = actorRoots[r];
      if (!root || typeof root.traverse !== 'function') continue;
      root.traverse(obj => {
        if (!obj?.isMesh || String(obj.name || '').startsWith('static-visibility:')) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (let m = 0; m < mats.length; m++) {
          const mat = mats[m];
          if (!isHookableLitMaterial(mat)) continue;
          if (chainBeforeCompile(mat, 'craft-actor-warm-rim-v1', patchActorWarmRimShader)) {
            hookedActorMaterials++;
          }
        }
      });
    }
  }

  function hookMaterials() {
    refreshRoofRefs();

    if (village?.group && typeof village.group.traverse === 'function') {
      village.group.traverse(obj => {
        if (!obj?.isMesh) return;
        const name = String(obj.name || '');
        if (name.startsWith('static-visibility:')) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (let m = 0; m < mats.length; m++) {
          const mat = mats[m];
          if (!isHookableLitMaterial(mat)) continue;
          if (name === 'houses-roof') {
            if (chainBeforeCompile(mat, 'craft-roof-v1', s => patchRoofShader(s, false))) {
              hookedRoofMaterials++;
            }
          } else if (name === 'houses-tiles') {
            if (chainBeforeCompile(mat, 'craft-roof-tiles-v1', s => patchRoofShader(s, true))) {
              hookedRoofMaterials++;
            }
          } else if (name === 'houses-body-0' || name === 'houses-body-1' || name === 'houses-body-2') {
            if (chainBeforeCompile(mat, 'craft-wall-body-v1', s => patchWallShader(s, 0.0))) {
              hookedWallMaterials++;
            }
          } else if (name === 'houses-gable') {
            if (chainBeforeCompile(mat, 'craft-wall-gable-v1', s => patchWallShader(s, 1.0))) {
              hookedWallMaterials++;
            }
          } else if (name === 'houses-chimney') {
            if (chainBeforeCompile(mat, 'craft-wall-chimney-v1', s => patchWallShader(s, 2.0))) {
              hookedWallMaterials++;
            }
          } else if (name === 'village-road' || name === 'village-spurs') {
            if (chainBeforeCompile(mat, 'craft-road-v1', patchRoadShader)) {
              hookedRoadMaterials++;
            }
          }
        }
      });
    }

    hookActorWarmRim();

    return {
      roofMaterials: hookedRoofMaterials,
      wallMaterials: hookedWallMaterials,
      roadMaterials: hookedRoadMaterials,
      actorMaterials: hookedActorMaterials
    };
  }

  // ============================================================================
  // Part B: 8 Bamboo Eave & Ferry Lanterns (`7` interior + `1` exterior)
  // ============================================================================
  function resolveLanternAnchors() {
    const interior = [];
    const regions = Array.isArray(leisureGrove?.layout?.regions) ? leisureGrove.layout.regions : [];

    // 1. 临池草亭飞檐角（朝向池心一角）
    const pav = regions.find(r => r && r.kind === 'pavilion');
    if (pav && Number.isFinite(pav.x) && Number.isFinite(pav.z)) {
      const sx = pondCenterX >= pav.x ? 1 : -1;
      const sz = pondCenterZ >= pav.z ? 1 : -1;
      const py = Number.isFinite(pav.y) ? pav.y : sampleGround(pav.x, pav.z);
      const attachX = pav.x + sx * 2.12;
      const attachZ = pav.z + sz * 2.12;
      const attachY = py + 2.63;
      interior.push({
        id: 'pavilion-eave',
        mount: 'eave',
        x: attachX,
        y: attachY - 0.25,
        z: attachZ,
        pivot: [attachX, attachY, attachZ],
        wallAnchor: [pav.x + sx * 1.86, attachY - 0.02, pav.z + sz * 1.86]
      });
    } else {
      const fx = pondCenterX - 11.5;
      const fz = pondCenterZ + 6.5;
      const fy = sampleGround(fx, fz);
      interior.push({
        id: 'pavilion-eave',
        mount: 'post',
        x: fx + 0.28,
        y: fy + 1.66,
        z: fz + 0.16,
        pivot: [fx + 0.28, fy + 1.90, fz + 0.16],
        postBase: [fx, fy, fz],
        postHeight: 1.90
      });
    }

    // 2. 溪涧小木桥桥头弯竹灯竿（高 1.85m，立于桥台侧畔不挡桥面）
    const br = leisureGrove?.layout?.bridge;
    if (br && Number.isFinite(br.x) && Number.isFinite(br.z)) {
      const tx = Number.isFinite(br.tx) ? br.tx : 1;
      const tz = Number.isFinite(br.tz) ? br.tz : 0;
      const ux = Number.isFinite(br.ux) ? br.ux : 0;
      const uz = Number.isFinite(br.uz) ? br.uz : 1;
      const halfL = (br.length ?? 3.6) * 0.5;
      const halfW = (br.width ?? 1.14) * 0.5;
      const baseX = br.x + tx * (halfL + 0.26) + ux * (halfW + 0.34);
      const baseZ = br.z + tz * (halfL + 0.26) + uz * (halfW + 0.34);
      const baseY = sampleGround(baseX, baseZ);
      const tipX = baseX - tx * 0.14 - ux * 0.26;
      const tipZ = baseZ - tz * 0.14 - uz * 0.26;
      const tipY = baseY + 1.85;
      interior.push({
        id: 'footbridge-post',
        mount: 'post',
        x: tipX,
        y: tipY - 0.23,
        z: tipZ,
        pivot: [tipX, tipY, tipZ],
        postBase: [baseX, baseY, baseZ],
        postHeight: 1.85
      });
    } else {
      const bx = pondCenterX - 9.8;
      const bz = pondCenterZ - 4.2;
      const by = sampleGround(bx, bz);
      interior.push({
        id: 'footbridge-post',
        mount: 'post',
        x: bx + 0.26,
        y: by + 1.62,
        z: bz - 0.14,
        pivot: [bx + 0.26, by + 1.85, bz - 0.14],
        postBase: [bx, by, bz],
        postHeight: 1.85
      });
    }

    // 3. 村口社树/石社旁弯竹风灯柱
    const soc = regions.find(r => r && r.kind === 'social');
    if (soc && Number.isFinite(soc.x) && Number.isFinite(soc.z)) {
      const baseX = soc.x - 1.76;
      const baseZ = soc.z - 0.78;
      const baseY = sampleGround(baseX, baseZ);
      const tipX = baseX + 0.28;
      const tipZ = baseZ + 0.18;
      const tipY = baseY + 1.92;
      interior.push({
        id: 'social-shrine-post',
        mount: 'post',
        x: tipX,
        y: tipY - 0.24,
        z: tipZ,
        pivot: [tipX, tipY, tipZ],
        postBase: [baseX, baseY, baseZ],
        postHeight: 1.92
      });
    } else {
      const sx = 24.5;
      const sz = -64.0;
      const sy = sampleGround(sx, sz);
      interior.push({
        id: 'social-shrine-post',
        mount: 'post',
        x: sx + 0.26,
        y: sy + 1.68,
        z: sz + 0.16,
        pivot: [sx + 0.26, sy + 1.92, sz + 0.16],
        postBase: [sx, sy, sz],
        postHeight: 1.92
      });
    }

    // 4. 秦汉织染棚前檐角
    const weave = qinHanHomestead?.layout?.weaving;
    if (weave && Number.isFinite(weave.x) && Number.isFinite(weave.z)) {
      const wy = Number.isFinite(weave.y) ? weave.y : sampleGround(weave.x, weave.z);
      const wyaw = weave.yaw ?? 0.35;
      const eavePt = ptRot(weave.x, wy, weave.z, wyaw, 1.32, 1.74, 1.02);
      const postPt = ptRot(weave.x, wy, weave.z, wyaw, 1.24, 1.68, 0.94);
      interior.push({
        id: 'weaving-shed-eave',
        mount: 'eave',
        x: eavePt[0],
        y: eavePt[1] - 0.23,
        z: eavePt[2],
        pivot: eavePt,
        wallAnchor: postPt
      });
    } else {
      const wx = -18.0;
      const wz = -176.0;
      const wy = sampleGround(wx, wz);
      interior.push({
        id: 'weaving-shed-eave',
        mount: 'post',
        x: wx + 0.28,
        y: wy + 1.64,
        z: wz + 0.16,
        pivot: [wx + 0.28, wy + 1.88, wz + 0.16],
        postBase: [wx, wy, wz],
        postHeight: 1.88
      });
    }

    // 5..7. 临街三户村舍前檐下（localX = w * 0.36, localZ = d * 0.5 + 0.22, y = gy + h - 0.22）
    const frontHouses = Array.isArray(village?.houseInfo) ? village.houseInfo.slice(0, 3) : [];
    for (let i = 0; i < 3; i++) {
      const hi = frontHouses[i];
      if (hi && Number.isFinite(hi.x) && Number.isFinite(hi.z)) {
        const w = hi.w ?? 4.8;
        const h = hi.h ?? 3.0;
        const d = hi.d ?? 3.8;
        const gy = Number.isFinite(hi.gy) ? hi.gy : sampleGround(hi.x, hi.z);
        const rot = hi.rot ?? 0;
        const localX = w * 0.36;
        const localZ = d * 0.5 + 0.22;
        const lanternY = gy + h - 0.22;
        const worldPos = ptRot(hi.x, 0, hi.z, rot, localX, lanternY, localZ);
        const wallAnchor = ptRot(hi.x, 0, hi.z, rot, localX, gy + h - 0.03, d * 0.5 - 0.02);
        const pivot = [worldPos[0], gy + h - 0.01, worldPos[2]];
        interior.push({
          id: `cottage-eave-${i}`,
          mount: 'bracket',
          x: worldPos[0],
          y: lanternY,
          z: worldPos[2],
          pivot,
          wallAnchor
        });
      } else {
        const fx = 16 + i * 11;
        const fz = -96 - i * 24;
        const fy = sampleGround(fx, fz);
        interior.push({
          id: `cottage-eave-${i}`,
          mount: 'post',
          x: fx + 0.24,
          y: fy + 2.45,
          z: fz + 0.20,
          pivot: [fx + 0.24, fy + 2.68, fz + 0.20],
          postBase: [fx, fy, fz],
          postHeight: 2.68
        });
      }
    }

    // 8. 外溪武陵渔舟渡口岸畔弯竹渔火灯柱（2.0m 高，择干爽岸坡立柱）
    const firstBoatPos = boats?.group?.children?.[0]?.position;
    const refX = Number.isFinite(firstBoatPos?.x) ? firstBoatPos.x : 14.0;
    const refZ = Number.isFinite(firstBoatPos?.z) ? firstBoatPos.z : 158.0;
    let bankX = 14.0;
    let bankZ = 158.0;
    let bankY = sampleGround(bankX, bankZ);
    if (bankY < waterLevel + 0.42 || bankY > waterLevel + 3.6) {
      let found = false;
      for (let r = 2.0; r <= 20.0 && !found; r += 1.5) {
        for (let k = 0; k < 16; k++) {
          const ang = (k / 16) * TAU;
          const tx = refX + Math.cos(ang) * r;
          const tz = refZ + Math.sin(ang) * r;
          const ty = sampleGround(tx, tz);
          if (ty >= waterLevel + 0.48 && ty <= waterLevel + 2.8) {
            bankX = tx;
            bankZ = tz;
            bankY = ty;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        bankY = Math.max(bankY, waterLevel + 0.55);
      }
    }
    const dirToWaterX = refX - bankX;
    const dirToWaterZ = refZ - bankZ;
    const dirLen = Math.hypot(dirToWaterX, dirToWaterZ) || 1;
    const archDx = (dirToWaterX / dirLen) * 0.40;
    const archDz = (dirToWaterZ / dirLen) * 0.40;
    const ferryPivot = [bankX + archDx, bankY + 2.0, bankZ + archDz];

    const exterior = [{
      id: 'wuling-ferry-post',
      mount: 'post',
      x: ferryPivot[0],
      y: ferryPivot[1] - 0.25,
      z: ferryPivot[2],
      pivot: ferryPivot,
      postBase: [bankX, bankY, bankZ],
      postHeight: 2.0
    }];

    return { interior, exterior };
  }

  const lanternAnchors = resolveLanternAnchors();
  const allLanterns = [...lanternAnchors.interior, ...lanternAnchors.exterior];

  function buildLanternMeshes(anchors, housesForPools = []) {
    const fPos = [];
    const fCol = [];
    const fPiv = [];
    const fSway = [];

    const gPos = [];
    const gUv = [];
    const gKind = [];
    const gPiv = [];
    const gSway = [];
    let warmPoolCount = 0;

    const cBambooDark = new THREE.Color('#4B3A26');
    const cBambooCulm = new THREE.Color('#6F6340');
    const cBambooNode = new THREE.Color('#4F462D');
    const cCord = new THREE.Color('#5A4934');
    const cPaperDay = new THREE.Color('#DDD0B4');
    const cPaperWarm = new THREE.Color('#E7D8B9');

    function pushFrameTri(a, b, c, ca, cb, cc, piv, sa, sb, sc) {
      fPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      fCol.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
      for (let k = 0; k < 3; k++) fPiv.push(piv[0], piv[1], piv[2]);
      fSway.push(sa, sb, sc);
    }

    function pushFrameTube(p0, p1, r0, r1, sides, col0, col1, piv, sway0, sway1) {
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const dz = p1[2] - p0[2];
      const len = Math.hypot(dx, dy, dz) || 1e-5;
      const ux = dx / len;
      const uy = dy / len;
      const uz = dz / len;
      let ax = 0, ay = 1, az = 0;
      if (Math.abs(uy) > 0.92) { ax = 1; ay = 0; az = 0; }
      let nx = uy * az - uz * ay;
      let ny = uz * ax - ux * az;
      let nz = ux * ay - uy * ax;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen; ny /= nLen; nz /= nLen;
      const bx = uy * nz - uz * ny;
      const by = uz * nx - ux * nz;
      const bz = ux * ny - uy * nx;

      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * TAU;
        const a1 = ((i + 1) / sides) * TAU;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        const v00 = [p0[0] + (nx * c0 + bx * s0) * r0, p0[1] + (ny * c0 + by * s0) * r0, p0[2] + (nz * c0 + bz * s0) * r0];
        const v01 = [p0[0] + (nx * c1 + bx * s1) * r0, p0[1] + (ny * c1 + by * s1) * r0, p0[2] + (nz * c1 + bz * s1) * r0];
        const v11 = [p1[0] + (nx * c1 + bx * s1) * r1, p1[1] + (ny * c1 + by * s1) * r1, p1[2] + (nz * c1 + bz * s1) * r1];
        const v10 = [p1[0] + (nx * c0 + bx * s0) * r1, p1[1] + (ny * c0 + by * s0) * r1, p1[2] + (nz * c0 + bz * s0) * r1];
        pushFrameTri(v00, v01, v11, col0, col0, col1, piv, sway0, sway0, sway1);
        pushFrameTri(v00, v11, v10, col0, col1, col1, piv, sway0, sway1, sway1);
      }
    }

    function pushGlowQuad(p0, p1, p2, p3, uv0, uv1, uv2, uv3, kind, piv, s0, s1, s2, s3) {
      gPos.push(
        p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2],
        p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]
      );
      gUv.push(
        uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1],
        uv0[0], uv0[1], uv2[0], uv2[1], uv3[0], uv3[1]
      );
      for (let k = 0; k < 6; k++) {
        gKind.push(kind);
        gPiv.push(piv[0], piv[1], piv[2]);
      }
      gSway.push(s0, s1, s2, s0, s2, s3);
    }

    for (let idx = 0; idx < anchors.length; idx++) {
      const a = anchors[idx];
      const piv = a.pivot;
      const cx = a.x;
      const cy = a.y;
      const cz = a.z;

      // 1. 支撑竹竿或檐下横挑竹臂（静态锚定 sway = 0）
      if (a.mount === 'post' && a.postBase) {
        const bx = a.postBase[0];
        const by = a.postBase[1] - 0.08;
        const bz = a.postBase[2];
        const segs = 5;
        let prev = [bx, by, bz];
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const bend = t * t;
          const cur = [
            bx + (piv[0] - bx) * bend,
            by + (piv[1] - by) * t + Math.sin(t * Math.PI) * 0.06,
            bz + (piv[2] - bz) * bend
          ];
          const r0 = 0.030 * (1 - (t - 1 / segs) * 0.35);
          const r1 = 0.030 * (1 - t * 0.35);
          pushFrameTube(prev, cur, r0, r1, 5, cBambooCulm, s % 2 ? cBambooNode : cBambooCulm, piv, 0, 0);
          prev = cur;
        }
      } else if (a.wallAnchor) {
        pushFrameTube(a.wallAnchor, piv, 0.018, 0.014, 4, cBambooDark, cBambooCulm, piv, 0, 0);
      }

      // 2. 悬绳（从锚点 sway=0 过渡至灯顶 sway=0.65）
      const topCapY = cy + 0.135;
      const botCapY = cy - 0.135;
      pushFrameTube(piv, [cx, topCapY + 0.02, cz], 0.006, 0.006, 3, cCord, cCord, piv, 0.0, 0.62);

      // 3. 竹编风灯骨架：上下竹箍、斗笠形防雨竹盖、6 根弧形竹篾竖骨、内衬宣纸罩
      const ribs = 6;
      const rCap = 0.082;
      const rBelly = 0.108;
      const swayTop = 0.66;
      const swayMid = 0.84;
      const swayBot = 1.0;

      // 防雨微拱竹盖
      const apex = [cx, topCapY + 0.036, cz];
      for (let k = 0; k < ribs; k++) {
        const ang0 = (k / ribs) * TAU;
        const ang1 = ((k + 1) / ribs) * TAU;
        const rim0 = [cx + Math.cos(ang0) * (rCap + 0.028), topCapY + 0.004, cz + Math.sin(ang0) * (rCap + 0.028)];
        const rim1 = [cx + Math.cos(ang1) * (rCap + 0.028), topCapY + 0.004, cz + Math.sin(ang1) * (rCap + 0.028)];
        pushFrameTri(rim0, rim1, apex, cBambooDark, cBambooDark, cBambooNode, piv, swayTop, swayTop, swayTop);

        // 上下竹圈横箍 + 弧形竹篾肋条
        const t0 = [cx + Math.cos(ang0) * rCap, topCapY, cz + Math.sin(ang0) * rCap];
        const t1 = [cx + Math.cos(ang1) * rCap, topCapY, cz + Math.sin(ang1) * rCap];
        const m0 = [cx + Math.cos(ang0) * rBelly, cy, cz + Math.sin(ang0) * rBelly];
        const m1 = [cx + Math.cos(ang1) * rBelly, cy, cz + Math.sin(ang1) * rBelly];
        const b0 = [cx + Math.cos(ang0) * rCap, botCapY, cz + Math.sin(ang0) * rCap];
        const b1 = [cx + Math.cos(ang1) * rCap, botCapY, cz + Math.sin(ang1) * rCap];

        pushFrameTube(t0, t1, 0.007, 0.007, 3, cBambooDark, cBambooDark, piv, swayTop, swayTop);
        pushFrameTube(b0, b1, 0.007, 0.007, 3, cBambooDark, cBambooDark, piv, swayBot, swayBot);
        pushFrameTube(t0, m0, 0.0055, 0.0055, 3, cBambooDark, cBambooCulm, piv, swayTop, swayMid);
        pushFrameTube(m0, b0, 0.0055, 0.0055, 3, cBambooCulm, cBambooDark, piv, swayMid, swayBot);

        // 内层温润油纸灯罩（白昼亦见竹骨宣纸质感）
        const pScale = 0.88;
        const pt0 = [cx + Math.cos(ang0) * rCap * pScale, topCapY - 0.008, cz + Math.sin(ang0) * rCap * pScale];
        const pt1 = [cx + Math.cos(ang1) * rCap * pScale, topCapY - 0.008, cz + Math.sin(ang1) * rCap * pScale];
        const pm0 = [cx + Math.cos(ang0) * rBelly * pScale, cy, cz + Math.sin(ang0) * rBelly * pScale];
        const pm1 = [cx + Math.cos(ang1) * rBelly * pScale, cy, cz + Math.sin(ang1) * rBelly * pScale];
        const pb0 = [cx + Math.cos(ang0) * rCap * pScale, botCapY + 0.008, cz + Math.sin(ang0) * rCap * pScale];
        const pb1 = [cx + Math.cos(ang1) * rCap * pScale, botCapY + 0.008, cz + Math.sin(ang1) * rCap * pScale];

        pushFrameTri(pt0, pm0, pm1, cPaperDay, cPaperWarm, cPaperWarm, piv, swayTop, swayMid, swayMid);
        pushFrameTri(pt0, pm1, pt1, cPaperDay, cPaperWarm, cPaperDay, piv, swayTop, swayMid, swayTop);
        pushFrameTri(pm0, pb0, pb1, cPaperWarm, cPaperDay, cPaperDay, piv, swayMid, swayBot, swayBot);
        pushFrameTri(pm0, pb1, pm1, cPaperWarm, cPaperDay, cPaperWarm, piv, swayMid, swayBot, swayMid);
      }

      // 4. 发光灯芯与柔和琥珀光晕（bamboo-lantern-glow）
      const coreR = 0.098;
      const coreH = 0.125;
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI;
        const dx = Math.cos(ang) * coreR;
        const dz = Math.sin(ang) * coreR;
        pushGlowQuad(
          [cx - dx, cy - coreH, cz - dz],
          [cx + dx, cy - coreH, cz + dz],
          [cx + dx, cy + coreH, cz + dz],
          [cx - dx, cy + coreH, cz - dz],
          [-1, -1], [1, -1], [1, 1], [-1, 1],
          0.0, piv, swayBot, swayBot, swayTop, swayTop
        );
      }

      const haloR = 0.54;
      for (let k = 0; k < 2; k++) {
        const ang = (k / 2) * Math.PI * 0.5 + 0.32;
        const dx = Math.cos(ang) * haloR;
        const dz = Math.sin(ang) * haloR;
        pushGlowQuad(
          [cx - dx, cy - haloR, cz - dz],
          [cx + dx, cy - haloR, cz + dz],
          [cx + dx, cy + haloR, cz + dz],
          [cx - dx, cy + haloR, cz - dz],
          [-1, -1], [1, -1], [1, 1], [-1, 1],
          1.0, piv, swayMid, swayMid, swayMid, swayMid
        );
      }
      pushGlowQuad(
        [cx - haloR * 0.85, cy - 0.02, cz - haloR * 0.85],
        [cx + haloR * 0.85, cy - 0.02, cz - haloR * 0.85],
        [cx + haloR * 0.85, cy - 0.02, cz + haloR * 0.85],
        [cx - haloR * 0.85, cy - 0.02, cz + haloR * 0.85],
        [-1, -1], [1, -1], [1, 1], [-1, 1],
        1.0, piv, swayMid, swayMid, swayMid, swayMid
      );

      // 5. 灯下地面琥珀暖光池（零额外 Draw Call，随地形贴合，白昼严格隐藏）
      const pr = 1.72;
      const p0 = [cx - pr, sampleGround(cx - pr, cz - pr) + 0.048, cz - pr];
      const p1 = [cx + pr, sampleGround(cx + pr, cz - pr) + 0.048, cz - pr];
      const p2 = [cx + pr, sampleGround(cx + pr, cz + pr) + 0.048, cz + pr];
      const p3 = [cx - pr, sampleGround(cx - pr, cz + pr) + 0.048, cz + pr];
      pushGlowQuad(p0, p1, p2, p3, [-1, -1], [1, -1], [1, 1], [-1, 1], 2.0, [cx, p0[1], cz], 0, 0, 0, 0);
      warmPoolCount++;
    }

    // 6. 村舍夜窗与门廊前地面暖晕池（零点光源、零额外 Draw Call）
    for (let hiIdx = 0; hiIdx < housesForPools.length && hiIdx < 14; hiIdx++) {
      const hi = housesForPools[hiIdx];
      if (!hi || !Number.isFinite(hi.x) || !Number.isFinite(hi.z)) continue;
      const rot = hi.rot || 0;
      const w = hi.w || 5.0;
      const d = hi.d || 4.0;
      const rx = Math.max(1.55, w * 0.44);
      const rz = 1.55;
      const frontOff = d * 0.5 + 1.12;
      const c0 = ptRot(hi.x, 0, hi.z, rot, -rx, 0, frontOff - rz);
      const c1 = ptRot(hi.x, 0, hi.z, rot,  rx, 0, frontOff - rz);
      const c2 = ptRot(hi.x, 0, hi.z, rot,  rx, 0, frontOff + rz);
      const c3 = ptRot(hi.x, 0, hi.z, rot, -rx, 0, frontOff + rz);
      c0[1] = sampleGround(c0[0], c0[2]) + 0.045;
      c1[1] = sampleGround(c1[0], c1[2]) + 0.045;
      c2[1] = sampleGround(c2[0], c2[2]) + 0.045;
      c3[1] = sampleGround(c3[0], c3[2]) + 0.045;
      pushGlowQuad(c0, c1, c2, c3, [-1, -1], [1, -1], [1, 1], [-1, 1], 2.0, [hi.x, c0[1], hi.z], 0, 0, 0, 0);
      warmPoolCount++;
    }

    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
    frameGeo.setAttribute('color', new THREE.Float32BufferAttribute(fCol, 3));
    frameGeo.setAttribute('aLanternPivot', new THREE.Float32BufferAttribute(fPiv, 3));
    frameGeo.setAttribute('aLanternSway', new THREE.Float32BufferAttribute(fSway, 1));
    frameGeo.computeVertexNormals();
    frameGeo.computeBoundingSphere();

    const frameMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide
    });
    chainBeforeCompile(frameMat, 'craft-lantern-frame-sway-v1', shader => {
      if (!shader.vertexShader.includes(BEGIN_VERTEX)) return;
      shader.uniforms.uSimTime = uCraftSimTime;
      shader.uniforms.uWind = uCraftWindVec;
      shader.vertexShader =
        'attribute vec3 aLanternPivot;\n' +
        'attribute float aLanternSway;\n' +
        'uniform float uSimTime;\n' +
        'uniform vec2 uWind;\n' +
        LANTERN_SWAY_GLSL +
        shader.vertexShader.replace(
          BEGIN_VERTEX,
          /* glsl */`
#include <begin_vertex>
transformed += craftLanternSwayOffset(aLanternPivot, aLanternSway, uSimTime, uWind);
`
        );
    });

    const framesMesh = new THREE.Mesh(frameGeo, frameMat);
    framesMesh.name = 'bamboo-lantern-frames';

    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
    glowGeo.setAttribute('aGlowUv', new THREE.Float32BufferAttribute(gUv, 2));
    glowGeo.setAttribute('aGlowKind', new THREE.Float32BufferAttribute(gKind, 1));
    glowGeo.setAttribute('aLanternPivot', new THREE.Float32BufferAttribute(gPiv, 3));
    glowGeo.setAttribute('aLanternSway', new THREE.Float32BufferAttribute(gSway, 1));
    glowGeo.computeBoundingSphere();

    const glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uSimTime: uCraftSimTime,
        uWind: uCraftWindVec,
        uLanternGlow: { value: 0 }
      },
      vertexShader: /* glsl */`
        attribute vec2 aGlowUv;
        attribute float aGlowKind;
        attribute vec3 aLanternPivot;
        attribute float aLanternSway;
        uniform float uSimTime;
        uniform vec2 uWind;
        varying vec2 vGlowUv;
        varying float vGlowKind;
        varying float vFlicker;
        ${LANTERN_SWAY_GLSL}
        void main() {
          vGlowUv = aGlowUv;
          vGlowKind = aGlowKind;
          float seed = aLanternPivot.x * 1.13 + aLanternPivot.z * 0.87;
          vFlicker = 0.88 + 0.08 * sin(uSimTime * 5.7 + seed) + 0.04 * sin(uSimTime * 12.3 + seed * 2.1);
          vec3 displaced = position + craftLanternSwayOffset(aLanternPivot, aLanternSway, uSimTime, uWind);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uLanternGlow;
        varying vec2 vGlowUv;
        varying float vGlowKind;
        varying float vFlicker;
        void main() {
          float r2 = dot(vGlowUv, vGlowUv);
          if (r2 >= 1.0 || uLanternGlow <= 0.005) discard;
          vec3 coreAmber = vec3(1.0, 0.702, 0.361); // #FFB35C
          vec3 haloAmber = vec3(0.910, 0.478, 0.204); // #E87A34
          float falloff = 1.0 - r2;
          float alpha;
          vec3 col;
          if (vGlowKind < 0.5) {
            float wickHeart = exp(-r2 * 5.2);
            alpha = falloff * falloff * 0.62 * uLanternGlow * vFlicker;
            col = mix(haloAmber, coreAmber, 0.45 + 0.55 * wickHeart);
          } else if (vGlowKind < 1.5) {
            alpha = falloff * falloff * falloff * 0.24 * uLanternGlow * vFlicker;
            col = mix(haloAmber, coreAmber, falloff * 0.45);
          } else {
            // 窗下与灯下地面暖光池（柔和琥珀漫射，无硬边）
            float softPool = pow(falloff, 2.35);
            alpha = softPool * 0.25 * uLanternGlow * (0.90 + 0.10 * vFlicker);
            col = mix(vec3(0.84, 0.48, 0.18), coreAmber, falloff * 0.42);
          }
          gl_FragColor = vec4(col * alpha, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    glowMat.userData = { skyIgnore: true };

    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.name = 'bamboo-lantern-glow';
    glowMesh.visible = false;

    return { frameGeo, frameMat, framesMesh, glowGeo, glowMat, glowMesh, warmPoolCount };
  }

  const interiorLanternRig = buildLanternMeshes(lanternAnchors.interior, Array.isArray(village?.houseInfo) ? village.houseInfo : []);
  const exteriorLanternRig = buildLanternMeshes(lanternAnchors.exterior, []);
  const totalWarmPools = interiorLanternRig.warmPoolCount + exteriorLanternRig.warmPoolCount;

  // Part B.2: 绕灯微蛾（单 Points 批次，仅暖晴暮夜显形，白昼/雨/冬严格隐藏 0 draw）
  const MOTHS_PER_LANTERN = 4;
  const mothAnchors = lanternAnchors.interior;
  const mothCount = mothAnchors.length * MOTHS_PER_LANTERN;
  const mothPos = new Float32Array(Math.max(1, mothCount) * 3);
  const mothParams = new Float32Array(Math.max(1, mothCount) * 4); // radius, speed, phase, tilt
  for (let i = 0; i < mothAnchors.length; i++) {
    const a = mothAnchors[i];
    for (let k = 0; k < MOTHS_PER_LANTERN; k++) {
      const idx = i * MOTHS_PER_LANTERN + k;
      mothPos[idx * 3] = a.x;
      mothPos[idx * 3 + 1] = a.y - 0.14;
      mothPos[idx * 3 + 2] = a.z;
      mothParams[idx * 4] = 0.24 + ((k * 37 + i * 19) % 10) * 0.032;
      mothParams[idx * 4 + 1] = 1.65 + ((k * 23 + i * 11) % 7) * 0.26;
      mothParams[idx * 4 + 2] = ((idx * 1.6180339) % 1) * TAU;
      mothParams[idx * 4 + 3] = ((k % 2 === 0 ? 1 : -1) * (0.28 + (k * 0.14)));
    }
  }
  const mothGeo = new THREE.BufferGeometry();
  mothGeo.setAttribute('position', new THREE.BufferAttribute(mothPos, 3));
  mothGeo.setAttribute('aMothParam', new THREE.BufferAttribute(mothParams, 4));
  mothGeo.computeBoundingSphere();
  const mothMat = new THREE.ShaderMaterial({
    uniforms: {
      uSimTime: uCraftSimTime,
      uMothGain: { value: 0 }
    },
    vertexShader: /* glsl */`
      attribute vec4 aMothParam;
      uniform float uSimTime;
      uniform float uMothGain;
      varying float vAlpha;
      void main() {
        float rad = aMothParam.x;
        float spd = aMothParam.y;
        float ph = aMothParam.z;
        float tilt = aMothParam.w;
        float t = uSimTime * spd + ph;
        vec3 offset = vec3(
          cos(t) * rad,
          sin(t * 2.1 + ph) * 0.12 + cos(t * 0.7) * 0.05,
          sin(t + tilt) * rad * 0.88
        );
        vec4 mvPos = modelViewMatrix * vec4(position + offset, 1.0);
        float dist = max(0.8, -mvPos.z);
        float distFade = 1.0 - smoothstep(14.0, 28.0, dist);
        float wing = 0.62 + 0.38 * sin(uSimTime * 22.0 + ph * 5.0);
        vAlpha = uMothGain * distFade * wing;
        gl_PointSize = vAlpha > 0.01 ? clamp(54.0 / dist, 1.8, 7.5) : 0.0;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      void main() {
        if (vAlpha <= 0.01) discard;
        vec2 uv = gl_PointCoord - vec2(0.5);
        float r2 = dot(uv, uv) * 4.0;
        if (r2 >= 1.0) discard;
        float soft = (1.0 - r2) * (1.0 - r2);
        vec3 col = vec3(1.0, 0.92, 0.74);
        gl_FragColor = vec4(col * soft * vAlpha, soft * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  mothMat.userData = { skyIgnore: true };
  const lanternMothsMesh = new THREE.Points(mothGeo, mothMat);
  lanternMothsMesh.name = 'lantern-moths';
  lanternMothsMesh.visible = false;
  interiorGroup.add(lanternMothsMesh);

  interiorGroup.add(interiorLanternRig.framesMesh, interiorLanternRig.glowMesh);
  exteriorGroup.add(exteriorLanternRig.framesMesh, exteriorLanternRig.glowMesh);

  // ============================================================================
  // Part C.1: Pond Fireflies & Water Mirror Twins (`pond-fireflies`, 96 vertices)
  // ============================================================================
  const ffRand = lcg(84729);
  const ffBaseAngle = new Float32Array(FIREFLY_COUNT);
  const ffBaseRadius = new Float32Array(FIREFLY_COUNT);
  const ffHoverH = new Float32Array(FIREFLY_COUNT);
  const ffOrbitSpd = new Float32Array(FIREFLY_COUNT);
  const ffBobSpd = new Float32Array(FIREFLY_COUNT);
  const ffPhase = new Float32Array(FIREFLY_COUNT);

  const ffPosArray = new Float32Array(FIREFLY_VERTICES * 3);
  const ffKindArray = new Float32Array(FIREFLY_VERTICES);
  const ffSeedArray = new Float32Array(FIREFLY_VERTICES * 2);
  const ffMirrorMaskArray = new Float32Array(FIREFLY_VERTICES);

  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const ang = (i / FIREFLY_COUNT) * TAU + (ffRand() - 0.5) * 0.28;
    const shoreR = samplePondRadiusAtAngle(ang);
    // 约 75% 栖游于荷叶与池湾水面之上（双生倒影清晰可见），25% 穿梭于岸竹芦苇浅湾
    const rFrac = i % 4 === 0 ? (0.86 + ffRand() * 0.28) : (0.22 + ffRand() * 0.68);
    ffBaseAngle[i] = ang;
    ffBaseRadius[i] = shoreR * rFrac;
    ffHoverH[i] = 0.35 + ffRand() * 1.50; // 0.35..1.85m
    ffOrbitSpd[i] = (0.09 + ffRand() * 0.14) * (i % 2 === 0 ? 1 : -1);
    ffBobSpd[i] = 0.95 + ffRand() * 1.15;
    ffPhase[i] = ffRand() * TAU;

    const airIdx = i * 2;
    const refIdx = airIdx + 1;
    ffKindArray[airIdx] = 0.0;
    ffKindArray[refIdx] = 1.0;

    const pulseRate = 1.45 + ffRand() * 1.65;
    ffSeedArray[airIdx * 2] = ffPhase[i];
    ffSeedArray[airIdx * 2 + 1] = pulseRate;
    ffSeedArray[refIdx * 2] = ffPhase[i];
    ffSeedArray[refIdx * 2 + 1] = pulseRate;
  }

  const fireflyGeo = new THREE.BufferGeometry();
  const fireflyPosAttr = new THREE.BufferAttribute(ffPosArray, 3);
  const fireflyMirrorAttr = new THREE.BufferAttribute(ffMirrorMaskArray, 1);
  fireflyGeo.setAttribute('position', fireflyPosAttr);
  fireflyGeo.setAttribute('aIsReflection', new THREE.BufferAttribute(ffKindArray, 1));
  fireflyGeo.setAttribute('aPulseSeed', new THREE.BufferAttribute(ffSeedArray, 2));
  fireflyGeo.setAttribute('aMirrorMask', fireflyMirrorAttr);

  function syncFireflyPositions(clockVal) {
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const ph = ffPhase[i];
      const ang = ffBaseAngle[i] + Math.sin(clockVal * ffOrbitSpd[i] + ph) * 0.28 + clockVal * ffOrbitSpd[i] * 0.18;
      const radialDrift = Math.sin(clockVal * 0.62 + ph * 1.7) * 0.65;
      const rad = Math.max(1.2, ffBaseRadius[i] + radialDrift);
      const wx = pondCenterX + Math.cos(ang) * rad;
      const wz = pondCenterZ + Math.sin(ang) * rad;

      const shoreR = samplePondRadiusAtAngle(ang);
      const surfaceBase = rad <= shoreR ? pondWaterY : Math.max(pondWaterY, sampleGround(wx, wz));
      const hover = clamp(
        ffHoverH[i] + Math.sin(clockVal * ffBobSpd[i] + ph) * 0.22,
        0.35,
        1.85
      );
      const airY = surfaceBase + hover;

      const airBase = i * 6;
      ffPosArray[airBase] = wx;
      ffPosArray[airBase + 1] = airY;
      ffPosArray[airBase + 2] = wz;

      // 水面镜像双生点：y = pondWaterY - (airY - pondWaterY) * 0.35 - 0.02
      const inPondMask = 1.0 - smooth01((rad - (shoreR - 0.15)) / 0.65);
      const mirrorY = pondWaterY - (airY - pondWaterY) * 0.35 - 0.02;
      ffPosArray[airBase + 3] = wx;
      ffPosArray[airBase + 4] = mirrorY;
      ffPosArray[airBase + 5] = wz;

      ffMirrorMaskArray[i * 2] = 1.0;
      ffMirrorMaskArray[i * 2 + 1] = inPondMask;
    }
    fireflyPosAttr.needsUpdate = true;
    fireflyMirrorAttr.needsUpdate = true;
  }
  syncFireflyPositions(0);
  fireflyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(pondCenterX, pondWaterY + 0.8, pondCenterZ), pondWaterRadius + 8.0);

  const fireflyMat = new THREE.ShaderMaterial({
    uniforms: {
      uSimTime: uCraftSimTime,
      uFireflyGain: { value: 0 }
    },
    vertexShader: /* glsl */`
      attribute float aIsReflection;
      attribute vec2 aPulseSeed;
      attribute float aMirrorMask;
      uniform float uSimTime;
      uniform float uFireflyGain;
      varying float vAlpha;
      varying float vIsRef;
      void main() {
        vIsRef = aIsReflection;
        float pulse = 0.5 + 0.5 * sin(uSimTime * aPulseSeed.y + aPulseSeed.x);
        float glow = 0.18 + 0.82 * pulse * pulse;
        vec3 wp = position;
        if (aIsReflection > 0.5) {
          // 池水微澜横向轻颤
          wp.x += sin(uSimTime * 4.1 + aPulseSeed.x * 2.7) * 0.055;
          wp.z += cos(uSimTime * 3.5 + aPulseSeed.x * 2.1) * 0.055;
          vAlpha = glow * 0.38 * aMirrorMask * uFireflyGain;
        } else {
          vAlpha = glow * uFireflyGain;
        }
        vec4 mvPosition = modelViewMatrix * vec4(wp, 1.0);
        float dist = max(1.4, -mvPosition.z);
        float distFade = 1.0 - smoothstep(34.0, 58.0, dist);
        vAlpha *= distFade;
        float basePt = aIsReflection > 0.5 ? 155.0 : 128.0;
        gl_PointSize = vAlpha > 0.004 ? clamp(basePt / dist, 2.2, 24.0) : 0.0;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      varying float vIsRef;
      void main() {
        if (vAlpha <= 0.004) discard;
        vec2 uv = gl_PointCoord - vec2(0.5);
        if (vIsRef > 0.5) {
          uv.y *= 1.45; // 水面波光横向微展
        }
        float r2 = dot(uv, uv) * 4.0;
        if (r2 >= 1.0) discard;
        float core = exp(-r2 * 4.6);
        float halo = (1.0 - r2) * (1.0 - r2);
        vec3 colCore = vec3(0.784, 0.949, 0.427); // #C8F26D
        vec3 colHalo = vec3(0.545, 0.847, 0.353); // #8BD85A
        vec3 col = mix(colHalo, colCore, core);
        float a = (halo * 0.58 + core * 0.62) * vAlpha;
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  fireflyMat.userData = { skyIgnore: true };

  const pondFirefliesMesh = new THREE.Points(fireflyGeo, fireflyMat);
  pondFirefliesMesh.name = 'pond-fireflies';
  pondFirefliesMesh.visible = false;
  interiorGroup.add(pondFirefliesMesh);

  // ============================================================================
  // Part C.2: Morning Dewdrop Sparkles (`morning-dew-glints`, 120 vertices)
  // ============================================================================
  function buildDewdropPoints() {
    const dewRand = lcg(61943);
    const pos = new Float32Array(DEW_COUNT * 3);
    const seeds = new Float32Array(DEW_COUNT * 2);
    const phases = new Float32Array(DEW_COUNT);

    const houseList = Array.isArray(village?.houseInfo) ? village.houseInfo : [];
    const roadPts = Array.isArray(world?.village?.road?.points) ? world.village.road.points : [];

    function isNearRoadOrHouse(x, z) {
      if (Math.hypot(x - slitX, z - slitZ) < 22.0) return true;
      for (let i = 0; i < houseList.length; i++) {
        const h = houseList[i];
        if (Math.hypot(x - h.x, z - h.z) < 5.4) return true;
      }
      for (let i = 0; i < roadPts.length - 1; i++) {
        const ax = roadPts[i][0], az = roadPts[i][1];
        const bx = roadPts[i + 1][0], bz = roadPts[i + 1][1];
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
        const px = ax + dx * t, pz = az + dz * t;
        if (Math.hypot(x - px, z - pz) < 3.2) return true;
      }
      return false;
    }

    let placed = 0;

    // 1) 池塘荷叶晨露珠光（20 颗）
    for (let k = 0; k < 20 && placed < DEW_COUNT; k++) {
      const ang = (k / 20) * TAU + dewRand() * 0.25;
      const shoreR = samplePondRadiusAtAngle(ang);
      const r = shoreR * (0.28 + dewRand() * 0.62);
      const x = pondCenterX + Math.cos(ang) * r;
      const z = pondCenterZ + Math.sin(ang) * r;
      const y = pondWaterY + 0.16 + dewRand() * 0.14;
      pos[placed * 3] = x;
      pos[placed * 3 + 1] = y;
      pos[placed * 3 + 2] = z;
      placed++;
    }

    // 2) 村落草甸田塍草尖朝露（70 颗，避开屋舍/道路/洞口/深水）
    let guard = 0;
    while (placed < 90 && guard++ < 1200) {
      const ang = dewRand() * TAU;
      const rad = 16 + Math.sqrt(dewRand()) * (basinInner * 0.86 - 16);
      const x = basinX + Math.cos(ang) * rad;
      const z = basinZ + Math.sin(ang) * rad;
      if (Math.hypot(x - pondCenterX, z - pondCenterZ) < pondWaterRadius + 0.6) continue;
      if (isNearRoadOrHouse(x, z)) continue;
      const gy = sampleGround(x, z);
      if (gy < waterLevel + 0.6 || gy > 7.5) continue;
      pos[placed * 3] = x;
      pos[placed * 3 + 1] = gy + 0.16 + dewRand() * 0.22;
      pos[placed * 3 + 2] = z;
      placed++;
    }

    // 3) 外溪武陵两岸芳草晨露（30 颗）
    guard = 0;
    while (placed < DEW_COUNT && guard++ < 1200) {
      const z = 24 + dewRand() * 148;
      const x = -48 + dewRand() * 96;
      if (Math.hypot(x - slitX, z - slitZ) < 22.0) continue;
      const gy = sampleGround(x, z);
      if (gy < waterLevel + 0.35 || gy > waterLevel + 3.6) continue;
      pos[placed * 3] = x;
      pos[placed * 3 + 1] = gy + 0.16 + dewRand() * 0.22;
      pos[placed * 3 + 2] = z;
      placed++;
    }

    // 兜底补齐 120 颗
    while (placed < DEW_COUNT) {
      const ang = (placed / DEW_COUNT) * TAU;
      const x = basinX + Math.cos(ang) * 42;
      const z = basinZ + Math.sin(ang) * 42;
      const gy = sampleGround(x, z);
      pos[placed * 3] = x;
      pos[placed * 3 + 1] = gy + 0.22;
      pos[placed * 3 + 2] = z;
      placed++;
    }

    for (let i = 0; i < DEW_COUNT; i++) {
      const sa = dewRand() * TAU;
      const sMag = 0.75 + dewRand() * 0.85;
      seeds[i * 2] = Math.cos(sa) * sMag;
      seeds[i * 2 + 1] = Math.sin(sa) * sMag;
      phases[i] = dewRand() * TAU;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDewSeed', new THREE.BufferAttribute(seeds, 2));
    geo.setAttribute('aDewPhase', new THREE.BufferAttribute(phases, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  const dewGeo = buildDewdropPoints();
  const dewMat = new THREE.ShaderMaterial({
    uniforms: {
      uDewTime: { value: 0 },
      uDewGain: { value: 0 }
    },
    vertexShader: /* glsl */`
      attribute vec2 aDewSeed;
      attribute float aDewPhase;
      uniform float uDewTime;
      uniform float uDewGain;
      varying float vDewAlpha;
      varying float vPrismShift;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        float camDist = distance(cameraPosition, worldPos.xyz);
        float distFade = 1.0 - smoothstep(18.0, 32.0, camDist);
        float parallaxTwinkle = 0.5 + 0.5 * sin(dot(cameraPosition.xz, aDewSeed) * 3.2 + uDewTime * 1.4 + aDewPhase);
        float glint = pow(parallaxTwinkle, 2.4);
        vDewAlpha = uDewGain * distFade * (0.20 + 0.80 * glint);
        vPrismShift = parallaxTwinkle;
        vec4 mvPosition = viewMatrix * worldPos;
        float ptSize = clamp(96.0 / max(1.2, -mvPosition.z), 2.0, 14.0) * (0.72 + 0.42 * glint);
        gl_PointSize = (camDist <= 32.0 && vDewAlpha > 0.005) ? ptSize : 0.0;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */`
      varying float vDewAlpha;
      varying float vPrismShift;
      void main() {
        if (vDewAlpha <= 0.005) discard;
        vec2 uv = gl_PointCoord - vec2(0.5);
        float r2 = dot(uv, uv) * 4.0;
        if (r2 >= 1.0) discard;
        float r = sqrt(r2);
        float diamondRay = exp(-abs(uv.x) * 16.0) * exp(-abs(uv.y) * 5.2) + exp(-abs(uv.y) * 16.0) * exp(-abs(uv.x) * 5.2);
        float core = exp(-r2 * 6.5);
        float prismRing = smoothstep(0.22, 0.62, r) * (1.0 - smoothstep(0.62, 1.0, r));
        vec3 colCore = vec3(0.933, 0.973, 1.0);   // #EEF8FF
        vec3 colPrism = vec3(1.0, 0.914, 0.784);  // #FFE9C8
        vec3 col = mix(colCore, colPrism, clamp(prismRing * 1.35 + (1.0 - vPrismShift) * 0.25, 0.0, 1.0));
        float shape = core * 0.78 + diamondRay * 0.34 + prismRing * 0.28;
        float a = clamp(shape * vDewAlpha, 0.0, 1.0);
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  dewMat.userData = { skyIgnore: true };

  const morningDewMesh = new THREE.Points(dewGeo, dewMat);
  morningDewMesh.name = 'morning-dew-glints';
  morningDewMesh.frustumCulled = false;
  morningDewMesh.visible = false;
  group.add(morningDewMesh);

  // ============================================================================
  // Sky Registration, Dynamic State & Strict Pause-Freeze Update
  // ============================================================================
  function registerSky(skyInstance) {
    if (skyInstance) boundSky = skyInstance;
    if (boundSky && typeof boundSky.registerMaterials === 'function') {
      boundSky.registerMaterials(group);
    }
  }
  if (boundSky) {
    registerSky(boundSky);
  }

  let curTimeId = 'day';
  let curWeatherId = 'clear';
  let curPhenologyId = 'spring';
  let curRain = 0;
  let curLanternGlow = 0;
  let curFireflyGain = 0;
  let curDewGain = 0;
  let postRainDew = 0;
  let wasRaining = false;

  function resolveSkyArg(rest) {
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a && typeof a === 'object' && ('timeId' in a || 'weatherId' in a || typeof a.getAppearance === 'function')) {
        return a;
      }
    }
    return boundSky;
  }

  function resolvePhenologyId(rest, activeSky) {
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (typeof a === 'string' && (a === 'spring' || a === 'summer' || a === 'autumn' || a === 'winter')) {
        return a;
      }
      if (a && typeof a === 'object') {
        if (typeof a.currentId === 'string') return a.currentId;
        if (typeof a.phenologyId === 'string') return a.phenologyId;
        if (a.phenology) {
          if (typeof a.phenology.currentId === 'string') return a.phenology.currentId;
          if (typeof a.phenology.phenologyId === 'string') return a.phenology.phenologyId;
        }
        if (typeof a.getStats === 'function') {
          const st = a.getStats();
          if (st && typeof st.phenologyId === 'string') return st.phenologyId;
        }
        if (a.phenology && typeof a.phenology.getStats === 'function') {
          const st = a.phenology.getStats();
          if (st && typeof st.phenologyId === 'string') return st.phenologyId;
        }
      }
    }
    if (boundPhenology) {
      if (typeof boundPhenology.currentId === 'string') return boundPhenology.currentId;
      if (typeof boundPhenology.phenologyId === 'string') return boundPhenology.phenologyId;
      if (typeof boundPhenology.getStats === 'function') {
        const st = boundPhenology.getStats();
        if (st && typeof st.phenologyId === 'string') return st.phenologyId;
      }
    }
    if (activeSky && typeof activeSky.phenologyId === 'string') {
      return activeSky.phenologyId;
    }
    const doc = typeof document !== 'undefined' ? document : null;
    const hudTxt = doc?.getElementById?.('sky-phenology')?.textContent || '';
    if (hudTxt.includes('冬')) return 'winter';
    if (hudTxt.includes('夏')) return 'summer';
    if (hudTxt.includes('秋')) return 'autumn';
    if (hudTxt.includes('春')) return 'spring';
    return curPhenologyId || 'spring';
  }

  function syncWarmSources() {
    // Slot 0: 晴夜村心篝火夜宴（仅活跃时开启）
    const feast = qinHanCompletion?.getNightFeastState?.();
    if (feast && feast.active && Number.isFinite(feast.x) && Number.isFinite(feast.z)) {
      const fy = Number.isFinite(feast.y) ? feast.y : sampleGround(feast.x, feast.z);
      warmSources[0].set(feast.x, fy + 0.55, feast.z, 1 / 11.5);
    } else {
      warmSources[0].set(0, -1000, 0, 0);
    }

    // Slot 1: 晒谷场石坛火塘
    const hearth = qinHanHomestead?.layout?.hearth;
    if (hearth && Number.isFinite(hearth.x) && Number.isFinite(hearth.z) && curRain < 0.65) {
      const hy = Number.isFinite(hearth.y) ? hearth.y : sampleGround(hearth.x, hearth.z);
      warmSources[1].set(hearth.x, hy + 0.45, hearth.z, 1 / 8.5);
    } else {
      warmSources[1].set(0, -1000, 0, 0);
    }

    // Slots 2..9: 8 盏竹编风灯
    for (let i = 0; i < 8; i++) {
      const lan = allLanterns[i];
      if (lan && curLanternGlow > 0.01) {
        warmSources[2 + i].set(lan.x, lan.y, lan.z, 1 / 7.2);
      } else {
        warmSources[2 + i].set(0, -1000, 0, 0);
      }
    }
  }

  function update(dt, ...rest) {
    if (disposed) return;

    const activeSky = resolveSkyArg(rest);
    if (activeSky) boundSky = activeSky;

    const app = boundSky?.getAppearance?.();
    curTimeId = boundSky?.timeId || app?.timeId || 'day';
    curWeatherId = boundSky?.weatherId || app?.weatherId || 'clear';
    curRain = Number.isFinite(boundSky?.rainIntensity)
      ? boundSky.rainIntensity
      : (curWeatherId === 'rain' ? 0.85 : 0);
    curPhenologyId = resolvePhenologyId(rest, boundSky);

    const activeStep = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;

    // 严格暂停冻结：dt <= 0 或非有限值时绝不推进 simTime、流萤位移、风灯摇曳与朝露相位
    if (activeStep > 0) {
      simTime += activeStep;
      uCraftSimTime.value = simTime;
      dewMat.uniforms.uDewTime.value = simTime;

      const wx = Number.isFinite(boundSky?.windX) ? boundSky.windX : 0.28;
      const wz = Number.isFinite(boundSky?.windZ) ? boundSky.windZ : 0.10;
      uCraftWindVec.value.set(wx * 0.22, wz * 0.22);

      if (curRain > 0.22 || curWeatherId === 'rain') {
        postRainDew = Math.min(1.0, postRainDew + activeStep * 0.55);
        wasRaining = true;
      } else if (postRainDew > 0) {
        postRainDew = Math.max(0, postRainDew - activeStep / 42.0);
      }
    } else {
      if (curRain > 0.22 || curWeatherId === 'rain') {
        wasRaining = true;
      } else if (wasRaining && curWeatherId !== 'rain') {
        postRainDew = Math.max(postRainDew, 1.0);
        wasRaining = false;
      }
    }

    uCraftRain.value = clamp(curRain, 0, 1);
    uCraftWetSheen.value = clamp(Math.max(curRain, postRainDew * 0.7), 0, 1);

    // 1. 竹编风灯亮度与显隐（晴朗白昼严格 0 draw！）
    let lanternTarget = 0;
    if (curTimeId === 'night') lanternTarget = 1.0;
    else if (curTimeId === 'dusk') lanternTarget = 0.72;
    else if (curTimeId === 'dawn') lanternTarget = 0.36;
    else if (curWeatherId === 'rain' || curRain > 0.35) {
      lanternTarget = 0.26 * clamp((Math.max(curRain, curWeatherId === 'rain' ? 0.75 : 0) - 0.25) / 0.55, 0, 1);
    }
    curLanternGlow = lanternTarget;
    interiorLanternRig.glowMat.uniforms.uLanternGlow.value = curLanternGlow;
    exteriorLanternRig.glowMat.uniforms.uLanternGlow.value = curLanternGlow;
    const showLanternGlow = curLanternGlow > 0.01;
    interiorLanternRig.glowMesh.visible = showLanternGlow;
    exteriorLanternRig.glowMesh.visible = showLanternGlow;

    const mothGain = (curLanternGlow > 0.35 && curRain < 0.22 && curPhenologyId !== 'winter' && mothCount > 0)
      ? clamp((curLanternGlow - 0.30) * 1.35 * (1.0 - curRain * 3.5), 0, 1)
      : 0;
    mothMat.uniforms.uMothGain.value = mothGain;
    lanternMothsMesh.visible = mothGain > 0.01;

    // 2. 人物暖色火光轮廓边缘光 + 晴夜屋脊月华银边 + 暮夜纸窗檐下暖晕（白昼严格 0，不改变白昼任何像素！）
    let rimTarget = 0;
    if (curTimeId === 'night') rimTarget = 0.72;
    else if (curTimeId === 'dusk') rimTarget = 0.42;
    else if (curTimeId === 'dawn') rimTarget = 0.24;
    uWarmRimStrength.value = rimTarget;
    uMoonSilverStrength.value = curTimeId === 'night' ? (0.62 * clamp(1.0 - curRain * 1.15, 0.08, 1.0)) : 0;
    uWindowWarmBounce.value = curTimeId === 'night' ? 0.75 : (curTimeId === 'dusk' ? 0.42 : 0);
    if (rimTarget > 0.001) {
      syncWarmSources();
    }

    // 3. 夏夜荷塘双生流萤（仅暮/夜可见，夏初新荷 1.28x 增益，暴雨敛迹，昼/晓严格隐藏）
    let ffBase = 0;
    if (curTimeId === 'night') ffBase = 1.0;
    else if (curTimeId === 'dusk') ffBase = 0.55;
    const summerBoost = curPhenologyId === 'summer' ? 1.28 : 1.0;
    const rainSuppress = clamp(1.0 - curRain * 1.38, 0, 1);
    curFireflyGain = ffBase * summerBoost * rainSuppress;
    fireflyMat.uniforms.uFireflyGain.value = curFireflyGain;
    const showFireflies = curFireflyGain > 0.01;
    pondFirefliesMesh.visible = showFireflies;
    if (showFireflies && activeStep > 0) {
      syncFireflyPositions(simTime);
    }

    // 4. 晓雾草尖朝露微芒（晓 1.0 + 雨后初霁微光 0.35；晴昼/暮/夜严格隐藏）
    let dewTarget = 0;
    if (curTimeId === 'dawn') {
      dewTarget = 1.0 * clamp(1.0 - curRain * 0.80, 0.18, 1.0);
    } else if (curTimeId === 'day' && postRainDew > 0.04 && curRain < 0.25 && curWeatherId !== 'rain') {
      dewTarget = 0.35 * postRainDew;
    }
    curDewGain = dewTarget;
    dewMat.uniforms.uDewGain.value = curDewGain;
    morningDewMesh.visible = curDewGain > 0.01;
  }

  function getStats() {
    let drawCalls = 0;
    if (group.visible) {
      if (interiorGroup.visible) {
        if (interiorLanternRig.framesMesh.visible) drawCalls += 1;
        if (interiorLanternRig.glowMesh.visible) drawCalls += 1;
        if (lanternMothsMesh.visible) drawCalls += 1;
        if (pondFirefliesMesh.visible) drawCalls += 1;
      }
      if (exteriorGroup.visible) {
        if (exteriorLanternRig.framesMesh.visible) drawCalls += 1;
        if (exteriorLanternRig.glowMesh.visible) drawCalls += 1;
      }
      if (morningDewMesh.visible) drawCalls += 1;
    }

    return {
      built: true,
      disposed,
      simTime: +simTime.toFixed(4),
      timeId: curTimeId,
      weatherId: curWeatherId,
      phenologyId: curPhenologyId,
      drawCalls,
      lanternCount: allLanterns.length,
      interiorLanternCount: lanternAnchors.interior.length,
      exteriorLanternCount: lanternAnchors.exterior.length,
      lanternGlow: +curLanternGlow.toFixed(3),
      lanternGlowVisible: interiorLanternRig.glowMesh.visible,
      warmPoolCount: totalWarmPools,
      mothCount,
      mothsVisible: lanternMothsMesh.visible,
      warmRimStrength: +uWarmRimStrength.value.toFixed(3),
      fireflyCount: FIREFLY_COUNT,
      fireflyVertices: FIREFLY_VERTICES,
      fireflyGain: +curFireflyGain.toFixed(3),
      firefliesVisible: pondFirefliesMesh.visible,
      dewCount: DEW_COUNT,
      dewGain: +curDewGain.toFixed(3),
      dewVisible: morningDewMesh.visible,
      hookedMaterials: {
        roof: hookedRoofMaterials,
        wall: hookedWallMaterials,
        road: hookedRoadMaterials,
        actor: hookedActorMaterials
      }
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;

    for (let i = materialRestorers.length - 1; i >= 0; i--) {
      materialRestorers[i]();
    }
    materialRestorers.length = 0;

    interiorLanternRig.frameGeo.dispose();
    interiorLanternRig.frameMat.dispose();
    interiorLanternRig.glowGeo.dispose();
    interiorLanternRig.glowMat.dispose();

    exteriorLanternRig.frameGeo.dispose();
    exteriorLanternRig.frameMat.dispose();
    exteriorLanternRig.glowGeo.dispose();
    exteriorLanternRig.glowMat.dispose();

    mothGeo.dispose();
    mothMat.dispose();

    fireflyGeo.dispose();
    fireflyMat.dispose();

    dewGeo.dispose();
    dewMat.dispose();

    group.removeFromParent();
  }

  return {
    group,
    interiorGroup,
    exteriorGroup,
    hookMaterials,
    registerSky,
    update,
    getStats,
    dispose
  };
}
