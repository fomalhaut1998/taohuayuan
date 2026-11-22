import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
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
import { planMysterySites } from '../src/world/mysteries.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails, habitatSurface } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { observationScore } from '../src/systems/observation.js';

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
const sites=planMysterySites(world,field,river,village,props,cliff,hinterland,scenes,flora);
const life=createVillageLife(world,field,river,village,props,cliff,hinterland,scenes,{sites});
const exterior=createExteriorExploration(world,field,river,curve,flora,boats,cliff);
const options={world,field,distanceToRiver:river,riverCurve:curve,flora,hinterland,village,villageScenes:scenes,villageLife:life,props,boats,cliff,exterior,mysteryWorld:{sites}};
options.habitatDetails=createHabitatDetails(options);
const sources=[flora,boats,cliff,village,props,hinterland,scenes,life,exterior,options.habitatDetails];
const digest=groups=>{const h=createHash('sha256');for(const group of groups)group.traverse(o=>{h.update(o.name);h.update(JSON.stringify([o.position.toArray(),o.rotation.toArray(),o.scale.toArray()]));for(const a of [...Object.values(o.geometry?.attributes||{}),o.geometry?.index,o.instanceMatrix,o.instanceColor].filter(Boolean))h.update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));});return h.digest('hex');};
const before=digest(sources.map(s=>s.group)),config=JSON.stringify(world),rim=JSON.stringify(village.pond);
const out=createPondLife(options),repeat=createPondLife(options),stats=out.getStats();
console.log('pond actual',JSON.stringify(stats));
assert.equal(out.group.name,'pond-life');assert.deepEqual(out.layout,repeat.layout,'deterministic independent local placement');
assert.equal(digest([out.group]),digest([repeat.group]));
assert.ok(stats.triangles>1600&&stats.triangles<=9000);assert.ok(stats.drawCalls<=14);
for(const key of ['lotusLeaves','flowers','duckweed','dragonflies','carp','shrimp','watergrass','rhizomes','mussels','laundry','tubs'])assert.ok(stats.counts[key]>0,key+' genuinely built in actual world');
assert.equal(stats.counts.ducks,undefined,'original fauna owns ducks');assert.equal(out.stations.length,1);assert.ok(out.blockers.some(b=>b.hw===.08&&b.hd===.08),'harvest tub has a real dry-bank mooring peg and tied rope');
const expected=['duckweed','lotus','dragonfly','carp','shrimp','pond-watergrass','lotus-rhizome','freshwater-mussel','laundry-stone','harvest-tub'];
assert.deepEqual([...new Set(out.targets.map(t=>t.id))].sort(),expected.sort());
const pond=world.terrain.pond;
function inRim(x,z){let inside=false;const r=village.pond.rim;for(let i=0,j=r.length-1;i<r.length;j=i++){const ax=pond.x+Math.cos(i*Math.PI*2/r.length)*r[i],az=pond.z+Math.sin(i*Math.PI*2/r.length)*r[i],bx=pond.x+Math.cos(j*Math.PI*2/r.length)*r[j],bz=pond.z+Math.sin(j*Math.PI*2/r.length)*r[j];if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;}return inside;}
let wetSamples=0,drySamples=0,triangles=0,draws=0;
out.group.updateMatrixWorld(true);
for(const item of out.layout.placements){assert.ok(item.mesh&&out.group.getObjectByName(item.mesh),'placement names built batch');if(item.wet){for(let j=0;j<20;j++){const a=j*Math.PI/10,x=item.x+Math.cos(a)*item.radius,z=item.z+Math.sin(a)*item.radius;assert.ok(inRim(x,z),'actual irregular water polygon');assert.ok(habitatSurface(field,x,z)<pond.waterY-.025,'wet in physics AND render field');wetSamples++;}}}
for(const t of out.targets){assert.ok([t.x,t.y,t.z,t.range].every(Number.isFinite));assert.ok(out.layout.placements.some(p=>p.target===t.id),'target has successful visible geometry');if(t.resolve){const p=t.resolve();assert.ok([p.x,p.y,p.z].every(Number.isFinite));}}
for(const s of out.stations){assert.equal(s.kind,'wash');assert.ok(s.prop?.isObject3D);assert.ok(s.prop.userData.wash.cloth?.isObject3D);assert.ok(s.prop.userData.wash.workSurface);assert.ok(s.prop.userData.communityContact.y>.4&&s.prop.userData.communityContact.y<.85,'wash work surface above actor knee, not at ankle');const contact=new THREE.Vector3(s.prop.userData.communityContact.x,s.prop.userData.communityContact.y,s.prop.userData.communityContact.z).applyAxisAngle(new THREE.Vector3(0,1,0),s.yaw).add(new THREE.Vector3(s.x,s.y,s.z));assert.ok(contact.distanceTo(new THREE.Vector3(...Object.values(s.prop.userData.wash.workSurface)))<1e-6);for(let j=0;j<24;j++){const a=j*Math.PI/12,x=s.x+Math.cos(a)*.5,z=s.z+Math.sin(a)*.5;assert.ok(field.sample(x,z)>pond.waterY+.015,'actor feet dry');assert.ok(field.slope(x,z)<.6);drySamples++;}assert.ok(!s.path||s.path.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));}
out.group.traverse(mesh=>{if(!mesh.isMesh)return;draws++;const {position,color,normal}=mesh.geometry.attributes;assert.equal(position.count,color.count);assert.equal(position.count,normal.count);assert.ok([...position.array,...color.array,...normal.array].every(Number.isFinite));triangles+=(mesh.geometry.index?.count??position.count)/3*(mesh.isInstancedMesh?mesh.count:1);assert.ok(mesh.material.vertexColors);if(mesh.userData.submerged){assert.equal(mesh.material.transparent,false);assert.equal(mesh.renderOrder,0);assert.equal(mesh.material.depthWrite,true);}});
assert.equal(triangles,stats.triangles);assert.equal(draws,stats.drawCalls);
assert.ok(stats.surfaceCoverage<.18,'broad open water preserved');
// Exercise the production LOS gate, not a test-only blocker exemption.
const allBlockers=[...sources.flatMap(s=>s.blockers||[]),...out.blockers];
function boxDistance(x,z,b){const c=Math.cos(b.rot||0),s=Math.sin(b.rot||0),dx=x-b.x,dz=z-b.z;return Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-b.hw),Math.max(0,Math.abs(dx*s+dz*c)-b.hd));}
const bankEyes=[];
for(let a=0;a<256;a++)for(let r=8;r<=17;r+=.25){const x=pond.x+Math.cos(a*Math.PI/128)*r,z=pond.z+Math.sin(a*Math.PI/128)*r,y=habitatSurface(field,x,z);if(field.slope(x,z)>.6||allBlockers.some(b=>boxDistance(x,z,b)<.35))continue;let dry=true;for(let j=0;j<12;j++){const px=x+Math.cos(j*Math.PI/6)*.35,pz=z+Math.sin(j*Math.PI/6)*.35;if(Math.min(field.sample(px,pz),habitatSurface(field,px,pz))<pond.waterY+.02){dry=false;break;}}if(dry)bankEyes.push({x,y:y+world.player.eyeHeight,z});}
function reachableTargets(){return out.targets.map(t=>{const p=t.resolve?t.resolve():t;const eye=bankEyes.find(eye=>{const d=Math.hypot(p.x-eye.x,p.y-eye.y,p.z-eye.z),forward={x:(p.x-eye.x)/d,y:(p.y-eye.y)/d,z:(p.z-eye.z)/d};return Number.isFinite(observationScore(eye,forward,p,t.range,allBlockers,field));});return {id:t.id,eye:eye||null};});}
const reachability=reachableTargets();console.log('pond target LOS',JSON.stringify(reachability));
for(const t of reachability)assert.ok(t.eye,t.id+' has dry-bank view within real observation range');
for(const b of out.blockers)assert.ok(Number.isFinite(b.minY)&&Number.isFinite(b.maxY)&&b.maxY>b.minY,'owned collider has finite actual physical heights');
const laundryTarget=out.targets.find(t=>t.id==='laundry-stone'),laundryBlock=out.blockers.find(b=>b.source==='pond-laundry-stone');assert.ok(laundryTarget.y>laundryBlock.maxY,'laundry target outside its actual collider');const exposedRay=new THREE.Raycaster(new THREE.Vector3(laundryTarget.x,laundryTarget.y+.10,laundryTarget.z),new THREE.Vector3(0,-1,0),0,.13);const exposedHit=exposedRay.intersectObject(out.group.getObjectByName('pond-life-shore'))[0];assert.ok(exposedHit&&Math.abs(exposedHit.point.y-laundryTarget.y)<.012,'anchor is immediately above real exposed stone channel, not a synthetic remote point');
const frozen=()=>digest([out.group])+JSON.stringify(out.getStats());
const initial=frozen();for(const dt of [0,-1,NaN,Infinity])out.update(dt,999,{rain:1});assert.equal(frozen(),initial,'zero/negative/nonfinite dt freezes every transform and phase');
for(let i=0;i<800;i++){out.update(.05,i*.05,{rain:0,day:1});if(i%40===0)for(const t of reachableTargets())assert.ok(t.eye,t.id+' remains dry-bank observable during animation at '+out.getStats().time);}assert.notEqual(digest([out.group]),digest([repeat.group]),'causal visible animation');
// Contact rings are caused by abdomen endpoints, not arbitrary timer locations.
const contactProbe=createPondLife(options),body=contactProbe.group.getObjectByName('pond-life-dragonflies'),rings=contactProbe.group.getObjectByName('pond-life-touch-ripples'),im=new THREE.Matrix4(),rm=new THREE.Matrix4(),tip=new THREE.Vector3(),ringCenter=new THREE.Vector3();let observedContacts=0;
for(let k=0;k<180;k++){contactProbe.update(.05,k*.05,{});for(let j=0;j<body.count;j++){rings.getMatrixAt(j,rm);const scale=new THREE.Vector3().setFromMatrixScale(rm);if(Math.abs(scale.x-.07)<1e-5){body.getMatrixAt(j,im);tip.set(0,-.18,-.40).applyMatrix4(im);ringCenter.setFromMatrixPosition(rm);assert.ok(Math.abs(tip.y-pond.waterY)<1e-5,'tail actually contacts original water plane');assert.ok(Math.hypot(tip.x-ringCenter.x,tip.z-ringCenter.z)<2e-5,'ring starts at float32 tip: '+Math.hypot(tip.x-ringCenter.x,tip.z-ringCenter.z));observedContacts++;}}}assert.ok(observedContacts>=3);contactProbe.dispose();
assert.ok(out.layout.reservations.every(r=>[r.x,r.z].every(Number.isFinite)&&(Number.isFinite(r.radius)||[r.hw,r.hd].every(Number.isFinite))));
const tick=out.getStats().time;out.update(60,9999,{});assert.ok(out.getStats().time-tick<=.05000001,'large dt clamps and no elapsed catchup');
assert.ok(out.getStats().touches>0,'dragonfly physical point touches emit ripples');
out.group.updateMatrixWorld(true);
out.group.traverse(mesh=>{if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);assert.ok([v.x,v.y,v.z].every(Number.isFinite));}});
assert.equal(digest(sources.map(s=>s.group)),before,'source geometry and transforms untouched');assert.equal(JSON.stringify(world),config);assert.equal(JSON.stringify(village.pond),rim);
const degraded=createPondLife({...options,village:undefined});assert.equal(degraded.getStats().triangles,0,'missing actual pond rim emits nothing');
const resources=new Set();out.group.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);});let disposed=0;for(const r of resources)r.addEventListener('dispose',()=>disposed++);
out.dispose();out.dispose();assert.equal(disposed,resources.size,'only own resources disposed exactly once');assert.ok(out.getStats().disposed);repeat.dispose();degraded.dispose();assert.equal(digest(sources.map(s=>s.group)),before);
console.log(JSON.stringify({ok:true,counts:stats.counts,triangles,drawCalls:draws,wetSamples,drySamples,coverage:stats.surfaceCoverage,stations:out.stations.map(s=>({kind:s.kind,x:s.x,y:s.y,z:s.z,yaw:s.yaw,contact:s.prop.userData.communityContact,workSurface:s.prop.userData.wash.workSurface})),camera:out.layout.camera},null,2));
