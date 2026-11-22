import * as THREE from 'three';

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function buildQuad(pos, col, a, b, c, d, ca, cb, cc, cd) {
  const push = (p, color) => {
    pos.push(p[0], p[1], p[2]);
    col.push(color.r, color.g, color.b);
  };
  push(a, ca); push(b, cb); push(c, cc);
  push(a, ca); push(c, cc); push(d, cd);
}

const TINT_DAY = new THREE.Color('#FFF5E0');
const TINT_DUSK = new THREE.Color('#FFC996');
const TINT_NIGHT = new THREE.Color('#9EC0E6');
const MOTE_DAY = new THREE.Color('#FFE5B4');
const MOTE_INNER_DAY = new THREE.Color('#FFE2C6');
const MOTE_DUSK = new THREE.Color('#FFC48E');
const MOTE_NIGHT = new THREE.Color('#ACC9EA');

// Additive cave-mouth faint light ("山有小口，仿佛若有光") + inner valley Tyndall shafts ("复行数十步，豁然开朗").
export function createCaveGleam(options = {}) {
  const { cliff, field, emergenceAlong = -13.5, outerMouthAlong = 4.7 } = options;
  const slit = cliff?.slit;
  const group = new THREE.Group();
  group.name = 'cave-gleam';
  group.userData.dynamic = true;

  if (!slit || !Number.isFinite(slit.x) || !Number.isFinite(slit.z)) {
    return {
      group,
      update() {},
      setSuppressed() {},
      reset() {},
      getStats: () => ({
        intensity: 0,
        outerIntensity: 0,
        innerIntensity: 0,
        valleyOpened: false,
        suppressed: false,
        triangles: 0,
        degraded: true
      }),
      dispose() { group.removeFromParent(); }
    };
  }

  const outX = Math.cos(slit.angle || 0);
  const outZ = Math.sin(slit.angle || 0);
  const groundY = Number.isFinite(slit.ground) ? slit.ground : (field ? field.sample(slit.x, slit.z) : 1.5);
  group.position.set(slit.x, groundY, slit.z);
  group.rotation.y = Math.atan2(-outZ, outX);

  const pos = [];
  const col = [];
  const cCore = new THREE.Color('#FFF2D6');
  const cWarm = new THREE.Color('#FFE5B8');
  const cSheen = new THREE.Color('#CFAF82');
  const cZero = new THREE.Color('#000000');

  const isExtended = outerMouthAlong > 6.5;
  // 1. Radial aperture glow disc recessed inside the outer rock cleft mouth.
  const segs = 24;
  const cx = isExtended ? outerMouthAlong - 12.2 : -5.5;
  const cy = 1.45;
  const rDisc = 1.65;
  const shaftStartX = isExtended ? cx + 0.1 : -5.4;
  const shaftEndX = isExtended ? outerMouthAlong + 5.5 : 4.7;
  const floorEndX = isExtended ? outerMouthAlong + 4.8 : 4.2;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    pos.push(
      cx, cy, 0,
      cx - 0.08, cy + Math.sin(a0) * rDisc, Math.cos(a0) * rDisc * 0.72,
      cx - 0.08, cy + Math.sin(a1) * rDisc, Math.cos(a1) * rDisc * 0.72
    );
    col.push(cCore.r, cCore.g, cCore.b, cZero.r, cZero.g, cZero.b, cZero.r, cZero.g, cZero.b);
  }

  // 2. Three slanted soft volumetric light shafts spilling toward exterior stream (+x).
  buildQuad(pos, col, [shaftStartX, 2.05, -0.35], [shaftEndX - 0.2, 1.15, -0.95], [shaftEndX - 0.2, 0.35, -0.95], [shaftStartX, 0.85, -0.35], cWarm, cZero, cZero, cWarm);
  buildQuad(pos, col, [shaftStartX, 2.15, 0.0], [shaftEndX, 1.35, 0.0], [shaftEndX, 0.4, 0.0], [shaftStartX, 0.78, 0.0], cCore, cZero, cZero, cCore);
  buildQuad(pos, col, [shaftStartX, 2.05, 0.35], [shaftEndX - 0.2, 1.15, 0.95], [shaftEndX - 0.2, 0.35, 0.95], [shaftStartX, 0.85, 0.35], cWarm, cZero, cZero, cWarm);

  // 3. Subtle wet floor bounce ribbon along slit floor.
  buildQuad(pos, col, [shaftStartX + 0.3, 0.06, -0.52], [floorEndX, 0.06, -0.68], [floorEndX, 0.06, 0.68], [shaftStartX + 0.3, 0.06, 0.52], cSheen, cZero, cZero, cSheen);

  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const glowMat = new THREE.MeshBasicMaterial({
    color: '#FFF5E0',
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false
  });
  glowMat.userData.skyIgnore = true;
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.name = 'cave-gleam-shafts';
  glowMesh.frustumCulled = false;
  glowMesh.renderOrder = 3;
  group.add(glowMesh);

  // 4. 16 gentle golden floating dust motes near the outer aperture mouth.
  const moteGeo = new THREE.OctahedronGeometry(0.032, 0);
  const moteMat = new THREE.MeshBasicMaterial({
    color: '#FFE5B4',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
  });
  moteMat.userData.skyIgnore = true;
  const moteCount = 16;
  const motes = new THREE.InstancedMesh(moteGeo, moteMat, moteCount);
  motes.name = 'cave-gleam-motes';
  motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  motes.frustumCulled = false;
  motes.renderOrder = 4;
  group.add(motes);

  const moteMinX = isExtended ? outerMouthAlong - 4.0 : -4.2;
  const moteSeeds = Array.from({ length: moteCount }, (_, i) => ({
    x: moteMinX + ((i * 37) % 100) / 100 * 7.8,
    y: 0.45 + ((i * 53) % 100) / 100 * 1.65,
    z: -0.55 + ((i * 71) % 100) / 100 * 1.1,
    phase: i * 1.37
  }));

  // 5. Inner valley emergence Tyndall light-shaft assembly (洞口丁达尔斜射天光) when extended cave is active.
  let innerGlowGeo = null;
  let innerGlowMat = null;
  let innerGlowMesh = null;
  let innerMoteMat = null;
  let innerMotes = null;
  let innerMoteSeeds = null;
  const innerMoteCount = 18;
  let innerTriCount = 0;

  if (isExtended) {
    const iPos = [];
    const iCol = [];
    const cPortalCore = new THREE.Color('#FFF6DC');
    const cRayGold = new THREE.Color('#FFECC2');
    const cRayJade = new THREE.Color('#DCECD0');
    const cMossSheen = new THREE.Color('#B8CEA2');

    // Align subtly with cave-passage inner S-curve lateral offset (~0.34 at portal -> ~0.60 inward)
    const portalZ = 0.34;
    const innerZ = 0.56;
    const haloX = emergenceAlong - 0.55;
    const haloY = 2.22;
    const rHalo = 2.05;
    const haloSegs = 28;
    const cHaloCenter = cPortalCore.clone().multiplyScalar(0.38);
    const haloRings = [0.30, 0.62, 1.0];
    const ringColors = haloRings.map((rf) =>
      rf >= 1.0 ? cZero : cHaloCenter.clone().multiplyScalar(Math.pow(1 - rf, 2.9))
    );
    for (let i = 0; i < haloSegs; i++) {
      const a0 = (i / haloSegs) * Math.PI * 2;
      const a1 = ((i + 1) / haloSegs) * Math.PI * 2;
      const y0 = Math.sin(a0) * rHalo;
      const z0 = Math.cos(a0) * rHalo * 0.92;
      const y1 = Math.sin(a1) * rHalo;
      const z1 = Math.cos(a1) * rHalo * 0.92;
      // Inner fan (0 -> ring 0)
      iPos.push(
        haloX, haloY, portalZ,
        haloX + 0.04, haloY + y0 * haloRings[0], portalZ + z0 * haloRings[0],
        haloX + 0.04, haloY + y1 * haloRings[0], portalZ + z1 * haloRings[0]
      );
      iCol.push(
        cHaloCenter.r, cHaloCenter.g, cHaloCenter.b,
        ringColors[0].r, ringColors[0].g, ringColors[0].b,
        ringColors[0].r, ringColors[0].g, ringColors[0].b
      );
      // Outer feathered concentric bands (dI/dr -> 0 smoothly at r = 1, zero circular Mach band)
      for (let rk = 0; rk < haloRings.length - 1; rk++) {
        const ra = haloRings[rk];
        const rb = haloRings[rk + 1];
        const ca = ringColors[rk];
        const cb = ringColors[rk + 1];
        buildQuad(
          iPos,
          iCol,
          [haloX + 0.08 * ra, haloY + y0 * ra, portalZ + z0 * ra],
          [haloX + 0.08 * rb, haloY + y0 * rb, portalZ + z0 * rb],
          [haloX + 0.08 * rb, haloY + y1 * rb, portalZ + z1 * rb],
          [haloX + 0.08 * ra, haloY + y1 * ra, portalZ + z1 * ra],
          ca,
          cb,
          cb,
          ca
        );
      }
    }

    // 5 layered slanted volumetric Tyndall sunbeam ribbons with soft core-to-edge cross-section feathering
    const rayStartX = emergenceAlong - 0.3;
    const rayEndX = emergenceAlong + 9.2;
    const rayDefs = [
      { z0: -0.82, z1: -1.28, yTop0: 2.72, yBot0: 1.92, yTop1: 0.68, yBot1: 0.14, tilt: 0.24, xShrink: 0.8, col: cRayJade },
      { z0: -0.38, z1: -0.62, yTop0: 2.95, yBot0: 1.82, yTop1: 0.78, yBot1: 0.16, tilt: -0.22, xShrink: 0.2, col: cRayGold },
      { z0:  0.00, z1:  0.02, yTop0: 3.08, yBot0: 1.72, yTop1: 0.82, yBot1: 0.16, tilt: 0.26, xShrink: 0.0, col: cPortalCore },
      { z0:  0.40, z1:  0.64, yTop0: 2.94, yBot0: 1.80, yTop1: 0.76, yBot1: 0.16, tilt: -0.24, xShrink: 0.3, col: cRayGold },
      { z0:  0.84, z1:  1.32, yTop0: 2.66, yBot0: 1.88, yTop1: 0.66, yBot1: 0.14, tilt: 0.22, xShrink: 0.9, col: cRayJade }
    ];
    for (let r = 0; r < rayDefs.length; r++) {
      const b = rayDefs[r];
      const x1 = rayEndX - b.xShrink;
      const pTop0 = [rayStartX, b.yTop0, portalZ + b.z0 - b.tilt * 0.55];
      const pBot0 = [rayStartX, b.yBot0, portalZ + b.z0 + b.tilt * 0.55];
      const pMid0 = [rayStartX, (b.yTop0 + b.yBot0) * 0.5, portalZ + b.z0];
      const pTop1 = [x1, b.yTop1, innerZ + b.z1 - b.tilt * 0.80];
      const pBot1 = [x1, b.yBot1, innerZ + b.z1 + b.tilt * 0.80];
      const pMid1 = [x1, (b.yTop1 + b.yBot1) * 0.5, innerZ + b.z1];
      const cEdge0 = b.col.clone().multiplyScalar(0.08);
      const cCore0 = b.col.clone().multiplyScalar(0.88);
      buildQuad(iPos, iCol, pTop0, pTop1, pMid1, pMid0, cEdge0, cZero, cZero, cCore0);
      buildQuad(iPos, iCol, pMid0, pMid1, pBot1, pBot0, cCore0, cZero, cZero, cEdge0);
    }

    // Damp mossy-jade floor bounce ribbon resting cleanly atop cave floor slabs.
    buildQuad(
      iPos,
      iCol,
      [emergenceAlong - 1.2, 0.07, portalZ - 0.92],
      [emergenceAlong + 8.5, 0.20, innerZ - 1.08],
      [emergenceAlong + 8.5, 0.20, innerZ + 1.08],
      [emergenceAlong - 1.2, 0.07, portalZ + 0.92],
      cMossSheen,
      cZero,
      cZero,
      cMossSheen
    );

    innerGlowGeo = new THREE.BufferGeometry();
    innerGlowGeo.setAttribute('position', new THREE.Float32BufferAttribute(iPos, 3));
    innerGlowGeo.setAttribute('color', new THREE.Float32BufferAttribute(iCol, 3));
    innerGlowMat = new THREE.MeshBasicMaterial({
      color: '#FFF5E0',
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false
    });
    innerGlowMat.userData.skyIgnore = true;
    innerGlowMesh = new THREE.Mesh(innerGlowGeo, innerGlowMat);
    innerGlowMesh.name = 'cave-gleam-inner-shafts';
    innerGlowMesh.frustumCulled = false;
    innerGlowMesh.renderOrder = 3;
    group.add(innerGlowMesh);

    innerMoteMat = new THREE.MeshBasicMaterial({
      color: '#FFE2C6',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    innerMoteMat.userData.skyIgnore = true;
    innerMotes = new THREE.InstancedMesh(moteGeo, innerMoteMat, innerMoteCount);
    innerMotes.name = 'cave-gleam-inner-motes';
    innerMotes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    innerMotes.frustumCulled = false;
    innerMotes.renderOrder = 4;
    group.add(innerMotes);

    innerMoteSeeds = Array.from({ length: innerMoteCount }, (_, i) => ({
      x: (emergenceAlong - 1.5) + ((i * 41 + 13) % 100) / 100 * 9.0,
      y: 0.42 + ((i * 59 + 7) % 100) / 100 * 1.95,
      z: 0.44 - 0.78 + ((i * 73 + 19) % 100) / 100 * 1.56,
      phase: i * 1.21 + 0.6
    }));

    const moteTris = moteGeo.index ? moteGeo.index.count / 3 : moteGeo.attributes.position.count / 3;
    innerTriCount = (iPos.length / 9) + moteTris * innerMoteCount;
  }

  const dummy = new THREE.Matrix4();
  const vPos = new THREE.Vector3();
  const qRot = new THREE.Quaternion();
  const vScale = new THREE.Vector3();

  const moteTrisBase = moteGeo.index ? moteGeo.index.count / 3 : moteGeo.attributes.position.count / 3;
  const triangles = (pos.length / 9) + moteTrisBase * moteCount + innerTriCount;
  let intensity = 0;
  let outerIntensity = 0;
  let innerIntensity = 0;
  let sawExterior = false;
  let valleyOpened = false;
  let emergenceClock = -1;
  const EMERGENCE_DUR = 3.6;
  const emergenceEffect = { active: false, progress: 0, fovDelta: 0, warmth: 0 };
  let suppressed = false;
  let disposed = false;

  function applySuppressedZero() {
    intensity = 0;
    outerIntensity = 0;
    innerIntensity = 0;
    group.visible = false;
    glowMat.opacity = 0;
    moteMat.opacity = 0;
    if (innerGlowMat) innerGlowMat.opacity = 0;
    if (innerMoteMat) innerMoteMat.opacity = 0;
  }

  function setSuppressed(flag) {
    suppressed = Boolean(flag);
    if (suppressed) applySuppressedZero();
  }

  function reset() {
    suppressed = false;
    sawExterior = false;
    valleyOpened = false;
    emergenceClock = -1;
    emergenceEffect.active = false;
    emergenceEffect.progress = 0;
    emergenceEffect.fovDelta = 0;
    emergenceEffect.warmth = 0;
  }

  function updateOuterMotes(t) {
    for (let i = 0; i < moteCount; i++) {
      const m = moteSeeds[i];
      vPos.set(
        m.x + Math.sin(t * 0.45 + m.phase) * 0.24,
        m.y + Math.sin(t * 0.72 + m.phase * 1.3) * 0.16,
        m.z + Math.cos(t * 0.51 + m.phase * 0.9) * 0.18
      );
      const s = 0.75 + 0.35 * Math.sin(t * 1.4 + m.phase);
      vScale.set(s, s, s);
      dummy.compose(vPos, qRot, vScale);
      motes.setMatrixAt(i, dummy);
    }
    motes.instanceMatrix.needsUpdate = true;
  }

  function updateInnerMotes(t) {
    if (!innerMotes || !innerMoteSeeds) return;
    for (let i = 0; i < innerMoteCount; i++) {
      const m = innerMoteSeeds[i];
      vPos.set(
        m.x + Math.sin(t * 0.38 + m.phase) * 0.28,
        m.y + Math.sin(t * 0.64 + m.phase * 1.2) * 0.20,
        m.z + Math.cos(t * 0.46 + m.phase * 0.85) * 0.22
      );
      const s = 0.78 + 0.38 * Math.sin(t * 1.25 + m.phase);
      vScale.set(s, s, s);
      dummy.compose(vPos, qRot, vScale);
      innerMotes.setMatrixAt(i, dummy);
    }
    innerMotes.instanceMatrix.needsUpdate = true;
  }

  updateOuterMotes(0);
  if (isExtended) updateInnerMotes(0);
  group.visible = false;

  function update(dt, elapsed, camPos, sky, onValleyOpen) {
    if (disposed || !camPos) return;
    if (suppressed) {
      applySuppressedZero();
      return;
    }
    const dx = camPos.x - slit.x;
    const dz = camPos.z - slit.z;
    const sAlong = dx * outX + dz * outZ;
    const sLat = Math.abs(-dx * outZ + dz * outX);
    const slitDist = Math.hypot(dx, dz);

    if (sAlong > (isExtended ? outerMouthAlong - 3.5 : -2)) sawExterior = true;
    const openDistCap = Math.max(32, Math.abs(emergenceAlong) + 12);
    if (!valleyOpened && sawExterior && sAlong < emergenceAlong && slitDist < openDistCap) {
      valleyOpened = true;
      emergenceClock = 0;
      onValleyOpen?.();
    }

    if (emergenceClock >= 0) {
      if (Number.isFinite(dt) && dt > 0) {
        emergenceClock += Math.min(dt, 0.1);
      }
      if (emergenceClock >= EMERGENCE_DUR) {
        emergenceClock = -1;
        emergenceEffect.active = false;
        emergenceEffect.progress = 1;
        emergenceEffect.fovDelta = 0;
        emergenceEffect.warmth = 0;
      } else {
        const p = clamp01(emergenceClock / EMERGENCE_DUR);
        // 豁然开朗呼吸视野：出洞后 0.9s 内柔和缓展 +2.6°，再悠缓回正，零眩晕
        const bell = Math.pow(Math.sin(p * Math.PI), 1.25);
        emergenceEffect.active = true;
        emergenceEffect.progress = p;
        emergenceEffect.fovDelta = bell * 2.6;
        emergenceEffect.warmth = (1 - p) * (1 - p);
      }
    }

    const sv = sky?.getAppearance?.() || sky;
    const timeId = sky?.timeId || sv?.timeId || 'day';
    const isNight = timeId === 'night' || (sv?.nightAmount ?? sv?.night ?? 0) > 0.65;

    const fadeFloor = isExtended ? outerMouthAlong - 9.0 : -4.2;
    const fadeAnchor = isExtended ? outerMouthAlong + 6.5 : 12;
    if (sAlong <= fadeFloor || sLat >= 26) {
      outerIntensity = 0;
    } else {
      const frontFade = clamp01((sAlong - fadeFloor) / 6.2);
      const farFade = clamp01(1 - Math.max(0, sAlong - fadeAnchor) / 36);
      const latFade = clamp01(1 - sLat / 24);
      const nightBoost = 1 + (sv?.nightAmount ?? 0) * 0.45;
      outerIntensity = clamp01(frontFade * farFade * latFade * nightBoost);
    }

    if (isExtended && sAlong > emergenceAlong - 6.5 && sAlong < -5.5 && sLat < 20) {
      const enterFade = smooth01((-5.5 - sAlong) / 7.5);
      const exitFade = smooth01((sAlong - (emergenceAlong - 6.5)) / 5.0);
      const innerLatFade = clamp01(1 - sLat / 20);
      innerIntensity = clamp01(enterFade * exitFade * innerLatFade);
    } else {
      innerIntensity = 0;
    }

    intensity = Math.max(outerIntensity, innerIntensity);
    group.visible = intensity > 0.004;

    if (group.visible) {
      const shaftTint = isNight ? TINT_NIGHT : (timeId === 'dusk' ? TINT_DUSK : TINT_DAY);
      const shaftMaxOp = isNight ? 0.34 : 0.58;
      const moteMaxOp = isNight ? 0.48 : 0.72;

      glowMat.color.copy(shaftTint);
      moteMat.color.copy(isNight ? MOTE_NIGHT : (timeId === 'dusk' ? MOTE_DUSK : MOTE_DAY));
      glowMesh.visible = outerIntensity > 0.004;
      motes.visible = outerIntensity > 0.004;
      glowMat.opacity = outerIntensity * shaftMaxOp;
      moteMat.opacity = outerIntensity * moteMaxOp;

      if (innerGlowMesh && innerGlowMat && innerMotes && innerMoteMat) {
        innerGlowMat.color.copy(shaftTint);
        innerMoteMat.color.copy(isNight ? MOTE_NIGHT : (timeId === 'dusk' ? MOTE_DUSK : MOTE_INNER_DAY));
        const showInner = innerIntensity > 0.004;
        innerGlowMesh.visible = showInner;
        innerMotes.visible = showInner;
        const innerShaftMaxOp = isNight ? 0.22 : 0.40;
        innerGlowMat.opacity = innerIntensity * innerShaftMaxOp;
        innerMoteMat.opacity = innerIntensity * moteMaxOp;
      }

      if (Number.isFinite(dt) && dt > 0) {
        const t = Number.isFinite(elapsed) ? elapsed : 0;
        if (glowMesh.visible) updateOuterMotes(t);
        if (innerMotes?.visible) updateInnerMotes(t);
      }
    } else {
      glowMat.opacity = 0;
      moteMat.opacity = 0;
      if (innerGlowMat) innerGlowMat.opacity = 0;
      if (innerMoteMat) innerMoteMat.opacity = 0;
    }
  }

  return {
    group,
    update,
    setSuppressed,
    reset,
    getEmergenceEffect: () => emergenceEffect,
    getStats: () => ({
      intensity,
      outerIntensity,
      innerIntensity,
      valleyOpened,
      emergenceActive: emergenceEffect.active,
      emergenceFovDelta: +emergenceEffect.fovDelta.toFixed(3),
      suppressed,
      triangles,
      degraded: false,
      disposed
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      glowGeo.dispose();
      glowMat.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      innerGlowGeo?.dispose();
      innerGlowMat?.dispose();
      innerMoteMat?.dispose();
      group.removeFromParent();
    }
  };
}
