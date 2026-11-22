import * as THREE from 'three';
import defaults from '../data/ink-grounding.json' with { type: 'json' };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = Number.isFinite;
const noopRaycast = () => {};
function number(value, fallback, lo, hi) { return finite(value) ? clamp(value, lo, hi) : fallback; }
function hashRaw(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}
function hashSupport(baseHash, supportIdx) {
  let h = Math.imul(baseHash ^ 58, 16777619) >>> 0;
  h = Math.imul(h ^ (48 + supportIdx), 16777619) >>> 0;
  return h / 4294967296;
}
function hash(text) {
  return hashRaw(text) / 4294967296;
}
function visible(owner) {
  for (let node = owner; node; node = node.parent) if (node.visible === false) return false;
  return true;
}

/** Exact world-space Y of the current PlaneGeometry triangles, not bilinear physics.
 * A caller with a locally planar support surface may provide ctx.sampleGround(x,z).
 * Arbitrary non-grid topology needs its own triangles; a height callback alone cannot promise interior conformity.
 * Inputs and field buffers are borrowed, never modified. null means no supported floor.
 */
export function sampleContactGround(field, x, z) {
  if (!field || !finite(x) || !finite(z)) return null;
  if (finite(field.half) && (Math.abs(x) > field.half || Math.abs(z) > field.half)) return null;
  if (field.heights && finite(field.step) && field.step > 0 && Number.isInteger(field.segments) && field.segments > 0) {
    const fx = (x + field.half) / field.step, fz = (z + field.half) / field.step;
    const ix = Math.min(field.segments - 1, Math.floor(fx)), iz = Math.min(field.segments - 1, Math.floor(fz)), stride = field.segments + 1;
    if (ix < 0 || iz < 0 || ix >= field.segments || iz >= field.segments) return null;
    const u = fx - ix, v = fz - iz, i = iz * stride + ix;
    const a = field.heights[i], b = field.heights[i + 1], c = field.heights[i + stride], d = field.heights[i + stride + 1];
    if (!finite(a) || !finite(b) || !finite(c) || !finite(d)) return null;
    return u + v <= 1 ? a * (1 - u - v) + b * u + c * v : d * (u + v - 1) + b * (1 - v) + c * (1 - u);
  }
  const y = field.sample?.(x, z);
  return finite(y) ? y : null;
}

/** Unit-ellipse alpha envelope used by the shader, useful in headless checks. */
export function inkContactFalloff(x, z) {
  const r2 = x * x + z * z;
  if (!finite(r2) || r2 >= 1) return 0;
  const t = clamp((r2 - 0.12) / 0.88, 0, 1);
  return Math.exp(-1.95 * r2) * (1 - t * t * (3 - 2 * t));
}

const VERT = /* glsl */`
attribute float inkWeight;
attribute float inkSeed;
attribute vec4 inkCorners;
uniform sampler2D uHeights;
uniform vec4 uField;
uniform float uUseHeights;
uniform float uGridAligned;
uniform float uGroundOffset;
varying vec2 vInkUv;
varying float vInkWeight;
varying float vInkSeed;
#include <common>
#include <fog_pars_vertex>
float sampleGroundTriangle(vec2 xz) {
  vec2 grid = (xz + uField.x) / uField.y;
  vec2 cell = clamp(floor(grid), vec2(0.0), vec2(uField.z - 1.0));
  vec2 f = clamp(grid - cell, vec2(0.0), vec2(1.0));
  vec2 uv = (cell + 0.5) / uField.w;
  float a = texture2D(uHeights, uv).r;
  float b = texture2D(uHeights, uv + vec2(1.0 / uField.w, 0.0)).r;
  float c = texture2D(uHeights, uv + vec2(0.0, 1.0 / uField.w)).r;
  float d = texture2D(uHeights, uv + vec2(1.0 / uField.w)).r;
  return f.x + f.y <= 1.0 ? a * (1.0 - f.x - f.y) + b * f.x + c * f.y :
    d * (f.x + f.y - 1.0) + b * (1.0 - f.y) + c * (1.0 - f.x);
}
void main() {
  vInkUv = position.xz;
  vInkWeight = inkWeight;
  vInkSeed = inkSeed;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  if (uGridAligned > 0.5) {
    // These are REAL terrain vertices, with the same cell diagonal as PlaneGeometry.
    // A moved or rotated ellipse only changes its fragment mask, never its supporting topology.
    vec4 root = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 grid = clamp(floor((root.xz + uField.x) / uField.y + 0.5) + position.xz, vec2(0.0), vec2(uField.z));
    world.xz = grid * uField.y - uField.x;
    world.y = texture2D(uHeights, (grid + 0.5) / uField.w).r + uGroundOffset;
    vec2 axisX = (modelMatrix * vec4(instanceMatrix[0].xyz, 0.0)).xz;
    vec2 axisZ = (modelMatrix * vec4(instanceMatrix[2].xyz, 0.0)).xz;
    vec2 delta = world.xz - root.xz;
    vInkUv = vec2(dot(delta, axisX) / max(dot(axisX, axisX), 1.0e-16), dot(delta, axisZ) / max(dot(axisZ, axisZ), 1.0e-16));
  } else {
    // Callback/sample fallback is for locally planar floors, not arbitrary terrain topology.
    vec2 p = position.xz * 0.5 + 0.5;
    float fallbackGround = mix(mix(inkCorners.x, inkCorners.y, p.x), mix(inkCorners.z, inkCorners.w, p.x), p.y);
    world.y = (uUseHeights > 0.5 ? sampleGroundTriangle(world.xz) : fallbackGround) + uGroundOffset;
  }
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */`
uniform vec3 uInk;
uniform float uStrength;
varying vec2 vInkUv;
varying float vInkWeight;
varying float vInkSeed;
#include <common>
#include <fog_pars_fragment>
void main() {
  float r2 = dot(vInkUv, vInkUv);
  if (r2 >= 1.0) discard; // Grid stencils extend beyond the mark: reject before exp/grain/fog work.
  // A diffuse contact core and feathered edge, not a filled dark circular stain.
  float edge = 1.0 - smoothstep(0.12, 1.0, r2);
  float softInk = exp(-1.95 * r2) * edge;
  float grain = 0.94 + 0.06 * sin(dot(vInkUv, vec2(31.7, 23.9)) + vInkSeed * 6.2831853);
  float alpha = softInk * grain * vInkWeight * uStrength;
  if (alpha < 0.001) discard;
  gl_FragColor = vec4(uInk, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * createContactShadows({ field, world?, camera?, sky?, config?,
 *   flora?:{spots:[[x,y,z]],group}, village?:{houseInfo:[{x,z,gy,w,d,rot}],group},
 *   people?:{list:[{x,z,yaw,s,poseReady}],group}, fauna?:{animals:[{x,y,z,yaw,kind,mode,lift,mesh}],group},
 *   homestead?:{group,getBuffaloState(),getInteractables?()},
 *   actors?:[{x,y,z,kind?,yaw?,scale?,visible?,owner?,flying?,submerged?}] | (()=>array),
 *   staticTargets?:[{x,z,y?,kind?,yaw?,owner?}], sampleGround?:(x,z)=>number|null,
 *   waterAt?:(x,z)=>number|null }) -> {group,update,getStats,dispose}.
 * All metadata is WORLD space; attach group to an untransformed scene root.
 * update(dt, elapsed, camera=ctx.camera, sky=ctx.sky): after actors AND portal visibility.
 * elapsed is intentionally unused. dt<=0 touches no source, matrix, uniform or statistic.
 * Generic actors supply FOOT Y (not camera eye/torso Y); optional owner handles ancestor visibility.
 * Current people's list has no foot Y: its renderer uses field.sample(x,z), so that adapter does too.
 * Numeric live yaw/rot permits paired feet; missing yaw (including facing-only qh/community metadata) uses one root ellipse.
 * A regular Heightfield uses true cell-aligned triangles. The small stencil is capped at 81 vertices; tiny cells shrink the mask, not the terrain mesh.
 */
export function createContactShadows(ctx = {}) {
  const field = ctx.field || ctx.terrain?.field;
  const cfg = { ...defaults, ...ctx.config };
  for (const key of Object.keys(defaults)) if (typeof defaults[key] === 'number') {
    cfg[key] = number(cfg[key], defaults[key], 0, key.includes('Targets') ? 16384 : key.includes('Instances') ? 1024 : 1000);
  }
  cfg.maxStaticInstances = Math.floor(cfg.maxStaticInstances);
  cfg.maxActorInstances = Math.floor(cfg.maxActorInstances);
  cfg.maxStaticTargets = Math.floor(cfg.maxStaticTargets);
  cfg.maxActorTargets = Math.floor(cfg.maxActorTargets);
  cfg.groundOffset = number(cfg.groundOffset, defaults.groundOffset, 0.005, 0.05);
  cfg.fadeStart = number(cfg.fadeStart, defaults.fadeStart, 0.1, 0.95);
  cfg.patchSegments = Math.floor(number(cfg.patchSegments, defaults.patchSegments, 1, 8));
  cfg.maxStencilRadiusCells = Math.floor(number(cfg.maxStencilRadiusCells, defaults.maxStencilRadiusCells, 1, 4));
  cfg.staticDistance = number(cfg.staticDistance, defaults.staticDistance, 1, 140);
  cfg.actorDistance = number(cfg.actorDistance, defaults.actorDistance, 1, 100);
  cfg.inkColor = typeof cfg.inkColor === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.inkColor) ? cfg.inkColor : defaults.inkColor;
  const floor = (x, z) => {
    if (typeof ctx.sampleGround === 'function') { const y = ctx.sampleGround(x, z); return finite(y) ? y : null; }
    return sampleContactGround(field, x, z);
  };
  const group = new THREE.Group(); group.name = 'ink-contact-shadows';
  let disposed = false, strength = 0, updates = 0, actorTargets = 0;
  const gridSize = (field?.segments || 0) + 1;
  const useGrid = !ctx.sampleGround && field?.heights && finite(field.step) && field.step > 0 &&
    finite(field.half) && Number.isInteger(field.segments) && field.segments > 0 && gridSize <= 1024 &&
    field.heights.length === gridSize * gridSize && field.heights.every(finite);
  // Configuration is immutable inside this owner: normalize radii once, not per support/frame.
  const radii = Object.create(null);
  for (const key of ['treeRadius', 'houseRadius', 'personRadius', 'personRootRadius', 'hoofRadius', 'animalRadius']) {
    const value = cfg[key];
    radii[key] = [number(value?.[0], defaults[key][0], 0.05, 1.15), number(value?.[1], defaults[key][1], 0.05, 1.15)];
  }
  const maxRadius = Math.max(...['tree', 'house', 'person', 'person-root', 'ox', 'animal'].map(kind => Math.hypot(...radius(kind)) * 1.35));
  const stencilRadius = useGrid ? Math.min(cfg.maxStencilRadiusCells, Math.max(1, Math.ceil(maxRadius / field.step + 0.5))) : 0;
  const patchSegments = useGrid ? stencilRadius * 2 : cfg.patchSegments;
  const heightData = useGrid ? Float32Array.from(field.heights) : new Float32Array([0]);
  const heights = new THREE.DataTexture(heightData, useGrid ? gridSize : 1, useGrid ? gridSize : 1, THREE.RedFormat, THREE.FloatType);
  heights.magFilter = heights.minFilter = THREE.NearestFilter; heights.generateMipmaps = false; heights.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: true, depthWrite: false,
    fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uHeights: { value: heights }, uField: { value: new THREE.Vector4(field?.half || 0, field?.step || 1, field?.segments || 1, useGrid ? gridSize : 1) },
      uUseHeights: { value: useGrid ? 1 : 0 }, uGridAligned: { value: useGrid ? 1 : 0 }, uGroundOffset: { value: cfg.groundOffset },
      uInk: { value: new THREE.Color(cfg.inkColor) }, uStrength: { value: 0 } }
  });
  function batch(name, max) {
    const capacity = Math.max(1, max);
    const size = useGrid ? stencilRadius * 2 : 2;
    const geometry = new THREE.PlaneGeometry(size, size, patchSegments, patchSegments); geometry.rotateX(-Math.PI / 2);
    geometry.userData.contactGroundTopology = useGrid ? 'terrain-cell-stencil' : 'local-planar-patch';
    geometry.setAttribute('inkWeight', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('inkSeed', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('inkCorners', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.raycast = noopRaycast; mesh.renderOrder = 1;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh); return mesh;
  }
  const staticBatch = batch('ink-contact-static', cfg.maxStaticInstances);
  const actorsBatch = batch('ink-contact-actors', cfg.maxActorInstances);
  const matrix = new THREE.Matrix4();
  const staticTargets = [], candidates = [], seenActors = new Set();
  const corners = new Float64Array(4);
  const cornerDirections = [-1, -1, 1, -1, -1, 1, 1, 1];
  const houseSupports = [-1, -1, 1, -1, -1, 1, 1, 1, 0, -1, 0, 1, -1, 0, 1, 0];
  const personSupports = [-.11, .02, .11, .02];
  const hoofSupports = [-.30, -.52, .30, -.52, -.30, .52, .30, .52, 0, 0];
  const rootSupport = [0, 0];
  const sortCandidates = (a, b) => (a.kind === 'house' ? 0 : 1) - (b.kind === 'house' ? 0 : 1) || a.distance - b.distance || a.i - b.i;
  const labelHashCache = new Map();
  const baseHashOf = (label) => {
    let h = labelHashCache.get(label);
    if (h === undefined) {
      h = hashRaw(label);
      labelHashCache.set(label, h);
    }
    return h;
  };
  const register = (data, kind, owner, label) => {
    if (!data || staticTargets.length >= cfg.maxStaticTargets) return;
    staticTargets.push({ source: data, data: Array.isArray(data) ? { x: data[0], y: data[1], z: data[2] } : data, kind, owner, label, baseHash: hashRaw(label), i: staticTargets.length, distance: 0 });
  };
  // Houses first so dense peach groves cannot exhaust registration before architecture.
  for (const [i, h] of (ctx.village?.houseInfo || []).entries()) {
    if (staticTargets.length >= cfg.maxStaticTargets) break;
    register(h, 'house', ctx.village.group, 'house-' + i);
  }
  for (const [i, p] of (ctx.flora?.spots || []).entries()) {
    if (staticTargets.length >= cfg.maxStaticTargets) break;
    register(p, 'tree', ctx.flora.group, 'tree-' + i);
  }
  for (const [i, t] of (ctx.staticTargets || []).entries()) {
    if (staticTargets.length >= cfg.maxStaticTargets) break;
    register(t, t.kind || 'tree', t.owner, t.id || 'static-' + i);
  }
  const STATIC_CELL = 16;
  const staticGrid = new Map();
  const staticUnbound = [];
  const staticOwners = [];
  const staticOwnerSet = new Set();
  const useStaticCache = staticTargets.length > 32;
  if (useStaticCache) {
    for (let i = 0; i < staticTargets.length; i++) {
      const target = staticTargets[i], data = target.data;
      if (target.owner && !staticOwnerSet.has(target.owner)) {
        staticOwnerSet.add(target.owner);
        staticOwners.push(target.owner);
      }
      if (data.owner && !staticOwnerSet.has(data.owner)) {
        staticOwnerSet.add(data.owner);
        staticOwners.push(data.owner);
      }
      if (data.mesh && !staticOwnerSet.has(data.mesh)) {
        staticOwnerSet.add(data.mesh);
        staticOwners.push(data.mesh);
      }
      if (finite(data.x) && finite(data.z)) {
        const gx = Math.floor(data.x / STATIC_CELL);
        const gz = Math.floor(data.z / STATIC_CELL);
        const key = (gx + 32768) * 65536 + (gz + 32768);
        let bucket = staticGrid.get(key);
        if (!bucket) { bucket = []; staticGrid.set(key, bucket); }
        bucket.push(target);
      } else {
        staticUnbound.push(target);
      }
    }
  }
  let lastStaticCamX = NaN, lastStaticCamZ = NaN, lastStaticEnabled = null;
  const lastOwnerVis = staticOwners.map(() => null);
  const waterAt = (x, z) => {
    if (ctx.waterAt) { const y = ctx.waterAt(x, z); return finite(y) ? y : -Infinity; }
    const terrain = ctx.world?.terrain, pond = terrain?.pond;
    const pondY = pond && Math.hypot(x - pond.x, z - pond.z) < (pond.radius ?? pond.waterRadius ?? 0) + 0.15 ? pond.waterY : -Infinity;
    return Math.max(finite(terrain?.waterLevel) ? terrain.waterLevel : -Infinity, finite(pondY) ? pondY : -Infinity);
  };
  const wet = (x, z, y) => y <= waterAt(x, z) + cfg.waterClearance;
  function radius(kind) {
    const key = kind === 'tree' ? 'treeRadius' : kind === 'house' ? 'houseRadius' : kind === 'person' ? 'personRadius' : kind === 'person-root' ? 'personRootRadius' : kind === 'buffalo' || kind === 'ox' ? 'hoofRadius' : 'animalRadius';
    return radii[key];
  }
  function eligible(data, owner, allowMissingY = false) {
    if (!data || !finite(data.x) || !finite(data.z) || data.visible === false || data.hidden || data.flying || data.submerged || data.poseReady === false) return null;
    if (data.kind === 'bird' && data.mode === 'flush') return null; // Actual fauna flight state includes low-lift takeoff/landing.
    if (typeof data.visible === 'function' && !data.visible()) return null;
    if (!visible(owner) || !visible(data.owner) || !visible(data.mesh)) return null;
    const ground = floor(data.x, data.z);
    if (ground === null || wet(data.x, data.z, ground)) return null;
    const y = data.y ?? data.gy ?? (allowMissingY ? (field?.sample?.(data.x, data.z) ?? ground) : ground);
    if (!finite(y) || !finite(data.lift ?? 0) || Math.abs(y + (data.lift || 0) - ground) > cfg.maxGroundGap) return null;
    return ground;
  }
  function patch(mesh, capacity, data, kind, cx, cz, yaw, scale, opacity, seedVal, cameraPosition, distance) {
    if (mesh.count >= capacity) return;
    const dy = floor(cx, cz);
    if (dy === null || wet(cx, cz, dy)) return;
    const dist = Math.hypot(cx - cameraPosition.x, cz - cameraPosition.z);
    if (dist >= distance) return;
    const [rx0, rz0] = radius(kind);
    // Nearest-grid origin is at most half a cell from the support. Keep every rotated mask inside the bounded stencil.
    const fit = useGrid ? Math.min(1, (stencilRadius - 0.5) * field.step / (Math.hypot(rx0, rz0) * scale)) : 1;
    const rx = rx0 * scale * fit, rz = rz0 * scale * fit;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let j = 0; j < 4; j++) {
      const u = cornerDirections[j * 2], v = cornerDirections[j * 2 + 1];
      const x = cx + c * rx * u + s * rz * v, z = cz - s * rx * u + c * rz * v;
      const h = floor(x, z);
      if (h === null || wet(x, z, h)) return;
      corners[j] = h;
    }
    const i = mesh.count++;
    matrix.set(c * rx, 0, s * rz, cx, 0, 1, 0, dy + cfg.groundOffset, -s * rx, 0, c * rz, cz, 0, 0, 0, 1);
    mesh.setMatrixAt(i, matrix);
    const fade = 1 - clamp((dist / distance - cfg.fadeStart) / (1 - cfg.fadeStart), 0, 1);
    mesh.geometry.attributes.inkWeight.setX(i, clamp(opacity, 0, 0.4) * fade);
    mesh.geometry.attributes.inkSeed.setX(i, seedVal);
    mesh.geometry.attributes.inkCorners.setXYZW(i, corners[0], corners[1], corners[2], corners[3]);
  }
  function supports(mesh, capacity, data, kind, baseHash, cameraPosition, distance) {
    const heading = finite(data.yaw) ? data.yaw : finite(data.rot) ? data.rot : null;
    const yaw = number(heading, 0, -1e6, 1e6);
    const scale = number(data.s ?? data.scale, 1, 0.35, 1.8);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let points = rootSupport, sx = 1, sz = 1;
    if (kind === 'house') {
      if (!finite(data.w) || !finite(data.d) || data.w <= 0 || data.d <= 0) return;
      points = houseSupports; sx = data.w * .44; sz = data.d * .44;
    } else if (kind === 'person' && heading !== null) { points = personSupports; sx = sz = scale; }
    else if ((kind === 'ox' || kind === 'buffalo') && heading !== null) { points = hoofSupports; sx = sz = scale; }
    const opacity = kind === 'tree' ? cfg.treeOpacity : kind === 'house' ? cfg.houseOpacity : cfg.actorOpacity;
    for (let i = 0; i < points.length / 2; i++) {
      const x = points[i * 2] * sx, z = points[i * 2 + 1] * sz;
      const markKind = kind === 'person' && heading === null ? 'person-root' : kind;
      patch(mesh, capacity, data, markKind, data.x + c * x + s * z, data.z - s * x + c * z, yaw, scale, opacity, hashSupport(baseHash, i), cameraPosition, distance);
    }
  }
  function upload(mesh) {
    mesh.visible = mesh.count > 0 && strength > 0 && cfg.enabled !== false;
    mesh.instanceMatrix.needsUpdate = true;
    for (const key of ['inkWeight', 'inkSeed', 'inkCorners']) mesh.geometry.attributes[key].needsUpdate = true;
  }
  function update(dt, elapsed, camera = ctx.camera, sky = ctx.sky) {
    if (disposed || !finite(dt) || dt <= 0) return;
    const cameraPosition = camera?.position || camera || { x: 0, z: 0 };
    if (!finite(cameraPosition.x) || !finite(cameraPosition.z)) return;
    updates++;
    const time = sky?.timeId || 'day';
    const base = time === 'night' ? cfg.nightStrength : time === 'dusk' ? cfg.duskStrength : time === 'dawn' ? cfg.dawnStrength : cfg.dayStrength;
    strength = clamp(base, 0, 1) * (1 - clamp(sky?.rainIntensity || 0, 0, 1) * clamp(cfg.rainAttenuation, 0, 1));
    material.uniforms.uStrength.value = strength;

    const enabled = cfg.enabled !== false;
    let rebuildStatic = !useStaticCache || !finite(lastStaticCamX) || !finite(lastStaticCamZ) || lastStaticEnabled !== enabled;
    if (!rebuildStatic) {
      const cdx = cameraPosition.x - lastStaticCamX;
      const cdz = cameraPosition.z - lastStaticCamZ;
      if (cdx * cdx + cdz * cdz > 0.0625) rebuildStatic = true;
      else {
        for (let i = 0; i < staticOwners.length; i++) {
          if (visible(staticOwners[i]) !== lastOwnerVis[i]) { rebuildStatic = true; break; }
        }
      }
    }

    if (rebuildStatic) {
      staticBatch.count = 0;
      candidates.length = 0;
      if (useStaticCache) {
        lastStaticCamX = cameraPosition.x;
        lastStaticCamZ = cameraPosition.z;
        lastStaticEnabled = enabled;
        for (let i = 0; i < staticOwners.length; i++) lastOwnerVis[i] = visible(staticOwners[i]);
        if (enabled) {
          const maxR = cfg.staticDistance + 10;
          const gx0 = Math.floor((cameraPosition.x - maxR) / STATIC_CELL);
          const gx1 = Math.floor((cameraPosition.x + maxR) / STATIC_CELL);
          const gz0 = Math.floor((cameraPosition.z - maxR) / STATIC_CELL);
          const gz1 = Math.floor((cameraPosition.z + maxR) / STATIC_CELL);
          for (let gx = gx0; gx <= gx1; gx++) {
            for (let gz = gz0; gz <= gz1; gz++) {
              const bucket = staticGrid.get((gx + 32768) * 65536 + (gz + 32768));
              if (!bucket) continue;
              for (let k = 0; k < bucket.length; k++) {
                const target = bucket[k], data = target.data;
                target.distance = Math.hypot(data.x - cameraPosition.x, data.z - cameraPosition.z);
                if (target.distance >= maxR || eligible(data, target.owner) === null) continue;
                candidates.push(target);
              }
            }
          }
          for (let i = 0; i < staticUnbound.length; i++) {
            const target = staticUnbound[i], data = target.data;
            if (Array.isArray(target.source)) {
              data.x = target.source[0]; data.y = target.source[1]; data.z = target.source[2];
            }
            target.distance = Math.hypot(data.x - cameraPosition.x, data.z - cameraPosition.z);
            if (target.distance >= maxR || eligible(data, target.owner) === null) continue;
            candidates.push(target);
          }
          candidates.sort(sortCandidates);
          for (let i = 0; i < candidates.length; i++) {
            const target = candidates[i];
            if (staticBatch.count >= cfg.maxStaticInstances) break;
            supports(staticBatch, cfg.maxStaticInstances, target.data, target.kind, target.baseHash, cameraPosition, cfg.staticDistance);
          }
        }
      } else if (enabled) {
        for (let i = 0; i < staticTargets.length; i++) {
          const target = staticTargets[i], data = target.data;
          if (Array.isArray(target.source)) {
            data.x = target.source[0]; data.y = target.source[1]; data.z = target.source[2];
          }
          target.distance = Math.hypot(data.x - cameraPosition.x, data.z - cameraPosition.z);
          if (target.distance >= cfg.staticDistance + 10 || eligible(data, target.owner) === null) continue;
          candidates.push(target);
        }
        candidates.sort(sortCandidates);
        for (const target of candidates) {
          const data = target.data;
          if (staticBatch.count >= cfg.maxStaticInstances) break;
          supports(staticBatch, cfg.maxStaticInstances, data, target.kind, target.baseHash, cameraPosition, cfg.staticDistance);
        }
      }
      upload(staticBatch);
    } else {
      staticBatch.visible = staticBatch.count > 0 && strength > 0 && enabled;
    }

    actorsBatch.count = 0; actorTargets = 0; seenActors.clear();
    if (enabled) {
      const addActor = (data, kind, owner, label, missingY = false) => {
        if (actorTargets >= cfg.maxActorTargets) return;
        actorTargets++;
        if (!data) return;
        const key = typeof data.id === 'string' && data.id ? data.id : data;
        if (seenActors.has(key)) return;
        seenActors.add(key);
        // Preserve edge-crossing feet/hooves: their largest root offset is <2m at max scale.
        // Houses have arbitrary support dimensions and cannot use this actor broad phase.
        if (kind !== 'house' && Math.hypot(data.x - cameraPosition.x, data.z - cameraPosition.z) >= cfg.actorDistance + 2) return;
        if (eligible(data, owner, missingY) === null) return;
        supports(actorsBatch, cfg.maxActorInstances, data, kind, baseHashOf(label), cameraPosition, cfg.actorDistance);
      };
      for (let i = 0; i < (ctx.people?.list?.length || 0) && actorTargets < cfg.maxActorTargets; i++) addActor(ctx.people.list[i], 'person', ctx.people.group, 'person-' + i, true);
      for (let i = 0; i < (ctx.fauna?.animals?.length || 0) && actorTargets < cfg.maxActorTargets; i++) { const a = ctx.fauna.animals[i]; addActor(a, a.kind || 'animal', ctx.fauna.group, 'fauna-' + i); }
      if (actorTargets < cfg.maxActorTargets && ctx.homestead?.getBuffaloState) addActor(ctx.homestead.getBuffaloState(), 'buffalo', ctx.homestead.group, 'buffalo');
      if (actorTargets < cfg.maxActorTargets && ctx.homestead?.getInteractables) {
        const list = ctx.homestead.getInteractables();
        for (let i = 0; i < list.length && actorTargets < cfg.maxActorTargets; i++) addActor(list[i], 'person', ctx.homestead.group, 'homestead-' + i, true);
      }
      const list = typeof ctx.actors === 'function' ? ctx.actors() : ctx.actors || [];
      for (let i = 0; i < list.length && actorTargets < cfg.maxActorTargets; i++) addActor(list[i], list[i]?.kind || 'person', list[i]?.owner, list[i]?.id || 'actor-' + i, list[i]?.y === undefined);
    }
    upload(actorsBatch);
  }
  function getStats() {
    const staticInstances = disposed ? 0 : staticBatch.count, actorInstances = disposed ? 0 : actorsBatch.count;
    return { disposed, enabled: cfg.enabled !== false, staticTargets: staticTargets.length, actorTargets, staticInstances, actorInstances,
      maxStaticInstances: cfg.maxStaticInstances, maxActorInstances: cfg.maxActorInstances,
      drawCalls: disposed ? 0 : Number(staticBatch.visible) + Number(actorsBatch.visible),
      triangles: (staticInstances + actorInstances) * patchSegments * patchSegments * 2,
      patchTriangles: patchSegments * patchSegments * 2, terrainStencilRadiusCells: stencilRadius, alignedToTerrainGrid: !!useGrid,
      strength, updates, visualGround: useGrid ? 'terrain-triangles' : ctx.sampleGround ? 'callback' : 'sample',
      statistics: 'nominal batches and submitted triangles, not renderer measurements' };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const mesh of [staticBatch, actorsBatch]) { mesh.count = 0; mesh.visible = false; mesh.dispose(); mesh.geometry.dispose(); }
    material.dispose(); heights.dispose(); group.clear(); group.removeFromParent();
    candidates.length = 0; seenActors.clear();
    staticGrid.clear(); staticUnbound.length = 0; labelHashCache.clear();
  }
  return { group, update, getStats, dispose };
}
