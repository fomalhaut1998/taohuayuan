import * as THREE from 'three';
import phenologySeasons from '../data/phenology-seasons.json' with { type: 'json' };

// 雨、雪与雾：雨是一束参数化斜线（单次 draw call），雪是水墨团絮与细晶双阶飘雪（单次 Points draw call），
// 雾是几张程序化软片。强弱每帧由 sky.js 合成后喂进来，这里不持有时刻与天气状态。

const RAIN_VERT = `
uniform float uTime;
uniform vec3 uCenter;
uniform float uWidth;
uniform float uHeight;
uniform float uFall;
uniform float uLength;
uniform vec2 uSlant;
attribute vec3 aSeed;
attribute float aTail;
attribute float aSpeed;
varying float vFade;
void main() {
  float y = fract(aSeed.y - uTime * uFall * aSpeed / uHeight);
  vec3 p;
  p.x = uCenter.x + (aSeed.x - 0.5) * uWidth + y * uHeight * uSlant.x;
  p.z = uCenter.z + (aSeed.z - 0.5) * uWidth + y * uHeight * uSlant.y;
  p.y = uCenter.y - uHeight * 0.22 + y * uHeight;
  p += aTail * vec3(uSlant.x, 1.0, uSlant.y) * uLength;
  float d = length(p.xz - uCenter.xz);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // 贴着镜头的那几滴会拉成白道子，近处淡出；外圈也淡出，雨幕才是个圆
  float nearFade = smoothstep(0.9, 3.6, -mv.z);
  vFade = (1.0 - smoothstep(uWidth * 0.26, uWidth * 0.5, d)) * nearFade;
  gl_Position = projectionMatrix * mv;
}
`;

const RAIN_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
  #include <colorspace_fragment>
}
`;

const SNOW_VERT = `
uniform float uTime;
uniform vec3 uCenter;
uniform float uWidth;
uniform float uHeight;
uniform float uFall;
uniform float uSway;
uniform float uPixel;
uniform vec2 uWind;
attribute vec3 aSeed;
attribute vec3 aTrait;
varying float vFade;
varying float vPhase;
void main() {
  float speedMul = aTrait.x;
  float flakeSize = aTrait.y;
  float ph = aTrait.z;
  vPhase = ph;

  float y = fract(aSeed.y - uTime * uFall * speedMul / uHeight);
  float fallSpan = (1.0 - y) * uHeight;

  // 团雪与碎玉各有螺旋轻飏轨迹，顺微风斜拂并在柱状视域内无缝回卷
  float flutterX = sin(uTime * (1.08 + speedMul * 0.52) + ph) * uSway
                 + cos(uTime * 0.61 + ph * 1.73) * (uSway * 0.46);
  float flutterZ = cos(uTime * (0.96 + speedMul * 0.46) + ph * 1.31) * uSway
                 + sin(uTime * 0.54 - ph * 0.89) * (uSway * 0.46);

  float rawX = (aSeed.x - 0.5) * uWidth + flutterX + fallSpan * uWind.x * 0.26;
  float rawZ = (aSeed.z - 0.5) * uWidth + flutterZ + fallSpan * uWind.y * 0.26;

  vec3 p;
  p.x = uCenter.x + mod(rawX + uWidth * 0.5, uWidth) - uWidth * 0.5;
  p.z = uCenter.z + mod(rawZ + uWidth * 0.5, uWidth) - uWidth * 0.5;
  p.y = uCenter.y - uHeight * 0.24 + y * uHeight;

  float d = length(p.xz - uCenter.xz);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float nearFade = smoothstep(0.85, 3.4, -mv.z);
  vFade = (1.0 - smoothstep(uWidth * 0.28, uWidth * 0.5, d)) * nearFade;

  gl_PointSize = clamp(flakeSize * uPixel * (175.0 / max(-mv.z, 1.2)), 1.2, 24.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SNOW_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
varying float vPhase;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q);
  if (r > 0.5) discard;
  float ang = atan(q.y, q.x);
  // 宣纸水墨团雪点染：微带六出冰花瓣意而边缘柔化无锯齿
  float crystal = 0.90 + 0.10 * cos(ang * 6.0 + vPhase);
  float soft = smoothstep(0.5 * crystal, 0.07, r);
  float alpha = soft * uOpacity * vFade;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
}
`;

const SNOW_DEFAULTS = {
  count: 2600,
  width: 44,
  height: 24,
  fallSpeed: 2.35,
  swayAmp: 0.95,
  sizeRange: [2.2, 6.4],
  opacity: 0.86,
  color: '#F7F6F0'
};

function makeSeeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 一张不规则的雾片：几团错开的软圆严格收在画布内圈，四边像素 alpha 恒为 0，杜绝矩形硬边
function mistTexture(size) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const blobs = [
    [0.50, 0.50, 0.43],
    [0.35, 0.48, 0.25],
    [0.65, 0.52, 0.25],
    [0.46, 0.36, 0.21],
    [0.56, 0.64, 0.21]
  ];
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const g = ctx.createRadialGradient(b[0] * size, b[1] * size, 0, b[0] * size, b[1] * size, b[2] * size);
    g.addColorStop(0, 'rgba(255,255,255,0.30)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.11)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRain(cfg) {
  const count = cfg.count;
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2 * 3);
  const tail = new Float32Array(count * 2);
  const speed = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const sx = Math.random();
    const sy = Math.random();
    const sz = Math.random();
    const sp = 0.78 + Math.random() * 0.44;
    for (let v = 0; v < 2; v++) {
      const at = i * 2 + v;
      seed[at * 3] = sx;
      seed[at * 3 + 1] = sy;
      seed[at * 3 + 2] = sz;
      tail[at] = v;
      speed[at] = sp;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 3));
  geo.setAttribute('aTail', new THREE.Float32BufferAttribute(tail, 1));
  geo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speed, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uWidth: { value: cfg.width },
      uHeight: { value: cfg.height },
      uFall: { value: cfg.fallSpeed },
      uLength: { value: cfg.length },
      uSlant: { value: new THREE.Vector2(0, 0) },
      uColor: { value: new THREE.Color(cfg.color) },
      uOpacity: { value: 0 }
    },
    vertexShader: RAIN_VERT,
    fragmentShader: RAIN_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false
  });

  const mesh = new THREE.LineSegments(geo, mat);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

function createSnow(cfg) {
  const count = cfg.count;
  const rnd = makeSeeded(20261207);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 3);
  const trait = new Float32Array(count * 3);
  const sMin = cfg.sizeRange?.[0] ?? 2.2;
  const sMax = cfg.sizeRange?.[1] ?? 6.4;

  for (let i = 0; i < count; i++) {
    seed[i * 3] = rnd();
    seed[i * 3 + 1] = rnd();
    seed[i * 3 + 2] = rnd();
    // 细雪为主、偶夹鹅毛团雪：大雪片下坠略缓、轻盈摇曳
    const sizeCurve = Math.pow(rnd(), 1.55);
    const sz = sMin + sizeCurve * (sMax - sMin);
    const sp = (0.64 + rnd() * 0.68) * (1.08 - sizeCurve * 0.22);
    trait[i * 3] = sp;
    trait[i * 3 + 1] = sz;
    trait[i * 3 + 2] = rnd() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 3));
  geo.setAttribute('aTrait', new THREE.Float32BufferAttribute(trait, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uWidth: { value: cfg.width },
      uHeight: { value: cfg.height },
      uFall: { value: cfg.fallSpeed },
      uSway: { value: cfg.swayAmp ?? 0.95 },
      uPixel: { value: 1 },
      uWind: { value: new THREE.Vector2(0, 0) },
      uColor: { value: new THREE.Color(cfg.color || '#F7F6F0') },
      uOpacity: { value: 0 }
    },
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false
  });
  mat.userData.skyIgnore = true;

  const points = new THREE.Points(geo, mat);
  points.name = 'weather-snow';
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 4;
  return points;
}

function createMist(cfg, scene) {
  const tex = mistTexture(128);
  const puffs = [];
  for (let i = 0; i < cfg.count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      fog: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.frustumCulled = false;
    sprite.renderOrder = 4;
    sprite.visible = false;
    scene.add(sprite);
    const size = cfg.sizeRange[0] + Math.random() * (cfg.sizeRange[1] - cfg.sizeRange[0]);
    sprite.scale.set(size, size * 0.28, 1);
    puffs.push({
      sprite: sprite,
      mat: mat,
      angle: Math.random() * Math.PI * 2,
      dist: cfg.distRange[0] + Math.random() * (cfg.distRange[1] - cfg.distRange[0]),
      height: cfg.heightRange[0] + Math.random() * (cfg.heightRange[1] - cfg.heightRange[0]),
      phase: Math.random() * Math.PI * 2,
      spin: 0.6 + Math.random() * 0.8,
      size: size
    });
  }
  return { puffs: puffs, tex: tex };
}

export function createWeather(cfg, scene) {
  const snowCfg = { ...SNOW_DEFAULTS, ...(phenologySeasons.snowParticles || {}), ...(cfg.snow || {}) };
  const rain = createRain(cfg.rain);
  scene.add(rain);
  const snow = createSnow(snowCfg);
  scene.add(snow);
  const mist = createMist(cfg.mist, scene);
  const puffs = mist.puffs;
  const fallbackSnowColor = new THREE.Color(snowCfg.color || '#F7F6F0');
  let elapsed = 0;

  function update(dt, camera, grade) {
    if (Number.isFinite(dt) && dt > 0) {
      elapsed += dt;
    }

    const raining = grade.rain > 0.015;
    rain.visible = raining;
    if (raining) {
      const u = rain.material.uniforms;
      u.uTime.value = elapsed;
      u.uCenter.value.copy(camera.position);
      u.uSlant.value.set(grade.windX * 0.35, grade.windZ * 0.35);
      u.uColor.value.copy(grade.rainColor);
      u.uOpacity.value = cfg.rain.opacity * grade.rain;
    }

    const snowAmt = Number(grade.snow) || 0;
    const snowing = snowAmt > 0.012;
    snow.visible = snowing;
    if (snowing) {
      const u = snow.material.uniforms;
      u.uTime.value = elapsed;
      u.uCenter.value.copy(camera.position);
      u.uWind.value.set(grade.windX || 0, grade.windZ || 0);
      u.uColor.value.copy(grade.snowColor || fallbackSnowColor);
      u.uOpacity.value = snowCfg.opacity * snowAmt;
      if (Number.isFinite(grade.pixelRatio) && grade.pixelRatio > 0) {
        u.uPixel.value = grade.pixelRatio;
      }
    }

    const misting = grade.mist > 0.01;
    const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const drift = 0.02 + grade.wind * 0.16;
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      p.sprite.visible = misting;
      if (!misting) continue;
      p.angle += stepDt * drift * p.spin;
      // 推向中远景高空林冠之上，避免近景大尺寸 Sprite 斜切地面草坡形成亮白多边形
      const d = Math.max(36, p.dist + 20) + Math.sin(elapsed * 0.13 + p.phase) * 4.5;
      const halfH = p.size * 0.14;
      const y = camera.position.y + Math.max(4.5, p.height + 4.5) + halfH + Math.sin(elapsed * 0.21 + p.phase) * 0.45;
      p.sprite.position.set(
        camera.position.x + Math.cos(p.angle) * d,
        y,
        camera.position.z + Math.sin(p.angle) * d
      );
      const pulse = 0.4 + 0.6 * Math.sin(elapsed * 0.17 + p.phase) * Math.sin(elapsed * 0.17 + p.phase);
      p.mat.opacity = cfg.mist.opacity * 0.52 * grade.mist * (0.35 + 0.65 * pulse);
      if (scene?.fog?.color) {
        p.mat.color.copy(scene.fog.color).lerp(grade.mistColor, 0.25);
      } else {
        p.mat.color.copy(grade.mistColor);
      }
      p.mat.rotation = Math.sin(elapsed * 0.05 + p.phase) * 0.06;
    }
  }

  return {
    update: update,
    rainCount: cfg.rain.count,
    snowCount: snowCfg.count,
    mistCount: cfg.mist.count,
    getStats: function () {
      return {
        rainVisible: rain.visible,
        snowVisible: snow.visible,
        snowOpacity: +snow.material.uniforms.uOpacity.value.toFixed(3),
        snowCount: snowCfg.count,
        elapsed: +elapsed.toFixed(3)
      };
    },
    // 雨、雪与雾的几何、着色器与程序化雾图一并释放
    dispose: function () {
      scene.remove(rain);
      rain.geometry.dispose();
      rain.material.dispose();
      scene.remove(snow);
      snow.geometry.dispose();
      snow.material.dispose();
      for (let i = 0; i < puffs.length; i++) {
        scene.remove(puffs[i].sprite);
        puffs[i].mat.dispose();
      }
      mist.tex.dispose();
      puffs.length = 0;
    }
  };
}
