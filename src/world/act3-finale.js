import * as THREE from 'three';
import { createExteriorContext, exteriorSiteSafe } from './exterior-exploration.js';
import { createGroveBaker } from './leisure-grove-geometry.js';
import { roughRockGeometry } from './rock.js';
import { interactionAllowed } from '../systems/mysteries.js';

const MARKER_SPECS = [
  {
    id: 'mark-cave',
    seedPos: [19, 8],
    kind: 'cairn-bamboo',
    name: '洞口石堆竹标',
    label: '洞口石标',
    prompt: '处处志之 · 洞口叠石系竹（E）',
    line: '洞外山麓叠石斜竹为志，谨记此山口归途。',
    remnantLine: '洞外旧石犹在，苔色漫生，山口已杳入重岚。',
  },
  {
    id: 'mark-bend',
    seedPos: [-5, 28],
    kind: 'ribbon-stake',
    name: '溪弯红帛木桩',
    label: '溪畔木桩',
    prompt: '处处志之 · 溪畔系帛立桩（E）',
    line: '浅溪折湾处立木系帛，认取入山向路。',
    remnantLine: '木桩斜倾溪畔，旧帛微湿垂落，只余空水浮花。',
  },
  {
    id: 'mark-peach',
    seedPos: [-4, 72],
    kind: 'cairn-ribbon',
    name: '桃林系带竹枝',
    label: '桃林系带',
    prompt: '处处志之 · 桃枝系带为记（E）',
    line: '夹岸桃花尽处折竹系带，免教雾合忘却来津。',
    remnantLine: '断竹斜倚芳草，落英覆地成尘，向路微茫难辨。',
  },
  {
    id: 'mark-wuling',
    seedPos: [9, 128],
    kind: 'wooden-cairn',
    name: '下津叠石木标',
    label: '下津水标',
    prompt: '处处志之 · 津岸立标候渡（E）',
    line: '下津水岸叠石立标，记定此间船迹所止。',
    remnantLine: '津岸石标半没荒苔，春潮平漫，唯听松风竹影。',
  },
];

const FERRY_SPEC = {
  id: 'depart-ferry',
  seedPos: [13, 160],
  name: '下津扁舟 · 往诣太守',
  label: '出洞复寻',
  prompt: '顺溪出山 · 诣太守复寻（E）',
  line: '既出，得其船，便扶向路，处处志之。及郡下，诣太守……',
};

const SEAL_PALETTE = {
  rockLight: 0xaab0a3,
  rockMid: 0x899084,
  woodDark: '#6A533E',
  branchLight: '#85694E',
  moss: '#6F805E',
  petalMuted: '#C57B84',
};

const STAGE_ORDER = ['idle', 'marking', 'transitioning', 'returning', 'lost', 'epilogue', 'linger'];

function sampleField(field, x, z, fallback = 0) {
  if (field?.sample) return field.sample(x, z);
  if (field?.height) return field.height(x, z);
  return fallback;
}

function clampSlopeFlat(field, x, z) {
  if (field?.slope) return field.slope(x, z) < 0.55;
  if (!field?.sample && !field?.height) return true;
  const hx = Math.abs(sampleField(field, x + 1.1, z) - sampleField(field, x - 1.1, z));
  const hz = Math.abs(sampleField(field, x, z + 1.1) - sampleField(field, x, z - 1.1));
  return hx + hz < 1.25;
}

function pickSafeExteriorPos(seedX, seedZ, radius, ctx, slitX, slitZ, taken, maxRiverDist = 34) {
  const { field, distanceToRiver, waterLevel, extCtx, minZ = slitZ + 5, maxZ = 196 } = ctx;
  const candidateValid = (x, z) => {
    if (z < minZ || z > maxZ) return false;
    if (Math.hypot(x - slitX, z - slitZ) < 9.5) return false;
    for (const prev of taken) {
      if (Math.hypot(x - prev.x, z - prev.z) < 8) return false;
    }
    if (distanceToRiver) {
      const rd = distanceToRiver(x, z);
      if (rd < 2.2 || rd > maxRiverDist) return false;
    }
    if (field?.sample || field?.height) {
      const h = sampleField(field, x, z, NaN);
      if (!Number.isFinite(h) || h < waterLevel + 0.38 || h > waterLevel + 10) return false;
    }
    if (!clampSlopeFlat(field, x, z)) return false;
    if (extCtx) {
      return exteriorSiteSafe(x, z, radius, extCtx, false);
    }
    return true;
  };

  if (candidateValid(seedX, seedZ)) {
    return { x: seedX, y: sampleField(field, seedX, seedZ, waterLevel + 0.8), z: seedZ };
  }

  for (const ring of [1.8, 3.6, 5.5, 7.5, 9.8, 12.2, 15]) {
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const cx = seedX + Math.cos(ang) * ring;
      const cz = seedZ + Math.sin(ang) * ring;
      if (candidateValid(cx, cz)) {
        return { x: cx, y: sampleField(field, cx, cz, waterLevel + 0.8), z: cz };
      }
    }
  }

  const fbY = sampleField(field, seedX, seedZ, waterLevel + 0.8);
  return { x: seedX, y: Number.isFinite(fbY) ? fbY : waterLevel + 0.8, z: seedZ };
}

function buildMarkerGeometries(spec, solidMat, ribbonMat, ringMat, petalMat) {
  const guideGroup = new THREE.Group();
  guideGroup.name = `act3-guide-${spec.id}`;

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.64, 24), ringMat);
  ring.rotation.x = -Math.PI * 0.5;
  ring.position.y = 0.05;
  ring.userData.skyIgnore = true;
  guideGroup.add(ring);

  const guideBaker = createGroveBaker();
  guideBaker.block([0, 0.08, 0], [0.22, 0.14, 0.18], '#8B8F85', [0, 0.25, 0]);
  guideBaker.beam([0.08, 0.02, 0.02], [0.10, 0.44, 0.03], 0.02, '#7D8B5B', 0.015, 6);
  const guideMesh = guideBaker.finish('guide', solidMat);
  guideBaker.dispose();
  if (guideMesh) {
    guideMesh.name = `act3-guide-mesh-${spec.id}`;
    guideGroup.add(guideMesh);
  }

  // Placed cairn / stake + waving red cloth ribbons
  const placedGroup = new THREE.Group();
  placedGroup.name = `act3-placed-${spec.id}`;
  placedGroup.visible = false;

  const placedBaker = createGroveBaker();
  placedBaker.block([0, 0.12, 0], [0.42, 0.22, 0.36], '#8C9187', [0, 0.2, 0]);
  placedBaker.block([0.04, 0.28, -0.02], [0.30, 0.15, 0.26], '#9BA095', [0, -0.35, 0]);
  placedBaker.block([-0.03, 0.40, 0.02], [0.20, 0.11, 0.18], '#AEB2A6', [0, 0.55, 0]);

  if (spec.kind === 'ribbon-stake' || spec.kind === 'wooden-cairn') {
    placedBaker.beam([0.14, 0.04, 0.06], [0.18, 1.32, 0.04], 0.045, '#6F543D', 0.032, 7);
    placedBaker.beam([0.16, 1.05, 0.04], [0.36, 1.18, 0.02], 0.022, '#7D6046', 0.014, 6);
  } else {
    placedBaker.beam([-0.10, 0.04, -0.04], [-0.04, 1.38, 0.06], 0.032, '#748758', 0.022, 7);
    placedBaker.beam([-0.05, 1.12, 0.03], [0.16, 1.32, 0.12], 0.018, '#879868', 0.010, 6);
  }
  const placedMesh = placedBaker.finish('placed', solidMat);
  placedBaker.dispose();
  if (placedMesh) {
    placedMesh.name = `act3-placed-mesh-${spec.id}`;
    placedMesh.castShadow = false;
    placedMesh.receiveShadow = true;
    placedGroup.add(placedMesh);
  }

  const ribbonGeoA = new THREE.PlaneGeometry(0.11, 0.44);
  ribbonGeoA.translate(0.04, -0.22, 0);
  const ribbonA = new THREE.Mesh(ribbonGeoA, ribbonMat);
  ribbonA.name = `act3-ribbon-a-${spec.id}`;
  if (spec.kind === 'ribbon-stake' || spec.kind === 'wooden-cairn') {
    ribbonA.position.set(0.28, 1.12, 0.03);
  } else {
    ribbonA.position.set(0.08, 1.24, 0.09);
  }
  placedGroup.add(ribbonA);

  const ribbonGeoB = new THREE.PlaneGeometry(0.085, 0.34);
  ribbonGeoB.translate(-0.03, -0.17, 0);
  const ribbonB = new THREE.Mesh(ribbonGeoB, ribbonMat);
  ribbonB.name = `act3-ribbon-b-${spec.id}`;
  ribbonB.position.copy(ribbonA.position);
  ribbonB.rotation.y = 0.7;
  placedGroup.add(ribbonB);

  // Weathered remnant for return search
  const remnantGroup = new THREE.Group();
  remnantGroup.name = `act3-remnant-${spec.id}`;
  remnantGroup.visible = false;

  const remBaker = createGroveBaker();
  remBaker.block([-0.08, 0.09, 0.04], [0.34, 0.16, 0.28], '#7D8478', [0, 0.5, 0]);
  remBaker.block([0.16, 0.07, -0.12], [0.22, 0.12, 0.20], '#6F776A', [0, -0.4, 0]);
  remBaker.beam([-0.04, 0.06, 0.02], [0.34, 0.22, 0.18], 0.026, '#766A52', 0.015, 6);
  const remMesh = remBaker.finish('remnant', solidMat);
  remBaker.dispose();
  if (remMesh) {
    remMesh.name = `act3-remnant-mesh-${spec.id}`;
    remnantGroup.add(remMesh);
  }

  const petalCluster = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.055 + (i % 2) * 0.02, 6), petalMat);
    p.rotation.x = -Math.PI * 0.5;
    p.rotation.z = i * 0.9;
    p.position.set(Math.cos(i * 1.7) * 0.28, 0.035 + (i % 2) * 0.01, Math.sin(i * 1.7) * 0.24);
    petalCluster.add(p);
  }
  remnantGroup.add(petalCluster);

  return { guideGroup, placedGroup, remnantGroup, ring, ribbons: [ribbonA, ribbonB] };
}

function buildDepartFerryGroup(solidMat, ringMat, ribbonMat) {
  const grp = new THREE.Group();
  grp.name = 'act3-depart-ferry';
  grp.visible = false;

  const baker = createGroveBaker();
  baker.beam([0, -0.12, 0], [0.02, 1.34, 0], 0.06, '#6B523B', 0.048, 8);
  baker.block([0, 0.08, 0], [0.46, 0.16, 0.46], '#898E84', [0, 0.15, 0]);
  baker.ring([0.02, 0.92, 0], 0.095, 0.062, 0.09, '#9C8256', 10);
  const mesh = baker.finish('depart-post', solidMat);
  baker.dispose();
  if (mesh) {
    mesh.name = 'act3-depart-post-mesh';
    grp.add(mesh);
  }

  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.42), ribbonMat);
  flag.name = 'act3-depart-pennant';
  flag.position.set(0.11, 1.12, 0);
  grp.add(flag);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.94, 28), ringMat);
  ring.rotation.x = -Math.PI * 0.5;
  ring.position.y = 0.06;
  ring.userData.skyIgnore = true;
  grp.add(ring);

  return { grp, ring, flag };
}

function buildCaveSealGroup(solidMat, rockLightMat, rockMidMat, mistMat) {
  const sealGroup = new THREE.Group();
  sealGroup.name = 'act3-cave-seal';
  sealGroup.userData.dynamic = true;
  sealGroup.visible = false;

  const rockGeos = [
    roughRockGeometry(41, 1, 0.24),
    roughRockGeometry(83, 1, 0.28),
    roughRockGeometry(127, 1, 0.22),
  ];

  // Interlocking talus boulders filling the cliff aperture along local X (width) & Z (depth)
  const rockLayouts = [
    [-2.1, 0.4, 0.2, 2.0, 2.3, 1.9, 0.2, 0],
    [0.1, 0.7, -0.3, 2.3, 2.6, 2.1, -0.3, 1],
    [2.1, 0.5, 0.3, 1.9, 2.2, 1.8, 0.5, 2],
    [-1.1, 2.3, -0.1, 1.8, 2.1, 1.7, 0.8, 1],
    [1.2, 2.4, 0.1, 1.7, 2.0, 1.7, -0.7, 0],
    [0.0, 3.8, 0.2, 1.6, 1.6, 1.5, 0.4, 2],
    [-2.8, -0.3, 0.9, 1.5, 1.4, 1.4, 1.1, 2],
    [2.7, -0.2, 0.8, 1.5, 1.4, 1.5, -0.9, 0],
  ];

  for (let i = 0; i < rockLayouts.length; i++) {
    const [rx, ry, rz, sx, sy, sz, rotY, geoIdx] = rockLayouts[i];
    const m = new THREE.Mesh(rockGeos[geoIdx], i % 2 === 0 ? rockLightMat : rockMidMat);
    m.name = `act3-seal-rock-${i}`;
    m.position.set(rx, ry, rz);
    m.scale.set(sx, sy, sz);
    m.rotation.set(0.12 * (i % 3 - 1), rotY, 0.08 * (i % 2 ? 1 : -1));
    m.castShadow = false;
    m.receiveShadow = true;
    sealGroup.add(m);
  }

  // Overgrown mountain vine / peach-bark tangles & moss across sealed talus
  const baker = createGroveBaker();
  baker.beam([-2.6, 0.2, 1.1], [2.4, 2.7, 1.0], 0.12, SEAL_PALETTE.woodDark, 0.06, 7);
  baker.beam([2.4, 0.1, 1.2], [-2.1, 3.2, 0.8], 0.10, SEAL_PALETTE.branchLight, 0.05, 7);
  baker.beam([-0.8, -0.2, 1.5], [1.4, 1.8, 1.2], 0.07, SEAL_PALETTE.woodDark, 0.04, 6);
  baker.block([-1.4, 1.5, 1.25], [1.1, 0.45, 0.65], SEAL_PALETTE.moss, [0, 0.3, 0]);
  baker.block([1.2, 1.7, 1.2], [1.0, 0.42, 0.6], SEAL_PALETTE.moss, [0, -0.4, 0]);
  baker.peach([-1.1, 2.4, 1.35], [0.22, 0.16, 0.22], SEAL_PALETTE.petalMuted);
  baker.peach([1.5, 2.0, 1.35], [0.20, 0.14, 0.20], SEAL_PALETTE.petalMuted);
  const floraMesh = baker.finish('seal-flora', solidMat);
  baker.dispose();
  if (floraMesh) {
    floraMesh.name = 'act3-seal-flora';
    sealGroup.add(floraMesh);
  }

  const mistSheets = [];
  const mistGeo = new THREE.PlaneGeometry(9.6, 5.8);
  for (let i = 0; i < 4; i++) {
    const mist = new THREE.Mesh(mistGeo, mistMat);
    mist.name = `act3-seal-mist-${i}`;
    mist.userData.skyIgnore = true;
    const baseZ = 1.65 + i * 0.72;
    const baseY = 1.9 + (i % 2) * 0.65;
    const baseX = (i - 1.5) * 0.65;
    mist.position.set(baseX, baseY, baseZ);
    mist.rotation.y = (i - 1.5) * 0.08;
    sealGroup.add(mist);
    mistSheets.push({ mesh: mist, baseX, baseY, phase: i * 1.35 });
  }

  return { sealGroup, rockGeos, mistGeo, mistSheets };
}

function buildLoneProofCup(solidMat, ringMat) {
  const cupGroup = new THREE.Group();
  cupGroup.name = 'act3-lone-proof-cup';
  cupGroup.userData.dynamic = true;
  cupGroup.visible = false;

  const baker = createGroveBaker();
  // Qin-Han vermilion-and-black lacquer ear-cup (朱黑漆耳杯 · 羽觞) cradling two fallen peach petals
  baker.ring([0, 0.018, 0], 0.135, 0.088, 0.052, '#8F362C', 10);
  baker.beam([0, 0.008, 0], [0, 0.032, 0], 0.095, '#2A1D1B', 0.098, 10);
  baker.block([-0.142, 0.040, 0], [0.044, 0.014, 0.165], '#A64134');
  baker.block([0.142, 0.040, 0], [0.044, 0.014, 0.165], '#A64134');
  baker.peach([0.025, 0.046, 0.018], [0.032, 0.011, 0.026], '#EAAAB4');
  baker.peach([-0.024, 0.044, -0.024], [0.028, 0.010, 0.022], '#F4C4CC');
  const cupMesh = baker.finish('lone-cup', solidMat);
  baker.dispose();
  if (cupMesh) {
    cupMesh.name = 'act3-lone-cup-mesh';
    cupGroup.add(cupMesh);
  }

  const wakeGeo = new THREE.RingGeometry(0.18, 0.28, 18);
  const wakeRing = new THREE.Mesh(wakeGeo, ringMat);
  wakeRing.name = 'act3-lone-cup-wake';
  wakeRing.rotation.x = -Math.PI * 0.5;
  wakeRing.position.y = 0.012;
  wakeRing.userData.skyIgnore = true;
  cupGroup.add(wakeRing);

  return { cupGroup, wakeRing, wakeGeo };
}

export function createAct3Finale(options = {}) {
  const {
    world = {},
    field = null,
    distanceToRiver = null,
    riverCurve = null,
    flora = [],
    boats = [],
    cliff = null,
    waterLevel = world?.waterLevel ?? -1,
    targetBlockers = null,
  } = options;

  const portal = world?.terrain?.portal;
  const slitX = Number.isFinite(portal?.x) ? portal.x : (cliff?.slit?.x ?? 22.892);
  const slitZ = Number.isFinite(portal?.z) ? portal.z : (cliff?.slit?.z ?? -8.192);
  const rawUx = Number.isFinite(portal?.ux) ? portal.ux : -0.0538;
  const rawUz = Number.isFinite(portal?.uz) ? portal.uz : 0.9985;
  const uLen = Math.hypot(rawUx, rawUz) || 1;
  const ux = rawUx / uLen;
  const uz = rawUz / uLen;
  const slitRot = Math.atan2(ux, uz);
  const slitY = sampleField(field, slitX + ux * 1.4, slitZ + uz * 1.4, waterLevel + 0.5);

  const extCtx = field && distanceToRiver && riverCurve
    ? createExteriorContext(world, field, distanceToRiver, riverCurve, flora, boats, cliff)
    : null;
  const placementCtx = { field, distanceToRiver, waterLevel, extCtx, minZ: slitZ + 6, maxZ: 196 };

  const group = new THREE.Group();
  group.name = 'act3-finale';
  group.userData.dynamic = true;

  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const ribbonMat = new THREE.MeshLambertMaterial({ color: 0xc94e38, side: THREE.DoubleSide });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf4cf7e,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  ringMat.userData = { skyIgnore: true };
  const petalMat = new THREE.MeshLambertMaterial({ color: 0xd99297, side: THREE.DoubleSide });
  const rockLightMat = new THREE.MeshLambertMaterial({ color: SEAL_PALETTE.rockLight, flatShading: true });
  const rockMidMat = new THREE.MeshLambertMaterial({ color: SEAL_PALETTE.rockMid, flatShading: true });
  const mistMat = new THREE.MeshBasicMaterial({
    color: 0xdde5e0,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  mistMat.userData = { skyIgnore: true };

  const takenSpots = [];
  const markers = MARKER_SPECS.map((spec) => {
    const pos = pickSafeExteriorPos(spec.seedPos[0], spec.seedPos[1], 0.9, placementCtx, slitX, slitZ, takenSpots);
    takenSpots.push(pos);
    const visuals = buildMarkerGeometries(spec, solidMat, ribbonMat, ringMat, petalMat);
    const siteGroup = new THREE.Group();
    siteGroup.name = `act3-site-${spec.id}`;
    siteGroup.position.set(pos.x, pos.y, pos.z);
    siteGroup.add(visuals.guideGroup, visuals.placedGroup, visuals.remnantGroup);
    group.add(siteGroup);
    return {
      ...spec,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      placed: false,
      siteGroup,
      ...visuals,
    };
  });

  const ferryPos = pickSafeExteriorPos(FERRY_SPEC.seedPos[0], FERRY_SPEC.seedPos[1], 1.2, placementCtx, slitX, slitZ, takenSpots, 24);
  takenSpots.push(ferryPos);
  const ferryVisuals = buildDepartFerryGroup(solidMat, ringMat, ribbonMat);
  ferryVisuals.grp.position.set(ferryPos.x, ferryPos.y, ferryPos.z);
  group.add(ferryVisuals.grp);
  const departSite = { ...FERRY_SPEC, x: ferryPos.x, y: ferryPos.y, z: ferryPos.z, ...ferryVisuals };

  const returnSpawn = pickSafeExteriorPos(16, 152, 1.4, placementCtx, slitX, slitZ, [], 26);

  // Pre-allocated seal blocker pushed into targetBlockers BEFORE createBarrier freezes collider list length
  const sealedCenterX = slitX + ux * 1.1;
  const sealedCenterZ = slitZ + uz * 1.1;
  const sealBlocker = {
    x: 99999,
    z: 99999,
    hw: 0,
    hd: 0,
    rot: slitRot,
    minY: -1000,
    maxY: -999,
    source: 'act3-cave-seal',
  };
  const blockers = [sealBlocker];
  if (Array.isArray(targetBlockers)) targetBlockers.push(sealBlocker);

  const sealBuilt = buildCaveSealGroup(solidMat, rockLightMat, rockMidMat, mistMat);
  sealBuilt.sealGroup.position.set(slitX + ux * 0.4, (Number.isFinite(slitY) ? slitY : waterLevel) - 0.55, slitZ + uz * 0.4);
  sealBuilt.sealGroup.rotation.y = slitRot;
  group.add(sealBuilt.sealGroup);

  const loneCupBuilt = buildLoneProofCup(solidMat, ringMat);
  group.add(loneCupBuilt.cupGroup);

  const runtime = {
    stage: 'idle',
    stageTimer: 0,
    cupPhase: 0,
    cupX: slitX + ux * 12,
    cupZ: slitZ + uz * 12,
    epilogueDelay: 0,
    placedIds: new Set(),
    visitedValleyDeep: false,
    experiencedVillageLife: false,
    autoMarkDialogueFired: false,
    noteTimer: 0,
    savedWeatherId: null,
    disposed: false,
    refs: {
      doc: null,
      player: null,
      dialogue: null,
      mysteries: null,
      riverSkiff: null,
      caveGleam: null,
      openingCurtain: null,
      sky: null,
      sound: null,
      journal: null,
      camera: null,
    },
  };

  function setSealActive(active) {
    sealBuilt.sealGroup.visible = Boolean(active);
    if (active) {
      sealBlocker.x = sealedCenterX;
      sealBlocker.z = sealedCenterZ;
      sealBlocker.hw = 4.6;
      sealBlocker.hd = 3.2;
      sealBlocker.rot = slitRot;
      sealBlocker.minY = (Number.isFinite(slitY) ? slitY : waterLevel) - 2.0;
      sealBlocker.maxY = (Number.isFinite(slitY) ? slitY : waterLevel) + 7.5;
    } else {
      sealBlocker.x = 99999;
      sealBlocker.z = 99999;
      sealBlocker.hw = 0;
      sealBlocker.hd = 0;
      sealBlocker.minY = -1000;
      sealBlocker.maxY = -999;
    }
  }

  function showNote(text, duration = 4.6) {
    const doc = runtime.refs.doc;
    const note = doc?.getElementById?.('mystery-note');
    if (!note || !text) return;
    note.textContent = text;
    note.dataset.owner = 'act3';
    note.classList.add('show');
    runtime.noteTimer = duration;
  }

  function clearNoteIfAct3() {
    const note = runtime.refs.doc?.getElementById?.('mystery-note');
    if (!note || note.dataset.owner !== 'act3') return;
    note.classList.remove('show');
    delete note.dataset.owner;
    runtime.noteTimer = 0;
  }

  function syncSiteVisuals() {
    const isMarking = runtime.stage === 'marking';
    const isPostReturn = runtime.stage === 'returning' || runtime.stage === 'lost' || runtime.stage === 'epilogue' || runtime.stage === 'linger';
    const placedReady = runtime.placedIds.size >= 2;

    for (const m of markers) {
      const hasPlaced = runtime.placedIds.has(m.id);
      if (isMarking) {
        m.guideGroup.visible = !hasPlaced;
        m.placedGroup.visible = hasPlaced;
        m.remnantGroup.visible = false;
      } else if (isPostReturn) {
        m.guideGroup.visible = false;
        m.placedGroup.visible = false;
        m.remnantGroup.visible = hasPlaced || m.id === 'mark-cave' || m.id === 'mark-bend';
      } else {
        m.guideGroup.visible = false;
        m.placedGroup.visible = false;
        m.remnantGroup.visible = false;
      }
    }
    departSite.grp.visible = (isMarking && placedReady) || runtime.stage === 'linger';
    loneCupBuilt.cupGroup.visible = isPostReturn;
    if (isPostReturn) positionLoneCup(runtime.cupPhase);
    setSealActive(isPostReturn);
  }

  function positionLoneCup(phase) {
    const u = ((phase % 1) + 1) % 1;
    let cx = slitX + ux * (11.5 + u * 44.0);
    let cz = slitZ + uz * (11.5 + u * 44.0);
    if (riverCurve?.getPointAt) {
      // Headwaters near cave slit is ~0.90; drift downstream toward ~0.72
      const curveT = 0.90 - u * 0.18;
      const pt = riverCurve.getPointAt(Math.max(0.08, Math.min(0.92, curveT)));
      cx = pt.x + Math.sin(u * Math.PI * 3.0) * 0.45;
      cz = pt.z + Math.cos(u * Math.PI * 2.0) * 0.25;
    }
    runtime.cupX = cx;
    runtime.cupZ = cz;
    const wy = waterLevel + 0.024 + Math.sin(phase * Math.PI * 8.0) * 0.012;
    loneCupBuilt.cupGroup.position.set(cx, wy, cz);
    loneCupBuilt.cupGroup.rotation.set(
      Math.sin(phase * Math.PI * 6.0) * 0.05,
      phase * Math.PI * 3.2,
      Math.cos(phase * Math.PI * 5.0) * 0.05
    );
    const fadeEnv = u < 0.08 ? u / 0.08 : (u > 0.88 ? (1 - u) / 0.12 : 1);
    const sc = Math.max(0.001, fadeEnv);
    loneCupBuilt.cupGroup.scale.setScalar(sc);
    const ringPulse = 0.85 + 0.35 * ((phase * 4.0) % 1);
    loneCupBuilt.wakeRing.scale.set(ringPulse, ringPulse, 1);
  }

  function dreamReturnToValley(destPose = null) {
    if (runtime.disposed) return false;
    const { sound, openingCurtain, player, camera } = runtime.refs;
    try {
      sound?.unlock?.();
      sound?.guqinPluck?.(departSite.x, departSite.z, 2);
      sound?.waterCup?.(departSite.x, departSite.z);
    } catch (_) {}

    const applyUnseal = () => {
      reset({ respawn: false, resetDialogue: false });
      const st = player?.state;
      if (st) {
        const tx = Number.isFinite(destPose?.x) ? destPose.x : 24.0;
        const tz = Number.isFinite(destPose?.z) ? destPose.z : -56.0;
        st.aboardSkiff = false;
        st.still = false;
        st.vx = 0;
        st.vz = 0;
        st.x = tx;
        st.z = tz;
        st.y = sampleField(field, tx, tz, 0.5);
        const yaw = Number.isFinite(destPose?.yaw) ? destPose.yaw : 0.05;
        st.yaw = yaw;
        st.targetYaw = yaw;
        st.camYaw = yaw;
        st.pitch = -0.02;
        st.targetPitch = -0.02;
        st.camPitch = -0.02;
        player.clearInput?.();
        if (camera) player.syncCamera?.(camera);
      }
    };

    if (openingCurtain?.triggerInkTransition && !destPose) {
      openingCurtain.triggerInkTransition({
        seal: '梦返桃源',
        classic: '系舟芳草岸，一枕武陵春。\n云散石门启，重入画中人。',
        plain: '孤舟系岸，烟岚徐开，循旧梦重返桃源四时闲居。',
        holdMs: 1800,
        onMidpoint: applyUnseal,
        onComplete: () => {
          showNote('山岚散尽，豁然复入桃源闲居。', 4.6);
        },
      });
    } else {
      applyUnseal();
      if (!destPose) showNote('山岚散尽，豁然复入桃源闲居。', 4.6);
    }
    return true;
  }

  function placeMarker(marker, silent = false) {
    if (!marker || runtime.placedIds.has(marker.id)) return false;
    runtime.placedIds.add(marker.id);
    syncSiteVisuals();
    if (!silent) {
      try {
        runtime.refs.sound?.unlock?.();
        runtime.refs.sound?.wood?.(marker.x, marker.z);
        runtime.refs.sound?.gatherSound?.('cloth', marker.x, marker.z);
      } catch (_) {}
      showNote(marker.line, 4.6);
    }
    if (!runtime.autoMarkDialogueFired) {
      runtime.autoMarkDialogueFired = true;
      runtime.refs.dialogue?.trigger?.('act3-mark-trail');
    }
    return true;
  }

  function enterMarking() {
    if (runtime.stage !== 'idle') return;
    runtime.stage = 'marking';
    runtime.stageTimer = 0;
    syncSiteVisuals();
    runtime.refs.dialogue?.trigger?.('act3-farewell');
    try {
      runtime.refs.sound?.unlock?.();
      runtime.refs.sound?.voice?.('elder', slitX, slitZ - 6);
    } catch (_) {}
    showNote('辞别桃源，沿外溪畔行经石木标处可按 E 处处志之。', 5.2);
  }

  function applyReturnWorldShift(opts = {}) {
    const { player, riverSkiff, sky, caveGleam, camera } = runtime.refs;
    if (riverSkiff?.isAboard?.()) {
      riverSkiff.disembark?.();
    }
    if (opts.reposition !== false && player?.state) {
      const st = player.state;
      st.aboardSkiff = false;
      st.still = false;
      st.vx = 0;
      st.vz = 0;
      st.x = returnSpawn.x;
      st.z = returnSpawn.z;
      st.y = sampleField(field, returnSpawn.x, returnSpawn.z, returnSpawn.y);
      const lookYaw = Math.atan2(-(slitX - returnSpawn.x), -(slitZ - returnSpawn.z));
      st.yaw = lookYaw;
      st.targetYaw = lookYaw;
      st.camYaw = lookYaw;
      st.pitch = -0.02;
      st.targetPitch = -0.02;
      st.camPitch = -0.02;
      player.clearInput?.();
      if (camera) player.syncCamera?.(camera);
    }
    if (sky?.setWeather) {
      if (!runtime.savedWeatherId) runtime.savedWeatherId = sky.weatherId || 'clear';
      sky.setWeather('mist');
    }
    caveGleam?.setSuppressed?.(true);
    setSealActive(true);
    syncSiteVisuals();
  }

  function finishReturnTransition() {
    if (runtime.disposed) return;
    runtime.stage = 'returning';
    runtime.stageTimer = 0;
    syncSiteVisuals();
    showNote('循向所志溯流复寻，烟水迷离，试往山口觅津。', 5.0);
  }

  function startPrefectReturn() {
    if (runtime.stage !== 'marking' && runtime.stage !== 'idle') return;
    runtime.stage = 'transitioning';
    runtime.stageTimer = 0;
    runtime.refs.dialogue?.trigger?.('act3-prefect-return');
    try {
      const st = runtime.refs.player?.state;
      const sx = st?.x ?? departSite.x;
      const sz = st?.z ?? departSite.z;
      runtime.refs.sound?.unlock?.();
      runtime.refs.sound?.guqinPluck?.(sx, sz, 0);
      runtime.refs.sound?.bell?.(sx, sz);
    } catch (_) {}

    const curtain = runtime.refs.openingCurtain;
    if (curtain?.triggerInkTransition) {
      curtain.triggerInkTransition({
        seal: '太守复寻',
        classic: '既出，得其船，便扶向路，处处志之。\n及郡下，诣太守，说如此。\n太守即遣人随其往，寻向所志——',
        plain: '既出桃花源，乃诣太守陈说始末。\n太守即刻遣人循向所志溯流复寻。',
        holdMs: 2500,
        onMidpoint: () => applyReturnWorldShift(),
        onComplete: () => finishReturnTransition(),
      });
    } else {
      applyReturnWorldShift();
      finishReturnTransition();
    }
  }

  function enterLinger() {
    if (runtime.disposed) return;
    runtime.stage = 'linger';
    runtime.stageTimer = 0;
    runtime.refs.openingCurtain?.hideEpilogue?.();
    syncSiteVisuals();
    showNote('南阳既远，无复问津者。唯留烟溪漫步，山口可重观终章。', 4.8);
  }

  function enterEpilogue() {
    if (runtime.disposed) return;
    runtime.stage = 'epilogue';
    runtime.stageTimer = 0;
    runtime.epilogueDelay = 0;
    syncSiteVisuals();
    runtime.refs.dialogue?.trigger?.('act3-no-seeker');
    runtime.refs.openingCurtain?.showEpilogue?.({
      onLinger: () => enterLinger(),
      onReplay: () => reset({ respawn: true }),
    });
  }

  function enterLost() {
    if (runtime.stage !== 'returning') return;
    runtime.stage = 'lost';
    runtime.stageTimer = 0;
    runtime.epilogueDelay = 4.6;
    syncSiteVisuals();
    runtime.refs.dialogue?.trigger?.('act3-lost-way');
    try {
      runtime.refs.sound?.unlock?.();
      runtime.refs.sound?.bell?.(slitX, slitZ);
    } catch (_) {}
  }

  function reset(opts = {}) {
    const { riverSkiff, player, sky, caveGleam, openingCurtain, dialogue, camera } = runtime.refs;
    const prevStage = runtime.stage;
    openingCurtain?.hideEpilogue?.();
    openingCurtain?.resetValleyBloom?.();

    runtime.stage = 'idle';
    runtime.stageTimer = 0;
    runtime.epilogueDelay = 0;
    runtime.placedIds.clear();
    runtime.visitedValleyDeep = false;
    runtime.experiencedVillageLife = false;
    runtime.autoMarkDialogueFired = false;
    clearNoteIfAct3();

    if (sky?.setWeather && runtime.savedWeatherId) {
      sky.setWeather(runtime.savedWeatherId);
      runtime.savedWeatherId = null;
    } else if (sky?.setWeather && prevStage !== 'idle') {
      sky.setWeather('clear');
    }
    caveGleam?.reset?.();
    syncSiteVisuals();

    if (opts.respawn !== false && player?.state) {
      if (riverSkiff?.isAboard?.()) riverSkiff.disembark?.();
      const sp = world?.player?.spawn || world?.spawn || { x: 26, z: 204 };
      const st = player.state;
      st.aboardSkiff = false;
      st.still = false;
      st.vx = 0;
      st.vz = 0;
      st.x = sp.x;
      st.z = sp.z;
      st.y = sampleField(field, sp.x, sp.z, 0);
      const lookYaw = Math.atan2(-(slitX - sp.x), -(slitZ - sp.z));
      st.yaw = lookYaw;
      st.targetYaw = lookYaw;
      st.camYaw = lookYaw;
      st.pitch = 0;
      st.targetPitch = 0;
      st.camPitch = 0;
      player.clearInput?.();
      if (camera) player.syncCamera?.(camera);
    }

    if (opts.resetDialogue !== false && (prevStage !== 'idle' || opts.respawn)) {
      dialogue?.reset?.(player?.state);
    }
  }

  function advanceToStage(targetStage, opts = {}) {
    if (!STAGE_ORDER.includes(targetStage)) return false;
    if (targetStage === 'idle') {
      reset({ respawn: opts.respawn === true, resetDialogue: opts.resetDialogue !== false });
      return true;
    }
    runtime.visitedValleyDeep = true;
    runtime.experiencedVillageLife = true;
    if (targetStage === 'marking') {
      runtime.refs.openingCurtain?.hideEpilogue?.();
      runtime.stage = 'marking';
      runtime.stageTimer = 0;
      runtime.refs.caveGleam?.reset?.();
      syncSiteVisuals();
      return true;
    }
    if (targetStage === 'transitioning') {
      runtime.stage = 'marking';
      for (const m of markers.slice(0, 2)) runtime.placedIds.add(m.id);
      startPrefectReturn();
      return true;
    }
    // Returning / lost / epilogue / linger share post-return world state
    for (const m of markers.slice(0, 2)) runtime.placedIds.add(m.id);
    runtime.stage = targetStage;
    runtime.stageTimer = 0;
    applyReturnWorldShift({ reposition: opts.reposition !== false });
    if (targetStage === 'lost') {
      runtime.epilogueDelay = opts.epilogueDelay ?? 4.6;
      runtime.refs.dialogue?.trigger?.('act3-lost-way');
    } else if (targetStage === 'epilogue') {
      enterEpilogue();
    } else if (targetStage === 'linger') {
      enterLinger();
    }
    return true;
  }

  function pickAct3Target(camera) {
    if (runtime.disposed) return null;
    const { doc, player, openingCurtain } = runtime.refs;
    const isTrans = typeof openingCurtain?.isTransitioning === 'function'
      ? openingCurtain.isTransitioning()
      : Boolean(openingCurtain?.isTransitioning);
    const isEpi = typeof openingCurtain?.isEpilogueOpen === 'function'
      ? openingCurtain.isEpilogueOpen()
      : Boolean(openingCurtain?.isEpilogueOpen);
    if (isTrans || isEpi) return null;
    if (doc && !interactionAllowed(null, doc)) return null;
    const st = player?.state;
    if (!st) return null;

    const third = st.view === 'third';
    const eyeX = third ? st.x : (camera?.position?.x ?? st.x);
    const eyeY = third ? st.y + (st.eyeHeight || 1.62) : (camera?.position?.y ?? st.y + 1.62);
    const eyeZ = third ? st.z : (camera?.position?.z ?? st.z);
    const cp = Math.cos(st.pitch || 0);
    const fx = -Math.sin(st.yaw || 0) * cp;
    const fy = Math.sin(st.pitch || 0);
    const fz = -Math.cos(st.yaw || 0) * cp;

    let best = null;
    const consider = (act3Kind, id, name, label, prompt, x, y, z, maxHoriz, maxDot = 0.56, bonus = 0) => {
      const horiz = Math.hypot(x - st.x, z - st.z);
      if (horiz > maxHoriz) return;
      const dx = x - eyeX, dy = y - eyeY, dz = z - eyeZ;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const dot = (dx * fx + dy * fy + dz * fz) / dist;
      if (dot < maxDot) return;
      const score = dist + (1 - dot) * 3.5 + bonus;
      if (!best || score < best.score) {
        best = {
          kind: 'mystery',
          key: 'act3:' + id,
          isAct3Finale: true,
          act3Kind,
          siteId: id,
          name,
          label,
          prompt,
          x,
          y,
          z,
          dist,
          dot,
          score,
        };
      }
    };

    if (runtime.stage === 'marking') {
      const maxRange = st.aboardSkiff ? 11.5 : 5.4;
      for (const m of markers) {
        if (runtime.placedIds.has(m.id)) continue;
        consider('marker', m.id, m.name, m.label, m.prompt, m.x, m.y + 0.55, m.z, maxRange, 0.52, -0.4);
      }
      if (runtime.placedIds.size >= 2) {
        consider('depart', departSite.id, departSite.name, departSite.label, departSite.prompt, departSite.x, departSite.y + 0.75, departSite.z, st.aboardSkiff ? 13 : 6.2, 0.50, -0.5);
      }
    } else if (runtime.stage === 'returning' || runtime.stage === 'lost' || runtime.stage === 'linger') {
      for (const m of markers) {
        if (!m.remnantGroup.visible) continue;
        consider('remnant', m.id, m.name, m.label, '俯察旧志 · 烟草茫然（E）', m.x, m.y + 0.35, m.z, 4.8, 0.62, 0.4);
      }
      if (loneCupBuilt.cupGroup.visible) {
        consider(
          'lone-cup',
          'lone-proof-cup',
          '漂流朱黑漆耳杯',
          '一叶孤证',
          '临流俯察 · 朱漆耳杯载桃东去（E）',
          runtime.cupX,
          waterLevel + 0.15,
          runtime.cupZ,
          7.5,
          0.52,
          0.1
        );
      }
      if (runtime.stage === 'linger' && departSite.grp.visible) {
        consider(
          'dream-return',
          'dream-return-ferry',
          '武陵孤舟 · 系舟一梦',
          '系舟入梦',
          '系舟一梦入桃源 · 重返山中闲居（E）',
          departSite.x,
          departSite.y + 0.75,
          departSite.z,
          st.aboardSkiff ? 13 : 6.8,
          0.50,
          -0.45
        );
      }
      const cliffPrompt = runtime.stage === 'linger' ? '重观终章题跋 · 后遂无问津者（E）' : '寻向所志 · 迷失山口（E）';
      consider('sealed-cliff', 'sealed-cliff', '山岚迷津', '迷津山口', cliffPrompt, sealedCenterX, slitY + 1.2, sealedCenterZ, 12.5, 0.58, -0.3);
    }

    return best;
  }

  function interactAct3Target(target) {
    if (!target?.isAct3Finale) return false;
    if (target.act3Kind === 'marker') {
      const site = markers.find((m) => m.id === target.siteId);
      return placeMarker(site, false);
    }
    if (target.act3Kind === 'depart') {
      startPrefectReturn();
      return true;
    }
    if (target.act3Kind === 'remnant') {
      const site = markers.find((m) => m.id === target.siteId);
      if (site) showNote(site.remnantLine, 4.5);
      return true;
    }
    if (target.act3Kind === 'lone-cup') {
      try {
        runtime.refs.sound?.unlock?.();
        runtime.refs.sound?.waterCup?.(runtime.cupX, runtime.cupZ);
      } catch (_) {}
      showNote('清溪自雾锁岩隙潺潺流出，唯余一只朱黑漆耳杯载着两片落桃随波远去。', 4.8);
      return true;
    }
    if (target.act3Kind === 'dream-return') {
      return dreamReturnToValley();
    }
    if (target.act3Kind === 'sealed-cliff') {
      if (runtime.stage === 'returning') {
        enterLost();
        return true;
      }
      if (runtime.stage === 'lost' || runtime.stage === 'linger') {
        enterEpilogue();
        return true;
      }
    }
    return false;
  }

  function bind(ctx = {}) {
    Object.assign(runtime.refs, {
      doc: ctx.doc ?? runtime.refs.doc,
      player: ctx.player ?? runtime.refs.player,
      dialogue: ctx.dialogue ?? runtime.refs.dialogue,
      mysteries: ctx.mysteries ?? runtime.refs.mysteries,
      riverSkiff: ctx.riverSkiff ?? runtime.refs.riverSkiff,
      caveGleam: ctx.caveGleam ?? runtime.refs.caveGleam,
      openingCurtain: ctx.openingCurtain ?? runtime.refs.openingCurtain,
      sky: ctx.sky ?? runtime.refs.sky,
      sound: ctx.sound ?? runtime.refs.sound,
      journal: ctx.journal ?? runtime.refs.journal,
      camera: ctx.camera ?? runtime.refs.camera,
    });

    const m = runtime.refs.mysteries;
    if (m && !m._act3Wrapped) {
      m._act3Wrapped = true;
      const basePick = m.pickTarget.bind(m);
      const baseInteract = m.interact.bind(m);
      const baseHide = m.hide.bind(m);
      m.pickTarget = function (camera, cfg) {
        const a = basePick(camera, cfg);
        const b = pickAct3Target(camera, cfg);
        if (!a) return b;
        if (!b) return a;
        return b.score <= a.score ? b : a;
      };
      m.interact = function (target) {
        if (target?.isAct3Finale) return interactAct3Target(target);
        return baseInteract(target);
      };
      m.hide = function () {
        clearNoteIfAct3();
        return baseHide();
      };
    }

    const j = runtime.refs.journal;
    if (j && !j._act3WrappedClear) {
      j._act3WrappedClear = true;
      const prevOnClear = j.onClear;
      j.onClear = () => {
        prevOnClear?.();
        reset({ respawn: false, resetDialogue: false });
      };
    }
  }

  function update(dt = 0.016, elapsed = 0, sky = null, playerState = null, camera = null) {
    if (runtime.disposed) return;
    if (sky && !runtime.refs.sky) runtime.refs.sky = sky;
    if (camera && !runtime.refs.camera) runtime.refs.camera = camera;

    if (runtime.noteTimer > 0) {
      runtime.noteTimer = Math.max(0, runtime.noteTimer - dt);
      if (runtime.noteTimer === 0) clearNoteIfAct3();
    }

    const windStrength = sky?.wind?.strength ?? 0.35;
    const windCos = Math.cos(sky?.wind?.angle ?? 0.4);

    if (group.visible) {
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        if (m.guideGroup.visible) {
          const pulse = 1 + Math.sin(elapsed * 2.6 + i * 1.1) * 0.1;
          m.ring.scale.set(pulse, pulse, 1);
        }
        if (m.placedGroup.visible) {
          const sway = Math.sin(elapsed * 2.8 + i * 1.5) * (0.12 + windStrength * 0.22);
          m.ribbons[0].rotation.z = sway * windCos;
          m.ribbons[0].rotation.x = Math.cos(elapsed * 2.1 + i) * 0.14;
          m.ribbons[1].rotation.z = -sway * 0.85;
        }
      }
      if (departSite.grp.visible) {
        const p = 1 + Math.sin(elapsed * 2.2) * 0.08;
        departSite.ring.scale.set(p, p, 1);
        departSite.flag.rotation.z = Math.sin(elapsed * 3.1) * (0.15 + windStrength * 0.24);
      }
      if (sealBuilt.sealGroup.visible) {
        for (let i = 0; i < sealBuilt.mistSheets.length; i++) {
          const sh = sealBuilt.mistSheets[i];
          sh.mesh.position.x = sh.baseX + Math.sin(elapsed * 0.36 + sh.phase) * 0.95;
          sh.mesh.position.y = sh.baseY + Math.cos(elapsed * 0.28 + sh.phase) * 0.22;
        }
      }
      if (loneCupBuilt.cupGroup.visible) {
        const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;
        if (step > 0) {
          runtime.cupPhase = (runtime.cupPhase + step / 22.0) % 1;
          positionLoneCup(runtime.cupPhase);
        }
      }
    }

    const st = playerState || runtime.refs.player?.state;
    const oc = runtime.refs.openingCurtain;
    const curtainOpen = typeof oc?.isOpen === 'function' ? oc.isOpen() : oc?.isOpen !== false;
    if (!st || !curtainOpen) return;

    runtime.stageTimer += dt;
    const dlg = runtime.refs.dialogue;
    const distToSlit = Math.hypot(st.x - slitX, st.z - slitZ);

    if (runtime.stage === 'idle') {
      if (st.z < -48 || dlg?.hasFired?.('valley-open')) runtime.visitedValleyDeep = true;
      const vCx = world?.village?.center?.[0] ?? 18;
      const vCz = world?.village?.center?.[1] ?? -142;
      if (
        st.z < -76 ||
        dlg?.hasFired?.('feast-invite') ||
        dlg?.hasFired?.('feast-history') ||
        Math.hypot(st.x - vCx, st.z - vCz) < 95 ||
        (st.z < -30 && runtime.refs.doc?.body?.classList?.contains?.('talk-open'))
      ) {
        runtime.experiencedVillageLife = true;
      }

      if (runtime.visitedValleyDeep && runtime.experiencedVillageLife) {
        const nearInnerCave = st.z >= slitZ - 26 && st.z <= slitZ + 6 && distToSlit < 30;
        const justExitedCave = st.z > slitZ + 2 && st.z < 52 && distToSlit < 42;
        if (nearInnerCave || justExitedCave) {
          enterMarking();
        }
      }
      return;
    }

    if (runtime.stage === 'marking') {
      const passRange = st.aboardSkiff ? 16 : 9.5;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        if (runtime.placedIds.has(m.id)) continue;
        if (st.z > m.z + 3.5 && (st.vz ?? 0) >= -0.08 && Math.hypot(st.x - m.x, st.z - m.z) <= passRange) {
          placeMarker(m, false);
        }
      }
      if ((runtime.placedIds.size >= 2 || st.z > 105) && st.z >= 168) {
        if (runtime.placedIds.size < 2) {
          for (let i = 0; i < markers.length && runtime.placedIds.size < 2; i++) {
            placeMarker(markers[i], true);
          }
        }
        startPrefectReturn();
      }
      return;
    }

    if (runtime.stage === 'returning') {
      if (runtime.stageTimer > 1.2 && st.z < 26 && distToSlit < 28) {
        enterLost();
      }
      return;
    }

    if (runtime.stage === 'lost') {
      runtime.epilogueDelay -= dt;
      if (runtime.epilogueDelay <= 0) {
        enterEpilogue();
      }
    }
  }

  function getState() {
    return {
      stage: runtime.stage,
      placedCount: runtime.placedIds.size,
      placedIds: Array.from(runtime.placedIds),
      visitedValleyDeep: runtime.visitedValleyDeep,
      experiencedVillageLife: runtime.experiencedVillageLife,
      caveSealed: sealBuilt.sealGroup.visible,
      gleamSuppressed: Boolean(runtime.refs.caveGleam?.getStats?.().suppressed),
    };
  }

  function getStats() {
    return {
      stage: runtime.stage,
      visible: runtime.stage !== 'idle',
      placedCount: runtime.placedIds.size,
      markerCount: markers.length,
      caveSealed: sealBuilt.sealGroup.visible,
      loneCupVisible: loneCupBuilt.cupGroup.visible,
      loneCupPos: { x: Math.round(runtime.cupX * 100) / 100, z: Math.round(runtime.cupZ * 100) / 100 },
      sealBlockerActive: sealBlocker.hw > 0,
      markers: markers.map((m) => ({
        id: m.id,
        x: m.x,
        y: m.y,
        z: m.z,
        placed: runtime.placedIds.has(m.id),
      })),
      departFerry: { x: departSite.x, y: departSite.y, z: departSite.z },
      returnSpawn: { ...returnSpawn },
    };
  }

  function dispose() {
    if (runtime.disposed) return;
    runtime.disposed = true;
    clearNoteIfAct3();
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
    });
    for (const geo of sealBuilt.rockGeos) geo.dispose();
    sealBuilt.mistGeo.dispose();
    loneCupBuilt.wakeGeo.dispose();
    solidMat.dispose();
    ribbonMat.dispose();
    ringMat.dispose();
    petalMat.dispose();
    rockLightMat.dispose();
    rockMidMat.dispose();
    mistMat.dispose();
  }

  function getNextUnplacedMarker() {
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      if (!runtime.placedIds.has(m.id)) {
        return { id: m.id, x: m.x, z: m.z, name: m.name };
      }
    }
    return null;
  }

  return {
    group,
    blockers,
    get isVisible() { return runtime.stage !== 'idle'; },
    get isLost() { return runtime.stage === 'lost' || runtime.stage === 'epilogue' || runtime.stage === 'linger'; },
    get caveSealed() { return sealBuilt.sealGroup.visible; },
    get stage() { return runtime.stage; },
    get placedCount() { return runtime.placedIds.size; },
    departFerryPos: { x: departSite.x, z: departSite.z },
    getNextUnplacedMarker,
    bind,
    update,
    advanceToStage,
    dreamReturnToValley,
    reset,
    getState,
    getStats,
    dispose,
  };
}
