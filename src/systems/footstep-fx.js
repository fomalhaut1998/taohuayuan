import * as THREE from 'three';
import { sampleGroundSurface, sampleGroundMaterial } from '../world/ground-surface.js';

/**
 * 轻量化零分配步伐微效系统：
 * - 涉水 / 雨后青石与夯土路：低多边形清浅涟漪环 + 飞溅水珠微粒
 * - 冬雪户外（草坡/土路）：交替左右履底雪印 + 轻扬雪屑
 * - 雨后湿泥土路：温润暗色湿泥履印
 * - 疾行夯土路：轻扬淡尘微粒
 * 空闲时三个 InstancedMesh 均自动置 visible = false（0 Draw Call），严格遵守 dt <= 0 冻结闸门。
 */

const MAX_RIPPLES = 28;
const MAX_PRINTS = 48;
const MAX_MOTES = 36;

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _col = new THREE.Color();
const _yAxis = new THREE.Vector3(0, 1, 0);

function buildSoleGeometry() {
  // 8 顶点秦汉履底剪影（XZ 平面，前掌略宽圆、足心微收、后跟窄圆，仅 6 个三角形）
  const pts = [
    [0.0, 0.0, -0.145],     // 0 履尖
    [0.056, 0.0, -0.095],   // 1 右前掌
    [0.050, 0.0, -0.025],   // 2 右外弓
    [0.036, 0.0, 0.035],    // 3 右足腰
    [0.045, 0.0, 0.115],    // 4 右后跟
    [0.0, 0.0, 0.142],      // 5 后跟尖
    [-0.045, 0.0, 0.115],   // 6 左后跟
    [-0.036, 0.0, 0.035],   // 7 左足腰
    [-0.050, 0.0, -0.025],  // 8 左外弓
    [-0.056, 0.0, -0.095]   // 9 左前掌
  ];
  // 扇形三角化，朝上 (+Y)
  const triCount = pts.length - 2;
  const positions = new Float32Array(triCount * 9);
  let k = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[0];
    const b = pts[i + 1];
    const c = pts[i];
    positions[k++] = a[0]; positions[k++] = a[1]; positions[k++] = a[2];
    positions[k++] = b[0]; positions[k++] = b[1]; positions[k++] = b[2];
    positions[k++] = c[0]; positions[k++] = c[1]; positions[k++] = c[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createFootstepFx({ field = null, world = null, people = null, fauna = null } = {}) {
  const group = new THREE.Group();
  group.name = 'footstep-fx';

  const waterLevel = Number(world?.terrain?.waterLevel ?? -0.15);
  const pond = world?.terrain?.pond || null;

  // 1. 涟漪环池 (water / rain puddle)
  const rippleGeo = new THREE.RingGeometry(0.135, 0.215, 12);
  rippleGeo.rotateX(-Math.PI / 2);
  const rippleMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const rippleMesh = new THREE.InstancedMesh(rippleGeo, rippleMat, MAX_RIPPLES);
  rippleMesh.name = 'footstep-ripples';
  rippleMesh.count = 0;
  rippleMesh.visible = false;
  rippleMesh.frustumCulled = false;
  rippleMesh.renderOrder = 3;
  _col.setHex(0xdceee8);
  rippleMesh.setColorAt(0, _col);
  group.add(rippleMesh);

  // 2. 履底雪印 / 湿泥足迹池
  const printGeo = buildSoleGeometry();
  const printMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const printMesh = new THREE.InstancedMesh(printGeo, printMat, MAX_PRINTS);
  printMesh.name = 'footstep-prints';
  printMesh.count = 0;
  printMesh.visible = false;
  printMesh.frustumCulled = false;
  printMesh.renderOrder = 3;
  _col.setHex(0x8899aa);
  printMesh.setColorAt(0, _col);
  group.add(printMesh);

  // 3. 飞溅水珠 / 扬雪 / 疾行轻尘微粒池
  const moteGeo = new THREE.OctahedronGeometry(0.032, 0);
  const moteMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    depthWrite: false
  });
  const moteMesh = new THREE.InstancedMesh(moteGeo, moteMat, MAX_MOTES);
  moteMesh.name = 'footstep-motes';
  moteMesh.count = 0;
  moteMesh.visible = false;
  moteMesh.frustumCulled = false;
  moteMesh.renderOrder = 4;
  _col.setHex(0xeaf5f2);
  moteMesh.setColorAt(0, _col);
  group.add(moteMesh);

  // 零分配扁平状态数组
  const ripActive = new Uint8Array(MAX_RIPPLES);
  const ripX = new Float32Array(MAX_RIPPLES);
  const ripY = new Float32Array(MAX_RIPPLES);
  const ripZ = new Float32Array(MAX_RIPPLES);
  const ripAge = new Float32Array(MAX_RIPPLES);
  const ripLife = new Float32Array(MAX_RIPPLES);
  const ripMinS = new Float32Array(MAX_RIPPLES);
  const ripMaxS = new Float32Array(MAX_RIPPLES);
  const ripKind = new Uint8Array(MAX_RIPPLES); // 0 = water, 1 = rain puddle
  let ripCursor = 0;

  const prActive = new Uint8Array(MAX_PRINTS);
  const prX = new Float32Array(MAX_PRINTS);
  const prY = new Float32Array(MAX_PRINTS);
  const prZ = new Float32Array(MAX_PRINTS);
  const prYaw = new Float32Array(MAX_PRINTS);
  const prAge = new Float32Array(MAX_PRINTS);
  const prLife = new Float32Array(MAX_PRINTS);
  const prScale = new Float32Array(MAX_PRINTS);
  const prKind = new Uint8Array(MAX_PRINTS); // 0 = snow, 1 = mud
  let prCursor = 0;

  const mtActive = new Uint8Array(MAX_MOTES);
  const mtX = new Float32Array(MAX_MOTES);
  const mtY = new Float32Array(MAX_MOTES);
  const mtZ = new Float32Array(MAX_MOTES);
  const mtVX = new Float32Array(MAX_MOTES);
  const mtVY = new Float32Array(MAX_MOTES);
  const mtVZ = new Float32Array(MAX_MOTES);
  const mtAge = new Float32Array(MAX_MOTES);
  const mtLife = new Float32Array(MAX_MOTES);
  const mtKind = new Uint8Array(MAX_MOTES); // 0 = water, 1 = snow, 2 = dust
  let mtCursor = 0;

  // 轻量确定性伪随机
  let rngState = 0x51a7c3d1 >>> 0;
  function nextRand() {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  let lastX = NaN;
  let lastZ = NaN;
  let stepDist = 0;
  let stepSide = 1;
  let wasAirborne = false;
  let simTime = 0;

  // 附近漫步村人 & 生灵（水牛/黄狗/池鸭）零分配跟踪缓存
  let npcTrackCap = 0;
  let npcLastX = null;
  let npcLastZ = null;
  let npcDist = null;
  let npcSide = null;
  let npcPollAccum = 0;

  let faTrackCap = 0;
  let faLastX = null;
  let faLastZ = null;
  let faDist = null;
  let faSide = null;
  let faPollAccum = 0;

  const bySurface = { water: 0, snow: 0, mud: 0, dust: 0, rainRipple: 0 };
  const byActor = { player: 0, villager: 0, fauna: 0 };
  let totalEmitted = 0;
  let ripplesActive = 0;
  let printsActive = 0;
  let motesActive = 0;
  let disposed = false;

  function ensureNpcTrack(n) {
    if (n <= npcTrackCap) return;
    npcTrackCap = n;
    npcLastX = new Float32Array(n);
    npcLastZ = new Float32Array(n);
    npcDist = new Float32Array(n);
    npcSide = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      npcLastX[i] = NaN;
      npcLastZ[i] = NaN;
      npcSide[i] = (i & 1) ? 1 : -1;
    }
  }

  function ensureFaunaTrack(n) {
    if (n <= faTrackCap) return;
    faTrackCap = n;
    faLastX = new Float32Array(n);
    faLastZ = new Float32Array(n);
    faDist = new Float32Array(n);
    faSide = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      faLastX[i] = NaN;
      faLastZ[i] = NaN;
      faSide[i] = (i & 1) ? 1 : -1;
    }
  }

  function spawnRipple(x, y, z, kind, delay = 0, scaleMul = 1.0) {
    const i = ripCursor;
    ripCursor = (ripCursor + 1) % MAX_RIPPLES;
    ripActive[i] = 1;
    ripX[i] = x;
    ripY[i] = y;
    ripZ[i] = z;
    ripAge[i] = -delay;
    ripLife[i] = kind === 0 ? 1.25 : 0.78;
    ripMinS[i] = (kind === 0 ? 0.58 : 0.45) * scaleMul;
    ripMaxS[i] = (kind === 0 ? 3.35 : 1.95) * scaleMul;
    ripKind[i] = kind;
  }

  function spawnPrint(x, y, z, yaw, kind, scale = 1.0) {
    const i = prCursor;
    prCursor = (prCursor + 1) % MAX_PRINTS;
    prActive[i] = 1;
    prX[i] = x;
    prY[i] = y;
    prZ[i] = z;
    prYaw[i] = yaw;
    prAge[i] = 0;
    prLife[i] = kind === 0 ? 9.5 : 6.2;
    prScale[i] = scale;
    prKind[i] = kind;
  }

  function spawnMotes(x, y, z, kind, count, speedScale = 1.0) {
    for (let n = 0; n < count; n++) {
      const i = mtCursor;
      mtCursor = (mtCursor + 1) % MAX_MOTES;
      const ang = nextRand() * Math.PI * 2;
      const spd = (0.35 + nextRand() * 0.75) * speedScale;
      mtActive[i] = 1;
      mtX[i] = x + (nextRand() - 0.5) * 0.14;
      mtY[i] = y + 0.04;
      mtZ[i] = z + (nextRand() - 0.5) * 0.14;
      mtVX[i] = Math.cos(ang) * spd;
      mtVY[i] = (kind === 2 ? 0.45 : 0.95) + nextRand() * (kind === 2 ? 0.35 : 0.65);
      mtVZ[i] = Math.sin(ang) * spd;
      mtAge[i] = 0;
      mtLife[i] = kind === 2 ? (0.42 + nextRand() * 0.25) : (0.36 + nextRand() * 0.24);
      mtKind[i] = kind;
    }
  }

  function resolveSurface(x, z, playerState, sky, phenologyId) {
    const groundMat = sampleGroundMaterial(field, x, z);
    if (playerState?.onWood || groundMat === 'wood') return 'wood';
    if (playerState?.wading) return 'water';
    const surfY = sampleGroundSurface(field, x, z);
    const elevatedStone = groundMat === 'stone' && surfY > waterLevel + 0.22;
    if (!elevatedStone) {
      if (pond && Math.hypot(x - pond.x, z - pond.z) < (pond.waterRadius || (pond.radius || 8) * 0.68)) {
        return 'water';
      }
      if (field && typeof field.sample === 'function' && field.sample(x, z) < waterLevel + 0.18) {
        return 'water';
      }
    }
    const isSnow = phenologyId === 'winter' || (sky?.snowIntensity || 0) > 0.25 || sky?.weatherId === 'snow';
    if (isSnow && (groundMat === 'grass' || groundMat === 'dirt')) {
      return 'snow';
    }
    return groundMat;
  }

  function emitStep(x, z, yaw = 0, surface = 'dirt', opts = {}) {
    if (disposed || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const side = opts.side ?? stepSide;
    const running = Boolean(opts.running);
    const rain = Number(opts.rain ?? 0);
    const scale = Number(opts.scale ?? 1.0);
    const strideOffset = Number(opts.strideOffset ?? (0.135 * scale));
    const rippleScale = Number(opts.rippleScale ?? scale);
    const actor = opts.actor || 'player';
    // 左右履步 / 蹄爪偏移（垂直行进方向）
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const fx = x + rightX * (strideOffset * side);
    const fz = z + rightZ * (strideOffset * side);
    const surfY = sampleGroundSurface(field, fx, fz);

    if (surface === 'water') {
      const wy = Math.max(waterLevel, surfY) + 0.028;
      spawnRipple(fx, wy, fz, 0, 0, rippleScale);
      if (!opts.wakeOnly) {
        spawnRipple(fx, wy + 0.002, fz, 0, 0.14, rippleScale);
        spawnMotes(fx, wy, fz, 0, running ? 5 : (actor === 'fauna' ? 2 : 3), running ? 1.25 : 0.9);
      }
      bySurface.water++;
      if (byActor[actor] !== undefined) byActor[actor]++;
      totalEmitted++;
      return true;
    }

    if (surface === 'snow') {
      spawnPrint(fx, surfY + 0.018, fz, yaw, 0, scale);
      if (running || (actor === 'player' && nextRand() < 0.65)) {
        spawnMotes(fx, surfY + 0.02, fz, 1, running ? 4 : 2, running ? 1.05 : 0.7);
      }
      bySurface.snow++;
      if (byActor[actor] !== undefined) byActor[actor]++;
      totalEmitted++;
      return true;
    }

    if (surface === 'dirt') {
      if (rain > 0.25) {
        spawnPrint(fx, surfY + 0.017, fz, yaw, 1, scale);
        spawnRipple(fx, surfY + 0.022, fz, 1, 0, rippleScale);
        bySurface.mud++;
        bySurface.rainRipple++;
        if (byActor[actor] !== undefined) byActor[actor]++;
        totalEmitted++;
        return true;
      }
      if (running) {
        spawnMotes(fx, surfY + 0.02, fz, 2, 3, 0.85);
        bySurface.dust++;
        if (byActor[actor] !== undefined) byActor[actor]++;
        totalEmitted++;
        return true;
      }
      return false;
    }

    if (surface === 'stone' && rain > 0.28) {
      spawnRipple(fx, surfY + 0.022, fz, 1, 0, rippleScale);
      bySurface.rainRipple++;
      if (byActor[actor] !== undefined) byActor[actor]++;
      totalEmitted++;
      return true;
    }

    return false;
  }

  function flushMeshes(dt) {
    // 1. Ripples
    let rc = 0;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      if (!ripActive[i]) continue;
      ripAge[i] += dt;
      if (ripAge[i] < 0) continue; // 延迟次环等待中
      const u = ripAge[i] / ripLife[i];
      if (u >= 1) {
        ripActive[i] = 0;
        continue;
      }
      const easeOut = 1 - (1 - u) * (1 - u);
      const radScale = ripMinS[i] + (ripMaxS[i] - ripMinS[i]) * easeOut;
      // 末段 30% 平滑收细隐退
      const fade = u > 0.70 ? (1 - (u - 0.70) / 0.30) : 1;
      const sx = radScale * (0.4 + 0.6 * fade);
      _pos.set(ripX[i], ripY[i], ripZ[i]);
      _quat.identity();
      _scl.set(sx, 1, sx);
      _mat.compose(_pos, _quat, _scl);
      rippleMesh.setMatrixAt(rc, _mat);
      if (ripKind[i] === 0) {
        // 浅青水纹逐渐淡入水面
        _col.setRGB(0.86 - 0.16 * u, 0.94 - 0.12 * u, 0.91 - 0.10 * u);
      } else {
        // 雨天石板/土路微涟漪
        _col.setRGB(0.75 - 0.10 * u, 0.81 - 0.08 * u, 0.84 - 0.08 * u);
      }
      rippleMesh.setColorAt(rc, _col);
      rc++;
    }
    ripplesActive = rc;
    rippleMesh.count = rc;
    rippleMesh.visible = rc > 0;
    if (rc > 0) {
      rippleMesh.instanceMatrix.needsUpdate = true;
      if (rippleMesh.instanceColor) rippleMesh.instanceColor.needsUpdate = true;
    }

    // 2. Footprints (snow & rain-mud)
    let pc = 0;
    for (let i = 0; i < MAX_PRINTS; i++) {
      if (!prActive[i]) continue;
      prAge[i] += dt;
      const u = prAge[i] / prLife[i];
      if (u >= 1) {
        prActive[i] = 0;
        continue;
      }
      const fade = u > 0.72 ? (1 - (u - 0.72) / 0.28) : 1;
      const s = prScale[i] * (0.25 + 0.75 * fade);
      _pos.set(prX[i], prY[i], prZ[i]);
      _quat.setFromAxisAngle(_yAxis, prYaw[i]);
      _scl.set(s, 1, s);
      _mat.compose(_pos, _quat, _scl);
      printMesh.setMatrixAt(pc, _mat);
      if (prKind[i] === 0) {
        // 寒雪浅青灰凹印
        _col.setRGB(0.54 + 0.26 * u, 0.61 + 0.23 * u, 0.69 + 0.20 * u);
      } else {
        // 雨后暗湿夯土履印
        _col.setRGB(0.36 + 0.14 * u, 0.29 + 0.12 * u, 0.22 + 0.10 * u);
      }
      printMesh.setColorAt(pc, _col);
      pc++;
    }
    printsActive = pc;
    printMesh.count = pc;
    printMesh.visible = pc > 0;
    if (pc > 0) {
      printMesh.instanceMatrix.needsUpdate = true;
      if (printMesh.instanceColor) printMesh.instanceColor.needsUpdate = true;
    }

    // 3. Ballistic splash / snow / dust motes
    let mc = 0;
    for (let i = 0; i < MAX_MOTES; i++) {
      if (!mtActive[i]) continue;
      mtAge[i] += dt;
      const u = mtAge[i] / mtLife[i];
      if (u >= 1) {
        mtActive[i] = 0;
        continue;
      }
      const grav = mtKind[i] === 2 ? -1.4 : -3.8;
      mtVY[i] += grav * dt;
      mtX[i] += mtVX[i] * dt;
      mtY[i] += mtVY[i] * dt;
      mtZ[i] += mtVZ[i] * dt;
      const s = (mtKind[i] === 2 ? (0.85 + 0.8 * u) : 1.0) * (1 - u);
      _pos.set(mtX[i], mtY[i], mtZ[i]);
      _quat.setFromAxisAngle(_yAxis, u * 4.2 + i);
      _scl.set(s, s, s);
      _mat.compose(_pos, _quat, _scl);
      moteMesh.setMatrixAt(mc, _mat);
      if (mtKind[i] === 0) _col.setHex(0xebf7f4);
      else if (mtKind[i] === 1) _col.setHex(0xf0f6fa);
      else _col.setHex(0xbfa47c);
      moteMesh.setColorAt(mc, _col);
      mc++;
    }
    motesActive = mc;
    moteMesh.count = mc;
    moteMesh.visible = mc > 0;
    if (mc > 0) {
      moteMesh.instanceMatrix.needsUpdate = true;
      if (moteMesh.instanceColor) moteMesh.instanceColor.needsUpdate = true;
    }
  }

  function update(dt, _elapsed, playerState, sky, opts = {}) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.1);
    simTime += step;

    const phenologyId = opts.phenologyId || 'spring';
    const rain = Number(sky?.rainIntensity ?? 0);
    const snow = Number(sky?.snowIntensity ?? 0);
    const isSnowWeather = phenologyId === 'winter' || snow > 0.25 || sky?.weatherId === 'snow';

    // 1. 玩家步伐与起跳/落地微效同步
    if (playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z)) {
      const airborne = Boolean(playerState.airborne);
      if (playerState.aboardSkiff || playerState.godFlight || playerState.seated) {
        stepDist = 0;
        wasAirborne = false;
      } else {
        const yawNow = Number.isFinite(playerState.yaw) ? playerState.yaw : 0;
        if (playerState.justJumped || (airborne && !wasAirborne && (playerState.vy || 0) > 1.2)) {
          stepDist = 0;
          const surf = resolveSurface(playerState.x, playerState.z, playerState, sky, phenologyId);
          emitStep(playerState.x, playerState.z, yawNow, surf, { side: 0, running: true, rain, strideOffset: 0, scale: 0.92 });
        } else if (playerState.justLanded || (!airborne && wasAirborne)) {
          stepDist = 0;
          const surf = resolveSurface(playerState.x, playerState.z, playerState, sky, phenologyId);
          emitStep(playerState.x, playerState.z, yawNow, surf, { side: -1, running: true, rain, scale: 1.04 });
          emitStep(playerState.x, playerState.z, yawNow, surf, { side: 1, running: true, rain, scale: 1.04 });
        }
        if (airborne) {
          stepDist = 0;
        } else if (Number.isFinite(lastX)) {
          const dx = playerState.x - lastX;
          const dz = playerState.z - lastZ;
          const moved = Math.hypot(dx, dz);
          const speed = moved / Math.max(0.001, step);
          if (moved > 3.0) {
            stepDist = 0;
          } else if (speed > 0.3) {
            stepDist += moved;
            const running = speed > 5.4;
            const stride = running ? 2.0 : 1.35;
            if (stepDist >= stride) {
              stepDist -= stride;
              const moveYaw = moved > 0.02 ? Math.atan2(-dx, -dz) : yawNow;
              const surf = resolveSurface(playerState.x, playerState.z, playerState, sky, phenologyId);
              emitStep(playerState.x, playerState.z, moveYaw, surf, { side: stepSide, running, rain });
              stepSide *= -1;
            }
          } else {
            stepDist = 0;
          }
        }
        wasAirborne = airborne;
      }
      lastX = playerState.x;
      lastZ = playerState.z;
    }

    // 2. 附近雪地 / 雨泥漫步村人轻量化足迹采样（每 ~0.16s 巡检，零分配）
    const npcList = people?.list;
    if (npcList && npcList.length && (isSnowWeather || rain > 0.28) && playerState && Number.isFinite(playerState.x)) {
      npcPollAccum += step;
      if (npcPollAccum >= 0.16) {
        const dtPoll = npcPollAccum;
        npcPollAccum = 0;
        ensureNpcTrack(npcList.length);
        const px = playerState.x;
        const pz = playerState.z;
        for (let i = 0; i < npcList.length; i++) {
          const p = npcList[i];
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
          const distToPlayerSq = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
          if (distToPlayerSq > 22 * 22) {
            npcLastX[i] = p.x;
            npcLastZ[i] = p.z;
            npcDist[i] = 0;
            continue;
          }
          if (Number.isFinite(npcLastX[i])) {
            const dx = p.x - npcLastX[i];
            const dz = p.z - npcLastZ[i];
            const moved = Math.hypot(dx, dz);
            const spd = moved / Math.max(0.01, dtPoll);
            if (moved > 0.02 && moved < 2.5 && spd > 0.25) {
              npcDist[i] += moved;
              if (npcDist[i] >= 1.25) {
                npcDist[i] -= 1.25;
                const mat = sampleGroundMaterial(field, p.x, p.z);
                if (isSnowWeather && (mat === 'grass' || mat === 'dirt')) {
                  const nyaw = Math.atan2(-dx, -dz);
                  emitStep(p.x, p.z, nyaw, 'snow', { actor: 'villager', side: npcSide[i], scale: (p.s || 1) * 0.88 });
                  npcSide[i] = -npcSide[i];
                } else if (rain > 0.28 && mat === 'dirt') {
                  const nyaw = Math.atan2(-dx, -dz);
                  emitStep(p.x, p.z, nyaw, 'dirt', { actor: 'villager', side: npcSide[i], rain, scale: (p.s || 1) * 0.85 });
                  npcSide[i] = -npcSide[i];
                }
              }
            }
          }
          npcLastX[i] = p.x;
          npcLastZ[i] = p.z;
        }
      }
    }

    // 3. 附近水牛 / 大黄狗 / 池鸭的泥雪蹄爪印与浅滩水纹联动（零分配，复用同 3 个实例化池）
    const animals = fauna?.animals;
    if (animals && animals.length && playerState && Number.isFinite(playerState.x)) {
      faPollAccum += step;
      if (faPollAccum >= 0.16) {
        const dtPoll = faPollAccum;
        faPollAccum = 0;
        ensureFaunaTrack(animals.length);
        const px = playerState.x;
        const pz = playerState.z;
        const pondR = pond ? (pond.waterRadius || (pond.radius || 8) * 0.72) : 0;
        for (let i = 0; i < animals.length; i++) {
          const a = animals[i];
          if (!a || (a.kind !== 'ox' && a.kind !== 'dog' && a.kind !== 'duck')) continue;
          if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
          const distSq = (a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz);
          if (distSq > 26 * 26 || a.mode === 'sleep' || a.mode === 'rest') {
            faLastX[i] = a.x;
            faLastZ[i] = a.z;
            faDist[i] = 0;
            continue;
          }
          if (Number.isFinite(faLastX[i])) {
            const dx = a.x - faLastX[i];
            const dz = a.z - faLastZ[i];
            const moved = Math.hypot(dx, dz);
            const spd = moved / Math.max(0.01, dtPoll);
            if (moved > 0.02 && moved < 2.8 && spd > 0.18) {
              faDist[i] += moved;
              const strideLen = a.kind === 'ox' ? 1.12 : (a.kind === 'dog' ? 0.92 : 1.55);
              if (faDist[i] >= strideLen) {
                faDist[i] -= strideLen;
                const ayaw = Math.atan2(-dx, -dz);
                const inPond = pond && Math.hypot(a.x - pond.x, a.z - pond.z) < pondR;
                const inShallow = inPond || (field && typeof field.sample === 'function' && field.sample(a.x, a.z) < waterLevel + 0.24);
                if (a.kind === 'duck') {
                  if (inShallow) {
                    emitStep(a.x, a.z, ayaw, 'water', { actor: 'fauna', side: 0, strideOffset: 0, rippleScale: 0.76, wakeOnly: true });
                  }
                } else {
                  const isOx = a.kind === 'ox';
                  const printScale = isOx ? 1.18 : 0.56;
                  const sOff = isOx ? 0.24 : 0.095;
                  if (inShallow) {
                    emitStep(a.x, a.z, ayaw, 'water', { actor: 'fauna', side: faSide[i], scale: printScale, strideOffset: sOff, rippleScale: isOx ? 1.32 : 0.66 });
                    faSide[i] = -faSide[i];
                  } else {
                    const mat = sampleGroundMaterial(field, a.x, a.z);
                    if (isSnowWeather && (mat === 'grass' || mat === 'dirt')) {
                      emitStep(a.x, a.z, ayaw, 'snow', { actor: 'fauna', side: faSide[i], scale: printScale, strideOffset: sOff });
                      faSide[i] = -faSide[i];
                    } else if (rain > 0.28 && (mat === 'dirt' || (isOx && mat === 'grass'))) {
                      emitStep(a.x, a.z, ayaw, 'dirt', { actor: 'fauna', side: faSide[i], rain, scale: printScale, strideOffset: sOff, rippleScale: isOx ? 1.15 : 0.62 });
                      faSide[i] = -faSide[i];
                    }
                  }
                }
              }
            }
          }
          faLastX[i] = a.x;
          faLastZ[i] = a.z;
        }
      }
    }

    flushMeshes(step);
  }

  function getStats() {
    return {
      simTime,
      ripplesActive,
      printsActive,
      motesActive,
      totalEmitted,
      bySurface: {
        water: bySurface.water,
        snow: bySurface.snow,
        mud: bySurface.mud,
        dust: bySurface.dust,
        rainRipple: bySurface.rainRipple
      },
      byActor: {
        player: byActor.player,
        villager: byActor.villager,
        fauna: byActor.fauna
      }
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    rippleGeo.dispose();
    rippleMat.dispose();
    printGeo.dispose();
    printMat.dispose();
    moteGeo.dispose();
    moteMat.dispose();
  }

  return { group, update, emitStep, getStats, dispose };
}
