// 轮8 性能余量门：逐源距离上限（getMaxDistance 第二参 mesh）+ 更细页格 + 雾尾收边。
// 功能断言用合成场景；源码不变量保证 main.js 真的接上了这些旋钮。dt=0 选择冻结。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';

let checks = 0;
const check = (v, label) => { assert(v, label); checks++; };

const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check(/cellSize:\s*12/.test(mainSrc), 'main opts use finer 12-unit visibility pages');
check(/getMaxDistance:\s*function\s*\(camera,\s*mesh\)/.test(mainSrc), 'main distance hook accepts per-mesh override');
check(/fog\.far\s*\+\s*6\b/.test(mainSrc), 'fog tail margin tightened to +6');
check(/'grass'[^\n]*170|170[^\n]*'grass'/.test(mainSrc), 'far tufts/flowers capped at 170 units');

const scene = new THREE.Scene();
const root = new THREE.Group(); root.name = 'scatter'; scene.add(root);
const geo = new THREE.BoxGeometry(0.4, 0.5, 0.4);
const mat = new THREE.MeshLambertMaterial({ color: 0x7ba05b });
function inst(name, dists) {
  const m = new THREE.InstancedMesh(geo, mat, dists.length);
  m.name = name;
  const o = new THREE.Object3D();
  dists.forEach((d, i) => { o.position.set(0, 0, -d); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  root.add(m);
  return m;
}
const grass = inst('grass', [100, 200, 300]);
const trees = inst('tree-far-0', [100, 200, 300]);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 900);
camera.position.set(0, 2, 0);
camera.lookAt(0, 2, -100);
camera.updateMatrixWorld();
const fog = { far: 320 };
const vis = optimizeStaticVisibility(scene, {
  getMaxDistance: function (cam, mesh) {
    const base = fog.far + 6;
    if (!mesh) return base;
    if (mesh.name === 'grass' || mesh.name === 'flower-stems' || mesh.name === 'flower-heads') return Math.min(base, 170);
    if (mesh.name === 'grass-approach') return Math.min(base, 80);
    return base;
  },
});
vis.update(camera);
check(grass.count === 3, 'source untouched');
const proxyOf = (src) => src.parent.children.find(c => c !== src && c.isInstancedMesh && c.geometry === src.geometry) || null;
// render through helper to apply compaction
const renderer = { info: { render: { calls: 0, triangles: 0 } } };
// use update() selection stats instead of a real GL render
const stats = vis.getStats();
check(stats.visibleInstances === 4, 'grass beyond 170 culled, trees keep fog tail (1+3), got ' + stats.visibleInstances);
// freeze: same camera twice -> identical selection
const before = stats.visibleInstances;
vis.update(camera);
check(vis.getStats().visibleInstances === before, 'dt=0 selection frozen');
// fog tightening reacts live
fog.far = 120;
vis.update(camera);
check(vis.getStats().visibleInstances === 2, 'fog far 120 -> only 100-unit instances survive, got ' + vis.getStats().visibleInstances);
// hysteresis: visible instance survives cap..cap+6, drops beyond, re-admits only <=cap
const scene2 = new THREE.Scene();
const root2 = new THREE.Group(); root2.name = 'scatter'; scene2.add(root2);
const hm = new THREE.InstancedMesh(geo, mat, 1); hm.name = 'grass';
const ho = new THREE.Object3D(); ho.position.set(0, 0, -168); ho.updateMatrix(); hm.setMatrixAt(0, ho.matrix);
hm.instanceMatrix.needsUpdate = true; hm.computeBoundingSphere(); root2.add(hm);
const cam2 = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 900);
cam2.position.set(0, 2, 0); cam2.lookAt(0, 2, -100); cam2.updateMatrixWorld();
const vis2 = optimizeStaticVisibility(scene2, {
  getMaxDistance: function (cam, mesh) { return mesh && mesh.name === 'grass' ? 170 : 326; },
});
const sel = () => { vis2.update(cam2); return vis2.getStats().visibleInstances; };
check(sel() === 1, '168 within cap visible');
cam2.position.z = 4; cam2.updateMatrixWorld();
check(sel() === 1, '172 inside dead band keeps visible instance');
cam2.position.z = 14; cam2.updateMatrixWorld();
check(sel() === 0, '182 beyond dead band culls');
cam2.position.z = 4; cam2.updateMatrixWorld();
check(sel() === 0, '172 re-admission blocked until back under cap');
cam2.position.z = 0; cam2.updateMatrixWorld();
check(sel() === 1, '168 re-admits');
vis2.dispose();
vis.dispose();
console.log('PASS check-perf-headroom', checks, 'checks');
