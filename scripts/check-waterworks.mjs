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
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';
import { planMysterySites } from '../src/world/mysteries.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
const world=JSON.parse(readFileSync(new URL('../src/data/world.json',import.meta.url)));
const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get:(t,k)=>t[k]??(()=>{})});
globalThis.document={createElement:()=>({getContext:()=>ctx})};
const curve=createRiverCurve(world.stream.points),river=createRiverDistance(sampleRiverSpine(curve,160));
const height=createHeightFunction(world.terrain,river),grid=new THREE.PlaneGeometry(world.terrain.size,world.terrain.size,world.terrain.segments,world.terrain.segments);grid.rotateX(-Math.PI/2);
const heights=Float32Array.from({length:grid.attributes.position.count},(_,i)=>height(grid.attributes.position.getX(i),grid.attributes.position.getZ(i)));
const field=new Heightfield(world.terrain.size,world.terrain.segments,heights),cliff=createCliff(world.cliff,field),basin=world.terrain.basin;
const floraField={half:field.half,sample:(x,z)=>field.sample(x,z),slope:(x,z)=>Math.hypot(x-basin.x,z-basin.z)<basin.inner*1.05?9:field.slope(x,z)};
const near=(x,z)=>Math.hypot(x-world.player.spawn.x,z-world.player.spawn.z)<34||Math.hypot(x-cliff.slit.x,z-cliff.slit.z)<40||world.village.road.points.some((p,i,a)=>i&&segmentDistance(x,z,a[i-1],p)<20);
const flora=createFlora(world.flora,floraField,river,curve,world.player.spawn,near),reeds=createReeds(world.reeds,field,curve,world.terrain);
const boats=createBoats(world.boats,{surfaceY:()=>world.terrain.waterLevel},world.terrain,curve,field);
const village=createVillage(structuredClone(world.village),field,world.terrain.pond),props=createProps(world.props,field,village.houseInfo,village.plots,village.road);
const hinterland=createHinterland(world.hinterland,field,river,world,village,props,cliff),scenes=createVillageScenes(world,field,river,village,props,cliff,hinterland);
const sites=planMysterySites(world,field,river,village,props,cliff,hinterland,scenes,flora);
const life=createVillageLife(world,field,river,village,props,cliff,hinterland,scenes,{sites});
const exterior=createExteriorExploration(world,field,river,curve,flora,boats,cliff);
const options={world,field,distanceToRiver:river,riverCurve:curve,flora,hinterland,village,villageScenes:scenes,villageLife:life,props,boats,cliff,exterior};
import { createHabitatDetails,createHabitatContext,habitatSurface,habitatSiteSafe } from '../src/world/habitat-details.js';
const habitatDetails=createHabitatDetails(options); options.habitatDetails=habitatDetails;
const {createPondLife}=await import('../src/world/pond-life.js');
const pondLife=createPondLife(options);options.reservations=[pondLife];
const {createWaterworks}=await import('../src/world/waterworks.js');
const hashSource=source=>{const hash=createHash('sha256');hash.update(JSON.stringify(source.layout||source.houseInfo||source.marks||{}));source.group?.traverse(o=>{if(o.isMesh){for(const [key,a] of Object.entries(o.geometry.attributes)){hash.update(key);hash.update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));}if(o.geometry.index)hash.update(Buffer.from(o.geometry.index.array.buffer));hash.update(JSON.stringify({p:o.position.toArray(),q:o.quaternion.toArray(),s:o.scale.toArray()}));if(o.instanceMatrix)hash.update(Buffer.from(o.instanceMatrix.array.buffer));}});return hash.digest('hex');};
const sources={flora,boats,cliff,village,props,hinterland,scenes,life,exterior,habitatDetails,pondLife};
const hashes=Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,hashSource(v)]));
const worldBefore=JSON.stringify(world),fieldBefore=createHash('sha256').update(Buffer.from(heights.buffer)).digest('hex');
const out=createWaterworks(options),again=createWaterworks(options);
assert.equal(out.getStats().wheels,1,'actual sequential world has one visible wheel');
assert.equal(out.getStats().traps,1,'actual sequential world has one safe trap');
assert.deepEqual(out.layout,again.layout);
assert.ok(out.getStats().triangles<=11000);assert.ok(out.getStats().drawCalls<=14);
assert.deepEqual([...new Set(out.targets.map(t=>t.id))].sort(),['bamboo-irrigation','fish-trap','water-mortar','waterwheel']);
const context=createHabitatContext(options);for(const a of habitatDetails.layout.clusters)context.reservations.circles.push({...a,r:a.radius});
const s=out.layout.wheels[0],station=out.stations[0],tr=out.layout.traps[0];
assert.ok(Math.hypot(s.x-world.cliff.center[0],s.z-world.cliff.center[1])<world.cliff.radius-14,'foothill waterwheel inside basin');
assert.ok(habitatSurface(field,s.x,s.z)>world.terrain.waterLevel,'foothill waterwheel rests above valley terrain');
assert.ok(out.layout.springs?.length===1&&out.layout.springs[0].y>s.y,'uphill mountain springhead feeds foothill wheel');
assert.ok(habitatSiteSafe(station.x,station.z,1.8,context),'entire shore prop footprint safe/dry');
assert.ok(!station.path,'stationary is honest fallback: no unverified walk');
assert.equal(station.prop.userData.communityRole,'trap');
assert.deepEqual(station.prop.userData.communityContact,{x:0,y:.65,z:.65});
for(const grip of Object.values(station.prop.userData.communityGrip)){assert.ok(Math.abs(Math.hypot(grip.x,grip.y-.432)-.288)<1e-9);assert.equal(grip.z,.498);}
assert.ok(tr.throatWidth>=1&&tr.coneThroat<tr.coneMouth);
assert.equal(tr.weirStones?.length,66,'V weir contains 66 actual irregular low river stones');
assert.ok(tr.throatWidth>=1,'stone tips preserve a clear metre of open downstream throat');
const stoneMesh=out.group.getObjectByName('waterworks-stone-v-weir');assert.ok(stoneMesh?.isMesh,'stones have real render geometry, not metadata alone');
let minStoneGap=Infinity;const sp=stoneMesh.geometry.attributes.position;for(let i=0;i<sp.count;i++){const p=new THREE.Vector3().fromBufferAttribute(sp,i);minStoneGap=Math.min(minStoneGap,p.y-habitatSurface(field,p.x,p.z));const cross=(p.x-tr.x)*tr.flow.z-(p.z-tr.z)*tr.flow.x;assert.ok(Math.abs(cross)>=tr.throatWidth/2-1e-5,'stone geometry leaves the whole throat uncapped');}
assert.ok(minStoneGap>=-.081&&minStoneGap<.06,'stones sit on rendered river bed without floating or deep burial');
for(const rock of tr.weirStones){assert.ok(rock.top<=world.terrain.waterLevel+.19,'stone barrier remains low at waterline');assert.ok(rock.top>world.terrain.waterLevel-.05,'stone course is visible above shallow current');assert.ok(out.layout.reservations.some(r=>Math.hypot(r.x-rock.x,r.z-rock.z)+rock.radius<=r.radius+.01),'stone footprint reserved');}
assert.equal(station.handling,'linked-shore-basket-and-haul-line');assert.ok(tr.haulLine.length>20,'continuous actual 12m haul line');
const end=tr.haulLine.at(-1);assert.ok(Math.abs(end.x-station.x-Math.sin(station.yaw)*.65)<1e-6&&Math.abs(end.z-station.z-Math.cos(station.yaw)*.65)<1e-6);
for(const p of tr.haulLine){assert.ok(p.y>=habitatSurface(field,p.x,p.z)+.1499);assert.ok(out.layout.reservations.some(r=>Math.hypot(r.x-p.x,r.z-p.z)<=r.radius+.01));}
assert.ok(station.y>world.terrain.waterLevel+world.stream.waveAmp+.3);
for(const b of out.blockers){const c=Math.cos(b.rot),s=Math.sin(b.rot),dx=station.x-b.x,dz=station.z-b.z;assert.ok(Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-b.hw),Math.max(0,Math.abs(dx*s+dz*c)-b.hd))>.2,'station feet clear physical blockers');}
assert.equal(out.layout.beds[0].kind,'new-demonstration-grain-bed');
for(const conduit of [...out.layout.conduits,...(out.layout.springRaces||[])])for(let i=1;i<conduit.points.length;i++)assert.ok(conduit.points[i].y<conduit.points[i-1].y,'strict downhill flow');
for(const b of out.blockers){assert.ok([b.x,b.z,b.hw,b.hd,b.rot,b.minY,b.maxY].every(Number.isFinite));assert.ok(b.minY<=b.maxY);}
for(const b of out.layout.reservations)assert.ok([b.x,b.z,b.radius].every(Number.isFinite));
for(const t of out.targets)assert.ok([t.x,t.y,t.z,t.range].every(Number.isFinite));
let triangles=0,draws=0;out.group.traverse(o=>{if(o.isMesh){draws++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);assert.equal(o.material.transparent,false);assert.ok(Array.from(o.geometry.attributes.position.array).every(Number.isFinite));}});
assert.equal(triangles,out.getStats().triangles);assert.equal(draws,out.getStats().drawCalls);
const wheel=out.group.getObjectByName('waterworks-wheel-and-cam');let worstGap=Infinity;
for(let j=0;j<24;j++){wheel.rotation.z=j*Math.PI/12;out.group.updateMatrixWorld(true);const attr=wheel.geometry.attributes.position;for(let i=0;i<attr.count;i++){const p=new THREE.Vector3().fromBufferAttribute(attr,i).applyMatrix4(wheel.matrixWorld);worstGap=Math.min(worstGap,p.y-habitatSurface(field,p.x,p.z));}}
wheel.rotation.z=0;console.log('wheel bed envelope gap',worstGap);assert.ok(worstGap>-.12,'rotating paddle and bucket envelope does not dig into stream bed');
// Actual transformed follower cap stays on the rendered 64-sided eccentric cam.
const mech=createWaterworks(options),mw=mech.group.getObjectByName('waterworks-wheel-and-cam'),mf=mech.group.getObjectByName('waterworks-cam-follower'),mp=mech.group.getObjectByName('waterworks-pestle'),mg=mech.group.getObjectByName('waterworks-mortar-grain');
mg.geometry.computeBoundingBox();const grainY=mg.geometry.boundingBox.max.y;mf.geometry.computeBoundingBox();mp.geometry.computeBoundingBox();const footLocal=new THREE.Vector3(.8,mf.geometry.boundingBox.min.y,0),tipLocal=new THREE.Vector3(3.8,mp.geometry.boundingBox.min.y,0);let maxContactGap=0,minTipGap=Infinity,impactTipGaps=[];
const readMechanism=()=>{mech.group.updateMatrixWorld(true);const foot=footLocal.clone().applyMatrix4(mf.matrixWorld),local=mw.worldToLocal(foot.clone());const cp=new THREE.Vector3(.19,0,local.z),radial=local.clone().sub(cp).normalize();const ray=new THREE.Raycaster(local.clone().addScaledVector(radial,.05).applyMatrix4(mw.matrixWorld),radial.clone().negate().transformDirection(mw.matrixWorld),0,.1);const hit=ray.intersectObject(mw,false)[0];assert.ok(hit,'follower cap touches actual cam render triangles');maxContactGap=Math.max(maxContactGap,Math.abs(hit.distance-.05));const tip=tipLocal.clone().applyMatrix4(mp.matrixWorld);minTipGap=Math.min(minTipGap,tip.y-grainY);return tip;};
mech.setSound({ready:true,getStats:()=>({master:1}),wood(){const tip=readMechanism();impactTipGaps.push(tip.y-grainY);assert.ok(Math.hypot(tip.x-s.mortar.x,tip.z-s.mortar.z)<.02,'tip hits actual grain disk centre');}});
for(let i=0;i<720;i++){mech.update(Math.PI*2/180/.38);readMechanism();}
console.log('mechanism measured',JSON.stringify({stats:mech.getStats(),maxContactGap,minTipGap,impactTipGaps}));assert.ok(maxContactGap<.001,'follower contact to real faceted cam stays within 1mm at every sampled phase');assert.ok(minTipGap>=-1e-5,'pestle never penetrates grain');assert.equal(impactTipGaps.length,4);assert.ok(impactTipGaps.every(g=>Math.abs(g)<1e-5),'sound only at exact rendered grain impact');mech.dispose();
// No ownBlocker shortcut: real observationScore from ordinary dry outside points.
const {observationScore}=await import('../src/systems/observation.js');
const allBlockers=[...Object.values(sources).flatMap(v=>v.blockers||[]),...out.blockers];
const outside=(x,z,r)=>allBlockers.every(b=>{const c=Math.cos(b.rot||0),s=Math.sin(b.rot||0),dx=x-b.x,dz=z-b.z;return Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-b.hw),Math.max(0,Math.abs(dx*s+dz*c)-b.hd))>r;});
const views={};for(const target of out.targets){let view=null;search:for(let r=.9;r<=Math.min(target.range,8);r+=.35)for(let j=0;j<96;j++){const a=j*Math.PI*2/96,x=target.x+Math.cos(a)*r,z=target.z+Math.sin(a)*r,y=habitatSurface(field,x,z);if(y<world.terrain.waterLevel+world.stream.waveAmp+.3||field.slope(x,z)>.42||!outside(x,z,.24))continue;let dry=true;for(let k=0;k<12;k++){const q=k*Math.PI/6;if(habitatSurface(field,x+Math.cos(q)*.24,z+Math.sin(q)*.24)<world.terrain.waterLevel+world.stream.waveAmp+.3)dry=false;}if(!dry)continue;const eye={x,y:y+1.65,z},d=new THREE.Vector3(target.x-x,target.y-eye.y,target.z-z).normalize();if(Number.isFinite(observationScore(eye,d,target,target.range,allBlockers,field))){view=eye;break search;}}assert.ok(view,target.id+' selectable from ordinary dry outside eye through ALL physical colliders');views[target.id]=view;}
console.log('physical invariants',JSON.stringify({maxContactGap,minTipGap,impactTipGaps,views}));
const snapshot=()=>{out.group.updateMatrixWorld(true);const a=[];out.group.traverse(o=>{a.push(...o.matrix.elements);if(o.instanceMatrix)a.push(...o.instanceMatrix.array);});return a;};
const still=snapshot();for(const dt of [0,-1,NaN,Infinity])out.update(dt,1e9,{nightAmount:1});assert.deepEqual(snapshot(),still,'invalid/paused dt freezes every transform');
let calls=[];const sound={ready:true,muted:false,getStats:()=>({master:1}),wood:(x,z)=>calls.push([x,z])};out.setSound(sound);
for(let i=0;i<1000;i++){out.update(.05,123,{nightAmount:1});again.update(.05,987,{nightAmount:0});}
assert.equal(out.getStats().phase,again.getStats().phase,'night and elapsed cannot control mechanics');
assert.equal(out.getStats().impacts,calls.length);assert.equal(calls.length,3,'one impact each full pestle stroke');assert.ok(calls.flat().every(Number.isFinite));assert.ok(calls.every(([x,z])=>x===s.mortar.x&&z===s.mortar.z));
assert.notDeepEqual(snapshot(),still,'mechanics and flow really move');
for(const mode of ['locked','muted','master-zero']){sound.ready=mode!=='locked';sound.muted=mode==='muted';sound.getStats=()=>({master:mode==='master-zero'?0:1});const n=calls.length;for(let i=0;i<400;i++)out.update(.05);assert.equal(calls.length,n,mode+' cannot emit sound');}
const oldPhase=out.getStats().phase;out.update(10000);assert.ok(out.getStats().phase-oldPhase<=.0380001,'large dt clamped');
for(const [k,v] of Object.entries(sources))assert.equal(hashSource(v),hashes[k],k+' source geometry/layout invariant');
assert.equal(JSON.stringify(world),worldBefore);assert.equal(createHash('sha256').update(Buffer.from(heights.buffer)).digest('hex'),fieldBefore);
const disabled=createWaterworks({...options,world:{...world,waterworks:{enabled:false}}}),degraded=createWaterworks({...options,habitatDetails:null}),budget=createWaterworks({...options,world:{...world,waterworks:{maxTriangles:1}}}),cramped=createWaterworks({...options,reservations:[{layout:{reservations:[{x:0,z:50,radius:1000}]}}]});
for(const x of [disabled,degraded,budget,cramped]){assert.equal(x.group.children.length,0);assert.equal(x.targets.length,0);assert.equal(x.stations.length,0);assert.equal(x.blockers.length,0);}
for(const k of ['field','flora','boats','cliff','riverCurve']){const empty=createWaterworks({...options,[k]:null});assert.equal(empty.targets.length,0,k+' absent metadata skips all');empty.dispose();}
const resources=new Map();out.group.traverse(o=>{if(o.isMesh)for(const r of [o.geometry,o.material]){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}});out.dispose();out.dispose();assert.ok([...resources.values()].every(n=>n===1));assert.equal(out.group.children.length,0);const last=out.getStats().phase;out.update(.1);assert.equal(out.getStats().phase,last);
console.log('waterworks verified',JSON.stringify({stats:again.getStats(),targets:again.targets,wheel:{x:s.x,y:s.y,z:s.z},mortar:s.mortar,bed:s.bed,station:{x:station.x,y:station.y,z:station.z,yaw:station.yaw},trap:{x:tr.x,z:tr.z},hashes}));
for(const x of [again,disabled,degraded,budget,cramped])x.dispose();
