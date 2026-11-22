import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createFlora } from '../src/world/flora.js';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createCliff } from '../src/world/cliff.js';
import { segmentDistance } from '../src/world/hinterland.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const curve = createRiverCurve(world.stream.points);
const river = createRiverDistance(sampleRiverSpine(curve, 160));
const height = createHeightFunction(world.terrain, river);
const size = world.terrain.size, segments = world.terrain.segments, step = size / segments;
const heights = Float32Array.from({ length: (segments + 1) ** 2 }, (_, i) => height(-size / 2 + i % (segments + 1) * step, -size / 2 + Math.floor(i / (segments + 1)) * step));
const terrain = new Heightfield(size, segments, heights), basin = world.terrain.basin;
const field = { half: terrain.half, sample: (x, z) => terrain.sample(x, z), slope: (x, z) => Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : terrain.slope(x, z) };
const cliff = createCliff(world.cliff, terrain);
const near = (x, z) => Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34 || Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40 || world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);
const make = cfg => createFlora(cfg, field, river, curve, world.player.spawn, near);
const legacy = make({ ...world.flora, groveLayout: false });
const out = make(world.flora), again = make(world.flora);
const triangles = group => group.children.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 * m.count, 0);
const source = JSON.stringify(world.flora);
const closestPeach = flora => flora.spots.reduce((a, b) => !a || Math.hypot(b[0] - 16, b[2] - 120) < Math.hypot(a[0] - 16, a[2] - 120) ? b : a, null);
const changed = out.spots.filter((p, i) => p[0] !== legacy.spots[i][0] || p[2] !== legacy.spots[i][2]);
console.log(JSON.stringify({ phase: 'placement-contract', trees: out.count, near: out.nearCount, batches: out.group.children.length, triangles: triangles(out.group), changed: changed.length, river: [0.1, 0.25, 0.4, 0.55, 0.7].map(t => curve.getPointAt(t).toArray()) }));
assert.ok(changed.length >= 120, 'outer creek groves must actually change, not merely retint uniform placement');
assert.equal(out.count, world.flora.treeCount); assert.ok(out.count <= 1950, 'no additional tree instances');
assert.equal(out.nearCount, legacy.nearCount, 'near geometry count must not grow');
assert.deepEqual(out.nearSpots, legacy.nearSpots, 'near/portal/spawn/road trees remain exactly planted');
assert.equal(out.group.children.length, 10, 'retain six far and four near batches');
assert.equal(triangles(out.group), triangles(legacy.group), 'exact same per-variant triangle budget');
assert.deepEqual(out.spots, again.spots, 'layout deterministic');
assert.deepEqual(closestPeach(out), closestPeach(legacy), 'existing quiet peach remains the same actual tree');
for (let i = 0; i < out.spots.length; i++) {
  const p = out.spots[i], old = legacy.spots[i];
  assert.equal(p.length, 3, 'spot tuple API preserved');
  assert.ok(p.every(Number.isFinite)); assert.equal(p[1], field.sample(p[0], p[2]));
  assert.ok(Math.abs(p[0]) <= field.half - 8 && Math.abs(p[2]) <= field.half - 8);
  assert.ok(river(p[0], p[2]) >= world.flora.bandInner - 3);
  assert.ok(Math.hypot(p[0] - world.player.spawn.x, p[2] - world.player.spawn.z) >= world.flora.spawnClearRadius);
  assert.ok(field.slope(p[0], p[2]) <= world.flora.slopeLimit);
  if (p[0] !== old[0] || p[2] !== old[2]) {
    assert.ok(old[2] >= 64 && p[2] >= 64, 'only outer creek is redistributed');
    assert.equal(near(p[0], p[2]), false, 'relocation never upgrades a far slot to near geometry');
  }
}
for (let i = 0; i < out.group.children.length; i++) {
  const mesh = out.group.children[i], same = again.group.children[i], old = legacy.group.children[i];
  assert.equal(mesh.name, old.name); assert.equal(mesh.count, old.count);
  for (const name of ['position', 'normal', 'color']) assert.deepEqual(mesh.geometry.attributes[name].array, old.geometry.attributes[name].array, 'authored geometry/vertex colours unchanged');
  assert.deepEqual(mesh.instanceMatrix.array, same.instanceMatrix.array); assert.deepEqual(mesh.instanceColor.array, same.instanceColor.array);
  assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
  if (mesh.name.startsWith('tree-near')) {
    assert.deepEqual(mesh.instanceMatrix.array, old.instanceMatrix.array, 'near instances retain exact matrices');
    assert.deepEqual(mesh.instanceColor.array, old.instanceColor.array, 'near instances retain exact colours');
  }
}
assert.equal(JSON.stringify(world.flora), source, 'never mutate configuration');
// Independent spatial readings: 12m windows along the two dry banks. Sparse and
// dense segments must alternate rather than hide the same uniform field behind a new seed.
const windows = [];
for (let t = 0.03; t < 1; t += 0.018) {
  const p = curve.getPointAt(t); if (p.z < 75 || p.z > 190) continue;
  const tangent = curve.getTangentAt(t), length = Math.hypot(tangent.x, tangent.z);
  for (const side of [-1, 1]) {
    const x = p.x + tangent.z / length * 39 * side, z = p.z - tangent.x / length * 39 * side;
    if (near(x, z)) continue;
    const count = flora => flora.spots.filter(s => Math.hypot(s[0] - x, s[2] - z) < 12).length;
    windows.push({ count: count(out), old: count(legacy), x, z });
  }
}
const sorted = windows.map(w => w.count).sort((a, b) => a - b);
const contrast = sorted[Math.floor(sorted.length * 0.85)] / Math.max(1, sorted[Math.floor(sorted.length * 0.15)]);
assert.ok(contrast >= 3, 'groves need readable sparse/dense contrast at walking scale');
assert.ok(windows.some(w => w.old >= 3 && w.count <= 1), 'at least one genuine flower gap replaces prior trees');
const isolated = changed.filter(p => out.spots.every(q => p === q || Math.hypot(p[0] - q[0], p[2] - q[2]) >= 7));
assert.ok(isolated.length >= 2, 'retain several isolated trees with visible breathing room');
console.log(JSON.stringify({ pass: true, trees: out.count, near: out.nearCount, batches: out.group.children.length, triangles: triangles(out.group), changed: changed.length, sparseDenseContrast: contrast, flowerGaps: windows.filter(w => w.old >= 3 && w.count <= 1).length, isolatedTrees: isolated.length, measurement: 'deterministic geometry and spatial contracts, not foreground FPS or visual sign-off' }));
