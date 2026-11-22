import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createFlora } from '../src/world/flora.js';
import { createReeds } from '../src/world/reeds.js';
import { createBoats } from '../src/world/boats.js';
import { createCliff } from '../src/world/cliff.js';
import { segmentDistance } from '../src/world/hinterland.js';
import { createBarrier } from '../src/systems/barrier.js';
import { sightBlocked } from '../src/systems/observation.js';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { buildExteriorGeometry } from '../src/world/exterior-geometry.js';
import { createExteriorExploration, planExteriorExploration, exteriorSiteSafe, exteriorEdgeSafe, exteriorViewSafe } from '../src/world/exterior-exploration.js';

const world=JSON.parse(readFileSync(new URL('../src/data/world.json',import.meta.url)));
const curve=createRiverCurve(world.stream.points),river=createRiverDistance(sampleRiverSpine(curve,160));
const h=createHeightFunction(world.terrain,river);
const grid=new THREE.PlaneGeometry(world.terrain.size,world.terrain.size,world.terrain.segments,world.terrain.segments);grid.rotateX(-Math.PI/2);
const heights=Float32Array.from({length:grid.attributes.position.count},(_,i)=>h(grid.attributes.position.getX(i),grid.attributes.position.getZ(i)));
const field=new Heightfield(world.terrain.size,world.terrain.segments,heights),cliff=createCliff(world.cliff,field),basin=world.terrain.basin;
const floraField={half:field.half,sample:(x,z)=>field.sample(x,z),slope:(x,z)=>Math.hypot(x-basin.x,z-basin.z)<basin.inner*1.05?9:field.slope(x,z)};
// Match main's close-tree selection, including the road corridor. This influences real crown geometry.
const near=(x,z)=>Math.hypot(x-world.player.spawn.x,z-world.player.spawn.z)<34||Math.hypot(x-cliff.slit.x,z-cliff.slit.z)<40||world.village.road.points.some((p,i,a)=>i&&segmentDistance(x,z,a[i-1],p)<20);
const flora=createFlora(world.flora,floraField,river,curve,world.player.spawn,near);
const reeds=createReeds(world.reeds,field,curve,world.terrain);
const boats=createBoats(world.boats,{surfaceY:()=>world.terrain.waterLevel},world.terrain,curve,field);
function digest(objects){
  const hash=createHash('sha256');
  for(const obj of objects)obj.traverse(o=>{
    hash.update(o.name);hash.update(JSON.stringify({p:o.position.toArray(),r:o.rotation.toArray(),s:o.scale.toArray(),count:o.count}));
    for(const a of [...Object.values(o.geometry?.attributes||{}),o.geometry?.index,o.instanceMatrix,o.instanceColor].filter(Boolean))hash.update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));
  });return hash.digest('hex');
}
const inputsBefore=JSON.stringify(world),fieldBefore=Buffer.from(heights.buffer).toString('hex'),oldBefore=digest([flora.group,reeds.group,boats.group,cliff.group]);
const out=createExteriorExploration(world,field,river,curve,flora,boats,cliff),{layout}=out,{context}=layout,{cfg}=context;
const again=createExteriorExploration(world,field,river,curve,flora,boats,cliff);
for(const key of ['stops','paths','nature','rejected','reservations'])assert.deepEqual(layout[key],again.layout[key],key+' deterministic');
assert.equal(digest([out.group]),digest([again.group]),'rendered geometry deterministic');
assert.equal(JSON.stringify(world),inputsBefore,'old configuration untouched');
assert.equal(Buffer.from(heights.buffer).toString('hex'),fieldBefore,'height field untouched');
assert.equal(digest([flora.group,reeds.group,boats.group,cliff.group]),oldBefore,'old geometry/instances/placements untouched');
const layoutFingerprint=createHash('sha256').update(JSON.stringify(Object.fromEntries(['stops','paths','nature','rejected','reservations'].map(key=>[key,layout[key]])))).digest('hex');
const natureFingerprint=createHash('sha256');
for(const detail of out.details)for(const [batch,range] of Object.entries(detail.geometryRanges)){
  if(!range.count)continue;
  const geometry=out.group.getObjectByName('exterior-exploration-'+batch).geometry;
  for(const attribute of ['position','color'])natureFingerprint.update(Buffer.from(geometry.attributes[attribute].array.slice(range.start*3,(range.start+range.count)*3).buffer));
}
const natureGeometryFingerprint=natureFingerprint.update(JSON.stringify(out.blockers)).digest('hex');
// The scenery refinement deliberately repositions trees and the shallow bank.
// Keep the historical route-refinement snapshot on its explicit legacy fixture;
// the active world still undergoes EVERY physical/visibility assertion below.
const legacyWorld={...world,terrain:{...world.terrain,shoreline:undefined},flora:{...world.flora,groveLayout:false}};
const legacyH=createHeightFunction(legacyWorld.terrain,river);
const legacyHeights=Float32Array.from({length:grid.attributes.position.count},(_,i)=>legacyH(grid.attributes.position.getX(i),grid.attributes.position.getZ(i)));
const legacyField=new Heightfield(world.terrain.size,world.terrain.segments,legacyHeights);
const legacyFloraField={half:legacyField.half,sample:(x,z)=>legacyField.sample(x,z),slope:(x,z)=>Math.hypot(x-basin.x,z-basin.z)<basin.inner*1.05?9:legacyField.slope(x,z)};
const legacyFlora=createFlora(legacyWorld.flora,legacyFloraField,river,curve,world.player.spawn,near);
const legacyCliff=createCliff(world.cliff,legacyField);
const legacyBoats=createBoats(world.boats,{surfaceY:()=>world.terrain.waterLevel},legacyWorld.terrain,curve,legacyField);
const legacyOut=createExteriorExploration(legacyWorld,legacyField,river,curve,legacyFlora,legacyBoats,legacyCliff);
const oldFingerprint=createHash('sha256').update(JSON.stringify(Object.fromEntries(['stops','paths','nature','rejected','reservations'].map(key=>[key,legacyOut.layout[key]])))).digest('hex');
const oldNatureHash=createHash('sha256');
for(const detail of legacyOut.details)for(const [batch,range] of Object.entries(detail.geometryRanges)){
  if(!range.count)continue;
  const geometry=legacyOut.group.getObjectByName('exterior-exploration-'+batch).geometry;
  for(const attribute of ['position','color'])oldNatureHash.update(Buffer.from(geometry.attributes[attribute].array.slice(range.start*3,(range.start+range.count)*3).buffer));
}
assert.equal(oldFingerprint,'1309bfc9b9963cd649fd7e5d196d42a0d62d89b69914e10c3ffeccfdc431d661','legacy fixture preserves all prior route-refinement placement/reservation data');
assert.equal(oldNatureHash.update(JSON.stringify(legacyOut.blockers)).digest('hex'),'c580a4842ba24827ca4f026343cc02ac6f6e35938e456a33e0f2cdf537e37671','legacy fixture preserves all non-route prop geometry/blockers');
legacyOut.dispose();
assert.equal(layout.stops.length,3,'three meaningful connected stops');assert.equal(layout.paths.length,3);assert.equal(layout.rejected.length,0);
assert.equal(layout.reservations.trees.length,flora.count,'every actual tree crown reserved');
assert.equal(layout.reservations.landings.length,world.boats.boats.length,'every actual mooring reserved');
assert.equal(layout.reservations.corridors.length,world.boats.boats.length,'every rope reserved');
assert.equal(layout.reservations.circles.filter(c=>/^boat-\d+$/.test(c.source)).length,3,'full fitted hulls reserved');
// Independently verify the complete transformed crown vertices fit each reservation.
const matrix=new THREE.Matrix4(),combined=new THREE.Matrix4(),vertex=new THREE.Vector3();let crownVertices=0;
flora.group.traverse(mesh=>{
  if(!mesh.isInstancedMesh||!/^tree-/.test(mesh.name))return;
  for(let instance=0;instance<mesh.count;instance++){
    const reservation=layout.reservations.trees.find(t=>t.source===mesh.name+':'+instance);assert.ok(reservation);
    mesh.getMatrixAt(instance,matrix);combined.multiplyMatrices(mesh.matrixWorld,matrix);
    const p=mesh.geometry.attributes.position;
    for(let j=0;j<p.count;j++){
      vertex.fromBufferAttribute(p,j).applyMatrix4(combined);
      assert.ok(Math.hypot(vertex.x-reservation.x,vertex.z-reservation.z)<=reservation.r+1e-6,'full transformed crown fits reservation');crownVertices++;
    }
  }
});
const mooringPositions=boats.group.getObjectByName('boat-moorings').geometry.attributes.position;
for(const landing of layout.reservations.landings){
  let poleDistance=Infinity,bowDistance=Infinity;
  for(let j=0;j<mooringPositions.count;j++){
    poleDistance=Math.min(poleDistance,Math.hypot(mooringPositions.getX(j)-landing.x,mooringPositions.getZ(j)-landing.z));
    bowDistance=Math.min(bowDistance,Math.hypot(mooringPositions.getX(j)-landing.bow[0],mooringPositions.getZ(j)-landing.bow[1]));
  }
  assert.ok(poleDistance<=world.boats.mooring.poleRadius+0.01,'reservation matches real rendered mooring pole');
  assert.ok(bowDistance<0.04,'reserved rope endpoint matches real boat bow');
}
assert.deepEqual(out.mapData.paths,layout.paths,'map and physical trail use identical points');
assert.deepEqual(out.mapData.stops.map(s=>[s.x,s.z]),layout.stops.map(s=>[s.x,s.z]),'map stop positions equal physical stops');
const peach=flora.spots.reduce((a,b)=>!a||Math.hypot(b[0]-16,b[2]-120)<Math.hypot(a[0]-16,a[2]-120)?b:a,null);
const peachStop=layout.stops.find(s=>s.kind==='peach');
assert.ok(Math.hypot(peachStop.target.x-peach[0],peachStop.target.z-peach[2])<1e-8,'quiet stop faces actual quiet peach');
assert.ok(Math.hypot(peachStop.x-peach[0],peachStop.z-peach[2])<11,'peach is nearby, not map-only');
assert.ok(river(world.player.spawn.x,world.player.spawn.z)<world.stream.halfWidth,'fixture exercises genuinely dry terrain inside nominal water width');
assert.ok(exteriorSiteSafe(world.player.spawn.x,world.player.spawn.z,cfg.pathWidth/2+0.42,context),'spawn usable without wet-path relaxation');
const dry=world.terrain.waterLevel+Math.max(cfg.dryMargin,world.stream.waveAmp+cfg.bankMargin);
const barrier=createBarrier([...cliff.blockers,...out.blockers]);
let pathSamples=0,vertexSamples=0;
for(let pi=0;pi<layout.paths.length;pi++){
  const path=layout.paths[pi],stop=layout.stops[pi],expected=pi?[layout.stops[pi-1].x,layout.stops[pi-1].z]:[world.player.spawn.x,world.player.spawn.z];
  assert.deepEqual(path.points[0],expected,'trail joins previous real standing pocket');
  assert.deepEqual(path.points.at(-1),[stop.x,stop.z],'trail reaches standing center');
  assert.ok(exteriorSiteSafe(stop.x,stop.z,stop.radius,context,true));
  assert.ok(exteriorViewSafe({x:stop.x,y:stop.y+world.player.eyeHeight,z:stop.z},stop.target,context,stop.targetTreeSource),'actual tree triangles leave reward visible');
  assert.equal(sightBlocked({x:stop.x,y:stop.y+world.player.eyeHeight,z:stop.z},stop.target,[...context.reservations.boxes,...out.blockers],field),false,'new solids never close reward view');
  for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(len/0.2),nx=-(b[1]-a[1])/len,nz=(b[0]-a[0])/len;
    assert.ok(exteriorEdgeSafe(a,b,path.width/2+0.42,context),'entire edge plus player radius safe');
    for(let j=0;j<=n;j++){
      const x=a[0]+(b[0]-a[0])*j/n,z=a[1]+(b[1]-a[1])*j/n;
      for(const side of [-1,0,1]){
        const sx=x+nx*path.width/2*side,sz=z+nz*path.width/2*side,state={x:sx,z:sz,vx:1,vz:1};
        assert.ok(field.sample(sx,sz)>=dry,'dry whole width');assert.ok(field.slope(sx,sz)<=cfg.maxSlope,'walkable whole width');
        barrier.resolve(state,0.42);assert.ok(Math.hypot(state.x-sx,state.z-sz)<1e-8,'shared collision leaves entire path width free');
        for(const c of context.reservations.circles)assert.ok(Math.hypot(sx-c.x,sz-c.z)>=c.r+0.42+cfg.clearance-1e-6,'no full crown, landing or hull intrusion');
        pathSamples++;
      }
    }
  }
}
for(const p of layout.nature){
  assert.ok(exteriorSiteSafe(p.x,p.z,p.radius,context,true),'full optional object footprint safe');
  for(const path of layout.paths)for(let j=1;j<path.points.length;j++)assert.ok(segmentDistance(p.x,p.z,path.points[j-1],path.points[j])>=p.radius+path.width/2+0.85-1e-8,'object leaves path shoulders open');
  for(const stop of layout.stops){
    assert.ok(Math.hypot(p.x-stop.x,p.z-stop.z)>=p.radius+stop.radius+0.8-1e-8,'standing pocket empty');
    assert.ok(segmentDistance(p.x,p.z,[stop.x,stop.z],[stop.target.x,stop.target.z])>=p.radius+0.5-1e-8,'view corridor reserved');
  }
}
for(const item of out.details)for(const [batch,range] of Object.entries(item.geometryRanges)){
  const p=out.group.getObjectByName('exterior-exploration-'+batch)?.geometry.attributes.position;
  if(!range.count)continue;assert.ok(p,'declared visual batch exists');
  for(let i=range.start;i<range.start+range.count;i++)assert.ok(Math.hypot(p.getX(i)-item.x,p.getZ(i)-item.z)<=item.radius+1e-5,'entire rendered prop fits validated footprint');
}
// Independently interpolate the actual PlaneGeometry triangles (not the bilinear physics surface).
function renderedY(x,z){
  const fx=(x+field.half)/field.step,fz=(z+field.half)/field.step,ix=Math.floor(fx),iz=Math.floor(fz),s=field.segments+1,u=fx-ix,v=fz-iz;
  const a=heights[iz*s+ix],b=heights[iz*s+ix+1],c=heights[(iz+1)*s+ix],d=heights[(iz+1)*s+ix+1];
  return u+v<=1?a*(1-u-v)+b*u+c*v:d*(u+v-1)+b*(1-v)+c*(1-u);
}
// Inspect emitted route vertices directly: common endpoints also at bends, no tiled gaps/steps or pink markers.
let ribbonJoins=0;
function assertRibbon(paths,terrain){
  const ribbon=buildExteriorGeometry({paths,stops:[],nature:[]},terrain,cfg),mesh=ribbon.group.children[0];
  const p=mesh.geometry.attributes.position,c=mesh.geometry.attributes.color,earth=new THREE.Color('#B79E78');
  const at=i=>[p.getX(i),p.getY(i),p.getZ(i)];let offset=0;
  for(const path of paths){
    const quads=path.points.slice(1).reduce((sum,b,i)=>sum+Math.ceil(Math.hypot(b[0]-path.points[i][0],b[1]-path.points[i][1])/0.5),0);
    for(let q=0;q<quads;q++){
      const i=offset+q*6;
      if(q){assert.deepEqual(at(i),at(i-1),'same left edge vertex across adjoining tiles and bends');assert.deepEqual(at(i+1),at(i-2),'same right edge vertex across adjoining tiles and bends');ribbonJoins++;}
      for(let j=i;j<i+6;j++){
        const point=at(j),nearest=Math.min(...path.points.slice(1).map((b,k)=>segmentDistance(point[0],point[2],path.points[k],b)));
        assert.ok(nearest<=path.width/2+1e-5,'taper/bend geometry stays within original validated route width');
        assert.ok(Math.abs(c.getX(j)-earth.r)<1e-6&&Math.abs(c.getY(j)-earth.g)<1e-6&&Math.abs(c.getZ(j)-earth.b)<1e-6,'restrained earth tone without dark stripes/pink squares');
      }
    }
    // Both ends soften into the standing pads instead of ending in full-width plank edges.
    const width=i=>Math.hypot(p.getX(i)-p.getX(i+1),p.getZ(i)-p.getZ(i+1));
    if(quads>10)assert.ok(width(offset)<width(offset+Math.floor(quads/2)*6),'route entrance tapers naturally');
    offset+=quads*6;
  }
  assert.equal(p.count,offset,'exactly two triangles per connected ribbon span, no extra waypoint squares');ribbon.dispose();
}
assertRibbon(layout.paths,field);
assertRibbon([{points:[[0,0],[0,6],[6,6]],width:1.25}],{sample:()=>2});
let triangles=0,minVisualClearance=Infinity;
for(const mesh of out.group.children){
  const {position,color,normal}=mesh.geometry.attributes;
  assert.ok(mesh.material.isMeshLambertMaterial&&mesh.material.vertexColors&&!mesh.material.transparent,'static opaque vertex-colour Lambert');
  assert.equal(mesh.material.onBeforeCompile,THREE.Material.prototype.onBeforeCompile,'no custom shader');
  assert.equal(mesh.matrixAutoUpdate,false,'static baked transforms');assert.equal(position.count,color.count);assert.equal(position.count,normal.count);
  triangles+=position.count/3;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
    assert.ok([x,y,z,color.getX(i),normal.getX(i)].every(Number.isFinite),'finite positions/colors/normals');
    assert.ok(field.sample(x,z)>=dry-1e-5,'all rendered vertices dry');
    assert.ok(Math.hypot(x,z)<=world.player.boundsRadius-cfg.boundsMargin,'all rendered vertices inside radial bound');
    assert.ok(y>=Math.max(field.sample(x,z),renderedY(x,z))-1e-5,'no buried rendered vertices');vertexSamples++;
  }
  if(mesh.name.endsWith('-ground'))for(let i=0;i<position.count;i+=3){
    const x=(position.getX(i)+position.getX(i+1)+position.getX(i+2))/3,z=(position.getZ(i)+position.getZ(i+1)+position.getZ(i+2))/3;
    const y=(position.getY(i)+position.getY(i+1)+position.getY(i+2))/3,clear=y-renderedY(x,z);minVisualClearance=Math.min(minVisualClearance,clear);
    assert.ok(clear>=-0.015,'route triangle interior follows rendered terrain, not buried');
  }
}
assert.equal(triangles,out.getStats().triangles);assert.ok(triangles<=4500);assert.ok(out.group.children.length<=3);
assert.equal(out.details.length,layout.nature.length,'all default planned props actually rendered');
for(const b of out.blockers){
  assert.ok([b.x,b.z,b.hw,b.hd,b.rot,b.minY,b.maxY].every(Number.isFinite));
  const state={x:b.x,z:b.z,vx:1,vz:1};barrier.resolve(state,0.42);assert.ok(Math.hypot(state.x-b.x,state.z-b.z)>0.05,'new solid stops player');
  assert.equal(sightBlocked({x:b.x-4*Math.cos(b.rot),z:b.z+4*Math.sin(b.rot),y:(b.minY+b.maxY)/2},{x:b.x+4*Math.cos(b.rot),z:b.z-4*Math.sin(b.rot),y:(b.minY+b.maxY)/2},[b],{sample:()=>-100}),true,'new solid participates in LOS');
}
const scene=new THREE.Scene();scene.add(out.group);const visibility=optimizeStaticVisibility(scene);
assert.equal(visibility.getStats().staticMeshes,3,'three audited baked batches accepted by actual static helper');visibility.dispose();
const disabled=createExteriorExploration({...world,exploration:{enabled:false}},field,river,curve,flora,boats,cliff);
assert.equal(disabled.group.children.length,0);assert.equal(disabled.blockers.length,0);assert.equal(disabled.layout.stops.length,0);assert.equal(disabled.getStats().triangles,0);
const wet={sample:()=>world.terrain.waterLevel-3,slope:()=>0};
const failed=planExteriorExploration(world,wet,river,curve,flora,boats,cliff);
assert.equal(failed.stops.length,0,'unsafe candidate honestly skipped');assert.equal(failed.paths.length,0);assert.equal(failed.rejected.length,3);
assert.equal(exteriorSiteSafe(NaN,120,1,context),false);assert.equal(exteriorSiteSafe(220,100,1,context),false);
const edgeContext={...context,field:{sample:(x)=>Math.abs(x-30)<0.2?-10:2,slope:()=>0},reservations:{circles:[],boxes:[],corridors:[]},queryCircles:()=>[]};
assert.equal(exteriorEdgeSafe([28,100],[32,100],0.4,edgeContext),false,'dry endpoints cannot hide wet intermediate edge');
const tree=context.reservations.trees[0];assert.equal(exteriorSiteSafe(tree.x,tree.z,0.1,context),false,'crown rejected');
const landing=context.reservations.landings[0];assert.equal(exteriorSiteSafe(landing.x,landing.z,0.1,context),false,'landing rejected');
const viewWall=new THREE.Mesh(new THREE.BoxGeometry(1,4,4),new THREE.MeshLambertMaterial());viewWall.position.set(5,2,100);
const viewGroup=new THREE.Group();viewGroup.add(viewWall);viewGroup.updateMatrixWorld(true);
assert.equal(exteriorViewSafe({x:0,y:2,z:100},{x:10,y:2,z:100},{...context,field:{sample:()=>-100},flora:{group:viewGroup},reservations:{boxes:[]}}),false,'actual intervening geometry blocks reward view');
const smaller=createExteriorExploration({...world,exploration:{...world.exploration,maxTriangles:900}},field,river,curve,flora,boats,cliff);
assert.ok(smaller.getStats().triangles<=900);assert.equal(smaller.layout.stops.length,3,'budget sheds optional nature, not usable stops');
assert.ok(smaller.details.length<smaller.layout.nature.length,'budget clipping is visible in rendered stats');
let disposals=0;again.group.traverse(o=>{if(o.geometry)o.geometry.addEventListener('dispose',()=>disposals++);});again.dispose();again.dispose();assert.equal(disposals,3,'idempotent resource cleanup');
console.log(JSON.stringify({ok:true,...out.getStats(),pathSamples,vertexSamples,crownVertices,ribbonJoins,minVisualClearance,stops:layout.stops.map(({id,x,z})=>({id,x,z})),oldGeometryUnchanged:true,staticManaged:3,disabled:true,unsafeSkip:true,budgetDegrades:true}));
