import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';

// Load untouched round-two sources while resolving their dependencies to the project.
// Baselines are records, not another maintained copy of the application's module tree.
async function original(name) {
  const sourceURL = new URL('../src/world/' + name, import.meta.url);
  const baselineURL = new URL('../.visual-round2-baseline/src/world/' + name, import.meta.url);
  const source = readFileSync(baselineURL, 'utf8').replace(/from ['"]([^'"]+)['"]/g, (_, spec) =>
    "from '" + (spec === 'three' ? import.meta.resolve('three') : new URL(spec, sourceURL).href) + "'");
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const [{createVillageScenes: originalScenes}, {createVillageLife: originalLife}] = await Promise.all([
  original('village-scenes.js'), original('village-life.js')
]);
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
const ctx = new Proxy({createRadialGradient: () => ({addColorStop(){}})}, {get: (t,k) => t[k] ?? (() => {})});
globalThis.document = {createElement: () => ({getContext: () => ctx})};
const river = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points), 160));
const height = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from({length: grid.attributes.position.count}, (_, i) =>
  height(grid.attributes.position.getX(i), grid.attributes.position.getZ(i)));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const village = createVillage(structuredClone(world.village), field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const cliff = createCliff(world.cliff, field);
const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const args = [world, field, river, village, props, cliff, hinterland];
const scenes = createVillageScenes(...args), oldScenes = originalScenes(...args);
const life = createVillageLife(...args, scenes, {sites: []});
const oldLife = originalLife(...args, oldScenes, {sites: []});
for (const key of ['scenes','nature','paths','details','blockers','mapData']) assert.deepEqual(scenes[key], oldScenes[key], key + ' unchanged');
for (const key of ['items','counts','blockers','mapData']) assert.deepEqual(life[key], oldLife[key], key + ' unchanged');
const repeatScenes = createVillageScenes(...args), repeatLife = createVillageLife(...args, repeatScenes, {sites: []});
assert.deepEqual(scenes.richness, repeatScenes.richness, 'detail records deterministic without consuming placement RNG');
assert.deepEqual(life.richness, repeatLife.richness);
for (const [a,b] of [[scenes,repeatScenes],[life,repeatLife]]) for (let i=0;i<a.group.children.length;i++) {
  for (const attr of ['position','normal','color']) assert.deepEqual(a.group.children[i].geometry.attributes[attr].array,
    b.group.children[i].geometry.attributes[attr].array, 'deterministic emitted ' + attr);
}
const expected = ['grain-drying-tray','tea-leaf-tray','peach-harvest','bamboo-field-tools',
  'ribbed-washboard','folded-household-linen','potter-hand-tools'];
assert.deepEqual(scenes.richness.map(d => d.category), expected, 'coherent farm, harvest, household and craft categories');
assert.equal(life.richness.filter(d => d.category === 'masonry-winch-well').length, life.counts.well);
assert.equal(life.richness.filter(d => d.category === 'plank-gabled-coop').length, life.counts.chickenCoop);
assert(life.counts.well >= 2 && life.counts.chickenCoop >= 2, 'both refined structures actually placed');
const localPoint = (p, source) => {
  const dx=p.x-source.x, dz=p.z-source.z, ca=Math.cos(source.rot), sa=Math.sin(source.rot);
  return [dx*ca-dz*sa,p.y,dx*sa+dz*ca];
};
function vertices(system, record) {
  const points=[];
  for (const range of record.ranges) {
    const geometry=system.group.getObjectByName(system.group.name+'-'+range.batch).geometry;
    assert(range.start>=0 && range.count>0 && range.start+range.count<=geometry.attributes.position.count);
    for(let i=range.start;i<range.start+range.count;i++) points.push(new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,i));
  }
  assert.equal(points.length/3,record.triangles,'audit ranges represent real geometry');
  return points;
}
for (const system of [scenes,life]) {
  for(const mesh of system.group.children){
    const g=mesh.geometry, p=g.attributes.position, n=g.attributes.normal, c=g.attributes.color;
    assert.equal(c.count,p.count); assert.equal(n.count,p.count);
    for(const a of [p,n,c]) assert(a.array.every(Number.isFinite));
    for(let i=0;i<c.count;i++) {
      assert(c.getX(i)+c.getY(i)+c.getZ(i)>0.025,'no inadvertent pure black material/attribute fallback');
      assert(Math.abs(new THREE.Vector3().fromBufferAttribute(n,i).length()-1)<0.002,'unit normals');
    }
    assert(mesh.material.isMeshLambertMaterial && !mesh.material.map && !mesh.material.normalMap, 'existing lightweight untextured batch');
  }
  for(const record of system.richness){
    assert(record.triangles>=50,record.category+' contains visible modeled forms, not renamed metadata');
    const source=system===scenes?scenes.scenes.find(s=>s.id===record.source):
      life.items.find((s,i)=>s.kind+'-'+i===record.source);
    assert(source,'detail belongs to an already reserved site');
    const points=vertices(system,record);
    let radius=0;
    for(const p of points){
      const q=localPoint(p,source);radius=Math.max(radius,Math.hypot(q[0],q[2]));
      assert(Math.hypot(q[0],q[2])<=source.radius+0.00004,record.category+' stays inside existing footprint');
    }
    assert(Math.abs(radius-record.radius)<0.00004,'recorded radius matches final Float32 geometry');
    if(system===scenes)for(let i=0;i<points.length;i+=3){
      const q=points.slice(i,i+3).map(p=>localPoint(p,source));
      const minX=Math.min(...q.map(p=>p[0])),maxX=Math.max(...q.map(p=>p[0]));
      const minZ=Math.min(...q.map(p=>p[2])),maxZ=Math.max(...q.map(p=>p[2]));
      assert(!(minX<0.5 && maxX>-0.5 && minZ<3.55 && maxZ>0.8),record.category+' leaves full central doorway/walking lane clear');
    }
  }
}
// Ray tests examine the actual merged new well/coop ranges, not helper names.
for(const record of life.richness){
  const item=life.items.find((s,i)=>s.kind+'-'+i===record.source), positions=vertices(life,record).flatMap(p=>p.toArray());
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld();
  const toWorld=(x,y,z)=>new THREE.Vector3(item.x+Math.cos(item.rot)*x+Math.sin(item.rot)*z,y,item.z-Math.sin(item.rot)*x+Math.cos(item.rot)*z);
  const y=field.sample(item.x,item.z);
  if(item.kind==='well'){
    assert.equal(new THREE.Raycaster(toWorld(0.28,y+4,0.17),new THREE.Vector3(0,-1,0)).intersectObject(mesh).length,0,
      'well has a physically open shaft beside winding rope and bucket');
  }else{
    const direction=toWorld(0,0,-1).sub(toWorld(0,0,0)).normalize();
    const hits=new THREE.Raycaster(toWorld(0,y+0.56,2),direction).intersectObject(mesh);
    assert(hits.length && hits[0].distance>2.3,'coop entrance is a real opening with a visible rear wall');
  }
  geometry.dispose();mesh.material.dispose();
}
const addedTriangles=scenes.stats.triangles+life.stats.triangles-oldScenes.stats.triangles-oldLife.stats.triangles;
const addedDraws=scenes.stats.drawCalls+life.stats.drawCalls-oldScenes.stats.drawCalls-oldLife.stats.drawCalls;
assert(addedTriangles<=6000 && addedDraws<=2,'whole-scene net geometry and batch budget');
assert.equal(addedDraws,0,'all detail merged into the original batches');
assert(scenes.stats.triangles<=70000 && life.stats.triangles<=oldLife.stats.triangles,'absolute and no-growth life budgets');
const decorativeTriangles=scenes.richness.reduce((n,d)=>n+d.triangles,0);
const modeledTriangles=decorativeTriangles+life.richness.reduce((n,d)=>n+d.triangles,0);
assert(decorativeTriangles>=900 && decorativeTriangles<=3000,'substantial agricultural/domestic detail at a bounded gross cost');
assert(modeledTriangles<=6000,'even complete replacement structures plus new decorations fit the gross geometry allowance');
console.log(JSON.stringify({status:'passed',categories:expected,refinedWells:life.counts.well,refinedCoops:life.counts.chickenCoop,
  addedDraws,addedTriangles,decorativeTriangles,modeledTriangles,scenes:scenes.stats,baselineScenes:oldScenes.stats,life:life.stats,baselineLife:oldLife.stats,
  closeups:scenes.scenes.map(s=>({id:s.id,x:s.x,y:s.y,z:s.z,rot:s.rot,approach:s.approach})),
  structures:life.items.filter(i=>i.kind==='well'||i.kind==='chickenCoop')}));
