import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createHinterland } from '../src/world/hinterland.js';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
// Only canvas painting is stubbed; use the actual world/layout/geometry/material data.
const context = new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) },
  { get: (target, key) => target[key] ?? (() => {}) });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const distance = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points), 160));
const terrain = createTerrain(world.terrain, distance, { road: world.village.road, pond: world.terrain.pond });
const village = createVillage(world.village, terrain.field, world.terrain.pond);
const props = createProps(world.props, terrain.field, village.houseInfo, village.plots, village.road);
const cliff = createCliff(world.cliff, terrain.field);
const hinterland = createHinterland(world.hinterland, terrain.field, distance, world, village, props, cliff);
const meshes = [...hinterland.group.children];
const originals = new Map(meshes.map(mesh => [mesh, {
  material: mesh.material, geometry: mesh.geometry, count: mesh.count, raycast: mesh.raycast,
  matrices: mesh.instanceMatrix?.array.slice(), colors: mesh.instanceColor?.array.slice(),
  attributes: Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, attr]) => [name, attr.array.slice()]))
}]));
const hash = createHash('sha256');
for (const key of ['trees', 'bamboo', 'structures', 'paths', 'rejected', 'blockers']) hash.update(JSON.stringify(hinterland[key]));
for (const mesh of meshes) {
  hash.update(mesh.name + ':' + mesh.count);
  for (const attr of Object.values(mesh.geometry.attributes)) hash.update(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength));
  for (const attr of [mesh.geometry.index, mesh.instanceMatrix, mesh.instanceColor]) if (attr) hash.update(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength));
}
const fingerprint = hash.digest('hex');
console.log(JSON.stringify({ fixtureFingerprint: fingerprint, batches: meshes.length }));

function checkColorContract(mesh) {
  const { geometry, material } = mesh;
  const colors = geometry.getAttribute('color');
  // USE_COLOR is selected by material.vertexColors, NOT by presence of the attribute.
  // It multiplies USE_INSTANCING_COLOR; an absent color input is not neutral white.
  if (material.vertexColors) {
    assert.ok(colors, mesh.name + ': vertexColors requires a geometry color attribute (instanceColor is separate)');
    assert.ok(colors.itemSize === 3 || colors.itemSize === 4, mesh.name + ': RGB/RGBA vertices');
    assert.equal(colors.count, geometry.attributes.position.count, mesh.name + ': complete vertex colors');
    assert.ok(colors.array.every(Number.isFinite), mesh.name + ': finite vertex colors');
  }
  if (mesh.isInstancedMesh) {
    assert.ok(mesh.instanceColor, mesh.name + ': explicit per-instance palette');
    assert.equal(mesh.instanceColor.itemSize, 3);
    assert.ok(mesh.instanceColor.count >= mesh.count);
    // Check actual shader multiplicands, not only the material flag or palette strings.
    const vertex = new THREE.Color(), instance = new THREE.Color();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getColorAt(i, instance);
      assert.ok([instance.r, instance.g, instance.b].every(v => Number.isFinite(v) && v > 0), mesh.name + ': nonblack finite instance tint');
      for (let k = 0; k < geometry.attributes.position.count; k++) {
        vertex.setRGB(1, 1, 1);
        if (material.vertexColors) vertex.setRGB(colors.getX(k), colors.getY(k), colors.getZ(k));
        vertex.multiply(instance).multiply(material.color);
        assert.ok([vertex.r, vertex.g, vertex.b].every(v => Number.isFinite(v) && v > 0), mesh.name + ': nonblack effective vertex/instance/material albedo');
      }
    }
  }
}

// A deliberately broken fixture proves that this guard rejects the original contract.
const broken = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 1);
broken.name = 'missing-color';
broken.setColorAt(0, new THREE.Color('#956E49'));
assert.throws(() => checkColorContract(broken), /vertexColors requires a geometry color attribute/);
broken.geometry.dispose(); broken.material.dispose(); broken.dispose();
for (const mesh of meshes) checkColorContract(mesh);

// Evaluate the exact pre-fix generator with the SAME current geometry dependency.
// Rebase its two imports in memory; the visual baseline on disk stays untouched.
const baselineSource = readFileSync(new URL('../.visual-round2-baseline/src/world/hinterland.js', import.meta.url), 'utf8')
  .replace("from 'three'", 'from ' + JSON.stringify(import.meta.resolve('three')))
  .replace("from './model-geometry.js'", 'from ' + JSON.stringify(new URL('../src/world/model-geometry.js', import.meta.url).href));
const { createHinterland: createOriginalHinterland } = await import('data:text/javascript;base64,' + Buffer.from(baselineSource).toString('base64'));
const original = createOriginalHinterland(world.hinterland, terrain.field, distance, world, village, props, cliff);
const originalFailures = [];
for (const mesh of original.group.children) {
  try { checkColorContract(mesh); } catch (error) { originalFailures.push(mesh.name); }
}
assert.deepEqual(originalFailures.sort(), ['hinterland-beam', 'hinterland-box', 'hinterland-fruit'], 'real original generator reproduces exactly the three invalid primitive batches');
for (const key of ['trees', 'bamboo', 'structures', 'paths', 'rejected', 'blockers']) assert.deepEqual(hinterland[key], original[key], key + ': original RNG/layout/collision API preserved');
assert.equal(meshes.length, original.group.children.length, 'no extra draw batches');
for (const mesh of meshes) {
  const before = original.group.getObjectByName(mesh.name);
  assert.equal(mesh.count, before.count, mesh.name + ': original instance count');
  assert.deepEqual(Object.keys(mesh.geometry.attributes), Object.keys(before.geometry.attributes));
  for (const [name, attr] of Object.entries(mesh.geometry.attributes)) assert.deepEqual(attr.array, before.geometry.attributes[name].array, mesh.name + ': unchanged ' + name);
  assert.deepEqual(mesh.geometry.index?.array, before.geometry.index?.array, mesh.name + ': unchanged index');
  assert.deepEqual(mesh.instanceMatrix?.array, before.instanceMatrix?.array, mesh.name + ': unchanged transforms');
  assert.deepEqual(mesh.instanceColor?.array, before.instanceColor?.array, mesh.name + ': unchanged instance palette');
  assert.equal(mesh.material.flatShading, before.material.flatShading);
  assert.equal(mesh.material.side, before.material.side);
  assert.equal(mesh.material.transparent, before.material.transparent);
  assert.deepEqual(mesh.material.color, before.material.color);
}

// Preserve crown face shading; disabling vertexColors everywhere is not a valid fix.
for (const mesh of meshes.filter(mesh => mesh.name.startsWith('hinterland-crown'))) {
  assert.equal(mesh.material.vertexColors, true, 'crowns keep their baked face shading');
  const values = mesh.geometry.attributes.color.array;
  assert.ok(values.some(v => v !== values[0]), 'crown shading is nonuniform');
}
function checkPalette(name, keys) {
  const mesh = hinterland.group.getObjectByName('hinterland-' + name), tint = new THREE.Color();
  for (const key of keys) {
    const expected = new THREE.Color(world.hinterland.palette[key]);
    assert.ok(Array.from({ length: mesh.count }, (_, i) => {
      mesh.getColorAt(i, tint);
      return Math.max(Math.abs(tint.r - expected.r), Math.abs(tint.g - expected.g), Math.abs(tint.b - expected.b)) < 1e-7;
    }).some(Boolean), name + ': retain configured ' + key + ' palette');
  }
}
checkPalette('beam', ['bark', 'bamboo', 'bambooNode', 'wood', 'straw']);
checkPalette('box', ['thatch', 'straw', 'wood']);
checkPalette('fruit', ['gourd']);

const scene = new THREE.Scene(); scene.add(hinterland.group);
const helper = optimizeStaticVisibility(scene);
assert.equal(helper.entries.length, meshes.filter(mesh => mesh.isInstancedMesh).length, 'same instance batches remain eligible');
const camera = new THREE.OrthographicCamera(-400, 400, 400, -400, 0.1, 2000);
camera.position.set(0, 500, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
let renderedInstances = 0, compacted = false;
function verifyProxyData() {
  for (const entry of helper.entries) {
    const saved = originals.get(entry.source), proxy = entry.proxy;
    assert.equal(proxy.geometry, saved.geometry, 'proxy retains all geometry attributes');
    assert.equal(proxy.material, saved.material, 'proxy retains the correct material variant');
    if (proxy.visible) checkColorContract(proxy);
    for (let i = 0; i < proxy.count; i++) {
      const sourceIndex = entry.indices[i];
      assert.deepEqual(proxy.instanceMatrix.array.subarray(i * 16, i * 16 + 16), saved.matrices.subarray(sourceIndex * 16, sourceIndex * 16 + 16), 'compaction preserves source matrix/ID mapping');
      assert.deepEqual(proxy.instanceColor.array.subarray(i * 3, i * 3 + 3), saved.colors.subarray(sourceIndex * 3, sourceIndex * 3 + 3), 'compaction preserves source tint/ID mapping');
      if (proxy.visible) renderedInstances++;
    }
    compacted ||= proxy.count > 0 && proxy.count < entry.source.count;
  }
}
helper.render({ render: verifyProxyData }, camera);
for (const entry of helper.entries) assert.equal(entry.proxy.count, entry.source.count, 'wide camera covers every instance');
const view = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 120);
for (const site of [hinterland.trees[0], hinterland.bamboo[0], ...hinterland.structures]) {
  view.position.set(site.x + 12, site.y + 5, site.z + 12); view.lookAt(site.x, site.y + 2, site.z);
  helper.render({ render: verifyProxyData }, view);
}
assert.ok(compacted, 'exercise real culling, not only identity copies');
assert.ok(renderedInstances > 0, 'proxy color checks actually ran');
helper.dispose();
for (const mesh of meshes) {
  const saved = originals.get(mesh);
  assert.equal(mesh.material, saved.material); assert.equal(mesh.geometry, saved.geometry);
  assert.equal(mesh.count, saved.count); assert.equal(mesh.raycast, saved.raycast);
  assert.equal(mesh.children.length, 0, 'owned proxies removed');
  if (saved.matrices) assert.deepEqual(mesh.instanceMatrix.array, saved.matrices);
  if (saved.colors) assert.deepEqual(mesh.instanceColor.array, saved.colors);
  for (const [name, array] of Object.entries(saved.attributes)) assert.deepEqual(mesh.geometry.attributes[name].array, array);
}
console.log(JSON.stringify({ result: 'PASS', fingerprint, originalFailures, batches: meshes.length, renderedInstances, compacted }));

// Optional diagnostic only: report, never silently repair unrelated generators.
if (process.argv.includes('--scan-world')) {
  const [{ createFlora }, { createScatter }, { createVillageScenes }, { createMysteries }, { createVillageLife }, { createPeople }, { createFish }, { createBoats }] = await Promise.all([
    import('../src/world/flora.js'), import('../src/world/scatter.js'), import('../src/world/village-scenes.js'),
    import('../src/world/mysteries.js'), import('../src/world/village-life.js'), import('../src/world/people.js'),
    import('../src/world/fish.js'), import('../src/world/boats.js')
  ]);
  const curve = createRiverCurve(world.stream.points);
  const flora = createFlora(world.flora, terrain.field, distance, curve, world.player.spawn, x => x > 0);
  const scatter = createScatter(world.scatter, terrain.field, () => false, world.village.road);
  const scenes = createVillageScenes(world, terrain.field, distance, village, props, cliff, hinterland);
  const mysteries = createMysteries(world, terrain.field, distance, village, props, cliff, hinterland, scenes, flora);
  const life = createVillageLife(world, terrain.field, distance, village, props, cliff, hinterland, scenes, mysteries);
  const people = createPeople(world.people, terrain.field, village.houseInfo, village.road, village.plots, [...cliff.blockers, ...village.blockers, ...hinterland.blockers]);
  // Only geometry/material construction is inspected; the animation surface is unused.
  const stream = { surfaceY: () => world.terrain.waterLevel };
  const fish = createFish(world.fish, world.stream, world.terrain, curve, stream);
  const boats = createBoats(world.boats, stream, world.terrain, curve, terrain.field);
  const findings = []; let scanned = 0;
  for (const [name, root] of [['terrain', terrain.mesh], ['village', village.group], ['props', props.group], ['cliff', cliff.group], ['hinterland', hinterland.group], ['flora', flora.group], ['scatter', scatter.group], ['scenes', scenes.group], ['mysteries', mysteries.group], ['life', life.group], ['people', people.group], ['fish', fish.group], ['boats', boats.group]]) {
    root.traverse(mesh => {
      if (!mesh.isMesh && !mesh.isPoints) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        scanned++;
        if (material.vertexColors && !mesh.geometry.getAttribute('color')) findings.push({ generator: name, mesh: mesh.name, type: material.type, instanced: !!mesh.isInstancedMesh });
      }
    });
  }
  console.log(JSON.stringify({ scan: 'vertexColors-requires-color', scanned, findings }));
}
