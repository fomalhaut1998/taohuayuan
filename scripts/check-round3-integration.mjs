import assert from 'node:assert/strict';
import { stripRound6Main } from './round6-main-delta.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const world = JSON.parse(read('../src/data/world.json'));
const baseline = JSON.parse(read('../.visual-round3-baseline/src/data/world.json'));
const original = structuredClone(world);
for (const [parent, key] of [[original, 'exploration'], [original.sound, 'samples'], [original.people, 'living'], [original.fauna, 'living']]) delete parent[key];
assert.deepEqual(original, baseline, 'no unrelated gameplay, layout, climate, or sound tuning changes');
assert.ok(world.fauna.living.fastSpeed > world.player.walkSpeed && world.fauna.living.fastSpeed < world.player.runSpeed, 'normal walking must not count as rushing');
assert.ok(world.exploration.maxTriangles <= 4500);
assert.ok(world.sound.samples.maxConcurrent <= 6 && world.sound.samples.maxVoices <= 2);
assert.ok(world.sound.samples.maxAmbientVoices <= 1 && world.sound.samples.maxDecodedBytes <= 48 * 1024 * 1024);
const main = stripRound6Main(read('../src/main.js'));
const at = text => { const i = main.indexOf(text); assert.ok(i >= 0, text); return i; };
assert.ok(at('const boats = createBoats(') < at('const exterior = createExteriorExploration('));
assert.ok(at('const exterior = createExteriorExploration(') < at('const colliders ='));
assert.ok(at('const colliders =') < at('const barrier = createBarrier(colliders)'));
assert.ok(main.includes('villageLife.blockers, exterior.blockers)'));
assert.ok(main.includes('for (const spot of exterior.layout.stops)'));
assert.ok(main.includes('radius: spot.quietRadius, name: spot.name'));
assert.ok(at('scene.add(exterior.group)') < at('const staticVisibility = optimizeStaticVisibility(scene'));
assert.ok(main.includes('createFauna(world.fauna, terrain.field, sound, habitatContext)'));
assert.ok(main.includes('playerSpeed = Math.hypot(player.state.vx, player.state.vz)'));
assert.ok(main.includes('fauna.update(dt, elapsed, player.state.x, player.state.z, livingContext)'));
assert.ok(main.includes('people.update(dt, elapsed, player.state.x, player.state.z, livingContext)'));
assert.ok(at('sound.update(0, elapsed, camera, player.state, true)') < at('elapsed += dt;'));
assert.ok(main.includes('sound.update(dt, elapsed, camera, player.state, false)'));
const scene = new THREE.Scene(), root = new THREE.Group(); root.name = 'exterior-exploration'; scene.add(root);
const meshes = [];
for (const suffix of ['ground', 'solid', 'botanical', 'water']) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.clearGroups(); // Real baked exterior batches have one material and no draw groups.
  const colors = new Float32Array(geometry.attributes.position.count * 3).fill(0.5);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'exterior-exploration-' + suffix; root.add(mesh); meshes.push(mesh);
}
const transparent = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.5 }));
transparent.name = 'exterior-exploration-solid'; root.add(transparent); meshes.push(transparent);
const visibility = optimizeStaticVisibility(scene);
assert.equal(visibility.entries.length, 3, 'only three exact audited opaque baked names are eligible');
visibility.dispose();
for (const mesh of meshes) { assert.ok(mesh.geometry.attributes.position); mesh.geometry.dispose(); mesh.material.dispose(); }
console.log('PASS round3 integration: additive configuration, real walk/run threshold, shared collision/quiet/contexts/pause, exact static eligibility');
