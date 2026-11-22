import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createPeople } from '../src/world/people.js';
import { createFauna } from '../src/systems/fauna.js';
import { livingStep, awayVector, sightClear, safeSegment, createEncounter, encounterEvent, capsuleProfile, capsuleGap } from '../src/systems/living-behavior.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const field = { sample: () => 2 };
const wall = { x: 1, z: 0, hw: 0.15, hd: 2, rot: 0 };
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
function tick(actor, seconds, x = 1000, z = 1000, context = {}) {
  for (let i=0; i<Math.ceil(seconds/0.05); i++) actor.update(0.05, i*0.05, x, z, context);
}
function dispose(actor) { const mats=new Set(); for(const m of actor.group.children) {m.geometry.dispose(); mats.add(m.material);} for(const m of mats)m.dispose(); }
const houses = [{x:27,z:4,doorX:27,doorZ:1.2,rot:0},{x:8,z:9,doorX:8,doorZ:6,rot:0}];
const road = { total:60, at: at=>({x:at,z:0,nx:0,nz:1}) };
const makePeople = (blockers=[]) => createPeople(structuredClone(world.people),field,houses,road,[[12,5],[15,5]],blockers);
function makeAnimal(kind,context={}) {
  const cfg=structuredClone(world.fauna);
  cfg.species=cfg.species.filter(s=>s.kind===kind);
  cfg.pauseRange=[10,10];
  const group=cfg[cfg.species[0].key]; group.count=1;group.homes=[[0,0]];group.radius=2;
  const fauna=createFauna(cfg,field,{},context), a=fauna.animals[0];
  Object.assign(a,{x:0,z:0,homeX:0,homeZ:0,tx:0,tz:0,timer:10,yaw:Math.PI/2});
  return fauna;
}
const scalars = actor => (actor.list || actor.animals).map(p => Object.fromEntries(Object.entries(p).filter(([key,value]) => (value===null || ['number','string','boolean'].includes(typeof value) || key==='encounter' || key==='delivery'))));
const snapshot = actor => ({actors:structuredClone(scalars(actor)), buffers:actor.group.children.map(m=>({matrix:[...m.instanceMatrix.array],state:m.geometry.attributes.faunaState ? [...m.geometry.attributes.faunaState.array] : null}))});

check('bounded step/coincidence/OBB and water guards',()=>{
  for(const dt of [0,-1,NaN,Infinity]) assert.equal(livingStep(dt),0);
  assert.equal(livingStep(50),0.05); assert.deepEqual(awayVector(0,0,0,0,Math.PI/2),{x:1,z:Math.cos(Math.PI/2)});
  assert(!sightClear(0,0,2,0,[wall])); assert(sightClear(0,3,2,3,[wall]));
  assert(!sightClear(-2,0,2,0,[{...wall,x:0,rot:Math.PI/4}]));
  assert(!safeSegment('chicken',0,0,2,0,{blockers:[wall]},field));
  assert(!safeSegment('person',-3,0,3,0,{pond:{x:0,z:0,radius:1}},field));
  assert(!safeSegment('dog',-3,0,3,0,{distanceToRiver:(x,z)=>Math.abs(x),riverHalfWidth:0.5},field));
  assert(!safeSegment('ox',0,0,2,0,{waterLevel:3},field));
  assert(safeSegment('duck',0,0,2,0,{pond:{x:0,z:0,radius:3},waterLevel:3},field));
  assert(!safeSegment('duck',0,0,8,0,{pond:{x:0,z:0,radius:3}},field));
});
check('encounter dwell, blocked view, hysteresis, rearm, invalid step',()=>{
  const s=createEncounter();
  for(let i=0;i<10;i++) assert(!encounterEvent(s,2,false,0.2));
  assert(!encounterEvent(s,2,true,0.2)); assert(encounterEvent(s,2,true,0.2));
  for(let i=0;i<30;i++) assert(!encounterEvent(s,2,true,0.2));
  for(let i=0;i<10;i++) encounterEvent(s,5,false,0.2);
  assert(!s.armed); for(let i=0;i<6;i++) encounterEvent(s,7,false,0.2);
  assert(s.armed); const old=structuredClone(s);encounterEvent(s,2,true,0);assert.deepEqual(s,old);
});

const people=makePeople();
check('people facade and stable identity/order/roles',()=>{
  assert.deepEqual(Object.keys(people).sort(),['count','greet','group','list','setRain','update']);
  assert.equal(people.group.children.length,16);
  const refs=people.list.slice(),roles=people.list.map(p=>p.role);tick(people,0.5);
  assert(people.list.every((p,i)=>p===refs[i]));assert.deepEqual(people.list.map(p=>p.role),roles);
});
check('actual villager approach acknowledges once, leaves and rearms',()=>{
  const p=people.list.find(p=>p.mode==='sit'),x=p.x+2,z=p.z;
  tick(people,1,x,z);assert.equal(p.ackCount,1);assert.equal(p.attention,'player');
  tick(people,8,x,z);assert.equal(p.ackCount,1);assert.notEqual(p.attention,'player');
  tick(people,1.5,1000,1000);tick(people,1,x,z);assert.equal(p.ackCount,2);
  const i=people.list.indexOf(p);people.greet(i,x,z,2);const count=p.ackCount;
  tick(people,1,x,z);assert(p.greetT>0);assert.equal(p.ackCount,count);assert(!p.speaking);
});
check('actual people LOS occlusion suppresses acknowledgement',()=>{
  const blocked=makePeople();const p=blocked.list.find(p=>p.mode==='sit');
  // Same mutable blocker array is deliberately added after the generator picked its actor position.
  const blockers=[{x:p.x+1,z:p.z,hw:0.2,hd:3,rot:0}];dispose(blocked);
  const actors=makePeople(blockers),a=actors.list.find(p=>p.mode==='sit');tick(actors,2,a.x+2,a.z);assert.equal(a.ackCount,0);dispose(actors);
});
check('porch one-speaker turns with listening gaps; work/rest stagger and night rest',()=>{
  const groups=[...new Set(people.list.filter(p=>p.mode==='talk').map(p=>p.socialGroup))];
  const speakers=new Map(groups.map(g=>[g,new Set()]));const activities=new Set();
  const worker=people.list.find(p=>p.mode==='work');
  for(let i=0;i<600;i++) {
    people.update(0.05,99999,1000,1000);
    activities.add(worker.activity);
    for(const g of groups){const m=people.list.filter(p=>p.socialGroup===g);assert(m.filter(p=>p.speaking).length<=1);for(const p of m.filter(p=>p.speaking))speakers.get(g).add(people.list.indexOf(p));}
  }
  assert(activities.has('work')&&activities.has('rest'));for(const set of speakers.values())assert(set.size>=2);
  people.update(0.05,0,1000,1000,{timeId:'night'});assert.equal(worker.activity,'rest');assert(people.list.every(p=>!p.speaking));
});
check('safe errand is reversible and E freezes its location; blocked route never starts',()=>{
  const actors=makePeople(),p=actors.list.find(p=>p.basket);p.nextDelivery=0;p.nextThink=0;
  actors.update(0.05,0,1000,1000);assert(p.delivery,'actual basket generator must choose nearby safe doorstep');
  const home={x:p.delivery.x,z:p.delivery.z},states=new Set([p.delivery.phase]);
  actors.greet(actors.list.indexOf(p),p.x+1,p.z,1);const position={x:p.x,z:p.z};tick(actors,0.5,p.x+1,p.z);assert.equal(p.x,position.x);assert.equal(p.z,position.z);
  for(let i=0;i<450 && p.delivery;i++){actors.update(0.05,i*0.05,1000,1000);if(p.delivery)states.add(p.delivery.phase);}
  assert(!p.delivery);assert(states.has('out')&&states.has('wait')&&states.has('back'));assert(Math.hypot(p.x-home.x,p.z-home.z)<0.03);dispose(actors);
  const blocked=makePeople([{x:27,z:0.1,hw:2,hd:0.3,rot:0}]),b=blocked.list.find(p=>p.basket);b.nextDelivery=0;b.nextThink=0;blocked.update(0.05,0,1000,1000);assert.equal(b.delivery,null);dispose(blocked);
});
check('actual child-dog acknowledgement and E interruption',()=>{
  const actors=makePeople(),p=actors.list.find(p=>p.role==='child');
  p.activityUntil=0;p.nextThink=0;
  const dog=makeAnimal('dog'),a=dog.animals[0];a.x=p.x+1;a.z=p.z;
  actors.update(0.05,0,1000,1000,{animals:dog.animals});assert.equal(p.attention,'animal');
  dog.update(0.05,0,1000,1000,{people:actors.list});assert.equal(a.attention,'villager');assert.equal(a.mode,'watch');
  assert.equal(dog.react(0,a.x+2,a.z),world.fauna.sounds.dog);assert.equal(a.mode,'follow');assert.equal(a.attention,'player');assert.equal(a.socialUntil,0);
  actors.greet(actors.list.indexOf(p),p.x+1,p.z,2);actors.update(0.05,0,p.x+1,p.z);assert.equal(p.attention,'player');dispose(dog);dispose(actors);
});

const expected={chicken:'flee',bird:'flush',dog:'follow',ox:'glance',duck:'paddle'};
check('actual five-species slow vs fast approach, recovery and E contracts',()=>{
  for(const kind of Object.keys(expected)){
    const slow=makeAnimal(kind),s=slow.animals[0];tick(slow,0.8,2.5,0,{playerSpeed:world.player.walkSpeed});
    assert.equal(s.ackCount,1,kind+' slow event');assert.equal(s.mode,kind==='dog'?'follow':kind==='ox'?'glance':'watch',kind+' calm approach');
    tick(slow,6,1000,1000);assert(!['flee','flush','glance','paddle','watch','follow'].includes(s.mode),kind+' recovery');
    const fast=makeAnimal(kind),a=fast.animals[0];tick(fast,0.25,2.5,0,{playerSpeed:world.player.runSpeed});assert.equal(a.mode,expected[kind],kind+' fast reaction');assert.equal(a.ackCount,1);
    assert.equal(fast.react(0,a.x,a.z),world.fauna.sounds[kind]);assert.equal(a.mode,expected[kind]);const count=a.ackCount;
    fast.update(0.05,0,a.x,a.z,{playerSpeed:world.player.runSpeed});assert.equal(a.ackCount,count,kind+' E lease wins');
    tick(fast,12,1000,1000);assert(fast.animals.every(x=>[x.x,x.z,x.yaw,x.phase,x.y].every(Number.isFinite)),kind+' finite coincident/recovery');
    dispose(slow);dispose(fast);
  }
});
check('actual animal LOS, no repeated startles, exit/reentry, blocked and watery targets',()=>{
  const f=makeAnimal('chicken',{blockers:[wall]}),a=f.animals[0];tick(f,2,2.5,0,{blockers:[wall],playerSpeed:world.player.runSpeed});assert.equal(a.ackCount,0);
  tick(f,0.3,-2.5,0,{playerSpeed:world.player.runSpeed});assert.equal(a.ackCount,1);tick(f,4,-2.5,0,{playerSpeed:world.player.runSpeed});assert.equal(a.ackCount,1);
  tick(f,4,1000,1000);a.timer=10;const x=a.x,z=a.z;tick(f,0.3,x-2.5,z,{playerSpeed:world.player.runSpeed});assert.equal(a.ackCount,2);dispose(f);
  for(const context of [{blockers:[{x:-0.8,z:0,hw:0.2,hd:10,rot:0}]},{pond:{x:-1.2,z:0,radius:0.25}}]) {
    const animal=makeAnimal('chicken',context),a=animal.animals[0];animal.react(0,1,0);assert.equal(a.tx,a.x);tick(animal,1,1000,1000,context);assert.equal(a.x,0);dispose(animal);
  }
  const dog=makeAnimal('dog',{blockers:[wall]}),d=dog.animals[0];dog.react(0,4,0);tick(dog,1,4,0,{playerSpeed:world.player.walkSpeed});assert(d.x<wall.x-wall.hw-0.22);dispose(dog);
});
check('actual generators are deterministic and frozen for zero/invalid dt and elapsed jumps',()=>{
  for(const make of [makePeople,()=>makeAnimal('dog')]){
    const left=make(),right=make();tick(left,1,2,0);tick(right,1,2,0);
    const before=snapshot(left);for(const dt of [0,-1,NaN,Infinity])left.update(dt,90000,2,0);assert.deepEqual(snapshot(left),before);
    left.update(0.05,90000,2,0);right.update(0.05,1.05,2,0);assert.deepEqual(snapshot(left),snapshot(right));
    dispose(left);dispose(right);
  }
});
check('ox vs road walkers and seated villagers: zero capsule interpenetration and smooth detour recovery',()=>{
  for(const oxYaw of [-Math.PI/2, 0.55]){
    const actors=makePeople(),oxFauna=makeAnimal('ox'),ox=oxFauna.animals[0];
    Object.assign(ox,{x:22,z:0,homeX:22,homeZ:0,tx:22,tz:0,mode:'idle',timer:30,yaw:oxYaw});
    const walkers=actors.list.filter(p=>p.mode==='road');
    // Isolate one walker approaching ox head-on along road centerline (z=0), park others far away.
    walkers.forEach((p,idx)=>{
      if(idx===0){Object.assign(p,{at:13.5,dir:1,offset:0,yieldOffset:0,avoidX:0,avoidZ:0,speed:0.95,pauseT:0,nextPause:99,delivery:null,nextDelivery:99});}
      else{Object.assign(p,{at:52+idx*1.8,dir:1,pauseT:30,delivery:null,nextDelivery:99});}
    });
    const w=walkers[0],ctx={people:actors.list,animals:oxFauna.animals};
    let minGap=Infinity,maxDetour=0;
    for(let i=0;i<260;i++){
      oxFauna.update(0.05,i*0.05,1000,1000,ctx);
      actors.update(0.05,i*0.05,1000,1000,ctx);
      const g=capsuleGap(w.x,w.z,0,0,0,0.30*(w.s||1),ox.x,ox.z,ox.yaw,ox.capRear,ox.capFront,ox.capRadius);
      if(g.gap<minGap) minGap=g.gap;
      maxDetour=Math.max(maxDetour,Math.hypot(w.avoidX||0,w.avoidZ||0));
    }
    assert(minGap>=-0.02,`walker clipped ox capsule (yaw=${oxYaw}, minGap=${minGap.toFixed(3)})`);
    assert(maxDetour>0.25,'walker must laterally detour around ox capsule');
    assert(w.at>25.2,`walker must progress past ox (at=${w.at.toFixed(2)})`);
    assert(Math.hypot(w.avoidX||0,w.avoidZ||0)<0.16,'detour offset must decay once clear of ox');
    dispose(oxFauna);dispose(actors);
  }
  // Walking ox directed straight across a seated elder: elder stays anchored, ox steers around cleanly.
  const actors=makePeople(),elder=actors.list.find(p=>p.mode==='sit');
  const anchorX=elder.x,anchorZ=elder.z;
  // Park movable villagers away so we isolate ox vs seated elder.
  for(const p of actors.list){if(p!==elder){p.x=anchorX+40;p.z=anchorZ+40;if(p.mode==='road'){p.at=58;p.pauseT=30;}}}
  const oxFauna=makeAnimal('ox'),ox=oxFauna.animals[0];
  Object.assign(ox,{x:anchorX-4.0,z:anchorZ,homeX:anchorX,homeZ:anchorZ,tx:anchorX+4.2,tz:anchorZ,mode:'walk',timer:25,yaw:Math.PI/2});
  const ctx={people:actors.list,animals:oxFauna.animals};
  let minElderGap=Infinity;
  for(let i=0;i<300;i++){
    oxFauna.update(0.05,i*0.05,1000,1000,ctx);
    actors.update(0.05,i*0.05,1000,1000,ctx);
    assert.equal(elder.x,anchorX,'seated elder X must remain anchored');
    assert.equal(elder.z,anchorZ,'seated elder Z must remain anchored');
    const g=capsuleGap(ox.x,ox.z,ox.yaw,ox.capRear,ox.capFront,ox.capRadius,elder.x,elder.z,0,0,0,0.30*(elder.s||1));
    if(g.gap<minElderGap) minElderGap=g.gap;
  }
  assert(minElderGap>=-0.02,`ox clipped seated elder (minGap=${minElderGap.toFixed(3)})`);
  assert(ox.x>anchorX+1.2,`ox must steer past seated elder (ox.x=${ox.x.toFixed(2)}, elder.x=${anchorX.toFixed(2)})`);
  dispose(oxFauna);dispose(actors);
});
check('animal-vs-animal capsules and pond buffalo extraAnimals: zero interpenetration',()=>{
  // 1) Head-on ox vs ox
  const cfgOx=structuredClone(world.fauna);
  cfgOx.species=cfgOx.species.filter(s=>s.kind==='ox');cfgOx.pauseRange=[20,20];
  const gOx=cfgOx[cfgOx.species[0].key];gOx.count=2;gOx.homes=[[0,0]];gOx.radius=6;
  const twoOx=createFauna(cfgOx,field,{},{}),[oxA,oxB]=twoOx.animals;
  Object.assign(oxA,{x:-3.2,z:0,homeX:0,homeZ:0,tx:3.4,tz:0,mode:'walk',timer:25,yaw:Math.PI/2});
  Object.assign(oxB,{x:3.2,z:0.04,homeX:0,homeZ:0,tx:-3.4,tz:0,mode:'walk',timer:25,yaw:-Math.PI/2});
  let minOxGap=Infinity;
  for(let i=0;i<240;i++){
    twoOx.update(0.05,i*0.05,1000,1000,{});
    const g=capsuleGap(oxA.x,oxA.z,oxA.yaw,oxA.capRear,oxA.capFront,oxA.capRadius,oxB.x,oxB.z,oxB.yaw,oxB.capRear,oxB.capFront,oxB.capRadius);
    if(g.gap<minOxGap) minOxGap=g.gap;
  }
  assert(minOxGap>=-0.02,`head-on oxen clipped (minGap=${minOxGap.toFixed(3)})`);
  assert(oxA.x>0.8 && oxB.x<-0.8,`head-on oxen must pass each other (${oxA.x.toFixed(2)}, ${oxB.x.toFixed(2)})`);
  dispose(twoOx);

  // 2) Tight multi-species yard (ox + dog + 4 chickens) including initial spawn separation
  const cfgYard=structuredClone(world.fauna);
  cfgYard.species=cfgYard.species.filter(s=>['ox','dog','chicken'].includes(s.kind));
  for(const sp of cfgYard.species){
    const grp=cfgYard[sp.key];
    grp.homes=[[0,0]];grp.radius=2.1;
    grp.count=sp.kind==='chicken'?4:1;
  }
  const yard=createFauna(cfgYard,field,{},{});
  let minYardGap=Infinity;
  const checkYardPairs=()=>{
    for(let i=0;i<yard.animals.length;i++){
      for(let j=i+1;j<yard.animals.length;j++){
        const a=yard.animals[i],b=yard.animals[j];
        const g=capsuleGap(a.x,a.z,a.yaw,a.capRear,a.capFront,a.capRadius,b.x,b.z,b.yaw,b.capRear,b.capFront,b.capRadius);
        if(g.gap<minYardGap) minYardGap=g.gap;
      }
    }
  };
  checkYardPairs();
  assert(minYardGap>=-0.02,`initial spawn animal overlap (minGap=${minYardGap.toFixed(3)})`);
  for(let i=0;i<240;i++){yard.update(0.05,i*0.05,1000,1000,{});checkYardPairs();}
  assert(minYardGap>=-0.02,`multi-species yard animal overlap (minGap=${minYardGap.toFixed(3)})`);
  dispose(yard);

  // 3) Pond ducks swimming past qinHanHomestead sculpted water buffalo (extraAnimals)
  const bufProf=capsuleProfile('buffalo',1,{});
  const buffalo={kind:'buffalo',x:0,z:0,yaw:0.35,rear:bufProf.rear,front:bufProf.front,radius:bufProf.radius,mass:bufProf.mass};
  const pondCtx={pond:{x:0,z:0,radius:5},extraAnimals:[buffalo]};
  const cfgDuck=structuredClone(world.fauna);
  cfgDuck.species=cfgDuck.species.filter(s=>s.kind==='duck');
  const gDuck=cfgDuck[cfgDuck.species[0].key];gDuck.count=3;gDuck.homes=[[-2.4,0],[-2.4,0.7],[-2.4,-0.7]];gDuck.radius=4.5;
  const ducks=createFauna(cfgDuck,field,{},pondCtx);
  ducks.animals.forEach((d,i)=>{Object.assign(d,{x:-2.4,z:(i-1)*0.65,tx:2.6,tz:(1-i)*0.4,mode:'walk',timer:18,yaw:Math.PI/2});});
  let minBufGap=Infinity;
  for(let i=0;i<200;i++){
    ducks.update(0.05,i*0.05,1000,1000,pondCtx);
    for(const d of ducks.animals){
      assert(Math.hypot(d.x,d.z)<=8,'duck must stay within pond habitat');
      const g=capsuleGap(d.x,d.z,d.yaw,d.capRear,d.capFront,d.capRadius,buffalo.x,buffalo.z,buffalo.yaw,buffalo.capRear,buffalo.capFront,buffalo.capRadius);
      if(g.gap<minBufGap) minBufGap=g.gap;
    }
  }
  assert(minBufGap>=-0.02,`duck clipped pond water buffalo (minGap=${minBufGap.toFixed(3)})`);
  dispose(ducks);
});
check('road pedestrian overtaking and opposite-direction passing: zero torso clipping',()=>{
  const actors=makePeople(),walkers=actors.list.filter(p=>p.mode==='road');
  assert(walkers.length>=3);
  walkers.forEach((p,idx)=>{
    p.delivery=null;p.nextDelivery=99;p.pauseT=0;p.nextPause=99;p.encounterReady=99;p.avoidX=0;p.avoidZ=0;p.yieldOffset=0;
    if(idx===0){Object.assign(p,{at:10,dir:1,offset:0,speed:1.08,basket:false});}
    else if(idx===1){Object.assign(p,{at:12.1,dir:1,offset:0,speed:0.52,basket:true});}
    else if(idx===2){Object.assign(p,{at:18.2,dir:-1,offset:0,speed:0.92,basket:false});}
    else{Object.assign(p,{at:50+idx*2,dir:1,pauseT:30});}
  });
  const [fast,slow,opp]=walkers;
  // Sync initial x,z before stepping
  actors.update(0.05,0,1000,1000);
  let minPairDist=Infinity;
  for(let i=1;i<220;i++){
    actors.update(0.05,i*0.05,1000,1000);
    for(const [a,b] of [[fast,slow],[fast,opp],[slow,opp]]){
      const d=Math.hypot(a.x-b.x,a.z-b.z);
      if(d<minPairDist) minPairDist=d;
    }
  }
  assert(minPairDist>=0.54,`road walkers clipped during pass/overtake (minDist=${minPairDist.toFixed(3)})`);
  assert(fast.at>slow.at+1.0,'fast walker must cleanly overtake slow basket walker');
  assert(opp.at<10,'opposite walker must cleanly pass both oncoming walkers');
  dispose(actors);
});
// Informational CPU-only cost, not a GPU/FPS promise or a flaky timing gate.
const perfFauna=createFauna(world.fauna,field,{}),cost=[];
for(let i=0;i<240;i++){const t=performance.now();people.update(1/60,i/60,1000,1000);perfFauna.update(1/60,i/60,1000,1000,{people:people.list});cost.push(performance.now()-t);}
cost.sort((a,b)=>a-b);
console.log(JSON.stringify({status:'passed',checks,drawCalls:{people:people.group.children.length,fauna:perfFauna.group.children.length},cpuOnlyUpdateP95Ms:+cost[Math.floor(cost.length*0.95)].toFixed(3),note:'Node CPU fixture only; browser/GPU p95 and FPS require parent measurement'}));
dispose(people);dispose(perfFauna);
