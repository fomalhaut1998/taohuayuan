import * as THREE from 'three';
import world from './data/world.json';
import script from './data/script.json';
import { createTerrain, createRiverDistance, createMountains } from './world/terrain.js';
import { createStream, createRiverCurve, sampleRiverSpine } from './world/stream.js';
import { createFish } from './world/fish.js';
import { createBoats } from './world/boats.js';
import { createFlora } from './world/flora.js';
import { optimizeStaticVisibility } from './world/static-visibility.js';
import { createReeds } from './world/reeds.js';
import { createCliff } from './world/cliff.js';
import { createVillage } from './world/village.js';
import { createScatter } from './world/scatter.js';
import { createPeople, rainStateForIntensity } from './world/people.js';
import { createProps } from './world/props.js';
import { createHinterland } from './world/hinterland.js';
import { createHinterlandFoliage } from './world/hinterland-foliage.js';
import { createExteriorExploration } from './world/exterior-exploration.js';
import { createHabitatDetails } from './world/habitat-details.js';
// Round 6: imports begin
import { createPondLife } from './world/pond-life.js';
import { createWaterworks } from './world/waterworks.js';
import { createLeisureGrove } from './world/leisure-grove.js';
import { createCommunityLife } from './systems/community-life.js';
import { createOpeningCurtain } from './systems/opening-curtain.js';
import { createCaveGleam } from './world/cave-gleam.js';
import { createHospitalityFeast } from './world/hospitality-feast.js';
import { createQinHanHomestead } from './world/qin-han-homestead.js';
import { createSeasonalGathering } from './systems/seasonal-gathering.js';
import { createRiverSkiff } from './systems/river-skiff.js';
import { createQinHanCompletion } from './world/qin-han-village-completion.js';
import { createOxPlowing } from './world/ox-plowing.js';
import { createWorldClock, createNightMeteors } from './systems/world-clock.js';
import { createEasterEggs } from './world/easter-eggs.js';
import { createGodFlight } from './systems/god-flight.js';
import { createSmoothHinterlandPaths } from './world/road-geometry.js';
import { createAct3Finale } from './world/act3-finale.js';
import { createCavePassage } from './world/cave-passage.js';
import { createVillagerDialogue } from './systems/villager-dialogue.js';
import { createFloraWind } from './systems/flora-wind.js';
import { createSituationalRest } from './systems/situational-rest.js';
import { createPhenologySystem } from './systems/phenology-mist.js';
import { createNeighborTheaters } from './systems/neighbor-theaters.js';
import { createTactileProps } from './systems/tactile-props.js';
import { createInkAtmosphere } from './systems/ink-atmosphere.js';
import { createValleyBorderlands } from './world/valley-borderlands.js';
import { createArchitecturalCraft } from './systems/architectural-craft.js';
import { createLazyScrollStudio as createScrollStudio } from './systems/scroll-studio-lazy.js';
import { createPoeticWayfinder } from './systems/poetic-wayfinder.js';
import { createAudioHud } from './systems/audio-hud.js';
import { createQianmoPaths } from './world/qianmo-paths.js';
import { createOuterWilds } from './world/outer-wilds.js';
import { createDeepHollows } from './world/deep-hollows.js';
import { createWildsEasterEggs } from './world/wilds-easter-eggs.js';
import { createWulingOutskirts } from './world/wuling-outskirts.js';
import { createSeasonalCycle } from './systems/seasonal-cycle.js';
import { createPoeticInteractions } from './systems/poetic-interactions.js';
import { createTravelerGuideAndCruise } from './systems/traveler-guide-cruise.js';
import { createLazyTouchControls } from './player/touch-controls-lazy.js';
import {
  createFarBambooGeometry,
  createFarPineGeometry,
  createFarHillBambooGeometry,
  createFarBlossomTreeGeometry,
  createFarMapleGeometry,
  createFarCragGeometry,
  createFarShrubGeometry,
  createFarPeachTreeGeometry,
  createFarGrassGeometry,
  createFarMilletGeometry,
  syncLodVertexColors
} from './world/lod-geometries.js';
import { attachGroundSurface } from './world/ground-surface.js';
import { createFootstepFx } from './systems/footstep-fx.js';
import { createQuestSystem } from './systems/quest-system.js';
import { createPortalVisibility } from './bootstrap/portal-visibility.js';
import { registerExtraRegions } from './bootstrap/world-registry.js';
import { isModalBusy, isControlTarget } from './systems/modal-state.js';
import { PROJECT_META } from './systems/project-meta.js';
import { createCommunityActorPool } from './systems/community-actors.js';
// Round 6: imports end
import { createVillageScenes } from './world/village-scenes.js';
import { createVillageLife } from './world/village-life.js';
import { createMysteries } from './world/mysteries.js';
import { createMysterySystem } from './systems/mysteries.js';
import { createPetals, createFallenPetals } from './systems/petals.js';
import { createSubtitles } from './systems/subtitles.js';
import { createBarrier } from './systems/barrier.js';
import { createFauna } from './systems/fauna.js';
import { createSound } from './systems/sound.js';
import { createDialogue } from './systems/dialogue.js';
import { createSmoke } from './systems/smoke.js';
import { createInteraction } from './systems/interaction.js';
import { createPlayer } from './player/controller.js';
import { createAvatar } from './player/avatar.js';
import { createMap } from './systems/map.js';
import { createJournal } from './systems/journal.js';
import { createDiscovery } from './systems/discovery.js';
import './field-guide.css';
import './map-time-theme.css';
import { createSky } from './systems/sky.js';
import { createWaterSurface } from './systems/twilight-water.js';
import { createRainWater } from './systems/rain-water.js';
import { createContactShadows } from './systems/contact-shadows.js';
import { createWeather } from './systems/weather.js';
import { createQuiet } from './systems/quiet.js';
import { createHouseLight } from './systems/house-light.js';
import { createRendererSurface } from './systems/renderer-surface.js';

const canvas = document.getElementById('scene');
const hintEl = document.getElementById('hint');
const viewEl = document.getElementById('view');
const viewNameEl = document.getElementById('view-name');
const statsEl = document.getElementById('stats');
const sFps = document.getElementById('s-fps');
const sMs = document.getElementById('s-ms');
const sP95 = document.getElementById('s-p95');
const sLow = document.getElementById('s-low');
const sCalls = document.getElementById('s-calls');
const sTris = document.getElementById('s-tris');
const sGraph = document.getElementById('s-graph');
const fpsEl = document.getElementById('fps');
const fpsNum = document.getElementById('fps-num');
const gloomEl = document.getElementById('gloom');

const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: true,
  powerPreference: 'high-performance'
});
const rawDprParam = Number(new URLSearchParams(window.location.search).get('dpr'));
const dprOverride = Number.isFinite(rawDprParam) && rawDprParam > 0 ? Math.min(rawDprParam, world.render.maxPixelRatio) : null;
function isMobileViewport() {
  return Boolean(
    window.matchMedia?.('(pointer: coarse)')?.matches ||
    ((navigator?.maxTouchPoints ?? 0) > 0 && window.innerWidth <= 1024)
  );
}
let cachedMobileViewport = isMobileViewport();
function targetMaxDpr() {
  if (dprOverride !== null) return dprOverride;
  const nativeMax = Math.min(window.devicePixelRatio || 1, world.render.maxPixelRatio);
  if (cachedMobileViewport) return Math.min(nativeMax, 1.5);
  if (nativeMax > 1.5 && window.innerWidth * window.innerHeight > 1800000) return 1.5;
  return nativeMax;
}
let currentDpr = targetMaxDpr();
let dprCooldownMs = 0;
let dprLowStreak = 0;
let dprHighStreak = 0;
const renderSurface = createRendererSurface(renderer, canvas);
let needsPostResizeRender = false;
renderSurface.sync(window.innerWidth, window.innerHeight, currentDpr);
renderer.setClearColor(world.render.background, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(world.render.background);
scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);

const camCfg = world.render.camera;
function baseCameraFov() {
  const aspect = (window.innerWidth || 1) / Math.max(1, window.innerHeight || 1);
  if (aspect >= 1) return camCfg.fov;
  const k = Math.min(1, Math.max(0, (1 - aspect) / 0.5));
  return camCfg.fov + k * 16;
}
let cachedBaseFov = baseCameraFov();
const camera = new THREE.PerspectiveCamera(
  cachedBaseFov,
  window.innerWidth / window.innerHeight,
  camCfg.near,
  camCfg.far
);
camera.rotation.order = 'YXZ';

const sun = new THREE.DirectionalLight(world.light.sun.color, world.light.sun.intensity);
sun.position.set(world.light.sun.position[0], world.light.sun.position[1], world.light.sun.position[2]);
scene.add(sun);

const hemi = new THREE.HemisphereLight(
  world.light.hemi.sky,
  world.light.hemi.ground,
  world.light.hemi.intensity
);
scene.add(hemi);

// 一日光 + 一半球光；阴面交给天空漫反射，避免额外方向光冲平体积。
const fill = null;

const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);

const terrain = createTerrain(world.terrain, distanceToRiver, { road: world.village.road, pond: world.terrain.pond });
// 洞口位置要早于桃树撒点算出来（第一幕走廊两侧也要用近景树）
const cliff = createCliff(world.cliff, terrain.field);
// 地贴/色斑要能取到任意点的真实地面色（边缘融进地面用）
terrain.field.colorAt = terrain.colorAt;
scene.add(terrain.mesh);

const stream = createStream(world.stream, world.terrain, riverCurve);
scene.add(stream.mesh);

// 桃源境内不长桃树：用坡度代理挡掉盆地里的撒点（flora.js 一行不改）
const basin = world.terrain.basin;
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

const floraField = {
  half: terrain.field.half,
  sample: function (x, z) { return terrain.field.sample(x, z); },
  slope: function (x, z) {
    const dx = x - basin.x;
    const dz = z - basin.z;
    if (dx * dx + dz * dz < (basin.inner * 1.05) * (basin.inner * 1.05)) return 9;
    return terrain.field.slope(x, z);
  }
};

const nearTree = function (x, z) {
  const sp = world.player.spawn;
  if (Math.hypot(x - sp.x, z - sp.z) < 34) return true;
  // 洞口外的走廊也算近景：这一段是第一幕唯一能看到树的地方
  if (Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40) return true;
  const rd = world.village.road.points;
  for (let i = 0; i < rd.length - 1; i++) {
    if (segDist(x, z, rd[i][0], rd[i][1], rd[i + 1][0], rd[i + 1][1]) < 20) return true;
  }
  return false;
};
const flora = createFlora(world.flora, floraField, distanceToRiver, stream.curve, world.player.spawn, nearTree);
scene.add(flora.group);

const reeds = createReeds(world.reeds, terrain.field, riverCurve, world.terrain);
scene.add(reeds.group);

const petals = createPetals(world.petals, terrain.field);
scene.add(petals.mesh);

const fallen = createFallenPetals(world.fallenPetals, terrain.field, flora.spots, riverCurve, world.terrain.waterLevel);
scene.add(fallen.mesh);

const mountains = createMountains(world.mountains);
scene.add(mountains);

// ---- 山有小口 ----
scene.add(cliff.group);

// ---- 第二幕：村落 ----
const village = createVillage(world.village, terrain.field, world.terrain.pond);
scene.add(village.group);

// ---- 草簇与碎石：填满空地的细节 ----
// 按层区分边距：草可以贴着路牙长（近草几乎压到路面上），碎石得让开路面
const ROAD_MARGIN = { tuft: 0.35, near: 0.1, flower: 0.12, stone: 0.75, patch: 0.05 };
const scatter = createScatter(world.scatter, terrain.field, function (x, z, kind) {
  const rm = ROAD_MARGIN[kind] === undefined ? 0.7 : ROAD_MARGIN[kind];
  const rd = world.village.road;
  for (let i = 0; i < rd.points.length - 1; i++) {
    const a = rd.points[i];
    const b = rd.points[i + 1];
    if (segDist(x, z, a[0], a[1], b[0], b[1]) < rd.width * 0.5 + rm) return true;
  }
  const blocks = world.village.fields.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    const half = (blk.cols * blk.plot[0] + (blk.cols - 1) * blk.gap) * 0.5 + 0.5;
    if (Math.abs(x - blk.x) < half && Math.abs(z - blk.z) < half) return true;
  }
  const pond = world.terrain.pond;
  if (Math.hypot(x - pond.x, z - pond.z) < pond.radius + 1.2) return true;
  for (let i = 0; i < village.blockers.length; i++) {
    const b = village.blockers[i];
    const ca = Math.cos(b.rot);
    const sa = Math.sin(b.rot);
    const dx = x - b.x;
    const dz = z - b.z;
    const lx = dx * ca - dz * sa;
    const lz = dx * sa + dz * ca;
    if (Math.abs(lx) < b.hw + 0.7 && Math.abs(lz) < b.hd + 0.7) return true;
  }
  // 洞里不长草：按洞口轴线取局部坐标，挡掉整条岩缝
  const sl = cliff.slit;
  const sx2 = Math.cos(sl.angle);
  const sz2 = Math.sin(sl.angle);
  const dxs = x - sl.x;
  const dzs = z - sl.z;
  const along = -dxs * sz2 + dzs * sx2;
  const across = dxs * sx2 + dzs * sz2;
  if (Math.abs(along) < 2.8 && Math.abs(across) < world.cliff.plugDepth * 0.5 + 1.4) return true;
  // 避开谷缘核心建筑台基（望稼楼、药庐、观云亭、晒秋坪），防散落碎石杂草穿入屋内
  if (Math.hypot(x - 12.5, z + 226.5) < 3.6 || Math.hypot(x + 18.5, z + 225.5) < 5.0 ||
      Math.hypot(x - 124.5, z + 170.0) < 4.5 || Math.hypot(x - 101.8, z + 169.0) < 4.8) return true;
  return false;
}, world.village.road, (function () {
  // 洞口外的走廊：从外洞口沿径向铺到出生点，第一段路不能是秃地
  const sl = cliff.slit;
  const ax = Math.cos(sl.angle);
  const az = Math.sin(sl.angle);
  const d0 = world.cliff.plugDepth * 0.5;
  return { x: sl.x + ax * d0, z: sl.z + az * d0, dx: ax, dz: az, len: 36 };
})(), { curve: riverCurve, terrainCfg: world.terrain });
scene.add(scatter.group);

const props = createProps(world.props, terrain.field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, terrain.field, distanceToRiver, world, village, props, cliff);
// Visual-only foliage stays inside existing bamboo reservations and joins static culling.
const hinterlandFoliage = createHinterlandFoliage(hinterland, terrain.field, world.hinterland.palette);
hinterland.group.add(hinterlandFoliage.group);
scene.add(hinterland.group);
const villageScenes = createVillageScenes(world, terrain.field, distanceToRiver, village, props, cliff, hinterland);
scene.add(villageScenes.group);
const mysteryWorld = createMysteries(world, terrain.field, distanceToRiver, village, props, cliff, hinterland, villageScenes, flora);
scene.add(mysteryWorld.group);
// 村中生活带：在村道两侧、屋前屋后的空地填入中等尺度的日常器物，补上平视带的大片空绿。
const villageLife = createVillageLife(world, terrain.field, distanceToRiver, village, props, cliff, hinterland, villageScenes, mysteryWorld);
scene.add(villageLife.group);
// Build original boats first so exterior reservations can inspect the real moorings.
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, terrain.field);
scene.add(boats.group);
const exterior = createExteriorExploration(world, terrain.field, distanceToRiver, riverCurve, flora, boats, cliff);
scene.add(exterior.group);
// Low, passable habitat clusters preserve the original collision/navigation world.
const habitatDetails = createHabitatDetails({ world, field: terrain.field, distanceToRiver, riverCurve,
  flora, hinterland, village, villageScenes, villageLife, props, boats, cliff, exterior });
scene.add(habitatDetails.group);
// Round 6: scene begin
const groundSurface = attachGroundSurface(terrain.field, { world, village, props, exterior });
const interiorCommunityActorsGroup = new THREE.Group();
interiorCommunityActorsGroup.name = 'shared-community-actors-interior';
scene.add(interiorCommunityActorsGroup);
const interiorCommunityRig = createCommunityActorPool(interiorCommunityActorsGroup, 64);
const communityOptions = { world, field: terrain.field, distanceToRiver, riverCurve, stream, flora,
  village, props, hinterland, villageScenes, villageLife, mysteryWorld, boats, cliff, exterior, habitatDetails,
  actorRig: interiorCommunityRig };
const caveGleam = createCaveGleam({ world, cliff, field: terrain.field, emergenceAlong: -23.0, outerMouthAlong: 15.5 });
scene.add(caveGleam.group);
const cavePassage = createCavePassage({ world, cliff, field: terrain.field, scatter });
scene.add(cavePassage.group);
const pondLife = createPondLife({ ...communityOptions, reservations: [] });
scene.add(pondLife.group);
const waterworks = createWaterworks({ ...communityOptions, reservations: [pondLife] });
scene.add(waterworks.group);
const leisureGrove = createLeisureGrove({ ...communityOptions, reservations: [pondLife, waterworks] });
scene.add(leisureGrove.group);
registerExtraRegions(leisureGrove, [{ blockers: cavePassage.blockers }]);
const hospitalityFeast = createHospitalityFeast({ ...communityOptions, reservations: [pondLife, waterworks, leisureGrove], targetBlockers: leisureGrove.blockers });
scene.add(hospitalityFeast.group);
leisureGrove.layout.feast = hospitalityFeast.layout.site;
const qinHanHomestead = createQinHanHomestead({ ...communityOptions, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast] });
scene.add(qinHanHomestead.group);
leisureGrove.layout.qinHan = qinHanHomestead.layout;
const seasonalGathering = createSeasonalGathering({ world, field: terrain.field, pondLife, leisureGrove });
scene.add(seasonalGathering.group);
const riverSkiff = createRiverSkiff({ world, field: terrain.field, stream, riverCurve, distanceToRiver, boats, cliff });
scene.add(riverSkiff.group);
leisureGrove.targets.push({ id: 'fishing-skiff', ...riverSkiff.getAnchor(), range: 6.5, resolve: () => riverSkiff.getAnchor() });
const qinHanCompletion = createQinHanCompletion({
  world, field: terrain.field, village, props, leisureGrove, qinHanHomestead,
  actorRig: interiorCommunityRig,
  blockers: cliff.blockers.concat(village.blockers, qinHanHomestead.blockers, leisureGrove.blockers)
});
scene.add(qinHanCompletion.group);
const oxPlowing = createOxPlowing({ world, field: terrain.field, homestead: qinHanHomestead, actorRig: interiorCommunityRig });
scene.add(oxPlowing.group);
registerExtraRegions(leisureGrove, [qinHanHomestead, { targets: qinHanCompletion.targets }, oxPlowing]);
const nightMeteors = createNightMeteors({ scene });
const easterEggs = createEasterEggs({
  ...communityOptions,
  pondLife,
  waterworks,
  leisureGrove,
  qinHanHomestead,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead]
});
scene.add(easterEggs.group);
const smoothHinterlandPaths = createSmoothHinterlandPaths(hinterland, terrain.field, world.hinterland);
scene.add(smoothHinterlandPaths);
const rawHinterlandPaths = hinterland.group.getObjectByName('hinterland-paths');
if (rawHinterlandPaths) rawHinterlandPaths.visible = false;
const act3Finale = createAct3Finale({
  world,
  field: terrain.field,
  distanceToRiver,
  riverCurve,
  flora,
  boats,
  cliff,
  targetBlockers: leisureGrove.blockers
});
scene.add(act3Finale.group);
const valleyBorderlands = createValleyBorderlands({
  ...communityOptions,
  pondLife,
  waterworks,
  leisureGrove,
  hospitalityFeast,
  qinHanHomestead,
  qinHanCompletion,
  easterEggs,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead, easterEggs]
});
scene.add(valleyBorderlands.group);
leisureGrove.layout.borderlands = valleyBorderlands.layout;
leisureGrove.valleyBorderlands = valleyBorderlands;
const qianmoPaths = createQianmoPaths({
  ...communityOptions,
  terrain,
  colorAt: terrain.colorAt,
  scatter,
  pondLife,
  waterworks,
  leisureGrove,
  hospitalityFeast,
  qinHanHomestead,
  easterEggs,
  valleyBorderlands
});
scene.add(qianmoPaths.group);
leisureGrove.layout.qianmo = qianmoPaths.layout;
leisureGrove.qianmoPaths = qianmoPaths;
leisureGrove.layout.oxPlowing = oxPlowing;
leisureGrove.layout.qinHanCompletion = qinHanCompletion;
const outerWilds = createOuterWilds({
  ...communityOptions,
  pondLife,
  waterworks,
  leisureGrove,
  hospitalityFeast,
  qinHanHomestead,
  qinHanCompletion,
  easterEggs,
  valleyBorderlands,
  qianmoPaths,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead, easterEggs, valleyBorderlands]
});
scene.add(outerWilds.group);
leisureGrove.layout.outerWilds = outerWilds.layout;
leisureGrove.outerWilds = outerWilds;
const deepHollows = createDeepHollows({
  ...communityOptions,
  valleyBorderlands,
  outerWilds,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead, easterEggs, valleyBorderlands, outerWilds]
});
scene.add(deepHollows.group);
leisureGrove.layout.deepHollows = deepHollows.layout;
leisureGrove.deepHollows = deepHollows;
const wildsEasterEggs = createWildsEasterEggs({
  ...communityOptions,
  valleyBorderlands,
  outerWilds,
  deepHollows
});
scene.add(wildsEasterEggs.group);
leisureGrove.wildsEasterEggs = wildsEasterEggs;
const wulingOutskirts = createWulingOutskirts({
  ...communityOptions,
  leisureGrove,
  hospitalityFeast,
  qinHanHomestead,
  qinHanCompletion,
  qianmoPaths,
  outerWilds,
  act3Finale
});
scene.add(wulingOutskirts.group);
leisureGrove.wulingOutskirts = wulingOutskirts;
registerExtraRegions(leisureGrove, [easterEggs, valleyBorderlands, { targets: qianmoPaths.targets }, outerWilds, deepHollows, wildsEasterEggs, wulingOutskirts]);
groundSurface.register({ leisureGrove, oxPlowing, valleyBorderlands, qianmoPaths, outerWilds, deepHollows, wulingOutskirts });
// Round 6: scene end
// 人物、镜头、交互与观察共用实景碰撞，不另建一套只供外围使用的障碍。
const colliders = cliff.blockers.concat(village.blockers, hinterland.blockers, villageScenes.blockers, mysteryWorld.blockers, villageLife.blockers, exterior.blockers, pondLife.blockers, waterworks.blockers, leisureGrove.blockers);
const barrier = createBarrier(colliders);

const people = createPeople(world.people, terrain.field, village.houseInfo, village.road, village.plots, colliders);
let peopleRaining = false;
const houseLight = createHouseLight(village.houseInfo);
scene.add(houseLight.mesh);

// ---- 炊烟：屋脊上的一根烟囱，烟是村子「有人住」最直接的信号 ----
const chimneys = village.chimneys.filter(function (c, i) { return i % 2 === 0; });
const smoke = createSmoke(world.smoke, chimneys);
scene.add(props.group);
scene.add(people.group);
scene.add(smoke.points);

const sound = createSound({
  field: terrain.field,
  distanceToRiver: distanceToRiver,
  riverSpine: riverSpine,
  people: people,
  village: village,
  cliff: cliff,
  deepHollows: deepHollows
});
const habitatContext = {
  blockers: colliders, pond: world.terrain.pond, waterLevel: world.terrain.waterLevel,
  distanceToRiver, riverHalfWidth: world.stream.halfWidth
};
const fauna = createFauna(world.fauna, terrain.field, sound, habitatContext);
scene.add(fauna.group);
// Round 6: actors begin
const footstepFx = createFootstepFx({ field: terrain.field, world, people, fauna });
scene.add(footstepFx.group);
const footstepFxOpts = { phenologyId: 'spring' };
let warmedFrames = 0;
const openingCurtain = createOpeningCurtain({
  sound,
  veilEl: document.getElementById('veil'),
  prepareEntry: {
    triggerWarmup(season) {
      try { ensureRound6Runtime(); } catch (_) {}
      try {
        if (season && phenology && phenology.currentId !== season) {
          phenology.setPhenology(season, false);
          if (map?.setPhenology) map.setPhenology(phenology.currentId);
        }
      } catch (_) {}
    },
    getProgress() {
      const runtimeReady = Boolean(
        typeof staticVisibility !== 'undefined' &&
        phenology && seasonalCycle && architecturalCraft && poeticInteractions && worldClock
      );
      const shadersReady = Boolean(shadersPrewarmed);
      const sampleStats = sound?.getStats?.()?.samples;
      let audioRatio = 1;
      if (sampleStats && sampleStats.enabled && !sound.muted && sampleStats.clips > 0) {
        const settled = (sampleStats.load?.ready || 0) + (sampleStats.load?.failed || 0);
        audioRatio = Math.min(1, settled / sampleStats.clips);
      }
      return { runtimeReady, shadersReady, audioRatio, framesReady: warmedFrames >= 2 };
    },
    getWelcomeText() {
      const isTouch = Boolean(touchControls?.enabled || isMobileViewport());
      if (isTouch) {
        return typeof player !== 'undefined' && player?.state?.aboardSkiff
          ? '左推摇杆撑篙 · 划屏环顾 · 点「观」登岸'
          : '左推摇杆漫步 · 划屏环顾 · 轻点提示交互';
      }
      return typeof player !== 'undefined' && player?.state?.aboardSkiff
        ? '轻点画面环顾溪山 · W/S 撑篙泛舟 · E 舍船登岸 · K 换四时'
        : '轻点画面环顾四周 · WASD 漫步溪岸 · E 近观交谈 · K 换四时';
    }
  }
});
waterworks.setSound({
  get ready() { return sound.ready; },
  get muted() { return Boolean(sound.muted); },
  getStats: () => sound.getStats(),
  wood: (x, z) => (typeof sound.mortarThud === 'function' ? sound.mortarThud(x, z) : sound.wood(x, z))
});
const communityLife = createCommunityLife({ world, field: terrain.field, sound, blockers: colliders,
  stations: [...pondLife.stations, ...waterworks.stations, ...leisureGrove.stations], actorRig: interiorCommunityRig });
scene.add(communityLife.group);
const neighborTheaters = createNeighborTheaters({
  world,
  field: terrain.field,
  village,
  props,
  qinHanHomestead,
  blockers: colliders,
  actorRig: interiorCommunityRig
});
scene.add(neighborTheaters.group);
interiorCommunityRig.flush();
const tactileProps = createTactileProps({
  leisureGrove,
  waterworks
});
scene.add(tactileProps.group);
const inkAtmosphere = createInkAtmosphere({
  world,
  field: terrain.field,
  terrain,
  stream,
  riverCurve,
  distanceToRiver,
  cliff,
  village,
  pondLife,
  qinHanHomestead,
  qinHanCompletion,
  boats,
  riverSkiff,
  fauna
});
scene.add(inkAtmosphere.group);
const baseCommunityInteractables = communityLife.getInteractables;
const baseCommunityGreet = communityLife.greet;
const mergedCommunityInteractables = [];
communityLife.getInteractables = function () {
  mergedCommunityInteractables.length = 0;
  const base = baseCommunityInteractables?.();
  if (base?.length) mergedCommunityInteractables.push(...base);
  const feast = hospitalityFeast.getInteractables?.();
  if (feast?.length) mergedCommunityInteractables.push(...feast);
  const qh = qinHanHomestead.getInteractables?.();
  if (qh?.length) mergedCommunityInteractables.push(...qh);
  const qhc = qinHanCompletion.getInteractables?.();
  if (qhc?.length) mergedCommunityInteractables.push(...qhc);
  const nt = neighborTheaters.getInteractables?.();
  if (nt?.length) mergedCommunityInteractables.push(...nt);
  const oxv = oxPlowing.getVillagers?.();
  if (oxv?.length) mergedCommunityInteractables.push(...oxv);
  const vb = valleyBorderlands.getInteractables?.();
  if (vb?.length) mergedCommunityInteractables.push(...vb);
  const ow = outerWilds.getInteractables?.();
  if (ow?.length) mergedCommunityInteractables.push(...ow);
  const dh = deepHollows.getInteractables?.();
  if (dh?.length) mergedCommunityInteractables.push(...dh);
  const wo = wulingOutskirts.getInteractables?.();
  if (wo?.length) {
    for (let i = 0; i < wo.length; i++) {
      if (wo[i].active !== false) mergedCommunityInteractables.push(wo[i]);
    }
  }
  return mergedCommunityInteractables;
};
communityLife.greet = function (id, px, pz, dur) {
  baseCommunityGreet?.(id, px, pz, dur);
  hospitalityFeast.greet?.(id, px, pz, dur);
  qinHanHomestead.greet?.(id, px, pz, dur);
  qinHanCompletion.greet?.(id, px, pz, dur);
  neighborTheaters.greet?.(id, px, pz, dur);
  oxPlowing.greet?.(id, px, pz, dur);
  valleyBorderlands.greet?.(id, px, pz, dur);
  outerWilds.greet?.(id, px, pz, dur);
  deepHollows.greet?.(id, px, pz, dur);
  wulingOutskirts.greet?.(id, typeof player !== 'undefined' ? player.state : null);
};
const allRound6Shelters = [...(qinHanCompletion.shelters || []), ...(valleyBorderlands.shelters || []), ...(outerWilds.shelters || []), ...(deepHollows.shelters || []), ...(wulingOutskirts.shelters || [])];
let worldClock = null;
let godFlight = null;
let portalVisibility = null;
let villagerDialogue = null;
let floraWind = null;
let situationalRest = null;
let phenology = null;
let seasonalCycle = null;
let architecturalCraft = null;
let poeticWayfinder = null;
let poeticInteractions = null;
let scrollStudio = null;
let audioHud = null;
let travelerGuide = null;
let touchControls = null;
let questSystem = null;
let villageQuietWired = false;
let shadersPrewarmed = false;
function handleValleyOpen() {
  openingCurtain.triggerValleyBloom();
  sound.playValleyEmergence?.();
}
const syncWashStation = pondLife.stations?.find(s => s.kind === 'wash') || pondLife.layout?.placements?.find(p => p.target === 'laundry-stone') || null;
const syncWheel = waterworks.layout?.wheels?.[0] ? { ...waterworks.layout.wheels[0], phase: 0 } : null;
const syncEventsBuf = [];
const syncWorldPayload = {
  rain: 0,
  snow: 0,
  isNight: false,
  timeId: 'day',
  phenology: 'spring',
  sprinting: false,
  aboardSkiff: false,
  frogVisualManaged: true,
  washStation: syncWashStation,
  wheel: syncWheel,
  shelters: allRound6Shelters,
  borderlands: valleyBorderlands.layout,
  outerWilds: outerWilds.layout,
  deepHollows: deepHollows.layout,
  nightFeast: null,
  events: syncEventsBuf
};
let lastAppliedFov = camera.fov;
function ensureRound6Runtime() {
  if (!floraWind && typeof sky !== 'undefined') {
    floraWind = createFloraWind({ flora, village, scatter, leisureGrove, hinterland, sky });
  }
  if (!inkAtmosphere._skyReg && typeof sky !== 'undefined') {
    inkAtmosphere._skyReg = true;
    inkAtmosphere.registerSky(sky);
  }
  if (!villageQuietWired && typeof quiet !== 'undefined' && typeof quiet.addSpots === 'function') {
    villageQuietWired = true;
    const vSpots = [];
    const pav = leisureGrove.layout?.regions?.find(r => r.kind === 'pavilion');
    if (pav) vSpots.push({ x: pav.x, z: pav.z, radius: 7, name: '荷风蛙鸣' });
    const wh = waterworks.layout?.wheels?.[0];
    if (wh) vSpots.push({ x: wh.x, z: wh.z, radius: 8, name: '筒车流水' });
    const bam = leisureGrove.layout?.regions?.find(r => r.kind === 'bamboo');
    if (bam) vSpots.push({ x: bam.x, z: bam.z, radius: 7, name: '风动修竹' });
    const soc = leisureGrove.layout?.regions?.find(r => r.kind === 'social');
    if (soc) vSpots.push({ x: soc.x, z: soc.z, radius: 7.5, name: '古社鸡犬' });
    const hth = qinHanHomestead.layout?.hearth;
    if (hth) vSpots.push({ x: hth.x, z: hth.z, radius: 7, name: '夜阑缶歌' });
    const oxt = oxPlowing.targets?.[0];
    if (oxt) vSpots.push({ x: oxt.x, z: oxt.z, radius: 8.5, name: '春畴牛耕' });
    if (valleyBorderlands.quietSpots?.length) vSpots.push(...valleyBorderlands.quietSpots);
    if (outerWilds.quietSpots?.length) vSpots.push(...outerWilds.quietSpots);
    if (deepHollows.quietSpots?.length) vSpots.push(...deepHollows.quietSpots);
    if (wildsEasterEggs.quietSpots?.length) vSpots.push(...wildsEasterEggs.quietSpots);
    if (wulingOutskirts.quietSpots?.length) vSpots.push(...wulingOutskirts.quietSpots);
    quiet.addSpots(vSpots);
  }
  if (!situationalRest && typeof sky !== 'undefined' && typeof player !== 'undefined' && typeof avatar !== 'undefined' && typeof camera !== 'undefined' && typeof mysteries !== 'undefined') {
    situationalRest = createSituationalRest({
      world,
      field: terrain.field,
      player,
      avatar,
      camera,
      sound,
      sky,
      blockers: colliders,
      hospitalityFeast,
      leisureGrove,
      qinHanCompletion,
      valleyBorderlands,
      outerWilds,
      deepHollows,
      mysteries,
      doc: document,
      win: window
    });
  }
  if (!cavePassage.group.userData._skyReg && typeof sky !== 'undefined') {
    cavePassage.group.userData._skyReg = true;
    sky.registerMaterials(cavePassage.group);
  }
  if (!neighborTheaters.group.userData._skyReg && typeof sky !== 'undefined') {
    neighborTheaters.group.userData._skyReg = true;
    sky.registerMaterials(neighborTheaters.group);
  }
  if (!tactileProps._bound && typeof mysteries !== 'undefined' && typeof player !== 'undefined' && typeof camera !== 'undefined' && typeof sky !== 'undefined') {
    tactileProps._bound = true;
    tactileProps.bind({ mysteries, player, camera, sound, communityLife, doc: document });
    sky.registerMaterials(tactileProps.group);
  }
  if (!seasonalCycle && typeof sky !== 'undefined' && typeof player !== 'undefined') {
    seasonalCycle = createSeasonalCycle({
      world,
      field: terrain.field,
      village,
      props,
      leisureGrove,
      qinHanCompletion,
      oxPlowing,
      player,
      sky
    });
    scene.add(seasonalCycle.group);
    sky.registerMaterials(seasonalCycle.group);
    portalVisibility?.addInterior?.(seasonalCycle.group);
  }
  if (!phenology && typeof sky !== 'undefined') {
    phenology = createPhenologySystem({
      world,
      field: terrain.field,
      riverCurve,
      cliff,
      terrain,
      village,
      mountains,
      flora,
      petals,
      fallen,
      reeds,
      scatter,
      pondLife,
      qinHanCompletion,
      valleyBorderlands,
      leisureGrove,
      props,
      hinterland,
      smoothHinterlandPaths,
      habitatDetails,
      villageScenes,
      villageLife,
      exterior,
      qianmoPaths,
      inkAtmosphere,
      floraWind,
      outerWilds,
      deepHollows,
      wildsEasterEggs,
      wulingOutskirts,
      oxPlowing,
      seasonalCycle,
      sky,
      doc: document,
      win: window
    });
    scene.add(phenology.group);
    sky.registerMaterials(phenology.group);
    portalVisibility?.addInterior?.(phenology.interiorGroup);
    portalVisibility?.addExterior?.(phenology.exteriorGroup);
    if (typeof staticVisibility !== 'undefined') staticVisibility.scan(phenology.group);
  }
  if (!villagerDialogue && typeof sky !== 'undefined' && typeof interaction !== 'undefined' && typeof people !== 'undefined' && typeof player !== 'undefined') {
    villagerDialogue = createVillagerDialogue({
      sky,
      getWorldClock: () => worldClock,
      getPhenology: () => phenology,
      getWildsEasterEggs: () => wildsEasterEggs,
      people,
      communityLife,
      sound,
      player,
      doc: document,
      win: window
    });
    interaction.setDialogueDirector?.(villagerDialogue);
  }
  if (!worldClock && typeof sky !== 'undefined' && typeof smoke !== 'undefined') {
    worldClock = createWorldClock({
      sky,
      smoke,
      getPhenology: () => phenology,
      doc: document,
      win: window,
      onDawn() {
        const rh = qinHanHomestead.layout?.rooster || village.houseInfo?.[0];
        sound.roosterCrow(rh?.x ?? 28, rh?.z ?? -118);
      }
    });
  }
  if (!architecturalCraft && typeof sky !== 'undefined' && typeof avatar !== 'undefined') {
    architecturalCraft = createArchitecturalCraft({
      world,
      field: terrain.field,
      village,
      cliff,
      pondLife,
      leisureGrove,
      qinHanHomestead,
      qinHanCompletion,
      hospitalityFeast,
      neighborTheaters,
      communityLife,
      people,
      avatar,
      boats,
      sky,
      phenology,
      sharedCommunityActors: interiorCommunityActorsGroup
    });
    scene.add(architecturalCraft.group);
    architecturalCraft.registerSky(sky);
    architecturalCraft.hookMaterials();
    portalVisibility?.addInterior?.(architecturalCraft.interiorGroup);
    portalVisibility?.addExterior?.(architecturalCraft.exteriorGroup);
  }
  if (!poeticWayfinder && typeof sky !== 'undefined' && typeof map !== 'undefined' && typeof player !== 'undefined') {
    poeticWayfinder = createPoeticWayfinder({
      world,
      field: terrain.field,
      cliff,
      map,
      player,
      sky,
      village,
      qianmoPaths,
      hinterland,
      valleyBorderlands,
      outerWilds,
      deepHollows,
      exterior,
      act3Finale,
      godFlight: () => godFlight
    });
    scene.add(poeticWayfinder.group);
    poeticWayfinder.registerSky(sky);
  }
  if (!audioHud) {
    audioHud = createAudioHud({ sound, doc: document, win: window });
  }
  if (!travelerGuide && typeof camera !== 'undefined' && typeof player !== 'undefined' && typeof map !== 'undefined' && typeof journal !== 'undefined') {
    travelerGuide = createTravelerGuideAndCruise({
      camera,
      player,
      canvas,
      field: terrain.field,
      map,
      journal,
      getScrollStudio: () => scrollStudio,
      getGodFlight: () => godFlight,
      getPhenology: () => phenology,
      clearanceRoots: [cliff.group, cavePassage.group],
      doc: document,
      win: window
    });
  }
  if (!touchControls && typeof player !== 'undefined') {
    touchControls = createLazyTouchControls({
      canvas,
      player,
      sound,
      getGodFlight: () => godFlight,
      getPoeticInteractions: () => poeticInteractions,
      getRiverSkiff: () => riverSkiff,
      getQuiet: () => quiet,
      doc: document,
      win: window
    });
  }
  if (!scrollStudio && typeof staticVisibility !== 'undefined' && typeof journal !== 'undefined' && typeof map !== 'undefined' && typeof player !== 'undefined' && typeof sky !== 'undefined' && typeof camera !== 'undefined') {
    scrollStudio = createScrollStudio({
      canvas,
      player,
      camera,
      field: terrain.field,
      riverSkiff,
      act3Finale,
      journal,
      map,
      sky,
      getPhenology: () => phenology,
      getWorldClock: () => worldClock,
      getTravelerGuide: () => travelerGuide,
      getGodFlight: () => godFlight,
      getQuestSystem: () => questSystem,
      getSceneContext: () => ({
        village,
        flora,
        cliff,
        riverSpine,
        boats,
        people,
        fauna,
        communityLife,
        pondLife,
        waterworks,
        leisureGrove,
        valleyBorderlands,
        outerWilds,
        deepHollows,
        wildsEasterEggs,
        wulingOutskirts,
        oxPlowing,
        hospitalityFeast,
        qinHanHomestead,
        qinHanCompletion,
        seasonalGathering,
        inkAtmosphere,
        seasonalCycle,
        architecturalCraft,
        houseLight
      }),
      renderSceneNow() {
        const vis = staticVisibility;
        vis.render(renderer, camera);
      },
      world,
      doc: document,
      win: window
    });
  }
  if (!poeticInteractions && typeof sky !== 'undefined' && typeof player !== 'undefined' && typeof camera !== 'undefined' && typeof mysteries !== 'undefined' && typeof journal !== 'undefined') {
    poeticInteractions = createPoeticInteractions({
      world,
      field: terrain.field,
      riverCurve,
      riverSpine,
      distanceToRiver,
      stream,
      player,
      camera,
      sky,
      sound,
      mysteries,
      inkAtmosphere,
      easterEggs,
      situationalRest,
      villagerDialogue,
      people,
      communityLife,
      village,
      shelters: allRound6Shelters,
      blockers: colliders,
      outerWilds,
      valleyBorderlands,
      deepHollows,
      wildsEasterEggs,
      oxPlowing,
      waterworks,
      journal,
      doc: document,
      win: window
    });
    scene.add(poeticInteractions.group);
    poeticInteractions.registerSky(sky);
    portalVisibility?.addInterior?.(poeticInteractions.interiorGroup);
  }
  if (!portalVisibility) {
    portalVisibility = createPortalVisibility({
      world,
      cliff,
      interiorGroups: [
        pondLife.group, leisureGrove.group,
        typeof people !== 'undefined' ? people.group : null,
        typeof houseLight !== 'undefined' ? houseLight.mesh : null,
        hospitalityFeast.group, qinHanHomestead.group, qinHanCompletion.group,
        seasonalGathering.group, communityLife.group, waterworks.group, easterEggs.group,
        neighborTheaters.group, tactileProps.group, smoothHinterlandPaths, inkAtmosphere.interiorGroup,
        valleyBorderlands.group, qianmoPaths.group, oxPlowing.group,
        outerWilds.interiorGroup, deepHollows.group, wildsEasterEggs.group, wulingOutskirts.interiorGroup,
        interiorCommunityActorsGroup,
        architecturalCraft?.interiorGroup, phenology?.interiorGroup, seasonalCycle?.group, poeticInteractions?.interiorGroup
      ],
      exteriorGroups: [
        typeof boats !== 'undefined' ? boats.group : null,
        typeof fish !== 'undefined' ? fish.group : null,
        riverSkiff.group, inkAtmosphere.exteriorGroup, outerWilds.exteriorGroup, wulingOutskirts.exteriorGroup,
        architecturalCraft?.exteriorGroup, phenology?.exteriorGroup
      ],
      conditionalExterior: [
        { group: act3Finale.group, isVisible: () => act3Finale.isVisible }
      ]
    });
  }
  if (!godFlight && typeof camera !== 'undefined' && typeof player !== 'undefined' && typeof avatar !== 'undefined') {
    godFlight = createGodFlight({
      scene,
      camera,
      player,
      avatar,
      canvas,
      world,
      field: terrain.field,
      doc: document,
      win: window,
      interiorGroups: portalVisibility.interiorGroups,
      exteriorGroups: portalVisibility.exteriorGroups
    });
  }
  if (typeof map !== 'undefined' && map.bindRuntime && godFlight && scrollStudio && phenology && worldClock) {
    if (!map._r6Bound) {
      map._r6Bound = true;
      map.bindRuntime({ godFlight, riverSkiff, act3Finale, phenology, scrollStudio, oxPlowing, worldClock, wulingOutskirts, wildsEasterEggs });
    }
  }
  if (typeof journal !== 'undefined' && worldClock && !journal._clockBound) {
    journal._clockBound = true;
    journal.setClock?.(() => worldClock);
  }
  if (!easterEggs._bound && typeof mysteries !== 'undefined' && typeof player !== 'undefined' && typeof sky !== 'undefined') {
    easterEggs._bound = true;
    easterEggs.bind({ mysteries, sound, player, doc: document });
    sky.registerMaterials(easterEggs.group);
  }
  if (!valleyBorderlands._bound && typeof mysteries !== 'undefined' && typeof player !== 'undefined' && typeof sky !== 'undefined') {
    valleyBorderlands._bound = true;
    valleyBorderlands.bind({ mysteries, sound, player, doc: document });
    sky.registerMaterials(valleyBorderlands.group);
  }
  if (!outerWilds._bound && typeof mysteries !== 'undefined' && typeof player !== 'undefined' && typeof sky !== 'undefined') {
    outerWilds._bound = true;
    outerWilds.bind({ mysteries, sound, player, doc: document });
    sky.registerMaterials(outerWilds.group);
  }
  if (!deepHollows._bound && typeof mysteries !== 'undefined' && typeof player !== 'undefined' && typeof sky !== 'undefined') {
    deepHollows._bound = true;
    deepHollows.bind({ mysteries, sound, player, doc: document });
    sky.registerMaterials(deepHollows.group);
  }
  if (!wildsEasterEggs._bound && typeof mysteries !== 'undefined' && typeof player !== 'undefined' && typeof sky !== 'undefined') {
    wildsEasterEggs._bound = true;
    wildsEasterEggs.bind({
      mysteries,
      sound,
      player,
      map: typeof map !== 'undefined' ? map : null,
      worldClock,
      journal: typeof journal !== 'undefined' ? journal : null,
      doc: document
    });
    sky.registerMaterials(wildsEasterEggs.group);
  }
  if (!wulingOutskirts._bound && typeof mysteries !== 'undefined' && typeof player !== 'undefined' && typeof sky !== 'undefined') {
    wulingOutskirts._bound = true;
    wulingOutskirts.bind({ mysteries, sound, player, doc: document, journal: typeof journal !== 'undefined' ? journal : null });
    sky.registerMaterials(wulingOutskirts.group);
  }
  if (!qianmoPaths.group.userData._skyReg && typeof sky !== 'undefined') {
    qianmoPaths.group.userData._skyReg = true;
    sky.registerMaterials(qianmoPaths.group);
  }
  if (!oxPlowing.group.userData._skyReg && typeof sky !== 'undefined') {
    oxPlowing.group.userData._skyReg = true;
    sky.registerMaterials(oxPlowing.group);
  }
  if (!smoothHinterlandPaths.userData._skyReg && typeof sky !== 'undefined') {
    smoothHinterlandPaths.userData._skyReg = true;
    sky.registerMaterials(smoothHinterlandPaths);
  }
  if (!act3Finale._bound && typeof dialogue !== 'undefined' && typeof mysteries !== 'undefined' && typeof player !== 'undefined' && typeof sky !== 'undefined' && typeof sound !== 'undefined' && typeof journal !== 'undefined' && typeof camera !== 'undefined') {
    act3Finale._bound = true;
    act3Finale.bind({
      doc: document,
      player,
      dialogue,
      mysteries,
      riverSkiff,
      caveGleam,
      openingCurtain,
      sky,
      sound,
      journal,
      camera
    });
    sky.registerMaterials(act3Finale.group);
  }
  if (
    !questSystem &&
    typeof sky !== 'undefined' &&
    typeof map !== 'undefined' &&
    typeof journal !== 'undefined' &&
    typeof dialogue !== 'undefined' &&
    typeof mysteries !== 'undefined' &&
    typeof player !== 'undefined' &&
    villagerDialogue &&
    act3Finale._bound &&
    easterEggs._bound &&
    valleyBorderlands._bound &&
    outerWilds._bound &&
    deepHollows._bound &&
    wulingOutskirts._bound &&
    poeticInteractions &&
    situationalRest
  ) {
    questSystem = createQuestSystem({
      world,
      player,
      canvas,
      sky,
      map,
      journal,
      dialogue,
      act3Finale,
      easterEggs,
      hospitalityFeast,
      qinHanHomestead,
      qinHanCompletion,
      waterworks,
      leisureGrove,
      oxPlowing,
      poeticInteractions,
      situationalRest,
      villagerDialogue,
      mysteries,
      quiet: typeof quiet !== 'undefined' ? quiet : null,
      sound,
      getPhenology: () => phenology,
      getGodFlight: () => godFlight,
      getScrollStudio: () => scrollStudio,
      getTravelerGuide: () => travelerGuide,
      doc: document,
      win: window
    });
    map.setRuntimeSources?.({ questSystem });
  }
  if (
    !shadersPrewarmed &&
    riverSkiff._bound &&
    seasonalGathering._bound &&
    act3Finale._bound &&
    poeticInteractions &&
    architecturalCraft &&
    phenology &&
    seasonalCycle &&
    typeof renderer !== 'undefined' &&
    typeof renderer.compile === 'function' &&
    typeof camera !== 'undefined'
  ) {
    shadersPrewarmed = true;
    const savedObjs = [];
    const savedVis = [];
    const savedInstMeshes = [];
    const savedCounts = [];
    scene.traverse(function (obj) {
      savedObjs.push(obj);
      savedVis.push(obj.visible);
      obj.visible = true;
      if (obj.isInstancedMesh && obj.count === 0 && obj.instanceMatrix && obj.instanceMatrix.count > 0) {
        savedInstMeshes.push(obj);
        savedCounts.push(obj.count);
        obj.count = 1;
      }
    });
    try {
      renderer.compile(scene, camera);
    } catch (_) {
      // Headless or mocked renderers without full WebGL program compilation safely ignore
    } finally {
      for (let i = 0; i < savedInstMeshes.length; i++) {
        savedInstMeshes[i].count = savedCounts[i];
      }
      for (let i = 0; i < savedObjs.length; i++) {
        savedObjs[i].visible = savedVis[i];
      }
    }
  }
}
const round6ExtraAnimals = [];
const round6ExtraActors = [];
const round6LivingObstacles = {
  people: people.list,
  animals: fauna.animals,
  extraAnimals: round6ExtraAnimals,
  extraActors: round6ExtraActors
};
function syncRound6LivingObstacles() {
  round6ExtraAnimals.length = 0;
  const qhAnimals = qinHanHomestead.getAnimalObstacles?.();
  if (qhAnimals) {
    for (let i = 0; i < qhAnimals.length; i++) round6ExtraAnimals.push(qhAnimals[i]);
  }
  const oxAnimals = oxPlowing.getAnimalObstacles?.();
  if (oxAnimals) { for (let i = 0; i < oxAnimals.length; i++) round6ExtraAnimals.push(oxAnimals[i]); }
  const owAnimals = outerWilds.getAnimalObstacles?.();
  if (owAnimals) { for (let i = 0; i < owAnimals.length; i++) round6ExtraAnimals.push(owAnimals[i]); }
  round6ExtraActors.length = 0;
  const base = baseCommunityInteractables?.();
  if (base) { for (let i = 0; i < base.length; i++) round6ExtraActors.push(base[i]); }
  const feast = hospitalityFeast.getInteractables?.();
  if (feast) { for (let i = 0; i < feast.length; i++) round6ExtraActors.push(feast[i]); }
  const qh = qinHanHomestead.getInteractables?.();
  if (qh) { for (let i = 0; i < qh.length; i++) round6ExtraActors.push(qh[i]); }
  const oxActors = oxPlowing.getInteractables?.();
  if (oxActors) { for (let i = 0; i < oxActors.length; i++) round6ExtraActors.push(oxActors[i]); }
  const nt = neighborTheaters.getInteractables?.();
  if (nt) { for (let i = 0; i < nt.length; i++) round6ExtraActors.push(nt[i]); }
  const vb = valleyBorderlands.getInteractables?.();
  if (vb) { for (let i = 0; i < vb.length; i++) round6ExtraActors.push(vb[i]); }
  const owActors = outerWilds.getInteractables?.();
  if (owActors) { for (let i = 0; i < owActors.length; i++) round6ExtraActors.push(owActors[i]); }
  const dhActors = deepHollows.getInteractables?.();
  if (dhActors) { for (let i = 0; i < dhActors.length; i++) round6ExtraActors.push(dhActors[i]); }
  const woActors = wulingOutskirts.getInteractables?.();
  if (woActors) {
    for (let i = 0; i < woActors.length; i++) {
      if (woActors[i].active !== false) round6ExtraActors.push(woActors[i]);
    }
  }
}
habitatContext.extraAnimals = round6ExtraAnimals;
habitatContext.extraActors = round6ExtraActors;
qinHanHomestead.setLivingObstacles?.(round6LivingObstacles);
neighborTheaters.setLivingObstacles?.(round6LivingObstacles);
syncRound6LivingObstacles();
queueMicrotask(() => { ensureRound6Runtime(); });
// Round 6: actors end
// Reuse one context: low-rate decisions see the same world as movement and interaction.
const livingContext = { ...habitatContext, people: people.list, animals: fauna.animals,
  timeId: 'day', rainIntensity: 0, playerSpeed: 0 };

// ---- 溪里的鱼与小船：都骑在同一套水面波上，鱼背破水、船随波轻晃 ----
const fish = createFish(world.fish, world.stream, world.terrain, riverCurve, stream);
scene.add(fish.group);

// ---- 天时与天气：一套参数同时管天空、雾、日光月色与不受光材质的明度 ----
const weather = createWeather(world.sky, scene);
const sky = createSky(world.sky, scene, renderer, camera, {
  weather: weather,
  sound: sound,
  smoke: smoke,
  lights: { sun: sun, hemi: hemi, fill: fill }
});
const twilightWater = createWaterSurface(stream.mesh, sky, { field: terrain.field, kind: 'stream' });
const pondMesh = village.group.getObjectByName('pond');
if (pondMesh) {
  const px = world.terrain.pond?.x ?? 68;
  const pz = world.terrain.pond?.z ?? -152;
  const pondCandidates = [];
  for (const r of (leisureGrove.layout?.regions || [])) {
    const dist = Math.hypot(r.x - px, r.z - pz);
    if (dist > 46) continue;
    if (r.kind === 'pavilion') pondCandidates.push({ dist, x: r.x, y: r.y, z: r.z, radius: 2.65, height: 4.25, kind: 1, shade: 1.0 });
    else if (r.kind === 'bamboo') pondCandidates.push({ dist, x: r.x, y: r.y, z: r.z, radius: 2.55, height: 5.6, kind: 2, shade: 0.94 });
    else if (r.kind === 'social' || r.kind === 'social-tree' || r.kind === 'orchard') {
      pondCandidates.push({ dist, x: r.x, y: r.y, z: r.z, radius: 2.1, height: 4.8, kind: 0, shade: 0.85 });
    }
  }
  for (const h of (village.houseInfo || [])) {
    const dist = Math.hypot(h.x - px, h.z - pz);
    if (dist <= 44) pondCandidates.push({ dist, x: h.x, y: h.gy, z: h.z, radius: Math.max(h.w, h.d) * 0.52, height: h.h + (world.village?.houses?.roofHeight || 1.75), kind: 3, shade: 0.88 });
  }
  for (const b of (village.bamboo || [])) {
    const dist = Math.hypot(b[0] - px, b[1] - pz);
    if (dist <= 42) pondCandidates.push({ dist, x: b[0], y: terrain.field.sample(b[0], b[1]), z: b[1], radius: 1.6 * (b[2] || 1), height: 5.2 * (b[2] || 1), kind: 2, shade: 0.90 });
  }
  for (const m of (village.mulberry || [])) {
    const dist = Math.hypot(m[0] - px, m[1] - pz);
    if (dist <= 38) pondCandidates.push({ dist, x: m[0], y: terrain.field.sample(m[0], m[1]), z: m[1], radius: (m[2] || 1.3) * 1.15, height: (m[3] || 2.6) + 1.0, kind: 0, shade: 0.82 });
  }
  pondCandidates.sort((a, b) => a.dist - b.dist);
  village._pondTwilightWater = createWaterSurface(pondMesh, sky, {
    field: terrain.field,
    kind: 'pond',
    reflectors: pondCandidates.slice(0, 8)
  });
}
const rainWater = createRainWater({
  world, field: terrain.field, stream, riverCurve, village, pond: world.terrain.pond,
  shelters: qinHanCompletion.shelters, legacyEaves: qinHanCompletion.group, sky, camera
});
scene.add(rainWater.group);

const player = createPlayer(canvas, world.player, terrain.field, world.terrain, hintEl, {
  viewEl: viewEl,
  viewNameEl: viewNameEl,
  blockers: colliders,
  cliff: world.cliff
});
const avatar = createAvatar(world.player.avatar, world.player.walkSpeed);
avatar.group.visible = false;
scene.add(avatar.group);
// Soft root/foot contacts follow existing actors; they never enter collision or picking.
const contactStaticTargets = [];
for (const [i, m] of (village.mulberry || []).entries()) {
  contactStaticTargets.push({ id: 'mulberry-' + i, kind: 'tree', x: m[0], z: m[1], scale: THREE.MathUtils.clamp((m[2] || 1.3) * 0.78, 0.82, 1.32), owner: village.group });
}
for (const [i, b] of (village.bamboo || []).entries()) {
  contactStaticTargets.push({ id: 'bamboo-' + i, kind: 'tree', x: b[0], z: b[1], scale: THREE.MathUtils.clamp((b[2] || 1) * 0.88, 0.74, 1.22), owner: village.group });
}
for (const [i, t] of (hinterland.trees || []).entries()) {
  contactStaticTargets.push({ id: 'hl-tree-' + i, kind: 'tree', x: t.x, z: t.z, scale: THREE.MathUtils.clamp((t.radius || 1.2) * 0.82, 0.8, 1.35), owner: hinterland.group });
}
for (const [i, b] of (hinterland.bamboo || []).entries()) {
  contactStaticTargets.push({ id: 'hl-bamboo-' + i, kind: 'tree', x: b.x, z: b.z, scale: 0.88, owner: hinterland.group });
}
for (const [i, r] of (leisureGrove.layout?.regions || []).entries()) {
  if (r.kind === 'pavilion') contactStaticTargets.push({ id: 'pavilion', kind: 'house', x: r.x, z: r.z, gy: r.y, w: 3.8, d: 3.8, rot: 0, owner: leisureGrove.group });
  else if (r.kind === 'social' || r.kind === 'orchard' || r.kind === 'bamboo') {
    contactStaticTargets.push({ id: 'lg-' + r.kind + '-' + i, kind: 'tree', x: r.x, z: r.z, y: r.y, scale: r.kind === 'social' ? 1.4 : 1.05, owner: leisureGrove.group });
  }
}
if (qinHanHomestead.layout?.fieldHut) {
  const s = qinHanHomestead.layout.fieldHut;
  contactStaticTargets.push({ id: 'qh-hut', kind: 'house', x: s.x, z: s.z, gy: s.y, w: 2.8, d: 2.6, rot: 0, owner: qinHanHomestead.group });
}
if (qinHanHomestead.layout?.weaving) {
  const s = qinHanHomestead.layout.weaving;
  contactStaticTargets.push({ id: 'qh-shed', kind: 'house', x: s.x, z: s.z, gy: s.y, w: 3.4, d: 2.7, rot: 0, owner: qinHanHomestead.group });
}
const contactActorsBuf = [];
const contactActorPool = [];
const contactTravelerActor = { id: 'traveler', kind: 'person', x: 0, y: 0, z: 0, yaw: 0, owner: avatar.group, flying: false };
const contactShadows = createContactShadows({
  world, field: terrain.field, camera, sky, flora, village, people, fauna,
  homestead: qinHanHomestead,
  staticTargets: contactStaticTargets,
  actors: () => {
    contactActorsBuf.length = 0;
    if (communityLife.group.visible) {
      const list = communityLife.getInteractables();
      for (let i = 0; i < list.length; i++) {
        const src = list[i];
        let slot = contactActorPool[i];
        if (!slot) {
          slot = {};
          contactActorPool[i] = slot;
        }
        slot.id = src.id;
        slot.kind = src.kind;
        slot.x = src.x;
        slot.y = src.y;
        slot.gy = src.gy;
        slot.z = src.z;
        slot.yaw = src.yaw;
        slot.rot = src.rot;
        slot.s = src.s;
        slot.scale = src.scale;
        slot.visible = src.visible;
        slot.hidden = src.hidden;
        slot.flying = src.flying;
        slot.submerged = src.submerged;
        slot.poseReady = src.poseReady;
        slot.lift = src.lift;
        slot.mode = src.mode;
        slot.owner = src.owner || communityLife.group;
        contactActorsBuf.push(slot);
      }
    }
    if (oxPlowing.group.visible) {
      const oxList = oxPlowing.getInteractables();
      for (let i = 0; i < oxList.length; i++) contactActorsBuf.push(oxList[i]);
    }
    if (player.state.view === 'third' && avatar.group.visible && !player.state.aboardSkiff) {
      contactTravelerActor.x = player.state.x;
      contactTravelerActor.y = player.state.y;
      contactTravelerActor.z = player.state.z;
      contactTravelerActor.yaw = player.state.yaw;
      contactTravelerActor.flying = Boolean(godFlight?.active);
      contactActorsBuf.push(contactTravelerActor);
    }
    return contactActorsBuf;
  }
});
scene.add(contactShadows.group);
const journal = createJournal(world.map.pois, script.points, canvas, player);
const subtitles = createSubtitles(world.subtitles, function () { journal.classic({ id: 'opening' }); });
document.getElementById('subtitle-replay').addEventListener('click', function () { journal.close(); subtitles.replay(); });
const dialogue = createDialogue(script, journal.classic, journal.classics());
const mysteries = createMysterySystem(mysteryWorld, { player, sky, sound, field: terrain.field, blockers: colliders });
const interaction = createInteraction(world.interaction, script, people, fauna, terrain.field, player, sound, journal.person, colliders, mysteries, communityLife);
scene.add(interaction.group);
// Avatar and interaction are created after the sky’s initial material audit.
sky.registerMaterials(avatar.group);
sky.registerMaterials(interaction.group);

// One visible nearby object; G opens its illustrated entry without taking E.
const discovery = createDiscovery({ world, field: terrain.field, camera, player, interaction, canvas, journal,
  flora, hinterland, village, villageScenes, villageLife, props, boats, cliff, riverSpine, fauna,
  pondLife, waterworks, leisureGrove,
  habitatDetails, blockers: colliders,
  canOpen: () => !['subtitle', 'classic', 'plain', 'talk'].some(id => document.getElementById(id)?.classList.contains('show'))
});
window.addEventListener('keydown', function (event) {
  if (event.code !== 'KeyG' || event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
      isControlTarget(event.target) ||
      isModalBusy(document, { includeCruise: true, runtime: { map, journal, discovery, scrollStudio, travelerGuide, questSystem } })) return;
  if (discovery.openCurrent()) event.preventDefault();
  else if (discovery.nudgeEmpty()) event.preventDefault();
});

const peach = flora.spots.reduce(function (best, spot) {
  return !best || Math.hypot(spot[0] - 16, spot[2] - 120) < Math.hypot(best[0] - 16, best[2] - 120) ? spot : best;
}, null);
const quietSpots = [
  { x: 26, z: 204, radius: 6, name: '溪声' },
  { x: 29, z: 185, radius: 7, name: '渡口' }
];
if (peach) quietSpots.push({ x: peach[0], z: peach[2], radius: 5, name: '桃花' });
for (const spot of exterior.layout.stops) {
  quietSpots.push({ x: spot.x, z: spot.z, radius: spot.quietRadius, name: spot.name });
}
const quiet = createQuiet(player, canvas, quietSpots);
const uiToggle = document.getElementById('ui-toggle');
function toggleUI() {
  const hidden = document.body.classList.toggle('ui-hidden');
  uiToggle.setAttribute('aria-pressed', String(hidden));
  uiToggle.innerHTML = hidden ? '显界面 <span>H</span>' : '隐界面 <span>H</span>';
}
uiToggle.addEventListener('click', toggleUI);
window.addEventListener('keydown', function (e) {
  if (e.code === 'KeyH' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey &&
      !isControlTarget(e.target) &&
      !isModalBusy(document, { runtime: { map, journal, discovery, scrollStudio, travelerGuide, questSystem } })) toggleUI();
});

// 舆图：静态地理由已有世界数据推得，小图常驻，全图按 M 开合
const map = createMap(world.map, world, {
  field: terrain.field,
  spots: flora.spots,
  houseInfo: village.houseInfo,
  marks: props.marks,
  bamboo: village.bamboo,
  mulberry: village.mulberry,
  hinterland: hinterland,
  villageScenes: villageScenes.mapData,
  villageLife: villageLife.mapData,
  pond: village.pond,
  chimneys: village.chimneys,
  spine: riverSpine,
  canvas: canvas,
  player: player,
  exterior: exterior.mapData,
  pondLife: pondLife.layout,
  waterworks: waterworks.layout,
  leisureGrove: leisureGrove.layout,
  visited: journal.visited(),
  onVisit: journal.visit
});
journal.onClear = function () { map.clearVisited(); wildsEasterEggs.clearDiscovered?.(); dialogue.reset(player.state); interaction.resetDialogue(); };

canvas.addEventListener('click', function () { sound.unlock(); });
document.addEventListener('touchstart', function () { if (sound.ready) sound.unlock(); }, { passive: true });
document.getElementById('journal-open')?.addEventListener('click', function () { sound.unlock(); });
document.getElementById('minimap')?.addEventListener('click', function () { sound.unlock(); });
// 纯键盘漫游与交互也可在真实用户手势中解锁音频，不劫持修饰键或输入框。
window.addEventListener('keydown', function (e) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)))) return;
  if (/^(KeyE|KeyG|KeyJ|KeyM|KeyC|KeyV|KeyT|KeyR|KeyK|KeyO|KeyP|KeyB|KeyQ|KeyL|KeyX|KeyN|Slash|Space)$/.test(e.code)) { sound.unlock(); return; }
  if (!document.body.classList.contains('map-open') && !journal.isOpen() && /^(KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowLeft|ArrowDown|ArrowRight)$/.test(e.code)) sound.unlock();
});

player.update(0.016, camera);
avatar.update(0.016, 0, player.state);
avatar.group.visible = player.state.view === 'third' &&
  player.state.camDist >= world.player.view.third.hideDistance;
petals.fill(camera.position.x, camera.position.y + 1.5, camera.position.z);

// ---- 帧率显示：左下角标常驻，F 键循环「角标 → 角标+详情 → 全隐」 ----
const FPS_RING = 240; // 最近 240 帧，60fps 下约 4 秒
const frameRing = new Float32Array(FPS_RING);
const GRAPH_W = 224;
const GRAPH_H = 54;
let fpsMode = 0;
let ringIdx = 0;
let ringLen = 0;
let statWarm = 0;
let graphCtx = null;

try {
  const savedMode = Number(window.localStorage.getItem('taohua.fps'));
  if (savedMode === 0 || savedMode === 1 || savedMode === 2) fpsMode = savedMode;
} catch (err) {
  fpsMode = 0;
}

function sizeFpsGraph() {
  if (!sGraph || !sGraph.getContext) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // CSS owns the card width; only the backing pixels adapt to its available lane.
  const cssWidth = sGraph.clientWidth || GRAPH_W;
  sGraph.width = Math.round(cssWidth * dpr);
  sGraph.height = Math.round(GRAPH_H * dpr);
  graphCtx = sGraph.getContext('2d');
  if (graphCtx) graphCtx.setTransform(sGraph.width / GRAPH_W, 0, 0, dpr, 0, 0);
}

// 帧时波形：纵轴反向，越低越贴底。刻度锚在本窗口的 p95 上（p95×1.7），
// 平稳时贴底、有卡顿时冒尖；冒过顶的按顶边截平
function drawFpsGraph(p95) {
  if (!graphCtx) return;
  const g = graphCtx;
  g.clearRect(0, 0, GRAPH_W, GRAPH_H);

  const n = Math.min(ringLen, 120);
  if (n < 2) return;

  const maxMs = Math.min(Math.max(p95 * 1.7, 14), 60);

  const xs = [];
  for (let i = 0; i < n; i++) {
    const ms = frameRing[(ringIdx - n + i + FPS_RING * 2) % FPS_RING];
    const x = (i / (n - 1)) * GRAPH_W;
    const y = GRAPH_H - (Math.min(ms, maxMs) / maxMs) * GRAPH_H;
    xs.push([x, y]);
  }

  g.beginPath();
  g.moveTo(xs[0][0], xs[0][1]);
  for (let i = 1; i < n; i++) g.lineTo(xs[i][0], xs[i][1]);
  g.lineTo(GRAPH_W, GRAPH_H);
  g.lineTo(0, GRAPH_H);
  g.closePath();
  g.fillStyle = 'rgba(74, 124, 111, 0.24)';
  g.fill();

  g.beginPath();
  g.moveTo(xs[0][0], xs[0][1]);
  for (let i = 1; i < n; i++) g.lineTo(xs[i][0], xs[i][1]);
  g.lineWidth = 1.2;
  g.strokeStyle = '#3E6A5E';
  g.stroke();
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function applyFpsMode() {
  fpsEl.hidden = fpsMode === 2;
  statsEl.hidden = fpsMode !== 1;
  if (fpsMode === 1) sizeFpsGraph();
}

function setFpsMode(mode) {
  fpsMode = mode;
  applyFpsMode();
  try {
    window.localStorage.setItem('taohua.fps', String(mode));
  } catch (err) {
    /* 隐私模式存不了，无妨 */
  }
}

applyFpsMode();

window.addEventListener('keydown', function (e) {
  if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey ||
      isControlTarget(e.target) ||
      isModalBusy(document, { runtime: { map, journal, discovery, scrollStudio, travelerGuide, questSystem } })) return;
  setFpsMode((fpsMode + 1) % 3);
});

// ---- 可选：?bench 自动跑一段并吐出实测数字 ----
const params = new URLSearchParams(window.location.search);
const benchMode = params.has('bench');
const benchTarget = Number(params.get('bench')) || 240;
const startAt = params.get('at');
const viewParam = params.get('view');
if (viewParam === 'first' || viewParam === 'third') {
  player.setView(viewParam);
  player.syncCamera(camera);
  avatar.group.visible = player.state.view === 'third' &&
    player.state.camDist >= world.player.view.third.hideDistance;
}
if (startAt === 'cave') {
  const ux = world.terrain.basin.x - cliff.slit.x;
  const uz = world.terrain.basin.z - cliff.slit.z;
  const l = Math.hypot(ux, uz) || 1;
  player.state.x = cliff.slit.x - (ux / l) * 32;
  player.state.z = cliff.slit.z - (uz / l) * 32;
  player.state.yaw = Math.atan2(-ux / l, -uz / l);
  player.state.targetYaw = player.state.yaw;
}
if (startAt === 'village') {
  player.state.x = village.houses[0][0];
  player.state.z = village.houses[0][1] + 16;
  player.state.yaw = 0.2;
}
let freeCam = null;
window.__CAM__ = function (x, y, z, yaw, pitch) {
  freeCam = x === null ? null : { x: x, y: y, z: z, yaw: yaw || 0, pitch: pitch || 0 };
};
let benchWarm = 0;
let benchFrames = 0;
let benchSeconds = 0;
let benchDone = false;

function finishBench() {
  benchDone = true;
  const calls = renderer.info.render.calls;
  const tris = renderer.info.render.triangles;
  const fps = benchFrames / Math.max(benchSeconds, 1e-6);
  const result = {
    fps: Math.round(fps * 10) / 10,
    frames: benchFrames,
    seconds: Math.round(benchSeconds * 1000) / 1000,
    drawCalls: calls,
    triangles: tris,
    programs: renderer.info.programs ? renderer.info.programs.length : -1,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    trees: flora.count,
    reeds: reeds.count,
    houses: village.count,
    fauna: fauna.count,
    fish: fish.count,
    boats: boats.count,
    people: people.count,
    view: player.state.view,
    avatar: avatar.count,
    smoke: smoke.count,
    blockers: barrier.count,
    dialoguePoints: dialogue.total,
    interactions: interaction.getStats(),
    map: map.getStats(),
    sky: sky.getStats(),
    fallenPetals: fallen.count,
    petals: petals.count,
    pixelRatio: renderer.getPixelRatio(),
    size: [window.innerWidth, window.innerHeight]
  };
  window.__BENCH__ = result;
  setFpsMode(1);
  sFps.textContent = result.fps;
  sCalls.textContent = calls;
  sTris.textContent = tris;
  if (window.console) console.log('BENCH ' + JSON.stringify(result));
}

const staticVisibility = optimizeStaticVisibility(scene, {
  extraRoots: ['reeds-group', 'qin-han-completion'],
  allowShader: function (mesh) {
    const n = mesh.name;
    return (
      n === 'reeds' ||
      n === 'mulberry-leaves' ||
      n === 'grass-near' ||
      n === 'qin-han-millet-crops' ||
      n === 'leisure-grove-solid' ||
      n === 'qianmo-paths-solid' ||
      n === 'wuling-outskirts-ext-solid' ||
      n === 'wuling-outskirts-int-solid' ||
      n === 'houses-tiles'
    );
  },
  extraMargin: function (mesh) {
    const n = mesh.name;
    if (n === 'reeds' || n === 'mulberry-leaves' || n === 'qin-han-millet-crops') return 0.35;
    if (n === 'grass-near') return 0.2;
    return 0;
  },
  cellSize: 12,
  getCellSize: (mesh) => (mesh && mesh.name === 'terrain' ? 24 : 12),
  getMaxDistance: function (camera, mesh) {
    const base = scene.fog && scene.fog.far ? scene.fog.far + 6 : Infinity;
    if (!mesh) return base;
    const n = mesh.name;
    const mobileScale = cachedMobileViewport ? 0.8 : 1;
    // 远草/野花与微末植被在雾尾收边，建筑、地形、路径与茶田等大场景地物直达 fog.far+6 绝不突兀冒出
    if (n === 'grass') return Math.min(base, 170 * mobileScale);
    if (n === 'flower-stems' || n === 'flower-heads' || n === 'stones') return Math.min(base, 165 * mobileScale);
    if (n === 'grass-near') return Math.min(base, 125 * mobileScale);
    if (n === 'grass-approach') return Math.min(base, 135 * mobileScale);
    if (n === 'mulberry-leaves') return Math.min(base, 240 * mobileScale);
    if (n === 'qin-han-millet-crops') return Math.min(base, 250 * mobileScale);
    if (n === 'village-props') return Math.min(base, 240 * mobileScale);
    if (
      n === 'village-scenes-botanical' ||
      n === 'village-scenes-ground' ||
      n === 'village-life-botanical' ||
      n === 'village-life-ground' ||
      n === 'habitat-details-botanical' ||
      n === 'habitat-details-ground' ||
      n === 'pond-life-underwater'
    ) return Math.min(base, 210 * mobileScale);
    if (n === 'valley-borderlands-shrubs') return Math.min(base, 220 * mobileScale);
    if (
      n === 'outer-wilds-tufts' ||
      n === 'deep-hollows-tufts' ||
      n === 'valley-borderlands-tufts' ||
      n === 'outer-wilds-wildflowers' ||
      n === 'valley-borderlands-wildflowers'
    ) return Math.min(base, 155 * mobileScale);
    if (n === 'deep-hollows-tea') return Math.min(base, 125 * mobileScale);
    return base;
  },
  getLod: function (mesh) {
    if (!mesh) return null;
    const n = mesh.name;
    if (n === 'bamboo') {
      return {
        geometry: createFarBambooGeometry(mesh),
        distance: 74,
        hysteresis: 10,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 2.3)
      };
    }
    if (n === 'outer-wilds-pines' || n === 'valley-borderlands-pines') {
      return {
        geometry: createFarPineGeometry(mesh),
        distance: 102,
        hysteresis: 12,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 1.85)
      };
    }
    if (n === 'outer-wilds-bamboo' || n === 'valley-borderlands-bamboo') {
      return {
        geometry: createFarHillBambooGeometry(mesh),
        distance: 90,
        hysteresis: 10,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 1.8)
      };
    }
    if (n === 'outer-wilds-blossoms' || n === 'valley-borderlands-blossoms') {
      return {
        geometry: createFarBlossomTreeGeometry(mesh),
        distance: 106,
        hysteresis: 12,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 1.75)
      };
    }
    if (n === 'outer-wilds-maples') {
      return {
        geometry: createFarMapleGeometry(mesh),
        distance: 106,
        hysteresis: 12,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 1.75)
      };
    }
    if (n === 'outer-wilds-crags' || n === 'valley-borderlands-crags') {
      return {
        geometry: createFarCragGeometry(mesh),
        distance: 112,
        hysteresis: 12,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 0.25)
      };
    }
    if (n === 'outer-wilds-tea-shrubs') {
      return {
        geometry: createFarShrubGeometry(mesh),
        distance: 92,
        hysteresis: 10,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 0.05)
      };
    }
    if (n.startsWith('tree-far-')) {
      return {
        geometry: createFarPeachTreeGeometry(mesh),
        distance: 128,
        hysteresis: 14,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, lodGeo.userData.splitY ?? 2.2)
      };
    }
    if (n === 'grass-near') {
      return {
        geometry: createFarGrassGeometry(mesh, 4),
        distance: 52,
        hysteresis: 8,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 0.18)
      };
    }
    if (n === 'grass') {
      return {
        geometry: createFarGrassGeometry(mesh, 3),
        distance: 84,
        hysteresis: 10,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 0.18)
      };
    }
    if (n === 'qin-han-millet-crops') {
      return {
        geometry: createFarMilletGeometry(mesh),
        distance: 78,
        hysteresis: 10,
        syncGeometry: (src, lodGeo) => syncLodVertexColors(src, lodGeo, 0.30)
      };
    }
    return null;
  },
  cliffPortal: {
    center: world.cliff.center,
    radius: world.cliff.radius,
    arcFrom: world.cliff.arcFrom,
    slit: cliff.slit
  }
});
const clock = new THREE.Clock();
let elapsed = 0;
let lastTime = performance.now();
let statAccum = 0;
let statFrames = 0;
let lastGloomOpacity = '';

renderer.setAnimationLoop(function () {
  const now = performance.now();
  const frameMs = now - lastTime;
  lastTime = now;

  const dt = Math.min(clock.getDelta(), 0.05);

  // 开图、游记、识物、画卷工坊、桃源小笺、简册或窗口失焦时统一冻结全部模拟（dt = 0），防止局部继续推进
  if (map.isOpen() || journal.isOpen() || discovery.isOpen || document.hidden || !document.hasFocus() || scrollStudio?.isOpen?.() || travelerGuide?.isGuideOpen?.() || questSystem?.isOpen?.()) {
    player.clearInput?.();
    discovery.update(0, false);
    sound.update(0, elapsed, camera, player.state, true);
    mysteries.update(0, elapsed);
    interaction.update(0, elapsed, camera);
    if (needsPostResizeRender && !document.hidden) {
      needsPostResizeRender = false;
      staticVisibility.render(renderer, camera);
    }
    return;
  }
  elapsed += dt;
  needsPostResizeRender = false;
  renderSurface.flush(window.innerWidth, window.innerHeight);

  player.update(dt, camera);
  barrier.resolve(player.state, 0.42);
  player.syncCamera(camera);
  if (freeCam) {
    camera.position.set(freeCam.x, freeCam.y, freeCam.z);
    camera.rotation.set(freeCam.pitch, freeCam.yaw, 0, 'YXZ');
  }

  // 自机角色只在第三人称、且相机没被墙挤到贴脸时出现
  avatar.update(dt, elapsed, player.state);
  avatar.group.visible = player.state.view === 'third' &&
    player.state.camDist >= world.player.view.third.hideDistance;

  // 天时与天气先算：雾、山色、风都要用这一帧的结果
  sky.update(dt, camera);
  mountains.update(dt, sky, camera);
  twilightWater.update(dt);
  map.setTimeAppearance(sky.timeId, dt, sky.weatherId);
  villageScenes.update(dt, elapsed, sky);
  villageLife.update(dt, elapsed, sky);
  peopleRaining = rainStateForIntensity(sky.rainIntensity, peopleRaining);
  people.setRain(peopleRaining);
  houseLight.update(dt, sky.timeId);
  quiet.update(sky, phenology);

  stream.update(dt, elapsed);
  fish.update(dt, elapsed);
  boats.update(dt, elapsed);
  reeds.update(elapsed, sky.wind, phenology?.currentId === 'autumn' ? 1 : 0);
  livingContext.timeId = sky.timeId;
  livingContext.rainIntensity = sky.rainIntensity;
  livingContext.playerSpeed = Math.hypot(player.state.vx, player.state.vz);
  fauna.update(dt, elapsed, player.state.x, player.state.z, livingContext);
  people.update(dt, elapsed, player.state.x, player.state.z, livingContext);
  dialogue.update(player.state, dt);
  interaction.update(dt, elapsed, camera);
  mysteries.update(dt, elapsed);
  player.setFocus(interaction.getFocus());
  if (!freeCam && !travelerGuide?.cruiseActive) interaction.applyCamera(camera, dt);
  discovery.update(dt);
  sound.update(dt, elapsed, camera, player.state, false);
// Round 6: updates begin
  if (!hospitalityFeast._talkWired) {
    hospitalityFeast._talkWired = true;
    hospitalityFeast.setOnTalk(function () { dialogue.trigger('feast-history'); });
  }
  if (!seasonalGathering._bound) {
    seasonalGathering._bound = true;
    const sgRoots = seasonalGathering.bind({ avatar, camera, player, sky, mysteries, sound, field: terrain.field, blockers: colliders, doc: document });
    sky.registerMaterials(seasonalGathering.group);
    for (const r of sgRoots) sky.registerMaterials(r);
  }
  if (!riverSkiff._bound) {
    riverSkiff._bound = true;
    const wantAutoBoard = (!benchMode && !params.has('at') && !params.has('shot') && !params.has('noskiff')) || params.has('skiff');
    riverSkiff.bind({
      player, avatar, camera, mysteries, sound, blockers: colliders, hintEl,
      doc: document, win: window, autoBoard: wantAutoBoard
    });
    sky.registerMaterials(riverSkiff.group);
    sky.registerMaterials(qinHanCompletion.group);
  }
  const r6Dt = dt;
  if ((sky.snowIntensity || 0) > 0.05) {
    peopleRaining = rainStateForIntensity(Math.max(sky.rainIntensity, (sky.snowIntensity || 0) * 0.88), peopleRaining);
    people.setRain(peopleRaining);
  }
  pondLife.update(r6Dt, elapsed, sky);
  village._pondTwilightWater?.update(r6Dt);
  waterworks.update(r6Dt, elapsed, sky);
  leisureGrove.update(r6Dt, elapsed, sky);
  communityLife.update(r6Dt, elapsed, sky, player.state);
  caveGleam.update(r6Dt, elapsed, camera.position, sky, handleValleyOpen);
  {
    const ef = caveGleam.getEmergenceEffect?.();
    const nextFov = cachedBaseFov + (ef && ef.active && !freeCam && !travelerGuide?.cruiseActive ? ef.fovDelta : 0);
    if (Math.abs(nextFov - lastAppliedFov) > 1e-4) {
      lastAppliedFov = nextFov;
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  }
  cavePassage.update(camera.position, Boolean(godFlight?.active || travelerGuide?.cruiseActive), Boolean(act3Finale?.caveSealed), r6Dt, sky);
  hospitalityFeast.update(r6Dt, elapsed, sky, player.state);
  smoke.setWeather(sky);
  qinHanHomestead.update(r6Dt, elapsed, sky, player.state);
  qinHanCompletion.update(r6Dt, elapsed, sky, player.state);
  oxPlowing.update(r6Dt, elapsed, sky, player.state);
  rainWater.update(r6Dt, elapsed, sky, camera);
  neighborTheaters.update(r6Dt, elapsed, sky, player.state);
  syncRound6LivingObstacles();
  tactileProps.update(r6Dt);
  ensureRound6Runtime();
  seasonalCycle?.update(r6Dt, elapsed, sky, player.state);
  phenology?.update(r6Dt, elapsed, sky);
  if (phenology && map.setPhenology) map.setPhenology(phenology.currentId);
  floraWind?.update(r6Dt, elapsed);
  {
    const br = leisureGrove.layout?.bridge;
    let onWood = false;
    if (br && Number.isFinite(br.x) && Number.isFinite(br.z)) {
      const dx = player.state.x - br.x;
      const dz = player.state.z - br.z;
      const along = Math.abs(dx * br.tx + dz * br.tz);
      const across = Math.abs(dx * br.ux + dz * br.uz);
      if (along <= br.length * 0.52 && across <= br.width * 0.55) onWood = true;
    }
    if (!onWood && qianmoPaths.isOnWood(player.state.x, player.state.z)) onWood = true;
    if (!onWood && outerWilds.isOnWood(player.state.x, player.state.z)) onWood = true;
    if (!onWood && deepHollows.isOnWood(player.state.x, player.state.z)) onWood = true;
    player.state.onWood = onWood;
  }
  footstepFxOpts.phenologyId = phenology?.currentId || 'spring';
  footstepFx.update(r6Dt, elapsed, player.state, sky, footstepFxOpts);
  sound.setQuietFocus?.(Boolean(quiet.active || situationalRest?.active));
  worldClock?.update(r6Dt);
  nightMeteors.update(r6Dt, sky, camera);
  easterEggs.update(r6Dt, elapsed, sky, player.state);
  valleyBorderlands.update(r6Dt, elapsed, sky, player.state);
  outerWilds.update(r6Dt, elapsed, sky, player.state);
  deepHollows.update(r6Dt, elapsed, sky, player.state);
  wildsEasterEggs.update(r6Dt, elapsed, sky, player.state);
  wulingOutskirts.update(r6Dt, elapsed, sky, player.state);
  riverSkiff.update(r6Dt, elapsed, sky, player.state, camera, freeCam || godFlight?.active || travelerGuide?.cruiseActive);
  situationalRest?.update(r6Dt, elapsed, sky, player.state, camera);
  if (situationalRest?.active && player.state.view === 'third') avatar.group.visible = true;
  godFlight?.update(r6Dt);
  if (godFlight?.active) avatar.group.visible = true;
  travelerGuide?.update(r6Dt);
  if (travelerGuide?.cruiseActive) avatar.group.visible = false;
  touchControls?.update?.(r6Dt);
  sky.syncCamera?.(camera);
  seasonalGathering.update(r6Dt, elapsed, sky, player.state, camera);
  act3Finale.update(r6Dt, elapsed, sky, player.state, camera);
  questSystem?.update(r6Dt, elapsed);
  sound.setLostMood?.(Boolean(act3Finale?.isLost));
  if (rawHinterlandPaths) rawHinterlandPaths.visible = false;
  portalVisibility?.update(camera, Boolean(godFlight?.active || travelerGuide?.cruiseActive));
  interiorCommunityRig.flush(camera, scene.fog?.far ? scene.fog.far + 6 : 326);
  inkAtmosphere.update(r6Dt, elapsed, sky, player.state, camera);
  architecturalCraft?.update(r6Dt, elapsed, sky, phenology, camera);
  poeticWayfinder?.update(r6Dt, elapsed, sky, player.state, camera);
  poeticInteractions?.update(r6Dt, elapsed, sky, player.state);
  syncEventsBuf.length = 0;
  syncEventsBuf.push(
    ...qinHanHomestead.consumeEvents(),
    ...riverSkiff.consumeEvents(),
    ...inkAtmosphere.consumeEvents(),
    ...oxPlowing.consumeEvents(),
    ...wulingOutskirts.consumeEvents()
  );
  if (syncWheel) syncWheel.phase = waterworks.wheelPhase;
  syncWorldPayload.rain = sky.rainIntensity;
  syncWorldPayload.snow = sky.snowIntensity || 0;
  syncWorldPayload.isNight = sky.timeId === 'night' || sky.timeId === 'dusk';
  syncWorldPayload.timeId = sky.timeId;
  syncWorldPayload.phenology = phenology?.currentId || 'spring';
  syncWorldPayload.sprinting = Boolean(player.state.sprinting || Math.hypot(player.state.vx || 0, player.state.vz || 0) > 5.6);
  syncWorldPayload.aboardSkiff = Boolean(player.state.aboardSkiff);
  syncWorldPayload.nightFeast = qinHanCompletion.getNightFeastState();
  sound.syncWorld(r6Dt, syncWorldPayload);
// Round 6: updates end
  smoke.update(dt, elapsed);
  petals.update(dt, elapsed, camera.position.x, camera.position.y, camera.position.z, sky.windX, sky.windZ);
  mountains.position.set(camera.position.x, 0, camera.position.z);
  map.update(dt);

  // 穿过山口时压暗：一线天里的「初极狭」，出洞即散；越岭飞览或高空巡游时不压暗天色
  const slitDist = Math.hypot(camera.position.x - cliff.slit.x, camera.position.z - cliff.slit.z);
  if (gloomEl) {
    const inCaveGloom = !godFlight?.active && !travelerGuide?.cruiseActive &&
      camera.position.y < cliff.slit.ground + (world.cliff.openHeight || 3) + 1.5;
    const k = inCaveGloom ? Math.max(0, 1 - slitDist / 13) : 0;
    const nextGloom = k <= 0 ? '0' : (k * k * world.gloom.max).toFixed(3);
    if (nextGloom !== lastGloomOpacity) {
      lastGloomOpacity = nextGloom;
      gloomEl.style.opacity = nextGloom;
      gloomEl.style.visibility = nextGloom === '0' || nextGloom === '0.000' ? 'hidden' : 'visible';
    }
  }
  contactShadows.update(dt, elapsed, camera, sky);
  staticVisibility.render(renderer, camera);
  if (warmedFrames < 4) warmedFrames++;

  if (benchMode && !benchDone) {
    if (benchWarm < 60) {
      benchWarm++;
    } else {
      benchSeconds += frameMs / 1000;
      benchFrames++;
      if (benchFrames >= benchTarget) finishBench();
    }
  }

  // ---- 帧率计量：角标 250ms 一刷，详情面板另算 4 秒窗口的 p95 与 1% low ----
  if (frameMs > 0 && frameMs < 400) {
    if (statWarm < 20) {
      statWarm++;
    } else {
      frameRing[ringIdx] = frameMs;
      ringIdx = (ringIdx + 1) % FPS_RING;
      if (ringLen < FPS_RING) ringLen++;
    }
    statAccum += frameMs;
    statFrames++;
    if (dprCooldownMs > 0) dprCooldownMs = Math.max(0, dprCooldownMs - frameMs);
    if (statAccum >= 250) {
      const live = (statFrames * 1000) / statAccum;
      if (!benchMode && dprOverride === null && statWarm >= 20) {
        const mobileEnv = cachedMobileViewport;
        const capDpr = targetMaxDpr();
        const minDpr = mobileEnv ? 0.85 : 1.0;
        const lowFpsThresh = mobileEnv ? 38 : 45;
        const highFpsThresh = mobileEnv ? 52 : 58;
        const cooldownTarget = mobileEnv ? 3000 : 5000;
        if (live < lowFpsThresh && currentDpr > minDpr) {
          dprHighStreak = 0;
          dprLowStreak++;
          if (dprCooldownMs <= 0 && dprLowStreak >= 3) {
            const nextDpr = Math.max(minDpr, Math.round((currentDpr - 0.25) * 20) / 20);
            if (nextDpr !== currentDpr) {
              currentDpr = nextDpr;
              renderSurface.scheduleDpr(currentDpr);
              dprCooldownMs = cooldownTarget;
              dprLowStreak = 0;
            }
          }
        } else if (live > highFpsThresh && currentDpr < capDpr) {
          dprLowStreak = 0;
          dprHighStreak++;
          if (dprCooldownMs <= 0 && dprHighStreak >= 8) {
            const nextDpr = Math.min(capDpr, Math.round((currentDpr + 0.25) * 20) / 20);
            if (nextDpr !== currentDpr) {
              currentDpr = nextDpr;
              renderSurface.scheduleDpr(currentDpr);
              dprCooldownMs = cooldownTarget;
              dprHighStreak = 0;
            }
          }
        } else {
          dprLowStreak = 0;
          dprHighStreak = 0;
        }
      }
      if (!fpsEl.hidden) {
        setText(fpsNum, live >= 20 ? String(Math.round(live)) : live.toFixed(1));
        const level = live >= 55 ? 'good' : live >= 40 ? 'warn' : 'bad';
        if (fpsEl.dataset.level !== level) fpsEl.dataset.level = level;
      }
      if (fpsMode === 1 && ringLen > 8) {
        let sum = 0;
        for (let i = 0; i < ringLen; i++) sum += frameRing[i];
        const avg = sum / ringLen;
        const sorted = Float32Array.from(frameRing.subarray(0, ringLen)).sort();
        const p95 = sorted[Math.min(ringLen - 1, Math.floor(ringLen * 0.95))];
        const low = sorted[Math.min(ringLen - 1, Math.floor(ringLen * 0.99))];
        setText(sFps, (1000 / avg).toFixed(1));
        setText(sMs, avg.toFixed(1) + ' ms');
        setText(sP95, p95.toFixed(1) + ' ms');
        setText(sLow, (1000 / low).toFixed(1) + ' fps');
        setText(sCalls, String(renderer.info.render.calls));
        setText(sTris, renderer.info.render.triangles.toLocaleString('en-US'));
        drawFpsGraph(p95);
      }
      statAccum = 0;
      statFrames = 0;
    }
  }
});

// 调试入口：控制台可直接查看渲染统计 / 传送
window.__APP__ = {
  meta: PROJECT_META,
  renderer: renderer,
  staticVisibility: staticVisibility,
  twilightWater: twilightWater,
  rainWater: rainWater,
  contactShadows: contactShadows,
  mountains: mountains,
  scene: scene,
  camera: camera,
  player: player,
  avatar: avatar,
  terrain: terrain,
  stream: stream,
  flora: flora,
  reeds: reeds,
  cliff: cliff,
  village: village,
  hinterland: hinterland,
  exterior: exterior,
  habitatDetails: habitatDetails,
// Round 6: debug begin
  pondLife: pondLife,
  waterworks: waterworks,
  leisureGrove: leisureGrove,
  communityLife: communityLife,
  caveGleam: caveGleam,
  hospitalityFeast: hospitalityFeast,
  qinHanHomestead: qinHanHomestead,
  qinHanCompletion: qinHanCompletion,
  oxPlowing: oxPlowing,
  riverSkiff: riverSkiff,
  seasonalGathering: seasonalGathering,
  openingCurtain: openingCurtain,
  nightMeteors: nightMeteors,
  easterEggs: easterEggs,
  act3Finale: act3Finale,
  cavePassage: cavePassage,
  neighborTheaters: neighborTheaters,
  tactileProps: tactileProps,
  inkAtmosphere: inkAtmosphere,
  valleyBorderlands: valleyBorderlands,
  qianmoPaths: qianmoPaths,
  outerWilds: outerWilds,
  deepHollows: deepHollows,
  wildsEasterEggs: wildsEasterEggs,
  wulingOutskirts: wulingOutskirts,
  footstepFx: footstepFx,
  get phenology() { return phenology; },
  get seasonalCycle() { return seasonalCycle; },
  get villagerDialogue() { return villagerDialogue; },
  get worldClock() { return worldClock; },
  get godFlight() { return godFlight; },
  get floraWind() { return floraWind; },
  get situationalRest() { return situationalRest; },
  get architecturalCraft() { return architecturalCraft; },
  get poeticWayfinder() { return poeticWayfinder; },
  get poeticInteractions() { return poeticInteractions; },
  get scrollStudio() { return scrollStudio; },
  get audioHud() { return audioHud; },
  get travelerGuide() { return travelerGuide; },
  get touchControls() { return touchControls; },
  get questSystem() { return questSystem; },
  get shadersPrewarmed() { return shadersPrewarmed; },
// Round 6: debug end
  discovery: discovery,
  journal: journal,
  villageScenes: villageScenes,
  villageLife: villageLife,
  mysteryWorld: mysteryWorld,
  mysteries: mysteries,
  fauna: fauna,
  fish: fish,
  boats: boats,
  people: people,
  dialogue: dialogue,
  interaction: interaction,
  sound: sound,
  map: map,
  sky: sky,
  weather: weather,
  quiet: quiet,
  houseLight: houseLight,
  quietSpots: quietSpots,
  world: world,
  teleport: function (x, z, yaw) {
    player.state.x = x;
    player.state.z = z;
    if (yaw !== undefined) {
      player.state.yaw = yaw;
      player.state.targetYaw = yaw;
      player.state.camYaw = yaw;
    }
    player.state.y = typeof terrain.field.walkSurface === 'function' ? terrain.field.walkSurface(x, z) : terrain.field.sample(x, z);
    player.state.vy = 0;
    player.state.grounded = true;
    player.state.airborne = false;
    player.state.onObstacle = false;
    player.state.jumpHeight = 0;
    player.state.jumpPhase = 0;
    player.state.landImpulse = 0;
  }
};

// 开发截图用：?shot=map 打开舆图；?shot=3d:x:z:yaw 传送到指定点
if (/(?:\?|&)shot=/.test(location.search)) {
  const mode = (location.search.match(/shot=([^&]+)/) || [])[1] || '';
  setTimeout(function () {
    try {
      if (mode === 'map') { window.__APP__.teleport(30, -96); map.open(); }
      else if (mode.indexOf('3d:') === 0) {
        const p = mode.split(':');
        window.__APP__.teleport(Number(p[1]), Number(p[2]), Number(p[3] || 0));
      }
    } catch (e) { console.error('shot hook', e); }
  }, 900);
}

function handleViewportResize() {
  cachedMobileViewport = isMobileViewport();
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  camera.aspect = w / h;
  cachedBaseFov = baseCameraFov();
  if (!caveGleam.getEmergenceEffect?.()?.active) {
    camera.fov = cachedBaseFov;
    lastAppliedFov = cachedBaseFov;
  }
  camera.updateProjectionMatrix();
  currentDpr = Math.min(currentDpr, targetMaxDpr());
  renderSurface.clearPending();
  if (renderSurface.sync(w, h, currentDpr)) {
    if (!document.hidden) {
      needsPostResizeRender = false;
      staticVisibility.render(renderer, camera);
    } else {
      needsPostResizeRender = true;
    }
  }
  map.resize();
  if (fpsMode === 1) sizeFpsGraph();
}
window.addEventListener('resize', handleViewportResize);
window.addEventListener('orientationchange', function () {
  handleViewportResize();
  setTimeout(handleViewportResize, 120);
});
window.visualViewport?.addEventListener?.('resize', handleViewportResize);
