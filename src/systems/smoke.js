import * as THREE from 'three';

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 炊烟：顺风柔弯 S 形袅袅青烟 + 晨昏逆温层平流烟霭 + 四时天光染色。
// 用单次 Points draw call，按 gl_PointCoord 画柔边烟团，初出烟口渐显，至高处散淡化开。
const VERT = [
  'attribute float aSize;',
  'attribute float aAlpha;',
  'attribute float aProgress;',
  'varying float vAlpha;',
  'varying float vProgress;',
  'void main() {',
  '  vAlpha = aAlpha;',
  '  vProgress = aProgress;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  gl_PointSize = aSize * (520.0 / max(0.6, -mv.z));',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');

const FRAG = [
  'uniform vec3 uColor;',
  'varying float vAlpha;',
  'varying float vProgress;',
  'void main() {',
  '  float d = length(gl_PointCoord - vec2(0.5));',
  '  float a = smoothstep(0.5, 0.08, d) * smoothstep(0.0, 0.18, vProgress) * vAlpha;',
  '  if (a < 0.003) discard;',
  '  gl_FragColor = vec4(uColor, a);',
  '  #include <colorspace_fragment>',
  '}'
].join('\n');

export function createSmoke(cfg = {}, chimneys = []) {
  const rand = lcg(7717);
  const per = cfg.perChimney || 12;
  const lifeRange = cfg.life || [4.2, 6.2];
  const n = chimneys.length * per;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const alpha = new Float32Array(n);
  const progress = new Float32Array(n);
  const puffs = [];

  for (let i = 0; i < chimneys.length; i++) {
    const c = chimneys[i];
    for (let k = 0; k < per; k++) {
      const p = {
        cx: c.x,
        cy: c.y,
        cz: c.z,
        life: lifeRange[0] + rand() * (lifeRange[1] - lifeRange[0]),
        t: rand() * 1,
        drift: (rand() - 0.5) * 0.5,
        wob: rand() * 6.283
      };
      p.t = rand();
      puffs.push(p);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const cDay = new THREE.Color('#EDE8DC');
  const cRain = new THREE.Color('#BEC8CE');
  const cDawn = new THREE.Color('#D6DEE6');
  const cDusk = new THREE.Color('#DEC3AC');
  const cNight = new THREE.Color('#3B4C61');
  const cTmp = new THREE.Color(cfg.color || '#EDE8DC');

  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: cTmp.clone() } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false
  });

  const points = new THREE.Points(geo, mat);
  points.name = 'smoke';
  points.frustumCulled = false;

  const riseTo = cfg.rise || 4.2;
  const spread = cfg.spread || 0.55;
  let curRain = 0;
  let curMist = 0;
  let curWindX = 0;
  let curWindZ = 0;
  let curRiseScale = 1;
  let curInversion = 0;
  let curTimeId = 'day';
  let simElapsed = 0;

  function setWeather(sky) {
    if (!sky) return;
    // Production sky exposes both IDs: avoid allocating a debug hex snapshot.
    // Incomplete custom providers still borrow the legacy snapshot, including
    // its independent mist fallback even when direct weather is nonmist.
    const directTime = sky.timeId;
    const directWeather = sky.weatherId;
    const app = (!directTime || !directWeather) && typeof sky.getAppearance === 'function'
      ? sky.getAppearance() : null;
    curRain = Math.max(0, Math.min(1, Number(sky.rainIntensity) || 0));
    curWindX = Number(sky.windX) || 0;
    curWindZ = Number(sky.windZ) || 0;
    curTimeId = directTime || app?.timeId || 'day';
    const rawMist = Number(sky.mist);
    curMist = Number.isFinite(rawMist) && rawMist > 0
      ? Math.min(1, rawMist)
      : (directWeather === 'mist' || app?.weatherId === 'mist' ? 1 : 0);

    const windMag = Math.hypot(curWindX, curWindZ);
    // 雨起风急时炊烟被压低贴着屋脊散开，同时顺风斜飘
    curRiseScale = Math.max(0.28, 1 - curRain * 0.58 - Math.min(0.22, windMag * 0.14));

    // 晨昏逆温层（「暧暧远人村，依依墟里烟」）：无大雨时烟柱升至屋脊上方柔缓折为平流烟带
    if ((curTimeId === 'dawn' || curTimeId === 'dusk') && curRain < 0.35) {
      curInversion = 0.42 * (1 - (curRain / 0.35) * 0.5);
    } else if (curMist > 0 && curRain < 0.35) {
      curInversion = 0.20 * curMist;
    } else {
      curInversion = 0;
    }

    if (curTimeId === 'night') {
      cTmp.copy(cNight);
    } else if (curTimeId === 'dawn') {
      cTmp.copy(cDawn).lerp(cRain, curRain * 0.35);
    } else if (curTimeId === 'dusk') {
      cTmp.copy(cDusk).lerp(cRain, curRain * 0.38);
    } else {
      cTmp.copy(cDay).lerp(cRain, curRain * 0.45);
    }
    mat.uniforms.uColor.value.copy(cTmp);
  }

  function writePuffGeometry() {
    const effRise = riseTo * curRiseScale;
    const effSpread = spread * (1 + curRain * 0.65 + curInversion * 0.25);
    const windMag = Math.hypot(curWindX, curWindZ);
    // 无风静日亦给一缕微风轻偏，避免炊烟僵直如柱
    const calmBlend = windMag < 0.05 ? 1 : Math.max(0, 1 - (windMag - 0.05) / 0.06);
    const effWx = curWindX * (1 - calmBlend) + 0.28 * calmBlend;
    const effWz = curWindZ * (1 - calmBlend) + 0.12 * calmBlend;
    const effMag = Math.hypot(effWx, effWz) || 1;
    const dirX = effWx / effMag;
    const dirZ = effWz / effMag;
    const perpX = -dirZ;
    const perpZ = dirX;
    const windPush = (1.65 + curRain * 1.45) * (1 + curInversion * 0.62 + curMist * 0.18);
    const baseScale = cfg.scale || 1;
    const baseOpacity = (cfg.opacity || 0.5) * 0.72;
    const nightAlphaScale = curTimeId === 'night' ? 0.48 : 1.0;

    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      const u = p.t;
      const uRise = u - curInversion * u * u * 0.52;
      const downwind = Math.pow(u, 1.55) * windPush * effMag;
      const uSwayEnv = Math.pow(u, 0.85);
      const crossWave = Math.sin(simElapsed * 0.75 + p.wob + u * 2.6) * effSpread * uSwayEnv;
      const alongWave = Math.cos(simElapsed * 0.58 + p.wob * 1.27 + u * 1.9) * effSpread * 0.30 * u;
      const latDrift = p.drift * u * u * 2.4;

      pos[i * 3] = p.cx + dirX * (downwind + alongWave) + perpX * (crossWave + latDrift);
      pos[i * 3 + 1] = p.cy + uRise * effRise;
      pos[i * 3 + 2] = p.cz + dirZ * (downwind + alongWave) + perpZ * (crossWave + latDrift);

      // 上来先细后粗，晨昏逆温层横向舒展成柔霭带
      size[i] = (0.26 + u * (1.52 + curInversion * 0.45)) * baseScale * (1 + curRain * 0.25 + curMist * 0.12);
      progress[i] = u;
      alpha[i] = (1 - u) * (1 - u) * baseOpacity * nightAlphaScale;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aProgress.needsUpdate = true;
  }

  writePuffGeometry();

  function update(dt, _elapsed) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    simElapsed += Math.min(dt, 0.25);
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      p.t += dt / p.life;
      if (p.t >= 1) {
        p.t %= 1;
        p.life = lifeRange[0] + rand() * (lifeRange[1] - lifeRange[0]);
        p.wob = rand() * 6.283;
        p.drift = (rand() - 0.5) * 0.5;
      }
    }
    writePuffGeometry();
  }

  function getStats() {
    return {
      count: puffs.length,
      riseScale: curRiseScale,
      effectiveRise: riseTo * curRiseScale,
      inversion: curInversion,
      timeId: curTimeId,
      curRain,
      windX: curWindX,
      windZ: curWindZ
    };
  }

  return { points, update, setWeather, getStats, count: puffs.length };
}
