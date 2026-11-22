import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createContactShadows } from '../src/systems/contact-shadows.js';

// A distant actor must not sample terrain merely to discover its patch is out of range.
let groundSamples = 0;
const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 3, 0);
const sky = { timeId: 'day', rainIntensity: 0 };
const far = createContactShadows({ camera, sky, sampleGround() { groundSamples++; return 2; },
  actors: Array.from({ length: 160 }, (_, i) => ({ id: 'far-' + i, x: 500 + i, y: 2, z: 500, yaw: .2 })) });
far.update(1 / 60, 0);
assert.equal(far.getStats().actorTargets, 160, 'metadata budget unchanged');
assert.equal(far.getStats().actorInstances, 0);
assert.equal(groundSamples, 0, 'off-range actors are rejected before terrain queries');
far.dispose();

const owner = new THREE.Group();
const roots = Array.from({ length: 256 }, (_, i) => [(i % 16 - 8) * 7, 2, (Math.floor(i / 16) - 8) * 7]);
const actors = Array.from({ length: 48 }, (_, i) => ({ id: 'person-' + i, x: i - 24, y: 2, z: i % 9, yaw: i * .1, s: .9 }));
const out = createContactShadows({ camera, sky, field: { half: 800, sample: () => 2 }, flora: { group: owner, spots: roots }, actors });
const meshes = out.group.children.filter(o => o.isInstancedMesh);
const buffers = meshes.map(o => [o.instanceMatrix.array, ...['inkWeight', 'inkSeed', 'inkCorners'].map(k => o.geometry.attributes[k].array)]);
const modes = ['dawn', 'day', 'dusk', 'night'];
let firstMs = 0, lastMs = 0;
for (let f = 0; f < 36000; f++) {
  sky.timeId = modes[Math.floor(f / 9000)]; sky.rainIntensity = f % 4800 < 2400 ? 0 : .7;
  camera.position.x = Math.sin(f / 1200) * 35;
  actors[0].x = Math.cos(f / 240) * 25;
  owner.visible = f % 1200 < 1100;
  const start = f < 3600 || f >= 32400 ? performance.now() : 0;
  out.update(1 / 60, f / 60, camera, sky);
  if (f < 3600) firstMs += performance.now() - start;
  if (f >= 32400) lastMs += performance.now() - start;
}
for (let i = 0; i < meshes.length; i++) {
  const m = meshes[i];
  assert.equal(m.instanceMatrix.array, buffers[i][0], 'matrix allocation remains fixed');
  for (let k = 0; k < 3; k++) assert.equal(m.geometry.attributes[['inkWeight', 'inkSeed', 'inkCorners'][k]].array, buffers[i][k + 1], 'attribute allocation remains fixed');
  assert.ok(m.instanceMatrix.array.every(Number.isFinite));
}
const before = JSON.stringify(out.getStats());
out.update(0, 1e9); assert.equal(JSON.stringify(out.getStats()), before, 'pause does not accumulate catch-up');
const stats = out.getStats(); assert.equal(stats.updates, 36000);
assert.ok(stats.staticInstances <= stats.maxStaticInstances && stats.actorInstances <= stats.maxActorInstances);
out.dispose();
console.log(JSON.stringify({ pass: true, simulatedMinutes: 10, frames: 36000, distantActorGroundSamples: groundSamples, firstMinuteMsPerUpdate: firstMs / 3600, lastMinuteMsPerUpdate: lastMs / 3600, statistics: 'CPU simulation, not foreground FPS' }));
