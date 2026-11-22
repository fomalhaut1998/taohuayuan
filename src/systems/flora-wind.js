import * as THREE from 'three';

const installed = new WeakMap();
const BEGIN_VERTEX = '#include <begin_vertex>';
const DEFAULTNORMAL_VERTEX = '#include <defaultnormal_vertex>';
const NORMAL_FRAGMENT_BEGIN = '#include <normal_fragment_begin>';
const OPAQUE_FRAGMENT = '#include <opaque_fragment>';

const SUN_PRESETS = {
  dawn: new THREE.Vector3(0.72, 0.24, -0.35).normalize(),
  day: new THREE.Vector3(0.44, 0.72, 0.39).normalize(),
  dusk: new THREE.Vector3(-0.68, 0.20, -0.42).normalize(),
  night: new THREE.Vector3(-0.32, 0.62, -0.50).normalize()
};

const TRANS_COLOR_PRESETS = {
  dawn: new THREE.Color('#FFD2B8'),
  day: new THREE.Color('#FFE6D0'),
  dusk: new THREE.Color('#FFB27E'),
  night: new THREE.Color('#4B5F78')
};

const TRANS_AMT_PRESETS = {
  dawn: 0.58,
  day: 0.34,
  dusk: 0.58,
  night: 0.08
};

const HEADER_GLSL = /* glsl */`
uniform float uFloraWindTime;
uniform vec2 uFloraWindVec;
uniform float uFloraWindAmp;
uniform float uFloraWindMinY;
uniform float uFloraWindInvSpan;
`;

const CANOPY_VERT_HEADER_GLSL = /* glsl */`
uniform float uFloraSoftNorm;
uniform float uFloraCanopyMinY;
uniform float uFloraProxyY;
varying vec3 vFloraWorldPos;
varying vec3 vFloraSoftNormal;
varying float vFloraCanopyMask;
`;

const CANOPY_FRAG_HEADER_GLSL = /* glsl */`
uniform vec3 uFloraSunDir;
uniform vec3 uFloraTransColor;
uniform float uFloraTransAmt;
uniform float uFloraSoftNorm;
uniform float uFloraBlossom;
varying vec3 vFloraWorldPos;
varying vec3 vFloraSoftNormal;
varying float vFloraCanopyMask;
`;

const SWAY_BODY_GLSL = /* glsl */`
  float fwLift = max(0.0, position.y - uFloraWindMinY) * uFloraWindInvSpan;
  if (fwLift > 0.0 && uFloraWindAmp > 0.0) {
    float fwClamped = min(1.25, fwLift);
    float fwBend = fwClamped * (0.32 + 0.68 * min(1.0, fwClamped));
    #ifdef USE_INSTANCING
      vec4 fwWorld = modelMatrix * instanceMatrix * vec4(position, 1.0);
      mat3 fwBasis = mat3(modelMatrix) * mat3(instanceMatrix);
    #else
      vec4 fwWorld = modelMatrix * vec4(position, 1.0);
      mat3 fwBasis = mat3(modelMatrix);
    #endif
    float fwPhaseA = uFloraWindTime * 1.62 + fwWorld.x * 0.105 + fwWorld.z * 0.085;
    float fwPhaseB = uFloraWindTime * 2.75 - fwWorld.x * 0.19 + fwWorld.z * 0.16 + position.y * 0.65;
    float fwWave = 0.68 * sin(fwPhaseA) + 0.32 * sin(fwPhaseB);
    float fwCross = 0.24 * cos(uFloraWindTime * 2.08 + fwWorld.z * 0.13 - fwWorld.x * 0.11);
    vec2 fwPerp = vec2(-uFloraWindVec.y, uFloraWindVec.x);
    vec2 fwDisp = (uFloraWindVec * fwWave + fwPerp * fwCross) * (uFloraWindAmp * fwBend);
    vec3 fwUnitX = fwBasis[0] * inversesqrt(max(dot(fwBasis[0], fwBasis[0]), 0.0001));
    vec3 fwUnitZ = fwBasis[2] * inversesqrt(max(dot(fwBasis[2], fwBasis[2]), 0.0001));
    transformed.x += fwDisp.x * fwUnitX.x + fwDisp.y * fwUnitX.z;
    transformed.z += fwDisp.x * fwUnitZ.x + fwDisp.y * fwUnitZ.z;
    transformed.y -= min(0.035, dot(fwDisp, fwDisp) * 0.30);
  }
`;

const SWAY_GLSL = /* glsl */`
#include <begin_vertex>
{
${SWAY_BODY_GLSL}
}
`;

const SWAY_CANOPY_GLSL = /* glsl */`
#include <begin_vertex>
{
${SWAY_BODY_GLSL}
  #ifdef USE_INSTANCING
    vFloraWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vFloraWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif
}
`;

const CANOPY_NORMAL_VERT_GLSL = /* glsl */`
{
  float fwCanopyMask = smoothstep(uFloraCanopyMinY, uFloraCanopyMinY + 0.70, position.y);
  vFloraCanopyMask = fwCanopyMask;
  vec2 fwLocalXZ = dot(position.xz, position.xz) > 25.0 ? objectNormal.xz * 0.65 : position.xz;
  vec3 fwRawDome = vec3(fwLocalXZ.x, max(0.38, position.y - uFloraProxyY), fwLocalXZ.y) + objectNormal * 0.45;
  vec3 fwDomeDir = fwRawDome * inversesqrt(max(dot(fwRawDome, fwRawDome), 0.0001));
  vec3 fwMixNorm = mix(objectNormal, fwDomeDir, fwCanopyMask * uFloraSoftNorm);
  objectNormal = fwMixNorm * inversesqrt(max(dot(fwMixNorm, fwMixNorm), 0.0001));
}
#include <defaultnormal_vertex>
vFloraSoftNormal = transformedNormal;
`;

const CANOPY_NORMAL_FRAG_GLSL = /* glsl */`
#include <normal_fragment_begin>
#ifdef FLAT_SHADED
{
  vec3 fwSmoothN = vFloraSoftNormal * inversesqrt(max(dot(vFloraSoftNormal, vFloraSoftNormal), 0.0001));
  #ifdef DOUBLE_SIDED
    fwSmoothN *= faceDirection;
  #endif
  vec3 fwFinalN = mix(normal, fwSmoothN, vFloraCanopyMask * uFloraSoftNorm);
  normal = fwFinalN * inversesqrt(max(dot(fwFinalN, fwFinalN), 0.0001));
  nonPerturbedNormal = normal;
}
#endif
`;

const CANOPY_TRANSLUCENCY_FRAG_GLSL = /* glsl */`
{
  vec3 fwViewDelta = cameraPosition - vFloraWorldPos;
  vec3 fwViewDir = fwViewDelta * inversesqrt(max(dot(fwViewDelta, fwViewDelta), 0.000001));
  float fwBack = pow(clamp(dot(-fwViewDir, uFloraSunDir), 0.0, 1.0), 2.2);
  vec3 fwSunView = mat3(viewMatrix) * uFloraSunDir;
  fwSunView *= inversesqrt(max(dot(fwSunView, fwSunView), 0.000001));
  float fwNdotL = dot(normal, fwSunView);
  float fwHalf = fwNdotL * 0.5 + 0.5;
  float fwWrap = max(0.0, fwHalf * fwHalf - max(0.0, fwNdotL));
  vec3 fwBaseTint = diffuseColor.rgb * mix(vec3(0.92, 0.98, 0.90), vec3(1.06, 0.92, 0.95), uFloraBlossom);
  vec3 fwBackTint = mix(fwBaseTint, fwBaseTint * uFloraTransColor * 1.18, 0.62);
  vec3 fwVelvet = (fwBaseTint * (0.11 + 0.24 * fwWrap) + fwBackTint * (0.48 * fwBack)) * uFloraTransAmt * vFloraCanopyMask;
  outgoingLight += fwVelvet;
}
#include <opaque_fragment>
`;

function unwrapRoot(target) {
  if (!target) return null;
  if (target.isObject3D) return target;
  if (target.group?.isObject3D) return target.group;
  return null;
}

function scanYBounds(geometry) {
  const arr = geometry?.attributes?.position?.array;
  if (!arr || !arr.length) return null;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < arr.length; i += 3) {
    const y = arr[i];
    if (!Number.isFinite(y)) continue;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return minY <= maxY ? { minY, maxY } : null;
}

function classifyMesh(sourceKey, mesh) {
  const name = String(mesh?.name || '');
  if (!name) return null;

  if (sourceKey === 'flora') {
    if (/^tree-near/i.test(name)) {
      return {
        category: 'flora-near',
        amp: 0.058,
        minY: 0.22,
        span: 4.5,
        softCanopy: 0.72,
        blossom: 1.0,
        canopyMinY: 1.35,
        proxyY: 2.55
      };
    }
    if (/^tree-far/i.test(name)) {
      return {
        category: 'flora-far',
        amp: 0.050,
        minY: 0.22,
        span: 4.5,
        softCanopy: 0.72,
        blossom: 1.0,
        canopyMinY: 1.35,
        proxyY: 2.55
      };
    }
    return null;
  }

  if (sourceKey === 'village') {
    if (/bamboo/i.test(name)) {
      return {
        category: 'village-bamboo',
        amp: 0.108,
        minY: 0.20,
        span: 5.0,
        softCanopy: 0.55,
        blossom: 0.18,
        canopyMinY: 1.1,
        proxyY: 2.6
      };
    }
    if (/^(reeds|pond-reeds)$/i.test(name)) {
      let minY = 0.16;
      let span = 1.05;
      if (!mesh.isInstancedMesh) {
        const bb = scanYBounds(mesh.geometry);
        if (bb) {
          if (bb.minY > 0.25) {
            minY = Math.max(0.16, bb.minY + 0.45);
            span = Math.max(0.55, bb.maxY - minY);
          } else {
            minY = Math.max(0.15, bb.minY + 0.15);
            span = Math.max(0.55, bb.maxY - minY);
          }
        }
      }
      return { category: 'village-reeds', amp: 0.066, minY, span, softCanopy: 0 };
    }
    if (/^mulberry-leaves$/i.test(name)) {
      return {
        category: 'village-mulberry',
        amp: 0.032,
        minY: 0.15,
        span: 0.85,
        softCanopy: 0.58,
        blossom: 0.25,
        canopyMinY: -0.5,
        proxyY: 0.0
      };
    }
    if (/^mulberry-core$/i.test(name)) {
      return {
        category: 'village-mulberry-core',
        amp: 0.028,
        minY: 0.10,
        span: 1.2,
        softCanopy: 0.78,
        blossom: 0.22,
        canopyMinY: -1.5,
        proxyY: 0.0
      };
    }
    return null;
  }

  if (sourceKey === 'scatter') {
    if (/patch|stone/i.test(name)) return null;
    if (/^(flower|flower-stems|flower-heads)$/i.test(name)) {
      return { category: 'scatter-flower', amp: 0.054, minY: 0.15, span: 0.85, softCanopy: 0 };
    }
    if (/^(grass-near|near)$/i.test(name)) {
      return { category: 'scatter-near', amp: 0.068, minY: 0.15, span: 0.82, softCanopy: 0 };
    }
    if (/^(grass-approach|approach)$/i.test(name)) {
      return { category: 'scatter-approach', amp: 0.064, minY: 0.15, span: 0.82, softCanopy: 0 };
    }
    if (/^(grass|tuft)$/i.test(name)) {
      return { category: 'scatter-tuft', amp: 0.060, minY: 0.15, span: 0.82, softCanopy: 0 };
    }
    return null;
  }

  if (sourceKey === 'leisureGrove') {
    if (/^leisure-grove-foliage$/i.test(name)) {
      let minY = 0.20;
      let span = 3.6;
      const bb = scanYBounds(mesh.geometry);
      if (bb && bb.minY > 0.25) {
        minY = bb.minY + 0.45;
        span = Math.max(1.5, bb.maxY - minY);
      }
      return {
        category: 'leisure-foliage',
        amp: 0.024,
        minY,
        span,
        softCanopy: 0.68,
        blossom: 0.40,
        canopyMinY: minY,
        proxyY: minY + span * 0.45
      };
    }
    return null;
  }

  if (sourceKey === 'hinterland') {
    if (/^hinterland-(crown|leaf)/i.test(name)) {
      return {
        category: 'hinterland-foliage',
        amp: 0.036,
        minY: 0.12,
        span: 1.8,
        softCanopy: 0.72,
        blossom: 0.32,
        canopyMinY: -1.2,
        proxyY: 0.0
      };
    }
    return null;
  }

  if (sourceKey === 'valleyBorderlands') {
    if (/^valley-borderlands-pines$/i.test(name)) {
      return { category: 'borderland-pine', amp: 0.042, minY: 0.35, span: 3.4, softCanopy: 0.52, blossom: 0.08, canopyMinY: 1.4, proxyY: 2.5 };
    }
    if (/^valley-borderlands-blossoms$/i.test(name)) {
      return { category: 'borderland-blossom', amp: 0.052, minY: 0.30, span: 3.1, softCanopy: 0.72, blossom: 0.85, canopyMinY: 1.4, proxyY: 2.4 };
    }
    if (/^valley-borderlands-bamboo$/i.test(name)) {
      return { category: 'borderland-bamboo', amp: 0.092, minY: 0.22, span: 4.2, softCanopy: 0.48, blossom: 0.14, canopyMinY: 1.2, proxyY: 2.6 };
    }
    if (/^valley-borderlands-shrubs$/i.test(name)) {
      return { category: 'borderland-shrub', amp: 0.026, minY: 0.10, span: 0.85, softCanopy: 0 };
    }
    if (/^valley-borderlands-tufts$/i.test(name)) {
      return { category: 'borderland-tuft', amp: 0.058, minY: 0.08, span: 0.65, softCanopy: 0 };
    }
    return null;
  }

  return null;
}

export function createFloraWind({ flora, village, scatter, leisureGrove, hinterland, valleyBorderlands, sky } = {}) {
  let disposed = false;
  let compileCount = 0;

  const sharedTime = { value: 0 };
  const sharedWindVec = { value: new THREE.Vector2(0.72, 0.45) };
  const sharedSunDir = { value: SUN_PRESETS.day.clone() };
  const sharedTransColor = { value: TRANS_COLOR_PRESETS.day.clone() };
  const sharedTransAmt = { value: TRANS_AMT_PRESETS.day };
  const entries = [];
  const categories = Object.create(null);
  let matchedMeshes = 0;

  function wrapMaterial(material, spec) {
    if (!material || typeof material.onBeforeCompile !== 'function' || typeof material.customProgramCacheKey !== 'function') {
      return;
    }
    if (installed.has(material)) return;

    const previousHook = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    const baseKey = previousKey.call(material);

    const hasSoftCanopy = (spec.softCanopy || 0) > 0;
    const matUniforms = {
      uFloraWindTime: sharedTime,
      uFloraWindVec: sharedWindVec,
      uFloraWindAmp: { value: spec.amp },
      uFloraWindMinY: { value: spec.minY },
      uFloraWindInvSpan: { value: 1 / Math.max(0.1, spec.span) }
    };
    const canopyUniforms = hasSoftCanopy ? {
      uFloraSunDir: sharedSunDir,
      uFloraTransColor: sharedTransColor,
      uFloraTransAmt: sharedTransAmt,
      uFloraSoftNorm: { value: spec.softCanopy },
      uFloraBlossom: { value: spec.blossom || 0 },
      uFloraCanopyMinY: { value: spec.canopyMinY ?? 0 },
      uFloraProxyY: { value: spec.proxyY ?? 0 }
    } : null;

    const hook = function (shader, renderer) {
      previousHook.call(this, shader, renderer);
      if (disposed) return;
      if (!shader?.vertexShader || !shader.vertexShader.includes(BEGIN_VERTEX)) return;
      Object.assign(shader.uniforms, matUniforms);

      const useCanopyOptics = Boolean(
        canopyUniforms &&
        shader.vertexShader.includes(DEFAULTNORMAL_VERTEX) &&
        shader.fragmentShader &&
        shader.fragmentShader.includes(OPAQUE_FRAGMENT)
      );

      if (useCanopyOptics) {
        Object.assign(shader.uniforms, canopyUniforms);
        if (!shader.vertexShader.includes('uniform float uFloraWindTime;')) {
          let vs = HEADER_GLSL + CANOPY_VERT_HEADER_GLSL + '\n' + shader.vertexShader;
          vs = vs.replace(DEFAULTNORMAL_VERTEX, CANOPY_NORMAL_VERT_GLSL);
          vs = vs.replace(BEGIN_VERTEX, SWAY_CANOPY_GLSL);
          shader.vertexShader = vs;
        }
        if (!shader.fragmentShader.includes('uniform vec3 uFloraSunDir;')) {
          let fs = CANOPY_FRAG_HEADER_GLSL + '\n' + shader.fragmentShader;
          if (fs.includes(NORMAL_FRAGMENT_BEGIN)) {
            fs = fs.replace(NORMAL_FRAGMENT_BEGIN, CANOPY_NORMAL_FRAG_GLSL);
          }
          fs = fs.replace(OPAQUE_FRAGMENT, CANOPY_TRANSLUCENCY_FRAG_GLSL);
          shader.fragmentShader = fs;
        }
      } else if (!shader.vertexShader.includes('uniform float uFloraWindTime;')) {
        shader.vertexShader = HEADER_GLSL + '\n' + shader.vertexShader.replace(BEGIN_VERTEX, SWAY_GLSL);
      }
      compileCount++;
    };

    const key = function () {
      return baseKey + '|flora-wind-v1';
    };

    const record = {
      material, previousHook, previousKey, hook, key,
      uniforms: matUniforms, canopyUniforms,
      baseBlossom: spec.blossom || 0,
      category: spec.category
    };
    installed.set(material, record);
    entries.push(record);
    material.onBeforeCompile = hook;
    material.customProgramCacheKey = key;
    material.needsUpdate = true;
  }

  const sources = [
    ['flora', unwrapRoot(flora)],
    ['village', unwrapRoot(village)],
    ['scatter', unwrapRoot(scatter)],
    ['leisureGrove', unwrapRoot(leisureGrove)],
    ['hinterland', unwrapRoot(hinterland)],
    ['valleyBorderlands', unwrapRoot(valleyBorderlands || leisureGrove?.valleyBorderlands)]
  ];

  for (let s = 0; s < sources.length; s++) {
    const sourceKey = sources[s][0];
    const root = sources[s][1];
    if (!root) continue;
    root.traverse((obj) => {
      if (!obj?.isMesh || !obj.material) return;
      const spec = classifyMesh(sourceKey, obj);
      if (!spec) return;
      matchedMeshes++;
      categories[spec.category] = (categories[spec.category] || 0) + 1;
      if (Array.isArray(obj.material)) {
        for (let i = 0; i < obj.material.length; i++) wrapMaterial(obj.material[i], spec);
      } else {
        wrapMaterial(obj.material, spec);
      }
    });
  }

  function syncWindVector() {
    let dx = 0.848;
    let dz = 0.530;
    let gain = 0.85;
    let timeId = 'day';
    let rain = 0;

    if (sky && sky.enabled !== false && sky.disabled !== true) {
      const wx = sky.windX;
      const wz = sky.windZ;
      if (Number.isFinite(wx) && Number.isFinite(wz)) {
        const len = Math.hypot(wx, wz);
        if (len > 1e-4) {
          dx = wx / len;
          dz = wz / len;
        }
      }
      if (Number.isFinite(sky.wind)) {
        gain = Math.max(0.25, Math.min(1.85, sky.wind));
      } else if (typeof sky.getStats === 'function') {
        const st = sky.getStats();
        if (st && Number.isFinite(st.wind)) {
          gain = Math.max(0.25, Math.min(1.85, 0.55 + st.wind * 0.65));
        }
      }

      // Real sky exposes both scalars directly. Only older/custom providers need
      // a snapshot; do not create three debug hex strings just to read time/rain.
      const directTime = sky.timeId;
      const directRain = sky.rainIntensity;
      const app = (!directTime || !Number.isFinite(directRain)) && typeof sky.getAppearance === 'function'
        ? sky.getAppearance() : null;
      const rawTime = directTime || app?.timeId;
      if (rawTime && SUN_PRESETS[rawTime]) timeId = rawTime;

      const rawRain = Number.isFinite(directRain) ? directRain : Number(app?.rainIntensity);
      if (Number.isFinite(rawRain)) rain = Math.max(0, Math.min(1, rawRain));

      const sd = sky.sunDir;
      if (Array.isArray(sd) && sd.length >= 3 && sd.every(Number.isFinite)) {
        sharedSunDir.value.set(sd[0], sd[1], sd[2]);
        if (sharedSunDir.value.lengthSq() > 1e-6) sharedSunDir.value.normalize();
        else sharedSunDir.value.copy(SUN_PRESETS[timeId]);
      } else if (sd && Number.isFinite(sd.x) && Number.isFinite(sd.y) && Number.isFinite(sd.z)) {
        sharedSunDir.value.set(sd.x, sd.y, sd.z);
        if (sharedSunDir.value.lengthSq() > 1e-6) sharedSunDir.value.normalize();
        else sharedSunDir.value.copy(SUN_PRESETS[timeId]);
      } else {
        sharedSunDir.value.copy(SUN_PRESETS[timeId]);
      }
    } else {
      sharedSunDir.value.copy(SUN_PRESETS.day);
    }

    sharedWindVec.value.set(dx * gain, dz * gain);
    sharedTransColor.value.copy(TRANS_COLOR_PRESETS[timeId] || TRANS_COLOR_PRESETS.day);
    const baseAmt = TRANS_AMT_PRESETS[timeId] ?? TRANS_AMT_PRESETS.day;
    sharedTransAmt.value = baseAmt * (1 - rain * 0.65);
  }

  function update(dt, _elapsed) {
    if (disposed) return;
    if (Number.isFinite(dt) && dt > 0) {
      sharedTime.value = (sharedTime.value + Math.min(dt, 0.1)) % 4096;
    }
    syncWindVector();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (let i = 0; i < entries.length; i++) {
      const rec = entries[i];
      rec.uniforms.uFloraWindAmp.value = 0;
      if (installed.get(rec.material) !== rec) continue;
      installed.delete(rec.material);
      let restored = false;
      if (rec.material.onBeforeCompile === rec.hook) {
        rec.material.onBeforeCompile = rec.previousHook;
        restored = true;
      }
      if (rec.material.customProgramCacheKey === rec.key) {
        rec.material.customProgramCacheKey = rec.previousKey;
        restored = true;
      }
      if (restored) rec.material.needsUpdate = true;
    }
  }

  function getStats() {
    return {
      enabled: entries.length > 0 && !disposed,
      disposed,
      materials: entries.length,
      meshes: matchedMeshes,
      categories: { ...categories },
      time: sharedTime.value,
      windVec: [sharedWindVec.value.x, sharedWindVec.value.y],
      translucency: sharedTransAmt.value,
      compileCount
    };
  }

  function setPhenology(id) {
    if (disposed) return;
    for (let i = 0; i < entries.length; i++) {
      const rec = entries[i];
      if (!rec.canopyUniforms) continue;
      if (rec.baseBlossom >= 0.7) {
        rec.canopyUniforms.uFloraBlossom.value =
          id === 'summer' ? 0.06
            : id === 'autumn' ? 0.28
              : id === 'winter' ? 0.12
                : rec.baseBlossom;
      }
    }
  }

  syncWindVector();
  return { setPhenology, update, getStats, dispose };
}
