import * as THREE from 'three';
import { createCommunityActors } from './community-actors.js';
import { habitatSurface } from '../world/habitat-details.js';
import { livingStep, sightClear, capsuleProfile, capsuleGap } from './living-behavior.js';

const TAU = Math.PI * 2;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function smooth01(t) {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * clamp(k, 0, 1);
}

function yawTo(ax, az, bx, bz) {
  return Math.atan2(bx - ax, bz - az);
}

export function createNeighborTheaters(options = {}) {
  const {
    world = {},
    field = null,
    village = null,
    props = null,
    qinHanHomestead = null,
    blockers = []
  } = options;

  const group = new THREE.Group();
  group.name = 'neighbor-theaters';

  const surface = (x, z) => (typeof field?.walkSurface === 'function' ? field.walkSurface(x, z) : (field?.sample ? habitatSurface(field, x, z) : 0));
  const waterLevel = Number.isFinite(world.terrain?.waterLevel) ? world.terrain.waterLevel : -1.2;
  const pond = world.terrain?.pond || null;

  function isDryClear(x, z, pad = 0.28) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const half = (field?.half ?? 220) - 1.0;
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    const gy = surface(x, z);
    if (!Number.isFinite(gy) || gy < waterLevel + 0.06) return false;
    if (pond && Number.isFinite(pond.waterY)) {
      const pr = (pond.radius ?? pond.waterRadius ?? 9) + 0.45;
      if (Math.hypot(x - pond.x, z - pond.z) < pr && gy < pond.waterY + 0.06) return false;
    }
    if (field?.slope && field.slope(x, z) > 0.78) return false;
    if (!sightClear(x, z, x, z, blockers, pad)) return false;
    return true;
  }

  function pickRingSpot(cx, cz, radii, angles, pad = 0.28) {
    for (const r of radii) {
      for (const a of angles) {
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (isDryClear(x, z, pad)) return { x, y: surface(x, z), z, ang: a };
      }
    }
    return { x: cx + 1.25, y: surface(cx + 1.25, cz), z: cz, ang: 0 };
  }

  const houses = village?.houseInfo || [];
  const marks = props?.marks || [];
  const wellMark = marks.find(m => m.kind === 'well') || (houses[0]
    ? { x: houses[0].doorX + 3.2, z: houses[0].doorZ + 2.4, r: 0.75 }
    : { x: 26, z: -116, r: 0.75 });
  const wellGy = surface(wellMark.x, wellMark.z);

  const ringAngles = Array.from({ length: 16 }, (_, k) => (k / 16) * TAU + 0.35);
  const wellDrawSpot = pickRingSpot(wellMark.x, wellMark.z, [1.18, 1.34, 1.52, 1.72], ringAngles, 0.24);
  const peerAngles = Array.from({ length: 16 }, (_, k) => wellDrawSpot.ang + 1.35 + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 0.26);
  const wellPeerSpot = pickRingSpot(wellMark.x, wellMark.z, [1.45, 1.68, 1.95], peerAngles, 0.24);

  // Daytime pasture watch spot near the pond bank
  const initBuf = qinHanHomestead?.getBuffaloState?.() || qinHanHomestead?.layout?.buffalo || null;
  const pastureRefX = initBuf?.bankX ?? (pond ? pond.x - (pond.radius || 9) - 2.6 : wellPeerSpot.x + 4.0);
  const pastureRefZ = initBuf?.bankZ ?? (pond ? pond.z + 2.4 : wellPeerSpot.z + 3.0);
  const pastureSpot = pickRingSpot(pastureRefX, pastureRefZ, [1.2, 2.0, 2.8, 3.6], ringAngles, 0.26);

  // Pick a shared porch eave centrally between the well and the pond pasture for neighborly rain conversations (檐下避雨交谈)
  let sharedHouse = houses[0] || null;
  let bestHouseDist = Infinity;
  for (const h of houses) {
    const d = Math.hypot(h.doorX - wellMark.x, h.doorZ - wellMark.z) +
              Math.hypot(h.doorX - pastureSpot.x, h.doorZ - pastureSpot.z);
    if (d < bestHouseDist) {
      bestHouseDist = d;
      sharedHouse = h;
    }
  }

  let eaveSpotA = { x: wellDrawSpot.x, y: wellDrawSpot.y, z: wellDrawSpot.z, outYaw: 0 };
  let eaveSpotB = { x: wellPeerSpot.x, y: wellPeerSpot.y, z: wellPeerSpot.z, outYaw: Math.PI };
  if (sharedHouse) {
    const tx = Math.cos(sharedHouse.rot);
    const tz = -Math.sin(sharedHouse.rot);
    const outYaw = yawTo(sharedHouse.x, sharedHouse.z, sharedHouse.doorX, sharedHouse.doorZ);
    const candAx = sharedHouse.doorX - tx * 0.46;
    const candAz = sharedHouse.doorZ - tz * 0.46;
    const candBx = sharedHouse.doorX + tx * 0.46;
    const candBz = sharedHouse.doorZ + tz * 0.46;
    const ax = isDryClear(candAx, candAz, 0.14) ? candAx : sharedHouse.doorX - tx * 0.22;
    const az = isDryClear(candAx, candAz, 0.14) ? candAz : sharedHouse.doorZ - tz * 0.22;
    const bx = isDryClear(candBx, candBz, 0.14) ? candBx : sharedHouse.doorX + tx * 0.22;
    const bz = isDryClear(candBx, candBz, 0.14) ? candBz : sharedHouse.doorZ + tz * 0.22;
    eaveSpotA = { x: ax, y: surface(ax, az), z: az, outYaw };
    eaveSpotB = { x: bx, y: surface(bx, bz), z: bz, outYaw };
  }

  const homeHouseA = sharedHouse || houses[0] || null;
  const homeHouseB = houses.length > 2 ? houses[2] : (houses[1] || homeHouseA);
  const nightSpotA = homeHouseA
    ? {
        x: homeHouseA.doorX - Math.cos(homeHouseA.rot) * 0.36,
        y: surface(homeHouseA.doorX, homeHouseA.doorZ),
        z: homeHouseA.doorZ + Math.sin(homeHouseA.rot) * 0.36,
        yaw: yawTo(homeHouseA.x, homeHouseA.z, homeHouseA.doorX, homeHouseA.doorZ)
      }
    : { ...eaveSpotA, yaw: eaveSpotA.outYaw };
  const nightSpotB = homeHouseB
    ? {
        x: homeHouseB.doorX + Math.cos(homeHouseB.rot) * 0.36,
        y: surface(homeHouseB.doorX, homeHouseB.doorZ),
        z: homeHouseB.doorZ - Math.sin(homeHouseB.rot) * 0.36,
        yaw: yawTo(homeHouseB.x, homeHouseB.z, homeHouseB.doorX, homeHouseB.doorZ)
      }
    : { ...eaveSpotB, yaw: eaveSpotB.outYaw };

  const actorGroup = new THREE.Group();
  actorGroup.name = 'neighbor-theater-actors';
  group.add(actorGroup);
  const rig = createCommunityActors(actorGroup, 2);

  // Single 6-slot InstancedMesh for wooden well bucket + hoop + water glint + rope + resting pail + herding bamboo switch
  const PROP_COUNT = 6;
  const propGeo = new THREE.CylinderGeometry(0.5, 0.44, 1, 7, 1);
  const propMat = new THREE.MeshLambertMaterial({ color: '#FFFFFF', flatShading: true });
  const propMesh = new THREE.InstancedMesh(propGeo, propMat, PROP_COUNT);
  propMesh.name = 'neighbor-theater-props';
  propMesh.userData.dynamic = true;
  propMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  propMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(wellMark.x, wellGy + 1, wellMark.z), 48);
  propMesh.frustumCulled = true;
  group.add(propMesh);

  const tmpPos = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  const tmpColor = new THREE.Color();

  const PROP_COLORS = ['#8E6C46', '#58442D', '#7FA8A4', '#B9A172', '#8A6944', '#7D9457'];
  for (let i = 0; i < PROP_COUNT; i++) {
    propMesh.setColorAt(i, tmpColor.set(PROP_COLORS[i]));
    tmpScale.set(0, 0, 0);
    tmpPos.set(0, -50, 0);
    tmpQuat.identity();
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    propMesh.setMatrixAt(i, tmpMat);
  }
  if (propMesh.instanceColor) propMesh.instanceColor.needsUpdate = true;

  function writeProp(idx, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    tmpPos.set(x, y, z);
    tmpEuler.set(rx, ry, rz, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpScale.set(sx, sy, sz);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    propMesh.setMatrixAt(idx, tmpMat);
  }

  function hideProp(idx) {
    writeProp(idx, 0, -50, 0, 0, 0, 0);
  }

  const actors = [
    {
      index: 0,
      id: 'nt-well-drawer',
      key: 'c_nt-well-drawer',
      role: 'well_drawer',
      voiceRole: 'basket',
      kind: 'villager',
      female: true,
      child: false,
      s: 0.98,
      x: wellDrawSpot.x,
      y: wellDrawSpot.y,
      z: wellDrawSpot.z,
      yaw: yawTo(wellDrawSpot.x, wellDrawSpot.z, wellMark.x, wellMark.z),
      mode: 'work',
      activity: 'well-draw',
      theaterState: 'morning-well',
      rainRest: 0,
      nightRest: false,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0
    },
    {
      index: 1,
      id: 'nt-herder',
      key: 'c_nt-herder',
      role: 'herder',
      voiceRole: 'worker',
      kind: 'villager',
      female: false,
      child: false,
      s: 1.0,
      x: wellPeerSpot.x,
      y: wellPeerSpot.y,
      z: wellPeerSpot.z,
      yaw: yawTo(wellPeerSpot.x, wellPeerSpot.z, wellDrawSpot.x, wellDrawSpot.z),
      mode: 'work',
      activity: 'herding',
      theaterState: 'morning-well',
      rainRest: 0,
      nightRest: false,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0
    }
  ];

  let simTime = 0;
  let theaterState = 'day-work';
  let wellBucketHeight = 0;
  let disposed = false;

  function readEnv(sky) {
    const app = sky?.getAppearance?.();
    const rain = clamp(Number(sky?.rainIntensity ?? app?.rainIntensity ?? 0) || 0, 0, 1);
    const weatherId = sky?.weatherId ?? app?.weatherId ?? (rain > 0.22 ? 'rain' : 'clear');
    const timeId = sky?.timeId ?? app?.timeId ?? 'day';
    const isRain = rain > 0.22 || weatherId === 'rain';
    return { rain, weatherId, timeId, isRain };
  }

  let livingObstacles = options.livingObstacles || null;
  const _ntCap = { rear: 0, front: 0, radius: 0.3, mass: 1 };
  const _ntGap = { dist: 0, minDist: 0, gap: 0, overlap: 0, nx: 0, nz: 1, s: 0, t: 0 };

  function minEntityGapAt(actor, tx, tz) {
    let minGap = 99;
    const rA = 0.29 * (actor.s || 1);
    const qhAnimals = qinHanHomestead?.getAnimalObstacles?.();
    if (qhAnimals) {
      for (let i = 0; i < qhAnimals.length; i++) {
        const b = qhAnimals[i];
        if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
        if (Math.abs(b.x - tx) > 3.6 || Math.abs(b.z - tz) > 3.6) continue;
        capsuleGap(tx, tz, 0, 0, 0, rA, b.x, b.z, b.yaw || 0, b.rear || 0, b.front || 0, b.radius || 0.35, _ntGap);
        if (_ntGap.gap < minGap) minGap = _ntGap.gap;
      }
    }
    if (livingObstacles) {
      const animals = livingObstacles.animals;
      if (animals) {
        for (let i = 0; i < animals.length; i++) {
          const b = animals[i];
          if (!b || b.kind === 'bird' || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
          if (Math.abs(b.x - tx) > 3.6 || Math.abs(b.z - tz) > 3.6) continue;
          const rB = b.capRadius !== undefined ? b.capRadius : capsuleProfile(b.kind, b.scale, _ntCap).radius;
          const rearB = b.capRear !== undefined ? b.capRear : _ntCap.rear;
          const frontB = b.capFront !== undefined ? b.capFront : _ntCap.front;
          capsuleGap(tx, tz, 0, 0, 0, rA, b.x, b.z, b.yaw || 0, rearB, frontB, rB, _ntGap);
          if (_ntGap.gap < minGap) minGap = _ntGap.gap;
        }
      }
      const people = livingObstacles.people;
      if (people) {
        for (let i = 0; i < people.length; i++) {
          const p = people[i];
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
          if (Math.abs(p.x - tx) > 2.2 || Math.abs(p.z - tz) > 2.2) continue;
          const rP = 0.28 * (p.s || 1);
          capsuleGap(tx, tz, 0, 0, 0, rA, p.x, p.z, 0, 0, 0, rP, _ntGap);
          if (_ntGap.gap < minGap) minGap = _ntGap.gap;
        }
      }
    }
    for (let i = 0; i < actors.length; i++) {
      const peer = actors[i];
      if (!peer || peer === actor || !Number.isFinite(peer.x) || !Number.isFinite(peer.z)) continue;
      const d = Math.hypot(peer.x - tx, peer.z - tz) - 0.54;
      if (d < minGap) minGap = d;
    }
    return minGap;
  }

  function moveToward(actor, gx, gz, maxSpeed, step) {
    const dx = gx - actor.x;
    const dz = gz - actor.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 0.04 || step <= 0) {
      if (step <= 0 && simTime === 0) {
        actor.x = gx;
        actor.z = gz;
        actor.y = surface(gx, gz);
      } else if (dist <= 0.04) {
        actor.x = gx;
        actor.z = gz;
        actor.y = surface(gx, gz);
      }
      return { moving: false, travelYaw: actor.yaw };
    }
    const move = Math.min(dist, maxSpeed * step);
    const ux = dx / dist;
    const uz = dz / dist;
    let nx = actor.x + ux * move;
    let nz = actor.z + uz * move;
    let chosenYaw = Math.atan2(dx, dz);
    const curGap = minEntityGapAt(actor, actor.x, actor.z);
    const nextGap = minEntityGapAt(actor, nx, nz);
    const entityCrowded = nextGap < 0.26 && nextGap < curGap - 1e-4;
    // Steer smoothly around house walls, pond edges, cattle or villagers when walking across the village
    if ((dist > 0.55 && !isDryClear(nx, nz, 0.14)) || entityCrowded) {
      let bestScore = -999;
      let found = false;
      for (const angOff of [0.48, -0.48, 0.92, -0.92, 1.32, -1.32]) {
        const ca = Math.cos(angOff), sa = Math.sin(angOff);
        const rx = ux * ca - uz * sa;
        const rz = ux * sa + uz * ca;
        const cx = actor.x + rx * move;
        const cz = actor.z + rz * move;
        if (!isDryClear(cx, cz, 0.14)) continue;
        const cGap = minEntityGapAt(actor, cx, cz);
        if (cGap < 0.02 && cGap < curGap) continue;
        const score = Math.min(0.6, cGap) * 2.2 + ca * 0.55;
        if (score > bestScore) {
          bestScore = score;
          nx = cx;
          nz = cz;
          chosenYaw = Math.atan2(rx, rz);
          found = true;
          if (cGap >= 0.28 && Math.abs(angOff) < 0.6) break;
        }
      }
      if (!found && nextGap < 0.01 && nextGap < curGap) {
        nx = actor.x;
        nz = actor.z;
      }
    }
    // Soft separation if cattle walked directly into a transiting/herding actor
    if (dist > 0.06) {
      const rA = 0.30 * (actor.s || 1);
      const qhAnimals = qinHanHomestead?.getAnimalObstacles?.();
      for (let src = 0; src < 2; src++) {
        const arr = src === 0 ? qhAnimals : livingObstacles?.animals;
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i];
          if (!b || b.kind === 'bird' || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
          if (Math.abs(b.x - nx) > 3.2 || Math.abs(b.z - nz) > 3.2) continue;
          const rB = b.capRadius !== undefined ? b.capRadius : (b.radius !== undefined ? b.radius : capsuleProfile(b.kind, b.scale, _ntCap).radius);
          const rearB = b.capRear !== undefined ? b.capRear : (b.rear || 0);
          const frontB = b.capFront !== undefined ? b.capFront : (b.front || 0);
          capsuleGap(nx, nz, 0, 0, 0, rA + 0.02, b.x, b.z, b.yaw || 0, rearB, frontB, rB, _ntGap);
          if (_ntGap.overlap > 1e-4) {
            const sx = nx + _ntGap.nx * _ntGap.overlap;
            const sz = nz + _ntGap.nz * _ntGap.overlap;
            if (isDryClear(sx, sz, 0.14)) { nx = sx; nz = sz; }
          }
        }
      }
    }
    const moved = Math.hypot(nx - actor.x, nz - actor.z) > 1e-4;
    actor.x = nx;
    actor.z = nz;
    actor.y = surface(nx, nz);
    return { moving: moved, travelYaw: chosenYaw };
  }

  function resolveHerderDuskSpot() {
    const buf = qinHanHomestead?.getBuffaloState?.();
    if (!buf || !Number.isFinite(buf.x) || !Number.isFinite(buf.z)) {
      return {
        x: pastureSpot.x,
        z: pastureSpot.z,
        yaw: yawTo(pastureSpot.x, pastureSpot.z, pond ? pond.x : wellMark.x, pond ? pond.z : wellMark.z),
        bufX: pond ? pond.x : wellMark.x,
        bufZ: pond ? pond.z : wellMark.z
      };
    }
    const byaw = buf.yaw || 0;
    const rightX = Math.cos(byaw);
    const rightZ = -Math.sin(byaw);
    const backX = -Math.sin(byaw);
    const backZ = -Math.cos(byaw);
    let fallback = null;
    for (const side of [1, -1]) {
      for (const dist of [1.35, 1.75, 2.2]) {
        const cx = buf.x + rightX * side * dist + backX * 0.45;
        const cz = buf.z + rightZ * side * dist + backZ * 0.45;
        if (isDryClear(cx, cz, 0.22)) {
          if (!fallback) fallback = { x: cx, z: cz, yaw: byaw, bufX: buf.x, bufZ: buf.z };
          if (minEntityGapAt(actors[1], cx, cz) >= 0.15) {
            return { x: cx, z: cz, yaw: byaw, bufX: buf.x, bufZ: buf.z };
          }
        }
      }
    }
    if (fallback) return fallback;
    return {
      x: pastureSpot.x,
      z: pastureSpot.z,
      yaw: yawTo(pastureSpot.x, pastureSpot.z, buf.x, buf.z),
      bufX: buf.x,
      bufZ: buf.z
    };
  }

  function animate(step, sky, playerState) {
    const env = readEnv(sky);
    if (env.timeId === 'night') theaterState = 'night-home';
    else if (env.isRain) theaterState = 'rain-eave-chat';
    else if (env.timeId === 'dawn') theaterState = 'morning-well';
    else if (env.timeId === 'dusk') theaterState = 'dusk-herd';
    else theaterState = 'day-work';

    const aWell = actors[0];
    const aHerd = actors[1];
    for (const a of actors) {
      a.theaterState = theaterState;
      a.rainRest = theaterState === 'rain-eave-chat' ? 1 : 0;
      a.nightRest = theaterState === 'night-home';
    }

    // 1. Target spots per theater mode
    let goalA, goalB;
    if (theaterState === 'night-home') {
      goalA = { x: nightSpotA.x, z: nightSpotA.z, yaw: nightSpotA.yaw };
      goalB = { x: nightSpotB.x, z: nightSpotB.z, yaw: nightSpotB.yaw };
    } else if (theaterState === 'rain-eave-chat') {
      goalA = {
        x: eaveSpotA.x,
        z: eaveSpotA.z,
        yaw: angleLerp(eaveSpotA.outYaw, yawTo(eaveSpotA.x, eaveSpotA.z, eaveSpotB.x, eaveSpotB.z), 0.76)
      };
      goalB = {
        x: eaveSpotB.x,
        z: eaveSpotB.z,
        yaw: angleLerp(eaveSpotB.outYaw, yawTo(eaveSpotB.x, eaveSpotB.z, eaveSpotA.x, eaveSpotA.z), 0.76)
      };
    } else if (theaterState === 'morning-well') {
      goalA = {
        x: wellDrawSpot.x,
        z: wellDrawSpot.z,
        yaw: yawTo(wellDrawSpot.x, wellDrawSpot.z, wellMark.x, wellMark.z)
      };
      goalB = {
        x: wellPeerSpot.x,
        z: wellPeerSpot.z,
        yaw: yawTo(wellPeerSpot.x, wellPeerSpot.z, wellDrawSpot.x, wellDrawSpot.z)
      };
    } else if (theaterState === 'dusk-herd') {
      goalA = {
        x: lerp(wellDrawSpot.x, nightSpotA.x, 0.72),
        z: lerp(wellDrawSpot.z, nightSpotA.z, 0.72),
        yaw: yawTo(wellDrawSpot.x, wellDrawSpot.z, nightSpotA.x, nightSpotA.z)
      };
      if (!isDryClear(goalA.x, goalA.z, 0.2)) {
        goalA.x = nightSpotA.x;
        goalA.z = nightSpotA.z;
        goalA.yaw = nightSpotA.yaw;
      }
      const herdGoal = resolveHerderDuskSpot();
      goalB = { x: herdGoal.x, z: herdGoal.z, yaw: herdGoal.yaw, bufX: herdGoal.bufX, bufZ: herdGoal.bufZ };
    } else {
      // Clear daytime: well-drawer tends well; herder watches pond pasture
      goalA = {
        x: wellDrawSpot.x,
        z: wellDrawSpot.z,
        yaw: yawTo(wellDrawSpot.x, wellDrawSpot.z, wellMark.x, wellMark.z)
      };
      const buf = qinHanHomestead?.getBuffaloState?.();
      goalB = {
        x: pastureSpot.x,
        z: pastureSpot.z,
        yaw: buf
          ? yawTo(pastureSpot.x, pastureSpot.z, buf.x, buf.z)
          : yawTo(pastureSpot.x, pastureSpot.z, pond ? pond.x : wellMark.x, pond ? pond.z : wellMark.z)
      };
    }

    // Smooth root travel (brisk rain-hurry trot when scurrying to shelter, paused while greeting player)
    const speed = theaterState === 'rain-eave-chat' ? 3.2 : 1.35;
    const mvA = aWell.greetUntil > simTime ? { moving: false, travelYaw: aWell.yaw } : moveToward(aWell, goalA.x, goalA.z, speed, step);
    const mvB = aHerd.greetUntil > simTime ? { moving: false, travelYaw: aHerd.yaw } : moveToward(aHerd, goalB.x, goalB.z, speed, step);

    for (let i = 0; i < 6; i++) hideProp(i);
    wellBucketHeight = 0;

    rig.begin();

    // --- Actor 0: Well-Drawing Villager (汲水妇) ---
    {
      let targetYaw = mvA.moving ? mvA.travelYaw : goalA.yaw;
      let lean = 0, crouch = 0, nod = 0, headTurn = 0, walk = 0;
      let left = [-0.22, 0.90, 0.20];
      let right = [0.22, 0.90, 0.20];
      aWell.mode = 'work';
      aWell.activity = mvA.moving ? 'travel' : 'well-draw';

      if (aWell.greetUntil > simTime) {
        targetYaw = yawTo(aWell.x, aWell.z, aWell.greetX, aWell.greetZ);
        const rem = aWell.greetUntil - simTime;
        const bowW = Math.min(1, rem * 1.8) * Math.min(1, (3.5 - Math.min(3.5, rem) + 0.25) * 3.0);
        lean = 0.20 * bowW;
        nod = 0.14 * bowW;
        left = [-0.045, 0.98 - bowW * 0.03, 0.33];
        right = [0.045, 0.965 - bowW * 0.03, 0.31];
        aWell.activity = 'look';
      } else if (mvA.moving) {
        walk = Math.sin(simTime * 5.6);
        lean = 0.06;
        left = [-0.22, 0.88 - walk * 0.06, 0.18 - walk * 0.12];
        right = [0.24, 0.86, 0.24];
      } else if (theaterState === 'night-home') {
        crouch = 0.58;
        lean = 0.08;
        nod = 0.14 + Math.sin(simTime * 0.75) * 0.03;
        left = [-0.18, 0.58, 0.22];
        right = [0.18, 0.58, 0.22];
        aWell.mode = 'rest';
        aWell.activity = 'rest';
      } else if (theaterState === 'rain-eave-chat') {
        const turnA = Math.floor(simTime / 3.4) % 2 === 0;
        const w = simTime * 2.2;
        lean = 0.05;
        nod = turnA ? Math.sin(w * 0.9) * 0.05 : -0.05 + Math.max(0, Math.sin(w * 1.1)) * 0.07;
        headTurn = Math.sin(simTime * 0.95) * 0.14;
        left = [-0.18, 0.90, 0.24];
        right = turnA
          ? [0.18, 1.08 + Math.sin(w) * 0.11, 0.34]
          : [0.20, 0.88 + Math.sin(w * 0.6) * 0.04, 0.22];
        aWell.activity = turnA ? 'talk' : 'listen';
      } else if (theaterState === 'morning-well' || theaterState === 'day-work') {
        // 11s finite water-drawing cycle: lower -> hand-over-hand haul -> brim steady -> morning neighbor greeting
        const cyc = simTime % 11.0;
        const beamY = wellGy + 1.42;
        let bucketY = wellGy + 0.24;
        if (cyc < 2.5) {
          const u = smooth01(cyc / 2.5);
          bucketY = lerp(wellGy + 0.86, wellGy + 0.20, u);
          lean = lerp(0.14, 0.28, u);
          crouch = lerp(0.05, 0.18, u);
          nod = 0.16;
          left = [-0.08, lerp(1.06, 0.82, u), 0.42];
          right = [0.08, lerp(0.96, 0.78, u), 0.40];
        } else if (cyc < 6.4) {
          const u = (cyc - 2.5) / 3.9;
          const e = smooth01(u);
          bucketY = lerp(wellGy + 0.20, wellGy + 0.92, e);
          const pull = Math.sin(u * Math.PI * 5.0);
          lean = 0.22 - e * 0.08 + Math.abs(pull) * 0.04;
          crouch = 0.14 * (1 - e * 0.6);
          nod = 0.12 - e * 0.06;
          left = [-0.06, 0.96 + pull * 0.14, 0.38 - pull * 0.04];
          right = [0.06, 0.96 - pull * 0.14, 0.38 + pull * 0.04];
        } else if (cyc < 8.6) {
          const u = smooth01((cyc - 6.4) / 2.2);
          bucketY = wellGy + 0.92 - u * 0.04;
          lean = 0.12;
          nod = 0.08;
          left = [-0.12, 0.95, 0.36];
          right = [0.14, 1.02 + Math.sin(u * Math.PI) * 0.08, 0.34];
        } else {
          // Morning greeting bow toward neighbor at dawn, or calm wipe-brow rest by day
          bucketY = wellGy + 0.56;
          const u = (cyc - 8.6) / 2.4;
          const bow = Math.sin(u * Math.PI);
          if (theaterState === 'morning-well' && !mvB.moving) {
            targetYaw = yawTo(aWell.x, aWell.z, aHerd.x, aHerd.z);
            lean = 0.18 * bow;
            nod = 0.12 * bow;
            left = [-0.05, 0.98, 0.32];
            right = [0.05, 0.96, 0.30];
            aWell.activity = 'talk';
          } else {
            lean = 0.04;
            headTurn = Math.sin(u * Math.PI * 2) * 0.20;
            left = [-0.20, 0.88, 0.22];
            right = [0.18, 1.14 * bow + 0.88 * (1 - bow), 0.26];
          }
        }
        wellBucketHeight = bucketY - wellGy;
        const ropeLen = Math.max(0.12, beamY - (bucketY + 0.13));
        writeProp(0, wellMark.x, bucketY, wellMark.z, 0.28, 0.26, 0.28, 0, simTime * 0.35, 0);
        writeProp(1, wellMark.x, bucketY + 0.06, wellMark.z, 0.295, 0.036, 0.295, 0, simTime * 0.35, 0);
        if (cyc >= 3.2) {
          writeProp(2, wellMark.x, bucketY + 0.115, wellMark.z, 0.24, 0.018, 0.24, 0, -simTime * 0.5, 0);
        }
        writeProp(3, wellMark.x, bucketY + 0.13 + ropeLen * 0.5, wellMark.z, 0.024, ropeLen, 0.024);
      } else {
        // Dusk homeward pause near porch with water pail
        lean = 0.05;
        headTurn = Math.sin(simTime * 0.7) * 0.22;
        left = [-0.20, 0.88, 0.22];
        right = [0.22, 0.86, 0.24];
      }

      aWell.yaw = step > 0 ? angleLerp(aWell.yaw, targetYaw, Math.min(1, step * 5.2)) : targetYaw;
      rig.actor(aWell.x, aWell.y, aWell.z, aWell.yaw, aWell.s);
      const handsA = rig.human(aWell, { lean, crouch, nod, headTurn, left, right, walk });
      if (theaterState === 'dusk-herd' || mvA.moving) {
        writeProp(4, handsA.right.x, handsA.right.y - 0.18, handsA.right.z, 0.25, 0.23, 0.25, 0, aWell.yaw, 0);
      }
    }

    // --- Actor 1: Village Herder (牧牛邻人) ---
    {
      let targetYaw = mvB.moving ? mvB.travelYaw : goalB.yaw;
      let lean = 0, crouch = 0, nod = 0, headTurn = 0, walk = 0;
      let left = [-0.24, 0.88, 0.18];
      let right = [0.24, 0.90, 0.22];
      let carrySwitch = false;
      aHerd.mode = 'work';
      aHerd.activity = mvB.moving ? 'travel' : 'herding';

      if (aHerd.greetUntil > simTime) {
        targetYaw = yawTo(aHerd.x, aHerd.z, aHerd.greetX, aHerd.greetZ);
        const rem = aHerd.greetUntil - simTime;
        const bowW = Math.min(1, rem * 1.8) * Math.min(1, (3.5 - Math.min(3.5, rem) + 0.25) * 3.0);
        lean = 0.22 * bowW;
        nod = 0.14 * bowW;
        left = [-0.05, 0.99 - bowW * 0.03, 0.33];
        right = [0.05, 0.97 - bowW * 0.03, 0.31];
        aHerd.activity = 'look';
      } else if (mvB.moving) {
        walk = Math.sin(simTime * 5.2 + 0.8);
        lean = 0.06;
        left = [-0.24, 0.88 + walk * 0.06, 0.18 + walk * 0.12];
        right = [0.26, 0.92, 0.28];
        carrySwitch = theaterState === 'dusk-herd' || theaterState === 'day-work';
      } else if (theaterState === 'night-home') {
        crouch = 0.56;
        lean = 0.08;
        nod = 0.15 + Math.sin(simTime * 0.7 + 1.2) * 0.03;
        left = [-0.20, 0.58, 0.22];
        right = [0.20, 0.58, 0.22];
        aHerd.mode = 'rest';
        aHerd.activity = 'rest';
      } else if (theaterState === 'rain-eave-chat') {
        const turnB = Math.floor(simTime / 3.4) % 2 === 1;
        const w = simTime * 2.2 + 1.1;
        lean = 0.05;
        nod = turnB ? Math.sin(w * 0.9) * 0.05 : -0.07 + Math.max(0, Math.sin(w * 1.2)) * 0.08;
        headTurn = Math.sin(simTime * 0.88 + 0.9) * 0.16;
        left = [-0.20, 0.88, 0.22];
        right = turnB
          ? [0.20, 1.12 + Math.sin(w) * 0.12, 0.34]
          : [0.22, 0.90 + Math.sin(w * 0.5) * 0.04, 0.22];
        aHerd.activity = turnB ? 'talk' : 'listen';
      } else if (theaterState === 'morning-well') {
        const cyc = simTime % 11.0;
        carrySwitch = true;
        if (cyc >= 8.4) {
          const bow = Math.sin(((cyc - 8.4) / 2.6) * Math.PI);
          lean = 0.18 * bow;
          nod = 0.12 * bow;
          left = [-0.05, 0.98, 0.32];
          right = [0.06, 0.96, 0.30];
          aHerd.activity = 'talk';
        } else {
          lean = 0.04;
          nod = Math.sin(simTime * 1.3) * 0.04;
          headTurn = Math.sin(simTime * 0.75) * 0.15;
          left = [-0.22, 0.90, 0.22];
          right = [0.26, 0.98 + Math.sin(simTime * 1.8) * 0.06, 0.30];
          aHerd.activity = 'listen';
        }
      } else if (theaterState === 'dusk-herd') {
        // 暮归牧牛：执青竹梢护送老水牛归村，缓步相随并频频侧首看牛
        carrySwitch = true;
        const gentleWalk = Math.sin(simTime * 3.2) * 0.45;
        walk = gentleWalk;
        lean = 0.06;
        const toBufYaw = goalB.bufX !== undefined ? yawTo(aHerd.x, aHerd.z, goalB.bufX, goalB.bufZ) : targetYaw;
        let rel = toBufYaw - targetYaw;
        while (rel > Math.PI) rel -= TAU;
        while (rel < -Math.PI) rel += TAU;
        headTurn = clamp(rel, -0.45, 0.45) * 0.65 + Math.sin(simTime * 0.9) * 0.10;
        nod = Math.sin(simTime * 1.6) * 0.04;
        left = [-0.22, 0.88, 0.20];
        right = [0.28, 1.04 + Math.sin(simTime * 2.1) * 0.09, 0.34];
      } else {
        // Daytime pasture watch
        carrySwitch = true;
        lean = 0.04;
        headTurn = Math.sin(simTime * 0.55) * 0.28;
        nod = -0.04 + Math.sin(simTime * 0.9) * 0.04;
        left = [-0.22, 0.92, 0.22];
        right = [0.28, 0.96 + Math.sin(simTime * 1.4) * 0.05, 0.28];
      }

      aHerd.yaw = step > 0 ? angleLerp(aHerd.yaw, targetYaw, Math.min(1, step * 5.2)) : targetYaw;
      rig.actor(aHerd.x, aHerd.y, aHerd.z, aHerd.yaw, aHerd.s);
      const handsB = rig.human(aHerd, { lean, crouch, nod, headTurn, left, right, walk });
      if (carrySwitch) {
        const swYaw = aHerd.yaw + 0.18;
        const fwdX = Math.sin(swYaw) * 0.34;
        const fwdZ = Math.cos(swYaw) * 0.34;
        writeProp(
          5,
          handsB.right.x + fwdX,
          handsB.right.y + 0.22,
          handsB.right.z + fwdZ,
          0.022,
          0.92,
          0.022,
          0.62,
          swYaw,
          0
        );
      }
    }

    rig.finish();

    // Update propMesh bounding sphere around well & actors
    const cx = (wellMark.x + aWell.x + aHerd.x) / 3;
    const cz = (wellMark.z + aWell.z + aHerd.z) / 3;
    const rad = Math.max(
      Math.hypot(wellMark.x - cx, wellMark.z - cz),
      Math.hypot(aWell.x - cx, aWell.z - cz),
      Math.hypot(aHerd.x - cx, aHerd.z - cz)
    ) + 4.0;
    propMesh.boundingSphere.center.set(cx, wellGy + 1.0, cz);
    propMesh.boundingSphere.radius = rad;
    propMesh.instanceMatrix.needsUpdate = true;
  }

  animate(0, null, null);

  function getInteractables() {
    return actors;
  }

  function greet(id, px, pz, dur = 3.5) {
    for (const a of actors) {
      if (a.id === id) {
        a.greetUntil = simTime + dur;
        a.greetX = px;
        a.greetZ = pz;
      }
    }
  }

  function update(dt, elapsed, sky, playerState) {
    if (disposed) return;
    const step = livingStep(dt);
    if (step <= 0) return;
    simTime += step;
    animate(step, sky, playerState);
  }

  function getStats() {
    const rigStats = rig.stats();
    return {
      built: true,
      theaterState,
      wellBucketHeight,
      actors: actors.map(a => ({
        id: a.id,
        role: a.role,
        x: a.x,
        y: a.y,
        z: a.z,
        activity: a.activity,
        rainRest: a.rainRest,
        nightRest: a.nightRest
      })),
      wellSpot: { x: wellMark.x, y: wellGy, z: wellMark.z },
      eavePairDistance: Math.hypot(eaveSpotA.x - eaveSpotB.x, eaveSpotA.z - eaveSpotB.z),
      drawCalls: rigStats.drawCalls + (propMesh.visible ? 1 : 0),
      triangles: rigStats.triangles + (propGeo.index ? propGeo.index.count / 3 : propGeo.attributes.position.count / 3) * PROP_COUNT,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    rig.dispose();
    propGeo.dispose();
    propMat.dispose();
    group.removeFromParent();
  }

  function setLivingObstacles(obs) {
    livingObstacles = obs || null;
  }

  return {
    group,
    getInteractables,
    setLivingObstacles,
    greet,
    update,
    getStats,
    dispose
  };
}
