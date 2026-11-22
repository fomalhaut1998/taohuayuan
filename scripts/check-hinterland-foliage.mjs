import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createHinterland, hinterlandSiteSafe, segmentDistance } from '../src/world/hinterland.js';
import { createHinterlandFoliage } from '../src/world/hinterland-foliage.js';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
const ctx = new Proxy({}, { get: () => () => ctx });
globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
const river = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points), 160));
const h = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from({ length: grid.attributes.position.count }, (_, i) => h(grid.attributes.position.getX(i), grid.attributes.position.getZ(i)));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const cliff = createCliff(world.cliff, field);
const land = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const before = JSON.stringify({ bamboo: land.bamboo, paths: land.paths, blockers: land.blockers, trees: land.trees });
const paletteBefore = JSON.stringify(world.hinterland.palette);
const out = createHinterlandFoliage(land, field, world.hinterland.palette);
const again = createHinterlandFoliage({ layout: land }, field, world.hinterland.palette);
assert.equal(JSON.stringify({ bamboo: land.bamboo, paths: land.paths, blockers: land.blockers, trees: land.trees }), before, 'no layout, collision, or route mutation');
assert.equal(JSON.stringify(world.hinterland.palette), paletteBefore, 'no palette mutation');
const stats = out.getStats();
assert.equal(land.bamboo.length, 27);
assert.equal(stats.clumps, 27); assert.equal(stats.culms, 81);
assert.equal(stats.rejectedSprays, 0, 'every real bamboo gets full connected foliage');
assert.equal(stats.sprays, 162); assert.equal(stats.leaves, 648); assert.equal(stats.twigs, 162);
assert.equal(stats.triangles, 3240); assert.ok(stats.triangles <= 3500);
assert.equal(out.group.children.length, 2, 'two shared batches, not one draw per leaf');
assert.equal(out.group.name, 'hinterland-foliage');
assert.deepEqual(stats, again.getStats(), 'deterministic counts and bounds');
const matrix = new THREE.Matrix4(), v = new THREE.Vector3(), normal = new THREE.Vector3();
const usedTransforms = new Set();
let triangles = 0, checkedVertices = 0, minWidth = Infinity, minDrop = Infinity;
for (let m = 0; m < out.group.children.length; m++) {
  const mesh = out.group.children[m], other = again.group.children[m];
  assert.ok(mesh.isInstancedMesh);
  assert.equal(mesh.instanceMatrix.usage, THREE.StaticDrawUsage);
  assert.equal(mesh.instanceColor.usage, THREE.StaticDrawUsage);
  assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
  assert.deepEqual(mesh.instanceMatrix.array, other.instanceMatrix.array, 'deterministic matrix bytes');
  assert.deepEqual(mesh.instanceColor.array, other.instanceColor.array, 'deterministic instance colors');
  assert.ok(mesh.instanceColor.array.every(c => Number.isFinite(c) && c > 0 && c <= 1), 'all instance colors nonblack');
  assert.equal(mesh.material.vertexColors, false, 'no missing vertex color attribute');
  assert.equal(mesh.geometry.getAttribute('color'), undefined);
  assert.equal(mesh.material.transparent, false); assert.equal(mesh.material.opacity, 1);
  assert.equal(mesh.material.side, THREE.DoubleSide); assert.equal(mesh.material.flatShading, true);
  assert.equal(mesh.material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile, 'no custom shader');
  assert.equal(mesh.castShadow, false, 'eligible for static optimization');
  assert.ok(mesh.boundingBox && mesh.boundingSphere && Number.isFinite(mesh.boundingSphere.radius));
  const position = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
  assert.equal(mesh.geometry.index, null, 'flat triangle normals, not averaged fold normals');
  assert.deepEqual(position.array, other.geometry.attributes.position.array);
  assert.deepEqual(normals.array, other.geometry.attributes.normal.array);
  assert.equal(normals.count, position.count);
  for (const attr of Object.values(mesh.geometry.attributes)) {
    assert.equal(attr.usage, THREE.StaticDrawUsage); assert.ok(attr.array.every(Number.isFinite));
  }
  for (let i = 0; i < normals.count; i++) {
    normal.fromBufferAttribute(normals, i); assert.ok(Math.abs(normal.length() - 1) < 1e-5, 'unit nonzero normals');
    if (i % 3) assert.deepEqual(normal.toArray(), new THREE.Vector3().fromBufferAttribute(normals, i - i % 3).toArray(), 'one normal per flat triangle');
  }
  triangles += mesh.count * position.count / 3;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    const source = mesh.userData.foliageSources[i], b = land.bamboo[source.clump];
    const a = b.rot + source.culm * 2.1, cx = b.x + Math.cos(a) * 0.22, cz = b.z + Math.sin(a) * 0.22;
    const cy = field.sample(cx, cz), height = b.height * (0.85 + source.culm * 0.06);
    assert.ok(source.node === 3 || source.node === 5, 'upper half only');
    assert.deepEqual(source.anchor, [cx + Math.cos(a) * 0.03 * source.node, cy + height * source.node / 6, cz + Math.sin(a) * 0.03 * source.node], 'follows exact terrain-rooted culm nodes');
    if (mesh.name.endsWith('twigs')) {
      const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
      assert.ok(origin.distanceTo(new THREE.Vector3(...source.anchor)) < 3e-5, 'twig joins existing culm node');
    } else {
      const key = Array.from(matrix.elements).join(',');
      assert.ok(!usedTransforms.has(key), 'no duplicate leaf transform/flickering double surface'); usedTransforms.add(key);
      const scale = new THREE.Vector3().setFromMatrixScale(matrix);
      minWidth = Math.min(minWidth, scale.z * 0.30); minDrop = Math.min(minDrop, scale.y * 0.52);
    }
    for (let k = 0; k < position.count; k++) {
      v.fromBufferAttribute(position, k).applyMatrix4(matrix); checkedVertices++;
      assert.ok([v.x, v.y, v.z].every(Number.isFinite));
      assert.ok(Math.hypot(v.x - b.x, v.z - b.z) <= b.radius, 'EVERY GPU-rounded vertex inside original reserved disk');
      assert.ok(v.y - field.sample(v.x, v.z) > 0.35, 'foliage clear of terrain');
      assert.ok(hinterlandSiteSafe(v.x, v.z, 0, land.context), 'each world vertex respects extent, basin, water, slope, buildings and old routes');
      for (const p of land.paths) for (let j = 1; j < p.points.length; j++) {
        assert.ok(segmentDistance(v.x, v.z, p.points[j - 1], p.points[j]) >= p.width / 2 + world.hinterland.routeMargin, 'each world vertex clear of new paths');
      }
    }
  }
}
assert.equal(triangles, stats.triangles);
assert.ok(minWidth >= 0.18 && minDrop >= 0.37, 'readable broad folded blades, not .055-high hairlines');
const pixelsAt30m = minWidth / 30 * 1080 / (2 * Math.tan(65 * Math.PI / 360));
assert.ok(pixelsAt30m > 5, 'minimum face-on blade width is over 5px at 30m/1080p/65deg');
// Actual default-root traversal, not an explicit opt-in that could hide bad names.
const scene = new THREE.Scene(); scene.add(land.group); land.group.add(out.group);
const visibility = optimizeStaticVisibility(scene);
for (const mesh of out.group.children) assert.ok(visibility.entries.some(e => e.source === mesh), 'included under static hinterland parent');
const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 1000);
camera.position.set(land.bamboo[0].x + 15, land.bamboo[0].y + 5, land.bamboo[0].z + 15);
camera.lookAt(land.bamboo[0].x, land.bamboo[0].y + 3, land.bamboo[0].z); camera.updateMatrixWorld();
assert.equal(visibility.update(camera), true);
assert.ok(visibility.entries.filter(e => out.group.children.includes(e.source)).some(e => e.proxy.count > 0), 'foliage visible to a normal walking-range camera');
visibility.dispose();
assert.ok(out.group.children.every(mesh => mesh.children.length === 0), 'visibility disposes only owned proxies');
const empty = createHinterlandFoliage({ bamboo: [] }, field);
assert.equal(empty.group.children.length, 0); assert.equal(empty.getStats().bounds, null);
const invalid = createHinterlandFoliage({ bamboo: [land.bamboo[0]] }, { sample: () => NaN });
assert.equal(invalid.group.children.length, 0, 'nonfinite terrain fails closed');
const narrow = createHinterlandFoliage({ bamboo: [{ ...land.bamboo[0], radius: 0.05 }] }, field);
assert.equal(narrow.group.children.length, 0, 'a smaller reservation rejects whole connected sprays');
assert.equal(narrow.getStats().rejectedSprays, 6);
const outside = createHinterlandFoliage({ bamboo: [land.bamboo[0]], context: { world: {
  map: { extent: { x: [0, 1], z: [0, 1] } }, hinterland: { edgeMargin: 0 } } } }, field);
assert.equal(outside.group.children.length, 0, 'world-bound violations reject whole connected sprays');
const dense = createHinterlandFoliage({ bamboo: Array(60).fill(land.bamboo[0]), context: land.context }, field);
assert.ok(dense.getStats().triangles <= 3500 && dense.getStats().rejectedSprays > 0, 'hard global budget even with future larger layouts');
console.log(JSON.stringify({ result: 'PASS', ...stats, checkedVertices, minLeafWidth: minWidth, minLeafDrop: minDrop,
  minFaceOnPixelsAt30m: pixelsAt30m, staticBatches: out.group.children.length }));
