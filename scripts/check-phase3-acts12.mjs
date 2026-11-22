import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';
import { planMysterySites } from '../src/world/mysteries.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createCaveGleam } from '../src/world/cave-gleam.js';
import { createHospitalityFeast } from '../src/world/hospitality-feast.js';
import { createDialogue } from '../src/systems/dialogue.js';
import { createOpeningCurtain } from '../src/systems/opening-curtain.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const scriptText = readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8');
const script = JSON.parse(scriptText);
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const subtitlesJs = readFileSync(new URL('../src/systems/subtitles.js', import.meta.url), 'utf8');

// Mock minimal DOM for canvas/dialogue/curtain checks
const nodes = new Map();
function mockEl(id) {
  if (!nodes.has(id)) {
    const classes = new Set();
    nodes.set(id, {
      id,
      textContent: '',
      style: {},
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      setAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll: () => [],
    });
  }
  return nodes.get(id);
}
const bodyClasses = new Set();
globalThis.document = {
  hidden: false,
  createElement: () => ({ getContext: () => new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => t[k] ?? (() => {}) }) }),
  getElementById: mockEl,
  body: { classList: { add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c), contains: c => bodyClasses.has(c) } }
};
globalThis.window = {
  location: { search: '' },
  addEventListener() {},
  removeEventListener() {},
  setTimeout: () => 1,
  clearTimeout() {}
};

// 1. Curtain & Act 1/2/3 manual script gate
assert.ok(indexHtml.includes('id="veil"') && indexHtml.includes('ink-curtain-half'), 'index.html holds ink curtain');
assert.ok(subtitlesJs.includes('curtain-open'), 'subtitles wait on curtain-open');
const npcText = JSON.stringify(script.npc || {});
for (const forbidden of ['处处志', '太守', '刘子骥', '遂迷', '不复得路']) {
  assert.ok(!npcText.includes(forbidden), 'Act 3 excluded from ambient script.npc: ' + forbidden);
  const leakedAuto = script.points.filter(p => !p.manual && JSON.stringify(p).includes(forbidden));
  assert.equal(leakedAuto.length, 0, 'Act 3 lines remain manual-gated: ' + forbidden);
}
for (const id of ['peach-grove', 'cave-glimmer', 'valley-open', 'feast-invite', 'feast-history']) {
  assert.ok(script.points.some(p => p.id === id), 'Act 1/2 narrative point present: ' + id);
}
for (const id of ['act3-farewell', 'act3-mark-trail', 'act3-prefect-return', 'act3-lost-way', 'act3-no-seeker']) {
  const pt = script.points.find(p => p.id === id);
  assert.ok(pt, 'Act 3 narrative point present: ' + id);
  assert.equal(pt.manual, true, 'Act 3 narrative point stays manual: ' + id);
}
assert.equal(script.points.find(p => p.id === 'feast-history').manual, true, 'feast-history awaits villager conversation');

let soundUnlocked = false;
const curtain = createOpeningCurtain({ sound: { unlock() { soundUnlocked = true; } }, veilEl: mockEl('veil') });
assert.equal(curtain.isOpen(), false);
curtain.openNow();
assert.equal(curtain.isOpen(), true);
assert.equal(soundUnlocked, true);
assert.equal(bodyClasses.has('curtain-parting') && bodyClasses.has('curtain-open'), true);
assert.equal(curtain.triggerValleyBloom(), true);
assert.equal(curtain.triggerValleyBloom(), false, 'emergence bloom fires once');
curtain.dispose();

// 2. Build full terrain + cliff + community worlds
const curve = createRiverCurve(world.stream.points);
const river = createRiverDistance(sampleRiverSpine(curve, 160));
const height = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from({ length: grid.attributes.position.count }, (_, i) => height(grid.attributes.position.getX(i), grid.attributes.position.getZ(i)));
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const cliff = createCliff(world.cliff, field);
const basin = world.terrain.basin;
const floraField = { half: field.half, sample: (x, z) => field.sample(x, z), slope: (x, z) => Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z) };
const near = (x, z) => Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34 || Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40 || world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);
const flora = createFlora(world.flora, floraField, river, curve, world.player.spawn, near);
const boats = createBoats(world.boats, { surfaceY: () => world.terrain.waterLevel }, world.terrain, curve, field);
const village = createVillage(structuredClone(world.village), field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const scenes = createVillageScenes(world, field, river, village, props, cliff, hinterland);
const sites = planMysterySites(world, field, river, village, props, cliff, hinterland, scenes, flora);
const life = createVillageLife(world, field, river, village, props, cliff, hinterland, scenes, { sites });
const exterior = createExteriorExploration(world, field, river, curve, flora, boats, cliff);
const options = { world, field, distanceToRiver: river, riverCurve: curve, flora, hinterland, village, villageScenes: scenes, villageLife: life, props, boats, cliff, exterior };
options.habitatDetails = createHabitatDetails(options);
const pondLife = createPondLife(options);
const waterworks = createWaterworks({ ...options, reservations: [pondLife] });
const grove = createLeisureGrove({ ...options, reservations: [pondLife, waterworks] });

// Spatial assertions
const wheel = waterworks.layout.wheels[0];
assert.ok(Math.hypot(wheel.x - world.cliff.center[0], wheel.z - world.cliff.center[1]) < world.cliff.radius - 14, 'waterwheel sits at interior basin foothill');
assert.ok(waterworks.layout.springs.length === 1 && waterworks.layout.springs[0].y > wheel.y, 'mountain springhead above foothill wheel');
assert.ok(grove.layout.brook.points.length >= 6 && grove.layout.bridge.midDeckBottomY > grove.layout.brook.underBridgeWaterY + 0.15, 'shallow brook flows underneath arched footbridge');

// 3. Cave gleam optics & emergence callback
const gleam = createCaveGleam({ world, cliff, field });
const outX = Math.cos(cliff.slit.angle), outZ = Math.sin(cliff.slit.angle);
gleam.update(0.016, 0.5, { x: cliff.slit.x + outX * 16, y: 3, z: cliff.slit.z + outZ * 16 }, { getAppearance: () => ({ nightAmount: 0 }) }, () => {});
assert.ok(gleam.getStats().intensity > 0.5 && gleam.group.visible, 'gleam glows strongly on exterior slit approach');
gleam.update(0.016, 1.0, { x: cliff.slit.x - outX * 4.5, y: 3, z: cliff.slit.z - outZ * 4.5 }, { getAppearance: () => ({ nightAmount: 0 }) }, () => {});
assert.equal(gleam.group.visible, false, 'gleam fades out cleanly before camera intersects glow disc');
let opened = 0;
gleam.update(0.016, 1.5, { x: cliff.slit.x - outX * 16, y: 3, z: cliff.slit.z - outZ * 16 }, { getAppearance: () => ({ nightAmount: 0 }) }, () => { opened++; });
assert.equal(opened, 1, 'valley emergence bloom fires upon basin entry');
gleam.group.traverse(o => { if (o.isMesh) assert.equal(o.material.userData.skyIgnore, true, 'gleam ignores sky dimming'); });
gleam.setSuppressed(true);
assert.equal(gleam.getStats().suppressed, true);
assert.equal(gleam.group.visible, false, 'suppressed gleam stays hidden');
gleam.reset();
assert.equal(gleam.getStats().suppressed, false, 'gleam reset restores active glow');
gleam.dispose();

// 4. Act 2 Feast + Dialogue + Journal compatibility
const extraBlockers = [...grove.blockers];
const feast = createHospitalityFeast({ ...options, reservations: [pondLife, waterworks, grove], targetBlockers: extraBlockers });
assert.equal(feast.getStats().built, true);
assert.equal(feast.getStats().villagers, 3);
assert.ok(extraBlockers.some(b => b.source === 'feast-table'));
feast.group.traverse(o => {
  if (o.isMesh && !o.material.userData?.skyIgnore) assert.equal(o.material.transparent, false);
});
for (const c of feast.getInteractables()) {
  assert.ok(/^c_[\w-]+$/.test(c.key), 'feast villager key accepted by journal.js: ' + c.key);
  assert.ok(script.npc.roles[c.role]?.lines.length >= 2, 'role dialogue lines present for ' + c.role);
}

const classicLog = [];
const dlg = createDialogue(script, p => classicLog.push(p));
assert.equal(dlg.update({ x: feast.layout.site.x, z: feast.layout.site.z }, 0.016), 'feast-invite');
assert.equal(dlg.hasFired('feast-history'), false, 'manual point never auto-fires by proximity alone');
feast.setOnTalk(() => dlg.trigger('feast-history'));
feast.greet('feast-host-0', feast.layout.site.x + 2, feast.layout.site.z + 2, 3);
assert.equal(dlg.hasFired('feast-history'), true);
assert.ok(classicLog.some(p => p.id === 'feast-history' && p.classic.includes('乃不知有汉')), '乃不知有汉 logged via manual talk');
feast.update(0.05, 1.0, { getAppearance: () => ({ nightAmount: 0.7 }) }, { x: 24, z: -58 });
const feastCount = feast.getInteractables().length;
feast.dispose();
feast.dispose();
pondLife.dispose();
waterworks.dispose();
grove.dispose();

console.log(JSON.stringify({
  ok: true,
  wheel: { x: wheel.x, y: wheel.y, z: wheel.z },
  brook: { spring: grove.layout.brook.spring, mouth: grove.layout.brook.mouth, clearance: +(grove.layout.bridge.midDeckBottomY - grove.layout.brook.underBridgeWaterY).toFixed(3) },
  feast: { site: feast.layout.site, interactables: feastCount }
}));
