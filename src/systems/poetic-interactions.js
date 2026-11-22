import * as THREE from 'three';
import { habitatSurface } from '../world/habitat-details.js';
import { interactionAllowed, mysteryUiPaused, storyBusy } from './mysteries.js';

const TAU = Math.PI * 2;
const CONTROL_SELECTOR = 'input, textarea, select, button, a[href], [contenteditable], [role="button"], [role="textbox"], [role="slider"]';
const PENTATONIC_NAMES = ['宫', '商', '角', '徵', '羽'];
const PENTATONIC_MOODS = [
  '宫音浑厚沉静，如远岫生云',
  '商音清亮疏朗，似秋林风度',
  '角音温润生发，若春涧初融',
  '徵音明快欣畅，映日暖桑麻',
  '羽音澄澈幽远，随流泉入竹'
];

const FLOAT_CAPACITY = 10;
const SKIP_CAPACITY = 4;
const MOTE_CAPACITY = 28;
const GUIDE_PARTS = 14;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a) {
  let d = a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function angleLerp(a, b, k) {
  return a + wrapAngle(b - a) * Math.min(1, k);
}

function buildFloatingLeafGeometry() {
  // Folded green bamboo-leaf skiff cradling two pink peach petals (12 tris)
  const pos = [];
  const col = [];
  const idx = [];
  let v = 0;
  const cLeaf = new THREE.Color('#6D9454');
  const cLeafTip = new THREE.Color('#8AB068');
  const cPetal = new THREE.Color('#F3B4C2');
  const cPetalCore = new THREE.Color('#DF7E94');

  const addV = (x, y, z, c) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
    return v++;
  };

  const bow = addV(0, 0.036, 0.19, cLeafTip);
  const stern = addV(0, 0.032, -0.19, cLeafTip);
  const keelF = addV(0, 0.002, 0.08, cLeaf);
  const keelB = addV(0, 0.002, -0.08, cLeaf);
  const rimLF = addV(-0.068, 0.028, 0.07, cLeafTip);
  const rimLB = addV(-0.064, 0.026, -0.07, cLeaf);
  const rimRF = addV(0.068, 0.028, 0.07, cLeafTip);
  const rimRB = addV(0.064, 0.026, -0.07, cLeaf);

  idx.push(
    bow, rimLF, keelF,
    bow, keelF, rimRF,
    rimLF, rimLB, keelB,
    rimLF, keelB, keelF,
    rimRF, keelF, keelB,
    rimRF, keelB, rimRB,
    stern, keelB, rimLB,
    stern, rimRB, keelB
  );

  // Two delicate peach petals resting inside the bamboo leaf
  for (let p = 0; p < 2; p++) {
    const oz = p === 0 ? 0.035 : -0.035;
    const ox = p === 0 ? -0.012 : 0.014;
    const p0 = addV(ox, 0.022, oz - 0.028, cPetalCore);
    const p1 = addV(ox - 0.032, 0.030, oz + 0.008, cPetal);
    const p2 = addV(ox + 0.032, 0.030, oz + 0.012, cPetal);
    const p3 = addV(ox, 0.034, oz + 0.038, cPetal);
    idx.push(p0, p1, p2, p1, p3, p2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function buildFlatStoneGeometry() {
  const g = new THREE.CylinderGeometry(0.065, 0.072, 0.022, 7, 1);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const cTop = new THREE.Color('#6C777A');
  const cRim = new THREE.Color('#4E585B');
  for (let i = 0; i < count; i++) {
    const c = g.attributes.position.getY(i) > 0 ? cTop : cRim;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function buildSoftMoteGeometry() {
  const g = new THREE.OctahedronGeometry(0.075, 0);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 1;
    colors[i * 3 + 2] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function buildGuideBlockGeometry() {
  // Chamfered low-poly unit prism for articulated child + yellow puppy (1 draw call)
  const g = new THREE.BoxGeometry(1, 1, 1);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const shade = g.attributes.position.getY(i) > 0 ? 1.0 : 0.86;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export function createPoeticInteractions(options = {}) {
  const ctx = {
    world: options.world || null,
    field: options.field || null,
    riverCurve: options.riverCurve || null,
    riverSpine: options.riverSpine || [],
    distanceToRiver: options.distanceToRiver || null,
    stream: options.stream || null,
    player: options.player || null,
    camera: options.camera || null,
    sky: options.sky || null,
    sound: options.sound || null,
    mysteries: options.mysteries || null,
    inkAtmosphere: options.inkAtmosphere || null,
    easterEggs: options.easterEggs || null,
    situationalRest: options.situationalRest || null,
    villagerDialogue: options.villagerDialogue || null,
    people: options.people || null,
    communityLife: options.communityLife || null,
    village: options.village || null,
    shelters: options.shelters || [],
    blockers: options.blockers || [],
    outerWilds: options.outerWilds || null,
    valleyBorderlands: options.valleyBorderlands || null,
    deepHollows: options.deepHollows || null,
    wildsEasterEggs: options.wildsEasterEggs || null,
    oxPlowing: options.oxPlowing || null,
    waterworks: options.waterworks || null,
    journal: options.journal || null,
    doc: options.doc || (typeof document !== 'undefined' ? document : null),
    win: options.win || (typeof window !== 'undefined' ? window : null)
  };

  const group = new THREE.Group();
  group.name = 'poetic-interactions';
  const interiorGroup = new THREE.Group();
  interiorGroup.name = 'poetic-interactions-interior';
  const sharedGroup = new THREE.Group();
  sharedGroup.name = 'poetic-interactions-shared';
  group.add(interiorGroup, sharedGroup);

  const lambertMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide
  });
  const moteMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false
  });
  moteMat.userData.skyIgnore = true;

  const floatGeo = buildFloatingLeafGeometry();
  const skipGeo = buildFlatStoneGeometry();
  const moteGeo = buildSoftMoteGeometry();
  const guideGeo = buildGuideBlockGeometry();

  const floatingMesh = new THREE.InstancedMesh(floatGeo, lambertMat, FLOAT_CAPACITY);
  floatingMesh.name = 'poetic-floating-tokens';
  floatingMesh.frustumCulled = false;
  floatingMesh.visible = false;
  floatingMesh.count = 0;
  floatingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sharedGroup.add(floatingMesh);

  const skipMesh = new THREE.InstancedMesh(skipGeo, lambertMat, SKIP_CAPACITY);
  skipMesh.name = 'poetic-skip-stones';
  skipMesh.frustumCulled = false;
  skipMesh.visible = false;
  skipMesh.count = 0;
  skipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sharedGroup.add(skipMesh);

  const motesMesh = new THREE.InstancedMesh(moteGeo, moteMat, MOTE_CAPACITY);
  motesMesh.name = 'poetic-motes';
  motesMesh.frustumCulled = false;
  motesMesh.visible = false;
  motesMesh.count = 0;
  motesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cWhite = new THREE.Color('#FFFFFF');
  for (let i = 0; i < MOTE_CAPACITY; i++) motesMesh.setColorAt(i, cWhite);
  sharedGroup.add(motesMesh);

  const guideMesh = new THREE.InstancedMesh(guideGeo, lambertMat, GUIDE_PARTS);
  guideMesh.name = 'poetic-child-dog-guide';
  guideMesh.frustumCulled = false;
  guideMesh.visible = false;
  guideMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const guidePalette = [
    '#C89E78', // 0 child tunic (warm hemp ochre)
    '#E8CBB0', // 1 child face
    '#2B2623', // 2 child hair tufts (总角)
    '#E8CBB0', // 3 child hair tuft L (overwritten below)
    '#5E6D76', // 4 sleeve L
    '#5E6D76', // 5 sleeve R
    '#4A453E', // 6 leg L
    '#4A453E', // 7 leg R
    '#D59B42', // 8 puppy body (warm yellow dog)
    '#DDA64E', // 9 puppy head
    '#8A5A28', // 10 ear L
    '#8A5A28', // 11 ear R
    '#E5B660', // 12 wagging tail
    '#BA8232'  // 13 puppy legs combined stride
  ];
  guidePalette[3] = '#2B2623';
  const _tmpCol = new THREE.Color();
  for (let i = 0; i < GUIDE_PARTS; i++) {
    guideMesh.setColorAt(i, _tmpCol.set(guidePalette[i]));
  }
  if (guideMesh.instanceColor) guideMesh.instanceColor.needsUpdate = true;
  interiorGroup.add(guideMesh);

  // Zero-allocation scratch transforms & pools
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scl = new THREE.Vector3();
  const _mat = new THREE.Matrix4();
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

  // Floating leaf-boat pool
  const flActive = new Uint8Array(FLOAT_CAPACITY);
  const flX = new Float32Array(FLOAT_CAPACITY);
  const flY = new Float32Array(FLOAT_CAPACITY);
  const flZ = new Float32Array(FLOAT_CAPACITY);
  const flVx = new Float32Array(FLOAT_CAPACITY);
  const flVz = new Float32Array(FLOAT_CAPACITY);
  const flYaw = new Float32Array(FLOAT_CAPACITY);
  const flAge = new Float32Array(FLOAT_CAPACITY);
  const flLife = new Float32Array(FLOAT_CAPACITY);
  const flRipTimer = new Float32Array(FLOAT_CAPACITY);
  const flIsStream = new Uint8Array(FLOAT_CAPACITY);
  let activeFloats = 0;

  // Skipping stone pool
  const skActive = new Uint8Array(SKIP_CAPACITY);
  const skStartX = new Float32Array(SKIP_CAPACITY);
  const skStartZ = new Float32Array(SKIP_CAPACITY);
  const skDirX = new Float32Array(SKIP_CAPACITY);
  const skDirZ = new Float32Array(SKIP_CAPACITY);
  const skWaterY = new Float32Array(SKIP_CAPACITY);
  const skHop = new Uint8Array(SKIP_CAPACITY);
  const skHopT = new Float32Array(SKIP_CAPACITY);
  const skDist = new Float32Array(SKIP_CAPACITY);
  let activeSkips = 0;

  // Mote pool (steam, golden pentatonic notes, green clover motes)
  const moActive = new Uint8Array(MOTE_CAPACITY);
  const moX = new Float32Array(MOTE_CAPACITY);
  const moY = new Float32Array(MOTE_CAPACITY);
  const moZ = new Float32Array(MOTE_CAPACITY);
  const moVy = new Float32Array(MOTE_CAPACITY);
  const moAge = new Float32Array(MOTE_CAPACITY);
  const moLife = new Float32Array(MOTE_CAPACITY);
  const moKind = new Uint8Array(MOTE_CAPACITY); // 0=tea steam, 1=gold music, 2=clover/petal
  let activeMotes = 0;

  const cSteam = new THREE.Color('#F5F7F4');
  const cMusic = new THREE.Color('#F3D999');
  const cClover = new THREE.Color('#9ED07E');

  let disposed = false;
  let simTime = 0;
  let cleanupKeyListener = null;
  let nextWatersideMode = 'float'; // alternates 'float' <-> 'skip'
  let watersideCooldown = 0;
  let animalPetCooldown = 0;

  // Pentatonic state
  let pentatonicCount = 0;
  let lastPentatonicNote = -1;
  let echoPending = false;
  let echoTimer = 0;
  let echoNoteIdx = 0;
  let echoX = 0;
  let echoZ = 0;
  let guqinHintShown = false;

  // Rainy-eave hot tea state
  let rainCheckTimer = 0.35;
  let rainTeaCooldown = 0;
  let rainTeaCount = 0;
  let wasUnderRainShelter = false;

  // Note HUD helper
  let noteTimer = 0;
  let lastNoteText = '';

  // Child & yellow dog wordless guide state
  const guide = {
    state: 'idle', // 'idle' | 'wave' | 'lead' | 'wait' | 'arrive'
    x: 38,
    y: 0,
    z: -116,
    yaw: 0,
    dogX: 38.6,
    dogY: 0,
    dogZ: -115.6,
    dogYaw: 0,
    timer: 0,
    cooldown: 16.0,
    waypoints: [],
    wpIndex: 0,
    targetName: '',
    tripsCompleted: 0
  };

  let watersideFloatsLaunched = 0;
  let stonesSkipped = 0;
  let animalsPetted = 0;

  function surface(x, z) {
    return ctx.field ? habitatSurface(ctx.field, x, z) : 0;
  }

  function showNote(text, duration = 4.6) {
    if (!text) return;
    lastNoteText = text;
    noteTimer = duration;
    const el = ctx.doc?.getElementById?.('mystery-note');
    if (el) {
      el.textContent = text;
      el.classList?.add?.('show');
      el.setAttribute?.('aria-hidden', 'false');
    }
  }

  function hideNoteIfOwned() {
    const el = ctx.doc?.getElementById?.('mystery-note');
    if (el && lastNoteText && el.textContent === lastNoteText) {
      el.classList?.remove?.('show');
      el.setAttribute?.('aria-hidden', 'true');
    }
    lastNoteText = '';
    noteTimer = 0;
  }

  function spawnMote(x, y, z, kind = 0, vy = 0.32, life = 1.9) {
    let slot = -1;
    let maxAge = -1;
    let oldest = 0;
    for (let i = 0; i < MOTE_CAPACITY; i++) {
      if (!moActive[i]) { slot = i; break; }
      if (moAge[i] > maxAge) { maxAge = moAge[i]; oldest = i; }
    }
    if (slot < 0) slot = oldest;
    moActive[slot] = 1;
    moX[slot] = x;
    moY[slot] = y;
    moZ[slot] = z;
    moVy[slot] = vy;
    moAge[slot] = 0;
    moLife[slot] = life;
    moKind[slot] = kind;
  }

  function streamTangentAt(x, z, out) {
    const spine = ctx.riverSpine;
    if (Array.isArray(spine) && spine.length >= 2) {
      let bestI = 0;
      let bestD2 = Infinity;
      for (let i = 0; i < spine.length; i++) {
        const dx = spine[i].x - x;
        const dz = spine[i].z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; bestI = i; }
      }
      // Stream flows from cave/upstream toward downstream Wuling (+z outside, or along spine order)
      const i0 = Math.max(0, bestI - 1);
      const i1 = Math.min(spine.length - 1, bestI + 1);
      let tx = spine[i1].x - spine[i0].x;
      let tz = spine[i1].z - spine[i0].z;
      // Ensure downstream drift away from basin if outside, or along channel flow
      if (z > 60 && tz < 0) { tx = -tx; tz = -tz; }
      const l = Math.hypot(tx, tz) || 1;
      out.x = tx / l;
      out.z = tz / l;
      return out;
    }
    out.x = 0.12;
    out.z = 0.99;
    return out;
  }
  const _tanTmp = { x: 0, z: 1 };

  function resolveWaterHit(px, pz, fwdX, fwdZ) {
    const pond = ctx.world?.terrain?.pond;
    const waterLevel = ctx.world?.terrain?.waterLevel ?? -1.2;
    const halfW = (ctx.world?.stream?.halfWidth ?? 4.2);

    // Check pond shore
    if (pond && Number.isFinite(pond.x) && Number.isFinite(pond.z)) {
      const pr = pond.waterRadius || pond.radius || 8.5;
      const dPlayer = Math.hypot(px - pond.x, pz - pond.z);
      if (dPlayer >= pr - 0.9 && dPlayer <= pr + 4.4) {
        const wx = px + fwdX * 2.4;
        const wz = pz + fwdZ * 2.4;
        if (Math.hypot(wx - pond.x, wz - pond.z) < pr - 0.35) {
          const wy = Number.isFinite(pond.waterY) ? pond.waterY : surface(pond.x, pond.z) + 0.05;
          return { kind: 'pond', x: wx, y: wy, z: wz, dirX: fwdX, dirZ: fwdZ };
        }
      }
    }

    // Check stream bank
    if (typeof ctx.distanceToRiver === 'function') {
      const dRiv = ctx.distanceToRiver(px, pz);
      if (dRiv >= halfW - 0.6 && dRiv <= halfW + 4.5) {
        for (const dist of [2.4, 3.4, 4.4]) {
          const wx = px + fwdX * dist;
          const wz = pz + fwdZ * dist;
          if (ctx.distanceToRiver(wx, wz) < halfW * 0.82) {
            return { kind: 'stream', x: wx, y: waterLevel, z: wz, dirX: fwdX, dirZ: fwdZ };
          }
        }
      }
    }

    // Check deep-hollows stone pools & jade rill weir
    const pools = ctx.deepHollows?.layout?.pools;
    if (Array.isArray(pools)) {
      for (let i = 0; i < pools.length; i++) {
        const pool = pools[i];
        if (!pool || !Number.isFinite(pool.x) || !Number.isFinite(pool.z)) continue;
        const rx = pool.rx || 1.2;
        const rz = pool.rz || 1.2;
        const maxR = Math.max(rx, rz);
        const dPlayer = Math.hypot(px - pool.x, pz - pool.z);
        if (dPlayer >= 0.4 && dPlayer <= maxR + 4.2) {
          for (const dist of [1.4, 2.2, 3.0]) {
            const wx = px + fwdX * dist;
            const wz = pz + fwdZ * dist;
            const nx = (wx - pool.x) / rx;
            const nz = (wz - pool.z) / rz;
            if (nx * nx + nz * nz <= 1.05) {
              return { kind: 'pool', x: wx, y: surface(pool.x, pool.z) + 0.16, z: wz, dirX: fwdX, dirZ: fwdZ };
            }
          }
        }
      }
    }

    // Check wilds-jade-echo-spring pool
    const wildSites = ctx.wildsEasterEggs?.sites;
    if (Array.isArray(wildSites)) {
      for (let i = 0; i < wildSites.length; i++) {
        const site = wildSites[i];
        if (!site || site.id !== 'wilds-jade-echo-spring') continue;
        const dPlayer = Math.hypot(px - site.x, pz - site.z);
        if (dPlayer <= 6.2) {
          for (const dist of [1.6, 2.4, 3.2]) {
            const wx = px + fwdX * dist;
            const wz = pz + fwdZ * dist;
            if (Math.hypot(wx - site.x, wz - site.z) <= 2.15) {
              const py = (Number.isFinite(site.y) ? site.y : surface(site.x, site.z)) + 0.12;
              return { kind: 'pool', x: wx, y: py, z: wz, dirX: fwdX, dirZ: fwdZ };
            }
          }
        }
      }
    }
    return null;
  }

  function launchFloatingLeaf(hit) {
    let slot = -1;
    let oldest = 0;
    let maxAge = -1;
    for (let i = 0; i < FLOAT_CAPACITY; i++) {
      if (!flActive[i]) { slot = i; break; }
      if (flAge[i] > maxAge) { maxAge = flAge[i]; oldest = i; }
    }
    if (slot < 0) slot = oldest;

    flActive[slot] = 1;
    flX[slot] = hit.x;
    flY[slot] = hit.y + 0.022;
    flZ[slot] = hit.z;
    flAge[slot] = 0;
    flLife[slot] = 18.0;
    flRipTimer[slot] = 1.6;
    if (hit.kind === 'stream') {
      flIsStream[slot] = 1;
      streamTangentAt(hit.x, hit.z, _tanTmp);
      flVx[slot] = _tanTmp.x * 0.58;
      flVz[slot] = _tanTmp.z * 0.58;
    } else {
      flIsStream[slot] = 0;
      const wx = Number(ctx.sky?.windX) || 0.18;
      const wz = Number(ctx.sky?.windZ) || 0.12;
      const wl = Math.hypot(wx, wz) || 1;
      flVx[slot] = (wx / wl) * 0.22 + hit.dirX * 0.10;
      flVz[slot] = (wz / wl) * 0.22 + hit.dirZ * 0.10;
    }
    flYaw[slot] = Math.atan2(flVx[slot], flVz[slot]);
    watersideFloatsLaunched++;

    ctx.inkAtmosphere?.spawnRipple?.(hit.x, hit.y + 0.02, hit.z, 0.92, 0.78);
    try { ctx.sound?.waterCup?.(hit.x, hit.z); } catch (_) { /* noop */ }
    showNote('竹叶小舟载着两瓣落桃入水，顺着清波悠悠远去。', 4.6);
    return { action: 'float-leaf', x: hit.x, y: hit.y, z: hit.z, count: watersideFloatsLaunched };
  }

  function launchSkippingStone(hit) {
    let slot = 0;
    for (let i = 0; i < SKIP_CAPACITY; i++) {
      if (!skActive[i]) { slot = i; break; }
    }
    skActive[slot] = 1;
    skStartX[slot] = hit.x;
    skStartZ[slot] = hit.z;
    skDirX[slot] = hit.dirX;
    skDirZ[slot] = hit.dirZ;
    skWaterY[slot] = hit.y;
    skHop[slot] = 0;
    skHopT[slot] = 0;
    skDist[slot] = 0;
    stonesSkipped++;

    // First impact right at entry point
    ctx.inkAtmosphere?.spawnRipple?.(hit.x, hit.y + 0.02, hit.z, 0.78, 0.92);
    try { ctx.sound?.stoneSkip?.(hit.x, hit.z, 0); } catch (_) { /* noop */ }
    showNote('青石掠水激起连环清漪，水珠轻跃如珠玉落盘。', 4.4);
    return { action: 'skip-stone', x: hit.x, y: hit.y, z: hit.z, count: stonesSkipped };
  }

  function triggerWatersidePlay(forceMode = null) {
    const ps = ctx.player?.state;
    if (!ps) return null;
    const fwdX = -Math.sin(ps.yaw || 0);
    const fwdZ = -Math.cos(ps.yaw || 0);
    const hit = resolveWaterHit(ps.x, ps.z, fwdX, fwdZ) || {
      kind: 'stream',
      x: ps.x + fwdX * 2.6,
      y: ctx.world?.terrain?.waterLevel ?? -1.2,
      z: ps.z + fwdZ * 2.6,
      dirX: fwdX,
      dirZ: fwdZ
    };
    const mode = forceMode || nextWatersideMode;
    nextWatersideMode = mode === 'float' ? 'skip' : 'float';
    watersideCooldown = 0.55;
    return mode === 'skip' ? launchSkippingStone(hit) : launchFloatingLeaf(hit);
  }

  function canPlayPentatonic() {
    const ps = ctx.player?.state;
    if (!ps) return null;
    if (ctx.situationalRest?.active) {
      const seatId = ctx.situationalRest.currentSeat?.id || ps.seatId || '';
      return { mode: seatId === 'bonfire-mat' ? 'fou' : 'guqin', x: ps.x, y: ps.y + 0.9, z: ps.z };
    }
    const sites = ctx.easterEggs?.sites || [];
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (s.id === 'cloud-guqin-stone' && Math.hypot(ps.x - s.x, ps.z - s.z) < 4.5) {
        return { mode: 'guqin', x: s.x, y: (s.y ?? ps.y) + 0.65, z: s.z };
      }
    }
    return null;
  }

  function playPentatonicNote(noteIndex) {
    const idx = clamp(noteIndex | 0, 0, 4);
    const spot = canPlayPentatonic();
    if (!spot) return null;

    try {
      ctx.sound?.unlock?.();
      if (spot.mode === 'fou') {
        ctx.sound?.fouTone?.(spot.x, spot.z, idx);
      } else {
        ctx.sound?.guqinPluck?.(spot.x, spot.z, idx);
      }
    } catch (_) { /* noop */ }

    for (let m = 0; m < 3; m++) {
      const ang = (m / 3) * TAU + simTime * 1.7;
      spawnMote(
        spot.x + Math.cos(ang) * 0.42,
        spot.y + 0.15 + m * 0.06,
        spot.z + Math.sin(ang) * 0.42,
        1,
        0.26 + m * 0.05,
        1.65
      );
    }

    pentatonicCount++;
    lastPentatonicNote = idx;
    echoPending = true;
    echoTimer = 0.48;
    echoNoteIdx = idx;
    echoX = spot.x;
    echoZ = spot.z;

    const instLabel = spot.mode === 'fou' ? '击缶和鸣' : '抚弦弄音';
    showNote(`${instLabel} · 五声「${PENTATONIC_NAMES[idx]}」—— ${PENTATONIC_MOODS[idx]}`, 4.2);
    return { mode: spot.mode, noteIndex: idx, noteName: PENTATONIC_NAMES[idx], count: pentatonicCount };
  }

  function isPlayerUnderShelter(px, pz) {
    const list = ctx.shelters || [];
    for (let i = 0; i < list.length; i++) {
      const sh = list[i];
      if (!sh || !Number.isFinite(sh.x) || !Number.isFinite(sh.z)) continue;
      if (Number.isFinite(sh.r)) {
        if (Math.hypot(px - sh.x, pz - sh.z) <= sh.r + 0.45) return true;
      } else {
        const c = Math.cos(sh.rot || 0);
        const s = Math.sin(sh.rot || 0);
        const dx = px - sh.x;
        const dz = pz - sh.z;
        const lx = Math.abs(dx * c - dz * s);
        const lz = Math.abs(dx * s + dz * c);
        if (lx <= (sh.hw || 1.8) + 0.45 && lz <= (sh.hd || 1.8) + 0.45) return true;
      }
    }
    const houses = ctx.village?.houseInfo || [];
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      if (Math.hypot(px - h.doorX, pz - h.doorZ) < 2.65) return true;
    }
    return false;
  }

  function triggerRainTeaEncounter(force = false) {
    const ps = ctx.player?.state;
    if (!ps) return null;
    if (!force && ((ctx.sky?.rainIntensity ?? 0) < 0.20 || rainTeaCooldown > 0)) return null;

    let bestActor = null;
    let bestD = force ? 24.0 : 5.6;
    const pList = ctx.people?.list || [];
    for (let i = 0; i < pList.length; i++) {
      const p = pList[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || p.role === 'child') continue;
      const d = Math.hypot(p.x - ps.x, p.z - ps.z);
      if (d < bestD) {
        bestD = d;
        bestActor = { kind: 'person', index: i, x: p.x, z: p.z, role: p.role };
      }
    }
    const cList = ctx.communityLife?.getInteractables?.() || [];
    for (let i = 0; i < cList.length; i++) {
      const c = cList[i];
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      const d = Math.hypot(c.x - ps.x, c.z - ps.z);
      if (d < bestD) {
        bestD = d;
        bestActor = { kind: 'community', id: c.id || c.key, x: c.x, z: c.z, role: c.role || 'villager' };
      }
    }
    if (!bestActor && force) {
      bestActor = { kind: 'virtual', x: ps.x + 1.2, z: ps.z - 1.0, role: 'elder' };
    }
    if (!bestActor) return null;

    if (bestActor.kind === 'person') {
      ctx.people?.greet?.(bestActor.index, ps.x, ps.z, 3.6);
    } else if (bestActor.kind === 'community') {
      ctx.communityLife?.greet?.(bestActor.id, ps.x, ps.z, 3.6);
    }

    const mx = (ps.x + bestActor.x) * 0.5;
    const mz = (ps.z + bestActor.z) * 0.5;
    const my = surface(mx, mz) + 0.92;
    for (let i = 0; i < 8; i++) {
      spawnMote(
        mx + ((i % 3) - 1) * 0.08,
        my + i * 0.05,
        mz + (((i / 3) | 0) - 1) * 0.08,
        0,
        0.24 + (i % 3) * 0.04,
        2.6
      );
    }

    try {
      ctx.sound?.teaSimmer?.(mx, mz);
      ctx.sound?.waterCup?.(mx, mz);
      ctx.sound?.voice?.(bestActor.role, bestActor.x, bestActor.z);
    } catch (_) { /* noop */ }

    rainTeaCooldown = 48.0;
    rainTeaCount++;
    showNote('同檐避雨的村邻转身奉上一碗热茶：「山雨微凉，喝口热茶暖一暖衣襟罢。」', 5.4);
    return { count: rainTeaCount, x: mx, z: mz };
  }

  function findGentleAnimalCandidates() {
    const out = [];
    const deers = ctx.outerWilds?.getAnimalObstacles?.() || [];
    for (let i = 0; i < deers.length; i++) {
      const d = deers[i];
      if (d && Number.isFinite(d.x) && Number.isFinite(d.z)) {
        out.push({
          id: `deer-${i}`,
          species: 'deer',
          name: '西岭呦鹿',
          prompt: '饲苹轻抚 · 西岭呦鹿',
          x: d.x,
          y: surface(d.x, d.z) + 0.95,
          z: d.z,
          ref: d
        });
      }
    }
    const vbTargets = ctx.valleyBorderlands?.targets || [];
    for (let i = 0; i < vbTargets.length; i++) {
      const t = vbTargets[i];
      if (t && t.id === 'mountain-goat') {
        const pos = typeof t.resolve === 'function' ? t.resolve() : t;
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
          out.push({
            id: `goat-${i}`,
            species: 'goat',
            name: '东皋白羊',
            prompt: '饲草轻抚 · 东皋白羊',
            x: pos.x,
            y: Number.isFinite(pos.y) ? pos.y : surface(pos.x, pos.z) + 0.72,
            z: pos.z,
            ref: t
          });
        }
      }
    }
    const oxObs = ctx.oxPlowing?.getAnimalObstacles?.() || [];
    if (oxObs.length > 0 && oxObs[0] && Number.isFinite(oxObs[0].x)) {
      const ox = oxObs[0];
      out.push({
        id: 'plow-ox',
        species: 'ox',
        name: '春畴青牯',
        prompt: '添刍轻抚 · 春畴青牯',
        x: ox.x,
        y: surface(ox.x, ox.z) + 1.05,
        z: ox.z,
        ref: ox
      });
    }
    return out;
  }

  function interactGentleAnimal(cand) {
    if (!cand) return null;
    animalPetCooldown = 1.1;
    animalsPetted++;
    if (cand.species === 'deer') {
      cand.ref?.pet?.(simTime);
      try { ctx.sound?.stagCall?.(cand.x, cand.z); } catch (_) { /* noop */ }
      showNote('呦鹿温驯垂首轻嗅掌心青苹，鹿耳微颤，眸光澄澈亲人。', 4.8);
    } else if (cand.species === 'goat') {
      try { ctx.sound?.goatBleat?.(cand.x, cand.z); } catch (_) { /* noop */ }
      showNote('东皋白羊慢步凑近嚼食嫩草，轻轻蹭过衣袂，咩声清亮。', 4.8);
    } else {
      ctx.oxPlowing?.greet?.('ox-plowman', ctx.player?.state?.x ?? cand.x, ctx.player?.state?.z ?? cand.z, 3.0);
      try { ctx.sound?.low?.(cand.x, cand.z); } catch (_) { /* noop */ }
      showNote('青牯温厚垂颈任你轻抚肩背，鼻息温热绵长，神态安闲。', 4.8);
    }
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * TAU;
      spawnMote(
        cand.x + Math.cos(ang) * 0.34,
        cand.y + 0.08 + (i % 2) * 0.08,
        cand.z + Math.sin(ang) * 0.34,
        2,
        0.22 + (i % 3) * 0.04,
        1.8
      );
    }
    return { action: 'pet-animal', species: cand.species, count: animalsPetted };
  }

  // ---- 垂髫与黄犬「无字引路」 ----
  function isGuideGroundSafe(x, z) {
    const wl = ctx.world?.terrain?.waterLevel ?? -1.2;
    const gy = surface(x, z);
    if (!Number.isFinite(gy) || gy < wl + 0.25) return false;
    const pond = ctx.world?.terrain?.pond;
    if (pond && Math.hypot(x - pond.x, z - pond.z) < (pond.radius || 8.5) + 0.8) return false;
    const bl = ctx.blockers || [];
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (Math.abs(x - b.x) > 5 || Math.abs(z - b.z) > 5) continue;
      const c = Math.cos(b.rot || 0);
      const s = Math.sin(b.rot || 0);
      const dx = x - b.x;
      const dz = z - b.z;
      if (Math.abs(dx * c - dz * s) < (b.hw || 0.5) + 0.45 && Math.abs(dx * s + dz * c) < (b.hd || 0.5) + 0.45) {
        return false;
      }
    }
    return true;
  }

  function buildGuideDestinations() {
    const dests = [];
    const sites = ctx.easterEggs?.sites || [];
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (s && Number.isFinite(s.x) && Number.isFinite(s.z)) {
        dests.push({ id: s.id, name: s.name, x: s.x, z: s.z });
      }
    }
    const wh = ctx.waterworks?.layout?.wheels?.[0];
    if (wh && Number.isFinite(wh.x)) {
      dests.push({ id: 'waterwheel', name: '急水筒车', x: wh.x - 2.4, z: wh.z - 2.0 });
    }
    if (ctx.outerWilds?.layout?.teaShelter) {
      const ts = ctx.outerWilds.layout.teaShelter;
      dests.push({ id: 'north-tea-trail', name: '北岭松风山径', x: 64.0, z: -196.0, refX: ts.x, refZ: ts.z });
    }
    const dhSanct = ctx.deepHollows?.layout?.sanctuaries;
    if (dhSanct) {
      for (const key of ['ancientAltar', 'secludedStudy', 'teaTerrace']) {
        const s = dhSanct[key];
        if (s && Number.isFinite(s.x) && Number.isFinite(s.z)) {
          dests.push({ id: s.id || key, name: s.name || key, x: s.x, z: s.z });
        }
      }
    }
    return dests;
  }

  function triggerChildDogGuide(force = false) {
    const ps = ctx.player?.state;
    if (!ps) return null;
    if (!force && guide.state !== 'idle') return null;

    const interacted = new Set(ctx.easterEggs?.getStats?.()?.interacted || []);
    const candidates = buildGuideDestinations().filter(d => {
      const dist = Math.hypot(d.x - ps.x, d.z - ps.z);
      return dist > 14 && dist < 88 && (!interacted.has(d.id) || force);
    });
    const picked = candidates[0] || buildGuideDestinations()[0] || { id: 'pond-grove', name: '竹林幽处', x: 54, z: -136 };

    // Spawn 5.5m ahead-side of player on safe ground
    let sx = ps.x + 4.8;
    let sz = ps.z - 3.6;
    const toTargetAng = Math.atan2(picked.x - ps.x, picked.z - ps.z);
    for (const off of [0, 0.45, -0.45, 0.9, -0.9]) {
      const cx = ps.x + Math.sin(toTargetAng + off) * 5.6;
      const cz = ps.z + Math.cos(toTargetAng + off) * 5.6;
      if (isGuideGroundSafe(cx, cz)) { sx = cx; sz = cz; break; }
    }

    const waypoints = [];
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      let wx = sx + (picked.x - sx) * u;
      let wz = sz + (picked.z - sz) * u;
      if (!isGuideGroundSafe(wx, wz)) {
        for (const lat of [1.8, -1.8, 3.4, -3.4]) {
          const nx = wx + Math.cos(toTargetAng) * lat;
          const nz = wz - Math.sin(toTargetAng) * lat;
          if (isGuideGroundSafe(nx, nz)) { wx = nx; wz = nz; break; }
        }
      }
      waypoints.push({ x: wx, z: wz });
    }

    guide.state = 'wave';
    guide.x = sx;
    guide.z = sz;
    guide.y = surface(sx, sz);
    guide.yaw = Math.atan2(ps.x - sx, ps.z - sz);
    guide.dogX = sx + 0.68;
    guide.dogZ = sz + 0.35;
    guide.dogY = surface(guide.dogX, guide.dogZ);
    guide.dogYaw = guide.yaw;
    guide.timer = 2.0;
    guide.waypoints = waypoints;
    guide.wpIndex = 0;
    guide.targetName = picked.name;
    guideMesh.visible = true;

    try {
      ctx.sound?.voice?.('child', sx, sz);
      ctx.sound?.bark?.(guide.dogX, guide.dogZ);
    } catch (_) { /* noop */ }
    return { state: guide.state, targetName: guide.targetName, x: guide.x, z: guide.z };
  }

  function writeGuidePart(idx, x, y, z, yaw, pitch, roll, sx, sy, sz) {
    _pos.set(x, y, z);
    _euler.set(pitch, yaw, roll, 'YXZ');
    _quat.setFromEuler(_euler);
    _scl.set(sx, sy, sz);
    _mat.compose(_pos, _quat, _scl);
    guideMesh.setMatrixAt(idx, _mat);
  }

  function updateChildDogGuide(step, ps) {
    if (guide.state === 'idle') {
      if (guide.cooldown > 0) guide.cooldown = Math.max(0, guide.cooldown - step);
      const rain = ctx.sky?.rainIntensity ?? 0;
      const timeId = ctx.sky?.timeId || 'day';
      const inVillage = Math.hypot(ps.x - 42, ps.z - (-122)) < 42;
      const spd = Math.hypot(ps.vx || 0, ps.vz || 0);
      if (
        guide.cooldown <= 0 &&
        inVillage &&
        rain < 0.14 &&
        timeId !== 'night' &&
        !ps.aboardSkiff &&
        !ps.seated &&
        !ps.godFlight &&
        spd < 3.4
      ) {
        triggerChildDogGuide(false);
      }
      return;
    }

    let childMoving = false;
    let waving = false;
    const distPlayer = Math.hypot(ps.x - guide.x, ps.z - guide.z);

    if (guide.state === 'wave') {
      waving = true;
      guide.yaw = angleLerp(guide.yaw, Math.atan2(ps.x - guide.x, ps.z - guide.z), step * 6);
      guide.timer -= step;
      if (guide.timer <= 0) {
        guide.state = 'lead';
      }
    } else if (guide.state === 'lead') {
      if (distPlayer > 8.6) {
        guide.state = 'wait';
        guide.timer = 14.0;
        try { ctx.sound?.bark?.(guide.dogX, guide.dogZ); } catch (_) { /* noop */ }
      } else {
        const wp = guide.waypoints[guide.wpIndex];
        if (!wp) {
          guide.state = 'arrive';
          guide.timer = 2.6;
        } else {
          const dx = wp.x - guide.x;
          const dz = wp.z - guide.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.65) {
            guide.wpIndex++;
            if (guide.wpIndex >= guide.waypoints.length) {
              guide.state = 'arrive';
              guide.timer = 2.6;
              guide.tripsCompleted++;
              try {
                ctx.sound?.voice?.('child', guide.x, guide.z);
                ctx.sound?.bark?.(guide.dogX, guide.dogZ);
              } catch (_) { /* noop */ }
            }
          } else {
            const move = Math.min(d, 2.05 * step);
            guide.x += (dx / d) * move;
            guide.z += (dz / d) * move;
            guide.yaw = angleLerp(guide.yaw, Math.atan2(dx, dz), step * 7);
            childMoving = true;
          }
        }
      }
    } else if (guide.state === 'wait') {
      waving = true;
      guide.yaw = angleLerp(guide.yaw, Math.atan2(ps.x - guide.x, ps.z - guide.z), step * 6);
      guide.timer -= step;
      if (distPlayer < 6.4) {
        guide.state = 'lead';
      } else if (guide.timer <= 0 || distPlayer > 28) {
        guide.state = 'idle';
        guide.cooldown = 95.0;
        guideMesh.visible = false;
        return;
      }
    } else if (guide.state === 'arrive') {
      waving = true;
      guide.yaw = angleLerp(guide.yaw, Math.atan2(ps.x - guide.x, ps.z - guide.z), step * 6);
      guide.timer -= step;
      if (guide.timer <= 0) {
        guide.state = 'idle';
        guide.cooldown = 110.0;
        guideMesh.visible = false;
        return;
      }
    }

    guide.y = surface(guide.x, guide.z);
    // Puppy trots cheerily beside child
    const sideX = Math.cos(guide.yaw) * 0.62 - Math.sin(guide.yaw) * 0.28;
    const sideZ = -Math.sin(guide.yaw) * 0.62 - Math.cos(guide.yaw) * 0.28;
    const wantDogX = guide.x + sideX;
    const wantDogZ = guide.z + sideZ;
    const ddx = wantDogX - guide.dogX;
    const ddz = wantDogZ - guide.dogZ;
    const dd = Math.hypot(ddx, ddz);
    if (dd > 0.04) {
      const dm = Math.min(dd, 2.6 * step);
      guide.dogX += (ddx / dd) * dm;
      guide.dogZ += (ddz / dd) * dm;
      guide.dogYaw = angleLerp(guide.dogYaw, waving ? Math.atan2(ps.x - guide.dogX, ps.z - guide.dogZ) : Math.atan2(ddx, ddz), step * 8);
    }
    guide.dogY = surface(guide.dogX, guide.dogZ);

    // Render 14 articulated child + puppy parts
    const gait = simTime * (childMoving ? 9.2 : 2.4);
    const bob = childMoving ? Math.abs(Math.sin(gait)) * 0.04 : Math.sin(gait) * 0.01;
    const cy = Math.cos(guide.yaw);
    const sy = Math.sin(guide.yaw);
    const baseH = guide.y + bob;

    // Child torso, head & twin hair tufts (总角)
    writeGuidePart(0, guide.x, baseH + 0.56, guide.z, guide.yaw, childMoving ? 0.08 : 0.02, 0, 0.28, 0.44, 0.20);
    writeGuidePart(1, guide.x, baseH + 0.89, guide.z, guide.yaw, waving ? -0.08 : 0, 0, 0.21, 0.21, 0.21);
    writeGuidePart(2, guide.x - cy * 0.11, baseH + 1.01, guide.z + sy * 0.11, guide.yaw, 0, 0.25, 0.075, 0.085, 0.075);
    writeGuidePart(3, guide.x + cy * 0.11, baseH + 1.01, guide.z - sy * 0.11, guide.yaw, 0, -0.25, 0.075, 0.085, 0.075);

    // Child arms (waving right hand when beckoning!)
    const armSwing = childMoving ? Math.sin(gait) * 0.45 : 0.08;
    const wavePitch = waving ? -2.35 + Math.sin(simTime * 7.5) * 0.35 : -armSwing;
    writeGuidePart(4, guide.x - cy * 0.19, baseH + 0.64, guide.z + sy * 0.19, guide.yaw, armSwing, 0.12, 0.085, 0.30, 0.085);
    writeGuidePart(5, guide.x + cy * 0.19, baseH + 0.68, guide.z - sy * 0.19, guide.yaw, wavePitch, waving ? -0.28 : -0.12, 0.085, 0.30, 0.085);

    // Child legs
    const legSwing = childMoving ? Math.sin(gait) * 0.42 : 0;
    writeGuidePart(6, guide.x - cy * 0.07, baseH + 0.20, guide.z + sy * 0.07, guide.yaw, legSwing, 0, 0.09, 0.34, 0.09);
    writeGuidePart(7, guide.x + cy * 0.07, baseH + 0.20, guide.z - sy * 0.07, guide.yaw, -legSwing, 0, 0.09, 0.34, 0.09);

    // Yellow puppy (body, head, ears, wagging tail, legs)
    const dcy = Math.cos(guide.dogYaw);
    const dsy = Math.sin(guide.dogYaw);
    const dogBob = dd > 0.05 ? Math.abs(Math.sin(simTime * 12)) * 0.03 : 0;
    const dy = guide.dogY + dogBob;
    writeGuidePart(8, guide.dogX, dy + 0.24, guide.dogZ, guide.dogYaw, waving ? -0.08 : 0, 0, 0.18, 0.17, 0.36);
    writeGuidePart(9, guide.dogX + dsy * 0.20, dy + 0.34, guide.dogZ + dcy * 0.20, guide.dogYaw, -0.10, 0, 0.16, 0.15, 0.17);
    writeGuidePart(10, guide.dogX + dsy * 0.18 - dcy * 0.07, dy + 0.43, guide.dogZ + dcy * 0.18 + dsy * 0.07, guide.dogYaw, 0.2, 0.2, 0.05, 0.08, 0.05);
    writeGuidePart(11, guide.dogX + dsy * 0.18 + dcy * 0.07, dy + 0.43, guide.dogZ + dcy * 0.18 - dsy * 0.07, guide.dogYaw, 0.2, -0.2, 0.05, 0.08, 0.05);
    const wagYaw = guide.dogYaw + Math.sin(simTime * 13.5) * 0.55;
    writeGuidePart(12, guide.dogX - dsy * 0.21, dy + 0.33, guide.dogZ - dcy * 0.21, wagYaw, 0.65, 0, 0.045, 0.16, 0.045);
    writeGuidePart(13, guide.dogX, dy + 0.10, guide.dogZ, guide.dogYaw, dd > 0.05 ? Math.sin(simTime * 12) * 0.35 : 0, 0, 0.15, 0.18, 0.28);
    guideMesh.instanceMatrix.needsUpdate = true;
  }

  function pickTarget(camera, cfg) {
    if (disposed) return null;
    const doc = ctx.doc;
    if (doc && (!interactionAllowed(null, doc) || storyBusy(doc))) return null;
    const ps = ctx.player?.state;
    const cam = camera || ctx.camera;
    if (!ps || !cam || ps.aboardSkiff || ps.seated || ps.godFlight) return null;

    const third = ps.view === 'third';
    const eyeX = third ? ps.x : cam.position.x;
    const eyeY = third ? (ps.y + (ps.eyeHeight || 1.65)) : cam.position.y;
    const eyeZ = third ? ps.z : cam.position.z;
    const cp = Math.cos(ps.pitch || 0);
    const fwdX = -Math.sin(ps.yaw || 0) * cp;
    const fwdY = Math.sin(ps.pitch || 0);
    const fwdZ = -Math.cos(ps.yaw || 0) * cp;

    // 1. Soulful mountain/field animal gentle touch (higher priority than open water)
    if (animalPetCooldown <= 0) {
      const animals = findGentleAnimalCandidates();
      let bestAnim = null;
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        const dx = a.x - eyeX;
        const dy = a.y - eyeY;
        const dz = a.z - eyeZ;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 3.7) continue;
        const dot = (dx * fwdX + dy * fwdY + dz * fwdZ) / (dist || 1);
        if (dot < 0.68) continue;
        const score = dist * 0.92 + (1 - dot) * 3.1;
        if (!bestAnim || score < bestAnim.score) {
          bestAnim = {
            kind: 'mystery',
            key: 'poetic:pet:' + a.id,
            isPoetic: true,
            poeticAction: 'pet-animal',
            animalCandidate: a,
            name: a.name,
            label: a.name,
            prompt: a.prompt,
            x: a.x,
            y: a.y,
            z: a.z,
            dist,
            dot,
            score
          };
        }
      }
      if (bestAnim) return bestAnim;
    }

    // 2. Waterside micro-play (folding bamboo-leaf peach float / skipping flat stone)
    if (watersideCooldown <= 0 && fwdY < 0.16 && fwdY > -0.78) {
      const horizLen = Math.hypot(fwdX, fwdZ) || 1;
      const hit = resolveWaterHit(ps.x, ps.z, fwdX / horizLen, fwdZ / horizLen);
      if (hit) {
        const label = nextWatersideMode === 'float' ? '临流寄兴' : '临水微戏';
        const prompt = nextWatersideMode === 'float'
          ? '折桃放流 · 泛叶随波'
          : '拾石打水漂 · 临流激浪';
        return {
          kind: 'mystery',
          key: 'poetic:waterside:' + nextWatersideMode,
          isPoetic: true,
          poeticAction: 'waterside',
          waterHit: hit,
          name: label,
          label,
          prompt,
          x: hit.x,
          y: hit.y + 0.15,
          z: hit.z,
          dist: 2.6,
          dot: 0.92,
          score: 3.45 // yields to NPCs, skiff, seats, and specific easter eggs
        };
      }
    }

    return null;
  }

  function interact(target) {
    if (disposed || !target?.isPoetic) return null;
    if (target.poeticAction === 'pet-animal') {
      return interactGentleAnimal(target.animalCandidate);
    }
    if (target.poeticAction === 'waterside') {
      const hit = target.waterHit;
      const mode = nextWatersideMode;
      nextWatersideMode = mode === 'float' ? 'skip' : 'float';
      watersideCooldown = 0.55;
      return mode === 'skip' ? launchSkippingStone(hit) : launchFloatingLeaf(hit);
    }
    return null;
  }

  function wrapMysteries(m) {
    if (!m || m._poeticWrapped) return;
    m._poeticWrapped = true;
    const prevPick = typeof m.pickTarget === 'function' ? m.pickTarget.bind(m) : null;
    const prevInteract = typeof m.interact === 'function' ? m.interact.bind(m) : null;

    m.pickTarget = function (camera, cfg) {
      const base = prevPick ? prevPick(camera, cfg) : null;
      const own = pickTarget(camera, cfg);
      if (!base) return own;
      if (!own) return base;
      return own.score < base.score ? own : base;
    };

    m.interact = function (target) {
      if (target?.isPoetic) return interact(target);
      return prevInteract ? prevInteract(target) : null;
    };
  }

  function attachKeyListeners(win) {
    if (!win?.addEventListener) return;
    if (cleanupKeyListener) cleanupKeyListener();

    const onKeyDown = (e) => {
      if (disposed || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const m = /^Digit([1-5])$/.exec(e.code);
      if (!m) return;
      const doc = ctx.doc;
      const tgt = e.target;
      if (tgt && (tgt.isContentEditable || tgt.closest?.(CONTROL_SELECTOR))) return;
      if (doc && (mysteryUiPaused(doc) || storyBusy(doc))) return;
      // Never steal Digit1-5 while villager multi-turn reply choices are open!
      const talkEl = doc?.getElementById?.('talk');
      if (talkEl?.classList?.contains?.('show') && talkEl?.classList?.contains?.('has-replies')) return;
      if (ctx.villagerDialogue?.getActiveSession?.()) return;

      const noteIdx = Number(m[1]) - 1;
      if (playPentatonicNote(noteIdx)) {
        e.preventDefault?.();
      }
    };

    win.addEventListener('keydown', onKeyDown);
    cleanupKeyListener = () => {
      win.removeEventListener('keydown', onKeyDown);
      cleanupKeyListener = null;
    };
  }

  function registerSky(sky) {
    if (!sky?.registerMaterials) return;
    sky.registerMaterials(group);
  }

  function update(dt, elapsed = 0, sky = null, playerState = null) {
    if (disposed) return;
    if (sky) ctx.sky = sky;
    if (!Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.05);
    simTime += step;

    if (watersideCooldown > 0) watersideCooldown = Math.max(0, watersideCooldown - step);
    if (animalPetCooldown > 0) animalPetCooldown = Math.max(0, animalPetCooldown - step);
    if (rainTeaCooldown > 0) rainTeaCooldown = Math.max(0, rainTeaCooldown - step);

    if (noteTimer > 0) {
      noteTimer = Math.max(0, noteTimer - step);
      if (noteTimer <= 0) hideNoteIfOwned();
    }

    // 1. Scheduled mountain-bird / wind-bell echo answering pentatonic note (strictly dt-driven!)
    if (echoPending) {
      echoTimer -= step;
      if (echoTimer <= 0) {
        echoPending = false;
        const tId = ctx.sky?.timeId || 'day';
        try {
          if (tId === 'night' || tId === 'dusk') {
            ctx.sound?.bell?.(echoX - 7.5, echoZ + 6.0);
          } else {
            ctx.sound?.chirp?.(echoX + 8.5, echoZ - 6.5);
          }
        } catch (_) { /* noop */ }
        // Subtle second phrase only if note still ours
        const el = ctx.doc?.getElementById?.('mystery-note');
        if (el && lastNoteText && el.textContent === lastNoteText) {
          const echoTag = (tId === 'night' || tId === 'dusk') ? '远檐风铎轻声应和' : '林间山雀清啼相和';
          lastNoteText = `五声「${PENTATONIC_NAMES[echoNoteIdx]}」袅袅入林 —— ${echoTag}。`;
          el.textContent = lastNoteText;
        }
      }
    }

    // Gentle one-time hint near Cloud Guqin Stone
    const ps = playerState || ctx.player?.state;
    if (ps && !guqinHintShown) {
      const spot = canPlayPentatonic();
      if (spot && !ctx.situationalRest?.active) {
        guqinHintShown = true;
        const isTouch = Boolean(ctx.doc?.body?.classList?.contains?.('touch-active'));
        showNote(
          isTouch
            ? '立于卧石古琴畔，轻点下方「宫·商·角·徵·羽」五音即可抚弦。'
            : '立于卧石古琴畔，可随时轻按数字键 1–5 抚奏「宫·商·角·徵·羽」五音。',
          4.8
        );
      }
    }

    // 2. Update drifting bamboo-leaf peach floats
    let fWrite = 0;
    const pond = ctx.world?.terrain?.pond;
    for (let i = 0; i < FLOAT_CAPACITY; i++) {
      if (!flActive[i]) continue;
      flAge[i] += step;
      if (flAge[i] >= flLife[i]) {
        flActive[i] = 0;
        continue;
      }
      if (flIsStream[i]) {
        streamTangentAt(flX[i], flZ[i], _tanTmp);
        flVx[i] += (_tanTmp.x * 0.58 - flVx[i]) * step * 1.8;
        flVz[i] += (_tanTmp.z * 0.58 - flVz[i]) * step * 1.8;
      } else if (pond) {
        const dPond = Math.hypot(flX[i] - pond.x, flZ[i] - pond.z);
        const maxR = (pond.waterRadius || pond.radius || 8.5) - 0.55;
        if (dPond > maxR) {
          flVx[i] *= 0.6;
          flVz[i] *= 0.6;
        }
      }
      flX[i] += flVx[i] * step;
      flZ[i] += flVz[i] * step;
      flYaw[i] += Math.sin(simTime * 1.4 + i) * 0.35 * step;
      flRipTimer[i] -= step;
      if (flRipTimer[i] <= 0) {
        flRipTimer[i] = 2.3;
        ctx.inkAtmosphere?.spawnRipple?.(flX[i], flY[i], flZ[i], 0.55, 0.36);
      }
      const fade = flAge[i] > flLife[i] - 2.0 ? clamp((flLife[i] - flAge[i]) / 2.0, 0.01, 1) : 1;
      const bob = Math.sin(simTime * 2.8 + i * 1.3) * 0.008;
      _pos.set(flX[i], flY[i] + bob, flZ[i]);
      _euler.set(Math.sin(simTime * 2.1 + i) * 0.06, flYaw[i], Math.cos(simTime * 1.9 + i) * 0.07, 'YXZ');
      _quat.setFromEuler(_euler);
      _scl.setScalar(fade);
      _mat.compose(_pos, _quat, _scl);
      floatingMesh.setMatrixAt(fWrite++, _mat);
    }
    activeFloats = fWrite;
    floatingMesh.count = fWrite;
    floatingMesh.visible = fWrite > 0;
    if (fWrite > 0) floatingMesh.instanceMatrix.needsUpdate = true;

    // 3. Update skipping stones (4 hops with decreasing stride & height)
    let sWrite = 0;
    const hopDurs = [0.24, 0.20, 0.17, 0.14];
    const hopLens = [1.55, 1.30, 1.05, 0.80];
    const hopHeights = [0.22, 0.15, 0.10, 0.06];
    for (let i = 0; i < SKIP_CAPACITY; i++) {
      if (!skActive[i]) continue;
      const h = skHop[i];
      const dur = hopDurs[h] || 0.14;
      skHopT[i] += step;
      while (skActive[i] && skHopT[i] >= (hopDurs[skHop[i]] || 0.14)) {
        const curH = skHop[i];
        skHopT[i] -= hopDurs[curH] || 0.14;
        skDist[i] += hopLens[curH] || 0.8;
        skHop[i] = curH + 1;
        const bx = skStartX[i] + skDirX[i] * skDist[i];
        const bz = skStartZ[i] + skDirZ[i] * skDist[i];
        ctx.inkAtmosphere?.spawnRipple?.(bx, skWaterY[i] + 0.02, bz, 0.68 + skHop[i] * 0.14, Math.max(0.32, 0.86 - skHop[i] * 0.14));
        try { ctx.sound?.stoneSkip?.(bx, bz, skHop[i]); } catch (_) { /* noop */ }
        if (skHop[i] >= 4) {
          skActive[i] = 0;
        }
      }
      if (!skActive[i]) continue;
      const curH = skHop[i];
      const u = clamp(skHopT[i] / (hopDurs[curH] || 0.14), 0, 1);
      const dAlong = skDist[i] + u * (hopLens[curH] || 0.8);
      const sx = skStartX[i] + skDirX[i] * dAlong;
      const sz = skStartZ[i] + skDirZ[i] * dAlong;
      const sy = skWaterY[i] + 0.015 + Math.sin(u * Math.PI) * (hopHeights[curH] || 0.06);
      _pos.set(sx, sy, sz);
      _euler.set(0.08, simTime * 18.0, 0.05, 'YXZ');
      _quat.setFromEuler(_euler);
      _scl.setScalar(1);
      _mat.compose(_pos, _quat, _scl);
      skipMesh.setMatrixAt(sWrite++, _mat);
    }
    activeSkips = sWrite;
    skipMesh.count = sWrite;
    skipMesh.visible = sWrite > 0;
    if (sWrite > 0) skipMesh.instanceMatrix.needsUpdate = true;

    // 4. Update rising motes (tea steam, golden music notes, green clover)
    let mWrite = 0;
    for (let i = 0; i < MOTE_CAPACITY; i++) {
      if (!moActive[i]) continue;
      moAge[i] += step;
      if (moAge[i] >= moLife[i]) {
        moActive[i] = 0;
        continue;
      }
      const u = moAge[i] / moLife[i];
      moY[i] += moVy[i] * step;
      const swayX = Math.sin(simTime * 2.2 + i * 1.1) * 0.08 * step;
      const swayZ = Math.cos(simTime * 1.9 + i * 0.9) * 0.08 * step;
      moX[i] += swayX;
      moZ[i] += swayZ;
      const scale = Math.sin(u * Math.PI) * (moKind[i] === 0 ? 1.35 : 0.85);
      _pos.set(moX[i], moY[i], moZ[i]);
      _quat.identity();
      _scl.setScalar(Math.max(0.01, scale));
      _mat.compose(_pos, _quat, _scl);
      motesMesh.setMatrixAt(mWrite, _mat);
      motesMesh.setColorAt(mWrite, moKind[i] === 0 ? cSteam : moKind[i] === 1 ? cMusic : cClover);
      mWrite++;
    }
    activeMotes = mWrite;
    motesMesh.count = mWrite;
    motesMesh.visible = mWrite > 0;
    if (mWrite > 0) {
      motesMesh.instanceMatrix.needsUpdate = true;
      if (motesMesh.instanceColor) motesMesh.instanceColor.needsUpdate = true;
    }

    // 5. Rainy-eave hot tea hospitality check (4 Hz)
    if (ps) {
      rainCheckTimer -= step;
      if (rainCheckTimer <= 0) {
        rainCheckTimer = 0.25;
        const raining = (ctx.sky?.rainIntensity ?? 0) > 0.20;
        const sheltered = raining && !ps.aboardSkiff && isPlayerUnderShelter(ps.x, ps.z);
        if (sheltered && (!wasUnderRainShelter || rainTeaCooldown <= 0)) {
          triggerRainTeaEncounter(false);
        }
        wasUnderRainShelter = sheltered;
      }

      // 6. Child & yellow dog wordless guide
      updateChildDogGuide(step, ps);
    }
  }

  function getStats() {
    return {
      simTime: Math.round(simTime * 1000) / 1000,
      watersideFloatsLaunched,
      activeFloats,
      stonesSkipped,
      activeSkips,
      pentatonicCount,
      lastPentatonicNote,
      echoPending,
      rainTeaCount,
      animalsPetted,
      activeMotes,
      guideState: guide.state,
      guideTarget: guide.targetName,
      guideTripsCompleted: guide.tripsCompleted,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (cleanupKeyListener) cleanupKeyListener();
    hideNoteIfOwned();
    for (const m of [floatingMesh, skipMesh, motesMesh, guideMesh]) {
      m.visible = false;
      m.dispose?.();
    }
    floatGeo.dispose();
    skipGeo.dispose();
    moteGeo.dispose();
    guideGeo.dispose();
    lambertMat.dispose();
    moteMat.dispose();
    group.removeFromParent();
  }

  if (ctx.mysteries) wrapMysteries(ctx.mysteries);
  if (ctx.win) attachKeyListeners(ctx.win);

  return {
    group,
    interiorGroup,
    sharedGroup,
    get pentatonicCount() { return pentatonicCount; },
    registerSky,
    pickTarget,
    interact,
    triggerWatersidePlay,
    playPentatonicNote,
    getPentatonicSpot: canPlayPentatonic,
    triggerRainTeaEncounter,
    triggerChildDogGuide,
    update,
    getStats,
    dispose
  };
}
