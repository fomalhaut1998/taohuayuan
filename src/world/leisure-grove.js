import * as THREE from 'three';
import { createHabitatContext, habitatSiteSafe, habitatSurface } from './habitat-details.js';
import { createGroveBaker } from './leisure-grove-geometry.js';

const TAU=Math.PI*2;
const P={wood:'#927451',dark:'#604D37',cut:'#C3A76E',thatch:'#B69D68',straw:'#D4BD83',stone:'#9A9F90',light:'#BFC2AC',leaf:'#5D7950',young:'#82985A',moss:'#73835C',soil:'#8D7554',red:'#B36953',blue:'#667D8E',ivory:'#E4D7B3'};
const unwrap=v=>v?.layout||v||{};
const boxDistance=(x,z,b)=>{const c=Math.cos(b.rot||0),s=Math.sin(b.rot||0),dx=x-b.x,dz=z-b.z;return Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-b.hw),Math.max(0,Math.abs(dx*s+dz*c)-b.hd));};

export function createLeisureGrove(options) {
  const {world,field}=options,group=new THREE.Group();group.name='leisure-grove';
  const blockers=[],targets=[],stations=[],layout={regions:[],rejected:[],reservations:[],conduit:null,bridge:null,brook:null,board:null};
  const baker=createGroveBaker(),materials=[],meshes=[],ribbons=[],bees=[];
  const material=(side=THREE.FrontSide)=>{const m=new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true,side});materials.push(m);return m;};
  const solid=material(THREE.DoubleSide),foliage=material(THREE.DoubleSide),motionMat=material(THREE.DoubleSide);
  const icoRaw=new THREE.IcosahedronGeometry(1,0),icoBase=icoRaw.index?icoRaw.toNonIndexed():icoRaw,icoArr=icoBase.attributes.position.array;
  const cShadeLeaf=new THREE.Color('#4A6640'),cMidLeaf=new THREE.Color(P.leaf),cSunLeaf=new THREE.Color('#8BA460'),cTmp=new THREE.Color();
  function tube(a,b,r0,ink,r1=r0,seg=6,batch='solid'){
    const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],L=Math.hypot(dx,dy,dz)||1,ux=dx/L,uy=dy/L,uz=dz/L;
    let px=Math.abs(uy)<.9?1:0,py=Math.abs(uy)<.9?0:1,pz=0;
    let qx=uy*pz-uz*py,qy=uz*px-ux*pz,qz=ux*py-uy*px;const ql=Math.hypot(qx,qy,qz)||1;qx/=ql;qy/=ql;qz/=ql;
    px=qy*uz-qz*uy;py=qz*ux-qx*uz;pz=qx*uy-qy*ux;
    const ring=(c,r)=>Array.from({length:seg},(_,k)=>{const t=k*TAU/seg,ca=Math.cos(t),sa=Math.sin(t);return [c[0]+(px*ca+qx*sa)*r,c[1]+(py*ca+qy*sa)*r,c[2]+(pz*ca+qz*sa)*r];});
    const A=ring(a,r0),B=ring(b,r1);
    for(let k=0;k<seg;k++){const k2=(k+1)%seg;baker.quad(A[k],A[k2],B[k2],B[k],ink,batch);}
  }
  function canopyPuff(center,radii,toneHex,seed=0,batch='foliage'){
    const s=baker.batches.get(batch)||(baker.tri([0,0,0],[0,0,0],[0,0,0],toneHex,batch),baker.batches.get(batch));
    if(s.position.length===9&&s.position.every(v=>v===0)){s.position.length=0;s.color.length=0;}
    const baseCol=new THREE.Color(toneHex),cy=Math.cos(seed*.7),sy=Math.sin(seed*.7);
    for(let i=0;i<icoArr.length;i+=9){
      const fy=(icoArr[i+1]+icoArr[i+4]+icoArr[i+7])/3;
      cTmp.copy(baseCol);
      if(fy<-.12)cTmp.lerp(cShadeLeaf,Math.min(.55,(-fy)*0.62));
      else if(fy>.18)cTmp.lerp(cSunLeaf,Math.min(.52,(fy-.18)*0.68));
      else cTmp.lerp(cMidLeaf,.18);
      const sh=.93+.11*(0.5+0.5*Math.sin(i*.37+seed*2.1));
      const cr=Math.min(1,cTmp.r*sh),cg=Math.min(1,cTmp.g*sh),cb=Math.min(1,cTmp.b*sh);
      for(let k=0;k<3;k++){
        const o=i+k*3,ux=icoArr[o],uy=icoArr[o+1],uz=icoArr[o+2],ang=Math.atan2(uz,ux);
        const lobe=1+.11*Math.sin(ang*3+seed*1.7)+.06*Math.cos(ang*2-seed)+.05*Math.sin(uy*5+seed);
        const dy=uy<0?uy*.76:uy*.95+.04*(1-uy*uy);
        const lx=ux*radii[0]*lobe,ly=dy*radii[1]*lobe,lz=uz*radii[2]*lobe;
        s.position.push(center[0]+lx*cy+lz*sy,center[1]+ly,center[2]-lx*sy+lz*cy);
        s.color.push(cr,cg,cb);
      }
    }
  }
  let context,time=0,disposed=false;
  const complete=['world','field','distanceToRiver','riverCurve','village','props','hinterland','villageScenes','villageLife','flora','boats','cliff','exterior'].every(k=>options[k]);
  const surface=(x,z)=>habitatSurface(field,x,z);
  const triangleCount=()=>[...baker.batches.values()].reduce((n,b)=>n+b.position.length/9,0);
  function buildSite(p,build){if(!p)return;const before=triangleCount();build(p);p.triangles=triangleCount()-before;}
  if(complete){
    context=createHabitatContext(options);
    context.cfg={...context.cfg,maxSlope:.36,clearance:.25};
    // Earlier factories expose successful footprints only. Never mutate their reservations.
    for(const source of options.reservations||[]){
      const raw=unwrap(source),r=raw.reservations||raw;
      for(const q of Array.isArray(r)?r:[]){if(![q.x,q.z].every(Number.isFinite))continue;if(Number.isFinite(q.radius)&&q.radius>0)context.reservations.circles.push({...q,r:q.radius});else if(Number.isFinite(q.hw)&&Number.isFinite(q.hd))context.reservations.boxes.push({...q});}
      for(const c of r.circles||[])context.reservations.circles.push({...c,r:c.r??c.radius});
      for(const b of r.boxes||[])context.reservations.boxes.push({...b});
      for(const c of r.corridors||[])context.reservations.corridors.push({...c});
      for(const b of source?.blockers||[])if([b.x,b.z,b.hw,b.hd].every(Number.isFinite))context.reservations.boxes.push({...b});
    }
    for(const c of options.habitatDetails?.layout?.clusters||[])context.reservations.circles.push({x:c.x,z:c.z,r:c.radius,source:'habitat-detail'});
  }
  function safe(x,z,r,ctx=context) {return !!ctx&&habitatSiteSafe(x,z,r,ctx);}
  function reserve(kind,x,z,r){
    const item={kind,x,z,y:surface(x,z),radius:r};layout.regions.push(item);
    const circle={x,z,r,source:'leisure-'+kind};context.reservations.circles.push(circle);layout.reservations.push({x,z,radius:r});return item;
  }
  function find(kind,anchors,r,spread=20,accept=()=>true) {
    for(const a of anchors)for(let i=0;i<900;i++){
      const angle=i*2.399963229728653,rr=spread*Math.sqrt(i/899),x=Math.round((a[0]+Math.cos(angle)*rr)*100)/100,z=Math.round((a[1]+Math.sin(angle)*rr)*100)/100;
      if(!accept(x,z)||!safe(x,z,r))continue;
      const y=surface(x,z);let delta=0;
      for(let k=0;k<16;k++)delta=Math.max(delta,Math.abs(surface(x+Math.cos(k*TAU/16)*r,z+Math.sin(k*TAU/16)*r)-y));
      if(delta>.28)continue;
      return reserve(kind,x,z,r);
    }
    layout.rejected.push({kind,reason:'no dry, level, reserved-footprint-free candidate'});return null;
  }
  function target(id,p,range=6){targets.push({id,x:p[0],y:p[1],z:p[2],range});}
  function collider(x,z,hw,hd,minY,maxY,rot=0,source='leisure-post') {blockers.push({x,z,hw,hd,minY,maxY,rot,source});}
  function addMesh(mesh){if(mesh){group.add(mesh);meshes.push(mesh);}return mesh;}
  function prop(name,position,role,contact,build){
    const b=createGroveBaker();build(b);const mesh=b.finish('solid',solid);b.dispose();mesh.name='leisure-grove-'+name;mesh.position.set(...position);mesh.matrixAutoUpdate=true;mesh.userData.communityRole=role;mesh.userData.communityContact=contact;return addMesh(mesh);
  }
  function station(kind,p,yaw=0,object,path){
    // Root is sampled ground. Only footprints already proven clear become actor stations.
    if(![p[0],p[2]].every(Number.isFinite)||field.sample(p[0],p[2])<context.dry)return null;
    if(blockers.some(b=>boxDistance(p[0],p[2],b)<.27))return null;
    const s={kind,x:p[0],y:surface(p[0],p[2]),z:p[2],yaw};if(object)s.prop=object;if(path)s.path=path;stations.push(s);return s;
  }
  function plantFoot(p,r=.15){baker.beam([p[0],surface(p[0],p[2])-.04,p[2]],p,r,P.wood,r*.85);}
  function tree(item,kind='ancient',offset=[0,0],scale=1) {
    const x=item.x+offset[0],z=item.z+offset[1],y=surface(x,z),large=kind==='ancient',h=large?5.8:3.7,r=large?.66:.19;
    // Flared buttress collar + 3-segment continuously tapering trunk (no flat-chopped stump top)
    tube([x,y-.16,z],[x-.04*scale,y+.42*scale,z+.04],r*scale*1.26,P.dark,r*scale*1.0,8);
    const trunk=[[x-.04*scale,y+.38*scale,z+.04],[x-.15*scale,y+h*.36*scale,z+.12],[x+.09*scale,y+h*.64*scale,z-.05],[x-.03*scale,y+h*.86*scale,z+.02]];
    const rSteps=[1.0,.76,.50,.22];
    for(let i=1;i<trunk.length;i++)tube(trunk[i-1],trunk[i],r*scale*rSteps[i-1],i===3?P.wood:P.dark,r*scale*rSteps[i],7);
    collider(x,z,r*scale,r*scale,y,y+h*.5*scale,0,'leisure-'+kind+'-trunk');
    // Ground-hugging curved root flares that sink smoothly into soil (eliminates stilt/spider-leg air gaps)
    const rootN=large?7:4;
    for(let k=0;k<rootN;k++){
      const a=k*TAU/rootN+.25,c=Math.cos(a),s=Math.sin(a);
      const rMid=(large?.96:.34)*scale,rFar=(large?1.62:.56)*scale;
      const mx=x+c*rMid,mz=z+s*rMid,fx=x+c*rFar,fz=z+s*rFar;
      const p0=[x+c*r*scale*.52,y+(large?.44:.22)*scale,z+s*r*scale*.52];
      const p1=[mx,surface(mx,mz)+(large?.10:.04)*scale,mz];
      const p2=[fx,surface(fx,fz)-.07,fz];
      tube(p0,p1,(large?.21:.09)*scale,P.dark,(large?.13:.055)*scale,5);
      tube(p1,p2,(large?.13:.055)*scale,P.dark,(large?.045:.022)*scale,5);
    }
    const branches=large?7:5;
    for(let k=0;k<branches;k++){
      const a=k*TAU/branches+.3,reach=(large?2.55:1.15)*scale,by=y+(h*.66+(k%3)*.24)*scale;
      // Staggered branch origins along the upper trunk + gentle mid-bend elbow
      const origin=k%2===0?trunk[1]:trunk[2];
      const mid=[origin[0]+Math.cos(a)*reach*.56,origin[1]+(by-origin[1])*.58+.18*scale,origin[2]+Math.sin(a)*reach*.56];
      const end=[x+Math.cos(a)*reach,by,z+Math.sin(a)*reach];
      tube(origin,mid,(large?.17:.07)*scale,P.wood,(large?.11:.045)*scale,6);
      tube(mid,end,(large?.11:.045)*scale,P.wood,(large?.065:.024)*scale,5);
      tube(end,[end[0]+Math.cos(a)*.4*scale,end[1]+.6*scale,end[2]+Math.sin(a)*.4*scale],.052*scale,P.wood,.02*scale,5);
      for(let j=0;j<2;j++){
        const q=[end[0]+Math.cos(a+j*2)*.48*scale,end[1]+.44*scale+j*.44*scale,end[2]+Math.sin(a+j*2)*.48*scale];
        canopyPuff(q,[(large?1.68:.96)*scale,(large?.94:.70)*scale,(large?1.54:.90)*scale],k%3?P.leaf:P.young,k*1.3+j);
        canopyPuff([q[0]-Math.cos(a)*.38*scale,q[1]+.18*scale,q[2]-Math.sin(a)*.38*scale],[(large?1.24:.74)*scale,(large?.76:.54)*scale,(large?1.18:.72)*scale],j%2?P.young:P.leaf,k*2.1+j+.8);
        for(let n=0;n<4;n++){const t=n*2.4+k,qx=q[0]+Math.cos(t)*.88*scale,qz=q[2]+Math.sin(t)*.8*scale;baker.leaf([qx,q[1]+.24*scale,qz],[qx+Math.cos(t)*.48*scale,q[1]+.3*scale,qz+Math.sin(t)*.48*scale],.13*scale,P.young);}
      }
      if(kind!=='ancient')for(let n=0;n<3;n++){
        const px=end[0]+Math.cos(n*2.3)*.4,pz=end[2]+Math.sin(n*2.3)*.4,py=by+.05+(n%2)*.28;
        tube([px,py+.15,pz],[px,py+.27,pz],.012,P.dark,.008,4);
        if(kind==='plum')baker.peach([px,py,pz],[.08,.10,.08],n%2?'#A7717B':'#83536A');
        else{baker.peach([px,py,pz],[.115,.11,.1],'#718047');for(let s=0;s<3;s++){const t=s*TAU/3;tube([px+Math.cos(t)*.09,py,pz+Math.sin(t)*.09],[px+Math.cos(t)*.16,py+.05,pz+Math.sin(t)*.16],.015,P.young,0.003,3);}}
      }
    }
    if(large){
      canopyPuff([x,y+5.75,z],[2.62,1.08,2.35],P.young,.9);
      canopyPuff([x-.65,y+5.25,z+.52],[1.95,.88,1.82],P.leaf,2.2);
      canopyPuff([x+.68,y+5.30,z-.48],[1.90,.86,1.78],P.young,3.5);
    }else{
      canopyPuff([x,y+h*.96*scale,z],[1.22*scale,.78*scale,1.15*scale],kind==='plum'?P.young:P.leaf,1.4);
    }
    return {x,z,y};
  }
  function pavilion(p) {
    const {x,z,y}=p,pt=(a,b,c)=>[x+a,y+b,z+c];
    // Low stepped bluestone & rammed-earth terrace pad (y + 0.028) with stone border curbing & pillar plinths.
    const padHalf=1.94,curbW=.14,apronHalf=2.18,padY=y+.028,curbY=y+.044;
    for(let gx=0;gx<4;gx++)for(let gz=0;gz<4;gz++){
      const x0=-padHalf+gx*(padHalf*2/4),x1=x0+padHalf*2/4,z0=-padHalf+gz*(padHalf*2/4),z1=z0+padHalf*2/4;
      const tileCol=(gx+gz)%3===0?'#9EA394':((gx+gz)%2?'#929788':'#8E846E');
      baker.quad([x+x0,padY,z+z0],[x+x1,padY,z+z0],[x+x1,padY,z+z1],[x+x0,padY,z+z1],tileCol);
    }
    for(let side=0;side<4;side++){
      const rotC=q=>side===0?q:side===1?[-q[1],q[0]]:side===2?[-q[0],-q[1]]:[q[1],-q[0]];
      for(let seg=0;seg<4;seg++){
        const u0=-padHalf+seg*(padHalf*2/4),u1=u0+padHalf*2/4;
        const i0=rotC([u0,padHalf-curbW]),i1=rotC([u1,padHalf-curbW]),o1=rotC([u1,padHalf]),o0=rotC([u0,padHalf]);
        const a0=rotC([u0,apronHalf]),a1=rotC([u1,apronHalf]);
        const cCol=seg%2?P.stone:P.light;
        baker.quad([x+i0[0],curbY,z+i0[1]],[x+i1[0],curbY,z+i1[1]],[x+o1[0],curbY,z+o1[1]],[x+o0[0],curbY,z+o0[1]],cCol);
        baker.quad([x+i1[0],curbY,z+i1[1]],[x+i0[0],curbY,z+i0[1]],[x+i0[0],padY,z+i0[1]],[x+i1[0],padY,z+i1[1]],P.stone);
        baker.quad([x+o0[0],curbY,z+o0[1]],[x+o1[0],curbY,z+o1[1]],[x+o1[0],y+.012,z+o1[1]],[x+o0[0],y+.012,z+o0[1]],P.stone);
        baker.quad([x+o0[0],y+.012,z+o0[1]],[x+o1[0],y+.012,z+o1[1]],[x+a1[0],Math.min(y-.03,surface(x+a1[0],z+a1[1])-.04),z+a1[1]],[x+a0[0],Math.min(y-.03,surface(x+a0[0],z+a0[1])-.04),z+a0[1]],seg%2?P.soil:P.moss);
      }
    }
    // A hip roof, not the existing cloth tea awning: corner posts on stone plinths, knee braces, real thatch courses.
    for(const dx of [-1.7,1.7])for(const dz of [-1.7,1.7]){
      const floor=surface(x+dx,z+dz);
      baker.block([x+dx,padY+.032,z+dz],[.34,.085,.34],P.stone);
      baker.beam([x+dx,Math.min(floor-.06,padY-.06),z+dz],pt(dx,2.65,dz),.13,P.wood,.105,8);baker.beam(pt(dx,2.1,dz),pt(dx-Math.sign(dx)*.55,2.6,dz),.065,P.dark,.065,6);baker.beam(pt(dx,2.1,dz),pt(dx,2.6,dz-Math.sign(dz)*.55),.065,P.dark,.065,6);collider(x+dx,z+dz,.15,.15,floor,y+2.75);
    }
    for(const s of [-1,1]){baker.beam(pt(-1.9,2.6,s*1.7),pt(1.9,2.6,s*1.7),.105,P.dark);baker.beam(pt(s*1.7,2.6,-1.9),pt(s*1.7,2.6,1.9),.105,P.dark);}
    const roof=[[[-2.2,2.64,-2.2],[2.2,2.64,-2.2],[.45,4.0,0],[-.45,4.0,0]],[[2.2,2.64,-2.2],[2.2,2.64,2.2],[.45,4.0,0],[.45,4.0,0]],[[2.2,2.64,2.2],[-2.2,2.64,2.2],[-.45,4.0,0],[.45,4.0,0]],[[-2.2,2.64,2.2],[-2.2,2.64,-2.2],[-.45,4.0,0],[-.45,4.0,0]]];
    const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
    for(const [ri,q]of roof.entries()){
      baker.quad(...q.map(v=>pt(...v)),P.thatch);
      for(let row=0;row<6;row++)for(let col=0;col<12;col++){
        const v0=row/6,v1=(row+1.12)/6,t0=col/12,t1=(col+.92)/12;
        const at=(u,v)=>{const a=mix(q[0],q[3],u),b=mix(q[1],q[2],u),vtx=mix(a,b,v);vtx[1]+=.028+(1-u)*.025;return pt(...vtx);};
        baker.quad(at(v0,t0),at(v0,t1),at(Math.min(1,v1),t1),at(Math.min(1,v1),t0),(col+row+ri)%3?P.thatch:P.straw);
      }
    }
    baker.beam(pt(-.65,4.03,0),pt(.65,4.03,0),.14,P.straw,.14,8);
    // Joined stone table with four separate stools anchored onto the bluestone terrace pad; no whole-pavilion collision box.
    baker.beam(pt(0,.02,0),pt(0,.69,0),.36,P.stone,.29,7);baker.beam(pt(0,.69,0),pt(0,.80,0),.93,P.light,.9,10);collider(x,z,.91,.91,y,y+.8,0,'leisure-stone-table');
    for(const [dx,dz]of [[-1.25,0],[1.25,0],[0,-1.28],[0,1.28]]){const gy=surface(x+dx,z+dz),baseY=Math.min(gy,padY);baker.beam([x+dx,baseY,z+dz],[x+dx,padY+.35,z+dz],.19,P.stone,.22,7);baker.beam([x+dx,padY+.35,z+dz],[x+dx,padY+.43,z+dz],.31,P.light,.30,8);collider(x+dx,z+dz,.29,.29,gy,padY+.43,0,'leisure-stool');}
    baker.block(pt(0,.835,0),[1.06,.065,1.06],P.dark);baker.block(pt(0,.871,0),[.96,.012,.96],'#D2B47F');
    const lines=[];
    const line=(a,b)=>{
      lines.push([a,b]);
      const dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz)||1,nx=-dz/L*.011,nz=dx/L*.011;
      baker.quad(pt(a[0]+nx,.880,a[1]+nz),pt(b[0]+nx,.880,b[1]+nz),pt(b[0]-nx,.880,b[1]-nz),pt(a[0]-nx,.880,a[1]-nz),'#534936');
    };
    // Central square plus rotational T, L and V marks. Deliberately no crossing Go grid.
    for(let k=0;k<4;k++){
      const rot=q=>[q[0]*Math.cos(k*Math.PI/2)+q[1]*Math.sin(k*Math.PI/2),-q[0]*Math.sin(k*Math.PI/2)+q[1]*Math.cos(k*Math.PI/2)];
      for(const [a,b]of [[[[-.16,-.16],[.16,-.16]]][0],[[0,-.43],[0,-.28]],[[-.13,-.28],[.13,-.28]],[[.28,-.43],[.28,-.27]],[[.28,-.27],[.43,-.27]],[[-.41,-.39],[-.34,-.32]],[[-.34,-.32],[-.27,-.39]]])line(rot(a),rot(b));
    }
    for(const side of [-1,1])for(let i=0;i<6;i++)if(!(side===1&&i===5))baker.block(pt(-.35+i*.14,.911,side*.36),[.09,.046,.064],side===1?P.ivory:P.dark);
    layout.board={x,y:y+.883,z,pattern:'central-square-four-T-L-V',lines:lines.length,pieces:12,ruleSimulation:false};target('liubo-board',pt(0,.9,0),4.5);
    for(const dx of [-.66,.66])baker.bowl(pt(dx,.81,.36),.15,P.ivory);
    baker.bowl(pt(.56,.81,-.45),.23,P.red);
    for(let i=0;i<3;i++){const q=pt(.51+i*.10,.99,-.45+(i%2)*.1);baker.peach(q,[.095,.105,.09],'#D49A7C');baker.leaf([q[0],q[1]+.09,q[2]],[q[0]+.15,q[1]+.12,q[2]+.04],.03,P.leaf);}
    for(let i=0;i<6;i++)baker.beam(pt(-.69+i*.035,.825,-.38),pt(-.64+i*.035,.825,-.62),.008,P.ivory,.008,4);
    const actor=[x+1.23,y,z+.72],yaw=Math.atan2(-1.23,-.72),piecePoint=pt(.35,.911,.36),dx=piecePoint[0]-actor[0],dz=piecePoint[2]-actor[2],rootY=surface(actor[0],actor[2]);
    const piece=prop('liubo-piece',piecePoint,'liubo-piece',{x:dx*Math.cos(yaw)-dz*Math.sin(yaw),y:piecePoint[1]-rootY,z:dx*Math.sin(yaw)+dz*Math.cos(yaw)},b=>b.block([0,0,0],[.09,.046,.064],P.ivory));
    station('liubo',actor,yaw,piece);station('liubo',[x-1.23,y,z-.72],yaw+Math.PI);target('thatched-pavilion',pt(.0,2.9,0),8);
  }
  function social(p){
    tree(p);const {x,y,z}=p;
    // Shrine is deliberately a plain weathered stone, not a claim about a particular historical cult.
    baker.beam([x-1.1,surface(x-1.1,z-.6),z-.6],[x-1.1,y+.18,z-.6],.48,P.stone,.44,7);baker.orb([x-1.1,y+.57,z-.6],[.3,.50,.25],P.light,'solid',.2);baker.block([x-1.1,y+.58,z-.34],[.18,.3,.018],P.moss);
    // Separate the broad low plinth from the narrow upright stone, preserving their true heights.
    collider(x-1.1,z-.6,.48,.48,y,y+.18,0,'leisure-shrine-plinth');collider(x-1.1,z-.6,.33,.29,y+.18,y+1.10,0,'leisure-shrine-upright');
    // Surface-facing observation points sit outside solid faces; no blocker is exempted.
    target('shrine-stone',[x-1.1,y+.60,z-.29]);target('social-tree',[x+.72,y+1.4,z+.05],8);
    const colors=[P.red,P.blue,'#D4BA66',P.ivory,'#749164'];
    for(let i=0;i<5;i++){
      const px=x-1.2+i*.53,py=y+3.65-(i%2)*.24,pz=z+.48;
      baker.beam([px,py,pz],[px+.09,py+.26,pz-.13],.016,P.dark,.014,4);
      ribbons.push({x:px,y:py,z:pz,length:.85+i*.10,color:colors[i],phase:i*1.7});
      if(i%2===0){baker.beam([px,py,pz],[px,py-.48,pz],.009,P.dark,.009,4);baker.block([px,py-.66,pz],[.17,.35,.045],P.cut);for(let k=0;k<3;k++)baker.block([px+.01*(k%2),py-.57-k*.075,pz+.026],[.06,.012,.006],P.dark);}
    }
    // Low stepped timber bench with splayed legs and stretcher rail outside roots; seated-looking actor handled by activity rig.
    baker.block([x+2.05,y+.45,z+.25],[.58,.06,1.36],P.cut);
    baker.block([x+2.05,y+.39,z+.25],[.50,.06,1.26],P.wood);
    for(const dz of [-.42,.82]){
      for(const dx of [-.18,.18])baker.beam([x+2.05+dx,surface(x+2.05+dx,z+dz)-.05,z+dz],[x+2.05+dx*.78,y+.40,z+dz],.045,P.dark,.040,5);
      baker.beam([x+1.87,y+.18,z+dz],[x+2.23,y+.18,z+dz],.028,P.dark,.028,4);
    }
    baker.beam([x+2.05,y+.18,z-.42],[x+2.05,y+.18,z+.82],.030,P.dark,.030,4);
    collider(x+2.05,z+.25,.31,.675,y,y+.49,0,'leisure-bench');station('elder',[x+2.10,y,z+1.25],Math.PI);
    station('child-grass',[x-2.6,y,z+.45],0);
    for(const [kind,dx,dz]of [['child-grass',-2.6,1.7],['child-stones',-.7,2.8],['child-top',1.3,2.9]]){
      const xx=x+dx,zz=z+dz,gy=surface(xx,zz);station(kind,[xx,gy,zz],Math.PI);
      if(kind==='child-top'){
        for(let k=0;k<16;k++){const a=k*TAU/16,b=(k+1)*TAU/16;baker.quad([xx+Math.cos(a)*.65,gy+.018,zz-1+Math.sin(a)*.65],[xx+Math.cos(b)*.65,gy+.018,zz-1+Math.sin(b)*.65],[xx+Math.cos(b)*.62,gy+.019,zz-1+Math.sin(b)*.62],[xx+Math.cos(a)*.62,gy+.019,zz-1+Math.sin(a)*.62],P.soil);}
      }else if(kind==='child-stones')for(let k=0;k<5;k++)baker.peach([xx+(k%3)*.14-.14,gy+.07,zz-.7-Math.floor(k/3)*.15],[.055,.045,.06],k%2?P.light:P.stone);
      else for(let k=0;k<5;k++)baker.leaf([xx+k*.04,gy+.03,zz-.7],[xx+.2+k*.04,gy+.07,zz-1.2],.02,P.young);
    }
  }
  function bridge(p){
    const {x,z}=p,pond=world.terrain.pond||{x:x+15,z,waterY:world.terrain.waterLevel,waterRadius:9};
    const dist=Math.hypot(x-pond.x,z-pond.z)||1,ux=(x-pond.x)/dist,uz=(z-pond.z)/dist,tx=-uz,tz=ux,rot=Math.atan2(tx,tz);
    const length=3.6,width=1.14,arch=.24,halfL=length*.5,halfW=width*.5,gMid=surface(x,z);
    // Sunken rocky spring brook with deep shaded pebble-bed center, mossy creek-bank stones, wet earth verges, and sedge/reeds.
    const rSpring=dist+3.8,rMouth=Math.max(4,(pond.waterRadius||9.2)-.35),nPts=10,pts=[];
    const rawY0=Math.max(surface(pond.x+ux*rSpring,pond.z+uz*rSpring)+.07,gMid+.11);
    for(let k=0;k<nPts;k++){
      const u=k/(nPts-1),rk=rSpring+(rMouth-rSpring)*u,lat=Math.sin(u*TAU)*Math.sin(u*Math.PI)*.30;
      const bx=pond.x+ux*rk+tx*lat,bz=pond.z+uz*rk+tz*lat,gy=surface(bx,bz);
      const lin=rawY0+(pond.waterY-rawY0)*u;
      let wy=k===0?rawY0:(k===nPts-1?pond.waterY:Math.max(pond.waterY+.04,Math.min(pts[k-1].y-.02,rk>=11.5?Math.max(gy+.026,lin):lin)));
      if(k>0&&k<nPts-1&&wy>=pts[k-1].y)wy=pts[k-1].y-.018;
      pts.push({x:bx,y:wy,z:bz,r:rk,width:1.02+u*.34,ux,uz,tx,tz});
    }
    let underBridgeWaterY=gMid+.035;
    for(let k=1;k<pts.length;k++){if(pts[k].r<=dist&&pts[k-1].r>=dist){const t=(dist-pts[k].r)/Math.max(1e-4,pts[k-1].r-pts[k].r);underBridgeWaterY=pts[k].y+(pts[k-1].y-pts[k].y)*t;break;}}
    const sidePt=(pt,d,dy=0)=>[pt.x+tx*d,pt.y+dy,pt.z+tz*d];
    const bankPt=(pt,s,d,dy)=>{const px=pt.x+tx*s*d,pz=pt.z+tz*s*d;return [px,dy===null?surface(px,pz)-.035:Math.max(surface(px,pz)+.012,pt.y+dy),pz];};
    for(let k=1;k<pts.length;k++){
      const a=pts[k-1],b=pts[k],wa=a.width*.5,wb=b.width*.5,ca=wa*.44,cb=wb*.44;
      // Deep shaded wet pebble-bed center (#3E5E58 / #4E746B) + glistening water thread + bank-shadow water margins
      baker.quad(sidePt(a,-ca,.003),sidePt(a,ca,.003),sidePt(b,cb,.003),sidePt(b,-cb,.003),k%2?'#3E5E58':'#456861');
      baker.quad(sidePt(a,-wa),sidePt(a,-ca,.003),sidePt(b,-cb,.003),sidePt(b,-wb),k%2?'#4E746B':'#466A61');
      baker.quad(sidePt(a,ca,.003),sidePt(a,wa),sidePt(b,wb),sidePt(b,cb,.003),k%2?'#4E746B':'#466A61');
      const ga=wa*.13*((k%2)?1:-1),gb=wb*.13*((k%2)?-1:1);
      baker.quad(sidePt(a,ga-.045,.007),sidePt(a,ga+.045,.007),sidePt(b,gb+.045,.007),sidePt(b,gb-.045,.007),'#7AA296');
      // Steep mossy stone creek-bank walls + wet earth verges (#647355) feathering cleanly into surrounding terrain
      for(const s of [-1,1]){
        const wallH=k<pts.length-1?.125:.065;
        baker.quad(bankPt(a,s,wa,0),bankPt(a,s,wa+.18,wallH),bankPt(b,s,wb+.18,wallH),bankPt(b,s,wb,0),k%2?'#6B7764':P.moss);
        baker.quad(bankPt(a,s,wa+.18,wallH),bankPt(a,s,wa+.44,.042),bankPt(b,s,wb+.44,.042),bankPt(b,s,wb+.18,wallH),'#5C6C50');
        baker.quad(bankPt(a,s,wa+.44,.042),bankPt(a,s,wa+.76,null),bankPt(b,s,wb+.76,null),bankPt(b,s,wb+.44,.042),'#647355');
      }
      // Wet pebbles inside the brook channel
      const mx=(a.x+b.x)*.5,my=(a.y+b.y)*.5,mz=(a.z+b.z)*.5,poff=((k*37)%7-3)*.09;
      baker.peach([mx+tx*poff,my+.012,mz+tz*poff],[.085,.032,.07],k%2?'#495F58':'#5B7068');
    }
    const sp=pts[0];
    // Springhead boulder cluster
    for(let j=0;j<6;j++){const ang=(j/5)*Math.PI*1.16-Math.PI*.08,bx=sp.x+ux*Math.cos(ang)*.72+tx*Math.sin(ang)*.80,bz=sp.z+uz*Math.cos(ang)*.72+tz*Math.sin(ang)*.80;baker.peach([bx,surface(bx,bz)+.09,bz],[.26,.17,.24],j%2?P.stone:P.moss);}
    // Raised mossy creek-bank stones & streamside sedge/reed blades along both banks from springhead to pond mouth
    for(let k=0;k<pts.length-1;k++){
      const pt=pts[k],u=k/(pts.length-1);
      for(const s of [-1,1]){
        if((k+ (s>0?1:0))%2===0||Math.abs(pt.r-dist)<1.4){
          const d=pt.width*.5+.18+((k*13)%3)*.05,cx=pt.x+tx*s*d,cz=pt.z+tz*s*d,gy=Math.max(surface(cx,cz),pt.y+.05);
          baker.peach([cx,gy+.055,cz],[.18+(k%2)*.05,.10,.15+(k%3)*.03],(k+s)%2?P.moss:P.stone);
        }
        const nearBridgeDeck=Math.abs(pt.r-dist)<.68;
        if(!nearBridgeDeck&&(k%2===0||k===pts.length-2)){
          const rd=pt.width*.5+.30,rx=pt.x+tx*s*rd+ux*(s*.06),rz=pt.z+tz*s*rd+uz*(s*.06),ry=Math.max(surface(rx,rz),pt.y+.03);
          for(let b=0;b<2;b++){
            const leanT=s*(.10+b*.09),leanU=(b-.5)*.14,bh=.38+((k+b)%3)*.11*(1+.15*u);
            baker.leaf([rx+ux*(b*.06),ry-.01,rz+uz*(b*.06)],[rx+tx*leanT+ux*leanU,ry+bh,rz+tz*leanT+uz*leanU],.042,(k+b)%2?P.leaf:P.young,'solid');
          }
        }
      }
    }
    for(let j=0;j<5;j++){const ang=-.75+j*.37,sx=sp.x+ux*.58+tx*ang,sz=sp.z+uz*.58+tz*ang,gy=surface(sx,sz);baker.leaf([sx,gy-.01,sz],[sx+tx*ang*.22,gy+.45,sz+tz*ang*.22],.052,j%2?P.young:P.leaf,'solid');}
    layout.brook={spring:{x:sp.x,y:sp.y,z:sp.z},mouth:{x:pts.at(-1).x,y:pts.at(-1).y,z:pts.at(-1).z},underBridgeWaterY,points:pts};
    const ends=[-1,1].map(s=>({x:x+tx*s*halfL,z:z+tz*s*halfL,y:surface(x+tx*s*halfL,z+tz*s*halfL)}));
    const endSpan=(u,rad)=>{const h=ends[0].y*(1-(u+1)*.5)+ends[1].y*((u+1)*.5)+.055+arch*(1-u*u);return [x+tx*u*halfL+ux*rad,h,z+tz*u*halfL+uz*rad];};
    // Stepped chamfered stone abutment slabs & flanking wing-curbs bedded firmly under both bridge ends
    const abutYaw=Math.atan2(ux,uz);
    for(const s of [-1,1]){
      const ey=ends[s<0?0:1].y,ax=x+tx*s*halfL,az=z+tz*s*halfL;
      baker.block([ax-tx*s*.08,ey-.05,az-tz*s*.08],[.58,.15,width+.48],'#747C70',[0,abutYaw,0]);
      baker.block([ax-tx*s*.02,ey+.015,az-tz*s*.02],[.40,.11,width+.32],P.stone,[0,abutYaw,0]);
      for(const ws of [-1,1]){
        const wx=ax-tx*s*.18+ux*ws*(halfW+.18),wz=az-tz*s*.18+uz*ws*(halfW+.18),wgy=surface(wx,wz);
        baker.beam([wx,Math.min(wgy,ey)-.06,wz],[wx,Math.max(wgy,ey)+.12,wz],.17,ws>0?P.light:P.moss,.13,6);
      }
    }
    const samples=[];
    for(let i=0;i<13;i++){
      const u0=-1+(i+.08)*2/13,u1=-1+(i+.92)*2/13,uMid=(u0+u1)*.5,top=endSpan(uMid,0)[1],bot=top-.062;
      const a0=endSpan(u0,-halfW),a1=endSpan(u1,-halfW),b1=endSpan(u1,halfW),b0=endSpan(u0,halfW);
      baker.quad(a0,a1,b1,b0,i%3?P.wood:P.cut);baker.quad([a0[0],bot,a0[2]],[b0[0],bot,b0[2]],[b1[0],bot,b1[2]],[a1[0],bot,a1[2]],P.dark);
      baker.quad(a0,[a0[0],bot,a0[2]],[a1[0],bot,a1[2]],a1,P.dark);baker.quad(b1,[b1[0],bot,b1[2]],[b0[0],bot,b0[2]],b0,P.dark);
      samples.push({x:x+tx*uMid*halfL,z:z+tz*uMid*halfL,u:uMid,terrain:field.sample(x+tx*uMid*halfL,z+tz*uMid*halfL),top,bottom:bot});
    }
    for(const rad of [-halfW+.06,halfW-.06])for(let k=0;k<4;k++){const p0=endSpan(-1+k*.5,rad),p1=endSpan(-1+(k+1)*.5,rad);baker.beam([p0[0],p0[1]-.05,p0[2]],[p1[0],p1[1]-.05,p1[2]],.045,P.dark,.045,4);}
    for(const rad of [-.64,.64]){
      for(const u of [-.95,0,.95]){const q=endSpan(u,rad),gy=surface(q[0],q[2]);baker.beam([q[0],Math.min(gy-.04,q[1]-.16),q[2]],[q[0],q[1]+.66,q[2]],.055,P.dark,.048,5);baker.block([q[0],q[1]+.68,q[2]],[.125,.055,.125],P.cut,[0,abutYaw,0]);collider(q[0],q[2],.065,.065,gy,q[1]+.68,0,'leisure-bridge-post');}
      for(let i=0;i<2;i++){const a=endSpan(-0.95+i*.95,rad),b=endSpan(-0.95+(i+1)*.95,rad);baker.beam([a[0],a[1]+.60,a[2]],[b[0],b[1]+.60,b[2]],.038,P.wood,.038,4);baker.beam([a[0],a[1]+.30,a[2]],[b[0],b[1]+.30,b[2]],.022,P.dark,.022,4);}
    }
    const midDeckBottomY=endSpan(0,0)[1]-.062;
    layout.bridge={x,z,rot,ux,uz,tx,tz,length,width,arch,underBridgeWaterY,midDeckBottomY,samples,ends,terrainSupported:false};target('timber-footbridge',[x,midDeckBottomY+.08,z]);
  }
  function bamboo(p){
    const {x,z}=p;
    for(let i=0;i<8;i++){
      const a=i*2.39996,r=.7+(i%3)*.32,xx=x+Math.cos(a)*r,zz=z+Math.sin(a)*r,gy=surface(xx,zz),h=3.7+(i%4)*.36,leanX=Math.cos(a)*.28,leanZ=Math.sin(a)*.28;
      collider(xx,zz,.06,.06,gy,gy+h,0,'leisure-bamboo-culm');
      for(let n=0;n<6;n++){
        const t=n/6,u=(n+1)/6,at=v=>[xx+leanX*v,gy+h*v,zz+leanZ*v];tube(at(t),at(u),.055*(1-t*.35),i%2?P.young:P.leaf,.055*(1-u*.35),5);tube(at(t+.006),at(t+.013),.068,P.cut,.068,5);
        if(n>3)for(const side of [-1,1]){
          const q=at(t),angle=a+side*.6,tip=[q[0]+Math.cos(angle)*.75,q[1]+.19,q[2]+Math.sin(angle)*.75];tube(q,tip,.015,P.young,.006,4,'foliage');
          for(let k=1;k<4;k++)for(const s of [-1,1]){const v=k/4,base=q.map((u,j)=>u+(tip[j]-u)*v),ang=angle+s*.8;baker.leaf(base,[base[0]+Math.cos(ang)*.36,base[1]-.04,base[2]+Math.sin(ang)*.36],.035,k%2?P.leaf:P.young);}
        }
      }
    }
    for(let i=0;i<5;i++){
      const xx=x-1.8+i*.42,zz=z+1.3+(i%2)*.22,gy=surface(xx,zz),h=.25+(i%3)*.13;
      baker.orb([xx,gy+.025,zz],[.29,.025,.23],P.soil,'solid',i);
      for(let n=0;n<4;n++){const t=n/4;baker.beam([xx,gy+t*h,zz],[xx,gy+(t+.25)*h,zz],.14*(1-t),n%2?P.cut:P.soil,.14*(.75-t),5);}
    }
    const xx=x+1.15,zz=z+1.6,gy=surface(xx,zz);baker.beam([xx-.2,gy+.06,zz],[xx+.35,gy+.70,zz],.025,P.wood,.023,5);baker.beam([xx+.05,gy+.73,zz],[xx+.59,gy+.43,zz],.042,'#777E72',.015,5);
    target('bamboo-shoot',[x-1.4,surface(x-1.4,z+1.3)+.2,z+1.3]);
  }
  function orchard(p){
    const a=tree(p,'plum',[-1.5,0],1),b=tree(p,'chestnut',[1.65,-.2],1.03);
    target('plum-tree',[a.x,a.y+2.9,a.z]);target('chestnut-tree',[b.x,b.y+3,b.z]);
    for(let k=0;k<5;k++){const xx=p.x-1.1+k*.22,zz=p.z+1.2+(k%2)*.14,gy=surface(xx,zz);baker.peach([xx,gy+.05,zz],[.06,.05,.06],k%2?'#A7717B':'#745840');}
  }
  function apiary(p){
    const {x,y,z}=p;
    for(let j=0;j<2;j++){
      const xx=x+(j-.5)*1.35,zz=z-.4;
      // Four-legged notched timber cradle frame (replaces chunky rectangular wall blocks)
      for(const dz of [-.32,.32]){
        for(const dx of [-.28,.28]){
          const fy=surface(xx+dx,zz+dz);
          baker.beam([xx+dx,fy-.05,zz+dz],[xx+dx*.82,y+.54,zz+dz],.048,P.dark,.042,5);
        }
        baker.beam([xx-.30,y+.40,zz+dz],[xx+.30,y+.40,zz+dz],.042,P.wood,.042,5);
      }
      for(const dx of [-.26,.26])baker.beam([xx+dx,y+.22,zz-.32],[xx+dx,y+.22,zz+.32],.032,P.dark,.032,4);
      // Hollow log sections with bark staves and a dark real cavity at the open end.
      for(let k=0;k<12;k++){
        const a=k*TAU/12,b=(k+1)*TAU/12,q=(t,along,r)=>[xx+Math.cos(t)*r,y+.78+Math.sin(t)*r,zz+along];
        baker.quad(q(a,-.48,.39),q(b,-.48,.39),q(b,.48,.39),q(a,.48,.39),k%2?P.dark:P.wood);
        baker.quad(q(a,.48,.39),q(b,.48,.39),q(b,.48,.29),q(a,.48,.29),P.cut);baker.quad(q(b,.48,.29),q(a,.48,.29),q(a,-.4,.29),q(b,-.4,.29),P.dark);
      }
      // Circular rear wood plug + two dark iron/rattan binding hoops
      baker.beam([xx,y+.78,zz-.46],[xx,y+.78,zz-.39],.36,P.dark,.36,10);
      for(const hz of [-.34,.34]){
        for(let k=0;k<12;k++){const a=k*TAU/12,b=(k+1)*TAU/12;baker.beam([xx+Math.cos(a)*.405,y+.78+Math.sin(a)*.405,zz+hz],[xx+Math.cos(b)*.405,y+.78+Math.sin(b)*.405,zz+hz],.016,P.dark,.016,4);}
      }
      for(let row=0;row<3;row++)for(let col=0;col<4;col++){
        const hx=xx+(col-1.5)*.107+(row%2)*.047,hy=y+.62+row*.092,hz=zz+.39,rad=.056;
        for(let k=0;k<6;k++){const a=k*TAU/6,b=(k+1)*TAU/6;baker.quad([hx+Math.cos(a)*rad,hy+Math.sin(a)*rad,hz],[hx+Math.cos(b)*rad,hy+Math.sin(b)*rad,hz],[hx+Math.cos(b)*rad*.68,hy+Math.sin(b)*rad*.68,hz-.015],[hx+Math.cos(a)*rad*.68,hy+Math.sin(a)*rad*.68,hz-.015],P.straw);}
        baker.tri([hx-.03,hy-.035,hz-.027],[hx+.03,hy-.035,hz-.027],[hx,hy+.035,hz-.027],'#A77E3D');
      }
      // Circular beveled wooden lid with twin battens & low bee entrance slit (no square slab!)
      if(j===1){
        baker.beam([xx,y+.78,zz+.48],[xx,y+.78,zz+.54],.385,P.cut,.37,12);
        for(const bx of [-.18,.18])baker.block([xx+bx,y+.78,zz+.555],[.042,.52,.022],P.dark);
        baker.block([xx,y+.49,zz+.555],[.14,.045,.026],'#2D241C');
      }
      // Rustic two-pitch bark gable rain-hood seated on twin timber cleats over each bee barrel
      for(const cz of [-.28,.28])baker.block([xx,y+1.18,zz+cz],[.09,.12,.06],P.dark);
      baker.block([xx-.24,y+1.26,zz],[.56,.038,1.08],P.thatch,[0,0,.30]);
      baker.block([xx+.24,y+1.26,zz],[.56,.038,1.08],P.bark,[0,0,-.30]);
      baker.beam([xx,y+1.34,zz-.55],[xx,y+1.34,zz+.55],.032,P.dark,.032,5);
      collider(xx,zz,.43,.52,y,y+1.18,0,'leisure-bee-barrel');
      for(let k=0;k<4;k++)bees.push({x:xx,y:y+.8,z:zz+.9,phase:j*4+k});
    }
    const actor=[x-.675,y,z+.83],lid=prop('hive-lid',[x-.675,y+.78,z+.13],'hive-lid',{x:0,y:y+.78-surface(x-.675,z+.83),z:.70},b=>{
      b.beam([0,0,-.03],[0,0,.03],.385,P.cut,.37,12);
      for(const k of [-.18,.18])b.block([k,0,.04],[.042,.52,.024],P.dark);
      b.block([0,-.28,.04],[.14,.045,.026],'#2D241C');
    });
    const s=station('beekeeper',actor,Math.PI,lid);if(s){const path=[];for(let i=0;i<7;i++){const pz=actor[2]+i*.1;path.push({x:actor[0],y:surface(actor[0],pz),z:pz});}s.path=path.reverse();}
    target('bee-barrel',[x-.675,y+.8,z+.08]);
  }

  if(complete&&world.leisureGrove?.enabled!==false){
    // The real pond remains untouched and fully reserved. Both leisure structures overlook it from dry ground.
    const pond=world.terrain.pond,pondside=(x,z)=>!!pond&&Math.hypot(x-pond.x,z-pond.z)<=23;
    const p=find('pavilion',pond?[[pond.x-17,pond.z-3.5],[pond.x+13,pond.z-11.5],[pond.x+17,pond.z+3.5],[pond.x-13,pond.z+11.5]]:[],3.25,4,pondside);buildSite(p,pavilion);
    const s=find('social-tree',[[-4.38,-109.58],[-7,-105],[76,-205]],4.9,24);buildSite(s,social);
    const f=find('footbridge',pond?[135,130,45,55,125,140].map(d=>[pond.x+Math.cos(d*Math.PI/180)*17.5,pond.z+Math.sin(d*Math.PI/180)*17.5]):[],2.1,4,pondside);buildSite(f,bridge);
    const b=find('bamboo',[[108,-106],[102,-184],[-19,-181]],2.7,22);buildSite(b,bamboo);
    const o=find('orchard',[[82,-201],[-5,-193],[101,-89]],4.15,23);buildSite(o,orchard);
    const a=find('apiary',o?[[o.x+7,o.z+4],[-15,-190]]:[[-15,-190]],2.1,24);buildSite(a,apiary);
    // A local spring catchment fed by the hillside, ending at a chimney-side kitchen wall.
    // Only this owning house's coarse house/porch disks are replaced by physical OBBs; walls, door corridors, other houses,
    // old props, groves, plots and every earlier round6 reservation remain checked.
    let chosen=null;
    for(const [houseIndex,h]of options.village.houseInfo.entries()){
      const c=Math.cos(h.rot),s=Math.sin(h.rot),local=(lx,lz)=>({x:h.x+lx*c+lz*s,z:h.z-lx*s+lz*c});
      const end=local(h.w*.24,-h.d/2-.9),ey=surface(end.x,end.z)+.62;
      const ctx={...context,reservations:{...context.reservations,circles:context.reservations.circles.filter(q=>q.source!=='house-'+houseIndex&&q.source!=='porch-'+houseIndex),boxes:[...context.reservations.boxes,{x:h.x,z:h.z,hw:h.w/2+.15,hd:h.d/2+.15,rot:h.rot,source:'own-house-physical'},{x:h.doorX,z:h.doorZ,hw:2,hd:1.7,rot:h.rot,source:'own-front-porch-physical'}]}};
      for(const len of [5.5,7,9,11])for(const bend of [-.8,0,.8]){
        const start=local(h.w*.24+bend,-h.d/2-.9-len),terrainY=surface(start.x,start.z);
        const sy=Math.max(ey+.24,terrainY+.22);
        if(sy-terrainY>1.4||sy-ey>2.1)continue;
        let valid=true;const points=[];
        const steps=Math.ceil(Math.hypot(end.x-start.x,end.z-start.z)/.10);
        for(let i=0;i<=steps;i++){
          const t=i/steps,x=start.x+(end.x-start.x)*t,z=start.z+(end.z-start.z)*t,y=sy+(ey-sy)*t;
          if(!safe(x,z,.22,ctx)||y<surface(x,z)+.08||y>surface(x,z)+1.6)valid=false;
          points.push({x,y,z});
        }
        if(!valid)continue;
        chosen={houseIndex,house:{x:h.x,z:h.z,rot:h.rot,w:h.w,d:h.d},start:{...start,y:sy},end:{...end,y:ey},points};break;
      }
      if(chosen)break;
    }
    if(chosen){
      layout.conduit=chosen;const {start,end,points}=chosen;
      const p=reserve('conduit',(start.x+end.x)/2,(start.z+end.z)/2,.22);
      for(const q of points)layout.reservations.push({x:q.x,z:q.z,radius:.48});
      // Open semicircular culm, with real interior and exterior and overwrapped node collars.
      const angle=Math.atan2(end.z-start.z,end.x-start.x),nx=-Math.sin(angle),nz=Math.cos(angle);
      for(let j=0;j<8;j++){
        const u=j/8,v=(j+1)/8,at=t=>[start.x+(end.x-start.x)*t,start.y+(end.y-start.y)*t,start.z+(end.z-start.z)*t],a=at(u),b=at(v);
        for(let k=0;k<6;k++){
          const q=k*Math.PI/6,r=(k+1)*Math.PI/6,point=(base,t,rad)=>[base[0]+nx*Math.cos(t)*rad,base[1]-Math.sin(t)*rad,base[2]+nz*Math.cos(t)*rad];
          baker.quad(point(a,q,.13),point(b,q,.13),point(b,r,.13),point(a,r,.13),P.cut);baker.quad(point(a,r,.16),point(b,r,.16),point(b,q,.16),point(a,q,.16),P.young);
          const collar=at(Math.min(v,u+.012));baker.quad(point(a,r,.174),point(collar,r,.174),point(collar,q,.174),point(a,q,.174),P.leaf);
        }
        for(const sign of [-1,1])baker.quad([a[0]+nx*.13*sign,a[1],a[2]+nz*.13*sign],[b[0]+nx*.13*sign,b[1],b[2]+nz*.13*sign],[b[0]+nx*.16*sign,b[1],b[2]+nz*.16*sign],[a[0]+nx*.16*sign,a[1],a[2]+nz*.16*sign],P.cut);
        if(j%2===0){
          // Lashed X-crossed bamboo A-frame crutches cradling the aqueduct
          const footL=[a[0]-nx*.24,surface(a[0]-nx*.24,a[2]-nz*.24)-.04,a[2]-nz*.24];
          const footR=[a[0]+nx*.24,surface(a[0]+nx*.24,a[2]+nz*.24)-.04,a[2]+nz*.24];
          baker.beam(footL,[a[0]+nx*.18,a[1]-.02,a[2]+nz*.18],.034,P.wood,.028,5);
          baker.beam(footR,[a[0]-nx*.18,a[1]-.02,a[2]-nz*.18],.034,P.wood,.028,5);
          baker.beam([a[0]-nx*.18,a[1]-.16,a[2]-nz*.18],[a[0]+nx*.18,a[1]-.16,a[2]+nz*.18],.024,P.dark,.024,4);
          collider(a[0],a[2],.055,.055,surface(a[0],a[2]),a[1]-.12,0,'leisure-conduit-support');
        }
      }
      // Grounded mossy boulder springhead cradling the catchment basin (no floating olive orb)
      const gy=surface(start.x,start.z);
      baker.beam([start.x,gy-.05,start.z],[start.x,start.y-.20,start.z],.48,'#7D8478',.42,8);
      baker.ring([start.x,start.y-.20,start.z],.44,.30,.20,P.stone,10);
      baker.beam([start.x,start.y-.14,start.z],[start.x,start.y-.13,start.z],.29,'#78998B',.29,10);
      for(const [ox,oz,rr,hh,col] of [[-.36,-.26,.28,.34,P.stone],[.34,-.28,.24,.24,P.moss],[-.24,.34,.22,.22,'#828A7D']]){
        const rx=start.x+ox,rz=start.z+oz,ry=surface(rx,rz);
        baker.beam([rx,ry-.06,rz],[rx,Math.max(ry+.18,start.y-.22+hh),rz],rr,col,rr*.72,6);
      }
      const endGround=surface(end.x,end.z);
      baker.beam([end.x,endGround-.04,end.z],[end.x,endGround+.12,end.z],.56,'#7D8478',.50,10);
      baker.ring([end.x,endGround+.10,end.z],.48,.35,.36,P.stone,10);baker.beam([end.x,endGround+.11,end.z],[end.x,endGround+.12,end.z],.35,'#78998B',.35,10);
      collider(start.x,start.z,.43,.43,gy,start.y+.42,0,'leisure-spring-catchment');collider(end.x,end.z,.48,.48,endGround,endGround+.46,0,'leisure-kitchen-basin');const middle=points[Math.floor(points.length/2)];target('bamboo-conduit',[middle.x,middle.y,middle.z]);
    }else layout.rejected.push({kind:'conduit',reason:'no clear downhill line to chimney-side house exterior'});
  }
  for(const [name,mat]of [['solid',solid],['foliage',foliage]])addMesh(baker.finish(name,mat));baker.dispose();
  // One double-sided dynamic batch for five woven ribbons, eight bounded bees, and pipe drips.
  const moving=createGroveBaker();
  const movingParts=[];
  for(const [i,r]of ribbons.entries()){
    const begin=moving.batches.get('motion')?.position.length||0;
    for(let k=0;k<9;k++)moving.quad([r.x-.055,r.y-r.length*k/9,r.z],[r.x+.055,r.y-r.length*k/9,r.z],[r.x+.055,r.y-r.length*(k+1)/9,r.z],[r.x-.055,r.y-r.length*(k+1)/9,r.z],r.color,'motion');
    movingParts.push({type:'ribbon',start:begin/3,count:(moving.batches.get('motion').position.length-begin)/3,anchor:r});
  }
  for(const b of bees){const begin=moving.batches.get('motion')?.position.length||0;
    moving.peach([0,0,0],[.055,.034,.032],'#C7A34E','motion');moving.block([-.01,0,0],[.019,.065,.065],P.dark,[0,0,0],'motion');moving.leaf([0,.02,0],[.04,.04,.09],.025,P.ivory,'motion');moving.leaf([0,.02,0],[.04,.04,-.09],.025,P.ivory,'motion');movingParts.push({type:'bee',start:begin/3,count:(moving.batches.get('motion').position.length-begin)/3,anchor:b});}
  if(layout.conduit)for(let i=0;i<5;i++){const begin=moving.batches.get('motion')?.position.length||0;moving.peach([0,0,0],[.025,.045,.025],'#98BEB0','motion');movingParts.push({type:'water',start:begin/3,count:(moving.batches.get('motion').position.length-begin)/3,phase:i/5});}
  if(layout.brook)for(let i=0;i<4;i++){const begin=moving.batches.get('motion')?.position.length||0;moving.peach([0,0,0],[.045,.018,.035],'#CBE0D6','motion');movingParts.push({type:'brook',start:begin/3,count:(moving.batches.get('motion').position.length-begin)/3,phase:i/4});}
  const motion=addMesh(moving.finish('motion',motionMat));moving.dispose();icoBase.dispose();
  let base;if(motion){
    const motionBox=new THREE.Box3(),mp=new THREE.Vector3();
    for(const r of ribbons){motionBox.expandByPoint(mp.set(r.x,r.y,r.z));motionBox.expandByPoint(mp.set(r.x,r.y-r.length,r.z));}
    for(const b of bees)motionBox.expandByPoint(mp.set(b.x,b.y,b.z));
    if(layout.conduit){motionBox.expandByPoint(mp.set(layout.conduit.start.x,layout.conduit.start.y,layout.conduit.start.z));motionBox.expandByPoint(mp.set(layout.conduit.end.x,layout.conduit.end.y,layout.conduit.end.z));}
    if(layout.brook)for(const p of layout.brook.points)motionBox.expandByPoint(mp.set(p.x,p.y,p.z));
    if(!motionBox.isEmpty()){motionBox.expandByScalar(1.2);motion.geometry.boundingSphere=motionBox.getBoundingSphere(new THREE.Sphere());motion.frustumCulled=true;}
    else motion.frustumCulled=false;
    motion.castShadow=false;base=Float32Array.from(motion.geometry.attributes.position.array);motion.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  }
  let beeActivity=1;
  function animate(){
    if(!motion)return;const position=motion.geometry.attributes.position,arr=position.array;
    for(const part of movingParts){
      const end=part.start+part.count;
      if(part.type==='ribbon'){
        const r=part.anchor,ry=r.y,invLen=1/r.length,t17=time*1.7+r.phase,t11=time*1.1+r.phase;
        for(let k=part.start;k<end;k++){const i3=k*3,x=base[i3],y=base[i3+1],z=base[i3+2],t=(ry-y)*invLen;arr[i3]=x+Math.sin(t11+t)*.035*t;arr[i3+1]=y;arr[i3+2]=z+Math.sin(t17+t*3)*.10*t;}
      }else if(part.type==='bee'){
        const b=part.anchor,a=time*.95+b.phase*1.9,orbit=beeActivity,dx=Math.cos(a)*(.30+(b.phase%3)*.08)*orbit,dz=Math.sin(a*1.3)*.34*orbit,dy=Math.sin(a*1.7)*.15*orbit-(1-orbit)*.12,bx=b.x+dx,by=b.y+dy,bz=b.z+dz;
        for(let k=part.start;k<end;k++){const i3=k*3;arr[i3]=bx+base[i3]*orbit;arr[i3+1]=by+base[i3+1]*orbit;arr[i3+2]=bz+base[i3+2]*orbit;}
      }else if(part.type==='brook'){
        const pts=layout.brook.points,f=((time*.24+part.phase)*(pts.length-1))%(pts.length-1),j=Math.floor(f),a=pts[j],b=pts[j+1],u=f-j,ox=a.x+(b.x-a.x)*u,oy=a.y+(b.y-a.y)*u+.018,oz=a.z+(b.z-a.z)*u;
        for(let k=part.start;k<end;k++){const i3=k*3;arr[i3]=base[i3]+ox;arr[i3+1]=base[i3+1]+oy;arr[i3+2]=base[i3+2]+oz;}
      }else{
        const c=layout.conduit,t=(time*.28+part.phase)%1,ox=c.start.x+(c.end.x-c.start.x)*t,oy=c.start.y+(c.end.y-c.start.y)*t-.06,oz=c.start.z+(c.end.z-c.start.z)*t;
        for(let k=part.start;k<end;k++){const i3=k*3;arr[i3]=base[i3]+ox;arr[i3+1]=base[i3+1]+oy;arr[i3+2]=base[i3+2]+oz;}
      }
    }
    position.needsUpdate=true;
  }
  animate();
  function getStats(){let triangles=0;for(const m of meshes)triangles+=(m.geometry.index?.count||m.geometry.attributes.position.count)/3;return {regions:Object.fromEntries(layout.regions.map(r=>[r.kind,1])),triangles,drawCalls:meshes.length,targets:targets.length,stations:stations.length,bees:bees.length,ribbons:ribbons.length,time,disposed,degraded:!complete,limits:{triangles:15000,drawCalls:16},counts:{tables:layout.board?1:0,stools:layout.board?4:0,teaBowls:layout.board?2:0,peachBowl:layout.board?1:0,peaches:layout.board?3:0,bambooShoots:layout.regions.some(r=>r.kind==='bamboo')?5:0,ancientTrees:ribbons.length?1:0,posts:layout.regions.some(r=>r.kind==='pavilion')?4:0,boardPieces:layout.board?.pieces||0,fruitTrees:layout.regions.some(r=>r.kind==='orchard')?2:0,bambooCulms:layout.regions.some(r=>r.kind==='bamboo')?8:0,beeBarrels:bees.length?2:0}};}
  return {group,blockers,targets,stations,layout,update(dt,_elapsed,sky){if(disposed||!Number.isFinite(dt)||dt<=0)return;const step=Math.min(dt,.1);time+=step;const sv=sky?.getAppearance?.()||sky;const night=sv?.nightAmount??sv?.night??(sv?.day===0?1:0);const rain=sv?.rain??0;beeActivity+=((night>=.55||rain>=.35?0:1)-beeActivity)*Math.min(1,step*2.5);if(group.visible)animate();},getStats,dispose(){if(disposed)return;disposed=true;for(const mesh of meshes)mesh.geometry.dispose();for(const mat of materials)mat.dispose();group.removeFromParent();}};
}
