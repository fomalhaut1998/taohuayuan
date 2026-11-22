import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { collectDiscoveryTargets, resolveDiscoveryTarget, discoveryScore } from '../src/systems/discovery-targets.js';
import { createDiscovery } from '../src/systems/discovery.js';
import { observationScore, sightBlocked } from '../src/systems/observation.js';
import { installDOM } from './helpers/field-guide-dom.mjs';
const field = { sample: () => 0 }, eye = { x: 0, y: 1.6, z: 0 }, forward = { x: 0, y: 0, z: -1 };
const animal = { kind: 'bird', x: 2, y: 0, z: -4, lift: 1 }, hull = { name: 'boat-0', position: { x: 5, y: .2, z: -3 } };
const own = { x: 0, z: -4, hw: .75, hd: .75, rot: 0, minY: 0, maxY: 3, source: 'well-0', part: 'well' };
const fixture = { field, world: { terrain: { waterLevel: .2 } }, flora: { spots: [[1, 0, -3]], nearSpots: [[2, 0, -3]] },
  village: { bamboo: [[3, -3, 1]], mulberry: [[4, -3, 1, 2]], plots: [[5, -3]], pond: { x: 6, z: -3, waterY: .2 } },
  villageLife: { items: [{ kind: 'well', x: 0, z: -4 }], blockers: [own] }, props: { marks: [{ kind: 'basket', x: 7, z: -3 }, { kind: 'unknown', x: 99, z: 99 }] },
  cliff: { slit: { x: 8, z: -3, ground: 0 } }, riverSpine: [[9, -3]], fauna: { animals: [animal] },
  hinterland: { trees: [{ kind: 'mulberry', x: 10, y: 0, z: -3 }, { kind: 'unknown', x: 99, y: 0, z: 99 }], bamboo: [{ x: 11, y: 0, z: -3 }] },
  boats: { group: { children: [hull, { name: 'mooring', position: { x: 90, y: 0, z: 90 } }] } },
  habitatDetails: { targets: [{ id: 'fern', x: 12, y: .3, z: -3 }, { id: 'imaginary', x: 99, y: 0, z: 99 }] },
  villageScenes: { details: [{ scene: 'mystery', kind: 'well' }], scenes: [{ x: 99, z: 99 }] } };
const targets = collectDiscoveryTargets(fixture);
assert.equal(targets.length, 15); assert(!targets.some(t => t.x === 99 || t.x === 90), 'unknown kinds, moorings and positionless scene detail are not invented as targets');
assert.equal(targets.filter(t => t.id === 'peach').length, 2); assert.equal(targets.find(t => t.id === 'well').ownBlocker, own);
assert.deepEqual(collectDiscoveryTargets(), []);
const liveBird = targets.find(t => t.id === 'bird'), liveBoat = targets.find(t => t.id === 'boat');
animal.x = 4; animal.lift = 2; hull.position.y = .6;
assert.equal(resolveDiscoveryTarget(liveBird).x, 4); assert.equal(resolveDiscoveryTarget(liveBird).y, 2.3); assert(Math.abs(resolveDiscoveryTarget(liveBoat).y - .9) < 1e-9);
const well = targets.find(t => t.id === 'well');
assert(Number.isFinite(discoveryScore(eye, forward, well, [own], field)), 'exact own small blocker permits sight of its near face');
const wall = { x: 0, z: -2, hw: 2, hd: .2, minY: 0, maxY: 3 }; // no rot defaults safely to zero
assert.equal(discoveryScore(eye, forward, well, [own, wall], field), Infinity, 'near-face logic never ignores another wall');
assert.equal(discoveryScore(eye, forward, { ...well, range: 3.5 }, [own], field), Infinity, 'near face cannot extend center range');
assert.equal(discoveryScore(eye, forward, { ...well, ownBlocker: null }, [own], field), Infinity, 'unverified own blocker remains opaque');
assert.equal(discoveryScore(eye, forward, well, [], { sample: () => 4 }), Infinity, 'terrain occlusion');
assert.equal(observationScore(eye, forward, { x: NaN, y: 1, z: -3 }, 6, [], field), Infinity);
assert(sightBlocked(eye, { x: 0, y: 1, z: -3 }, [], null), 'missing field is not clear-sight evidence');
assert(sightBlocked(eye, { x: 0, y: 1, z: -3 }, [], { sample: () => NaN }), 'invalid terrain sample is not clear-sight evidence');

const dom = installDOM(), camera = new PerspectiveCamera(60, 1000 / 700, .1, 100);
camera.position.set(0, 1.6, 0); camera.updateMatrixWorld();
let clears = 0, canOpen = true, journalOpen = false; const recorded = [];
const player = { state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, eyeHeight: 1.6 }, clearInput() { clears++; } };
const journal = { isOpen: () => journalOpen, observe(id) { const fresh = !recorded.includes(id); if (fresh) recorded.push(id); return fresh; } };
const baselineWindow = dom.win.listenerCount(), baselineDoc = dom.doc.listenerCount();
const habitatDetails = { targets: [{ id: 'fern', x: 0, y: 1.6, z: -4 }] };
const discovery = createDiscovery({ camera, player, canvas: dom.canvas, field, journal, habitatDetails, canOpen: () => canOpen });
assert.equal(discovery.openCurrent(), false, 'cannot open before enabled update');
discovery.update(0, true); assert.equal(discovery.current.id, 'fern'); assert.equal(discovery.getStats().labelVisible, true); assert.deepEqual(recorded, [], 'looking does not collect');
const label = dom.doc.getElementById('discovery-label'), oldLeft = label.style.left;
camera.position.x = .2; camera.updateMatrixWorld();
discovery.update(.016, true); assert.notEqual(label.style.left, oldLeft, 'projection follows camera between selection ticks'); assert.equal(discovery.getStats().selections, 1);
for (let i = 0; i < 8; i++) discovery.update(.016, true);
assert.equal(discovery.getStats().selections, 1, 'selection throttles'); assert(discovery.getStats().projections >= 10, 'projection remains per-frame');
dom.key('KeyG'); dom.key('KeyE'); assert.deepEqual(recorded, [], 'module does not own G or reinterpret E');
player.state.yaw = Math.PI; assert.equal(discovery.openCurrent(), false, 'G rechecks player cone before next update'); assert.deepEqual(recorded, []); player.state.yaw = 0;
discovery.update(.2, true); assert(discovery.openCurrent()); assert(discovery.isOpen); assert.deepEqual(recorded, ['fern']); assert(label.hidden); assert(clears > 0);
let leaks = 0; const gameplay = () => leaks++; dom.win.addEventListener('keydown', gameplay);
for (const code of ['KeyG', 'KeyE', 'KeyT', 'KeyR', 'KeyM', 'KeyJ', 'KeyV', 'KeyW']) dom.key(code);
assert.equal(leaks, 0, 'dialog stops gameplay shortcut propagation');
discovery.update(0, false); assert(discovery.isOpen, 'paused update must not close the detail');
const tab = dom.key('Tab'); assert(tab.defaultPrevented); assert.equal(dom.doc.activeElement.className, 'field-guide__close');
dom.key('Escape'); assert(!discovery.isOpen); assert.equal(dom.doc.activeElement, dom.canvas); assert(!dom.doc.body.classList.contains('field-guide-open'));
dom.win.removeEventListener('keydown', gameplay);
discovery.update(.2, true); assert(discovery.openCurrent()); assert.deepEqual(recorded, ['fern'], 'repeat opening is deduplicated by journal'); discovery.close();
for (const blocked of ['map', 'journal', 'story', 'editable', 'hidden', 'paused', 'other-dialog']) {
  let other;
  if (blocked === 'map') dom.doc.body.classList.add('map-open');
  if (blocked === 'journal') journalOpen = true;
  if (blocked === 'story') canOpen = false;
  if (blocked === 'editable') { other = dom.doc.createElement('input'); dom.doc.body.append(other); other.focus(); }
  if (blocked === 'hidden') dom.doc.hidden = true;
  if (blocked === 'other-dialog') { other = dom.doc.createElement('dialog'); dom.doc.body.append(other); other.showModal(); }
  discovery.update(.2, blocked !== 'paused'); assert.equal(discovery.openCurrent(), false, blocked + ' cannot capture'); assert(label.hidden);
  dom.doc.body.classList.remove('map-open'); journalOpen = false; canOpen = true; dom.doc.hidden = false; other?.remove(); dom.canvas.focus();
}
dom.win.dispatchEvent(new Event('blur')); discovery.update(.2, true); assert.equal(discovery.openCurrent(), false, 'blur remains blocked across frames'); dom.win.dispatchEvent(new Event('focus'));
discovery.update(.2, true); assert(discovery.current); assert(discovery.openCurrent()); dom.doc.getElementById('field-guide').dispatchEvent(new Event('cancel', { cancelable: true })); assert(!discovery.isOpen);
discovery.dispose(); discovery.dispose(); assert.equal(dom.win.listenerCount(), baselineWindow); assert.equal(dom.doc.listenerCount(), baselineDoc); assert.equal(dom.doc.getElementById('field-guide'), null); assert.equal(dom.doc.getElementById('discovery-label'), null); assert.equal(discovery.openCurrent(), false);
// No-match scenes should still honor the selection interval.
const empty = createDiscovery({ camera, player, canvas: dom.canvas, field }); empty.update(0, true); for (let i = 0; i < 8; i++) empty.update(.016, true); assert.equal(empty.getStats().selections, 1); empty.dispose();
// A current animal must resolve movement, including between update and G.
const moving = { kind: 'dog', x: 0, y: 0, z: -4, lift: 1.3 };
const dynamic = createDiscovery({ camera, player, canvas: dom.canvas, field, journal, fauna: { animals: [moving] } });
dynamic.update(0, true); assert.equal(dynamic.current.id, 'dog'); moving.z = 4; assert.equal(dynamic.openCurrent(), false); assert.deepEqual(recorded, ['fern']); dynamic.dispose();
console.log('discovery checks passed: real-instance provenance, live anchors, exact own-blocker LOS, wall/terrain rejection, projection throttle, stale G, modal focus/Esc/Tab, pause/editable/map/story/foreground guards, no auto-record, disposal');
