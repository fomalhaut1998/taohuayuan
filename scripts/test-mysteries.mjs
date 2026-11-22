import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createMysteries, fireflyWeather } from '../src/world/mysteries.js';
import { createMysterySystem, interactionAllowed } from '../src/systems/mysteries.js';
import { createInteraction } from '../src/systems/interaction.js';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createBarrier } from '../src/systems/barrier.js';
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url)));
const canvasContext = new Proxy({}, { get: () => () => canvasContext });
globalThis.document = { createElement: () => ({ getContext: () => canvasContext }) };
const river = createRiverDistance(sampleRiverSpine(createRiverCurve(world.stream.points), 160));
const height = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments); grid.rotateX(-Math.PI / 2);
const heights = new Float32Array(grid.attributes.position.count);
for (let i = 0; i < heights.length; i++) heights[i] = height(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const cliff = createCliff(world.cliff, field);
const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const scenes = createVillageScenes(world, field, river, village, props, cliff, hinterland);
const actual = createMysteries(world, field, river, village, props, cliff, hinterland, scenes);
assert.deepEqual(actual.sites.map(s => s.id), ['bell', 'chess', 'fireflies'], 'all three safe discoveries exist');
assert.ok(actual.stats.drawCalls <= 5, 'detail batching stays inside five draw budget');
assert.ok(actual.states.get('fireflies').flies.isPoints, 'all fireflies share a single Points draw');
const allBlockers = [...cliff.blockers, ...village.blockers, ...hinterland.blockers, ...scenes.blockers, ...actual.blockers];
const barrier = createBarrier(allBlockers);
for (const s of actual.sites) {
  assert.equal(s.y, field.sample(s.x, s.z));
  const position = { ...s.approach, vx: 0, vz: 0 };
  barrier.resolve(position, 0.42);
  assert.ok(Math.hypot(position.x - s.approach.x, position.z - s.approach.z) < 1e-8, s.id + ' reachable interaction front');
  for (const scene of [...scenes.mapData.scenes, ...scenes.mapData.nature]) assert.ok(Math.hypot(s.x - scene.x, s.z - scene.z) >= scene.radius + 1.65, 'full scenery footprint reserved');
  for (const p of [...hinterland.paths, ...scenes.mapData.paths]) for (let i = 1; i < p.points.length; i++) assert.ok(segmentDistance(s.x, s.z, p.points[i - 1], p.points[i]) > p.width / 2 + 1.65, 'routes not blocked');
}
actual.activate('bell'); actual.update(0.1, 100, { timeId: 'day' });
assert.notEqual(actual.states.get('bell').pivot.rotation.z, 0, 'bell physically swings');
actual.activate('chess'); actual.update(0.1, 1000, { timeId: 'day' });
assert.ok(actual.states.get('chess').piece.position.y > 0.815, 'chess stone actually moves');
assert.ok(actual.states.get('chess').trace.material.opacity > 0);
actual.update(0.1, 1001, { timeId: 'dusk', weatherId: 'clear' });
assert.ok(actual.states.get('fireflies').glow > 0);
assert.equal(fireflyWeather({ timeId: 'night', weatherId: 'rain', rainIntensity: 0 }), false, 'new rain selection immediately invalidates even before blend');
assert.equal(fireflyWeather({ timeId: 'day', weatherId: 'clear' }), false);
assert.equal(fireflyWeather({ timeId: 'dusk', weatherId: 'clear', rainIntensity: 0.4 }), false, 'lingering rain delays reappearance');
const positions = actual.sites.map(({ id, x, y, z, approach }) => ({ id, x, y, z, approach }));
let disposedGeos = 0; actual.group.traverse(o => { if (o.isMesh) o.geometry.addEventListener('dispose', () => disposedGeos++); });
actual.dispose(); const disposalCount = disposedGeos; actual.dispose(); assert.equal(disposedGeos, disposalCount); assert.ok(disposalCount > 0);

function classList() { const s = new Set(); return { add: (...xs) => xs.forEach(x => s.add(x)), remove: (...xs) => xs.forEach(x => s.delete(x)), contains: x => s.has(x) }; }
const nodes = new Map();
for (const id of ['prompt', 'prompt-text', 'reticle', 'talk', 'talk-who', 'talk-line', 'mystery-note', 'subtitle', 'classic', 'plain', 'journal']) nodes.set(id, { classList: classList(), textContent: '', open: false });
const doc = new EventTarget(); let focused = true, modal = false;
Object.assign(doc, { body: { classList: classList() }, hidden: false, activeElement: null, hasFocus: () => focused, getElementById: id => nodes.get(id), querySelector: () => modal ? {} : null });
globalThis.document = doc; globalThis.window = new EventTarget();
const flat = { sample: () => 0 };
const player = { state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, eyeHeight: 1.6, view: 'third' } };
const camera = { position: new THREE.Vector3(0, 1.6, 0) };
const sky = { timeId: 'night', weatherId: 'clear', rainIntensity: 0 };
const site = { id: 'bell', name: '钟', action: '轻叩', line: '山中一响', cooldown: 8, x: 0, y: 0, z: -2, height: 1.6 };
const fakeWorld = { sites: [site], states: new Map([['bell', { glow: 1 }]]), calls: 0, ticks: 0,
  activate() { this.calls++; return true; }, update() { this.ticks++; }, dispose() { this.disposed = true; } };
const walls = []; let bellCalls = 0;
const mysteries = createMysterySystem(fakeWorld, { player, sky, field: flat, blockers: walls, doc, sound: { unlock() { throw Error('no AudioContext'); }, bell() { bellCalls++; } } });
const cfg = world.interaction;
// This fixture imports production sound from a data URL: resolve its new real module dependencies explicitly.
const catalogue = JSON.parse(readFileSync(new URL('../src/data/audio-samples.json', import.meta.url), 'utf8'));
const soundSource = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8')
  .replace("import world from '../data/world.json';", 'const world = ' + JSON.stringify(world) + ';')
  .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = ' + JSON.stringify(catalogue) + ';')
  .replace("from './sample-audio.js'", 'from ' + JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(soundSource).toString('base64'));
const silentSound = createSound(); assert.equal(silentSound.context, null, 'no auto-play or context before gesture');
assert.equal(silentSound.unlock(), false, 'no AudioContext degrades safely'); assert.equal(silentSound.bell(0, 0), false);
let contextAttempts = 0; window.AudioContext = class { constructor() { contextAttempts++; throw Error('denied'); } };
assert.doesNotThrow(() => silentSound.unlock()); assert.ok(contextAttempts > 0); delete window.AudioContext;

let graphAttempts = 0, closedAttempts = 0;
const audioParam = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
const audioNode = (extra) => Object.assign({ connect() {}, disconnect() {} }, extra || {});
window.AudioContext = class {
  constructor() {
    graphAttempts++;
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 8;
    this.destination = audioNode();
  }
  createGain() {
    if (graphAttempts === 1) throw Error('graph interrupted');
    return audioNode({ gain: audioParam() });
  }
  createDynamicsCompressor() {
    return audioNode({ threshold: audioParam(), knee: audioParam(), ratio: audioParam(), attack: audioParam(), release: audioParam() });
  }
  createAnalyser() { return audioNode({ fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 0 }); }
  createConvolver() { return audioNode({ buffer: null }); }
  createBuffer(channels, n, sr) { return { duration: n / sr, getChannelData: () => new Float32Array(n) }; }
  createBiquadFilter() { return audioNode({ type: '', frequency: audioParam(), Q: audioParam() }); }
  createBufferSource() { return audioNode({ buffer: null, loop: false, loopStart: 0, loopEnd: 0, start() {}, stop() {} }); }
  createStereoPanner() { return audioNode({ pan: audioParam() }); }
  resume() { return Promise.resolve(); }
  close() { closedAttempts++; return Promise.resolve(); }
};
const retrySound = createSound();
assert.equal(retrySound.unlock(), false, 'partial graph fails safely');
assert.equal(retrySound.context, null, 'failed context is cleared for a later gesture');
assert.equal(retrySound.getStats().context, 'none', 'public diagnostics report no active context');
assert.equal(retrySound.unlock(), true, 'a later gesture retries the complete graph');
assert.equal(graphAttempts, 2, 'both genuine attempts construct a context');
assert.equal(closedAttempts, 1, 'partial context is closed without throwing');
delete window.AudioContext;

assert.equal(mysteries.pickTarget(camera, cfg)?.kind, 'mystery');
player.state.view = 'first'; assert.equal(mysteries.pickTarget(camera, cfg)?.kind, 'mystery', 'keyboard first person does not need pointer lock'); player.state.view = 'third';
const oldSample = flat.sample; flat.sample = () => 4; assert.equal(mysteries.pickTarget(camera, cfg), null, 'terrain rise blocks line of sight'); flat.sample = oldSample;
assert.equal(interactionAllowed({ target: { closest: () => ({}) } }, doc), false, 'event target control gate independent of active focus');
player.state.yaw = Math.PI; assert.equal(mysteries.pickTarget(camera, cfg), null, 'facing away'); player.state.yaw = 0;
player.state.z = 9; assert.equal(mysteries.pickTarget(camera, cfg), null, 'too far'); player.state.z = 0;
walls.push({ x: 0, z: -1, hw: 1, hd: 0.1, rot: 0, minY: 0, maxY: 3 }); assert.equal(mysteries.pickTarget(camera, cfg), null, 'occluded'); walls.length = 0;
for (const key of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat', 'isComposing', 'defaultPrevented']) assert.equal(interactionAllowed({ [key]: true }, doc), false, key);
for (const tag of ['button', 'input', 'select', 'contenteditable', 'role=button']) { doc.activeElement = { closest: () => ({ tag }) }; assert.equal(interactionAllowed(null, doc), false, tag); } doc.activeElement = null;
for (const kind of ['map-open', 'ui-hidden']) { doc.body.classList.add(kind); assert.equal(mysteries.pickTarget(camera, cfg), null); doc.body.classList.remove(kind); }
nodes.get('journal').open = true; assert.equal(interactionAllowed(null, doc), false); nodes.get('journal').open = false;
modal = true; assert.equal(interactionAllowed(null, doc), false); modal = false;
doc.hidden = true; assert.equal(interactionAllowed(null, doc), false); doc.hidden = false;
focused = false; assert.equal(interactionAllowed(null, doc), false); focused = true;
nodes.get('subtitle').classList.add('show'); assert.equal(mysteries.pickTarget(camera, cfg), null); nodes.get('subtitle').classList.remove('show');
const people = { list: [{ x: 0, z: -1.5, s: 1, role: 'villager' }], calls: 0, greet() { this.calls++; } };
const fauna = { animals: [], react() {} };
const interaction = createInteraction(cfg, { npc: { roles: { villager: { name: '村人', lines: ['山水好'] } } } }, people, fauna, flat, player, { voice() {} }, null, walls, mysteries);
function press(options = {}) { const e = new Event('keydown', { cancelable: true }); Object.assign(e, { code: 'KeyE', ...options }); window.dispatchEvent(e); }
interaction.update(0, 0, camera); press(); assert.equal(people.calls, 1); assert.equal(fakeWorld.calls, 0, 'one E never fires NPC plus mystery');
interaction.update(10, 0, camera); people.list.length = 0; interaction.update(0, 0, camera);
press({ shiftKey: true }); assert.equal(fakeWorld.calls, 0);
player.state.z = 8; press(); assert.equal(fakeWorld.calls, 0, 'keydown refreshes old cached focus'); player.state.z = 0;
press(); assert.equal(fakeWorld.calls, 1); assert.equal(bellCalls, 0, 'audio failure does not throw'); assert.ok(nodes.get('mystery-note').classList.contains('show'));
press(); assert.equal(fakeWorld.calls, 1, 'cooldown blocks repeats');
const before = mysteries.getState(); const ticks = fakeWorld.ticks;
for (const gate of ['map', 'journal', 'hidden', 'background', 'modal']) {
  if (gate === 'map') doc.body.classList.add('map-open');
  if (gate === 'journal') nodes.get('journal').open = true;
  if (gate === 'hidden') doc.body.classList.add('ui-hidden');
  if (gate === 'background') doc.hidden = true;
  if (gate === 'modal') modal = true;
  mysteries.update(5, 100); interaction.update(5, 100, camera); press();
  assert.equal(mysteries.getState().timer, before.timer, gate + ' freezes note');
  assert.equal(mysteries.getState().cooldowns.bell, before.cooldowns.bell, gate + ' freezes cooldown');
  assert.equal(fakeWorld.ticks, ticks, gate + ' freezes visuals');
  assert.equal(nodes.get('mystery-note').classList.contains('show'), false, gate + ' hides note');
  doc.body.classList.remove('map-open', 'ui-hidden'); nodes.get('journal').open = false; doc.hidden = false; modal = false;
}
for (let i = 0; i < 180; i++) mysteries.update(0.05, i);
press(); assert.equal(fakeWorld.calls, 2, 'repeat visit after cooldown');
// Weather changes between prompt frame and key event must invalidate the gesture.
site.id = 'fireflies'; fakeWorld.states.set('fireflies', { glow: 1 });
for (let i = 0; i < 180; i++) mysteries.update(0.05, i);
interaction.update(0, 0, camera); assert.equal(interaction.getFocus()?.kind, 'mystery');
sky.weatherId = 'rain'; press(); assert.equal(fakeWorld.calls, 2, 'no stale weather E');
assert.equal(mysteries.pickTarget(camera, cfg), null);
sky.weatherId = 'clear'; press(); assert.equal(fakeWorld.calls, 3);
sky.timeId = 'day'; mysteries.update(0.05, 0); assert.equal(nodes.get('mystery-note').classList.contains('show'), false, 'weather-gated note clears with event');
interaction.dispose(); interaction.dispose(); mysteries.dispose(); mysteries.dispose(); press(); assert.equal(fakeWorld.calls, 3, 'disposed listeners removed'); assert.equal(mysteries.pickTarget(camera, cfg), null); assert.equal(fakeWorld.disposed, true);
console.log(JSON.stringify({ pass: true, drawCalls: actual.stats.drawCalls, triangles: actual.stats.triangles, positions, coverage: 'safe placement, real visual motion, single E arbitration, controls/modifiers/modal/background/hidden gates, refreshed distance/weather, occlusion, cooldown/pause, audio failure, disposal' }));
