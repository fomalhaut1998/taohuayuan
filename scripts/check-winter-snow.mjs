import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPhenologySystem, PHENOLOGY_MODES } from '../src/systems/phenology-mist.js';

globalThis.document = { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {} }), body: { classList: { contains: () => false } } };
globalThis.window = new EventTarget();

function coloredPlane(n, hex, up) {
  const geo = new THREE.PlaneGeometry(4, 4, n, n);
  geo.rotateX(-Math.PI / 2);
  const count = geo.attributes.position.count;
  const col = new Float32Array(count * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < count; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!up) for (let i = 0; i < count; i++) geo.attributes.normal.array[i * 3 + 1] = -1;
  return geo;
}
const lum = a => { let s = 0; for (let i = 0; i < a.length; i += 3) s += 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; return s / (a.length / 3); };

// flora: one shared geometry, pink crown verts + dark branch verts
const floraGeo = new THREE.BufferGeometry();
const fPos = new Float32Array(12 * 3);
const fCol = new Float32Array(12 * 3);
for (let v = 0; v < 12; v++) {
  const pink = v < 8;
  const c = new THREE.Color(pink ? '#E8A0A8' : '#4A3A30');
  fCol[v * 3] = c.r; fCol[v * 3 + 1] = c.g; fCol[v * 3 + 2] = c.b;
}
floraGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
floraGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
const floraMesh = new THREE.Mesh(floraGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
const flora = { group: new THREE.Group() };
flora.group.add(floraMesh);
const springFlora = Float32Array.from(fCol);

const reedMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 1), new THREE.MeshLambertMaterial(), 6);
for (let i = 0; i < 6; i++) reedMesh.setColorAt(i, new THREE.Color('#7BA05B'));
const reedGroup = new THREE.Group(); reedGroup.add(reedMesh); reedMesh.name = 'reeds';
const springReed = Float32Array.from(reedMesh.instanceColor.array);

const cropGeo = coloredPlane(2, '#6E8F4E', true);
const cropMesh = new THREE.InstancedMesh(cropGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), 4);
for (let i = 0; i < 4; i++) cropMesh.setColorAt(i, new THREE.Color('#8FA860'));
cropMesh.name = 'qin-han-millet-crops';
const cropGroup = new THREE.Group(); cropGroup.add(cropMesh);
const springCropGeo = Float32Array.from(cropGeo.attributes.color.array);
const springCropInst = Float32Array.from(cropMesh.instanceColor.array);

const petalMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: '#F3C3CC', transparent: true, opacity: 0.96 }), 120);
const fallenMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ transparent: true }), 90);
for (let i = 0; i < 90; i++) fallenMesh.setColorAt(i, new THREE.Color('#E8A0A8'));
const springFallen = Float32Array.from(fallenMesh.instanceColor.array);

const groundGeo = coloredPlane(6, '#7BA05B', true);
const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
groundMesh.name = 'terrain';
const springGround = Float32Array.from(groundGeo.attributes.color.array);
const roofMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4), new THREE.MeshLambertMaterial(), 5);
for (let i = 0; i < 5; i++) roofMesh.setColorAt(i, new THREE.Color('#8A6F4D'));
roofMesh.name = 'houses-roof';
const villageGroup = new THREE.Group(); villageGroup.add(roofMesh);
const springRoof = Float32Array.from(roofMesh.instanceColor.array);

const patchGeo = coloredPlane(3, '#8FB055', false); // fan decals wind downward; wash must use |ny|
const patchMesh = new THREE.Mesh(patchGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
patchMesh.name = 'ground-patch';
const stemMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.4), new THREE.MeshLambertMaterial());
stemMesh.name = 'flower-stems';
const headMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial());
headMesh.name = 'flower-heads';
const scatterGroup = new THREE.Group();
scatterGroup.add(patchMesh); scatterGroup.add(stemMesh); scatterGroup.add(headMesh);
const springPatch = Float32Array.from(patchGeo.attributes.color.array);
const skyStub = { timeId: 'day', rainIntensity: 0, wind: 0.4, getAppearance: () => ({ fogColor: 'c9d8e2', timeId: 'day' }), getTwilightState: () => ({ amount: 0, dawn: 0, dusk: 0 }) };
const phen = createPhenologySystem({
  world: { terrain: {} },
  field: { sample: () => 0 },
  flora,
  reeds: { group: reedGroup },
  qinHanCompletion: { group: cropGroup },
  petals: { mesh: petalMesh },
  fallen: { mesh: fallenMesh },
  terrain: { mesh: groundMesh },
  village: { group: villageGroup },
  scatter: { group: scatterGroup },
  sky: skyStub,
});

assert.equal(PHENOLOGY_MODES.length, 4, 'four seasons in the cycle');
assert.equal(PHENOLOGY_MODES[3].id, 'winter', 'winter closes the cycle');
assert.equal(phen.getStats().phenologyId, 'spring', 'spring baseline untouched at startup');
assert.deepEqual(Array.from(groundGeo.attributes.color.array), Array.from(springGround), 'startup never mutates ground');

phen.setPhenology('winter');
assert.equal(phen.getStats().phenologyId, 'winter');
const wFlora = floraGeo.attributes.color.array;
let crownSnow = 0, branchKeep = 0;
for (let v = 0; v < 12; v++) {
  const i = v * 3;
  if (v < 8) { if (wFlora[i + 1] > springFlora[i + 1] + 0.1 && wFlora[i + 2] > springFlora[i + 2] + 0.1) crownSnow++; }
  else if (Math.abs(wFlora[i] - springFlora[i]) < 1e-6) branchKeep++;
}
assert.ok(crownSnow >= 5, 'snow dusts most blossom verts, got ' + crownSnow);
assert.equal(branchKeep, 4, 'bare branch verts keep their ink');
assert.ok(lum(reedMesh.instanceColor.array) > lum(springReed) + 0.08, 'reeds turn pale straw-snow');
assert.ok(lum(cropGeo.attributes.color.array) > lum(springCropGeo) + 0.08, 'fallow crops pale under snow');
assert.ok(lum(groundGeo.attributes.color.array) > lum(springGround) + 0.1, 'thin snow wash lifts ground luminance');
assert.ok(lum(roofMesh.instanceColor.array) > lum(springRoof) + 0.1, 'thatch roofs carry snow');
assert.ok(lum(patchGeo.attributes.color.array) > lum(springPatch) + 0.15, 'meadow decals wash into the snow sheet');
assert.equal(stemMesh.visible, false, 'winter hides flower stems');
assert.equal(headMesh.visible, false, 'winter hides flower heads');
assert.equal(petalMesh.material.color.getHexString(), 'f2f1ea', 'drifting petals become snow flakes');
assert.ok(petalMesh.count < 120 && petalMesh.count >= 40, 'snow drift thinner than blossom fall');
assert.ok(lum(fallenMesh.instanceColor.array) > lum(springFallen) + 0.15, 'fallen layer reads as snow patches');
const statsW = JSON.stringify(phen.getStats());
phen.update(0, 5, skyStub);
assert.equal(JSON.stringify(phen.getStats()), statsW, 'dt=0 freezes phenology stats');

phen.setPhenology('spring');
assert.deepEqual(Array.from(floraGeo.attributes.color.array), Array.from(springFlora), 'spring restores blossom bytes');
assert.deepEqual(Array.from(reedMesh.instanceColor.array), Array.from(springReed), 'spring restores reed bytes');
assert.deepEqual(Array.from(cropGeo.attributes.color.array), Array.from(springCropGeo), 'spring restores crop geometry bytes');
assert.deepEqual(Array.from(cropMesh.instanceColor.array), Array.from(springCropInst), 'spring restores crop instance bytes');
assert.deepEqual(Array.from(groundGeo.attributes.color.array), Array.from(springGround), 'spring restores ground bytes');
assert.deepEqual(Array.from(roofMesh.instanceColor.array), Array.from(springRoof), 'spring restores roof bytes');
assert.deepEqual(Array.from(patchGeo.attributes.color.array), Array.from(springPatch), 'spring restores meadow decal bytes');
assert.equal(stemMesh.visible, true, 'spring restores flower stems');
assert.equal(headMesh.visible, true, 'spring restores flower heads');
assert.deepEqual(Array.from(fallenMesh.instanceColor.array), Array.from(springFallen), 'spring restores fallen bytes');
assert.equal(petalMesh.material.color.getHexString(), 'f3c3cc', 'spring restores petal pink');
assert.equal(petalMesh.count, 120, 'spring restores petal count');

const order = [];
for (let i = 0; i < 5; i++) { order.push(phen.getStats().phenologyId); phen.cyclePhenology(1, false); }
assert.deepEqual(order, ['spring', 'summer', 'autumn', 'winter', 'spring'], 'cycle walks four seasons and wraps');
phen.dispose();
console.log('check-winter-snow: PASS crownSnow=' + crownSnow + ' groundLum ' + lum(springGround).toFixed(3) + '->' + lum(groundGeo.attributes.color.array).toFixed(3));
