import * as THREE from 'three';
import { makePeopleParts } from '../character-parts.js';

// One opaque draw per shape, shared across EVERY actor/tool, not one mesh per limb.
// Matrices form a lightweight CPU rig. Geometry and instance tint both provide real colors.
const UP = new THREE.Vector3(0,1,0);
const CLOTH_PALETTES = [0xc8b48c,0x9fae8e,0xb98e6c,0x8e9aa8,0xc4a25e,0xa8836a];
const FEMALE_PALETTES = [0xd4b6aa,0xb8c4ae,0xcab896,0x9fb0b8,0xd1a999,0xb7a58e];
const PEOPLE_PALETTE = {
  skin: '#E2BE9B', hair: '#2B2420', elderHair: '#AAA99A', hat: '#C9B27E',
  mouth: '#936F5E', eye: '#3B322B', lip: '#B08472', earShade: '#C89B79',
  collar: '#DED4B9', trim: '#D7C7A4', sash: '#7C6750', cuff: '#C9BEA5',
  trousers: '#575C51', shoe: '#3F3C32', hatBand: '#796143', basket: '#B29363', jade: '#93AA93'
};
function createActorResources() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const parts = makePeopleParts(PEOPLE_PALETTE);
  const geometry = {
    box: new THREE.BoxGeometry(1, 1, 1),
    round: new THREE.SphereGeometry(1, 5, 3),
    taper: new THREE.CylinderGeometry(.74, 1, 1, 6, 1, true),
    cone: new THREE.ConeGeometry(1, 1, 6, 1),
    fan: new THREE.CircleGeometry(1, 9, 0, Math.PI * 1.08),
    robe: parts.robe,
    trim: parts.trim,
    head: parts.head,
    femaleHead: parts.femaleHead,
    elderHead: parts.elderHead,
    childHead: parts.childHead,
    hat: parts.hat,
    shoe: parts.shoe,
  };
  parts.sleeve.dispose(); parts.cuff.dispose(); parts.hand.dispose(); parts.leg.dispose(); parts.basket.dispose(); parts.stool.dispose();
  // A fan is thin opaque double-sided paper. Other parts keep back-face culling.
  const fanMaterial = material.clone(); fanMaterial.side = THREE.DoubleSide;
  const keys = Object.keys(geometry);
  const triCount = {};
  const perActor = {};
  for (const key of keys) {
    const g = geometry[key];
    if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    triCount[key] = (g.index?.count || g.attributes.position.count) / 3;
    perActor[key] = key === 'box' || key === 'taper' || key === 'round' ? 32 : (key === 'cone' || key === 'fan' ? 8 : 3);
  }
  return { material, fanMaterial, geometry, keys, triCount, perActor };
}

function createRigPoseBuilder(writer) {
  const root = new THREE.Matrix4(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), color = new THREE.Color();
  const euler = new THREE.Euler(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vd = new THREE.Vector3();
  let origin = [0, 0, 0], yaw = 0, size = 1;

  function begin() {
    writer.begin();
  }
  function actor(x, y, z, rotation, scale) {
    origin = [x, y, z]; yaw = rotation; size = scale;
    root.compose(pos.set(x, y, z), q.setFromAxisAngle(UP, rotation), sc.setScalar(scale));
  }
  function part(key, p, s, tint, rotation = null) {
    pos.set(p[0], p[1], p[2]); sc.set(s[0], s[1], s[2]);
    if (rotation) q.setFromEuler(euler.set(rotation[0], rotation[1], rotation[2]));
    else q.identity();
    m.compose(pos, q, sc).premultiply(root);
    color.setHex(tint);
    writer.emit(key, origin[0], origin[1], origin[2], size, m, color);
  }
  function segment(key, a, b, width, depth, tint) {
    va.set(a[0], a[1], a[2]); vb.set(b[0], b[1], b[2]); vd.subVectors(vb, va);
    const len = vd.length();
    pos.addVectors(va, vb).multiplyScalar(.5); sc.set(width, len, depth);
    if (len > 1e-9) q.setFromUnitVectors(UP, vd.multiplyScalar(1 / len)); else q.identity();
    m.compose(pos, q, sc).premultiply(root);
    color.setHex(tint);
    writer.emit(key, origin[0], origin[1], origin[2], size, m, color);
  }
  function world(p) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { x: origin[0] + size * (p[0] * c + p[2] * s), y: origin[1] + size * p[1], z: origin[2] + size * (-p[0] * s + p[2] * c) };
  }
  function human(a, p) {
    const isFemale = !!(a.female || a.voiceRole === 'woman' || a.kind === 'wash' || a.role === 'weaver' || a.role === 'feast_guest' || a.id?.includes('feaster-2'));
    const cloth = isFemale ? FEMALE_PALETTES[a.index % FEMALE_PALETTES.length] : CLOTH_PALETTES[a.index % CLOTH_PALETTES.length];
    const trim = isFemale ? 0xe5dac2 : 0xd6c7a4, pants = isFemale ? 0x5c574e : 0x414e55, skin = 0xe2be9b;
    const lower = p.crouch || 0, lean = p.lean || 0, hip = .77 - lower * .32, shoulder = 1.34 - lower * .38;
    // Sculpted crossed-collar robe and sash from unified character parts.
    const torsoH = (shoulder - hip) / .57, torsoY = shoulder - .24 * torsoH, bodyW = isFemale ? .91 : .96;
    part('robe', [0, torsoY, lean * .38], [bodyW, torsoH, .96], cloth, [.06 + lean * .28, 0, 0]);
    part('trim', [0, torsoY, lean * .38], [bodyW, torsoH, .96], 0xffffff, [.06 + lean * .28, 0, 0]);
    // Smooth two-link legs with proportional Qin-Han trousers and sculpted shoes (翘头麻底履).
    const walkVal = p.walk || 0;
    for (const side of [-1, 1]) {
      const stepPhase = walkVal * side;
      const stepLift = Math.max(0, stepPhase) * 0.042 + Math.abs(stepPhase) * 0.008;
      const footZ = .06 + stepPhase * .17 + lower * .10;
      const shoeY = .015 + stepLift;
      const shoePitch = Math.max(-.18, Math.min(.18, -stepPhase * .22));
      const ankleY = shoeY + .052 * Math.cos(shoePitch);
      const ankleZ = footZ - .052 * Math.sin(shoePitch);
      const knee = [side * .126, .40 - lower * .22 + stepLift * .45, .04 + lower * .26 + stepPhase * .07];
      segment('taper', [side * .114, hip, 0], knee, .068, .068, pants);
      part('round', knee, [.050, .050, .050], pants);
      segment('taper', knee, [side * .124, ankleY, ankleZ], .052, .052, pants);
      part('shoe', [side * .124, shoeY, footZ], [1.02, 1.02, 1.02], 0xffffff, [shoePitch, 0, 0]);
    }
    const neck = [0, shoulder + .08, lean * .6]; segment('taper', [0, shoulder - .02, lean * .55], neck, .048, .046, skin);
    const headKey = a.kind === 'elder' ? 'elderHead' : a.child ? 'childHead' : isFemale ? 'femaleHead' : 'head';
    const headScale = a.child ? 1.12 : a.kind === 'elder' ? 1.03 : isFemale ? .98 : 1;
    const head = [p.headTurn * .02, shoulder + .24, lean * .6 + .02];
    part(headKey, head, [headScale, headScale, headScale], 0xffffff, [p.nod || 0, p.headTurn || 0, 0]);
    // Two-link IK: shoulders nestled flush into robe slope, tapered Qin-Han sleeves & trim cuffs; wrists stay exact IK contact points.
    for (const side of [-1, 1]) {
      const hand = side < 0 ? p.left : p.right, start = [side * (isFemale ? .180 : .194), shoulder - .066, lean * .44];
      const elbow = [start[0] + side * .046, (start[1] + hand[1]) * .5 - .082, (start[2] + hand[2]) * .5 - .072];
      part('round', start, [.064, .064, .062], cloth);
      segment('taper', start, elbow, .066, .064, cloth);
      part('round', elbow, [.049, .049, .049], cloth);
      segment('taper', hand, elbow, .068, .076, cloth);
      const cuff = [elbow[0] * .16 + hand[0] * .84, elbow[1] * .16 + hand[1] * .84, elbow[2] * .16 + hand[2] * .84];
      segment('taper', hand, cuff, .070, .078, trim);
      part('round', hand, [.036, .048, .028], skin);
    }
    if (a.kind === 'beekeeper') {
      // Sculpted straw sun bonnet plus opaque neck drape.
      part('hat', head, [headScale * 1.04, headScale * 1.04, headScale * 1.04], 0xffffff, [p.nod || 0, p.headTurn || 0, 0]);
      part('box', [-.18, head[1] - .11, head[2] - .02], [.035, .24, .18], 0xbcaf83);
      part('box', [.18, head[1] - .11, head[2] - .02], [.035, .24, .18], 0xbcaf83);
    }
    return { left: world(p.left), right: world(p.right) };
  }
  return { begin, actor, part, segment, world, human };
}

export function createCommunityActors(group, capacity) {
  const res = createActorResources();
  const batches = {}; const count = {};
  const bMinX = {}; const bMinY = {}; const bMinZ = {}; const bMaxX = {}; const bMaxY = {}; const bMaxZ = {}; const bMaxS = {};
  for (const key of res.keys) {
    const maxCount = Math.max(1, capacity * res.perActor[key]);
    const mesh = new THREE.InstancedMesh(res.geometry[key], key === 'fan' ? res.fanMaterial : res.material, maxCount);
    mesh.name = 'community-life-' + key; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = true; mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4); mesh.count = 0; mesh.visible = false; group.add(mesh); batches[key] = mesh; count[key] = 0;
    bMinX[key] = Infinity; bMinY[key] = Infinity; bMinZ[key] = Infinity; bMaxX[key] = -Infinity; bMaxY[key] = -Infinity; bMaxZ[key] = -Infinity; bMaxS[key] = 1;
  }
  const writer = {
    begin() {
      for (const k of res.keys) {
        count[k] = 0;
        bMinX[k] = Infinity; bMinY[k] = Infinity; bMinZ[k] = Infinity;
        bMaxX[k] = -Infinity; bMaxY[k] = -Infinity; bMaxZ[k] = -Infinity; bMaxS[k] = 1;
      }
    },
    emit(key, ox, oy, oz, size, matrix, col) {
      const i = count[key]++, mesh = batches[key];
      if (i >= mesh.instanceMatrix.count) throw new Error('community rig capacity exceeded');
      if (ox < bMinX[key]) bMinX[key] = ox; if (ox > bMaxX[key]) bMaxX[key] = ox;
      if (oy < bMinY[key]) bMinY[key] = oy; if (oy > bMaxY[key]) bMaxY[key] = oy;
      if (oz < bMinZ[key]) bMinZ[key] = oz; if (oz > bMaxZ[key]) bMaxZ[key] = oz;
      if (size > bMaxS[key]) bMaxS[key] = size;
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, col);
    }
  };
  const api = createRigPoseBuilder(writer);
  function finish() {
    for (const k of res.keys) {
      const mesh = batches[k], n = count[k];
      mesh.count = n; mesh.visible = n > 0;
      if (n > 0) {
        const scK = bMaxS[k];
        const cx = (bMinX[k] + bMaxX[k]) * .5;
        const cy = (bMinY[k] + bMaxY[k]) * .5 + .8 * scK;
        const cz = (bMinZ[k] + bMaxZ[k]) * .5;
        const rad = Math.hypot(bMaxX[k] - bMinX[k], bMaxY[k] - bMinY[k], bMaxZ[k] - bMinZ[k]) * .5 + 2.6 * scK;
        mesh.boundingSphere.center.set(cx, cy, cz); mesh.boundingSphere.radius = rad;
        mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, n * 3); mesh.instanceColor.needsUpdate = true; }
      }
    }
  }
  function stats() { let triangles = 0, instances = 0, drawCalls = 0; for (const k of res.keys) { const c = batches[k].count; triangles += res.triCount[k] * c; instances += c; if (c) drawCalls++; } return { triangles, instances, drawCalls }; }
  function dispose() { for (const g of Object.values(res.geometry)) g.dispose(); res.material.dispose(); res.fanMaterial.dispose(); group.clear(); }
  return { begin: api.begin, actor: api.actor, part: api.part, segment: api.segment, human: api.human, world: api.world, finish, stats, dispose };
}

export function createCommunityActorPool(group, initialCapacity = 64) {
  const res = createActorResources();
  const batches = {};
  for (const key of res.keys) {
    const maxCount = Math.max(1, initialCapacity * res.perActor[key]);
    const mesh = new THREE.InstancedMesh(res.geometry[key], key === 'fan' ? res.fanMaterial : res.material, maxCount);
    mesh.name = 'community-life-' + key;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    mesh.count = 0;
    mesh.visible = false;
    group.add(mesh);
    batches[key] = mesh;
  }

  const channels = [];
  let poolDirty = false;
  let disposed = false;
  const _projScreen = new THREE.Matrix4();
  const _frustum = new THREE.Frustum();
  const _sphere = new THREE.Sphere(new THREE.Vector3(), 2.6);
  const _prevProj = new Float64Array(16);
  let _hasCamCache = false;
  let _prevCamX = 0, _prevCamY = 0, _prevCamZ = 0, _prevMaxDist = -1;

  function isOwnerVisible(ownerGroup) {
    for (let p = ownerGroup; p; p = p.parent) {
      if (!p.visible) return false;
    }
    return true;
  }

  function ensurePoolCapacity(key, needed) {
    const cur = batches[key];
    if (needed <= cur.instanceMatrix.count) return cur;
    const nextCap = Math.max(needed, cur.instanceMatrix.count * 2);
    const nextMesh = new THREE.InstancedMesh(res.geometry[key], key === 'fan' ? res.fanMaterial : res.material, nextCap);
    nextMesh.name = cur.name;
    nextMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nextMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nextCap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    nextMesh.frustumCulled = true;
    nextMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    nextMesh.count = 0;
    nextMesh.visible = false;
    group.remove(cur);
    cur.dispose();
    group.add(nextMesh);
    batches[key] = nextMesh;
    return nextMesh;
  }

  function createChannel(ownerGroup, capacity) {
    const matrices = {};
    const colors = {};
    const caps = {};
    const count = {};
    const bMinX = {}; const bMinY = {}; const bMinZ = {}; const bMaxX = {}; const bMaxY = {}; const bMaxZ = {}; const bMaxS = {};
    for (const key of res.keys) {
      const cap = Math.max(1, capacity * res.perActor[key]);
      caps[key] = cap;
      matrices[key] = new Float32Array(cap * 16);
      colors[key] = new Float32Array(cap * 3);
      count[key] = 0;
      bMinX[key] = Infinity; bMinY[key] = Infinity; bMinZ[key] = Infinity;
      bMaxX[key] = -Infinity; bMaxY[key] = -Infinity; bMaxZ[key] = -Infinity; bMaxS[key] = 1;
    }
    const ch = {
      ownerGroup,
      count,
      matrices,
      colors,
      bMinX, bMinY, bMinZ, bMaxX, bMaxY, bMaxZ, bMaxS,
      version: 0,
      flushedVersion: -1,
      flushedVisible: false,
      disposed: false
    };
    channels.push(ch);

    const writer = {
      begin() {
        for (const k of res.keys) {
          count[k] = 0;
          bMinX[k] = Infinity; bMinY[k] = Infinity; bMinZ[k] = Infinity;
          bMaxX[k] = -Infinity; bMaxY[k] = -Infinity; bMaxZ[k] = -Infinity; bMaxS[k] = 1;
        }
      },
      emit(key, ox, oy, oz, size, matrix, col) {
        const i = count[key]++;
        if (i >= caps[key]) throw new Error('community rig capacity exceeded');
        if (ox < bMinX[key]) bMinX[key] = ox; if (ox > bMaxX[key]) bMaxX[key] = ox;
        if (oy < bMinY[key]) bMinY[key] = oy; if (oy > bMaxY[key]) bMaxY[key] = oy;
        if (oz < bMinZ[key]) bMinZ[key] = oz; if (oz > bMaxZ[key]) bMaxZ[key] = oz;
        if (size > bMaxS[key]) bMaxS[key] = size;
        const mOff = i * 16;
        const me = matrix.elements;
        const dstM = matrices[key];
        for (let t = 0; t < 16; t++) dstM[mOff + t] = me[t];
        const cOff = i * 3;
        const dstC = colors[key];
        dstC[cOff] = col.r;
        dstC[cOff + 1] = col.g;
        dstC[cOff + 2] = col.b;
      }
    };
    const api = createRigPoseBuilder(writer);

    function finish() {
      if (ch.disposed) return;
      ch.version++;
      poolDirty = true;
    }
    function stats() {
      let triangles = 0, instances = 0, drawCalls = 0;
      for (const k of res.keys) {
        const c = count[k];
        triangles += res.triCount[k] * c;
        instances += c;
        if (c) drawCalls++;
      }
      return { triangles, instances, drawCalls };
    }
    function dispose() {
      if (ch.disposed) return;
      ch.disposed = true;
      const idx = channels.indexOf(ch);
      if (idx >= 0) channels.splice(idx, 1);
      poolDirty = true;
    }
    return { begin: api.begin, actor: api.actor, part: api.part, segment: api.segment, human: api.human, world: api.world, finish, stats, dispose };
  }

  function flush(camera = null, maxDistance = 326) {
    if (disposed) return false;
    const hasCam = Boolean(
      camera && camera.projectionMatrix && camera.matrixWorldInverse && camera.matrixWorld
    );
    let camX = 0, camY = 0, camZ = 0, camChanged = false;
    const maxDist = Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : 326;
    if (hasCam) {
      _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const ce = camera.matrixWorld.elements;
      camX = ce[12]; camY = ce[13]; camZ = ce[14];
      const pe = _projScreen.elements;
      camChanged = !_hasCamCache ||
        camX !== _prevCamX || camY !== _prevCamY || camZ !== _prevCamZ ||
        maxDist !== _prevMaxDist;
      if (!camChanged) {
        for (let i = 0; i < 16; i++) {
          if (pe[i] !== _prevProj[i]) { camChanged = true; break; }
        }
      }
      if (camChanged) {
        for (let i = 0; i < 16; i++) _prevProj[i] = pe[i];
        _prevCamX = camX; _prevCamY = camY; _prevCamZ = camZ; _prevMaxDist = maxDist;
        _hasCamCache = true;
        _frustum.setFromProjectionMatrix(_projScreen, camera.coordinateSystem);
      }
    }

    let changed = poolDirty || camChanged;
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      const vis = isOwnerVisible(ch.ownerGroup);
      ch._curVis = vis;
      if (ch.version !== ch.flushedVersion || vis !== ch.flushedVisible) changed = true;
    }
    if (!changed) return false;

    const maxDistSq = maxDist * maxDist;
    for (const k of res.keys) {
      let maxTotal = 0;
      for (let c = 0; c < channels.length; c++) {
        const ch = channels[c];
        if (!ch._curVis) continue;
        const cnt = ch.count[k];
        if (cnt <= 0) continue;
        if (hasCam) {
          const cx = (ch.bMinX[k] + ch.bMaxX[k]) * 0.5;
          const cy = (ch.bMinY[k] + ch.bMaxY[k]) * 0.5 + 0.8 * ch.bMaxS[k];
          const cz = (ch.bMinZ[k] + ch.bMaxZ[k]) * 0.5;
          const rad = Math.hypot(ch.bMaxX[k] - ch.bMinX[k], ch.bMaxY[k] - ch.bMinY[k], ch.bMaxZ[k] - ch.bMinZ[k]) * 0.5 + 2.6 * ch.bMaxS[k];
          const dxC = camX - cx, dyC = camY - cy, dzC = camZ - cz;
          const allowR = maxDist + rad;
          if (dxC * dxC + dyC * dyC + dzC * dzC > allowR * allowR) continue;
          _sphere.center.set(cx, cy, cz);
          _sphere.radius = rad;
          if (!_frustum.intersectsSphere(_sphere)) continue;
        }
        maxTotal += cnt;
      }

      if (maxTotal <= 0) {
        const mesh = batches[k];
        mesh.count = 0;
        mesh.visible = false;
        continue;
      }

      const mesh = ensurePoolCapacity(k, maxTotal);
      const dstM = mesh.instanceMatrix.array;
      const dstC = mesh.instanceColor.array;
      let offset = 0;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, maxS = 1;

      if (!hasCam) {
        for (let c = 0; c < channels.length; c++) {
          const ch = channels[c];
          if (!ch._curVis) continue;
          const cnt = ch.count[k];
          if (cnt <= 0) continue;
          dstM.set(ch.matrices[k].subarray(0, cnt * 16), offset * 16);
          dstC.set(ch.colors[k].subarray(0, cnt * 3), offset * 3);
          offset += cnt;
          if (ch.bMinX[k] < minX) minX = ch.bMinX[k];
          if (ch.bMinY[k] < minY) minY = ch.bMinY[k];
          if (ch.bMinZ[k] < minZ) minZ = ch.bMinZ[k];
          if (ch.bMaxX[k] > maxX) maxX = ch.bMaxX[k];
          if (ch.bMaxY[k] > maxY) maxY = ch.bMaxY[k];
          if (ch.bMaxZ[k] > maxZ) maxZ = ch.bMaxZ[k];
          if (ch.bMaxS[k] > maxS) maxS = ch.bMaxS[k];
        }
      } else {
        for (let c = 0; c < channels.length; c++) {
          const ch = channels[c];
          if (!ch._curVis) continue;
          const cnt = ch.count[k];
          if (cnt <= 0) continue;
          const cx = (ch.bMinX[k] + ch.bMaxX[k]) * 0.5;
          const cy = (ch.bMinY[k] + ch.bMaxY[k]) * 0.5 + 0.8 * ch.bMaxS[k];
          const cz = (ch.bMinZ[k] + ch.bMaxZ[k]) * 0.5;
          const rad = Math.hypot(ch.bMaxX[k] - ch.bMinX[k], ch.bMaxY[k] - ch.bMinY[k], ch.bMaxZ[k] - ch.bMinZ[k]) * 0.5 + 2.6 * ch.bMaxS[k];
          const dxC = camX - cx, dyC = camY - cy, dzC = camZ - cz;
          const allowR = maxDist + rad;
          if (dxC * dxC + dyC * dyC + dzC * dzC > allowR * allowR) continue;
          _sphere.center.set(cx, cy, cz);
          _sphere.radius = rad;
          if (!_frustum.intersectsSphere(_sphere)) continue;

          const srcM = ch.matrices[k];
          const srcC = ch.colors[k];
          if (ch.bMaxS[k] > maxS) maxS = ch.bMaxS[k];
          const padR = 2.6 * ch.bMaxS[k];
          for (let i = 0; i < cnt; i++) {
            const mOff = i * 16;
            const mx = srcM[mOff + 12];
            const my = srcM[mOff + 13];
            const mz = srcM[mOff + 14];
            const dx = mx - camX, dy = my - camY, dz = mz - camZ;
            if (dx * dx + dy * dy + dz * dz > maxDistSq) continue;
            _sphere.center.set(mx, my, mz);
            _sphere.radius = padR;
            if (!_frustum.intersectsSphere(_sphere)) continue;
            const dOff = offset * 16;
            for (let t = 0; t < 16; t++) dstM[dOff + t] = srcM[mOff + t];
            const sCOff = i * 3;
            const dCOff = offset * 3;
            dstC[dCOff] = srcC[sCOff];
            dstC[dCOff + 1] = srcC[sCOff + 1];
            dstC[dCOff + 2] = srcC[sCOff + 2];
            if (mx < minX) minX = mx; if (mx > maxX) maxX = mx;
            if (my < minY) minY = my; if (my > maxY) maxY = my;
            if (mz < minZ) minZ = mz; if (mz > maxZ) maxZ = mz;
            offset++;
          }
        }
      }

      mesh.count = offset;
      mesh.visible = offset > 0;
      if (offset > 0) {
        const cx = (minX + maxX) * .5;
        const cy = (minY + maxY) * .5 + .8 * maxS;
        const cz = (minZ + maxZ) * .5;
        const rad = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * .5 + 2.6 * maxS;
        mesh.boundingSphere.center.set(cx, cy, cz);
        mesh.boundingSphere.radius = rad;
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, offset * 16);
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, offset * 3);
          mesh.instanceColor.needsUpdate = true;
        }
      }
    }

    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      ch.flushedVersion = ch.version;
      ch.flushedVisible = ch._curVis;
    }
    poolDirty = false;
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (let c = 0; c < channels.length; c++) channels[c].disposed = true;
    channels.length = 0;
    for (const g of Object.values(res.geometry)) g.dispose();
    res.material.dispose();
    res.fanMaterial.dispose();
    for (const k of res.keys) batches[k].dispose();
    group.clear();
  }

  return { createChannel, flush, dispose };
}
