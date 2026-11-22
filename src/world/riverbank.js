// Construction-time riverbank composition. No meshes, timers or frame-loop work.
const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t); };
const hash = n => { let h=Math.imul(n+73,374761393);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296; };

// Different phases across the river keep the two banks from reading as mirrored scallops.
export function bankPatch(x,z) {
  return .5 + .5*(Math.sin(z*.071+x*.109+1.2)*.65 + Math.sin(z*.029-x*.137-2.1)*.35);
}

export function riverbankMask(cfg,x,z,d,h) {
  const shore=cfg.shoreline;
  if(!shore || d<=3 || d>=18 || z<=shore.startZ || z>=shore.endZ) return 0;
  return smooth(shore.startZ,shore.startZ+36,z)*(1-smooth(shore.endZ-30,shore.endZ,z))
    *smooth(3,6,d)*(1-smooth(14,18,d))
    *(1-smooth(cfg.waterLevel+.3,cfg.waterLevel+1.1,h));
}

export function riverbankRelief(cfg,x,z,d,h) {
  const mask=riverbankMask(cfg,x,z,d,h);
  return mask*(cfg.shoreline?.strength||0)*(bankPatch(x,z)*2-1);
}

// Coherent stands with open stretches between them, not an even fringe of dots.
// Both reeds and shingle share the same anchors, but retain their own seeded jitter.
export function sampleBankPatch(curve,rand,patches=24) {
  const count=Math.max(1,Math.floor(patches));
  const i=Math.min(count-1,Math.floor(rand()*count));
  const t=Math.max(.015,Math.min(.985,(i+.25+hash(i)*.5)/count+(rand()-.5)*.018));
  const p=curve.getPointAt(t),tan=curve.getTangentAt(t);
  const len=Math.hypot(tan.x,tan.z)||1;
  const side=hash(i+101)<.5?-1:1;
  return { x:p.x,z:p.z,nx:tan.z/len*side,nz:-tan.x/len*side,t };
}
