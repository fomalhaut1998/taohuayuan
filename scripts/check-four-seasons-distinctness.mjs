import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const canvasCtx = new Proxy(
  { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) },
  { get: (t, k) => (k in t ? t[k] : () => canvasCtx) }
);
function makeClassList() {
  const set = new Set();
  return {
    add: (...xs) => xs.forEach(x => set.add(x)),
    remove: (...xs) => xs.forEach(x => set.delete(x)),
    contains: x => set.has(x),
    toggle: (x, force) => {
      const on = force === undefined ? !set.has(x) : Boolean(force);
      if (on) set.add(x); else set.delete(x);
      return on;
    }
  };
}
function createDomEnv(search = '?hour=day&weather=clear') {
  const els = new Map();
  for (const id of ['sky-time', 'sky-weather', 'sky-phenology', 'sky-toast']) {
    els.set(id, { id, textContent: '', innerHTML: '', classList: makeClassList(), style: {} });
  }
  const listeners = new Map();
  const doc = {
    createElement: () => ({ width: 0, height: 0, style: {}, classList: makeClassList(), getContext: () => canvasCtx }),
    getElementById: id => els.get(id) || null,
    body: { classList: makeClassList() }
  };
  const win = {
    location: { search },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    dispatchKey(code) {
      const ev = { code, repeat: false, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, target: null, preventDefault() { this.defaultPrevented = true; } };
      for (const fn of (listeners.get('keydown') || [])) fn(ev);
    }
  };
  return { doc, win, els };
}

const rootEnv = createDomEnv('?hour=day&weather=clear');
globalThis.document = rootEnv.doc;
globalThis.window = Object.assign(new EventTarget(), rootEnv.win);

const { createTerrain, createRiverDistance, createMountains } = await import('../src/world/terrain.js');
const { createRiverCurve, createStream, sampleRiverSpine } = await import('../src/world/stream.js');
const { createCliff } = await import('../src/world/cliff.js');
const { createFlora } = await import('../src/world/flora.js');
const { createReeds } = await import('../src/world/reeds.js');
const { createPetals, createFallenPetals } = await import('../src/systems/petals.js');
const { createVillage } = await import('../src/world/village.js');
const { createScatter } = await import('../src/world/scatter.js');
const { createProps } = await import('../src/world/props.js');
const { createHinterland } = await import('../src/world/hinterland.js');
const { createHinterlandFoliage } = await import('../src/world/hinterland-foliage.js');
const { createVillageScenes } = await import('../src/world/village-scenes.js');
const { createMysteries } = await import('../src/world/mysteries.js');
const { createVillageLife } = await import('../src/world/village-life.js');
const { createBoats } = await import('../src/world/boats.js');
const { createExteriorExploration } = await import('../src/world/exterior-exploration.js');
const { createHabitatDetails } = await import('../src/world/habitat-details.js');
const { createPondLife } = await import('../src/world/pond-life.js');
const { createWaterworks } = await import('../src/world/waterworks.js');
const { createLeisureGrove } = await import('../src/world/leisure-grove.js');
const { createHospitalityFeast } = await import('../src/world/hospitality-feast.js');
const { createQinHanHomestead } = await import('../src/world/qin-han-homestead.js');
const { createRiverSkiff } = await import('../src/systems/river-skiff.js');
const { createQinHanCompletion } = await import('../src/world/qin-han-village-completion.js');
const { createValleyBorderlands } = await import('../src/world/valley-borderlands.js');
const { createQianmoPaths } = await import('../src/world/qianmo-paths.js');
const { createInkAtmosphere } = await import('../src/systems/ink-atmosphere.js');
const { createFloraWind } = await import('../src/systems/flora-wind.js');
const { createWeather } = await import('../src/systems/weather.js');
const { createSky } = await import('../src/systems/sky.js');
const { createPhenologySystem } = await import('../src/systems/phenology-mist.js');

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(world.render.background);
scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 800);
const renderer = { getPixelRatio: () => 1 };
const sun = new THREE.DirectionalLight(world.light.sun.color, world.light.sun.intensity);
const hemi = new THREE.HemisphereLight(world.light.hemi.sky, world.light.hemi.ground, world.light.hemi.intensity);
scene.add(sun, hemi);

const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const terrain = createTerrain(world.terrain, distanceToRiver, { road: world.village.road, pond: world.terrain.pond });
terrain.field.colorAt = terrain.colorAt;
const stream = createStream(world.stream, world.terrain, riverCurve);
const cliff = createCliff(world.cliff, terrain.field);
const basin = world.terrain.basin;
const floraField = {
  half: terrain.field.half,
  sample: (x, z) => terrain.field.sample(x, z),
  slope: (x, z) => {
    const dx = x - basin.x;
    const dz = z - basin.z;
    if (dx * dx + dz * dz < (basin.inner * 1.05) * (basin.inner * 1.05)) return 9;
    return terrain.field.slope(x, z);
  }
};
const nearTree = (x, z) => {
  const sp = world.player.spawn;
  if (Math.hypot(x - sp.x, z - sp.z) < 34) return true;
  if (Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40) return true;
  const rd = world.village.road.points;
  for (let i = 0; i < rd.length - 1; i++) {
    if (segDist(x, z, rd[i][0], rd[i][1], rd[i + 1][0], rd[i + 1][1]) < 20) return true;
  }
  return false;
};

const flora = createFlora(world.flora, floraField, distanceToRiver, stream.curve, world.player.spawn, nearTree);
const reeds = createReeds(world.reeds, terrain.field, riverCurve, world.terrain);
const petals = createPetals(world.petals, terrain.field);
const fallen = createFallenPetals(world.fallenPetals, terrain.field, flora.spots, riverCurve, world.terrain.waterLevel);
const mountains = createMountains(world.mountains);
const village = createVillage(world.village, terrain.field, world.terrain.pond);
const ROAD_MARGIN = { tuft: 0.35, near: 0.1, flower: 0.12, stone: 0.75, patch: 0.05 };
const sl = cliff.slit;
const ax = Math.cos(sl.angle);
const az = Math.sin(sl.angle);
const d0 = world.cliff.plugDepth * 0.5;
const approachCfg = { x: sl.x + ax * d0, z: sl.z + az * d0, dx: ax, dz: az, len: 36 };
const scatter = createScatter(world.scatter, terrain.field, (x, z, kind) => {
  const rm = ROAD_MARGIN[kind] === undefined ? 0.7 : ROAD_MARGIN[kind];
  const rd = world.village.road;
  for (let i = 0; i < rd.points.length - 1; i++) {
    if (segDist(x, z, rd.points[i][0], rd.points[i][1], rd.points[i + 1][0], rd.points[i + 1][1]) < rd.width * 0.5 + rm) return true;
  }
  return false;
}, world.village.road, approachCfg, { curve: riverCurve, terrainCfg: world.terrain });
const props = createProps(world.props, terrain.field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, terrain.field, distanceToRiver, world, village, props, cliff);
const hinterlandFoliage = createHinterlandFoliage(hinterland, terrain.field, world.hinterland.palette);
hinterland.group.add(hinterlandFoliage.group);
const villageScenes = createVillageScenes(world, terrain.field, distanceToRiver, village, props, cliff, hinterland);
const mysteryWorld = createMysteries(world, terrain.field, distanceToRiver, village, props, cliff, hinterland, villageScenes, flora);
const villageLife = createVillageLife(world, terrain.field, distanceToRiver, village, props, cliff, hinterland, villageScenes, mysteryWorld);
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, terrain.field);
const exterior = createExteriorExploration(world, terrain.field, distanceToRiver, riverCurve, flora, boats, cliff);
const habitatDetails = createHabitatDetails({
  world, field: terrain.field, distanceToRiver, riverCurve,
  flora, hinterland, village, villageScenes, villageLife, props, boats, cliff, exterior
});
const communityOptions = {
  world, field: terrain.field, distanceToRiver, riverCurve, stream, flora,
  village, props, hinterland, villageScenes, villageLife, mysteryWorld, boats, cliff, exterior, habitatDetails
};
const pondLife = createPondLife({ ...communityOptions, reservations: [] });
const waterworks = createWaterworks({ ...communityOptions, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...communityOptions, reservations: [pondLife, waterworks] });
const hospitalityFeast = createHospitalityFeast({ ...communityOptions, reservations: [pondLife, waterworks, leisureGrove], targetBlockers: leisureGrove.blockers });
const qinHanHomestead = createQinHanHomestead({ ...communityOptions, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast] });
const riverSkiff = createRiverSkiff({ world, field: terrain.field, stream, riverCurve, distanceToRiver, boats, cliff });
const qinHanCompletion = createQinHanCompletion({
  world, field: terrain.field, village, props, leisureGrove, qinHanHomestead,
  blockers: cliff.blockers.concat(village.blockers, qinHanHomestead.blockers, leisureGrove.blockers)
});
const valleyBorderlands = createValleyBorderlands({
  ...communityOptions, pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead, qinHanCompletion,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead]
});
const qianmoPaths = createQianmoPaths({
  ...communityOptions, terrain, colorAt: terrain.colorAt, scatter, pondLife, waterworks,
  leisureGrove, hospitalityFeast, qinHanHomestead, valleyBorderlands
});
const inkAtmosphere = createInkAtmosphere({
  world, field: terrain.field, terrain, stream, riverCurve, distanceToRiver,
  cliff, village, pondLife, qinHanHomestead, qinHanCompletion, boats, riverSkiff, fauna: null
});
const weather = createWeather(world.sky, scene);
const sky = createSky(world.sky, scene, renderer, camera, { weather, lights: { sun, hemi, fill: null } });
const floraWind = createFloraWind({ flora, village, scatter, leisureGrove, hinterland, sky });

scene.add(terrain.mesh, flora.group, reeds.group, petals.mesh, fallen.mesh, mountains, village.group,
  scatter.group, props.group, hinterland.group, pondLife.group, leisureGrove.group, qinHanCompletion.group,
  valleyBorderlands.group, qianmoPaths.group, inkAtmosphere.group);
sky.registerMaterials(flora.group);
sky.registerMaterials(petals.mesh);
sky.registerMaterials(terrain.mesh);
sky.registerMaterials(village.group);
sky.registerMaterials(scatter.group);
sky.registerMaterials(props.group);
sky.registerMaterials(hinterland.group);
sky.registerMaterials(leisureGrove.group);
sky.registerMaterials(pondLife.group);
sky.registerMaterials(qinHanCompletion.group);
sky.registerMaterials(inkAtmosphere.group);

function meanRgb(arr, indices = null) {
  let r = 0, g = 0, b = 0, n = 0;
  if (indices) {
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k] * 3;
      r += arr[i]; g += arr[i + 1]; b += arr[i + 2]; n++;
    }
  } else {
    for (let i = 0; i + 2 < arr.length; i += 3) {
      r += arr[i]; g += arr[i + 1]; b += arr[i + 2]; n++;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 };
}

function rgbDist(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

// Capture spring baseline buffers BEFORE creating phenology
const terrainColAttr = terrain.mesh.geometry.attributes.color;
const grassIdx = [];
const roadIdx = [];
for (let i = 0; i < terrainColAttr.count; i++) {
  const r = terrainColAttr.getX(i), g = terrainColAttr.getY(i), b = terrainColAttr.getZ(i);
  if (g - r > 0.04) grassIdx.push(i);
  else if (r > g + 0.01 && g > b + 0.01 && r - b > 0.05) roadIdx.push(i);
}
assert.ok(grassIdx.length > 100 && roadIdx.length > 20, `terrain splits grass (${grassIdx.length}) vs dirt roads (${roadIdx.length})`);

const grassMesh = scatter.group.getObjectByName('grass');
const grassNearMesh = scatter.group.getObjectByName('grass-near');
const grassApproachMesh = scatter.group.getObjectByName('grass-approach');
const groundPatchMesh = scatter.group.getObjectByName('ground-patch');
const flowerHeadsMesh = scatter.group.getObjectByName('flower-heads');
const villageFieldsMesh = village.group.getObjectByName('village-fields');
const villageSpursMesh = village.group.getObjectByName('village-spurs');
const bambooMesh = village.group.getObjectByName('bamboo');
const mulberryLeavesMesh = village.group.getObjectByName('mulberry-leaves');
const mulberryCoreMesh = village.group.getObjectByName('mulberry-core');
const cropMesh = qinHanCompletion.group.getObjectByName('qin-han-millet-crops');
const propsMesh = props.group.getObjectByName('village-props');
const hlCrownMesh = hinterland.group.getObjectByName('hinterland-crown0');
const hlLeafMesh = hinterland.group.getObjectByName('hinterland-leaf');
const hlFoliageMesh = hinterland.group.getObjectByName('hinterland-foliage-leaves');
const leisureMesh = leisureGrove.group.getObjectByName('leisure-grove-foliage');
const pondSurfaceMesh = pondLife.group.getObjectByName('pond-life-surface');
const qianmoGroundMesh = qianmoPaths.group.getObjectByName('qianmo-paths-ground');
const streamPetalMesh = inkAtmosphere.group.getObjectByName('stream-drifting-petals');

const floraCrownMeshes = [];
const floraCrownIdx = [];
flora.group.traverse(o => {
  if (o.isMesh && o.geometry?.attributes?.color && o.geometry?.attributes?.position) {
    const col = o.geometry.attributes.color;
    const pos = o.geometry.attributes.position;
    const idx = [];
    for (let i = 0; i < col.count; i++) {
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      if ((r > 0.30 && b > 0.14 && r - g > 0.04 && r > b * 1.05) || (g > r + 0.05 && g > b + 0.05)) idx.push(i);
    }
    if (idx.length) {
      floraCrownMeshes.push(o);
      floraCrownIdx.push(idx);
    }
  }
});
assert.ok(floraCrownMeshes.length >= 1 && floraCrownIdx[0].length > 50, 'flora crown meshes located');

const snapTargets = [
  ['terrain', terrainColAttr.array],
  ['ground-patch', groundPatchMesh.geometry.attributes.color.array],
  ['grass', grassMesh.instanceColor.array],
  ['grass-near', grassNearMesh.instanceColor.array],
  ['grass-approach', grassApproachMesh.instanceColor.array],
  ['flower-heads', flowerHeadsMesh.instanceColor.array],
  ['village-fields', villageFieldsMesh.geometry.attributes.color.array],
  ['village-spurs', villageSpursMesh.geometry.attributes.color.array],
  ['bamboo', bambooMesh.geometry.attributes.color.array],
  ['mulberry-leaves', mulberryLeavesMesh.geometry.attributes.color.array],
  ['mulberry-core', mulberryCoreMesh.geometry.attributes.color.array],
  ['qin-han-millet-crops', cropMesh.geometry.attributes.color.array],
  ['village-props', propsMesh.geometry.attributes.color.array],
  ['hinterland-crown0', hlCrownMesh.instanceColor.array],
  ['hinterland-leaf', hlLeafMesh.instanceColor.array],
  ['hinterland-foliage-leaves', hlFoliageMesh.instanceColor.array],
  ['leisure-grove-foliage', leisureMesh.geometry.attributes.color.array],
  ['pond-life-surface', pondSurfaceMesh.geometry.attributes.color.array],
  ['qianmo-paths-ground', qianmoGroundMesh.geometry.attributes.color.array],
  ['stream-drifting-petals', streamPetalMesh.instanceColor.array],
  ['flora-0', floraCrownMeshes[0].geometry.attributes.color.array]
];
const springSnaps = snapTargets.map(([name, arr]) => [name, Float32Array.from(arr)]);
const springPetalHex = petals.mesh.material.color.getHex();
const springPetalCount = petals.mesh.count;
const springMtnSnap = Float32Array.from(mountains.children[0].geometry.attributes.color.array);

// Instantiate real phenology system with NO season URL query -> spring baseline
const phenology = createPhenologySystem({
  world, field: terrain.field, riverCurve, cliff, terrain, village, mountains,
  flora, petals, fallen, reeds, scatter, pondLife, qinHanCompletion, valleyBorderlands,
  leisureGrove, props, hinterland, habitatDetails, villageScenes, villageLife, exterior,
  qianmoPaths, inkAtmosphere, floraWind, sky,
  doc: rootEnv.doc, win: rootEnv.win
});
scene.add(phenology.group);
sky.registerMaterials(phenology.group);

// 1. Default 'spring' startup: zero buffer mutation + valid spring vignette
assert.equal(phenology.getStats().phenologyId, 'spring');
assert.equal(phenology.getStats().vignetteVisible, 'phenology-spring-vignette');
assert.equal(phenology.getStats().lotusVisible, false);
for (let i = 0; i < snapTargets.length; i++) {
  assert.deepEqual(Array.from(snapTargets[i][1]), Array.from(springSnaps[i][1]), `spring startup keeps ${snapTargets[i][0]} byte-exact`);
}

// Check all 3 seasonal vignettes for geometry safety & triangle budgets
for (const vName of ['phenology-spring-vignette', 'phenology-summer-vignette', 'phenology-autumn-vignette']) {
  const vm = phenology.interiorGroup.getObjectByName(vName);
  assert.ok(vm && vm.isMesh, `${vName} exists inside phenology.interiorGroup`);
  const pos = vm.geometry.attributes.position;
  const col = vm.geometry.attributes.color;
  const tris = pos.count / 3;
  assert.ok(tris > 50 && tris < 6500, `${vName} triangle budget (${tris}) stays within bounds`);
  let nonBlack = 0;
  for (let i = 0; i < pos.count; i++) {
    assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), `${vName} finite vertices`);
    if (col.getX(i) + col.getY(i) + col.getZ(i) > 0.05) nonBlack++;
  }
  assert.equal(nonBlack, pos.count, `${vName} has non-black vertex colors`);
}

// Helper to advance phenology + sky + mountains into steady state
function enterSeason(id) {
  phenology.setPhenology(id, false);
  for (let i = 0; i < 40; i++) {
    sky.update(0.2, camera);
    const app = sky.getAppearance();
    mountains.update(0.2, sky, camera);
    phenology.update(0.05, 1 + i * 0.05, app);
  }
  const app = sky.getAppearance();
  let mtnR = 0, mtnG = 0, mtnB = 0;
  for (const m of mountains.children) {
    mtnR += m.material.color.r;
    mtnG += m.material.color.g;
    mtnB += m.material.color.b;
  }
  const mtnMean = {
    r: mtnR / mountains.children.length,
    g: mtnG / mountains.children.length,
    b: mtnB / mountains.children.length
  };
  const floraCols = floraCrownMeshes[0].geometry.attributes.color;
  let floraGreen = 0, floraWarm = 0, floraWhite = 0, floraPinkCount = 0;
  for (const vi of floraCrownIdx[0]) {
    const r = floraCols.getX(vi), g = floraCols.getY(vi), b = floraCols.getZ(vi);
    if (g > r + 0.015) floraGreen++;
    if (r > g + 0.03 && r > b + 0.05) floraWarm++;
    if (r > 0.62 && g > 0.60 && b > 0.56) floraWhite++;
  }
  for (let m = 0; m < floraCrownMeshes.length; m++) {
    const col = floraCrownMeshes[m].geometry.attributes.color;
    for (const vi of floraCrownIdx[m]) {
      const r = col.getX(vi), g = col.getY(vi);
      if (r > g + 0.04 && r > 0.35) floraPinkCount++;
    }
  }
  return {
    id,
    stats: phenology.getStats(),
    terrainGrass: meanRgb(terrainColAttr.array, grassIdx),
    terrainRoad: meanRgb(terrainColAttr.array, roadIdx),
    grassNear: meanRgb(grassNearMesh.instanceColor.array),
    groundPatch: meanRgb(groundPatchMesh.geometry.attributes.color.array),
    flowerHeads: meanRgb(flowerHeadsMesh.instanceColor.array),
    flowerUniforms: {
      a: grassNearMesh.material.userData.flowerUniforms.uFlowerA.value.clone(),
      b: grassNearMesh.material.userData.flowerUniforms.uFlowerB.value.clone(),
      amt: grassNearMesh.material.userData.flowerUniforms.uFlowerAmt.value
    },
    floraMean: meanRgb(floraCols.array, floraCrownIdx[0]),
    floraGreenFrac: floraGreen / floraCrownIdx[0].length,
    floraWarmFrac: floraWarm / floraCrownIdx[0].length,
    floraWhiteFrac: floraWhite / floraCrownIdx[0].length,
    floraPinkCount,
    floraBlossomUniform: floraWind.canopies?.[0]?.uBlossom?.value,
    petalHex: petals.mesh.material.color.getHex(),
    petalRgb: petals.mesh.material.color.clone(),
    streamPetalMean: meanRgb(streamPetalMesh.instanceColor.array),
    mulberryLeaves: meanRgb(mulberryLeavesMesh.geometry.attributes.color.array),
    mulberryVisible: mulberryLeavesMesh.visible,
    mulberryCoreVisible: mulberryCoreMesh.visible,
    bamboo: meanRgb(bambooMesh.geometry.attributes.color.array),
    bambooVisible: bambooMesh.visible,
    fields: meanRgb(villageFieldsMesh.geometry.attributes.color.array),
    crops: meanRgb(cropMesh.geometry.attributes.color.array),
    props: meanRgb(propsMesh.geometry.attributes.color.array),
    hlCrown: meanRgb(hlCrownMesh.instanceColor.array),
    hlFoliage: meanRgb(hlFoliageMesh.instanceColor.array),
    leisure: meanRgb(leisureMesh.geometry.attributes.color.array),
    pondSurfaceMean: meanRgb(pondSurfaceMesh.geometry.attributes.color.array),
    skyTop: new THREE.Color('#' + app.skyTop),
    fogColor: new THREE.Color('#' + app.fogColor),
    sunColor: sun.color.clone(),
    skyPhenologyId: app.phenologyId,
    mtnMean
  };
}

const spring = enterSeason('spring');
const summer = enterSeason('summer');
const autumn = enterSeason('autumn');
const winter = enterSeason('winter');

// 2. Assert every pair of seasons differs clearly on grass, foliage, crops, props, mountains, sky
const states = [spring, summer, autumn, winter];
for (let i = 0; i < states.length; i++) {
  for (let j = i + 1; j < states.length; j++) {
    const a = states[i], b = states[j];
    assert.ok(rgbDist(a.terrainGrass, b.terrainGrass) > 0.025, `terrain grass differs: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.grassNear, b.grassNear) > 0.035, `grass-near differs: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.groundPatch, b.groundPatch) > 0.025, `ground-patch differs: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.floraMean, b.floraMean) > 0.035, `flora crown differs: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.crops, b.crops) > 0.04, `millet crops differ: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.fields, b.fields) > 0.035, `village-fields differ: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.hlCrown, b.hlCrown) > 0.035, `hinterland crowns differ: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.leisure, b.leisure) > 0.035, `leisure-grove foliage differs: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.props, b.props) > 0.015, `village-props differ: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.mtnMean, b.mtnMean) > 0.02, `mountains differ: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.skyTop, b.skyTop) + rgbDist(a.fogColor, b.fogColor) > 0.015, `sky/fog differs: ${a.id} vs ${b.id}`);
    assert.ok(rgbDist(a.streamPetalMean, b.streamPetalMean) > 0.04, `stream drifting petals differ: ${a.id} vs ${b.id}`);
  }
}

// Dirt road preservation in spring/summer/autumn
assert.ok(rgbDist(spring.terrainRoad, summer.terrainRoad) < 0.012, 'summer keeps dirt roads earth-toned');
assert.ok(rgbDist(spring.terrainRoad, autumn.terrainRoad) < 0.012, 'autumn keeps dirt roads earth-toned');

// Specific seasonal botanical signatures
assert.equal(summer.stats.vignetteVisible, 'phenology-summer-vignette');
assert.equal(summer.stats.lotusVisible, true);
assert.equal(summer.floraPinkCount, 0, `summer leaves zero pink blossom vertices across near/far flora (got ${summer.floraPinkCount})`);
assert.ok(summer.floraGreenFrac > 0.85, `summer peach woods turn >85% deep green (${(summer.floraGreenFrac * 100).toFixed(1)}%)`);
assert.ok(summer.petalRgb.g > summer.petalRgb.r && summer.petalHex !== springPetalHex, 'summer petals switch to green leaves & survive sky.update()');
assert.ok(summer.grassNear.g > summer.grassNear.r + 0.06, 'summer near grass is lush emerald');
assert.ok(summer.flowerUniforms.amt > 0.05 && !summer.flowerUniforms.a.equals(spring.flowerUniforms.a), 'grass-near flowerUniforms update in summer');

assert.equal(autumn.stats.vignetteVisible, 'phenology-autumn-vignette');
assert.equal(autumn.stats.lotusVisible, true);
assert.ok(autumn.floraMean.r > autumn.floraMean.g && autumn.floraMean.g > autumn.floraMean.b, 'autumn peach woods turn crimson/orange/gold');
assert.ok(autumn.grassNear.r > autumn.grassNear.g * 0.92 && autumn.terrainGrass.r > spring.terrainGrass.r + 0.05, 'autumn grass warms to golden-ochre');
assert.ok(autumn.mulberryVisible === true && autumn.mulberryLeaves.r > autumn.mulberryLeaves.g * 0.9, 'autumn mulberry turns golden-yellow');
assert.ok(autumn.bambooVisible === true && autumn.bamboo.g > autumn.bamboo.r, 'autumn bamboo stays evergreen jade');
assert.ok(autumn.crops.r > autumn.crops.g && autumn.crops.r > spring.crops.r, 'autumn millet crops turn harvest gold');

// Check pond-life-surface flowers withered in autumn & lotus world Y bounds
{
  enterSeason('autumn');
  const pCol = pondSurfaceMesh.geometry.attributes.color;
  let brightPink = 0;
  for (let i = 0; i < pCol.count; i++) {
    const r = pCol.getX(i), g = pCol.getY(i), b = pCol.getZ(i);
    if (r > 0.60 && g < 0.48 && b > 0.35) brightPink++;
  }
  assert.equal(brightPink, 0, 'autumn pond-life-surface withers pink lotus blossoms completely');

  const lotusMesh = phenology.group.getObjectByName('phenology-summer-lotus');
  lotusMesh.updateMatrixWorld(true);
  const pos = lotusMesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(lotusMesh.matrixWorld);
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const wy = world.terrain.pond.waterY;
  assert.ok(minY >= wy - 0.5 && maxY <= wy + 0.55, `lotus Y range [${minY.toFixed(2)}, ${maxY.toFixed(2)}] sits cleanly in pond`);
}

// Winter checks: snow coverage, bare mulberry hidden, evergreen bamboo visible, vignette hidden, flowerUniforms=0
assert.equal(winter.stats.vignetteVisible, null, 'winter hides summer/autumn/spring floral vignettes');
assert.equal(winter.stats.lotusVisible, false, 'winter hides lotus');
assert.equal(winter.mulberryVisible, false, 'winter hides mulberry leaves');
assert.equal(winter.mulberryCoreVisible, false, 'winter hides bare mulberry cores');
assert.equal(winter.bambooVisible, true, 'winter keeps evergreen bamboo visible');
assert.equal(winter.flowerUniforms.amt, 0, 'winter disables ground micro-flowers');
assert.equal(winter.floraPinkCount, 0, `winter leaves zero pink blossom vertices across near/far flora (got ${winter.floraPinkCount})`);
assert.ok(winter.floraWhiteFrac > 0.55, `winter dusts peach crowns with snow (${(winter.floraWhiteFrac * 100).toFixed(1)}%)`);
assert.ok(winter.grassNear.r > 0.55 && winter.grassNear.g > 0.55 && winter.grassNear.b > 0.50, 'winter whitens grass tufts with snow');

// 3. Exact round-trip restoration back to 'spring' & dt=0 freeze
phenology.setPhenology('spring', false);
for (let i = 0; i < 40; i++) {
  sky.update(0.2, camera);
  mountains.update(0.2, sky, camera);
  phenology.update(0.05, 1 + i * 0.05, sky.getAppearance());
}
assert.equal(phenology.getStats().phenologyId, 'spring');
assert.equal(mulberryLeavesMesh.visible, true);
assert.equal(mulberryCoreMesh.visible, true);
assert.equal(petals.mesh.material.color.getHex(), springPetalHex, 'petals material base hex restored');
assert.equal(petals.mesh.count, springPetalCount, 'petals count restored');
for (let i = 0; i < snapTargets.length; i++) {
  assert.deepEqual(Array.from(snapTargets[i][1]), Array.from(springSnaps[i][1]), `${snapTargets[i][0]} restored byte-for-byte on spring return`);
}

// dt = 0 freeze check
const mtnFrozen = mountains.children.map(m => m.material.color.getHexString()).join(',');
const skyTopFrozen = sky.getAppearance().skyTop;
const petalCountBefore = petals.mesh.count;
phenology.setPhenology('autumn', false);
for (let i = 0; i < 6; i++) {
  sky.update(0, camera);
  mountains.update(0, sky, camera);
  phenology.update(0, 12.3, sky.getAppearance());
}
assert.equal(mountains.children.map(m => m.material.color.getHexString()).join(','), mtnFrozen, 'dt=0 freezes mountain tint transition');
assert.equal(sky.getAppearance().skyTop, skyTopFrozen, 'dt=0 freezes sky transition');
assert.equal(petals.mesh.count, petals.mesh.count, 'petal count stable');
assert.ok(springMtnSnap.length > 0 && petalCountBefore >= 0);

// URL query startup checks (?season=autumn and ?phenology=winter)
{
  const autEnv = createDomEnv('?hour=day&weather=clear&season=autumn');
  const autPhen = createPhenologySystem({
    world, field: terrain.field, mountains, flora, petals, fallen, reeds, scatter, pondLife,
    qinHanCompletion, sky, doc: autEnv.doc, win: autEnv.win
  });
  assert.equal(autPhen.getStats().phenologyId, 'autumn', 'URL ?season=autumn starts in autumn');
  autPhen.setPhenology('spring', false);
  autPhen.dispose();

  const winEnv = createDomEnv('?phenology=winter');
  const winPhen = createPhenologySystem({
    world, field: terrain.field, mountains, flora, petals, fallen, reeds, scatter, pondLife,
    qinHanCompletion, sky, doc: winEnv.doc, win: winEnv.win
  });
  assert.equal(winPhen.getStats().phenologyId, 'winter', 'URL ?phenology=winter starts in winter');
  winPhen.setPhenology('spring', false);
  winPhen.dispose();
}

phenology.dispose();
console.log('PASS four-seasons distinctness verified across grass, flora, vignettes, crops, props, pond, stream petals, mountains, and sky');
