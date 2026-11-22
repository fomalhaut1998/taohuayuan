// 落英风丝 · 夜萤寻津：舆图「所往」诗意内生轻引系统（单 InstancedMesh · 22 实例 · 洞口智能寻津 · 无目标 0 Draw Call）
import * as THREE from 'three';

const TAU = Math.PI * 2;
const PI = Math.PI;
const INSTANCE_COUNT = 22;
const PETAL_INSTANCES = 15;
const ARRIVAL_RADIUS = 8.5;
const ARC_START_DIST = 2.6;
const ARC_END_DIST = 13.5;

function lcg(seed) {
  let s = (seed >>> 0) || 1;
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

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

const WAYFINDER_VERT = /* glsl */`
attribute float aKind;
attribute float aSeed;
attribute float aAlpha;

uniform float uNightMode;
uniform float uTime;

varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vAlpha;

void main() {
  vUv = uv;
  vKind = aKind;
  vSeed = aSeed;
  vAlpha = aAlpha;

  #ifdef USE_INSTANCING
    mat4 instMat = modelMatrix * instanceMatrix;
  #else
    mat4 instMat = modelMatrix;
  #endif

  vec3 dayWorldPos = (instMat * vec4(position, 1.0)).xyz;
  vec3 centerWorld = instMat[3].xyz;

  // 夜萤模式：朝向相机的柔光球面微片，任何视角下皆圆润通透无硬边
  vec3 toCam = cameraPosition - centerWorld;
  float camDist = max(length(toCam), 0.001);
  vec3 fwd = toCam / camDist;
  vec3 worldUp = abs(fwd.y) > 0.97 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 rightDir = normalize(cross(worldUp, fwd));
  vec3 upDir = cross(fwd, rightDir);

  float fireflyScale = 0.19 + 0.06 * sin(uTime * 2.2 + aSeed * 12.566);
  vec3 nightWorldPos = centerWorld
    + rightDir * (position.x * fireflyScale * 2.0)
    + upDir * (position.z * fireflyScale * 2.0);

  float nightBlend = smoothstep(0.32, 0.68, uNightMode);
  vec3 worldPos = mix(dayWorldPos, nightWorldPos, nightBlend);

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const WAYFINDER_FRAG = /* glsl */`
uniform float uTime;
uniform float uOpacity;
uniform float uNightMode;
uniform vec3 uPetalColorA;
uniform vec3 uPetalColorB;
uniform vec3 uWispColor;
uniform vec3 uFireflyCore;
uniform vec3 uFireflyHalo;

varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vAlpha;

void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float r2 = dot(q, q);
  if (r2 >= 0.98) discard;

  // ---- 昼 / 晨 / 暮：落英花瓣 (vKind < 0.5) 与 轻风素丝 (vKind >= 0.5) ----
  vec3 dayCol = uPetalColorA;
  float dayAlpha = 0.0;

  if (vKind < 0.5) {
    // 微凹桃瓣：尖端微缺刻（花瓣心形凹口）、基部收窄，边缘柔化无方片感
    float notch = 0.14 * exp(-pow(q.x * 4.5, 2.0)) * smoothstep(0.15, 0.85, q.y);
    float widthEnv = mix(0.55, 1.02, smoothstep(-0.9, 0.25, q.y));
    vec2 pq = vec2(q.x / max(widthEnv, 0.25), q.y + notch);
    float dPetal = length(pq);
    float mask = 1.0 - smoothstep(0.66, 0.96, dPetal);
    float vein = smoothstep(-0.75, 0.75, q.y);
    dayCol = mix(uPetalColorA, uPetalColorB, vein);
    dayAlpha = mask * 0.86;
  } else {
    // 随风轻丝：沿行进切向舒展的半透明流岚丝缕
    float coreCross = exp(-pow(q.x * 3.6, 2.0));
    float alongEnv = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159265);
    float wave = 0.72 + 0.28 * sin(vUv.y * 9.0 - uTime * 3.4 + vSeed * 15.7);
    dayCol = mix(uPetalColorB, uWispColor, 0.68);
    dayAlpha = coreCross * pow(max(alongEnv, 0.0), 0.85) * wave * 0.36;
  }

  // ---- 夜：寻津流萤（翠珀双色柔光，内实外晕，呼吸明灭） ----
  float dist = sqrt(r2);
  float core = exp(-dist * dist * 16.0);
  float halo = pow(max(0.0, 1.0 - r2), 2.6) * 0.58;
  float blink = 0.40 + 0.60 * pow(0.5 + 0.5 * sin(uTime * 2.5 + vSeed * 18.8495), 2.0);
  vec3 fireflyTint = mix(uFireflyHalo, uFireflyCore, clamp(core * 1.15 + 0.25 * sin(vSeed * 31.4), 0.0, 1.0));
  vec3 nightCol = fireflyTint * (0.75 + 0.65 * core);
  float nightAlpha = (core + halo) * blink * 0.92;

  float nightMix = smoothstep(0.35, 0.65, uNightMode);
  vec3 finalCol = mix(dayCol, nightCol, nightMix);
  float finalAlpha = mix(dayAlpha, nightAlpha, nightMix) * vAlpha * uOpacity;

  if (finalAlpha < 0.003) discard;

  gl_FragColor = vec4(finalCol, finalAlpha);
  #include <colorspace_fragment>
}
`;

/**
 * 构建每实例精确 4 个三角形（6 顶点双段微拱曲面）的轻巧花瓣/风丝基底几何。
 */
function buildCurvedPetalWispGeometry(count, rand) {
  // 局部空间：X ∈ [-0.5, 0.5] 横宽，Z ∈ [-0.5, 0.5] 纵长，Y 微拱弧度
  const positions = new Float32Array([
    -0.5,  0.025, -0.5, // 0: 尾左
     0.5,  0.025, -0.5, // 1: 尾右
    -0.5, -0.032,  0.0, // 2: 腰左（微凹花腹）
     0.5, -0.032,  0.0, // 3: 腰右
    -0.5,  0.030,  0.5, // 4: 尖左
     0.5,  0.030,  0.5  // 5: 尖右
  ]);

  const uvs = new Float32Array([
    0.0, 0.0,
    1.0, 0.0,
    0.0, 0.5,
    1.0, 0.5,
    0.0, 1.0,
    1.0, 1.0
  ]);

  // 4 个三角形 = 12 个索引
  const indices = [
    0, 2, 1,
    1, 2, 3,
    2, 4, 3,
    3, 4, 5
  ];

  const kinds = new Float32Array(count);
  const seeds = new Float32Array(count);
  const alphas = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // 交错排布 15 枚桃瓣与 7 缕轻风丝，使整道风径疏密相间
    kinds[i] = i < PETAL_INSTANCES ? 0.0 : 1.0;
    seeds[i] = rand();
    alphas[i] = 0.0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const alphaAttr = new THREE.InstancedBufferAttribute(alphas, 1);
  alphaAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAlpha', alphaAttr);

  return { geo, alphaAttr, kinds, seeds };
}

export function createPoeticWayfinder({
  world,
  field,
  cliff,
  map,
  player: initPlayer = null,
  sky: initSky = null,
  village = null,
  qianmoPaths = null,
  hinterland = null,
  valleyBorderlands = null,
  outerWilds = null,
  deepHollows = null,
  exterior = null,
  act3Finale = null,
  godFlight = null
} = {}) {
  const rand = lcg(20261116);

  const cliffCenter = Array.isArray(world?.cliff?.center) ? world.cliff.center : [30, -140];
  const cliffCx = Number.isFinite(cliffCenter[0]) ? cliffCenter[0] : 30;
  const cliffCz = Number.isFinite(cliffCenter[1]) ? cliffCenter[1] : -140;
  const cliffR = Number.isFinite(world?.cliff?.radius) ? world.cliff.radius : 132;
  const cliffArcFrom = Number.isFinite(world?.cliff?.arcFrom) ? world.cliff.arcFrom : 0.55;
  const cliffFlankZ = cliffCz + Math.sin(cliffArcFrom) * cliffR;

  const slitX = Number.isFinite(cliff?.slit?.x)
    ? cliff.slit.x
    : (Array.isArray(world?.cliff?.slit) ? world.cliff.slit[0] : 23);
  const slitZ = Number.isFinite(cliff?.slit?.z)
    ? cliff.slit.z
    : (Array.isArray(world?.cliff?.slit) ? world.cliff.slit[1] : -10);

  const slitDx = slitX - cliffCx;
  const slitDz = slitZ - cliffCz;
  const slitRadLen = Math.hypot(slitDx, slitDz) || 1;
  const slitUx = slitDx / slitRadLen;
  const slitUz = slitDz / slitRadLen;

  const hasWaterFloor = Number.isFinite(world?.terrain?.waterLevel);
  const waterLevel = hasWaterFloor ? world.terrain.waterLevel : -Infinity;

  const group = new THREE.Group();
  group.name = 'poetic-wayfinder';
  group.userData.dynamic = true;

  const { geo, alphaAttr, kinds, seeds } = buildCurvedPetalWispGeometry(INSTANCE_COUNT, rand);

  // 每实例固定轨迹参数（零帧内分配）
  const instBaseOffset = new Float32Array(INSTANCE_COUNT);
  const instSpeed = new Float32Array(INSTANCE_COUNT);
  const instLateral = new Float32Array(INSTANCE_COUNT);
  const instSpin = new Float32Array(INSTANCE_COUNT);
  const instSize = new Float32Array(INSTANCE_COUNT);

  for (let i = 0; i < INSTANCE_COUNT; i++) {
    // 在 [0, 1) 弧段上均匀错相，首尾衔接绵延不断
    instBaseOffset[i] = (i + rand() * 0.65) / INSTANCE_COUNT;
    const isWisp = kinds[i] > 0.5;
    instSpeed[i] = isWisp ? (0.30 + rand() * 0.10) : (0.20 + rand() * 0.11);
    instLateral[i] = (rand() - 0.5) * (isWisp ? 0.34 : 0.68);
    instSpin[i] = (rand() * 1.4 + 0.8) * (i % 2 === 0 ? 1 : -1);
    instSize[i] = isWisp ? (0.62 + rand() * 0.28) : (0.125 + rand() * 0.045);
  }

  const cDayPetalA = new THREE.Color('#F2B5BE');
  const cDayPetalB = new THREE.Color('#FADCE1');
  const cDuskPetalA = new THREE.Color('#F4C1A8');
  const cDuskPetalB = new THREE.Color('#FAD8C6');
  const cDayWisp = new THREE.Color('#FFF5F7');
  const cDuskWisp = new THREE.Color('#FCE6D4');

  const uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uNightMode: { value: 0 },
    uPetalColorA: { value: cDayPetalA.clone() },
    uPetalColorB: { value: cDayPetalB.clone() },
    uWispColor: { value: cDayWisp.clone() },
    uFireflyCore: { value: new THREE.Color('#D4F779') },
    uFireflyHalo: { value: new THREE.Color('#FFE082') }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WAYFINDER_VERT,
    fragmentShader: WAYFINDER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    fog: false
  });
  material.userData = { skyIgnore: true };

  const mesh = new THREE.InstancedMesh(geo, material, INSTANCE_COUNT);
  mesh.name = 'poetic-wayfinder-stream';
  mesh.userData.skyIgnore = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(mesh);

  // 预分配临时算子（update 期间零 GC）
  const _pos = new THREE.Vector3();
  const _scl = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _mat = new THREE.Matrix4();
  const _tan = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _right = new THREE.Vector3();
  const _rotMat = new THREE.Matrix4();

  let boundSky = initSky || null;
  let disposed = false;
  let simTime = 0;
  let opacity = 0;
  let nightMode = 0;
  let duskMix = 0;
  let guideDirX = 0;
  let guideDirZ = -1;
  let hasGuideDir = false;
  let lastPlayerX = 0;
  let lastPlayerZ = 0;
  let hasPlayerPos = false;
  let waypointX = slitX;
  let waypointZ = slitZ;
  let ctrlX = slitX;
  let ctrlZ = slitZ;
  let hasCurveCtrl = false;
  let hasWaypoint = false;
  let routingViaCave = false;
  let routeMode = 'idle';
  let lastDestId = null;

  // ---- 轻量静态路网图（初始化一次构建，运行期零分配 Dijkstra）----
  const pondCfg = world?.terrain?.pond || null;
  const pondX = Number.isFinite(pondCfg?.x) ? pondCfg.x : NaN;
  const pondZ = Number.isFinite(pondCfg?.z) ? pondCfg.z : NaN;
  const pondClearR = Number.isFinite(pondCfg?.radius) ? pondCfg.radius + 0.8 : 0;
  const houseList = Array.isArray(village?.houseInfo) ? village.houseInfo : [];

  function segHitsCircle(ax, az, bx, bz, cx, cz, r) {
    if (!Number.isFinite(cx) || !Number.isFinite(cz) || r <= 0) return false;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 1e-9 ? ((cx - ax) * dx + (cz - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - cx;
    const qz = az + dz * t - cz;
    return qx * qx + qz * qz <= r * r;
  }

  function segHitsHouse(ax, az, bx, bz, h) {
    const c = Math.cos(h.rot || 0);
    const s = Math.sin(h.rot || 0);
    const x = (ax - h.x) * c - (az - h.z) * s;
    const z = (ax - h.x) * s + (az - h.z) * c;
    const dx = (bx - ax) * c - (bz - az) * s;
    const dz = (bx - ax) * s + (bz - az) * c;
    const hx = (h.w || 6) * 0.5 + 0.65;
    const hz = (h.d || 5) * 0.5 + 0.65;
    let lo = 0;
    let hi = 1;
    if (Math.abs(dx) < 1e-9) {
      if (Math.abs(x) > hx) return false;
    } else {
      const u = (-hx - x) / dx;
      const v = (hx - x) / dx;
      lo = Math.max(lo, Math.min(u, v));
      hi = Math.min(hi, Math.max(u, v));
    }
    if (Math.abs(dz) < 1e-9) {
      if (Math.abs(z) > hz) return false;
    } else {
      const u = (-hz - z) / dz;
      const v = (hz - z) / dz;
      lo = Math.max(lo, Math.min(u, v));
      hi = Math.min(hi, Math.max(u, v));
    }
    return lo <= hi;
  }

  function edgeClear(ax, az, bx, bz) {
    if (pondClearR > 0 && segHitsCircle(ax, az, bx, bz, pondX, pondZ, pondClearR)) return false;
    for (let i = 0; i < houseList.length; i++) {
      if (segHitsHouse(ax, az, bx, bz, houseList[i])) return false;
    }
    return true;
  }

  const MAX_NODES = 260;
  const graphNodes = [];
  function sideOf(x, z) {
    return (Math.hypot(x - cliffCx, z - cliffCz) > cliffR && z >= cliffFlankZ) ? 'ext' : 'int';
  }
  function addGraphNode(x, z, minSep = 5.5, forcedSide = null) {
    if (graphNodes.length >= MAX_NODES || !Number.isFinite(x) || !Number.isFinite(z)) return -1;
    if (pondClearR > 0 && Math.hypot(x - pondX, z - pondZ) <= pondClearR) return -1;
    const side = forcedSide || sideOf(x, z);
    if (minSep > 0) {
      const sep2 = minSep * minSep;
      for (let i = 0; i < graphNodes.length; i++) {
        const nd = graphNodes[i];
        if (nd.side !== side) continue;
        const dx = nd.x - x;
        const dz = nd.z - z;
        if (dx * dx + dz * dz < sep2) return i;
      }
    }
    graphNodes.push({ x, z, side });
    return graphNodes.length - 1;
  }
  function addPolylineNodes(pts, step = 14, minSep = 6.5) {
    if (!Array.isArray(pts) || !pts.length) return;
    let acc = step;
    let px = Array.isArray(pts[0]) ? pts[0][0] : pts[0].x;
    let pz = Array.isArray(pts[0]) ? pts[0][1] : pts[0].z;
    addGraphNode(px, pz, minSep);
    for (let i = 1; i < pts.length; i++) {
      const cx = Array.isArray(pts[i]) ? pts[i][0] : pts[i].x;
      const cz = Array.isArray(pts[i]) ? pts[i][1] : pts[i].z;
      const len = Math.hypot(cx - px, cz - pz);
      acc += len;
      if (acc >= step || i === pts.length - 1) {
        addGraphNode(cx, cz, minSep);
        acc = 0;
      }
      px = cx;
      pz = cz;
    }
  }

  const extMouthIdx = addGraphNode(slitX + slitUx * 14, slitZ + slitUz * 14, 0, 'ext');
  const slitNodeIdx = addGraphNode(slitX, slitZ, 0, 'slit');
  const intMouthIdx = addGraphNode(slitX - slitUx * 16, slitZ - slitUz * 16, 0, 'int');

  addPolylineNodes(world?.map?.route?.points, 16, 7);
  for (const p of exterior?.layout?.paths || []) addPolylineNodes(p.points, 14, 6.5);
  addPolylineNodes(world?.village?.road?.points, 14, 6.5);
  for (const a of qianmoPaths?.layout?.arteries || []) addPolylineNodes(a.points, 14, 6.5);
  for (const s of qianmoPaths?.layout?.spurs || []) addPolylineNodes(s.points, 14, 7.0);
  for (const p of valleyBorderlands?.layout?.paths || []) addPolylineNodes(p.points, 15, 7.0);
  for (const p of hinterland?.paths || []) addPolylineNodes(p.points, 15, 7.0);
  for (const p of outerWilds?.layout?.trails || []) addPolylineNodes(p.points, 15, 7.0);
  for (const p of deepHollows?.layout?.trails || []) addPolylineNodes(p.points, 15, 7.0);

  const nodeCount = graphNodes.length;
  const graphAdj = Array.from({ length: nodeCount }, () => []);
  function linkNodes(i, j, w) {
    if (i < 0 || j < 0 || i === j) return;
    graphAdj[i].push({ to: j, w });
    graphAdj[j].push({ to: i, w });
  }
  linkNodes(extMouthIdx, slitNodeIdx, 14);
  linkNodes(slitNodeIdx, intMouthIdx, 16);
  for (let i = 0; i < nodeCount; i++) {
    const a = graphNodes[i];
    if (a.side === 'slit') continue;
    for (let j = i + 1; j < nodeCount; j++) {
      const b = graphNodes[j];
      if (b.side !== a.side) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d > 38) continue;
      if (edgeClear(a.x, a.z, b.x, b.z)) linkNodes(i, j, d);
    }
  }

  const gDist = new Float64Array(nodeCount);
  const gPrev = new Int16Array(nodeCount);
  const gVis = new Uint8Array(nodeCount);
  const gPath = new Int16Array(nodeCount);

  function nearestClearNode(x, z, side) {
    let best = -1;
    let bestD = 52 * 52;
    for (let i = 0; i < nodeCount; i++) {
      const nd = graphNodes[i];
      if (nd.side !== side) continue;
      const dx = nd.x - x;
      const dz = nd.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD && edgeClear(x, z, nd.x, nd.z)) {
        bestD = d2;
        best = i;
      }
    }
    return best;
  }

  function findSameSideWaypoints(px, pz, tx, tz, side) {
    if (nodeCount < 4) return null;
    const sIdx = nearestClearNode(px, pz, side);
    const eIdx = nearestClearNode(tx, tz, side);
    if (sIdx < 0 || eIdx < 0 || sIdx === eIdx) return null;

    gDist.fill(Infinity);
    gPrev.fill(-1);
    gVis.fill(0);
    gDist[sIdx] = 0;

    for (let iter = 0; iter < nodeCount; iter++) {
      let u = -1;
      let minD = Infinity;
      for (let i = 0; i < nodeCount; i++) {
        if (!gVis[i] && gDist[i] < minD) {
          minD = gDist[i];
          u = i;
        }
      }
      if (u < 0 || u === eIdx) break;
      gVis[u] = 1;
      const edges = graphAdj[u];
      for (let k = 0; k < edges.length; k++) {
        const e = edges[k];
        const alt = gDist[u] + e.w;
        if (alt < gDist[e.to]) {
          gDist[e.to] = alt;
          gPrev[e.to] = u;
        }
      }
    }

    if (!Number.isFinite(gDist[eIdx])) return null;
    let len = 0;
    for (let cur = eIdx; cur !== -1; cur = gPrev[cur]) {
      gPath[len++] = cur;
    }
    // gPath[len-1] is sIdx, gPath[0] is eIdx
    let w1 = graphNodes[gPath[len - 1]];
    let w2 = null;
    for (let k = len - 1; k >= 0; k--) {
      const nd = graphNodes[gPath[k]];
      const d = Math.hypot(nd.x - px, nd.z - pz);
      if (d >= 7 && !w2) w1 = nd;
      if (d >= 16) { w2 = nd; break; }
    }
    if (!w2) w2 = { x: tx, z: tz };
    return { cX: w1.x, cZ: w1.z, tX: w2.x, tZ: w2.z, pathCost: gDist[eIdx] };
  }

  function sampleGround(x, z) {
    if (field) {
      const h = typeof field.sampleMesh === 'function' ? field.sampleMesh(x, z) : field.sample?.(x, z);
      if (Number.isFinite(h)) {
        return hasWaterFloor && h < waterLevel ? waterLevel : h;
      }
    }
    return 0;
  }

  function registerSky(skyInstance) {
    boundSky = skyInstance || null;
    if (boundSky && typeof boundSky.registerMaterials === 'function') {
      boundSky.registerMaterials(group);
    }
  }

  if (boundSky) registerSky(boundSky);

  function extractPlayerAndSky(a, b, c) {
    let pObj = null;
    let sObj = null;
    const args = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const item = args[i];
      if (!item || typeof item !== 'object') continue;
      if (!sObj && ('timeId' in item || 'weatherId' in item || typeof item.getAppearance === 'function')) {
        sObj = item;
        continue;
      }
      if (!pObj) {
        if (item.state && Number.isFinite(item.state.x) && Number.isFinite(item.state.z)) {
          pObj = item.state;
        } else if (item.position && Number.isFinite(item.position.x) && Number.isFinite(item.position.z)) {
          pObj = item.position;
        } else if (Number.isFinite(item.x) && Number.isFinite(item.z)) {
          pObj = item;
        }
      }
    }
    if (!pObj && initPlayer) {
      pObj = initPlayer.state || initPlayer.position || initPlayer;
    }
    return { pState: pObj, skyObj: sObj || boundSky };
  }

  function resolveCaveAwareTarget(px, pz, yaw, dest) {
    const playerR = Math.hypot(px - cliffCx, pz - cliffCz);
    const destR = Math.hypot(dest.x - cliffCx, dest.z - cliffCz);
    const distToSlit = Math.hypot(px - slitX, pz - slitZ);

    const destIsExterior = destR > cliffR && dest.z >= cliffFlankZ;
    let playerIsExterior;
    let playerIsInterior;

    if (playerR > cliffR + 4 && pz >= cliffFlankZ + 2) {
      playerIsExterior = true;
      playerIsInterior = false;
    } else if (playerR < cliffR - 4 || pz < cliffFlankZ - 6) {
      playerIsExterior = false;
      playerIsInterior = true;
    } else if (distToSlit > 14) {
      // 在岩环厚度带但远离山口：仍按内外侧归类，使其沿山壁引往山口
      playerIsExterior = playerR >= cliffR && pz >= cliffFlankZ;
      playerIsInterior = !playerIsExterior;
    } else {
      // 身处一线天狭道之中：直接穿洞引向彼端
      playerIsExterior = destIsExterior;
      playerIsInterior = !destIsExterior;
    }

    const oppositeSides = (playerIsExterior && !destIsExterior) || (playerIsInterior && destIsExterior);
    const caveSealed = Boolean(act3Finale?.getState?.()?.caveSealed);
    if (caveSealed && oppositeSides) {
      routingViaCave = false;
      hasCurveCtrl = false;
      routeMode = 'sealed';
      hasWaypoint = false;
      return false;
    }

    if (!oppositeSides) {
      routingViaCave = false;
      hasCurveCtrl = false;
      const straightClear = edgeClear(px, pz, dest.x, dest.z);
      const dist = Math.hypot(dest.x - px, dest.z - pz);
      if (!straightClear && dist > 14) {
        const side = playerIsExterior ? 'ext' : 'int';
        const wp = findSameSideWaypoints(px, pz, dest.x, dest.z, side);
        if (wp) {
          routeMode = 'road-network';
          hasCurveCtrl = true;
          ctrlX = wp.cX;
          ctrlZ = wp.cZ;
          waypointX = wp.tX;
          waypointZ = wp.tZ;
          return true;
        }
        // Fallback radial skirt around pond if sparse graph in unit test
        if (pondClearR > 0 && segHitsCircle(px, pz, dest.x, dest.z, pondX, pondZ, pondClearR)) {
          const dx = dest.x - px;
          const dz = dest.z - pz;
          const len = Math.hypot(dx, dz) || 1;
          const nx = -dz / len;
          const nz = dx / len;
          const sideSign = ((px - pondX) * nx + (pz - pondZ) * nz) >= 0 ? 1 : -1;
          const skirt = pondClearR + 4.5;
          routeMode = 'road-network';
          hasCurveCtrl = true;
          ctrlX = pondX + nx * sideSign * skirt;
          ctrlZ = pondZ + nz * sideSign * skirt;
          waypointX = dest.x;
          waypointZ = dest.z;
          return true;
        }
      }
      routeMode = 'direct';
      waypointX = dest.x;
      waypointZ = dest.z;
      return true;
    }

    // 检查是否已抵洞口正前且面朝洞内通道（避免在洞口处风丝倒折）
    let facingThrough = false;
    if (distToSlit < 6.5 && Number.isFinite(yaw)) {
      const fwdX = -Math.sin(yaw);
      const fwdZ = -Math.cos(yaw);
      const intoTunnelX = destIsExterior ? slitUx : -slitUx;
      const intoTunnelZ = destIsExterior ? slitUz : -slitUz;
      if (fwdX * intoTunnelX + fwdZ * intoTunnelZ > 0.65) {
        facingThrough = true;
      }
    }

    routingViaCave = true;
    hasCurveCtrl = false;
    routeMode = 'cave-portal';
    if (facingThrough) {
      const throughSign = destIsExterior ? 1 : -1;
      waypointX = slitX + slitUx * throughSign * 16;
      waypointZ = slitZ + slitUz * throughSign * 16;
    } else {
      waypointX = slitX;
      waypointZ = slitZ;
    }
    return true;
  }

  function update(dt, arg2, arg3, arg4) {
    // 严格暂停冻结：dt <= 0 或非有限数时不推进任何相位、透明度与实例矩阵
    if (disposed || typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) {
      return;
    }

    const step = Math.min(dt, 0.1);
    const { pState, skyObj } = extractPlayerAndSky(arg2, arg3, arg4);

    const gf = typeof godFlight === 'function' ? godFlight() : godFlight;
    if (gf && gf.active && typeof gf.getState === 'function') {
      const g = gf.getState();
      if (Number.isFinite(g.x) && Number.isFinite(g.z)) {
        lastPlayerX = g.x;
        lastPlayerZ = g.z;
        hasPlayerPos = true;
      }
    } else if (pState && Number.isFinite(pState.x) && Number.isFinite(pState.z)) {
      lastPlayerX = pState.x;
      lastPlayerZ = pState.z;
      hasPlayerPos = true;
    }
    const px = hasPlayerPos ? lastPlayerX : 0;
    const pz = hasPlayerPos ? lastPlayerZ : 0;
    const yaw = (gf && gf.active && typeof gf.getState === 'function')
      ? (gf.getState().yaw ?? NaN)
      : (Number.isFinite(pState?.yaw) ? pState.yaw : NaN);

    const dest = map?.getDestination?.() || null;
    const distToDest = dest ? Math.hypot(dest.x - px, dest.z - pz) : Infinity;
    let wantActive = Boolean(dest) && Number.isFinite(distToDest) && distToDest > ARRIVAL_RADIUS;

    if (wantActive) {
      lastDestId = dest.id || null;
      hasWaypoint = true;
      if (!resolveCaveAwareTarget(px, pz, yaw, dest)) {
        wantActive = false;
      }
    }
    if (wantActive) {
      opacity = Math.min(1, opacity + step * 2.8);
    } else {
      if (!dest) {
        lastDestId = null;
        routingViaCave = false;
        hasCurveCtrl = false;
        routeMode = 'idle';
        hasWaypoint = false;
      } else if (routeMode !== 'sealed') {
        routingViaCave = false;
        hasCurveCtrl = false;
        routeMode = 'arrived';
      }
      opacity = Math.max(0, opacity - step * 2.8);
      if (opacity <= 0.004) {
        opacity = 0;
        hasGuideDir = false;
        uniforms.uOpacity.value = 0;
        mesh.visible = false;
        return;
      }
    }

    simTime += step;

    // 天时色彩平滑过渡（昼/晓粉英 vs 暮色暖霞 vs 夜色流萤）
    const timeId = skyObj?.timeId || skyObj?.getStats?.()?.time || 'day';
    const targetNight = timeId === 'night' ? 1 : 0;
    const targetDusk = timeId === 'dusk' ? 1 : (timeId === 'dawn' ? 0.28 : 0);
    const blendRate = Math.min(1, step * 3.2);
    nightMode += (targetNight - nightMode) * blendRate;
    duskMix += (targetDusk - duskMix) * blendRate;

    uniforms.uTime.value = simTime;
    uniforms.uOpacity.value = opacity;
    uniforms.uNightMode.value = nightMode;
    uniforms.uPetalColorA.value.copy(cDayPetalA).lerp(cDuskPetalA, duskMix);
    uniforms.uPetalColorB.value.copy(cDayPetalB).lerp(cDuskPetalB, duskMix);
    uniforms.uWispColor.value.copy(cDayWisp).lerp(cDuskWisp, duskMix);

    const wantAdditive = nightMode >= 0.5;
    const nextBlending = wantAdditive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (material.blending !== nextBlending) {
      material.blending = nextBlending;
    }

    // 平滑引导方向向量，穿洞前后风径柔顺转折不跳变
    const rawDx = waypointX - px;
    const rawDz = waypointZ - pz;
    const rawDist = Math.hypot(rawDx, rawDz) || 1;
    const targetDirX = rawDx / rawDist;
    const targetDirZ = rawDz / rawDist;

    if (!hasGuideDir) {
      guideDirX = targetDirX;
      guideDirZ = targetDirZ;
      hasGuideDir = true;
    } else {
      const turnK = Math.min(1, step * 6.5);
      guideDirX += (targetDirX - guideDirX) * turnK;
      guideDirZ += (targetDirZ - guideDirZ) * turnK;
      const gl = Math.hypot(guideDirX, guideDirZ) || 1;
      guideDirX /= gl;
      guideDirZ /= gl;
    }

    const perpX = -guideDirZ;
    const perpZ = guideDirX;
    const windX = Number.isFinite(skyObj?.windX) ? skyObj.windX * 0.04 : 0;
    const windZ = Number.isFinite(skyObj?.windZ) ? skyObj.windZ * 0.04 : 0;

    const arcEnd = wantActive
      ? Math.min(ARC_END_DIST, Math.max(ARC_START_DIST + 1.6, Math.min(distToDest, rawDist) - 0.5))
      : ARC_END_DIST;

    const alphaArr = alphaAttr.array;
    for (let i = 0; i < INSTANCE_COUNT; i++) {
      const seed = seeds[i];
      const isWisp = kinds[i] > 0.5;
      const u = (instBaseOffset[i] + simTime * instSpeed[i]) % 1;

      // 首尾羽化包络：距身前 2.6m 轻盈浮现，至 13.5m 融于清风
      const fadeIn = smoothstep(0.0, 0.16, u);
      const fadeOut = 1.0 - smoothstep(0.78, 1.0, u);
      alphaArr[i] = fadeIn * fadeOut;

      const s = lerp(ARC_START_DIST, arcEnd, u);
      const sCurve = Math.sin(u * TAU - simTime * 1.15 + seed * 2.4) * (0.38 + 0.24 * Math.sin(u * PI));
      const lat = sCurve + instLateral[i] * (0.55 + 0.45 * u);

      let baseX = px + guideDirX * s;
      let baseZ = pz + guideDirZ * s;
      let locPerpX = perpX;
      let locPerpZ = perpZ;
      if (hasCurveCtrl && routeMode === 'road-network') {
        const cDx = ctrlX - px;
        const cDz = ctrlZ - pz;
        const cLen = Math.hypot(cDx, cDz) || 1;
        const n1x = cDx / cLen;
        const n1z = cDz / cLen;
        const eDx = waypointX - ctrlX;
        const eDz = waypointZ - ctrlZ;
        const eLen = Math.hypot(eDx, eDz) || 1;
        const n2x = eDx / eLen;
        const n2z = eDz / eLen;
        const bT = clamp(s / Math.max(arcEnd, 1), 0, 1);
        const mt = 1 - bT;
        const m1x = px + n1x * Math.min(s, cLen);
        const m1z = pz + n1z * Math.min(s, cLen);
        const m2x = px + guideDirX * s;
        const m2z = pz + guideDirZ * s;
        baseX = m1x * mt * mt + (ctrlX + n2x * (s * 0.35)) * (2 * mt * bT) + m2x * bT * bT;
        baseZ = m1z * mt * mt + (ctrlZ + n2z * (s * 0.35)) * (2 * mt * bT) + m2z * bT * bT;
        const bDirX = n1x * mt + n2x * bT;
        const bDirZ = n1z * mt + n2z * bT;
        const bl = Math.hypot(bDirX, bDirZ) || 1;
        locPerpX = -bDirZ / bl;
        locPerpZ = bDirX / bl;
      }

      const wx = baseX + locPerpX * lat + windX * u;
      const wz = baseZ + locPerpZ * lat + windZ * u;

      // 严格贴合地形采样高度 + [1.05m .. 1.52m] 轻盈浮游区间
      const gy = sampleGround(wx, wz);
      const hoverWave = 0.5 + 0.5 * Math.sin(u * PI * 1.7 + simTime * 1.45 + seed * TAU);
      const wy = gy + 1.05 + 0.47 * hoverWave;

      _pos.set(wx, wy, wz);

      if (isWisp && nightMode < 0.5) {
        // 风丝沿 S 曲线切向舒展
        const ds = Math.max(0.5, arcEnd - ARC_START_DIST);
        const dLatDu = Math.cos(u * TAU - simTime * 1.15 + seed * 2.4) * TAU * 0.38;
        _tan.set(
          guideDirX * ds + perpX * dLatDu,
          Math.cos(u * PI * 1.7 + simTime * 1.45 + seed * TAU) * 0.36,
          guideDirZ * ds + perpZ * dLatDu
        ).normalize();
        _right.crossVectors(_up, _tan).normalize();
        const orthoUpX = _tan.y * _right.z - _tan.z * _right.y;
        const orthoUpY = _tan.z * _right.x - _tan.x * _right.z;
        const orthoUpZ = _tan.x * _right.y - _tan.y * _right.x;
        _rotMat.makeBasis(_right, _pos.set(orthoUpX, orthoUpY, orthoUpZ), _tan);
        _quat.setFromRotationMatrix(_rotMat);
        _pos.set(wx, wy, wz);
        _scl.set(0.085, 1.0, instSize[i]);
      } else {
        // 落英随风翻飞自转
        _euler.set(
          0.45 * Math.sin(simTime * instSpin[i] + seed * TAU),
          Math.atan2(guideDirX, guideDirZ) + simTime * instSpin[i] * 0.55,
          0.52 * Math.cos(simTime * instSpin[i] * 0.8 + seed * 4.1),
          'YXZ'
        );
        _quat.setFromEuler(_euler);
        const sz = instSize[i];
        _scl.set(sz * 0.82, sz, sz * 1.12);
      }

      _mat.compose(_pos, _quat, _scl);
      mesh.setMatrixAt(i, _mat);
    }

    alphaAttr.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = opacity > 0.004;
  }

  function isChainVisible() {
    if (disposed || !mesh.visible) return false;
    for (let p = mesh; p; p = p.parent) {
      if (p.visible === false) return false;
      if (p === group) return group.visible !== false;
    }
    return group.visible !== false;
  }

  function getStats() {
    const visible = isChainVisible();
    return {
      active: visible && opacity > 0,
      visible,
      opacity: Math.round(opacity * 1000) / 1000,
      simTime: Math.round(simTime * 1000) / 1000,
      nightMode: Math.round(nightMode * 1000) / 1000,
      blending: material.blending === THREE.AdditiveBlending ? 'additive' : 'normal',
      instanceCount: INSTANCE_COUNT,
      trianglesPerInstance: geo.index.count / 3,
      drawCalls: visible ? 1 : 0,
      triangles: visible ? INSTANCE_COUNT * (geo.index.count / 3) : 0,
      destinationId: lastDestId,
      routingViaCave,
      routeMode,
      waypoint: hasWaypoint ? { x: Math.round(waypointX * 100) / 100, z: Math.round(waypointZ * 100) / 100 } : null,
      arcRange: [ARC_START_DIST, ARC_END_DIST],
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mesh.visible = false;
    opacity = 0;
    if (typeof mesh.dispose === 'function') mesh.dispose();
    geo.dispose();
    material.dispose();
    group.removeFromParent();
  }

  return {
    group,
    registerSky,
    update,
    getStats,
    dispose
  };
}
