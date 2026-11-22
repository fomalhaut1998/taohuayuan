import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Scene, Group } from 'three';
import { installDOM } from './helpers/field-guide-dom.mjs';
import { createDiscovery } from '../src/systems/discovery.js';
import { createGodFlight } from '../src/systems/god-flight.js';
import { createPlayer } from '../src/player/controller.js';
import { createRiverCurve } from '../src/world/stream.js';
import { createRiverSkiff } from '../src/systems/river-skiff.js';
import { interactionAllowed } from '../src/systems/mysteries.js';
import { createQuiet } from '../src/systems/quiet.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

const dom = installDOM();
dom.journalMarkup();

const field = { sample: () => world.terrain.waterLevel - 0.5, slope: () => 0.05 };
const camera = new PerspectiveCamera(60, 1000 / 700, 0.1, 400);
camera.position.set(0, 1.6, 0);
camera.updateMatrixWorld();

const recorded = [];
const journal = {
  isOpen: () => false,
  observe(id) {
    const fresh = !recorded.includes(id);
    if (fresh) recorded.push(id);
    return fresh;
  }
};

const player = createPlayer(dom.canvas, world.player, field, world.terrain, null, {});
player.state.x = 0;
player.state.y = 0;
player.state.z = 0;
player.state.yaw = 0;
player.state.targetYaw = 0;
player.state.camYaw = 0;
player.state.pitch = -0.55;
player.state.targetPitch = -0.55;
player.state.camPitch = -0.55;
player.syncCamera(camera);

const discovery = createDiscovery({
  camera,
  player,
  canvas: dom.canvas,
  field,
  journal,
  world,
  riverSpine: [[0, -4]]
});

const avatar = { group: new Group(), update() {} };
const scene = new Scene();
const godFlight = createGodFlight({
  scene,
  camera,
  player,
  avatar,
  canvas: dom.canvas,
  world,
  field,
  doc: dom.doc,
  win: dom.win
});

const quietNotice = dom.doc.createElement('div');
quietNotice.id = 'quiet-notice';
const origToggle = quietNotice.classList.toggle;
quietNotice.classList.toggle = origToggle || ((cls, force) => {
  if (force) quietNotice.classList.add(cls);
  else quietNotice.classList.remove(cls);
});
dom.doc.body.append(quietNotice);
const quiet = createQuiet(player, dom.canvas, [{ x: 0, z: 0, radius: 8, name: '溪声' }], {
  doc: dom.doc,
  win: dom.win
});

// 1. On foot before flight: stream indicator is visible, interaction and quiet prompt are allowed.
discovery.update(0.2, true);
const label = dom.doc.getElementById('discovery-label');
assert.equal(discovery.current?.id, 'stream', 'stream discovery target active before flight');
assert.equal(label.hidden, false, 'discovery label visible before flight');
assert.equal(interactionAllowed(null, dom.doc), true, 'ground interaction allowed before flight');
quiet.update();
assert.ok(quietNotice.textContent.includes('溪声'), 'quiet notice shown before flight');

// 2. Enter godFlight: discovery label hides immediately and stays suppressed even across frames.
assert.equal(godFlight.enter(), true);
assert.equal(player.state.godFlight, true, 'player.state.godFlight set on enter');
assert.equal(dom.doc.body.classList.contains('god-flight'), true, 'body.god-flight class set on enter');
assert.equal(interactionAllowed(null, dom.doc), false, 'interactionAllowed blocks ground prompts in flight');

const statsBeforeFlight = discovery.getStats();
discovery.update(0.2, true);
assert.equal(discovery.current, null, 'discovery.current cleared in flight mode');
assert.equal(label.hidden, true, 'discovery label hidden in flight mode');
assert.equal(discovery.openCurrent(), false, 'G cannot open discovery entry in flight mode');
assert.equal(discovery.nudgeEmpty(), false, 'G nudge suppressed in flight mode');
assert.equal(discovery.getStats().selections, statsBeforeFlight.selections, 'no selection runs during flight');
assert.equal(discovery.getStats().projections, statsBeforeFlight.projections, 'no projection runs during flight');

// Quiet notice is hidden and KeyC is ignored during flight.
quiet.update();
assert.equal(quietNotice.textContent, '', 'quiet notice cleared during flight');
dom.key('KeyC');
assert.equal(quiet.active, false, 'KeyC cannot enter quiet mode during flight');

// Pointer-locked mousemove and KeyV must not mutate ground player orientation/view during flight.
dom.doc.pointerLockElement = dom.canvas;
dom.win.dispatchEvent(new Event('mousemove'));
const yawBefore = player.state.targetYaw;
const moveEv = new Event('mousemove');
Object.assign(moveEv, { movementX: 120, movementY: -60 });
dom.doc.dispatchEvent(moveEv);
assert.equal(player.state.targetYaw, yawBefore, 'ground player yaw does not spin in flight');
assert.equal(player.state.view, 'third', 'defaults to third-person view before KeyV');
dom.key('KeyV');
assert.equal(player.state.view, 'third', 'KeyV does not toggle player view in flight');
dom.doc.pointerLockElement = null;

// 3. River skiff pauses punting during flight even when WASD is held.
const curve = createRiverCurve(world.stream.points);
const fakeStream = { surfaceY: () => world.terrain.waterLevel };
const skiffField = { sample: (x) => (Math.abs(x - 24) < 8 ? -2.2 : 1.5), slope: () => 0.05 };
const skiff = createRiverSkiff({ world, riverCurve: curve, stream: fakeStream, field: skiffField });
skiff.bind({
  player,
  avatar,
  camera,
  doc: dom.doc,
  win: dom.win,
  autoBoard: true
});

// Exit flight momentarily to confirm skiff rows normally, then re-enter flight to confirm pause.
assert.equal(godFlight.exit(), true);
assert.equal(player.state.godFlight, false, 'player.state.godFlight cleared on exit');
assert.equal(dom.doc.body.classList.contains('god-flight'), false, 'body.god-flight removed on exit');

dom.key('KeyW');
for (let i = 0; i < 12; i++) {
  skiff.update(0.05, i * 0.05, null, player.state, camera, false);
}
const tRowing = skiff.getStats().t;
assert.equal(skiff.getStats().punting, true, 'skiff punts normally outside flight');

assert.equal(godFlight.enter(), true);
dom.key('KeyW');
for (let i = 0; i < 20; i++) {
  skiff.update(0.05, (12 + i) * 0.05, null, player.state, camera, true);
}
assert.equal(skiff.getStats().punting, false, 'skiff punting pauses during flight');
assert.equal(skiff.getStats().t, tRowing, 'skiff position does not advance during flight');

// 4. Exit flight: discovery & skiff resume cleanly.
assert.equal(godFlight.exit(), true);
assert.equal(player.state.godFlight, false);
assert.equal(dom.doc.body.classList.contains('god-flight'), false);
skiff.disembark();
player.state.x = 0;
player.state.y = 0;
player.state.z = 0;
player.state.yaw = 0;
player.state.targetYaw = 0;
player.state.camYaw = 0;
player.state.pitch = -0.55;
player.state.targetPitch = -0.55;
player.state.camPitch = -0.55;
player.syncCamera(camera);
discovery.update(0.2, true);
assert.equal(discovery.current?.id, 'stream', 'discovery resumes after exiting flight');
assert.equal(label.hidden, false, 'discovery label reappears after exiting flight');

godFlight.dispose();
skiff.dispose();
discovery.dispose();
player.dispose();

console.log('god-flight indicator checks passed: discovery label suppressed, ground yaw/view/quiet locked, skiff punting paused, clean exit restoration');
