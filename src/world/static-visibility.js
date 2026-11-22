import * as THREE from 'three';
import { isSkyAppearanceMaterial } from '../systems/scene-appearance.js';

const STATIC_ROOTS = new Set(['flora', 'scatter', 'village', 'hinterland', 'cliff', 'fallen-petals', 'exterior-exploration', 'habitat-details', 'pond-life', 'waterworks', 'leisure-grove', 'valley-borderlands', 'qianmo-paths', 'outer-wilds', 'deep-hollows']);
const managedSources = new WeakSet();
// Only audited, fully baked, opaque single-material batches; never arbitrary meshes.
const STATIC_MESH_NAME = /^(terrain|ground-patch|village-props|village-scenes-(solid|botanical|ground)|village-life-(solid|botanical|ground)|exterior-exploration-(solid|botanical|ground)|habitat-details-(solid|botanical|ground)|pond-life-(surface|underwater|shore)|waterworks-(static|water|stone-v-weir|mortar-grain|axle-frames)|leisure-grove-(solid|foliage)|valley-borderlands-(solid|ground|water)|qianmo-paths-(ground|solid)|qin-han-completion-static|outer-wilds-static|outer-wilds-exterior-static|deep-hollows-static|wuling-outskirts-(ext|int)-foliage)$/;
const DYNAMIC_NAME = /^(people|person|fauna|fish|boats?|petals|rain|interaction|mysteries|player)(-|$)/;

/**
 * Conservative per-instance frustum compaction, not distance/occlusion/LOD culling.
 * Construct after static world creation, then replace renderer.render(scene,camera)
 * with visibility.render(renderer,camera). update(camera) only computes buffers;
 * it does NOT change normal scene rendering. dispose() removes all owned proxies.
 *
 * Originals retain matrices, colors, count and instance IDs, including raycasts.
 * One identity-child proxy replaces each eligible source draw ONLY inside render;
 * finally restores source materials even if rendering throws. Proxies never raycast.
 * Geometry/materials are shared (weather tint/uniform changes remain live).
 * Audited terrain/props/scenes/life single-material baked meshes also use one
 * owned compact index proxy per source. Every triangle is assigned once to a
 * fixed XZ page; culling uses the full transformed union bounds of its vertices,
 * never centroids or cuts. All vertex attributes stay shared, originals untouched.
 *
 * options.roots: audited static Object3D roots (default: known static world roots).
 * options.exclude: objects/subtrees that must never be optimized (e.g. targets).
 * options.cellSize: local XZ page width for audited baked meshes (default 24).
 * Baked meshes with groups, partial ranges or custom vertex shaders are skipped.
 * options.include(mesh): additional filter, never overrides safety exclusions.
 * options.allowShader(mesh): explicit audit assertion that a custom vertex shader
 * stays inside the geometry box union local origin and does not use gl_InstanceID.
 * Reeds wind, skinning, morphs, custom instance attributes, transparent blending,
 * custom render callbacks and shadow casters are skipped. Do not opt dynamic roots
 * into this helper. Geometry/instance edits must set their attribute.needsUpdate;
 * topology/capacity changes require dispose() and recreation. No render-time world
 * mutation or nested rendering; unsupported cameras safely use original rendering.
 *
 * Storage O(instances + baked triangle indices), <=6 tests per instance/page; no per-frame
 * arrays/objects in this helper after initial bounds setup. GPU upload only when
 * selection/source data changes. Stats count all managed candidates, not actual
 * renderer.info submissions (original visibility/layers/whole-source frustum gates
 * still apply). CPU upload/copy cost trades against reduced vertex processing.
 */
export function optimizeStaticVisibility(scene, options = {}) {
  const roots = options.roots ? new Set(options.roots) : null;
  const extraRoots = options.extraRoots ? new Set(options.extraRoots) : null;
  const excluded = new Set(options.exclude || []);
  const margin = options.margin ?? 0.0001;
  const cellSize = options.cellSize ?? 24;
  const getMaxDistance = typeof options.getMaxDistance === 'function' ? options.getMaxDistance : null;
  const getLod = typeof options.getLod === 'function' ? options.getLod : null;
  const cliffPortal = options.cliffPortal || null;
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Visibility cell size must be finite and positive');
  if (!Number.isFinite(margin) || margin < 0) throw new RangeError('Visibility margin must be finite and nonnegative');
  let cullCamX = 0, cullCamY = 0, cullCamZ = 0, cullMaxDistSq = Infinity;
  let cullPortalMode = 0, cullPortalCx = 0, cullPortalCz = 0, cullPortalRInSq = 0, cullPortalROutSq = 0, cullPortalFlankZ = 0;
  let p0x = 0, p0y = 0, p0z = 0, p0w = 0, p0ox = 0, p0oy = 1, p0oz = 2;
  let p1x = 0, p1y = 0, p1z = 0, p1w = 0, p1ox = 0, p1oy = 1, p1oz = 2;
  let p2x = 0, p2y = 0, p2z = 0, p2w = 0, p2ox = 0, p2oy = 1, p2oz = 2;
  let p3x = 0, p3y = 0, p3z = 0, p3w = 0, p3ox = 0, p3oy = 1, p3oz = 2;
  let p4x = 0, p4y = 0, p4z = 0, p4w = 0, p4ox = 0, p4oy = 1, p4oz = 2;
  let p5x = 0, p5y = 0, p5z = 0, p5w = 0, p5ox = 0, p5oy = 1, p5oz = 2;
  const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const frustum = new THREE.Frustum();
  const projection = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const combined = new THREE.Matrix4();
  const localBox = new THREE.Box3();
  const worldBox = new THREE.Box3();
  const origin = new THREE.Vector3();
  const point = new THREE.Vector3();
  const entries = [];
  const stats = { batches: 0, instances: 0, visibleInstances: 0, culledInstances: 0, trianglesBefore: 0, trianglesAfter: 0, staticMeshes: 0, pages: 0, visiblePages: 0 };
  let disposed = false;
  let rendering = false;

  function eligible(mesh) {
    if (managedSources.has(mesh) || !mesh.isMesh || mesh.isSkinnedMesh || mesh.castShadow || mesh.morphTexture) return false;
    const paged = !mesh.isInstancedMesh && STATIC_MESH_NAME.test(mesh.name);
    if (!paged && (!mesh.isInstancedMesh || mesh.instanceMatrix.usage !== THREE.StaticDrawUsage)) return false;
    let inRoot = paged && !roots;
    for (let p = mesh; p; p = p.parent) {
      if (excluded.has(p) || DYNAMIC_NAME.test(p.name) || p.userData.dynamic || p.userData.interactive || p.userData.staticVisibility === false) return false;
      if (roots ? roots.has(p) : (STATIC_ROOTS.has(p.name) || (extraRoots && extraRoots.has(p.name)))) inRoot = true;
    }
    if (!inRoot || (options.include && !options.include(mesh))) return false;
    if (mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || mesh.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return false;
    const geometry = mesh.geometry;
    if (Object.keys(geometry.morphAttributes).length || !geometry.attributes.position) return false;
    for (const attribute of Object.values(geometry.attributes)) if (attribute.isInstancedBufferAttribute || attribute.isInterleavedBufferAttribute || attribute.usage !== THREE.StaticDrawUsage) return false;
    if (paged && (geometry.index?.usage === THREE.DynamicDrawUsage || (geometry.index?.count ?? geometry.attributes.position.count) % 3 !== 0 || Array.isArray(mesh.material) || geometry.groups.length || geometry.drawRange.start !== 0 || geometry.drawRange.count < (geometry.index?.count ?? geometry.attributes.position.count))) return false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || material.isShaderMaterial || material.isRawShaderMaterial || material.transparent || material.displacementMap) return false;
      if (material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile && !isSkyAppearanceMaterial(material) && (paged || !options.allowShader?.(mesh))) return false;
    }
    return !mesh.instanceColor || (mesh.instanceColor.itemSize === 3 && !mesh.instanceColor.isInterleavedBufferAttribute);
  }

  function createPages(source) {
    const geometry = source.geometry, position = geometry.attributes.position, index = geometry.index;
    const capacity = index ? index.count : position.count;
    const buckets = new Map();
    // Every triangle belongs to exactly one page, but its WHOLE bounds are kept.
    // Grouping is camera-independent. Crossing a cell edge never clips a triangle.
    for (let t = 0; t + 2 < capacity; t += 3) {
      const a = index ? index.getX(t) : t, b = index ? index.getX(t + 1) : t + 1, c = index ? index.getX(t + 2) : t + 2;
      const x = Math.floor((position.getX(a) + position.getX(b) + position.getX(c)) / (3 * cellSize));
      const z = Math.floor((position.getZ(a) + position.getZ(b) + position.getZ(c)) / (3 * cellSize));
      const key = x + ':' + z;
      let bucket = buckets.get(key);
      if (!bucket) { bucket = []; buckets.set(key, bucket); }
      bucket.push(a, b, c);
    }
    const pages = Array.from(buckets.values(), indices => ({ indices: new Uint32Array(indices), box: new THREE.Box3() }));
    const renderGeometry = new THREE.BufferGeometry();
    for (const name of Object.keys(geometry.attributes)) renderGeometry.setAttribute(name, geometry.attributes[name]);
    renderGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    renderGeometry.setDrawRange(0, 0);
    const proxy = new THREE.Mesh(renderGeometry, source.material);
    return { kind: 'pages', source, proxy, geometry, originalIndex: index, indexVersion: index?.version ?? -1, capacity,
      pages, bounds: new Float64Array(pages.length * 6), indices: new Uint32Array(pages.length), visiblePages: -1, indexCount: 0,
      world: new THREE.Matrix4(), positionVersion: -1, material: source.material, raycast: source.raycast };
  }

  // Traverse before attaching proxies; never accidentally include our own children.
  scene.traverse(source => {
    if (!eligible(source)) return;
    const capacity = source.instanceMatrix?.count;
    const entry = source.isInstancedMesh ? {
      kind: 'instances', source, capacity, bounds: new Float64Array(capacity * 6), indices: new Uint32Array(capacity),
      world: new THREE.Matrix4(), matrixVersion: -1, colorVersion: -1, positionVersion: -1, count: -1,
      material: source.material, raycast: source.raycast, triangleCount: 0, dirty: true,
      proxy: new THREE.InstancedMesh(source.geometry, source.material, capacity)
    } : createPages(source);
    entry.extraMargin = options.extraMargin ? (Number(options.extraMargin(source)) || 0) : 0;
    let keepHorizon = source.name === 'terrain';
    for (let p = source; p && !keepHorizon; p = p.parent) if (p.name === 'cliff') keepHorizon = true;
    entry.keepHorizon = keepHorizon;
    const proxy = entry.proxy;
    proxy.name = 'static-visibility:' + source.name;
    proxy.matrixAutoUpdate = false;
    proxy.frustumCulled = false; // Full transformed instance boxes are tested below.
    proxy.visible = false;
    proxy.raycast = function () {};
    if (proxy.isInstancedMesh) {
      proxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (source.instanceColor) proxy.instanceColor = new THREE.InstancedBufferAttribute(new source.instanceColor.array.constructor(source.instanceColor.array.length), 3, source.instanceColor.normalized).setUsage(THREE.DynamicDrawUsage);
      if (getLod) {
        const lodSpec = getLod(source);
        if (lodSpec && lodSpec.geometry && Number.isFinite(lodSpec.distance) && lodSpec.distance > 0) {
          const lodGeo = lodSpec.geometry;
          const lodProxy = new THREE.InstancedMesh(lodGeo, source.material, capacity);
          lodProxy.name = 'static-visibility-lod:' + source.name;
          lodProxy.matrixAutoUpdate = false;
          lodProxy.frustumCulled = false;
          lodProxy.visible = false;
          lodProxy.raycast = function () {};
          lodProxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          if (source.instanceColor) {
            lodProxy.instanceColor = new THREE.InstancedBufferAttribute(
              new source.instanceColor.array.constructor(source.instanceColor.array.length),
              3,
              source.instanceColor.normalized
            ).setUsage(THREE.DynamicDrawUsage);
          }
          const hys = Math.max(0, Number(lodSpec.hysteresis ?? 8));
          const dNear = lodSpec.distance + hys;
          const dFar = Math.max(0, lodSpec.distance - hys);
          entry.lod = {
            geometry: lodGeo,
            proxy: lodProxy,
            indices: new Uint32Array(capacity),
            prevLod: null,
            stayNearSq: dNear * dNear,
            stayFarSq: dFar * dFar,
            triangleCount: (lodGeo.index ? lodGeo.index.count : lodGeo.attributes.position.count) / 3,
            syncGeometry: typeof lodSpec.syncGeometry === 'function' ? lodSpec.syncGeometry : null,
            colorAttrVersion: source.geometry.attributes.color?.version ?? -1,
            colorVersion: -1,
            dirty: true
          };
        }
      }
    }
    // Raycaster intentionally ignores Object3D.visible. Keep source hits/IDs even
    // during the render transaction, with the ORIGINAL material side semantics.
    entry.raycastWrapper = function (raycaster, hits) {
      const material = this.material;
      if (rendering) this.material = entry.material;
      try { return entry.raycast.call(this, raycaster, hits); }
      finally { this.material = material; }
    };
    entries.push(entry);
  });
  for (const entry of entries) {
    managedSources.add(entry.source);
    entry.source.add(entry.proxy);
    if (entry.lod) entry.source.add(entry.lod.proxy);
    entry.source.raycast = entry.raycastWrapper;
  }
  stats.batches = entries.length;
  stats.staticMeshes = entries.filter(entry => entry.kind === 'pages').length;
  stats.pages = entries.reduce((sum, entry) => sum + (entry.pages?.length || 0), 0);

  function rebuildBounds(entry) {
    const source = entry.source;
    const geometry = source.geometry;
    geometry.computeBoundingBox();
    localBox.copy(geometry.boundingBox).expandByPoint(origin);
    const count = source.count;
    const expand = margin + (entry.extraMargin || 0);
    for (let i = 0; i < count; i++) {
      instance.fromArray(source.instanceMatrix.array, i * 16);
      combined.multiplyMatrices(source.matrixWorld, instance);
      worldBox.copy(localBox).applyMatrix4(combined).expandByScalar(expand);
      const b = entry.bounds, offset = i * 6;
      b[offset] = worldBox.min.x; b[offset + 1] = worldBox.min.y; b[offset + 2] = worldBox.min.z;
      b[offset + 3] = worldBox.max.x; b[offset + 4] = worldBox.max.y; b[offset + 5] = worldBox.max.z;
    }
    entry.world.copy(source.matrixWorld);
    entry.matrixVersion = source.instanceMatrix.version;
    entry.positionVersion = geometry.attributes.position.version;
    entry.count = count;
    entry.triangleCount = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    entry.dirty = true;
  }

  function intersectsBounds(bounds, offset) {
    return (
      p0x * bounds[offset + p0ox] + p0y * bounds[offset + p0oy] + p0z * bounds[offset + p0oz] + p0w >= 0 &&
      p1x * bounds[offset + p1ox] + p1y * bounds[offset + p1oy] + p1z * bounds[offset + p1oz] + p1w >= 0 &&
      p2x * bounds[offset + p2ox] + p2y * bounds[offset + p2oy] + p2z * bounds[offset + p2oz] + p2w >= 0 &&
      p3x * bounds[offset + p3ox] + p3y * bounds[offset + p3oy] + p3z * bounds[offset + p3oz] + p3w >= 0 &&
      p4x * bounds[offset + p4ox] + p4y * bounds[offset + p4oy] + p4z * bounds[offset + p4oz] + p4w >= 0 &&
      p5x * bounds[offset + p5ox] + p5y * bounds[offset + p5oy] + p5z * bounds[offset + p5oz] + p5w >= 0
    );
  }

  function passesExtraCulling(bounds, offset, keepHorizon, maxDistSq = cullMaxDistSq) {
    if (keepHorizon) return true;
    if (maxDistSq < Infinity) {
      const minX = bounds[offset], minY = bounds[offset + 1], minZ = bounds[offset + 2];
      const maxX = bounds[offset + 3], maxY = bounds[offset + 4], maxZ = bounds[offset + 5];
      const dx = cullCamX < minX ? minX - cullCamX : (cullCamX > maxX ? cullCamX - maxX : 0);
      const dy = cullCamY < minY ? minY - cullCamY : (cullCamY > maxY ? cullCamY - maxY : 0);
      const dz = cullCamZ < minZ ? minZ - cullCamZ : (cullCamZ > maxZ ? cullCamZ - maxZ : 0);
      if (dx * dx + dy * dy + dz * dz > maxDistSq) return false;
    }
    if (cullPortalMode !== 0) {
      const maxY = bounds[offset + 4];
      if (maxY < 24) {
        const minX = bounds[offset], minZ = bounds[offset + 2], maxX = bounds[offset + 3], maxZ = bounds[offset + 5];
        if (cullPortalMode < 0) {
          const rdx = cullPortalCx < minX ? minX - cullPortalCx : (cullPortalCx > maxX ? cullPortalCx - maxX : 0);
          const rdz = cullPortalCz < minZ ? minZ - cullPortalCz : (cullPortalCz > maxZ ? cullPortalCz - maxZ : 0);
          if (rdx * rdx + rdz * rdz > cullPortalROutSq && minZ > cullPortalFlankZ + 8) return false;
        } else {
          const maxRx = Math.max(Math.abs(minX - cullPortalCx), Math.abs(maxX - cullPortalCx));
          const maxRz = Math.max(Math.abs(minZ - cullPortalCz), Math.abs(maxZ - cullPortalCz));
          if (maxRx * maxRx + maxRz * maxRz < cullPortalRInSq || maxZ < cullPortalFlankZ - 12) return false;
        }
      }
    }
    return true;
  }

  function updatePages(entry) {
    const source = entry.source, geometry = source.geometry, position = geometry.attributes.position;
    if (Array.isArray(source.material) || geometry.groups.length || geometry !== entry.geometry || geometry.index !== entry.originalIndex || (geometry.index?.version ?? -1) !== entry.indexVersion || position !== entry.proxy.geometry.attributes.position || (geometry.index?.count ?? position.count) !== entry.capacity || geometry.drawRange.start !== 0 || geometry.drawRange.count < entry.capacity) throw new Error('Static visibility topology changed; recreate helper');
    const positionChanged = entry.positionVersion !== position.version;
    if (positionChanged || !entry.world.equals(source.matrixWorld)) {
      const expand = margin + (entry.extraMargin || 0);
      for (let i = 0; i < entry.pages.length; i++) {
        const page = entry.pages[i];
        if (positionChanged) {
          page.box.makeEmpty();
          for (let j = 0; j < page.indices.length; j++) page.box.expandByPoint(point.fromBufferAttribute(position, page.indices[j]));
        }
        worldBox.copy(page.box).applyMatrix4(source.matrixWorld).expandByScalar(expand);
        const b = entry.bounds, offset = i * 6;
        b[offset] = worldBox.min.x; b[offset + 1] = worldBox.min.y; b[offset + 2] = worldBox.min.z;
        b[offset + 3] = worldBox.max.x; b[offset + 4] = worldBox.max.y; b[offset + 5] = worldBox.max.z;
      }
      entry.positionVersion = position.version;
      entry.world.copy(source.matrixWorld);
    }
    if (!entry.prevPages || entry.prevPages.length !== entry.pages.length) entry.prevPages = new Uint8Array(entry.pages.length);
    let visible = 0, changed = false;
    for (let i = 0; i < entry.pages.length; i++) {
      const offset = i * 6;
      const lim = entry.prevPages[i] ? entry.keepDistSq : entry.maxDistSq;
      if (!intersectsBounds(entry.bounds, offset) || !passesExtraCulling(entry.bounds, offset, entry.keepHorizon, lim)) { entry.prevPages[i] = 0; continue; }
      entry.prevPages[i] = 1;
      if (entry.indices[visible] !== i) changed = true;
      entry.indices[visible++] = i;
    }
    if (visible !== entry.visiblePages) changed = true;
    if (changed) {
      let offset = 0;
      const index = entry.proxy.geometry.index;
      for (let i = 0; i < visible; i++) {
        const indices = entry.pages[entry.indices[i]].indices;
        index.array.set(indices, offset); offset += indices.length;
      }
      if (offset > 0) {
        index.clearUpdateRanges();
        index.addUpdateRange(0, offset);
        index.needsUpdate = true;
      }
      entry.proxy.geometry.setDrawRange(0, offset);
      entry.indexCount = offset;
    }
    entry.visiblePages = visible;
    stats.visiblePages += visible;
    stats.trianglesBefore += entry.capacity / 3;
    stats.trianglesAfter += entry.indexCount / 3;
  }

  function update(camera) {
    if (disposed) throw new Error('Static visibility helper is disposed');
    if (rendering) throw new Error('Static visibility does not support nested rendering');
    // Main world uses one perspective camera. Leave XR/array cameras untouched.
    if (!camera || camera.isArrayCamera || (!camera.isPerspectiveCamera && !camera.isOrthographicCamera)) return false;
    scene.updateMatrixWorld(true);
    camera.updateWorldMatrix(true, false);
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection, camera.coordinateSystem);
    {
      const planes = frustum.planes;
      let pl = planes[0], n = pl.normal;
      p0x = n.x; p0y = n.y; p0z = n.z; p0w = pl.constant;
      p0ox = n.x >= 0 ? 3 : 0; p0oy = n.y >= 0 ? 4 : 1; p0oz = n.z >= 0 ? 5 : 2;
      pl = planes[1]; n = pl.normal;
      p1x = n.x; p1y = n.y; p1z = n.z; p1w = pl.constant;
      p1ox = n.x >= 0 ? 3 : 0; p1oy = n.y >= 0 ? 4 : 1; p1oz = n.z >= 0 ? 5 : 2;
      pl = planes[2]; n = pl.normal;
      p2x = n.x; p2y = n.y; p2z = n.z; p2w = pl.constant;
      p2ox = n.x >= 0 ? 3 : 0; p2oy = n.y >= 0 ? 4 : 1; p2oz = n.z >= 0 ? 5 : 2;
      pl = planes[3]; n = pl.normal;
      p3x = n.x; p3y = n.y; p3z = n.z; p3w = pl.constant;
      p3ox = n.x >= 0 ? 3 : 0; p3oy = n.y >= 0 ? 4 : 1; p3oz = n.z >= 0 ? 5 : 2;
      pl = planes[4]; n = pl.normal;
      p4x = n.x; p4y = n.y; p4z = n.z; p4w = pl.constant;
      p4ox = n.x >= 0 ? 3 : 0; p4oy = n.y >= 0 ? 4 : 1; p4oz = n.z >= 0 ? 5 : 2;
      pl = planes[5]; n = pl.normal;
      p5x = n.x; p5y = n.y; p5z = n.z; p5w = pl.constant;
      p5ox = n.x >= 0 ? 3 : 0; p5oy = n.y >= 0 ? 4 : 1; p5oz = n.z >= 0 ? 5 : 2;
    }
    const camElements = camera.matrixWorld.elements;
    cullCamX = camElements[12]; cullCamY = camElements[13]; cullCamZ = camElements[14];
    const maxDist = getMaxDistance ? Number(getMaxDistance(camera)) : Infinity;
    cullMaxDistSq = Number.isFinite(maxDist) && maxDist > 0 ? maxDist * maxDist : Infinity;
    cullPortalMode = 0;
    if (cliffPortal && cullCamY < 18) {
      const slitDist = Math.hypot(cullCamX - cliffPortal.slit.x, cullCamZ - cliffPortal.slit.z);
      if (slitDist > 26) {
        cullPortalCx = cliffPortal.center[0]; cullPortalCz = cliffPortal.center[1];
        const camR = Math.hypot(cullCamX - cullPortalCx, cullCamZ - cullPortalCz);
        const radius = cliffPortal.radius;
        const arcFrom = Number.isFinite(cliffPortal.arcFrom) ? cliffPortal.arcFrom : 0.55;
        cullPortalFlankZ = Number.isFinite(cliffPortal.flankZ) ? cliffPortal.flankZ : (cullPortalCz + Math.sin(arcFrom) * radius);
        if (camR < radius - 22 || cullCamZ < cullPortalFlankZ - 14) {
          cullPortalMode = -1;
          cullPortalROutSq = (radius + 20) * (radius + 20);
        } else if (camR > radius + 22 && cullCamZ > cullPortalFlankZ + 12) {
          cullPortalMode = 1;
          const rIn = Math.max(0, radius - 20);
          cullPortalRInSq = rIn * rIn;
        }
      }
    }
    stats.instances = stats.visibleInstances = stats.trianglesBefore = stats.trianglesAfter = stats.visiblePages = 0;
    for (let e = 0; e < entries.length; e++) {
      const entry = entries[e], source = entry.source, proxy = entry.proxy;
      proxy.material = source.material;
      proxy.layers.mask = source.layers.mask;
      proxy.renderOrder = source.renderOrder;
      proxy.receiveShadow = source.receiveShadow;
      // Per-source distance cap: getMaxDistance(camera, mesh) may tighten the fog tail
      // for sub-pixel ground cover; undefined mesh keeps the global fog-tail value.
      if (getMaxDistance) {
        const md = Number(getMaxDistance(camera, source));
        entry.maxDistSq = Number.isFinite(md) && md > 0 ? md * md : Infinity;
      } else entry.maxDistSq = cullMaxDistSq;
      // 6-unit dead band: already-visible instances/pages stay until cap+6 so idle
      // camera sway at a distance boundary cannot churn full-prefix GPU uploads.
      if (entry.maxDistSq < Infinity) {
        const r = Math.sqrt(entry.maxDistSq) + 6;
        entry.keepDistSq = r * r;
      } else entry.keepDistSq = Infinity;
      if (entry.kind === 'pages') { updatePages(entry); continue; }
      if (source.count > entry.capacity || source.geometry !== proxy.geometry || !!source.instanceColor !== !!proxy.instanceColor) throw new Error('Static visibility topology/capacity changed; recreate helper');
      if (entry.count !== source.count || entry.matrixVersion !== source.instanceMatrix.version || entry.positionVersion !== source.geometry.attributes.position.version || !entry.world.equals(source.matrixWorld)) {
        rebuildBounds(entry);
        if (entry.lod) entry.lod.dirty = true;
      }
      if (!entry.prev || entry.prev.length !== source.count) entry.prev = new Uint8Array(source.count);
      const b = entry.bounds;
      const lod = entry.lod;
      if (lod) {
        const lp = lod.proxy;
        lp.material = source.material;
        lp.layers.mask = source.layers.mask;
        lp.renderOrder = source.renderOrder;
        lp.receiveShadow = source.receiveShadow;
        if (lod.syncGeometry && source.geometry.attributes.color) {
          const cv = source.geometry.attributes.color.version;
          if (cv !== lod.colorAttrVersion) {
            lod.syncGeometry(source, lod.geometry);
            lod.colorAttrVersion = cv;
          }
        }
        if (!lod.prevLod || lod.prevLod.length !== source.count) lod.prevLod = new Uint8Array(source.count);
        let visible = 0, lodVisible = 0;
        let changed = entry.dirty, lodChanged = lod.dirty;
        for (let i = 0; i < source.count; i++) {
          const offset = i * 6;
          const lim = entry.prev[i] ? entry.keepDistSq : entry.maxDistSq;
          if (!intersectsBounds(b, offset) || !passesExtraCulling(b, offset, entry.keepHorizon, lim)) {
            entry.prev[i] = 0;
            continue;
          }
          entry.prev[i] = 1;
          const minX = b[offset], minY = b[offset + 1], minZ = b[offset + 2];
          const maxX = b[offset + 3], maxY = b[offset + 4], maxZ = b[offset + 5];
          const dx = cullCamX < minX ? minX - cullCamX : (cullCamX > maxX ? cullCamX - maxX : 0);
          const dy = cullCamY < minY ? minY - cullCamY : (cullCamY > maxY ? cullCamY - maxY : 0);
          const dz = cullCamZ < minZ ? minZ - cullCamZ : (cullCamZ > maxZ ? cullCamZ - maxZ : 0);
          const d2 = dx * dx + dy * dy + dz * dz;
          const useFar = lod.prevLod[i] ? (d2 > lod.stayFarSq) : (d2 > lod.stayNearSq);
          lod.prevLod[i] = useFar ? 1 : 0;
          if (useFar) {
            if (lod.indices[lodVisible] !== i) lodChanged = true;
            lod.indices[lodVisible++] = i;
          } else {
            if (entry.indices[visible] !== i) changed = true;
            entry.indices[visible++] = i;
          }
        }
        if (visible !== proxy.count) changed = true;
        if (lodVisible !== lp.count) lodChanged = true;
        const colorChanged = source.instanceColor && entry.colorVersion !== source.instanceColor.version;
        const lodColorChanged = source.instanceColor && lod.colorVersion !== source.instanceColor.version;
        const sourceMatrices = source.instanceMatrix.array;
        const sourceColors = source.instanceColor?.array;
        if ((changed || colorChanged) && visible > 0) {
          if (changed) {
            const matrices = proxy.instanceMatrix.array;
            for (let i = 0; i < visible; i++) {
              const dst = i * 16, src = entry.indices[i] * 16;
              for (let k = 0; k < 16; k++) matrices[dst + k] = sourceMatrices[src + k];
            }
            proxy.instanceMatrix.clearUpdateRanges();
            proxy.instanceMatrix.addUpdateRange(0, visible * 16);
            proxy.instanceMatrix.needsUpdate = true;
          }
          const colors = proxy.instanceColor?.array;
          if (colors && sourceColors) {
            for (let i = 0; i < visible; i++) {
              const dst = i * 3, src = entry.indices[i] * 3;
              colors[dst] = sourceColors[src];
              colors[dst + 1] = sourceColors[src + 1];
              colors[dst + 2] = sourceColors[src + 2];
            }
            proxy.instanceColor.clearUpdateRanges();
            proxy.instanceColor.addUpdateRange(0, visible * 3);
            proxy.instanceColor.needsUpdate = true;
          }
        }
        if ((lodChanged || lodColorChanged) && lodVisible > 0) {
          if (lodChanged) {
            const matrices = lp.instanceMatrix.array;
            for (let i = 0; i < lodVisible; i++) {
              const dst = i * 16, src = lod.indices[i] * 16;
              for (let k = 0; k < 16; k++) matrices[dst + k] = sourceMatrices[src + k];
            }
            lp.instanceMatrix.clearUpdateRanges();
            lp.instanceMatrix.addUpdateRange(0, lodVisible * 16);
            lp.instanceMatrix.needsUpdate = true;
          }
          const colors = lp.instanceColor?.array;
          if (colors && sourceColors) {
            for (let i = 0; i < lodVisible; i++) {
              const dst = i * 3, src = lod.indices[i] * 3;
              colors[dst] = sourceColors[src];
              colors[dst + 1] = sourceColors[src + 1];
              colors[dst + 2] = sourceColors[src + 2];
            }
            lp.instanceColor.clearUpdateRanges();
            lp.instanceColor.addUpdateRange(0, lodVisible * 3);
            lp.instanceColor.needsUpdate = true;
          }
        }
        entry.colorVersion = source.instanceColor?.version ?? -1;
        lod.colorVersion = entry.colorVersion;
        entry.dirty = false;
        lod.dirty = false;
        proxy.count = visible;
        lp.count = lodVisible;
        stats.instances += source.count;
        stats.visibleInstances += visible + lodVisible;
        stats.trianglesBefore += source.count * entry.triangleCount;
        stats.trianglesAfter += visible * entry.triangleCount + lodVisible * lod.triangleCount;
        continue;
      }
      let visible = 0, changed = entry.dirty;
      for (let i = 0; i < source.count; i++) {
        const offset = i * 6;
        const lim = entry.prev[i] ? entry.keepDistSq : entry.maxDistSq;
        if (!intersectsBounds(b, offset) || !passesExtraCulling(b, offset, entry.keepHorizon, lim)) { entry.prev[i] = 0; continue; }
        entry.prev[i] = 1;
        if (entry.indices[visible] !== i) changed = true;
        entry.indices[visible++] = i;
      }
      if (visible !== proxy.count) changed = true;
      const colorChanged = source.instanceColor && entry.colorVersion !== source.instanceColor.version;
      if ((changed || colorChanged) && visible > 0) {
        if (changed) {
          const matrices = proxy.instanceMatrix.array, sourceMatrices = source.instanceMatrix.array;
          for (let i = 0; i < visible; i++) {
            const dst = i * 16, src = entry.indices[i] * 16;
            matrices[dst] = sourceMatrices[src];
            matrices[dst + 1] = sourceMatrices[src + 1];
            matrices[dst + 2] = sourceMatrices[src + 2];
            matrices[dst + 3] = sourceMatrices[src + 3];
            matrices[dst + 4] = sourceMatrices[src + 4];
            matrices[dst + 5] = sourceMatrices[src + 5];
            matrices[dst + 6] = sourceMatrices[src + 6];
            matrices[dst + 7] = sourceMatrices[src + 7];
            matrices[dst + 8] = sourceMatrices[src + 8];
            matrices[dst + 9] = sourceMatrices[src + 9];
            matrices[dst + 10] = sourceMatrices[src + 10];
            matrices[dst + 11] = sourceMatrices[src + 11];
            matrices[dst + 12] = sourceMatrices[src + 12];
            matrices[dst + 13] = sourceMatrices[src + 13];
            matrices[dst + 14] = sourceMatrices[src + 14];
            matrices[dst + 15] = sourceMatrices[src + 15];
          }
          proxy.instanceMatrix.clearUpdateRanges();
          proxy.instanceMatrix.addUpdateRange(0, visible * 16);
          proxy.instanceMatrix.needsUpdate = true;
        }
        const colors = proxy.instanceColor?.array, sourceColors = source.instanceColor?.array;
        if (colors && sourceColors) {
          for (let i = 0; i < visible; i++) {
            const dst = i * 3, src = entry.indices[i] * 3;
            colors[dst] = sourceColors[src];
            colors[dst + 1] = sourceColors[src + 1];
            colors[dst + 2] = sourceColors[src + 2];
          }
          proxy.instanceColor.clearUpdateRanges();
          proxy.instanceColor.addUpdateRange(0, visible * 3);
          proxy.instanceColor.needsUpdate = true;
        }
      }
      entry.colorVersion = source.instanceColor?.version ?? -1;
      entry.dirty = false;
      proxy.count = visible;
      stats.instances += source.count;
      stats.visibleInstances += visible;
      stats.trianglesBefore += source.count * entry.triangleCount;
      stats.trianglesAfter += visible * entry.triangleCount;
    }
    stats.culledInstances = stats.instances - stats.visibleInstances;
    return true;
  }

  function restore() {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      entry.source.material = entry.material;
      entry.proxy.visible = false;
      if (entry.lod) entry.lod.proxy.visible = false;
    }
    rendering = false;
  }

  function render(renderer, camera) {
    if (disposed) throw new Error('Static visibility helper is disposed');
    if (renderer.xr?.isPresenting) return renderer.render(scene, camera);
    if (!update(camera)) return renderer.render(scene, camera);
    rendering = true;
    // Snapshot every material first: even a bound-computation failure halfway
    // through activation must restore the current, not a previous-frame material.
    for (let i = 0; i < entries.length; i++) entries[i].material = entries[i].source.material;
    const prevAutoUpdate = scene.matrixWorldAutoUpdate;
    try {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        entry.source.material = hiddenMaterial;
        const inFrustum = !entry.source.frustumCulled || frustum.intersectsObject(entry.source);
        entry.proxy.visible = (entry.kind === 'pages' ? entry.indexCount : entry.proxy.count) > 0 && inFrustum;
        if (entry.lod) entry.lod.proxy.visible = entry.lod.proxy.count > 0 && inFrustum;
      }
      scene.matrixWorldAutoUpdate = false;
      return renderer.render(scene, camera);
    } finally {
      scene.matrixWorldAutoUpdate = prevAutoUpdate;
      restore();
    }
  }

  function dispose() {
    if (disposed) return;
    if (rendering) throw new Error('Cannot dispose static visibility during rendering');
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      managedSources.delete(entry.source);
      entry.source.remove(entry.proxy);
      if (entry.lod) {
        entry.source.remove(entry.lod.proxy);
        entry.lod.proxy.dispose();
        entry.lod.geometry.dispose();
      }
      if (entry.source.raycast === entry.raycastWrapper) entry.source.raycast = entry.raycast;
      if (entry.kind === 'pages') {
        // Release only OWNED index/VAO, never shared source vertex GPU buffers.
        const geometry = entry.proxy.geometry;
        for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
        geometry.dispose();
      } else entry.proxy.dispose();
    }
    hiddenMaterial.dispose();
    disposed = true;
  }

  return { update, render, dispose, entries, getStats: () => stats };
}
