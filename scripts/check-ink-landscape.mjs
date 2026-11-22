import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createTerrain, createMountains, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { installSkyAppearance } from '../src/systems/scene-appearance.js';
const originalURL = new URL('../src/world/terrain.js', import.meta.url);
const source = readFileSync(new URL('../.visual-round9-baseline/src/world/terrain.js', import.meta.url), 'utf8')
  .replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => 'from ' + JSON.stringify(specifier.startsWith('.') ? new URL(specifier, originalURL).href : import.meta.resolve(specifier)));
const baseline = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
const ctx = new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(t,k)=>t[k]??(()=>{})});
globalThis.document = {createElement:()=>({getContext:()=>ctx})};
const distance = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points),160));
const look = {road:world.village.road,pond:world.terrain.pond};
// This older gate isolates ink painting from geometry. New bank relief is intentional
// and is checked on the active world by check-riverbank-naturalization.mjs.
const legacyCfg={...world.terrain,shoreline:undefined};
const before=createTerrain(world.terrain,distance,look),old=baseline.createTerrain(legacyCfg,distance,look);
const geometryFixture=createTerrain(legacyCfg,distance,look);
assert.deepEqual(before.mesh.geometry.index.array,old.mesh.geometry.index.array,'active world retains terrain topology');
assert.deepEqual(before.mesh.geometry.attributes.uv.array,old.mesh.geometry.attributes.uv.array);
for(const name of ['position','normal','uv']) assert.deepEqual(geometryFixture.mesh.geometry.attributes[name].array,old.mesh.geometry.attributes[name].array,name+' immutable legacy baseline');
assert.deepEqual(geometryFixture.mesh.geometry.index.array,old.mesh.geometry.index.array);
assert.deepEqual(geometryFixture.field.heights,old.field.heights);
for(let z=-350;z<=350;z+=25)for(let x=-350;x<=350;x+=25){
 assert.equal(geometryFixture.heightAt(x,z),old.heightAt(x,z));assert.equal(geometryFixture.field.sample(x,z),old.field.sample(x,z));assert.equal(geometryFixture.field.slope(x,z),old.field.slope(x,z));
 const c=before.colorAt(x,z);assert([c.r,c.g,c.b].every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert.deepEqual(c,before.colorAt(x,z));
}
assert(geometryFixture.mesh.geometry.attributes.color.array.some((v,i)=>Math.abs(v-old.mesh.geometry.attributes.color.array[i])>0.002),'ink slope / wet-bank coloring must change paint without changing geometry');
const config=JSON.parse(readFileSync(new URL('../src/data/ink-landscape.json',import.meta.url)));
const {shadeInkGround,mountainHazeAt}=await import('../src/world/ink-landscape.js');
const shade=(nx,cfg=config.terrain)=>shadeInkGround(new THREE.Color(.35,.4,.32),{normalX:nx,normalZ:0,slope:.8,height:4,waterLevel:-1,noise:.5},cfg);
assert(shade(.8).r-shade(.8).b>shade(-.8).r-shade(-.8).b+.005,'opposed slope warm/cool distinction');
const neutral={...config.terrain,aspectStrength:0,mossStrength:0,wetStrength:0};assert.deepEqual(shade(.8,neutral),shade(-.8,neutral));
const tuned=createTerrain(world.terrain,distance,{...look,inkLandscape:{...config,terrain:neutral}});assert.notDeepEqual(tuned.mesh.geometry.attributes.color.array,before.mesh.geometry.attributes.color.array,'config reaches real mesh');
const sample=before.field.sample,slope=before.field.slope;let h=world.terrain.waterLevel-.35;before.field.sample=()=>h;before.field.slope=()=>0;
const at=y=>{h=y;return before.colorAt(0,80);};const gap=(a,b)=>Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b);
for(const offset of [-.85,-.42,-.35,-.12,-.06,.08,.22,.32,.42,1.05,1.25])assert(gap(at(world.terrain.waterLevel+offset-1e-5),at(world.terrain.waterLevel+offset+1e-5))<.001,'shore continuity '+offset);
before.field.sample=sample;before.field.slope=slope;
const mountains=createMountains(world.mountains),mountainsAgain=createMountains(world.mountains),oldMountains=baseline.createMountains(world.mountains);assert.equal(typeof mountains.update,'function');assert.equal(mountains.children.length,oldMountains.children.length);
const compiled=[];
for(let i=0;i<mountains.children.length;i++){
 const mesh=mountains.children[i],againMesh=mountainsAgain.children[i];
 for(const name of ['position','color','aRidgeInfo']){
  const attr=mesh.geometry.attributes[name];
  assert(attr&&attr.array.length>600,'mountain tier '+i+' carries sculpted '+name+' buffer');
  assert([...attr.array].every(Number.isFinite),'mountain tier '+i+' finite '+name);
  assert.deepEqual(attr.array,againMesh.geometry.attributes[name].array,'deterministic mountain '+name);
 }
 assert.deepEqual(mesh.geometry.index.array,againMesh.geometry.index.array,'deterministic mountain index');
 const pos=mesh.geometry.attributes.position;
 let minR=Infinity,maxR=0,maxY=-Infinity,minY=Infinity;
 for(let v=0;v<pos.count;v++){
  const r=Math.hypot(pos.getX(v),pos.getZ(v)),y=pos.getY(v);
  minR=Math.min(minR,r);maxR=Math.max(maxR,r);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
 }
 assert(minR>=world.mountains.innerRadius-65&&maxR<=world.mountains.outerRadius+55,'mountain tier '+i+' stays inside concentric horizon annulus');
 assert(maxY<=65&&maxY-minY>35,'mountain tier '+i+' preserves Shan-Shui vertical relief under 65m cap');
 assert(maxR-minR>45,'mountain tier '+i+' has 3D spur/gully radial relief instead of flat cylinder');
 assert.equal(mesh.material.fog,false);assert(mesh.material.isMeshBasicMaterial);
 installSkyAppearance(mesh.material,{value:0});const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};mesh.material.onBeforeCompile(shader,{});compiled.push(shader);
 assert(shader.fragmentShader.includes('cameraPosition.xz')&&shader.fragmentShader.includes('vInkMountainWorld.y'));assert(shader.fragmentShader.includes('uSkyDesaturation'));assert(mesh.material.customProgramCacheKey().includes('ink-mountain-v1'));
}
mountainsAgain.dispose();
const haze=(y,d,r=0)=>mountainHazeAt(y,d,r,config.mountains);assert(haze(-15,480)>haze(36,480)+.15);assert(haze(15,540)>haze(15,430)+.05);assert(haze(15,480,1)>haze(15,480,0));
for(let y=-25;y<=65;y+=2)for(let d=350;d<610;d+=2){assert(haze(y,d)>=0&&haze(y,d)<=config.mountains.maxOpacity);assert(Math.abs(haze(y,d+.01)-haze(y,d-.01))<.001);assert(Math.abs(haze(y+.01,d)-haze(y-.01,d))<.001);}
const camera=new THREE.PerspectiveCamera();camera.position.set(30,4,-140);
for(const phase of ['day','dusk','night'])for(const rain of [0,1]){const color=world.sky.times[phase].fogColor;mountains.update(1/60,{rainIntensity:rain,getAppearance:()=>({fogColor:color.slice(1)})},camera);assert.equal(compiled[0].uniforms.uInkMountainFog.value.getHexString(),color.slice(1).toLowerCase());assert.equal(compiled[0].uniforms.uInkMountainRain.value,rain);if(phase==='night')assert(Math.max(...compiled[0].uniforms.uInkMountainFog.value.toArray())<.15);const frozen=JSON.stringify(mountains.getStats());mountains.update(0,{rainIntensity:1-rain,getAppearance:()=>({fogColor:'ffffff'})},camera);assert.equal(JSON.stringify(mountains.getStats()),frozen);}
const stable=JSON.stringify(mountains.getStats());
for(const dt of [0,-1,NaN,Infinity])mountains.update(dt,{rainIntensity:0,getAppearance:()=>({fogColor:'ffffff'})},camera);
assert.equal(JSON.stringify(mountains.getStats()),stable,'invalid dt never mutates uniforms');
mountains.update(1/60,{rainIntensity:NaN,getAppearance:()=>undefined},camera);
assert.equal(JSON.stringify(mountains.getStats()),stable,'missing sky sample retains last finite uniforms');
mountains.dispose();mountains.dispose();assert.equal(mountains.getStats().disposed,true);
const disposed=JSON.stringify(mountains.getStats());mountains.update(1/60,{rainIntensity:1,getAppearance:()=>({fogColor:'ffffff'})},camera);assert.equal(JSON.stringify(mountains.getStats()),disposed);
for(const item of [before,old,tuned,geometryFixture]){item.mesh.geometry.dispose();item.mesh.material.map.dispose();item.mesh.material.dispose();}oldMountains.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
console.log(JSON.stringify({inkLandscape:true,exactLegacyGeometryAndHeightfield:true,continuousShore:true,configurableSlope:true,mountainBatches:mountains.children.length,skyPhases:6,dtZero:true,gpuPixels:false}));
