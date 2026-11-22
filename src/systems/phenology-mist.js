import * as THREE from 'three';
import phenologySeasons from '../data/phenology-seasons.json' with { type: 'json' };
import { buildSeasonalLotusGeometry, buildSeasonalVignettes } from './phenology-vignettes.js';
import { buildSeasonalRoadDressing, applySeasonalRoadVertexColors } from '../world/seasonal-roads.js';
import { isModalBusy, isControlTarget } from './modal-state.js';

const TAU = Math.PI * 2;
const TOASTS = phenologySeasons.toasts || {};

export const PHENOLOGY_MODES = [
  { id: 'spring', label: '春深落英', short: '春深', toast: TOASTS.spring || '春深 · 芳草鲜美，落英缤纷' },
  { id: 'summer', label: '夏初新荷', short: '夏初', toast: TOASTS.summer || '夏初 · 绿阴如盖，清塘新荷' },
  { id: 'autumn', label: '秋熟金粟', short: '秋熟', toast: TOASTS.autumn || '秋熟 · 良田金粟，丹枫黄菊' },
  { id: 'winter', label: '冬寂薄雪', short: '冬寂', toast: TOASTS.winter || '冬寂 · 薄雪覆岸，岁寒松竹' }
];

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function isModalBlocked(doc) {
  return isModalBusy(doc);
}

const MIST_VERT = /* glsl */`
attribute float aSeed;
attribute float aGroundY;
attribute float aEnv;
varying vec2 vUv;
varying vec3 vWorldPos;
varying float vSeed;
varying float vGroundY;
varying float vEnv;

void main() {
  vUv = uv;
  vSeed = aSeed;
  vGroundY = aGroundY;
  vEnv = aEnv;

  #ifdef USE_INSTANCING
    mat4 instMat = modelMatrix * instanceMatrix;
    vec3 centerWorld = instMat[3].xyz;
    float sx = length(instMat[0].xyz);
    float sy = length(instMat[1].xyz);
  #else
    vec3 centerWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float sx = 1.0;
    float sy = 1.0;
  #endif

  // 球面朝向相机展开：任何俯仰或侧视角度下都不会缩成扁平白片或锐利刀锋
  vec3 toCam = cameraPosition - centerWorld;
  float camDist = max(length(toCam), 0.001);
  vec3 fwd = toCam / camDist;
  vec3 worldUp = abs(fwd.y) > 0.97 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 rightDir = normalize(cross(worldUp, fwd));
  vec3 upDir = cross(fwd, rightDir);

  vec3 worldPos = centerWorld + rightDir * (position.x * sx) + upDir * (position.y * sy);
  vWorldPos = worldPos;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const MIST_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOpacity;
uniform float uVisualGain;
uniform float uTime;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vSeed;
varying float vGroundY;
varying float vEnv;

float mhash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float mnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mhash(i);
  float b = mhash(i + vec2(1.0, 0.0));
  float c = mhash(i + vec2(0.0, 1.0));
  float d = mhash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float mfbm(vec2 p) {
  float v = 0.0;
  v += 0.55 * mnoise(p);
  v += 0.30 * mnoise(p * 2.07 + vec2(3.1, 1.7));
  v += 0.15 * mnoise(p * 4.13 + vec2(7.3, 5.9));
  return v;
}

void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float rawR2 = dot(q, q);
  if (rawR2 >= 0.96) discard;
  float outerGuard = pow(max(0.0, 1.0 - rawR2), 2.8);

  vec2 flowUv = q * vec2(1.35, 1.90) + vec2(vSeed * 3.7 - uTime * 0.042, vSeed * 1.9 + uTime * 0.016);
  float n = mfbm(flowUv);
  float wisp = smoothstep(0.32, 0.80, n);

  float dist = length(cameraPosition - vWorldPos);
  float nearFade = smoothstep(18.0, 42.0, dist);
  float farFade = 1.0 - smoothstep(100.0, 155.0, dist);
  float groundFade = smoothstep(0.22, 1.25, vWorldPos.y - vGroundY);

  float alpha = uOpacity * uVisualGain * vEnv * outerGuard * (0.25 + 0.75 * wisp) * nearFade * farFade * groundFade;
  if (alpha < 0.002) discard;

  float fogF = smoothstep(uFogNear, max(uFogNear + 1.0, uFogFar), dist);
  vec3 col = mix(uColor, uFogColor, fogF);

  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

function buildMistRibbonGeometry(count, rand) {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  const seeds = new Float32Array(count);
  const groundYs = new Float32Array(count);
  const envs = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    seeds[i] = rand() * 100;
    envs[i] = 1;
  }
  const seedAttr = new THREE.InstancedBufferAttribute(seeds, 1);
  const groundAttr = new THREE.InstancedBufferAttribute(groundYs, 1);
  groundAttr.setUsage(THREE.DynamicDrawUsage);
  const envAttr = new THREE.InstancedBufferAttribute(envs, 1);
  envAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aSeed', seedAttr);
  geo.setAttribute('aGroundY', groundAttr);
  geo.setAttribute('aEnv', envAttr);
  return geo;
}

function readInitialSeason(win) {
  try {
    const search = win?.location?.search;
    if (!search || typeof URLSearchParams !== 'function') return null;
    const sp = new URLSearchParams(search);
    const raw = sp.get('season') || sp.get('phenology');
    if (raw === 'spring' || raw === 'summer' || raw === 'autumn' || raw === 'winter') return raw;
    if (sp.get('weather') === 'snow') return 'winter';
  } catch {}
  return null;
}

export function createPhenologySystem(options = {}) {
  const {
    world,
    field,
    riverCurve,
    cliff,
    terrain,
    village,
    mountains,
    flora,
    petals,
    fallen,
    reeds,
    scatter,
    pondLife,
    qinHanCompletion,
    valleyBorderlands: vbOpt,
    leisureGrove,
    props,
    hinterland,
    smoothHinterlandPaths,
    habitatDetails,
    villageScenes,
    villageLife,
    exterior,
    qianmoPaths,
    inkAtmosphere,
    floraWind,
    outerWilds,
    deepHollows,
    wildsEasterEggs,
    wulingOutskirts,
    oxPlowing,
    seasonalCycle,
    sky,
    doc = typeof document !== 'undefined' ? document : null,
    win = typeof window !== 'undefined' ? window : null
  } = options;
  const valleyBorderlands = vbOpt || leisureGrove?.valleyBorderlands || null;

  const group = new THREE.Group();
  group.name = 'phenology-mist';

  const interiorGroup = new THREE.Group();
  interiorGroup.name = 'phenology-interior';
  group.add(interiorGroup);

  const exteriorGroup = new THREE.Group();
  exteriorGroup.name = 'phenology-exterior';
  group.add(exteriorGroup);

  let modeIndex = 0; // 0: 'spring' (default baseline, zero startup mutation)
  let simTime = 0;
  let disposed = false;
  let snapshotted = false;

  // Lazy snapshots captured right before first transition away from 'spring'
  const floraSnaps = [];
  const reedSnap = { colors: null, mesh: null };
  const pondReedSnap = { geo: null, colors: null };
  const bambooSnap = { geo: null, colors: null };
  const mulberryCoreSnap = { mesh: null, geo: null, colors: null, visible: null };
  const cropSnap = { geoColors: null, instColors: null, mesh: null };
  const petalSnap = { colorHex: null, opacity: null, count: null, mesh: null, instColors: null };
  const fallenSnap = { instColors: null, count: null, mesh: null };
  const groundSnap = { colors: null, geo: null };
  const leafSnap = { mesh: null, colors: null, visible: null };
  const staticSnap = { geo: null, colors: null };
  const stoneSnap = { mesh: null, colors: null };
  const rimSnap = { mesh: null, visible: null };
  const roofSnap = { colors: null, mesh: null };
  const patchSnap = {
    geo: null, colors: null,
    stems: null, stemsColorHex: null,
    heads: null, headColors: null
  };
  const tuftSnaps = [];
  const villageFieldSnap = { geo: null, colors: null };
  const villageRoadSnap = { geo: null, colors: null };
  const villageSpurSnap = { geo: null, colors: null };
  const laneStoneSnap = { mesh: null, colors: null };
  const qianmoGroundSnap = { geo: null, colors: null };
  const hinterlandRoadSnap = { geo: null, colors: null };
  const exteriorRoadSnap = { geo: null, colors: null };
  const propsSnap = { geo: null, colors: null };
  const hinterlandSnaps = [];
  const leisureSnaps = [];
  const botanicalSnaps = [];
  const pondSurfaceSnap = { geo: null, colors: null };
  const inkDuckweedSnap = { geo: null, colors: null };
  const inkRidgeSnap = { mesh: null, colors: null };
  const inkStreamPetalSnap = { mesh: null, count: 0, colors: null };
  const cliffSnaps = [];

  // 1. 夏初新荷 / 秋熟残荷 池面景观层（默认春深隐藏，0 额外 drawCall）
  const pond = world?.terrain?.pond;
  let lotusBundle = null;
  let lotusMesh = null;
  let lotusMat = null;
  if (pond) {
    const randLotus = lcg(20260801);
    const placements = (pondLife?.layout?.placements || []).filter(p => p.target === 'lotus');
    const spots = placements.length >= 3
      ? placements.map(p => ({ x: p.x, z: p.z }))
      : Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * TAU + 0.35;
          const r = (pond.radius || 9) * 0.56;
          return { x: pond.x + Math.cos(a) * r, z: pond.z + Math.sin(a) * r };
        });
    lotusBundle = buildSeasonalLotusGeometry(spots, pond, field, randLotus);
    lotusMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide
    });
    lotusMesh = new THREE.Mesh(lotusBundle.geo, lotusMat);
    lotusMesh.name = 'phenology-summer-lotus';
    lotusMesh.position.set(pond.x || 0, pond.waterY || 0, pond.z || 0);
    lotusMesh.matrixAutoUpdate = false;
    lotusMesh.matrix.makeTranslation(pond.x || 0, pond.waterY || 0, pond.z || 0);
    lotusMesh.matrixWorldNeedsUpdate = true;
    lotusMesh.visible = false;
    lotusMesh.frustumCulled = true;
    group.add(lotusMesh);
  }

  // 1b. 三季专属田园风物层（春深芸薹紫云英 / 夏初蜀葵萱草菖蒲 / 秋熟禾垛晒秋黄菊）
  const vignettes = buildSeasonalVignettes({ world, field, village });
  if (vignettes.springMesh) interiorGroup.add(vignettes.springMesh);
  if (vignettes.summerMesh) interiorGroup.add(vignettes.summerMesh);
  if (vignettes.autumnMesh) interiorGroup.add(vignettes.autumnMesh);

  // 1c. 四季专属道路 3D 建模装饰层（春落英青苔 / 夏青石润苔 / 秋落叶车辙 / 冬雪埂冻冰）
  const roadDressing = buildSeasonalRoadDressing({
    world,
    field,
    cliff,
    village,
    hinterland,
    qianmoPaths,
    exterior,
    valleyBorderlands,
    outerWilds
  });
  for (const s of ['spring', 'summer', 'autumn', 'winter']) {
    if (roadDressing.interiorMeshes[s]) interiorGroup.add(roadDressing.interiorMeshes[s]);
    if (roadDressing.exteriorMeshes[s]) exteriorGroup.add(roadDressing.exteriorMeshes[s]);
  }

  // 2. 昼夜与雨雾流动远谷轻岚
  const MIST_COUNT = 26;
  const mistRand = lcg(88413);
  const mistGeo = buildMistRibbonGeometry(MIST_COUNT, mistRand);
  const mistGroundAttr = mistGeo.getAttribute('aGroundY');
  const mistEnvAttr = mistGeo.getAttribute('aEnv');
  const mistMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#DCE6E2') },
      uFogColor: { value: new THREE.Color('#E2ECE6') },
      uFogNear: { value: 65 },
      uFogFar: { value: 210 },
      uOpacity: { value: 0 },
      uVisualGain: { value: 0.30 },
      uTime: { value: 0 }
    },
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  mistMat.userData.skyIgnore = true;
  const mistMesh = new THREE.InstancedMesh(mistGeo, mistMat, MIST_COUNT);
  mistMesh.name = 'valley-mist-ribbons';
  mistMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mistMesh.frustumCulled = false;
  mistMesh.visible = false;
  mistMesh.renderOrder = 3;
  group.add(mistMesh);

  const waterY = world?.terrain?.waterLevel ?? -1;
  const mistBands = [];
  const sampleY = (x, z) => (field?.sample ? field.sample(x, z) : waterY);

  for (let i = 0; i < 9; i++) {
    const t0 = 0.14 + (i / 9) * 0.72;
    const pt = riverCurve?.getPointAt ? riverCurve.getPointAt(t0) : { x: 20, z: 120 - i * 16 };
    const tan = riverCurve?.getTangentAt ? riverCurve.getTangentAt(t0) : { x: 0, z: -1 };
    mistBands.push({
      zone: 'stream',
      cx: pt.x + (mistRand() - 0.5) * 3.2,
      cz: pt.z + (mistRand() - 0.5) * 3.2,
      hoverY: 0.85 + mistRand() * 0.65,
      dx: tan.x,
      dz: tan.z,
      span: 8.5 + mistRand() * 5.0,
      len: 10.5 + mistRand() * 4.5,
      height: 2.2 + mistRand() * 0.9,
      speed: 0.28 + mistRand() * 0.18,
      phase: mistRand() * TAU
    });
  }
  if (cliff?.slit) {
    const ux = Math.cos(cliff.slit.angle || 0);
    const uz = Math.sin(cliff.slit.angle || 0);
    const tx = -uz, tz = ux;
    for (let i = 0; i < 4; i++) {
      const sOff = i < 2 ? (19.0 + i * 6.5) : (-28.0 - (i - 2) * 7.0);
      const lat = (i % 2 === 0 ? -1 : 1) * (8.5 + mistRand() * 4.5);
      const mx = cliff.slit.x + ux * sOff + tx * lat;
      const mz = cliff.slit.z + uz * sOff + tz * lat;
      mistBands.push({
        zone: 'cave',
        cx: mx,
        cz: mz,
        hoverY: 1.8 + mistRand() * 1.1,
        dx: tx,
        dz: tz,
        span: 6.5 + mistRand() * 3.5,
        len: 11.0 + mistRand() * 4.0,
        height: 2.6 + mistRand() * 0.9,
        speed: 0.22 + mistRand() * 0.14,
        phase: mistRand() * TAU
      });
    }
  }
  const rimAnchors = [
    [-52, -118], [-48, -162], [-34, -220], [18, -244], [58, -224],
    [94, -198], [116, -168], [96, -98], [-44, -82], [86, -64],
    [-16, -188], [42, -214], [78, -184]
  ];
  let rimIdx = 0;
  while (mistBands.length < MIST_COUNT) {
    const [ax, az] = rimAnchors[rimIdx % rimAnchors.length];
    rimIdx += 1;
    const mx = ax + (mistRand() - 0.5) * 14;
    const mz = az + (mistRand() - 0.5) * 14;
    const ang = mistRand() * TAU;
    mistBands.push({
      zone: 'foothill',
      cx: mx,
      cz: mz,
      hoverY: 1.35 + mistRand() * 1.15,
      dx: Math.cos(ang),
      dz: Math.sin(ang),
      span: 9.0 + mistRand() * 5.0,
      len: 13.0 + mistRand() * 5.5,
      height: 2.5 + mistRand() * 1.1,
      speed: 0.20 + mistRand() * 0.14,
      phase: mistRand() * TAU
    });
  }

  function snapshotGeo(targetMesh) {
    if (!targetMesh?.geometry?.attributes?.color) return null;
    return { geo: targetMesh.geometry, colors: new Float32Array(targetMesh.geometry.attributes.color.array) };
  }

  function ensureSnapshots() {
    if (snapshotted) return;
    snapshotted = true;

    // 1. Flora peach trees
    const seenGeo = new Set();
    flora?.group?.traverse?.(obj => {
      if (!obj.isMesh || !obj.geometry?.attributes?.color) return;
      const g = obj.geometry;
      if (seenGeo.has(g)) return;
      seenGeo.add(g);
      const arr = g.attributes.color.array;
      const base = new Float32Array(arr);
      const blossomMask = new Uint8Array(arr.length / 3);
      const budMask = new Uint8Array(arr.length / 3);
      for (let i = 0, v = 0; i < arr.length; i += 3, v++) {
        const r = base[i], gr = base[i + 1], b = base[i + 2];
        if (r > 0.30 && b > 0.14 && (r - gr) > 0.04 && r > b * 1.05) {
          blossomMask[v] = 1;
        } else if (gr > r + 0.05 && gr > b + 0.05) {
          budMask[v] = 1;
        }
      }
      floraSnaps.push({ geo: g, base, blossomMask, budMask });
    });

    // 2. Outer river reeds & village pond reeds & bamboo
    const rMesh = reeds?.group?.getObjectByName?.('reeds') || reeds?.mesh;
    if (rMesh?.instanceColor?.array) {
      reedSnap.mesh = rMesh;
      reedSnap.colors = new Float32Array(rMesh.instanceColor.array);
    }
    const prMesh = village?.group?.getObjectByName?.('reeds');
    if (prMesh?.geometry?.attributes?.color) {
      pondReedSnap.geo = prMesh.geometry;
      pondReedSnap.colors = new Float32Array(prMesh.geometry.attributes.color.array);
    }
    const bamMesh = village?.group?.getObjectByName?.('bamboo');
    if (bamMesh?.geometry?.attributes?.color) {
      bambooSnap.geo = bamMesh.geometry;
      bambooSnap.colors = new Float32Array(bamMesh.geometry.attributes.color.array);
    }

    // 3. Crops & village fields/spurs/qianmo
    const cMesh = qinHanCompletion?.group?.getObjectByName?.('qin-han-millet-crops');
    if (cMesh?.geometry?.attributes?.color) {
      cropSnap.mesh = cMesh;
      cropSnap.geoColors = new Float32Array(cMesh.geometry.attributes.color.array);
      if (cMesh.instanceColor?.array) {
        cropSnap.instColors = new Float32Array(cMesh.instanceColor.array);
      }
    }
    const vf = snapshotGeo(village?.group?.getObjectByName?.('village-fields'));
    if (vf) { villageFieldSnap.geo = vf.geo; villageFieldSnap.colors = vf.colors; }
    const vr = snapshotGeo(village?.group?.getObjectByName?.('village-road'));
    if (vr) { villageRoadSnap.geo = vr.geo; villageRoadSnap.colors = vr.colors; }
    const vs = snapshotGeo(village?.group?.getObjectByName?.('village-spurs'));
    if (vs) { villageSpurSnap.geo = vs.geo; villageSpurSnap.colors = vs.colors; }
    const lsMesh = village?.group?.getObjectByName?.('lane-stones');
    if (lsMesh?.instanceColor?.array) {
      laneStoneSnap.mesh = lsMesh;
      laneStoneSnap.colors = new Float32Array(lsMesh.instanceColor.array);
    }
    const qg = snapshotGeo(qianmoPaths?.groundMesh || qianmoPaths?.group?.getObjectByName?.('qianmo-paths-ground'));
    if (qg) { qianmoGroundSnap.geo = qg.geo; qianmoGroundSnap.colors = qg.colors; }
    const hr = snapshotGeo(smoothHinterlandPaths || hinterland?.group?.getObjectByName?.('hinterland-paths-smooth'));
    if (hr) { hinterlandRoadSnap.geo = hr.geo; hinterlandRoadSnap.colors = hr.colors; }
    const er = snapshotGeo(exterior?.group?.getObjectByName?.('exterior-exploration-ground'));
    if (er) { exteriorRoadSnap.geo = er.geo; exteriorRoadSnap.colors = er.colors; }

    // 4. Falling & fallen petals
    if (petals?.mesh) {
      petalSnap.mesh = petals.mesh;
      petalSnap.colorHex = petals.mesh.material?.color?.getHex?.() ?? 0xf3c3cc;
      petalSnap.opacity = petals.mesh.material?.opacity ?? 0.96;
      petalSnap.count = petals.mesh.count;
      if (petals.mesh.instanceColor?.array) petalSnap.instColors = new Float32Array(petals.mesh.instanceColor.array);
    }
    if (fallen?.mesh) {
      fallenSnap.mesh = fallen.mesh;
      fallenSnap.count = fallen.mesh.count;
      if (fallen.mesh.instanceColor?.array) {
        fallenSnap.instColors = new Float32Array(fallen.mesh.instanceColor.array);
      }
    }

    // 5. Terrain, roofs, mulberry, static completion, stones, pond ice rim
    const gMesh = terrain?.mesh;
    if (gMesh?.geometry?.attributes?.color) {
      groundSnap.geo = gMesh.geometry;
      groundSnap.colors = new Float32Array(gMesh.geometry.attributes.color.array);
    }
    const roofMesh = village?.group?.getObjectByName?.('houses-roof');
    if (roofMesh?.instanceColor?.array) {
      roofSnap.mesh = roofMesh;
      roofSnap.colors = new Float32Array(roofMesh.instanceColor.array);
    }
    const leafMesh = village?.group?.getObjectByName?.('mulberry-leaves');
    if (leafMesh) {
      leafSnap.mesh = leafMesh;
      leafSnap.visible = leafMesh.visible;
      if (leafMesh.instanceColor?.array) leafSnap.colors = new Float32Array(leafMesh.instanceColor.array);
    }
    const coreMesh = village?.group?.getObjectByName?.('mulberry-core');
    if (coreMesh) {
      mulberryCoreSnap.mesh = coreMesh;
      mulberryCoreSnap.visible = coreMesh.visible;
      if (coreMesh.geometry?.attributes?.color) {
        mulberryCoreSnap.geo = coreMesh.geometry;
        mulberryCoreSnap.colors = new Float32Array(coreMesh.geometry.attributes.color.array);
      }
    }
    const staticMesh = qinHanCompletion?.group?.getObjectByName?.('qin-han-completion-static');
    if (staticMesh?.geometry?.attributes?.color) {
      staticSnap.geo = staticMesh.geometry;
      staticSnap.colors = new Float32Array(staticMesh.geometry.attributes.color.array);
    }
    const stoneMesh = scatter?.group?.getObjectByName?.('stones');
    if (stoneMesh?.instanceColor?.array) {
      stoneSnap.mesh = stoneMesh;
      stoneSnap.colors = new Float32Array(stoneMesh.instanceColor.array);
    }
    const rimMesh = village?.group?.getObjectByName?.('pond-ice-rim');
    if (rimMesh) { rimSnap.mesh = rimMesh; rimSnap.visible = rimMesh.visible; }

    // 6. Scatter ground-patch, grass tufts & wildflowers
    const scatterGroup = scatter?.group;
    const patchMesh = scatterGroup?.getObjectByName?.('ground-patch');
    if (patchMesh?.geometry?.attributes?.color) {
      patchSnap.geo = patchMesh.geometry;
      patchSnap.colors = new Float32Array(patchMesh.geometry.attributes.color.array);
    }
    patchSnap.stems = scatterGroup?.getObjectByName?.('flower-stems') || null;
    if (patchSnap.stems?.material?.color) {
      patchSnap.stemsColorHex = patchSnap.stems.material.color.getHex();
    }
    patchSnap.heads = scatterGroup?.getObjectByName?.('flower-heads') || null;
    if (patchSnap.heads?.instanceColor?.array) {
      patchSnap.headColors = new Float32Array(patchSnap.heads.instanceColor.array);
    }
    for (const tName of ['grass', 'grass-near', 'grass-approach']) {
      const tm = scatterGroup?.getObjectByName?.(tName);
      if (tm?.instanceColor?.array) {
        const fu = tm.material?.userData?.flowerUniforms || null;
        tuftSnaps.push({
          name: tName,
          mesh: tm,
          colors: new Float32Array(tm.instanceColor.array),
          flowerUniforms: fu,
          origFlowerA: fu ? fu.uFlowerA.value.clone() : null,
          origFlowerB: fu ? fu.uFlowerB.value.clone() : null,
          origFlowerAmt: fu ? fu.uFlowerAmt.value : null
        });
      }
    }

    // 7. Props, hinterland, leisureGrove, botanicals, pondLife, inkAtmosphere
    const vp = snapshotGeo(props?.group?.getObjectByName?.('village-props'));
    if (vp) { propsSnap.geo = vp.geo; propsSnap.colors = vp.colors; }

    hinterland?.group?.traverse?.(obj => {
      if (!obj.isMesh || !obj.name) return;
      if (/^hinterland-(crown\d+|leaf|fruit|box|foliage-leaves)$/.test(obj.name)) {
        hinterlandSnaps.push({
          name: obj.name,
          mesh: obj,
          instColors: obj.instanceColor?.array ? new Float32Array(obj.instanceColor.array) : null,
          geo: obj.geometry?.attributes?.color ? obj.geometry : null,
          geoColors: obj.geometry?.attributes?.color ? new Float32Array(obj.geometry.attributes.color.array) : null
        });
      }
    });

    for (const lName of ['leisure-grove-foliage', 'leisure-grove-solid']) {
      const lm = leisureGrove?.group?.getObjectByName?.(lName);
      if (lm?.geometry?.attributes?.color) {
        leisureSnaps.push({
          name: lName,
          geo: lm.geometry,
          colors: new Float32Array(lm.geometry.attributes.color.array)
        });
      }
    }

    for (const mod of [habitatDetails, villageScenes, villageLife, exterior]) {
      mod?.group?.traverse?.(obj => {
        if (obj.isMesh && /-botanical$/.test(obj.name || '') && obj.geometry?.attributes?.color) {
          botanicalSnaps.push({
            geo: obj.geometry,
            colors: new Float32Array(obj.geometry.attributes.color.array)
          });
        }
      });
    }

    const ps = snapshotGeo(pondLife?.group?.getObjectByName?.('pond-life-surface'));
    if (ps) { pondSurfaceSnap.geo = ps.geo; pondSurfaceSnap.colors = ps.colors; }

    const dw = snapshotGeo(
      inkAtmosphere?.interiorGroup?.getObjectByName?.('pond-duckweed') ||
      inkAtmosphere?.group?.getObjectByName?.('pond-duckweed')
    );
    if (dw) { inkDuckweedSnap.geo = dw.geo; inkDuckweedSnap.colors = dw.colors; }

    const rt = inkAtmosphere?.group?.getObjectByName?.('ridge-ink-trees');
    if (rt?.instanceColor?.array) {
      inkRidgeSnap.mesh = rt;
      inkRidgeSnap.colors = new Float32Array(rt.instanceColor.array);
    }

    const sp = inkAtmosphere?.exteriorGroup?.getObjectByName?.('stream-drifting-petals') ||
      inkAtmosphere?.group?.getObjectByName?.('stream-drifting-petals');
    if (sp) {
      inkStreamPetalSnap.mesh = sp;
      inkStreamPetalSnap.count = sp.count;
      if (sp.instanceColor?.array) inkStreamPetalSnap.colors = new Float32Array(sp.instanceColor.array);
    }

    const seenCliffGeo = new Set();
    for (const cName of ['cliff-rocks', 'cliff-cap', 'cliff-back-peaks']) {
      const cm = cliff?.group?.getObjectByName?.(cName);
      if (cm?.geometry?.attributes?.color && !seenCliffGeo.has(cm.geometry)) {
        seenCliffGeo.add(cm.geometry);
        cliffSnaps.push({
          name: cName,
          geo: cm.geometry,
          colors: new Float32Array(cm.geometry.attributes.color.array)
        });
      }
    }
  }

  // Scratch colors (zero allocation in apply/update)
  const _c1 = new THREE.Color();
  const _c2 = new THREE.Color();
  const _c3 = new THREE.Color();
  const _c4 = new THREE.Color();

  const SNOW_GROUND = new THREE.Color('#E9E7DF');
  const SNOW_ROOF = new THREE.Color('#E6E4DC');
  const SNOW_PETAL = new THREE.Color('#F2F1EA');
  const SNOW_GRASS = new THREE.Color('#E6E5DD');

  // Precomputed palette colors (linear RGB)
  const PAL_SUMMER_GRASS = [new THREE.Color('#3A783F'), new THREE.Color('#478A4A'), new THREE.Color('#569A55')];
  const PAL_AUTUMN_GRASS = [new THREE.Color('#C8A34E'), new THREE.Color('#D6B55E'), new THREE.Color('#A68E48'), new THREE.Color('#BA8642')];
  const PAL_AUTUMN_HILL = [new THREE.Color('#A86E3E'), new THREE.Color('#8C5332')];

  const PAL_SUMMER_LEAF = [new THREE.Color('#285932'), new THREE.Color('#427E43'), new THREE.Color('#68A356')];
  const PAL_SUMMER_PEACH = (phenologySeasons.palettes?.flora?.summerFruit || ['#BED87A', '#DCE094'])
    .map(hex => new THREE.Color(hex));
  const PAL_AUTUMN_CROWN = [
    new THREE.Color('#C6462E'),
    new THREE.Color('#DF7632'),
    new THREE.Color('#EAA83C'),
    new THREE.Color('#B5492F')
  ];

  const PAL_SUMMER_FLOWERS = [new THREE.Color('#EF9836'), new THREE.Color('#7692D6'), new THREE.Color('#F6F7F0'), new THREE.Color('#E8869A')];
  const PAL_AUTUMN_FLOWERS = [new THREE.Color('#F2BC32'), new THREE.Color('#F9D65C'), new THREE.Color('#DA7236'), new THREE.Color('#EFE0A6')];
  const PAL_AUTUMN_MULBERRY = [new THREE.Color('#DFB13E'), new THREE.Color('#C89532'), new THREE.Color('#EBBE4C')];
  const PAL_AUTUMN_FALLEN = [new THREE.Color('#C84E32'), new THREE.Color('#E27E34'), new THREE.Color('#EAB442'), new THREE.Color('#B45A2E')];
  const PAL_SUMMER_FALLEN = [new THREE.Color('#84A85D'), new THREE.Color('#A4BC7A'), new THREE.Color('#6E9350')];

  const PAL_SUMMER_STREAM = [new THREE.Color('#DCEAD2'), new THREE.Color('#EBF3E4'), new THREE.Color('#C8DFB8')];
  const PAL_AUTUMN_STREAM = [new THREE.Color('#D65636'), new THREE.Color('#E89B3C'), new THREE.Color('#EFC24A'), new THREE.Color('#C4482D')];
  const PAL_WINTER_STREAM = [new THREE.Color('#F2F4F2'), new THREE.Color('#E4EAEB')];

  function restoreAllToSpring() {
    for (const item of floraSnaps) {
      item.geo.attributes.color.array.set(item.base);
      item.geo.attributes.color.needsUpdate = true;
    }
    if (reedSnap.mesh && reedSnap.colors) {
      reedSnap.mesh.instanceColor.array.set(reedSnap.colors);
      reedSnap.mesh.instanceColor.needsUpdate = true;
    }
    if (pondReedSnap.geo && pondReedSnap.colors) {
      pondReedSnap.geo.attributes.color.array.set(pondReedSnap.colors);
      pondReedSnap.geo.attributes.color.needsUpdate = true;
    }
    if (bambooSnap.geo && bambooSnap.colors) {
      bambooSnap.geo.attributes.color.array.set(bambooSnap.colors);
      bambooSnap.geo.attributes.color.needsUpdate = true;
    }
    if (cropSnap.mesh && cropSnap.geoColors) {
      cropSnap.mesh.geometry.attributes.color.array.set(cropSnap.geoColors);
      cropSnap.mesh.geometry.attributes.color.needsUpdate = true;
      if (cropSnap.instColors && cropSnap.mesh.instanceColor) {
        cropSnap.mesh.instanceColor.array.set(cropSnap.instColors);
        cropSnap.mesh.instanceColor.needsUpdate = true;
      }
    }
    if (villageFieldSnap.geo && villageFieldSnap.colors) {
      villageFieldSnap.geo.attributes.color.array.set(villageFieldSnap.colors);
      villageFieldSnap.geo.attributes.color.needsUpdate = true;
    }
    if (villageRoadSnap.geo && villageRoadSnap.colors) {
      villageRoadSnap.geo.attributes.color.array.set(villageRoadSnap.colors);
      villageRoadSnap.geo.attributes.color.needsUpdate = true;
    }
    if (villageSpurSnap.geo && villageSpurSnap.colors) {
      villageSpurSnap.geo.attributes.color.array.set(villageSpurSnap.colors);
      villageSpurSnap.geo.attributes.color.needsUpdate = true;
    }
    if (laneStoneSnap.mesh && laneStoneSnap.colors) {
      laneStoneSnap.mesh.instanceColor.array.set(laneStoneSnap.colors);
      laneStoneSnap.mesh.instanceColor.needsUpdate = true;
    }
    if (qianmoGroundSnap.geo && qianmoGroundSnap.colors) {
      qianmoGroundSnap.geo.attributes.color.array.set(qianmoGroundSnap.colors);
      qianmoGroundSnap.geo.attributes.color.needsUpdate = true;
    }
    if (hinterlandRoadSnap.geo && hinterlandRoadSnap.colors) {
      hinterlandRoadSnap.geo.attributes.color.array.set(hinterlandRoadSnap.colors);
      hinterlandRoadSnap.geo.attributes.color.needsUpdate = true;
    }
    if (exteriorRoadSnap.geo && exteriorRoadSnap.colors) {
      exteriorRoadSnap.geo.attributes.color.array.set(exteriorRoadSnap.colors);
      exteriorRoadSnap.geo.attributes.color.needsUpdate = true;
    }
    if (petalSnap.mesh) {
      petalSnap.mesh.material.color.setHex(petalSnap.colorHex);
      sky?.setMaterialBaseColor?.(petalSnap.mesh.material, petalSnap.mesh.material.color);
      petalSnap.mesh.material.opacity = petalSnap.opacity;
      petalSnap.mesh.count = petalSnap.count;
      if (petalSnap.instColors && petalSnap.mesh.instanceColor) {
        petalSnap.mesh.instanceColor.array.set(petalSnap.instColors);
        petalSnap.mesh.instanceColor.needsUpdate = true;
      }
    }
    if (fallenSnap.mesh) {
      fallenSnap.mesh.count = fallenSnap.count;
      if (fallenSnap.instColors && fallenSnap.mesh.instanceColor) {
        fallenSnap.mesh.instanceColor.array.set(fallenSnap.instColors);
        fallenSnap.mesh.instanceColor.needsUpdate = true;
      }
    }
    if (lotusMesh) lotusMesh.visible = false;
    if (groundSnap.geo && groundSnap.colors) {
      groundSnap.geo.attributes.color.array.set(groundSnap.colors);
      groundSnap.geo.attributes.color.needsUpdate = true;
    }
    if (roofSnap.mesh && roofSnap.colors) {
      roofSnap.mesh.instanceColor.array.set(roofSnap.colors);
      roofSnap.mesh.instanceColor.needsUpdate = true;
    }
    if (patchSnap.geo && patchSnap.colors) {
      patchSnap.geo.attributes.color.array.set(patchSnap.colors);
      patchSnap.geo.attributes.color.needsUpdate = true;
    }
    if (patchSnap.stems) {
      patchSnap.stems.visible = true;
      if (patchSnap.stemsColorHex !== null) patchSnap.stems.material.color.setHex(patchSnap.stemsColorHex);
    }
    if (patchSnap.heads) {
      patchSnap.heads.visible = true;
      if (patchSnap.headColors && patchSnap.heads.instanceColor) {
        patchSnap.heads.instanceColor.array.set(patchSnap.headColors);
        patchSnap.heads.instanceColor.needsUpdate = true;
      }
    }
    for (const ts of tuftSnaps) {
      ts.mesh.instanceColor.array.set(ts.colors);
      ts.mesh.instanceColor.needsUpdate = true;
      if (ts.flowerUniforms) {
        ts.flowerUniforms.uFlowerA.value.copy(ts.origFlowerA);
        ts.flowerUniforms.uFlowerB.value.copy(ts.origFlowerB);
        ts.flowerUniforms.uFlowerAmt.value = ts.origFlowerAmt;
      }
    }
    if (leafSnap.mesh) {
      leafSnap.mesh.visible = leafSnap.visible;
      if (leafSnap.colors && leafSnap.mesh.instanceColor) {
        leafSnap.mesh.instanceColor.array.set(leafSnap.colors);
        leafSnap.mesh.instanceColor.needsUpdate = true;
      }
    }
    if (mulberryCoreSnap.mesh) {
      mulberryCoreSnap.mesh.visible = mulberryCoreSnap.visible;
      if (mulberryCoreSnap.geo && mulberryCoreSnap.colors) {
        mulberryCoreSnap.geo.attributes.color.array.set(mulberryCoreSnap.colors);
        mulberryCoreSnap.geo.attributes.color.needsUpdate = true;
      }
    }
    if (staticSnap.geo && staticSnap.colors) {
      staticSnap.geo.attributes.color.array.set(staticSnap.colors);
      staticSnap.geo.attributes.color.needsUpdate = true;
    }
    if (stoneSnap.mesh && stoneSnap.colors) {
      stoneSnap.mesh.instanceColor.array.set(stoneSnap.colors);
      stoneSnap.mesh.instanceColor.needsUpdate = true;
    }
    if (rimSnap.mesh) rimSnap.mesh.visible = rimSnap.visible;
    if (propsSnap.geo && propsSnap.colors) {
      propsSnap.geo.attributes.color.array.set(propsSnap.colors);
      propsSnap.geo.attributes.color.needsUpdate = true;
    }
    for (const hs of hinterlandSnaps) {
      if (hs.instColors && hs.mesh.instanceColor) {
        hs.mesh.instanceColor.array.set(hs.instColors);
        hs.mesh.instanceColor.needsUpdate = true;
      }
      if (hs.geo && hs.geoColors) {
        hs.geo.attributes.color.array.set(hs.geoColors);
        hs.geo.attributes.color.needsUpdate = true;
      }
    }
    for (const ls of leisureSnaps) {
      ls.geo.attributes.color.array.set(ls.colors);
      ls.geo.attributes.color.needsUpdate = true;
    }
    for (const bs of botanicalSnaps) {
      bs.geo.attributes.color.array.set(bs.colors);
      bs.geo.attributes.color.needsUpdate = true;
    }
    if (pondSurfaceSnap.geo && pondSurfaceSnap.colors) {
      pondSurfaceSnap.geo.attributes.color.array.set(pondSurfaceSnap.colors);
      pondSurfaceSnap.geo.attributes.color.needsUpdate = true;
    }
    if (inkDuckweedSnap.geo && inkDuckweedSnap.colors) {
      inkDuckweedSnap.geo.attributes.color.array.set(inkDuckweedSnap.colors);
      inkDuckweedSnap.geo.attributes.color.needsUpdate = true;
    }
    if (inkRidgeSnap.mesh && inkRidgeSnap.colors) {
      inkRidgeSnap.mesh.instanceColor.array.set(inkRidgeSnap.colors);
      inkRidgeSnap.mesh.instanceColor.needsUpdate = true;
    }
    if (inkStreamPetalSnap.mesh) {
      inkStreamPetalSnap.mesh.count = inkStreamPetalSnap.count;
      if (inkStreamPetalSnap.colors && inkStreamPetalSnap.mesh.instanceColor) {
        inkStreamPetalSnap.mesh.instanceColor.array.set(inkStreamPetalSnap.colors);
        inkStreamPetalSnap.mesh.instanceColor.needsUpdate = true;
      }
    }
    for (const cs of cliffSnaps) {
      cs.geo.attributes.color.array.set(cs.colors);
      cs.geo.attributes.color.needsUpdate = true;
    }
  }

  // 共享水墨雪意函数：凹处留白积雪、凸脊微露草赭，terrain 与 ground-patch 在同一世界坐标共享一致覆雪率，消弭圆饼硬边
  function snowWashFactor(x, z, ny, syntheticFallback) {
    if (Math.abs(x) <= 2.5 && Math.abs(z) <= 2.5) {
      return syntheticFallback * clamp(ny, 0.1, 1);
    }
    const macro = 0.5 + 0.30 * Math.sin(x * 0.038 + z * 0.029 + 0.7) + 0.20 * Math.cos(x * 0.071 - z * 0.063 + 1.9);
    const brush = 0.5 + 0.32 * Math.sin((x * 0.82 - z * 0.57) * 0.14 + Math.cos(z * 0.05) * 1.4) + 0.18 * Math.cos((x * 0.45 + z * 0.89) * 0.23);
    const hCenter = sampleY(x, z);
    const hAvg = 0.25 * (sampleY(x + 3.2, z) + sampleY(x - 3.2, z) + sampleY(x, z + 3.2) + sampleY(x, z - 3.2));
    const concavity = clamp((hAvg - hCenter) * 0.85, -0.22, 0.26);
    const drift = clamp(0.38 + macro * 0.30 + brush * 0.16 + concavity, 0.24, 0.82);
    return drift * clamp(ny, 0.1, 1);
  }

  function applyGroundAndPaths(id) {
    // 1) 主地形草地与山坡设色
    if (groundSnap.geo && groundSnap.colors) {
      const dst = groundSnap.geo.attributes.color.array;
      const src = groundSnap.colors;
      const posArr = groundSnap.geo.attributes.position?.array;
      const norArr = groundSnap.geo.attributes.normal?.array;
      if (id === 'winter') {
        const useWorldDrift = Boolean(posArr && posArr.length >= 300);
        for (let i = 0; i < src.length; i += 3) {
          const ny = norArr ? norArr[i + 1] : 1;
          if (ny <= 0.1) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; continue; }
          const f = useWorldDrift ? snowWashFactor(posArr[i], posArr[i + 2], ny, 0.55) : (0.55 * clamp(ny, 0.1, 1));
          dst[i] = src[i] + (SNOW_GROUND.r - src[i]) * f;
          dst[i + 1] = src[i + 1] + (SNOW_GROUND.g - src[i + 1]) * f;
          dst[i + 2] = src[i + 2] + (SNOW_GROUND.b - src[i + 2]) * f;
        }
      } else {
        const isSum = id === 'summer';
        for (let i = 0; i < src.length; i += 3) {
          const sr = src[i], sg = src[i + 1], sb = src[i + 2];
          const py = posArr ? posArr[i + 1] : 2;
          const gDom = clamp((sg - sr - 0.024) * 9.0, 0, 1);
          if (gDom <= 0.001 || (posArr && py < waterY + 0.05)) {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
            continue;
          }
          const px = posArr ? posArr[i] : 0;
          const pz = posArr ? posArr[i + 2] : 0;
          const w1 = clamp(0.5 + 0.3 * Math.sin(px * 0.042 + pz * 0.036) + 0.2 * Math.cos(px * 0.095 - pz * 0.082), 0, 1);
          const lum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
          const detail = clamp(lum / 0.32, 0.68, 1.35);
          if (isSum) {
            _c1.copy(PAL_SUMMER_GRASS[0]).lerp(PAL_SUMMER_GRASS[2], w1);
            const tr = clamp(_c1.r * detail, 0, 1);
            const tg = clamp(_c1.g * detail, 0, 1);
            const tb = clamp(_c1.b * detail, 0, 1);
            dst[i] = lerp(sr, tr, gDom * 0.88);
            dst[i + 1] = lerp(sg, tg, gDom * 0.88);
            dst[i + 2] = lerp(sb, tb, gDom * 0.88);
          } else {
            // 秋：平坦草甸转为金黄/暖赭/霜橄榄，高坡转向浅绛赭石丹砂
            const idxA = w1 < 0.38 ? 0 : w1 < 0.72 ? 1 : 2;
            _c1.copy(PAL_AUTUMN_GRASS[idxA]).lerp(PAL_AUTUMN_GRASS[3], Math.abs(Math.sin(px * 0.028 - pz * 0.031)) * 0.55);
            if (py > 5.8) {
              const hillK = clamp((py - 5.8) / 7.5, 0, 1) * 0.68;
              _c2.copy(PAL_AUTUMN_HILL[0]).lerp(PAL_AUTUMN_HILL[1], w1);
              _c1.lerp(_c2, hillK);
            }
            const tr = clamp(_c1.r * detail, 0, 1);
            const tg = clamp(_c1.g * detail, 0, 1);
            const tb = clamp(_c1.b * detail, 0, 1);
            dst[i] = lerp(sr, tr, gDom * 0.90);
            dst[i + 1] = lerp(sg, tg, gDom * 0.90);
            dst[i + 2] = lerp(sb, tb, gDom * 0.90);
          }
        }
      }
      groundSnap.geo.attributes.color.needsUpdate = true;
    }

    // 2) 地贴色斑 (ground-patch)
    if (patchSnap.geo && patchSnap.colors) {
      const dst = patchSnap.geo.attributes.color.array;
      const src = patchSnap.colors;
      const nor = patchSnap.geo.attributes.normal?.array;
      const posArr = patchSnap.geo.attributes.position?.array;
      if (id === 'winter') {
        const useWorldDrift = Boolean(posArr && posArr.length >= 300);
        for (let i = 0; i < src.length; i += 3) {
          const ny = Math.abs(nor ? nor[i + 1] : 1);
          if (ny <= 0.1) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; continue; }
          const f = useWorldDrift ? snowWashFactor(posArr[i], posArr[i + 2], ny, 0.8) : (0.8 * clamp(ny, 0.1, 1));
          dst[i] = src[i] + (SNOW_GROUND.r - src[i]) * f;
          dst[i + 1] = src[i + 1] + (SNOW_GROUND.g - src[i + 1]) * f;
          dst[i + 2] = src[i + 2] + (SNOW_GROUND.b - src[i + 2]) * f;
        }
      } else {
        const isSum = id === 'summer';
        for (let i = 0; i < src.length; i += 3) {
          const sr = src[i], sg = src[i + 1], sb = src[i + 2];
          const gDom = clamp((sg - sr - 0.015) * 9.0, 0, 1);
          if (gDom <= 0.001) { dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb; continue; }
          const px = posArr ? posArr[i] : 0;
          const pz = posArr ? posArr[i + 2] : 0;
          const w1 = 0.5 + 0.5 * Math.sin(px * 0.06 + pz * 0.05);
          const lum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
          const detail = clamp(lum / 0.34, 0.72, 1.32);
          _c1.copy(isSum ? PAL_SUMMER_GRASS[0] : PAL_AUTUMN_GRASS[0]).lerp(isSum ? PAL_SUMMER_GRASS[2] : PAL_AUTUMN_GRASS[3], w1);
          dst[i] = lerp(sr, clamp(_c1.r * detail, 0, 1), gDom * 0.90);
          dst[i + 1] = lerp(sg, clamp(_c1.g * detail, 0, 1), gDom * 0.90);
          dst[i + 2] = lerp(sb, clamp(_c1.b * detail, 0, 1), gDom * 0.90);
        }
      }
      patchSnap.geo.attributes.color.needsUpdate = true;
    }

    // 3) 主村道、门前巷道、阡陌田道、后山小径与外溪步径四季分色（春基线 / 夏晴土润苔 / 秋赭土落叶辙 / 冬雪肩暗辙）
    applySeasonalRoadVertexColors(villageRoadSnap, id, { strongTracks: true });
    applySeasonalRoadVertexColors(villageSpurSnap, id, { strongTracks: false });
    applySeasonalRoadVertexColors(qianmoGroundSnap, id, { strongTracks: true });
    applySeasonalRoadVertexColors(hinterlandRoadSnap, id, { strongTracks: false });
    applySeasonalRoadVertexColors(exteriorRoadSnap, id, { strongTracks: false });

    // 路牙压边石四季质感（夏润青苔 / 秋枯赭暖 / 冬覆薄雪）
    if (laneStoneSnap.mesh && laneStoneSnap.colors) {
      const dst = laneStoneSnap.mesh.instanceColor.array;
      const src = laneStoneSnap.colors;
      for (let i = 0; i < src.length; i += 3) {
        if (id === 'winter') {
          dst[i] = lerp(src[i], SNOW_GROUND.r, 0.56);
          dst[i + 1] = lerp(src[i + 1], SNOW_GROUND.g, 0.56);
          dst[i + 2] = lerp(src[i + 2], SNOW_GROUND.b, 0.56);
        } else if (id === 'summer') {
          dst[i] = clamp(src[i] * 0.86, 0, 1);
          dst[i + 1] = clamp(src[i + 1] * 1.06 + 0.02, 0, 1);
          dst[i + 2] = clamp(src[i + 2] * 0.88, 0, 1);
        } else {
          dst[i] = clamp(src[i] * 1.08 + 0.03, 0, 1);
          dst[i + 1] = clamp(src[i + 1] * 0.96, 0, 1);
          dst[i + 2] = clamp(src[i + 2] * 0.82, 0, 1);
        }
      }
      laneStoneSnap.mesh.instanceColor.needsUpdate = true;
    }
  }

  function applyScatterTuftsAndFlowers(id) {
    for (const ts of tuftSnaps) {
      const dst = ts.mesh.instanceColor.array;
      const src = ts.colors;
      if (id === 'winter') {
        for (let i = 0; i < src.length; i += 3) {
          dst[i] = lerp(src[i], SNOW_GRASS.r, 0.74);
          dst[i + 1] = lerp(src[i + 1], SNOW_GRASS.g, 0.74);
          dst[i + 2] = lerp(src[i + 2], SNOW_GRASS.b, 0.74);
        }
      } else if (id === 'summer') {
        for (let i = 0, idx = 0; i < src.length; i += 3, idx++) {
          const lum = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
          const detail = clamp(lum / 0.34, 0.72, 1.32);
          const c = PAL_SUMMER_GRASS[idx % PAL_SUMMER_GRASS.length];
          dst[i] = clamp(c.r * detail, 0, 1);
          dst[i + 1] = clamp(c.g * detail, 0, 1);
          dst[i + 2] = clamp(c.b * detail, 0, 1);
        }
      } else {
        for (let i = 0, idx = 0; i < src.length; i += 3, idx++) {
          const lum = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
          const detail = clamp(lum / 0.34, 0.72, 1.32);
          const c = PAL_AUTUMN_GRASS[idx % PAL_AUTUMN_GRASS.length];
          dst[i] = clamp(c.r * detail, 0, 1);
          dst[i + 1] = clamp(c.g * detail, 0, 1);
          dst[i + 2] = clamp(c.b * detail, 0, 1);
        }
      }
      ts.mesh.instanceColor.needsUpdate = true;

      if (ts.flowerUniforms) {
        if (id === 'summer') {
          ts.flowerUniforms.uFlowerA.value.set('#F4F8EE');
          ts.flowerUniforms.uFlowerB.value.set('#B8DF88');
          ts.flowerUniforms.uFlowerAmt.value = 0.55;
        } else if (id === 'autumn') {
          ts.flowerUniforms.uFlowerA.value.set('#F2BE36');
          ts.flowerUniforms.uFlowerB.value.set('#DC7A38');
          ts.flowerUniforms.uFlowerAmt.value = 0.88;
        } else if (id === 'winter') {
          ts.flowerUniforms.uFlowerA.value.set('#F2F1EA');
          ts.flowerUniforms.uFlowerB.value.set('#E6E4DC');
          ts.flowerUniforms.uFlowerAmt.value = 0.0;
        }
      }
    }

    if (patchSnap.stems) {
      patchSnap.stems.visible = id !== 'winter';
      if (id === 'summer') patchSnap.stems.material.color.set('#3E7540');
      else if (id === 'autumn') patchSnap.stems.material.color.set('#8C7C42');
    }
    if (patchSnap.heads) {
      patchSnap.heads.visible = id !== 'winter';
      if (id !== 'winter' && patchSnap.headColors && patchSnap.heads.instanceColor) {
        const dst = patchSnap.heads.instanceColor.array;
        const pal = id === 'summer' ? PAL_SUMMER_FLOWERS : PAL_AUTUMN_FLOWERS;
        for (let i = 0, idx = 0; i < dst.length; i += 3, idx++) {
          const c = pal[idx % pal.length];
          dst[i] = c.r;
          dst[i + 1] = c.g;
          dst[i + 2] = c.b;
        }
        patchSnap.heads.instanceColor.needsUpdate = true;
      }
    }
  }

  function applyFloraAndPetals(id) {
    // 1) 武陵桃林：春粉霞 -> 夏浓绿荫点青桃 -> 秋丹枫柿橙金 -> 冬冠雪留墨枝
    for (const item of floraSnaps) {
      const dst = item.geo.attributes.color.array;
      const src = item.base;
      const mask = item.blossomMask;
      const budMask = item.budMask;
      const nor = item.geo.attributes.normal?.array;
      for (let v = 0, i = 0; v < mask.length; v++, i += 3) {
        const sr = src[i], sg = src[i + 1], sb = src[i + 2];
        if (!mask[v] && !budMask[v]) {
          dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          continue;
        }
        const ny = nor ? nor[i + 1] : 0.25;
        const srcLum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
        if (id === 'winter') {
          if (budMask[v]) {
            dst[i] = lerp(sr, 0.90, 0.62);
            dst[i + 1] = lerp(sg, 0.91, 0.62);
            dst[i + 2] = lerp(sb, 0.88, 0.62);
          } else {
            const lum = clamp(srcLum, 0.30, 0.78);
            const sel = (v * 7 + 3) % 10;
            if (sel < 7) {
              dst[i] = lerp(lum, 0.92, 0.78);
              dst[i + 1] = lerp(lum, 0.93, 0.78);
              dst[i + 2] = lerp(lum, 0.91, 0.76);
            } else {
              dst[i] = lerp(lum, 0.62, 0.68);
              dst[i + 1] = lerp(lum, 0.63, 0.68);
              dst[i + 2] = lerp(lum, 0.62, 0.68);
            }
          }
        } else if (id === 'summer') {
          if (budMask[v]) {
            _c1.copy(PAL_SUMMER_LEAF[1]);
            dst[i] = _c1.r; dst[i + 1] = _c1.g; dst[i + 2] = _c1.b;
          } else {
            const faceId = (v / 3) | 0;
            const cloudId = (v / 60) | 0;
            const isFruit = ((cloudId * 7 + faceId * 13) % 19 === 0) && ny > -0.15;
            if (isFruit) {
              const fc = PAL_SUMMER_PEACH[(cloudId + faceId) % 2];
              dst[i] = fc.r; dst[i + 1] = fc.g; dst[i + 2] = fc.b;
            } else {
              const tSun = clamp((ny * 0.5 + 0.5) * 0.68 + (srcLum - 0.35) * 0.85, 0, 1);
              if (tSun < 0.5) _c1.copy(PAL_SUMMER_LEAF[0]).lerp(PAL_SUMMER_LEAF[1], tSun * 2);
              else _c1.copy(PAL_SUMMER_LEAF[1]).lerp(PAL_SUMMER_LEAF[2], (tSun - 0.5) * 2);
              const shade = clamp(0.84 + (srcLum - 0.40) * 0.55, 0.74, 1.15);
              dst[i] = clamp(_c1.r * shade, 0, 1);
              dst[i + 1] = clamp(_c1.g * shade, 0, 1);
              dst[i + 2] = clamp(_c1.b * shade, 0, 1);
            }
          }
        } else {
          // autumn: 霜叶丹枫朱橙金
          if (budMask[v]) {
            _c1.copy(PAL_AUTUMN_CROWN[2]);
            dst[i] = _c1.r; dst[i + 1] = _c1.g; dst[i + 2] = _c1.b;
          } else {
            const faceId = (v / 3) | 0;
            const cloudId = (v / 60) | 0;
            const toneIdx = (cloudId * 5 + faceId) % PAL_AUTUMN_CROWN.length;
            _c1.copy(PAL_AUTUMN_CROWN[toneIdx]);
            const shade = clamp(0.76 + ny * 0.16 + (srcLum - 0.42) * 0.45, 0.66, 1.16);
            dst[i] = clamp(_c1.r * shade, 0, 1);
            dst[i + 1] = clamp(_c1.g * shade, 0, 1);
            dst[i + 2] = clamp(_c1.b * shade, 0, 1);
          }
        }
      }
      item.geo.attributes.color.needsUpdate = true;
    }

    // 2) 漫天飘落（落英 / 夏叶柳絮 / 秋红叶 / 冬薄雪），并同步更新 sky 注册材质底色防止被重置
    if (petalSnap.mesh) {
      if (id === 'winter') {
        petalSnap.mesh.material.color.set('#F2F1EA');
        petalSnap.mesh.material.opacity = 0.9;
        petalSnap.mesh.count = Math.max(40, Math.round(petalSnap.count * 0.6));
        if (petalSnap.instColors && petalSnap.mesh.instanceColor) {
          const dst = petalSnap.mesh.instanceColor.array;
          const src = petalSnap.instColors;
          for (let i = 0; i < src.length; i += 3) {
            dst[i] = src[i] * 0.15 + SNOW_PETAL.r * 0.85;
            dst[i + 1] = src[i + 1] * 0.15 + SNOW_PETAL.g * 0.85;
            dst[i + 2] = src[i + 2] * 0.15 + SNOW_PETAL.b * 0.85;
          }
          petalSnap.mesh.instanceColor.needsUpdate = true;
        }
      } else if (id === 'summer') {
        petalSnap.mesh.material.color.set('#DCEAD2');
        petalSnap.mesh.material.opacity = 0.84;
        petalSnap.mesh.count = Math.max(24, Math.round(petalSnap.count * 0.32));
        if (petalSnap.instColors && petalSnap.mesh.instanceColor) {
          petalSnap.mesh.instanceColor.array.set(petalSnap.instColors);
          petalSnap.mesh.instanceColor.needsUpdate = true;
        }
      } else {
        petalSnap.mesh.material.color.set('#E68E42');
        petalSnap.mesh.material.opacity = 0.94;
        petalSnap.mesh.count = Math.max(36, Math.round(petalSnap.count * 0.75));
        if (petalSnap.instColors && petalSnap.mesh.instanceColor) {
          petalSnap.mesh.instanceColor.array.set(petalSnap.instColors);
          petalSnap.mesh.instanceColor.needsUpdate = true;
        }
      }
      sky?.setMaterialBaseColor?.(petalSnap.mesh.material, petalSnap.mesh.material.color);
    }

    // 3) 树下地面落瓣/落叶/雪斑
    if (fallenSnap.mesh) {
      if (id === 'winter') {
        fallenSnap.mesh.count = Math.max(30, Math.round(fallenSnap.count * 0.55));
        if (fallenSnap.instColors && fallenSnap.mesh.instanceColor) {
          const dst = fallenSnap.mesh.instanceColor.array;
          const src = fallenSnap.instColors;
          for (let i = 0; i < src.length; i += 3) {
            dst[i] = clamp(src[i] * 0.25 + 0.94 * 0.75, 0, 1);
            dst[i + 1] = clamp(src[i + 1] * 0.25 + 0.93 * 0.75, 0, 1);
            dst[i + 2] = clamp(src[i + 2] * 0.25 + 0.90 * 0.75, 0, 1);
          }
          fallenSnap.mesh.instanceColor.needsUpdate = true;
        }
      } else if (id === 'summer') {
        fallenSnap.mesh.count = Math.max(20, Math.round(fallenSnap.count * 0.20));
        if (fallenSnap.instColors && fallenSnap.mesh.instanceColor) {
          const dst = fallenSnap.mesh.instanceColor.array;
          for (let i = 0, idx = 0; i < dst.length; i += 3, idx++) {
            const c = PAL_SUMMER_FALLEN[idx % PAL_SUMMER_FALLEN.length];
            dst[i] = c.r; dst[i + 1] = c.g; dst[i + 2] = c.b;
          }
          fallenSnap.mesh.instanceColor.needsUpdate = true;
        }
      } else {
        fallenSnap.mesh.count = Math.max(50, Math.round(fallenSnap.count * 0.92));
        if (fallenSnap.instColors && fallenSnap.mesh.instanceColor) {
          const dst = fallenSnap.mesh.instanceColor.array;
          for (let i = 0, idx = 0; i < dst.length; i += 3, idx++) {
            const c = PAL_AUTUMN_FALLEN[idx % PAL_AUTUMN_FALLEN.length];
            dst[i] = c.r; dst[i + 1] = c.g; dst[i + 2] = c.b;
          }
          fallenSnap.mesh.instanceColor.needsUpdate = true;
        }
      }
    }

    // 4) 溪上逐水落英 (inkAtmosphere stream-drifting-petals)
    if (inkStreamPetalSnap.mesh) {
      const m = inkStreamPetalSnap.mesh;
      if (id === 'summer') {
        m.count = Math.min(inkStreamPetalSnap.count, 64);
        if (inkStreamPetalSnap.colors && m.instanceColor) {
          const dst = m.instanceColor.array;
          for (let i = 0, idx = 0; i < dst.length; i += 3, idx++) {
            const c = PAL_SUMMER_STREAM[idx % PAL_SUMMER_STREAM.length];
            dst[i] = c.r; dst[i + 1] = c.g; dst[i + 2] = c.b;
          }
          m.instanceColor.needsUpdate = true;
        }
      } else if (id === 'autumn') {
        m.count = Math.min(inkStreamPetalSnap.count, 145);
        if (inkStreamPetalSnap.colors && m.instanceColor) {
          const dst = m.instanceColor.array;
          for (let i = 0, idx = 0; i < dst.length; i += 3, idx++) {
            const c = PAL_AUTUMN_STREAM[idx % PAL_AUTUMN_STREAM.length];
            dst[i] = c.r; dst[i + 1] = c.g; dst[i + 2] = c.b;
          }
          m.instanceColor.needsUpdate = true;
        }
      } else {
        m.count = Math.min(inkStreamPetalSnap.count, 48);
        if (inkStreamPetalSnap.colors && m.instanceColor) {
          const dst = m.instanceColor.array;
          for (let i = 0, idx = 0; i < dst.length; i += 3, idx++) {
            const c = PAL_WINTER_STREAM[idx % PAL_WINTER_STREAM.length];
            dst[i] = c.r; dst[i + 1] = c.g; dst[i + 2] = c.b;
          }
          m.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  function applyVillageAndWoods(id) {
    // 1) 外溪芦苇 & 村池芦苇
    if (reedSnap.mesh && reedSnap.colors) {
      const dst = reedSnap.mesh.instanceColor.array;
      const src = reedSnap.colors;
      if (id === 'winter') {
        for (let i = 0; i < src.length; i += 3) {
          dst[i] = src[i] * 0.45 + 0.80 * 0.55;
          dst[i + 1] = src[i + 1] * 0.45 + 0.78 * 0.55;
          dst[i + 2] = src[i + 2] * 0.45 + 0.70 * 0.55;
        }
      } else if (id === 'summer') {
        for (let i = 0; i < src.length; i += 3) {
          dst[i] = src[i] * 0.72;
          dst[i + 1] = Math.min(1, src[i + 1] * 1.12);
          dst[i + 2] = src[i + 2] * 0.80;
        }
      } else {
        for (let i = 0; i < src.length; i += 3) {
          dst[i] = Math.min(1, src[i] * 1.38 + 0.10);
          dst[i + 1] = Math.min(1, src[i + 1] * 1.08 + 0.04);
          dst[i + 2] = src[i + 2] * 0.62;
        }
      }
      reedSnap.mesh.instanceColor.needsUpdate = true;
    }

    if (pondReedSnap.geo && pondReedSnap.colors) {
      const dst = pondReedSnap.geo.attributes.color.array;
      const src = pondReedSnap.colors;
      for (let i = 0; i < src.length; i += 3) {
        if (id === 'winter') {
          dst[i] = lerp(src[i], 0.82, 0.58);
          dst[i + 1] = lerp(src[i + 1], 0.81, 0.58);
          dst[i + 2] = lerp(src[i + 2], 0.75, 0.58);
        } else if (id === 'summer') {
          dst[i] = src[i] * 0.74;
          dst[i + 1] = Math.min(1, src[i + 1] * 1.10);
          dst[i + 2] = src[i + 2] * 0.82;
        } else {
          dst[i] = Math.min(1, src[i] * 1.28 + 0.08);
          dst[i + 1] = Math.min(1, src[i + 1] * 1.02 + 0.03);
          dst[i + 2] = src[i + 2] * 0.65;
        }
      }
      pondReedSnap.geo.attributes.color.needsUpdate = true;
    }

    // 2) 竹林：夏苍翠、秋微玉绿（衬黄桑）、冬冠梢轻雪而竿叶留青
    if (bambooSnap.geo && bambooSnap.colors) {
      const dst = bambooSnap.geo.attributes.color.array;
      const src = bambooSnap.colors;
      const nor = bambooSnap.geo.attributes.normal?.array;
      for (let i = 0; i < src.length; i += 3) {
        if (id === 'winter') {
          const ny = nor ? nor[i + 1] : 0;
          const isLeafTop = ny > 0.20 && src[i + 1] > src[i] + 0.015;
          const f = isLeafTop ? 0.56 : (ny > 0.42 ? 0.24 : 0.0);
          const cr = src[i] * 0.82;
          const cg = src[i + 1] * 0.88;
          const cb = src[i + 2] * 0.92;
          dst[i] = lerp(cr, 0.91, f);
          dst[i + 1] = lerp(cg, 0.93, f);
          dst[i + 2] = lerp(cb, 0.91, f);
        } else if (id === 'summer') {
          dst[i] = src[i] * 0.78;
          dst[i + 1] = Math.min(1, src[i + 1] * 1.07);
          dst[i + 2] = src[i + 2] * 0.86;
        } else {
          dst[i] = src[i] * 0.92;
          dst[i + 1] = src[i + 1] * 0.96;
          dst[i + 2] = src[i + 2] * 0.88;
        }
      }
      bambooSnap.geo.attributes.color.needsUpdate = true;
    }

    // 3) 桑林：夏浓翠、秋黄桑（「桑榆晚黄」）、冬落叶留枯枝
    if (leafSnap.mesh) {
      leafSnap.mesh.visible = id !== 'winter';
      if (id !== 'winter' && leafSnap.colors && leafSnap.mesh.instanceColor) {
        const dst = leafSnap.mesh.instanceColor.array;
        const src = leafSnap.colors;
        for (let i = 0, idx = 0; i < src.length; i += 3, idx++) {
          if (id === 'summer') {
            dst[i] = src[i] * 0.72;
            dst[i + 1] = Math.min(1, src[i + 1] * 1.06);
            dst[i + 2] = src[i + 2] * 0.76;
          } else {
            const lum = clamp((0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / 0.32, 0.78, 1.24);
            const mc = PAL_AUTUMN_MULBERRY[idx % PAL_AUTUMN_MULBERRY.length];
            dst[i] = clamp(mc.r * lum, 0, 1);
            dst[i + 1] = clamp(mc.g * lum, 0, 1);
            dst[i + 2] = clamp(mc.b * lum, 0, 1);
          }
        }
        leafSnap.mesh.instanceColor.needsUpdate = true;
      }
    }
    if (mulberryCoreSnap.mesh) {
      mulberryCoreSnap.mesh.visible = id !== 'winter';
      if (id !== 'winter' && mulberryCoreSnap.geo && mulberryCoreSnap.colors) {
        const dst = mulberryCoreSnap.geo.attributes.color.array;
        const src = mulberryCoreSnap.colors;
        for (let i = 0; i < src.length; i += 3) {
          if (id === 'summer') {
            dst[i] = src[i] * 0.74;
            dst[i + 1] = Math.min(1, src[i + 1] * 1.06);
            dst[i + 2] = src[i + 2] * 0.78;
          } else {
            const lum = clamp((0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / 0.28, 0.75, 1.22);
            _c1.copy(PAL_AUTUMN_MULBERRY[1]);
            dst[i] = clamp(_c1.r * lum, 0, 1);
            dst[i + 1] = clamp(_c1.g * lum, 0, 1);
            dst[i + 2] = clamp(_c1.b * lum, 0, 1);
          }
        }
        mulberryCoreSnap.geo.attributes.color.needsUpdate = true;
      }
    }

    // 4) 良田作物（qin-han-millet-crops & village-fields）
    if (cropSnap.mesh && cropSnap.geoColors) {
      const gDst = cropSnap.mesh.geometry.attributes.color.array;
      const gSrc = cropSnap.geoColors;
      if (id === 'winter') {
        for (let i = 0; i < gSrc.length; i += 3) {
          const lum = 0.32 * gSrc[i] + 0.54 * gSrc[i + 1] + 0.14 * gSrc[i + 2];
          gDst[i] = clamp(0.62 + lum * 0.50, 0, 1);
          gDst[i + 1] = clamp(0.60 + lum * 0.48, 0, 1);
          gDst[i + 2] = clamp(0.52 + lum * 0.40, 0, 1);
        }
      } else if (id === 'summer') {
        for (let i = 0; i < gSrc.length; i += 3) {
          gDst[i] = gSrc[i] * 0.70;
          gDst[i + 1] = Math.min(1, gSrc[i + 1] * 1.16);
          gDst[i + 2] = gSrc[i + 2] * 0.84;
        }
      } else {
        for (let i = 0; i < gSrc.length; i += 3) {
          const lum = 0.32 * gSrc[i] + 0.54 * gSrc[i + 1] + 0.14 * gSrc[i + 2];
          gDst[i] = clamp(lum * 1.54 + 0.12, 0, 1);
          gDst[i + 1] = clamp(lum * 1.18 + 0.05, 0, 1);
          gDst[i + 2] = clamp(lum * 0.48 + 0.015, 0, 1);
        }
      }
      cropSnap.mesh.geometry.attributes.color.needsUpdate = true;

      if (cropSnap.instColors && cropSnap.mesh.instanceColor) {
        const iDst = cropSnap.mesh.instanceColor.array;
        const iSrc = cropSnap.instColors;
        if (id === 'winter') {
          for (let i = 0; i < iSrc.length; i += 3) {
            iDst[i] = iSrc[i] * 0.50 + 0.78 * 0.50;
            iDst[i + 1] = iSrc[i + 1] * 0.50 + 0.76 * 0.50;
            iDst[i + 2] = iSrc[i + 2] * 0.50 + 0.68 * 0.50;
          }
        } else if (id === 'summer') {
          for (let i = 0; i < iSrc.length; i += 3) {
            iDst[i] = iSrc[i] * 0.82;
            iDst[i + 1] = Math.min(1, iSrc[i + 1] * 1.10);
            iDst[i + 2] = iSrc[i + 2] * 0.88;
          }
        } else {
          for (let i = 0; i < iSrc.length; i += 3) {
            iDst[i] = Math.min(1, iSrc[i] * 1.20 + 0.06);
            iDst[i + 1] = Math.min(1, iSrc[i + 1] * 1.02 + 0.02);
            iDst[i + 2] = iSrc[i + 2] * 0.68;
          }
        }
        cropSnap.mesh.instanceColor.needsUpdate = true;
      }
    }

    if (villageFieldSnap.geo && villageFieldSnap.colors) {
      const dst = villageFieldSnap.geo.attributes.color.array;
      const src = villageFieldSnap.colors;
      for (let i = 0; i < src.length; i += 3) {
        const sr = src[i], sg = src[i + 1], sb = src[i + 2];
        const isCrop = sg > sr + 0.04;
        if (id === 'winter') {
          if (isCrop) {
            dst[i] = lerp(sr, 0.72, 0.68);
            dst[i + 1] = lerp(sg, 0.72, 0.68);
            dst[i + 2] = lerp(sb, 0.66, 0.68);
          } else {
            dst[i] = lerp(sr, SNOW_GROUND.r, 0.48);
            dst[i + 1] = lerp(sg, SNOW_GROUND.g, 0.48);
            dst[i + 2] = lerp(sb, SNOW_GROUND.b, 0.48);
          }
        } else if (id === 'summer') {
          if (isCrop) {
            dst[i] = sr * 0.62;
            dst[i + 1] = Math.min(1, sg * 1.05);
            dst[i + 2] = sb * 0.76;
          } else {
            dst[i] = sr * 0.94; dst[i + 1] = sg * 0.98; dst[i + 2] = sb * 0.94;
          }
        } else {
          if (isCrop) {
            dst[i] = clamp(sr * 2.15 + 0.14, 0, 1);
            dst[i + 1] = clamp(sg * 0.96 + 0.04, 0, 1);
            dst[i + 2] = sb * 0.44;
          } else {
            dst[i] = clamp(sr * 1.08, 0, 1);
            dst[i + 1] = clamp(sg * 1.02, 0, 1);
            dst[i + 2] = sb * 0.90;
          }
        }
      }
      villageFieldSnap.geo.attributes.color.needsUpdate = true;
    }

    // 5) 村舍茅顶、静态完成件、碎石、冰环
    if (roofSnap.mesh && roofSnap.colors) {
      const dst = roofSnap.mesh.instanceColor.array;
      const src = roofSnap.colors;
      if (id === 'winter') {
        for (let i = 0; i < src.length; i += 3) {
          dst[i] = src[i] + (SNOW_ROOF.r - src[i]) * 0.62;
          dst[i + 1] = src[i + 1] + (SNOW_ROOF.g - src[i + 1]) * 0.62;
          dst[i + 2] = src[i + 2] + (SNOW_ROOF.b - src[i + 2]) * 0.62;
        }
      } else {
        dst.set(src);
      }
      roofSnap.mesh.instanceColor.needsUpdate = true;
    }
    if (staticSnap.geo && staticSnap.colors) {
      const dst = staticSnap.geo.attributes.color.array;
      const src = staticSnap.colors;
      if (id === 'winter') {
        const nor = staticSnap.geo.attributes.normal?.array;
        for (let i = 0; i < src.length; i += 3) {
          const ny = Math.abs(nor ? nor[i + 1] : 1);
          if (ny <= 0.15) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; continue; }
          const f = 0.45 * clamp(ny, 0.15, 1);
          dst[i] = src[i] + (SNOW_GROUND.r - src[i]) * f;
          dst[i + 1] = src[i + 1] + (SNOW_GROUND.g - src[i + 1]) * f;
          dst[i + 2] = src[i + 2] + (SNOW_GROUND.b - src[i + 2]) * f;
        }
      } else {
        dst.set(src);
      }
      staticSnap.geo.attributes.color.needsUpdate = true;
    }
    if (stoneSnap.mesh && stoneSnap.colors) {
      const dst = stoneSnap.mesh.instanceColor.array;
      const src = stoneSnap.colors;
      if (id === 'winter') {
        for (let i = 0; i < src.length; i += 3) {
          dst[i] = src[i] + (SNOW_GROUND.r - src[i]) * 0.45;
          dst[i + 1] = src[i + 1] + (SNOW_GROUND.g - src[i + 1]) * 0.45;
          dst[i + 2] = src[i + 2] + (SNOW_GROUND.b - src[i + 2]) * 0.45;
        }
      } else {
        dst.set(src);
      }
      stoneSnap.mesh.instanceColor.needsUpdate = true;
    }
    if (rimSnap.mesh) rimSnap.mesh.visible = id === 'winter';

    // 6) 村落杂树与菜畦 (village-props)
    if (propsSnap.geo && propsSnap.colors) {
      const dst = propsSnap.geo.attributes.color.array;
      const src = propsSnap.colors;
      const posArr = propsSnap.geo.attributes.position?.array;
      const norArr = propsSnap.geo.attributes.normal?.array;
      for (let i = 0; i < src.length; i += 3) {
        const sr = src[i], sg = src[i + 1], sb = src[i + 2];
        const py = posArr ? posArr[i + 1] : 2;
        const ny = norArr ? norArr[i + 1] : 0.5;
        const isLeaf = (sg - sr > 0.06) && (sg - sb > 0.10);
        const isBloom = (sr - sg > 0.22) && sr > 0.55 && sb > 0.25;
        if (id === 'winter') {
          if (isLeaf || isBloom) {
            const f = isBloom ? 0.72 : 0.52;
            dst[i] = lerp(sr, SNOW_GROUND.r, f);
            dst[i + 1] = lerp(sg, SNOW_GROUND.g, f);
            dst[i + 2] = lerp(sb, SNOW_GROUND.b, f);
          } else if (ny > 0.45) {
            dst[i] = lerp(sr, SNOW_GROUND.r, 0.36 * ny);
            dst[i + 1] = lerp(sg, SNOW_GROUND.g, 0.36 * ny);
            dst[i + 2] = lerp(sb, SNOW_GROUND.b, 0.36 * ny);
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        } else if (id === 'summer') {
          if (isLeaf) {
            dst[i] = sr * 0.64;
            dst[i + 1] = Math.min(1, sg * 1.04);
            dst[i + 2] = sb * 0.72;
          } else if (isBloom) {
            // 村树春花转绿阴
            dst[i] = 0.09; dst[i + 1] = 0.25; dst[i + 2] = 0.08;
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        } else {
          // autumn: 树冠转银杏金 / 柿橙，春花转朱红，地面菜畦保常绿
          if (isBloom) {
            dst[i] = 0.58; dst[i + 1] = 0.10; dst[i + 2] = 0.04;
          } else if (isLeaf && py > 2.8) {
            const lum = clamp((0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / 0.30, 0.75, 1.25);
            const px = posArr ? posArr[i] : 0;
            const pz = posArr ? posArr[i + 2] : 0;
            const pick = ((Math.round(px * 0.2) + Math.round(pz * 0.2)) & 1) === 0 ? PAL_AUTUMN_MULBERRY[0] : PAL_AUTUMN_CROWN[1];
            dst[i] = clamp(pick.r * lum, 0, 1);
            dst[i + 1] = clamp(pick.g * lum, 0, 1);
            dst[i + 2] = clamp(pick.b * lum, 0, 1);
          } else if (isLeaf) {
            dst[i] = sr * 0.85; dst[i + 1] = sg * 0.94; dst[i + 2] = sb * 0.86;
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        }
      }
      propsSnap.geo.attributes.color.needsUpdate = true;
    }

    // 7) 后山林木与瓜棚 (hinterland)
    for (const hs of hinterlandSnaps) {
      if (hs.instColors && hs.mesh.instanceColor) {
        const dst = hs.mesh.instanceColor.array;
        const src = hs.instColors;
        const isFoliageBam = hs.name === 'hinterland-foliage-leaves';
        const isBox = hs.name === 'hinterland-box';
        const isFruit = hs.name === 'hinterland-fruit';
        for (let i = 0, idx = 0; i < src.length; i += 3, idx++) {
          const sr = src[i], sg = src[i + 1], sb = src[i + 2];
          if (id === 'winter') {
            if (isFoliageBam) {
              dst[i] = lerp(sr, 0.78, 0.28); dst[i + 1] = lerp(sg, 0.82, 0.28); dst[i + 2] = lerp(sb, 0.78, 0.28);
            } else {
              const f = isBox ? 0.56 : 0.58;
              dst[i] = lerp(sr, SNOW_ROOF.r, f);
              dst[i + 1] = lerp(sg, SNOW_ROOF.g, f);
              dst[i + 2] = lerp(sb, SNOW_ROOF.b, f);
            }
          } else if (id === 'summer') {
            if (isBox) { dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb; }
            else if (isFruit) { dst[i] = 0.22; dst[i + 1] = 0.39; dst[i + 2] = 0.10; }
            else {
              dst[i] = sr * 0.68;
              dst[i + 1] = Math.min(1, sg * 1.06);
              dst[i + 2] = sb * 0.74;
            }
          } else {
            if (isBox) { dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb; }
            else if (isFoliageBam) {
              dst[i] = sr * 0.92; dst[i + 1] = sg * 0.96; dst[i + 2] = sb * 0.86;
            } else if (isFruit) {
              dst[i] = 0.72; dst[i + 1] = 0.34; dst[i + 2] = 0.04;
            } else {
              const c = (idx % 3 === 0) ? PAL_AUTUMN_CROWN[1] : (idx % 3 === 1 ? PAL_AUTUMN_MULBERRY[0] : PAL_AUTUMN_CROWN[2]);
              const lum = clamp((0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / 0.28, 0.78, 1.22);
              dst[i] = clamp(c.r * lum, 0, 1);
              dst[i + 1] = clamp(c.g * lum, 0, 1);
              dst[i + 2] = clamp(c.b * lum, 0, 1);
            }
          }
        }
        hs.mesh.instanceColor.needsUpdate = true;
      }
    }

    // 8) 闲林古社大树与果园 (leisureGrove)
    for (const ls of leisureSnaps) {
      const dst = ls.geo.attributes.color.array;
      const src = ls.colors;
      const nor = ls.geo.attributes.normal?.array;
      if (ls.name === 'leisure-grove-foliage') {
        for (let i = 0; i < src.length; i += 3) {
          const sr = src[i], sg = src[i + 1], sb = src[i + 2];
          const ny = nor ? nor[i + 1] : 0.5;
          if (id === 'winter') {
            const f = ny > 0.2 ? 0.56 * clamp(ny, 0.2, 1) : 0.24;
            dst[i] = lerp(sr, SNOW_GROUND.r, f);
            dst[i + 1] = lerp(sg, SNOW_GROUND.g, f);
            dst[i + 2] = lerp(sb, SNOW_GROUND.b, f);
          } else if (id === 'summer') {
            dst[i] = sr * 0.68;
            dst[i + 1] = Math.min(1, sg * 1.06);
            dst[i + 2] = sb * 0.76;
          } else {
            const lum = clamp((0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / 0.25, 0.78, 1.24);
            _c1.copy(ny > 0.1 ? PAL_AUTUMN_MULBERRY[0] : PAL_AUTUMN_CROWN[1]);
            dst[i] = clamp(_c1.r * lum, 0, 1);
            dst[i + 1] = clamp(_c1.g * lum, 0, 1);
            dst[i + 2] = clamp(_c1.b * lum, 0, 1);
          }
        }
      } else {
        // leisure-grove-solid: 冬日覆亭顶薄雪
        if (id === 'winter') {
          for (let i = 0; i < src.length; i += 3) {
            const ny = nor ? nor[i + 1] : 0;
            const f = ny > 0.45 ? 0.46 * clamp(ny, 0.45, 1) : 0;
            dst[i] = lerp(src[i], SNOW_GROUND.r, f);
            dst[i + 1] = lerp(src[i + 1], SNOW_GROUND.g, f);
            dst[i + 2] = lerp(src[i + 2], SNOW_GROUND.b, f);
          }
        } else {
          dst.set(src);
        }
      }
      ls.geo.attributes.color.needsUpdate = true;
    }

    // 9) 生境蕨草与低矮草木 (*-botanical)
    for (const bs of botanicalSnaps) {
      const dst = bs.geo.attributes.color.array;
      const src = bs.colors;
      for (let i = 0; i < src.length; i += 3) {
        const sr = src[i], sg = src[i + 1], sb = src[i + 2];
        if (id === 'winter') {
          dst[i] = lerp(sr, SNOW_GROUND.r, 0.56);
          dst[i + 1] = lerp(sg, SNOW_GROUND.g, 0.56);
          dst[i + 2] = lerp(sb, SNOW_GROUND.b, 0.56);
        } else if (id === 'summer') {
          if (sg > sr + 0.025) {
            dst[i] = sr * 0.70; dst[i + 1] = Math.min(1, sg * 1.08); dst[i + 2] = sb * 0.78;
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        } else {
          if (sg > sr + 0.025) {
            dst[i] = clamp(sr * 1.65 + 0.08, 0, 1);
            dst[i + 1] = clamp(sg * 0.96 + 0.02, 0, 1);
            dst[i + 2] = sb * 0.55;
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        }
      }
      bs.geo.attributes.color.needsUpdate = true;
    }

    // 10) 美池原有浮荷、浮萍、山脊远树
    if (pondSurfaceSnap.geo && pondSurfaceSnap.colors) {
      const dst = pondSurfaceSnap.geo.attributes.color.array;
      const src = pondSurfaceSnap.colors;
      const nor = pondSurfaceSnap.geo.attributes.normal?.array;
      for (let i = 0; i < src.length; i += 3) {
        const sr = src[i], sg = src[i + 1], sb = src[i + 2];
        const isPetal = sr - sg > 0.14 && sr > 0.58;
        const isSeedpod = !isPetal && sr - sg > 0.08 && sr > 0.48 && sb < 0.25;
        if (id === 'winter') {
          // 冬池枯荷残蓬：彻底褪尽粉色花瓣与金蕊，化作霜覆焦墨莲蓬与枯褐残叶（「留得枯荷听雨声」）
          const ny = nor ? nor[i + 1] : 0.4;
          const frost = ny > 0.35 ? 0.34 * clamp(ny, 0.35, 1) : 0.06;
          if (isPetal || isSeedpod) {
            dst[i] = lerp(isSeedpod ? 0.20 : 0.25, SNOW_GROUND.r, frost);
            dst[i + 1] = lerp(isSeedpod ? 0.17 : 0.21, SNOW_GROUND.g, frost);
            dst[i + 2] = lerp(isSeedpod ? 0.13 : 0.17, SNOW_GROUND.b, frost);
          } else {
            const wr = clamp(sr * 0.96 + 0.05, 0, 1);
            const wg = clamp(sg * 0.62 + 0.03, 0, 1);
            const wb = clamp(sb * 0.52 + 0.02, 0, 1);
            dst[i] = lerp(wr, SNOW_GROUND.r, 0.32 + frost * 0.72);
            dst[i + 1] = lerp(wg, SNOW_GROUND.g, 0.32 + frost * 0.72);
            dst[i + 2] = lerp(wb, SNOW_GROUND.b, 0.32 + frost * 0.72);
          }
        } else if (id === 'summer') {
          if (isPetal || isSeedpod) {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          } else {
            dst[i] = sr * 0.72; dst[i + 1] = Math.min(1, sg * 1.06); dst[i + 2] = sb * 0.78;
          }
        } else {
          // autumn: 粉荷与莲蓬一并化作古铜枯荷与褐莲蓬
          if (isPetal || isSeedpod) {
            dst[i] = 0.24; dst[i + 1] = 0.16; dst[i + 2] = 0.07;
          } else {
            dst[i] = clamp(sr * 1.32 + 0.04, 0, 1);
            dst[i + 1] = clamp(sg * 0.82 + 0.02, 0, 1);
            dst[i + 2] = sb * 0.52;
          }
        }
      }
      pondSurfaceSnap.geo.attributes.color.needsUpdate = true;
    }

    if (inkDuckweedSnap.geo && inkDuckweedSnap.colors) {
      const dst = inkDuckweedSnap.geo.attributes.color.array;
      const src = inkDuckweedSnap.colors;
      for (let i = 0; i < src.length; i += 3) {
        if (id === 'winter') {
          dst[i] = lerp(src[i], 0.80, 0.52); dst[i + 1] = lerp(src[i + 1], 0.83, 0.52); dst[i + 2] = lerp(src[i + 2], 0.80, 0.52);
        } else if (id === 'summer') {
          dst[i] = src[i] * 0.78; dst[i + 1] = Math.min(1, src[i + 1] * 1.08); dst[i + 2] = src[i + 2] * 0.82;
        } else {
          dst[i] = clamp(src[i] * 1.22 + 0.05, 0, 1); dst[i + 1] = clamp(src[i + 1] * 0.90, 0, 1); dst[i + 2] = src[i + 2] * 0.55;
        }
      }
      inkDuckweedSnap.geo.attributes.color.needsUpdate = true;
    }

    if (inkRidgeSnap.mesh && inkRidgeSnap.colors) {
      const dst = inkRidgeSnap.mesh.instanceColor.array;
      const src = inkRidgeSnap.colors;
      for (let i = 0, idx = 0; i < src.length; i += 3, idx++) {
        if (id === 'winter') {
          dst[i] = clamp(src[i] * 0.95 + 0.06, 0, 1);
          dst[i + 1] = clamp(src[i + 1] * 0.98 + 0.06, 0, 1);
          dst[i + 2] = clamp(src[i + 2] * 1.02 + 0.08, 0, 1);
        } else if (id === 'summer') {
          dst[i] = src[i] * 0.80;
          dst[i + 1] = Math.min(1, src[i + 1] * 1.04);
          dst[i + 2] = src[i + 2] * 0.86;
        } else {
          if (idx % 9 < 4) {
            dst[i] = clamp(src[i] * 1.15 + 0.06, 0, 1);
            dst[i + 1] = src[i + 1] * 0.82;
            dst[i + 2] = src[i + 2] * 0.58;
          } else {
            dst[i] = src[i] * 0.90; dst[i + 1] = src[i + 1] * 0.94; dst[i + 2] = src[i + 2] * 0.86;
          }
        }
      }
      inkRidgeSnap.mesh.instanceColor.needsUpdate = true;
    }

    // 11) 中景峡壁与重峦危峰：冬日阳坡危崖覆薄雪（飞白见石骨），秋日山脚苔痕转赭暖，夏日山苔葱郁
    for (const cs of cliffSnaps) {
      const dst = cs.geo.attributes.color.array;
      const src = cs.colors;
      const nor = cs.geo.attributes.normal?.array;
      const pos = cs.geo.attributes.position?.array;
      for (let i = 0; i < src.length; i += 3) {
        const sr = src[i], sg = src[i + 1], sb = src[i + 2];
        const ny = nor ? nor[i + 1] : 0;
        const py = pos ? pos[i + 1] : 0;
        if (id === 'winter') {
          if (ny > 0.24 && py > -0.36) {
            const topLift = clamp((py + 0.36) / 1.15, 0.2, 1.0);
            const f = clamp((ny - 0.24) / 0.68, 0, 1) * (0.34 + 0.36 * topLift);
            dst[i] = lerp(sr, SNOW_GROUND.r, f);
            dst[i + 1] = lerp(sg, SNOW_GROUND.g, f);
            dst[i + 2] = lerp(sb, SNOW_GROUND.b, f);
          } else {
            dst[i] = sr * 0.94 + 0.03;
            dst[i + 1] = sg * 0.95 + 0.035;
            dst[i + 2] = sb * 0.98 + 0.045;
          }
        } else if (id === 'summer') {
          if (py < 0.05 && sg > sr) {
            dst[i] = sr * 0.86;
            dst[i + 1] = clamp(sg * 1.05, 0, 1);
            dst[i + 2] = sb * 0.90;
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        } else {
          // autumn: 崖脚苔色染微赭，峰顶仍留青黛石骨
          if (py < 0.08) {
            const w = clamp((0.08 - py) / 0.72, 0, 1) * 0.28;
            dst[i] = lerp(sr, PAL_AUTUMN_HILL[0].r, w);
            dst[i + 1] = lerp(sg, PAL_AUTUMN_HILL[0].g, w);
            dst[i + 2] = lerp(sb, PAL_AUTUMN_HILL[0].b, w);
          } else {
            dst[i] = sr; dst[i + 1] = sg; dst[i + 2] = sb;
          }
        }
      }
      cs.geo.attributes.color.needsUpdate = true;
    }
  }

  function applyPhenologyVisuals(id) {
    ensureSnapshots();

    // 先切换池荷、三季风物层与四季专属道路 3D 建模装饰层显隐
    if (vignettes.springMesh) vignettes.springMesh.visible = id === 'spring';
    if (vignettes.summerMesh) vignettes.summerMesh.visible = id === 'summer';
    if (vignettes.autumnMesh) vignettes.autumnMesh.visible = id === 'autumn';
    roadDressing.setSeason(id);

    if (lotusMesh && lotusBundle) {
      if (id === 'summer') {
        lotusBundle.geo.attributes.color.array.set(lotusBundle.summerColors);
        lotusBundle.geo.attributes.color.needsUpdate = true;
        lotusMesh.visible = true;
      } else if (id === 'autumn') {
        lotusBundle.geo.attributes.color.array.set(lotusBundle.autumnColors);
        lotusBundle.geo.attributes.color.needsUpdate = true;
        lotusMesh.visible = true;
      } else {
        lotusMesh.visible = false;
      }
    }

    // 同步关联系统（天光、树冠透光、远山、秦汉水田、谷地边野、外山幽境、武陵外郊、老牛冬歇、四时流转）
    sky?.setPhenology?.(id);
    floraWind?.setPhenology?.(id);
    mountains?.setPhenology?.(id);
    qinHanCompletion?.setPhenology?.(id);
    valleyBorderlands?.setPhenology?.(id, sky?.timeId || 'day');
    outerWilds?.setPhenology?.(id);
    deepHollows?.setPhenology?.(id);
    wildsEasterEggs?.setPhenology?.(id);
    wulingOutskirts?.setPhenology?.(id);
    oxPlowing?.setPhenology?.(id);
    seasonalCycle?.setPhenology?.(id);

    if (id === 'spring') {
      restoreAllToSpring();
      return;
    }

    applyGroundAndPaths(id);
    applyScatterTuftsAndFlowers(id);
    applyFloraAndPetals(id);
    applyVillageAndWoods(id);
  }

  // HUD pill injection (#sky-phenology-row / #sky-phenology) & toast feedback
  let phenEl = doc?.getElementById?.('sky-phenology') || null;
  let phenRow = doc?.getElementById?.('sky-phenology-row') || phenEl?.parentNode || null;
  let toastTimer = null;
  if (!phenEl && doc?.getElementById) {
    const skyHud = doc.getElementById('sky');
    if (skyHud && doc.createElement) {
      const row = doc.createElement('div');
      row.id = 'sky-phenology-row';
      row.className = 'sky__row';
      const kSpan = doc.createElement('span');
      kSpan.className = 'sky__k';
      kSpan.textContent = '物候';
      phenEl = doc.createElement('span');
      phenEl.className = 'sky__v';
      phenEl.id = 'sky-phenology';
      phenEl.textContent = PHENOLOGY_MODES[0].short;
      const keySpan = doc.createElement('span');
      keySpan.className = 'key';
      keySpan.textContent = 'K';
      row.appendChild(kSpan);
      row.appendChild(phenEl);
      row.appendChild(keySpan);
      skyHud.appendChild(row);
      phenRow = row;
    }
  }
  const phenClickTarget = phenRow || phenEl;

  function syncHud(showToast = false) {
    const cur = PHENOLOGY_MODES[modeIndex];
    const tip = `当前物候：${cur.label}（按 K 或点击切换：春深落英 / 夏初新荷 / 秋熟金粟 / 冬寂薄雪）`;
    if (phenEl) {
      phenEl.textContent = cur.short;
      phenEl.title = tip;
    }
    if (phenRow) {
      phenRow.title = tip;
    }
    if (showToast && doc?.getElementById) {
      const toastEl = doc.getElementById('sky-toast');
      if (toastEl) {
        toastEl.textContent = cur.toast;
        toastEl.classList?.add?.('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          toastEl.classList?.remove?.('show');
        }, 2400);
      }
    }
  }
  syncHud(false);

  function setPhenology(id, showToast = false) {
    const idx = PHENOLOGY_MODES.findIndex(m => m.id === id || m.short === id || m.label === id);
    if (idx < 0) return false;
    if (idx === modeIndex && idx === 0 && !snapshotted) {
      syncHud(showToast);
      return true;
    }
    modeIndex = idx;
    applyPhenologyVisuals(PHENOLOGY_MODES[modeIndex].id);
    syncHud(showToast);
    return true;
  }

  function cyclePhenology(dir = 1, showToast = true) {
    const next = (modeIndex + dir + PHENOLOGY_MODES.length) % PHENOLOGY_MODES.length;
    return setPhenology(PHENOLOGY_MODES[next].id, showToast);
  }

  const initialSeason = readInitialSeason(win);
  if (initialSeason && initialSeason !== 'spring') {
    setPhenology(initialSeason, false);
  }

  function onPhenRowClick(e) {
    if (disposed || isModalBlocked(doc) || doc?.body?.classList?.contains?.('ui-hidden')) return;
    e?.stopPropagation?.();
    cyclePhenology(1, true);
  }

  if (phenClickTarget && typeof phenClickTarget.addEventListener === 'function') {
    if (phenClickTarget.style) {
      phenClickTarget.style.cursor = 'pointer';
      phenClickTarget.style.pointerEvents = 'auto';
    }
    phenClickTarget.addEventListener('click', onPhenRowClick);
  }

  function onKeyDown(e) {
    if (disposed || e.code !== 'KeyK' || e.repeat || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isControlTarget(e.target) || isModalBlocked(doc)) return;
    e.preventDefault?.();
    cyclePhenology(1, true);
  }
  win?.addEventListener?.('keydown', onKeyDown);

  const _dummy = new THREE.Object3D();
  const _mistDawn = new THREE.Color('#B8C8BE');
  const _mistDusk = new THREE.Color('#8C7A6C');
  const _mistNight = new THREE.Color('#2B3944');
  const _mistRain = new THREE.Color('#AEBDBC');
  const _fogTmp = new THREE.Color();
  let mistAlpha = 0;

  function update(dt, elapsed, liveSky = sky) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(0.1, dt);
    simTime += step;

    if (lotusMesh && lotusMesh.visible && pond) {
      const wind = Number(liveSky?.wind ?? 0.25);
      const e = lotusMesh.matrix.elements;
      e[4] = Math.sin(simTime * 1.15) * (0.012 + wind * 0.016);
      e[6] = Math.cos(simTime * 0.92) * (0.009 + wind * 0.012);
      lotusMesh.matrixWorldNeedsUpdate = true;
    }

    const timeId = liveSky?.timeId || 'day';
    const curPhenId = PHENOLOGY_MODES[modeIndex].id;
    valleyBorderlands?.syncAtmosphere?.(curPhenId, timeId);
    const weatherId = liveSky?.weatherId || 'clear';
    const rain = Number(liveSky?.rainIntensity ?? 0);
    const snow = Number(liveSky?.snowIntensity ?? (weatherId === 'snow' ? 1 : 0));
    const windX = Number(liveSky?.windX ?? 0.12);
    const windZ = Number(liveSky?.windZ ?? 0.06);
    const wetAir = weatherId === 'mist' || rain > 0.08 || snow > 0.18;

    // 冬日开启「雪」天气时，压减桃花树下残瓣改色薄雪透明度，让 2600 枚漫天飞雪居主视觉；雪歇则恢复 0.90
    if (curPhenId === 'winter' && petalSnap.mesh) {
      const targetPetalOp = snow > 0.02 ? 0.9 * (1 - clamp(snow, 0, 1) * 0.62) : 0.9;
      if (Math.abs(petalSnap.mesh.material.opacity - targetPetalOp) > 1e-4) {
        petalSnap.mesh.material.opacity = targetPetalOp;
      }
    }

    let targetAlpha = 0;
    if (timeId === 'dawn') targetAlpha = 0.22;
    else if (timeId === 'dusk') targetAlpha = 0.14;
    else if (timeId === 'night') targetAlpha = 0.10;
    if (weatherId === 'mist') targetAlpha = Math.max(targetAlpha, 0.26);
    if (rain > 0.08) targetAlpha = Math.min(0.30, Math.max(targetAlpha, 0.12 + rain * 0.16));
    if (snow > 0.08) targetAlpha = Math.min(0.26, Math.max(targetAlpha, 0.10 + snow * 0.14));
    const postRainBoost = Number(seasonalCycle?.getPostRainBoost?.() ?? 0);
    if (postRainBoost > 0) targetAlpha = Math.max(targetAlpha, 0.25 * postRainBoost);

    if (curPhenId === 'autumn' && targetAlpha > 0) {
      targetAlpha = Math.min(0.32, targetAlpha * 1.12);
    }

    const rate = targetAlpha > mistAlpha ? 1.8 : 1.4;
    mistAlpha += (targetAlpha - mistAlpha) * (1 - Math.exp(-rate * step));

    if (mistAlpha <= 0.008) {
      mistMesh.visible = false;
      return;
    }

    mistMesh.visible = true;
    const u = mistMat.uniforms;
    u.uOpacity.value = mistAlpha;
    u.uTime.value = simTime;

    let visualGain = 0.28;
    if (wetAir) visualGain = 0.42;
    else if (timeId === 'dusk') visualGain = 0.10;
    else if (timeId === 'night') visualGain = 0.07;
    u.uVisualGain.value = visualGain;

    const sceneFog = group.parent?.fog;
    if (sceneFog?.color) {
      u.uFogColor.value.copy(sceneFog.color);
      if (Number.isFinite(sceneFog.near)) u.uFogNear.value = sceneFog.near;
      if (Number.isFinite(sceneFog.far)) u.uFogFar.value = sceneFog.far;
      _fogTmp.copy(sceneFog.color);
      if (timeId === 'night' && !wetAir) {
        _fogTmp.lerp(_mistNight, 0.55).multiplyScalar(0.68);
      } else if (timeId === 'dusk' && !wetAir) {
        _fogTmp.lerp(_mistDusk, 0.48).multiplyScalar(0.76);
      } else if (rain > 0.25) {
        _fogTmp.lerp(_mistRain, 0.30);
      } else {
        _fogTmp.lerp(_mistDawn, 0.25);
      }
      u.uColor.value.copy(_fogTmp);
    } else {
      const fallback = rain > 0.25
        ? _mistRain
        : (timeId === 'dusk' ? _mistDusk : (timeId === 'night' ? _mistNight : _mistDawn));
      u.uColor.value.copy(fallback);
      u.uFogColor.value.copy(fallback);
    }

    const groundArr = mistGroundAttr.array;
    const envArr = mistEnvAttr.array;
    for (let i = 0; i < MIST_COUNT; i++) {
      const b = mistBands[i];
      const phaseU = ((simTime * b.speed * 0.085 + b.phase / TAU) % 1 + 1) % 1;
      const travel = (phaseU - 0.5) * b.span;
      const edgeEnv = Math.sin(phaseU * Math.PI);
      const sway = Math.sin(simTime * 0.42 + b.phase) * 1.15;
      const x = b.cx + b.dx * travel - b.dz * sway + windX * Math.sin(simTime * 0.3 + i) * 0.8;
      const z = b.cz + b.dz * travel + b.dx * sway + windZ * Math.cos(simTime * 0.3 + i) * 0.8;

      const curLen = b.len * (0.72 + 0.34 * edgeEnv);
      const curH = b.height * (0.70 + 0.36 * edgeEnv);
      const halfSpan = curLen * 0.42;
      const gMax = Math.max(
        waterY,
        sampleY(x, z),
        sampleY(x - halfSpan, z),
        sampleY(x + halfSpan, z),
        sampleY(x, z - halfSpan),
        sampleY(x, z + halfSpan)
      );
      const y = gMax + curH * 0.55 + b.hoverY + Math.sin(simTime * 0.55 + b.phase) * 0.14;

      groundArr[i] = gMax;
      envArr[i] = edgeEnv;

      _dummy.position.set(x, y, z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(curLen, curH, 1);
      _dummy.updateMatrix();
      mistMesh.setMatrixAt(i, _dummy.matrix);
    }
    mistGroundAttr.needsUpdate = true;
    mistEnvAttr.needsUpdate = true;
    mistMesh.instanceMatrix.needsUpdate = true;
  }

  function getStats() {
    let drawCalls = 0;
    let triangles = 0;
    if (lotusMesh?.visible) {
      drawCalls += 1;
      triangles += lotusMesh.geometry.attributes.position.count / 3;
    }
    if (mistMesh.visible) {
      drawCalls += 1;
      triangles += (mistGeo.index.count / 3) * MIST_COUNT;
    }
    let vignetteVisible = null;
    if (interiorGroup.visible !== false) {
      for (const m of [vignettes.springMesh, vignettes.summerMesh, vignettes.autumnMesh]) {
        if (m?.visible) {
          drawCalls += 1;
          triangles += m.geometry.attributes.position.count / 3;
          vignetteVisible = m.name;
        }
      }
    }
    const roadStats = roadDressing.getStats();
    let roadDressingVisible = null;
    const curId = PHENOLOGY_MODES[modeIndex].id;
    const curIntRoad = roadDressing.interiorMeshes[curId];
    const curExtRoad = roadDressing.exteriorMeshes[curId];
    if (interiorGroup.visible !== false && curIntRoad?.visible) {
      drawCalls += 1;
      triangles += curIntRoad.geometry.attributes.position.count / 3;
      roadDressingVisible = curIntRoad.name;
    }
    if (exteriorGroup.visible !== false && curExtRoad?.visible) {
      drawCalls += 1;
      triangles += curExtRoad.geometry.attributes.position.count / 3;
      if (!roadDressingVisible) roadDressingVisible = curExtRoad.name;
    }
    return {
      phenologyId: PHENOLOGY_MODES[modeIndex].id,
      phenologyLabel: PHENOLOGY_MODES[modeIndex].label,
      lotusVisible: Boolean(lotusMesh?.visible),
      vignetteVisible,
      roadDressingVisible,
      roadDressingTris: roadStats.triangles,
      mistVisible: mistMesh.visible,
      mistOpacity: +mistAlpha.toFixed(3),
      mistBandCount: MIST_COUNT,
      drawCalls,
      triangles: Math.round(triangles),
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (toastTimer) clearTimeout(toastTimer);
    win?.removeEventListener?.('keydown', onKeyDown);
    phenClickTarget?.removeEventListener?.('click', onPhenRowClick);
    lotusBundle?.geo?.dispose?.();
    lotusMat?.dispose?.();
    vignettes.dispose();
    roadDressing.dispose();
    mistGeo.dispose();
    mistMat.dispose();
    group.removeFromParent();
  }

  return {
    group,
    interiorGroup,
    exteriorGroup,
    get currentId() { return PHENOLOGY_MODES[modeIndex].id; },
    setPhenology,
    cyclePhenology,
    update,
    getStats,
    dispose
  };
}
