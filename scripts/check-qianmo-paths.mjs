import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createFlora } from '../src/world/flora.js';
import { createReeds } from '../src/world/reeds.js';
import { createBoats } from '../src/world/boats.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createScatter } from '../src/world/scatter.js';
import { createProps } from '../src/world/props.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createHospitalityFeast } from '../src/world/hospitality-feast.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createEasterEggs } from '../src/world/easter-eggs.js';
import { createValleyBorderlands } from '../src/world/valley-borderlands.js';
import { createQianmoPaths } from '../src/world/qianmo-paths.js';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { catalogueEntry } from '../src/systems/catalogue.js';
import { discoveryScore } from '../src/systems/discovery-targets.js';
import { paintBase, projectionFor } from '../src/systems/mapdraw.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

// 1) Source hygiene & Act-3 taboo check
const qmSrc = readFileSync(new URL('../src/world/qianmo-paths.js', import.meta.url), 'utf8');
const qmJson = readFileSync(new URL('../src/data/qianmo-paths.json', import.meta.url), 'utf8');
const catSrc = readFileSync(new URL('../src/systems/catalogue.js', import.meta.url), 'utf8');
const fgSrc = readFileSync(new URL('../src/systems/field-guide.js', import.meta.url), 'utf8');
assert.equal(/\bconsole\.log\b/.test(qmSrc), false, 'qianmo-paths.js must not contain console.log');
for (const taboo of ['余烬', '祭坛', '裂谷', '灰烬', '祭祀']) {
  assert.equal(qmSrc.includes(taboo) || qmJson.includes(taboo), false, `qianmo sources must not mention ${taboo}`);
}
assert.ok(catSrc.includes("'qianmo-lanes'") && fgSrc.includes('qianmo:'), 'catalogue and field-guide include qianmo-lanes');

// Minimal canvas mock for terrain/village/mapdraw in Node
const noopGrad = () => ({ addColorStop() {} });
const makeMockCtx = () => {
  const ops = { strokes: 0, fills: 0, lines: 0 };
  const ctx = new Proxy({
    createRadialGradient: noopGrad,
    createLinearGradient: noopGrad,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    stroke() { ops.strokes++; },
    fill() { ops.fills++; },
    lineTo() { ops.lines++; },
    _ops: ops
  }, { get: (t, k) => t[k] ?? (() => {}) });
  return ctx;
};
globalThis.Path2D = class Path2D {
  moveTo() {}
  lineTo() {}
  closePath() {}
};
globalThis.document = {
  createElement: () => ({ width: 512, height: 256, getContext: () => makeMockCtx() })
};

const curve = createRiverCurve(world.stream.points);
const spine = sampleRiverSpine(curve, 160);
const river = createRiverDistance(spine);
const height = createHeightFunction(world.terrain, river);
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const heights = Float32Array.from(
  { length: grid.attributes.position.count },
  (_, i) => height(grid.attributes.position.getX(i), grid.attributes.position.getZ(i))
);
grid.dispose();
const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

const cliff = createCliff(world.cliff, field);
const basin = world.terrain.basin;
const floraField = {
  half: field.half,
  sample: (x, z) => field.sample(x, z),
  slope: (x, z) => Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z)
};
const near = (x, z) => Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34
  || Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40
  || world.village.road.points.some((p, i, a) => i && segDist(x, z, a[i - 1][0], a[i - 1][1], p[0], p[1]) < 20);
const flora = createFlora(world.flora, floraField, river, curve, world.player.spawn, near);
const reeds = createReeds(world.reeds, field, curve, world.terrain);
const boats = createBoats(world.boats, { surfaceY: () => world.terrain.waterLevel }, world.terrain, curve, field);
const village = createVillage(structuredClone(world.village), field, world.terrain.pond);

const ROAD_MARGIN = { tuft: 0.35, near: 0.1, flower: 0.12, stone: 0.75, patch: 0.05 };
const scatter = createScatter(world.scatter, field, function (x, z, kind) {
  const rm = ROAD_MARGIN[kind] === undefined ? 0.7 : ROAD_MARGIN[kind];
  const rd = world.village.road;
  for (let i = 0; i < rd.points.length - 1; i++) {
    if (segDist(x, z, rd.points[i][0], rd.points[i][1], rd.points[i + 1][0], rd.points[i + 1][1]) < rd.width * 0.5 + rm) return true;
  }
  for (const blk of world.village.fields.blocks) {
    const half = (blk.cols * blk.plot[0] + (blk.cols - 1) * blk.gap) * 0.5 + 0.5;
    if (Math.abs(x - blk.x) < half && Math.abs(z - blk.z) < half) return true;
  }
  if (Math.hypot(x - world.terrain.pond.x, z - world.terrain.pond.z) < world.terrain.pond.radius + 1.2) return true;
  for (const b of village.blockers) {
    const ca = Math.cos(b.rot), sa = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx * ca - dz * sa) < b.hw + 0.7 && Math.abs(dx * sa + dz * ca) < b.hd + 0.7) return true;
  }
  return false;
}, world.village.road, null);

const preScatterCounts = new Map();
scatter.group.traverse((obj) => {
  if (obj.isInstancedMesh) preScatterCounts.set(obj.name, obj.count);
});

const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, field, river, world, village, props, cliff);
const scenes = createVillageScenes(world, field, river, village, props, cliff, hinterland);
const mysteryWorld = createMysteries(world, field, river, village, props, cliff, hinterland, scenes, flora);
const life = createVillageLife(world, field, river, village, props, cliff, hinterland, scenes, mysteryWorld);
const exterior = createExteriorExploration(world, field, river, curve, flora, boats, cliff);
const communityOptions = {
  world, field, distanceToRiver: river, riverCurve: curve,
  stream: { surfaceY: () => world.terrain.waterLevel }, flora, village, props,
  hinterland, villageScenes: scenes, villageLife: life, mysteryWorld, boats, cliff, exterior
};
communityOptions.habitatDetails = createHabitatDetails(communityOptions);
const pondLife = createPondLife({ ...communityOptions, reservations: [] });
const waterworks = createWaterworks({ ...communityOptions, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...communityOptions, reservations: [pondLife, waterworks] });
const hospitalityFeast = createHospitalityFeast({ ...communityOptions, reservations: [pondLife, waterworks, leisureGrove], targetBlockers: leisureGrove.blockers });
const qinHanHomestead = createQinHanHomestead({ ...communityOptions, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast] });
leisureGrove.layout.qinHan = qinHanHomestead.layout;
const easterEggs = createEasterEggs({ ...communityOptions, pondLife, waterworks, leisureGrove, qinHanHomestead, reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead] });
const valleyBorderlands = createValleyBorderlands({
  ...communityOptions, pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead, easterEggs,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead, easterEggs]
});
leisureGrove.layout.borderlands = valleyBorderlands.layout;

const sourceGroups = [flora, reeds, boats, cliff, village, props, hinterland, scenes, life, exterior, communityOptions.habitatDetails, pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead, easterEggs, valleyBorderlands].map(m => m.group);
const snapshotLegacy = () => {
  const h = createHash('sha256');
  h.update(JSON.stringify([world.village, leisureGrove.layout.bridge, qinHanHomestead.layout.fieldHut, valleyBorderlands.layout.paths]));
  for (const g of sourceGroups) {
    g.traverse(o => {
      h.update(o.name || '');
      if (o.geometry?.attributes?.position) {
        const a = o.geometry.attributes.position.array;
        h.update(Buffer.from(a.buffer, a.byteOffset, Math.min(a.byteLength, 256)));
      }
    });
  }
  return h.digest('hex');
};
const legacyHashBefore = snapshotLegacy();

const qmOpts = {
  ...communityOptions, scatter, pondLife, waterworks, leisureGrove,
  hospitalityFeast, qinHanHomestead, easterEggs, valleyBorderlands
};
const qianmo = createQianmoPaths(qmOpts);
assert.equal(snapshotLegacy(), legacyHashBefore, 'qianmo creation must not mutate legacy scene geometry/layouts');

// 2) Layout counts & coverage across all 7 blocks
const stats = qianmo.getStats();
console.log('qianmo actual', JSON.stringify(stats));
assert.equal(stats.enabled, true);
assert.ok(qianmo.layout.arteries.length >= 8, 'expected >= 8 Tier 1 arteries');
assert.ok(qianmo.layout.spurs.length >= 6, 'expected >= 6 Tier 2 spurs');
assert.ok(qianmo.layout.interPlots.length >= 18, 'expected >= 18 Tier 3 inter-plot lanes');
const coveredBlocks = new Set(qianmo.layout.interPlots.map(ip => ip.blockIndex));
for (let bi = 0; bi < world.village.fields.blocks.length; bi++) {
  assert.ok(coveredBlocks.has(bi), `Tier 3 must cover farmland block ${bi}`);
}
assert.ok(qianmo.layout.culverts.length >= 16, 'expected >= 16 culverts');
assert.ok(qianmo.layout.plankBridges.length >= 6, 'expected >= 6 plank culverts');
assert.ok(qianmo.layout.boundaryStones.length >= 8, 'expected >= 8 boundary stones');
assert.ok(qianmo.layout.sheaves.length >= 5, 'expected >= 5 straw sheaves');
assert.ok(qianmo.layout.rillsCount > 0, 'expected wet paddy irrigation rills');

// 3) Determinism check
const qianmo2 = createQianmoPaths({ ...qmOpts, scatter: null });
assert.deepEqual(qianmo2.layout, qianmo.layout, 'repeated createQianmoPaths must produce byte-identical layout');
qianmo2.dispose();

// 4) Mesh / Material / Triangle Budget / Normal / VertexColor invariants
const meshes = [];
qianmo.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
assert.equal(meshes.length, 2, 'exactly 2 static meshes (ground + solid)');
assert.deepEqual(meshes.map(m => m.name).sort(), ['qianmo-paths-ground', 'qianmo-paths-solid']);

let totalTris = 0;
for (const m of meshes) {
  assert.equal(m.material.isMeshLambertMaterial, true, 'MeshLambertMaterial only');
  assert.equal(m.material.transparent, false, 'opaque materials only');
  assert.equal(m.material.vertexColors, true, 'vertexColors enabled');
  const pos = m.geometry.attributes.position;
  const nor = m.geometry.attributes.normal;
  const col = m.geometry.attributes.color;
  assert.ok(pos && nor && col && col.count === pos.count && nor.count === pos.count, 'complete position/normal/color attributes');
  const tris = pos.count / 3;
  assert.ok(tris > 50, `${m.name} non-empty`);
  totalTris += tris;

  const pa = pos.array;
  const na = nor.array;
  const ca = col.array;
  for (let i = 0; i < pa.length; i++) {
    assert.ok(Number.isFinite(pa[i]) && Number.isFinite(na[i]) && Number.isFinite(ca[i]), 'finite geometry attributes');
  }
  for (let i = 0; i < pos.count; i++) {
    const rgbSum = ca[i * 3] + ca[i * 3 + 1] + ca[i * 3 + 2];
    assert.ok(rgbSum > 0.15, `non-black vertex color at ${m.name} v${i}`);
  }
  for (let t = 0; t < tris; t++) {
    const b = t * 9;
    const abx = pa[b + 3] - pa[b], aby = pa[b + 4] - pa[b + 1], abz = pa[b + 5] - pa[b + 2];
    const acx = pa[b + 6] - pa[b], acy = pa[b + 7] - pa[b + 1], acz = pa[b + 8] - pa[b + 2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    assert.ok(cx * cx + cy * cy + cz * cz > 1e-10, `non-degenerate triangle ${t} in ${m.name}`);
    if (m.name === 'qianmo-paths-ground') {
      assert.ok(na[b + 1] > 0.5 && na[b + 4] > 0.5 && na[b + 7] > 0.5, `ground normal upward ny > 0.5 at tri ${t}`);
    }
  }
}
assert.ok(totalTris > 200 && totalTris < 18000, `triangle budget check: ${totalTris} < 18000`);

const visScene = new THREE.Scene();
visScene.add(qianmo.group);
const vis = optimizeStaticVisibility(visScene);
assert.equal(vis.entries.length, 2, 'optimizeStaticVisibility accepts both qianmo-paths meshes');
vis.dispose();
visScene.remove(qianmo.group);

// 5) Spatial safety checks (never enter pond water, crop interiors, or solid house blockers)
const pond = world.terrain.pond;
const plotBoxes = [];
for (let bi = 0; bi < world.village.fields.blocks.length; bi++) {
  const blk = world.village.fields.blocks[bi];
  const [pw, ph] = blk.plot;
  for (let r = 0; r < blk.rows; r++) {
    for (let c = 0; c < blk.cols; c++) {
      const xMin = blk.x + c * (pw + blk.gap);
      const zMax = blk.z - r * (ph + blk.gap);
      plotBoxes.push({ xMin, xMax: xMin + pw, zMin: zMax - ph, zMax });
    }
  }
}

const houseBlockers = [...village.blockers, ...hinterland.blockers];
function boxSigned(x, z, b) {
  const ca = Math.cos(b.rot || 0), sa = Math.sin(b.rot || 0);
  const dx = x - b.x, dz = z - b.z;
  const qx = Math.abs(dx * ca - dz * sa) - (b.hw || 0);
  const qz = Math.abs(dx * sa + dz * ca) - (b.hd || 0);
  return Math.hypot(Math.max(0, qx), Math.max(0, qz)) + Math.min(Math.max(qx, qz), 0);
}

for (const p of [...qianmo.layout.arteries, ...qianmo.layout.spurs, ...qianmo.layout.interPlots]) {
  for (let i = 1; i < p.points.length; i++) {
    const a = p.points[i - 1], b = p.points[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(2, Math.ceil(len / 0.5));
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const x = a[0] + (b[0] - a[0]) * u;
      const z = a[1] + (b[1] - a[1]) * u;
      assert.ok(Math.hypot(x - pond.x, z - pond.z) >= pond.waterRadius, `${p.id} enters pond water`);
      for (const pb of plotBoxes) {
        assert.equal(
          x > pb.xMin + 0.08 && x < pb.xMax - 0.08 && z > pb.zMin + 0.08 && z < pb.zMax - 0.08,
          false,
          `${p.id} point (${x.toFixed(2)}, ${z.toFixed(2)}) overlaps crop bed`
        );
      }
      for (const hb of houseBlockers) {
        assert.ok(boxSigned(x, z, hb) >= -0.02, `${p.id} hits house/building blocker at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
  }
}

// Check ground mesh vertices also respect crop bed interiors
const gPos = qianmo.groundMesh.geometry.attributes.position.array;
for (let i = 0; i < gPos.length; i += 3) {
  const gx = gPos[i], gz = gPos[i + 2];
  for (const pb of plotBoxes) {
    assert.equal(
      gx > pb.xMin + 0.05 && gx < pb.xMax - 0.05 && gz > pb.zMin + 0.05 && gz < pb.zMax - 0.05,
      false,
      `ground ribbon vertex (${gx.toFixed(2)}, ${gz.toFixed(2)}) intrudes into plot`
    );
  }
}

// 6) Scatter preservation + tread trimming
scatter.group.traverse((obj) => {
  if (obj.isInstancedMesh) {
    assert.equal(obj.count, preScatterCounts.get(obj.name), `scatter ${obj.name} count preserved`);
  }
});
assert.ok(stats.trimmedScatter > 0, 'scatter instances trimmed along path treads');

// 7) isOnWood check, Catalogue / Discovery target reachability, dt=0 freeze
const pb0 = qianmo.layout.plankBridges[0];
assert.equal(qianmo.isOnWood(pb0.x, pb0.z), true, 'isOnWood returns true over plank culvert');
assert.equal(qianmo.isOnWood(0, 0), false, 'isOnWood returns false far away');

const catEntry = catalogueEntry('qianmo-lanes');
assert.ok(catEntry && catEntry.group === 'landforms' && catEntry.name === '阡陌田径', 'catalogueEntry valid');
assert.ok(qianmo.targets.length === 1 && qianmo.targets[0].id === 'qianmo-lanes');
const tgt = qianmo.targets[0];
const eyePos = { x: tgt.x - 3.0, y: field.sample(tgt.x - 3.0, tgt.z) + world.player.eyeHeight, z: tgt.z };
const lookDir = new THREE.Vector3(tgt.x - eyePos.x, tgt.y - eyePos.y, tgt.z - eyePos.z).normalize();
assert.ok(Number.isFinite(discoveryScore(eyePos, lookDir, tgt, houseBlockers, field)), 'qianmo-lanes discoveryScore reachable');

const beforeSnap = JSON.stringify(qianmo.group.children.map(m => [m.name, m.position.toArray(), m.rotation.toArray()]));
for (const dt of [0, -1, NaN, Infinity]) qianmo.update(dt, 100);
const afterSnap = JSON.stringify(qianmo.group.children.map(m => [m.name, m.position.toArray(), m.rotation.toArray()]));
assert.equal(afterSnap, beforeSnap, 'dt <= 0 / non-finite freezes transform state');

// 8) 2D Map drawing test
const proj = projectionFor(world.map.extent, 1600, 720);
const ctxOff = makeMockCtx();
const ctxOn = makeMockCtx();
const baseMapSrc = { field, spots: null, houseInfo: village.houseInfo, marks: props.marks, mulberry: village.mulberry, hinterland, pond: village.pond, chimneys: village.chimneys, spine };
paintBase(ctxOff, proj, world.map, world, { ...baseMapSrc, leisureGrove: {} });
paintBase(ctxOn, proj, world.map, world, { ...baseMapSrc, leisureGrove: { qianmo: qianmo.layout } });
assert.ok(ctxOn._ops.strokes > ctxOff._ops.strokes, 'paintBase emits qianmo strokes onto handscroll map');

// 9) Resource disposal idempotence
let disposals = 0;
for (const m of meshes) {
  m.geometry.addEventListener('dispose', () => disposals++);
  m.material.addEventListener('dispose', () => disposals++);
}
qianmo.dispose();
qianmo.dispose();
assert.equal(disposals, 4, 'dispose cleans up 2 geometries + 2 materials exactly once');

console.log('check-qianmo-paths PASS');
