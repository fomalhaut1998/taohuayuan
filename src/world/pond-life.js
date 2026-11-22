import * as THREE from 'three';
import { createHabitatContext, habitatSurface } from './habitat-details.js';
import { segmentDistance } from './hinterland.js';
import { PondGeometry, carpGeometry, shrimpGeometry, dragonflyGeometry, rippleGeometry } from './pond-life-geometry.js';

const TAU=Math.PI*2;
const unbox=value=>value?.layout||value||{};
function boxDistance(x,z,b){const c=Math.cos(b.rot||0),s=Math.sin(b.rot||0),dx=x-b.x,dz=z-b.z;return Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-b.hw),Math.max(0,Math.abs(dx*s+dz*c)-b.hd));}
function random(){let s=202611136;return ()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}

/** Additive scene; elapsed is intentionally not a clock source (pause cannot catch up). */
export function createPondLife(options){
  const {world,field,village}=options,pond=world?.terrain?.pond;
  const group=new THREE.Group();group.name='pond-life';
  const blockers=[],targets=[],stations=[],layout={placements:[],reservations:[],camera:null};
  const counts={lotusLeaves:0,flowers:0,duckweed:0,dragonflies:0,carp:0,shrimp:0,watergrass:0,rhizomes:0,mussels:0,laundry:0,tubs:0};
  let disposed=false,time=0,touches=0,surfaceArea=0;
  const owned=new Set(),materials=new Map(),anim={fish:[],shrimp:[],flies:[]},rand=random();
  const complete=pond&&field&&village?.pond?.rim?.length>=3&&['flora','boats','cliff','hinterland','villageScenes','villageLife','props','exterior'].every(k=>options[k]);
  let context;
  if(complete){context=createHabitatContext(options);context.reservations.circles=context.reservations.circles.filter(c=>c.source!=='pond');
    for(const source of [options.habitatDetails,...(Array.isArray(options.reservations)?options.reservations:[options.reservations])].filter(Boolean)){
      const l=unbox(source),r=l.reservations||{};
      if(Array.isArray(r)){for(const p of r){if(![p.x,p.z].every(Number.isFinite))continue;if(Number.isFinite(p.radius))context.reservations.circles.push({x:p.x,z:p.z,r:p.radius,source:'round6'});else if([p.hw,p.hd].every(Number.isFinite))context.reservations.boxes.push({...p});}}
      else for(const k of ['circles','boxes','corridors'])context.reservations[k].push(...(r[k]||[]).filter(p=>p.source!=='pond').map(p=>({...p})));
      for(const b of source.blockers||[])if([b.x,b.z,b.hw,b.hd].every(Number.isFinite))context.reservations.boxes.push({...b});
      for(const p of l.clusters||[])context.reservations.circles.push({x:p.x,z:p.z,r:p.radius,source:'habitat-cluster'});
    }
  }
  const material=(key,submerged=false,transparent=false)=>{if(!materials.has(key)){const m=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:transparent,opacity:transparent?.62:1,depthWrite:!transparent});owned.add(m);materials.set(key,m);}return materials.get(key);};
  const meshSphere=pond?new THREE.Sphere(new THREE.Vector3(pond.x,pond.waterY+.3,pond.z),(pond.radius||9)+3.5):null;
  function mesh(name,geometry,key='solid',submerged=false,instances=0){owned.add(geometry);const m=instances?new THREE.InstancedMesh(geometry,material(key,submerged,key==='ripples'),instances):new THREE.Mesh(geometry,material(key,submerged,key==='ripples'));m.name='pond-life-'+name;m.userData.submerged=submerged;m.renderOrder=key==='ripples'?5:0;if(instances){m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);if(meshSphere){m.boundingSphere=meshSphere;m.frustumCulled=true;}else m.frustumCulled=false;}group.add(m);return m;}
  const surface=new PondGeometry(),underwater=new PondGeometry(),shore=new PondGeometry();
  const floor=(x,z)=>habitatSurface(field,x,z);
  function inRim(x,z){const r=village.pond.rim;let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=i*TAU/r.length,b=j*TAU/r.length,ax=pond.x+Math.cos(a)*r[i],az=pond.z+Math.sin(a)*r[i],bx=pond.x+Math.cos(b)*r[j],bz=pond.z+Math.sin(b)*r[j];if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;}return inside;}
  function wet(x,z,r,depth=.04){for(let ix=-2;ix<=2;ix++)for(let iz=-2;iz<=2;iz++){if(ix*ix+iz*iz>4)continue;const px=x+ix*r/2,pz=z+iz*r/2;if(!inRim(px,pz)||!Number.isFinite(floor(px,pz))||floor(px,pz)>=pond.waterY-depth)return false;}for(let i=0;i<24;i++){const a=i*TAU/24,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;if(!inRim(px,pz)||floor(px,pz)>=pond.waterY-depth)return false;}return true;}
  function clear(x,z,r){const reservations=context.reservations;for(const c of reservations.circles)if(Math.hypot(x-c.x,z-c.z)<r+c.r+.15)return false;for(const b of reservations.boxes)if(boxDistance(x,z,b)<r+.15)return false;for(const c of reservations.corridors)for(let j=1;j<c.points.length;j++)if(segmentDistance(x,z,c.points[j-1],c.points[j])<r+c.half+.15)return false;const t=world.terrain,meander=Math.sin(z*.017)*2.4+Math.sin(x*.013+1.7)*1.6;if(t.pathOffset&&Math.abs(options.distanceToRiver(x,z)-t.pathOffset-meander)<t.pathWidth+r+.6)return false;return true;}
  function dry(x,z,r){if(!clear(x,z,r))return false;for(let ix=-3;ix<=3;ix++)for(let iz=-3;iz<=3;iz++){if(ix*ix+iz*iz>9)continue;const px=x+ix*r/3,pz=z+iz*r/3,y=floor(px,pz);if(!Number.isFinite(y)||Math.min(y,field.sample(px,pz))<pond.waterY+.025||field.slope(px,pz)>.58)return false;}return true;}
  function record(target,x,y,z,radius,wetPlacement,batch){const p={target,x,y,z,radius,wet:wetPlacement,mesh:'pond-life-'+batch};layout.placements.push(p);return p;}
  function target(id,x,y,z,resolve){if(targets.some(t=>t.id===id))return;const t={id,x,y,z,range:5.5};if(resolve)t.resolve=resolve;targets.push(t);}
  function pickWet(radius,depth,min=.48,max=.82){for(let i=0;i<180;i++){const a=rand()*TAU,r=Math.min(...village.pond.rim)*(min+rand()*(max-min)),x=pond.x+Math.cos(a)*r,z=pond.z+Math.sin(a)*r;if(wet(x,z,radius,depth))return {x,z};}return null;}
  let fishMesh,tailMesh,shrimpMesh,flyMesh,wingMesh,rippleMesh;
  if(complete&&world.pondLife?.enabled!==false){
    // Three asymmetric plant islands, never a carpet over the pond centre.
    const rimMin=Math.min(...village.pond.rim);
    for(let i=0;i<12;i++){
      const a=[.45,2.25,4.15][i%3]+(Math.floor(i/3)-1.5)*.12,r=rimMin*(.64+(i%2)*.09),x=pond.x+Math.cos(a)*r,z=pond.z+Math.sin(a)*r,lr=.40+(i%4)*.085;
      if(!wet(x,z,lr*1.06,.12))continue;
      surface.leaf(x,pond.waterY+.028,z,lr,a+.4,i%2?'#638B56':'#75965C');underwater.rod([x,floor(x,z)+.03,z],[x,pond.waterY+.02,z],.022,'#6E8254',5,.016);
      record('lotus',x,pond.waterY+.07,z,lr*1.06,true,'surface');target('lotus',x,pond.waterY+.28,z);counts.lotusLeaves++;surfaceArea+=Math.PI*lr*lr;
      if(i%3===0){const fx=x+.10,fz=z-.08,fy=pond.waterY+.48;surface.rod([fx,pond.waterY+.01,fz],[fx,fy,fz],.022,'#7E9465',5,.014);
        for(let layer=0;layer<3;layer++)for(let j=0;j<8;j++)surface.petal([fx,fy+layer*.045,fz],j*TAU/8+layer*.38,.34-layer*.07,.105-layer*.018,.09+layer*.075,layer===0?'#D997A7':layer===1?'#E9B5BC':'#F1D0C7');
        surface.ellipsoid(fx,fy+.10,fz,.085,.05,.085,'#C8B46C',8,3);counts.flowers++;
      }
    }
    for(let cluster=0;cluster<4;cluster++){
      const p=pickWet(.64,.1,.64,.86);if(!p)continue;
      for(let j=0;j<17;j++){const a=rand()*TAU,r=Math.sqrt(rand())*.49,x=p.x+Math.cos(a)*r,z=p.z+Math.sin(a)*r,lr=.035+rand()*.04;for(let k=0;k<6;k++){const t=k*TAU/6,q=(k+1)*TAU/6;surface.tri([x,pond.waterY+.020,z],[x+Math.cos(q)*lr,pond.waterY+.021,z+Math.sin(q)*lr],[x+Math.cos(t)*lr,pond.waterY+.021,z+Math.sin(t)*lr],j%3?'#8CA661':'#B0BC75');}counts.duckweed++;surfaceArea+=Math.PI*lr*lr;}
      record('duckweed',p.x,pond.waterY+.03,p.z,.64,true,'surface');target('duckweed',p.x,pond.waterY+.03,p.z);
    }
    for(let i=0;i<9;i++){
      const p=pickWet(.55,.45,.50,.81);if(!p)continue;const y=floor(p.x,p.z)+.04,h=Math.min(.62,pond.waterY-y-.14);
      if(h<.18)continue;
      for(let j=0;j<5;j++){const a=j*TAU/5+i,l=h*(.7+j*.065),dx=Math.cos(a),dz=Math.sin(a);const base=[p.x,y,p.z],m=[p.x+dx*.13,y+l*.62,p.z+dz*.13],tip=[p.x+dx*.28,y+l,p.z+dz*.28];underwater.quad([base[0]-dz*.025,y,base[2]+dx*.025],[base[0]+dz*.025,y,base[2]-dx*.025],[m[0]+dz*.018,m[1],m[2]-dx*.018],[m[0]-dz*.018,m[1],m[2]+dx*.018],j%2?'#708F6C':'#89A17C');underwater.tri([m[0]-dz*.018,m[1],m[2]+dx*.018],[m[0]+dz*.018,m[1],m[2]-dx*.018],tip,'#9AAA85');}counts.watergrass++;record('pond-watergrass',p.x,y+.2,p.z,.55,true,'underwater');target('pond-watergrass',p.x,y+.2,p.z);
      if(i<4){for(let k=0;k<3;k++){const x=p.x-.35+k*.24,z=p.z+.18,yy=floor(x,z)+.03;underwater.rod([x,yy,z],[x+.21,floor(x+.21,z)+.03,z],.072,'#B4A77C',7,.065);underwater.ellipsoid(x+.20,yy,z,.08,.085,.085,'#938B63',7,3);underwater.rod([x+.16,yy-.02,z],[x+.19,floor(x+.19,z+.14)-.01,z+.14],.013,'#948B63',3,.003);}counts.rhizomes++;record('lotus-rhizome',p.x,y+.04,p.z+.18,.55,true,'underwater');target('lotus-rhizome',p.x,y+.04,p.z+.18);}
      for(let j=0;j<1+(i%2);j++){const x=p.x+.22+j*.18,z=p.z-.22,yy=floor(x,z)+.055;for(const s of [-1,1])underwater.ellipsoid(x+s*.021,yy,z,.065,.055,.17,s<0?'#6E7462':'#92977C',8,3);underwater.rod([x,yy+.055,z-.14],[x,yy+.055,z+.14],.008,'#465D50',3);counts.mussels++;record('freshwater-mussel',x,yy,z,.19,true,'underwater');target('freshwater-mussel',x,yy,z);}
    }
    // Dry, near-rim bluestone with an outward actor disk, found from real shores.
    let laundry;
    for(let j=0;j<132&&!laundry;j++){
      const a=.30+j*TAU/132,ux=Math.cos(a),uz=Math.sin(a);let lo=1,hi=pond.radius*1.3;for(let k=0;k<24;k++){const mid=(lo+hi)/2;if(floor(pond.x+ux*mid,pond.z+uz*mid)<pond.waterY)lo=mid;else hi=mid;}
      for(const offset of [1.0,1.35,1.7,2.05]){const x=pond.x+ux*(hi+offset),z=pond.z+uz*(hi+offset),sx=x+ux*1.05,sz=z+uz*1.05,bx=x-uz*.96,bz=z+ux*.96;if(dry(x,z,.72)&&dry(sx,sz,.56)&&dry(bx,bz,.43)){laundry={x,z,sx,sz,bx,bz,ux,uz,y:floor(x,z)};break;}}
    }
    if(laundry){const p=laundry,sy=floor(p.sx,p.sz),top=Math.max(p.y+.32,sy+.45);
      // The outward foot disk is uphill: raise the slab to the actor's knee,
      // sculpted as a 2-tier chamfered bluestone washing terrace while keeping the work surface flat at top+.025.
      const chamferTier=(cx,y0,y1,cz,w,d,ch,topCol,sideCol,taper=0.05)=>{
        const hx=w/2,hz=d/2,c=Math.min(ch,hx*.35,hz*.35);
        const mk=(y,s,cs)=>[[hx*s-c*cs,y,hz*s],[hx*s,y,hz*s-c*cs],[hx*s,y,-hz*s+c*cs],[hx*s-c*cs,y,-hz*s],[-hx*s+c*cs,y,-hz*s],[-hx*s,y,-hz*s+c*cs],[-hx*s,y,hz*s-c*cs],[-hx*s+c*cs,y,hz*s]].map(([dx,yy,dz])=>[cx+dx,yy,cz+dz]);
        const b=mk(y0,1+taper,.9),m=mk(y0+(y1-y0)*.82,1,1),t=mk(y1,1-taper*.4,1.08),tc=[cx,y1,cz];
        for(let i=0;i<8;i++){const j=(i+1)%8;shore.quad(b[i],b[j],m[j],m[i],sideCol);shore.quad(m[i],m[j],t[j],t[i],topCol);shore.tri(tc,t[i],t[j],topCol);}
      };
      const midY=Math.max(p.y+.06,top-.16);
      chamferTier(p.x,p.y-.11,midY,p.z,1.32,.96,.14,'#7E908B','#6D817E',.07);
      chamferTier(p.x,midY-.02,top+.025,p.z,1.18,.85,.08,'#9CAAA1','#839590',.025);
      // Subtle pond-side stepping flagstone bridging the bank to the washing terrace.
      chamferTier(p.x-p.ux*.58,p.y-.10,Math.max(p.y+.05,midY-.08),p.z-p.uz*.58,.54,.44,.09,'#86968F','#72847F',.08);
      // Subtle parallel worn channels on the stone, not a generic box.
      for(let k=0;k<7;k++)shore.rod([p.x-.46+k*.15,top+.027,p.z-.30],[p.x-.46+k*.15,top+.027,p.z+.30],.008,'#647F7C',3);
      const by=floor(p.bx,p.bz);shore.vessel(p.bx,by+.02,p.bz,[[0,0],[.24,0],[.37,.16],[.40,.40],[.35,.43],[.30,.36],[.28,.09],[0,.09]],'#A68B60',12);
      for(let k=0;k<4;k++)shore.vessel(p.bx,by+.02,p.bz,[[.245+k*.034,.10+k*.075],[.253+k*.034,.117+k*.075]],'#6E674D',12);
      const clothBuilder=new PondGeometry();for(let ix=0;ix<10;ix++)for(let iz=0;iz<6;iz++){const at=(i,j)=>{const z=-.29+j*.12,y=.018+Math.sin(i*1.6)*.024+(j===6?-.16:0);return [-.44+i*.088,y,z];};clothBuilder.quad(at(ix,iz),at(ix+1,iz),at(ix+1,iz+1),at(ix,iz+1),iz>3?'#9CAFA5':'#D2CABB');}
      const cloth=mesh('wet-linen',clothBuilder.geometry(),'linen');cloth.position.set(p.x,top+.038,p.z);cloth.userData.dynamic=true;
      const batBuilder=new PondGeometry();batBuilder.box(0,0,-.24,.15,.055,.45,'#AB895B');batBuilder.rod([0,.025,-.035],[0,.025,.25],.028,'#C1A276',7,.023);const bat=mesh('wash-bat',batBuilder.geometry(),'bat');bat.position.set(p.x+.22,top+.06,p.z-.10);bat.rotation.y=.6;bat.userData.dynamic=true;
      const yaw=Math.atan2(-p.ux,-p.uz),delta={x:p.x-p.sx,y:top+.07-sy,z:p.z-p.sz},c=Math.cos(yaw),s=Math.sin(yaw);
      bat.userData.communityRole='bat';bat.userData.communityContact={x:delta.x*c-delta.z*s,y:delta.y,z:delta.x*s+delta.z*c};
      bat.userData.wash={cloth,workSurface:{x:p.x,y:top+.07,z:p.z},gripLocal:{x:0,y:.025,z:.21},strikeLocal:{x:0,y:0,z:-.22},rest:{position:bat.position.toArray(),rotation:bat.rotation.toArray()},clothRest:{position:cloth.position.toArray(),rotation:cloth.rotation.toArray()}};
      stations.push({kind:'wash',x:p.sx,y:sy,z:p.sz,yaw,prop:bat});
      blockers.push({x:p.x,z:p.z,hw:.59,hd:.425,rot:0,minY:p.y-.09,maxY:top+.034,source:'pond-laundry-stone'},{x:p.bx,z:p.bz,hw:.4,hd:.4,rot:0,minY:by+.02,maxY:by+.45,source:'pond-laundry-basket'});
      layout.reservations.push({x:p.x,z:p.z,radius:1.9});
      counts.laundry=1;record('laundry-stone',p.x,top,p.z,.74,false,'shore');target('laundry-stone',p.x-.46,top+.036,p.z+.20);
      layout.camera={eye:{x:p.sx+1.8,y:sy+2.1,z:p.sz+1.8},target:{x:pond.x,y:pond.waterY+.15,z:pond.z}};
    }
    // Real hollow harvest tub: slatted cavity, hoops, tied rope and small paddle.
    for(let j=0;j<80;j++){
      const a=2.7+j*TAU/80,r=rimMin*.82,x=pond.x+Math.cos(a)*r,z=pond.z+Math.sin(a)*r;
      if(!wet(x,z,.84,.45))continue;const y=pond.waterY-.18,ux=Math.cos(a),uz=Math.sin(a);
      let mooring;for(let k=0;k<55;k++){const endR=r+.6+k*.18,ex=pond.x+ux*endR,ez=pond.z+uz*endR;if(dry(ex,ez,.10)){mooring={x:ex,z:ez};break;}}
      if(!mooring)continue;
      shore.vessel(x,y,z,[[0,0],[.50,0],[.66,.17],[.77,.53],[.70,.59],[.62,.52],[.54,.12],[0,.12]],'#92734F',20);
      for(const h of [.15,.43])shore.vessel(x,y,z,[[.64+h*.24,h],[.66+h*.24,h+.035]],'#535C49',20);
      shore.box(x,y+.25,z,.91,.07,.17,'#B39A6E');shore.rod([x-.38,y+.30,z-.22],[x+.42,y+.65,z+.39],.028,'#B8A06D',6);shore.box(x+.39,y+.56,z+.36,.17,.06,.32,'#B8A06D');
      const ex=mooring.x,ez=mooring.z;{ shore.rod([x+ux*.65,y+.54,z+uz*.65],[(x+ex)/2,pond.waterY+.10,(z+ez)/2],.015,'#BDA67A',4);shore.rod([(x+ex)/2,pond.waterY+.10,(z+ez)/2],[ex,floor(ex,ez)+.17,ez],.015,'#BDA67A',4);shore.rod([ex,floor(ex,ez)-.04,ez],[ex,floor(ex,ez)+.34,ez],.045,'#827151',6);blockers.push({x:ex,z:ez,hw:.08,hd:.08,rot:0,minY:floor(ex,ez)-.04,maxY:floor(ex,ez)+.34,source:'pond-mooring-peg'});}
      counts.tubs=1;record('harvest-tub',x,y+.4,z,.84,true,'shore');target('harvest-tub',x,y+.4,z);surfaceArea+=Math.PI*.77*.77;break;
    }
    if(surface.positions.length)mesh('surface',surface.geometry(),'surface');if(underwater.positions.length)mesh('underwater',underwater.geometry(),'submerged',true);if(shore.positions.length)mesh('shore',shore.geometry());
    for(let i=0;i<4;i++){const p=pickWet(1.35,.85,i===0?.68:.20,i===0?.75:.63);if(!p)continue;anim.fish.push({...p,r:.37+i*.045,phase:i*1.61,size:.76+i*.07,y:Math.min(pond.waterY-.35,Math.max(floor(p.x,p.z)+.38,pond.waterY-.62))});record('carp',p.x,pond.waterY-.4,p.z,1.35,true,'carp');}
    if(anim.fish.length){fishMesh=mesh('carp',carpGeometry(),'submerged',true,anim.fish.length);tailMesh=mesh('carp-tails',carpGeometry(true),'submerged',true,anim.fish.length);counts.carp=anim.fish.length;target('carp',anim.fish[0].x,anim.fish[0].y,anim.fish[0].z,()=>({...anim.fish[0].current}));}
    for(let i=0;i<4;i++){const p=pickWet(.55,.35,.56,.82);if(!p)continue;anim.shrimp.push({...p,phase:i*1.9,size:1+i*.06});record('shrimp',p.x,floor(p.x,p.z)+.12,p.z,.55,true,'shrimp');}
    if(anim.shrimp.length){shrimpMesh=mesh('shrimp',shrimpGeometry(),'submerged',true,anim.shrimp.length);counts.shrimp=anim.shrimp.length;target('shrimp',anim.shrimp[0].x,floor(anim.shrimp[0].x,anim.shrimp[0].z)+.1,anim.shrimp[0].z,()=>({...anim.shrimp[0].current}));}
    for(let i=0;i<3;i++){const p=pickWet(1.20,.2,.36,.72);if(!p)continue;anim.flies.push({...p,phase:i*2.1,lastCycle:-1,rippleAge:10,touch:{x:p.x,y:pond.waterY+.014,z:p.z}});record('dragonfly',p.x,pond.waterY+.5,p.z,1.20,true,'dragonflies');}
    if(anim.flies.length){flyMesh=mesh('dragonflies',dragonflyGeometry(),'insects',false,anim.flies.length);wingMesh=mesh('dragonfly-wings',dragonflyGeometry(true),'insects',false,anim.flies.length);rippleMesh=mesh('touch-ripples',rippleGeometry(),'ripples',false,anim.flies.length);counts.dragonflies=anim.flies.length;target('dragonfly',anim.flies[0].x,pond.waterY+.45,anim.flies[0].z,()=>({...anim.flies[0].current}));}
  }
  const transform=new THREE.Object3D(),matrix=new THREE.Matrix4(),tail=new THREE.Object3D();
  let flyActivity=1,swimTime=0;
  function pose(mesh,i,x,y,z,yaw,scale=1,roll=0){transform.position.set(x,y,z);transform.rotation.set(0,yaw,roll);transform.scale.setScalar(scale);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);return transform.matrix;}
  function animate(step,skyValues){
    const night=skyValues?.nightAmount??skyValues?.night??(skyValues?.day===0?1:0);
    const rain=skyValues?.rain??0;
    if(step>0){
      const target=night>=.55||rain>=.35?0:1;flyActivity+=(target-flyActivity)*Math.min(1,step*2.5);
      swimTime+=step*(night>=.55?.34:1);
    }
    for(const [i,f] of anim.fish.entries()){const a=f.phase+swimTime*.32,x=f.x+Math.cos(a)*f.r,z=f.z+Math.sin(a)*f.r,y=f.y+Math.sin(swimTime*1.3+f.phase)*.025,yaw=-a;f.current={x,y,z};const m=pose(fishMesh,i,x,y,z,yaw,f.size);tail.position.set(0,0,-.48);tail.rotation.set(0,Math.sin(swimTime*5+f.phase)*(night>=.55?.16:.32),0);tail.scale.setScalar(1);tail.updateMatrix();matrix.multiplyMatrices(m,tail.matrix);tailMesh.setMatrixAt(i,matrix);}
    for(const [i,f] of anim.shrimp.entries()){const a=swimTime*.55+f.phase,x=f.x+Math.cos(a)*.10,z=f.z+Math.sin(a)*.10,y=floor(x,z)+.095+Math.max(0,Math.sin(swimTime*1.5+f.phase))*(night>=.55?.014:.035);f.current={x,y,z};pose(shrimpMesh,i,x,y,z,-a,f.size);}
    for(const [i,f] of anim.flies.entries()){const active=flyActivity>.02,t=time+f.phase,cycle=Math.floor(t/7),phase=t%7,approach=phase<=4?Math.max(0,1-(4-phase)/1.1):Math.max(0,1-Math.max(0,phase-4.15)/1.1),x=f.x+Math.cos(t*.8)*.34*flyActivity,z=f.z+Math.sin(t*.8)*.26*flyActivity,y=pond.waterY+.08+(0.10+.60*(1-approach))*flyActivity,yaw=.5+Math.sin(t*.5)*.6,flyScale=flyActivity<=.02?0:flyActivity;f.current={x,y,z};pose(flyMesh,i,x,y,z,yaw,flyScale);pose(wingMesh,i,x,y+.012*flyScale,z,yaw,flyScale,active?Math.sin(time*83+i)*.42:0);
      f.rippleAge+=step;
      // Abdomen tip is authored at local (0,-.18,-.40). Spawn only at
      // the downstroke crossing, at its actual world contact, never at the body.
      if(active&&step>0&&phase>=4&&phase<=4.15&&f.lastCycle!==cycle){f.lastCycle=cycle;f.rippleAge=0;f.touch={x:x-Math.sin(yaw)*.40,y:pond.waterY+.014,z:z-Math.cos(yaw)*.40};touches++;}
      if(f.rippleAge<1.6&&active){const radius=.07+f.rippleAge*.40;pose(rippleMesh,i,f.touch.x,f.touch.y,f.touch.z,0,radius);}else pose(rippleMesh,i,f.x,pond.waterY+.014,f.z,0,0);
    }
    for(const m of [fishMesh,tailMesh,shrimpMesh,flyMesh,wingMesh,rippleMesh])if(m)m.instanceMatrix.needsUpdate=true;
  }
  if(complete)animate(0);
  for(const p of layout.placements)if(p.wet)layout.reservations.push({x:p.x,z:p.z,radius:p.radius});
  for(const b of blockers)layout.reservations.push({...b});
  let triangles=0,drawCalls=0;group.traverse(o=>{if(o.isMesh){drawCalls++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);}});
  const polygonArea=complete?village.pond.rim.reduce((sum,r,i)=>sum+r*village.pond.rim[(i+1)%village.pond.rim.length]*Math.sin(TAU/village.pond.rim.length)/2,0):1;
  return {group,blockers,targets,stations,layout,
    update(dt,elapsed,sky){if(disposed||!Number.isFinite(dt)||dt<=0)return;const step=Math.min(dt,.05);time+=step;animate(step,sky?.getAppearance?.()||sky);},
    getStats:()=>({counts:{...counts},triangles,drawCalls,surfaceCoverage:surfaceArea/polygonArea,time,touches,disposed,degraded:!complete,limits:{triangles:9000,drawCalls:14}}),
    dispose(){if(disposed)return;disposed=true;for(const resource of owned)resource.dispose();group.removeFromParent();}
  };
}
