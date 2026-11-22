import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, createStream, sampleRiverSpine } from '../src/world/stream.js';
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
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createWaterSurface } from '../src/systems/twilight-water.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

const ctx2d = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => t[k] ?? (() => {}) });
globalThis.document = {
  body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  createElement: () => ({ getContext: () => ctx2d }),
  getElementById: () => null
};

const riverCurve = createRiverCurve(world.stream.points);
const riverSpine = sampleRiverSpine(riverCurve, 160);
const distanceToRiver = createRiverDistance(riverSpine);
const heightFn = createHeightFunction(world.terrain, distanceToRiver);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from(
  { length: grid.attributes.position.count },
  (_, i) => heightFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i))
);
grid.dispose();
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);

const stream = createStream(world.stream, world.terrain, riverCurve);
const cliff = createCliff(world.cliff, field);
const basin = world.terrain.basin;
const floraField = {
  half: field.half,
  sample: (x, z) => field.sample(x, z),
  slope: (x, z) => (Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z))
};
const nearTree = (x, z) =>
  Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34 ||
  Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40 ||
  world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);
const flora = createFlora(world.flora, floraField, distanceToRiver, riverCurve, world.player.spawn, nearTree);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, field, distanceToRiver, world, village, props, cliff);
const villageScenes = createVillageScenes(world, field, distanceToRiver, village, props, cliff, hinterland);
const villageLife = createVillageLife(
  world, field, distanceToRiver, village, props, cliff, hinterland, villageScenes,
  { anchors: planMysterySites(world, field, distanceToRiver, village, props, cliff, flora) }
);
const boats = createBoats(world.boats, stream, world.terrain, riverCurve, field);
const exterior = createExteriorExploration(world, field, distanceToRiver, riverCurve, flora, boats, cliff);
const habitatDetails = createHabitatDetails({
  world, field, distanceToRiver, riverCurve, flora, hinterland, village, villageScenes, villageLife, props, boats, cliff, exterior
});
const baseOpts = {
  world, field, distanceToRiver, riverCurve, stream: world.stream, flora,
  village, props, hinterland, villageScenes, villageLife, mysteryWorld: { blockers: [] },
  boats, cliff, exterior, habitatDetails
};
const pondLife = createPondLife({ ...baseOpts, reservations: [] });
const waterworks = createWaterworks({ ...baseOpts, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...baseOpts, reservations: [pondLife, waterworks] });
const qinHanHomestead = createQinHanHomestead({
  ...baseOpts, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove]
});
const allBlockers = [...cliff.blockers, ...village.blockers, ...leisureGrove.blockers, ...qinHanHomestead.blockers];
const completion = createQinHanCompletion({
  world, field, village, props, leisureGrove, qinHanHomestead, blockers: allBlockers
});

// ---- 1. Pond Ink-Wash Silhouette & Sky-Cloud Reflection Checks ----
const pondMesh = village.group.getObjectByName('pond');
assert.ok(pondMesh && pondMesh.isMesh, 'village pond mesh exists');

const px = world.terrain.pond.x;
const pz = world.terrain.pond.z;
const reflectors = [];
for (const r of (leisureGrove.layout?.regions || [])) {
  const dist = Math.hypot(r.x - px, r.z - pz);
  if (dist > 46) continue;
  if (r.kind === 'pavilion') reflectors.push({ dist, x: r.x, y: r.y, z: r.z, radius: 2.25, height: 4.15, kind: 1, shade: 0.96 });
  else if (r.kind === 'bamboo') reflectors.push({ dist, x: r.x, y: r.y, z: r.z, radius: 2.35, height: 5.4, kind: 2, shade: 0.90 });
  else reflectors.push({ dist, x: r.x, y: r.y, z: r.z, radius: 2.1, height: 4.8, kind: 0, shade: 0.85 });
}
for (const h of (village.houseInfo || [])) {
  const dist = Math.hypot(h.x - px, h.z - pz);
  if (dist <= 44) reflectors.push({ dist, x: h.x, y: h.gy, z: h.z, radius: Math.max(h.w, h.d) * 0.52, height: h.h + 1.75, kind: 3, shade: 0.88 });
}
for (const b of (village.bamboo || [])) {
  const dist = Math.hypot(b[0] - px, b[1] - pz);
  if (dist <= 42) reflectors.push({ dist, x: b[0], y: field.sample(b[0], b[1]), z: b[1], radius: 1.6 * (b[2] || 1), height: 5.2 * (b[2] || 1), kind: 2, shade: 0.90 });
}
reflectors.sort((a, b) => a.dist - b.dist);

let mockSkyState = {
  timeId: 'day',
  rainIntensity: 0,
  mistIntensity: 0,
  wind: 0.3,
  skyTop: 'b8d0dd',
  skyBottom: 'e8ece0',
  night: 0,
  dusk: 0,
  dawn: 0,
  amount: 0,
  dir: new THREE.Vector3(0.44, 0.72, 0.39),
  col: new THREE.Color(1, 0.95, 0.88)
};
const mockSky = {
  get timeId() { return mockSkyState.timeId; },
  get rainIntensity() { return mockSkyState.rainIntensity; },
  get mistIntensity() { return mockSkyState.mistIntensity; },
  get wind() { return mockSkyState.wind; },
  getAppearance: () => ({
    timeId: mockSkyState.timeId,
    weatherId: mockSkyState.rainIntensity > 0.5 ? 'rain' : 'sunny',
    night: mockSkyState.night,
    skyTop: mockSkyState.skyTop,
    skyBottom: mockSkyState.skyBottom,
    fogColor: mockSkyState.skyBottom
  }),
  getTwilightState: () => ({
    amount: mockSkyState.amount,
    dawn: mockSkyState.dawn,
    dusk: mockSkyState.dusk,
    direction: mockSkyState.dir,
    color: mockSkyState.col
  })
};

const pondWater = createWaterSurface(pondMesh, mockSky, {
  field,
  kind: 'pond',
  reflectors: reflectors.slice(0, 8)
});
const pondStats = pondWater.getStats();
assert.ok(pondStats.enabled && pondStats.inkEnabled, 'pond ink water surface enabled');
assert.ok(pondStats.reflectors >= 4 && pondStats.reflectors <= 8, `expected 4..8 shore reflectors, got ${pondStats.reflectors}`);
assert.equal(pondStats.addedDraws, 0, 'pond reflection adds 0 draw calls');
assert.equal(pondStats.addedRenderTargets, 0, 'pond reflection adds 0 render targets');
assert.equal(pondStats.addedTextures, 0, 'pond reflection adds 0 textures');

const pondShader = {
  uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.lambert.uniforms),
  vertexShader: THREE.ShaderLib.lambert.vertexShader,
  fragmentShader: THREE.ShaderLib.lambert.fragmentShader
};
pondMesh.material.onBeforeCompile(pondShader, {});
for (const token of ['inkCasterMask', 'uInkReflectPos', 'uInkReflectShape', 'uInkSkyTop', 'uInkSkyHorizon', 'cloudVeil', 'reedRim']) {
  assert.ok(pondShader.fragmentShader.includes(token), `pond fragment shader includes ${token}`);
}
assert.equal(pondShader.uniforms.uInkReflectCount.value, pondStats.reflectors, 'shader reflector count matches stats');

pondWater.update(0.5);
const clockAfterStep = pondWater.getStats().inkClock;
assert.ok(clockAfterStep > 0, 'pond ink clock advances on dt > 0');
pondWater.update(0);
assert.equal(pondWater.getStats().inkClock, clockAfterStep, 'pond ink clock freezes on dt = 0');

mockSkyState = {
  ...mockSkyState,
  timeId: 'dusk',
  skyTop: '8d8aa6',
  skyBottom: 'e6a87c',
  dusk: 0.92,
  amount: 0.92
};
pondWater.update(0.016);
assert.ok(
  pondShader.uniforms.uInkSkyHorizon.value.r > pondShader.uniforms.uInkSkyHorizon.value.b + 0.15,
  'pond horizon reflection warms at dusk'
);

// ---- 2. Paddy Water Mirror Elevation & Time-of-Day Color Temperature Checks ----
const paddyMesh = completion.group.getObjectByName('qin-han-paddy-water');
assert.ok(paddyMesh && paddyMesh.isMesh && paddyMesh.visible, 'qin-han-paddy-water mesh exists and is visible');
assert.ok(paddyMesh.material.customProgramCacheKey().includes('paddy-water'), 'paddy cache key preserved');

const pPos = paddyMesh.geometry.getAttribute('position');
const pUV = paddyMesh.geometry.getAttribute('aPaddyUV');
assert.ok(pUV && pUV.count === pPos.count, 'aPaddyUV attribute matches position vertex count');

// Verify every paddy water triangle has upward (+Y) CCW winding so FrontSide never backface-culls water from above
for (let i = 0; i < pPos.count; i += 3) {
  const ax = pPos.getX(i), ay = pPos.getY(i), az = pPos.getZ(i);
  const bx = pPos.getX(i + 1), by = pPos.getY(i + 1), bz = pPos.getZ(i + 1);
  const cx = pPos.getX(i + 2), cy = pPos.getY(i + 2), cz = pPos.getZ(i + 2);
  const abx = bx - ax, abz = bz - az;
  const acx = cx - ax, acz = cz - az;
  const crossY = abz * acx - abx * acz;
  assert.ok(crossY > 0.0001, `paddy triangle ${i / 3} must wind CCW upward (+Y), got crossY=${crossY}`);
}

// Verify every paddy water vertex sits strictly above village-fields' flat plot quad (centerY + 0.028)
const fieldLift = world.village?.fields?.lift ?? 0.025;
let checkedVerts = 0;
for (let bi = 0; bi < world.village.fields.blocks.length; bi++) {
  const blk = world.village.fields.blocks[bi];
  const [pw, ph] = blk.plot;
  for (let r = 0; r < blk.rows; r++) {
    for (let c = 0; c < blk.cols; c++) {
      if ((bi + r + c) % 3 === 0) continue; // dry millet plot
      const x0 = blk.x + c * (pw + blk.gap);
      const z0 = blk.z - r * (ph + blk.gap);
      const flatQuadY = field.sample(x0 + pw * 0.5, z0 - ph * 0.5) + fieldLift + 0.028;
      for (let i = 0; i < pPos.count; i++) {
        const vx = pPos.getX(i);
        const vy = pPos.getY(i);
        const vz = pPos.getZ(i);
        if (vx >= x0 && vx <= x0 + pw && vz <= z0 && vz >= z0 - ph) {
          assert.ok(
            vy >= flatQuadY + 0.004,
            `paddy water vertex (${vx.toFixed(2)}, ${vz.toFixed(2)}) y=${vy.toFixed(4)} must clear flat soil quad y=${flatQuadY.toFixed(4)}`
          );
          checkedVerts++;
        }
      }
    }
  }
}
assert.ok(checkedVerts >= pPos.count, `all ${pPos.count} paddy water vertices verified above soil quads`);

const paddyShader = {
  uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.lambert.uniforms),
  vertexShader: THREE.ShaderLib.lambert.vertexShader,
  fragmentShader: THREE.ShaderLib.lambert.fragmentShader
};
paddyMesh.material.onBeforeCompile(paddyShader, {});
for (const token of ['aPaddyUV', 'vPaddyUV', 'pRowMirror', 'uPaddySkyTop', 'uPaddySkyHorizon', 'uPaddyMist', 'uPaddyRain']) {
  assert.ok(
    paddyShader.vertexShader.includes(token) || paddyShader.fragmentShader.includes(token),
    `paddy shader includes ${token}`
  );
}

const playerPos = { x: 70, z: -145 };

// Day (昼：青玉留白)
mockSkyState = {
  ...mockSkyState,
  timeId: 'day',
  rainIntensity: 0,
  mistIntensity: 0,
  skyTop: 'b8d0dd',
  skyBottom: 'e8ece0',
  night: 0,
  dusk: 0,
  dawn: 0,
  amount: 0
};
completion.update(0.25, 1, mockSky, playerPos);
const dayColor = paddyMesh.material.color.clone();
assert.ok(dayColor.g > dayColor.r + 0.18, `day paddy water should be celadon-jade (G=${dayColor.g.toFixed(2)} > R=${dayColor.r.toFixed(2)})`);
assert.equal(paddyShader.uniforms.uPaddyMist.value, 0, 'clear day has 0 morning mist veil');
assert.ok(completion.getStats().drawCalls <= 4, `daytime completion drawCalls <= 4, got ${completion.getStats().drawCalls}`);

const paddyTimeBeforePause = paddyShader.uniforms.uPaddyTime.value;
completion.update(0, 1, mockSky, playerPos);
assert.equal(paddyShader.uniforms.uPaddyTime.value, paddyTimeBeforePause, 'paddy water clock freezes on dt = 0');

// Dawn (晓：晨雾冷碧微绯)
mockSkyState = {
  ...mockSkyState,
  timeId: 'dawn',
  skyTop: '9db7c6',
  skyBottom: 'e8cfc2',
  dawn: 0.90,
  dusk: 0,
  amount: 0.90,
  night: 0
};
completion.update(0.1, 1, mockSky, playerPos);
const dawnColor = paddyMesh.material.color.clone();
assert.ok(
  dawnColor.b > dawnColor.r + 0.15 && dawnColor.g > dawnColor.r + 0.15,
  `dawn paddy water should be cool morning celadon (R=${dawnColor.r.toFixed(2)}, G=${dawnColor.g.toFixed(2)}, B=${dawnColor.b.toFixed(2)})`
);
assert.ok(paddyShader.uniforms.uPaddyMist.value >= 0.35, `dawn paddy water carries morning mist veil (${paddyShader.uniforms.uPaddyMist.value})`);

// Dusk (暮：暖金桃霞)
mockSkyState = {
  ...mockSkyState,
  timeId: 'dusk',
  skyTop: '8d88a8',
  skyBottom: 'eead7e',
  dawn: 0,
  dusk: 0.92,
  amount: 0.92,
  night: 0
};
completion.update(0.1, 1, mockSky, playerPos);
const duskColor = paddyMesh.material.color.clone();
assert.ok(
  duskColor.r > duskColor.b + 0.35 && duskColor.r > dawnColor.r + 0.25,
  `dusk paddy water should glow warm amber-peach (R=${duskColor.r.toFixed(2)}, B=${duskColor.b.toFixed(2)})`
);
assert.ok(paddyShader.uniforms.uPaddyShimmerAmt.value > 0.95, 'dusk paddy shimmer intensifies');

// Night (夜：月华银靛)
mockSkyState = {
  ...mockSkyState,
  timeId: 'night',
  skyTop: '233246',
  skyBottom: '3c5068',
  dawn: 0,
  dusk: 0,
  amount: 0,
  night: 1
};
completion.update(0.1, 1, mockSky, playerPos);
const nightColor = paddyMesh.material.color.clone();
assert.ok(
  nightColor.b > nightColor.r + 0.22,
  `night paddy water should shift to moonlit indigo-silver (R=${nightColor.r.toFixed(2)}, B=${nightColor.b.toFixed(2)})`
);

// Rain (雨：烟青微澜)
mockSkyState = {
  ...mockSkyState,
  timeId: 'day',
  rainIntensity: 0.92,
  night: 0
};
completion.update(0.1, 1, mockSky, playerPos);
assert.ok(paddyShader.uniforms.uPaddyRain.value > 0.85, 'rainy weather activates paddy rain rings');
assert.ok(paddyShader.uniforms.uPaddyMist.value >= 0.25, 'rainy weather adds misty sheen to paddy water');

pondWater.dispose();
completion.dispose();
qinHanHomestead.dispose?.();
leisureGrove.dispose?.();
console.log('check-ink-reflections-paddy: ok');
