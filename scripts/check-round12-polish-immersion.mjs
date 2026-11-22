// Round 12 专项综合验收：
// 1) 冬韵与山水骨相（冬池枯荷残蓬、边地/外山冬花脱粉、耕牛冬歇屋檐归位、冬田稻茬、宋元远山主客峰黛眉横岚、夜灯地面暖光池+绕灯微蛾、月相盈亏+淡墨银汉+月色碎银）
// 2) 灵魂五秒与大音希声（豁然开朗 FOV 呼吸感+五声泛音、留白式古琴/箫/远磬稀疏乐音、画卷工坊自题短跋+朱/白文私印与存档前向兼容）
// 3) 出圈与契约卫生（全局统一 dt=0 冻结门、主循环零 getStats() 热路径、桃源小笺 ? 与入画巡游 L、触屏漫游控制、index.html/vite.config 规范）

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';

import { createHeightFunction, createRiverDistance, createMountains } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine, createStream } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createQinHanCompletion } from '../src/world/qin-han-village-completion.js';
import { createOxPlowing } from '../src/world/ox-plowing.js';
import { createValleyBorderlands } from '../src/world/valley-borderlands.js';
import { createOuterWilds } from '../src/world/outer-wilds.js';
import { createCaveGleam } from '../src/world/cave-gleam.js';
import { createPhenologySystem } from '../src/systems/phenology-mist.js';
import { createSeasonalCycle } from '../src/systems/seasonal-cycle.js';
import { createArchitecturalCraft } from '../src/systems/architectural-craft.js';
import { createSky } from '../src/systems/sky.js';
import { createWorldClock } from '../src/systems/world-clock.js';
import { createWaterSurface } from '../src/systems/twilight-water.js';
import { createScrollStudio } from '../src/systems/scroll-studio.js';
import { createTravelerGuideAndCruise } from '../src/systems/traveler-guide-cruise.js';
import { createTouchControls } from '../src/player/touch-controls.js';
import { optimizeStaticVisibility } from '../src/world/static-visibility.js';
import { createFarBambooGeometry, createFarPineGeometry, createFarHillBambooGeometry, syncLodVertexColors } from '../src/world/lod-geometries.js';

const worldText = readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8');
const world = JSON.parse(worldText);
const catalogueText = readFileSync(new URL('../src/data/audio-samples.json', import.meta.url), 'utf8');

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
      measureText: (s) => ({ width: (String(s || '').length) * 12 }),
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
      add: (...xs) => xs.forEach((x) => set.add(x)),
      remove: (...xs) => xs.forEach((x) => set.delete(x)),
      contains: (x) => set.has(x),
      toggle: (x, f) => {
        const next = f === undefined ? !set.has(x) : Boolean(f);
        if (next) set.add(x);
        else set.delete(x);
        return next;
      }
    };
  };

  const makeNode = (tag, id = '') => {
    const node = {
      tagName: tag.toUpperCase(),
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
      width: 320,
      height: 200,
      dataset: {},
      children: [],
      attributes: new Map(),
      listeners: new Map(),
      parentNode: null,
      appendChild(c) {
        c.parentNode = this;
        this.children.push(c);
        return c;
      },
      remove() {
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
          this.parentNode = null;
        }
      },
      setAttribute(k, v) { this.attributes.set(k, String(v)); },
      getAttribute(k) { return this.attributes.get(k) ?? null; },
      addEventListener(k, fn) {
        if (!this.listeners.has(k)) this.listeners.set(k, new Set());
        this.listeners.get(k).add(fn);
      },
      removeEventListener(k, fn) { this.listeners.get(k)?.delete(fn); },
      dispatch(type, ev = {}) {
        for (const fn of [...(this.listeners.get(type) || [])]) fn(ev);
      },
      focus() {},
      blur() {},
      getBoundingClientRect() { return { left: 20, top: 200, width: 112, height: 112 }; },
      querySelector(sel) {
        if (sel.startsWith('#')) return findById(this, sel.slice(1));
        return null;
      },
      querySelectorAll() { return []; },
      getContext() { return makeMockCtx2d(); },
      toDataURL() { return 'data:image/png;base64,iVBORw0KGgo='; }
    };
    if (tag.toLowerCase() === 'dialog') {
      node.showModal = () => { node.open = true; };
      node.close = () => {
        if (!node.open) return;
        node.open = false;
        node.dispatch('close', { target: node });
      };
    }
    return node;
  };

  function findById(root, id) {
    if (!root) return null;
    if (root.id === id) return root;
    for (const c of root.children || []) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return null;
  }

  const head = makeNode('head');
  const body = makeNode('body');
  body.classList.add('curtain-open');
  body.appendChild(makeNode('dialog', 'journal'));
  const storageMap = new Map();
  const winListeners = new Map();

  const doc = {
    head,
    body,
    hidden: false,
    pointerLockElement: null,
    activeElement: body,
    exitPointerLock() { doc.pointerLockElement = null; },
    createElement(tag) {
      const el = makeNode(tag);
      // Lightweight innerHTML parser for dialogs with known button/input ids
      Object.defineProperty(el, 'innerHTML', {
        get() { return el._html || ''; },
        set(val) {
          el._html = String(val || '');
          el.children.length = 0;
          const idMatches = el._html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g);
          for (const m of idMatches) {
            const child = makeNode(m[1], m[2]);
            el.appendChild(child);
          }
        }
      });
      return el;
    },
    getElementById(id) {
      return findById(head, id) || findById(body, id);
    }
  };

  const dispatchedWinEvents = [];
  const win = {
    location: { search: '' },
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    navigator: { maxTouchPoints: 0 },
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => { storageMap.set(k, String(v)); },
      removeItem: (k) => { storageMap.delete(k); }
    },
    addEventListener(k, fn) {
      if (!winListeners.has(k)) winListeners.set(k, new Set());
      winListeners.get(k).add(fn);
    },
    removeEventListener(k, fn) { winListeners.get(k)?.delete(fn); },
    dispatchEvent(ev) {
      dispatchedWinEvents.push(ev);
      const t = ev?.type || 'keydown';
      for (const fn of [...(winListeners.get(t) || [])]) fn(ev);
      return true;
    },
    fireKey(code, extra = {}) {
      let prevented = false;
      const ev = {
        type: 'keydown',
        code,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        target: body,
        preventDefault() { prevented = true; },
        stopImmediatePropagation() {},
        ...extra
      };
      for (const fn of [...(winListeners.get('keydown') || [])]) fn(ev);
      return prevented;
    }
  };

  return { doc, win, head, body, storageMap, dispatchedWinEvents, makeNode };
}

try {
  // =========================================================================
  // 0. Source Hygiene, Unified Freeze Gate & Build Metadata Contracts
  // =========================================================================
  const auditedSrc = [
    'src/systems/phenology-mist.js',
    'src/world/outer-wilds.js',
    'src/world/valley-borderlands.js',
    'src/world/ox-plowing.js',
    'src/systems/seasonal-cycle.js',
    'src/world/terrain.js',
    'src/world/ink-landscape.js',
    'src/systems/architectural-craft.js',
    'src/systems/sky.js',
    'src/systems/world-clock.js',
    'src/systems/twilight-water.js',
    'src/world/cave-gleam.js',
    'src/systems/sound.js',
    'src/systems/scroll-studio.js',
    'src/systems/traveler-guide-cruise.js',
    'src/player/touch-controls.js',
    'src/player/controller.js',
    'src/world/lod-geometries.js',
    'src/world/static-visibility.js'
  ];
  for (const rel of auditedSrc) {
    const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
    assert.equal(/\bconsole\.log\s*\(/.test(src), false, `zero console.log in ${rel}`);
  }

  const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const loopStart = mainSrc.indexOf('renderer.setAnimationLoop(');
  const loopEnd = mainSrc.indexOf('window.__APP__ = {');
  assert.ok(loopStart > 0 && loopEnd > loopStart, 'located renderer.setAnimationLoop');
  const loopSrc = mainSrc.slice(loopStart, loopEnd);
  assert.ok(loopSrc.includes('scrollStudio?.isOpen?.()'), 'unified freeze gate checks scrollStudio.isOpen()');
  assert.ok(loopSrc.includes('travelerGuide?.isGuideOpen?.()'), 'unified freeze gate checks travelerGuide.isGuideOpen()');
  assert.equal(/\.getStats\s*\(/.test(loopSrc), false, 'animation loop hot path contains zero .getStats() calls');
  assert.ok(loopSrc.includes('phenology.currentId') && loopSrc.includes('waterworks.wheelPhase'), 'hot path uses zero-alloc scalar getters');
  assert.ok(loopSrc.includes('caveGleam.getEmergenceEffect'), 'main.js wires cave emergence FOV bloom');
  assert.ok(loopSrc.includes('sound.setLostMood'), 'main.js syncs Act 3 lost mood to sparse poetic music');

  const htmlSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(
    htmlSrc.includes('rel="icon"') && htmlSrc.includes('type="image/svg+xml"') && htmlSrc.includes('favicon.svg'),
    'index.html links SVG illustration favicon'
  );
  assert.ok(
    htmlSrc.includes('rel="apple-touch-icon"') && htmlSrc.includes('apple-touch-icon.png'),
    'index.html links 180x180 apple-touch-icon'
  );
  const faviconSvg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  assert.ok(
    /<(?:linear|radial)Gradient\b/.test(faviconSvg),
    'public/favicon.svg uses rich multi-stop illustration gradients'
  );
  assert.equal(/<text\b/i.test(faviconSvg), false, 'public/favicon.svg contains zero <text> elements');
  assert.ok(
    statSync(new URL('../public/apple-touch-icon.png', import.meta.url)).size > 0,
    'public/apple-touch-icon.png exists and is non-empty'
  );
  assert.ok(htmlSrc.includes('property="og:title"') && htmlSrc.includes('name="theme-color"'), 'index.html includes OG & theme-color metadata');
  for (const keyHint of ['O 丹青', 'N 雅音', 'P 御风', 'L 入画', '? 小笺']) {
    assert.ok(htmlSrc.includes(keyHint), `index.html #hint lists ${keyHint}`);
  }

  // Round 13 polish & perf contracts
  const cssSrc = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.ok(cssSrc.includes('right: clamp(218px,'), '.subtitle clears right-hand #sky and #minimap lane');
  assert.ok(
    cssSrc.includes('body.scroll-studio-open #subtitle') &&
    cssSrc.includes('body.traveler-guide-open #subtitle') &&
    cssSrc.includes('body.cruise-active #subtitle'),
    '.subtitle hides cleanly during scroll-studio, traveler-guide and cruise'
  );
  const waterSrc = readFileSync(new URL('../src/systems/twilight-water.js', import.meta.url), 'utf8');
  assert.equal(waterSrc.includes('sin(vTwilightWaterPosition.z * 1.7'), false, 'water normal replaces axis-aligned sine checkerboard with multi-angle organic ripples');
  assert.ok(mainSrc.includes("extraRoots: ['reeds-group', 'qin-han-completion']"), 'main.js opts qin-han-completion crops into staticVisibility compaction');
  const portalVisSrc = readFileSync(new URL('../src/bootstrap/portal-visibility.js', import.meta.url), 'utf8');
  const pvBlock = mainSrc.slice(mainSrc.indexOf('portalVisibility = createPortalVisibility('), mainSrc.indexOf('godFlight = createGodFlight('));
  assert.ok(
    pvBlock.includes('fish.group') && loopSrc.includes('portalVisibility?.update(') && portalVisSrc.includes('extList[i].visible = !hideInterior;'),
    'main.js portal-culls outer-stream fish inside deep interior via portalVisibility'
  );
  assert.ok(mainSrc.includes("n === 'qin-han-millet-crops'") && mainSrc.includes("n === 'mulberry-leaves'"), 'main.js applies sub-pixel distance caps to crops & mulberry leaves');

  // =========================================================================
  // 1. Round 1: Winter Consistency, Mountains & Night Magic
  // =========================================================================
  const env = makeMockDomEnv();
  globalThis.document = env.doc;
  globalThis.window = env.win;

  const curve = createRiverCurve(world.stream.points);
  const spine = sampleRiverSpine(curve, 160);
  const distRiver = createRiverDistance(spine);
  const hFn = createHeightFunction(world.terrain, distRiver);
  const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
  grid.rotateX(-Math.PI / 2);
  const heights = new Float32Array(grid.attributes.position.count);
  for (let i = 0; i < heights.length; i++) heights[i] = hFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i));
  const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);

  const cliff = createCliff(world.cliff, field);
  const village = createVillage(structuredClone(world.village), field, world.terrain.pond);
  const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
  const stream = createStream(world.stream, world.terrain, curve);

  const baseOpts = {
    world, field, distanceToRiver: distRiver, riverCurve: curve, stream,
    flora: { spots: [] }, village, props, hinterland: { blockers: [], trees: [], bamboo: [] },
    villageScenes: { blockers: [] }, villageLife: { blockers: [] }, mysteryWorld: { blockers: [] },
    boats: { list: [] }, cliff, exterior: { blockers: [] }, habitatDetails: { blockers: [] }
  };
  const pondLife = createPondLife({ ...baseOpts, reservations: [] });
  const qinHanCompletion = createQinHanCompletion({
    world, field, village, props, leisureGrove: { blockers: [], targets: [] },
    qinHanHomestead: { layout: {} }, blockers: []
  });
  const oxPlowing = createOxPlowing({ world, field, homestead: { layout: {} } });
  const valleyBorderlands = createValleyBorderlands({ ...baseOpts, pondLife, reservations: [pondLife] });
  const outerWilds = createOuterWilds({ ...baseOpts, pondLife, valleyBorderlands, reservations: [pondLife, valleyBorderlands] });

  const skyScene = new THREE.Scene();
  skyScene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 600);
  const sky = createSky(world.sky, skyScene, { getPixelRatio: () => 1 }, cam, {});

  const seasonalCycle = createSeasonalCycle({
    world, field, village, props,
    leisureGrove: { layout: { regions: [] } },
    qinHanCompletion, oxPlowing,
    player: { state: { x: 40, y: 2, z: -100 } },
    sky
  });
  const phenology = createPhenologySystem({
    world, field, riverCurve: curve, cliff, village, pondLife,
    qinHanCompletion, valleyBorderlands, outerWilds, oxPlowing, seasonalCycle,
    sky, doc: env.doc, win: env.win
  });

  // 1a) Winter withered lotus (`枯荷残蓬`) + lossless spring restore
  const pondSurf = pondLife.group.getObjectByName('pond-life-surface');
  assert.ok(pondSurf, 'pond-life-surface mesh exists');
  const springPondBytes = Buffer.from(pondSurf.geometry.attributes.color.array.buffer.slice(0));
  const cropMesh = qinHanCompletion.group.getObjectByName('qin-han-millet-crops');
  assert.ok(cropMesh, 'qin-han-millet-crops exists');
  const springCropBytes = Buffer.from(cropMesh.instanceMatrix.array.buffer.slice(0));

  const owBlossom = outerWilds.group.getObjectByName('outer-wilds-blossoms');
  const springOwBlossom = owBlossom?.instanceColor ? Buffer.from(owBlossom.instanceColor.array.buffer.slice(0)) : null;

  phenology.setPhenology('winter', { silent: true });
  assert.equal(phenology.currentId, 'winter', 'phenology.currentId tracks active season');
  const pCol = pondSurf.geometry.attributes.color.array;
  let pinkWinterVerts = 0;
  for (let i = 0; i < pCol.length; i += 3) {
    if (pCol[i] - pCol[i + 1] > 0.12 && pCol[i] > 0.55) pinkWinterVerts++;
  }
  assert.equal(pinkWinterVerts, 0, `winter pond lotus has 0 bright-pink petals (got ${pinkWinterVerts})`);

  // 1b) Winter outerWilds & valleyBorderlands blossoms lose pink/coral
  if (owBlossom?.instanceColor) {
    const arr = owBlossom.instanceColor.array;
    let pinkInst = 0;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i] - arr[i + 2] > 0.16 && arr[i] - arr[i + 1] > 0.12) pinkInst++;
    }
    assert.equal(pinkInst, 0, `outer-wilds winter blossoms have 0 pink/coral instances (got ${pinkInst})`);
  }

  // 1c) Winter frozen paddy low stubble
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  let maxWinterCropSy = 0;
  for (let i = 0; i < Math.min(cropMesh.count, 120); i++) {
    cropMesh.getMatrixAt(i, _m);
    _m.decompose(_p, _q, _s);
    if (_s.x > 1e-4) maxWinterCropSy = Math.max(maxWinterCropSy, _s.y);
  }
  assert.ok(maxWinterCropSy > 0.05 && maxWinterCropSy < 0.40, `winter crop stubble scaled low (maxSy=${maxWinterCropSy.toFixed(3)})`);

  // 1d) Winter ox-plowing shelter alignment
  const winterSky = { timeId: 'day', sunElevation: 0.7, rainIntensity: 0, snowIntensity: 0.4, wind: 0.1 };
  for (let i = 0; i < 600; i++) oxPlowing.update(1 / 60, i / 60, winterSky, null);
  const oxStats = oxPlowing.getStats();
  assert.equal(oxStats.mode, 'rest', 'oxPlowing enters rest mode in winter');
  const oxActors = oxPlowing.getInteractables();
  assert.equal(oxActors.length, 2, 'ox and plowman present during winter rest');
  const oxFarmerDist = Math.hypot(oxActors[0].x - oxActors[1].x, oxActors[0].z - oxActors[1].z);
  assert.ok(oxFarmerDist < 2.2, `winter resting farmer steps beside ox under shelter (dist=${oxFarmerDist.toFixed(2)}m)`);

  // 1e) Spring byte-lossless restore
  phenology.setPhenology('spring', { silent: true });
  assert.equal(phenology.currentId, 'spring');
  assert.equal(Buffer.compare(Buffer.from(pondSurf.geometry.attributes.color.array.buffer), springPondBytes), 0, 'spring restores pond lotus bytes losslessly');
  assert.equal(Buffer.compare(Buffer.from(cropMesh.instanceMatrix.array.buffer), springCropBytes), 0, 'spring restores millet crop matrices losslessly');
  if (owBlossom?.instanceColor && springOwBlossom) {
    assert.equal(Buffer.compare(Buffer.from(owBlossom.instanceColor.array.buffer), springOwBlossom), 0, 'spring restores outerWilds blossom colors losslessly');
  }

  // 1f) Song-Yuan distant mountain silhouette & ridge brow
  const mountains = createMountains(world.mountains);
  let maxMtnY = 0;
  let mtnTierCount = 0;
  mountains.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    mtnTierCount++;
    const pos = obj.geometry.attributes.position;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > hi) hi = y;
      if (y < lo) lo = y;
    }
    maxMtnY = Math.max(maxMtnY, hi);
    assert.ok(hi - lo > 12, `mountain tier ${mtnTierCount} has prominent Song-Yuan peak-to-saddle relief (${(hi - lo).toFixed(1)}m)`);
  });
  assert.equal(mtnTierCount, 3, 'distant mountains preserve 3 silhouette tiers');
  assert.ok(maxMtnY <= 63.3, `mountain peaks respect silhouette ceiling (maxY=${maxMtnY.toFixed(2)}m)`);

  // 1g) Night magic: warm ground pools, lantern moths, lunar phases, Milky Way, moonlit water sheen
  const archCraft = createArchitecturalCraft({
    world, field, village, cliff, pondLife,
    leisureGrove: { layout: { regions: [] } },
    qinHanHomestead: { layout: {} },
    qinHanCompletion: { layout: {} },
    hospitalityFeast: { layout: {} },
    neighborTheaters: {},
    communityLife: {},
    people: { list: [] },
    avatar: { group: new THREE.Group() },
    boats: { list: [] },
    sky,
    phenology
  });
  const archBase = archCraft.getStats();
  assert.ok(archBase.warmPoolCount > 0, `architectural-craft builds warm amber ground light pools (${archBase.warmPoolCount})`);
  assert.equal(archBase.mothCount, 28, 'architectural-craft builds 28 lantern moths');

  // Clear summer night -> moths visible; daytime -> hidden; winter -> hidden; dt=0 -> frozen
  phenology.setPhenology('summer', { silent: true });
  const warmNightSky = { timeId: 'night', weatherId: 'clear', rainIntensity: 0, snowIntensity: 0, wind: 0.1 };
  for (let i = 0; i < 40; i++) archCraft.update(0.05, i * 0.05, warmNightSky, phenology, cam);
  assert.equal(archCraft.getStats().mothsVisible, true, 'lantern moths appear on warm clear summer night');
  const mothObj = archCraft.interiorGroup.getObjectByName('lantern-moths');
  const mothTimeBefore = mothObj.material.uniforms.uSimTime.value;
  archCraft.update(0, 999, warmNightSky, phenology, cam);
  assert.equal(mothObj.material.uniforms.uSimTime.value, mothTimeBefore, 'lantern moths freeze strictly on dt=0');

  const clearDaySky = { timeId: 'day', weatherId: 'clear', rainIntensity: 0, snowIntensity: 0, wind: 0.1 };
  for (let i = 0; i < 40; i++) archCraft.update(0.05, 5 + i * 0.05, clearDaySky, phenology, cam);
  assert.equal(archCraft.getStats().mothsVisible, false, 'lantern moths stay hidden in daytime');

  // Sky 7 lunar phases + Milky Way uStarOp
  const seenPhases = new Set();
  const seenFullness = new Set();
  for (let d = 1; d <= 7; d++) {
    sky.setLunarDay(d);
    const ls = sky.getLunarState();
    seenPhases.add(ls.name);
    seenFullness.add(Number(ls.fullness.toFixed(2)));
  }
  assert.equal(seenPhases.size, 7, 'sky cycles through all 7 distinct lunar phases');
  assert.ok(seenFullness.size >= 4, 'lunar phases vary moon fullness across cycle');
  sky.setLunarDay(1); // restore full moon

  // Twilight water moonlit sheen (inkSurface path)
  const waterSurf = createWaterSurface(stream.mesh, sky, { field, kind: 'stream' });
  sky.setTime('day');
  sky.setWeather('clear');
  for (let i = 0; i < 40; i++) { sky.update(0.2, cam); waterSurf.update(0.2); }
  assert.equal(waterSurf.getStats().inkMoonSheen, 0, 'moonlit water sheen is 0 during daytime');
  sky.setTime('night');
  for (let i = 0; i < 50; i++) { sky.update(0.2, cam); waterSurf.update(0.2); }
  const clearNightSheen = waterSurf.getStats().inkMoonSheen;
  assert.ok(clearNightSheen > 0.35, `moonlit water sheen illuminates stream on clear full-moon night (${clearNightSheen})`);
  sky.setWeather('rain');
  for (let i = 0; i < 50; i++) { sky.update(0.2, cam); waterSurf.update(0.2); }
  assert.ok(waterSurf.getStats().inkMoonSheen < clearNightSheen, 'rain softens moonlit water sheen');

  // =========================================================================
  // 2. Round 2: Cave Emergence Bloom, Sparse Generative Audio, Custom Scroll
  // =========================================================================
  // 2a) Cave emergence FOV breath bloom
  const gleam = createCaveGleam({ world, cliff, field, emergenceAlong: -23.0, outerMouthAlong: 15.5 });
  const slit = cliff.slit;
  const outX = Math.cos(slit.angle), outZ = Math.sin(slit.angle);
  let bloomTriggered = 0;
  // Approach from outer cave mouth (+14) then emerge past -23 (-26)
  gleam.update(0.05, 0.05, new THREE.Vector3(slit.x + outX * 14, 4, slit.z + outZ * 14), clearDaySky, () => { bloomTriggered++; });
  gleam.update(0.05, 0.10, new THREE.Vector3(slit.x - outX * 26, 4, slit.z - outZ * 26), clearDaySky, () => { bloomTriggered++; });
  assert.equal(bloomTriggered, 1, 'valley emergence callback fires once');
  let peakFovDelta = 0;
  for (let i = 0; i < 40; i++) {
    gleam.update(0.05, 0.15 + i * 0.05, new THREE.Vector3(slit.x - outX * 28, 4, slit.z - outZ * 28), clearDaySky, () => { bloomTriggered++; });
    peakFovDelta = Math.max(peakFovDelta, gleam.getEmergenceEffect().fovDelta);
  }
  assert.ok(peakFovDelta > 2.2 && peakFovDelta <= 2.65, `emergence FOV breath peaks gently around +2.6 deg (got ${peakFovDelta.toFixed(2)})`);
  const fovBeforeFreeze = gleam.getEmergenceEffect().fovDelta;
  gleam.update(0, 99, new THREE.Vector3(slit.x - outX * 28, 4, slit.z - outZ * 28), clearDaySky);
  assert.equal(gleam.getEmergenceEffect().fovDelta, fovBeforeFreeze, 'emergence FOV breath freezes on dt=0');
  for (let i = 0; i < 60; i++) gleam.update(0.05, 3 + i * 0.05, new THREE.Vector3(slit.x - outX * 28, 4, slit.z - outZ * 28), clearDaySky);
  assert.equal(gleam.getEmergenceEffect().active, false, 'emergence FOV breath settles cleanly back to 0');
  gleam.reset();
  gleam.dispose();

  // 2b) Sparse generative poetic music & valley emergence chord (sound.js)
  {
    const soundSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
    const worldUrl = 'data:text/javascript;base64,' + Buffer.from('export default ' + worldText + ';').toString('base64');
    const catUrl = 'data:text/javascript;base64,' + Buffer.from('export default ' + catalogueText + ';').toString('base64');
    const sampleUrl = new URL('../src/systems/sample-audio.js', import.meta.url).href;
    const patched = soundSrc
      .replace("'../data/world.json'", JSON.stringify(worldUrl))
      .replace("'../data/audio-samples.json'", JSON.stringify(catUrl))
      .replace("'./sample-audio.js'", JSON.stringify(sampleUrl));
    const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'));

    let createdNodes = 0;
    const makeParam = (v = 0) => ({
      value: v,
      setValueAtTime(x) { this.value = x; },
      linearRampToValueAtTime(x) { this.value = x; },
      exponentialRampToValueAtTime(x) { this.value = x; },
      setTargetAtTime(x) { this.value = x; },
      cancelScheduledValues() {}
    });
    const makeNode = () => {
      createdNodes++;
      return {
        gain: makeParam(1), frequency: makeParam(440), Q: makeParam(1), pan: makeParam(0), playbackRate: makeParam(1),
        connect(n) { return n; }, disconnect() {}, start() {}, stop() {}
      };
    };
    class AudioCtxMock {
      constructor() { this.state = 'running'; this.sampleRate = 44100; this.currentTime = 1.0; this.destination = makeNode(); }
      resume() { this.state = 'running'; return Promise.resolve(); }
      createGain() { return makeNode(); }
      createBiquadFilter() { return makeNode(); }
      createStereoPanner() { return makeNode(); }
      createConvolver() { return makeNode(); }
      createOscillator() { return Object.assign(makeNode(), { type: 'sine' }); }
      createBufferSource() { return Object.assign(makeNode(), { buffer: null, loop: false }); }
      createDynamicsCompressor() {
        return Object.assign(makeNode(), { threshold: makeParam(), knee: makeParam(), ratio: makeParam(), attack: makeParam(), release: makeParam() });
      }
      createAnalyser() { return Object.assign(makeNode(), { fftSize: 256, frequencyBinCount: 128, getByteTimeDomainData(a) { a.fill(128); } }); }
      createBuffer(ch, len, sr) { return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: () => new Float32Array(len) }; }
    }
    const prevAC = globalThis.AudioContext;
    const savedWin = globalThis.window;
    globalThis.window = { ...env.win, AudioContext: AudioCtxMock };
    globalThis.AudioContext = AudioCtxMock;
    try {
      const snd = createSound({ village, cliff, field, riverSpine: spine, distanceToRiver: distRiver });
      assert.equal(snd.unlock(), true);
      snd.update(0.05, 1.0, cam, { x: 40, y: 2, z: -120, yaw: 0 }, false);
      const beforeEmerg = createdNodes;
      assert.equal(snd.playValleyEmergence(), true, 'playValleyEmergence synthesizes pentatonic chord + chime');
      assert.ok(createdNodes > beforeEmerg + 6, 'playValleyEmergence creates harmonic & chime oscillators');

      assert.equal(snd.triggerPoeticPhrase('guqin'), true, 'guqin harmonic phrase plays');
      assert.equal(snd.triggerPoeticPhrase('xiao'), true, 'xiao breathy phrase plays');
      assert.equal(snd.triggerPoeticPhrase('qing'), true, 'distant qing chime plays');
      snd.setLostMood(true);
      const st = snd.getStats().poeticMusic;
      assert.equal(st.valleyEmergences, 1);
      assert.equal(st.phrases, 3);
      assert.equal(st.lostMood, true);

      const frozenBefore = createdNodes;
      for (let i = 0; i < 60; i++) snd.update(0, 2 + i * 0.05, cam, { x: 40, y: 2, z: -120, yaw: 0 }, true);
      assert.equal(createdNodes, frozenBefore, 'frozen sound.update creates 0 poetic music nodes');
      snd.disposeSamples();
    } finally {
      globalThis.window = savedWin;
      globalThis.AudioContext = prevAC;
    }
  }

  // 2c) Scroll Studio custom inscription + 朱/白文 seal + storage forward-compat + input key guard
  {
    const journalSeed = JSON.stringify({ version: 1, visited: ['武陵溪'] });
    env.win.localStorage.setItem('taohua.journal.v1', journalSeed);
    const mockCanvas = env.doc.createElement('canvas');
    mockCanvas.width = 640;
    mockCanvas.height = 360;
    const studio = createScrollStudio({
      canvas: mockCanvas,
      player: { state: { x: 40, y: 2, z: -120, yaw: 0, pitch: 0 }, clearInput() {} },
      camera: cam,
      field,
      journal: { isOpen: () => false },
      map: { isOpen: () => false, getRegionName: () => '桃源村' },
      sky,
      getPhenology: () => phenology,
      world,
      doc: env.doc,
      win: env.win,
      storage: env.win.localStorage
    });
    studio.openCapture();
    assert.equal(studio.isOpen(), true, 'scrollStudio opens cleanly');

    // Typing 'o' inside an <input> must NOT close scrollStudio!
    const fakeInput = env.doc.createElement('input');
    env.win.fireKey('KeyO', { target: fakeInput });
    assert.equal(studio.isOpen(), true, 'KeyO inside <input> does not close scrollStudio');

    studio.setCustomInscription({ verse: '松风清响，客舍长明', seal: '清风印', sealStyle: 'baiwen' });
    const ins = studio.getCustomInscription();
    assert.equal(ins.verse, '松风清响，客舍长明');
    assert.equal(ins.seal, '清风印');
    assert.equal(ins.sealStyle, 'baiwen');
    const url = studio.captureScrollDataUrl();
    assert.ok(url && url.startsWith('data:image/'), 'scroll renders cleanly with custom inscription & baiwen seal');

    // Save into scroll box & verify taohua.scrolls.v1 persistence and taohua.journal.v1 untouched
    const saveBtn = env.doc.getElementById('scroll-save-box');
    saveBtn.dispatch('click', {});
    const savedRaw = JSON.parse(env.win.localStorage.getItem('taohua.scrolls.v1'));
    const saved = Array.isArray(savedRaw) ? savedRaw : savedRaw?.items;
    assert.ok(Array.isArray(saved) && saved.length === 1, 'scroll saved into taohua.scrolls.v1');
    assert.equal(saved[0].verse, '松风清响，客舍长明');
    assert.equal(saved[0].seal, '清风印');
    assert.equal(saved[0].sealStyle, 'baiwen');
    assert.equal(env.win.localStorage.getItem('taohua.journal.v1'), journalSeed, 'taohua.journal.v1 remains untouched');

    studio.close();
    studio.dispose();
  }

  // =========================================================================
  // 3. Round 3: Traveler Guide (?) & Cruise (L) + Touch Controls
  // =========================================================================
  {
    let syncCalls = 0;
    const mockPlayer = {
      state: { x: 26, y: 2, z: 180, yaw: 0, pitch: 0 },
      clearInput() {},
      syncCamera() { syncCalls++; }
    };
    const guide = createTravelerGuideAndCruise({
      camera: cam,
      player: mockPlayer,
      canvas: env.doc.createElement('canvas'),
      field,
      map: { isOpen: () => false },
      journal: { isOpen: () => false },
      getScrollStudio: () => ({ isOpen: () => false }),
      getGodFlight: () => ({ active: false }),
      doc: env.doc,
      win: env.win
    });

    // '?' opens guide, Escape closes it
    env.win.fireKey('Slash');
    assert.equal(guide.isGuideOpen(), true, 'Slash (?) opens 桃源小笺');
    env.win.fireKey('Escape');
    assert.equal(guide.isGuideOpen(), false, 'Escape closes 桃源小笺');

    // 'L' starts 入画巡游, advances spline, respects terrain clearance, freezes on dt=0, exits on KeyW
    env.win.fireKey('KeyL');
    assert.equal(guide.cruiseActive, true, 'KeyL enters 入画巡游');
    const pos0 = cam.position.clone();
    guide.update(0);
    assert.equal(cam.position.distanceTo(pos0), 0, 'cruise freezes strictly on dt=0');
    for (let i = 0; i < 40; i++) {
      guide.update(0.1);
      const gy = field.sample(cam.position.x, cam.position.z);
      assert.ok(cam.position.y >= gy + 2.39, 'cruise camera maintains safe clearance above terrain');
    }
    assert.ok(cam.position.distanceTo(pos0) > 2.0, 'cruise moves camera smoothly along scenic spline');
    env.win.fireKey('KeyW');
    assert.equal(guide.cruiseActive, false, 'KeyW exits cruise back to walking');
    assert.ok(syncCalls >= 1, 'exiting cruise restores player camera');
    // Manual cycleTime past midnight (night -> dawn) advances worldClock dayCount & lunar phase, and night tooltip lists 月相
    const skyBox = env.makeNode('div', 'sky');
    const skyTimeRow = env.makeNode('div', 'sky-time-row');
    const skyTimeEl = env.makeNode('span', 'sky-time');
    skyTimeRow.appendChild(skyTimeEl);
    skyBox.appendChild(skyTimeRow);
    env.body.appendChild(skyBox);
    sky.setTime('night');
    const wc = createWorldClock({ sky, smoke: {}, getPhenology: () => phenology, doc: env.doc, win: env.win });
    assert.ok(skyTimeRow.title.includes('月相：望月'), `night #sky-time-row tooltip shows lunar phase (got ${skyTimeRow.title})`);
    assert.equal(wc.getState().dayCount, 1);
    sky.cycleTime(1); // night -> dawn crosses midnight -> dayCount 2 (亏凸月)
    assert.equal(wc.getState().dayCount, 2, 'cycling night->dawn via T advances dayCount');
    assert.equal(sky.getLunarState().name, '亏凸月', 'lunar phase advances naturally with dayCount');
    wc.dispose();
    skyBox.remove();

    guide.dispose();
    assert.equal(env.doc.getElementById('guide-open'), null, 'travelerGuide dispose removes #guide-open');
  }

  {
    // Desktop non-touch -> disabled cleanly
    const desktopTouch = createTouchControls({
      canvas: env.doc.createElement('canvas'),
      player: { setTouchMove() {}, addTouchLook() {} },
      doc: env.doc,
      win: env.win
    });
    assert.equal(desktopTouch.enabled, false, 'touchControls stays inactive on non-touch desktop');
    desktopTouch.dispose();

    // Coarse-pointer / forceEnable -> stick, look drag, corner action pill, clean dispose
    const moveCalls = [];
    const lookCalls = [];
    const touchPlayer = {
      setTouchMove(x, z) { moveCalls.push([x, z]); },
      addTouchLook(dx, dy) { lookCalls.push([dx, dy]); }
    };
    let soundUnlocked = 0;
    const mockCanvas = env.doc.createElement('canvas');
    const tc = createTouchControls({
      canvas: mockCanvas,
      player: touchPlayer,
      sound: { unlock() { soundUnlocked++; } },
      doc: env.doc,
      win: env.win,
      forceEnable: true
    });
    assert.equal(tc.enabled, true, 'touchControls activates on touch environment');
    const stick = env.doc.getElementById('touch-stick');
    assert.ok(stick, 'mounts #touch-stick');
    // Push thumb upward & slightly right from center (76, 256)
    stick.dispatch('touchstart', { changedTouches: [{ identifier: 1, clientX: 76, clientY: 256 }], preventDefault() {} });
    stick.dispatch('touchmove', { changedTouches: [{ identifier: 1, clientX: 96, clientY: 226 }], preventDefault() {} });
    const lastMove = moveCalls.at(-1);
    assert.ok(lastMove && lastMove[0] > 0.3 && lastMove[1] > 0.4, `stick push up-right yields +x, +z (${JSON.stringify(lastMove)})`);
    stick.dispatch('touchend', { changedTouches: [{ identifier: 1, clientX: 96, clientY: 226 }], preventDefault() {} });
    assert.deepEqual(moveCalls.at(-1), [0, 0], 'releasing stick zeroes movement');

    // Canvas single-finger look drag
    mockCanvas.dispatch('touchstart', { changedTouches: [{ identifier: 2, clientX: 400, clientY: 300 }] });
    mockCanvas.dispatch('touchmove', { changedTouches: [{ identifier: 2, clientX: 424, clientY: 290 }], preventDefault() {} });
    mockCanvas.dispatch('touchend', { changedTouches: [{ identifier: 2, clientX: 424, clientY: 290 }] });
    assert.deepEqual(lookCalls.at(-1), [24, -10], 'canvas touch drag forwards dx/dy to player.addTouchLook');

    // Corner action pill dispatches KeyE
    const beforeEv = env.dispatchedWinEvents.length;
    env.doc.getElementById('touch-act-e').dispatch('click', { preventDefault() {}, stopPropagation() {} });
    assert.equal(env.dispatchedWinEvents.length, beforeEv + 1);
    assert.equal(env.dispatchedWinEvents.at(-1).code, 'KeyE', 'touch 观 pill dispatches KeyE');
    assert.ok(soundUnlocked >= 2, 'touch interactions unlock audio');

    tc.dispose();
    assert.equal(env.doc.getElementById('touch-controls'), null, 'touchControls dispose removes DOM');
    assert.equal(env.body.classList.contains('touch-active'), false, 'touchControls dispose clears body.touch-active');
  }

  // =========================================================================
  // 4. Round 14: Two-Tier Bamboo/Pine Distance LOD & Cruise Scroll Region Sync
  // =========================================================================
  {
    const lodScene = new THREE.Scene();
    const bamSrc = village.group.getObjectByName('bamboo');
    assert.ok(bamSrc && bamSrc.isInstancedMesh, 'village bamboo mesh exists');
    const srcTris = bamSrc.geometry.attributes.position.count / 3;
    const farBamGeo = createFarBambooGeometry(bamSrc);
    const farPineGeo = createFarPineGeometry();
    const farHillBamGeo = createFarHillBambooGeometry();
    const farBamTris = farBamGeo.attributes.position.count / 3;
    assert.ok(farBamTris < srcTris * 0.20, `far bamboo LOD cuts per-clump triangles >80% (${srcTris} -> ${farBamTris})`);
    assert.ok(farPineGeo.attributes.position.count / 3 <= 60, 'far pine LOD <= 60 tris');
    assert.ok(farHillBamGeo.attributes.position.count / 3 <= 76, 'far hillside bamboo LOD <= 76 tris');
    farPineGeo.dispose();
    farHillBamGeo.dispose();

    const lodRoot = new THREE.Group();
    lodRoot.name = 'village';
    // Clone instanced mesh with 2 clumps: one near (z=-20) and one far (z=-140)
    const testBam = new THREE.InstancedMesh(bamSrc.geometry.clone(), bamSrc.material, 2);
    testBam.name = 'bamboo';
    const obj = new THREE.Object3D();
    obj.position.set(0, 0, -20); obj.updateMatrix(); testBam.setMatrixAt(0, obj.matrix);
    obj.position.set(0, 0, -140); obj.updateMatrix(); testBam.setMatrixAt(1, obj.matrix);
    testBam.instanceMatrix.needsUpdate = true;
    lodRoot.add(testBam);
    lodScene.add(lodRoot);

    const lodCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);
    lodCam.position.set(0, 5, 0);
    lodCam.lookAt(0, 3, -100);
    lodCam.updateMatrixWorld();

    const vis = optimizeStaticVisibility(lodScene, {
      getLod: (mesh) => mesh.name === 'bamboo'
        ? { geometry: farBamGeo, distance: 86, hysteresis: 8, syncGeometry: (s, g) => syncLodVertexColors(s, g, 2.3) }
        : null
    });
    vis.update(lodCam);
    const entry = vis.entries[0];
    assert.equal(entry.proxy.count, 1, 'near bamboo clump stays on full-detail proxy');
    assert.equal(entry.lod.proxy.count, 1, 'far bamboo clump (>94m) switches to lightweight LOD proxy');
    assert.ok(vis.getStats().trianglesAfter < srcTris * 1.25, 'LOD cuts combined triangles cleanly');
    // Season color sync updates far LOD vertex colors when source color version increments
    const beforeLodR = farBamGeo.attributes.color.array[0];
    testBam.geometry.attributes.color.array.fill(0.9);
    testBam.geometry.attributes.color.needsUpdate = true;
    vis.update(lodCam);
    assert.ok(Math.abs(farBamGeo.attributes.color.array[0] - 0.9) < 0.02 && farBamGeo.attributes.color.array[0] !== beforeLodR, 'far LOD vertex colors stay synced with seasonal changes');
    vis.dispose();
    testBam.geometry.dispose();
  }

  {
    // Scroll Studio captures cruise camera region/coords instead of stale player.state
    const cruiseCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
    cruiseCam.position.set(68, 8, -152); // 美池
    const mockCanvas2 = env.doc.createElement('canvas');
    mockCanvas2.width = 640; mockCanvas2.height = 360;
    const st2 = createScrollStudio({
      canvas: mockCanvas2,
      player: { state: { x: 26, y: 2, z: 185, yaw: 0, pitch: 0 }, clearInput() {} },
      camera: cruiseCam,
      field,
      journal: { isOpen: () => false },
      map: { isOpen: () => false, getStats: () => ({ region: '武陵溪' }) },
      sky,
      getPhenology: () => phenology,
      getTravelerGuide: () => ({ cruiseActive: true }),
      world,
      doc: env.doc,
      win: env.win,
      storage: env.win.localStorage
    });
    st2.openCapture();
    env.doc.getElementById('scroll-save-box').dispatch('click', {});
    const latest = st2.getSavedScrolls()[0];
    assert.notEqual(latest.region, '武陵溪', `mid-cruise scroll resolves camera region instead of player spawn (got ${latest.region})`);
    assert.ok(Math.abs(latest.x - 68) < 1 && Math.abs(latest.z - (-152)) < 1, 'mid-cruise scroll saves camera coordinates for 入画重游');
    st2.close();
    st2.dispose();
  }

  // Cleanup all Three.js objects created in test
  waterSurf.dispose();
  archCraft.dispose();
  phenology.dispose();
  seasonalCycle.dispose();
  sky.dispose();
  outerWilds.dispose();
  valleyBorderlands.dispose();
  oxPlowing.dispose();
  qinHanCompletion.dispose?.();
  pondLife.dispose();
  village.dispose?.();

  console.log('PASS check-round12-polish-immersion: Round 1 (冬池枯荷/冬花脱粉/冬田稻茬/牛耕避雪/远山主客峰/夜灯微蛾月相碎银) + Round 2 (豁然开朗呼吸感/大音希声/自题私印) + Round 3 (统一冻结门/零热路径getStats/小笺巡游/触屏控制) 全部通过');
} finally {
  globalThis.document = prevDoc;
  globalThis.window = prevWin;
}
