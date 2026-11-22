import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { createTerrain, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { createVillage } from '../src/world/village.js';
import { createFlora } from '../src/world/flora.js';
import { createScatter } from '../src/world/scatter.js';
import { createCliff } from '../src/world/cliff.js';
import { createProps } from '../src/world/props.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createVillageLife } from '../src/world/village-life.js';

let checks = 0;
function check(value, label) { assert(value, label); checks++; }
const scene = new THREE.Scene();
const root = new THREE.Group(); root.name = 'village'; scene.add(root);
root.position.set(2, 0.2, -1); root.rotation.y = 0.15; root.scale.set(1.3, 0.9, 0.8);
const geometry = new THREE.BoxGeometry(2, 3, 2);
const materials = [new THREE.MeshLambertMaterial({ color: 'white', side: THREE.DoubleSide }), new THREE.MeshBasicMaterial({ color: 'white' })];
for (const group of geometry.groups) group.materialIndex %= 2;
const mesh = new THREE.InstancedMesh(geometry, materials, 7); mesh.name = 'test-static'; root.add(mesh);
const object = new THREE.Object3D();
const positions = [[-2,0,-8],[100,0,-8],[-8,0,-8],[0,0,8],[0,0,-0.05],[0,0,-12],[0,0,-8]];
positions.forEach((p,i) => { object.position.set(...p); object.rotation.set(i*0.1,i*0.3,0); object.scale.set(i===2?5:1,1+i*0.1,1); object.updateMatrix(); mesh.setMatrixAt(i,object.matrix); mesh.setColorAt(i,new THREE.Color().setRGB(i/8,1-i/8,0.2+i/10)); });
mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
const originalMatrices = mesh.instanceMatrix;
const originalColors = mesh.instanceColor;
const originalData = originalMatrices.array.slice();
const originalColorData = originalColors.array.slice();
const originalRaycast = mesh.raycast;
const dynamic = new THREE.InstancedMesh(geometry, materials, 2); dynamic.name='moving-unknown'; dynamic.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(dynamic);
const faunaRoot = new THREE.Group(); faunaRoot.name='fauna'; root.add(faunaRoot);
const fauna = new THREE.InstancedMesh(geometry,materials,1); faunaRoot.add(fauna);
const people = new THREE.InstancedMesh(geometry,materials,1); people.name='people-body'; root.add(people);
const target = new THREE.InstancedMesh(geometry,materials,1); target.userData.interactive=true; root.add(target);
const explicitTarget = new THREE.InstancedMesh(geometry,materials,1); root.add(explicitTarget);
const custom = new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),1); custom.material.onBeforeCompile=()=>{}; root.add(custom);
const shader = new THREE.InstancedMesh(geometry,new THREE.ShaderMaterial(),1); root.add(shader);
const attributedGeometry=geometry.clone(); attributedGeometry.setAttribute('instanceState',new THREE.InstancedBufferAttribute(new Float32Array(4),4));
const attributed=new THREE.InstancedMesh(attributedGeometry,materials,1); root.add(attributed);
const transparent=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({transparent:true,opacity:0.5}),1);root.add(transparent);
const morph=new THREE.InstancedMesh(geometry,materials,1);morph.morphTexture={};root.add(morph);
const visibility = optimizeStaticVisibility(scene,{exclude:[explicitTarget]});
assert.deepEqual(visibility.entries.map(e=>e.source),[mesh]);checks++;
const entry=visibility.entries[0];
const secondHelper=optimizeStaticVisibility(scene,{exclude:[explicitTarget]});check(secondHelper.entries.length===0,'multiple helpers never own the same source');secondHelper.dispose();
const camera=new THREE.PerspectiveCamera(65,16/9,0.1,80);camera.rotation.order='YXZ';
const frustum=new THREE.Frustum(), projection=new THREE.Matrix4(), box=new THREE.Box3(), matrix=new THREE.Matrix4(), expectedMatrix=new THREE.Matrix4(), color=new THREE.Color();
function verify() {
  visibility.update(camera);
  projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);
  const expected=[];
  for(let i=0;i<mesh.count;i++) {mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);box.copy(geometry.boundingBox).expandByPoint(new THREE.Vector3()).applyMatrix4(matrix).expandByScalar(0.0001);if(frustum.intersectsBox(box))expected.push(i);}
  assert.deepEqual(Array.from(entry.indices.subarray(0,entry.proxy.count)),expected,'full transformed AABB oracle, not center');checks++;
  check(new Set(expected).size===entry.proxy.count,'no duplicated visible instance');
  for(let j=0;j<entry.proxy.count;j++) {const i=entry.indices[j];entry.proxy.getMatrixAt(j,matrix);mesh.getMatrixAt(i,expectedMatrix);assert.deepEqual(matrix.elements,expectedMatrix.elements);entry.proxy.getColorAt(j,color);const actual=color.toArray();mesh.getColorAt(i,color);assert.deepEqual(actual,color.toArray());checks+=2;}
  check(mesh.instanceMatrix===originalMatrices&&mesh.instanceColor===originalColors&&mesh.count===7,'canonical attributes and count unchanged');
}
for(let i=0;i<24;i++){camera.rotation.set(Math.sin(i)*0.2,i*Math.PI/12,0);verify();}
root.rotation.y+=0.8;root.scale.set(0.7,1.8,-1.1);verify();
// Changed source data and camera projection must invalidate only owned render data.
mesh.setColorAt(0,new THREE.Color('blue'));mesh.instanceColor.needsUpdate=true;verify();
mesh.instanceColor.array.set(originalColorData);mesh.instanceColor.needsUpdate=true;
mesh.instanceMatrix.array.set(originalData);mesh.instanceMatrix.needsUpdate=true;
root.position.set(0,0,0);root.rotation.set(0,0,0);root.scale.set(1,1,1);camera.position.set(0,0,0);camera.rotation.set(0,0,0);camera.fov=90;camera.aspect=1;camera.updateProjectionMatrix();verify();
check(entry.indices.subarray(0,entry.proxy.count).includes(2),'wide instance whose center is outside still retained');
check(entry.indices.subarray(0,entry.proxy.count).includes(4),'near-plane intersecting instance retained');
mesh.getMatrixAt(1,matrix);matrix.setPosition(0,0,-10);mesh.setMatrixAt(1,matrix);mesh.instanceMatrix.needsUpdate=true;verify();
check(entry.indices.subarray(0,entry.proxy.count).includes(1),'updated original matrix is rendered at its new position');
mesh.instanceMatrix.array.set(originalData);mesh.instanceMatrix.needsUpdate=true;verify();
const version=entry.proxy.instanceMatrix.version;visibility.update(camera);check(entry.proxy.instanceMatrix.version===version,'unchanged camera selection avoids GPU uploads');
const raycaster=new THREE.Raycaster(new THREE.Vector3(0,0,0),new THREE.Vector3(0,0,-1));
scene.updateMatrixWorld(true);
const before=raycaster.intersectObject(mesh,true).map(h=>[h.instanceId,h.distance]);
check(before.length>0,'raycast fixture hits real original geometry');
let renderCalls=0;
const fakeRenderer={render(renderScene,renderCamera){renderCalls++;check(renderScene===scene&&renderCamera===camera,'same render arguments');check(!mesh.material.visible&&entry.proxy.visible,'source draw suppressed, proxy enabled');check(entry.proxy.material===materials,'material arrays shared without mutation');check(entry.proxy.parent===mesh&&entry.proxy.matrix.equals(new THREE.Matrix4()),'identity-child preserves parent transform');assert.deepEqual(raycaster.intersectObject(mesh,true).map(h=>[h.instanceId,h.distance]),before,'raycast IDs and no proxy duplicates even during render');checks++;check(mesh.instanceMatrix===originalMatrices&&mesh.instanceColor===originalColors&&mesh.count===7,'source data intact during rendering');return 42;}};
assert.equal(visibility.render(fakeRenderer,camera),42);check(renderCalls===1,'exactly one renderer invocation');
check(mesh.material===materials&&!entry.proxy.visible,'restored after successful render');
const arrayCamera=new THREE.ArrayCamera();
visibility.render({render(s,c){check(s===scene&&c===arrayCamera&&mesh.material===materials&&!entry.proxy.visible,'array camera safely uses canonical originals');}},arrayCamera);
mesh.count=0;visibility.update(camera);check(entry.proxy.count===0,'empty source renders no proxy instances');mesh.count=7;visibility.update(camera);
mesh.count=8;assert.throws(()=>visibility.update(camera),/capacity changed/);checks++;mesh.count=7;visibility.update(camera);
assert.throws(()=>visibility.render({render(){throw new Error('test renderer error');}},camera),/test renderer error/);
check(mesh.material===materials&&!entry.proxy.visible,'finally restores after renderer failure');
assert.deepEqual(mesh.instanceMatrix.array,originalData);assert.deepEqual(mesh.instanceColor.array,originalColorData);checks+=2;
let sharedDisposed=false,proxyDisposed=false;geometry.addEventListener('dispose',()=>sharedDisposed=true);entry.proxy.addEventListener('dispose',()=>proxyDisposed=true);
visibility.dispose();visibility.dispose();
check(entry.proxy.parent===null&&mesh.raycast===originalRaycast&&proxyDisposed&&!sharedDisposed,'dispose removes proxies and wrappers, not shared resources');
assert.throws(()=>visibility.update(camera),/disposed/);checks++;

// Exact-boundary fixture: all six clip planes, including a valid near corner.
const borderScene=new THREE.Scene();const borderRoot=new THREE.Group();borderRoot.name='scatter';borderScene.add(borderRoot);
const borderMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial(),7);borderRoot.add(borderMesh);
const borders=[[6,0,-5],[-6,0,-5],[0,6,-5],[0,-6,-5],[0,0,0.9],[0,0,-81],[100,0,-5]];
borders.forEach((p,i)=>{matrix.makeTranslation(...p);borderMesh.setMatrixAt(i,matrix);});
const bordersHelper=optimizeStaticVisibility(borderScene);bordersHelper.update(camera);
assert.deepEqual(Array.from(bordersHelper.entries[0].indices.subarray(0,bordersHelper.entries[0].proxy.count)),[0,1,2,3,4,5]);checks++;
bordersHelper.dispose();

// Audited baked geometry: indexed/nonindexed, all attributes, no triangle cuts.
const pageScene=new THREE.Scene(),pageRoot=new THREE.Group();pageScene.add(pageRoot);
const pageMaterial=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
const triangleVertices=[-2,-1,-8,2,-1,-8,0,2,-8, 20,-1,-5,20,1,-5,3,0,-5, -1,-1,0.9,1,-1,0.9,0,1,-0.2];
for(let i=0;i<36;i++){const x=(i%6-3)*10,z=-10-Math.floor(i/6)*12;triangleVertices.push(x,0,z,x+1,0,z,x,2,z);}
function pageGeometry(indexed){
 const g=new THREE.BufferGeometry(),n=triangleVertices.length/3;
 g.setAttribute('position',new THREE.Float32BufferAttribute(triangleVertices,3));
 g.computeVertexNormals();g.setAttribute('color',new THREE.BufferAttribute(new Uint8Array(n*3).fill(128),3,true));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(Array.from({length:n*2},(_,i)=>(i%7)/7),2));
 g.setAttribute('customMarker',new THREE.Float32BufferAttribute(Array.from({length:n},(_,i)=>i+0.25),1));
 if(indexed)g.setIndex(Array.from({length:n},(_,i)=>i));return g;
}
const baked=[true,false].map((indexed,i)=>{const o=new THREE.Mesh(pageGeometry(indexed),pageMaterial);o.name=i?'village-props':'terrain';pageRoot.add(o);return o;});
const pagedUnsupported=[];
for(const type of ['customShader','instanceAttribute','dynamicAttribute','dynamicIndex','transparent','grouped','partialRange','interactive']){
 const g=pageGeometry(true),m=new THREE.MeshBasicMaterial(),o=new THREE.Mesh(g,m);o.name='terrain';
 if(type==='customShader')m.onBeforeCompile=()=>{};
 if(type==='instanceAttribute')g.setAttribute('badInstance',new THREE.InstancedBufferAttribute(new Float32Array(4),4));
 if(type==='dynamicAttribute')g.attributes.position.setUsage(THREE.DynamicDrawUsage);
 if(type==='dynamicIndex')g.index.setUsage(THREE.DynamicDrawUsage);
 if(type==='transparent')m.transparent=true;
 if(type==='grouped')g.addGroup(0,3,0);
 if(type==='partialRange')g.setDrawRange(3,3);
 if(type==='interactive')o.userData.interactive=true;
 pageScene.add(o);pagedUnsupported.push(o);
}
const originals=baked.map(o=>({geometry:o.geometry,index:o.geometry.index,data:o.geometry.index?.array.slice(),position:o.geometry.attributes.position.array.slice(),raycast:o.raycast}));
const pageHelper=optimizeStaticVisibility(pageScene,{cellSize:4});
assert.deepEqual(pageHelper.entries.map(e=>e.source),baked);checks++;
function verifyPages(){
 pageHelper.update(camera);projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);
 for(const e of pageHelper.entries){
  const source=e.source,g=source.geometry,p=g.attributes.position,idx=g.index,total=idx?.count??p.count,draw=e.proxy.geometry.drawRange.count,out=e.proxy.geometry.index.array;
  const valid=new Set(),visible=new Set();
  for(let t=0;t<total;t+=3){const triplet=[idx?idx.getX(t):t,idx?idx.getX(t+1):t+1,idx?idx.getX(t+2):t+2],key=triplet.join(',');valid.add(key);box.makeEmpty();for(const vertex of triplet)box.expandByPoint(new THREE.Vector3().fromBufferAttribute(p,vertex).applyMatrix4(source.matrixWorld));box.expandByScalar(0.0001);if(frustum.intersectsBox(box))visible.add(key);}
  const rendered=new Set();for(let t=0;t<draw;t+=3){const key=[out[t],out[t+1],out[t+2]].join(',');check(valid.has(key),'render indices preserve complete original triangle and winding');check(!rendered.has(key),'no triangle duplication');rendered.add(key);}
  for(const key of visible)check(rendered.has(key),'every full transformed triangle AABB intersecting frustum survives');
  for(const name of Object.keys(g.attributes))check(e.proxy.geometry.attributes[name]===g.attributes[name],'every vertex attribute is identical, including normalized colors/UV/custom');
  check(source.geometry===originals[baked.indexOf(source)].geometry&&source.geometry.index===originals[baked.indexOf(source)].index,'source geometry and index API never replaced');
 }
}
camera.rotation.set(0,0,0);camera.position.set(0,0,0);verifyPages();
for(let i=0;i<16;i++){camera.rotation.set(Math.sin(i)*0.12,i*Math.PI/8,0);verifyPages();}
pageRoot.position.set(2,0.5,-3);pageRoot.rotation.y=0.4;pageRoot.scale.set(-1.3,0.8,1.2);verifyPages();
pageRoot.position.set(0,0,0);pageRoot.rotation.set(0,0,0);pageRoot.scale.set(1,1,1);camera.rotation.set(0,0,0);verifyPages();
const pageVersions=pageHelper.entries.map(e=>e.proxy.geometry.index.version);pageHelper.update(camera);assert.deepEqual(pageHelper.entries.map(e=>e.proxy.geometry.index.version),pageVersions,'unchanged pages avoid GPU index uploads');checks++;
const pageHits=raycaster.intersectObject(baked[0],true).map(h=>[h.faceIndex,h.distance]);check(pageHits.length>0,'baked raycast fixture hits original');
pageHelper.render({render(){for(let i=0;i<baked.length;i++){const e=pageHelper.entries[i];check(baked[i].geometry===originals[i].geometry&&baked[i].geometry.index===originals[i].index,'canonical index remains intact during rendering');check(!baked[i].material.visible&&e.proxy.visible,'one page proxy replaces original draw');}assert.deepEqual(raycaster.intersectObject(baked[0],true).map(h=>[h.faceIndex,h.distance]),pageHits);checks++;}},camera);
assert.throws(()=>pageHelper.render({render(){throw new Error('page render failure');}},camera),/page render failure/);
for(const e of pageHelper.entries)check(e.source.material===pageMaterial&&!e.proxy.visible,'exception restores all baked materials and hides proxies');
const activationGeometry=baked[0].geometry,computeSphere=activationGeometry.computeBoundingSphere,savedSphere=activationGeometry.boundingSphere,replacement=new THREE.MeshBasicMaterial();
activationGeometry.boundingSphere=null;activationGeometry.computeBoundingSphere=()=>{throw new Error('activation failure');};baked[1].material=replacement;
assert.throws(()=>pageHelper.render({render(){assert.fail('renderer not reached');}},camera),/activation failure/);
check(baked[0].material===pageMaterial&&baked[1].material===replacement&&pageHelper.entries.every(e=>!e.proxy.visible),'partial activation failure restores every current material');
activationGeometry.computeBoundingSphere=computeSphere;activationGeometry.boundingSphere=savedSphere;baked[1].material=pageMaterial;
pageHelper.render({xr:{isPresenting:true},render(){check(baked.every(o=>o.material===pageMaterial)&&pageHelper.entries.every(e=>!e.proxy.visible),'XR fallback never activates mono-camera culling');}},camera);
// Geometry position changes remain conservative without repartitioning pages.
const moved=baked[0].geometry.attributes.position;moved.setX(9,1);moved.needsUpdate=true;verifyPages();moved.array.set(originals[0].position);moved.needsUpdate=true;verifyPages();
let ownedPageDisposals=0,sourcePageDisposals=0;
for(const e of pageHelper.entries){e.proxy.geometry.addEventListener('dispose',()=>{check(Object.keys(e.proxy.geometry.attributes).length===0,'dispose detaches shared GPU attributes before deleting owned index');ownedPageDisposals++;});e.source.geometry.addEventListener('dispose',()=>sourcePageDisposals++);}
pageHelper.dispose();
check(ownedPageDisposals===2&&sourcePageDisposals===0,'only two owned index geometries disposed');
for(let i=0;i<baked.length;i++){const o=baked[i],original=originals[i];check(o.geometry===original.geometry&&o.geometry.index===original.index&&o.raycast===original.raycast,'baked original APIs fully restored');assert.deepEqual(o.geometry.attributes.position.array,original.position);if(original.index)assert.deepEqual(original.index.array,original.data);checks++;check(o.children.length===0,'render-only page proxies removed');}

// Headless real static world. Counts model WebGLRenderer frustum submissions,
// NOT actual GPU renderer.info or an FPS claim; captain measures browser separately.
const world=JSON.parse(readFileSync(new URL('../src/data/world.json',import.meta.url)));
const ctx=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(t,k)=>t[k]??(()=>{})});
globalThis.document={createElement:()=>({getContext:()=>ctx})};
const real=new THREE.Scene();
const curve=createRiverCurve(world.stream.points),distance=createRiverDistance(sampleRiverSpine(curve,160));
const terrain=createTerrain(world.terrain,distance,{road:world.village.road,pond:world.terrain.pond});terrain.field.colorAt=terrain.colorAt;real.add(terrain.mesh);
const cliff=createCliff(world.cliff,terrain.field);real.add(cliff.group);
const village=createVillage(world.village,terrain.field,world.terrain.pond);real.add(village.group);
const segmentDistance=(px,pz,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((px-a[0])*dx+(pz-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(a[0]+dx*t-px,a[1]+dz*t-pz);};
const basin=world.terrain.basin;
const floraField={half:terrain.field.half,sample:(x,z)=>terrain.field.sample(x,z),slope:(x,z)=>Math.hypot(x-basin.x,z-basin.z)<basin.inner*1.05?9:terrain.field.slope(x,z)};
const nearTree=(x,z)=>Math.hypot(x-world.player.spawn.x,z-world.player.spawn.z)<34||Math.hypot(x-cliff.slit.x,z-cliff.slit.z)<40||world.village.road.points.some((p,i,a)=>i<a.length-1&&segmentDistance(x,z,p,a[i+1])<20);
const flora=createFlora(world.flora,floraField,distance,curve,world.player.spawn,nearTree);real.add(flora.group);
const roadMargin={tuft:0.35,near:0.1,flower:0.12,stone:0.75,patch:0.05};
const sl=cliff.slit,ax=Math.cos(sl.angle),az=Math.sin(sl.angle),d0=world.cliff.plugDepth*0.5;
const scatter=createScatter(world.scatter,terrain.field,(x,z,kind)=>{
 const rd=world.village.road,rm=roadMargin[kind]??0.7;
 if(rd.points.some((p,i,a)=>i<a.length-1&&segmentDistance(x,z,p,a[i+1])<rd.width*0.5+rm))return true;
 for(const blk of world.village.fields.blocks){const half=(blk.cols*blk.plot[0]+(blk.cols-1)*blk.gap)*0.5+0.5;if(Math.abs(x-blk.x)<half&&Math.abs(z-blk.z)<half)return true;}
 const pond=world.terrain.pond;if(Math.hypot(x-pond.x,z-pond.z)<pond.radius+1.2)return true;
 for(const b of village.blockers){const ca=Math.cos(b.rot),sa=Math.sin(b.rot),dx=x-b.x,dz=z-b.z;if(Math.abs(dx*ca-dz*sa)<b.hw+0.7&&Math.abs(dx*sa+dz*ca)<b.hd+0.7)return true;}
 const dx=x-sl.x,dz=z-sl.z;return Math.abs(-dx*az+dz*ax)<2.8&&Math.abs(dx*ax+dz*az)<world.cliff.plugDepth*0.5+1.4;
},world.village.road,{x:sl.x+ax*d0,z:sl.z+az*d0,dx:ax,dz:az,len:36});real.add(scatter.group);
const props=createProps(world.props,terrain.field,village.houseInfo,village.plots,village.road);real.add(props.group);
const hinterland=createHinterland(world.hinterland,terrain.field,distance,world,village,props,cliff);real.add(hinterland.group);
const scenes=createVillageScenes(world,terrain.field,distance,village,props,cliff,hinterland);real.add(scenes.group);
const mysteries=createMysteries(world,terrain.field,distance,village,props,cliff,hinterland,scenes,flora);real.add(mysteries.group);
const life=createVillageLife(world,terrain.field,distance,village,props,cliff,hinterland,scenes,mysteries);real.add(life.group);
const view=new THREE.PerspectiveCamera(world.render.camera.fov,16/9,world.render.camera.near,world.render.camera.far);view.position.set(31,5,-90);view.rotation.order='YXZ';view.rotation.set(-0.06,0.14,0);
const submit={calls:0,triangles:0};
function countSubmissions(s,c){
 s.updateMatrixWorld(true);c.updateWorldMatrix(true,false);projection.multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);submit.calls=submit.triangles=0;
 function visit(o){if(!o.visible)return;if(o.isMesh&&o.layers.test(c.layers)&&(!o.frustumCulled||frustum.intersectsObject(o))){const g=o.geometry,n=o.isInstancedMesh?o.count:1,start=g.drawRange.start,end=Math.min(g.index?.count??g.attributes.position.count,start+g.drawRange.count);if(Array.isArray(o.material)){for(const group of g.groups)if(o.material[group.materialIndex]?.visible){submit.calls++;submit.triangles+=Math.max(0,Math.min(end,group.start+group.count)-Math.max(start,group.start))/3*n;}}else if(o.material.visible){submit.calls++;submit.triangles+=(end-start)/3*n;}}for(const child of o.children)visit(child);}
 visit(s);return {...submit};
}
const beforeWorld=countSubmissions(real,view);
const setupStart=performance.now();
const realVisibility=optimizeStaticVisibility(real);
let afterWorld;realVisibility.render({render(s,c){afterWorld=countSubmissions(s,c);}},view);
const setupAndFirstMockRenderMs=performance.now()-setupStart;
const ownedTypedBytes=realVisibility.entries.reduce((sum,e)=>sum+e.bounds.byteLength+e.indices.byteLength+(e.kind==='pages'?e.proxy.geometry.index.array.byteLength+e.pages.reduce((n,p)=>n+p.indices.byteLength,0):e.proxy.instanceMatrix.array.byteLength+(e.proxy.instanceColor?.array.byteLength??0)),0);
check(afterWorld.calls<=beforeWorld.calls,'real static draw calls do not increase');
check(beforeWorld.triangles-afterWorld.triangles>200000,'real world removes over 200k offscreen submitted triangles');
const managed={...realVisibility.getStats()};
const multiView=[];
for(const aspect of [16/9,1435/681])for(const position of [[31,5,-90],[0,8,0]])for(const yaw of [0.14,Math.PI/2,Math.PI,3*Math.PI/2]){
 view.aspect=aspect;view.updateProjectionMatrix();view.position.set(...position);view.rotation.set(-0.06,yaw,0);
 const before=countSubmissions(real,view);let after;realVisibility.render({render(s,c){after=countSubmissions(s,c);}},view);
 check(after.calls<=before.calls,'multi-view compact rendering never increases draw calls');check(after.triangles<=before.triangles,'multi-view compaction never increases submissions');
 multiView.push({position,yaw,aspect,before,after});
}
view.position.set(31,5,-90);view.aspect=16/9;view.updateProjectionMatrix();view.rotation.set(-0.06,0.14,0);
const times=[];for(let i=0;i<180;i++){view.rotation.y=0.14+Math.sin(i/100)*0.2;const t=performance.now();realVisibility.update(view);times.push(performance.now()-t);}times.sort((a,b)=>a-b);
const byBatch=realVisibility.entries.filter(e=>['bamboo','grass','grass-near','grass-approach'].includes(e.source.name)).map(e=>({name:e.source.name,original:e.source.count,visible:e.proxy.count,trianglesPerInstance:e.triangleCount}));
view.rotation.set(-0.06,0.14,0);
realVisibility.dispose();
assert.deepEqual(countSubmissions(real,view),beforeWorld,'full headless world submissions restored after disposal');checks++;
const untouched=[];real.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&(o.geometry.index?.count??o.geometry.attributes.position.count)>15000)untouched.push({name:o.name,triangles:(o.geometry.index?.count??o.geometry.attributes.position.count)/3});});
console.log(JSON.stringify({status:'passed',checks,headlessStaticVillage:{position:[31,5,-90],yaw:0.14,pitch:-0.06,aspect:'16:9',before:beforeWorld,after:afterWorld,managed,ownedTypedBytes,setupAndFirstMockRenderMs,updateCpuMs:{median:times[90],p95:times[171]},byBatch,untouched,multiView,limitations:'Static subset only; no fauna/people/weather/sky/river GPU draws. Not browser renderer.info or hardware FPS.'}},null,2));
