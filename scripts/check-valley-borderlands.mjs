import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine, createStream } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createCliff } from '../src/world/cliff.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createHospitalityFeast } from '../src/world/hospitality-feast.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createEasterEggs } from '../src/world/easter-eggs.js';
import { createValleyBorderlands } from '../src/world/valley-borderlands.js';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { createFloraWind } from '../src/systems/flora-wind.js';
import { createPhenologySystem } from '../src/systems/phenology-mist.js';
import { createSituationalRest } from '../src/systems/situational-rest.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { CATALOGUE, catalogueEntry } from '../src/systems/catalogue.js';
import { illustrationSVG } from '../src/systems/field-guide.js';
import { collectDiscoveryTargets } from '../src/systems/discovery-targets.js';
import { projectionFor, paintBase } from '../src/systems/mapdraw.js';

// 1. Hygiene & Lore Redline Checks
for (const rel of [
  '../src/world/valley-borderlands.js',
  '../src/world/valley-borderlands-geometry.js',
  '../src/data/valley-borderlands.json'
]) {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.ok(!/\bconsole\.log\s*\(/.test(src), `no console.log in ${rel}`);
  for (const taboo of ['处处志', '太守', '刘子骥', '南阳', '寻向所志', '遂迷', '不复得路']) {
    assert.ok(!src.includes(taboo), `no Act-3 spoiler '${taboo}' in ${rel}`);
  }
}

// 2. Catalogue & Field Guide SVG Verification
const newIds = [
  'cloud-terraces',
  'mountain-cascade',
  'wild-tea-herbs',
  'cliff-pine',
  'cloud-pavilion',
  'mountain-goat'
];
for (const id of newIds) {
  const entry = catalogueEntry(id);
  assert.ok(entry, `catalogue entry exists for ${id}`);
  assert.ok(entry.text.length >= 12, `descriptive text for ${id}`);
  const svg = illustrationSVG(CATALOGUE[id].icon);
  assert.match(svg, /^<svg[\s\S]+<\/svg>$/, `valid SVG for ${id}`);
}

// 3. Build Full World Context & Verify Determinism
const mockGrad = { addColorStop() {} };
const ctx2d = new Proxy({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  createRadialGradient: () => mockGrad,
  createLinearGradient: () => mockGrad
}, {
  get(t, k) {
    if (k in t) return t[k];
    return () => {};
  }
});
globalThis.Path2D = globalThis.Path2D || class Path2D { moveTo() {} lineTo() {} };
globalThis.document = {
  createElement: () => ({ width: 256, height: 256, getContext: () => ctx2d }),
  getElementById: () => null
};

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const curve = createRiverCurve(world.stream.points);
const spine = sampleRiverSpine(curve, 160);
const dist = createRiverDistance(spine);
const hfn = createHeightFunction(world.terrain, dist, { road: world.village.road, pond: world.terrain.pond });
const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
grid.rotateX(-Math.PI / 2);
const hs = new Float32Array(grid.attributes.position.count);
for (let i = 0; i < hs.length; i++) hs[i] = hfn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
const field = new Heightfield(world.terrain.size, world.terrain.segments, hs);

const cliff = createCliff(world.cliff, field);
const stream = createStream(world.stream, world.terrain, curve);
const basin = world.terrain.basin;
const floraField = {
  half: field.half,
  sample: (x, z) => field.sample(x, z),
  slope: (x, z) => Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z)
};
const flora = createFlora(world.flora, floraField, dist, curve, world.player.spawn, () => false);
const village = createVillage(world.village, field, world.terrain.pond);
const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
const hinterland = createHinterland(world.hinterland, field, dist, world, village, props, cliff);
const villageScenes = createVillageScenes(world, field, dist, village, props, cliff, hinterland);
const mysteryWorld = createMysteries(world, field, dist, village, props, cliff, hinterland, villageScenes, flora);
const villageLife = createVillageLife(world, field, dist, village, props, cliff, hinterland, villageScenes, mysteryWorld);
const boats = createBoats(world.boats, stream, world.terrain, curve, field);
const exterior = createExteriorExploration(world, field, dist, curve, flora, boats, cliff);
const habitatDetails = createHabitatDetails({
  world, field, distanceToRiver: dist, riverCurve: curve,
  flora, hinterland, village, villageScenes, villageLife, props, boats, cliff, exterior
});
const opts = {
  world, field, distanceToRiver: dist, riverCurve: curve, stream, flora,
  village, props, hinterland, villageScenes, villageLife, mysteryWorld, boats, cliff, exterior, habitatDetails
};
const pondLife = createPondLife({ ...opts, reservations: [] });
const waterworks = createWaterworks({ ...opts, reservations: [pondLife] });
const leisureGrove = createLeisureGrove({ ...opts, reservations: [pondLife, waterworks] });
const hospitalityFeast = createHospitalityFeast({ ...opts, reservations: [pondLife, waterworks, leisureGrove], targetBlockers: [...leisureGrove.blockers] });
const qinHanHomestead = createQinHanHomestead({ ...opts, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast] });
const easterEggs = createEasterEggs({
  ...opts, pondLife, waterworks, leisureGrove, qinHanHomestead,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead]
});

const vbOptions = {
  ...opts,
  pondLife,
  waterworks,
  leisureGrove,
  hospitalityFeast,
  qinHanHomestead,
  easterEggs,
  reservations: [pondLife, waterworks, leisureGrove, hospitalityFeast, qinHanHomestead, easterEggs]
};

const vb1 = createValleyBorderlands(vbOptions);
const vb2 = createValleyBorderlands(vbOptions);
assert.deepEqual(vb1.getStats(), vb2.getStats(), 'deterministic stats across builds');
assert.deepEqual(vb1.layout.pines, vb2.layout.pines, 'deterministic pine placements');
assert.deepEqual(vb1.layout.blossoms, vb2.layout.blossoms, 'deterministic blossom placements');
vb2.dispose();

const stats = vb1.getStats();
assert.ok(stats.pines >= 50, `rich pine population (${stats.pines})`);
assert.ok(stats.blossomTrees >= 35, `rich mountain blossom population (${stats.blossomTrees})`);
assert.ok(stats.bambooClusters >= 45, `rich hillside bamboo population (${stats.bambooClusters})`);
assert.ok(stats.shrubs >= 90, `tea rows, herb beds & paddy shoots (${stats.shrubs})`);
assert.ok(stats.crags >= 55, `stratified crag outcrops (${stats.crags})`);
assert.equal(stats.terraces, 5, 'five stepped crescent terraces');
assert.equal(stats.restSeats, 2, 'two scenic rest seats');

// 4. Material, Non-Black Color & Draw-Call Discipline
let propMeshCount = 0;
let visibleDraws = 0;
let totalWorldTris = 0;
vb1.group.traverse((obj) => {
  if (!obj.isMesh) return;
  if (!obj.name.startsWith('community-life-')) propMeshCount++;
  if (obj.visible && (!obj.parent || obj.parent.visible !== false)) visibleDraws++;
  const mat = obj.material;
  assert.ok(!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial, `no PBR on ${obj.name}`);
  assert.ok(!mat.map, `no bitmap texture on ${obj.name}`);
  const g = obj.geometry;
  const pos = g.getAttribute('position');
  assert.ok(pos && pos.count >= 3, `valid position attribute on ${obj.name}`);
  for (let i = 0; i < pos.array.length; i++) {
    assert.ok(Number.isFinite(pos.array[i]), `finite position in ${obj.name}`);
  }
  if (mat.vertexColors) {
    const col = g.getAttribute('color');
    assert.ok(col && col.count === pos.count, `matching color attribute on ${obj.name}`);
    for (let i = 0; i < col.array.length; i += 3) {
      const lum = col.array[i] + col.array[i + 1] + col.array[i + 2];
      assert.ok(Number.isFinite(lum) && lum > 0.05, `non-black finite vertex color on ${obj.name}`);
    }
  }
  if (obj.isInstancedMesh && obj.instanceColor) {
    for (let i = 0; i < obj.count; i++) {
      const r = obj.instanceColor.getX(i);
      const gg = obj.instanceColor.getY(i);
      const b = obj.instanceColor.getZ(i);
      assert.ok(Number.isFinite(r + gg + b) && (r + gg + b) > 0.05, `non-black instance color on ${obj.name}[${i}]`);
    }
  }
  const tris = (g.index ? g.index.count : pos.count) / 3;
  totalWorldTris += tris * (obj.isInstancedMesh ? obj.count : 1);
});
assert.ok(propMeshCount <= 12, `strict prop batch discipline (${propMeshCount} prop meshes)`);
assert.ok(visibleDraws <= 19, `strict visible daytime draw discipline (${visibleDraws} visible draws including 2 elders)`);
assert.ok(totalWorldTris < 125000, `lean sculpted triangle budget (${Math.round(totalWorldTris)} tris)`);

// 5. Clearance Against Houses, Pond, and Easter Eggs
for (const b of vb1.blockers) {
  for (const h of village.houseInfo) {
    assert.ok(Math.hypot(b.x - h.x, b.z - h.z) > 4.5, `blocker ${b.source} clear of house`);
  }
  for (const egg of easterEggs.sites) {
    assert.ok(Math.hypot(b.x - egg.x, b.z - egg.z) > 2.2, `blocker ${b.source} clear of easter egg ${egg.id}`);
  }
}

// 6. Walkability, Rest Seats, Discovery, Dialogue & Tactile Interactions
for (const seat of vb1.restSeats) {
  const rBasin = Math.hypot(seat.x - basin.x, seat.z - basin.z);
  assert.ok(rBasin < world.cliff.radius - 6.8, `seat ${seat.id} inside walkable basin rim (${rBasin.toFixed(1)})`);
}
for (const t of vb1.targets) leisureGrove.targets.push(t);
const discTargets = collectDiscoveryTargets({ ...opts, pondLife, waterworks, leisureGrove, qinHanHomestead });
for (const id of newIds) {
  assert.ok(discTargets.some(t => t.id === id), `live discovery target registered for ${id}`);
}

const restSys = createSituationalRest({
  world,
  field,
  player: { state: { x: 123.5, y: field.sample(123.5, -170), z: -170, yaw: 1.5, pitch: 0, view: 'first' } },
  avatar: { group: new THREE.Group() },
  camera: new THREE.PerspectiveCamera(),
  blockers: [...village.blockers, ...vb1.blockers],
  leisureGrove,
  valleyBorderlands: vb1
});
const sat = restSys.sitAt('cloud-pavilion-seat');
assert.ok(sat && restSys.active, 'can sit at Cloud-Viewing Pavilion rest seat');
restSys.standUp();
restSys.dispose();

// Villager dialogue check
const dlg = createVillagerDialogue({ sky: { timeId: 'day', weatherId: 'clear', rainIntensity: 0 } });
for (const v of vb1.getInteractables()) {
  const turn0 = dlg.beginOrAdvance({ ...v, kind: 'community', ref: v });
  assert.ok(turn0 && turn0.line.length > 8 && turn0.replies.length === 2, `rich dialogue for ${v.id}`);
  const turn1 = dlg.chooseReply(0);
  assert.ok(turn1 && turn1.line.length > 8, `branch dialogue for ${v.id}`);
  dlg.reset();
}

// Tactile tea stove & ancient stele interactions + dt === 0 pause check
const noteBox = { textContent: '', classList: { add() {}, remove() {} }, setAttribute() {} };
const teaRes = vb1.interactById('borderland-tea-stove', null, { getElementById: () => noteBox });
assert.ok(teaRes && noteBox.textContent.includes('茶'), 'tea stove tactile interaction updates note');
const steleRes = vb1.interactById('borderland-qin-stele', null, { getElementById: () => noteBox });
assert.ok(steleRes && noteBox.textContent.length > 10, 'ancient stele tactile interaction updates note');

vb1.update(0.25, 0.25, { timeId: 'night', rainIntensity: 0 });
const tBeforePause = vb1.getStats().simTime;
assert.equal(vb1.group.getObjectByName('valley-borderlands-glow').visible, true, 'warm glows visible at night');
vb1.update(0, 0.25, { timeId: 'night', rainIntensity: 0 });
assert.equal(vb1.getStats().simTime, tBeforePause, 'dt === 0 strictly freezes simulation time');
vb1.update(0.1, 0.35, { timeId: 'day', rainIntensity: 0 });
assert.equal(vb1.group.getObjectByName('valley-borderlands-glow').visible, false, 'glows hidden during clear day (0 daytime draw calls)');

// 7. Static Visibility, Portal/Frustum Viewport Budgets, Flora Wind & Scroll Map Painting
const testScene = new THREE.Scene();
testScene.add(vb1.group);
const vis = optimizeStaticVisibility(testScene);
assert.equal(vis.getStats().staticMeshes, 3, 'solid, ground & water baked meshes enrolled in spatial page culling');
assert.equal(vis.getStats().batches, 9, '3 paged meshes + 6 static instanced botanical/rock batches managed');
vis.dispose();

const fullScene = new THREE.Scene();
const terrainMesh = new THREE.Mesh(grid, new THREE.MeshLambertMaterial({ color: 0x6f8c54 }));
terrainMesh.name = 'terrain';
fullScene.add(
  terrainMesh, stream.mesh, flora.group, cliff.group, village.group,
  props.group, hinterland.group, villageScenes.group, mysteryWorld.group,
  villageLife.group, boats.group, exterior.group, habitatDetails.group,
  pondLife.group, waterworks.group, leisureGrove.group, hospitalityFeast.group,
  qinHanHomestead.group, easterEggs.group, vb1.group
);
const fullVis = optimizeStaticVisibility(fullScene, {
  cliffPortal: { center: world.cliff.center, radius: world.cliff.radius, slit: cliff.slit }
});
const viewCam = new THREE.PerspectiveCamera(world.render.camera.fov, 16 / 9, world.render.camera.near, world.render.camera.far);
viewCam.rotation.order = 'YXZ';
const frustum = new THREE.Frustum();
const projMat = new THREE.Matrix4();

function measureViewport(x, y, z, yaw, pitch, flying = false) {
  viewCam.position.set(x, y, z);
  viewCam.rotation.set(pitch, yaw, 0);
  viewCam.updateProjectionMatrix();
  const slitDistR = Math.hypot(x - cliff.slit.x, z - cliff.slit.z);
  const camR = Math.hypot(x - world.cliff.center[0], z - world.cliff.center[1]);
  const hideExterior = !flying && slitDistR > 40 && y < 18 && camR > world.cliff.radius + 22;
  hospitalityFeast.group.visible = !hideExterior;
  qinHanHomestead.group.visible = !hideExterior;
  easterEggs.group.visible = !hideExterior;
  waterworks.group.visible = !hideExterior;
  vb1.group.visible = !hideExterior;

  let out = { calls: 0, triangles: 0, vbCalls: 0, vbTriangles: 0 };
  fullVis.render({
    render(s, c) {
      s.updateMatrixWorld(true);
      c.updateWorldMatrix(true, false);
      projMat.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projMat);
      function visit(o, inVb) {
        if (!o.visible) return;
        const nextVb = inVb || o === vb1.group;
        if (o.isMesh && o.layers.test(c.layers) && (!o.frustumCulled || frustum.intersectsObject(o))) {
          const g = o.geometry;
          const n = o.isInstancedMesh ? o.count : 1;
          const start = g.drawRange.start;
          const end = Math.min(g.index?.count ?? g.attributes.position.count, start + g.drawRange.count);
          if (Array.isArray(o.material)) {
            for (const grp of g.groups) {
              if (o.material[grp.materialIndex]?.visible) {
                const tris = Math.max(0, Math.min(end, grp.start + grp.count) - Math.max(start, grp.start)) / 3 * n;
                out.calls++;
                out.triangles += tris;
                if (nextVb) { out.vbCalls++; out.vbTriangles += tris; }
              }
            }
          } else if (o.material.visible) {
            const tris = (end - start) / 3 * n;
            out.calls++;
            out.triangles += tris;
            if (nextVb) { out.vbCalls++; out.vbTriangles += tris; }
          }
        }
        for (const child of o.children) visit(child, nextVb);
      }
      visit(s, false);
    }
  }, viewCam);
  out.triangles = Math.round(out.triangles);
  out.vbTriangles = Math.round(out.vbTriangles);
  return out;
}

const vpAct1 = measureViewport(world.player.spawn.x, 1.8, world.player.spawn.z, 0, 0, false);
const vpVillage = measureViewport(31, 5.0, -90, 0.14, -0.06, false);
const vpEastAerial = measureViewport(66, 32.3, -148, -1.12, -0.22, true);
const vpNorthAerial = measureViewport(46, 26.5, -168, 0.22, -0.18, true);
const vpNorthWalk = measureViewport(28, field.sample(28, -216) + 1.65, -216, 0.05, 0.02, false);

assert.equal(vpAct1.vbCalls, 0, 'Act 1 outside cave submits 0 valley-borderlands draw calls');
assert.equal(vpAct1.vbTriangles, 0, 'Act 1 outside cave submits 0 valley-borderlands triangles');
assert.ok(vpVillage.calls < 200 && vpVillage.triangles < 450000, `village baseline within budget (${vpVillage.calls} calls, ${vpVillage.triangles} tris)`);
assert.ok(vpEastAerial.calls < 260 && vpEastAerial.triangles < 750000, `East aerial panorama within high budget (${vpEastAerial.calls} calls, ${vpEastAerial.triangles} tris)`);
assert.ok(vpNorthAerial.calls < 260 && vpNorthAerial.triangles < 750000, `North aerial panorama within high budget (${vpNorthAerial.calls} calls, ${vpNorthAerial.triangles} tris)`);
assert.ok(vpNorthWalk.calls < 200 && vpNorthWalk.triangles < 450000, `North terraces walk view within baseline budget (${vpNorthWalk.calls} calls, ${vpNorthWalk.triangles} tris)`);
fullVis.dispose();

const wind = createFloraWind({ valleyBorderlands: vb1, sky: { timeId: 'day' } });
assert.equal(wind.getStats().meshes, 5, 'pines, blossoms, bamboo, shrubs & meadow tufts enrolled in wind sway');
wind.dispose();

leisureGrove.layout.borderlands = vb1.layout;
const proj = projectionFor(world.map.extent, 900, 375);
paintBase(ctx2d, proj, world.map, world, {
  field,
  spots: flora.spots,
  houseInfo: village.houseInfo,
  marks: props.marks,
  bamboo: village.bamboo,
  mulberry: village.mulberry,
  hinterland,
  villageScenes: villageScenes.mapData,
  villageLife: villageLife.mapData,
  pond: village.pond,
  chimneys: village.chimneys,
  spine,
  exterior: exterior.mapData,
  pondLife: pondLife.layout,
  waterworks: waterworks.layout,
  leisureGrove: leisureGrove.layout
});

// 8. Seasonal Phenology ('春深落英' / '夏初新荷' / '秋熟金粟') & Autumn Dawn Hoarfrost ('远树微霜')
const vbWater = vb1.group.getObjectByName('valley-borderlands-water');
const vbSolid = vb1.group.getObjectByName('valley-borderlands-solid');
const vbGround = vb1.group.getObjectByName('valley-borderlands-ground');
const vbPines = vb1.group.getObjectByName('valley-borderlands-pines');
const vbBlossoms = vb1.group.getObjectByName('valley-borderlands-blossoms');
const vbShrubs = vb1.group.getObjectByName('valley-borderlands-shrubs');
const vbCrags = vb1.group.getObjectByName('valley-borderlands-crags');
const vbTufts = vb1.group.getObjectByName('valley-borderlands-tufts');
const vbFauna = vb1.group.getObjectByName('valley-borderlands-fauna');

const snapSpring = {
  water: Float32Array.from(vbWater.geometry.attributes.color.array),
  solid: Float32Array.from(vbSolid.geometry.attributes.color.array),
  ground: Float32Array.from(vbGround.geometry.attributes.color.array),
  pineGeo: Float32Array.from(vbPines.geometry.attributes.color.array),
  blossomGeo: Float32Array.from(vbBlossoms.geometry.attributes.color.array),
  blossomInst: Float32Array.from(vbBlossoms.instanceColor.array),
  shrubInst: Float32Array.from(vbShrubs.instanceColor.array),
  cragGeo: Float32Array.from(vbCrags.geometry.attributes.color.array),
  tuftInst: Float32Array.from(vbTufts.instanceColor.array),
  faunaCol: Float32Array.from(vbFauna.geometry.attributes.color.array)
};

function assertAllNonBlack() {
  vb1.group.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.material?.vertexColors) {
      const c = obj.geometry.getAttribute('color');
      for (let i = 0; i < c.array.length; i += 3) {
        const s = c.array[i] + c.array[i + 1] + c.array[i + 2];
        assert.ok(Number.isFinite(s) && s > 0.05, `non-black vertex color on ${obj.name}`);
      }
    }
    if (obj.isInstancedMesh && obj.instanceColor) {
      for (let i = 0; i < obj.count; i++) {
        const s = obj.instanceColor.getX(i) + obj.instanceColor.getY(i) + obj.instanceColor.getZ(i);
        assert.ok(Number.isFinite(s) && s > 0.05, `non-black instance color on ${obj.name}[${i}]`);
      }
    }
  });
}

const skyPhenStub = { timeId: 'day', weatherId: 'clear', rainIntensity: 0, windX: 0.14, windZ: 0.06 };
const phenSys = createPhenologySystem({
  world,
  field,
  riverCurve: curve,
  cliff,
  flora,
  pondLife,
  valleyBorderlands: vb1,
  sky: skyPhenStub
});

// Summer transition
phenSys.setPhenology('summer');
assert.equal(vb1.getStats().phenology, 'summer', 'borderlands switch to summer');
assert.equal(vb1.getStats().frostActive, false, 'no frost in summer');
assertAllNonBlack();
let summerBlossomShifted = false;
for (let i = 0; i < vbBlossoms.geometry.attributes.color.array.length; i += 3) {
  if (Math.abs(vbBlossoms.geometry.attributes.color.array[i] - snapSpring.blossomGeo[i]) > 0.08) {
    summerBlossomShifted = true;
    break;
  }
}
assert.ok(summerBlossomShifted, 'mountain apricot/plum crowns turn lush emerald in summer');

// Autumn daytime transition ('良田金粟')
phenSys.setPhenology('autumn');
assert.equal(vb1.getStats().phenology, 'autumn', 'borderlands switch to autumn');
assert.equal(vb1.getStats().frostActive, false, 'no frost during clear autumn daytime');
assertAllNonBlack();
// Last shrub instances are terraced paddy rice shoots -> golden panicles in autumn (R > G > B)
const lastShrubIdx = (vbShrubs.count - 1) * 3;
const paddyR = vbShrubs.instanceColor.array[lastShrubIdx];
const paddyG = vbShrubs.instanceColor.array[lastShrubIdx + 1];
const paddyB = vbShrubs.instanceColor.array[lastShrubIdx + 2];
assert.ok(snapSpring.shrubInst[lastShrubIdx + 1] > snapSpring.shrubInst[lastShrubIdx], 'spring terrace paddy shoots are green (G > R)');
assert.ok(paddyR > 0.60 && paddyR > paddyG * 1.5 && paddyG > paddyB, `terrace paddy rice ripens to golden-amber panicles in autumn (R=${paddyR.toFixed(3)}, G=${paddyG.toFixed(3)}, B=${paddyB.toFixed(3)})`);

const panicleEntry = vbSolid.userData.colorTags.find((e) => e.tag === 'paddy-panicle');
assert.ok(panicleEntry && panicleEntry.end > panicleEntry.start, 'sculpted paddy rice panicles baked with paddy-panicle tag');
const panColOff = panicleEntry.start * 3;
assert.ok(snapSpring.solid[panColOff + 1] > snapSpring.solid[panColOff], 'spring baked paddy panicles are tender green (G > R)');
assert.ok(
  vbSolid.geometry.attributes.color.array[panColOff] > vbSolid.geometry.attributes.color.array[panColOff + 1] &&
    vbSolid.geometry.attributes.color.array[panColOff + 1] > vbSolid.geometry.attributes.color.array[panColOff + 2],
  'autumn baked paddy panicles ripen to golden-amber ears (R > G > B)'
);

const solidAutumnDay = Float32Array.from(vbSolid.geometry.attributes.color.array);
const pineAutumnDay = Float32Array.from(vbPines.geometry.attributes.color.array);

// Autumn Dawn Hoarfrost ('远树微霜')
skyPhenStub.timeId = 'dawn';
phenSys.update(0.05, 1.0, skyPhenStub);
assert.equal(vb1.getStats().frostActive, true, 'autumn dawn activates morning silver frost rime');
assertAllNonBlack();
let roofFrosted = false;
for (let i = 0; i < vbSolid.geometry.attributes.color.array.length; i += 3) {
  if (vbSolid.geometry.attributes.color.array[i + 2] - solidAutumnDay[i + 2] > 0.08) {
    roofFrosted = true;
    break;
  }
}
let pineFrosted = false;
for (let i = 0; i < vbPines.geometry.attributes.color.array.length; i += 3) {
  if (vbPines.geometry.attributes.color.array[i + 2] - pineAutumnDay[i + 2] > 0.08) {
    pineFrosted = true;
    break;
  }
}
assert.ok(roofFrosted && pineFrosted, 'thatch roofs and cliff pine crowns receive silver frost rime at autumn dawn');

// Dawn -> Day melts frost cleanly while keeping golden autumn harvest
skyPhenStub.timeId = 'day';
vb1.update(0.05, 1.1, skyPhenStub);
assert.equal(vb1.getStats().frostActive, false, 'advancing from dawn to day melts morning frost');
assert.deepEqual(Array.from(vbSolid.geometry.attributes.color.array), Array.from(solidAutumnDay), 'autumn roof colors restored cleanly after frost melts');
assert.deepEqual(Array.from(vbPines.geometry.attributes.color.array), Array.from(pineAutumnDay), 'pine needle colors restored cleanly after frost melts');

// Return to Spring -> 100% exact byte-for-byte Float32Array restoration
phenSys.setPhenology('spring');
assert.equal(vb1.getStats().phenology, 'spring', 'borderlands return to spring');
assert.deepEqual(Array.from(vbWater.geometry.attributes.color.array), Array.from(snapSpring.water), 'exact spring water color restoration');
assert.deepEqual(Array.from(vbSolid.geometry.attributes.color.array), Array.from(snapSpring.solid), 'exact spring solid color restoration');
assert.deepEqual(Array.from(vbGround.geometry.attributes.color.array), Array.from(snapSpring.ground), 'exact spring ground color restoration');
assert.deepEqual(Array.from(vbPines.geometry.attributes.color.array), Array.from(snapSpring.pineGeo), 'exact spring pine color restoration');
assert.deepEqual(Array.from(vbBlossoms.geometry.attributes.color.array), Array.from(snapSpring.blossomGeo), 'exact spring blossom crown restoration');
assert.deepEqual(Array.from(vbBlossoms.instanceColor.array), Array.from(snapSpring.blossomInst), 'exact spring blossom instance color restoration');
assert.deepEqual(Array.from(vbShrubs.instanceColor.array), Array.from(snapSpring.shrubInst), 'exact spring shrub instance color restoration');
assert.deepEqual(Array.from(vbCrags.geometry.attributes.color.array), Array.from(snapSpring.cragGeo), 'exact spring crag color restoration');
assert.deepEqual(Array.from(vbTufts.instanceColor.array), Array.from(snapSpring.tuftInst), 'exact spring meadow tuft color restoration');
assert.deepEqual(Array.from(vbFauna.geometry.attributes.color.array), Array.from(snapSpring.faunaCol), 'exact spring drifting petal color restoration');
phenSys.dispose();

// 9. Spatialized Waterfall, High-Ridge Pine Soughing, Footstep Surfaces, Shelters & Borderland One-Shots
let audioNodesCreated = 0;
let setTargetCalls = 0;
function makeParam(init = 0) {
  return {
    value: init,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
    setTargetAtTime(v) { setTargetCalls++; this.value = v; }
  };
}
function makeNode(extra = {}) {
  audioNodesCreated++;
  return { connect() {}, disconnect() {}, ...extra };
}
class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.sampleRate = 44100;
    this.currentTime = 1.0;
    this.destination = {};
  }
  createGain() { return makeNode({ gain: makeParam(1) }); }
  createOscillator() {
    return makeNode({
      type: 'sine',
      frequency: makeParam(440),
      onended: null,
      start() {},
      stop() { if (this.onended) this.onended(); }
    });
  }
  createBiquadFilter() { return makeNode({ type: 'lowpass', frequency: makeParam(1000), Q: makeParam(1) }); }
  createBufferSource() {
    return makeNode({
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      start() {},
      stop() { if (this.onended) this.onended(); }
    });
  }
  createStereoPanner() { return makeNode({ pan: makeParam(0) }); }
  createDynamicsCompressor() {
    return makeNode({
      threshold: makeParam(-16), knee: makeParam(22), ratio: makeParam(4),
      attack: makeParam(0.005), release: makeParam(0.25)
    });
  }
  createAnalyser() {
    return makeNode({
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0.78,
      getByteTimeDomainData(a) { a.fill(128); },
      getByteFrequencyData(a) { a.fill(0); }
    });
  }
  createConvolver() { return makeNode({ buffer: null }); }
  createBuffer(ch, len, sr) {
    const chs = Array.from({ length: ch }, () => new Float32Array(len));
    return { duration: len / sr, getChannelData: (i) => chs[i] };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

const soundRawSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
assert.ok(!/\bconsole\.log\s*\(/.test(soundRawSrc), 'no console.log in src/systems/sound.js');
const soundModSrc = soundRawSrc
  .replace("import world from '../data/world.json';", `const world = ${JSON.stringify(world)};`)
  .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = { version: 1, clips: [] };')
  .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(soundModSrc).toString('base64'));

const prevWin = globalThis.window;
globalThis.window = { AudioContext: MockAudioContext };
const sound = createSound({
  field,
  distanceToRiver: dist,
  riverSpine: spine,
  cliff,
  village,
  valleyBorderlands: vb1,
  audioCatalogue: { version: 1, clips: [] },
  audioFetch: async () => ({ ok: false })
});
assert.equal(sound.unlock(), true, 'sound graph unlocks cleanly');
sound.setAmbience({ wind: 0.48, rain: 0, night: 0 });

// Footstep material detection on new borderland landmarks & trails
assert.equal(sound.stepSurface(24.5, -224.0), 'stone', 'North bluestone slab bridge produces stone footsteps');
assert.equal(sound.stepSurface(124.5, -170.0), 'stone', 'East Cloud-Viewing Pavilion terrace produces stone footsteps');
assert.equal(sound.stepSurface(108.5, -170.5), 'stone', 'East flagstone mountain trail produces stone footsteps');
assert.equal(sound.stepSurface(32.5, -219.5), 'dirt', 'North foothill trail produces dirt footsteps');

// At Act 1 spawn (15, 178): borderland waterfall & pine beds stay silent
const listenerCam = { position: { x: 15, y: 2, z: 178 }, rotation: { y: 0 } };
for (let i = 0; i < 25; i++) sound.update(0.05, i * 0.05, listenerCam, { x: 15, y: 2, z: 178 }, false);
const act1Audio = sound.getStats();
assert.ok(act1Audio.beds.cascadeGain < 0.001, `cascade silent at Act 1 spawn (${act1Audio.beds.cascadeGain})`);
assert.ok(act1Audio.beds.pineWindGain < 0.001, `pine soughing silent at Act 1 spawn (${act1Audio.beds.pineWindGain})`);

// Near North 3-Tier Waterfall (pool at 26.0, -246.5): strong cascade rush + directional stereo pan
listenerCam.position = { x: 30.5, y: 5, z: -246.5 };
listenerCam.rotation.y = 0; // looking North; waterfall at x=26.0 is to the West (left -> negative pan)
for (let i = 0; i < 65; i++) sound.update(0.05, 2 + i * 0.05, listenerCam, { x: 30.5, y: 5, z: -246.5 }, false);
const cascLeft = sound.getStats();
assert.ok(cascLeft.region.cascade > 0.85, `high cascade region weight near waterfall (${cascLeft.region.cascade})`);
assert.ok(cascLeft.beds.cascadeGain > 0.04, `audible waterfall cascade bed (${cascLeft.beds.cascadeGain})`);
assert.ok(cascLeft.beds.cascadeHighGain > 0.01, `audible waterfall splash shimmer (${cascLeft.beds.cascadeHighGain})`);
assert.ok(cascLeft.beds.cascadePan < -0.15, `waterfall pans left when located west of north-facing listener (${cascLeft.beds.cascadePan})`);

listenerCam.rotation.y = Math.PI; // looking South; waterfall at x=26.0 is now to the right -> positive pan
sound.update(0.05, 5.5, listenerCam, { x: 30.5, y: 5, z: -246.5 }, false);
const cascRight = sound.getStats();
assert.ok(cascRight.beds.cascadePan > 0.15, `waterfall pans right when listener turns 180 deg (${cascRight.beds.cascadePan})`);

// Near East Cloud-Viewing Pavilion & Pine Slope (124.5, -170.0): audible松涛 + pavilion rain shelter muffling
listenerCam.position = { x: 124.5, y: vb1.layout.cloudPavilion.y + 1.2, z: -170.0 };
listenerCam.rotation.y = 1.2;
for (let i = 0; i < 65; i++) sound.update(0.05, 6 + i * 0.05, listenerCam, { x: 124.5, y: listenerCam.position.y, z: -170.0 }, false);
const pineAudio = sound.getStats();
assert.ok(pineAudio.region.pineRidge > 0.75, `high pine-ridge region weight at Cloud-Viewing Pavilion (${pineAudio.region.pineRidge})`);
assert.ok(pineAudio.beds.pineWindGain > 0.01, `audible pine soughing bed on East ridge (${pineAudio.beds.pineWindGain})`);

sound.setAmbience({ rain: 0.75 });
for (let i = 0; i < 20; i++) {
  sound.syncWorld(0.05, {
    rain: 0.75,
    isNight: false,
    shelters: vb1.shelters,
    borderlands: vb1.layout
  });
}
const shelteredPavAudio = sound.getStats();
assert.ok(shelteredPavAudio.completionSync.shelter > 0.85, 'Cloud-Viewing Pavilion roof shelters listener in rain');
assert.ok(shelteredPavAudio.completionSync.eaveDrips >= 1, 'Cloud-Viewing Pavilion roof emits spatial thatch-eave rain drips');

// Spatial borderland one-shots + legacy worldSync key compatibility + suspended/freeze discipline
assert.deepEqual(
  Object.keys(sound.getStats().worldSync),
  ['laundryPounds', 'wheelCreaks', 'gateCreaks', 'roosterCrows', 'gathers'],
  'worldSync enumerable keys strictly preserved'
);
assert.equal(sound.cascadeSplash(18.5, -247.5), true, 'cascadeSplash one-shot plays');
assert.equal(sound.craneCall(24.5, -239.5), true, 'craneCall one-shot plays');
assert.equal(sound.goatBleat(96.0, -150.0), true, 'goatBleat one-shot plays');
assert.equal(sound.teaSimmer(-14.2, -222.2), true, 'teaSimmer one-shot plays');

const csAfter = sound.getStats().completionSync;
assert.ok(csAfter.cascadeSplashes >= 1 && csAfter.craneCalls >= 1 && csAfter.goatBleats >= 1 && csAfter.teaSimmers >= 1, 'borderland spatial one-shot counters increment');
assert.equal(setTargetCalls, 0, 'zero AudioParam.setTargetAtTime calls across all borderland beds & one-shots');

// Suspended AudioContext & dt === 0 must create 0 new audio nodes
sound.context.state = 'suspended';
const nodesBeforeSuspended = audioNodesCreated;
sound.cascadeSplash(18.5, -247.5);
sound.craneCall(24.5, -239.5);
sound.goatBleat(96.0, -150.0);
sound.teaSimmer(-14.2, -222.2);
sound.update(0.05, 8.0, listenerCam, { x: 123.5, y: 15, z: -170.0 }, false);
sound.syncWorld(0.05, { rain: 0.2, events: [{ type: 'craneCall', x: 24, z: -240 }] });
assert.equal(audioNodesCreated, nodesBeforeSuspended, 'zero Web Audio nodes allocated while AudioContext is suspended');

sound.context.state = 'running';
const nodesBeforeFreeze = audioNodesCreated;
sound.update(0, 8.0, listenerCam, { x: 123.5, y: 15, z: -170.0 }, true);
sound.syncWorld(0, { rain: 0.2, events: [{ type: 'goatBleat', x: 96, z: -150 }] });
assert.equal(audioNodesCreated, nodesBeforeFreeze, 'zero Web Audio nodes allocated when dt === 0 / frozen');

sound.disposeSamples();
await sound.context.close();
if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;

vb1.dispose();
console.log(JSON.stringify({
  status: 'passed',
  propMeshes: propMeshCount,
  visibleDaytimeDraws: visibleDraws,
  totalBorderlandTris: Math.round(totalWorldTris),
  phenologyVerified: ['spring', 'summer', 'autumn', 'autumn+dawn-frost'],
  audioVerified: {
    cascadeGainNear: +cascLeft.beds.cascadeGain.toFixed(4),
    pineWindGainNear: +pineAudio.beds.pineWindGain.toFixed(4),
    pavilionShelter: shelteredPavAudio.completionSync.shelter,
    setTargetCalls
  },
  counts: {
    terraces: stats.terraces,
    pines: stats.pines,
    blossoms: stats.blossomTrees,
    bamboo: stats.bambooClusters,
    shrubs: stats.shrubs,
    crags: stats.crags,
    meadowTufts: stats.meadowTufts,
    driftingLeaves: stats.driftingLeaves,
    blockers: stats.blockers,
    restSeats: stats.restSeats,
    shelters: stats.shelters,
    villagers: stats.villagers
  },
  viewports: { vpAct1, vpVillage, vpEastAerial, vpNorthAerial, vpNorthWalk }
}));
