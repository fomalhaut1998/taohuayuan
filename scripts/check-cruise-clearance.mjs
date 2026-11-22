// 回归检验：「入画巡游」（L 键）常规与冬寂两条路线三维碰撞净空、#cruise-banner 同期标牌、
// 防穿模烘焙抬升兜底以及 #gloom 高空越岭抑制契约。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { createRiverCurve, sampleRiverSpine, createStream } from '../src/world/stream.js';
import { createRiverDistance, createHeightFunction } from '../src/world/terrain.js';
import { Heightfield } from '../src/player/collision.js';
import { createCliff } from '../src/world/cliff.js';
import { createCavePassage } from '../src/world/cave-passage.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createFlora } from '../src/world/flora.js';
import { createHinterland } from '../src/world/hinterland.js';
import { createHinterlandFoliage } from '../src/world/hinterland-foliage.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createBoats } from '../src/world/boats.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createHospitalityFeast } from '../src/world/hospitality-feast.js';
import { createQinHanHomestead } from '../src/world/qin-han-homestead.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createValleyBorderlands } from '../src/world/valley-borderlands.js';
import { createOuterWilds } from '../src/world/outer-wilds.js';
import { createDeepHollows } from '../src/world/deep-hollows.js';
import { createWulingOutskirts } from '../src/world/wuling-outskirts.js';
import { createTravelerGuideAndCruise } from '../src/systems/traveler-guide-cruise.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

const prevDoc = globalThis.document;
const prevWin = globalThis.window;

function makeMockCtx2d() {
  return new Proxy(
    {
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      font: '12px serif',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      measureText: s => ({ width: String(s || '').length * 12 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h })
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
      }
    }
  );
}

function makeMockDomEnv() {
  const makeClassList = () => {
    const set = new Set();
    return {
      add: (...xs) => xs.forEach(x => set.add(x)),
      remove: (...xs) => xs.forEach(x => set.delete(x)),
      contains: x => set.has(x),
      toggle: (x, f) => {
        const next = f === undefined ? !set.has(x) : Boolean(f);
        if (next) set.add(x);
        else set.delete(x);
        return next;
      }
    };
  };

  const els = new Map();
  const makeNode = (tag, id = '') => {
    const listeners = new Map();
    const node = {
      tagName: String(tag || 'div').toUpperCase(),
      id,
      className: '',
      classList: makeClassList(),
      style: { cssText: '', setProperty() {} },
      textContent: '',
      innerHTML: '',
      value: '',
      title: '',
      hidden: false,
      open: false,
      width: 256,
      height: 256,
      dataset: {},
      children: [],
      attributes: new Map(),
      parentNode: null,
      getContext: () => makeMockCtx2d(),
      appendChild(c) {
        c.parentNode = this;
        this.children.push(c);
        if (c.id) els.set(c.id, c);
        return c;
      },
      remove() {
        if (this.id && els.get(this.id) === this) els.delete(this.id);
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter(c => c !== this);
          this.parentNode = null;
        }
      },
      setAttribute(k, v) { this.attributes.set(k, String(v)); },
      getAttribute(k) { return this.attributes.get(k) ?? null; },
      addEventListener(k, fn) {
        if (!listeners.has(k)) listeners.set(k, new Set());
        listeners.get(k).add(fn);
      },
      removeEventListener(k, fn) { listeners.get(k)?.delete(fn); },
      querySelector(sel) {
        if (typeof sel === 'string' && sel.startsWith('#')) return els.get(sel.slice(1)) || null;
        return null;
      },
      showModal() { this.open = true; },
      close() { this.open = false; },
      focus() {}
    };
    return node;
  };

  const head = makeNode('head');
  const body = makeNode('body');
  const doc = {
    head,
    body,
    activeElement: null,
    pointerLockElement: null,
    createElement(tag) { return makeNode(tag); },
    getElementById(id) { return els.get(id) || null; },
    exitPointerLock() { this.pointerLockElement = null; }
  };
  const winListeners = new Map();
  const win = {
    addEventListener(k, fn) {
      if (!winListeners.has(k)) winListeners.set(k, new Set());
      winListeners.get(k).add(fn);
    },
    removeEventListener(k, fn) { winListeners.get(k)?.delete(fn); }
  };
  return { doc, win };
}

const env = makeMockDomEnv();
globalThis.document = env.doc;
globalThis.window = env.win;

try {
  const curve = createRiverCurve(world.stream.points);
  const spine = sampleRiverSpine(curve, 160);
  const distRiver = createRiverDistance(spine);
  const hFn = createHeightFunction(world.terrain, distRiver);
  const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
  grid.rotateX(-Math.PI / 2);
  const heights = new Float32Array(grid.attributes.position.count);
  for (let i = 0; i < heights.length; i++) heights[i] = hFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
  const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
  field.colorAt = () => new THREE.Color('#6b7f58');

  const cliff = createCliff(world.cliff, field);
  const stream = createStream(world.stream, world.terrain, curve);
  const basin = world.terrain.basin;
  function segDist(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
    return Math.hypot(ax + dx * t - px, az + dz * t - pz);
  }
  const floraField = {
    half: field.half,
    sample: (x, z) => field.sample(x, z),
    slope: (x, z) => ((x - basin.x) ** 2 + (z - basin.z) ** 2 < (basin.inner * 1.05) ** 2 ? 9 : field.slope(x, z))
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

  const flora = createFlora(world.flora, floraField, distRiver, stream.curve, world.player.spawn, nearTree);
  const village = createVillage(structuredClone(world.village), field, world.terrain.pond);
  const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
  const hinterland = createHinterland(world.hinterland, field, distRiver, world, village, props, cliff);
  const hinterlandFoliage = createHinterlandFoliage(hinterland, field, world.hinterland.palette);
  hinterland.group.add(hinterlandFoliage.group);
  const boats = createBoats(world.boats, stream, world.terrain, curve, field);
  const exterior = createExteriorExploration(world, field, distRiver, curve, flora, boats, cliff);
  const cavePassage = createCavePassage({ world, cliff, field });

  const baseOpts = {
    world, field, distanceToRiver: distRiver, riverCurve: curve, stream, flora, village, props, hinterland,
    villageScenes: { blockers: [] }, villageLife: { blockers: [] }, mysteryWorld: { blockers: [] },
    boats, cliff, exterior, habitatDetails: { blockers: [] }
  };
  const pondLife = createPondLife({ ...baseOpts, reservations: [] });
  const waterworks = createWaterworks({ ...baseOpts, reservations: [pondLife] });
  const leisureGrove = createLeisureGrove({ ...baseOpts, reservations: [pondLife, waterworks] });
  const feast = createHospitalityFeast({ ...baseOpts, reservations: [pondLife, waterworks, leisureGrove], targetBlockers: leisureGrove.blockers });
  const homestead = createQinHanHomestead({ ...baseOpts, pondLife, leisureGrove, reservations: [pondLife, waterworks, leisureGrove, feast] });
  const completion = createQinHanCompletion({ world, field, village, props, leisureGrove, qinHanHomestead: homestead, blockers: [] });
  const borderlands = createValleyBorderlands({ ...baseOpts, pondLife, waterworks, leisureGrove, hospitalityFeast: feast, qinHanHomestead: homestead, qinHanCompletion: completion, easterEggs: { blockers: [] }, reservations: [pondLife, waterworks, leisureGrove, feast, homestead] });
  const outerWilds = createOuterWilds({ ...baseOpts, pondLife, waterworks, leisureGrove, hospitalityFeast: feast, qinHanHomestead: homestead, qinHanCompletion: completion, valleyBorderlands: borderlands, qianmoPaths: { layout: {} }, reservations: [pondLife, waterworks, leisureGrove, feast, homestead, borderlands] });
  const deepHollows = createDeepHollows({ ...baseOpts, valleyBorderlands: borderlands, outerWilds, reservations: [pondLife, waterworks, leisureGrove, feast, homestead, borderlands, outerWilds] });
  const wulingOutskirts = createWulingOutskirts({
    ...baseOpts, leisureGrove, hospitalityFeast: feast, qinHanHomestead: homestead, qinHanCompletion: completion,
    qianmoPaths: { layout: {} }, outerWilds, act3Finale: { layout: {} },
    reservations: [pondLife, waterworks, leisureGrove, feast, homestead, borderlands, outerWilds, deepHollows]
  });

  // 空间网格索引所有待检实体的三角面几何（按单实例提取矩阵，支持精确射线与三维包围检测）
  const CELL = 20;
  const checkGroups = [
    ['cliff', cliff.group, true],
    ['cavePassage', cavePassage.group, true],
    ['village', village.group, false],
    ['flora', flora.group, false],
    ['wulingOutskirts', wulingOutskirts.group, false],
    ['hinterland', hinterland.group, false],
    ['exterior', exterior.group, false]
  ];
  const gridItems = new Map();
  const solidRockItems = [];
  const _m = new THREE.Matrix4();
  const _b = new THREE.Box3();
  const probeMesh = new THREE.Mesh();
  probeMesh.matrixAutoUpdate = false;
  const doubleMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

  for (const [gName, grp, isSolidRock] of checkGroups) {
    if (!grp) continue;
    grp.updateMatrixWorld(true);
    grp.traverse(obj => {
      if (!obj.isMesh || !obj.visible || !obj.geometry) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (mat && mat.transparent && mat.depthWrite === false) return;
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      const gBox = obj.geometry.boundingBox;
      if (!gBox || gBox.isEmpty()) return;
      const label = `${gName}:${obj.name || 'unnamed'}`;
      const pushBox = (box, mat4) => {
        if (box.isEmpty() || box.max.y - box.min.y < 1.0) return;
        const item = {
          minX: box.min.x, maxX: box.max.x,
          minY: box.min.y, maxY: box.max.y,
          minZ: box.min.z, maxZ: box.max.z,
          label, geo: obj.geometry, mat4, isSolidRock
        };
        if (isSolidRock) solidRockItems.push(item);
        const x0 = Math.floor(item.minX / CELL), x1 = Math.floor(item.maxX / CELL);
        const z0 = Math.floor(item.minZ / CELL), z1 = Math.floor(item.maxZ / CELL);
        for (let gx = x0; gx <= x1; gx++) {
          for (let gz = z0; gz <= z1; gz++) {
            const k = `${gx},${gz}`;
            let arr = gridItems.get(k);
            if (!arr) { arr = []; gridItems.set(k, arr); }
            arr.push(item);
          }
        }
      };
      if (obj.isInstancedMesh) {
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, _m);
          const wm = new THREE.Matrix4().multiplyMatrices(obj.matrixWorld, _m);
          _b.copy(gBox).applyMatrix4(wm);
          pushBox(_b, wm);
        }
      } else {
        const wm = obj.matrixWorld.clone();
        _b.copy(gBox).applyMatrix4(wm);
        pushBox(_b, wm);
      }
    });
  }

  const ray = new THREE.Raycaster();
  const downDir = new THREE.Vector3(0, -1, 0);
  const footOffsets = [[0, 0], [2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]];
  const proxDirs = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2),
    new THREE.Vector3(-Math.SQRT1_2, 0, Math.SQRT1_2),
    new THREE.Vector3(Math.SQRT1_2, 0, -Math.SQRT1_2),
    new THREE.Vector3(-Math.SQRT1_2, 0, -Math.SQRT1_2)
  ];

  function checkPoseClearance(p) {
    const pad = 2.4;
    const x0 = Math.floor((p.x - pad) / CELL), x1 = Math.floor((p.x + pad) / CELL);
    const z0 = Math.floor((p.z - pad) / CELL), z1 = Math.floor((p.z + pad) / CELL);
    const cands = new Set();
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const arr = gridItems.get(`${gx},${gz}`);
        if (!arr) continue;
        for (const it of arr) {
          if (p.x + pad >= it.minX && p.x - pad <= it.maxX && p.z + pad >= it.minZ && p.z - pad <= it.maxZ && p.y - pad <= it.maxY) {
            cands.add(it);
          }
        }
      }
    }

    let topY = field.sample(p.x, p.z);
    let topLabel = 'terrain';
    let min3DDist = Infinity;
    let nearestLabel = '';
    let insideRock = false;

    for (const it of cands) {
      probeMesh.geometry = it.geo;
      probeMesh.material = doubleMat;
      probeMesh.matrixWorld.copy(it.mat4);

      for (const [ox, oz] of footOffsets) {
        const rx = p.x + ox;
        const rz = p.z + oz;
        if (rx < it.minX || rx > it.maxX || rz < it.minZ || rz > it.maxZ) continue;
        ray.set(new THREE.Vector3(rx, 200, rz), downDir);
        ray.far = 400;
        const hits = ray.intersectObject(probeMesh, false);
        if (hits.length > 0 && hits[0].point.y > topY) {
          topY = hits[0].point.y;
          topLabel = it.label;
        }
      }

      if (it.isSolidRock && p.y + pad >= it.minY && p.y - pad <= it.maxY) {
        for (const d of proxDirs) {
          ray.set(p, d);
          ray.far = pad;
          const hits = ray.intersectObject(probeMesh, false);
          if (hits.length > 0 && hits[0].distance < min3DDist) {
            min3DDist = hits[0].distance;
            nearestLabel = it.label;
          }
        }
        ray.set(p, proxDirs[2]); // up
        ray.far = 150;
        const upHits = ray.intersectObject(probeMesh, false);
        if (upHits.length % 2 === 1) {
          insideRock = true;
          nearestLabel = it.label;
        }
      }
    }

    return { topY, topLabel, min3DDist, nearestLabel, insideRock };
  }

  let currentSeason = 'spring';
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.2, 500);
  const guide = createTravelerGuideAndCruise({
    camera: cam,
    player: { clearInput() {}, syncCamera() {} },
    canvas: env.doc.createElement('canvas'),
    field,
    map: { isOpen: () => false },
    journal: { isOpen: () => false },
    getScrollStudio: () => ({ isOpen: () => false }),
    getGodFlight: () => ({ active: false }),
    getPhenology: () => ({ getStats: () => ({ phenologyId: currentSeason }) }),
    clearanceRoots: [cliff.group, cavePassage.group],
    doc: env.doc,
    win: env.win
  });

  for (const season of ['spring', 'winter']) {
    currentSeason = season;
    guide.stopCruise();
    assert.equal(guide.startCruise(), true, `${season}: cruise starts cleanly`);
    const bannerEl = env.doc.getElementById('cruise-banner');
    let sawCrossingBanner = false;
    let prevZ = cam.position.z;

    const STEPS = 960;
    for (let step = 0; step < STEPS; step++) {
      if (step > 0) guide.update(0.1);
      const gy = field.sample(cam.position.x, cam.position.z);
      assert.ok(
        cam.position.y >= gy + 2.39,
        `${season} step=${step}: terrain clearance failed (y=${cam.position.y.toFixed(2)} < gy+2.39=${(gy + 2.39).toFixed(2)})`
      );

      const res = checkPoseClearance(cam.position);
      assert.equal(
        res.insideRock,
        false,
        `${season} step=${step}: camera inside solid rock ${res.nearestLabel} at (${cam.position.x.toFixed(1)}, ${cam.position.y.toFixed(1)}, ${cam.position.z.toFixed(1)})`
      );
      assert.ok(
        res.min3DDist >= 2.2,
        `${season} step=${step}: camera within 2.2m of cliff/cave ${res.nearestLabel} (d3d=${res.min3DDist.toFixed(2)})`
      );
      assert.ok(
        cam.position.y - res.topY >= 2.2,
        `${season} step=${step}: clearance above ${res.topLabel} too low (y=${cam.position.y.toFixed(2)}, topY=${res.topY.toFixed(2)})`
      );

      if (step < STEPS / 2 && prevZ > cliff.slit.z && cam.position.z <= cliff.slit.z) {
        assert.ok(
          bannerEl?.textContent?.includes('山有小口'),
          `${season}: outbound cliff crossing banner should include '山有小口' (got '${bannerEl?.textContent}')`
        );
        sawCrossingBanner = true;
      }
      prevZ = cam.position.z;
    }
    assert.equal(sawCrossingBanner, true, `${season}: verified outbound cliff crossing banner synchronization`);
  }

  guide.dispose();
  doubleMat.dispose();

  // 合成兜底校验：在巡游样条正前方放置 42m 高巨石盒子，验证懒烘焙净空抬升表自动平滑抬越
  const synthEnv = makeMockDomEnv();
  globalThis.document = synthEnv.doc;
  globalThis.window = synthEnv.win;
  const synthCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.2, 500);
  const synthRoot = new THREE.Group();
  const tallBoxGeo = new THREE.BoxGeometry(16, 42, 16);
  const tallBoxMat = new THREE.MeshBasicMaterial();
  const tallBox = new THREE.Mesh(tallBoxGeo, tallBoxMat);
  // 放置在标准巡游 u ≈ 0.08 处（pos ≈ [-3.9, 7.8, 100.1]）正中阻断样条
  tallBox.position.set(-3.9, 21, 100.1);
  synthRoot.add(tallBox);

  const synthGuide = createTravelerGuideAndCruise({
    camera: synthCam,
    player: { clearInput() {}, syncCamera() {} },
    canvas: synthEnv.doc.createElement('canvas'),
    field: { sample: () => 2 },
    getPhenology: () => ({ getStats: () => ({ phenologyId: 'spring' }) }),
    clearanceRoots: [synthRoot],
    doc: synthEnv.doc,
    win: synthEnv.win
  });

  assert.equal(synthGuide.startCruise(), true, 'synthetic obstacle cruise starts');
  let maxLiftY = -Infinity;
  let maxDeltaY = 0;
  let prevY = synthCam.position.y;
  for (let s = 1; s <= 240; s++) {
    synthGuide.update(0.1);
    const dy = Math.abs(synthCam.position.y - prevY);
    if (dy > maxDeltaY) maxDeltaY = dy;
    prevY = synthCam.position.y;
    if (Math.abs(synthCam.position.x - (-3.9)) < 6 && Math.abs(synthCam.position.z - 100.1) < 6) {
      if (synthCam.position.y > maxLiftY) maxLiftY = synthCam.position.y;
      assert.ok(
        synthCam.position.y >= 44.5,
        `synthetic clearance lift must clear 42m obstacle (y=${synthCam.position.y.toFixed(2)})`
      );
    }
  }
  assert.ok(maxLiftY >= 44.5, `synthetic test traversed 42m box smoothly (maxLiftY=${maxLiftY.toFixed(2)})`);
  assert.ok(maxDeltaY < 2.0, `synthetic clearance ramp is smooth (maxDeltaY=${maxDeltaY.toFixed(2)}m per 0.1s)`);

  synthGuide.dispose();
  tallBoxGeo.dispose();
  tallBoxMat.dispose();

  // main.js 接线与 #gloom 抑制契约
  assert.ok(mainSrc.includes('clearanceRoots: [cliff.group, cavePassage.group]'), 'main.js wires clearanceRoots into createTravelerGuideAndCruise');
  assert.ok(mainSrc.includes('!travelerGuide?.cruiseActive') && mainSrc.includes('inCaveGloom'), 'main.js suppresses #gloom darkening during cruise / high flight over cliff');

  console.log('PASS check-cruise-clearance: standard & winter 96s full-loop 3D clearance, banner sync, synthetic 42m lift & main.js contracts verified');
} finally {
  globalThis.document = prevDoc;
  globalThis.window = prevWin;
}
