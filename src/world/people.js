import * as THREE from 'three';
import { makePeopleParts } from '../character-parts.js';
import {
  livingStep, sightClear, habitatAllows, safeSegment, createEncounter, encounterEvent,
  capsuleProfile, capsuleGap
} from '../systems/living-behavior.js';

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

// 略带滞回，避免雨量在阈值附近波动时反复出檐、回檐。
export function rainStateForIntensity(intensity, wasRaining) {
  return intensity >= (wasRaining ? 0.06 : 0.12);
}

export function createPeople(cfg, field, houses, road, plots, blockers = []) {
  const rand = lcg(90117);
  const parts = makePeopleParts(cfg);
  const clothes = cfg.clothes.map(c => new THREE.Color(c));
  const pants = cfg.pants.map(c => new THREE.Color(c));
  const cSkin = new THREE.Color(cfg.skin);
  const cCuff = new THREE.Color(cfg.cuff);
  const list = [];
  const total = road.total;

  function add(o) {
    o.s = o.s || 1;
    o.phase = rand() * Math.PI * 2;
    o.gait = o.phase;
    o.motion = 0;
    o.role = o.role || 'villager';
    o.baseYaw = o.yaw || 0;
    o.noticeK = 0;
    o.rainRest = 0;
    o.greetT = 0;
    o.greetMax = 0;
    o.greetYaw = 0;
    o.nextPause = 12 + rand() * 24;
    o.pauseT = 0;
    o.encounterReady = 0;
    o.body = clothes[(rand() * clothes.length) | 0];
    o.legs = pants[(rand() * pants.length) | 0];
    o.hat = rand() < 0.55;
    list.push(o);
  }

  const walkers = cfg.walkers === undefined ? 3 : cfg.walkers;
  for (let i = 0; i < walkers; i++) {
    add({
      mode: 'road', at: total * (0.12 + rand() * 0.18), dir: i % 2 === 0 ? 1 : -1,
      speed: 0.85 + rand() * 0.45, lo: total * 0.1, hi: total * 0.9,
      s: 0.96 + rand() * 0.1, role: 'walker'
    });
  }
  const talks = cfg.talkPairs === undefined ? 2 : cfg.talkPairs;
  for (let i = 0; i < talks; i++) {
    const hi = houses[(i * 2 + 1) % houses.length];
    const ang = rand() * Math.PI * 2;
    const cx = hi.doorX + Math.cos(ang) * (1.5 + rand() * 0.6);
    const cz = hi.doorZ + Math.sin(ang) * (1.5 + rand() * 0.6);
    const n = 2 + (rand() < 0.45 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const a2 = (k / n) * Math.PI * 2 + ang;
      const x = cx + Math.cos(a2) * 0.62;
      const z = cz + Math.sin(a2) * 0.62;
      add({ socialGroup: i, mode: 'talk', x, z, yaw: Math.atan2(cx - x, cz - z), s: 0.94 + rand() * 0.1, role: 'talker' });
    }
  }
  for (let i = 0; i < houses.length; i += 3) {
    const hi = houses[i];
    const ox = Math.cos(hi.rot) * 1.35;
    const oz = -Math.sin(hi.rot) * 1.35;
    add({ mode: 'sit', x: hi.doorX + ox, z: hi.doorZ + oz, yaw: Math.atan2(hi.doorX - hi.x, hi.doorZ - hi.z), s: 0.92, role: 'elder' });
  }
  for (let i = 0; i < Math.min(2, plots.length); i++) {
    const p = plots[i];
    add({ mode: 'work', x: p[0] + (rand() - 0.5) * 2, z: p[1] + (rand() - 0.5) * 2, yaw: rand() * Math.PI * 2, role: 'worker' });
  }
  add({ mode: 'road', at: total * 0.45, dir: 1, speed: 0.42, lo: total * 0.3, hi: total * 0.7, s: 0.86, basket: true, role: 'basket' });
  const childHouse = houses[1 % houses.length];
  const kidN = cfg.children === undefined ? 2 : cfg.children;
  for (let i = 0; i < kidN; i++) {
    add({ mode: 'circle', cx: childHouse.doorX, cz: childHouse.doorZ, radius: 3.2 + i * 1.4, ang: rand() * Math.PI * 2, speed: 0.55 + rand() * 0.2, s: 0.62 + rand() * 0.05, role: 'child', hat: false });
  }

  const n = list.length;
  const living = cfg.living || {};
  const lifeRand = lcg(73391);
  let lifeClock = 0;
  const socialGroups = Array.from({ length: talks }, (_, id) => list.filter(p => p.socialGroup === id));
  for (let i = 0; i < n; i++) {
    const p = list[i];
    p.activity = p.mode === 'work' ? 'work' : p.mode === 'circle' ? 'play' : p.mode === 'sit' ? 'rest' : 'travel';
    p.speaking = false; p.attention = 'none'; p.socialTurn = -1;
    p.encounter = createEncounter(); p.ackCount = 0; p.ackUntil = 0;
    p.nextThink = i / n * (living.thinkInterval ?? 0.2); p.lastThink = 0;
    p.activityUntil = 8 + lifeRand() * 14; p.restUntil = 0;
    p.nextDelivery = 12 + lifeRand() * 16; p.delivery = null;
    p.headYaw = 0; p.headPitch = 0; p.yieldOffset = 0; p.avoidX = 0; p.avoidZ = 0; p.gazeYaw = 0; p.speakerDir = 0;
    p.homeSpotX = p.x; p.homeSpotZ = p.z;
    p.nightReturning = false;
    p.shelterSlot = (i % 3) - 1;
    p.rainChatting = false;
    p.taskKind = 'hoe';
    p.taskUntil = 4.5 + lifeRand() * 4.5;
    p.spotIdx = 0;
    if (p.mode === 'work' && p.x !== undefined) {
      const bx = p.x, bz = p.z;
      p.workSpots = [
        { x: bx, z: bz },
        { x: bx + 2.2, z: bz - 1.3 },
        { x: bx - 1.8, z: bz - 1.6 },
        { x: bx - 2.0, z: bz + 1.4 }
      ];
    } else {
      p.workSpots = null;
    }
    if (houses.length) {
      const rx = p.x !== undefined ? p.x : road.at(p.at || 0).x;
      const rz = p.z !== undefined ? p.z : road.at(p.at || 0).z;
      let nearestH = houses[i % houses.length];
      let bestD = Infinity;
      for (const h of houses) {
        const d = Math.hypot(h.doorX - rx, h.doorZ - rz);
        if (d < bestD) { bestD = d; nearestH = h; }
      }
      const sideOff = ((i % 3) - 1) * 0.44;
      const tx = Math.cos(nearestH.rot), tz = -Math.sin(nearestH.rot);
      p.nightHome = {
        x: nearestH.doorX + tx * sideOff,
        z: nearestH.doorZ + tz * sideOff,
        yaw: Math.atan2(nearestH.doorX - nearestH.x, nearestH.doorZ - nearestH.z)
      };
      if (p.mode === 'talk' && p.x !== undefined) {
        const rx2 = p.x + (nearestH.doorX - p.x) * 0.42;
        const rz2 = p.z + (nearestH.doorZ - p.z) * 0.42;
        const canStepEave = Math.hypot(nearestH.doorX - p.x, nearestH.doorZ - p.z) < 4.8 &&
          sightClear(p.x, p.z, rx2, rz2, blockers);
        p.rainSpotX = canStepEave ? rx2 : p.x;
        p.rainSpotZ = canStepEave ? rz2 : p.z;
      }
    } else {
      p.nightHome = null;
    }
  }
  // 秦汉男女发式与衣色分流：不消耗 rand()，保持既有路径与站位确定性一致。
  const femaleClothes = ['#D4B6AA', '#B8C4AE', '#CAB896', '#9FB0B8', '#D1A999', '#B7A58E'].map(c => new THREE.Color(c));
  let adultSocialIdx = 0;
  for (let i = 0; i < n; i++) {
    const p = list[i];
    if (p.role === 'basket') {
      p.female = true;
    } else if (p.role === 'walker' || p.role === 'talker') {
      p.female = (adultSocialIdx++ % 2 === 1);
    } else {
      p.female = false;
    }
    if (p.female) {
      p.body = femaleClothes[i % femaleClothes.length];
      if (p.role === 'talker' || p.role === 'basket') p.hat = false;
    }
  }
  // 仍保留命名批次；每人只提交一种头型（男髻 / 妇人垂鬟椎髻 / 老者 / 总角），不靠零缩放矩阵隐藏多余头。
  const headCounts = { adult: 0, female: 0, elder: 0, child: 0, hat: 0 };
  for (const p of list) {
    const role = p.role === 'elder' ? 'elder' : p.role === 'child' ? 'child' : p.female ? 'female' : 'adult';
    p.headRole = role;
    p.headIndex = headCounts[role]++;
    p.hatIndex = p.hat && role !== 'child' ? headCounts.hat++ : -1;
  }
  function instanced(geo, count, name, material) {
    const mesh = new THREE.InstancedMesh(geo, material || new THREE.MeshLambertMaterial({ flatShading: true }), Math.max(1, count));
    mesh.name = name;
    mesh.count = count;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5);
    return mesh;
  }
  const detailMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const torsoMesh = instanced(parts.robe, n, 'people-torso');
  const trimMesh = instanced(parts.trim, n, 'people-trim', trimMat);
  const headMesh = instanced(parts.head, headCounts.adult, 'people-head', detailMat);
  const femaleMesh = instanced(parts.femaleHead, headCounts.female, 'people-female-head', detailMat);
  const elderMesh = instanced(parts.elderHead, headCounts.elder, 'people-elder-head', detailMat);
  const childMesh = instanced(parts.childHead, headCounts.child, 'people-child-head', detailMat);
  const hatMesh = instanced(parts.hat, headCounts.hat, 'people-hat', detailMat);
  const armLMesh = instanced(parts.sleeve, n, 'people-arm-l');
  const armRMesh = instanced(parts.sleeve, n, 'people-arm-r');
  const cuffMesh = instanced(parts.cuff, n * 2, 'people-cuff');
  const handMesh = instanced(parts.hand, n * 2, 'people-hand', new THREE.MeshLambertMaterial({ color: cfg.skin, flatShading: true }));
  const legLMesh = instanced(parts.leg, n, 'people-leg-l');
  const legRMesh = instanced(parts.leg, n, 'people-leg-r');
  const shoeMesh = instanced(parts.shoe, n * 2, 'people-shoe', detailMat);
  const basketList = list.filter(p => p.basket);
  for (let i = 0; i < basketList.length; i++) basketList[i].bi = i;
  const basketMesh = instanced(parts.basket, basketList.length, 'people-basket', detailMat);
  const sitList = list.filter(p => p.mode === 'sit');
  for (let i = 0; i < sitList.length; i++) sitList[i].si = i;
  const stoolMesh = instanced(parts.stool, sitList.length, 'people-stool', detailMat);
  for (let i = 0; i < n; i++) {
    const p = list[i];
    torsoMesh.setColorAt(i, p.body);
    armLMesh.setColorAt(i, p.body);
    armRMesh.setColorAt(i, p.body);
    cuffMesh.setColorAt(i * 2, cCuff);
    cuffMesh.setColorAt(i * 2 + 1, cCuff);
    legLMesh.setColorAt(i, p.legs);
    legRMesh.setColorAt(i, p.legs);
  }
  const group = new THREE.Group();
  group.name = 'people';
  group.add(torsoMesh, trimMesh, headMesh, femaleMesh, elderMesh, childMesh, hatMesh, armLMesh, armRMesh, cuffMesh, handMesh, legLMesh, legRMesh, shoeMesh, basketMesh, stoolMesh);
  const _dummy = new THREE.Object3D();
  function setPart(mesh, idx, x, y, z, yaw, pitch, sx, sy, sz, roll = 0) {
    _dummy.position.set(x, y, z);
    _dummy.rotation.set(pitch, yaw, roll, 'YXZ');
    _dummy.scale.set(sx, sy, sz);
    _dummy.updateMatrix();
    mesh.setMatrixAt(idx, _dummy.matrix);
  }
  function handAt(idx, x, y, z, yaw, pitch, roll, len, s) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const dx = sr * cy - cr * sp * sy, dy = -cr * cp, dz = -sr * sy - cr * sp * cy;
    const d = len * s;
    setPart(handMesh, idx, x + dx * d, y + dy * d, z + dz * d, yaw, pitch, s, s, s, roll);
  }

  function greet(index, px, pz, duration) {
    const p = list[index];
    if (!p) return null;
    p.greetT = duration;
    p.ackUntil = 0; p.attention = 'player'; p.speaking = false;
    p.encounter.armed = false; p.encounter.dwell = 0;
    p.greetMax = duration;
    p.greetYaw = Math.atan2(px - p.x, pz - p.z);
    return { index, role: p.role };
  }
  let raining = false;
  const _cap = { rear: 0, front: 0, radius: 0.3, mass: 1 };
  const _gap = { dist: 0, minDist: 0, gap: 0, overlap: 0, nx: 0, nz: 1, s: 0, t: 0 };
  const _habCtx = {};

  function personClearMove(ax, az, nx, nz, context) {
    if (!Number.isFinite(nx) || !Number.isFinite(nz)) return false;
    if (!clearPath(ax, az, nx, nz)) return false;
    if (!habitatAllows('person', nx, nz, context, field)) return false;
    return !(field.slope && field.slope(nx, nz) > 0.55);
  }

  function readAnimalCapsule(b) {
    if (b.capRadius !== undefined) {
      _cap.rear = b.capRear || 0;
      _cap.front = b.capFront || 0;
      _cap.radius = b.capRadius;
    } else if (b.radius !== undefined && (b.rear !== undefined || b.front !== undefined)) {
      _cap.rear = b.rear || 0;
      _cap.front = b.front || 0;
      _cap.radius = b.radius;
    } else {
      capsuleProfile(b.kind || 'ox', b.scale, _cap);
    }
    return _cap;
  }

  function minAnimalClearanceAt(tx, tz, rP, context) {
    let minGap = 99;
    for (let src = 0; src < 2; src++) {
      const arr = src === 0 ? context.animals : context.extraAnimals;
      if (!arr) continue;
      for (let j = 0; j < arr.length; j++) {
        const b = arr[j];
        if (!b || b.kind === 'bird' || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
        if (Math.abs(b.x - tx) > 3.6 || Math.abs(b.z - tz) > 3.6) continue;
        const cp = readAnimalCapsule(b);
        capsuleGap(tx, tz, 0, 0, 0, rP, b.x, b.z, b.yaw || 0, cp.rear, cp.front, cp.radius, _gap);
        if (_gap.gap < minGap) minGap = _gap.gap;
      }
    }
    return minGap;
  }

  function computeRoadLaneYield(p, idx, context) {
    let goal = p.pauseT > 0 ? (p.yieldGoal || 0) : 0;
    const ra = road.at(p.at);
    const lx = ra.x - ra.nx * 0.9, lz = ra.z - ra.nz * 0.9;
    let hasOncoming = false, oncomingEnv = 0;
    let samePeer = null, sameIdx = -1, sameEnv = 0;
    for (let j = 0; j < n; j++) {
      if (j === idx) continue;
      const q = list[j];
      if (q.mode === 'road' && !q.shelter && !q.delivery) {
        const dAt = Math.abs((q.at || 0) - p.at);
        if (dAt < 3.6) {
          const env = Math.min(1, (3.6 - dAt) / 1.5);
          if (q.dir !== p.dir) {
            hasOncoming = true;
            if (env > oncomingEnv) oncomingEnv = env;
            if (dAt < 2.2 && p.greetT <= 0 && context?.timeId !== 'night') {
              p.peerNodEnv = Math.max(p.peerNodEnv || 0, env);
            }
          } else if (env > sameEnv) {
            sameEnv = env;
            samePeer = q;
            sameIdx = j;
          }
        }
      } else if (q.x !== undefined && q.z !== undefined) {
        const dq = Math.hypot(q.x - lx, q.z - lz);
        if (dq < 1.8) {
          const env = Math.min(1, (1.8 - dq) / 0.9);
          const qLat = -((q.x - lx) * ra.nx + (q.z - lz) * ra.nz);
          const want = (qLat >= 0 ? -0.46 : 0.46) * env;
          if (Math.abs(want) > Math.abs(goal)) goal = want;
        }
      }
    }
    if (hasOncoming && samePeer) {
      const faster = Math.abs(p.speed - samePeer.speed) > 1e-3 ? p.speed > samePeer.speed : idx < sameIdx;
      const env = Math.max(oncomingEnv, sameEnv);
      const want = p.dir * (faster ? 0.04 : 0.62) * env;
      if (Math.abs(want) > Math.abs(goal) || p.pauseT <= 0) goal = want;
    } else if (hasOncoming) {
      const want = p.dir * 0.52 * oncomingEnv;
      if (Math.abs(want) > Math.abs(goal)) goal = want;
    } else if (samePeer) {
      const faster = Math.abs(p.speed - samePeer.speed) > 1e-3 ? p.speed > samePeer.speed : idx < sameIdx;
      const want = p.dir * (faster ? -0.38 : 0.38) * sameEnv;
      if (Math.abs(want) > Math.abs(goal)) goal = want;
    }
    const extraActors = context.extraActors;
    if (extraActors) {
      for (let j = 0; j < extraActors.length; j++) {
        const q = extraActors[j];
        if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.z)) continue;
        const dq = Math.hypot(q.x - lx, q.z - lz);
        if (dq < 1.8) {
          const env = Math.min(1, (1.8 - dq) / 0.9);
          const qLat = -((q.x - lx) * ra.nx + (q.z - lz) * ra.nz);
          const want = (qLat >= 0 ? -0.46 : 0.46) * env;
          if (Math.abs(want) > Math.abs(goal)) goal = want;
        }
      }
    }
    return goal;
  }

  function updateParametricAvoidance(p, idx, baseX, baseZ, fwdX, fwdZ, speed, dt, context) {
    const rP = (p.basket ? 0.34 : 0.30) * p.s;
    const curX = baseX + p.avoidX, curZ = baseZ + p.avoidZ;
    const avLen = Math.hypot(p.avoidX, p.avoidZ);
    const prefX = avLen > 0.08 ? fwdX * 0.55 + (p.avoidX / avLen) * 0.65 : fwdX;
    const prefZ = avLen > 0.08 ? fwdZ * 0.55 + (p.avoidZ / avLen) * 0.65 : fwdZ;

    let pushX = 0, pushZ = 0, speedScale = 1;
    let activeThreat = false;

    for (let src = 0; src < 2; src++) {
      const arr = src === 0 ? context.animals : context.extraAnimals;
      if (!arr) continue;
      for (let j = 0; j < arr.length; j++) {
        const b = arr[j];
        if (!b || b.kind === 'bird' || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
        if (Math.abs(b.x - curX) > 4.2 || Math.abs(b.z - curZ) > 4.2) continue;
        const cp = readAnimalCapsule(b);
        capsuleGap(curX, curZ, 0, 0, 0, rP, b.x, b.z, b.yaw || 0, cp.rear, cp.front, cp.radius, _gap);
        const isCattle = b.kind === 'ox' || b.kind === 'buffalo';
        const margin = isCattle ? 0.64 : 0.28;
        if (_gap.gap >= margin) continue;

        activeThreat = true;
        if (isCattle && p.pauseT > 0 && p.greetT <= 0 && lifeClock >= p.ackUntil && _gap.gap < 0.34) {
          p.pauseT = 0;
          p.pauseYaw = undefined;
        }
        const nx = _gap.nx, nz = _gap.nz;
        const tLx = -nz, tLz = nx;
        const tRx = nz, tRz = -nx;
        const dL = prefX * tLx + prefZ * tLz;
        const dR = prefX * tRx + prefZ * tRz;
        const pickL = Math.abs(dL - dR) > 0.04 ? dL > dR : (idx % 2 === 0);
        let tx = pickL ? tLx : tRx, tz = pickL ? tLz : tRz;
        const probeX = curX + (tx * 0.78 + nx * 0.42) * 0.42;
        const probeZ = curZ + (tz * 0.78 + nz * 0.42) * 0.42;
        if (!personClearMove(curX, curZ, probeX, probeZ, context)) {
          const altTx = pickL ? tRx : tLx, altTz = pickL ? tRz : tLz;
          const altPx = curX + (altTx * 0.78 + nx * 0.42) * 0.42;
          const altPz = curZ + (altTz * 0.78 + nz * 0.42) * 0.42;
          if (personClearMove(curX, curZ, altPx, altPz, context)) {
            tx = altTx; tz = altTz;
          }
        }
        const u = Math.min(1, (margin - _gap.gap) / margin);
        const outW = _gap.gap < 0.14 ? 0.88 : 0.46 * u;
        const tanW = 0.76 * u;
        pushX += nx * outW + tx * tanW;
        pushZ += nz * outW + tz * tanW;

        if (_gap.gap < 0.26 && (fwdX * nx + fwdZ * nz) < -0.10) {
          const s = Math.max(0, (_gap.gap + 0.02) / 0.28);
          if (s < speedScale) speedScale = s;
        }
      }
    }

    if (activeThreat) {
      const pl = Math.hypot(pushX, pushZ);
      if (pl > 1e-6) {
        const step = Math.max(0.95, speed * 1.32) * dt;
        let nax = p.avoidX + (pushX / pl) * step;
        let naz = p.avoidZ + (pushZ / pl) * step;
        const nl = Math.hypot(nax, naz);
        if (nl > 2.4) { nax = (nax / nl) * 2.4; naz = (naz / nl) * 2.4; }
        if (personClearMove(curX, curZ, baseX + nax, baseZ + naz, context)) {
          p.avoidX = nax;
          p.avoidZ = naz;
        }
      }
    } else if (avLen > 1e-4) {
      const decay = Math.exp(-2.1 * dt);
      const dax = avLen * decay < 1e-4 ? 0 : p.avoidX * decay;
      const daz = avLen * decay < 1e-4 ? 0 : p.avoidZ * decay;
      const candX = baseX + dax, candZ = baseZ + daz;
      if (personClearMove(curX, curZ, candX, candZ, context) && minAnimalClearanceAt(candX, candZ, rP, context) >= 0.24) {
        p.avoidX = dax;
        p.avoidZ = daz;
      }
    }
    return speedScale;
  }

  function tryDisplacePerson(ax, az, dx, dz, context, outPos) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const nx = ax + dx, nz = az + dz;
    if (personClearMove(ax, az, nx, nz, context)) {
      outPos.x = nx; outPos.z = nz;
      return true;
    }
    const ux = dx / len, uz = dz / len;
    for (let s = -1; s <= 1; s += 2) {
      const rx = ux * 0.62 - uz * s * 0.78;
      const rz = ux * s * 0.78 + uz * 0.62;
      const sx = ax + rx * len, sz = az + rz * len;
      if (personClearMove(ax, az, sx, sz, context)) {
        outPos.x = sx; outPos.z = sz;
        return true;
      }
    }
    return false;
  }
  const _sepPos = { x: 0, z: 0 };
  function clearPath(ax, az, bx, bz) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.15));
    for (let j = 0; j <= steps; j++) {
      const x = ax + (bx - ax) * j / steps, z = az + (bz - az) * j / steps;
      for (const b of blockers) {
        const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
        if (Math.abs(dx * c - dz * s) < b.hw + 0.08 && Math.abs(dx * s + dz * c) < b.hd + 0.08) return false;
      }
    }
    return true;
  }
  function findShelter(p) {
    let best = null;
    const slotOff = (p.shelterSlot || 0) * 0.42;
    for (const h of houses) {
      const d = Math.hypot(h.doorX - p.x, h.doorZ - p.z);
      if (d >= 18 || (best && d >= best.d)) continue;
      const tx = Math.cos(h.rot), tz = -Math.sin(h.rot);
      const outYaw = Math.atan2(h.doorX - h.x, h.doorZ - h.z);
      const sx = h.doorX + tx * slotOff;
      const sz = h.doorZ + tz * slotOff;
      if (slotOff !== 0 && clearPath(p.x, p.z, sx, sz)) {
        best = { x: sx, z: sz, d, outYaw };
      } else if (clearPath(p.x, p.z, h.doorX, h.doorZ)) {
        best = { x: h.doorX, z: h.doorZ, d, outYaw };
      }
    }
    return best;
  }
  function update(dt, elapsed, px, pz, context = {}) {
    dt = livingStep(dt);
    if (!dt) return;
    lifeClock += dt;
    elapsed = lifeClock; // deadlines/poses freeze with simulation, not wall time
    const enabled = living.enabled !== false;
    const interval = Math.max(0.1, living.thinkInterval ?? 0.2);
    for (const p of list) {
      if (enabled && lifeClock >= p.nextThink && p.poseReady) {
        const step = Math.min(0.3, lifeClock - p.lastThink);
        p.lastThink = lifeClock; p.nextThink = lifeClock + interval;
        const distance = Math.hypot(px - p.x, pz - p.z);
        if (p.greetT <= 0 && !p.shelter && encounterEvent(p.encounter, distance,
          distance < (living.noticeRange ?? 4.2) && sightClear(p.x, p.z, px, pz, blockers), step,
          { range: living.noticeRange ?? 4.2, exitRange: living.exitRange ?? 6, dwell: living.noticeDwell ?? 0.4 })) {
          p.ackUntil = lifeClock + (living.ackDuration ?? 1.6); p.ackCount++;
          p.attentionYaw = Math.atan2(px - p.x, pz - p.z);
        }
        if (p.mode === 'work' && lifeClock >= p.activityUntil) {
          p.restUntil = lifeClock + (living.workRest ?? 3.5);
          p.activityUntil = p.restUntil + 18 + lifeRand() * 14;
        }
        if (p.mode === 'work' && context.timeId !== 'night' && !raining && lifeClock >= p.taskUntil) {
          const cycleOrder = ['hoe', 'weed', 'wipe', 'stroll'];
          const curIdx = cycleOrder.indexOf(p.taskKind);
          const nextTask = cycleOrder[(curIdx + 1) % cycleOrder.length];
          p.taskKind = nextTask;
          if (nextTask === 'hoe') p.taskUntil = lifeClock + 5.5 + lifeRand() * 4.5;
          else if (nextTask === 'weed') p.taskUntil = lifeClock + 4.5 + lifeRand() * 3.5;
          else if (nextTask === 'wipe') p.taskUntil = lifeClock + 2.0 + lifeRand() * 1.2;
          else {
            p.taskUntil = lifeClock + 3.2 + lifeRand() * 2.0;
            if (p.workSpots && p.workSpots.length > 1) {
              for (let tries = 0; tries < p.workSpots.length; tries++) {
                p.spotIdx = (p.spotIdx + 1) % p.workSpots.length;
                const cand = p.workSpots[p.spotIdx];
                const slopeOk = !(field.slope && field.slope(cand.x, cand.z) > 0.48);
                if (slopeOk && clearPath(p.x, p.z, cand.x, cand.z)) {
                  p.workTarget = cand;
                  break;
                }
              }
            }
          }
        }
        if (p.mode === 'circle' && lifeClock >= p.activityUntil && p.greetT <= 0 && !raining) {
          p.restUntil = lifeClock + 2 + lifeRand();
          p.activityUntil = p.restUntil + 12 + lifeRand() * 14;
          p.animalLook = false;
          let nearest = 4;
          for (const a of context.animals || []) {
            const d = Math.hypot(a.x - p.x, a.z - p.z);
            if (d < nearest && sightClear(p.x, p.z, a.x, a.z, blockers)) {
              nearest = d; p.animalLook = true; p.attentionYaw = Math.atan2(a.x - p.x, a.z - p.z);
            }
          }
        }
        // A single short, reversible doorstep errand; no route graph or teleport.
        if (p.basket && !p.delivery && !p.shelter && !raining && p.greetT <= 0 && lifeClock >= p.nextDelivery) {
          p.nextDelivery = lifeClock + 28 + lifeRand() * 18;
          let best = null, nearest = living.deliveryRange ?? 3;
          for (const k in _habCtx) delete _habCtx[k];
          Object.assign(_habCtx, context);
          _habCtx.blockers = blockers;
          for (const h of houses) {
            const d = Math.hypot(h.doorX - p.x, h.doorZ - p.z);
            if (d > 0.45 && d < nearest && safeSegment('person', p.x, p.z, h.doorX, h.doorZ, _habCtx, field)) {
              best = h; nearest = d;
            }
          }
          if (best) p.delivery = { x: p.x, z: p.z, tx: best.doorX, tz: best.doorZ, phase: 'out', waitUntil: 0 };
        }
      }
      p.speaking = false; p.socialTurn = -1;
      p.attention = p.greetT > 0 || lifeClock < p.ackUntil ? 'player' : lifeClock < p.restUntil && p.animalLook ? 'animal' : 'none';
      p.activity = p.mode === 'work' ? (raining || lifeClock < p.restUntil || context.timeId === 'night' ? 'rest' : 'work')
        : p.mode === 'circle' ? (lifeClock < p.restUntil ? 'look' : 'play') : p.mode === 'sit' ? 'rest' : 'travel';
      if (p.attention === 'player') p.activity = 'look';
    }
    // One speaker per actual porch group; listeners visually track the speaker and nod lightly.
    for (let g = 0; g < socialGroups.length; g++) {
      const members = socialGroups[g];
      const beat = (lifeClock + g * 1.17) / (living.talkTurn ?? 3.6);
      const turn = Math.floor(beat) % members.length;
      const speaker = members[turn];
      for (let j = 0; j < members.length; j++) {
        const p = members[j];
        p.socialTurn = turn;
        p.speaking = p.greetT <= 0 && p.attention !== 'player' && (!enabled || (j === turn && beat % 1 < 0.73 && context.timeId !== 'night'));
        if (p.attention !== 'player') { p.activity = p.speaking ? 'talk' : 'listen'; p.attention = 'social'; }
        if (speaker && speaker !== p && speaker.x !== undefined && p.x !== undefined) {
          let rel = Math.atan2(speaker.x - p.x, speaker.z - p.z) - (p.yaw || 0);
          while (rel > Math.PI) rel -= Math.PI * 2;
          while (rel < -Math.PI) rel += Math.PI * 2;
          p.speakerDir = Math.max(-0.68, Math.min(0.68, rel));
        } else {
          p.speakerDir = 0;
        }
      }
    }
    if (!raining) for (let i = 0; i < n; i++) {
      const a = list[i];
      if (a.mode !== 'road' || a.shelter || a.greetT > 0 || a.pauseT > 0 || elapsed < a.encounterReady || a.x === undefined) continue;
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        if (b.mode !== 'road' || b.dir === a.dir || b.shelter || b.greetT > 0 || b.pauseT > 0 || elapsed < b.encounterReady || b.x === undefined) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 2.2) {
          a.pauseT = b.pauseT = 1.1 + rand() * 0.9;
          a.pauseYaw = Math.atan2(dx, dz);
          b.pauseYaw = Math.atan2(-dx, -dz);
          a.yieldGoal = a.dir * 0.34;
          b.yieldGoal = b.dir * 0.34;
          a.encounterReady = b.encounterReady = elapsed + 16;
          break;
        }
      }
    }
    let allMinX = Infinity, allMinY = Infinity, allMinZ = Infinity, allMaxX = -Infinity, allMaxY = -Infinity, allMaxZ = -Infinity;
    let adMinX = Infinity, adMinY = Infinity, adMinZ = Infinity, adMaxX = -Infinity, adMaxY = -Infinity, adMaxZ = -Infinity;
    let feMinX = Infinity, feMinY = Infinity, feMinZ = Infinity, feMaxX = -Infinity, feMaxY = -Infinity, feMaxZ = -Infinity;
    let elMinX = Infinity, elMinY = Infinity, elMinZ = Infinity, elMaxX = -Infinity, elMaxY = -Infinity, elMaxZ = -Infinity;
    let chMinX = Infinity, chMinY = Infinity, chMinZ = Infinity, chMaxX = -Infinity, chMaxY = -Infinity, chMaxZ = -Infinity;
    let haMinX = Infinity, haMinY = Infinity, haMinZ = Infinity, haMaxX = -Infinity, haMaxY = -Infinity, haMaxZ = -Infinity;
    let baMinX = Infinity, baMinY = Infinity, baMinZ = Infinity, baMaxX = -Infinity, baMaxY = -Infinity, baMaxZ = -Infinity;
    let stMinX = Infinity, stMinY = Infinity, stMinZ = Infinity, stMaxX = -Infinity, stMaxY = -Infinity, stMaxZ = -Infinity;
    const isNight = context.timeId === 'night';
    for (let i = 0; i < n; i++) {
      const p = list[i];
      let yaw = p.yaw || 0;
      let x = p.x || 0, z = p.z || 0;
      let bob = 0, pitch = 0, armL = 0, armR = 0, rollL = 0, rollR = 0;
      let legL = 0, legR = 0;
      let footLiftL = 0, footLiftR = 0;
      let nightSeated = false;
      let walkingMove = false;
      const sitBase = p.mode === 'sit';
      let greetK = 0;
      if (p.greetT > 0) {
        p.greetT = Math.max(0, p.greetT - dt);
        const enter = Math.min(1, (p.greetMax - p.greetT) / 0.22);
        const leave = Math.min(1, p.greetT / 0.35);
        greetK = Math.min(enter, leave);
        greetK = greetK * greetK * (3 - 2 * greetK);
        if (px !== undefined) p.greetYaw = Math.atan2(px - p.x, pz - p.z);
      }
      if (raining || isNight) { p.pauseT = 0; p.pauseYaw = undefined; if (p.delivery) p.delivery.phase = 'back'; }
      if (enabled && p.mode === 'circle' && lifeClock < p.restUntil && p.greetT <= 0 && !raining && !isNight) p.pauseT = Math.max(p.pauseT, dt * 2);
      if (!raining && !isNight && !p.shelter && p.greetT <= 0 && (p.mode === 'road' || p.mode === 'circle')) {
        if (p.pauseT > 0) {
          p.pauseT = Math.max(0, p.pauseT - dt);
          if (!p.pauseT) p.pauseYaw = undefined;
        } else if (elapsed >= p.nextPause) {
          p.pauseT = p.mode === 'circle' ? 1 + rand() * 1.2 : 2 + rand() * 2;
          p.nextPause = elapsed + 22 + rand() * 28;
        }
      }
      let paused = !raining && !isNight && !p.shelter && p.pauseT > 0 && p.greetT <= 0;
      const twilightView = (context.timeId === 'dawn' || context.timeId === 'dusk') && !raining;
      let headTargetYaw = Math.sin(elapsed * 0.42 + p.phase * 1.7) * 0.10;
      let headTargetPitch = twilightView ? -0.09 + Math.sin(elapsed * 0.55 + p.phase) * 0.04 : 0;
      let paramAnchorX = 0, paramAnchorZ = 0, hasParamAnchor = false;
      let errandArrived = false;

      // 夜间归宅歇息：村民在夜晚陆续回到最近农舍檐下灯影中静坐小憩
      const nh = isNight && p.nightHome && p.greetT <= 0 ? p.nightHome : null;
      if (nh) {
        p.nightReturning = true;
        const dx = nh.x - x, dz = nh.z - z;
        const dHome = Math.hypot(dx, dz);
        if (dHome > 0.22) {
          const step = Math.min(dHome, Math.max(0.75, p.speed || 0.85) * dt);
          x += (dx / dHome) * step;
          z += (dz / dHome) * step;
          yaw = Math.atan2(dx, dz);
          walkingMove = true;
          pitch = 0.05;
        } else {
          x = nh.x; z = nh.z;
          yaw = nh.yaw;
          nightSeated = true;
          const restBreath = Math.sin(elapsed * 0.75 + p.phase);
          pitch = 0.11 + restBreath * 0.015;
          armL = -0.18; armR = -0.18;
          headTargetYaw = Math.sin(elapsed * 0.35 + p.phase) * 0.08;
          headTargetPitch = 0.18 + Math.max(0, restBreath) * 0.06;
          bob = restBreath * 0.006;
          p.speaking = false;
          p.activity = 'rest';
        }
      } else if (p.mode === 'road') {
        if (raining && !p.shelter && !p.delivery && p.x !== undefined && greetK < 0.01 && elapsed >= (p.shelterRetry || 0)) {
          p.shelterRetry = elapsed + 1;
          const target = findShelter(p);
          if (target) p.shelter = { x: p.x, z: p.z, target, phase: 'out' };
        }
        if (p.greetT > 0 && p.poseReady) {
          const a = road.at(p.at);
          const b = road.at(Math.min(total, Math.max(0, p.at + p.dir * 0.6)));
          x = p.x; z = p.z;
          yaw = Math.atan2(b.x - a.x, b.z - a.z);
        } else {
          if (!p.shelter && !p.delivery) {
            const yieldTarget = computeRoadLaneYield(p, i, context);
            const nextYield = p.yieldOffset + (yieldTarget - p.yieldOffset) * Math.min(1, dt * 4.2);
            const ra0 = road.at(p.at);
            const candLx = ra0.x - ra0.nx * (0.9 + nextYield);
            const candLz = ra0.z - ra0.nz * (0.9 + nextYield);
            if (!p.poseReady || personClearMove(p.x, p.z, candLx + p.avoidX, candLz + p.avoidZ, context)) {
              p.yieldOffset = nextYield;
            }
          }
          const a0 = road.at(p.at);
          const b0 = road.at(Math.min(total, Math.max(0, p.at + p.dir * 0.6)));
          const fdx = b0.x - a0.x, fdz = b0.z - a0.z, fdl = Math.hypot(fdx, fdz) || 1;
          const base0X = a0.x - a0.nx * (0.9 + p.yieldOffset);
          const base0Z = a0.z - a0.nz * (0.9 + p.yieldOffset);
          let speedScale = 1;
          if (!p.shelter && !p.delivery && !p.nightReturning) {
            speedScale = updateParametricAvoidance(p, i, base0X, base0Z, fdx / fdl, fdz / fdl, p.speed, dt, context);
            paused = !raining && !isNight && !p.shelter && p.pauseT > 0 && p.greetT <= 0;
          }
          if (p.greetT <= 0 && !paused && !p.shelter && !p.delivery && lifeClock >= p.ackUntil) {
            p.at += p.dir * p.speed * speedScale * dt;
            if (p.at > p.hi) { p.at = p.hi; p.dir = -1; }
            if (p.at < p.lo) { p.at = p.lo; p.dir = 1; }
          }
          const a = road.at(p.at);
          const b = road.at(Math.min(total, Math.max(0, p.at + p.dir * 0.6)));
          const laneX = a.x - a.nx * (0.9 + p.yieldOffset);
          const laneZ = a.z - a.nz * (0.9 + p.yieldOffset);
          const dLane = Math.hypot(laneX - x, laneZ - z);
          if (p.nightReturning && p.greetT <= 0 && dLane > 0.25 && !p.shelter && !p.delivery) {
            const step = Math.min(dLane, (p.speed || 0.9) * dt);
            x += ((laneX - x) / dLane) * step;
            z += ((laneZ - z) / dLane) * step;
            yaw = Math.atan2(laneX - x, laneZ - z);
            walkingMove = true;
          } else {
            if (p.nightReturning && dLane <= 0.25) p.nightReturning = false;
            paramAnchorX = laneX; paramAnchorZ = laneZ; hasParamAnchor = !p.shelter && !p.delivery;
            x = laneX + (hasParamAnchor ? p.avoidX : 0);
            z = laneZ + (hasParamAnchor ? p.avoidZ : 0);
            yaw = Math.atan2(b.x - a.x, b.z - a.z);
          }
        }
        if (paused) headTargetYaw = Math.sin(elapsed * 1.5 + p.phase) * 0.38;
        else headTargetYaw = Math.sin(elapsed * 0.65 + p.phase) * 0.16;
        pitch = 0.05;
        if ((p.peerNodEnv || 0) > 0.02) {
          // 陌上相逢微揖颔首：村邻迎面错身让路时，自然点头抬手致意
          headTargetPitch += 0.12 * p.peerNodEnv;
          if (!p.basket) armR -= 0.24 * p.peerNodEnv;
          p.peerNodEnv = Math.max(0, p.peerNodEnv - dt * 2.4);
        }
      } else if (p.mode === 'circle') {
        if (p.greetT > 0 && p.poseReady) {
          x = p.x; z = p.z;
          yaw = Math.atan2(-Math.sin(p.ang), Math.cos(p.ang));
        } else {
          const base0X = p.cx + Math.cos(p.ang) * p.radius;
          const base0Z = p.cz + Math.sin(p.ang) * p.radius;
          const fdx = -Math.sin(p.ang), fdz = Math.cos(p.ang);
          let speedScale = 1;
          if (!p.nightReturning) {
            speedScale = updateParametricAvoidance(p, i, base0X, base0Z, fdx, fdz, p.speed, dt, context);
            paused = !raining && !isNight && !p.shelter && p.pauseT > 0 && p.greetT <= 0;
          }
          if (p.greetT <= 0 && !paused && lifeClock >= p.ackUntil) p.ang += (p.speed * speedScale / p.radius) * dt;
          const cxT = p.cx + Math.cos(p.ang) * p.radius;
          const czT = p.cz + Math.sin(p.ang) * p.radius;
          const dCirc = Math.hypot(cxT - x, czT - z);
          if (p.nightReturning && p.greetT <= 0 && dCirc > 0.25) {
            const step = Math.min(dCirc, (p.speed || 0.7) * dt);
            x += ((cxT - x) / dCirc) * step;
            z += ((czT - z) / dCirc) * step;
            yaw = Math.atan2(cxT - x, czT - z);
            walkingMove = true;
          } else {
            if (p.nightReturning && dCirc <= 0.25) p.nightReturning = false;
            paramAnchorX = cxT; paramAnchorZ = czT; hasParamAnchor = true;
            x = cxT + p.avoidX; z = czT + p.avoidZ;
            yaw = Math.atan2(-Math.sin(p.ang), Math.cos(p.ang));
          }
        }
        headTargetYaw = Math.sin(elapsed * 1.6 + p.phase) * 0.28;
        headTargetPitch = Math.sin(elapsed * 2.2 + p.phase) * 0.06;
        pitch = 0.10 + Math.max(0, Math.sin(elapsed * 2.8 + p.phase)) * 0.04;
      } else if (p.mode === 'talk') {
        const goalX = (raining && p.rainSpotX !== undefined) ? p.rainSpotX : p.homeSpotX;
        const goalZ = (raining && p.rainSpotZ !== undefined) ? p.rainSpotZ : p.homeSpotZ;
        const dBack = goalX !== undefined ? Math.hypot(goalX - x, goalZ - z) : 0;
        if ((p.nightReturning || raining || dBack > 0.22) && p.greetT <= 0 && dBack > 0.20) {
          const step = Math.min(dBack, 0.85 * dt);
          x += ((goalX - x) / dBack) * step;
          z += ((goalZ - z) / dBack) * step;
          yaw = Math.atan2(goalX - x, goalZ - z);
          walkingMove = true;
        } else {
          if (p.nightReturning && dBack <= 0.20) p.nightReturning = false;
          p.rainChatting = raining;
          const w = elapsed * 1.3 + p.phase;
          yaw = p.baseYaw + Math.sin(w * 0.45) * 0.07;
          const express = 0.72 + 0.28 * Math.sin(w * 0.55);
          armR = p.speaking ? -0.34 - Math.sin(w * 1.7) * 0.21 * express : (raining ? -0.16 - Math.max(0, Math.sin(w * 0.8)) * 0.10 : -0.09);
          armL = p.speaking ? -0.14 - Math.cos(w * 1.4) * 0.10 * express : -0.08 + Math.sin(w * 1.1 + 1.7) * 0.06;
          headTargetYaw = p.speaking ? Math.sin(w * 0.9) * 0.22 : (p.speakerDir || 0);
          headTargetPitch = p.speaking ? Math.sin(w * 1.7) * 0.04 : (raining ? -0.06 + Math.sin(w * 1.3 + p.phase) * 0.06 : Math.max(0, Math.sin(w * 2.1 + p.phase)) * 0.075);
          pitch = p.speaking ? 0.04 : 0.025;
          bob = Math.sin(w * 0.9) * 0.012;
        }
      } else if (sitBase) {
        const dBack = p.homeSpotX !== undefined ? Math.hypot(p.homeSpotX - x, p.homeSpotZ - z) : 0;
        if (p.nightReturning && p.greetT <= 0 && dBack > 0.20) {
          const step = Math.min(dBack, 0.75 * dt);
          x += ((p.homeSpotX - x) / dBack) * step;
          z += ((p.homeSpotZ - z) / dBack) * step;
          yaw = Math.atan2(p.homeSpotX - x, p.homeSpotZ - z);
          walkingMove = true;
        } else {
          if (p.nightReturning && dBack <= 0.20) p.nightReturning = false;
          const w = elapsed * 0.8 + p.phase;
          armR = -0.22 + Math.sin(w * 0.5) * 0.04; armL = -0.18 - Math.cos(w * 0.4) * 0.03;
          headTargetYaw = Math.sin(w * 0.45 + 0.7) * 0.36;
          headTargetPitch = (twilightView ? -0.13 : -0.02) + Math.sin(w * 0.7) * 0.05;
          pitch = 0.09;
          bob = Math.sin(w) * 0.01;
        }
      } else if (p.mode === 'work') {
        p.nightReturning = false;
        const w = elapsed * (2.05 + 0.22 * Math.sin(elapsed * 0.35 + p.phase)) + p.phase;
        // 田夫就地暂歇，雨歇后平缓恢复，并加入多点巡田、除草、直腰擦汗等动作变化
        p.rainRest += ((raining ? 1 : 0) - p.rainRest) * Math.min(1, dt * 1.5);
        const working = (1 - p.rainRest) * (enabled && p.activity !== 'work' ? 0 : 1);
        const wt = p.workTarget || { x: p.homeSpotX ?? x, z: p.homeSpotZ ?? z };
        const dSpot = Math.hypot(wt.x - x, wt.z - z);
        if (working > 0.5 && p.taskKind === 'stroll' && dSpot > 0.20) {
          const step = Math.min(dSpot, 0.68 * dt);
          x += ((wt.x - x) / dSpot) * step;
          z += ((wt.z - z) / dSpot) * step;
          yaw = Math.atan2(wt.x - x, wt.z - z);
          walkingMove = true;
          pitch = 0.08;
        } else if (working > 0.3 && p.taskKind === 'weed') {
          pitch = (0.58 + Math.sin(w * 0.8) * 0.07) * working;
          armR = (-0.75 - Math.sin(w * 1.9) * 0.16) * working;
          armL = (-0.65 - Math.cos(w * 1.7) * 0.14) * working;
          bob = -0.04 * working + Math.abs(Math.sin(w * 0.9)) * 0.015 * working;
          headTargetYaw = Math.sin(w * 0.45) * 0.18;
          headTargetPitch = 0.16 * working;
        } else if (working > 0.3 && p.taskKind === 'wipe') {
          pitch = -0.04 * working;
          armR = (-1.12 - Math.sin(w * 1.3) * 0.08) * working;
          rollR = 0.52 * working;
          armL = -0.14 * working;
          headTargetYaw = Math.sin(elapsed * 0.95 + p.phase) * 0.45;
          headTargetPitch = twilightView ? -0.12 : -0.04;
        } else {
          pitch = (0.42 + Math.sin(w) * 0.12) * working + 0.03 * p.rainRest;
          armR = (-0.62 - Math.sin(w) * 0.20) * working - 0.08 * p.rainRest;
          armL = (-0.48 - Math.sin(w + 0.6) * 0.15) * working - 0.08 * p.rainRest;
          bob = Math.abs(Math.sin(w)) * 0.02 * working;
          headTargetYaw = working < 0.3 ? Math.sin(elapsed * 0.8 + p.phase) * 0.42 : Math.sin(w * 0.5) * 0.10;
          headTargetPitch = working > 0.5 ? 0.08 * working : (twilightView ? -0.12 : 0.02);
        }
      }
      const sit = (sitBase && !walkingMove && !nh) || nightSeated;
      if (paused) {
        legL = legR = bob = 0;
        pitch = 0.02;
        if (p.pauseYaw !== undefined) yaw = angleLerp(p.yaw || 0, p.pauseYaw, Math.min(1, dt * 4));
        if (p.mode === 'circle') {
          armL = 0.18 + Math.sin(elapsed * 3 + p.phase) * 0.12;
          armR = 0.28 - Math.sin(elapsed * 3 + p.phase) * 0.12;
        } else {
          const fidget = Math.sin(elapsed * 1.8 + p.phase);
          armL = 0.09 + fidget * 0.05;
          armR = 0.14 - fidget * 0.07;
        }
      }
      if (p.delivery && !p.shelter) {
        const trip = p.delivery;
        const returning = trip.phase === 'back';
        const tx = returning ? trip.x : trip.tx, tz = returning ? trip.z : trip.tz;
        const dx = tx - p.x, dz = tz - p.z, distance = Math.hypot(dx, dz);
        const step = p.greetT > 0 || lifeClock < p.ackUntil || trip.phase === 'wait' ? 0 : Math.min(distance, p.speed * dt);
        x = p.x + (distance ? dx / distance * step : 0); z = p.z + (distance ? dz / distance * step : 0);
        if (step) yaw = Math.atan2(dx, dz);
        p.activity = trip.phase === 'wait' ? 'rest' : 'travel';
        if (distance <= step + 0.001) {
          if (returning) { p.delivery = null; errandArrived = true; }
          else if (trip.phase === 'out') { trip.phase = 'wait'; trip.waitUntil = lifeClock + 2.4; }
        }
        if (trip.phase === 'wait' && lifeClock >= trip.waitUntil) trip.phase = 'back';
      }
      let shelteredIdle = false;
      if (p.mode !== 'talk') p.rainChatting = false;
      if (p.shelter) {
        const sh = p.shelter;
        if (!raining) sh.phase = 'back';
        else if (sh.phase === 'back') sh.phase = 'out';
        const dest = sh.phase === 'back' ? sh : sh.target;
        const dx = dest.x - p.x, dz = dest.z - p.z, distance = Math.hypot(dx, dz);
        const step = p.greetT <= 0 ? Math.min(distance, dt * p.speed) : 0;
        x = p.x + (distance ? dx / distance * step : 0);
        z = p.z + (distance ? dz / distance * step : 0);
        if (distance > 0.02 && step > 0) {
          yaw = Math.atan2(dx, dz);
        } else if (sh.phase === 'out') {
          shelteredIdle = true;
          legL = legR = 0;
          // 檐下避雨交谈与望雨：邻人同避一檐时侧身闲话，独处时抬眼望檐溜轻拂衣袖
          let peer = null, peerD = 3.8;
          for (let k = 0; k < n; k++) {
            if (k === i) continue;
            const o = list[k];
            if (o.x === undefined || o.z === undefined) continue;
            const od = Math.hypot(o.x - x, o.z - z);
            if (od > 0.12 && od < peerD) { peer = o; peerD = od; }
          }
          const rw = elapsed * 1.45 + p.phase;
          if (peer && !isNight) {
            p.rainChatting = true;
            const toPeer = Math.atan2(peer.x - x, peer.z - z);
            const outYaw = sh.target.outYaw ?? toPeer;
            yaw = angleLerp(outYaw, toPeer, 0.72);
            const turnTalk = Math.sin(elapsed * 0.85 + i * 1.7) > -0.15;
            p.speaking = p.greetT <= 0 && turnTalk;
            p.activity = turnTalk ? 'talk' : 'listen';
            armR = turnTalk ? -0.38 - Math.sin(rw * 1.6) * 0.18 : -0.14 + Math.sin(rw * 0.9) * 0.05;
            armL = p.basket ? -0.08 : (turnTalk ? -0.18 - Math.cos(rw * 1.3) * 0.10 : -0.10);
            pitch = 0.035 + Math.sin(rw * 0.8) * 0.015;
            bob = Math.sin(rw * 0.95) * 0.010;
            headTargetYaw = Math.sin(rw * 0.75) * 0.16;
            headTargetPitch = turnTalk ? Math.sin(rw * 1.5) * 0.04 : (-0.06 + Math.max(0, Math.sin(rw * 1.9)) * 0.07);
          } else {
            yaw = sh.target.outYaw ?? yaw;
            armR = -0.24 - Math.max(0, Math.sin(rw * 0.9)) * 0.16;
            armL = p.basket ? -0.06 : -0.10 + Math.cos(rw * 0.7) * 0.05;
            pitch = 0.02;
            bob = Math.sin(rw * 0.7) * 0.006;
            headTargetYaw = Math.sin(rw * 0.55) * 0.24;
            headTargetPitch = -0.11 + Math.sin(rw * 0.8) * 0.05;
          }
        } else {
          legL = legR = armL = armR = bob = pitch = 0;
        }
        if (sh.phase === 'back' && distance <= step + 0.001) { p.shelter = null; errandArrived = true; }
      }
      // 胶囊防穿模兜底：移动中的行人与牛畜、动物及其他行人保持平滑净距，绝不穿透躯干或牛首牛角。
      const canSeparate = p.greetT <= 0 && !sit && !shelteredIdle && !errandArrived &&
        (p.mode === 'road' || p.mode === 'circle' || walkingMove || Boolean(p.delivery && p.delivery.phase !== 'wait') || Boolean(p.shelter && !shelteredIdle));
      if (canSeparate) {
        const rP = (p.basket ? 0.34 : 0.30) * p.s;
        for (let src = 0; src < 2; src++) {
          const arr = src === 0 ? context.animals : context.extraAnimals;
          if (!arr) continue;
          for (let j = 0; j < arr.length; j++) {
            const b = arr[j];
            if (!b || b.kind === 'bird' || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
            if (Math.abs(b.x - x) > 3.2 || Math.abs(b.z - z) > 3.2) continue;
            const cp = readAnimalCapsule(b);
            capsuleGap(x, z, 0, 0, 0, rP + 0.015, b.x, b.z, b.yaw || 0, cp.rear, cp.front, cp.radius, _gap);
            if (_gap.overlap <= 1e-4) continue;
            if (tryDisplacePerson(x, z, _gap.nx * _gap.overlap, _gap.nz * _gap.overlap, context, _sepPos)) {
              x = _sepPos.x; z = _sepPos.z;
            }
          }
        }
        if (!p.delivery) {
          const rTightP = 0.29 * p.s;
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const q = list[j];
            if (q.x === undefined || q.z === undefined) continue;
            if (p.socialGroup !== undefined && p.socialGroup === q.socialGroup) continue;
            if (Math.abs(q.x - x) > 1.2 || Math.abs(q.z - z) > 1.2) continue;
            const rTightQ = 0.29 * (q.s || 1);
            capsuleGap(x, z, 0, 0, 0, rTightP, q.x, q.z, 0, 0, 0, rTightQ, _gap);
            if (_gap.overlap <= 1e-4) continue;
            const qAnchored = q.greetT > 0 || q.mode === 'sit' || q.mode === 'talk' || q.mode === 'work' || Boolean(q.shelter && q.shelter.phase === 'out');
            const share = (qAnchored || j < i) ? 1.0 : 0.65;
            if (tryDisplacePerson(x, z, _gap.nx * (_gap.overlap * share), _gap.nz * (_gap.overlap * share), context, _sepPos)) {
              x = _sepPos.x; z = _sepPos.z;
            }
          }
          const extraActors = context.extraActors;
          if (extraActors) {
            for (let j = 0; j < extraActors.length; j++) {
              const q = extraActors[j];
              if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.z)) continue;
              if (Math.abs(q.x - x) > 1.2 || Math.abs(q.z - z) > 1.2) continue;
              const rTightQ = 0.27 * (q.s || q.scale || 1);
              capsuleGap(x, z, 0, 0, 0, rTightP, q.x, q.z, 0, 0, 0, rTightQ, _gap);
              if (_gap.overlap <= 1e-4) continue;
              if (tryDisplacePerson(x, z, _gap.nx * _gap.overlap, _gap.nz * _gap.overlap, context, _sepPos)) {
                x = _sepPos.x; z = _sepPos.z;
              }
            }
          }
        }
        if (hasParamAnchor) {
          p.avoidX = x - paramAnchorX;
          p.avoidZ = z - paramAnchorZ;
        }
        if (p.poseReady && !paused && lifeClock >= p.ackUntil && Math.hypot(p.avoidX, p.avoidZ) > 0.06) {
          const mdx = x - p.x, mdz = z - p.z;
          if (Math.hypot(mdx, mdz) > 0.002) {
            yaw = angleLerp(yaw, Math.atan2(mdx, mdz), 0.72);
          }
        }
      }
      // 以实际位移推进步态：停下、问候和檐下等待不再原地踏步。
      if ((p.mode === 'road' || p.mode === 'circle' || walkingMove) && !nightSeated) {
        const distance = p.poseReady ? Math.hypot(x - p.x, z - p.z) : 0;
        const speed = dt > 0 ? distance / dt : 0;
        const nomSpeed = p.speed || 0.75;
        const moving = p.greetT > 0 || paused || lifeClock < p.ackUntil ? 0 : Math.min(1, speed / Math.max(0.1, nomSpeed));
        p.motion += (moving - p.motion) * (1 - Math.exp(-8 * dt));
        p.gait += Math.min(distance, Math.max(0, dt) * nomSpeed * 2) * (p.role === 'child' ? 6.5 : 5.4) / p.s;
        const wave = Math.sin(p.gait), reach = (p.role === 'child' ? 0.28 : p.basket ? 0.19 : 0.25) * p.motion;
        legL = wave * reach; legR = -legL;
        footLiftL = Math.max(0, Math.cos(p.gait)) * 0.065 * p.motion;
        footLiftR = Math.max(0, -Math.cos(p.gait)) * 0.065 * p.motion;
        const gaitArmL = -wave * (p.role === 'child' ? 0.38 : 0.23) * p.motion;
        const gaitArmR = -gaitArmL;
        if (shelteredIdle) {
          armL = armL * (1 - p.motion) + (p.basket ? gaitArmL * 0.25 : gaitArmL);
          armR = armR * (1 - p.motion) + gaitArmR;
          bob = bob * (1 - p.motion) + Math.sin(p.gait * 2) * 0.009 * p.motion;
          pitch = pitch * (1 - p.motion) + pitch * p.motion;
        } else {
          armL = p.basket ? gaitArmL * 0.25 : gaitArmL;
          armR = gaitArmR - ((p.peerNodEnv || 0) > 0.02 ? 0.26 * p.peerNodEnv : 0);
          bob = Math.sin(p.gait * 2) * 0.009 * p.motion;
          pitch *= p.motion;
        }
      }
      if (p.basket) rollL = -0.24; // 提篮手略向外张，让篮沿离开衣摆。
      const noticeCfg = cfg.notice;
      let noticeTarget = 0;
      if (noticeCfg && px !== undefined && (p.mode === 'talk' || sit) && (!enabled || p.attention === 'player')) {
        const nd = Math.hypot(px - x, pz - z);
        if (nd < noticeCfg.range) {
          const w = (noticeCfg.range - nd) / (noticeCfg.range - noticeCfg.inner);
          noticeTarget = Math.min(1, Math.max(0, w)) * noticeCfg.weight;
        }
      }
      p.noticeK += (noticeTarget - p.noticeK) * Math.min(1, dt * (noticeCfg ? noticeCfg.speed : 3));
      if (p.noticeK > 0.001 && noticeCfg && px !== undefined) {
        let dyaw = Math.atan2(px - x, pz - z) - yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        dyaw = Math.max(-noticeCfg.maxYaw, Math.min(noticeCfg.maxYaw, dyaw));
        yaw = angleLerp(yaw, yaw + dyaw, p.noticeK);
      }
      if (enabled && p.greetT <= 0 && p.attention === 'animal') {
        yaw = angleLerp(yaw, p.attentionYaw, Math.min(1, dt * 3));
        armR = -0.25; rollR = 0.45;
      }
      if (enabled && p.greetT <= 0 && lifeClock < p.ackUntil) {
        yaw = angleLerp(yaw, p.attentionYaw, Math.min(1, dt * 4));
        pitch = 0.10;
        armR = -0.68;
        rollR = -0.34;
        if (!p.basket) { armL = -0.64; rollL = 0.34; }
      }
      if (greetK > 0.001) {
        // 秦汉拱手揖礼：双手拢于胸前相抱，微躬颔首致意；童子作欢快小揖。
        yaw = angleLerp(yaw, p.greetYaw, greetK);
        legL *= 1 - greetK;
        legR *= 1 - greetK;
        bob *= 1 - greetK;
        if (p.role === 'elder') {
          const bow = sit ? 0.22 : 0.28;
          pitch = pitch * (1 - greetK) + bow * greetK;
          armL = armL * (1 - greetK) - 0.88 * greetK;
          armR = armR * (1 - greetK) - 0.90 * greetK;
          rollL = rollL * (1 - greetK) + 0.42 * greetK;
          rollR = rollR * (1 - greetK) - 0.42 * greetK;
        } else if (p.role === 'child') {
          const joy = Math.sin(elapsed * 5.2 + p.phase) * 0.08;
          pitch = pitch * (1 - greetK) + (0.22 + Math.max(0, joy) * 0.6) * greetK;
          armL = armL * (1 - greetK) + (-0.92 + joy) * greetK;
          armR = armR * (1 - greetK) + (-0.95 + joy) * greetK;
          rollL = rollL * (1 - greetK) + 0.44 * greetK;
          rollR = rollR * (1 - greetK) - 0.44 * greetK;
        } else {
          const bow = p.female ? 0.20 : 0.24;
          pitch = pitch * (1 - greetK) + bow * greetK;
          armL = armL * (1 - greetK) + (p.basket ? -0.12 : -0.92) * greetK;
          armR = armR * (1 - greetK) - 0.95 * greetK;
          rollL = rollL * (1 - greetK) + (p.basket ? -0.24 : 0.43) * greetK;
          rollR = rollR * (1 - greetK) - 0.43 * greetK;
        }
      }
      // 只有朝向做阻尼，不改路线、交互坐标与碰撞；穿过 ±PI 也走最短转角。
      if (p.poseReady) {
        const turn = Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw));
        const limit = 4.5 * Math.max(0, dt);
        yaw = p.yaw + Math.max(-limit, Math.min(limit, turn * (1 - Math.exp(-(sit ? 3.5 : 5.5) * dt))));
      }
      if (px !== undefined && !p.shelter && p.greetT <= 0 && !raining) {
        const pDist = Math.hypot(px - x, pz - z);
        if (pDist < 4.8 && pDist > 0.1) {
          let relP = Math.atan2(px - x, pz - z) - yaw;
          while (relP > Math.PI) relP -= Math.PI * 2;
          while (relP < -Math.PI) relP += Math.PI * 2;
          const glanceW = Math.max(0, Math.min(1, (4.8 - pDist) / 2.2));
          if (Math.abs(relP) < 1.35) {
            headTargetYaw = headTargetYaw * (1 - glanceW) + Math.max(-0.55, Math.min(0.55, relP)) * glanceW;
          }
        }
      } else if (p.greetT > 0) {
        headTargetYaw = 0;
        headTargetPitch = p.role === 'elder' ? 0.14 : p.role === 'child' ? 0.10 + Math.sin(elapsed * 5.2 + p.phase) * 0.04 : 0.12;
      }
      const headLerp = 1 - Math.exp(-5.0 * Math.max(0, dt));
      p.headYaw += (headTargetYaw - p.headYaw) * headLerp;
      p.headPitch += (headTargetPitch - p.headPitch) * headLerp;
      const headYawAbs = yaw + p.headYaw;
      const headPitchAbs = pitch * 0.45 + p.headPitch;
      const s = p.s, isElder = p.role === 'elder', isChild = p.role === 'child', isFemale = !!p.female;
      const bodyWidth = isChild ? 1.10 : isElder ? 1.06 : p.role === 'worker' ? 1.08 : p.basket ? 0.95 : isFemale ? 0.94 : 1;
      const bodyHeight = isChild ? 0.90 : isElder ? 0.95 : 1;
      const armScale = s * (isChild ? 0.90 : isElder ? 0.94 : 1);
      const headScale = s * (isChild ? 1.15 : isElder ? 1.03 : isFemale ? 0.98 : 1);
      const hasWalkSurface = typeof field.walkSurface === 'function';
      const groundAt = (gx, gz) => (hasWalkSurface ? field.walkSurface(gx, gz) : field.sample(gx, gz));
      const gy = groundAt(x, z);
      const hipY = gy + (sit ? 0.46 : isChild ? 0.68 : 0.748) * s + bob;
      const centerY = hipY + 0.285 * s * bodyHeight;
      const hipOff = 0.092 * s * bodyWidth, shOff = 0.188 * s * bodyWidth;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const axX = cy, axZ = -sy;
      // 肩与颈从衣身的同一个倾斜坐标系取点，弯腰时不再脱开肩窝。
      const shoulderY = centerY + cp * 0.150 * s * bodyHeight;
      const shoulderF = sp * 0.150 * s * bodyHeight;
      const shoulderX = x + sy * shoulderF, shoulderZ = z + cy * shoulderF;
      const headY = centerY + cp * 0.420 * s * bodyHeight;
      const headF = sp * 0.420 * s * bodyHeight;
      setPart(torsoMesh, i, x, centerY, z, yaw, pitch, s * bodyWidth, s * bodyHeight, s);
      setPart(trimMesh, i, x, centerY, z, yaw, pitch, s * bodyWidth, s * bodyHeight, s);
      const head = isElder ? elderMesh : isChild ? childMesh : isFemale ? femaleMesh : headMesh;
      setPart(head, p.headIndex, x + sy * headF, headY, z + cy * headF, headYawAbs, headPitchAbs, headScale, headScale, headScale);
      if (p.hatIndex >= 0) setPart(hatMesh, p.hatIndex, x + sy * headF, headY, z + cy * headF, headYawAbs, headPitchAbs, headScale, headScale, headScale);
      const armPitchL = armL + pitch * 0.3, armPitchR = armR + pitch * 0.3;
      setPart(armLMesh, i, shoulderX - axX * shOff, shoulderY, shoulderZ - axZ * shOff, yaw, armPitchL, s, armScale, s, rollL - 0.08);
      setPart(armRMesh, i, shoulderX + axX * shOff, shoulderY, shoulderZ + axZ * shOff, yaw, armPitchR, s, armScale, s, rollR + 0.08);
      setPart(cuffMesh, i * 2, shoulderX - axX * shOff, shoulderY, shoulderZ - axZ * shOff, yaw, armPitchL, s, armScale, s, rollL - 0.08);
      setPart(cuffMesh, i * 2 + 1, shoulderX + axX * shOff, shoulderY, shoulderZ + axZ * shOff, yaw, armPitchR, s, armScale, s, rollR + 0.08);
      handAt(i * 2, shoulderX - axX * shOff, shoulderY, shoulderZ - axZ * shOff, yaw, armPitchL, rollL - 0.08, 0.525 * armScale / s, s);
      handAt(i * 2 + 1, shoulderX + axX * shOff, shoulderY, shoulderZ + axZ * shOff, yaw, armPitchR, rollR + 0.08, 0.525 * armScale / s, s);
      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1;
        const forward = (sit ? 0.31 : side ? legR : legL) * s;
        const hx = x + axX * hipOff * sign, hz = z + axZ * hipOff * sign;
        const fx = hx + sy * forward, fz = hz + cy * forward;
        const lift = (side ? footLiftR : footLiftL) * s;
        const gMid = groundAt(fx, fz);
        const gToe = groundAt(fx + sy * 0.11 * s, fz + cy * 0.11 * s);
        const gHeel = groundAt(fx - sy * 0.07 * s, fz - cy * 0.07 * s);
        const slopePitch = Math.max(-0.18, Math.min(0.18, -Math.atan2(gToe - gHeel, 0.18 * s)));
        const shoePitch = slopePitch - lift * 0.85;
        const sinSP = Math.sin(shoePitch), cosSP = Math.cos(shoePitch);
        const reqToe = gToe + 0.11 * s * sinSP;
        const reqHeel = gHeel - 0.07 * s * sinSP;
        // 鞋底局部最低点 -0.012，踝口 +0.052；鞋随坡度贴地微仰，腿的末端准确锁合旋转后踝口。
        const baseG = hasWalkSurface ? Math.max(gMid, reqToe, reqHeel) : gMid;
        const footY = baseG + (hasWalkSurface ? 0.014 : 0.0135) * s + lift;
        const ankleFwd = forward - 0.052 * s * sinSP;
        const ankleY = footY + 0.052 * s * cosSP;
        const drop = Math.max(0.08 * s, hipY - ankleY);
        const legPitch = -Math.atan2(ankleFwd, drop);
        const legLength = Math.hypot(ankleFwd, drop);
        setPart(side ? legRMesh : legLMesh, i, hx, hipY, hz, yaw, legPitch, s, legLength, s);
        setPart(shoeMesh, i * 2 + side, fx, footY, fz, yaw, shoePitch, s, s, s);
      }
      if (p.basket) {
        // 提梁最高点在篮局部 -0.067，直接跟随左手，不再悬在肩旁。
        handMesh.getMatrixAt(i * 2, _dummy.matrix);
        const e = _dummy.matrix.elements;
        setPart(basketMesh, p.bi, e[12], e[13] + 0.067 * s, e[14], yaw, 0, s, s, s);
      }
      if (sitBase && p.si !== undefined) {
        const seatX = sit ? x : (p.homeSpotX ?? x);
        const seatZ = sit ? z : (p.homeSpotZ ?? z);
        const seatYaw = sit ? yaw : (p.baseYaw || 0);
        const stX = seatX - Math.sin(seatYaw) * 0.04 * s;
        const stZ = seatZ - Math.cos(seatYaw) * 0.04 * s;
        const stY = groundAt(stX, stZ);
        setPart(stoolMesh, p.si, stX, stY, stZ, seatYaw, 0, s, s, s);
        if (stX < stMinX) stMinX = stX; if (stX > stMaxX) stMaxX = stX;
        if (stY < stMinY) stMinY = stY; if (stY > stMaxY) stMaxY = stY;
        if (stZ < stMinZ) stMinZ = stZ; if (stZ > stMaxZ) stMaxZ = stZ;
      }
      p.poseReady = true;
      p.x = x; p.z = z; p.yaw = yaw;
      if (x < allMinX) allMinX = x; if (x > allMaxX) allMaxX = x;
      if (gy < allMinY) allMinY = gy; if (gy > allMaxY) allMaxY = gy;
      if (z < allMinZ) allMinZ = z; if (z > allMaxZ) allMaxZ = z;
      if (isElder) {
        if (x < elMinX) elMinX = x; if (x > elMaxX) elMaxX = x;
        if (gy < elMinY) elMinY = gy; if (gy > elMaxY) elMaxY = gy;
        if (z < elMinZ) elMinZ = z; if (z > elMaxZ) elMaxZ = z;
      } else if (isChild) {
        if (x < chMinX) chMinX = x; if (x > chMaxX) chMaxX = x;
        if (gy < chMinY) chMinY = gy; if (gy > chMaxY) chMaxY = gy;
        if (z < chMinZ) chMinZ = z; if (z > chMaxZ) chMaxZ = z;
      } else if (isFemale) {
        if (x < feMinX) feMinX = x; if (x > feMaxX) feMaxX = x;
        if (gy < feMinY) feMinY = gy; if (gy > feMaxY) feMaxY = gy;
        if (z < feMinZ) feMinZ = z; if (z > feMaxZ) feMaxZ = z;
      } else {
        if (x < adMinX) adMinX = x; if (x > adMaxX) adMaxX = x;
        if (gy < adMinY) adMinY = gy; if (gy > adMaxY) adMaxY = gy;
        if (z < adMinZ) adMinZ = z; if (z > adMaxZ) adMaxZ = z;
      }
      if (p.hatIndex >= 0) {
        if (x < haMinX) haMinX = x; if (x > haMaxX) haMaxX = x;
        if (headY < haMinY) haMinY = headY; if (headY > haMaxY) haMaxY = headY;
        if (z < haMinZ) haMinZ = z; if (z > haMaxZ) haMaxZ = z;
      }
      if (p.basket) {
        if (x < baMinX) baMinX = x; if (x > baMaxX) baMaxX = x;
        if (gy < baMinY) baMinY = gy; if (gy > baMaxY) baMaxY = gy;
        if (z < baMinZ) baMinZ = z; if (z > baMaxZ) baMaxZ = z;
      }
    }
    if (allMinX <= allMaxX) {
      const acx = (allMinX + allMaxX) * 0.5, acy = (allMinY + allMaxY) * 0.5 + 0.9, acz = (allMinZ + allMaxZ) * 0.5;
      const arad = Math.hypot(allMaxX - allMinX, allMaxY - allMinY, allMaxZ - allMinZ) * 0.5 + 2.4;
      for (const m of [torsoMesh, trimMesh, armLMesh, armRMesh, cuffMesh, handMesh, legLMesh, legRMesh, shoeMesh]) {
        m.boundingSphere.center.set(acx, acy, acz);
        m.boundingSphere.radius = arad;
      }
    }
    if (adMinX <= adMaxX) {
      headMesh.boundingSphere.center.set((adMinX + adMaxX) * 0.5, (adMinY + adMaxY) * 0.5 + 1.1, (adMinZ + adMaxZ) * 0.5);
      headMesh.boundingSphere.radius = Math.hypot(adMaxX - adMinX, adMaxY - adMinY, adMaxZ - adMinZ) * 0.5 + 1.8;
    }
    if (feMinX <= feMaxX) {
      femaleMesh.boundingSphere.center.set((feMinX + feMaxX) * 0.5, (feMinY + feMaxY) * 0.5 + 1.1, (feMinZ + feMaxZ) * 0.5);
      femaleMesh.boundingSphere.radius = Math.hypot(feMaxX - feMinX, feMaxY - feMinY, feMaxZ - feMinZ) * 0.5 + 1.8;
    }
    if (elMinX <= elMaxX) {
      elderMesh.boundingSphere.center.set((elMinX + elMaxX) * 0.5, (elMinY + elMaxY) * 0.5 + 1.1, (elMinZ + elMaxZ) * 0.5);
      elderMesh.boundingSphere.radius = Math.hypot(elMaxX - elMinX, elMaxY - elMinY, elMaxZ - elMinZ) * 0.5 + 1.8;
    }
    if (chMinX <= chMaxX) {
      childMesh.boundingSphere.center.set((chMinX + chMaxX) * 0.5, (chMinY + chMaxY) * 0.5 + 0.9, (chMinZ + chMaxZ) * 0.5);
      childMesh.boundingSphere.radius = Math.hypot(chMaxX - chMinX, chMaxY - chMinY, chMaxZ - chMinZ) * 0.5 + 1.6;
    }
    if (haMinX <= haMaxX) {
      hatMesh.boundingSphere.center.set((haMinX + haMaxX) * 0.5, (haMinY + haMaxY) * 0.5, (haMinZ + haMaxZ) * 0.5);
      hatMesh.boundingSphere.radius = Math.hypot(haMaxX - haMinX, haMaxY - haMinY, haMaxZ - haMinZ) * 0.5 + 1.5;
    }
    if (baMinX <= baMaxX) {
      basketMesh.boundingSphere.center.set((baMinX + baMaxX) * 0.5, (baMinY + baMaxY) * 0.5 + 0.9, (baMinZ + baMaxZ) * 0.5);
      basketMesh.boundingSphere.radius = Math.hypot(baMaxX - baMinX, baMaxY - baMinY, baMaxZ - baMinZ) * 0.5 + 1.6;
    }
    if (stMinX <= stMaxX) {
      stoolMesh.boundingSphere.center.set((stMinX + stMaxX) * 0.5, (stMinY + stMaxY) * 0.5 + 0.3, (stMinZ + stMaxZ) * 0.5);
      stoolMesh.boundingSphere.radius = Math.hypot(stMaxX - stMinX, stMaxY - stMinY, stMaxZ - stMinZ) * 0.5 + 1.2;
    }
    for (const mesh of group.children) {
      if (mesh.count > 0) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
  update(0.016, 0);
  return { group, update, greet, count: n, list, setRain(on) { raining = !!on; } };
}
