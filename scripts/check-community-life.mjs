import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails, habitatSurface } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCommunityLife } from '../src/systems/community-life.js';
import { observationScore, sightBlocked } from '../src/systems/observation.js';
const kinds=['wash','trap','elder','child-grass','child-stones','child-top','beekeeper','liubo'];
const field={half:200,sample:()=>1,slope:()=>0};
const world={terrain:{waterLevel:0,pond:{x:100,z:100,radius:4,waterY:0}}};
const stations=kinds.map((kind,i)=>({kind,x:i*5,y:1,z:0,yaw:0,path:[{x:i*5,y:1,z:-.6},{x:i*5,y:1,z:0}]}));
const prop=new THREE.Group();prop.name='owned-by-scenery-trap';prop.position.set(5,1.6,.6);stations[1].prop=prop;
const source=new THREE.Group(),people={list:[{role:'elder',x:0,z:2}],group:source};const identity=people.list[0];
const before=JSON.stringify({world,stations:stations.map(({prop,...s})=>s),people});
const calls=[];const sound={wood:(x,z)=>{assert.ok(Number.isFinite(x)&&Number.isFinite(z));calls.push([x,z]);}};
const out=createCommunityLife({world,field,stations,sound,blockers:[]});
assert.equal(out.group.name,'community-life');
assert.deepEqual(out.getStats().kinds,kinds.reduce((a,k)=>(a[k]=1,a),{}));
assert.equal(out.getStats().actors,8);assert.ok(out.getStats().drawCalls<=16);
const snap=()=>JSON.stringify({stats:out.getStats(),mat:out.group.children.filter(m=>m.isInstancedMesh).map(m=>Array.from(m.instanceMatrix.array)),p:prop.position.toArray()});
for(const dt of [0,-1,NaN,Infinity]){const b=snap();out.update(dt,1e10,{night:1,rain:1},{});assert.equal(snap(),b,'invalid dt freezes transforms clock events and sound');}
for(let i=0;i<10000;i++)out.update(.05,i*.05,{night:0,rain:0},{});
assert.ok(calls.length>=2,'causal wash impacts audible');assert.ok(calls.length<150,'no frantic audio loop');
const stats=out.getStats();for(const kind of kinds)assert.ok(stats.completed[kind]>0,kind+' completes work/rest turn');
assert.ok(stats.events.washImpact>0);assert.ok(stats.events.topWhip>0);assert.ok(stats.events.stoneLand>0);assert.ok(stats.events.honeyCut>0);assert.ok(stats.events.trapCheck>0);assert.ok(stats.events.liuboMove>0);
for(const mesh of out.group.children.filter(m=>m.isMesh)){assert.ok(mesh.material.vertexColors);assert.ok(mesh.geometry.attributes.color);assert.equal(mesh.material.transparent,false);for(const a of [mesh.geometry.attributes.position.array,mesh.instanceMatrix?.array,mesh.instanceColor?.array].filter(Boolean))assert.ok([...a].every(Number.isFinite));}
assert.equal(JSON.stringify({world,stations:stations.map(({prop,...s})=>s),people}),before);assert.equal(people.list[0],identity);
const e0=JSON.stringify(stats.events),c0=calls.length;
for(let i=0;i<400;i++)out.update(.05,1e9,{night:1,rain:1},{});
assert.equal(JSON.stringify(out.getStats().events),e0,'night/rain stops new work events');assert.equal(calls.length,c0);assert.equal(out.getStats().resting,8);assert.ok(out.group.visible);
const t=out.getStats().clock;out.update(1000000,1e12,{night:0,rain:0},{});assert.ok(out.getStats().clock-t<=.05000001,'clamp, not catchup');
const bad=createCommunityLife({world,field,stations:[{kind:'elder',x:0,y:1,z:0,yaw:0},{kind:'trap',x:5,y:1,z:0,yaw:0,path:[{x:5,z:-5},{x:5,z:0}]}],blockers:[{x:0,z:0,hw:1,hd:1,rot:0},{x:5,z:-2.5,hw:1,hd:.2,rot:0}]});
assert.equal(bad.getStats().actors,1,'blocked station rejected');assert.equal(bad.getStats().pathsRejected,1,'unsafe path downgraded to safe stationary work');
const dry=createCommunityLife({world,field:{sample:()=>-.5,slope:()=>0},stations});assert.equal(dry.getStats().actors,0,'wet placements rejected');
const pondWet=createCommunityLife({world:{terrain:{waterLevel:-2,pond:{x:0,z:0,radius:4,waterY:1.2}}},field,stations:[stations[0]]});assert.equal(pondWet.getStats().actors,0,'pond water height, not main river height, rejects submerged actor');pondWet.dispose();
const steep=createCommunityLife({world,field:{sample:(x,z)=>1+Math.abs(z)*3,slope:()=>3},stations});assert.equal(steep.getStats().actors,0,'steep placements rejected');
let externalDisposals=0;const borrowed=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshLambertMaterial());borrowed.geometry.addEventListener('dispose',()=>externalDisposals++);borrowed.material.addEventListener('dispose',()=>externalDisposals++);
const borrowedParent=new THREE.Group();borrowedParent.add(borrowed);borrowed.position.set(5,1,.6);const saved=borrowed.position.clone();const own=createCommunityLife({world,field,stations:[{kind:'trap',x:5,y:1,z:0,yaw:0,prop:borrowed}]});for(let i=0;i<200;i++)own.update(.05,0,{},{});own.dispose();own.dispose();assert.equal(externalDisposals,0);assert.equal(borrowed.parent,borrowedParent);assert.ok(borrowed.position.equals(saved),'restore borrowed prop');
const repeat=createCommunityLife({world,field,stations});for(let i=0;i<50;i++)repeat.update(.05,1e9,{},{});const deterministic=createCommunityLife({world,field,stations});for(let i=0;i<50;i++)deterministic.update(.05,0,{},{});assert.deepEqual(repeat.getStats(),deterministic.getStats(),'elapsed input not simulation source');
console.log(JSON.stringify({ok:true,fixture:{actors:stats.actors,drawCalls:stats.drawCalls,triangles:stats.triangles,completed:stats.completed,events:stats.events},woodCalls:calls.length}));for(const o of [out,bad,dry,steep,repeat,deterministic])o.dispose();
// Actual unchanged source constructors, exact main factory order, all final blockers.
{
const world=JSON.parse(readFileSync(new URL('../src/data/world.json',import.meta.url)));
const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get:(t,k)=>t[k]??(()=>{})});
globalThis.document={createElement:()=>({getContext:()=>ctx})};
const curve=createRiverCurve(world.stream.points),river=createRiverDistance(sampleRiverSpine(curve,160));
const height=createHeightFunction(world.terrain,river),grid=new THREE.PlaneGeometry(world.terrain.size,world.terrain.size,world.terrain.segments,world.terrain.segments);grid.rotateX(-Math.PI/2);
const heights=Float32Array.from({length:grid.attributes.position.count},(_,i)=>height(grid.attributes.position.getX(i),grid.attributes.position.getZ(i)));
const field=new Heightfield(world.terrain.size,world.terrain.segments,heights),cliff=createCliff(world.cliff,field),basin=world.terrain.basin;
const floraField={half:field.half,sample:(x,z)=>field.sample(x,z),slope:(x,z)=>Math.hypot(x-basin.x,z-basin.z)<basin.inner*1.05?9:field.slope(x,z)};
const near=(x,z)=>Math.hypot(x-world.player.spawn.x,z-world.player.spawn.z)<34||Math.hypot(x-cliff.slit.x,z-cliff.slit.z)<40||world.village.road.points.some((p,i,a)=>i&&segmentDistance(x,z,a[i-1],p)<20);
const flora=createFlora(world.flora,floraField,river,curve,world.player.spawn,near);
const boats=createBoats(world.boats,{surfaceY:()=>world.terrain.waterLevel},world.terrain,curve,field);
const village=createVillage(structuredClone(world.village),field,world.terrain.pond),props=createProps(world.props,field,village.houseInfo,village.plots,village.road);
const hinterland=createHinterland(world.hinterland,field,river,world,village,props,cliff),scenes=createVillageScenes(world,field,river,village,props,cliff,hinterland);
const mysteryWorld=createMysteries(world,field,river,village,props,cliff,hinterland,scenes,flora);
const life=createVillageLife(world,field,river,village,props,cliff,hinterland,scenes,mysteryWorld);
const exterior=createExteriorExploration(world,field,river,curve,flora,boats,cliff);
const options={world,field,distanceToRiver:river,riverCurve:curve,flora,hinterland,village,villageScenes:scenes,villageLife:life,props,boats,cliff,exterior,mysteryWorld,stream:{surfaceY:()=>world.terrain.waterLevel}};
options.habitatDetails=createHabitatDetails(options);
const sources=[flora,boats,cliff,village,props,hinterland,scenes,mysteryWorld,life,exterior,options.habitatDetails];
const digest=groups=>{const h=createHash('sha256');for(const group of groups)group.traverse(o=>{h.update(o.name);h.update(JSON.stringify([o.position.toArray(),o.rotation.toArray(),o.scale.toArray()]));for(const a of [...Object.values(o.geometry?.attributes||{}),o.geometry?.index,o.instanceMatrix,o.instanceColor].filter(Boolean))h.update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));});return h.digest('hex');};
const sourceBefore=digest(sources.map(s=>s.group)),worldBefore=JSON.stringify(world);
const pond=createPondLife({...options,reservations:[]});
const water=createWaterworks({...options,reservations:[pond]});
const grove=createLeisureGrove({...options,reservations:[pond,water]});
const blockers=cliff.blockers.concat(village.blockers,hinterland.blockers,scenes.blockers,mysteryWorld.blockers,life.blockers,exterior.blockers,pond.blockers,water.blockers,grove.blockers);
const stations=[...pond.stations,...water.stations,...grove.stations];
// Actual discovery anchors must work from ordinary 1.65m dry, collision-free standing eyes.
// This is bounded LOCAL viewpoint evidence, not a claim of global path reachability or camera teleport access.
const requiredIds=['duckweed','lotus','dragonfly','carp','shrimp','pond-watergrass','lotus-rhizome','freshwater-mussel','laundry-stone','harvest-tub','waterwheel','bamboo-irrigation','water-mortar','fish-trap','thatched-pavilion','liubo-board','social-tree','shrine-stone','timber-footbridge','bamboo-shoot','bamboo-conduit','plum-tree','chestnut-tree','bee-barrel'];
const discoveryTargets=[...pond.targets,...water.targets,...grove.targets],views={},missing=[];
function waterAt(x,z){const p=world.terrain.pond;return p&&Math.hypot(x-p.x,z-p.z)<p.radius+.3?Math.max(world.terrain.waterLevel,p.waterY):world.terrain.waterLevel;}
function standable(x,z){
 if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>field.half-.3||Math.abs(z)>field.half-.3)return false;
 const y=habitatSurface(field,x,z);if(!Number.isFinite(y)||field.sample(x,z)<waterAt(x,z)+.025||field.slope(x,z)>.8)return false;
 for(const [dx,dz] of [[.22,0],[-.22,0],[0,.22],[0,-.22]])if(field.sample(x+dx,z+dz)<waterAt(x+dx,z+dz)+.025||Math.abs(habitatSurface(field,x+dx,z+dz)-y)>.27)return false;
 for(const b of blockers){const c=Math.cos(b.rot||0),s=Math.sin(b.rot||0),dx=x-b.x,dz=z-b.z;if(Math.abs(dx*c-dz*s)<b.hw+.22&&Math.abs(dx*s+dz*c)<b.hd+.22&&(b.maxY??Infinity)>y+.05&&(b.minY??-Infinity)<y+1.65)return false;}
 return y;
}
for(const id of requiredIds){
 const anchors=discoveryTargets.filter(t=>t.id===id);let found;
 for(const a of anchors){const resolved=a.resolve?.()||a,target={x:resolved.x,y:resolved.y,z:resolved.z},range=a.range||5.5;
  for(let radius=.9;radius<=Math.min(8,range)&&!found;radius+=.35)for(let j=0;j<96&&!found;j++){
   const angle=j*Math.PI*2/96,x=target.x+Math.cos(angle)*radius,z=target.z+Math.sin(angle)*radius,ground=standable(x,z);if(ground===false)continue;
   const eye={x,y:ground+1.65,z},dx=target.x-x,dy=target.y-eye.y,dz=target.z-z,d=Math.hypot(dx,dy,dz),forward={x:dx/d,y:dy/d,z:dz/d};
   const score=observationScore(eye,forward,target,range,blockers,field);if(Number.isFinite(score)&&!sightBlocked(eye,target,blockers,field))found={target,eye,range,score,distance:d};
  }if(found)break;
 }if(found)views[id]=found;else missing.push({id,anchors:anchors.map(a=>({x:a.x,y:a.y,z:a.z,range:a.range}))});
}
console.log('actual discovery LOS',JSON.stringify({covered:Object.keys(views).length,required:requiredIds.length,missing,views}));
const borrowedStates=stations.flatMap(s=>[s.prop,s.prop?.userData?.wash?.cloth]).filter(Boolean).map(o=>({o,position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone(),parent:o.parent}));
const actor=createCommunityLife({world,field,stations,blockers,sound:{wood:(x,z)=>assert.ok(Number.isFinite(x)&&Number.isFinite(z))}});
let stats=actor.getStats(),maxTriangles=stats.triangles;console.log('actual accepted',JSON.stringify({actors:stats.actors,kinds:stats.kinds,rejected:stats.rejected,pathsRejected:stats.pathsRejected}));
for(const kind of kinds)assert.ok(stats.kinds[kind]>0,kind+' accepted in actual combined all-collider scene');
assert.equal(stats.actors,10);assert.deepEqual(stats.rejected,[]);assert.equal(stats.pathsRejected,0);
assert.equal(stats.placements.filter(p=>p.kind==='liubo'&&p.observer).length,1,'authored second player observes, no duplicate moving piece');
const disposals=new Map(),owned=new Set(actor.group.children.flatMap(o=>[o.geometry,o.material]).filter(Boolean));for(const resource of owned){disposals.set(resource,0);resource.addEventListener('dispose',()=>disposals.set(resource,disposals.get(resource)+1));}
const state=()=>JSON.stringify({stats:actor.getStats(),mat:actor.group.children.map(o=>Array.from(o.instanceMatrix?.array??[])),props:stations.map(s=>s.prop?.position.toArray())});
for(const dt of [0,-1,NaN,Infinity]){const saved=state();actor.update(dt,1e12,{night:1},{});assert.equal(state(),saved);}
const evidence={};let last=actor.getStats().events;
for(let i=0;i<3600;i++){
 actor.update(.05,1e12,{},{});
 {stats=actor.getStats();maxTriangles=Math.max(maxTriangles,stats.triangles);const pair=stats.placements.filter(p=>p.kind==='child-grass');assert.equal(pair.length,2);assert.ok(pair.every(p=>p.partner),'both grass players have an authored partner');assert.equal(pair[0].phase,pair[1].phase);assert.equal(pair[0].phaseTime,pair[1].phaseTime);for(const [key,count] of Object.entries(stats.events))if(count>last[key]&&!evidence[key]){
 const kind=Object.entries({wash:'washImpact',trap:'trapCheck',elder:'elderGesture','child-grass':'grassTug','child-stones':'stoneLand','child-top':'topWhip',beekeeper:'honeyCut',liubo:'liuboMove'}).find(([,v])=>v===key)[0];
 const p=stats.placements.find(p=>p.kind===kind);const s=stations[Number(p.id.split('-').at(-1))];
 evidence[key]={id:p.id,phase:p.phase,root:p.root,contact:p.contact,camera:p.camera};
 assert.ok(Object.values(p.hands).every(h=>Object.values(h).every(Number.isFinite)));
 if(s.prop){s.prop.updateWorldMatrix(true,false);const pos=s.prop.getWorldPosition(new THREE.Vector3());assert.ok(pos.toArray().every(Number.isFinite));evidence[key].prop=pos.toArray();
 if(kind==='wash'){const g=s.prop.userData.wash;const tip=s.prop.localToWorld(new THREE.Vector3(g.strikeLocal.x,g.strikeLocal.y,g.strikeLocal.z));const grip=s.prop.localToWorld(new THREE.Vector3(g.gripLocal.x,g.gripLocal.y,g.gripLocal.z));const target=g.workSurface;assert.ok(tip.distanceTo(new THREE.Vector3(target.x,target.y,target.z))<.015,'bat blade exactly meets wet cloth surface');assert.ok(grip.distanceTo(new THREE.Vector3(p.hands.right.x,p.hands.right.y,p.hands.right.z))<.001,'bat handle exactly meets wrist');evidence[key].tip=tip.toArray();}
 if(kind==='trap'){const grips=s.prop.userData.communityGrip;assert.ok(grips?.left&&grips?.right,'source rim grip metadata present');for(const side of ['left','right']){const g=grips[side],rim=s.prop.localToWorld(new THREE.Vector3(g.x,g.y,g.z)),h=p.hands[side];assert.ok(rim.distanceTo(new THREE.Vector3(h.x,h.y,h.z))<.001,'both hands exactly touch woven basket rim');}evidence[key].grips=grips;}
 if(kind==='liubo')assert.ok(pos.distanceTo(new THREE.Vector3(p.hands.right.x,p.hands.right.y,p.hands.right.z))<.001,'board piece exactly in hand');
 if(kind==='beekeeper'){const c=Math.cos(p.yaw),s=Math.sin(p.yaw),h=p.hands.right;const knifeTip=new THREE.Vector3(h.x+.23*s,h.y-.10,h.z+.23*c);assert.ok(knifeTip.distanceTo(new THREE.Vector3(p.contact.x,p.contact.y,p.contact.z))<.015,'cutting knife tip contacts actual honey surface');evidence[key].knifeTip=knifeTip.toArray();}
 }
 }last=stats.events;}
}
stats=actor.getStats();for(const kind of kinds)assert.ok(stats.completed[kind]>0,kind+' actual turn completion');for(const [key,value] of Object.entries(stats.events))assert.ok(value>0,key+' actual causal event');
assert.ok(stats.drawCalls<=16);assert.equal(digest(sources.map(s=>s.group)),sourceBefore,'actors/additions do not mutate any old geometry or placement');assert.equal(JSON.stringify(world),worldBefore,'config untouched');
const events=JSON.stringify(stats.events);for(let i=0;i<100;i++)actor.update(.05,0,{night:1,rain:1},{});assert.equal(JSON.stringify(actor.getStats().events),events);assert.equal(actor.getStats().resting,stats.actors);
actor.dispose();actor.dispose();for(const count of disposals.values())assert.equal(count,1,'owned geometry/material disposed once');for(const b of borrowedStates){assert.ok(b.o.position.equals(b.position)&&b.o.quaternion.equals(b.quaternion)&&b.o.scale.equals(b.scale),'borrowed transforms restored exactly');assert.equal(b.o.parent,b.parent);}
assert.equal(digest(sources.map(s=>s.group)),sourceBefore);console.log('actual community',JSON.stringify({ok:true,actors:stats.actors,kinds:stats.kinds,drawCalls:stats.drawCalls,triangles:stats.triangles,maxTriangles,completed:stats.completed,events:stats.events,evidence}));
assert.deepEqual(missing,[],'every new catalogue ID has an actual ordinary dry safe eye with finite observationScore and clear LOS');
}
