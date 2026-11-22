import * as THREE from 'three';

// All three sinks are immutable opaque vertex-colour geometry; no animated material or per-prop draws.
export function buildExteriorGeometry(layout,field,cfg) {
  const group=new THREE.Group();group.name='exterior-exploration';
  const sinks={ground:[],solid:[],botanical:[]},blockers=[],details=[];
  const palette={earth:'#B79E78',edge:'#91815D',petal:'#DDB3AA',stone:'#919583',stoneLight:'#B2B39D',
    bark:'#79644C',wood:'#C1A079',moss:'#71835C',leaf:'#668357',leafLight:'#97A572',flower:'#D3BC9B'};
  const colors=Object.fromEntries(Object.entries(palette).map(([k,v])=>[k,new THREE.Color(v)]));
  const count=()=>Object.values(sinks).reduce((n,p)=>n+p.length/18,0);
  // Player physics is bilinear, the PlaneGeometry is triangulated. Rest dressing on the higher surface.
  function surface(x,z){
    const sampled=field.sample(x,z);
    if(!field.heights||!field.step)return sampled;
    const fx=(x+field.half)/field.step,fz=(z+field.half)/field.step,ix=Math.floor(fx),iz=Math.floor(fz),s=field.segments+1;
    if(ix<0||iz<0||ix>=field.segments||iz>=field.segments)return sampled;
    const u=fx-ix,v=fz-iz,a=field.heights[iz*s+ix],b=field.heights[iz*s+ix+1],c=field.heights[(iz+1)*s+ix],d=field.heights[(iz+1)*s+ix+1];
    const rendered=u+v<=1?a*(1-u-v)+b*u+c*v:d*(u+v-1)+b*(1-v)+c*(1-u);
    return Math.max(sampled,rendered);
  }
  const point=(x,z,y=0)=>[x,surface(x,z)+y,z];
  function tri(s,a,b,c,color){s.push(...a,color.r,color.g,color.b,...b,color.r,color.g,color.b,...c,color.r,color.g,color.b);}
  function quad(s,a,b,c,d,color){tri(s,a,b,c,color);tri(s,a,c,d,color);}
  function local(item,x,y,z){const co=Math.cos(item.rot),si=Math.sin(item.rot);return point(item.x+x*co+z*si,item.z-x*si+z*co,y);}
  function rock(item,x,z,sx,sy,sz){
    const s=sinks.solid,p=[];
    for(let i=0;i<6;i++){const a=i*Math.PI/3;p.push(local(item,x+Math.cos(a)*sx,0.05,z+Math.sin(a)*sz));}
    const top=local(item,x,sy,z);
    for(let i=0;i<6;i++)tri(s,p[i],p[(i+1)%6],top,i<3?colors.stoneLight:colors.stone);
  }
  // Shared cross-sections form one worn ribbon, not individually sized half-metre tiles.
  // Normalised bend bisectors (not extended mitres) stay inside the validated route half-width.
  for(const route of layout.paths){
    const stations=[];let distance=0;
    for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1],b=route.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(len<1e-8)continue;
      if(!stations.length)stations.push({x:a[0],z:a[1],d:0});
      const n=Math.ceil(len/0.5);
      for(let j=1;j<=n;j++)stations.push({x:a[0]+(b[0]-a[0])*j/n,z:a[1]+(b[1]-a[1])*j/n,d:distance+len*j/n});
      distance+=len;
    }
    const sections=stations.map((s,i)=>{
      const previous=stations[Math.max(0,i-1)],next=stations[Math.min(stations.length-1,i+1)];
      const before=Math.hypot(s.x-previous.x,s.z-previous.z)||1,after=Math.hypot(next.x-s.x,next.z-s.z)||1;
      let dx=(s.x-previous.x)/before+(next.x-s.x)/after,dz=(s.z-previous.z)/before+(next.z-s.z)/after;
      const length=Math.hypot(dx,dz)||1;dx/=length;dz/=length;
      const taper=0.6+0.4*Math.min(1,Math.min(s.d,distance-s.d)/1.8);
      const w=route.width/2*(0.83+0.07*Math.sin(s.x*0.23+s.z*0.17))*taper;
      return [point(s.x+dz*w,s.z-dx*w,0.075),point(s.x-dz*w,s.z+dx*w,0.075)];
    });
    for(let i=1;i<sections.length;i++){
      const [left,right]=sections[i-1],[nextLeft,nextRight]=sections[i];
      // One restrained earth tone: no periodic dark cross-bands or artificial pink waypoint squares.
      quad(sinks.ground,left,right,nextRight,nextLeft,colors.earth);
    }
  }
  for(const stop of layout.stops){
    const center=point(stop.x,stop.z,0.085);
    for(let j=0;j<12;j++){
      const a=j*Math.PI/6,b=(j+1)*Math.PI/6,r=stop.radius*0.95;
      tri(sinks.ground,center,point(stop.x+Math.cos(b)*r,stop.z+Math.sin(b)*r,0.085),point(stop.x+Math.cos(a)*r,stop.z+Math.sin(a)*r,0.085),colors.earth);
    }
  }
  const essential=count();
  if(essential>cfg.maxTriangles)throw new Error('Exterior essential route geometry exceeds triangle budget');
  for(const item of layout.nature){
    // Optional dressing degrades honestly at the budget, never drops validated navigation or changes old geometry.
    if(count()+180>cfg.maxTriangles)break;
    const before=count(),starts=Object.fromEntries(Object.entries(sinks).map(([key,s])=>[key,s.length/6]));
    if(item.kind==='waystone'){
      rock(item,0,0,0.55,1.35,0.35);rock(item,0.35,0.08,0.25,0.22,0.23);
      quad(sinks.botanical,local(item,-0.3,0.13,-0.27),local(item,0.28,0.13,-0.27),local(item,0.2,0.2,0.08),local(item,-0.25,0.2,0.08),colors.moss);
      blockers.push({x:item.x,z:item.z,hw:0.62,hd:0.4,rot:item.rot,minY:item.y-0.1,maxY:item.y+1.5,source:'exterior-'+item.id});
    }else if(item.kind==='fallen-log'){
      const ends=[[],[]];
      for(let side=0;side<2;side++)for(let j=0;j<7;j++){
        const a=j*Math.PI*2/7;ends[side].push(local(item,side?1.2:-1.2,0.28+Math.sin(a)*0.23,Math.cos(a)*0.23));
      }
      for(let j=0;j<7;j++)quad(sinks.solid,ends[0][j],ends[1][j],ends[1][(j+1)%7],ends[0][(j+1)%7],j<3?colors.bark:colors.wood);
      for(let side=0;side<2;side++)for(let j=0;j<7;j++)tri(sinks.solid,local(item,side?1.2:-1.2,0.28,0),ends[side][j],ends[side][(j+1)%7],colors.wood);
      quad(sinks.botanical,local(item,-0.95,0.48,-0.12),local(item,0.85,0.48,-0.12),local(item,0.8,0.51,0.13),local(item,-0.8,0.51,0.13),colors.moss);
      blockers.push({x:item.x,z:item.z,hw:1.22,hd:0.25,rot:item.rot,minY:item.y-0.1,maxY:item.y+0.65,source:'exterior-'+item.id});
    }else{
      if(item.kind==='fern-rock')rock(item,0.04,0.05,0.28,0.32,0.24);
      for(let j=0;j<7;j++){
        const a=j*Math.PI*2/7+item.rot,h=0.3+0.18*(j%3)/2,ex=Math.cos(a)*0.61,ez=Math.sin(a)*0.61;
        for(let k=1;k<=3;k++){
          const t=k/3,px=ex*t,pz=ez*t,y=h*Math.sin(t*Math.PI*0.7),w=0.13*(1-t*0.7),ox=-Math.sin(a)*w,oz=Math.cos(a)*w;
          tri(sinks.botanical,local(item,ex*(t-0.24),y*0.65,ez*(t-0.24)),local(item,px+ox,y,pz+oz),local(item,px,y+0.04,pz),j%2?colors.leaf:colors.leafLight);
          tri(sinks.botanical,local(item,ex*(t-0.24),y*0.65,ez*(t-0.24)),local(item,px,y+0.04,pz),local(item,px-ox,y,pz-oz),j%2?colors.leafLight:colors.leaf);
        }
        if(item.kind==='flowers'){
          const x=Math.cos(a)*0.35,z=Math.sin(a)*0.35,y=h+0.08,r=0.09;
          quad(sinks.botanical,local(item,x-r,y,z-r),local(item,x+r,y,z-r),local(item,x+r,y,z+r),local(item,x-r,y,z+r),colors.flower);
        }
      }
      if(item.kind==='fern-rock')blockers.push({x:item.x,z:item.z,hw:0.32,hd:0.29,rot:item.rot,minY:item.y-0.1,maxY:item.y+0.43,source:'exterior-'+item.id});
    }
    const geometryRanges=Object.fromEntries(Object.entries(sinks).map(([key,s])=>[key,{start:starts[key],count:s.length/6-starts[key]}]));
    const blocker=blockers.find(b=>b.source==='exterior-'+item.id);
    if(blocker){
      let minY=Infinity,maxY=-Infinity;
      for(let i=starts.solid*6;i<sinks.solid.length;i+=6){minY=Math.min(minY,sinks.solid[i+1]);maxY=Math.max(maxY,sinks.solid[i+1]);}
      blocker.minY=minY-0.1;blocker.maxY=maxY+0.05;
    }
    details.push({...item,triangles:count()-before,geometryRanges});
  }
  for(const [name,packed] of Object.entries(sinks)){
    if(!packed.length)continue;
    const p=[],c=[];
    for(let i=0;i<packed.length;i+=6){p.push(packed[i],packed[i+1],packed[i+2]);c.push(packed[i+3],packed[i+4],packed[i+5]);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(c,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const mat=new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geometry,mat);mesh.name='exterior-exploration-'+name;mesh.matrixAutoUpdate=false;mesh.updateMatrix();group.add(mesh);
  }
  let disposed=false;
  return {group,blockers,details,getStats:()=>({triangles:count(),drawCalls:group.children.length,essentialTriangles:essential,
    renderedNature:details.length,budget:cfg.maxTriangles}),dispose(){if(disposed)return;disposed=true;group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}};
}
