import * as THREE from 'three';

// All decoration is baked by material, never one mesh per leaf, knot, or roof straw.
export function createGroveBaker() {
  const batches = new Map(), owned = [];
  const boxTemplate=new THREE.BoxGeometry(1,1,1),box=boxTemplate.toNonIndexed();boxTemplate.dispose();
  const fruit = new THREE.IcosahedronGeometry(1,0);
  owned.push(box,fruit);
  const color = new THREE.Color(), point = new THREE.Vector3(), matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion(), scale = new THREE.Vector3(), up = new THREE.Vector3(0,1,0);
  function sink(name='solid') { if(!batches.has(name))batches.set(name,{position:[],color:[]});return batches.get(name); }
  function tri(a,b,c,ink,batch='solid') {
    const s=sink(batch);color.set(ink);s.position.push(...a,...b,...c);
    for(let i=0;i<3;i++)s.color.push(color.r,color.g,color.b);
  }
  function quad(a,b,c,d,ink,batch='solid') {tri(a,b,c,ink,batch);tri(a,c,d,ink,batch);}
  function add(geometry,position,sizes,ink,rotation=[0,0,0],batch='solid') {
    const s=sink(batch),p=geometry.attributes.position,index=geometry.index;
    quat.setFromEuler(new THREE.Euler(...rotation));matrix.compose(new THREE.Vector3(...position),quat,scale.set(...sizes));color.set(ink);
    for(let i=0;i<(index?.count||p.count);i++){point.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(matrix);s.position.push(point.x,point.y,point.z);s.color.push(color.r,color.g,color.b);}
  }
  function block(p,s,c,rot=[0,0,0],batch) { add(box,p,s,c,rot,batch); }
  function orb(p,s,c,batch='foliage',seed=0) {
    // Asymmetric faceted lobes give clustered, broad leaf-cloud crowns rather than perfect spheres.
    const g=new THREE.SphereGeometry(1,7,4),a=g.attributes.position;
    for(let i=0;i<a.count;i++){const x=a.getX(i),y=a.getY(i),z=a.getZ(i),k=1+0.10*Math.sin(x*7+z*5+seed)+0.07*Math.sin(y*9-seed);a.setXYZ(i,x*k,y*k,z*k);}
    add(g,p,s,c,[0,seed,0],batch);g.dispose();
  }
  function peach(p,s,c,batch='solid') {add(fruit,p,s,c,[0,0.3,0],batch);}
  function beam(a,b,r,c,top=r,segments=7,batch='solid') {
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),v=bv.clone().sub(av),g=new THREE.CylinderGeometry(top,r,v.length(),segments,1,false);
    quat.setFromUnitVectors(up,v.clone().normalize());const e=new THREE.Euler().setFromQuaternion(quat);add(g,av.add(bv).multiplyScalar(.5).toArray(),[1,1,1],c,e.toArray().slice(0,3),batch);g.dispose();
  }
  function ring(p,outer,inner,height,c,segments=10,batch='solid') {
    for(let i=0;i<segments;i++){const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments;
      const q=(r,y,t)=>[p[0]+Math.cos(t)*r,p[1]+y,p[2]+Math.sin(t)*r];
      quad(q(outer,0,a),q(outer,0,b),q(outer,height,b),q(outer,height,a),c,batch);
      quad(q(outer,height,a),q(outer,height,b),q(inner,height,b),q(inner,height,a),c,batch);
      quad(q(inner,height,a),q(inner,height,b),q(inner,0,b),q(inner,0,a),c,batch);
    }
  }
  function bowl(p,r,c) {
    const profile=[[r*.38,0],[r*.65,r*.12],[r,r*.55],[r*.84,r*.58],[r*.48,r*.16]];
    for(let j=1;j<profile.length;j++)for(let i=0;i<10;i++){const a=i*Math.PI/5,b=(i+1)*Math.PI/5,q=(k,t)=>[p[0]+Math.cos(t)*profile[k][0],p[1]+profile[k][1],p[2]+Math.sin(t)*profile[k][0]];quad(q(j-1,a),q(j-1,b),q(j,b),q(j,a),c);}
    beam([p[0],p[1]+r*.12,p[2]],[p[0],p[1]+r*.14,p[2]],r*.48,'#596443',r*.48,10);
  }
  function leaf(a,b,w,c,batch='foliage') {
    const dx=b[0]-a[0],dz=b[2]-a[2],len=Math.hypot(dx,dz)||1,mid=a.map((v,i)=>v+(b[i]-v)*.46),side=[-dz/len*w,0,dx/len*w];
    const l=mid.map((v,i)=>v+side[i]),r=mid.map((v,i)=>v-side[i]),ridge=[mid[0],mid[1]+w*.25,mid[2]];
    tri(a,l,ridge,c,batch);tri(l,b,ridge,c,batch);tri(a,ridge,r,c,batch);tri(ridge,b,r,c,batch);
  }
  function finish(name,material) {
    const s=batches.get(name);if(!s?.position.length)return null;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(s.position,3));g.setAttribute('color',new THREE.Float32BufferAttribute(s.color,3));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,material);mesh.name='leisure-grove-'+name;mesh.castShadow=false;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;mesh.updateMatrix();return mesh;
  }
  return {tri,quad,add,block,orb,peach,beam,ring,bowl,leaf,finish,batches,dispose(){for(const g of owned)g.dispose();}};
}
