import * as THREE from 'three';

const TAU = Math.PI * 2;
const DEFAULT_WAKE_COUNT = 11;
const POLE_DROP_COUNT = 3;
const LANTERN_FISH_COUNT = 5;
const DRIP_PHASES = [0.58, 0.66, 0.74];
const DRIP_SHAFT_OFFSETS = [0.38, 0.60, 0.82];

const _mat = new THREE.Matrix4();
const _nmat = new THREE.Matrix3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _tn = new THREE.Vector3();
const UNIT_X = new THREE.Vector3(1, 0, 0);
const UNIT_Y = new THREE.Vector3(0, 1, 0);
const _qInv = new THREE.Quaternion();
const _col = new THREE.Color();

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smooth01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function cyclicBell(p, center, halfWidth) {
  const d = ((p - center + 1.5) % 1) - 0.5;
  const u = Math.abs(d) / halfWidth;
  if (u >= 1) return 0;
  const c = Math.cos(u * Math.PI * 0.5);
  return c * c;
}

function createSink() {
  return { pos: [], nor: [], col: [] };
}

function pushGeo(sk, geo, mat, hexOrColor) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pa = g.attributes.position.array;
  const na = g.attributes.normal.array;
  _col.set(hexOrColor);
  _nmat.getNormalMatrix(mat);
  for (let i = 0; i < pa.length; i += 3) {
    _v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(mat);
    sk.pos.push(_v.x, _v.y, _v.z);
    _v.set(na[i], na[i + 1], na[i + 2]).applyMatrix3(_nmat).normalize();
    sk.nor.push(_v.x, _v.y, _v.z);
    sk.col.push(_col.r, _col.g, _col.b);
  }
  if (g !== geo) g.dispose();
}

function putBox(sk, box, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) {
  _euler.set(rx, ry, rz, 'YXZ');
  _quat.setFromEuler(_euler);
  _mat.compose(_pos.set(x, y, z), _quat, _scl.set(sx, sy, sz));
  pushGeo(sk, box, _mat, color);
}

function putBar(sk, box, ax, ay, az, bx, by, bz, thick, wide, color) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  _dir.subVectors(_b, _a);
  const len = _dir.length() || 0.001;
  _dir.multiplyScalar(1 / len);
  _pos.addVectors(_a, _b).multiplyScalar(0.5);
  _quat.setFromUnitVectors(UNIT_X, _dir);
  _mat.compose(_pos, _quat, _scl.set(len, thick, wide));
  pushGeo(sk, box, _mat, color);
}

function pushQuad(sk, a, b, c, d, color) {
  _col.set(color);
  _t1.subVectors(b, a);
  _t2.subVectors(c, a);
  _tn.crossVectors(_t1, _t2).normalize();
  const verts = [a, b, c, a, c, d];
  for (const p of verts) {
    sk.pos.push(p.x, p.y, p.z);
    sk.nor.push(_tn.x, _tn.y, _tn.z);
    sk.col.push(_col.r, _col.g, _col.b);
  }
}

function pushTri(sk, a, b, c, color) {
  _col.set(color);
  _t1.subVectors(b, a);
  _t2.subVectors(c, a);
  _tn.crossVectors(_t1, _t2).normalize();
  for (const p of [a, b, c]) {
    sk.pos.push(p.x, p.y, p.z);
    sk.nor.push(_tn.x, _tn.y, _tn.z);
    sk.col.push(_col.r, _col.g, _col.b);
  }
}

function toGeometry(sk) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sk.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(sk.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(sk.col, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Local frame of skiff: +Z is bow (forward), -Z is stern, Y is up relative to deck/waterline.
function buildSkiffGeometry() {
  const sk = createSink();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const sections = [
    { z: -2.25, w: 0.24, rim: 0.34, bot: -0.14 },
    { z: -1.45, w: 0.54, rim: 0.28, bot: -0.22 },
    { z: 0.0, w: 0.62, rim: 0.26, bot: -0.24 },
    { z: 1.45, w: 0.52, rim: 0.29, bot: -0.21 },
    { z: 2.35, w: 0.14, rim: 0.38, bot: -0.11 }
  ];
  const cHull = '#6E5338';
  const cHullDark = '#533E29';
  const cDeck = '#8E6F4B';
  const cBamboo = '#B59B62';
  const cAwning = '#9A8455';
  const cAwningBand = '#5C4A33';
  const cCreel = '#AE9156';

  const rings = sections.map(s => ({
    rimL: new THREE.Vector3(-s.w, s.rim, s.z),
    rimR: new THREE.Vector3(s.w, s.rim, s.z),
    chL: new THREE.Vector3(-s.w * 0.70, s.rim - 0.18, s.z),
    chR: new THREE.Vector3(s.w * 0.70, s.rim - 0.18, s.z),
    keel: new THREE.Vector3(0, s.bot, s.z)
  }));

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    pushQuad(sk, a.rimL, b.rimL, b.chL, a.chL, cHull);
    pushQuad(sk, a.rimR, a.chR, b.chR, b.rimR, cHull);
    pushQuad(sk, a.chL, b.chL, b.keel, a.keel, cHullDark);
    pushQuad(sk, a.chR, a.keel, b.keel, b.chR, cHullDark);
    putBar(sk, box, a.rimL.x, a.rimL.y + 0.015, a.rimL.z, b.rimL.x, b.rimL.y + 0.015, b.rimL.z, 0.05, 0.065, cBamboo);
    putBar(sk, box, a.rimR.x, a.rimR.y + 0.015, a.rimR.z, b.rimR.x, b.rimR.y + 0.015, b.rimR.z, 0.05, 0.065, cBamboo);
  }
  const stern = rings[0];
  const bow = rings[rings.length - 1];
  pushTri(sk, stern.keel, stern.rimL, stern.chL, cHullDark);
  pushTri(sk, stern.keel, stern.chR, stern.rimR, cHullDark);
  pushTri(sk, stern.keel, stern.rimR, stern.rimL, cHullDark);
  pushTri(sk, bow.keel, bow.chL, bow.rimL, cHullDark);
  pushTri(sk, bow.keel, bow.rimR, bow.chR, cHullDark);
  pushTri(sk, bow.keel, bow.rimL, bow.rimR, cHullDark);

  // Inner floorboards and 3 thwarts
  putBox(sk, box, 0, 0.04, 0, 0.68, 0.04, 3.1, cDeck);
  for (const tz of [-1.25, -0.20, 1.05]) {
    putBox(sk, box, 0, 0.16, tz, 0.94, 0.045, 0.22, cHullDark);
  }
  // Low stern arched bamboo canopy (箬篷) open cleanly to the front deck so view stays clear
  const segs = 7;
  const rX = 0.56;
  const rY = 0.62;
  const z0 = -1.55;
  const z1 = -0.35;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI;
    const a1 = ((i + 1) / segs) * Math.PI;
    const p00 = new THREE.Vector3(-Math.cos(a0) * rX, 0.27 + Math.sin(a0) * rY, z0);
    const p01 = new THREE.Vector3(-Math.cos(a1) * rX, 0.27 + Math.sin(a1) * rY, z0);
    const p10 = new THREE.Vector3(-Math.cos(a0) * rX, 0.27 + Math.sin(a0) * rY, z1);
    const p11 = new THREE.Vector3(-Math.cos(a1) * rX, 0.27 + Math.sin(a1) * rY, z1);
    pushQuad(sk, p00, p01, p11, p10, i % 2 === 0 ? cAwning : '#8B764A');
  }
  for (const bz of [z0, (z0 + z1) * 0.5, z1]) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI;
      const a1 = ((i + 1) / segs) * Math.PI;
      putBar(
        sk, box,
        -Math.cos(a0) * (rX + 0.015), 0.27 + Math.sin(a0) * (rY + 0.015), bz,
        -Math.cos(a1) * (rX + 0.015), 0.27 + Math.sin(a1) * (rY + 0.015), bz,
        0.025, 0.032, cAwningBand
      );
    }
  }
  // Woven creel (鱼篓) & bow mooring post
  _quat.identity();
  _mat.compose(_pos.set(-0.22, 0.24, -0.78), _quat, _scl.set(0.28, 0.34, 0.28));
  pushGeo(sk, cyl, _mat, cCreel);
  _mat.compose(_pos.set(0, 0.38, 1.98), _quat, _scl.set(0.08, 0.26, 0.08));
  pushGeo(sk, cyl, _mat, cHullDark);

  // Bow bamboo fishing lantern (船头竹编渔火灯) baked into hull geometry (0 extra daytime draw calls)
  putBar(sk, box, 0, 0.50, 1.98, 0, 0.612, 2.005, 0.022, 0.024, '#8B7344');
  putBar(sk, box, 0, 0.612, 2.005, 0, 0.584, 2.02, 0.018, 0.020, '#8B7344');
  _quat.identity();
  // Top cap, bottom base, middle bamboo hoop, and warm unlit oiled-paper/wicker inner core at (0, 0.52, 2.02)
  _mat.compose(_pos.set(0, 0.576, 2.02), _quat, _scl.set(0.138, 0.020, 0.138));
  pushGeo(sk, cyl, _mat, '#6A5334');
  _mat.compose(_pos.set(0, 0.464, 2.02), _quat, _scl.set(0.126, 0.020, 0.126));
  pushGeo(sk, cyl, _mat, '#6A5334');
  _mat.compose(_pos.set(0, 0.520, 2.02), _quat, _scl.set(0.136, 0.012, 0.136));
  pushGeo(sk, cyl, _mat, cBamboo);
  _mat.compose(_pos.set(0, 0.520, 2.02), _quat, _scl.set(0.094, 0.098, 0.094));
  pushGeo(sk, cyl, _mat, '#C8B07E');
  for (let r = 0; r < 4; r++) {
    const ang = (r / 4) * TAU + Math.PI * 0.25;
    const rx = Math.cos(ang) * 0.063;
    const rz = 2.02 + Math.sin(ang) * 0.063;
    putBar(sk, box, rx, 0.468, rz, rx, 0.572, rz, 0.014, 0.014, '#7A633D');
  }

  box.dispose();
  cyl.dispose();
  return toGeometry(sk);
}

function buildLanternGlowGeometry() {
  const sk = createSink();
  const core = new THREE.OctahedronGeometry(0.056, 1);
  const halo = new THREE.OctahedronGeometry(0.112, 1);
  const shimmer = new THREE.CircleGeometry(0.36, 10);
  shimmer.rotateX(-Math.PI / 2);

  _quat.identity();
  _mat.compose(_pos.set(0, 0.52, 2.02), _quat, _scl.set(0.95, 1.08, 0.95));
  pushGeo(sk, core, _mat, '#FFE0A6');

  _mat.compose(_pos.set(0, 0.52, 2.02), _quat, _scl.set(1.0, 1.06, 1.0));
  pushGeo(sk, halo, _mat, '#8A521C');

  // Soft reflected warm amber shimmer on the water surface just ahead of the bow
  _mat.compose(_pos.set(0, -0.052, 2.18), _quat, _scl.set(0.92, 1.0, 1.28));
  pushGeo(sk, shimmer, _mat, '#5C3510');

  core.dispose();
  halo.dispose();
  shimmer.dispose();
  return toGeometry(sk);
}

function buildLanternCarpGeometry() {
  const sk = createSink();
  const body = new THREE.OctahedronGeometry(0.11, 0);
  const tail = new THREE.ConeGeometry(0.055, 0.13, 4);
  tail.rotateX(-Math.PI * 0.5);
  _quat.identity();
  _mat.compose(_pos.set(0, 0, 0.04), _quat, _scl.set(0.46, 0.36, 1.45));
  pushGeo(sk, body, _mat, '#D97B48');
  _mat.compose(_pos.set(0, 0.015, 0.05), _quat, _scl.set(0.32, 0.22, 1.15));
  pushGeo(sk, body, _mat, '#3A3530');
  _mat.compose(_pos.set(0, 0, -0.15), _quat, _scl.set(0.55, 0.85, 1.0));
  pushGeo(sk, tail, _mat, '#E8A86B');
  body.dispose();
  tail.dispose();
  return toGeometry(sk);
}

function buildPoleDropGeometry() {
  const geo = new THREE.OctahedronGeometry(0.022, 0);
  const nonIdx = geo.index ? geo.toNonIndexed() : geo;
  if (nonIdx !== geo) geo.dispose();
  nonIdx.computeVertexNormals();
  nonIdx.computeBoundingBox();
  nonIdx.computeBoundingSphere();
  return nonIdx;
}

function buildPoleGeometry() {
  const sk = createSink();
  const cyl = new THREE.CylinderGeometry(0.022, 0.026, 3.7, 6);
  cyl.translate(0, 1.85, 0);
  _quat.identity();
  _mat.compose(_pos.set(0, 0, 0), _quat, _scl.set(1, 1, 1));
  pushGeo(sk, cyl, _mat, '#A99658');
  for (let i = 0; i < 6; i++) {
    const node = new THREE.CylinderGeometry(0.028, 0.028, 0.035, 6);
    _mat.compose(_pos.set(0, 0.42 + i * 0.56, 0), _quat, _scl.set(1, 1, 1));
    pushGeo(sk, node, _mat, '#766739');
    node.dispose();
  }
  cyl.dispose();
  return toGeometry(sk);
}

function buildWakeRingGeometry() {
  const geo = new THREE.RingGeometry(0.32, 0.50, 12);
  geo.rotateX(-Math.PI / 2);
  const nonIdx = geo.toNonIndexed();
  geo.dispose();
  const count = nonIdx.attributes.position.count;
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i += 3) {
    col[i] = 0.88;
    col[i + 1] = 0.94;
    col[i + 2] = 0.95;
  }
  nonIdx.setAttribute('color', new THREE.BufferAttribute(col, 3));
  nonIdx.computeVertexNormals();
  nonIdx.computeBoundingBox();
  nonIdx.computeBoundingSphere();
  return nonIdx;
}

function isModalPause(doc) {
  if (!doc) return false;
  if (doc.body?.classList?.contains('map-open') || doc.body?.classList?.contains('field-guide-open')) return true;
  if (doc.getElementById?.('journal')?.open) return true;
  return false;
}

export function createRiverSkiff({ world, field, stream, riverCurve, distanceToRiver, boats, cliff } = {}) {
  const group = new THREE.Group();
  group.name = 'river-skiff-group';

  const waterLevel = world?.terrain?.waterLevel ?? -1;
  const curveLength = Math.max(100, riverCurve?.getLength?.() || 407);
  const mooredBoats = (world?.boats?.boats || [])
    .map(b => ({ x: b.x ?? b[0], z: b.z ?? b[1] }))
    .filter(b => Number.isFinite(b.x) && Number.isFinite(b.z));

  const skiffRig = new THREE.Group();
  skiffRig.name = 'river-skiff';
  group.add(skiffRig);

  const woodMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const hullGeo = buildSkiffGeometry();
  const hullMesh = new THREE.Mesh(hullGeo, woodMat);
  hullMesh.name = 'river-skiff-hull';
  hullMesh.frustumCulled = true;
  skiffRig.add(hullMesh);

  const poleGeo = buildPoleGeometry();
  const poleMesh = new THREE.Mesh(poleGeo, woodMat);
  poleMesh.name = 'river-skiff-pole';
  poleMesh.position.set(0.46, 0.28, -0.35);
  poleMesh.rotation.set(1.22, 0.08, -0.18);
  poleMesh.frustumCulled = true;
  skiffRig.add(poleMesh);

  const lanternGlowGeo = buildLanternGlowGeometry();
  const lanternGlowMat = new THREE.MeshBasicMaterial({
    color: '#FFB55E',
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  lanternGlowMat.userData = { skyIgnore: true };
  const bowLanternGlow = new THREE.Mesh(lanternGlowGeo, lanternGlowMat);
  bowLanternGlow.name = 'river-skiff-lantern-glow';
  bowLanternGlow.frustumCulled = true;
  bowLanternGlow.visible = false;
  skiffRig.add(bowLanternGlow);

  const lanternFishGeo = buildLanternCarpGeometry();
  const lanternFishMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    emissive: '#4E260C',
    emissiveIntensity: 0.72
  });
  const lanternFishMesh = new THREE.InstancedMesh(lanternFishGeo, lanternFishMat, LANTERN_FISH_COUNT);
  lanternFishMesh.name = 'river-skiff-lantern-fish';
  lanternFishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  lanternFishMesh.frustumCulled = true;
  lanternFishMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
  lanternFishMesh.visible = false;
  for (let i = 0; i < LANTERN_FISH_COUNT; i++) {
    lanternFishMesh.setColorAt(i, i % 2 === 0 ? _col.set('#FFE4BE') : _col.set('#E2C8A8'));
  }
  if (lanternFishMesh.instanceColor) lanternFishMesh.instanceColor.needsUpdate = true;
  group.add(lanternFishMesh);

  const wakeGeo = buildWakeRingGeometry();
  const wakeMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.40,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  wakeMat.userData.skyIgnore = true;
  const wakeMesh = new THREE.InstancedMesh(wakeGeo, wakeMat, DEFAULT_WAKE_COUNT);
  wakeMesh.name = 'river-skiff-wake';
  wakeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wakeMesh.frustumCulled = true;
  wakeMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
  for (let i = 0; i < DEFAULT_WAKE_COUNT; i++) {
    wakeMesh.setColorAt(i, i >= 8 ? _col.setRGB(0.90, 0.96, 0.98) : _col.setRGB(0.88, 0.94, 0.95));
  }
  if (wakeMesh.instanceColor) wakeMesh.instanceColor.needsUpdate = true;
  group.add(wakeMesh);

  const dropGeo = buildPoleDropGeometry();
  const dropMat = new THREE.MeshBasicMaterial({
    color: '#DDF3F8',
    transparent: true,
    opacity: 0.86,
    depthWrite: false
  });
  dropMat.userData = { skyIgnore: true };
  const poleDropsMesh = new THREE.InstancedMesh(dropGeo, dropMat, POLE_DROP_COUNT);
  poleDropsMesh.name = 'river-skiff-pole-drops';
  poleDropsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  poleDropsMesh.frustumCulled = true;
  poleDropsMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
  poleDropsMesh.visible = false;
  _quat.identity();
  for (let i = 0; i < POLE_DROP_COUNT; i++) {
    _mat.compose(_pos.set(0, waterLevel - 2.0, 0), _quat, _scl.set(0.001, 0.001, 0.001));
    poleDropsMesh.setMatrixAt(i, _mat);
  }
  poleDropsMesh.instanceMatrix.needsUpdate = true;
  group.add(poleDropsMesh);

  const keys = new Set();
  const state = {
    aboard: false,
    t: 0.435,
    lat: 1.8,
    speed: 0,
    latSpeed: 0,
    yaw: 0,
    yawOffset: 0,
    yawVel: 0,
    hullPitch: 0,
    hullRoll: 0,
    strokePitch: 0,
    strokeRoll: 0,
    x: 0,
    y: waterLevel + 0.08,
    smoothDeckY: waterLevel + 0.08,
    z: 0,
    strokePhase: 0.06,
    strokeDir: 1,
    strafeBlend: 0,
    strokeSounded: false,
    puntPoseBlend: 0,
    keyCooldown: 0,
    wakeAge: 0,
    punting: false,
    drifting: false,
    driftManual: false,
    driftBlend: 0,
    idleTimer: 0,
    canopyRainTimer: 0.25,
    rainNoteShown: false,
    hasDisembarkedOnce: false,
    lastSyncedX: null,
    lastSyncedZ: null
  };

  // Persistent punting joint state so per-frame avatar.update() never dampens or fights arm/torso motion
  const pose = {
    init: false,
    standX: 0.04,
    standZ: 0.25,
    bodyLift: 0,
    hipYawOff: -0.20,
    bodyX: 0.04,
    bodyY: -0.08,
    bodyZ: 0.02,
    armLx: -0.56,
    armLz: -0.64,
    armRx: -1.08,
    armRz: -0.82,
    legLx: -0.14,
    legRx: 0.14,
    legSpread: 0.04,
    legStride: 0,
    gripT: 2.08
  };

  const splashRings = [
    { x: 0, z: 0, age: 10, active: false },
    { x: 0, z: 0, age: 10, active: false }
  ];
  let splashCursor = 0;
  const dripRipples = [
    { x: 0, z: 0, age: 10, active: false },
    { x: 0, z: 0, age: 10, active: false },
    { x: 0, z: 0, age: 10, active: false }
  ];
  let dripRippleCursor = 0;
  const poleDrops = [
    { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
  ];
  let poleDropCursor = 0;
  let poleWasWetInStroke = false;
  let dripStageMask = 0;
  let poleSubmergedPrev = false;
  let poleMidRippleDone = false;
  let lastPoleWaterX = 0;
  let lastPoleWaterZ = 0;
  let hasPoleWaterHit = false;

  let boundCtx = null;
  let savedHint = null;
  let noteTimer = 0;
  let simTime = 0;
  let lastVisualTime = 0;
  let hullWaveInit = false;
  let disposed = false;
  const pendingEvents = [];

  function sampleStreamSurfaceY(t, x, z, elapsedTime) {
    if (!stream?.surfaceY) return waterLevel;
    const tc = Math.max(0.08, Math.min(0.92, t));
    return stream.surfaceY.length >= 3
      ? stream.surfaceY(x, z, elapsedTime)
      : stream.surfaceY(tc, elapsedTime);
  }

  function sampleHullBuoyancy(t, x, z, elapsedTime) {
    const tc = Math.max(0.08, Math.min(0.92, t));
    if (!stream?.surfaceY || stream.surfaceY.length >= 3) {
      const wy = sampleStreamSurfaceY(tc, x, z, elapsedTime);
      return { y: wy, waveSlopePitch: 0 };
    }
    const halfSpanT = 1.65 / curveLength;
    const tStern = Math.max(0.08, Math.min(0.92, tc - halfSpanT));
    const tBow = Math.max(0.08, Math.min(0.92, tc + halfSpanT));
    const yStern = stream.surfaceY(tStern, elapsedTime);
    const yMid = stream.surfaceY(tc, elapsedTime);
    const yBow = stream.surfaceY(tBow, elapsedTime);
    const spanMeters = Math.max(0.8, (tBow - tStern) * curveLength);
    // In skiff local frame (+Z bow, +Y up), positive rotation.x dips bow (-Y), so bow higher -> negative pitch
    const waveSlopePitch = Math.max(-0.025, Math.min(0.025, -(yBow - yStern) / spanMeters));
    return {
      y: (yStern + 2 * yMid + yBow) * 0.25,
      waveSlopePitch
    };
  }

  function spineFrame(t, lat) {
    const tc = Math.max(0.08, Math.min(0.92, t));
    const p = riverCurve.getPointAt(tc);
    const tan = riverCurve.getTangentAt(tc);
    const len = Math.hypot(tan.x, tan.z) || 1;
    const tx = tan.x / len;
    const tz = tan.z / len;
    // Right-hand lateral normal facing east shore near spawn (t = 0.435 -> tz < 0, rx = -tz > 0)
    const rx = -tz;
    const rz = tx;
    return {
      tc,
      x: p.x + rx * lat,
      z: p.z + rz * lat,
      tx,
      tz,
      rx,
      rz,
      forwardYaw: Math.atan2(-tx, -tz),
      meshYaw: Math.atan2(tx, tz)
    };
  }

  function channelSafe(t, lat) {
    const fr = spineFrame(t, lat);
    if (field && field.sample(fr.x, fr.z) > waterLevel - 0.16) return false;
    for (const mb of mooredBoats) {
      if (Math.hypot(fr.x - mb.x, fr.z - mb.z) < 2.65) return false;
    }
    return true;
  }

  function clampChannel(nextT, nextLat) {
    let tc = Math.max(0.10, Math.min(0.912, nextT));
    let lc = Math.max(-11.0, Math.min(11.0, nextLat));
    if (!channelSafe(tc, lc)) {
      const sign = lc >= 0 ? 1 : -1;
      // Slide gently inward along narrowing banks first, falling back to mid-channel lanes if blocked by a moored hull
      const candidates = [
        lc - sign * 0.08,
        lc - sign * 0.20,
        lc - sign * 0.40,
        lc * 0.88,
        lc * 0.65,
        lc * 0.35,
        0,
        -1.8,
        -3.2
      ];
      for (const tryLat of candidates) {
        if (channelSafe(tc, tryLat)) {
          lc = tryLat;
          return { t: tc, lat: lc, blocked: false };
        }
      }
      return { t: state.t, lat: state.lat, blocked: true };
    }
    return { t: tc, lat: lc, blocked: false };
  }

  function showNote(text, duration = 4.6) {
    const doc = boundCtx?.doc || globalThis.document;
    const el = doc?.getElementById?.('mystery-note');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    noteTimer = duration;
  }

  function clearNote() {
    const doc = boundCtx?.doc || globalThis.document;
    const el = doc?.getElementById?.('mystery-note');
    if (el) el.classList.remove('show');
    noteTimer = 0;
  }

  const SKIFF_HINT_TEXT = 'WASD 撑篙泛舟 · X 收篙随波 · E 舍船登岸 · V 切换视角';
  const SKIFF_HINT_HTML = [
    'WASD 撑篙泛舟',
    'X 收篙随波',
    'E 舍船登岸',
    'V 切换视角'
  ].map(item => `<span class="hint__group">${item}</span>`).join('');

  function syncHint(aboardNow) {
    const hintEl = boundCtx?.hintEl;
    if (!hintEl) return;
    const isDomHint = typeof hintEl.querySelectorAll === 'function' && typeof hintEl.innerHTML === 'string';
    if (savedHint === null) {
      savedHint = isDomHint ? hintEl.innerHTML : hintEl.textContent;
      if (isDomHint && hintEl.dataset && !hintEl.dataset.walkHintHtml && hintEl.innerHTML.includes('hint__group')) {
        hintEl.dataset.walkHintHtml = hintEl.innerHTML;
      }
    }
    if (aboardNow) {
      if (isDomHint) hintEl.innerHTML = SKIFF_HINT_HTML;
      else hintEl.textContent = SKIFF_HINT_TEXT;
    } else if (savedHint !== null) {
      const walkHtml = hintEl.dataset?.walkHintHtml || savedHint;
      if (isDomHint) hintEl.innerHTML = walkHtml;
      else hintEl.textContent = savedHint;
    }
  }

  function getAvatarRig() {
    const g = boundCtx?.avatar?.group;
    if (!g) return null;
    if (boundCtx._rig && boundCtx._rig.group === g) return boundCtx._rig;
    const body = g.getObjectByName?.('player-body') || null;
    const armL = g.getObjectByName?.('player-arm-l') || null;
    const armR = g.getObjectByName?.('player-arm-r') || null;
    const legL = g.getObjectByName?.('player-leg-l') || g.children?.find(c => c !== body) || null;
    const legR = g.getObjectByName?.('player-leg-r') || g.children?.find(c => c !== body && c !== legL) || null;
    boundCtx._rig = { group: g, body, armL, armR, legL, legR };
    return boundCtx._rig;
  }

  function resetAvatarPose() {
    pose.init = false;
    poleSubmergedPrev = false;
    poleMidRippleDone = false;
    hasPoleWaterHit = false;
    const rig = getAvatarRig();
    if (!rig) return;
    rig.group.rotation.x = 0;
    rig.group.rotation.z = 0;
    if (rig.body) {
      rig.body.position.set(0, 0, 0);
      rig.body.rotation.set(0, 0, 0);
    }
    if (rig.armL) rig.armL.rotation.set(0, 0, -0.16);
    if (rig.armR) rig.armR.rotation.set(0, 0, 0.16);
    if (rig.legL) {
      rig.legL.position.set(-0.1, 0.82, 0);
      rig.legL.rotation.set(0, 0, 0);
    }
    if (rig.legR) {
      rig.legR.position.set(0.1, 0.82, 0);
      rig.legR.rotation.set(0, 0, 0);
    }
  }

  function restPoleInHull() {
    poleMesh.position.set(-0.34, 0.24, -1.65);
    poleMesh.rotation.set(1.50, 0.06, -0.05, 'YXZ');
  }

  function spawnSplashRing(wx, wz) {
    const slot = splashRings[splashCursor % splashRings.length];
    splashCursor = (splashCursor + 1) % splashRings.length;
    slot.x = wx;
    slot.z = wz;
    slot.age = 0;
    slot.active = true;
  }

  function spawnDripRipple(wx, wz) {
    const slot = dripRipples[dripRippleCursor % dripRipples.length];
    dripRippleCursor = (dripRippleCursor + 1) % dripRipples.length;
    slot.x = wx;
    slot.z = wz;
    slot.age = 0;
    slot.active = true;
  }

  function clearPoleDrops() {
    for (let i = 0; i < POLE_DROP_COUNT; i++) {
      poleDrops[i].active = false;
    }
    poleDropsMesh.visible = false;
    poleWasWetInStroke = false;
    dripStageMask = 0;
  }

  function spawnPoleDroplet(shaftOffset, fr) {
    skiffRig.updateMatrixWorld(true);
    poleMesh.updateMatrixWorld(true);
    _v.set(0, shaftOffset, 0).applyMatrix4(poleMesh.matrixWorld);
    const slot = poleDrops[poleDropCursor % POLE_DROP_COUNT];
    poleDropCursor = (poleDropCursor + 1) % POLE_DROP_COUNT;
    slot.active = true;
    slot.x = _v.x;
    slot.y = Math.max(_v.y, state.y + 0.20 + (shaftOffset - 0.35) * 0.28);
    slot.z = _v.z;
    slot.vx = fr.tx * state.speed * 0.32;
    slot.vy = -0.12;
    slot.vz = fr.tz * state.speed * 0.32;
  }

  function updatePoleDroplets(stepDt, fr, waveY) {
    if (stepDt <= 0) return;
    let activeCount = 0;
    for (let i = 0; i < POLE_DROP_COUNT; i++) {
      const dr = poleDrops[i];
      if (!dr.active) {
        _quat.identity();
        _mat.compose(_pos.set(fr.x, waveY - 2.0, fr.z), _quat, _scl.set(0.001, 0.001, 0.001));
        poleDropsMesh.setMatrixAt(i, _mat);
        continue;
      }
      dr.vy -= 7.5 * stepDt;
      dr.x += dr.vx * stepDt;
      dr.y += dr.vy * stepDt;
      dr.z += dr.vz * stepDt;
      if (dr.y <= waveY + 0.02) {
        dr.active = false;
        spawnDripRipple(dr.x, dr.z);
        pendingEvents.push({
          type: 'poleDrip',
          x: dr.x,
          z: dr.z,
          intensity: 0.65
        });
        _quat.identity();
        _mat.compose(_pos.set(fr.x, waveY - 2.0, fr.z), _quat, _scl.set(0.001, 0.001, 0.001));
        poleDropsMesh.setMatrixAt(i, _mat);
        continue;
      }
      activeCount++;
      const stretch = 1 + Math.min(0.65, Math.abs(dr.vy) * 0.16);
      _quat.identity();
      _mat.compose(_pos.set(dr.x, dr.y, dr.z), _quat, _scl.set(1, stretch, 1));
      poleDropsMesh.setMatrixAt(i, _mat);
    }
    poleDropsMesh.visible = activeCount > 0;
    if (activeCount > 0) {
      poleDropsMesh.boundingSphere.center.set(fr.x, waveY + 0.5, fr.z);
      poleDropsMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function updateBowLantern(sky, elapsedTime) {
    const timeId = sky?.timeId || sky?.time || 'day';
    if (timeId === 'day') {
      bowLanternGlow.visible = false;
      return;
    }
    let baseOpacity = 0;
    if (timeId === 'night') {
      baseOpacity = 0.88;
    } else if (timeId === 'dusk') {
      baseOpacity = 0.72;
    } else if (timeId === 'dawn') {
      const dp = Number.isFinite(sky?.dawnProgress) ? Math.max(0, Math.min(1, sky.dawnProgress)) : 0.25;
      baseOpacity = 0.58 * (1 - 0.55 * dp);
    }
    if (baseOpacity <= 0.02) {
      bowLanternGlow.visible = false;
      return;
    }
    bowLanternGlow.visible = true;
    const flicker = 0.92 + 0.055 * Math.sin(elapsedTime * 6.4 + 0.7) + 0.025 * Math.sin(elapsedTime * 13.1 + 1.9);
    lanternGlowMat.opacity = Math.min(1, baseOpacity * flicker);
  }

  function updateLanternFish(fr, waveY, elapsedTime) {
    if (!bowLanternGlow.visible) {
      lanternFishMesh.visible = false;
      return;
    }
    lanternFishMesh.visible = true;
    const bowWorldX = fr.x + fr.tx * 2.15;
    const bowWorldZ = fr.z + fr.tz * 2.15;
    lanternFishMesh.boundingSphere.center.set(bowWorldX, waveY, bowWorldZ);
    for (let i = 0; i < LANTERN_FISH_COUNT; i++) {
      const ph = elapsedTime * (0.92 + i * 0.14) + i * 1.38;
      const rad = 0.62 + (i % 3) * 0.28 + Math.sin(ph * 0.7) * 0.12;
      const lx = Math.cos(ph) * rad * 1.05;
      const lz = 2.15 + Math.sin(ph) * rad * 1.15;
      const vx = -Math.sin(ph) * rad * 1.05;
      const vz = Math.cos(ph) * rad * 1.15;
      const wx = fr.x + fr.rx * lx + fr.tx * lz;
      const wz = fr.z + fr.rz * lx + fr.tz * lz;
      const wvx = fr.rx * vx + fr.tx * vz;
      const wvz = fr.rz * vx + fr.tz * vz;
      const swimYaw = Math.atan2(wvx, wvz) + Math.sin(elapsedTime * 7.5 + i * 1.9) * 0.11;
      const sc = 1.02 + (i % 3) * 0.16;
      const surfY = sampleStreamSurfaceY(fr.tc, wx, wz, elapsedTime);
      _euler.set(0, swimYaw, Math.sin(elapsedTime * 5.2 + i) * 0.06, 'YXZ');
      _quat.setFromEuler(_euler);
      _mat.compose(_pos.set(wx, surfY + 0.012 - (i % 2) * 0.006, wz), _quat, _scl.set(sc, sc, sc));
      lanternFishMesh.setMatrixAt(i, _mat);
    }
    lanternFishMesh.instanceMatrix.needsUpdate = true;
  }

  function updateWakeVisuals(fr, waveY, dt) {
    const hullSpeed = Math.hypot(state.speed, state.latSpeed);
    const moving = hullSpeed > 0.22 || state.aboard;
    const speedFactor = Math.min(1.15, 0.24 + hullSpeed * 0.16);
    const activeIntensity = state.punting ? Math.max(0.68, speedFactor) : (state.aboard ? Math.max(0.36, speedFactor * 0.75) : 0.20);
    wakeMesh.visible = true;
    wakeMesh.boundingSphere.center.set(fr.x, waveY + 0.05, fr.z);

    // Hull V-wake rings (0..5)
    for (let i = 0; i < 6; i++) {
      const f = (state.wakeAge + i / 6) % 1;
      const trailBack = -0.85 + f * 3.85;
      const side = (i % 2 === 0 ? -0.34 : 0.34) * (1 + f * 0.58);
      const wx = fr.x - fr.tx * trailBack + fr.rx * side;
      const wz = fr.z - fr.tz * trailBack + fr.rz * side;
      const scale = moving ? (0.38 + f * 1.12) * activeIntensity : (0.26 + f * 0.36) * 0.22;
      _euler.set(0, state.yaw, 0);
      _quat.setFromEuler(_euler);
      _mat.compose(_pos.set(wx, waveY + 0.022, wz), _quat, _scl.set(scale, 1, scale * 1.16));
      wakeMesh.setMatrixAt(i, _mat);
    }

    // Bamboo pole water-entry splash & drive ripple rings (6..7)
    const stepDt = Math.max(0, dt || 0);
    for (let s = 0; s < 2; s++) {
      const idx = 6 + s;
      const sr = splashRings[s];
      if (sr.active) {
        sr.age += stepDt * 0.88;
        // Gently drift ripple with downstream current
        sr.x += fr.tx * stepDt * 0.32;
        sr.z += fr.tz * stepDt * 0.32;
        if (sr.age >= 1.32) {
          sr.active = false;
        }
      }
      if (sr.active) {
        const life = sr.age / 1.32;
        const env = Math.sin(Math.min(1, life) * Math.PI);
        const scale = (0.24 + life * 1.18) * (0.55 + 0.45 * env);
        _euler.set(0, state.yaw, 0);
        _quat.setFromEuler(_euler);
        _mat.compose(_pos.set(sr.x, waveY + 0.024, sr.z), _quat, _scl.set(scale, 1, scale));
        wakeMesh.setMatrixAt(idx, _mat);
      } else {
        _quat.identity();
        _mat.compose(_pos.set(fr.x, waveY - 2.0, fr.z), _quat, _scl.set(0.001, 0.001, 0.001));
        wakeMesh.setMatrixAt(idx, _mat);
      }
    }

    // Wet bamboo pole falling water-droplet micro-ripples (8..10)
    for (let d = 0; d < 3; d++) {
      const idx = 8 + d;
      const dr = dripRipples[d];
      if (dr.active) {
        dr.age += stepDt * 1.25;
        dr.x += fr.tx * stepDt * 0.28;
        dr.z += fr.tz * stepDt * 0.28;
        if (dr.age >= 0.92) {
          dr.active = false;
        }
      }
      if (dr.active) {
        const life = dr.age / 0.92;
        const env = Math.sin(Math.min(1, life) * Math.PI);
        const scale = (0.09 + life * 0.44) * (0.50 + 0.50 * env);
        _euler.set(0, state.yaw, 0);
        _quat.setFromEuler(_euler);
        _mat.compose(_pos.set(dr.x, waveY + 0.025, dr.z), _quat, _scl.set(scale, 1, scale));
        wakeMesh.setMatrixAt(idx, _mat);
      } else {
        _quat.identity();
        _mat.compose(_pos.set(fr.x, waveY - 2.0, fr.z), _quat, _scl.set(0.001, 0.001, 0.001));
        wakeMesh.setMatrixAt(idx, _mat);
      }
    }
    wakeMesh.instanceMatrix.needsUpdate = true;
  }

  function couplePoleToHands(dt, elapsedTime) {
    const rig = getAvatarRig();
    if (!rig || !rig.armL || !rig.armR || !rig.body) {
      const p = state.strokePhase;
      const sweep = -Math.cos((p - 0.14) * TAU);
      const carry = cyclicBell(p, 0.88, 0.31);
      const k = state.puntPoseBlend;
      poleMesh.rotation.set(
        lerp(1.02, 0.92 + sweep * 0.42 + carry * 0.18, k),
        lerp(0.14, 0.16 - sweep * 0.10, k),
        lerp(-0.32, -0.36, k),
        'YXZ'
      );
      poleMesh.position.set(
        -0.58,
        0.34 + carry * 0.16 * k,
        lerp(-0.22, -0.18 - sweep * 0.42, k)
      );
      return;
    }

    // Continuous C-infinity punting harmonics:
    // Reach/Catch around p=0.14 -> Submerged power drive p=0.14..0.56 -> Feather lift & level carry p=0.56..1.00..0.14
    const p = state.strokePhase;
    const sweep = -Math.cos((p - 0.14) * TAU);
    const sweepLag = -Math.cos((p - 0.185) * TAU); // Upper shoulder/hand natural follow-through lag
    const drive = cyclicBell(p, 0.38, 0.27);
    const carry = cyclicBell(p, 0.88, 0.31);
    const plant = cyclicBell(p, 0.15, 0.14);
    const str = state.strafeBlend;
    const breath = Math.sin(elapsedTime * 1.65);
    const waveBalance = -state.hullRoll * 0.34;
    const k = state.puntPoseBlend;
    const dBlend = state.driftBlend || 0;

    if (dBlend > 0.72) {
      // 「收篙随波」：竹篙横搁舷边，旅人垂袖负手随溪缓漂
      const hasStep = Number.isFinite(dt) && dt > 0;
      const relaxK = !pose.init ? 1 : (hasStep ? (1 - Math.exp(-8 * Math.min(dt, 0.05))) : 0);
      pose.init = true;
      pose.standX = lerp(pose.standX, 0.0, relaxK);
      pose.standZ = lerp(pose.standZ, 0.08, relaxK);
      pose.bodyLift = lerp(pose.bodyLift, 0.003 * breath, relaxK);
      pose.hipYawOff = lerp(pose.hipYawOff, 0.0, relaxK);
      pose.bodyX = lerp(pose.bodyX, 0.02 + 0.01 * breath, relaxK);
      pose.bodyY = lerp(pose.bodyY, Math.sin(elapsedTime * 0.55) * 0.08, relaxK);
      pose.bodyZ = lerp(pose.bodyZ, waveBalance * 0.8, relaxK);
      pose.armLx = lerp(pose.armLx, -0.14 + 0.02 * breath, relaxK);
      pose.armLz = lerp(pose.armLz, -0.18, relaxK);
      pose.armRx = lerp(pose.armRx, -0.16 + 0.02 * breath, relaxK);
      pose.armRz = lerp(pose.armRz, 0.18, relaxK);
      pose.legLx = lerp(pose.legLx, -0.04, relaxK);
      pose.legRx = lerp(pose.legRx, 0.04, relaxK);
      pose.legSpread = lerp(pose.legSpread, 0.03, relaxK);
      pose.legStride = lerp(pose.legStride, 0, relaxK);

      skiffRig.updateMatrixWorld(true);
      _v.set(pose.standX, 0.06 + pose.bodyLift, pose.standZ).applyMatrix4(skiffRig.matrixWorld);
      rig.group.position.copy(_v);
      rig.group.rotation.set(state.hullPitch * 0.30, state.yaw + pose.hipYawOff, state.hullRoll * 0.32, 'YXZ');
      const hipY = 0.82;
      _euler.set(pose.bodyX, pose.bodyY, pose.bodyZ, 'YXZ');
      _quat.setFromEuler(_euler);
      _v.set(0, hipY, 0).applyQuaternion(_quat);
      rig.body.position.set(-_v.x, hipY - _v.y, -_v.z);
      rig.body.rotation.set(pose.bodyX, pose.bodyY, pose.bodyZ, 'YXZ');
      if (rig.legL) {
        rig.legL.position.set(-0.10, 0.82, 0);
        rig.legL.rotation.set(pose.legLx, 0, -pose.legSpread);
      }
      if (rig.legR) {
        rig.legR.position.set(0.10, 0.82, 0);
        rig.legR.rotation.set(pose.legRx, 0, pose.legSpread);
      }
      rig.armL.rotation.set(pose.armLx, 0, pose.armLz, 'XYZ');
      rig.armR.rotation.set(pose.armRx, 0, pose.armRz, 'XYZ');
      poleMesh.position.set(0.42, 0.30, -1.52);
      poleMesh.rotation.set(1.54, -0.05, 0.04, 'YXZ');
      hasPoleWaterHit = false;
      poleSubmergedPrev = false;
      return;
    }

    // Active punting targets (bow-stance lunge + waist coil + gunwale-clearing starboard pole sweep)
    const actStandX = 0.05 - str * 0.03;
    const actStandZ = 0.27 - 0.042 * sweep + 0.045 * drive;
    const actBodyLift = -0.020 * drive + 0.005 * plant;
    const actHipYaw = -0.17 - 0.14 * (0.5 + 0.5 * sweep) - str * 0.06;
    const actBodyX = 0.055 + 0.195 * drive + 0.03 * plant;
    const actBodyY = 0.07 * plant - 0.22 * (0.5 + 0.5 * sweep) - str * 0.08;
    const actBodyZ = -0.05 * drive + 0.022 * carry + waveBalance;

    const actArmLx = -0.34 + 0.64 * sweep - 0.22 * carry;
    const actArmLz = -0.66 - 0.06 * carry - 0.04 * plant - str * 0.08;
    const actArmRx = -1.22 + 0.38 * sweepLag - 0.52 * drive - 0.26 * plant + 0.22 * carry;
    const actArmRz = -0.88 - 0.12 * drive - 0.08 * plant + 0.12 * carry - str * 0.06;

    const actLegLx = -0.18 - 0.13 * drive + 0.07 * sweep;
    const actLegRx = 0.16 + 0.12 * drive + 0.07 * sweep;
    const actLegSpread = 0.045 + 0.014 * drive;
    const actGripT = 2.28 + 0.20 * drive - 0.18 * carry;

    // Poised river-drift stance (pole cradled diagonally across waist, tip skimming lightly above starboard water)
    const tgtStandX = lerp(0.04, actStandX, k);
    const tgtStandZ = lerp(0.24, actStandZ, k);
    const tgtBodyLift = lerp(0.003 * breath, actBodyLift, k);
    const tgtHipYaw = lerp(-0.20, actHipYaw, k);
    const tgtBodyX = lerp(0.045 + 0.010 * breath, actBodyX, k);
    const tgtBodyY = lerp(-0.08 + 0.016 * Math.sin(elapsedTime * 0.95), actBodyY, k);
    const tgtBodyZ = lerp(0.02 + waveBalance, actBodyZ, k);
    const tgtArmLx = lerp(-0.56 + 0.020 * breath, actArmLx, k);
    const tgtArmLz = lerp(-0.64, actArmLz, k);
    const tgtArmRx = lerp(-1.08 + 0.022 * breath, actArmRx, k);
    const tgtArmRz = lerp(-0.82, actArmRz, k);
    const tgtLegLx = lerp(-0.14, actLegLx, k);
    const tgtLegRx = lerp(0.14, actLegRx, k);
    const tgtLegSpread = lerp(0.04, actLegSpread, k);
    const tgtLegStride = -0.026 * sweep * k;
    const tgtGripT = lerp(2.08, actGripT, k);

    const hasStep = Number.isFinite(dt) && dt > 0;
    const followK = !pose.init ? 1 : (hasStep ? (1 - Math.exp(-14 * Math.min(dt, 0.05))) : 0);
    pose.init = true;
    pose.standX = lerp(pose.standX, tgtStandX, followK);
    pose.standZ = lerp(pose.standZ, tgtStandZ, followK);
    pose.bodyLift = lerp(pose.bodyLift, tgtBodyLift, followK);
    pose.hipYawOff = lerp(pose.hipYawOff, tgtHipYaw, followK);
    pose.bodyX = lerp(pose.bodyX, tgtBodyX, followK);
    pose.bodyY = lerp(pose.bodyY, tgtBodyY, followK);
    pose.bodyZ = lerp(pose.bodyZ, tgtBodyZ, followK);
    pose.armLx = lerp(pose.armLx, tgtArmLx, followK);
    pose.armLz = lerp(pose.armLz, tgtArmLz, followK);
    pose.armRx = lerp(pose.armRx, tgtArmRx, followK);
    pose.armRz = lerp(pose.armRz, tgtArmRz, followK);
    pose.legLx = lerp(pose.legLx, tgtLegLx, followK);
    pose.legRx = lerp(pose.legRx, tgtLegRx, followK);
    pose.legSpread = lerp(pose.legSpread, tgtLegSpread, followK);
    pose.legStride = lerp(pose.legStride, tgtLegStride, followK);
    pose.gripT = lerp(pose.gripT, tgtGripT, followK);

    // Plant feet onto live rocking deck while knees/waist absorb wave motion ("水上功夫")
    skiffRig.updateMatrixWorld(true);
    _v.set(pose.standX, 0.06 + pose.bodyLift, pose.standZ).applyMatrix4(skiffRig.matrixWorld);
    rig.group.position.copy(_v);
    rig.group.rotation.set(
      state.hullPitch * 0.30,
      state.yaw + pose.hipYawOff,
      state.hullRoll * 0.32,
      'YXZ'
    );

    // Pivot upper torso cleanly around waist/hips (y = 0.82) rather than ankles (y = 0)
    // so the robe/hips never detach from the legs or cause vertical head-bobbing pumps
    const hipY = 0.82;
    _euler.set(pose.bodyX, pose.bodyY, pose.bodyZ, 'YXZ');
    _quat.setFromEuler(_euler);
    _v.set(0, hipY, 0).applyQuaternion(_quat);
    rig.body.position.set(-_v.x, hipY - _v.y, -_v.z);
    rig.body.rotation.set(pose.bodyX, pose.bodyY, pose.bodyZ, 'YXZ');
    if (rig.legL) {
      rig.legL.position.set(-0.105, hipY - pose.bodyLift * 0.45, pose.legStride);
      rig.legL.rotation.set(pose.legLx, 0, -pose.legSpread);
    }
    if (rig.legR) {
      rig.legR.position.set(0.105, hipY - pose.bodyLift * 0.45, -pose.legStride);
      rig.legR.rotation.set(pose.legRx, 0, pose.legSpread);
    }
    rig.armL.rotation.set(pose.armLx, 0, pose.armLz, 'XYZ');
    rig.armR.rotation.set(pose.armRx, 0, pose.armRz, 'XYZ');

    rig.group.updateMatrixWorld(true);
    _t1.set(0, -0.51, 0.02).applyMatrix4(rig.armL.matrixWorld);
    _t2.set(0, -0.51, 0.02).applyMatrix4(rig.armR.matrixWorld);
    _dir.subVectors(_t2, _t1);
    const span = _dir.length();
    if (span < 0.08) { restPoleInHull(); return; }
    _dir.multiplyScalar(1 / span);
    _pos.copy(_t1).addScaledVector(_dir, -pose.gripT);

    // Detect exact water-surface intersection of bamboo pole for splash ripples & 3D spatial sound
    const isSubmerged = _pos.y <= state.y + 0.03 && _dir.y > 0.08;
    if (isSubmerged) {
      const tWater = Math.max(0, (state.y - _pos.y) / _dir.y);
      lastPoleWaterX = _pos.x + _dir.x * tWater;
      lastPoleWaterZ = _pos.z + _dir.z * tWater;
      hasPoleWaterHit = true;
      if (!poleSubmergedPrev && k > 0.25) {
        spawnSplashRing(lastPoleWaterX, lastPoleWaterZ);
        poleMidRippleDone = false;
      } else if (!poleMidRippleDone && k > 0.45 && drive > 0.82) {
        spawnSplashRing(lastPoleWaterX, lastPoleWaterZ);
        poleMidRippleDone = true;
      }
    } else {
      hasPoleWaterHit = false;
      poleMidRippleDone = false;
    }
    poleSubmergedPrev = isSubmerged;

    skiffRig.worldToLocal(_pos);
    poleMesh.position.copy(_pos);
    skiffRig.getWorldQuaternion(_qInv).invert();
    _a.copy(_dir).applyQuaternion(_qInv).normalize();
    poleMesh.quaternion.setFromUnitVectors(UNIT_Y, _a);
  }

  function placeSkiffVisuals(elapsedTime, dt = 0.016, deferWake = false) {
    const fr = spineFrame(state.t, state.lat);
    const buoy = sampleHullBuoyancy(fr.tc, fr.x, fr.z, elapsedTime);
    const hasStep = Number.isFinite(dt) && dt > 0;
    const step = hasStep ? Math.min(dt, 0.05) : 0;
    const waveY = (!hullWaveInit || !hasStep)
      ? buoy.y
      : lerp(state.y, buoy.y, 1 - Math.exp(-12 * step));
    hullWaveInit = true;
    state.x = fr.x;
    state.y = waveY;
    state.z = fr.z;
    state.yaw = fr.meshYaw + state.yawOffset;

    const bob = 0.012 + Math.sin(elapsedTime * 0.92) * 0.005;
    const waveRoll = Math.sin(elapsedTime * 1.12) * 0.015 - state.latSpeed * 0.018 + state.strokeRoll;
    const wavePitch = buoy.waveSlopePitch * 0.55 + Math.sin(elapsedTime * 0.92 + 0.6) * 0.009 - Math.min(0.026, Math.abs(state.speed) * 0.0045) + state.strokePitch;
    const attK = hasStep ? (1 - Math.exp(-6.2 * step)) : 0;
    state.hullRoll = lerp(state.hullRoll, waveRoll, attK);
    state.hullPitch = lerp(state.hullPitch, wavePitch, attK);

    skiffRig.position.set(fr.x, waveY + bob, fr.z);
    skiffRig.rotation.set(state.hullPitch, state.yaw, state.hullRoll, 'YXZ');
    if (!state.aboard) restPoleInHull();

    if (!deferWake) {
      updateWakeVisuals(fr, waveY, step);
    }
  }

  function syncPlayerAndCamera(playerState, camera, dt, elapsedTime, freeCam, deferWake = false) {
    if (!playerState || !state.aboard) return;
    const fr = spineFrame(state.t, state.lat);
    const standLocalZ = 0.24;
    const px = fr.x + fr.tx * standLocalZ;
    const pz = fr.z + fr.tz * standLocalZ;
    const hasStep = Number.isFinite(dt) && dt > 0;
    const step = hasStep ? Math.min(dt, 0.05) : 0;
    // Gently float camera deck with slow river swell so boat & rower stay poised in frame without horizon jitter
    const targetDeckY = waterLevel + 0.072 + (state.y - waterLevel) * 0.82;
    const smoothK = hasStep ? (1 - Math.exp(-5.5 * step)) : 0;
    state.smoothDeckY = Number.isFinite(state.smoothDeckY)
      ? lerp(state.smoothDeckY, targetDeckY, smoothK)
      : targetDeckY;

    playerState.still = true;
    playerState.aboardSkiff = true;
    playerState.bob = 0;
    playerState.bobAmount = 0;
    playerState.wading = false;
    playerState.x = px;
    playerState.y = state.smoothDeckY;
    playerState.z = pz;
    playerState.vx = fr.tx * state.speed + fr.rx * state.latSpeed;
    playerState.vz = fr.tz * state.speed + fr.rz * state.latSpeed;
    playerState.speed = Math.hypot(playerState.vx, playerState.vz);
    state.lastSyncedX = px;
    state.lastSyncedZ = pz;

    if (!freeCam && camera) {
      boundCtx?.player?.syncCamera?.(camera);
      if (playerState.view === 'first' && state.aboard && camera.rotation) {
        const heavePitchOff = Math.max(-0.008, Math.min(0.008, state.strokePitch * 0.24));
        const heaveRollOff = Math.max(-0.008, Math.min(0.008, state.hullRoll * 0.16));
        camera.rotation.x += heavePitchOff;
        camera.rotation.z += heaveRollOff;
      }
    }
    const avatar = boundCtx?.avatar;
    if (avatar) {
      avatar.update(step, elapsedTime, {
        ...playerState,
        y: state.y + 0.06,
        vx: 0,
        vz: 0,
        yaw: state.yaw + Math.PI
      });
      couplePoleToHands(step, elapsedTime);
      if (avatar.group) {
        avatar.group.visible = playerState.view === 'third' &&
          playerState.camDist >= (world?.player?.view?.third?.hideDistance ?? 0.9);
      }
    } else {
      couplePoleToHands(step, elapsedTime);
    }
    if (!deferWake) {
      updateWakeVisuals(fr, state.y, step);
    }
  }

  function isBlockedPoint(x, z) {
    const list = boundCtx?.blockers || [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const ca = Math.cos(b.rot || 0);
      const sa = Math.sin(b.rot || 0);
      const dx = x - b.x;
      const dz = z - b.z;
      const lx = dx * ca - dz * sa;
      const lz = dx * sa + dz * ca;
      if (Math.abs(lx) < (b.hw || 0) + 0.55 && Math.abs(lz) < (b.hd || 0) + 0.55) return true;
    }
    return false;
  }

  function findLandingSpot() {
    const fr = spineFrame(state.t, state.lat);
    const minDryY = state.t >= 0.83 ? waterLevel + 0.65 : waterLevel + 0.30;
    const maxSlope = state.t >= 0.83 ? 0.34 : 0.48;
    const candidates = [];

    // Near headwaters: prioritize dry east bank leading straight to cave slit
    if (state.t >= 0.83) {
      candidates.push(
        [4.5, 20.0],
        [7.0, 20.0],
        [3.0, 23.0],
        [6.0, 24.0],
        [2.0, 21.5]
      );
    }
    // Along current river station: search closer bank first from current hull position
    const signs = state.lat < 0 ? [-1, 1] : [1, -1];
    for (const sign of signs) {
      for (const d of [3.5, 5, 6.5, 8, 10, 12.5, 15, 18, 22]) {
        for (const along of [0, 3.0, -3.0]) {
          candidates.push([
            fr.x + fr.rx * sign * d + fr.tx * along,
            fr.z + fr.rz * sign * d + fr.tz * along
          ]);
        }
      }
    }
    if (world?.player?.spawn) candidates.push([world.player.spawn.x, world.player.spawn.z]);

    for (const [cx, cz] of candidates) {
      const y = field ? field.sample(cx, cz) : 0;
      const sl = field?.slope ? field.slope(cx, cz) : 0;
      if (y >= minDryY && sl <= maxSlope && !isBlockedPoint(cx, cz)) {
        return { x: cx, y, z: cz };
      }
    }
    if (state.t < 0.83) {
      for (const [cx, cz] of candidates) {
        const y = field ? field.sample(cx, cz) : 0;
        const sl = field?.slope ? field.slope(cx, cz) : 0;
        if (y >= waterLevel + 0.14 && sl <= 0.62 && !isBlockedPoint(cx, cz)) {
          return { x: cx, y, z: cz };
        }
      }
    }
    return { x: 4.5, y: field ? field.sample(4.5, 20) : 2, z: 20 };
  }

  function moorTowardSpot(spot) {
    if (!spot) return;
    let bestT = state.t;
    let bestLat = state.lat;
    let bestScore = Infinity;
    const tMin = Math.max(0.06, state.t - 0.09);
    const tMax = Math.min(0.908, state.t + 0.09);
    for (let tt = tMin; tt <= tMax + 1e-6; tt += 0.004) {
      for (let ll = -11.0; ll <= 11.0 + 1e-6; ll += 0.45) {
        if (!channelSafe(tt, ll)) continue;
        const fr = spineFrame(tt, ll);
        const d = Math.hypot(fr.x - spot.x, fr.z - spot.z);
        const shorePenalty = d < 2.15 ? (2.15 - d) * 4.0 : 0;
        const score = Math.abs(d - 3.4) + shorePenalty + Math.abs(tt - state.t) * 2.5;
        if (score < bestScore) {
          bestScore = score;
          bestT = tt;
          bestLat = ll;
        }
      }
    }
    state.t = bestT;
    state.lat = bestLat;
  }

  function board(immediateSync = false) {
    if (disposed || state.aboard) return false;
    state.aboard = true;
    state.speed = 0.52;
    state.latSpeed = 0;
    state.yawVel = 0;
    state.strafeBlend = 0;
    state.keyCooldown = 0.25;
    state.strokePhase = 0.06;
    state.strokeSounded = false;
    state.puntPoseBlend = 0.16;
    state.drifting = false;
    state.driftManual = false;
    state.driftBlend = 0;
    state.idleTimer = 0;
    state.rainNoteShown = false;
    hullWaveInit = false;
    pose.init = false;
    poleSubmergedPrev = false;
    poleMidRippleDone = false;
    hasPoleWaterHit = false;
    clearPoleDrops();
    placeSkiffVisuals(lastVisualTime, 0, true);
    state.smoothDeckY = waterLevel + 0.072 + (state.y - waterLevel) * 0.82;
    const playerState = boundCtx?.player?.state;
    const fr = spineFrame(state.t, state.lat);
    if (playerState) {
      playerState.still = true;
      playerState.aboardSkiff = true;
      if (immediateSync) {
        playerState.yaw = fr.forwardYaw;
        playerState.targetYaw = fr.forwardYaw;
        playerState.camYaw = fr.forwardYaw;
        playerState.pitch = -0.04;
        playerState.targetPitch = -0.04;
        playerState.camPitch = -0.04;
      }
      syncPlayerAndCamera(playerState, boundCtx?.camera, 0, lastVisualTime, false);
    } else {
      updateWakeVisuals(fr, state.y, 0);
    }
    syncHint(true);
    return true;
  }

  function disembark() {
    if (disposed || !state.aboard) return null;
    const spot = findLandingSpot();
    state.aboard = false;
    state.speed = 0;
    state.latSpeed = 0;
    state.yawVel = 0;
    state.punting = false;
    state.puntPoseBlend = 0;
    state.drifting = false;
    state.driftManual = false;
    state.driftBlend = 0;
    state.idleTimer = 0;
    state.hasDisembarkedOnce = true;
    state.keyCooldown = 0.25;
    state.lastSyncedX = null;
    state.lastSyncedZ = null;
    keys.clear();

    moorTowardSpot(spot);
    hullWaveInit = false;
    clearPoleDrops();
    resetAvatarPose();
    placeSkiffVisuals(lastVisualTime, 0);

    const playerState = boundCtx?.player?.state;
    if (playerState) {
      playerState.still = false;
      playerState.aboardSkiff = false;
      playerState.x = spot.x;
      playerState.z = spot.z;
      playerState.y = spot.y;
      playerState.vx = 0;
      playerState.vz = 0;
      playerState.speed = 0;
      let aimYaw = playerState.yaw || 0;
      if (state.t >= 0.83 && cliff?.slit) {
        const dx = cliff.slit.x - spot.x;
        const dz = cliff.slit.z - spot.z;
        aimYaw = Math.atan2(-dx, -dz);
      } else {
        const dx = spot.x - state.x;
        const dz = spot.z - state.z;
        aimYaw = Math.atan2(-dx, -dz);
      }
      playerState.yaw = aimYaw;
      playerState.targetYaw = aimYaw;
      playerState.camYaw = aimYaw;
      playerState.pitch = -0.05;
      playerState.targetPitch = -0.05;
      playerState.camPitch = -0.05;
      playerState.focus = false;
      playerState.focusTarget = null;
      playerState.shoulderK = 0;
      boundCtx?.avatar?.update?.(0.016, simTime, playerState);
      if (boundCtx?.camera) boundCtx.player?.syncCamera?.(boundCtx.camera);
    }
    syncHint(false);
    showNote(
      state.t >= 0.83
        ? '便舍船，从口入——浅滩系舟，前山石缝隐约有光。'
        : '轻舟靠岸，系缆芳草间。'
    );
    return spot;
  }

  function pickSkiffTarget(camera) {
    const playerState = boundCtx?.player?.state;
    if (!playerState || !camera || playerState.godFlight || boundCtx?.doc?.body?.classList?.contains?.('god-flight') || isModalPause(boundCtx?.doc)) return null;
    const eye = camera.position;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

    if (!state.aboard) {
      const ty = state.y + 0.35;
      const dx = state.x - eye.x;
      const dy = ty - eye.y;
      const dz = state.z - eye.z;
      const camDist = Math.hypot(dx, dy, dz);
      const camDot = (dx * forward.x + dy * forward.y + dz * forward.z) / (camDist || 1);

      const pdx = state.x - playerState.x;
      const pdy = ty - ((playerState.y ?? waterLevel) + 1.45);
      const pdz = state.z - playerState.z;
      const planar = Math.hypot(pdx, pdz);
      const playerEyeDist = Math.hypot(pdx, pdy, pdz);
      const pFwdDot = planar > 0.001
        ? (pdx * (-Math.sin(playerState.yaw || 0)) + pdz * (-Math.cos(playerState.yaw || 0))) / planar
        : 1;

      const dist = Math.min(camDist, playerEyeDist);
      const dot = Math.max(camDot, pFwdDot);
      const inRange = (planar <= 11.2 && camDist <= 15.0 && dot >= 0.32) ||
        (planar <= 6.2 && dot >= 0.08) ||
        planar <= 4.0;
      if (!inRange) return null;
      return {
        kind: 'mystery',
        key: 'skiff:board',
        isSkiff: true,
        noCameraLock: true,
        skiffAction: 'board',
        name: '武陵渔舟',
        label: '武陵渔舟',
        prompt: '登舟泛溪 · 武陵渔舟',
        x: state.x,
        y: ty,
        z: state.z,
        dist,
        dot,
        score: planar * 0.85 + (1 - Math.max(0, dot)) * 3.8
      };
    }

    // While aboard, only trigger mystery target when arriving at headwaters or glancing at bow
    const fr = spineFrame(state.t, state.lat);
    const bx = state.x + fr.tx * 1.4;
    const by = state.y + 0.25;
    const bz = state.z + fr.tz * 1.4;
    const dx = bx - eye.x;
    const dy = by - eye.y;
    const dz = bz - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / (dist || 1);
    const atHeadwaters = state.t >= 0.875;
    if (!atHeadwaters && dot < 0.72) return null;
    return {
      kind: 'mystery',
      key: 'skiff:disembark',
      isSkiff: true,
      noCameraLock: true,
      skiffAction: 'disembark',
      name: '武陵渔舟',
      label: '武陵渔舟',
      prompt: atHeadwaters ? '便舍船，从口入 · 登岸寻光' : '舍船登岸 · 踏上溪畔',
      x: bx,
      y: by,
      z: bz,
      dist,
      dot,
      score: atHeadwaters ? 0.8 : dist + (1 - dot) * 4.0
    };
  }

  function toggleDrift() {
    if (disposed || !state.aboard) return false;
    state.driftManual = !state.driftManual;
    state.drifting = state.driftManual;
    state.idleTimer = state.driftManual ? 4.0 : 0;
    showNote(
      state.driftManual
        ? '横篙舷上，任一叶扁舟随溪风流花缓漂。'
        : '重执青竹篙，点水溯流而行。',
      3.8
    );
    return state.drifting;
  }

  let listenersAttached = false;
  function attachListeners(win) {
    if (!win || listenersAttached) return;
    listenersAttached = true;
    const onKeyDown = e => {
      if (disposed) return;
      const doc = boundCtx?.doc || globalThis.document;
      const target = e.target;
      const inControl = target && (target.isContentEditable ||
        (typeof target.closest === 'function' && target.closest('input, textarea, select, button, a[href], [contenteditable]')));
      if (e.ctrlKey || e.metaKey || e.altKey || inControl || boundCtx?.player?.state?.godFlight || doc?.body?.classList?.contains?.('god-flight') || isModalPause(doc)) return;
      if (/^(KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowLeft|ArrowDown|ArrowRight|ShiftLeft|ShiftRight)$/.test(e.code)) {
        keys.add(e.code);
      }
      if (e.code === 'KeyX' && state.aboard && !e.repeat && !e.defaultPrevented) {
        e.preventDefault();
        toggleDrift();
        return;
      }
      if (e.code === 'KeyE') {
        if (e.repeat || e.defaultPrevented || state.keyCooldown > 0) return;
        if (state.aboard) {
          e.preventDefault();
          disembark();
        } else {
          const t = pickSkiffTarget(boundCtx?.camera);
          if (t?.skiffAction === 'board') {
            e.preventDefault();
            board(false);
          }
        }
      }
    };
    const onKeyUp = e => keys.delete(e.code);
    const onBlur = () => keys.clear();
    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('keyup', onKeyUp);
    win.addEventListener('blur', onBlur);
    boundCtx._cleanup = () => {
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
      win.removeEventListener('blur', onBlur);
      listenersAttached = false;
    };
  }

  function bind(ctx = {}) {
    if (disposed) return;
    if (boundCtx?._cleanup) boundCtx._cleanup();
    boundCtx = {
      player: ctx.player || null,
      avatar: ctx.avatar || null,
      camera: ctx.camera || null,
      mysteries: ctx.mysteries || null,
      sound: ctx.sound || null,
      blockers: ctx.blockers || [],
      hintEl: ctx.hintEl || null,
      doc: ctx.doc || globalThis.document,
      win: ctx.win || globalThis.window
    };

    const m = boundCtx.mysteries;
    if (m && !m._skiffWrapped) {
      m._skiffWrapped = true;
      const prevPick = m.pickTarget.bind(m);
      const prevInteract = m.interact.bind(m);
      const prevHide = m.hide.bind(m);
      m.pickTarget = (cam, cfg) => {
        const base = prevPick(cam, cfg);
        const own = pickSkiffTarget(cam);
        if (!base) return own;
        if (!own) return base;
        return own.score < base.score ? own : base;
      };
      m.interact = target => {
        if (target?.isSkiff) {
          return target.skiffAction === 'board' ? board(false) : disembark();
        }
        return prevInteract(target);
      };
      m.hide = () => {
        clearNote();
        return prevHide();
      };
    }

    attachListeners(boundCtx.win);

    if (ctx.autoBoard) {
      state.t = 0.435;
      state.lat = -1.2;
      hullWaveInit = false;
      placeSkiffVisuals(lastVisualTime, 0);
      board(true);
    } else {
      state.aboard = false;
      state.t = 0.438;
      state.lat = 1.8;
      const cl = clampChannel(state.t, state.lat);
      state.t = cl.t;
      state.lat = cl.lat;
      hullWaveInit = false;
      placeSkiffVisuals(lastVisualTime, 0);
    }
  }

  function update(dt, elapsed, sky, playerState, camera, freeCam = false) {
    if (disposed) return;
    if (noteTimer > 0 && dt > 0) {
      noteTimer = Math.max(0, noteTimer - dt);
      if (noteTimer <= 0) clearNote();
    }
    if (!Number.isFinite(dt) || dt <= 0) {
      if (state.aboard && boundCtx?.avatar) {
        couplePoleToHands(0, lastVisualTime);
      }
      return;
    }
    const step = Math.min(dt, 0.05);
    simTime += step;
    const tVisual = elapsed ?? simTime;
    lastVisualTime = tVisual;
    if (state.keyCooldown > 0) state.keyCooldown = Math.max(0, state.keyCooldown - step);
    updateBowLantern(sky, tVisual);

    const ps = playerState || boundCtx?.player?.state;
    // Detect external teleport (__APP__.teleport / dev tool) and release cleanly without overwriting
    if (state.aboard && ps && state.lastSyncedX !== null &&
        Math.hypot(ps.x - state.lastSyncedX, ps.z - state.lastSyncedZ) > 3.2) {
      state.aboard = false;
      state.speed = 0;
      state.latSpeed = 0;
      state.yawVel = 0;
      state.punting = false;
      state.puntPoseBlend = 0;
      state.lastSyncedX = null;
      state.lastSyncedZ = null;
      ps.still = false;
      ps.aboardSkiff = false;
      clearPoleDrops();
      resetAvatarPose();
      syncHint(false);
      placeSkiffVisuals(tVisual, step);
      return;
    }

    const flightPaused = Boolean(freeCam || ps?.godFlight || boundCtx?.doc?.body?.classList?.contains?.('god-flight'));
    if (flightPaused && keys.size) keys.clear();
    if (state.aboard && !flightPaused && !isModalPause(boundCtx?.doc)) {
      const keyFwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
                     (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const keyStrafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
                        (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const tFwd = Number.isFinite(ps?.touchMoveZ) ? ps.touchMoveZ : 0;
      const tStrafe = Number.isFinite(ps?.touchMoveX) ? ps.touchMoveX : 0;
      const fwd = Math.max(-1, Math.min(1, keyFwd + tFwd));
      const strafe = Math.max(-1, Math.min(1, keyStrafe + tStrafe));
      const shift = keys.has('ShiftLeft') || keys.has('ShiftRight') || Boolean(ps?.touchSprint);
      const activeMove = Math.abs(fwd) > 0.08 || Math.abs(strafe) > 0.08;
      const prevPhaseForDrops = state.strokePhase;

      if (activeMove) {
        state.idleTimer = 0;
        state.driftManual = false;
        state.drifting = false;
      } else {
        state.idleTimer += step;
        if (state.driftManual || state.idleTimer >= 3.2) {
          state.drifting = true;
        }
      }
      state.driftBlend += ((state.drifting ? 1 : 0) - state.driftBlend) * (1 - Math.exp(-4.5 * step));

      // 雨天「舟中听雨」：雨打船尾箬篷近耳笃笃声景
      const rainLevel = Math.max(0, Math.min(1, Number(sky?.rainIntensity ?? 0) || (sky?.weatherId === 'rain' ? 0.65 : 0)));
      if (rainLevel > 0.14) {
        state.canopyRainTimer -= step;
        if (state.canopyRainTimer <= 0) {
          state.canopyRainTimer = 0.12 + (1 - rainLevel) * 0.22 + (simTime * 13 % 0.09);
          const frCanopy = spineFrame(state.t, state.lat);
          pendingEvents.push({
            type: 'canopyRain',
            x: frCanopy.x - frCanopy.tx * 0.95 + (Math.sin(simTime * 19.3) * 0.35),
            z: frCanopy.z - frCanopy.tz * 0.95 + (Math.cos(simTime * 17.1) * 0.35),
            intensity: 0.45 + 0.55 * rainLevel
          });
        }
        if (state.drifting && !state.rainNoteShown) {
          state.rainNoteShown = true;
          showNote('雨打箬篷声声慢，收篙卧听满溪烟。', 4.8);
        }
      } else {
        state.rainNoteShown = false;
      }

      state.punting = activeMove;
      state.puntPoseBlend += ((activeMove ? 1 : 0) - state.puntPoseBlend) *
        (1 - Math.exp(-(activeMove ? 7.2 : 3.8) * step));
      state.strafeBlend += (strafe - state.strafeBlend) * (1 - Math.exp(-7.5 * step));
      if (fwd !== 0) state.strokeDir = fwd < 0 ? -1 : 1;
      else if (activeMove) state.strokeDir = 1;

      const strokeRate = shift ? 0.88 : 0.70;
      let surgePulse = 0;
      let plantPulse = 0;
      let heavePitch = 0;
      let heelingRoll = 0;
      if (activeMove) {
        const prevPhase = state.strokePhase;
        const dirSign = state.strokeDir < 0 ? -0.86 : 1;
        state.strokePhase = ((state.strokePhase + dirSign * step * strokeRate) % 1 + 1) % 1;
        if (dirSign > 0) {
          if (state.strokePhase < prevPhase) state.strokeSounded = false;
          if (state.strokePhase >= 0.11 && !state.strokeSounded) {
            state.strokeSounded = true;
            pendingEvents.push({
              type: 'boatPole',
              x: hasPoleWaterHit ? lastPoleWaterX : state.x,
              z: hasPoleWaterHit ? lastPoleWaterZ : state.z,
              intensity: shift ? 1.0 : 0.78
            });
          }
        } else {
          if (state.strokePhase > prevPhase) state.strokeSounded = false;
          if (state.strokePhase <= 0.54 && !state.strokeSounded) {
            state.strokeSounded = true;
            pendingEvents.push({
              type: 'boatPole',
              x: hasPoleWaterHit ? lastPoleWaterX : state.x,
              z: hasPoleWaterHit ? lastPoleWaterZ : state.z,
              intensity: shift ? 0.92 : 0.72
            });
          }
        }
        const drive = cyclicBell(state.strokePhase, 0.36, 0.25);
        const plant = cyclicBell(state.strokePhase, 0.14, 0.12);
        surgePulse = Math.pow(drive, 0.76);
        plantPulse = plant;
        heavePitch = (drive * 0.015 - plant * 0.007) * (fwd || 0.55);
        heelingRoll = drive * 0.016;
      } else {
        state.strokeSounded = false;
        // Finish lifting the bamboo pole forward naturally instead of reversing mid-stroke
        if (state.puntPoseBlend > 0.04 && state.strokePhase > 0.08 && state.strokePhase < 0.90) {
          state.strokePhase = (state.strokePhase + step * 0.48) % 1;
        }
      }

      const slowAtShoal = 1 - 0.70 * Math.max(0, Math.min(1, (state.t - 0.85) / 0.055));
      if (activeMove) {
        const current = state.t >= 0.896 ? 0 : 0.74 * slowAtShoal;
        let targetSpeed = current;
        let accelRate = 0.82;
        if (fwd > 0.08) {
          const fwdScale = 0.35 + 0.65 * Math.min(1, Math.abs(fwd));
          const glideBase = (shift ? 4.8 : 3.7) * fwdScale * (0.35 + 0.65 * slowAtShoal);
          const pushPeak = (shift ? 6.85 : 5.55) * fwdScale;
          if (surgePulse > 0.06) {
            targetSpeed = glideBase + (pushPeak - glideBase) * surgePulse - plantPulse * glideBase * 0.18;
            accelRate = 5.6;
          } else if (plantPulse > 0.08) {
            // Pole catch/plant: momentary water resistance & bow dip before riverbed surge
            targetSpeed = glideBase * (1 - 0.18 * plantPulse);
            accelRate = 2.6;
          } else {
            // Silky hydrodynamic recovery glide between strokes
            targetSpeed = glideBase * 0.92;
            accelRate = 0.90;
          }
        } else if (fwd < -0.08) {
          const revScale = 0.40 + 0.60 * Math.min(1, Math.abs(fwd));
          targetSpeed = (surgePulse > 0.04 ? -(2.0 + 1.4 * surgePulse) : -1.5) * revScale;
          accelRate = surgePulse > 0.04 ? 4.4 : 0.95;
        }
        state.speed += (targetSpeed - state.speed) * (1 - Math.exp(-accelRate * step));

        const latThrust = strafe * 2.55 * (0.45 + 0.75 * surgePulse);
        state.latSpeed += (latThrust - state.latSpeed) * (1 - Math.exp(-3.1 * step));

        const targetYawOff = -strafe * 0.11 + surgePulse * (fwd >= 0 ? 0.016 : -0.016);
        const yawAcc = (targetYawOff - state.yawOffset) * 18.0 - state.yawVel * 5.8;
        state.yawVel += yawAcc * step;
        state.yawOffset = Math.max(-0.22, Math.min(0.22, state.yawOffset + state.yawVel * step));

        state.strokePitch += (heavePitch - state.strokePitch) * (1 - Math.exp(-7.5 * step));
        state.strokeRoll += ((heelingRoll - strafe * 0.032) - state.strokeRoll) * (1 - Math.exp(-6.5 * step));
      } else {
        // Silky coasting momentum along Wuling Stream toward gentle natural river drift
        const coastDrift = state.t >= 0.896 ? 0 : 0.42 * slowAtShoal;
        state.speed += (coastDrift - state.speed) * (1 - Math.exp(-0.78 * step));
        const glideRelax = Math.exp(-2.4 * step);
        state.latSpeed *= glideRelax;
        state.yawOffset *= glideRelax;
        state.yawVel *= glideRelax;
        state.strokePitch *= glideRelax;
        state.strokeRoll *= glideRelax;
      }

      const nextT = state.t + (state.speed * step) / curveLength;
      const nextLat = state.lat + state.latSpeed * step;
      const res = clampChannel(nextT, nextLat);
      state.t = res.t;
      state.lat = res.lat;
      if (res.blocked) {
        state.speed *= 0.35;
        state.latSpeed *= 0.25;
      }
      if (state.t >= 0.908 && state.speed > 0) state.speed = 0;

      state.wakeAge = (state.wakeAge + step * (0.45 + Math.abs(state.speed) * 0.25 + surgePulse * 0.35)) % 1;
      placeSkiffVisuals(tVisual, step, true);
      if (ps) {
        syncPlayerAndCamera(ps, camera, step, tVisual, freeCam, true);
      } else {
        couplePoleToHands(step, tVisual);
      }

      const frNow = spineFrame(state.t, state.lat);
      if (state.strokePhase < prevPhaseForDrops - 0.3 || (state.strokePhase >= 0.12 && state.strokePhase < 0.50)) {
        dripStageMask = 0;
      }
      if (poleSubmergedPrev || (state.punting && state.strokePhase >= 0.14 && state.strokePhase <= 0.52)) {
        poleWasWetInStroke = true;
      }
      if (poleWasWetInStroke && state.puntPoseBlend > 0.3 && state.strokeDir >= 0) {
        for (let d = 0; d < 3; d++) {
          const bit = 1 << d;
          const th = DRIP_PHASES[d];
          if (!(dripStageMask & bit) && prevPhaseForDrops < th && state.strokePhase >= th) {
            dripStageMask |= bit;
            spawnPoleDroplet(DRIP_SHAFT_OFFSETS[d], frNow);
            if (dripStageMask === 7) poleWasWetInStroke = false;
          }
        }
      }
      updatePoleDroplets(step, frNow, state.y);
      updateWakeVisuals(frNow, state.y, step);
      updateLanternFish(frNow, state.y, tVisual);
    } else {
      state.punting = false;
      const hullRelax = state.aboard ? Math.exp(-2.4 * step) : Math.exp(-4.5 * step);
      state.speed *= hullRelax;
      state.latSpeed *= hullRelax;
      state.strafeBlend *= hullRelax;
      state.yawOffset *= hullRelax;
      state.yawVel *= hullRelax;
      state.strokePitch *= hullRelax;
      state.strokeRoll *= hullRelax;
      state.puntPoseBlend *= hullRelax;
      state.wakeAge = (state.wakeAge + step * 0.18) % 1;
      placeSkiffVisuals(tVisual, step, true);
      if (state.aboard && ps) {
        syncPlayerAndCamera(ps, camera, step, tVisual, flightPaused, true);
      }
      const frNow = spineFrame(state.t, state.lat);
      updatePoleDroplets(step, frNow, state.y);
      updateWakeVisuals(frNow, state.y, step);
      updateLanternFish(frNow, state.y, tVisual);
    }
  }

  function consumeEvents() {
    if (!pendingEvents.length) return [];
    const out = pendingEvents.slice();
    pendingEvents.length = 0;
    return out;
  }

  function getAnchor() {
    return { x: state.x, y: state.y + 0.35, z: state.z };
  }

  function isAboard() {
    return state.aboard;
  }

  function getStats() {
    let tris = 0;
    let drawCalls = 0;
    for (const m of [hullMesh, poleMesh, wakeMesh, poleDropsMesh, bowLanternGlow, lanternFishMesh]) {
      if (!m.visible) continue;
      const t = (m.geometry.index?.count || m.geometry.attributes.position.count) / 3;
      tris += t * (m.isInstancedMesh ? m.count : 1);
      drawCalls++;
    }
    let activeDrops = 0;
    for (let i = 0; i < POLE_DROP_COUNT; i++) {
      if (poleDrops[i].active) activeDrops++;
    }
    return {
      built: true,
      aboard: state.aboard,
      t: Math.round(state.t * 10000) / 10000,
      lat: Math.round(state.lat * 1000) / 1000,
      x: Math.round(state.x * 100) / 100,
      y: Math.round(state.y * 100) / 100,
      z: Math.round(state.z * 100) / 100,
      speed: Math.round(state.speed * 100) / 100,
      punting: state.punting,
      drifting: state.drifting,
      driftBlend: Math.round(state.driftBlend * 100) / 100,
      hasDisembarkedOnce: state.hasDisembarkedOnce,
      lanternLit: bowLanternGlow.visible,
      lanternFishVisible: lanternFishMesh.visible,
      activeDrops,
      drawCalls,
      triangles: Math.round(tris)
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    boundCtx?._cleanup?.();
    pendingEvents.length = 0;
    hullGeo.dispose();
    poleGeo.dispose();
    lanternGlowGeo.dispose();
    lanternFishGeo.dispose();
    wakeGeo.dispose();
    dropGeo.dispose();
    woodMat.dispose();
    lanternGlowMat.dispose();
    lanternFishMat.dispose();
    wakeMat.dispose();
    dropMat.dispose();
    group.removeFromParent();
  }

  placeSkiffVisuals(0, 0);

  return {
    group,
    bind,
    update,
    board,
    disembark,
    toggleDrift,
    isAboard,
    isDrifting: () => state.drifting,
    getAnchor,
    consumeEvents,
    getStats,
    dispose
  };
}
