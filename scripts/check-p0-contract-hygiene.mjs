import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { chainProgramCacheKey } from '../src/systems/shader-cache-key.js';
import { installSkyAppearance } from '../src/systems/scene-appearance.js';
import { createArchitecturalCraft } from '../src/systems/architectural-craft.js';
import { createMountains } from '../src/world/terrain.js';
import { createInkAtmosphere } from '../src/systems/ink-atmosphere.js';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { attachGroundSurface } from '../src/world/ground-surface.js';

function walkJs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const prevDoc = globalThis.document;
const mockCtx2d = new Proxy(
  {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h })
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    }
  }
);
globalThis.document = {
  createElement: () => ({ width: 64, height: 64, getContext: () => mockCtx2d }),
  getElementById: () => null
};

let checks = 0;
const check = (cond, msg) => {
  assert(cond, msg);
  checks++;
};

try {
  // --------------------------------------------------------------------------
  // 1. chainProgramCacheKey unit contract
  // --------------------------------------------------------------------------
  {
    const mat1 = new THREE.MeshLambertMaterial();
    const restoreFoo = chainProgramCacheKey(mat1, 'foo-v1');
    check(mat1.customProgramCacheKey() === 'foo-v1', 'first chained tag returns exact tag');

    const restoreBar = chainProgramCacheKey(mat1, 'bar-v2');
    check(mat1.customProgramCacheKey() === 'foo-v1|bar-v2', 'second chained tag appends with pipe');

    restoreBar();
    check(mat1.customProgramCacheKey() === 'foo-v1', 'restoring second tag leaves first intact');

    restoreFoo();
    check(
      mat1.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey,
      'restoring first tag reverts to Material prototype default'
    );

    const mat2 = new THREE.MeshLambertMaterial();
    const restoreSky = installSkyAppearance(mat2, { value: 0 });
    const restoreCustom = chainProgramCacheKey(mat2, 'foo-v1');
    const composed = mat2.customProgramCacheKey();
    check(
      composed.includes('sky-albedo-v1') && composed.endsWith('|foo-v1'),
      `chaining after installSkyAppearance preserves both keys (${composed})`
    );
    restoreCustom();
    check(
      mat2.customProgramCacheKey().includes('sky-albedo-v1') && !mat2.customProgramCacheKey().includes('foo-v1'),
      'restoring chained tag preserves prior sky appearance key'
    );
    restoreSky?.();
    mat1.dispose();
    mat2.dispose();
  }

  // --------------------------------------------------------------------------
  // 2. Whole-src static hygiene contracts
  // --------------------------------------------------------------------------
  {
    const srcRoot = path.resolve('src');
    const jsFiles = walkJs(srcRoot);
    const directOverwriteRe = /customProgramCacheKey\s*=\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*\{\s*return)\s*['"`]/;
    for (const file of jsFiles) {
      const text = readFileSync(file, 'utf8');
      check(
        !directOverwriteRe.test(text),
        `no direct customProgramCacheKey overwrite in ${path.relative(process.cwd(), file)}`
      );
    }
    const helperSrc = readFileSync(path.join(srcRoot, 'systems', 'shader-cache-key.js'), 'utf8');
    check(!helperSrc.includes('console.log('), 'zero console.log in shader-cache-key.js');
  }

  // --------------------------------------------------------------------------
  // 3a. architectural-craft.js: zero getStats() in update + winter phenology
  // --------------------------------------------------------------------------
  {
    let getStatsCalls = 0;
    let curId = 'spring';
    const phenologyMock = {
      get currentId() {
        return curId;
      },
      getStats() {
        getStatsCalls++;
        return { phenologyId: curId };
      }
    };
    const skyMock = {
      timeId: 'night',
      weatherId: 'clear',
      rainIntensity: 0,
      snowIntensity: 0,
      windX: 0.2,
      windZ: 0.1
    };
    const craft = createArchitecturalCraft({
      world: {
        terrain: { waterLevel: -1, basin: { x: 30, z: -140, inner: 96 }, pond: { x: 68, z: -152, radius: 13, waterRadius: 9.2, waterY: 0.85 } }
      },
      field: { sample: () => 2.0 },
      village: { houseInfo: [{ x: 30, z: -130, gy: 2.0, w: 6, d: 5, h: 3.0, rot: 0 }] },
      sky: skyMock,
      phenology: phenologyMock
    });

    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);
    cam.position.set(30, 3.6, -126);

    for (const season of ['spring', 'summer', 'autumn']) {
      curId = season;
      for (let step = 0; step < 5; step++) craft.update(0.35, step * 0.35, skyMock, phenologyMock, cam);
      check(craft.getStats().phenologyId === season, `craft recognizes ${season} without getStats`);
    }
    curId = 'spring';
    for (let step = 0; step < 6; step++) craft.update(0.35, 3 + step * 0.35, skyMock, phenologyMock, cam);
    check(craft.getStats().mothsVisible === true, 'spring clear night shows lantern moths');

    curId = 'winter';
    for (let step = 0; step < 6; step++) craft.update(0.35, 6 + step * 0.35, skyMock, phenologyMock, cam);
    check(craft.getStats().phenologyId === 'winter', 'craft resolves winter phenology without getStats');
    check(craft.getStats().mothsVisible === false, 'winter night suppresses lantern moths');
    check(getStatsCalls === 0, `phenology.getStats() never called during update (got ${getStatsCalls})`);
    craft.dispose();
  }

  // --------------------------------------------------------------------------
  // 3b. terrain.js + ink-landscape.js: zero getStats() / getAppearance() hotpath
  // --------------------------------------------------------------------------
  {
    const world = JSON.parse(readFileSync('src/data/world.json', 'utf8'));
    const mountains = createMountains(world.mountains);
    const origGetStats = mountains.getStats;
    let mtnGetStatsCalls = 0;
    mountains.getStats = function () {
      mtnGetStatsCalls++;
      return origGetStats.apply(this, arguments);
    };

    const fogColor = new THREE.Color('#d2b48c');
    const skyTop = new THREE.Color('#88aabb');
    const skyBottom = new THREE.Color('#cde0e5');
    let skyGetAppCalls = 0;
    const skyMock = {
      timeId: 'day',
      weatherId: 'clear',
      rainIntensity: 0,
      snowIntensity: 0,
      wind: 0.6,
      getAppearanceState() {
        return { timeId: 'day', weatherId: 'clear', night: 0, desaturation: 0, unlitScale: 1, skyTop, skyBottom, fogColor };
      },
      getAppearance() {
        skyGetAppCalls++;
        return { timeId: 'day', weatherId: 'clear', fogColor: fogColor.getHexString() };
      },
      getTwilightState() {
        return { dawn: 0, dusk: 0 };
      },
      setMaterialBaseColor() {
        return false;
      }
    };
    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 800);
    for (let i = 0; i < 10; i++) mountains.update(0.016, skyMock, cam);

    check(skyGetAppCalls === 0, `createMountainHaze uses getAppearanceState instead of getAppearance (got ${skyGetAppCalls})`);
    check(mtnGetStatsCalls === 0, `mountains.update never calls getStats (got ${mtnGetStatsCalls})`);
    const st = origGetStats();
    check(st.fogColor === '#' + fogColor.getHexString(), `haze copied live fogColor accurately (${st.fogColor})`);

    mountains.dispose();
    const callsBeforeDisposeUpdate = skyGetAppCalls;
    mountains.update(0.016, skyMock, cam);
    check(skyGetAppCalls === callsBeforeDisposeUpdate, 'disposed mountains.update is a no-op');
  }

  // --------------------------------------------------------------------------
  // 3c. ink-atmosphere.js: zero getAppearance() allocation on transitions
  // --------------------------------------------------------------------------
  {
    const fogColor = new THREE.Color('#bad8e7');
    const skyBottom = new THREE.Color('#b6d9f0');
    const skyTop = new THREE.Color('#7ca3c4');
    let getAppearanceCalls = 0;
    const skyMock = {
      timeId: 'day',
      weatherId: 'clear',
      rainIntensity: 0,
      snowIntensity: 0,
      windX: 0.2,
      windZ: 0.1,
      getAppearanceState() {
        return {
          timeId: this.timeId,
          weatherId: this.weatherId,
          night: this.timeId === 'night' ? 1 : 0,
          desaturation: 0,
          unlitScale: 1,
          skyTop,
          skyBottom,
          fogColor
        };
      },
      getAppearance() {
        getAppearanceCalls++;
        return { timeId: this.timeId, weatherId: this.weatherId, fogColor: fogColor.getHexString(), skyBottom: skyBottom.getHexString() };
      }
    };
    const inkAtmos = createInkAtmosphere({
      field: { sample: () => 2.0 },
      sky: skyMock
    });
    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 600);
    const pState = { x: 26, y: 2, z: 120, vx: 0, vz: 0, yaw: 0 };
    inkAtmos.update(0.016, 0.016, skyMock, pState, cam);
    skyMock.timeId = 'dusk';
    inkAtmos.update(0.016, 0.032, skyMock, pState, cam);
    inkAtmos.update(0.016, 0.048, skyMock, pState, cam);
    check(getAppearanceCalls === 0, `ink-atmosphere uses getAppearanceState during transition (got ${getAppearanceCalls})`);
    inkAtmos.dispose();
  }

  // --------------------------------------------------------------------------
  // 4. static-visibility.js eligibility for outer-wilds-exterior-static & wuling foliage
  // --------------------------------------------------------------------------
  {
    const scene = new THREE.Scene();
    const wulingGrp = new THREE.Group();
    wulingGrp.name = 'wuling-outskirts';
    scene.add(wulingGrp);

    const makeTriGeo = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -5, 1, 0, -5, 0, 1, -5], 3));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return g;
    };
    const mat = new THREE.MeshLambertMaterial({ color: 0x7ba05b });

    const owExt = new THREE.Mesh(makeTriGeo(), mat);
    owExt.name = 'outer-wilds-exterior-static';
    scene.add(owExt);

    const wuExtFol = new THREE.Mesh(makeTriGeo(), mat);
    wuExtFol.name = 'wuling-outskirts-ext-foliage';
    wulingGrp.add(wuExtFol);

    const wuIntFol = new THREE.Mesh(makeTriGeo(), mat);
    wuIntFol.name = 'wuling-outskirts-int-foliage';
    wulingGrp.add(wuIntFol);

    const egretInst = new THREE.InstancedMesh(makeTriGeo(), mat, 2);
    egretInst.name = 'wuling-outskirts-egret-body';
    wulingGrp.add(egretInst);

    const vis = optimizeStaticVisibility(scene);
    const managedSources = vis.entries.map(e => e.source);
    check(managedSources.includes(owExt), 'outer-wilds-exterior-static opted into static-visibility');
    check(managedSources.includes(wuExtFol), 'wuling-outskirts-ext-foliage opted into static-visibility');
    check(managedSources.includes(wuIntFol), 'wuling-outskirts-int-foliage opted into static-visibility');
    check(!managedSources.includes(egretInst), 'dynamic wuling-outskirts-egret-body stays excluded');
    vis.dispose();
    owExt.geometry.dispose();
    wuExtFol.geometry.dispose();
    wuIntFol.geometry.dispose();
    egretInst.geometry.dispose();
    mat.dispose();
  }

  // --------------------------------------------------------------------------
  // 5. main.js & ground-surface.js wiring contracts
  // --------------------------------------------------------------------------
  {
    const mainSrc = readFileSync('src/main.js', 'utf8');
    const createWulingIdx = mainSrc.indexOf('const wulingOutskirts = createWulingOutskirts(');
    const groundRegIdx = mainSrc.indexOf('groundSurface.register(');
    check(createWulingIdx >= 0 && groundRegIdx > createWulingIdx, 'groundSurface.register called after createWulingOutskirts');
    const groundRegCall = mainSrc.slice(groundRegIdx, mainSrc.indexOf(');', groundRegIdx));
    check(groundRegCall.includes('wulingOutskirts'), 'groundSurface.register includes wulingOutskirts');

    const pvIdx = mainSrc.indexOf('portalVisibility = createPortalVisibility(');
    const pvExtIdx = mainSrc.indexOf('exteriorGroups:', pvIdx);
    const pvExtEnd = mainSrc.indexOf('],', pvExtIdx);
    const pvExtSlice = mainSrc.slice(pvIdx >= 0 ? pvExtIdx : 0, pvExtEnd >= 0 ? pvExtEnd : 0);
    check(pvIdx >= 0 && pvExtSlice.includes('fish.group'), 'portalVisibility exteriorGroups includes fish.group');

    const gfIdx = mainSrc.indexOf('godFlight = createGodFlight(');
    const gfSlice = mainSrc.slice(gfIdx, mainSrc.indexOf('});', gfIdx));
    check(
      gfSlice.includes('exteriorGroups: portalVisibility.exteriorGroups') &&
      gfSlice.includes('interiorGroups: portalVisibility.interiorGroups'),
      'godFlight shares portalVisibility interior/exterior groups (including fish.group)'
    );

    const unlockLine = mainSrc.split('\n').find(l => l.includes('sound.unlock(); return;')) || '';
    for (const k of ['KeyK', 'KeyO', 'KeyP', 'KeyB', 'KeyQ', 'KeyL', 'KeyX', 'KeyN', 'Slash']) {
      check(unlockLine.includes(k), `keyboard sound.unlock() includes ${k}`);
    }

    const keyFIdx = mainSrc.indexOf("e.code !== 'KeyF'");
    const keyFSlice = mainSrc.slice(keyFIdx, keyFIdx + 240);
    const modalStateSrc = readFileSync('src/systems/modal-state.js', 'utf8');
    check(
      keyFIdx >= 0 &&
      keyFSlice.includes('isModalBusy(document') &&
      keyFSlice.includes('discovery') &&
      modalStateSrc.includes("'field-guide-open'"),
      'KeyF handler delegates to unified isModalBusy with discovery/field-guide-open guard'
    );

    const gs = attachGroundSurface({ sample: () => 1.0 }, {});
    gs.register({
      wulingOutskirts: {
        layout: {
          trails: [{ width: 2.0, kind: 'flagstone', points: [[10, 10], [20, 10]] }]
        }
      }
    });
    check(gs.surfaceMaterial(15, 10) === 'stone', 'groundSurface samples wulingOutskirts trail material');
    check(gs.walkSurface(15, 10) > 1.0, 'groundSurface elevates wulingOutskirts trail height');
  }

  console.log(`PASS check-p0-contract-hygiene (${checks} checks)`);
} finally {
  globalThis.document = prevDoc;
}
