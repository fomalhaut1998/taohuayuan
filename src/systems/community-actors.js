import * as THREE from 'three';
import { makePeopleParts } from '../character-parts.js';

// One opaque draw per shape, shared across EVERY actor/tool, not one mesh per limb.
// Matrices form a lightweight CPU rig. Geometry and instance tint both provide real colors.
const UP = new THREE.Vector3(0,1,0);
const CLOTH_PALETTES = [0xc8b48c,0x9fae8e,0xb98e6c,0x8e9aa8,0xc4a25e,0xa8836a];
const FEMALE_PALETTES = [0xd4b6aa,0xb8c4ae,0xcab896,0x9fb0b8,0xd1a999,0xb7a58e];
const PEOPLE_PALETTE = {
  skin: '#E2BE9B', hair: '#2B2420', elderHair: '#AAA99A', hat: '#C9B27E',
  mouth: '#936F5E', eye: '#3B322B', lip: '#B08472', earShade: '#C89B79',
  collar: '#DED4B9', trim: '#D7C7A4', sash: '#7C6750', cuff: '#C9BEA5',
  trousers: '#575C51', shoe: '#3F3C32', hatBand: '#796143', basket: '#B29363', jade: '#93AA93'
};
export function createCommunityActors(group, capacity) {
  const material = new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true});
  const parts = makePeopleParts(PEOPLE_PALETTE);
  const geometry = {
    box:new THREE.BoxGeometry(1,1,1),
    round:new THREE.SphereGeometry(1,5,3),
    taper:new THREE.CylinderGeometry(.74,1,1,6,1,true),
    cone:new THREE.ConeGeometry(1,1,6,1),
    fan:new THREE.CircleGeometry(1,9,0,Math.PI*1.08),
    robe:parts.robe,
    trim:parts.trim,
    head:parts.head,
    femaleHead:parts.femaleHead,
    elderHead:parts.elderHead,
    childHead:parts.childHead,
    hat:parts.hat,
    shoe:parts.shoe,
  };
  parts.sleeve.dispose();parts.cuff.dispose();parts.hand.dispose();parts.leg.dispose();parts.basket.dispose();parts.stool.dispose();
  // A fan is thin opaque double-sided paper. Other parts keep back-face culling.
  const fanMaterial=material.clone();fanMaterial.side=THREE.DoubleSide;
  const batches={};const count={};
  const bMinX={};const bMinY={};const bMinZ={};const bMaxX={};const bMaxY={};const bMaxZ={};const bMaxS={};
  for(const [key,g] of Object.entries(geometry)){
    if(!g.attributes.color)g.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*3).fill(1),3));
    const perActor=key==='box'||key==='taper'||key==='round'?32:(key==='cone'||key==='fan'?8:3);
    const maxCount=Math.max(1,capacity*perActor);
    const mesh=new THREE.InstancedMesh(g,key==='fan'?fanMaterial:material,maxCount);
    mesh.name='community-life-'+key;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=true;mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(),4);mesh.count=0;mesh.visible=false;group.add(mesh);batches[key]=mesh;count[key]=0;
    bMinX[key]=Infinity;bMinY[key]=Infinity;bMinZ[key]=Infinity;bMaxX[key]=-Infinity;bMaxY[key]=-Infinity;bMaxZ[key]=-Infinity;bMaxS[key]=1;
  }
  const root=new THREE.Matrix4(),m=new THREE.Matrix4(),q=new THREE.Quaternion(),pos=new THREE.Vector3(),sc=new THREE.Vector3(),color=new THREE.Color();
  const euler=new THREE.Euler(),va=new THREE.Vector3(),vb=new THREE.Vector3(),vd=new THREE.Vector3();
  let origin=[0,0,0],yaw=0,size=1;
  function begin(){
    for(const k in count){
      count[k]=0;
      bMinX[k]=Infinity;bMinY[k]=Infinity;bMinZ[k]=Infinity;
      bMaxX[k]=-Infinity;bMaxY[k]=-Infinity;bMaxZ[k]=-Infinity;bMaxS[k]=1;
    }
  }
  function touchBatch(key){
    const ox=origin[0],oy=origin[1],oz=origin[2];
    if(ox<bMinX[key])bMinX[key]=ox;if(ox>bMaxX[key])bMaxX[key]=ox;
    if(oy<bMinY[key])bMinY[key]=oy;if(oy>bMaxY[key])bMaxY[key]=oy;
    if(oz<bMinZ[key])bMinZ[key]=oz;if(oz>bMaxZ[key])bMaxZ[key]=oz;
    if(size>bMaxS[key])bMaxS[key]=size;
  }
  function actor(x,y,z,rotation,scale){
    origin=[x,y,z];yaw=rotation;size=scale;
    root.compose(pos.set(x,y,z),q.setFromAxisAngle(UP,rotation),sc.setScalar(scale));
  }
  function part(key,p,s,tint,rotation=null){
    const i=count[key]++,mesh=batches[key];
    if(i>=mesh.instanceMatrix.count)throw new Error('community rig capacity exceeded');
    touchBatch(key);
    pos.set(p[0],p[1],p[2]);sc.set(s[0],s[1],s[2]);
    if(rotation)q.setFromEuler(euler.set(rotation[0],rotation[1],rotation[2]));
    else q.identity();
    m.compose(pos,q,sc).premultiply(root);mesh.setMatrixAt(i,m);mesh.setColorAt(i,color.setHex(tint));
  }
  function segment(key,a,b,width,depth,tint){
    touchBatch(key);
    va.set(a[0],a[1],a[2]);vb.set(b[0],b[1],b[2]);vd.subVectors(vb,va);
    const len=vd.length();
    pos.addVectors(va,vb).multiplyScalar(.5);sc.set(width,len,depth);
    if(len>1e-9)q.setFromUnitVectors(UP,vd.multiplyScalar(1/len));else q.identity();
    m.compose(pos,q,sc).premultiply(root);const mesh=batches[key],i=count[key]++;mesh.setMatrixAt(i,m);mesh.setColorAt(i,color.setHex(tint));
  }
  function world(p){const c=Math.cos(yaw),s=Math.sin(yaw);return {x:origin[0]+size*(p[0]*c+p[2]*s),y:origin[1]+size*p[1],z:origin[2]+size*(-p[0]*s+p[2]*c)};}
  function human(a,p){
    const isFemale=!!(a.female||a.voiceRole==='woman'||a.kind==='wash'||a.role==='weaver'||a.role==='feast_guest'||a.id?.includes('feaster-2'));
    const cloth=isFemale?FEMALE_PALETTES[a.index%FEMALE_PALETTES.length]:CLOTH_PALETTES[a.index%CLOTH_PALETTES.length];
    const trim=isFemale?0xe5dac2:0xd6c7a4,pants=isFemale?0x5c574e:0x414e55,skin=0xe2be9b;
    const lower=p.crouch||0,lean=p.lean||0,hip=.77-lower*.32,shoulder=1.34-lower*.38;
    // Sculpted crossed-collar robe and sash from unified character parts.
    const torsoH=(shoulder-hip)/.57,torsoY=shoulder-.24*torsoH,bodyW=isFemale?.91:.96;
    part('robe',[0,torsoY,lean*.38],[bodyW,torsoH,.96],cloth,[.06+lean*.28,0,0]);
    part('trim',[0,torsoY,lean*.38],[bodyW,torsoH,.96],0xffffff,[.06+lean*.28,0,0]);
    // Smooth two-link legs with proportional Qin-Han trousers and sculpted shoes (翘头麻底履).
    const walkVal=p.walk||0;
    for(const side of [-1,1]){
      const stepPhase=walkVal*side;
      const stepLift=Math.max(0,stepPhase)*0.042+Math.abs(stepPhase)*0.008;
      const footZ=.06+stepPhase*.17+lower*.10;
      const shoeY=.015+stepLift;
      const shoePitch=Math.max(-.18,Math.min(.18,-stepPhase*.22));
      const ankleY=shoeY+.052*Math.cos(shoePitch);
      const ankleZ=footZ-.052*Math.sin(shoePitch);
      const knee=[side*.126,.40-lower*.22+stepLift*.45,.04+lower*.26+stepPhase*.07];
      segment('taper',[side*.114,hip,0],knee,.068,.068,pants);
      part('round',knee,[.050,.050,.050],pants);
      segment('taper',knee,[side*.124,ankleY,ankleZ],.052,.052,pants);
      part('shoe',[side*.124,shoeY,footZ],[1.02,1.02,1.02],0xffffff,[shoePitch,0,0]);
    }
    const neck=[0,shoulder+.08,lean*.6];segment('taper',[0,shoulder-.02,lean*.55],neck,.048,.046,skin);
    const headKey=a.kind==='elder'?'elderHead':a.child?'childHead':isFemale?'femaleHead':'head';
    const headScale=a.child?1.12:a.kind==='elder'?1.03:isFemale?.98:1;
    const head=[p.headTurn*.02,shoulder+.24,lean*.6+.02];
    part(headKey,head,[headScale,headScale,headScale],0xffffff,[p.nod||0,p.headTurn||0,0]);
    // Two-link IK: shoulders nestled flush into robe slope, tapered Qin-Han sleeves & trim cuffs; wrists stay exact IK contact points.
    for(const side of [-1,1]){
      const hand=side<0?p.left:p.right,start=[side*(isFemale?.180:.194),shoulder-.066,lean*.44];
      const elbow=[start[0]+side*.046,(start[1]+hand[1])*.5-.082,(start[2]+hand[2])*.5-.072];
      part('round',start,[.064,.064,.062],cloth);
      segment('taper',start,elbow,.066,.064,cloth);
      part('round',elbow,[.049,.049,.049],cloth);
      segment('taper',hand,elbow,.068,.076,cloth);
      const cuff=[elbow[0]*.16+hand[0]*.84,elbow[1]*.16+hand[1]*.84,elbow[2]*.16+hand[2]*.84];
      segment('taper',hand,cuff,.070,.078,trim);
      part('round',hand,[.036,.048,.028],skin);
    }
    if(a.kind==='beekeeper'){
      // Sculpted straw sun bonnet plus opaque neck drape.
      part('hat',head,[headScale*1.04,headScale*1.04,headScale*1.04],0xffffff,[p.nod||0,p.headTurn||0,0]);
      part('box',[-.18,head[1]-.11,head[2]-.02],[.035,.24,.18],0xbcaf83);part('box',[.18,head[1]-.11,head[2]-.02],[.035,.24,.18],0xbcaf83);
    }
    return {left:world(p.left),right:world(p.right)};
  }
  function finish(){
    for(const k in batches){
      const mesh=batches[k],n=count[k];
      mesh.count=n;mesh.visible=n>0;
      if(n>0){
        const scK=bMaxS[k];
        const cx=(bMinX[k]+bMaxX[k])*.5;
        const cy=(bMinY[k]+bMaxY[k])*.5+.8*scK;
        const cz=(bMinZ[k]+bMaxZ[k])*.5;
        const rad=Math.hypot(bMaxX[k]-bMinX[k],bMaxY[k]-bMinY[k],bMaxZ[k]-bMinZ[k])*.5+2.6*scK;
        mesh.boundingSphere.center.set(cx,cy,cz);mesh.boundingSphere.radius=rad;
        mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,n*16);mesh.instanceMatrix.needsUpdate=true;
        if(mesh.instanceColor){mesh.instanceColor.clearUpdateRanges();mesh.instanceColor.addUpdateRange(0,n*3);mesh.instanceColor.needsUpdate=true;}
      }
    }
  }
  function stats(){let triangles=0,instances=0,drawCalls=0;for(const k in batches){const b=batches[k];triangles+=(b.geometry.index?.count||b.geometry.attributes.position.count)/3*b.count;instances+=b.count;if(b.count)drawCalls++;}return {triangles,instances,drawCalls};}
  function dispose(){for(const g of Object.values(geometry))g.dispose();material.dispose();fanMaterial.dispose();group.clear();}
  return {begin,actor,part,segment,human,world,finish,stats,dispose};
}
