import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createCliff } from '../src/world/cliff.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createValleyBorderlands } from '../src/world/valley-borderlands.js';
import { createOuterWilds } from '../src/world/outer-wilds.js';
import { createWulingOutskirts } from '../src/world/wuling-outskirts.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createWaterBuffaloParts, createYellowDogParts } from '../src/world/qin-han-fauna-geometry.js';
import { attachGroundSurface } from '../src/world/ground-surface.js';
import { makeShoe } from '../src/character-parts.js';
import { createAvatar } from '../src/player/avatar.js';
import { createPeople } from '../src/world/people.js';
import { createFauna } from '../src/systems/fauna.js';
import { FAUNA_KIND, faunaPartAngle, sampleFaunaVertex } from '../src/systems/fauna-motion.js';
import { createWorldClock, formatModernEraTime, formatNextSolarEvent, getSolarTerm } from '../src/systems/world-clock.js';
import { createMap } from '../src/systems/map.js';
import { createScrollStudio } from '../src/systems/scroll-studio.js';
import { createJournal } from '../src/systems/journal.js';
import { createTravelerGuideAndCruise } from '../src/systems/traveler-guide-cruise.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { createFootstepFx } from '../src/systems/footstep-fx.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const mapThemeCss = readFileSync(new URL('../src/map-time-theme.css', import.meta.url), 'utf8');

const ctx2d = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => t[k] ?? (() => {}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d, style: {} }) };

// 1. Build real terrain + village + props + attachGroundSurface
const curve = createRiverCurve(world.stream.points);
const river = createRiverDistance(sampleRiverSpine(curve, 160));
const heightFn = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = new Float32Array(grid.attributes.position.count);
for (let i = 0; i < heights.length; i++) {
  heights[i] = heightFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
}
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
const cliff = createCliff(world.cliff, field);
const village = createVillage(structuredClone(world.village), field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const groundSurface = attachGroundSurface(field, { world, village, props });

// Road centerline must sit noticeably above raw bilinear field.sample
const roadMid = village.road.at(village.road.total * 0.5);
const rawRoadY = field.sample(roadMid.x, roadMid.z);
const walkedRoadY = field.walkSurface(roadMid.x, roadMid.z);
assert.ok(walkedRoadY > rawRoadY + 0.055, `walkSurface captures elevated village road camber (${rawRoadY.toFixed(3)} -> ${walkedRoadY.toFixed(3)})`);

const thresh = props.marks.find(m => m.kind === 'thresh');
if (thresh) {
  assert.ok(field.walkSurface(thresh.x, thresh.z) >= field.sample(thresh.x, thresh.z) + 0.11, 'walkSurface captures raised threshing floor');
}

// 2. Multi-tone Qin-Han shoe geometry & Avatar / Road Walker foot clearance
const shoeGeo = makeShoe(world.people);
const shoeColAttr = shoeGeo.getAttribute('color');
const shoeShades = new Set();
for (let i = 0; i < shoeColAttr.count; i++) {
  shoeShades.add(`${Math.round(shoeColAttr.getX(i) * 20)}_${Math.round(shoeColAttr.getY(i) * 20)}_${Math.round(shoeColAttr.getZ(i) * 20)}`);
}
assert.ok(shoeShades.size >= 3, `makeShoe has distinct sole, upper, and collar shades (${shoeShades.size})`);
shoeGeo.dispose();

const avatar = createAvatar(world.player.avatar, world.player.walkSpeed);
const legMeshL = avatar.group.getObjectByName('player-leg-l').children[0];
const legMeshR = avatar.group.getObjectByName('player-leg-r').children[0];
const pState = { x: roadMid.x, y: walkedRoadY, z: roadMid.z, yaw: 0, vx: 0, vz: world.player.walkSpeed };
const _v = new THREE.Vector3();
for (let step = 0; step < 60; step++) {
  avatar.update(1 / 60, step / 60, pState);
  avatar.group.updateMatrixWorld(true);
  for (const lm of [legMeshL, legMeshR]) {
    const pos = lm.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(lm.matrixWorld);
      assert.ok(_v.y >= pState.y - 0.002, `avatar shoe vertex never sinks underground during walk (minY=${(_v.y - pState.y).toFixed(4)})`);
    }
  }
}
avatar.dispose();

const people = createPeople(structuredClone(world.people), field, village.houseInfo, village.road, village.plots, village.blockers);
const shoeInst = people.group.getObjectByName('people-shoe');
const _sm = new THREE.Matrix4();
for (let step = 0; step < 90; step++) {
  people.update(1 / 60, step / 60, 999, 999, { timeId: 'day', rainIntensity: 0 });
}
for (let i = 0; i < people.list.length; i++) {
  const person = people.list[i];
  if (person.mode !== 'road') continue;
  for (let side = 0; side < 2; side++) {
    shoeInst.getMatrixAt(i * 2 + side, _sm);
    const sole = new THREE.Vector3(0, -0.012, 0).applyMatrix4(_sm);
    const surfY = field.walkSurface(sole.x, sole.z);
    assert.ok(sole.y >= surfY - 0.004, `road walker shoe sole stays above rendered road surface (${sole.y.toFixed(3)} vs ${surfY.toFixed(3)})`);
  }
}

// 3. Fauna walking clearance, duck pond buoyancy, sleep leg-fold & watchdog / rain circadian behavior
const fauna = createFauna(structuredClone(world.fauna), field, {}, {
  blockers: village.blockers,
  pond: world.terrain.pond,
  waterLevel: world.terrain.waterLevel
});

// Verify no walking fauna vertex dips below local y = 0 across full walk phase
for (const mesh of fauna.group.children) {
  const g = mesh.geometry;
  const kind = g.userData.kind;
  for (const ph of [0, 0.8, 1.57, 2.4, 3.14, 4.71]) {
    let minLocalY = Infinity;
    for (let i = 0; i < g.attributes.position.count; i++) {
      const sv = sampleFaunaVertex(g, i, [ph, 1, 0, FAUNA_KIND[kind]]);
      if (sv.position.y < minLocalY) minLocalY = sv.position.y;
    }
    assert.ok(minLocalY >= -0.002, `${kind} walking limbs never dip below ground plane (minLocalY=${minLocalY.toFixed(4)})`);
  }
}

// Verify sleeping chicken stops pecking & flapping, and sleeping legs fold upward
const peckPhase = Math.PI / (2 * 0.7);
assert.ok(Math.abs(faunaPartAngle([1, 1, 0], [peckPhase, -1, 0, FAUNA_KIND.chicken]) - 0.22) < 1e-6, 'sleeping chicken tucks head and suppresses ground pecking');
assert.equal(faunaPartAngle([4, 1, 0], [1.3, -1, 0, FAUNA_KIND.bird]), 0, 'sleeping bird stills wings');

// Ducks inside pond float at pond.waterY instead of sinking to pond bed
fauna.update(0.05, 0.05, 999, 999, { timeId: 'day', rainIntensity: 0, pond: world.terrain.pond });
const pondDuck = fauna.animals.find(a => a.kind === 'duck' && Math.hypot(a.x - world.terrain.pond.x, a.z - world.terrain.pond.z) < 9.0);
if (pondDuck) {
  assert.ok(pondDuck.y >= world.terrain.pond.waterY - 0.12, `pond duck floats on water surface (${pondDuck.y.toFixed(2)}) rather than pond bed`);
}

// Rain shelters chickens while ducks remain active
for (let i = 0; i < 240; i++) {
  fauna.update(0.05, 1 + i * 0.05, 999, 999, { timeId: 'day', rainIntensity: 0.55, pond: world.terrain.pond });
}
assert.ok(fauna.animals.some(a => a.kind === 'chicken' && a.mode === 'sleep'), 'chickens return & shelter during heavy rain');
assert.ok(fauna.animals.every(a => a.kind !== 'duck' || a.mode !== 'sleep'), 'ducks stay active on water during daytime rain');

// Nighttime sleep + rural watchdog wakes briefly when visitor approaches closely
for (let i = 0; i < 260; i++) {
  fauna.update(0.05, 15 + i * 0.05, 999, 999, { timeId: 'night', rainIntensity: 0, pond: world.terrain.pond });
}
const sleepDog = fauna.animals.find(a => a.kind === 'dog' && a.mode === 'sleep');
assert.ok(sleepDog, 'village dogs curl up to sleep at their doorway at night');
fauna.update(0.05, 29.0, sleepDog.x + 1.5, sleepDog.z + 1.5, { timeId: 'night', rainIntensity: 0, blockers: [] });
assert.equal(sleepDog.mode, 'watch', 'sleeping watchdog wakes to watch closely approaching night visitor');

// 4. Water Buffalo sculpted legs + Rooster & Hen/Chicks Dusk Return & Night Coop Sleep
const bufParts = createWaterBuffaloParts();
const dogParts = createYellowDogParts();
assert.ok(bufParts.legGeo && bufParts.legGeo.attributes.position.count >= 12, 'water buffalo has sculpted articulated leg+hoof geometry');
bufParts.bodyGeo.dispose(); bufParts.headGeo.dispose(); bufParts.earLGeo.dispose(); bufParts.earRGeo.dispose(); bufParts.legGeo.dispose();
dogParts.bodyGeo.dispose(); dogParts.headGeo.dispose(); dogParts.earGeo.dispose(); dogParts.tailGeo.dispose(); dogParts.legGeo.dispose();

const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const scenes = createVillageScenes(world, field, river, village, props, cliff, hinterland);
const flora = createFlora(world.flora, field, river, curve, world.player.spawn, () => false);
const mysteryWorld = createMysteries(world, field, river, village, props, cliff, hinterland, scenes, flora);
const villageLife = createVillageLife(world, field, river, village, props, cliff, hinterland, scenes, mysteryWorld);
const boats = createBoats(world.boats, { surfaceY: () => world.terrain.waterLevel }, world.terrain, curve, field);
const exterior = createExteriorExploration(world, field, river, curve, flora, boats, cliff);
const baseOpts = {
  world, field, distanceToRiver: river, riverCurve: curve, flora, hinterland,
  village, villageScenes: scenes, villageLife, props, boats, cliff, exterior, mysteryWorld,
  stream: { surfaceY: () => world.terrain.waterLevel }
};
baseOpts.habitatDetails = createHabitatDetails(baseOpts);
const pondLife = createPondLife({ ...baseOpts, reservations: [] });
const waterworks = createWaterworks({ ...baseOpts, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...baseOpts, reservations: [pondLife, waterworks] });
const homestead = createQinHanHomestead({ ...baseOpts, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove] });

// Dawn/day: rooster perched on woodpile
homestead.update(0.05, 1.0, { timeId: 'day', rainIntensity: 0, sunElevation: 0.7 }, { x: 0, z: 0 });
assert.equal(homestead.getStats().roosterMode, 'perch', 'daytime rooster perches on woodpile');
assert.equal(homestead.getStats().roosterPos.roostKind, 'coop', 'rooster locates reachable village chicken coop');

// Dusk: rooster hops down & walks toward chicken coop
for (let i = 0; i < 60; i++) {
  homestead.update(0.05, 2 + i * 0.05, { timeId: 'dusk', rainIntensity: 0, sunElevation: 0.04 }, { x: 0, z: 0 });
}
const duskSt = homestead.getStats();
assert.ok(duskSt.roosterPos.roostU > 0.35 && duskSt.roosterPos.roostU < 0.80, `dusk rooster walks homeward toward coop (roostU=${duskSt.roosterPos.roostU.toFixed(2)})`);

// Night: rooster & hen+chicks roost/sleep at chicken coop with zero crowing
homestead.consumeEvents();
for (let i = 0; i < 120; i++) {
  homestead.update(0.05, 6 + i * 0.05, { timeId: 'night', rainIntensity: 0, sunElevation: -0.4 }, { x: 0, z: 0 });
}
const nightSt = homestead.getStats();
assert.equal(nightSt.roosterMode, 'sleep', 'nighttime rooster sleeps at chicken coop');
assert.equal(nightSt.roosterCrowing, false, 'sleeping rooster does not crow at night');
assert.equal(nightSt.roosterWingSpread, 0, 'sleeping rooster folds wings tight');
assert.equal(nightSt.henSleeping, true, 'mother hen and chicks sleep calmly at coop nest at night');
assert.equal(homestead.consumeEvents().filter(e => e.type === 'roosterCrow').length, 0, 'zero roosterCrow events at night');
homestead.dispose();

// 5. Modern Era Date/Time Display (#sky-modern-time: 公元xx年xx月xx日 几时几分)
assert.ok(indexHtml.includes('id="sky-modern-time"'), 'index.html includes #sky-modern-time in #sky');
assert.ok(styleCss.includes('.sky__modern') && styleCss.includes('body.is-night .sky__modern'), 'style.css styles .sky__modern for both day and night');

assert.equal(formatModernEraTime(9.5, 1, 'spring').text, '公元386年04月06日 09时30分');
assert.equal(formatModernEraTime(17.75, 1, 'summer').text, '公元386年06月12日 17时45分');
assert.equal(formatModernEraTime(21.5, 1, 'autumn').text, '公元386年09月18日 21时30分');
assert.equal(formatModernEraTime(5.75, 13, 'winter').text, '公元387年01月01日 05时45分', 'year/month rollover across New Year works accurately');

// Solar countdown helper (sunrise 05:00 / sunset 17:00)
assert.equal(formatNextSolarEvent(9.5).label, '距日落约 7小时30分');
assert.equal(formatNextSolarEvent(16.5).label, '距日落约 30分钟');
assert.equal(formatNextSolarEvent(17.5).label, '距破晓约 11小时30分');
assert.equal(formatNextSolarEvent(4.3333).label, '距破晓约 40分钟');

// 24 Solar Terms mapping & boundary transitions
assert.equal(getSolarTerm(4, 6).name, '清明');
assert.equal(getSolarTerm(4, 20).name, '谷雨');
assert.equal(getSolarTerm(6, 12).name, '芒种');
assert.equal(getSolarTerm(6, 21).name, '夏至');
assert.equal(getSolarTerm(9, 18).name, '白露');
assert.equal(getSolarTerm(9, 23).name, '秋分');
assert.equal(getSolarTerm(12, 20).name, '大雪');
assert.equal(getSolarTerm(12, 21).name, '冬至');
assert.equal(getSolarTerm(1, 5).name, '小寒');
assert.equal(formatModernEraTime(9.5, 1, 'spring').solarTerm, '清明');
assert.equal(formatModernEraTime(9.5, 15, 'spring').solarTerm, '谷雨');

let mockSeason = 'spring';
let mockTimeId = 'day';
let modernClickHandler = null;
const hudToastEl = { textContent: '', classList: { add() {}, remove() {} } };
const hudModernEl = {
  textContent: '', title: '', style: {}, dataset: {},
  addEventListener(type, fn) { if (type === 'click') modernClickHandler = fn; },
  removeEventListener() {}
};
const hudTimeEl = { textContent: '', title: '', style: {}, dataset: {}, addEventListener() {} };
const clock = createWorldClock({
  sky: {
    get timeId() { return mockTimeId; },
    setTime(id) { mockTimeId = id; },
    setAuto() {}
  },
  smoke: {},
  getPhenology: () => ({ currentId: mockSeason }),
  doc: {
    getElementById(id) {
      if (id === 'sky-modern-time') return hudModernEl;
      if (id === 'sky-time') return hudTimeEl;
      if (id === 'sky-toast') return hudToastEl;
      return null;
    }
  },
  win: { location: { search: '' } },
  cycleSeconds: 24
});
assert.equal(hudModernEl.textContent, '公元386年04月06日 09时30分');
assert.equal(hudTimeEl.textContent, '昼·巳初');

clock.setHour(23.95);
assert.equal(hudModernEl.textContent, '公元386年04月06日 23时57分');
clock.update(0.1); // +0.1h across midnight -> dayCount = 2, 00:03
assert.equal(hudModernEl.textContent, '公元386年04月07日 00时03分', 'crossing midnight advances modern date by 1 day');
assert.ok(hudToastEl.textContent.includes('历日新添') && hudToastEl.textContent.includes('清明'), 'crossing midnight displays gentle calendar/solar-term toast');

// Crossing into a new solar term (清明 -> 谷雨 on Apr 20, dayCount = 15) triggers solar term whisper
for (let d = 0; d < 13; d++) {
  clock.setHour(23.95);
  clock.update(0.1);
}
assert.equal(clock.getState().solarTerm, '谷雨', 'advancing 14 days from Apr 6 reaches 谷雨 (Apr 20)');
assert.ok(hudToastEl.textContent.includes('节气更迭 · 谷雨'), 'entering a new solar term displays poetic solar-term whisper');

mockSeason = 'autumn';
clock.setHour(18.25);
assert.equal(hudModernEl.textContent, '公元386年10月02日 18时15分', 'switching season updates modern month/day while keeping elapsed dayCount');
assert.ok(hudModernEl.title.includes('秋分') && hudModernEl.title.includes('距破晓约'), 'HUD modern time tooltip includes active solar term and sunrise/sunset countdown');
assert.equal(hudModernEl.dataset.speed, '1x', 'default clock speed dataset is 1x');

// Shift+click enters 12x 观日影 mode and toggles back cleanly
assert.ok(typeof modernClickHandler === 'function', 'modern clock registers click handler');
modernClickHandler({ shiftKey: true, stopPropagation() {} });
assert.equal(clock.getState().speedScale, 12, 'Shift+click switches clock into 12x 观日影 mode');
assert.equal(hudModernEl.dataset.speed, '12x', '12x mode sets data-speed=12x badge');
modernClickHandler({ shiftKey: true, stopPropagation() {} });
assert.equal(clock.getState().speedScale, 1, 'second Shift+click restores 1x normal speed');
assert.equal(hudModernEl.dataset.speed, '1x');

// 6. Round 2: Bridges, Pavilions, Wood Decks & Exterior Paths Grounding
const valleyBorderlands = createValleyBorderlands({ ...baseOpts, pondLife, waterworks, leisureGrove, reservations: [pondLife, waterworks, leisureGrove] });
const outerWilds = createOuterWilds({ ...baseOpts, pondLife, waterworks, leisureGrove, valleyBorderlands, reservations: [pondLife, waterworks, leisureGrove, valleyBorderlands] });
groundSurface.register({ exterior, leisureGrove, valleyBorderlands, outerWilds });

// 6a. Leisure grove timber footbridge cambered deck
const lBridge = leisureGrove.layout.bridge;
assert.ok(lBridge && lBridge.samples?.length > 0, 'leisureGrove exports timber footbridge geometry');
const lBridgeMid = lBridge.samples[Math.floor(lBridge.samples.length * 0.5)];
const walkedBridgeY = field.walkSurface(lBridgeMid.x, lBridgeMid.z);
assert.ok(Math.abs(walkedBridgeY - lBridgeMid.top) < 0.02, `walkSurface matches arched timber bridge top (${walkedBridgeY.toFixed(3)} vs ${lBridgeMid.top.toFixed(3)})`);
assert.ok(walkedBridgeY > field.sample(lBridgeMid.x, lBridgeMid.z) + 0.10, 'timber footbridge walkSurface rises well above creek bed');

// 6b. Valley borderlands stone bridge & cloud pavilion stylobate + west stair
const sBridge = valleyBorderlands.layout.stoneBridge;
assert.ok(field.walkSurface(sBridge.x, sBridge.z) >= sBridge.y + 0.30, 'walkSurface captures arched bluestone bridge deck');
const cPav = valleyBorderlands.layout.cloudPavilion;
assert.ok(field.walkSurface(cPav.x, cPav.z) >= cPav.y + 0.035, 'walkSurface captures cloud pavilion stone floor');
assert.ok(field.walkSurface(cPav.x - 3.3, cPav.z) > field.sample(cPav.x - 3.3, cPav.z) + 0.04, 'walkSurface ramps smoothly up pavilion west stair');

// 6c. Outer wilds split-log bridge & deer hermitage overlook deck
assert.ok(outerWilds.layout.woodDecks.length >= 2, 'outerWilds exports wood decks with elevations');
for (const dk of outerWilds.layout.woodDecks) {
  const wy = field.walkSurface(dk.x, dk.z);
  assert.ok(wy >= dk.endY0 + (dk.arch || 0) - 0.005, `walkSurface captures outerWilds deck at (${dk.x.toFixed(1)}, ${dk.z.toFixed(1)})`);
}

// 6d. Exterior riverside footpaths
if (exterior.layout.paths.length > 0) {
  const ep = exterior.layout.paths[0].points;
  const eMid = ep[Math.floor(ep.length * 0.5)];
  assert.ok(field.walkSurface(eMid[0], eMid[1]) >= field.sample(eMid[0], eMid[1]) + 0.07, 'walkSurface lifts exterior footpaths');
}

// 7. Wuling Outskirts egrets & villagers circadian sleep/rain calm
const wuling = createWulingOutskirts({ ...baseOpts, leisureGrove, outerWilds });
wuling.update(0.05, 1.0, { timeId: 'day', rainIntensity: 0, snowIntensity: 0 }, { x: 999, z: 999 });
assert.equal(wuling.getStats().egretsTucked, false, 'Wuling egrets forage actively during clear daytime');
assert.equal(wuling.getStats().actorsResting, false, 'Wuling/outskirt villagers move actively during daytime');

wuling.update(0.05, 2.0, { timeId: 'day', rainIntensity: 0.55, snowIntensity: 0 }, { x: 999, z: 999 });
assert.equal(wuling.getStats().egretsTucked, true, 'Wuling egrets tuck necks still during heavy rain');

wuling.update(0.05, 3.0, { timeId: 'night', rainIntensity: 0, snowIntensity: 0 }, { x: 999, z: 999 });
assert.equal(wuling.getStats().egretsTucked, true, 'Wuling egrets tuck necks still at night');
assert.equal(wuling.getStats().actorsResting, true, 'Wuling/outskirt villagers rest calmly by their lanterns at night');
for (const actor of wuling.actors) {
  assert.ok(Math.hypot(actor.x - actor.homeX, actor.z - actor.homeZ) < 0.05, `${actor.id} rests calmly at home spot at night`);
}
wuling.dispose();
outerWilds.dispose();
valleyBorderlands.dispose();

// 8. 桃源舆图 (#map-time) & 留影长卷 (modernTime colophon + legacy compatibility + walkSurface teleport)
assert.ok(indexHtml.includes('id="map-time"'), 'index.html includes #map-time inside #map sidebar');
assert.ok(mapThemeCss.includes('#map #map-time'), 'map-time-theme.css themes #map-time with crisp ink contrast');

const makeMiniEl = (id = '', tag = 'div') => {
  const cls = new Set();
  const texts = [];
  const listeners = new Map();
  const ctx = new Proxy({
    fillText(v) { texts.push(String(v)); },
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: t => ({ width: String(t || '').length * 10 })
  }, { get: (t, k) => t[k] ?? (() => {}) });
  const el = {
    id, tagName: tag.toUpperCase(), textContent: '', value: '', hidden: false, open: false,
    width: 640, height: 360, clientWidth: 1000, clientHeight: 420,
    style: { setProperty() {} }, dataset: {}, children: [], attrs: new Map(),
    classList: {
      add: (...xs) => xs.forEach(x => cls.add(x)),
      remove: (...xs) => xs.forEach(x => cls.delete(x)),
      contains: x => cls.has(x),
      toggle: (x, f) => (f ? cls.add(x) : cls.delete(x))
    },
    appendChild(c) {
      this.children.push(c);
      const reg = (node) => {
        if (!node) return;
        if (node.id) uiEls.set(node.id, node);
        if (Array.isArray(node.children)) node.children.forEach(reg);
      };
      reg(c);
      return c;
    },
    replaceChildren(...xs) { this.children = xs; },
    remove() {},
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
      if (k === 'id') { this.id = String(v); uiEls.set(this.id, this); }
    },
    getAttribute(k) { return this.attrs.get(k) ?? null; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    click() {
      for (const fn of (listeners.get('click') || [])) fn({ target: el, preventDefault() {}, stopPropagation() {} });
    },
    focus() {},
    showModal() { this.open = true; }, close() { this.open = false; },
    getContext: () => ctx,
    _texts: texts,
    toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  };
  return el;
};

const uiEls = new Map();
for (const id of [
  'map', 'map-sheet', 'map-canvas', 'map-close', 'map-list', 'map-region', 'map-dest', 'map-time', 'map-count',
  'map-note-name', 'map-note-poem', 'map-dist', 'minimap', 'minimap-canvas', 'minimap-region',
  'toast', 'toast-k', 'toast-name', 'mystery-note'
]) {
  uiEls.set(id, makeMiniEl(id, id.includes('canvas') ? 'canvas' : 'div'));
}

const prevDoc = globalThis.document;
const prevWin = globalThis.window;
const prevRaf = globalThis.requestAnimationFrame;
const prevCancelRaf = globalThis.cancelAnimationFrame;
const prevPath2D = globalThis.Path2D;
globalThis.document = {
  getElementById: id => uiEls.get(id) || null,
  createElement: tag => makeMiniEl('', tag),
  body: makeMiniEl('body'),
  head: makeMiniEl('head'),
  pointerLockElement: null
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {}, removeEventListener() {} };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.Path2D = class { moveTo() {} lineTo() {} };

const mockPlayer = { state: { x: roadMid.x, y: walkedRoadY, z: roadMid.z, yaw: 0, vx: 0, vz: 0 }, clearInput() {}, syncCamera() {} };
const mapApi = createMap(world.map, world, {
  field, spots: [], houseInfo: village.houseInfo, marks: props.marks, bamboo: [], mulberry: [],
  spine: sampleRiverSpine(curve, 60), player: mockPlayer, visited: [], onVisit() {}
});
mapApi.bindRuntime({ worldClock: clock });
assert.equal(uiEls.get('map-time').textContent, '公元386年10月02日 18时15分', 'map.bindRuntime syncs #map-time immediately');
assert.ok(uiEls.get('map-time').getAttribute('title')?.includes('秋分'), '#map-time tooltip includes active solar term');
clock.setHour(20.5);
mapApi.update(0.05);
assert.equal(uiEls.get('map-time').textContent, '公元386年10月02日 20时30分', 'map.update keeps #map-time live-synced with worldClock');
mapApi.dispose();

// Scroll Studio legacy storage compatibility + modernTime colophon + walkSurface landing
const store = new Map();
const mockStorage = {
  getItem: k => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
mockStorage.setItem('taohua.scrolls.v1', JSON.stringify([{
  id: 'legacy-1', title: '桃源行纪 · 春深 · 晴昼 · 桃源村', verse: '阡陌交通，鸡犬相闻。',
  seal: '桃源清赏', mount: 'handscroll', style: 'qinglv', region: '桃源村', timeLabel: '晴昼',
  x: roadMid.x, z: roadMid.z, yaw: 0.4, createdAt: 1000, dataUrl: 'data:image/jpeg;base64,AA=='
}]));
const mockCanvas = makeMiniEl('scene', 'canvas');
const studio = createScrollStudio({
  canvas: mockCanvas,
  player: mockPlayer,
  field,
  map: { isOpen: () => false, getStats: () => ({ region: '桃源村' }) },
  sky: { timeId: 'night', weatherId: 'clear' },
  getPhenology: () => ({ getStats: () => ({ phenologyId: 'autumn' }) }),
  getWorldClock: () => clock,
  renderSceneNow() {},
  world,
  doc: globalThis.document,
  win: globalThis.window,
  storage: mockStorage
});
assert.equal(studio.getSavedScrolls().length, 1, 'legacy scroll entries without modernTime load seamlessly');
studio.openCapture();
const previewEl = uiEls.get('scroll-preview-canvas');
assert.ok(previewEl?._texts?.some(t => t.includes('公元386年10月02日 20时30分') && t.includes('秋分')), 'handscroll canvas colophon renders live modern CE date/time + solar term');
assert.ok(previewEl?._texts?.some(t => t.includes('时维秋分')), 'handscroll canvas colophon renders solar-term whisper inscription');
assert.ok(uiEls.get('scroll-meta-title')?.textContent?.includes('公元386年10月02日 20时30分 · 秋分'), 'scroll dialog header displays live modern CE date/time + solar term');
uiEls.get('scroll-mount-toggle')?.click();
assert.ok(previewEl?._texts?.filter(t => t.includes('公元386年10月02日 20时30分') && t.includes('秋分')).length >= 2, 'hanging scroll canvas colophon renders live modern CE date/time + solar term');
assert.ok(previewEl?._texts?.filter(t => t.includes('时维秋分')).length >= 2, 'hanging scroll canvas colophon renders solar-term whisper inscription');
uiEls.get('scroll-save-box')?.click();
const savedList = studio.getSavedScrolls();
assert.equal(savedList.length, 2, 'new scroll prepends alongside legacy scroll');
const saved = savedList[0];
assert.equal(saved.modernTime, '公元386年10月02日 20时30分', 'new saved scroll records live modern CE date/time');
assert.equal(saved.solarTerm, '秋分', 'new saved scroll records active solar term');
assert.ok(typeof saved.solarWhisper === 'string' && saved.solarWhisper.length > 4, 'new saved scroll records solar-term whisper');
assert.equal(saved.phenology, 'autumn', 'new saved scroll records phenology season for gallery filtering');

// Round 7: Gallery four-season filter (all / spring / summer / autumn / winter)
assert.equal(studio.getGallerySeasonFilter(), 'all', 'scroll gallery starts on all seasons');
assert.equal(studio.setGallerySeasonFilter('autumn'), 'autumn');
assert.equal(studio.setGallerySeasonFilter('spring'), 'spring');
assert.equal(studio.setGallerySeasonFilter('winter'), 'winter');
assert.equal(studio.setGallerySeasonFilter('all'), 'all');
mockPlayer.state.y = -99;
assert.equal(studio.enterScrollWorld(saved.id), true, 'enterScrollWorld teleports player to saved coordinates');
assert.ok(Math.abs(mockPlayer.state.y - walkedRoadY) < 0.02, `enterScrollWorld lands cleanly on walkSurface (${mockPlayer.state.y.toFixed(3)} vs ${walkedRoadY.toFixed(3)})`);
studio.dispose();

// 9. Round 3: 游记 (J) 现代公历时间戳（独立 taohua.journal.times.v1，绝不污染 taohua.journal.v1 结构）
for (const jid of [
  'journal', 'journal-open', 'journal-close', 'journal-clear', 'journal-status',
  'journal-places', 'journal-people', 'journal-classics', 'journal-notes', 'journal-field',
  'journal-tab-notes', 'journal-tab-field', 'journal-plants', 'journal-animals', 'journal-landforms', 'journal-life'
]) {
  uiEls.set(jid, makeMiniEl(jid, jid === 'journal' ? 'dialog' : 'div'));
}
const prevLS = globalThis.localStorage;
const jStore = new Map();
jStore.set('taohua.journal.v1', JSON.stringify({
  places: ['wuling'],
  people: [{ id: 'p1', name: '旧友', line: '昔日所谈' }],
  classics: [],
  guide: []
}));
globalThis.localStorage = {
  getItem: k => jStore.get(k) ?? null,
  setItem: (k, v) => jStore.set(k, String(v)),
  removeItem: k => jStore.delete(k)
};
globalThis.window.confirm = () => true;
const jApi = createJournal(
  [{ id: 'wuling', name: '武陵溪' }, { id: 'village', name: '桃源村' }],
  [{ id: 'opening', classic: '晋太元中', plain: '东晋太元年间' }],
  mockCanvas,
  mockPlayer
);
jApi.setClock(() => clock);
jApi.visit({ id: 'village', name: '桃源村' });
jApi.person('p2', '村老', '问今是何世');
jApi.classic({ id: 'opening' });

// taohua.journal.v1 keeps exact 4-key schema
const rawJournal = JSON.parse(jStore.get('taohua.journal.v1'));
assert.deepEqual(Object.keys(rawJournal).sort(), ['classics', 'guide', 'people', 'places'], 'taohua.journal.v1 preserves exact legacy 4-key schema');
// taohua.journal.times.v1 records timestamps for new entries while legacy entries stay clean
const rawTimes = JSON.parse(jStore.get('taohua.journal.times.v1'));
assert.equal(rawTimes.places.village, '公元386年10月02日 20时30分', 'new visited place records modern CE timestamp');
assert.equal(rawTimes.places.wuling, undefined, 'pre-existing legacy place stays clean without fabricated timestamp');
assert.equal(rawTimes.people['p2|问今是何世'], '公元386年10月02日 20时30分', 'new villager encounter records modern CE timestamp');
assert.equal(rawTimes.classics.opening, '公元386年10月02日 20时30分', 'new classic passage records modern CE timestamp');

// Open journal and confirm .journal__time + .journal__term badges render on stamped items
uiEls.get('journal-open').click();
const placeLis = uiEls.get('journal-places').children;
assert.equal(placeLis.length, 2);
assert.equal(placeLis[0].children.length, 0, 'legacy place entry renders without timestamp span');
assert.equal(placeLis[1].children[0]?.textContent, '公元386年10月02日 20时30分', 'new place entry renders .journal__time span');
assert.equal(placeLis[1].children[1]?.className, 'journal__term', 'new place entry renders .journal__term solar-term badge');
assert.equal(placeLis[1].children[1]?.textContent, '秋分', 'solar-term badge automatically derives 秋分 from timestamp date');
assert.ok(placeLis[1].children[1]?.getAttribute('title')?.includes('秋分'), 'solar-term badge carries poetic solar-term whisper tooltip');
jApi.close();

// 10. Round 4: 桃源小笺 (?) 补录公历倍速与行迹时历说明
const tg = createTravelerGuideAndCruise({
  camera: new THREE.PerspectiveCamera(),
  player: mockPlayer,
  canvas: mockCanvas,
  field,
  doc: globalThis.document,
  win: globalThis.window
});
const tgDialog = uiEls.get('traveler-guide');
assert.ok(tgDialog?.innerHTML?.includes('12× 观日影'), '? traveler guide documents Shift+click 12x 观日影 control');
assert.ok(tgDialog?.innerHTML?.includes('行迹时历'), '? traveler guide documents modern CE time across map/journal/scrolls');
tg.dispose();

// 11. Round 5: 全场景地表材质采样 + 步伐声材质细化 + 村落二十四节气对话联动
// 11a. Zero-allocation field.surfaceMaterial(x, z) across wood/stone/dirt/grass landmarks
assert.equal(typeof field.surfaceMaterial, 'function', 'attachGroundSurface exposes field.surfaceMaterial');
assert.equal(field.surfaceMaterial(lBridgeMid.x, lBridgeMid.z), 'wood', 'leisure grove timber bridge reports wood surface');
const logBridgeSite = outerWilds.layout.sanctuaries.logBridge;
const deerDeckSite = outerWilds.layout.sanctuaries.deerHermitage;
const woodHutSite = outerWilds.layout.sanctuaries.woodcutterHut;
const lankeSite = outerWilds.layout.sanctuaries.lankeCrag;
const teaHutSite = outerWilds.layout.sanctuaries.mountainTeaHut;
const kilnSite = outerWilds.layout.sanctuaries.climbingKiln;
assert.equal(field.surfaceMaterial(logBridgeSite.x, logBridgeSite.z), 'wood', 'outer wilds split-log bridge reports wood surface');
assert.equal(field.surfaceMaterial(deerDeckSite.x, deerDeckSite.z), 'wood', 'deer hermitage viewing deck reports wood surface');
assert.equal(field.surfaceMaterial(woodHutSite.x, woodHutSite.z), 'stone', 'woodcutter cottage stone plinth reports stone surface');
assert.equal(outerWilds.isOnWood(woodHutSite.x, woodHutSite.z), false, 'woodcutter cottage stone plinth does not falsely report isOnWood');
assert.equal(field.surfaceMaterial(valleyBorderlands.layout.stoneBridge.x, valleyBorderlands.layout.stoneBridge.z), 'stone', 'north bluestone arch bridge reports stone surface');
assert.equal(field.surfaceMaterial(valleyBorderlands.layout.cloudPavilion.x, valleyBorderlands.layout.cloudPavilion.z), 'stone', 'cloud pavilion terrace reports stone surface');
assert.equal(field.surfaceMaterial(lankeSite.x, lankeSite.z), 'stone', 'Lanke chess crag reports stone surface');
assert.equal(field.surfaceMaterial(teaHutSite.x, teaHutSite.z), 'stone', 'mountain tea shelter stone terrace reports stone surface');
const leisurePav = leisureGrove.layout.pavilion || (leisureGrove.layout.regions || []).find(r => r && r.kind === 'pavilion');
if (leisurePav) {
  assert.equal(field.surfaceMaterial(leisurePav.x, leisurePav.z), 'stone', 'leisure grove waterside pavilion reports stone surface');
}
assert.equal(field.surfaceMaterial(roadMid.x, roadMid.z), 'dirt', 'village main road reports dirt surface');
if (thresh) {
  assert.equal(field.surfaceMaterial(thresh.x, thresh.z), 'dirt', 'village threshing floor reports dirt surface');
}
assert.equal(field.surfaceMaterial(kilnSite.x, kilnSite.z), 'dirt', 'ancient climbing kiln work yard reports dirt surface');
assert.equal(field.surfaceMaterial(-48, -112), 'grass', 'open meadow reports grass surface');

// 11b. Sound system stepSurface integration + footstep material counters across all 6 textures
const makeAudioParam = (v = 0) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
const makeAudioNode = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
class MockAudioCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = makeAudioNode(); }
  createGain() { return makeAudioNode({ gain: makeAudioParam(1) }); }
  createOscillator() { return makeAudioNode({ type: 'sine', frequency: makeAudioParam(440), onended: null, start() {}, stop() { if (this.onended) this.onended(); } }); }
  createBiquadFilter() { return makeAudioNode({ type: 'lowpass', frequency: makeAudioParam(1000), Q: makeAudioParam(1) }); }
  createBufferSource() { return makeAudioNode({ buffer: null, loop: false, loopStart: 0, loopEnd: 0, onended: null, start() {}, stop() { if (this.onended) this.onended(); } }); }
  createStereoPanner() { return makeAudioNode({ pan: makeAudioParam(0) }); }
  createDynamicsCompressor() { return makeAudioNode({ threshold: makeAudioParam(-16), knee: makeAudioParam(22), ratio: makeAudioParam(4), attack: makeAudioParam(0.005), release: makeAudioParam(0.25) }); }
  createAnalyser() { return makeAudioNode({ fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.78, getByteTimeDomainData(a) { a.fill(128); }, getByteFrequencyData(a) { a.fill(0); } }); }
  createConvolver() { return makeAudioNode({ buffer: null }); }
  createBuffer(ch, len, sr) { const chs = Array.from({ length: ch }, () => new Float32Array(len)); return { duration: len / sr, getChannelData: i => chs[i] }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
const soundSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8')
  .replace("import world from '../data/world.json';", `const world = ${JSON.stringify(world)};`)
  .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = { version: 1, clips: [] };')
  .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(soundSrc).toString('base64'));
globalThis.window.AudioContext = MockAudioCtx;
const r5Sound = createSound({
  field,
  distanceToRiver: river.distance,
  riverSpine: sampleRiverSpine(curve, 60),
  cliff,
  village,
  valleyBorderlands,
  audioCatalogue: { version: 1, clips: [] },
  audioFetch: async () => ({ ok: false })
});
assert.equal(r5Sound.unlock(), true, 'sound system unlocks cleanly');
assert.equal(r5Sound.stepSurface(lBridgeMid.x, lBridgeMid.z), 'wood', 'sound.stepSurface uses field.surfaceMaterial for timber bridge');
assert.equal(r5Sound.stepSurface(woodHutSite.x, woodHutSite.z), 'stone', 'sound.stepSurface detects stone plinth at woodcutter hut');
assert.equal(r5Sound.stepSurface(roadMid.x, roadMid.z), 'dirt', 'sound.stepSurface detects village earth road');
assert.equal(r5Sound.stepSurface(-48, -112), 'grass', 'sound.stepSurface detects open meadow grass');

// Walk 2.2m on each surface material and confirm distinct footstepMaterials counters increment
const walkOn = (sx, sz, opts = {}) => {
  const cam = { position: { x: sx, y: 2.5, z: sz }, rotation: { y: 0 } };
  const ps = { x: sx, y: 1.0, z: sz, yaw: 0, onWood: Boolean(opts.onWood), wading: Boolean(opts.wading) };
  r5Sound.update(0.05, 1.0, cam, ps, false);
  for (let k = 1; k <= 12; k++) {
    ps.z = sz + k * 0.25;
    cam.position.z = ps.z;
    r5Sound.update(0.1, 1.0 + k * 0.1, cam, ps, false);
  }
};
walkOn(roadMid.x, roadMid.z);
walkOn(valleyBorderlands.layout.cloudPavilion.x, valleyBorderlands.layout.cloudPavilion.z - 1.5);
walkOn(lBridgeMid.x, lBridgeMid.z, { onWood: true });
walkOn(-48, -112);
walkOn(-48, -112, { wading: true });
r5Sound.syncWorld(0.05, { phenology: 'winter', snow: 0.6, shelter: 0 });
walkOn(-48, -112);
const fm = r5Sound.getStats().footstepMaterials;
assert.ok(fm.dirt >= 1, `dirt footsteps recorded (${fm.dirt})`);
assert.ok(fm.stone >= 1, `stone footsteps recorded (${fm.stone})`);
assert.ok(fm.wood >= 1, `wood footsteps recorded (${fm.wood})`);
assert.ok(fm.grass >= 1, `grass footsteps recorded (${fm.grass})`);
assert.ok(fm.water >= 1, `water footsteps recorded (${fm.water})`);
assert.ok(fm.snow >= 1, `snow footsteps recorded (${fm.snow})`);

// 11c. 24 Solar Terms villager dialogue linkage & zero Act-3 spoiler check
const all24Samples = [
  [1, 6, '小寒', 'winter'], [1, 21, '大寒', 'winter'], [2, 5, '立春', 'spring'], [2, 20, '雨水', 'spring'],
  [3, 6, '惊蛰', 'spring'], [3, 21, '春分', 'spring'], [4, 6, '清明', 'spring'], [4, 21, '谷雨', 'spring'],
  [5, 6, '立夏', 'summer'], [5, 22, '小满', 'summer'], [6, 7, '芒种', 'summer'], [6, 22, '夏至', 'summer'],
  [7, 8, '小暑', 'summer'], [7, 24, '大暑', 'summer'], [8, 8, '立秋', 'autumn'], [8, 24, '处暑', 'autumn'],
  [9, 9, '白露', 'autumn'], [9, 24, '秋分', 'autumn'], [10, 9, '寒露', 'autumn'], [10, 24, '霜降', 'autumn'],
  [11, 8, '立冬', 'winter'], [11, 23, '小雪', 'winter'], [12, 8, '大雪', 'winter'], [12, 22, '冬至', 'winter']
];
const tabooSpoilers = ['处处志', '太守', '刘子骥', '南阳', '寻向所志', '遂迷', '不复得路'];
const seenFarming = new Set();
for (const [m, d, expectedTerm, phenId] of all24Samples) {
  const st = getSolarTerm(m, d);
  assert.equal(st.name, expectedTerm, `getSolarTerm(${m},${d}) === ${expectedTerm}`);
  const vd = createVillagerDialogue({
    sky: { timeId: 'day', weatherId: 'clear', rainIntensity: 0, snowIntensity: 0 },
    getWorldClock: () => ({ getState: () => ({ short: '巳初', solarTerm: st.name, solarWhisper: st.whisper }) }),
    getPhenology: () => ({ getStats: () => ({ phenologyId: phenId }) })
  });
  const t0 = vd.beginOrAdvance({
    kind: 'person',
    key: `v-solar-${expectedTerm}`,
    name: '村老',
    ref: { role: 'elder' },
    lines: ['客从何处来？']
  });
  assert.equal(t0.solarTerm, expectedTerm, `dialogue tracks active solar term ${expectedTerm}`);
  assert.ok(t0.meta.includes(expectedTerm) && t0.meta.includes('巳初'), `dialogue meta includes ${expectedTerm} & live shichen (${t0.meta})`);
  assert.ok(t0.line.includes(expectedTerm), `clear-day greeting weaves solar term ${expectedTerm} (${t0.line})`);
  assert.equal(t0.replies.length, 2, 'general villager preserves 2 crisp turn-0 choices');
  assert.ok(t0.replies[0].label.includes(expectedTerm), `turn-0 reply offers 「${expectedTerm}」 farming inquiry`);
  const t1 = vd.chooseReply(0);
  assert.ok(t1.line.includes(expectedTerm) && t1.line.length >= 25, `solarTerm branch gives authentic farming lore for ${expectedTerm}`);
  assert.ok(!t1.line.includes(`${expectedTerm}，${expectedTerm}`), `solarTerm line avoids doubled-term stutter for ${expectedTerm}`);
  seenFarming.add(t1.line);
  const t2 = vd.chooseReply(1);
  assert.equal(t2.hasMore, false, `closing turn concludes cleanly for ${expectedTerm}`);
  const combined = `${t0.meta} ${t0.line} ${t1.line} ${t2.line}`;
  for (const taboo of tabooSpoilers) {
    assert.ok(!combined.includes(taboo), `${expectedTerm} dialogue contains zero Act-3 spoiler: ${taboo}`);
  }
}
assert.equal(seenFarming.size, 24, 'all 24 solar terms have unique authentic village farming lore');

// 12. Round 6 & 7: 步伐足迹与涟漪/雪痕/湿泥微效 + 水牛/大黄狗/池鸭行迹联动 (footstep-fx.js)
const pondCfg = world.terrain.pond;
const mockPeopleFx = { list: [{ x: roadMid.x + 2, z: roadMid.z, s: 1.0, mode: 'road' }] };
const mockFaunaFx = {
  animals: [
    { kind: 'ox', x: roadMid.x - 2, z: roadMid.z, y: walkedRoadY, mode: 'walk' },
    { kind: 'dog', x: roadMid.x + 3, z: roadMid.z, y: walkedRoadY, mode: 'walk' },
    { kind: 'duck', x: pondCfg.x, z: pondCfg.z, y: world.terrain.waterLevel, mode: 'swim' }
  ]
};
const fx = createFootstepFx({ field, world, people: mockPeopleFx, fauna: mockFaunaFx });
assert.equal(fx.group.children.length, 3, 'footstep-fx registers 3 pooled InstancedMeshes');
for (const m of fx.group.children) {
  assert.equal(m.visible, false, `${m.name} hidden (0 draw calls) while idle`);
}
// dt <= 0 strict freeze gate
const fxPs = { x: roadMid.x, z: roadMid.z, yaw: 0, onWood: false, wading: false, aboardSkiff: false, godFlight: false, seated: false };
fx.update(0, 0, fxPs, { rainIntensity: 0.8, snowIntensity: 0 }, { phenologyId: 'spring' });
assert.equal(fx.getStats().simTime, 0, 'footstep-fx freezes strictly on dt === 0');
assert.equal(fx.getStats().totalEmitted, 0, 'footstep-fx emits zero effects while frozen');

// Boating & godFlight suppress player footstep spawns
fxPs.aboardSkiff = true;
for (let k = 0; k < 10; k++) {
  fxPs.z += 0.35;
  fx.update(0.1, k * 0.1, fxPs, { rainIntensity: 0.8, snowIntensity: 0 }, { phenologyId: 'winter' });
}
assert.equal(fx.getStats().totalEmitted, 0, 'boating aboard skiff suppresses player footsteps');
fxPs.aboardSkiff = false;

// Shallow water walking -> expanding ripples + splash droplets
fxPs.x = -48; fxPs.z = -112; fxPs.wading = true;
fx.update(0.05, 1.0, fxPs, { rainIntensity: 0, snowIntensity: 0 }, { phenologyId: 'spring' });
for (let k = 1; k <= 12; k++) {
  fxPs.z = -112 + k * 0.28;
  fx.update(0.1, 1.0 + k * 0.1, fxPs, { rainIntensity: 0, snowIntensity: 0 }, { phenologyId: 'spring' });
}
assert.ok(fx.getStats().bySurface.water >= 2, `water wading emits concentric ripples + droplets (${fx.getStats().bySurface.water})`);
assert.ok(fx.getStats().ripplesActive >= 1 && fx.getStats().motesActive >= 1, 'water ripples and splash motes become active');
fxPs.wading = false;

// Winter snow walking (player + nearby strolling villager + ox + dog) -> sculpted snow footprints & hoof/paw prints
fxPs.x = roadMid.x; fxPs.z = roadMid.z;
fx.update(0.05, 3.0, fxPs, { rainIntensity: 0, snowIntensity: 0.65, weatherId: 'snow' }, { phenologyId: 'winter' });
for (let k = 1; k <= 12; k++) {
  fxPs.z = roadMid.z + k * 0.25;
  mockPeopleFx.list[0].z = roadMid.z + k * 0.22;
  mockFaunaFx.animals[0].z = roadMid.z + k * 0.24;
  mockFaunaFx.animals[1].z = roadMid.z + k * 0.26;
  fx.update(0.1, 3.0 + k * 0.1, fxPs, { rainIntensity: 0, snowIntensity: 0.65, weatherId: 'snow' }, { phenologyId: 'winter' });
}
assert.ok(fx.getStats().bySurface.snow >= 5, `winter snow walking (player + villager + ox + dog) stamps snow prints (${fx.getStats().bySurface.snow})`);
assert.ok(fx.getStats().byActor.fauna >= 2, `ox & dog emit fauna snow hoof/paw prints (${fx.getStats().byActor.fauna})`);
assert.ok(fx.getStats().printsActive >= 2, 'snow prints stay visible in pool');

// Water buffalo wading in pond + swimming duck emit aquatic ripples
fxPs.x = pondCfg.x + 3; fxPs.z = pondCfg.z;
mockFaunaFx.animals[0].x = pondCfg.x + 1.0; mockFaunaFx.animals[0].z = pondCfg.z;
mockFaunaFx.animals[2].x = pondCfg.x; mockFaunaFx.animals[2].z = pondCfg.z;
const waterBeforeFauna = fx.getStats().bySurface.water;
for (let k = 1; k <= 12; k++) {
  mockFaunaFx.animals[0].z = pondCfg.z + k * 0.24;
  mockFaunaFx.animals[2].z = pondCfg.z + k * 0.26;
  fx.update(0.1, 4.5 + k * 0.1, fxPs, { rainIntensity: 0, snowIntensity: 0, weatherId: 'clear' }, { phenologyId: 'spring' });
}
assert.ok(fx.getStats().bySurface.water > waterBeforeFauna, `wading ox & swimming duck emit pond water ripples (${waterBeforeFauna} -> ${fx.getStats().bySurface.water})`);

// Rainy earth road -> dark wet-mud prints + puddle ripples
fxPs.x = roadMid.x; fxPs.z = roadMid.z;
fx.update(0.05, 5.0, fxPs, { rainIntensity: 0.72, snowIntensity: 0, weatherId: 'rain' }, { phenologyId: 'spring' });
for (let k = 1; k <= 10; k++) {
  fxPs.z = roadMid.z + k * 0.25;
  fx.update(0.1, 5.0 + k * 0.1, fxPs, { rainIntensity: 0.72, snowIntensity: 0, weatherId: 'rain' }, { phenologyId: 'spring' });
}
assert.ok(fx.getStats().bySurface.mud >= 1 && fx.getStats().bySurface.rainRipple >= 1, 'rainy earth road stamps wet-mud footprints + puddle ripples');

// Dry earth sprint -> light loess dust motes
fxPs.x = roadMid.x; fxPs.z = roadMid.z;
fx.update(0.05, 7.0, fxPs, { rainIntensity: 0, snowIntensity: 0, weatherId: 'clear' }, { phenologyId: 'spring' });
for (let k = 1; k <= 10; k++) {
  fxPs.z = roadMid.z + k * 0.65; // 6.5 m/s sprint
  fx.update(0.1, 7.0 + k * 0.1, fxPs, { rainIntensity: 0, snowIntensity: 0, weatherId: 'clear' }, { phenologyId: 'spring' });
}
assert.ok(fx.getStats().bySurface.dust >= 1, 'sprinting on dry earth road emits subtle loess dust motes');

// Idle decay returns all 3 meshes to visible = false (0 draw calls)
for (let k = 0; k < 120; k++) {
  fx.update(0.1, 9.0 + k * 0.1, fxPs, { rainIntensity: 0, snowIntensity: 0, weatherId: 'clear' }, { phenologyId: 'spring' });
}
assert.equal(fx.getStats().ripplesActive, 0, 'all ripples expire cleanly');
assert.equal(fx.getStats().printsActive, 0, 'all footprints fade cleanly');
assert.equal(fx.getStats().motesActive, 0, 'all ballistic motes expire cleanly');
for (const m of fx.group.children) {
  assert.equal(m.visible, false, `${m.name} hides back to 0 draw calls after decay`);
}
fx.dispose();

// Clear button wipes both journal & timestamp store cleanly
uiEls.get('journal-clear').click();
assert.deepEqual(JSON.parse(jStore.get('taohua.journal.v1')), { places: [], people: [], classics: [], guide: [] });
assert.equal(jStore.get('taohua.journal.times.v1'), undefined, 'clearing journal also clears taohua.journal.times.v1');
globalThis.localStorage = prevLS;

globalThis.document = prevDoc;
globalThis.window = prevWin;
globalThis.requestAnimationFrame = prevRaf;
globalThis.cancelAnimationFrame = prevCancelRaf;
globalThis.Path2D = prevPath2D;

console.log('PASS check-gait-circadian-modern-clock: grounded shoes/bridges/decks, rooster/egret/fauna circadian sleep, modern CE clock (HUD+12x+Solar+Map+Scroll+Journal) verified');
