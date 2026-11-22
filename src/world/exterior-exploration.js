import * as THREE from 'three';
import { segmentDistance } from './hinterland.js';
import { sightBlocked } from '../systems/observation.js';
import { buildExteriorGeometry } from './exterior-geometry.js';

const TAU = Math.PI * 2;
export const EXTERIOR_DEFAULTS = Object.freeze({ enabled:true, seed:20261112, pathWidth:1.25,
  pathGrid:1.5, pathSample:0.4, maxSlope:0.5, dryMargin:0.4, bankMargin:0.55,
  boundsMargin:2, clearance:0.3, spawnRadius:4, stopRadius:1.1, searchRadius:24,
  maxPathNodes:18000, natureCount:24, maxTriangles:4500 });
const boxDistance = (x,z,b) => {
  const c=Math.cos(b.rot || 0),s=Math.sin(b.rot || 0),dx=x-b.x,dz=z-b.z;
  return Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-b.hw),Math.max(0,Math.abs(dx*s+dz*c)-b.hd));
};
const seeded = seed => {let s=seed>>>0;return ()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);};

// Read actual immutable instance geometry, including crowns, lean and per-instance scale.
// Never substitute trunk-only spots or advance any pre-existing placement RNG.
export function exteriorTreeReservations(flora) {
  const circles=[],m=new THREE.Matrix4(),w=new THREE.Matrix4(),v=new THREE.Vector3();
  flora?.group?.updateMatrixWorld(true);
  flora?.group?.traverse(mesh=>{
    if(!mesh.isInstancedMesh || !/^tree-/.test(mesh.name))return;
    const p=mesh.geometry.attributes.position;
    let localRadius=0;
    for(let k=0;k<p.count;k++)localRadius=Math.max(localRadius,Math.hypot(p.getX(k),p.getZ(k)));
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,m);w.multiplyMatrices(mesh.matrixWorld,m);v.setFromMatrixPosition(w);
      const e=w.elements,scale=Math.max(Math.hypot(e[0],e[2]),Math.hypot(e[8],e[10]));
      circles.push({x:v.x,z:v.z,r:localRadius*scale,source:mesh.name+':'+i});
    }
  });
  return circles;
}

// Reproduce the existing mooring search exactly; boats intentionally expose no landing API.
function mooringReservations(world,curve,field) {
  const circles=[],corridors=[],landings=[];
  const cfg=world.boats;
  if(!cfg?.boats)return {circles,corridors,landings};
  for(const [i,b] of cfg.boats.entries()){
    let best=Infinity,bt=0;
    for(let j=0;j<=600;j++){
      const p=curve.getPointAt(j/600),d=(p.x-b.x)**2+(p.z-b.z)**2;
      if(d<best){best=d;bt=j/600;}
    }
    const p=curve.getPointAt(bt),tan=curve.getTangentAt(bt),nx=tan.z,nz=-tan.x;
    const side=(b.x-p.x)*nx+(b.z-p.z)*nz>=0?1:-1;
    const yaw=Math.atan2(-tan.z*(b.face || 1),tan.x*(b.face || 1))+b.rot;
    let bank;
    for(let d=2;d<=cfg.mooring.search;d+=cfg.mooring.step){
      const x=b.x+nx*side*d,z=b.z+nz*side*d,y=field.sample(x,z);
      if(y>world.terrain.waterLevel+cfg.mooring.dry){bank={x,z,y};break;}
    }
    if(!bank)bank={x:b.x+nx*side*cfg.mooring.search,z:b.z+nz*side*cfg.mooring.search,y:world.terrain.waterLevel+0.4};
    const bow=[b.x+Math.cos(yaw)*(cfg.length/2-0.06),b.z-Math.sin(yaw)*(cfg.length/2-0.06)];
    circles.push({x:bank.x,z:bank.z,r:1.45,source:'landing-'+i});
    corridors.push({points:[[bank.x,bank.z],bow],half:0.65,source:'rope-'+i});
    landings.push({...bank,id:'landing-'+i,bow});
  }
  return {circles,corridors,landings};
}
function indexCircles(circles) {
  const bins=new Map(),size=8;
  for(const c of circles)for(let ix=Math.floor((c.x-c.r)/size);ix<=Math.floor((c.x+c.r)/size);ix++)
    for(let iz=Math.floor((c.z-c.r)/size);iz<=Math.floor((c.z+c.r)/size);iz++){
      const key=ix+','+iz;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(c);
    }
  return (x,z,r)=>{
    const out=new Set();
    for(let ix=Math.floor((x-r)/size);ix<=Math.floor((x+r)/size);ix++)for(let iz=Math.floor((z-r)/size);iz<=Math.floor((z+r)/size);iz++)
      for(const c of bins.get(ix+','+iz)||[])out.add(c);
    return out;
  };
}
export function createExteriorContext(world,field,distanceToRiver,riverCurve,flora,boats,cliff) {
  const cfg={...EXTERIOR_DEFAULTS,...world.exploration};
  // Navigation stops well before the story portal. Terrain size and player radial bound are distinct.
  const trees=exteriorTreeReservations(flora),moor=mooringReservations(world,riverCurve,field);
  const portal=world.terrain.portal;
  // Boats remain animated and untouched; reserve their actual full fitted hulls, not just configuration centres.
  const hulls=[];
  boats?.group?.updateMatrixWorld(true);
  boats?.group?.traverse(mesh=>{
    if(!mesh.isMesh||!/^boat-\d+$/.test(mesh.name))return;
    const origin=new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld),v=new THREE.Vector3();let r=0;
    for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      v.fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld);
      r=Math.max(r,Math.hypot(v.x-origin.x,v.z-origin.z));
    }
    hulls.push({x:origin.x,z:origin.z,r:r+0.35,source:mesh.name});
  });
  const boxes=[...(cliff?.blockers || [])];
  if(portal)boxes.push({x:portal.x,z:portal.z,hw:portal.halfW+5,hd:portal.halfLen+5,rot:Math.atan2(portal.ux || 0,portal.uz || 1),source:'story-portal'});
  const reservations={trees,circles:[...trees,...moor.circles,...hulls],corridors:moor.corridors,boxes,landings:moor.landings};
  return {world,field,distanceToRiver,riverCurve,cfg,reservations,queryCircles:indexCircles(reservations.circles),
    flora,minZ:45,maxZ:Math.min(218,world.player.spawn.z+14),minX:-55,maxX:95};
}

// radius includes the complete visible footprint, not merely a placement centre.
export function exteriorSiteSafe(x,z,radius,context,object=false) {
  const {world,field,cfg,reservations}=context;
  if(![x,z,radius].every(Number.isFinite)||radius<0)return false;
  if(z-radius<context.minZ||z+radius>context.maxZ||x-radius<context.minX||x+radius>context.maxX)return false;
  if(Math.hypot(x,z)+radius>world.player.boundsRadius-cfg.boundsMargin)return false;
  if(object&&Math.hypot(x-world.player.spawn.x,z-world.player.spawn.z)<cfg.spawnRadius+radius)return false;
  const dry=world.terrain.waterLevel+Math.max(cfg.dryMargin,(world.stream.waveAmp || 0)+cfg.bankMargin);
  for(let i=-1;i<12;i++){
    const dx=i<0?0:Math.cos(i*TAU/12)*radius,dz=i<0?0:Math.sin(i*TAU/12)*radius;
    const y=field.sample(x+dx,z+dz),slope=field.slope(x+dx,z+dz);
    if(!Number.isFinite(y)||!Number.isFinite(slope)||y<dry||slope>cfg.maxSlope)return false;
  }
  for(const c of context.queryCircles(x,z,radius+cfg.clearance))
    if(Math.hypot(x-c.x,z-c.z)<radius+c.r+cfg.clearance)return false;
  for(const b of reservations.boxes)if(boxDistance(x,z,b)<radius+cfg.clearance)return false;
  for(const c of reservations.corridors)for(let i=1;i<c.points.length;i++)
    if(segmentDistance(x,z,c.points[i-1],c.points[i])<radius+c.half+cfg.clearance)return false;
  return true;
}
export function exteriorEdgeSafe(a,b,radius,context) {
  const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/context.cfg.pathSample));
  for(let i=0;i<=n;i++)if(!exteriorSiteSafe(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,radius,context))return false;
  return true;
}
export function exteriorViewSafe(eye,target,context,targetTreeSource) {
  if(sightBlocked(eye,target,context.reservations.boxes,context.field))return false;
  if(!context.flora?.group)return true;
  const origin=new THREE.Vector3(eye.x,eye.y,eye.z),end=new THREE.Vector3(target.x,target.y,target.z);
  const delta=end.sub(origin),distance=delta.length();
  if(distance<0.1)return true;
  const ray=new THREE.Raycaster(origin,delta.normalize(),0.05,distance-0.05);
  // Unlike footprint cylinders this respects canopy height and a view underneath branches.
  return !ray.intersectObject(context.flora.group,true).some(hit=>hit.object.name+':'+hit.instanceId!==targetTreeSource);
}
function reachableNetwork(start,context) {
  const {cfg,minX,maxX,minZ,maxZ}=context,step=cfg.pathGrid,half=cfg.pathWidth/2+0.42;
  const ox=Math.ceil(minX/step)*step,oz=Math.ceil(minZ/step)*step,nx=Math.floor((maxX-ox)/step)+1;
  const point=k=>[ox+(k%nx)*step,oz+Math.floor(k/nx)*step];
  const id=(x,z)=>Math.round((z-oz)/step)*nx+Math.round((x-ox)/step);
  const startId=id(...start),safeCache=new Map();
  const safe=k=>{if(!safeCache.has(k)){const p=point(k);safeCache.set(k,exteriorSiteSafe(...p,half,context));}return safeCache.get(k);};
  const previous=new Map(),distance=new Map(),queue=[];
  // Allow a non-grid spawn; its connecting edge is validated with the same full width.
  const roots=[];
  for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
    const k=startId+dz*nx+dx,p=point(k);
    if(safe(k)&&exteriorEdgeSafe(start,p,half,context)){roots.push(k);previous.set(k,null);distance.set(k,Math.hypot(p[0]-start[0],p[1]-start[1]));queue.push(k);}
  }
  for(let head=0;head<queue.length&&head<cfg.maxPathNodes;head++){
    const k=queue[head],p=point(k);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      const q=[p[0]+dx*step,p[1]+dz*step];
      if(q[0]<ox||q[0]>maxX||q[1]<oz||q[1]>maxZ)continue;
      const nk=id(...q);
      if(previous.has(nk)||!safe(nk)||!exteriorEdgeSafe(p,q,half,context))continue;
      previous.set(nk,k);distance.set(nk,distance.get(k)+step*Math.hypot(dx,dz));queue.push(nk);
    }
  }
  return {previous,point,distance,half,roots,start};
}
function pathTo(k,network,context) {
  const points=[];let current=k;
  while(current!==null){points.push(network.point(current));current=network.previous.get(current);}
  points.push(network.start);points.reverse();
  // Line-of-sight simplification is checked on the real field. No spline corner cutting.
  const simple=[points[0]];
  for(let i=0;i<points.length-1;){let j=points.length-1;while(j>i+1&&!exteriorEdgeSafe(points[i],points[j],network.half,context))j--;simple.push(points[j]);i=j;}
  return simple;
}
const pathDistance=(x,z,paths)=>{
  let d=Infinity;for(const p of paths)for(let i=1;i<p.points.length;i++)d=Math.min(d,segmentDistance(x,z,p.points[i-1],p.points[i])-p.width/2);return d;
};
export function planExteriorExploration(world,field,distanceToRiver,riverCurve,flora,boats,cliff) {
  const context=createExteriorContext(world,field,distanceToRiver,riverCurve,flora,boats,cliff),{cfg}=context;
  const stops=[],paths=[],nature=[],rejected=[];
  if(!cfg.enabled)return {stops,paths,nature,rejected,context,reservations:context.reservations};
  const spawn=[world.player.spawn.x,world.player.spawn.z];
  const peach=(flora?.spots || []).reduce((a,b)=>!a||Math.hypot(b[0]-16,b[2]-120)<Math.hypot(a[0]-16,a[2]-120)?b:a,null);
  const net=world.boats?.boats?.find(b=>b.fit==='net'),bend=world.boats?.boats?.find(b=>b.fit==='basket');
  const specs=[{id:'reed-listening',name:'苇岸听水',kind:'ferry',anchor:[26,178],target:net?{x:net.x,y:world.terrain.waterLevel+0.8,z:net.z}:null},
    {id:'peach-clearing',name:'桃阴小憩',kind:'peach',anchor:peach?[peach[0]-5,peach[2]]:[34,120],target:peach?{x:peach[0],y:peach[1]+3,z:peach[2]}:null},
    {id:'river-bend',name:'曲水回望',kind:'bend',anchor:[18,84],target:bend?{x:bend.x,y:world.terrain.waterLevel+0.8,z:bend.z}:null}];
  for(const spec of specs){
    const start=stops.length?[stops[stops.length-1].x,stops[stops.length-1].z]:spawn;
    const network=reachableNetwork(start,context),candidates=[];
    if(!spec.target){rejected.push({id:spec.id,reason:'missing-existing-landmark'});continue;}
    for(const k of network.previous.keys()){
      const [x,z]=network.point(k),d=Math.hypot(x-spec.anchor[0],z-spec.anchor[1]);
      if(d>cfg.searchRadius||!exteriorSiteSafe(x,z,cfg.stopRadius,context,true))continue;
      if(spec.kind==='peach'&&Math.hypot(x-peach[0],z-peach[2])>11)continue;
      if(stops.some(s=>Math.hypot(s.x-x,s.z-z)<24))continue;
      const eye={x,y:field.sample(x,z)+world.player.eyeHeight,z};
      if(sightBlocked(eye,spec.target,context.reservations.boxes,field))continue;
      candidates.push({k,x,z,score:d+Math.abs(distanceToRiver(x,z)-22)*0.2});
    }
    candidates.sort((a,b)=>a.score-b.score||a.k-b.k);
    const targetTreeSource=spec.kind==='peach'?context.reservations.trees.find(t=>Math.hypot(t.x-peach[0],t.z-peach[2])<0.05)?.source:undefined;
    const p=candidates.find(p=>exteriorViewSafe({x:p.x,y:field.sample(p.x,p.z)+world.player.eyeHeight,z:p.z},spec.target,context,targetTreeSource));
    if(!p){rejected.push({id:spec.id,reason:'no-dry-connected-visible-clearing'});continue;}
    const route=pathTo(p.k,network,context),view=[spec.target.x-p.x,spec.target.z-p.z],len=Math.hypot(...view)||1;
    const stop={...spec,targetTreeSource,x:p.x,z:p.z,y:field.sample(p.x,p.z),radius:cfg.stopRadius,quietRadius:3,
      approach:route.length>1?route[route.length-2]:spawn,view:[view[0]/len,view[1]/len]};
    stops.push(stop);paths.push({id:spec.id+'-walk',points:route,width:cfg.pathWidth});
  }
  // Stops are empty standing/viewing pockets. Border objects are optional and NEVER consume a route.
  const rand=seeded(cfg.seed);
  for(const stop of stops){
    const desired=Math.floor(cfg.natureCount/Math.max(1,stops.length));let accepted=0;
    for(let attempt=0;attempt<320&&accepted<desired;attempt++){
      const angle=rand()*TAU,r=2.5+rand()*6.5,x=stop.x+Math.cos(angle)*r,z=stop.z+Math.sin(angle)*r;
      const kind=accepted===0?'waystone':accepted===1?'fallen-log':accepted%3===0?'flowers':'fern-rock';
      const radius=kind==='fallen-log'?1.45:kind==='waystone'?0.85:0.75;
      if(!exteriorSiteSafe(x,z,radius,context,true)||pathDistance(x,z,paths)<radius+0.85)continue;
      if(stops.some(s=>Math.hypot(x-s.x,z-s.z)<radius+s.radius+0.8))continue;
      if(nature.some(n=>Math.hypot(x-n.x,z-n.z)<radius+n.radius+0.4))continue;
      // Keep the reward sightline open, including low logs and the prominent upright stone.
      if(stops.some(s=>segmentDistance(x,z,[s.x,s.z],[s.target.x,s.target.z])<radius+0.5))continue;
      nature.push({id:stop.id+'-'+accepted,stop:stop.id,kind,x,z,y:field.sample(x,z),radius,rot:rand()*TAU,seed:Math.floor(rand()*1e8)});accepted++;
    }
  }
  return {stops,paths,nature,rejected,context,reservations:context.reservations};
}
export function createExteriorExploration(world,field,distanceToRiver,riverCurve,flora,boats,cliff) {
  const layout=planExteriorExploration(world,field,distanceToRiver,riverCurve,flora,boats,cliff);
  const visual=buildExteriorGeometry(layout,field,layout.context.cfg);
  const mapData={paths:layout.paths,stops:layout.stops.map(({id,name,x,z,kind})=>({id,name,x,z,kind}))};
  return {...visual,layout,mapData,getStats:()=>({...visual.getStats(),stops:layout.stops.length,paths:layout.paths.length,
    nature:layout.nature.length,rejected:layout.rejected.map(r=>({...r}))})};
}
