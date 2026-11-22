import * as THREE from 'three';
import { createCommunityActors } from '../systems/community-actors.js';
import { livingStep, capsuleProfile, capsuleGap } from '../systems/living-behavior.js';
import { habitatSurface, habitatSiteSafe } from './habitat-details.js';
import { buildQinHanStatic } from './qin-han-props.js';
import {
  createBarredHenParts,
  createFluffyChickGeometry,
  createRoosterParts,
  createWaterBuffaloParts,
  createWhiteEgretParts,
  createYellowDogParts,
  createSwallowParts,
  createWaterStriderGeometry,
  createRigidBatchMesh
} from './qin-han-fauna-geometry.js';

const TAU = Math.PI * 2;
const unwrap = v => v?.layout || v || {};

const SLOT_COLORS = {
  gateWood: '#765C3B',
  gateFrame: '#624C30',
  trayBamboo: '#B8A05E',
  trayRim: '#8D7841',
  cropShoot: '#D8B872',
  cropJujube: '#8C3E2D',
  cropMillet: '#CFB965',
  indigoCloth: '#2E4C6D',
  hempCloth: '#CEC2A4',
  indigoDrop: '#24466B'
};

function readWeather(sky) {
  const app = sky?.getAppearance?.();
  const rain = Math.max(0, Math.min(1, Number(sky?.rainIntensity ?? app?.rainIntensity ?? 0) || 0));
  const wind = Math.max(0, Number(sky?.wind ?? app?.wind ?? 0) || 0);
  const windX = Number(sky?.windX ?? app?.windX ?? 0) || 0;
  const windZ = Number(sky?.windZ ?? app?.windZ ?? 0) || 0;
  const cloudCover = Number(sky?.cloudCover ?? app?.cloudCover ?? (rain > 0.1 ? 0.8 : 0.25)) || 0;
  const timeId = sky?.timeId ?? app?.timeId ?? 'day';
  const sunEl = sky?.sunElevation ?? app?.sunElevation;
  const isNight = timeId === 'night' || timeId === 'dusk' || (Number.isFinite(sunEl) && sunEl < 0.08);
  const isDeepNight = timeId === 'night' || (Number.isFinite(sunEl) && sunEl < -0.02);
  const isDusk = timeId === 'dusk';
  const storm = rain > 0.18 || (wind > 0.78 && cloudCover > 0.45);
  return { rain, wind, windX, windZ, cloudCover, timeId, isNight, isDeepNight, isDusk, storm };
}

function yawTo(ax, az, bx, bz) {
  return Math.atan2(bx - ax, bz - az);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export function createQinHanHomestead(options = {}) {
  const group = new THREE.Group();
  group.name = 'qin-han-homestead';

  const {
    world, field, village, props, leisureGrove, pondLife
  } = options;

  const builtStatic = buildQinHanStatic(options);
  group.add(builtStatic.mesh);

  const blockers = [...builtStatic.blockers];
  const targets = [...builtStatic.targets];
  const anchors = builtStatic.anchors;
  const surface = (x, z) => (typeof field?.walkSurface === 'function' ? field.walkSurface(x, z) : (field ? habitatSurface(field, x, z) : 0));

  // ============================================================================
  // 1. 村中四位新活劳动角色（织妇、老木匠、篾匠、瓜庐田夫）
  // ============================================================================
  const actorGroup = new THREE.Group();
  actorGroup.name = 'qin-han-actors';
  group.add(actorGroup);
  const actorRig = createCommunityActors(actorGroup, 4);

  const villagers = [];
  const registerVillager = (id, role, voiceRole, pos, facing, kind, activeFlag = true) => {
    if (!pos || ![pos[0], pos[2]].every(Number.isFinite)) return;
    villagers.push({
      index: villagers.length,
      id,
      key: 'c_' + id,
      role,
      voiceRole,
      x: pos[0],
      y: surface(pos[0], pos[2]),
      z: pos[2],
      facing,
      kind,
      female: id === 'qh-weaver',
      child: false,
      s: 1.0,
      greetUntil: 0,
      greetX: 0,
      greetZ: 0,
      active: activeFlag
    });
  };

  if (anchors.weaving) {
    registerVillager('qh-weaver', 'weaver', 'villager', anchors.weaving.workerPos, anchors.weaving.workerFacing, 'villager');
  }
  if (anchors.carpentry) {
    registerVillager('qh-carpenter', 'carpenter', 'elder', anchors.carpentry.carpenterPos, anchors.carpentry.carpenterFacing, 'elder');
    registerVillager('qh-bamboo', 'bamboo_artisan', 'villager', anchors.carpentry.bambooPos, anchors.carpentry.bambooFacing, 'villager');
  }
  if (anchors.fieldHut) {
    registerVillager('qh-hutfarmer', 'hut_farmer', 'elder', anchors.fieldHut.farmerPos, anchors.fieldHut.farmerFacing, 'elder');
  }

  // ============================================================================
  // 2. 动态晴雨道具合批（柴门荆扉 / 晴雨竹匾与靛青麻布滴水）
  // ============================================================================
  const DYN_COUNT = 24;
  const dynGeo = new THREE.BoxGeometry(1, 1, 1);
  const dynMat = new THREE.MeshLambertMaterial({ color: '#FFFFFF', flatShading: true });
  const dynMesh = new THREE.InstancedMesh(dynGeo, dynMat, DYN_COUNT);
  dynMesh.name = 'qin-han-dynamic';
  dynMesh.userData.dynamic = true;
  dynMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dynMesh.frustumCulled = false;
  dynMesh.castShadow = false;
  dynMesh.receiveShadow = true;
  group.add(dynMesh);

  const tmpColor = new THREE.Color();
  const tmpM = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();

  const zeroMatrix = () => {
    tmpPos.set(0, -50, 0);
    tmpQuat.identity();
    tmpScale.set(0, 0, 0);
    tmpM.compose(tmpPos, tmpQuat, tmpScale);
  };
  zeroMatrix();
  for (let i = 0; i < DYN_COUNT; i++) {
    dynMesh.setMatrixAt(i, tmpM);
    dynMesh.setColorAt(i, tmpColor.set('#888888'));
  }

  const setColor = (idx, hex) => {
    tmpColor.set(hex);
    dynMesh.setColorAt(idx, tmpColor);
  };

  // 水牛角与背鹭停栖池浅水选址
  const pond = world?.terrain?.pond;
  let buffaloSite = null;
  if (pond && village?.pond?.rim?.length) {
    const minRim = Math.min(...village.pond.rim);
    const placements = unwrap(pondLife).placements || [];
    for (const rFrac of [0.68, 0.58, 0.76]) {
      if (buffaloSite) break;
      for (const ang of [2.7, 3.3, 1.9, 4.1, 0.9, 5.2]) {
        const bx = pond.x + Math.cos(ang) * minRim * rFrac;
        const bz = pond.z + Math.sin(ang) * minRim * rFrac;
        const fy = surface(bx, bz);
        if (!Number.isFinite(fy)) continue;
        const depth = pond.waterY - fy;
        if (depth < 0.16 || depth > 0.78) continue;
        const clear = placements.every(p => Math.hypot(bx - p.x, bz - p.z) > (p.radius || 0.7) + 1.05);
        if (clear) {
          buffaloSite = { x: bx, y: pond.waterY, z: bz, yaw: ang + 1.6 };
          break;
        }
      }
    }
    if (!buffaloSite) buffaloSite = { x: pond.x - minRim * 0.42, y: pond.waterY, z: pond.z + minRim * 0.36, yaw: 0.8 };
  }
  const buffaloLive = buffaloSite
    ? {
        pondX: buffaloSite.x,
        pondY: buffaloSite.y,
        pondZ: buffaloSite.z,
        pondYaw: buffaloSite.yaw,
        bankX: buffaloSite.x,
        bankZ: buffaloSite.z,
        restX: buffaloSite.x,
        restZ: buffaloSite.z,
        x: buffaloSite.x,
        y: buffaloSite.y,
        z: buffaloSite.z,
        yaw: buffaloSite.yaw,
        mode: 'pond',
        routeU: 0
      }
    : null;
  if (buffaloSite && pond) {
    targets.push({
      id: 'wallowing-buffalo',
      x: buffaloSite.x,
      y: pond.waterY + 0.32,
      z: buffaloSite.z,
      range: 6.5,
      resolve: () => ({
        x: buffaloLive.x,
        y: buffaloLive.y + 0.32,
        z: buffaloLive.z
      })
    });
  }

  // ============================================================================
  // 2b. 雕刻顶点着色家禽与田园生灵网格（母鸡小鸡公鸡 / 水牛白鹭 / 柴门黄犬 / 双燕 / 水黾）
  // ============================================================================
  const poultryMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const henParts = createBarredHenParts();
  const henBatch = createRigidBatchMesh([henParts.bodyGeo, henParts.headGeo], poultryMat, 'qin-han-hen');
  henBatch.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.32, 0), 1.2);
  henBatch.mesh.frustumCulled = true;
  henBatch.mesh.visible = false;
  group.add(henBatch.mesh);

  const chickGeo = createFluffyChickGeometry();
  const chickMesh = new THREE.InstancedMesh(chickGeo, poultryMat, 4);
  chickMesh.name = 'qin-han-chicks';
  chickMesh.userData.dynamic = true;
  chickMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  chickMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.5);
  chickMesh.frustumCulled = true;
  chickMesh.castShadow = false;
  chickMesh.receiveShadow = true;
  chickMesh.visible = false;
  group.add(chickMesh);

  const roosterParts = createRoosterParts();
  const roosterBatch = createRigidBatchMesh(
    [roosterParts.bodyGeo, roosterParts.headGeo, roosterParts.wingLGeo, roosterParts.wingRGeo],
    poultryMat,
    'qin-han-rooster'
  );
  roosterBatch.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.42, 0), 1.3);
  roosterBatch.mesh.frustumCulled = true;
  roosterBatch.mesh.visible = false;
  group.add(roosterBatch.mesh);

  const buffaloParts = createWaterBuffaloParts();
  const egretParts = createWhiteEgretParts();
  const dogParts = createYellowDogParts();
  const swallowParts = createSwallowParts();
  const striderGeo = createWaterStriderGeometry();

  const faunaSlotGeos = [
    buffaloParts.bodyGeo,
    buffaloParts.headGeo,
    buffaloParts.earLGeo,
    buffaloParts.earRGeo,
    egretParts.bodyGeo,
    egretParts.headGeo,
    dogParts.bodyGeo,
    dogParts.headGeo,
    dogParts.earGeo,
    dogParts.earGeo,
    dogParts.tailGeo,
    dogParts.legGeo,
    dogParts.legGeo,
    dogParts.legGeo,
    dogParts.legGeo
  ];
  for (let i = 0; i < 6; i++) {
    faunaSlotGeos.push(swallowParts.bodyGeo, swallowParts.wingLGeo, swallowParts.wingRGeo);
  }
  for (let i = 0; i < 6; i++) {
    faunaSlotGeos.push(striderGeo);
  }
  const buffaloLegBaseSlot = faunaSlotGeos.length;
  for (let i = 0; i < 4; i++) {
    faunaSlotGeos.push(buffaloParts.legGeo);
  }
  const faunaBatch = createRigidBatchMesh(faunaSlotGeos, poultryMat, 'qin-han-sculpted-fauna');
  for (let s = 0; s < faunaSlotGeos.length; s++) faunaBatch.hidePart(s);
  faunaBatch.commit();
  group.add(faunaBatch.mesh);

  const poultryGeos = [
    henParts.bodyGeo, henParts.headGeo,
    chickGeo,
    roosterParts.bodyGeo, roosterParts.headGeo, roosterParts.wingLGeo, roosterParts.wingRGeo,
    buffaloParts.bodyGeo, buffaloParts.headGeo, buffaloParts.earLGeo, buffaloParts.earRGeo, buffaloParts.legGeo,
    egretParts.bodyGeo, egretParts.headGeo,
    dogParts.bodyGeo, dogParts.headGeo, dogParts.earGeo, dogParts.tailGeo, dogParts.legGeo,
    swallowParts.bodyGeo, swallowParts.wingLGeo, swallowParts.wingRGeo,
    striderGeo
  ];

  // 母鸡与四只雏鸡 + 柴垛大公鸡（确保远离晒谷场凸起盘缘，在草地/鸡舍空地清晰觅食）
  const marks = props?.marks || [];
  const threshes = marks.filter(m => m.kind === 'thresh');
  const thresh = threshes[0];
  const houseBlockers = village?.blockers || [];
  const clearOfThreshes = (cx, cz, pad = 2.55) =>
    threshes.every(t => Math.hypot(cx - t.x, cz - t.z) > (t.r || 6.4) + pad);
  const clearOfHouses = (cx, cz) => {
    for (const b of houseBlockers) {
      const rot = b.rot || 0;
      const c = Math.cos(rot), s = Math.sin(rot);
      const dx = cx - b.x, dz = cz - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < (b.hw || 1) + 0.75 && Math.abs(lz) < (b.hd || 1) + 0.75) return false;
    }
    return !pond || Math.hypot(cx - pond.x, cz - pond.z) > pond.radius + 1.5;
  };
  const clampAwayFromThresh = (px, pz, pad = 2.15) => {
    let x = px, z = pz;
    for (const t of threshes) {
      const minR = (t.r || 6.4) + pad;
      const dx = x - t.x, dz = z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < minR) {
        const ang = d > 1e-4 ? Math.atan2(dz, dx) : 0.8;
        x = t.x + Math.cos(ang) * (minR + 0.12);
        z = t.z + Math.sin(ang) * (minR + 0.12);
      }
    }
    return [x, z];
  };

  if (buffaloLive && pond) {
    const baseAng = Math.atan2(buffaloLive.pondZ - pond.z, buffaloLive.pondX - pond.x);
    const pondR = pond.radius || 9.2;
    let pickedBank = null;
    for (const rAdd of [2.4, 3.3, 4.4, 5.6]) {
      if (pickedBank) break;
      for (let k = 0; k < 16; k++) {
        const off = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * 0.24;
        const ang = baseAng + off;
        const cx = pond.x + Math.cos(ang) * (pondR + rAdd);
        const cz = pond.z + Math.sin(ang) * (pondR + rAdd);
        const gy = surface(cx, cz);
        if (!Number.isFinite(gy) || gy < pond.waterY + 0.08) continue;
        if (!clearOfThreshes(cx, cz, 2.4) || !clearOfHouses(cx, cz)) continue;
        if (!builtStatic.context || habitatSiteSafe(builtStatic.context, cx, cz, 1.25)) {
          pickedBank = [cx, cz, ang];
          break;
        }
      }
    }
    if (!pickedBank) {
      const fb = clampAwayFromThresh(
        pond.x + Math.cos(baseAng) * (pondR + 3.2),
        pond.z + Math.sin(baseAng) * (pondR + 3.2),
        2.5
      );
      pickedBank = [fb[0], fb[1], baseAng];
    }
    buffaloLive.bankX = pickedBank[0];
    buffaloLive.bankZ = pickedBank[1];

    let pickedRest = null;
    const goalRef = anchors.fieldHut
      ? { x: anchors.fieldHut.farmerPos[0], z: anchors.fieldHut.farmerPos[2] }
      : (anchors.eaveShelters[0] || {
          x: pickedBank[0] + Math.cos(pickedBank[2]) * 4.5,
          z: pickedBank[1] + Math.sin(pickedBank[2]) * 4.5
        });
    const toGoalAng = Math.atan2(goalRef.z - pickedBank[1], goalRef.x - pickedBank[0]);
    for (const stepDist of [3.8, 4.8, 2.8, 5.8]) {
      if (pickedRest) break;
      for (const aOff of [0, 0.35, -0.35, 0.72, -0.72, 1.1, -1.1]) {
        const ang = toGoalAng + aOff;
        const rx = pickedBank[0] + Math.cos(ang) * stepDist;
        const rz = pickedBank[1] + Math.sin(ang) * stepDist;
        const gy = surface(rx, rz);
        if (!Number.isFinite(gy) || gy < pond.waterY + 0.12) continue;
        if (!clearOfThreshes(rx, rz, 2.4) || !clearOfHouses(rx, rz)) continue;
        if (!builtStatic.context || habitatSiteSafe(builtStatic.context, rx, rz, 1.25)) {
          pickedRest = [rx, rz];
          break;
        }
      }
    }
    if (!pickedRest) pickedRest = [pickedBank[0], pickedBank[1]];
    buffaloLive.restX = pickedRest[0];
    buffaloLive.restZ = pickedRest[1];
  }

  const coops = [
    ...marks.filter(m => m.kind === 'coop'),
    ...((options.villageLife?.items || village?.items || []).filter(it => it.kind === 'chickenCoop' || it.type === 'chickenCoop'))
  ];
  const clearOfHousesThin = (cx, cz, pad = 0.22) => {
    for (const b of houseBlockers) {
      const rot = b.rot || 0;
      const c = Math.cos(rot), s = Math.sin(rot);
      const dx = cx - b.x, dz = cz - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < (b.hw || 1) + pad && Math.abs(lz) < (b.hd || 1) + pad) return false;
    }
    return !pond || Math.hypot(cx - pond.x, cz - pond.z) > pond.radius + 0.8;
  };
  const clearPathForPoultry = (ax, az, bx, bz) => {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.ceil(dist / 0.9));
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      const mx = ax + (bx - ax) * f;
      const mz = az + (bz - az) * f;
      if (!clearOfThreshes(mx, mz, 0.65) || !clearOfHousesThin(mx, mz, 0.22)) return false;
    }
    return true;
  };
  let henHome = null;
  let pickedHenPos = null;
  let pickedHenCoop = null;
  for (const coop of coops) {
    if (pickedHenPos) break;
    const baseRot = coop.rot || 0;
    for (const r of [2.1, 2.9, 3.8, 4.7]) {
      if (pickedHenPos) break;
      for (let k = 0; k < 12; k++) {
        const ang = baseRot + (k / 12) * TAU;
        const cx = coop.x + Math.cos(ang) * r;
        const cz = coop.z + Math.sin(ang) * r;
        if (!clearOfThreshes(cx, cz, 2.55) || !clearOfHouses(cx, cz)) continue;
        if (!builtStatic.context || habitatSiteSafe(builtStatic.context, cx, cz, 1.35)) {
          pickedHenPos = [cx, cz];
          pickedHenCoop = coop;
          break;
        }
      }
    }
  }
  if (!pickedHenPos) {
    for (const coop of coops) {
      if (pickedHenPos) break;
      for (const r of [2.5, 3.6, 5.0]) {
        if (pickedHenPos) break;
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * TAU;
          const cx = coop.x + Math.cos(ang) * r;
          const cz = coop.z + Math.sin(ang) * r;
          if (clearOfThreshes(cx, cz, 2.55) && clearOfHouses(cx, cz)) {
            pickedHenPos = [cx, cz];
            pickedHenCoop = coop;
            break;
          }
        }
      }
    }
  }
  if (!pickedHenPos && thresh) {
    for (const rAdd of [3.2, 4.4, 5.6]) {
      if (pickedHenPos) break;
      for (let k = 0; k < 12; k++) {
        const ang = -0.6 + (k / 12) * TAU;
        const cx = thresh.x + Math.cos(ang) * ((thresh.r || 6.4) + rAdd);
        const cz = thresh.z + Math.sin(ang) * ((thresh.r || 6.4) + rAdd);
        if (clearOfThreshes(cx, cz, 2.55) && clearOfHouses(cx, cz)) {
          pickedHenPos = [cx, cz];
          break;
        }
      }
    }
  }
  if (pickedHenPos || coops[0] || anchors.eaveShelters[0]) {
    const [hx, hz] = pickedHenPos || clampAwayFromThresh(
      anchors.eaveShelters[0]?.x ?? coops[0].x + 2.5,
      anchors.eaveShelters[0]?.z ?? coops[0].z + 2.5,
      2.6
    );
    const refCoop = pickedHenCoop || coops[0] || null;
    let coopNest = null;
    if (refCoop) {
      const cRot = refCoop.rot || 0;
      const doorAng = Math.atan2(hx - refCoop.x, hz - refCoop.z);
      for (const r of [0.72, 0.95, 1.20]) {
        const nx = refCoop.x + Math.sin(cRot) * r;
        const nz = refCoop.z + Math.cos(cRot) * r;
        if (clearOfThreshes(nx, nz, 2.2) && clearOfHouses(nx, nz)) {
          coopNest = [nx, nz];
          break;
        }
        const nx2 = refCoop.x + Math.cos(doorAng) * r;
        const nz2 = refCoop.z + Math.sin(doorAng) * r;
        if (clearOfThreshes(nx2, nz2, 2.2) && clearOfHouses(nx2, nz2)) {
          coopNest = [nx2, nz2];
          break;
        }
      }
    }
    const shelterPool = [
      ...(coopNest ? [{ x: coopNest[0], z: coopNest[1] }] : []),
      ...anchors.woodpiles.map(w => ({ x: w.shelterX, z: w.shelterZ })),
      ...anchors.eaveShelters
    ];
    const shelterCandidate = shelterPool.find(e => clearOfThreshes(e.x, e.z, 2.15));
    const [sx, sz] = shelterCandidate ? [shelterCandidate.x, shelterCandidate.z] : [hx, hz];
    henHome = {
      sunX: hx,
      sunZ: hz,
      shelterX: sx,
      shelterZ: sz,
      coopRef: refCoop,
      curX: hx,
      curY: surface(hx, hz),
      curZ: hz,
      roostU: 0,
      sleeping: false,
      startleUntil: 0,
      lastStartleAt: -99
    };
    henBatch.mesh.visible = true;
    chickMesh.visible = true;
    targets.push({
      id: 'hen-chicks',
      x: hx,
      y: surface(hx, hz) + 0.3,
      z: hz,
      range: 5.5,
      resolve: () => ({ x: henHome.curX, y: henHome.curY + 0.3, z: henHome.curZ })
    });
  }

  let roosterHome = null;
  if (anchors.woodpiles[0]) {
    const wp = anchors.woodpiles[0];
    const outHopX = wp.x + (wp.x - wp.shelterX);
    const outHopZ = wp.z + (wp.z - wp.shelterZ);
    const hopPtX = clearOfHousesThin(outHopX, outHopZ, 0.30) ? outHopX : wp.shelterX;
    const hopPtZ = clearOfHousesThin(outHopX, outHopZ, 0.30) ? outHopZ : wp.shelterZ;
    let roostX = hopPtX;
    let roostZ = hopPtZ;
    let roostY = surface(roostX, roostZ) + 0.01;
    let roostYaw = wp.rot + Math.PI * 0.5;
    let roostKind = 'eave-coop';
    let roostMidX = (hopPtX + roostX) * 0.5;
    let roostMidZ = (hopPtZ + roostZ) * 0.5;
    // 优先寻找通畅可达（支持绕过屋角单折点）的农家鸡舍（“日入鸡栖于埘”），栖于鸡舍草顶栖木或窝前栖架
    const sortedCoops = coops
      .slice()
      .sort((a, b) => Math.hypot(a.x - wp.x, a.z - wp.z) - Math.hypot(b.x - wp.x, b.z - wp.z));
    for (const cp of sortedCoops) {
      const dist = Math.hypot(cp.x - wp.x, cp.z - wp.z);
      if (dist > 65) continue;
      let via = null;
      if (clearPathForPoultry(hopPtX, hopPtZ, cp.x, cp.z)) {
        via = [(hopPtX + cp.x) * 0.5, (hopPtZ + cp.z) * 0.5];
      } else {
        const dx = cp.x - hopPtX, dz = cp.z - hopPtZ;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len;
        for (const lat of [3.5, -3.5, 6.5, -6.5, 10.5, -10.5, 15.0, -15.0]) {
          const mx = (hopPtX + cp.x) * 0.5 + nx * lat;
          const mz = (hopPtZ + cp.z) * 0.5 + nz * lat;
          if (clearPathForPoultry(hopPtX, hopPtZ, mx, mz) && clearPathForPoultry(mx, mz, cp.x, cp.z)) {
            via = [mx, mz];
            break;
          }
        }
      }
      if (via) {
        const isPropsCoop = cp.kind === 'coop';
        roostX = cp.x;
        roostZ = cp.z;
        roostY = surface(cp.x, cp.z) + (isPropsCoop ? 0.74 : 0.62);
        roostYaw = (cp.rot || 0) + 0.25;
        roostMidX = via[0];
        roostMidZ = via[1];
        roostKind = 'coop';
        break;
      }
    }
    if (roostKind !== 'coop' && anchors.eaveShelters.length) {
      const nearEave = anchors.eaveShelters
        .slice()
        .sort((a, b) => Math.hypot(a.x - wp.x, a.z - wp.z) - Math.hypot(b.x - wp.x, b.z - wp.z))
        .find(e => Math.hypot(e.x - wp.x, e.z - wp.z) < 16 && clearPathForPoultry(hopPtX, hopPtZ, e.x, e.z));
      if (nearEave) {
        roostX = nearEave.x;
        roostZ = nearEave.z;
        roostY = surface(nearEave.x, nearEave.z) + 0.01;
        roostYaw = (nearEave.hi?.rot ?? wp.rot);
        roostMidX = (hopPtX + roostX) * 0.5;
        roostMidZ = (hopPtZ + roostZ) * 0.5;
      }
    }
    roosterHome = {
      x: wp.x,
      y: wp.y + 0.72,
      z: wp.z,
      rot: wp.rot,
      hopX: hopPtX,
      hopZ: hopPtZ,
      midX: roostMidX,
      midZ: roostMidZ,
      roostX,
      roostY,
      roostZ,
      roostYaw,
      roostKind,
      roostU: 0,
      curX: wp.x,
      curY: wp.y + 0.72,
      curZ: wp.z,
      mode: 'perch'
    };
    roosterBatch.mesh.visible = true;
  }

  const gateStates = (anchors.gates || []).slice(0, 2).map(g => ({
    ...g,
    swingOffset: 0,
    wasNear: false,
    lastCreakAt: -99
  }));

  // 门槛大黄狗
  const houses = village?.houseInfo || [];
  let dogHome = null;
  if (houses.length) {
    const hi = houses[0];
    const c = Math.cos(hi.rot), s = Math.sin(hi.rot);
    const lx = 0.92, lz = hi.d * 0.5 + 0.36;
    const dx = hi.x + lx * c + lz * s;
    const dz = hi.z - lx * s + lz * c;
    const nearWp = anchors.woodpiles.find(w => Math.hypot(w.x - dx, w.z - dz) < 15) || anchors.eaveShelters[0];
    const shX = nearWp ? (nearWp.shelterX ?? nearWp.x) : dx - 0.5 * c;
    const shZ = nearWp ? (nearWp.shelterZ ?? nearWp.z) : dz - 0.5 * s;
    dogHome = { sunX: dx, sunZ: dz, shelterX: shX, shelterZ: shZ, yaw: hi.rot };
  }

  // Color assignment for 24 non-animal dynamic prop slots
  // 0..9 Dynamic brushwood gates (up to 2 gates * 5 slats)
  for (let g = 0; g < 2; g++) {
    const base = g * 5;
    setColor(base, SLOT_COLORS.gateWood);
    setColor(base + 1, SLOT_COLORS.gateWood);
    setColor(base + 2, SLOT_COLORS.gateWood);
    setColor(base + 3, SLOT_COLORS.gateFrame);
    setColor(base + 4, SLOT_COLORS.gateFrame);
  }
  // 10..18 Three drying trays (tray + rim + crops)
  for (let i = 0; i < 3; i++) {
    setColor(10 + i * 3, SLOT_COLORS.trayBamboo);
    setColor(11 + i * 3, SLOT_COLORS.trayRim);
    setColor(12 + i * 3, i === 0 ? SLOT_COLORS.cropShoot : i === 1 ? SLOT_COLORS.cropJujube : SLOT_COLORS.cropMillet);
  }
  // 19..20 Hanging indigo & hemp cloth
  setColor(19, SLOT_COLORS.indigoCloth);
  setColor(20, SLOT_COLORS.hempCloth);
  // 21..23 Three falling indigo drops
  for (let i = 21; i <= 23; i++) setColor(i, SLOT_COLORS.indigoDrop);
  if (dynMesh.instanceColor) dynMesh.instanceColor.needsUpdate = true;

  // ============================================================================
  // 3. 屋檐水帘与茅草亭雨线、池面雨点涟漪（qin-han-rain-curtain，skyIgnore=true）
  // ============================================================================
  const rainDrops = [];
  for (let i = 0; i < Math.min(4, houses.length); i++) {
    const hi = houses[i];
    const c = Math.cos(hi.rot), s = Math.sin(hi.rot);
    for (const side of [-1, 1]) {
      for (const lz of [-hi.d * 0.25, hi.d * 0.25]) {
        const lx = side * (hi.w * 0.5 + 0.36);
        const rx = hi.x + lx * c + lz * s;
        const rz = hi.z - lx * s + lz * c;
        rainDrops.push({ kind: 'eave', x: rx, topY: hi.gy + hi.h - 0.05, floorY: surface(rx, rz), z: rz, phase: rainDrops.length * 0.37 });
      }
    }
  }
  // 四角茅草凉亭四檐水帘
  const pavRegion = (unwrap(leisureGrove).regions || []).find(r => r.kind === 'pavilion' || r.id === 'pavilion' || r.name === 'pavilion');
  if (pavRegion) {
    const pr = Math.max(1.85, (pavRegion.r || pavRegion.radius || 2.4) * 0.78);
    const pavG = surface(pavRegion.x, pavRegion.z);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.2;
      const rx = pavRegion.x + Math.cos(a) * pr;
      const rz = pavRegion.z + Math.sin(a) * pr;
      rainDrops.push({ kind: 'eave', x: rx, topY: pavG + 2.25, floorY: surface(rx, rz), z: rz, phase: k * 0.45 });
    }
  }
  const eaveCount = Math.min(14, rainDrops.length);
  const rippleCount = pond ? 6 : 0;
  const RAIN_COUNT = Math.max(1, eaveCount + rippleCount);
  const rainGeo = new THREE.BoxGeometry(1, 1, 1);
  const rainMat = new THREE.MeshLambertMaterial({
    color: '#CBD5D7',
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    flatShading: true
  });
  rainMat.userData.skyIgnore = true;
  const rainMesh = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
  rainMesh.name = 'qin-han-rain-curtain';
  rainMesh.userData.dynamic = true;
  rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rainMesh.frustumCulled = true;
  rainMesh.visible = false;
  rainMesh.renderOrder = 4;
  group.add(rainMesh);

  // ============================================================================
  // 4. 晴夜晒谷场篝火坛火焰与火星（qin-han-night-bonfire，雨夜自动熄灭）
  // ============================================================================
  const FIRE_COUNT = 8;
  const fireGeo = new THREE.BoxGeometry(1, 1, 1);
  const fireMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
  fireMat.userData.skyIgnore = true;
  const fireMesh = new THREE.InstancedMesh(fireGeo, fireMat, FIRE_COUNT);
  fireMesh.name = 'qin-han-night-bonfire';
  fireMesh.userData.dynamic = true;
  fireMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (anchors.hearth) {
    fireMesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(anchors.hearth.x, anchors.hearth.y + 0.7, anchors.hearth.z),
      2.2
    );
    fireMesh.frustumCulled = true;
  } else {
    fireMesh.frustumCulled = false;
  }
  fireMesh.visible = false;
  group.add(fireMesh);

  const dynBox = new THREE.Box3();
  const expandDynPt = (px, py, pz) => {
    if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
      dynBox.expandByPoint(tmpPos.set(px, py, pz));
    }
  };
  if (buffaloSite) expandDynPt(buffaloSite.x, buffaloSite.y, buffaloSite.z);
  if (buffaloLive) {
    expandDynPt(buffaloLive.bankX, surface(buffaloLive.bankX, buffaloLive.bankZ) + 1.2, buffaloLive.bankZ);
    expandDynPt(buffaloLive.restX, surface(buffaloLive.restX, buffaloLive.restZ) + 1.2, buffaloLive.restZ);
  }
  if (pond) {
    expandDynPt(pond.x - (pond.radius || 9), pond.waterY, pond.z - (pond.radius || 9));
    expandDynPt(pond.x + (pond.radius || 9), pond.waterY + 3, pond.z + (pond.radius || 9));
  }
  if (dogHome) {
    expandDynPt(dogHome.sunX, surface(dogHome.sunX, dogHome.sunZ), dogHome.sunZ);
    expandDynPt(dogHome.shelterX, surface(dogHome.shelterX, dogHome.shelterZ), dogHome.shelterZ);
  }
  for (const g of gateStates) expandDynPt(g.hx, g.gy, g.hz);
  for (const n of anchors.swallowNests) expandDynPt(n.x, n.y, n.z);
  for (const tr of anchors.dryingTrays) {
    expandDynPt(tr.sun[0], tr.sun[1], tr.sun[2]);
    expandDynPt(tr.shelter[0], tr.shelter[1], tr.shelter[2]);
  }
  if (anchors.dyeRack) {
    expandDynPt(anchors.dyeRack.rackCenter[0], anchors.dyeRack.rackCenter[1], anchors.dyeRack.rackCenter[2]);
    expandDynPt(anchors.dyeRack.eaveBar[0], anchors.dyeRack.eaveBar[1], anchors.dyeRack.eaveBar[2]);
  }
  if (!dynBox.isEmpty()) {
    dynBox.expandByScalar(12);
    const sharedDynSphere = dynBox.getBoundingSphere(new THREE.Sphere());
    dynMesh.boundingSphere = sharedDynSphere;
    dynMesh.frustumCulled = true;
    faunaBatch.geo.boundingSphere = sharedDynSphere.clone();
    faunaBatch.mesh.frustumCulled = true;
  }
  const rainBox = new THREE.Box3();
  for (const r of rainDrops) rainBox.expandByPoint(tmpPos.set(r.x, (r.topY + r.floorY) * 0.5, r.z));
  if (pond) {
    rainBox.expandByPoint(tmpPos.set(pond.x - 6, pond.waterY, pond.z - 6));
    rainBox.expandByPoint(tmpPos.set(pond.x + 6, pond.waterY + 1, pond.z + 6));
  }
  if (!rainBox.isEmpty()) {
    rainBox.expandByScalar(4);
    rainMesh.boundingSphere = rainBox.getBoundingSphere(new THREE.Sphere());
  } else {
    rainMesh.frustumCulled = false;
  }

  const firePalette = ['#DF5A24', '#F28E30', '#F9C455', '#E8732A', '#FAD97B'];
  for (let i = 0; i < FIRE_COUNT; i++) {
    fireMesh.setColorAt(i, tmpColor.set(firePalette[i % firePalette.length]));
  }
  if (fireMesh.instanceColor) fireMesh.instanceColor.needsUpdate = true;

  const setInst = (mesh, idx, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    tmpPos.set(x, y, z);
    tmpEuler.set(rx, ry, rz, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpScale.set(sx, sy, sz);
    tmpM.compose(tmpPos, tmpQuat, tmpScale);
    mesh.setMatrixAt(idx, tmpM);
  };

  // ============================================================================
  // 5. 状态机更新（strictly dt-driven, freeze on dt<=0, zero heap allocs）
  // ============================================================================
  let simTime = 0;
  let shelterBlend = 0;
  let nightFireGlow = 0;
  let rainCurtainGlow = 0;
  let swallowPerchCount = 0;
  let dogAlert = false;
  let disposed = false;
  const pendingEvents = [];
  let roosterCrowTimer = 9.5;
  let roosterCrowElapsed = 99;
  let roosterCrowing = false;
  let roosterCrowPending = false;
  let roosterWingSpread = 0;
  let wasDawnForCrow = false;
  let roosterEchoDelay = -1;
  let prevWeaverShuttle = 0;
  let lastLoomAt = -99;
  let livingObstacles = options?.livingObstacles || null;
  let henAvoidX = 0;
  let henAvoidZ = 0;
  const _qhCap = { rear: 0, front: 0, radius: 0.3, mass: 1 };
  const _qhGap = { dist: 0, minDist: 0, gap: 0, overlap: 0, nx: 0, nz: 1, s: 0, t: 0 };
  const _bufCur = { x: 0, z: 0, yaw: 0 };
  const _bufPrev = { x: 0, z: 0, yaw: 0 };
  const buffaloObs = buffaloLive
    ? { id: 'qh-buffalo', kind: 'buffalo', x: buffaloLive.x, z: buffaloLive.z, yaw: buffaloLive.yaw || 0, rear: -0.36, front: 0.54, radius: 0.45, mass: 12 }
    : null;
  const henObs = henHome
    ? { id: 'qh-hen', kind: 'henBrood', x: henHome.sunX, z: henHome.sunZ, yaw: 0, rear: -0.36, front: 0.08, radius: 0.36, mass: 1.4 }
    : null;
  const dogObs = dogHome
    ? { id: 'qh-dog', kind: 'dog', x: dogHome.sunX, z: dogHome.sunZ, yaw: dogHome.yaw || 0, rear: -0.14, front: 0.26, radius: 0.25, mass: 1.8 }
    : null;
  const animalObstacles = [];
  if (buffaloObs) animalObstacles.push(buffaloObs);
  if (henObs) animalObstacles.push(henObs);
  if (dogObs) animalObstacles.push(dogObs);

  function evalBuffaloPose(uVal, movingBack, modeVal, out) {
    let bx, bz, segYaw;
    if (uVal <= 0.45) {
      const f = smoothstep01(uVal / 0.45);
      bx = lerp(buffaloLive.pondX, buffaloLive.bankX, f);
      bz = lerp(buffaloLive.pondZ, buffaloLive.bankZ, f);
      segYaw = yawTo(buffaloLive.pondX, buffaloLive.pondZ, buffaloLive.bankX, buffaloLive.bankZ);
    } else {
      const f = smoothstep01((uVal - 0.45) / 0.55);
      bx = lerp(buffaloLive.bankX, buffaloLive.restX, f);
      bz = lerp(buffaloLive.bankZ, buffaloLive.restZ, f);
      segYaw = Math.hypot(buffaloLive.restX - buffaloLive.bankX, buffaloLive.restZ - buffaloLive.bankZ) > 0.15
        ? yawTo(buffaloLive.bankX, buffaloLive.bankZ, buffaloLive.restX, buffaloLive.restZ)
        : yawTo(buffaloLive.pondX, buffaloLive.pondZ, buffaloLive.bankX, buffaloLive.bankZ);
    }
    const travelYaw = movingBack ? segYaw + Math.PI : segYaw;
    out.x = bx;
    out.z = bz;
    out.yaw = uVal < 0.06
      ? buffaloLive.pondYaw
      : travelYaw + (modeVal === 'dusk-return' ? Math.sin(simTime * 0.45) * 0.08 : 0);
    return out;
  }

  function buffaloRouteBlocked(prevPose, nextPose) {
    if (!livingObstacles) return false;
    const animals = livingObstacles.animals;
    if (animals) {
      for (let i = 0; i < animals.length; i++) {
        const b = animals[i];
        if (!b || b.kind === 'bird' || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
        if (Math.abs(b.x - nextPose.x) > 3.4 || Math.abs(b.z - nextPose.z) > 3.4) continue;
        const rB = b.capRadius !== undefined ? b.capRadius : capsuleProfile(b.kind, b.scale, _qhCap).radius;
        const rearB = b.capRear !== undefined ? b.capRear : _qhCap.rear;
        const frontB = b.capFront !== undefined ? b.capFront : _qhCap.front;
        capsuleGap(nextPose.x, nextPose.z, nextPose.yaw, -0.36, 0.54, 0.45, b.x, b.z, b.yaw || 0, rearB, frontB, rB, _qhGap);
        const nextGap = _qhGap.gap;
        if (nextGap < 0.08) {
          capsuleGap(prevPose.x, prevPose.z, prevPose.yaw, -0.36, 0.54, 0.45, b.x, b.z, b.yaw || 0, rearB, frontB, rB, _qhGap);
          if (nextGap < _qhGap.gap - 1e-4) return true;
        }
      }
    }
    const people = livingObstacles.people;
    if (people) {
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
        if (Math.abs(p.x - nextPose.x) > 3.0 || Math.abs(p.z - nextPose.z) > 3.0) continue;
        const rP = (p.basket ? 0.34 : 0.30) * (p.s || 1);
        capsuleGap(nextPose.x, nextPose.z, nextPose.yaw, -0.36, 0.54, 0.45, p.x, p.z, 0, 0, 0, rP, _qhGap);
        const nextGap = _qhGap.gap;
        if (nextGap < 0.10) {
          capsuleGap(prevPose.x, prevPose.z, prevPose.yaw, -0.36, 0.54, 0.45, p.x, p.z, 0, 0, 0, rP, _qhGap);
          if (nextGap < _qhGap.gap - 1e-4) return true;
        }
      }
    }
    return false;
  }

  function animate(step, sky, playerState) {
    const w = readWeather(sky);
    const targetShelter = (w.storm || w.isNight) ? 1 : 0;
    const stepAlpha = step > 0 ? Math.min(1, step * (targetShelter > shelterBlend ? 0.95 : 0.65)) : 0;
    shelterBlend = shelterBlend + (targetShelter - shelterBlend) * stepAlpha;
    const sb = smoothstep01(shelterBlend);

    // 1. Villagers animation
    actorRig.begin();
    for (let i = 0; i < villagers.length; i++) {
      const v = villagers[i];
      let yaw = v.facing;
      let lean = 0, crouch = 0, nod = 0, headTurn = 0, walk = 0;
      let left = [-0.22, 0.92, 0.26];
      let right = [0.22, 0.98 + Math.sin(simTime * 3) * 0.05, 0.30];
      if (v.greetUntil > simTime) {
        yaw = yawTo(v.x, v.z, v.greetX, v.greetZ);
        const rem = v.greetUntil - simTime;
        const bowW = Math.min(1, rem * 1.8) * Math.min(1, (3.5 - Math.min(3.5, rem) + 0.25) * 3.0);
        crouch = (v.role === 'weaver' || v.role === 'bamboo_artisan') ? 0.45 : 0;
        lean = 0.20 * bowW;
        nod = 0.14 * bowW + Math.sin(simTime * 3.2) * 0.04;
        const hy = 1.02 - crouch * 0.28 - bowW * 0.03;
        left = [-0.045, hy, 0.33];
        right = [0.045, hy - 0.015, 0.31];
      } else if (v.role === 'weaver') {
        if (sb > 0.35 && anchors.weaving) {
          yaw = yawTo(v.x, v.z, anchors.weaving.rackCenter[0], anchors.weaving.rackCenter[2]);
          lean = 0.14;
          left = [-0.18, 1.18, 0.34];
          right = [0.20, 1.32 + Math.sin(simTime * 4.2) * 0.08, 0.36];
          headTurn = Math.sin(simTime * 1.8) * 0.22;
        } else {
          const shuttle = Math.sin(simTime * 3.4);
          if (step > 0 && ((prevWeaverShuttle <= 0 && shuttle > 0) || (prevWeaverShuttle >= 0 && shuttle < 0))) {
            if (simTime - lastLoomAt > 0.85) {
              lastLoomAt = simTime;
              pendingEvents.push({ type: 'loom', x: v.x, z: v.z });
            }
          }
          prevWeaverShuttle = shuttle;
          crouch = 0.58;
          lean = 0.18 + Math.sin(simTime * 2.6) * 0.08;
          left = [-0.20, 0.68 + shuttle * 0.05, 0.34];
          right = [0.20, 0.68 - shuttle * 0.05, 0.34];
        }
      } else if (v.role === 'carpenter') {
        const bamPeer = villagers.find(o => o.role === 'bamboo_artisan');
        v.rainRest = w.rain > 0.28 ? 1 : 0;
        v.nightRest = w.timeId === 'night';
        if (w.timeId === 'night') {
          lean = 0.06;
          nod = 0.12 + Math.sin(simTime * 0.8) * 0.03;
          left = [-0.18, 0.86, 0.22];
          right = [0.18, 0.86, 0.22];
        } else if (w.rain > 0.28) {
          if (bamPeer) yaw = yawTo(v.x, v.z, bamPeer.x, bamPeer.z);
          lean = 0.08;
          const talkWave = Math.sin(simTime * 2.1);
          left = [-0.20, 0.90, 0.24];
          right = [0.16, 1.12 + Math.max(0, talkWave) * 0.12, 0.30];
          headTurn = Math.sin(simTime * 1.25) * 0.18;
          nod = Math.sin(simTime * 1.9) * 0.05;
        } else {
          const thrust = Math.sin(simTime * 3.1);
          lean = 0.24 + thrust * 0.14;
          left = [-0.16, 0.84, 0.36 + thrust * 0.14];
          right = [0.16, 0.86, 0.32 + thrust * 0.14];
        }
      } else if (v.role === 'bamboo_artisan') {
        const carpPeer = villagers.find(o => o.role === 'carpenter');
        v.rainRest = w.rain > 0.28 ? 1 : 0;
        v.nightRest = w.timeId === 'night';
        if (w.timeId === 'night') {
          crouch = 0.68;
          lean = 0.10;
          nod = 0.16 + Math.sin(simTime * 0.75 + 1.1) * 0.03;
          left = [-0.16, 0.56, 0.24];
          right = [0.16, 0.56, 0.24];
        } else if (w.rain > 0.28) {
          if (carpPeer) yaw = yawTo(v.x, v.z, carpPeer.x, carpPeer.z);
          crouch = 0.66;
          lean = 0.12;
          nod = -0.08 + Math.sin(simTime * 1.7 + 0.8) * 0.06;
          headTurn = Math.sin(simTime * 1.1 + 0.6) * 0.16;
          left = [-0.16, 0.60, 0.28];
          right = [0.18, 0.72 + Math.max(0, -Math.sin(simTime * 2.1)) * 0.10, 0.32];
        } else {
          crouch = 0.72;
          lean = 0.22;
          nod = Math.sin(simTime * 1.6) * 0.06;
          left = [-0.16, 0.56 + Math.sin(simTime * 4.5) * 0.04, 0.30];
          right = [0.16, 0.58 + Math.cos(simTime * 4.5) * 0.04, 0.32];
        }
      } else if (v.role === 'hut_farmer') {
        // 平日瓜庐坐歇纳凉，风起变天时起身眺望田亩与牲畜
        crouch = lerp(0.68, 0.04, sb);
        lean = lerp(0.05, 0.12, sb);
        headTurn = lerp(Math.sin(simTime * 0.7) * 0.15, Math.sin(simTime * 1.4) * 0.42, sb);
        const handY = lerp(0.55, 0.96, sb);
        left = [-0.22, handY, 0.24];
        right = sb > 0.4 ? [0.18, 1.26, 0.28] : [0.22, handY, 0.26];
      }
      actorRig.actor(v.x, v.y, v.z, yaw, v.s);
      actorRig.human(v, { lean, crouch, nod, headTurn, left, right, walk });
    }
    actorRig.finish();

    // 2. Sculpted Water Buffalo (水牛：昼浸泥塘、暮归草岸、夜卧反刍) + White Egret (白鹭) in faunaBatch slots 0..5
    if (buffaloLive) {
      const wantMode = (w.timeId === 'night' || w.storm)
        ? 'night-rest'
        : (w.timeId === 'dusk' ? 'dusk-return' : 'pond');
      const targetU = wantMode === 'night-rest'
        ? 1.0
        : (wantMode === 'dusk-return' ? 0.62 + 0.20 * Math.sin(simTime * 0.22) : 0.0);
      const prevU = buffaloLive.routeU;
      const uAlpha = step > 0 ? Math.min(1, step * 1.15) : 0;
      let u = prevU + (targetU - prevU) * uAlpha;
      const movingBack = targetU < prevU - 0.005;
      let candMode = u > 0.82 && wantMode === 'night-rest'
        ? 'night-rest'
        : (u > 0.22 ? 'dusk-return' : 'pond');
      evalBuffaloPose(u, movingBack, candMode, _bufCur);
      if (step > 0 && Math.abs(u - prevU) > 1e-5 && livingObstacles) {
        evalBuffaloPose(prevU, movingBack, buffaloLive.mode, _bufPrev);
        if (buffaloRouteBlocked(_bufPrev, _bufCur)) {
          u = prevU;
          candMode = u > 0.82 && wantMode === 'night-rest'
            ? 'night-rest'
            : (u > 0.22 ? 'dusk-return' : 'pond');
          evalBuffaloPose(u, movingBack, candMode, _bufCur);
        }
      }
      buffaloLive.routeU = u;
      buffaloLive.mode = candMode;

      const bx = _bufCur.x;
      const bz = _bufCur.z;
      const byaw = _bufCur.yaw;
      const landT = smoothstep01(Math.min(1, u / 0.42));
      const restFold = wantMode === 'night-rest' ? smoothstep01((u - 0.78) / 0.22) : 0;
      const isWalking = (Math.abs(targetU - u) > 0.02 || wantMode === 'dusk-return') && restFold < 0.5;
      const strideBob = isWalking ? Math.abs(Math.sin(simTime * 3.8)) * 0.028 : (1 + Math.sin(simTime * 1.15)) * 0.006;
      const groundY = surface(bx, bz);
      const wy = lerp(buffaloLive.pondY, groundY + lerp(0.35, 0.17, restFold), landT);

      buffaloLive.x = bx;
      buffaloLive.y = wy;
      buffaloLive.z = bz;
      buffaloLive.yaw = byaw;
      if (buffaloObs) {
        buffaloObs.x = bx;
        buffaloObs.z = bz;
        buffaloObs.yaw = byaw;
      }

      const bc = Math.cos(byaw), bs = Math.sin(byaw);
      const bob = strideBob;
      const earFlick = Math.sin(simTime * (restFold > 0.5 ? 2.2 : 5.2)) > 0.88 ? 0.34 : 0.04;
      const headTurn = restFold > 0.5
        ? Math.sin(simTime * 0.35) * 0.08
        : Math.sin(simTime * 0.55) * 0.08;
      const hyaw = byaw + headTurn;
      const bodyPitch = isWalking ? Math.sin(simTime * 3.8) * 0.022 : 0;
      faunaBatch.writePart(0, bx, wy + 0.02 + bob, bz, bodyPitch, byaw, 0);
      const hx = bx + bs * 0.56, hz = bz + bc * 0.56, hy = wy + lerp(0.16, 0.10, restFold) + bob * 0.8;
      const cudNod = restFold > 0.5
        ? 0.08 + Math.sin(simTime * 2.4) * 0.032
        : -0.10 + Math.sin(simTime * 0.8) * 0.05;
      faunaBatch.writePart(1, hx, hy, hz, cudNod, hyaw, 0);
      const hc = Math.cos(hyaw), hs = Math.sin(hyaw);
      faunaBatch.writePart(2, hx - hc * 0.15 + hs * 0.02, hy + 0.05, hz + hs * 0.15 + hc * 0.02, 0.06, hyaw, earFlick);
      faunaBatch.writePart(3, hx + hc * 0.15 + hs * 0.02, hy + 0.05, hz - hs * 0.15 + hc * 0.02, 0.06, hyaw, -earFlick);

      // 水牛四足与偶蹄：塘中浸水半隐、暮归草岸稳健迈步（绝不陷地）、入夜屈膝盘卧腹下
      const bufLegSpecs = [
        [-0.20, 0.28, 1],
        [0.20, 0.28, -1],
        [-0.21, -0.34, -1],
        [0.21, -0.34, 1]
      ];
      for (let li = 0; li < 4; li++) {
        const [lx, lz, gaitSign] = bufLegSpecs[li];
        const lwx = bx + lx * bc + lz * bs;
        const lwz = bz - lx * bs + lz * bc;
        const swingWave = isWalking ? gaitSign * Math.sin(simTime * 3.8) : 0;
        const stepLift = isWalking ? Math.max(0, gaitSign * Math.cos(simTime * 3.8)) * 0.038 * landT : 0;
        const lwy = wy + stepLift - restFold * 0.05;
        const lrx = lerp(swingWave * 0.30, -1.34, restFold);
        faunaBatch.writePart(buffaloLegBaseSlot + li, lwx, lwy, lwz, lrx, byaw, 0, 1, lerp(1, 0.86, restFold), 1);
      }

      // 白鹭：白昼立于牛背啄虻，傍晚水牛离塘后伫立浅滩理羽，入夜敛颈安眠
      if (u < 0.32) {
        const eyaw = byaw + 0.18;
        const es = Math.sin(eyaw), ec = Math.cos(eyaw);
        const ex = bx + bs * 0.06, ez = bz + bc * 0.06, ey = wy + 0.33 + bob;
        const peck = Math.max(0, Math.sin(simTime * 2.1 + 0.5)) * 0.42;
        faunaBatch.writePart(4, ex, ey, ez, peck * 0.22, eyaw, 0);
        faunaBatch.writePart(
          5,
          ex + es * 0.10,
          ey + 0.21 - peck * 0.04,
          ez + ec * 0.10,
          peck * 0.85,
          eyaw + Math.sin(simTime * 1.1) * 0.15,
          0
        );
      } else {
        const ex = lerp(buffaloLive.pondX, buffaloLive.bankX, 0.72);
        const ez = lerp(buffaloLive.pondZ, buffaloLive.bankZ, 0.72);
        const egGround = surface(ex, ez);
        const ey = egGround >= buffaloLive.pondY - 0.02
          ? egGround + 0.004
          : Math.max(egGround + 0.004, buffaloLive.pondY - 0.06);
        const eyaw = buffaloLive.pondYaw + 0.45;
        const es = Math.sin(eyaw), ec = Math.cos(eyaw);
        const egretAsleep = w.isDeepNight || w.storm;
        const tuck = egretAsleep ? 0.56 : Math.max(0, Math.sin(simTime * 1.7)) * 0.38;
        faunaBatch.writePart(4, ex, ey, ez, tuck * 0.16, eyaw, 0);
        faunaBatch.writePart(
          5,
          ex + es * (0.09 - (egretAsleep ? 0.035 : 0)),
          ey + 0.20 - tuck * 0.09,
          ez + ec * (0.09 - (egretAsleep ? 0.035 : 0)),
          tuck * 0.82,
          eyaw + (egretAsleep ? 0 : Math.sin(simTime * 0.9) * 0.14),
          0
        );
      }
    }

    // 3. 芦花母鸡 + 四只毛茸茸小鸡仔 + 柴垛大公鸡（日出司晨、晴昼啄食、日暮归窝、入夜栖埘安眠）
    const px = playerState?.x, pz = playerState?.z;
    if (henHome) {
      const targetHenRoost = (w.isDeepNight || w.storm) ? 1 : (w.isDusk ? 0.72 : 0);
      const prevHRU = henHome.roostU;
      const henAlpha = step > 0 ? Math.min(1, step * 1.35) : (simTime === 0 ? 1 : 0);
      henHome.roostU = henHome.roostU + (targetHenRoost - henHome.roostU) * henAlpha;
      const hru = smoothstep01(henHome.roostU);
      const henSleeping = (w.isDeepNight || w.storm) && hru > 0.82;
      henHome.sleeping = henSleeping;

      const hx = lerp(henHome.sunX, henHome.shelterX, hru);
      const hz = lerp(henHome.sunZ, henHome.shelterZ, hru);
      const wanderX = hru < 0.3 ? Math.sin(simTime * 0.42) * 0.55 * (1 - hru) : 0;
      const wanderZ = hru < 0.3 ? Math.cos(simTime * 0.36) * 0.45 * (1 - hru) : 0;
      if (step > 0 && livingObstacles && hru < 0.5) {
        let pushX = 0, pushZ = 0;
        const baseHx = hx + wanderX + henAvoidX, baseHz = hz + wanderZ + henAvoidZ;
        const animals = livingObstacles.animals;
        if (animals) {
          for (let i = 0; i < animals.length; i++) {
            const b = animals[i];
            if (!b || b.kind === 'bird' || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
            if (Math.abs(b.x - baseHx) > 2.4 || Math.abs(b.z - baseHz) > 2.4) continue;
            const rB = b.capRadius !== undefined ? b.capRadius : 0.35;
            capsuleGap(baseHx, baseHz, 0, 0, 0, 0.42, b.x, b.z, b.yaw || 0, b.capRear || 0, b.capFront || 0, rB, _qhGap);
            if (_qhGap.gap < 0.25) { pushX += _qhGap.nx * (0.25 - _qhGap.gap); pushZ += _qhGap.nz * (0.25 - _qhGap.gap); }
          }
        }
        const people = livingObstacles.people;
        if (people) {
          for (let i = 0; i < people.length; i++) {
            const p = people[i];
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
            if (Math.abs(p.x - baseHx) > 2.0 || Math.abs(p.z - baseHz) > 2.0) continue;
            capsuleGap(baseHx, baseHz, 0, 0, 0, 0.40, p.x, p.z, 0, 0, 0, 0.32, _qhGap);
            if (_qhGap.gap < 0.22) { pushX += _qhGap.nx * (0.22 - _qhGap.gap); pushZ += _qhGap.nz * (0.22 - _qhGap.gap); }
          }
        }
        const pl = Math.hypot(pushX, pushZ);
        if (pl > 1e-5) {
          henAvoidX += (pushX / pl) * Math.min(0.9 * step, pl);
          henAvoidZ += (pushZ / pl) * Math.min(0.9 * step, pl);
          const al = Math.hypot(henAvoidX, henAvoidZ);
          if (al > 0.95) { henAvoidX = (henAvoidX / al) * 0.95; henAvoidZ = (henAvoidZ / al) * 0.95; }
        } else {
          const dec = Math.exp(-1.8 * step);
          henAvoidX = Math.abs(henAvoidX * dec) < 1e-4 ? 0 : henAvoidX * dec;
          henAvoidZ = Math.abs(henAvoidZ * dec) < 1e-4 ? 0 : henAvoidZ * dec;
        }
      } else if (step > 0 && hru >= 0.5) {
        henAvoidX *= Math.exp(-2.5 * step);
        henAvoidZ *= Math.exp(-2.5 * step);
      }
      const [curX, curZ] = clampAwayFromThresh(hx + wanderX + henAvoidX, hz + wanderZ + henAvoidZ, 2.15);
      const curY = surface(curX, curZ) + 0.004;
      henHome.curX = curX;
      henHome.curY = curY;
      henHome.curZ = curZ;

      const pDistHen = Number.isFinite(px) && Number.isFinite(pz) ? Math.hypot(px - curX, pz - curZ) : 99;
      if (step > 0 && playerState?.sprinting && pDistHen < 4.5 && !henSleeping) {
        henHome.startleUntil = simTime + 1.4;
        if (simTime - henHome.lastStartleAt > 3.5) {
          henHome.lastStartleAt = simTime;
          pendingEvents.push({ type: 'henStartle', x: curX, z: curZ });
        }
      }

      const startled = simTime < henHome.startleUntil;
      const walkingToCoop = Math.abs(targetHenRoost - henHome.roostU) > 0.03;
      const henWalkNod = walkingToCoop ? Math.sin(simTime * 9.5) * 0.16 : 0;
      const peck = henSleeping
        ? 0.42
        : ((hru < 0.35 && !startled && !walkingToCoop) ? Math.pow(Math.max(0, Math.sin(simTime * 4.4)), 3) : 0.06);
      const toCoopYaw = yawTo(henHome.sunX, henHome.sunZ, henHome.shelterX, henHome.shelterZ);
      const hyaw = hru > 0.25 || walkingToCoop
        ? (walkingToCoop && targetHenRoost < prevHRU ? toCoopYaw + Math.PI : toCoopYaw)
        : simTime * 0.16 + Math.sin(simTime * 0.42) * 0.45;
      const hopY = startled
        ? Math.abs(Math.sin(simTime * 16)) * 0.14
        : (walkingToCoop ? Math.abs(Math.sin(simTime * 9.5)) * 0.028 : 0);

      henBatch.mesh.position.set(curX, curY + hopY, curZ);
      henBatch.mesh.rotation.set(
        0,
        hyaw,
        startled ? Math.sin(simTime * 18) * 0.16 : (henSleeping ? 0 : Math.sin(simTime * (walkingToCoop ? 9.5 : 6.5)) * (walkingToCoop ? 0.036 : 0.025))
      );
      if (henObs) {
        henObs.x = curX;
        henObs.z = curZ;
        henObs.yaw = hyaw;
      }
      henBatch.writePart(0, 0, henSleeping ? -0.02 : 0, 0, henSleeping ? 0.10 : peck * 0.28 + henWalkNod * 0.35, 0, 0);
      henBatch.writePart(
        1,
        henParts.neckPivot[0],
        henParts.neckPivot[1] - (henSleeping ? 0.03 : 0),
        henParts.neckPivot[2] - (henSleeping ? 0.02 : 0),
        henSleeping ? 0.48 : peck * 0.68 + henWalkNod,
        startled ? Math.sin(simTime * 14) * 0.35 : (henSleeping ? 0 : Math.sin(simTime * 2.1) * (walkingToCoop ? 0.08 : 0.18)),
        0
      );
      henBatch.commit();

      for (let c = 0; c < 4; c++) {
        // 入夜时四只雏鸡紧偎在母鸡双翼旁安静熟睡，不再夜间蹦跳
        const ca = henSleeping
          ? hyaw + (c < 2 ? -1 : 1) * (1.25 + (c % 2) * 0.48)
          : hyaw + Math.PI + (c - 1.5) * 0.52;
        const cr = lerp(0.34 + (c % 2) * 0.15, 0.15 + (c % 2) * 0.04, hru);
        const [cx, cz] = clampAwayFromThresh(curX + Math.sin(ca) * cr, curZ + Math.cos(ca) * cr, 2.05);
        const chickHop = henSleeping
          ? 0
          : Math.abs(Math.sin(simTime * (startled ? 14 : 6.5) + c * 1.3)) * (startled ? 0.09 : 0.028) * (1 - hru * 0.7);
        const cy = surface(cx, cz) + 0.003 + chickHop;
        const chickPitch = henSleeping ? 0.12 : Math.sin(simTime * 9 + c) * 0.05;
        const chickYaw = henSleeping ? hyaw + (c - 1.5) * 0.15 : hyaw + Math.sin(simTime * 1.6 + c) * 0.25;
        setInst(chickMesh, c, cx, cy, cz, 1, henSleeping ? 0.92 : 1, 1, chickPitch, chickYaw, 0);
      }
      chickMesh.boundingSphere.center.set(curX, curY + 0.15, curZ);
      chickMesh.boundingSphere.radius = 2.5;
      chickMesh.instanceMatrix.needsUpdate = true;
    }

    if (roosterHome) {
      const ROOSTER_LEAD_IN = 0.18;
      const ROOSTER_CROW_SPAN = 2.25;
      const ROOSTER_TOTAL_SPAN = ROOSTER_LEAD_IN + ROOSTER_CROW_SPAN;
      const isDawn = w.timeId === 'dawn';
      // 司晨公鸡作息：晨昼立于柴垛昂首司晨；日暮跳下柴垛步行归向鸡舍；入夜与风雨栖于鸡舍敛翼垂首安眠
      const targetRoostU = (w.isDeepNight || w.storm)
        ? 1.0
        : (w.isDusk ? 0.62 : 0.0);
      const prevRU = roosterHome.roostU;
      const rAlpha = step > 0 ? Math.min(1, step * (isDawn ? 2.4 : 1.15)) : 0;
      const ru = prevRU + (targetRoostU - prevRU) * rAlpha;
      roosterHome.roostU = ru;

      let rx, ry, rz, ryaw;
      const roosterWalking = Math.abs(targetRoostU - ru) > 0.025 && ru > 0.15 && ru < 0.92;
      const roosterSleeping = (w.isDeepNight || w.storm) && ru > 0.85;
      roosterHome.mode = roosterSleeping ? 'sleep' : (ru > 0.18 ? 'roost-walk' : 'perch');

      if (ru <= 0.22) {
        const f = smoothstep01(ru / 0.22);
        rx = lerp(roosterHome.x, roosterHome.hopX, f);
        rz = lerp(roosterHome.z, roosterHome.hopZ, f);
        const hopGround = surface(roosterHome.hopX, roosterHome.hopZ) + 0.005;
        ry = lerp(roosterHome.y, hopGround, f) + Math.sin(f * Math.PI) * 0.16;
        ryaw = lerp(roosterHome.rot, yawTo(roosterHome.x, roosterHome.z, roosterHome.roostX, roosterHome.roostZ), f);
      } else if (ru <= 0.85) {
        const f = smoothstep01((ru - 0.22) / 0.63);
        const iu = 1 - f;
        rx = iu * iu * roosterHome.hopX + 2 * iu * f * roosterHome.midX + f * f * roosterHome.roostX;
        rz = iu * iu * roosterHome.hopZ + 2 * iu * f * roosterHome.midZ + f * f * roosterHome.roostZ;
        const tx = 2 * iu * (roosterHome.midX - roosterHome.hopX) + 2 * f * (roosterHome.roostX - roosterHome.midX);
        const tz = 2 * iu * (roosterHome.midZ - roosterHome.hopZ) + 2 * f * (roosterHome.roostZ - roosterHome.midZ);
        const walkGround = surface(rx, rz) + 0.005;
        const walkBob = roosterWalking ? Math.abs(Math.sin(simTime * 9.2)) * 0.028 : 0;
        ry = walkGround + walkBob;
        const travelYaw = Math.hypot(tx, tz) > 1e-4 ? Math.atan2(tx, tz) : roosterHome.roostYaw;
        ryaw = targetRoostU < prevRU ? travelYaw + Math.PI : travelYaw;
      } else {
        const f = smoothstep01((ru - 0.85) / 0.15);
        rx = roosterHome.roostX;
        rz = roosterHome.roostZ;
        const walkGround = surface(rx, rz) + 0.005;
        ry = lerp(walkGround, roosterHome.roostY, f) + (f > 0.1 && f < 0.9 ? Math.sin(f * Math.PI) * 0.14 : 0);
        ryaw = roosterHome.roostYaw;
      }
      roosterHome.curX = rx;
      roosterHome.curY = ry;
      roosterHome.curZ = rz;

      const canCrow = !w.isNight && !w.storm && (isDawn || (w.timeId === 'day' && w.rain < 0.12));
      if (step > 0) {
        if (canCrow) {
          if (isDawn && !wasDawnForCrow && !roosterCrowing) {
            roosterCrowTimer = Math.min(roosterCrowTimer, 0.20);
          }
          if (!roosterCrowing) roosterCrowTimer -= step;
          if (!roosterCrowing && roosterCrowTimer <= 0) {
            roosterCrowTimer = isDawn ? 13.5 : 24.0;
            roosterCrowElapsed = 0;
            roosterCrowing = true;
            roosterCrowPending = true;
            pendingEvents.push({ type: 'roosterFlap', x: rx, z: rz });
          }
          if (roosterEchoDelay > 0) {
            roosterEchoDelay -= step;
            if (roosterEchoDelay <= 0) {
              roosterEchoDelay = -1;
              pendingEvents.push({ type: 'roosterCrowEcho', x: rx - 28, z: rz + 20 });
            }
          }
        } else {
          roosterCrowPending = false;
          if (roosterSleeping) roosterCrowing = false;
        }
        wasDawnForCrow = isDawn;
        if (roosterCrowing) {
          roosterCrowElapsed += step;
          if (roosterCrowPending && roosterCrowElapsed >= ROOSTER_LEAD_IN) {
            roosterCrowPending = false;
            if (canCrow) {
              roosterEchoDelay = isDawn ? 2.55 : -1;
              pendingEvents.push({ type: 'roosterCrow', x: rx, z: rz });
            }
          }
          if (roosterCrowElapsed >= ROOSTER_TOTAL_SPAN) {
            roosterCrowing = false;
            roosterCrowPending = false;
          }
        }
      }

      let flapEnv = 0;
      let crowBrace = 0;
      let crowLift = 0;
      if (roosterCrowing) {
        const uFlap = roosterCrowElapsed / 0.22;
        if (uFlap < 1) {
          const twoBeats = Math.pow(Math.sin(uFlap * Math.PI * 2), 2);
          flapEnv = Math.min(1, twoBeats * 0.86 + Math.sin(uFlap * Math.PI) * 0.22);
        }
        if (roosterCrowElapsed < ROOSTER_LEAD_IN) {
          const uLead = roosterCrowElapsed / ROOSTER_LEAD_IN;
          crowLift = Math.sin(uLead * Math.PI * 0.5) * 0.14;
        } else {
          const uCrow = Math.min(1, (roosterCrowElapsed - ROOSTER_LEAD_IN) / ROOSTER_CROW_SPAN);
          crowLift = Math.sin(uCrow * Math.PI) * 0.46;
          crowBrace = Math.sin(Math.min(1, uCrow * 1.15) * Math.PI);
        }
      }
      const sleepBlend = roosterSleeping ? smoothstep01((ru - 0.85) / 0.15) : 0;
      roosterWingSpread = (flapEnv + crowBrace * 0.18) * (1 - sleepBlend);
      const walkNod = roosterWalking ? Math.sin(simTime * 9.2) * 0.08 : 0;
      const bodyPitch = sleepBlend > 0
        ? 0.14 * sleepBlend + Math.sin(simTime * 1.1) * 0.008 * sleepBlend
        : -crowLift * 0.30 - flapEnv * 0.08 + walkNod * 0.5;
      const cyB = Math.cos(bodyPitch), sxB = Math.sin(bodyPitch);
      const wingSpreadZ = (flapEnv * 0.78 + crowBrace * 0.14) * (1 - sleepBlend);
      const wingFlareY = (flapEnv * 0.42 + crowBrace * 0.12) * (1 - sleepBlend);
      const wingPitchX = bodyPitch + flapEnv * 0.24 * (1 - sleepBlend);
      const wLP = roosterParts.wingLPivot;
      const wRP = roosterParts.wingRPivot;
      const shY = wLP[1] * cyB - wLP[2] * sxB;
      const shZ = wLP[1] * sxB + wLP[2] * cyB;
      const neckY = roosterParts.neckPivot[1] * cyB - roosterParts.neckPivot[2] * sxB - sleepBlend * 0.035;
      const neckZ = roosterParts.neckPivot[1] * sxB + roosterParts.neckPivot[2] * cyB - sleepBlend * 0.025;
      const headPitch = sleepBlend > 0
        ? 0.58 * sleepBlend
        : -crowLift * 0.95 + walkNod;
      const headTurnYaw = sleepBlend > 0
        ? 0
        : (roosterCrowing ? Math.sin(roosterCrowElapsed * 4.5) * 0.08 : Math.sin(simTime * 1.3) * (roosterWalking ? 0.08 : 0.22));

      roosterBatch.mesh.position.set(rx, ry + flapEnv * 0.025, rz);
      roosterBatch.mesh.rotation.set(0, ryaw, roosterWalking ? Math.sin(simTime * 9.2) * 0.035 : 0);
      roosterBatch.writePart(0, 0, 0, 0, bodyPitch, 0, 0);
      roosterBatch.writePart(1, roosterParts.neckPivot[0], neckY, neckZ, headPitch, headTurnYaw, 0);
      roosterBatch.writePart(2, wLP[0], shY, shZ, wingPitchX, wingFlareY, -wingSpreadZ);
      roosterBatch.writePart(3, wRP[0], shY, shZ, wingPitchX, -wingFlareY, wingSpreadZ);
      roosterBatch.commit();
    }

    // 3b. 柴木荆扉（dynMesh 0..9，走近推开并触发干涩木轴吱呀声）
    for (let gi = 0; gi < gateStates.length; gi++) {
      const g = gateStates[gi];
      const base = gi * 5;
      const dist = Number.isFinite(px) && Number.isFinite(pz) ? Math.hypot(px - g.hx, pz - g.hz) : 99;
      const near = dist < 1.95;
      const targetSwing = near ? -0.92 : 0;
      const prevSwing = g.swingOffset;
      const gAlpha = step > 0 ? Math.min(1, step * 5.2) : 0;
      g.swingOffset = prevSwing + (targetSwing - prevSwing) * gAlpha;
      if (step > 0 && ((near !== g.wasNear && Math.abs(targetSwing - prevSwing) > 0.15) || Math.abs(g.swingOffset - prevSwing) > 0.025)) {
        if (simTime - g.lastCreakAt > 4.5) {
          g.lastCreakAt = simTime;
          pendingEvents.push({ type: 'gateCreak', x: g.hx, z: g.hz });
        }
      }
      g.wasNear = near;

      const ang = g.restSwing + g.swingOffset;
      const gc = Math.cos(ang), gs = Math.sin(ang);
      const mid = g.gateLen * 0.5;
      const cx = g.hx + mid * gc, cz = g.hz - mid * gs;
      setInst(dynMesh, base, cx, g.gy + 0.22, cz, g.gateLen, 0.048, 0.042, 0, ang, 0);
      setInst(dynMesh, base + 1, cx, g.gy + 0.45, cz, g.gateLen, 0.048, 0.042, 0, ang, 0);
      setInst(dynMesh, base + 2, cx, g.gy + 0.68, cz, g.gateLen, 0.048, 0.042, 0, ang, 0);
      setInst(dynMesh, base + 3, g.hx + g.gateLen * 0.92 * gc, g.gy + 0.45, g.hz - g.gateLen * 0.92 * gs, 0.048, 0.58, 0.048, 0, ang, 0);
      setInst(dynMesh, base + 4, cx, g.gy + 0.45, cz, Math.hypot(g.gateLen * 0.88, 0.44), 0.042, 0.036, 0, ang, 0.52);
    }

    // 4. 柴门黄犬（faunaBatch slots 6..14：晴昼迎客、日暮守庭、入夜蜷卧柴门并在来客逼近时警觉抬头）
    if (dogHome) {
      const dx = lerp(dogHome.sunX, dogHome.shelterX, sb);
      const dz = lerp(dogHome.sunZ, dogHome.shelterZ, sb);
      const dy = surface(dx, dz);
      const playerDist = Number.isFinite(px) && Number.isFinite(pz) ? Math.hypot(px - dx, pz - dz) : 99;
      const nightWatchAlert = w.isDeepNight && playerDist < 3.0;
      dogAlert = (playerDist < 6.8 && sb < 0.5) || nightWatchAlert;
      const moving = sb > 0.05 && sb < 0.95;
      const stride = moving ? Math.abs(Math.sin(simTime * 11)) * 0.042 : 0;
      const standing = moving || dogAlert;
      const dogDeepSleep = w.isDeepNight && !standing && !moving;
      const bodyLift = moving ? 0.226 + stride : (standing ? 0.222 : 0.118);
      const dyaw = moving
        ? yawTo(dogHome.sunX, dogHome.sunZ, dogHome.shelterX, dogHome.shelterZ)
        : (dogAlert ? yawTo(dx, dz, px, pz) : dogHome.yaw + 0.4);
      if (dogObs) {
        dogObs.x = dx;
        dogObs.z = dz;
        dogObs.yaw = dyaw;
      }
      const ds = Math.sin(dyaw), dc = Math.cos(dyaw);

      faunaBatch.writePart(6, dx, dy + bodyLift, dz, moving ? 0.05 : (dogAlert ? -0.05 : 0.03), dyaw, 0);
      const headX = dx + ds * 0.23, headZ = dz + dc * 0.23;
      const headY = dy + bodyLift + (dogAlert ? 0.11 : (dogDeepSleep ? 0.025 : 0.06));
      const headYaw = dyaw + (dogAlert ? Math.sin(simTime * 4.2) * 0.08 : 0);
      const hc = Math.cos(headYaw), hs = Math.sin(headYaw);
      faunaBatch.writePart(7, headX, headY, headZ, dogAlert ? -0.14 : (dogDeepSleep ? 0.24 : 0.08), headYaw, 0);

      for (const side of [-1, 1]) {
        const earSlot = side < 0 ? 8 : 9;
        const ex = headX + side * hc * 0.058 + hs * 0.02;
        const ez = headZ - side * hs * 0.058 + hc * 0.02;
        faunaBatch.writePart(
          earSlot,
          ex,
          headY + 0.075,
          ez,
          dogAlert ? 0.08 : 0.28,
          headYaw,
          -side * (dogAlert ? 0.10 : 0.52)
        );
      }

      const tailWag = dogAlert
        ? Math.sin(simTime * 10.5) * 0.65
        : (dogDeepSleep ? 0 : Math.sin(simTime * 1.8) * 0.12);
      faunaBatch.writePart(10, dx - ds * 0.24, dy + bodyLift + 0.04, dz - dc * 0.24, dogAlert ? 0.12 : -0.22, dyaw + tailWag, 0);

      const legSpecs = [
        [-0.075, 0.16, 1],
        [0.075, 0.16, -1],
        [-0.075, -0.17, -1],
        [0.075, -0.17, 1]
      ];
      for (let li = 0; li < 4; li++) {
        const [lx, lz, gaitSign] = legSpecs[li];
        const wx = dx + lx * dc + lz * ds;
        const wz = dz - lx * ds + lz * dc;
        const pawLift = moving ? Math.max(0, gaitSign * Math.cos(simTime * 11)) * 0.036 : 0;
        const wy = standing ? dy + bodyLift + pawLift : dy + 0.095;
        const lrx = moving ? gaitSign * Math.sin(simTime * 11) * 0.42 : (standing ? 0 : -1.36);
        faunaBatch.writePart(11 + li, wx, wy, wz, lrx, dyaw, 0, 1, standing ? 1 : 0.82, 1);
      }
    }

    // 5. 六只屋檐双燕（faunaBatch slots 15..32：深叉剪尾 + 掠掠尖翼，晴昼低飞，夜雨归巢）
    const nests = anchors.swallowNests;
    const nestsAvail = nests.length > 0;
    const shouldRoost = w.rain > 0.20 || w.isNight || !nestsAvail;
    swallowPerchCount = (nestsAvail && shouldRoost) ? 6 : 0;
    if (nestsAvail) {
      const orbitCenterX = pond ? lerp(pond.x, nests[0].x, 0.45) : nests[0].x;
      const orbitCenterZ = pond ? lerp(pond.z, nests[0].z, 0.45) : nests[0].z;
      for (let i = 0; i < 6; i++) {
        const nest = nests[i % nests.length];
        const baseSlot = 15 + i * 3;
        if (shouldRoost) {
          const ox = nest.x + (i >= nests.length ? 0.05 : -0.05);
          const oy = nest.y + 0.032;
          const oz = nest.z;
          const pyaw = i * 1.05;
          const pc = Math.cos(pyaw), ps = Math.sin(pyaw);
          faunaBatch.writePart(baseSlot, ox, oy, oz, -0.08, pyaw, 0);
          faunaBatch.writePart(baseSlot + 1, ox - pc * 0.018, oy + 0.004, oz + ps * 0.018, -0.08, pyaw + 0.55, -0.22, 0.72, 0.85, 0.85);
          faunaBatch.writePart(baseSlot + 2, ox + pc * 0.018, oy + 0.004, oz - ps * 0.018, -0.08, pyaw - 0.55, 0.22, 0.72, 0.85, 0.85);
        } else {
          const a = simTime * (0.95 + (i % 3) * 0.16) + i * 1.1;
          const rx = 5.2 + (i % 2) * 3.1;
          const rz = 4.2 + (i % 3) * 2.4;
          const sx = orbitCenterX + Math.cos(a) * rx;
          const sz = orbitCenterZ + Math.sin(a * 2) * rz * 0.55;
          const sy = (pond ? pond.waterY : nest.y - 2) + 2.0 + Math.sin(a * 3 + i) * 0.75;
          const yaw = Math.atan2(-Math.sin(a) * rx, Math.cos(a * 2) * 2 * rz * 0.55);
          const pitch = -Math.cos(a * 3 + i) * 0.14;
          const bank = Math.cos(a * 2) * 0.24;
          const flap = Math.sin(simTime * 16 + i * 2) * 0.68;
          const sc = Math.cos(yaw), ss = Math.sin(yaw);
          faunaBatch.writePart(baseSlot, sx, sy, sz, pitch, yaw, bank);
          faunaBatch.writePart(baseSlot + 1, sx - sc * 0.02, sy, sz + ss * 0.02, pitch, yaw, bank + flap);
          faunaBatch.writePart(baseSlot + 2, sx + sc * 0.02, sy, sz - ss * 0.02, pitch, yaw, bank - flap);
        }
      }
    }

    // 6. 池面六只水黾（faunaBatch slots 33..38：梭形躯干 + 四支斜张点水长足）
    if (pond) {
      const rate = w.rain > 0.35 ? 0.35 : 0.85;
      for (let i = 0; i < 6; i++) {
        const slot = 33 + i;
        const cycle = (simTime * rate + i * 0.31);
        const frac = cycle % 1;
        const burst = Math.floor(cycle) + Math.pow(frac, 0.42);
        const ang = burst * 0.9 + i * 1.05;
        const rad = 1.6 + (i % 3) * 1.35 + Math.sin(burst * 0.6) * 0.4;
        const wx = pond.x + Math.cos(ang) * rad;
        const wz = pond.z + Math.sin(ang) * rad;
        const wy = pond.waterY + 0.012;
        const fyaw = ang + Math.PI * 0.5;
        const strokeX = 1 + Math.sin(frac * Math.PI) * 0.12;
        faunaBatch.writePart(slot, wx, wy, wz, 0, fyaw, 0, strokeX, 1, 1);
      }
    }

    faunaBatch.commit();

    // 7. 三只大竹匾与晾衣杆靛青麻布（dynMesh 10..23：晴日晾晒，起风下雨收至檐下）
    for (let i = 0; i < Math.min(3, anchors.dryingTrays.length); i++) {
      const tr = anchors.dryingTrays[i];
      const arcLift = Math.sin(sb * Math.PI) * 0.35;
      const tx = lerp(tr.sun[0], tr.shelter[0], sb);
      const ty = lerp(tr.sun[1], tr.shelter[1], sb) + arcLift;
      const tz = lerp(tr.sun[2], tr.shelter[2], sb);
      const base = 10 + i * 3;
      // Octagonal woven sunning tray silhouette (overlapping rotated rim + raised bamboo mat + heaped crop mound)
      setInst(dynMesh, base + 1, tx, ty + 0.008, tz, 0.86, 0.034, 0.86, 0, i * 0.4, 0);
      setInst(dynMesh, base, tx, ty + 0.026, tz, 0.80, 0.030, 0.80, 0, i * 0.4 + Math.PI * 0.25, 0);
      setInst(dynMesh, base + 2, tx, ty + 0.056, tz, 0.56, 0.068, 0.56, 0, i * 0.4, 0);
    }

    if (anchors.dyeRack) {
      const dr = anchors.dyeRack;
      const windSway = (0.08 + w.wind * 0.28) * Math.sin(simTime * (2.5 + w.wind * 3.5)) * (1 - sb * 0.85);
      const ix = lerp(dr.rackCenter[0] - 0.32, dr.eaveBar[0] - 0.25, sb);
      const iy = lerp(dr.rackCenter[1] - 0.38, dr.eaveBar[1] - 0.16, sb);
      const iz = lerp(dr.rackCenter[2], dr.eaveBar[2], sb);
      const clothH = lerp(0.76, 0.34, sb);
      setInst(dynMesh, 19, ix, iy, iz, 0.56, clothH, 0.04, windSway, dr.rackYaw, 0);
      const hx = lerp(dr.rackCenter[0] + 0.34, dr.eaveBar[0] + 0.28, sb);
      setInst(dynMesh, 20, hx, iy, iz, 0.50, clothH * 0.92, 0.04, windSway * 1.1, dr.rackYaw, 0);
      // 靛青滴水珠掉进豁口破陶盆（收起后停止滴水）
      for (let d = 0; d < 3; d++) {
        const dropSlot = 21 + d;
        if (sb > 0.32) {
          setInst(dynMesh, dropSlot, 0, -50, 0, 0, 0, 0);
        } else {
          const p = (simTime * 0.85 + d * 0.33) % 1;
          const dy = lerp(dr.rackCenter[1] - 0.75, dr.basinY, p);
          setInst(dynMesh, dropSlot, ix + (d - 1) * 0.12, dy, iz, 0.024, 0.045, 0.024);
        }
      }
    }

    dynMesh.instanceMatrix.needsUpdate = true;

    // 8. 屋檐与茅草凉亭雨帘 + 池塘雨滴涟漪
    rainCurtainGlow = w.rain;
    if (rainCurtainGlow > 0.02 && rainDrops.length) {
      rainMesh.visible = true;
      const tiltX = Math.max(-0.28, Math.min(0.28, w.windX * 0.16));
      const tiltZ = Math.max(-0.28, Math.min(0.28, w.windZ * 0.16));
      for (let i = 0; i < eaveCount; i++) {
        const e = rainDrops[i];
        const span = Math.max(0.5, e.topY - e.floorY);
        const f = (simTime * (1.8 + w.rain * 1.4) + e.phase) % 1;
        const dropY = e.topY - f * span * 0.85;
        const len = Math.min(0.75, 0.35 + w.rain * 0.4) * (1 - f * 0.3);
        setInst(rainMesh, i, e.x + w.windX * f * 0.18, dropY, e.z + w.windZ * f * 0.18, 0.026, len, 0.026, tiltZ, 0, -tiltX);
      }
      if (pond) {
        for (let r = 0; r < rippleCount; r++) {
          const rf = (simTime * 1.15 + r * 0.19) % 1;
          const ang = r * 1.7 + Math.floor(simTime * 1.15 + r * 0.19) * 0.7;
          const rad = 1.1 + ((r * 3.1) % 4.5);
          const rx = pond.x + Math.cos(ang) * rad;
          const rz = pond.z + Math.sin(ang) * rad;
          const sz = (0.12 + rf * 0.62) * Math.min(1, w.rain * 1.4);
          setInst(rainMesh, eaveCount + r, rx, pond.waterY + 0.015, rz, sz, 0.01, sz, 0, r * 0.5, 0);
        }
      }
      rainMesh.instanceMatrix.needsUpdate = true;
    } else {
      rainMesh.visible = false;
    }

    // 9. 晴夜篝火（非暴雨的夜晚或薄暮燃起，雨天熄灭）
    const wantFire = anchors.hearth && w.isNight && w.rain < 0.25;
    nightFireGlow = wantFire ? 1 : 0;
    if (wantFire) {
      fireMesh.visible = true;
      const hx = anchors.hearth.x, hy = anchors.hearth.y, hz = anchors.hearth.z;
      for (let i = 0; i < FIRE_COUNT; i++) {
        if (i < 5) {
          const a = (i / 5) * TAU + simTime * 1.2;
          const r = 0.08 + (i % 2) * 0.07;
          const flicker = 0.28 + Math.sin(simTime * 9.5 + i * 1.9) * 0.09;
          setInst(fireMesh, i, hx + Math.cos(a) * r, hy + 0.12 + flicker * 0.4, hz + Math.sin(a) * r, 0.12, flicker, 0.12, 0, a, Math.sin(simTime * 7 + i) * 0.18);
        } else {
          const sp = (simTime * 0.9 + i * 0.24) % 1;
          const sa = i * 2.1 + simTime * 2.2;
          const sr = 0.10 + sp * 0.22;
          const ss = Math.max(0.01, 0.045 * (1 - sp));
          setInst(fireMesh, i, hx + Math.cos(sa) * sr, hy + 0.24 + sp * 1.15, hz + Math.sin(sa) * sr, ss, ss * 1.4, ss);
        }
      }
      fireMesh.instanceMatrix.needsUpdate = true;
    } else {
      fireMesh.visible = false;
    }
  }

  // Initial pose at t=0
  animate(0, null, null);

  function getInteractables() {
    return villagers;
  }

  function greet(id, px, pz, dur = 3.5) {
    for (const v of villagers) {
      if (v.id === id) {
        v.greetUntil = simTime + dur;
        v.greetX = px;
        v.greetZ = pz;
      }
    }
  }

  function consumeEvents() {
    if (!pendingEvents.length) return [];
    const out = pendingEvents.slice();
    pendingEvents.length = 0;
    return out;
  }

  function update(dt, elapsed, sky, playerState) {
    if (disposed) return;
    const step = livingStep(dt);
    if (step <= 0) return;
    simTime += step;
    animate(step, sky, playerState);
  }

  function getStats() {
    const actorStats = actorRig.stats?.() || { triangles: 0, drawCalls: 0 };
    let drawCalls = 0;
    let propTriangles = 0;
    for (const obj of [builtStatic.mesh, dynMesh, faunaBatch.mesh, rainMesh, fireMesh, henBatch.mesh, chickMesh, roosterBatch.mesh]) {
      if (!obj || !obj.geometry) continue;
      if (obj.visible && (!obj.parent || obj.parent.visible !== false)) drawCalls++;
      const triPer = (obj.geometry.index?.count || obj.geometry.attributes.position.count) / 3;
      propTriangles += triPer * (obj.isInstancedMesh ? obj.count : 1);
    }
    const henPos = henHome ? { x: henHome.curX, y: henHome.curY, z: henHome.curZ } : null;
    const henClearOfThresh = !threshes.length || (henHome != null && threshes.every(t => Math.hypot(henHome.curX - t.x, henHome.curZ - t.z) > (t.r || 6.4) + 2.0));
    return {
      built: true,
      triangles: propTriangles + actorStats.triangles,
      propTriangles,
      actorTriangles: actorStats.triangles,
      drawCalls,
      staticTris: builtStatic.triCount,
      dynInstances: DYN_COUNT,
      shelterBlend,
      rainCurtainVisible: rainMesh.visible,
      bonfireVisible: fireMesh.visible,
      swallowCount: anchors.swallowNests.length ? 6 : 0,
      swallowPerchCount,
      striderCount: pond ? 6 : 0,
      dogAlert,
      villagers: villagers.length,
      poultrySculpted: true,
      henPos,
      henClearOfThresh,
      buffaloMode: buffaloLive ? buffaloLive.mode : 'none',
      buffaloPos: buffaloLive
        ? { x: buffaloLive.x, y: buffaloLive.y, z: buffaloLive.z, yaw: buffaloLive.yaw, routeU: buffaloLive.routeU }
        : null,
      roosterCrowing,
      roosterMode: roosterHome ? roosterHome.mode : 'none',
      roosterPos: roosterHome
        ? { x: roosterHome.curX, y: roosterHome.curY, z: roosterHome.curZ, roostU: roosterHome.roostU, roostKind: roosterHome.roostKind }
        : null,
      henSleeping: Boolean(henHome?.sleeping),
      roosterWingSpread: Math.round(roosterWingSpread * 1000) / 1000,
      gateStates: gateStates.map(g => ({ id: g.id, swingOffset: g.swingOffset })),
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pendingEvents.length = 0;
    actorRig.dispose();
    builtStatic.mesh.geometry.dispose();
    builtStatic.mesh.material.dispose();
    dynGeo.dispose();
    dynMat.dispose();
    rainGeo.dispose();
    rainMat.dispose();
    fireGeo.dispose();
    fireMat.dispose();
    faunaBatch.geo.dispose();
    henBatch.geo.dispose();
    roosterBatch.geo.dispose();
    for (const g of poultryGeos) g.dispose();
    poultryMat.dispose();
    group.removeFromParent();
  }

  const layout = {
    weaving: anchors.weaving,
    carpentry: anchors.carpentry,
    pottery: anchors.pottery,
    fieldHut: anchors.fieldHut,
    hearth: anchors.hearth,
    buffalo: buffaloSite
  };

  function getBuffaloState() {
    return buffaloLive ? { ...buffaloLive } : null;
  }

  function getAnimalObstacles() {
    return animalObstacles;
  }

  function setLivingObstacles(obs) {
    livingObstacles = obs || null;
  }

  return {
    group,
    blockers,
    targets,
    layout,
    getInteractables,
    getBuffaloState,
    getAnimalObstacles,
    setLivingObstacles,
    greet,
    consumeEvents,
    update,
    getStats,
    dispose
  };
}
