import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Heightfield } from '../src/player/collision.js';
import { createContactShadows, sampleContactGround, inkContactFalloff } from '../src/systems/contact-shadows.js';

const cfg = JSON.parse(readFileSync(new URL('../src/data/ink-grounding.json', import.meta.url), 'utf8'));
const flat = { half: 100, sample: () => 2 };
const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 3, 0);
const sky = { timeId: 'day', rainIntensity: 0 };
const actor = { id: 'walker', kind: 'person', x: 1, y: 2, z: 1, yaw: 0 };
const treeOwner = new THREE.Group(), peopleOwner = new THREE.Group();
const flora = { group: treeOwner, spots: [[0, 2, 0], [5, 2, 0], [500, 2, 0]] };
const village = { group: new THREE.Group(), houseInfo: [{ x: 3, z: 6, gy: 2, w: 4, d: 4, rot: .3 }] };
const people = { group: peopleOwner, list: [{ x: 2, z: 1, yaw: .2, s: .8, poseReady: true }] };
const fauna = { group: new THREE.Group(), animals: [{ kind: 'ox', x: 1, y: 2, z: -2, lift: 0, yaw: 0 }] };
let buffalo = { x: -3, y: 2.29, z: 0, yaw: .4, mode: 'dusk-return' };
const homestead = { group: new THREE.Group(), getBuffaloState: () => buffalo, getInteractables: () => [] };
const ctx = { field: flat, camera, sky, flora, village, people, fauna, homestead, actors: [actor] };
const beforeSources = JSON.stringify({ spots: flora.spots, houses: village.houseInfo, people: people.list, animals: fauna.animals });
const out = createContactShadows(ctx), again = createContactShadows(ctx);
const tick = o => o.update(1 / 60, 123, camera, sky);
tick(out); tick(again);
const meshes = o => o.group.children.filter(m => m.isInstancedMesh);
const actorMesh = o => meshes(o).find(m => m.name === 'ink-contact-actors');
const staticMesh = o => meshes(o).find(m => m.name === 'ink-contact-static');
const snapshot = o => ({ stats: o.getStats(), buffers: meshes(o).map(m => ({ count: m.count, visible: m.visible, version: m.instanceMatrix.version, matrices: Array.from(m.instanceMatrix.array), weights: Array.from(m.geometry.attributes.inkWeight.array) })), uniforms: meshes(o)[0].material.uniforms.uStrength.value });
assert.deepEqual(snapshot(out), snapshot(again), 'same metadata yields deterministic matrices, weights, counts and strengths');
assert.equal(meshes(out).length, 2, 'exactly two owned batches, never one mesh per target');
assert.ok(out.getStats().staticInstances >= 6, 'tree roots and four house supports are actually shadowed');
assert.ok(out.getStats().actorInstances >= 10, 'people, generic actors, ox and buffalo use support-point shadows');
assert.ok(out.getStats().drawCalls <= 2);
assert.ok(!out.blockers && !out.targets, 'visual-only factory exports no collider/observation targets');
for (const mesh of meshes(out)) {
  assert.equal(mesh.material.depthWrite, false); assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
  assert.equal(mesh.material.forceSinglePass, true, 'transparent double-sided patches must not silently become four real draws');
  assert.ok(mesh.instanceMatrix.array.every(Number.isFinite), 'all allocated matrices finite, including unused slots');
  assert.ok(mesh.geometry.attributes.inkWeight.array.every(Number.isFinite));
  const hits = []; mesh.raycast(new THREE.Raycaster(), hits); assert.equal(hits.length, 0);
}
assert.equal(JSON.stringify({ spots: flora.spots, houses: village.houseInfo, people: people.list, animals: fauna.animals }), beforeSources);
assert.ok(inkContactFalloff(0, 0) > inkContactFalloff(.45, 0));
assert.ok(inkContactFalloff(.45, 0) > inkContactFalloff(.9, 0));
assert.equal(inkContactFalloff(1, 0), 0); assert.equal(inkContactFalloff(2, 2), 0);
assert.ok(meshes(out)[0].material.fragmentShader.includes('smoothstep'), 'actual soft ink alpha is in the shader, not a solid polygon');
const frozen = snapshot(out); actor.x = 12; sky.timeId = 'night'; sky.rainIntensity = 1; camera.position.x = 300;
out.update(0, 1e9, camera, sky); assert.deepEqual(snapshot(out), frozen, 'dt=0 freezes matrices, culling, uniforms, stats and buffer versions');
out.update(-1, 1e9, camera, sky); assert.deepEqual(snapshot(out), frozen);
camera.position.x = 0; tick(out); const night = out.getStats().strength;
sky.timeId = 'day'; sky.rainIntensity = 0; tick(out); const day = out.getStats().strength;
sky.rainIntensity = 1; tick(out); assert.ok(night < out.getStats().strength && out.getStats().strength < day, 'night/rain/day follow existing sky');
sky.rainIntensity = 0;
const control = createContactShadows(ctx);
// Match positive update counts (including buffer versions), vary only wall elapsed.
for (let i = 0; i < out.getStats().updates; i++) control.update(1 / 60, -1e6, camera, sky);
const resumed = snapshot(out); tick(out); control.update(1 / 60, 1e9, camera, sky);
assert.deepEqual(snapshot(out), snapshot(control), 'wall elapsed never produces catch-up motion or drifting ink');
assert.ok(resumed.stats.actorInstances > 0);
peopleOwner.visible = false; treeOwner.visible = false; tick(out);
assert.ok(out.getStats().actorInstances < control.getStats().actorInstances, 'owner-hidden people rejected');
assert.ok(out.getStats().staticInstances < control.getStats().staticInstances, 'owner-hidden trees rejected');
peopleOwner.visible = true; treeOwner.visible = true;

// One actor only: hidden / flying / invalid / submerged roots never paint a phantom patch.
const solo = createContactShadows({ field: flat, actors: [actor], camera, sky }); tick(solo); assert.equal(actorMesh(solo).count, 2);
for (const change of [{ visible: false }, { y: 9 }, { flying: true }, { submerged: true }, { x: NaN }]) {
  const saved = { ...actor }; Object.assign(actor, change); tick(solo); assert.equal(actorMesh(solo).count, 0, JSON.stringify(change));
  for (const key of Object.keys(actor)) delete actor[key]; Object.assign(actor, saved);
}
const wet = createContactShadows({ field: flat, actors: [actor], camera, sky, waterAt: () => 2.2 }); tick(wet); assert.equal(wet.getStats().actorInstances, 0);
const puddle = createContactShadows({ field: flat, actors: [actor], camera, sky, world: { terrain: { waterLevel: 0, pond: { x: actor.x, z: actor.z, radius: 3, waterY: 2.2 } } } }); tick(puddle); assert.equal(puddle.getStats().actorInstances, 0);
buffalo = { ...buffalo, y: 9 }; tick(out); assert.ok(out.getStats().actorInstances < control.getStats().actorInstances, 'high buffalo state rejected');

// Parent communityLife.getInteractables merges homestead sources: never double-stamp a person.
const sharedPerson = { id: 'homestead-weaver', x: 0, y: 2, z: 0, yaw: 0 };
const duplicate = createContactShadows({ field: flat, camera, sky, homestead: { getInteractables: () => [sharedPerson] }, actors: () => [sharedPerson, { ...sharedPerson }] });
tick(duplicate); assert.equal(duplicate.getStats().actorInstances, 2, 'same actor from homestead plus merged community metadata only casts once'); duplicate.dispose();

// Review regressions reconstruct the actual vertex contract and inspect primitive INTERIORS.
// The grid branch is controlled by a real shader uniform; the legacy branch reproduces the old patch.
const reviewCase = process.env.CONTACT_REVIEW_CASE, reviewMetrics = [];
function renderedHeight(field, x, z) {
  const n = field.segments, gx = Math.max(0, Math.min(n, (x + field.half) / field.step)), gz = Math.max(0, Math.min(n, (z + field.half) / field.step));
  const ix = Math.min(n - 1, Math.floor(gx)), iz = Math.min(n - 1, Math.floor(gz)), u = gx - ix, v = gz - iz, i = iz * (n + 1) + ix;
  const [a, b, c, d] = [field.heights[i], field.heights[i + 1], field.heights[i + n + 1], field.heights[i + n + 2]];
  return u + v <= 1 ? a * (1 - u - v) + b * u + c * v : d * (u + v - 1) + b * (1 - v) + c * (1 - u);
}
function checkPrimitiveInteriors(field, root, label) {
  const o = createContactShadows({ field, staticTargets: [root], camera, sky }); tick(o);
  const m = staticMesh(o); assert.equal(m.count, 1, label + ' has one support mark');
  const transform = new THREE.Matrix4(); m.getMatrixAt(0, transform);
  const e = transform.elements, attrs = m.geometry.attributes.position, index = m.geometry.index;
  const gridAligned = m.material.uniforms.uGridAligned?.value === 1;
  const f = m.material.uniforms.uField.value, textureField = { half: f.x, step: f.y, segments: f.z, heights: m.material.uniforms.uHeights.value.image.data };
  const vertices = Array.from({ length: attrs.count }, (_, i) => {
    const p = new THREE.Vector3().fromBufferAttribute(attrs, i).applyMatrix4(transform);
    if (gridAligned) {
      const f = m.material.uniforms.uField.value;
      const gx = Math.max(0, Math.min(f.z, Math.floor((e[12] + f.x) / f.y + .5) + attrs.getX(i)));
      const gz = Math.max(0, Math.min(f.z, Math.floor((e[14] + f.x) / f.y + .5) + attrs.getZ(i)));
      p.set(gx * f.y - f.x, 0, gz * f.y - f.x);
    }
    p.y = renderedHeight(textureField, p.x, p.z) + m.material.uniforms.uGroundOffset.value; return p;
  });
  let samples = 0, maxError = 0, expectedInkPoints = 0, coveredInkPoints = 0;
  for (let iu = -4; iu <= 4; iu++) for (let iv = -4; iv <= 4; iv++) {
    const u = iu / 5, v = iv / 5; if (u * u + v * v >= .95) continue;
    const x = e[12] + e[0] * u + e[8] * v, z = e[14] + e[2] * u + e[10] * v;
    expectedInkPoints++; let covered = false;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [vertices[index.getX(i)], vertices[index.getX(i + 1)], vertices[index.getX(i + 2)]];
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(det) < 1e-9) continue;
      const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
      const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det, wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) < -1e-6) continue;
      const drawn = wa * a.y + wb * b.y + wc * c.y, expected = renderedHeight(field, x, z) + cfg.groundOffset;
      maxError = Math.max(maxError, Math.abs(drawn - expected)); samples++; covered = true;
    }
    if (covered) coveredInkPoints++;
  }
  assert.equal(coveredInkPoints, expectedInkPoints, label + ' covers the entire visible ellipse, not a few lucky vertices');
  assert.ok(samples > 30, label + ' checks visible ink interiors, not just vertices');
  assert.ok(maxError < 1e-5, label + ': patch interior deviates from real triangle by ' + maxError);
  assert.equal(gridAligned, true, 'actual shader selects aligned terrain-cell topology');
  assert.match(m.material.vertexShader, /if [(]uGridAligned > 0[.]5[)]/);
  assert.match(m.material.vertexShader, /floor[(][(]root[.]xz [+] uField[.]x[)] [/] uField[.]y [+] 0[.]5[)]/);
  assert.match(m.material.vertexShader, /texture2D[(]uHeights, [(]grid [+] 0[.]5[)] [/] uField[.]w[)][.]r/);
  assert.ok(attrs.count <= 81, 'aligned cell stencil still has a fixed small vertex budget');
  assert.ok(o.getStats().drawCalls <= 2 && o.getStats().patchTriangles <= 128);
  reviewMetrics.push({ label, samples, coveredInkPoints, maxError, patchTriangles: o.getStats().patchTriangles });
  o.dispose();
}
if (!reviewCase || reviewCase === 'terrain') {
  checkPrimitiveInteriors(new Heightfield(4, 1, new Float32Array([2, 2, 2, -10])), { kind: 'tree', x: 0, z: 0 }, 'cross-diagonal saddle');
  checkPrimitiveInteriors(new Heightfield(6, 6, Float32Array.from({ length: 49 }, (_, i) => ((i % 7) % 2) * 2 - (Math.floor(i / 7) % 2) * 1.5)), { kind: 'tree', x: .06, z: .07, yaw: .43 }, 'rotated support across cell boundaries');
  checkPrimitiveInteriors(new Heightfield(.4, 8, Float32Array.from({ length: 81 }, (_, i) => ((i % 9) % 2) * .3 - (Math.floor(i / 9) % 2) * .2)), { kind: 'tree', x: .01, z: .01, yaw: .43 }, 'tiny cells cap stencil and shrink mask without losing conformity');
  checkPrimitiveInteriors(new Heightfield(800, 192, Float32Array.from({ length: 193 * 193 }, (_, i) => Math.sin(i * .017) * .3)), { kind: 'tree', x: 3.2, z: -5.4, yaw: 1.1 }, 'current terrain scale uses eight triangles per support');
  assert.equal(reviewMetrics.at(-1).patchTriangles, 8, 'current 800m/192-cell terrain reduces old 18-triangle patches to eight aligned triangles');
}
if (!reviewCase || reviewCase === 'bird') {
  const bird = { kind: 'bird', x: 0, y: 2, z: 0, yaw: .4, lift: .04, mode: 'flush' };
  const flying = createContactShadows({ field: flat, fauna: { animals: [bird], group: new THREE.Group() }, camera, sky });
  tick(flying); assert.equal(flying.getStats().actorInstances, 0, 'real bird mode=flush rejects even low take-off lift without a flying boolean');
  bird.lift = .02; tick(flying); assert.equal(flying.getStats().actorInstances, 0, 'low landing lift remains in flight until real mode returns idle');
  bird.mode = 'idle'; bird.lift = 0; tick(flying); assert.ok(flying.getStats().actorInstances > 0, 'grounded bird regains contact');
  bird.kind = 'hen'; bird.mode = 'flush'; bird.lift = .12; tick(flying); assert.ok(flying.getStats().actorInstances > 0, 'do not classify a low terrestrial hop as bird flight');
  flying.dispose();
}
if (!reviewCase || reviewCase === 'heading') {
  const qh = { id: 'qh-weaver', x: 1, y: 2, z: 0, facing: 1.7, greetUntil: 99, greetX: -2, greetZ: 3, s: 1 };
  const community = { id: 'community-washer', x: -1, y: 2, z: 0, s: .9 };
  const roots = createContactShadows({ field: flat, homestead: { getInteractables: () => [qh] }, actors: [community], camera, sky }); tick(roots);
  assert.equal(roots.getStats().actorInstances, 2, 'facing-only and absent-yaw metadata each degrade to ONE root ellipse, not invented feet');
  const m = actorMesh(roots), pose = new THREE.Matrix4(); m.getMatrixAt(0, pose);
  assert.ok(Math.abs(pose.elements[12] - qh.x) < 1e-6 && Math.abs(pose.elements[14] - qh.z) < 1e-6, 'root fallback stays at true actor position');
  m.getMatrixAt(1, pose); assert.ok(Math.abs(pose.elements[12] - community.x) < 1e-6 && Math.abs(pose.elements[14] - community.z) < 1e-6);
  roots.dispose();
}

// A saddle cell differs from bilinear physics: use the visible PlaneGeometry diagonal.
const heights = new Float32Array([0, 0, 0, 4]);
const saddle = new Heightfield(4, 1, heights);
assert.equal(sampleContactGround(saddle, -1, -1), 0);
assert.equal(sampleContactGround(saddle, 1, 1), 2);
assert.equal(sampleContactGround(saddle, 2, 2), 4, 'closed outer terrain vertex is a real visual support, not out-of-field');
assert.equal(sampleContactGround(saddle, 5, 0), null, 'out-of-field shadows rejected');
const slope = new Heightfield(12, 4, Float32Array.from({ length: 25 }, (_, i) => (i % 5 - 2) * .45 + (Math.floor(i / 5) - 2) * .21));
const slopeRoot = { kind: 'tree', x: .3, z: .4 };
const slopeOut = createContactShadows({ field: slope, staticTargets: [slopeRoot], camera, sky }); tick(slopeOut);
const sm = staticMesh(slopeOut), matrix = new THREE.Matrix4(); sm.getMatrixAt(0, matrix);
assert.ok(Math.abs(matrix.elements[13] - sampleContactGround(slope, matrix.elements[12], matrix.elements[14]) - cfg.groundOffset) < 1e-5);
assert.ok(sm.material.vertexShader.includes('sampleGroundTriangle'), 'drawn vertices sample the actual terrain triangles, not a floating flat quad');
const texture = sm.material.uniforms.uHeights.value;
assert.ok(texture.isDataTexture && texture.image.data !== slope.heights, 'owns its height copy, not external geometry');
assert.deepEqual(Array.from(texture.image.data), Array.from(slope.heights));
assert.ok(sm.geometry.attributes.position.count <= 81, 'small shared tessellated patch, not high-poly target geometry');
const customGround = createContactShadows({ field: { half: 20, sample: () => -10 }, sampleGround: (x, z) => .1 * x + .2 * z, staticTargets: [{ x: 0, z: 0, kind: 'tree' }], camera, sky }); tick(customGround);
assert.equal(customGround.getStats().staticInstances, 1, 'reliable explicit visual-ground callback supported');

// Current metadata arrays can be large: GPU capacity and per-frame input work are hard bounded.
const budget = createContactShadows({ field: flat, camera, sky, staticTargets: Array.from({ length: 10000 }, (_, i) => ({ x: i % 20, z: Math.floor(i / 20) % 20, kind: 'tree' })), actors: Array.from({ length: 500 }, () => ({ x: 0, y: 2, z: 0, kind: 'person' })), config: { maxStaticInstances: 12, maxActorInstances: 10, maxStaticTargets: 100, maxActorTargets: 16 } });
tick(budget); assert.equal(staticMesh(budget).count, 12); assert.equal(actorMesh(budget).count, 10);
assert.ok(budget.getStats().staticTargets <= 100 && budget.getStats().actorTargets <= 16);
camera.position.set(400, 3, 400); tick(budget); assert.equal(budget.getStats().drawCalls, 0); camera.position.set(0, 3, 0);
const malicious = createContactShadows({ field: flat, camera, sky, staticTargets: [{ x: 0, z: 0, kind: 'tree' }, { x: Infinity, z: 0 }], config: { maxStaticInstances: Infinity, maxActorInstances: NaN, groundOffset: NaN } }); tick(malicious);
assert.ok(malicious.getStats().staticInstances <= cfg.maxStaticInstances);
assert.ok(meshes(malicious).every(m => m.instanceMatrix.array.every(Number.isFinite)));

// Dispose only owned resources exactly once; source scene/resources remain intact.
let disposed = 0, externalDisposed = 0;
const externalGeometry = new THREE.BoxGeometry(); externalGeometry.addEventListener('dispose', () => externalDisposed++);
const externalMaterial = new THREE.MeshBasicMaterial(); externalMaterial.addEventListener('dispose', () => externalDisposed++);
village.group.add(new THREE.Mesh(externalGeometry, externalMaterial));
const owned = new Set([texture]); for (const m of meshes(slopeOut)) { owned.add(m.geometry); owned.add(m.material); }
for (const resource of owned) resource.addEventListener('dispose', () => disposed++);
const parent = new THREE.Group(); parent.add(slopeOut.group); slopeOut.dispose(); slopeOut.dispose();
assert.equal(disposed, owned.size); assert.equal(slopeOut.group.parent, null); assert.equal(slopeOut.group.children.length, 0);
const disposedSnap = slopeOut.getStats(); slopeOut.update(1, 1e6, camera, sky); assert.deepEqual(slopeOut.getStats(), disposedSnap);
assert.equal(externalDisposed, 0); assert.ok(village.group.children.length === 1);
for (const o of [out, again, control, solo, wet, puddle, customGround, budget, malicious]) o.dispose();
assert.equal(JSON.stringify({ spots: flora.spots, houses: village.houseInfo, people: people.list, animals: fauna.animals }), beforeSources, 'all imported metadata untouched');
externalGeometry.dispose(); externalMaterial.dispose();
const source = readFileSync(new URL('../src/systems/contact-shadows.js', import.meta.url), 'utf8');
assert.ok(!/shadowMap|WebGLRenderTarget|EffectComposer|requestAnimationFrame|Math[.]random|console[.]log/.test(source), 'no forbidden renderer work, random layout or loops');
console.log('PASS contact shadows: deterministic adapters, 2 batches, soft ink, exact terrain-interior coverage, real flight/heading guards, freeze, budgets and owned disposal');
if (reviewMetrics.length) console.log('INTERIOR_METRICS ' + JSON.stringify(reviewMetrics));
