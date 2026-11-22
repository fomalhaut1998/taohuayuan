import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createVillage } from '../src/world/village.js';
import { createVillage as baselineVillage } from '../.visual-baseline/src/world/village.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createVillageLife as baselineLife } from '../.visual-baseline/src/world/village-life.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createHinterland as baselineHinterland } from '../.visual-baseline/src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createProps } from '../src/world/props.js';
import { createProps as baselineProps } from '../.visual-baseline/src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { stoneGeometry, wellRimGeometry } from '../src/world/model-geometry.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
const ctx = new Proxy({createRadialGradient:()=>({addColorStop(){}})}, {get:(t,k)=>t[k]??(()=>{})});
globalThis.document = {createElement:()=>({getContext:()=>ctx})};
const river = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points),160));
const height = createHeightFunction(world.terrain,river);
const grid = new THREE.PlaneGeometry(world.terrain.size,world.terrain.size,world.terrain.segments,world.terrain.segments);grid.rotateX(-Math.PI/2);
const heights = Float32Array.from({length:grid.attributes.position.count},(_,i)=>height(grid.attributes.position.getX(i),grid.attributes.position.getZ(i)));
const field = new Heightfield(world.terrain.size,world.terrain.segments,heights);
const village = createVillage(structuredClone(world.village),field,world.terrain.pond);
const oldVillage = baselineVillage(structuredClone(world.village),field,world.terrain.pond);
const tris = g => (g.index?.count??g.attributes.position.count)/3;
const budget = group => {let triangles=0,draws=0;group.traverse(m=>{if(m.isMesh&&m.visible!==false){draws++;triangles+=tris(m.geometry)*(m.isInstancedMesh?m.count:1);}});return {triangles,draws};};
for(const key of ['houseInfo','houses','plots','chimneys','pond','blockers','bamboo','mulberry']) assert.deepEqual(village[key],oldVillage[key],key+' exact baseline placement/API');
assert.equal(budget(village.group).draws,budget(oldVillage.group).draws,'no additional village draw objects');
assert(budget(village.group).triangles<=budget(oldVillage.group).triangles,'architectural detail reuses saved wall faces');
for(let i=0;i<3;i++){
  const mesh=village.group.getObjectByName('houses-body-'+i),old=oldVillage.group.getObjectByName('houses-body-'+i);
  assert.equal(mesh.material.map,null,'ink earth walls need no procedural colour texture');
  assert.equal(mesh.material.bumpMap,null,'ink earth walls need no procedural bump texture');
  assert(tris(mesh.geometry)<=tris(old.geometry),'per-variant wall budget');
  assert.deepEqual(mesh.instanceMatrix.array,old.instanceMatrix.array,'house footprints unchanged');
  mesh.geometry.computeBoundingBox();
  const bb=mesh.geometry.boundingBox;
  assert(bb.min.x>=-0.517001&&bb.max.x<=0.517001&&bb.min.z>=-0.517001&&bb.max.z<=0.517001,'joinery stays inside existing padded collision footprint');
  const p=mesh.geometry.attributes.position,c=mesh.geometry.attributes.color;
  let darkFront=0,projected=0;
  for(let k=0;k<p.count;k++){
    if(p.getZ(k)>0.5&&c.getX(k)<0.45&&p.getY(k)>0.4)darkFront++;
    if(Math.abs(p.getX(k))>0.5||Math.abs(p.getZ(k))>0.5)projected++;
  }
  assert(darkFront>=36,'recessed window/shadow and timber hierarchy');
  assert(projected>36,'raised frame/sill depth rather than only painted walls');
}
for(let i=0;i<village.houseInfo.length;i++){
  const h=village.houseInfo[i],bb=village.group.getObjectByName('houses-body-'+i%3).geometry.boundingBox;
  assert(Math.max(Math.abs(bb.min.x),Math.abs(bb.max.x))*h.w<=h.w/2+0.100001,'side window within existing house collider');
  assert(Math.max(Math.abs(bb.min.z),Math.abs(bb.max.z))*h.d<=h.d/2+0.100001,'front joinery within existing house collider');
}
assert.notDeepEqual(village.group.getObjectByName('houses-body-0').geometry.attributes.position.array,
  village.group.getObjectByName('houses-body-1').geometry.attributes.position.array,'houses differ by window joinery, not texture');
for(const name of ['houses-door','houses-roof','houses-gable','houses-chimney']){
  assert.deepEqual(village.group.getObjectByName(name).instanceMatrix.array,oldVillage.group.getObjectByName(name).instanceMatrix.array,name+' transforms preserved');
}
const props=createProps(world.props,field,village.houseInfo,village.plots,village.road),cliff=createCliff(world.cliff,field);
const oldProps=baselineProps(world.props,field,village.houseInfo,village.plots,village.road);
assert.deepEqual(props.marks,oldProps.marks,'every prop/tree mark and legacy RNG draw stays exactly stable');
assert.equal(props.group.children.length,1,'foreground trees remain in the existing merged props draw');
assert.equal(props.tris,oldProps.tris,'tree refinement reuses exactly the same geometry slots');
assert(props.tris<=65000,'whole props batch remains within declared triangle budget');
const propGeo=props.group.children[0].geometry,pv=propGeo.attributes.position;
const treeMarks=props.marks.filter(m=>m.kind==='tree'),treeCfg=world.props.tree||{};
const treeVertices=t=>(6*24+(1+(treeCfg.satellitePuffs??9)+(t.blossom?(treeCfg.bloomPuffs??5):0))*48)*3;
let treeStart=pv.count-treeMarks.reduce((n,t)=>n+treeVertices(t),0);
function capCenter(start,top){const v=new THREE.Vector3();const offset=top?36:54;for(let i=0;i<18;i++)v.add(new THREE.Vector3().fromBufferAttribute(pv,start+offset+i));return v.multiplyScalar(1/18);}
for(const t of treeMarks){
  const limbs=Array.from({length:6},(_,i)=>({a:capCenter(treeStart+i*72,false),b:capCenter(treeStart+i*72,true)}));
  assert(Math.abs(limbs[0].a.y-field.sample(t.x,t.z)+0.04)<2e-5,'tree foot planted without changing terrain');
  for(let i=1;i<3;i++){
    assert(limbs[i].a.distanceTo(limbs[i-1].b)<3e-5,'curved trunk segments join continuously');
    const ringRadius=(start,top,center)=>{let n=0;for(let j=0;j<18;j++)n+=new THREE.Vector3().fromBufferAttribute(pv,start+(top?36:54)+j).distanceTo(center);return n/18;};
    assert(Math.abs(ringRadius(treeStart+(i-1)*72,true,limbs[i-1].b)-ringRadius(treeStart+i*72,false,limbs[i].a))<3e-5,'adjacent stem rings taper continuously without stacked cone shoulders');
  }
  const dirs=limbs.slice(0,3).map(l=>l.b.clone().sub(l.a).normalize());
  assert(dirs[0].angleTo(dirs[1])>0.04,'trunk has an actual change of direction');
  const nodes=[limbs[0].a,...limbs.slice(0,3).map(l=>l.b)];
  for(const limb of limbs.slice(3))assert(Math.min(...nodes.map(n=>n.distanceTo(limb.a)))<3e-5,'branches grow from trunk nodes, never float beside the stem');
  const tips=limbs.slice(3).map(l=>l.b);
  assert(Math.max(...tips.map(p=>p.y))-Math.min(...tips.map(p=>p.y))>t.r*0.24,'main and subordinate boughs have different crown heights');
  assert(Math.max(...tips.map(p=>Math.hypot(p.x-t.x,p.z-t.z)))>t.r*0.35,'visible branching silhouette replaces a straight pole');
  const crownStart=treeStart+6*72;
  const centroid=new THREE.Vector3();for(let i=0;i<144;i++)centroid.add(new THREE.Vector3().fromBufferAttribute(pv,crownStart+i));centroid.multiplyScalar(1/144);
  assert(Math.hypot(centroid.x-t.x,centroid.z-t.z)>t.r*0.18,'large crown is offset along the main bough instead of a central mushroom cap');
  for(let i=crownStart;i<treeStart+treeVertices(t);i++)assert(Math.hypot(pv.getX(i)-t.x,pv.getZ(i)-t.z)<=t.r+0.00003,'refined canopy stays within its original map reservation radius');
  treeStart+=treeVertices(t);
}
assert.equal(treeStart,pv.count,'tree refinements retain every original primitive slot');
const hinterland=createHinterland(world.hinterland,field,river,world,village,props,cliff);
const oldHinterland=baselineHinterland(world.hinterland,field,river,world,village,props,cliff);
for(const key of ['trees','bamboo','structures','paths','blockers'])assert.deepEqual(hinterland[key],oldHinterland[key],key+' hinterland baseline preserved');
assert.equal(budget(hinterland.group).draws,budget(oldHinterland.group).draws);
assert(budget(hinterland.group).triangles<budget(oldHinterland.group).triangles,'organic crown profile saves triangles');
for(const mesh of hinterland.group.children.filter(m=>m.name.startsWith('hinterland-crown'))){
  assert.equal(tris(mesh.geometry),48,'shared broad flattened 48-face crowns');
  const scales=[];const mat=new THREE.Matrix4(),p=new THREE.Vector3(),s=new THREE.Vector3(),q=new THREE.Quaternion();
  for(let i=0;i<Math.min(5,mesh.count);i++){mesh.getMatrixAt(i,mat);mat.decompose(p,q,s);scales.push(s.x);}
  assert(Math.max(...scales)/Math.min(...scales)>1.3,'primary and subordinate crown masses read at a distance');
}
// Evaluate the immutable scene backup with explicit original helper/config URLs;
// this avoids copying configuration or adding runtime dependencies to the backup.
const baselineSceneSource=readFileSync(new URL('../.visual-baseline/src/world/village-scenes.js',import.meta.url),'utf8')
  .replace("'three'",JSON.stringify(import.meta.resolve('three')))
  .replace("'../data/village-scenes.json'",JSON.stringify(new URL('../src/data/village-scenes.json',import.meta.url).href))
  .replace("'./hinterland.js'",JSON.stringify(new URL('../src/world/hinterland.js',import.meta.url).href))
  .replace("'./model-geometry.js'",JSON.stringify(new URL('../.visual-baseline/src/world/model-geometry.js',import.meta.url).href));
const {createVillageScenes:baselineScenes}=await import('data:text/javascript;base64,'+Buffer.from(baselineSceneSource).toString('base64'));
const scenes=createVillageScenes(world,field,river,village,props,cliff,hinterland);
const oldScenes=baselineScenes(world,field,river,village,props,cliff,hinterland);
for(const key of ['scenes','nature','paths','blockers','details','mapData'])assert.deepEqual(scenes[key],oldScenes[key],key+' scene baseline preserved');
assert.equal(scenes.stats.drawCalls,oldScenes.stats.drawCalls);
assert(scenes.stats.triangles<oldScenes.stats.triangles,'planted stones reduce scene budget');
const leaves=hinterland.group.getObjectByName('hinterland-leaf'),oldLeaves=oldHinterland.group.getObjectByName('hinterland-leaf');
assert.equal(tris(leaves.geometry),4,'folded leaves replace twenty-face balls');
assert.equal(leaves.count,oldLeaves.count,'no extra leaf instances');
const life=createVillageLife(world,field,river,village,props,cliff,hinterland,scenes,{sites:[]});
const oldLife=baselineLife(world,field,river,village,props,cliff,hinterland,scenes,{sites:[]});
for(const key of ['items','mapData','blockers','counts'])assert.deepEqual(life[key],oldLife[key],key+' life baseline preserved');
assert.equal(life.stats.drawCalls,oldLife.stats.drawCalls);assert(life.stats.triangles<=oldLife.stats.triangles,'life refinement never grows the budget');
const stone=stoneGeometry(431),again=stoneGeometry(431),p=stone.attributes.position;
assert.equal(tris(stone),20,'stone replaces generic icosahedron at equal cost');
assert.deepEqual(p.array,again.attributes.position.array,'stone determinism');
let planted=0;for(let i=0;i<p.count;i++){assert(Math.hypot(p.getX(i),p.getZ(i))<=0.500001);if(p.getY(i)<-0.35)planted++;}
assert(planted>=15,'buried planar foot, not a balancing gemstone point');
const rim=wellRimGeometry();assert(tris(rim)<=48,'real well mouth replaces capped disk at equal cost');
const rimMesh=new THREE.Mesh(rim,new THREE.MeshBasicMaterial());rimMesh.updateMatrixWorld();
assert.equal(new THREE.Raycaster(new THREE.Vector3(0,2,0),new THREE.Vector3(0,-1,0)).intersectObject(rimMesh).length,0,'well mouth has no stone lid');
assert(new THREE.Raycaster(new THREE.Vector3(0.45,2,0),new THREE.Vector3(0,-1,0)).intersectObject(rimMesh).length>0,'well rim is upward facing');
for(const group of [village.group,props.group,hinterland.group,scenes.group,life.group])group.traverse(m=>{
  if(!m.isMesh)return;
  assert(m.material.isMeshLambertMaterial||m.material.isMeshBasicMaterial,m.name+' simple ink-compatible lighting');
  for(const name of ['position','normal','color']){const a=m.geometry.attributes[name];if(a)assert(a.array.every(Number.isFinite),m.name+' finite '+name);}
});
console.log(JSON.stringify({status:'passed',props:budget(props.group),baselineProps:budget(oldProps.group),village:budget(village.group),baselineVillage:budget(oldVillage.group),hinterland:budget(hinterland.group),baselineHinterland:budget(oldHinterland.group),scenes:scenes.stats,baselineScenes:oldScenes.stats,hinterlandLeafTriangles:tris(leaves.geometry)*leaves.count,life:life.stats,baselineLife:oldLife.stats,stoneTriangles:tris(stone),wellRimTriangles:tris(rim)}));
