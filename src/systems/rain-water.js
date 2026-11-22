import * as THREE from 'three';
import inkWater from '../data/ink-water.json' with { type: 'json' };

const finite = Number.isFinite;
function generator(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function visible(object) {
  if (!object) return false;
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
function rainMaterial(color, opacity, concentric = false) {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  material.toneMapped = false;
  // Flat upward-facing rain quads: one pass keeps renderer.info calls honest and halves submission.
  material.forceSinglePass = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float inkRainAlpha;\nvarying float vInkRainAlpha;\nvarying vec2 vInkRainPos;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInkRainAlpha = inkRainAlpha;\nvInkRainPos = position.xz;');
    const ringProfile = concentric
      ? '\nfloat inkRingR = length(vInkRainPos);\nfloat inkOuter = exp(-48.0 * (inkRingR - 0.90) * (inkRingR - 0.90));\nfloat inkInner = 0.68 * exp(-56.0 * (inkRingR - 0.56) * (inkRingR - 0.56));\ndiffuseColor.a *= clamp(inkOuter + inkInner, 0.0, 1.0);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.99, 0.97), inkOuter * 0.42);'
      : '';
    shader.fragmentShader = 'varying float vInkRainAlpha;\nvarying vec2 vInkRainPos;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInkRainAlpha;' + ringProfile);
  };
  material.customProgramCacheKey = () => concentric ? 'ink-rain-concentric-v2' : 'ink-rain-alpha-v1';
  return material;
}
function makeBatch(name, geometry, material, capacity) {
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  alpha.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('inkRainAlpha', alpha);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false; // Individual sources/instances are culled before upload.
  mesh.renderOrder = 6;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.skyIgnore = true;
  return mesh;
}
function inTriangle(x, z, a, b, c) {
  const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(den) < 1e-9) return false;
  const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den;
  const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
  return u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001;
}

// Only effects owned here are disposed. Legacy roof curtains and sounds remain untouched.
export function createRainWater(ctx = {}) {
  const cfg = { ...inkWater.rain, ...(ctx.config?.rain || {}) };
  const maxRings = Math.max(0, Math.min(96, Math.floor(cfg.maxRings)));
  const maxEaves = Math.max(0, Math.min(48, Math.floor(cfg.maxEaves)));
  const group = new THREE.Group();
  group.name = 'ink-rain-water';
  group.userData.dynamic = true;
  const rand = generator(cfg.seed);
  const sources = [];
  const stream = ctx.stream;
  const pondMesh = ctx.pondMesh || ctx.village?.group?.getObjectByName('pond');
  const legacy = ctx.legacyEaves || ctx.qinHanCompletion?.group;
  const reusedEaves = Boolean(legacy?.getObjectByName('qin-han-rain-curtain'));
  const shelters = ctx.shelters || ctx.qinHanCompletion?.shelters || [];
  const field = ctx.field;
  const temp = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  function addSource(mesh, kind) {
    if (!mesh?.geometry?.attributes?.position) return;
    mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const points = [];
    for (let i = 0; i < positions.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
    const triangles = Math.floor((index ? index.count : points.length) / 3);
    // Weld only XZ positions: non-indexed fan/shape seams must not become fake shores.
    // A full disk inside the triangle union cannot cross any unpaired boundary edge,
    // including concave banks or island holes. This certificate is built once.
    const ids = new Map(), edges = new Map();
    const pointIds = points.map(p => {
      const key = Math.round(p.x * 1e6) + ',' + Math.round(p.z * 1e6);
      if (!ids.has(key)) ids.set(key, ids.size);
      return ids.get(key);
    });
    for (let n = 0; n < triangles * 3; n += 3) {
      const face = [0,1,2].map(k => index ? index.getX(n+k) : n+k);
      for (let k = 0; k < 3; k++) {
        const i = face[k], j = face[(k+1)%3], u = pointIds[i], v = pointIds[j];
        if (u === v) continue;
        const key = u < v ? u + ':' + v : v + ':' + u;
        const edge = edges.get(key);
        if (edge) edge.count++;
        else edges.set(key, { a:points[i], b:points[j], count:1 });
      }
    }
    const boundary = Array.from(edges.values()).filter(edge => edge.count !== 2);
    sources.push({ mesh, kind, points, index, triangles, boundary });
  }
  addSource(stream?.mesh, 'stream');
  addSource(pondMesh, 'pond');
  function contains(source, x, z, row) {
    if (source.kind === 'stream') {
      for (let k = Math.max(0, row - 1); k <= Math.min(source.points.length / 2 - 2, row + 1); k++) {
        const n = k * 2, p = source.points;
        if (inTriangle(x, z, p[n], p[n + 1], p[n + 2]) || inTriangle(x, z, p[n + 1], p[n + 2], p[n + 3])) return true;
      }
      return false;
    }
    const ix = source.index, p = source.points;
    for (let n = 0; n < source.triangles * 3; n += 3) {
      if (inTriangle(x, z, p[ix ? ix.getX(n) : n], p[ix ? ix.getX(n + 1) : n + 1], p[ix ? ix.getX(n + 2) : n + 2])) return true;
    }
    return false;
  }
  function containsDisk(source, x, z, row) {
    if (!source.boundary.length || !contains(source, x, z, row)) return false;
    // Reserve the largest future ring, not just its current phase or four axes.
    // A small float32 margin keeps rendered vertices strictly inside the real mesh.
    const clearance2 = (cfg.ringRadius + 0.001) ** 2;
    for (const {a,b} of source.boundary) {
      const dx = b.x-a.x, dz = b.z-a.z, length2 = dx*dx+dz*dz;
      const t = length2 ? Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/length2)) : 0;
      const ex = x-a.x-dx*t, ez = z-a.z-dz*t;
      if (ex*ex+ez*ez < clearance2) return false;
    }
    return true;
  }
  function wet(x, z, y) {
    const ground = field?.sample?.(x, z);
    return finite(ground) && ground < y - 0.025;
  }
  const candidates = [];
  const candidateCap = maxRings * 3;
  for (let attempt = 0; sources.length && attempt < candidateCap * 8 && candidates.length < candidateCap; attempt++) {
    const source = sources[attempt % sources.length];
    let t = 0, row = 0;
    if (source.kind === 'stream') {
      const rows = source.points.length / 2 - 1;
      if (rows < 1) continue;
      row = Math.floor(rand() * rows);
      const along = 0.1 + rand() * 0.8, across = 0.18 + rand() * 0.64;
      a.copy(source.points[row * 2]).lerp(source.points[row * 2 + 1], across);
      b.copy(source.points[row * 2 + 2]).lerp(source.points[row * 2 + 3], across);
      temp.copy(a).lerp(b, along);
      t = (row + along) / rows;
    } else {
      const n = Math.floor(rand() * source.triangles) * 3, ix = source.index;
      a.copy(source.points[ix ? ix.getX(n) : n]);
      b.copy(source.points[ix ? ix.getX(n + 1) : n + 1]);
      c.copy(source.points[ix ? ix.getX(n + 2) : n + 2]);
      const u = Math.sqrt(rand()), v = rand();
      temp.copy(a).multiplyScalar(1 - u).addScaledVector(b, u * (1 - v)).addScaledVector(c, u * v);
    }
    if (!wet(temp.x, temp.z, temp.y)) continue;
    let safe = containsDisk(source, temp.x, temp.z, row);
    for (const [dx, dz] of [[cfg.ringRadius, 0], [-cfg.ringRadius, 0], [0, cfg.ringRadius], [0, -cfg.ringRadius]]) {
      if (!wet(temp.x + dx, temp.z + dz, temp.y)) safe = false;
    }
    if (safe) candidates.push({ source, x: temp.x, y: temp.y, z: temp.z, t, phase: rand(), speed: 0.8 + rand() * 0.4 });
  }
  const rings = makeBatch('ink-rain-rings', new THREE.RingGeometry(0.42, 1, 20).rotateX(-Math.PI / 2), rainMaterial('#DCEBE5', cfg.opacity, true), Math.max(1, maxRings));
  group.add(rings);
  const drops = [];
  if (!reusedEaves) for (const shelter of shelters) {
    if (![shelter.x, shelter.z, shelter.rx, shelter.rz, shelter.eaveY].every(finite)) continue;
    const angle = finite(shelter.rot) ? shelter.rot : 0;
    const co = Math.cos(angle), si = Math.sin(angle);
    for (let i = 0; i < 8 && drops.length < maxEaves; i++) {
      const f = -0.85 + (i % 4) * (1.7 / 3), side = i < 4 ? 1 : -1;
      const x = f * shelter.rx, z = side * shelter.rz;
      drops.push({ x: shelter.x + x * co + z * si, z: shelter.z - x * si + z * co, y: shelter.eaveY, phase: rand() });
    }
  }
  const eaves = drops.length ? makeBatch('ink-eave-streaks', new THREE.PlaneGeometry(1, 1), rainMaterial('#B1C4BE', cfg.eaveOpacity), Math.max(1, maxEaves)) : null;
  if (eaves) group.add(eaves);
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  const identity = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 0.5);
  const rainRingColor = new THREE.Color('#DCEBE5');
  const snowRingColor = new THREE.Color('#EDF3F5');
  let disposed = false, time = 0, ringCount = 0, eaveCount = 0, snowRingMode = false;
  function near(point, camera, useFrustum) {
    if (camera?.position && camera.position.distanceToSquared(point) > cfg.maxDistance * cfg.maxDistance) return false;
    sphere.center.copy(point);
    return !useFrustum || frustum.intersectsSphere(sphere);
  }
  function upload(mesh, count) {
    if (!mesh) return;
    mesh.count = count; mesh.visible = count > 0;
    if (count) { mesh.instanceMatrix.needsUpdate = true; mesh.geometry.attributes.inkRainAlpha.needsUpdate = true; }
  }
  function update(dt, elapsed = 0, sky = ctx.sky, camera = ctx.camera) {
    const doc = ctx.doc || (typeof document !== 'undefined' ? document : null);
    if (disposed || !finite(dt) || dt <= 0 || doc?.hidden || doc?.hasFocus?.() === false) return;
    time = (time + Math.min(dt, 0.1)) % 4096;
    const rain = Math.max(0, Math.min(1, finite(sky?.rainIntensity) ? sky.rainIntensity : 0));
    const snow = Math.max(0, Math.min(1, finite(sky?.snowIntensity) ? sky.snowIntensity : 0));
    ringCount = 0; eaveCount = 0;
    const isSnowOnly = rain < cfg.threshold && snow >= cfg.threshold;
    snowRingMode = isSnowOnly;
    if (rain < cfg.threshold && !isSnowOnly) { upload(rings, 0); upload(eaves, 0); return; }
    rings.material.color.copy(isSnowOnly ? snowRingColor : rainRingColor);
    const useFrustum = Boolean(camera?.isCamera);
    if (useFrustum) { camera.updateMatrixWorld(); projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection); }
    const drive = isSnowOnly ? snow : rain;
    const maxActiveRings = isSnowOnly
      ? Math.max(0, Math.min(maxRings, Math.ceil(maxRings * snow * 0.62)))
      : Math.max(0, Math.min(maxRings, Math.ceil(maxRings * rain)));
    const limit = Math.ceil(candidates.length * Math.min(1, 0.38 + 0.62 * drive));
    const speedScale = isSnowOnly ? 0.44 : 1.0;
    const alphaScale = isSnowOnly ? 0.56 : 1.0;
    for (let i = 0; i < limit && ringCount < maxActiveRings; i++) {
      const candidate = candidates[i];
      if (!visible(candidate.source.mesh)) continue;
      const y = candidate.source.kind === 'stream' ? stream.surfaceY(candidate.t, finite(elapsed) ? elapsed : 0) : candidate.y;
      if (!wet(candidate.x, candidate.z, y) ||
          !wet(candidate.x + cfg.ringRadius, candidate.z, y) ||
          !wet(candidate.x - cfg.ringRadius, candidate.z, y) ||
          !wet(candidate.x, candidate.z + cfg.ringRadius, y) ||
          !wet(candidate.x, candidate.z - cfg.ringRadius, y)) continue;
      temp.set(candidate.x, y + cfg.surfaceOffset, candidate.z);
      if (!near(temp, camera, useFrustum)) continue;
      const phase = (candidate.phase + time * candidate.speed * speedScale / cfg.ringLifetime) % 1;
      const radius = isSnowOnly
        ? cfg.ringRadius * (0.14 + phase * 0.58)
        : cfg.ringRadius * (0.18 + phase * 0.82);
      scale.set(radius, 1, radius); matrix.compose(temp, identity, scale);
      rings.setMatrixAt(ringCount, matrix);
      rings.geometry.attributes.inkRainAlpha.setX(ringCount++, Math.sin(phase * Math.PI) * drive * alphaScale);
    }
    if (eaves && rain >= cfg.threshold) for (let i = 0; i < Math.ceil(drops.length * rain); i++) {
      const drop = drops[i], ground = field?.sample?.(drop.x, drop.z);
      if (!finite(ground) || ground >= drop.y - 0.1) continue;
      const phase = (drop.phase + time * 1.8) % 1;
      const span = drop.y - ground - cfg.eaveLength;
      temp.set(drop.x, drop.y - cfg.eaveLength * 0.5 - Math.max(0, span) * phase, drop.z);
      if (!near(temp, camera, useFrustum)) continue;
      const yaw = camera?.position ? Math.atan2(camera.position.x - temp.x, camera.position.z - temp.z) : 0;
      quaternion.setFromAxisAngle(up, yaw); scale.set(0.018, cfg.eaveLength, 1); matrix.compose(temp, quaternion, scale);
      eaves.setMatrixAt(eaveCount, matrix);
      eaves.geometry.attributes.inkRainAlpha.setX(eaveCount++, rain * Math.sin(phase * Math.PI));
    }
    upload(rings, ringCount); upload(eaves, eaveCount);
  }
  function getStats() {
    return { disposed, clock: time, candidates: candidates.length, rings: ringCount, eaves: eaveCount,
      snowRings: snowRingMode ? ringCount : 0,
      instances: ringCount + eaveCount, maxInstances: maxRings + (eaves ? maxEaves : 0),
      drawCalls: Number(ringCount > 0) + Number(eaveCount > 0), reusedEaves };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ringCount = 0; eaveCount = 0;
    for (const mesh of [rings, eaves]) if (mesh) { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); group.remove(mesh); }
    group.removeFromParent();
  }
  return { group, update, getStats, dispose };
}
