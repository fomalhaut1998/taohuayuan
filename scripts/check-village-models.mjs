import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { foliageGeometry, openVesselGeometry, hayGeometry } from '../src/world/model-geometry.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';

const triangles = g => (g.index?.count ?? g.attributes.position.count) / 3;
function validateGeometry(g, label) {
  for (const name of ['position', 'normal', 'color']) {
    const a = g.getAttribute(name);
    if (!a && name === 'color') continue;
    assert(a, label + ' has ' + name);
    assert.equal(a.count, g.attributes.position.count, label + ' matching attributes');
    for (const v of a.array) assert(Number.isFinite(v), label + ' finite ' + name);
  }
  const normal = g.attributes.normal;
  for (let i = 0; i < normal.count; i++) {
    assert(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < 0.002,
      label + ' unit nondegenerate normals');
  }
  g.computeBoundingBox();
  assert(!g.boundingBox.isEmpty(), label + ' has finite bounds');
}
function hitHeight(geometry, x = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld();
  return new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0))
    .intersectObject(mesh)[0]?.point.y;
}
const vesselBudgets = {};
for (const kind of ['vat', 'basket', 'bucket']) {
  const g = openVesselGeometry(kind);
  validateGeometry(g, kind);
  vesselBudgets[kind] = triangles(g);
  assert(triangles(g) <= 200, kind + ' stays low-poly');
  assert(g.boundingBox.min.y >= 0 && g.boundingBox.max.y <= 1, kind + ' grounded profile');
  const pos = g.attributes.position, normal = g.attributes.normal;
  let inward = 0, outward = 0;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    assert(r <= 0.50001, kind + ' footprint does not grow');
    const radialNormal = pos.getX(i) * normal.getX(i) + pos.getZ(i) * normal.getZ(i);
    if (radialNormal < -0.01) inward++;
    if (radialNormal > 0.01) outward++;
  }
  assert(inward > 20 && outward > 20, kind + ' has outward shell AND inward cavity normals');
  assert(hitHeight(g) < 0.25, kind + ' mouth has no top cap');
  const rimR = kind === 'vat' ? 0.39 : kind === 'basket' ? 0.455 : 0.465;
  assert(hitHeight(g, rimR) > 0.94, kind + ' annular rim faces upward');
}
const hay = hayGeometry();
validateGeometry(hay, 'hay');
assert(triangles(hay) <= 120, 'Hay adds shoulder shaping, not tessellation');
assert(hay.boundingBox.max.y === 1 && hay.boundingBox.min.y === 0);
for (const seed of [9137, 9174, 9211, 9248, 4477]) {
  const g = foliageGeometry(seed);
  validateGeometry(g, 'foliage');
  assert.equal(triangles(g), 48, 'Shared leaf masses have a fixed 48-triangle budget');
  for (let i = 0; i < g.attributes.position.count; i++) {
    const p = g.attributes.position;
    assert(Math.hypot(p.getX(i), p.getZ(i)) <= 0.5, 'Leaf mass remains in old radius');
    const n = g.attributes.normal;
    assert(p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i) > 0,
      'Crown winding faces outward, never inside-out');
  }
  assert.deepEqual(g.attributes.position.array, foliageGeometry(seed).attributes.position.array,
    'Shape seed repeats exactly without a global RNG');
}

// Flat field isolates geometry and seeded placement from terrain configuration.
const context = new Proxy({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  createRadialGradient: () => ({ addColorStop() {} })
}, { get: (target, name) => target[name] ?? (() => {}) });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const world = JSON.parse(fs.readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const field = { sample: () => 0 };
const village = createVillage(structuredClone(world.village), field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const configHash = hash([world.village, world.props]);
const layoutHash = hash([village.houseInfo, village.plots, village.mapMarks, props.marks]);
// Exact pre-edit snapshot: if another worker changes layout config, report that
// coverage gap rather than incorrectly freezing their intentional placement edit.
const baselineChecked = configHash === 'bf36b6776ab199fbcd83d550c57f7167f2927ac062d5ea7085b859001dc6f29f';
if (baselineChecked) assert.equal(layoutHash,
  '857d31447d024bab41ff6c7459504b9836ab94cb7084fccdb53872e96730a217',
  'Model-only changes must preserve the complete pre-edit layout/map marks');
assert.equal(props.group.children.length, 1, 'Props still use a single static draw mesh');
validateGeometry(props.group.children[0].geometry, 'props batch');
const propsMesh = props.group.children[0];
propsMesh.updateMatrixWorld();
for (const mark of props.marks.filter(m => m.kind === 'vat')) {
  const hit = new THREE.Raycaster(new THREE.Vector3(mark.x, 2, mark.z), new THREE.Vector3(0, -1, 0))
    .intersectObject(propsMesh)[0];
  assert(hit && Math.abs(hit.point.y - 0.304) < 0.001, 'Baked vat retains recessed water, not a clay lid');
}
assert(props.tris <= 65000, 'Static props budget stays bounded');
const again = createProps(world.props, field, village.houseInfo, village.plots, village.road);
assert.deepEqual(again.marks, props.marks, 'Placement remains deterministic');
assert.deepEqual(again.group.children[0].geometry.attributes.position.array,
  props.group.children[0].geometry.attributes.position.array, 'Detail geometry repeats too');
for (const m of village.group.children) if (m.geometry) validateGeometry(m.geometry, m.name);
const get = name => village.group.getObjectByName(name);
const bamboo = get('bamboo');
assert(bamboo.isInstancedMesh, 'Bamboo remains one instanced mesh');
const bb = world.village.bamboo, culms = bb.culms ?? 9, segs = bb.segs ?? 5;
const sides = Math.max(5, bb.sides ?? 3), clusters = bb.clusters ?? 4, blades = bb.blades ?? 6;
assert.equal(triangles(bamboo.geometry), culms * (segs * sides * 2 + (segs - 1) * sides * 2 + clusters * blades * 2),
  'Bamboo budget accounts exactly for stems, narrow collars and two-facet blades');
assert(triangles(bamboo.geometry) <= 1200, 'Clump stays near the old 1008-triangle budget');
// Each culm emits its stem, collars, then leaf triangles; check actual tiny blade sizes.
let cursor = 0;
for (let k = 0; k < culms; k++) {
  const p = bamboo.geometry.attributes.position, n = bamboo.geometry.attributes.normal;
  for (let segment = 0; segment < segs; segment++) {
    const start = cursor + segment * sides * 6, center = new THREE.Vector3();
    for (let j = 0; j < sides * 6; j++) center.add(new THREE.Vector3().fromBufferAttribute(p, start + j));
    center.multiplyScalar(1 / (sides * 6));
    for (let j = 0; j < sides * 6; j += 3) {
      const vertex = new THREE.Vector3().fromBufferAttribute(p, start + j);
      const normal = new THREE.Vector3().fromBufferAttribute(n, start + j);
      assert(vertex.sub(center).dot(normal) > 0.02, 'Bamboo culm faces outward, not inside-out');
    }
  }
  cursor += (segs * sides * 2 + (segs - 1) * sides * 2) * 3;
  for (let leaf = 0; leaf < clusters * blades; leaf++) {
    const root = new THREE.Vector3().fromBufferAttribute(p, cursor);
    const tip = new THREE.Vector3().fromBufferAttribute(p, cursor + 2);
    const wing1 = new THREE.Vector3().fromBufferAttribute(p, cursor + 1);
    const wing2 = new THREE.Vector3().fromBufferAttribute(p, cursor + 5);
    assert(root.distanceTo(tip) < 0.65, 'No metre-long bamboo ribbons');
    assert(wing1.distanceTo(wing2) < 0.11, 'Bamboo leaf is narrow and lightly folded');
    cursor += 6;
  }
}
assert.equal(cursor, bamboo.geometry.attributes.position.count);
const core = get('mulberry-core');
assert(core.isInstancedMesh && triangles(core.geometry) === 48, 'Orchard keeps shared 48-face crowns');
assert(get('mulberry-leaves').isInstancedMesh, 'Orchard leaves still share instancing');
const tiles = get('houses-tiles');
assert.equal(village.group.children.filter(m => m.name === 'houses-tiles').length, 1);
assert(!Array.isArray(tiles.material), 'Roof details have only one material/draw');
assert(triangles(tiles.geometry) <= village.houseInfo.length * 560, 'Roof detail per-house budget');
let roofVertex = 0;
for (const hi of village.houseInfo) {
  const hc = world.village.houses, W = hi.w + hc.overhang * 2, D = hi.d + hc.overhang * 2;
  const rows = Math.max(8, Math.round(D / 0.34));
  const courses = Math.max(3, Math.round(Math.hypot(W * 0.5, hc.roofHeight) / 0.85));
  const surfaceCount = rows * courses * 12;
  const count = surfaceCount + 7 * 36, p = tiles.geometry.attributes.position;
  for (let j = 0; j < count; j++, roofVertex++) {
    if (j < surfaceCount) assert(tiles.geometry.attributes.normal.getY(roofVertex) > 0.2,
      'Both roof slopes face upward for front-side rendering');
    const x = p.getX(roofVertex) - hi.x, z = p.getZ(roofVertex) - hi.z;
    const lx = x * Math.cos(hi.rot) - z * Math.sin(hi.rot);
    const lz = x * Math.sin(hi.rot) + z * Math.cos(hi.rot);
    assert(Math.abs(lx) <= W * 0.5 + 0.0001, 'Roof detail stays inside existing x footprint');
    assert(Math.abs(lz) <= D * 0.5 + 0.0001, 'Roof detail stays inside existing z footprint');
    assert(p.getY(roofVertex) <= hi.gy + hi.h - 0.16 + hc.roofHeight + 0.1,
      'Restrained ridge profile, not huge roof ribs');
  }
}
assert.equal(roofVertex, tiles.geometry.attributes.position.count);
console.log(JSON.stringify({ status: 'passed', baselineChecked, configHash, layoutHash,
  vesselTriangles: vesselBudgets, foliageTriangles: 48, hayTriangles: triangles(hay),
  propsTriangles: props.tris, propsDraws: 1, bambooTrianglesPerClump: triangles(bamboo.geometry),
  roofTriangles: triangles(tiles.geometry), roofDraws: 1, villageDrawObjects: village.group.children.length }));
