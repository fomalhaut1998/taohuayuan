import * as THREE from 'three';

// Small authored surfaces, baked into a handful of coloured batches. All buffers
// belong to the caller; no shared source geometries, textures or RNG are touched.
export class PondGeometry {
  constructor(){this.positions=[];this.colors=[];}
  tri(a,b,c,color){const ink=color?.isColor?color:new THREE.Color(color);this.positions.push(...a,...b,...c);for(let k=0;k<3;k++)this.colors.push(ink.r,ink.g,ink.b);}
  quad(a,b,c,d,color){this.tri(a,b,c,color);this.tri(a,c,d,color);}
  box(x,y,z,w,h,d,color){const a=[x-w/2,y,z-d/2],b=[x+w/2,y,z-d/2],c=[x+w/2,y,z+d/2],e=[x-w/2,y,z+d/2],up=p=>[p[0],p[1]+h,p[2]];this.quad(a,e,c,b,color);this.quad(up(a),up(b),up(c),up(e),color);for(const [p,q] of [[a,b],[b,c],[c,e],[e,a]])this.quad(p,q,up(q),up(p),color);}
  rod(a,b,r,color,sides=5,endRadius=r){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),dir=bv.clone().sub(av).normalize(),u=new THREE.Vector3(0,1,0);if(Math.abs(dir.y)>.95)u.set(1,0,0);u.cross(dir).normalize();const v=dir.clone().cross(u),ring=(p,rad,i)=>p.clone().addScaledVector(u,Math.cos(i*Math.PI*2/sides)*rad).addScaledVector(v,Math.sin(i*Math.PI*2/sides)*rad).toArray();for(let i=0;i<sides;i++){this.quad(ring(av,r,i),ring(bv,endRadius,i),ring(bv,endRadius,i+1),ring(av,r,i+1),color);this.tri(a,ring(av,r,i+1),ring(av,r,i),color);this.tri(b,ring(bv,endRadius,i),ring(bv,endRadius,i+1),color);}}
  ellipsoid(x,y,z,rx,ry,rz,color,sides=10,rings=5){const point=(i,j)=>{const a=j*Math.PI*2/sides,b=-Math.PI/2+i*Math.PI/rings;return [x+Math.cos(a)*Math.cos(b)*rx,y+Math.sin(b)*ry,z+Math.sin(a)*Math.cos(b)*rz];};for(let i=0;i<rings;i++)for(let j=0;j<sides;j++){if(i>0)this.tri(point(i,j),point(i+1,j),point(i,j+1),color);if(i<rings-1)this.tri(point(i,j+1),point(i+1,j),point(i+1,j+1),color);}}
  vessel(x,y,z,profile,color,sides=16){for(let j=0;j<sides;j++)for(let k=1;k<profile.length;k++){const p=profile[k-1],q=profile[k],a=j*Math.PI*2/sides,b=(j+1)*Math.PI*2/sides,at=(v,t)=>[x+Math.cos(t)*v[0],y+v[1],z+Math.sin(t)*v[0]],ink=new THREE.Color(color).multiplyScalar(j%2?.93:1);this.quad(at(p,a),at(q,a),at(q,b),at(p,b),ink);}}
  leaf(x,y,z,r,angle,color){const center=[x,y+.025,z];for(let i=0;i<18;i++){const a=angle+.20+i*(Math.PI*2-.40)/18,b=angle+.20+(i+1)*(Math.PI*2-.40)/18,at=t=>[x+Math.cos(t)*r*(1+.045*Math.sin(t*3)),y+.008+Math.sin(t*2)*.018,z+Math.sin(t)*r];this.tri(center,at(b),at(a),new THREE.Color(color).multiplyScalar(.94+.06*Math.cos(a)));if(i%3===0)this.rod(center,[x+Math.cos(a)*r*.88,y+.028,z+Math.sin(a)*r*.88],.006,'#99AD6A',3,.002);}}
  petal(root,angle,length,width,lift,color){const dx=Math.cos(angle),dz=Math.sin(angle),x=root[0],y=root[1],z=root[2],a=[x,y,z],m=[x+dx*length*.56,y+lift*.28,z+dz*length*.56],tip=[x+dx*length,y+lift,z+dz*length],l=[m[0]-dz*width,y+lift*.20,m[2]+dx*width],r=[m[0]+dz*width,y+lift*.20,m[2]-dx*width];this.tri(a,l,m,color);this.tri(a,m,r,color);this.tri(l,tip,m,new THREE.Color(color).multiplyScalar(1.07));this.tri(m,tip,r,color);}
  geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.colors,3));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;}
}

export function carpGeometry(tail=false){const b=new PondGeometry();if(tail){b.quad([-.025,.03,0],[-.21,.17,-.32],[0,.02,-.24],[.21,-.12,-.32],'#A86C46');b.tri([0,.02,-.24],[-.21,.17,-.32],[0,0,-.38],'#DCAC74');return b.geometry();}
  b.ellipsoid(0,0,0,.145,.20,.53,'#B18B60',10,5);b.ellipsoid(0,-.035,.32,.125,.125,.21,'#C6AE7B',8,4);
  b.tri([0,.13,.22],[0,.34,-.12],[0,.12,-.38],'#967552');
  for(const s of [-1,1]){b.tri([s*.11,-.07,.17],[s*.32,-.16,.06],[s*.10,-.11,-.08],'#BD9262');b.ellipsoid(s*.115,.05,.40,.024,.028,.028,'#252F29',6,3);b.rod([s*.045,-.08,.50],[s*.09,-.13,.61],.008,'#AE9568',3,.002);}
  // Irregular pale scale patches distinguish these bronze carp from old fish.
  for(let i=0;i<7;i++)for(const s of [-1,1])b.quad([s*.139,-.03,-.31+i*.085],[s*.145,.02,-.28+i*.085],[s*.138,.065,-.31+i*.085],[s*.14,.015,-.35+i*.085],i%3?'#B79A6B':'#D0BA8B');return b.geometry();
}
export function shrimpGeometry(){const b=new PondGeometry();for(let k=0;k<6;k++){const z=.16-k*.063,y=Math.pow(k/5,2)*.06;b.ellipsoid(0,y,z,.045*(1-k*.08),.043*(1-k*.06),.052,'#879E83',6,3);for(const s of [-1,1])if(k<4)b.rod([s*.025,y-.015,z],[s*(.08+k*.006),-.06,z-.05],.005,'#B8C2A0',3,.002);}
  for(const s of [-1,1]){b.rod([s*.025,.01,.20],[s*.16,.055,.43],.004,'#D2CFAD',3,.001);b.ellipsoid(s*.04,.035,.20,.014,.014,.015,'#2C463A',5,3);b.tri([0,.06,-.17],[s*.085,.08,-.25],[s*.03,.08,-.29],'#A4B59A');}return b.geometry();}
export function dragonflyGeometry(wings=false){const b=new PondGeometry();if(wings){for(const s of [-1,1])for(const z of [-.07,.055]){const root=[s*.025,0,z],tip=[s*.44,.018,z-.08],a=[s*.25,.018,z+.07],c=[s*.28,.012,z-.13];b.quad(root,a,tip,c,'#CAD5B0');b.rod(root,tip,.005,'#91A99D',3,.002);}return b.geometry();}
  b.ellipsoid(0,0,.06,.045,.045,.08,'#497F79',8,4);b.rod([0,-.005,0],[0,-.18,-.40],.024,'#568E89',6,.006);for(let j=1;j<6;j++)b.ellipsoid(0,-j*.028,-j*.064,.025-j*.002,.017,.013,'#314F4D',6,3);for(const s of [-1,1]){b.ellipsoid(s*.036,.01,.13,.032,.032,.03,'#9BAC5D',6,3);b.rod([s*.018,-.015,.035],[s*.07,-.075,-.02],.005,'#384F47',3,.002);}return b.geometry();}
export function rippleGeometry(){const b=new PondGeometry();for(let i=0;i<40;i++){const a=i*Math.PI/20,c=(i+1)*Math.PI/20,p=(t,r)=>[Math.cos(t)*r,0,Math.sin(t)*r];b.quad(p(a,.97),p(c,.97),p(c,1),p(a,1),'#C2D1B8');}return b.geometry();}
