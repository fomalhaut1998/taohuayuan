import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { makeHead, makePeopleParts } from '../src/character-parts.js';
import { createPeople } from '../src/world/people.js';

const world = JSON.parse(fs.readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const cfg = world.people;
const failures = [];
function check(name, run) { try { run(); } catch (error) { failures.push(name + ': ' + error.message); } }
const colorEqual = (a, i, c) => Math.abs(a.getX(i) - c.r) < 1e-6 && Math.abs(a.getY(i) - c.g) < 1e-6 && Math.abs(a.getZ(i) - c.b) < 1e-6;
const headTriangles = {};
for (const role of ['adult', 'female', 'elder', 'child']) {
  const g = makeHead(cfg, role), pos = g.attributes.position, colors = g.attributes.color;
  const skin = new THREE.Color(cfg.skin), eye = new THREE.Color(cfg.eye);
  const skinPositions = [], eyes = [];
  for (let i = 0; i < pos.count; i += 3) {
    if (colorEqual(colors, i, skin)) for (let j = 0; j < 3; j++) skinPositions.push(pos.getX(i+j), pos.getY(i+j), pos.getZ(i+j));
  }
  for (let i = 0; i < pos.count; i++) if (colorEqual(colors, i, eye) && pos.getY(i) > -0.01 && pos.getY(i) < 0.025) eyes.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  check(role + ' thin eyes', () => {
    assert(eyes.length > 0);
    assert(Math.max(...eyes.map(v => v.y)) - Math.min(...eyes.map(v => v.y)) <= 0.012, 'eyes must read as thin ink strokes, not protruding eyeballs');
  });
  const skinGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(skinPositions, 3));
  const skinMesh = new THREE.Mesh(skinGeo, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
  const ray = new THREE.Raycaster();
  check(role + ' conforming eyes', () => {
    for (const point of eyes) {
      ray.set(new THREE.Vector3(point.x, point.y, 1), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(skinMesh)[0];
      assert(hit, 'eye needs supporting cheek surface');
      const offset = point.z - hit.point.z;
      assert(offset >= 0.0001 && offset <= 0.003, 'eye must stay just above face: ' + offset);
    }
  });
  check(role + ' merged nose', () => {
    const front = skinPositions.filter((_, i) => i % 3 === 2);
    assert(Math.max(...front) < 0.112, 'nose must blend into face without cone spike');
  });
  headTriangles[role] = pos.count / 3;
  check(role + ' budget', () => assert(pos.count / 3 <= 1100));
  skinGeo.dispose(); skinMesh.material.dispose(); g.dispose();
}
const field = {sample: (x, z) => 0.02 * x - 0.03 * z};
const houses = Array.from({length:4}, (_,i) => ({x:i*8,z:5,doorX:i*8,doorZ:3,rot:0}));
const road = {total:60,at:at => ({x:at,z:0,nx:0,nz:1})};
const people = createPeople(cfg, field, houses, road, [[12,5]], []);
const mesh = name => people.group.getObjectByName('people-' + name);
const matrix = (name, i) => { const m = new THREE.Matrix4(); mesh(name).getMatrixAt(i,m); return m; };
const index = people.list.findIndex(p => p.role === 'walker');
const p = people.list[index];
people.list.forEach(p => {p.encounterReady=Infinity;p.nextPause=Infinity;});
check('stable batches', () => assert.equal(people.group.children.length, 16));
check('head sum equals people count', () => {
  assert.equal(
    mesh('head').count + mesh('female-head').count + mesh('elder-head').count + mesh('child-head').count,
    people.count
  );
});
for (const [name, filter] of [
  ['head', p => p.role !== 'elder' && p.role !== 'child' && !p.female],
  ['female-head', p => p.role !== 'elder' && p.role !== 'child' && !!p.female],
  ['elder-head', p => p.role === 'elder'],
  ['child-head', p => p.role === 'child'],
  ['hat', p => p.hat && p.role !== 'child'],
  ['stool', p => p.mode === 'sit']
]) check(name + ' compact count', () => assert.equal(mesh(name).count, people.list.filter(filter).length, 'hidden heads and hats must not submit zero-scaled instances'));
function checkArms() {
  for (let i = 0; i < people.count; i++) {
    const torso = matrix('torso',i), person = people.list[i];
    for (let side = 0; side < 2; side++) {
      const shoulder = new THREE.Vector3(side ? 0.188 : -0.188, 0.150, 0).applyMatrix4(torso);
      const arm = matrix(side ? 'arm-r' : 'arm-l',i);
      const origin = new THREE.Vector3().setFromMatrixPosition(arm);
      assert(shoulder.distanceTo(origin) < 0.002, 'shoulder must stay attached to leaning robe');
      const wrist = new THREE.Vector3(0,-0.488,0).applyMatrix4(arm);
      const hand = new THREE.Vector3().setFromMatrixPosition(matrix('hand', i*2+side));
      assert(wrist.distanceTo(hand) < 0.045 * person.s, 'hand must overlap sleeve opening without detached wrist');
    }
  }
}
check('attached sleeves and wrists', checkArms);
check('role silhouettes', () => {
  const scales = ['walker','elder','child'].map(role => {
    const i=people.list.findIndex(p => p.role===role), v=new THREE.Vector3().setFromMatrixScale(matrix('torso',i)); return v.x/v.y;
  });
  assert(new Set(scales.map(v => v.toFixed(3))).size===3, 'body width-to-height should distinguish adult, elder and child');
});
let maxFootGap=0, maxSoleLift=0, maxTurn=0;
for(let frame=1;frame<=180;frame++) {
  const oldYaw=p.yaw;
  people.update(1/60, frame/60);
  maxTurn=Math.max(maxTurn,Math.abs(Math.atan2(Math.sin(p.yaw-oldYaw),Math.cos(p.yaw-oldYaw))));
  let stance=Infinity;
  for(let side=0;side<2;side++) {
    const legEnd = new THREE.Vector3(0,-1,0).applyMatrix4(matrix(side?'leg-r':'leg-l',index));
    const sm=matrix('shoe',index*2+side);
    const ankle=new THREE.Vector3(0,0.052,0).applyMatrix4(sm);
    maxFootGap=Math.max(maxFootGap,legEnd.distanceTo(ankle));
    const sole=new THREE.Vector3(0,-0.012,0).applyMatrix4(sm);
    const lift=sole.y-field.sample(sole.x,sole.z);
    maxSoleLift=Math.max(maxSoleLift,lift); stance=Math.min(stance,lift);
  }
  check('grounded stance '+frame,()=>assert(stance>=-0.002 && stance<0.012,'one foot must contact the sampled terrain'));
}
check('animated sleeves and wrists', checkArms);
check('basket grip', () => {
  people.list.forEach((person,i) => {
    if (!person.basket) return;
    const grip = new THREE.Vector3(0,-0.067,0).applyMatrix4(matrix('basket',person.bi));
    const hand = new THREE.Vector3().setFromMatrixPosition(matrix('hand',i*2));
    assert(grip.distanceTo(hand)<0.012,'basket handle must meet carrying hand');
  });
});
check('compact head mapping', () => {
  const groups = {adult:new Set(),female:new Set(),elder:new Set(),child:new Set(),hat:new Set()};
  for (let i=0;i<people.count;i++) {
    const person=people.list[i],role=person.role==='child'?'child':person.role==='elder'?'elder':person.female?'female':'adult';
    assert(!groups[role].has(person.headIndex),'head indices must be unique inside role');
    groups[role].add(person.headIndex);
    const name=role==='adult'?'head':role+'-head',head=matrix(name,person.headIndex);
    const position=new THREE.Vector3().setFromMatrixPosition(head);
    assert(Math.hypot(position.x-person.x,position.z-person.z)<0.3*person.s,'head must follow its own body');
    assert(new THREE.Vector3().setFromMatrixScale(head).x>0,'compact heads must not contain hidden zero scales');
    if(person.hatIndex>=0){assert(!groups.hat.has(person.hatIndex));groups.hat.add(person.hatIndex);}
  }
});
check('ankle continuity',()=>assert(maxFootGap<0.015,'leg/shoe endpoint gap '+maxFootGap));
check('step height',()=>assert(maxSoleLift<0.11,'steps must not float '+maxSoleLift));
p.at=p.hi-0.0001;p.dir=1;
const oldYaw=p.yaw;people.update(1/60,3.1);
const turn=Math.abs(Math.atan2(Math.sin(p.yaw-oldYaw),Math.cos(p.yaw-oldYaw)));
check('smooth reversal',()=>assert(turn<0.16,'route reversal must not snap by PI: '+turn));
check('seated soles',()=>{
  const i=people.list.findIndex(p=>p.role==='elder');
  for(let side=0;side<2;side++) {
    const sole=new THREE.Vector3(0,-0.012,0).applyMatrix4(matrix('shoe',i*2+side));
    assert(Math.abs(sole.y-field.sample(sole.x,sole.z))<0.012,'seated elder feet must reach terrain');
  }
});
check('stopped gait settles', () => {
  people.greet(index,p.x+2,p.z+1,10);
  for(let frame=1;frame<=120;frame++)people.update(1/60,3.1+frame/60);
  const gait=p.gait,at=p.at;
  const before=matrix('shoe',index*2).elements.slice();
  for(let frame=121;frame<=180;frame++)people.update(1/60,3.1+frame/60);
  assert.equal(p.gait,gait,'greeting must not advance walking phase');
  assert.equal(p.at,at,'greeting must keep route coordinate');
  assert(p.motion<1e-6,'idle must damp the walking blend');
  const after=matrix('shoe',index*2).elements;
  assert(Math.max(...after.map((v,i)=>Math.abs(v-before[i])))<0.001,'idle shoes must settle rather than cycle');
});
for(const object of people.group.children) {
  check(object.name+' material',()=>assert(object.isInstancedMesh && object.material.isMeshLambertMaterial));
  for(let i=0;i<object.count;i++) check(object.name+' finite',()=>assert(matrix(object.name.slice(7),i).elements.every(Number.isFinite)));
}
const parts=makePeopleParts(cfg);
const partTriangles=Object.fromEntries(Object.entries(parts).map(([name,g])=>[name,(g.index?.count??g.attributes.position.count)/3]));
for(const g of Object.values(parts)) g.dispose();
const submissions=people.group.children.map(o=>({name:o.name,instances:o.count,triangles:(o.geometry.index?.count??o.geometry.attributes.position.count)/3*o.count}));
const submittedTriangles=submissions.reduce((sum,o)=>sum+o.triangles,0);
check('character submission budget',()=>assert(submittedTriangles<75000,'compact 24-person fixture must stay below 75k submitted triangles'));
const materials=new Set();for(const o of people.group.children){o.geometry.dispose();materials.add(o.material);}for(const m of materials)m.dispose();
console.log(JSON.stringify({headTriangles,partTriangles,drawCalls:people.group.children.length,submittedTriangles,submissions,maxFootGap,maxSoleLift,maxTurn:Math.max(maxTurn,turn),failures:failures.slice(0,12),failureCount:failures.length},null,2));
assert.equal(failures.length,0, 'character refinement contract failed');
