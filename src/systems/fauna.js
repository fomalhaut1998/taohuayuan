import * as THREE from 'three';
import {
  livingStep, awayVector, sightClear, safeSegment, createEncounter, encounterEvent,
  capsuleProfile, capsuleGap, safeStep, steerAroundCapsule
} from './living-behavior.js';
import { createFaunaModels } from './fauna-models.js';
import { attachFaunaState, createFaunaMaterial, FAUNA_KIND, FAUNA_MOTION_DEFAULTS } from './fauna-motion.js';

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createFauna(cfg, field, sound, context = {}) {
  const living = cfg.living || {};
  const lifeRand = lcg(32681);
  let habitat = context;
  const rand = lcg(5150);
  const group = new THREE.Group();
  group.name = 'fauna';

  const geos = createFaunaModels(cfg);
  const mat = createFaunaMaterial(cfg.motion);
  const motion = mat.userData.motion;
  let visualClock = 0;
  const animals = [];

  // 由 world.fauna.species 数据驱动，新增种类不必再改硬编码调用。
  function addGroup(list, geo, kind, speed, radius) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.count);
    mesh.name = 'fauna-' + kind;
    attachFaunaState(geo, list.count);
    for (let i = 0; i < list.count; i++) {
      const home = list.homes[i % list.homes.length];
      animals.push({
        kind: kind,
        mesh: mesh,
        index: i,
        x: home[0] + (rand() - 0.5) * 4,
        z: home[1] + (rand() - 0.5) * 4,
        yaw: rand() * 6.283,
        targetYaw: 0,
        tx: home[0],
        tz: home[1],
        homeX: home[0],
        homeZ: home[1],
        mode: 'idle',
        timer: rand() * 3,
        phase: rand() * 6.283,
        speed: speed * (0.85 + rand() * 0.35),
        radius: radius,
        cool: 1 + rand() * 4,
        hopT: 0,
        y: 0,
        lift: 0,
        pitch: 0,
        rock: 0,
        gait: 0
      });
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    return mesh;
  }

  for (let s = 0; s < cfg.species.length; s++) {
    const sp = cfg.species[s];
    const list = cfg[sp.key];
    addGroup(list, geos[sp.kind], sp.kind, list.speed, list.radius);
  }

  const _capInit = { rear: 0, front: 0, radius: 0.25, mass: 1 };
  const _gap = { dist: 0, minDist: 0, gap: 0, overlap: 0, nx: 0, nz: 1, s: 0, t: 0 };
  const _steer = { x: 0, z: 0, weight: 0, tx: 0, tz: 0 };
  const _stepRes = { moved: false, dirX: 0, dirZ: 1 };
  const _movingFlags = new Uint8Array(animals.length);
  const _prevYaws = new Float64Array(animals.length);
  const _mergedHabitat = {};

  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    const cp = capsuleProfile(a.kind, cfg.scales?.[a.kind] ?? 1, _capInit);
    a.capRear = cp.rear; a.capFront = cp.front; a.capRadius = cp.radius; a.capMass = cp.mass;
    a.encounter = createEncounter(); a.ackCount = 0; a.alerted = false;
    a.nextThink = i / animals.length * (living.thinkInterval ?? 0.2); a.lastThink = 0;
    a.priorityUntil = 0; a.recoverUntil = 0; a.activity = 'forage'; a.attention = 'none';
    a.socialUntil = 0;
    a.quirkCool = 0.8 + lifeRand() * 2.6; a.quirkT = 0; a.quirkDur = 0.45;
  }
  const dummy = new THREE.Object3D();

  function isAirborne(a) {
    return a.kind === 'bird' && (a.mode === 'flush' || a.lift > 0.28);
  }

  function tryDisplaceAnimal(a, dx, dz, hab) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const nx = a.x + dx, nz = a.z + dz;
    if (safeStep(a.kind, a.x, a.z, nx, nz, hab, field)) {
      a.x = nx; a.z = nz;
      return true;
    }
    const ux = dx / len, uz = dz / len;
    // Slide tangentially along pond banks or fences when direct push is blocked.
    for (let s = -1; s <= 1; s += 2) {
      const rx = ux * 0.62 - uz * s * 0.78;
      const rz = ux * s * 0.78 + uz * 0.62;
      const sx = a.x + rx * len, sz = a.z + rz * len;
      if (safeStep(a.kind, a.x, a.z, sx, sz, hab, field)) {
        a.x = sx; a.z = sz;
        return true;
      }
    }
    return false;
  }

  function resolveInitialOverlaps() {
    if (animals.length < 2) return;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        for (let j = i + 1; j < animals.length; j++) {
          const b = animals[j];
          if (Math.abs(a.x - b.x) > 3.2 || Math.abs(a.z - b.z) > 3.2) continue;
          capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius + 0.02, b.x, b.z, b.yaw, b.capRear, b.capFront, b.capRadius + 0.02, _gap);
          if (_gap.overlap <= 1e-4) continue;
          const invA = 1 / a.capMass, invB = 1 / b.capMass, sum = invA + invB;
          const pushA = _gap.overlap * (invA / sum), pushB = _gap.overlap * (invB / sum);
          const mA = tryDisplaceAnimal(a, _gap.nx * pushA, _gap.nz * pushA, habitat);
          const mB = tryDisplaceAnimal(b, -_gap.nx * pushB, -_gap.nz * pushB, habitat);
          if (!mA && mB) tryDisplaceAnimal(b, -_gap.nx * pushA, -_gap.nz * pushA, habitat);
          else if (mA && !mB) tryDisplaceAnimal(a, _gap.nx * pushB, _gap.nz * pushB, habitat);
        }
      }
    }
  }

  function writePose(a, bob = 0, reaction = 0) {
    dummy.position.set(a.x, a.y + bob + a.lift, a.z);
    // The ox nod belongs to its neck; a dog's wag belongs to its tail.
    dummy.rotation.set(a.kind === 'ox' ? 0 : a.pitch, a.yaw, a.rock);
    const sc = cfg.scales?.[a.kind] ?? 1;
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    a.mesh.setMatrixAt(a.index, dummy.matrix);
    a.mesh.geometry.attributes.faunaState.setXYZW(a.index, a.phase, a.gait, reaction, FAUNA_KIND[a.kind]);
  }

  function sampleAnimalGround(a, hab) {
    const g = typeof field.walkSurface === 'function' ? field.walkSurface(a.x, a.z) : field.sample(a.x, a.z);
    const p = hab && hab.pond;
    if (a.kind === 'duck' && p && Number.isFinite(p.waterY)) {
      const pr = (p.radius || 13) + 0.4;
      if (Math.hypot(a.x - p.x, a.z - p.z) < pr) {
        const floatY = p.waterY - 0.085;
        if (floatY > g + 0.005) {
          a.inWater = true;
          return floatY;
        }
      }
    }
    a.inWater = false;
    return g;
  }

  resolveInitialOverlaps();
  for (const a of animals) {
    a.y = sampleAnimalGround(a, habitat);
    writePose(a);
  }
  for (const mesh of group.children) mesh.computeBoundingSphere();

  function angleLerp(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * Math.min(1, k);
  }

  function soundName(kind) {
    return (cfg.sounds && cfg.sounds[kind]) || (cfg.sounds && cfg.sounds.default) || null;
  }

  function react(index, px, pz) {
    const a = animals[index];
    if (!a) return null;
    const r = cfg.react;
    const dx = a.x - px;
    const dz = a.z - pz;
    const away = awayVector(a.x, a.z, px, pz, a.yaw);
    a.priorityUntil = visualClock + (a.kind === 'dog' ? r.followDuration : a.kind === 'ox' ? r.glanceDuration : a.kind === 'bird' ? r.flushTime : a.kind === 'duck' ? r.paddleTime : r.flutterTime);
    a.recoverUntil = a.priorityUntil + (living.recovery ?? 2);
    a.encounter.armed = false; a.encounter.dwell = 0; a.encounter.outside = 0;
    a.socialUntil = 0; a.attention = 'player';
    if (a.kind === 'chicken') {
      a.tx = a.x + away.x * r.fleeDistance;
      a.tz = a.z + away.z * r.fleeDistance;
      a.mode = 'flee';
      a.timer = r.flutterTime;
      a.hopT = r.flutterTime;
      a.targetYaw = Math.atan2(dx, dz);
      a.cool = Math.max(a.cool, 2.4);
    } else if (a.kind === 'dog') {
      a.mode = 'follow';
      a.timer = r.followDuration;
      a.cool = Math.max(a.cool, 2.2);
    } else if (a.kind === 'bird') {
      // 惊飞：沿正弦弧腾空、斜飞到附近落点，与鸡的水平扑逃区分。
      const ang = Math.atan2(away.x, away.z) + (rand() - 0.5) * 1.1;
      a.tx = a.x + Math.sin(ang) * r.flushDistance;
      a.tz = a.z + Math.cos(ang) * r.flushDistance;
      a.mode = 'flush';
      a.timer = r.flushTime;
      a.lift = 0;
      a.targetYaw = Math.atan2(a.tx - a.x, a.tz - a.z);
      a.cool = Math.max(a.cool, 2);
    } else if (a.kind === 'ox') {
      // 回首：转身面向玩家、轻点头、慢迈一小步，不追不逃，与犬的跟随区分。
      a.targetYaw = Math.atan2(px - a.x, pz - a.z);
      a.tx = a.x + Math.sin(a.targetYaw) * r.glanceStep;
      a.tz = a.z + Math.cos(a.targetYaw) * r.glanceStep;
      a.mode = 'glance';
      a.timer = r.glanceDuration;
      a.pitch = r.nod;
      a.cool = Math.max(a.cool, 3.2);
    } else {
      // 游远：沿池畔划开一小段、轻晃，覆盖水陆空三种微生境。
      a.tx = a.x + away.x * r.paddleDistance;
      a.tz = a.z + away.z * r.paddleDistance;
      a.mode = 'paddle';
      a.timer = r.paddleTime;
      a.rock = r.rock;
      a.targetYaw = Math.atan2(dx, dz);
      a.cool = Math.max(a.cool, 2.2);
    }
    if (a.kind !== 'dog' && !safeSegment(a.kind, a.x, a.z, a.tx, a.tz, habitat, field)) { a.tx = a.x; a.tz = a.z; }
    if (a.kind === 'dog') { a.tx = a.x; a.tz = a.z; a.nextThink = visualClock; }
    return soundName(a.kind);
  }

  function steerAnimalStep(a, idx, dx, dz, d, stepLen, hab) {
    const ux = dx / d, uz = dz / d;
    if (isAirborne(a) || stepLen <= 1e-6) {
      a.x += ux * stepLen;
      a.z += uz * stepLen;
      _stepRes.moved = stepLen > 1e-6;
      _stepRes.dirX = ux;
      _stepRes.dirZ = uz;
      return _stepRes;
    }

    let steerX = 0, steerZ = 0, maxW = 0, minGap = 99;
    let worstNx = 0, worstNz = 0;

    // 1. Peer fauna capsules
    for (let j = 0; j < animals.length; j++) {
      if (j === idx) continue;
      const b = animals[j];
      if (isAirborne(b)) continue;
      // Larger animals do not swerve wide around tiny sparrows; sparrows hop aside instead.
      if (a.kind !== 'bird' && b.kind === 'bird') continue;
      if (Math.abs(b.x - a.x) > 4.2 || Math.abs(b.z - a.z) > 4.2) continue;
      capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius, b.x, b.z, b.yaw, b.capRear, b.capFront, b.capRadius, _gap);
      const margin = (a.kind === 'ox' || b.kind === 'ox') ? 0.58 : (a.kind === 'dog' || b.kind === 'dog') ? 0.36 : 0.26;
      if (_gap.gap < minGap) { minGap = _gap.gap; worstNx = _gap.nx; worstNz = _gap.nz; }
      steerAroundCapsule(ux, uz, _gap, margin, 1, _steer);
      if (_steer.weight > 0) {
        steerX += _steer.x; steerZ += _steer.z;
        if (_steer.weight > maxW) maxW = _steer.weight;
      }
    }

    // 2. Homestead sculpted animals (water buffalo, hen brood, doorway yellow dog)
    const extraAnimals = hab.extraAnimals;
    if (extraAnimals) {
      for (let j = 0; j < extraAnimals.length; j++) {
        const b = extraAnimals[j];
        if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
        if (Math.abs(b.x - a.x) > 4.5 || Math.abs(b.z - a.z) > 4.5) continue;
        const bRear = b.rear ?? b.capRear ?? 0;
        const bFront = b.front ?? b.capFront ?? 0;
        const bRad = b.radius ?? b.capRadius ?? 0.35;
        capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius, b.x, b.z, b.yaw || 0, bRear, bFront, bRad, _gap);
        const margin = (a.kind === 'ox' || b.kind === 'buffalo') ? 0.62 : 0.36;
        if (_gap.gap < minGap) { minGap = _gap.gap; worstNx = _gap.nx; worstNz = _gap.nz; }
        steerAroundCapsule(ux, uz, _gap, margin, 1, _steer);
        if (_steer.weight > 0) {
          steerX += _steer.x; steerZ += _steer.z;
          if (_steer.weight > maxW) maxW = _steer.weight;
        }
      }
    }

    // 3. Villagers & community actors
    for (let src = 0; src < 2; src++) {
      const groupList = src === 0 ? hab.people : hab.extraActors;
      if (!groupList) continue;
      for (let j = 0; j < groupList.length; j++) {
        const p = groupList[j];
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
        if (Math.abs(p.x - a.x) > 4.2 || Math.abs(p.z - a.z) > 4.2) continue;
        const rP = (p.basket ? 0.34 : 0.30) * (p.s || p.scale || 1);
        capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius, p.x, p.z, 0, 0, 0, rP, _gap);
        const margin = a.kind === 'ox' ? 0.56 : 0.34;
        if (_gap.gap < minGap) { minGap = _gap.gap; worstNx = _gap.nx; worstNz = _gap.nz; }
        steerAroundCapsule(ux, uz, _gap, margin, 1, _steer);
        if (_steer.weight > 0) {
          steerX += _steer.x; steerZ += _steer.z;
          if (_steer.weight > maxW) maxW = _steer.weight;
        }
      }
    }

    let bx = ux, bz = uz;
    if (maxW > 1e-4) {
      const sl = Math.hypot(steerX, steerZ);
      if (sl > 1e-6) {
        const k = Math.min(0.88, maxW);
        bx = ux * (1 - k) + (steerX / sl) * k;
        bz = uz * (1 - k) + (steerZ / sl) * k;
        const bl = Math.hypot(bx, bz) || 1;
        bx /= bl; bz /= bl;
      }
    }

    let actualStep = stepLen;
    if (minGap < 0.05 && (bx * worstNx + bz * worstNz) < -0.12) {
      actualStep *= Math.max(0, (minGap + 0.05) / 0.10);
    }
    if (actualStep <= 1e-5) {
      _stepRes.moved = false; _stepRes.dirX = bx; _stepRes.dirZ = bz;
      return _stepRes;
    }

    const nx = a.x + bx * actualStep, nz = a.z + bz * actualStep;
    if (maxW <= 1e-4 || safeStep(a.kind, a.x, a.z, nx, nz, hab, field)) {
      if (maxW <= 1e-4 && !safeStep(a.kind, a.x, a.z, nx, nz, hab, field)) {
        // Preserve original unsteered behavior only if habitat was unconfigured, else clamp to safe ground.
        if (!hab.blockers && !hab.pond && !hab.distanceToRiver && !Number.isFinite(hab.waterLevel)) {
          a.x = nx; a.z = nz;
          _stepRes.moved = true; _stepRes.dirX = bx; _stepRes.dirZ = bz;
          return _stepRes;
        }
        _stepRes.moved = false; _stepRes.dirX = ux; _stepRes.dirZ = uz;
        return _stepRes;
      }
      a.x = nx; a.z = nz;
      _stepRes.moved = true; _stepRes.dirX = bx; _stepRes.dirZ = bz;
      return _stepRes;
    }

    // Fallback: mirror steering side around desired heading, then straight heading.
    const mx = 2 * ux - bx, mz = 2 * uz - bz, ml = Math.hypot(mx, mz) || 1;
    const fx = mx / ml, fz = mz / ml;
    const fnx = a.x + fx * actualStep, fnz = a.z + fz * actualStep;
    if ((minGap >= 0.02 || fx * worstNx + fz * worstNz >= -0.08) && safeStep(a.kind, a.x, a.z, fnx, fnz, hab, field)) {
      a.x = fnx; a.z = fnz;
      _stepRes.moved = true; _stepRes.dirX = fx; _stepRes.dirZ = fz;
      return _stepRes;
    }
    const snx = a.x + ux * actualStep, snz = a.z + uz * actualStep;
    if (minGap >= 0.03 && safeStep(a.kind, a.x, a.z, snx, snz, hab, field)) {
      a.x = snx; a.z = snz;
      _stepRes.moved = true; _stepRes.dirX = ux; _stepRes.dirZ = uz;
      return _stepRes;
    }
    _stepRes.moved = false; _stepRes.dirX = bx; _stepRes.dirZ = bz;
    return _stepRes;
  }

  function targetBlockedByOccupant(a, idx, hab) {
    for (let j = 0; j < animals.length; j++) {
      if (j === idx) continue;
      const b = animals[j];
      if (isAirborne(b) || (a.kind !== 'bird' && b.kind === 'bird')) continue;
      if (Math.abs(b.x - a.tx) > 2.2 || Math.abs(b.z - a.tz) > 2.2) continue;
      capsuleGap(a.tx, a.tz, a.yaw, a.capRear, a.capFront, a.capRadius, b.x, b.z, b.yaw, b.capRear, b.capFront, b.capRadius, _gap);
      if (_gap.gap < 0.04) {
        capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius, b.x, b.z, b.yaw, b.capRear, b.capFront, b.capRadius, _gap);
        if (_gap.gap < 0.22) return true;
      }
    }
    const extraAnimals = hab.extraAnimals;
    if (extraAnimals) {
      for (let j = 0; j < extraAnimals.length; j++) {
        const b = extraAnimals[j];
        if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
        if (Math.abs(b.x - a.tx) > 2.4 || Math.abs(b.z - a.tz) > 2.4) continue;
        const bRear = b.rear ?? b.capRear ?? 0;
        const bFront = b.front ?? b.capFront ?? 0;
        const bRad = b.radius ?? b.capRadius ?? 0.35;
        capsuleGap(a.tx, a.tz, a.yaw, a.capRear, a.capFront, a.capRadius, b.x, b.z, b.yaw || 0, bRear, bFront, bRad, _gap);
        if (_gap.gap < 0.04) {
          capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius, b.x, b.z, b.yaw || 0, bRear, bFront, bRad, _gap);
          if (_gap.gap < 0.24) return true;
        }
      }
    }
    for (let src = 0; src < 2; src++) {
      const groupList = src === 0 ? hab.people : hab.extraActors;
      if (!groupList) continue;
      for (let j = 0; j < groupList.length; j++) {
        const p = groupList[j];
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
        if (Math.abs(p.x - a.tx) > 2.0 || Math.abs(p.z - a.tz) > 2.0) continue;
        const rP = (p.basket ? 0.34 : 0.30) * (p.s || p.scale || 1);
        capsuleGap(a.tx, a.tz, a.yaw, a.capRear, a.capFront, a.capRadius, p.x, p.z, 0, 0, 0, rP, _gap);
        if (_gap.gap < 0.04) {
          capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius, p.x, p.z, 0, 0, 0, rP, _gap);
          if (_gap.gap < 0.24) return true;
        }
      }
    }
    return false;
  }

  function update(dt, elapsed, px, pz, currentContext = context) {
    // Pause/hidden-tab time is not simulation time. Never integrate a stale
    // wall-clock delta or derive animation from elapsed (which may jump on resume).
    dt = livingStep(dt);
    if (!dt) return;
    dt = Math.min(dt, motion.maxStep > 0 ? motion.maxStep : FAUNA_MOTION_DEFAULTS.maxStep);
    if (currentContext === context) {
      habitat = context;
    } else {
      for (const k in _mergedHabitat) delete _mergedHabitat[k];
      Object.assign(_mergedHabitat, context, currentContext);
      habitat = _mergedHabitat;
    }
    visualClock += dt;
    const pauseMin = cfg.pauseRange[0];
    const pauseMax = cfg.pauseRange[1];
    const r = cfg.react;
    const gaps = cfg.gaps || {};
    const isNight = habitat.timeId === 'night' || habitat.isNight === true;
    const isDusk = habitat.timeId === 'dusk';
    const rainAmt = Number(habitat.rainIntensity) || 0;

    // Pass 1: AI decisions, mode transitions, predictive tangential steering & yaw
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      _prevYaws[i] = a.yaw;
      let moving = false;
      const rainShelter = !isNight && rainAmt > 0.28 && (a.kind === 'chicken' || a.kind === 'bird');
      const nightDogWatch = isNight && a.kind === 'dog' && Number.isFinite(px) && Number.isFinite(pz) &&
        Math.hypot(px - a.x, pz - a.z) < 3.6 && Math.hypot(a.homeX - a.x, a.homeZ - a.z) < 2.2 &&
        sightClear(a.x, a.z, px, pz, habitat.blockers || []);
      const wantsRest = (isNight && !nightDogWatch) || rainShelter;

      if (nightDogWatch && visualClock >= a.priorityUntil) {
        a.mode = 'watch';
        a.timer = 0.8;
        a.targetYaw = Math.atan2(px - a.x, pz - a.z);
        a.attention = 'player';
      } else if (wantsRest && visualClock >= a.priorityUntil) {
        const dh = Math.hypot(a.homeX - a.x, a.homeZ - a.z);
        if (dh > 0.85 && a.mode !== 'return' && a.mode !== 'sleep' && a.mode !== 'flee' && a.mode !== 'flush' && a.mode !== 'glance' && a.mode !== 'paddle' && a.mode !== 'follow') {
          if (safeSegment(a.kind, a.x, a.z, a.homeX, a.homeZ, habitat, field)) {
            a.tx = a.homeX; a.tz = a.homeZ; a.mode = 'return';
          } else {
            a.mode = 'sleep'; a.timer = 1.5;
          }
        } else if (dh <= 0.85 && a.mode !== 'sleep' && a.mode !== 'follow' && a.mode !== 'flee' && a.mode !== 'flush' && a.mode !== 'glance' && a.mode !== 'paddle') {
          a.mode = 'sleep'; a.timer = 1.5;
        }
      } else if (!wantsRest && a.mode === 'sleep') {
        a.mode = 'idle';
        a.lift = 0;
        a.pitch = 0;
        if (a.gait < 0) a.gait = 0;
        a.timer = 0.4 + lifeRand() * 1.4;
      }
      if (visualClock >= a.nextThink) {
        const step = Math.min(0.3, visualClock - a.lastThink);
        a.lastThink = visualClock; a.nextThink = visualClock + Math.max(0.1, living.thinkInterval ?? 0.2);
        const distance = Math.hypot(px - a.x, pz - a.z);
        const visible = distance < (living.noticeRange ?? 4) && sightClear(a.x, a.z, px, pz, habitat.blockers || []);
        if (distance > (living.exitRange ?? 6)) a.alerted = false;
        const event = encounterEvent(a.encounter, distance, visible, step, { range: living.noticeRange ?? 4, exitRange: living.exitRange ?? 6, dwell: living.noticeDwell ?? 0.4 });
        const startled = visible && !a.alerted && (distance < (living.tooClose ?? 1.1) || ((habitat.playerSpeed || 0) >= (living.fastSpeed ?? 5.5) && distance < (living.startleRange ?? 3.2)));
        if (living.enabled !== false && visualClock >= a.priorityUntil && visualClock >= a.recoverUntil && (event || startled)) {
          a.ackCount++; a.attention = 'player';
          if (startled || a.kind === 'ox' || a.kind === 'dog') {
            react(i, px, pz);
            a.priorityUntil = 0; // autonomous action never holds E's priority lease
            if (startled) {
              a.alerted = true;
              if (a.kind === 'bird') {
                for (let j = 0; j < animals.length; j++) {
                  if (j === i) continue;
                  const b = animals[j];
                  if (b.kind === 'bird' && visualClock >= b.priorityUntil && visualClock >= b.recoverUntil && Math.hypot(b.x - a.x, b.z - a.z) < 4.2) {
                    react(j, px, pz);
                    b.priorityUntil = 0;
                    b.alerted = true;
                    b.recoverUntil = visualClock + b.timer + (living.recovery ?? 2);
                  }
                }
              }
            }
            if (a.kind === 'dog') a.timer = living.curiousFollow ?? 3.5;
            a.recoverUntil = visualClock + a.timer + (living.recovery ?? 2);
          } else {
            a.mode = 'watch'; a.timer = living.watchDuration ?? 1.4;
            a.targetYaw = Math.atan2(px - a.x, pz - a.z);
            a.recoverUntil = visualClock + a.timer + (living.recovery ?? 2);
          }
        }
        // A child pauses to watch a dog; it turns back and wags, without new props/audio/UI.
        if (living.enabled !== false && a.kind === 'dog' && (a.mode === 'idle' || a.mode === 'walk') && visualClock >= a.recoverUntil && visualClock >= a.priorityUntil && !event && !startled) {
          for (const p of habitat.people || []) {
            if (p.role !== 'child' || p.attention !== 'animal' || p.greetT > 0 || Math.hypot(p.x-a.x,p.z-a.z) > 3 || !sightClear(a.x,a.z,p.x,p.z,habitat.blockers || [])) continue;
            a.mode = 'watch'; a.timer = 1.8; a.socialUntil = visualClock + 1.8; a.attention = 'villager';
            a.targetYaw = Math.atan2(p.x-a.x,p.z-a.z); a.recoverUntil = visualClock + 6; break;
          }
        }
        // Following samples a safe target at decision rate, never scans colliders per frame.
        if (a.mode === 'follow') {
          const dx = px-a.x, dz = pz-a.z, distance = Math.hypot(dx,dz);
          const reach = Math.max(0, Math.min(distance-r.followDist, (living.thinkInterval ?? 0.2)*r.followSpeed*1.5));
          const tx = a.x+(distance ? dx/distance*reach : 0), tz = a.z+(distance ? dz/distance*reach : 0);
          const clear = safeSegment(a.kind,a.x,a.z,tx,tz,habitat,field);
          a.tx = clear ? tx : a.x; a.tz = clear ? tz : a.z;
        }
      }

      if (a.mode === 'watch') {
        a.timer -= dt;
        if (a.timer <= 0) { a.mode = 'idle'; a.timer = pauseMin + lifeRand() * (pauseMax-pauseMin); a.attention = 'none'; }
      } else if (a.mode === 'flee') {
        a.timer -= dt;
        const dx = a.tx - a.x;
        const dz = a.tz - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.12) {
          const step = Math.min(d, r.fleeSpeed * dt);
          const mv = steerAnimalStep(a, i, dx, dz, d, step, habitat);
          a.targetYaw = Math.atan2(mv.dirX, mv.dirZ);
          moving = mv.moved;
        }
        if (a.timer <= 0 || d <= 0.12) {
          a.mode = 'idle';
          a.timer = pauseMin + rand() * (pauseMax - pauseMin);
        }
      } else if (a.mode === 'flush') {
        // 正弦弧腾空 + 斜飞：lift 随进度 0→1 起落。
        a.timer -= dt;
        const k = 1 - Math.max(0, a.timer) / r.flushTime;
        const dx = a.tx - a.x;
        const dz = a.tz - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.12) {
          const step = Math.min(d, r.flushSpeed * dt);
          a.x += (dx / d) * step;
          a.z += (dz / d) * step;
        }
        a.lift = Math.sin(Math.min(1, k) * Math.PI) * r.flushRise;
        a.targetYaw = Math.atan2(dx, dz);
        moving = true;
        if (a.timer <= 0) {
          a.lift = 0;
          a.mode = 'idle';
          a.timer = pauseMin + rand() * (pauseMax - pauseMin);
        }
      } else if (a.mode === 'glance') {
        a.timer -= dt;
        const dx = a.tx - a.x;
        const dz = a.tz - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const step = Math.min(d, r.glanceSpeed * dt);
          const mv = steerAnimalStep(a, i, dx, dz, d, step, habitat);
          moving = mv.moved;
        }
        a.pitch = Math.max(0, a.pitch - dt * (r.nod / r.glanceDuration));
        a.targetYaw = Math.atan2(px - a.x, pz - a.z);
        if (a.timer <= 0) {
          a.pitch = 0;
          a.mode = 'idle';
          a.timer = pauseMin + rand() * (pauseMax - pauseMin);
        }
      } else if (a.mode === 'paddle') {
        a.timer -= dt;
        const dx = a.tx - a.x;
        const dz = a.tz - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.1) {
          const step = Math.min(d, r.paddleSpeed * dt);
          const mv = steerAnimalStep(a, i, dx, dz, d, step, habitat);
          a.targetYaw = Math.atan2(mv.dirX, mv.dirZ);
          moving = mv.moved;
        }
        a.rock = Math.sin(visualClock * r.rockSpeed + a.phase) * r.rock;
        if (a.timer <= 0) {
          a.rock = 0;
          a.mode = 'idle';
          a.timer = pauseMin + rand() * (pauseMax - pauseMin);
        }
      } else if (a.mode === 'follow') {
        a.timer -= dt;
        const dx = px - a.x;
        const dz = pz - a.z;
        const d = Math.hypot(dx, dz);
        a.targetYaw = Math.atan2(dx, dz);
        const tx = a.tx-a.x, tz = a.tz-a.z, targetDistance = Math.hypot(tx,tz);
        if (targetDistance > 0.001) {
          const step = Math.min(targetDistance, r.followSpeed * dt);
          const mv = steerAnimalStep(a, i, tx, tz, targetDistance, step, habitat);
          moving = mv.moved;
        }
        if (a.timer <= 0 || d > r.leash) {
          a.mode = 'return';
          const clear = safeSegment(a.kind,a.x,a.z,a.homeX,a.homeZ,habitat,field);
          a.tx = clear ? a.homeX : a.x; a.tz = clear ? a.homeZ : a.z;
        }
      } else if (a.mode === 'return') {
        const dx = a.tx - a.x;
        const dz = a.tz - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.45 || (d < 1.15 && targetBlockedByOccupant(a, i, habitat))) {
          a.mode = wantsRest ? 'sleep' : 'idle';
          a.timer = pauseMin + rand() * (pauseMax - pauseMin);
        } else {
          const step = Math.min(d, a.speed * dt);
          const mv = steerAnimalStep(a, i, dx, dz, d, step, habitat);
          a.targetYaw = Math.atan2(mv.dirX, mv.dirZ);
          moving = mv.moved;
        }
      } else if (a.mode === 'sleep') {
        // 夜间回巢卧眠，安静收翅低首
        a.cool = Math.max(a.cool, 1.5);
        a.quirkT = 0;
      } else if (a.mode === 'idle') {
        a.timer -= dt;
        a.quirkCool -= dt;
        if (a.quirkCool <= 0 && a.attention === 'none') {
          if (a.kind === 'chicken') {
            a.quirkDur = 0.44; a.quirkT = 0.44;
            a.targetYaw += (lifeRand() - 0.5) * 1.15;
            a.quirkCool = 1.2 + lifeRand() * 2.4;
          } else if (a.kind === 'bird') {
            a.quirkDur = 0.36; a.quirkT = 0.36;
            a.targetYaw += (lifeRand() - 0.5) * 1.5;
            a.quirkCool = 1.5 + lifeRand() * 2.8;
          } else if (a.kind === 'duck') {
            a.quirkDur = 0.68; a.quirkT = 0.68;
            a.quirkCool = 2.4 + lifeRand() * 3.6;
          } else if (a.kind === 'dog') {
            a.quirkDur = 0.72; a.quirkT = 0.72;
            a.targetYaw += (lifeRand() - 0.5) * 0.9;
            a.quirkCool = 2.6 + lifeRand() * 3.5;
          } else {
            a.quirkCool = 3.0;
          }
        }
        if (a.timer <= 0) {
          let tx = null, tz = null;
          if (a.kind === 'chicken' && lifeRand() < 0.35) {
            for (const mate of animals) {
              if (mate !== a && mate.kind === 'chicken' && Math.hypot(mate.x - a.x, mate.z - a.z) < 6.0) {
                let ox = (rand() - 0.5) * 1.6;
                let oz = (rand() - 0.5) * 1.6;
                const od = Math.hypot(ox, oz);
                if (od < 0.72) {
                  const ang = od > 1e-4 ? Math.atan2(ox, oz) : a.phase;
                  ox = Math.sin(ang) * 0.72;
                  oz = Math.cos(ang) * 0.72;
                }
                tx = mate.x + ox;
                tz = mate.z + oz;
                break;
              }
            }
          }
          if (tx === null) {
            const ang = rand() * 6.283;
            const radiusScale = isDusk ? (a.kind === 'dog' ? 0.55 : 0.30) : 1.0;
            const rr = Math.sqrt(rand()) * a.radius * radiusScale;
            tx = a.homeX + Math.cos(ang) * rr;
            tz = a.homeZ + Math.sin(ang) * rr;
          }
          a.tx = tx; a.tz = tz;
          if (safeSegment(a.kind,a.x,a.z,a.tx,a.tz,habitat,field)) { a.mode = 'walk'; a.quirkT = 0; }
          else { a.tx = a.x; a.tz = a.z; a.timer = pauseMin + lifeRand() * (pauseMax-pauseMin); }
        }
      } else {
        const dx = a.tx - a.x;
        const dz = a.tz - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3 || (d < 1.05 && targetBlockedByOccupant(a, i, habitat))) {
          a.mode = 'idle';
          a.timer = pauseMin + rand() * (pauseMax - pauseMin);
        } else {
          const step = Math.min(d, a.speed * dt);
          const mv = steerAnimalStep(a, i, dx, dz, d, step, habitat);
          const curveBias = a.kind === 'duck' ? Math.sin(visualClock * 1.8 + a.phase) * 0.24 : 0;
          a.targetYaw = Math.atan2(mv.dirX, mv.dirZ) + curveBias;
          moving = mv.moved;
        }
      }

      a.yaw = angleLerp(a.yaw, a.targetYaw, cfg.turnRate * dt);
      _movingFlags[i] = moving ? 1 : 0;
    }

    // Pass 2: Multi-agent capsule relaxation (animals, homestead livestock & villagers)
    const maxCorr = Math.max(0.09, 4.2 * dt);
    const extraAnimals = habitat.extraAnimals;
    for (let pass = 0; pass < 2; pass++) {
      // 2a. Grounded sparrows lightly hop aside for approaching cattle, dogs, or people
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (a.kind !== 'bird' || isAirborne(a)) continue;
        for (let j = 0; j < animals.length; j++) {
          if (j === i) continue;
          const b = animals[j];
          if (b.kind === 'bird' || isAirborne(b)) continue;
          if (Math.abs(b.x - a.x) > 2.4 || Math.abs(b.z - a.z) > 2.4) continue;
          capsuleGap(a.x, a.z, a.yaw, 0, 0, a.capRadius + 0.14, b.x, b.z, b.yaw, b.capRear, b.capFront, b.capRadius, _gap);
          if (_gap.overlap > 1e-4) {
            const push = Math.min(_gap.overlap, Math.max(0.06, 3.2 * dt));
            if (tryDisplaceAnimal(a, _gap.nx * push, _gap.nz * push, habitat) && a.mode === 'idle') {
              a.quirkDur = 0.34; a.quirkT = Math.max(a.quirkT, 0.22);
              a.targetYaw = Math.atan2(_gap.nx, _gap.nz);
            }
          }
        }
        for (let src = 0; src < 2; src++) {
          const groupList = src === 0 ? habitat.people : habitat.extraActors;
          if (!groupList) continue;
          for (let j = 0; j < groupList.length; j++) {
            const p = groupList[j];
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
            if (Math.abs(p.x - a.x) > 1.8 || Math.abs(p.z - a.z) > 1.8) continue;
            const rP = (p.basket ? 0.34 : 0.30) * (p.s || p.scale || 1);
            capsuleGap(a.x, a.z, a.yaw, 0, 0, a.capRadius + 0.12, p.x, p.z, 0, 0, 0, rP, _gap);
            if (_gap.overlap > 1e-4) {
              const push = Math.min(_gap.overlap, Math.max(0.06, 3.2 * dt));
              if (tryDisplaceAnimal(a, _gap.nx * push, _gap.nz * push, habitat) && a.mode === 'idle') {
                a.quirkDur = 0.34; a.quirkT = Math.max(a.quirkT, 0.22);
              }
            }
          }
        }
      }

      // 2b. Fauna-vs-fauna capsule separation
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (isAirborne(a)) continue;
        for (let j = i + 1; j < animals.length; j++) {
          const b = animals[j];
          if (isAirborne(b)) continue;
          if (Math.abs(a.x - b.x) > 3.2 || Math.abs(a.z - b.z) > 3.2) continue;
          capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius + 0.015, b.x, b.z, b.yaw, b.capRear, b.capFront, b.capRadius + 0.015, _gap);
          if (_gap.overlap <= 1e-4) continue;
          const invA = (a.mode === 'sleep' ? 0.25 : 1) / a.capMass;
          const invB = (b.mode === 'sleep' ? 0.25 : 1) / b.capMass;
          const sum = invA + invB;
          const corr = Math.min(_gap.overlap, maxCorr);
          const pushA = corr * (invA / sum);
          const pushB = corr * (invB / sum);
          const mA = tryDisplaceAnimal(a, _gap.nx * pushA, _gap.nz * pushA, habitat);
          const mB = tryDisplaceAnimal(b, -_gap.nx * pushB, -_gap.nz * pushB, habitat);
          if (!mA && mB) tryDisplaceAnimal(b, -_gap.nx * pushA, -_gap.nz * pushA, habitat);
          else if (mA && !mB) tryDisplaceAnimal(a, _gap.nx * pushB, _gap.nz * pushB, habitat);
        }
      }

      // 2c. Fauna-vs-homestead livestock (water buffalo, hen+chicks, doorway yellow dog)
      if (extraAnimals) {
        for (let i = 0; i < animals.length; i++) {
          const a = animals[i];
          if (isAirborne(a)) continue;
          for (let j = 0; j < extraAnimals.length; j++) {
            const b = extraAnimals[j];
            if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
            if (Math.abs(b.x - a.x) > 3.5 || Math.abs(b.z - a.z) > 3.5) continue;
            const bRear = b.rear ?? b.capRear ?? 0;
            const bFront = b.front ?? b.capFront ?? 0;
            const bRad = b.radius ?? b.capRadius ?? 0.35;
            capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius + 0.015, b.x, b.z, b.yaw || 0, bRear, bFront, bRad + 0.015, _gap);
            if (_gap.overlap <= 1e-4) continue;
            const corr = Math.min(_gap.overlap, maxCorr);
            tryDisplaceAnimal(a, _gap.nx * corr, _gap.nz * corr, habitat);
          }
        }
      }

      // 2d. Fauna-vs-villagers (seated/greeting/stationed people stay anchored; walkers share smoothly)
      for (let src = 0; src < 2; src++) {
        const groupList = src === 0 ? habitat.people : habitat.extraActors;
        if (!groupList) continue;
        const isExtra = src === 1;
        for (let i = 0; i < animals.length; i++) {
          const a = animals[i];
          if (isAirborne(a)) continue;
          for (let j = 0; j < groupList.length; j++) {
            const p = groupList[j];
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
            if (Math.abs(p.x - a.x) > 3.2 || Math.abs(p.z - a.z) > 3.2) continue;
            const rP = (p.basket ? 0.34 : 0.30) * (p.s || p.scale || 1);
            capsuleGap(a.x, a.z, a.yaw, a.capRear, a.capFront, a.capRadius + 0.015, p.x, p.z, 0, 0, 0, rP, _gap);
            if (_gap.overlap <= 1e-4) continue;
            const anchored = isExtra || p.greetT > 0 || p.mode === 'sit' || p.mode === 'talk' || p.mode === 'work' || Boolean(p.shelter && p.shelter.phase === 'out');
            const share = a.kind === 'ox' ? (anchored ? 1.0 : 0.45) : 1.0;
            const corr = Math.min(_gap.overlap * share, maxCorr);
            const moved = tryDisplaceAnimal(a, _gap.nx * corr, _gap.nz * corr, habitat);
            if (!moved && anchored && a.kind === 'ox' && Math.abs(a.yaw - _prevYaws[i]) > 1e-4) {
              const curOverlap = _gap.overlap;
              capsuleGap(a.x, a.z, _prevYaws[i], a.capRear, a.capFront, a.capRadius + 0.015, p.x, p.z, 0, 0, 0, rP, _gap);
              if (_gap.overlap < curOverlap) a.yaw = _prevYaws[i];
            }
          }
        }
      }
    }

    // Pass 3: Terrain sampling, procedural micro-motion, pose write & spatial audio
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      const moving = _movingFlags[i] === 1;
      a.phase += dt * (a.mode === 'sleep' ? 0.35 : moving ? 9 : 1.7);
      a.y = sampleAnimalGround(a, habitat);
      let bob = moving
        ? Math.abs(Math.sin(a.phase)) * 0.032
        : (a.inWater ? Math.sin(a.phase * 0.8) * 0.008 : (1 + Math.sin(a.phase * 0.7)) * 0.0035);
      let wag = 0;
      const distPlayer = Math.hypot(px - a.x, pz - a.z);
      if (a.quirkT > 0) {
        a.quirkT = Math.max(0, a.quirkT - dt);
        const qk = 1 - a.quirkT / Math.max(0.01, a.quirkDur);
        const pulse = Math.sin(qk * Math.PI);
        if (a.kind === 'chicken') {
          const peck = Math.abs(Math.sin(qk * Math.PI * 2));
          a.pitch = peck * 0.36;
        } else if (a.kind === 'bird' && a.mode === 'idle') {
          a.lift = pulse * Math.min(0.11, r.flushRise * 0.14);
        } else if (a.kind === 'duck') {
          a.pitch = pulse * 0.32;
        } else if (a.kind === 'dog') {
          a.pitch = pulse * 0.08;
        }
      } else {
        if (a.mode === 'idle' && a.kind === 'bird') a.lift = 0;
        else if (a.mode !== 'sleep' && a.mode !== 'flush') a.lift *= Math.max(0, 1 - dt * 10);
        if (a.kind === 'ox' && a.mode !== 'glance') {
          a.pitch = Math.max(0, 0.5 * (1 + Math.sin(visualClock * 0.85 + a.phase)) * r.nod * 0.75);
        } else if (a.kind !== 'ox') {
          a.pitch *= Math.max(0, 1 - dt * 8);
        }
      }
      if (a.kind === 'duck' && a.mode !== 'paddle' && a.mode !== 'sleep') {
        a.rock = Math.sin(visualClock * 2.1 + a.phase) * (moving ? 0.055 : 0.03);
      }
      if (a.hopT > 0) {
        a.hopT = Math.max(0, a.hopT - dt);
        const k = 1 - a.hopT / r.flutterTime;
        bob += Math.sin(k * Math.PI) * r.hop;
      }
      if (a.kind === 'dog' && a.mode !== 'sleep' && (a.mode === 'follow' || a.mode === 'return' || visualClock < a.socialUntil || distPlayer < 5.5)) {
        wag = Math.sin(visualClock * r.wagSpeed + a.phase) * r.wag * (a.mode === 'follow' ? 1.32 : 0.85);
        if (a.mode === 'follow' && distPlayer < (r.followDist || 1.8) + 0.55) {
          // 亲人小揖：黄犬随行至脚边时欢快仰首摇尾（不将爪掌压入地下）
          bob = Math.max(0, bob - 0.004);
          a.pitch = -0.09 + Math.sin(visualClock * 6.2 + a.phase) * 0.035;
        }
      }

      if (a.mode === 'sleep') {
        a.gait += (-1 - a.gait) * Math.min(1, dt * 6);
      } else {
        const baseGait = Math.max(0, a.gait);
        a.gait = baseGait + ((moving ? 1 : 0) - baseGait) * Math.min(1, dt * 12);
      }
      let reaction = 0;
      if (a.kind === 'ox') reaction = a.pitch;
      else if (a.kind === 'dog') reaction = wag;
      else if (a.kind === 'bird') reaction = a.mode === 'flush' ? 1 : 0;
      else if (a.kind === 'chicken') reaction = a.hopT > 0 ? 1 : 0;
      else if (a.kind === 'duck') reaction = a.mode === 'paddle' ? 1 : 0;
      a.activity = a.mode === 'sleep' ? 'rest' : a.mode === 'watch' ? 'watch' : a.mode === 'follow' ? 'curious' : a.mode === 'flee' || a.mode === 'flush' || a.mode === 'paddle' ? 'startled' : moving ? 'wander' : 'forage';
      if (a.mode === 'sleep') {
        const sleepK = Math.max(0, -a.gait);
        bob = (1 + Math.sin(visualClock * 1.1 + a.phase)) * 0.0025;
        a.lift = sleepK * (
          a.kind === 'ox' ? -0.21
            : a.kind === 'dog' ? -0.21
              : a.kind === 'chicken' ? -0.11
                : a.kind === 'bird' ? -0.042
                  : a.inWater ? 0 : -0.042
        );
        a.pitch = 0.08 * sleepK;
        a.rock = 0;
        reaction = 0;
      }
      if (visualClock >= a.recoverUntil && a.mode === 'idle') a.attention = 'none';
      writePose(a, bob, reaction);

      // 靠近才叫（睡眠安静不喧闹）：按 kind 分派声音函数，去掉 chicken/dog 硬编码分支。
      if (a.mode !== 'sleep' && distPlayer < cfg.soundRadius) {
        a.cool -= dt;
        if (a.cool <= 0) {
          const call = soundName(a.kind);
          if (call && typeof sound[call] === 'function') sound[call](a.x, a.z);
          const gap = gaps[a.kind] || gaps.default || [2.4, 6];
          a.cool = gap[0] + rand() * (gap[1] - gap[0]);
        }
      }
    }
    for (let m = 0; m < group.children.length; m++) {
      const mesh = group.children[m];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.faunaState.needsUpdate = true;
      // InstancedMesh caches its world-space sphere; invalidate each moving pose.
      // Geometry's sphere already encloses every articulated local pose.
      mesh.computeBoundingSphere();
    }
  }

  return {
    group: group,
    update: update,
    react: react,
    count: animals.length,
    animals: animals
  };
}
