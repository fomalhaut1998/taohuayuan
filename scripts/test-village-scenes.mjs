import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createHeightFunction,createRiverDistance} from '../src/world/terrain.js';
import {createRiverCurve,sampleRiverSpine} from '../src/world/stream.js';
import {Heightfield} from '../src/player/collision.js';
import {createVillage} from '../src/world/village.js';
import {createProps} from '../src/world/props.js';
import {createCliff} from '../src/world/cliff.js';
import {createHinterland,hinterlandSiteSafe,segmentDistance} from '../src/world/hinterland.js';
import {createBarrier} from '../src/systems/barrier.js';
import {drawVillageScenes,projectionFor} from '../src/systems/mapdraw.js';
const config=JSON.parse(readFileSync(new URL('../src/data/village-scenes.json',import.meta.url)));
import {planVillageScenes,createVillageScenes,villageSceneSiteSafe} from '../src/world/village-scenes.js';
const world=JSON.parse(readFileSync(new URL('../src/data/world.json',import.meta.url)));
const ctx=new Proxy({}, {get:()=>()=>ctx});
globalThis.document={createElement:()=>({getContext:()=>ctx})};
const river=createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points),160));
const h=createHeightFunction(world.terrain,river);
const grid=new THREE.PlaneGeometry(world.terrain.size,world.terrain.size,world.terrain.segments,world.terrain.segments);grid.rotateX(-Math.PI/2);
const heights=new Float32Array(grid.attributes.position.count);
for(let i=0;i<heights.length;i++)heights[i]=h(grid.attributes.position.getX(i),grid.attributes.position.getZ(i));
const field=new Heightfield(world.terrain.size,world.terrain.segments,heights);
const village=createVillage(world.village,field,world.terrain.pond);
const props=createProps(world.props,field,village.houseInfo,village.plots,village.road);
const cliff=createCliff(world.cliff,field);
const hinterland=createHinterland(world.hinterland,field,river,world,village,props,cliff);
const layout=planVillageScenes(world,field,river,village,props,cliff,hinterland);
for(const key of ['scenes','nature','paths','rejected'])assert.deepEqual(layout[key],planVillageScenes(world,field,river,village,props,cliff,hinterland)[key],key+' deterministic');
assert.equal(layout.scenes.length,3);
assert.equal(layout.rejected.length,0);
assert.equal(layout.nature.length,22);
const out=createVillageScenes(world,field,river,village,props,cliff,hinterland);
assert.ok(out.stats.drawCalls<=config.budget.drawCalls);
assert.ok(out.stats.triangles<=config.budget.triangles);
for(const p of [...out.scenes,...out.nature])assert.ok(out.coverage[p.id].radius <= p.radius, p.id+' actual geometry fits reserved footprint '+out.coverage[p.id].radius);
const objects=[...out.scenes,...out.nature];
for(const p of objects){
  assert.ok(villageSceneSiteSafe(p.x,p.z,p.radius,layout.context),p.id+' whole crown/footprint clear');
  assert.equal(p.y,field.sample(p.x,p.z));
  assert.ok(out.coverage[p.id].maxY>p.y);
}
for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++){
  const a=objects[i],b=objects[j];assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=a.radius+b.radius+0.65-1e-8,'separate scene footprints');
}
const barrier=createBarrier([...cliff.blockers,...village.blockers,...hinterland.blockers,...out.blockers]);
let walkSamples=0;
function free(x,z,label){
  const state={x,z,vx:1,vz:1};barrier.resolve(state,0.42);
  assert.ok(Math.hypot(state.x-x,state.z-z)<1e-8,label+' player free');walkSamples++;
}
function checkPath(path,ground=true){
  for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)continue;
    const n=Math.ceil(len/0.2),nx=-(b[1]-a[1])/len,nz=(b[0]-a[0])/len;
    for(let j=0;j<=n;j++){
      const x=a[0]+(b[0]-a[0])*j/n,z=a[1]+(b[1]-a[1])*j/n;
      if(ground)assert.ok(hinterlandSiteSafe(x,z,path.width/2,layout.context,false),path.id+' full-width safe terrain');
      for(const side of [-1,0,1])free(x+nx*path.width/2*side,z+nz*path.width/2*side,path.id);
      for(const p of out.nature)assert.ok(segmentDistance(p.x,p.z,a,b)>=p.radius+path.width/2+(ground?0.6:world.hinterland.routeMargin)-1e-8,'nature stays clear of paths');
    }
  }
}
for(const path of out.paths)checkPath(path);
// Walk through the front threshold up to the working area (not only the outer access point).
for(const s of out.scenes){
  const point=(x,z)=>[s.x+x*Math.cos(s.rot)+z*Math.sin(s.rot),s.z-x*Math.sin(s.rot)+z*Math.cos(s.rot)];
  checkPath({id:s.id+'-threshold',points:[s.approach,point(0,0.8)],width:0.9});
  assert.ok(out.paths.find(p=>p.id===s.id+'-approach').points.some(p=>Math.hypot(p[0]-s.approach[0],p[1]-s.approach[1])<1e-8));
}
// Adding details cannot make any accepted earlier hinterland route impassable.
for(const path of hinterland.paths)checkPath(path,false);
for(const b of out.blockers){
  assert.ok([b.x,b.z,b.hw,b.hd,b.rot,b.minY,b.maxY].every(Number.isFinite));
  assert.ok(b.hw>0 && b.hd>0 && b.maxY>b.minY);
  const state={x:b.x,z:b.z,vx:0,vz:0};createBarrier([b]).resolve(state,0.42);
  assert.ok(Math.hypot(state.x-b.x,state.z-b.z)>0.42,'solid part collision responds');
}
const again=createVillageScenes(world,field,river,village,props,cliff,hinterland);
assert.deepEqual(out.blockers,again.blockers);
for(let i=0;i<out.group.children.length;i++){
  const mesh=out.group.children[i];
  for(const key of ['position','normal','color']){
    const a=mesh.geometry.attributes[key].array,b=again.group.children[i].geometry.attributes[key].array;
    assert.ok(a.every(Number.isFinite),mesh.name+' finite '+key);assert.deepEqual(a,b,mesh.name+' deterministic '+key);
  }
}
const buffer=out.group.children[0].geometry.attributes.position.array;
const before=buffer.slice();for(let i=0;i<60;i++)out.update(1/60,i/60,{});assert.deepEqual(buffer,before,'static update immutable');
assert.equal(out.mapData.scenes.length,out.scenes.length);assert.equal(out.mapData.nature.length,out.nature.length);
for(const s of out.scenes)assert.deepEqual(out.mapData.scenes.find(p=>p.id===s.id),{...s,footprint:{radius:s.radius}});
const proj=projectionFor(world.map.extent,1120,466),moves=[],ellipses=[];
const mapCtx=new Proxy({}, {get:(_,key)=>(...v)=>{if(key==='moveTo')moves.push(v);if(key==='ellipse')ellipses.push(v);}});
drawVillageScenes(mapCtx,proj,world.map,{villageScenes:out.mapData});
for(const path of out.paths)assert.ok(moves.some(v=>Math.abs(v[0]-proj.px(...path.points[0]))<1e-8&&Math.abs(v[1]-proj.py(...path.points[0]))<1e-8),'map exact accepted approach');
const m=moves.length,e=ellipses.length;drawVillageScenes(mapCtx,proj,world.map,{});assert.equal(moves.length,m);assert.equal(ellipses.length,e);
assert.ok(ellipses.length>10,'actual nature and working scenes projected');
console.log(JSON.stringify({result:'PASS',scenes:out.scenes.map(s=>({id:s.id,x:s.x,z:s.z})),nature:out.nature.length,paths:out.paths.length,walkSamples,blockers:out.blockers.length,...out.stats}));

