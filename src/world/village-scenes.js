import * as THREE from 'three';
import config from '../data/village-scenes.json' with { type: 'json' };
import { createHinterlandReservations, hinterlandSiteSafe, segmentDistance, planHinterlandPath } from './hinterland.js';
import { openVesselGeometry, revolvedGeometry, stoneGeometry } from './model-geometry.js';
import { grainKernelGeometry, recordVillageDetail } from './village-detail-geometry.js';
import { buildNaturalRoadRibbon } from './road-geometry.js';

const TAU = Math.PI * 2;
function seeded(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function distanceToPaths(x, z, paths) {
  let d = Infinity;
  for (const p of paths) for (let i = 1; i < p.points.length; i++) d = Math.min(d, segmentDistance(x, z, p.points[i - 1], p.points[i]) - p.width / 2);
  return d;
}
export function createVillageSceneContext(world, field, distanceToRiver, village, props, cliff, hinterland) {
  const reservations = createHinterlandReservations(world, village, props, cliff);
  for (const p of [...(hinterland.trees || []), ...(hinterland.bamboo || []), ...(hinterland.structures || [])]) reservations.circles.push({x:p.x,z:p.z,r:p.radius});
  for (const p of hinterland.paths || []) reservations.corridors.push({points:p.points,half:p.width / 2});
  return {world,field,distanceToRiver,reservations};
}
export function villageSceneSiteSafe(x, z, radius, context) {
  if (!hinterlandSiteSafe(x, z, radius, context)) return false;
  const y = context.field.sample(x,z);
  for (let i = 0; i < 12; i++) if (Math.abs(context.field.sample(x + Math.cos(i * TAU / 12) * radius,z + Math.sin(i * TAU / 12) * radius) - y) > config.search.maxGroundDelta) return false;
  return true;
}
export function planVillageScenes(world, field, distanceToRiver, village, props, cliff, hinterland) {
  const context = createVillageSceneContext(world,field,distanceToRiver,village,props,cliff,hinterland);
  const scenes = [], nature = [], paths = [], rejected = [], rand = seeded(config.seed);
  const routes = [{points:world.village.road.points,width:world.village.road.width},...(hinterland.paths || [])];
  const clear = (x,z,r) => [...scenes,...nature].every(p=>Math.hypot(x-p.x,z-p.z) >= r+p.radius+0.65);
  for (const spec of config.scenes) {
    const candidates = [];
    for (let dx = -config.search.maxOffset; dx <= config.search.maxOffset; dx += config.search.step) for (let dz = -config.search.maxOffset; dz <= config.search.maxOffset; dz += config.search.step) {
      const x=spec.anchor[0]+dx,z=spec.anchor[1]+dz,d=distanceToPaths(x,z,routes);
      if(d > config.search.maxRouteDistance || !clear(x,z,spec.radius) || !villageSceneSiteSafe(x,z,spec.radius,context)) continue;
      candidates.push({x,z,score:Math.hypot(dx,dz)+Math.abs(d-spec.radius-1.4)*0.5});
    }
    candidates.sort((a,b)=>a.score-b.score);
    let accepted = false;
    for (const p of candidates.slice(0,24)) {
      let entry = null, best = Infinity;
      for (const route of routes) for (let i=1;i<route.points.length;i++) {
        const a=route.points[i-1],b=route.points[i],dx=b[0]-a[0],dz=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[1])*dz)/(dx*dx+dz*dz||1)));
        const q=[a[0]+dx*t,a[1]+dz*t],d=Math.hypot(q[0]-p.x,q[1]-p.z);
        if(d<best){best=d;entry=q;}
      }
      const rot=Math.atan2(entry[0]-p.x,entry[1]-p.z);
      const approach=[p.x+Math.sin(rot)*3.55,p.z+Math.cos(rot)*3.55];
      const nav={...context,reservations:{...context.reservations,circles:[...context.reservations.circles,...scenes.map(s=>({x:s.x,z:s.z,r:s.radius}))]}};
      const spur=planHinterlandPath(entry,approach,1.25,nav);
      if(!spur)continue;
      const scene={...spec,x:p.x,z:p.z,y:field.sample(p.x,p.z),rot,approach,routeEntry:entry};
      scenes.push(scene); paths.push({...spur,id:spec.id+'-approach'}); accepted=true; break;
    }
    if(!accepted) rejected.push(spec.id);
  }
  const basin=world.terrain.basin;
  for(let i=0;i<config.nature.attempts && nature.length<config.nature.count;i++) {
    const x=basin.x+(rand()-0.5)*170,z=basin.z+(rand()-0.5)*170,radius=config.nature.radius;
    if(distanceToPaths(x,z,routes)>12 || distanceToPaths(x,z,paths)<radius+0.6 || !clear(x,z,radius) || !villageSceneSiteSafe(x,z,radius,context))continue;
    nature.push({id:'nature-'+nature.length,kind:nature.length%3===0?'fallen-log':nature.length%3===1?'flower-stones':'fern-rock',x,z,y:field.sample(x,z),radius,rot:rand()*TAU,seed:Math.floor(rand()*1e8)});
  }
  return {scenes,nature,paths,rejected,context};
}

// All detail is baked into three shared static batches, never a mesh per blade/cup/brick.
function makeSink() { return {position:[],normal:[],color:[]}; }
function geometryFromSink(sink) {
  const g=new THREE.BufferGeometry();
  for(const key of ['position','normal','color'])g.setAttribute(key,new THREE.Float32BufferAttribute(sink[key],3));
  g.computeBoundingBox();g.computeBoundingSphere();return g;
}
function leafGeometry() {
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,-0.14,0.035,0.42,0,0.07,1,0,0,0,0,0.07,1,0.14,0.035,0.42],3));
  g.computeVertexNormals();return g;
}
function clothGeometry(w,h,hanging=false,phase=0) {
  const p=[],uv=(u,v)=>hanging?[w*(u-0.5),-h*v,0.038*Math.sin(u*TAU*2+phase)*(0.3+v)]:[w*(u-0.5),-0.15*Math.sin(u*Math.PI)-0.1*Math.sin(v*Math.PI),h*(v-0.5)];
  for(let j=0;j<4;j++)for(let i=0;i<12;i++){
    const a=uv(i/12,j/4),b=uv((i+1)/12,j/4),c=uv((i+1)/12,(j+1)/4),d=uv(i/12,(j+1)/4);
    p.push(...a,...b,...c,...a,...c,...d);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();return g;
}
function brickGeometry(r0,r1,y0,y1,a0,a1) {
  const p=[],point=(r,y,a)=>[r*Math.cos(a),y,r*Math.sin(a)];
  const v=[point(r0,y0,a0),point(r0,y0,a1),point(r1,y1,a0),point(r1,y1,a1),point(r0-0.15,y0,a0),point(r0-0.15,y0,a1),point(Math.max(0,r1-0.15),y1,a0),point(Math.max(0,r1-0.15),y1,a1)];
  for(const [a,b,c,d] of [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]])p.push(...v[a],...v[b],...v[c],...v[a],...v[c],...v[d]);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();return g;
}

export function createVillageScenes(world,field,distanceToRiver,village,props,cliff,hinterland) {
  const layout=planVillageScenes(world,field,distanceToRiver,village,props,cliff,hinterland);
  const group=new THREE.Group();group.name='village-scenes';
  const blockers=[],details=[],richness=[],coverage={},sinks={solid:makeSink(),botanical:makeSink(),ground:makeSink()},pal=config.palette;
  const templates={box:new THREE.BoxGeometry(1,1,1),beam:new THREE.CylinderGeometry(0.92,1,1,8),
    twig:new THREE.CylinderGeometry(0.92,1,1,4),kernel:grainKernelGeometry(),
    trayRim:new THREE.TorusGeometry(0.5,0.024,3,16),
    stone:stoneGeometry(431),petal:new THREE.SphereGeometry(0.5,5,2),leaf:leafGeometry(),
    vat:openVesselGeometry('vat'),basket:openVesselGeometry('basket'),bucket:openVesselGeometry('bucket'),
    cup:revolvedGeometry([[0,0],[0.34,0],[0.46,0.7],[0.5,0.9],[0.43,0.96],[0.36,0.76],[0.26,0.18],[0,0.18]],10),
    dish:revolvedGeometry([[0,0],[0.22,0],[0.5,0.16],[0.49,0.23],[0.43,0.2],[0.2,0.07],[0,0.07]],12),
    jar:revolvedGeometry([[0,0],[0.3,0],[0.48,0.2],[0.5,0.52],[0.28,0.85],[0.25,1],[0.18,1],[0.18,0.84],[0.38,0.5],[0.23,0.1],[0,0.1]],12),
    kickWheel:revolvedGeometry([[0,0],[0.30,0],[0.24,0.12],[0.11,0.16],[0.44,0.18],[0.44,0.28],[0.10,0.32],[0.10,0.78],[0.52,0.84],[0.54,0.96],[0.48,1.0],[0,1.0]],12,0.06),
    ring:new THREE.TorusGeometry(0.5,0.035,4,16),disk:new THREE.CylinderGeometry(0.5,0.5,1,12)};
  const flat=new Map(),temp=new THREE.Object3D(),normalMatrix=new THREE.Matrix3(),v=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  let active=null,rand=seeded(config.seed^0x9731);
  const local=(x,y,z)=>[active.x+Math.cos(active.rot)*x+Math.sin(active.rot)*z,y,active.z-Math.sin(active.rot)*x+Math.cos(active.rot)*z];
  const ground=(x,z)=>{const p=local(x,0,z);return field.sample(p[0],p[2]);};
  function recordFootprint(p) {
    if(!active.id)return;
    const b=coverage[active.id] ||= {radius:0,minY:Infinity,maxY:-Infinity};
    b.radius=Math.max(b.radius,Math.hypot(p.x-active.x,p.z-active.z));b.minY=Math.min(b.minY,p.y);b.maxY=Math.max(b.maxY,p.y);
  }
  function push(geo,x,y,z,sx,sy,sz,color,batch='solid',rx=0,ry=0,rz=0) {
    if(!flat.has(geo))flat.set(geo,geo.index?geo.toNonIndexed():geo);
    const g=flat.get(geo),p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color;
    temp.position.set(...local(x,y,z));temp.rotation.set(rx,ry,rz);temp.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up,active.rot));temp.scale.set(sx,sy,sz);temp.updateMatrix();
    const ink=new THREE.Color(color),sink=sinks[batch];normalMatrix.getNormalMatrix(temp.matrix);
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i).applyMatrix4(temp.matrix);sink.position.push(v.x,v.y,v.z);
      recordFootprint(v);
      v.fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();sink.normal.push(v.x,v.y,v.z);
      const shade=c?c.getX(i):1;sink.color.push(ink.r*shade,ink.g*shade,ink.b*shade);
    }
  }
  function solid(x,z,hw,hd,minY,maxY,part,rot=0) {
    const p=local(x,0,z);blockers.push({x:p[0],z:p[2],hw,hd,rot:active.rot+rot,minY,maxY,source:active.id,part});
  }
  function box(x,y,z,w,h,d,color=pal.wood,rot=0){push(templates.box,x,y,z,w,h,d,color,'solid',0,rot);}
  function beam(a,b,r,color=pal.wood) {
    const pa=local(...a),pb=local(...b),d=new THREE.Vector3(pb[0]-pa[0],pb[1]-pa[1],pb[2]-pa[2]);
    const q=new THREE.Quaternion().setFromUnitVectors(up,d.clone().normalize());
    temp.position.set((pa[0]+pb[0])/2,(pa[1]+pb[1])/2,(pa[2]+pb[2])/2);temp.quaternion.copy(q);temp.scale.set(r,d.length(),r);temp.updateMatrix();
    // Fine flower stems, sewing stitches and cord do not need eight-sided cylinders.
    const geo=r<=0.022?templates.twig:templates.beam;if(!flat.has(geo))flat.set(geo,geo.toNonIndexed());
    const g=flat.get(geo),sink=sinks.solid,ink=new THREE.Color(color);normalMatrix.getNormalMatrix(temp.matrix);
    for(let i=0;i<g.attributes.position.count;i++){
      v.fromBufferAttribute(g.attributes.position,i).applyMatrix4(temp.matrix);sink.position.push(v.x,v.y,v.z);recordFootprint(v);
      v.fromBufferAttribute(g.attributes.normal,i).applyMatrix3(normalMatrix).normalize();sink.normal.push(v.x,v.y,v.z);sink.color.push(ink.r,ink.g,ink.b);
    }
  }
  function post(x,z,top,r=0.07) {const y=ground(x,z);beam([x,y-0.1,z],[x,top,z],r);solid(x,z,r,r,y-0.1,top,'post');}
  function vessel(kind,x,z,size,height,y=ground(x,z),color=pal.clay) {
    push(templates[kind],x,y,z,size,height,size,color);details.push({scene:active.id,kind});
  }
  function log(x,z,y,len,r=0.13) {
    beam([x,y,z-len/2],[x,y,z+len/2],r,pal.woodDark);
    for(const side of [-1,1]){
      push(templates.disk,x,y,z+side*(len/2+0.005),r*1.8,0.012,r*1.8,pal.wood,'solid',Math.PI/2);
      push(templates.ring,x,y,z+side*(len/2+0.012),r*1.2,r*1.2,r*1.2,pal.woodDark);
    }
  }
  function woodpile(x,z) {
    const y=ground(x,z);for(let row=0;row<3;row++)for(let j=0;j<4-row;j++){const lx=x+(j-(3-row)/2)*0.25;log(lx,z,ground(lx,z)+0.115+row*0.22,1.15,0.12);}
    solid(x,z,0.55,0.62,y,y+0.85,'woodpile');
  }
  function wovenBasket(x,z) {
    const y=ground(x,z);vessel('basket',x,z,0.65,0.48,y,pal.bamboo);
    for(let k=0;k<5;k++)push(templates.ring,x,y+0.08+k*0.08,z,0.46+k*0.038,0.46+k*0.038,0.46+k*0.038,pal.wood,'solid',Math.PI/2);
    solid(x,z,0.33,0.33,y,y+0.5,'basket');
  }
  function bench(x,z,w,d) {
    const y=ground(x,z);box(x,y+0.48,z,w,0.09,d);
    for(const dx of [-w*0.36,w*0.36])for(const dz of [-d*0.28,d*0.28])beam([x+dx,ground(x+dx,z+dz)-0.05,z+dz],[x+dx,y+0.44,z+dz],0.045);
    beam([x-w*0.36,y+0.2,z],[x+w*0.36,y+0.2,z],0.035,pal.woodDark);
    solid(x,z,w/2,d/2,y-0.05,y+0.53,'bench');
  }
  function fern(x,z,size=1) {
    const y=ground(x,z);
    for(let arm=0;arm<7;arm++){
      const a=arm*TAU/7+0.2;
      for(let j=1;j<=5;j++){
        const t=j/5,h=Math.sin(t*Math.PI*0.8)*0.4*size,reach=t*0.6*size;
        for(const side of [-1,1])push(templates.leaf,x+Math.sin(a)*reach,y+h,z+Math.cos(a)*reach,0.42*size*(1-t*0.5),0.65,0.2*size*(1-t*0.5),j%2?pal.leaf:pal.leafLight,'botanical',-0.2,a+side*0.95);
      }
    }
  }
  function flowers(x,z,count=18) {
    const y=ground(x,z);
    for(let i=0;i<count;i++){
      const a=rand()*TAU,r=Math.sqrt(rand())*0.72,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r,gy=ground(px,pz),h=0.2+rand()*0.35;
      beam([px,gy,pz],[px+0.025,gy+h,pz],0.008,pal.leaf);
      for(let j=0;j<5;j++){
        const t=j*TAU/5;push(templates.petal,px+Math.cos(t)*0.052,gy+h,pz+Math.sin(t)*0.052,0.1,0.035,0.072,i%3?pal.flower:pal.pink,'botanical',0,t);
      }
      push(templates.petal,px,gy+h+0.014,pz,0.048,0.024,0.048,pal.bamboo,'botanical');
      push(templates.leaf,px,gy+h*0.35,pz,0.32,1,0.2,pal.leaf,'botanical',0,a);
    }
    return y;
  }
  const detail=(category,build)=>recordVillageDetail(richness,sinks,active,category,build);
  function dryingTray(x,z,tea=false) {
    const gy=ground(x,z),top=gy+(tea?0.42:0.56),size=tea?0.9:1.15;
    // Low tripod and a shallow woven bamboo sieve, not another solid basket.
    for(let k=0;k<3;k++){
      const a=k*TAU/3,dx=Math.cos(a)*size*0.32,dz=Math.sin(a)*size*0.32;
      beam([x+dx,ground(x+dx,z+dz),z+dz],[x+dx*0.8,top-0.03,z+dz*0.8],0.028,pal.wood);
    }
    push(templates.disk,x,top,z,size,0.022,size,pal.bamboo);
    push(templates.trayRim,x,top+0.035,z,size,size,size,pal.wood,'solid',Math.PI/2);
    for(let j=-3;j<=3;j++){
      const off=j*size*0.115,len=Math.sqrt(size*size*0.22-off*off)*2;
      box(x,top+0.017,z+off,len,0.012,0.018,pal.wood);
    }
    // Golden-angle distribution is local and consumes none of the layout RNG.
    for(let k=0;k<34;k++){
      const a=k*2.3999632297,r=Math.sqrt((k+0.5)/34)*size*0.41;
      const px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;
      if(tea)push(templates.leaf,px,top+0.028,pz,0.2,0.25,0.12,k%3?pal.leaf:pal.leafLight,'botanical',0,a);
      else push(templates.kernel,px,top+0.037,pz,0.06,0.026,0.035,k%4?'#C9AE64':'#DFCC8F','solid',0,a);
    }
  }
  function harvestBasket(x,z) {
    const y=ground(x,z)+0.39;
    for(let k=0;k<7;k++){
      const a=k*2.4,r=k?0.16:0,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;
      push(templates.petal,px,y+(k%3)*0.035,pz,0.16,0.19,0.15,k%3?pal.pink:'#E0BB8C');
      push(templates.leaf,px,y+0.075,pz,0.18,0.3,0.12,pal.leaf,'botanical',0,a);
    }
  }
  function fieldTools() {
    const y=ground(2.25,2.05);
    beam([2.25,y+0.1,2.05],[2.2,y+1.35,1.8],0.022,pal.bamboo);
    box(2.25,y+0.1,2.05,0.48,0.055,0.055,pal.wood);
    for(let j=0;j<5;j++)box(2.05+j*0.1,y+0.045,2.12,0.025,0.03,0.17,pal.wood);
    beam([2.62,y+0.18,2.08],[2.5,y+1.1,1.9],0.024,pal.wood);
    push(templates.dish,2.62,y+0.14,2.1,0.32,0.19,0.45,pal.bamboo,'solid',0,0,0.3);
  }
  function foldedLinen(x,z,y) {
    for(let k=0;k<3;k++){
      box(x+(k%2)*0.035,y+0.035+k*0.065,z,0.5-k*0.035,0.058,0.34,k%2?pal.indigo:pal.cloth);
      box(x+(k%2)*0.035,y+0.035+k*0.065,z+0.173,0.42-k*0.035,0.012,0.008,pal.bamboo);
    }
  }
  function steppingStones() {
    for(let j=0;j<5;j++){
      const x=(j%2?0.1:-0.12),z=1.5+j*0.49,y=ground(x,z);
      push(templates.stone,x,y+0.035,z,0.75,0.09,0.48,pal.path,'ground',0,j*0.35);
    }
  }
  for(const scene of layout.scenes){
    active=scene;const y=scene.y;
    steppingStones();
    if(scene.kind==='tea'){
      // Open-sided pavilion: four planted feet, collar ties, knee braces, soft sewn canopy.
      for(const x of [-2.6,2.6])for(const z of [-1.75,1.75]){
        post(x,z,y+2.62,0.075);
        beam([x,y+2.12,z],[x-Math.sign(x)*0.5,y+2.62,z],0.04,pal.bamboo);
        for(let k=0;k<3;k++)push(templates.ring,x,y+0.2+k*0.9,z,0.16,0.16,0.16,pal.bamboo,'solid',Math.PI/2);
      }
      for(const z of [-1.75,1.75])beam([-2.85,y+2.6,z],[2.85,y+2.6,z],0.06);
      for(const x of [-2.6,0,2.6])beam([x,y+2.65,-2.2],[x,y+2.65,2.2],0.045,pal.bamboo);
      push(clothGeometry(6.2,4.65),0,y+2.84,0,1,1,1,pal.cloth,'botanical');
      for(const x of [-2.95,2.95])beam([x,y+2.69,-2.25],[x,y+2.69,2.25],0.022,pal.bamboo);
      for(let i=0;i<16;i++)beam([-2.9+i*0.38,y+2.79,-2.27],[-2.9+i*0.38,y+2.79,-2.17],0.009,pal.wood);
      const ty=ground(0,-0.8)+0.85;
      // Plank-built tea table with tapered legs, tray, hollow cups, pot spout and loop handle.
      for(let j=0;j<5;j++)box(-0.92+j*0.46,ty,-0.85,0.445,0.1,0.95,pal.wood);
      for(const x of [-0.85,0.85])for(const z of [-1.15,-0.55])beam([x,ground(x,z)-0.05,z],[x,ty-0.05,z],0.055,pal.woodDark);
      solid(0,-0.85,1.16,0.48,y,ty+0.05,'tea-table');
      bench(-1.85,-0.65,0.42,1.75);bench(1.85,-0.65,0.42,1.75);
      box(0,ty+0.075,-0.8,1.25,0.045,0.65,pal.woodDark);
      vessel('jar',-0.12,-0.82,0.32,0.29,ty+0.1,pal.clayLight);
      push(templates.disk,-0.12,ty+0.4,-0.82,0.18,0.035,0.18,pal.clay);
      beam([0,ty+0.25,-0.82],[0.21,ty+0.38,-0.82],0.045,pal.clayLight);
      push(templates.ring,-0.29,ty+0.28,-0.82,0.24,0.24,0.24,pal.clayLight,'solid',0,Math.PI/2);
      for(const [x,z]of [[0.39,-0.57],[-0.48,-0.57],[0.4,-1.02]])vessel('cup',x,z,0.115,0.105,ty+0.1,pal.cloth);
      wovenBasket(-2.9,0.65);
      vessel('bucket',2.85,0.55,0.5,0.48,ground(2.85,0.55),pal.bamboo);solid(2.85,0.55,0.25,0.25,y,y+0.5,'bucket');
      push(clothGeometry(0.45,0.6,true),2.62,y+2.36,1.78,1,1,1,pal.indigo,'botanical');
      detail('grain-drying-tray',()=>dryingTray(-1.5,1.65));
      detail('tea-leaf-tray',()=>dryingTray(1.35,1.65,true));
      detail('peach-harvest',()=>harvestBasket(-2.9,0.65));
      detail('bamboo-field-tools',fieldTools);
      flowers(-3.1,2.3,14);fern(3.1,-2.6,0.75);
    }else if(scene.kind==='laundry'){
      for(const x of [-2.6,2.6]){post(x,-1.5,y+2.25,0.065);beam([x,ground(x, -1.5)+0.45,-1.5],[x*0.8,y+2.2,-1.5],0.035);}
      // Bowed line and differently sized wrinkled linen, with sewn hems and bamboo pegs.
      for(let i=0;i<12;i++)beam([-2.7+i*0.45,y+2.28-0.11*Math.sin(i*Math.PI/12),-1.5],[-2.7+(i+1)*0.45,y+2.28-0.11*Math.sin((i+1)*Math.PI/12),-1.5],0.012,pal.woodDark);
      for(let i=0;i<4;i++){
        const x=-1.88+i*1.22,h=i%2?1.22:0.95,top=y+2.2;
        push(clothGeometry(0.96,h,true,i),x,top,-1.5,1,1,1,i%2?pal.indigo:pal.cloth,'botanical');
        for(const dx of [-0.31,0.31])box(x+dx,top+0.015,-1.5,0.045,0.11,0.055,pal.bamboo);
        for(let j=0;j<12;j++)beam([x-0.42+j*0.075,top-h+0.035,-1.49],[x-0.39+j*0.075,top-h+0.035,-1.49],0.006,pal.wood);
        solid(x,-1.5,0.49,0.08,top-h,top,'hanging-linen');
      }
      woodpile(2.2,0.7);wovenBasket(-1.55,1.25);
      const gy=ground(-2.45,0.2);vessel('bucket',-2.45,0.2,1,0.62,gy,pal.wood);
      push(templates.disk,-2.45,gy+0.5,0.2,0.72,0.018,0.72,'#9DAEA4');
      for(let j=0;j<3;j++)push(templates.ring,-2.45,gy+0.12+j*0.18,0.2,0.78+j*0.08,0.78+j*0.08,0.78+j*0.08,pal.woodDark,'solid',Math.PI/2);
      solid(-2.45,0.2,0.51,0.51,gy,gy+0.64,'wash-tub');
      box(-2.18,gy+0.67,0.17,0.28,0.05,1.15,pal.bamboo,-0.24);
      detail('ribbed-washboard',()=>{
        for(let k=0;k<9;k++){
          const dz=-0.42+k*0.1;
          box(-2.18+Math.sin(-0.24)*dz,gy+0.705,0.17+Math.cos(-0.24)*dz,0.25,0.025,0.028,pal.wood,-0.24);
        }
        box(-2.18,gy+0.72,-0.27,0.15,0.045,0.1,pal.cloth,-0.24);
      });
      detail('folded-household-linen',()=>{
        const top=ground(1.55,-0.35)+0.49;
        for(const x of [1.23,1.87])for(const z of [-0.58,-0.12])beam([x,ground(x,z),z],[x,top,z],0.032,pal.woodDark);
        for(let j=0;j<3;j++)box(1.55,top,-0.57+j*0.22,0.88,0.055,0.21,pal.bamboo);
        foldedLinen(1.55,-0.35,top+0.04);
        foldedLinen(-1.55,1.25,ground(-1.55,1.25)+0.44);
      });
      fern(2.75,-2.5,0.65);flowers(-2.5,2.1,12);
    }else if(scene.kind==='kiln'){
      const kx=-1.35,kz=-1.25,gy=ground(kx,kz);
      // Hollow brick dome with a genuine omitted front opening, not a sphere with a black sticker.
      for(let row=0;row<6;row++){
        const y0=row*0.27,y1=(row+1)*0.27-0.018,r0=1.13*Math.sqrt(Math.max(0.06,1-(y0/1.85)**2)),r1=1.13*Math.sqrt(Math.max(0.06,1-(y1/1.85)**2));
        for(let j=0;j<16;j++){
          const a=j*TAU/16+(row%2)*0.09;
          if(row<3&&Math.sin(a+0.18)>0.86)continue;
          const brick=brickGeometry(r0,r1,y0,y1,a+0.012,a+TAU/16-0.012);
          push(brick,kx,gy,kz,1,1,1,row%2?pal.clay:pal.clayLight);brick.dispose();
        }
      }
      push(templates.disk,kx,gy+1.65,kz,1.08,0.12,1.08,pal.clay);
      const arch=new THREE.Shape();arch.moveTo(-0.4,0);arch.lineTo(0.4,0);arch.lineTo(0.4,0.48);arch.quadraticCurveTo(0.4,0.88,0,0.91);arch.quadraticCurveTo(-0.4,0.88,-0.4,0.48);arch.closePath();
      push(new THREE.ShapeGeometry(arch),kx,gy+0.025,kz+0.72,1,1,1,'#5E5549','botanical');
      const chimney=revolvedGeometry([[0.34,0],[0.34,0.14],[0.28,0.18],[0.25,0.96],[0.30,1.0],[0.21,1.0],[0.20,0.12]],10,0.05);
      push(chimney,kx-0.55,gy+1.1,kz-0.4,1,1.5,1,pal.clay);
      // 窑囱四角小砖墩与人字防雨瓦帽
      for(const dx of [-0.19,0.19])for(const dz of [-0.19,0.19])box(kx-0.55+dx,gy+2.68,kz-0.4+dz,0.07,0.16,0.07,pal.clayLight);
      push(templates.box,kx-0.55,gy+2.80,kz-0.4-0.14,0.68,0.055,0.36,pal.clay,'solid',0.38,0,0);
      push(templates.box,kx-0.55,gy+2.80,kz-0.4+0.14,0.68,0.055,0.36,pal.clayLight,'solid',-0.38,0,0);
      solid(kx,kz,1.12,1.12,gy,gy+1.76,'kiln');
      for(let j=0;j<4;j++)box(kx-0.45+j*0.3,gy+0.04,kz+1.2,0.26,0.1,0.45,pal.clayLight);
      const sx=1.65,sz=-1.5,base=ground(sx,sz);
      for(const dx of [-0.95,0.95]){
        post(sx+dx,sz,base+1.85,0.055);
        beam([sx+dx,base+1.82,sz],[sx+dx,base+2.08,sz],0.052,pal.woodDark);
        push(templates.disk,sx+dx,base+0.05,sz,0.26,0.12,0.26,pal.stone);
      }
      // 陶架后背交叉木斜撑 + 顶层避雨斜木小檐
      beam([sx-0.95,base+0.30,sz-0.28],[sx+0.95,base+1.62,sz-0.28],0.026,pal.woodDark);
      beam([sx+0.95,base+0.30,sz-0.28],[sx-0.95,base+1.62,sz-0.28],0.026,pal.woodDark);
      push(templates.box,sx,base+2.10,sz,2.38,0.055,0.92,pal.bamboo,'solid',0.20,0,0);
      for(const ht of [0.28,0.92,1.58]){
        for(let j=0;j<3;j++)box(sx,base+ht,sz-0.23+j*0.22,2.12,0.07,0.2);
        for(let j=0;j<4;j++)vessel(j%3===0?'jar':j%3===1?'vat':'dish',sx-0.78+j*0.51,sz,0.36+(j%2)*0.055,j%3===2?0.38:0.43,base+ht+0.04,j%2?pal.clayLight:pal.clay);
      }
      solid(sx,sz,1.07,0.38,base,base+1.86,'pottery-shelf');
      woodpile(-2.7,0.8);
      // 秦汉脚踏双盘拉坯陶车（石承座 + 下飞轮 + 中轴 + 上倒角陶盘）
      const wx=1.65,wz=1.1,wy=ground(wx,wz);
      push(templates.kickWheel,wx,wy,wz,1.06,0.52,1.06,pal.wood);
      push(templates.disk,wx,wy+0.05,wz,0.68,0.10,0.68,pal.stone);
      vessel('jar',wx,wz,0.3,0.35,wy+0.52,pal.clay);solid(wx,wz,0.57,0.57,wy,wy+0.88,'potter-wheel');
      bench(2.65,1.35,0.46,0.46);vessel('dish',0.7,-0.1,0.5,0.45,ground(0.7,-0.1),pal.clayLight);solid(0.7,-0.1,0.25,0.25,y,y+0.15,'drying-bowl');
      detail('potter-hand-tools',()=>{
        const top=ground(2.6,-0.12)+0.4;
        for(const x of [2.34,2.86])for(const z of [-0.28,0.05])box(x,top-0.2,z,0.065,0.4,0.065,pal.woodDark);
        box(2.6,top,-0.12,0.72,0.065,0.5,pal.wood);
        for(let k=0;k<3;k++)push(templates.petal,2.36+k*0.11,top+0.08,-0.2,0.13,0.11,0.14,k%2?pal.clay:pal.clayLight);
        box(2.67,top+0.055,-0.05,0.22,0.03,0.12,pal.bamboo,0.35);
        beam([2.7,top+0.06,-0.08],[2.87,top+0.06,-0.17],0.014,pal.woodDark);
        push(templates.trayRim,2.8,top+0.06,-0.23,0.12,0.17,0.12,pal.bamboo,'solid',Math.PI/2);
      });
      flowers(-2.7,-2.5,12);fern(2.8,2.4,0.7);
    }
  }
  for(const patch of layout.nature){
    active=patch;rand=seeded(patch.seed);
    if(patch.kind==='fallen-log'){
      const y=ground(0,0);log(0,0,y+0.19,2.35,0.2);solid(0,0,0.21,1.2,y,y+0.4,'fallen-log');
      beam([0,y+0.25,-0.2],[0.48,y+0.51,-0.5],0.065,pal.woodDark);
      for(let j=0;j<3;j++)push(templates.dish,0.18,y+0.21+j*0.07,-0.5+j*0.35,0.22,0.12,0.25,pal.clayLight,'botanical',0,0,0.35);
      fern(-0.65,0.15,1);fern(0.65,0.7,0.75);
    }else if(patch.kind==='flower-stones'){
      for(let j=0;j<4;j++)push(templates.stone,(j%2)*0.4-0.5,ground(-0.5+j*0.3,0.8)+0.04,0.8-j*0.45,0.55,0.12,0.45,pal.stone,'ground',0,j*0.65);
      flowers(0.25,0,24);flowers(-0.55,-0.55,12);
    }else{
      const y=ground(-0.2,0.1);push(templates.stone,-0.2,y+0.22,0.1,1.15,0.64,0.9,pal.stone);solid(-0.2,0.1,0.58,0.45,y,y+0.52,'boulder');
      fern(0.6,0.4,1.1);fern(-0.6,-0.6,0.85);flowers(0.2,-0.55,9);
    }
  }
  // Approach ribbons are narrow and ground-conforming; they join existing routes smoothly.
  active={x:0,z:0,rot:0};
  for(const path of layout.paths){
    buildNaturalRoadRibbon(path.points, {
      field,
      halfWidth: path.width * 0.5,
      lift: 0.045,
      sampleStep: 0.65,
      smoothPasses: 2,
      roadColor: pal.path,
      vergeColor: '#7E9155',
      camber: 0.016,
      vergeWidth: 0.22,
      rutDepth: 0.004,
      startFlare: path.width * 0.26,
      endFlare: path.width * 0.16,
      flareDist: 1.4,
      scatterPebbles: false,
      sink: sinks.ground
    });
  }
  let triangles=0;
  for(const [name,sink]of Object.entries(sinks))if(sink.position.length){
    const mesh=new THREE.Mesh(geometryFromSink(sink),new THREE.MeshLambertMaterial({vertexColors:true,side:name==='solid'?THREE.FrontSide:THREE.DoubleSide,polygonOffset:name==='ground',polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
    mesh.name='village-scenes-'+name;group.add(mesh);triangles+=sink.position.length/9;
  }
  for(const g of new Set([...Object.values(templates),...flat.keys(),...flat.values()]))g.dispose();
  const mapData={scenes:layout.scenes.map(s=>({...s,footprint:{radius:s.radius}})),nature:layout.nature.map(p=>({...p})),paths:layout.paths.map(p=>({...p,points:p.points.map(q=>[...q])}))};
  return {group,blockers,mapData,...layout,details,richness,coverage,stats:{drawCalls:group.children.length,triangles},update(_dt,_elapsed,_sky){/* Static scenes need no per-frame allocations. */}};
}
