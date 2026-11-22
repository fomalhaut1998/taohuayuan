import * as THREE from 'three';
import eggsCfg from '../data/wilds-easter-eggs.json' with { type: 'json' };
import { habitatSurface } from './habitat-details.js';
import { createRigidBatchMesh } from './qin-han-fauna-geometry.js';
import { createVertexColorBaker } from './valley-borderlands-geometry.js';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

const HALO_VERT = /* glsl */`
varying vec2 vLocal;
varying vec3 vColor;

void main() {
  vLocal = position.xy;
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(0.92, 0.96, 0.72);
  #endif
  #ifdef USE_INSTANCING
    vec3 worldCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float radius = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  #else
    vec3 worldCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float radius = 1.0;
  #endif
  vec4 mvCenter = viewMatrix * vec4(worldCenter, 1.0);
  mvCenter.z += min(0.14, radius * 0.18);
  mvCenter.xy += position.xy * radius;
  gl_Position = projectionMatrix * mvCenter;
}
`;

const HALO_FRAG = /* glsl */`
uniform float uOpacity;
varying vec2 vLocal;
varying vec3 vColor;

void main() {
  float r2 = dot(vLocal, vLocal);
  if (r2 >= 1.0) discard;
  float core = exp(-7.4 * r2) * 0.56;
  float aura = exp(-2.9 * r2) * pow(1.0 - r2, 2.4) * 0.50;
  float intensity = (core + aura) * uOpacity;
  if (intensity < 0.002) discard;
  gl_FragColor = vec4(vColor * intensity, 1.0);
}
`;

function bakeUnit(fn) {
  const b = createVertexColorBaker();
  fn(b);
  const tmpMat = new THREE.MeshBasicMaterial();
  const mesh = b.buildMesh('u', tmpMat, 'u');
  tmpMat.dispose();
  if (mesh) return mesh.geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
  return g;
}

function addLeafCanopy(baker, key, cx, cy, cz, rx, ry, rz, sides, hexTop, hexMid, hexBot, phase = 0) {
  const eq = [];
  const hi = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * TAU;
    const lobe = i % 2 === 0 ? 1.05 : 0.85;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    eq.push([cx + ca * rx * lobe, cy - ry * 0.12 + (i % 2) * ry * 0.07, cz + sa * rz * lobe]);
    hi.push([cx + ca * rx * lobe * 0.62, cy + ry * 0.56 + ((i + 1) % 2) * ry * 0.06, cz + sa * rz * lobe * 0.62]);
  }
  const apex = [cx, cy + ry * 0.92, cz];
  const under = [cx, cy - ry * 0.52, cz];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    baker.addQuad(key, eq[j], eq[i], hi[i], hi[j], hexMid, 0.01);
    baker.addTri(key, apex[0], apex[1], apex[2], hi[j][0], hi[j][1], hi[j][2], hi[i][0], hi[i][1], hi[i][2], hexTop, 0.04);
    baker.addTri(key, under[0], under[1], under[2], eq[i][0], eq[i][1], eq[i][2], eq[j][0], eq[j][1], eq[j][2], hexBot, -0.04);
  }
}

function addDiamond(b, key, cx, cy, cz, rx, ry, rz, hexTop, hexBot) {
  const top = [cx, cy + ry, cz];
  const bot = [cx, cy - ry, cz];
  const ring = [
    [cx + rx, cy, cz],
    [cx, cy, cz + rz],
    [cx - rx, cy, cz],
    [cx, cy, cz - rz]
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    b.addTri(key, top[0], top[1], top[2], ring[j][0], ring[j][1], ring[j][2], ring[i][0], ring[i][1], ring[i][2], hexTop, 0.05);
    b.addTri(key, bot[0], bot[1], bot[2], ring[i][0], ring[i][1], ring[i][2], ring[j][0], ring[j][1], ring[j][2], hexBot || hexTop, -0.04);
  }
}

function buildCraneBodyGeo(pal, scale = 1.0) {
  return bakeUnit((b) => {
    const s = scale;
    // Plump teardrop torso
    b.addBeam('u', [0, 0, -0.22 * s], [0, 0.06 * s, 0.18 * s], 0.085 * s, 0.115 * s, 6, pal.craneCream, pal.craneWhite, true);
    b.addBeam('u', [0, 0.06 * s, 0.16 * s], [0, 0.10 * s, 0.25 * s], 0.105 * s, 0.052 * s, 6, pal.craneWhite, pal.craneWhite, true);
    // Black tertial tail plumage
    b.addBeam('u', [0, 0.02 * s, -0.20 * s], [0, 0.09 * s, -0.39 * s], 0.075 * s, 0.024 * s, 5, pal.craneInk, pal.craneInk, true);
    // Graceful S-curved neck
    b.addBeam('u', [0, 0.08 * s, 0.20 * s], [0, 0.34 * s, 0.28 * s], 0.040 * s, 0.030 * s, 5, pal.craneWhite, pal.craneWhite, false);
    b.addBeam('u', [0, 0.33 * s, 0.28 * s], [0, 0.50 * s, 0.24 * s], 0.029 * s, 0.026 * s, 5, pal.craneWhite, pal.craneWhite, false);
    // Head + iconic crimson crown + pointed ochre beak
    addDiamond(b, 'u', 0, 0.53 * s, 0.26 * s, 0.042 * s, 0.042 * s, 0.056 * s, pal.craneWhite, pal.craneCream);
    addDiamond(b, 'u', 0, 0.568 * s, 0.255 * s, 0.026 * s, 0.018 * s, 0.030 * s, pal.craneCrown, pal.craneCrown);
    b.addBeam('u', [0, 0.525 * s, 0.30 * s], [0, 0.515 * s, 0.45 * s], 0.015 * s, 0.004 * s, 4, '#D6AE5A', '#9E7D3D', true);
    // Tucked slim legs resting on nest rim
    b.addBeam('u', [-0.045 * s, -0.05 * s, 0], [-0.045 * s, -0.17 * s, 0], 0.013 * s, 0.011 * s, 4, '#3A342F', '#3A342F', false);
    b.addBeam('u', [0.045 * s, -0.05 * s, 0], [0.045 * s, -0.17 * s, 0], 0.013 * s, 0.011 * s, 4, '#3A342F', '#3A342F', false);
  });
}

function buildCraneWingGeo(pal, side = 1, scale = 1.0) {
  return bakeUnit((b) => {
    const s = scale * side;
    const sz = scale;
    const p0 = [0, 0.02 * sz, 0.14 * sz];
    const p1 = [0.34 * s, 0.07 * sz, 0.04 * sz];
    const p2 = [0.56 * s, 0.04 * sz, -0.18 * sz];
    const p3 = [0.16 * s, 0.01 * sz, -0.26 * sz];
    const p4 = [0, 0.0, -0.16 * sz];
    b.addQuad('u', p0, p1, p3, p4, pal.craneWhite, 0.04);
    b.addQuad('u', p4, p3, p1, p0, pal.craneCream, -0.04);
    // Primary flight tips (ink-black edge)
    b.addTri('u', p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], pal.craneInk, 0.02);
    b.addTri('u', p3[0], p3[1], p3[2], p2[0], p2[1], p2[2], p1[0], p1[1], p1[2], pal.craneInk, -0.03);
  });
}

function buildFeatherGeo(pal) {
  return bakeUnit((b) => {
    b.addQuad('u', [-0.024, 0, -0.075], [0.024, 0, -0.075], [0.018, 0.008, 0.075], [-0.018, 0.008, 0.075], pal.craneWhite, 0.05);
    b.addQuad('u', [-0.018, 0.008, 0.075], [0.018, 0.008, 0.075], [0.024, 0, -0.075], [-0.024, 0, -0.075], pal.craneCream, -0.03);
    b.addBeam('u', [0, 0.004, -0.085], [0, 0.004, 0.085], 0.004, 0.002, 4, pal.craneCream, pal.craneWhite, false);
  });
}

function buildRingGeo(rInner, rOuter, height, hex) {
  return bakeUnit((b) => {
    b.addHollowCylinder('u', 0, 0, 0, rOuter, rInner, height, 14, 0, hex, hex);
  });
}

function buildLilyLeafGeo() {
  return bakeUnit((b) => {
    const sides = 8;
    const rx = 0.22;
    const rz = 0.20;
    const c = [0, 0.01, 0];
    for (let i = 0; i < sides - 1; i++) {
      const a0 = 0.25 + (i / sides) * TAU;
      const a1 = 0.25 + ((i + 1) / sides) * TAU;
      b.addTri('u', c[0], c[1], c[2], Math.cos(a1) * rx, 0, Math.sin(a1) * rz, Math.cos(a0) * rx, 0, Math.sin(a0) * rz, '#69945E', 0.03);
    }
    addDiamond(b, 'u', 0.04, 0.042, 0.02, 0.042, 0.032, 0.042, '#F2C7CE', '#E2A6B1');
  });
}

function buildCeladonCupGeo(pal) {
  return bakeUnit((b) => {
    // Stemmed flared celadon lotus cup
    b.addCylinder('u', 0, 0.035, 0, 0.045, 0.068, 0.07, 8, 0, pal.celadon, '#7FA59A');
    b.addCylinder('u', 0, 0.13, 0, 0.138, 0.052, 0.125, 10, 0, pal.celadonRim, pal.celadon);
    b.addHollowCylinder('u', 0, 0.195, 0, 0.145, 0.118, 0.032, 10, 0, pal.celadonRim, pal.celadon);
    // Subtle dark tea reflection pool inside cup
    b.addCylinder('u', 0, 0.185, 0, 0.116, 0.114, 0.01, 10, 0, '#5E7C6D', '#4A6357');
  });
}

function buildBambooChimeGeo(len, r, pal, withPlaque = false) {
  return bakeUnit((b) => {
    // Pivot at top hanging cord: tube hangs downward from 0 to -len
    b.addBeam('u', [0, 0.04, 0], [0, -0.05, 0], 0.008, 0.008, 4, pal.sealRed, pal.sealRed, false);
    b.addBeam('u', [0, -0.05, 0], [0, -len, 0], r, r * 1.05, 6, pal.bambooLight, pal.bambooMid, true);
    // Bamboo node ridge ring
    b.addCylinder('u', 0, -len * 0.48, 0, r * 1.18, r * 1.18, 0.026, 6, 0, '#96AF74', pal.bambooMid);
    if (withPlaque) {
      // Wind-catcher wooden plaque tied under the center chime tube
      b.addBeam('u', [0, -len, 0], [0, -len - 0.10, 0], 0.006, 0.006, 4, pal.sealRed, pal.sealRed, false);
      b.addBox('u', 0, -len - 0.19, 0, 0.095, 0.18, 0.014, 0, '#D4BE92', '#B79C6D');
      b.addBox('u', 0, -len - 0.19, 0.008, 0.014, 0.12, 0.004, 0, '#4E3B2B', '#4E3B2B');
    }
  });
}

function triggerWhisper(site, sound) {
  if (!site || !sound || sound.muted === true) return false;
  const { x, z, soundKind } = site;
  try {
    if (soundKind === 'crane') sound.craneCall?.(x, z);
    else if (soundKind === 'sundial') sound.goStoneClick?.(x, z);
    else if (soundKind === 'echo') (sound.frogPlop || sound.waterCup)?.call(sound, x, z);
    else if (soundKind === 'cellar') sound.wood?.(x, z);
    else if (soundKind === 'firefly') sound.dewDrop?.(x, z);
    else if (soundKind === 'celadon') sound.goStoneClick?.(x, z);
    else if (soundKind === 'chimes') sound.guqinPluck?.(x, z, 2);
    else sound.wood?.(x, z);
    return true;
  } catch (_) {
    return false;
  }
}

function scheduleSoundForSite(site, queue, sound, worldClock) {
  const { x, z, soundKind } = site;
  if (!sound) return;
  try { sound.unlock?.(); } catch (_) { /* noop */ }
  const push = (delay, fn) => queue.push({ delay, fn });
  if (soundKind === 'crane') {
    push(0, () => sound.craneCall?.(x, z));
    push(0.65, () => sound.craneCall?.(x + 2, z - 2));
  } else if (soundKind === 'sundial') {
    void worldClock;
    push(0, () => sound.bell?.(x, z));
    push(0.36, () => sound.goStoneClick?.(x, z));
  } else if (soundKind === 'echo') {
    push(0, () => (sound.waterCup || sound.gurgle)?.call(sound, x, z));
    push(0.42, () => sound.guqinPluck?.(x, z, 2));
    push(0.88, () => (sound.frogPlop || sound.dewDrop)?.call(sound, x, z));
    push(1.32, () => sound.guqinPluck?.(x, z, 4));
  } else if (soundKind === 'cellar') {
    push(0, () => sound.wood?.(x, z));
    push(0.28, () => (sound.toastCup || sound.waterCup)?.call(sound, x, z));
  } else if (soundKind === 'firefly') {
    push(0, () => sound.bell?.(x, z));
    push(0.30, () => sound.dewDrop?.(x, z));
    push(0.62, () => sound.dewDrop?.(x, z));
  } else if (soundKind === 'celadon') {
    push(0, () => sound.goStoneClick?.(x, z));
    push(0.26, () => sound.bell?.(x, z));
  } else if (soundKind === 'chimes') {
    push(0, () => sound.wood?.(x, z));
    push(0.18, () => sound.guqinPluck?.(x, z, 0));
    push(0.36, () => sound.guqinPluck?.(x, z, 2));
    push(0.54, () => sound.guqinPluck?.(x, z, 4));
    push(0.74, () => sound.wood?.(x, z));
  } else {
    push(0, () => sound.wood?.(x, z));
  }
}

/**
 * 拓展山野七处可探索互动彩蛋（山野七奇）：
 * - 青松白鹤巢 · 避秦石晷台 · 空谷回音潭 · 松坡埋坛窖 · 幽林萤石龛 · 古窑青瓷秘匣 · 碧涧竹风铃廊
 * - 1 个合批静态网格 + 1 个 85m 距离裁剪刚体动态合批网格 + 1 个 85m 高斯微光晕实例化网格（零全局光源，村中零额外 draw call）
 */
export function createWildsEasterEggs(options = {}) {
  const cfg = options.config || eggsCfg;
  const pal = cfg.palette;
  const { field } = options;

  const group = new THREE.Group();
  group.name = 'wilds-easter-eggs';

  const surface = (x, z) => (field ? habitatSurface(field, x, z) : 0);

  const staticMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide
  });
  const dynMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide
  });

  const haloGeo = new THREE.PlaneGeometry(2, 2);
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.36 } },
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false
  });
  haloMat.opacity = 0.36;
  haloMat.userData.skyIgnore = true;

  const baker = createVertexColorBaker();
  const staticKey = 'wilds-eggs-static';

  const sites = [];
  const targets = [];
  const blockers = [];
  const quietSpots = [];
  const discovered = new Set();
  const interacted = new Set();
  const pendingSounds = [];

  // Dynamic rigid batch slots tracked cleanly
  const slotGeos = [];
  const pushSlot = (g) => {
    const idx = slotGeos.length;
    slotGeos.push(g);
    return idx;
  };

  const craneData = {
    siteIdx: -1,
    cx: 0, cy: 0, cz: 0, rot: 0,
    slots: {}
  };
  const sundialData = {
    siteIdx: -1,
    cx: 0, cy: 0, cz: 0, rot: 0,
    motes: []
  };
  const echoData = {
    siteIdx: -1,
    cx: 0, cy: 0, cz: 0, rot: 0,
    poolX: 0, poolZ: 0,
    ripples: [],
    lilySlot: -1,
    waveTimer: 0
  };
  const cellarData = {
    siteIdx: -1,
    lidX: 0, lidY: 0, lidZ: 0, rot: 0,
    jarX: 0, jarY: 0, jarZ: 0,
    lidSlot: -1,
    motes: []
  };
  const shrineData = {
    siteIdx: -1,
    cx: 0, cy: 0, cz: 0, rot: 0,
    bellSlot: -1,
    bellPos: [0, 0, 0],
    fireflies: [],
    fireflyWorldPos: []
  };
  const celadonData = {
    siteIdx: -1,
    cupX: 0, cupY: 0, cupZ: 0, rot: 0,
    cupSlot: -1,
    glintSlot: -1
  };
  const chimesData = {
    siteIdx: -1,
    cx: 0, cy: 0, cz: 0, rot: 0,
    tubes: [],
    waveTimer: 0
  };

  const siteHaloSpecs = [];

  for (let sIdx = 0; sIdx < (cfg.sites || []).length; sIdx++) {
    const spec = cfg.sites[sIdx];
    const x = spec.x;
    const z = spec.z;
    const rot = spec.rot || 0;
    const y = surface(x, z);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const toW = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const groundAt = (lx, lz) => {
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      return Math.min(y, surface(wx, wz));
    };

    const site = {
      id: spec.id,
      name: spec.name,
      action: spec.action,
      soundKind: spec.soundKind,
      rumor: spec.rumor,
      poem: spec.poem,
      lines: spec.lines.slice(),
      lineCursor: 0,
      x,
      y,
      z,
      rot,
      height: spec.height || 1.2,
      radius: spec.radius || 1.6,
      cooldown: 0,
      burstTimer: 0,
      whisperCooldown: 0
    };
    sites.push(site);

    let mainBlocker = null;
    let haloOff = [0, 0.65, 0, 1.85, pal.firefly];

    if (spec.id === 'wilds-crane-nest') {
      craneData.siteIdx = sIdx;
      craneData.cx = x; craneData.cy = y; craneData.cz = z; craneData.rot = rot;

      // Mossy base boulder
      const b0 = toW(-0.22, -0.06, 0.14);
      baker.withTag('stone', () => {
        baker.addFacetedRock(staticKey, b0[0], groundAt(-0.22, 0.14) + 0.04, b0[2], 0.72, 0.44, 0.60, rot + 0.4, 71, { mossTag: 'moss' });
      });

      // Gnarled pine trunk & sweeping nest fork + root buttresses
      baker.addBeam(staticKey, [x - 0.34, groundAt(-0.34, 0.2) - 0.18, z + 0.20], toW(0.0, 0.22, 0), 0.11, 0.06, 5, pal.bark, pal.barkLight, false);
      baker.addBeam(staticKey, [x + 0.30, groundAt(0.30, -0.22) - 0.18, z - 0.22], toW(0.0, 0.20, 0), 0.10, 0.055, 5, pal.bark, pal.barkLight, false);
      baker.addBeam(staticKey, toW(0.0, -0.22, 0.0), toW(0.10, 0.92, -0.05), 0.21, 0.155, 7, pal.bark, pal.barkLight, true);
      baker.addBeam(staticKey, toW(0.09, 0.88, -0.05), toW(-0.08, 1.98, 0.06), 0.152, 0.112, 7, pal.bark, pal.barkLight, true);
      baker.addBeam(staticKey, toW(-0.07, 1.94, 0.06), toW(0.14, 2.94, -0.04), 0.110, 0.074, 6, pal.bark, pal.barkLight, true);
      // Horizontal forked bough supporting the twig nest
      baker.addBeam(staticKey, toW(-0.05, 1.72, 0.04), toW(0.66, 1.94, 0.22), 0.092, 0.062, 6, pal.bark, pal.barkLight, true);
      baker.addBeam(staticKey, toW(0.62, 1.93, 0.21), toW(1.18, 2.18, 0.34), 0.058, 0.028, 5, pal.bark, pal.barkLight, true);
      baker.addBeam(staticKey, toW(-0.04, 2.28, 0.05), toW(-0.88, 2.80, -0.24), 0.078, 0.036, 5, pal.bark, pal.barkLight, true);

      // Woven twig nest basin at (0.64, 1.98, 0.22)
      const nw = toW(0.66, 2.02, 0.22);
      baker.withTag('frost-cap', () => {
        baker.addHollowCylinder(staticKey, nw[0], nw[1], nw[2], 0.56, 0.36, 0.20, 10, rot, '#7C6245', '#5C442E');
      });
      baker.addCylinder(staticKey, nw[0], nw[1] - 0.04, nw[2], 0.40, 0.30, 0.10, 9, rot, '#A98E5C', '#866D42');
      for (let tw = 0; tw < 8; tw++) {
        const a = rot + (tw / 8) * TAU;
        const n0 = [nw[0] + Math.cos(a) * 0.58, nw[1] + 0.06, nw[2] + Math.sin(a) * 0.58];
        const n1 = [nw[0] + Math.cos(a + 1.1) * 0.48, nw[1] + 0.12, nw[2] + Math.sin(a + 1.1) * 0.48];
        baker.addBeam(staticKey, n0, n1, 0.020, 0.015, 4, '#6B5239', '#876B4A', false);
      }

      // Layered Song pine cloud pads
      baker.withTag('pine-foliage', () => {
        const pads = [
          [-0.86, 2.86, -0.24, [0.96, 0.28, 0.82]],
          [0.14, 3.06, -0.04, [1.14, 0.34, 0.96]],
          [-0.22, 2.68, 0.42, [0.76, 0.24, 0.68]],
          [1.14, 2.38, 0.34, [0.58, 0.20, 0.52]]
        ];
        for (let i = 0; i < pads.length; i++) {
          const [px, py, pz, sc] = pads[i];
          const wp = toW(px, py, pz);
          addLeafCanopy(baker, staticKey, wp[0], wp[1], wp[2], sc[0], sc[1], sc[2], 8, pal.pineLight, pal.pineMid, pal.pineDark, i * 1.1);
        }
      });

      // Twin animated cranes atop nest
      craneData.slots = {
        aBody: pushSlot(buildCraneBodyGeo(pal, 0.96)),
        aWingL: pushSlot(buildCraneWingGeo(pal, -1, 0.96)),
        aWingR: pushSlot(buildCraneWingGeo(pal, 1, 0.96)),
        bBody: pushSlot(buildCraneBodyGeo(pal, 0.84)),
        bWingL: pushSlot(buildCraneWingGeo(pal, -1, 0.84)),
        bWingR: pushSlot(buildCraneWingGeo(pal, 1, 0.84)),
        feathers: [
          pushSlot(buildFeatherGeo(pal)),
          pushSlot(buildFeatherGeo(pal)),
          pushSlot(buildFeatherGeo(pal)),
          pushSlot(buildFeatherGeo(pal))
        ]
      };

      mainBlocker = { x, z, hw: 0.48, hd: 0.48, minY: y, maxY: y + 2.6, rot, source: 'wilds-' + spec.id };
      blockers.push(mainBlocker);
      haloOff = [0.64, 2.24, 0.22, 2.0, '#FFF2C8'];
      quietSpots.push({ x, z, radius: 7.5, name: '松巢鹤唳' });
    } else if (spec.id === 'wilds-stone-sundial') {
      sundialData.siteIdx = sIdx;
      sundialData.cx = x; sundialData.cy = y; sundialData.cz = z; sundialData.rot = rot;

      // Grounding mossy boulder plinth
      baker.withTag('stone', () => {
        baker.addFacetedRock(staticKey, x, groundAt(0, 0) - 0.04, z, 0.82, 0.34, 0.82, rot, 73, { mossTag: 'moss' });
      });
      baker.withTag('frost-cap', () => {
        baker.addCylinder(staticKey, x, y + 0.32, z, 0.56, 0.64, 0.46, 8, rot, pal.stoneLight, pal.stoneMid);
        baker.addCylinder(staticKey, x, y + 0.58, z, 0.42, 0.48, 0.14, 8, rot, pal.stoneLight, pal.stoneMid);
      });

      // Tilted equatorial stone dial face + 12 carved shichen marker wedges + bronze gnomon
      const dialCenter = toW(0, 0.82, 0);
      const tilt = 0.42; // tilted facing sky & slightly toward viewer
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const toDial = (dx, dy, dz) => {
        const ty = dy * ct - dz * st;
        const tz = dy * st + dz * ct;
        return [
          dialCenter[0] + dx * c + tz * s,
          dialCenter[1] + ty,
          dialCenter[2] - dx * s + tz * c
        ];
      };
      // Build 12-sided stone disc facing dial normal
      const dialApex = toDial(0, 0.05, 0);
      const dialBot = toDial(0, -0.05, 0);
      const dialTopRing = [];
      const dialBotRing = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const ux = Math.cos(a) * 0.48;
        const uz = Math.sin(a) * 0.48;
        dialTopRing.push(toDial(ux, 0.045, uz));
        dialBotRing.push(toDial(ux, -0.045, uz));
      }
      baker.withTag('stone', () => {
        for (let i = 0; i < 12; i++) {
          const j = (i + 1) % 12;
          baker.addTri(staticKey, dialApex[0], dialApex[1], dialApex[2], dialTopRing[j][0], dialTopRing[j][1], dialTopRing[j][2], dialTopRing[i][0], dialTopRing[i][1], dialTopRing[i][2], i % 2 === 0 ? '#A2A89B' : pal.stoneLight, 0.03);
          baker.addTri(staticKey, dialBot[0], dialBot[1], dialBot[2], dialBotRing[i][0], dialBotRing[i][1], dialBotRing[i][2], dialBotRing[j][0], dialBotRing[j][1], dialBotRing[j][2], pal.stoneDark, -0.03);
          baker.addQuad(staticKey, dialBotRing[j], dialBotRing[i], dialTopRing[i], dialTopRing[j], pal.stoneMid, 0);
          // Carved tick bar on dial upper surface
          const pIn = toDial(Math.cos((i / 12) * TAU) * 0.34, 0.062, Math.sin((i / 12) * TAU) * 0.34);
          const pOut = toDial(Math.cos((i / 12) * TAU) * 0.44, 0.058, Math.sin((i / 12) * TAU) * 0.44);
          baker.addBeam(staticKey, pIn, pOut, 0.011, 0.008, 4, pal.stoneDark, pal.bronze, false);
        }
      });
      // Angled bronze gnomon needle
      baker.addBeam(staticKey, toDial(0, 0.04, 0), toDial(0, 0.46, 0), 0.022, 0.007, 6, pal.bronze, pal.goldAccent, true);

      // Flanking maple shrub & moss tuft
      const mPos = toW(-0.68, 0.14, 0.36);
      baker.withTag('maple-accent', () => {
        addLeafCanopy(baker, staticKey, mPos[0], groundAt(-0.68, 0.36) + 0.18, mPos[2], 0.28, 0.20, 0.24, 6, pal.mapleRed, '#9E4537', pal.mossDark, 0.5);
      });

      for (let i = 0; i < 3; i++) {
        sundialData.motes.push(pushSlot(bakeUnit((b) => addDiamond(b, 'u', 0, 0, 0, 0.048, 0.058, 0.048, '#F6DA86', pal.goldAccent))));
      }

      mainBlocker = { x, z, hw: 0.72, hd: 0.72, minY: y, maxY: y + 1.4, rot, source: 'wilds-' + spec.id };
      blockers.push(mainBlocker);
      haloOff = [0, 1.05, 0, 1.9, '#F7DF9C'];
    } else if (spec.id === 'wilds-jade-echo-spring') {
      echoData.siteIdx = sIdx;
      echoData.cx = x; echoData.cy = y; echoData.cz = z; echoData.rot = rot;

      // Grounding outer rim & crescent jade water basin
      const basinRing = [
        [-1.08, 0.24, -0.45, 0.52, 0.62, 0.48, 0.2],
        [-0.64, 0.48, -1.04, 0.56, 1.05, 0.52, 0.9],
        [0.0, 0.62, -1.18, 0.62, 1.32, 0.54, 1.4],
        [0.64, 0.46, -1.02, 0.56, 1.02, 0.52, 2.1],
        [1.08, 0.22, -0.42, 0.52, 0.58, 0.48, 2.8]
      ];
      baker.withTag('stone', () => {
        for (let i = 0; i < basinRing.length; i++) {
          const [lx, ly, lz, rx, ry, rz, yawO] = basinRing[i];
          const wp = toW(lx, ly, lz);
          const gy = groundAt(lx, lz);
          baker.addFacetedRock(staticKey, wp[0], gy + ly * 0.78, wp[2], rx, ry, rz, rot + yawO, 80 + i, { mossTag: 'moss' });
        }
        // Front stepping slab at lz = +1.05
        const stp = toW(0, 0.0, 1.02);
        baker.addBox(staticKey, stp[0], groundAt(0, 1.02) + 0.06, stp[2], 0.88, 0.16, 0.52, rot, pal.stoneLight, pal.stoneMid);
        // Sculpted stone frog crouching at pool rim (+0.56, 0.18, +0.46)
        const fr = toW(0.56, 0.20, 0.42);
        baker.addFacetedRock(staticKey, fr[0], fr[1], fr[2], 0.16, 0.12, 0.20, rot - 0.5, 91, {
          stoneDark: '#556B4E', stoneMid: '#6E8862', stoneLight: '#85A077', hasMoss: false
        });
        const frHead = toW(0.48, 0.26, 0.34);
        baker.addCone(staticKey, frHead[0], frHead[1], frHead[2], 0.09, 0.10, 6, rot, '#7F9C72', '#5A7152');
      });

      // Sunken crescent pool water surface
      const poolCenter = toW(0, 0.05, -0.10);
      echoData.poolX = poolCenter[0];
      echoData.poolZ = poolCenter[2];
      baker.withTag('pool-water', () => {
        baker.addCylinder(staticKey, poolCenter[0], poolCenter[1], poolCenter[2], 1.04, 0.98, 0.06, 12, rot, pal.poolJade, pal.poolDeep);
      });

      echoData.ripples = [
        pushSlot(buildRingGeo(0.22, 0.27, 0.016, '#B8DED7')),
        pushSlot(buildRingGeo(0.22, 0.27, 0.016, '#9ACDC5')),
        pushSlot(buildRingGeo(0.22, 0.27, 0.016, '#7BBAB2'))
      ];
      echoData.lilySlot = pushSlot(buildLilyLeafGeo());

      const back = toW(0, 0, -1.08);
      mainBlocker = { x: back[0], z: back[2], hw: 1.05, hd: 0.45, minY: y, maxY: y + 1.5, rot, source: 'wilds-' + spec.id };
      blockers.push(mainBlocker);
      haloOff = [0, 0.45, -0.05, 2.05, '#9EE8DC'];
      quietSpots.push({ x, z, radius: 7.5, name: '空谷回音' });
    } else if (spec.id === 'wilds-hermit-wine-cellar') {
      cellarData.siteIdx = sIdx;
      cellarData.rot = rot;

      // Grounding earth-stone cellar mound + leaning slate slab cover embedded on local ground
      baker.withTag('stone', () => {
        const ml = toW(-0.26, 0.0, -0.18);
        baker.addFacetedRock(staticKey, ml[0], groundAt(-0.26, -0.18) + 0.06, ml[2], 0.85, 0.38, 0.72, rot + 0.3, 102, { mossTag: 'moss' });
        const sl = toW(-0.42, 0.0, 0.38);
        baker.addTiltedBox(staticKey, sl[0], groundAt(-0.42, 0.38) + 0.14, sl[2], 0.74, 0.09, 0.56, 0.24, rot - 0.18, 0.12, pal.stoneLight, pal.stoneDark);
      });
      // Three half-buried clay wine jars (two sealed, one open neck for animated lid)
      const jars = [
        [0.08, 0.16, 0.05, true],
        [0.42, 0.10, -0.18, false],
        [-0.08, 0.12, -0.36, false]
      ];
      for (let i = 0; i < jars.length; i++) {
        const [jx, jy, jz, mainJar] = jars[i];
        const jp = toW(jx, jy, jz);
        baker.addCylinder(staticKey, jp[0], jp[1], jp[2], 0.17, 0.14, 0.28, 8, rot, pal.clay, pal.clayDark);
        baker.addHollowCylinder(staticKey, jp[0], jp[1] + 0.15, jp[2], 0.13, 0.09, 0.05, 8, rot, pal.clay, pal.clayDark);
        if (!mainJar) {
          // Sealed red linen wrap & mud cap
          baker.addCone(staticKey, jp[0], jp[1] + 0.19, jp[2], 0.145, 0.08, 8, rot, i === 1 ? pal.sealRed : '#877865', pal.clayDark);
        } else {
          cellarData.jarX = jp[0]; cellarData.jarY = jp[1] + 0.17; cellarData.jarZ = jp[2];
          cellarData.lidX = jp[0]; cellarData.lidY = jp[1] + 0.18; cellarData.lidZ = jp[2];
        }
      }
      // Vermilion lacquered stake & hemp knot marker
      const stk0 = toW(0.54, -0.12, 0.32);
      const stk1 = toW(0.58, 0.54, 0.34);
      baker.addBeam(staticKey, stk0, stk1, 0.042, 0.036, 5, pal.sealRed, '#8E332B', true);
      const tie = toW(0.57, 0.42, 0.335);
      baker.addCylinder(staticKey, tie[0], tie[1], tie[2], 0.048, 0.048, 0.05, 6, rot, pal.linen, '#BDAE8F');
      // Small mountain pine sapling behind jars
      baker.withTag('pine-foliage', () => {
        const sp = toW(-0.62, 0.42, -0.36);
        baker.addBeam(staticKey, toW(-0.56, -0.12, -0.36), sp, 0.045, 0.025, 5, pal.bark, pal.barkLight, false);
        addLeafCanopy(baker, staticKey, sp[0], sp[1] + 0.08, sp[2], 0.36, 0.18, 0.32, 6, pal.pineLight, pal.pineMid, pal.pineDark, 0.7);
      });

      cellarData.lidSlot = pushSlot(bakeUnit((b) => {
        b.addCylinder('u', 0, 0.015, 0, 0.12, 0.135, 0.04, 8, 0, pal.clayDark, '#5D3C29');
        b.addCylinder('u', 0, 0.042, 0, 0.042, 0.056, 0.035, 6, 0, pal.sealRed, pal.clay);
      }));
      for (let i = 0; i < 4; i++) {
        cellarData.motes.push(pushSlot(bakeUnit((b) => addDiamond(b, 'u', 0, 0, 0, 0.042, 0.052, 0.042, '#F7D2AE', '#E59D8D'))));
      }

      mainBlocker = { x, z, hw: 0.72, hd: 0.62, minY: y, maxY: y + 0.9, rot, source: 'wilds-' + spec.id };
      blockers.push(mainBlocker);
      haloOff = [0.08, 0.52, 0.05, 1.75, '#F5C494'];
    } else if (spec.id === 'wilds-firefly-lantern-shrine') {
      shrineData.siteIdx = sIdx;
      shrineData.cx = x; shrineData.cy = y; shrineData.cz = z; shrineData.rot = rot;

      // Mossy stepped stone pedestal
      baker.withTag('stone', () => {
        baker.addFacetedRock(staticKey, x, groundAt(0, 0) - 0.04, z, 0.68, 0.30, 0.68, rot, 114, { mossTag: 'moss' });
      });
      baker.withTag('frost-cap', () => {
        baker.addBox(staticKey, x, y + 0.36, z, 0.68, 0.36, 0.62, rot, pal.stoneMid, pal.stoneDark);
        // Side cheeks & back plate framing open niche facing local +z
        const chL = toW(-0.24, 0.76, -0.02);
        const chR = toW(0.24, 0.76, -0.02);
        const bk = toW(0, 0.76, -0.22);
        baker.addBox(staticKey, chL[0], chL[1], chL[2], 0.14, 0.48, 0.44, rot, pal.stoneMid, pal.stoneDark);
        baker.addBox(staticKey, chR[0], chR[1], chR[2], 0.14, 0.48, 0.44, rot, pal.stoneMid, pal.stoneDark);
        baker.addBox(staticKey, bk[0], bk[1], bk[2], 0.60, 0.48, 0.14, rot, pal.stoneDark, pal.stoneDark);
        // Pitched gabled stone shrine roof + lotus pearl finial
        const rfL = toW(-0.24, 1.12, 0);
        const rfR = toW(0.24, 1.12, 0);
        baker.addTiltedBox(staticKey, rfL[0], rfL[1], rfL[2], 0.46, 0.09, 0.74, 0, rot, 0.38, pal.stoneLight, pal.stoneMid);
        baker.addTiltedBox(staticKey, rfR[0], rfR[1], rfR[2], 0.46, 0.09, 0.74, 0, rot, -0.38, pal.stoneLight, pal.stoneMid);
        const cap = toW(0, 1.24, 0);
        baker.addCone(staticKey, cap[0], cap[1], cap[2], 0.11, 0.16, 6, rot, pal.stoneLight, pal.stoneMid);
      });

      // Tiny creek offering pebbles inside alcove
      const pb0 = toW(-0.06, 0.57, 0.08);
      const pb1 = toW(0.06, 0.56, 0.10);
      baker.addCone(staticKey, pb0[0], pb0[1], pb0[2], 0.065, 0.06, 6, rot, '#A3ABA0', '#7D867A');
      baker.addCone(staticKey, pb1[0], pb1[1], pb1[2], 0.05, 0.045, 6, rot, '#C4B69C', '#9D9078');
      // Red crimson berry bush alongside shrine
      const sb = toW(-0.62, 0.16, 0.24);
      baker.withTag('maple-accent', () => {
        addLeafCanopy(baker, staticKey, sb[0], groundAt(-0.62, 0.24) + 0.16, sb[2], 0.26, 0.18, 0.24, 6, pal.mapleRed, '#9B4235', pal.mossDark, 2.2);
      });

      shrineData.bellPos = toW(0, 0.94, 0.06);
      shrineData.bellSlot = pushSlot(bakeUnit((b) => {
        b.addBeam('u', [0, 0, 0], [0, -0.08, 0], 0.008, 0.008, 4, pal.sealRed, pal.sealRed, false);
        b.addCylinder('u', 0, -0.14, 0, 0.042, 0.068, 0.11, 7, 0, pal.bronze, '#5D4F33');
      }));
      for (let i = 0; i < 6; i++) {
        shrineData.fireflies.push(pushSlot(bakeUnit((b) => addDiamond(b, 'u', 0, 0, 0, 0.036, 0.040, 0.036, '#F4FEA8', pal.firefly))));
        shrineData.fireflyWorldPos.push([x, y + 0.9, z]);
      }

      mainBlocker = { x, z, hw: 0.58, hd: 0.56, minY: y, maxY: y + 1.4, rot, source: 'wilds-' + spec.id };
      blockers.push(mainBlocker);
      haloOff = [0, 0.95, 0.1, 1.9, pal.firefly];
    } else if (spec.id === 'wilds-ancient-kiln-cache') {
      celadonData.siteIdx = sIdx;
      celadonData.rot = rot;

      // Collapsed brick kiln mound flanking stone chest
      baker.withTag('stone', () => {
        const km = toW(-0.68, 0.04, -0.26);
        baker.addFacetedRock(staticKey, km[0], groundAt(-0.68, -0.26) + 0.12, km[2], 0.68, 0.42, 0.56, rot + 0.6, 125, {
          stoneDark: '#7C5342', stoneMid: '#946753', stoneLight: '#AC7C66', mossTag: 'moss'
        });
        for (let b = 0; b < 5; b++) {
          const bp = toW(-0.46 + (b % 3) * 0.16, 0.16 + Math.floor(b / 3) * 0.12, -0.22 + (b % 2) * 0.24);
          baker.addTiltedBox(staticKey, bp[0], bp[1], bp[2], 0.24, 0.09, 0.12, 0.12 * (b - 2), rot + b * 0.5, 0.08 * b, '#9B654F', '#784C3B');
        }
      });

      // Carved stone chest with permanently half-open slate lid + linen pad
      baker.withTag('frost-cap', () => {
        const ch = toW(0.08, 0.18, 0.06);
        const cy0 = groundAt(0.08, 0.06);
        baker.addBox(staticKey, ch[0], cy0 + 0.14, ch[2], 0.78, 0.32, 0.52, rot, pal.stoneMid, pal.stoneDark);
        // Propped hinged chest lid tilted back ~52 deg
        const lidP = toW(0.08, 0.46, -0.22);
        baker.addTiltedBox(staticKey, lidP[0], cy0 + 0.44, lidP[2], 0.80, 0.07, 0.52, -0.92, rot, 0, pal.stoneLight, pal.stoneDark);
        // Linen bed inside chest (elevated slightly so celadon cup peeks from approach)
        const padP = toW(0.08, 0.30, 0.06);
        baker.addBox(staticKey, padP[0], cy0 + 0.34, padP[2], 0.58, 0.05, 0.36, rot, pal.linen, '#BFB292');
        celadonData.cupX = padP[0];
        celadonData.cupY = cy0 + 0.37;
        celadonData.cupZ = padP[2];
      });
      // Flanking antique grey pottery jar shard outside chest
      const sj = toW(0.62, 0.06, 0.22);
      baker.addCylinder(staticKey, sj[0], groundAt(0.62, 0.22) + 0.11, sj[2], 0.12, 0.10, 0.22, 8, rot, '#7F847D', '#5F645E');

      celadonData.cupSlot = pushSlot(buildCeladonCupGeo(pal));
      celadonData.glintSlot = pushSlot(bakeUnit((b) => addDiamond(b, 'u', 0, 0, 0, 0.044, 0.062, 0.044, '#E8FAF4', pal.celadonRim)));

      mainBlocker = { x, z, hw: 0.76, hd: 0.58, minY: y, maxY: y + 1.0, rot, source: 'wilds-' + spec.id };
      blockers.push(mainBlocker);
      haloOff = [0.08, 0.62, 0.06, 1.75, '#B4EFE0'];
    } else if (spec.id === 'wilds-bamboo-wind-chimes') {
      chimesData.siteIdx = sIdx;
      chimesData.cx = x; chimesData.cy = y; chimesData.cz = z; chimesData.rot = rot;

      // Flanking mossy creek boulders under gantry posts
      baker.withTag('stone', () => {
        const bL = toW(-0.88, 0, 0);
        const bR = toW(0.88, 0, 0);
        baker.addFacetedRock(staticKey, bL[0], groundAt(-0.88, 0) + 0.04, bL[2], 0.44, 0.34, 0.44, rot, 131, { mossTag: 'moss' });
        baker.addFacetedRock(staticKey, bR[0], groundAt(0.88, 0) + 0.04, bR[2], 0.44, 0.34, 0.44, rot + 1.2, 132, { mossTag: 'moss' });
      });
      // Arched bamboo portal frame (left/right vertical bamboo posts + diagonal braces + top crossbar)
      baker.withTag('bamboo', () => {
        const l0 = toW(-0.84, -0.14, 0);
        const l1 = toW(-0.76, 1.98, 0);
        const r0 = toW(0.84, -0.14, 0);
        const r1 = toW(0.76, 1.98, 0);
        const cL = toW(-0.96, 1.96, 0);
        const cR = toW(0.96, 1.96, 0);
        baker.addBeam(staticKey, [l0[0], groundAt(-0.84, 0) - 0.14, l0[2]], l1, 0.064, 0.054, 6, pal.bambooMid, pal.bambooLight, true);
        baker.addBeam(staticKey, [r0[0], groundAt(0.84, 0) - 0.14, r0[2]], r1, 0.064, 0.054, 6, pal.bambooMid, pal.bambooLight, true);
        baker.addBeam(staticKey, cL, cR, 0.056, 0.056, 6, pal.bambooLight, pal.bambooMid, true);
        // Diagonal brace struts & second crossbar
        baker.addBeam(staticKey, toW(-0.78, 1.50, 0), toW(-0.42, 1.96, 0), 0.032, 0.028, 5, pal.bambooMid, pal.bambooLight, false);
        baker.addBeam(staticKey, toW(0.78, 1.50, 0), toW(0.42, 1.96, 0), 0.032, 0.028, 5, pal.bambooMid, pal.bambooLight, false);
        // Red twine binding joints on crossbar corners
        const jL = toW(-0.76, 1.95, 0);
        const jR = toW(0.76, 1.95, 0);
        baker.addCylinder(staticKey, jL[0], jL[1], jL[2], 0.068, 0.068, 0.08, 6, rot, pal.sealRed, '#8D332B');
        baker.addCylinder(staticKey, jR[0], jR[1], jR[2], 0.068, 0.068, 0.08, 6, rot, pal.sealRed, '#8D332B');
      });
      // Delicate bamboo leaf sprays at upper corners
      baker.withTag('pine-foliage', () => {
        const lsL = toW(-0.96, 2.08, 0.10);
        const lsR = toW(0.96, 2.04, -0.08);
        addLeafCanopy(baker, staticKey, lsL[0], lsL[1], lsL[2], 0.34, 0.16, 0.28, 6, pal.bambooLight, pal.bambooMid, pal.pineMid, 0.2);
        addLeafCanopy(baker, staticKey, lsR[0], lsR[1], lsR[2], 0.32, 0.15, 0.26, 6, pal.bambooLight, pal.bambooMid, pal.pineMid, 1.4);
      });

      const tubeLens = [0.60, 0.53, 0.46, 0.39, 0.33];
      for (let i = 0; i < 5; i++) {
        chimesData.tubes.push(pushSlot(buildBambooChimeGeo(tubeLens[i], 0.036 - i * 0.0025, pal, i === 2)));
      }

      // Slim pier blockers so center arch walks freely and sightlines stay unobstructed
      const pier = toW(-0.84, 0, 0);
      mainBlocker = { x: pier[0], z: pier[2], hw: 0.26, hd: 0.26, minY: y, maxY: y + 2.1, rot, source: 'wilds-' + spec.id };
      blockers.push(mainBlocker);
      const pierR = toW(0.84, 0, 0);
      blockers.push({ x: pierR[0], z: pierR[2], hw: 0.26, hd: 0.26, minY: y, maxY: y + 2.1, rot, source: 'wilds-' + spec.id + '-r' });
      haloOff = [0, 1.55, 0, 1.85, '#DCF2B6'];
      quietSpots.push({ x, z, radius: 7.5, name: '碧涧竹铃' });
    }

    // Discovery target with unobstructed ownBlocker surface check
    targets.push({
      id: spec.id,
      x,
      y: y + Math.min(1.6, spec.height * 0.78),
      z,
      range: 14,
      ownBlocker: mainBlocker
    });

    siteHaloSpecs.push({
      siteIdx: sIdx,
      x: x + haloOff[0] * c + haloOff[2] * s,
      y: y + haloOff[1],
      z: z - haloOff[0] * s + haloOff[2] * c,
      radius: haloOff[3],
      color: new THREE.Color(haloOff[4])
    });
  }

  const staticMesh = baker.buildMesh(staticKey, staticMat, 'wilds-eggs-static');
  if (staticMesh) group.add(staticMesh);
  const staticGeo = staticMesh ? staticMesh.geometry : null;
  const staticTags = staticMesh?.userData?.colorTags || [];
  const springStaticSnap = staticGeo ? new Float32Array(staticGeo.attributes.color.array) : null;

  // Dynamic rigid batch mesh (1 draw call max, gated at <= 85m)
  const dynBatch = createRigidBatchMesh(slotGeos, dynMat, 'wilds-eggs-dynamic');
  group.add(dynBatch.mesh);

  // Gaussian glow billboard InstancedMesh (7 site halos + 6 spirit-niche fireflies = 13 max, gated at <= 85m)
  const totalHalos = siteHaloSpecs.length + 6;
  const glowMesh = new THREE.InstancedMesh(haloGeo, haloMat, totalHalos);
  glowMesh.name = 'wilds-eggs-glow';
  glowMesh.userData.dynamic = true;
  glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glowMesh.frustumCulled = false;
  glowMesh.renderOrder = 3;
  const fireflyColor = new THREE.Color(pal.firefly || '#E6F49B');
  const tmpHaloCol = new THREE.Color();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  for (let i = 0; i < totalHalos; i++) {
    tmpPos.set(0, -100, 0);
    tmpScale.setScalar(0.1);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    glowMesh.setMatrixAt(i, tmpMat);
    glowMesh.setColorAt(i, tmpHaloCol.copy(i < siteHaloSpecs.length ? siteHaloSpecs[i].color : fireflyColor));
  }
  glowMesh.instanceMatrix.needsUpdate = true;
  if (glowMesh.instanceColor) {
    glowMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    glowMesh.instanceColor.needsUpdate = true;
  }
  glowMesh.visible = false;
  group.add(glowMesh);

  let currentPhenology = 'spring';
  const _snowCol = new THREE.Color('#EAE8E0');
  const _iceCol = new THREE.Color('#8FAFB5');
  const _autRed = new THREE.Color('#C94C35');
  const _autMoss = new THREE.Color('#8D8B52');
  const _sumPine = new THREE.Color('#27553B');

  function setPhenology(id) {
    const next = (id === 'summer' || id === 'autumn' || id === 'winter') ? id : 'spring';
    if (!staticGeo || !springStaticSnap) return false;
    if (next === currentPhenology && next !== 'spring') return false;
    currentPhenology = next;

    const dst = staticGeo.attributes.color.array;
    const nor = staticGeo.attributes.normal.array;
    dst.set(springStaticSnap);

    if (next === 'summer') {
      for (const t of staticTags) {
        if (t.tag === 'pine-foliage' || t.tag === 'moss') {
          for (let v = t.start; v < t.end; v++) {
            const i = v * 3;
            dst[i] = lerp(springStaticSnap[i], _sumPine.r, 0.34);
            dst[i + 1] = lerp(springStaticSnap[i + 1], _sumPine.g, 0.34);
            dst[i + 2] = lerp(springStaticSnap[i + 2], _sumPine.b, 0.34);
          }
        }
      }
    } else if (next === 'autumn') {
      for (const t of staticTags) {
        if (t.tag === 'maple-accent') {
          for (let v = t.start; v < t.end; v++) {
            const i = v * 3;
            dst[i] = lerp(springStaticSnap[i], _autRed.r, 0.65);
            dst[i + 1] = lerp(springStaticSnap[i + 1], _autRed.g, 0.65);
            dst[i + 2] = lerp(springStaticSnap[i + 2], _autRed.b, 0.65);
          }
        } else if (t.tag === 'moss') {
          for (let v = t.start; v < t.end; v++) {
            const i = v * 3;
            dst[i] = lerp(springStaticSnap[i], _autMoss.r, 0.45);
            dst[i + 1] = lerp(springStaticSnap[i + 1], _autMoss.g, 0.45);
            dst[i + 2] = lerp(springStaticSnap[i + 2], _autMoss.b, 0.45);
          }
        }
      }
    } else if (next === 'winter') {
      for (const t of staticTags) {
        if (t.tag === 'pool-water') {
          for (let v = t.start; v < t.end; v++) {
            const i = v * 3;
            dst[i] = lerp(springStaticSnap[i], _iceCol.r, 0.72);
            dst[i + 1] = lerp(springStaticSnap[i + 1], _iceCol.g, 0.72);
            dst[i + 2] = lerp(springStaticSnap[i + 2], _iceCol.b, 0.72);
          }
        } else if (t.tag === 'frost-cap' || t.tag === 'pine-foliage' || t.tag === 'stone' || t.tag === 'moss') {
          for (let v = t.start; v < t.end; v++) {
            const ny = nor[v * 3 + 1];
            if (ny > 0.34) {
              const blend = clamp((ny - 0.34) / 0.56, 0, 1) * (t.tag === 'pine-foliage' ? 0.58 : 0.78);
              const i = v * 3;
              dst[i] = lerp(springStaticSnap[i], _snowCol.r, blend);
              dst[i + 1] = lerp(springStaticSnap[i + 1], _snowCol.g, blend);
              dst[i + 2] = lerp(springStaticSnap[i + 2], _snowCol.b, blend);
            }
          }
        }
      }
    }

    staticGeo.attributes.color.needsUpdate = true;
    return true;
  }

  // Distance-gated per-frame transform writer (zero work from village!)
  let activeDynamicSites = 0;
  let activeGlowInstances = 0;
  let simTime = 0;
  let hasDrawnInitial = false;
  let disposed = false;

  const siteNear = new Uint8Array(sites.length);

  function writeDynamics(t, sky, playerState) {
    const hasPlayer = Boolean(playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z));
    let anyNear = false;
    let nearSitesCount = 0;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      const near = !hasPlayer || Math.hypot(playerState.x - s.x, playerState.z - s.z) <= 85;
      siteNear[i] = near ? 1 : 0;
      if (near) {
        anyNear = true;
        nearSitesCount++;
      }
    }
    activeDynamicSites = nearSitesCount;

    if (!anyNear) {
      dynBatch.mesh.visible = false;
      glowMesh.visible = false;
      glowMesh.count = 0;
      activeGlowInstances = 0;
      return;
    }

    dynBatch.mesh.visible = true;
    const windS = clamp(0.45 + (sky?.wind ?? 0.35) * 0.9, 0.3, 1.7);

    // 1. Cranes + drifting feathers
    if (craneData.siteIdx >= 0 && siteNear[craneData.siteIdx]) {
      const s = sites[craneData.siteIdx];
      const cs = Math.cos(craneData.rot);
      const sn = Math.sin(craneData.rot);
      const mapC = (lx, ly, lz) => [craneData.cx + lx * cs + lz * sn, craneData.cy + ly, craneData.cz - lx * sn + lz * cs];
      const burst = s.burstTimer > 0 ? Math.sin(clamp(s.burstTimer / 4.2, 0, 1) * Math.PI) : 0;

      const bowA = Math.sin(t * 1.45) * 0.07 + burst * Math.sin(t * 5.2) * 0.14;
      const pA = mapC(0.56, 2.24 + burst * 0.08, 0.14);
      dynBatch.writePart(craneData.slots.aBody, pA[0], pA[1], pA[2], bowA, craneData.rot + 0.35, 0);
      const flapA = 0.08 + Math.max(0, Math.sin(t * 1.8) * 0.08) + burst * (0.48 + Math.sin(t * 9.5) * 0.32);
      dynBatch.writePart(craneData.slots.aWingL, pA[0], pA[1] + 0.02, pA[2], bowA * 0.5, craneData.rot + 0.35, flapA);
      dynBatch.writePart(craneData.slots.aWingR, pA[0], pA[1] + 0.02, pA[2], bowA * 0.5, craneData.rot + 0.35, -flapA);

      const bowB = Math.cos(t * 1.35 + 0.8) * 0.08 + burst * Math.cos(t * 5.0) * 0.12;
      const pB = mapC(0.84, 2.21 + burst * 0.05, 0.32);
      dynBatch.writePart(craneData.slots.bBody, pB[0], pB[1], pB[2], bowB, craneData.rot - 0.65, 0);
      const flapB = 0.06 + Math.max(0, Math.sin(t * 1.6 + 1.2) * 0.06) + burst * (0.42 + Math.cos(t * 9.0) * 0.30);
      dynBatch.writePart(craneData.slots.bWingL, pB[0], pB[1] + 0.02, pB[2], bowB * 0.5, craneData.rot - 0.65, flapB);
      dynBatch.writePart(craneData.slots.bWingR, pB[0], pB[1] + 0.02, pB[2], bowB * 0.5, craneData.rot - 0.65, -flapB);

      for (let f = 0; f < craneData.slots.feathers.length; f++) {
        if (s.burstTimer > 0) {
          const prog = (4.2 - s.burstTimer + f * 0.38) / 4.2;
          const cy = ((prog % 1) + 1) % 1;
          const fp = mapC(0.66 + Math.sin(t * 2.1 + f * 1.7) * 0.68, 2.35 - cy * 1.85, 0.22 + Math.cos(t * 1.9 + f) * 0.62);
          const fade = Math.sin(cy * Math.PI);
          dynBatch.writePart(craneData.slots.feathers[f], fp[0], fp[1], fp[2], t * 1.3 + f, t * 2.1, Math.sin(t * 3 + f) * 0.45, fade, fade, fade);
        } else {
          dynBatch.hidePart(craneData.slots.feathers[f]);
        }
      }
    } else if (craneData.siteIdx >= 0) {
      dynBatch.hidePart(craneData.slots.aBody);
      dynBatch.hidePart(craneData.slots.aWingL);
      dynBatch.hidePart(craneData.slots.aWingR);
      dynBatch.hidePart(craneData.slots.bBody);
      dynBatch.hidePart(craneData.slots.bWingL);
      dynBatch.hidePart(craneData.slots.bWingR);
      for (const fs of craneData.slots.feathers) dynBatch.hidePart(fs);
    }

    // 2. Stone sundial orbiting sun-motes
    if (sundialData.siteIdx >= 0 && siteNear[sundialData.siteIdx]) {
      const s = sites[sundialData.siteIdx];
      const boost = s.burstTimer > 0 ? 1.0 : 0.0;
      const spd = 0.65 + boost * 1.9;
      for (let i = 0; i < sundialData.motes.length; i++) {
        const a = t * spd + (i / sundialData.motes.length) * TAU;
        const r = 0.34 + Math.sin(t * 1.5 + i) * 0.04;
        const sc = 0.72 + boost * 0.45 + 0.16 * Math.sin(t * 3.1 + i);
        dynBatch.writePart(
          sundialData.motes[i],
          sundialData.cx + Math.cos(a) * r,
          sundialData.cy + 0.96 + Math.sin(a * 2) * 0.06 + boost * 0.12,
          sundialData.cz + Math.sin(a) * r,
          t * 1.2, t * 1.8 + i, 0,
          sc, sc, sc
        );
      }
    } else {
      for (const m of sundialData.motes) dynBatch.hidePart(m);
    }

    // 3. Echo Spring expanding jade ripples & lotus leaf
    if (echoData.siteIdx >= 0 && siteNear[echoData.siteIdx]) {
      const s = sites[echoData.siteIdx];
      const cs = Math.cos(echoData.rot);
      const sn = Math.sin(echoData.rot);
      const activeBurst = s.burstTimer > 0;
      for (let i = 0; i < echoData.ripples.length; i++) {
        const phase = ((t * (activeBurst ? 0.68 : 0.24) + i * 0.33) % 1);
        const sc = 0.35 + phase * (activeBurst ? 3.2 : 2.1);
        dynBatch.writePart(
          echoData.ripples[i],
          echoData.poolX,
          echoData.cy + 0.088 + (1 - phase) * 0.008,
          echoData.poolZ,
          0, echoData.rot + t * 0.2, 0,
          sc, 1 - phase * 0.4, sc
        );
      }
      dynBatch.writePart(
        echoData.lilySlot,
        echoData.poolX - 0.36 * cs + 0.12 * sn,
        echoData.cy + 0.088 + Math.sin(t * 2.1) * 0.008,
        echoData.poolZ + 0.36 * sn + 0.12 * cs,
        Math.sin(t * 1.4) * 0.03, echoData.rot + t * 0.08, 0
      );
    } else {
      for (const r of echoData.ripples) dynBatch.hidePart(r);
      if (echoData.lilySlot >= 0) dynBatch.hidePart(echoData.lilySlot);
    }

    // 4. Wine cellar tilting lid & rising warm aroma motes
    if (cellarData.siteIdx >= 0 && siteNear[cellarData.siteIdx]) {
      const s = sites[cellarData.siteIdx];
      const openAmt = s.burstTimer > 0 ? Math.sin(clamp(s.burstTimer / 4.2, 0, 1) * Math.PI) : 0;
      dynBatch.writePart(
        cellarData.lidSlot,
        cellarData.lidX - Math.sin(cellarData.rot) * openAmt * 0.08,
        cellarData.lidY + openAmt * 0.06,
        cellarData.lidZ + Math.cos(cellarData.rot) * openAmt * 0.08,
        openAmt * 0.58, cellarData.rot, openAmt * 0.18
      );
      for (let i = 0; i < cellarData.motes.length; i++) {
        const cy = ((t * (0.28 + openAmt * 0.35) + i * 0.25) % 1);
        const sc = Math.sin(cy * Math.PI) * (0.55 + openAmt * 0.65);
        dynBatch.writePart(
          cellarData.motes[i],
          cellarData.jarX + Math.sin(t * 1.8 + i * 1.7) * 0.14,
          cellarData.jarY + 0.06 + cy * (0.52 + openAmt * 0.38),
          cellarData.jarZ + Math.cos(t * 1.5 + i * 1.9) * 0.14,
          0, t + i, 0,
          sc, sc, sc
        );
      }
    } else {
      if (cellarData.lidSlot >= 0) dynBatch.hidePart(cellarData.lidSlot);
      for (const m of cellarData.motes) dynBatch.hidePart(m);
    }

    // 5. Spirit niche swinging bell & 6 orbiting jade-gold fireflies
    if (shrineData.siteIdx >= 0 && siteNear[shrineData.siteIdx]) {
      const s = sites[shrineData.siteIdx];
      const ringAmt = s.burstTimer > 0 ? Math.sin(clamp(s.burstTimer / 4.2, 0, 1) * Math.PI) : 0;
      const swing = Math.sin(t * 2.4) * 0.04 * windS + Math.sin(t * 14.0) * 0.34 * ringAmt;
      dynBatch.writePart(
        shrineData.bellSlot,
        shrineData.bellPos[0], shrineData.bellPos[1], shrineData.bellPos[2],
        swing, shrineData.rot, swing * 0.4
      );
      const speedMul = 1.0 + ringAmt * 1.4;
      for (let i = 0; i < shrineData.fireflies.length; i++) {
        const a = t * (0.85 + (i % 3) * 0.22) * speedMul + i * 1.05;
        const rad = 0.42 + (i % 2) * 0.26 + ringAmt * 0.28;
        const fx = shrineData.cx + Math.cos(a) * rad;
        const fy = shrineData.cy + 0.85 + Math.sin(t * 1.7 + i * 1.3) * (0.22 + ringAmt * 0.32) + ringAmt * 0.22;
        const fz = shrineData.cz + Math.sin(a * 0.92 + i * 0.3) * rad;
        shrineData.fireflyWorldPos[i][0] = fx;
        shrineData.fireflyWorldPos[i][1] = fy;
        shrineData.fireflyWorldPos[i][2] = fz;
        const pulse = 0.72 + 0.28 * Math.sin(t * 3.8 + i * 1.7);
        dynBatch.writePart(shrineData.fireflies[i], fx, fy, fz, 0, a, 0, pulse, pulse, pulse);
      }
    } else {
      if (shrineData.bellSlot >= 0) dynBatch.hidePart(shrineData.bellSlot);
      for (const ff of shrineData.fireflies) dynBatch.hidePart(ff);
    }

    // 6. Ancient kiln cache rotating celadon lotus cup & glaze sheen glint
    if (celadonData.siteIdx >= 0 && siteNear[celadonData.siteIdx]) {
      const s = sites[celadonData.siteIdx];
      const insp = s.burstTimer > 0 ? Math.sin(clamp(s.burstTimer / 4.2, 0, 1) * Math.PI) : 0;
      dynBatch.writePart(
        celadonData.cupSlot,
        celadonData.cupX,
        celadonData.cupY + insp * 0.14 + Math.sin(t * 1.6) * 0.008 * insp,
        celadonData.cupZ,
        0, celadonData.rot + t * (0.18 + insp * 1.35), 0
      );
      const gl = 0.55 + insp * 0.65 + 0.2 * Math.sin(t * 3.4);
      dynBatch.writePart(
        celadonData.glintSlot,
        celadonData.cupX + Math.cos(t * 1.8) * 0.14,
        celadonData.cupY + 0.28 + insp * 0.16 + Math.sin(t * 2.3) * 0.05,
        celadonData.cupZ + Math.sin(t * 1.8) * 0.14,
        0, t * 2.2, 0,
        gl, gl, gl
      );
    } else {
      if (celadonData.cupSlot >= 0) dynBatch.hidePart(celadonData.cupSlot);
      if (celadonData.glintSlot >= 0) dynBatch.hidePart(celadonData.glintSlot);
    }

    // 7. Bamboo wind chimes cascading pendulum tubes
    if (chimesData.siteIdx >= 0 && siteNear[chimesData.siteIdx]) {
      const s = sites[chimesData.siteIdx];
      const cs = Math.cos(chimesData.rot);
      const sn = Math.sin(chimesData.rot);
      const burst = s.burstTimer > 0 ? s.burstTimer : 0;
      for (let i = 0; i < chimesData.tubes.length; i++) {
        const lx = -0.44 + i * 0.22;
        const wx = chimesData.cx + lx * cs;
        const wz = chimesData.cz - lx * sn;
        const waveEnv = burst > 0 ? Math.exp(-Math.pow((4.2 - burst) - i * 0.18, 2) * 3.2) : 0;
        const swayZ = Math.sin(t * 2.0 + i * 0.6) * 0.06 * windS + Math.sin(t * 11.5 - i * 0.7) * 0.28 * waveEnv;
        const swayX = Math.cos(t * 1.5 + i * 0.8) * 0.04 * windS + Math.cos(t * 9.0 - i * 0.6) * 0.14 * waveEnv;
        dynBatch.writePart(chimesData.tubes[i], wx, chimesData.cy + 1.94, wz, swayX, chimesData.rot, swayZ);
      }
    } else {
      for (const ch of chimesData.tubes) dynBatch.hidePart(ch);
    }

    dynBatch.commit();

    // Update Gaussian glow billboards (site auras + spirit-niche fireflies)
    const tw = sky?.timeId;
    const isSoftLight = tw === 'night' || tw === 'dusk' || tw === 'dawn';
    let visCount = 0;
    tmpQuat.identity();

    for (let i = 0; i < siteHaloSpecs.length; i++) {
      const h = siteHaloSpecs[i];
      if (!siteNear[h.siteIdx]) continue;
      const site = sites[h.siteIdx];
      const isFound = discovered.has(site.id);
      const bursting = site.burstTimer > 0 ? Math.sin(clamp(site.burstTimer / 4.2, 0, 1) * Math.PI) : 0;
      const dist = hasPlayer ? Math.hypot(playerState.x - h.x, playerState.z - h.z) : 0;
      if (dist > 85) continue;
      const fade = clamp((85 - dist) / 14, 0, 1);
      const breath = 0.88 + 0.12 * Math.sin(t * 2.4 + i * 1.3);
      // Softly brighter when undiscovered, at dusk/night, or during E burst
      const gain = (isFound ? (isSoftLight ? 0.34 : 0.14) : (isSoftLight ? 0.56 : 0.28)) + bursting * 0.45;
      const rad = h.radius * (0.94 + 0.08 * breath + bursting * 0.22);
      tmpPos.set(h.x, h.y + Math.sin(t * 1.8 + i) * 0.04, h.z);
      tmpScale.set(rad, rad, rad);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      glowMesh.setMatrixAt(visCount, tmpMat);
      tmpHaloCol.copy(h.color).multiplyScalar(fade * gain * breath);
      glowMesh.setColorAt(visCount, tmpHaloCol);
      visCount++;
    }

    if (shrineData.siteIdx >= 0 && siteNear[shrineData.siteIdx]) {
      const s = sites[shrineData.siteIdx];
      const bursting = s.burstTimer > 0 ? Math.sin(clamp(s.burstTimer / 4.2, 0, 1) * Math.PI) : 0;
      const ffGain = (isSoftLight ? 0.88 : 0.32) + bursting * 0.52;
      for (let i = 0; i < shrineData.fireflyWorldPos.length; i++) {
        const [fx, fy, fz] = shrineData.fireflyWorldPos[i];
        const pulse = 0.72 + 0.28 * Math.sin(t * 3.8 + i * 1.7);
        const rad = 0.36 + bursting * 0.14;
        tmpPos.set(fx, fy, fz);
        tmpScale.set(rad, rad, rad);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        glowMesh.setMatrixAt(visCount, tmpMat);
        tmpHaloCol.copy(fireflyColor).multiplyScalar(ffGain * pulse);
        glowMesh.setColorAt(visCount, tmpHaloCol);
        visCount++;
      }
    }

    activeGlowInstances = visCount;
    glowMesh.count = visCount;
    glowMesh.visible = visCount > 0;
    if (visCount > 0) {
      glowMesh.instanceMatrix.needsUpdate = true;
      if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
      const nextOp = isSoftLight ? 0.44 : 0.26;
      haloMat.opacity = nextOp;
      haloMat.uniforms.uOpacity.value = nextOp;
    }
  }

  writeDynamics(0, null, null);
  hasDrawnInitial = true;

  let boundSound = null;
  let boundMap = null;
  let boundClock = null;
  let boundJournal = null;
  let noteEl = null;
  let noteTimer = 0;
  let lastNoteText = '';

  function triggerSite(site, sound, doc) {
    if (!site || disposed) return null;
    site.cooldown = 1.6;
    site.burstTimer = 4.2;
    interacted.add(site.id);
    discovered.add(site.id);

    const lineBase = site.lines[site.lineCursor % site.lines.length] || '';
    site.lineCursor = (site.lineCursor + 1) % site.lines.length;
    let text = lineBase;
    if (site.id === 'wilds-stone-sundial') {
      const clockSt = boundClock?.getState?.();
      const shichen = clockSt?.short || clockSt?.shichen || clockSt?.shichenName || '';
      if (shichen) {
        text = lineBase + '「此时正值' + shichen + '，铜针日影斜指石盘。」';
      }
    }

    noteTimer = 6.2;
    lastNoteText = text;
    const note = noteEl || doc?.getElementById?.('mystery-note');
    if (note) {
      note.textContent = text;
      note.classList?.add?.('show');
    }

    scheduleSoundForSite(site, pendingSounds, sound || boundSound, boundClock);
    // Fire t=0 audio immediately as part of user gesture frame
    drainPendingSounds(0);

    try { boundJournal?.observe?.(site.id); } catch (_) { /* noop */ }
    try { boundMap?.markWildsEggDiscovered?.(site); } catch (_) { /* noop */ }

    return { id: site.id, name: site.name, line: text, discovered: true };
  }

  function drainPendingSounds(step) {
    for (let i = pendingSounds.length - 1; i >= 0; i--) {
      const item = pendingSounds[i];
      item.delay -= step;
      if (item.delay <= 0) {
        pendingSounds.splice(i, 1);
        try { item.fn?.(); } catch (_) { /* noop */ }
      }
    }
  }

  function pickWildsTarget(camera, playerState, cfgBias = {}) {
    if (disposed || !playerState) return null;
    const st = playerState;
    const third = st.view === 'third';
    const eyeX = third ? st.x : camera.position.x;
    const eyeY = third ? st.y + (st.eyeHeight || 1.62) : camera.position.y;
    const eyeZ = third ? st.z : camera.position.z;
    const cp = Math.cos(st.pitch || 0);
    const fx = -Math.sin(st.yaw || 0) * cp;
    const fy = Math.sin(st.pitch || 0);
    const fz = -Math.cos(st.yaw || 0) * cp;
    let best = null;
    for (const s of sites) {
      if (s.cooldown > 0) continue;
      const distXZ = Math.hypot(s.x - st.x, s.z - st.z);
      if (distXZ > 4.4) continue;
      const ty = s.y + Math.min(1.4, s.height * 0.72);
      const dx = s.x - eyeX;
      const dy = ty - eyeY;
      const dz = s.z - eyeZ;
      const dist = Math.hypot(dx, dy, dz);
      const dot = (dx * fx + dy * fy + dz * fz) / (dist || 1);
      if (distXZ > 2.5 && dot < 0.70) continue;
      const score = dist + (1 - dot) * (cfgBias.alignBias || 2.5);
      if (!best || score < best.score) {
        best = {
          kind: 'mystery',
          key: 'wilds-egg:' + s.id,
          id: s.id,
          isWildsEasterEgg: true,
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

  function bind({ mysteries, sound, player, map, worldClock, journal, doc } = {}) {
    noteEl = doc?.getElementById?.('mystery-note') || null;
    if (sound) boundSound = sound;
    if (map) boundMap = map;
    if (worldClock) boundClock = worldClock;
    if (journal) boundJournal = journal;
    if (!mysteries || mysteries._wildsEasterEggsBound) return;
    mysteries._wildsEasterEggsBound = true;

    const prevPick = mysteries.pickTarget;
    const prevInteract = mysteries.interact;
    const prevHide = mysteries.hide;

    mysteries.pickTarget = function (camera, cfgBias) {
      const a = prevPick?.(camera, cfgBias) || null;
      const b = pickWildsTarget(camera, player?.state, cfgBias);
      if (!a) return b;
      if (!b) return a;
      return b.score < a.score ? b : a;
    };

    mysteries.interact = function (target) {
      if (target?.isWildsEasterEgg) {
        const s = sites.find(item => item.id === target.id);
        return triggerSite(s, boundSound, doc);
      }
      return prevInteract?.(target) || null;
    };

    mysteries.hide = function () {
      noteTimer = 0;
      if (noteEl && noteEl.textContent === lastNoteText) {
        noteEl.classList?.remove?.('show');
      }
      prevHide?.();
    };
  }

  function interactById(id, sound, doc) {
    const s = sites.find(item => item.id === id);
    return triggerSite(s, sound || boundSound, doc);
  }

  function hydrateDiscovered(ids) {
    if (!Array.isArray(ids)) return 0;
    let added = 0;
    for (const id of ids) {
      if (sites.some(s => s.id === id) && !discovered.has(id)) {
        discovered.add(id);
        added++;
      }
    }
    return added;
  }

  let globalWhisperCooldown = 0;
  let whisperCount = 0;

  function clearDiscovered() {
    discovered.clear();
    interacted.clear();
  }

  function update(dt, elapsed = 0, sky = null, playerState = null) {
    if (disposed) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(0.05, dt) : 0;
    if (step <= 0 && hasDrawnInitial) return;
    void elapsed;
    simTime += step;

    if (globalWhisperCooldown > 0) globalWhisperCooldown = Math.max(0, globalWhisperCooldown - step);
    for (const s of sites) {
      if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - step);
      if (s.burstTimer > 0) s.burstTimer = Math.max(0, s.burstTimer - step);
      if (s.whisperCooldown > 0) s.whisperCooldown = Math.max(0, s.whisperCooldown - step);
    }

    if (noteTimer > 0) {
      noteTimer = Math.max(0, noteTimer - step);
      if (noteTimer <= 0 && noteEl && noteEl.textContent === lastNoteText) {
        noteEl.classList?.remove?.('show');
      }
    }

    // Proximity acoustic whisper when approaching an undiscovered wilds site
    if (step > 0 && boundSound && playerState && !playerState.flying && globalWhisperCooldown <= 0 &&
        Number.isFinite(playerState.x) && Number.isFinite(playerState.z)) {
      let bestSite = null;
      let bestDist = 32;
      for (const s of sites) {
        if (discovered.has(s.id) || s.whisperCooldown > 0) continue;
        const d = Math.hypot(playerState.x - s.x, playerState.z - s.z);
        if (d >= 6.5 && d <= bestDist) {
          bestDist = d;
          bestSite = s;
        }
      }
      if (bestSite && triggerWhisper(bestSite, boundSound)) {
        bestSite.whisperCooldown = 16;
        globalWhisperCooldown = 9;
        whisperCount++;
      }
    }

    drainPendingSounds(step);
    writeDynamics(simTime, sky, playerState);
  }

  function getSites() {
    return sites.map(s => ({
      id: s.id,
      name: s.name,
      action: s.action,
      x: s.x,
      y: s.y,
      z: s.z,
      rumor: s.rumor,
      poem: s.poem,
      discovered: discovered.has(s.id)
    }));
  }

  function getStats() {
    return {
      count: sites.length,
      discovered: [...discovered],
      interacted: [...interacted],
      whispers: whisperCount,
      phenology: currentPhenology,
      activeDynamicSites,
      activeGlowInstances,
      staticTriangles: staticGeo ? staticGeo.attributes.position.count / 3 : 0,
      dynamicTriangles: dynBatch.triangles,
      simTime: +simTime.toFixed(3),
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pendingSounds.length = 0;
    staticMat.dispose();
    dynMat.dispose();
    haloGeo.dispose();
    haloMat.dispose();
    glowMesh.dispose?.();
    dynBatch.geo.dispose();
    staticGeo?.dispose?.();
    group.removeFromParent();
  }

  return {
    group,
    sites,
    targets,
    blockers,
    quietSpots,
    bind,
    interactById,
    hydrateDiscovered,
    clearDiscovered,
    setPhenology,
    update,
    getSites,
    getStats,
    dispose
  };
}
