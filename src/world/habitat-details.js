import * as THREE from 'three';
import { segmentDistance } from './hinterland.js';
import { createExteriorContext } from './exterior-exploration.js';
import { planMysterySites } from './mysteries.js';

const TAU = Math.PI * 2;
const DEFAULTS = Object.freeze({ enabled: true, seed: 202611124, maxTriangles: 6500,
  understory: 18, bank: 16, farm: 14, maxSlope: 0.42, clearance: 0.35 });
const PALETTE = { leaf: '#62814B', light: '#96AA67', young: '#B0B978', bark: '#897256',
  cut: '#C5AD80', stone: '#939C8A', stoneLight: '#B8BBA5', sand: '#BAB08B',
  reed: '#809660', grain: '#C7B575', stalk: '#A1A268' };
const unwrap = value => value?.layout || value || {};
// A separate string hash stream: never borrow or advance a source generator's RNG.
function random(seed, label) {
  let s = seed >>> 0;
  for (const char of label) s = Math.imul(s ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function boxDistance(x, z, b) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), dx = x - b.x, dz = z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx*c-dz*s)-b.hw), Math.max(0, Math.abs(dx*s+dz*c)-b.hd));
}

// Physics is bilinear; the visible terrain is piecewise triangular. Use the higher floor.
export function habitatSurface(field, x, z) {
  const sampled = field.sample(x, z);
  if (!field.heights || !field.step) return sampled;
  const fx = (x+field.half)/field.step, fz = (z+field.half)/field.step;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix<0 || iz<0 || ix>=field.segments || iz>=field.segments) return NaN;
  if (typeof field.sampleMesh === 'function') {
    return Math.max(sampled, field.sampleMesh(x, z));
  }
  const stride = field.segments+1;
  const u=fx-ix, v=fz-iz, a=field.heights[iz*stride+ix], b=field.heights[iz*stride+ix+1];
  const c=field.heights[(iz+1)*stride+ix], d=field.heights[(iz+1)*stride+ix+1];
  const rendered=u+v<=1 ? a*(1-u-v)+b*u+c*v : d*(u+v-1)+b*(1-v)+c*(1-u);
  return Math.max(sampled, rendered);
}

export function createHabitatContext(options) {
  const {world,field,distanceToRiver,riverCurve,flora,boats,cliff,village={},props={}} = options;
  const cfg={...DEFAULTS,...world.habitatDetails};
  const hinterland=unwrap(options.hinterland), scenes=unwrap(options.villageScenes), exterior=unwrap(options.exterior);
  const old=createExteriorContext(world,field,distanceToRiver,riverCurve,flora,boats,cliff);
  // Copies only: the original source reservations/layouts stay deep-equal.
  const reservations={circles:old.reservations.circles.map(c=>({...c})),
    boxes:old.reservations.boxes.map(b=>({...b})), corridors:old.reservations.corridors.map(c=>({...c}))};
  const circle=(x,z,r,source)=>reservations.circles.push({x,z,r,source});
  const corridor=(points,half,source)=>{if(points?.length>1)reservations.corridors.push({points,half,source});};
  const houses=village.houseInfo || [];
  for(const [i,h] of houses.entries()) {
    circle(h.x,h.z,Math.hypot(h.w/2,h.d/2)+2,'house-'+i);
    circle(h.doorX,h.doorZ,i===1 ? 9 : 6.5,'porch-'+i);
    corridor(h.spur?.pts,(h.spur?.half || 0.8)+0.8,'door-path-'+i);
    // Rain shelter moves straight from the main road to the actual doorway.
    const points=world.village.road.points; let best=null,dist=Infinity;
    for(let j=1;j<points.length;j++) {
      const a=points[j-1],b=points[j],dx=b[0]-a[0],dz=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((h.doorX-a[0])*dx+(h.doorZ-a[1])*dz)/(dx*dx+dz*dz||1)));
      const q=[a[0]+dx*t,a[1]+dz*t],d=Math.hypot(q[0]-h.doorX,q[1]-h.doorZ);
      if(d<dist){dist=d;best=q;}
    }
    if(best)corridor([best,[h.doorX,h.doorZ]],1.6,'shelter-'+i);
  }
  for(const b of [...(village.blockers || []),...(hinterland.blockers || []),...(scenes.blockers || []),...(options.villageLife?.blockers || [])])reservations.boxes.push({...b});
  for(const [i,b] of world.village.fields.blocks.entries()) {
    const w=b.cols*b.plot[0]+(b.cols-1)*b.gap, d=b.rows*b.plot[1]+(b.rows-1)*b.gap;
    reservations.boxes.push({x:b.x+w/2,z:b.z-d/2,hw:w/2+0.65,hd:d/2+0.65,rot:0,source:'old-field-'+i});
  }
  for(const p of props.marks || []) {
    if(p.kind==='fence')reservations.boxes.push({x:p.x,z:p.z,hw:(p.halfW||0.5)+0.3,hd:Math.max(Math.abs(p.front||0),Math.abs(p.back||0))+0.3,rot:p.rot||0,source:'fence'});
    else circle(p.x,p.z,p.r || Math.hypot(p.w||1,p.d||1)/2+0.5,'old-prop');
  }
  for(const p of village.bamboo || [])circle(p[0],p[1],1.1,'village-bamboo');
  for(const p of village.mulberry || [])circle(p[0],p[1],p[2]+0.4,'village-mulberry');
  for(const p of [...(hinterland.trees || []),...(hinterland.bamboo || []),...(hinterland.structures || [])])circle(p.x,p.z,p.radius*1.65+0.4,'hinterland-crown-or-structure');
  for(const p of [...(scenes.scenes || []),...(scenes.nature || []),...(options.villageLife?.items || []),...(exterior.nature || [])])circle(p.x,p.z,p.radius || 2,'existing-detail');
  corridor(world.village.road.points,world.village.road.width/2+1.2,'main-road');
  for(const p of [...(hinterland.paths || []),...(scenes.paths || []),...(exterior.paths || [])])corridor(p.points,p.width/2+0.85,'existing-route');
  // The bilateral, meandering original terrain track is checked exactly in habitatSiteSafe.
  for(const s of exterior.stops || []) {
    circle(s.x,s.z,(s.quietRadius || s.radius || 1.1)+0.6,'exterior-stop');
    corridor([[s.x,s.z],[s.target.x,s.target.z]],0.85,'reward-view');
  }
  // No mysteries input is needed: use the same pure, seeded original planner to reserve them.
  if(houses.length && options.hinterland && options.villageScenes) {
    for(const s of planMysterySites(world,field,distanceToRiver,village,props,cliff,hinterland,scenes,flora)) {
      circle(s.x,s.z,5.5,'mystery-'+s.id);
      corridor([[s.approach.x,s.approach.z],[s.x,s.z]],1.1,'mystery-view');
    }
  }
  circle(world.player.spawn.x,world.player.spawn.z,5,'spawn');
  const pond=world.terrain.pond;
  if(pond)circle(pond.x,pond.z,pond.radius+0.7,'pond');
  return {world,field,distanceToRiver,riverCurve,cfg,reservations,
    dry:world.terrain.waterLevel+Math.max(0.45,(world.stream.waveAmp || 0)+0.3)};
}

// Check the complete disk on a <=0.4m lattice, including its boundary, not just its centre.
export function habitatSiteSafe(x,z,radius,context) {
  const {world,field,cfg,reservations,dry}=context;
  if(![x,z,radius].every(Number.isFinite) || radius<=0)return false;
  const extent=world.map.extent, half=world.terrain.size/2;
  if(x-radius<Math.max(-half+2,extent.x[0]+2) || x+radius>Math.min(half-2,extent.x[1]-2) ||
    z-radius<Math.max(-half+2,extent.z[0]+2) || z+radius>Math.min(half-2,extent.z[1]-2) ||
    Math.hypot(x,z)+radius>world.player.boundsRadius-2)return false;
  for(const c of reservations.circles)if(Math.hypot(x-c.x,z-c.z)<radius+c.r+cfg.clearance)return false;
  for(const b of reservations.boxes)if(boxDistance(x,z,b)<radius+cfg.clearance)return false;
  for(const c of reservations.corridors)for(let i=1;i<c.points.length;i++)if(segmentDistance(x,z,c.points[i-1],c.points[i])<radius+c.half+cfg.clearance)return false;
  const check=(px,pz)=>{
    const terrain=world.terrain;
    const meander=Math.sin(pz*0.017)*2.4+Math.sin(px*0.013+1.7)*1.6;
    if(terrain.pathOffset && Math.abs(context.distanceToRiver(px,pz)-terrain.pathOffset-meander)<terrain.pathWidth+0.6)return false;
    return Number.isFinite(habitatSurface(field,px,pz)) && field.sample(px,pz)>=dry &&
      Number.isFinite(field.slope(px,pz)) && field.slope(px,pz)<=cfg.maxSlope;
  };
  const n=Math.ceil(radius/0.35),step=radius/n;
  for(let ix=-n;ix<=n;ix++)for(let iz=-n;iz<=n;iz++)if(ix*ix+iz*iz<=n*n && !check(x+ix*step,z+iz*step))return false;
  for(let i=0;i<32;i++)if(!check(x+Math.cos(i*TAU/32)*radius,z+Math.sin(i*TAU/32)*radius))return false;
  return true;
}

function anchors(context) {
  const {world,riverCurve}=context, result=[];
  for(const [i,z] of [62,96,132,170,194].entries()) {
    let p, tangent,best=Infinity;
    for(let j=0;j<=160;j++){const q=riverCurve.getPointAt(j/160);if(Math.abs(q.z-z)<best){p=q;tangent=riverCurve.getTangentAt(j/160);best=Math.abs(q.z-z);}}
    const nx=tangent.z,nz=-tangent.x;
    result.push({region:'understory',id:'grove-edge-'+i,x:p.x+nx*30,z:p.z+nz*30,spread:13,quota:i<3?4:3});
    result.push({region:'understory',id:'opposite-grove-'+i,x:p.x-nx*30,z:p.z-nz*30,spread:11,quota:2});
    if(i<4)result.push({region:'bank',id:'reed-reach-'+i,x:p.x-nx*18,z:p.z-nz*18,spread:10,quota:4});
  }
  for(const [i,b] of world.village.fields.blocks.entries()) {
    const width=b.cols*b.plot[0]+(b.cols-1)*b.gap;
    for(const side of [-1,1])result.push({region:'farm',id:'field-margin-'+i+'-'+side,x:side<0?b.x-4.2:b.x+width+4.2,z:b.z-b.plot[1]*0.6,spread:7,quota:2});
  }
  return result;
}

export function createHabitatDetails(options) {
  const group=new THREE.Group();group.name='habitat-details';group.matrixAutoUpdate=false;group.updateMatrix();
  const context=createHabitatContext(options),{field,cfg}=context;
  const layout={clusters:[],pockets:[],rejected:[],reservations:context.reservations};
  const targets=[],sinks={solid:[],botanical:[],ground:[]};
  const colors=Object.fromEntries(Object.entries(PALETTE).map(([k,c])=>[k,new THREE.Color(c)]));
  // Missing a source means its crowns/people/routes cannot be proven clear: emit nothing.
  const complete=['flora','hinterland','village','villageScenes','villageLife','props','boats','cliff','exterior'].every(key=>options[key]);
  let disposed=false,triangles=0;
  const budget=Math.max(0,Math.min(6500,Number.isFinite(cfg.maxTriangles)?cfg.maxTriangles:6500));
  function build(item) {
    const buffers={solid:[],botanical:[],ground:[]}, marks=[];
    const point=(x,y,z)=>{const c=Math.cos(item.rot),s=Math.sin(item.rot),wx=item.x+x*c+z*s,wz=item.z-x*s+z*c;return [wx,habitatSurface(field,wx,wz)+y,wz];};
    const tri=(batch,a,b,c,color)=>{const ink=colors[color];buffers[batch].push(...a,ink.r,ink.g,ink.b,...b,ink.r,ink.g,ink.b,...c,ink.r,ink.g,ink.b);};
    const quad=(batch,a,b,c,d,color)=>{tri(batch,a,b,c,color);tri(batch,a,c,d,color);};
    const mark=(id,x,y,z,name)=>{const p=point(x,y,z);marks.push({id,x:p[0],y:p[1],z:p[2],range:5.5,name});};
    function leaf(x,y,z,angle,length,width,color) {
      const dx=Math.cos(angle),dz=Math.sin(angle),ox=-dz*width,oz=dx*width;
      const a=point(x,y,z),m=point(x+dx*length*0.45,y+0.055,z+dz*length*0.45),tip=point(x+dx*length,y+0.018,z+dz*length);
      const l=point(x+dx*length*0.45+ox,y,z+dz*length*0.45+oz),r=point(x+dx*length*0.45-ox,y,z+dz*length*0.45-oz);
      tri('botanical',a,m,l,color);tri('botanical',m,tip,l,color);tri('botanical',a,r,m,color);tri('botanical',m,r,tip,color);
    }
    function twig(ax,az,bx,bz,r=0.045,height=0.065,color='bark') {
      const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),nx=-dz/len,nz=dx/len;
      const a=[],b=[];
      for(let i=0;i<4;i++){const t=i*TAU/4;a.push(point(ax+nx*Math.cos(t)*r,height+Math.sin(t)*r,az+nz*Math.cos(t)*r));b.push(point(bx+nx*Math.cos(t)*r*0.55,height+Math.sin(t)*r*0.55,bz+nz*Math.cos(t)*r*0.55));}
      for(let i=0;i<4;i++)quad('solid',a[i],b[i],b[(i+1)%4],a[(i+1)%4],color);
      tri('solid',a[0],a[1],a[2],'cut');tri('solid',a[0],a[2],a[3],'cut');
    }
    function fern(x,z,scale) {
      // Three-segment rachises join each leaflet to a real ground-rooted plant.
      for(let j=0;j<5;j++)for(let k=0;k<3;k++) {
        const a=j*TAU/5+0.3,t0=k/3,t1=(k+1)/3,dx=Math.cos(a),dz=Math.sin(a),w=0.009*scale;
        const y0=k===0?0.025:0.08+Math.sin(t0*Math.PI*0.8)*0.35*scale;
        const y1=0.08+Math.sin(t1*Math.PI*0.8)*0.35*scale;
        quad('botanical',point(x+dx*t0*scale*0.57-dz*w,y0,z+dz*t0*scale*0.57+dx*w),point(x+dx*t0*scale*0.57+dz*w,y0,z+dz*t0*scale*0.57-dx*w),point(x+dx*t1*scale*0.57+dz*w,y1,z+dz*t1*scale*0.57-dx*w),point(x+dx*t1*scale*0.57-dz*w,y1,z+dz*t1*scale*0.57+dx*w),'reed');
      }
      for(let j=0;j<5;j++)for(let k=1;k<=3;k++) {
        const a=j*TAU/5+0.3,t=k/3,px=x+Math.cos(a)*t*scale*0.57,pz=z+Math.sin(a)*t*scale*0.57;
        const y=0.08+Math.sin(t*Math.PI*0.8)*0.35*scale,w=0.12*(1-t*0.4)*scale;
        const root=point(px-Math.cos(a)*0.16*scale,y-0.035,pz-Math.sin(a)*0.16*scale),tip=point(px+Math.cos(a)*0.1*scale,y+0.025,pz+Math.sin(a)*0.1*scale);
        tri('botanical',root,point(px-Math.sin(a)*w,y,pz+Math.cos(a)*w),tip,j%2?'leaf':'light');
        tri('botanical',root,tip,point(px+Math.sin(a)*w,y,pz-Math.cos(a)*w),'leaf');
      }
    }
    function deposit(x,z,r) {
      for(let j=0;j<7;j++){const a=j*TAU/7,b=(j+1)*TAU/7;
        tri('ground',point(x,0.04,z),point(x+Math.cos(b)*r*(0.8+j%2*0.1),0.04,z+Math.sin(b)*r*0.65),point(x+Math.cos(a)*r*(0.8+(j+1)%2*0.1),0.04,z+Math.sin(a)*r*0.65),'sand');}
    }
    function stone(x,z,rx,rz,h) {
      for(let i=0;i<6;i++){const a=i*TAU/6,b=(i+1)*TAU/6;tri('solid',point(x+Math.cos(a)*rx,0.025,z+Math.sin(a)*rz),point(x+Math.cos(b)*rx,0.025,z+Math.sin(b)*rz),point(x+0.035,h,z-0.025),i<3?'stoneLight':'stone');}
    }
    if(item.region==='understory') {
      fern(-0.4,-0.18,1);fern(-0.05,0.58,0.55);
      for(let j=0;j<3;j++) {
        const x=0.4+Math.cos(j*2.1)*0.12,z=0.02+Math.sin(j*2.1)*0.13;
        quad('botanical',point(0.38,0.025,0.02),point(0.42,0.025,0.02),point(x+0.012,0.44,z),point(x-0.012,0.44,z),'bark');
      }
      for(let j=0;j<3;j++)for(let k=0;k<3;k++)leaf(0.4+Math.cos(j*2.1)*0.12,0.12+k*0.14,0.02+Math.sin(j*2.1)*0.13,j*2.1+k,0.38,0.12,k===2?'light':'leaf');
      twig(-0.8,-0.65,0.55,-0.5);twig(0.05,-0.55,0.28,-0.86,0.025);
      deposit(0.3,-0.5,0.32);
      mark('fern',-0.4,0.25,-0.18,'林下蕨草');mark('shrub',0.4,0.38,0.02,'低矮灌丛');mark('fallen-branch',-0.15,0.09,-0.55,'林间枯枝');
    } else if(item.region==='bank') {
      deposit(-0.2,-0.18,0.9);
      stone(-0.5,-0.2,0.37,0.26,0.22);stone(-0.05,-0.4,0.23,0.18,0.13);stone(-0.72,0.25,0.2,0.16,0.12);
      for(let j=0;j<6;j++){
        const x=0.4+Math.cos(j*2.4)*0.18,z=0.1+Math.sin(j*2.4)*0.22,h=0.5+(j%3)*0.12;
        quad('botanical',point(x-0.018,0.025,z),point(x+0.018,0.025,z),point(x+0.08,h,z),point(x+0.045,h,z),'reed');
        leaf(x,0.18,z,j*2.4,0.34,0.055,'light');
      }
      mark('bank-stone',-0.5,0.18,-0.2,'岸边卵石');mark('water-grass',0.4,0.42,0.1,'岸生水草');
    } else {
      deposit(0,-0.1,0.8);
      for(let j=0;j<7;j++) {
        const x=(j%3-1)*0.38,z=(Math.floor(j/3)-0.7)*0.4,h=0.48+(j%3)*0.1;
        quad('botanical',point(x-0.014,0.025,z),point(x+0.014,0.025,z),point(x+0.055,h,z),point(x+0.025,h,z),'stalk');
        leaf(x,0.19,z,j*2.2,0.26,0.045,'light');
        const top=point(x+0.04,h+0.16,z),bottom=point(x+0.04,h-0.01,z);
        for(let k=0;k<4;k++){const a=k*TAU/4,b=(k+1)*TAU/4,pa=point(x+0.04+Math.cos(a)*0.065,h+0.055,z+Math.sin(a)*0.065),pb=point(x+0.04+Math.cos(b)*0.065,h+0.055,z+Math.sin(b)*0.065);tri('botanical',bottom,pb,pa,'grain');tri('botanical',pa,pb,top,'grain');}
      }
      // A few cut stalks beside the living plants: tending, not another path strip.
      twig(-0.72,0.7,0.25,0.8,0.022,0.05,'cut');twig(-0.6,0.8,0.4,0.63,0.022,0.05,'cut');
      mark('grain-crop',0.03,0.6,0,'田边粟穗');
    }
    return {buffers,marks};
  }
  if(cfg.enabled!==false && complete)for(const anchor of anchors(context)) {
    const requested=Number.isFinite(cfg[anchor.region])?Math.max(0,Math.floor(cfg[anchor.region])):DEFAULTS[anchor.region];
    const remaining=requested-layout.clusters.filter(p=>p.region===anchor.region).length;
    const quota=Math.min(anchor.quota,remaining),rand=random(cfg.seed,anchor.id),start=layout.clusters.length;
    for(let attempt=0;attempt<360 && layout.clusters.length-start<quota;attempt++) {
      const a=rand()*TAU,r=Math.sqrt(rand())*anchor.spread,x=anchor.x+Math.cos(a)*r,z=anchor.z+Math.sin(a)*r;
      const radius=anchor.region==='bank'?1.2:1.35;
      if(layout.clusters.some(p=>Math.hypot(p.x-x,p.z-z)<p.radius+radius+0.65) || !habitatSiteSafe(x,z,radius,context))continue;
      if(anchor.region==='bank' && (field.sample(x,z)>context.dry+2.7 || options.distanceToRiver(x,z)>worldBankDistance(context)))continue;
      const item={id:anchor.id+'-'+(layout.clusters.length-start),pocket:anchor.id,region:anchor.region,x,z,y:habitatSurface(field,x,z),radius,rot:rand()*TAU};
      const {buffers,marks}=build(item),added=Object.values(buffers).reduce((sum,b)=>sum+b.length/18,0);
      if(triangles+added>budget)break;
      // Eligibility uses the emitted footprint too: never trust just the nominal centre/radius.
      let safe=true;
      for(const buffer of Object.values(buffers))for(let i=0;i<buffer.length;i+=6) {
        const [vx,vy,vz]=buffer.slice(i,i+3);
        if(Math.hypot(vx-x,vz-z)>radius || !Number.isFinite(vy) || field.sample(vx,vz)<context.dry || field.slope(vx,vz)>cfg.maxSlope || vy<habitatSurface(field,vx,vz))safe=false;
      }
      for(const buffer of Object.values(buffers))for(let i=0;i<buffer.length;i+=18) {
        for(const weights of [[1/3,1/3,1/3],[0.5,0.5,0],[0,0.5,0.5],[0.5,0,0.5]]) {
          let x=0,y=0,z=0;
          for(let k=0;k<3;k++){x+=buffer[i+k*6]*weights[k];y+=buffer[i+k*6+1]*weights[k];z+=buffer[i+k*6+2]*weights[k];}
          if(y<habitatSurface(field,x,z)-0.008)safe=false;
        }
      }
      if(!safe)continue;
      item.ranges=Object.fromEntries(Object.entries(buffers).map(([batch,b])=>[batch,{start:sinks[batch].length/6,count:b.length/6}]));
      item.triangles=added;
      for(const batch of Object.keys(sinks))sinks[batch].push(...buffers[batch]);
      targets.push(...marks);layout.clusters.push(item);triangles+=added;
    }
    const accepted=layout.clusters.length-start;
    layout.pockets.push({id:anchor.id,region:anchor.region,accepted,requested:quota});
    if(accepted<quota)layout.rejected.push({id:anchor.id,requested:quota,accepted});
  }
  for(const [name,sink] of Object.entries(sinks))if(sink.length) {
    const position=[],color=[];
    for(let i=0;i<sink.length;i+=6){position.push(...sink.slice(i,i+3));color.push(...sink.slice(i+3,i+6));}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(color,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,flatShading:true});
    const mesh=new THREE.Mesh(geometry,material);mesh.name='habitat-details-'+name;mesh.matrixAutoUpdate=false;mesh.updateMatrix();group.add(mesh);
  }
  return {group,targets,layout,getStats:()=>({triangles,drawCalls:group.children.length,clusters:layout.clusters.length,targets:targets.length,
    regions:Object.fromEntries(['understory','bank','farm'].map(region=>[region,layout.clusters.filter(p=>p.region===region).length])),
    rejected:layout.rejected.map(p=>({...p})),disabled:cfg.enabled===false,degraded:!complete,disposed}),
  dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const mesh of group.children){mesh.geometry.dispose();mesh.material.dispose();}}};
}
function worldBankDistance(context) { return context.world.terrain.bankWidth+5; }
