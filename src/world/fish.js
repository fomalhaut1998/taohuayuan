import * as THREE from 'three';
import { chokeFactor } from './terrain.js';
import { chainProgramCacheKey } from '../systems/shader-cache-key.js';

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 低模溪鲤/白条：身长约 1.18 单位，隆背阔胸、深青橄榄脊背、银金腹胁、双胸鳍、腹鳍与深叉燕尾并入同一份几何，整群仅占 1 个 draw call
function createFishGeometry(cfg) {
  const positions = [];
  const colors = [];
  const indices = [];

  const rawBack = new THREE.Color(cfg.colors.back);
  const rawFlank = new THREE.Color(cfg.colors.flank);
  const rawBelly = new THREE.Color(cfg.colors.belly);
  const rawFin = new THREE.Color(cfg.colors.fin);

  const cBack = rawBack.clone().lerp(new THREE.Color('#233D35'), 0.42);
  const cUpperFlank = rawBack.clone().lerp(rawFlank, 0.56);
  const cFlank = rawFlank.clone().lerp(new THREE.Color('#8E9B80'), 0.34);
  const cBelly = rawBelly.clone().lerp(new THREE.Color('#DFCFA2'), 0.46);
  const cLowerFlank = cFlank.clone().lerp(cBelly, 0.58);
  const cFin = rawFin.clone().lerp(new THREE.Color('#3B4E42'), 0.35);
  const cFinTip = cFin.clone().lerp(new THREE.Color('#74826D'), 0.48);
  const cEye = new THREE.Color(cfg.colors.eye);

  function vert(x, y, z, c) {
    positions.push(x, y, z);
    colors.push(c.r, c.g, c.b);
    return positions.length / 3 - 1;
  }

  // 七道流线截面：x 从吻端 +0.50 到尾柄 -0.43；每道截面 8 顶点（隆起背脊棱 + 圆润两胁 + 银金腹线）
  // [x, yTop, yBot, zHalf, yMid]
  const sections = [
    [0.50, 0.020, -0.016, 0.014, 0.002],
    [0.38, 0.074, -0.056, 0.046, 0.006],
    [0.18, 0.118, -0.092, 0.066, 0.008],
    [-0.02, 0.112, -0.088, 0.062, 0.006],
    [-0.20, 0.074, -0.058, 0.038, 0.003],
    [-0.33, 0.040, -0.034, 0.020, 0.000],
    [-0.43, 0.026, -0.024, 0.010, 0.000]
  ];
  const RING_N = 8;
  const rings = [];
  for (let i = 0; i < sections.length; i++) {
    const [x, yTop, yBot, zHalf, yMid] = sections[i];
    rings.push([
      vert(x, yTop, 0, cBack),
      vert(x, yTop * 0.64 + yMid, zHalf * 0.75, cUpperFlank),
      vert(x, yMid, zHalf, cFlank),
      vert(x, yBot * 0.66 + yMid * 0.35, zHalf * 0.72, cLowerFlank),
      vert(x, yBot, 0, cBelly),
      vert(x, yBot * 0.66 + yMid * 0.35, -zHalf * 0.72, cLowerFlank),
      vert(x, yMid, -zHalf, cFlank),
      vert(x, yTop * 0.64 + yMid, -zHalf * 0.75, cUpperFlank)
    ]);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    for (let j = 0; j < RING_N; j++) {
      const jn = (j + 1) % RING_N;
      indices.push(a[j], b[j], b[jn], a[j], b[jn], a[jn]);
    }
  }

  // 吻端与尾柄封盖
  const snoutTip = vert(0.545, 0.002, 0, cUpperFlank);
  const tailCap = vert(-0.445, 0, 0, cFlank);
  const headRing = rings[0];
  const tailRing = rings[rings.length - 1];
  for (let j = 0; j < RING_N; j++) {
    const jn = (j + 1) % RING_N;
    indices.push(snoutTip, headRing[jn], headRing[j]);
    indices.push(tailCap, tailRing[j], tailRing[jn]);
  }

  // 深叉燕尾尾鳍（上下双叶 + 中央深缺刻）
  const cRootTop = vert(-0.41, 0.026, 0, cFin);
  const cRootMid = vert(-0.43, 0.0, 0, cFin);
  const cRootBot = vert(-0.41, -0.024, 0, cFin);
  const tailNotch = vert(-0.535, 0.0, 0, cFinTip);
  const tailTop = vert(-0.69, 0.165, 0, cFinTip);
  const tailTopTrailing = vert(-0.62, 0.075, 0, cFinTip);
  const tailBot = vert(-0.68, -0.155, 0, cFinTip);
  const tailBotTrailing = vert(-0.61, -0.072, 0, cFinTip);
  indices.push(cRootTop, tailTop, tailTopTrailing);
  indices.push(cRootTop, tailTopTrailing, tailNotch);
  indices.push(cRootMid, tailNotch, cRootTop);
  indices.push(cRootBot, tailBotTrailing, tailBot);
  indices.push(cRootBot, tailNotch, tailBotTrailing);
  indices.push(cRootMid, cRootBot, tailNotch);

  // 溪鲤高耸掠后背鳍
  const d0 = vert(0.16, 0.110, 0, cBack);
  const d1 = vert(0.03, 0.238, 0, cFinTip);
  const d2 = vert(-0.15, 0.172, 0, cFinTip);
  const d3 = vert(-0.22, 0.068, 0, cFin);
  indices.push(d0, d1, d2, d0, d2, d3);

  // 左右舒展斜掠胸鳍（俯视水面最显灵动游姿）
  for (let side = -1; side <= 1; side += 2) {
    const pLead = vert(0.29, -0.038, side * 0.042, cFin);
    const pBase = vert(0.16, -0.052, side * 0.046, cFin);
    const pTip = vert(0.10, -0.082, side * 0.148, cFinTip);
    const pTrail = vert(0.05, -0.068, side * 0.095, cFinTip);
    if (side > 0) {
      indices.push(pLead, pTip, pTrail, pLead, pTrail, pBase);
    } else {
      indices.push(pLead, pTrail, pTip, pLead, pBase, pTrail);
    }
  }

  // 腹鳍/臀鳍轻掠点缀
  const v0 = vert(-0.01, -0.084, 0, cBelly);
  const v1 = vert(-0.11, -0.145, 0, cFinTip);
  const v2 = vert(-0.17, -0.064, 0, cFin);
  indices.push(v0, v1, v2);

  // 两胁眼点
  for (let side = -1; side <= 1; side += 2) {
    const e0 = vert(0.425, 0.030, side * 0.039, cEye);
    const e1 = vert(0.385, 0.054, side * 0.047, cEye);
    const e2 = vert(0.392, 0.012, side * 0.046, cEye);
    if (side > 0) indices.push(e0, e1, e2);
    else indices.push(e0, e2, e1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// 曲线采样表：鱼的逐帧取点只做线性插值，省掉每帧 getPointAt
function createPath(curve, samples) {
  const pts = new Float32Array((samples + 1) * 2);
  const tans = new Float32Array((samples + 1) * 2);
  for (let i = 0; i <= samples; i++) {
    const p = curve.getPointAt(i / samples);
    const tan = curve.getTangentAt(i / samples);
    const nl = Math.hypot(tan.x, tan.z) || 1;
    pts[i * 2] = p.x;
    pts[i * 2 + 1] = p.z;
    tans[i * 2] = tan.x / nl;
    tans[i * 2 + 1] = tan.z / nl;
  }
  return { pts: pts, tans: tans, samples: samples };
}

function samplePath(path, t, out) {
  const f = Math.min(Math.max(t, 0), 1) * path.samples;
  const i = Math.min(path.samples - 1, Math.floor(f));
  const k = f - i;
  const a = i * 2;
  const b = a + 2;
  out.x = path.pts[a] + (path.pts[b] - path.pts[a]) * k;
  out.z = path.pts[a + 1] + (path.pts[b + 1] - path.pts[a + 1]) * k;
  out.tx = path.tans[a] + (path.tans[b] - path.tans[a]) * k;
  out.tz = path.tans[a + 1] + (path.tans[b + 1] - path.tans[a + 1]) * k;
  const nl = Math.hypot(out.tx, out.tz) || 1;
  out.tx /= nl;
  out.tz /= nl;
  return out;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function turnToward(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function createFish(cfg, streamCfg, terrainCfg, curve, stream) {
  const rand = lcg(cfg.seed);
  const path = createPath(curve, cfg.pathSamples);
  const length = curve.getLength();
  const node = { x: 0, z: 0, tx: 1, tz: 0 };
  const states = [];

  for (let si = 0; si < cfg.schools.length; si++) {
    const school = cfg.schools[si];
    samplePath(path, school.t, node);
    const waterHalf = (streamCfg.halfWidth + Math.sin(school.t * 21.7) * streamCfg.edgeWobble) *
      chokeFactor(terrainCfg, node.x, node.z);
    const half = Math.min(cfg.maxLateral, waterHalf * cfg.lateralFill);
    const tSpan = (school.spread * 0.5) / length;

    for (let i = 0; i < school.count; i++) {
      const tHome = school.t + (rand() - 0.5) * tSpan;
      const lat = clamp(school.lat + (rand() - 0.5) * cfg.schoolLatSpread, -half, half);
      const f = {
        t: tHome,
        tHome: tHome,
        tSpan: tSpan * (0.55 + rand() * 0.45),
        dir: rand() < 0.5 ? -1 : 1,
        speed: cfg.speed[0] + rand() * (cfg.speed[1] - cfg.speed[0]),
        lat: lat,
        latSway: cfg.latSway * (0.5 + rand() * 0.8),
        latPhase: rand() * Math.PI * 2,
        latSpeed: cfg.latSpeed[0] + rand() * (cfg.latSpeed[1] - cfg.latSpeed[0]),
        size: cfg.size[0] + rand() * (cfg.size[1] - cfg.size[0]),
        lift: cfg.lift,
        tint: cfg.tint,
        phase: rand() * Math.PI * 2,
        wiggleAmp: cfg.wiggleAmp * (0.6 + rand() * 0.8),
        wiggleSpeed: cfg.wiggleSpeed * (0.8 + rand() * 0.5),
        bobSpeed: cfg.bobSpeed * (0.8 + rand() * 0.4),
        rollSpeed: cfg.rollSpeed * (0.7 + rand() * 0.6),
        yaw: 0,
        x: 0,
        z: 0
      };
      samplePath(path, tHome, node);
      f.yaw = Math.atan2(-node.tz * f.dir, node.tx * f.dir);
      states.push(f);
    }
  }

  // 池鱼：绕着美池池心打转，半径上再叠一层慢摆。
  // 池里没有水流，鱼不必溯流，只求「一小群鱼在池心慢慢绕圈」的观感
  const pondCfg = terrainCfg.pond;
  if (pondCfg) {
    for (let pi = 0; pi < cfg.ponds.length; pi++) {
      const pond = cfg.ponds[pi];
      const maxR = Math.max(0.6, pondCfg.waterRadius - pond.edgeInset);
      for (let i = 0; i < pond.count; i++) {
        const ang = rand() * Math.PI * 2;
        const f = {
          kind: 'pond',
          cx: pondCfg.x,
          cz: pondCfg.z,
          waterY: pondCfg.waterY,
          ang: ang,
          angDir: rand() < 0.5 ? -1 : 1,
          angSpeed: pond.angSpeed[0] + rand() * (pond.angSpeed[1] - pond.angSpeed[0]),
          r: maxR * (pond.radiusFill[0] + rand() * (pond.radiusFill[1] - pond.radiusFill[0])),
          radialSway: pond.radialSway * (0.5 + rand() * 0.8),
          radialPhase: rand() * Math.PI * 2,
          radialSpeed: pond.radialSpeed[0] + rand() * (pond.radialSpeed[1] - pond.radialSpeed[0]),
          size: pond.size[0] + rand() * (pond.size[1] - pond.size[0]),
          lift: pond.lift,
          tint: pond.tint,
          phase: rand() * Math.PI * 2,
          wiggleAmp: cfg.wiggleAmp * (0.6 + rand() * 0.8),
          wiggleSpeed: cfg.wiggleSpeed * (0.8 + rand() * 0.5),
          bobSpeed: cfg.bobSpeed * (0.8 + rand() * 0.4),
          rollSpeed: cfg.rollSpeed * (0.7 + rand() * 0.6),
          yaw: 0,
          x: 0,
          z: 0
        };
        f.x = f.cx + Math.cos(f.ang) * f.r;
        f.z = f.cz + Math.sin(f.ang) * f.r;
        const tx = -Math.sin(f.ang) * f.angDir;
        const tz = Math.cos(f.ang) * f.angDir;
        f.yaw = Math.atan2(-tz, tx);
        states.push(f);
      }
    }
  }

  const fishBox = new THREE.Box3();
  const fishPt = new THREE.Vector3();
  const baseY = terrainCfg.waterLevel ?? 0;
  for (let i = 0; i <= path.samples; i++) {
    fishBox.expandByPoint(fishPt.set(path.pts[i * 2], baseY, path.pts[i * 2 + 1]));
  }
  if (pondCfg) {
    const pr = (pondCfg.waterRadius || pondCfg.radius || 9) + 2;
    fishBox.expandByPoint(fishPt.set(pondCfg.x - pr, pondCfg.waterY, pondCfg.z - pr));
    fishBox.expandByPoint(fishPt.set(pondCfg.x + pr, pondCfg.waterY, pondCfg.z + pr));
  }
  fishBox.expandByScalar(Math.max(4, (cfg.maxLateral || 2) + 3));
  const fishSphere = fishBox.getBoundingSphere(new THREE.Sphere());

  const geo = createFishGeometry(cfg);
  const fishUniforms = { uFishTime: { value: 0 } };
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: cfg.opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  chainProgramCacheKey(mat, 'fish-carp-swave-v1');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFishTime = fishUniforms.uFishTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uFishTime;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float instPhase = 0.0;
  #ifdef USE_INSTANCING
    instPhase = instanceMatrix[3].x * 1.73 + instanceMatrix[3].z * 1.29;
  #endif
  float bodyMask = smoothstep(0.36, -0.68, position.x);
  float wave = sin(uFishTime * 8.2 + instPhase - position.x * 5.6);
  transformed.z += wave * bodyMask * bodyMask * 0.075;
}`
      );
  };
  const mesh = new THREE.InstancedMesh(geo, mat, states.length);
  mesh.name = 'fish';
  mesh.renderOrder = cfg.renderOrder;
  mesh.boundingSphere = fishSphere;
  mesh.frustumCulled = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const tint = new THREE.Color();
  for (let i = 0; i < states.length; i++) {
    const tr = states[i].tint;
    tint.setScalar(tr[0] + rand() * (tr[1] - tr[0]));
    mesh.setColorAt(i, tint);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // 涟漪：鱼背破水时留下的一圈淡纹，跟着鱼的位置出现、扩散、被水色吃掉
  const rc = cfg.ripples;
  const ringGeo = new THREE.RingGeometry(rc.inner, 1, rc.segments);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: rc.opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const ripples = new THREE.InstancedMesh(ringGeo, ringMat, rc.count);
  ripples.name = 'fish-ripples';
  ripples.renderOrder = rc.renderOrder;
  ripples.boundingSphere = fishSphere;
  ripples.frustumCulled = true;
  ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const ringStates = [];
  const ringRipple = new THREE.Color(rc.color);
  const ringWater = new THREE.Color(rc.waterColor);
  const ringColor = new THREE.Color();

  // 河道涟漪按 t/lat 取点；池里没有曲线，直接记下鱼当时的平面位置
  function placeRipple(r) {
    const f = states[(rand() * states.length) | 0];
    r.age = 0;
    r.life = rc.life[0] + rand() * (rc.life[1] - rc.life[0]);
    if (f.kind === 'pond') {
      r.kind = 'pond';
      r.x = f.x + (rand() - 0.5) * rc.jitter;
      r.z = f.z + (rand() - 0.5) * rc.jitter;
      r.y = f.waterY + rc.lift;
      r.t = 0;
      r.lat = 0;
    } else {
      r.kind = 'river';
      r.t = f.t + (rand() - 0.5) * (rc.jitter / length);
      r.lat = f.lat + (rand() - 0.5) * rc.jitter;
    }
  }

  for (let i = 0; i < rc.count; i++) {
    const r = { kind: 'river', t: 0, lat: 0, x: 0, z: 0, y: 0, age: 0, life: 1 };
    placeRipple(r);
    r.age = rand() * r.life;
    ringStates.push(r);
  }

  const dummy = new THREE.Object3D();
  const rnode = { x: 0, z: 0, tx: 1, tz: 0 };

  function updateRipples(dt, elapsed) {
    for (let i = 0; i < ringStates.length; i++) {
      const r = ringStates[i];
      r.age += dt;
      if (r.age >= r.life) placeRipple(r);
      const k = r.age / r.life;
      let x;
      let z;
      let y;
      if (r.kind === 'pond') {
        x = r.x;
        z = r.z;
        y = r.y;
      } else {
        samplePath(path, r.t, rnode);
        x = rnode.x + rnode.tz * r.lat;
        z = rnode.z - rnode.tx * r.lat;
        y = stream.surfaceY(r.t, elapsed) + rc.lift;
      }
      const s = rc.size * (0.18 + 0.82 * k);
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(s, 1, s);
      dummy.updateMatrix();
      ripples.setMatrixAt(i, dummy.matrix);
      ringColor.copy(ringRipple).lerp(ringWater, k);
      ripples.setColorAt(i, ringColor);
    }
    ripples.instanceMatrix.needsUpdate = true;
    if (ripples.instanceColor) ripples.instanceColor.needsUpdate = true;
  }

  let simElapsed = 0;
  let initialized = false;

  function update(dt, elapsed) {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(0.1, dt) : 0;
    if (!initialized) {
      simElapsed = Number.isFinite(elapsed) ? elapsed : 0;
      initialized = true;
    } else if (step <= 0) {
      return;
    } else {
      simElapsed += step;
    }
    fishUniforms.uFishTime.value = simElapsed;

    for (let i = 0; i < states.length; i++) {
      const f = states[i];
      const bob = Math.sin(simElapsed * f.bobSpeed + f.phase) * cfg.bobAmp;
      const wiggle = Math.sin(simElapsed * f.wiggleSpeed + f.phase) * f.wiggleAmp;
      let x;
      let z;
      let y;
      let target;

      if (f.kind === 'pond') {
        // 池鱼绕池心打转：角速度带方向，半径上再叠一层慢摆，避免绕成标准圆
        f.ang += f.angDir * f.angSpeed * step;
        const rr = f.r + Math.sin(simElapsed * f.radialSpeed + f.radialPhase) * f.radialSway;
        x = f.cx + Math.cos(f.ang) * rr;
        z = f.cz + Math.sin(f.ang) * rr;
        y = f.waterY + f.lift + bob;
        const tx = -Math.sin(f.ang) * f.angDir;
        const tz = Math.cos(f.ang) * f.angDir;
        target = Math.atan2(-tz, tx) + wiggle;
      } else {
        f.t += (f.dir * f.speed * step) / length;
        const lo = f.tHome - f.tSpan;
        const hi = f.tHome + f.tSpan;
        if (f.t > hi) {
          f.t = hi;
          f.dir = -1;
        } else if (f.t < lo) {
          f.t = lo;
          f.dir = 1;
        }

        samplePath(path, f.t, node);
        const lat = f.lat + Math.sin(simElapsed * f.latSpeed + f.latPhase) * f.latSway;
        x = node.x + node.tz * lat;
        z = node.z - node.tx * lat;
        y = stream.surfaceY(f.t, simElapsed) + f.lift + bob;
        target = Math.atan2(-node.tz * f.dir, node.tx * f.dir) + wiggle;
      }
      if (step > 0) {
        f.yaw = turnToward(f.yaw, target, 1 - Math.exp(-cfg.turnRate * step));
      } else {
        f.yaw = target;
      }
      f.x = x;
      f.z = z;

      dummy.position.set(x, y, z);
      dummy.rotation.set(Math.sin(simElapsed * f.rollSpeed + f.phase) * cfg.rollAmp, f.yaw, 0, 'YXZ');
      dummy.scale.setScalar(f.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    updateRipples(step, simElapsed);
  }

  const group = new THREE.Group();
  group.add(mesh);
  group.add(ripples);

  return { group: group, count: states.length, update: update };
}
