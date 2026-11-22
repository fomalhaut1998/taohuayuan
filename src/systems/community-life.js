import * as THREE from 'three';
import { createCommunityActors } from './community-actors.js';
import { sampleGroundSurface } from '../world/ground-surface.js';
import { livingStep, sightClear } from './living-behavior.js';

const KINDS=['wash','trap','elder','child-grass','child-stones','child-top','beekeeper','liubo'];
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const point=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
// Quiet time is part of each finite turn. No elapsed-wall-clock catch-up, RNG, timers or new audio graph.
const TURNS={
  wash:[['soak',4],['raise',2],['strike',1.6],['wring',5],['rest',14]],
  trap:[['approach',3],['lift',3],['check',4],['lower',3],['return',3],['rest',18]],
  elder:[['fan',7],['doze',13],['gesture',5],['listen',10]],
  'child-grass':[['reach',3],['tug',5],['inspect',4],['rest',13]],
  'child-stones':[['gather',3],['toss',2],['watch',3],['rest',14]],
  'child-top':[['set',3],['whip',2],['spin',10],['pick',3],['rest',16]],
  beekeeper:[['approach',3],['open',3],['cut',4],['deposit',3],['close',3],['return',3],['rest',21]],
  liubo:[['watch',7],['lean',2],['move',3],['consider',11],['rest',10]],
};
const EVENTS={wash:['strike',.78,'washImpact'],trap:['check',.45,'trapCheck'],elder:['gesture',.35,'elderGesture'],
  'child-grass':['tug',.65,'grassTug'],'child-stones':['watch',.48,'stoneLand'],'child-top':['whip',.62,'topWhip'],beekeeper:['cut',.64,'honeyCut'],liubo:['move',.66,'liuboMove']};

/** Additive scene actors only. Station x/y/z is a world-space FOOT anchor.
 * Positive yaw follows THREE +Y: local +Z points toward (sin(yaw), 0, cos(yaw)).
 * path points are WORLD coordinates, [x,z], [x,y,z], or {x,y?,z}; all movement is validated.
 * Optional station.prop is a detachable tool ONLY, never architecture; external resources stay owned by its factory.
 * prop.userData.communityContact is station-local {x,y,z}, in world metres (not child-scaled).
 * communityGrip.{left,right} optionally locates exact trap rim grips in prop geometry-local coordinates.
 * wash.{cloth,workSurface,gripLocal,strikeLocal} links the real cloth, WORLD surface and bat-local grip/blade.
 * All borrowed transforms are restored by dispose; borrowed geometry/material/parentage is never owned here.
 */
export function createCommunityLife({world={},field,stations=[],sound,blockers=[],actorRig=null}={}) {
  const group=new THREE.Group();group.name='community-life';
  const actors=[],rejected=[];let pathsRejected=0,clock=0,disposed=false;
  const kinds=Object.fromEntries(KINDS.map(k=>[k,0])),completed={...kinds};
  const events=Object.fromEntries(Object.values(EVENTS).map(e=>[e[2],0]));
  const water=world.terrain?.waterLevel,pond=world.terrain?.pond;
  function wetAt(x,z){const p=pond&&Number.isFinite(pond.waterY)&&Math.hypot(x-pond.x,z-pond.z)<(pond.radius??pond.waterRadius??0)+.3?pond.waterY:-Infinity;return field.sample(x,z)<Math.max(Number.isFinite(water)?water:-Infinity,p)+.025;}
  function floor(x,z){return field?.sample?sampleGroundSurface(field,x,z):NaN;}
  function safe(x,z){
    if(![x,z].every(Number.isFinite)||Math.abs(x)>((field?.half??Infinity)-.3)||Math.abs(z)>((field?.half??Infinity)-.3))return false;
    const y=floor(x,z);if(!Number.isFinite(y)||wetAt(x,z)||(field.slope?.(x,z)??0)>.85)return false;
    if(!sightClear(x,z,x,z,blockers,.20))return false;
    for(const [dx,dz] of [[.18,0],[-.18,0],[0,.18],[0,-.18]])if(wetAt(x+dx,z+dz)||!Number.isFinite(floor(x+dx,z+dz))||Math.abs(floor(x+dx,z+dz)-y)>.27)return false;
    return true;
  }
  function safeLeg(a,b){
    const d=Math.hypot(a.x-b.x,a.z-b.z);if(!Number.isFinite(d)||d>8||!sightClear(a.x,a.z,b.x,b.z,blockers,.20))return false;
    let last=floor(a.x,a.z);for(let j=0,n=Math.max(1,Math.ceil(d/.12));j<=n;j++){
      const x=mix(a.x,b.x,j/n),z=mix(a.z,b.z,j/n),y=floor(x,z);
      if(!safe(x,z)||Math.abs(y-last)>.18)return false;last=y;
    }return true;
  }
  const usedProps=new Set();
  for(const [index,s] of stations.entries()){
    if(!s||!KINDS.includes(s.kind)||![s.x,s.y,s.z,s.yaw].every(Number.isFinite)||!safe(s.x,s.z)){
      rejected.push({index,kind:s?.kind??'invalid',reason:'invalid, wet, steep or blocked foot anchor'});continue;
    }
    // Source coordinates and arrays are never mutated. Contact platforms may lift a valid foot anchor modestly.
    const ground=floor(s.x,s.z);if(s.y<ground-.10||s.y>ground+.35){rejected.push({index,kind:s.kind,reason:'anchor does not meet rendered floor'});continue;}
    const station={x:s.x,y:Math.max(ground,s.y),z:s.z,yaw:s.yaw};
    let path=Array.isArray(s.path)?s.path.map(p=>Array.isArray(p)?{x:p[0],z:p.length>2?p[2]:p[1]}:{x:p?.x,z:p?.z}):[];
    if(path.length){
      if(Math.hypot(path.at(-1).x-s.x,path.at(-1).z-s.z)>.001)path.push({x:s.x,z:s.z});
      if(path.length>32||path.some(p=>!safe(p.x,p.z))||path.some((p,i)=>i&&!safeLeg(path[i-1],p))){pathsRejected++;path=[];}
    }
    path=path.map(p=>({...p,y:floor(p.x,p.z)}));
    if(path.length<2)path=[{x:station.x,y:station.y,z:station.z}];
    let length=0;const distances=[0];for(let j=1;j<path.length;j++){length+=Math.hypot(path[j].x-path[j-1].x,path[j].z-path[j-1].z);distances.push(length);}
    const prop=s.prop?.isObject3D&&!usedProps.has(s.prop)?s.prop:null;if(prop)usedProps.add(prop);
    const child=s.kind.startsWith('child-'),scale=child?.72:s.kind==='elder'?.94:1;
    const a={id:'community-'+s.kind+'-'+index,index,kind:s.kind,female:s.kind==='wash',station,prop,path,distances,length,child,scale,phaseIndex:0,time:0,delay:1.5+index*.83,turn:0,fired:false,
      rest:0,shelter:0,sheltered:false,greetT:0,greetMax:2.6,greetYaw:0,phase:'rest',root:{...path[0]},hands:{},target:null,topAngle:0,topSpeed:0,voiceAt:-100,
      saved:prop?{position:prop.position.clone(),quaternion:prop.quaternion.clone(),scale:prop.scale.clone()}:null,
      contact:s.prop?.userData?.communityContact,
      cloth:s.prop?.userData?.wash?.cloth??null,clothSaved:null};
    if(a.cloth?.isObject3D)a.clothSaved={position:a.cloth.position.clone(),quaternion:a.cloth.quaternion.clone(),scale:a.cloth.scale.clone()};
    a.turns=TURNS[s.kind].map(([name,duration])=>[name,['approach','return'].includes(name)?Math.max(duration,length/.45+1):duration]);
    if(length&&!a.turns.some(t=>t[0]==='approach')){a.turns.unshift(['approach',length/.45+1]);const rest=a.turns.findIndex(t=>t[0]==='rest');a.turns.splice(rest<0?a.turns.length:rest,0,['return',length/.45+1]);}
    actors.push(a);kinds[s.kind]++;
  }
  // Pair only authored stations: never invent a second unsafe placement. Facing grass players share one turn.
  const ROLE_MAP={wash:['washer','basket'],trap:['trapper','worker'],elder:['shrine_elder','elder'],'child-grass':['child_grass','child'],'child-stones':['child_stones','child'],'child-top':['child_top','child'],beekeeper:['beekeeper','worker']};
  for(const a of actors){
    const peers=actors.filter(b=>b!==a&&b.kind===a.kind&&Math.hypot(a.station.x-b.station.x,a.station.z-b.station.z)<3.3).sort((b,c)=>Math.hypot(a.station.x-b.station.x,a.station.z-b.station.z)-Math.hypot(a.station.x-c.station.x,a.station.z-c.station.z));
    if(a.kind==='child-grass'&&peers[0]){a.partner=peers[0];a.delay=1.5+Math.min(a.index,a.partner.index)*.83;}
    if(a.kind==='liubo'&&!a.prop&&peers.some(b=>b.prop))a.observer=true;
    const [role,voiceRole]=a.kind==='liubo'?[a.observer?'liubo_watcher':'liubo_player','talker']:(ROLE_MAP[a.kind]||['villager','villager']);
    a.role=role;a.voiceRole=voiceRole;
    a.interactable={id:a.id,key:'c_'+a.id,x:a.root.x,y:a.root.y,z:a.root.z,role:a.role,voiceRole:a.voiceRole,female:a.female,mode:a.kind==='liubo'?'sit':'work',s:a.scale};
  }
  const rig=actorRig?actorRig.createChannel(group,actors.length):createCommunityActors(group,actors.length);
  const trapPos=new THREE.Vector3(),trapMat=new THREE.Matrix4(),trapV=new THREE.Vector3();
  function at(a,t){
    if(!a.length||t>=1)return a.station;
    if(t<=0)return a.path[0];
    const distance=clamp(t)*a.length;
    for(let i=1;i<a.path.length;i++)if(distance<=a.distances[i]){const u=(distance-a.distances[i-1])/(a.distances[i]-a.distances[i-1]||1),p=a.path[i-1],q=a.path[i];const x=mix(p.x,q.x,u),z=mix(p.z,q.z,u);return {x,y:floor(x,z),z};}
    return a.station;
  }
  function workTarget(a){
    const c=a.contact;
    if(c&&[c.x,c.y,c.z].every(Number.isFinite))return [c.x/a.scale,c.y/a.scale,c.z/a.scale];
    // Scenery may publish an exact world-space surface instead of communityContact.
    const w=a.prop?.userData?.wash?.workSurface;
    if(w&&[w.x,w.y,w.z].every(Number.isFinite)){
      const dx=w.x-a.station.x,dz=w.z-a.station.z,ca=Math.cos(a.station.yaw),sa=Math.sin(a.station.yaw);
      return [(dx*ca-dz*sa)/a.scale,(w.y-a.station.y)/a.scale,(dx*sa+dz*ca)/a.scale];
    }
    return a.kind==='liubo'?[.10,.80,.62]:a.kind==='wash'?[.12,.53,.65]:[.13,.68,.62];
  }
  function pose(a){
    const phase=a.phase,[,duration]=a.turns[a.phaseIndex],u=clamp(a.time/duration),e=smooth(u),w=Math.sin(u*Math.PI),t=a.time;
    const p={left:[-.30,.88,.12],right:[.30,.88,.12],crouch:0,lean:0,headTurn:0,nod:0,walk:0,dozing:false};
    const target=workTarget(a);a.target=target;
    // A bat's work-surface point is the blade impact, NOT its handle/wrist.
    const washGrip=a.prop?.userData?.wash?.gripLocal,washStrike=a.prop?.userData?.wash?.strikeLocal;
    const wrist=a.kind==='wash'&&washGrip&&washStrike?[target[0]-(washGrip.x-washStrike.x),target[1]+washGrip.y-washStrike.y,target[2]-(washGrip.z-washStrike.z)]:target;
    let travel=1;
    if(phase==='approach')travel=e;
    if(phase==='return')travel=1-e;
    // Waiting and resting actors stay at the safe beginning of authored route.
    if(a.delay>0||phase==='rest')travel=0;
    const desired=at(a,travel);
    // Per-step root motion is handled in render to avoid any phase-boundary snap.
    if(a.kind==='wash'){
      if(!['rest'].includes(phase)){
        p.crouch=.83;p.lean=.35;p.left=[-.15,target[1]+.03,target[2]-.04];
        if(phase==='soak')p.right=[.16,target[1]-.08*w,target[2]+.1*w];
        if(phase==='raise')p.right=point(wrist,[wrist[0]+.08,1.38,wrist[2]-.10],e);
        if(phase==='strike')p.right=point([wrist[0]+.08,1.38,wrist[2]-.10],wrist,smooth(u/.78));
        if(phase==='wring'){p.left=[-.13,target[1]+.28,target[2]-.05];p.right=[.13,target[1]+.28+.045*Math.sin(t*2.6),target[2]-.05];}
      }
    }else if(a.kind==='elder'){
      p.crouch=.64;p.nod=phase==='doze'?.16:0;p.dozing=phase==='doze';
      if(phase==='fan')p.right=[.25,1.04,.32+.06*Math.sin(t*2.4)];
      if(phase==='gesture'){p.right=[.32+.12*w,1.14+.12*w,.33];p.headTurn=.18*Math.sin(t);}
      if(phase==='listen')p.nod=.06*Math.sin(t*.9);
    }else if(a.kind==='child-grass'){
      p.crouch=phase==='reach'?.45*w:0;
      if(['reach','tug','inspect'].includes(phase)){const spread=phase==='tug'?.11+.04*Math.sin(t*1.4):.10;p.left=[-spread,.88,.37];p.right=[spread,.90,.37];p.lean=phase==='tug'?-.12*Math.sin(t*1.4):.08;}
    }else if(a.kind==='child-stones'){
      p.crouch=phase==='gather'?.8*w:0;
      if(phase==='gather')p.right=point([.30,.88,.12],[.22,.18,.39],w);
      if(phase==='toss')p.right=point([.22,.55,.25],[.18,1.20,.44],e);
      if(phase==='watch'){p.right=[.20,.80,.38];p.nod=-.10*Math.sin(u*Math.PI);}
    }else if(a.kind==='child-top'){
      if(phase==='set'||phase==='pick'){p.crouch=.85*w;p.right=point([.3,.88,.12],[.20,.12,.65],w);}
      if(phase==='whip'){p.right=point([.37,1.12,.16],[.12,.24,.66],smooth(u/.62));p.lean=.16*w;}
      if(phase==='spin')p.nod=.13;
    }else if(a.kind==='liubo'){
      p.crouch=.66;p.lean=['lean','move'].includes(phase)?.16:0;
      const start=a.turn%2?[target[0]-.15,target[1],target[2]+.06]:target,end=a.turn%2?target:[target[0]-.15,target[1],target[2]+.06];
      if(phase==='lean')p.right=point([.30,.86,.15],start,e);
      if(phase==='move'){const f=clamp(u/.66);p.right=point(start,end,smooth(f));p.right[1]+=.08*Math.sin(f*Math.PI);}
      p.headTurn=phase==='consider'?.12*Math.sin(t*.5):0;
      if(a.observer){p.right=[.32,.91,.34];p.left=[-.26,.85,.18];p.lean=.04;p.nod=.06*Math.sin(t*.8);}
    }else if(a.kind==='beekeeper'){
      if(['open','cut','deposit','close'].includes(phase)){p.lean=.2;p.left=[-.22,.81,.48];p.right=[target[0],target[1],target[2]];}
      const aside=[.62,.40,.43],wrist=[target[0],target[1]+.10,target[2]-.23];
      if(phase==='open')p.right=point(target,aside,e);
      if(phase==='cut'){p.right=point(aside,wrist,smooth(u/.30));p.right[0]+=.06*Math.sin(Math.max(0,u-.30)/.34*Math.PI);}
      if(phase==='deposit')p.right=point(wrist,[-.22,.81,.48],e);
      if(phase==='close')p.right=point(aside,target,e);
    }else if(a.kind==='trap'){
      if(['lift','check','lower'].includes(phase)){p.crouch=.43;p.lean=.18;const lift=phase==='lift'?e:phase==='lower'?1-e:1;p.left=[target[0]-.21,target[1]+lift*.38,target[2]];p.right=[target[0]+.21,target[1]+lift*.38,target[2]];p.nod=phase==='check'?.18:0;
        const grips=a.prop?.userData?.communityGrip;
        if(grips?.left&&grips?.right){
          trapPos.copy(a.saved.position);trapPos.y+=lift*.38;trapMat.compose(trapPos,a.saved.quaternion,a.saved.scale);
          if(a.prop.parent){a.prop.parent.updateWorldMatrix(true,false);trapMat.premultiply(a.prop.parent.matrixWorld);}
          const c=Math.cos(a.station.yaw),s=Math.sin(a.station.yaw);
          for(const side of ['left','right']){const g=grips[side];trapV.set(g.x,g.y,g.z).applyMatrix4(trapMat);const dx=trapV.x-a.root.x,dz=trapV.z-a.root.z;p[side]=[(dx*c-dz*s)/a.scale,(trapV.y-a.root.y)/a.scale,(dx*s+dz*c)/a.scale];}
        }
      }
    }
    if(['approach','return'].includes(phase)&&a.length)p.walk=Math.sin(t*5);
    if(a.rest>0){
      const k=a.rest;p.left=point(p.left,[-.23,.69,.19],k);p.right=point(p.right,[.23,.69,.19],k);p.crouch=mix(p.crouch,.50,k);p.lean=mix(p.lean,.03,k);p.nod=mix(p.nod,.16,k);p.dozing=k>.5;p.walk*=1-k;
    }
    return {p,desired,u};
  }
  // Convert a world-space contact into a borrowed tool parent's coordinates without reparenting it.
  const v=new THREE.Vector3(),qWorld=new THREE.Quaternion(),qParent=new THREE.Quaternion();
  const batEuler=new THREE.Euler(),batTiltQ=new THREE.Quaternion(),batAxisX=new THREE.Vector3(1,0,0),batScale=new THREE.Vector3(),batOffset=new THREE.Vector3(),wringScale=new THREE.Vector3(.32,1,.45);
  const greetPose={left:null,right:null,crouch:0,lean:0,headTurn:0,nod:0,walk:0,dozing:false},pending=[],interactables=[];
  function borrow(a,worldPoint,blend=1){
    if(!a.prop)return;
    v.set(worldPoint.x,worldPoint.y,worldPoint.z);
    if(a.prop.parent){a.prop.parent.updateWorldMatrix(true,false);a.prop.parent.worldToLocal(v);}
    a.prop.position.lerp(v,blend);
  }
  function returnProp(a,blend){if(a.prop){a.prop.position.lerp(a.saved.position,blend);a.prop.quaternion.slerp(a.saved.quaternion,blend);a.prop.scale.lerp(a.saved.scale,blend);}}
  function returnCloth(a,blend){if(a.clothSaved){a.cloth.position.lerp(a.clothSaved.position,blend);a.cloth.quaternion.slerp(a.clothSaved.quaternion,blend);a.cloth.scale.lerp(a.clothSaved.scale,blend);}}
  function batInHand(a,u){
    const grip=a.prop.userData.wash.gripLocal;
    const tilt=a.phase==='raise'?smooth(u)*-1.1:a.phase==='strike'?mix(-1.1,0,smooth(u/.78)):0;
    batEuler.set(0,a.station.yaw+Math.PI,0);batTiltQ.setFromAxisAngle(batAxisX,tilt);
    qWorld.setFromEuler(batEuler).multiply(batTiltQ);
    a.prop.updateWorldMatrix(true,false);a.prop.getWorldScale(batScale);
    batOffset.set(grip.x,grip.y,grip.z).multiply(batScale).applyQuaternion(qWorld);
    const h=a.hands.right;v.set(h.x,h.y,h.z).sub(batOffset);
    if(a.prop.parent){a.prop.parent.updateWorldMatrix(true,false);a.prop.parent.worldToLocal(v);a.prop.parent.getWorldQuaternion(qParent);a.prop.quaternion.copy(qParent.invert().multiply(qWorld));}else a.prop.quaternion.copy(qWorld);
    a.prop.position.copy(v);
  }
  function tools(a,p,u){
    const phase=a.phase,target=a.target,wood=0x9e784e;
    if(a.kind==='wash'){
      if(!a.prop||a.prop.userData?.communityRole==='cloth'){
        const grip=p.right,tip=phase==='strike'?point([grip[0],grip[1]-.40,grip[2]+.15],target,smooth(u/.78)): [grip[0],grip[1]-.25,grip[2]+.23];
        rig.segment('box',grip,tip,.075,.047,wood);rig.part('box',tip,[.14,.06,.25],wood,[.12,0,0]);
      }
      // Visible wet linen is held between hands during wringing; never an architectural group.
      if(phase==='wring'&&a.rest<.01){
        if(a.clothSaved){
          const mid=rig.world(point(p.left,p.right,.5));v.set(mid.x,mid.y,mid.z);if(a.cloth.parent){a.cloth.parent.updateWorldMatrix(true,false);a.cloth.parent.worldToLocal(v);}a.cloth.position.copy(v);a.cloth.scale.copy(a.clothSaved.scale).multiply(wringScale);a.cloth.rotation.z=Math.sin(a.time*2.6)*.16;
        }else{rig.segment('box',p.left,p.right,.08,.11,0x9da9a1);for(const side of [-1,1])rig.part('box',[side*.12,p.left[1]-.11,p.left[2]],[.065,.20,.07],0x889c98,[0,0,side*.15*Math.sin(a.time*2.6)]);}
      }else returnCloth(a,.15);
      if(a.prop&&a.rest<.01&&['raise','strike','wring'].includes(phase)){
        // Bat ownership metadata declares its authored grip, not a guessed whole-station transform.
        if(a.prop.userData?.wash?.gripLocal&&phase!=='wring')batInHand(a,u);
        else returnProp(a,.12);
      }else returnProp(a,.12);
    }else if(a.kind==='elder'){
      const h=p.right;rig.segment('box',h,[h[0],h[1]+.12,h[2]],.022,.022,wood);
      rig.part('fan',[h[0],h[1]+.11,h[2]],[.23,.23,.23],0xc7b987,[.08*Math.sin(a.time*2.4),0,0]);
      for(let j=0;j<5;j++){const angle=.12+j*.64;rig.segment('box',[h[0],h[1]+.11,h[2]-.005],[h[0]+Math.cos(angle)*.22,h[1]+.11+Math.sin(angle)*.22,h[2]-.005],.009,.009,0x96835b);}
    }else if(a.kind==='child-grass'){
      const mid=point(p.left,p.right,.5);rig.segment('box',p.left,mid,.012,.015,0x75875a);rig.segment('box',mid,p.right,.012,.015,0x8a9864);
      rig.part('box',[mid[0],mid[1]+.03,mid[2]],[.075,.025,.018],0x9ba16b,[0,0,.55]);
      if(a.partner){const dx=(a.partner.root.x-a.root.x)/2,dz=(a.partner.root.z-a.root.z)/2,c=Math.cos(a.station.yaw),s=Math.sin(a.station.yaw);const crossing=[(dx*c-dz*s)/a.scale,.90,(dx*s+dz*c)/a.scale];rig.segment('box',p.right,crossing,.014,.012,0x8d995f);rig.part('box',crossing,[.08,.028,.015],0x9ba16b,[0,0,.45]);}
    }else if(a.kind==='child-stones'){
      let stone=p.right;if(phase==='watch'){const f=clamp(u/.48);stone=[.18,1.20-1.10*f+.70*Math.sin(f*Math.PI),.44+.40*f];}
      if(phase==='rest')stone=[.18,.10,.84];rig.part('round',stone,[.055,.06,.048],0xaaa99a);
      for(let j=0;j<4;j++)rig.part('round',[-.12+j*.10,.07,.43+(j%2)*.09],[.05,.04,.045],0x8e9285);
    }else if(a.kind==='child-top'){
      const top=[.16,.14,.67],tilt=a.topSpeed>1?.045*Math.sin(a.topAngle):.38;
      rig.part('cone',top,[.105,.20,.105],0xa56b4d,[Math.PI+tilt,a.topAngle,0]);rig.part('taper',[top[0],.19,top[2]],[.11,.045,.11],0xd6b05e,[tilt,a.topAngle,0]);
      rig.part('box',[top[0],.26,top[2]],[.025,.1,.025],wood);
      const h=p.right,end=[h[0]+.06,h[1]-.26,h[2]+.12];rig.segment('box',h,end,.026,.024,wood);
      rig.segment('box',end,phase==='whip'&&u>.55?top:[end[0]-.05,end[1]-.18,end[2]+.07],.009,.009,0xc5b38b);
    }else if(a.kind==='beekeeper'){
      rig.part('taper',p.left,[.15,.15,.15],wood);rig.part('round',[p.left[0],p.left[1]+.078,p.left[2]],[.115,.012,.115],phase==='deposit'?0xd1a34f:0x544d37);
      const h=p.right;if(['cut','deposit'].includes(phase)){rig.segment('box',h,[h[0],h[1]-.10,h[2]+.12],.025,.03,wood);rig.part('box',[h[0],h[1]-.10,h[2]+.16],[.07,.023,.14],0x9a9d93);}
      if(phase==='deposit')rig.part('taper',[h[0],h[1]-.05,h[2]+.04],[.07,.07,.04],0xdcaf54);
      if(a.prop&&a.rest<.01){
        if(['open','close'].includes(phase))borrow(a,a.hands.right);
        else if(['cut','deposit'].includes(phase))borrow(a,rig.world([.62,.40,.43]));
        else returnProp(a,.15);
      }else returnProp(a,.12);
    }else if(a.kind==='trap'){
      if(a.prop&&['lift','check','lower'].includes(phase)&&a.rest<.01){
        // Raise basket relative to authored rest, preserving mooring orientation and all external ownership.
        const lift=phase==='lift'?smooth(u):phase==='lower'?1-smooth(u):1;
        a.prop.position.copy(a.saved.position);a.prop.position.y+=lift*.38;
      }else returnProp(a,.14);
    }else if(a.kind==='liubo'){
      if(a.prop&&phase==='move'&&a.rest<.01)borrow(a,a.hands.right);
      // Leave the moved piece on its new board square until the next deliberate pickup.
      // Neither rest nor a new turn teleports it back to the authored initial square.
      if(!a.prop&&!a.observer&&phase==='move')rig.part('box',p.right,[.055,.04,.09],0xc3b69c);
    }
  }
  function render(step=0,playerState=null){
    rig.begin();
    const hasPlayer=playerState&&Number.isFinite(playerState.x)&&Number.isFinite(playerState.z);
    for(const a of actors){
      if(a.sheltered){returnProp(a,1);returnCloth(a,1);continue;}
      const {p,desired,u}=pose(a);
      let poseState=p;
      let glanceYaw=0,glanceW=0;
      if(hasPlayer&&a.rest<.25){
        const pd=Math.hypot(playerState.x-a.root.x,playerState.z-a.root.z);
        if(pd<4.8&&pd>.1){
          let rel=Math.atan2(playerState.x-a.root.x,playerState.z-a.root.z)-a.station.yaw;
          while(rel>Math.PI)rel-=Math.PI*2;
          while(rel<-Math.PI)rel+=Math.PI*2;
          if(Math.abs(rel)<1.45){glanceYaw=clamp(rel,-.48,.48);glanceW=clamp((4.8-pd)/2.2)*.65;}
        }
      }
      if(a.greetT>0||glanceW>.01){
        greetPose.left=p.left;greetPose.right=p.right;greetPose.crouch=p.crouch;greetPose.lean=p.lean;
        greetPose.walk=p.walk;greetPose.dozing=p.dozing;
        if(a.greetT>0){
          const enter=clamp((a.greetMax-a.greetT)/.26),leave=clamp(a.greetT/.38),gk=smooth(Math.min(enter>0?enter:1,leave));
          const busyHands=(a.kind==='wash'&&['raise','strike','wring'].includes(a.phase))||(a.kind==='trap'&&['lift','check','lower'].includes(a.phase))||(a.kind==='beekeeper'&&['open','cut','deposit','close'].includes(a.phase))||(a.kind==='liubo'&&a.phase==='move');
          greetPose.headTurn=mix(p.headTurn||0,a.greetYaw,gk);
          greetPose.nod=mix(p.nod||0,a.child?.12:.16,gk);
          if(!busyHands){
            const claspY=1.02-(greetPose.crouch||0)*.28;
            greetPose.lean=mix(p.lean||0,Math.max(p.lean||0,a.child?.14:.19),gk);
            greetPose.left=point(p.left,[-.042,claspY+.014,.33],gk);
            greetPose.right=point(p.right,[.042,claspY,.31],gk);
          }
        }else{
          greetPose.headTurn=mix(p.headTurn||0,glanceYaw,glanceW);
          greetPose.nod=mix(p.nod||0,-.03,glanceW*.5);
        }
        poseState=greetPose;
      }
      // Continuous bounded travel, including return/rest transitions. Every proposed micro-step is revalidated.
      const dx=desired.x-a.root.x,dz=desired.z-a.root.z,d=Math.hypot(dx,dz),move=Math.min(d,step*.58)*(1-a.rest);
      if(d>1e-8&&move>0){const next={x:a.root.x+dx/d*move,z:a.root.z+dz/d*move};if(safeLeg(a.root,next)){a.root.x=next.x;a.root.z=next.z;a.root.y=floor(next.x,next.z);}}
      a.interactable.x=a.root.x;a.interactable.y=a.root.y;a.interactable.z=a.root.z;
      rig.actor(a.root.x,a.root.y,a.root.z,a.station.yaw,a.scale);a.hands=rig.human(a,poseState);tools(a,poseState,u);
    }
    rig.finish();
  }
  function emit(a,key,playerState){
    events[key]++;
    if(key==='washImpact'&&a.rest<.01){const c=rigContact(a,a.target);sound?.wood?.(c.x,c.z);}
    if(key==='topWhip')a.topSpeed=25;
    if(key==='elderGesture'&&sound?.voice&&clock-a.voiceAt>65&&playerState&&Number.isFinite(playerState.x)&&Math.hypot(playerState.x-a.root.x,playerState.z-a.root.z)<9){
      sound.voice('elder',a.root.x,a.root.z,{ambient:true,chatter:true,emitterId:a.id,gain:.40});a.voiceAt=clock;
    }
  }
  function rigContact(a,p){const c=Math.cos(a.station.yaw),s=Math.sin(a.station.yaw);return {x:a.root.x+a.scale*(p[0]*c+p[2]*s),y:a.root.y+a.scale*p[1],z:a.root.z+a.scale*(-p[0]*s+p[2]*c)};}
  function update(dt,elapsed,sky={},playerState={}){
    const step=livingStep(dt);if(!step||disposed)return;clock+=step;
    const appearance=sky.getAppearance?.();
    const isNight=sky.timeId==='night'||(sky.night??appearance?.night??0)>.55;
    const rainAmt=sky.rainIntensity??sky.rain??appearance?.rain??0;
    const isRaining=rainAmt>.16;
    const resting=isNight||isRaining;
    pending.length=0;
    for(const a of actors){
      const shouldShelter=isNight||(isRaining&&a.kind!=='liubo');
      a.shelter=clamp(a.shelter+(shouldShelter?step:-step)*1.3);
      a.sheltered=shouldShelter?a.shelter>=.85:false;
      a.greetT=Math.max(0,a.greetT-step);
      a.rest=clamp(a.rest+(resting?step:-step)*1.3);
      a.topSpeed=Math.max(0,a.topSpeed-step*2.25);a.topAngle=(a.topAngle+a.topSpeed*step)%(Math.PI*2);
      if(resting)continue;
      if(a.delay>0){a.delay=Math.max(0,a.delay-step);continue;}
      const turn=a.turns,current=turn[a.phaseIndex];a.phase=current[0];
      a.time+=step;
      const destination=a.phase==='return'?a.path[0]:a.station;
      // A long, late or newly blocked approach never starts work from a distant root.
      if(['approach','return'].includes(a.phase)&&Math.hypot(a.root.x-destination.x,a.root.z-destination.z)>.025)a.time=Math.min(a.time,current[1]-.0001);
      const event=EVENTS[a.kind];
      if(!a.fired&&!a.observer&&a.phase===event[0]&&a.time/current[1]>=event[1]&&a.rest<.01){a.fired=true;pending.push([a,event[2]]);}
      if(a.time>=current[1]){
        a.time-=current[1];a.phaseIndex++;a.fired=false;
        if(a.phaseIndex===turn.length){a.phaseIndex=0;a.turn++;completed[a.kind]++;}
        a.phase=turn[a.phaseIndex][0];
      }
    }
    render(step,playerState);
    // Contacts/tools are now the visible current pose, not the previous frame's guessed timer position.
    for(const [a,key] of pending)emit(a,key,playerState);
  }
  function getStats(){
    const geom=rig.stats();return {actors:actors.length,kinds:{...kinds},...geom,clock,resting:actors.filter(a=>a.rest>.5).length,pathsRejected,rejected:rejected.map(r=>({...r})),
      completed:{...completed},events:{...events},limits:{drawCalls:16,maxDt:.05,maxSpeed:.58,maxPathSegment:8,maxStep:.18,bodyRadius:.20},
      placements:actors.map(a=>({id:a.id,kind:a.kind,x:a.station.x,y:a.station.y,z:a.station.z,yaw:a.station.yaw,pathPoints:a.path.length,pathLength:a.length,
        root:{...a.root},phase:a.phase,phaseTime:a.time,turn:a.turn,observer:!!a.observer,partner:a.partner?.id??null,topSpeed:a.topSpeed,hands:{left:{...a.hands.left},right:{...a.hands.right}},contact:a.target?rigContact(a,a.target):null,
        camera:{x:a.station.x+Math.cos(a.station.yaw)*2.4-Math.sin(a.station.yaw)*3,y:a.station.y+2.0,z:a.station.z-Math.sin(a.station.yaw)*2.4-Math.cos(a.station.yaw)*3}}))};
  }
  function greet(idOrIndex,px,pz,duration=2.6){
    const a=typeof idOrIndex==='number'?actors[idOrIndex]:actors.find(item=>item.id===idOrIndex);
    if(!a||a.sheltered||!Number.isFinite(px)||!Number.isFinite(pz))return false;
    let rel=Math.atan2(px-a.root.x,pz-a.root.z)-a.station.yaw;
    while(rel>Math.PI)rel-=Math.PI*2;
    while(rel<-Math.PI)rel+=Math.PI*2;
    a.greetYaw=clamp(rel,-.75,.75);
    a.greetMax=Math.max(.4,duration||2.6);
    a.greetT=a.greetMax;
    return true;
  }
  function getInteractables(){
    interactables.length=0;
    for(let i=0;i<actors.length;i++)if(!actors[i].sheltered)interactables.push(actors[i].interactable);
    return interactables;
  }
  function dispose(){if(disposed)return;disposed=true;for(const a of actors){returnProp(a,1);returnCloth(a,1);}rig.dispose();group.removeFromParent();}
  render();return {group,update,greet,getInteractables,getStats,dispose};
}
