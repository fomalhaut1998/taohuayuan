import * as THREE from 'three';
import { sampleBankPatch } from './riverbank.js';
import { chainProgramCacheKey } from '../systems/shader-cache-key.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 一丛水岸莎草/芦荻：叶宽沿切线展开，径向自然外拱垂尖，底暗湿泥色渐变为日照亮尖
function clumpGeometry(blades, segments) {
  const positions = [];
  const colors = [];
  const indices = [];
  let base = 0;

  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2 + 0.35 * b;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const tx = -sa;
    const tz = ca;
    const ox = ca * 0.11;
    const oz = sa * 0.11;
    const lean = 0.16 + 0.13 * ((b * 1.7) % 3);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const w = i === segments
        ? 0.004
        : 0.30 * Math.pow(1 - t, 0.82) * (0.38 + 0.62 * Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5));
      const bend = lean * 1.5 * Math.pow(t, 1.7);
      const y = t - 0.30 * t * t * t;
      const x0 = -w;
      const x1 = w;
      positions.push(ox + ca * bend + tx * x0, y, oz + sa * bend + tz * x0);
      positions.push(ox + ca * bend + tx * x1, y, oz + sa * bend + tz * x1);
      const ct = Math.pow(t, 0.88);
      const cr = 0.48 + (1.08 - 0.48) * ct;
      const cg = 0.50 + (1.08 - 0.50) * ct;
      const cb = 0.42 + (1.00 - 0.42) * ct;
      colors.push(cr, cg, cb, cr, cg, cb);
    }

    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    base += (segments + 1) * 2;
  }

  // 秋候芦花：两根叶尖各一枚交叉小穗 quad，靠 aPlume 标记在片元里换色
  const plumeFlags = new Array(positions.length / 3).fill(0);
  for (const b of [0, 2]) {
    const ang = (b / blades) * Math.PI * 2 + 0.35 * b;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const tx = -sa, tz = ca;
    const lean = 0.16 + 0.13 * ((b * 1.7) % 3);
    const bend = lean * 1.5;
    const cx = ca * 0.11 + ca * bend, cz = sa * 0.11 + sa * bend;
    const y0 = 0.70, y1 = 0.88;
    const base = positions.length / 3;
    for (const [sx, sy] of [[-0.035, y0], [0.035, y0], [0.02, y1], [-0.02, y1]]) {
      positions.push(cx + tx * sx, sy, cz + tz * sx);
      colors.push(1, 1, 1);
      plumeFlags.push(1);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    for (const [sx, sy] of [[-0.035, y0], [0.035, y0], [0.02, y1], [-0.02, y1]]) {
      positions.push(cx + ca * sx, sy, cz + sa * sx);
      colors.push(1, 1, 1);
      plumeFlags.push(1);
    }
    const b2 = base + 4;
    indices.push(b2, b2 + 1, b2 + 2, b2, b2 + 2, b2 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aPlume', new THREE.Float32BufferAttribute(plumeFlags, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// 水边野草：只长在河岸水位线附近
export function createReeds(cfg, field, curve, terrainCfg) {
  const rand = mulberry32(cfg.seed || 31415);
  const spots = [];
  const maxTries = cfg.count * 40;
  const patches = cfg.patches ?? terrainCfg.shoreline?.patches ?? 0;
  const low = terrainCfg.waterLevel - 0.6;
  const high = terrainCfg.waterLevel + (cfg.bandHeight || 1.9);

  let tries = 0;
  while (spots.length < cfg.count && tries < maxTries) {
    tries++;
    let px, pz;
    if (patches > 0 && rand() < 0.84) {
      const patch = sampleBankPatch(curve, rand, patches);
      const off = cfg.offsetInner + (0.25 + rand() * 0.5) * (cfg.offsetOuter - cfg.offsetInner);
      px = patch.x + patch.nx * off;
      pz = patch.z + patch.nz * off;
    } else {
      const t = rand();
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const nl = Math.hypot(tan.x, tan.z) || 1;
      const side = rand() < 0.5 ? -1 : 1;
      const off = cfg.offsetInner + rand() * (cfg.offsetOuter - cfg.offsetInner);
      px = p.x + (tan.z / nl) * off * side;
      pz = p.z - (tan.x / nl) * off * side;
    }

    const h = field.sample(px, pz);
    if (h < low || h > high) continue;
    spots.push([px, h, pz]);
  }

  const n = spots.length;
  const blades = Math.max(5, cfg.bladesPerClump || 5);
  const segments = Math.max(5, cfg.segmentsPerBlade || 5);
  const geo = clumpGeometry(blades, segments);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: true });

  // 风：整丛双向微摆，靠实例位置的相位错开
  const sway = { value: 0 };
  const swayAmp = { value: 1 };
  const plume = { value: 0 };
  const plumeColor = { value: new THREE.Color('#D9C9A6') };
  let plumeTarget = 0;
  let lastElapsed = null;
  const swayK = (cfg.sway || 0.22).toFixed(3);
  mat.onBeforeCompile = function (shader) {
    shader.uniforms.uSway = sway;
    shader.uniforms.uSwayAmp = swayAmp;
    shader.uniforms.uPlume = plume;
    shader.uniforms.uPlumeColor = plumeColor;
    shader.vertexShader = 'uniform float uSway;\nuniform float uSwayAmp;\nattribute float aPlume;\nvarying float vPlume;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlume = aPlume;');
    shader.fragmentShader = 'uniform float uPlume;\nuniform vec3 uPlumeColor;\nvarying float vPlume;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uPlumeColor, vPlume * uPlume);');
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' +
        'float phase = instanceMatrix[3].x * 0.55 + instanceMatrix[3].z * 0.43;\n' +
        'float reedFlex = ' + swayK + ' * uSwayAmp * position.y * position.y;\n' +
        'transformed.x += sin(uSway * 1.3 + phase) * reedFlex;\n' +
        'transformed.z += cos(uSway * 1.08 + phase * 1.17) * reedFlex * 0.55;'
    );
    mat.userData.shader = shader;
  };
  chainProgramCacheKey(mat, 'river-reeds-sway-v3');

  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = 'reeds';

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const a = new THREE.Color(cfg.colorA);
  const b = new THREE.Color(cfg.colorB);
  const dry = new THREE.Color(cfg.dryColor);
  const hasColorAt = typeof field?.colorAt === 'function';

  for (let i = 0; i < n; i++) {
    const s = spots[i];
    const w = cfg.widthRange[0] + rand() * (cfg.widthRange[1] - cfg.widthRange[0]);
    const hgt = cfg.heightRange[0] + rand() * (cfg.heightRange[1] - cfg.heightRange[0]);
    dummy.position.set(s[0], s[1] - 0.03, s[2]);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(w, hgt, w);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    color.copy(a).lerp(b, rand());
    if (rand() < (cfg.dryRatio || 0.15)) color.lerp(dry, 0.45 + rand() * 0.4);
    if (hasColorAt) {
      const gc = field.colorAt(s[0], s[2]);
      if (gc) color.lerp(gc, 0.28);
    }
    mesh.setColorAt(i, color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();

  const group = new THREE.Group();
  group.name = 'reeds-group';
  group.add(mesh);

  return {
    group: group,
    count: n,
    update: function (elapsed, wind, autumn) {
      if (Number.isFinite(elapsed)) sway.value = elapsed;
      if (wind === undefined) swayAmp.value = 1;
      else if (Number.isFinite(wind)) swayAmp.value = wind;
      plumeTarget = autumn === 1 ? 1 : 0;
      if (Number.isFinite(elapsed)) {
        const dt = lastElapsed === null ? 0 : Math.max(0, elapsed - lastElapsed);
        lastElapsed = elapsed;
        plume.value += (plumeTarget - plume.value) * Math.min(1, dt * 0.8);
      }
    }
  };
}
