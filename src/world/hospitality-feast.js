import * as THREE from 'three';
import { createHabitatContext, habitatSiteSafe, habitatSurface } from './habitat-details.js';
import { createGroveBaker } from './leisure-grove-geometry.js';
import { createCommunityActors } from '../systems/community-actors.js';
import { livingStep } from '../systems/living-behavior.js';

const P = {
  mat: '#C9B582',
  matTrim: '#8A734B',
  cushion: '#D5C28E',
  wood: '#8F6A44',
  dark: '#5C4630',
  stone: '#8D9284',
  jar: '#785842',
  bowl: '#DED4BE',
  lacquer: '#8F3D2C',
  wine: '#C78D44',
  chopstick: '#CBB57C',
  platter: '#6B7E6E',
  chicken: '#B56B35',
  millet: '#D6BE74',
  steam: '#EDE7DA',
  lanternWood: '#634A33',
  lanternGlow: '#FFE3A8'
};

function unwrap(v) {
  return v?.layout || v || {};
}

function wrapAngle(a) {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function smooth01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// Act 2 hospitality courtyard feast ("便要还家，设酒杀鸡作食 / 乃不知有汉，无论魏晋").
export function createHospitalityFeast(options = {}) {
  const { world, field, targetBlockers = null } = options;
  const group = new THREE.Group();
  group.name = 'hospitality-feast';

  const blockers = [];
  const candidates = options.candidates || [
    [22, -60],
    [20, -58],
    [24, -62],
    [16, -64],
    [10, -72]
  ];

  let site = null;
  let context = null;
  const hasPrereqs = !!(world && field && options.distanceToRiver && options.riverCurve && options.village && options.props && options.hinterland && options.villageScenes && options.villageLife && options.flora && options.boats && options.cliff && options.exterior);

  if (hasPrereqs) {
    context = createHabitatContext(options);
    context.cfg = { ...context.cfg, maxSlope: 0.28, clearance: 0.35 };
    for (const src of options.reservations || []) {
      const raw = unwrap(src);
      const r = raw.reservations || raw;
      for (const q of Array.isArray(r) ? r : []) {
        if (![q.x, q.z].every(Number.isFinite)) continue;
        if (Number.isFinite(q.radius) && q.radius > 0) context.reservations.circles.push({ x: q.x, z: q.z, r: q.radius });
        else if (Number.isFinite(q.hw) && Number.isFinite(q.hd)) context.reservations.boxes.push({ ...q });
      }
      for (const b of src?.blockers || []) {
        if ([b.x, b.z, b.hw, b.hd].every(Number.isFinite)) context.reservations.boxes.push({ ...b });
      }
    }
    for (const c of options.habitatDetails?.layout?.clusters || []) {
      context.reservations.circles.push({ x: c.x, z: c.z, r: c.radius, source: 'habitat-detail' });
    }
    for (const [cx, cz] of candidates) {
      if (!habitatSiteSafe(cx, cz, 2.6, context)) continue;
      const y = habitatSurface(field, cx, cz);
      let maxDelta = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        maxDelta = Math.max(maxDelta, Math.abs(habitatSurface(field, cx + Math.cos(a) * 2.2, cz + Math.sin(a) * 2.2) - y));
      }
      if (maxDelta <= 0.24) {
        site = { x: cx, y, z: cz, radius: 2.6 };
        break;
      }
    }
  }

  if (!site) {
    return {
      group,
      blockers,
      layout: { site: null, guestSeat: null, villagers: [], rejected: ['no-clear-feast-site'] },
      setOnTalk() {},
      getInteractables: () => [],
      getGuestSeat: () => null,
      triggerToast: () => false,
      greet() {},
      update() {},
      getStats: () => ({ built: false, villagers: 0, toasting: false, triangles: 0, drawCalls: 0, disposed: false }),
      dispose() { group.removeFromParent(); }
    };
  }

  const surface = (px, pz) => habitatSurface(field, px, pz);
  const addCollider = (cx, cz, hw, hd, minY, maxY, source = 'feast-prop') => {
    const obb = { x: cx, z: cz, hw, hd, rot: 0, minY, maxY, source };
    blockers.push(obb);
    if (Array.isArray(targetBlockers)) targetBlockers.push(obb);
  };

  const baker = createGroveBaker();
  const { x, y, z } = site;
  const pt = (dx, dy, dz) => [x + dx, y + dy, z + dz];

  // 1. Terrain-conforming woven reed ground mat & braided border trim (zero grass clipping on slopes).
  const matW = 3.2, matD = 2.5, cols = 6, rows = 5;
  const matPt = (u, v, lift = 0.030) => {
    const px = x + (u - 0.5) * matW;
    const pz = z + (v - 0.5) * matD;
    return [px, surface(px, pz) + lift, pz];
  };
  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const u0 = ix / cols, u1 = (ix + 1) / cols, v0 = iz / rows, v1 = (iz + 1) / rows;
      const col = (ix + iz) % 2 === 0 ? P.mat : '#C4AE7A';
      baker.quad(matPt(u0, v0), matPt(u0, v1), matPt(u1, v1), matPt(u1, v0), col);
    }
  }
  const trimW = 0.13 / matW, trimD = 0.13 / matD;
  for (let ix = 0; ix < cols; ix++) {
    const u0 = ix / cols, u1 = (ix + 1) / cols;
    baker.quad(matPt(u0, 0, 0.038), matPt(u0, trimD, 0.038), matPt(u1, trimD, 0.038), matPt(u1, 0, 0.038), P.matTrim);
    baker.quad(matPt(u0, 1 - trimD, 0.038), matPt(u0, 1, 0.038), matPt(u1, 1, 0.038), matPt(u1, 1 - trimD, 0.038), P.matTrim);
    baker.quad(matPt(u0, 0, 0.038), matPt(u1, 0, 0.038), matPt(u1, 0, -0.04), matPt(u0, 0, -0.04), P.dark);
    baker.quad(matPt(u1, 1, 0.038), matPt(u0, 1, 0.038), matPt(u0, 1, -0.04), matPt(u1, 1, -0.04), P.dark);
  }
  for (let iz = 0; iz < rows; iz++) {
    const v0 = iz / rows, v1 = (iz + 1) / rows;
    baker.quad(matPt(0, v0, 0.038), matPt(0, v1, 0.038), matPt(trimW, v1, 0.038), matPt(trimW, v0, 0.038), P.matTrim);
    baker.quad(matPt(1 - trimW, v0, 0.038), matPt(1 - trimW, v1, 0.038), matPt(1, v1, 0.038), matPt(1, v0, 0.038), P.matTrim);
    baker.quad(matPt(0, v1, 0.038), matPt(0, v0, 0.038), matPt(0, v0, -0.04), matPt(0, v1, -0.04), P.dark);
    baker.quad(matPt(1, v0, 0.038), matPt(1, v1, 0.038), matPt(1, v1, -0.04), matPt(1, v0, -0.04), P.dark);
  }

  // 2. Low timber feast table + four corner legs + mortised apron stretchers + four wooden stools with reed seat pads.
  const tableH = 0.56;
  baker.block(pt(0, tableH, 0), [1.48, 0.075, 0.90], P.wood);
  baker.block(pt(0, tableH - 0.055, 0), [1.34, 0.04, 0.76], P.dark);
  for (const dx of [-0.62, 0.62]) {
    for (const dz of [-0.34, 0.34]) {
      const fl = surface(x + dx, z + dz);
      baker.block([x + dx, (fl + y + tableH - 0.04) * 0.5, z + dz], [0.09, y + tableH - fl - 0.04, 0.09], P.dark);
    }
    baker.beam([x + dx, y + 0.16, z - 0.34], [x + dx, y + 0.16, z + 0.34], 0.028, P.dark, 0.028, 4);
  }
  baker.beam([x - 0.62, y + 0.16, z], [x + 0.62, y + 0.16, z], 0.028, P.dark, 0.028, 4);
  addCollider(x, z, 0.76, 0.47, y, y + tableH + 0.05, 'feast-table');

  const stoolCoords = [
    [-1.08, -0.15], // west: woman (feast-guest-2)
    [1.08, -0.15],  // east: host (feast-host-0)
    [-0.38, -0.82], // north-west: elder (feast-elder-1)
    [0.38, -0.82]   // south-east: open welcoming guest seat!
  ];
  for (const [sx, sz] of stoolCoords) {
    const fl = surface(x + sx, z + sz);
    const sideStool = Math.abs(sx) > 0.7;
    if (sideStool) {
      baker.block([x + sx, fl + 0.30, z + sz], [0.32, 0.055, 0.42], P.wood);
      baker.block([x + sx, fl + 0.335, z + sz], [0.27, 0.016, 0.36], P.cushion);
      baker.block([x + sx, fl + 0.14, z + sz - 0.14], [0.24, 0.28, 0.06], P.dark);
      baker.block([x + sx, fl + 0.14, z + sz + 0.14], [0.24, 0.28, 0.06], P.dark);
    } else {
      baker.block([x + sx, fl + 0.30, z + sz], [0.42, 0.055, 0.32], P.wood);
      baker.block([x + sx, fl + 0.335, z + sz], [0.36, 0.016, 0.27], P.cushion);
      baker.block([x + sx - 0.14, fl + 0.14, z + sz], [0.06, 0.28, 0.24], P.dark);
      baker.block([x + sx + 0.14, fl + 0.14, z + sz], [0.06, 0.28, 0.24], P.dark);
    }
  }

  // 3. Wine jar, 4 warm wine bowls/ear-cups ("设酒"), bamboo chopsticks ("竹箸"),
  //    braised chicken platter & steaming millet tub ("杀鸡作食").
  const topY = tableH + 0.038;
  const jarFl = surface(x + 0.95, z + 0.46);
  baker.beam([x + 0.95, jarFl, z + 0.46], [x + 0.95, jarFl + 0.34, z + 0.46], 0.18, P.jar, 0.12, 8);
  baker.beam([x + 0.95, jarFl + 0.34, z + 0.46], [x + 0.95, jarFl + 0.42, z + 0.46], 0.10, P.matTrim, 0.11, 8);

  // Sculpted Qin-Han spouted ceramic wine ewer (长嘴执壶) with arched loop handle & domed stopper
  baker.beam(pt(0.28, topY, 0.20), pt(0.28, topY + 0.055, 0.20), 0.068, P.jar, 0.098, 8);
  baker.beam(pt(0.28, topY + 0.055, 0.20), pt(0.28, topY + 0.16, 0.20), 0.098, P.jar, 0.062, 8);
  baker.beam(pt(0.28, topY + 0.16, 0.20), pt(0.28, topY + 0.225, 0.20), 0.048, P.jar, 0.056, 8);
  baker.beam(pt(0.28, topY + 0.225, 0.20), pt(0.28, topY + 0.255, 0.20), 0.046, P.lacquer, 0.018, 8);
  // Spout & arched ear handle
  baker.beam(pt(0.21, topY + 0.12, 0.20), pt(0.14, topY + 0.20, 0.20), 0.018, P.jar, 0.010, 5);
  baker.beam(pt(0.34, topY + 0.19, 0.20), pt(0.39, topY + 0.15, 0.20), 0.012, P.dark, 0.012, 4);
  baker.beam(pt(0.39, topY + 0.15, 0.20), pt(0.35, topY + 0.075, 0.20), 0.012, P.dark, 0.012, 4);

  // 4 wine bowls / ear-cups (including guest bowl at [0.32, -0.30]) + 4 pairs of bamboo chopsticks
  const placeSettings = [
    { bx: 0.54, bz: -0.13, alongZ: true, czSign: 1 },   // east host
    { bx: -0.54, bz: -0.13, alongZ: true, czSign: -1 }, // west woman
    { bx: -0.35, bz: -0.30, alongZ: false, cxSign: -1 }, // north-west elder
    { bx: 0.32, bz: -0.30, alongZ: false, cxSign: 1 }   // south-east guest seat
  ];
  for (const ps of placeSettings) {
    const { bx, bz, alongZ } = ps;
    baker.ring(pt(bx, topY, bz), 0.078, 0.056, 0.054, P.bowl, 8);
    baker.beam(pt(bx, topY + 0.01, bz), pt(bx, topY + 0.042, bz), 0.055, P.wine, 0.055, 8);
    // Qin-Han ear-cup side handles (耳杯双耳)
    const earDim = alongZ ? [0.022, 0.010, 0.175] : [0.175, 0.010, 0.022];
    baker.block(pt(bx, topY + 0.042, bz), earDim, P.lacquer);

    // Pair of bamboo chopsticks (竹箸) resting on a tiny dark timber rest
    if (alongZ) {
      const cxOff = bx + (bx > 0 ? 0.11 : -0.11);
      baker.block(pt(cxOff, topY + 0.008, bz - 0.06), [0.036, 0.014, 0.016], P.dark);
      for (const sep of [-0.008, 0.008]) {
        baker.beam(
          pt(cxOff + sep, topY + 0.017, bz - 0.11),
          pt(cxOff + sep * 0.85, topY + 0.012, bz + 0.09),
          0.0048, P.chopstick, 0.0036, 4
        );
      }
    } else {
      const czOff = bz - 0.095;
      baker.block(pt(bx + 0.05, topY + 0.008, czOff), [0.016, 0.014, 0.036], P.dark);
      for (const sep of [-0.008, 0.008]) {
        baker.beam(
          pt(bx + 0.10, topY + 0.017, czOff + sep),
          pt(bx - 0.10, topY + 0.012, czOff + sep * 0.85),
          0.0048, P.chopstick, 0.0036, 4
        );
      }
    }
  }

  // Braised chicken platter ("杀鸡")
  baker.beam(pt(-0.02, topY, 0.03), pt(-0.02, topY + 0.035, 0.03), 0.21, P.platter, 0.24, 10);
  baker.peach(pt(-0.02, topY + 0.10, 0.03), [0.155, 0.092, 0.115], P.chicken);
  baker.peach(pt(0.10, topY + 0.08, 0.06), [0.058, 0.048, 0.052], P.chicken);
  baker.peach(pt(-0.13, topY + 0.08, -0.02), [0.066, 0.052, 0.048], P.chicken);

  // Steaming wooden millet tub ("作食")
  baker.ring(pt(-0.36, topY, 0.16), 0.165, 0.135, 0.12, P.wood, 10);
  baker.beam(pt(-0.36, topY + 0.02, 0.16), pt(-0.36, topY + 0.105, 0.16), 0.14, P.millet, 0.13, 10);

  // 4. Courtyard lantern post frame (stone plinth, braced cantilever arm, hexagonal pagoda roof hood & lattice cage)
  const lx = x - 1.38;
  const lz = z + 0.92;
  const lFl = surface(lx, lz);
  baker.beam([lx, lFl - 0.04, lz], [lx, lFl + 0.16, lz], 0.145, P.stone, 0.105, 6);
  baker.beam([lx, lFl + 0.10, lz], [lx, lFl + 1.62, lz], 0.056, P.lanternWood, 0.044, 6);
  baker.beam([lx, lFl + 1.60, lz], [lx, lFl + 1.68, lz], 0.068, P.dark, 0.028, 6);
  baker.beam([lx - 0.06, lFl + 1.50, lz], [lx + 0.39, lFl + 1.50, lz], 0.038, P.lanternWood, 0.032, 5);
  baker.beam([lx + 0.02, lFl + 1.22, lz], [lx + 0.26, lFl + 1.49, lz], 0.024, P.lanternWood, 0.022, 4);
  // Pagoda 6-sided eave hood, finial, 6 vertical dark cage ribs & lower tassel finial around silk core
  baker.beam([lx + 0.32, lFl + 1.38, lz], [lx + 0.32, lFl + 1.47, lz], 0.175, P.dark, 0.062, 6);
  baker.beam([lx + 0.32, lFl + 1.46, lz], [lx + 0.32, lFl + 1.52, lz], 0.035, P.lanternWood, 0.012, 6);
  baker.beam([lx + 0.32, lFl + 1.11, lz], [lx + 0.32, lFl + 1.15, lz], 0.095, P.dark, 0.112, 6);
  baker.beam([lx + 0.32, lFl + 1.02, lz], [lx + 0.32, lFl + 1.11, lz], 0.016, P.lacquer, 0.024, 5);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const rx = lx + 0.32 + Math.cos(a) * 0.096, rz = lz + Math.sin(a) * 0.096;
    baker.beam([rx, lFl + 1.14, rz], [rx, lFl + 1.39, rz], 0.010, P.dark, 0.010, 4);
  }
  addCollider(lx, lz, 0.16, 0.16, lFl, lFl + 1.65, 'feast-lantern');

  const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const staticMesh = baker.finish('solid', staticMat);
  staticMesh.name = 'hospitality-feast-static';
  group.add(staticMesh);
  baker.dispose();

  // Warm hexagonal silk lantern glow core (brightens at dusk/night, untouched by sky darkening)
  const lanternMat = new THREE.MeshBasicMaterial({ color: '#EAD39C' });
  lanternMat.userData.skyIgnore = true;
  const lanternGeo = new THREE.CylinderGeometry(0.095, 0.082, 0.25, 6);
  const lanternCore = new THREE.Mesh(lanternGeo, lanternMat);
  lanternCore.name = 'hospitality-feast-lantern-core';
  lanternCore.userData.dynamic = true;
  lanternCore.position.set(lx + 0.32, lFl + 1.26, lz);
  lanternCore.castShadow = false;
  group.add(lanternCore);

  // Rising opaque steam puffs above hot dishes
  const steamGeo = new THREE.IcosahedronGeometry(0.055, 0);
  const steamMat = new THREE.MeshLambertMaterial({ color: P.steam, flatShading: true });
  const steamCount = 6;
  const steamMesh = new THREE.InstancedMesh(steamGeo, steamMat, steamCount);
  steamMesh.name = 'hospitality-feast-steam';
  steamMesh.userData.dynamic = true;
  steamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  steamMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(x - 0.2, y + topY + 0.4, z + 0.1), 1.6);
  steamMesh.frustumCulled = true;
  group.add(steamMesh);
  const steamOrigins = [
    [x - 0.02, y + topY + 0.16, z + 0.03],
    [x - 0.36, y + topY + 0.14, z + 0.16]
  ];
  const steamM = new THREE.Matrix4();
  const steamP = new THREE.Vector3();
  const steamQ = new THREE.Quaternion();
  const steamS = new THREE.Vector3();

  // Open welcoming 4th stool for the player guest
  const guestSeat = {
    x: x + 0.38,
    y: surface(x + 0.38, z - 0.82),
    z: z - 0.82,
    seatY: 0.32,
    lookX: x - 0.08,
    lookY: y + 0.72,
    lookZ: z + 0.05
  };

  // 5. Three welcoming animated villagers seated on the three host stools ("乃大惊 / 乃不知有汉").
  const actorGroup = new THREE.Group();
  actorGroup.name = 'hospitality-feast-actors';
  actorGroup.userData.dynamic = true;
  group.add(actorGroup);
  const rig = options.actorRig ? options.actorRig.createChannel(actorGroup, 3) : createCommunityActors(actorGroup, 3);
  for (const child of actorGroup.children) child.userData.dynamic = true;

  const villagers = [
    {
      id: 'feast-host-0',
      key: 'c_feast-host-0',
      role: 'feast_host',
      voiceRole: 'villager',
      kind: 'villager',
      mode: 'sit',
      index: 0,
      x: x + 1.08,
      z: z - 0.15,
      aimX: x - 0.04,
      aimZ: z - 0.12,
      s: 1.0,
      phase: 0.2
    },
    {
      id: 'feast-elder-1',
      key: 'c_feast-elder-1',
      role: 'feast_elder',
      voiceRole: 'elder',
      kind: 'elder',
      mode: 'sit',
      index: 2,
      x: x - 0.38,
      z: z - 0.82,
      aimX: x - 0.12,
      aimZ: z + 0.06,
      s: 1.01,
      phase: 1.7
    },
    {
      id: 'feast-guest-2',
      key: 'c_feast-guest-2',
      role: 'feast_guest',
      voiceRole: 'woman',
      kind: 'villager',
      female: true,
      mode: 'sit',
      index: 4,
      x: x - 1.08,
      z: z - 0.15,
      aimX: x + 0.04,
      aimZ: z - 0.10,
      s: 0.96,
      phase: 3.1
    }
  ].map((v) => {
    const baseYaw = Math.atan2(v.aimX - v.x, v.aimZ - v.z);
    return {
      ...v,
      y: surface(v.x, v.z),
      baseYaw,
      yaw: baseYaw,
      greetTimer: 0,
      greetTarget: null
    };
  });

  let time = 0;
  let toastTimer = 0;
  let toastDuration = 4.2;
  let onTalk = null;
  let disposed = false;

  function placeHandCup(handPos, tiltX = 0) {
    const cx = handPos[0] - 0.02;
    const cy = handPos[1] + 0.032;
    const cz = handPos[2] + 0.035;
    rig.part('taper', [cx, cy, cz], [0.052, 0.044, 0.038], 0x8f3d2c, [tiltX, 0, 0]);
    rig.part('round', [cx, cy + 0.018, cz], [0.042, 0.010, 0.030], 0xc78d44, [tiltX, 0, 0]);
    rig.part('box', [cx, cy + 0.014, cz], [0.122, 0.008, 0.018], 0x6b2b1e, [tiltX, 0, 0]);
  }

  function poseActors(playerState) {
    rig.begin();
    const toastActive = toastTimer > 0 && toastDuration > 0;
    const toastU = toastActive ? Math.max(0, Math.min(1, 1 - toastTimer / toastDuration)) : 0;
    const toastK = toastActive
      ? (toastU < 0.18 ? smooth01(toastU / 0.18) : toastU > 0.78 ? smooth01((1 - toastU) / 0.22) : 1)
      : 0;
    const bowWave = toastActive ? Math.sin(Math.min(1, toastU / 0.58) * Math.PI) * toastK : 0;

    for (const v of villagers) {
      const guestYaw = Math.atan2(guestSeat.x - v.x, guestSeat.z - v.z);
      let idleTargetYaw = v.baseYaw;
      if (v.greetTimer > 0 && v.greetTarget) {
        idleTargetYaw = Math.atan2(v.greetTarget.x - v.x, v.greetTarget.z - v.z);
      } else if (playerState && Math.hypot(playerState.x - v.x, playerState.z - v.z) < 9.5) {
        const towardPlayer = wrapAngle(Math.atan2(playerState.x - v.x, playerState.z - v.z) - v.baseYaw);
        idleTargetYaw = v.baseYaw + Math.max(-0.58, Math.min(0.58, towardPlayer));
      }
      const targetYaw = toastK > 0.001
        ? idleTargetYaw + wrapAngle(guestYaw - idleTargetYaw) * toastK
        : idleTargetYaw;
      v.yaw += wrapAngle(targetYaw - v.yaw) * (toastK > 0.1 ? 0.20 : 0.14);

      // Root offset rests sculpted shoe soles flush atop the woven reed mat without sinking
      rig.actor(v.x, v.y + 0.002, v.z, v.yaw, v.s);

      const t = time * 1.42 + v.phase;
      const greetBoost = v.greetTimer > 0 ? 0.10 : 0;
      let headTurn = Math.sin(t * 0.65) * 0.18 * (1 - toastK * 0.75);
      let nod = Math.sin(t * 1.05) * 0.06 + greetBoost * Math.sin(t * 2.4) * 0.08;
      let lean = 0.08 + Math.sin(t * 0.75) * 0.025;
      let rightHand;
      let leftHand;

      if (v.role === 'feast_host') {
        // Host holds a lacquer ear-cup and gestures warmly across the table
        const lift = Math.max(0, Math.sin(t * 1.25)) * 0.07 + greetBoost;
        rightHand = [0.16, 0.73 + lift, 0.35];
        leftHand = [-0.19, 0.56 + Math.sin(t * 0.85) * 0.02, 0.27];
      } else if (v.role === 'feast_elder') {
        // Elder nods warmly, right hand stroking beard & gesturing gently
        const stroke = Math.sin(t * 1.15);
        nod += 0.05 + Math.max(0, stroke) * 0.04;
        rightHand = [0.05 + stroke * 0.03, 0.84 + Math.cos(t * 1.35) * 0.04, 0.29];
        leftHand = [-0.18, 0.55 + Math.sin(t * 0.7) * 0.02, 0.26];
      } else {
        // Woman tends the wine pot & warm dishes gracefully
        const reach = Math.max(0, Math.sin(t * 0.95));
        lean += reach * 0.04;
        rightHand = [0.15 - reach * 0.05, 0.66 + reach * 0.05, 0.33 + reach * 0.07];
        leftHand = [-0.17, 0.57 + Math.cos(t * 0.9) * 0.025, 0.28];
      }

      if (toastK > 0.001) {
        const pulse = Math.sin(toastU * Math.PI * 2.2) * 0.025 * toastK;
        const toastRight = [0.09, 0.89 + pulse, 0.41];
        const toastLeft = [-0.06, 0.81 + pulse, 0.36];
        rightHand = [
          rightHand[0] + (toastRight[0] - rightHand[0]) * toastK,
          rightHand[1] + (toastRight[1] - rightHand[1]) * toastK,
          rightHand[2] + (toastRight[2] - rightHand[2]) * toastK
        ];
        leftHand = [
          leftHand[0] + (toastLeft[0] - leftHand[0]) * toastK,
          leftHand[1] + (toastLeft[1] - leftHand[1]) * toastK,
          leftHand[2] + (toastLeft[2] - leftHand[2]) * toastK
        ];
        lean += 0.11 * bowWave;
        nod = nod * (1 - toastK) + (0.06 + 0.12 * bowWave);
      }

      rig.human(v, {
        crouch: 0.92,
        lean,
        walk: 0,
        headTurn,
        nod,
        left: leftHand,
        right: rightHand
      });

      if (v.role === 'feast_host' || toastK > 0.12) {
        placeHandCup(rightHand, -0.06 * bowWave);
      }
    }
    rig.finish();
  }

  function updateSteam(t) {
    for (let i = 0; i < steamCount; i++) {
      const origin = steamOrigins[i % steamOrigins.length];
      const u = (t * 0.42 + i / steamCount) % 1;
      steamP.set(
        origin[0] + Math.sin(t * 1.8 + i) * 0.05 * u,
        origin[1] + u * 0.46,
        origin[2] + Math.cos(t * 1.5 + i * 1.4) * 0.04 * u
      );
      const sc = Math.sin(u * Math.PI) * 0.9 + 0.12;
      steamS.set(sc, sc * 0.85, sc);
      steamM.compose(steamP, steamQ, steamS);
      steamMesh.setMatrixAt(i, steamM);
    }
    steamMesh.instanceMatrix.needsUpdate = true;
  }

  poseActors(null);
  updateSteam(0);

  const dayLanternColor = new THREE.Color('#EAD39C');
  const nightLanternColor = new THREE.Color('#FFCE7A');

  function triggerToast(dur = 4.2) {
    if (disposed) return false;
    toastDuration = Math.max(0.8, Number(dur) || 4.2);
    toastTimer = toastDuration;
    poseActors(null);
    return true;
  }

  function update(dt, _elapsed, sky, playerState) {
    if (disposed) return;
    const step = livingStep(dt);
    if (step > 0) {
      time += step;
      if (toastTimer > 0) toastTimer = Math.max(0, toastTimer - step);
      for (const v of villagers) {
        if (v.greetTimer > 0) v.greetTimer = Math.max(0, v.greetTimer - step);
      }
      poseActors(playerState);
      updateSteam(time);
    }
    const sv = sky?.getAppearance?.() || sky;
    const night = sv?.nightAmount ?? sv?.night ?? (sky?.timeId === 'dusk' ? 0.55 : sky?.timeId === 'night' ? 1 : 0);
    lanternMat.color.copy(dayLanternColor).lerp(nightLanternColor, Math.min(1, Math.max(0, night)));
  }

  function greet(id, px, pz, dur = 3) {
    const v = villagers.find((item) => item.id === id);
    if (!v) return false;
    v.greetTimer = Math.max(0.5, dur || 3);
    v.greetTarget = Number.isFinite(px) && Number.isFinite(pz) ? { x: px, z: pz } : null;
    onTalk?.(v);
    return true;
  }

  function getStats() {
    const staticTris = (staticMesh.geometry.index?.count || staticMesh.geometry.attributes.position.count) / 3;
    const lanternTris = lanternGeo.index ? lanternGeo.index.count / 3 : lanternGeo.attributes.position.count / 3;
    const steamTris = ((steamGeo.index?.count || steamGeo.attributes.position.count) / 3) * steamCount;
    const actorStats = rig.stats();
    return {
      built: true,
      villagers: villagers.length,
      toasting: toastTimer > 0,
      site: { ...site },
      guestSeat: { ...guestSeat },
      triangles: staticTris + lanternTris + steamTris + actorStats.triangles,
      drawCalls: 2 + (steamCount > 0 ? 1 : 0) + actorStats.drawCalls,
      time,
      disposed
    };
  }

  return {
    group,
    blockers,
    layout: {
      site,
      guestSeat,
      villagers: villagers.map(({ id, key, role, x: vx, y: vy, z: vz }) => ({ id, key, role, x: vx, y: vy, z: vz }))
    },
    setOnTalk(fn) { onTalk = typeof fn === 'function' ? fn : null; },
    getInteractables: () => (disposed ? [] : villagers),
    getGuestSeat: () => (disposed ? null : { ...guestSeat }),
    triggerToast,
    greet,
    update,
    getStats,
    dispose() {
      if (disposed) return;
      disposed = true;
      staticMesh.geometry.dispose();
      staticMat.dispose();
      lanternGeo.dispose();
      lanternMat.dispose();
      steamGeo.dispose();
      steamMat.dispose();
      rig.dispose();
      group.removeFromParent();
      onTalk = null;
    }
  };
}
