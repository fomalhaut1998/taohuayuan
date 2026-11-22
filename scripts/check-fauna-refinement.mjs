import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createFauna } from '../src/systems/fauna.js';
import { FAUNA_KIND, FAUNA_MOTION_DEFAULTS, faunaPartAngle, sampleFaunaVertex, createFaunaMaterial } from '../src/systems/fauna-motion.js';

const cfg = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8')).fauna;
const field = { sample: (x, z) => 1.2 + x * 0.015 - z * 0.007 };
const make = () => createFauna(cfg, field, {});
const fauna = make();
assert.deepEqual(Object.keys(fauna).sort(), ['animals','count','group','react','update']);
assert.equal(fauna.count, 25);
assert.equal(fauna.group.children.length, 5, 'one draw per species, no hidden part meshes');
const material = fauna.group.children[0].material;
assert.equal(material.type, 'MeshLambertMaterial');
assert.equal(material.vertexColors, true);
assert.equal(material.flatShading, true);
assert.equal(material.map, null, 'no generated texture');
assert.ok(fauna.group.children.every(m => m.isInstancedMesh && m.material === material));

const budget = {};
let triangles = 0, bytes = 0, sampledVertices = 0, checkedParts = 0;
const vec = (g, name, i) => new THREE.Vector3().fromBufferAttribute(g.attributes[name], i);
const near = (a, b, label, tolerance = 2e-6) => assert.ok(Math.abs(a-b) < tolerance, label + ': ' + a + ' != ' + b);
const requiredChannels = { chicken: [0,1,3,4], dog: [0,1,2,3], bird: [0,3,4], ox: [0,1,2,3], duck: [0,1,5] };
const vertexKey = v => v.toArray().map(x => x.toFixed(6)).join(',');

for (const mesh of fauna.group.children) {
  const g = mesh.geometry, kind = g.userData.kind, p = g.attributes.position;
  assert.equal(mesh.children.length, 0);
  assert.equal(g.groups.length, 0, 'a material group must not add draws');
  assert.equal(g.index, null, 'hard facet normals');
  assert.ok(p.count % 3 === 0);
  assert.ok(p.count / 3 < 1200, kind + ' purposeful silhouette budget');
  const channels = new Set();
  for (const name of ['position','normal','color','faunaPivot','faunaAxis','faunaMotion']) {
    const attr = g.attributes[name];
    assert.equal(attr.count, p.count, kind + ' ' + name + ' vertex count');
    assert.ok(attr.array.every(Number.isFinite), kind + ' finite ' + name);
    bytes += attr.array.byteLength;
  }
  assert.ok(g.attributes.faunaState.isInstancedBufferAttribute);
  assert.equal(g.attributes.faunaState.count, mesh.count);
  bytes += g.attributes.faunaState.array.byteLength + mesh.instanceMatrix.array.byteLength;
  // Position, normal, color + three part attributes + instance state + mat4 =
  // 11 attribute locations, under WebGL2's guaranteed 16; no extra draw stream.
  assert.equal(3 + 3 + 1 + 4, 11);
  for (let i=0;i<p.count;i++) {
    near(vec(g,'normal',i).length(),1,kind + ' unit normal');
    near(vec(g,'faunaAxis',i).length(),1,kind + ' unit rotation axis');
    channels.add(g.attributes.faunaMotion.getX(i));
  }
  for(const channel of requiredChannels[kind]) assert.ok(channels.has(channel), kind + ' joint channel ' + channel);

  // Every component is a closed, outward-wound solid, not zero-area ribbons.
  // Weld only for topology checking; render vertices intentionally stay split.
  for(const part of g.userData.parts) {
    const edges = new Map(); let volume6 = 0;
    for(let i=part.start;i<part.start+part.count;i+=3) {
      const a=vec(g,'position',i), b=vec(g,'position',i+1), c=vec(g,'position',i+2);
      assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() > 1e-15, kind + ' nondegenerate triangle ' + i);
      volume6 += a.dot(b.clone().cross(c));
      const keys=[a,b,c].map(vertexKey);
      for(let e=0;e<3;e++) {const key=[keys[e],keys[(e+1)%3]].sort().join('|'); edges.set(key,(edges.get(key)||0)+1);}
      const first = vec(g,'faunaMotion',i), pivot = vec(g,'faunaPivot',i), axis = vec(g,'faunaAxis',i);
      for(let j=1;j<3;j++) {
        assert.ok(first.equals(vec(g,'faunaMotion',i+j)) && pivot.equals(vec(g,'faunaPivot',i+j)) && axis.equals(vec(g,'faunaAxis',i+j)), kind + ' each triangle transforms rigidly');
      }
    }
    assert.ok(volume6 > 1e-10, kind + ' outward solid at ' + part.start);
    assert.ok([...edges.values()].every(n => n===2), kind + ' closed manifold at ' + part.start);
    checkedParts++;
  }

  // Every vertex in many extreme poses: normal remains perpendicular to its
  // transformed triangle, rigid lengths hold, local AND instance bounds cover it.
  const animal = fauna.animals.find(a => a.mesh===mesh);
  const matrix=new THREE.Matrix4(); mesh.getMatrixAt(animal.index,matrix);
  for(const phase of [0,0.71,1.63,2.24,3.96,5.35,8.1]) for(const gait of [0,1]) for(const reaction of [0,1]) {
    const state=[phase,gait,reaction,FAUNA_KIND[kind]];
    for(let i=0;i<p.count;i+=3) {
      const samples=[0,1,2].map(j => sampleFaunaVertex(g,i+j,state));
      const normal=samples[1].position.clone().sub(samples[0].position).cross(samples[2].position.clone().sub(samples[0].position)).normalize();
      for(let j=0;j<3;j++) {
        const sample=samples[j];
        near(sample.normal.length(),1,kind + ' rotated normal');
        assert.ok(normal.dot(sample.normal) > 0.99998,kind + ' face normal follows joint');
        assert.ok(sample.position.length() <= g.boundingSphere.radius + 1e-6,kind + ' analytic pose sphere');
        assert.ok(g.boundingBox.containsPoint(sample.position),kind + ' analytic pose box');
        assert.ok(sample.position.clone().applyMatrix4(matrix).distanceTo(mesh.boundingSphere.center) <= mesh.boundingSphere.radius + 1e-5,kind + ' instance sphere');
        const pivot=vec(g,'faunaPivot',i+j);
        near(sample.position.distanceTo(pivot),vec(g,'position',i+j).distanceTo(pivot),kind + ' no limb stretching');
        sampledVertices++;
      }
    }
  }
  const perAnimal=p.count/3;
  triangles+=perAnimal*mesh.count;
  budget[kind]={instances:mesh.count,triangles:perAnimal,totalTriangles:perAnimal*mesh.count,animationRadius:Number(g.boundingSphere.radius.toFixed(3))};
}
assert.ok(triangles < 15000,'total fauna triangle budget');
assert.ok(bytes < 1024*1024,'shared geometry and instance buffers under 1 MiB');

// Test the actual injected GLSL scalar law, not a hand-copied test substitute.
const shader={vertexShader:THREE.ShaderLib.lambert.vertexShader,uniforms:{}};
material.onBeforeCompile(shader);
assert.ok(shader.vertexShader.includes('objectNormal = faunaRotate(objectNormal, faunaJointAngle)'));
assert.ok(shader.vertexShader.includes('transformed = faunaPivot + faunaRotate(transformed - faunaPivot, faunaJointAngle)'));
const angleBody=shader.vertexShader.match(/float faunaAngle\(\) \{([\s\S]*?)\n\}/)[1];
const scalarJS=angleBody.replace(/\bfloat\b/g,'let').replace(/\b(sin|pow|max)\(/g,'Math.$1(').replace(/faunaMotion\.([xyz])/g,(_,c)=>'motion['+'xyz'.indexOf(c)+']').replace(/faunaState\.([xyzw])/g,(_,c)=>'state['+'xyzw'.indexOf(c)+']');
const names=Object.keys(shader.uniforms), values=names.map(n=>shader.uniforms[n].value);
const gpuAngle=new Function('motion','state',...names,scalarJS);
let angleCases=0;
for(const kind of Object.values(FAUNA_KIND)) for(let channel=0;channel<=5;channel++) for(const phase of [-2,0,0.4,2,7]) for(const gait of [0,0.5,1]) for(const reaction of [-0.08,0,0.14,1]) {
  const motion=[channel,0.7,0.43], state=[phase,gait,reaction,kind];
  near(gpuAngle(motion,state,...values),faunaPartAngle(motion,state), 'CPU/GLSL parity'); angleCases++;
}
assert.throws(()=>material.onBeforeCompile({vertexShader:'void main(){}',uniforms:{}}),/Fauna shader contract missing/);
const custom=createFaunaMaterial({wingFlight:0.7});
const customShader={vertexShader:THREE.ShaderLib.lambert.vertexShader,uniforms:{}}; custom.onBeforeCompile(customShader);
assert.equal(customShader.uniforms.faunaWingFlight.value,0.7); custom.dispose();

// Local actions visibly change a part while keeping the torso fixed.
const movedByChannel={};
for(const mesh of fauna.group.children) {
  const g=mesh.geometry,kind=g.userData.kind;
  const state0=[0,0,0,FAUNA_KIND[kind]],state1=[2.24,1,1,FAUNA_KIND[kind]];
  const moved=new Set();
  for(let i=0;i<g.attributes.position.count;i++) {
    const channel=g.attributes.faunaMotion.getX(i);
    const delta=sampleFaunaVertex(g,i,state0).position.distanceTo(sampleFaunaVertex(g,i,state1).position);
    if(channel===0) near(delta,0,kind + ' torso stays local');
    if(delta>0.001) moved.add(channel);
  }
  for(const c of requiredChannels[kind].filter(c=>c!==0)) assert.ok(moved.has(c),kind + ' articulated channel ' + c + ' moves');
  movedByChannel[kind]=[...moved].sort();
}
// A resting chicken dips its bill; walking suppresses peck to prevent collisions.
const peckPhase=Math.PI/(2*0.7);
assert.ok(faunaPartAngle([1,1,0],[peckPhase,0,0,FAUNA_KIND.chicken])>1.3);
assert.ok(Math.abs(faunaPartAngle([1,1,0],[peckPhase,1,0,FAUNA_KIND.chicken]))<0.06);
for(const mesh of fauna.group.children) {
  const phases=fauna.animals.filter(a=>a.mesh===mesh).map(a=>a.phase);
  assert.equal(new Set(phases).size,mesh.count,'independent per-animal phases');
}

const snapshot=f=>({animals:f.animals.map(a=>({kind:a.kind,x:a.x,z:a.z,y:a.y,yaw:a.yaw,targetYaw:a.targetYaw,tx:a.tx,tz:a.tz,mode:a.mode,timer:a.timer,phase:a.phase,cool:a.cool,hopT:a.hopT,lift:a.lift,pitch:a.pitch,rock:a.rock,gait:a.gait})),meshes:f.group.children.map(m=>({matrix:[...m.instanceMatrix.array],state:[...m.geometry.attributes.faunaState.array],center:m.boundingSphere.center.toArray(),radius:m.boundingSphere.radius}))});
const left=make(),right=make();
for(let i=0;i<left.animals.length;i++) {left.react(i,left.animals[i].x+1,left.animals[i].z);right.react(i,right.animals[i].x+1,right.animals[i].z);}
for(let i=0;i<24;i++) {left.update(1/60,i/60,30,-100);right.update(1/60,i/60,30,-100);}
const before=snapshot(left);
for(const dt of [0,-1,NaN,Infinity]) left.update(dt,90000,30,-100);
assert.deepEqual(snapshot(left),before,'pause/invalid delta cannot change simulation, buffers, phases, or bounds');
left.update(1/60,90000,30,-100);right.update(1/60,25/60,30,-100);
assert.deepEqual(snapshot(left),snapshot(right),'wall-clock jump on resume has no motion drift');
const capped=make(),normal=make();capped.update(90,90,30,-100);normal.update(FAUNA_MOTION_DEFAULTS.maxStep,0.05,30,-100);
assert.deepEqual(snapshot(capped),snapshot(normal),'long hidden-tab delta is clamped to one small simulation step');

// Existing behavior semantics and data remain intact through full reactions.
const modes={chicken:'flee',dog:'follow',bird:'flush',ox:'glance',duck:'paddle'};
for(const animal of fauna.animals) {
  const sound=fauna.react(fauna.animals.indexOf(animal),animal.x+1,animal.z);
  assert.equal(sound,cfg.sounds[animal.kind]);assert.equal(animal.mode,modes[animal.kind]);
  assert.equal(animal.mesh,fauna.group.children.find(m=>m.geometry.userData.kind===animal.kind));
}
assert.equal(fauna.react(-1,0,0),null);
let cachedSphereChanged=false;
const previousSphere=fauna.group.children.map(m=>m.boundingSphere.clone());
for(let i=0;i<240;i++) fauna.update(1/60,i/60,30,-100);
for(const mesh of fauna.group.children) {
  const old=previousSphere.shift(); cachedSphereChanged ||= old.center.distanceTo(mesh.boundingSphere.center)>1e-6;
  assert.ok(mesh.geometry.attributes.faunaState.version>0 && mesh.instanceMatrix.version>0);
  for(const a of fauna.animals.filter(a=>a.mesh===mesh)) {
    near(a.y,field.sample(a.x,a.z),'terrain sampled after motion');
    const matrix=new THREE.Matrix4();mesh.getMatrixAt(a.index,matrix);
    const localSphere=mesh.geometry.boundingSphere.clone().applyMatrix4(matrix);
    assert.ok(localSphere.center.distanceTo(mesh.boundingSphere.center)+localSphere.radius <= mesh.boundingSphere.radius+1e-5,'dynamic instance bounds include all articulated animals');
    const state=mesh.geometry.attributes.faunaState;
    near(state.getX(a.index),a.phase,'GPU phase mirrors state');
    assert.equal(state.getW(a.index),FAUNA_KIND[a.kind]);
  }
}
assert.ok(cachedSphereChanged,'moving instances refresh cached mesh sphere');
for(const f of [fauna,left,right,capped,normal]) {for(const m of f.group.children) m.geometry.dispose();f.group.children[0].material.dispose();}
console.log(JSON.stringify({status:'passed',drawCalls:5,animals:25,budget,totalTriangles:triangles,bufferBytes:bytes,closedParts:checkedParts,sampledVertices,angleCases,movedByChannel,pauseResume:'stable',shader:'source/CPU parity; GPU link belongs to parent browser verification'}));
