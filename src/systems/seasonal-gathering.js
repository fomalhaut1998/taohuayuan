import * as THREE from 'three';
import { habitatSurface, habitatSiteSafe } from '../world/habitat-details.js';
import { interactionAllowed, mysteryUiPaused, storyBusy } from './mysteries.js';
import { sightBlocked } from './observation.js';

const TAU = Math.PI * 2;

const FIREFLY_NOTES = [
  '轻罗小扇扑流萤——夏夜池畔凉风微动，竹篓腰囊已盛进几点清光。',
  '荷风暗度萤火浮，轻扑数点入行囊，照见水岸露华微凉。'
];

const SHOOT_NOTES = [
  '雨后新雷动，竹根泥裂尖笋生——小锄轻挑，背篓里已添一把脆嫩春笋。',
  '穿林掘得玉版笋，带露带泥入背篓，正好回村煨一釜春笋汤。'
];

function createPartToolGeometry(parts) {
  const positions = [];
  const colors = [];
  const normals = [];
  const col = new THREE.Color();

  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    g.computeVertexNormals();
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    col.set(part.color);
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      colors.push(col.r, col.g, col.b);
    }
    if (part.geo.index) g.dispose();
    part.geo.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}

function buildFanGeometry() {
  const handle = new THREE.CylinderGeometry(0.011, 0.014, 0.24, 6);
  handle.translate(0, 0.10, 0.02);
  handle.rotateX(0.32);

  const rim = new THREE.CylinderGeometry(0.115, 0.115, 0.012, 10);
  rim.scale(1.0, 1.0, 0.85);
  rim.rotateZ(Math.PI * 0.5);
  rim.rotateY(Math.PI * 0.5);
  rim.translate(0, 0.27, 0.14);

  const weave = new THREE.BoxGeometry(0.008, 0.17, 0.18);
  weave.translate(0, 0.27, 0.14);

  return createPartToolGeometry([
    { geo: handle, color: '#6E5236' },
    { geo: rim, color: '#8C6E45' },
    { geo: weave, color: '#D3BE7C' }
  ]);
}

function buildHoeGeometry() {
  const shaft = new THREE.CylinderGeometry(0.012, 0.014, 0.52, 6);
  shaft.translate(0, 0.02, 0.18);
  shaft.rotateX(Math.PI * 0.44);

  const collar = new THREE.BoxGeometry(0.036, 0.036, 0.044);
  collar.translate(0, 0.055, 0.42);

  const blade = new THREE.BoxGeometry(0.088, 0.11, 0.016);
  blade.rotateX(0.28);
  blade.translate(0, 0.005, 0.44);

  return createPartToolGeometry([
    { geo: shaft, color: '#745638' },
    { geo: collar, color: '#4B4138' },
    { geo: blade, color: '#4D5258' }
  ]);
}

function buildShootTipGeometry() {
  const base = new THREE.ConeGeometry(0.055, 0.25, 6);
  base.translate(0, 0.125, 0);
  const sheath = new THREE.ConeGeometry(0.062, 0.12, 6);
  sheath.translate(0, 0.06, 0);
  return createPartToolGeometry([
    { geo: sheath, color: '#7D6344' },
    { geo: base, color: '#BFD376' }
  ]);
}

function buildMoundGeometry() {
  const mound = new THREE.CylinderGeometry(0.16, 0.25, 0.08, 7);
  mound.translate(0, 0.03, 0);
  const crackA = new THREE.BoxGeometry(0.18, 0.045, 0.06);
  crackA.rotateZ(0.22);
  crackA.translate(-0.08, 0.055, 0.02);
  const crackB = new THREE.BoxGeometry(0.16, 0.045, 0.06);
  crackB.rotateZ(-0.24);
  crackB.translate(0.08, 0.055, -0.02);
  return createPartToolGeometry([
    { geo: mound, color: '#5D4632' },
    { geo: crackA, color: '#4B3827' },
    { geo: crackB, color: '#4B3827' }
  ]);
}

function readWeatherState(sky) {
  const app = sky?.getAppearance?.();
  const rain = Math.max(0, Math.min(1, Number(sky?.rainIntensity ?? app?.rainIntensity ?? 0) || 0));
  const weatherId = sky?.weatherId ?? app?.weatherId ?? (rain > 0.25 ? 'rain' : 'clear');
  const timeId = sky?.timeId ?? app?.timeId ?? 'day';
  const sunEl = sky?.sunElevation ?? app?.sunElevation;
  const isDuskOrNight = timeId === 'night' || timeId === 'dusk' || (Number.isFinite(sunEl) && sunEl < 0.08);
  return { rain, weatherId, timeId, isDuskOrNight };
}

export function createSeasonalGathering(options = {}) {
  const { world, field, pondLife, leisureGrove } = options;
  const group = new THREE.Group();
  group.name = 'seasonal-gathering';

  const surface = (x, z) => (field ? habitatSurface(field, x, z) : 0);
  const pond = world?.terrain?.pond;

  // ============================================================================
  // 1. 池畔流萤采扑点（3组池岸位置，24只萤火虫实体，skyIgnore=true）
  // ============================================================================
  const fireflySites = [];
  if (pond) {
    const baseR = pond.waterRadius || pond.radius || 8.5;
    const placements = pondLife?.layout?.placements || [];
    for (const ang of [-2.45, -1.35, 1.75, 0.65, -0.35, 2.55]) {
      if (fireflySites.length >= 3) break;
      for (const rOff of [0.8, 1.5, 2.2]) {
        const fx = pond.x + Math.cos(ang) * (baseR + rOff);
        const fz = pond.z + Math.sin(ang) * (baseR + rOff);
        const fy = surface(fx, fz);
        if (!Number.isFinite(fy) || fy < pond.waterY + 0.06 || fy > pond.waterY + 1.5) continue;
        const clear = placements.every(p => Math.hypot(fx - p.x, fz - p.z) > (p.radius || 0.7) + 0.9);
        if (!clear) continue;
        fireflySites.push({
          id: `pond-fireflies-${fireflySites.length}`,
          kind: 'firefly',
          x: fx,
          y: fy,
          z: fz,
          cooldown: 0,
          seed: fireflySites.length * 1.9 + 0.7
        });
        break;
      }
    }
    if (!fireflySites.length) {
      fireflySites.push({
        id: 'pond-fireflies-0',
        kind: 'firefly',
        x: pond.x + baseR + 1.1,
        y: surface(pond.x + baseR + 1.1, pond.z),
        z: pond.z,
        cooldown: 0,
        seed: 0.7
      });
    }
  }

  const FIREFLIES_PER_SITE = 8;
  const FIREFLY_COUNT = Math.max(1, fireflySites.length) * FIREFLIES_PER_SITE;
  const fireflyGeo = new THREE.OctahedronGeometry(0.036, 0);
  const fireflyMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.94 });
  fireflyMat.userData.skyIgnore = true;
  const fireflyMesh = new THREE.InstancedMesh(fireflyGeo, fireflyMat, FIREFLY_COUNT);
  fireflyMesh.name = 'pond-fireflies';
  fireflyMesh.userData.dynamic = true;
  fireflyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fireflyMesh.frustumCulled = false;
  fireflyMesh.visible = false;
  group.add(fireflyMesh);

  const ffPalette = ['#D9FA6D', '#F3EE7E', '#B8F35B'];
  const tmpColor = new THREE.Color();
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    fireflyMesh.setColorAt(i, tmpColor.set(ffPalette[i % ffPalette.length]));
  }
  if (fireflyMesh.instanceColor) fireflyMesh.instanceColor.needsUpdate = true;

  // ============================================================================
  // 2. 后山竹林春笋挖掘点（5丛破土春笋 + 掘土溅泥碎块）
  // ============================================================================
  const bambooRegions = (leisureGrove?.layout?.regions || []).filter(r => r.kind === 'bamboo');
  const bambooCenter = bambooRegions[0] || options.bambooCenter || { x: -24, z: -92, radius: 7.5 };
  const bambooBlockers = leisureGrove?.blockers || [];
  const shootOffsets = [
    [-1.4, 1.3],
    [1.1, 1.9],
    [-2.5, -0.7],
    [2.1, -1.2],
    [0.2, 2.9]
  ];
  const shootSites = [];
  for (let i = 0; i < shootOffsets.length; i++) {
    const [ox, oz] = shootOffsets[i];
    let sx = bambooCenter.x + ox;
    let sz = bambooCenter.z + oz;
    if (!bambooRegions.length && field && !habitatSiteSafe(null, sx, sz, 0.4)) {
      sx = bambooCenter.x + ox * 0.7;
      sz = bambooCenter.z + oz * 0.7;
    }
    // Slight step-out if directly intersecting a blocker
    for (const b of bambooBlockers) {
      if (Math.hypot(sx - b.x, sz - b.z) < 0.85) {
        sx += (ox >= 0 ? 0.9 : -0.9);
        sz += (oz >= 0 ? 0.9 : -0.9);
      }
    }
    shootSites.push({
      id: `bamboo-shoots-${i}`,
      kind: 'bamboo',
      x: sx,
      y: surface(sx, sz),
      z: sz,
      cooldown: 0,
      seed: i * 1.37 + 0.3
    });
  }

  const SHOOT_CLUSTER_COUNT = shootSites.length;
  const moundGeo = buildMoundGeometry();
  const shootGeo = buildShootTipGeometry();
  const shootMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  const moundMesh = new THREE.InstancedMesh(moundGeo, shootMat, SHOOT_CLUSTER_COUNT);
  moundMesh.name = 'bamboo-shoot-mounds';
  moundMesh.userData.dynamic = true;
  moundMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  moundMesh.frustumCulled = false;
  moundMesh.receiveShadow = true;
  group.add(moundMesh);

  const shootMesh = new THREE.InstancedMesh(shootGeo, shootMat, SHOOT_CLUSTER_COUNT * 2);
  shootMesh.name = 'bamboo-shoots';
  shootMesh.userData.dynamic = true;
  shootMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shootMesh.frustumCulled = false;
  shootMesh.receiveShadow = true;
  group.add(shootMesh);

  const DIRT_COUNT = 16;
  const dirtGeo = new THREE.BoxGeometry(0.042, 0.036, 0.042);
  const dirtMat = new THREE.MeshLambertMaterial({ color: '#5A432E', flatShading: true });
  const dirtMesh = new THREE.InstancedMesh(dirtGeo, dirtMat, DIRT_COUNT);
  dirtMesh.name = 'bamboo-dig-splash';
  dirtMesh.userData.dynamic = true;
  dirtMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dirtMesh.frustumCulled = false;
  dirtMesh.visible = false;
  group.add(dirtMesh);

  // ============================================================================
  // 3. 手持农具与行囊采集物（第三人称右臂/腰间/背篓 + 第一人称视效）
  // ============================================================================
  const toolMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const fanGeo = buildFanGeometry();
  const hoeGeo = buildHoeGeometry();

  // Third-person tool rig (attached dynamically on bind() to player-arm-r / player-body)
  const tpToolPivot = new THREE.Group();
  tpToolPivot.name = 'sg-tp-hand-pivot';
  tpToolPivot.position.set(0, -0.50, 0.04);

  const tpFanMesh = new THREE.Mesh(fanGeo, toolMat);
  tpFanMesh.name = 'sg-tp-fan';
  tpFanMesh.visible = false;
  const tpHoeMesh = new THREE.Mesh(hoeGeo, toolMat);
  tpHoeMesh.name = 'sg-tp-hoe';
  tpHoeMesh.visible = false;
  tpToolPivot.add(tpFanMesh, tpHoeMesh);

  const pouchGroup = new THREE.Group();
  pouchGroup.name = 'sg-waist-pouch';
  pouchGroup.position.set(-0.165, 0.78, 0.13);
  pouchGroup.visible = false;
  const pouchShellGeo = new THREE.CylinderGeometry(0.055, 0.068, 0.11, 7);
  const pouchShellMat = new THREE.MeshLambertMaterial({ color: '#B49E6E', flatShading: true });
  const pouchShell = new THREE.Mesh(pouchShellGeo, pouchShellMat);
  const pouchGlowGeo = new THREE.OctahedronGeometry(0.038, 0);
  const pouchGlowMat = new THREE.MeshBasicMaterial({ color: '#E2F974' });
  pouchGlowMat.userData.skyIgnore = true;
  const pouchGlow = new THREE.Mesh(pouchGlowGeo, pouchGlowMat);
  pouchGlow.position.set(0, 0.015, 0.038);
  pouchGroup.add(pouchShell, pouchGlow);

  const basketShootsGroup = new THREE.Group();
  basketShootsGroup.name = 'sg-basket-shoots';
  basketShootsGroup.position.set(0.158, 0.94, -0.252);
  basketShootsGroup.visible = false;
  const basketShootMeshes = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(shootGeo, shootMat);
    const a = (i / 4) * TAU + 0.4;
    m.position.set(Math.cos(a) * 0.045, 0, Math.sin(a) * 0.045);
    m.rotation.set(Math.sin(a) * 0.25, a, -Math.cos(a) * 0.25);
    m.scale.setScalar(0.68);
    m.visible = false;
    basketShootsGroup.add(m);
    basketShootMeshes.push(m);
  }

  // First-person subtle right-hand viewmodel (kept in group, synced to camera pose)
  const fpRig = new THREE.Group();
  fpRig.name = 'sg-fp-viewmodel';
  fpRig.visible = false;
  const fpToolPivot = new THREE.Group();
  fpToolPivot.position.set(0.24, -0.22, -0.40);
  const fpFanMesh = new THREE.Mesh(fanGeo, toolMat);
  fpFanMesh.visible = false;
  const fpHoeMesh = new THREE.Mesh(hoeGeo, toolMat);
  fpHoeMesh.visible = false;
  fpToolPivot.add(fpFanMesh, fpHoeMesh);
  fpRig.add(fpToolPivot);
  group.add(fpRig);

  // ============================================================================
  // 4. 运行状态与交互绑定
  // ============================================================================
  const tmpPos = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const setInst = (mesh, idx, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    tmpPos.set(x, y, z);
    tmpEuler.set(rx, ry, rz, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpScale.set(sx, sy, sz);
    tmpM.compose(tmpPos, tmpQuat, tmpScale);
    mesh.setMatrixAt(idx, tmpM);
  };
  const zeroInst = (mesh, count) => {
    tmpPos.set(0, -50, 0);
    tmpQuat.identity();
    tmpScale.set(0, 0, 0);
    tmpM.compose(tmpPos, tmpQuat, tmpScale);
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, tmpM);
  };
  zeroInst(fireflyMesh, FIREFLY_COUNT);
  zeroInst(moundMesh, SHOOT_CLUSTER_COUNT);
  zeroInst(shootMesh, SHOOT_CLUSTER_COUNT * 2);
  zeroInst(dirtMesh, DIRT_COUNT);

  {
    const fBox = new THREE.Box3();
    for (const s of fireflySites) fBox.expandByPoint(tmpPos.set(s.x, s.y + 0.6, s.z));
    if (!fBox.isEmpty()) {
      fBox.expandByScalar(2.6);
      fireflyMesh.boundingSphere = fBox.getBoundingSphere(new THREE.Sphere());
      fireflyMesh.frustumCulled = true;
    }
    const sBox = new THREE.Box3();
    for (const s of shootSites) sBox.expandByPoint(tmpPos.set(s.x, s.y + 0.15, s.z));
    if (!sBox.isEmpty()) {
      sBox.expandByScalar(1.6);
      const shootSphere = sBox.getBoundingSphere(new THREE.Sphere());
      moundMesh.boundingSphere = shootSphere;
      moundMesh.frustumCulled = true;
      shootMesh.boundingSphere = shootSphere;
      shootMesh.frustumCulled = true;
    }
    dirtMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.8);
    dirtMesh.frustumCulled = true;
  }

  let lastShootActiveCount = -1;
  let lastWetBoost = null;
  let lastReadyMask = -1;

  let boundCtx = null;
  let simTime = 0;
  let wetSoilTimer = 0;
  let currentTool = 'none';
  let fireflyActive = false;
  let shootActiveCount = 0;
  let fireflyCount = 0;
  let shootCount = 0;
  let swingTimer = 0;
  let swingDur = 0.65;
  let swingKind = 'none';
  let splashTimer = 0;
  let splashOrigin = { x: 0, y: 0, z: 0 };
  let noteTimer = 0;
  let noteActive = false;
  let noteIndex = 0;
  let lastAction = null;
  let disposed = false;

  function showGatheringNote(text) {
    const doc = boundCtx?.doc || globalThis.document;
    const note = doc?.getElementById?.('mystery-note');
    noteTimer = 4.5;
    noteActive = true;
    if (note) {
      note.textContent = text;
      note.classList?.add?.('show');
    }
  }

  function hideGatheringNote() {
    if (!noteActive) return;
    noteActive = false;
    noteTimer = 0;
    const doc = boundCtx?.doc || globalThis.document;
    const note = doc?.getElementById?.('mystery-note');
    note?.classList?.remove?.('show');
  }

  function pickGatheringTarget(camera, cfg) {
    if (disposed || !boundCtx) return null;
    const doc = boundCtx.doc;
    if (!interactionAllowed(null, doc) || storyBusy(doc) || mysteryUiPaused(doc)) return null;
    const st = boundCtx.player?.state;
    if (!st) return null;

    const third = st.view === 'third';
    const eye = {
      x: third ? st.x : (camera?.position?.x ?? st.x),
      y: third ? st.y + (st.eyeHeight || 1.65) : (camera?.position?.y ?? st.y + 1.65),
      z: third ? st.z : (camera?.position?.z ?? st.z)
    };
    const cp = Math.cos(st.pitch || 0);
    const forward = {
      x: -Math.sin(st.yaw || 0) * cp,
      y: Math.sin(st.pitch || 0),
      z: -Math.cos(st.yaw || 0) * cp
    };

    const env = readWeatherState(boundCtx.sky);
    const wetBoost = env.rain > 0.1 || env.weatherId === 'mist' || wetSoilTimer > 0;
    const activeCount = shootActiveCount;
    const alignBias = cfg?.alignBias ?? 2;
    let best = null;

    if (fireflyActive) {
      for (const site of fireflySites) {
        if (site.cooldown > 0) continue;
        const ty = site.y + 0.85;
        const dx = site.x - eye.x, dy = ty - eye.y, dz = site.z - eye.z;
        const dist = Math.hypot(dx, dy, dz);
        const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / (dist || 1);
        if (Math.hypot(site.x - st.x, site.z - st.z) > 3.6 || dist > 4.2 || dot < 0.72) continue;
        if (boundCtx.field && boundCtx.blockers && sightBlocked(eye, { x: site.x, y: ty, z: site.z }, boundCtx.blockers, boundCtx.field)) continue;
        const score = dist + (1 - dot) * alignBias;
        if (!best || score < best.score) {
          best = {
            kind: 'mystery',
            key: 'sg:' + site.id,
            isGathering: true,
            gatherKind: 'firefly',
            siteId: site.id,
            name: '池畔流萤',
            label: '池畔流萤',
            prompt: '执扇轻扑 · 池畔流萤',
            x: site.x,
            y: ty,
            z: site.z,
            dist,
            dot,
            score
          };
        }
      }
    }

    if (activeCount > 0) {
      for (let i = 0; i < Math.min(activeCount, shootSites.length); i++) {
        const site = shootSites[i];
        if (site.cooldown > 0) continue;
        const ty = site.y + 0.18;
        const dx = site.x - eye.x, dy = ty - eye.y, dz = site.z - eye.z;
        const dist = Math.hypot(dx, dy, dz);
        const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / (dist || 1);
        if (Math.hypot(site.x - st.x, site.z - st.z) > 3.6 || dist > 4.2 || dot < 0.72) continue;
        if (boundCtx.field && boundCtx.blockers && sightBlocked(eye, { x: site.x, y: ty, z: site.z }, boundCtx.blockers, boundCtx.field)) continue;
        const score = dist + (1 - dot) * alignBias;
        if (!best || score < best.score) {
          best = {
            kind: 'mystery',
            key: 'sg:' + site.id,
            isGathering: true,
            gatherKind: 'bamboo',
            siteId: site.id,
            name: '竹林春笋',
            label: '竹林春笋',
            prompt: wetBoost ? '执锄采挖 · 雨后春笋' : '执锄采挖 · 林间春笋',
            x: site.x,
            y: ty,
            z: site.z,
            dist,
            dot,
            score
          };
        }
      }
    }
    return best;
  }

  function performGather(target) {
    if (disposed || !boundCtx || !target || !target.isGathering) return null;
    const doc = boundCtx.doc;
    if (!interactionAllowed(null, doc) || storyBusy(doc) || mysteryUiPaused(doc)) return null;

    if (target.gatherKind === 'firefly') {
      if (!fireflyActive) return null;
      const site = fireflySites.find(s => s.id === target.siteId);
      if (!site || site.cooldown > 0) return null;
      site.cooldown = 14;
      fireflyCount++;
      currentTool = 'fan';
      swingKind = 'fan';
      swingDur = 0.65;
      swingTimer = 0.65;
      try {
        const u = boundCtx.sound?.unlock?.();
        if (u?.catch) u.catch(() => {});
        boundCtx.sound?.gatherSound?.('fan', site.x, site.z);
      } catch (_) {}
      const text = FIREFLY_NOTES[noteIndex % FIREFLY_NOTES.length];
      noteIndex++;
      showGatheringNote(text);
      lastAction = { id: site.id, kind: 'firefly', tool: 'fan', count: fireflyCount, line: text };
      return lastAction;
    }

    if (target.gatherKind === 'bamboo') {
      const idx = shootSites.findIndex(s => s.id === target.siteId);
      if (idx < 0 || idx >= shootActiveCount) return null;
      const site = shootSites[idx];
      if (site.cooldown > 0) return null;
      const env = readWeatherState(boundCtx.sky);
      const wetBoost = env.rain > 0.1 || env.weatherId === 'mist' || wetSoilTimer > 0;
      site.cooldown = wetBoost ? 12 : 26;
      shootCount++;
      currentTool = 'hoe';
      swingKind = 'hoe';
      swingDur = 0.72;
      swingTimer = 0.72;
      splashTimer = 0.55;
      splashOrigin = { x: site.x, y: site.y, z: site.z };
      try {
        const u = boundCtx.sound?.unlock?.();
        if (u?.catch) u.catch(() => {});
        boundCtx.sound?.gatherSound?.('hoe', site.x, site.z);
      } catch (_) {}
      const text = SHOOT_NOTES[noteIndex % SHOOT_NOTES.length];
      noteIndex++;
      showGatheringNote(text);
      lastAction = { id: site.id, kind: 'bamboo', tool: 'hoe', count: shootCount, line: text };
      return lastAction;
    }

    return null;
  }

  function bind(ctx = {}) {
    if (disposed) return [];
    boundCtx = {
      avatar: ctx.avatar || null,
      camera: ctx.camera || null,
      player: ctx.player || null,
      sky: ctx.sky || null,
      mysteries: ctx.mysteries || null,
      sound: ctx.sound || null,
      field: ctx.field || field || null,
      blockers: ctx.blockers || [],
      doc: ctx.doc || globalThis.document
    };

    const roots = [];
    const avatarGroup = ctx.avatar?.group;
    if (avatarGroup) {
      const armR = avatarGroup.getObjectByName('player-arm-r');
      const body = avatarGroup.getObjectByName('player-body');
      if (armR && tpToolPivot.parent !== armR) armR.add(tpToolPivot);
      if (body) {
        if (pouchGroup.parent !== body) body.add(pouchGroup);
        if (basketShootsGroup.parent !== body) body.add(basketShootsGroup);
      }
      roots.push(tpToolPivot, pouchGroup, basketShootsGroup);
    }

    const m = ctx.mysteries;
    if (m && !m._sgWrapped) {
      m._sgWrapped = true;
      const basePick = m.pickTarget.bind(m);
      const baseInteract = m.interact.bind(m);
      const baseHide = m.hide.bind(m);
      m.pickTarget = function (camera, cfg) {
        const a = basePick(camera, cfg);
        const b = pickGatheringTarget(camera, cfg);
        if (!a) return b;
        if (!b) return a;
        return b.score < a.score ? b : a;
      };
      m.interact = function (target) {
        if (target?.isGathering) return performGather(target);
        return baseInteract(target);
      };
      m.hide = function () {
        hideGatheringNote();
        return baseHide();
      };
    }

    return roots;
  }

  function applyVisuals(activeSky, st, cam) {
    const env = readWeatherState(activeSky);
    const wetBoost = env.rain > 0.1 || env.weatherId === 'mist' || wetSoilTimer > 0;
    fireflyActive = env.isDuskOrNight && env.rain < 0.22 && fireflySites.length > 0;
    shootActiveCount = env.timeId === 'night'
      ? 0
      : (env.isDuskOrNight && env.timeId === 'dusk' ? 0 : (wetBoost ? SHOOT_CLUSTER_COUNT : 3));

    // Update pond fireflies
    if (fireflyActive) {
      fireflyMesh.visible = true;
      for (let si = 0; si < fireflySites.length; si++) {
        const s = fireflySites[si];
        const cooling = s.cooldown > 0;
        for (let k = 0; k < FIREFLIES_PER_SITE; k++) {
          const idx = si * FIREFLIES_PER_SITE + k;
          if (cooling) {
            setInst(fireflyMesh, idx, 0, -50, 0, 0, 0, 0);
            continue;
          }
          const ph = simTime * (0.85 + (k % 3) * 0.22) + s.seed + k * 0.9;
          const ox = Math.sin(ph) * (0.45 + (k % 2) * 0.35);
          const oz = Math.cos(ph * 0.78 + k) * (0.45 + (k % 3) * 0.25);
          const oy = s.y + 0.55 + Math.sin(ph * 1.45) * 0.32 + (k % 2) * 0.22;
          const pulse = 0.65 + 0.55 * (0.5 + 0.5 * Math.sin(simTime * 5.2 + k * 1.7 + s.seed));
          setInst(fireflyMesh, idx, s.x + ox, oy, s.z + oz, pulse, pulse, pulse, ph, ph * 0.5, 0);
        }
      }
      fireflyMesh.instanceMatrix.needsUpdate = true;
    } else {
      fireflyMesh.visible = false;
    }

    // Update bamboo shoots + cracked mounds (only upload matrices when active count/wetness/cooldown state changes)
    const shootScale = wetBoost ? 1.2 : 0.88;
    const anyShoots = shootActiveCount > 0;
    moundMesh.visible = true;
    shootMesh.visible = anyShoots;
    let readyMask = 0;
    for (let i = 0; i < SHOOT_CLUSTER_COUNT; i++) {
      if (i < shootActiveCount && shootSites[i].cooldown <= 0) readyMask |= (1 << i);
    }
    if (shootActiveCount !== lastShootActiveCount || wetBoost !== lastWetBoost || readyMask !== lastReadyMask) {
      lastShootActiveCount = shootActiveCount;
      lastWetBoost = wetBoost;
      lastReadyMask = readyMask;
      for (let i = 0; i < SHOOT_CLUSTER_COUNT; i++) {
        const s = shootSites[i];
        const active = i < shootActiveCount;
        const ready = active && s.cooldown <= 0;
        const mScale = active ? (wetBoost ? 1.12 : 0.92) : 0.72;
        setInst(moundMesh, i, s.x, s.y, s.z, mScale, mScale, mScale, 0, s.seed, 0);
        for (let k = 0; k < 2; k++) {
          const slot = i * 2 + k;
          if (!ready) {
            setInst(shootMesh, slot, 0, -50, 0, 0, 0, 0);
          } else {
            const a = s.seed + k * 2.1;
            const d = k === 0 ? 0.04 : 0.11;
            const sc = shootScale * (k === 0 ? 1.0 : 0.76);
            setInst(shootMesh, slot, s.x + Math.cos(a) * d, s.y + 0.03, s.z + Math.sin(a) * d, sc, sc, sc, k === 0 ? 0.04 : -0.08, a, 0.05);
          }
        }
      }
      moundMesh.instanceMatrix.needsUpdate = true;
      shootMesh.instanceMatrix.needsUpdate = true;
    }

    // Update dig dirt splash burst
    if (splashTimer > 0) {
      dirtMesh.visible = true;
      dirtMesh.boundingSphere.center.set(splashOrigin.x, splashOrigin.y + 0.3, splashOrigin.z);
      const p = 1 - splashTimer / 0.55;
      for (let i = 0; i < DIRT_COUNT; i++) {
        const a = (i / DIRT_COUNT) * TAU + p * 0.4;
        const speedR = 0.35 + (i % 3) * 0.22;
        const r = speedR * p;
        const py = splashOrigin.y + Math.max(0, 0.48 * p - 0.85 * p * p + 0.06);
        const s = Math.max(0.01, (1 - p) * 1.15);
        setInst(dirtMesh, i, splashOrigin.x + Math.cos(a) * r, py, splashOrigin.z + Math.sin(a) * r, s, s, s, p * 4, a, p * 3);
      }
      dirtMesh.instanceMatrix.needsUpdate = true;
    } else {
      dirtMesh.visible = false;
    }

    // Auto tool switching near sites
    if (st && Number.isFinite(st.x) && Number.isFinite(st.z)) {
      let minFire = Infinity;
      if (fireflyActive) {
        for (const s of fireflySites) {
          const d = Math.hypot(s.x - st.x, s.z - st.z);
          if (d < minFire) minFire = d;
        }
      }
      let minShoot = Infinity;
      if (shootActiveCount > 0) {
        for (let i = 0; i < Math.min(shootActiveCount, shootSites.length); i++) {
          const s = shootSites[i];
          const d = Math.hypot(s.x - st.x, s.z - st.z);
          if (d < minShoot) minShoot = d;
        }
      }

      const desiredTool =
        fireflyActive && minFire <= 14 ? 'fan'
        : (shootActiveCount > 0 && minShoot <= 14 ? 'hoe' : 'none');
      if (
        swingTimer > 0 &&
        ((desiredTool !== 'none' && desiredTool !== swingKind) ||
          (swingKind === 'fan' && !fireflyActive) ||
          (swingKind === 'hoe' && shootActiveCount <= 0))
      ) {
        swingTimer = 0;
      }
      if (swingTimer <= 0) {
        currentTool = desiredTool;
      }

      const swNorm = swingTimer > 0 ? Math.sin((1 - swingTimer / swingDur) * Math.PI) : 0;
      const third = st.view === 'third';

      // Third-person tools & waist/basket collectibles
      tpFanMesh.visible = currentTool === 'fan';
      tpHoeMesh.visible = currentTool === 'hoe';
      if (swingKind === 'hoe' && swingTimer > 0) {
        const chop = Math.sin((1 - swingTimer / swingDur) * TAU) * 0.85;
        tpToolPivot.rotation.set(-0.2 + chop, 0, 0);
      } else {
        tpToolPivot.rotation.set(-0.25 - swNorm * 0.65, swNorm * 0.72, swNorm * 0.35);
      }

      pouchGroup.visible = fireflyActive || fireflyCount > 0;
      const glowPulse = fireflyCount > 0 ? 1.15 + Math.sin(simTime * 5) * 0.25 : 0.45;
      pouchGlow.scale.setScalar(glowPulse);

      basketShootsGroup.visible = shootCount > 0;
      for (let i = 0; i < basketShootMeshes.length; i++) {
        basketShootMeshes[i].visible = i < shootCount;
      }

      // First-person subtle right-hand viewmodel
      const showFp = !third && currentTool !== 'none' && cam && (Math.min(minFire, minShoot) < 6.5 || swingTimer > 0);
      fpRig.visible = Boolean(showFp);
      if (showFp && cam) {
        fpRig.position.copy(cam.position);
        fpRig.quaternion.copy(cam.quaternion);
        fpFanMesh.visible = currentTool === 'fan';
        fpHoeMesh.visible = currentTool === 'hoe';
        if (swingKind === 'hoe' && swingTimer > 0) {
          const dig = Math.sin((1 - swingTimer / swingDur) * TAU) * 0.75;
          fpToolPivot.rotation.set(-0.35 + dig, -0.25, 0.12);
        } else {
          fpToolPivot.rotation.set(-0.28 - swNorm * 0.55, -0.35 + swNorm * 0.85, 0.1 + swNorm * 0.3);
        }
      }
    }
  }

  applyVisuals(null, null, null);

  function update(dt, elapsed, sky, playerState, camera) {
    if (disposed) return;
    const doc = boundCtx?.doc || globalThis.document;
    if (doc && mysteryUiPaused(doc)) {
      hideGatheringNote();
      return;
    }
    if (!Number.isFinite(dt) || dt <= 0) return;

    const activeSky = sky || boundCtx?.sky;
    const st = playerState || boundCtx?.player?.state;
    const cam = camera || boundCtx?.camera;
    const step = Math.min(dt, 0.05);
    const env = readWeatherState(activeSky);

    simTime += step;
    if (env.rain > 0.12 || env.weatherId === 'mist') {
      wetSoilTimer = Math.max(wetSoilTimer, 60);
    } else if (wetSoilTimer > 0) {
      wetSoilTimer = Math.max(0, wetSoilTimer - step);
    }

    for (const s of fireflySites) {
      if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - step);
    }
    for (const s of shootSites) {
      if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - step);
    }
    if (swingTimer > 0) swingTimer = Math.max(0, swingTimer - step);
    if (splashTimer > 0) splashTimer = Math.max(0, splashTimer - step);
    if (noteActive) {
      if (doc && storyBusy(doc)) {
        hideGatheringNote();
      } else if (lastAction?.kind === 'firefly' && !(env.isDuskOrNight && env.rain < 0.22)) {
        hideGatheringNote();
      } else if (noteTimer > 0) {
        noteTimer = Math.max(0, noteTimer - step);
        if (noteTimer <= 0) hideGatheringNote();
      }
    }

    applyVisuals(activeSky, st, cam);
  }

  function getStats() {
    return {
      built: true,
      currentTool,
      fireflyActive,
      fireflySites: fireflySites.map(s => ({ id: s.id, x: s.x, y: s.y, z: s.z, cooldown: s.cooldown })),
      shootActiveCount,
      shootSites: shootSites.map(s => ({ id: s.id, x: s.x, y: s.y, z: s.z, cooldown: s.cooldown })),
      fireflyCount,
      shootCount,
      wetSoilTimer,
      lastAction,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    hideGatheringNote();
    fireflyGeo.dispose();
    fireflyMat.dispose();
    moundGeo.dispose();
    shootGeo.dispose();
    shootMat.dispose();
    dirtGeo.dispose();
    dirtMat.dispose();
    fanGeo.dispose();
    hoeGeo.dispose();
    toolMat.dispose();
    pouchShellGeo.dispose();
    pouchShellMat.dispose();
    pouchGlowGeo.dispose();
    pouchGlowMat.dispose();
    tpToolPivot.removeFromParent();
    pouchGroup.removeFromParent();
    basketShootsGroup.removeFromParent();
    group.removeFromParent();
  }

  return {
    group,
    bind,
    update,
    getStats,
    dispose
  };
}
