import * as THREE from 'three';

// Local albedo only; existing sky still owns illumination and mountain mat.color.
const palettes = new WeakMap();
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
export function shadeInkGround(color, sample, cfg) {
  let p = palettes.get(cfg);
  if (!p) {
    p = { warm: new THREE.Color(cfg.warmColor), cool: new THREE.Color(cfg.coolColor), moss: new THREE.Color(cfg.mossColor), wet: new THREE.Color(cfg.wetColor) };
    palettes.set(cfg, p);
  }
  const { normalX, normalZ, slope, height, waterLevel, noise } = sample;
  const facing = clamp((normalX * cfg.warmDirection[0] + normalZ * cfg.warmDirection[1]) / (Math.hypot(...cfg.warmDirection) || 1), -1, 1);
  const relief = smooth(cfg.slopeRange[0], cfg.slopeRange[1], slope);
  const dry = smooth(waterLevel + cfg.wetRange[0], waterLevel + cfg.wetRange[1], height);
  color.lerp(facing >= 0 ? p.warm : p.cool, Math.abs(facing) * relief * cfg.aspectStrength * dry);
  color.lerp(p.moss, (1 - dry) * smooth(.25, .75, noise) * cfg.mossStrength);
  color.lerp(p.wet, (1 - dry) * cfg.wetStrength);
  return color;
}

// Same analytical weights as the local fragment hook, exposed for CPU contracts.
export function mountainHazeAt(height, distance, rain, cfg) {
  const foot = 1 - smooth(cfg.heightRange[0], cfg.heightRange[1], height);
  const far = smooth(cfg.distanceRange[0], cfg.distanceRange[1], distance);
  return clamp(foot * cfg.footStrength + far * cfg.distanceStrength + clamp(rain, 0, 1) * cfg.rainStrength * (.3 + .7 * foot), 0, cfg.maxOpacity);
}

const MOUNTAIN_NOISE_GLSL = `
float inkHash2(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float inkNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = inkHash2(i);
  float b = inkHash2(i + vec2(1.0, 0.0));
  float c = inkHash2(i + vec2(0.0, 1.0));
  float d = inkHash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float inkFbm2(vec2 p) {
  float v = 0.0;
  v += 0.54 * inkNoise2(p);
  v += 0.30 * inkNoise2(p * 2.07 + vec2(3.7, 1.9));
  v += 0.16 * inkNoise2(p * 4.19 + vec2(7.3, 5.1));
  return v;
}
`;

export function createMountainHaze(materials, cfg) {
  const uniforms = {
    uInkMountainFog: { value: new THREE.Color(cfg.fallbackFog) },
    uInkMountainRain: { value: 0 },
    uInkMountainSnow: { value: 0 },
    uInkMountainWinter: { value: 0 },
    uInkMountainTime: { value: 0 },
    uInkMountainWindDrift: { value: 0 },
    uInkMountainCloudMood: { value: 0.36 },
    uInkMountainCloudTint: { value: new THREE.Color('#EEF1EC') },
    uInkMountainSunXZ: { value: new THREE.Vector2(0.899, -0.437) },
    uInkMountainSunRim: { value: 0 },
    uInkMountainSunGold: { value: new THREE.Color('#FFDCA8') },
    uInkMountainHeight: { value: new THREE.Vector2(...cfg.heightRange) },
    uInkMountainDistance: { value: new THREE.Vector2(...cfg.distanceRange) },
    uInkMountainWeights: { value: new THREE.Vector4(cfg.footStrength, cfg.distanceStrength, cfg.rainStrength, cfg.maxOpacity) }
  };
  const _cloudPaper = new THREE.Color('#F4F5F0');
  const _cloudDawn = new THREE.Color('#F2DFC8');
  const _cloudDusk = new THREE.Color('#EBC9A2');
  const _cloudNight = new THREE.Color('#233244');
  const _cloudTarget = new THREE.Color('#EEF1EC');
  const _sunDawnGold = new THREE.Color('#FFE0AE');
  const _sunDuskGold = new THREE.Color('#FFC68A');
  const _sunTargetXZ = new THREE.Vector2(0.899, -0.437);
  const restorers = [];
  let disposed = false;
  const crestBase = clamp(cfg.crestStrength ?? 0.32, 0, 0.58);
  const cragBase = clamp(cfg.cragStrength ?? 0.20, 0, 0.45);
  for (const [tierIndex, material] of materials.entries()) {
    const tierNorm = materials.length > 1 ? tierIndex / (materials.length - 1) : 0;
    const tierFalloff = 1 - tierNorm * 0.72;
    const tierCrest = { value: crestBase * tierFalloff };
    const tierCrag = { value: cragBase * (1 - tierNorm * 0.68) };
    const tierWaistY = { value: 9.5 + tierIndex * 6.8 };
    const tierDepth = { value: tierNorm };
    const previousHook = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    const baseKey = previousKey.call(material);
    function hook(shader, renderer) {
      previousHook.call(this, shader, renderer);
      if (!shader.vertexShader.includes('#include <begin_vertex>') || !shader.fragmentShader.includes('#include <opaque_fragment>')) {
        throw new Error('Ink mountain shader missing begin_vertex/opaque_fragment contract');
      }
      Object.assign(shader.uniforms, uniforms, {
        uInkMountainCrest: tierCrest,
        uInkMountainCrag: tierCrag,
        uInkMountainWaistY: tierWaistY,
        uInkMountainTier: tierDepth
      });
      shader.vertexShader =
        'attribute vec3 aRidgeInfo;\nvarying vec3 vInkMountainWorld;\nvarying vec3 vInkRidgeInfo;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvInkMountainWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvInkRidgeInfo = aRidgeInfo;'
        );
      shader.fragmentShader =
        'varying vec3 vInkMountainWorld;\nvarying vec3 vInkRidgeInfo;\n' +
        'uniform vec3 uInkMountainFog;\nuniform float uInkMountainRain;\nuniform float uInkMountainSnow;\nuniform float uInkMountainWinter;\nuniform float uInkMountainTime;\n' +
        'uniform float uInkMountainWindDrift;\nuniform float uInkMountainCloudMood;\nuniform vec3 uInkMountainCloudTint;\n' +
        'uniform vec2 uInkMountainSunXZ;\nuniform float uInkMountainSunRim;\nuniform vec3 uInkMountainSunGold;\n' +
        'uniform float uInkMountainCrest;\nuniform float uInkMountainCrag;\nuniform float uInkMountainWaistY;\nuniform float uInkMountainTier;\n' +
        'uniform vec2 uInkMountainHeight;\nuniform vec2 uInkMountainDistance;\nuniform vec4 uInkMountainWeights;\n' +
        MOUNTAIN_NOISE_GLSL +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          'float inkFoot = 1.0 - smoothstep(uInkMountainHeight.x, uInkMountainHeight.y, vInkMountainWorld.y);\n' +
          'float inkBaseMelt = 1.0 - smoothstep(-6.0, 9.5, vInkMountainWorld.y);\n' +
          'float inkFar = smoothstep(uInkMountainDistance.x, uInkMountainDistance.y, length(vInkMountainWorld.xz - cameraPosition.xz));\n' +
          'float inkShoulder = smoothstep(uInkMountainHeight.x + 12.0, uInkMountainHeight.y - 3.0, vInkMountainWorld.y);\n' +
          'float inkCrest = smoothstep(uInkMountainHeight.x + 22.0, uInkMountainHeight.y + 9.0, vInkMountainWorld.y);\n' +
          'vec2 inkRel = vInkMountainWorld.xz - cameraPosition.xz;\n' +
          'float inkAz = atan(inkRel.y, inkRel.x);\n' +
          'vec2 horDir = normalize(inkRel + vec2(0.0001));\n' +
          'float sunAlign = pow(clamp(dot(horDir, normalize(uInkMountainSunXZ)) * 0.5 + 0.5, 0.0, 1.0), 2.3);\n' +
          'vec2 azCircle = vec2(cos(inkAz), sin(inkAz)) * 6.5;\n' +
          'float ridgeSpur = clamp(vInkRidgeInfo.x, -1.0, 1.0);\n' +
          'float sunAspect = clamp(vInkRidgeInfo.y, -1.0, 1.0);\n' +
          // 顺山势斜披的宋元披麻皴与折带岩脉（二维值噪声 FBM，彻底告别周期正弦条码纹）
          'vec2 pimaCoord = vec2(inkAz * 13.5 + vInkMountainWorld.y * 0.024 * (sunAspect >= 0.0 ? 1.0 : -1.0), vInkMountainWorld.y * 0.082 - ridgeSpur * 0.65);\n' +
          'float pimaWarp = inkFbm2(azCircle + vec2(0.0, vInkMountainWorld.y * 0.035)) - 0.5;\n' +
          'float pimaCoarse = inkFbm2(pimaCoord + vec2(pimaWarp * 1.35, -pimaWarp * 0.55));\n' +
          'float pimaFine = inkNoise2(pimaCoord * vec2(2.6, 1.45) + vec2(4.2, pimaWarp * 2.1));\n' +
          'float inkFiber = (pimaCoarse * 0.66 + pimaFine * 0.34) * 2.0 - 1.0;\n' +
          'float precipDamp = clamp(1.0 - uInkMountainRain * 0.52 - uInkMountainSnow * 0.42, 0.25, 1.0);\n' +
          'float inkCragMask = (1.0 - inkFoot * 0.85) * (1.0 - inkFar * 0.68) * precipDamp;\n' +
          // 阳坡石绿带暖赭、阴坡凹坞石青苍黛，拉开立体山脉阴阳折面
          'vec3 warmOchre = vec3(1.04, 0.96, 0.84);\n' +
          'vec3 malachite = vec3(0.76, 0.95, 0.86);\n' +
          'vec3 azurite = vec3(0.62, 0.76, 0.88);\n' +
          'vec3 deepInk = vec3(0.64, 0.72, 0.79);\n' +
          'float sunMask = smoothstep(-0.15, 0.55, sunAspect) * (0.45 + 0.55 * max(0.0, ridgeSpur));\n' +
          'float shadeMask = smoothstep(-0.10, 0.60, -sunAspect) * (0.50 + 0.50 * max(0.0, -ridgeSpur));\n' +
          'outgoingLight = mix(outgoingLight, outgoingLight * warmOchre, sunMask * uInkMountainCrest * 0.58 * precipDamp);\n' +
          'outgoingLight = mix(outgoingLight, outgoingLight * malachite, inkShoulder * (0.35 + 0.65 * max(0.0, inkFiber)) * uInkMountainCrest * 0.86 * precipDamp);\n' +
          'outgoingLight = mix(outgoingLight, outgoingLight * azurite, (shadeMask * 0.72 + inkCrest * 0.64) * uInkMountainCrest * 0.98 * precipDamp);\n' +
          'outgoingLight = mix(outgoingLight, outgoingLight * deepInk, smoothstep(0.18, 0.78, -inkFiber) * uInkMountainCrag * inkCragMask * 0.94);\n' +
          // 远山黛眉：沿峰顶脊线轻着一笔苍青墨晕，使重峦剪影在晴昼与暮色中挺拔可读
          'float ridgeBrow = smoothstep(0.76, 0.99, vInkRidgeInfo.z) * (1.0 - smoothstep(0.985, 1.0, vInkRidgeInfo.z) * 0.25);\n' +
          'outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.72, 0.80, 0.84), ridgeBrow * uInkMountainCrest * 0.72 * precipDamp);\n' +
          // 冬寂与飞雪：山脊山坳覆宣纸留白瑞雪，阴坡呈矿青雪影，晨昏向阳峰脊轻染「雪峰朝晖 / 寒山晚照」；夜间随天光转青银冷雪，绝不发白发光
          'float fogDayScale = smoothstep(0.05, 0.34, dot(uInkMountainFog, vec3(0.2126, 0.7152, 0.0722)));\n' +
          'float winAmt = clamp(max(uInkMountainWinter, uInkMountainSnow * 0.88), 0.0, 1.0);\n' +
          'if (winAmt > 0.01) {\n' +
          '  float snowCrest = smoothstep(0.24, 0.76, vInkRidgeInfo.z + ridgeSpur * 0.16 + inkFiber * 0.14);\n' +
          '  float cragExpose = smoothstep(0.32, 0.78, abs(inkFiber)) * smoothstep(0.15, 0.65, -ridgeSpur + 0.35);\n' +
          '  float snowMask = snowCrest * (1.0 - cragExpose * 0.58) * winAmt * (1.0 - inkBaseMelt * 0.8);\n' +
          '  vec3 daySnowLit = mix(uInkMountainFog, vec3(0.95, 0.96, 0.95), 0.64);\n' +
          '  vec3 daySnowShade = mix(uInkMountainFog, vec3(0.75, 0.84, 0.90), 0.52);\n' +
          '  vec3 daySnow = mix(daySnowLit, daySnowShade, shadeMask * (0.48 - uInkMountainTier * 0.16));\n' +
          '  if (uInkMountainSunRim > 0.005) {\n' +
          '    float alpenGlow = sunAlign * (0.42 + 0.58 * sunMask) * uInkMountainSunRim * (1.0 - uInkMountainTier * 0.35) * fogDayScale;\n' +
          '    daySnow = mix(daySnow, uInkMountainSunGold, clamp(alpenGlow * 0.36, 0.0, 0.34));\n' +
          '  }\n' +
          '  vec3 nightSnow = uInkMountainFog * 1.28 + vec3(0.025, 0.035, 0.048);\n' +
          '  vec3 snowTone = mix(nightSnow, daySnow, fogDayScale);\n' +
          '  outgoingLight = mix(outgoingLight, snowTone, clamp(snowMask * (0.70 - uInkMountainTier * 0.10), 0.0, 0.72));\n' +
          '}\n' +
          // 「山无云不活、远山无脚」：风驱双层山腰游云流岚（下层谷间深岚 + 上层肩际飞云丝缕）+ 三远递进薄岚消隐
          'float drift = uInkMountainWindDrift;\n' +
          'float waistNoise = inkFbm2(vec2(inkAz * 3.4 - drift, vInkMountainWorld.y * 0.065 + uInkMountainWaistY * 0.13));\n' +
          'float waistCenter = uInkMountainWaistY + (waistNoise - 0.5) * 8.6;\n' +
          'float waistBand = exp(-pow((vInkMountainWorld.y - waistCenter) * 0.18, 2.0));\n' +
          'float waistSpan = smoothstep(0.28, 0.68, inkFbm2(azCircle * 0.62 + vec2(drift * 1.65, uInkMountainWaistY * 0.2)));\n' +
          'float upperNoise = inkFbm2(vec2(inkAz * 4.8 - drift * 1.65 + 4.1, vInkMountainWorld.y * 0.08 + uInkMountainWaistY * 0.27));\n' +
          'float upperCenter = uInkMountainWaistY + 11.5 + (upperNoise - 0.5) * 6.4;\n' +
          'float upperBand = exp(-pow((vInkMountainWorld.y - upperCenter) * 0.28, 2.0));\n' +
          'float upperSpan = smoothstep(0.38, 0.76, inkFbm2(azCircle * 0.88 - vec2(drift * 2.2, uInkMountainWaistY * 0.35 + 2.7)));\n' +
          'float upperSilk = upperBand * upperSpan * (0.20 + 0.42 * uInkMountainCloudMood) * (1.0 - inkCrest * 0.38);\n' +
          'float gullyMist = max(0.0, -ridgeSpur) * (1.0 - inkCrest) * (0.22 + 0.14 * uInkMountainCloudMood);\n' +
          'float waistVeil = (waistBand * waistSpan * (0.42 + 0.32 * uInkMountainCloudMood + 0.18 * uInkMountainRain + 0.18 * uInkMountainSnow) + upperSilk + gullyMist) * (1.0 - inkFar * 0.24);\n' +
          'float tierHorizonVeil = uInkMountainTier * (0.07 + 0.09 * inkFoot + 0.07 * uInkMountainSunRim) * (0.30 + 0.70 * fogDayScale);\n' +
          'float snowVeil = uInkMountainSnow * (0.20 + 0.45 * inkFoot + 0.22 * inkFar);\n' +
          'float inkHaze = clamp(max(inkBaseMelt * 0.92, inkFoot * uInkMountainWeights.x) + inkFar * uInkMountainWeights.y + uInkMountainRain * uInkMountainWeights.z * (0.3 + 0.7 * inkFoot) + waistVeil + tierHorizonVeil + snowVeil, 0.0, max(uInkMountainWeights.w, 0.94));\n' +
          'float cloudRibbonMask = clamp((waistBand * waistSpan * 0.28 + upperSilk * 0.46) * (0.22 + 0.78 * fogDayScale), 0.0, 0.42);\n' +
          'vec3 coolFarMist = mix(uInkMountainFog, vec3(0.73, 0.82, 0.88), (0.18 + 0.14 * winAmt) * fogDayScale);\n' +
          'vec3 mistCol = mix(uInkMountainFog, coolFarMist, uInkMountainTier * (1.0 - sunAlign * 0.65) * 0.55);\n' +
          'mistCol = mix(mistCol, uInkMountainCloudTint, cloudRibbonMask);\n' +
          // 晨昏日影流金云缘：仅朝向晨曦/落日方位一侧的山腰云带与峰脊轻镀淡金暖晖，背阳侧保留石青冷调，远层柔和承接霞岚
          'if (uInkMountainSunRim > 0.005) {\n' +
          '  float gildMask = sunAlign * uInkMountainSunRim * clamp(cloudRibbonMask * 1.45 + ridgeBrow * 0.28 + uInkMountainTier * inkFoot * 0.26, 0.0, 0.68);\n' +
          '  mistCol = mix(mistCol, uInkMountainSunGold, gildMask);\n' +
          '  outgoingLight = mix(outgoingLight, uInkMountainSunGold, sunAlign * ridgeBrow * uInkMountainSunRim * (0.22 - uInkMountainTier * 0.06));\n' +
          '}\n' +
          'outgoingLight = mix(outgoingLight, mistCol, inkHaze);\n#include <opaque_fragment>'
        );
    }
    const key = function () { return baseKey + '|ink-mountain-v1-t' + tierIndex; };
    material.onBeforeCompile = hook;
    material.customProgramCacheKey = key;
    material.needsUpdate = true;
    restorers.push(() => {
      if (material.onBeforeCompile === hook) material.onBeforeCompile = previousHook;
      if (material.customProgramCacheKey === key) material.customProgramCacheKey = previousKey;
      material.needsUpdate = true;
    });
  }
  return {
    // cameraPosition is supplied by Three per draw; do not freeze camera-following
    // transforms into uniforms or override the parent's existing x/z placement.
    get disposed() { return disposed; },
    setWinter(winterVal) {
      if (disposed || !Number.isFinite(winterVal)) return;
      uniforms.uInkMountainWinter.value = clamp(winterVal, 0, 1);
    },
    update(dt, sky, _camera) {
      if (disposed || !Number.isFinite(dt) || dt <= 0) return;
      const step = Math.min(dt, 0.1);
      uniforms.uInkMountainTime.value += step;
      const windMag = Number.isFinite(sky?.wind)
        ? clamp(sky.wind, 0.1, 2.5)
        : (Number.isFinite(sky?.windX) && Number.isFinite(sky?.windZ) ? clamp(Math.hypot(sky.windX, sky.windZ) * 2.2, 0.15, 2.5) : 0.55);
      uniforms.uInkMountainWindDrift.value += step * (0.013 + windMag * 0.016);
      const liveFog = sky?.getAppearanceState?.()?.fogColor;
      if (liveFog && liveFog.isColor) {
        uniforms.uInkMountainFog.value.copy(liveFog);
      } else {
        const fog = sky?.getAppearance?.()?.fogColor;
        if (typeof fog === 'string' && /^#?[0-9a-f]{6}$/i.test(fog)) uniforms.uInkMountainFog.value.set(fog.startsWith('#') ? fog : '#' + fog);
      }
      const rain = sky?.rainIntensity;
      if (Number.isFinite(rain)) uniforms.uInkMountainRain.value = clamp(rain, 0, 1);
      const snow = sky?.snowIntensity;
      if (Number.isFinite(snow)) uniforms.uInkMountainSnow.value = clamp(snow, 0, 1);
      const tid = typeof sky?.timeId === 'string' ? sky.timeId : '';
      const baseMood = tid === 'dawn' ? 0.72 : (tid === 'dusk' ? 0.66 : (tid === 'night' ? 0.30 : 0.34));
      const targetMood = clamp(baseMood + uniforms.uInkMountainRain.value * 0.36 + uniforms.uInkMountainSnow.value * 0.42 + uniforms.uInkMountainWinter.value * 0.18, 0.22, 1.0);
      uniforms.uInkMountainCloudMood.value += (targetMood - uniforms.uInkMountainCloudMood.value) * Math.min(1, step * 1.8);
      if (tid === 'dawn') _cloudTarget.copy(uniforms.uInkMountainFog.value).lerp(_cloudDawn, 0.45);
      else if (tid === 'dusk') _cloudTarget.copy(uniforms.uInkMountainFog.value).lerp(_cloudDusk, 0.45);
      else if (tid === 'night') _cloudTarget.copy(uniforms.uInkMountainFog.value).lerp(_cloudNight, 0.35);
      else _cloudTarget.copy(uniforms.uInkMountainFog.value).lerp(_cloudPaper, 0.52);
      uniforms.uInkMountainCloudTint.value.lerp(_cloudTarget, Math.min(1, step * 2.2));
      const tw = sky?.getTwilightState?.();
      const dawnAmt = Number.isFinite(tw?.dawn) ? tw.dawn : (tid === 'dawn' ? 1 : 0);
      const duskAmt = Number.isFinite(tw?.dusk) ? tw.dusk : (tid === 'dusk' ? 1 : 0);
      const precipFade = clamp(1 - uniforms.uInkMountainRain.value * 0.58 - uniforms.uInkMountainSnow.value * 0.34, 0.28, 1.0);
      const twPhase = clamp(Math.max(dawnAmt + duskAmt, (tid === 'dawn' || tid === 'dusk') ? 0.68 * precipFade : 0), 0, 1);
      const sunRimTarget = twPhase * 0.82;
      uniforms.uInkMountainSunRim.value += (sunRimTarget - uniforms.uInkMountainSunRim.value) * Math.min(1, step * 2.4);
      if ((tid === 'dusk' || duskAmt >= dawnAmt) && (tid === 'dusk' || duskAmt > 0.01)) {
        _sunTargetXZ.set(-0.851, -0.525);
        uniforms.uInkMountainSunGold.value.lerp(_sunDuskGold, Math.min(1, step * 2.4));
      } else if (tid === 'dawn' || dawnAmt > 0.01) {
        _sunTargetXZ.set(0.899, -0.437);
        uniforms.uInkMountainSunGold.value.lerp(_sunDawnGold, Math.min(1, step * 2.4));
      }
      uniforms.uInkMountainSunXZ.value.lerp(_sunTargetXZ, Math.min(1, step * 2.6)).normalize();
    },
    getCloudState() {
      return {
        windDrift: +uniforms.uInkMountainWindDrift.value.toFixed(4),
        cloudMood: +uniforms.uInkMountainCloudMood.value.toFixed(3),
        sunRim: +uniforms.uInkMountainSunRim.value.toFixed(3),
        tintHex: '#' + uniforms.uInkMountainCloudTint.value.getHexString()
      };
    },
    getStats() {
      return {
        batches: materials.length,
        fogColor: '#' + uniforms.uInkMountainFog.value.getHexString(),
        rain: uniforms.uInkMountainRain.value,
        disposed
      };
    },
    dispose() { if (disposed) return; disposed = true; for (const restore of restorers) restore(); restorers.length = 0; }
  };
}
