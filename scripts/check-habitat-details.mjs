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
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { createHabitatDetails, createHabitatContext, habitatSiteSafe, habitatSurface } from '../src/world/habitat-details.js';

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
const oldGroups=[flora,reeds,boats,cliff,village,props,hinterland,scenes,life,exterior].map(o=>o.group);
function digest(groups){const hash=createHash('sha256');for(const group of groups)group.traverse(o=>{hash.update(o.name);hash.update(JSON.stringify({p:o.position.toArray(),r:o.rotation.toArray(),s:o.scale.toArray(),count:o.count}));for(const a of [...Object.values(o.geometry?.attributes||{}),o.geometry?.index,o.instanceMatrix,o.instanceColor].filter(Boolean))hash.update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));});return hash.digest('hex');}
const records=()=>JSON.stringify({world,houses:village.houseInfo,plots:village.plots,props:props.marks,trees:hinterland.trees,bamboo:hinterland.bamboo,structures:hinterland.structures,paths:hinterland.paths,scenes:scenes.scenes,nature:scenes.nature,scenePaths:scenes.paths,sceneDetails:scenes.details,sceneMap:scenes.mapData,life:life.items,lifeMap:life.mapData,stops:exterior.layout.stops,exteriorPaths:exterior.layout.paths,exteriorNature:exterior.layout.nature,exteriorReservations:exterior.layout.reservations,blockers:[cliff,village,props,hinterland,scenes,life,exterior].map(o=>o.blockers)});
const before={records:records(),geometry:digest(oldGroups),heights:Buffer.from(heights.buffer).toString('hex')};
const out=createHabitatDetails(options),repeat=createHabitatDetails(options),stats=out.getStats(),context=createHabitatContext(options);
console.log('habitat actual',JSON.stringify(stats));
assert.equal(records(),before.records,'all original layouts/config/colliders/map data untouched');
assert.equal(digest(oldGroups),before.geometry,'all original geometry/instances/transforms untouched');
assert.equal(Buffer.from(heights.buffer).toString('hex'),before.heights,'heightfield unchanged');
assert.deepEqual(out.layout,repeat.layout,'independent stream deterministic layout');assert.deepEqual(out.targets,repeat.targets);assert.equal(digest([out.group]),digest([repeat.group]),'deterministic positions/normals/colors');
assert.equal(out.group.name,'habitat-details');assert.ok(stats.clusters>=30&&stats.clusters<=70,'meaningful, grouped density');
for(const region of ['understory','bank','farm'])assert.ok(stats.regions[region]>=7,region+' populated');
assert.ok(stats.triangles<=6500&&stats.triangles>2500);assert.equal(stats.drawCalls,3);assert.equal(out.blockers,undefined,'passable visual details add no colliders');
assert.ok(out.layout.pockets.filter(p=>p.accepted>1).length>=8,'coherent separated multi-cluster pockets');
const ids=['fern','shrub','fallen-branch','bank-stone','water-grass','grain-crop'];assert.deepEqual([...new Set(out.targets.map(t=>t.id))].sort(),ids.sort());
for(const t of out.targets){assert.equal(Object.getPrototypeOf(t),Object.prototype);assert.ok([t.x,t.y,t.z,t.range].every(Number.isFinite));assert.ok(t.y>=habitatSurface(field,t.x,t.z));}
const circleOverlap=(x,z,r,c)=>Math.hypot(x-c.x,z-c.z)<r+c.r+context.cfg.clearance-1e-5;
const boxDistance=(x,z,b)=>{const c=Math.cos(b.rot||0),s=Math.sin(b.rot||0),dx=x-b.x,dz=z-b.z;return Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-b.hw),Math.max(0,Math.abs(dx*s+dz*c)-b.hd));};
// Independently evaluate the rendered plane's two triangles, separate from the production helper.
function measuredFloor(x,z) {
  const gx=(x+world.terrain.size/2)/field.step,gz=(z+world.terrain.size/2)/field.step,ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,stride=world.terrain.segments+1;
  const a=heights[iz*stride+ix],b=heights[iz*stride+ix+1],c=heights[(iz+1)*stride+ix],d=heights[(iz+1)*stride+ix+1];
  const rendered=u+v<=1?a+(b-a)*u+(c-a)*v:d+(b-d)*(1-v)+(c-d)*(1-u);
  return Math.max(field.sample(x,z),rendered);
}
let vertices=0,surfaceSamples=0,triangles=0,lowest=Infinity,highest=0;
for(const mesh of out.group.children){
  assert.match(mesh.name,/^habitat-details-(solid|botanical|ground)$/);assert.ok(mesh.isMesh&&!mesh.isInstancedMesh);assert.equal(mesh.matrixAutoUpdate,false);assert.equal(mesh.material.transparent,false);assert.equal(mesh.material.opacity,1);assert.equal(mesh.material.vertexColors,true);assert.equal(mesh.material.onBeforeCompile,THREE.Material.prototype.onBeforeCompile);
  const {position,color,normal}=mesh.geometry.attributes;assert.equal(position.count,color.count);assert.equal(position.count,normal.count);assert.equal(position.count%3,0);assert.ok(mesh.geometry.boundingBox&&mesh.geometry.boundingSphere.radius>0);
  for(const a of [position,color,normal]){assert.equal(a.usage,THREE.StaticDrawUsage);assert.ok([...a.array].every(Number.isFinite));}
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i),floor=measuredFloor(x,z),above=y-floor;assert.ok(Math.abs(floor-habitatSurface(field,x,z))<1e-10);
    assert.ok(field.sample(x,z)>=context.dry-1e-5,'actual emitted vertex dry');assert.ok(field.slope(x,z)<=context.cfg.maxSlope+1e-5);assert.ok(above>=-2e-5&&above<0.9,'vertex follows higher physical/render floor');
    assert.ok(mesh.geometry.boundingBox.containsPoint(new THREE.Vector3(x,y,z)));lowest=Math.min(lowest,above);highest=Math.max(highest,above);vertices++;
    if(i%3===0){
      for(const weights of [[1/3,1/3,1/3],[0.5,0.5,0],[0,0.5,0.5],[0.5,0,0.5]]){
        let px=0,py=0,pz=0;for(let k=0;k<3;k++){px+=position.getX(i+k)*weights[k];py+=position.getY(i+k)*weights[k];pz+=position.getZ(i+k)*weights[k];}
        assert.ok(py>=measuredFloor(px,pz)-0.012,'triangle interiors not buried by visible terrain');surfaceSamples++;
      }
      triangles++;
    }
  }
}
assert.equal(triangles,stats.triangles);assert.equal(vertices,triangles*3);assert.ok(lowest<=0.026,'real ground contact, not floating decorations');
let routeSamples=0;
for(const item of out.layout.clusters){
  assert.ok(habitatSiteSafe(item.x,item.z,item.radius,context));
  for(const c of context.reservations.circles)assert.ok(!circleOverlap(item.x,item.z,item.radius,c),'full crown/hull/landing/door/site clearance');
  for(const b of context.reservations.boxes)assert.ok(boxDistance(item.x,item.z,b)>=item.radius+context.cfg.clearance-1e-5,'full wall/plot/portal footprint clearance');
  for(const p of context.reservations.corridors)for(let j=1;j<p.points.length;j++){
    const a=p.points[j-1],b=p.points[j],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    for(let k=0;k<=Math.ceil(length/0.6);k++){
      const t=k/Math.max(1,Math.ceil(length/0.6)),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
      assert.ok(Math.hypot(item.x-x,item.z-z)>=item.radius+p.half+context.cfg.clearance-1e-5,'real path/rope/reward/shelter width clear');routeSamples++;
    }
  }
  for(const [batch,range] of Object.entries(item.ranges)){
    const p=out.group.getObjectByName('habitat-details-'+batch).geometry.attributes.position;
    assert.ok(range.start+range.count<=p.count);for(let i=range.start;i<range.start+range.count;i++)assert.ok(Math.hypot(p.getX(i)-item.x,p.getZ(i)-item.z)<=item.radius+2e-5,'every emitted footprint inside accepted disk');
  }
}
// Independent real route checks include old terrain mask on BOTH banks (not a guessed centreline).
for(const mesh of out.group.children){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),meander=Math.sin(z*.017)*2.4+Math.sin(x*.013+1.7)*1.6;assert.ok(Math.abs(river(x,z)-world.terrain.pathOffset-meander)>=world.terrain.pathWidth+0.59,'original terrain track negative space preserved');}}
const scene=new THREE.Scene();scene.add(out.group);const visibility=optimizeStaticVisibility(scene);const camera=new THREE.PerspectiveCamera(60,1.5,0.1,500);camera.position.set(30,8,180);camera.lookAt(0,2,100);visibility.update(camera);assert.equal(visibility.getStats().staticMeshes,3,'real helper admits exactly all three audited meshes');assert.equal(visibility.getStats().trianglesBefore,stats.triangles);visibility.dispose();
const disabled=createHabitatDetails({...options,world:{...world,habitatDetails:{enabled:false}}});assert.equal(disabled.group.children.length,0);assert.equal(disabled.targets.length,0);assert.equal(disabled.getStats().triangles,0);
const tiny=createHabitatDetails({...options,world:{...world,habitatDetails:{maxTriangles:1}}});assert.equal(tiny.getStats().triangles,0,'budget never partially emits cluster');
const seeded=createHabitatDetails({...options,world:{...world,habitatDetails:{seed:424242,maxTriangles:300}}});assert.ok(seeded.getStats().triangles>0&&seeded.getStats().triangles<=300);assert.notDeepEqual(seeded.layout.clusters[0],out.layout.clusters[0],'separate configured hash seed controls detail-only placement');
const reduced=createHabitatDetails({...options,flora:undefined,hinterland:undefined,village:undefined,villageScenes:undefined,villageLife:undefined,props:undefined,boats:undefined,exterior:undefined});assert.equal(reduced.getStats().triangles,0,'missing source reservations degrade to empty, not unsafe placement');assert.equal(reduced.getStats().degraded,true);
const wet=createHabitatDetails({...options,field:{sample:()=>-10,slope:()=>0}});assert.equal(wet.getStats().clusters,0,'all-wet world gracefully empty');
const steep=createHabitatDetails({...options,field:{sample:()=>3,slope:()=>9}});assert.equal(steep.getStats().clusters,0,'all-steep world gracefully empty');
let disposedResources=0;
for(const mesh of out.group.children)for(const resource of [mesh.geometry,mesh.material])resource.addEventListener('dispose',()=>disposedResources++);
for(const o of [out,repeat,disabled,tiny,seeded,reduced,wet,steep]){o.dispose();o.dispose();assert.equal(o.getStats().disposed,true);}
assert.equal(disposedResources,6,'exactly three owned buffers and three materials disposed once');
assert.equal(records(),before.records,'degraded/seeded/disposal cases never mutate original sources');assert.equal(digest(oldGroups),before.geometry);
console.log(JSON.stringify({ok:true,clusters:stats.clusters,regions:stats.regions,triangles,drawCalls:stats.drawCalls,vertices,surfaceSamples,routeSamples,groundOffset:[lowest,highest],cameraTargets:['understory','bank','farm'].map(region=>{const c=out.layout.clusters.find(p=>p.region===region);return {region,eye:{x:c.x+3.5,y:c.y+1.7,z:c.z+3.5},target:{x:c.x,y:c.y+0.35,z:c.z}};})},null,2));
