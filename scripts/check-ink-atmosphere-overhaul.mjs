import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createTerrain, createRiverDistance, createMountains } from '../src/world/terrain.js';
import { createRiverCurve, createStream, sampleRiverSpine } from '../src/world/stream.js';
import { createFlora } from '../src/world/flora.js';
import { createReeds } from '../src/world/reeds.js';
import { createScatter } from '../src/world/scatter.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createHinterlandFoliage } from '../src/world/hinterland-foliage.js';
import { createProps } from '../src/world/props.js';
import { createBoats } from '../src/world/boats.js';
import { createCaveGleam } from '../src/world/cave-gleam.js';
import { createFloraWind } from '../src/systems/flora-wind.js';
import { createSmoke } from '../src/systems/smoke.js';
import { createAvatar } from '../src/player/avatar.js';
import { createInkAtmosphere } from '../src/systems/ink-atmosphere.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const inkCfg = JSON.parse(readFileSync(new URL('../src/data/ink-landscape.json', import.meta.url), 'utf8'));
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

const ctx2d = new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, { get: (t, k) => t[k] ?? (() => {}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d }) };

// Build core world geometry
const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const terrain = createTerrain(world.terrain, distanceToRiver, { road: world.village.road, pond: world.terrain.pond });
terrain.field.colorAt = terrain.colorAt;
const stream = createStream(world.stream, world.terrain, riverCurve);
const cliff = createCliff(world.cliff, terrain.field);
const village = createVillage(world.village, terrain.field, world.terrain.pond);
const props = createProps(world.props, terrain.field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, terrain.field, distanceToRiver, world, village, props, cliff);
const hinterlandFoliage = createHinterlandFoliage(hinterland, terrain.field, world.hinterland.palette);
hinterland.group.add(hinterlandFoliage.group);
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, terrain.field);

// 1. Song-Yuan 青绿披麻皴 hillside striations & distant mountain crags
assert.ok(inkCfg.terrain.pimaMalachite && inkCfg.terrain.pimaAzurite && inkCfg.terrain.pimaOchre, 'ink-landscape.json defines pima mineral pigments');
{
  // Sample steep upper basin slope (r ~ 142m from basin center (30, -140)) and verify non-uniform brushwork variance
  let minSpread = Infinity;
  let maxSpread = -Infinity;
  let steepSamples = 0;
  for (let i = 0; i < 36; i++) {
    const ang = (i / 36) * Math.PI * 2;
    const x = 30 + Math.cos(ang) * 145;
    const z = -140 + Math.sin(ang) * 145;
    const h = terrain.field.sample(x, z);
    const sl = terrain.field.slope(x, z);
    if (h > 6.5 && sl > 0.16 && Math.hypot(x - cliff.slit.x, z - cliff.slit.z) > 30) {
      steepSamples++;
      const c = terrain.colorAt(x, z);
      const blueGreenRatio = (c.g + c.b * 0.85) / Math.max(0.05, c.r);
      if (blueGreenRatio < minSpread) minSpread = blueGreenRatio;
      if (blueGreenRatio > maxSpread) maxSpread = blueGreenRatio;
    }
  }
  assert.ok(steepSamples >= 16, 'found steep hillside samples around basin rim');
  assert.ok(maxSpread - minSpread > 0.08, 'hillside pima brushwork produces mineral malachite/azurite vs ochre variation');

  const mountains = createMountains(world.mountains);
  let cragCompiled = false;
  let maxCrag = 0;
  mountains.traverse((obj) => {
    if (!obj.isMesh || !obj.material?.onBeforeCompile) return;
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader
    };
    obj.material.onBeforeCompile(shader, {});
    if (shader.fragmentShader.includes('uInkMountainCrag')) {
      cragCompiled = true;
      assert.ok(shader.uniforms.uInkMountainCrag.value > 0.05, 'uInkMountainCrag positive on every mountain tier');
      maxCrag = Math.max(maxCrag, shader.uniforms.uInkMountainCrag.value);
    }
  });
  assert.ok(cragCompiled && maxCrag >= 0.15, 'distant mountain haze shader compiles procedural mineral-ink crag striations');
}

// 2. Canopy spherical normal softening + Half-Lambert wrap + backlit blossom/leaf translucency
{
  const basin = world.terrain.basin;
  const floraField = {
    half: terrain.field.half,
    sample: (x, z) => terrain.field.sample(x, z),
    slope: (x, z) => (Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : terrain.field.slope(x, z))
  };
  const flora = createFlora(world.flora, floraField, distanceToRiver, riverCurve, world.player.spawn, () => true);
  const scatter = createScatter(world.scatter, terrain.field, () => false, world.village.road, null);
  const mockSky = {
    timeId: 'dusk',
    weatherId: 'clear',
    rainIntensity: 0,
    wind: 1.0,
    windX: 0.8,
    windZ: 0.4,
    getAppearance: () => ({ timeId: 'dusk', weatherId: 'clear', rainIntensity: 0 })
  };
  const fw = createFloraWind({ flora, village, scatter, hinterland, sky: mockSky });
  const fwStats = fw.getStats();
  assert.ok(fwStats.categories['hinterland-foliage'] >= 1, 'flora-wind wraps hinterland-foliage crowns/leaves');
  assert.ok(fwStats.categories['village-mulberry-core'] >= 1, 'flora-wind wraps mulberry-core canopies');
  assert.ok(fwStats.translucency > 0.5, 'dusk boosts canopy backlit translucency');

  const nearCrown = flora.group.getObjectByName('tree-near-0');
  assert.ok(nearCrown?.material?.onBeforeCompile, 'tree-near-0 has flora-wind shader hook');
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader
  };
  nearCrown.material.onBeforeCompile(shader, {});
  assert.ok(shader.vertexShader.includes('vFloraSoftNormal'), 'canopy vertex shader computes dome soft normal');
  assert.ok(shader.fragmentShader.includes('#ifdef FLAT_SHADED'), 'canopy fragment shader overrides flat-shaded facet normals');
  assert.ok(shader.fragmentShader.includes('uFloraTransAmt'), 'canopy fragment shader applies backlit subsurface translucency');
  fw.dispose();
}

// 3. Fountain-arching reeds & 3-segment curved grass tufts with ground root color blending
{
  const reeds = createReeds(world.reeds, terrain.field, riverCurve, world.terrain);
  const reedMesh = reeds.group.getObjectByName('reeds');
  assert.ok(reedMesh && reedMesh.isInstancedMesh, 'reeds InstancedMesh created');
  // 5 blades * (4+1)*2 = 50 vertices, 5 * 4 * 2 = 40 triangles (120 indices)
  assert.ok(reedMesh.geometry.attributes.position.count >= 50, 'reed clump uses >= 5 blades x 4 segments');
  assert.ok(reedMesh.geometry.index.count >= 120, 'reed clump has >= 40 arched triangles per clump');
  // Check radial XZ arch extent (both X and Z span > 0.20, not collapsed to a flat plane)
  reedMesh.geometry.computeBoundingBox();
  const rb = reedMesh.geometry.boundingBox;
  assert.ok(rb.max.x - rb.min.x > 0.25 && rb.max.z - rb.min.z > 0.25, 'reed clump arches 3D radially in both X and Z');

  const scatter = createScatter(world.scatter, terrain.field, () => false, world.village.road, null);
  const grassMesh = scatter.group.getObjectByName('grass');
  assert.ok(grassMesh && grassMesh.isInstancedMesh, 'scatter grass InstancedMesh created');
  const vertsPerBlade = grassMesh.geometry.attributes.position.count / world.scatter.tuft.blades;
  assert.equal(vertsPerBlade, 15, 'each grass blade is 3 curved segments (5 triangles = 15 vertices)');
}

// 4, 6, 7, 9 & 1(b/c). Unified Ink Atmosphere (ridge trees, waist clouds, warm light pools, wake rings + duckweed, valley birds, stream petals)
{
  const skyStub = {
    timeId: 'day',
    weatherId: 'clear',
    rainIntensity: 0,
    fogColor: '#BAD8E7',
    registered: 0,
    registerMaterials() { this.registered++; },
    getAppearance() {
      if (this.timeId === 'night') {
        return { timeId: 'night', weatherId: this.weatherId, rainIntensity: this.rainIntensity, fogColor: '#2C3A4A', skyBottom: '#34465B', night: 1, nightAmount: 1 };
      }
      if (this.timeId === 'dusk') {
        return { timeId: 'dusk', weatherId: this.weatherId, rainIntensity: this.rainIntensity, fogColor: '#DCC4B4', skyBottom: '#F0C193', night: 0.25, nightAmount: 0.25 };
      }
      return { timeId: 'day', weatherId: this.weatherId, rainIntensity: this.rainIntensity, fogColor: '#BAD8E7', skyBottom: '#B6D9F0', night: 0, nightAmount: 0 };
    }
  };

  const inkAtm = createInkAtmosphere({
    world,
    field: terrain.field,
    terrain,
    stream,
    riverCurve,
    distanceToRiver,
    cliff,
    village,
    boats,
    sky: skyStub
  });

  const s0 = inkAtm.getStats();
  assert.ok(s0.ridgeTreeCount >= 160, 'ridge-ink-trees populates >= 160 distant mountain pines');
  assert.equal(s0.cloudRibbonCount, 14, 'mountain-waist-clouds builds 14 curved ribbons');
  assert.equal(s0.warmLightPools.visible, false, 'warm-light-pools strictly hidden during clear day (0 draws)');
  assert.equal(s0.valleyBirds.activeCount, 14, '14 white egrets soar during clear day');
  assert.equal(s0.streamPetalCount, 180, '180 drifting petals placed along Wuling stream');
  assert.ok(s0.duckweedClusters >= 36 && s0.shorePebbles >= 28, 'pond-duckweed populates shore coves and mossy pebbles');

  // Verify ridge trees stay clear of cave slit and above 11.5m
  const ridgeMesh = inkAtm.sharedGroup.getObjectByName('ridge-ink-trees');
  const tmpM = new THREE.Matrix4();
  const tmpP = new THREE.Vector3();
  for (let i = 0; i < ridgeMesh.count; i++) {
    ridgeMesh.getMatrixAt(i, tmpM);
    tmpP.setFromMatrixPosition(tmpM);
    assert.ok(tmpP.y >= 11.2, `ridge tree ${i} sits high on ridge (y=${tmpP.y.toFixed(2)})`);
    assert.ok(Math.hypot(tmpP.x - cliff.slit.x, tmpP.z - cliff.slit.z) > 28, `ridge tree ${i} clear of cave slit`);
  }

  // Advance in day and verify stream petals drift downstream & ripples spawn
  const petalMesh = inkAtm.exteriorGroup.getObjectByName('stream-drifting-petals');
  petalMesh.getMatrixAt(0, tmpM);
  const zBefore = new THREE.Vector3().setFromMatrixPosition(tmpM).z;
  inkAtm.spawnRipple(12, world.terrain.waterLevel + 0.02, 140, 1.4, 0.85);
  inkAtm.update(0.5, 0.5, skyStub, { x: 14, z: 150, vx: 0, vz: 0 }, null);
  petalMesh.getMatrixAt(0, tmpM);
  const zAfter = new THREE.Vector3().setFromMatrixPosition(tmpM).z;
  assert.notEqual(zBefore, zAfter, 'stream petals advance along stream when dt > 0');
  assert.ok(inkAtm.getStats().activeRipples >= 1, 'spawnRipple activates water-wake-rings');

  // Pause freeze check (dt = 0)
  const snapSim = inkAtm.getStats().simTime;
  inkAtm.update(0, 0.5, skyStub, { x: 14, z: 150, vx: 2, vz: 2 }, null);
  petalMesh.getMatrixAt(0, tmpM);
  assert.equal(new THREE.Vector3().setFromMatrixPosition(tmpM).z, zAfter, 'stream petals freeze on dt = 0');
  assert.equal(inkAtm.getStats().simTime, snapSim, 'inkAtmosphere simTime freezes on dt = 0');

  // Dusk transition: 24 homing birds + warm light pools turn on
  skyStub.timeId = 'dusk';
  inkAtm.update(0.25, 0.75, skyStub, null, null);
  const sDusk = inkAtm.getStats();
  assert.equal(sDusk.valleyBirds.mode, 'dusk-flock', 'dusk switches birds to homing V-flocks');
  assert.equal(sDusk.valleyBirds.activeCount, 24, 'all 24 birds join dusk homing flocks');
  assert.equal(sDusk.warmLightPools.visible, true, 'warm-light-pools illuminate cottage aprons at dusk');

  // Night transition: zero white mist patches (max RGB <= 0.17), birds roost, bonfire lit on clear night
  skyStub.timeId = 'night';
  inkAtm.update(0.25, 1.0, skyStub, null, null);
  const sNight = inkAtm.getStats();
  assert.ok(sNight.waistClouds.maxColorChannel <= 0.17, `night waist-clouds max RGB (${sNight.waistClouds.maxColorChannel}) <= 0.17 (never white)`);
  assert.equal(sNight.valleyBirds.visible, false, 'birds roost at night (0 draws)');
  assert.equal(sNight.warmLightPools.visible, true, 'warm-light-pools active at night');
  assert.equal(sNight.warmLightPools.bonfireFactor, 1, 'bonfire ground pool lit on clear night');

  // Heavy rain extinguishes bonfire pool and keeps birds roosting even in day
  skyStub.rainIntensity = 0.8;
  skyStub.weatherId = 'rain';
  inkAtm.update(0.25, 1.25, skyStub, null, null);
  assert.equal(inkAtm.getStats().warmLightPools.bonfireFactor, 0, 'rainy night extinguishes bonfire ground pool');
  skyStub.timeId = 'day';
  inkAtm.update(0.25, 1.5, skyStub, null, null);
  assert.equal(inkAtm.getStats().valleyBirds.visible, false, 'birds shelter during heavy rain');

  // Clear-day shore sprint: startled pond frog leaps into water with concentric ripples + frogPlop event
  skyStub.rainIntensity = 0;
  skyStub.weatherId = 'clear';
  const frogMesh = inkAtm.interiorGroup.getObjectByName('pond-startled-frog');
  assert.ok(frogMesh && frogMesh.visible === false, 'pond-startled-frog hidden when idle (0 extra idle draws)');
  const shoreSprintPlayer = {
    x: village.pond.x + 10.2,
    z: village.pond.z,
    vx: 0,
    vz: 6.2,
    sprinting: true
  };
  inkAtm.update(0.06, 1.56, skyStub, shoreSprintPlayer, null);
  assert.equal(inkAtm.getStats().startledFrogs, 1, 'sprinting near pond bank startles shore frog');
  assert.equal(inkAtm.getStats().frogLeaping, true, 'frog enters parabolic leap into pond');
  assert.equal(frogMesh.visible, true, 'pond-startled-frog visible during mid-leap');
  const midLeapY = frogMesh.position.y;
  inkAtm.update(0, 1.56, skyStub, shoreSprintPlayer, null);
  assert.equal(frogMesh.position.y, midLeapY, 'mid-leap frog strictly freezes on dt = 0');

  inkAtm.update(0.10, 1.66, skyStub, shoreSprintPlayer, null);
  inkAtm.update(0.10, 1.76, skyStub, shoreSprintPlayer, null);
  assert.equal(inkAtm.getStats().frogLeaping, false, 'frog completes dive into pond');
  assert.equal(frogMesh.visible, false, 'pond-startled-frog returns to 0 idle draws after splashdown');
  assert.ok(inkAtm.getStats().activeRipples >= 2, 'frog splashdown spawns concentric pond ripples');
  const atmEvents = inkAtm.consumeEvents();
  assert.equal(atmEvents.length, 1, 'splashdown emits single frogPlop audio event');
  assert.equal(atmEvents[0].type, 'frogPlop', 'emitted event has type frogPlop');
  assert.ok(
    Math.hypot(atmEvents[0].x - village.pond.x, atmEvents[0].z - village.pond.z) < 12,
    'frogPlop coordinates lie on pond water edge'
  );
  assert.equal(inkAtm.consumeEvents().length, 0, 'consumeEvents drains pending queue');
  inkAtm.update(0.06, 1.82, skyStub, shoreSprintPlayer, null);
  assert.equal(inkAtm.getStats().startledFrogs, 1, 'shore frog cooldown prevents immediate re-trigger');

  inkAtm.dispose();
  assert.equal(inkAtm.getStats().drawCalls, 0, 'dispose releases all inkAtmosphere draws');
}

// 5. Inner cave Tyndall light shafts ("复行数十步，豁然开朗")
{
  const cg = createCaveGleam({ world, cliff, field: terrain.field, emergenceAlong: -23.0, outerMouthAlong: 15.5 });
  const innerShafts = cg.group.getObjectByName('cave-gleam-inner-shafts');
  const innerMotes = cg.group.getObjectByName('cave-gleam-inner-motes');
  assert.ok(innerShafts && innerMotes, 'extended cave-gleam builds inner Tyndall shafts and motes');
  assert.equal(innerShafts.material.userData.skyIgnore, true, 'inner Tyndall shafts marked skyIgnore');

  const outX = Math.cos(cliff.slit.angle);
  const outZ = Math.sin(cliff.slit.angle);
  // Position camera at sAlong = -18m inside inner cave portal
  const camInner = new THREE.Vector3(cliff.slit.x - outX * 18, cliff.slit.ground + 1.6, cliff.slit.z - outZ * 18);
  cg.update(0.016, 1.0, camInner, { timeId: 'day' });
  const st = cg.getStats();
  assert.ok(st.innerIntensity > 0.5, `inner Tyndall shafts bright near valley emergence (got ${st.innerIntensity.toFixed(3)})`);
  assert.equal(innerShafts.visible, true, 'inner Tyndall shafts visible inside inner cave');
  cg.dispose();
}

// 8. Refined 3rd-person traveler avatar (exact 5 batches, rich silhouette, walking torso counter-sway)
{
  const av = createAvatar(world.player.avatar, world.player.walkSpeed);
  assert.equal(av.count, 5, 'traveler avatar preserves exact 5 draw batches');
  let meshCount = 0;
  let triCount = 0;
  av.group.traverse((o) => {
    if (o.isMesh) {
      meshCount++;
      const g = o.geometry;
      triCount += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  assert.equal(meshCount, 5, 'traveler avatar has exactly 5 mesh descendants');
  assert.ok(triCount >= 4500 && triCount <= 9000, `traveler avatar sculpted geometry within budget (${triCount} tris)`);

  // Idle upright check
  av.update(0.016, 1.0, { x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0 });
  const bodyNode = av.group.children[0];
  assert.ok(Math.abs(bodyNode.rotation.y) < 1e-4, 'idle avatar torso has zero twist');
  // Walking counter-sway check
  av.update(0.1, 1.25, { x: 0, y: 0, z: 0, vx: 0, vz: -3.2, yaw: 0 });
  assert.ok(Math.abs(bodyNode.rotation.y) > 0.002, 'walking avatar exhibits subtle natural torso counter-sway');
}

// 10. Wind-bent S-curve chimney smoke + dawn/dusk thermal inversion + dt=0 pause freeze
{
  const smoke = createSmoke(world.smoke, [{ x: 20, y: 5, z: -120 }]);
  smoke.setWeather({ timeId: 'dusk', weatherId: 'clear', rainIntensity: 0, windX: 1.2, windZ: 0.0 });
  assert.ok(smoke.getStats().inversion > 0.35, 'dusk activates thermal-inversion horizontal smoke flattening');
  smoke.update(0.5, 1.0);
  const posArr = smoke.points.geometry.attributes.position.array;
  let maxDownwindX = 0;
  for (let i = 0; i < smoke.count; i++) {
    maxDownwindX = Math.max(maxDownwindX, posArr[i * 3] - 20);
  }
  assert.ok(maxDownwindX > 0.6, 'chimney smoke bends downwind along windX');
  const snap = Float32Array.from(posArr);
  smoke.update(0, 2.0);
  assert.deepEqual(Array.from(smoke.points.geometry.attributes.position.array), Array.from(snap), 'smoke strictly freezes on dt = 0');

  smoke.setWeather({ timeId: 'night', weatherId: 'clear', rainIntensity: 0, windX: 0.4, windZ: 0.2 });
  const nightSmokeCol = smoke.points.material.uniforms.uColor.value;
  assert.ok(Math.max(nightSmokeCol.r, nightSmokeCol.g, nightSmokeCol.b) < 0.45, 'night chimney smoke tinted dark slate (never bright white)');
}

// Main wiring & console cleanliness checks
assert.ok(mainSrc.includes("import { createInkAtmosphere } from './systems/ink-atmosphere.js';"), 'main.js imports createInkAtmosphere');
assert.ok(mainSrc.includes('const inkAtmosphere = createInkAtmosphere('), 'main.js instantiates inkAtmosphere');
assert.ok(/inkAtmosphere\.update\((?:dt|r6Dt),\s*elapsed,\s*sky,\s*player\.state,\s*camera\);/.test(mainSrc), 'main.js updates inkAtmosphere in loop');
assert.ok(mainSrc.includes('...inkAtmosphere.consumeEvents()') && mainSrc.includes('frogVisualManaged: true'), 'main.js pipes inkAtmosphere frogPlop events to sound.syncWorld');
assert.ok(/floraWind\s*=\s*createFloraWind\(\{[^}]*\bhinterland\b[^}]*\}\);/.test(mainSrc), 'main.js passes hinterland to createFloraWind');

for (const rel of [
  'src/systems/ink-atmosphere.js',
  'src/systems/flora-wind.js',
  'src/world/cave-gleam.js',
  'src/systems/smoke.js',
  'src/world/reeds.js',
  'src/world/scatter.js',
  'src/player/avatar.js',
  'src/world/terrain.js',
  'src/world/ink-landscape.js'
]) {
  const code = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  assert.ok(!code.includes('console.log('), `${rel} contains zero console.log(`);
}

console.log('PASS check-ink-atmosphere-overhaul (all 10 Song-Yuan ink & living atmosphere upgrades verified)');
