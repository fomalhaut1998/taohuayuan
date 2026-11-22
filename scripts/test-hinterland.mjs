import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createBarrier } from '../src/systems/barrier.js';
import { projectionFor, drawHinterland } from '../src/systems/mapdraw.js';
import { createHinterland, planHinterland, hinterlandSiteSafe, segmentDistance } from '../src/world/hinterland.js';
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
// Canvas operations are not under test: the real village geometries and positions are.
const ctx = new Proxy({}, { get: () => () => ctx });
globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
const river = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points), 160));
const h = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = new Float32Array(grid.attributes.position.count);
for (let i = 0; i < heights.length; i++) heights[i] = h(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const cliff = createCliff(world.cliff, field);
const out = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const again = planHinterland(world, field, river, village, props, cliff);
for (const key of ['trees', 'bamboo', 'structures', 'paths', 'rejected']) assert.deepEqual(out[key], again[key], key + ' deterministic');
assert.equal(out.rejected.length, 0, 'configured paths/production corners all accepted');
assert.ok(out.trees.length >= 65 && out.trees.length <= 110, 'sparse readable tree budget');
assert.ok(out.trees.filter(t => t.x < 0).length >= 45, 'large lower-map blank filled by actual groves');
assert.ok(out.trees.filter(t => t.x >= 72 && t.z < -192).length >= 12, 'upper-left blank filled');
assert.equal(out.bamboo.length, 27);
assert.equal(out.structures.length, 4);
assert.equal(out.paths.length, 6);
const objects = [...out.trees, ...out.bamboo, ...out.structures];
for (const p of objects) {
  assert.ok(hinterlandSiteSafe(p.x, p.z, p.radius, out.context), 'whole footprint clear: ' + (p.id || p.patch));
  assert.equal(p.y, field.sample(p.x, p.z), 'root follows actual terrain');
  for (const path of out.paths) for (let i = 1; i < path.points.length; i++) {
    assert.ok(segmentDistance(p.x, p.z, path.points[i - 1], path.points[i]) >= p.radius + path.width / 2 + world.hinterland.routeMargin - 1e-8, 'path remains open');
  }
}
for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
  const a = objects[i], b = objects[j];
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= a.radius + b.radius + world.hinterland.plantGap - 1e-8, 'crown spacing budget');
}
const barrier = createBarrier([...cliff.blockers, ...village.blockers, ...out.blockers]);
let samples = 0;
for (const path of out.paths) {
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / 0.3), nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
    for (let j = 0; j <= n; j++) {
      const x = a[0] + (b[0] - a[0]) * j / n, z = a[1] + (b[1] - a[1]) * j / n;
      assert.ok(hinterlandSiteSafe(x, z, path.width / 2, out.context, false), path.id + ' entire segment checked');
      for (const side of [-1, 0, 1]) {
        const sx = x + nx * path.width / 2 * side, sz = z + nz * path.width / 2 * side;
        const state = { x: sx, z: sz, vx: 1, vz: 1 };
        barrier.resolve(state, 0.42);
        assert.ok(Math.hypot(state.x - sx, state.z - sz) < 1e-8, path.id + ' player free across full width');
        samples++;
      }
      for (const c of out.context.reservations.corridors) for (let k = 1; k < c.points.length; k++) {
        if (segmentDistance(x, z, c.points[k - 1], c.points[k]) < c.half + path.width / 2 + world.hinterland.routeMargin) {
          assert.ok(Math.hypot(x - path.points[0][0], z - path.points[0][1]) <= world.hinterland.joinRadius + 1e-8, 'old path overlaps only at connection');
        }
      }
    }
  }
}
// Existing main road connects at three separated approach directions, never by map-only lines.
for (const id of ['west-middle', 'west-south', 'upper-orchard']) {
  const p = out.paths.find(p => p.id === id).points[0];
  assert.ok(world.village.road.points.slice(1).some((b, i) => segmentDistance(...p, world.village.road.points[i], b) < world.village.road.width / 2), id + ' joins old main road');
}
for (const b of out.blockers) {
  assert.ok([b.x, b.z, b.hw, b.hd, b.rot, b.minY, b.maxY].every(Number.isFinite));
  assert.ok(b.hw > 0 && b.hd > 0 && b.maxY > b.minY);
  const s = { x: b.x, z: b.z, vx: 0, vz: 0 };
  createBarrier([b]).resolve(s, 0.42);
  assert.ok(Math.hypot(s.x - b.x, s.z - b.z) > 0.42, 'solid collision responds');
}
// Frame tops share a horizontal support height even on uneven ground.
for (const s of out.structures.filter(s => s.kind === 'trellis' || s.kind === 'drying')) {
  const posts = out.blockers.filter(b => b.source === s.id && b.hw < 0.1);
  assert.equal(posts.length, s.kind === 'trellis' ? 6 : 4);
  for (const post of posts) assert.ok(Math.abs(post.maxY - s.y - (s.kind === 'trellis' ? 2.15 : 0.95)) < 1e-8,
    'post meets horizontal frame rather than floating or protruding');
}
const matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
for (const mesh of out.group.children) {
  assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite), mesh.name + ' finite geometry');
  if (mesh.isInstancedMesh) assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
  if (mesh.name.startsWith('hinterland-crown')) {
    const variant = Number(mesh.name.at(-1)), trees = out.trees.filter(t => t.variant === variant);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); const t = trees[Math.floor(i / 5)];
      for (let k = 0; k < mesh.geometry.attributes.position.count; k++) {
        vertex.fromBufferAttribute(mesh.geometry.attributes.position, k).applyMatrix4(matrix);
        assert.ok(Math.hypot(vertex.x - t.x, vertex.z - t.z) <= t.radius + 1e-5, 'rendered crown stays inside planned clearance');
      }
    }
  }
}
assert.ok(out.group.children.length <= 10, 'shared instancing drawcall budget');
const ground = out.group.getObjectByName('hinterland-paths').geometry.attributes.position;
for (let i = 0; i < ground.count; i++) assert.ok(Math.abs(ground.getY(i) - field.sample(ground.getX(i), ground.getZ(i)) - world.hinterland.pathLift) < 1e-4, 'ribbon follows heightfield');
const proj = projectionFor(world.map.extent, 1120, 466), moves = [], ellipses = [];
const mapCtx = new Proxy({}, { get: (_, key) => (...v) => { if (key === 'moveTo') moves.push(v); if (key === 'ellipse') ellipses.push(v); } });
drawHinterland(mapCtx, proj, world.map, { hinterland: out });
for (const p of out.paths) assert.ok(moves.some(v => Math.abs(v[0] - proj.px(...p.points[0])) < 1e-9 && Math.abs(v[1] - proj.py(...p.points[0])) < 1e-9), 'map projects exact path');
assert.equal(ellipses.length, out.trees.length * 5, 'map has exactly scene tree count');
assert.ok(proj.py(-40, -130) > proj.py(30, -130) && proj.px(88, -215) < proj.px(30, -130), 'lower-x is below / negative-z is left');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
// Additional scene colliders are valid; require the original sources without freezing arity.
const colliderSetup = main.match(/const colliders = ([^;]+);/)?.[1] || '';
assert.match(colliderSetup, /^cliff\.blockers\.concat\(village\.blockers, hinterland\.blockers(?:, [A-Za-z]+\.blockers)*\)$/);
assert.match(main, /createPeople\([^;]+, colliders\)/);
assert.match(main, /hinterland: hinterland/);
console.log(JSON.stringify({ result: 'PASS', trees: out.trees.length, treesByPatch: Object.fromEntries(world.hinterland.groves.map(p => [p.id, out.trees.filter(t=>t.patch===p.id).length])), bambooClumps: out.bamboo.length, structures: out.structures.length, paths: out.paths.length, walkSamples: samples, blockers: out.blockers.length, meshes: out.group.children.length }));
