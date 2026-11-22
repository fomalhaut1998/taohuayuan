import assert from 'node:assert/strict';
import { stripRound6Main } from './round6-main-delta.mjs';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { installSkyAppearance, isSkyAppearanceMaterial } from '../src/systems/scene-appearance.js';

const text = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [main, baseline, config, oldConfig, index] = await Promise.all([
  text('src/main.js'), text('.visual-round4-baseline/src/main.js'),
  text('src/data/world.json'), text('.visual-round4-baseline/src/data/world.json'), text('index.html')
]);
assert.equal(config, oldConfig, 'round four must not rewrite world layout, actor, audio, or accepted clear-day config');
const colliders = source => source.match(/const colliders = ([^;]+);/)?.[1];
assert.equal(colliders(stripRound6Main(main)), colliders(baseline), 'visual habitat clusters do not secretly add collision obstacles');
const at = value => { const offset = main.indexOf(value); assert.ok(offset >= 0, 'missing integration ' + value); return offset; };
assert.ok(at('const exterior = createExteriorExploration(') < at('const habitatDetails = createHabitatDetails('));
assert.ok(at('scene.add(habitatDetails.group)') < at('const sky = createSky('));
assert.ok(at('const discovery = createDiscovery(') < at('const staticVisibility = optimizeStaticVisibility(scene'));
assert.ok(main.includes('discovery.isOpen || document.hidden'));
assert.ok(at('discovery.update(0, false)') < at('elapsed += dt;'));
assert.ok(at('sound.update(0, elapsed, camera, player.state, true)') < at('elapsed += dt;'));
assert.ok(main.includes('sky.registerMaterials(avatar.group)'));
assert.ok(main.includes('sky.registerMaterials(interaction.group)'));
assert.ok(at('map.setTimeAppearance(sky.timeId, dt, sky.weatherId)') > at('sky.update(dt, camera)'));
assert.ok(at('map.setTimeAppearance(sky.timeId, dt, sky.weatherId)') < at('map.update(dt)'));
assert.ok(main.includes('if (discovery.openCurrent()) event.preventDefault()'));
assert.ok(!main.includes('function updateObservation('), 'no duplicate old target/label or G recorder remains');
assert.ok(at('discovery.update(dt)') > at('interaction.applyCamera(camera, dt)'), 'project after final scene camera placement');
assert.ok(main.includes("import './field-guide.css'"));
assert.ok(main.includes("import './map-time-theme.css'"));
assert.ok(index.includes('近观 E · 识物 G'));

const scene = new THREE.Scene(), root = new THREE.Group();
root.name = 'habitat-details'; scene.add(root);
const uniform = { value: .55 }, restorers = [], sources = [];
function add(name, material) {
  const geometry = new THREE.BoxGeometry(.5, .25, .5); geometry.clearGroups();
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.z = -4;
  root.add(mesh); return mesh;
}
for (const kind of ['solid','botanical','ground']) {
  const material = new THREE.MeshLambertMaterial({color:0x708159});
  const stop = installSkyAppearance(material, uniform); restorers.push(stop);
  assert.ok(isSkyAppearanceMaterial(material));
  sources.push(add('habitat-details-' + kind, material));
}
const fake = new THREE.MeshLambertMaterial();
fake.userData.skyAppearance = { fragmentOnly:true };
fake.onBeforeCompile = shader => { shader.vertexShader = 'unsafe vertex replacement'; };
assert.equal(isSkyAppearanceMaterial(fake), false); add('habitat-details-solid', fake);
const copied = new THREE.MeshLambertMaterial(); copied.onBeforeCompile = sources[0].material.onBeforeCompile;
assert.equal(isSkyAppearanceMaterial(copied), false); add('habitat-details-ground', copied);
const replaced = new THREE.MeshLambertMaterial(); restorers.push(installSkyAppearance(replaced,uniform));
replaced.onBeforeCompile = fake.onBeforeCompile;
assert.equal(isSkyAppearanceMaterial(replaced),false); add('habitat-details-botanical',replaced);
const other = new THREE.MeshLambertMaterial(); restorers.push(installSkyAppearance(other, uniform));
add('habitat-details-water', other);
const snapshot = sources.map(mesh => ({geometry:mesh.geometry,index:mesh.geometry.index,material:mesh.material,
  positions:Array.from(mesh.geometry.attributes.position.array),indices:Array.from(mesh.geometry.index.array)}));
const optimizer = optimizeStaticVisibility(scene);
assert.equal(optimizer.entries.length,3,'only exact audited names with privately branded fragment-only hooks eligible');
assert.deepEqual(optimizer.entries.map(entry=>entry.source),sources);
const camera = new THREE.PerspectiveCamera(60,16/9,.1,100); camera.updateMatrixWorld();
const render = () => {
  optimizer.entries.forEach((entry,i)=>assert.equal(entry.proxy.material,snapshot[i].material,'live sky uniform material shared'));
};
optimizer.render({render,xr:{isPresenting:false}},camera);
assert.throws(()=>optimizer.render({render(){throw new Error('renderer guard');}},camera),/renderer guard/);
for(let i=0;i<sources.length;i++){
  const mesh=sources[i], saved=snapshot[i];
  assert.equal(mesh.material,saved.material); assert.equal(mesh.geometry,saved.geometry); assert.equal(mesh.geometry.index,saved.index);
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),saved.positions);
  assert.deepEqual(Array.from(mesh.geometry.index.array),saved.indices);
}
optimizer.dispose(); restorers.forEach(stop=>stop?.());
for(const mesh of root.children){mesh.geometry.dispose();mesh.material.dispose();}
console.log('round-four integration PASS: unchanged config/colliders, discovery pause/G wiring, shared time call order, exact privately audited static shaders, canonical restoration');
