import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createRiverCurve, createStream, sampleRiverSpine } from '../src/world/stream.js';
import * as waterModule from '../src/systems/twilight-water.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const baselineURL = new URL('../.visual-round9-baseline/src/world/stream.js', import.meta.url);
const baselineSource = readFileSync(baselineURL, 'utf8')
  .replace("from 'three'", 'from ' + JSON.stringify(import.meta.resolve('three')))
  .replace("from './terrain.js'", 'from ' + JSON.stringify(new URL('../src/world/terrain.js', import.meta.url).href));
const baseline = await import('data:text/javascript,' + encodeURIComponent(baselineSource));
const ctx2d = new Proxy({}, { get: () => () => {} });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d }) };
const failures = [];
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + error.message); }
}
const curve = createRiverCurve(world.stream.points);
const stream = createStream(world.stream, world.terrain, curve);
const old = baseline.createStream(world.stream, world.terrain, baseline.createRiverCurve(world.stream.points));
const copy = arr => Array.from(arr);
await check('immutable river shape, topology, UV, public wave and positive-dt behavior', () => {
  assert.deepEqual(sampleRiverSpine(curve, 180), baseline.sampleRiverSpine(old.curve, 180));
  for (const name of ['position', 'uv', 'normal']) assert.deepEqual(copy(stream.mesh.geometry.attributes[name].array), copy(old.mesh.geometry.attributes[name].array));
  assert.deepEqual(copy(stream.mesh.geometry.index.array), copy(old.mesh.geometry.index.array));
  for (const elapsed of [0, 0.017, 4, 31.7, 1024]) {
    for (const t of [0, 0.001, 0.25, 0.583, 0.999, 1]) assert.equal(stream.surfaceY(t, elapsed), old.surfaceY(t, elapsed));
    stream.update(0.025, elapsed); old.update(0.025, elapsed);
    assert.deepEqual(copy(stream.mesh.geometry.attributes.position.array), copy(old.mesh.geometry.attributes.position.array));
  }
  assert(stream.mesh.material.isMeshLambertMaterial);
  for (const key of ['transparent', 'opacity', 'depthWrite', 'side']) assert.equal(stream.mesh.material[key], old.mesh.material[key]);
});
await check('stream update(0,newElapsed) strictly freezes geometry and texture state', () => {
  const positions = stream.mesh.geometry.attributes.position.array.slice();
  const offset = stream.mesh.material.map.offset.clone();
  const version = stream.mesh.geometry.attributes.position.version;
  for (const dt of [0, -1, NaN, Infinity]) stream.update(dt, 99999);
  assert.deepEqual(stream.mesh.geometry.attributes.position.array, positions, 'zero/invalid dt cannot accept a new external elapsed');
  assert(stream.mesh.material.map.offset.equals(offset));
  assert.equal(stream.mesh.geometry.attributes.position.version, version);
});
function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader, null);
  return shader;
}
const sky = { rainIntensity: 0.7, timeId: 'day', getTwilightState: () => ({ amount: 0.8, direction: new THREE.Vector3(1, 0.15, 0).normalize(), color: new THREE.Color(1, 0.55, 0.22) }) };
await check('one composed Lambert surface supplies pond/stream depth, moving ripples and existing bounded glints', () => {
  assert.equal(typeof waterModule.createWaterSurface, 'function');
  for (const kind of ['stream', 'pond']) {
    const mesh = kind === 'stream' ? createStream(world.stream, world.terrain, curve).mesh : new THREE.Mesh(new THREE.CircleGeometry(7, 24).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, vertexColors: false }));
    const field = { sample: (x, z) => -2 + Math.sin(x * 0.2) * 0.4 };
    const geometry = mesh.geometry, before = geometry.attributes.position.array.slice();
    const hook = mesh.material.onBeforeCompile, key = mesh.material.customProgramCacheKey;
    const adapter = waterModule.createWaterSurface(mesh, sky, { field, kind });
    const shader = compile(mesh.material);
    assert(shader.uniforms.uInkWaterClock && shader.uniforms.uInkWaterDeep && shader.uniforms.uInkWaterShallow);
    assert(shader.vertexShader.includes('inkWaterDepth'));
    assert(shader.fragmentShader.includes('inkWaterFlow'));
    assert.equal(shader.fragmentShader.split('outgoingLight += uTwilightWaterColor').length - 1, 1, 'only the original bounded highlight pass');
    assert.equal(adapter.getStats().maxGain, 0.18);
    assert.equal(adapter.getStats().addedDraws, 0);
    const version = mesh.material.version;
    adapter.update(0.04);
    const clock = shader.uniforms.uInkWaterClock.value;
    assert(clock > 0);
    adapter.update(0); adapter.update(NaN); adapter.update(-1);
    assert.equal(shader.uniforms.uInkWaterClock.value, clock);
    assert.equal(mesh.material.version, version);
    assert.equal(mesh.geometry, geometry);
    assert.deepEqual(geometry.attributes.position.array, before);
    assert.equal(mesh.material.depthWrite, false);
    adapter.dispose(); adapter.dispose();
    assert.equal(mesh.material.onBeforeCompile, hook);
    assert.equal(mesh.material.customProgramCacheKey, key);
    assert(!geometry.attributes.inkWaterDepth, 'owned depth attribute removed');
    assert.equal(adapter.getStats().disposed, true);
    mesh.geometry.dispose(); mesh.material.dispose();
  }
});
await check('rain rings follow true wet surfaces, never clear/dry/hidden/distant, deterministic and dt0-safe', async () => {
  const { createRainWater } = await import('../src/systems/rain-water.js');
  const line = new THREE.LineCurve3(new THREE.Vector3(-25, 0, 0), new THREE.Vector3(25, 0, 0));
  const localStream = createStream({ ...world.stream, segments: 50, halfWidth: 3, edgeWobble: 0 }, { ...world.terrain, choke: undefined }, line);
  const pondMesh = new THREE.Mesh(new THREE.CircleGeometry(6, 24).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial());
  pondMesh.position.set(0, 1.2, 12); pondMesh.name = 'pond';
  const field = { sample: (x, z) => Math.abs(z) < 2.7 || Math.hypot(x, z - 12) < 5.8 ? -3 : 4 };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 13, 28); camera.lookAt(0, 0, 4); camera.updateMatrixWorld();
  const doc = { hidden: false, hasFocus: () => true };
  const shelters = [{ kind: 'pavilion', x: 0, z: 10, rx: 2, rz: 2, rot: 0.4, eaveY: 4, roofY: 6 }];
  const context = { world, stream: localStream, pondMesh, field, camera, sky, shelters, doc };
  const rain = createRainWater(context), twin = createRainWater(context);
  const meshes = rain.group.children.filter(m => m.isInstancedMesh);
  assert(meshes.length <= 2 && meshes.length > 0);
  for (const mesh of meshes) {
    const shader = compile(mesh.material);
    assert(shader.vertexShader.includes('vInkRainAlpha = inkRainAlpha;'));
    assert(!shader.vertexShader.includes(String.fromCharCode(92) + 'n'), 'GLSL declarations use real line breaks');
    assert(shader.fragmentShader.includes('diffuseColor.a *= vInkRainAlpha;'));
    assert.equal(mesh.material.forceSinglePass, true, 'transparent double-sided rain batch must render a single pass');
  }
  assert.equal(rain.getStats().drawCalls, 0);
  rain.update(0.05, 3, { rainIntensity: 0 }, camera);
  twin.update(0.05, 3, { rainIntensity: 0 }, camera);
  assert.equal(rain.getStats().drawCalls, 0, 'dry weather has zero draws');
  rain.update(0.05, 3, sky, camera); twin.update(0.05, 3, sky, camera);
  assert(rain.getStats().rings > 0 && rain.getStats().eaves > 0);
  assert(rain.getStats().drawCalls <= 2 && rain.getStats().instances <= 144);
  const rings = rain.group.getObjectByName('ink-rain-rings');
  const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  let streamInstances = 0, pondInstances = 0;
  for (let i = 0; i < rings.count; i++) {
    rings.getMatrixAt(i, matrix); matrix.decompose(pos, quat, scale);
    assert(field.sample(pos.x, pos.z) < pos.y, 'wet-only sample');
    if (pos.z < 5) {
      streamInstances++;
      const t = (pos.x + 25) / 50;
      assert(Math.abs(pos.y - localStream.surfaceY(t, 3) - 0.025) < 0.002, 'river rings share public surfaceY');
    } else { pondInstances++; assert(Math.abs(pos.y - pondMesh.position.y - 0.025) < 0.002, 'pond rings use actual mesh Y'); }
  }
  assert(streamInstances > 0 && pondInstances > 0, 'test exercises both rendered stream and pond sources');
  const snapshot = () => JSON.stringify({ stats: rain.getStats(), matrices: meshes.map(m => copy(m.instanceMatrix.array)) });
  const before = snapshot();
  rain.update(0, 900, { rainIntensity: 0 }, camera); assert.equal(snapshot(), before);
  doc.hidden = true; rain.update(0.05, 99, sky, camera); assert.equal(snapshot(), before); doc.hidden = false;
  doc.hasFocus = () => false; rain.update(0.05, 99, sky, camera); assert.equal(snapshot(), before); doc.hasFocus = () => true;
  assert.deepEqual(copy(rings.instanceMatrix.array), copy(twin.group.getObjectByName('ink-rain-rings').instanceMatrix.array), 'fixed seed identical matrices');
  localStream.mesh.visible = false; pondMesh.visible = false;
  rain.update(0.05, 4, sky, camera); assert.equal(rain.getStats().rings, 0, 'hidden source surfaces produce no rings');
  camera.position.set(1000, 200, 1000); camera.updateMatrixWorld();
  rain.update(0.05, 4, sky, camera); assert.equal(rain.getStats().drawCalls, 0, 'distant effects produce no draws');
  localStream.mesh.visible = true; pondMesh.visible = true;
  camera.lookAt(0, 13, 100); camera.updateMatrixWorld();
  rain.update(0.05, 4, sky, camera); assert.equal(rain.getStats().drawCalls, 0, 'off-frustum instances are not drawn');
  const dry = createRainWater({ ...context, field: { sample: () => 99 } });
  dry.update(0.05, 4, sky, camera); assert.equal(dry.getStats().drawCalls, 0, 'completely dry ground has no rings or drops'); dry.dispose();
  const legacy = new THREE.Group(); const oldCurtain = new THREE.Mesh(); oldCurtain.name = 'qin-han-rain-curtain'; legacy.add(oldCurtain);
  const reuse = createRainWater({ ...context, qinHanCompletion: { group: legacy, shelters } });
  camera.position.set(0, 13, 28); camera.lookAt(0, 0, 4); camera.updateMatrixWorld();
  reuse.update(0.05, 3, sky, camera);
  assert.equal(reuse.getStats().eaves, 0, 'existing roof rain is not duplicated');
  assert.equal(reuse.getStats().reusedEaves, true);
  const villageGroup = new THREE.Group(); villageGroup.add(pondMesh);
  const mainAPI = createRainWater({ world, field, stream: localStream, riverCurve: line, village: { group: villageGroup }, pond: { waterY: 1.2 }, shelters, legacyEaves: legacy, sky, camera, doc });
  mainAPI.update(0.05, 3, sky, camera);
  assert(mainAPI.getStats().rings > 0 && mainAPI.getStats().reusedEaves, 'production ctx resolves real pond mesh and existing curtain');
  assert.equal(mainAPI.group.children.length, 1, 'production path adds only water ring batch'); mainAPI.dispose();
  let released = 0;
  for (const m of meshes) { m.geometry.addEventListener('dispose', () => released++); m.material.addEventListener('dispose', () => released++); m.addEventListener('dispose', () => released++); }
  rain.dispose(); rain.dispose();
  assert.equal(released, meshes.length * 3, 'including instanced GPU matrix buffer owner');
  assert.equal(rain.group.children.length, 0);
  const disposed = JSON.stringify(rain.getStats()); rain.update(0.05, 10, sky, camera); assert.equal(JSON.stringify(rain.getStats()), disposed);
  twin.dispose(); reuse.dispose();
});

function pondPolygon(points) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  shape.closePath();
  return shape;
}
const concavePond = pondPolygon([[-1.4,-1.4],[1.4,-1.4],[1.4,-0.3],[0.2,-0.3],[0.2,1.4],[-1.4,1.4]]);
const holedPond = pondPolygon([[-1.8,-1.8],[1.8,-1.8],[1.8,1.8],[-1.8,1.8]]);
holedPond.holes.push(new THREE.Path([[-0.5,-0.5],[-0.5,0.5],[0.5,0.5],[0.5,-0.5]].map(([x,z]) => new THREE.Vector2(x,z))));
for (const [name, geometry] of [
  ['circle-24', new THREE.CircleGeometry(1.2, 24)],
  ['diamond-4', new THREE.CircleGeometry(1.2, 4)],
  ['concave-nonindexed', new THREE.ShapeGeometry(concavePond).toNonIndexed()],
  ['hole', new THREE.ShapeGeometry(holedPond)]
]) await check('whole rendered ring footprint raycasts inside actual ' + name + ' pond', async () => {
  const { createRainWater } = await import('../src/systems/rain-water.js');
  const pond = new THREE.Mesh(geometry.rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  if (name !== 'circle-24') { pond.position.set(2, 0, -3); pond.rotation.y = 0.31; }
  pond.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 100);
  camera.position.set(2, 8, 5); camera.lookAt(2, 0, -3); camera.updateMatrixWorld(true);
  const sky = {rainIntensity:1};
  const rain = createRainWater({pondMesh:pond,field:{sample:()=>-1},doc:{hidden:false,hasFocus:()=>true},sky,camera});
  const ring = rain.group.getObjectByName('ink-rain-rings');
  const vertices = ring.geometry.attributes.position, ix = ring.geometry.index;
  const vertexProbes = [], interiorProbes = [];
  for (let i=0;i<vertices.count;i++) vertexProbes.push(new THREE.Vector3().fromBufferAttribute(vertices,i));
  for (let i=0;i<ix.count;i+=3) {
    const a = vertexProbes[ix.getX(i)], b = vertexProbes[ix.getX(i+1)], c = vertexProbes[ix.getX(i+2)];
    interiorProbes.push(a.clone().add(b).add(c).multiplyScalar(1/3));
    interiorProbes.push(a.clone().add(b).multiplyScalar(0.5),b.clone().add(c).multiplyScalar(0.5),c.clone().add(a).multiplyScalar(0.5));
  }
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0,-1,0), m = new THREE.Matrix4(), p = new THREE.Vector3();
  let tested = 0, instances = 0;
  try {
    for (let tick=0;tick<100;tick++) {
      rain.update(0.05, tick*0.05, sky, camera);
      instances += ring.count;
      // All actual visible vertices every frame; face interiors/edge midpoints each tenth frame.
      const probes = tick % 10 === 0 ? [...vertexProbes,...interiorProbes] : vertexProbes;
      for (let i=0;i<ring.count;i++) {
        ring.getMatrixAt(i,m);
        for (let j=0;j<probes.length;j++) {
          p.copy(probes[j]).applyMatrix4(m); p.y = 2;
          ray.set(p,down);
          assert(ray.intersectObject(pond,false).length > 0, name+' pond miss tick='+tick+' instance='+i+' probe='+j+' x='+p.x+' z='+p.z);
          tested++;
        }
      }
    }
    assert(instances > 0 && tested > 10000, 'non-vacuous 100-frame actual mesh oracle');
    console.log('  raycast footprint '+name+': '+tested+' probes, '+instances+' live instances');
  } finally { rain.dispose(); geometry.dispose(); pond.material.dispose(); }
});

if (failures.length) { console.error(failures.length + ' ink-water behavior check(s) failed'); process.exitCode = 1; }
else console.log('PASS ink-water behavioral contracts; CPU/mock GLSL checks only, not GPU or auditory proof.');
