import * as THREE from 'three';
import { installSkyAppearance, skyDesaturation } from './scene-appearance.js';
import { applyTwilightPalette, twilightWeatherGate } from './twilight.js';
import phenologySeasons from '../data/phenology-seasons.json' with { type: 'json' };

// 天时与天气合成的一套天光：天空穹顶、日月星、雾，以及所有不受光材质的明度。
// 四档天时、四种天气来自 world.json；晨昏视觉默认值单独留在 twilight。

const DOME_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
}
`;

const DOME_FRAG = `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uGlow;
uniform vec3 uGlowDir;
uniform float uGlowAmt;
uniform vec3 uCloudColor;
uniform float uCloudCover;
uniform float uCloudOpacity;
uniform float uCloudSoft;
uniform float uCloudShade;
uniform float uCloudLow;
uniform float uCloudTime;
uniform float uTwilightAmount;
uniform float uTwilightDawn;
uniform float uTwilightDusk;
uniform vec4 uNoonCloud;
uniform vec3 uNoonCloudColor;
uniform float uStarOp;
varying vec3 vDir;

// 程序化云：不贴素材，用几层柔和的值噪声在穹顶上铺一层会走的云
float chash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float cnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = chash(i);
  float b = chash(i + vec2(1.0, 0.0));
  float c = chash(i + vec2(0.0, 1.0));
  float d = chash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float cfbm(vec2 p) {
  float v = 0.0;
  float a = 0.52;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    v += a * cnoise(p);
    p = rot * p * 2.03 + vec2(1.7, 3.1);
    a *= 0.49;
  }
  return v;
}
float cfbm3(vec2 p) {
  float v = 0.0;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  v += 0.55 * cnoise(p);
  p = rot * p * 2.03 + vec2(1.7, 3.1);
  v += 0.29 * cnoise(p);
  p = rot * p * 2.03 + vec2(1.7, 3.1);
  v += 0.16 * cnoise(p);
  return v;
}
float cfbm2(vec2 p) {
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  return 0.65 * cnoise(p) + 0.35 * cnoise(rot * p * 2.03 + vec2(1.7, 3.1));
}
float noonNoise2(float x, float y) { return cnoise(vec2(x, y)); }
// 正午舒卷云团：水平云幕投影 + 域扭曲多阶团云，彻底消解同心圆弧条带，雨雾天收笔
float noonCloudStroke(float dy, float hx, float hz, float t, vec4 p) {
  float band = smoothstep(0.08, 0.20, dy) * (1.0 - smoothstep(0.38, 0.62, dy));
  float stroke = 0.0;
  if (band > 0.001 && p.x > 0.001) {
    float invY = 1.0 / (dy + 0.28);
    float px = hx * invY + 0.85 + t * 0.045;
    float pz = hz * invY - 0.35 + t * 0.018;
    float wx = noonNoise2(px * 0.42 + 1.7, pz * 0.42 + 4.3) - 0.5;
    float wz = noonNoise2(px * 0.42 + 8.1, pz * 0.42 + 2.9) - 0.5;
    float qx = px + wx * 1.65;
    float qz = pz + wz * 1.65;
    float ux = (qx * 0.80 - qz * 0.60) * (p.y * 0.46);
    float uy = (qx * 0.60 + qz * 0.80) * (p.y * 0.50) + dy * p.z * 0.022;
    float n0 = noonNoise2(ux, uy);
    float n1 = noonNoise2(ux * 1.93 + 3.7, uy * 2.07 + 5.1);
    float n2 = noonNoise2(ux * 2.9 + 9.1, uy * 2.85 + 2.3);
    float billow = n0 * 0.52 + n1 * 0.30 + n2 * 0.18;
    stroke = smoothstep(0.42, 0.75, billow);
    stroke *= 0.64 + 0.36 * smoothstep(0.34, 0.76, n1);
    stroke *= p.x;
  }
  return stroke * band;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 sunN = normalize(uGlowDir);
  vec3 col = mix(uBottom, uTop, pow(clamp(d.y, 0.0, 1.0), 0.62));
  float sunCos = max(dot(d, sunN), 0.0);
  float g = pow(sunCos, 9.0) * uGlowAmt;
  col += uGlow * g;

  // Only dawn/dusk: peach near the light, pink shoulders, blue-lilac opposite it.
  // Elevation and solar bearing are separate so this never becomes an orange wash.
  float twilightFacing = 0.0;
  float twilightBand = 0.0;
  if (uTwilightAmount > 0.0) {
    vec2 dirXZ = normalize(d.xz + vec2(0.00001));
    vec2 solarBearing = normalize(uGlowDir.xz + vec2(0.00001));
    float azDot = dot(dirXZ, solarBearing);
    twilightFacing = pow(clamp(azDot * 0.5 + 0.5, 0.0, 1.0), 1.55);
    float forwardFacing = pow(max(azDot, 0.0), 1.35);
    float tightFacing = pow(max(azDot, 0.0), 4.2);
    float elev = clamp(d.y, 0.0, 1.0);
    twilightBand = exp(-pow(max(elev - 0.025, 0.0) * 5.6, 2.0));
    float midArch = exp(-pow(max(elev - 0.16, 0.0) * 3.8, 2.0));
    float highClear = smoothstep(0.18, 0.58, elev);

    // Directional Rayleigh + Mie atmospheric twilight gradient (no chalky opaque horizon slab)
    vec3 coreGold = mix(vec3(1.0, 0.84, 0.58), vec3(1.0, 0.64, 0.30), uTwilightDusk);
    vec3 warmHorizon = mix(vec3(0.96, 0.74, 0.58), vec3(0.92, 0.50, 0.36), uTwilightDusk);
    vec3 venusBand = mix(vec3(0.56, 0.58, 0.74), vec3(0.42, 0.38, 0.56), uTwilightDusk);
    vec3 deepZenith = mix(vec3(0.28, 0.45, 0.72), vec3(0.14, 0.22, 0.42), uTwilightDusk);

    col = mix(col, deepZenith, uTwilightAmount * highClear * 0.42);
    col = mix(col, venusBand, uTwilightAmount * midArch * (1.0 - forwardFacing * 0.76) * 0.36);
    col = mix(col, warmHorizon, uTwilightAmount * twilightBand * (0.12 + 0.46 * forwardFacing));
    col = mix(col, coreGold, uTwilightAmount * twilightBand * tightFacing * 0.52);

    // Broad atmospheric Mie aureole melting naturally into the horizon & mountains
    float wideScatter = pow(sunCos, 4.5) * (1.0 - smoothstep(0.08, 0.52, elev));
    float innerAureole = pow(sunCos, 18.0) * (1.0 - smoothstep(0.16, 0.48, elev));
    col += coreGold * (wideScatter * 0.18 + innerAureole * 0.24) * uTwilightAmount;

    float horizonVeil = exp(-pow(elev * 10.5, 2.0));
    vec3 sunVeilCol = mix(vec3(0.94, 0.78, 0.66), vec3(0.88, 0.60, 0.48), uTwilightDusk);
    vec3 backVeilCol = mix(vec3(0.76, 0.68, 0.72), vec3(0.60, 0.50, 0.58), uTwilightDusk);
    vec3 veilCol = mix(backVeilCol, sunVeilCol, twilightFacing);
    col = mix(col, veilCol, uTwilightAmount * horizonVeil * (0.16 + 0.18 * forwardFacing));
  }

  // 云是一层水平顶棚：视线越贴地平线，看到的云越远、越淡；双阶域扭曲 + 云头受光鼓起 + 云底氤氲留白
  float vis = uCloudOpacity * smoothstep(0.02, mix(0.28, 0.13, uCloudLow), d.y);
  vec2 cp = vec2(0.0);
  float body = 0.0;
  if (vis > 0.001 || uTwilightAmount > 0.0) {
    float ceilScale = 1.0 / (max(d.y, 0.06) + 0.14);
    vec2 uv = d.xz * ceilScale + vec2(uCloudTime * 0.36, uCloudTime * 0.15);
    vec2 warpLo = vec2(cnoise(uv * 0.16 + 3.1), cnoise(uv * 0.16 + 8.7)) - 0.5;
    uv += warpLo * 2.15;
    cp = uv * 0.46;
    float thr = mix(0.68, 0.28, clamp(uCloudCover, 0.0, 1.0));
    float soft = max(0.065, uCloudSoft * 1.25);
    vec2 sunStep = normalize(uGlowDir.xz + vec2(0.0001)) * 0.26;
    float macro = cfbm3(cp * 0.62 + vec2(1.4, -0.8));
    float puff = cfbm3(cp * 1.28 + warpLo * 0.9);
    float n = macro * 0.58 + puff * 0.42;
    float dens = vis > 0.001 ? smoothstep(thr - soft * 1.15, thr + soft * 0.95, n) : 0.0;
    if (dens > 0.001 || (uTwilightAmount > 0.0 && d.y > 0.03 && d.y < 0.46)) {
      float nSun = cfbm2((cp + sunStep) * 0.62 + vec2(1.4, -0.8)) * 0.62 + cfbm2((cp + sunStep) * 1.28) * 0.38;
      body = clamp(smoothstep(thr - soft * 0.8, thr + soft * 1.3, n) * 0.62 + clamp((n - nSun) * 2.4 + 0.48, 0.0, 1.0) * 0.38, 0.0, 1.0);
    }
    if (vis > 0.001 && dens > 0.001) {
      float wispGrain = 0.72 + 0.28 * smoothstep(0.28, 0.76, cnoise(cp * vec2(0.9, 3.2) + vec2(uCloudTime * 0.10, 0.0)));
      float edgeFeather = smoothstep(0.0, 0.55, dens);
      dens *= mix(wispGrain, 1.0, edgeFeather * 0.65);
      // 云腹带一丝天光青黛，云头暖白受光，边缘镶柔和银边
      vec3 skyBounce = mix(uBottom, uTop, 0.38);
      vec3 cLow = mix(uCloudColor * (1.0 - uCloudShade * 0.34), skyBounce, 0.22);
      vec3 cHi = min(uCloudColor * 1.04 + uGlow * 0.04, vec3(1.0));
      vec3 cc = mix(cLow, cHi, smoothstep(0.18, 0.86, body));
      float silverRim = (1.0 - smoothstep(0.45, 0.92, dens)) * smoothstep(0.06, 0.45, dens) * pow(sunCos, 2.5);
      cc += uGlow * (g * 0.45 * (0.35 + 0.65 * dens) + silverRim * 0.22);
      if (uTwilightAmount > 0.0) {
        float sunSide = pow(max(twilightFacing, 0.0), 1.4);
        float underRim = (1.0 - body * 0.65) * (0.28 + 0.72 * sunSide);
        vec3 rimTint = mix(vec3(1.0, 0.82, 0.64), vec3(1.0, 0.64, 0.36), uTwilightDusk);
        vec3 shadowTop = mix(vec3(0.46, 0.52, 0.68), vec3(0.28, 0.32, 0.48), uTwilightDusk);
        cc = mix(cc, shadowTop, uTwilightAmount * 0.42 * (0.35 + 0.65 * (1.0 - sunSide)));
        cc = mix(cc, rimTint, uTwilightAmount * underRim * 0.70);
      }
      col = mix(col, cc, clamp(dens * vis, 0.0, 0.92));
    }
  }

  // 雾天／雨天再铺一层近地平线的低云，天边不会突然露出一块蓝
  if (uCloudLow > 0.001 && vis > 0.001) {
    float deck = uCloudLow * exp(-pow((d.y - 0.10) * 6.5, 2.0));
    if (deck > 0.001) {
      float dn = cnoise(cp * 0.55 + vec2(uCloudTime * 0.22, 0.0));
      col = mix(col, uCloudColor * 0.94, deck * (0.3 + 0.7 * dn) * vis * 0.6);
    }
  }

  // 正午远空轻云：散点舒卷的高空淡云团，与主云错层呼应，绝不成环带
  float ncStroke = noonCloudStroke(d.y, d.x, d.z, uCloudTime, uNoonCloud);
  if (ncStroke > 0.001) {
    vec3 ncShadow = mix(uNoonCloudColor * 0.86, mix(uBottom, uTop, 0.32), 0.26);
    vec3 ncCol = mix(ncShadow, min(uNoonCloudColor * 1.03, vec3(1.0)), smoothstep(0.12, 0.68, ncStroke));
    col = mix(col, ncCol, clamp(ncStroke * uNoonCloud.w * 0.78, 0.0, 0.42));
  }

  if (uTwilightAmount > 0.0) {
    // Soft domain-warped spherical cirrus wisps near horizon (never ruler-straight perspective grid bands)
    float elev = clamp(d.y, 0.0, 1.0);
    float cloudElevation = smoothstep(0.03, 0.12, elev) * (1.0 - smoothstep(0.26, 0.46, elev));
    if (cloudElevation > 0.001) {
      vec3 spDir = vec3(d.x, elev * 2.2, d.z);
      vec2 spA = vec2(spDir.x * 2.2 + elev * 1.3, spDir.z * 2.2 + elev * 6.0) + vec2(uCloudTime * 0.08, uCloudTime * 0.02);
      float warp = cfbm3(spA * 1.15);
      float wispMain = cfbm3(spA * 1.45 + vec2(warp * 1.15, -warp * 0.65));
      float twilightCloud = smoothstep(0.46, 0.74, wispMain);
      float warmEdge = smoothstep(0.44, 0.72, wispMain) * (0.20 + 0.80 * twilightFacing);
      vec3 slateCloud = mix(vec3(0.54, 0.56, 0.72), vec3(0.32, 0.34, 0.50), uTwilightDusk);
      vec3 fireCloud = mix(vec3(1.0, 0.80, 0.62), vec3(1.0, 0.60, 0.34), uTwilightDusk);
      vec3 litCloud = mix(slateCloud, fireCloud, warmEdge * 0.88);
      litCloud += vec3(0.16, 0.09, 0.03) * body * twilightFacing;
      float wispAlpha = twilightCloud * cloudElevation * uTwilightAmount * (0.22 + 0.34 * twilightFacing);
      col = mix(col, litCloud, wispAlpha);
    }
  }

  if (uStarOp > 0.05 && d.y > 0.06) {
    // 晴夜淡墨银汉：斜贯天顶的水墨星河晕带，云厚雨重时自然淡隐
    vec3 mwAxis = normalize(vec3(0.46, 0.56, -0.68));
    float mwBand = exp(-pow(abs(dot(d, mwAxis)) * 5.2, 2.0)) * smoothstep(0.08, 0.34, d.y);
    if (mwBand > 0.001) {
      float mwFbm = cfbm3(vec2(d.x * 4.8 + d.z * 3.1, d.y * 5.2 - d.x * 2.4));
      float mwMottle = smoothstep(0.30, 0.74, mwFbm) * (0.72 + 0.28 * cnoise(d.xz * 14.0));
      float mwAlpha = mwBand * mwMottle * smoothstep(0.05, 0.75, uStarOp) * (1.0 - clamp(uCloudCover * 0.70, 0.0, 0.78));
      col += vec3(0.12, 0.16, 0.22) * mwAlpha;
    }
  }

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const STAR_VERT = `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uPixel;
varying float vTw;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vTw = 0.68 + 0.32 * sin(uTime * 1.6 + aPhase * 6.283);
  gl_PointSize = aSize * uPixel * (260.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}
`;

const STAR_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vTw;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.04, d) * uOpacity * vTw;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

// 日轮 / 月轮：一张程序化软圆，中心实、边缘散，和纸上的墨晕一个道理
function discTexture(size, stops) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const LUNAR_PHASES = [
  { name: '望月', phase: 0.50, fullness: 1.00 },
  { name: '亏凸月', phase: 0.62, fullness: 0.84 },
  { name: '下弦月', phase: 0.75, fullness: 0.58 },
  { name: '残月', phase: 0.87, fullness: 0.34 },
  { name: '蛾眉月', phase: 0.14, fullness: 0.36 },
  { name: '上弦月', phase: 0.25, fullness: 0.60 },
  { name: '盈凸月', phase: 0.38, fullness: 0.86 }
];

// 月相程序化贴图：phase ∈ (0,1)，0.5 为满月，其余按阴晴圆缺柔切月牙并保留淡青外晕
function moonPhaseTexture(size, phase) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const cx = size * 0.5;
  const cy = size * 0.5;
  const discR = size * 0.23;
  const gHalo = ctx.createRadialGradient(cx, cy, discR * 0.55, cx, cy, size * 0.5);
  const full = Math.max(0.28, 1 - Math.abs(phase - 0.5) * 1.45);
  gHalo.addColorStop(0, `rgba(226,238,248,${(0.36 * full).toFixed(3)})`);
  gHalo.addColorStop(0.55, `rgba(216,232,244,${(0.12 * full).toFixed(3)})`);
  gHalo.addColorStop(1, 'rgba(216,232,244,0)');
  ctx.fillStyle = gHalo;
  ctx.fillRect(0, 0, size, size);

  if (typeof ctx.save === 'function' && typeof ctx.beginPath === 'function' && typeof ctx.arc === 'function') {
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d');
    if (octx && typeof octx.arc === 'function' && typeof ctx.drawImage === 'function') {
      octx.beginPath();
      octx.arc(cx, cy, discR, 0, Math.PI * 2);
      octx.fillStyle = 'rgba(250,252,255,0.98)';
      octx.fill();
      const offset = (phase - 0.5) * 2 * discR * 1.18;
      if (Math.abs(offset) > 0.5) {
        octx.globalCompositeOperation = 'destination-out';
        octx.beginPath();
        octx.arc(cx - offset, cy - discR * 0.08, discR * 0.96, 0, Math.PI * 2);
        octx.fillStyle = 'rgba(0,0,0,0.94)';
        octx.fill();
        octx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(off, 0, 0);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const NUM = ['fogNear', 'fogFar', 'sunI', 'hemiI', 'fillI', 'glowI', 'sunOp', 'moonOp', 'starOp', 'unlit', 'tintMix', 'hillBlend', 'cloudCover', 'cloudOpacity', 'cloudSoft', 'cloudShade', 'cloudSpeed', 'cloudLow', 'legacyNight', 'dawn', 'dusk', 'twilightGate'];
const COL = ['skyTop', 'skyBottom', 'fog', 'sun', 'hemiSky', 'hemiGround', 'fill', 'glow', 'tint', 'smokeC', 'cloud'];

function blankState() {
  const s = {
    dir: new THREE.Vector3(0.44, 0.72, 0.39)
  };
  for (let i = 0; i < NUM.length; i++) s[NUM[i]] = 0;
  for (let i = 0; i < COL.length; i++) s[COL[i]] = new THREE.Color();
  return s;
}

export function createSky(cfg, scene, renderer, camera, opts) {
  const weatherFx = (opts && opts.weather) || null;
  const sound = (opts && opts.sound) || null;
  const smoke = (opts && opts.smoke) || null;
  const lights = (opts && opts.lights) || {};

  const order = cfg.order;
  const baseWeatherOrder = cfg.weatherOrder;
  const times = cfg.times;
  const snowWeatherDefault = phenologySeasons.snowWeather || {
    name: '雪', hint: '朔雪纷飞，千山万径皆成素白',
    fogNear: 0.48, fogFar: 0.50, light: 0.78, skyMix: 0.68, skyTint: '#DCE3E7',
    rain: 0, snow: 1, mist: 0.30, wind: 0.28, unlit: 0.92, hill: 0.68,
    cloudColor: '#E8EEF0', cloudBlend: 0.82, cloudCover: 0.44, cloudOpacity: 0.12,
    cloudSoft: 0.08, cloudShade: 0.14, cloudSpeed: 0.72, cloudLow: 0.72,
    sound: { rain: 0, wind: 0.32 }
  };
  const weathers = cfg.weathers.snow ? cfg.weathers : { ...cfg.weathers, snow: snowWeatherDefault };
  const allWeatherIds = baseWeatherOrder.includes('snow') ? baseWeatherOrder : [...baseWeatherOrder, 'snow'];
  const winterWeatherOrder = ['clear', 'snow', ...baseWeatherOrder.filter(id => id !== 'clear' && id !== 'snow')];
  const cloudDefaults = cfg.clouds || {};

  const params = new URLSearchParams(window.location.search);
  const qHour = params.get('hour');
  const qWeather = params.get('weather');
  const qSeason = params.get('season') || params.get('phenology');
  let timeIndex = order.indexOf(qHour && times[qHour] ? qHour : cfg.start.time);
  if (timeIndex < 0) timeIndex = 0;
  let currentWeatherId = qWeather && weathers[qWeather] ? qWeather : cfg.start.weather;
  if (!weathers[currentWeatherId]) currentWeatherId = baseWeatherOrder[0] || 'clear';

  // 每种天气占一份权重，切换时互相消长，所有修饰都是权重的加权和
  const weight = {};
  for (let i = 0; i < allWeatherIds.length; i++) {
    const id = allWeatherIds[i];
    weight[id] = id === currentWeatherId ? 1 : 0;
  }

  const cur = blankState();
  const tgt = blankState();
  const wscalar = { rain: 0, snow: 0, mist: 0, wind: 0 };
  // Stable public payload: no per-frame vectors, colours, or object allocations.
  const twilight = { amount: 0, dawn: 0, dusk: 0, direction: cur.dir, color: cur.sun, clock: 0 };

  const white = new THREE.Color('#FFFFFF');
  const rainColor = new THREE.Color();
  const snowColor = new THREE.Color('#F7F6F0');
  const mistColor = new THREE.Color();
  const tintC = new THREE.Color();
  const cloudC = new THREE.Color();
  const tmp = new THREE.Color();
  const weatherState = { rain: 0, snow: 0, mist: 0, wind: 0, windX: 0, windZ: 0, pixelRatio: 1, rainColor, snowColor, mistColor };

  // ---- 天空穹顶：一整片渐变，不写深度，利用 Early-Z 跳过被地形/建筑遮挡的像素 ----
  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color('#EDE4D0') },
      uBottom: { value: new THREE.Color('#F6EFDF') },
      uGlow: { value: new THREE.Color('#FFF3D6') },
      uGlowDir: { value: new THREE.Vector3(0.44, 0.72, 0.39) },
      uGlowAmt: { value: 0.3 },
      uCloudColor: { value: new THREE.Color('#FFFFFF') },
      uCloudCover: { value: 0.42 },
      uCloudOpacity: { value: 0.85 },
      uCloudSoft: { value: 0.16 },
      uCloudShade: { value: 0.3 },
      uCloudLow: { value: 0 },
      uCloudTime: { value: 0 },
      uTwilightAmount: { value: 0 },
      uTwilightDawn: { value: 0 },
      uTwilightDusk: { value: 0 },
      uNoonCloud: { value: new THREE.Vector4(0, 3.1, 16.0, 0.42) },
      uNoonCloudColor: { value: new THREE.Color('#F6F3E9') },
      uStarOp: { value: 0 }
    },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    fog: false
  });
  domeMat.userData.skyIgnore = true;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(cfg.dome.radius, cfg.dome.segments, cfg.dome.heightSegments),
    domeMat
  );
  dome.name = 'sky-dome';
  dome.renderOrder = 1;
  dome.frustumCulled = false;
  scene.add(dome);

  // ---- 日轮与月轮：同一条方向，白天是日、夜里是月 ----
  const sunMat = new THREE.SpriteMaterial({
    map: discTexture(128, [
      [0, 'rgba(255,253,246,1)'],
      [0.16, 'rgba(255,243,214,0.96)'],
      [0.38, 'rgba(255,231,190,0.34)'],
      [1, 'rgba(255,231,190,0)']
    ]),
    transparent: true,
    depthWrite: false,
    opacity: 0,
    fog: false
  });
  const daySunTexture = sunMat.map;
  const twilightSunTexture = discTexture(256, [
    [0, 'rgba(255,253,242,1)'], [0.085, 'rgba(255,240,208,0.97)'],
    [0.14, 'rgba(255,208,158,0.66)'], [0.26, 'rgba(255,176,128,0.28)'],
    [0.48, 'rgba(255,152,118,0.095)'], [0.76, 'rgba(248,138,120,0.025)'],
    [1, 'rgba(248,138,120,0)']
  ]);
  sunMat.userData.skyIgnore = true;
  const sunSprite = new THREE.Sprite(sunMat);
  sunSprite.name = 'sky-sun';
  sunSprite.scale.set(cfg.sun.size, cfg.sun.size, 1);
  sunSprite.frustumCulled = false;
  scene.add(sunSprite);

  const fullMoonTexture = discTexture(128, [
    [0, 'rgba(250,252,255,1)'],
    [0.34, 'rgba(238,246,252,0.96)'],
    [0.46, 'rgba(226,238,248,0.3)'],
    [1, 'rgba(226,238,248,0)']
  ]);
  const lunarPhaseTexCache = new Map();
  lunarPhaseTexCache.set(0, fullMoonTexture);
  let lunarPhaseIdx = 0;
  const lunarState = {
    dayCount: 1,
    index: 0,
    name: LUNAR_PHASES[0].name,
    phase: LUNAR_PHASES[0].phase,
    fullness: LUNAR_PHASES[0].fullness,
    direction: cur.dir
  };
  function setLunarDay(dayCount = 1) {
    const d = Math.max(1, Math.floor(Number(dayCount) || 1));
    const idx = (d - 1) % LUNAR_PHASES.length;
    lunarState.dayCount = d;
    if (idx === lunarPhaseIdx) return lunarState;
    lunarPhaseIdx = idx;
    const spec = LUNAR_PHASES[idx];
    lunarState.index = idx;
    lunarState.name = spec.name;
    lunarState.phase = spec.phase;
    lunarState.fullness = spec.fullness;
    let tex = lunarPhaseTexCache.get(idx);
    if (!tex) {
      tex = moonPhaseTexture(128, spec.phase);
      lunarPhaseTexCache.set(idx, tex);
    }
    moonMat.map = tex;
    moonMat.needsUpdate = true;
    return lunarState;
  }

  const moonMat = new THREE.SpriteMaterial({
    map: fullMoonTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0,
    fog: false
  });
  moonMat.userData.skyIgnore = true;
  const moonSprite = new THREE.Sprite(moonMat);
  moonSprite.name = 'sky-moon';
  moonSprite.scale.set(cfg.moon.size, cfg.moon.size, 1);
  moonSprite.frustumCulled = false;
  scene.add(moonSprite);

  // ---- 星子：只在天顶上点几笔，靠近地平线就淡下去 ----
  const starCount = cfg.stars.count;
  const starPos = new Float32Array(starCount * 3);
  const starSize = new Float32Array(starCount);
  const starPhase = new Float32Array(starCount);
  const starR = cfg.stars.radius;
  for (let i = 0; i < starCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 0.06 + Math.random() * 0.94;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    starPos[i * 3] = Math.cos(a) * r * starR;
    starPos[i * 3 + 1] = y * starR;
    starPos[i * 3 + 2] = Math.sin(a) * r * starR;
    starSize[i] = cfg.stars.sizeRange[0] + Math.random() * (cfg.stars.sizeRange[1] - cfg.stars.sizeRange[0]);
    starPhase[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  starGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(starSize, 1));
  starGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(starPhase, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(cfg.stars.color) },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() }
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false
  });
  starMat.userData.skyIgnore = true;
  const stars = new THREE.Points(starGeo, starMat);
  stars.name = 'sky-stars';
  stars.frustumCulled = false;
  scene.add(stars);

  // ---- 一次登记材质：保留顶点色/风摆与私有片元审计，月夜渐回原始颜色公式 ----
  const unlit = [];
  const hills = [];
  const registered = new Set();
  const appearanceRestorers = [];
  const desaturation = { value: 0 };
  // Borrowed live view for frame consumers. The container is read-only; Colors
  // are sky-owned LINEAR values: copy/read them, never mutate or dispose them.
  // Keep getAppearance() below as the independent serializable debug snapshot.
  const appearanceState = Object.freeze({
    get timeId() { return order[timeIndex]; },
    get weatherId() { return currentWeatherId; },
    get night() { return cur.legacyNight; },
    get desaturation() { return desaturation.value; },
    get unlitScale() { return cur.unlit; },
    skyTop: cur.skyTop, skyBottom: cur.skyBottom, fogColor: cur.fog
  });
  const nightStarOpacity = times.night ? times.night.starOpacity : 0.9;
  const unlitLight = new THREE.Color();
  const legacyUnlit = new THREE.Color();
  const _phenTmp = new THREE.Color();
  let phenologyId = (!qSeason && qWeather === 'snow') ? 'winter' : 'spring';
  function applyMaterials() {
    desaturation.value = skyDesaturation(cur.starOp, nightStarOpacity);
    // 相乘而非加一层夜色：暗花瓣/草根保持暗，白色实例乘子不再抬亮整片顶点色。
    unlitLight.copy(white).lerp(cur.tint, cur.tintMix).multiplyScalar(cur.unlit);
    for (let i = 0; i < unlit.length; i++) {
      const e = unlit[i];
      e.mat.color.copy(e.base).multiply(unlitLight);
      // Exact pre-round4 formula at settled night, independent of weather/stars.
      legacyUnlit.copy(e.base).multiplyScalar(cur.unlit).lerp(cur.tint, cur.tintMix);
      e.mat.color.lerp(legacyUnlit, cur.legacyNight);
    }
    for (let i = 0; i < hills.length; i++) {
      const h = hills[i];
      h.mat.color.copy(h.base).multiplyScalar(cur.unlit).lerp(cur.fog, cur.hillBlend);
    }
  }
  function setMaterialBaseColor(mat, color) {
    if (!mat || color === undefined || color === null) return false;
    let hit = false;
    for (let i = 0; i < unlit.length; i++) {
      if (unlit[i].mat === mat) {
        if (color.isColor) unlit[i].base.copy(color);
        else unlit[i].base.set(color);
        hit = true;
      }
    }
    for (let i = 0; i < hills.length; i++) {
      if (hills[i].mat === mat) {
        if (color.isColor) hills[i].base.copy(color);
        else hills[i].base.set(color);
        hit = true;
      }
    }
    if (hit) applyMaterials();
    return hit;
  }
  function registerMaterials(root) {
    root.traverse(function (o) {
      const m = o.material;
      if (!m) return;
      let mountain = false;
      for (let p = o; p; p = p.parent) if (p.name === 'mountains') mountain = true;
      const list = Array.isArray(m) ? m : [m];
      for (let i = 0; i < list.length; i++) {
        const mat = list[i];
        if (!mat || mat.userData.skyIgnore || registered.has(mat)) continue;
        if (!mat.isMeshBasicMaterial && !mat.isMeshLambertMaterial &&
            !mat.isMeshStandardMaterial && !mat.isMeshPhongMaterial) continue;
        registered.add(mat);
        const restore = installSkyAppearance(mat, desaturation);
        if (restore) appearanceRestorers.push(restore);
        if (mat.isMeshBasicMaterial) {
          (mountain ? hills : unlit).push({ mat, base: mat.color.clone(), origBase: mat.color.clone() });
        }
      }
    });
    applyMaterials();
  }

  function computeTarget() {
    const timeId = order[timeIndex];
    const t = times[timeId];
    tgt.legacyNight = timeId === 'night' ? 1 : 0;
    tgt.dawn = timeId === 'dawn' ? 1 : 0;
    tgt.dusk = timeId === 'dusk' ? 1 : 0;
    tgt.skyTop.set(t.skyTop);
    tgt.skyBottom.set(t.skyBottom);
    tgt.fog.set(t.fogColor);
    tgt.fogNear = t.fogNear;
    tgt.fogFar = t.fogFar;
    tgt.sun.set(t.sunColor);
    tgt.sunI = t.sunIntensity;
    tgt.dir.set(t.sunDir[0], t.sunDir[1], t.sunDir[2]).normalize();
    tgt.hemiSky.set(t.hemiSky);
    tgt.hemiGround.set(t.hemiGround);
    tgt.hemiI = t.hemiIntensity;
    tgt.fill.set(t.fillColor);
    tgt.fillI = t.fillIntensity;
    tgt.glow.set(t.glowColor);
    tgt.glowI = t.glowAmount;
    tgt.sunOp = t.sunOpacity;
    tgt.moonOp = t.moonOpacity;
    tgt.starOp = t.starOpacity;
    tgt.unlit = t.unlitScale;
    tgt.tint.set(t.unlitTint);
    tgt.tintMix = t.unlitMix;
    tgt.hillBlend = t.hillBlend;
    tgt.smokeC.set(t.smokeColor);
    tgt.cloud.set(t.cloudColor || cloudDefaults.color || '#FFFFFF');
    tgt.cloudCover = t.cloudCover ?? (cloudDefaults.cover ?? 0.42);
    tgt.cloudOpacity = t.cloudOpacity ?? 0.85;
    tgt.cloudSoft = t.cloudSoft ?? (cloudDefaults.soft ?? 0.16);
    tgt.cloudShade = t.cloudShade ?? (cloudDefaults.shade ?? 0.3);
    tgt.cloudSpeed = t.cloudSpeed ?? 1;
    tgt.cloudLow = t.cloudLow ?? 0;
    applyTwilightPalette(tgt, timeId);

    // 天气只做修饰：雾的远近、光的强弱、天空与雾里掺的天色
    let fogNearM = 0;
    let fogFarM = 0;
    let lightM = 0;
    let skyMix = 0;
    let unlitM = 0;
    let hillM = 0;
    // 云的天气修饰一律为「相对天时基准的增量／倍数」，按权重渐变
    let cCover = 0, cOpacity = 0, cSoft = 0, cShade = 0, cLow = 0;
    let cSpeedSum = 0, cColorMix = 0, extinction = 0;
    let sum = 0;
    tintC.setRGB(0, 0, 0);
    cloudC.setRGB(0, 0, 0);
    for (let i = 0; i < allWeatherIds.length; i++) {
      const id = allWeatherIds[i];
      const k = weight[id];
      if (k < 0.001) continue;
      const w = weathers[id];
      sum += k;
      fogNearM += w.fogNear * k;
      fogFarM += w.fogFar * k;
      lightM += w.light * k;
      extinction += ((w.rain || 0) * .88 + (w.snow || 0) * .78 + (w.mist || 0) * .55) * k;
      skyMix += w.skyMix * k;
      unlitM += w.unlit * k;
      hillM += w.hill * k;
      tmp.set(w.skyTint);
      tintC.r += tmp.r * k;
      tintC.g += tmp.g * k;
      tintC.b += tmp.b * k;
      // 每种天气都给出云目标色与掺入强度，晴天的掺入强度为 0，保留天时的暖色云
      tmp.set(w.cloudColor || '#FFFFFF');
      cloudC.r += tmp.r * k;
      cloudC.g += tmp.g * k;
      cloudC.b += tmp.b * k;
      cColorMix += (w.cloudBlend ?? 0) * k;
      cCover += (w.cloudCover ?? 0) * k;
      cOpacity += (w.cloudOpacity ?? 0) * k;
      cSoft += (w.cloudSoft ?? 0) * k;
      cShade += (w.cloudShade ?? 0) * k;
      cLow += (w.cloudLow ?? 0) * k;
      cSpeedSum += (w.cloudSpeed ?? 1) * k;
    }
    const inv = sum > 0.001 ? 1 / sum : 1;
    fogNearM *= inv;
    fogFarM *= inv;
    lightM *= inv;
    skyMix *= inv;
    // 夜里天色本来就沉，阴雨的灰要掺得少些，否则雨夜会亮成黄昏
    skyMix *= t.skyMixScale;
    unlitM *= inv;
    hillM *= inv;
    tintC.r *= inv;
    tintC.g *= inv;
    tintC.b *= inv;
    cloudC.r *= inv;
    cloudC.g *= inv;
    cloudC.b *= inv;
    const cSpeed = cSpeedSum * inv;
    const cBlend = cColorMix * inv;

    tgt.fogNear *= fogNearM;
    tgt.fogFar *= fogFarM;
    tgt.sunI *= lightM;
    tgt.hemiI *= lightM;
    tgt.fillI *= Math.max(0.55, lightM);
    tgt.skyTop.lerp(tintC, skyMix * 0.55);
    tgt.skyBottom.lerp(tintC, skyMix * 0.8);
    tgt.fog.lerp(tintC, skyMix * 0.75);
    tgt.unlit *= unlitM;
    // 起雾落雨时天边一片灰，远山不跟着淡下去就成了纸片
    tgt.hillBlend = Math.min(0.94, tgt.hillBlend + hillM);

    // 云：从天时基准出发，叠加天气增量与倍数；颜色按天气掺入强度混合
    tgt.cloud.lerp(cloudC, cBlend);
    tgt.cloudCover = Math.max(0, Math.min(1, tgt.cloudCover + cCover * inv));
    tgt.cloudOpacity = Math.max(0, Math.min(1, tgt.cloudOpacity + cOpacity * inv));
    tgt.cloudSoft = Math.max(0.045, tgt.cloudSoft + cSoft * inv);
    tgt.cloudShade = Math.max(0, Math.min(1, tgt.cloudShade + cShade * inv));
    tgt.cloudSpeed *= cSpeed;
    tgt.cloudLow = Math.max(0, Math.min(1, tgt.cloudLow + cLow * inv));
    tgt.twilightGate = twilightWeatherGate(tgt.cloudCover, tgt.cloudLow, extinction * inv);

    const phenCfg = phenologyId !== 'spring' ? phenologySeasons.sky?.[phenologyId] : null;
    if (phenCfg) {
      const dayWeight = (1 - tgt.legacyNight * 0.85) * (1 - Math.max(tgt.dawn, tgt.dusk) * 0.45);
      const groundWeight = 1 - tgt.legacyNight * 0.75;
      if (phenCfg.skyTopMix) tgt.skyTop.lerp(_phenTmp.set(phenCfg.skyTopTint), phenCfg.skyTopMix * dayWeight);
      if (phenCfg.skyBottomMix) tgt.skyBottom.lerp(_phenTmp.set(phenCfg.skyBottomTint), phenCfg.skyBottomMix * dayWeight);
      if (phenCfg.fogMix) tgt.fog.lerp(_phenTmp.set(phenCfg.fogTint), phenCfg.fogMix * dayWeight);
      if (Number.isFinite(phenCfg.fogNearMul)) tgt.fogNear *= phenCfg.fogNearMul;
      if (Number.isFinite(phenCfg.fogFarMul)) tgt.fogFar *= phenCfg.fogFarMul;
      if (phenCfg.sunMix) tgt.sun.lerp(_phenTmp.set(phenCfg.sunTint), phenCfg.sunMix * groundWeight);
      if (phenCfg.hemiGroundMix) tgt.hemiGround.lerp(_phenTmp.set(phenCfg.hemiGroundTint), phenCfg.hemiGroundMix * groundWeight);
      if (Number.isFinite(phenCfg.cloudCoverDelta)) {
        tgt.cloudCover = Math.max(0.05, Math.min(1, tgt.cloudCover + phenCfg.cloudCoverDelta * dayWeight));
      }
    }
  }

  function computeScalars() {
    let rain = 0;
    let snow = 0;
    let mist = 0;
    let wind = 0;
    let sum = 0;
    for (let i = 0; i < allWeatherIds.length; i++) {
      const id = allWeatherIds[i];
      const k = weight[id];
      if (k < 0.001) continue;
      const w = weathers[id];
      sum += k;
      rain += (w.rain || 0) * k;
      snow += (w.snow || 0) * k;
      mist += (w.mist || 0) * k;
      wind += (w.wind || 0) * k;
    }
    const inv = sum > 0.001 ? 1 / sum : 1;
    wscalar.rain = rain * inv;
    wscalar.snow = snow * inv;
    wscalar.mist = mist * inv;
    wscalar.wind = wind * inv;
  }

  function approach(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const k = 1 - Math.exp(-dt / Math.max(cfg.smoothing, 0.001));
    for (let i = 0; i < NUM.length; i++) {
      const n = NUM[i];
      cur[n] += (tgt[n] - cur[n]) * k;
    }
    for (let i = 0; i < COL.length; i++) {
      const n = COL[i];
      cur[n].lerp(tgt[n], k);
    }
    cur.dir.lerp(tgt.dir, k).normalize();
  }

  function copyState(dst, src) {
    for (let i = 0; i < NUM.length; i++) dst[NUM[i]] = src[NUM[i]];
    for (let i = 0; i < COL.length; i++) dst[COL[i]].copy(src[COL[i]]);
    dst.dir.copy(src.dir);
  }

  function apply() {
    twilight.dawn = cur.dawn * cur.twilightGate;
    twilight.dusk = cur.dusk * cur.twilightGate;
    if (twilight.dawn < 1e-6) twilight.dawn = 0;
    if (twilight.dusk < 1e-6) twilight.dusk = 0;
    twilight.amount = Math.min(1, twilight.dawn + twilight.dusk);
    twilight.clock = clock;
    domeMat.uniforms.uTwilightAmount.value = twilight.amount;
    domeMat.uniforms.uTwilightDawn.value = twilight.dawn;
    domeMat.uniforms.uTwilightDusk.value = twilight.dusk;
    domeMat.uniforms.uTop.value.copy(cur.skyTop);
    domeMat.uniforms.uBottom.value.copy(cur.skyBottom);
    domeMat.uniforms.uGlow.value.copy(cur.glow);
    domeMat.uniforms.uGlowDir.value.copy(cur.dir);
    domeMat.uniforms.uGlowAmt.value = cur.glowI;
    domeMat.uniforms.uCloudColor.value.copy(cur.cloud);
    domeMat.uniforms.uCloudCover.value = cur.cloudCover;
    domeMat.uniforms.uCloudOpacity.value = cur.cloudOpacity * (1 - 0.28 * twilight.amount);
    domeMat.uniforms.uCloudSoft.value = cur.cloudSoft;
    domeMat.uniforms.uCloudShade.value = cur.cloudShade;
    domeMat.uniforms.uCloudLow.value = cur.cloudLow;
    domeMat.uniforms.uCloudTime.value = cloudClock;
    domeMat.uniforms.uNoonCloud.value.x = noonCloudAmt;
    domeMat.uniforms.uStarOp.value = cur.starOp;

    if (scene.background && scene.background.isColor) scene.background.copy(cur.fog);
    scene.fog.color.copy(cur.fog);
    scene.fog.near = cur.fogNear;
    scene.fog.far = cur.fogFar;

    if (lights.sun) {
      lights.sun.color.copy(cur.sun);
      lights.sun.intensity = cur.sunI;
      lights.sun.position.copy(cur.dir).multiplyScalar(120);
    }
    if (lights.hemi) {
      lights.hemi.color.copy(cur.hemiSky);
      lights.hemi.groundColor.copy(cur.hemiGround);
      lights.hemi.intensity = cur.hemiI;
    }
    if (lights.fill) {
      lights.fill.color.copy(cur.fill);
      lights.fill.intensity = cur.fillI;
      lights.fill.position.set(-cur.dir.x * 80, 42, -cur.dir.z * 80);
    }

    const twilightPhase = Math.min(1, cur.dawn + cur.dusk);
    sunMat.opacity = cur.sunOp * (1 - twilightPhase + twilightPhase * cur.twilightGate);
    // The original day texture is untouched. The twilight core is behind terrain,
    // but after the dome/cloud pass; no sky/cloud layer can paint over the disc.
    sunMat.map = twilightPhase > .001 ? twilightSunTexture : daySunTexture;
    const sunSize = cfg.sun.size * (1 + 1.65 * twilightPhase);
    sunSprite.scale.set(sunSize, sunSize, 1);
    moonMat.opacity = cur.moonOp;
    sunMat.color.copy(cur.sun);
    moonMat.color.copy(cur.sun);
    sunSprite.visible = cur.sunOp > 0.01;
    moonSprite.visible = cur.moonOp > 0.01;

    starMat.uniforms.uOpacity.value = cur.starOp;
    stars.visible = cur.starOp > 0.01;

    if (smoke && smoke.points) smoke.points.material.uniforms.uColor.value.copy(cur.smokeC);

    applyMaterials();
  }

  function place(cam) {
    dome.position.set(cam.position.x, 0, cam.position.z);
    stars.position.set(cam.position.x, 0, cam.position.z);
    stars.rotation.y = clock * 0.004;
    sunSprite.position.copy(cam.position).addScaledVector(cur.dir, cfg.sun.distance);
    moonSprite.position.copy(cam.position).addScaledVector(cur.dir, cfg.moon.distance);
  }

  // ---- HUD：右上环境栏，支持按键与整行点击切换，切换时顶上给一句 ----
  const hudTime = document.getElementById('sky-time');
  const hudWeather = document.getElementById('sky-weather');
  const hudTimeRow = document.getElementById('sky-time-row') || hudTime?.parentNode || null;
  const hudWeatherRow = document.getElementById('sky-weather-row') || hudWeather?.parentNode || null;
  const toastEl = document.getElementById('sky-toast');
  let hudKey = '';
  let toastTimer = 0;

  function isSkyUiBlocked() {
    const cls = document.body?.classList;
    if (cls?.contains?.('map-open') || cls?.contains?.('field-guide-open') || cls?.contains?.('quest-open') || cls?.contains?.('ui-hidden')) return true;
    if (document.getElementById?.('journal')?.open) return true;
    if (document.getElementById?.('scroll-dialog')?.open) return true;
    return false;
  }

  function announce(name, hint) {
    if (!toastEl) return;
    toastEl.textContent = name + '　' + hint;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2400);
  }

  function syncWeatherTitle() {
    if (!hudWeatherRow) return;
    const curW = weathers[currentWeatherId];
    const choices = activeWeatherCycle().map(function (id) { return weathers[id]?.name || id; }).join(' / ');
    hudWeatherRow.title = '天气：' + (curW?.name || currentWeatherId) + '（按 R 或点击切换：' + choices + '）';
  }

  function updateHud() {
    const key = order[timeIndex] + '|' + currentWeatherId + '|' + phenologyId;
    if (key === hudKey) return;
    hudKey = key;
    if (hudTime && hudTime.dataset?.worldClockManaged !== '1') {
      hudTime.textContent = times[order[timeIndex]].name;
      if (hudTimeRow) {
        hudTimeRow.title = '天时：' + times[order[timeIndex]].name + '（按 T 或点击切换：晨 / 昼 / 暮 / 夜）';
      }
    }
    if (hudWeather && weathers[currentWeatherId]) hudWeather.textContent = weathers[currentWeatherId].name;
    syncWeatherTitle();
  }

  function cycleTime(dir) {
    timeIndex = (timeIndex + (dir || 1) + order.length) % order.length;
    const t = times[order[timeIndex]];
    updateHud();
    announce(t.name, t.hint);
  }

  function activeWeatherCycle() {
    return phenologyId === 'winter' ? winterWeatherOrder : baseWeatherOrder;
  }

  function cycleWeather(dir) {
    const list = activeWeatherCycle();
    let idx = list.indexOf(currentWeatherId);
    if (idx < 0) idx = 0;
    currentWeatherId = list[(idx + (dir || 1) + list.length) % list.length];
    const w = weathers[currentWeatherId];
    updateHud();
    announce(w.name, w.hint);
  }

  function onTimeRowClick(e) {
    if (isSkyUiBlocked()) return;
    e?.stopPropagation?.();
    sound?.unlock?.();
    sky.cycleTime(1);
  }

  function onWeatherRowClick(e) {
    if (isSkyUiBlocked()) return;
    e?.stopPropagation?.();
    sound?.unlock?.();
    sky.cycleWeather(1);
  }

  if (hudTimeRow && typeof hudTimeRow.addEventListener === 'function') {
    if (hudTimeRow.style) {
      hudTimeRow.style.pointerEvents = 'auto';
      hudTimeRow.style.cursor = 'pointer';
    }
    hudTimeRow.addEventListener('click', onTimeRowClick);
  }
  if (hudWeatherRow && typeof hudWeatherRow.addEventListener === 'function') {
    if (hudWeatherRow.style) {
      hudWeatherRow.style.pointerEvents = 'auto';
      hudWeatherRow.style.cursor = 'pointer';
    }
    hudWeatherRow.addEventListener('click', onWeatherRowClick);
  }

  let autoOn = cfg.auto.enabled || params.get('auto') === '1';
  let autoClock = 0;
  let clock = 0;
  let cloudClock = 0;
  let noonCloudAmt = 0;
  let lastNight = null;
  let ambKey = '';

  function pushAmbience() {
    if (!sound || !sound.setAmbience) return;
    const night = Math.min(1, cur.starOp / 0.9);
    const key = wscalar.rain.toFixed(2) + '|' + wscalar.wind.toFixed(2) + '|' + night.toFixed(2);
    if (key === ambKey) return;
    ambKey = key;
    sound.setAmbience({ rain: wscalar.rain, wind: wscalar.wind, night: night });
  }

  function onKeyDown(e) {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || document.body.classList.contains('map-open') || document.body.classList.contains('field-guide-open') || document.body.classList.contains('quest-open') || document.getElementById('journal').open || (e.target && (e.target.isContentEditable || (e.target.closest && e.target.closest('input, textarea, select, button, a[href], [contenteditable]'))))) return;
    if (e.code === cfg.keys.time) sky.cycleTime(1);
    else if (e.code === cfg.keys.weather) sky.cycleWeather(1);
  }
  window.addEventListener('keydown', onKeyDown);

  const sky = {
    wind: 1,
    windX: 0,
    windZ: 0,
    get timeId() { return order[timeIndex]; },
    get weatherId() { return currentWeatherId; },
    get phenologyId() { return phenologyId; },
    get rainIntensity() { return wscalar.rain; },
    get snowIntensity() { return wscalar.snow; },
    getActiveWeatherOrder: function () { return activeWeatherCycle().slice(); },
    setTime: function (id) {
      const i = order.indexOf(id);
      if (i >= 0) {
        timeIndex = i;
        updateHud();
      }
    },
    setWeather: function (id) {
      if (weathers[id]) {
        currentWeatherId = id;
        updateHud();
      }
    },
    setPhenology: function (id) {
      if (id === 'spring' || id === 'summer' || id === 'autumn' || id === 'winter') {
        const prev = phenologyId;
        phenologyId = id;
        if (prev === 'winter' && id !== 'winter' && currentWeatherId === 'snow') {
          currentWeatherId = 'clear';
        }
        updateHud();
      }
    },
    setMaterialBaseColor: setMaterialBaseColor,
    cycleTime: cycleTime,
    cycleWeather: cycleWeather,
    setAuto: function (on) { autoOn = !!on; },
    syncCamera: place,
    // Explicit late roots only; never traverse the scene in update().
    registerMaterials: registerMaterials,
    getTwilightState: function () { return twilight; },
    setLunarDay: setLunarDay,
    getLunarState: function () { return lunarState; },
    getAppearanceState: function () { return appearanceState; },
    getAppearance: function () {
      return {
        timeId: order[timeIndex], weatherId: currentWeatherId,
        phenologyId: phenologyId,
        night: cur.legacyNight,
        desaturation: desaturation.value, unlitScale: cur.unlit,
        skyTop: cur.skyTop.getHexString(), skyBottom: cur.skyBottom.getHexString(),
        fogColor: cur.fog.getHexString()
      };
    },
    // 拆场时把天光交还干净：监听、定时器、几何与程序纹理一起收掉
    dispose: function () {
      window.removeEventListener('keydown', onKeyDown);
      hudTimeRow?.removeEventListener?.('click', onTimeRowClick);
      hudWeatherRow?.removeEventListener?.('click', onWeatherRowClick);
      clearTimeout(toastTimer);
      document.body.classList.remove('is-night');
      scene.remove(dome);
      dome.geometry.dispose();
      domeMat.dispose();
      scene.remove(stars);
      starGeo.dispose();
      starMat.dispose();
      scene.remove(sunSprite);
      daySunTexture.dispose();
      twilightSunTexture.dispose();
      sunMat.dispose();
      scene.remove(moonSprite);
      for (const tex of lunarPhaseTexCache.values()) tex.dispose();
      lunarPhaseTexCache.clear();
      moonMat.dispose();
      for (let i = 0; i < appearanceRestorers.length; i++) appearanceRestorers[i]();
      for (const entry of unlit) entry.mat.color.copy(entry.origBase || entry.base);
      for (const entry of hills) entry.mat.color.copy(entry.origBase || entry.base);
      appearanceRestorers.length = 0;
      registered.clear();
      unlit.length = 0;
      hills.length = 0;
    },
    getStats: function () {
      return {
        time: order[timeIndex],
        weather: currentWeatherId,
        snowIntensity: Math.round(wscalar.snow * 100) / 100,
        sunIntensity: Math.round(cur.sunI * 100) / 100,
        fogNear: Math.round(cur.fogNear),
        fogFar: Math.round(cur.fogFar),
        wind: Math.round(wscalar.wind * 100) / 100,
        cloudCover: Math.round(cur.cloudCover * 100) / 100,
        cloudSpeed: Math.round(cur.cloudSpeed * 100) / 100,
        cloudLow: Math.round(cur.cloudLow * 100) / 100
      };
    },
    update: function (dt, cam) {
      clock += dt;
      computeTarget();
      computeScalars();
      approach(dt);
      cloudClock += dt * cur.cloudSpeed * 0.06;
      const ncTid = order[timeIndex];
      const ncBase = ncTid === 'day' ? 1 : (ncTid === 'dawn' || ncTid === 'dusk') ? 0.12 : 0;
      const ncTarget = ncBase * (1 - wscalar.rain * 0.8) * (1 - wscalar.snow * 0.8) * (1 - wscalar.mist * 0.5);
      noonCloudAmt += (ncTarget - noonCloudAmt) * Math.min(1, Math.max(0, dt) * 1.5);
      apply();
      place(cam);
      starMat.uniforms.uTime.value = clock;

      rainColor.copy(cur.fog).lerp(white, 0.62);
      snowColor.copy(cur.fog).lerp(white, 0.78 - cur.legacyNight * 0.42);
      mistColor.copy(cur.fog).lerp(white, 0.42);
      if (weatherFx) {
        weatherState.rain = wscalar.rain;
        weatherState.snow = wscalar.snow;
        weatherState.mist = wscalar.mist;
        weatherState.wind = wscalar.wind;
        weatherState.windX = cfg.wind.dir[0] * wscalar.wind;
        weatherState.windZ = cfg.wind.dir[1] * wscalar.wind;
        weatherState.pixelRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
        weatherFx.update(dt, cam, weatherState);
      }

      sky.windX = cfg.wind.dir[0] * wscalar.wind * cfg.wind.speed;
      sky.windZ = cfg.wind.dir[1] * wscalar.wind * cfg.wind.speed;
      sky.wind = 0.55 + wscalar.wind * cfg.wind.swayGain;

      if (autoOn) {
        autoClock += dt;
        if (autoClock >= cfg.auto.seconds) {
          autoClock = 0;
          cycleTime(1);
        }
      }

      pushAmbience();
      updateHud();

      const night = cur.starOp > 0.45;
      if (night !== lastNight) {
        lastNight = night;
        document.body.classList.toggle('is-night', night);
      }

      // 天气权重向目标靠拢：下一次切换前先让旧天气退干净
      for (let i = 0; i < allWeatherIds.length; i++) {
        const id = allWeatherIds[i];
        const target = id === currentWeatherId ? 1 : 0;
        weight[id] += (target - weight[id]) * Math.min(1, dt / Math.max(cfg.smoothing, 0.001));
      }
    }
  };

  // 首帧之前先落一次初值，避免从黑色渐入
  computeTarget();
  computeScalars();
  copyState(cur, tgt);
  registerMaterials(scene);
  apply();
  place(camera);
  updateHud();

  return sky;
}
