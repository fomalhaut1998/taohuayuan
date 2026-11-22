import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { interactionAllowed, mysteryUiPaused, storyBusy } from './mysteries.js';

const TAU = Math.PI * 2;

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smooth01(t) {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function paintGeo(geo, topHex, botHex) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  const pos = g.attributes.position;
  const minY = g.boundingBox ? g.boundingBox.min.y : -0.05;
  const spanY = Math.max(1e-4, (g.boundingBox ? g.boundingBox.max.y : 0.05) - minY);
  const cTop = new THREE.Color(topHex);
  const cBot = new THREE.Color(botHex || topHex);
  const cTmp = new THREE.Color();
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp((pos.getY(i) - minY) / spanY, 0, 1);
    cTmp.copy(cBot).lerp(cTop, t);
    cols[i * 3] = cTmp.r;
    cols[i * 3 + 1] = cTmp.g;
    cols[i * 3 + 2] = cTmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

function buildTwoToneStickAndPieceGeo() {
  // Unit-ish split bamboo stick / piece block: ivory upper half (#E3D4B2), aged bamboo green-bark lower half (#6C7A52)
  const box = new THREE.BoxGeometry(1, 1, 1);
  return paintGeo(box, '#E5D7B6', '#6A7850');
}

function buildSculptedCarpGeo() {
  const parts = [];
  // Streamlined spindle body:青脊银腹溪鲫
  const body = new THREE.SphereGeometry(0.11, 8, 6);
  body.scale(0.36, 0.52, 1.35);
  parts.push(paintGeo(body, '#56756D', '#DCE3DA'));

  // Dorsal fin
  const dorsal = new THREE.ConeGeometry(0.032, 0.09, 4);
  dorsal.scale(0.35, 1.0, 1.8);
  dorsal.rotateX(-0.35);
  dorsal.translate(0, 0.068, -0.02);
  parts.push(paintGeo(dorsal, '#6F8678', '#56756D'));

  // Forked copper-rose tail fin
  for (const vSign of [1, -1]) {
    const lobe = new THREE.ConeGeometry(0.028, 0.11, 4);
    lobe.scale(0.28, 1.0, 1.25);
    lobe.rotateX(-Math.PI * 0.5 + vSign * 0.42);
    lobe.translate(0, vSign * 0.028, -0.175);
    parts.push(paintGeo(lobe, '#C58568', '#9F6851'));
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

const LIUBO_NOTES = [
  '竹箸脆响落盘，得采「枭」筹——执朱漆枭棋循方局曲道进一格，亭下松风徐来。',
  '六箸翻飞轻叩青石，翻出「卢」采——推子入中宫水位，闲看池畔落英。',
  '投箸声清，三仰三俯成「雉」采——按古谱移子守角，一局消得半晌闲。',
  '轻掷六枚竹箸，脆响回荡茅亭，得「犊」采——缓步推棋，不争胜负但取清欢。'
];

const FISHTRAP_NOTES = [
  '轻拽麻绳提起竹筌——银鳞溪鲫泼剌跃水，水珠溅落芳草，旋即纵归清流。',
  '揭开溪畔鱼篓竹盖察看，两尾青脊肥鲫摆尾跳珠；既饱眼福，复放还碧溪。',
  '竹筌出水哗然作响，澄澈山泉顺细篾泻下，惊起溪湾一圈清浅微澜。'
];

const LIUBO_CORNERS = [
  [-0.16, -0.16],
  [0.16, -0.16],
  [0.16, 0.16],
  [-0.16, 0.16]
];

export function createTactileProps(options = {}) {
  const {
    leisureGrove = null,
    waterworks = null
  } = options;

  const group = new THREE.Group();
  group.name = 'tactile-props';

  const ctx = {
    mysteries: null,
    player: null,
    camera: null,
    sound: null,
    communityLife: null,
    doc: typeof document !== 'undefined' ? document : null
  };

  const board = leisureGrove?.layout?.board || null;
  const trap = waterworks?.layout?.traps?.[0] || null;

  // Locate submerged fish-trap group ('waterworks-woven-fish-trap' parent) for gentle non-destructive tug
  let submergedTrapGroup = null;
  let savedTrapTransform = null;
  if (waterworks?.group) {
    const trapMesh = waterworks.group.getObjectByName('waterworks-woven-fish-trap');
    if (trapMesh?.parent && trapMesh.parent !== waterworks.group) {
      submergedTrapGroup = trapMesh.parent;
      savedTrapTransform = {
        x: submergedTrapGroup.position.x,
        y: submergedTrapGroup.position.y,
        z: submergedTrapGroup.position.z,
        rx: submergedTrapGroup.rotation.x,
        ry: submergedTrapGroup.rotation.y,
        rz: submergedTrapGroup.rotation.z
      };
    }
  }

  const tmpPos = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  const tmpColor = new THREE.Color();

  function setInst(mesh, idx, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    tmpPos.set(x, y, z);
    tmpEuler.set(rx, ry, rz, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpScale.set(sx, sy, sz);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    mesh.setMatrixAt(idx, tmpMat);
  }

  // 1. Liubo bamboo sticks (0..5) + carved vermilion Xiao piece (6)
  let liuboGeo = null;
  let liuboMat = null;
  let liuboMesh = null;
  if (board && Number.isFinite(board.x) && Number.isFinite(board.z)) {
    liuboGeo = buildTwoToneStickAndPieceGeo();
    liuboMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    liuboMesh = new THREE.InstancedMesh(liuboGeo, liuboMat, 7);
    liuboMesh.name = 'tactile-liubo-set';
    liuboMesh.userData.dynamic = true;
    liuboMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    liuboMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(board.x, board.y + 0.2, board.z), 1.8);
    liuboMesh.frustumCulled = true;
    for (let i = 0; i < 6; i++) {
      liuboMesh.setColorAt(i, tmpColor.set('#FFF8E8'));
    }
    // Vermilion-lacquered lead piece (朱漆枭棋)
    liuboMesh.setColorAt(6, tmpColor.set('#C95B42'));
    if (liuboMesh.instanceColor) liuboMesh.instanceColor.needsUpdate = true;
    group.add(liuboMesh);
  }

  // 2. Fish-trap leaping carp (2 instances) + expanding splash rings (4 instances) — hidden when idle (0 draw calls!)
  let carpGeo = null;
  let carpMat = null;
  let carpMesh = null;
  let splashGeo = null;
  let splashMat = null;
  let splashMesh = null;
  const shoreAnchor = trap
    ? {
        x: trap.bank.x + Math.sin(trap.yaw) * 0.50,
        y: trap.bank.y + 0.72,
        z: trap.bank.z + Math.cos(trap.yaw) * 0.50
      }
    : null;

  if (trap && shoreAnchor) {
    carpGeo = buildSculptedCarpGeo();
    carpMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    carpMesh = new THREE.InstancedMesh(carpGeo, carpMat, 2);
    carpMesh.name = 'tactile-fishtrap-carp';
    carpMesh.userData.dynamic = true;
    carpMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const midX = (trap.x + shoreAnchor.x) * 0.5;
    const midY = (trap.y + shoreAnchor.y) * 0.5 + 0.4;
    const midZ = (trap.z + shoreAnchor.z) * 0.5;
    const spanR = Math.hypot(trap.x - shoreAnchor.x, trap.z - shoreAnchor.z) * 0.5 + 2.5;
    carpMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(midX, midY, midZ), spanR);
    carpMesh.frustumCulled = true;
    carpMesh.visible = false;
    group.add(carpMesh);

    splashGeo = new THREE.RingGeometry(0.18, 0.30, 12);
    splashGeo.rotateX(-Math.PI * 0.5);
    splashMat = new THREE.MeshLambertMaterial({
      color: '#DCECE8',
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    splashMat.userData.skyIgnore = true;
    splashMesh = new THREE.InstancedMesh(splashGeo, splashMat, 4);
    splashMesh.name = 'tactile-fishtrap-splash';
    splashMesh.userData.dynamic = true;
    splashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    splashMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(midX, midY, midZ), spanR);
    splashMesh.frustumCulled = true;
    splashMesh.visible = false;
    group.add(splashMesh);
  }

  let disposed = false;
  let liuboTimer = 0;
  const LIUBO_DUR = 1.68;
  let liuboPlays = 0;
  let liuboClackedLand = false;
  let liuboClackedMove = false;

  let trapTimer = 0;
  const TRAP_DUR = 1.85;
  let trapPlays = 0;

  let noteTimer = 0;
  let noteActive = false;
  let lastNoteText = '';

  function showNote(text, duration = 4.6) {
    lastNoteText = text;
    noteTimer = duration;
    noteActive = true;
    const el = ctx.doc?.getElementById?.('mystery-note');
    if (el) {
      el.textContent = text;
      el.classList?.add?.('show');
      el.setAttribute?.('aria-hidden', 'false');
    }
  }

  function hideNote() {
    if (!noteActive) return;
    noteActive = false;
    noteTimer = 0;
    const el = ctx.doc?.getElementById?.('mystery-note');
    if (el && el.textContent === lastNoteText) {
      el.classList?.remove?.('show');
      el.setAttribute?.('aria-hidden', 'true');
    }
  }

  function writeLiuboPose() {
    if (!liuboMesh || !board) return;
    const bx = board.x;
    const by = board.y;
    const bz = board.z;
    const cornerIdx = liuboPlays % LIUBO_CORNERS.length;
    const prevIdx = (liuboPlays + LIUBO_CORNERS.length - 1) % LIUBO_CORNERS.length;

    if (liuboTimer <= 0) {
      // Neat resting fan of 6 bamboo sticks + vermilion Xiao piece on its current corner
      for (let i = 0; i < 6; i++) {
        const sx = bx - 0.28 + i * 0.026;
        const sz = bz - 0.25 + (i % 2) * 0.014;
        const yaw = 0.22 + (i - 2.5) * 0.06;
        const flip = ((liuboPlays + i) % 2 === 0) ? 0 : Math.PI;
        setInst(liuboMesh, i, sx, by + 0.008, sz, 0.015, 0.009, 0.19, 0, yaw, flip);
      }
      const [cx, cz] = LIUBO_CORNERS[cornerIdx];
      setInst(liuboMesh, 6, bx + cx, by + 0.026, bz + cz, 0.088, 0.048, 0.066, 0, 0.08 * cornerIdx, 0);
      liuboMesh.instanceMatrix.needsUpdate = true;
      return;
    }

    const u = clamp(1 - liuboTimer / LIUBO_DUR, 0, 1);

    // Phase 1 (u in 0..0.62): bamboo sticks arc, tumble, and bounce onto the center of the board
    const tossU = clamp(u / 0.62, 0, 1);
    for (let i = 0; i < 6; i++) {
      const startX = bx - 0.28 + i * 0.026;
      const startZ = bz - 0.25;
      const landAng = (i / 6) * TAU + liuboPlays * 0.85;
      const landR = 0.045 + (i % 3) * 0.036;
      const endX = bx + Math.cos(landAng) * landR;
      const endZ = bz + Math.sin(landAng) * landR;
      const curX = lerp(startX, endX, smooth01(tossU));
      const curZ = lerp(startZ, endZ, smooth01(tossU));
      let lift = 0;
      if (tossU < 0.72) {
        lift = Math.sin((tossU / 0.72) * Math.PI) * (0.28 + (i % 2) * 0.05);
      } else {
        const bu = (tossU - 0.72) / 0.28;
        lift = Math.sin(bu * Math.PI) * 0.055;
      }
      const spin = (1 - smooth01(tossU)) * (Math.PI * (3 + (i % 2)));
      const finalFlip = ((liuboPlays + i * 3) % 2 === 0) ? 0 : Math.PI;
      const yaw = lerp(0.22, landAng * 0.6, smooth01(tossU));
      setInst(liuboMesh, i, curX, by + 0.008 + lift, curZ, 0.015, 0.009, 0.19, spin, yaw, finalFlip + spin * 0.5);
    }

    // Phase 2 (u in 0.52..0.95): vermilion Xiao piece lifts and slides to next Liubo corner
    const moveU = clamp((u - 0.52) / 0.42, 0, 1);
    const eMove = smooth01(moveU);
    const [p0x, p0z] = LIUBO_CORNERS[prevIdx];
    const [p1x, p1z] = LIUBO_CORNERS[cornerIdx];
    const px = bx + lerp(p0x, p1x, eMove);
    const pz = bz + lerp(p0z, p1z, eMove);
    const py = by + 0.026 + Math.sin(moveU * Math.PI) * 0.095;
    const pPitch = Math.sin(moveU * Math.PI) * 0.16;
    setInst(liuboMesh, 6, px, py, pz, 0.088, 0.048, 0.066, pPitch, lerp(0.08 * prevIdx, 0.08 * cornerIdx, eMove), 0);
    liuboMesh.instanceMatrix.needsUpdate = true;
  }

  function writeFishTrapPose() {
    if (!carpMesh || !splashMesh || !trap || !shoreAnchor) return;
    if (trapTimer <= 0) {
      carpMesh.visible = false;
      splashMesh.visible = false;
      if (submergedTrapGroup && savedTrapTransform) {
        submergedTrapGroup.position.set(savedTrapTransform.x, savedTrapTransform.y, savedTrapTransform.z);
        submergedTrapGroup.rotation.set(savedTrapTransform.rx, savedTrapTransform.ry, savedTrapTransform.rz);
      }
      return;
    }

    const u = clamp(1 - trapTimer / TRAP_DUR, 0, 1);
    carpMesh.visible = true;
    splashMesh.visible = true;

    // Gentle upward tug & sway on the submerged bamboo fish trap
    const tugEnv = Math.sin(u * Math.PI);
    if (submergedTrapGroup && savedTrapTransform) {
      submergedTrapGroup.position.set(
        savedTrapTransform.x,
        savedTrapTransform.y + tugEnv * 0.22,
        savedTrapTransform.z
      );
      submergedTrapGroup.rotation.set(
        savedTrapTransform.rx + Math.sin(u * TAU * 2) * 0.06 * tugEnv,
        savedTrapTransform.ry,
        savedTrapTransform.rz + Math.cos(u * TAU * 2.5) * 0.08 * tugEnv
      );
    }

    // Carp 0: arcs gracefully above the stream bamboo trap and splashes back into the creek
    const arc0 = Math.sin(u * Math.PI);
    const wag0 = Math.sin(u * 42) * 0.26;
    const c0x = trap.x + Math.cos(trap.yaw + 0.4) * (u - 0.5) * 0.55;
    const c0z = trap.z + Math.sin(trap.yaw + 0.4) * (u - 0.5) * 0.55;
    const c0y = trap.y + 0.06 + arc0 * 0.54;
    const pitch0 = -Math.cos(u * Math.PI) * 0.68;
    setInst(carpMesh, 0, c0x, c0y, c0z, 1.15, 1.15, 1.15, pitch0, trap.yaw + wag0, wag0 * 0.4);

    // Carp 1: lively silver fish hopping right inside the shore bamboo basket in front of the player
    const hopPhase = (u * 2.0) % 1.0;
    const arc1 = Math.sin(hopPhase * Math.PI) * Math.sin(u * Math.PI);
    const wag1 = Math.sin(u * 48 + 1.2) * 0.32;
    setInst(
      carpMesh,
      1,
      shoreAnchor.x,
      shoreAnchor.y - 0.08 + arc1 * 0.30,
      shoreAnchor.z,
      0.86,
      0.86,
      0.86,
      -Math.cos(hopPhase * Math.PI) * 0.45,
      trap.yaw + Math.PI * 0.5 + wag1,
      0.35
    );
    carpMesh.instanceMatrix.needsUpdate = true;

    // 4 expanding splash rings (2 on stream surface around submerged trap, 2 water-droplet rings above shore basket)
    for (let r = 0; r < 2; r++) {
      const ru = (u * 1.35 + r * 0.42) % 1.0;
      const sc = (0.35 + ru * 1.85) * Math.sin(u * Math.PI);
      setInst(splashMesh, r, trap.x, trap.y + 0.02, trap.z, sc, 1, sc, 0, ru * 1.5, 0);
    }
    for (let r = 0; r < 2; r++) {
      const ru = (u * 1.8 + r * 0.5) % 1.0;
      const sc = (0.20 + ru * 0.65) * Math.sin(u * Math.PI);
      setInst(splashMesh, 2 + r, shoreAnchor.x, shoreAnchor.y + 0.02 + ru * 0.14, shoreAnchor.z, sc, 1, sc, 0.2 * (r ? 1 : -1), ru * 2.2, 0);
    }
    splashMat.opacity = 0.68 * Math.sin(u * Math.PI);
    splashMesh.instanceMatrix.needsUpdate = true;
  }

  writeLiuboPose();
  writeFishTrapPose();

  function trigger(which) {
    if (disposed) return null;
    if (which === 'liubo' && board && liuboMesh) {
      liuboPlays += 1;
      liuboTimer = LIUBO_DUR;
      liuboClackedLand = false;
      liuboClackedMove = false;
      ctx.sound?.wood?.(board.x, board.z);
      const peers = ctx.communityLife?.getInteractables?.() || [];
      for (const p of peers) {
        if (p.role === 'liubo_player' && Math.hypot(p.x - board.x, p.z - board.z) < 3.2) {
          ctx.communityLife?.greet?.(p.id, board.x, board.z, 2.2);
        }
      }
      writeLiuboPose();
      const line = LIUBO_NOTES[(liuboPlays - 1) % LIUBO_NOTES.length];
      showNote(line, 4.8);
      return { id: 'tactile:liubo', plays: liuboPlays, line };
    }
    if (which === 'fishtrap' && trap && shoreAnchor && carpMesh) {
      trapPlays += 1;
      trapTimer = TRAP_DUR;
      ctx.sound?.wood?.(shoreAnchor.x, shoreAnchor.z);
      if (typeof ctx.sound?.footstep === 'function') {
        ctx.sound.footstep(trap.x, trap.z, true);
      }
      writeFishTrapPose();
      const line = FISHTRAP_NOTES[(trapPlays - 1) % FISHTRAP_NOTES.length];
      showNote(line, 4.8);
      return { id: 'tactile:fishtrap', plays: trapPlays, line };
    }
    return null;
  }

  function pickTarget(camera, cfg) {
    if (disposed) return null;
    const doc = ctx.doc;
    if (doc && (!interactionAllowed(null, doc) || storyBusy(doc))) return null;

    const ps = ctx.player?.state;
    const cam = camera || ctx.camera;
    if (!ps || !cam || ps.aboardSkiff) return null;

    // If seated elsewhere (not at pavilion stone table), do not offer prop play
    if (ps.seated && ps.seatId !== 'pavilion-seat') return null;

    const third = ps.view === 'third';
    const eyeX = third ? ps.x : cam.position.x;
    const eyeY = third ? ps.y + (ps.eyeHeight || 1.65) : cam.position.y;
    const eyeZ = third ? ps.z : cam.position.z;
    const cp = Math.cos(ps.pitch || 0);
    const fx = -Math.sin(ps.yaw || 0) * cp;
    const fy = Math.sin(ps.pitch || 0);
    const fz = -Math.cos(ps.yaw || 0) * cp;
    const alignWeight = Math.max(2.4, (cfg?.alignBias ?? 0.9) * 2.8);

    let best = null;

    // Candidate 1: Pavilion Liubo Board (茅亭六博局)
    if (board && liuboMesh && liuboTimer <= 0.25) {
      const planar = Math.hypot(board.x - ps.x, board.z - ps.z);
      if (planar <= 2.65) {
        const ty = board.y + 0.06;
        const dx = board.x - eyeX;
        const dy = ty - eyeY;
        const dz = board.z - eyeZ;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const dot = (dx * fx + dy * fy + dz * fz) / dist;
        const minDot = ps.seated && ps.seatId === 'pavilion-seat' ? 0.30 : 0.66;
        if (dot >= minDot && dist <= 3.5) {
          const score = dist * 0.86 + (1 - dot) * alignWeight;
          best = {
            kind: 'mystery',
            key: 'tactile:liubo',
            isTactile: true,
            tactileKind: 'liubo',
            noCameraLock: true,
            name: '茅亭六博',
            label: '茅亭六博',
            prompt: '投箸行棋 · 茅亭六博',
            x: board.x,
            y: ty,
            z: board.z,
            dist,
            dot,
            score
          };
        }
      }
    }

    // Candidate 2: Streamside Woven Fish Trap (溪畔竹编鱼篓/竹筌)
    if (trap && shoreAnchor && carpMesh && trapTimer <= 0.25 && !ps.seated) {
      const planarShore = Math.hypot(shoreAnchor.x - ps.x, shoreAnchor.z - ps.z);
      if (planarShore <= 3.55) {
        // Check alignment against either the shore bamboo basket or the stream haul-line trap
        let bestDot = -1;
        let bestDist = 99;
        let focusPt = shoreAnchor;
        for (const pt of [shoreAnchor, { x: trap.x, y: trap.y + 0.25, z: trap.z }]) {
          const dx = pt.x - eyeX;
          const dy = pt.y - eyeY;
          const dz = pt.z - eyeZ;
          const d = Math.hypot(dx, dy, dz) || 1;
          const dtDot = (dx * fx + dy * fy + dz * fz) / d;
          if (dtDot > bestDot) {
            bestDot = dtDot;
            bestDist = Math.min(d, planarShore + 0.4);
            focusPt = pt;
          }
        }
        if (bestDot >= 0.48) {
          const score = bestDist * 0.86 + (1 - bestDot) * alignWeight;
          if (!best || score < best.score) {
            best = {
              kind: 'mystery',
              key: 'tactile:fishtrap',
              isTactile: true,
              tactileKind: 'fishtrap',
              noCameraLock: true,
              name: '溪畔竹筌',
              label: '溪畔竹筌',
              prompt: '提篓察看 · 溪畔竹筌',
              x: focusPt.x,
              y: focusPt.y,
              z: focusPt.z,
              dist: bestDist,
              dot: bestDot,
              score
            };
          }
        }
      }
    }

    return best;
  }

  function interact(target) {
    if (disposed || !target?.isTactile) return null;
    if (ctx.doc && (!interactionAllowed(null, ctx.doc) || storyBusy(ctx.doc))) return null;
    return trigger(target.tactileKind);
  }

  function wrapMysteries(m) {
    if (!m || m._tactileWrapped) return;
    m._tactileWrapped = true;
    const prevPick = typeof m.pickTarget === 'function' ? m.pickTarget.bind(m) : null;
    const prevInteract = typeof m.interact === 'function' ? m.interact.bind(m) : null;
    const prevHide = typeof m.hide === 'function' ? m.hide.bind(m) : null;

    m.pickTarget = function (camera, cfg) {
      const base = prevPick ? prevPick(camera, cfg) : null;
      const own = pickTarget(camera, cfg);
      if (!base) return own;
      if (!own) return base;
      return own.score < base.score ? own : base;
    };

    m.interact = function (target) {
      if (target?.isTactile) return interact(target);
      return prevInteract ? prevInteract(target) : null;
    };

    m.hide = function () {
      hideNote();
      return prevHide ? prevHide() : undefined;
    };
  }

  function bind(nextCtx = {}) {
    if (disposed) return;
    for (const k of ['mysteries', 'player', 'camera', 'sound', 'communityLife', 'doc']) {
      if (nextCtx[k] !== undefined && nextCtx[k] !== null) ctx[k] = nextCtx[k];
    }
    wrapMysteries(ctx.mysteries);
  }

  function update(dt) {
    if (disposed) return;
    if (ctx.doc && mysteryUiPaused(ctx.doc)) {
      hideNote();
      return;
    }
    if (!Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.05);

    if (noteActive) {
      if (ctx.doc && storyBusy(ctx.doc)) {
        hideNote();
      } else if (noteTimer > 0) {
        noteTimer = Math.max(0, noteTimer - step);
        if (noteTimer <= 0) hideNote();
      }
    }

    if (liuboTimer > 0) {
      liuboTimer = Math.max(0, liuboTimer - step);
      const u = clamp(1 - liuboTimer / LIUBO_DUR, 0, 1);
      if (!liuboClackedLand && u >= 0.45 && board) {
        liuboClackedLand = true;
        ctx.sound?.wood?.(board.x, board.z);
      }
      if (!liuboClackedMove && u >= 0.90 && board) {
        liuboClackedMove = true;
        ctx.sound?.wood?.(board.x, board.z);
      }
      writeLiuboPose();
    }

    if (trapTimer > 0) {
      trapTimer = Math.max(0, trapTimer - step);
      writeFishTrapPose();
    }
  }

  function getStats() {
    let drawCalls = 0;
    if (liuboMesh?.visible) drawCalls += 1;
    if (carpMesh?.visible) drawCalls += 1;
    if (splashMesh?.visible) drawCalls += 1;
    return {
      built: Boolean(liuboMesh || carpMesh),
      hasLiubo: Boolean(liuboMesh),
      hasFishTrap: Boolean(carpMesh),
      liuboAnimating: liuboTimer > 0,
      liuboPlays,
      trapAnimating: trapTimer > 0,
      trapPlays,
      drawCalls,
      lastNoteText,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    hideNote();
    if (submergedTrapGroup && savedTrapTransform) {
      submergedTrapGroup.position.set(savedTrapTransform.x, savedTrapTransform.y, savedTrapTransform.z);
      submergedTrapGroup.rotation.set(savedTrapTransform.rx, savedTrapTransform.ry, savedTrapTransform.rz);
    }
    if (liuboGeo) liuboGeo.dispose();
    if (liuboMat) liuboMat.dispose();
    if (carpGeo) carpGeo.dispose();
    if (carpMat) carpMat.dispose();
    if (splashGeo) splashGeo.dispose();
    if (splashMat) splashMat.dispose();
    group.removeFromParent();
  }

  return {
    group,
    bind,
    pickTarget,
    interact,
    trigger,
    update,
    getStats,
    dispose
  };
}
