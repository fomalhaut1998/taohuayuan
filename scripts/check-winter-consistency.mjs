import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createPhenologySystem } from '../src/systems/phenology-mist.js';
import { createMountains } from '../src/world/terrain.js';

globalThis.document = { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {} }), body: { classList: { contains: () => false } } };
globalThis.window = new EventTarget();
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const lum = a => { let s = 0; for (let i = 0; i < a.length; i += 3) s += 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; return s / (a.length / 3); };

const petalMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: '#F3C3CC', transparent: true, opacity: 0.96 }), 120);
for (let i = 0; i < 120; i++) petalMesh.setColorAt(i, new THREE.Color('#E8A0A8'));
const springPetalInst = Float32Array.from(petalMesh.instanceColor.array);
const leafMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.6, 0.5, 5), new THREE.MeshLambertMaterial(), 8);
leafMesh.name = 'mulberry-leaves';
const villageGroup = new THREE.Group(); villageGroup.add(leafMesh);
const floraGeo = new THREE.BufferGeometry();
floraGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
const fc = new Float32Array(9); const pc = new THREE.Color('#E8A0A8');
for (let i = 0; i < 9; i += 3) { fc[i] = pc.r; fc[i + 1] = pc.g; fc[i + 2] = pc.b; }
floraGeo.setAttribute('color', new THREE.BufferAttribute(fc, 3));
const floraGroup = new THREE.Group(); floraGroup.add(new THREE.Mesh(floraGeo, new THREE.MeshLambertMaterial({ vertexColors: true })));
const skyStub = { timeId: 'day', rainIntensity: 0, wind: 0.4, getAppearance: () => ({ fogColor: 'c9d8e2', timeId: 'day' }), getTwilightState: () => ({ amount: 0, dawn: 0, dusk: 0 }) };
const mountains = createMountains(world.mountains);
const cam = new THREE.PerspectiveCamera(); cam.position.set(30, 4, -140);
const mSteps = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) mountains.update(dt, skyStub, cam); };
const phen = createPhenologySystem({
  world: { terrain: {} }, field: { sample: () => 0 },
  flora: { group: floraGroup },
  petals: { mesh: petalMesh },
  village: { group: villageGroup },
  mountains,
  sky: skyStub,
});

// A. 远山冬色阶：冬比同日时辰更 pale，回春精确复原，dt=0 冻结
mSteps(240);
const dayCols = mountains.children.map(m => m.material.color.clone());
assert.equal(typeof mountains.setPhenology, 'function', 'mountains expose setPhenology');
mountains.setPhenology('winter'); mSteps(240);
const winCols = mountains.children.map(m => m.material.color.clone());
for (let i = 0; i < 3; i++) assert.ok(lum([winCols[i].r, winCols[i].g, winCols[i].b]) > lum([dayCols[i].r, dayCols[i].g, dayCols[i].b]) + 0.05, 'winter tier ' + i + ' paler than day');
const heldW = winCols.map(c => c.getHexString()).join(',');
for (let i = 0; i < 5; i++) mountains.update(0, skyStub, cam);
assert.equal(mountains.children.map(m => m.material.color.getHexString()).join(','), heldW, 'dt=0 freezes winter tiers');
mountains.setPhenology('spring'); mSteps(480);
for (let i = 0; i < 3; i++) { const c = mountains.children[i].material.color; assert.ok(Math.hypot(dayCols[i].r - c.r, dayCols[i].g - c.g, dayCols[i].b - c.b) < 0.012, 'spring restores day tier ' + i); }

// B. 雪片实例色洗白 + 回春字节恢复
phen.setPhenology('winter');
assert.ok(lum(petalMesh.instanceColor.array) > lum(springPetalInst) + 0.15, 'snow flakes lose the pink instance tint');
assert.equal(leafMesh.visible, false, 'mulberry leaves drop in winter');
phen.setPhenology('spring');
assert.deepEqual(Array.from(petalMesh.instanceColor.array), Array.from(springPetalInst), 'spring restores petal instance bytes');
assert.equal(leafMesh.visible, true, 'spring restores mulberry canopy');
phen.setPhenology('summer');
assert.equal(leafMesh.visible, true, 'summer keeps mulberry canopy');
assert.deepEqual(Array.from(petalMesh.instanceColor.array), Array.from(springPetalInst), 'summer keeps petal pink');
phen.dispose(); mountains.dispose();
console.log('check-winter-consistency: PASS petalLum ' + lum(springPetalInst).toFixed(3) + '->' + lum(petalMesh.instanceColor.array).toFixed(3));