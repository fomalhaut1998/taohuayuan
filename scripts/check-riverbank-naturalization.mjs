import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { createReeds } from '../src/world/reeds.js';
import { createScatter } from '../src/world/scatter.js';

const world = JSON.parse(fs.readFileSync(new URL('../src/data/world.json', import.meta.url)));
const ctx = new Proxy({ createImageData: (w,h) => ({ data: new Uint8ClampedArray(w*h*4) }) }, { get: (t,k) => t[k] ?? (()=>{}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
const curve = createRiverCurve(world.stream.points);
const distance = createRiverDistance(sampleRiverSpine(curve,160));
const legacyCfg = { ...world.terrain, shoreline: undefined };
const look = { road: world.village.road, pond: world.terrain.pond };
const terrain = createTerrain(world.terrain,distance,look);
const legacy = createTerrain(legacyCfg,distance,look);
const a = terrain.mesh.geometry, b = legacy.mesh.geometry;
assert.equal(a.attributes.position.count,b.attributes.position.count,'reuse the same terrain grid');
assert.deepEqual(a.index.array,b.index.array,'no extra terrain triangles');
let changed = 0, maxDelta = 0;
for(let i=0;i<a.attributes.position.count;i++) {
  const x=a.attributes.position.getX(i), z=a.attributes.position.getZ(i);
  const delta=Math.abs(a.attributes.position.getY(i)-b.attributes.position.getY(i));
  if(delta>1e-6) { changed++; assert(z>64 && z<380 && distance(x,z)<18,'relief is confined to exterior river toe'); }
  maxDelta=Math.max(maxDelta,delta);
}
assert(changed>80,'riverbank shoals and inlets must change the existing grid');
assert(maxDelta<=0.900001,'bounded relief, never a new cliff');
for(let z=-260;z<=60;z+=4)for(let x=-90;x<160;x+=4) assert.equal(terrain.heightAt(x,z),legacy.heightAt(x,z),'village, pond and cave preserve their exact heights');
for(let z=80;z<=350;z+=3)for(let x=-90;x<=90;x+=2) {
  const d=distance(x,z), h=terrain.heightAt(x,z);
  assert(Number.isFinite(h));
  if(d>=18||d<=3) assert.equal(h,legacy.heightAt(x,z),'dry shoulder and channel spine unchanged');
  if(legacy.heightAt(x,z)>=world.terrain.waterLevel+1.1) assert.equal(h,legacy.heightAt(x,z),'dry walking ground is not displaced');
}
let waterEdges=0, changedCrossings=0;
for(let i=8;i<=74;i++) {
  const t=i/100, p=curve.getPointAt(t), tan=curve.getTangentAt(t), len=Math.hypot(tan.x,tan.z);
  const nx=tan.z/len,nz=-tan.x/len;
  for(const side of [-1,1]) {
    const edge=world.stream.halfWidth+Math.sin(t*21.7)*world.stream.edgeWobble;
    const x=p.x+nx*edge*side,z=p.z+nz*edge*side;
    assert(terrain.field.sample(x,z)>world.terrain.waterLevel+world.stream.waveAmp,'water strip remains hidden under solid bank at its edge');
    waterEdges++;
    let oldCross=0,newCross=0;
    for(let d=4;d<=20;d+=.125) {
      const xx=p.x+nx*d*side,zz=p.z+nz*d*side;
      if(legacy.field.sample(xx,zz)<=world.terrain.waterLevel)oldCross=d;
      if(terrain.field.sample(xx,zz)<=world.terrain.waterLevel)newCross=d;
    }
    if(Math.abs(oldCross-newCross)>=.25)changedCrossings++;
  }
}
assert(changedCrossings>35,'the actual heightfield waterline visibly meanders, not just its colors');
const reeds = createReeds(world.reeds,terrain.field,curve,world.terrain);
const again = createReeds(world.reeds,terrain.field,curve,world.terrain);
assert.equal(reeds.group.children.length,1,'retain one reed batch');
assert.equal(reeds.group.children[0].count,world.reeds.count,'redistribute, do not densify reeds');
assert.deepEqual(reeds.group.children[0].instanceMatrix.array,again.group.children[0].instanceMatrix.array,'reed patches are deterministic');
const legacyReeds=createReeds({...world.reeds,patches:0},terrain.field,curve,world.terrain);
const reedMesh=reeds.group.children[0],legacyReedMesh=legacyReeds.group.children[0];
assert.deepEqual(reedMesh.geometry.index.array,legacyReedMesh.geometry.index.array,'unchanged reed geometry');
assert.deepEqual(reedMesh.geometry.attributes.position.array,legacyReedMesh.geometry.attributes.position.array);
assert.equal(reedMesh.count,legacyReedMesh.count);
function patchContrast(mesh) {
  const bins=Array(40).fill(0),matrix=new THREE.Matrix4();
  for(let i=0;i<mesh.count;i++) {
    mesh.getMatrixAt(i,matrix);
    const z=matrix.elements[14];
    if(z>=64&&z<380)bins[Math.floor((z-64)/316*bins.length)]++;
  }
  const mean=bins.reduce((a,b)=>a+b,0)/bins.length;
  return Math.sqrt(bins.reduce((sum,n)=>sum+(n-mean)**2,0)/bins.length)/mean;
}
const reedContrast=patchContrast(reedMesh),legacyReedContrast=patchContrast(legacyReedMesh);
assert(reedContrast>legacyReedContrast*1.15,'coherent stands retain measurable open stretches, not an even fringe');
const scatter=createScatter(world.scatter,terrain.field,()=>false,world.village.road,null,{curve,terrainCfg:world.terrain});
const stones=scatter.group.getObjectByName('stones');
assert.equal(stones.count,world.scatter.stone.count,'shore shingle reuses the 190 existing stones');
let shoreStones=0;
const m=new THREE.Matrix4(),v=new THREE.Vector3();
for(let i=0;i<stones.count;i++) {
  stones.getMatrixAt(i,m);v.setFromMatrixPosition(m);
  if(v.z>64) {shoreStones++;const h=terrain.field.sample(v.x,v.z);assert(h>=world.terrain.waterLevel-.12&&h<=world.terrain.waterLevel+1.15,'shingle stays on the shallow exposed bank');}
}
assert(shoreStones>=60 && shoreStones<=80,'a bounded part of the old stone budget frames the exterior stream');
const stoneAgain=createScatter(world.scatter,terrain.field,()=>false,world.village.road,null,{curve,terrainCfg:world.terrain}).group.getObjectByName('stones');
assert.deepEqual(stones.instanceMatrix.array,stoneAgain.instanceMatrix.array,'shore shingle is deterministic');
const flat={sample:()=>2};
const noShoals=createScatter(world.scatter,flat,()=>false,world.village.road,null,{curve,terrainCfg:world.terrain}).group.getObjectByName('stones');
assert.equal(noShoals.count,world.scatter.stone.count,'unsuitable shoals fall back to the old ordinary stone budget');
for(let i=0;i<noShoals.count;i++){noShoals.getMatrixAt(i,m);assert(m.elements[14]<64,'fallback stays in the old scatter area');}
const legacyStones=createScatter(world.scatter,terrain.field,()=>false,world.village.road).group.getObjectByName('stones');
assert.equal(legacyStones.count,stones.count,'optional old API retains the same count');
assert.deepEqual(stones.geometry.attributes.position.array,legacyStones.geometry.attributes.position.array,'reuse the existing rock geometry');
assert.equal(scatter.group.children.filter(o=>o.name==='stones').length,1,'one stone batch only');
for(const g of [a,b])for(const name of ['position','normal','color'])assert(g.attributes[name].array.every(Number.isFinite),name+' finite');
console.log(JSON.stringify({status:'passed',changedBankVertices:changed,maxRelief:maxDelta,waterEdges,changedCrossings,terrainTriangles:a.index.count/3,reeds:reeds.group.children[0].count,stones:stones.count,shoreStones,reedContrast,legacyReedContrast,fallback:true}));
