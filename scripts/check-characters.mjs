import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { ringGeometry, makePeopleParts } from '../src/character-parts.js';
import { createPeople, rainStateForIntensity } from '../src/world/people.js';
import { createAvatar } from '../src/player/avatar.js';

const world = JSON.parse(fs.readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const side = ringGeometry([{ y: 0, rx: 1, rz: 1 }, { y: 1, rx: 1, rz: 1 }], 4);
const pos = side.attributes.position;
const a = new THREE.Vector3().fromBufferAttribute(pos, 0);
const b = new THREE.Vector3().fromBufferAttribute(pos, 1);
const c = new THREE.Vector3().fromBufferAttribute(pos, 2);
const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
const radial = a.clone().add(b).add(c).multiplyScalar(1 / 3).setY(0).normalize();
assert(normal.dot(radial) > 0, '衣身侧面必须朝外');
side.dispose();

const parts = makePeopleParts(world.people);
for (const [name, geometry] of Object.entries(parts)) {
  const values = geometry.attributes.position.array;
  const vertices = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  assert(vertices % 3 === 0, `${name} 应由完整三角形组成`);
  assert(Array.from(values).every(Number.isFinite), `${name} 顶点必须有限`);
  geometry.dispose();
}

const houses = Array.from({ length: 4 }, (_, i) => ({
  x: i * 2, z: 5, doorX: i * 2, doorZ: 3, rot: 0
}));
const road = { total: 60, at: at => ({ x: at, z: 0, nx: 0, nz: 1 }) };
const people = createPeople(world.people, { sample: () => 0 }, houses, road, [[12, 5]], []);
assert.equal(people.group.children.length, 16, '村民应维持 16 批实例化绘制（含秦汉女髻与老者坐凳）');
const headTotal = ['people-head', 'people-female-head', 'people-elder-head', 'people-child-head']
  .reduce((sum, name) => sum + (people.group.getObjectByName(name)?.count || 0), 0);
assert.equal(headTotal, people.count, '男女老幼四套头型实例总数应等于村民总数');
assert(people.group.getObjectByName('people-female-head').count > 0, '应包含秦汉妇人垂鬟椎髻批次');
assert.equal(people.group.getObjectByName('people-stool').count, people.list.filter(p => p.mode === 'sit').length, '门前坐歇老者应配备矮凳');
assert.deepEqual(new Set(people.list.map(p => p.role)), new Set(['walker', 'talker', 'elder', 'worker', 'basket', 'child']));
people.update(0.016, 1, 0, 0);
assert(people.list.every(p => Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.yaw)));
for (const role of ['walker', 'elder', 'child']) {
  const index = people.list.findIndex(p => p.role === role);
  assert.deepEqual(people.greet(index, 2, 3, 1), { index, role });
  people.update(0.3, 1.3, 2, 3);
  assert.equal(people.list[index].greetMax, 1);
  assert(people.list[index].greetT > 0 && people.list[index].greetT < 1);
}
assert.equal(rainStateForIntensity(0.05, false), false);
assert.equal(rainStateForIntensity(0.13, false), true);
assert.equal(rainStateForIntensity(0.08, true), true);
assert.equal(rainStateForIntensity(0.05, true), false);
const worker = people.list.find(p => p.mode === 'work');
people.setRain(true);
for (let i = 0; i < 100; i++) people.update(0.05, 2 + i * 0.05, 0, 0);
assert(worker.rainRest > 0.99, '下雨后田夫应收住');
people.setRain(false);
for (let i = 0; i < 100; i++) people.update(0.05, 7 + i * 0.05, 0, 0);
assert(worker.rainRest < 0.01, '雨停后田夫应恢复');
const walker = people.list.find(p => p.mode === 'road');
walker.encounterReady = Infinity;
walker.shelterRetry = 0;
walker.shelter = null;
walker.greetT = 0;
walker.at = 0;
people.update(0.016, 1.3, 0, 0);
const at = walker.at;
people.setRain(true);
people.update(0.016, 2, 0, 0);
assert(walker.shelter, '雨天应寻找有通路的屋檐');
people.setRain(false);
for (let i = 0; i < 3000; i++) people.update(0.05, 3 + i * 0.05, 0, 0);
assert(!walker.shelter, '雨停后应回到原路线');
assert(Number.isFinite(at));
for (const mesh of people.group.children) {
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    assert(matrix.elements.every(Number.isFinite), `${mesh.name} 动画矩阵必须有限`);
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
}

const avatar = createAvatar(world.player.avatar, world.player.walkSpeed);
assert.equal(avatar.count, 5, '玩家应保持五批绘制');
assert.equal(avatar.group.children.filter(o => o.isMesh).length, 0);
let meshCount = 0;
avatar.group.traverse(o => {
  if (!o.isMesh) return;
  meshCount++;
  assert(Array.from(o.geometry.attributes.position.array).every(Number.isFinite));
});
assert.equal(meshCount, 5);
avatar.update(0.016, 1, { x: 1, y: 2, z: 3, yaw: 0, vx: 1, vz: 0 });
assert.equal(avatar.group.position.y, 2);
assert(avatar.state.gait > 0 && avatar.state.yaw > 0, '玩家行走时应转身并推进步态');
avatar.update(0.016, 1.016, { x: 1, y: 2, z: 3, yaw: 0, vx: 0, vz: 0 });
avatar.setVisible(false);
assert.equal(avatar.group.visible, false);
avatar.dispose();
console.log(JSON.stringify({
  ringOutwardDot: normal.dot(radial),
  people: { count: people.count, drawCalls: 16, roles: 6, greet: true, shelterAndReturn: true },
  avatar: { drawCalls: 5, gait: true, finiteTransforms: true },
  status: 'passed'
}, null, 2));
